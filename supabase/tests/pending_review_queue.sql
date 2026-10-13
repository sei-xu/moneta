-- Verification script for get_pending_review_queue(), the single
-- definition of "reviewable" shared by notify-pending-review and
-- telegram-ingest's /revisar.
--
-- Run with:
--
--   supabase db query --linked -f supabase/tests/pending_review_queue.sql
--
-- or paste it whole into the Supabase SQL Editor. It seeds synthetic data,
-- asserts, and rolls back — nothing is left behind. A clean run means every
-- assertion passed.

begin;

do $$
declare
  v_waiting_100 uuid;
  v_error_100 uuid;
  v_pending_100 uuid;
  v_done_100 uuid;
  v_discarded_100 uuid;
  v_waiting_200 uuid;
  v_waiting_null uuid;
  v_ids uuid[];
begin
  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz waiting 100', 'waiting_user', '100') returning id into v_waiting_100;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id, parsed_data, attempts)
  values ('zz error 100', 'error', '100', '{"error": "ApiError 503"}'::jsonb, 3) returning id into v_error_100;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz pending 100', 'pending', '100') returning id into v_pending_100;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz done 100', 'done', '100') returning id into v_done_100;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz discarded 100', 'discarded', '100') returning id into v_discarded_100;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz waiting 200', 'waiting_user', '200') returning id into v_waiting_200;

  insert into public.pending_expenses (raw_input, status, telegram_chat_id)
  values ('zz waiting null chat', 'waiting_user', null) returning id into v_waiting_null;

  -- Unscoped (p_chat_id = null): every reviewable row, across every sender,
  -- including the one with no sender — pending/done/discarded excluded.
  select array_agg(id order by id) into v_ids
  from public.get_pending_review_queue(null)
  where id in (v_waiting_100, v_error_100, v_pending_100, v_done_100, v_discarded_100, v_waiting_200, v_waiting_null);

  assert array_length(v_ids, 1) = 4, format('expected exactly 4 reviewable rows among the seeded ones, got %s', v_ids);
  assert v_waiting_100 = any(v_ids), 'waiting_user row for chat 100 missing from unscoped queue';
  assert v_error_100 = any(v_ids), 'error row for chat 100 missing from unscoped queue';
  assert v_waiting_200 = any(v_ids), 'waiting_user row for chat 200 missing from unscoped queue';
  assert v_waiting_null = any(v_ids), 'null-chat row missing from unscoped queue';
  assert not (v_pending_100 = any(v_ids)), 'pending row leaked into reviewable queue';
  assert not (v_done_100 = any(v_ids)), 'done row leaked into reviewable queue';
  assert not (v_discarded_100 = any(v_ids)), 'discarded row leaked into reviewable queue';

  -- Scoped to chat 100: only that sender's waiting_user + error rows —
  -- never the other chat's, and never the null-chat row.
  select array_agg(id order by id) into v_ids from public.get_pending_review_queue('100');
  assert v_waiting_100 = any(v_ids), 'waiting_user row for chat 100 missing when scoped to 100';
  assert v_error_100 = any(v_ids), 'error row for chat 100 missing when scoped to 100';
  assert not (v_waiting_200 = any(v_ids)), 'chat 200 row leaked into chat 100''s scoped queue';
  assert not (v_waiting_null = any(v_ids)), 'null-chat row leaked into chat 100''s scoped queue';

  -- Scoped to chat 200: isolates the other sender, confirming the filter
  -- is not accidentally a no-op.
  select array_agg(id order by id) into v_ids from public.get_pending_review_queue('200');
  assert v_ids = array[v_waiting_200], format('expected only chat 200''s row, got %s', v_ids);

  -- age_hours reflects a real elapsed time for a freshly inserted row —
  -- not null, not negative, and small.
  assert (
    select age_hours < 0.01 and age_hours is not null
    from public.get_pending_review_queue('100')
    where id = v_waiting_100
  ), 'age_hours should be a small non-negative number for a just-inserted row';

  -- anon and authenticated must not be able to call this — it is the raw
  -- pending_expenses backlog, including raw_input/parsed_data.
  assert not has_function_privilege('anon', 'public.get_pending_review_queue(text)', 'execute'),
    'anon should not be able to execute get_pending_review_queue';
  assert not has_function_privilege('authenticated', 'public.get_pending_review_queue(text)', 'execute'),
    'authenticated should not be able to execute get_pending_review_queue';

  raise notice 'pending_review_queue: all assertions passed';
end;
$$;

rollback;
