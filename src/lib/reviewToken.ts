import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type ReviewScope = { inspectionId: string };

/**
 * Reuse an existing non-expired review token for this inspection if one
 * exists (so a resent link doesn't invalidate a link Dave already has open),
 * otherwise mint a fresh one.
 */
export async function mintOrReuseReviewToken(
  inspectionId: string,
): Promise<string> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("review_tokens")
    .select("token, expires_at")
    .eq("inspection_id", inspectionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && new Date(existing.expires_at) > new Date()) {
    return existing.token;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error } = await sb
    .from("review_tokens")
    .insert({ inspection_id: inspectionId, token, expires_at: expiresAt });
  if (error) {
    throw new Error(`Couldn't create review link: ${error.message}`);
  }
  return token;
}

/**
 * Validate a token from a /review/[token] URL. Returns the inspection it
 * scopes to, or null if the token is missing/unknown/expired — callers
 * should render a generic "link expired" state and never distinguish *why*
 * a token failed. Every downstream query in the review routes must derive
 * inspectionId only from this return value, never from any other request
 * input, since supabaseAdmin() bypasses RLS entirely.
 */
export async function validateReviewToken(
  token: string,
): Promise<ReviewScope | null> {
  if (!token) return null;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("review_tokens")
    .select("inspection_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!data || new Date(data.expires_at) <= new Date()) return null;

  return { inspectionId: data.inspection_id as string };
}
