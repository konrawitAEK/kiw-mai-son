// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Service, Slot, Staff } from "@kms/core";
import { promptPayPayload } from "@kms/core";
import { AdminPage } from "./AdminPage.js";
import type { AdminApi, AdminSchedule } from "./admin-api.js";
import { BookingPage } from "./BookingPage.js";
import { ApiError, createBookingApi, type BookingApi, type DepositInfo } from "./api.js";
import { prepareSlip } from "./slip.js";

afterEach(cleanup);

const NOW = Date.parse("2026-12-03T03:00:00Z");
const svc: Service = {
  id: "s1",
  shopId: "shop",
  name: "ทำสีผม",
  durationMin: 120,
  price: 1800,
  deposit: 300,
};
const staff: Staff[] = [{ id: "a", shopId: "shop", name: "พี่แอน" }];
const slots: Slot[] = [
  { start: "2026-12-03T14:00:00+07:00", end: "2026-12-03T16:00:00+07:00", staffIds: ["a"] },
];
const deposit: DepositInfo = {
  amount: 300,
  status: "pending",
  promptPayPayload: promptPayPayload("0812345678", { amount: 300 }),
  timeoutHours: 12,
};

function bookingApi(over: Partial<BookingApi> = {}): BookingApi {
  return {
    listServices: vi.fn().mockResolvedValue([svc]),
    listStaff: vi.fn().mockResolvedValue(staff),
    listSlots: vi.fn().mockResolvedValue(slots),
    createBooking: vi.fn().mockResolvedValue({
      id: "bk",
      start: slots[0]!.start,
      end: slots[0]!.end,
      staffId: "a",
      serviceId: "s1",
      deposit,
    }),
    getDeposit: vi.fn().mockResolvedValue({ bookingStatus: "pending", deposit }),
    uploadSlip: vi.fn().mockResolvedValue({ ...deposit, status: "submitted" }),
    listMyBookings: vi.fn(),
    cancelBooking: vi.fn(),
    ...over,
  };
}

async function bookIt(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /ทำสีผม/ }));
  await user.click(screen.getByRole("button", { name: /พี่แอน/ }));
  await user.click(screen.getByRole("button", { name: "พฤ. 3 ธ.ค." }));
  await user.click(await screen.findByRole("button", { name: "14:00" }));
}

describe("customer deposit step", () => {
  it("shows the deposit on the service card and the confirm summary", async () => {
    const user = userEvent.setup();
    render(<BookingPage api={bookingApi()} now={() => NOW} />);
    expect(await screen.findByText(/มัดจำ 300 บาท/)).toBeTruthy();
    await bookIt(user);
    expect(screen.getByText(/300 บาท \(ชำระหลังกดยืนยัน\)/)).toBeTruthy();
  });

  it("after booking shows amount, QR and timeout, then uploads a slip", async () => {
    const user = userEvent.setup();
    const api = bookingApi();
    render(<BookingPage api={api} now={() => NOW} />);
    await bookIt(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));

    expect(await screen.findByText("รับจองแล้ว กรุณาชำระมัดจำเพื่อยืนยันคิว")).toBeTruthy();
    const panel = screen.getByRole("region", { name: "ชำระมัดจำ" });
    expect(within(panel).getByText("300 บาท")).toBeTruthy();
    expect(within(panel).getByText(/ภายใน 12 ชั่วโมง/)).toBeTruthy();
    const qr = (await within(panel).findByRole("img")) as HTMLImageElement;
    expect(qr.alt).toContain("300");
    expect(qr.src.startsWith("data:image/")).toBe(true);

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "slip.jpg", {
      type: "image/jpeg",
    });
    await user.upload(within(panel).getByLabelText("เลือกรูปสลิป"), file);
    await waitFor(() => expect(api.uploadSlip).toHaveBeenCalledTimes(1));
    const [id, body] = (api.uploadSlip as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe("bk");
    expect(body.contentType).toBe("image/jpeg");
    expect(atob(body.dataBase64).length).toBe(7);
    expect(await within(panel).findByText("ส่งสลิปเรียบร้อยแล้ว รอร้านตรวจสอบ")).toBeTruthy();
    expect(within(panel).getAllByText(/รอร้านตรวจสอบ/).length).toBeGreaterThan(0);
  });

  it("shows the server's Thai error if the upload fails", async () => {
    const user = userEvent.setup();
    const api = bookingApi({
      uploadSlip: vi.fn().mockRejectedValue(new ApiError(400, "ไฟล์สลิปไม่ถูกต้อง")),
    });
    render(<BookingPage api={api} now={() => NOW} />);
    await bookIt(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    const input = await screen.findByLabelText("เลือกรูปสลิป");
    await user.upload(
      input,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "s.jpg", { type: "image/jpeg" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("ไฟล์สลิปไม่ถูกต้อง");
  });

  it("rejected slip asks for a new one; cancelled booking explains why", async () => {
    const user = userEvent.setup();
    const api = bookingApi({
      getDeposit: vi
        .fn()
        .mockResolvedValueOnce({
          bookingStatus: "pending",
          deposit: { ...deposit, status: "rejected" },
        })
        .mockResolvedValueOnce({ bookingStatus: "cancelled", deposit }),
    });
    render(<BookingPage api={api} now={() => NOW} />);
    await bookIt(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    await user.click(await screen.findByRole("button", { name: "ตรวจสอบสถานะ" }));
    expect(await screen.findByText(/ตรวจสลิปแล้วไม่ผ่าน/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ตรวจสอบสถานะ" }));
    expect(await screen.findByText(/ถูกยกเลิกเพราะไม่ได้ชำระมัดจำ/)).toBeTruthy();
    expect(screen.queryByLabelText("เลือกรูปสลิป")).toBeNull();
  });

  it("shop without PromptPay: no QR, tells the customer to contact the shop", async () => {
    const user = userEvent.setup();
    const api = bookingApi({
      createBooking: vi.fn().mockResolvedValue({
        id: "bk",
        start: slots[0]!.start,
        end: slots[0]!.end,
        staffId: "a",
        serviceId: "s1",
        deposit: { ...deposit, promptPayPayload: null },
      }),
    });
    render(<BookingPage api={api} now={() => NOW} />);
    await bookIt(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByText(/ร้านยังไม่ได้ตั้งค่าพร้อมเพย์/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("a service without deposit keeps the old success screen", async () => {
    const user = userEvent.setup();
    const api = bookingApi({
      listServices: vi.fn().mockResolvedValue([{ ...svc, deposit: 0 }]),
      createBooking: vi.fn().mockResolvedValue({
        id: "bk",
        start: slots[0]!.start,
        end: slots[0]!.end,
        staffId: "a",
        serviceId: "s1",
        deposit: null,
      }),
    });
    render(<BookingPage api={api} now={() => NOW} />);
    await bookIt(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByText("จองคิวเรียบร้อยแล้ว")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "ชำระมัดจำ" })).toBeNull();
  });
});

describe("booking api client", () => {
  it("createBooking merges the deposit; slip upload hits /bookings/:id/slip with the token", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/shops/shop/bookings")) {
        return new Response(
          JSON.stringify({
            booking: { id: "bk", start: "s", end: "e", staffId: "a", serviceId: "s1" },
            deposit,
          }),
          { status: 201 },
        );
      }
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ deposit: { ...deposit, status: "submitted" } }));
    });
    const api = createBookingApi({
      baseUrl: "https://x.test/api/",
      shopId: "shop",
      getIdToken: () => "tok",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const b = await api.createBooking({ serviceId: "s1", start: "s", staffId: null });
    expect(b.deposit?.amount).toBe(300);
    const d = await api.uploadSlip("bk", { contentType: "image/png", dataBase64: "AA==" });
    expect(d.status).toBe("submitted");
    const [url, init] = fetchFn.mock.calls[1]!;
    expect(String(url)).toBe("https://x.test/api/bookings/bk/slip");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("prepareSlip", () => {
  it("passes small images through as base64", async () => {
    const r = await prepareSlip(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    expect(r).toEqual({ contentType: "image/png", dataBase64: "AQID" });
  });
  it("rejects non-images and files that are too big and cannot be shrunk", async () => {
    await expect(prepareSlip(new Blob(["x"], { type: "application/pdf" }))).rejects.toThrow(
      /ใช้ไฟล์นี้ไม่ได้/,
    );
    await expect(
      prepareSlip(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" })),
    ).rejects.toThrow(/ขนาดไม่เกิน 2 MB/);
  });
});

const scheduleWithDeposit: AdminSchedule = {
  staff: [{ id: "a", name: "พี่แอน" }],
  bookings: [
    {
      id: "k1",
      staffId: "a",
      serviceId: "s1",
      serviceName: "ทำสีผม",
      customerName: "คุณเอ",
      customerPhone: null,
      start: "2026-12-03T14:00:00+07:00",
      end: "2026-12-03T16:00:00+07:00",
      status: "pending",
      channel: "line",
      depositStatus: "submitted",
      depositAmount: 300,
    },
    {
      id: "k2",
      staffId: "a",
      serviceId: "s1",
      serviceName: "ทำสีผม",
      customerName: "คุณบี",
      customerPhone: null,
      start: "2026-12-03T10:00:00+07:00",
      end: "2026-12-03T12:00:00+07:00",
      status: "confirmed",
      channel: "line",
      depositStatus: "paid",
      depositAmount: 300,
    },
  ],
  timeOff: [],
};

function adminApi(over: Partial<AdminApi> = {}): AdminApi {
  return {
    listServices: vi.fn().mockResolvedValue([svc]),
    getSchedule: vi.fn().mockResolvedValue(scheduleWithDeposit),
    addBooking: vi.fn(),
    cancelBooking: vi.fn(),
    blockTime: vi.fn(),
    getSlip: vi.fn().mockResolvedValue({ contentType: "image/png", dataBase64: "AQID" }),
    decideDeposit: vi.fn().mockResolvedValue(undefined),
    getBilling: vi.fn(),
    getReferral: vi.fn(),
    redeemReferral: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ promptPayId: null, depositTimeoutHours: null }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    exportCsv: vi.fn().mockResolvedValue(""),
    deleteShop: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("owner deposit review", () => {
  it("shows deposit state, opens the slip, confirms and rejects", async () => {
    const user = userEvent.setup();
    const api = adminApi();
    render(<AdminPage api={api} now={() => NOW} />);
    expect(await screen.findByText("รอตรวจสลิป")).toBeTruthy();
    expect(screen.getByText("ชำระแล้ว")).toBeTruthy();
    // a paid booking has no confirm/reject buttons
    expect(screen.getAllByRole("button", { name: /ยืนยันมัดจำ/ })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "ดูสลิป" }));
    const img = (await screen.findByAltText("สลิปการโอนมัดจำ")) as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,AQID");

    await user.click(screen.getByRole("button", { name: /ยืนยันมัดจำ คุณเอ/ }));
    await waitFor(() => expect(api.decideDeposit).toHaveBeenCalledWith("k1", "confirm"));
    expect(await screen.findByText("ยืนยันมัดจำแล้ว คิวนี้ยืนยันเรียบร้อย")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /ปฏิเสธสลิป คุณเอ/ }));
    await waitFor(() => expect(api.decideDeposit).toHaveBeenCalledWith("k1", "reject"));
  });

  it("says so when the customer has not uploaded a slip", async () => {
    const user = userEvent.setup();
    render(
      <AdminPage api={adminApi({ getSlip: vi.fn().mockResolvedValue(null) })} now={() => NOW} />,
    );
    await user.click(await screen.findByRole("button", { name: "ดูสลิป" }));
    expect(await screen.findByText("ลูกค้ายังไม่ได้ส่งสลิป")).toBeTruthy();
  });
});

describe("owner deposit settings", () => {
  it("defaults to auto-cancel off and saves PromptPay + hours", async () => {
    const user = userEvent.setup();
    const api = adminApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "ตั้งค่ามัดจำ" }));
    const box = (await screen.findByLabelText(/ยกเลิกคิวอัตโนมัติ/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.type(screen.getByLabelText(/พร้อมเพย์ของร้าน/), "081-234-5678");
    await user.click(box);
    const hours = screen.getByLabelText(/ภายในกี่ชั่วโมง/);
    await user.clear(hours);
    await user.type(hours, "6");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        promptPayId: "081-234-5678",
        depositTimeoutHours: 6,
      }),
    );
  });

  it("saves null timeout when auto-cancel stays off", async () => {
    const user = userEvent.setup();
    const api = adminApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "ตั้งค่ามัดจำ" }));
    await screen.findByLabelText(/พร้อมเพย์ของร้าน/);
    await user.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        promptPayId: null,
        depositTimeoutHours: null,
      }),
    );
  });
});
