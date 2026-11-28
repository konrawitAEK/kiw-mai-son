import { beforeEach, describe, expect, it, vi } from "vitest";

const liffMock = vi.hoisted(() => ({
  isInClient: vi.fn(),
  sendMessages: vi.fn(),
}));
vi.mock("@line/liff", () => ({ default: liffMock }));

import { bookingConfirmText, sendBookingConfirmation } from "./liff.js";

const BK = "6f1c2a3e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";

beforeEach(() => {
  liffMock.isInClient.mockReset();
  liffMock.sendMessages.mockReset().mockResolvedValue(undefined);
});

describe("bookingConfirmText", () => {
  it("is exactly 'ยืนยันการจอง <bookingId>' (the T6 webhook pattern)", () => {
    expect(bookingConfirmText(BK)).toBe(`ยืนยันการจอง ${BK}`);
  });
});

describe("sendBookingConfirmation", () => {
  it("calls liff.sendMessages with the confirmation text inside LINE", async () => {
    liffMock.isInClient.mockReturnValue(true);
    await sendBookingConfirmation(BK);
    expect(liffMock.sendMessages).toHaveBeenCalledTimes(1);
    expect(liffMock.sendMessages).toHaveBeenCalledWith([
      { type: "text", text: `ยืนยันการจอง ${BK}` },
    ]);
  });

  it("does nothing outside the LINE client", async () => {
    liffMock.isInClient.mockReturnValue(false);
    await sendBookingConfirmation(BK);
    expect(liffMock.sendMessages).not.toHaveBeenCalled();
  });

  it("does nothing when LIFF is not initialised (isInClient throws)", async () => {
    liffMock.isInClient.mockImplementation(() => {
      throw new Error("not initialized");
    });
    await sendBookingConfirmation(BK);
    expect(liffMock.sendMessages).not.toHaveBeenCalled();
  });
});
