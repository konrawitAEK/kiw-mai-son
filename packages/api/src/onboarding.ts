import { err, json, UUID } from "./http.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import { validateRichMenuImage, setupRichMenu } from "./rich-menu.js";
import type { Deps, HoursWindow, OnboardingDeps } from "./types.js";

export const ONB_MSG = {
  badCredentials: "Channel ID หรือ Channel secret ไม่ถูกต้อง กรุณาตรวจสอบแล้ววางใหม่",
  badToken: "Channel access token ไม่ถูกต้อง กรุณาออก token ใหม่ใน LINE Developers แล้ววางใหม่",
  unreachable: "เชื่อมต่อ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  channelTaken: "ช่องทาง LINE นี้เชื่อมกับร้านอื่นอยู่แล้ว",
  inviteCode: "รหัสเชิญไม่ถูกต้อง",
  noChannel: "ยังไม่ได้เชื่อมต่อ LINE OA ของร้าน",
  badImage: "รูปเมนูต้องเป็นไฟล์ PNG ขนาด 2500x843 พิกเซล และไม่เกิน 1 MB",
  richMenuFailed: "ตั้งค่าริชเมนูไม่สำเร็จ กรุณาตรวจสอบ token แล้วลองใหม่",
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHANNEL_ID = /^\d{5,20}$/;
const SECRET = /^[0-9A-Za-z]{16,64}$/;
const TOKEN = /^[0-9A-Za-z+/=_.-]{20,600}$/;
const NAME_MAX = 80;
const MAX_IMAGE_B64 = 1_500_000;

type Obj = Record<string, unknown>;

async function readJson(req: Request): Promise<Obj | null> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Obj) : null;
  } catch {
    return null;
  }
}

const cleanName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= NAME_MAX ? t : null;
};

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

function parseWindows(v: unknown): HoursWindow[] | null {
  if (!Array.isArray(v) || v.length > 28) return null;
  const out: HoursWindow[] = [];
  for (const w of v) {
    const o = w as Obj | null;
    const weekday = intIn(o?.["weekday"], 0, 6);
    const start = o?.["start"];
    const end = o?.["end"];
    if (
      weekday === null ||
      typeof start !== "string" ||
      typeof end !== "string" ||
      !HHMM.test(start) ||
      !HHMM.test(end) ||
      toMin(end) <= toMin(start)
    ) {
      return null;
    }
    out.push({ weekday, start, end });
  }
  return out;
}

/** POST /onboarding/shops: a signed-in LINE user creates (or gets back) their shop. */
export function createShopRoute(ob: OnboardingDeps, deps: Deps) {
  return async function createShop(req: Request): Promise<Response> {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    const user = m?.[1] ? await deps.verifyIdToken(m[1]) : null;
    if (!user) return err(401, "กรุณาเข้าสู่ระบบผ่าน LINE ใหม่อีกครั้ง");
    const existing = await ob.db.findShopByOwner(user.userId);
    if (existing) return json(200, { shopId: existing.id, name: existing.name, created: false });

    const body = await readJson(req);
    const name = cleanName(body?.["name"]);
    if (!name) return err(400, "กรุณากรอกชื่อร้าน (ไม่เกิน 80 ตัวอักษร)");
    if (ob.inviteCode && body?.["inviteCode"] !== ob.inviteCode) {
      return err(403, ONB_MSG.inviteCode);
    }
    const shopId = await ob.db.createShop(name, user.userId);
    return json(201, { shopId, name, created: true });
  };
}

/**
 * Owner-only onboarding routes (the caller has already verified the owner). `rest` is the path after
 * `/shops/:shopId/admin`. Returns null when the path is not an onboarding route.
 */
export function createOnboardingAdminRoutes(ob: OnboardingDeps) {
  return async function onboardingAdmin(
    req: Request,
    shopId: string,
    rest: string[],
  ): Promise<Response | null> {
    const [a, b, c] = rest;
    const method = req.method;

    if (method === "GET" && a === "setup" && rest.length === 1) return setup(shopId);
    if (method === "PUT" && a === "line-channel" && rest.length === 1) {
      return saveChannel(req, shopId);
    }
    if (method === "POST" && a === "services" && rest.length === 1) {
      const body = await readJson(req);
      const name = cleanName(body?.["name"]);
      const durationMin = intIn(body?.["durationMin"], 5, 600);
      const price = intIn(body?.["price"], 0, 1_000_000);
      const deposit = intIn(body?.["deposit"] ?? 0, 0, 1_000_000);
      if (!name || durationMin === null || price === null || deposit === null || deposit > price) {
        return err(400, "ข้อมูลบริการไม่ถูกต้อง (มัดจำต้องไม่เกินราคา)");
      }
      const service = await ob.db.insertService(shopId, { name, durationMin, price, deposit });
      return json(201, { service });
    }
    if (method === "POST" && a === "staff" && rest.length === 1) {
      const name = cleanName((await readJson(req))?.["name"]);
      if (!name) return err(400, "กรุณากรอกชื่อช่าง/พนักงาน");
      return json(201, { staff: await ob.db.insertStaff(shopId, name) });
    }
    if (method === "PUT" && a === "staff" && b && c === "hours" && rest.length === 3) {
      if (!UUID.test(b)) return err(404, "ไม่พบข้อมูลที่ต้องการ");
      const windows = parseWindows((await readJson(req))?.["windows"]);
      if (!windows) return err(400, "เวลาทำการไม่ถูกต้อง");
      const ok = await ob.db.replaceWorkingHours(shopId, b, windows);
      return ok ? json(200, { windows }) : err(404, "ไม่พบข้อมูลที่ต้องการ");
    }
    if (method === "POST" && a === "rich-menu" && rest.length === 1) return richMenu(req, shopId);
    return null;
  };

  async function setup(shopId: string): Promise<Response> {
    const [name, channel, hours] = await Promise.all([
      ob.db.getShopName(shopId),
      ob.db.getLineChannel(shopId),
      ob.db.listWorkingHours(shopId),
    ]);
    return json(200, {
      shop: { id: shopId, name: name ?? "" },
      // Never returns the secret or token, not even encrypted.
      channel: channel
        ? { connected: true, channelId: channel.channelId, destination: channel.destination }
        : { connected: false },
      richMenuDone: !!channel?.richMenuId,
      staffWithHours: [...new Set(hours.map((h) => h.staffId))],
    });
  }

  async function saveChannel(req: Request, shopId: string): Promise<Response> {
    const body = await readJson(req);
    const channelId = typeof body?.["channelId"] === "string" ? body["channelId"].trim() : "";
    const channelSecret =
      typeof body?.["channelSecret"] === "string" ? body["channelSecret"].trim() : "";
    const accessToken = typeof body?.["accessToken"] === "string" ? body["accessToken"].trim() : "";
    if (!CHANNEL_ID.test(channelId)) return err(400, ONB_MSG.badCredentials);
    if (!SECRET.test(channelSecret)) return err(400, ONB_MSG.badCredentials);
    if (!TOKEN.test(accessToken)) return err(400, ONB_MSG.badToken);

    const check = await ob.validateChannel({ channelId, channelSecret, accessToken });
    if (!check.ok) {
      if (check.reason === "bad_credentials") return err(422, ONB_MSG.badCredentials);
      if (check.reason === "bad_token") return err(422, ONB_MSG.badToken);
      return err(502, ONB_MSG.unreachable);
    }
    const saved = await ob.db.saveLineChannel({
      shopId,
      channelId,
      destination: check.destination,
      secretEnc: await encryptSecret(channelSecret, ob.encryptionKey),
      tokenEnc: await encryptSecret(accessToken, ob.encryptionKey),
    });
    if (saved === "taken") return err(409, ONB_MSG.channelTaken);
    return json(200, {
      channel: {
        connected: true,
        channelId,
        destination: check.destination,
        botName: check.botName,
      },
    });
  }

  async function richMenu(req: Request, shopId: string): Promise<Response> {
    const channel = await ob.db.getLineChannel(shopId);
    if (!channel) return err(409, ONB_MSG.noChannel);
    const b64 = (await readJson(req))?.["imageBase64"];
    if (typeof b64 !== "string" || b64.length === 0 || b64.length > MAX_IMAGE_B64) {
      return err(400, ONB_MSG.badImage);
    }
    let image: Uint8Array;
    try {
      image = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    } catch {
      return err(400, ONB_MSG.badImage);
    }
    if (validateRichMenuImage(image) !== null) return err(400, ONB_MSG.badImage);
    try {
      const accessToken = await decryptSecret(channel.tokenEnc, ob.encryptionKey);
      const run = ob.richMenu ?? setupRichMenu;
      const result = await run({
        shopId,
        liffId: ob.liffId,
        dryRun: false,
        image,
        accessToken,
      });
      if (result.richMenuId) await ob.db.setRichMenuId(shopId, result.richMenuId);
      return json(200, { richMenuId: result.richMenuId });
    } catch {
      // The error text may echo LINE responses; keep it out of the client and logs.
      return err(502, ONB_MSG.richMenuFailed);
    }
  }
}
