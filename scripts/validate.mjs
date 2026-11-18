#!/usr/bin/env node
// Validates all .kzp extension packs under packs/ against the KizamuBeam pack format.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const packsDir = join(root, 'packs');
const MAX_BYTES = 20 * 1024 * 1024;
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

let count = 0;
if (existsSync(packsDir)) {
  for (const file of readdirSync(packsDir).sort()) {
    if (!file.endsWith('.kzp')) continue;
    const p = join(packsDir, file);
    const stat = statSync(p);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_BYTES) throw new Error(`${file}: exceeds ${MAX_BYTES} bytes`);

    const pack = JSON.parse(readFileSync(p, 'utf8'));
    if (pack.format !== 'kizamubeam-pack') throw new Error(`${file}: invalid format (expected "kizamubeam-pack")`);
    if (pack.formatVersion !== 1 && pack.formatVersion !== 2) throw new Error(`${file}: unsupported formatVersion ${pack.formatVersion}`);
    if (typeof pack.id !== 'string' || !ID_RE.test(pack.id)) throw new Error(`${file}: invalid pack id "${pack.id}"`);
    if (file !== `${pack.id}.kzp`) throw new Error(`${file}: filename must match id (${pack.id}.kzp)`);
    if (typeof pack.version !== 'string' || !pack.version.trim()) throw new Error(`${file}: missing version`);
    if (!pack.name || (typeof pack.name !== 'string' && typeof pack.name !== 'object')) throw new Error(`${file}: missing name`);
    for (const key of ['assets', 'templates', 'materials', 'devices']) {
      if (pack[key] !== undefined && !Array.isArray(pack[key])) throw new Error(`${file}: "${key}" must be an array`);
    }
    console.log(`ok  ${file} (v${pack.version})`);
    count++;
  }
}

console.log(`Validated ${count} pack(s).`);
