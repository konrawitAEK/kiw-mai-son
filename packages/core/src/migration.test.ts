import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import migrationSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";

let db: PGlite;
let shopId: string;
let staffA: string;
let staffB: string;
let serviceId: string;
let customerId: string;

const range = (a: string, b: string) => `[${a}+07,${b}+07)`;

async function book(staff: string, during: string, status = "confirmed") {
  return db.query(
    `insert into bookings (shop_id, staff_id, service_id, customer_id, during, status, channel)
     values ($1,$2,$3,$4,$5::tstzrange,$6,'line') returning id`,
    [shopId, staff, serviceId, customerId, during, status],
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(migrationSql);
  shopId = (
    await db.query<{ id: string }>(
      `insert into shops (name, owner_line_user_id) values ('ร้านเดโม','Uowner') returning id`,
    )
  ).rows[0]!.id;
  const s = async (n: string) =>
    (
      await db.query<{ id: string }>(
        `insert into staff (shop_id, name) values ($1,$2) returning id`,
        [shopId, n],
      )
    ).rows[0]!.id;
  staffA = await s("A");
  staffB = await s("B");
  serviceId = (
    await db.query<{ id: string }>(
      `insert into services (shop_id, name, duration_min, price) values ($1,'ตัดผม',60,300) returning id`,
      [shopId],
    )
  ).rows[0]!.id;
  customerId = (
    await db.query<{ id: string }>(
      `insert into customers (shop_id, display_name) values ($1,'ลูกค้า') returning id`,
      [shopId],
    )
  ).rows[0]!.id;
});

describe("core tables migration", () => {
  it("creates all expected tables", async () => {
    const r = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const names = r.rows.map((x) => x.table_name);
    for (const t of [
      "shops",
      "line_channels",
      "staff",
      "services",
      "working_hours",
      "time_off",
      "customers",
      "bookings",
      "reminders_log",
      "subscriptions",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("rejects an overlapping active booking for the same staff", async () => {
    await book(staffA, range("2026-12-01 10:00", "2026-12-01 11:00"));
    await expect(book(staffA, range("2026-12-01 10:30", "2026-12-01 11:30"))).rejects.toThrow(
      /bookings_no_overlap/,
    );
  });

  it("allows back-to-back bookings (half-open ranges)", async () => {
    await expect(
      book(staffA, range("2026-12-01 11:00", "2026-12-01 12:00")),
    ).resolves.toBeDefined();
  });

  it("allows the same time for a different staff", async () => {
    await expect(
      book(staffB, range("2026-12-01 10:00", "2026-12-01 11:00")),
    ).resolves.toBeDefined();
  });

  it("cancelled bookings do not block", async () => {
    await book(staffA, range("2026-12-02 10:00", "2026-12-02 11:00"), "cancelled");
    await expect(
      book(staffA, range("2026-12-02 10:00", "2026-12-02 11:00")),
    ).resolves.toBeDefined();
  });

  it("cancelling frees the slot", async () => {
    const r = await book(staffA, range("2026-12-03 10:00", "2026-12-03 11:00"));
    await expect(book(staffA, range("2026-12-03 10:00", "2026-12-03 11:00"))).rejects.toThrow();
    await db.query(`update bookings set status='cancelled' where id=$1`, [
      (r.rows[0] as { id: string }).id,
    ]);
    await expect(
      book(staffA, range("2026-12-03 10:00", "2026-12-03 11:00")),
    ).resolves.toBeDefined();
  });

  it("rejects a booking whose staff belongs to another shop", async () => {
    const other = (
      await db.query<{ id: string }>(
        `insert into shops (name, owner_line_user_id) values ('x','U2') returning id`,
      )
    ).rows[0]!.id;
    await expect(
      db.query(
        `insert into bookings (shop_id, staff_id, service_id, customer_id, during, channel)
         values ($1,$2,$3,$4,$5::tstzrange,'owner')`,
        [other, staffA, serviceId, customerId, range("2026-12-09 10:00", "2026-12-09 11:00")],
      ),
    ).rejects.toThrow();
  });

  it("never sends the same reminder twice", async () => {
    const r = await book(staffB, range("2026-12-05 10:00", "2026-12-05 11:00"));
    const id = (r.rows[0] as { id: string }).id;
    await db.query(`insert into reminders_log (booking_id) values ($1)`, [id]);
    await expect(
      db.query(`insert into reminders_log (booking_id) values ($1)`, [id]),
    ).rejects.toThrow();
  });
});
