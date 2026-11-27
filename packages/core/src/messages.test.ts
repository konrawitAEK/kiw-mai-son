import { describe, expect, it } from "vitest";
import { bookingConfirmationText, formatThaiDateTime } from "./messages.js";

describe("messages", () => {
  it("formats Bangkok time with Buddhist year", () => {
    expect(formatThaiDateTime("2026-12-07T10:00:00+07:00")).toBe(
      "วันจันทร์ที่ 7 ธ.ค. 2569 เวลา 10:00 น.",
    );
  });

  it("converts UTC instants to Bangkok day (crosses midnight)", () => {
    expect(formatThaiDateTime("2026-12-07T18:30:00Z")).toBe(
      "วันอังคารที่ 8 ธ.ค. 2569 เวลา 01:30 น.",
    );
  });

  it("booking confirmation snapshot", () => {
    expect(
      bookingConfirmationText({
        shopName: "ร้านเดโม คิวไม่ซ้อน",
        serviceName: "ตัดผม",
        staffName: "เอ",
        start: "2026-12-07T10:00:00+07:00",
        price: 1300,
      }),
    ).toMatchInlineSnapshot(`
      "จองคิวสำเร็จแล้ว ✅
      ร้าน: ร้านเดโม คิวไม่ซ้อน
      บริการ: ตัดผม
      ช่าง: เอ
      เวลา: วันจันทร์ที่ 7 ธ.ค. 2569 เวลา 10:00 น.
      ราคา: 1,300 บาท
      หากต้องการเลื่อนหรือยกเลิก กรุณาแจ้งร้านล่วงหน้า"
    `);
  });
});
