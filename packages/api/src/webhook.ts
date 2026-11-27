import {
  BOOKING_NOT_FOUND_TEXT,
  REMINDER_CONFIRM_REPLY,
  REMINDER_RESCHEDULE_REPLY,
  bookingConfirmationText,
  parseReminderPostback,
} from "@kms/core";
import type { Db } from "./types.js";

/** A shop's LINE channel, already decrypted by the caller (secrets never logged or stored in plain text). */
export interface ChannelInfo {
  shopId: string;
  shopName: string;
  channelSecret: string;
  channelAccessToken: string;
}

export interface WebhookDeps {
  db: Pick<Db, "getBooking" | "getService" | "listStaff">;
  /** Route by the webhook `destination` (LINE bot user id) to a shop's channel; null if unknown. */
  getChannelByDestination(destination: string): Promise<ChannelInfo | null>;
  /** Reply API (never push). */
  reply(
    accessToken: string,
    replyToken: string,
    messages: { type: "text"; text: string }[],
  ): Promise<void>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Text the LIFF page sends from the customer after booking (liff.sendMessages). */
const CONFIRM_RE = new RegExp(`^ยืนยันการจอง\\s+(${UUID.source})$`, "i");

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Verifies `X-Line-Signature` (base64 HMAC-SHA256 of the raw body with the channel secret). Constant-time. */
export async function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  const sig = base64ToBytes(signature);
  if (!sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(rawBody));
}

interface LineEvent {
  type?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
}

function res(status: number, body: string): Response {
  return new Response(body, { status });
}

/**
 * Handler for the `line-webhook` Edge Function. Order: parse destination -> find shop channel ->
 * verify signature with THAT shop's secret -> handle events. Always 200 once the signature is valid
 * (so LINE does not retry-storm); per-event failures are swallowed.
 */
export function createWebhookHandler(deps: WebhookDeps): (req: Request) => Promise<Response> {
  async function handlePostback(channel: ChannelInfo, ev: LineEvent) {
    const pb = parseReminderPostback(ev.postback?.data ?? "");
    if (!pb || !ev.replyToken) return;
    const booking = await deps.db.getBooking(pb.bookingId);
    const userId = ev.source?.userId;
    const text =
      !booking ||
      booking.status === "cancelled" ||
      booking.shopId !== channel.shopId ||
      !userId ||
      booking.customerLineUserId !== userId
        ? BOOKING_NOT_FOUND_TEXT
        : pb.action === "confirm"
          ? REMINDER_CONFIRM_REPLY
          : REMINDER_RESCHEDULE_REPLY;
    await deps.reply(channel.channelAccessToken, ev.replyToken, [{ type: "text", text }]);
  }

  async function handleEvent(channel: ChannelInfo, ev: LineEvent) {
    if (ev.type === "postback") return handlePostback(channel, ev);
    if (ev.type !== "message" || ev.message?.type !== "text" || !ev.replyToken) return;
    const m = CONFIRM_RE.exec((ev.message.text ?? "").trim());
    if (!m || !m[1]) return;
    const send = (text: string) =>
      deps.reply(channel.channelAccessToken, ev.replyToken as string, [{ type: "text", text }]);

    const booking = await deps.db.getBooking(m[1]);
    const userId = ev.source?.userId;
    // Only the customer who made the booking, in this shop, gets the details.
    if (
      !booking ||
      booking.status === "cancelled" ||
      booking.shopId !== channel.shopId ||
      !userId ||
      booking.customerLineUserId !== userId
    ) {
      await send(BOOKING_NOT_FOUND_TEXT);
      return;
    }
    const [service, staff] = await Promise.all([
      deps.db.getService(channel.shopId, booking.serviceId),
      deps.db.listStaff(channel.shopId),
    ]);
    await send(
      bookingConfirmationText({
        shopName: channel.shopName,
        serviceName: service?.name ?? "-",
        staffName: staff.find((s) => s.id === booking.staffId)?.name ?? "-",
        start: booking.start,
        price: service?.price ?? 0,
      }),
    );
  }

  return async (req) => {
    if (req.method !== "POST") return res(405, "method not allowed");
    const raw = await req.text();
    let body: { destination?: unknown; events?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return res(400, "bad request");
    }
    if (typeof body.destination !== "string" || body.destination === "")
      return res(400, "bad request");

    const channel = await deps.getChannelByDestination(body.destination);
    if (!channel) return res(404, "unknown destination");
    if (
      !(await verifyLineSignature(channel.channelSecret, raw, req.headers.get("x-line-signature")))
    ) {
      return res(401, "invalid signature");
    }

    const events = Array.isArray(body.events) ? (body.events as LineEvent[]) : [];
    for (const ev of events) {
      try {
        await handleEvent(channel, ev);
      } catch {
        // swallow: a failing event must not make LINE retry the whole batch
      }
    }
    return res(200, "ok");
  };
}

/** LINE reply API. `fetchFn` injectable for tests. */
export function createLineReply(fetchFn: typeof fetch = fetch): WebhookDeps["reply"] {
  return async (accessToken, replyToken, messages) => {
    const r = await fetchFn("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!r.ok) throw new Error(`LINE reply failed: ${r.status}`);
  };
}
