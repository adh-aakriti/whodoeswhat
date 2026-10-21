import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import TaskBoard from "@/components/TaskBoard";
import { currentProject, loadBoard } from "@/lib/teams";

export const metadata = { title: "Tasks · WhoDoesWhat" };

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sign-up sets the profile and personal project up; if that ever failed, fix it now (no onboarding).
  let board = await loadBoard(supabase, user.id).catch(() => null);
  if (!board || board.projects.length === 0) {
    await supabase.rpc("ensure_profile");
    board = await loadBoard(supabase, user.id).catch(() => null);
  }

  if (!board || !currentProject(board)) {
    return (
      <main className="container app-page">
        <p className="error" role="alert">
          Your workspace could not be set up. Please reload the page in a moment.
        </p>
      </main>
    );
  }

  return (
    <main className="container app-page">
      {/* No remount on project switches: the board refreshes its own data in place. */}
      <TaskBoard initialBoard={board} />
    </main>
  );
}
