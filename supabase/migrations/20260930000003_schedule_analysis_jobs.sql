-- Schedules the analysis worker, and repairs the notification job.
--
-- Replace <project-ref> and <WORKER_SECRET> before running this file: the
-- jobs below authenticate with the same x-worker-secret header that
-- process-receipts uses. The earlier notification job (migration
-- 20260724000011) instead read current_setting('app.supabase_url') and
-- current_setting('app.service_role_key') — GUCs no migration ever defines,
-- so that job raised on every tick and the daily reminder never went out.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Weekly report: Mondays at 12:00 UTC (09:00 in São Paulo), analysing the
-- ISO week that just closed.
select cron.unschedule('analyze-expenses-weekly')
where exists (select 1 from cron.job where jobname = 'analyze-expenses-weekly');

select cron.schedule(
  'analyze-expenses-weekly',
  '0 12 * * 1',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/analyze-expenses',
    headers := jsonb_build_object(
      'x-worker-secret', '<WORKER_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{"mode":"weekly"}'::jsonb
  );
  $$
);

-- Follow-ups the reports scheduled for themselves; the function itself is a
-- no-op when nothing is due.
select cron.unschedule('analyze-expenses-followups')
where exists (select 1 from cron.job where jobname = 'analyze-expenses-followups');

select cron.schedule(
  'analyze-expenses-followups',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/analyze-expenses',
    headers := jsonb_build_object(
      'x-worker-secret', '<WORKER_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{"mode":"followups"}'::jsonb
  );
  $$
);

-- Re-point the daily reminder at a call that actually authenticates.
select cron.unschedule('notify-pending-review-daily')
where exists (select 1 from cron.job where jobname = 'notify-pending-review-daily');

select cron.schedule(
  'notify-pending-review-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/notify-pending-review',
    headers := jsonb_build_object(
      'x-worker-secret', '<WORKER_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
