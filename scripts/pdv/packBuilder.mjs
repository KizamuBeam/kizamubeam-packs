// Build a validated KizamuBeam .kzp extension pack from a folder of SVGs (+ optional JSON sidecars).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { svgToKizamuAsset } from './svgToAsset.mjs';
import { slugifyTag } from './tags.mjs';

export const PACK_MAX_BYTES = 20 * 1024 * 1024;
export const PACK_ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

/** List subdirectories containing .svg files under a base motifs directory. */
export function listMotifFolders(motifsDir) {
  if (!existsSync(motifsDir)) return [];
  const folders = [];
  for (const entry of readdirSync(motifsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(motifsDir, entry.name);
    const svgs = readdirSync(full).filter((f) => extname(f).toLowerCase() === '.svg');
    if (svgs.length === 0) continue;
    folders.push({
      name: entry.name,
      path: full,
      svgCount: svgs.length,
    });
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

/** List all .svg entries in a folder with optional sidecar .json metadata. */
export function scanMotifFolder(folderPath) {
  if (!existsSync(folderPath)) return [];
  const files = readdirSync(folderPath).sort();
  const entries = [];
  for (const file of files) {
    if (extname(file).toLowerCase() !== '.svg') continue;
    const svgPath = join(folderPath, file);
    if (!statSync(svgPath).isFile()) continue;
    const base = basename(file, extname(file));
    const jsonPath = join(folderPath, `${base}.json`);
    let meta = null;
    if (existsSync(jsonPath)) {
      try {
        meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
      } catch {
        meta = null;
      }
    }
    const title = String(meta?.title || base.replace(/-\d+$/, '').replace(/-/g, ' ')).trim().slice(0, 80);
    const tags = Array.isArray(meta?.relevantTags) && meta.relevantTags.length
      ? meta.relevantTags
      : meta?.topicTag
        ? [meta.topicTag]
        : [];
    entries.push({
      file,
      base,
      svgPath,
      jsonPath: existsSync(jsonPath) ? jsonPath : null,
      title: title || base,
      tags,
      selected: true,
    });
  }
  return entries;
}

/** Build a .kzp pack object and write it to packsDir/<id>.kzp. */
export function buildPackFromEntries({
  entries,
  packId,
  name,
  description = '',
  version = '1.0.0',
  author = 'KizamuBeam Community',
  category = 'motif',
  targetMaxMm = 50,
  packsDir,
  onProgress = () => {},
}) {
  if (!PACK_ID_RE.test(packId)) {
    throw new Error(`Ungültige Pack-ID "${packId}" (z. B. org.kizamubeam.christmas)`);
  }
  if (!name || !String(name).trim()) {
    throw new Error('Paketname darf nicht leer sein');
  }
  if (!version || !String(version).trim()) {
    throw new Error('Version darf nicht leer sein');
  }

  const assets = [];
  const errors = [];
  const usedIds = new Set();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const svgText = readFileSync(entry.svgPath, 'utf8');
      const converted = svgToKizamuAsset(svgText, { targetMaxMm });
      let assetId = slugifyTag(entry.base).slice(0, 48);
      if (usedIds.has(assetId)) {
        let n = 2;
        while (usedIds.has(`${assetId}-${n}`)) n++;
        assetId = `${assetId}-${n}`;
      }
      usedIds.add(assetId);

      assets.push({
        id: assetId,
        name: String(entry.title).slice(0, 80),
        category,
        tags: entry.tags.slice(0, 20),
        w: converted.w,
        h: converted.h,
        objs: converted.objs,
      });
    } catch (err) {
      errors.push({ file: entry.file, error: err.message });
    }
    onProgress(i + 1, entries.length, entry);
  }

  if (assets.length === 0) {
    throw new Error('Kein einziges Motiv konnte konvertiert werden');
  }

  const pack = {
    format: 'kizamubeam-pack',
    formatVersion: 1,
    id: packId,
    version: String(version).trim(),
    minApp: '1.2.1-beta',
    name: String(name).trim().slice(0, 80),
    description: String(description || `${assets.length} KizamuBeam-Motive`).trim(),
    author: String(author).trim(),
    assets,
  };

  const jsonStr = JSON.stringify(pack, null, 2) + '\n';
  const bytes = Buffer.byteLength(jsonStr, 'utf8');
  if (bytes > PACK_MAX_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(2);
    throw new Error(`Paket überschreitet das 20-MB-Limit (${mb} MB). Bitte weniger Motive auswählen.`);
  }

  mkdirSync(packsDir, { recursive: true });
  const outPath = join(packsDir, `${packId}.kzp`);
  writeFileSync(outPath, jsonStr, 'utf8');

  return {
    outPath,
    bytes,
    assetCount: assets.length,
    errors,
  };
}
