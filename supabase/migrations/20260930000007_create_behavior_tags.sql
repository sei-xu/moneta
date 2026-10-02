-- Closes the last branch of the weekly analysis flow (see
-- docs/fluxo-sessao-app-futuro.md, WE → WF/WG): a taxonomy_notes candidate
-- now has somewhere to land instead of staying only readable inside a
-- report. 'behavior_tag' is the common case; 'category' (a venue type
-- genuinely missing from the fixed categories) should be rare, so it lives
-- alongside the existing categories rather than in a second parallel table.

create table public.behavior_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  trigger_pattern text,
  example_items jsonb not null default '[]'::jsonb,
  status text not null default 'candidate',
  source_report_id uuid references public.reports (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,

  constraint behavior_tags_status_check check (status in ('candidate', 'approved', 'rejected'))
);

create index behavior_tags_status_idx on public.behavior_tags (status);

comment on table public.behavior_tags is 'Behavioral tags proposed by the weekly analysis (candidate/approved/rejected)';
comment on column public.behavior_tags.trigger_pattern is 'What the analysis says makes an expense match this tag';
comment on column public.behavior_tags.example_items is 'Merchant/item examples the analysis cited as evidence';

alter table public.behavior_tags enable row level security;

-- No automatic writer in this migration: tagging individual expenses is a
-- separate, unimplemented step (see docs/backlog.md). The table exists now
-- because a tag with nowhere to be applied is useless to design blind later.
create table public.expense_behavior_tags (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  behavior_tag_id uuid not null references public.behavior_tags (id) on delete cascade,
  confidence numeric,
  reasoning text,
  source text,
  created_at timestamptz not null default now(),

  primary key (expense_id, behavior_tag_id)
);

create index expense_behavior_tags_behavior_tag_id_idx
  on public.expense_behavior_tags (behavior_tag_id);

comment on table public.expense_behavior_tags is 'Which behavior tags apply to which expenses, and how confidently';

alter table public.expense_behavior_tags enable row level security;

-- A category candidate from the same flow lives in the existing taxonomy
-- rather than a parallel table — status mirrors behavior_tags so both kinds
-- of candidate are reviewed the same way.
alter table public.categories
  add column status text not null default 'approved',
  add column source_report_id uuid references public.reports (id) on delete set null;

alter table public.categories
  add constraint categories_status_check check (status in ('candidate', 'approved', 'rejected'));

comment on column public.categories.status is 'candidate (proposed by analysis), approved, or rejected';
comment on column public.categories.source_report_id is 'The report that proposed this category, when status started as candidate';

-- Same read pattern as the rest of the app's data (migration 20260930000006):
-- the allowlisted authenticated user can read, writes stay with
-- SECURITY DEFINER RPCs, and anon gets nothing.
create policy behavior_tags_app_read on public.behavior_tags
  for select to authenticated
  using (public.is_app_user());

create policy expense_behavior_tags_app_read on public.expense_behavior_tags
  for select to authenticated
  using (public.is_app_user());

revoke all on public.behavior_tags from anon;
revoke all on public.expense_behavior_tags from anon;

do $$
declare
  v_leak text[];
begin
  select array_agg(c.relname order by c.relname)
  into v_leak
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('behavior_tags', 'expense_behavior_tags')
    and has_table_privilege('anon', c.oid, 'select');

  if v_leak is not null then
    raise exception 'anon still holds select on: %', v_leak;
  end if;
end;
$$;
