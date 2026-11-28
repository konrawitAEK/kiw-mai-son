/**
 * CSV download helper for the owner data export.
 *
 * Inside LINE's in-app browser (iOS and Android webviews) a blob download via an
 * `<a download>` click is blocked, so the file never lands on the phone. For those
 * browsers we do not try the blob path; we return a data: URL that the caller shows as a
 * normal link, which the user opens in the external browser (Safari / Chrome) to save.
 */

export type CsvDownloadResult =
  | { mode: "download" }
  | { mode: "link"; href: string; filename: string };

/** LINE appends `Line/<version>` to the user agent of its in-app browser (iOS and Android). */
export function isInAppBrowser(userAgent: string): boolean {
  return /\bLine\//i.test(userAgent);
}

/** Encodes CSV text as a base64 data: URL. The text is expected to carry its own UTF-8 BOM. */
export function csvDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:text/csv;charset=utf-8;base64,${btoa(binary)}`;
}

/**
 * Downloads CSV text as a file. Returns `link` (instead of downloading) inside the LINE
 * in-app browser, or where the browser does not support the `download` attribute; the caller
 * then renders the link for the user to open externally.
 */
export function saveCsv(
  filename: string,
  text: string,
  userAgent: string = globalThis.navigator?.userAgent ?? "",
): CsvDownloadResult {
  const noDownloadAttr =
    typeof document !== "undefined" && !("download" in HTMLAnchorElement.prototype);
  if (isInAppBrowser(userAgent) || noDownloadAttr) {
    return { mode: "link", href: csvDataUrl(text), filename };
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { mode: "download" };
}
