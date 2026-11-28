import { describe, expect, it } from "vitest";
import { createHandler } from "./handler.js";
import { signExportToken, verifyExportToken } from "./export-token.js";
import type { Db } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const NOW = Date.parse("2026-12-06T09:00:00+07:00");
const KEY = "test-export-key-0123456789abcdef0123456789";
const BASE = "https://x.test/functions/v1/api";

function setup(opts: { key?: string | undefined; owner?: string } = {}) {
  let now = NOW;
  const owners: Record<string, string> = { [SHOP]: opts.owner ?? "UOWNER", [OTHER]: "UOTHER" };
  const db = {
    getShopOwner: async (id: string) => owners[id] ?? null,
    exportCustomers: async () => [
      { displayName: "คุณสมศรี", lineUserId: "U1", phone: null, createdAt: "2026-12-01" },
    ],
    exportBookings: async () => [],
  } as unknown as Db;
  const users: Record<string, { userId: string; displayName: string }> = {
    owner: { userId: "UOWNER", displayName: "เจ้าของ" },
    customer: { userId: "U1", displayName: "ลูกค้า" },
  };
  const handler = createHandler({
    db,
    verifyIdToken: async (t) => users[t] ?? null,
    now: () => now,
    exportTokenKey: "key" in opts ? opts.key : KEY,
    publicBaseUrl: BASE,
  });
  const call = (method: string, url: string, token?: string, body?: unknown) =>
    handler(
      new Request(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  /** Owner asks for a link, returns the URL to open (rewritten onto the test host's /api prefix). */
  const link = async (kind = "customers", shop = SHOP, who = "owner") => {
    const r = await call("POST", `https://x.test/api/shops/${shop}/admin/export-link`, who, {
      kind,
    });
    return r;
  };
  return { call, link, advance: (ms: number) => (now += ms) };
}

const fetchLink = async (s: ReturnType<typeof setup>) => {
  const r = await s.link();
  expect(r.status).toBe(200);
  const { url } = (await r.json()) as { url: string };
  return url;
};

describe("T24 export link", () => {
  it("owner gets a URL with only a signed token (no customer data, no ID token)", async () => {
    const s = setup();
    const url = await fetchLink(s);
    expect(url.startsWith(`${BASE}/shops/${SHOP}/export-download?token=`)).toBe(true);
    expect(url).not.toContain("owner");
    expect(url).not.toContain("สมศรี");
    expect(url).not.toContain("U1");
    expect(url).not.toContain("UOWNER");
  });

  it("valid token -> CSV attachment (no Authorization header needed)", async () => {
    const s = setup();
    const url = await fetchLink(s);
    const r = await s.call("GET", url.replace(BASE, "https://x.test/api"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toContain("คุณสมศรี");
  });

  it("missing token -> 401", async () => {
    const s = setup();
    const r = await s.call("GET", `https://x.test/api/shops/${SHOP}/export-download`);
    expect(r.status).toBe(401);
  });

  it("garbage / tampered token -> 401", async () => {
    const s = setup();
    const url = (await fetchLink(s)).replace(BASE, "https://x.test/api");
    for (const bad of ["abc", "a.b", url.replace(/.$/, "A").replace(/token=(.)/, "token=$1")]) {
      const u = bad.startsWith("http")
        ? bad
        : `https://x.test/api/shops/${SHOP}/export-download?token=${bad}`;
      expect((await s.call("GET", u)).status).toBe(401);
    }
    // payload swapped to another kind keeps the old signature -> rejected
    const token = new URL(url).searchParams.get("token")!;
    const [, sig] = token.split(".");
    const forged = btoa(
      JSON.stringify({ shopId: SHOP, owner: "UOWNER", kind: "bookings", exp: NOW + 1e6 }),
    ).replace(/=+$/, "");
    const r = await s.call(
      "GET",
      `https://x.test/api/shops/${SHOP}/export-download?token=${forged}.${sig}`,
    );
    expect(r.status).toBe(401);
  });

  it("expired token -> 401 with a Thai message", async () => {
    const s = setup();
    const url = (await fetchLink(s)).replace(BASE, "https://x.test/api");
    s.advance(2 * 60_000 + 1);
    const r = await s.call("GET", url);
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toContain("หมดอายุ");
  });

  it("token for another shop used on this shop's URL -> 403", async () => {
    const s = setup();
    const token = await signExportToken(
      { shopId: OTHER, owner: "UOTHER", kind: "customers", exp: NOW + 60_000 },
      KEY,
    );
    const r = await s.call(
      "GET",
      `https://x.test/api/shops/${SHOP}/export-download?token=${token}`,
    );
    expect(r.status).toBe(403);
  });

  it("token whose owner is no longer the shop owner -> 403", async () => {
    const s = setup({ owner: "UNEWOWNER" });
    const token = await signExportToken(
      { shopId: SHOP, owner: "UOWNER", kind: "customers", exp: NOW + 60_000 },
      KEY,
    );
    const r = await s.call(
      "GET",
      `https://x.test/api/shops/${SHOP}/export-download?token=${token}`,
    );
    expect(r.status).toBe(403);
  });

  it("token signed with another key -> 401", async () => {
    const s = setup();
    const token = await signExportToken(
      { shopId: SHOP, owner: "UOWNER", kind: "customers", exp: NOW + 60_000 },
      "some-other-key-0123456789abcdef0123456789",
    );
    const r = await s.call(
      "GET",
      `https://x.test/api/shops/${SHOP}/export-download?token=${token}`,
    );
    expect(r.status).toBe(401);
  });

  it("only the owner can mint a link: no token 401, customer 403, bad kind 400", async () => {
    const s = setup();
    const path = `https://x.test/api/shops/${SHOP}/admin/export-link`;
    expect((await s.call("POST", path, undefined, { kind: "customers" })).status).toBe(401);
    expect((await s.link("customers", SHOP, "customer")).status).toBe(403);
    expect((await s.link("nope")).status).toBe(400);
    // owner of SHOP cannot mint for OTHER
    expect((await s.link("customers", OTHER)).status).toBe(403);
  });

  it("is off (404) when no signing key is configured", async () => {
    const s = setup({ key: undefined });
    expect((await s.link()).status).toBe(404);
    const r = await s.call("GET", `https://x.test/api/shops/${SHOP}/export-download?token=x`);
    expect(r.status).toBe(404);
  });

  it("token round-trips", async () => {
    const p = { shopId: SHOP, owner: "UOWNER", kind: "bookings" as const, exp: NOW };
    expect(await verifyExportToken(await signExportToken(p, KEY), KEY)).toEqual(p);
  });
});
