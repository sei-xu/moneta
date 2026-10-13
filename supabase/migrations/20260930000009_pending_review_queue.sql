-- Single definition of "reviewable", shared by the daily reminder
-- (notify-pending-review) and /revisar (telegram-ingest).
--
-- Before this, each side wrote its own filter: the reminder counted
-- status in ('pending','waiting_user') with no sender filter and told
-- the count to a single fixed chat, while /revisar listed only
-- status='waiting_user' for the asking chat. The two sets never
-- overlapped — 'pending' rows are never shown to anyone, and the chat the
-- reminder picks is not necessarily who sent the rows it is counting — so
-- a user could be told "10 to review" and then told "nothing to review"
-- by the same bot. This RPC is now the only place that decides what
-- counts as reviewable: status in ('waiting_user','error'), optionally
-- scoped to one sender.
--
-- 'pending' is excluded on purpose: those rows have not been parsed yet,
-- so there is nothing for a human to confirm or correct. 'error' rows are
-- included: they exhausted the worker's retries and are otherwise
-- unreachable by either side, which is its own defect this RPC also fixes.

create or replace function public.get_pending_review_queue(p_chat_id text default null)
returns table (
  id uuid,
  telegram_chat_id text,
  status text,
  parsed_data jsonb,
  image_url text,
  raw_input text,
  attempts int,
  created_at timestamptz,
  age_hours numeric
)
language sql
security definer
-- empty search_path + fully qualified names: a security-definer function must
-- not resolve objects through a caller-controlled path
set search_path = ''
as $$
  select
    pe.id,
    pe.telegram_chat_id,
    pe.status,
    pe.parsed_data,
    pe.image_url,
    pe.raw_input,
    pe.attempts,
    pe.created_at,
    extract(epoch from (now() - pe.created_at)) / 3600.0 as age_hours
  from public.pending_expenses pe
  where pe.status in ('waiting_user', 'error')
    and (p_chat_id is null or pe.telegram_chat_id = p_chat_id)
  order by pe.created_at;
$$;

comment on function public.get_pending_review_queue(text) is
  'The one definition of "reviewable": waiting_user + error, optionally scoped to one sender (p_chat_id). service_role only.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which would expose
-- the full pending_expenses backlog (including raw_input/parsed_data) to
-- anon. Revoke first, then grant narrowly — only the Edge Functions
-- (service_role) call this.
revoke all on function public.get_pending_review_queue(text) from public;
revoke all on function public.get_pending_review_queue(text) from anon;
revoke all on function public.get_pending_review_queue(text) from authenticated;
grant execute on function public.get_pending_review_queue(text) to service_role;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_pending_review_queue'
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) then
    raise exception 'get_pending_review_queue() is executable by anon or authenticated — refusing to leave it that way';
  end if;
end;
$$;
