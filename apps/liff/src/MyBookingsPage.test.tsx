// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyBookingsPage } from "./MyBookingsPage.js";
import { ApiError, createBookingApi, type BookingApi, type MyBooking } from "./api.js";

afterEach(cleanup);

const b1: MyBooking = {
  id: "b1",
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
