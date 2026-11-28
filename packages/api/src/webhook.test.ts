import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createLineReply, createWebhookHandler, verifyLineSignature } from "./webhook.js";
import type { ChannelInfo, WebhookDeps } from "./webhook.js";
import type { BookingRecord } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SVC = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333331";
const BK = "44444444-4444-4444-8444-444444444444";
const SECRET = "shop-secret";
const channel: ChannelInfo = {
  shopId: SHOP,
  shopName: "ร้านเดโม คิวไม่ซ้อน",
  channelSecret: SECRET,
  channelAccessToken: "tok",
};
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("base64");

const record: BookingRecord = {
  id: BK,
  shopId: SHOP,
  staffId: A,
  serviceId: SVC,
  customerLineUserId: "U1",
  start: "2026-12-07T10:00:00+07:00",
  end: "2026-12-07T10:30:00+07:00",
  status: "confirmed",
  depositStatus: "none",
  depositAmount: 0,
};

function setup(over: { booking?: BookingRecord | null; ch?: ChannelInfo | null } = {}) {
  const reply = vi.fn<WebhookDeps["reply"]>(async () => {});
  const getChannelByDestination = vi.fn(async (d: string) =>
    d === "Udest" ? (over.ch === undefined ? channel : over.ch) : null,
  );
  const handler = createWebhookHandler({
    db: {
      getBooking: async () => (over.booking === undefined ? record : over.booking),
      getService: async () => ({
        id: SVC,
        shopId: SHOP,
        name: "ตัดผม",
        durationMin: 30,
        price: 300,
        deposit: 0,
      }),
      listStaff: async () => [{ id: A, shopId: SHOP, name: "เอ" }],
    },
    getChannelByDestination,
    reply,
  });
  return { handler, reply, getChannelByDestination };
}

function req(payload: unknown, opts: { sig?: string | null; secret?: string } = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = {};
  const sig = opts.sig === undefined ? sign(raw, opts.secret) : opts.sig;
  if (sig !== null) headers["x-line-signature"] = sig;
  return new Request("https://x.test/line-webhook", { method: "POST", body: raw, headers });
}

const textEvent = (text: string, userId = "U1") => ({
  destination: "Udest",
  events: [
    {
      type: "message",
      replyToken: "rt1",
      source: { type: "user", userId },
      message: { type: "text", text },
    },
  ],
});

describe("verifyLineSignature", () => {
  it("accepts a valid signature", async () => {
    expect(await verifyLineSignature(SECRET, "{}", sign("{}"))).toBe(true);
  });
  it("rejects a wrong secret, tampered body, missing or malformed signature", async () => {
    expect(await verifyLineSignature(SECRET, "{}", sign("{}", "other"))).toBe(false);
    expect(await verifyLineSignature(SECRET, '{"a":1}', sign("{}"))).toBe(false);
    expect(await verifyLineSignature(SECRET, "{}", null)).toBe(false);
    expect(await verifyLineSignature(SECRET, "{}", "***not-base64***")).toBe(false);
    expect(await verifyLineSignature("", "{}", sign("{}", ""))).toBe(false);
  });
});

const postbackEvent = (data: string, userId = "U1") => ({
  destination: "Udest",
  events: [
    { type: "postback", replyToken: "rt1", source: { type: "user", userId }, postback: { data } },
  ],
});

describe("reminder postbacks", () => {
  it("replies to ยืนยันมา and ขอเลื่อน for the booking's own customer", async () => {
    const { handler, reply } = setup();
    await handler(req(postbackEvent(`reminder=confirm&booking=${BK}`)));
    await handler(req(postbackEvent(`reminder=reschedule&booking=${BK}`)));
    const texts = reply.mock.calls.map((c) => c[2][0]!.text);
    expect(texts[0]).toContain("ขอบคุณที่ยืนยัน");
    expect(texts[1]).toContain("แจ้งร้าน");
  });
  it("refuses other users, cancelled bookings and ignores unknown postbacks", async () => {
    const { handler, reply } = setup();
    await handler(req(postbackEvent(`reminder=confirm&booking=${BK}`, "Uother")));
    expect(reply.mock.calls[0]![2][0]!.text).toContain("ไม่พบการจอง");
    const c = setup({ booking: { ...record, status: "cancelled" } });
    await c.handler(req(postbackEvent(`reminder=confirm&booking=${BK}`)));
    expect(c.reply.mock.calls[0]![2][0]!.text).toContain("ไม่พบการจอง");
    await handler(req(postbackEvent("something=else")));
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe("webhook handler", () => {
  it("401 on invalid signature and does not reply", async () => {
    const { handler, reply } = setup();
    const r = await handler(req(textEvent(`ยืนยันการจอง ${BK}`), { secret: "wrong" }));
    expect(r.status).toBe(401);
    expect(reply).not.toHaveBeenCalled();
  });

  it("401 when the signature header is missing", async () => {
    const { handler } = setup();
    expect((await handler(req(textEvent("hi"), { sig: null }))).status).toBe(401);
  });

  it("404 on unknown destination, 400 on bad body, 405 on GET", async () => {
    const { handler } = setup();
    expect((await handler(req({ destination: "Unope", events: [] }))).status).toBe(404);
    expect((await handler(req("not json"))).status).toBe(400);
    expect((await handler(req({ events: [] }))).status).toBe(400);
    expect((await handler(new Request("https://x.test/", { method: "GET" }))).status).toBe(405);
  });

  it("routes by destination: verifies with that shop's secret", async () => {
    const { handler, getChannelByDestination } = setup();
    const r = await handler(req({ destination: "Udest", events: [] }));
    expect(r.status).toBe(200);
    expect(getChannelByDestination).toHaveBeenCalledWith("Udest");
  });

  it("replies once with the booking confirmation via reply API (snapshot)", async () => {
    const { handler, reply } = setup();
    const r = await handler(req(textEvent(`ยืนยันการจอง ${BK}`)));
    expect(r.status).toBe(200);
    expect(reply).toHaveBeenCalledTimes(1);
    const [token, replyToken, messages] = reply.mock.calls[0]!;
    expect(token).toBe("tok");
    expect(replyToken).toBe("rt1");
    expect(messages[0]!.text).toMatchInlineSnapshot(`
      "จองคิวสำเร็จแล้ว ✅
      ร้าน: ร้านเดโม คิวไม่ซ้อน
      บริการ: ตัดผม
      ช่าง: เอ
      เวลา: วันจันทร์ที่ 7 ธ.ค. 2569 เวลา 10:00 น.
      ราคา: 300 บาท
      หากต้องการเลื่อนหรือยกเลิก กรุณาแจ้งร้านล่วงหน้า"
    `);
  });

  it("does not leak another customer's booking", async () => {
    const { handler, reply } = setup();
    await handler(req(textEvent(`ยืนยันการจอง ${BK}`, "U2")));
    expect(reply.mock.calls[0]![2][0]!.text).toBe("ไม่พบการจองนี้ กรุณาตรวจสอบหรือจองใหม่อีกครั้ง");
  });

  it("not-found for missing, cancelled, or other-shop bookings", async () => {
    for (const booking of [
      null,
      { ...record, status: "cancelled" as const },
      { ...record, shopId: "99999999-9999-4999-8999-999999999999" },
    ]) {
      const { handler, reply } = setup({ booking });
      await handler(req(textEvent(`ยืนยันการจอง ${BK}`)));
      expect(reply.mock.calls[0]![2][0]!.text).toContain("ไม่พบการจองนี้");
    }
  });

  it("ignores unrelated messages and non-message events", async () => {
    const { handler, reply } = setup();
    await handler(req(textEvent("สวัสดี")));
    await handler(req({ destination: "Udest", events: [{ type: "follow", replyToken: "r" }] }));
    expect(reply).not.toHaveBeenCalled();
  });

  it("returns 200 even if the reply call fails", async () => {
    const { handler, reply } = setup();
    reply.mockRejectedValueOnce(new Error("boom"));
    expect((await handler(req(textEvent(`ยืนยันการจอง ${BK}`)))).status).toBe(200);
  });
});

describe("createLineReply", () => {
  it("POSTs to the reply endpoint with bearer token", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await createLineReply(f as unknown as typeof fetch)("tok", "rt", [{ type: "text", text: "x" }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/reply");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      replyToken: "rt",
      messages: [{ type: "text", text: "x" }],
    });
  });
  it("throws on non-2xx", async () => {
    const f = vi.fn(async () => new Response("no", { status: 400 }));
    await expect(createLineReply(f as unknown as typeof fetch)("t", "r", [])).rejects.toThrow();
  });
});
