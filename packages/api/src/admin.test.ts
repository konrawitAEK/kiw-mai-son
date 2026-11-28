import { describe, expect, it, vi } from "vitest";
import type { Service, Staff } from "@kms/core";
import { createHandler, MSG } from "./handler.js";
import type { BookingRecord, Db, InsertResult } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP = "11111111-1111-4111-8111-111111111112";
const SVC = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333331";
const BK = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-12-06T09:00:00+07:00");

const service: Service = {
  id: SVC,
  shopId: SHOP,
  name: "ตัดผม",
  durationMin: 45,
  price: 300,
  deposit: 0,
};
const staff: Staff[] = [{ id: A, shopId: SHOP, name: "เอ" }];
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

function makeDb(over: Partial<Db> = {}): Db {
  return {
    listServices: async () => [service],
    listStaff: async () => staff,
    getService: async (_s, id) => (id === SVC ? service : null),
    getDayData: async () => ({ workingHours: [], timeOff: [], bookings: [] }),
    upsertCustomer: async () => "cust-1",
    insertBooking: vi.fn(
      async (i): Promise<InsertResult> => ({
        ok: true,
        booking: { ...record, start: i.start, end: i.end, customerLineUserId: null },
      }),
    ),
    getBooking: async (id) => (id === BK ? record : null),
    cancelBooking: vi.fn(async () => {}),
    getShopOwner: async (id) => (id === SHOP ? "UOWNER" : null),
    createPhoneCustomer: vi.fn(async () => "cust-phone"),
    listSchedule: vi.fn(async () => ({ staff, bookings: [], timeOff: [] })),
    insertTimeOff: vi.fn(async (i) => ({ id: "to-1", ...i })),
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

const USERS: Record<string, { userId: string; displayName: string }> = {
  owner: { userId: "UOWNER", displayName: "เจ้าของ" },
  customer: { userId: "U1", displayName: "ลูกค้า" },
};
function setup(db: Db = makeDb()) {
  const handler = createHandler({
    db,
    verifyIdToken: async (t) => USERS[t] ?? null,
    now: () => NOW,
  });
  return { handler, db };
}
const req = (method: string, path: string, token: string | null, body?: unknown) =>
  new Request(`https://x.test/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const base = `/shops/${SHOP}/admin`;

describe("owner-only access control", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", `${base}/schedule?from=2026-12-07`],
    ["POST", `${base}/bookings`, {}],
    ["POST", `${base}/bookings/${BK}/cancel`],
    ["POST", `${base}/time-off`, {}],
  ];

  it.each(routes)("%s %s without a token -> 401", async (method, path, body) => {
    const { handler } = setup();
    const r = await handler(req(method, path, null, body));
    expect(r.status).toBe(401);
  });

  it.each(routes)("%s %s with an invalid token -> 401", async (method, path, body) => {
    const { handler } = setup();
    const r = await handler(req(method, path, "bogus", body));
    expect(r.status).toBe(401);
  });

  it.each(routes)("%s %s as a non-owner customer -> 403, no data touched", async (m, p, body) => {
    const { handler, db } = setup();
    const r = await handler(req(m, p, "customer", body));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe(MSG.forbidden);
    expect(db.listSchedule).not.toHaveBeenCalled();
    expect(db.insertBooking).not.toHaveBeenCalled();
    expect(db.cancelBooking).not.toHaveBeenCalled();
    expect(db.insertTimeOff).not.toHaveBeenCalled();
  });

  it("the owner of one shop is a stranger to another shop", async () => {
    const { handler } = setup(makeDb({ getShopOwner: async () => "USOMEONEELSE" }));
    const r = await handler(
      req("GET", `/shops/${OTHER_SHOP}/admin/schedule?from=2026-12-07`, "owner"),
    );
    expect(r.status).toBe(403);
  });

  it("unknown shop -> 403 (does not reveal existence)", async () => {
    const { handler } = setup();
    const r = await handler(
      req("GET", `/shops/${OTHER_SHOP}/admin/schedule?from=2026-12-07`, "owner"),
    );
    expect(r.status).toBe(403);
  });
});

describe("GET admin/schedule", () => {
  it("returns the schedule for a Bangkok day window", async () => {
    const { handler, db } = setup();
    const r = await handler(req("GET", `${base}/schedule?from=2026-12-07`, "owner"));
    expect(r.status).toBe(200);
    expect((await r.json()).staff).toHaveLength(1);
    expect(db.listSchedule).toHaveBeenCalledWith(
      SHOP,
      "2026-12-07T00:00:00.000+07:00",
      "2026-12-08T00:00:00.000+07:00",
    );
  });

  it("supports a 7-day week window and rejects bad params", async () => {
    const { handler, db } = setup();
    expect(
      (await handler(req("GET", `${base}/schedule?from=2026-12-07&days=7`, "owner"))).status,
    ).toBe(200);
    expect(db.listSchedule).toHaveBeenCalledWith(
      SHOP,
      "2026-12-07T00:00:00.000+07:00",
      "2026-12-14T00:00:00.000+07:00",
    );
    for (const q of ["from=nope", "from=2026-12-07&days=8", "from=2026-12-07&days=0", ""]) {
      expect((await handler(req("GET", `${base}/schedule?${q}`, "owner"))).status).toBe(400);
    }
  });
});

describe("POST admin/bookings (phone customer)", () => {
  const body = {
    serviceId: SVC,
    staffId: A,
    start: "2026-12-07T14:00:00+07:00",
    customerName: " คุณสมศรี ",
    phone: "081-234-5678",
  };

  it("creates an owner-channel booking with service duration and a phone customer", async () => {
    const { handler, db } = setup();
    const r = await handler(req("POST", `${base}/bookings`, "owner", body));
    expect(r.status).toBe(201);
    expect(db.createPhoneCustomer).toHaveBeenCalledWith(SHOP, "คุณสมศรี", "081-234-5678");
    expect(db.insertBooking).toHaveBeenCalledWith({
      shopId: SHOP,
      staffId: A,
      serviceId: SVC,
      customerId: "cust-phone",
      start: "2026-12-07T14:00:00.000+07:00",
      end: "2026-12-07T14:45:00.000+07:00",
      channel: "owner",
    });
  });

  it("phone is optional", async () => {
    const { handler, db } = setup();
    const noPhone: Partial<typeof body> = { ...body };
    delete noPhone.phone;
    const r = await handler(req("POST", `${base}/bookings`, "owner", noPhone));
    expect(r.status).toBe(201);
    expect(db.createPhoneCustomer).toHaveBeenCalledWith(SHOP, "คุณสมศรี", null);
  });

  it("returns 409 with the Thai message on an overlap", async () => {
    const { handler } = setup(
      makeDb({ insertBooking: async () => ({ ok: false, reason: "conflict" }) }),
    );
    const r = await handler(req("POST", `${base}/bookings`, "owner", body));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe(MSG.conflict);
  });

  it("validates input", async () => {
    const { handler, db } = setup();
    const bad = [
      { ...body, customerName: "  " },
      { ...body, phone: "abc" },
      { ...body, start: "nope" },
      { ...body, serviceId: "x" },
      { ...body, staffId: undefined },
    ];
    for (const b of bad) {
      expect((await handler(req("POST", `${base}/bookings`, "owner", b))).status).toBe(400);
    }
    expect(db.insertBooking).not.toHaveBeenCalled();
  });

  it("404 for a service or staff that is not in this shop", async () => {
    const { handler } = setup();
    const r1 = await handler(
      req("POST", `${base}/bookings`, "owner", {
        ...body,
        serviceId: "22222222-2222-4222-8222-222222222299",
      }),
    );
    expect(r1.status).toBe(404);
    const r2 = await handler(
      req("POST", `${base}/bookings`, "owner", {
        ...body,
        staffId: "33333333-3333-4333-8333-333333333399",
      }),
    );
    expect(r2.status).toBe(404);
  });
});

describe("POST admin/bookings/:id/cancel", () => {
  it("cancels a booking of this shop (even a customer's)", async () => {
    const { handler, db } = setup();
    const r = await handler(req("POST", `${base}/bookings/${BK}/cancel`, "owner"));
    expect(r.status).toBe(200);
    expect((await r.json()).booking.status).toBe("cancelled");
    expect(db.cancelBooking).toHaveBeenCalledWith(BK);
  });

  it("404 for a booking that belongs to another shop", async () => {
    const { handler, db } = setup(
      makeDb({ getBooking: async () => ({ ...record, shopId: OTHER_SHOP }) }),
    );
    const r = await handler(req("POST", `${base}/bookings/${BK}/cancel`, "owner"));
    expect(r.status).toBe(404);
    expect(db.cancelBooking).not.toHaveBeenCalled();
  });

  it("404 for unknown or malformed ids; idempotent when already cancelled", async () => {
    const { handler, db } = setup(
      makeDb({ getBooking: async (id) => (id === BK ? { ...record, status: "cancelled" } : null) }),
    );
    expect((await handler(req("POST", `${base}/bookings/not-a-uuid/cancel`, "owner"))).status).toBe(
      404,
    );
    expect((await handler(req("POST", `${base}/bookings/${BK}/cancel`, "owner"))).status).toBe(200);
    expect(db.cancelBooking).not.toHaveBeenCalled();
  });
});

describe("POST admin/time-off", () => {
  it("blocks time for one staff member", async () => {
    const { handler, db } = setup();
    const r = await handler(
      req("POST", `${base}/time-off`, "owner", {
        staffId: A,
        start: "2026-12-07T12:00:00+07:00",
        end: "2026-12-07T13:00:00+07:00",
        reason: " พักกลางวัน ",
      }),
    );
    expect(r.status).toBe(201);
    expect(db.insertTimeOff).toHaveBeenCalledWith({
      shopId: SHOP,
      staffId: A,
      start: "2026-12-07T12:00:00.000+07:00",
      end: "2026-12-07T13:00:00.000+07:00",
      reason: "พักกลางวัน",
    });
  });

  it("staffId null blocks the whole shop; rejects end <= start and foreign staff", async () => {
    const { handler, db } = setup();
    const ok = await handler(
      req("POST", `${base}/time-off`, "owner", {
        staffId: null,
        start: "2026-12-07T12:00:00+07:00",
        end: "2026-12-07T13:00:00+07:00",
      }),
    );
    expect(ok.status).toBe(201);
    expect(db.insertTimeOff).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: null, reason: null }),
    );
    const bad = await handler(
      req("POST", `${base}/time-off`, "owner", {
        staffId: A,
        start: "2026-12-07T13:00:00+07:00",
        end: "2026-12-07T13:00:00+07:00",
      }),
    );
    expect(bad.status).toBe(400);
    const foreign = await handler(
      req("POST", `${base}/time-off`, "owner", {
        staffId: "33333333-3333-4333-8333-333333333399",
        start: "2026-12-07T12:00:00+07:00",
        end: "2026-12-07T13:00:00+07:00",
      }),
    );
    expect(foreign.status).toBe(404);
  });
});
