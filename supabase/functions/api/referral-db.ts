// Supabase implementation of ReferralDb (T18). NOT tested locally (needs a real database);
// the SQL it calls (`redeem_referral`) is tested with PGlite in packages/core/src/referral-sql.test.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { isRedeemResult } from "../../../packages/core/src/referral.ts";
import type { ReferralDb } from "../../../packages/api/src/referral.ts";

export function createSupabaseReferralDb(supabase: SupabaseClient): ReferralDb {
  return {
    async getReferral(shopId) {
      const { data, error } = await supabase
        .from("shops")
        .select("name, referral_code")
        .eq("id", shopId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const count = await supabase
        .from("referrals")
        .select("referred_shop_id", { count: "exact", head: true })
        .eq("referrer_shop_id", shopId);
      if (count.error) throw new Error(count.error.message);
      const mine = await supabase
        .from("referrals")
        .select("referred_shop_id", { count: "exact", head: true })
        .eq("referred_shop_id", shopId);
      if (mine.error) throw new Error(mine.error.message);
      return {
        shopName: data.name,
        code: data.referral_code,
        referredCount: count.count ?? 0,
        redeemed: (mine.count ?? 0) > 0,
      };
    },
    async redeem(shopId, code) {
      const { data, error } = await supabase.rpc("redeem_referral", {
        p_shop_id: shopId,
        p_code: code,
      });
      if (error) throw new Error(error.message);
      if (!isRedeemResult(data)) throw new Error("unexpected redeem_referral result");
      return data;
    },
  };
}
