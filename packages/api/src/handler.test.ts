import { describe, expect, it, vi } from "vitest";
import type { Service, Staff } from "@kms/core";
import { createHandler, MSG } from "./handler.js";
import { createLineVerifier } from "./line-verify.js";
import type { BookingRecord, Db, InsertResult } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SVC = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333331";
const B = "33333333-3333-4333-8333-333333333332";
const BK = "44444444-4444-4444-8444-444444444444";
// 2026-12-07 is a Monday. "now" is the day before, so all slots are in the future.
const NOW = Date.parse("2026-12-06T09:00:00+07:00");
const DAY = "2026-12-07";
const slot = (hhmm: string) => `${DAY}T${hhmm}:00+07:00`;

const service: Service = {
  id: SVC,
  shopId: SHOP,
  name: "ตัดผม",
  durationMin: 30,
  price: 300,
  deposit: 0,
};
const staff: Staff[] = [
  { id: A, shopId: SHOP, name: "เอ" },
  { id: B, shopId: SHOP, name: "บี" },
];

function makeDb(over: Partial<Db> = {}): Db {
  const record: BookingRecord = {
    id: BK,
    shopId: SHOP,
    staffId: A,
    serviceId: SVC,
    customerLineUserId: "U1",
    start: slot("10:00"),
    end: slot("10:30"),
    status: "confirmed",
    depositStatus: "none",
    depositAmount: 0,
  };
  return {
    listServices: async () => [service],
    listStaff: async () => staff,
    getService: async (_s, id) => (id === SVC ? service : null),
    getDayData: async (_s, ids) => ({
      workingHours: ids.map((staffId) => ({ staffId, weekday: 1, start: "10:00", end: "11:00" })),
      timeOff: [],
      bookings: [],
    }),
    upsertCustomer: async () => "cust-1",
    insertBooking: async (i): Promise<InsertResult> => ({
      ok: true,
      booking: { ...record, staffId: i.staffId, start: i.start, end: i.end },
    }),
    getBooking: async (id) => (id === BK ? record : null),
    cancelBooking: async () => {},
    listCustomerBookings: async () => [],
    getShopOwner: async () => "UOWNER",
    createPhoneCustomer: async () => "cust-phone",
    listSchedule: async () => ({ staff, bookings: [], timeOff: [] }),
    insertTimeOff: async (i) => ({
      id: "to-1",
      staffId: i.staffId,
      start: i.start,
      end: i.end,
      reason: i.reason,
    }),
    getShopPayment: async () => ({ promptPayId: null, depositTimeoutHours: null }),
    updateShopPayment: async () => {},
    saveSlip: async () => {},
    getSlip: async () => null,
    decideDeposit: async () => {},
    enqueueCustomerPush: async () => {},
    getShopName: async () => "ร้านทดสอบ",
    exportCustomers: async () => [],
    exportBookings: async () => [],
    deleteShop: async () => {},
    ...over,
  };
}

function setup(
  db: Db = makeDb(),
  user: { userId: string; displayName: string } | null = { userId: "U1", displayName: "สมชาย" },
) {
  const verifyIdToken = vi.fn(async (t: string) => (t === "good" ? user : null));
  const handler = createHandler({ db, verifyIdToken, now: () => NOW });
  return { handler, verifyIdToken };
}

const get = (path: string) => new Request(`https://x.test/api${path}`);
const post = (path: string, body?: unknown, token: string | null = "good") =>
  new Request(`https://x.test/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("read endpoints", () => {
  it("lists services and staff without auth", async () => {
    const { handler } = setup();
    const s = await handler(get(`/shops/${SHOP}/services`));
    expect(s.status).toBe(200);
    expect((await s.json()).services).toHaveLength(1);
    const st = await handler(get(`/shops/${SHOP}/staff`));
    expect((await st.json()).staff).toHaveLength(2);
  });

  it("returns free slots using core (any staff)", async () => {
    const { handler } = setup();
    const r = await handler(get(`/shops/${SHOP}/slots?serviceId=${SVC}&date=${DAY}`));
    expect(r.status).toBe(200);
    const { slots } = await r.json();
    expect(slots.map((s: { start: string }) => s.start.slice(11, 16))).toEqual(["10:00", "10:30"]);
    expect(slots[0].staffIds.sort()).toEqual([A, B].sort());
  });

  it("hides slots taken by an existing booking", async () => {
    const db = makeDb({
      getDayData: async (_s, ids) => ({
        workingHours: ids.map((staffId) => ({ staffId, weekday: 1, start: "10:00", end: "11:00" })),
        timeOff: [],
        bookings: [
          {
            id: "b",
            staffId: A,
            serviceId: SVC,
            start: slot("10:00"),
            end: slot("10:30"),
            status: "confirmed",
          },
        ],
      }),
    });
    const { handler } = setup(db);
    const r = await handler(get(`/shops/${SHOP}/slots?serviceId=${SVC}&date=${DAY}&staffId=${A}`));
    expect((await r.json()).slots.map((s: { start: string }) => s.start.slice(11, 16))).toEqual([
      "10:30",
    ]);
  });

  it("400 on bad date, 404 on unknown service/route", async () => {
    const { handler } = setup();
    expect((await handler(get(`/shops/${SHOP}/slots?serviceId=${SVC}&date=nope`))).status).toBe(
      400,
    );
    const other = "55555555-5555-4555-8555-555555555555";
    expect((await handler(get(`/shops/${SHOP}/slots?serviceId=${other}&date=${DAY}`))).status).toBe(
      404,
    );
    expect((await handler(get(`/nothing`))).status).toBe(404);
  });

  it("answers CORS preflight", async () => {
    const { handler } = setup();
    const r = await handler(new Request("https://x.test/api/shops", { method: "OPTIONS" }));
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("create booking", () => {
  it("401 with Thai message when token missing or invalid", async () => {
    const { handler } = setup();
    const none = await handler(post(`/shops/${SHOP}/bookings`, {}, null));
    expect(none.status).toBe(401);
    expect((await none.json()).error).toBe(MSG.unauthorized);
    const bad = await handler(post(`/shops/${SHOP}/bookings`, {}, "bad"));
    expect(bad.status).toBe(401);
  });

  it("creates a booking (201) and stores the customer from the verified token", async () => {
    const upsert = vi.fn(async () => "cust-1");
    const insert = vi.fn(makeDb().insertBooking);
    const { handler } = setup(makeDb({ upsertCustomer: upsert, insertBooking: insert }));
    const r = await handler(
      post(`/shops/${SHOP}/bookings`, { serviceId: SVC, staffId: A, start: slot("10:30") }),
    );
    expect(r.status).toBe(201);
    expect(upsert).toHaveBeenCalledWith(SHOP, "U1", "สมชาย");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: A,
        customerId: "cust-1",
        start: expect.stringContaining("10:30"),
        end: expect.stringContaining("11:00"),
      }),
    );
  });

  it("returns 409 with the Thai conflict message when the DB constraint rejects", async () => {
    const { handler } = setup(
      makeDb({ insertBooking: async () => ({ ok: false, reason: "conflict" }) }),
    );
    const r = await handler(
      post(`/shops/${SHOP}/bookings`, { serviceId: SVC, staffId: A, start: slot("10:00") }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่");
  });

  it("any staff: falls through to the next staff when the first conflicts", async () => {
    const insert = vi.fn(
      async (i: { staffId: string }): Promise<InsertResult> =>
        i.staffId === A
          ? { ok: false, reason: "conflict" }
          : await makeDb().insertBooking(i as never),
    );
    const { handler } = setup(makeDb({ insertBooking: insert as Db["insertBooking"] }));
    const r = await handler(
      post(`/shops/${SHOP}/bookings`, { serviceId: SVC, start: slot("10:00") }),
    );
    expect(r.status).toBe(201);
    expect(insert).toHaveBeenCalledTimes(2);
    expect((await r.json()).booking.staffId).toBe(B);
  });

  it("any staff: 409 when every staff conflicts", async () => {
    const { handler } = setup(
      makeDb({ insertBooking: async () => ({ ok: false, reason: "conflict" }) }),
    );
    const r = await handler(
      post(`/shops/${SHOP}/bookings`, { serviceId: SVC, start: slot("10:00") }),
    );
    expect(r.status).toBe(409);
  });

  it("422 outside working hours, 422 in the past, 400 on bad body", async () => {
    const { handler } = setup();
    const out = await handler(
      post(`/shops/${SHOP}/bookings`, { serviceId: SVC, staffId: A, start: slot("15:00") }),
    );
    expect(out.status).toBe(422);
    expect((await out.json()).error).toBe(MSG.notOpen);
    const past = await handler(
      post(`/shops/${SHOP}/bookings`, {
        serviceId: SVC,
        staffId: A,
        start: "2026-12-01T10:00:00+07:00",
      }),
    );
    expect(past.status).toBe(422);
    expect((await past.json()).error).toBe(MSG.past);
    expect((await handler(post(`/shops/${SHOP}/bookings`, { serviceId: "x" }))).status).toBe(400);
  });

  it("500 with Thai message on unexpected errors", async () => {
    const { handler } = setup(
      makeDb({
        listServices: async () => {
          throw new Error("boom");
        },
      }),
    );
    const r = await handler(get(`/shops/${SHOP}/services`));
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe(MSG.server);
  });
});

describe("cancel booking", () => {
  it("cancels the caller's own booking", async () => {
    const cancel = vi.fn(async () => {});
    const { handler } = setup(makeDb({ cancelBooking: cancel }));
    const r = await handler(post(`/bookings/${BK}/cancel`));
    expect(r.status).toBe(200);
    expect((await r.json()).booking.status).toBe("cancelled");
    expect(cancel).toHaveBeenCalledWith(BK);
  });

  it("404 for someone else's booking, never cancels", async () => {
    const cancel = vi.fn(async () => {});
    const { handler } = setup(makeDb({ cancelBooking: cancel }), {
      userId: "U2",
      displayName: "คนอื่น",
    });
    const r = await handler(post(`/bookings/${BK}/cancel`));
    expect(r.status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("401 without a valid token; idempotent when already cancelled", async () => {
    const { handler } = setup();
    expect((await handler(post(`/bookings/${BK}/cancel`, undefined, "bad"))).status).toBe(401);
    const cancel = vi.fn(async () => {});
    const db = makeDb({
      cancelBooking: cancel,
      getBooking: async () => ({
        id: BK,
        shopId: SHOP,
        staffId: A,
        serviceId: SVC,
        customerLineUserId: "U1",
        start: slot("10:00"),
        end: slot("10:30"),
        status: "cancelled",
        depositStatus: "none",
        depositAmount: 0,
      }),
    });
    const r = await setup(db).handler(post(`/bookings/${BK}/cancel`));
    expect(r.status).toBe(200);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("GET /shops/:id/my-bookings (T21)", () => {
  const getMine = (token?: string) =>
    new Request(`https://x.test/shops/${SHOP}/my-bookings`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  it("401 without a valid token", async () => {
    const { handler } = setup();
    expect((await handler(getMine())).status).toBe(401);
    expect((await handler(getMine("bad"))).status).toBe(401);
  });

  it("returns only the caller's upcoming bookings, queried by LINE user id and now", async () => {
    const list = vi.fn(async () => [
      {
        id: BK,
        serviceName: "ตัดผม",
        staffName: "เอ",
        start: slot("10:00"),
        end: slot("10:30"),
        status: "confirmed" as const,
        depositStatus: "none" as const,
        depositAmount: 0,
      },
    ]);
    const { handler } = setup(makeDb({ listCustomerBookings: list }));
    const r = await handler(getMine("good"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { bookings: { id: string }[] };
    expect(body.bookings.map((b) => b.id)).toEqual([BK]);
    expect(list).toHaveBeenCalledWith(SHOP, "U1", expect.stringMatching(/\+07:00$/));
  });
});

describe("createLineVerifier", () => {
  it("returns the user for a valid token and sends channel id", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ sub: "U9", name: "แมว" }) }));
    const v = createLineVerifier("1234", f);
    expect(await v("tok")).toEqual({ userId: "U9", displayName: "แมว" });
    const init = (f.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect(init.body).toContain("client_id=1234");
    expect(init.body).toContain("id_token=tok");
  });

  it("returns null on rejection, missing sub, or network error", async () => {
    expect(
      await createLineVerifier("1", async () => ({ ok: false, json: async () => ({}) }))("t"),
    ).toBeNull();
    expect(
      await createLineVerifier("1", async () => ({ ok: true, json: async () => ({}) }))("t"),
    ).toBeNull();
    expect(
      await createLineVerifier("1", async () => {
        throw new Error("net");
      })("t"),
    ).toBeNull();
  });
});
