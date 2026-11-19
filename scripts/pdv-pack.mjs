#!/usr/bin/env node
// Interactive TUI & CLI entry point for building KizamuBeam .kzp packs from SVG folders.
import { resolve } from 'node:path';
import { buildPackFromEntries, scanMotifFolder } from './pdv/packBuilder.mjs';
import { runPackTui } from './pdv/packTui.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);

function parseArgs(argv) {
  const opts = {
    motifsDir: resolve(root, 'motifs'),
    packsDir: resolve(root, 'packs'),
    folder: '',
    packId: '',
    name: '',
    version: '1.0.0',
    author: 'KizamuBeam Community',
    category: 'motif',
    maxMm: 50,
    build: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--build') opts.build = true;
    else if ((a === '--dir' || a === '-d') && argv[i + 1]) opts.folder = resolve(argv[++i]);
    else if (a === '--motifs-dir' && argv[i + 1]) opts.motifsDir = resolve(argv[++i]);
    else if ((a === '--out' || a === '-o') && argv[i + 1]) opts.packsDir = resolve(argv[++i]);
    else if (a === '--id' && argv[i + 1]) opts.packId = argv[++i];
    else if (a === '--name' && argv[i + 1]) opts.name = argv[++i];
    else if (a === '--version' && argv[i + 1]) opts.version = argv[++i];
    else if (a === '--author' && argv[i + 1]) opts.author = argv[++i];
    else if (a === '--category' && argv[i + 1]) opts.category = argv[++i];
    else if (a === '--max-mm' && argv[i + 1]) opts.maxMm = Number(argv[++i]);
  }
  return opts;
}

function printHelp() {
  console.log(`KizamuBeam Pack Builder (.kzp)

Verwendung:
  node scripts/pdv-pack.mjs [Optionen]
  npm run pack-builder -- [Optionen]

Optionen:
  -d, --dir <pfad>     Öffnet diesen SVG-Ordner direkt
  --motifs-dir <pfad>  Basis-Ordner für Unterordner (Standard: motifs/)
  -o, --out <pfad>     Ausgabe-Ordner für .kzp-Dateien (Standard: packs/)
  --build              Ohne TUI direkt bauen (erfordert --dir, --id, --name)
  --id <reverse-id>    Pack-ID (z.B. org.kizamubeam.christmas)
  --name <titel>       Anzeigename des Pakets
  --version <ver>      Paket-Version (Standard: 1.0.0)
  --author <name>      Autor (Standard: KizamuBeam Community)
  --category <kat>     motif | element (Standard: motif)
  --max-mm <mm>        Max. Kantenlänge in mm, 0 = Original (Standard: 50)
  -h, --help           Diese Hilfe anzeigen
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.build) {
    if (!opts.folder || !opts.packId || !opts.name) {
      throw new Error('--build erfordert --dir, --id und --name');
    }
    const entries = scanMotifFolder(opts.folder);
    const res = buildPackFromEntries({
      entries,
      packId: opts.packId,
      name: opts.name,
      version: opts.version,
      author: opts.author,
      category: opts.category,
      targetMaxMm: opts.maxMm,
      packsDir: opts.packsDir,
    });
    console.log(`OK: ${res.outPath} (${res.assetCount} Motive, ${(res.bytes / 1024).toFixed(1)} KB)`);
    return;
  }

  await runPackTui({
    motifsDir: opts.motifsDir,
    packsDir: opts.packsDir,
    initialFolder: opts.folder,
  });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
