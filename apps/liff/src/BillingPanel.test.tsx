// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { promptPayPayload } from "@kms/core";
import { ApiError } from "./api.js";
import { BillingPanel } from "./BillingPanel.js";
import { createAdminApi, type AdminApi, type AdminBilling } from "./admin-api.js";

afterEach(cleanup);

const billing = (over: Partial<AdminBilling> = {}): AdminBilling => ({
  status: "trial",
  label: "ทดลองใช้ฟรี ถึง 28 ธ.ค. 2569 (เหลือ 7 วัน)",
  accessUntil: "2026-12-28T03:00:00.000Z",
  daysLeft: 7,
  plan: null,
  plans: {
    monthly: {
      price: 199,
      label: "รายเดือน",
      promptPayPayload: promptPayPayload("0812345678", { amount: 199 }),
    },
    yearly: {
      price: 1990,
      label: "รายปี",
      promptPayPayload: promptPayPayload("0812345678", { amount: 1990 }),
    },
  },
  ...over,
});
const api = (b: () => Promise<AdminBilling>) => ({ getBilling: vi.fn(b) }) as unknown as AdminApi;

describe("BillingPanel", () => {
  it("shows status and a QR for 199, and switches to 1,990", async () => {
    const user = userEvent.setup();
    render(<BillingPanel api={api(async () => billing())} onBack={() => {}} />);
    expect(await screen.findByText(/ทดลองใช้ฟรี ถึง 28 ธ.ค. 2569/)).toBeTruthy();
    expect((await screen.findByAltText("QR พร้อมเพย์ 199 บาท")).getAttribute("src")).toMatch(
      /^data:image\//,
    );
    await user.click(screen.getByRole("button", { name: /รายปี 1,990 บาท/ }));
    expect(await screen.findByAltText("QR พร้อมเพย์ 1,990 บาท")).toBeTruthy();
  });

  it("shows an expired alert", async () => {
    render(
      <BillingPanel
        api={api(async () => billing({ status: "expired", label: "หมดอายุแล้ว กรุณาต่ออายุ" }))}
        onBack={() => {}}
      />,
    );
    expect((await screen.findByRole("status")).className).toContain("error");
  });

  it("explains when no QR is available", async () => {
    const b = billing();
    b.plans.monthly.promptPayPayload = null;
    render(<BillingPanel api={api(async () => b)} onBack={() => {}} />);
    expect(await screen.findByText(/กรุณาติดต่อทีมงาน/)).toBeTruthy();
    expect(screen.queryByAltText(/QR/)).toBeNull();
  });

  it("shows the server error (e.g. non-owner) and a back button", async () => {
    const onBack = vi.fn();
    render(
      <BillingPanel
        api={api(async () => {
          throw new ApiError(403, "หน้านี้สำหรับเจ้าของร้านเท่านั้น");
        })}
        onBack={onBack}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("เจ้าของร้านเท่านั้น");
    await userEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("createAdminApi.getBilling", () => {
  it("GETs /admin/billing with the ID token and unwraps the body", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ billing: billing() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const a = createAdminApi({
      baseUrl: "https://api.test",
      shopId: "s1",
      getIdToken: () => "tok",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect((await a.getBilling()).status).toBe("trial");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/shops/s1/admin/billing");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    await waitFor(() => undefined);
  });
});
