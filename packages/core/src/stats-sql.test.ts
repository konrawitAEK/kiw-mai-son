import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import coreSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";
import depositSql from "../../../supabase/migrations/20261128020000_deposits.sql?raw";
import statsSql from "../../../supabase/migrations/20261128030000_monthly_stats.sql?raw";

let db: PGlite;
let shopA: string;
let shopB: string;
let shopEmpty: string;
let n = 0;

const FROM = "2026-11-30T17:00:00Z"; // 1 Dec 00:00 Bangkok
const TO = "2026-12-31T17:00:00Z";

async function mk(table: string, cols: string, vals: unknown[]): Promise<string> {
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  return (
    await db.query<{ id: string }>(
      `insert into ${table} (${cols}) values (${ph}) returning id`,
      vals,
    )
  ).rows[0]!.id;
}

async function book(
  shop: string,
  start: string,
  o: { status?: string; channel?: string; deposit?: [string, number] } = {},
) {
  const staff = await mk("staff", "shop_id, name", [shop, `ช่าง${++n}`]);
  const svc = (await db.query<{ id: string }>(`select id from services where shop_id=$1`, [shop]))
    .rows[0]!.id;
  const cust = (await db.query<{ id: string }>(`select id from customers where shop_id=$1`, [shop]))
    .rows[0]!.id;
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  const [ds, da] = o.deposit ?? ["none", 0];
  await db.query(
    `insert into bookings (shop_id, staff_id, service_id, customer_id, during, status, channel, deposit_status, deposit_amount)
     values ($1,$2,$3,$4,tstzrange($5,$6,'[)'),$7,$8,$9,$10)`,
    [shop, staff, svc, cust, start, end, o.status ?? "confirmed", o.channel ?? "line", ds, da],
  );
}

const stats = async () => {
  const r = await db.query<Record<string, string | number>>(`select * from monthly_stats($1,$2)`, [
    FROM,
    TO,
  ]);
  return new Map(r.rows.map((x) => [x.shop_id as string, x]));
};

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(coreSql);
  await db.exec(depositSql);
  await db.exec(statsSql);
  shopA = await mk("shops", "name, owner_line_user_id", ["A", "Ua"]);
  shopB = await mk("shops", "name, owner_line_user_id", ["B", "Ub"]);
  shopEmpty = await mk("shops", "name, owner_line_user_id", ["Z", "Uz"]);
  for (const s of [shopA, shopB]) {
    await mk("services", "shop_id, name, duration_min", [s, "ตัดผม", 30]);
    await mk("customers", "shop_id, line_user_id, display_name", [s, `U${s}`, "ลูกค้า"]);
  }
  // Shop A, December 2026
  await book(shopA, "2026-12-02T03:00:00Z");
  await book(shopA, "2026-12-03T03:00:00Z", { channel: "owner" });
  await book(shopA, "2026-12-04T03:00:00Z", { channel: "owner", status: "completed" });
  await book(shopA, "2026-12-05T03:00:00Z", { status: "no_show" });
  await book(shopA, "2026-12-06T03:00:00Z", { status: "cancelled" });
  await book(shopA, "2026-12-07T03:00:00Z", { deposit: ["paid", 100] });
  await book(shopA, "2026-12-08T03:00:00Z", { deposit: ["paid", 250] });
  await book(shopA, "2026-12-09T03:00:00Z", { status: "pending", deposit: ["pending", 100] });
  await book(shopA, "2026-12-10T03:00:00Z", { status: "cancelled", deposit: ["paid", 999] });
  // Boundaries (Bangkok): last minute of Nov and first minute of Jan are outside; first minute of Dec is inside.
  await book(shopA, "2026-11-30T16:30:00Z");
  await book(shopA, "2026-11-30T17:00:00Z");
  await book(shopA, "2026-12-31T17:00:00Z");
  // Shop B
  await book(shopB, "2026-12-11T03:00:00Z");
});

describe("monthly_stats (SQL)", () => {
  it("counts bookings, channel split, no-shows, cancelled and paid deposits per shop", async () => {
    const a = (await stats()).get(shopA)!;
    expect(a).toMatchObject({
      shop_name: "A",
      bookings: 8, // 9 in December minus 2 cancelled, plus the 00:00 Dec 1 booking
      via_line: 6,
      via_owner: 2,
      no_shows: 1,
      cancelled: 2,
      deposits_paid: 2,
      deposits_paid_amount: 350,
    });
    expect((a.via_line as number) + (a.via_owner as number)).toBe(a.bookings);
  });

  it("keeps shops separate and returns zeros for a shop without bookings", async () => {
    const s = await stats();
    expect(s.get(shopB)).toMatchObject({ bookings: 1, via_line: 1, deposits_paid_amount: 0 });
    expect(s.get(shopEmpty)).toMatchObject({
      bookings: 0,
      no_shows: 0,
      cancelled: 0,
      deposits_paid: 0,
    });
  });

  it("claim_monthly_summary is true once per (shop, month)", async () => {
    const claim = async (m: string, s = shopA) =>
      (
        await db.query<{ claim_monthly_summary: boolean }>(`select claim_monthly_summary($1,$2)`, [
          s,
          m,
        ])
      ).rows[0]!.claim_monthly_summary;
    expect(await claim("2026-12")).toBe(true);
    expect(await claim("2026-12")).toBe(false);
    expect(await claim("2027-01")).toBe(true);
    expect(await claim("2026-12", shopB)).toBe(true);
  });
});
