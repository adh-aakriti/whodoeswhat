-- TEST PROJECT ONLY (whodoeswhat-teams-test). Deletes every account and task so old-style data can be
-- seeded again. It refuses to run anywhere else: it requires the marker account that exists only in
-- the test project, and it refuses if any account is not an @example.com test account.

begin;

do $$
begin
  if not exists (select 1 from auth.users where email = 'wdw-check-1792540520@example.com') then
    raise exception 'STOP: marker account not found. This is not the WhoDoesWhat TEST project. Nothing was deleted.';
  end if;
  if exists (select 1 from auth.users where email not like '%@example.com') then
    raise exception 'STOP: this project has real (non-test) accounts. Nothing was deleted.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('profiles', 'projects', 'project_members')) then
    raise exception 'STOP: teams tables still exist. Run teams-rollback.sql first. Nothing was deleted.';
  end if;
end;
$$;

-- Tasks go with their accounts (tasks.user_id ... on delete cascade). The marker account stays.
delete from auth.users where email <> 'wdw-check-1792540520@example.com';

commit;

select 'test project wiped' as result,
       (select count(*) from auth.users) as users_left,
       (select count(*) from public.tasks) as tasks_left;
