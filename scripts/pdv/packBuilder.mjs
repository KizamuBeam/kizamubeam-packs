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
  autoSplit = false,
  maxPackBytes = 18 * 1024 * 1024,
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

  const effectiveLimit = Math.min(PACK_MAX_BYTES, Math.max(1024, maxPackBytes));
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

  // Serialize each asset individually (compact JSON, like KizamuBeam's assetJson) to avoid V8 string-length overflow
  const assetChunks = assets.map((a) => {
    const json = JSON.stringify(a);
    return { id: a.id, name: a.name, json, bytes: Buffer.byteLength(json, 'utf8') };
  });

  const makeHeader = (id, partName, count) => {
    const headerJson = JSON.stringify({
      format: 'kizamubeam-pack',
      formatVersion: 1,
      id,
      version: String(version).trim(),
      minApp: '1.2.1-beta',
      name: String(partName).trim().slice(0, 80),
      description: String(description || `${count} KizamuBeam-Motive`).trim(),
      author: String(author).trim(),
    });
    return {
      prefix: `${headerJson.slice(0, -1)},"assets":[`,
      suffix: ']}\n',
    };
  };

  const singleHeader = makeHeader(packId, name, assets.length);
  const singleTotalBytes =
    Buffer.byteLength(singleHeader.prefix, 'utf8') +
    Buffer.byteLength(singleHeader.suffix, 'utf8') +
    assetChunks.reduce((sum, c, idx) => sum + c.bytes + (idx > 0 ? 1 : 0), 0);

  if (singleTotalBytes <= PACK_MAX_BYTES && !autoSplit) {
    mkdirSync(packsDir, { recursive: true });
    const outPath = join(packsDir, `${packId}.kzp`);
    writeFileSync(
      outPath,
      `${singleHeader.prefix}${assetChunks.map((c) => c.json).join(',')}${singleHeader.suffix}`,
      'utf8',
    );
    return {
      outPath,
      bytes: singleTotalBytes,
      assetCount: assets.length,
      parts: [{ outPath, packId, bytes: singleTotalBytes, assetCount: assets.length }],
      errors,
    };
  }

  // Partition into <= effectiveLimit parts
  const groups = [];
  let curGroup = [];
  let curBytes = 512; // header overhead estimate

  for (const chunk of assetChunks) {
    if (chunk.bytes + 1024 > PACK_MAX_BYTES) {
      errors.push({
        file: chunk.name,
        error: `Einzelmotiv überschreitet 20-MB-Limit (${(chunk.bytes / 1024 / 1024).toFixed(1)} MB)`,
      });
      continue;
    }
    const addedBytes = chunk.bytes + (curGroup.length > 0 ? 1 : 0);
    if (curGroup.length > 0 && curBytes + addedBytes > effectiveLimit) {
      groups.push(curGroup);
      curGroup = [chunk];
      curBytes = 512 + chunk.bytes;
    } else {
      curGroup.push(chunk);
      curBytes += addedBytes;
    }
  }
  if (curGroup.length > 0) groups.push(curGroup);

  if (!autoSplit && singleTotalBytes > PACK_MAX_BYTES) {
    const mb = (singleTotalBytes / 1024 / 1024).toFixed(2);
    const err = new Error(
      `Paket überschreitet 20-MB-Limit (${mb} MB bei ${assets.length} Motiven) – aufteilbar in ${groups.length} Pakete.`,
    );
    err.code = 'PACK_TOO_LARGE';
    err.totalBytes = singleTotalBytes;
    err.suggestedParts = groups.length;
    throw err;
  }

  if (groups.length === 0) {
    throw new Error('Alle Motive überschreiten einzeln das 20-MB-Limit');
  }

  mkdirSync(packsDir, { recursive: true });
  const parts = [];
  for (let idx = 0; idx < groups.length; idx++) {
    const partNum = idx + 1;
    const partId = groups.length === 1 ? packId : `${packId}-${partNum}`;
    const partName = groups.length === 1 ? name : `${String(name).trim().slice(0, 70)} (${partNum}/${groups.length})`;
    const g = groups[idx];
    const h = makeHeader(partId, partName, g.length);
    const content = `${h.prefix}${g.map((c) => c.json).join(',')}${h.suffix}`;
    const bytes = Buffer.byteLength(content, 'utf8');
    const outPath = join(packsDir, `${partId}.kzp`);
    writeFileSync(outPath, content, 'utf8');
    parts.push({ outPath, packId: partId, bytes, assetCount: g.length });
  }

  return {
    outPath: parts[0].outPath,
    bytes: parts.reduce((s, p) => s + p.bytes, 0),
    assetCount: parts.reduce((s, p) => s + p.assetCount, 0),
    parts,
    errors,
  };
}
