// Supabase Edge Function (Deno) entry for the booking API. Thin wiring only:
// all logic and tests live in packages/api (handler.ts). Deploy with JWT
// verification off (auth is the LIFF ID token, checked in the handler):
//   supabase functions deploy api --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LINE_LOGIN_CHANNEL_ID, and for onboarding (T13):
// CHANNEL_TOKEN_ENC_KEY, LIFF_ID, optional ONBOARDING_INVITE_CODE (names only; see .env.example).
// Bundling note: imports below use relative paths into packages/ so `supabase functions deploy` can bundle them.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createHandler } from "../../../packages/api/src/handler.ts";
import { createLineVerifier } from "../../../packages/api/src/line-verify.ts";
import { createLineChannelValidator } from "../../../packages/api/src/line-channel.ts";
import { createSupabaseOnboardingDb } from "./onboarding-db.ts";
import { createSupabaseDb } from "./supabase-db.ts";

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(
  createHandler({
    db: createSupabaseDb(supabase),
    // Onboarding is only switched on when the encryption key is configured (never store secrets unencrypted).
    onboarding: Deno.env.get("CHANNEL_TOKEN_ENC_KEY")
      ? {
          db: createSupabaseOnboardingDb(supabase),
          validateChannel: createLineChannelValidator(),
          encryptionKey: Deno.env.get("CHANNEL_TOKEN_ENC_KEY")!,
          liffId: Deno.env.get("LIFF_ID") ?? "",
          inviteCode: Deno.env.get("ONBOARDING_INVITE_CODE") || undefined,
        }
      : undefined,
    verifyIdToken: createLineVerifier(Deno.env.get("LINE_LOGIN_CHANNEL_ID") ?? ""),
    now: () => Date.now(),
  }),
);
