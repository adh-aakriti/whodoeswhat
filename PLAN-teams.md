# PLAN: Teams for WhoDoesWhat

Branch: `teams` · Status: **draft, waiting for approval** · No SQL has been run.

## Goal

A whole team shares one project. Everyone in it sees the same tasks. Every task is owned by a real teammate, picked from a list of display names, and that person accepts it. Version 1 (priority 1) covers projects with join codes, shared tasks, real assignees and accept/decline. Version 2 (priority 2) adds open tasks ("I'll take it") and handoffs.

## Constraints this plan is built around

| Rule | How the plan meets it |
|---|---|
| Live app on `main` keeps working on the same database | Only **new** tables, columns, functions, triggers and policies. Nothing is renamed or dropped. `main` keeps reading and writing `tasks.title/assignee/deadline/status/project` exactly as now (see "Compatibility with main"). |
| Every new user gets a profile and a personal project, with no onboarding | A trigger on `auth.users` creates both. `/app` also calls an idempotent `ensure_profile()` as a safety net. |
| Title only + `core-submit` saves into the current project and shows as `core-item` | Every other field has a server-side default (project = current project, owner = me). |
| RLS on everything, based on `auth.uid()`; nothing readable logged out | RLS is on for all 4 tables, `anon` has no grants, and every policy is `to authenticated`. |
| Membership checks don't recurse | `is_project_member()` / `is_project_owner()` are `security definer` and `set search_path = ''`. |
| No service_role key | Everything runs as the logged-in user. Privileged steps are `security definer` SQL functions that check `auth.uid()` themselves. |

---

## 1. Tables and columns

### New: `public.profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid PK, FK → `auth.users(id)` on delete cascade | one row per user |
| `display_name` | text not null, 1–60 chars | default = part of the email before `@`; user can edit it |
| `current_project_id` | uuid null, FK → `projects(id)` on delete set null | which project `/app` shows; stored in the database, not in localStorage |
| `created_at` | timestamptz default now() | |

There's no email column. Emails are never copied out of `auth.users`, so they can't leak through this table.

### New: `public.projects`
| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `name` | text not null, 1–80 chars | |
| `join_code` | text not null **unique** | 10 characters from a 31-character alphabet with no look-alikes (no 0/O, 1/I/L, U), shown as `K7QM9-2XRAP`. That's about 50 bits of randomness, generated in the database by `gen_random_bytes`. |
| `is_personal` | boolean not null default false | personal projects can't be joined |
| `created_by` | uuid not null default `auth.uid()`, FK → `auth.users` | |
| `created_at` | timestamptz default now() | |

### New: `public.project_members`
| column | type | notes |
|---|---|---|
| `project_id` | uuid FK → `projects` on delete cascade | PK (`project_id`, `user_id`) |
| `user_id` | uuid FK → `profiles(id)` on delete cascade | |
| `role` | text not null default `'member'`, check in (`owner`, `member`) | the creator is `owner` |
| `joined_at` | timestamptz default now() | |

Index on `(user_id)` for "my projects".

### Existing `public.tasks`: new columns only
| new column | type | meaning |
|---|---|---|
| `project_id` | uuid FK → `projects` on delete cascade | Backfilled, then made `not null`. A trigger fills it for inserts from `main`. |
| `assignee_id` | uuid null, FK → `profiles(id)` | The owner. `null` = open task. |
| `state` | text not null default `'proposed'`, check in (`open`, `proposed`, `accepted`, `declined`, `done`) | The new workflow. It lives alongside the legacy `status` instead of changing that column's check constraint. |
| `accepted_by`, `accepted_at` | uuid FK → profiles, timestamptz | "Accepted by Marta · 21 Oct, 14:02" |
| `declined_by`, `declined_at` | uuid FK → profiles, timestamptz | "Declined by Leo · 21 Oct" |
| `handoff_to`, `handoff_requested_at` | uuid FK → profiles, timestamptz | non-null = "Handoff pending → Leo" |
| `completed_at` | timestamptz | set when the task becomes `done` |

These existing columns are kept and untouched:
- **`user_id`:** now means "created by".
- **`assignee`:** the old free-text name, kept and shown only as a note on migrated tasks.
- **`status`:** kept in sync with `state` for `main`.
- **`project`:** a text label, kept in sync with the project name for `main`.

Index: `(project_id, created_at desc)`.

---

## 2. Helper functions (security definer, `set search_path = ''`)

| function | returns | purpose |
|---|---|---|
| `is_project_member(p uuid)` | boolean | `exists(member row for p and auth.uid())`. Used inside policies, so there's no recursion. |
| `is_project_owner(p uuid)` | boolean | same, with `role = 'owner'` |
| `is_member_of(p uuid, u uuid)` | boolean | checks that an assignee or handoff target is in the project |
| `shares_project(u uuid)` | boolean | true when `auth.uid()` and `u` are in at least one common project (for reading profiles) |
| `new_join_code()` | text | generates a random code and retries on the rare collision |

All of them have `revoke execute … from public, anon; grant execute … to authenticated`.

### RPCs: the only way to change workflow state
Each one is `security definer`, checks `auth.uid()`, locks the row (`select … for update`), checks the current state, and returns the updated task. Wrong state or not allowed → error (shown as a friendly message).

| RPC | allowed for | effect |
|---|---|---|
| `ensure_profile()` | the caller | Creates the caller's profile, personal project and membership if they're missing. Idempotent. |
| `create_project(name)` | any user | Creates a project with a new code, adds the caller as `owner`, sets it as their current project. |
| `join_project(code)` | any user | Finds a non-personal project by code and adds the caller as `member` (no-op if already a member). A wrong code gets the same generic error for every case. |
| `leave_project(p)` | members | Removes the caller's membership. Not allowed for personal projects, or for the last owner. The caller's tasks in that project become **open**. |
| `assign_task(t, member \| null)` | task creator, or a project owner, while state is `open`, `proposed` or `declined` | `member` = me → `accepted`. Another member → `proposed`. `null` → `open`. |
| `accept_task(t)` | **only** the assignee, state `proposed` | → `accepted`, sets `accepted_by/at` |
| `decline_task(t)` | **only** the assignee, state `proposed` | → `declined`, sets `declined_by/at` |
| `take_task(t)` *(v2)* | any member, state `open` | → assignee = me, `accepted`. A conditional update `where assignee_id is null` means that if two people click at once, the first one wins. |
| `complete_task(t)` / `reopen_task(t)` | assignee (or project owner) | `accepted` → `done` (sets `completed_at`) / `done` → `accepted` |
| `request_handoff(t, to)` *(v2)* | **only** the current assignee, state `accepted`, `to` is another member | sets `handoff_to/at` → "Handoff pending" |
| `respond_handoff(t, accept bool)` *(v2)* | **only** `handoff_to` | Accept → assignee = them, `accepted_by/at` = them/now, clears the handoff. Decline → clears the handoff, so the task stays with the original owner. |
| `cancel_handoff(t)` *(v2)* | the current assignee | clears the handoff |

### Triggers
- **`on_auth_user_created`** (after insert on `auth.users`) does the same as `ensure_profile()` for the new user:
  1. Creates a profile with display name = `split_part(email,'@',1)` (falling back to `member`).
  2. Creates a personal project called "Personal" (`is_personal = true`).
  3. Adds the user as its `owner` and makes it their current project.
- **`tasks_before_insert`** normalises every insert, from either app, so a client can't forge accept data:
  1. If `project_id` is null, it uses the creator's current or personal project.
  2. If `assignee_id` is null and the insert came from `main` (it has no `state`), it uses the creator.
  3. It checks that the assignee is a member of the project.
  4. It derives `state`. No assignee → `open`. Assignee = creator → `accepted` (with `accepted_by`/`accepted_at` = creator/now). Anyone else → `proposed`. A legacy `status = 'done'` → `done`.
  5. It sets the legacy `status` from `state` (open/proposed/declined → `proposed`) and the `project` text from the project name.
- **`tasks_before_update`** keeps the two apps in sync:
  - If `state` changed (an RPC did it), it derives `status` from `state`.
  - If only legacy `status` changed (`main` did it), it maps `status` to `state`. That's **only allowed when the task is assigned to its creator**, so the old status dropdown can't accept a teammate's task for them. Otherwise it raises an error.

---

## 3. RLS policies (every action, every table)

Every table has `enable row level security` and `revoke all … from anon`. "member(p)" below means `is_project_member(p)`.

### `profiles`
| action | policy |
|---|---|
| select | `id = auth.uid()` **or** `shares_project(id)`: your own row and your teammates' rows (display names only, no emails) |
| insert | none (trigger or `ensure_profile()` only) |
| update | `id = auth.uid()`, and the check also requires `current_project_id is null or member(current_project_id)`. Column grant: only `display_name` and `current_project_id`. |
| delete | none (cascades from `auth.users`) |

### `projects`
| action | policy |
|---|---|
| select | `member(id)`, so non-members can't see a project, its name or its code |
| insert | none (`create_project()` only, so the code is always generated by the server) |
| update | `is_project_owner(id)`. Column grant: `name` only. |
| delete | none in v1 |

### `project_members`
| action | policy |
|---|---|
| select | `member(project_id)`: members see who else is in the project |
| insert | none (`create_project()` / `join_project()` only) |
| update | none (role changes are out of scope) |
| delete | none (`leave_project()` only) |

### `tasks` (the 4 existing policies stay as they are; new ones are added)
The existing permissive policies let the **creator** select, insert, update and delete their own tasks. Added:

| action | new permissive | new **restrictive** (ANDed with everything) |
|---|---|---|
| select | `member(project_id)`: everyone in the project sees all its tasks | `member(project_id)`: a creator who left the project stops seeing it |
| insert | (existing `user_id = auth.uid()` is enough) | `member(project_id)`, checked after the trigger fills `project_id`. You can only add tasks to projects you're in. |
| update | none for members (workflow goes through RPCs) | `member(project_id)` |
| delete | `is_project_owner(project_id)`: project owners can tidy up | `member(project_id)` |

**Column privileges on `tasks`:** `revoke update on tasks from authenticated`, then `grant update (title, assignee, deadline, status, project) to authenticated`. Those are the legacy columns `main` uses, so `main` behaves exactly as now. Nobody can write `state`, `assignee_id`, `accepted_*`, `declined_*`, `handoff_*`, `project_id` or `completed_at` directly; only the RPCs can.
> This is the one place where existing **permissions** change. No tables or columns change. Please confirm (question 4).

---

## 4. Migration of existing data (no data loss)

The SQL goes in `supabase/teams.sql`, written for review and **not run** until you approve. It runs as one transaction:

1. Create tables, helper functions, RPCs, triggers and policies (all `if not exists` / `create or replace`).
2. Backfill one profile, one personal project and one owner membership for **every existing** `auth.users` row (`on conflict do nothing`).
3. Backfill tasks where `project_id is null`:
   - `project_id` = the creator's personal project.
   - `assignee_id` = the creator, since they were the only real person who could own it.
   - `state` = the legacy `status` (`proposed` / `accepted` / `done`). `accepted_by`/`accepted_at` = creator/`created_at` when accepted.
4. Make `tasks.project_id` `not null` (an added constraint; the insert trigger keeps `main` inserts valid).
5. Safety checks inside the transaction, which abort on mismatch:
   - The task count before and after is equal.
   - No task has a null `project_id`.
   - Every user has a profile and a personal project.
   - `title/assignee/deadline/status/project/user_id` are unchanged for every row (compared against a checksum taken first).

Nothing in the legacy columns is overwritten, so the old free-text owner ("Marta") and project label ("Thesis") stay in place. The new UI shows them as a small note on migrated tasks: "Owner noted as Marta · list: Thesis".

---

## 5. How it works in the app (branch UI)

- **Project bar** at the top of `/app`:
  - The current project's name, a switcher for your projects, **New project** and **Join with code**.
  - For team projects: **Share code** (copy) and the member list (display names).
  - Your display name is editable from a small profile menu.
- **Add task:** title (`core-input`, unchanged), **Owner** dropdown (members by display name, default "Me", plus "Nobody yet: open task" in v2) and Deadline. The free-text owner and the status picker are removed from the form, because state now comes from the workflow. Title only + `core-submit` → saved in the current project, owner = me, `accepted`, shown as `core-item`.
- **Task card actions, by state:**
  - `proposed` and you're the assignee: **Accept** / **Decline**. For others it shows "Waiting for Leo".
  - `accepted`: "Accepted by Leo · 21 Oct 14:02". The assignee gets **Mark done** and **Hand off…** (v2).
  - `declined`: "Declined by Leo", and the creator or owner gets **Reassign…**.
  - `open` (v2): **I'll take it** for every member.
  - Handoff pending: "Handoff pending → Aisha". Aisha gets **Accept handoff** / **Decline**, and the owner gets **Cancel**.
- **List grouped by owner** ("Marta · 3 tasks", "Open · 1"), since names are the point of the product. The calendar, due chips and design stay as they are.

### State machine
```
             assign(me)                       complete
  (create) ───────────────► accepted ─────────────────────► done
     │                       ▲   │  ▲                         │
     │ assign(other)  accept │   │  └──── respond_handoff ────┘ reopen
     ▼                       │   │        (accept: new owner)
  proposed ──────────────────┘   └─ request_handoff ─► [handoff pending]
     │ decline                                          │ decline / cancel
     ▼                                                  ▼
  declined ── assign(...) ──► proposed / accepted     stays accepted with old owner
  open ── take_task (any member, first wins) ──► accepted        (open = v2)
```

---

## 6. Compatibility with `main` (same database, until `teams` is merged)

- `main`'s insert `{title, assignee, deadline, status, project}` → the trigger fills `project_id`, `assignee_id` and `state`, and the task appears in the user's personal project in both apps.
- `main`'s status dropdown → allowed on tasks assigned to their creator, which covers all of `main`'s usage. It's blocked only for tasks assigned to someone else.
- `main`'s delete → the creator delete policy is unchanged.
- `main`'s list reads all visible tasks. Once a user joins a team on the branch, `main` would also list that team's tasks for them. That's harmless (still members only), but worth knowing.

---

## 7. Test plan (two real accounts)

The tests will run with **headless Chrome** for the UI, plus a **Node script using the publishable key and each user's own session** to attack RLS directly. Accounts A and B are fresh `wdw-qa-*` sign-ups.

1. **New user, no onboarding:** A signs up and lands on `/app` with project "Personal" and display name = the email prefix. Title only + `core-submit` → `core-item` with owner "Me" and "Accepted". All `data-testid`s present.
2. **Isolation:**
   - B signs up and sees none of A's tasks, projects, members or profile, both in the UI and through direct table reads (0 rows each).
   - Logged out (anon key, no session): every table returns 0 rows or permission denied, and every RPC is denied.
3. **Join:**
   - A creates "Thesis" and copies the code. B joins with the code and sees Thesis and its tasks.
   - A wrong code and a personal project's code are both rejected with the same message.
   - A's owner dropdown shows "B-name" and no emails anywhere (the page HTML is checked for `@`).
4. **Assign / accept / decline:**
   - A assigns a task to B and it shows "Waiting for B".
   - Direct RPC `accept_task` as A is rejected.
   - B accepts, and A sees "Accepted by B · ‹time›". B marks it done.
   - Second task: B declines, A sees "Declined by B" and reassigns it to A.
5. **Direct-write attacks as B:**
   - Each of these is rejected: `update tasks set state='accepted'`, `set assignee_id = B` on A's task, `set project_id` to another project, insert into a project B isn't in, insert with an assignee from outside the project, update A's profile, read another project's `join_code`.
   - Setting `status='accepted'` on a task assigned to someone else is rejected by the trigger.
6. **v2 bidding:** A creates an open task. A and B both call `take_task` at the same time → exactly one wins, and the other gets "Already taken".
7. **v2 handoff:**
   - B hands off to A → "Handoff pending → A".
   - Rejected: B responding to its own handoff, and the request when the target isn't a member.
   - A accepts → A owns it with "Accepted by A". Repeat with a decline → it stays with B.
8. **Leave:** B leaves Thesis, stops seeing its tasks, and B's accepted tasks there become open. B can't leave "Personal".
9. **Main compatibility, against the migrated database:** the `main` deployment still signs up, adds (title only), changes status and deletes. Pre-existing tasks are all still there with identical legacy fields (row checksum).
10. **Grading contract regression:** the existing suites (form, calendar, layout, visual) pass on the branch at 390 / 768 / 1100 / 1440 / 1920.

---

## 8. Questions to settle before I write the SQL

1. **Where to test:** `main` and Vercel preview deployments share one Supabase project, and the grading bot uses the live app. I recommend a **second, free Supabase project** for the `teams` branch: run `teams.sql` there first, and point Vercel's **Preview** environment variables at it. We'd only run it on the live database once the tests pass. OK?
2. **Old text projects** (e.g. "Thesis"): migrate everything into each user's "Personal" project and keep the label as a note (this plan), or turn each distinct label into its own real project?
3. **Default owner** when only a title is typed: **me** (auto-accepted, as planned) or **open**?
4. **Permissions:** OK to replace the table-wide `UPDATE` grant on `tasks` with column grants on the legacy columns, as in section 3? `main` is unaffected.
5. **Personal projects:** they stay private and can't be joined, even with their code (as planned). OK?
