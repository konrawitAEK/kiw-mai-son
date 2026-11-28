// Supabase Edge Function (Deno): health-check endpoint (T15). GET /functions/v1/health -> 200 {"status":"ok"} or 503.
// Point a free uptime pinger (e.g. UptimeRobot free plan) at it. Deploy with:
//   supabase functions deploy health --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// FOUNDER_LINE_CHANNEL_TOKEN, FOUNDER_LINE_USER_ID. NOT tested locally (needs a real database).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createFounderAlerter, createHealthHandler } from "../../../packages/api/src/monitoring.ts";

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(
  createHealthHandler({
    async pingDb() {
      const { error } = await supabase.from("shops").select("id").limit(1);
      if (error) throw new Error(error.message);
    },
    now: () => new Date(),
    alert: createFounderAlerter({
      channelAccessToken: Deno.env.get("FOUNDER_LINE_CHANNEL_TOKEN"),
      founderUserId: Deno.env.get("FOUNDER_LINE_USER_ID"),
    }),
  }),
);
