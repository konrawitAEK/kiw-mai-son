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

/** Text the LINE OA webhook (T6) expects to reply with the booking confirmation. */
export function bookingConfirmText(bookingId: string): string {
  return `ยืนยันการจอง ${bookingId}`;
}

/**
 * Posts `ยืนยันการจอง <bookingId>` into the customer's LINE chat so the webhook replies.
 * liff.sendMessages only works inside the LINE client; outside it this is a no-op.
 */
export async function sendBookingConfirmation(bookingId: string): Promise<void> {
  let inClient = false;
  try {
    inClient = liff.isInClient();
  } catch {
    inClient = false;
  }
  if (!inClient) return;
  await liff.sendMessages([{ type: "text", text: bookingConfirmText(bookingId) }]);
}
