// Shared by the server page and the client board (no "use client" here, so both can import it).

export type Status = "open" | "proposed" | "accepted" | "declined" | "done";

export type Member = { id: string; name: string; role: "owner" | "member" };

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
