-- WhoDoesWhat: teams ROLLBACK. Undoes teams-final.sql and returns the database to the old schema
-- (schema.sql + add_project.sql) that the app on `main` was built for.
--
-- Use only if something is wrong with the database AFTER teams-final.sql committed AND you have
-- decided to go back to the single-user app. You normally do NOT need this: the old app keeps
-- working on the migrated database (tested), so a broken deploy is fixed in Vercel, not here.
--
-- What it keeps: every task row and every old column (title, assignee, deadline, status, project,
-- user_id, created_at), which teams-final.sql never changed. Tasks created in team projects stay
-- too, as rows of their creator.
-- What it removes, PERMANENTLY: projects, join codes, memberships, profiles / display names, and
-- the team columns on tasks (who owns it, accepted / declined by, handoffs). Back up first.
--
-- One transaction: if any statement fails, nothing changes.

begin;

-- 0. Locks: every lock this script needs, taken here, first, in one fixed order, before anything changes.
--      auth.users      ACCESS EXCLUSIVE  (DROP TRIGGER on_auth_user_created; dropping profiles / projects
--                      also removes their foreign-key triggers on auth.users). Sign-ins and sign-ups wait
--                      while it is held.
--      public.tasks    ACCESS EXCLUSIVE  (DROP TRIGGER / POLICY, DROP COLUMN). The app waits while it is held.
--      projects, profiles, project_members  ACCESS EXCLUSIVE (DROP TABLE), if they exist.
--    lock_timeout is SET LOCAL (this transaction only). If any lock isn't free within 5 s, the script
--    stops before changing anything.
set local lock_timeout = '5s';
do $$
declare
  t text;
begin
  lock table auth.users in access exclusive mode;
  lock table public.tasks in access exclusive mode;
  foreach t in array array['public.projects', 'public.profiles', 'public.project_members'] loop
    if to_regclass(t) is not null then
      execute format('lock table %s in access exclusive mode', t);
    end if;
  end loop;
exception when lock_not_available then
  raise exception 'could not get the locks in 5 s, nothing was changed, run again in a minute'
    using errcode = '55P03';
end;
$$;

create temporary table teams_rollback_before on commit drop as
select count(*) as n,
       (select count(*) from auth.users) as users,
       md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) as checksum
  from public.tasks;

-- Order matters (no CASCADE anywhere, so every dependency is removed explicitly):
--   policies and triggers use the functions  -> drop them first;
--   ensure_profile / create_project / join_project return the new tables' row types
--     -> drop the functions BEFORE the tables (a table cannot be dropped while a function returns it);
--   tasks' new columns reference the new tables (foreign keys) -> drop the columns before the tables;
--   project_members references profiles and projects, profiles references projects -> that order.
-- Dropping a column also drops its check constraint, foreign key, indexes and column privileges.

-- 1. Triggers (on auth.users and on tasks)
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists tasks_before_insert on public.tasks;
drop trigger if exists tasks_before_update on public.tasks;

-- 2. Every policy teams-final.sql added, on all four tables (the four original "own tasks"
--    policies on tasks stay). These are what blocked the first version of this script.
drop policy if exists "Tasks: members read project tasks" on public.tasks;
drop policy if exists "Tasks: project owners delete" on public.tasks;
drop policy if exists "Tasks: only inside your projects (select)" on public.tasks;
drop policy if exists "Tasks: only inside your projects (insert)" on public.tasks;
drop policy if exists "Tasks: only inside your projects (update)" on public.tasks;
drop policy if exists "Tasks: only inside your projects (delete)" on public.tasks;
drop policy if exists "Profiles: read own and teammates" on public.profiles;
drop policy if exists "Profiles: edit own" on public.profiles;
drop policy if exists "Projects: members read" on public.projects;
drop policy if exists "Projects: owners rename" on public.projects;
drop policy if exists "Members: members read" on public.project_members;

-- 3. Privileges on tasks back to what schema.sql granted
revoke update on public.tasks from authenticated;   -- also removes the column-level UPDATE grants
grant select, insert, update, delete on public.tasks to authenticated;

-- 4. Functions (nothing uses them any more; they still depend on the new tables, so before step 6)
drop function if exists public.handle_new_user();
drop function if exists public.tasks_before_insert();
drop function if exists public.tasks_before_update();
drop function if exists public.ensure_profile();
drop function if exists public.create_project(text);
drop function if exists public.join_project(text);
drop function if exists public.leave_project(uuid);
drop function if exists public.assign_task(uuid, uuid);
drop function if exists public.accept_task(uuid);
drop function if exists public.decline_task(uuid);
drop function if exists public.take_task(uuid);
drop function if exists public.complete_task(uuid);
drop function if exists public.reopen_task(uuid);
drop function if exists public.request_handoff(uuid, uuid);
drop function if exists public.respond_handoff(uuid, boolean);
drop function if exists public.cancel_handoff(uuid);
drop function if exists public.task_for_update(uuid);
drop function if exists public.require_user();
drop function if exists public.is_project_member(uuid);
drop function if exists public.is_project_owner(uuid);
drop function if exists public.is_member_of(uuid, uuid);
drop function if exists public.shares_project(uuid);
drop function if exists public.provision_user(uuid);
drop function if exists public.new_join_code();

-- 5. The columns teams-final.sql added to tasks (their constraint and indexes go with them)
alter table public.tasks
  drop column if exists project_id,
  drop column if exists assignee_id,
  drop column if exists state,
  drop column if exists accepted_by,
  drop column if exists accepted_at,
  drop column if exists declined_by,
  drop column if exists declined_at,
  drop column if exists handoff_to,
  drop column if exists handoff_requested_at,
  drop column if exists completed_at;

-- 6. The new tables
drop table if exists public.project_members;
drop table if exists public.profiles;
drop table if exists public.projects;

-- 7. Nothing old may have changed
do $$
declare
  b record;
begin
  select * into b from teams_rollback_before;
  if (select count(*) from public.tasks) <> b.n then
    raise exception 'Rollback check failed: task count changed';
  end if;
  if (select count(*) from auth.users) <> b.users then
    raise exception 'Rollback check failed: user count changed';
  end if;
  if (select md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) from public.tasks) <> b.checksum then
    raise exception 'Rollback check failed: old task columns changed';
  end if;
end;
$$;

commit;

select 'teams-rollback: back to the old schema' as result,
       (select count(*) from public.tasks) as tasks,
       (select count(*) from auth.users) as users,
       md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) as legacy_checksum
  from public.tasks;
