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

/** Sort key: manual order when the user has dragged, else createdAt —
 *  ascending, so FIRST-ENTERED stays on top (0.9.13; supersedes the 0.9.8
 *  newest-on-top reading of the same feedback thread). */
export function todoSortKey(t: Todo): number {
  return t.order ?? t.createdAt;
}

/** Display order: active todos oldest-first (or manual order), done sunk. */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return todoSortKey(a) - todoSortKey(b);
  });
}

/** Drag-to-reorder: move `fromId` so it lands where `toId` currently sits,
 *  within the ACTIVE (not-done) ordering. Stamps explicit `order` onto every
 *  active todo so the arrangement survives reloads; done todos keep their
 *  keys (they sink regardless). Unknown ids → unchanged input. */
export function reorderTodos(todos: Todo[], fromId: string, toId: string): Todo[] {
  if (fromId === toId) return todos;
  const active = sortTodos(todos).filter((t) => !t.done);
  const fromIdx = active.findIndex((t) => t.id === fromId);
  const toIdx = active.findIndex((t) => t.id === toId);
  if (fromIdx < 0 || toIdx < 0) return todos;
  const arranged = [...active];
  const [moved] = arranged.splice(fromIdx, 1);
  arranged.splice(toIdx, 0, moved);
  const orderOf = new Map(arranged.map((t, i) => [t.id, i]));
  return todos.map((t) => (orderOf.has(t.id) ? { ...t, order: orderOf.get(t.id) } : t));
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
