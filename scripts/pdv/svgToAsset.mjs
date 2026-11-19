// Pure-Node SVG -> KizamuBeam AssetData (objs/subs/nodes in mm) converter.
// Supports path (M,L,H,V,C,S,Q,T,A,Z), rect, circle, ellipse, polygon, polyline, line,
// nested <g transform="..."> matrices, and bounding-box normalization to (0, 0).

const MM_PER_PX = 25.4 / 96;

function parseLengthMm(raw) {
  if (raw == null) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc|px|)\s*$/i.exec(String(raw));
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  switch (m[2].toLowerCase()) {
    case 'mm': return v;
    case 'cm': return v * 10;
    case 'in': return v * 25.4;
    case 'pt': return (v * 25.4) / 72;
    case 'pc': return (v * 25.4) / 6;
    default: return v * MM_PER_PX;
  }
}

function mulMat(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMat(m, pt) {
  return {
    x: m[0] * pt.x + m[2] * pt.y + m[4],
    y: m[1] * pt.x + m[3] * pt.y + m[5],
  };
}

function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!str) return m;
  const fnRe = /([a-z]+)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = fnRe.exec(str)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    let t = null;
    if (fn === 'matrix' && nums.length >= 6) {
      t = nums.slice(0, 6);
    } else if (fn === 'translate' && nums.length >= 1) {
      t = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      const sx = nums[0];
      const sy = nums[1] ?? sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        t = mulMat(mulMat([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
      } else {
        t = [c, s, -s, c, 0, 0];
      }
    } else if (fn === 'skewx' && nums.length >= 1) {
      t = [1, 0, Math.tan((nums[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === 'skewy' && nums.length >= 1) {
      t = [1, Math.tan((nums[0] * Math.PI) / 180), 0, 1, 0, 0];
    }
    if (t) m = mulMat(m, t);
  }
  return m;
}

function parseAttrs(attrStr) {
  const attrs = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  }
  return attrs;
}

// Convert SVG arc segment (x0,y0) -> (x,y) to cubic Bezier segments [[c1, c2, end], ...]
function arcToCubics(x0, y0, rxIn, ryIn, phiDeg, largeArc, sweep, x, y) {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[{ x: x0, y: y0 }, { x, y }, { x, y }]];

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;

  const lam = x1p2 / rx2 + y1p2 / ry2;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }

  const rx2n = rx * rx;
  const ry2n = ry * ry;
  const num = Math.max(0, rx2n * ry2n - rx2n * y1p2 - ry2n * x1p2);
  const den = rx2n * y1p2 + ry2n * x1p2;
  const factor = den === 0 ? 0 : (largeArc === sweep ? -1 : 1) * Math.sqrt(num / den);

  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;

  const vecAngle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const cos = Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len));
    const ang = Math.acos(cos);
    return ux * vy - uy * vx < 0 ? -ang : ang;
  };

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = vecAngle(1, 0, ux, uy);
  let dTheta = vecAngle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segs;
  const alpha = (4 / 3) * Math.tan(delta / 4);

  const out = [];
  for (let i = 0; i < segs; i++) {
    const t1 = theta1 + i * delta;
    const t2 = t1 + delta;
    const c1u = Math.cos(t1) - alpha * Math.sin(t1);
    const s1u = Math.sin(t1) + alpha * Math.cos(t1);
    const c2u = Math.cos(t2) + alpha * Math.sin(t2);
    const s2u = Math.sin(t2) - alpha * Math.cos(t2);
    const e2x = Math.cos(t2);
    const e2y = Math.sin(t2);

    const mapPt = (px, py) => ({
      x: cx + cosPhi * rx * px - sinPhi * ry * py,
      y: cy + sinPhi * rx * px + cosPhi * ry * py,
    });
    out.push([mapPt(c1u, s1u), mapPt(c2u, s2u), mapPt(e2x, e2y)]);
  }
  return out;
}

function parsePathData(d) {
  const tokens = String(d ?? '').match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const subs = [];
  let cur = null;
  let pos = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastCtrl = null;
  let lastCmd = '';
  let i = 0;

  const isCmd = (tok) => /^[a-zA-Z]$/.test(tok);
  const nextNum = () => Number(tokens[i++]);
  const hasNum = () => i < tokens.length && !isCmd(tokens[i]);

  const startSub = (pt) => {
    cur = { closed: false, nodes: [{ x: pt.x, y: pt.y }] };
    subs.push(cur);
    pos = pt;
    start = pt;
  };
  const lineTo = (pt) => {
    if (!cur) startSub(pos);
    cur.nodes.push({ x: pt.x, y: pt.y });
    pos = pt;
  };
  const cubicTo = (c1, c2, end) => {
    if (!cur) startSub(pos);
    cur.nodes[cur.nodes.length - 1].cout = { x: c1.x, y: c1.y };
    cur.nodes.push({ x: end.x, y: end.y, cin: { x: c2.x, y: c2.y } });
    pos = end;
  };

  let cmd = '';
  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    } else if (!cmd) {
      i++;
      continue;
    }

    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      if (cur && cur.nodes.length >= 2) {
        const first = cur.nodes[0];
        const last = cur.nodes[cur.nodes.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
          if (last.cin) first.cin = last.cin;
          cur.nodes.pop();
        }
        cur.closed = true;
      }
      pos = { ...start };
      lastCtrl = null;
      lastCmd = upper;
      cmd = '';
      continue;
    }

    if (!hasNum()) {
      cmd = '';
      continue;
    }

    if (upper === 'M') {
      const x = nextNum() + (rel ? pos.x : 0);
      const y = nextNum() + (rel ? pos.y : 0);
      startSub({ x, y });
      lastCtrl = null;
      lastCmd = 'M';
      cmd = rel ? 'l' : 'L';
    } else if (upper === 'L') {
      const x = nextNum() + (rel ? pos.x : 0);
      const y = nextNum() + (rel ? pos.y : 0);
      lineTo({ x, y });
      lastCtrl = null;
      lastCmd = 'L';
    } else if (upper === 'H') {
      const x = nextNum() + (rel ? pos.x : 0);
      lineTo({ x, y: pos.y });
      lastCtrl = null;
      lastCmd = 'H';
    } else if (upper === 'V') {
      const y = nextNum() + (rel ? pos.y : 0);
      lineTo({ x: pos.x, y });
      lastCtrl = null;
      lastCmd = 'V';
    } else if (upper === 'C') {
      const c1 = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const c2 = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const end = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      cubicTo(c1, c2, end);
      lastCtrl = c2;
      lastCmd = 'C';
    } else if (upper === 'S') {
      const c1 =
        lastCmd === 'C' || lastCmd === 'S'
          ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y }
          : { ...pos };
      const c2 = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const end = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      cubicTo(c1, c2, end);
      lastCtrl = c2;
      lastCmd = 'S';
    } else if (upper === 'Q') {
      const q = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const end = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const c1 = { x: pos.x + (2 / 3) * (q.x - pos.x), y: pos.y + (2 / 3) * (q.y - pos.y) };
      const c2 = { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
      cubicTo(c1, c2, end);
      lastCtrl = q;
      lastCmd = 'Q';
    } else if (upper === 'T') {
      const q =
        lastCmd === 'Q' || lastCmd === 'T'
          ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y }
          : { ...pos };
      const end = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      const c1 = { x: pos.x + (2 / 3) * (q.x - pos.x), y: pos.y + (2 / 3) * (q.y - pos.y) };
      const c2 = { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
      cubicTo(c1, c2, end);
      lastCtrl = q;
      lastCmd = 'T';
    } else if (upper === 'A') {
      const rx = nextNum();
      const ry = nextNum();
      const rot = nextNum();
      const largeArc = nextNum() !== 0;
      const sweep = nextNum() !== 0;
      const end = { x: nextNum() + (rel ? pos.x : 0), y: nextNum() + (rel ? pos.y : 0) };
      for (const [c1, c2, e] of arcToCubics(pos.x, pos.y, rx, ry, rot, largeArc, sweep, end.x, end.y)) {
        cubicTo(c1, c2, e);
      }
      lastCtrl = null;
      lastCmd = 'A';
    } else {
      i++;
    }
  }

  return subs.filter((s) => s.nodes.length >= 2);
}

function rectSubs(attrs) {
  const x = Number(attrs.x ?? 0);
  const y = Number(attrs.y ?? 0);
  const w = Number(attrs.width ?? 0);
  const h = Number(attrs.height ?? 0);
  if (!(w > 0 && h > 0)) return [];
  return [
    {
      closed: true,
      nodes: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    },
  ];
}

function ellipseSubs(cx, cy, rx, ry) {
  if (!(rx > 0 && ry > 0)) return [];
  const k = 0.5522847498;
  const kx = rx * k;
  const ky = ry * k;
  return [
    {
      closed: true,
      nodes: [
        { x: cx, y: cy - ry, cin: { x: cx - kx, y: cy - ry }, cout: { x: cx + kx, y: cy - ry } },
        { x: cx + rx, y: cy, cin: { x: cx + rx, y: cy - ky }, cout: { x: cx + rx, y: cy + ky } },
        { x: cx, y: cy + ry, cin: { x: cx + kx, y: cy + ry }, cout: { x: cx - kx, y: cy + ry } },
        { x: cx - rx, y: cy, cin: { x: cx - rx, y: cy + ky }, cout: { x: cx - rx, y: cy - ky } },
      ],
    },
  ];
}

function polySubs(pointsStr, closed) {
  const nums = (String(pointsStr ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  const nodes = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    nodes.push({ x: nums[i], y: nums[i + 1] });
  }
  return nodes.length >= 2 ? [{ closed, nodes }] : [];
}

/**
 * Convert an SVG string into a KizamuBeam asset payload ({ w, h, objs }).
 * @param {string} svgText
 * @param {{ targetMaxMm?: number }} [opts]
 * @returns {{ w: number, h: number, objs: Array }}
 */
export function svgToKizamuAsset(svgText, { targetMaxMm = 50 } = {}) {
  const clean = String(svgText ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(defs|clipPath|mask|pattern|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const svgOpen = /<svg\b([^>]*)>/i.exec(clean);
  if (!svgOpen) throw new Error('Kein <svg>-Root-Element gefunden');
  const rootAttrs = parseAttrs(svgOpen[1]);

  let base = [MM_PER_PX, 0, 0, MM_PER_PX, 0, 0];
  const vb = (rootAttrs.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
  const wmm = parseLengthMm(rootAttrs.width);
  const hmm = parseLengthMm(rootAttrs.height);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    const sx = wmm !== null ? wmm / vb[2] : hmm !== null ? hmm / vb[3] : MM_PER_PX;
    const sy = hmm !== null ? hmm / vb[3] : sx;
    const s = Math.min(sx, sy);
    base = [s, 0, 0, s, -vb[0] * s, -vb[1] * s];
  }

  const stack = [base];
  const allSubs = [];
  const tagRe = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  let m;

  while ((m = tagRe.exec(clean)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrStr = m[3];
    const selfClose = m[4] === '/';

    if (isClose) {
      if (tag === 'g' && stack.length > 1) stack.pop();
      continue;
    }

    const attrs = parseAttrs(attrStr);
    const parentMat = stack[stack.length - 1];
    const localMat = attrs.transform ? mulMat(parentMat, parseTransform(attrs.transform)) : parentMat;

    if (tag === 'g') {
      if (!selfClose) stack.push(localMat);
      continue;
    }

    let subs = [];
    if (tag === 'path' && attrs.d) subs = parsePathData(attrs.d);
    else if (tag === 'rect') subs = rectSubs(attrs);
    else if (tag === 'circle') subs = ellipseSubs(Number(attrs.cx ?? 0), Number(attrs.cy ?? 0), Number(attrs.r ?? 0), Number(attrs.r ?? 0));
    else if (tag === 'ellipse') subs = ellipseSubs(Number(attrs.cx ?? 0), Number(attrs.cy ?? 0), Number(attrs.rx ?? 0), Number(attrs.ry ?? 0));
    else if (tag === 'polygon') subs = polySubs(attrs.points, true);
    else if (tag === 'polyline') subs = polySubs(attrs.points, false);
    else if (tag === 'line') {
      const x1 = Number(attrs.x1 ?? 0), y1 = Number(attrs.y1 ?? 0);
      const x2 = Number(attrs.x2 ?? 0), y2 = Number(attrs.y2 ?? 0);
      if (x1 !== x2 || y1 !== y2) subs = [{ closed: false, nodes: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }];
    }

    for (const s of subs) {
      allSubs.push({
        closed: s.closed,
        nodes: s.nodes.map((n) => {
          const p = applyMat(localMat, n);
          const out = { x: p.x, y: p.y };
          if (n.cin) out.cin = applyMat(localMat, n.cin);
          if (n.cout) out.cout = applyMat(localMat, n.cout);
          return out;
        }),
      });
    }
  }

  if (allSubs.length === 0) {
    throw new Error('Keine konvertierbaren Vektorpfade gefunden');
  }

  // Compute bounding box and normalize to (0, 0), optionally scaling max side to targetMaxMm
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of allSubs) {
    for (const n of s.nodes) {
      for (const p of [n, n.cin, n.cout]) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }

  const rawW = Math.max(0.01, maxX - minX);
  const rawH = Math.max(0.01, maxY - minY);
  const scale = targetMaxMm > 0 ? targetMaxMm / Math.max(rawW, rawH) : 1;
  const r = (v) => +v.toFixed(3);
  const normPt = (p) => ({ x: r((p.x - minX) * scale), y: r((p.y - minY) * scale) });

  const normSubs = allSubs.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => {
      const out = normPt(n);
      if (n.cin) out.cin = normPt(n.cin);
      if (n.cout) out.cout = normPt(n.cout);
      return out;
    }),
  }));

  return {
    w: r(rawW * scale),
    h: r(rawH * scale),
    objs: [
      {
        m: [1, 0, 0, 1, 0, 0],
        layer: 0,
        shape: { kind: 'path', subs: normSubs },
      },
    ],
  };
}
