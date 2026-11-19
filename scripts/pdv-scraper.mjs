#!/usr/bin/env node
// Interactive TUI & CLI entry point for downloading and sorting CC0 motifs from publicdomainvectors.org.
import { resolve } from 'node:path';
import { detectConverters } from './pdv/convert.mjs';
import { createPdvClient } from './pdv/scraper.mjs';
import { runTui } from './pdv/tui.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);

function parseArgs(argv) {
  const opts = {
    query: '',
    out: resolve(root, 'motifs'),
    delay: 1000,
    cookie: process.env.PDV_COOKIE ?? '',
    checkTools: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--check-tools') opts.checkTools = true;
    else if ((a === '--query' || a === '-q') && argv[i + 1]) opts.query = argv[++i];
    else if ((a === '--out' || a === '-o') && argv[i + 1]) opts.out = resolve(argv[++i]);
    else if (a === '--delay' && argv[i + 1]) opts.delay = Number(argv[++i]) || 1000;
    else if (a === '--cookie' && argv[i + 1]) opts.cookie = argv[++i];
  }
  return opts;
}

function printHelp() {
  console.log(`KizamuBeam PublicDomainVectors Scraper (TUI)

Verwendung:
  node scripts/pdv-scraper.mjs [Optionen]
  npm run scraper -- [Optionen]

Optionen:
  -q, --query <text>   Startet die TUI direkt mit dieser Suche (z.B. "cat" oder "tag:animals")
  -o, --out <dir>      Zielverzeichnis für Tag-Ordner (Standard: motifs/)
  --delay <ms>         Wartezeit zwischen HTTP-Anfragen in ms (Standard: 1000)
  --cookie <str>       Optionaler Cookie-Header (z.B. cf_clearance=...) oder ENV PDV_COOKIE
  --check-tools        Prüft lokale Konverter (Inkscape / Ghostscript + pdftocairo)
  -h, --help           Diese Hilfe anzeigen

Tastenkürzel in der TUI:
  [/]      Suche / Tag ("tag:...") / URL eingeben
  [Space]  Motiv markieren / abwählen
  [a]      Alle markieren / abwählen
  [Enter]  Detailseite & Ziel-Tag vorab prüfen
  [d]      Markierte Motive laden, AI/EPS -> SVG konvertieren & einsortieren
  [f]      Format-Filter (ALL / SVG / AI / EPS)
  [b]      Schwarz/Weiß-Filter umschalten
  [t]      Zusätzliche ignorierte Tags bearbeiten
  [c]      Cookie / Setup anpassen
  [n / p]  Nächste / vorherige Seite
  [q]      Beenden
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const converters = await detectConverters();
  if (opts.checkTools) {
    console.log('Erkannte Konverter:', JSON.stringify(converters, null, 2));
    return;
  }

  const client = createPdvClient({
    delayMs: opts.delay,
    cookie: opts.cookie,
  });

  await runTui({
    client,
    converters,
    outputDir: opts.out,
    initialQuery: opts.query,
  });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
