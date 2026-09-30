-- Read access for the app UI.
--
-- Until now every table had RLS enabled with no policies, which is a total
-- deny for anyone but service_role. The app signs in with Supabase Auth and
-- uses the anon key, so it arrives as `authenticated` and needs policies.
--
-- Signing up is not the same as being allowed in. A policy written as
-- `to authenticated using (true)` would hand the whole financial history to
-- anyone who can get a magic link for any address, so membership is explicit:
-- a row in app_users. Seed it after the owner's first sign-in (see below).
--
-- Reads only. Writes stay with the existing SECURITY DEFINER RPCs, which run
-- as service_role — the app never writes to a table directly.

create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  added_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

comment on table public.app_users is 'Allowlist: which authenticated users may read app data. Add a row per person, after their first sign-in.';

-- STABLE so the planner calls it once per query rather than once per row.
-- SECURITY DEFINER so the lookup itself is not subject to app_users' own RLS,
-- which would otherwise recurse.
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users where user_id = (select auth.uid())
  )
$$;

comment on function public.is_app_user() is 'True when the current authenticated user is on the app_users allowlist.';

-- Each user may see their own allowlist row (so the app can tell "signed in
-- but not authorized" from "authorized"), and nothing else.
create policy app_users_self_read on public.app_users
  for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'expenses',
    'expense_items',
    'categories',
    'payment_methods',
    'pending_expenses',
    'reports',
    'scheduled_analyses',
    'audit_log',
    'user_feedback'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_app_user())',
      t || '_app_read', t
    );
  end loop;
end;
$$;

-- The anon key reaches PostgREST before any sign-in. RLS already returns
-- nothing to it, but there is no reason for the grant to exist at all.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end;
$$;

do $$
declare
  v_leak text[];
begin
  select array_agg(c.relname order by c.relname)
  into v_leak
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'v')
    and has_table_privilege('anon', c.oid, 'select');

  if v_leak is not null then
    raise exception 'anon still holds select on: %', v_leak;
  end if;
end;
$$;

-- After the owner signs in for the first time, authorize them:
--
--   insert into public.app_users (user_id, email)
--   select id, email from auth.users where email = '<owner email>';
--
-- Until that row exists the app signs in successfully and shows no data,
-- which is the intended behaviour for an unknown account.
