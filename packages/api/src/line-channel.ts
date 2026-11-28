// Validates a shop's pasted LINE channel credentials against the real LINE API.
//  1. channel id + secret: issue a short-lived channel access token (client_credentials).
//  2. channel access token: GET /v2/bot/info (also returns the bot userId = webhook `destination`).
// Secrets are only ever sent to api.line.me and never appear in returned values or errors.

export interface ChannelInput {
  channelId: string;
  channelSecret: string;
  accessToken: string;
}

export type ChannelCheck =
  | { ok: true; destination: string; botName: string }
  | { ok: false; reason: "bad_credentials" | "bad_token" | "unreachable" };

export type ChannelValidator = (input: ChannelInput) => Promise<ChannelCheck>;

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createLineChannelValidator(fetchFn?: FetchLike): ChannelValidator {
  const f = fetchFn ?? (fetch as unknown as FetchLike);
  return async (input) => {
    try {
      const cred = await f("https://api.line.me/v2/oauth/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: input.channelId,
          client_secret: input.channelSecret,
        }).toString(),
      });
      if (cred.status >= 500) return { ok: false, reason: "unreachable" };
      if (!cred.ok) return { ok: false, reason: "bad_credentials" };

      const info = await f("https://api.line.me/v2/bot/info", {
        method: "GET",
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      if (info.status >= 500) return { ok: false, reason: "unreachable" };
      if (!info.ok) return { ok: false, reason: "bad_token" };
      const data = (await info.json()) as { userId?: unknown; displayName?: unknown } | null;
      if (typeof data?.userId !== "string" || data.userId === "") {
        return { ok: false, reason: "bad_token" };
      }
      return {
        ok: true,
        destination: data.userId,
        botName: typeof data.displayName === "string" ? data.displayName : "",
      };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  };
}
