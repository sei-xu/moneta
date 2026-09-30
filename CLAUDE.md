# Moneta

Personal finance management app. **Current phase: backend complete** — Full Supabase schema with categories, audit logging, and analytics. Telegram ingestion bot functional (122+ pending receipts, 109+ processed expenses). Ready for Edge Function enhancements and app UI. The data model is defined by the ERD in `docs/pipeline-ia-recibos.md` and the migrations under `supabase/migrations/`.

## Build, lint and test commands

There is no `package.json`, no build step, no linter and no test suite in this repo — don't invent `npm run` commands, none exist:

- **Edge Functions** (`supabase/functions/*/index.ts`, Deno): deployed straight to Supabase with `supabase functions deploy <name>` (Supabase CLI, project must be linked via `supabase link`). No local build or bundling step. Type check one with `deno check supabase/functions/<name>/index.ts`.
- **Tests**: the only automated tests are Deno unit tests over the analysis worker's pure logic — `deno test supabase/functions/analyze-expenses/`. Everything else is verified manually, by invoking the deployed function or reading logs (`supabase functions logs <name>`).
- **SQL checks** (`supabase/tests/*.sql`): plain SQL scripts that seed, assert and roll back. Run one with `supabase db query --linked -f supabase/tests/<file>.sql`, or paste it whole into the Supabase SQL Editor. A clean run means every assertion passed; a failure aborts and prints its message.
- **Migrations** (`supabase/migrations/*.sql`): applied either by running the file's SQL directly in the Supabase dashboard's SQL Editor, in numeric filename order (see `supabase/README.md`), or via `supabase db push --linked` with the CLI. No `Down` migration convention here — this is a separate repo from Ḫprj's own `migrations/` and doesn't follow node-pg-migrate's Up/Down format.
- No TypeScript project config (`tsconfig.json`) exists, so there is no repo-wide typecheck command either — Deno's own type checking happens implicitly when a function is deployed or run.

## Conventions

- Commit messages in English.
- Code comments in English. Write comments only where they add lasting value to a future reader; never to narrate a change or answer a review/prompt.
- Variable, function, table, and column names in English.
- User-facing text (Telegram bot replies, future app UI) in Brazilian Portuguese.
- Documentation under `docs/` and setup guides may be written in Portuguese.

## Structure

### Database (`supabase/migrations/`)
- **Core tables**:
  - `expenses` — resolved expense records with merchant, amount, category, payment method
  - `expense_items` — line items within each expense (from receipt parsing)
  - `pending_expenses` — raw receipts (image + text) awaiting AI processing or user confirmation
  - `payment_methods` — registered payment methods (cards, accounts)
  - `categories` — hierarchical expense categories (root + subcategories)
  - `reports` — reports produced by the scheduled analysis (headline + structured sections)
  - `scheduled_analyses` — follow-up analyses a report scheduled for itself

- **Audit & Learning**:
  - `audit_log` — immutable log of all data changes (insert/update/delete/reclassify)
  - `user_feedback` — user corrections and feedback on AI predictions (for learning)

- **Analytics Views** (7 pre-built):
  - `expense_summary_by_category` — spending by category & month
  - `pending_expenses_status_summary` — queue health metrics
  - `processing_performance_metrics` — AI pipeline success rates
  - `payment_method_usage` — payment method frequency & totals
  - `category_effectiveness` — which categories need manual correction
  - `duplicate_detection_log` — false positive/negative analysis
  - `audit_summary` — change tracking by source & type

- **RPC Functions** (9 total):
  - `resolve_pending_expense()` — atomic expense + items insert (existing)
  - `create_manual_expense()` — create expense from app UI
  - `reclassify_expense()` — update category + audit
  - `resolve_pending_with_feedback()` — resolve with user corrections
  - `bulk_update_pending_expenses()` — batch process error queue
  - `suggest_category_for_merchant()` — AI-assisted category prediction
  - `get_top_categories_by_merchant()` — historical category lookup
  - `get_analysis_context()` — pre-aggregated period context for the analysis prompt
  - `log_audit()` — insert audit trail entries

### Edge Functions
- `supabase/functions/telegram-ingest/` — Telegram bot: receives receipts (photo + text), compresses images, uploads to bucket, creates `pending_expenses` entries, handles user Q&A (duplicate confirmation, detail requests, category selection via inline buttons)
- `supabase/functions/process-receipts/` — Scheduled worker (pg_cron): fetches pending receipts, calls Gemini for parsing, detects duplicates, asks user for confirmation if needed, atomically resolves via RPC, respects free-tier rate limits & daily budget
- `supabase/functions/analyze-expenses/` — Scheduled analysis (pg_cron): pre-aggregates a period via `get_analysis_context()`, sends it to an LLM in one call, stores a structured report and lets the model's `notification_decision` govern whether the user is notified
- `supabase/functions/notify-pending-review/` — Daily reminder about pending receipts awaiting review

### Documentation
- `docs/pipeline-ia-recibos.md` — Architecture and design decisions
- `supabase/README.md` — Migration setup guide
- `supabase/functions/telegram-ingest/README.md` — Telegram bot setup (token, webhook, secrets)
- `supabase/functions/process-receipts/README.md` — Worker setup and scheduling

## Database Design Notes

### Security & Access Control
- All tables have RLS enabled with no policies — access via `service_role` key only (Edge Functions)
- The 7 analytics views are `security_invoker = on` (migration `20260930000005`), so they are checked as the caller instead of the owner. Without it a view over an RLS'd table hands the full history to anyone with the anon key. **`create or replace view` silently resets this** — declare it inline (`create or replace view x with (security_invoker = on) as ...`) on any future edit
- The `receipts` bucket is private; file paths stored in DB, signed URLs generated on read
- `expenses.category_id` now has a proper FK constraint to `categories.id` (ON DELETE SET NULL)
- Audit log is append-only (no updates/deletes) for compliance & debugging

### Category System
- **Hierarchical**: 10 root categories (Housing, Food, Transportation, etc.) with 40+ subcategories
- **Pre-seeded**: All categories shipped with the schema (fast Gemini prompts, no DB queries needed)
- **Auto-suggestion**: `suggest_category_for_merchant()` uses: (1) user correction history → 0.95 confidence, (2) amount matching → 0.75, (3) merchant name regex → 0.60
- **Learning**: User feedback stored in `user_feedback` table, linked to audit log for traceability

### Processing Pipeline
- **Ingestion** (telegram-ingest): Validates webhook secret, compresses images in memory (JPEG q80, max 2000px), uploads to bucket, inserts `pending_expenses` row before any AI call (fail-safe)
- **Processing** (process-receipts): Batched (2 receipts/run), budget-capped (200/day free tier), retries up to 3x for transient failures, only after max attempts does row become `status='error'`
- **Duplicate detection**: ±3 day window, fuzzy match on (amount, transaction_time, merchant), asks user to confirm before discarding
- **User Q&A loop**: `needs_detail=true` or duplicate question → status='waiting_user', Telegram sends message, user responds via keyboard or reply, bot reclassifies and re-enqueues

### Audit Trail
- Every data change logged: who/what/when/why (via `log_audit()` RPC or Edge Functions)
- `source` field distinguishes: `ai_pipeline` vs `user_manual` vs `telegram_bot` vs `api`
- `metadata` JSONB captures context (Gemini attempt #, confidence scores, duplicate candidates)
- User corrections in `user_feedback` linked back to audit entries for model training

### Analysis Phase
- The analysis model **never runs SQL**: `get_analysis_context()` pre-aggregates the period and the whole context goes in one request — no tool-calling loop, no query surface to validate
- Provider is configuration, not code: Gemini and Kimi both speak OpenAI Chat Completions. Default is Gemini (the free-tier key already used by `process-receipts`); Kimi is opt-in via `ANALYSIS_PROVIDER=kimi` and is paid
- `notification_decision` (`silent`/`report_ready`/`observation`) is returned by the model and decides whether a Telegram message goes out at all
- `forward_looking` items with `revisit_in_days` become `scheduled_analyses` rows, run by an hourly poll

### The worker secret
- `pg_cron` and the Edge Functions authenticate to each other with one shared secret, and it lives in **exactly one place**: the Supabase Vault row named `worker_secret`. There is no `WORKER_SECRET` Edge Function secret — the functions read the same row through `public.worker_secret()`, a security-definer RPC granted to `service_role` only
- Never re-introduce a second copy. Two copies is what left the `process-receipts` cron returning 401 on every tick for weeks, because nothing compares them and a 401 looks like a rejected caller rather than a broken config
- For the same reason, a missing secret is answered with **503**, not 401: a configuration fault must not be indistinguishable from a wrong caller
- Rotation is a single `vault.update_secret`. Functions cache the value per isolate, so redeploy if a rotation must take effect immediately
- `net.http_post` defaults to a 5 s timeout; the scheduled jobs pass `timeout_milliseconds` explicitly, otherwise LLM-length calls land in `net._http_response` as `status_code = null` and the history cannot distinguish success from failure

### Next Steps (Phase 4)
- [ ] Update `process-receipts` to call `suggest_category_for_merchant()` and pass predictions to Gemini
- [ ] Update `telegram-ingest` with `/classify` and `/review` commands for manual category selection
- [ ] Wire up `log_audit()` calls from Edge Functions (currently manual, should be automatic)
- [ ] Add RLS policies for future app auth (read own expenses, write via approved functions only)
- [ ] Build app UI to consume the RPC functions and analytics views
- [ ] Add RLS policies for `authenticated` before the app UI: the views now respect the caller's RLS, so with no policies an app session reads nothing (which is correct, but means the UI needs policies to work)
- [ ] Promote `taxonomy_notes` from reports into candidate `behavior_tags` / `categories` rows
