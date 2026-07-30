import React, { useState } from 'react';
import type { ConfigDecl, SecretDecl } from '../sandbox/manifest';
import { bundleSecretKey, setSecret } from '../state/secrets';

/** Host-owned credential + config entry for an installed declarative tile.
 *  The bundle never sees these values — this panel writes secrets straight
 *  into the encrypted secret store and hands config back to the caller to
 *  persist (per-instance, in localStorage). Visually mirrors GithubPrsTile's
 *  ConnectPanel: one column of labelled inputs and a single primary action. */
export interface TileCredentialPanelProps {
  /** Owning bundle's id — secrets are namespaced under it in the store
   *  (bundleSecretKey) so a bundle can never name a built-in tile's
   *  credential. */
  bundleId: string;
  accent: string;
  secrets: SecretDecl[];
  config: ConfigDecl[];
  /** Current per-instance config values, used to prefill the form. */
  initialConfig: Record<string, unknown>;
  introLine?: React.ReactNode;
  /** Called with the next config object once Save is pressed. The caller
   *  persists it (localStorage key `tile.config.<bundleId>.<instanceId>`). */
  onSaveConfig: (next: Record<string, unknown>) => void;
  /** Called after every declared secret with a non-empty draft has been
   *  written to the secret store, so the caller can re-read secrets and
   *  close the panel. */
  onSecretsSaved: () => void;
}

export function TileCredentialPanel({
  bundleId, accent, secrets, config, initialConfig, introLine, onSaveConfig, onSecretsSaved,
}: TileCredentialPanelProps) {
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of config) {
      init[c.key] = initialConfig[c.key] != null ? String(initialConfig[c.key]) : '';
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  // Every declared secret is required for this phase (the manifest schema
  // has no optional-secret concept) — Save stays disabled until each has a
  // non-blank draft. Same for config: a blank config field used to be
  // silently coerced to 0 (see handleSave below) which then counted as
  // "set", locking a config-only tile at 0 forever after the first Save
  // (I6) — so canSave now blocks on blank config fields too, not just
  // blank secrets.
  const canSave =
    secrets.every((s) => (secretDrafts[s.key] ?? '').trim().length > 0)
    && config.every((c) => (configDrafts[c.key] ?? '').trim().length > 0);

  const handleSave = () => {
    const nextConfig: Record<string, unknown> = {};
    for (const c of config) {
      const raw = configDrafts[c.key] ?? '';
      // No `|| 0` fallback: canSave already guarantees every config draft is
      // non-blank by the time Save is enabled, so a numeric field that
      // somehow reaches here blank is a bug to surface (NaN), not a value to
      // silently paper over as a valid-looking 0.
      nextConfig[c.key] = c.type === 'number' ? Number(raw) : raw;
    }
    onSaveConfig(nextConfig);

    setSaving(true);
    void Promise.all(secrets.map((s) => setSecret(bundleSecretKey(bundleId, s.key), secretDrafts[s.key] ?? '')))
      .then(() => { setSaving(false); onSecretsSaved(); })
      .catch(() => { setSaving(false); });
  };

  return (
    <div style={{
      flex: 1, minHeight: 0, padding: 10, overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      {introLine && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
          {introLine}
        </div>
      )}
      {secrets.map((s) => (
        <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={labelStyle}>{s.label}</label>
          {s.help && <div style={helpStyle}>{s.help}</div>}
          <input
            type={s.kind === 'password' ? 'password' : 'text'}
            value={secretDrafts[s.key] ?? ''}
            onChange={(e) => setSecretDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
            style={inputStyle}
          />
        </div>
      ))}
      {config.map((c) => (
        <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={labelStyle}>{c.label}</label>
          <input
            type={c.type === 'number' ? 'number' : 'text'}
            value={configDrafts[c.key] ?? ''}
            onChange={(e) => setConfigDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
            style={inputStyle}
          />
        </div>
      ))}
      <button
        onClick={handleSave}
        disabled={!canSave || saving}
        style={{
          padding: '7px 12px', fontSize: 11, fontWeight: 700,
          background: canSave && !saving ? accent : 'rgba(255,255,255,0.06)',
          color: canSave && !saving ? '#000' : 'rgba(255,255,255,0.4)',
          border: 'none', borderRadius: 5,
          cursor: canSave && !saving ? 'pointer' : 'not-allowed',
        }}
      >{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
  letterSpacing: '0.04em',
};

const helpStyle: React.CSSProperties = {
  fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4,
};

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};
