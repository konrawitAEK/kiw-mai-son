import { describe, expect, it, vi } from "vitest";
import { verifyPayloadCrc } from "@kms/core";
import type { PlanId, Subscription } from "@kms/core";
import { createHandler } from "./handler.js";
import {
  billingInfo,
  createBillingReminderHandler,
  runBillingReminders,
  type BillingDb,
  type BillingReminderDeps,
  type BillingRouteDeps,
  type ShopSubscription,
} from "./billing.js";
import type { Db } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const NOW = new Date("2026-12-01T03:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const trial = (n: number): Subscription => ({ trialEndsAt: day(n), paidUntil: null, plan: null });

function fakeBillingDb(subs: Record<string, Subscription>) {
  const markPaid = vi.fn(async (shopId: string, plan: PlanId) => {
    const until = day(plan === "yearly" ? 365 : 30);
    subs[shopId] = { ...subs[shopId]!, paidUntil: until, plan };
    return until;
  });
  const db: BillingDb = { getSubscription: async (id) => subs[id] ?? null, markPaid };
  return { db, markPaid, subs };
}

function setup(
  over: Partial<BillingRouteDeps> = {},
  subs: Record<string, Subscription> = { [SHOP]: trial(10) },
) {
  const f = fakeBillingDb(subs);
  const billing: BillingRouteDeps = {
    db: f.db,
    founderPromptPayId: "0812345678",
    founderLineUserId: "Ufounder",
    now: () => NOW,
    ...over,
  };
  const handler = createHandler({
    db: { getShopOwner: async (id: string) => (id === SHOP ? "Uowner" : null) } as unknown as Db,
    verifyIdToken: async (t) =>
      t.startsWith("tok-") ? { userId: t.slice(4), displayName: "x" } : null,
    now: () => NOW.getTime(),
    billing,
  });
  const call = (path: string, user: string | null, init: RequestInit = {}) =>
    handler(
      new Request(`https://x.test/api${path}`, {
        ...init,
        headers: { ...(user ? { Authorization: `Bearer tok-${user}` } : {}) },
      }),
    );
  const post = (path: string, user: string | null, body: unknown) =>
    handler(
      new Request(`https://x.test/api${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user ? { Authorization: `Bearer tok-${user}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { ...f, call, post };
}

describe("GET /shops/:id/admin/billing", () => {
  it("returns status, days left and valid PromptPay payloads for 199 and 1,990", async () => {
    const { call } = setup();
    const res = await call(`/shops/${SHOP}/admin/billing`, "Uowner");
    expect(res.status).toBe(200);
    const { billing } = (await res.json()) as { billing: Awaited<ReturnType<typeof billingInfo>> };
    expect(billing).toMatchObject({ status: "trial", daysLeft: 10, plan: null });
    const { monthly, yearly } = billing!.plans;
    expect(monthly.price).toBe(199);
    expect(yearly.price).toBe(1990);
    expect(verifyPayloadCrc(monthly.promptPayPayload!)).toBe(true);
    expect(monthly.promptPayPayload).toContain("5406199.00");
    expect(yearly.promptPayPayload).toContain("54071990.00");
  });

  it("has no QR when the founder PromptPay ID is missing or invalid", async () => {
    for (const id of [null, "123"]) {
      const { call } = setup({ founderPromptPayId: id });
      const { billing } = (await (await call(`/shops/${SHOP}/admin/billing`, "Uowner")).json()) as {
        billing: { plans: { monthly: { promptPayPayload: string | null } } };
      };
      expect(billing.plans.monthly.promptPayPayload).toBeNull();
    }
  });

  it("is owner-only: no token 401, stranger 403 (and nothing leaks)", async () => {
    const { call } = setup();
    expect((await call(`/shops/${SHOP}/admin/billing`, null)).status).toBe(401);
    const res = await call(`/shops/${SHOP}/admin/billing`, "Ustranger");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("plans");
    expect((await call(`/shops/${OTHER}/admin/billing`, "Uowner")).status).toBe(403);
  });

  it("404 when the shop has no subscription row", async () => {
    const { call } = setup({}, {});
    expect((await call(`/shops/${SHOP}/admin/billing`, "Uowner")).status).toBe(404);
  });
});

describe("POST /billing/mark-paid", () => {
  it("founder marks a shop paid: extends, records who, returns active status", async () => {
    const { post, markPaid } = setup();
    const res = await post("/billing/mark-paid", "Ufounder", {
      shopId: SHOP,
      plan: "monthly",
      note: "  สลิป 1 ธ.ค.  ",
    });
    expect(res.status).toBe(200);
    expect(markPaid).toHaveBeenCalledWith(SHOP, "monthly", "Ufounder", "สลิป 1 ธ.ค.");
    const body = (await res.json()) as { paidUntil: string; billing: { status: string } };
    expect(body.paidUntil).toBe(day(30));
    expect(body.billing.status).toBe("active");
  });

  it("a shop owner cannot mark their own shop paid", async () => {
    const { post, markPaid } = setup();
    const res = await post("/billing/mark-paid", "Uowner", { shopId: SHOP, plan: "yearly" });
    expect(res.status).toBe(403);
    expect(markPaid).not.toHaveBeenCalled();
  });

  it("fails closed when no founder is configured, and 401 without a token", async () => {
    const a = setup({ founderLineUserId: null });
    expect(
      (await a.post("/billing/mark-paid", "Ufounder", { shopId: SHOP, plan: "monthly" })).status,
    ).toBe(403);
    expect(a.markPaid).not.toHaveBeenCalled();
    const b = setup();
    expect(
      (await b.post("/billing/mark-paid", null, { shopId: SHOP, plan: "monthly" })).status,
    ).toBe(401);
  });

  it("validates input and unknown shops", async () => {
    const { post, markPaid } = setup();
    const bad = [
      { shopId: "nope", plan: "monthly" },
      { shopId: SHOP, plan: "weekly" },
      { shopId: SHOP },
      { shopId: SHOP, plan: "monthly", note: "x".repeat(201) },
      { shopId: SHOP, plan: "monthly", note: 5 },
    ];
    for (const body of bad)
      expect((await post("/billing/mark-paid", "Ufounder", body)).status).toBe(400);
    expect(
      (await post("/billing/mark-paid", "Ufounder", { shopId: OTHER, plan: "monthly" })).status,
    ).toBe(404);
    expect(markPaid).not.toHaveBeenCalled();
  });
});

describe("routes are off without deps.billing", () => {
  it("404s", async () => {
    const handler = createHandler({
      db: { getShopOwner: async () => "Uowner" } as unknown as Db,
      verifyIdToken: async () => ({ userId: "Uowner", displayName: "x" }),
      now: () => NOW.getTime(),
    });
    const h = { headers: { Authorization: "Bearer t" } };
    expect(
      (await handler(new Request(`https://x.test/api/shops/${SHOP}/admin/billing`, h))).status,
    ).toBe(404);
    expect(
      (await handler(new Request("https://x.test/api/billing/mark-paid", { method: "POST", ...h })))
        .status,
    ).toBe(404);
  });
});

describe("billingInfo", () => {
  it("shows expired after the trial with no payment", async () => {
    const { db } = fakeBillingDb({ [SHOP]: trial(-2) });
    const info = await billingInfo(
      { db, founderPromptPayId: null, founderLineUserId: null, now: () => NOW },
      SHOP,
    );
    expect(info).toMatchObject({ status: "expired", daysLeft: 0 });
    expect(info!.label).toContain("หมดอายุ");
  });
});

// ---- reminders ----

const row = (over: Partial<ShopSubscription> = {}): ShopSubscription => ({
  shopId: "s1",
  shopName: "เดโม",
  ownerLineUserId: "Uowner",
  subscription: trial(3),
  ...over,
});

function remSetup(rows: ShopSubscription[], now = NOW, over: Partial<BillingReminderDeps> = {}) {
  const log = new Set<string>();
  const push = vi.fn<BillingReminderDeps["push"]>(async () => {});
  const deps: BillingReminderDeps = {
    now: () => now,
    listSubscriptions: async () => rows,
    claim: async (s, k) => (log.has(`${s}|${k}`) ? false : (log.add(`${s}|${k}`), true)),
    release: async (s, k) => void log.delete(`${s}|${k}`),
    getAccessToken: async () => "tok",
    paymentLink: (id) => `https://liff.line.me/x?shop=${id}&page=admin`,
    push,
    ...over,
  };
  return { deps, push };
}

describe("runBillingReminders", () => {
  it("sends a Thai reminder with prices and link 3 days before the trial ends", async () => {
    const { deps, push } = remSetup([row()]);
    expect(await runBillingReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const [token, to, msgs] = push.mock.calls[0]!;
    expect([token, to]).toEqual(["tok", "Uowner"]);
    const text = msgs[0]!.text;
    expect(text).toContain("อีก 3 วัน");
    expect(text).toContain("199");
    expect(text).toContain("1,990");
    expect(text).toContain("https://liff.line.me/x?shop=s1&page=admin");
  });

  it("sends each threshold once, then the next one later", async () => {
    const rows = [row({ subscription: trial(8) })];
    const { deps, push } = remSetup(rows, NOW);
    // 8 days left: nothing
    expect((await runBillingReminders(deps)).sent).toBe(0);
    const at = (n: number) => ({ ...deps, now: () => new Date(NOW.getTime() + n * 86_400_000) });
    expect((await runBillingReminders(at(1))).sent).toBe(1); // 7 days left
    expect((await runBillingReminders(at(1))).skipped).toBe(1); // same day again
    expect((await runBillingReminders(at(2))).skipped).toBe(1); // 6 days left, still the 7-day kind
    expect((await runBillingReminders(at(5))).sent).toBe(1); // 3 days left
    expect((await runBillingReminders(at(7))).sent).toBe(1); // 1 day left
    expect(push).toHaveBeenCalledTimes(3);
  });

  it("does not remind paid shops, expired shops, or shops without a channel", async () => {
    const paid = row({
      shopId: "p",
      subscription: { ...trial(2), paidUntil: day(40), plan: "monthly" },
    });
    const expired = row({ shopId: "e", subscription: trial(-1) });
    const { deps, push } = remSetup([paid, expired]);
    expect(await runBillingReminders(deps)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    const nochan = remSetup([row()], NOW, { getAccessToken: async () => null });
    expect(await runBillingReminders(nochan.deps)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(push).not.toHaveBeenCalled();
  });

  it("releases the claim on push failure so the next run retries", async () => {
    let fail = true;
    const { deps, push } = remSetup([row()], NOW, {
      push: vi.fn(async () => {
        if (fail) throw new Error("boom");
      }),
    });
    expect(await runBillingReminders(deps)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    fail = false;
    expect(await runBillingReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    void push;
  });

  it("one shop failing does not stop the others", async () => {
    const { deps } = remSetup([row({ shopId: "bad" }), row({ shopId: "ok" })], NOW, {
      getAccessToken: async (id) => {
        if (id === "bad") throw new Error("db");
        return "tok";
      },
    });
    expect(await runBillingReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 1 });
  });
});

describe("createBillingReminderHandler", () => {
  const req = (auth?: string, method = "POST") =>
    new Request("https://x.test/billing-reminders", {
      method,
      headers: auth ? { authorization: auth } : {},
    });

  it("requires the cron secret and POST", async () => {
    const { deps } = remSetup([row()]);
    const h = createBillingReminderHandler(deps, "s3cret");
    expect((await h(req())).status).toBe(401);
    expect((await h(req("Bearer wrong"))).status).toBe(401);
    expect((await h(req("Bearer s3cret", "GET"))).status).toBe(405);
    expect((await createBillingReminderHandler(deps, "")(req("Bearer "))).status).toBe(401);
  });

  it("runs and alerts the founder on failures", async () => {
    const alert = vi.fn(async () => {});
    const { deps } = remSetup([row()], NOW, {
      push: async () => {
        throw new Error("x");
      },
    });
    const res = await createBillingReminderHandler(deps, "s3cret", alert)(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(alert).toHaveBeenCalledOnce();
  });
});
