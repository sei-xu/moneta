import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias — veja app/.env.example",
  );
}

// The anon key is public by design and ships in the bundle. What protects the
// data is RLS: every table denies reads unless the signed-in user has a row in
// app_users, and the analytics views run with security_invoker so they are
// checked the same way. The service_role key must never appear here.
export const supabase = createClient(url, anonKey);
