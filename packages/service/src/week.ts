/** ISO 8601 주차 표기(예: 2026-W45). 기관 주간보고는 월요일 시작 주차를 쓴다고 가정한다. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function parseIsoWeek(week: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week.trim());
  if (!m) return null;
  const w = Number(m[2]);
  return w >= 1 && w <= 53 ? { year: Number(m[1]), week: w } : null;
}

/** 해당 주차 월요일(UTC). */
function mondayOf(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

export function previousIsoWeek(week: string): string | null {
  const p = parseIsoWeek(week);
  if (!p) return null;
  const monday = mondayOf(p.year, p.week);
  monday.setUTCDate(monday.getUTCDate() - 7);
  return isoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}
