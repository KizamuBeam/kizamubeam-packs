// Tag filtering and decisive topic-tag selection for PublicDomainVectors motifs.

export const DEFAULT_IGNORED_TAGS = [
  'silhouette',
  'silhouettes',
  'black and white',
  'black-and-white',
  'black & white',
  'b&w',
  'bw',
  'monochrome',
  'grayscale',
  'greyscale',
  'outline',
  'outlines',
  'line art',
  'lineart',
  'contour',
  'ornament',
  'ornaments',
  'ornamental',
  'decorative',
  'decoration',
  // Generic format / source / style noise tags on publicdomainvectors.org
  'clipart',
  'clip art',
  'clip-art',
  'vector',
  'vectors',
  'vector graphics',
  'vector image',
  'vector illustration',
  'graphics',
  'graphic',
  'illustration',
  'drawing',
  'image',
  'icon',
  'icons',
  'symbol',
  'symbols',
  'sign',
  'signs',
  'svg',
  'ai',
  'eps',
  'public domain',
  'publicdomain',
  'cc0',
  'free',
  'openclipart',
  'ocal',
  'externalsource',
  'black',
  'white',
  'simple',
  'flat',
  'isolated',
  'template',
  'design',
  'art',
];

/** Normalize a tag for comparison (lowercase, collapsed whitespace/hyphens). */
export function normalizeTag(tag) {
  return String(tag ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Convert a tag into a safe folder slug. */
export function slugifyTag(tag) {
  const slug = String(tag ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'uncategorized';
}

/** Build a normalized Set of ignored tags. */
export function buildIgnoreSet(extraIgnored = [], baseIgnored = DEFAULT_IGNORED_TAGS) {
  const set = new Set();
  for (const t of baseIgnored) {
    const n = normalizeTag(t);
    if (n) set.add(n);
  }
  for (const t of extraIgnored) {
    const n = normalizeTag(t);
    if (n) set.add(n);
  }
  return set;
}

/**
 * Filter out irrelevant tags (e.g. silhouette, black and white, outline, ornament).
 * Returns deduplicated original-trimmed tags in priority order.
 */
export function filterRelevantTags(tags, ignoreSet = buildIgnoreSet()) {
  const seen = new Set();
  const out = [];
  for (const raw of tags ?? []) {
    const trimmed = String(raw ?? '').trim();
    const norm = normalizeTag(trimmed);
    if (!norm || norm.length < 2) continue;
    if (ignoreSet.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(trimmed);
  }
  return out;
}

/**
 * Pick the single most decisive topic tag that describes the motif's subject.
 *
 * Strategy:
 * 1. Filter out all ignored tags (silhouette, black and white, outline, ornament, etc.).
 * 2. If a title is given, prefer tags whose normalized form appears in the title
 *    (longest match first, as title words usually name the actual subject, e.g. "cat", "oak tree").
 * 3. Otherwise prefer single-word or concise descriptive tags over overly long multi-word tags,
 *    falling back to the site category (if not ignored), or "uncategorized".
 */
export function pickPrimaryTopicTag({
  tags = [],
  title = '',
  category = '',
  ignoreSet = buildIgnoreSet(),
} = {}) {
  const relevant = filterRelevantTags(tags, ignoreSet);
  const normTitle = normalizeTag(title);

  if (relevant.length > 0) {
    if (normTitle) {
      const titleTokens = new Set(normTitle.split(' '));
      const inTitle = relevant
        .map((tag, idx) => {
          const norm = normalizeTag(tag);
          const words = norm.split(' ');
          const exactPhrase = normTitle.includes(norm);
          const tokenHits = words.filter((w) => titleTokens.has(w)).length;
          return { tag, idx, norm, exactPhrase, tokenHits };
        })
        .filter((x) => x.exactPhrase || x.tokenHits > 0)
        .sort((a, b) => {
          if (a.exactPhrase !== b.exactPhrase) return a.exactPhrase ? -1 : 1;
          if (a.tokenHits !== b.tokenHits) return b.tokenHits - a.tokenHits;
          if (a.norm.length !== b.norm.length) return b.norm.length - a.norm.length;
          return a.idx - b.idx;
        });

      if (inTitle.length > 0) {
        return slugifyTag(inTitle[0].tag);
      }
    }

    // Prefer concise subject tags (1-2 words, >= 3 chars) in original order
    const concise = relevant.find((t) => {
      const n = normalizeTag(t);
      return n.length >= 3 && n.split(' ').length <= 2;
    });
    return slugifyTag(concise ?? relevant[0]);
  }

  const normCat = normalizeTag(category);
  if (normCat && !ignoreSet.has(normCat)) {
    return slugifyTag(category);
  }

  return 'uncategorized';
}
