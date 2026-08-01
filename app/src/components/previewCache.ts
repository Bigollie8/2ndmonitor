// ─────────────────────────────────────────────────────────────────────────────
// The decision `PreviewImage.tsx` used to make inline: whether a given cache
// key needs a real fetch, and — if two mounts ask for the same key at once —
// making sure only one fetch actually happens. Extracted to a pure module (no
// React) so the risky part (cache-hit-skips-fetch, failure-cached-as-null,
// concurrent-calls-share-one-fetch, in-flight cleared on both outcomes) is
// node-testable with a plain recording stub, instead of only reachable by
// mounting a real component — this repo has no React test harness, and this
// task doesn't add one.
//
// `PreviewImage.tsx` is now a thin effect: compute the key, call
// `loadPreview(key, () => invoke(...))`, apply the result behind its own
// `cancelled` guard.
// ─────────────────────────────────────────────────────────────────────────────

/** The durable result for a key: the fetched `data:` URL, or `null` recorded
 *  for a failed/invalid fetch — spec §9 says a missing preview is silent,
 *  but silent must still mean "asked once". Presence of the key (`!==
 *  undefined`), not truthiness of the value, is what distinguishes "never
 *  asked" from "asked and it has nothing". */
const cache = new Map<string, string | null>();

/** In-flight de-dup, keyed the same as `cache`. A cache MISS is not, by
 *  itself, exclusive — two callers can both see a miss before either has
 *  written the result (this is exactly what React 18 StrictMode's dev-only
 *  double-effect surfaced live: the second effect invocation ran before the
 *  first's `await fetcher()` had resolved). Recording the in-flight promise
 *  here, and having a second caller for the same key await THAT promise
 *  instead of starting its own, makes "attempted once" hold under a genuine
 *  race, not just across a clean unmount/remount. */
const inflight = new Map<string, Promise<string | null>>();

/** Synchronous read of the durable cache — no fetch, no promise. `undefined`
 *  means this key has never been attempted; `null` means it was attempted
 *  and failed; otherwise the cached `data:` URL. Used by `PreviewImage` both
 *  for its initial render (so a cache hit never flashes the fallback first)
 *  and to reset synchronously when its key changes on an already-mounted
 *  instance (see that file's doc comment on the version-bump bug this
 *  fixes). */
export function peekPreview(key: string): string | null | undefined {
  return cache.get(key);
}

/** Resolves to the cached/fetched `data:` URL, or `null` if the fetch has
 *  failed (recorded, not retried). `fetcher` is called AT MOST once per key
 *  until the process resets — a cache hit never calls it, and concurrent
 *  calls for the same key share one in-flight call rather than each
 *  starting their own. */
export async function loadPreview(
  key: string,
  fetcher: () => Promise<string>,
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  // Everything above this line, and the `inflight.set` below, runs
  // synchronously within this async function's body — a second call for the
  // same key made before this one's first `await` (i.e. before `fetcher()`
  // yields) will find `existing` already set. That's what makes two
  // concurrent calls share one real fetch rather than racing two.
  const promise = (async (): Promise<string | null> => {
    try {
      const result = await fetcher();
      cache.set(key, result);
      return result;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      // Cleared on BOTH outcomes — a key that failed and was later cleared
      // from `cache` (e.g. by a test reset) must be re-fetchable, not
      // wedged behind a stale settled promise.
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/** Test-only: clears both maps so a test starts from "never attempted" for
 *  every key, regardless of what an earlier test in the same process did. */
export function __resetPreviewCacheForTest(): void {
  cache.clear();
  inflight.clear();
}
