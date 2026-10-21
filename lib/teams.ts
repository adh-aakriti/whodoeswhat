// Shared by the server page and the client board (no "use client" here, so both can import it).
import type { SupabaseClient } from "@supabase/supabase-js";

export type Status = "open" | "proposed" | "accepted" | "declined" | "done";

export type Member = { id: string; name: string; role: "owner" | "member"; projectId: string };

export type ProjectInfo = {
  id: string;
  name: string;
  joinCode: string;
  isPersonal: boolean;
  role: "owner" | "member";
};

export type Task = {
  id: string;
  title: string;
  deadline: string | null;
  status: Status; // the workflow state (tasks.state), not the legacy status column
  project: string; // legacy label, e.g. "Thesis" on migrated tasks
  project_id: string;
  user_id: string; // created by
  assignee_id: string | null;
  assignee: string; // legacy free-text owner, kept as a note on migrated tasks
  accepted_by: string | null;
  accepted_at: string | null;
  declined_by: string | null;
  declined_at: string | null;
  handoff_to: string | null;
  handoff_requested_at: string | null;
  completed_at: string | null;
  created_at: string;
};

// `status:state` reads the workflow column under the name the UI uses.
export const TASK_COLUMNS =
  "id, title, deadline, status:state, project, project_id, user_id, assignee_id, assignee, accepted_by, accepted_at, declined_by, declined_at, handoff_to, handoff_requested_at, completed_at, created_at";

// RPCs return raw rows (with `state` and the legacy `status`); turn one into a Task.
export function rowToTask(row: Record<string, unknown>): Task {
  const { state, status, ...rest } = row as { state?: Status; status?: string } & Record<string, unknown>;
  return { ...(rest as Omit<Task, "status">), status: (state ?? status) as Status };
}

export function formatJoinCode(code: string) {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

// Everything /app shows, for every project the user is in.
export type Board = {
  me: { id: string; name: string; currentProjectId: string | null };
  projects: ProjectInfo[]; // personal first, then by name
  members: Member[]; // one entry per (project, member)
  tasks: Task[]; // newest first, across all the user's projects
};

// All membership rows the user may see (RLS: only projects they are in), with the project and the
// member's display name embedded. Gives both the project list and every member in one request.
const MEMBERSHIP_COLUMNS = "project_id, user_id, role, projects(id, name, join_code, is_personal), profiles(display_name)";
type MembershipRow = {
  project_id: string;
  user_id: string;
  role: Member["role"];
  projects: { id: string; name: string; join_code: string; is_personal: boolean } | null;
  profiles: { display_name: string } | null;
};

// Three requests in total, whatever the number of projects: profile, memberships, tasks.
// Returns null when the user has no profile yet (the caller then runs ensure_profile). Throws on any error.
export async function loadBoard(supabase: SupabaseClient, userId: string): Promise<Board | null> {
  const [profile, memberships, tasks] = await Promise.all([
    supabase.from("profiles").select("id, display_name, current_project_id").eq("id", userId).maybeSingle(),
    supabase.from("project_members").select(MEMBERSHIP_COLUMNS),
    supabase.from("tasks").select(TASK_COLUMNS).order("created_at", { ascending: false }),
  ]);
  const failed = profile.error ?? memberships.error ?? tasks.error;
  if (failed) throw failed;
  if (!profile.data) return null;
  const rows = (memberships.data ?? []) as unknown as MembershipRow[];
  const projects: ProjectInfo[] = rows
    .filter((r) => r.user_id === userId && r.projects)
    .map((r) => ({ id: r.projects!.id, name: r.projects!.name, joinCode: r.projects!.join_code, isPersonal: r.projects!.is_personal, role: r.role }))
    .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.name.localeCompare(b.name));
  const members: Member[] = rows.map((r) => ({ id: r.user_id, name: r.profiles?.display_name ?? "Member", role: r.role, projectId: r.project_id }));
  return {
    me: { id: userId, name: profile.data.display_name, currentProjectId: profile.data.current_project_id },
    projects,
    members,
    tasks: (tasks.data ?? []) as unknown as Task[],
  };
}

// The project new tasks go into: the saved current project if the user is still in it, else Personal.
export function currentProject(board: Board): ProjectInfo | undefined {
  return board.projects.find((p) => p.id === board.me.currentProjectId) ?? board.projects.find((p) => p.isPersonal) ?? board.projects[0];
}

export function projectLabel(p: ProjectInfo) {
  return p.isPersonal ? "Personal (only you)" : p.name;
}

