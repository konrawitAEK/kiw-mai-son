import { describe, expect, it, vi } from "vitest";
import { createHandler } from "./handler.js";
import type { Db, ExportBooking, ExportCustomer } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const NOW = Date.parse("2026-12-06T09:00:00+07:00");

const customers: ExportCustomer[] = [
  {
    displayName: "คุณสมศรี",
    lineUserId: "U1",
    phone: null,
    createdAt: "2026-12-01T10:00:00+07:00",
  },
  {
    displayName: "=EVIL()",
    lineUserId: null,
    phone: "081-234-5678",
    createdAt: "2026-12-02T10:00:00+07:00",
  },
];
const bookings: ExportBooking[] = [
  {
    id: "b1",
    start: "2026-12-07T10:00:00+07:00",
    end: "2026-12-07T10:30:00+07:00",
    status: "confirmed",
    channel: "owner",
    serviceName: "ตัดผม, ชาย",
    staffName: "เอ",
    customerName: "คุณสมศรี",
    customerPhone: "081-234-5678",
    depositStatus: "paid",
    depositAmount: 100,
    createdAt: "2026-12-01T10:00:00+07:00",
  },
];

function setup(over: Partial<Db> = {}) {
  const db = {
    getShopOwner: async (id: string) => (id === SHOP ? "UOWNER" : null),
    getShopName: async (id: string) => (id === SHOP ? "ร้านสวย" : null),
    exportCustomers: vi.fn(async () => customers),
    exportBookings: vi.fn(async () => bookings),
    deleteShop: vi.fn(async () => {}),
    ...over,
  } as unknown as Db;
  const users: Record<string, { userId: string; displayName: string }> = {
    owner: { userId: "UOWNER", displayName: "เจ้าของ" },
    customer: { userId: "U1", displayName: "ลูกค้า" },
  };
  const handler = createHandler({
    db,
    verifyIdToken: async (t) => users[t] ?? null,
    now: () => NOW,
  });
  const req = (method: string, path: string, token: string | null, body?: unknown) =>
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
  return { db, req };
}
const base = `/shops/${SHOP}/admin`;

describe("access control (export + delete)", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", `${base}/export?kind=customers`],
    ["GET", `${base}/export?kind=bookings`],
    ["POST", `${base}/delete`, { confirmName: "ร้านสวย" }],
  ];
  it.each(routes)("%s %s without token -> 401", async (m, p, b) => {
    const { req, db } = setup();
    expect((await req(m, p, null, b)).status).toBe(401);
    expect(db.deleteShop).not.toHaveBeenCalled();
  });
  it.each(routes)("%s %s as a non-owner -> 403, nothing read or deleted", async (m, p, b) => {
    const { req, db } = setup();
    expect((await req(m, p, "customer", b)).status).toBe(403);
    expect(db.exportCustomers).not.toHaveBeenCalled();
    expect(db.exportBookings).not.toHaveBeenCalled();
    expect(db.deleteShop).not.toHaveBeenCalled();
  });
  it("owner of another shop cannot touch this shop", async () => {
    const { req, db } = setup({ getShopOwner: async () => "USOMEONEELSE" });
    expect(
      (await req("POST", `/shops/${OTHER}/admin/delete`, "owner", { confirmName: "x" })).status,
    ).toBe(403);
    expect(db.deleteShop).not.toHaveBeenCalled();
  });
});

describe("GET admin/export", () => {
  it("returns customers as a CSV download with BOM and escaped formulas", async () => {
    const { req } = setup();
    const r = await req("GET", `${base}/export?kind=customers`, "owner");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const text = await r.text();
    expect(text).toContain("คุณสมศรี,U1,,");
    expect(text).toContain("'=EVIL()");
    expect(text).toContain("081-234-5678");
  });
  it("returns bookings with quoted commas and Thai channel label", async () => {
    const { req } = setup();
    const text = await (await req("GET", `${base}/export?kind=bookings`, "owner")).text();
    expect(text).toContain('"ตัดผม, ชาย"');
    expect(text).toContain("เจ้าของร้านลงให้");
    expect(text.trimEnd().split("\r\n")).toHaveLength(2);
  });
  it("rejects an unknown kind", async () => {
    const { req } = setup();
    expect((await req("GET", `${base}/export?kind=slips`, "owner")).status).toBe(400);
    expect((await req("GET", `${base}/export`, "owner")).status).toBe(400);
  });
});

describe("POST admin/delete", () => {
  it("deletes only when the typed name matches exactly", async () => {
    const { req, db } = setup();
    const bad = await req("POST", `${base}/delete`, "owner", { confirmName: "ร้านอื่น" });
    expect(bad.status).toBe(400);
    expect(db.deleteShop).not.toHaveBeenCalled();
    const ok = await req("POST", `${base}/delete`, "owner", { confirmName: " ร้านสวย " });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deleted: true });
    expect(db.deleteShop).toHaveBeenCalledWith(SHOP);
  });
  it("rejects a missing or non-string confirmation", async () => {
    const { req, db } = setup();
    expect((await req("POST", `${base}/delete`, "owner", {})).status).toBe(400);
    expect((await req("POST", `${base}/delete`, "owner", { confirmName: 5 })).status).toBe(400);
    expect(db.deleteShop).not.toHaveBeenCalled();
  });
});
