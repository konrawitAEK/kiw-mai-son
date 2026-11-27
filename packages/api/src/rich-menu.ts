// Rich menu setup for one shop's LINE channel (T9).
//
// Usage (from repo root):
//   node packages/api/src/rich-menu.ts --shop-id <uuid> --image <menu.png> [--dry-run]
//
// Env: LIFF_ID (LIFF app id, same as VITE_LIFF_ID), LINE_CHANNEL_ACCESS_TOKEN (the shop's
// channel token; read from env only, never printed or written to disk).
// --dry-run prints the exact LINE API calls it would make and makes NO network calls.
//
// Self-contained on purpose (no relative imports, no enums or parameter properties) so
// Node 22 can run this file directly with built-in type stripping.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const RICH_MENU_WIDTH = 2500;
export const RICH_MENU_HEIGHT = 843;
export const RICH_MENU_MAX_IMAGE_BYTES = 1024 * 1024; // LINE limit: 1 MB
export const RICH_MENU_NAME = "คิวไม่ซ้อน เมนูร้าน";
export const RICH_MENU_CHAT_BAR_TEXT = "เมนูร้าน"; // LINE limit: 14 characters
export const RICH_MENU_CONTACT_TEXT = "ติดต่อร้าน";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

const LIFF_ID_RE = /^\d{10}-[A-Za-z0-9]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type RichMenuAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "message"; label: string; text: string };

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: RichMenuAction;
}

export interface RichMenuBody {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
}

/** Three equal-ish columns across the 2500 x 843 compact layout (widths sum to 2500). */
const COLUMNS: { x: number; width: number }[] = [
  { x: 0, width: 833 },
  { x: 833, width: 834 },
  { x: 1667, width: 833 },
];

/** Builds the LINE rich menu body. Pure: no I/O. Throws on malformed ids. */
export function buildRichMenuBody(input: { liffId: string; shopId: string }): RichMenuBody {
  if (!LIFF_ID_RE.test(input.liffId)) {
    throw new Error("liffId must look like 1234567890-AbCdEfGh");
  }
  if (!UUID_RE.test(input.shopId)) {
    throw new Error("shopId must be a UUID");
  }
  const liff = `https://liff.line.me/${input.liffId}?shop=${encodeURIComponent(input.shopId)}`;
  const actions: RichMenuAction[] = [
    { type: "uri", label: "จองคิว", uri: liff },
    { type: "uri", label: "นัดของฉัน", uri: `${liff}&page=my-bookings` },
    { type: "message", label: "ติดต่อร้าน", text: RICH_MENU_CONTACT_TEXT },
  ];
  return {
    size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: RICH_MENU_CHAT_BAR_TEXT,
    areas: actions.map((action, i) => {
      const col = COLUMNS[i];
      if (!col) throw new Error("missing column");
      return { bounds: { x: col.x, y: 0, width: col.width, height: RICH_MENU_HEIGHT }, action };
    }),
  };
}

/** Checks a PNG's signature, exact pixel size and the 1 MB limit. Returns an error string or null. */
export function validateRichMenuImage(bytes: Uint8Array): string | null {
  if (bytes.byteLength > RICH_MENU_MAX_IMAGE_BYTES) return "image is larger than 1 MB";
  if (bytes.byteLength < 24) return "image is not a PNG";
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return "image is not a PNG";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== RICH_MENU_WIDTH || height !== RICH_MENU_HEIGHT) {
    return `image must be ${RICH_MENU_WIDTH}x${RICH_MENU_HEIGHT}px, got ${width}x${height}`;
  }
  return null;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: BodyInit },
) => Promise<FetchResponseLike>;

export interface RichMenuSetupInput {
  shopId: string;
  liffId: string;
  dryRun: boolean;
  /** PNG bytes. Required for a live run; optional in dry-run (then only its absence is shown). */
  image?: Uint8Array;
  /** Shop channel access token. Required for a live run only. Never included in any output. */
  accessToken?: string;
  fetchFn?: FetchLike;
}

export interface PlannedStep {
  step: "create-menu" | "upload-image" | "set-default";
  method: "POST";
  url: string;
  contentType: string;
  /** Summary only; the token and raw image bytes never appear here. */
  summary: string;
}

export interface RichMenuSetupResult {
  mode: "dry-run" | "live";
  richMenuId: string | null;
  steps: PlannedStep[];
  menu: RichMenuBody;
}

/**
 * Creates the rich menu on a shop's LINE channel, uploads its image and makes it the default
 * for all users. In dry-run mode nothing is sent: it returns the planned steps only.
 */
export async function setupRichMenu(input: RichMenuSetupInput): Promise<RichMenuSetupResult> {
  const menu = buildRichMenuBody({ liffId: input.liffId, shopId: input.shopId });
  if (input.image) {
    const imageError = validateRichMenuImage(input.image);
    if (imageError) throw new Error(imageError);
  }
  const imageSummary = input.image
    ? `PNG ${input.image.byteLength} bytes`
    : "image not provided (dry-run only)";

  const plannedSteps: PlannedStep[] = [
    {
      step: "create-menu",
      method: "POST",
      url: `${LINE_API}/richmenu`,
      contentType: "application/json",
      summary: `menu with ${menu.areas.length} areas, chatBarText "${menu.chatBarText}"`,
    },
    {
      step: "upload-image",
      method: "POST",
      url: `${LINE_DATA_API}/richmenu/{richMenuId}/content`,
      contentType: "image/png",
      summary: imageSummary,
    },
    {
      step: "set-default",
      method: "POST",
      url: `${LINE_API}/user/all/richmenu/{richMenuId}`,
      contentType: "application/json",
      summary: "make default for all users of this channel",
    },
  ];

  if (input.dryRun) {
    return { mode: "dry-run", richMenuId: null, steps: plannedSteps, menu };
  }

  if (!input.accessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required for a live run");
  if (!input.image) throw new Error("--image <menu.png> is required for a live run");
  const fetchFn = input.fetchFn ?? (fetch as unknown as FetchLike);
  const auth = { Authorization: `Bearer ${input.accessToken}` };

  const created = await callLine(fetchFn, `${LINE_API}/richmenu`, {
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(menu),
    expectJson: true,
  });
  const richMenuId = readRichMenuId(created);

  await callLine(fetchFn, `${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    headers: { ...auth, "Content-Type": "image/png" },
    body: input.image,
    expectJson: false,
  });

  await callLine(fetchFn, `${LINE_API}/user/all/richmenu/${richMenuId}`, {
    headers: { ...auth, "Content-Type": "application/json" },
    body: "{}",
    expectJson: false,
  });

  return { mode: "live", richMenuId, steps: plannedSteps, menu };
}

function readRichMenuId(data: unknown): string {
  const id = (data as { richMenuId?: unknown } | null)?.richMenuId;
  if (typeof id !== "string" || id === "") throw new Error("LINE did not return a richMenuId");
  return id;
}

async function callLine(
  fetchFn: FetchLike,
  url: string,
  opts: { headers: Record<string, string>; body: BodyInit; expectJson: boolean },
): Promise<unknown> {
  const res = await fetchFn(url, { method: "POST", headers: opts.headers, body: opts.body });
  if (!res.ok) {
    // LINE's error text is useful; the request headers (token) are never echoed.
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${res.status} at ${url.split("?")[0]}: ${detail.slice(0, 300)}`);
  }
  return opts.expectJson ? res.json() : undefined;
}

// ---- CLI ----

function parseArgs(argv: string[]): { dryRun: boolean; shopId: string; image: string | null } {
  let dryRun = false;
  let shopId = "";
  let image: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--shop-id") shopId = argv[++i] ?? "";
    else if (arg === "--image") image = argv[++i] ?? null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!shopId) throw new Error("--shop-id <uuid> is required");
  return { dryRun, shopId, image };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const liffId = process.env["LIFF_ID"] ?? "";
  const accessToken = process.env["LINE_CHANNEL_ACCESS_TOKEN"];
  const image = args.image ? new Uint8Array(await readFile(args.image)) : undefined;
  const result = await setupRichMenu({
    shopId: args.shopId,
    liffId,
    dryRun: args.dryRun,
    image,
    accessToken,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`rich-menu: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
