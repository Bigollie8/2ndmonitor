import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';

const STORAGE_PREFIX = '2mh.scratch.';

export interface ScratchpadTileProps {
  /** Per-instance storage key suffix; the same instance keeps its own buffer
   *  across reloads. */
  instanceId: string;
  density: Density;
  accent: string;
}

/** Free-form text buffer. Persists per-instance via localStorage so multiple
 *  scratchpads on a profile keep distinct content. Auto-saves on every keystroke
 *  with no debounce — text is small and localStorage writes are synchronous. */
export function ScratchpadTile({ instanceId, density, accent }: ScratchpadTileProps) {
  const key = STORAGE_PREFIX + instanceId;
  const [text, setText] = useState<string>(() => {
    try { return localStorage.getItem(key) ?? ''; }
    catch { return ''; }
  });

  useEffect(() => {
    try { localStorage.setItem(key, text); } catch { /* ignore quota */ }
  }, [key, text]);

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{wordCount} w · {charCount} c</span>
  );

  return (
    <HFTile title="Scratchpad" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Quick notes — saved per tile, persists across reloads."
        spellCheck={false}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          padding: 12, resize: 'none',
          background: 'transparent', color: 'rgba(255,255,255,0.9)',
          border: 'none', outline: 'none',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12, lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />
    </HFTile>
  );
}
