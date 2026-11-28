// Supabase implementation of `OnboardingDb` (packages/api/src/types.ts). Not unit-tested (needs a real database).
import type { Service, Staff, WorkingHours } from "@kms/core";
import type { OnboardingDb } from "../../../packages/api/src/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** PostgREST accepts bytea as "\\x<hex>" and returns it the same way. */
const toBytea = (b: Uint8Array) =>
  "\\x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function fromBytea(v: string): Uint8Array {
  const hex = v.startsWith("\\x") ? v.slice(2) : v;
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

export function createSupabaseOnboardingDb(sb: Client): OnboardingDb {
  return {
    async findShopByOwner(ownerLineUserId) {
      const r: Row | null = check(
        await sb
          .from("shops")
          .select("id, name")
          .eq("owner_line_user_id", ownerLineUserId)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
      );
      return r ? { id: r.id, name: r.name } : null;
    },
    async createShop(name, ownerLineUserId) {
      const r: Row = check(
        await sb
          .from("shops")
          .insert({ name, owner_line_user_id: ownerLineUserId })
          .select("id")
          .single(),
      );
      // Start the free trial (T17 reads this row).
      check(await sb.from("subscriptions").insert({ shop_id: r.id }));
      return r.id;
    },
    async getShopName(shopId) {
      const r: Row | null = check(
        await sb.from("shops").select("name").eq("id", shopId).maybeSingle(),
      );
      return r ? r.name : null;
    },
    async saveLineChannel(i) {
      const res = await sb.from("line_channels").upsert(
        {
          shop_id: i.shopId,
          channel_id: i.channelId,
          destination: i.destination,
          channel_secret_encrypted: toBytea(i.secretEnc),
          channel_access_token_encrypted: toBytea(i.tokenEnc),
          rich_menu_id: null, // a new channel has no menu yet
        },
        { onConflict: "shop_id" },
      );
      if (res.error?.code === "23505") return "taken"; // channel_id / destination belong to another shop
      check(res);
      return "ok";
    },
    async getLineChannel(shopId) {
      const r: Row | null = check(
        await sb
          .from("line_channels")
          .select(
            "channel_id, destination, channel_secret_encrypted, channel_access_token_encrypted, rich_menu_id",
          )
          .eq("shop_id", shopId)
          .maybeSingle(),
      );
      return r
        ? {
            channelId: r.channel_id,
            destination: r.destination,
            secretEnc: fromBytea(r.channel_secret_encrypted),
            tokenEnc: fromBytea(r.channel_access_token_encrypted),
            richMenuId: r.rich_menu_id,
          }
        : null;
    },
    async setRichMenuId(shopId, richMenuId) {
      check(
        await sb.from("line_channels").update({ rich_menu_id: richMenuId }).eq("shop_id", shopId),
      );
    },
    async insertService(shopId, s) {
      const r: Row = check(
        await sb
          .from("services")
          .insert({
            shop_id: shopId,
            name: s.name,
            duration_min: s.durationMin,
            price: s.price,
            deposit: s.deposit,
          })
          .select("id, shop_id, name, duration_min, price, deposit")
          .single(),
      );
      return {
        id: r.id,
        shopId: r.shop_id,
        name: r.name,
        durationMin: r.duration_min,
        price: r.price,
        deposit: r.deposit,
      } satisfies Service;
    },
    async insertStaff(shopId, name) {
      const r: Row = check(
        await sb
          .from("staff")
          .insert({ shop_id: shopId, name })
          .select("id, shop_id, name")
          .single(),
      );
      return { id: r.id, shopId: r.shop_id, name: r.name } satisfies Staff;
    },
    async replaceWorkingHours(shopId, staffId, windows) {
      const s: Row | null = check(
        await sb.from("staff").select("id").eq("id", staffId).eq("shop_id", shopId).maybeSingle(),
      );
      if (!s) return false;
      check(await sb.from("working_hours").delete().eq("staff_id", staffId));
      if (windows.length > 0) {
        check(
          await sb.from("working_hours").insert(
            windows.map((w) => ({
              staff_id: staffId,
              weekday: w.weekday,
              start_time: w.start,
              end_time: w.end,
            })),
          ),
        );
      }
      return true;
    },
    async listWorkingHours(shopId) {
      const rows: Row[] = check(
        await sb
          .from("working_hours")
          .select("staff_id, weekday, start_time, end_time, staff!inner(shop_id)")
          .eq("staff.shop_id", shopId),
      );
      return rows.map(
        (r): WorkingHours => ({
          staffId: r.staff_id,
          weekday: r.weekday,
          start: String(r.start_time).slice(0, 5),
          end: String(r.end_time).slice(0, 5),
        }),
      );
    },
  };
}
