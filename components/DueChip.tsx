import type { Status } from "@/components/TaskBoard";
import { AlertIcon, ClockIcon } from "@/components/Icons";
import { daysBetween } from "@/lib/dates";

const plural = (n: number) => (n === 1 ? "day" : "days");

// How urgent a deadline is. Red is reserved for urgency: overdue, today and tomorrow.
//   overdue / today / tomorrow -> red, alert symbol
//   in 2-3 days                -> amber, clock
//   later                      -> neutral, clock
// The words always carry the meaning; colour and symbol only reinforce it.
export default function DueChip({ deadline, status, today }: { deadline: string | null; status: Status; today: string | null }) {
  if (!deadline || !today || status === "done") return null;
  const days = daysBetween(today, deadline);
  const urgent = days <= 1;
  const tone = urgent ? (days < 0 ? "due-chip due-overdue" : "due-chip due-urgent") : days <= 3 ? "due-chip due-soon" : "due-chip due-later";
  const Symbol = urgent ? AlertIcon : ClockIcon;
  return (
    <span className={tone}>
      <Symbol size={14} className="due-icon" />
      <span>
        {days < 0 ? (
          <>Overdue by <strong>{-days}</strong> {plural(-days)}</>
        ) : days === 0 ? (
          <>Due <strong>today</strong></>
        ) : days === 1 ? (
          <>Due <strong>tomorrow</strong></>
        ) : (
          <>Due in <strong>{days}</strong> days</>
        )}
      </span>
    </span>
  );
}
