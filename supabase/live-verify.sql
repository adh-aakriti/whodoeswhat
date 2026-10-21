-- READ-ONLY verification after teams-final.sql (one SELECT; it changes nothing).
-- Run in the SQL Editor of the project that was migrated. Every row has `ok` = true when all is as expected.
-- The task count and checksum expectations are the values teams-final.sql reported on live
-- (13 tasks, checksum 8580e101b5ac1162b72e23994b732a98). If anyone has added, edited or deleted a task
-- since, those two rows will show false. Compare `actual` with what changed; it is not an error.

with
expected_functions(name) as (values
  ('accept_task'), ('assign_task'), ('cancel_handoff'), ('complete_task'), ('create_project'), ('decline_task'),
  ('ensure_profile'), ('handle_new_user'), ('is_member_of'), ('is_project_member'), ('is_project_owner'),
  ('join_project'), ('leave_project'), ('new_join_code'), ('provision_user'), ('reopen_task'), ('request_handoff'),
  ('require_user'), ('respond_handoff'), ('shares_project'), ('take_task'), ('task_for_update'),
  ('tasks_before_insert'), ('tasks_before_update')),
fns as (select p.proname::text name, p.prosecdef definer, p.proconfig, p.proacl
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'),
checks(n, check_name, actual, expected) as (
  select 1, 'tasks (count)', (select count(*)::text from public.tasks), '13'
  union all select 2, 'users (count)', (select count(*)::text from auth.users), '26'
  union all select 3, 'profiles = users', (select count(*)::text from public.profiles), (select count(*)::text from auth.users)
  union all select 4, 'personal projects = users', (select count(*)::text from public.projects where is_personal), (select count(*)::text from auth.users)
  union all select 5, 'every user is owner of their personal project',
    (select count(*)::text from public.projects p join public.project_members m on m.project_id = p.id and m.user_id = p.created_by and m.role = 'owner' where p.is_personal),
    (select count(*)::text from auth.users)
  union all select 6, 'tasks with no project or state', (select count(*)::text from public.tasks where project_id is null or state is null), '0'
  union all select 7, 'old-column checksum',
    (select md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) from public.tasks),
    '8580e101b5ac1162b72e23994b732a98'
  union all select 8, 'teams functions present (of 24)', (select count(*)::text from fns where name in (select name from expected_functions)), '24'
  union all select 9, 'other functions in public (besides rls_auto_enable)', (select coalesce(string_agg(name, ', '), 'none') from fns where name not in (select name from expected_functions)), 'none'
  union all select 10, 'API functions: security definer, search_path empty, no EXECUTE for anon / public',
    (select count(*)::text from fns where definer and proconfig @> array['search_path=""']
       and not coalesce(array_to_string(proacl, ',') ~ '(^|,)(anon)?=X', false)),
    (select count(*)::text from fns where definer)
  union all select 11, 'tables (profiles, project_members, projects)',
    (select string_agg(relname, ', ' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'tasks'),
    'profiles, project_members, projects'
  union all select 12, 'RLS on for all 4 tables',
    (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity), '4'
  union all select 13, 'policies: tasks / profiles / projects / project_members',
    (select string_agg(n::text, ' / ' order by ord) from (select t.ord, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) n
       from (values (1, 'tasks'), (2, 'profiles'), (3, 'projects'), (4, 'project_members')) t(ord, name)) x),
    '10 / 2 / 2 / 1'
  union all select 14, 'triggers',
    (select string_agg(tgname, ', ' order by tgname) from pg_trigger where not tgisinternal and tgrelid in ('auth.users'::regclass, 'public.tasks'::regclass)),
    'on_auth_user_created, tasks_before_insert, tasks_before_update'
  union all select 15, 'tasks columns', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'tasks'), '18'
  union all select 16, 'anon privileges on the 4 tables',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in ('tasks', 'profiles', 'projects', 'project_members')), '0'
  union all select 17, 'authenticated may UPDATE only the 5 old tasks columns',
    (select string_agg(column_name, ', ' order by column_name) from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'tasks' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
    'assignee, deadline, project, status, title'
  union all select 18, 'profiles contain no email column',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name ilike '%mail%'), '0'
)
select n, check_name, actual, expected, actual = expected as ok from checks order by n;
