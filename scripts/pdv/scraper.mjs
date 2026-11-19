// HTTP client and HTML parser for publicdomainvectors.org.
// Uses polite rate limiting and reports Cloudflare / anti-bot blocks transparently.

const BASE_URL = 'https://publicdomainvectors.org';
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function decodeHtmlEntities(str) {
  return String(str ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeHtmlEntities(String(html ?? '').replace(/<[^>]+>/g, ' '));
}

function resolveUrl(href, base = BASE_URL) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Build a listing URL on publicdomainvectors.org from a user query.
 * Supports:
 *  - full https://publicdomainvectors.org/... URL
 *  - "tag:<name>" -> /en/tag/<name>
 *  - free-text query -> /search?lang=en&q=<query>
 */
export function buildSearchUrl(query, { page = 1, type = 'ALL' } = {}) {
  const q = String(query ?? '').trim();
  let url;

  if (/^https?:\/\//i.test(q)) {
    url = new URL(q);
  } else if (q.toLowerCase().startsWith('tag:')) {
    const tagSlug = q
      .slice(4)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    url = new URL(`${BASE_URL}/en/tag/${encodeURIComponent(tagSlug || 'silhouette')}`);
  } else if (!q) {
    url = new URL(`${BASE_URL}/en/free-clipart/`);
  } else {
    url = new URL(`${BASE_URL}/search`);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('q', q);
  }

  if (page > 1) url.searchParams.set('page', String(page));
  if (type && type !== 'ALL') url.searchParams.set('type', type.toLowerCase());
  return url.toString();
}

/**
 * Parse search / category / tag listing HTML into motif summaries.
 * @returns {{ items: Array<{ id: string, title: string, url: string, formats: string[], size: string }>, hasNextPage: boolean, maxPage: number }}
 */
export function parseListingPage(html, baseUrl = BASE_URL, currentPage = 1) {
  const items = [];
  const seenIds = new Set();

  // Match links to detail pages: /en/free-clipart/<slug>/<id>.html (or any /<lang>/free-clipart/.../<id>.html)
  const linkRe = /<a\b[^>]*href=["']([^"']*\/free-clipart\/[^"']+\/(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const id = m[2];
    const inner = m[3];
    if (seenIds.has(id)) continue;

    // Look at a tight window after the anchor (up to next card/link) for format badges (SVG, AI, EPS)
    const afterStart = m.index + m[0].length;
    const nextAnchor = html.indexOf('<a ', afterStart);
    const winEnd = Math.min(
      html.length,
      afterStart + 180,
      nextAnchor !== -1 ? nextAnchor : html.length,
    );
    const snippet = html.slice(m.index, winEnd);

    // Extract title: prefer img alt, title attr, anchor text, or URL slug
    let title = '';
    const altMatch = /\balt=["']([^"']+)["']/i.exec(inner);
    const titleAttr = /\btitle=["']([^"']+)["']/i.exec(m[0]);
    const textOnly = stripTags(inner);
    if (/^(English|Deutsch|Español|Français|Italiano|Português|Polski|Svenska|Český|Nederlands|Türkçe|中文|한국어|日本語|हिंदी|Romana|Indonesia|Русский|Suomalainen|Norsk|עִברִית|eurbaa)$/i.test(textOnly)) {
      continue;
    }
    if (textOnly && textOnly.length >= 2) title = textOnly;
    else if (altMatch?.[1]) title = decodeHtmlEntities(altMatch[1]);
    else if (titleAttr?.[1]) title = decodeHtmlEntities(titleAttr[1]);
    else {
      const slugPart = href.split('/').slice(-2, -1)[0] ?? id;
      title = decodeHtmlEntities(slugPart.replace(/-/g, ' '));
    }

    // Detect formats in snippet
    const formats = [];
    if (/\bSVG\b/i.test(snippet)) formats.push('SVG');
    if (/\bAI\b/i.test(snippet)) formats.push('AI');
    if (/\bEPS\b/i.test(snippet)) formats.push('EPS');
    if (formats.length === 0) formats.push('SVG');

    const sizeMatch = /\b(\d+(?:\.\d+)?\s*(?:KB|MB|B))\b/i.exec(snippet);
    const fullUrl = resolveUrl(href, baseUrl);
    if (!fullUrl) continue;

    seenIds.add(id);
    items.push({
      id,
      title,
      url: fullUrl,
      formats,
      size: sizeMatch ? sizeMatch[1].toUpperCase() : '',
    });
  }

  let maxPage = currentPage;
  const pageRe = /[?&]page=(\d+)/gi;
  let pm;
  while ((pm = pageRe.exec(html)) !== null) {
    const p = Number(pm[1]);
    if (Number.isFinite(p) && p > maxPage) maxPage = p;
  }

  const hasRelNext = /rel=["']next["']/i.test(html);
  const hasNextPage = items.length > 0 && (maxPage > currentPage || hasRelNext);
  return { items, hasNextPage, maxPage };
}

/**
 * Parse a motif detail page to extract tags, category, formats, and download URL.
 */
export function parseDetailPage(html, pageUrl = BASE_URL) {
  const idMatch = /\/(\d+)\.html(?:[?#]|$)/.exec(pageUrl);
  const id = idMatch ? idMatch[1] : String(Date.now());

  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const titleTagMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = h1Match ? stripTags(h1Match[1]) : stripTags(titleTagMatch?.[1] ?? id);
  const title = rawTitle.replace(/\s*\|\s*Public domain vectors.*$/i, '').trim() || `motif-${id}`;

  // Category links
  const catMatch = /Categories[\s\S]{0,400}?<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  const category = catMatch ? stripTags(catMatch[1]) : '';

  // Tags: collect all /tag/ links or words in Tags block
  const tags = [];
  const tagLinkRe = /<a\b[^>]*href=["'][^"']*\/tag\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let tm;
  while ((tm = tagLinkRe.exec(html)) !== null) {
    const t = stripTags(tm[1]);
    if (t) tags.push(t);
  }

  // Fallback: plain-text Tags section (if tags aren't <a> links)
  if (tags.length === 0) {
    const tagsSection = /\bTags\b[\s\S]{0,600}/i.exec(html);
    if (tagsSection) {
      const cleaned = stripTags(tagsSection[0]).replace(/^Tags\s*/i, '');
      for (const word of cleaned.split(/[,|\n]+/)) {
        const w = word.trim();
        if (w && w.length < 40) tags.push(w);
      }
    }
  }

  // Download link(s): look for "Download SVG", "Download AI,EPS", /download/, or direct .svg/.zip/.ai/.eps
  const downloads = [];
  const dlRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let dm;
  while ((dm = dlRe.exec(html)) !== null) {
    const href = dm[1];
    const label = stripTags(dm[2]);
    const isDownloadBtn = /download/i.test(label) || /\/download\b|\.(?:svg|eps|ai|zip)(?:[?#]|$)/i.test(href);
    if (!isDownloadBtn) continue;
    // Skip Adobe Stock affiliate links
    if (/adobe\.prf\.hn|stock\.adobe\.com/i.test(href)) continue;

    const abs = resolveUrl(href, pageUrl);
    if (!abs) continue;

    let format = 'UNKNOWN';
    if (/\.svg(?:[?#]|$)/i.test(href) || /\bSVG\b/i.test(label)) format = 'SVG';
    else if (/\.eps(?:[?#]|$)/i.test(href) || /\bEPS\b/i.test(label)) format = 'EPS';
    else if (/\.ai(?:[?#]|$)/i.test(href) || /\bAI\b/i.test(label)) format = 'AI';
    else if (/\.zip(?:[?#]|$)/i.test(href)) format = 'ZIP';

    downloads.push({ url: abs, label, format });
  }

  // Formats from Specs
  const formats = [];
  if (/\bSVG\b/i.test(html)) formats.push('SVG');
  if (/\bAI\b/i.test(html)) formats.push('AI');
  if (/\bEPS\b/i.test(html)) formats.push('EPS');

  // Prefer SVG download if available, otherwise first download
  const preferredDownload =
    downloads.find((d) => d.format === 'SVG') ??
    downloads.find((d) => d.format === 'EPS' || d.format === 'AI' || d.format === 'ZIP') ??
    downloads[0] ??
    null;

  return {
    id,
    title,
    url: pageUrl,
    category,
    tags,
    formats,
    downloads,
    preferredDownload,
  };
}

/**
 * Create a rate-limited HTTP client.
 */
export function createPdvClient({ delayMs = 1000, cookie = '', userAgent = DEFAULT_UA } = {}) {
  let lastReqAt = 0;
  let currentDelay = delayMs;
  let currentCookie = cookie;

  async function throttle() {
    const now = Date.now();
    const wait = lastReqAt + currentDelay - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastReqAt = Date.now();
  }

  async function fetchRaw(url) {
    await throttle();
    const headers = {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
    };
    if (currentCookie.trim()) {
      headers.Cookie = currentCookie.trim();
    }

    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 403 || res.status === 503) {
      const text = await res.text().catch(() => '');
      const isCloudflare = /cloudflare|cf-ray|just a moment|attention required/i.test(text) || res.headers.has('cf-ray');
      if (isCloudflare) {
        throw new Error(
          `HTTP ${res.status} (Cloudflare-Schutz aktiv). Bitte ggf. Browser-Cookie (cf_clearance) unter Einstellungen [c] setzen.`,
        );
      }
      throw new Error(`HTTP ${res.status} beim Abruf von ${url}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText}) für ${url}`);
    }
    return res;
  }

  return {
    setCookie(c) {
      currentCookie = String(c ?? '');
    },
    setDelay(ms) {
      currentDelay = Math.max(200, Number(ms) || 1000);
    },
    getConfig() {
      return { delayMs: currentDelay, hasCookie: Boolean(currentCookie.trim()) };
    },
    async fetchHtml(url) {
      const res = await fetchRaw(url);
      return res.text();
    },
    async fetchBuffer(url) {
      const res = await fetchRaw(url);
      const ab = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') ?? '';
      return { buffer: Buffer.from(ab), contentType, finalUrl: res.url };
    },
  };
}
