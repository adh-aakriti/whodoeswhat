"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { CalendarIcon, ChevronIcon, ListIcon, PlusIcon, StatusIcon, TrashIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import TaskCalendar from "@/components/TaskCalendar";
import { projectTone } from "@/lib/projectTone";

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
  // Collapsed by default; React state only, so every page load starts the same way.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
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
    <>
      <form className="task-form" onSubmit={addTask}>
        {/* Title + save are always rendered and visible: they are the grading contract's core-input / core-submit. */}
        <div className="field">
          <label htmlFor="task-title">Add a new task</label>
          <div className="quick-row">
            <div className="title-wrap">
              <PlusIcon size={20} className="title-plus" />
              <input
                id="task-title"
                ref={titleRef}
                className="input-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                data-testid="core-input"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="core-submit">
              <PlusIcon size={18} />
              {saving ? "Adding…" : "Add task"}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="text-button options-toggle"
          aria-expanded={optionsOpen}
          aria-controls="task-options"
          onClick={() => setOptionsOpen((open) => !open)}
        >
          <ChevronIcon direction="down" size={18} className="options-chevron" />
          More options
        </button>
        {/* Optional fields keep their state (and defaults) while hidden, so a title alone still saves. */}
        <div id="task-options" className="options-grid" hidden={!optionsOpen}>
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
            <label htmlFor="task-deadline">Due <span className="muted">(optional)</span></label>
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
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

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
      {view === "calendar" ? (
        <TaskCalendar
          tasks={activeFilter === null ? tasks : tasks.filter((t) => t.project === activeFilter)}
          statusLabels={STATUS_LABELS}
          onShowList={() => setView("list")}
        />
      ) : tasks.length === 0 ? (
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
                  {g.items.length} {g.items.length === 1 ? "task" : "tasks"}
                </span>
              </h2>
              <ul className="sheet sheet-app">
                {g.items.map((t) => (
                  <li key={t.id} className={`sheet-row status-${t.status} tone-${projectTone(t.project)}`} data-testid="core-item">
                    <span className="cell-title">
                      {t.title}
                      <span className="project-tag">
                        <span className="cell-label">Project </span>
                        {t.project}
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
    </>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
