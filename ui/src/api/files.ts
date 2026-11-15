// Saving and opening user files. In the browser: a download and a file picker.
// TODO(#42): Tauri uses its save/open dialogs.

/** Offer `text` as a file download named `name`. */
export function saveTextFile(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
