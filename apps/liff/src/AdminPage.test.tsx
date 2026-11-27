// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Service } from "@kms/core";
import { AdminPage } from "./AdminPage.js";
import { createAdminApi, type AdminApi, type AdminSchedule } from "./admin-api.js";
import { ApiError } from "./api.js";
import { todayBangkok } from "./format.js";

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
const schedule: AdminSchedule = {
  staff: [
    { id: "a", name: "พี่แอน" },
    { id: "b", name: "พี่บอย" },
  ],
  bookings: [
    {
      id: "k1",
      staffId: "a",
      serviceId: "s1",
      serviceName: "ตัดผมชาย",
      customerName: "คุณเอ",
      customerPhone: "081-111-2222",
      start: "2026-12-03T10:00:00+07:00",
      end: "2026-12-03T10:30:00+07:00",
      status: "confirmed",
      channel: "owner",
    },
    {
      id: "k2",
      staffId: "b",
      serviceId: "s1",
      serviceName: "ตัดผมชาย",
      customerName: "คุณบี",
      customerPhone: null,
      start: "2026-12-04T11:00:00+07:00",
      end: "2026-12-04T11:30:00+07:00",
      status: "confirmed",
      channel: "line",
    },
  ],
  timeOff: [
    {
      id: "t1",
      staffId: "b",
      start: "2026-12-03T12:00:00+07:00",
      end: "2026-12-03T13:00:00+07:00",
      reason: "พักกลางวัน",
    },
    {
      id: "t2",
      staffId: null,
      start: "2026-12-03T18:00:00+07:00",
      end: "2026-12-03T19:00:00+07:00",
      reason: null,
    },
  ],
};

function fakeApi(over: Partial<AdminApi> = {}): AdminApi {
  return {
    listServices: vi.fn().mockResolvedValue([svc]),
    getSchedule: vi.fn().mockResolvedValue(schedule),
    addBooking: vi.fn().mockResolvedValue(undefined),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
    blockTime: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("AdminPage schedule", () => {
  it("asks for today (1 day) and groups bookings and time off by staff", async () => {
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    const anne = await screen.findByRole("region", { name: "พี่แอน" });
    expect(api.getSchedule).toHaveBeenCalledWith("2026-12-03", 1);
    expect(within(anne).getByText(/10:00-10:30/)).toBeTruthy();
    expect(within(anne).getByText(/คุณเอ · ตัดผมชาย \(โทรจอง\)/)).toBeTruthy();
    const phone = within(anne).getByRole("link", { name: "081-111-2222" });
    expect(phone.getAttribute("href")).toBe("tel:081-111-2222");
    const boy = screen.getByRole("region", { name: "พี่บอย" });
    expect(within(boy).getByText(/ปิดรับคิว · พักกลางวัน/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "ทั้งร้าน" })).toBeTruthy();
  });

  it("week view requests 7 days and shows the date on each row", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "สัปดาห์" }));
    await waitFor(() => expect(api.getSchedule).toHaveBeenLastCalledWith("2026-12-03", 7));
    const boy = await screen.findByRole("region", { name: "พี่บอย" });
    expect(within(boy).getByText(/ศ\. 4 ธ\.ค\. 11:00-11:30/)).toBeTruthy();
  });

  it("computes 'today' on the Bangkok calendar", () => {
    expect(todayBangkok(Date.parse("2026-12-03T18:30:00Z"))).toBe("2026-12-04");
  });
});

describe("AdminPage access control", () => {
  it("shows only the Thai refusal (no schedule, no actions) when the server says 403", async () => {
    const api = fakeApi({
      getSchedule: vi.fn().mockRejectedValue(new ApiError(403, "หน้านี้สำหรับเจ้าของร้านเท่านั้น")),
    });
    render(<AdminPage api={api} now={() => NOW} />);
    expect((await screen.findByRole("alert")).textContent).toBe("หน้านี้สำหรับเจ้าของร้านเท่านั้น");
    expect(screen.queryByRole("button", { name: "เพิ่มจองให้ลูกค้าโทร" })).toBeNull();
    expect(screen.queryByRole("button", { name: "บล็อกเวลา" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("admin API client sends the ID token as Bearer and surfaces 403", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "หน้านี้สำหรับเจ้าของร้านเท่านั้น" }), {
        status: 403,
      }),
    );
    const api = createAdminApi({
      baseUrl: "https://api.test/",
      shopId: "shop1",
      getIdToken: () => "tok",
      fetchFn,
    });
    await expect(api.getSchedule("2026-12-03", 1)).rejects.toMatchObject({ status: 403 });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.test/shops/shop1/admin/schedule?from=2026-12-03&days=1",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
  });
});

describe("AdminPage add booking for a phone customer", () => {
  it("submits name, phone, service, staff and time from one screen", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "เพิ่มจองให้ลูกค้าโทร" }));
    await user.type(screen.getByLabelText("ชื่อลูกค้า"), "คุณสมศรี");
    await user.type(screen.getByLabelText("เบอร์โทร"), "081-234-5678");
    await user.selectOptions(screen.getByLabelText("ช่าง"), "b");
    const time = screen.getByLabelText("เวลา") as HTMLInputElement;
    await user.clear(time);
    await user.type(time, "14:30");
    await user.click(screen.getByRole("button", { name: "บันทึกคิว" }));
    await waitFor(() =>
      expect(api.addBooking).toHaveBeenCalledWith({
        serviceId: "s1",
        staffId: "b",
        start: "2026-12-03T14:30:00+07:00",
        customerName: "คุณสมศรี",
        phone: "081-234-5678",
      }),
    );
    expect(await screen.findByText("เพิ่มคิวเรียบร้อยแล้ว")).toBeTruthy();
    expect(api.getSchedule).toHaveBeenCalledTimes(2); // reloaded
  });

  it("keeps the form and shows the Thai conflict message on 409", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      addBooking: vi
        .fn()
        .mockRejectedValue(new ApiError(409, "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่")),
    });
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "เพิ่มจองให้ลูกค้าโทร" }));
    await user.type(screen.getByLabelText("ชื่อลูกค้า"), "คุณสมศรี");
    await user.click(screen.getByRole("button", { name: "บันทึกคิว" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่",
    );
    expect(screen.getByLabelText("ชื่อลูกค้า")).toBeTruthy();
  });

  it("does not submit without a customer name", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "เพิ่มจองให้ลูกค้าโทร" }));
    expect((screen.getByRole("button", { name: "บันทึกคิว" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("AdminPage block time", () => {
  it("blocks a range for the whole shop by default", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "บล็อกเวลา" }));
    await user.type(screen.getByLabelText("เหตุผล (ไม่บังคับ)"), "ธุระ");
    await user.click(screen.getByRole("button", { name: "บล็อกเวลา" }));
    await waitFor(() =>
      expect(api.blockTime).toHaveBeenCalledWith({
        staffId: null,
        start: "2026-12-03T12:00:00+07:00",
        end: "2026-12-03T13:00:00+07:00",
        reason: "ธุระ",
      }),
    );
    expect(await screen.findByText("บล็อกเวลาเรียบร้อยแล้ว")).toBeTruthy();
  });

  it("rejects an end time that is not after the start without calling the API", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: "บล็อกเวลา" }));
    const to = screen.getByLabelText("ถึง") as HTMLInputElement;
    await user.clear(to);
    await user.type(to, "11:00");
    await user.click(screen.getByRole("button", { name: "บล็อกเวลา" }));
    expect((await screen.findByRole("alert")).textContent).toBe("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    expect(api.blockTime).not.toHaveBeenCalled();
  });
});

describe("AdminPage cancel", () => {
  it("needs a second tap to confirm, then cancels and reloads", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: /ยกเลิกคิว คุณเอ/ }));
    expect(api.cancelBooking).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith("k1"));
    expect(await screen.findByText("ยกเลิกคิวเรียบร้อยแล้ว")).toBeTruthy();
  });

  it("backing out of the confirmation cancels nothing", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<AdminPage api={api} now={() => NOW} />);
    await screen.findByRole("region", { name: "พี่แอน" });
    await user.click(screen.getByRole("button", { name: /ยกเลิกคิว คุณเอ/ }));
    await user.click(screen.getByRole("button", { name: "ไม่ยกเลิก" }));
    expect(api.cancelBooking).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /ยกเลิกคิว คุณเอ/ })).toBeTruthy();
  });
});
