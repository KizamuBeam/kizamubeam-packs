// Interactive TUI for building KizamuBeam .kzp extension packs from a folder of SVGs.
import { basename, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { buildPackFromEntries, listMotifFolders, scanMotifFolder } from './packBuilder.mjs';
import { slugifyTag } from './tags.mjs';

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

function titleCase(str) {
  return String(str ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function runPackTui({ motifsDir, packsDir, initialFolder = '' }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Die TUI benötigt ein interaktives Terminal (TTY). Nutze --help für CLI-Optionen.');
  }

  const state = {
    view: 'folders', // 'folders' | 'entries'
    motifsDir,
    packsDir,
    folders: listMotifFolders(motifsDir),
    folderCursor: 0,
    folderScroll: 0,
    currentFolderPath: '',
    currentFolderName: '',
    entries: [],
    entryCursor: 0,
    entryScroll: 0,
    packId: '',
    packName: '',
    packVersion: '1.0.0',
    packAuthor: 'KizamuBeam Community',
    category: 'motif',
    targetMaxMm: 50,
    logs: [
      'Ordner wählen mit [Enter] oder beliebigen Pfad öffnen mit [o].',
    ],
    modal: null,
  };

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString('de-DE', { hour12: false });
    state.logs.push(`[${ts}] ${msg}`);
    if (state.logs.length > 200) state.logs.shift();
    render();
  }

  function openFolder(folderPath) {
    const abs = resolve(folderPath);
    const name = basename(abs);
    const entries = scanMotifFolder(abs);
    if (entries.length === 0) {
      addLog(`Keine SVG-Dateien in ${abs} gefunden.`);
      return;
    }
    state.currentFolderPath = abs;
    state.currentFolderName = name;
    state.entries = entries;
    state.entryCursor = 0;
    state.entryScroll = 0;
    const slug = slugifyTag(name).replace(/[^a-z0-9-]/g, '-');
    state.packId = `org.kizamubeam.${slug}`;
    state.packName = titleCase(name);
    state.view = 'entries';
    addLog(`Ordner "${name}" geladen: ${entries.length} SVGs.`);
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

    const headerLeft = ' KizamuBeam Pack Builder (.kzp) ';
    const headerRight = ` Ausgabe: ${truncate(state.packsDir, 28)} `;
    const gap = Math.max(1, cols - headerLeft.length - headerRight.length);
    lines.push(
      `${ANSI.bgBlue}${ANSI.white}${ANSI.bold}${headerLeft}${' '.repeat(gap)}${headerRight}${ANSI.reset}`,
    );

    if (state.view === 'folders') {
      lines.push(` Basis-Ordner: ${truncate(state.motifsDir, cols - 16)}`);
      lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);

      const logHeight = 6;
      const listHeight = Math.max(5, rows - 3 - 1 - logHeight - 2);
      if (state.folderCursor < state.folderScroll) state.folderScroll = state.folderCursor;
      if (state.folderCursor >= state.folderScroll + listHeight) {
        state.folderScroll = state.folderCursor - listHeight + 1;
      }

      if (state.folders.length === 0) {
        for (let i = 0; i < listHeight; i++) {
          lines.push(
            i === Math.floor(listHeight / 2)
              ? `${ANSI.dim}  Keine Unterordner mit SVGs in ${state.motifsDir}. Drücke [o] für einen eigenen Pfad.${ANSI.reset}`
              : '',
          );
        }
      } else {
        for (let i = 0; i < listHeight; i++) {
          const idx = state.folderScroll + i;
          if (idx >= state.folders.length) {
            lines.push('');
            continue;
          }
          const f = state.folders[idx];
          const rowText = ` 📁 ${padEndVis(f.name, 34)} (${f.svgCount} SVGs)`;
          lines.push(
            idx === state.folderCursor
              ? `${ANSI.inverse}${padEndVis(rowText, cols)}${ANSI.reset}`
              : padEndVis(rowText, cols),
          );
        }
      }

      lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);
      const visibleLogs = state.logs.slice(-logHeight);
      for (let i = 0; i < logHeight; i++) {
        lines.push(`${ANSI.dim} ${truncate(visibleLogs[i] ?? '', cols - 2)}${ANSI.reset}`);
      }
      lines.push(
        `${ANSI.dim} [↑/↓] Wählen  [Enter] Ordner öffnen  [o] Pfad eingeben  [r] Aktualisieren  [q] Ende${ANSI.reset}`,
      );
    } else {
      const selCount = state.entries.filter((e) => e.selected).length;
      const sizeStr = state.targetMaxMm > 0 ? `${state.targetMaxMm}mm` : 'Original';
      lines.push(
        ` ${ANSI.cyan}ID:${ANSI.reset} ${state.packId}  |  ${ANSI.cyan}Name:${ANSI.reset} ${state.packName}  |  v${state.packVersion}  |  ${state.category}  |  Max: ${sizeStr}  |  Auswahl: ${selCount}/${state.entries.length}`,
      );
      lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);

      const logHeight = 6;
      const listHeight = Math.max(5, rows - 3 - 1 - logHeight - 2);
      if (state.entryCursor < state.entryScroll) state.entryScroll = state.entryCursor;
      if (state.entryCursor >= state.entryScroll + listHeight) {
        state.entryScroll = state.entryCursor - listHeight + 1;
      }

      for (let i = 0; i < listHeight; i++) {
        const idx = state.entryScroll + i;
        if (idx >= state.entries.length) {
          lines.push('');
          continue;
        }
        const e = state.entries[idx];
        const check = e.selected ? '[x]' : '[ ]';
        const tagsStr = e.tags.length ? ` [${e.tags.slice(0, 3).join(', ')}]` : '';
        const rowText = ` ${check} ${truncate(e.title, Math.max(20, cols - 12 - tagsStr.length))}${tagsStr}`;
        if (idx === state.entryCursor) {
          lines.push(`${ANSI.inverse}${padEndVis(rowText, cols)}${ANSI.reset}`);
        } else if (e.selected) {
          lines.push(`${ANSI.green}${padEndVis(rowText, cols)}${ANSI.reset}`);
        } else {
          lines.push(padEndVis(rowText, cols));
        }
      }

      lines.push(`${ANSI.dim}${'─'.repeat(cols)}${ANSI.reset}`);
      const visibleLogs = state.logs.slice(-logHeight);
      for (let i = 0; i < logHeight; i++) {
        lines.push(`${ANSI.dim} ${truncate(visibleLogs[i] ?? '', cols - 2)}${ANSI.reset}`);
      }
      lines.push(
        `${ANSI.dim} [Space] Wahl [a] Alle [b/Enter] .kzp bauen [i] ID [n] Name [v] Ver [u] Autor [k] Kat [s] Größe [Esc] Zurück [q] Ende${ANSI.reset}`,
      );
    }

    let out = ANSI.clear + lines.slice(0, rows).join('\n');
    if (state.modal) {
      const boxW = Math.min(cols - 4, 76);
      const startCol = Math.max(1, Math.floor((cols - boxW) / 2));
      const startRow = Math.max(3, Math.floor(rows / 2) - 3);
      const boxLines = state.modal.isConfirm
        ? [
            `┌${'─'.repeat(boxW - 2)}┐`,
            `│ ${padEndVis(truncate(state.modal.title, boxW - 4), boxW - 4)} │`,
            `│ ${padEndVis(truncate(state.modal.hint, boxW - 4), boxW - 4)} │`,
            `│ ${padEndVis('[Enter] Ja, in Teilpakete aufteilen   [Esc] Abbrechen', boxW - 4)} │`,
            `└${'─'.repeat(boxW - 2)}┘`,
          ]
        : [
            `┌${'─'.repeat(boxW - 2)}┐`,
            `│ ${padEndVis(truncate(state.modal.title, boxW - 4), boxW - 4)} │`,
            `│ ${padEndVis(truncate(state.modal.hint, boxW - 4), boxW - 4)} │`,
            `│ > ${padEndVis(state.modal.value.slice(-(boxW - 7)), boxW - 6)} │`,
            `│ ${padEndVis('[Enter] Übernehmen   [Esc] Abbrechen', boxW - 4)} │`,
            `└${'─'.repeat(boxW - 2)}┘`,
          ];
      for (let i = 0; i < boxLines.length; i++) {
        out += `${ESC}[${startRow + i};${startCol}H${ANSI.bgBlue}${ANSI.white}${boxLines[i]}${ANSI.reset}`;
      }
      if (!state.modal.isConfirm) {
        const cursorCol = startCol + 4 + Math.min(state.modal.value.length, boxW - 7);
        out += `${ESC}[${startRow + 3};${cursorCol}H${ANSI.showCursor}`;
      } else {
        out += ANSI.hideCursor;
      }
    } else {
      out += ANSI.hideCursor;
    }

    process.stdout.write(out);
  }

  function openModal(title, hint, initialValue, onSubmit) {
    state.modal = { title, hint, value: initialValue, onSubmit, isConfirm: false };
    render();
  }

  function openConfirmModal(title, hint, onConfirm) {
    state.modal = { title, hint, value: '', onSubmit: onConfirm, isConfirm: true };
    render();
  }

  function runBuild(autoSplit = false) {
    const selected = state.entries.filter((e) => e.selected);
    if (selected.length === 0) {
      addLog('Keine Motive ausgewählt.');
      return;
    }
    try {
      const res = buildPackFromEntries({
        entries: selected,
        packId: state.packId,
        name: state.packName,
        version: state.packVersion,
        author: state.packAuthor,
        category: state.category,
        targetMaxMm: state.targetMaxMm,
        packsDir: state.packsDir,
        autoSplit,
      });
      for (const p of res.parts) {
        const mb = (p.bytes / 1024 / 1024).toFixed(2);
        addLog(`Paket erstellt: ${p.outPath} (${p.assetCount} Motive, ${mb} MB)`);
      }
      if (res.errors.length > 0) {
        addLog(`Hinweis: ${res.errors.length} SVG(s) übersprungen (z.B. ${res.errors[0].file}: ${res.errors[0].error})`);
      }
    } catch (err) {
      if (err?.code === 'PACK_TOO_LARGE' && !autoSplit) {
        const totalMb = (err.totalBytes / 1024 / 1024).toFixed(1);
        openConfirmModal(
          `Paket zu groß (${totalMb} MB > 20 MB) – aufteilen?`,
          `Erzeugt ${err.suggestedParts} Teilpakete (${state.packId}-1.kzp …)`,
          () => runBuild(true),
        );
        return;
      }
      addLog(`Build-Fehler: ${err.message}`);
    }
  }

  function buildCurrentPack() {
    runBuild(false);
  }

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

  return new Promise((resolvePromise) => {
    const finish = () => {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdout.removeListener('resize', render);
      cleanup();
      resolvePromise();
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        return;
      }

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
          modal.onSubmit(modal.value);
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

      if (state.view === 'folders') {
        if (key.name === 'up' || key.name === 'k') {
          if (state.folderCursor > 0) state.folderCursor--;
          render();
        } else if (key.name === 'down' || key.name === 'j') {
          if (state.folderCursor < state.folders.length - 1) state.folderCursor++;
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          const f = state.folders[state.folderCursor];
          if (f) openFolder(f.path);
        } else if (str === 'o') {
          openModal('Ordner-Pfad öffnen', 'Pfad zu einem Ordner mit SVG-Dateien', state.motifsDir, (val) => {
            if (val.trim()) openFolder(val.trim());
          });
        } else if (str === 'r') {
          state.folders = listMotifFolders(state.motifsDir);
          state.folderCursor = 0;
          addLog(`Ordnerliste aktualisiert (${state.folders.length} Ordner).`);
        }
        return;
      }

      // Entries view
      if (key.name === 'escape' || key.name === 'backspace') {
        state.view = 'folders';
        render();
      } else if (key.name === 'up') {
        if (state.entryCursor > 0) state.entryCursor--;
        render();
      } else if (key.name === 'down') {
        if (state.entryCursor < state.entries.length - 1) state.entryCursor++;
        render();
      } else if (key.name === 'pageup') {
        state.entryCursor = Math.max(0, state.entryCursor - 10);
        render();
      } else if (key.name === 'pagedown') {
        state.entryCursor = Math.min(Math.max(0, state.entries.length - 1), state.entryCursor + 10);
        render();
      } else if (key.name === 'space') {
        const cur = state.entries[state.entryCursor];
        if (cur) {
          cur.selected = !cur.selected;
          if (state.entryCursor < state.entries.length - 1) state.entryCursor++;
          render();
        }
      } else if (str === 'a') {
        const allSel = state.entries.length > 0 && state.entries.every((e) => e.selected);
        for (const e of state.entries) e.selected = !allSel;
        render();
      } else if (str === 'b' || key.name === 'return' || key.name === 'enter') {
        buildCurrentPack();
      } else if (str === 'i') {
        openModal('Pack-ID (Reverse-Domain)', 'z.B. org.kizamubeam.christmas', state.packId, (val) => {
          if (val.trim()) state.packId = val.trim().toLowerCase();
          render();
        });
      } else if (str === 'n') {
        openModal('Paketname', 'Anzeigename in KizamuBeam', state.packName, (val) => {
          if (val.trim()) state.packName = val.trim();
          render();
        });
      } else if (str === 'v') {
        openModal('Version', 'SemVer z.B. 1.0.0', state.packVersion, (val) => {
          if (val.trim()) state.packVersion = val.trim();
          render();
        });
      } else if (str === 'u') {
        openModal('Autor', 'Name des Autors', state.packAuthor, (val) => {
          if (val.trim()) state.packAuthor = val.trim();
          render();
        });
      } else if (str === 'k') {
        state.category = state.category === 'motif' ? 'element' : 'motif';
        addLog(`Kategorie: ${state.category}`);
      } else if (str === 's') {
        const sizes = [50, 100, 30, 0];
        state.targetMaxMm = sizes[(sizes.indexOf(state.targetMaxMm) + 1) % sizes.length];
        addLog(`Zielgröße: ${state.targetMaxMm > 0 ? `${state.targetMaxMm} mm` : 'Original (SVG-Maß)'}`);
      }
    };

    process.stdin.on('keypress', onKeypress);
    process.stdout.on('resize', render);

    if (initialFolder) {
      openFolder(initialFolder);
    } else {
      render();
    }
  });
}
