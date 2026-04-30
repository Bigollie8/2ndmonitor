import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'hub:tweaks:v1';

export function useTweaks<T extends Record<string, unknown>>(defaults: T): [T, <K extends keyof T>(key: K, value: T[K]) => void] {
  const [values, setValues] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...defaults, ...JSON.parse(stored) };
    } catch { /* fall through */ }
    return defaults;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* noop */ }
  }, [values]);

  const setTweak = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return [values, setTweak];
}
