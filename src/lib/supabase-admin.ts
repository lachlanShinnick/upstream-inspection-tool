import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the secret (service-role) key.
 * Bypasses RLS — never import this into a client component.
 *
 * Lazily constructed so a missing key fails at call time with a clear message,
 * instead of throwing at import time and taking down every page that touches auth.
 */
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_SECRET_KEY " +
        "(Project Settings -> API Keys -> secret key) in .env.local.",
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
