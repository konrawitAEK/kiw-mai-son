// PromptPay (Thai QR Payment, EMVCo merchant-presented) payload builder. Pure, no I/O.
// The PromptPay ID (phone / national ID / tax ID) must come from env or shop settings, never be committed.

export type PromptPayIdType = "phone" | "nationalId" | "eWallet";

export interface PromptPayOptions {
  /** Amount in baht. Omit for an open-amount QR. Max 2 decimals. */
  amount?: number;
}

const AID_PROMPTPAY = "A000000677010111";

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 uppercase hex chars. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Strip spaces and dashes. */
function digitsOnly(id: string): string {
  return id.replace(/[\s-]/g, "");
}

/** Classify and normalise a PromptPay ID. Throws Error on invalid input. */
export function normalizePromptPayId(raw: string): { type: PromptPayIdType; value: string } {
  const id = digitsOnly(raw);
  if (!/^\d+$/.test(id)) throw new Error("PromptPay ID ต้องเป็นตัวเลขเท่านั้น");
  if (id.length === 10 && id.startsWith("0")) {
    // Thai mobile 0XXXXXXXXX -> 0066XXXXXXXXX
    return { type: "phone", value: "0066" + id.slice(1) };
  }
  if (id.length === 11 && id.startsWith("66")) {
    return { type: "phone", value: "00" + id };
  }
  if (id.length === 13) return { type: "nationalId", value: id };
  if (id.length === 15) return { type: "eWallet", value: id };
  throw new Error(
    "PromptPay ID ไม่ถูกต้อง (ต้องเป็นเบอร์โทร 10 หลัก, เลขบัตรประชาชน/ผู้เสียภาษี 13 หลัก)",
  );
}

/** Format a baht amount as EMV value ("1.00", "4.22"). Throws if invalid. */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0");
  const satang = Math.round(amount * 100);
  if (Math.abs(satang - amount * 100) > 1e-6)
    throw new Error("จำนวนเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  if (satang > 99_999_999_999) throw new Error("จำนวนเงินมากเกินไป");
  return (satang / 100).toFixed(2);
}

/** Build the full PromptPay QR text payload (with CRC). */
export function promptPayPayload(promptPayId: string, options: PromptPayOptions = {}): string {
  const { type, value } = normalizePromptPayId(promptPayId);
  const hasAmount = options.amount !== undefined;
  const subTag = type === "phone" ? "01" : type === "nationalId" ? "02" : "03";
  const body =
    tlv("00", "01") +
    tlv("01", hasAmount ? "12" : "11") +
    tlv("29", tlv("00", AID_PROMPTPAY) + tlv(subTag, value)) +
    tlv("53", "764") +
    (hasAmount ? tlv("54", formatAmount(options.amount as number)) : "") +
    tlv("58", "TH") +
    "6304";
  return body + crc16(body);
}

/** True if the payload's trailing CRC matches its content. */
export function verifyPayloadCrc(payload: string): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== "6304") return false;
  return crc16(payload.slice(0, -4)) === payload.slice(-4);
}
