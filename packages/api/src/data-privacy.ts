import { toCsv } from "@kms/core";
import { CORS, err, json, MSG, UUID } from "./http.js";
import { EXPORT_TOKEN_TTL_MS, signExportToken, verifyExportToken } from "./export-token.js";
import type { Deps } from "./types.js";

export const EXPORT_KINDS = ["customers", "bookings"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const EXPORT_MSG = {
  linkExpired: "ลิงก์ดาวน์โหลดหมดอายุแล้ว กรุณากลับไปที่ LINE แล้วกดดาวน์โหลดใหม่",
  confirmMismatch: "พิมพ์ชื่อร้านให้ตรงกับที่แสดงเพื่อยืนยันการลบ",
} as const;

export { EXPORT_MSG };

/**
 * Owner-only data export (CSV) and delete-shop. The caller (admin.ts) has already checked that the
 * LIFF ID token belongs to the shop owner.
 */
export function createDataPrivacyRoutes(deps: Deps) {
  async function csvResponse(shopId: string, kind: ExportKind): Promise<Response> {
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
  }

  return {
    /** GET /admin/export?kind=customers|bookings -> CSV download. */
    async exportCsv(shopId: string, url: URL): Promise<Response> {
      const kind = url.searchParams.get("kind");
      if (kind !== "customers" && kind !== "bookings") return err(400, MSG.badRequest);
      return csvResponse(shopId, kind);
    },

    /**
     * POST /admin/export-link { kind } (owner, ID token already checked by admin.ts) ->
     * { url, expiresAt }. The URL carries only a short-lived signed token (no customer data), so it can be
     * opened in the phone's external browser, where the LINE webview's download restrictions do not apply.
     */
    async createExportLink(req: Request, shopId: string, ownerId: string): Promise<Response> {
      if (!deps.exportTokenKey || !deps.publicBaseUrl) return err(404, MSG.notFound);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return err(400, MSG.badRequest);
      }
      const kind = (body as { kind?: unknown } | null)?.kind;
      if (kind !== "customers" && kind !== "bookings") return err(400, MSG.badRequest);
      const exp = deps.now() + EXPORT_TOKEN_TTL_MS;
      const token = await signExportToken(
        { shopId, owner: ownerId, kind, exp },
        deps.exportTokenKey,
      );
      const base = deps.publicBaseUrl.replace(/\/+$/, "");
      return json(200, {
        url: `${base}/shops/${shopId}/export-download?token=${encodeURIComponent(token)}`,
        expiresAt: exp,
      });
    },

    /**
     * GET /shops/:shopId/export-download?token= (no Authorization header: the signed token is the credential).
     * 401 = missing / bad signature / expired; 403 = token is for another shop or its owner is no longer the owner.
     */
    async downloadWithToken(shopId: string, url: URL): Promise<Response> {
      if (!deps.exportTokenKey) return err(404, MSG.notFound);
      const token = url.searchParams.get("token");
      if (!token) return err(401, MSG.unauthorized);
      const p = await verifyExportToken(token, deps.exportTokenKey);
      if (!p || p.exp <= deps.now()) return err(401, EXPORT_MSG.linkExpired);
      if (!UUID.test(shopId) || p.shopId !== shopId) return err(403, MSG.forbidden);
      const owner = await deps.db.getShopOwner(shopId);
      if (owner === null || owner !== p.owner) return err(403, MSG.forbidden);
      return csvResponse(shopId, p.kind);
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
