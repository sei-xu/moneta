-- Verification script for the taxonomy candidate promotion
-- (behavior_tags / categories.status / review_taxonomy_candidate).
--
-- Run with:
--
--   supabase db query --linked -f supabase/tests/taxonomy_checks.sql
--
-- or paste it whole into the Supabase SQL Editor. It seeds synthetic data,
-- asserts, and rolls back — nothing is left behind. A clean run means every
-- assertion passed.

begin;

do $$
declare
  v_report_id uuid;
  v_tag_id uuid;
  v_category_id uuid;
  v_status text;
  v_audit_count int;
begin
  insert into public.reports (period_start, period_end, headline)
  values ('2027-04-01', '2027-04-07', 'Taxonomy check')
  returning id into v_report_id;

  insert into public.behavior_tags (name, slug, description, source_report_id)
  values ('ZZ Compra por impulso', 'zz-compra-por-impulso', 'teste', v_report_id)
  returning id into v_tag_id;

  insert into public.categories (name, slug, status, source_report_id)
  values ('ZZ Pet Shop', 'zz-pet-shop', 'candidate', v_report_id)
  returning id into v_category_id;

  assert (select status from public.categories where id = v_category_id) = 'candidate',
    'seeded category should start as candidate';

  -- review_taxonomy_candidate is called by the app (authenticated,
  -- allowlisted) or the Telegram bot (service_role); from this script there
  -- is no JWT context, so the service_role path is simulated by setting the
  -- same GUC PostgREST would set from the JWT's role claim (auth.role()
  -- reads this, not current_user — see the function's own comment).
  set local "request.jwt.claim.role" to 'service_role';

  perform public.review_taxonomy_candidate('behavior_tag', v_tag_id, 'approved');
  select status into v_status from public.behavior_tags where id = v_tag_id;
  assert v_status = 'approved', format('expected behavior_tag approved, got %s', v_status);
  assert (select reviewed_at from public.behavior_tags where id = v_tag_id) is not null,
    'reviewed_at should be stamped on approval';

  perform public.review_taxonomy_candidate('category', v_category_id, 'rejected');
  select status into v_status from public.categories where id = v_category_id;
  assert v_status = 'rejected', format('expected category rejected, got %s', v_status);

  select count(*) into v_audit_count
  from public.audit_log
  where table_name in ('behavior_tags', 'categories')
    and record_id in (v_tag_id, v_category_id)
    and source = 'user_manual';
  assert v_audit_count = 2, format('expected 2 audit_log rows, got %s', v_audit_count);

  begin
    perform public.review_taxonomy_candidate('behavior_tag', v_tag_id, 'maybe');
    raise exception 'invalid action was accepted';
  exception
    when others then
      if sqlerrm not like 'invalid action%' then raise; end if;
  end;

  reset "request.jwt.claim.role";

  -- An authenticated caller who is not on app_users must be refused, not
  -- silently allowed through because they hold a valid session.
  set local "request.jwt.claim.role" to 'authenticated';
  begin
    perform public.review_taxonomy_candidate('behavior_tag', v_tag_id, 'approved');
    raise exception 'an unauthorized authenticated caller was accepted';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise; end if;
  end;
  reset "request.jwt.claim.role";

  -- The status check constraint rejects anything outside the three values.
  begin
    update public.categories set status = 'bogus' where id = v_category_id;
    raise exception 'invalid category status was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.behavior_tags set status = 'bogus' where id = v_tag_id;
    raise exception 'invalid behavior_tag status was accepted';
  exception
    when check_violation then null;
  end;

  -- anon must not be able to read either new table, same as every other
  -- table in migration 20260930000006.
  assert not has_table_privilege('anon', 'public.behavior_tags', 'select'),
    'anon should not have select on behavior_tags';
  assert not has_table_privilege('anon', 'public.expense_behavior_tags', 'select'),
    'anon should not have select on expense_behavior_tags';

  -- Pre-existing seed categories must be unaffected by the new column's
  -- default.
  assert (select count(*) from public.categories where status <> 'approved' and id <> v_category_id) = 0,
    'pre-existing categories should all still be approved';

  raise notice 'taxonomy_checks: all assertions passed';
end;
$$;

rollback;
