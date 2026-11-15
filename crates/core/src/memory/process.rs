//! Read-only access to another process's memory (Windows). The process is opened
//! with query + read rights only; nothing is ever written.

use std::ffi::c_void;
use std::path::PathBuf;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Process32FirstW, Process32NextW, MODULEENTRY32W,
    PROCESSENTRY32W, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{
    VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_IMAGE, MEM_PRIVATE, PAGE_GUARD,
    PAGE_NOACCESS,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};

use super::{Memory, Region};
use crate::Error;

pub struct Process {
    handle: HANDLE,
    module: Region,
    pub exe: PathBuf,
    pub pid: u32,
}

// The handle is only used for reads, which are thread-safe.
unsafe impl Send for Process {}
unsafe impl Sync for Process {}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle) };
    }
}

fn wide_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

/// Id of the first running process whose executable is named `exe` (case-insensitive).
pub fn find_pid(exe: &str) -> Option<u32> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            if wide_to_string(&entry.szExeFile).eq_ignore_ascii_case(exe) {
                found = Some(entry.th32ProcessID);
                break;
            }
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        found
    }
}

impl Process {
    /// Open a process for reading.
    pub fn open(pid: u32) -> Result<Self, Error> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return Err(Error::Forbidden(format!(
                    "cannot read process {pid}: {}",
                    std::io::Error::last_os_error()
                )));
            }
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
            if snap == INVALID_HANDLE_VALUE {
                CloseHandle(handle);
                return Err(Error::Invalid(format!(
                    "cannot list modules of process {pid}: {}",
                    std::io::Error::last_os_error()
                )));
            }
            let mut m: MODULEENTRY32W = std::mem::zeroed();
            m.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
            let ok = Module32FirstW(snap, &mut m) != 0;
            CloseHandle(snap);
            if !ok {
                CloseHandle(handle);
                return Err(Error::Invalid(format!("process {pid} has no main module")));
            }
            Ok(Self {
                exe: PathBuf::from(wide_to_string(&m.szExePath)),
                handle,
                module: Region {
                    base: m.modBaseAddr as u64,
                    size: m.modBaseSize as u64,
                },
                pid,
            })
        }
    }

    /// The executable's file version, e.g. "7.2.19.0".
    pub fn version(&self) -> Option<String> {
        file_version(&self.exe)
    }
}

/// File version from an executable's version resource.
pub fn file_version(path: &std::path::Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    unsafe {
        let size = GetFileVersionInfoSizeW(wide.as_ptr(), std::ptr::null_mut());
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(wide.as_ptr(), 0, size, data.as_mut_ptr().cast()) == 0 {
            return None;
        }
        let mut info: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let root: Vec<u16> = "\\".encode_utf16().chain([0]).collect();
        if VerQueryValueW(data.as_ptr().cast(), root.as_ptr(), &mut info, &mut len) == 0
            || info.is_null()
            || (len as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>()
        {
            return None;
        }
        let f = &*(info as *const VS_FIXEDFILEINFO);
        Some(format!(
            "{}.{}.{}.{}",
            f.dwFileVersionMS >> 16,
            f.dwFileVersionMS & 0xffff,
            f.dwFileVersionLS >> 16,
            f.dwFileVersionLS & 0xffff
        ))
    }
}

impl Memory for Process {
    fn regions(&self) -> Vec<Region> {
        let mut out = Vec::new();
        let mut addr: usize = 0;
        unsafe {
            loop {
                let mut info: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
                let n = VirtualQueryEx(
                    self.handle,
                    addr as *const c_void,
                    &mut info,
                    std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
                );
                if n == 0 {
                    break;
                }
                let readable =
                    info.Protect & (PAGE_NOACCESS | PAGE_GUARD) == 0 && info.Protect != 0;
                // Heap and images; mapped files (e.g. databases) are skipped.
                if info.State == MEM_COMMIT
                    && readable
                    && (info.Type == MEM_PRIVATE || info.Type == MEM_IMAGE)
                {
                    out.push(Region {
                        base: info.BaseAddress as u64,
                        size: info.RegionSize as u64,
                    });
                }
                let next = (info.BaseAddress as usize).saturating_add(info.RegionSize);
                if next <= addr {
                    break;
                }
                addr = next;
            }
        }
        out
    }

    fn read(&self, addr: u64, buf: &mut [u8]) -> bool {
        let mut done = 0usize;
        unsafe {
            ReadProcessMemory(
                self.handle,
                addr as *const c_void,
                buf.as_mut_ptr().cast(),
                buf.len(),
                &mut done,
            ) != 0
                && done == buf.len()
        }
    }

    fn module(&self) -> Region {
        self.module
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::pointers::{find_chains, Options};
    use crate::memory::scan::find_strings;
    use crate::memory::{read_string, Encoding};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Static data of this test binary pointing to a heap struct holding a title.
    static ROOT: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn reads_its_own_process_and_finds_a_chain() {
        let pid = std::process::id();
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert_eq!(find_pid(name), Some(pid));

        // struct { pad: [u64; 3], title: *const u8 } on the heap, title NUL-terminated.
        let title = format!("mixmap memory test {pid} Ü\0");
        let title: &'static str = Box::leak(title.into_boxed_str());
        let obj: &'static mut [u64; 4] = Box::leak(Box::new([0, 0, 0, title.as_ptr() as u64]));
        ROOT.store(obj.as_ptr() as u64, Ordering::SeqCst);

        let p = Process::open(pid).unwrap();
        assert!(p.version().is_none() || p.version().unwrap().contains('.'));
        // Other test threads change this process's heap while we scan it; a scan can
        // miss a region that is being reshaped, so allow one more try.
        let found = (0..2).any(|_| {
            find_strings(&p, title.trim_end_matches('\0'), Encoding::Utf8, |_, _| {})
                .contains(&(title.as_ptr() as u64))
        });
        assert!(found, "string not found at {:#x}", title.as_ptr() as u64);
        let opts = Options {
            max_depth: 3,
            max_offset: 0x40,
            ..Options::default()
        };
        let chains = find_chains(&p, &[title.as_ptr() as u64], opts, |_, _| {});
        let root = &ROOT as *const AtomicU64 as u64 - p.module().base;
        let chain = chains
            .iter()
            .map(|(c, _)| c)
            .find(|c| c.base == root)
            .expect("chain from the static root");
        assert_eq!(chain.offsets, vec![0x18, 0]);
        let at = chain.resolve(&p).unwrap();
        assert_eq!(
            read_string(&p, at, Encoding::Utf8).as_deref(),
            Some(title.trim_end_matches('\0'))
        );
    }

    #[test]
    fn missing_process() {
        assert_eq!(find_pid("no-such-process-mixmap.exe"), None);
    }
}
