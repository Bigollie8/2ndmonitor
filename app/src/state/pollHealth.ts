export interface PollHealth {
  id: string; label: string; intervalMs: number; updatedAt: number | null;
  needsSetup?: boolean; failed: boolean; pending: boolean; retry: () => void;
}
let snapshot: PollHealth[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export const pollHealth = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  put(value: PollHealth) { snapshot = [...snapshot.filter(r => r.id !== value.id), value]; emit(); },
  patch(id: string, value: Partial<PollHealth>) { if (!snapshot.some(r => r.id === id)) return; snapshot = snapshot.map(r => r.id === id ? { ...r, ...value } : r); emit(); },
  remove(id: string) { snapshot = snapshot.filter(r => r.id !== id); emit(); },
};
export function freshness(row: Pick<PollHealth, 'updatedAt' | 'intervalMs' | 'failed' | 'pending' | 'needsSetup'>, now: number): string {
  if (row.needsSetup) return 'Needs setup';
  if (row.pending) return 'Checking';
  if (row.failed) return row.updatedAt === null ? 'Unavailable' : 'Retrying · showing saved data';
  if (row.updatedAt === null) return 'Waiting';
  return now - row.updatedAt > row.intervalMs * 2 ? 'Stale' : 'Up to date';
}
