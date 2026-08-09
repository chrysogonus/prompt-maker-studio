/**
 * Trigger a browser download for a fetched blob.
 *
 * Exists as its own module so tests have a boundary to mock. Clicking a
 * synthesised `<a download>` is unimplemented in jsdom, which reacts by
 * attempting a real navigation and logging an uncaught "Not implemented:
 * navigation" error from a timer — after the test that caused it has finished,
 * so it surfaces as unattributed noise in an otherwise green run rather than as
 * a failure anyone can trace.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
