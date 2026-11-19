// AI / EPS / PDF -> SVG conversion, magic-byte detection, and ZIP archive extraction.
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
  else if (pdftocairo) mode = 'pdftocairo';

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
 * Sniff actual file type from buffer magic bytes.
 * @returns {'zip' | 'html' | 'svg' | 'pdf' | 'eps' | 'unknown'}
 */
export function sniffBufferType(buffer) {
  if (!buffer || buffer.length === 0) return 'unknown';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'zip';
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart();
  if (/^%PDF-/i.test(head)) return 'pdf';
  if (/^%!PS-Adobe/i.test(head)) return 'eps';
  if (/^(?:<!DOCTYPE\s+html|<html\b)/i.test(head)) return 'html';
  if (/^(?:<\?xml\b[\s\S]{0,200}<svg\b|<svg\b)/i.test(head)) return 'svg';
  return 'unknown';
}

/**
 * Inspect downloaded buffer (ZIP or raw file), reject HTML pages, and extract the best vector file.
 * Preference order inside archive: .svg > .eps > .ai > .pdf
 */
export async function extractVectorFromBuffer(buffer, fallbackExt = '.svg', contentType = '') {
  const sniffed = sniffBufferType(buffer);
  if (sniffed === 'html' || (/text\/html/i.test(contentType) && sniffed === 'unknown')) {
    const preview = buffer.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ').trim();
    throw new Error(
      `Download lieferte HTML statt einer Vektordatei (${contentType || 'unbekannter Typ'}): ${preview.slice(0, 120)}`,
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), 'pdv-work-'));

  try {
    if (sniffed !== 'zip') {
      const extMap = { svg: '.svg', pdf: '.pdf', eps: '.eps' };
      const ext = extMap[sniffed] ?? (fallbackExt.startsWith('.') ? fallbackExt : `.${fallbackExt}`);
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
    const byPriority = ['.svg', '.eps', '.ai', '.pdf'];
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

async function tryInkscape(inputPath, outSvg) {
  const variants = [
    ['--batch-process', '--export-type=svg', '--export-plain-svg', `--export-filename=${outSvg}`, inputPath],
    ['--export-type=svg', `--export-filename=${outSvg}`, inputPath],
  ];

  let lastErr = '';
  for (const args of variants) {
    try {
      const { stderr, stdout } = await execFileAsync('inkscape', args, { timeout: 60_000 });
      if (existsSync(outSvg)) {
        return readFileSync(outSvg, 'utf8');
      }
      lastErr = (stderr || stdout || 'keine Ausgabedatei erzeugt').trim();
    } catch (err) {
      lastErr = (err?.stderr || err?.message || String(err)).trim();
    }
  }
  throw new Error(`Inkscape fehlgeschlagen: ${lastErr.slice(0, 200)}`);
}

async function tryPdfToSvg(pdfPath, outSvg, tools) {
  if (tools.pdftocairo) {
    await execFileAsync('pdftocairo', ['-svg', pdfPath, outSvg], { timeout: 60_000 });
  } else if (tools.pdf2svg) {
    await execFileAsync('pdf2svg', [pdfPath, outSvg], { timeout: 60_000 });
  } else {
    throw new Error('Weder pdftocairo noch pdf2svg verfügbar');
  }
  if (!existsSync(outSvg)) {
    throw new Error('PDF-zu-SVG-Konvertierung hat keine Ausgabedatei erzeugt');
  }
  return readFileSync(outSvg, 'utf8');
}

/**
 * Convert an .ai, .eps, or .pdf file to SVG with automatic fallback chain.
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
  const errors = [];

  try {
    // Direct PDF -> SVG via pdftocairo/pdf2svg if input is already PDF (modern .ai or .pdf)
    const rawHead = readFileSync(inputPath).subarray(0, 16).toString('utf8');
    const isPdf = ext === '.pdf' || /^%PDF-/i.test(rawHead);

    if (tools.inkscape) {
      try {
        return await tryInkscape(inputPath, outSvg);
      } catch (err) {
        errors.push(err.message);
      }
    }

    if (isPdf && (tools.pdftocairo || tools.pdf2svg)) {
      try {
        return await tryPdfToSvg(inputPath, outSvg, tools);
      } catch (err) {
        errors.push(err.message);
      }
    }

    if (tools.gs && (tools.pdftocairo || tools.pdf2svg)) {
      try {
        const tmpPdf = join(outDir, 'intermediate.pdf');
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
          throw new Error('Ghostscript hat keine Zwischen-PDF erzeugt');
        }
        return await tryPdfToSvg(tmpPdf, outSvg, tools);
      } catch (err) {
        errors.push(`Ghostscript: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join(' | '));
    }

    throw new Error(
      'Kein Konverter für AI/EPS gefunden. Bitte Inkscape oder Ghostscript (gs) + pdftocairo installieren.',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
