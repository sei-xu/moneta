// Shared worker-secret handling for the scheduled functions.
//
// The value lives in Supabase Vault — the same row the pg_cron jobs decrypt —
// and is reached through the public.worker_secret() accessor, which only
// service_role may execute. Keeping one copy means a rotation is a single
// Vault update, with nothing left to drift out of sync.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

let cached: string | null = null;

/**
 * Fetches the secret once per isolate. A rotation therefore reaches a warm
 * isolate only when it recycles; redeploy the functions if a rotation has to
 * take effect immediately.
 */
export async function workerSecret(supabase: SupabaseClient): Promise<string> {
  if (cached !== null) return cached;

  const { data, error } = await supabase.rpc("worker_secret");
  if (error) throw new Error(`worker secret lookup failed: ${error.message}`);
  if (typeof data !== "string" || data === "") {
    throw new Error("vault secret 'worker_secret' is missing or empty");
  }

  cached = data;
  return cached;
}

/**
 * Returns a response to send back when the caller must be refused, or null
 * when the request is authorized.
 *
 * A missing secret is reported as 503, not 401: it is a fault on our side,
 * and answering "unauthorized" to a correctly configured caller is precisely
 * what let a broken cron job look like a rejected one for weeks.
 */
export async function authorizeWorker(
  req: Request,
  supabase: SupabaseClient,
): Promise<Response | null> {
  let expected: string;
  try {
    expected = await workerSecret(supabase);
  } catch (err) {
    console.error("worker secret unavailable:", err);
    return new Response("worker secret unavailable", { status: 503 });
  }

  if (req.headers.get("x-worker-secret") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}
