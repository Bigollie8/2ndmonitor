import { useEffect, useRef, useState, useCallback } from 'react';

const STORAGE_KEY = 'hub:tweaks:v1'; // legacy localStorage key, used only for one-time migration
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
      if (raw) return { ...defaults, ...JSON.parse(raw) };
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
        if (fromFile && typeof fromFile === 'object') {
          setValues({ ...defaults, ...(fromFile as Record<string, unknown>) } as T);
        } else if (isTauri) {
          // Migration: file doesn't exist yet but localStorage might. Persist current state.
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const initial = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
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
