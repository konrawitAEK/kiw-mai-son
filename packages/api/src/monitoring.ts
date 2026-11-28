/** Monitoring (T15): founder alerts on LINE + health-check endpoint. Pure logic; Deno wiring lives in supabase/functions/*. */

export type Alert = (text: string) => Promise<void>;

export interface AlerterConfig {
  /** Channel access token of the founder's own LINE OA (Messaging API). Never logged. */
  channelAccessToken: string;
  /** The founder's LINE user id (push target). */
  founderUserId: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Same alert key is sent at most once per cooldown (default 15 min) so an outage does not flood the founder. */
  cooldownMs?: number;
}

const MAX_TEXT = 900;

/**
 * Builds an `alert(text, key?)` function that pushes a text message to the founder's LINE.
 * Never throws (an alert failure must not break the function it reports on). If not configured, it is a no-op.
 * The text must not contain customer data or secrets: callers pass only function name, status and counts.
 */
export function createFounderAlerter(config: Partial<AlerterConfig>): Alert {
  const { channelAccessToken, founderUserId } = config;
  const fetchFn = config.fetchFn ?? fetch;
  const now = config.now ?? Date.now;
  const cooldown = config.cooldownMs ?? 15 * 60_000;
  const last = new Map<string, number>();

  return async (text: string) => {
    if (!channelAccessToken || !founderUserId) return;
    const key = text;
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < cooldown) return;
    last.set(key, t);
    try {
      const r = await fetchFn("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          to: founderUserId,
          messages: [{ type: "text", text: text.slice(0, MAX_TEXT) }],
        }),
      });
      if (!r.ok) last.delete(key); // retry sooner if LINE rejected it
    } catch {
      last.delete(key);
    }
  };
}

export function functionErrorText(name: string, detail: string): string {
  return `⚠️ คิวไม่ซ้อน: ฟังก์ชัน ${name} ผิดพลาด (${detail.slice(0, 200)})`;
}

export function reminderFailureText(failed: number, sent: number): string {
  return `⚠️ คิวไม่ซ้อน: ส่งเตือนนัดไม่สำเร็จ ${failed} รายการ (ส่งสำเร็จ ${sent})`;
}

/** Wraps an Edge Function handler: alerts the founder on a thrown error or any 5xx response, and keeps the original behaviour. */
export function withErrorAlert(
  name: string,
  handler: (req: Request) => Promise<Response>,
  alert: Alert,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      await alert(functionErrorText(name, e instanceof Error ? e.name : "unknown error"));
      return new Response("error", { status: 500 });
    }
    if (res.status >= 500) await alert(functionErrorText(name, `HTTP ${res.status}`));
    return res;
  };
}

export interface HealthDeps {
  /** Resolves if the database answers a trivial query; rejects otherwise. */
  pingDb(): Promise<void>;
  now(): Date;
  alert?: Alert;
  /** Per-check timeout (default 5000 ms). */
  timeoutMs?: number;
}

export interface HealthReport {
  status: "ok" | "degraded";
  time: string;
  checks: { db: "ok" | "fail" };
}

/** GET -> 200 {status:"ok"} or 503 {status:"degraded"}; alerts the founder when degraded. Exposes no data. */
export function createHealthHandler(deps: HealthDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("method not allowed", { status: 405 });
    let db: "ok" | "fail" = "ok";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.pingDb(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error("timeout")), deps.timeoutMs ?? 5000);
        }),
      ]);
    } catch {
      db = "fail";
    } finally {
      if (timer) clearTimeout(timer);
    }
    const report: HealthReport = {
      status: db === "ok" ? "ok" : "degraded",
      time: deps.now().toISOString(),
      checks: { db },
    };
    if (report.status !== "ok" && deps.alert)
      await deps.alert(functionErrorText("health", "database check failed"));
    return new Response(req.method === "HEAD" ? null : JSON.stringify(report), {
      status: report.status === "ok" ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  };
}
