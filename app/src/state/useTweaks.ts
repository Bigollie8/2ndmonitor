import { useEffect, useRef, useState, useCallback } from 'react';

const STORAGE_KEY = 'hub:tweaks:v1'; // legacy localStorage key, used only for one-time migration
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// One-level deep-merge: for each key, if both sides are plain objects, merge fields;
// otherwise replace. Prevents partial saved JSON from dropping nested fields like
// weatherLocation.{lat,lon} or vizColorOverride.{accent,accent2}.
function mergeTweaks<T extends Record<string, unknown>>(defaults: T, loaded: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...defaults };
  for (const k of Object.keys(loaded)) {
    const lv = loaded[k];
    const dv = out[k];
    const bothObjs =
      lv !== null && typeof lv === 'object' && !Array.isArray(lv) &&
      dv !== null && typeof dv === 'object' && !Array.isArray(dv);
    out[k] = bothObjs ? { ...(dv as object), ...(lv as object) } : lv;
  }
  return out as T;
}

async function tauriLoad(): Promise<unknown | null> {
  if (!isTauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<unknown | null>('tweaks_load');
}
async function tauriSave(value: unknown): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tweaks_save', { value });
}

export function useTweaks<T extends Record<string, unknown>>(
  defaults: T,
): [T, <K extends keyof T>(key: K, value: T[K]) => void] {
  // Synchronous initial state from localStorage (used in browser dev AND as a
  // first-paint hint while the Tauri file load is in flight — avoids a flash
  // of defaults for users who already have settings).
  const [values, setValues] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return mergeTweaks(defaults, JSON.parse(raw));
    } catch { /* fall through */ }
    return defaults;
  });

  // Async hydrate from Tauri file (single-shot on mount).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fromFile = await tauriLoad();
        if (cancelled) return;
        if (fromFile && typeof fromFile === 'object' && !Array.isArray(fromFile)) {
          setValues(mergeTweaks(defaults, fromFile as Record<string, unknown>));
        } else if (isTauri) {
          // Migration: file doesn't exist yet but localStorage might. Persist current state.
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const initial = raw ? mergeTweaks(defaults, JSON.parse(raw)) : defaults;
            await tauriSave(initial);
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('tweaks_load failed, using localStorage:', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change. Always update localStorage (cheap, also covers browser dev).
  // Debounce Tauri file writes so rapid slider drags don't hammer the disk.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* noop */ }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void tauriSave(values).catch((err) => console.warn('tweaks_save failed:', err));
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [values]);

  const setTweak = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return [values, setTweak];
}
