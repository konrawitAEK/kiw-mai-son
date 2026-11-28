import { useEffect, useMemo, useState } from "react";
import { AdminPage } from "./AdminPage.js";
import { createAdminApi, type AdminApi } from "./admin-api.js";
import { OnboardingPage } from "./OnboardingPage.js";
import { createOnboardingApi, type OnboardingApi } from "./onboarding-api.js";
import { BookingPage } from "./BookingPage.js";
import { createBookingApi, type BookingApi } from "./api.js";
import { MyBookingsPage } from "./MyBookingsPage.js";
import { LegalPage } from "./LegalPage.js";
import { closeLiff, initLiff } from "./liff.js";

const useMock = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock");

export function App() {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const page = new URLSearchParams(window.location.search).get("page");
  const isAdmin = page === "admin";
  const isOnboarding = page === "onboarding";
  const isMyBookings = page === "my-bookings";
  const isLegal = page === "privacy" || page === "terms";
  const shopId = new URLSearchParams(window.location.search).get("shop") ?? "";
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
  const liffId = (import.meta.env.VITE_LIFF_ID as string | undefined) ?? "";

  useEffect(() => {
    if (useMock || isLegal) return;
    if (!liffId) {
      setFatal("ยังไม่ได้ตั้งค่าแอปจอง กรุณาติดต่อร้าน");
      return;
    }
    initLiff(liffId)
      .then((r) => {
        setIdToken(r.idToken);
        setReady(true);
      })
      .catch(() => setFatal("เปิดหน้าจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"));
  }, [liffId, isLegal]);

  const api = useMemo(
    () => createBookingApi({ baseUrl, shopId, getIdToken: () => idToken }),
    [baseUrl, shopId, idToken],
  );

  const adminApi = useMemo(
    () => createAdminApi({ baseUrl, shopId, getIdToken: () => idToken }),
    [baseUrl, shopId, idToken],
  );

  const onboardingApi = useMemo(
    () => createOnboardingApi({ baseUrl, getIdToken: () => idToken }),
    [baseUrl, idToken],
  );

  // Legal pages are public static text: no LIFF login, no shop id needed.
  if (isLegal) return <LegalPage kind={page} />;
  if (useMock) {
    return isOnboarding ? (
      <MockOnboarding />
    ) : isAdmin ? (
      <MockAdmin />
    ) : (
      <MockBooking myBookings={isMyBookings} />
    );
  }
  // Shop onboarding: /?page=onboarding (optionally &shop=<id> to resume). No shop id needed to start.
  if (isOnboarding) {
    if (fatal) return <p className="page">{fatal}</p>;
    if (!ready) return <p className="page">กำลังโหลด...</p>;
    return <OnboardingPage api={onboardingApi} initialShopId={shopId} />;
  }
  if (!shopId) return <p className="page">ลิงก์ไม่ถูกต้อง กรุณาเปิดจากเมนูของร้าน</p>;
  if (fatal) return <p className="page">{fatal}</p>;
  if (!ready) return <p className="page">กำลังโหลด...</p>;
  // Owner admin: /?page=admin&shop=<id>. The server enforces owner-only access (403 for anyone else).
  if (isAdmin) return <AdminPage api={adminApi} />;
  // Rich-menu "นัดของฉัน": /?page=my-bookings&shop=<id>
  if (isMyBookings) return <MyBookingsPage api={api} onClose={closeLiff} />;
  return <BookingPage api={api} onClose={closeLiff} />;
}

function MockBooking({ myBookings }: { myBookings: boolean }) {
  const [api, setApi] = useState<BookingApi | null>(null);
  useEffect(() => {
    void import("./dev-mock.js").then((m) => setApi(m.createMockApi()));
  }, []);
  if (!api) return null;
  return myBookings ? <MyBookingsPage api={api} /> : <BookingPage api={api} />;
}

function MockAdmin() {
  const [api, setApi] = useState<AdminApi | null>(null);
  useEffect(() => {
    void import("./dev-mock.js").then((m) => setApi(m.createMockAdminApi()));
  }, []);
  return api ? <AdminPage api={api} /> : null;
}

function MockOnboarding() {
  const [api, setApi] = useState<OnboardingApi | null>(null);
  useEffect(() => {
    void import("./dev-mock.js").then((m) => setApi(m.createMockOnboardingApi()));
  }, []);
  return api ? <OnboardingPage api={api} /> : null;
}
