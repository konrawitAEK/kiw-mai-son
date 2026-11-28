import liff from "@line/liff";

/** Initialise LIFF, log in if needed, and return the ID token + display name. */
export async function initLiff(liffId: string): Promise<{ idToken: string | null }> {
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return { idToken: null };
  }
  return { idToken: liff.getIDToken() };
}

export function closeLiff(): void {
  if (liff.isInClient()) liff.closeWindow();
}

/** True when the page runs inside LINE's in-app browser (UA contains "Line/"). */
export function isLineUserAgent(ua: string): boolean {
  return /\bLine\//i.test(ua);
}

export function inLineApp(): boolean {
  if (typeof navigator !== "undefined" && isLineUserAgent(navigator.userAgent)) return true;
  try {
    return liff.isInClient();
  } catch {
    return false;
  }
}

/** Opens a URL in the phone's external browser (outside LINE), where file downloads work. */
export function openExternal(url: string): void {
  liff.openWindow({ url, external: true });
}
