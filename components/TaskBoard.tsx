"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { CalendarIcon, ListIcon, PlusIcon, StatusIcon, TrashIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import TaskCalendar from "@/components/TaskCalendar";
import ProjectBar from "@/components/ProjectBar";
import { toneClass } from "@/lib/projectTone";
import { todayKey } from "@/lib/dates";
import DueChip from "@/components/DueChip";
import TaskCount from "@/components/TaskCount";
import {
  TASK_COLUMNS,
  currentProject,
  loadBoard,
  projectLabel,
  rowToTask,
  type Board,
  type Status,
  type Task,
} from "@/lib/teams";

export type { Status, Task } from "@/lib/teams";

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  proposed: "Proposed",
  accepted: "Accepted",
  declined: "Declined",
  done: "Done",
};
const OPEN = "open"; // owner <select> value for "nobody yet"
const REFRESH_MS = 10_000;

type Picker = { taskId: string; kind: "assign" | "handoff"; to: string } | null;

export default function TaskBoard({ initialBoard }: { initialBoard: Board }) {
  const [supabase] = useState(() => createClient());
  const [board, setBoard] = useState<Board>(initialBoard);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string>(initialBoard.me.id);
  const [deadline, setDeadline] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null); // null = all projects
  const [view, setView] = useState<"list" | "calendar">("list");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // The user's local date, known only in the browser (the server may be in another timezone),
  // so "due in N days" chips and the calendar appear after hydration.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(todayKey());
    const id = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);

  const me = { id: board.me.id, name: board.me.name };
  const current = currentProject(board)!;
  const projectById = useMemo(() => new Map(board.projects.map((p) => [p.id, p])), [board.projects]);
  const membersOf = useCallback((projectId: string) => board.members.filter((m) => m.projectId === projectId), [board.members]);
  const nameById = useMemo(() => new Map(board.members.map((m) => [m.id, m.name])), [board.members]);
  const displayName = (id: string | null) => (id === null ? "" : id === me.id ? me.name : nameById.get(id) ?? "a former member");
  const projectName = (id: string) => {
    const p = projectById.get(id);
    return p ? (p.isPersonal ? "Personal" : p.name) : "Project";
  };
  const isOwnerOf = (projectId: string) => projectById.get(projectId)?.role === "owner";
  const toneOf = (projectId: string) => toneClass(projectName(projectId), projectById.get(projectId)?.isPersonal ?? false);

  // ---- Keeping the board fresh -------------------------------------------------------------
  // Every local change bumps `mutation`; a refresh that started before a local change is dropped,
  // so a slow background response can never briefly undo what the user just did.
  const mutation = useRef(0);
  const latestRefresh = useRef(0);
  const markChanged = () => {
    mutation.current += 1;
  };
  const refresh = useCallback(async () => {
    const startedAt = mutation.current;
    const id = ++latestRefresh.current;
    try {
      let next = await loadBoard(supabase, initialBoard.me.id);
      if (!next) {
        await supabase.rpc("ensure_profile");
        next = await loadBoard(supabase, initialBoard.me.id);
      }
      if (!next || id !== latestRefresh.current || startedAt !== mutation.current) return;
      const fresh = next;
      // Only re-render when something actually changed: no flashing, no lost input or scroll.
      setBoard((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
    } catch {
      // Background refresh failed (offline, timeout, ...): keep showing what we have.
    }
  }, [supabase, initialBoard.me.id]);

  // Every 10 s while the tab is visible; at once when it becomes visible or the window regains focus.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(refresh, REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else stop();
    };
    const onFocus = () => refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Close an open owner / handoff form if its task disappeared; keep the owner choice valid.
  useEffect(() => {
    if (picker && !board.tasks.some((t) => t.id === picker.taskId)) setPicker(null);
  }, [board.tasks, picker]);
  useEffect(() => {
    if (owner !== OPEN && owner !== me.id && !membersOf(current.id).some((m) => m.id === owner)) setOwner(me.id);
  }, [owner, me.id, current.id, membersOf]);
  useEffect(() => {
    if (filter !== null && !projectById.has(filter)) setFilter(null);
  }, [filter, projectById]);

  // ---- Actions (errors are shown only for these) --------------------------------------------
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    // The database decides the state: me -> accepted, a teammate -> proposed, nobody -> open.
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: trimmed,
        deadline: deadline || null,
        project_id: current.id,
        assignee_id: owner === OPEN ? null : owner,
        state: owner === OPEN ? "open" : "accepted",
      })
      .select(TASK_COLUMNS)
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    markChanged();
    const saved = data as unknown as Task;
    setBoard((b) => ({ ...b, tasks: [saved, ...b.tasks] }));
    // A new task always shows up as a core-item: back to the list, and to a filter that includes it.
    setView("list");
    if (filter !== null && filter !== saved.project_id) setFilter(null);
    setTitle("");
    setOwner(me.id);
    setDeadline("");
    titleRef.current?.focus();
    refresh();
  }

  // Every workflow change goes through a database function that checks who may do it.
  async function act(taskId: string, fn: string, args: Record<string, unknown> = {}) {
    setBusyTask(taskId);
    setError(null);
    const { data, error } = await supabase.rpc(fn, { p_task: taskId, ...args });
    setBusyTask(null);
    if (error) {
      setError(error.message);
      refresh();
      return;
    }
    markChanged();
    const updated = rowToTask(data as Record<string, unknown>);
    setBoard((b) => ({ ...b, tasks: b.tasks.map((t) => (t.id === taskId ? updated : t)) }));
    setPicker(null);
    refresh();
  }

  async function removeTask(id: string) {
    setError(null);
    markChanged();
    const before = board.tasks;
    setBoard((b) => ({ ...b, tasks: b.tasks.filter((t) => t.id !== id) }));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      markChanged();
      setBoard((b) => ({ ...b, tasks: before }));
      setError(error.message);
    }
    refresh();
  }

  // Switching the current project only changes where new tasks go (and whose code / members show).
  async function switchProject(projectId: string): Promise<string | null> {
    markChanged();
    setBoard((b) => ({ ...b, me: { ...b.me, currentProjectId: projectId } }));
    const { error } = await supabase.from("profiles").update({ current_project_id: projectId }).eq("id", me.id);
    if (error) {
      await refresh();
      return error.message;
    }
    refresh();
    return null;
  }

  function stateNote(t: Task) {
    if (t.handoff_to && t.status === "accepted") return `Handoff pending → ${displayName(t.handoff_to)}`;
    switch (t.status) {
      case "open":
        return "Open: anyone in the project can take it";
      case "proposed":
        return t.assignee_id === me.id ? "Proposed to you" : `Waiting for ${displayName(t.assignee_id)} to accept`;
      case "accepted":
        return `Accepted by ${displayName(t.accepted_by ?? t.assignee_id)}${t.accepted_at ? ` · ${formatWhen(t.accepted_at)}` : ""}`;
      case "declined":
        return `Declined by ${displayName(t.declined_by ?? t.assignee_id)}${t.declined_at ? ` · ${formatWhen(t.declined_at)}` : ""}`;
      case "done":
        return `Done${t.completed_at ? ` · ${formatWhen(t.completed_at)}` : ""}`;
    }
  }

  function actions(t: Task) {
    const mine = t.assignee_id === me.id;
    const owns = isOwnerOf(t.project_id);
    const others = membersOf(t.project_id).filter((m) => m.id !== me.id);
    const canAssign = (t.user_id === me.id || owns) && ["open", "proposed", "declined"].includes(t.status);
    const list: { label: string; run: () => void; primary?: boolean }[] = [];
    if (t.status === "proposed" && mine) {
      list.push({ label: "Accept", run: () => act(t.id, "accept_task"), primary: true });
      list.push({ label: "Decline", run: () => act(t.id, "decline_task") });
    }
    if (t.status === "open") list.push({ label: "I'll take it", run: () => act(t.id, "take_task"), primary: true });
    if (t.status === "accepted" && t.handoff_to === me.id) {
      list.push({ label: "Accept handoff", run: () => act(t.id, "respond_handoff", { p_accept: true }), primary: true });
      list.push({ label: "Decline handoff", run: () => act(t.id, "respond_handoff", { p_accept: false }) });
    }
    if (t.status === "accepted" && mine && !t.handoff_to) {
      list.push({ label: "Mark done", run: () => act(t.id, "complete_task"), primary: true });
      if (others.length) list.push({ label: "Hand off…", run: () => setPicker({ taskId: t.id, kind: "handoff", to: "" }) });
    }
    if (t.status === "accepted" && mine && t.handoff_to) list.push({ label: "Cancel handoff", run: () => act(t.id, "cancel_handoff") });
    if (t.status === "done" && (mine || owns)) list.push({ label: "Reopen", run: () => act(t.id, "reopen_task") });
    if (canAssign) list.push({ label: t.status === "open" ? "Assign…" : "Reassign…", run: () => setPicker({ taskId: t.id, kind: "assign", to: "" }) });
    return list;
  }

  // ---- What to show ---------------------------------------------------------------------------
  const shownProjects = board.projects.filter((p) => filter === null || p.id === filter);
  const groups = shownProjects
    .map((p) => ({ project: p, items: board.tasks.filter((t) => t.project_id === p.id), memberCount: membersOf(p.id).length }))
    .filter((g) => g.items.length > 0);
  const shownTasks = filter === null ? board.tasks : board.tasks.filter((t) => t.project_id === filter);
  const calendarTasks = shownTasks.map((t) => ({
    ...t,
    assignee: t.assignee_id ? displayName(t.assignee_id) : "Nobody yet",
    project: projectName(t.project_id), // the project's colour and name on each calendar entry
  }));
  const currentMembers = membersOf(current.id);
  const currentOthers = currentMembers.filter((m) => m.id !== me.id);

  return (
    <>
      <ProjectBar
        supabase={supabase}
        me={me}
        current={current}
        projects={board.projects}
        members={currentMembers}
        onSwitch={switchProject}
        onChanged={async () => {
          markChanged();
          await refresh();
        }}
      />
      {/* One grid, each part rendered once. Below 1100px it is a single column and the List / Calendar
          toggle picks what shows; from 1100px the list and the calendar sit side by side (see .board CSS). */}
      <div className="board" data-view={view}>
        <form className="task-form board-form" onSubmit={addTask}>
          <p className="adding-to" id="adding-to">
            Adding to: <strong>{projectLabel(current)}</strong>
          </p>
          {/* Only the title is required; owner defaults to me (accepted at once), deadline to none. */}
          <div className="field">
            {/* The visible cue is the placeholder; this label keeps a real accessible name for screen readers. */}
            <label htmlFor="task-title" className="visually-hidden">Add a new task</label>
            <div className="title-wrap">
              <PlusIcon size={20} className="title-plus" />
              <input
                id="task-title"
                ref={titleRef}
                className="input-title"
                type="text"
                placeholder="Add a new task"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                aria-describedby="adding-to"
                data-testid="core-input"
              />
            </div>
          </div>
          <div className="task-fields task-fields-team">
            <div className="field">
              <label htmlFor="task-assignee">Owner</label>
              <select id="task-assignee" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value={me.id}>Me ({me.name})</option>
                {currentOthers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} (asks them to accept)</option>
                ))}
                <option value={OPEN}>Nobody yet: open task</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-deadline">Deadline <span className="muted">(optional)</span></label>
              <input id="task-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary task-submit" disabled={saving} data-testid="core-submit">
              <PlusIcon size={18} />
              {saving ? "Adding…" : "Add task"}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>

        <div className="board-head">
          <div className="list-head">
            <h1>Your tasks</h1>
            <div className="list-controls">
              <div className="view-toggle" role="group" aria-label="View">
                <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  <ListIcon />
                  List
                </button>
                <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
                  <CalendarIcon />
                  Calendar
                </button>
              </div>
              {board.projects.length > 1 && (
                <div className="field filter">
                  <label htmlFor="project-filter">Show</label>
                  <select id="project-filter" value={filter ?? ""} onChange={(e) => setFilter(e.target.value || null)}>
                    <option value="">All projects</option>
                    {board.projects.map((p) => (
                      <option key={p.id} value={p.id}>{projectLabel(p)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="board-list">
          {shownTasks.length === 0 ? (
            <p className="muted empty">
              {filter === null
                ? "Nothing on the sheet yet. Add the first task above and put a name on it."
                : `No tasks in ${projectName(filter)} yet.`}
            </p>
          ) : (
            groups.map((g, i) => (
              <section key={g.project.id} className="project-group" aria-labelledby={`project-group-${i}`}>
                <h2 id={`project-group-${i}`} className="project-heading">
                  <span className="project-name">
                    <span className={`project-dot ${toneOf(g.project.id)}`} aria-hidden="true" />
                    {projectName(g.project.id)}
                  </span>
                  <span className="project-count">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"} · <TaskCount n={g.items.length} />
                  </span>
                </h2>
                <ul className="sheet sheet-app">
                  {g.items.map((t) => {
                    const legacyNote = [
                      t.assignee ? `Owner noted as ${t.assignee}` : "",
                      g.project.isPersonal && t.project && t.project !== "General" ? `List: ${t.project}` : "",
                    ].filter(Boolean).join(" · ");
                    const pickerHere = picker?.taskId === t.id ? picker : null;
                    const projectMembers = membersOf(t.project_id);
                    const choices = pickerHere?.kind === "handoff" ? projectMembers.filter((m) => m.id !== me.id) : projectMembers;
                    return (
                      <li
                        key={t.id}
                        className={`sheet-row status-${t.status} ${toneOf(t.project_id)}${t.handoff_to && t.status === "accepted" ? " has-handoff" : ""}`}
                        data-testid="core-item"
                      >
                        <span className="cell-title">
                          {t.title}
                          <span className="title-meta">
                            <span className="state-note">{stateNote(t)}</span>
                            <DueChip deadline={t.deadline} status={t.status} today={today} />
                          </span>
                          {legacyNote && <span className="legacy-note">{legacyNote}</span>}
                        </span>
                        <span className={`cell-owner${t.assignee_id ? "" : " muted"}`}>
                          <span className="cell-label">Owner </span>
                          {t.assignee_id && <Avatar name={displayName(t.assignee_id)} />}
                          {t.assignee_id ? displayName(t.assignee_id) : "Nobody yet"}
                        </span>
                        <span className={`cell-due${t.deadline ? "" : " muted"}`}>
                          <span className="cell-label">Due </span>
                          {t.deadline ? formatDate(t.deadline) : "No date"}
                        </span>
                        <span className="cell-status">
                          <StatusIcon status={t.handoff_to && t.status === "accepted" ? "handoff" : t.status} />
                          {t.handoff_to && t.status === "accepted" ? "Handoff pending" : STATUS_LABELS[t.status]}
                        </span>
                        <span className="cell-actions">
                          {actions(t).map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              className={a.primary ? "btn btn-small" : "text-button"}
                              disabled={busyTask === t.id}
                              onClick={a.run}
                            >
                              {a.label}
                            </button>
                          ))}
                          {(t.user_id === me.id || isOwnerOf(t.project_id)) && (
                            <button
                              type="button"
                              className="text-button quiet"
                              onClick={() => removeTask(t.id)}
                              aria-label={`Delete ${t.title}`}
                            >
                              <TrashIcon />
                              Delete
                            </button>
                          )}
                        </span>
                        {pickerHere && (
                          <form
                            className="task-picker"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (pickerHere.kind === "handoff") {
                                if (pickerHere.to) act(t.id, "request_handoff", { p_to: pickerHere.to });
                              } else {
                                act(t.id, "assign_task", { p_assignee: pickerHere.to === OPEN || pickerHere.to === "" ? null : pickerHere.to });
                              }
                            }}
                          >
                            <label htmlFor={`picker-${t.id}`}>{pickerHere.kind === "handoff" ? "Hand off to" : "New owner"}</label>
                            <select
                              id={`picker-${t.id}`}
                              value={pickerHere.to}
                              onChange={(e) => setPicker({ ...pickerHere, to: e.target.value })}
                            >
                              <option value="" disabled={pickerHere.kind === "handoff"}>
                                {pickerHere.kind === "handoff" ? "Choose a teammate" : "Nobody yet: open task"}
                              </option>
                              {choices.map((m) => (
                                <option key={m.id} value={m.id}>{m.id === me.id ? `Me (${me.name})` : m.name}</option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn-small" disabled={busyTask === t.id || (pickerHere.kind === "handoff" && !pickerHere.to)}>
                              {pickerHere.kind === "handoff" ? "Ask them" : "Save"}
                            </button>
                            <button type="button" className="text-button" onClick={() => setPicker(null)}>Cancel</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        {/* Client-only (needs the user's local "today"). Calendar rows never carry core-item. */}
        {today && (
          <div className="board-calendar">
            <TaskCalendar tasks={calendarTasks} statusLabels={STATUS_LABELS} onShowList={() => setView("list")} toneFor={(t) => toneOf(t.project_id)} />
          </div>
        )}
      </div>
    </>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

// "21 Oct, 14:02" in the viewer's own timezone.
function formatWhen(ts: string) {
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
