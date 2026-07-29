import React, { useState } from 'react';
import { HFTile } from './tiles';
import {
  type StreamDeckButton,
  type StreamDeckConfig,
  executeAction,
  type ActionContext,
} from '../state/actions';
import { StreamDeckActionPicker } from './StreamDeckActionPicker';
import { useVizStyles } from './useVizStyles';
import type { Profile, VizMode, Density } from '../types';

export interface StreamDeckTileProps {
  config: StreamDeckConfig;
  setConfig: (next: StreamDeckConfig) => void;
  editing: boolean;
  density: Density;
  accent: string;
  vizMode: VizMode;
  setVizMode: (m: VizMode) => void;
  profiles: Profile[];
  setActiveProfileId: (id: string) => void;
}

type PickerState =
  | { open: false }
  | { open: true; mode: 'new' }
  | { open: true; mode: 'edit'; index: number };

export function StreamDeckTile({
  config, setConfig, editing, density, accent,
  vizMode, setVizMode, profiles, setActiveProfileId,
}: StreamDeckTileProps) {
  const [pickerState, setPickerState] = useState<PickerState>({ open: false });
  const { styles: vizStyles } = useVizStyles();

  const ctx: ActionContext = {
    vizMode, setVizMode, setActiveProfileId,
    vizIds: vizStyles.map((s) => s.id),
  };

  const handleButtonClick = (button: StreamDeckButton, index: number) => {
    if (editing) {
      setPickerState({ open: true, mode: 'edit', index });
    } else {
      void executeAction(button.action, ctx);
    }
  };

  const handleEmptyCellClick = () => {
    if (!editing) return;
    setPickerState({ open: true, mode: 'new' });
  };

  const handleSave = (button: StreamDeckButton) => {
    if (pickerState.open && pickerState.mode === 'edit') {
      const next = config.buttons.map((b, i) => (i === pickerState.index ? button : b));
      setConfig({ ...config, buttons: next });
    } else {
      // mode 'new' — append
      setConfig({ ...config, buttons: [...config.buttons, button] });
    }
  };

  const handleDelete = () => {
    if (!pickerState.open || pickerState.mode !== 'edit') return;
    const next = config.buttons.filter((_, i) => i !== pickerState.index);
    setConfig({ ...config, buttons: next });
  };

  const setCols = (cols: number) => setConfig({ ...config, cols: Math.min(8, Math.max(1, cols)) });
  const setRows = (rows: number) => setConfig({ ...config, rows: Math.min(8, Math.max(1, rows)) });

  // Compute total cells. Show buttons + one trailing "+" placeholder in edit mode
  // (only if there's room). Cells beyond that are empty/non-interactive.
  const totalCells = config.cols * config.rows;
  const buttonsToRender = config.buttons.slice(0, totalCells);
  const hasRoomForPlaceholder = editing && config.buttons.length < totalCells;
  const trailingEmpty = totalCells - buttonsToRender.length - (hasRoomForPlaceholder ? 1 : 0);

  const headRight = editing ? (
    <div style={{ display: 'flex', gap: 4 }}>
      <SizeButton onClick={() => setCols(config.cols - 1)} title="Fewer columns">−C</SizeButton>
      <SizeButton onClick={() => setCols(config.cols + 1)} title="More columns">+C</SizeButton>
      <SizeButton onClick={() => setRows(config.rows - 1)} title="Fewer rows">−R</SizeButton>
      <SizeButton onClick={() => setRows(config.rows + 1)} title="More rows">+R</SizeButton>
    </div>
  ) : null;

  const initialForPicker: StreamDeckButton | undefined =
    pickerState.open && pickerState.mode === 'edit' ? config.buttons[pickerState.index] : undefined;

  return (
    <HFTile
      title="Stream Deck"
      headRight={headRight}
      accent={accent}
      density={density}
      style={{ height: '100%' }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
        gridTemplateRows: `repeat(${config.rows}, 1fr)`,
        gap: 8,
        width: '100%', height: '100%',
      }}>
        {buttonsToRender.map((button, i) => (
          <ButtonCell
            key={button.buttonId}
            button={button}
            accent={accent}
            editing={editing}
            onClick={() => handleButtonClick(button, i)}
          />
        ))}
        {hasRoomForPlaceholder && (
          <PlaceholderCell key="placeholder-add" accent={accent} editing={editing} onClick={handleEmptyCellClick} />
        )}
        {Array.from({ length: trailingEmpty }, (_, i) => (
          <PlaceholderCell key={`empty-${i}`} accent={accent} editing={false} onClick={() => {}} />
        ))}
      </div>

      {pickerState.open && (
        <StreamDeckActionPicker
          initial={initialForPicker}
          profiles={profiles}
          accent={accent}
          onSave={handleSave}
          onDelete={pickerState.mode === 'edit' ? handleDelete : undefined}
          onClose={() => setPickerState({ open: false })}
        />
      )}
    </HFTile>
  );
}

function ButtonCell({
  button, accent, editing, onClick,
}: {
  button: StreamDeckButton;
  accent: string;
  editing: boolean;
  onClick: () => void;
}) {
  const color = button.color || accent;
  return (
    <button
      onClick={onClick}
      title={button.label || button.icon}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: 6,
        background: `${color}10`,
        border: `1px solid ${color}55`,
        borderRadius: 8, cursor: 'pointer',
        color: 'rgba(255,255,255,0.85)',
        transition: 'background .12s, border-color .12s',
        overflow: 'hidden',
      }}
    >
      {editing && (
        <span style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 10, color: 'rgba(255,255,255,0.5)',
        }}>✏</span>
      )}
      <span style={{ fontSize: 22, lineHeight: 1 }}>{button.icon}</span>
      {button.label && (
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.65)',
          textAlign: 'center',
          maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{button.label}</span>
      )}
    </button>
  );
}

function PlaceholderCell({
  accent, editing, onClick,
}: {
  accent: string;
  editing: boolean;
  onClick: () => void;
}) {
  if (!editing) {
    return <div style={{ background: 'transparent', pointerEvents: 'none' }} />;
  }
  return (
    <button
      onClick={onClick}
      title="Add button"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.02)',
        border: `1px dashed ${accent}33`,
        borderRadius: 8, cursor: 'pointer',
        color: 'rgba(255,255,255,0.3)',
      }}
    >
      <span style={{ fontSize: 22 }}>+</span>
    </button>
  );
}

function SizeButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '3px 6px', fontSize: 10, fontWeight: 600, borderRadius: 4,
        background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >{children}</button>
  );
}
