// Short-lived, owner-scoped signed token for the CSV download link (T24).
// Format: base64url(JSON payload) "." base64url(HMAC-SHA256(payload part)). The payload holds only
// ids and an expiry (never customer data). Key: EXPORT_TOKEN_KEY (any random string >= 32 chars).

export const EXPORT_TOKEN_TTL_MS = 2 * 60_000;

export interface ExportTokenPayload {
  /** Shop the export belongs to. */
  shopId: string;
  /** LINE user id of the owner who requested it (re-checked against the current owner on use). */
  owner: string;
  kind: "customers" | "bookings";
  /** Expiry, epoch ms. */
  exp: number;
}

const enc = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signExportToken(
  payload: ExportTokenPayload,
  secret: string,
): Promise<string> {
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(body)),
  );
  return `${body}.${toB64Url(sig)}`;
}

/** Returns the payload if the signature is valid, else null. Expiry is checked by the caller. */
export async function verifyExportToken(
  token: string,
  secret: string,
): Promise<ExportTokenPayload | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromB64Url(sig);
  if (!sigBytes) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sigBytes,
    enc.encode(body),
  );
  if (!ok) return null;
  const raw = fromB64Url(body);
  if (!raw) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(raw)) as Partial<ExportTokenPayload>;
    if (
      typeof p.shopId !== "string" ||
      typeof p.owner !== "string" ||
      (p.kind !== "customers" && p.kind !== "bookings") ||
      typeof p.exp !== "number"
    ) {
      return null;
    }
    return { shopId: p.shopId, owner: p.owner, kind: p.kind, exp: p.exp };
  } catch {
    return null;
  }
}
