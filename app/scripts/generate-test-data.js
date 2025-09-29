#!/usr/bin/env node
/*
  Generate test data directories and text files.

  Structure:
    <root>/<subjectPrefix><folderIndex>/<filePrefix><fileIndex>.txt

  Defaults:
    - folders: 10
    - files: 100
    - minSize: 1024 bytes (1 KiB)
    - maxSize: 98304 bytes (~96 KiB)
    - root: ./test-data
    - subjectPrefix: subject
    - filePrefix: file
    - ext: .txt
    - overwrite: false

  Examples (PowerShell):
    node ./app/scripts/generate-test-data.js --root .\test-data --folders 5 --files 20
    node ./app/scripts/generate-test-data.js --root C:\\temp\\s3-data --folders 100 --files 200 --minSize 2048 --maxSize 99000
*/

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function parseArgs(argv) {
  const args = {
    root: path.resolve(process.cwd(), 'test-data'),
    folders: 10,
    files: 100,
    minSize: 1024,
    maxSize: 98304,
    subjectPrefix: 'subject',
    filePrefix: 'file',
    ext: '.txt',
    overwrite: false,
    seed: undefined,
    content: undefined,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const isFlag = (v) => typeof v === 'string' && v.startsWith('-');
    switch (a) {
      case '-h':
      case '--help':
        return { ...args, help: true };
      case '--root':
        if (!next || isFlag(next)) throw new Error('--root requires a value');
        args.root = path.resolve(next);
        i++; break;
      case '--folders':
        if (!next || isFlag(next)) throw new Error('--folders requires a number');
        args.folders = Math.max(0, parseInt(next, 10));
        i++; break;
      case '--files':
        if (!next || isFlag(next)) throw new Error('--files requires a number');
        args.files = Math.max(0, parseInt(next, 10));
        i++; break;
      case '--minSize':
        if (!next || isFlag(next)) throw new Error('--minSize requires a number');
        args.minSize = Math.max(0, parseInt(next, 10));
        i++; break;
      case '--maxSize':
        if (!next || isFlag(next)) throw new Error('--maxSize requires a number');
        args.maxSize = Math.max(1, parseInt(next, 10));
        i++; break;
      case '--subjectPrefix':
        if (!next || isFlag(next)) throw new Error('--subjectPrefix requires a value');
        args.subjectPrefix = next;
        i++; break;
      case '--filePrefix':
        if (!next || isFlag(next)) throw new Error('--filePrefix requires a value');
        args.filePrefix = next;
        i++; break;
      case '--ext':
        if (!next || isFlag(next)) throw new Error('--ext requires a value');
        args.ext = next.startsWith('.') ? next : '.' + next;
        i++; break;
      case '--overwrite':
        args.overwrite = true; break;
      case '--seed':
        if (!next || isFlag(next)) throw new Error('--seed requires a number');
        args.seed = parseInt(next, 10);
        i++; break;
      case '--content':
        if (!next || isFlag(next)) throw new Error('--content requires a value');
        args.content = next; i++; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown flag ${a}`);
    }
  }

  if (args.maxSize >= 102400) {
    console.warn('[warn] maxSize capped to 102399 (<100 KiB)');
    args.maxSize = 102399;
  }
  if (args.minSize > args.maxSize) {
    [args.minSize, args.maxSize] = [args.maxSize, args.minSize];
  }

  return args;
}

function help() {
  console.log(`Usage: node app/scripts/generate-test-data.js [options]\n\nOptions:\n  --root <path>            Output root directory (default: ./test-data)\n  --folders <n>            Number of subject folders to create (default: 10)\n  --files <n>              Number of files per folder (default: 100)\n  --minSize <bytes>        Minimum file size in bytes (default: 1024)\n  --maxSize <bytes>        Maximum file size in bytes (<102400, default: 98304)\n  --subjectPrefix <str>    Folder prefix (default: subject)\n  --filePrefix <str>       File name prefix (default: file)\n  --ext <.ext>             File extension (default: .txt)\n  --overwrite              Overwrite existing files (default: skip)\n  --seed <n>               Seed for pseudo-random generator\n  --content <str>          Fixed content to repeat in files\n  -h, --help               Show this help\n\nExamples:\n  node app/scripts/generate-test-data.js --root .\\test-data --folders 5 --files 20\n  node app/scripts/generate-test-data.js --root C:\\temp\\s3-data --folders 100 --files 200 --minSize 2048 --maxSize 99000`);
}

function mulberry32(a) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function pickSize(rand, min, max) {
  const r = rand();
  return Math.floor(min + r * (max - min + 1));
}

function buildContent(targetBytes, header, bodyText) {
  const lines = [];
  const base = (header + '\n\n');
  let total = Buffer.byteLength(base);
  lines.push(base);
  const payload = (bodyText || DEFAULT_TEXT);
  // Repeat payload lines until reaching targetBytes
  while (total < targetBytes) {
    const line = payload + '\n';
    const len = Buffer.byteLength(line);
    if (total + len > targetBytes) {
      // Truncate last line to fit under targetBytes
      const remaining = targetBytes - total;
      lines.push(line.slice(0, Math.max(0, remaining)));
      total = targetBytes;
      break;
    }
    lines.push(line);
    total += len;
  }
  return lines.join('');
}

const DEFAULT_TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error('[error]', err.message);
    return process.exit(1);
  }
  if (args.help) { help(); return; }

  const rand = args.seed != null ? mulberry32(args.seed >>> 0) : Math.random;

  const widthFolders = Math.max(4, String(args.folders).length);
  const widthFiles = Math.max(4, String(args.files).length);

  const root = args.root;
  await ensureDir(root);

  console.log(`[info] Writing test data to: ${root}`);
  console.log(`[info] Folders: ${args.folders}, Files/folder: ${args.files}, Size: ${args.minSize}-${args.maxSize} bytes`);
  console.log(`[info] Overwrite: ${args.overwrite ? 'yes' : 'no'}`);

  let created = 0, skipped = 0, overwritten = 0;

  for (let i = 1; i <= args.folders; i++) {
    const folderName = `${args.subjectPrefix}${pad(i, widthFolders)}`;
    const folderPath = path.join(root, folderName);
    await ensureDir(folderPath);

    for (let j = 1; j <= args.files; j++) {
      const fileName = `${args.filePrefix}${pad(j, widthFiles)}${args.ext}`;
      const filePath = path.join(folderPath, fileName);

      const exists = fs.existsSync(filePath);
      if (exists && !args.overwrite) { skipped++; continue; }

      const size = pickSize(rand, args.minSize, args.maxSize);
      const header = `Subject: ${folderName}\nFile: ${fileName}\nGenerated: ${new Date().toISOString()}\nSizeTarget: ${size} bytes`;
      const content = buildContent(size, header, args.content);

      await fsp.writeFile(filePath, content, 'utf8');
      if (exists) overwritten++; else created++;
    }
  }

  console.log(`[done] Created: ${created}, Overwritten: ${overwritten}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
