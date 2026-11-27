import type { LiffUser } from "./types.js";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

/**
 * Verifies a LIFF ID token with LINE's verify endpoint
 * (https://developers.line.biz/en/reference/line-login/#verify-id-token).
 * `channelId` is the LINE Login channel id (env LINE_LOGIN_CHANNEL_ID), never hard-coded.
 */
export function createLineVerifier(channelId: string, fetchFn: FetchLike = fetch as FetchLike) {
  return async (idToken: string): Promise<LiffUser | null> => {
    try {
      const res = await fetchFn("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { sub?: unknown; name?: unknown };
      if (typeof data.sub !== "string" || data.sub === "") return null;
      return {
        userId: data.sub,
        displayName: typeof data.name === "string" && data.name ? data.name : "ลูกค้า",
      };
    } catch {
      return null;
    }
  };
}
