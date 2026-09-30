-- Make the analytics views respect the caller's RLS.
--
-- A view created without this option runs with its owner's privileges. The
-- owner here is `postgres`, which bypasses RLS, so every one of these views
-- returned the full financial history to whoever could call it — while a
-- direct `select * from expenses` was correctly denied. That is Supabase
-- lint 0010, and it made the RLS on the base tables decorative for any
-- caller holding the anon key.
--
-- With security_invoker = on the base-table access is checked as the caller,
-- so anon and authenticated (no policies) get nothing, while service_role
-- still sees everything through BYPASSRLS — the Edge Functions are unaffected.
--
-- CAUTION: `create or replace view` resets reloptions and silently drops this
-- setting. Any future edit to one of these views must either re-apply the
-- ALTER below or, better, declare it inline:
--
--   create or replace view public.<name> with (security_invoker = on) as ...

alter view public.expense_summary_by_category     set (security_invoker = on);
alter view public.pending_expenses_status_summary set (security_invoker = on);
alter view public.processing_performance_metrics  set (security_invoker = on);
alter view public.payment_method_usage            set (security_invoker = on);
alter view public.category_effectiveness          set (security_invoker = on);
alter view public.duplicate_detection_log         set (security_invoker = on);
alter view public.audit_summary                   set (security_invoker = on);

do $$
declare
  v_unset text[];
begin
  select array_agg(c.relname order by c.relname)
  into v_unset
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and coalesce(
      (select option_value from pg_options_to_table(c.reloptions)
       where option_name = 'security_invoker'),
      'off'
    ) <> 'on';

  if v_unset is not null then
    raise exception 'views still running as owner: %', v_unset;
  end if;
end;
$$;
