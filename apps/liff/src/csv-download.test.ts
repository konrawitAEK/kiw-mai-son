// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { csvDataUrl, isInAppBrowser, saveCsv } from "./csv-download.js";

const LINE_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.10.0";
const LINE_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 Line/14.10.0";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isInAppBrowser", () => {
  it("detects LINE on iOS and Android", () => {
    expect(isInAppBrowser(LINE_IOS_UA)).toBe(true);
    expect(isInAppBrowser(LINE_ANDROID_UA)).toBe(true);
  });
  it("does not flag ordinary browsers", () => {
    expect(isInAppBrowser(SAFARI_UA)).toBe(false);
    expect(isInAppBrowser("")).toBe(false);
    expect(isInAppBrowser("Mozilla/5.0 Online/1.0")).toBe(false);
  });
});

describe("csvDataUrl", () => {
  it("encodes Thai text with the BOM as base64 that decodes back to the same bytes", () => {
    const text = "﻿ชื่อ,ราคา\r\nคุณเอ,300\r\n";
    const url = csvDataUrl(text);
    expect(url.startsWith("data:text/csv;charset=utf-8;base64,")).toBe(true);
    const b64 = url.split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(text);
  });
  it("handles payloads larger than one encoding chunk", () => {
    const text = "﻿" + "ก".repeat(50_000);
    const b64 = csvDataUrl(text).split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(text);
  });
});

describe("saveCsv", () => {
  it("returns a link instead of downloading inside the LINE in-app browser", () => {
    const create = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const result = saveCsv("kiw-mai-son-bookings.csv", "﻿a\r\n", LINE_IOS_UA);
    expect(result).toEqual({
      mode: "link",
      href: csvDataUrl("﻿a\r\n"),
      filename: "kiw-mai-son-bookings.csv",
    });
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("downloads through a blob URL in a normal browser", () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const result = saveCsv("kiw-mai-son-customers.csv", "﻿a\r\n", SAFARI_UA);
    expect(result).toEqual({ mode: "download" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });
});
