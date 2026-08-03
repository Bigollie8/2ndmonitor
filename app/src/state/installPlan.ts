// ─────────────────────────────────────────────────────────────────────────────
// What "Install all" on a collection is actually asking the user to agree to.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// The per-bundle install dialog already encodes the principle: you see the
// capabilities before you grant them. A collection button that installed five
// bundles behind one unlabelled "Install all" would quietly discard that, so
// this attributes every capability to the bundles that want it.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';
import { isCompatible } from './appCompat';
import { describePermission } from './permissionBadges';

export interface InstallPlanEntry {
  item: CatalogItem;
  permissions: string[];
}

export interface InstallPlan {
  toInstall: InstallPlanEntry[];
  alreadyInstalled: CatalogItem[];
  blocked: Array<{ item: CatalogItem; reason: string }>;
  /** Deduped capabilities, each naming every bundle that wants it. */
  grants: Array<{ permission: string; description: string; wantedBy: string[] }>;
  needsConsent: boolean;
}

export function planMultiInstall(items: CatalogItem[], appVersion: string): InstallPlan {
  const toInstall: InstallPlanEntry[] = [];
  const alreadyInstalled: CatalogItem[] = [];
  const blocked: Array<{ item: CatalogItem; reason: string }> = [];

  for (const item of items) {
    if (item.removed) {
      // The user tombstoned this deliberately. Quietly reinstalling it as
      // part of a bulk action would override an explicit choice; Restore is
      // the deliberate path back.
      blocked.push({ item, reason: 'Removed from your catalog — restore it from the Library first' });
      continue;
    }
    if (item.installed) { alreadyInstalled.push(item); continue; }
    if (!isCompatible(item.minAppVersion, appVersion)) {
      blocked.push({ item, reason: `Requires app ${item.minAppVersion}` });
      continue;
    }
    toInstall.push({ item, permissions: item.permissions });
  }

  // Only what will ACTUALLY be installed contributes a grant. Asking consent
  // for a capability belonging to a skipped bundle would be asking for a
  // grant that is never used.
  const byPermission = new Map<string, string[]>();
  for (const entry of toInstall) {
    for (const p of entry.permissions) {
      const list = byPermission.get(p) ?? [];
      list.push(entry.item.name);
      byPermission.set(p, list);
    }
  }

  const grants = [...byPermission.entries()]
    .map(([permission, wantedBy]) => ({
      permission,
      description: describePermission(permission),
      wantedBy,
    }))
    .sort((a, b) => a.permission.localeCompare(b.permission));

  return { toInstall, alreadyInstalled, blocked, grants, needsConsent: grants.length > 0 };
}
