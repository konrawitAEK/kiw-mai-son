// AES-256-GCM for shop LINE channel secrets/tokens (stored encrypted at rest).
// Layout (matches supabase/functions/line-webhook/channels.ts): iv (12 bytes) || ciphertext+tag.
// Key: CHANNEL_TOKEN_ENC_KEY = base64 of 32 random bytes. Uses WebCrypto (Node 20+ and Deno).

const IV_BYTES = 12;

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importKey(keyBase64: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(keyBase64);
  } catch {
    throw new Error("CHANNEL_TOKEN_ENC_KEY must be base64");
  }
  if (raw.byteLength !== 32) throw new Error("CHANNEL_TOKEN_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}

export async function encryptSecret(plain: string, keyBase64: string): Promise<Uint8Array> {
  const key = await importKey(keyBase64, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

export async function decryptSecret(box: Uint8Array, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: box.slice(0, IV_BYTES) },
    key,
    box.slice(IV_BYTES),
  );
  return new TextDecoder().decode(plain);
}
