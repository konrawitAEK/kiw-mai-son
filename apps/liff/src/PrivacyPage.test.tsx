// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRIVACY_NOTICE, SHOP_TERMS } from "@kms/core";
import { AdminPage } from "./AdminPage.js";
import { createAdminApi, type AdminApi } from "./admin-api.js";
import { isLineUserAgent } from "./liff.js";
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
    exportLink: vi.fn(),
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

  describe("LINE in-app browser fallback (T24)", () => {
    const LINE_UA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.5.0";
    const CHROME_UA =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

    it("detects the LINE user agent", () => {
      expect(isLineUserAgent(LINE_UA)).toBe(true);
      expect(isLineUserAgent("Mozilla/5.0 Android Mobile Safari Line/14.5.0")).toBe(true);
      expect(isLineUserAgent(CHROME_UA)).toBe(false);
    });

    async function openIn(api: AdminApi, inLine: boolean, open: (u: string) => void) {
      const user = userEvent.setup();
      render(<AdminPage api={api} now={() => NOW} inLine={() => inLine} openExternal={open} />);
      await user.click(await screen.findByRole("button", { name: "ข้อมูลและความเป็นส่วนตัว" }));
      return user;
    }

    it("inside LINE: opens the signed link externally and never builds a blob or reads the CSV", async () => {
      const create = vi.fn(() => "blob:x");
      Object.assign(URL, { createObjectURL: create });
      const url = "https://api.test/shops/s1/export-download?token=abc.def";
      const api = fakeApi({ exportLink: vi.fn().mockResolvedValue(url) });
      const open = vi.fn();
      const user = await openIn(api, true, open);
      await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายชื่อลูกค้า" }));
      await waitFor(() => expect(open).toHaveBeenCalledWith(url));
      expect(api.exportLink).toHaveBeenCalledWith("customers");
      expect(api.exportCsv).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(url).not.toMatch(/คุณ|U[0-9a-f]{8}/); // no customer data in the URL
    });

    it("inside LINE with links switched off (404): falls back to the in-page download", async () => {
      const { ApiError } = await import("./api.js");
      const create = vi.fn(() => "blob:x");
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const api = fakeApi({ exportLink: vi.fn().mockRejectedValue(new ApiError(404, "x")) });
      const open = vi.fn();
      const user = await openIn(api, true, open);
      await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายการจองทั้งหมด" }));
      await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith("bookings"));
      expect(open).not.toHaveBeenCalled();
      click.mockRestore();
    });

    it("outside LINE: keeps the in-page download and does not ask for a link", async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
      const api = fakeApi();
      const open = vi.fn();
      const user = await openIn(api, false, open);
      await user.click(screen.getByRole("button", { name: "ดาวน์โหลดรายชื่อลูกค้า" }));
      await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith("customers"));
      expect(api.exportLink).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      click.mockRestore();
    });

    it("API client posts the kind and returns only the URL", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ url: "https://u", expiresAt: 1 })));
      const api = createAdminApi({
        baseUrl: "https://api.test",
        shopId: "s1",
        getIdToken: () => "tok",
        fetchFn,
      });
      expect(await api.exportLink("customers")).toBe("https://u");
      expect(fetchFn.mock.calls[0]?.[0]).toBe("https://api.test/shops/s1/admin/export-link");
      expect(JSON.parse(fetchFn.mock.calls[0]?.[1].body)).toEqual({ kind: "customers" });
    });
  });
});
