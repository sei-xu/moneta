-- Verification script for the analysis phase.
--
-- Run the whole file in the Supabase SQL Editor, or from the CLI:
--
--   supabase db query --linked -f supabase/tests/analysis_checks.sql
--
-- It seeds synthetic data, asserts, and rolls back — nothing is left behind.
-- A failed assertion aborts the run and prints its message, so a clean run
-- means every assertion passed.
--
-- To validate against a database where the analysis migrations are not applied
-- yet, concatenate them ahead of this file inside a single begin/rollback:
-- the DDL is then rolled back too and the target database is left untouched.
--
-- The seeded period sits in 2027 on purpose: no real expense exists there,
-- so the aggregate totals are exactly what this script inserted.

begin;

do $$
declare
  v_category_id uuid;
  v_ctx jsonb;
  v_cat jsonb;
  v_report_id uuid;
begin
  insert into public.categories (name, slug)
  values ('ZZ Analysis Check', 'zz-analysis-check')
  returning id into v_category_id;

  -- Period under analysis: 2027-03-01..2027-03-07, total 140 over 2 expenses
  insert into public.expenses (transaction_time, merchant, amount, category_id, source)
  values
    ('2027-03-02T12:00:00Z', 'Mercado Teste', 100, v_category_id, 'test'),
    ('2027-03-05T12:00:00Z', 'Mercado Teste', 40, v_category_id, 'test');

  -- Baseline: the 28 days before the period, 4 x 50 = 200 → 50 per week
  insert into public.expenses (transaction_time, merchant, amount, category_id, source)
  values
    ('2027-02-03T12:00:00Z', 'Mercado Teste', 50, v_category_id, 'test'),
    ('2027-02-10T12:00:00Z', 'Mercado Teste', 50, v_category_id, 'test'),
    ('2027-02-17T12:00:00Z', 'Mercado Teste', 50, v_category_id, 'test'),
    ('2027-02-24T12:00:00Z', 'Mercado Teste', 50, v_category_id, 'test');

  -- An expense one day outside the window must not be counted
  insert into public.expenses (transaction_time, merchant, amount, category_id, source)
  values ('2027-03-08T12:00:00Z', 'Fora da Janela', 999, v_category_id, 'test');

  v_ctx := public.get_analysis_context('2027-03-01', '2027-03-07');

  assert (v_ctx #>> '{totals,amount}')::numeric = 140,
    format('totals.amount expected 140, got %s', v_ctx #>> '{totals,amount}');
  assert (v_ctx #>> '{totals,expense_count}')::int = 2,
    format('totals.expense_count expected 2, got %s', v_ctx #>> '{totals,expense_count}');
  assert (v_ctx #>> '{totals,prior_4w_weekly_avg}')::numeric = 50,
    format('prior_4w_weekly_avg expected 50, got %s', v_ctx #>> '{totals,prior_4w_weekly_avg}');

  select c into v_cat
  from jsonb_array_elements(v_ctx -> 'by_category') c
  where c ->> 'category' = 'ZZ Analysis Check';

  assert v_cat is not null, 'seeded category missing from by_category';
  assert (v_cat ->> 'total')::numeric = 140,
    format('category total expected 140, got %s', v_cat ->> 'total');
  assert (v_cat ->> 'delta_vs_avg')::numeric = 90,
    format('delta_vs_avg expected 90, got %s', v_cat ->> 'delta_vs_avg');

  assert v_ctx -> 'top_merchants' @> '[{"merchant": "Mercado Teste"}]'::jsonb,
    'top_merchants missing the seeded merchant';
  assert not (v_ctx -> 'top_merchants' @> '[{"merchant": "Fora da Janela"}]'::jsonb),
    'an expense outside the window leaked into the period';

  assert v_ctx -> 'queue' ? 'needs_detail', 'queue block missing needs_detail';

  -- An empty period must still return a well-formed context, not null
  v_ctx := public.get_analysis_context('2027-06-01', '2027-06-07');
  assert (v_ctx #>> '{totals,amount}')::numeric = 0, 'empty period should total 0';
  assert v_ctx -> 'by_category' = '[]'::jsonb, 'empty period should have no categories';

  -- An inverted period is a caller bug and must not silently return data
  begin
    perform public.get_analysis_context('2027-03-07', '2027-03-01');
    raise exception 'inverted period was accepted';
  exception
    -- the function's own errcode; the sentinel raise above stays P0001, so a
    -- silently accepted inverted period is not mistaken for a pass
    when invalid_parameter_value then null;
  end;

  -- reports: the enum constrains notification_decision
  insert into public.reports (period_start, period_end, headline, notification_decision)
  values ('2027-03-01', '2027-03-07', 'Check', 'report_ready')
  returning id into v_report_id;

  begin
    update public.reports set notification_decision = 'maybe' where id = v_report_id;
    raise exception 'invalid notification_decision was accepted';
  exception
    when invalid_text_representation then null;
  end;

  -- One weekly report per period: a re-run updates instead of duplicating
  begin
    insert into public.reports (period_start, period_end, headline)
    values ('2027-03-01', '2027-03-07', 'Duplicate');
    raise exception 'duplicate weekly report was accepted';
  exception
    when unique_violation then null;
  end;

  -- A follow-up report for the same period is allowed
  insert into public.reports (period_start, period_end, report_type, headline)
  values ('2027-03-01', '2027-03-07', 'followup', 'Follow-up');

  -- scheduled_analyses: status is constrained
  begin
    insert into public.scheduled_analyses (run_at, prompt, status)
    values (now(), 'check', 'bogus');
    raise exception 'invalid scheduled_analyses status was accepted';
  exception
    when check_violation then null;
  end;

  raise notice 'analysis_checks: all assertions passed';
end;
$$;

rollback;
