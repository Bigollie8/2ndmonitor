import { isTauri } from './tauri';

export interface ForegroundInfo {
  process_name: string;
  window_title: string;
  pid: number;
}

export async function fetchForeground(): Promise<ForegroundInfo | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<ForegroundInfo>('foreground_get');
  } catch (err) {
    console.warn('foreground_get failed', err);
    return null;
  }
}

const STORAGE_KEY = '2mh.foreground.usage';

interface DailyUsage {
  /** YYYY-MM-DD — when the date rolls over we reset the bucket. */
  date: string;
  /** process_name → seconds. */
  perApp: Record<string, number>;
}

export function loadUsage(): DailyUsage {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: today, perApp: {} };
    const parsed = JSON.parse(raw) as DailyUsage;
    if (parsed.date !== today) return { date: today, perApp: {} };
    if (!parsed.perApp || typeof parsed.perApp !== 'object') return { date: today, perApp: {} };
    return parsed;
  } catch {
    return { date: today, perApp: {} };
  }
}

export function saveUsage(usage: DailyUsage): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(usage)); } catch { /* ignore */ }
}

/** Best-guess display name from an executable name. Strips `.exe`, capitalizes.
 *  On macOS `foreground_get`'s `process_name` is a bundle identifier (e.g.
 *  "com.spotify.client"), not a Windows executable name — the `.exe` strip
 *  and the KNOWN map below are both harmless no-ops there (neither matches),
 *  so this falls through to the generic capitalize-the-string case. That's a
 *  known, accepted rough edge (shows "Com.spotify.client" rather than
 *  "Spotify") rather than something this function tries to fix: it has no
 *  general way to turn an arbitrary bundle id into its marketing name. */
export function appDisplayName(processName: string): string {
  if (!processName) return 'unknown';
  const stripped = processName.replace(/\.exe$/i, '');
  // Heuristic: lowercase known web browsers / IDEs, otherwise pretty-case.
  const lower = stripped.toLowerCase();
  const KNOWN: Record<string, string> = {
    chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox',
    code: 'VS Code', windowsterminal: 'Terminal', wt: 'Terminal',
    devenv: 'Visual Studio', rider64: 'Rider', idea64: 'IntelliJ',
    pycharm64: 'PyCharm', webstorm64: 'WebStorm',
    discord: 'Discord', slack: 'Slack', teams: 'Teams',
    notion: 'Notion', obsidian: 'Obsidian', spotify: 'Spotify',
    explorer: 'Explorer', steam: 'Steam',
  };
  return KNOWN[lower] ?? (stripped.charAt(0).toUpperCase() + stripped.slice(1));
}
