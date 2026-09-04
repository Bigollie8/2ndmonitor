export interface ProfileRule { app: string; profileId: string }
export interface DisplayProfile { display: string; profileId: string; uiScale: number }
export interface ProfileAutomation { enabled: boolean; rules: ProfileRule[]; displays: DisplayProfile[] }
export const DEFAULT_AUTOMATION: ProfileAutomation = { enabled: false, rules: [], displays: [] };
export function parseAutomation(raw: unknown): ProfileAutomation {
  const value = raw as Partial<ProfileAutomation> | null;
  return {
    enabled: value?.enabled === true,
    rules: Array.isArray(value?.rules) ? value.rules.filter(r => r && typeof r.app === 'string' && r.app.trim() && typeof r.profileId === 'string').slice(0, 50) : [],
    displays: Array.isArray(value?.displays) ? value.displays.filter(r => r && typeof r.display === 'string' && typeof r.profileId === 'string' && Number.isFinite(r.uiScale) && r.uiScale >= .75 && r.uiScale <= 1.5).slice(0, 20) : [],
  };
}
export const normalizeApp = (app: string) => app.trim().toLowerCase().replace(/\.exe$/, '');
export class StableProfileMatch {
  private candidate = '';
  private since = 0;
  reset() { this.candidate = ''; this.since = 0; }
  update(candidate: string | null, now: number): string | null {
    if (!candidate) { this.reset(); return null; }
    if (candidate !== this.candidate) { this.candidate = candidate; this.since = now; return null; }
    return now - this.since >= 4000 ? candidate : null;
  }
}
export function matchingProfile(rules: ProfileRule[], app: string, profileIds: string[]): string | null {
  if (!app) return null;
  return rules.find(r => normalizeApp(r.app) === normalizeApp(app) && profileIds.includes(r.profileId))?.profileId ?? null;
}
