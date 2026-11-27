import { useEffect, useMemo, useState } from "react";
import { BookingPage } from "./BookingPage.js";
import { createBookingApi, type BookingApi } from "./api.js";
import { closeLiff, initLiff } from "./liff.js";

const useMock = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock");

export function App() {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const shopId = new URLSearchParams(window.location.search).get("shop") ?? "";
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
  const liffId = (import.meta.env.VITE_LIFF_ID as string | undefined) ?? "";

  useEffect(() => {
    if (useMock) return;
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
  }, [liffId]);

  const api = useMemo(
    () => createBookingApi({ baseUrl, shopId, getIdToken: () => idToken }),
    [baseUrl, shopId, idToken],
  );

  if (useMock) {
    return <MockBooking />;
  }
  if (!shopId) return <p className="page">ลิงก์ไม่ถูกต้อง กรุณาเปิดจากเมนูของร้าน</p>;
  if (fatal) return <p className="page">{fatal}</p>;
  if (!ready) return <p className="page">กำลังโหลด...</p>;
  return <BookingPage api={api} onClose={closeLiff} />;
}

function MockBooking() {
  const [api, setApi] = useState<BookingApi | null>(null);
  useEffect(() => {
    void import("./dev-mock.js").then((m) => setApi(m.createMockApi()));
  }, []);
  return api ? <BookingPage api={api} /> : null;
}
