import { describe, expect, it } from "vitest";
import { BANGKOK_TZ, intervalsOverlap, minutesOfDay } from "./index.js";

describe("minutesOfDay", () => {
  it("parses valid times", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("09:30")).toBe(570);
    expect(minutesOfDay("23:59")).toBe(1439);
  });
  it("rejects malformed or out-of-range times", () => {
    expect(minutesOfDay("9:30")).toBeNull();
    expect(minutesOfDay("24:00")).toBeNull();
    expect(minutesOfDay("10:60")).toBeNull();
    expect(minutesOfDay("abc")).toBeNull();
  });
});

describe("intervalsOverlap", () => {
  it("detects overlap and adjacency correctly (half-open)", () => {
    expect(intervalsOverlap(0, 60, 30, 90)).toBe(true);
    expect(intervalsOverlap(0, 60, 60, 120)).toBe(false); // touching = no overlap
    expect(intervalsOverlap(0, 60, 61, 120)).toBe(false);
  });
});

describe("constants", () => {
  it("uses Bangkok timezone", () => {
    expect(BANGKOK_TZ).toBe("Asia/Bangkok");
  });
});
