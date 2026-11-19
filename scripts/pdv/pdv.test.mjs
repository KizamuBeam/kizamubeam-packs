import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectConverters, extractVectorFromBuffer, sniffBufferType } from './convert.mjs';
import { buildPackFromEntries, scanMotifFolder } from './packBuilder.mjs';
import { processMotif } from './pipeline.mjs';
import { buildSearchUrl, parseDetailPage, parseListingPage } from './scraper.mjs';
import { analyzeSvg } from './svg.mjs';
import { svgToKizamuAsset } from './svgToAsset.mjs';
import { buildIgnoreSet, filterRelevantTags, pickPrimaryTopicTag } from './tags.mjs';

test('tags: ignores silhouette, black and white, outline, ornament and picks decisive topic tag', () => {
  const tags = ['silhouette', 'Black and White', 'outline', 'ornament', 'cat', 'animal', 'clipart'];
  const relevant = filterRelevantTags(tags);
  assert.deepEqual(relevant, ['cat', 'animal']);

  const topic = pickPrimaryTopicTag({
    tags,
    title: 'Stretching Black Cat Vector Silhouette',
    category: 'Animals',
  });
  assert.equal(topic, 'cat');
});

test('tags: supports custom extra ignored tags and falls back to category', () => {
  const ignoreSet = buildIgnoreSet(['animal', 'pet']);
  const topic = pickPrimaryTopicTag({
    tags: ['silhouette', 'animal', 'pet', 'outline'],
    title: 'Animal Silhouette',
    category: 'Wildlife',
    ignoreSet,
  });
  assert.equal(topic, 'wildlife');
});

test('svg: accepts monochrome black/white/grayscale SVGs and rejects colored/gradient/raster SVGs', () => {
  const monoSvg = `<svg viewBox="0 0 100 100"><path d="M0 0h10v10z" fill="#000000" stroke="white"/><rect style="fill: rgb(120, 120, 120);" width="5" height="5"/></svg>`;
  const monoRes = analyzeSvg(monoSvg);
  assert.equal(monoRes.valid, true);
  assert.equal(monoRes.isMonochrome, true);
  assert.equal(monoRes.shapeCount, 2);

  const colorSvg = `<svg viewBox="0 0 100 100"><path d="M0 0h10v10z" fill="#ff3300"/></svg>`;
  const colorRes = analyzeSvg(colorSvg);
  assert.equal(colorRes.valid, true);
  assert.equal(colorRes.isMonochrome, false);
  assert.deepEqual(colorRes.nonMonoColors, ['#ff3300']);

  const gradSvg = `<svg><defs><linearGradient id="g"/></defs><path d="M0 0" fill="url(#g)"/></svg>`;
  assert.equal(analyzeSvg(gradSvg).isMonochrome, false);

  const imgSvg = `<svg><image href="data:image/png;base64,AAA"/></svg>`;
  assert.equal(analyzeSvg(imgSvg).isMonochrome, false);
});

test('scraper: buildSearchUrl handles queries, tags, pages and type filters', () => {
  assert.equal(
    buildSearchUrl('black cat', { page: 2, type: 'SVG' }),
    'https://publicdomainvectors.org/search?lang=en&q=black+cat&page=2&type=svg',
  );
  assert.equal(
    buildSearchUrl('tag:Animals', { page: 1, type: 'ALL' }),
    'https://publicdomainvectors.org/en/tag/animals',
  );
});

test('scraper: parseListingPage and parseDetailPage extract items, tags and ignore Adobe Stock links', () => {
  const listingHtml = `
    <div class="vector-item">
      <a href="/en/free-clipart/Stretching-Black-Cat-Vector/12345.html">Stretching Black Cat Vector</a>
      <span>SVG • Public Domain</span>
    </div>
    <div class="vector-item">
      <a href="/en/free-clipart/Oak-Tree-Outline/67890.html">Oak Tree Outline</a>
      <span>AI,EPS • Public Domain</span>
    </div>
    <div class="pagination"><a href="?page=2">2</a> <a href="?page=12">12</a></div>
  `;
  const listing = parseListingPage(listingHtml, 'https://publicdomainvectors.org', 1);
  assert.equal(listing.items.length, 2);
  assert.equal(listing.maxPage, 12);
  assert.equal(listing.hasNextPage, true);
  assert.equal(listing.items[0].id, '12345');
  assert.deepEqual(listing.items[0].formats, ['SVG']);
  assert.equal(listing.items[1].id, '67890');
  assert.deepEqual(listing.items[1].formats, ['AI', 'EPS']);

  const detailHtml = `
    <h1>Stretching Black Cat Vector</h1>
    <a href="https://adobe.prf.hn/click/camref:123">Download Adobe Stock</a>
    <a href="/en/download/12345.svg">Download SVG</a>
    <div>Categories <a href="/en/free-clipart/animals">Animals</a></div>
    <div>Tags
      <a href="/en/tag/silhouette">silhouette</a>
      <a href="/en/tag/black-and-white">black and white</a>
      <a href="/en/tag/cat">cat</a>
      <a href="/en/tag/feline">feline</a>
    </div>
  `;
  const detail = parseDetailPage(
    detailHtml,
    'https://publicdomainvectors.org/en/free-clipart/Stretching-Black-Cat-Vector/12345.html',
  );
  assert.equal(detail.id, '12345');
  assert.equal(detail.category, 'Animals');
  assert.deepEqual(detail.tags, ['silhouette', 'black and white', 'cat', 'feline']);
  assert.equal(detail.preferredDownload?.url, 'https://publicdomainvectors.org/en/download/12345.svg');
  assert.equal(detail.preferredDownload?.format, 'SVG');
});

test('convert: detectConverters and extractVectorFromBuffer work for SVG', async () => {
  const tools = await detectConverters();
  assert.equal(typeof tools.inkscape, 'boolean');
  assert.equal(typeof tools.gs, 'boolean');
  assert.equal(typeof tools.pdftocairo, 'boolean');

  assert.equal(sniffBufferType(Buffer.from('%PDF-1.5\n')), 'pdf');
  assert.equal(sniffBufferType(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n')), 'eps');
  assert.equal(sniffBufferType(Buffer.from('<!DOCTYPE html><html></html>')), 'html');
  assert.equal(sniffBufferType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');

  await assert.rejects(
    () => extractVectorFromBuffer(Buffer.from('<!DOCTYPE html><html><body>Wait</body></html>'), '.eps', 'text/html'),
    /Download lieferte HTML/,
  );

  const extracted = await extractVectorFromBuffer(Buffer.from('<svg></svg>'), '.eps');
  try {
    assert.equal(extracted.ext, '.svg');
    assert.equal(existsSync(extracted.filePath), true);
  } finally {
    extracted.cleanup();
  }
});

test('pipeline: processMotif sorts monochrome SVG into decisive topic-tag folder and filters colored SVG', async () => {
  const tmpOut = mkdtempSync(join(tmpdir(), 'pdv-out-'));
  try {
    const monoSvg = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="#000"/></svg>';
    const colorSvg = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="#00ff00"/></svg>';

    const mockClient = {
      async fetchHtml(url) {
        if (url.includes('111.html')) {
          return `
            <h1>Oak Tree Silhouette</h1>
            <a href="/en/download/111.svg">Download SVG</a>
            <div>Tags <a href="/en/tag/silhouette">silhouette</a> <a href="/en/tag/oak">oak</a> <a href="/en/tag/outline">outline</a></div>
          `;
        }
        return `
          <h1>Green Frog</h1>
          <a href="/en/download/222.svg">Download SVG</a>
          <div>Tags <a href="/en/tag/frog">frog</a></div>
        `;
      },
      async fetchBuffer(url) {
        return {
          buffer: Buffer.from(url.includes('111.svg') ? monoSvg : colorSvg),
          contentType: 'image/svg+xml',
          finalUrl: url,
        };
      },
    };

    const res1 = await processMotif({
      item: { id: '111', title: 'Oak Tree Silhouette', url: 'https://publicdomainvectors.org/en/free-clipart/Oak-Tree/111.html' },
      client: mockClient,
      converters: { mode: 'none' },
      outputDir: tmpOut,
      folderName: 'christmas',
      bwOnly: true,
    });
    assert.equal(res1.status, 'saved');
    assert.equal(res1.topicTag, 'oak');
    assert.equal(res1.targetFolder, 'christmas');
    assert.equal(res1.targetSvg.includes(`${join('christmas', 'oak-tree-silhouette-111.svg')}`), true);
    assert.equal(existsSync(res1.targetSvg), true);
    const meta = JSON.parse(readFileSync(res1.targetMeta, 'utf8'));
    assert.equal(meta.topicTag, 'oak');
    assert.deepEqual(meta.relevantTags, ['oak']);

    const res2 = await processMotif({
      item: { id: '222', title: 'Green Frog', url: 'https://publicdomainvectors.org/en/free-clipart/Green-Frog/222.html' },
      client: mockClient,
      converters: { mode: 'none' },
      outputDir: tmpOut,
      bwOnly: true,
    });
    assert.equal(res2.status, 'filtered');
  } finally {
    rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('svgToAsset & packBuilder: converts SVG paths/shapes and builds a valid .kzp pack', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const svg = `
    <svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(10, 5)">
        <path d="M0 0 L40 0 C50 0 50 20 40 20 Z" />
        <circle cx="20" cy="20" r="10" />
      </g>
    </svg>
  `;
  const asset = svgToKizamuAsset(svg, { targetMaxMm: 50 });
  assert.equal(asset.w, 50);
  assert.ok(asset.h > 0 && asset.h <= 50);
  assert.equal(asset.objs.length, 1);
  assert.equal(asset.objs[0].shape.kind, 'path');
  assert.equal(asset.objs[0].shape.subs.length, 2);
  assert.equal(asset.objs[0].shape.subs[0].closed, true);

  const tmpRoot = mkdtempSync(join(tmpdir(), 'pdv-pack-'));
  try {
    const motifDir = join(tmpRoot, 'christmas');
    const packsDir = join(tmpRoot, 'packs');
    mkdirSync(motifDir, { recursive: true });
    writeFileSync(join(motifDir, 'star-101.svg'), svg, 'utf8');
    writeFileSync(
      join(motifDir, 'star-101.json'),
      JSON.stringify({ title: 'Christmas Star', relevantTags: ['star', 'christmas'] }),
      'utf8',
    );

    const entries = scanMotifFolder(motifDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Christmas Star');

    const built = buildPackFromEntries({
      entries,
      packId: 'org.kizamubeam.christmas',
      name: 'Christmas Motifs',
      version: '1.0.0',
      packsDir,
    });
    assert.equal(built.assetCount, 1);
    assert.equal(existsSync(built.outPath), true);
    const pack = JSON.parse(readFileSync(built.outPath, 'utf8'));
    assert.equal(pack.format, 'kizamubeam-pack');
    assert.equal(pack.id, 'org.kizamubeam.christmas');
    assert.equal(pack.assets[0].name, 'Christmas Star');
    assert.deepEqual(pack.assets[0].tags, ['star', 'christmas']);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
