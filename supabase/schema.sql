-- Tally: database schema with shared households and roles
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- It works for a brand new project AND upgrades an existing Tally database in place:
-- your accounts and balance history are kept, and everything you have entered so far is
-- put into a household that you own. It is safe to re-run at any time. The whole script
-- runs as one transaction, so if anything fails nothing is changed.
--
-- Roles
--   owner        everything, plus invite people, change roles, remove people
--   editor       add, change and delete anything
--   contributor  add anything; change or delete only what they created
--   viewer       read only

begin;

-- ---------------------------------------------------------------------------
-- Households and membership
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Our household' check (char_length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'editor', 'contributor', 'viewer')),
  email        text,                                   -- copied at join time so the member list can show it
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email        text not null check (email = lower(email)),
  role         text not null check (role in ('editor', 'contributor', 'viewer')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (household_id, email)
);

create index if not exists household_members_user_idx on public.household_members (user_id);

-- ---------------------------------------------------------------------------
-- Data tables
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households (id) on delete cascade,
  created_by        uuid default auth.uid(),
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
  created_by   uuid default auth.uid(),
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

-- ---------------------------------------------------------------------------
-- Upgrade an existing (single-user) database: drop the old policies first, then reshape
-- ---------------------------------------------------------------------------

drop policy if exists "accounts: owner can read" on public.accounts;
drop policy if exists "accounts: owner can insert" on public.accounts;
drop policy if exists "accounts: owner can update" on public.accounts;
drop policy if exists "accounts: owner can delete" on public.accounts;
drop policy if exists "entries: owner can read" on public.balance_entries;
drop policy if exists "entries: owner can insert" on public.balance_entries;
drop policy if exists "entries: owner can update" on public.balance_entries;
drop policy if exists "entries: owner can delete" on public.balance_entries;

drop policy if exists "accounts: members can read" on public.accounts;
drop policy if exists "accounts: contributors and up can insert" on public.accounts;
drop policy if exists "accounts: editors, or creators, can update" on public.accounts;
drop policy if exists "accounts: editors, or creators, can delete" on public.accounts;
drop policy if exists "entries: members can read" on public.balance_entries;
drop policy if exists "entries: contributors and up can insert" on public.balance_entries;
drop policy if exists "entries: editors, or creators, can update" on public.balance_entries;
drop policy if exists "entries: editors, or creators, can delete" on public.balance_entries;

drop function if exists public.owns_account(uuid);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'accounts' and column_name = 'user_id') then
    alter table public.accounts rename column user_id to created_by;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'balance_entries' and column_name = 'user_id') then
    alter table public.balance_entries rename column user_id to created_by;
  end if;
end $$;

alter table public.accounts add column if not exists household_id uuid references public.households (id) on delete cascade;

-- created_by is the "who made this" marker. If a person is ever deleted, what they made stays.
alter table public.accounts drop constraint if exists accounts_user_id_fkey;
alter table public.accounts drop constraint if exists accounts_created_by_fkey;
alter table public.accounts alter column created_by drop not null;
alter table public.accounts add constraint accounts_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.balance_entries drop constraint if exists balance_entries_user_id_fkey;
alter table public.balance_entries drop constraint if exists balance_entries_created_by_fkey;
alter table public.balance_entries alter column created_by drop not null;
alter table public.balance_entries add constraint balance_entries_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

drop index if exists public.accounts_user_idx;
drop index if exists public.balance_entries_user_idx;
create index if not exists accounts_household_idx on public.accounts (household_id);
create index if not exists balance_entries_account_date_idx on public.balance_entries (account_id, entry_date);

-- ---------------------------------------------------------------------------
-- Move existing data into a household owned by whoever entered it
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  h uuid;
  first_user uuid;
begin
  for r in
    select distinct created_by as uid from public.accounts
    where household_id is null and created_by is not null
  loop
    select m.household_id into h
    from public.household_members m
    where m.user_id = r.uid and m.role = 'owner'
    order by m.created_at limit 1;

    if h is null then
      insert into public.households (name, created_by) values ('Our household', r.uid) returning id into h;
      insert into public.household_members (household_id, user_id, role, email)
      select h, r.uid, 'owner', lower(u.email) from auth.users u where u.id = r.uid;
    end if;

    update public.accounts set household_id = h where household_id is null and created_by = r.uid;
  end loop;

  -- Fresh install: if nobody has a household yet, the earliest user becomes the owner of a new one.
  if not exists (select 1 from public.households) then
    select u.id into first_user from auth.users u order by u.created_at limit 1;
    if first_user is not null then
      insert into public.households (name, created_by) values ('Our household', first_user) returning id into h;
      insert into public.household_members (household_id, user_id, role, email)
      select h, first_user, 'owner', lower(u.email) from auth.users u where u.id = first_user;
    end if;
  end if;

  if not exists (select 1 from public.accounts where household_id is null) then
    alter table public.accounts alter column household_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helper functions
-- SECURITY DEFINER lets the policies look things up without going through row level security
-- themselves (Postgres rejects that as "infinite recursion detected in policy").
-- To hide an account from certain people later, my_role() and can_read_account() are the
-- two places to teach about it.
-- ---------------------------------------------------------------------------

-- The signed-in user's role in a household, or null if they are not a member.
create or replace function public.my_role(h uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.household_members m
  where m.household_id = h and m.user_id = (select auth.uid());
$$;

create or replace function public.account_household(a uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ac.household_id from public.accounts ac where ac.id = a;
$$;

create or replace function public.can_read_account(a uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role(public.account_household(a)) is not null;
$$;

-- True when someone other than the signed-in user has recorded a balance on this account.
create or replace function public.account_has_foreign_entries(a uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.balance_entries e
    where e.account_id = a and e.created_by is distinct from (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Guards (triggers)
-- ---------------------------------------------------------------------------

-- Who made an item, and which household an account lives in, cannot be rewritten.
create or replace function public.lock_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is not null and new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed';
  end if;
  if tg_table_name = 'accounts' then
    if new.household_id is distinct from old.household_id then
      raise exception 'An account cannot be moved to another household';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_lock_ownership on public.accounts;
create trigger accounts_lock_ownership before update on public.accounts
  for each row execute function public.lock_ownership();

drop trigger if exists entries_lock_ownership on public.balance_entries;
create trigger entries_lock_ownership before update on public.balance_entries
  for each row execute function public.lock_ownership();

-- A household always keeps at least one owner.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Deleting the whole household (or the person's login) is allowed to take its owners with it.
    if exists (select 1 from public.households h where h.id = old.household_id)
       and not exists (
         select 1 from public.household_members m
         where m.household_id = old.household_id and m.role = 'owner' and m.user_id <> old.user_id
       )
       and exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'A household needs at least one owner. Make someone else an owner first.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists members_protect_last_owner on public.household_members;
create trigger members_protect_last_owner before update of role or delete on public.household_members
  for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.accounts enable row level security;
alter table public.balance_entries enable row level security;

-- Households: members can see theirs; only the owner can rename it.
drop policy if exists "households: members can read" on public.households;
drop policy if exists "households: owner can rename" on public.households;
create policy "households: members can read" on public.households
  for select to authenticated
  using (public.my_role(id) is not null);
create policy "households: owner can rename" on public.households
  for update to authenticated
  using (public.my_role(id) = 'owner')
  with check (public.my_role(id) = 'owner');

-- Members: everyone in a household sees the member list; only the owner changes roles or removes
-- people; anyone can remove themselves. People join through the invite functions below.
drop policy if exists "members: members can read" on public.household_members;
drop policy if exists "members: owner can change roles" on public.household_members;
drop policy if exists "members: owner can remove, anyone can leave" on public.household_members;
create policy "members: members can read" on public.household_members
  for select to authenticated
  using (public.my_role(household_id) is not null);
create policy "members: owner can change roles" on public.household_members
  for update to authenticated
  using (public.my_role(household_id) = 'owner')
  with check (public.my_role(household_id) = 'owner');
create policy "members: owner can remove, anyone can leave" on public.household_members
  for delete to authenticated
  using (public.my_role(household_id) = 'owner' or user_id = (select auth.uid()));

-- Invites: owner only.
drop policy if exists "invites: owner can read" on public.household_invites;
drop policy if exists "invites: owner can cancel" on public.household_invites;
create policy "invites: owner can read" on public.household_invites
  for select to authenticated
  using (public.my_role(household_id) = 'owner');
create policy "invites: owner can cancel" on public.household_invites
  for delete to authenticated
  using (public.my_role(household_id) = 'owner');

-- Accounts
create policy "accounts: members can read" on public.accounts
  for select to authenticated
  using (public.my_role(household_id) is not null);

create policy "accounts: contributors and up can insert" on public.accounts
  for insert to authenticated
  with check (
    public.my_role(household_id) in ('owner', 'editor', 'contributor')
    and created_by = (select auth.uid())
    and (linked_account_id is null or public.account_household(linked_account_id) = household_id)
  );

create policy "accounts: editors, or creators, can update" on public.accounts
  for update to authenticated
  using (
    public.my_role(household_id) in ('owner', 'editor')
    or (public.my_role(household_id) = 'contributor' and created_by = (select auth.uid()))
  )
  with check (
    (public.my_role(household_id) in ('owner', 'editor')
      or (public.my_role(household_id) = 'contributor' and created_by = (select auth.uid())))
    and (linked_account_id is null or public.account_household(linked_account_id) = household_id)
  );

-- A contributor can delete an account they created only while all of its history is theirs too,
-- so deleting it can never wipe out someone else's entries.
create policy "accounts: editors, or creators, can delete" on public.accounts
  for delete to authenticated
  using (
    public.my_role(household_id) in ('owner', 'editor')
    or (public.my_role(household_id) = 'contributor'
        and created_by = (select auth.uid())
        and not public.account_has_foreign_entries(id))
  );

-- Balance entries
create policy "entries: members can read" on public.balance_entries
  for select to authenticated
  using (public.can_read_account(account_id));

create policy "entries: contributors and up can insert" on public.balance_entries
  for insert to authenticated
  with check (
    public.my_role(public.account_household(account_id)) in ('owner', 'editor', 'contributor')
    and created_by = (select auth.uid())
  );

create policy "entries: editors, or creators, can update" on public.balance_entries
  for update to authenticated
  using (
    public.my_role(public.account_household(account_id)) in ('owner', 'editor')
    or (public.my_role(public.account_household(account_id)) = 'contributor' and created_by = (select auth.uid()))
  )
  with check (
    public.my_role(public.account_household(account_id)) in ('owner', 'editor')
    or (public.my_role(public.account_household(account_id)) = 'contributor' and created_by = (select auth.uid()))
  );

create policy "entries: editors, or creators, can delete" on public.balance_entries
  for delete to authenticated
  using (
    public.my_role(public.account_household(account_id)) in ('owner', 'editor')
    or (public.my_role(public.account_household(account_id)) = 'contributor' and created_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Invites
--   invite_member: the owner adds someone by email. If that person already has a login they are
--                  added straight away; otherwise the invite waits for them.
--   accept_invites: the app calls this on sign-in; it turns any waiting invite for the signed-in
--                  (email-confirmed) user into a membership.
-- ---------------------------------------------------------------------------

create or replace function public.invite_member(h uuid, mail text, member_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  clean text := lower(trim(mail));
  existing uuid;
begin
  if public.my_role(h) is distinct from 'owner' then
    raise exception 'Only the owner can invite people';
  end if;
  if member_role not in ('editor', 'contributor', 'viewer') then
    raise exception 'Choose editor, contributor or viewer';
  end if;
  if clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select u.id into existing
  from auth.users u
  where lower(u.email) = clean and u.email_confirmed_at is not null
  limit 1;

  if existing is not null then
    if exists (select 1 from public.household_members m where m.household_id = h and m.user_id = existing) then
      raise exception 'That person is already a member';
    end if;
    insert into public.household_members (household_id, user_id, role, email)
    values (h, existing, member_role, clean);
    delete from public.household_invites i where i.household_id = h and i.email = clean;
    return 'added';
  end if;

  insert into public.household_invites (household_id, email, role, invited_by)
  values (h, clean, member_role, me)
  on conflict (household_id, email) do update set role = excluded.role;
  return 'pending';
end;
$$;

create or replace function public.accept_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  mail text;
  joined integer;
begin
  if me is null then return 0; end if;
  select lower(u.email) into mail
  from auth.users u
  where u.id = me and u.email_confirmed_at is not null;
  if mail is null then return 0; end if;

  with taken as (
    delete from public.household_invites i
    where i.email = mail
    returning i.household_id, i.role
  )
  insert into public.household_members (household_id, user_id, role, email)
  select t.household_id, me, t.role, mail from taken t
  on conflict (household_id, user_id) do nothing;

  get diagnostics joined = row_count;
  return joined;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users only, nothing for anonymous visitors
-- ---------------------------------------------------------------------------

revoke all on public.households, public.household_members, public.household_invites,
              public.accounts, public.balance_entries from anon;
revoke all on public.households, public.household_members, public.household_invites,
              public.accounts, public.balance_entries from authenticated;

grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant update (role) on public.household_members to authenticated;
grant delete on public.household_members to authenticated;
grant select, delete on public.household_invites to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.balance_entries to authenticated;

revoke all on function public.my_role(uuid), public.account_household(uuid), public.can_read_account(uuid),
              public.account_has_foreign_entries(uuid), public.invite_member(uuid, text, text),
              public.accept_invites() from public, anon;
grant execute on function public.my_role(uuid), public.account_household(uuid), public.can_read_account(uuid),
              public.account_has_foreign_entries(uuid), public.invite_member(uuid, text, text),
              public.accept_invites() to authenticated;

commit;

-- If the app says it cannot find a table or function right after running this, run:
--   notify pgrst, 'reload schema';
