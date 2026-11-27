// Supabase Edge Function (Deno) entry for the LINE webhook. Thin wiring only:
// logic and tests live in packages/api (webhook.ts). Deploy with JWT verification off
// (LINE signs requests; the handler verifies X-Line-Signature with the shop's channel secret):
//   supabase functions deploy line-webhook --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHANNEL_TOKEN_ENC_KEY.
// Set each shop's webhook URL (LINE console) to the deployed function URL.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createWebhookHandler, createLineReply } from "../../../packages/api/src/webhook.ts";
import { createSupabaseDb } from "../api/supabase-db.ts";
import { createChannelLookup } from "./channels.ts";

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(
  createWebhookHandler({
    db: createSupabaseDb(supabase),
    getChannelByDestination: createChannelLookup(supabase, Deno.env.get("CHANNEL_TOKEN_ENC_KEY")!),
    reply: createLineReply(),
  }),
);
