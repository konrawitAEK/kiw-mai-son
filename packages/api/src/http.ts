export const MIN_MS = 60_000;
export const DAY_MS = 24 * 60 * MIN_MS;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MSG = {
  conflict: "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่",
  unauthorized: "กรุณาเข้าสู่ระบบผ่าน LINE ใหม่อีกครั้ง",
  forbidden: "หน้านี้สำหรับเจ้าของร้านเท่านั้น",
  notFound: "ไม่พบข้อมูลที่ต้องการ",
  badRequest: "ข้อมูลไม่ถูกต้อง กรุณาลองใหม่",
  notOpen: "ช่วงเวลานี้ไม่เปิดให้จอง กรุณาเลือกใหม่",
  past: "ไม่สามารถจองเวลาที่ผ่านไปแล้วได้",
  slipBad: "ไฟล์สลิปไม่ถูกต้อง กรุณาส่งรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB",
  noDeposit: "การจองนี้ไม่มีมัดจำที่ต้องชำระ",
  depositClosed: "ไม่สามารถทำรายการนี้ได้ในสถานะปัจจุบันของการจอง",
  promptPayBad: "PromptPay ID ไม่ถูกต้อง (เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน/ผู้เสียภาษี 13 หลัก)",
  /** T23: customer-facing; does not reveal billing details. */
  shopClosedBookings: "ร้านนี้ยังไม่เปิดรับจองออนไลน์ในขณะนี้ กรุณาติดต่อร้านโดยตรง",
  /** T23: owner-facing. */
  subscriptionExpired: 'แพ็กเกจของร้านหมดอายุ กรุณาต่ออายุที่เมนู "ค่าบริการ" ก่อนรับจองใหม่',
  server: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
} as const;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}
export const err = (status: number, message: string) => json(status, { error: message });
