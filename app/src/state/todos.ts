// Todo due-time / reminder logic (0.9.8) — pure and node-tested; the
// NotesTile feeds it (todos, now) and persists what it returns.
//
// Reminders are IN-APP only by choice (user's 0.9.8 answer): the tile shows
// a banner when something comes due — no OS notification permission added.

import type { Todo } from '../types';

/** Due within this window counts as "upcoming" (visually amber). */
export const UPCOMING_MS = 60 * 60 * 1000;

export type TodoUrgency = 'none' | 'upcoming' | 'overdue';

export function todoUrgency(t: Todo, nowMs: number): TodoUrgency {
  if (t.done || t.dueAt == null) return 'none';
  if (t.dueAt <= nowMs) return 'overdue';
  return t.dueAt - nowMs <= UPCOMING_MS ? 'upcoming' : 'none';
}

/** Todos whose reminder should fire NOW: due, not done, and not already
 *  reminded for this deadline (editing dueAt re-arms — remindedAt is cleared
 *  by setDue below). */
export function pendingReminders(todos: Todo[], nowMs: number): Todo[] {
  return todos.filter((t) =>
    !t.done && t.dueAt != null && t.dueAt <= nowMs && t.remindedAt == null,
  );
}

/** Stamp the fired reminders so they never re-fire. */
export function markReminded(todos: Todo[], firedIds: ReadonlySet<string>, nowMs: number): Todo[] {
  return todos.map((t) => (firedIds.has(t.id) ? { ...t, remindedAt: nowMs } : t));
}

/** Set/clear a todo's due time. Changing the deadline clears remindedAt so
 *  the new deadline gets its own reminder. */
export function setDue(todos: Todo[], id: string, dueAt: number | null): Todo[] {
  return todos.map((t) => {
    if (t.id !== id) return t;
    if (dueAt == null) {
      const { dueAt: _d, remindedAt: _r, ...rest } = t;
      return rest;
    }
    const { remindedAt: _r, ...rest } = t;
    return { ...rest, dueAt };
  });
}

/** The subtle "when it was written" fineprint: time-of-day for today,
 *  month+day otherwise (year added when it differs). */
export function fmtWhen(createdAt: number, nowMs: number): string {
  const c = new Date(createdAt);
  const n = new Date(nowMs);
  const sameDay = c.getFullYear() === n.getFullYear() && c.getMonth() === n.getMonth() && c.getDate() === n.getDate();
  if (sameDay) return c.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (c.getFullYear() === n.getFullYear()) return c.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return c.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Compact due label: "due 3:00 PM" today, "due Aug 21" otherwise,
 *  "overdue" past deadline. */
export function fmtDue(dueAt: number, nowMs: number): string {
  if (dueAt <= nowMs) return 'overdue';
  return `due ${fmtWhen(dueAt, nowMs)}`;
}
