-- Tally: stage 1 schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run; objects are created only if they do not exist yet.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 120),
  type              text not null check (type in (
                      'checking', 'savings', 'investment', 'retirement',
                      'home', 'vehicle', 'other_asset',
                      'credit_card', 'loan', 'mortgage', 'other_debt')),
  institution       text,
  identifier        text,                       -- street address (home) or VIN (vehicle)
  apr               numeric(6, 3) check (apr is null or apr >= 0),
  min_payment       numeric(14, 2) check (min_payment is null or min_payment >= 0),
  linked_account_id uuid references public.accounts (id) on delete set null,
  archived          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.balance_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  entry_date   date not null default current_date,
  balance      numeric(14, 2) not null check (balance >= 0),   -- asset value, or amount owed on a debt
  contribution numeric(14, 2),                                 -- deposits since the previous update
  mileage      integer check (mileage is null or mileage >= 0),
  source       text,                                           -- where a home/vehicle value came from
  note         text,
  created_at   timestamptz not null default now(),
  unique (account_id, entry_date)                              -- saving the same date again replaces it
);

create index if not exists accounts_user_idx on public.accounts (user_id);
create index if not exists balance_entries_user_idx on public.balance_entries (user_id);
create index if not exists balance_entries_account_date_idx on public.balance_entries (account_id, entry_date);

-- ---------------------------------------------------------------------------
-- Row level security: every row belongs to exactly one user
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.balance_entries enable row level security;

drop policy if exists "accounts: owner can read" on public.accounts;
drop policy if exists "accounts: owner can insert" on public.accounts;
drop policy if exists "accounts: owner can update" on public.accounts;
drop policy if exists "accounts: owner can delete" on public.accounts;

create policy "accounts: owner can read" on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "accounts: owner can insert" on public.accounts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      linked_account_id is null
      or exists (
        select 1 from public.accounts l
        where l.id = linked_account_id and l.user_id = (select auth.uid())
      )
    )
  );

create policy "accounts: owner can update" on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      linked_account_id is null
      or exists (
        select 1 from public.accounts l
        where l.id = linked_account_id and l.user_id = (select auth.uid())
      )
    )
  );

create policy "accounts: owner can delete" on public.accounts
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "entries: owner can read" on public.balance_entries;
drop policy if exists "entries: owner can insert" on public.balance_entries;
drop policy if exists "entries: owner can update" on public.balance_entries;
drop policy if exists "entries: owner can delete" on public.balance_entries;

create policy "entries: owner can read" on public.balance_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "entries: owner can insert" on public.balance_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy "entries: owner can update" on public.balance_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy "entries: owner can delete" on public.balance_entries
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users only, nothing for anonymous visitors
-- ---------------------------------------------------------------------------

revoke all on public.accounts from anon;
revoke all on public.balance_entries from anon;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.balance_entries to authenticated;
