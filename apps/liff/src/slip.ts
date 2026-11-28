import type { SlipUpload } from "./api.js";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
type Allowed = (typeof ALLOWED)[number];
const MAX_BYTES = 1_500_000; // server limit is 2 MB; stay clear of it
const MAX_SIDE = 1280;

export const SLIP_ERROR =
  "ใช้ไฟล์นี้ไม่ได้ กรุณาเลือกรูปสลิป (JPG, PNG หรือ WebP) ขนาดไม่เกิน 2 MB";

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read failed"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

/** Downscale to MAX_SIDE as JPEG using the browser's canvas; null if the browser cannot. */
async function downscale(file: Blob): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.8));
  } catch {
    return null;
  }
}

/** Turns a picked image into the upload body. Big photos are shrunk first (phones take 5-10 MB photos). */
export async function prepareSlip(file: Blob): Promise<SlipUpload> {
  const isAllowed = (ALLOWED as readonly string[]).includes(file.type);
  let out: Blob = file;
  if (!isAllowed || file.size > MAX_BYTES) {
    const small = await downscale(file);
    if (small) out = small;
  }
  if (!(ALLOWED as readonly string[]).includes(out.type) || out.size > 2 * 1024 * 1024) {
    throw new Error(SLIP_ERROR);
  }
  return { contentType: out.type as Allowed, dataBase64: await readBase64(out) };
}
