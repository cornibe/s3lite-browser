// Generate a simple shared icon (PNG + ICO) with "S3" block text for both platforms.
// Mac .icns is produced in CI from the PNG; Windows uses the ICO directly.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crc = require('crc');

function makePng(size = 1024) {
  const w = size, h = size;
  const bytesPerPixel = 4;
  const bg = { r: 9, g: 30, b: 66, a: 255 }; // dark navy
  const fg = { r: 232, g: 244, b: 255, a: 255 }; // light text
  const accent = { r: 55, g: 143, b: 232, a: 255 }; // accent stripe

  const raw = Buffer.alloc((bytesPerPixel * w + 1) * h);

  // Fill background
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * bytesPerPixel);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      const i = rowStart + 1 + x * bytesPerPixel;
      raw[i + 0] = bg.r;
      raw[i + 1] = bg.g;
      raw[i + 2] = bg.b;
      raw[i + 3] = bg.a;
    }
  }

  // Helper to fill a rectangle
  function fillRect(x0, y0, x1, y1, color) {
    const xs = Math.max(0, Math.floor(x0));
    const xe = Math.min(w, Math.ceil(x1));
    const ys = Math.max(0, Math.floor(y0));
    const ye = Math.min(h, Math.ceil(y1));
    for (let y = ys; y < ye; y++) {
      const rowStart = y * (1 + w * bytesPerPixel);
      for (let x = xs; x < xe; x++) {
        const i = rowStart + 1 + x * bytesPerPixel;
        raw[i + 0] = color.r;
        raw[i + 1] = color.g;
        raw[i + 2] = color.b;
        raw[i + 3] = color.a;
      }
    }
  }

  // Draw a simple block font for "S3" on a grid.
  const grid = [
    ' ######   ###### ',
    '#      # #      #',
    '#        #      #',
    '#        #      #',
    ' ######   ###### ',
    '#        #      #',
    '#        #      #',
    '#      # #      #',
    ' ######   ###### ',
  ];

  const cell = Math.floor(Math.min(w * 0.9 / grid[0].length, h * 0.6 / grid.length));
  const startX = Math.floor((w - cell * grid[0].length) / 2);
  const startY = Math.floor((h - cell * grid.length) / 2);

  grid.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== ' ') {
        fillRect(startX + c * cell, startY + r * cell, startX + (c + 1) * cell, startY + (r + 1) * cell, fg);
      }
    });
  });

  // Accent bar at bottom
  fillRect(0, h * 0.85, w, h, accent);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc.crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const pngSig = Buffer.from('89504E470D0A1A0A', 'hex');
  const idat = zlib.deflateSync(raw);
  const iend = Buffer.alloc(0);
  return Buffer.concat([pngSig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]);
}

function makeIcoFromPng(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256px encoded as 0
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(0, 4);
  entry.writeUInt16LE(0, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, pngBuf]);
}

const dir = path.join(__dirname, '..', 'icons');
const pngPath = path.join(dir, 'icon.png');
const icoPath = path.join(dir, 'icon.ico');

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

try {
  const png = makePng(1024);
  fs.writeFileSync(pngPath, png);
  console.log(`Wrote ${pngPath}`);

  const ico = makeIcoFromPng(png);
  fs.writeFileSync(icoPath, ico);
  console.log(`Wrote ${icoPath}`);
} catch (e) {
  console.warn('Icon generation failed:', e?.message);
}
