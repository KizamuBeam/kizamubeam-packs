// AI / EPS -> SVG conversion and ZIP archive extraction.
// Prefers Inkscape CLI; falls back to Ghostscript (gs) + pdftocairo (or pdf2svg).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function hasCommand(cmd, args = ['--version']) {
  try {
    await execFileAsync(cmd, args, { timeout: 5000 });
    return true;
  } catch (err) {
    // Some tools like pdftocairo -v exit 0 or 99; ENOENT means not installed
    return err?.code !== 'ENOENT';
  }
}

/** Detect installed local vector conversion tools. */
export async function detectConverters() {
  const [inkscape, gs, pdftocairo, pdf2svg] = await Promise.all([
    hasCommand('inkscape', ['--version']),
    hasCommand('gs', ['--version']),
    hasCommand('pdftocairo', ['-v']),
    hasCommand('pdf2svg', []),
  ]);

  let mode = 'none';
  if (inkscape) mode = 'inkscape';
  else if (gs && pdftocairo) mode = 'gs+pdftocairo';
  else if (gs && pdf2svg) mode = 'gs+pdf2svg';

  return { inkscape, gs, pdftocairo, pdf2svg, mode };
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * If buffer is a ZIP archive (PK\x03\x04), extract it and return the best vector file.
 * Preference order inside archive: .svg > .eps > .ai
 */
export async function extractVectorFromBuffer(buffer, fallbackExt = '.svg') {
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const workDir = mkdtempSync(join(tmpdir(), 'pdv-work-'));

  try {
    if (!isZip) {
      const ext = fallbackExt.startsWith('.') ? fallbackExt : `.${fallbackExt}`;
      const filePath = join(workDir, `input${ext}`);
      writeFileSync(filePath, buffer);
      return {
        workDir,
        filePath,
        ext: ext.toLowerCase(),
        cleanup: () => rmSync(workDir, { recursive: true, force: true }),
      };
    }

    const zipPath = join(workDir, 'archive.zip');
    const extractDir = join(workDir, 'extracted');
    writeFileSync(zipPath, buffer);

    try {
      await execFileAsync('unzip', ['-qq', '-o', zipPath, '-d', extractDir], { timeout: 20_000 });
    } catch {
      await execFileAsync(
        'python3',
        ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, extractDir],
        { timeout: 20_000 },
      );
    }

    const files = listFilesRecursive(extractDir).filter((f) => !f.includes('__MACOSX'));
    const byPriority = ['.svg', '.eps', '.ai'];
    let picked = null;
    for (const ext of byPriority) {
      picked = files.find((f) => extname(f).toLowerCase() === ext);
      if (picked) break;
    }

    if (!picked) {
      throw new Error(`Keine SVG/EPS/AI-Datei im ZIP-Archiv gefunden (${files.length} Dateien)`);
    }

    return {
      workDir,
      filePath: picked,
      ext: extname(picked).toLowerCase(),
      cleanup: () => rmSync(workDir, { recursive: true, force: true }),
    };
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Convert an .ai or .eps file to SVG.
 * @returns {Promise<string>} Resulting SVG content as UTF-8 string.
 */
export async function convertVectorToSvgText(inputPath, converters) {
  const ext = extname(inputPath).toLowerCase();
  if (ext === '.svg') {
    return readFileSync(inputPath, 'utf8');
  }

  const tools = converters ?? (await detectConverters());
  const outDir = mkdtempSync(join(tmpdir(), 'pdv-conv-'));
  const outSvg = join(outDir, 'out.svg');

  try {
    if (tools.inkscape) {
      await execFileAsync(
        'inkscape',
        [inputPath, '--export-type=svg', '--export-plain-svg', `--export-filename=${outSvg}`],
        { timeout: 60_000 },
      );
      if (!existsSync(outSvg)) {
        throw new Error('Inkscape hat keine SVG-Ausgabe erzeugt');
      }
      return readFileSync(outSvg, 'utf8');
    }

    if (tools.gs && (tools.pdftocairo || tools.pdf2svg)) {
      const tmpPdf = join(outDir, 'intermediate.pdf');
      // Convert AI/EPS to clean PDF via Ghostscript
      await execFileAsync(
        'gs',
        [
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pdfwrite',
          '-dEPSCrop',
          `-sOutputFile=${tmpPdf}`,
          inputPath,
        ],
        { timeout: 60_000 },
      );

      if (!existsSync(tmpPdf)) {
        throw new Error('Ghostscript konnte keine Zwischen-PDF erzeugen');
      }

      if (tools.pdftocairo) {
        await execFileAsync('pdftocairo', ['-svg', tmpPdf, outSvg], { timeout: 60_000 });
      } else {
        await execFileAsync('pdf2svg', [tmpPdf, outSvg], { timeout: 60_000 });
      }

      if (!existsSync(outSvg)) {
        throw new Error('PDF-zu-SVG-Konvertierung fehlgeschlagen');
      }
      return readFileSync(outSvg, 'utf8');
    }

    throw new Error(
      'Kein Konverter für AI/EPS gefunden. Bitte Inkscape oder Ghostscript (gs) + pdftocairo installieren.',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
