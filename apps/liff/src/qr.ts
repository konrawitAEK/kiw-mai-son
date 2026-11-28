import QRCode from "qrcode";

/** QR image URL for a PromptPay payload: PNG (saveable by long-press) when canvas exists, else inline SVG. */
export async function qrImageUrl(payload: string): Promise<string> {
  const opts = { margin: 2, errorCorrectionLevel: "M" as const, width: 320 };
  try {
    return await QRCode.toDataURL(payload, opts);
  } catch {
    const svg = await QRCode.toString(payload, { ...opts, type: "svg" });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
}
