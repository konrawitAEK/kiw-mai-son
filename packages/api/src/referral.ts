import {
  REDEEM_MESSAGES,
  normalizeReferralCode,
  referralShareText,
  REFERRAL_BONUS_MONTHS,
} from "@kms/core";
import type { RedeemResult } from "@kms/core";
import { err, json, MSG } from "./http.js";

/** DB access for referrals (Supabase implementation in supabase/functions; faked in tests). */
export interface ReferralDb {
  /** The shop's own code and how many shops redeemed it; null if the shop does not exist. */
  getReferral(shopId: string): Promise<{
    shopName: string;
    code: string;
    referredCount: number;
    /** true if this shop already redeemed someone's code. */
    redeemed: boolean;
  } | null>;
  /** SQL `redeem_referral`: both shops get a free month only when the result is "ok". */
  redeem(shopId: string, code: string): Promise<RedeemResult>;
}

export interface ReferralInfo {
  code: string;
  referredCount: number;
  redeemed: boolean;
  bonusMonths: number;
  /** Thai text the owner can send to another shop. */
  shareText: string;
}

const STATUS: Record<Exclude<RedeemResult, "ok">, number> = {
  invalid_code: 404,
  own_code: 409,
  same_owner: 409,
  already_redeemed: 409,
  too_old: 409,
};

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function referralInfo(db: ReferralDb, shopId: string): Promise<ReferralInfo | null> {
  const r = await db.getReferral(shopId);
  if (!r) return null;
  return {
    code: r.code,
    referredCount: r.referredCount,
    redeemed: r.redeemed,
    bonusMonths: REFERRAL_BONUS_MONTHS,
    shareText: referralShareText({ shopName: r.shopName, code: r.code }),
  };
}

/** Owner-only routes (the caller is already verified as the shop owner). */
export function createReferralRoutes(db: ReferralDb) {
  return {
    /** GET /shops/:id/admin/referral */
    async ownerInfo(shopId: string): Promise<Response> {
      const info = await referralInfo(db, shopId);
      if (!info) return err(404, MSG.notFound);
      return json(200, { referral: info });
    },

    /** POST /shops/:id/admin/referral/redeem { code }: this shop uses another shop's code. */
    async redeem(req: Request, shopId: string): Promise<Response> {
      const body = await readJson(req);
      const code = normalizeReferralCode(body?.code);
      if (!code) return err(400, REDEEM_MESSAGES.invalid_code);
      const result = await db.redeem(shopId, code);
      if (result !== "ok") return err(STATUS[result], REDEEM_MESSAGES[result]);
      return json(200, {
        result,
        message: REDEEM_MESSAGES.ok,
        referral: await referralInfo(db, shopId),
      });
    },
  };
}
