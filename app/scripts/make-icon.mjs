// Generate a 32x32 ICO with a solid mint accent and a darker rim.
// Just enough for tauri-build to embed a Windows resource — replace with
// real branding via `cargo tauri icon path/to/source.png` later.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const W = 32, H = 32;
const accent = [0xd4, 0xf5, 0x7c, 0xff]; // BGRA
const rim    = [0x10, 0x40, 0x35, 0xff];
const transparent = [0, 0, 0, 0];

// 32-bpp DIB pixels are stored bottom-up.
const pixels = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - W / 2 + 0.5, dy = y - H / 2 + 0.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const inside = r < W / 2 - 0.5;
    const ringEdge = r > W / 2 - 2.5 && r < W / 2 - 0.5;
    const c = !inside ? transparent : ringEdge ? rim : accent;
    const yy = H - 1 - y;
    const off = (yy * W + x) * 4;
    pixels[off + 0] = c[0];
    pixels[off + 1] = c[1];
    pixels[off + 2] = c[2];
    pixels[off + 3] = c[3];
  }
}

const andMask = Buffer.alloc((W * H) / 8, 0); // all visible (alpha already does it)

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);                    // header size
bmpHeader.writeInt32LE(W, 4);                      // width
bmpHeader.writeInt32LE(H * 2, 8);                  // height (image + mask)
bmpHeader.writeUInt16LE(1, 12);                    // planes
bmpHeader.writeUInt16LE(32, 14);                   // bit count
bmpHeader.writeUInt32LE(0, 16);                    // compression
bmpHeader.writeUInt32LE(0, 20);                    // image size
// remaining fields zero by default

const imageData = Buffer.concat([bmpHeader, pixels, andMask]);

const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0);   // reserved
icondir.writeUInt16LE(1, 2);   // type = icon
icondir.writeUInt16LE(1, 4);   // count

const entry = Buffer.alloc(16);
entry.writeUInt8(W, 0);
entry.writeUInt8(H, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(imageData.length, 8);
entry.writeUInt32LE(6 + 16, 12);

const ico = Buffer.concat([icondir, entry, imageData]);

const out = process.argv[2] || 'src-tauri/icons/icon.ico';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, ico);
console.log(`wrote ${out} (${ico.length} bytes)`);
