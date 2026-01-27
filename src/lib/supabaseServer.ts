import { createClient } from "@supabase/supabase-js";

/**
 * Create a Supabase client configured with the project's URL and service
 * role key. This helper is used in API routes to interact with the Supabase
 * database with elevated privileges (service role) while server‑side.
 */
export function supabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}