import { describe, expect, it } from "vitest";
import { promptPayPayload, verifyPayloadCrc } from "@kms/core";
import { createHandler } from "./handler.js";
import type { BookingRecord, Db, ShopPayment, SlipImage } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP = "11111111-1111-4111-8111-111111111112";
const SVC = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333331";
const BK = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-12-06T09:00:00+07:00");
const START = "2026-12-07T10:00:00+07:00";
const PHONE = "0812345678";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const b64 = (d: Uint8Array) => Buffer.from(d).toString("base64");

/** Stateful in-memory Db: only what the deposit flow touches is real. */
function fakeDb(opts: { deposit: number; payment?: ShopPayment }) {
  let booking: BookingRecord | null = null;
  const slips = new Map<string, SlipImage>();
  const pushes: { id: string; kind: string }[] = [];
  let payment: ShopPayment = opts.payment ?? { promptPayId: PHONE, depositTimeoutHours: null };
  const service = {
    id: SVC,
    shopId: SHOP,
    name: "ทำสีผม",
    durationMin: 30,
    price: 1800,
    deposit: opts.deposit,
  };
  const db: Db = {
    listServices: async () => [service],
    listStaff: async () => [{ id: A, shopId: SHOP, name: "เอ" }],
    getService: async (_s, id) => (id === SVC ? service : null),
    getDayData: async (_s, ids) => ({
      workingHours: ids.map((staffId) => ({ staffId, weekday: 1, start: "10:00", end: "11:00" })),
      timeOff: [],
      bookings: [],
    }),
    upsertCustomer: async () => "cust",
    insertBooking: async (i) => {
      const dep = i.depositAmount ?? 0;
      booking = {
        id: BK,
        shopId: i.shopId,
        staffId: i.staffId,
        serviceId: i.serviceId,
        customerLineUserId: "U1",
        start: i.start,
        end: i.end,
        status: dep > 0 ? "pending" : "confirmed",
        depositStatus: dep > 0 ? "pending" : "none",
        depositAmount: dep,
      };
      return { ok: true, booking };
    },
    getBooking: async (id) => (booking && id === BK ? { ...booking } : null),
    cancelBooking: async () => {
      if (booking) booking.status = "cancelled";
    },
    listCustomerBookings: async () => [],
    getShopOwner: async (id) => (id === SHOP ? "UOWNER" : null),
    createPhoneCustomer: async () => "c",
    listSchedule: async () => ({ staff: [], bookings: [], timeOff: [] }),
    insertTimeOff: async () => {
      throw new Error("unused");
    },
    getShopPayment: async (id) => (id === SHOP ? payment : null),
    updateShopPayment: async (_id, p) => {
      payment = p;
    },
    saveSlip: async (id, slip) => {
      slips.set(id, slip);
      if (booking) booking.depositStatus = "submitted";
    },
    getSlip: async (id) => slips.get(id) ?? null,
    decideDeposit: async (_id, d) => {
      if (!booking) return;
      if (d === "paid") {
        booking.status = "confirmed";
        booking.depositStatus = "paid";
      } else booking.depositStatus = "rejected";
    },
    enqueueCustomerPush: async (id, kind) => {
      pushes.push({ id, kind });
    },
    getShopName: async () => "ร้านทดสอบ",
    exportCustomers: async () => [],
    exportBookings: async () => [],
    deleteShop: async () => {},
  };
  return { db, state: () => booking, slips, pushes, payment: () => payment };
}

function setup(opts: { deposit: number; payment?: ShopPayment }) {
  const f = fakeDb(opts);
  const verifyIdToken = async (t: string) =>
    t === "cust"
      ? { userId: "U1", displayName: "ลูกค้า" }
      : t === "other"
        ? { userId: "U2", displayName: "คนอื่น" }
        : t === "owner"
          ? { userId: "UOWNER", displayName: "เจ้าของ" }
          : null;
  const handler = createHandler({ db: f.db, verifyIdToken, now: () => NOW });
  const call = (method: string, path: string, token: string | null, body?: unknown) =>
    handler(
      new Request(`https://x.test/api${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { ...f, call };
}

const book = (s: ReturnType<typeof setup>) =>
  s.call("POST", `/shops/${SHOP}/bookings`, "cust", { serviceId: SVC, start: START });
const slip = (s: ReturnType<typeof setup>, token = "cust", data = JPEG, type = "image/jpeg") =>
  s.call("POST", `/bookings/${BK}/slip`, token, { contentType: type, dataBase64: b64(data) });

describe("booking with a deposit", () => {
  it("holds the slot as pending and returns the amount + a valid PromptPay QR payload", async () => {
    const s = setup({ deposit: 300 });
    const r = await book(s);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.booking.status).toBe("pending");
    expect(body.booking.depositStatus).toBe("pending");
    expect(body.deposit.amount).toBe(300);
    expect(body.deposit.status).toBe("pending");
    expect(body.deposit.promptPayPayload).toBe(promptPayPayload(PHONE, { amount: 300 }));
    expect(verifyPayloadCrc(body.deposit.promptPayPayload)).toBe(true);
    expect(body.deposit.timeoutHours).toBeNull();
    // The raw PromptPay ID never leaves the server in the booking response beyond the QR payload.
    expect(JSON.stringify(body)).not.toContain(`"promptPayId"`);
  });

  it("service without deposit: confirmed immediately, deposit null", async () => {
    const s = setup({ deposit: 0 });
    const body = await (await book(s)).json();
    expect(body.booking.status).toBe("confirmed");
    expect(body.deposit).toBeNull();
  });

  it("shop without a PromptPay ID: no QR payload (page tells the customer to contact the shop)", async () => {
    const s = setup({ deposit: 300, payment: { promptPayId: null, depositTimeoutHours: 6 } });
    const body = await (await book(s)).json();
    expect(body.deposit.promptPayPayload).toBeNull();
    expect(body.deposit.timeoutHours).toBe(6);
  });
});

describe("customer slip upload", () => {
  it("accepts a JPEG, marks the deposit submitted, and stores it", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    const r = await slip(s);
    expect(r.status).toBe(200);
    expect((await r.json()).deposit.status).toBe("submitted");
    expect(s.slips.get(BK)?.contentType).toBe("image/jpeg");
  });

  it("rejects non-images, mismatched types, bad base64 and oversize files", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    const text = new TextEncoder().encode("<script>alert(1)</script>");
    expect((await slip(s, "cust", text, "image/jpeg")).status).toBe(400);
    expect((await slip(s, "cust", PNG, "image/jpeg")).status).toBe(400);
    const bad = await s.call("POST", `/bookings/${BK}/slip`, "cust", {
      contentType: "image/png",
      dataBase64: "***",
    });
    expect(bad.status).toBe(400);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect((await slip(s, "cust", big)).status).toBe(400);
    expect(s.slips.size).toBe(0);
  });

  it("401 without token; someone else's booking looks missing", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    expect((await s.call("POST", `/bookings/${BK}/slip`, null, {})).status).toBe(401);
    expect((await slip(s, "other")).status).toBe(404);
    expect((await s.call("GET", `/bookings/${BK}/deposit`, "other")).status).toBe(404);
  });

  it("no slip for a booking without deposit; none after paid or cancelled", async () => {
    const none = setup({ deposit: 0 });
    await book(none);
    expect((await slip(none)).status).toBe(404);

    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    await s.call("POST", `/shops/${SHOP}/admin/bookings/${BK}/deposit`, "owner", {
      decision: "confirm",
    });
    expect((await slip(s)).status).toBe(409);
  });

  it("GET deposit returns the current state", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    const r = await s.call("GET", `/bookings/${BK}/deposit`, "cust");
    const body = await r.json();
    expect(body.deposit.status).toBe("submitted");
    expect(body.bookingStatus).toBe("pending");
  });
});

describe("owner confirm / reject", () => {
  const dep = (s: ReturnType<typeof setup>, decision: unknown, token: string | null = "owner") =>
    s.call("POST", `/shops/${SHOP}/admin/bookings/${BK}/deposit`, token, { decision });

  it("confirm: booking becomes confirmed + paid", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    const r = await dep(s, "confirm");
    expect(r.status).toBe(200);
    expect(s.state()).toMatchObject({ status: "confirmed", depositStatus: "paid" });
    expect(s.pushes).toEqual([{ id: BK, kind: "deposit_confirmed" }]);
  });

  it("reject: deposit rejected, booking stays pending, customer can upload again", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    expect((await dep(s, "reject")).status).toBe(200);
    expect(s.state()).toMatchObject({ status: "pending", depositStatus: "rejected" });
    expect(s.pushes).toEqual([{ id: BK, kind: "deposit_rejected" }]);
    expect((await slip(s)).status).toBe(200);
    expect(s.state()?.depositStatus).toBe("submitted");
  });

  it("owner can fetch the slip image", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    expect((await s.call("GET", `/shops/${SHOP}/admin/bookings/${BK}/slip`, "owner")).status).toBe(
      404,
    );
    await slip(s);
    const r = await s.call("GET", `/shops/${SHOP}/admin/bookings/${BK}/slip`, "owner");
    const body = await r.json();
    expect(body.contentType).toBe("image/jpeg");
    expect(body.dataBase64).toBe(b64(JPEG));
  });

  it("only the shop owner: 401 no token, 403 customer, 404 other shop's booking", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    expect((await dep(s, "confirm", null)).status).toBe(401);
    expect((await dep(s, "confirm", "cust")).status).toBe(403);
    expect((await s.call("GET", `/shops/${SHOP}/admin/bookings/${BK}/slip`, "cust")).status).toBe(
      403,
    );
    expect(s.state()?.depositStatus).toBe("submitted");
    // A booking id from another shop is not reachable through this shop's admin routes.
    const r = await s.call("POST", `/shops/${OTHER_SHOP}/admin/bookings/${BK}/deposit`, "owner", {
      decision: "confirm",
    });
    expect([403, 404]).toContain(r.status);
    expect(s.state()?.depositStatus).toBe("submitted");
  });

  it("validates the decision and refuses closed states", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    expect((await dep(s, "maybe")).status).toBe(400);
    await slip(s);
    await dep(s, "confirm");
    expect((await dep(s, "reject")).status).toBe(409);
    expect((await dep(s, "confirm")).status).toBe(409);
    expect(s.pushes).toEqual([{ id: BK, kind: "deposit_confirmed" }]); // only the first decision pushed
  });

  it("no push on a no-op: bad decision, wrong owner, or no deposit", async () => {
    const s = setup({ deposit: 300 });
    await book(s);
    await slip(s);
    await dep(s, "maybe");
    await dep(s, "confirm", null);
    await dep(s, "confirm", "cust");
    expect(s.pushes).toEqual([]);
    const none = setup({ deposit: 0 });
    await book(none);
    await dep(none, "confirm");
    expect(none.pushes).toEqual([]);
  });

  it("no deposit to decide on a booking without one", async () => {
    const s = setup({ deposit: 0 });
    await book(s);
    expect((await dep(s, "confirm")).status).toBe(404);
  });
});

describe("owner deposit settings", () => {
  const save = (s: ReturnType<typeof setup>, body: unknown, token: string | null = "owner") =>
    s.call("POST", `/shops/${SHOP}/admin/settings`, token, body);

  it("default is off: no timeout, no PromptPay ID until the owner sets one", async () => {
    const s = setup({ deposit: 300, payment: { promptPayId: null, depositTimeoutHours: null } });
    const r = await s.call("GET", `/shops/${SHOP}/admin/settings`, "owner");
    expect(await r.json()).toEqual({ promptPayId: null, depositTimeoutHours: null });
  });

  it("saves a valid PromptPay ID and timeout; clearing the timeout turns it off", async () => {
    const s = setup({ deposit: 300, payment: { promptPayId: null, depositTimeoutHours: null } });
    expect((await save(s, { promptPayId: "081-234-5678", depositTimeoutHours: 12 })).status).toBe(
      200,
    );
    expect(s.payment()).toEqual({ promptPayId: "081-234-5678", depositTimeoutHours: 12 });
    expect((await save(s, { promptPayId: "0812345678", depositTimeoutHours: null })).status).toBe(
      200,
    );
    expect(s.payment().depositTimeoutHours).toBeNull();
  });

  it("rejects an invalid PromptPay ID and out-of-range / non-integer timeouts", async () => {
    const s = setup({ deposit: 300 });
    expect((await save(s, { promptPayId: "12345", depositTimeoutHours: null })).status).toBe(400);
    expect((await save(s, { promptPayId: null, depositTimeoutHours: 0 })).status).toBe(400);
    expect((await save(s, { promptPayId: null, depositTimeoutHours: 1.5 })).status).toBe(400);
    expect((await save(s, { promptPayId: null, depositTimeoutHours: 721 })).status).toBe(400);
    expect((await save(s, { promptPayId: null, depositTimeoutHours: "6" })).status).toBe(400);
    expect(s.payment().promptPayId).toBe(PHONE);
  });

  it("owner only", async () => {
    const s = setup({ deposit: 300 });
    expect((await save(s, { promptPayId: null, depositTimeoutHours: null }, "cust")).status).toBe(
      403,
    );
    expect((await s.call("GET", `/shops/${SHOP}/admin/settings`, null)).status).toBe(401);
  });
});
