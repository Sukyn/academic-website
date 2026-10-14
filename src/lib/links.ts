/** Content links open web pages; reject executable and malformed URL schemes. */
export function webUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const href = value.trim();
  // URL normalisation silently drops control characters; reject them before parsing.
  if (/[\u0000-\u001f\u007f]/.test(href)) return undefined;
  try {
    const url = new URL(href);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}
