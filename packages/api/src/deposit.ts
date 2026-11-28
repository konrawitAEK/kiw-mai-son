import { normalizePromptPayId, promptPayPayload } from "@kms/core";
import { err, json, MSG } from "./http.js";
import type { BookingRecord, Deps, DepositStatus, SlipImage } from "./types.js";

/** What the customer's LIFF page needs to show the deposit step. */
export interface DepositInfo {
  /** THB. */
  amount: number;
  status: DepositStatus;
  /** EMVCo PromptPay payload to render as a QR; null if the shop has not set a PromptPay ID yet. */
  promptPayPayload: string | null;
  /** Auto-cancel window in hours; null = the shop does not auto-cancel. */
  timeoutHours: number | null;
}

export const MAX_SLIP_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_SLIP_BYTES * 4) / 3) + 8;
const MAX_TIMEOUT_HOURS = 720;

/** Deposit details for a booking, or null when the booking has no deposit. */
export async function depositInfo(deps: Deps, b: BookingRecord): Promise<DepositInfo | null> {
  if (b.depositAmount <= 0) return null;
  const pay = await deps.db.getShopPayment(b.shopId);
  let payload: string | null = null;
  if (pay?.promptPayId) {
    try {
      payload = promptPayPayload(pay.promptPayId, { amount: b.depositAmount });
    } catch {
      payload = null; // invalid stored ID: show "contact the shop" rather than a bad QR
    }
  }
  return {
    amount: b.depositAmount,
    status: b.depositStatus,
    promptPayPayload: payload,
    timeoutHours: pay?.depositTimeoutHours ?? null,
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

/** Detects the real image type from magic bytes; the declared content type must agree. */
function sniff(d: Uint8Array): SlipImage["contentType"] | null {
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "image/jpeg";
  if (d.length > 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) {
    return "image/png";
  }
  if (
    d.length > 12 &&
    String.fromCharCode(d[0]!, d[1]!, d[2]!, d[3]!) === "RIFF" &&
    String.fromCharCode(d[8]!, d[9]!, d[10]!, d[11]!) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function decodeBase64(s: string): Uint8Array | null {
  if (s.length === 0 || s.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    return null;
  }
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function encodeBase64(d: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < d.length; i += 0x8000) {
    bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const OPEN_STATES: DepositStatus[] = ["pending", "submitted", "rejected"];

/**
 * Deposit routes. Callers do the authentication / ownership checks first:
 * - customer functions get a booking that already belongs to the signed-in customer;
 * - admin functions are only reached after the owner check in admin.ts.
 */
export function createDepositRoutes(deps: Deps) {
  return {
    /** GET /bookings/:id/deposit */
    async customerGet(booking: BookingRecord): Promise<Response> {
      const info = await depositInfo(deps, booking);
      if (!info) return err(404, MSG.noDeposit);
      return json(200, { bookingStatus: booking.status, deposit: info });
    },

    /** POST /bookings/:id/slip   { contentType, dataBase64 } */
    async customerUploadSlip(req: Request, booking: BookingRecord): Promise<Response> {
      if (booking.depositAmount <= 0) return err(404, MSG.noDeposit);
      if (booking.status !== "pending" || !OPEN_STATES.includes(booking.depositStatus)) {
        return err(409, MSG.depositClosed);
      }
      const body = await readJson(req);
      if (!body || typeof body.contentType !== "string" || typeof body.dataBase64 !== "string") {
        return err(400, MSG.slipBad);
      }
      const data = decodeBase64(body.dataBase64);
      const real = data ? sniff(data) : null;
      if (!data || data.length > MAX_SLIP_BYTES || !real || real !== body.contentType) {
        return err(400, MSG.slipBad);
      }
      await deps.db.saveSlip(booking.id, { contentType: real, data });
      const fresh = await deps.db.getBooking(booking.id);
      return json(200, { deposit: fresh ? await depositInfo(deps, fresh) : null });
    },

    /** GET /shops/:shopId/admin/bookings/:id/slip */
    async adminGetSlip(booking: BookingRecord): Promise<Response> {
      const slip = await deps.db.getSlip(booking.id);
      if (!slip) return err(404, MSG.notFound);
      return json(200, { contentType: slip.contentType, dataBase64: encodeBase64(slip.data) });
    },

    /** POST /shops/:shopId/admin/bookings/:id/deposit   { decision: "confirm" | "reject" } */
    async adminDecide(req: Request, booking: BookingRecord): Promise<Response> {
      const body = await readJson(req);
      const decision = body?.decision;
      if (decision !== "confirm" && decision !== "reject") return err(400, MSG.badRequest);
      if (booking.depositAmount <= 0) return err(404, MSG.noDeposit);
      const allowed =
        booking.status === "pending" &&
        (decision === "confirm"
          ? OPEN_STATES.includes(booking.depositStatus)
          : booking.depositStatus === "pending" || booking.depositStatus === "submitted");
      if (!allowed) return err(409, MSG.depositClosed);
      await deps.db.decideDeposit(booking.id, decision === "confirm" ? "paid" : "rejected");
      await deps.db.enqueueCustomerPush(
        booking.id,
        decision === "confirm" ? "deposit_confirmed" : "deposit_rejected",
      );
      const fresh = await deps.db.getBooking(booking.id);
      return json(200, { booking: fresh });
    },

    /** GET /shops/:shopId/admin/settings */
    async adminGetSettings(shopId: string): Promise<Response> {
      const pay = await deps.db.getShopPayment(shopId);
      if (!pay) return err(404, MSG.notFound);
      return json(200, pay);
    },

    /** POST /shops/:shopId/admin/settings   { promptPayId: string|null, depositTimeoutHours: int|null } */
    async adminSaveSettings(req: Request, shopId: string): Promise<Response> {
      const body = await readJson(req);
      if (!body) return err(400, MSG.badRequest);
      const rawId = body.promptPayId;
      const hours = body.depositTimeoutHours;
      let promptPayId: string | null = null;
      if (rawId != null && rawId !== "") {
        if (typeof rawId !== "string") return err(400, MSG.badRequest);
        try {
          normalizePromptPayId(rawId);
        } catch {
          return err(400, MSG.promptPayBad);
        }
        promptPayId = rawId.trim();
      }
      let depositTimeoutHours: number | null = null;
      if (hours != null) {
        if (
          typeof hours !== "number" ||
          !Number.isInteger(hours) ||
          hours < 1 ||
          hours > MAX_TIMEOUT_HOURS
        ) {
          return err(400, MSG.badRequest);
        }
        depositTimeoutHours = hours;
      }
      if (!(await deps.db.getShopPayment(shopId))) return err(404, MSG.notFound);
      await deps.db.updateShopPayment(shopId, { promptPayId, depositTimeoutHours });
      return json(200, { promptPayId, depositTimeoutHours });
    },
  };
}
