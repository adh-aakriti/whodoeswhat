"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import Avatar from "@/components/Avatar";
import { formatJoinCode, type Member, type ProjectInfo } from "@/lib/teams";

type Panel = null | "new" | "join" | "name";

// Current project, switching, creating, joining, sharing the code, and your display name.
// Everything is stored in Supabase (profiles.current_project_id, display_name), never in the browser.
export default function ProjectBar({
  me,
  project,
  projects,
  members,
}: {
  me: { id: string; name: string };
  project: ProjectInfo;
  projects: ProjectInfo[];
  members: Member[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function open(next: Panel) {
    setPanel(panel === next ? null : next);
    setValue(next === "name" ? me.name : "");
    setError(null);
  }

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action();
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPanel(null);
    router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    if (panel === "new") run(() => supabase.rpc("create_project", { p_name: v }));
    if (panel === "join") run(() => supabase.rpc("join_project", { p_code: v }));
    if (panel === "name") run(() => supabase.from("profiles").update({ display_name: v }).eq("id", me.id));
  }

  function switchTo(id: string) {
    run(() => supabase.from("profiles").update({ current_project_id: id }).eq("id", me.id));
  }

  function leave() {
    if (!window.confirm(`Leave "${project.name}"? Your unfinished tasks there go back to the team as open tasks.`)) return;
    run(() => supabase.rpc("leave_project", { p_project: project.id }));
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(formatJoinCode(project.joinCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const labels: Record<Exclude<Panel, null>, { label: string; button: string; placeholder?: string }> = {
    new: { label: "Name of the new project", button: "Create project", placeholder: "e.g. Marketing 301" },
    join: { label: "Join code from a teammate", button: "Join project", placeholder: "e.g. K7QM9-2XRAP" },
    name: { label: "Your name, as teammates see it", button: "Save name" },
  };

  return (
    <section className="project-bar" aria-label="Project">
      <div className="project-bar-row">
        <div className="field project-switch">
          <label htmlFor="project-switch">Project</label>
          <select id="project-switch" value={project.id} onChange={(e) => switchTo(e.target.value)} disabled={busy}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.isPersonal ? "Personal (only you)" : p.name}
              </option>
            ))}
          </select>
        </div>

        {!project.isPersonal && (
          <div className="join-code">
            <span className="join-code-label">Join code</span>
            <code className="join-code-value">{formatJoinCode(project.joinCode)}</code>
            <button type="button" className="text-button" onClick={copyCode}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        <div className="project-actions">
          <button type="button" className="text-button" aria-expanded={panel === "new"} onClick={() => open("new")}>
            New project
          </button>
          <button type="button" className="text-button" aria-expanded={panel === "join"} onClick={() => open("join")}>
            Join with code
          </button>
          <button type="button" className="text-button" aria-expanded={panel === "name"} onClick={() => open("name")}>
            Your name: {me.name}
          </button>
          {!project.isPersonal && (
            <button type="button" className="text-button quiet" onClick={leave} disabled={busy}>
              Leave project
            </button>
          )}
        </div>
      </div>

      {panel && (
        <form className="project-panel" onSubmit={submit}>
          <div className="field">
            <label htmlFor="project-panel-input">{labels[panel].label}</label>
            <input
              id="project-panel-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={labels[panel].placeholder}
              maxLength={panel === "name" ? 60 : panel === "join" ? 20 : 80}
              autoComplete="off"
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Please wait…" : labels[panel].button}
          </button>
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <ul className="member-list" aria-label={`People in ${project.isPersonal ? "your personal project" : project.name}`}>
        {members.map((m) => (
          <li key={m.id}>
            <Avatar name={m.name} />
            {m.id === me.id ? `${m.name} (you)` : m.name}
            {m.role === "owner" && !project.isPersonal && <span className="member-role">owner</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
