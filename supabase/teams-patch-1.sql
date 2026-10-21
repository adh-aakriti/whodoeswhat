-- WhoDoesWhat teams, patch 1. TEST project only, after teams.sql. teams.sql already contains both fixes.
-- 1. take_task: "Someone else already took this task" used error code 40001, which PostgREST retries
--    until it times out (504 after ~1 minute). Now P0001, so the loser gets the message at once.
-- 2. tasks_before_insert: a live-app insert without project_id now always goes to the creator's
--    personal project, never to their current team project.
-- Paste into the TEST project's SQL Editor > New query > Run.

begin;

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

revoke all on function public.take_task(uuid) from public, anon;
grant execute on function public.take_task(uuid) to authenticated;

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

commit;
