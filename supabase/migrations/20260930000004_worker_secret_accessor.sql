-- Single source of truth for the worker secret.
--
-- Before this, the value existed twice — as an Edge Function secret read via
-- Deno.env, and in Vault for pg_cron. Those two copies drifting is exactly
-- what left the process-receipts cron returning 401 on every tick, unnoticed,
-- because nothing compares them. With this accessor the Edge Functions read
-- the same Vault row the cron jobs do, so there is only one value to rotate.
--
-- The `vault` schema is deliberately not exposed over PostgREST, so the
-- functions cannot query vault.decrypted_secrets directly. This narrow
-- security-definer accessor is the bridge: it returns exactly one secret, and
-- only service_role may call it.

create or replace function public.worker_secret()
returns text
language sql
security definer
-- empty search_path + fully qualified names: a security-definer function must
-- not resolve objects through a caller-controlled path
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'worker_secret'
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which would put the
-- secret behind the anon key. Revoke first, then grant narrowly.
revoke all on function public.worker_secret() from public;
revoke all on function public.worker_secret() from anon;
revoke all on function public.worker_secret() from authenticated;
grant execute on function public.worker_secret() to service_role;

comment on function public.worker_secret() is
  'Returns the shared pg_cron/Edge Function secret from Vault. service_role only — never grant this to anon or authenticated.';

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'worker_secret'
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) then
    raise exception 'worker_secret() is executable by anon or authenticated — refusing to leave it that way';
  end if;
end;
$$;
