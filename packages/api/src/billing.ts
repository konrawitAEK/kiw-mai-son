import {
  PLANS,
  billingPayload,
  dueTrialReminder,
  isPlanId,
  statusLabel,
  subscriptionState,
  trialReminderText,
} from "@kms/core";
import type { PlanId, Subscription, SubscriptionStatus } from "@kms/core";
import { err, json, MSG, UUID } from "./http.js";
import type { TextMessage } from "./monthly-stats.js";
import type { LiffUser } from "./types.js";

/** DB access for billing (implemented over Supabase in supabase/functions; faked in tests). */
export interface BillingDb {
  getSubscription(shopId: string): Promise<Subscription | null>;
  /** Records a payment (SQL `mark_subscription_paid`), returns the new paid-until instant. Throws if the shop is unknown. */
  markPaid(shopId: string, plan: PlanId, markedBy: string, note: string | null): Promise<string>;
}

export interface BillingRouteDeps {
  db: BillingDb;
  /** The founder's own PromptPay ID (FOUNDER_PROMPTPAY_ID) that shops pay to; null = not configured. */
  founderPromptPayId: string | null;
  /** FOUNDER_LINE_USER_ID: only this LINE user may mark payments. Unset = nobody can (fail closed). */
  founderLineUserId: string | null;
  now(): Date;
}

export interface BillingInfo {
  status: SubscriptionStatus;
  /** Thai one-liner for the screen. */
  label: string;
  accessUntil: string;
  daysLeft: number;
  /** Last plan paid for. */
  plan: PlanId | null;
  plans: Record<PlanId, { price: number; label: string; promptPayPayload: string | null }>;
}

/** Billing screen data for a shop, or null if it has no subscription row. */
export async function billingInfo(
  b: BillingRouteDeps,
  shopId: string,
): Promise<BillingInfo | null> {
  const sub = await b.db.getSubscription(shopId);
  if (!sub) return null;
  const state = subscriptionState(sub, b.now());
  const payload = (plan: PlanId): string | null => {
    if (!b.founderPromptPayId) return null;
    try {
      return billingPayload(b.founderPromptPayId, plan);
    } catch {
      return null; // invalid configured ID: show "contact us" rather than a bad QR
    }
  };
  const plans = {} as BillingInfo["plans"];
  for (const id of Object.keys(PLANS) as PlanId[]) {
    plans[id] = { price: PLANS[id].price, label: PLANS[id].label, promptPayPayload: payload(id) };
  }
  return {
    status: state.status,
    label: statusLabel(state),
    accessUntil: state.accessUntil,
    daysLeft: state.daysLeft,
    plan: sub.plan,
    plans,
  };
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const NOTE_MAX = 200;

export function createBillingRoutes(b: BillingRouteDeps) {
  return {
    /** GET /shops/:id/admin/billing (caller is already verified as the shop owner). */
    async ownerInfo(shopId: string): Promise<Response> {
      const info = await billingInfo(b, shopId);
      if (!info) return err(404, MSG.notFound);
      return json(200, { billing: info });
    },

    /**
     * POST /billing/mark-paid { shopId, plan, note? } — founder only (LIFF ID token of FOUNDER_LINE_USER_ID).
     * Extends the shop's paid period and records the payment.
     */
    async markPaid(req: Request, user: LiffUser | null): Promise<Response> {
      if (!user) return err(401, MSG.unauthorized);
      if (!b.founderLineUserId || user.userId !== b.founderLineUserId) {
        return err(403, MSG.forbidden);
      }
      const body = await readJson(req);
      if (!body) return err(400, MSG.badRequest);
      const { shopId, plan, note } = body;
      if (
        typeof shopId !== "string" ||
        !UUID.test(shopId) ||
        !isPlanId(plan) ||
        (note !== undefined && (typeof note !== "string" || note.length > NOTE_MAX))
      ) {
        return err(400, MSG.badRequest);
      }
      if (!(await b.db.getSubscription(shopId))) return err(404, MSG.notFound);
      const paidUntil = await b.db.markPaid(
        shopId,
        plan,
        user.userId,
        typeof note === "string" && note.trim() !== "" ? note.trim() : null,
      );
      const info = await billingInfo(b, shopId);
      return json(200, { paidUntil, billing: info });
    },
  };
}

// ---- trial-end reminders ----

export interface ShopSubscription {
  shopId: string;
  shopName: string;
  ownerLineUserId: string;
  subscription: Subscription;
}

export interface BillingReminderDeps {
  now(): Date;
  /** Every shop with its subscription (small table; filtering happens in code). */
  listSubscriptions(): Promise<ShopSubscription[]>;
  /** Atomically records (shop, kind) in billing_reminders_log. false = already sent. */
  claim(shopId: string, kind: string): Promise<boolean>;
  /** Undo a claim after a failed push so the next run retries. */
  release(shopId: string, kind: string): Promise<void>;
  /** Decrypted channel access token, or null if the shop has no channel. */
  getAccessToken(shopId: string): Promise<string | null>;
  /** Link to the shop's billing page (LIFF), or null. */
  paymentLink(shopId: string): string | null;
  push(accessToken: string, to: string, messages: TextMessage[]): Promise<void>;
}

export interface BillingReminderResult {
  sent: number;
  skipped: number;
  failed: number;
}

/** Sends the due trial-ending reminder (7 / 3 / 1 days before) to each owner, once per threshold. */
export async function runBillingReminders(
  deps: BillingReminderDeps,
): Promise<BillingReminderResult> {
  const result: BillingReminderResult = { sent: 0, skipped: 0, failed: 0 };
  const now = deps.now();
  for (const s of await deps.listSubscriptions()) {
    const due = dueTrialReminder(s.subscription, now);
    if (!due) continue;
    try {
      const token = await deps.getAccessToken(s.shopId);
      if (!token || !s.ownerLineUserId) {
        result.skipped++;
        continue;
      }
      if (!(await deps.claim(s.shopId, due.kind))) {
        result.skipped++;
        continue;
      }
      try {
        const text = trialReminderText({
          shopName: s.shopName,
          daysLeft: subscriptionState(s.subscription, now).daysLeft,
          trialEndsAt: s.subscription.trialEndsAt,
          paymentLink: deps.paymentLink(s.shopId),
        });
        await deps.push(token, s.ownerLineUserId, [{ type: "text", text }]);
        result.sent++;
      } catch {
        await deps.release(s.shopId, due.kind);
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** HTTP entry for pg_cron (daily): POST with `Authorization: Bearer <cronSecret>`. */
export function createBillingReminderHandler(
  deps: BillingReminderDeps,
  cronSecret: string,
  alert?: (text: string) => Promise<void>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const auth = req.headers.get("authorization") ?? "";
    if (!cronSecret || auth !== `Bearer ${cronSecret}`)
      return new Response("unauthorized", { status: 401 });
    try {
      const result = await runBillingReminders(deps);
      if (result.failed > 0 && alert)
        await alert(
          `⚠️ ส่งเตือนทดลองใช้ใกล้หมดไม่สำเร็จ ${result.failed} ร้าน (ส่งสำเร็จ ${result.sent})`,
        );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("error", { status: 500 });
    }
  };
}
