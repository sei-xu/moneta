-- Storage for the autonomous analysis phase: periodic reports produced by an
-- LLM from pre-aggregated data, and the follow-ups a report schedules for
-- itself. See docs/automacoes-futuras.md for the design these tables serve.

-- Governs whether a finished report reaches the user through Telegram:
--   'silent'       → nothing worth interrupting for; report is stored only
--   'report_ready' → a standard report is available; announce it
--   'observation'  → urgent enough to push the finding itself, not a pointer
create type public.notification_decision_type as enum (
  'silent',
  'report_ready',
  'observation'
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  -- 'weekly' for the scheduled run, 'followup' for a scheduled_analyses item
  report_type text not null default 'weekly',
  headline text,
  changes jsonb not null default '[]'::jsonb,
  consistencies jsonb not null default '[]'::jsonb,
  taxonomy_notes jsonb not null default '[]'::jsonb,
  forward_looking jsonb not null default '[]'::jsonb,
  full_content text,
  notification_decision public.notification_decision_type not null default 'silent',
  model_notes text,
  -- which provider/model produced this, so a change in model is traceable
  -- when report quality shifts
  model_used text,
  created_at timestamptz not null default now(),

  constraint reports_period_ordered check (period_end >= period_start)
);

create index reports_period_start_idx on public.reports (period_start desc);
create index reports_created_at_idx on public.reports (created_at desc);

-- One weekly report per period: makes a re-run of the same week an update
-- instead of a duplicate, so a retried cron tick is harmless.
create unique index reports_weekly_period_idx
  on public.reports (period_start, period_end)
  where report_type = 'weekly';

comment on table public.reports is 'Reports produced by the scheduled analysis (headline + structured sections)';
comment on column public.reports.notification_decision is 'Whether and how to notify the user: silent, report_ready or observation';
comment on column public.reports.forward_looking is 'Items the analysis wants to revisit later; each may become a scheduled_analyses row';

alter table public.reports enable row level security;

-- Follow-ups the analysis schedules for itself: an hourly poll picks up the
-- due rows and runs each one with the prompt the previous report wrote.
create table public.scheduled_analyses (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null,
  prompt text not null,
  status text not null default 'pending',
  -- the report that requested this follow-up
  source_report_id uuid references public.reports (id) on delete set null,
  -- the report this follow-up produced, once it runs
  report_id uuid references public.reports (id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),

  constraint scheduled_analyses_status_check
    check (status in ('pending', 'completed', 'error', 'cancelled'))
);

-- Supports the hourly poll: "pending rows already due"
create index scheduled_analyses_due_idx
  on public.scheduled_analyses (run_at)
  where status = 'pending';

comment on table public.scheduled_analyses is 'Follow-up analyses scheduled by a previous report''s forward_looking items';

alter table public.scheduled_analyses enable row level security;
