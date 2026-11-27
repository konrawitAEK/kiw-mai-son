import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RICH_MENU_HEIGHT,
  RICH_MENU_MAX_IMAGE_BYTES,
  RICH_MENU_WIDTH,
  buildRichMenuBody,
  setupRichMenu,
  validateRichMenuImage,
} from "./rich-menu.js";
import type { FetchLike } from "./rich-menu.js";

const LIFF_ID = "1234567890-AbCdEfGh";
const SHOP_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "test-channel-token-DO-NOT-LEAK";

/** A PNG header (signature + IHDR) of the given pixel size. Only the header is checked. */
function pngOfSize(width: number, height: number, extraBytes = 0): Uint8Array {
  const buf = new Uint8Array(33 + extraBytes);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

describe("buildRichMenuBody", () => {
  it("builds three Thai-labelled areas that cover the full 2500x843 width", () => {
    const menu = buildRichMenuBody({ liffId: LIFF_ID, shopId: SHOP_ID });
    expect(menu.size).toEqual({ width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT });
    expect(menu.areas).toHaveLength(3);
    const labels = menu.areas.map((a) => a.action.label);
    expect(labels).toEqual(["จองคิว", "นัดของฉัน", "ติดต่อร้าน"]);

    const widths = menu.areas.reduce((sum, a) => sum + a.bounds.width, 0);
    expect(widths).toBe(RICH_MENU_WIDTH);
    // Columns are contiguous: each x starts where the previous one ends.
    let x = 0;
    for (const area of menu.areas) {
      expect(area.bounds.x).toBe(x);
      expect(area.bounds.y).toBe(0);
      expect(area.bounds.height).toBe(RICH_MENU_HEIGHT);
      x += area.bounds.width;
    }
  });

  it("points the booking and my-bookings buttons at the LIFF app with the shop id", () => {
    const menu = buildRichMenuBody({ liffId: LIFF_ID, shopId: SHOP_ID });
    const [book, mine, contact] = menu.areas.map((a) => a.action);
    expect(book).toEqual({
      type: "uri",
      label: "จองคิว",
      uri: `https://liff.line.me/${LIFF_ID}?shop=${SHOP_ID}`,
    });
    expect(mine).toEqual({
      type: "uri",
      label: "นัดของฉัน",
      uri: `https://liff.line.me/${LIFF_ID}?shop=${SHOP_ID}&page=my-bookings`,
    });
    expect(contact).toEqual({ type: "message", label: "ติดต่อร้าน", text: "ติดต่อร้าน" });
  });

  it("respects LINE length limits (chat bar text at most 14 chars, labels at most 20)", () => {
    const menu = buildRichMenuBody({ liffId: LIFF_ID, shopId: SHOP_ID });
    expect([...menu.chatBarText].length).toBeLessThanOrEqual(14);
    for (const area of menu.areas) {
      expect([...area.action.label].length).toBeLessThanOrEqual(20);
    }
  });

  it("rejects a malformed LIFF id or shop id", () => {
    expect(() => buildRichMenuBody({ liffId: "not-a-liff-id", shopId: SHOP_ID })).toThrow(/liffId/);
    expect(() => buildRichMenuBody({ liffId: LIFF_ID, shopId: "shop-1" })).toThrow(/shopId/);
  });
});

describe("validateRichMenuImage", () => {
  it("accepts a PNG of exactly 2500x843", () => {
    expect(validateRichMenuImage(pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT))).toBeNull();
  });

  it("rejects the wrong pixel size", () => {
    expect(validateRichMenuImage(pngOfSize(2500, 1686))).toMatch(/2500x843/);
  });

  it("rejects non-PNG bytes", () => {
    const jpegLike = new Uint8Array(40).fill(0xff);
    expect(validateRichMenuImage(jpegLike)).toMatch(/not a PNG/);
  });

  it("rejects files over the 1 MB limit", () => {
    const big = pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT, RICH_MENU_MAX_IMAGE_BYTES);
    expect(validateRichMenuImage(big)).toMatch(/1 MB/);
  });
});

describe("setupRichMenu dry-run", () => {
  it("returns the planned LINE calls and never touches the network", async () => {
    const fetchFn = vi.fn<FetchLike>();
    const result = await setupRichMenu({
      shopId: SHOP_ID,
      liffId: LIFF_ID,
      dryRun: true,
      accessToken: TOKEN,
      image: pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT),
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.mode).toBe("dry-run");
    expect(result.richMenuId).toBeNull();
    expect(result.steps.map((s) => s.step)).toEqual(["create-menu", "upload-image", "set-default"]);
    expect(result.steps[1]?.url).toBe(
      "https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content",
    );
  });

  it("works without a token or image and never prints the token", async () => {
    const result = await setupRichMenu({ shopId: SHOP_ID, liffId: LIFF_ID, dryRun: true });
    expect(result.steps[1]?.summary).toMatch(/not provided/);
    const text = JSON.stringify(result);
    expect(text).not.toContain(TOKEN);
  });

  it("still validates the image when one is given", async () => {
    await expect(
      setupRichMenu({
        shopId: SHOP_ID,
        liffId: LIFF_ID,
        dryRun: true,
        image: pngOfSize(100, 100),
      }),
    ).rejects.toThrow(/2500x843/);
  });
});

describe("setupRichMenu live run", () => {
  it("creates the menu, uploads the image, then sets it as default, in that order", async () => {
    const image = pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT);
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      if (url.endsWith("/richmenu")) return okJson({ richMenuId: "richmenu-abc" });
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    });

    const result = await setupRichMenu({
      shopId: SHOP_ID,
      liffId: LIFF_ID,
      dryRun: false,
      accessToken: TOKEN,
      image,
      fetchFn,
    });

    expect(result.mode).toBe("live");
    expect(result.richMenuId).toBe("richmenu-abc");
    const calls = fetchFn.mock.calls.map(([url, init]) => [url, init.method]);
    expect(calls).toEqual([
      ["https://api.line.me/v2/bot/richmenu", "POST"],
      ["https://api-data.line.me/v2/bot/richmenu/richmenu-abc/content", "POST"],
      ["https://api.line.me/v2/bot/user/all/richmenu/richmenu-abc", "POST"],
    ]);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    }
    expect(fetchFn.mock.calls[1]?.[1].headers["Content-Type"]).toBe("image/png");
  });

  it("refuses a live run without a token or image, before any network call", async () => {
    const fetchFn = vi.fn<FetchLike>();
    await expect(
      setupRichMenu({
        shopId: SHOP_ID,
        liffId: LIFF_ID,
        dryRun: false,
        image: pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT),
        fetchFn,
      }),
    ).rejects.toThrow(/LINE_CHANNEL_ACCESS_TOKEN/);
    await expect(
      setupRichMenu({
        shopId: SHOP_ID,
        liffId: LIFF_ID,
        dryRun: false,
        accessToken: TOKEN,
        fetchFn,
      }),
    ).rejects.toThrow(/--image/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces a LINE error without echoing the token", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"message":"Authentication failed"}',
    }));
    const err = await setupRichMenu({
      shopId: SHOP_ID,
      liffId: LIFF_ID,
      dryRun: false,
      accessToken: TOKEN,
      image: pngOfSize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT),
      fetchFn,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/LINE API 401/);
    expect((err as Error).message).not.toContain(TOKEN);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("rich-menu CLI", () => {
  const script = fileURLToPath(new URL("./rich-menu.ts", import.meta.url));

  it("runs in dry-run mode from the command line and prints a plan", () => {
    const run = spawnSync(process.execPath, [script, "--dry-run", "--shop-id", SHOP_ID], {
      env: { PATH: process.env["PATH"] ?? "", LIFF_ID, LINE_CHANNEL_ACCESS_TOKEN: TOKEN },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout) as { mode: string; steps: unknown[]; richMenuId: null };
    expect(out.mode).toBe("dry-run");
    expect(out.steps).toHaveLength(3);
    expect(out.richMenuId).toBeNull();
    expect(run.stdout).not.toContain(TOKEN);
  });

  it("exits non-zero when the shop id is missing", () => {
    const run = spawnSync(process.execPath, [script, "--dry-run"], {
      env: { PATH: process.env["PATH"] ?? "", LIFF_ID },
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--shop-id/);
  });
});
