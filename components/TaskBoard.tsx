"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { CalendarIcon, ListIcon, PlusIcon, StatusIcon, TrashIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import TaskCalendar from "@/components/TaskCalendar";
import ProjectBar from "@/components/ProjectBar";
import { projectTone } from "@/lib/projectTone";
import { todayKey } from "@/lib/dates";
import DueChip from "@/components/DueChip";
import TaskCount from "@/components/TaskCount";
import { TASK_COLUMNS, rowToTask, type Member, type ProjectInfo, type Status, type Task } from "@/lib/teams";

export type { Status, Task } from "@/lib/teams";

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  proposed: "Proposed",
  accepted: "Accepted",
  declined: "Declined",
  done: "Done",
};
const OPEN = "open"; // owner <select> value for "nobody yet"

type Picker = { taskId: string; kind: "assign" | "handoff"; to: string } | null;

export default function TaskBoard({
  me,
  project,
  projects,
  initialMembers,
  initialTasks,
}: {
  me: { id: string; name: string };
  project: ProjectInfo;
  projects: ProjectInfo[];
  initialMembers: Member[];
  initialTasks: Task[];
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string>(me.id);
  const [deadline, setDeadline] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The user's local date, known only in the browser (the server may be in another timezone),
  // so "due in N days" chips and the calendar appear after hydration.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(todayKey());
    const id = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const isOwnerOfProject = project.role === "owner";
  const nameOf = useCallback(
    (id: string | null) => (id === null ? null : id === me.id ? "you" : members.find((m) => m.id === id)?.name ?? "a former member"),
    [members, me.id],
  );
  const displayName = (id: string | null) => (id === me.id ? me.name : nameOf(id) ?? "");
  const others = members.filter((m) => m.id !== me.id);

  // Teammates change things too: pick up their changes when the tab comes back into view.
  const reload = useCallback(async () => {
    const [{ data: taskRows }, { data: memberRows }] = await Promise.all([
      supabase.from("tasks").select(TASK_COLUMNS).eq("project_id", project.id).order("created_at", { ascending: false }),
      supabase.from("project_members").select("user_id, role, profiles(display_name)").eq("project_id", project.id),
    ]);
    if (taskRows) setTasks(taskRows as unknown as Task[]);
    if (memberRows)
      setMembers(
        (memberRows as unknown as { user_id: string; role: Member["role"]; profiles: { display_name: string } | null }[]).map((m) => ({
          id: m.user_id,
          name: m.profiles?.display_name ?? "Member",
          role: m.role,
        })),
      );
  }, [supabase, project.id]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  // Grouped by owner, because names are the point: open tasks first, then me, then teammates.
  const groups = useMemo(() => {
    const byOwner = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.assignee_id ?? OPEN;
      const list = byOwner.get(key);
      if (list) list.push(t);
      else byOwner.set(key, [t]);
    }
    const order = [OPEN, me.id, ...others.map((m) => m.id)];
    return [...byOwner.entries()]
      .sort(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1))
      .map(([key, items]) => ({ key, name: key === OPEN ? "Open, needs an owner" : displayName(key), items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, members, me.id]);

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
        project_id: project.id,
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
    setTasks((prev) => [data as unknown as Task, ...prev]);
    // A new task always shows up as a core-item, so go back to the list.
    setView("list");
    setTitle("");
    setOwner(me.id);
    setDeadline("");
    titleRef.current?.focus();
  }

  // Every workflow change goes through a database function that checks who may do it.
  async function act(taskId: string, fn: string, args: Record<string, unknown> = {}) {
    setBusyTask(taskId);
    setError(null);
    const { data, error } = await supabase.rpc(fn, { p_task: taskId, ...args });
    setBusyTask(null);
    if (error) {
      setError(error.message);
      reload();
      return;
    }
    const updated = rowToTask(data as Record<string, unknown>);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
    setPicker(null);
  }

  async function removeTask(id: string) {
    const before = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      setTasks(before);
      setError(error.message);
    }
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
    const canAssign = (t.user_id === me.id || isOwnerOfProject) && ["open", "proposed", "declined"].includes(t.status);
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
    if (t.status === "done" && (mine || isOwnerOfProject)) list.push({ label: "Reopen", run: () => act(t.id, "reopen_task") });
    if (canAssign) list.push({ label: t.status === "open" ? "Assign…" : "Reassign…", run: () => setPicker({ taskId: t.id, kind: "assign", to: "" }) });
    return list;
  }

  const calendarTasks = useMemo(
    () => tasks.map((t) => ({ ...t, assignee: t.assignee_id ? displayName(t.assignee_id) : "Nobody yet" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, members],
  );

  return (
    <>
      <ProjectBar me={me} project={project} projects={projects} members={members} />
      {/* One grid, each part rendered once. Below 1100px it is a single column and the List / Calendar
          toggle picks what shows; from 1100px the list and the calendar sit side by side (see .board CSS). */}
      <div className="board" data-view={view}>
        <form className="task-form board-form" onSubmit={addTask}>
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
                data-testid="core-input"
              />
            </div>
          </div>
          <div className="task-fields task-fields-team">
            <div className="field">
              <label htmlFor="task-assignee">Owner</label>
              <select id="task-assignee" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value={me.id}>Me ({me.name})</option>
                {others.map((m) => (
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
            </div>
          </div>
        </div>
        <div className="board-list">
          {tasks.length === 0 ? (
            <p className="muted empty">Nothing on the sheet yet. Add the first task above and put a name on it.</p>
          ) : (
            groups.map((g, i) => (
              <section key={g.key} className="project-group" aria-labelledby={`owner-group-${i}`}>
                <h2 id={`owner-group-${i}`} className="project-heading">
                  <span className="project-name">
                    {g.key === OPEN ? <span className="project-dot open-dot" aria-hidden="true" /> : <Avatar name={g.name} />}
                    {g.key === me.id ? `${me.name} (you)` : g.name}
                  </span>
                  <span className="project-count">
                    <TaskCount n={g.items.length} />
                  </span>
                </h2>
                <ul className="sheet sheet-app">
                  {g.items.map((t) => {
                    const legacyNote = [
                      t.assignee ? `Owner noted as ${t.assignee}` : "",
                      project.isPersonal && t.project && t.project !== "General" ? `List: ${t.project}` : "",
                    ].filter(Boolean).join(" · ");
                    const pickerHere = picker?.taskId === t.id ? picker : null;
                    const choices = pickerHere?.kind === "handoff" ? others : members;
                    return (
                      <li
                        key={t.id}
                        className={`sheet-row status-${t.status} tone-${projectTone(t.project)}${t.handoff_to ? " has-handoff" : ""}`}
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
                          <StatusIcon status={t.status} />
                          {STATUS_LABELS[t.status]}
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
                          {(t.user_id === me.id || isOwnerOfProject) && (
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
            <TaskCalendar tasks={calendarTasks} statusLabels={STATUS_LABELS} onShowList={() => setView("list")} />
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
