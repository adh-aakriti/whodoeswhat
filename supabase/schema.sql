-- WhoDoesWhat: tasks table with Row Level Security.
-- Paste into Supabase Dashboard > SQL Editor > New query, then click Run.

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  assignee    text not null default '' check (char_length(assignee) <= 100),
  deadline    date,
  status      text not null default 'proposed' check (status in ('proposed', 'accepted', 'done')),
  created_at  timestamptz not null default now()
);

create index if not exists tasks_user_id_created_at_idx on public.tasks (user_id, created_at desc);

alter table public.tasks enable row level security;

-- Only logged-in users get table access; anonymous visitors get nothing.
revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;

drop policy if exists "Users can read their own tasks" on public.tasks;
create policy "Users can read their own tasks"
  on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tasks" on public.tasks;
create policy "Users can create their own tasks"
  on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tasks" on public.tasks;
create policy "Users can update their own tasks"
  on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can delete their own tasks"
  on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id);
