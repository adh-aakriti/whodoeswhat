"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Status, Task } from "@/components/TaskBoard";
import { ChevronIcon, StatusIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import { projectTone } from "@/lib/projectTone";
import DueChip from "@/components/DueChip";
import { toKey, todayKey } from "@/lib/dates";
import TaskCount from "@/components/TaskCount";

// Dates are handled as plain "YYYY-MM-DD" keys built from local calendar parts,
// so a deadline is never shifted by the browser's timezone.
type Month = { year: number; month: number }; // month: 0-11

const WEEKDAYS = [
  ["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"],
  ["Fri", "Friday"], ["Sat", "Saturday"], ["Sun", "Sunday"],
] as const;

function parseKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}
// Local-midnight Date from a key; used only for formatting and day arithmetic.
function keyToDate(key: string) {
  const { year, month, day } = parseKey(key);
  return new Date(year, month, day);
}
function addDays(key: string, days: number) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + days);
  return toKey(date.getFullYear(), date.getMonth(), date.getDate());
}
function shiftMonth({ year, month }: Month, by: number): Month {
  const date = new Date(year, month + by, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}
function daysIn({ year, month }: Month) {
  return new Date(year, month + 1, 0).getDate();
}
function isOverdue(task: Task, today: string) {
  return task.deadline !== null && task.deadline < today && task.status !== "done";
}
const BUSY_FROM = 3; // 3+ tasks on one day = busy (red); 1-2 = light (yellow)
const tasksLabel = (n: number) => (n === 0 ? "no tasks" : n === 1 ? "1 task" : `${n} tasks`);

export default function TaskCalendar({
  tasks,
  statusLabels,
  onShowList,
  toneFor,
}: {
  tasks: Task[];
  statusLabels: Record<Status, string>;
  onShowList: () => void;
  toneFor?: (t: Task) => string; // CSS class for the task's project colour
}) {
  const [today, setToday] = useState(todayKey);
  const [shown, setShown] = useState<Month>(() => parseKey(today));
  const [selected, setSelected] = useState<string | null>(today);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep "today" right if the tab stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.deadline) continue;
      const list = map.get(t.deadline);
      if (list) list.push(t);
      else map.set(t.deadline, [t]);
    }
    return map;
  }, [tasks]);
  const undated = tasks.filter((t) => !t.deadline);

  // Move focus to the day the arrow keys landed on, after the month re-renders.
  useEffect(() => {
    if (!focusKey) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusKey}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey, shown]);

  function goToMonth(next: Month) {
    setShown(next);
    const first = toKey(next.year, next.month, 1);
    const last = toKey(next.year, next.month, daysIn(next));
    if (today >= first && today <= last) setSelected(today);
    else setSelected([...byDay.keys()].filter((k) => k >= first && k <= last).sort()[0] ?? null);
  }

  function selectDay(key: string, moveFocus = false) {
    const { year, month } = parseKey(key);
    if (year !== shown.year || month !== shown.month) setShown({ year, month });
    setSelected(key);
    if (moveFocus) setFocusKey(key);
  }

  function onGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const current = (e.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (!current) return;
    const { year, month, day } = parseKey(current);
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(current, -1),
      ArrowRight: () => addDays(current, 1),
      ArrowUp: () => addDays(current, -7),
      ArrowDown: () => addDays(current, 7),
      Home: () => addDays(current, -((keyToDate(current).getDay() + 6) % 7)),
      End: () => addDays(current, 6 - ((keyToDate(current).getDay() + 6) % 7)),
      PageUp: () => { const m = shiftMonth({ year, month }, -1); return toKey(m.year, m.month, Math.min(day, daysIn(m))); },
      PageDown: () => { const m = shiftMonth({ year, month }, 1); return toKey(m.year, m.month, Math.min(day, daysIn(m))); },
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    selectDay(move(), true);
  }

  const monthName = new Date(shown.year, shown.month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const leading = (new Date(shown.year, shown.month, 1).getDay() + 6) % 7; // Monday first
  const total = daysIn(shown);
  const trailing = (7 - ((leading + total) % 7)) % 7;
  const monthPrefix = toKey(shown.year, shown.month, 1).slice(0, 8);
  const inMonth = [...byDay.entries()].filter(([k]) => k.startsWith(monthPrefix)).reduce((n, [, l]) => n + l.length, 0);
  // Roving tabindex: one day in the grid is tabbable, arrow keys move between days.
  const tabbable = selected?.startsWith(monthPrefix) ? selected : today.startsWith(monthPrefix) ? today : toKey(shown.year, shown.month, 1);
  const selectedTasks = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="calendar">
      <div className="cal-head">
        <h2 className="cal-month" aria-live="polite">{monthName}</h2>
        <div className="cal-nav">
          <button type="button" className="cal-nav-btn" onClick={() => goToMonth(shiftMonth(shown, -1))} aria-label="Previous month">
            <ChevronIcon direction="left" size={18} />
          </button>
          <button type="button" className="cal-today" onClick={() => goToMonth(parseKey(today))}>
            Today
          </button>
          <button type="button" className="cal-nav-btn" onClick={() => goToMonth(shiftMonth(shown, 1))} aria-label="Next month">
            <ChevronIcon direction="right" size={18} />
          </button>
        </div>
      </div>
      <p className="cal-summary muted">{inMonth === 0 ? "No deadlines this month." : <><TaskCount n={inMonth} /> due this month.</>}</p>
      <ul className="cal-legend" aria-label="Legend">
        <li><span className="swatch swatch-light" aria-hidden="true" />1–2 tasks</li>
        <li><span className="swatch swatch-busy" aria-hidden="true" />3 or more</li>
        <li><span className="swatch swatch-overdue" aria-hidden="true" />Overdue</li>
      </ul>

      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map(([short]) => <span key={short}>{short}</span>)}
      </div>
      <div className="cal-grid" ref={gridRef} onKeyDown={onGridKeyDown} role="group" aria-label={`Days in ${monthName}`}>
        {Array.from({ length: leading }, (_, i) => <span key={`lead-${i}`} className="cal-blank" />)}
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const key = toKey(shown.year, shown.month, day);
          const dayTasks = byDay.get(key) ?? [];
          const overdue = dayTasks.filter((t) => isOverdue(t, today)).length;
          const date = keyToDate(key);
          const busy = dayTasks.length >= BUSY_FROM;
          const load = busy ? " load-busy" : dayTasks.length ? " load-light" : "";
          const label =
            `${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, ${tasksLabel(dayTasks.length)}` +
            (busy ? ", busy day" : "") +
            (overdue ? `, ${overdue} overdue` : "") +
            (key === today ? ", today" : "");
          return (
            <button
              key={key}
              type="button"
              data-date={key}
              className={`cal-day${load}${overdue ? " is-overdue" : ""}${key === today ? " is-today" : ""}${key === selected ? " is-selected" : ""}`}
              aria-label={label}
              aria-pressed={key === selected}
              aria-current={key === today ? "date" : undefined}
              tabIndex={key === tabbable ? 0 : -1}
              onClick={() => selectDay(key)}
            >
              <span className="cal-num" aria-hidden="true">{day}</span>
              {dayTasks.length > 0 && <span className="cal-count" aria-hidden="true">{dayTasks.length}</span>}
              {(key === today || busy || overdue > 0) && (
                <span className="cal-tags" aria-hidden="true">
                  {key === today && <span className="cal-tag tag-today">Today</span>}
                  {busy && <span className="cal-tag tag-busy">Busy</span>}
                  {overdue > 0 && <span className="cal-tag tag-overdue">Overdue</span>}
                </span>
              )}
            </button>
          );
        })}
        {Array.from({ length: trailing }, (_, i) => <span key={`trail-${i}`} className="cal-blank" />)}
      </div>

      <section className="cal-day-panel" aria-live="polite">
        {selected ? (
          <>
            <h3 className="cal-panel-title">
              {keyToDate(selected).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              <span className="project-count"><TaskCount n={selectedTasks.length} /></span>
            </h3>
            {selectedTasks.length === 0 ? (
              <p className="muted cal-none">Nothing due on this day.</p>
            ) : (
              <CalendarTaskList tasks={selectedTasks} today={today} statusLabels={statusLabels} toneFor={toneFor} />
            )}
          </>
        ) : (
          <p className="muted cal-none">Pick a day to see what is due.</p>
        )}
      </section>

      {undated.length > 0 && (
        <section className="cal-undated">
          <h3 className="cal-panel-title">
            No deadline
            <span className="project-count"><TaskCount n={undated.length} /></span>
          </h3>
          <CalendarTaskList tasks={undated} today={today} statusLabels={statusLabels} toneFor={toneFor} />
          <button type="button" className="text-button" onClick={onShowList}>
            Back to list view
          </button>
        </section>
      )}
    </div>
  );
}

// Read-only rows. Deliberately no data-testid="core-item": the list view is the only place that has it.
function CalendarTaskList({ tasks, today, statusLabels, toneFor }: { tasks: Task[]; today: string; statusLabels: Record<Status, string>; toneFor?: (t: Task) => string }) {
  const tone = (t: Task) => toneFor?.(t) ?? `tone-${projectTone(t.project)}`;
  return (
    <ul className="cal-tasks">
      {tasks.map((t) => (
        <li key={t.id} className={`cal-task status-${t.status} ${tone(t)}${t.handoff_to && t.status === "accepted" ? " has-handoff" : ""}`} data-calendar-task={t.id}>
          <span className="cal-task-title">
            {t.title}
            <DueChip deadline={t.deadline} status={t.status} today={today} />
          </span>
          <span className="project-tag project-name">
            <span className={`project-dot ${tone(t)}`} aria-hidden="true" />
            {t.project}
          </span>
          <span className="cal-task-meta">
            <span className={`cal-task-owner${t.assignee ? "" : " muted"}`}>
              {t.assignee && <Avatar name={t.assignee} />}
              {t.assignee || "Unassigned"}
            </span>
            <span className="cell-status">
              <StatusIcon status={t.handoff_to && t.status === "accepted" ? "handoff" : t.status} />
              {t.handoff_to && t.status === "accepted" ? "Handoff pending" : statusLabels[t.status]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
