// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Service, Slot, Staff } from "@kms/core";
import { BookingPage } from "./BookingPage.js";
import { ApiError, createBookingApi, type BookingApi } from "./api.js";
import { timeLabel, timeRangeLabel, upcomingDays } from "./format.js";

afterEach(cleanup);

const NOW = Date.parse("2026-12-03T03:00:00Z"); // 10:00 Bangkok, Thu 3 Dec
const svc: Service = {
  id: "s1",
  shopId: "shop",
  name: "ตัดผมชาย",
  durationMin: 30,
  price: 250,
  deposit: 0,
};
const staff: Staff[] = [
  { id: "a", shopId: "shop", name: "พี่แอน" },
  { id: "b", shopId: "shop", name: "พี่บอย" },
];
const slots: Slot[] = [
  { start: "2026-12-03T14:00:00+07:00", end: "2026-12-03T14:30:00+07:00", staffIds: ["a", "b"] },
  { start: "2026-12-03T14:30:00+07:00", end: "2026-12-03T15:00:00+07:00", staffIds: ["b"] },
];

function fakeApi(over: Partial<BookingApi> = {}): BookingApi {
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
    }),
    getDeposit: vi.fn(),
    uploadSlip: vi.fn(),
    ...over,
  };
}

async function toConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
  await user.click(screen.getByRole("button", { name: /พี่แอน/ }));
  await user.click(screen.getByRole("button", { name: "พฤ. 3 ธ.ค." }));
  await user.click(await screen.findByRole("button", { name: "14:00" }));
}

describe("format helpers", () => {
  it("lists Bangkok days starting today, crossing UTC midnight correctly", () => {
    // 2026-12-03T18:30Z is already 04 Dec 01:30 in Bangkok
    const d = upcomingDays(Date.parse("2026-12-03T18:30:00Z"), 3);
    expect(d.map((x) => x.date)).toEqual(["2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(d[0]).toMatchObject({ weekday: "ศ.", dayOfMonth: 4, month: "ธ.ค." });
  });
  it("extracts HH:mm from +07:00 ISO", () => {
    expect(timeLabel("2026-12-03T09:30:00+07:00")).toBe("09:30");
  });
  it("shows end = start + duration as HH:mm - HH:mm", () => {
    expect(timeRangeLabel("2026-12-03T10:00:00+07:00", 30)).toBe("10:00 - 10:30");
    expect(timeRangeLabel("2026-12-03T10:00:00+07:00", 120)).toBe("10:00 - 12:00");
    expect(timeRangeLabel("2026-12-03T23:00:00+07:00", 90)).toBe("23:00 - 00:30");
  });
});

describe("BookingPage", () => {
  it("shows services in Thai with duration and price", async () => {
    render(<BookingPage api={fakeApi()} now={() => NOW} />);
    expect(await screen.findByText("30 นาที · 250 บาท")).toBeTruthy();
    expect(screen.getByText("เลือกบริการ")).toBeTruthy();
  });

  it("offers 'any staff' plus each staff member", async () => {
    const user = userEvent.setup();
    render(<BookingPage api={fakeApi()} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
    expect(screen.getByRole("button", { name: /ช่างคนไหนก็ได้/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /พี่แอน/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /พี่บอย/ })).toBeTruthy();
  });

  it("skips the staff step when the shop has no staff listed", async () => {
    const user = userEvent.setup();
    render(
      <BookingPage api={fakeApi({ listStaff: vi.fn().mockResolvedValue([]) })} now={() => NOW} />,
    );
    await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
    expect(screen.getByText("เลือกวันที่")).toBeTruthy();
  });

  it("shows only the free slots returned by the API and passes the staff choice", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<BookingPage api={api} now={() => NOW} />);
    await toConfirm(user);
    expect(api.listSlots).toHaveBeenCalledWith("s1", "2026-12-03", "a");
  });

  it("passes null staff for 'any staff'", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<BookingPage api={api} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
    await user.click(screen.getByRole("button", { name: /ช่างคนไหนก็ได้/ }));
    await user.click(screen.getByRole("button", { name: "พฤ. 3 ธ.ค." }));
    await screen.findByRole("button", { name: "14:00" });
    expect(screen.getByRole("button", { name: "14:30" })).toBeTruthy();
    expect(api.listSlots).toHaveBeenCalledWith("s1", "2026-12-03", null);
  });

  it("says so when a day has no free time", async () => {
    const user = userEvent.setup();
    render(
      <BookingPage api={fakeApi({ listSlots: vi.fn().mockResolvedValue([]) })} now={() => NOW} />,
    );
    await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
    await user.click(screen.getByRole("button", { name: /พี่แอน/ }));
    await user.click(screen.getByRole("button", { name: "พฤ. 3 ธ.ค." }));
    expect(await screen.findByText(/ไม่มีเวลาว่าง/)).toBeTruthy();
  });

  it("confirm step summarises the choice, then books and shows success", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<BookingPage api={api} now={() => NOW} />);
    await toConfirm(user);
    expect(screen.getByText("14:00 - 14:30 น.")).toBeTruthy();
    expect(screen.getByText("250 บาท")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByText("จองคิวเรียบร้อยแล้ว")).toBeTruthy();
    expect(api.createBooking).toHaveBeenCalledWith({
      serviceId: "s1",
      start: slots[0]!.start,
      staffId: "a",
    });
  });

  it("end time is start + service.durationMin, even if the API end equals start", async () => {
    const user = userEvent.setup();
    const broken = {
      start: "2026-12-03T14:00:00+07:00",
      end: "2026-12-03T14:00:00+07:00",
      staffIds: ["a"],
    };
    const longSvc: Service = { ...svc, id: "s2", name: "ทำสีผม", durationMin: 120 };
    const createBooking = vi.fn().mockResolvedValue({
      id: "bk",
      start: broken.start,
      end: broken.start,
      staffId: "a",
      serviceId: "s2",
    });
    const api = fakeApi({
      listServices: vi.fn().mockResolvedValue([longSvc]),
      listSlots: vi.fn().mockResolvedValue([broken]),
      createBooking,
    });
    render(<BookingPage api={api} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: /ทำสีผม/ }));
    await user.click(screen.getByRole("button", { name: /พี่แอน/ }));
    await user.click(screen.getByRole("button", { name: "พฤ. 3 ธ.ค." }));
    await user.click(await screen.findByRole("button", { name: "14:00" }));
    expect(screen.getByText("14:00 - 16:00 น.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByText("จองคิวเรียบร้อยแล้ว")).toBeTruthy();
    expect(screen.getByText("14:00 - 16:00 น.")).toBeTruthy();
  });

  it("on 409 conflict shows the Thai message, returns to time list and reloads slots", async () => {
    const user = userEvent.setup();
    const listSlots = vi.fn().mockResolvedValueOnce(slots).mockResolvedValueOnce([slots[1]!]);
    const createBooking = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่"));
    render(<BookingPage api={fakeApi({ listSlots, createBooking })} now={() => NOW} />);
    await toConfirm(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่",
    );
    expect(screen.getByText("เลือกเวลา")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "14:00" })).toBeNull());
    expect(screen.getByRole("button", { name: "14:30" })).toBeTruthy();
    expect(listSlots).toHaveBeenCalledTimes(2);
  });

  it("shows other API errors and stays on confirm", async () => {
    const user = userEvent.setup();
    const createBooking = vi
      .fn()
      .mockRejectedValue(new ApiError(401, "กรุณาเข้าสู่ระบบผ่าน LINE ใหม่อีกครั้ง"));
    render(<BookingPage api={fakeApi({ createBooking })} now={() => NOW} />);
    await toConfirm(user);
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect((await screen.findByRole("alert")).textContent).toContain("เข้าสู่ระบบ");
    expect(screen.getByRole("button", { name: "ยืนยันการจอง" })).toBeTruthy();
  });

  it("back button returns to the previous step", async () => {
    const user = userEvent.setup();
    render(<BookingPage api={fakeApi()} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: /ตัดผมชาย/ }));
    await user.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(screen.getByText("เลือกบริการ")).toBeTruthy();
  });

  it("shows a Thai error if services fail to load", async () => {
    render(
      <BookingPage
        api={fakeApi({ listServices: vi.fn().mockRejectedValue(new Error("x")) })}
        now={() => NOW}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("เกิดข้อผิดพลาด");
  });
});

describe("createBookingApi", () => {
  it("sends the bearer token and maps 409 to ApiError with the server message", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่" }), {
        status: 409,
      }),
    );
    const api = createBookingApi({
      baseUrl: "https://x.test/api/",
      shopId: "shop1",
      getIdToken: () => "tok",
      fetchFn,
    });
    await expect(
      api.createBooking({ serviceId: "s", start: "2026-12-03T14:00:00+07:00", staffId: null }),
    ).rejects.toMatchObject({ status: 409, message: "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://x.test/api/shops/shop1/bookings");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ serviceId: "s", start: "2026-12-03T14:00:00+07:00" });
  });

  it("builds the slots query with and without staff", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ slots: [] })));
    const api = createBookingApi({
      baseUrl: "https://x.test",
      shopId: "s",
      getIdToken: () => null,
      fetchFn,
    });
    await api.listSlots("svc", "2026-12-03", "st");
    await api.listSlots("svc", "2026-12-03", null);
    expect(fetchFn.mock.calls[0]![0]).toBe(
      "https://x.test/shops/s/slots?serviceId=svc&date=2026-12-03&staffId=st",
    );
    expect(fetchFn.mock.calls[1]![0]).toBe(
      "https://x.test/shops/s/slots?serviceId=svc&date=2026-12-03",
    );
  });

  it("turns network failure into a Thai generic error", async () => {
    const api = createBookingApi({
      baseUrl: "https://x.test",
      shopId: "s",
      getIdToken: () => null,
      fetchFn: vi.fn().mockRejectedValue(new TypeError("net")),
    });
    await expect(api.listServices()).rejects.toMatchObject({ status: 0 });
  });
});
