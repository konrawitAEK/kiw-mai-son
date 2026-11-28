import { depositDecisionText } from "@kms/core";
import type { DepositDecisionKind } from "@kms/core";

export interface TextMessage {
  type: "text";
  text: string;
}

/** One unsent row of the customer_pushes outbox, joined with what the text needs. */
export interface PendingPush {
  id: number;
  kind: DepositDecisionKind;
  shopId: string;
  shopName: string;
  start: string;
  serviceName: string;
  /** THB. */
  depositAmount: number;
  /** null for phone-only customers: nothing can be pushed. */
  customerLineUserId: string | null;
}

export interface CustomerPushDeps {
  listPending(limit: number): Promise<PendingPush[]>;
  markSent(id: number): Promise<void>;
  /** Decrypted channel access token for the shop, or null if it has no channel. */
  getAccessToken(shopId: string): Promise<string | null>;
  push(accessToken: string, to: string, messages: TextMessage[]): Promise<void>;
}

export interface CustomerPushResult {
  sent: number;
  /** No LINE id or no channel: marked done, nothing to send. */
  skipped: number;
  /** Left unsent; the next run retries. */
  failed: number;
}

export const CUSTOMER_PUSH_BATCH = 50;

/** Sends queued deposit-decision pushes. A failed push stays queued and is retried on the next run. */
export async function runCustomerPushes(deps: CustomerPushDeps): Promise<CustomerPushResult> {
  const result: CustomerPushResult = { sent: 0, skipped: 0, failed: 0 };
  const tokens = new Map<string, string | null>();
  for (const p of await deps.listPending(CUSTOMER_PUSH_BATCH)) {
    try {
      if (!p.customerLineUserId) {
        await deps.markSent(p.id);
        result.skipped++;
        continue;
      }
      if (!tokens.has(p.shopId)) tokens.set(p.shopId, await deps.getAccessToken(p.shopId));
      const token = tokens.get(p.shopId);
      if (!token) {
        await deps.markSent(p.id);
        result.skipped++;
        continue;
      }
      const text = depositDecisionText(p.kind, {
        shopName: p.shopName,
        serviceName: p.serviceName,
        start: p.start,
        amount: p.depositAmount,
      });
      await deps.push(token, p.customerLineUserId, [{ type: "text", text }]);
      await deps.markSent(p.id);
      result.sent++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** HTTP entry for pg_cron (via pg_net): POST with `Authorization: Bearer <cronSecret>`. */
export function createCustomerPushHandler(
  deps: CustomerPushDeps,
  cronSecret: string,
  alert?: (text: string) => Promise<void>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const auth = req.headers.get("authorization") ?? "";
    if (!cronSecret || auth !== `Bearer ${cronSecret}`)
      return new Response("unauthorized", { status: 401 });
    try {
      const result = await runCustomerPushes(deps);
      if (result.failed > 0 && alert) {
        await alert(
          `customer-pushes: ส่งข้อความหาลูกค้าไม่สำเร็จ ${result.failed} รายการ (ส่งสำเร็จ ${result.sent})`,
        );
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("error", { status: 500 });
    }
  };
}
