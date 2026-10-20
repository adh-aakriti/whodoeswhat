import type { Status } from "@/components/TaskBoard";
import { daysBetween } from "@/lib/dates";

const SOON_DAYS = 3;
const plural = (n: number) => (n === 1 ? "day" : "days");

// "Due in N days" / "Overdue by N days". The words carry the meaning; yellow and red only reinforce it.
export default function DueChip({ deadline, status, today }: { deadline: string | null; status: Status; today: string | null }) {
  if (!deadline || !today || status === "done") return null;
  const days = daysBetween(today, deadline);
  if (days < 0) {
    return (
      <span className="due-chip due-overdue">
        Overdue by <strong>{-days}</strong> {plural(-days)}
      </span>
    );
  }
  return (
    <span className={`due-chip ${days <= SOON_DAYS ? "due-soon" : "due-later"}`}>
      {days === 0 ? <>Due <strong>today</strong></> : <>Due in <strong>{days}</strong> {plural(days)}</>}
    </span>
  );
}
