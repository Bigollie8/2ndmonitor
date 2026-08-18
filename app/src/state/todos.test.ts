import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todoUrgency, pendingReminders, markReminded, setDue, fmtWhen, fmtDue, UPCOMING_MS } from './todos';
import type { Todo } from '../types';

const mk = (over: Partial<Todo>): Todo => ({
  id: 'a', text: 'x', done: false, createdAt: 0, ...over,
});

test('urgency: none without dueAt or when done; upcoming inside the window; overdue past it', () => {
  const now = 1_000_000;
  assert.equal(todoUrgency(mk({}), now), 'none');
  assert.equal(todoUrgency(mk({ dueAt: now - 1, done: true }), now), 'none');
  assert.equal(todoUrgency(mk({ dueAt: now + UPCOMING_MS + 1 }), now), 'none');
  assert.equal(todoUrgency(mk({ dueAt: now + UPCOMING_MS - 1 }), now), 'upcoming');
  assert.equal(todoUrgency(mk({ dueAt: now - 1 }), now), 'overdue');
});

test('reminders fire once per deadline and never for done todos', () => {
  const now = 5_000;
  const todos = [
    mk({ id: 'due', dueAt: 4_000 }),
    mk({ id: 'done', dueAt: 4_000, done: true }),
    mk({ id: 'later', dueAt: 9_000 }),
    mk({ id: 'fired', dueAt: 4_000, remindedAt: 4_500 }),
  ];
  const pending = pendingReminders(todos, now);
  assert.deepEqual(pending.map((t) => t.id), ['due']);
  const after = markReminded(todos, new Set(['due']), now);
  assert.equal(pendingReminders(after, now).length, 0);
  assert.equal(after.find((t) => t.id === 'due')!.remindedAt, now);
});

test('editing a due time re-arms the reminder; clearing removes both fields', () => {
  const todos = [mk({ id: 'a', dueAt: 4_000, remindedAt: 4_100 })];
  const moved = setDue(todos, 'a', 10_000);
  assert.equal(moved[0].dueAt, 10_000);
  assert.equal(moved[0].remindedAt, undefined);
  const cleared = setDue(moved, 'a', null);
  assert.ok(!('dueAt' in cleared[0]) && !('remindedAt' in cleared[0]));
});

test('old-format todos (no dueAt) pass through everything untouched', () => {
  const legacy = mk({});
  assert.equal(pendingReminders([legacy], 9e12).length, 0);
  assert.equal(todoUrgency(legacy, 9e12), 'none');
  assert.deepEqual(setDue([legacy], 'other', 5)[0], legacy);
});

test('fineprint: time for today, short date otherwise, year when it differs', () => {
  const now = new Date(2026, 7, 18, 12, 0).getTime();
  assert.match(fmtWhen(new Date(2026, 7, 18, 9, 30).getTime(), now), /9:30/);
  assert.match(fmtWhen(new Date(2026, 7, 15).getTime(), now), /Aug/);
  assert.match(fmtWhen(new Date(2025, 7, 15).getTime(), now), /2025/);
});

test('due label says overdue past deadline', () => {
  const now = new Date(2026, 7, 18, 12, 0).getTime();
  assert.equal(fmtDue(now - 1, now), 'overdue');
  assert.match(fmtDue(new Date(2026, 7, 18, 15, 0).getTime(), now), /^due /);
});
