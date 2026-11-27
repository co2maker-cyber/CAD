// Draftline 3D 보조 기능 — 3D → 2D 도면(투상도·숨은선), 3MF 내보내기
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const fmt = v => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };
const escX = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ---------------------------------------------------------------- 실루엣 (곡면의 윤곽선)
const adjCache = new WeakMap();
function adjacency(g) {
  let c = adjCache.get(g); if (c) return c;
  const a = g.attributes.position.array, map = new Map(), normals = [];
  const R = v => Math.round(v * 1e4), key = (i) => `${R(a[i])},${R(a[i + 1])},${R(a[i + 2])}`;
  const p = V3(), q = V3(), r = V3(), n = V3(), t = V3();
  for (let i = 0, f = 0; i < a.length; i += 9, f++) {
    p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
    n.subVectors(q, p).cross(t.subVectors(r, p)); const L = n.length(); normals.push(L > 1e-12 ? n.clone().multiplyScalar(1 / L) : null);
    if (L < 1e-12) continue;
    const k = [key(i), key(i + 3), key(i + 6)], P3 = [i, i + 3, i + 6];
    for (let e = 0; e < 3; e++) {
      const k0 = k[e], k1 = k[(e + 1) % 3]; if (k0 === k1) continue;
      const ek = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
      let o = map.get(ek); if (!o) map.set(ek, o = { i0: P3[e], i1: P3[(e + 1) % 3], f: [] });
      o.f.push(f);
    }
  }
  c = { edges: [...map.values()].filter(o => o.f.length === 2), normals, a };
  adjCache.set(g, c); return c;
}
function silhouettes(g, d) {
  const { edges, normals, a } = adjacency(g), out = [];
  for (const e of edges) {
    const n1 = normals[e.f[0]], n2 = normals[e.f[1]]; if (!n1 || !n2) continue;
    const s1 = n1.dot(d), s2 = n2.dot(d);
    if (s1 * s2 < 0 && Math.abs(s1 - s2) > 1e-3) out.push([V3(a[e.i0], a[e.i0 + 1], a[e.i0 + 2]), V3(a[e.i1], a[e.i1 + 1], a[e.i1 + 2])]);
  }
  return out;
}

// ---------------------------------------------------------------- 투상
export const DRAW_VIEWS = {
  front: { d: V3(0, -1, 0), u: V3(1, 0, 0), v: V3(0, 0, 1), label: '정면도' },
  top: { d: V3(0, 0, 1), u: V3(1, 0, 0), v: V3(0, 1, 0), label: '평면도' },
  right: { d: V3(1, 0, 0), u: V3(0, 1, 0), v: V3(0, 0, 1), label: '우측면도' },
  iso: { d: V3(1, -1, 1).normalize(), u: V3(1, 1, 0).normalize(), v: V3(-1, 1, 2).normalize(), label: '등각도' },
};

function mergedBVH(geoms) {
  let n = 0; for (const g of geoms) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of geoms) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new MeshBVH(m);
}

// 한 방향에서 본 보이는 선/숨은 선 (2D 좌표 [x0,y0,x1,y1])
function projectView(items, view, bvh, scale, hidden) {
  const { d, u, v } = view, vis = [], hid = [];
  const eps = scale * 1e-4, minHit = scale * 4e-3, ray = new THREE.Ray(), piece = scale / 80;
  const P2 = p => [p.dot(u), p.dot(v)];
  const segs = [];
  for (const it of items) { for (const s of it.edges) segs.push(s); for (const s of silhouettes(it.geom, d)) segs.push(s); }
  const raw = [];
  for (const [A, B] of segs) {
    const L = A.distanceTo(B); if (L < 1e-6) continue;
    const pa = P2(A), pb = P2(B); if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 1e-6) continue; // 보는 방향과 나란한 선은 점
    const n = Math.max(1, Math.min(48, Math.ceil(L / piece)));
    let run = null;
    const push = (st, t0, t1) => { const P = A.clone().lerp(B, t0), Q = A.clone().lerp(B, t1); raw.push({ h: st, a: P2(P), b: P2(Q) }); };
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      // 조각 안 세 점의 다수결 (곡면 스침 때문에 생기는 점 같은 잡선 방지)
      let votes = 0;
      for (const f of [0.2, 0.5, 0.8]) { const M = A.clone().lerp(B, t0 + (t1 - t0) * f); ray.origin.copy(M).addScaledVector(d, eps); ray.direction.copy(d); const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (hit && hit.distance > minHit) votes++; }
      const st = votes >= 2;
      if (run && run.st === st) run.t1 = t1; else { if (run) push(run.st, run.t0, run.t1); run = { st, t0, t1 }; }
    }
    if (run) push(run.st, run.t0, run.t1);
  }
  for (const r of raw) if (!r.h) vis.push([...r.a, ...r.b]);
  if (hidden) {
    // 보이는 선과 겹치는 숨은 선은 그리지 않음
    const cell = scale / 40, grid = new Map(), tol = scale * 1.5e-3;
    const ck = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    vis.forEach((s, i) => { const n = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / cell) + 1; for (let k = 0; k <= n; k++) { const x = s[0] + (s[2] - s[0]) * k / n, y = s[1] + (s[3] - s[1]) * k / n; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const key = `${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy}`; let l = grid.get(key); if (!l) grid.set(key, l = new Set()); l.add(i); } } });
    const onVis = (x, y) => { const l = grid.get(ck(x, y)); if (!l) return false; for (const i of l) { const s = vis[i], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy; let t = L2 ? ((x - s[0]) * dx + (y - s[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); if (Math.hypot(s[0] + dx * t - x, s[1] + dy * t - y) < tol) return true; } return false; };
    for (const r of raw) {
      if (!r.h) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / (scale / 120)));
      let st = null;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2, x = r.a[0] + (r.b[0] - r.a[0]) * tm, y = r.a[1] + (r.b[1] - r.a[1]) * tm;
        if (onVis(x, y)) { if (st !== null) { hid.push(lerp2(r, st, t0)); st = null; } } else if (st === null) st = t0;
      }
      if (st !== null) hid.push(lerp2(r, st, 1));
    }
  }
  return { vis, hid: dedupe(hid, scale) };
}
const lerp2 = (r, t0, t1) => [r.a[0] + (r.b[0] - r.a[0]) * t0, r.a[1] + (r.b[1] - r.a[1]) * t0, r.a[0] + (r.b[0] - r.a[0]) * t1, r.a[1] + (r.b[1] - r.a[1]) * t1];
function dedupe(list, scale) {
  const q = v => Math.round(v / (scale * 1e-3)), seen = new Set(), out = [];
  for (const s of list) { const a = `${q(s[0])},${q(s[1])}`, b = `${q(s[2])},${q(s[3])}`, k = a < b ? a + b : b + a; if (a === b || seen.has(k)) continue; seen.add(k); out.push(s); }
  return out;
}
function bounds(lines) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of lines) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
  return isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

const SCALES = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500];
const scaleLabel = s => s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`;

/**
 * 도면 만들기
 * items: [{ geom, edges }]   (edges: 날카로운 모서리 선분 [[V3,V3]...])
 * info: { title, parts:[{no,name,mat,qty,mass}], date, hidden, iso }
 * 반환: { svg, dxf, scale }
 */
export function makeDrawing(items, info) {
  const box = new THREE.Box3(); for (const it of items) { it.geom.computeBoundingBox(); box.union(it.geom.boundingBox); }
  const size = box.getSize(V3()), scale = Math.max(1, size.length());
  const bvh = mergedBVH(items.map(it => it.geom));
  const views = {};
  for (const k of ['front', 'top', 'right'].concat(info.iso ? ['iso'] : [])) views[k] = projectView(items, DRAW_VIEWS[k], bvh, scale, info.hidden && k !== 'iso');
  for (const k in views) views[k].bb = bounds(views[k].vis.concat(views[k].hid));

  // A3 가로 (420 × 297) — 3각법: 평면도는 정면도 위, 우측면도는 정면도 오른쪽
  const SW = 420, SH = 297, M = 10, gap = 24, TBH = 56;
  const fb = views.front.bb, tb = views.top.bb, rb = views.right.bb;
  const Wf = fb.x1 - fb.x0, Hf = fb.y1 - fb.y0, Ht = tb.y1 - tb.y0, Wr = rb.x1 - rb.x0;
  const availW = SW - 2 * M - 3 * gap - 20, availH = SH - 2 * M - TBH - 3 * gap;
  const fit = Math.min(availW / Math.max(1e-6, Wf + Wr), availH / Math.max(1e-6, Hf + Ht));
  const s = SCALES.find(x => x <= fit) || SCALES[SCALES.length - 1];
  const fx = M + gap + 14, ty = M + gap / 2 + 4, fy = ty + s * Ht + gap, rx = fx + s * Wf + gap;
  const place = { front: { ox: fx, oy: fy, bb: fb, s }, top: { ox: fx, oy: ty, bb: tb, s }, right: { ox: rx, oy: fy, bb: rb, s } };
  if (views.iso) {
    const ib = views.iso.bb, cw = SW - M - 6 - rx, ch = fy - gap - ty;
    const si = Math.min(s, cw / Math.max(1e-6, ib.x1 - ib.x0), ch / Math.max(1e-6, ib.y1 - ib.y0)) * 0.92;
    if (si > 0) place.iso = { ox: rx + (cw - si * (ib.x1 - ib.x0)) / 2, oy: ty + (ch - si * (ib.y1 - ib.y0)) / 2, bb: ib, s: si };
  }
  const tx = (p, x, y) => [p.ox + (x - p.bb.x0) * p.s, p.oy + (p.bb.y1 - y) * p.s];

  // 출력 모음 (종이 좌표, mm, y 아래로)
  const out = { vis: [], hid: [], thin: [], text: [] };
  for (const k in place) {
    const p = place[k];
    for (const l of views[k].vis) out.vis.push([...tx(p, l[0], l[1]), ...tx(p, l[2], l[3])]);
    for (const l of views[k].hid) out.hid.push([...tx(p, l[0], l[1]), ...tx(p, l[2], l[3])]);
    const [cx] = tx(p, (p.bb.x0 + p.bb.x1) / 2, 0), [, by] = tx(p, 0, p.bb.y0);
    out.text.push({ x: cx, y: k === 'top' || k === 'iso' ? tx(p, 0, p.bb.y1)[1] - 4 : by + 19, s: 3, t: DRAW_VIEWS[k].label, a: 'middle' });
  }
  // 치수: 정면도 폭·높이, 평면도 깊이, 우측면도 깊이
  const dimH = (p, x0, x1, y, off, val) => { const [a, ya] = tx(p, x0, y), [b] = tx(p, x1, y), yy = ya + off; out.thin.push([a, ya + Math.sign(off) * 1.5, a, yy + Math.sign(off) * 1.5], [b, ya + Math.sign(off) * 1.5, b, yy + Math.sign(off) * 1.5]); arrowLine(out, a, yy, b, yy); out.text.push({ x: (a + b) / 2, y: yy - 1.2, s: 3.2, t: fmt(val), a: 'middle' }); };
  const dimV = (p, y0, y1, x, off, val) => { const [xa, a] = tx(p, x, y0), [, b] = tx(p, x, y1), xx = xa + off; out.thin.push([xa + Math.sign(off) * 1.5, a, xx + Math.sign(off) * 1.5, a], [xa + Math.sign(off) * 1.5, b, xx + Math.sign(off) * 1.5, b]); arrowLine(out, xx, a, xx, b); out.text.push({ x: xx - 1.2, y: (a + b) / 2, s: 3.2, t: fmt(val), a: 'middle', rot: -90 }); };
  dimH(place.front, fb.x0, fb.x1, fb.y0, 10, Wf);
  dimV(place.front, fb.y0, fb.y1, fb.x0, -10, Hf);
  dimV(place.top, tb.y0, tb.y1, tb.x0, -10, Ht);
  dimH(place.right, rb.x0, rb.x1, rb.y0, 10, Wr);

  // 테두리 · 표제란 · 부품표
  const frame = [[M, M, SW - M, M], [SW - M, M, SW - M, SH - M], [SW - M, SH - M, M, SH - M], [M, SH - M, M, M]];
  const tbx = SW - M - 180, tby = SH - M - 28;
  const tbl = [[tbx, tby, SW - M, tby], [tbx, tby, tbx, SH - M], [tbx, tby + 14, SW - M, tby + 14], [tbx + 60, tby, tbx + 60, SH - M], [tbx + 100, tby, tbx + 100, SH - M], [tbx + 140, tby, tbx + 140, SH - M]];
  const cellT = (x, y, label, val) => { out.text.push({ x: x + 2, y: y + 4.2, s: 2.2, t: label, a: 'start', muted: true }); out.text.push({ x: x + 2, y: y + 11, s: 3.4, t: val, a: 'start' }); };
  cellT(tbx, tby, '도면명', info.title || 'Draftline 모델'); cellT(tbx + 60, tby, '척도', scaleLabel(s)); cellT(tbx + 100, tby, '투상법', '3각법'); cellT(tbx + 140, tby, '단위', 'mm');
  cellT(tbx, tby + 14, '작성', 'Draftline'); cellT(tbx + 60, tby + 14, '날짜', info.date || ''); cellT(tbx + 100, tby + 14, '부품 수', String(info.parts.reduce((n, p) => n + p.qty, 0))); cellT(tbx + 140, tby + 14, '크기', `${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}`);
  // 부품표 (표제란 위로 쌓음)
  const rows = info.parts.slice(0, 8), rh = 6, cols = [0, 12, 72, 112, 132, 180];
  let py = tby - rh;
  const prow = (vals, head) => { for (let i = 0; i < 5; i++) out.text.push({ x: tbx + cols[i] + 1.5, y: py + 4.3, s: 2.6, t: vals[i], a: 'start', muted: head }); tbl.push([tbx, py, SW - M, py]); for (const c of cols.slice(1, 5)) tbl.push([tbx + c, py, tbx + c, py + rh]); py -= rh; };
  if (rows.length) {
    if (info.parts.length > rows.length) prow(['…', `외 ${info.parts.length - rows.length}종`, '', '', ''], true);
    for (let i = rows.length - 1; i >= 0; i--) { const p = rows[i]; prow([String(p.no), p.name, p.mat, String(p.qty), p.mass], false); }
    prow(['번호', '부품명', '재질', '수량', '질량 (g)'], true);
    tbl.push([tbx, py + rh, tbx, tby]);
  }
  out.text.push({ x: M + 4, y: SH - M - 4, s: 2.6, t: info.hidden ? '굵은 실선: 보이는 선 · 파선: 숨은 선 · 치수 단위 mm' : '굵은 실선: 보이는 선 · 치수 단위 mm', a: 'start', muted: true });

  return { svg: toSVG(out, frame, tbl, SW, SH), dxf: toDXF(out, frame, tbl, SH), scale: scaleLabel(s), counts: { vis: out.vis.length, hid: out.hid.length } };
}
function arrowLine(out, x0, y0, x1, y1) {
  out.thin.push([x0, y0, x1, y1]);
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L, ah = Math.min(2.5, L / 3), aw = ah * 0.3;
  for (const [x, y, sx] of [[x0, y0, 1], [x1, y1, -1]]) { const bx = x + ux * ah * sx, by = y + uy * ah * sx; out.thin.push([x, y, bx - uy * aw, by + ux * aw], [x, y, bx + uy * aw, by - ux * aw]); }
}
function toSVG(o, frame, tbl, SW, SH) {
  const r = v => +v.toFixed(3), L = s => `M${r(s[0])} ${r(s[1])}L${r(s[2])} ${r(s[3])}`;
  let h = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${SW}mm" height="${SH}mm" font-family="'IBM Plex Sans KR','Noto Sans KR',sans-serif">`;
  h += `<rect width="${SW}" height="${SH}" fill="#fff"/>`;
  h += `<path d="${frame.map(L).join('')}" stroke="#111" stroke-width="0.7" fill="none"/>`;
  h += `<path d="${tbl.map(L).join('')}" stroke="#111" stroke-width="0.35" fill="none"/>`;
  if (o.hid.length) h += `<path d="${o.hid.map(L).join('')}" stroke="#333" stroke-width="0.25" stroke-dasharray="1.6 0.8" fill="none" stroke-linecap="butt"/>`;
  h += `<path d="${o.vis.map(L).join('')}" stroke="#111" stroke-width="0.5" fill="none" stroke-linecap="round"/>`;
  h += `<path d="${o.thin.map(L).join('')}" stroke="#2456a6" stroke-width="0.18" fill="none"/>`;
  for (const t of o.text) h += `<text x="${r(t.x)}" y="${r(t.y)}" font-size="${t.s}" text-anchor="${t.a}" fill="${t.muted ? '#666' : '#111'}"${t.rot ? ` transform="rotate(${t.rot} ${r(t.x)} ${r(t.y)})"` : ''}>${escX(t.t)}</text>`;
  return h + `</svg>`;
}
function toDXF(o, frame, tbl, SH) {
  const out = [], g = (c, v) => { out.push(String(c)); out.push(typeof v === 'number' ? String(+v.toFixed(4)) : v); };
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, '_ _ _ _'); g(72, 65); g(73, 2); g(40, 2.4); g(49, 1.6); g(49, -0.8);
  g(0, 'ENDTAB'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, 4);
  for (const [n, c, lt] of [['VISIBLE', 7, 'CONTINUOUS'], ['HIDDEN', 8, 'HIDDEN'], ['DIM', 5, 'CONTINUOUS'], ['BORDER', 7, 'CONTINUOUS']]) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, lt); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (s, layer) => { g(0, 'LINE'); g(8, layer); g(10, s[0]); g(20, SH - s[1]); g(30, 0); g(11, s[2]); g(21, SH - s[3]); g(31, 0); };
  frame.forEach(s => line(s, 'BORDER')); tbl.forEach(s => line(s, 'BORDER'));
  o.vis.forEach(s => line(s, 'VISIBLE')); o.hid.forEach(s => line(s, 'HIDDEN')); o.thin.forEach(s => line(s, 'DIM'));
  for (const t of o.text) { const al = t.a === 'middle' ? 1 : 0; g(0, 'TEXT'); g(8, 'DIM'); g(10, t.x); g(20, SH - t.y); g(30, 0); g(40, t.s * 0.8); g(1, t.t); if (t.rot) g(50, -t.rot); if (al) { g(72, 1); g(11, t.x); g(21, SH - t.y); g(31, 0); } }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\n');
}

// ---------------------------------------------------------------- 3MF (ZIP, 무압축)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files /* [{name, data:Uint8Array}] */) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cenSize = cen.reduce((n, a) => n + a.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cenSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(e.buffer)], buf = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0; for (const a of all) { buf.set(a, p); p += a.length; }
  return buf;
}
export function make3MF(items /* [{name, geom, color}] */) {
  const enc = new TextEncoder();
  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="ko-KR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">Draftline</metadata>\n<resources>\n<basematerials id="1">`;
  for (const it of items) x += `<base name="${escX(it.name)}" displaycolor="${(it.color || '#9aa9b5').toUpperCase()}FF"/>`;
  x += `</basematerials>\n`;
  const chunks = [x];
  items.forEach((it, i) => {
    const a = it.geom.attributes.position.array, map = new Map(), vs = [], ts = [];
    const vid = j => { const k = `${a[j].toFixed(5)},${a[j + 1].toFixed(5)},${a[j + 2].toFixed(5)}`; let v = map.get(k); if (v === undefined) { v = vs.length; map.set(k, v); vs.push(`<vertex x="${+a[j].toFixed(5)}" y="${+a[j + 1].toFixed(5)}" z="${+a[j + 2].toFixed(5)}"/>`); } return v; };
    for (let j = 0; j < a.length; j += 9) { const v1 = vid(j), v2 = vid(j + 3), v3 = vid(j + 6); if (v1 !== v2 && v2 !== v3 && v1 !== v3) ts.push(`<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`); }
    chunks.push(`<object id="${i + 2}" name="${escX(it.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>\n`);
  });
  chunks.push(`</resources>\n<build>${items.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build>\n</model>\n`);
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`) },
    { name: '3D/3dmodel.model', data: enc.encode(chunks.join('')) },
  ];
  return zipStore(files);
}
