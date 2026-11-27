import { BANGKOK_TZ } from "@kms/core";

export function App() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>คิวไม่ซ้อน</h1>
      <p>ระบบจองคิวผ่าน LINE OA ของร้าน (โครงเริ่มต้น)</p>
      <p>เขตเวลา: {BANGKOK_TZ}</p>
    </main>
  );
}
