// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Service, Slot, Staff } from "@kms/core";
import { OnboardingPage } from "./OnboardingPage.js";
import { ApiError } from "./api.js";
import {
  createOnboardingApi,
  type OnboardingApi,
  type SetupStatus,
  type ShopSetupApi,
} from "./onboarding-api.js";

afterEach(cleanup);

const NOW = Date.parse("2026-12-03T03:00:00Z"); // 10:00 Thu 3 Dec Bangkok
const svc: Service = {
  id: "s1",
  shopId: "shop",
  name: "ตัดผมชาย",
  durationMin: 30,
  price: 250,
  deposit: 0,
};
const staffA: Staff = { id: "a", shopId: "shop", name: "พี่แอน" };

const emptyStatus: SetupStatus = {
  shop: { id: "shop", name: "ร้านเอ" },
  channel: { connected: false },
  richMenuDone: false,
  staffWithHours: [],
};

function fakeShop(over: Partial<ShopSetupApi> = {}): ShopSetupApi {
  return {
    getSetup: vi.fn().mockResolvedValue(emptyStatus),
    saveChannel: vi.fn().mockResolvedValue({ botName: "ร้านเอ OA" }),
    listServices: vi.fn().mockResolvedValue([]),
    listStaff: vi.fn().mockResolvedValue([]),
    addService: vi.fn().mockResolvedValue(svc),
    addStaff: vi.fn().mockResolvedValue(staffA),
    setHours: vi.fn().mockResolvedValue(undefined),
    uploadRichMenu: vi.fn().mockResolvedValue(undefined),
    listSlots: vi.fn().mockResolvedValue([]),
    addTestBooking: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function fakeApi(shop: ShopSetupApi, over: Partial<OnboardingApi> = {}): OnboardingApi {
  return {
    createShop: vi.fn().mockResolvedValue({ shopId: "shop" }),
    forShop: () => shop,
    ...over,
  };
}

describe("OnboardingPage", () => {
  it("creates the shop first, then shows the checklist", async () => {
    const shop = fakeShop();
    const api = fakeApi(shop);
    render(<OnboardingPage api={api} now={() => NOW} />);
    await userEvent.type(screen.getByLabelText("ชื่อร้าน"), "ร้านเอ");
    await userEvent.click(screen.getByRole("button", { name: "สร้างร้าน" }));
    expect(api.createShop).toHaveBeenCalledWith({ name: "ร้านเอ", inviteCode: "" });
    expect(await screen.findByText(/เสร็จแล้ว 0\/6 ขั้นตอน/)).toBeTruthy();
  });

  it("shows a Thai error when the invite code is refused", async () => {
    const api = fakeApi(fakeShop(), {
      createShop: vi.fn().mockRejectedValue(new ApiError(403, "รหัสเชิญไม่ถูกต้อง")),
    });
    render(<OnboardingPage api={api} />);
    await userEvent.type(screen.getByLabelText("ชื่อร้าน"), "ร้านเอ");
    await userEvent.click(screen.getByRole("button", { name: "สร้างร้าน" }));
    expect((await screen.findByRole("alert")).textContent).toBe("รหัสเชิญไม่ถูกต้อง");
  });

  it("refuses non-owners", async () => {
    const shop = fakeShop({
      getSetup: vi.fn().mockRejectedValue(new ApiError(403, "หน้านี้สำหรับเจ้าของร้านเท่านั้น")),
    });
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" />);
    expect((await screen.findByRole("alert")).textContent).toBe("หน้านี้สำหรับเจ้าของร้านเท่านั้น");
    expect(screen.queryByLabelText("Channel ID")).toBeNull();
  });

  it("submits channel credentials, shows the result and clears the secrets", async () => {
    const shop = fakeShop();
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" now={() => NOW} />);
    await userEvent.type(await screen.findByLabelText("Channel ID"), "1234567890");
    const secret = screen.getByLabelText("Channel secret") as HTMLInputElement;
    const token = screen.getByLabelText(/Channel access token/) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(token.type).toBe("password");
    await userEvent.type(secret, " abcdefabcdefabcdef ");
    await userEvent.type(token, "TOKENTOKENTOKENTOKENTOKEN");
    await userEvent.click(screen.getByRole("button", { name: "ตรวจสอบและบันทึก" }));
    expect(shop.saveChannel).toHaveBeenCalledWith({
      channelId: "1234567890",
      channelSecret: "abcdefabcdefabcdef",
      accessToken: "TOKENTOKENTOKENTOKENTOKEN",
    });
    expect((await screen.findByRole("status")).textContent).toContain("ร้านเอ OA");
    await waitFor(() => expect(secret.value).toBe(""));
    expect(token.value).toBe("");
  });

  it("keeps the typed secret and shows LINE's rejection message", async () => {
    const shop = fakeShop({
      saveChannel: vi.fn().mockRejectedValue(new ApiError(422, "Channel access token ไม่ถูกต้อง")),
    });
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" />);
    await userEvent.type(await screen.findByLabelText("Channel ID"), "1234567890");
    await userEvent.type(screen.getByLabelText("Channel secret"), "abcdefabcdefabcdef");
    await userEvent.type(
      screen.getByLabelText(/Channel access token/),
      "TOKENTOKENTOKENTOKENTOKEN",
    );
    await userEvent.click(screen.getByRole("button", { name: "ตรวจสอบและบันทึก" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Channel access token ไม่ถูกต้อง");
    expect((screen.getByLabelText("Channel secret") as HTMLInputElement).value).toBe(
      "abcdefabcdefabcdef",
    );
  });

  it("adds a service with number fields", async () => {
    const shop = fakeShop();
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" />);
    await userEvent.type(await screen.findByLabelText("ชื่อบริการ"), "ตัดผมชาย");
    await userEvent.type(screen.getByLabelText("ราคา (บาท)"), "250");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มบริการ" }));
    expect(shop.addService).toHaveBeenCalledWith({
      name: "ตัดผมชาย",
      durationMin: 30,
      price: 250,
      deposit: 0,
    });
  });

  it("adds staff and saves default Mon-Sat hours, with a day toggled off", async () => {
    const shop = fakeShop({ listStaff: vi.fn().mockResolvedValue([staffA]) });
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" />);
    const form = await screen.findByRole("form", { name: "เวลาทำการ พี่แอน" });
    await userEvent.click(within(form).getByRole("button", { name: "ส" })); // Saturday off
    await userEvent.click(within(form).getByRole("button", { name: "บันทึกเวลาทำการ" }));
    expect(shop.setHours).toHaveBeenCalledWith(
      "a",
      [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        start: "10:00",
        end: "19:00",
      })),
    );
  });

  it("sets up the rich menu from a PNG file and needs a connected channel", async () => {
    const shop = fakeShop();
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" />);
    const button = await screen.findByRole("button", { name: "ตั้งค่าริชเมนู" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const connected = fakeShop({
      getSetup: vi.fn().mockResolvedValue({
        ...emptyStatus,
        channel: { connected: true, channelId: "1", destination: "U" },
      }),
    });
    render(<OnboardingPage api={fakeApi(connected)} initialShopId="shop" />);
    const input = (await screen.findByLabelText(/รูปเมนู PNG/)) as HTMLInputElement;
    await userEvent.upload(
      input,
      new File([new Uint8Array([137, 80, 78, 71])], "menu.png", { type: "image/png" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "ตั้งค่าริชเมนู" }));
    await waitFor(() => expect(connected.uploadRichMenu).toHaveBeenCalledWith("iVBORw=="));
  });

  it("test booking picks the first future slot and reports it", async () => {
    const slots: Slot[] = [
      { start: "2026-12-03T09:00:00+07:00", end: "2026-12-03T09:30:00+07:00", staffIds: ["a"] }, // past
      { start: "2026-12-03T14:00:00+07:00", end: "2026-12-03T14:30:00+07:00", staffIds: ["a"] },
    ];
    const shop = fakeShop({
      listServices: vi.fn().mockResolvedValue([svc]),
      listStaff: vi.fn().mockResolvedValue([staffA]),
      listSlots: vi.fn().mockResolvedValue(slots),
    });
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" now={() => NOW} />);
    await userEvent.click(await screen.findByRole("button", { name: "ทดสอบจองคิว" }));
    expect((await screen.findByRole("status")).textContent).toContain("14:00");
    expect(shop.addTestBooking).toHaveBeenCalledWith({
      serviceId: "s1",
      staffId: "a",
      start: "2026-12-03T14:00:00+07:00",
    });
    expect(await screen.findByText(/เสร็จแล้ว 3\/6/)).toBeTruthy();
  });

  it("test booking explains when no slot is free in 7 days", async () => {
    const shop = fakeShop({
      listServices: vi.fn().mockResolvedValue([svc]),
      listStaff: vi.fn().mockResolvedValue([staffA]),
    });
    render(<OnboardingPage api={fakeApi(shop)} initialShopId="shop" now={() => NOW} />);
    await userEvent.click(await screen.findByRole("button", { name: "ทดสอบจองคิว" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ไม่พบเวลาว่าง");
    expect(shop.addTestBooking).not.toHaveBeenCalled();
  });
});

describe("createOnboardingApi", () => {
  it("sends the ID token and maps Thai errors", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/line-channel")) {
        return new Response(
          JSON.stringify({ error: "Channel ID หรือ Channel secret ไม่ถูกต้อง" }),
          {
            status: 422,
          },
        );
      }
      return new Response(JSON.stringify({ shopId: "s", init: init?.method }), { status: 201 });
    });
    const api = createOnboardingApi({
      baseUrl: "https://api.test/",
      getIdToken: () => "TKN",
      fetchFn: f as unknown as typeof fetch,
    });
    await api.createShop({ name: "ร้าน", inviteCode: "" });
    const first = f.mock.calls[0];
    expect(first?.[0]).toBe("https://api.test/onboarding/shops");
    expect((first?.[1]?.headers as Record<string, string>)["Authorization"]).toBe("Bearer TKN");
    await expect(
      api.forShop("shop").saveChannel({ channelId: "1", channelSecret: "s", accessToken: "t" }),
    ).rejects.toMatchObject({ status: 422, message: "Channel ID หรือ Channel secret ไม่ถูกต้อง" });
  });
});
