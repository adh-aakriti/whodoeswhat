"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export type Status = "proposed" | "accepted" | "done";

export type Task = {
  id: string;
  title: string;
  assignee: string;
  deadline: string | null;
  status: Status;
  created_at: string;
};

const STATUSES: Status[] = ["proposed", "accepted", "done"];
const STATUS_LABELS: Record<Status, string> = { proposed: "Proposed", accepted: "Accepted", done: "Done" };
const COLUMNS = "id, title, assignee, deadline, status, created_at";

export default function TaskBoard({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<Status>("proposed");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

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
      })
      .select(COLUMNS)
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTasks((prev) => [data as Task, ...prev]);
    setTitle("");
    setAssignee("");
    setDeadline("");
    setStatus("proposed");
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
        <div className="field">
          <label htmlFor="task-title">New task</label>
          <input
            id="task-title"
            className="input-title"
            type="text"
            placeholder="e.g. Write the introduction"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            data-testid="core-input"
          />
        </div>
        <div className="row">
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
          <button type="submit" className="btn btn-primary" disabled={saving} data-testid="core-submit">
            {saving ? "Adding…" : "Add task"}
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

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
          <ul className="sheet sheet-app">
            {tasks.map((t) => (
              <li key={t.id} className={`sheet-row status-${t.status}`} data-testid="core-item">
                <span className="cell-title">{t.title}</span>
                <span className={`cell-owner${t.assignee ? "" : " muted"}`}>
                  <span className="cell-label">Owner </span>
                  {t.assignee ? t.assignee : "Unassigned"}
                </span>
                <span className={`cell-due${t.deadline ? "" : " muted"}`}>
                  <span className="cell-label">Due </span>
                  {t.deadline ? formatDate(t.deadline) : "No date"}
                </span>
                <span className="cell-status">
                  <span className="dot" aria-hidden="true" />
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
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
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
