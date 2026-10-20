// Deadlines are plain "YYYY-MM-DD" dates. Build and compare them from local calendar parts only,
// so a deadline is never shifted by the browser's timezone.
export function toKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayKey() {
  const now = new Date();
  return toKey(now.getFullYear(), now.getMonth(), now.getDate());
}

// Whole days from `from` to `to` (negative when `to` is earlier). UTC maths, so DST never adds an hour.
export function daysBetween(from: string, to: string) {
  const utc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}
