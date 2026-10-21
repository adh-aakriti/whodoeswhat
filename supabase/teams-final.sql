-- WhoDoesWhat: teams. FINAL migration script (teams.sql + teams-patch-1.sql + later fixes, in one file).
--
-- Run ONCE, in the Supabase SQL Editor of the project it is meant for, after taking the backup
-- described in MERGE-PLAN-teams.md. Needs the old schema (schema.sql + add_project.sql) in place.
--
-- Additive only: new tables, new columns on public.tasks, functions, triggers and policies.
-- Nothing existing is renamed or dropped, so the app on `main` keeps working during and after.
-- The one permission change: the table-wide UPDATE grant on tasks becomes column grants on
-- exactly the legacy columns the old app edits (section 8).
--
-- One transaction. Section 6 aborts everything (nothing changes) if the task count, the user
-- count or any old task field would change, or if any user ends up without a profile or project.
-- The last statement prints a one-row summary to compare with the "before" numbers.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  join_code   text not null unique check (join_code ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
  is_personal boolean not null default false,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
-- One personal project per user, even if two sign-up paths race.
create unique index if not exists projects_one_personal_per_user on public.projects (created_by) where is_personal;

-- Display names only. Deliberately no email column.
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text not null check (char_length(btrim(display_name)) between 1 and 60),
  current_project_id uuid references public.projects (id) on delete set null,
  created_at         timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_id_idx on public.project_members (user_id);

-- New columns on the existing tasks table (legacy columns untouched).
alter table public.tasks
  add column if not exists project_id           uuid references public.projects (id) on delete cascade,
  add column if not exists assignee_id          uuid references public.profiles (id) on delete set null,
  add column if not exists state                text,
  add column if not exists accepted_by          uuid references public.profiles (id) on delete set null,
  add column if not exists accepted_at          timestamptz,
  add column if not exists declined_by          uuid references public.profiles (id) on delete set null,
  add column if not exists declined_at          timestamptz,
  add column if not exists handoff_to           uuid references public.profiles (id) on delete set null,
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists completed_at         timestamptz;
create index if not exists tasks_project_id_created_at_idx on public.tasks (project_id, created_at desc);
create index if not exists tasks_assignee_id_idx on public.tasks (assignee_id);

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (not callable through the API: no EXECUTE for anon / authenticated)
-- ---------------------------------------------------------------------------

-- 10 characters from a 30-letter alphabet without look-alikes (no 0 O 1 I L U): ~49 bits.
-- Rejection sampling (bytes >= 240 are skipped) keeps every letter equally likely.
create or replace function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  code text;
  bytes bytea;
  b int;
  i int;
begin
  loop
    code := '';
    while char_length(code) < 10 loop
      bytes := extensions.gen_random_bytes(16);
      for i in 0..15 loop
        b := get_byte(bytes, i);
        if b < 240 and char_length(code) < 10 then
          code := code || substr(alphabet, (b % 30) + 1, 1);
        end if;
      end loop;
    end loop;
    exit when not exists (select 1 from public.projects p where p.join_code = code);
  end loop;
  return code;
end;
$$;

-- Creates whatever is missing for one user: profile, personal project, owner membership,
-- current project. Idempotent. Only ever called from the security definer functions below.
create or replace function public.provision_user(uid uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  mail text;
  personal uuid;
begin
  select u.email into mail from auth.users u where u.id = uid;
  if not found then
    return;
  end if;

  insert into public.profiles (id, display_name)
  values (uid, coalesce(nullif(btrim(left(split_part(coalesce(mail, ''), '@', 1), 60)), ''), 'member'))
  on conflict (id) do nothing;

  select p.id into personal from public.projects p where p.created_by = uid and p.is_personal;
  if personal is null then
    insert into public.projects (name, join_code, is_personal, created_by)
    values ('Personal', public.new_join_code(), true, uid)
    on conflict (created_by) where is_personal do nothing
    returning id into personal;
    if personal is null then
      select p.id into personal from public.projects p where p.created_by = uid and p.is_personal;
    end if;
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (personal, uid, 'owner')
  on conflict (project_id, user_id) do nothing;

  update public.profiles
     set current_project_id = personal
   where id = uid and current_project_id is null;
end;
$$;

revoke all on function public.new_join_code() from public, anon, authenticated;
revoke all on function public.provision_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Membership helpers for RLS (security definer, empty search_path, check auth.uid())
--    Policies call these instead of querying project_members, so they never recurse.
-- ---------------------------------------------------------------------------

create or replace function public.is_project_member(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.project_members m
     where m.project_id = p and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_owner(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.project_members m
     where m.project_id = p and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Is user u in project p? Only answers for projects the caller is in.
create or replace function public.is_member_of(p uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.project_members m where m.project_id = p and m.user_id = auth.uid())
     and exists (select 1 from public.project_members m where m.project_id = p and m.user_id = u);
$$;

-- Does the caller share at least one project with user u? (Used to read teammates' names.)
create or replace function public.shares_project(u uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid() and theirs.user_id = u
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. RPCs (security definer, empty search_path, auth.uid() checked first)
--    The only way to change a task's owner or state, and to create / join projects.
-- ---------------------------------------------------------------------------

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please log in first.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.require_user() from public, anon, authenticated;

-- Safety net for sign-up: /app calls this when a profile is missing.
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  result public.profiles;
begin
  perform public.provision_user(uid);
  select * into result from public.profiles where id = uid;
  return result;
end;
$$;

create or replace function public.create_project(p_name text)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  result public.projects;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the project a name (up to 80 characters).' using errcode = '22023';
  end if;
  perform public.provision_user(uid);
  insert into public.projects (name, join_code, is_personal, created_by)
  values (btrim(p_name), public.new_join_code(), false, uid)
  returning * into result;
  insert into public.project_members (project_id, user_id, role) values (result.id, uid, 'owner');
  update public.profiles set current_project_id = result.id where id = uid;
  return result;
end;
$$;

-- Same answer for "no such code" and "that's a personal project", so codes can't be probed.
create or replace function public.join_project(p_code text)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  result public.projects;
begin
  select * into result from public.projects p where p.join_code = code and not p.is_personal;
  if not found then
    raise exception 'That code does not match a team project. Check it and try again.' using errcode = 'P0002';
  end if;
  perform public.provision_user(uid);
  insert into public.project_members (project_id, user_id, role)
  values (result.id, uid, 'member')
  on conflict (project_id, user_id) do nothing;
  update public.profiles set current_project_id = result.id where id = uid;
  return result;
end;
$$;

create or replace function public.leave_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  proj public.projects;
  my_role text;
begin
  select * into proj from public.projects where id = p_project;
  select m.role into my_role from public.project_members m where m.project_id = p_project and m.user_id = uid;
  if not found or proj.id is null then
    raise exception 'You are not in that project.' using errcode = 'P0002';
  end if;
  if proj.is_personal then
    raise exception 'Your personal project cannot be left.' using errcode = '42501';
  end if;
  if my_role = 'owner'
     and not exists (select 1 from public.project_members m where m.project_id = p_project and m.role = 'owner' and m.user_id <> uid)
     and exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id <> uid) then
    raise exception 'You are the only owner. Everyone else would lose the project, so you cannot leave yet.' using errcode = '42501';
  end if;
  -- Unfinished work goes back to the team; pending handoffs to the leaver are cancelled.
  update public.tasks
     set assignee_id = null, state = 'open', accepted_by = null, accepted_at = null,
         handoff_to = null, handoff_requested_at = null
   where project_id = p_project and assignee_id = uid and state <> 'done';
  update public.tasks
     set handoff_to = null, handoff_requested_at = null
   where project_id = p_project and handoff_to = uid;
  delete from public.project_members where project_id = p_project and user_id = uid;
  update public.profiles
     set current_project_id = (select p.id from public.projects p where p.created_by = uid and p.is_personal)
   where id = uid and current_project_id = p_project;
end;
$$;

-- Loads a task the caller may see, locked for update.
create or replace function public.task_for_update(p_task uuid)
returns public.tasks
language plpgsql
volatile
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not public.is_project_member(t.project_id) then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  return t;
end;
$$;
revoke all on function public.task_for_update(uuid) from public, anon, authenticated;

-- Creator or project owner sets the owner of a task that nobody has accepted yet.
-- Nobody -> open. Myself -> accepted at once. Someone else -> proposed (they must accept).
create or replace function public.assign_task(p_task uuid, p_assignee uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if uid <> t.user_id and not public.is_project_owner(t.project_id) then
    raise exception 'Only the person who created this task, or a project owner, can choose its owner.' using errcode = '42501';
  end if;
  if t.state not in ('open', 'proposed', 'declined') then
    raise exception 'This task has already been accepted. Use a handoff to give it to someone else.' using errcode = '42501';
  end if;
  if p_assignee is not null and not public.is_member_of(t.project_id, p_assignee) then
    raise exception 'Choose someone who is in this project.' using errcode = '22023';
  end if;
  update public.tasks
     set assignee_id = p_assignee,
         state = case when p_assignee is null then 'open' when p_assignee = uid then 'accepted' else 'proposed' end,
         accepted_by = case when p_assignee = uid then uid end,
         accepted_at = case when p_assignee = uid then now() end,
         declined_by = null, declined_at = null,
         handoff_to = null, handoff_requested_at = null
   where id = p_task
   returning * into t;
  return t;
end;
$$;

create or replace function public.accept_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.state <> 'proposed' or t.assignee_id is distinct from uid then
    raise exception 'Only the person this task is proposed to can accept it.' using errcode = '42501';
  end if;
  update public.tasks
     set state = 'accepted', accepted_by = uid, accepted_at = now(), declined_by = null, declined_at = null
   where id = p_task
   returning * into t;
  return t;
end;
$$;

create or replace function public.decline_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.state <> 'proposed' or t.assignee_id is distinct from uid then
    raise exception 'Only the person this task is proposed to can decline it.' using errcode = '42501';
  end if;
  update public.tasks
     set state = 'declined', declined_by = uid, declined_at = now()
   where id = p_task
   returning * into t;
  return t;
end;
$$;

-- "I'll take it": first member to click wins; everyone else gets a clear message.
create or replace function public.take_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not public.is_project_member(t.project_id) then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  update public.tasks
     set assignee_id = uid, state = 'accepted', accepted_by = uid, accepted_at = now(),
         declined_by = null, declined_at = null
   where id = p_task and state = 'open' and assignee_id is null
   returning * into t;
  if not found then
    -- P0001, not 40001: PostgREST retries serialization failures, which would leave the loser waiting.
    raise exception 'Someone else already took this task.' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

create or replace function public.complete_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.state <> 'accepted' or (t.assignee_id is distinct from uid and not public.is_project_owner(t.project_id)) then
    raise exception 'Only the owner of an accepted task can mark it done.' using errcode = '42501';
  end if;
  update public.tasks
     set state = 'done', completed_at = now(), handoff_to = null, handoff_requested_at = null
   where id = p_task
   returning * into t;
  return t;
end;
$$;

create or replace function public.reopen_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.state <> 'done' or (t.assignee_id is distinct from uid and not public.is_project_owner(t.project_id)) then
    raise exception 'Only the owner of a done task can reopen it.' using errcode = '42501';
  end if;
  update public.tasks set state = 'accepted', completed_at = null where id = p_task returning * into t;
  return t;
end;
$$;

create or replace function public.request_handoff(p_task uuid, p_to uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.state <> 'accepted' or t.assignee_id is distinct from uid then
    raise exception 'Only the owner of an accepted task can hand it off.' using errcode = '42501';
  end if;
  if p_to is null or p_to = uid or not public.is_member_of(t.project_id, p_to) then
    raise exception 'Choose another person in this project.' using errcode = '22023';
  end if;
  update public.tasks set handoff_to = p_to, handoff_requested_at = now() where id = p_task returning * into t;
  return t;
end;
$$;

create or replace function public.respond_handoff(p_task uuid, p_accept boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.handoff_to is distinct from uid or t.state <> 'accepted' then
    raise exception 'Only the person this task is being handed to can answer.' using errcode = '42501';
  end if;
  if p_accept then
    update public.tasks
       set assignee_id = uid, accepted_by = uid, accepted_at = now(), handoff_to = null, handoff_requested_at = null
     where id = p_task
     returning * into t;
  else
    update public.tasks set handoff_to = null, handoff_requested_at = null where id = p_task returning * into t;
  end if;
  return t;
end;
$$;

create or replace function public.cancel_handoff(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  t public.tasks := public.task_for_update(p_task);
begin
  if t.handoff_to is null or t.assignee_id is distinct from uid then
    raise exception 'Only the owner can cancel this handoff.' using errcode = '42501';
  end if;
  update public.tasks set handoff_to = null, handoff_requested_at = null where id = p_task returning * into t;
  return t;
end;
$$;

-- Every API-facing security definer function: logged-in users only.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_project_member(uuid)', 'public.is_project_owner(uuid)', 'public.is_member_of(uuid, uuid)',
    'public.shares_project(uuid)', 'public.ensure_profile()', 'public.create_project(text)',
    'public.join_project(text)', 'public.leave_project(uuid)', 'public.assign_task(uuid, uuid)',
    'public.accept_task(uuid)', 'public.decline_task(uuid)', 'public.take_task(uuid)',
    'public.complete_task(uuid)', 'public.reopen_task(uuid)', 'public.request_handoff(uuid, uuid)',
    'public.respond_handoff(uuid, boolean)', 'public.cancel_handoff(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Backfill (runs as the SQL editor's role, so RLS does not apply)
-- ---------------------------------------------------------------------------

create temporary table teams_migration_before on commit drop as
select count(*) as n,
       (select count(*) from auth.users) as users,
       md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) as checksum
  from public.tasks;

-- Every existing user gets a profile, a personal project and an owner membership.
do $$
declare
  u record;
begin
  for u in select id from auth.users loop
    perform public.provision_user(u.id);
  end loop;
end;
$$;

-- Every existing task moves into its creator's personal project, owned and accepted by them
-- (they were the only real person who could own it). Legacy columns are not touched: the old
-- free-text owner and the old project label stay, and the app shows them as a note.
update public.tasks t
   set project_id  = p.id,
       assignee_id = t.user_id,
       state       = t.status,
       accepted_by = case when t.status in ('accepted', 'done') then t.user_id end,
       accepted_at = case when t.status in ('accepted', 'done') then t.created_at end,
       completed_at = case when t.status = 'done' then t.created_at end
  from public.projects p
 where p.created_by = t.user_id and p.is_personal and t.project_id is null;

-- ---------------------------------------------------------------------------
-- 6. Migration checks: abort everything if anything is off
-- ---------------------------------------------------------------------------

do $$
declare
  before_n bigint;
  before_sum text;
  before_users bigint;
  after_n bigint;
  after_sum text;
begin
  select n, checksum, users into before_n, before_sum, before_users from teams_migration_before;
  select count(*),
         md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), ''))
    into after_n, after_sum
    from public.tasks;
  if after_n <> before_n then
    raise exception 'Migration check failed: task count changed (% -> %)', before_n, after_n;
  end if;
  if (select count(*) from auth.users) <> before_users then
    raise exception 'Migration check failed: user count changed (% -> %)', before_users, (select count(*) from auth.users);
  end if;
  if (select count(*) from public.profiles) <> before_users then
    raise exception 'Migration check failed: % users but % profiles', before_users, (select count(*) from public.profiles);
  end if;
  if after_sum <> before_sum then
    raise exception 'Migration check failed: legacy task columns changed';
  end if;
  if exists (select 1 from public.tasks where project_id is null or state is null) then
    raise exception 'Migration check failed: some tasks have no project or state';
  end if;
  if exists (select 1 from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) then
    raise exception 'Migration check failed: a user has no profile';
  end if;
  if exists (select 1 from auth.users u where not exists (select 1 from public.projects p where p.created_by = u.id and p.is_personal)) then
    raise exception 'Migration check failed: a user has no personal project';
  end if;
  raise notice 'Migration checks passed: % tasks kept unchanged, % users set up', after_n, (select count(*) from auth.users);
end;
$$;

alter table public.tasks alter column project_id set not null;
alter table public.tasks alter column state set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_state_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_state_check
      check (state in ('open', 'proposed', 'accepted', 'declined', 'done'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Triggers
-- ---------------------------------------------------------------------------

-- Sign-up: set the new user up. Must never block sign-up, so any error becomes a warning
-- (and /app calls ensure_profile() to fill the gap). There is no session during sign-up,
-- so instead of auth.uid() it only ever acts on the row being inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.provision_user(new.id);
  exception when others then
    raise warning 'WhoDoesWhat: could not set up user % (%). ensure_profile() will retry.', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Every insert, from either app, is normalised here, so a client cannot forge who accepted.
--   * project_id missing (live app) -> creator's PERSONAL project (never a team: the old app has
--     no idea which team is current, so its tasks stay private).
--   * state missing (live app) -> owner = creator, state taken from the legacy status.
--   * state 'open' -> nobody owns it. Owner = creator -> any of proposed/accepted/done.
--     Owner = someone else -> always 'proposed' until they accept.
--   * legacy status and project label are kept in sync for the live app.
create or replace function public.tasks_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  creator uuid := coalesce(new.user_id, auth.uid());
  team_name text;
begin
  new.user_id := creator;

  if new.project_id is null then
    select p.id into new.project_id from public.projects p where p.created_by = creator and p.is_personal;
    if new.project_id is null then
      perform public.ensure_profile();
      select p.id into new.project_id from public.projects p where p.created_by = creator and p.is_personal;
    end if;
  end if;

  if new.state is null then
    new.assignee_id := coalesce(new.assignee_id, creator);
    new.state := case when new.assignee_id = creator then coalesce(new.status, 'proposed') else 'proposed' end;
  elsif new.state = 'open' then
    new.assignee_id := null;
  elsif new.assignee_id is null then
    new.assignee_id := creator;
  end if;

  if new.assignee_id is not null and not public.is_member_of(new.project_id, new.assignee_id) then
    raise exception 'Choose someone who is in this project.' using errcode = '22023';
  end if;

  if new.assignee_id is null then
    new.state := 'open';
  elsif new.assignee_id <> creator then
    new.state := 'proposed';
  elsif new.state not in ('proposed', 'accepted', 'done') then
    new.state := 'accepted';
  end if;

  new.accepted_by := case when new.state in ('accepted', 'done') then creator end;
  new.accepted_at := case when new.state in ('accepted', 'done') then now() end;
  new.completed_at := case when new.state = 'done' then now() end;
  new.declined_by := null;
  new.declined_at := null;
  new.handoff_to := null;
  new.handoff_requested_at := null;

  new.status := case new.state when 'accepted' then 'accepted' when 'done' then 'done' else 'proposed' end;
  -- Label for the live app: the team's name, else whatever label the client sent, else General.
  select p.name into team_name from public.projects p where p.id = new.project_id and not p.is_personal;
  new.project := coalesce(team_name, nullif(btrim(new.project), ''), 'General');
  return new;
end;
$$;
revoke all on function public.tasks_before_insert() from public, anon, authenticated;

-- Workflow columns can only be written by the RPCs (column grants, section 8). When they change,
-- keep the legacy status in sync. When only the legacy status changes (the live app's dropdown),
-- map it into the workflow, but only for tasks the creator owns themselves, so the old dropdown
-- can never accept a teammate's task for them.
create or replace function public.tasks_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state
     or new.assignee_id is distinct from old.assignee_id
     or new.handoff_to is distinct from old.handoff_to then
    new.status := case new.state when 'accepted' then 'accepted' when 'done' then 'done' else 'proposed' end;
  elsif new.status is distinct from old.status then
    if old.assignee_id is distinct from old.user_id then
      raise exception 'This task belongs to a teammate. Change it in the team view.' using errcode = '42501';
    end if;
    new.state := new.status;
    if new.status in ('accepted', 'done') and old.state not in ('accepted', 'done') then
      new.accepted_by := old.user_id;
      new.accepted_at := now();
    elsif new.status = 'proposed' then
      new.accepted_by := null;
      new.accepted_at := null;
    end if;
    new.completed_at := case when new.status = 'done' then coalesce(old.completed_at, now()) end;
    new.handoff_to := null;
    new.handoff_requested_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_before_update() from public, anon, authenticated;

drop trigger if exists tasks_before_insert on public.tasks;
create trigger tasks_before_insert before insert on public.tasks
  for each row execute function public.tasks_before_insert();
drop trigger if exists tasks_before_update on public.tasks;
create trigger tasks_before_update before update on public.tasks
  for each row execute function public.tasks_before_update();

-- ---------------------------------------------------------------------------
-- 8. Privileges and RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;

-- Nothing for anonymous visitors. Logged-in users get only what each table needs.
revoke all on public.profiles, public.projects, public.project_members from anon, authenticated;
revoke all on public.tasks from anon;
revoke update, truncate, references, trigger on public.tasks from authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, current_project_id) on public.profiles to authenticated;
grant select on public.projects to authenticated;
grant update (name) on public.projects to authenticated;
grant select on public.project_members to authenticated;
-- tasks: select / insert / delete stay as before; UPDATE only on the legacy columns the live app
-- edits. state, assignee_id, project_id, accepted_*, declined_*, handoff_*, completed_at: RPCs only.
grant select, insert, delete on public.tasks to authenticated;
grant update (title, assignee, deadline, status, project) on public.tasks to authenticated;

-- profiles: own row, plus people you share a project with. Insert / delete: none (trigger / RPC).
drop policy if exists "Profiles: read own and teammates" on public.profiles;
create policy "Profiles: read own and teammates"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_project(id));
drop policy if exists "Profiles: edit own" on public.profiles;
create policy "Profiles: edit own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid())
              and (current_project_id is null or public.is_project_member(current_project_id)));

-- projects: members read; owners rename. Insert / delete: none (create_project RPC).
drop policy if exists "Projects: members read" on public.projects;
create policy "Projects: members read"
  on public.projects for select to authenticated
  using (public.is_project_member(id));
drop policy if exists "Projects: owners rename" on public.projects;
create policy "Projects: owners rename"
  on public.projects for update to authenticated
  using (public.is_project_owner(id))
  with check (public.is_project_owner(id));

-- project_members: members see who else is in. Insert / update / delete: none (RPCs).
drop policy if exists "Members: members read" on public.project_members;
create policy "Members: members read"
  on public.project_members for select to authenticated
  using (public.is_project_member(project_id));

-- tasks: the four existing "own tasks" policies stay. Added:
drop policy if exists "Tasks: members read project tasks" on public.tasks;
create policy "Tasks: members read project tasks"
  on public.tasks for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Tasks: project owners delete" on public.tasks;
create policy "Tasks: project owners delete"
  on public.tasks for delete to authenticated
  using (public.is_project_owner(project_id));
-- Restrictive (ANDed with every other policy): you must be in the task's project, for every action.
drop policy if exists "Tasks: only inside your projects (select)" on public.tasks;
create policy "Tasks: only inside your projects (select)"
  on public.tasks as restrictive for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Tasks: only inside your projects (insert)" on public.tasks;
create policy "Tasks: only inside your projects (insert)"
  on public.tasks as restrictive for insert to authenticated
  with check (public.is_project_member(project_id));
drop policy if exists "Tasks: only inside your projects (update)" on public.tasks;
create policy "Tasks: only inside your projects (update)"
  on public.tasks as restrictive for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));
drop policy if exists "Tasks: only inside your projects (delete)" on public.tasks;
create policy "Tasks: only inside your projects (delete)"
  on public.tasks as restrictive for delete to authenticated
  using (public.is_project_member(project_id));

commit;

-- Summary to compare with the numbers recorded before running (see MERGE-PLAN-teams.md).
select 'teams-final: migration committed' as result,
       (select count(*) from public.tasks) as tasks,
       (select count(*) from auth.users) as users,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from public.projects where is_personal) as personal_projects,
       (select count(*) from public.tasks where project_id is null or state is null) as tasks_missing_project_or_state,
       md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) as legacy_checksum
  from public.tasks;
