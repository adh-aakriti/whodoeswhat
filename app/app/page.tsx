import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import TaskBoard, { type Task } from "@/components/TaskBoard";

export const metadata = { title: "Tasks · WhoDoesWhat" };

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("tasks")
    .select("id, title, assignee, deadline, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="container app-page">
      <h1>Your tasks</h1>
      <TaskBoard initialTasks={(data ?? []) as Task[]} />
    </main>
  );
}
