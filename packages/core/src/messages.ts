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
  /** THB. When > 0 and not yet paid the text says the booking waits for the deposit. */
  depositDue?: number;
}

export function bookingConfirmationText(i: BookingConfirmationInput): string {
  const waiting = (i.depositDue ?? 0) > 0;
  return [
    waiting ? `รับจองแล้ว รอชำระมัดจำ ⏳` : `จองคิวสำเร็จแล้ว ✅`,
    `ร้าน: ${i.shopName}`,
    `บริการ: ${i.serviceName}`,
    `ช่าง: ${i.staffName}`,
    `เวลา: ${formatThaiDateTime(i.start)}`,
    `ราคา: ${i.price.toLocaleString("en-US")} บาท`,
    ...(waiting
      ? [
          `มัดจำ: ${(i.depositDue as number).toLocaleString("en-US")} บาท (โอนผ่านพร้อมเพย์แล้วส่งสลิปในหน้าจอง คิวจะยืนยันเมื่อร้านตรวจสลิป)`,
        ]
      : []),
    `หากต้องการเลื่อนหรือยกเลิก กรุณาแจ้งร้านล่วงหน้า`,
  ].join("\n");
}

export const BOOKING_NOT_FOUND_TEXT = "ไม่พบการจองนี้ กรุณาตรวจสอบหรือจองใหม่อีกครั้ง";

export interface ReminderInput {
  shopName: string;
  serviceName: string;
  staffName: string;
  start: string;
}

/** Body text of the "นัดพรุ่งนี้" reminder (kept under LINE's 160-char buttons-template limit). */
export function reminderText(i: ReminderInput): string {
  return [
    `นัดพรุ่งนี้ ⏰ ร้าน${i.shopName}`,
    `${i.serviceName} (ช่าง${i.staffName})`,
    formatThaiDateTime(i.start),
  ].join("\n");
}

export type ReminderAction = "confirm" | "reschedule";

/** Postback data carried by the reminder buttons. */
export function reminderPostbackData(action: ReminderAction, bookingId: string): string {
  return `reminder=${action}&booking=${bookingId}`;
}

export function parseReminderPostback(
  data: string,
): { action: ReminderAction; bookingId: string } | null {
  const m = /^reminder=(confirm|reschedule)&booking=([0-9a-f-]{36})$/i.exec(data);
  return m ? { action: m[1] as ReminderAction, bookingId: m[2] as string } : null;
}

export const REMINDER_CONFIRM_REPLY = "ขอบคุณที่ยืนยันค่ะ แล้วพบกันพรุ่งนี้ 🙏";
export const REMINDER_RESCHEDULE_REPLY =
  "รับทราบค่ะ กรุณาแจ้งร้านเพื่อเลื่อนนัดโดยเร็วที่สุด ทางร้านจะช่วยหาเวลาใหม่ให้";

export type DepositDecisionKind = "deposit_confirmed" | "deposit_rejected" | "deposit_cancelled";

export interface DepositDecisionInput {
  shopName: string;
  serviceName: string;
  start: string;
  /** THB. */
  amount: number;
}

/** LINE push text sent to the customer when the owner decides on a deposit slip, or an unpaid deposit auto-cancels. */
export function depositDecisionText(kind: DepositDecisionKind, i: DepositDecisionInput): string {
  const baht = `${i.amount.toLocaleString("en-US")} บาท`;
  const what = [
    `ร้าน: ${i.shopName}`,
    `บริการ: ${i.serviceName}`,
    `เวลา: ${formatThaiDateTime(i.start)}`,
  ];
  switch (kind) {
    case "deposit_confirmed":
      return [
        `ร้านยืนยันการรับมัดจำ ${baht} แล้ว คิวของคุณยืนยันเรียบร้อย ✅`,
        ...what,
        `แล้วพบกันนะคะ`,
      ].join("\n");
    case "deposit_rejected":
      return [
        `ร้านตรวจสลิปมัดจำ ${baht} แล้วยังไม่ผ่าน ❗`,
        ...what,
        `กรุณาตรวจสอบยอดและส่งสลิปใหม่ในหน้าจอง หรือติดต่อร้านหากมีข้อสงสัย`,
      ].join("\n");
    case "deposit_cancelled":
      return [
        `คิวของคุณถูกยกเลิก เพราะยังไม่ได้รับมัดจำภายในเวลาที่ร้านกำหนด`,
        ...what,
        `หากยังต้องการใช้บริการ สามารถจองคิวใหม่ได้เลยค่ะ`,
      ].join("\n");
  }
}
