import { useRef, useState } from 'react';
import { setAvatar } from '../state/community';
import { avatarSrc } from '../state/avatarUrl';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
/** Stored square. Big enough to look sharp at 72px on a HiDPI screen, small
 *  enough that the encoded PNG lands far under the server's 512 KB cap. */
const TARGET = 256;

/** Your profile picture: upload one, or fall back to the generated identicon.
 *
 *  The file is downscaled and re-encoded to PNG in the browser BEFORE it is
 *  sent. Three things fall out of that: a 12-megapixel phone photo becomes a
 *  ~60 KB square instead of failing the cap, every stored avatar is the same
 *  size and shape, and re-encoding through a canvas drops all EXIF — so
 *  nobody publishes the GPS coordinates of their house with their face. */
export function AvatarEditor({ accent, handle, hasAvatar, seed, onChanged }: {
  accent: string;
  handle: string | null;
  hasAvatar: boolean;
  seed: string | null;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bumped after a change so the <img> refetches — the server sends a 300s
  // cache header, and without this someone would upload a picture, see the
  // old one, and reasonably conclude it had failed.
  const [bust, setBust] = useState(0);

  const pick = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = TARGET;
      canvas.height = TARGET;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('could not process that image');

      // Centre-crop to a square, so a portrait photo does not arrive
      // squashed — the frame is square everywhere it is rendered.
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
        0, 0, TARGET, TARGET,
      );

      const dataUri = canvas.toDataURL('image/png');
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
      await setAvatar(base64);
      setBust((n) => n + 1);
      onChanged();
    } catch (e) {
      // A picture the user chose — its failure is theirs to see.
      setError(String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      await setAvatar('');
      setBust((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <img
        src={avatarSrc({ handle, hasAvatar, seed, size: 72, cacheBust: bust })}
        alt=""
        width={72}
        height={72}
        style={{
          borderRadius: 12, objectFit: 'cover', flexShrink: 0,
          border: `1px solid ${accent}55`,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button onClick={pick} disabled={busy} style={btn(accent, busy)}>
            {busy ? 'Working…' : hasAvatar ? 'Change picture' : 'Upload picture'}
          </button>
          {hasAvatar && (
            <button onClick={() => void clear()} disabled={busy} style={btnPlain(busy)}>
              Use identicon
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
          {hasAvatar
            ? 'PNG or JPEG. Cropped square and resized here before upload.'
            : 'Without one you get an identicon generated from your handle.'}
        </div>
        {error && <div style={{ fontSize: 10.5, color: '#fb7185' }}>{error}</div>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => void onFile(e.target.files?.[0])}
        style={{ display: 'none' }}
      />
    </div>
  );
}

const btn = (accent: string, disabled: boolean): React.CSSProperties => ({
  padding: '4px 11px', fontSize: 11, fontWeight: 600, borderRadius: 6,
  background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

const btnPlain = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 11px', fontSize: 11, fontWeight: 600, borderRadius: 6,
  background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,255,255,0.12)',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});
