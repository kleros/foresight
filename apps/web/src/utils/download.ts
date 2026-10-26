/** Hands the browser a file to save, from text already in memory. */
export function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Firefox and Safari drop a download whose URL is revoked in the same tick
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
