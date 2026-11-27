// Looks up a shop's LINE channel by webhook `destination` and decrypts its secret/token.
// Not unit-tested (needs a real database). ASSUMPTION to confirm at H3/H5: the two
// *_encrypted bytea columns hold AES-256-GCM output laid out as iv(12 bytes) || ciphertext+tag,
// keyed by CHANNEL_TOKEN_ENC_KEY (base64, 32 bytes). The onboarding task (T13) writes them this way.
import type { ChannelInfo } from "../../../packages/api/src/webhook.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** PostgREST returns bytea as "\\x<hex>". */
function hexToBytes(v: string): Uint8Array {
  const hex = v.startsWith("\\x") ? v.slice(2) : v;
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

async function decrypt(key: CryptoKey, bytea: string): Promise<string> {
  const buf = hexToBytes(bytea);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) },
    key,
    buf.slice(12),
  );
  return new TextDecoder().decode(plain);
}

export function createChannelLookup(sb: Client, encKeyBase64: string) {
  const keyPromise = crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(encKeyBase64), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return async (destination: string): Promise<ChannelInfo | null> => {
    const { data, error } = await sb
      .from("line_channels")
      .select("shop_id, channel_secret_encrypted, channel_access_token_encrypted, shops(name)")
      .eq("destination", destination)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const key = await keyPromise;
    return {
      shopId: data.shop_id,
      shopName: data.shops?.name ?? "",
      channelSecret: await decrypt(key, data.channel_secret_encrypted),
      channelAccessToken: await decrypt(key, data.channel_access_token_encrypted),
    };
  };
}
