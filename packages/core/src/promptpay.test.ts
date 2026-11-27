import { describe, expect, it } from "vitest";
import {
  crc16,
  formatAmount,
  normalizePromptPayId,
  promptPayPayload,
  verifyPayloadCrc,
} from "./promptpay.js";

describe("crc16", () => {
  it("matches the CRC-16/CCITT-FALSE check value for '123456789'", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("pads to 4 hex chars", () => {
    expect(crc16("")).toBe("FFFF");
  });
});

describe("promptPayPayload known valid payloads", () => {
  it("phone with amount 4.22 (CRC cross-checked with Python binascii.crc_hqx)", () => {
    expect(promptPayPayload("0899999999", { amount: 4.22 })).toBe(
      "00020101021229370016A00000067701011101130066899999999530376454044.225802TH6304E3EE",
    );
  });
  it("phone without amount is a static QR (01 = 11)", () => {
    const p = promptPayPayload("0812345678");
    expect(p.startsWith("000201010211")).toBe(true);
    expect(p).toContain("01130066812345678");
    expect(p).not.toContain("5404");
    expect(verifyPayloadCrc(p)).toBe(true);
  });
  it("amount makes it a dynamic QR (01 = 12)", () => {
    const p = promptPayPayload("0812345678", { amount: 100 });
    expect(p.startsWith("000201010212")).toBe(true);
    expect(p).toContain("5406100.00");
  });
  it("national ID uses sub-tag 02", () => {
    const p = promptPayPayload("1-2345-67890-12-3", { amount: 50 });
    expect(p).toContain("A000000677010111" + "02131234567890123");
    expect(verifyPayloadCrc(p)).toBe(true);
  });
  it("tax ID (13 digits) works the same as national ID", () => {
    expect(promptPayPayload("0105555555555")).toContain("02130105555555555");
  });
  it("e-wallet ID (15 digits) uses sub-tag 03", () => {
    expect(promptPayPayload("004999000000001")).toContain("0315004999000000001");
  });
});

describe("normalizePromptPayId", () => {
  it("converts 0XXXXXXXXX to 0066XXXXXXXXX and ignores dashes/spaces", () => {
    expect(normalizePromptPayId("081-234 5678")).toEqual({ type: "phone", value: "0066812345678" });
  });
  it("accepts 66XXXXXXXXX", () => {
    expect(normalizePromptPayId("66812345678").value).toBe("0066812345678");
  });
  it("rejects bad IDs with Thai message", () => {
    expect(() => normalizePromptPayId("12345")).toThrow(/PromptPay/);
    expect(() => normalizePromptPayId("08123abc78")).toThrow(/ตัวเลข/);
    expect(() => normalizePromptPayId("")).toThrow();
  });
});

describe("formatAmount", () => {
  it("formats to 2 decimals", () => {
    expect(formatAmount(1)).toBe("1.00");
    expect(formatAmount(4.2)).toBe("4.20");
    expect(formatAmount(1234.56)).toBe("1234.56");
    expect(formatAmount(0.1 + 0.2 + 0.05)).toBe("0.35");
  });
  it("rejects zero, negative, NaN and >2 decimals", () => {
    expect(() => formatAmount(0)).toThrow();
    expect(() => formatAmount(-5)).toThrow();
    expect(() => formatAmount(NaN)).toThrow();
    expect(() => formatAmount(1.005)).toThrow(/ทศนิยม/);
  });
});

describe("verifyPayloadCrc", () => {
  it("detects tampering", () => {
    const p = promptPayPayload("0899999999", { amount: 10 });
    expect(verifyPayloadCrc(p)).toBe(true);
    expect(verifyPayloadCrc(p.replace("10.00", "99.00"))).toBe(false);
    expect(verifyPayloadCrc("abc")).toBe(false);
  });
});
