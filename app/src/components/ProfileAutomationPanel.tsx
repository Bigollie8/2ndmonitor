import { useState } from 'react';
import type { Profile } from '../types';
import type { ProfileAutomation } from '../state/profileAutomation';
import { currentDisplay } from '../state/useProfileAutomation';
import { isTauri } from '../state/tauri';

export function ProfileAutomationPanel({ value, set, profiles, activeProfileId, uiScale, paused, resume, status }: {
  value: ProfileAutomation; set: (value: ProfileAutomation) => void; profiles: Profile[];
  activeProfileId: string; uiScale: number; paused: boolean; resume: () => void; status: string;
}) {
  const [app, setApp] = useState('');
  const [profileId, setProfileId] = useState(activeProfileId);
  const [message, setMessage] = useState('');
  return <details className="feature-controls" style={{ marginTop: 16, padding: 12, border: '1px solid #ffffff22', borderRadius: 8, fontSize: 13 }}>
    <summary>Automatic profiles and display recall {value.enabled ? (paused ? '· Paused' : '· On') : '· Off'}</summary>
    <p>Match an exact process name (code.exe on Windows, com.microsoft.VSCode on macOS). A match must stay stable for four seconds. Manual profile choices pause automation for 30 minutes. Editing and open dialogs also pause switching.</p>
    <label><input type="checkbox" disabled={!isTauri} checked={value.enabled} onChange={e => set({ ...value, enabled: e.target.checked })} /> Enable automatic switching</label>
    {!isTauri && <p>Available in the desktop app.</p>}
    {value.enabled && <p role="status">{paused ? 'Paused after manual selection' : status} {paused && <button onClick={resume}>Resume now</button>}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
      <input aria-label="App process name" placeholder="code.exe or com.microsoft.VSCode" value={app} onChange={e => setApp(e.target.value)} />
      <select aria-label="Automatic profile" value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button disabled={!app.trim() || !profiles.some(p => p.id === profileId) || value.rules.length >= 50} onClick={() => { set({ ...value, rules: [...value.rules.filter(r => r.app.toLowerCase() !== app.trim().toLowerCase()), { app: app.trim(), profileId }] }); setApp(''); }}>Add app rule</button>
      <button disabled={!isTauri} onClick={() => { void currentDisplay().then(display => {
        if (!display) { setMessage('Could not identify this display.'); return; }
        set({ ...value, displays: [...value.displays.filter(d => d.display !== display), { display, profileId: activeProfileId, uiScale }].slice(-20) });
        setMessage(`Remembered this profile and ${Math.round(uiScale * 100)}% scale for ${display}.`);
      }).catch(() => setMessage('Display detection failed.')); }}>Remember this display</button>
    </div>
    {value.rules.map((r, i) => <div key={i}>{r.app} → {profiles.find(p => p.id === r.profileId)?.name ?? 'Deleted profile (inactive)'} <button aria-label={`Remove rule for ${r.app}`} onClick={() => set({ ...value, rules: value.rules.filter((_, n) => n !== i) })}>Remove</button></div>)}
    {value.displays.map((d, i) => <div key={d.display}>{d.display} → {profiles.find(p => p.id === d.profileId)?.name ?? 'Deleted profile (inactive)'} · {Math.round(d.uiScale * 100)}% <button onClick={() => set({ ...value, displays: value.displays.filter((_, n) => n !== i) })}>Forget</button></div>)}
    <p>Display recall runs when the window enters a remembered display. App rules take over after a stable match. Unrecognized or disconnected displays keep the current profile. If you rearrange displays in the OS, remember them again.</p>
    {message && <p role="status">{message}</p>}
  </details>;
}
