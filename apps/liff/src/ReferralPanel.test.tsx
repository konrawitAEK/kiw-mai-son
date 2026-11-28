// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "./api.js";
import { ReferralPanel } from "./ReferralPanel.js";
import { createAdminApi, type AdminApi, type AdminReferral } from "./admin-api.js";

afterEach(cleanup);

const referral = (over: Partial<AdminReferral> = {}): AdminReferral => ({
  code: "ABCD2345",
  referredCount: 2,
  redeemed: false,
  bonusMonths: 1,
  shareText: "ร้านสวย ชวนใช้ คิวไม่ซ้อน ใส่โค้ด ABCD2345",
  ...over,
});
const api = (over: Partial<AdminApi> = {}) =>
  ({ getReferral: vi.fn(async () => referral()), ...over }) as unknown as AdminApi;

describe("ReferralPanel", () => {
  it("shows the shop code, count and share text", async () => {
    render(<ReferralPanel api={api()} onBack={() => {}} />);
    expect((await screen.findByLabelText("โค้ดแนะนำ")).textContent).toBe("ABCD2345");
    expect(screen.getByText(/ใช้โค้ดของคุณแล้ว 2 ร้าน/)).toBeTruthy();
    expect(screen.getByText(/ร้านสวย ชวนใช้/)).toBeTruthy();
  });

  it("redeems another shop's code and shows the success message", async () => {
    const user = userEvent.setup();
    const redeemReferral = vi.fn(async () => ({
      message: "ใช้โค้ดแนะนำสำเร็จ ทั้งสองร้านได้ใช้ฟรีเพิ่ม 1 เดือน",
      referral: referral({ redeemed: true }),
    }));
    render(<ReferralPanel api={api({ redeemReferral })} onBack={() => {}} />);
    await user.type(await screen.findByRole("textbox"), "wxyz-9876");
    await user.click(screen.getByRole("button", { name: "ใช้โค้ด" }));
    expect(redeemReferral).toHaveBeenCalledWith("wxyz-9876");
    expect((await screen.findByRole("status")).textContent).toContain("ฟรีเพิ่ม 1 เดือน");
    expect(screen.queryByRole("textbox")).toBeNull(); // form hidden after redeeming
  });

  it("shows the server's Thai error for a bad code", async () => {
    const user = userEvent.setup();
    const redeemReferral = vi.fn(async () => {
      throw new ApiError(404, "ไม่พบโค้ดแนะนำนี้ กรุณาตรวจสอบอีกครั้ง");
    });
    render(<ReferralPanel api={api({ redeemReferral })} onBack={() => {}} />);
    await user.type(await screen.findByRole("textbox"), "ZZZZZZZZ");
    await user.click(screen.getByRole("button", { name: "ใช้โค้ด" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ไม่พบโค้ดแนะนำ");
  });

  it("hides the code field if the shop already redeemed", async () => {
    render(
      <ReferralPanel
        api={api({ getReferral: vi.fn(async () => referral({ redeemed: true })) })}
        onBack={() => {}}
      />,
    );
    expect(await screen.findByText(/ใช้โค้ดแนะนำไปแล้ว/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a load error with a back button", async () => {
    const onBack = vi.fn();
    render(
      <ReferralPanel
        api={api({
          getReferral: vi.fn(async () => {
            throw new ApiError(403, "หน้านี้สำหรับเจ้าของร้านเท่านั้น");
          }),
        })}
        onBack={onBack}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("เจ้าของร้านเท่านั้น");
    await userEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("createAdminApi referral", () => {
  it("GETs /admin/referral and POSTs the code to /admin/referral/redeem", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ referral: referral(), message: "ok" }), {
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
    expect((await a.getReferral()).code).toBe("ABCD2345");
    await a.redeemReferral("WXYZ9876");
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe("https://api.test/shops/s1/admin/referral");
    expect(calls[1]![0]).toBe("https://api.test/shops/s1/admin/referral/redeem");
    expect(calls[1]![1].method).toBe("POST");
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ code: "WXYZ9876" });
  });
});
