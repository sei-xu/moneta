-- Schedules the analysis worker, and repairs the two jobs that never worked.
--
-- The worker secret is NOT written into this file. pg_cron runs inside
-- Postgres, which cannot read a .env or the Edge Functions' environment, so
-- the value is kept in Supabase Vault and each job decrypts it at run time.
-- Nothing secret ends up in the repo, in cron.job.command, or in a dashboard
-- listing of scheduled jobs.
--
-- Replace <project-ref> below before running (the ref is not a secret).
--
-- Prerequisite — store the secret once (same value as the WORKER_SECRET
-- Edge Function secret), from the SQL Editor or `supabase db query`:
--
--   select vault.create_secret('<WORKER_SECRET>', 'worker_secret',
--                              'Shared secret for pg_cron -> Edge Function calls');
--
--   -- to change it later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'worker_secret'),
--     '<NEW_VALUE>');
--
-- Two earlier jobs are re-created here because both were broken:
--   * 'process-receipts' hardcoded a secret that did not match the deployed
--     WORKER_SECRET, so every tick returned 401 and the queue only ever
--     advanced through the bot's /processar command.
--   * 'notify-pending-review-daily' (migration 20260724000011) read
--     current_setting('app.supabase_url') and current_setting('app.service_role_key'),
--     GUCs no migration ever defines, so it raised on every tick.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The project ref is not a secret (it is part of every public URL), so it
-- stays a plain placeholder: replace <project-ref> before running.
do $schedule$
declare
  v_base text := 'https://<project-ref>.supabase.co/functions/v1/';
  v_job record;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'worker_secret') then
    raise exception
      'vault secret "worker_secret" is missing — create it before scheduling (see the header of this file)';
  end if;

  for v_job in
    select * from (values
      -- name,                         schedule,        function,                body
      ('process-receipts',            '*/10 * * * *', 'process-receipts',      '{}'),
      ('analyze-expenses-weekly',     '0 12 * * 1',   'analyze-expenses',      '{"mode":"weekly"}'),
      ('analyze-expenses-followups',  '0 * * * *',    'analyze-expenses',      '{"mode":"followups"}'),
      ('notify-pending-review-daily', '0 9 * * *',    'notify-pending-review', '{}')
    ) as t(jobname, schedule, fn, body)
  loop
    if exists (select 1 from cron.job where jobname = v_job.jobname) then
      perform cron.unschedule(v_job.jobname);
    end if;

    perform cron.schedule(
      v_job.jobname,
      v_job.schedule,
      -- pg_net defaults to a 5 s timeout. These workers call an LLM and run
      -- far longer than that; the function itself still completes, but the
      -- response lands as status_code = null, which makes the job history
      -- useless for telling a success from a failure. An explicit timeout
      -- above the Edge Function wall clock keeps net._http_response readable.
      format(
        $cmd$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'x-worker-secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret'),
            'Content-Type', 'application/json'
          ),
          body := %L::jsonb,
          timeout_milliseconds := 170000
        );
        $cmd$,
        v_base || v_job.fn,
        v_job.body
      )
    );
  end loop;
end;
$schedule$;
