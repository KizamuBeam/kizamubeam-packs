// End-to-end motif download, AI/EPS -> SVG conversion, B&W check, and tag-folder sorting.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertVectorToSvgText, extractVectorFromBuffer } from './convert.mjs';
import { parseDetailPage } from './scraper.mjs';
import { analyzeSvg } from './svg.mjs';
import { buildIgnoreSet, filterRelevantTags, pickPrimaryTopicTag, slugifyTag } from './tags.mjs';

export async function processMotif({
  item,
  client,
  converters,
  outputDir,
  ignoreSet = buildIgnoreSet(),
  bwOnly = true,
  overwrite = false,
  onLog = () => {},
}) {
  onLog(`Lade Detailseite: ${item.title} (#${item.id}) …`);
  const detailHtml = await client.fetchHtml(item.url);
  const detail = parseDetailPage(detailHtml, item.url);

  if (!detail.preferredDownload) {
    throw new Error(`Kein Download-Link auf Detailseite gefunden (#${detail.id})`);
  }

  const topicTag = pickPrimaryTopicTag({
    tags: detail.tags,
    title: detail.title,
    category: detail.category,
    ignoreSet,
  });
  const relevantTags = filterRelevantTags(detail.tags, ignoreSet);
  const fileSlug = `${slugifyTag(detail.title).slice(0, 60)}-${detail.id}`;
  const targetDir = join(outputDir, topicTag);
  const targetSvg = join(targetDir, `${fileSlug}.svg`);
  const targetMeta = join(targetDir, `${fileSlug}.json`);

  if (!overwrite && existsSync(targetSvg)) {
    onLog(`Übersprungen (bereits vorhanden): ${topicTag}/${fileSlug}.svg`);
    return { status: 'skipped', reason: 'Bereits vorhanden', topicTag, targetSvg, detail };
  }

  onLog(`Lade Datei (${detail.preferredDownload.format}): ${detail.preferredDownload.url}`);
  const { buffer } = await client.fetchBuffer(detail.preferredDownload.url);

  const fallbackExt =
    detail.preferredDownload.format === 'EPS'
      ? '.eps'
      : detail.preferredDownload.format === 'AI'
        ? '.ai'
        : '.svg';

  const extracted = await extractVectorFromBuffer(buffer, fallbackExt);
  let svgText;
  let convertedFrom = null;

  try {
    if (extracted.ext === '.svg') {
      svgText = readFileSync(extracted.filePath, 'utf8');
    } else {
      convertedFrom = extracted.ext.replace('.', '').toUpperCase();
      onLog(`Konvertiere ${convertedFrom} → SVG (${converters.mode}) …`);
      svgText = await convertVectorToSvgText(extracted.filePath, converters);
    }
  } finally {
    extracted.cleanup();
  }

  const analysis = analyzeSvg(svgText);
  if (!analysis.valid) {
    throw new Error(analysis.reason || 'Ungültige SVG-Ausgabe');
  }
  if (bwOnly && !analysis.isMonochrome) {
    onLog(`Verworfen (nicht S/W): ${detail.title} – ${analysis.reason}`);
    return {
      status: 'filtered',
      reason: analysis.reason,
      topicTag,
      detail,
      analysis,
    };
  }

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetSvg, svgText, 'utf8');
  writeFileSync(
    targetMeta,
    JSON.stringify(
      {
        id: detail.id,
        title: detail.title,
        sourceUrl: detail.url,
        license: 'CC0-1.0',
        category: detail.category,
        topicTag,
        relevantTags,
        allTags: detail.tags,
        originalFormats: detail.formats,
        convertedFrom,
        monochrome: analysis.isMonochrome,
        shapeCount: analysis.shapeCount,
        downloadedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  onLog(`Gespeichert: ${topicTag}/${fileSlug}.svg (${analysis.shapeCount} Pfade)`);
  return {
    status: 'saved',
    topicTag,
    targetSvg,
    targetMeta,
    convertedFrom,
    detail,
    analysis,
  };
}
