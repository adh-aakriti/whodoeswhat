-- WhoDoesWhat: add a project to every task.
-- Paste into Supabase Dashboard > SQL Editor > New query, then click Run.
-- Existing tasks get 'General'. RLS policies on public.tasks are unchanged and still apply.

alter table public.tasks
  add column if not exists project text not null default 'General';
