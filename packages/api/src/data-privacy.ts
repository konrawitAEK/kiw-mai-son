import { toCsv } from "@kms/core";
import { CORS, err, json, MSG } from "./http.js";
import type { Deps } from "./types.js";

export const EXPORT_KINDS = ["customers", "bookings"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const EXPORT_MSG = {
  confirmMismatch: "พิมพ์ชื่อร้านให้ตรงกับที่แสดงเพื่อยืนยันการลบ",
} as const;

export { EXPORT_MSG };

/**
 * Owner-only data export (CSV) and delete-shop. The caller (admin.ts) has already checked that the
 * LIFF ID token belongs to the shop owner.
 */
export function createDataPrivacyRoutes(deps: Deps) {
  return {
    /** GET /admin/export?kind=customers|bookings -> CSV download. */
    async exportCsv(shopId: string, url: URL): Promise<Response> {
      const kind = url.searchParams.get("kind");
      if (kind !== "customers" && kind !== "bookings") return err(400, MSG.badRequest);
      const csv =
        kind === "customers"
          ? toCsv(
              ["ชื่อ", "LINE user id", "เบอร์โทร", "วันที่เพิ่ม"],
              (await deps.db.exportCustomers(shopId)).map((c) => [
                c.displayName,
                c.lineUserId,
                c.phone,
                c.createdAt,
              ]),
            )
          : toCsv(
              [
                "รหัสการจอง",
                "เริ่ม",
                "สิ้นสุด",
                "สถานะ",
                "ช่องทาง",
                "บริการ",
                "ช่าง",
                "ชื่อลูกค้า",
                "เบอร์โทร",
                "สถานะมัดจำ",
                "มัดจำ (บาท)",
                "สร้างเมื่อ",
              ],
              (await deps.db.exportBookings(shopId)).map((b) => [
                b.id,
                b.start,
                b.end,
                b.status,
                b.channel === "owner" ? "เจ้าของร้านลงให้" : "LINE",
                b.serviceName,
                b.staffName,
                b.customerName,
                b.customerPhone,
                b.depositStatus,
                b.depositAmount,
                b.createdAt,
              ]),
            );
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kiw-mai-son-${kind}.csv"`,
          "Cache-Control": "no-store",
          ...CORS,
        },
      });
    },

    /** POST /admin/delete { confirmName } - must equal the shop name exactly. Irreversible. */
    async deleteShop(req: Request, shopId: string): Promise<Response> {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return err(400, MSG.badRequest);
      }
      const confirmName = (body as { confirmName?: unknown } | null)?.confirmName;
      if (typeof confirmName !== "string") return err(400, MSG.badRequest);
      const name = await deps.db.getShopName(shopId);
      if (name === null) return err(404, MSG.notFound);
      if (confirmName.trim() !== name.trim()) return err(400, EXPORT_MSG.confirmMismatch);
      await deps.db.deleteShop(shopId);
      return json(200, { deleted: true });
    },
  };
}
