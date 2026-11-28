import { describe, expect, it, vi } from "vitest";
import { createMonthlyStatsHandler, runMonthlySummaries } from "./monthly-stats.js";
import type { MonthlyStatsDeps, ShopMonthlyStats } from "./monthly-stats.js";

const DAY25 = new Date("2026-12-25T03:00:00Z");
const DAY24 = new Date("2026-12-24T03:00:00Z");

const row = (over: Partial<ShopMonthlyStats> = {}): ShopMonthlyStats => ({
  shopId: "s1",
  shopName: "เดโม",
  ownerLineUserId: "Uowner",
  stats: {
    bookings: 10,
    viaLine: 7,
    viaOwner: 3,
    noShows: 1,
    cancelled: 2,
    depositsPaid: 4,
    depositsPaidAmount: 800,
  },
  ...over,
});

function setup(rows: ShopMonthlyStats[], now = DAY25, over: Partial<MonthlyStatsDeps> = {}) {
  const log = new Set<string>();
  const push = vi.fn<MonthlyStatsDeps["push"]>(async () => {});
  const listStats = vi.fn(async () => rows);
  const deps: MonthlyStatsDeps = {
    now: () => now,
    listStats,
    claim: async (s, m) => (log.has(`${s}|${m}`) ? false : (log.add(`${s}|${m}`), true)),
    release: async (s, m) => void log.delete(`${s}|${m}`),
    getAccessToken: async () => "tok",
    getPaymentLink: async () => "https://pay.example/s1",
    push,
    ...over,
  };
  return { deps, push, listStats };
}

describe("runMonthlySummaries", () => {
  it("on day 25 pushes stats + payment link to the owner and queries the Bangkok month", async () => {
    const { deps, push, listStats } = setup([row()]);
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(listStats).toHaveBeenCalledWith("2026-11-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z");
    const [token, to, msgs] = push.mock.calls[0]!;
    expect([token, to]).toEqual(["tok", "Uowner"]);
    const text = (msgs[0] as { text: string }).text;
    expect(text).toContain("การจองทั้งหมด 10 คิว");
    expect(text).toContain("จองผ่าน LINE 7 คิว");
    expect(text).toContain("เจ้าของร้านจองให้ 3 คิว");
    expect(text).toContain("ลูกค้าไม่มา 1 คิว");
    expect(text).toContain("รวม 800 บาท");
    expect(text).toContain("https://pay.example/s1");
  });

  it("does nothing on other days unless forced", async () => {
    const { deps, push, listStats } = setup([row()], DAY24);
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(listStats).not.toHaveBeenCalled();
    expect((await runMonthlySummaries(deps, { force: true })).sent).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("sends once per month: a second run does not push again", async () => {
    const { deps, push } = setup([row()]);
    await runMonthlySummaries(deps);
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a failed push releases the claim so the next run retries", async () => {
    const push = vi
      .fn<MonthlyStatsDeps["push"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const { deps } = setup([row()], DAY25, { push });
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  it("skips shops with no channel; one shop failing does not stop the others", async () => {
    const { deps, push } = setup(
      [row({ shopId: "a" }), row({ shopId: "b" }), row({ shopId: "c" })],
      DAY25,
      {
        getAccessToken: async (id) => {
          if (id === "a") return null;
          if (id === "b") throw new Error("db down");
          return "tok";
        },
      },
    );
    expect(await runMonthlySummaries(deps)).toEqual({ sent: 1, skipped: 1, failed: 1 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("still sends stats when the shop has no payment link", async () => {
    const { deps, push } = setup([row()], DAY25, { getPaymentLink: async () => null });
    await runMonthlySummaries(deps);
    expect((push.mock.calls[0]![2][0] as { text: string }).text).not.toContain("ชำระ");
  });
});

describe("createMonthlyStatsHandler", () => {
  const req = (method: string, auth?: string) =>
    new Request("https://x/monthly-stats", {
      method,
      headers: auth ? { authorization: auth } : {},
    });

  it("requires POST and the cron secret", async () => {
    const { deps } = setup([row()]);
    const h = createMonthlyStatsHandler(deps, "sec");
    expect((await h(req("GET", "Bearer sec"))).status).toBe(405);
    expect((await h(req("POST"))).status).toBe(401);
    expect((await h(req("POST", "Bearer nope"))).status).toBe(401);
    const ok = await h(req("POST", "Bearer sec"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  it("rejects everything when no secret is configured", async () => {
    const { deps } = setup([row()]);
    expect((await createMonthlyStatsHandler(deps, "")(req("POST", "Bearer "))).status).toBe(401);
  });

  it("alerts the founder on failures and returns 500 on a thrown error", async () => {
    const alert = vi.fn(async () => {});
    const failing = setup([row()], DAY25, {
      push: async () => {
        throw new Error("x");
      },
    }).deps;
    await createMonthlyStatsHandler(failing, "sec", alert)(req("POST", "Bearer sec"));
    expect(alert).toHaveBeenCalledOnce();
    const broken = setup([], DAY25, {
      listStats: async () => {
        throw new Error("db");
      },
    }).deps;
    expect((await createMonthlyStatsHandler(broken, "sec")(req("POST", "Bearer sec"))).status).toBe(
      500,
    );
  });
});
