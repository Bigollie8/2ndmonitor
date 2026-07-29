import { useEffect, useRef, useState, useCallback } from 'react';

const STORAGE_KEY = 'hub:tweaks:v1'; // legacy localStorage key, used only for one-time migration
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Guards untrusted JSON (Tauri file hydrate, imported file) before it reaches
// mergeTweaks. Arrays and primitives must be rejected here: mergeTweaks's
// `{...loaded}` spread would otherwise turn `[1,2,3]` into `{0:1,1:2,2:3}` and
// silently merge those numeric-string keys onto live app state.
// Exported for unit tests.
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// One-level deep-merge: for each key, if both sides are plain objects, merge fields;
// otherwise replace. Prevents partial saved JSON from dropping nested fields like
// weatherLocation.{lat,lon} or vizColorOverride.{accent,accent2}.
// Exported for unit tests — every persisted setting in the app flows through this.
export function mergeTweaks<T extends Record<string, unknown>>(defaults: T, loaded: Record<string, unknown>): T {
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
  opts?: { migrate?: (loaded: Record<string, unknown>) => Record<string, unknown> },
): [T, <K extends keyof T>(key: K, value: T[K]) => void, (raw: Record<string, unknown>) => void] {
  // Synchronous initial state from localStorage (browser dev + first-paint hint).
  const [values, setValues] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let parsed = JSON.parse(raw) as Record<string, unknown>;
        if (opts?.migrate) parsed = opts.migrate(parsed);
        return mergeTweaks(defaults, parsed);
      }
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
        if (isPlainObject(fromFile)) {
          let raw = fromFile;
          if (opts?.migrate) raw = opts.migrate(raw);
          setValues(mergeTweaks(defaults, raw));
        } else if (isTauri) {
          // Migration: file doesn't exist yet but localStorage might. Persist current state.
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            let initial: Record<string, unknown> = raw ? JSON.parse(raw) : {};
            if (opts?.migrate) initial = opts.migrate(initial);
            const merged = mergeTweaks(defaults, initial);
            await tauriSave(merged);
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('tweaks_load failed, using localStorage:', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change. Both sinks share the 300ms debounce: serializing the
  // full state (profiles, bookmarks, todos) is not free, and without the
  // debounce the localStorage write fired per pointermove while dragging the
  // sensitivity/smoothing sliders.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* noop */ }
      void tauriSave(values).catch((err) => console.warn('tweaks_save failed:', err));
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [values]);

  const setTweak = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Import merge. Despite the name, this does NOT reset to defaults first —
  // it merges the imported payload over the *current* values, matching the
  // Settings UI's "merges over current settings" hint. Merging over `defaults`
  // instead would silently reset every setting the hand-trimmed import file
  // omitted, which is surprising for a partial/curated import. Closes over
  // `defaults`/`opts` the same way the hydrate effect above does — they
  // aren't expected to change across renders. Mirrors the hydrate effect's
  // isPlainObject guard: callers type-assert an untrusted JSON.parse result
  // to Record<string, unknown>, so this is the last line of defense against
  // an array or primitive silently polluting state.
  const replaceAll = useCallback((raw: Record<string, unknown>) => {
    if (!isPlainObject(raw)) {
      console.warn('useTweaks: replaceAll ignored a non-object import payload', raw);
      return;
    }
    let next: Record<string, unknown> = raw;
    if (opts?.migrate) next = opts.migrate(next);
    setValues((prev) => mergeTweaks(prev, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [values, setTweak, replaceAll];
}
