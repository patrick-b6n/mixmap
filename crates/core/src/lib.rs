//! MixMap core: all logic shared by the devserver and the Tauri shell.

use serde::Serialize;

pub mod artwork;
mod error;
pub mod keys;
pub mod paths;
pub mod rekordbox;
pub mod service;

pub use error::Error;

#[derive(Debug, Serialize)]
pub struct Hello {
    pub message: String,
    pub version: String,
}

pub fn hello() -> Hello {
    Hello {
        message: "hello from mixmap-core".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hello_has_message() {
        assert!(super::hello().message.contains("hello"));
    }
}
