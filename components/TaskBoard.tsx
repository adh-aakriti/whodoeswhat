"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { CalendarIcon, ListIcon, PlusIcon, StatusIcon, TrashIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import TaskCalendar from "@/components/TaskCalendar";
import { projectTone } from "@/lib/projectTone";
import { todayKey } from "@/lib/dates";
import DueChip from "@/components/DueChip";
import TaskCount from "@/components/TaskCount";

export type Status = "proposed" | "accepted" | "done";

export type Task = {
  id: string;
  title: string;
  assignee: string;
  deadline: string | null;
  status: Status;
  project: string;
  created_at: string;
};

const STATUSES: Status[] = ["proposed", "accepted", "done"];
const STATUS_LABELS: Record<Status, string> = { proposed: "Proposed", accepted: "Accepted", done: "Done" };
const COLUMNS = "id, title, assignee, deadline, status, project, created_at";
const DEFAULT_PROJECT = "General";

export default function TaskBoard({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<Status>("proposed");
  // Kept after each add so several tasks can go into the same project quickly.
  const [project, setProject] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  // The user's local date, known only in the browser (the server may be in another timezone),
  // so "due in N days" chips appear after hydration.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(todayKey());
    const id = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  // null = "All projects".
  const [filter, setFilter] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  // Groups in order of their newest task, so a just-added task's project is on top.
  const groups = useMemo(() => {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const list = byProject.get(t.project);
      if (list) list.push(t);
      else byProject.set(t.project, [t]);
    }
    return [...byProject.entries()].map(([name, items]) => ({ name, items }));
  }, [tasks]);
  const projectNames = useMemo(() => groups.map((g) => g.name).sort((a, b) => a.localeCompare(b)), [groups]);
  const activeFilter = filter !== null && projectNames.includes(filter) ? filter : null;
  const visibleGroups = activeFilter === null ? groups : groups.filter((g) => g.name === activeFilter);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: trimmed,
        assignee: assignee.trim(),
        deadline: deadline || null,
        status,
        project: project.trim() || DEFAULT_PROJECT,
      })
      .select(COLUMNS)
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    const saved = data as Task;
    setTasks((prev) => [saved, ...prev]);
    if (activeFilter !== null && activeFilter !== saved.project) setFilter(null);
    // A new task always shows up as a core-item, so go back to the list.
    setView("list");
    setTitle("");
    setAssignee("");
    setDeadline("");
    setStatus("proposed");
    titleRef.current?.focus();
  }

  async function changeStatus(id: string, next: Status) {
    const before = tasks;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: next } : t)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", id);
    if (error) {
      setTasks(before);
      setError(error.message);
    }
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

  return (
    // One grid, each part rendered once. Below 1100px it is a single column and the List / Calendar
    // toggle picks what shows; from 1100px the list and the calendar sit side by side (see .board CSS).
    <div className="board" data-view={view}>
      <form className="task-form board-form" onSubmit={addTask}>
        {/* Every field is always visible. Only the title is required; the others keep valid defaults. */}
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
        <div className="task-fields">
          <div className="field">
            <label htmlFor="task-project">Project <span className="muted">(optional)</span></label>
            <input
              id="task-project"
              type="text"
              list="project-options"
              placeholder={DEFAULT_PROJECT}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
            <datalist id="project-options">
              {projectNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="task-assignee">Owner <span className="muted">(optional)</span></label>
            <input
              id="task-assignee"
              type="text"
              placeholder="Who owns it?"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="task-deadline">Deadline <span className="muted">(optional)</span></label>
            <input id="task-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="task-status">Status</label>
            <select id="task-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
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
            {projectNames.length > 1 && (
              <div className="field filter">
                <label htmlFor="project-filter">Show</label>
                <select
                  id="project-filter"
                  value={activeFilter ?? ""}
                  onChange={(e) => setFilter(e.target.value === "" ? null : e.target.value)}
                >
                  <option value="">All projects</option>
                  {projectNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="board-list">
        {tasks.length === 0 ? (
          <p className="muted empty">Nothing on the sheet yet. Add the first task above and put a name on it.</p>
        ) : (
          <>
            <div className="sheet-head" aria-hidden="true">
              <span>Task</span>
              <span>Owner</span>
              <span>Due</span>
              <span>Status</span>
              <span />
            </div>
            {visibleGroups.map((g, i) => (
              <section key={g.name} className="project-group" aria-labelledby={`project-group-${i}`}>
                <h2 id={`project-group-${i}`} className="project-heading">
                  <span className="project-name">
                    <span className={`project-dot tone-${projectTone(g.name)}`} aria-hidden="true" />
                    {g.name}
                  </span>
                  <span className="project-count">
                    <TaskCount n={g.items.length} />
                  </span>
                </h2>
                <ul className="sheet sheet-app">
                  {g.items.map((t) => (
                    <li key={t.id} className={`sheet-row status-${t.status} tone-${projectTone(t.project)}`} data-testid="core-item">
                      <span className="cell-title">
                        {t.title}
                        <span className="title-meta">
                          <span className="project-tag">
                            <span className="cell-label">Project </span>
                            {t.project}
                          </span>
                          <DueChip deadline={t.deadline} status={t.status} today={today} />
                        </span>
                      </span>
                      <span className={`cell-owner${t.assignee ? "" : " muted"}`}>
                        <span className="cell-label">Owner </span>
                        {t.assignee && <Avatar name={t.assignee} />}
                        {t.assignee ? t.assignee : "Unassigned"}
                      </span>
                      <span className={`cell-due${t.deadline ? "" : " muted"}`}>
                        <span className="cell-label">Due </span>
                        {t.deadline ? formatDate(t.deadline) : "No date"}
                      </span>
                      <span className="cell-status">
                        <StatusIcon status={t.status} />
                        <select
                          aria-label={`Status of ${t.title}`}
                          value={t.status}
                          onChange={(e) => changeStatus(t.id, e.target.value as Status)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </span>
                      <span className="cell-actions">
                        <button
                          type="button"
                          className="text-button quiet"
                          onClick={() => removeTask(t.id)}
                          aria-label={`Delete ${t.title}`}
                        >
                          <TrashIcon />
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
      {/* Client-only (needs the user's local "today"). Calendar rows never carry core-item. */}
      {today && (
        <div className="board-calendar">
          <TaskCalendar
            tasks={activeFilter === null ? tasks : tasks.filter((t) => t.project === activeFilter)}
            statusLabels={STATUS_LABELS}
            onShowList={() => setView("list")}
          />
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
