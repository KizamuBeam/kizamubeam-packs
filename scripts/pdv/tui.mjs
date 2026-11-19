// Zero-dependency interactive Terminal UI (TUI) for searching, filtering,
// downloading, converting (AI/EPS -> SVG), and sorting PublicDomainVectors motifs.
import { emitKeypressEvents } from 'node:readline';
import { processMotif } from './pipeline.mjs';
import { buildSearchUrl, parseDetailPage, parseListingPage } from './scraper.mjs';
import { buildIgnoreSet, DEFAULT_IGNORED_TAGS, filterRelevantTags, pickPrimaryTopicTag, slugifyTag } from './tags.mjs';

const ESC = '\x1b';
const ANSI = {
  altOn: `${ESC}[?1049h`,
  altOff: `${ESC}[?1049l`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  clear: `${ESC}[2J${ESC}[H`,
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  inverse: `${ESC}[7m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  red: `${ESC}[31m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  bgBlue: `${ESC}[44m`,
  white: `${ESC}[37m`,
};

function padEndVis(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s.slice(0, Math.max(0, width));
  return s + ' '.repeat(width - s.length);
}

function truncate(str, max) {
  const s = String(str ?? '');
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function queryToFolderName(query) {
  const q = String(query ?? '').trim();
  if (!q) return '';
  if (/^https?:\/\//i.test(q)) {
    try {
      const u = new URL(q);
      const qParam = u.searchParams.get('q');
      if (qParam) return slugifyTag(qParam);
      const segs = u.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1] ?? '';
      return slugifyTag(last.replace(/\.html$/i, ''));
    } catch {
      return '';
    }
  }
  if (q.toLowerCase().startsWith('tag:')) {
    return slugifyTag(q.slice(4));
  }
  return slugifyTag(q);
}

export async function runTui({ client, converters, outputDir, initialQuery = '' }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Die TUI benötigt ein interaktives Terminal (TTY). Nutze --help für CLI-Optionen.');
  }

  const state = {
    query: initialQuery,
    page: 1,
    maxPage: 1,
    hasNextPage: false,
    formatFilter: 'ALL', // ALL | SVG | AI | EPS
    bwOnly: true,
    outputDir,
    extraIgnoredTags: [],
    ignoreSet: buildIgnoreSet(),
    items: [], // { id, title, url, formats, size, selected, statusText, detail?, topicTag? }
    cursor: 0,
    scroll: 0,
    busy: false,
    cancelRequested: false,
    busyLabel: '',
    progress: { done: 0, total: 0 },
    logs: [
      `Bereit. Konverter: ${converters.mode === 'none' ? 'nur SVG (kein Inkscape/gs gefunden)' : converters.mode}`,
      'Drücke [/] für Suche, [Space] zum Markieren, [d] zum Download, [q] zum Beenden.',
    ],
    modal: null, // { type: 'input', title, hint, value, onSubmit }
  };

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString('de-DE', { hour12: false });
    state.logs.push(`[${ts}] ${msg}`);
    if (state.logs.length > 200) state.logs.shift();
    render();
  }

  function rebuildIgnoreSet() {
    state.ignoreSet = buildIgnoreSet(state.extraIgnoredTags, DEFAULT_IGNORED_TAGS);
  }

  function getColsRows() {
    return {
      cols: Math.max(60, process.stdout.columns || 100),
      rows: Math.max(20, process.stdout.rows || 30),
    };
  }

  function render() {
    const { cols, rows } = getColsRows();
    const lines = [];

    // 1. Header bar
    const convBadge =
      converters.mode === 'none'
        ? 'Konverter: NUR SVG'
        : `Konverter: ${converters.mode}`;
    const headerLeft = ` KizamuBeam PDV Scraper `;
    const headerRight = ` ${convBadge} | Ziel: ${truncate(state.outputDir, 24)} `;
    const gap = Math.max(1, cols - headerLeft.length - headerRight.length);
    lines.push(
      `${ANSI.bgBlue}${ANSI.white}${ANSI.bold}${headerLeft}${' '.repeat(gap)}${headerRight}${ANSI.reset}`,
    );

    // 2. Filter & Search status bar
    const bwLabel = state.bwOnly ? `${ANSI.green}S/W: AN${ANSI.reset}` : `${ANSI.yellow}S/W: AUS${ANSI.reset}`;
    const fmtLabel = `${ANSI.cyan}Format: ${state.formatFilter}${ANSI.reset}`;
    const pageInfo = state.maxPage > state.page ? `${state.page}/${state.maxPage}` : `${state.page}`;
    const qLabel = state.query
      ? `Suche: "${state.query}" (S.${pageInfo} · ${state.items.length} Treffer)`
      : 'Keine aktive Suche – drücke [/]';
    const selectedCount = state.items.filter((i) => i.selected).length;
    lines.push(
      ` ${truncate(qLabel, Math.max(20, cols - 45))}  |  ${fmtLabel}  |  ${bwLabel}  |  Markiert: ${selectedCount}`,
    );
    lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);

    // Layout heights: header(3) + footer(2) + detail/log(8)
    const detailHeight = 4;
    const logHeight = Math.max(4, Math.min(7, Math.floor(rows * 0.22)));
    const listHeight = Math.max(5, rows - 3 - 1 - detailHeight - 1 - logHeight - 2);

    // Adjust scroll
    if (state.cursor < state.scroll) state.scroll = state.cursor;
    if (state.cursor >= state.scroll + listHeight) state.scroll = state.cursor - listHeight + 1;
    if (state.scroll < 0) state.scroll = 0;

    // 3. Results list
    if (state.items.length === 0) {
      for (let i = 0; i < listHeight; i++) {
        if (i === Math.floor(listHeight / 2)) {
          const emptyMsg = state.busy
            ? `  ${state.busyLabel}`
            : '  Keine Ergebnisse geladen. Drücke [/] für Suche (z. B. "cat", "tag:animals" oder URL).';
          lines.push(`${ANSI.dim}${padEndVis(emptyMsg, cols)}${ANSI.reset}`);
        } else {
          lines.push('');
        }
      }
    } else {
      for (let i = 0; i < listHeight; i++) {
        const idx = state.scroll + i;
        if (idx >= state.items.length) {
          lines.push('');
          continue;
        }
        const it = state.items[idx];
        const isCursor = idx === state.cursor;
        const check = it.selected ? '[x]' : '[ ]';
        const fmt = `[${it.formats.join(',').slice(0, 7).padEnd(7)}]`;
        const idStr = `#${it.id}`.padEnd(8);
        const statusStr = it.statusText ? ` (${it.statusText})` : '';
        const titleWidth = Math.max(15, cols - 25 - statusStr.length);
        const rowText = ` ${check} ${idStr} ${fmt} ${truncate(it.title, titleWidth)}${statusStr}`;
        if (isCursor) {
          lines.push(`${ANSI.inverse}${padEndVis(rowText, cols)}${ANSI.reset}`);
        } else if (it.selected) {
          lines.push(`${ANSI.green}${padEndVis(rowText, cols)}${ANSI.reset}`);
        } else {
          lines.push(padEndVis(rowText, cols));
        }
      }
    }

    // 4. Detail pane for current cursor item
    lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);
    const cur = state.items[state.cursor];
    if (cur) {
      const relevant = cur.detail ? filterRelevantTags(cur.detail.tags, state.ignoreSet) : [];
      const queryFolder = queryToFolderName(state.query);
      const topic = queryFolder || cur.topicTag || (cur.detail ? pickPrimaryTopicTag({
        tags: cur.detail.tags,
        title: cur.detail.title,
        category: cur.detail.category,
        ignoreSet: state.ignoreSet,
      }) : '—');
      lines.push(` ${ANSI.bold}Motiv:${ANSI.reset} ${truncate(cur.title, cols - 10)}`);
      lines.push(` ${ANSI.bold}URL:${ANSI.reset}   ${truncate(cur.url, cols - 10)}`);
      lines.push(
        ` ${ANSI.bold}Ziel-Ordner:${ANSI.reset} ${ANSI.magenta}${topic}/${ANSI.reset}  ${ANSI.dim}(relevante Tags: ${truncate(relevant.join(', ') || 'mit [Enter] laden', cols - 48)})${ANSI.reset}`,
      );
      lines.push(
        ` ${ANSI.bold}Formate:${ANSI.reset} ${cur.formats.join(', ')}${cur.size ? ` (${cur.size})` : ''}`,
      );
    } else {
      lines.push(` ${ANSI.dim}Kein Motiv ausgewählt.${ANSI.reset}`);
      lines.push('');
      lines.push('');
      lines.push('');
    }

    // 5. Log pane
    lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);
    const visibleLogs = state.logs.slice(-logHeight);
    for (let i = 0; i < logHeight; i++) {
      const msg = visibleLogs[i] ?? '';
      lines.push(`${ANSI.dim} ${truncate(msg, cols - 2)}${ANSI.reset}`);
    }

    // 6. Progress / Footer shortcuts
    if (state.busy) {
      const prog =
        state.progress.total > 0 ? ` (${state.progress.done}/${state.progress.total})` : '';
      lines.push(`${ANSI.yellow}${ANSI.bold} ⏳ ${state.busyLabel}${prog}  [Esc] Abbrechen${ANSI.reset}`);
    } else {
      lines.push(
        `${ANSI.dim} [/] Suche [Space] Wahl [a] Alle [d] Laden [m] +Seite [l] Alle Seiten [f] Fmt [b] S/W [t] Tags [c] Cookie [q] Ende${ANSI.reset}`,
      );
    }

    // 7. Modal overlay (if active)
    let out = ANSI.clear + lines.slice(0, rows).join('\n');
    if (state.modal) {
      const boxW = Math.min(cols - 4, 76);
      const startCol = Math.max(1, Math.floor((cols - boxW) / 2));
      const startRow = Math.max(3, Math.floor(rows / 2) - 3);
      const top = `┌${'─'.repeat(boxW - 2)}┐`;
      const midTitle = `│ ${padEndVis(truncate(state.modal.title, boxW - 4), boxW - 4)} │`;
      const midHint = `│ ${padEndVis(truncate(state.modal.hint, boxW - 4), boxW - 4)} │`;
      const midInput = `│ > ${padEndVis(state.modal.value.slice(-(boxW - 7)), boxW - 6)} │`;
      const midHelp = `│ ${padEndVis('[Enter] Übernehmen   [Esc] Abbrechen', boxW - 4)} │`;
      const bot = `└${'─'.repeat(boxW - 2)}┘`;

      const boxLines = [top, midTitle, midHint, midInput, midHelp, bot];
      for (let i = 0; i < boxLines.length; i++) {
        out += `${ESC}[${startRow + i};${startCol}H${ANSI.bgBlue}${ANSI.white}${boxLines[i]}${ANSI.reset}`;
      }
      const cursorCol = startCol + 4 + Math.min(state.modal.value.length, boxW - 7);
      out += `${ESC}[${startRow + 3};${cursorCol}H${ANSI.showCursor}`;
    } else {
      out += ANSI.hideCursor;
    }

    process.stdout.write(out);
  }

  async function fetchPage(query, page, { append = false } = {}) {
    const url = buildSearchUrl(query, { page, type: state.formatFilter });
    addLog(`Rufe auf: ${url}`);
    const html = await client.fetchHtml(url);
    const parsed = parseListingPage(html, url, page);
    state.query = query;
    state.page = page;
    state.maxPage = Math.max(append ? state.maxPage : 1, parsed.maxPage);
    state.hasNextPage = parsed.hasNextPage;

    if (!append) {
      state.items = parsed.items.map((it) => ({
        ...it,
        selected: false,
        statusText: '',
      }));
      state.cursor = 0;
      state.scroll = 0;
    } else {
      const existing = new Set(state.items.map((i) => i.id));
      let added = 0;
      for (const it of parsed.items) {
        if (existing.has(it.id)) continue;
        existing.add(it.id);
        state.items.push({ ...it, selected: false, statusText: '' });
        added++;
      }
      return { fetched: parsed.items.length, added };
    }
    return { fetched: parsed.items.length, added: parsed.items.length };
  }

  async function runSearch(query, page = 1) {
    if (state.busy) return;
    state.busy = true;
    state.cancelRequested = false;
    state.busyLabel = `Suche "${query || 'Alle'}" (Seite ${page}) …`;
    render();
    try {
      await fetchPage(query, page, { append: false });
      addLog(`${state.items.length} Motive gefunden (max. Seite ${state.maxPage}).`);
    } catch (err) {
      addLog(`Fehler bei Suche: ${err.message}`);
    } finally {
      state.busy = false;
      state.busyLabel = '';
      render();
    }
  }

  async function appendNextPage() {
    if (state.busy || !state.query) return;
    if (!state.hasNextPage) {
      addLog('Keine weitere Seite vorhanden.');
      return;
    }
    state.busy = true;
    state.cancelRequested = false;
    const nextPage = state.page + 1;
    state.busyLabel = `Lade Seite ${nextPage} …`;
    render();
    try {
      const { added } = await fetchPage(state.query, nextPage, { append: true });
      addLog(`Seite ${nextPage} angehängt (+${added} Motive, gesamt: ${state.items.length}).`);
    } catch (err) {
      addLog(`Fehler bei Seite ${nextPage}: ${err.message}`);
    } finally {
      state.busy = false;
      state.busyLabel = '';
      render();
    }
  }

  async function loadAllPages(maxPages = 50) {
    if (state.busy || !state.query) return;
    if (!state.hasNextPage) {
      addLog('Bereits alle Seiten geladen.');
      return;
    }
    state.busy = true;
    state.cancelRequested = false;
    const targetEnd = Math.min(state.maxPage || state.page + maxPages, state.page + maxPages);
    state.progress = { done: state.page, total: targetEnd };
    state.busyLabel = 'Lade alle Seiten …';
    render();

    let totalAdded = 0;
    try {
      while (state.hasNextPage && state.page < targetEnd && !state.cancelRequested) {
        const nextPage = state.page + 1;
        state.busyLabel = `Lade Seite ${nextPage}/${targetEnd} (${state.items.length} Motive) …`;
        render();
        const { added, fetched } = await fetchPage(state.query, nextPage, { append: true });
        totalAdded += added;
        state.progress = { done: state.page, total: Math.min(state.maxPage, targetEnd) };
        render();
        if (fetched === 0) break;
      }
      if (state.cancelRequested) {
        addLog(`Abgebrochen bei Seite ${state.page}. Gesamt: ${state.items.length} Motive.`);
      } else {
        addLog(`Alle Seiten geladen (+${totalAdded} Motive, gesamt: ${state.items.length}).`);
      }
    } catch (err) {
      addLog(`Fehler beim Nachladen (Seite ${state.page + 1}): ${err.message}`);
    } finally {
      state.busy = false;
      state.cancelRequested = false;
      state.busyLabel = '';
      state.progress = { done: 0, total: 0 };
      render();
    }
  }

  async function inspectCurrent() {
    const cur = state.items[state.cursor];
    if (!cur || state.busy) return;
    state.busy = true;
    state.busyLabel = `Lade Details für #${cur.id} …`;
    render();
    try {
      const html = await client.fetchHtml(cur.url);
      const detail = parseDetailPage(html, cur.url);
      cur.detail = detail;
      cur.formats = detail.formats.length ? detail.formats : cur.formats;
      cur.topicTag = pickPrimaryTopicTag({
        tags: detail.tags,
        title: detail.title,
        category: detail.category,
        ignoreSet: state.ignoreSet,
      });
      addLog(`#${cur.id}: Thema "${cur.topicTag}", Tags: ${detail.tags.slice(0, 6).join(', ')}`);
    } catch (err) {
      addLog(`Detail-Fehler (#${cur.id}): ${err.message}`);
    } finally {
      state.busy = false;
      state.busyLabel = '';
      render();
    }
  }

  async function downloadSelected() {
    if (state.busy) return;
    let targets = state.items.filter((i) => i.selected);
    if (targets.length === 0 && state.items[state.cursor]) {
      targets = [state.items[state.cursor]];
    }
    if (targets.length === 0) {
      addLog('Keine Motive ausgewählt.');
      return;
    }

    state.busy = true;
    state.cancelRequested = false;
    state.busyLabel = 'Lade & konvertiere Motive …';
    state.progress = { done: 0, total: targets.length };
    render();

    const folderName = queryToFolderName(state.query);
    let saved = 0;
    let filtered = 0;
    let errors = 0;

    try {
      for (const it of targets) {
        if (state.cancelRequested) break;
        try {
          const res = await processMotif({
            item: it,
            client,
            converters,
            outputDir: state.outputDir,
            folderName,
            ignoreSet: state.ignoreSet,
            bwOnly: state.bwOnly,
            onLog: (msg) => addLog(msg),
          });
          it.detail = res.detail;
          it.topicTag = res.topicTag;
          if (res.status === 'saved') {
            it.statusText = `OK → ${res.targetFolder}/`;
            saved++;
          } else if (res.status === 'skipped') {
            it.statusText = `Vorhanden → ${res.targetFolder}/`;
          } else if (res.status === 'filtered') {
            it.statusText = 'Kein S/W';
            filtered++;
          }
        } catch (err) {
          it.statusText = 'Fehler';
          errors++;
          addLog(`Fehler bei #${it.id}: ${err.message}`);
        }
        state.progress.done++;
        render();
      }
      addLog(`Fertig: ${saved} gespeichert, ${filtered} gefiltert (kein S/W), ${errors} Fehler.`);
    } finally {
      state.busy = false;
      state.cancelRequested = false;
      state.busyLabel = '';
      state.progress = { done: 0, total: 0 };
      render();
    }
  }

  function openInputModal(title, hint, initialValue, onSubmit) {
    state.modal = { title, hint, value: initialValue, onSubmit };
    render();
  }

  // Setup terminal raw mode
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(ANSI.altOn + ANSI.hideCursor);

  const cleanup = () => {
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdout.write(ANSI.showCursor + ANSI.altOff);
  };

  return new Promise((resolve) => {
    const finish = () => {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdout.removeListener('resize', render);
      cleanup();
      resolve();
    };

    const onKeypress = async (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        return;
      }

      // Modal input handling
      if (state.modal) {
        if (key.name === 'escape') {
          state.modal = null;
          render();
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const modal = state.modal;
          state.modal = null;
          render();
          await modal.onSubmit(modal.value);
          return;
        }
        if (key.name === 'backspace') {
          state.modal.value = state.modal.value.slice(0, -1);
          render();
          return;
        }
        if (str && !key.ctrl && !key.meta && str >= ' ') {
          state.modal.value += str;
          render();
        }
        return;
      }

      if (key.name === 'q') {
        finish();
        return;
      }

      if (state.busy) {
        if (key.name === 'escape') {
          state.cancelRequested = true;
          addLog('Abbruch angefordert …');
        }
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        if (state.cursor > 0) state.cursor--;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        if (state.cursor < state.items.length - 1) state.cursor++;
        render();
      } else if (key.name === 'pageup') {
        state.cursor = Math.max(0, state.cursor - 10);
        render();
      } else if (key.name === 'pagedown') {
        state.cursor = Math.min(Math.max(0, state.items.length - 1), state.cursor + 10);
        render();
      } else if (key.name === 'space') {
        const cur = state.items[state.cursor];
        if (cur) {
          cur.selected = !cur.selected;
          if (state.cursor < state.items.length - 1) state.cursor++;
          render();
        }
      } else if (str === 'a') {
        const allSelected = state.items.length > 0 && state.items.every((i) => i.selected);
        for (const it of state.items) it.selected = !allSelected;
        render();
      } else if (str === '/') {
        openInputModal(
          'Suche auf publicdomainvectors.org',
          'Begriff (z.B. "cat"), "tag:animals" oder komplette URL',
          state.query,
          async (val) => {
            await runSearch(val.trim(), 1);
          },
        );
      } else if (key.name === 'return' || key.name === 'enter') {
        await inspectCurrent();
      } else if (str === 'd') {
        await downloadSelected();
      } else if (str === 'f') {
        const order = ['ALL', 'SVG', 'AI', 'EPS'];
        state.formatFilter = order[(order.indexOf(state.formatFilter) + 1) % order.length];
        addLog(`Format-Filter: ${state.formatFilter}`);
        if (state.query) await runSearch(state.query, 1);
      } else if (str === 'b') {
        state.bwOnly = !state.bwOnly;
        addLog(`Schwarz/Weiß-Filter: ${state.bwOnly ? 'AN' : 'AUS'}`);
      } else if (str === 'n') {
        if (state.query) await runSearch(state.query, state.page + 1);
      } else if (str === 'p') {
        if (state.query && state.page > 1) await runSearch(state.query, state.page - 1);
      } else if (str === 'm') {
        await appendNextPage();
      } else if (str === 'l') {
        await loadAllPages();
      } else if (str === 't') {
        openInputModal(
          'Zusätzliche ignorierte Tags (kommagetrennt)',
          'Basis-Liste (silhouette, black and white, outline, ornament, …) bleibt aktiv',
          state.extraIgnoredTags.join(', '),
          async (val) => {
            state.extraIgnoredTags = val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            rebuildIgnoreSet();
            addLog(`Ignorier-Liste aktualisiert (+${state.extraIgnoredTags.length} eigene Tags).`);
          },
        );
      } else if (str === 'c') {
        openInputModal(
          'Cloudflare Cookie / Einstellungen',
          'Optional: cf_clearance=... einfügen (leer lassen zum Zurücksetzen)',
          '',
          async (val) => {
            client.setCookie(val.trim());
            addLog(val.trim() ? 'Cookie aktualisiert.' : 'Cookie geleert.');
          },
        );
      }
    };

    process.stdin.on('keypress', onKeypress);
    process.stdout.on('resize', render);
    render();

    if (initialQuery) {
      void runSearch(initialQuery, 1);
    }
  });
}
