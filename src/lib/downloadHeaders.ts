/** Strip characters that are illegal in Windows/OneDrive filenames. */
export function safeFilenamePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

/** A Content-Disposition header value that degrades gracefully for
 * non-ASCII filenames (RFC 5987 filename*). */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/["\\]/g, "");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}
