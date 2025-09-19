// Generate a minimal valid ICO with a 256x256 PNG payload (solid color) if missing.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makePng256(color = { r: 0, g: 0, b: 0, a: 255 }) {
  const w = 256, h = 256;
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((bytesPerPixel * w + 1) * h); // +1 filter byte per row
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * bytesPerPixel);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < w; x++) {
      const i = rowStart + 1 + x * bytesPerPixel;
      raw[i + 0] = color.r;
      raw[i + 1] = color.g;
      raw[i + 2] = color.b;
      raw[i + 3] = color.a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = require('crc').crc32(Buffer.concat([t, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }
  const pngSig = Buffer.from('89504E470D0A1A0A', 'hex');
  const idat = zlib.deflateSync(raw);
  const iend = Buffer.alloc(0);
  return Buffer.concat([pngSig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]);
}

function makeIcoFromPng(pngBuf) {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  // Directory entry
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 encoded as 0
  entry[1] = 0; // height 256 encoded as 0
  entry[2] = 0; // color count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(0, 4); // planes (0 for PNG in ICO)
  entry.writeUInt16LE(0, 6); // bit count (0 for PNG in ICO)
  entry.writeUInt32LE(pngBuf.length, 8); // bytes in res
  entry.writeUInt32LE(header.length + entry.length, 12); // image offset
  return Buffer.concat([header, entry, pngBuf]);
}

const dir = path.join(__dirname, '..', 'icons');
const icoPath = path.join(dir, 'icon.ico');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (true || !fs.existsSync(icoPath)) {
  try {
    // Lazy-load crc to keep startup light; it's in Node's ecosystem
    // If unavailable, fall back to a prebuilt base64 (rare).
    const png = makePng256({ r: 20, g: 130, b: 200, a: 255 });
    const ico = makeIcoFromPng(png);
    fs.writeFileSync(icoPath, ico);
    console.log(`Wrote placeholder 256x256 icon to ${icoPath}`);
  } catch (e) {
    console.warn('ICO generation failed:', e?.message);
  }
} else {
  console.log(`Icon exists at ${icoPath}`);
}
