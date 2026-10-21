# Merge plan: `teams` → `main` (and the live database)

Status: **draft, nothing done on live yet.** Live project: `zntavouzsnwfgowflmma`. Test project: `wctuhfwsursabdagnzns` (`whodoeswhat-teams-test`).

Files on the `teams` branch, in `supabase/`:

| File | What it is | Changes anything? |
|---|---|---|
| `live-preflight-check.sql` | One read-only SELECT: name conflicts, extensions, event triggers, functions, triggers, tables, policies, counts | No |
| `teams-final-dryrun.sql` | Every step of the migration, then a deliberate error (`DRY RUN OK …` or `DRY RUN FAILED …`) | No, the transaction is always aborted |
| `teams-final.sql` | The migration: one transaction; aborts by itself if task count, user count or any old field would change | Yes |
| `teams-rollback-dryrun.sql` | Every step of the rollback, then a deliberate error, as above | No |
| `teams-rollback.sql` | The undo: back to the old schema, keeping every task row and old column | Yes (removes team data) |
| `make-dryruns.py` | Regenerates the two dry runs and the preflight from the real scripts | No (it only writes files) |
| `test-only-wipe.sql` | **Test project only.** Refuses to run anywhere else | Yes |

---

## 1. Preflight (done)

Ran `live-preflight-check.sql` on live (read-only). Result: no `CONFLICT` rows. Counts: 15 tasks, 26 users. Only `rls_auto_enable()` is in `public` (a known Supabase platform function, allowlisted). `tasks` has RLS on, the 4 original policies and the 8 original columns. No triggers on `tasks` or `auth.users`. `pgcrypto` is in schema `extensions`.

If anything changes on live before the migration (new extensions, templates, functions), run the preflight again.

---

## 2. Backup of the live project

### What the Free plan can and can't do

- **There's no restorable automatic backup on the Free plan.** Scheduled daily backups and point-in-time recovery are paid features. Check **Database → Backups** in the live project's dashboard: on Free it says backups aren't included. Don't count on Supabase to restore anything for you.
- **So the backup is a manual copy you make and keep yourself.** It's a snapshot of the moment you take it. Anything written to live afterwards (for example by the grading bot) isn't in it.
- **A database dump doesn't include project settings.** Auth settings (Confirm email off, Site URL, redirect URLs), API keys, rate limits and the Vercel environment variables aren't in it. Write them down or take screenshots (step 2.4).
- **Restoring `auth.users` from a dump is possible but awkward.** That schema is managed by Supabase. Neither `teams-final.sql` nor `teams-rollback.sql` modifies or deletes any `auth.users` row. They only add a trigger and read emails for display names. The user backup is a safety net for a disaster, not part of the normal undo.
- **The dump contains personal data:** email addresses and password hashes of all 26 accounts. Store it outside the repository and outside any synced or shared folder. Never commit it or paste it anywhere. Delete it once the migration has been stable for a while.

### 2.1 Record the numbers (read-only, SQL Editor on live)

```sql
select (select count(*) from public.tasks) as tasks,
       (select count(*) from auth.users) as users,
       md5(coalesce(string_agg(concat_ws('|', id, user_id, title, assignee, deadline, status, project, created_at), ',' order by id), '')) as legacy_checksum
  from public.tasks;
```

Write down all three values. `teams-final.sql` ends with a summary row containing the same three values, and they must match. `teams-rollback.sql` prints them too.

### 2.2 Quick copy of the tasks (no password needed)

Go to **Table Editor → `tasks` → Export → Export table as CSV**. Check that the file has 15 data rows.

### 2.3 Full logical dump (needs the database password; run it yourself, in your own Terminal window)

Don't run these with `!` in this chat, because that would put the connection string and password into the conversation. Use a separate Terminal window.

1. Install the Postgres client tools once: `brew install libpq`, then `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.
2. In the live project, open **Connect → Session pooler** and copy the URI. It looks like `postgresql://postgres.zntavouzsnwfgowflmma:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`. Leave `[YOUR-PASSWORD]` out of it.
3. Then run:
   ```sh
   mkdir -p ~/WhoDoesWhat-backups/$(date +%Y%m%d-%H%M) && cd "$_"
   read -s PGPASSWORD && export PGPASSWORD   # type the database password; it isn't shown or saved in history
   DB="postgresql://postgres.zntavouzsnwfgowflmma@aws-…pooler.supabase.com:5432/postgres"   # the URI without the password
   pg_dump "$DB" --schema=public --schema-only -f public-schema.sql
   pg_dump "$DB" --schema=public --data-only   -f public-data.sql
   pg_dump "$DB" --table=auth.users --data-only -f auth-users.sql
   unset PGPASSWORD
   grep -c . public-schema.sql public-data.sql auth-users.sql   # all three must be non-empty
   ```
4. Check the dump: `public-data.sql` must contain a `COPY public.tasks` block with 15 lines before its closing `\.`.

### 2.4 Settings that aren't in any dump

Take screenshots of: **Authentication → Sign In / Providers → Email** (Confirm email off), **Authentication → URL Configuration**, and the Vercel project's **Settings → Environment Variables** (names only).

---

## 3. Order of operations

1. **Backup:** steps 2.1–2.4, and write down the three numbers.
2. **Dry run on live:** run `teams-final-dryrun.sql` in the live SQL Editor. Expect `DRY RUN OK, NOTHING WAS CHANGED … 15 tasks, 26 users, 26 profiles … teams functions: 24 (platform functions ignored: rls_auto_enable) … legacy checksum <same as 2.1>`. Any `DRY RUN FAILED` or other error: stop and send it to me. Nothing has changed.
3. **Run `teams-final.sql` on live.** The summary row must read `teams-final: migration committed` with **tasks = 15, users = 26, profiles = 26, personal_projects = 26, tasks_missing_project_or_state = 0**, and `legacy_checksum` equal to the value from 2.1.
4. **Switch `.env.local` to live:** comment out the two test lines and uncomment the two live ones (`zntavouzsnwfgowflmma`). Leave `VERCEL_OIDC_TOKEN` as it is.
5. **Test locally against live**, using the `teams` code with `npm run build && npm start`:
   - A brand-new account: sign up, type only a title in `core-input`, click `core-submit`. It must appear as `core-item`, owner = you, Accepted.
   - Two new accounts: one creates a project, the other joins with the code. Assign a task, accept it, check "Accepted by … · time", and confirm neither page shows any email.
   - The old app still works (already covered by the window test, section 4).
6. **Merge:** `git checkout main && git merge --no-ff teams && git push origin main`. This is the only push to `main`.
7. **Vercel redeploys `main`** automatically. Wait for **Ready**, then repeat the brand-new-account title-only check on the production URL.

Don't push the `teams` branch before step 3. Vercel builds a Preview deployment for every pushed branch, and Preview uses the live database, which wouldn't have the teams tables yet.

---

## 4. The window between running the SQL and the deploy finishing

From step 3 until step 7 finishes, live runs the **old `main` code on the migrated database**. What happens:

- **While `teams-final.sql` runs** (a few seconds): it locks `tasks` to add columns, so the old app's requests wait briefly, then carry on. If the script fails, it rolls back and the old app never notices.
- **After it commits, the old app keeps working:**
  - New tasks land in the user's private personal project.
  - The status dropdown works on your own tasks.
  - Sign-up creates the profile and personal project automatically.
  - Delete works.
- **Tested:** see the results in section 7, including the heartbeat that ran the old app's exact requests every second while the migration ran.

---

## 5. Rollback plan

| What happened | What to do |
|---|---|
| `teams-final.sql` (or its dry run) **fails** | Nothing changed: it's one transaction. The old app keeps working. Re-run the numbers query from 2.1 to confirm, then send me the error. |
| SQL succeeded, **deploy fails or the new app misbehaves** | **Don't touch the database.** The old app works on the migrated database. In Vercel → Deployments, open the last good production deployment (from `f5edd37`) → **Instant Rollback** / **Promote to Production**. Then `git revert -m 1 <merge commit>` on `main` when convenient, and push. |
| SQL succeeded, but you decide to go back to the single-user app for good | Run `teams-rollback-dryrun.sql` (expect `DRY RUN OK`, `teams functions: 0`), then `teams-rollback.sql`. Its summary row must match the 2.1 numbers, apart from tasks created since. This permanently deletes projects, members and display names; every task row stays. Make sure the deployed code is the old `main` first. |
| Data was lost in a way none of the above explains | Restore from the dumps in 2.3. Ask me first: restoring into a live Supabase project needs care, especially `auth.users`. |

---

## 6. Copy that still describes a single-user list

To update before submitting. Suggested wording is in *italics*.

| Where | Current text | Why it's out of date |
|---|---|---|
| `app/page.tsx`, "How it works" | "Write each task down, put one name and a date next to it, and move it from proposed to accepted to done as the work happens." | No team, no join code, no accepting. *"Start a project and share its join code. Add each task, pick the teammate who owns it, and they accept or decline it. Anyone can grab an open task, and you can hand one off."* |
| `app/page.tsx`, example sheet | 4 rows, only proposed / accepted / done | Could show the team flow: *"Waiting for Jonas to accept"*, *"Open, needs an owner"*, *"Accepted by Marta · 14 Nov"* |
| `app/page.tsx`, sheet caption | "Marketing 301 · Final project" | Fine. Could add *"4 people"* or the join-code idea. |
| `app/layout.tsx`, meta description | "…split work into tasks with owners and deadlines so everyone knows what's next." | Still accurate. Could add *"shared with the whole team, and owners accept their tasks."* |
| `components/AuthForm.tsx`, sign-up intro | "An email and a password is all it takes." | Fine. Could add *"Then start a project or join one with a code."* |
| `components/AuthForm.tsx`, log-in intro | "Welcome back. Your task sheet is where you left it." | *"…your team's sheet…"* |
| `components/TaskBoard.tsx`, list heading | "Your tasks" | It now shows the whole project's tasks: *"Team tasks"*, or the project name. |
| `components/TaskBoard.tsx`, empty state | "Nothing on the sheet yet. Add the first task above and put a name on it." | Fine for a team. Could add *"…or share the join code so teammates can add theirs."* |

Unchanged headline, tagline and "For university project teams" still fit the team version. Changing visible copy doesn't touch any `data-testid`.

---

## 7. Test results

All on the **test** project (`wctuhfwsursabdagnzns`) or a local in-memory Postgres (PGlite). Nothing on live.

### 7.1 Scripts on a local copy of Postgres (PGlite), with Supabase-like roles, `auth.users`, `pgcrypto` and an equivalent of the `rls_auto_enable` event trigger

| Check | Result |
|---|---|
| Final dry run, real final, rollback dry run, real rollback, final again, rollback again (on a fresh old schema with old-style data) | 14 / 14 pass |
| Same with the automatic-RLS event trigger active; the trigger really fires for the 3 new tables; dry runs fail loudly on an unknown function; preflight flags conflicts on a migrated database | 14 / 14 pass |
| `teams-final.sql` creates every object before its first use (static check) | Pass |

### 7.2 On the test project: rollback, then wipe, then re-seed through the old app, then final

| Step | Result |
|---|---|
| `teams-rollback.sql` | Committed: 44 tasks, 14 users, checksum `61bd476a…`; only `rls_auto_enable()` left in `public` |
| Rollback checks (tables, columns, functions gone; A's and B's rows identical; logged out gets nothing; old app logs in, adds, edits, deletes) | 12 / 12 pass |
| `test-only-wipe.sql` | 1 user (marker) and 0 tasks left |
| Re-seeded through the old `main` app | 2 accounts, 6 tasks (free-text owners, labels, every status) |
| `teams-final-dryrun.sql`, then `teams-final.sql` | Committed: tasks 6, users 3, profiles 3, personal projects 3, missing 0, checksum `72e20a5d…` identical to the dry run |

### 7.3 The old app during the migration (heartbeat: list, add, status change, delete about once a second, 01:45:46–01:54:26 UTC)

| Measure | Result |
|---|---|
| Requests | 1,140 (285 cycles) |
| Status other than 200 / 201 / 204 | **0** |
| Cycles that didn't finish all 4 steps | 0 |
| Median request time | 60 ms |
| Longest wait | **204 s**: one "add", from about 01:50:32 to 01:53:56 UTC, then 201 |
| Second longest | 12.5 s: one "delete", from about 01:50:02 to 01:50:14 UTC, then 204 |
| After 01:54 | All normal again (21 cycles); old-app tasks went through the new trigger correctly |

**Open issue: must be fixed before live.** Nothing failed, but one old-app request waited 3 min 24 s. The most likely cause is the order in which the script takes locks: it takes the strongest lock on `tasks` in section 1, but only asks for the lock on `auth.users` (for the sign-up trigger) in section 7. If that second lock has to wait, everyone using `tasks` waits too. The fix is to take both locks at the very start, `auth.users` first, with a short `lock_timeout`, so the script either gets them within seconds or stops and changes nothing. Then repeat 7.2 and 7.3 on the test project.

### 7.4 The three suites, on the migrated test project

| Suite | Area | Passed | Failed |
|---|---|---|---|
| API checks | Migration (old data kept, field by field) | 12 | 0 |
| | Sign-up trigger, profiles, personal project | 5 | 0 |
| | Isolation (new user, logged-out visitors, internal functions) | 21 | 0 |
| | Join codes | 7 | 0 |
| | Profiles (teammates only, no email) | 6 | 0 |
| | Assign / accept / decline | 12 | 0 |
| | Direct writes to `state` / `assignee_id` / `project_id` / … | 19 | 0 |
| | Bidding: one winner per race; loser told within 5 s | 8 | 0 |
| | Privacy: an old-app insert stays in the personal project | 1 | 0 |
| | Handoff | 7 | 0 |
| | Leaving a project | 6 | 0 |
| Live app (`main`) | Login, add, edit own status, delete, new sign-up (with the current project set to a team) | 16 | 0 |
| Two-account UI (`teams`) | Join, assign, accept, decline, take, hand off, done, calendar, layout, contract | 43 | 0 |
| **Total** | | **163** | **0** |
