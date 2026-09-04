import { useEffect, useRef, useState } from 'react';
import { isAppHidden } from './framePace';
import { fetchForeground } from './foreground';
import { isTauri } from './tauri';
import type { ForegroundInfo } from './foreground';
import { matchingProfile, StableProfileMatch, type ProfileAutomation } from './profileAutomation';

export async function currentDisplay(): Promise<string | null> {
  if (!isTauri) return null;
  const { currentMonitor } = await import('@tauri-apps/api/window');
  const monitor = await currentMonitor();
  if (!monitor) return null;
  // No serial numbers exposed by Tauri. Name + physical origin distinguishes
  // same-model displays; OS display rearrangements require remembering again.
  return `${monitor.name ?? 'Display'} @ ${monitor.position.x},${monitor.position.y}`;
}

export function useProfileAutomation(options: {
  settings: ProfileAutomation; profileIds: string[]; activeProfileId: string;
  blocked: boolean; select: (id: string) => void; setScale: (scale: number) => void;
  sources?: { foreground: () => Promise<ForegroundInfo | null>; display: () => Promise<string | null> };
}) {
  const live = useRef(options); live.current = options;
  const pausedUntil = useRef(0);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('Waiting for a matching app or display');
  const pause = () => { pausedUntil.current = Date.now() + 30 * 60_000; setPaused(true); };
  const resume = () => { pausedUntil.current = 0; setPaused(false); };
  useEffect(() => {
    if (!options.settings.enabled || (!isTauri && !options.sources)) return;
    let stopped = false;
    let busy = false;
    let lastDisplay: string | null = null;
    const apps = new StableProfileMatch();
    const displays = new StableProfileMatch();
    const tick = async () => {
      if (busy || stopped) return;
      if (live.current.blocked || isAppHidden() || Date.now() < pausedUntil.current) { apps.reset(); displays.reset(); return; }
      setPaused(false);
      busy = true;
      try {
        const [foreground, display] = await Promise.all([
          (options.sources?.foreground ?? fetchForeground)(),
          (options.sources?.display ?? currentDisplay)(),
        ]);
        const o = live.current;
        if (stopped || o.blocked || isAppHidden() || Date.now() < pausedUntil.current) return;
        const recalled = displays.update(display, Date.now());
        if (recalled && recalled !== lastDisplay) {
          lastDisplay = recalled;
          const binding = o.settings.displays.find(d => d.display === recalled && o.profileIds.includes(d.profileId));
          if (binding) {
            o.select(binding.profileId); o.setScale(binding.uiScale);
            setStatus(`Recalled display: ${recalled}`); apps.reset(); return;
          }
        }
        const candidate = matchingProfile(o.settings.rules, foreground?.process_name ?? '', o.profileIds);
        const matched = apps.update(candidate, Date.now());
        if (matched && matched !== o.activeProfileId) {
          o.select(matched); setStatus(`Matched app: ${foreground?.process_name}`);
        }
      } catch { setStatus('Display detection unavailable; retrying'); }
      finally { busy = false; }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [options.settings, options.sources]);
  return { pause, resume, paused, status };
}
