/**
 * Business day helpers.
 * Cut-off hour is configurable (default 9 = 09:00 local).
 * Sales before the cut-off belong to the previous business day.
 */

let cutOffHour = 9;

/** Set business-day start hour (0–23). Used by Settings. */
export function setBusinessDayCutOffHour(hour: number): void {
  if (!Number.isFinite(hour)) return;
  cutOffHour = Math.min(23, Math.max(0, Math.floor(hour)));
}

export function getBusinessDayCutOffHour(): number {
  return cutOffHour;
}

export function getBusinessDayStart(ref: Date = new Date()): Date {
  const d = new Date(ref);
  const start = new Date(d);
  start.setHours(cutOffHour, 0, 0, 0);
  if (d.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

export function getBusinessDayEnd(ref: Date = new Date()): Date {
  const start = getBusinessDayStart(ref);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return end;
}

/** True if timestamp falls in the current business day. */
export function isCurrentBusinessDay(iso: string, ref: Date = new Date()): boolean {
  const t = new Date(iso).getTime();
  return t >= getBusinessDayStart(ref).getTime() && t < getBusinessDayEnd(ref).getTime();
}

/** Start of a calendar day at cut-off for reporting ranges */
export function businessDayKey(iso: string): string {
  const d = new Date(iso);
  const start = getBusinessDayStart(d);
  return start.toISOString().slice(0, 10);
}

/** Human label for the current business day window */
export function businessDayLabel(ref: Date = new Date()): string {
  const start = getBusinessDayStart(ref);
  const end = getBusinessDayEnd(ref);
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  return `${fmt(start)} → ${fmt(end)}`;
}
