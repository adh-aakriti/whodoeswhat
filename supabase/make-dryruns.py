"""Builds the dry runs of teams-final.sql and teams-rollback.sql, and the read-only live preflight check.

Each dry run is the real script, unchanged, up to its COMMIT. Instead of committing, it checks the
result and raises an error that starts with either
    DRY RUN OK, NOTHING WAS CHANGED      (the real script would succeed and leave what it reports), or
    DRY RUN FAILED, NOTHING WAS CHANGED  (the real script would leave the database in a state we don't expect).
Either error aborts the transaction, so a dry run never changes anything.

Re-run this file whenever teams-final.sql or teams-rollback.sql changes:  python3 supabase/make-dryruns.py
"""
import re
from pathlib import Path

HERE = Path(__file__).parent

# Functions Supabase itself puts in the public schema. They are not ours: the dry runs ignore them,
# and teams-rollback.sql never drops them.
#   rls_auto_enable(): backs the event trigger behind the dashboard setting "automatically enable RLS
#   on new tables". It also runs when teams-final.sql creates projects / profiles / project_members,
#   which is harmless: the script enables RLS on them itself, and enabling it twice is a no-op.
PLATFORM_FUNCTIONS = ["rls_auto_enable"]

FINAL = (HERE / "teams-final.sql").read_text()
# The 24 functions teams-final.sql creates, read from the script so this list can never drift.
TEAMS_FUNCTIONS = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", FINAL)))
TEAMS_TABLES = sorted(set(re.findall(r"create table if not exists public\.(\w+)", FINAL)))
TEAMS_COLUMNS = re.findall(r"add column if not exists (\w+)", FINAL)
TEAMS_TRIGGERS = sorted(set(re.findall(r"create trigger (\w+)", FINAL)))
TEAMS_INDEXES = sorted(set(re.findall(r"create (?:unique )?index if not exists (\w+)", FINAL)))
TEAMS_POLICIES = sorted(set(re.findall(r'create policy "([^"]+)"', FINAL)))


def sql_array(names):
    return "array[" + ", ".join("'" + n.replace("'", "''") + "'" for n in names) + "]::text[]"


def summary(mode):
    # mode "final": exactly the teams functions (+ allowlisted platform ones) must exist afterwards.
    # mode "rollback": no function may remain in public except the allowlisted platform ones.
    expect = (
        f"""  missing := array(select unnest({sql_array(TEAMS_FUNCTIONS)}) except select unnest(present));
  unexpected := array(select unnest(present) except select unnest({sql_array(TEAMS_FUNCTIONS)}));
  if cardinality(missing) > 0 or cardinality(unexpected) > 0 then
    raise exception 'DRY RUN FAILED, NOTHING WAS CHANGED. Functions in public after the script are not exactly the % teams functions. Missing: %. Not ours (and not in the platform allowlist %): %.',
      {len(TEAMS_FUNCTIONS)}, coalesce(nullif(array_to_string(missing, ', '), ''), 'none'), platform, coalesce(nullif(array_to_string(unexpected, ', '), ''), 'none');
  end if;"""
        if mode == "final"
        else """  if cardinality(present) > 0 then
    raise exception 'DRY RUN FAILED, NOTHING WAS CHANGED. These functions would still be in public after the rollback (not in the platform allowlist %): %.',
      platform, array_to_string(present, ', ');
  end if;"""
    )
    return f"""
do $$
declare
  platform text[] := {sql_array(PLATFORM_FUNCTIONS)};  -- Supabase platform functions, see make-dryruns.py
  present text[];
  missing text[];
  unexpected text[];
  n_profiles text := 'none';
  msg text;
begin
  -- Functions in public, minus the platform allowlist.
  select coalesce(array_agg(p.proname::text order by p.proname), '{{}}') into present
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (platform);
{expect}
  -- profiles may already be gone (rollback), so only count it if it exists.
  if to_regclass('public.profiles') is not null then
    execute 'select count(*)::text from public.profiles' into n_profiles;
  end if;
  select format(
    'DRY RUN OK, NOTHING WAS CHANGED (this error is deliberate and rolls everything back). '
    'The real script would leave: %s tasks, %s users, %s profiles, teams tables: %s, teams functions: %s '
    '(platform functions ignored: %s), policies on tasks: %s, legacy checksum %s.',
    (select count(*) from public.tasks),
    (select count(*) from auth.users),
    n_profiles,
    (select coalesce(string_agg(table_name, ', ' order by table_name), 'none') from information_schema.tables
      where table_schema = 'public' and table_name = any ({sql_array(TEAMS_TABLES)})),
    cardinality(present),
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none') from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = any (platform)),
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tasks'),
    (select md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) from public.tasks)
  ) into msg;
  raise exception '%', msg;
end;
$$;

rollback;
"""


for name, mode in (("teams-final", "final"), ("teams-rollback", "rollback")):
    src = (HERE / f"{name}.sql").read_text()
    body = src.split("\nbegin;\n", 1)[1]
    body = body[: body.rindex("\ncommit;\n")]
    out = (
        f"-- DRY RUN of {name}.sql (generated by make-dryruns.py, do not edit by hand).\n"
        f"-- Runs every step of {name}.sql inside one transaction, then stops with an ERROR.\n"
        "--   'DRY RUN OK, NOTHING WAS CHANGED ...'     the real script would succeed; the message says what it would leave.\n"
        "--   'DRY RUN FAILED, NOTHING WAS CHANGED ...' the real script would leave something unexpected; read the message.\n"
        "--   any other error                           the real script would fail at that step.\n"
        "-- In every case the transaction is aborted, so nothing is changed.\n\n"
        "begin;\n" + body + "\n" + summary(mode)
    )
    (HERE / f"{name}-dryrun.sql").write_text(out)
    print(f"wrote {name}-dryrun.sql ({len(out.splitlines())} lines)")

# Read-only preflight for the LIVE project: one SELECT, changes nothing. Section 1 must return no rows
# with kind starting 'CONFLICT'; the rest is an inventory to compare with what we expect.
conflicts = "\n  union all\n".join(
    [
        f"  select 'CONFLICT: function already exists' as kind, proname::text as name from pg_proc where pronamespace = 'public'::regnamespace and proname = any ({sql_array(TEAMS_FUNCTIONS)})",
        f"  select 'CONFLICT: table already exists', relname::text from pg_class where relnamespace = 'public'::regnamespace and relname = any ({sql_array(TEAMS_TABLES)})",
        f"  select 'CONFLICT: column already on tasks', column_name::text from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = any ({sql_array(TEAMS_COLUMNS)})",
        f"  select 'CONFLICT: trigger name in use', tgname::text || ' on ' || tgrelid::regclass::text from pg_trigger where not tgisinternal and tgname = any ({sql_array(TEAMS_TRIGGERS)})",
        f"  select 'CONFLICT: index name in use', indexname::text from pg_indexes where schemaname = 'public' and indexname = any ({sql_array(TEAMS_INDEXES)})",
        f"  select 'CONFLICT: policy name in use', policyname::text || ' on ' || tablename::text from pg_policies where schemaname = 'public' and policyname = any ({sql_array(TEAMS_POLICIES)})",
        "  select 'CONFLICT: constraint name in use', conname::text from pg_constraint where conname = 'tasks_state_check'",
    ]
)
preflight = f"""-- READ-ONLY preflight for the LIVE project (generated by make-dryruns.py). One SELECT; it changes nothing.
-- Run it before anything else on live and send me the result.
--   * Any row whose kind starts with 'CONFLICT' means teams-final.sql would replace or clash with
--     something that already exists there (for example a handle_new_user() from a Supabase template),
--     and teams-rollback.sql would then drop it. Stop and tell me.
--   * The other rows are an inventory: extensions, event triggers, public functions, triggers on
--     auth.users / tasks, tables and policies in public, and the columns of tasks.

{conflicts}
  union all
  select 'extension', extname || ' ' || extversion || ' (schema ' || extnamespace::regnamespace::text || ')' from pg_extension
  union all
  select 'event trigger', evtname || ' -> ' || evtfoid::regproc::text || ' on ' || evtevent
         || coalesce(' [' || array_to_string(evttags, ', ') || ']', '') || case evtenabled when 'D' then ' (disabled)' else '' end
    from pg_event_trigger
  union all
  select 'function in public', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || case when p.proname = any ({sql_array(PLATFORM_FUNCTIONS)}) then '  [known platform function]' else '' end
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'trigger', tgname || ' on ' || tgrelid::regclass::text from pg_trigger
   where not tgisinternal and tgrelid in ('auth.users'::regclass, 'public.tasks'::regclass)
  union all
  select 'table in public', relname || case when relrowsecurity then ' (RLS on)' else ' (RLS OFF)' end
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
  union all
  select 'policy', policyname || ' on ' || tablename from pg_policies where schemaname = 'public'
  union all
  select 'tasks column', column_name || ' ' || data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks'
  union all
  select 'counts', 'tasks: ' || (select count(*) from public.tasks) || ', users: ' || (select count(*) from auth.users)
  order by 1, 2;
"""
(HERE / "live-preflight-check.sql").write_text(preflight)
print(f"wrote live-preflight-check.sql (read-only; checks {len(TEAMS_FUNCTIONS)} functions, {len(TEAMS_TABLES)} tables, "
      f"{len(TEAMS_COLUMNS)} columns, {len(TEAMS_TRIGGERS)} triggers, {len(TEAMS_INDEXES)} indexes, {len(TEAMS_POLICIES)} policies)")
