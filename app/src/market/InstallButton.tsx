import type { CatalogItem } from '../state/catalog';
import { isCompatible } from '../state/appCompat';

/** The detail view's single primary action, in priority order:
 *  installed → incompatible → busy → install.
 *
 *  Compatibility is checked BEFORE install is offered. Letting the user click
 *  Install and then fail at runtime with a manifest error is exactly the
 *  confusing path `minAppVersion` exists to prevent. */
export function InstallButton({
  item, accent, appVersion, busy, disabled, onInstall, onOpenLibrary,
}: {
  item: CatalogItem;
  accent: string;
  appVersion: string;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onOpenLibrary: () => void;
}) {
  const base = {
    padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7,
    cursor: 'pointer', border: `1px solid ${accent}44`,
    background: `${accent}22`, color: accent,
  } as const;
  const muted = {
    ...base,
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.12)',
  } as const;

  if (item.installed) {
    return (
      <button onClick={onOpenLibrary} style={muted}>Installed · open in Library</button>
    );
  }
  if (!isCompatible(item.minAppVersion, appVersion)) {
    return (
      <button
        disabled
        title={`Requires app ${item.minAppVersion}`}
        style={{ ...muted, cursor: 'not-allowed', opacity: 0.6 }}
      >Requires {item.minAppVersion}</button>
    );
  }
  if (busy) return <button disabled style={{ ...base, cursor: 'wait', opacity: 0.6 }}>…</button>;
  return (
    <button
      onClick={onInstall}
      disabled={disabled}
      style={{ ...base, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
    >Install</button>
  );
}
