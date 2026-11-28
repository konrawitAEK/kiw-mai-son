import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";

describe("toCsv", () => {
  it("starts with a BOM and uses CRLF with a trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("﻿a,b\r\n1,2\r\n");
  });
  it("quotes commas, quotes and newlines", () => {
    const out = toCsv(["x"], [["a,b"], ['say "hi"'], ["l1\nl2"]]);
    expect(out).toContain('"a,b"');
    expect(out).toContain('"say ""hi"""');
    expect(out).toContain('"l1\nl2"');
  });
  it("keeps Thai text and renders null/undefined as empty", () => {
    expect(
      toCsv(
        ["ชื่อ", "เบอร์"],
        [
          ["คุณสมศรี", null],
          ["คุณเอ", undefined],
        ],
      ),
    ).toBe("﻿ชื่อ,เบอร์\r\nคุณสมศรี,\r\nคุณเอ,\r\n");
  });
  it("neutralises formula injection", () => {
    const out = toCsv(["n"], [["=HYPERLINK(1)"], ["@SUM(A1)"], ["-1+2"], ["+cmd|x"]]);
    expect(out).toContain("'=HYPERLINK(1)");
    expect(out).toContain("'@SUM(A1)");
    expect(out).toContain("'-1+2");
    expect(out).toContain("'+cmd|x");
  });
  it("leaves phone numbers and numbers alone", () => {
    const out = toCsv(["p"], [["+66 81-234-5678"], ["081-234-5678"], [300], ["-5"]]);
    expect(out).toContain("\r\n+66 81-234-5678\r\n");
    expect(out).toContain("\r\n081-234-5678\r\n");
    expect(out).toContain("\r\n300\r\n");
    expect(out).toContain("\r\n-5\r\n");
  });
});
