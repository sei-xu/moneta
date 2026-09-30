// Scheduled analysis worker: turns a period of expenses into a stored report
// and decides whether it is worth interrupting the user.
//
// Two modes, both authenticated by the same x-worker-secret header used by
// process-receipts:
//   {"mode":"weekly"}    → analyses the previous ISO week (or an explicit
//                          period_start/period_end) and stores one report
//   {"mode":"followups"} → runs every due scheduled_analyses row, each with
//                          the prompt a previous report wrote for it
//
// The model never queries the database: get_analysis_context pre-aggregates
// the period and the whole context goes in a single request, with no
// tool-calling loop. See docs/automacoes-futuras.md.
//
// Deploy: supabase functions deploy analyze-expenses --no-verify-jwt
// Scheduling: pg_cron + pg_net (see README.md).

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeWorker } from "../_shared/worker_secret.ts";
import {
  ANALYSIS_SCHEMA,
  type AnalysisResult,
  buildPrompt,
  followUpsFrom,
  isRetryableStatus,
  notificationMessage,
  parseAnalysis,
  type Period,
  previousIsoWeek,
} from "./analysis.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS")!.split(",")[0].trim();
const MAX_FOLLOWUPS = Number(Deno.env.get("ANALYSIS_MAX_FOLLOWUPS") ?? "3");
const MAX_RETRIES = Number(Deno.env.get("ANALYSIS_MAX_RETRIES") ?? "3");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Both providers speak the OpenAI Chat Completions protocol, so one code path
// serves either. Gemini is the default because its free tier already backs
// process-receipts — Kimi is paid and adds a second destination for financial
// data, so it stays opt-in.
interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function resolveProvider(): Provider {
  const name = (Deno.env.get("ANALYSIS_PROVIDER") ?? "gemini").toLowerCase();
  const model = Deno.env.get("ANALYSIS_MODEL");

  if (name === "kimi") {
    return {
      baseUrl: "https://api.moonshot.ai/v1",
      apiKey: Deno.env.get("KIMI_API_KEY")!,
      model: model ?? "kimi-k2.6",
    };
  }
  if (name !== "gemini") {
    throw new Error(`unknown ANALYSIS_PROVIDER: ${name}`);
  }
  return {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: Deno.env.get("GEMINI_API_KEY")!,
    model: model ?? "gemini-3.6-flash",
  };
}

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// A weekly report only gets one scheduled shot, so a transient upstream blip
// must not cost the whole week. Retries stay short: the function has a wall
// clock, and a provider that is still down after a few seconds will be
// retried by the next cron tick anyway.
async function runModel(
  provider: Provider,
  prompt: string,
): Promise<AnalysisResult> {
  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(3, attempt - 1)));
    }

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "analysis", schema: ANALYSIS_SCHEMA, strict: true },
        },
      }),
    });

    if (res.ok) {
      const body = await res.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`analysis model returned no content: ${JSON.stringify(body)}`);
      }
      return parseAnalysis(content);
    }

    lastError = `HTTP ${res.status}: ${await res.text()}`;
    if (!isRetryableStatus(res.status)) break;
    console.warn(`analysis model attempt ${attempt + 1} failed: ${lastError}`);
  }

  throw new Error(`analysis model ${lastError}`);
}

async function fetchContext(period: Period): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_analysis_context", {
    p_period_start: period.start,
    p_period_end: period.end,
  });
  if (error) throw new Error(`get_analysis_context failed: ${error.message}`);
  return data;
}

async function storeReport(
  period: Period,
  reportType: "weekly" | "followup",
  result: AnalysisResult,
  provider: Provider,
): Promise<string> {
  const row = {
    period_start: period.start,
    period_end: period.end,
    report_type: reportType,
    headline: result.headline,
    changes: result.changes,
    consistencies: result.consistencies,
    taxonomy_notes: result.taxonomy_notes,
    forward_looking: result.forward_looking,
    full_content: result.full_content,
    notification_decision: result.notification_decision,
    model_notes: result.model_notes,
    model_used: `${provider.model}`,
  };

  // A weekly period is unique, so a re-run of the same week overwrites its
  // report instead of stacking duplicates; follow-ups are always new rows.
  // The uniqueness is enforced by a *partial* index (report_type = 'weekly'),
  // which PostgREST cannot express as an ON CONFLICT target — hence the
  // explicit lookup rather than an upsert.
  if (reportType === "weekly") {
    const { data: existing } = await supabase
      .from("reports")
      .select("id")
      .eq("report_type", "weekly")
      .eq("period_start", period.start)
      .eq("period_end", period.end)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("reports")
        .update(row)
        .eq("id", existing.id);
      if (error) throw new Error(`report update failed: ${error.message}`);
      return existing.id;
    }
  }

  const { data, error } = await supabase
    .from("reports")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`report insert failed: ${error.message}`);
  return data.id;
}

async function scheduleFollowUps(
  result: AnalysisResult,
  sourceReportId: string,
  now: Date,
): Promise<number> {
  // Re-running a weekly period updates its report rather than creating a new
  // one, so the follow-ups it had asked for must be replaced too — otherwise
  // every re-run stacks another copy of the same questions on the queue.
  // Only still-pending rows are cleared: one that already ran produced a
  // report of its own and is history.
  const { error: clearError } = await supabase
    .from("scheduled_analyses")
    .delete()
    .eq("source_report_id", sourceReportId)
    .eq("status", "pending");
  if (clearError) {
    throw new Error(`clearing stale follow-ups failed: ${clearError.message}`);
  }

  const followUps = followUpsFrom(result, now).slice(0, MAX_FOLLOWUPS);
  if (followUps.length === 0) return 0;

  const { error } = await supabase.from("scheduled_analyses").insert(
    followUps.map((f) => ({ ...f, source_report_id: sourceReportId })),
  );
  if (error) throw new Error(`scheduled_analyses insert failed: ${error.message}`);
  return followUps.length;
}

async function notify(result: AnalysisResult, period: Period): Promise<boolean> {
  const text = notificationMessage(result, period);
  if (!text) return false;
  await tg("sendMessage", { chat_id: CHAT_ID, text });
  return true;
}

async function runAnalysis(
  period: Period,
  reportType: "weekly" | "followup",
  provider: Provider,
  customPrompt: string | null,
  now: Date,
) {
  const context = await fetchContext(period);
  const result = await runModel(provider, buildPrompt(context, customPrompt));
  const reportId = await storeReport(period, reportType, result, provider);
  const scheduled = await scheduleFollowUps(result, reportId, now);
  const notified = await notify(result, period);
  return { reportId, decision: result.notification_decision, scheduled, notified };
}

interface ScheduledRow {
  id: string;
  run_at: string;
  prompt: string;
}

async function runDueFollowUps(provider: Provider, now: Date) {
  const { data, error } = await supabase
    .from("scheduled_analyses")
    .select("id, run_at, prompt")
    .eq("status", "pending")
    .lte("run_at", now.toISOString())
    .order("run_at")
    .limit(MAX_FOLLOWUPS);
  if (error) throw new Error(`due follow-ups query failed: ${error.message}`);

  const result = { ran: 0, failed: 0, notified: 0 };

  for (const row of (data ?? []) as ScheduledRow[]) {
    // A follow-up looks back over the four weeks up to today: the question it
    // answers was written about a trend, not about one specific week.
    const period: Period = {
      start: new Date(now.getTime() - 28 * 86_400_000).toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    };

    try {
      const outcome = await runAnalysis(period, "followup", provider, row.prompt, now);
      await supabase
        .from("scheduled_analyses")
        .update({ status: "completed", report_id: outcome.reportId })
        .eq("id", row.id);
      result.ran++;
      if (outcome.notified) result.notified++;
    } catch (err) {
      console.error(`follow-up ${row.id} failed:`, err);
      await supabase
        .from("scheduled_analyses")
        .update({ status: "error", error_message: String(err).slice(0, 500) })
        .eq("id", row.id);
      result.failed++;
    }
  }

  return result;
}

Deno.serve(async (req) => {
  const denied = await authorizeWorker(req, supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    mode?: string;
    period_start?: string;
    period_end?: string;
  };
  const now = new Date();

  try {
    const provider = resolveProvider();

    if (body.mode === "followups") {
      return Response.json(await runDueFollowUps(provider, now));
    }

    const period: Period = body.period_start && body.period_end
      ? { start: body.period_start, end: body.period_end }
      : previousIsoWeek(now);

    const outcome = await runAnalysis(period, "weekly", provider, null, now);
    return Response.json({ period, ...outcome });
  } catch (err) {
    console.error("analysis failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
