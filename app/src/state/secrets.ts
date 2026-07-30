/** Unified credential storage.
 *
 *  Under Tauri, secrets live in the Rust-side DPAPI-encrypted secret store
 *  (`secret_get` / `secret_set` / `secret_delete` commands). In a plain
 *  browser (vite dev without the Tauri host) we fall back to localStorage
 *  under `secret:<key>` so browser dev keeps working.
 *
 *  One-time migration: callers that historically kept a credential in plain
 *  localStorage pass `legacyLocalStorageKey`. The first `getSecret` that
 *  finds nothing in the store checks that legacy key — if present, the value
 *  is moved into the store, removed from localStorage, and returned. */

import { useCallback, useEffect, useState } from 'react';
import { isTauri } from './tauri';

export interface SecretOpts {
  /** Plain-localStorage key this secret used to live under, for one-time
   *  transparent migration into the secret store. */
  legacyLocalStorageKey?: string;
}

const browserKey = (key: string) => `secret:${key}`;

/** Namespaces a marketplace bundle's declared secret key before it ever
 *  touches the store. The secret store is one flat namespace shared with
 *  built-in tiles (whose keys look like `github_pat`, `ha_token`, etc.) — a
 *  bundle that declared `secret:github_pat` verbatim would read/overwrite/
 *  delete a built-in tile's credential, and a user who'd already connected
 *  that built-in would have the value silently handed to the bundle with no
 *  setup prompt ever shown (see the C2 review finding). A bundle must never
 *  be able to name a built-in's secret, so every bundle secret is stored
 *  under `bundle.<bundleId>.<key>`. The *declared* key is still what's shown
 *  to the user in the UI and the install dialog — only the storage key
 *  changes. */
export function bundleSecretKey(bundleId: string, key: string): string {
  return `bundle.${bundleId}.${key}`;
}

/** In-memory cache so repeated getSecret calls don't re-invoke the backend.
 *  `null` is cached too ("known absent"). Kept coherent by set/delete. */
const cache = new Map<string, string | null>();

async function invokeSecret<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getSecret(key: string, opts?: SecretOpts): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!;

  let value: string | null;
  if (isTauri) {
    value = await invokeSecret<string | null>('secret_get', { key });
  } else {
    value = localStorage.getItem(browserKey(key));
  }

  // One-time migration from the legacy plain-localStorage location.
  if (value == null && opts?.legacyLocalStorageKey) {
    const legacy = localStorage.getItem(opts.legacyLocalStorageKey);
    if (legacy != null && legacy !== '') {
      await setSecret(key, legacy);
      localStorage.removeItem(opts.legacyLocalStorageKey);
      return legacy;
    }
  }

  cache.set(key, value);
  return value;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri) {
    await invokeSecret<void>('secret_set', { key, value });
  } else {
    localStorage.setItem(browserKey(key), value);
  }
  cache.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri) {
    await invokeSecret<void>('secret_delete', { key });
  } else {
    localStorage.removeItem(browserKey(key));
  }
  cache.set(key, null);
}

export interface UseSecretResult {
  /** The secret's value, or null while loading / when unset. */
  value: string | null;
  /** True once the initial async load has settled. Until then, treat the
   *  credential as "not configured yet" but do NOT show setup UI (avoids the
   *  connect-panel flash during load). */
  loaded: boolean;
  save: (v: string) => Promise<void>;
  clear: () => Promise<void>;
}

export function useSecret(key: string, opts?: { legacyLocalStorageKey?: string }): UseSecretResult {
  const [value, setValue] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const legacyKey = opts?.legacyLocalStorageKey;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getSecret(key, { legacyLocalStorageKey: legacyKey })
      .then((v) => {
        if (cancelled) return;
        setValue(v);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn(`secret load failed for ${key}`, err);
        if (cancelled) return;
        setValue(null);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [key, legacyKey]);

  const save = useCallback(async (v: string) => {
    await setSecret(key, v);
    setValue(v);
  }, [key]);

  const clear = useCallback(async () => {
    await deleteSecret(key);
    setValue(null);
  }, [key]);

  return { value, loaded, save, clear };
}
