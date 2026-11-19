#!/usr/bin/env node
// Builds catalog.json (compatible with KizamuBeam src/catalog.ts) from packs/*.kzp
// and signs it with Ed25519 when PACKS_SIGNING_KEY (64-char hex seed) is set.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, '_site'));
const packsDir = join(root, 'packs');
const CATALOG_FORMAT = 'kizamubeam-catalog';

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function signEd25519(data, seedHex) {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(seedHex.toLowerCase(), 'hex'),
  ]);
  const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return sign(null, data, priv);
}

const files = existsSync(packsDir)
  ? readdirSync(packsDir).filter((f) => f.endsWith('.kzp')).sort()
  : [];

const entries = [];
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const srcPath = join(packsDir, file);
  const text = readFileSync(srcPath, 'utf8');
  const raw = JSON.parse(text);
  if (raw.format !== 'kizamubeam-pack') {
    throw new Error(`${file}: invalid format "${raw.format}"`);
  }
  if (file !== `${raw.id}.kzp`) {
    throw new Error(`${file}: filename must match id (${raw.id}.kzp)`);
  }
  const devices = Array.isArray(raw.devices) ? raw.devices.length : 0;
  const templates = Array.isArray(raw.templates) ? raw.templates.length : 0;
  const materials = Array.isArray(raw.materials) ? raw.materials.length : 0;
  const assets = Array.isArray(raw.assets) ? raw.assets.length : 0;
  const plugins = Array.isArray(raw.plugins) ? raw.plugins.length : 0;

  entries.push({
    id: raw.id,
    version: raw.version,
    ...(raw.minApp ? { minApp: raw.minApp } : {}),
    name: raw.name,
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.author ? { author: raw.author } : {}),
    ...(raw.homepage ? { homepage: raw.homepage } : {}),
    devices,
    templates,
    materials,
    assets,
    plugins,
    file,
    sha256: sha256Hex(text),
    size: Buffer.byteLength(text, 'utf8'),
  });

  copyFileSync(srcPath, join(outDir, file));
}

const catalogJson =
  JSON.stringify(
    {
      format: CATALOG_FORMAT,
      version: 1,
      generated: new Date().toISOString(),
      packs: entries,
    },
    null,
    1,
  ) + '\n';

const catalogPath = join(outDir, 'catalog.json');
writeFileSync(catalogPath, catalogJson, 'utf8');
console.log(`Built catalog.json with ${entries.length} pack(s) in ${outDir}`);

const key = (process.env.PACKS_SIGNING_KEY ?? '').trim();
if (/^[0-9a-f]{64}$/i.test(key)) {
  const sig = signEd25519(Buffer.from(catalogJson, 'utf8'), key);
  writeFileSync(`${catalogPath}.sig`, sig.toString('base64') + '\n', 'utf8');
  console.log(`Signed ${catalogPath}.sig`);
} else {
  console.log('::warning::PACKS_SIGNING_KEY not set or invalid – catalog.json left unsigned.');
}
