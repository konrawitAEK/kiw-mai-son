import { describe, expect, it, vi } from "vitest";
import type { Service, Staff } from "@kms/core";
import { createHandler } from "./handler.js";
import { createLineChannelValidator } from "./line-channel.js";
import { ONB_MSG } from "./onboarding.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import type { Db, LineChannelRow, OnboardingDb, OnboardingDeps } from "./types.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const STAFF = "33333333-3333-4333-8333-333333333331";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN = "TOKEN-abcdefghijklmnopqrstuvwxyz0123456789";

const USERS: Record<string, { userId: string; displayName: string }> = {
  owner: { userId: "UOWNER", displayName: "เจ้าของ" },
  stranger: { userId: "USTRANGER", displayName: "คนอื่น" },
};

/** PNG header with the given size (enough for validateRichMenuImage). */
function png(width: number, height: number): string {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return btoa(String.fromCharCode(...b));
}

function setup(over: Partial<OnboardingDeps> = {}, dbOver: Partial<OnboardingDb> = {}) {
  let channel: LineChannelRow | null = null;
  const db: OnboardingDb = {
    findShopByOwner: async (u) => (u === "UOWNER" ? { id: SHOP, name: "ร้านเอ" } : null),
    createShop: vi.fn(async () => OTHER),
    getShopName: async () => "ร้านเอ",
    saveLineChannel: vi.fn(async (i) => {
      channel = {
        channelId: i.channelId,
        destination: i.destination,
        secretEnc: i.secretEnc,
        tokenEnc: i.tokenEnc,
        richMenuId: null,
      };
      return "ok" as const;
    }),
    getLineChannel: async () => channel,
    setRichMenuId: vi.fn(async () => {}),
    insertService: vi.fn(async (shopId, s) => ({ id: "svc", shopId, ...s }) as Service),
    insertStaff: vi.fn(async (shopId, name) => ({ id: STAFF, shopId, name }) as Staff),
    replaceWorkingHours: vi.fn(async (_s, id) => id === STAFF),
    listWorkingHours: async () => [{ staffId: STAFF, weekday: 1, start: "10:00", end: "19:00" }],
    ...dbOver,
  };
  const validateChannel = vi.fn(async () => ({
    ok: true as const,
    destination: "Ubot123",
    botName: "ร้านเอ OA",
  }));
  const onboarding: OnboardingDeps = {
    db,
    validateChannel,
    encryptionKey: KEY,
    liffId: "1234567890-AbCdEfGh",
    ...over,
  };
  const mainDb = {
    getShopOwner: async (id: string) => (id === SHOP ? "UOWNER" : null),
  } as unknown as Db;
  const handler = createHandler({
    db: mainDb,
    onboarding,
    verifyIdToken: async (t) => USERS[t] ?? null,
    now: () => Date.now(),
  });
  const call = (method: string, path: string, who: string | null, body?: unknown) =>
    handler(
      new Request(`https://x.test${path}`, {
        method,
        headers: {
          ...(who ? { Authorization: `Bearer ${who}` } : {}),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, db, validateChannel };
}

const channelBody = { channelId: "1234567890", channelSecret: SECRET, accessToken: TOKEN };

describe("secret box", () => {
  it("round-trips and does not store plaintext", async () => {
    const box = await encryptSecret(SECRET, KEY);
    expect(new TextDecoder().decode(box)).not.toContain(SECRET);
    expect(await decryptSecret(box, KEY)).toBe(SECRET);
  });
  it("uses a fresh iv each time and rejects a wrong key / tampering", async () => {
    const a = await encryptSecret(SECRET, KEY);
    const b = await encryptSecret(SECRET, KEY);
    expect(a).not.toEqual(b);
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await expect(decryptSecret(a, other)).rejects.toThrow();
    a[a.length - 1] = (a[a.length - 1] ?? 0) ^ 1;
    await expect(decryptSecret(a, KEY)).rejects.toThrow();
  });
  it("rejects a key of the wrong length", async () => {
    await expect(encryptSecret("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});

describe("LINE channel validator", () => {
  const res = (status: number, body: unknown = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  it("accepts good credentials and returns the bot userId", async () => {
    const f = vi.fn(async (url: string, _init: { headers: Record<string, string> }) =>
      url.endsWith("/oauth/accessToken")
        ? res(200, { access_token: "short" })
        : res(200, { userId: "Ubot1", displayName: "ร้าน" }),
    );
    const r = await createLineChannelValidator(f)({
      channelId: "1",
      channelSecret: "s",
      accessToken: "t",
    });
    expect(r).toEqual({ ok: true, destination: "Ubot1", botName: "ร้าน" });
    expect(f.mock.calls[1]?.[1].headers["Authorization"]).toBe("Bearer t");
  });
  it("maps a rejected id/secret, a rejected token and outages", async () => {
    const v = (a: number, b: number) =>
      createLineChannelValidator(async (url) =>
        url.endsWith("/oauth/accessToken") ? res(a) : res(b),
      )({ channelId: "1", channelSecret: "s", accessToken: "t" });
    expect(await v(400, 200)).toEqual({ ok: false, reason: "bad_credentials" });
    expect(await v(200, 401)).toEqual({ ok: false, reason: "bad_token" });
    expect(await v(503, 200)).toEqual({ ok: false, reason: "unreachable" });
    const boom = createLineChannelValidator(async () => {
      throw new Error("net");
    });
    expect(await boom({ channelId: "1", channelSecret: "s", accessToken: "t" })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("POST /onboarding/shops", () => {
  it("requires a LINE login", async () => {
    expect((await setup().call("POST", "/onboarding/shops", null, { name: "x" })).status).toBe(401);
  });
  it("creates a shop owned by the caller", async () => {
    const { call, db } = setup();
    const r = await call("POST", "/onboarding/shops", "stranger", { name: "  ร้านบี " });
    expect(r.status).toBe(201);
    expect(db.createShop).toHaveBeenCalledWith("ร้านบี", "USTRANGER");
  });
  it("returns the existing shop instead of creating a second one", async () => {
    const { call, db } = setup();
    const r = await call("POST", "/onboarding/shops", "owner", {});
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ shopId: SHOP, created: false });
    expect(db.createShop).not.toHaveBeenCalled();
  });
  it("rejects an empty name and a wrong invite code", async () => {
    expect(
      (await setup().call("POST", "/onboarding/shops", "stranger", { name: " " })).status,
    ).toBe(400);
    const { call, db } = setup({ inviteCode: "OPEN-SESAME" });
    const bad = await call("POST", "/onboarding/shops", "stranger", {
      name: "ร้านบี",
      inviteCode: "no",
    });
    expect(bad.status).toBe(403);
    expect(db.createShop).not.toHaveBeenCalled();
    const good = await call("POST", "/onboarding/shops", "stranger", {
      name: "ร้านบี",
      inviteCode: "OPEN-SESAME",
    });
    expect(good.status).toBe(201);
  });
});

describe("access control", () => {
  it("onboarding admin routes are owner-only", async () => {
    const { call } = setup();
    for (const [m, p, b] of [
      ["GET", `/shops/${SHOP}/admin/setup`, undefined],
      ["PUT", `/shops/${SHOP}/admin/line-channel`, channelBody],
      ["POST", `/shops/${SHOP}/admin/services`, { name: "a", durationMin: 30, price: 1 }],
      ["POST", `/shops/${SHOP}/admin/staff`, { name: "a" }],
      ["POST", `/shops/${SHOP}/admin/rich-menu`, { imageBase64: png(2500, 843) }],
    ] as const) {
      expect((await call(m, p, null, b)).status).toBe(401);
      expect((await call(m, p, "stranger", b)).status).toBe(403);
    }
  });
  it("routes are absent when onboarding is not configured", async () => {
    const handler = createHandler({
      db: { getShopOwner: async () => "UOWNER" } as unknown as Db,
      verifyIdToken: async (t) => USERS[t] ?? null,
      now: () => 0,
    });
    const r = await handler(
      new Request("https://x.test/onboarding/shops", {
        method: "POST",
        headers: { Authorization: "Bearer owner" },
        body: "{}",
      }),
    );
    expect(r.status).toBe(404);
  });
});

describe("PUT line-channel", () => {
  const put = (s: ReturnType<typeof setup>, body: unknown) =>
    s.call("PUT", `/shops/${SHOP}/admin/line-channel`, "owner", body);

  it("validates against LINE, stores ciphertext only and never echoes secrets", async () => {
    const s = setup();
    const r = await put(s, channelBody);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ channel: { destination: "Ubot123" } });
    const saved = vi.mocked(s.db.saveLineChannel).mock.calls[0]?.[0];
    expect(saved?.destination).toBe("Ubot123");
    expect(new TextDecoder().decode(saved?.secretEnc)).not.toContain(SECRET);
    expect(await decryptSecret(saved!.secretEnc, KEY)).toBe(SECRET);
    expect(await decryptSecret(saved!.tokenEnc, KEY)).toBe(TOKEN);
  });
  it("returns Thai errors and stores nothing when LINE rejects", async () => {
    const bad = setup({
      validateChannel: async () => ({ ok: false, reason: "bad_credentials" }),
    });
    const r1 = await put(bad, channelBody);
    expect(r1.status).toBe(422);
    expect(await r1.json()).toEqual({ error: ONB_MSG.badCredentials });
    expect(bad.db.saveLineChannel).not.toHaveBeenCalled();

    const tok = setup({ validateChannel: async () => ({ ok: false, reason: "bad_token" }) });
    expect(((await (await put(tok, channelBody)).json()) as { error: string }).error).toBe(
      ONB_MSG.badToken,
    );
    const down = setup({ validateChannel: async () => ({ ok: false, reason: "unreachable" }) });
    expect((await put(down, channelBody)).status).toBe(502);
  });
  it("rejects malformed input before calling LINE", async () => {
    const s = setup();
    expect((await put(s, { ...channelBody, channelId: "abc" })).status).toBe(400);
    expect((await put(s, { ...channelBody, channelSecret: "short" })).status).toBe(400);
    expect((await put(s, { ...channelBody, accessToken: "has space in it......." })).status).toBe(
      400,
    );
    expect((await put(s, null)).status).toBe(400);
    expect(s.validateChannel).not.toHaveBeenCalled();
  });
  it("409 when the channel belongs to another shop", async () => {
    const s = setup({}, { saveLineChannel: async () => "taken" });
    const r = await put(s, channelBody);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: ONB_MSG.channelTaken });
  });
});

describe("setup, services, staff, hours", () => {
  it("setup status never contains secrets", async () => {
    const s = setup();
    await s.call("PUT", `/shops/${SHOP}/admin/line-channel`, "owner", channelBody);
    const r = await s.call("GET", `/shops/${SHOP}/admin/setup`, "owner");
    const text = await r.text();
    expect(text).not.toMatch(/secret|token|Enc/i);
    expect(JSON.parse(text)).toMatchObject({
      channel: { connected: true, channelId: "1234567890" },
      richMenuDone: false,
      staffWithHours: [STAFF],
    });
  });
  it("adds a service with validation", async () => {
    const s = setup();
    const p = `/shops/${SHOP}/admin/services`;
    expect(
      (await s.call("POST", p, "owner", { name: "ตัดผม", durationMin: 30, price: 300 })).status,
    ).toBe(201);
    expect(s.db.insertService).toHaveBeenCalledWith(SHOP, {
      name: "ตัดผม",
      durationMin: 30,
      price: 300,
      deposit: 0,
    });
    for (const bad of [
      { name: "", durationMin: 30, price: 1 },
      { name: "a", durationMin: 0, price: 1 },
      { name: "a", durationMin: 30, price: -1 },
      { name: "a", durationMin: 30.5, price: 1 },
      { name: "a", durationMin: 30, price: 100, deposit: 200 },
    ]) {
      expect((await s.call("POST", p, "owner", bad)).status).toBe(400);
    }
  });
  it("adds staff and sets hours; unknown staff is 404; bad windows 400", async () => {
    const s = setup();
    expect(
      (await s.call("POST", `/shops/${SHOP}/admin/staff`, "owner", { name: "พี่แอน" })).status,
    ).toBe(201);
    const hp = `/shops/${SHOP}/admin/staff/${STAFF}/hours`;
    const windows = [
      { weekday: 1, start: "10:00", end: "19:00" },
      { weekday: 2, start: "10:00", end: "12:00" },
    ];
    expect((await s.call("PUT", hp, "owner", { windows })).status).toBe(200);
    expect(s.db.replaceWorkingHours).toHaveBeenCalledWith(SHOP, STAFF, windows);
    expect(
      (await s.call("PUT", `/shops/${SHOP}/admin/staff/${OTHER}/hours`, "owner", { windows }))
        .status,
    ).toBe(404);
    for (const bad of [
      [{ weekday: 7, start: "10:00", end: "11:00" }],
      [{ weekday: 1, start: "19:00", end: "10:00" }],
      [{ weekday: 1, start: "9:00", end: "10:00" }],
      "nope",
    ]) {
      expect((await s.call("PUT", hp, "owner", { windows: bad })).status).toBe(400);
    }
  });
});

describe("POST rich-menu", () => {
  const url = `/shops/${SHOP}/admin/rich-menu`;
  it("needs a connected channel", async () => {
    const r = await setup().call("POST", url, "owner", { imageBase64: png(2500, 843) });
    expect(r.status).toBe(409);
  });
  it("runs the setup with the decrypted token and records the menu id", async () => {
    const richMenu = vi.fn(async (_i: { accessToken?: string }) => ({
      mode: "live" as const,
      richMenuId: "richmenu-1",
      steps: [],
      menu: {} as never,
    }));
    const s = setup({ richMenu });
    await s.call("PUT", `/shops/${SHOP}/admin/line-channel`, "owner", channelBody);
    const r = await s.call("POST", url, "owner", { imageBase64: png(2500, 843) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ richMenuId: "richmenu-1" });
    const arg = richMenu.mock.calls[0]?.[0] as unknown as {
      accessToken: string;
      shopId: string;
      dryRun: boolean;
    };
    expect(arg).toMatchObject({ accessToken: TOKEN, shopId: SHOP, dryRun: false });
    expect(s.db.setRichMenuId).toHaveBeenCalledWith(SHOP, "richmenu-1");
  });
  it("rejects wrong-size or non-PNG images without calling LINE", async () => {
    const richMenu = vi.fn();
    const s = setup({ richMenu });
    await s.call("PUT", `/shops/${SHOP}/admin/line-channel`, "owner", channelBody);
    expect((await s.call("POST", url, "owner", { imageBase64: png(100, 100) })).status).toBe(400);
    expect(
      (await s.call("POST", url, "owner", { imageBase64: btoa("not a png at all, sorry!!") }))
        .status,
    ).toBe(400);
    expect((await s.call("POST", url, "owner", {})).status).toBe(400);
    expect(richMenu).not.toHaveBeenCalled();
  });
  it("hides LINE error details (which could echo credentials)", async () => {
    const s = setup({
      richMenu: async () => {
        throw new Error(`LINE API 401: Bearer ${TOKEN}`);
      },
    });
    await s.call("PUT", `/shops/${SHOP}/admin/line-channel`, "owner", channelBody);
    const r = await s.call("POST", url, "owner", { imageBase64: png(2500, 843) });
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain(TOKEN);
  });
});
