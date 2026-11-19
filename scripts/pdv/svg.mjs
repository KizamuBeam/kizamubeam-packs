// SVG inspection and black-and-white / monochrome suitability check for laser cutting.

const MONOCHROME_NAMED_COLORS = new Set([
  'none',
  'transparent',
  'currentcolor',
  'inherit',
  'black',
  'white',
  'gray',
  'grey',
  'darkgray',
  'darkgrey',
  'dimgray',
  'dimgrey',
  'lightgray',
  'lightgrey',
  'silver',
  'gainsboro',
  'whitesmoke',
  'snow',
]);

function isGrayscaleRgb(r, g, b, tolerance = 12) {
  return (
    Math.abs(r - g) <= tolerance &&
    Math.abs(g - b) <= tolerance &&
    Math.abs(r - b) <= tolerance
  );
}

/**
 * Check whether a single CSS/SVG color token is monochrome (grayscale, black, white, none).
 * Returns true for url(...) references? No, url(#grad) is handled via gradient detection.
 */
export function isMonochromeColor(rawValue) {
  const val = String(rawValue ?? '').trim().toLowerCase();
  if (!val) return true;
  if (MONOCHROME_NAMED_COLORS.has(val)) return true;

  // Hex #RGB or #RGBA
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(val);
  if (hex3) {
    const r = parseInt(hex3[1] + hex3[1], 16);
    const g = parseInt(hex3[2] + hex3[2], 16);
    const b = parseInt(hex3[3] + hex3[3], 16);
    return isGrayscaleRgb(r, g, b);
  }

  // Hex #RRGGBB or #RRGGBBAA
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(val);
  if (hex6) {
    const r = parseInt(hex6[1], 16);
    const g = parseInt(hex6[2], 16);
    const b = parseInt(hex6[3], 16);
    return isGrayscaleRgb(r, g, b);
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = /^rgba?\(\s*([0-9.%]+)\s*,\s*([0-9.%]+)\s*,\s*([0-9.%]+)(?:\s*,\s*[0-9.%]+)?\s*\)$/i.exec(val);
  if (rgbMatch) {
    const parseChan = (s) => (s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    const r = parseChan(rgbMatch[1]);
    const g = parseChan(rgbMatch[2]);
    const b = parseChan(rgbMatch[3]);
    return isGrayscaleRgb(r, g, b);
  }

  // url(#...) -> gradient/pattern reference (flagged separately if gradients exist)
  if (val.startsWith('url(')) return true;

  return false;
}

/**
 * Analyze an SVG string for laser-cutting & black/white suitability.
 * @param {string} svgText
 * @returns {{
 *   valid: boolean,
 *   isMonochrome: boolean,
 *   hasRasterImage: boolean,
 *   hasGradients: boolean,
 *   shapeCount: number,
 *   nonMonoColors: string[],
 *   reason: string | null
 * }}
 */
export function analyzeSvg(svgText) {
  const text = String(svgText ?? '');
  const valid = /<svg[\s>]/i.test(text);
  if (!valid) {
    return {
      valid: false,
      isMonochrome: false,
      hasRasterImage: false,
      hasGradients: false,
      shapeCount: 0,
      nonMonoColors: [],
      reason: 'Kein gültiges SVG-Dokument',
    };
  }

  const hasRasterImage = /<image[\s>]/i.test(text);
  const hasGradients = /<(?:linearGradient|radialGradient)[\s>]/i.test(text);
  const shapeMatches = text.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line)\b/gi);
  const shapeCount = shapeMatches ? shapeMatches.length : 0;

  const nonMono = new Set();

  // Check fill="...", stroke="...", stop-color="..."
  const attrRe = /\b(?:fill|stroke|stop-color|flood-color)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(text)) !== null) {
    const c = m[1].trim();
    if (!isMonochromeColor(c)) nonMono.add(c);
  }

  // Check inline style="... fill: ...; stroke: ...;"
  const styleRe = /\bstyle\s*=\s*["']([^"']+)["']/gi;
  while ((m = styleRe.exec(text)) !== null) {
    const decls = m[1].split(';');
    for (const d of decls) {
      const idx = d.indexOf(':');
      if (idx === -1) continue;
      const prop = d.slice(0, idx).trim().toLowerCase();
      const val = d.slice(idx + 1).trim();
      if (prop === 'fill' || prop === 'stroke' || prop === 'stop-color' || prop === 'color') {
        if (!isMonochromeColor(val)) nonMono.add(val);
      }
    }
  }

  const nonMonoColors = [...nonMono];
  const isMonochrome = !hasRasterImage && !hasGradients && nonMonoColors.length === 0;

  let reason = null;
  if (hasRasterImage) reason = 'Enthält eingebettete Rastergrafik (<image>)';
  else if (hasGradients) reason = 'Enthält Farbverläufe (Gradient)';
  else if (nonMonoColors.length > 0) reason = `Enthält Farben: ${nonMonoColors.slice(0, 4).join(', ')}`;
  else if (shapeCount === 0) reason = 'Keine Vektorpfade gefunden';

  return {
    valid: true,
    isMonochrome,
    hasRasterImage,
    hasGradients,
    shapeCount,
    nonMonoColors,
    reason,
  };
}
