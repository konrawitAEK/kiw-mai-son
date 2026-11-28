import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import coreSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";
import depositSql from "../../../supabase/migrations/20261128020000_deposits.sql?raw";

let db: PGlite;
let n = 0;

interface Ctx {
  shop: string;
  svc: string;
  staff: string;
  cust: string;
}

async function newShop(timeoutHours: number | null): Promise<Ctx> {
  const id = async (sql: string, p: unknown[]) =>
    (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const shop = await id(
    `insert into shops (name, owner_line_user_id, deposit_timeout_hours) values ('ร้าน','Uo',$1) returning id`,
    [timeoutHours],
  );
  return {
    shop,
    svc: await id(
      `insert into services (shop_id, name, duration_min, price, deposit) values ($1,'ทำสี',60,1800,300) returning id`,
      [shop],
    ),
    staff: await id(`insert into staff (shop_id, name) values ($1,'ช่าง') returning id`, [shop]),
    cust: await id(
      `insert into customers (shop_id, display_name) values ($1,'ลูกค้า') returning id`,
      [shop],
    ),
  };
}

const T0 = "2026-12-01T00:00:00Z"; // created_at of every booking below

/** Own hour-long slot per booking so the exclusion constraint never interferes. */
async function book(c: Ctx, status: string, deposit: string, amount = 300, createdAt = T0) {
  const start = new Date(Date.parse("2026-12-20T00:00:00Z") + ++n * 3600_000).toISOString();
  const end = new Date(Date.parse(start) + 3600_000).toISOString();
  return (
    await db.query<{ id: string }>(
      `insert into bookings (shop_id, staff_id, service_id, customer_id, during, status, deposit_status,
                             deposit_amount, channel, created_at)
       values ($1,$2,$3,$4,tstzrange($5,$6,'[)'),$7,$8,$9,'line',$10) returning id`,
      [c.shop, c.staff, c.svc, c.cust, start, end, status, deposit, amount, createdAt],
    )
  ).rows[0]!.id;
}
const statusOf = async (id: string) =>
  (await db.query<{ status: string }>(`select status from bookings where id=$1`, [id])).rows[0]!
    .status;
const sweep = async (at: string) =>
  (
    await db.query<{ cancel_unpaid_deposits: string }>(`select cancel_unpaid_deposits($1)`, [at])
  ).rows.map((r) => r.cancel_unpaid_deposits);

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(coreSql);
  await db.exec(depositSql);
});

describe("deposits migration: schema", () => {
  it("amount and status must agree (no deposit <=> status none)", async () => {
    const c = await newShop(null);
    await expect(book(c, "pending", "pending", 0)).rejects.toThrow();
    await expect(book(c, "confirmed", "none", 300)).rejects.toThrow();
    await expect(book(c, "pending", "submitted", 300)).resolves.toBeTruthy();
  });

  it("accepts the new 'submitted' status but still rejects unknown ones", async () => {
    const c = await newShop(null);
    await expect(book(c, "pending", "weird", 300)).rejects.toThrow();
  });

  it("PromptPay ID and timeout hours are validated", async () => {
    const c = await newShop(null);
    const upd = (col: string, v: unknown) =>
      db.query(`update shops set ${col} = $1 where id = $2`, [v, c.shop]);
    await expect(upd("promptpay_id", "0812345678")).resolves.toBeTruthy();
    await expect(upd("promptpay_id", "abc")).rejects.toThrow();
    await expect(upd("deposit_timeout_hours", 0)).rejects.toThrow();
    await expect(upd("deposit_timeout_hours", 721)).rejects.toThrow();
    await expect(upd("deposit_timeout_hours", 24)).resolves.toBeTruthy();
  });

  it("slips accept images up to 2 MB only", async () => {
    const c = await newShop(null);
    const id = await book(c, "pending", "pending");
    const ins = (type: string, bytes: number) =>
      db.query(`insert into deposit_slips (booking_id, content_type, data) values ($1,$2,$3)`, [
        id,
        type,
        new Uint8Array(bytes).fill(1),
      ]);
    await expect(ins("text/html", 10)).rejects.toThrow();
    await expect(ins("image/jpeg", 2 * 1024 * 1024 + 1)).rejects.toThrow();
    await expect(ins("image/jpeg", 100)).resolves.toBeTruthy();
  });
});

describe("cancel_unpaid_deposits", () => {
  it("does nothing when the shop has no timeout (default off)", async () => {
    const c = await newShop(null);
    const id = await book(c, "pending", "pending");
    expect(await sweep("2027-06-01T00:00:00Z")).not.toContain(id);
    expect(await statusOf(id)).toBe("pending");
  });

  it("cancels unpaid (pending / rejected) bookings only after N hours", async () => {
    const c = await newShop(24);
    const unpaid = await book(c, "pending", "pending");
    const rejected = await book(c, "pending", "rejected");
    expect(await sweep("2026-12-01T23:59:00Z")).toEqual([]);
    expect(await statusOf(unpaid)).toBe("pending");
    const done = await sweep("2026-12-02T00:00:00Z");
    expect(done.sort()).toEqual([unpaid, rejected].sort());
    expect(await statusOf(unpaid)).toBe("cancelled");
    expect(await statusOf(rejected)).toBe("cancelled");
  });

  it("never cancels a slip waiting for the owner, a paid deposit, or a booking without deposit", async () => {
    const c = await newShop(1);
    const submitted = await book(c, "pending", "submitted");
    const paid = await book(c, "confirmed", "paid");
    const owner = await book(c, "confirmed", "none", 0);
    expect(await sweep("2027-06-01T00:00:00Z")).toEqual([]);
    expect(await statusOf(submitted)).toBe("pending");
    expect(await statusOf(paid)).toBe("confirmed");
    expect(await statusOf(owner)).toBe("confirmed");
  });

  it("respects each shop's own setting", async () => {
    const fast = await newShop(2);
    const off = await newShop(null);
    const a = await book(fast, "pending", "pending");
    const b = await book(off, "pending", "pending");
    await sweep("2026-12-01T03:00:00Z");
    expect(await statusOf(a)).toBe("cancelled");
    expect(await statusOf(b)).toBe("pending");
  });

  it("frees the slot: the same time can be booked again after the auto-cancel", async () => {
    const c = await newShop(1);
    const during = "[2027-01-05 03:00+00,2027-01-05 04:00+00)";
    const ins = () =>
      db.query(
        `insert into bookings (shop_id, staff_id, service_id, customer_id, during, status, deposit_status,
                               deposit_amount, channel, created_at)
         values ($1,$2,$3,$4,$5::tstzrange,'pending','pending',300,'line',$6)`,
        [c.shop, c.staff, c.svc, c.cust, during, T0],
      );
    await ins();
    await expect(ins()).rejects.toThrow(); // held while pending
    await sweep("2026-12-01T02:00:00Z");
    await expect(ins()).resolves.toBeTruthy();
  });
});
