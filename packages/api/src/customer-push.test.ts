import { depositDecisionText } from "@kms/core";
import { describe, expect, it, vi } from "vitest";
import { createCustomerPushHandler, runCustomerPushes } from "./customer-push.js";
import type { CustomerPushDeps, PendingPush } from "./customer-push.js";

const row = (over: Partial<PendingPush> = {}): PendingPush => ({
  id: 1,
  kind: "deposit_confirmed",
  shopId: "shop1",
  shopName: "ร้านเดโม",
  start: "2026-12-07T03:00:00Z", // 10:00 Bangkok
  serviceName: "ทำสีผม",
  depositAmount: 300,
  customerLineUserId: "U1",
  ...over,
});

function setup(rows: PendingPush[], over: Partial<CustomerPushDeps> = {}) {
  const done = new Set<number>();
  const push = vi.fn<CustomerPushDeps["push"]>(async () => {});
  const deps: CustomerPushDeps = {
    listPending: async () => rows.filter((r) => !done.has(r.id)),
    markSent: async (id) => void done.add(id),
    getAccessToken: async () => "tok",
    push,
    ...over,
  };
  return { deps, push, done };
}

describe("Thai text", () => {
  const i = {
    shopName: "ร้านเดโม",
    serviceName: "ทำสีผม",
    start: "2026-12-07T03:00:00Z",
    amount: 1300,
  };
  it("confirm", () => {
    const t = depositDecisionText("deposit_confirmed", i);
    expect(t).toContain("ร้านยืนยันการรับมัดจำ 1,300 บาท");
    expect(t).toContain("ร้าน: ร้านเดโม");
    expect(t).toContain("เวลา 10:00 น.");
  });
  it("reject asks for a new slip", () => {
    expect(depositDecisionText("deposit_rejected", i)).toContain("ส่งสลิปใหม่");
  });
  it("auto-cancel says the queue was cancelled and offers rebooking", () => {
    const t = depositDecisionText("deposit_cancelled", i);
    expect(t).toContain("คิวของคุณถูกยกเลิก");
    expect(t).toContain("จองคิวใหม่");
  });
});

describe("runCustomerPushes", () => {
  it.each(["deposit_confirmed", "deposit_rejected", "deposit_cancelled"] as const)(
    "pushes the Thai text on %s, once",
    async (kind) => {
      const s = setup([row({ kind })]);
      expect(await runCustomerPushes(s.deps)).toEqual({ sent: 1, skipped: 0, failed: 0 });
      expect(s.push).toHaveBeenCalledWith("tok", "U1", [
        {
          type: "text",
          text: depositDecisionText(kind, {
            shopName: "ร้านเดโม",
            serviceName: "ทำสีผม",
            start: "2026-12-07T03:00:00Z",
            amount: 300,
          }),
        },
      ]);
      await runCustomerPushes(s.deps);
      expect(s.push).toHaveBeenCalledTimes(1);
    },
  );

  it("no push when the queue is empty (no-op)", async () => {
    const s = setup([]);
    expect(await runCustomerPushes(s.deps)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(s.push).not.toHaveBeenCalled();
  });

  it("phone-only customer or shop without a channel: nothing sent, marked done", async () => {
    const a = setup([row({ customerLineUserId: null })]);
    expect((await runCustomerPushes(a.deps)).skipped).toBe(1);
    expect(a.push).not.toHaveBeenCalled();
    expect(a.done.has(1)).toBe(true);
    const b = setup([row()], { getAccessToken: async () => null });
    expect((await runCustomerPushes(b.deps)).skipped).toBe(1);
    expect(b.push).not.toHaveBeenCalled();
  });

  it("a failed push stays queued and is retried", async () => {
    let fail = true;
    const s = setup([row()], {
      push: async () => {
        if (fail) throw new Error("LINE down");
      },
    });
    expect((await runCustomerPushes(s.deps)).failed).toBe(1);
    expect(s.done.has(1)).toBe(false);
    fail = false;
    expect((await runCustomerPushes(s.deps)).sent).toBe(1);
  });
});

describe("createCustomerPushHandler", () => {
  it("requires the cron secret and POST", async () => {
    const s = setup([row()]);
    const h = createCustomerPushHandler(s.deps, "sec");
    expect((await h(new Request("https://x.test", { method: "GET" }))).status).toBe(405);
    expect((await h(new Request("https://x.test", { method: "POST" }))).status).toBe(401);
    const ok = await h(
      new Request("https://x.test", { method: "POST", headers: { authorization: "Bearer sec" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });
});
