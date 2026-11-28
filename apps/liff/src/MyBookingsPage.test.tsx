// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyBookingsPage } from "./MyBookingsPage.js";
import { ApiError, createBookingApi, type BookingApi, type MyBooking } from "./api.js";

afterEach(cleanup);

const b1: MyBooking = {
  id: "b1",
  serviceId: "s1",
  serviceName: "ตัดผมชาย",
  staffName: "พี่แอน",
  start: "2026-12-03T14:00:00+07:00",
  end: "2026-12-03T14:30:00+07:00",
  status: "confirmed",
  depositStatus: "none",
  depositAmount: 0,
};
const b2: MyBooking = {
  ...b1,
  id: "b2",
  serviceId: "s2",
  serviceName: "ทำสีผม",
  staffName: "พี่บอย",
  start: "2026-12-04T10:00:00+07:00",
  end: "2026-12-04T12:00:00+07:00",
  status: "pending",
};

function fakeApi(over: Partial<BookingApi> = {}): BookingApi {
  return {
    listMyBookings: vi.fn().mockResolvedValue([b1, b2]),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as BookingApi;
}

describe("MyBookingsPage", () => {
  it("lists upcoming bookings and cancels one after confirmation", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<MyBookingsPage api={api} />);

    const first = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    expect(within(first).getByText(/14:00 - 14:30/)).toBeTruthy();
    expect(within(first).getByText(/พี่แอน/)).toBeTruthy();
    const second = screen.getByRole("listitem", { name: "นัด ทำสีผม" });
    expect(within(second).getByText(/10:00 - 12:00/)).toBeTruthy();

    await user.click(within(first).getByRole("button", { name: "ยกเลิกนัด" }));
    expect(api.cancelBooking).not.toHaveBeenCalled(); // needs the second tap
    await user.click(within(first).getByRole("button", { name: "ยืนยันยกเลิกนัดนี้" }));

    expect(api.cancelBooking).toHaveBeenCalledWith("b1");
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "นัด ตัดผมชาย" })).toBeNull(),
    );
    expect(screen.getByRole("listitem", { name: "นัด ทำสีผม" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("ยกเลิกนัดเรียบร้อย");
  });

  it("backing out of the confirmation keeps the booking", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<MyBookingsPage api={api} />);
    const first = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    await user.click(within(first).getByRole("button", { name: "ยกเลิกนัด" }));
    await user.click(within(first).getByRole("button", { name: "ไม่ยกเลิก" }));
    expect(api.cancelBooking).not.toHaveBeenCalled();
    expect(within(first).getByRole("button", { name: "ยกเลิกนัด" })).toBeTruthy();
  });

  it("shows an empty state and API errors in Thai", async () => {
    render(<MyBookingsPage api={fakeApi({ listMyBookings: vi.fn().mockResolvedValue([]) })} />);
    expect(await screen.findByText("ยังไม่มีนัดที่กำลังจะมาถึง")).toBeTruthy();
    cleanup();
    render(
      <MyBookingsPage
        api={fakeApi({
          listMyBookings: vi.fn().mockRejectedValue(new ApiError(401, "กรุณาเข้าสู่ระบบ")),
        })}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("กรุณาเข้าสู่ระบบ");
  });

  it("keeps the booking and shows the error when cancel fails", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ cancelBooking: vi.fn().mockRejectedValue(new ApiError(0, "ลองใหม่")) });
    render(<MyBookingsPage api={api} />);
    const first = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    await user.click(within(first).getByRole("button", { name: "ยกเลิกนัด" }));
    await user.click(within(first).getByRole("button", { name: "ยืนยันยกเลิกนัดนี้" }));
    expect((await screen.findByRole("alert")).textContent).toBe("ลองใหม่");
    expect(screen.getByRole("listitem", { name: "นัด ตัดผมชาย" })).toBeTruthy();
  });
});

const NOW = () => Date.parse("2026-12-02T09:00:00+07:00");
const slot = (t: string) => ({
  start: `2026-12-03T${t}:00+07:00`,
  end: `2026-12-03T${t}:30+07:00`,
  staffIds: ["a"],
});

describe("MyBookingsPage reschedule (T22)", () => {
  it("picks another free slot and moves the booking", async () => {
    const user = userEvent.setup();
    const moved: MyBooking = {
      ...b1,
      start: "2026-12-03T15:00:00+07:00",
      end: "2026-12-03T15:30:00+07:00",
    };
    const listMyBookings = vi
      .fn()
      .mockResolvedValueOnce([b1, b2])
      .mockResolvedValueOnce([moved, b2]);
    const api = fakeApi({
      listMyBookings,
      listSlots: vi.fn().mockResolvedValue([slot("14:30"), slot("15:00")]),
      rescheduleBooking: vi.fn().mockResolvedValue({}),
    });
    render(<MyBookingsPage api={api} now={NOW} />);
    const first = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    await user.click(within(first).getByRole("button", { name: "ขอเลื่อน" }));
    await user.click(within(first).getByRole("button", { name: "พฤ. 3 ธ.ค." }));
    expect(api.listSlots).toHaveBeenCalledWith("s1", "2026-12-03", null);
    await user.click(await within(first).findByRole("button", { name: "15:00" }));

    expect(api.rescheduleBooking).toHaveBeenCalledWith("b1", { start: slot("15:00").start });
    expect((await screen.findByRole("status")).textContent).toContain("เลื่อนนัดเรียบร้อย");
    const after = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    expect(within(after).getByText(/15:00 - 15:30/)).toBeTruthy();
  });

  it("on a 409 race shows the Thai conflict message and refreshes the slots", async () => {
    const user = userEvent.setup();
    const listSlots = vi
      .fn()
      .mockResolvedValueOnce([slot("15:00"), slot("15:30")])
      .mockResolvedValueOnce([slot("15:30")]);
    const api = fakeApi({
      listSlots,
      rescheduleBooking: vi
        .fn()
        .mockRejectedValue(new ApiError(409, "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่")),
    });
    render(<MyBookingsPage api={api} now={NOW} />);
    const first = await screen.findByRole("listitem", { name: "นัด ตัดผมชาย" });
    await user.click(within(first).getByRole("button", { name: "ขอเลื่อน" }));
    await user.click(within(first).getByRole("button", { name: "พฤ. 3 ธ.ค." }));
    await user.click(await within(first).findByRole("button", { name: "15:00" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่",
    );
    await waitFor(() => expect(listSlots).toHaveBeenCalledTimes(2));
    expect(await within(first).findByRole("button", { name: "15:30" })).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "15:00" })).toBeNull();
    // booking is still listed at its old time
    expect(within(first).getByText(/14:00 - 14:30/)).toBeTruthy();
  });

  it("opens the picker straight away from the reminder link (initialRescheduleId)", async () => {
    render(<MyBookingsPage api={fakeApi()} now={NOW} initialRescheduleId="b2" />);
    const second = await screen.findByRole("listitem", { name: "นัด ทำสีผม" });
    expect(within(second).getByRole("region", { name: "เลือกเวลาใหม่" })).toBeTruthy();
    const first = screen.getByRole("listitem", { name: "นัด ตัดผมชาย" });
    expect(within(first).queryByRole("region", { name: "เลือกเวลาใหม่" })).toBeNull();
  });
});

describe("createBookingApi reschedule", () => {
  it("POSTs /bookings/:id/reschedule with the token and start", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ booking: { id: "b1" } }) });
    const api = createBookingApi({
      baseUrl: "https://api.test/",
      shopId: "shop1",
      getIdToken: () => "tok",
      fetchFn: f as unknown as typeof fetch,
    });
    await api.rescheduleBooking("b1", { start: "2026-12-03T15:00:00+07:00" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.test/bookings/b1/reschedule");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ start: "2026-12-03T15:00:00+07:00" });
  });
});

describe("createBookingApi my-bookings", () => {
  it("GETs /shops/:id/my-bookings and POSTs /bookings/:id/cancel with the token", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bookings: [b1] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ booking: {} }) });
    const api = createBookingApi({
      baseUrl: "https://api.test/",
      shopId: "shop1",
      getIdToken: () => "tok",
      fetchFn: f as unknown as typeof fetch,
    });
    expect(await api.listMyBookings()).toEqual([b1]);
    await api.cancelBooking("b1");
    const [u1, i1] = f.mock.calls[0] as [string, RequestInit];
    expect(u1).toBe("https://api.test/shops/shop1/my-bookings");
    expect((i1.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const [u2, i2] = f.mock.calls[1] as [string, RequestInit];
    expect(u2).toBe("https://api.test/bookings/b1/cancel");
    expect(i2.method).toBe("POST");
  });
});
