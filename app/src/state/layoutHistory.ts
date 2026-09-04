import type { Orientation, OrientationLayout } from './layout';

// Geometry and membership form an edit. Live tile data/config changes do not.
export function layoutKey(layout: OrientationLayout): string {
  return JSON.stringify(layout.tiles.map(t => [t.instanceId, t.type, t.rect, t.name]));
}

export class LayoutHistory {
  private entries = new Map<string, { past: OrientationLayout[]; future: OrientationLayout[] }>();
  private key(id: string, orientation: Orientation) { return `${id}:${orientation}`; }
  private entry(id: string, orientation: Orientation) {
    const key = this.key(id, orientation);
    let entry = this.entries.get(key);
    if (!entry) { entry = { past: [], future: [] }; this.entries.set(key, entry); }
    return entry;
  }
  record(id: string, orientation: Orientation, before: OrientationLayout, after: OrientationLayout) {
    if (layoutKey(before) === layoutKey(after)) return;
    const entry = this.entry(id, orientation);
    entry.past.push(structuredClone(before));
    if (entry.past.length > 50) entry.past.shift();
    entry.future = [];
  }
  available(id: string, orientation: Orientation) {
    const entry = this.entry(id, orientation);
    return { undo: entry.past.length > 0, redo: entry.future.length > 0 };
  }
  move(id: string, orientation: Orientation, current: OrientationLayout, direction: 'undo' | 'redo'): OrientationLayout | null {
    const entry = this.entry(id, orientation);
    const from = direction === 'undo' ? entry.past : entry.future;
    const to = direction === 'undo' ? entry.future : entry.past;
    const next = from.pop();
    if (!next) return null;
    to.push(structuredClone(current));
    // Undoing a move must not roll back notes, timers, or other live tile data.
    return restoreLayout(next, current);
  }

  retain(ids: Set<string>) {
    for (const key of this.entries.keys()) {
      if (![...ids].some(id => key === this.key(id, 'landscape') || key === this.key(id, 'portrait'))) this.entries.delete(key);
    }
  }
}

export function restoreLayout(saved: OrientationLayout, current: OrientationLayout): OrientationLayout {
  return { tiles: saved.tiles.map(tile => {
    const live = current.tiles.find(t => t.instanceId === tile.instanceId);
    return { ...structuredClone(tile), ...(live ? { config: live.config } : {}) };
  }) };
}
