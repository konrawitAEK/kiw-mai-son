import { describe, expect, it, vi } from "vitest";
import {
  createFounderAlerter,
  createHealthHandler,
  withErrorAlert,
  reminderFailureText,
} from "./monitoring.js";
import { createReminderHandler, type ReminderDeps } from "./reminders.js";

const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

describe("createFounderAlerter", () => {
  it("pushes a text message to the founder with the bearer token", async () => {
    const f = okFetch();
    const alert = createFounderAlerter({
      channelAccessToken: "TOK",
      founderUserId: "Ufounder",
      fetchFn: f as unknown as typeof fetch,
    });
    await alert("hello");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
    expect(JSON.parse(init.body as string)).toEqual({
      to: "Ufounder",
      messages: [{ type: "text", text: "hello" }],
    });
  });

  it("is a no-op when not configured", async () => {
    const f = okFetch();
    await createFounderAlerter({ fetchFn: f as unknown as typeof fetch })("x");
    expect(f).not.toHaveBeenCalled();
  });

  it("never throws when LINE fails or the network is down", async () => {
    const bad = createFounderAlerter({
      channelAccessToken: "T",
      founderUserId: "U",
      fetchFn: (async () => {
        throw new Error("net");
      }) as typeof fetch,
    });
    await expect(bad("x")).resolves.toBeUndefined();
    const non200 = createFounderAlerter({
      channelAccessToken: "T",
      founderUserId: "U",
      fetchFn: (async () => new Response("no", { status: 401 })) as typeof fetch,
    });
    await expect(non200("x")).resolves.toBeUndefined();
  });

  it("does not repeat the same alert within the cooldown, but does after it", async () => {
    const f = okFetch();
    let t = 0;
    const alert = createFounderAlerter({
      channelAccessToken: "T",
      founderUserId: "U",
      fetchFn: f as unknown as typeof fetch,
      now: () => t,
      cooldownMs: 1000,
    });
    await alert("same");
    await alert("same");
    await alert("other");
    expect(f).toHaveBeenCalledTimes(2);
    t = 1500;
    await alert("same");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("retries sooner when LINE rejected the push", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const alert = createFounderAlerter({
      channelAccessToken: "T",
      founderUserId: "U",
      fetchFn: f as unknown as typeof fetch,
    });
    await alert("a");
    await alert("a");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("withErrorAlert", () => {
  it("alerts on a thrown error and returns 500", async () => {
    const alert = vi.fn(async () => {});
    const h = withErrorAlert(
      "api",
      async () => {
        throw new TypeError("secret detail");
      },
      alert,
    );
    const res = await h(new Request("http://x/"));
    expect(res.status).toBe(500);
    expect(alert).toHaveBeenCalledTimes(1);
    const text = (alert.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain("api");
    expect(text).toContain("TypeError");
    expect(text).not.toContain("secret detail");
  });

  it("alerts on a 5xx response but passes it through", async () => {
    const alert = vi.fn(async () => {});
    const h = withErrorAlert("line-webhook", async () => new Response("x", { status: 502 }), alert);
    expect((await h(new Request("http://x/"))).status).toBe(502);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("stays silent on 2xx and 4xx", async () => {
    const alert = vi.fn(async () => {});
    for (const status of [200, 401, 409]) {
      const h = withErrorAlert("api", async () => new Response("x", { status }), alert);
      expect((await h(new Request("http://x/"))).status).toBe(status);
    }
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("createHealthHandler", () => {
  const now = () => new Date("2026-11-28T10:00:00Z");

  it("returns 200 ok when the db answers", async () => {
    const alert = vi.fn(async () => {});
    const h = createHealthHandler({ pingDb: async () => {}, now, alert });
    const res = await h(new Request("http://x/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      time: "2026-11-28T10:00:00.000Z",
      checks: { db: "ok" },
    });
    expect(alert).not.toHaveBeenCalled();
  });

  it("returns 503 and alerts when the db fails", async () => {
    const alert = vi.fn(async () => {});
    const h = createHealthHandler({
      pingDb: async () => {
        throw new Error("down");
      },
      now,
      alert,
    });
    const res = await h(new Request("http://x/health"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { checks: { db: string } }).checks.db).toBe("fail");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the db hangs past the timeout", async () => {
    const h = createHealthHandler({
      pingDb: () => new Promise(() => {}),
      now,
      timeoutMs: 20,
    });
    expect((await h(new Request("http://x/health"))).status).toBe(503);
  });

  it("rejects other methods", async () => {
    const h = createHealthHandler({ pingDb: async () => {}, now });
    expect((await h(new Request("http://x/health", { method: "POST" }))).status).toBe(405);
  });
});

describe("reminder failures alert the founder", () => {
  const candidate = {
    bookingId: "b1",
    shopId: "s1",
    shopName: "ร้าน",
    remindersEnabled: true,
    status: "confirmed",
    start: "2026-11-29T10:00:00.000Z",
    customerLineUserId: "Ucust",
    serviceName: "ตัดผม",
    staffName: "เอ",
  };
  const deps = (pushFails: boolean): ReminderDeps => ({
    now: () => new Date("2026-11-28T10:30:00.000Z"),
    listCandidates: async () => [candidate],
    claim: async () => true,
    release: async () => {},
    getAccessToken: async () => "tok",
    push: async () => {
      if (pushFails) throw new Error("LINE push failed: 500");
    },
  });
  const req = () =>
    new Request("http://x/", { method: "POST", headers: { authorization: "Bearer s" } });

  it("alerts when a push fails", async () => {
    const alert = vi.fn(async () => {});
    const res = await createReminderHandler(deps(true), "s", alert)(req());
    expect(res.status).toBe(200);
    expect(alert).toHaveBeenCalledWith(reminderFailureText(1, 0));
  });

  it("does not alert when all reminders are sent", async () => {
    const alert = vi.fn(async () => {});
    await createReminderHandler(deps(false), "s", alert)(req());
    expect(alert).not.toHaveBeenCalled();
  });
});
