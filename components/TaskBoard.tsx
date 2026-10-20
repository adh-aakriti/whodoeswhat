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
      <form className="card form" onSubmit={addTask}>
        <label>
          Task
          <input
            type="text"
            placeholder="e.g. Write the introduction"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            data-testid="core-input"
          />
        </label>
        <div className="row">
          <label>
            Assignee <span className="muted">(optional)</span>
            <input
              type="text"
              placeholder="Who owns it?"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              maxLength={100}
            />
          </label>
          <label>
            Deadline <span className="muted">(optional)</span>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving} data-testid="core-submit">
          {saving ? "Adding…" : "Add task"}
        </button>
      </form>

      {tasks.length === 0 ? (
        <p className="muted center empty">No tasks yet. Add the first one above.</p>
      ) : (
        <ul className="tasks">
          {tasks.map((t) => (
            <li key={t.id} className={`card task status-${t.status}`} data-testid="core-item">
              <div className="task-main">
                <span className="task-title">{t.title}</span>
                <span className="task-meta">
                  {t.assignee ? t.assignee : "Unassigned"}
                  {" · "}
                  {t.deadline ? `Due ${formatDate(t.deadline)}` : "No deadline"}
                </span>
              </div>
              <div className="task-actions">
                <select
                  aria-label={`Status of ${t.title}`}
                  value={t.status}
                  onChange={(e) => changeStatus(t.id, e.target.value as Status)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeTask(t.id)}
                  aria-label={`Delete ${t.title}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
