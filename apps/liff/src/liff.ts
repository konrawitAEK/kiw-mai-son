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
