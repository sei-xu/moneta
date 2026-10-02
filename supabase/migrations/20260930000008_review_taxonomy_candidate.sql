-- Approving a taxonomy candidate is a write, and the app is deliberately
-- read-only (app/README.md): it never has an insert/update policy on any
-- table. This RPC is the one door, the same shape as the other
-- SECURITY DEFINER RPCs that let the app and the Telegram bot change data
-- without ever being granted a table-level write.

create or replace function public.review_taxonomy_candidate(
  p_kind text,
  p_id uuid,
  p_action text
) returns void
language plpgsql
security definer
-- empty search_path + fully qualified names: a security-definer function must
-- not resolve objects through a caller-controlled path
set search_path = ''
as $$
declare
  v_old_status text;
begin
  if p_kind not in ('behavior_tag', 'category') then
    raise exception 'invalid kind: %', p_kind;
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'invalid action: %', p_action;
  end if;

  -- The Telegram bot calls this as service_role; the app calls it as
  -- authenticated and must be on the allowlist. Either path is explicit —
  -- there is no bypass for an authenticated caller who is not a service_role
  -- and not on app_users.
  --
  -- auth.role(), not current_user: this function is SECURITY DEFINER, so
  -- current_user is already the function owner by the time this line runs —
  -- auth.role() reads the caller's JWT role claim directly and is unaffected.
  if coalesce((select auth.role()), '') <> 'service_role' and not public.is_app_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_kind = 'behavior_tag' then
    select status into v_old_status from public.behavior_tags where id = p_id;
    if not found then
      raise exception 'behavior_tag % not found', p_id;
    end if;

    update public.behavior_tags
    set status = p_action, reviewed_at = now()
    where id = p_id;
  else
    select status into v_old_status from public.categories where id = p_id;
    if not found then
      raise exception 'category % not found', p_id;
    end if;

    update public.categories
    set status = p_action
    where id = p_id;
  end if;

  perform public.log_audit(
    p_action := 'update',
    p_table_name := case p_kind when 'behavior_tag' then 'behavior_tags' else 'categories' end,
    p_record_id := p_id,
    p_old_values := jsonb_build_object('status', v_old_status),
    p_new_values := jsonb_build_object('status', p_action),
    p_changed_fields := array['status'],
    p_source := 'user_manual',
    p_metadata := jsonb_build_object('kind', p_kind)
  );
end;
$$;

comment on function public.review_taxonomy_candidate is
  'Approve or reject a taxonomy_notes candidate (behavior_tag or category). Logs to audit_log.';

revoke all on function public.review_taxonomy_candidate(text, uuid, text) from public;
revoke all on function public.review_taxonomy_candidate(text, uuid, text) from anon;
grant execute on function public.review_taxonomy_candidate(text, uuid, text) to authenticated;
grant execute on function public.review_taxonomy_candidate(text, uuid, text) to service_role;
