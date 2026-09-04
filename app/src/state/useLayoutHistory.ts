import { useCallback, useRef } from 'react';
import type { Profile } from '../types';
import type { Orientation } from './layout';
import { LayoutHistory, layoutKey } from './layoutHistory';

export function useLayoutHistory(profiles: Profile[], save: (profiles: Profile[]) => void, ready: boolean) {
  const history = useRef(new LayoutHistory());
  const live = useRef(profiles);
  // Hydration / full settings import is outside this edit stream.
  if (live.current !== profiles) history.current = new LayoutHistory();
  live.current = profiles;
  const setProfiles = useCallback((next: Profile[]) => {
    const result = next.map(profile => {
      const before = live.current.find(p => p.id === profile.id);
      if (!ready || !before) return profile;
      let checkpoints = profile.layoutCheckpoints;
      for (const orientation of ['landscape', 'portrait'] as const) {
        history.current.record(profile.id, orientation, before[orientation], profile[orientation]);
        if (layoutKey(before[orientation]) !== layoutKey(profile[orientation]) && !checkpoints?.[orientation]) {
          checkpoints = { ...checkpoints, [orientation]: structuredClone(before[orientation]) };
        }
      }
      return checkpoints === profile.layoutCheckpoints ? profile : { ...profile, layoutCheckpoints: checkpoints };
    });
    history.current.retain(new Set(next.map(p => p.id)));
    live.current = result;
    save(result);
  }, [ready, save]);
  const move = (id: string, orientation: Orientation, direction: 'undo' | 'redo') => {
    const current = live.current.find(p => p.id === id);
    if (!current) return;
    const next = history.current.move(id, orientation, current[orientation], direction);
    if (next) { const result = live.current.map(p => p.id === id ? { ...p, [orientation]: next } : p); live.current = result; save(result); }
  };
  return { setProfiles, move, available: (id: string, orientation: Orientation) => history.current.available(id, orientation) };
}
