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
import { buildNotifications, notificationText, orphanNote, type ReviewQueueRow } from "../_shared/review_queue.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ALLOWED_CHAT_IDS = Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS")!.split(",").map((s) => s.trim());
// how old a sender's oldest reviewable row must be before they get a reminder
const MIN_AGE_HOURS = 24;

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
  // The reviewable set — waiting_user + error, across every sender — is the
  // same one get_pending_review_queue() hands to /revisar, so the count a
  // chat is told here always matches what /revisar then lists for it.
  const { data, error } = await supabase.rpc("get_pending_review_queue", { p_chat_id: null });

  if (error) {
    console.error("fetch pending failed:", error);
    return { error: error.message };
  }

  const rows = (data ?? []) as ReviewQueueRow[];
  const { notified, orphans } = buildNotifications(rows, ALLOWED_CHAT_IDS, MIN_AGE_HOURS);

  for (let i = 0; i < notified.length; i++) {
    const { chatId, count } = notified[i];
    let text = notificationText(count);
    // Rows with no sender, or with a sender outside the allowlist, cannot be
    // told apart from who actually sent them — they ride along on the
    // first chat that gets a reminder instead of going unmentioned.
    if (orphans > 0 && i === 0) {
      text += `\n\n${orphanNote(orphans)}`;
    }
    await tg("sendMessage", { chat_id: chatId, text });
  }

  return {
    notified: notified.map(({ chatId, count }) => ({ chat: chatId, count })),
    orphans,
  };
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
