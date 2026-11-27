// Thai user-facing message text. Pure functions, no I/O. Times are Asia/Bangkok.

const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;

/** e.g. "วันจันทร์ที่ 7 ธ.ค. 2569 เวลา 10:00 น." (Buddhist-era year, Bangkok time). */
export function formatThaiDateTime(iso: string): string {
  const d = new Date(Date.parse(iso) + BANGKOK_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `วัน${WEEKDAYS[d.getUTCDay()]}ที่ ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543} เวลา ${hh}:${mm} น.`;
}

export interface BookingConfirmationInput {
  shopName: string;
  serviceName: string;
  staffName: string;
  start: string;
  /** Price in THB. */
  price: number;
}

export function bookingConfirmationText(i: BookingConfirmationInput): string {
  return [
    `จองคิวสำเร็จแล้ว ✅`,
    `ร้าน: ${i.shopName}`,
    `บริการ: ${i.serviceName}`,
    `ช่าง: ${i.staffName}`,
    `เวลา: ${formatThaiDateTime(i.start)}`,
    `ราคา: ${i.price.toLocaleString("en-US")} บาท`,
    `หากต้องการเลื่อนหรือยกเลิก กรุณาแจ้งร้านล่วงหน้า`,
  ].join("\n");
}

export const BOOKING_NOT_FOUND_TEXT = "ไม่พบการจองนี้ กรุณาตรวจสอบหรือจองใหม่อีกครั้ง";
