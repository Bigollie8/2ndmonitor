// ─────────────────────────────────────────────────────────────────────────────
// The one effectful update-check path, shared by the passive UpdateToast and
// the Settings "Check for updates" row — kept out of updater.ts on purpose:
// that module is pure (node-testable), this one talks to the tauri plugins.
//
// A check NEVER downloads anything. The returned `install` closure is the
// only thing that does, and only when the user invokes it.
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateCheckResult =
  | { kind: 'update'; version: string; notes: string | null; install: () => Promise<void> }
  | { kind: 'current'; version: string }
  | { kind: 'error'; message: string };

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const [{ check }, { getVersion }] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/api/app'),
    ]);
    const [update, currentVersion] = await Promise.all([check(), getVersion()]);
    if (!update || update.version === currentVersion) {
      return { kind: 'current', version: currentVersion };
    }
    return {
      kind: 'update',
      version: update.version,
      notes: update.body ?? null,
      install: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      },
    };
  } catch (e) {
    return { kind: 'error', message: String(e instanceof Error ? e.message : e) };
  }
}
