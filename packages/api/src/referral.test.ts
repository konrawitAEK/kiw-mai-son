import { describe, expect, it, vi } from "vitest";
import type { RedeemResult } from "@kms/core";
import { createHandler } from "./handler.js";
import type { ReferralDb } from "./referral.js";
import type { Db } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-12-01T03:00:00Z");

function setup(result: RedeemResult = "ok", withReferral = true) {
  const redeem = vi.fn(async (_shop: string, _code: string) => result);
  const db: ReferralDb = {
    getReferral: async (id) =>
      id === SHOP ? { shopName: "สวย", code: "ABCD2345", referredCount: 2, redeemed: false } : null,
    redeem,
  };
  const handler = createHandler({
    db: { getShopOwner: async (id: string) => (id === SHOP ? "Uowner" : null) } as unknown as Db,
    verifyIdToken: async (t) =>
      t.startsWith("tok-") ? { userId: t.slice(4), displayName: "x" } : null,
    now: () => NOW,
    ...(withReferral ? { referral: db } : {}),
  });
  const call = (path: string, user: string | null, method = "GET", body?: unknown) =>
    handler(
      new Request(`https://x.test/api${path}`, {
        method,
        headers: user ? { Authorization: `Bearer tok-${user}` } : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { call, redeem };
}

describe("GET /shops/:id/admin/referral", () => {
  it("shows the owner's code, count and Thai share text", async () => {
    const res = await setup().call(`/shops/${SHOP}/admin/referral`, "Uowner");
    expect(res.status).toBe(200);
    const { referral } = (await res.json()) as { referral: Record<string, unknown> };
    expect(referral["code"]).toBe("ABCD2345");
    expect(referral["referredCount"]).toBe(2);
    expect(referral["bonusMonths"]).toBe(1);
    expect(String(referral["shareText"])).toContain("ABCD2345");
  });
  it("401 without a token, 403 for a non-owner, 404 when the feature is off", async () => {
    const s = setup();
    expect((await s.call(`/shops/${SHOP}/admin/referral`, null)).status).toBe(401);
    expect((await s.call(`/shops/${SHOP}/admin/referral`, "stranger")).status).toBe(403);
    const off = setup("ok", false);
    expect((await off.call(`/shops/${SHOP}/admin/referral`, "Uowner")).status).toBe(404);
  });
});

describe("POST /shops/:id/admin/referral/redeem", () => {
  const url = `/shops/${SHOP}/admin/referral/redeem`;
  it("redeems a normalised code and reports success", async () => {
    const s = setup("ok");
    const res = await s.call(url, "Uowner", "POST", { code: "abcd-2345" });
    expect(res.status).toBe(200);
    expect(s.redeem).toHaveBeenCalledWith(SHOP, "ABCD2345");
    const body = (await res.json()) as { result: string; message: string };
    expect(body.result).toBe("ok");
    expect(body.message).toContain("ฟรีเพิ่ม 1 เดือน");
  });
  it("maps failures to Thai errors", async () => {
    const cases: [RedeemResult, number][] = [
      ["invalid_code", 404],
      ["own_code", 409],
      ["same_owner", 409],
      ["already_redeemed", 409],
      ["too_old", 409],
    ];
    for (const [result, status] of cases) {
      const res = await setup(result).call(url, "Uowner", "POST", { code: "ABCD2345" });
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toMatch(/[ก-๙]/);
    }
  });
  it("400 for a malformed code without touching the DB; non-owner is refused", async () => {
    const s = setup();
    expect((await s.call(url, "Uowner", "POST", { code: "x" })).status).toBe(400);
    expect((await s.call(url, "Uowner", "POST", {})).status).toBe(400);
    expect((await s.call(url, "stranger", "POST", { code: "ABCD2345" })).status).toBe(403);
    expect(s.redeem).not.toHaveBeenCalled();
  });
});
