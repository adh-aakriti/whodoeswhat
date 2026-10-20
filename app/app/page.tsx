import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import TaskBoard from "@/components/TaskBoard";
import { TASK_COLUMNS, type Member, type ProjectInfo, type Task } from "@/lib/teams";

export const metadata = { title: "Tasks · WhoDoesWhat" };

type MembershipRow = { role: "owner" | "member"; projects: { id: string; name: string; join_code: string; is_personal: boolean } | null };
type MemberRow = { user_id: string; role: "owner" | "member"; profiles: { display_name: string } | null };

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const loadProfile = () =>
    supabase.from("profiles").select("id, display_name, current_project_id").eq("id", user.id).maybeSingle();
  const loadProjects = () =>
    supabase.from("project_members").select("role, projects(id, name, join_code, is_personal)").eq("user_id", user.id);

  // Sign-up sets the profile and personal project up; if that ever failed, fix it now (no onboarding).
  let { data: profile } = await loadProfile();
  let { data: memberships } = await loadProjects();
  if (!profile || !memberships?.length) {
    await supabase.rpc("ensure_profile");
    ({ data: profile } = await loadProfile());
    ({ data: memberships } = await loadProjects());
  }

  const projects: ProjectInfo[] = ((memberships ?? []) as unknown as MembershipRow[])
    .filter((m) => m.projects)
    .map((m) => ({
      id: m.projects!.id,
      name: m.projects!.name,
      joinCode: m.projects!.join_code,
      isPersonal: m.projects!.is_personal,
      role: m.role,
    }))
    .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.name.localeCompare(b.name));
  const current =
    projects.find((p) => p.id === profile?.current_project_id) ?? projects.find((p) => p.isPersonal) ?? projects[0];

  if (!profile || !current) {
    return (
      <main className="container app-page">
        <p className="error" role="alert">
          Your workspace could not be set up. Please reload the page in a moment.
        </p>
      </main>
    );
  }

  const [{ data: memberRows }, { data: taskRows }] = await Promise.all([
    supabase.from("project_members").select("user_id, role, profiles(display_name)").eq("project_id", current.id),
    supabase.from("tasks").select(TASK_COLUMNS).eq("project_id", current.id).order("created_at", { ascending: false }),
  ]);
  const members: Member[] = ((memberRows ?? []) as unknown as MemberRow[])
    .map((m) => ({ id: m.user_id, name: m.profiles?.display_name ?? "Member", role: m.role }))
    .sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id) || a.name.localeCompare(b.name));

  return (
    <main className="container app-page">
      {/* Remount when the project changes so the board starts from that project's data. */}
      <TaskBoard
        key={current.id}
        me={{ id: user.id, name: profile.display_name }}
        project={current}
        projects={projects}
        initialMembers={members}
        initialTasks={(taskRows ?? []) as unknown as Task[]}
      />
    </main>
  );
}
