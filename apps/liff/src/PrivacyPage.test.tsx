// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRIVACY_NOTICE, SHOP_TERMS } from "@kms/core";
import { AdminPage } from "./AdminPage.js";
import { createAdminApi, type AdminApi } from "./admin-api.js";
import { LegalPage } from "./LegalPage.js";
import { BookingPage } from "./BookingPage.js";
import type { BookingApi } from "./api.js";

afterEach(cleanup);

const NOW = Date.parse("2026-12-03T03:00:00Z");

function fakeApi(over: Partial<AdminApi> = {}): AdminApi {
  return {
    listServices: vi.fn().mockResolvedValue([]),
    getSchedule: vi.fn().mockResolvedValue({ staff: [], bookings: [], timeOff: [] }),
    addBooking: vi.fn(),
    cancelBooking: vi.fn(),
    blockTime: vi.fn(),
    getSlip: vi.fn().mockResolvedValue(null),
    decideDeposit: vi.fn(),
    getBilling: vi.fn(),
    getReferral: vi.fn(),
    redeemReferral: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    exportCsv: vi.fn().mockResolvedValue("﻿ชื่อ\r\nคุณเอ\r\n"),
    deleteShop: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("legal pages", () => {
  it("privacy notice renders every section and links to the shop terms", () => {
    render(<LegalPage kind="privacy" />);
    expect(screen.getByRole("heading", { name: PRIVACY_NOTICE.title })).toBeTruthy();
    for (const s of PRIVACY_NOTICE.sections) {
      expect(screen.getByRole("heading", { name: s.heading })).toBeTruthy();
    }
    expect(
      screen
        .getByRole("link", { name: "ข้อตกลงการประมวลผลข้อมูลสำหรับร้านค้า" })
        .getAttribute("href"),
    ).toBe("?page=terms");
  });
  it("shop terms render every section and link back to the privacy notice", () => {
    render(<LegalPage kind="terms" />);
    for (const s of SHOP_TERMS.sections) {
      expect(screen.getByRole("heading", { name: s.heading })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "ประกาศความเป็นส่วนตัว" }).getAttribute("href")).toBe(
      "?page=privacy",
    );
  });
  it("the booking page links to the privacy notice", () => {
    const api = {
      listServices: () => new Promise(() => {}),
      listStaff: () => new Promise(() => {}),
    } as unknown as BookingApi;
    render(<BookingPage api={api} />);
    expect(screen.getByRole("link", { name: "ประกาศความเป็นส่วนตัว" }).getAttribute("href")).toBe(
      "?page=privacy",
    );
  });
  it("the owner page links to both documents", async () => {
    render(<AdminPage api={fakeApi()} now={() => NOW} />);
    expect(await screen.findByRole("link", { name: "ประกาศความเป็นส่วนตัว" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ข้อตกลงการประมวลผลข้อมูล/ })).toBeTruthy();
  });
});

describe("owner data export and delete", () => {
  async function openPrivacy(api: AdminApi) {
    const user = userEvent.setup();
    render(<AdminPage api={api} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "ข้อมูลและความเป็นส่วนตัว" }));
    return user;
  }

  it("downloads customers and bookings CSV", async () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const api = fakeApi();
    const user = await openPrivacy(api);
    await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายชื่อลูกค้า" }));
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith("customers"));
    await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายการจองทั้งหมด" }));
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith("bookings"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("inside the LINE in-app browser shows an external-browser link instead of a blob download", async () => {
    const create = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const ua = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (iPhone) Mobile/15E148 Line/14.10.0");
    const api = fakeApi();
    const user = await openPrivacy(api);
    await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายชื่อลูกค้า" }));
    const link = await screen.findByRole("link", { name: "เปิดไฟล์ CSV ในเบราว์เซอร์" });
    expect(link.getAttribute("href")).toMatch(/^data:text\/csv;charset=utf-8;base64,/);
    expect(link.getAttribute("download")).toBe("kiw-mai-son-customers.csv");
    expect(screen.getByRole("status").textContent).toContain("กดลิงก์");
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    ua.mockRestore();
    click.mockRestore();
  });

  it("shows a Thai error if the export fails", async () => {
    const api = fakeApi({ exportCsv: vi.fn().mockRejectedValue(new Error("x")) });
    const user = await openPrivacy(api);
    await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายชื่อลูกค้า" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ลองใหม่/);
  });

  it("delete needs an explicit second step and the shop name", async () => {
    const api = fakeApi();
    const user = await openPrivacy(api);
    expect(screen.queryByLabelText(/พิมพ์ชื่อร้าน/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "ต้องการลบร้าน" }));
    const confirm = screen.getByRole("button", { name: "ยืนยันลบร้านถาวร" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/พิมพ์ชื่อร้าน/), "ร้านสวย");
    await user.click(confirm);
    await waitFor(() => expect(api.deleteShop).toHaveBeenCalledWith("ร้านสวย"));
    expect(await screen.findByText("ลบร้านเรียบร้อยแล้ว")).toBeTruthy();
  });

  it("a wrong name keeps the page and shows the server message", async () => {
    const { ApiError } = await import("./api.js");
    const api = fakeApi({
      deleteShop: vi.fn().mockRejectedValue(new ApiError(400, "พิมพ์ชื่อร้านให้ตรงกับที่แสดง")),
    });
    const user = await openPrivacy(api);
    await user.click(screen.getByRole("button", { name: "ต้องการลบร้าน" }));
    await user.type(screen.getByLabelText(/พิมพ์ชื่อร้าน/), "ผิด");
    await user.click(screen.getByRole("button", { name: "ยืนยันลบร้านถาวร" }));
    expect((await screen.findByRole("alert")).textContent).toContain("พิมพ์ชื่อร้านให้ตรง");
    expect(screen.queryByText("ลบร้านเรียบร้อยแล้ว")).toBeNull();
  });

  it("API client sends Bearer, reads CSV as text and posts the confirmation", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("﻿a\r\n", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    const api = createAdminApi({
      baseUrl: "https://api.test",
      shopId: "s1",
      getIdToken: () => "tok",
      fetchFn,
    });
    expect(await api.exportCsv("bookings")).toContain("a");
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://api.test/shops/s1/admin/export?kind=bookings");
    await api.deleteShop("ร้านสวย");
    expect(fetchFn.mock.calls[1]?.[0]).toBe("https://api.test/shops/s1/admin/delete");
    expect(JSON.parse(fetchFn.mock.calls[1]?.[1].body)).toEqual({ confirmName: "ร้านสวย" });
  });
});
