// Notify user about pending expenses waiting for review.
//
// Runs daily via pg_cron to remind user about old pending_expenses
// that haven't been reviewed yet.
//
// Authenticated by the x-worker-secret header, like the other workers — so
// redeploying this also requires re-running the cron schedule in
// 20260930000003_schedule_analysis_jobs.sql, which sends that header.
//
// Deploy: supabase functions deploy notify-pending-review --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeWorker } from "../_shared/worker_secret.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS")!.split(",")[0].trim();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

async function notifyPendingReview() {
  // Find pending_expenses that are:
  // 1. status IN ('pending', 'waiting_user') — not yet resolved or discarded
  // 2. created_at > 1 day ago — old enough to warrant a reminder
  const oneDayAgo = new Date();
  oneDayAgo.setUTCDate(oneDayAgo.getUTCDate() - 1);

  const { count: matched, error } = await supabase
    .from("pending_expenses")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "waiting_user"])
    .lt("created_at", oneDayAgo.toISOString());

  if (error) {
    console.error("fetch pending failed:", error);
    return { error: error.message };
  }

  const count = matched ?? 0;
  if (count === 0) {
    return { notified: false, reason: "no old pending expenses" };
  }

  await tg("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: `📌 Você tem ${count} gasto${count === 1 ? "" : "s"} para revisar\n\nMande /revisar para começar`,
  });

  return { notified: true, count };
}

Deno.serve(async (req) => {
  const denied = await authorizeWorker(req, supabase);
  if (denied) return denied;

  try {
    const result = await notifyPendingReview();
    return Response.json(result);
  } catch (err) {
    console.error("notify failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
