-- Pre-aggregates everything the analysis prompt needs into a single jsonb.
--
-- This function is what keeps the language model out of SQL: it never queries
-- the database, it only receives the result of this call. One round trip, no
-- tool-calling loop, no query surface to validate. See docs/automacoes-futuras.md.

create or replace function public.get_analysis_context(
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- transaction_time is timestamptz while the period is a date, so the window
  -- is half-open: [start 00:00, end+1day 00:00)
  v_from timestamptz := p_period_start::timestamptz;
  v_to timestamptz := (p_period_end + 1)::timestamptz;
  -- the four weeks immediately before the period, used as the baseline
  v_baseline_from timestamptz := (p_period_start - 28)::timestamptz;
  v_result jsonb;
begin
  if p_period_end < p_period_start then
    raise exception 'p_period_end (%) is before p_period_start (%)', p_period_end, p_period_start;
  end if;

  with period_expenses as (
    select e.*
    from public.expenses e
    where e.transaction_time >= v_from
      and e.transaction_time < v_to
  ),
  baseline_expenses as (
    select e.*
    from public.expenses e
    where e.transaction_time >= v_baseline_from
      and e.transaction_time < v_from
  ),
  by_category as (
    select
      coalesce(c.id::text, 'uncategorized') as category_key,
      coalesce(c.name, 'Sem categoria') as category_name,
      sum(p.amount) as total,
      count(*) as expense_count
    from period_expenses p
    left join public.categories c on p.category_id = c.id
    group by c.id, c.name
  ),
  baseline_by_category as (
    select
      coalesce(c.id::text, 'uncategorized') as category_key,
      -- four weeks of history reduced to a per-week average, so it is
      -- comparable with a single week's total
      sum(b.amount) / 4.0 as weekly_avg
    from baseline_expenses b
    left join public.categories c on b.category_id = c.id
    group by c.id
  ),
  category_rows as (
    select jsonb_agg(
      jsonb_build_object(
        'category', cat.category_name,
        'total', round(cat.total, 2),
        'expense_count', cat.expense_count,
        'prior_4w_weekly_avg', round(coalesce(base.weekly_avg, 0), 2),
        'delta_vs_avg', round(cat.total - coalesce(base.weekly_avg, 0), 2)
      )
      order by cat.total desc
    ) as rows
    from by_category cat
    left join baseline_by_category base on base.category_key = cat.category_key
  ),
  merchant_rows as (
    select jsonb_agg(m) as rows
    from (
      select jsonb_build_object(
        'merchant', coalesce(p.merchant, 'Sem estabelecimento'),
        'total', round(sum(p.amount), 2),
        'expense_count', count(*)
      ) as m
      from period_expenses p
      group by p.merchant
      order by sum(p.amount) desc
      limit 10
    ) top_merchants
  ),
  payment_rows as (
    select jsonb_agg(
      jsonb_build_object(
        'payment_method', coalesce(pm.name, 'Não informado'),
        'total', round(sum(p.amount), 2),
        'expense_count', count(*)
      )
      order by sum(p.amount) desc
    ) as rows
    from period_expenses p
    left join public.payment_methods pm on p.payment_method_id = pm.id
    group by pm.name
  ),
  queue as (
    select
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'waiting_user') as waiting_user,
      count(*) filter (where status = 'error') as errored,
      count(*) filter (where needs_detail = true and status <> 'done') as needs_detail
    from public.pending_expenses
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start', p_period_start,
      'end', p_period_end
    ),
    'totals', jsonb_build_object(
      'amount', round(coalesce((select sum(amount) from period_expenses), 0), 2),
      'expense_count', (select count(*) from period_expenses),
      'prior_4w_weekly_avg', round(
        coalesce((select sum(amount) from baseline_expenses), 0) / 4.0, 2
      )
    ),
    'by_category', coalesce((select rows from category_rows), '[]'::jsonb),
    'top_merchants', coalesce((select rows from merchant_rows), '[]'::jsonb),
    'by_payment_method', coalesce((select rows from payment_rows), '[]'::jsonb),
    'queue', (select to_jsonb(q) from queue q)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.get_analysis_context(date, date) is
  'Pre-aggregated period context for the analysis prompt: category totals vs. a 4-week baseline, top merchants, payment split and queue health';
