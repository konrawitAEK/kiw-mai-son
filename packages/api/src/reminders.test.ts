import { describe, expect, it, vi } from "vitest";
import { createLinePush, createReminderHandler, runReminders } from "./reminders.js";
import type { LineMessage, ReminderCandidate, ReminderDeps } from "./reminders.js";

const NOW = new Date("2026-12-06T10:00:00Z");
const B1 = "44444444-4444-4444-8444-444444444441";
const B2 = "44444444-4444-4444-8444-444444444442";
const SOON = "2026-12-07T09:30:00Z"; // 23.5h ahead

const cand = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  bookingId: B1,
  shopId: "shop1",
  shopName: "ร้านเดโม",
  remindersEnabled: true,
  status: "confirmed",
  start: SOON,
  customerLineUserId: "U1",
  serviceName: "ตัดผม",
  staffName: "เอ",
  ...over,
});

/** In-memory reminders_log makes "never twice" testable across runs. */
function setup(cands: ReminderCandidate[], over: Partial<ReminderDeps> = {}) {
  const log = new Set<string>();
  const push = vi.fn<ReminderDeps["push"]>(async () => {});
  const deps: ReminderDeps = {
    now: () => NOW,
    listCandidates: async () => cands.filter((c) => !log.has(c.bookingId)),
    claim: async (id) => (log.has(id) ? false : (log.add(id), true)),
    release: async (id) => void log.delete(id),
    getAccessToken: async () => "tok",
    push,
    ...over,
  };
  return { deps, push, log };
}

describe("runReminders", () => {
  it("pushes the reminder with ยืนยันมา / ขอเลื่อน buttons", async () => {
    const { deps, push } = setup([cand()]);
    expect(await runReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const [token, to, msgs] = push.mock.calls[0] as [string, string, LineMessage[]];
    expect([token, to]).toEqual(["tok", "U1"]);
    const m = msgs[0]!;
    expect(m.template.text).toMatchInlineSnapshot(`
      "นัดพรุ่งนี้ ⏰ ร้านร้านเดโม
      ตัดผม (ช่างเอ)
      วันจันทร์ที่ 7 ธ.ค. 2569 เวลา 16:30 น."
    `);
    expect(m.template.text.length).toBeLessThanOrEqual(160);
    expect(m.template.actions.map((a) => [a.type, a.label, a.data])).toEqual([
      ["postback", "ยืนยันมา", `reminder=confirm&booking=${B1}`],
      ["postback", "ขอเลื่อน", `reminder=reschedule&booking=${B1}`],
    ]);
  });

  it("sends once only: a second run (and a concurrent claim) does not push again", async () => {
    const { deps, push } = setup([cand()]);
    await runReminders(deps);
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(push).toHaveBeenCalledTimes(1);

    // Another worker already claimed it between listing and claiming.
    const { deps: d2, push: p2 } = setup([cand()], { claim: async () => false });
    expect(await runReminders(d2)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(p2).not.toHaveBeenCalled();
  });

  it("failed push releases the claim so the next run retries, then sends once", async () => {
    let fail = true;
    const push = vi.fn<ReminderDeps["push"]>(async () => {
      if (fail) throw new Error("LINE down");
    });
    const { deps, log } = setup([cand()], { push });
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(log.size).toBe(0);
    fail = false;
    expect(await runReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("skips shops that turned reminders off", async () => {
    const { deps, push } = setup([cand({ remindersEnabled: false })]);
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(push).not.toHaveBeenCalled();
  });

  it("skips cancelled / finished bookings", async () => {
    const { deps, push } = setup([
      cand({ status: "cancelled" }),
      cand({ bookingId: B2, status: "no_show" }),
    ]);
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(push).not.toHaveBeenCalled();
  });

  it("skips phone-only customers, bookings outside the 23-24h window, and shops with no channel", async () => {
    const { deps, push } = setup([
      cand({ customerLineUserId: null }),
      cand({ bookingId: B2, start: "2026-12-07T11:00:00Z" }), // 25h
      cand({ bookingId: "x", start: "2026-12-06T20:00:00Z" }), // 10h
    ]);
    expect(await runReminders(deps)).toEqual({ sent: 0, skipped: 3, failed: 0 });
    const { deps: d2, push: p2 } = setup([cand()], { getAccessToken: async () => null });
    expect((await runReminders(d2)).skipped).toBe(1);
    expect(push).not.toHaveBeenCalled();
    expect(p2).not.toHaveBeenCalled();
  });

  it("one failing booking does not stop the others; token looked up once per shop", async () => {
    const getAccessToken = vi.fn(async () => "tok");
    const push = vi.fn<ReminderDeps["push"]>(async (_t, to) => {
      if (to === "U1") throw new Error("blocked");
    });
    const { deps } = setup([cand(), cand({ bookingId: B2, customerLineUserId: "U2" })], {
      getAccessToken,
      push,
    });
    expect(await runReminders(deps)).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe("createLinePush / createReminderHandler", () => {
  it("posts to the LINE push API with the shop token and throws on non-2xx", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await createLinePush(f as unknown as typeof fetch)("tok", "U1", []);
    const call = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.line.me/v2/bot/message/push");
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(call[1].body as string)).toEqual({ to: "U1", messages: [] });
    const bad = vi.fn(async () => new Response("no", { status: 400 }));
    await expect(createLinePush(bad as unknown as typeof fetch)("t", "U", [])).rejects.toThrow();
  });

  it("requires the cron secret", async () => {
    const { deps, push } = setup([cand()]);
    const h = createReminderHandler(deps, "s3cret");
    const r = (init: RequestInit) => h(new Request("https://x.test/reminders", init));
    expect((await r({ method: "POST" })).status).toBe(401);
    expect((await r({ method: "POST", headers: { authorization: "Bearer no" } })).status).toBe(401);
    expect((await r({ method: "GET" })).status).toBe(405);
    expect(push).not.toHaveBeenCalled();
    const ok = await r({ method: "POST", headers: { authorization: "Bearer s3cret" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: 1, skipped: 0, failed: 0 });
    // An unset secret never authorizes anything.
    const open = createReminderHandler(deps, "");
    expect(
      (
        await open(
          new Request("https://x.test/", { method: "POST", headers: { authorization: "Bearer " } }),
        )
      ).status,
    ).toBe(401);
  });
});
