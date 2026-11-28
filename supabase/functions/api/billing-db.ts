// Supabase implementation of BillingDb (T17). NOT tested locally (needs a real database);
// the SQL it calls (`mark_subscription_paid`) is tested with PGlite in packages/core/src/billing-sql.test.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import type { BillingDb } from "../../../packages/api/src/billing.ts";

export function createSupabaseBillingDb(supabase: SupabaseClient): BillingDb {
  return {
    async getSubscription(shopId) {
      const { data, error } = await supabase
        .from("shop_subscriptions")
        .select("trial_ends_at, paid_until, plan")
        .eq("shop_id", shopId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        trialEndsAt: new Date(data.trial_ends_at).toISOString(),
        paidUntil: data.paid_until ? new Date(data.paid_until).toISOString() : null,
        plan: data.plan,
      };
    },
    async markPaid(shopId, plan, markedBy, note) {
      const { data, error } = await supabase.rpc("mark_subscription_paid", {
        p_shop_id: shopId,
        p_plan: plan,
        p_marked_by: markedBy,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      return new Date(data as string).toISOString();
    },
  };
}
