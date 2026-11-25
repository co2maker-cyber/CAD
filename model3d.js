// Draftline 3D 모델 작업공간: 스케치 프로파일 → 파라메트릭 피처 → 솔리드 바디
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

const D = window.Draftline;
const KEY = 'draftline.model.v1';
const $ = s => document.querySelector(s);
const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

const host = $('#view3d'), panel = $('#panel3d'), tl = $('#timeline');

// ---------------------------------------------------------------- 상태
const NAMES = { extrude: '돌출', revolve: '회전', box: '상자', cylinder: '원통', sphere: '구', cone: '원뿔', torus: '토러스', boolean: '결합', move: '이동', pattern: '패턴', mirror: '대칭', split: '분할' };
const ICON = { extrude: '⬆', revolve: '↻', box: '▣', cylinder: '◎', sphere: '●', cone: '▲', torus: '◯', boolean: '⊕', move: '✥', pattern: '⁞', mirror: '⇋', split: '⫽' };
const DEFAULTS = {
  extrude: { profiles: [], plane: 'XY', offset: 0, distance: 20, dir: 'one', op: 'new', target: '' },
  revolve: { profiles: [], plane: 'XY', offset: 0, axis: 'X', angle: 360, op: 'new', target: '' },
  box: { w: 40, d: 30, h: 20, x: 0, y: 0, z: 0, op: 'new', target: '' },
  cylinder: { r: 15, h: 30, x: 0, y: 0, z: 0, op: 'new', target: '' },
  sphere: { r: 20, x: 0, y: 0, z: 20, op: 'new', target: '' },
  cone: { r1: 20, r2: 0, h: 30, x: 0, y: 0, z: 0, op: 'new', target: '' },
  torus: { R: 30, r: 6, x: 0, y: 0, z: 6, op: 'new', target: '' },
  boolean: { target: '', tools: [], op: 'cut', keep: false },
  move: { body: '', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 },
  pattern: { body: '', kind: 'rect', nx: 3, dx: 30, ny: 1, dy: 30, n: 6, angle: 360, cx: 0, cy: 0 },
  mirror: { body: '', plane: 'YZ', offset: 0, merge: true },
  split: { body: '', plane: 'XY', offset: 10 },
};
const MATERIALS = [['steel', '강철', 7.85], ['al', '알루미늄', 2.70], ['brass', '황동', 8.50], ['abs', 'ABS', 1.04], ['pla', 'PLA', 1.24], ['wood', '나무', 0.60]];
const BODY_COLORS = ['#9aa9b5', '#c9773f', '#5b8fc7', '#6aa36f', '#c8a64a', '#8e6fc1'];

let state = { features: [], nextFid: 1, props: {} };
let undoS = [], redoS = [];
let bodies = [];             // [{id, name, geom}]
let errors = {};             // fid → 메시지
let beforeIds = {};          // fid → 그 피처 직전의 바디 목록
let draftTool = null;        // 편집 중인 잘라내기/교차 도구 형상 (미리보기)
let editing = null;          // {feat, isNew}
let selBody = null;
let regions = [], regionsByKey = new Map(), sketchLinesCache = [];
let view = { display: 'edges', sketch: true, section: false, secAxis: 'z', secPos: 0 };
let measure = { on: false, pts: [] };
let dirty = true;

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.features)) state = sanitizeState(d); else seed(); } catch (_) { seed(); }
  try { const v = JSON.parse(localStorage.getItem(KEY + '.view') || 'null'); if (v) view = Object.assign(view, v); } catch (_) {}
}
function seed() {
  state = { features: [], nextFid: 1, props: {} };
  const e1 = D.getEnts().find(e => e.id === 1 && e.type === 'rect');
  if (e1) state.features.push({ id: state.nextFid++, type: 'extrude', ...clone(DEFAULTS.extrude), profiles: ['1'], distance: 10 });
}
function sanitizeState(d) {
  const feats = d.features.filter(f => f && NAMES[f.type]).map(f => ({ ...clone(DEFAULTS[f.type]), ...f }));
  const nextFid = Math.max(d.nextFid | 0, ...feats.map(f => (f.id | 0) + 1), 1);
  return { features: feats, nextFid, props: d.props && typeof d.props === 'object' ? d.props : {} };
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(KEY + '.view', JSON.stringify({ display: view.display, sketch: view.sketch })); } catch (_) {}
}
function checkpoint() { undoS.push(JSON.stringify(state)); if (undoS.length > 100) undoS.shift(); redoS = []; }
function undo() { if (!undoS.length) return; redoS.push(JSON.stringify(state)); state = JSON.parse(undoS.pop()); editing = null; persist(); regen(); renderPanel(); }
function redo() { if (!redoS.length) return; undoS.push(JSON.stringify(state)); state = JSON.parse(redoS.pop()); editing = null; persist(); regen(); renderPanel(); }
const clone = o => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- 스케치 → 닫힌 윤곽 → 영역
function sampleArc(e) {
  const sw = D.arcSweep(e), n = Math.max(4, Math.ceil(sw / TAU * 96)), pts = [];
  for (let i = 0; i <= n; i++) { const a = e.a0 + sw * i / n; pts.push(V2(e.c.x + e.r * Math.cos(a), e.c.y + e.r * Math.sin(a))); }
  return pts;
}
function circlePts(e, n = 96) { const pts = []; for (let i = 0; i < n; i++) { const a = TAU * i / n; pts.push(V2(e.c.x + e.r * Math.cos(a), e.c.y + e.r * Math.sin(a))); } return pts; }
const rectPts = e => [V2(e.a.x, e.a.y), V2(e.b.x, e.a.y), V2(e.b.x, e.b.y), V2(e.a.x, e.b.y)];

function sketchLoops(ents) {
  const loops = [], curves = [];
  for (const e of ents) {
    if (e.type === 'circle') loops.push({ key: String(e.id), pts: circlePts(e), label: `원 #${e.id}` });
    else if (e.type === 'rect') loops.push({ key: String(e.id), pts: rectPts(e), label: `사각형 #${e.id}` });
    else if (e.type === 'pline' && e.closed && e.pts.length > 2) loops.push({ key: String(e.id), pts: e.pts.map(p => V2(p.x, p.y)), label: `폴리선 #${e.id}` });
    else if (e.type === 'line') curves.push({ id: e.id, pts: [V2(e.a.x, e.a.y), V2(e.b.x, e.b.y)] });
    else if (e.type === 'arc') curves.push({ id: e.id, pts: sampleArc(e) });
    else if (e.type === 'pline') curves.push({ id: e.id, pts: e.pts.map(p => V2(p.x, p.y)) });
  }
  // 끝점이 맞닿은 선·원호·열린 폴리선을 이어 닫힌 윤곽 찾기
  const K = p => Math.round(p.x * 1e3) + ',' + Math.round(p.y * 1e3), nodes = new Map();
  curves.forEach((c, i) => { for (const [end, p] of [[0, c.pts[0]], [1, c.pts[c.pts.length - 1]]]) { const k = K(p); if (!nodes.has(k)) nodes.set(k, []); nodes.get(k).push({ ci: i, end }); } });
  const used = new Set();
  curves.forEach((c, i) => {
    if (used.has(i)) return;
    const chain = [{ ci: i, rev: false }], seen = new Set([i]), sk = K(c.pts[0]);
    let ck = K(c.pts[c.pts.length - 1]), closed = false;
    for (let g = 0; g < 100000; g++) {
      if (ck === sk) { closed = true; break; }
      const list = nodes.get(ck); if (!list || list.length !== 2) break;
      const nx = list.find(x => !seen.has(x.ci)); if (!nx) break;
      seen.add(nx.ci); const cc = curves[nx.ci], rev = nx.end === 1; chain.push({ ci: nx.ci, rev });
      ck = K(rev ? cc.pts[0] : cc.pts[cc.pts.length - 1]);
    }
    if (!closed) return;
    chain.forEach(x => used.add(x.ci));
    const pts = [];
    for (const { ci, rev } of chain) { const p = curves[ci].pts.slice(); if (rev) p.reverse(); pts.push(...p.slice(0, -1)); }
    const ids = chain.map(x => curves[x.ci].id).sort((a, b) => a - b);
    if (pts.length >= 3) loops.push({ key: ids.join(','), pts, label: ids.length === 1 ? `폴리선 #${ids[0]}` : `닫힌 윤곽 (${ids.length}개 객체)` });
  });
  return loops;
}
function pip(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function sketchRegions(ents) {
  const loops = sketchLoops(ents);
  loops.forEach(l => { l.area = Math.abs(THREE.ShapeUtils.area(l.pts)); });
  loops.forEach(l => {
    l.parent = null; let best = Infinity;
    const probe = l.pts.reduce((s, p) => s.add(p), V2(0, 0)).multiplyScalar(1 / l.pts.length);
    const test = pip(probe, l.pts) ? probe : l.pts[0];
    for (const o of loops) if (o !== l && o.area > l.area && o.area < best && pip(test, o.pts)) { best = o.area; l.parent = o; }
  });
  return loops.map(l => {
    const holes = loops.filter(c => c.parent === l);
    return { key: l.key, label: l.label, outer: l.pts, holes: holes.map(h => h.pts), area: l.area - holes.reduce((s, h) => s + h.area, 0) };
  });
}
function regionShape(r) {
  const o = r.outer.slice(); if (THREE.ShapeUtils.isClockWise(o)) o.reverse();
  const s = new THREE.Shape(o);
  for (const h of r.holes) { const hh = h.slice(); if (!THREE.ShapeUtils.isClockWise(hh)) hh.reverse(); s.holes.push(new THREE.Path(hh)); }
  return s;
}

// ---------------------------------------------------------------- 형상 유틸
const PLANES = {
  XY: new THREE.Matrix4().identity(),
  XZ: new THREE.Matrix4().makeBasis(V3(1, 0, 0), V3(0, 0, 1), V3(0, -1, 0)),
  YZ: new THREE.Matrix4().makeBasis(V3(0, 1, 0), V3(0, 0, 1), V3(1, 0, 0)),
};
const PLANE_LABEL = { XY: 'XY (위)', XZ: 'XZ (앞)', YZ: 'YZ (오른쪽)' };
const planeMatrix = (plane, off) => new THREE.Matrix4().multiplyMatrices(PLANES[plane] || PLANES.XY, new THREE.Matrix4().makeTranslation(0, 0, +off || 0));

function prep(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.clearGroups(); g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}
function flipWinding(g) {
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
  g.attributes.position.needsUpdate = true; g.computeVertexNormals(); return g;
}
function transformed(g, m) { const c = g.clone(); c.applyMatrix4(m); if (m.determinant() < 0) flipWinding(c); c.computeVertexNormals(); c.computeBoundingBox(); return c; }
const triCount = g => g.attributes.position.count / 3;

const EV = new Evaluator(); EV.useGroups = false; EV.attributes = ['position', 'normal'];
const OPS = { join: ADDITION, cut: SUBTRACTION, intersect: INTERSECTION };
function csg(ga, gb, op) {
  const A = new Brush(ga.clone()), B = new Brush(gb.clone());
  A.updateMatrixWorld(); B.updateMatrixWorld();
  return prep(EV.evaluate(A, B, OPS[op]).geometry);
}

function revolveGeom(regs, axis, angleDeg) {
  const ang = Math.min(360, Math.abs(+angleDeg || 0)) * DEG;
  if (ang < 1e-6) throw new Error('각도는 0보다 커야 합니다');
  const full = Math.abs(ang - TAU) < 1e-9, steps = Math.max(6, Math.ceil(96 * ang / TAU));
  const { o, d } = axis, perp = V2(-d.y, d.x);
  let pos = false, neg = false;
  const rel = p => { const q = p.clone().sub(o); const u = q.dot(perp); if (u > 1e-7) pos = true; if (u < -1e-7) neg = true; return V2(Math.abs(u), q.dot(d)); };
  const conv = regs.map(r => ({ outer: r.outer.map(rel), holes: r.holes.map(h => h.map(rel)) }));
  if (pos && neg) throw new Error('프로파일이 회전축을 가로지릅니다 — 축 한쪽에만 있어야 합니다');
  const sg = neg ? -1 : 1, n = V2(perp.x * sg, perp.y * sg);
  const map = (p, phi) => V3(o.x + d.x * p.y + n.x * p.x * Math.cos(phi), o.y + d.y * p.y + n.y * p.x * Math.cos(phi), p.x * Math.sin(phi));
  const radial = phi => V3(n.x * Math.cos(phi), n.y * Math.cos(phi), Math.sin(phi)), d3 = V3(d.x, d.y, 0);
  const out = [], ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const tri = (a, b, c, expect) => {
    ab.subVectors(b, a); ac.subVectors(c, a); const nr = ab.clone().cross(ac);
    if (nr.lengthSq() < 1e-18) return;
    if (nr.dot(expect) < 0) [b, c] = [c, b];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (const r of conv) {
    const outer = r.outer.slice(); if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
    const holes = r.holes.map(h => { const hh = h.slice(); if (!THREE.ShapeUtils.isClockWise(hh)) hh.reverse(); return hh; });
    for (const L of [outer, ...holes]) {
      for (let i = 0; i < L.length; i++) {
        const a = L[i], b = L[(i + 1) % L.length], ex = b.x - a.x, ey = b.y - a.y;
        for (let j = 0; j < steps; j++) {
          const p0 = ang * j / steps, p1 = ang * (j + 1) / steps, pm = (p0 + p1) / 2;
          const expect = radial(pm).multiplyScalar(ey).add(d3.clone().multiplyScalar(-ex));
          const A = map(a, p0), B = map(b, p0), C = map(b, p1), Dd = map(a, p1);
          tri(A, B, C, expect); tri(A, C, Dd, expect);
        }
      }
    }
    if (!full) {
      const faces = THREE.ShapeUtils.triangulateShape(outer, holes), all = [outer, ...holes].flat();
      const e0 = V3(0, 0, -1), e1 = V3(-n.x * Math.sin(ang), -n.y * Math.sin(ang), Math.cos(ang));
      for (const [i, j, k] of faces) {
        tri(map(all[i], 0), map(all[j], 0), map(all[k], 0), e0);
        tri(map(all[i], ang), map(all[j], ang), map(all[k], ang), e1);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}
function axisOf(f, ents) {
  if (f.axis === 'X') return { o: V2(0, 0), d: V2(1, 0) };
  if (f.axis === 'Y') return { o: V2(0, 0), d: V2(0, 1) };
  const id = +String(f.axis).slice(1), e = ents.find(x => x.id === id && x.type === 'line');
  if (!e) throw new Error('회전축으로 고른 선이 스케치에 없습니다');
  const d = V2(e.b.x - e.a.x, e.b.y - e.a.y); if (d.length() < 1e-9) throw new Error('회전축 선의 길이가 0입니다');
  return { o: V2(e.a.x, e.a.y), d: d.normalize() };
}

// ---------------------------------------------------------------- 피처 실행
function toolGeom(f, ents) {
  const num = (k, min) => { const v = +f[k]; if (!isFinite(v)) throw new Error(`${k} 값이 숫자가 아닙니다`); if (min != null && !(v > min)) throw new Error('크기는 0보다 커야 합니다'); return v; };
  if (f.type === 'extrude' || f.type === 'revolve') {
    if (!f.profiles.length) throw new Error('프로파일을 하나 이상 고르세요 — 화면의 면을 클릭하거나 목록에서 체크');
    const regs = f.profiles.map(k => regionsByKey.get(k));
    if (regs.some(r => !r)) throw new Error('참조한 스케치 프로파일이 사라졌습니다 — 스케치를 바꿨다면 프로파일을 다시 고르세요');
    let g;
    if (f.type === 'extrude') {
      const dist = num('distance'); if (Math.abs(dist) < 1e-6) throw new Error('거리는 0이 아니어야 합니다');
      g = new THREE.ExtrudeGeometry(regs.map(regionShape), { depth: Math.abs(dist), bevelEnabled: false, curveSegments: 1 });
      g.translate(0, 0, f.dir === 'sym' ? -Math.abs(dist) / 2 : dist < 0 ? dist : 0);
    } else g = revolveGeom(regs, axisOf(f, ents), num('angle'));
    g.applyMatrix4(planeMatrix(f.plane, f.offset));
    return prep(g);
  }
  let g;
  switch (f.type) {
    case 'box': g = new THREE.BoxGeometry(num('w', 0), num('d', 0), num('h', 0)); g.translate(+f.x, +f.y, +f.z + f.h / 2); break;
    case 'cylinder': g = new THREE.CylinderGeometry(num('r', 0), +f.r, num('h', 0), 96); g.rotateX(Math.PI / 2); g.translate(+f.x, +f.y, +f.z + f.h / 2); break;
    case 'sphere': g = new THREE.SphereGeometry(num('r', 0), 64, 32); g.translate(+f.x, +f.y, +f.z); break;
    case 'cone': { const r1 = num('r1', -1e-9), r2 = num('r2', -1e-9); if (r1 <= 0 && r2 <= 0) throw new Error('반지름 하나는 0보다 커야 합니다'); g = new THREE.CylinderGeometry(r2, r1, num('h', 0), 96); g.rotateX(Math.PI / 2); g.translate(+f.x, +f.y, +f.z + f.h / 2); break; }
    case 'torus': { const R = num('R', 0), r = num('r', 0); if (r >= R) throw new Error('관 반지름은 중심 반지름보다 작아야 합니다'); g = new THREE.TorusGeometry(R, r, 32, 96); g.translate(+f.x, +f.y, +f.z); break; }
  }
  return prep(g);
}
let bodyCounter = 0;
function newBody(id) { bodyCounter++; const b = { id, name: (state.props[id] && state.props[id].name) || `바디${bodyCounter}` }; return b; }
const findBody = id => bodies.find(b => b.id === id);
function targetOf(f, key = 'target') {
  const t = findBody(f[key]) || (key === 'target' ? bodies[bodies.length - 1] : null);
  if (!t) throw new Error(key === 'target' ? '대상 바디가 없습니다' : '바디를 고르세요');
  return t;
}
function runFeature(f, ents, isDraft) {
  const bid = 'b' + f.id;
  if (['extrude', 'revolve', 'box', 'cylinder', 'sphere', 'cone', 'torus'].includes(f.type)) {
    const g = toolGeom(f, ents);
    if (f.op === 'new' || !bodies.length) { if (f.op === 'cut' || f.op === 'intersect') { if (!bodies.length) throw new Error('잘라내거나 교차할 바디가 없습니다'); } else { const b = newBody(bid); b.geom = g; bodies.push(b); return; } }
    const t = targetOf(f);
    if (isDraft && f.op !== 'join') draftTool = g;
    t.geom = csg(t.geom, g, f.op);
    if (!triCount(t.geom)) throw new Error('결과가 비어 있습니다 — 도구가 바디와 겹치지 않거나 바디 전체를 지웠습니다');
    return;
  }
  switch (f.type) {
    case 'boolean': {
      const t = targetOf(f), tools = (f.tools || []).map(findBody).filter(b => b && b !== t);
      if (!tools.length) throw new Error('도구 바디를 하나 이상 고르세요');
      for (const tb of tools) { if (isDraft && f.op !== 'join') draftTool = tb.geom; t.geom = csg(t.geom, tb.geom, f.op); }
      if (!f.keep) bodies = bodies.filter(b => !tools.includes(b));
      if (!triCount(t.geom)) throw new Error('결과가 비어 있습니다');
      return;
    }
    case 'move': {
      const b = targetOf(f, 'body');
      const m = new THREE.Matrix4().makeTranslation(+f.dx || 0, +f.dy || 0, +f.dz || 0)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((+f.rx || 0) * DEG, (+f.ry || 0) * DEG, (+f.rz || 0) * DEG, 'XYZ')));
      b.geom = transformed(b.geom, m); return;
    }
    case 'pattern': {
      const b = targetOf(f, 'body'), base = b.geom, mats = [];
      if (f.kind === 'rect') {
        const nx = Math.max(1, Math.min(50, f.nx | 0)), ny = Math.max(1, Math.min(50, f.ny | 0));
        if (nx * ny > 200) throw new Error('복사본은 200개까지 만들 수 있습니다');
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (i || j) mats.push(new THREE.Matrix4().makeTranslation(i * f.dx, j * f.dy, 0));
      } else {
        const n = Math.max(2, Math.min(200, f.n | 0)), a = Math.min(360, Math.abs(+f.angle || 360)), step = (Math.abs(a - 360) < 1e-9 ? a / n : a / (n - 1)) * DEG * Math.sign(+f.angle || 1);
        for (let i = 1; i < n; i++) mats.push(new THREE.Matrix4().makeTranslation(+f.cx, +f.cy, 0).multiply(new THREE.Matrix4().makeRotationZ(step * i)).multiply(new THREE.Matrix4().makeTranslation(-f.cx, -f.cy, 0)));
      }
      if (!mats.length) throw new Error('개수를 2개 이상으로 하세요');
      for (const m of mats) b.geom = csg(b.geom, transformed(base, m), 'join');
      return;
    }
    case 'mirror': {
      const b = targetOf(f, 'body'), off = +f.offset || 0, ax = { YZ: 0, XZ: 1, XY: 2 }[f.plane] ?? 0;
      const s = [1, 1, 1]; s[ax] = -1; const t = [0, 0, 0]; t[ax] = off;
      const m = new THREE.Matrix4().makeTranslation(...t).multiply(new THREE.Matrix4().makeScale(...s)).multiply(new THREE.Matrix4().makeTranslation(-t[0], -t[1], -t[2]));
      const mg = transformed(b.geom, m);
      if (f.merge) b.geom = csg(b.geom, mg, 'join'); else { const nb = newBody(bid); nb.geom = mg; bodies.push(nb); }
      return;
    }
    case 'split': {
      const b = targetOf(f, 'body'); b.geom.computeBoundingBox();
      const bb = b.geom.boundingBox, size = bb.getSize(V3(0, 0, 0)).length() * 4 + 100, c = bb.getCenter(V3(0, 0, 0));
      const ax = { YZ: 0, XZ: 1, XY: 2 }[f.plane] ?? 2, off = +f.offset || 0;
      const half = sign => { const g = new THREE.BoxGeometry(size, size, size); const p = [c.x, c.y, c.z]; p[ax] = off + sign * size / 2; g.translate(...p); return prep(g); };
      const A = csg(b.geom, half(1), 'intersect'), B = csg(b.geom, half(-1), 'intersect');
      if (!triCount(A) || !triCount(B)) throw new Error('분할 평면이 바디를 지나지 않습니다');
      b.geom = B; const nb = newBody(bid); nb.geom = A; bodies.push(nb);
      return;
    }
  }
}
function featureList() {
  const list = state.features.slice();
  if (editing) { const i = list.findIndex(f => f.id === editing.feat.id); if (i >= 0) list[i] = editing.feat; else list.push(editing.feat); }
  return list;
}
function regen() {
  const ents = D.getEnts();
  regions = sketchRegions(ents); regionsByKey = new Map(regions.map(r => [r.key, r]));
  for (const b of bodies) b.geom && b.geom.dispose();
  bodies = []; errors = {}; beforeIds = {}; bodyCounter = 0; draftTool = null;
  for (const f of featureList()) {
    beforeIds[f.id] = bodies.map(b => ({ id: b.id, name: b.name }));
    if (f.suppressed) continue;
    const snap = bodies.map(b => ({ ...b }));
    try { runFeature(f, ents, editing && editing.feat === f); }
    catch (err) { errors[f.id] = err && err.message ? err.message : String(err); bodies = snap; }
  }
  if (selBody && !findBody(selBody)) selBody = null;
  dirty = false;
  rebuildScene(); renderTimeline();
  if (editing) updateDlgStatus(); else renderPanel();
}

// ---------------------------------------------------------------- three.js 장면
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.localClippingEnabled = true;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200000);
camera.up.set(0, 0, 1); camera.position.set(180, -260, 190);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; controls.screenSpacePanning = true;
controls.addEventListener('change', draw);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.6, 0.4, 1); camera.add(key); scene.add(camera);
const gBodies = new THREE.Group(), gSketch = new THREE.Group(), gMeasure = new THREE.Group(), gHelpers = new THREE.Group();
scene.add(gHelpers, gBodies, gSketch, gMeasure);
const clipPlane = new THREE.Plane(V3(0, 0, -1), 0);
let T = {};

function readTheme() {
  const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue('--' + k).trim();
  T = { canvas: g('canvas'), grid: g('grid-major'), gridMinor: g('grid'), accent: g('accent'), ink: g('ink'), muted: g('muted'), c1: g('c1'), c4: g('c4') };
  scene.background = new THREE.Color(T.canvas || '#ffffff');
  gHelpers.clear();
  const grid = new THREE.GridHelper(400, 40, T.grid, T.gridMinor); grid.rotation.x = Math.PI / 2; gHelpers.add(grid);
  const ax = (dir, col) => { const g = new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), dir.multiplyScalar(40)]); return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })); };
  gHelpers.add(ax(V3(1, 0, 0), '#d0453a'), ax(V3(0, 1, 0), '#3f9a4b'), ax(V3(0, 0, 1), '#3d72c8'));
}
function disposeGroup(g) { g.traverse(o => { if (o.geometry && !o.userData.keepGeom) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); g.clear(); }
function bodyColor(b, i) { const p = state.props[b.id]; return (p && p.color) || BODY_COLORS[i % BODY_COLORS.length]; }

function rebuildScene() {
  disposeGroup(gBodies); disposeGroup(gSketch);
  const clip = view.section ? [clipPlane] : [];
  if (view.section) { const n = { x: V3(-1, 0, 0), y: V3(0, -1, 0), z: V3(0, 0, -1) }[view.secAxis]; clipPlane.set(n, +view.secPos); }
  const xray = view.display === 'xray', wire = view.display === 'wire';
  bodies.forEach((b, i) => {
    if (state.props[b.id] && state.props[b.id].hidden) return;
    const sel = b.id === selBody;
    const mat = new THREE.MeshStandardMaterial({
      color: bodyColor(b, i), roughness: 0.55, metalness: 0.08, side: view.section ? THREE.DoubleSide : THREE.FrontSide,
      transparent: xray || wire, opacity: wire ? 0.06 : xray ? 0.35 : 1, depthWrite: !(xray || wire), clippingPlanes: clip,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      emissive: sel ? new THREE.Color(T.accent) : new THREE.Color(0), emissiveIntensity: sel ? 0.28 : 0,
    });
    const mesh = new THREE.Mesh(b.geom, mat); mesh.userData = { bid: b.id, keepGeom: true }; gBodies.add(mesh);
    if (view.display !== 'shaded') {
      const eg = new THREE.EdgesGeometry(b.geom, 25);
      gBodies.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: sel ? T.accent : (wire ? T.ink : '#1e272d'), clippingPlanes: clip, transparent: true, opacity: wire ? 0.9 : 0.75 })));
    }
  });
  if (draftTool) {
    const m = new THREE.Mesh(draftTool, new THREE.MeshBasicMaterial({ color: T.c1, transparent: true, opacity: 0.18, depthWrite: false }));
    m.userData.keepGeom = true; gBodies.add(m);
    gBodies.add(new THREE.LineSegments(new THREE.EdgesGeometry(draftTool, 25), new THREE.LineBasicMaterial({ color: T.c1 })));
  }
  // 스케치 (XY 평면)
  const picking = editing && (editing.feat.type === 'extrude' || editing.feat.type === 'revolve');
  if (view.sketch || picking) {
    const ents = D.getEnts(), segs = [];
    const addPoly = (pts, closed) => { for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push(a.x, a.y, 0.02, b.x, b.y, 0.02); } };
    for (const e of ents) {
      if (e.type === 'line') addPoly([e.a, e.b], false);
      else if (e.type === 'rect') addPoly(rectPts(e), true);
      else if (e.type === 'pline') addPoly(e.pts, e.closed);
      else if (e.type === 'circle') addPoly(circlePts(e), true);
      else if (e.type === 'arc') addPoly(sampleArc(e), false);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    gSketch.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: T.muted, transparent: true, opacity: picking ? 0.9 : 0.6 })));
    if (picking) {
      const chosen = new Set(editing.feat.profiles);
      regions.forEach(r => {
        const on = chosen.has(r.key);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(regionShape(r), 1), new THREE.MeshBasicMaterial({ color: on ? T.accent : T.c4, transparent: true, opacity: on ? 0.45 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
        m.position.z = 0.03; m.userData.region = r.key; gSketch.add(m);
      });
      if (editing.feat.type === 'revolve') {
        try { const a = axisOf(editing.feat, ents); const L = 400; const g = new THREE.BufferGeometry().setFromPoints([V3(a.o.x - a.d.x * L, a.o.y - a.d.y * L, 0.05), V3(a.o.x + a.d.x * L, a.o.y + a.d.y * L, 0.05)]);
          const ln = new THREE.Line(g, new THREE.LineDashedMaterial({ color: T.accent, dashSize: 4, gapSize: 3 })); ln.computeLineDistances(); gSketch.add(ln); } catch (_) {}
      }
    }
  }
  rebuildMeasure();
  draw();
}
function rebuildMeasure() {
  disposeGroup(gMeasure);
  for (const p of measure.pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: T.accent, depthTest: false })); s.position.copy(p); s.renderOrder = 10; s.scale.setScalar(sizeAt(p) * 0.008); gMeasure.add(s); }
  if (measure.pts.length === 2) { const g = new THREE.BufferGeometry().setFromPoints(measure.pts); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: T.accent, depthTest: false })); l.renderOrder = 10; gMeasure.add(l); }
}
const sizeAt = p => camera.position.distanceTo(p);
let raf = 0;
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (document.body.dataset.workspace === '3d') renderer.render(scene, camera); }); }
function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); draw(); }
new ResizeObserver(resize).observe(host);

function sceneBox() {
  const box = new THREE.Box3();
  bodies.forEach(b => { if (!(state.props[b.id] && state.props[b.id].hidden)) { b.geom.computeBoundingBox(); box.union(b.geom.boundingBox); } });
  if (box.isEmpty()) { for (const r of regions) for (const p of r.outer) box.expandByPoint(V3(p.x, p.y, 0)); }
  if (box.isEmpty()) box.set(V3(-50, -50, 0), V3(50, 50, 30));
  return box;
}
function setView(dir) {
  const box = sceneBox(), c = box.getCenter(V3(0, 0, 0)), r = Math.max(10, box.getSize(V3(0, 0, 0)).length() / 2);
  const dist = r / Math.sin(camera.fov * DEG / 2) * 1.1;
  const v = (dir || camera.position.clone().sub(controls.target)).clone().normalize();
  camera.position.copy(c).addScaledVector(v, dist); controls.target.copy(c); camera.near = dist / 200; camera.far = dist * 50; camera.updateProjectionMatrix(); controls.update(); draw();
}
const VIEWS = { top: V3(0, -0.0001, 1), front: V3(0, -1, 0), right: V3(1, 0, 0), iso: V3(1, -1.2, 0.9) };

// ---------------------------------------------------------------- 물리 속성
function massProps(g) {
  const a = g.attributes.position.array; let V = 0, A = 0, cx = 0, cy = 0, cz = 0;
  const p = V3(), q = V3(), r = V3(), t = V3();
  for (let i = 0; i < a.length; i += 9) {
    p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
    const v = p.dot(t.copy(q).cross(r)) / 6; V += v; cx += v * (p.x + q.x + r.x) / 4; cy += v * (p.y + q.y + r.y) / 4; cz += v * (p.z + q.z + r.z) / 4;
    A += t.subVectors(q, p).cross(V3().subVectors(r, p)).length() / 2;
  }
  g.computeBoundingBox();
  return { V, A, c: Math.abs(V) > 1e-12 ? V3(cx / V, cy / V, cz / V) : V3(), bb: g.boundingBox };
}

// ---------------------------------------------------------------- 패널
function bodiesBefore(f) { return beforeIds[f.id] || bodies.map(b => ({ id: b.id, name: b.name })); }
function opts(list, cur) { return list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join(''); }
const OPLIST = [['new', '새 바디'], ['join', '결합 (더하기)'], ['cut', '잘라내기 (빼기)'], ['intersect', '교차 (겹친 부분만)']];
function fieldDefs(f) {
  const N = (k, l) => ({ k, l, t: 'num' }), S = (k, l, list) => ({ k, l, t: 'sel', list });
  const opTarget = [S('op', '작업', OPLIST), ...(f.op !== 'new' ? [{ k: 'target', l: '대상 바디', t: 'body' }] : [])];
  const pos = [N('x', '위치 X'), N('y', '위치 Y'), N('z', '위치 Z')];
  const planes = Object.entries(PLANE_LABEL);
  switch (f.type) {
    case 'extrude': return [{ k: 'profiles', t: 'profiles' }, S('plane', '스케치 평면', planes), N('offset', '평면 간격'), N('distance', '거리'), S('dir', '방향', [['one', '한 방향 (음수면 반대)'], ['sym', '대칭 (양쪽)']]), ...opTarget];
    case 'revolve': {
      const lines = D.getEnts().filter(e => e.type === 'line').map(e => ['L' + e.id, `선 #${e.id}`]);
      return [{ k: 'profiles', t: 'profiles' }, S('axis', '회전축', [['X', '스케치 X축'], ['Y', '스케치 Y축'], ...lines]), N('angle', '각도°'), S('plane', '스케치 평면', planes), N('offset', '평면 간격'), ...opTarget];
    }
    case 'box': return [N('w', '폭 X'), N('d', '깊이 Y'), N('h', '높이 Z'), ...pos, ...opTarget];
    case 'cylinder': return [N('r', '반지름'), N('h', '높이'), ...pos, ...opTarget];
    case 'sphere': return [N('r', '반지름'), ...pos, ...opTarget];
    case 'cone': return [N('r1', '아래 반지름'), N('r2', '위 반지름'), N('h', '높이'), ...pos, ...opTarget];
    case 'torus': return [N('R', '중심 반지름'), N('r', '관 반지름'), ...pos, ...opTarget];
    case 'boolean': return [{ k: 'target', l: '대상 바디', t: 'body' }, { k: 'tools', t: 'tools' }, S('op', '작업', OPLIST.slice(1)), { k: 'keep', l: '도구 바디 남기기', t: 'chk' }];
    case 'move': return [{ k: 'body', l: '바디', t: 'body' }, N('dx', '이동 X'), N('dy', '이동 Y'), N('dz', '이동 Z'), N('rx', '회전 X°'), N('ry', '회전 Y°'), N('rz', '회전 Z°')];
    case 'pattern': return [{ k: 'body', l: '바디', t: 'body' }, S('kind', '종류', [['rect', '직사각형 배열'], ['circ', '원형 배열 (Z축)']]),
      ...(f.kind === 'rect' ? [N('nx', 'X 개수'), N('dx', 'X 간격'), N('ny', 'Y 개수'), N('dy', 'Y 간격')] : [N('n', '개수'), N('angle', '전체 각도°'), N('cx', '중심 X'), N('cy', '중심 Y')])];
    case 'mirror': return [{ k: 'body', l: '바디', t: 'body' }, S('plane', '대칭 평면', planes), N('offset', '평면 위치'), { k: 'merge', l: '원본과 합치기', t: 'chk' }];
    case 'split': return [{ k: 'body', l: '바디', t: 'body' }, S('plane', '분할 평면', planes), N('offset', '평면 위치')];
  }
  return [];
}
function renderDialog() {
  const f = editing.feat, before = bodiesBefore(f);
  let h = `<section><h2>${ICON[f.type]} ${NAMES[f.type]}${editing.isNew ? '' : ' 편집'}</h2><div class="fields">`;
  for (const d of fieldDefs(f)) {
    const id = 'f-' + d.k;
    if (d.t === 'num') h += `<label for="${id}">${d.l}</label><input id="${id}" data-k="${d.k}" inputmode="decimal" value="${esc(f[d.k])}">`;
    else if (d.t === 'sel') h += `<label for="${id}">${d.l}</label><select id="${id}" data-k="${d.k}" data-rerender="1">${opts(d.list, f[d.k])}</select>`;
    else if (d.t === 'chk') h += `<label for="${id}">${d.l}</label><input id="${id}" data-k="${d.k}" type="checkbox" ${f[d.k] ? 'checked' : ''} style="width:auto;justify-self:start">`;
    else if (d.t === 'body') {
      const cur = f[d.k] || (before.length ? before[before.length - 1].id : '');
      if (!f[d.k] && cur) f[d.k] = cur;
      h += `<label for="${id}">${d.l}</label><select id="${id}" data-k="${d.k}">${before.length ? opts(before.map(b => [b.id, b.name]), cur) : '<option value="">(바디 없음)</option>'}</select>`;
    }
    else if (d.t === 'tools') {
      h += `</div><p class="hint" style="margin:10px 0 4px">도구 바디</p><div class="plist">`;
      const list = before.filter(b => b.id !== f.target);
      h += list.length ? list.map(b => `<label class="prow"><input type="checkbox" data-tool="${esc(b.id)}" ${f.tools.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('') : '<p class="hint">다른 바디가 없습니다</p>';
      h += `</div><div class="fields" style="margin-top:8px">`;
    }
    else if (d.t === 'profiles') {
      h += `</div><p class="hint" style="margin:0 0 6px">프로파일 — 화면의 면을 클릭하거나 체크하세요</p><div class="plist">`;
      h += regions.length ? regions.map(r => `<label class="prow"><input type="checkbox" data-prof="${esc(r.key)}" ${f.profiles.includes(r.key) ? 'checked' : ''}> ${esc(r.label)}${r.holes.length ? ` · 구멍 ${r.holes.length}` : ''}<span>${fmt(r.area)} mm²</span></label>`).join('')
        : '<p class="hint">스케치에 닫힌 윤곽이 없습니다. 스케치 작업공간에서 사각형·원·닫힌 폴리선을 그리세요.</p>';
      h += `</div><div class="fields" style="margin-top:10px">`;
    }
  }
  h += `</div><p class="dlg-err" id="dlgErr" role="status"></p><div class="row" style="margin-top:6px">`;
  if (!editing.isNew) h += `<label class="prow" style="flex:1"><input type="checkbox" id="fSup" ${f.suppressed ? 'checked' : ''}> 끄기 (억제)</label>`;
  else h += `<div class="spacer"></div>`;
  h += `<button class="btn" id="dlgCancel">취소</button><button class="btn primary" id="dlgOk">확인</button></div>`;
  if (!editing.isNew) h += `<div class="row" style="margin-top:8px"><button class="btn danger" id="dlgDel">피처 삭제</button></div>`;
  h += `</section>`;
  panel.innerHTML = h; updateDlgStatus();
}
function updateDlgStatus() {
  const el = $('#dlgErr'); if (!el || !editing) return;
  const err = errors[editing.feat.id];
  el.textContent = err ? err : '';
  const ok = $('#dlgOk'); if (ok) ok.disabled = !!err && !editing.feat.suppressed;
  panel.querySelectorAll('[data-prof]').forEach(c => { c.checked = editing.feat.profiles.includes(c.dataset.prof); });
}
function renderPanel() {
  if (editing) { renderDialog(); return; }
  let h = `<section><h2>브라우저</h2><div class="plist">`;
  h += `<div class="brow"><button class="eye" data-eye="sketch" aria-pressed="${view.sketch}" title="스케치 보이기/숨기기">${view.sketch ? '◉' : '○'}</button><span>스케치 (XY)</span><span class="muted">${regions.length}개 프로파일</span></div>`;
  bodies.forEach((b, i) => {
    const p = state.props[b.id] || {};
    h += `<div class="brow${b.id === selBody ? ' on' : ''}" data-bid="${esc(b.id)}"><button class="eye" data-eye="${esc(b.id)}" aria-pressed="${!p.hidden}" title="보이기/숨기기">${p.hidden ? '○' : '◉'}</button><span class="dot" style="background:${esc(bodyColor(b, i))}"></span><span>${esc(b.name)}</span></div>`;
  });
  if (!bodies.length) h += `<p class="hint">아직 바디가 없습니다. 위 도구 막대에서 <b>돌출</b>이나 <b>상자</b>로 시작하세요.</p>`;
  h += `</div></section>`;
  const b = selBody && findBody(selBody);
  if (b) {
    const i = bodies.indexOf(b), p = state.props[b.id] || {}, mp = massProps(b.geom), sz = mp.bb.getSize(V3(0, 0, 0));
    const mat = MATERIALS.find(m => m[0] === p.mat) || MATERIALS[0];
    h += `<section><h2>${esc(b.name)}</h2><div class="fields"><label for="bName">이름</label><input id="bName" value="${esc(b.name)}">
      <label for="bMat">재질</label><select id="bMat">${opts(MATERIALS.map(m => [m[0], `${m[1]} (${m[2]} g/cm³)`]), mat[0])}</select></div>
      <div class="swatches" style="margin-top:10px">${BODY_COLORS.map(c => `<button class="sw" data-bcolor="${c}" aria-pressed="${bodyColor(b, i) === c}" style="background:${c}" title="색상"></button>`).join('')}</div>
      <dl class="info" style="margin-top:12px"><dt>부피</dt><dd>${fmt(mp.V / 1000)} cm³</dd><dt>표면적</dt><dd>${fmt(mp.A)} mm²</dd>
      <dt>질량</dt><dd>${fmt(mp.V / 1000 * mat[2])} g</dd><dt>크기</dt><dd>${fmt(sz.x)} × ${fmt(sz.y)} × ${fmt(sz.z)}</dd>
      <dt>무게중심</dt><dd>${fmt(mp.c.x)}, ${fmt(mp.c.y)}, ${fmt(mp.c.z)}</dd><dt>삼각형</dt><dd>${triCount(b.geom).toLocaleString()}</dd></dl></section>`;
  }
  if (measure.on) {
    let m = '모델 표면의 두 점을 클릭하세요';
    if (measure.pts.length === 1) m = '두 번째 점을 클릭하세요';
    if (measure.pts.length === 2) { const [a, c] = measure.pts, d = c.clone().sub(a); m = `<b>${fmt(d.length())} mm</b><br>ΔX ${fmt(d.x)} · ΔY ${fmt(d.y)} · ΔZ ${fmt(d.z)}`; }
    h += `<section><h2>측정</h2><p class="hint">${m}</p></section>`;
  }
  const box = sceneBox(), ax = { x: 'x', y: 'y', z: 'z' }[view.secAxis];
  h += `<section><h2>보기</h2><div class="fields"><label for="vDisp">표시</label><select id="vDisp">${opts([['edges', '음영 + 모서리'], ['shaded', '음영'], ['xray', '반투명'], ['wire', '와이어프레임']], view.display)}</select>
    <label for="vSec">단면</label><select id="vSec">${opts([['off', '끄기'], ['x', 'X 방향'], ['y', 'Y 방향'], ['z', 'Z 방향']], view.section ? view.secAxis : 'off')}</select></div>
    ${view.section ? `<input type="range" id="vSecPos" min="${box.min[ax] - 1}" max="${box.max[ax] + 1}" step="0.1" value="${view.secPos}" style="width:100%;margin-top:8px" aria-label="단면 위치"><p class="hint">단면 위치 ${fmt(view.secPos)} mm</p>` : ''}
    </section>`;
  h += `<section><h2>도움말</h2><div class="keys"><b>왼쪽 끌기</b><span>회전</span><b>오른쪽 끌기</b><span>이동</span><b>휠</b><span>확대·축소</span><b>E</b><span>돌출</span><b>Ctrl+Z/Y</b><span>실행 취소/다시</span><b>Esc</b><span>취소</span></div>
    <p class="hint" style="margin-top:8px">타임라인의 피처를 누르면 값을 고칠 수 있고, 스케치를 바꾸면 모델이 다시 계산됩니다.</p></section>`;
  panel.innerHTML = h;
}
function renderTimeline() {
  const counts = {};
  let h = `<span class="tl-label">타임라인</span>`;
  for (const f of featureList()) {
    counts[f.type] = (counts[f.type] || 0) + 1;
    const cls = ['chip', errors[f.id] ? 'err' : '', f.suppressed ? 'sup' : '', editing && editing.feat.id === f.id ? 'on' : ''].join(' ');
    h += `<button class="${cls}" data-fid="${f.id}" title="${esc(errors[f.id] || NAMES[f.type])}">${ICON[f.type]} ${NAMES[f.type]}${counts[f.type]}</button>`;
  }
  if (!state.features.length && !editing) h += `<span class="muted">피처가 여기에 순서대로 쌓입니다</span>`;
  tl.innerHTML = h;
}

// ---------------------------------------------------------------- 명령
function startFeature(type) {
  if (editing) cancelEdit(false);
  measureOff();
  const f = { id: state.nextFid, type, ...clone(DEFAULTS[type]) };
  if (type === 'extrude' || type === 'revolve') {
    if (!view.sketch) { view.sketch = true; }
  }
  if ((type === 'boolean' || type === 'move' || type === 'pattern' || type === 'mirror' || type === 'split') && !bodies.length) { flash('먼저 바디를 만드세요 — 돌출이나 상자부터 시작합니다'); return; }
  if (selBody) { if ('body' in f) f.body = selBody; if (type === 'boolean') f.target = selBody; }
  editing = { feat: f, isNew: true };
  if (type === 'extrude' || type === 'revolve') { const r = regions.length === 1 ? regions[0] : null; if (r) f.profiles = [r.key]; }
  regen(); renderDialog();
}
function editFeature(fid) {
  const f = state.features.find(x => x.id === fid); if (!f) return;
  if (editing) cancelEdit(false);
  editing = { feat: clone(f), isNew: false }; regen(); renderDialog();
}
function commitEdit() {
  if (!editing) return;
  if (errors[editing.feat.id] && !editing.feat.suppressed) return;
  checkpoint();
  const f = editing.feat, i = state.features.findIndex(x => x.id === f.id);
  if (i >= 0) state.features[i] = f; else { state.features.push(f); state.nextFid = f.id + 1; }
  editing = null; persist(); regen();
}
function cancelEdit(re = true) { editing = null; if (re) regen(); }
function deleteFeature() {
  if (!editing || editing.isNew) return;
  checkpoint(); state.features = state.features.filter(x => x.id !== editing.feat.id); editing = null; persist(); regen();
}
function measureOff() { if (measure.on) { measure.on = false; measure.pts = []; syncToolButtons(); rebuildMeasure(); } }
function flash(msg) { const el = $('#flash3d'); if (!el) return; el.textContent = msg; el.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => el.hidden = true, 2800); }
function syncToolButtons() { document.querySelectorAll('[data-cmd3d="measure"]').forEach(b => b.setAttribute('aria-pressed', measure.on)); }

function exportMesh(kind) {
  const list = bodies.filter(b => selBody ? b.id === selBody : !(state.props[b.id] && state.props[b.id].hidden));
  if (!list.length) { flash('내보낼 바디가 없습니다'); return; }
  const grp = new THREE.Group(); list.forEach(b => { const m = new THREE.Mesh(b.geom); m.name = b.name; grp.add(m); }); grp.updateMatrixWorld(true);
  const text = kind === 'stl' ? new STLExporter().parse(grp, { binary: false }) : new OBJExporter().parse(grp);
  const what = selBody ? `선택한 바디 (${list[0].name})` : `보이는 바디 ${list.length}개`;
  D.openText(`${kind.toUpperCase()} 내보내기`, `${what}를 mm 단위로 내보냈습니다. ${kind === 'stl' ? '3D 프린터 슬라이서(Cura, PrusaSlicer 등)에서 열 수 있습니다.' : 'Blender 등 3D 프로그램에서 열 수 있습니다.'}`, text, `draftline.${kind}`);
}

// ---------------------------------------------------------------- 이벤트
panel.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'vSecPos') { view.secPos = +t.value; t.nextElementSibling && (t.nextElementSibling.textContent = `단면 위치 ${fmt(view.secPos)} mm`); rebuildScene(); return; }
  if (!editing || !t.dataset.k || t.tagName !== 'INPUT' || t.type === 'checkbox') return;
  editing.feat[t.dataset.k] = t.value === '' || t.value === '-' ? t.value : +t.value;
  clearTimeout(panel._t); panel._t = setTimeout(regen, 160);
});
panel.addEventListener('change', ev => {
  const t = ev.target;
  if (editing) {
    if (t.dataset.prof) { const s = new Set(editing.feat.profiles); t.checked ? s.add(t.dataset.prof) : s.delete(t.dataset.prof); editing.feat.profiles = [...s]; regen(); return; }
    if (t.dataset.tool) { const s = new Set(editing.feat.tools); t.checked ? s.add(t.dataset.tool) : s.delete(t.dataset.tool); editing.feat.tools = [...s]; regen(); return; }
    if (t.id === 'fSup') { editing.feat.suppressed = t.checked; regen(); return; }
    if (t.dataset.k) {
      editing.feat[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' ? t.value : (isFinite(+t.value) ? +t.value : t.value);
      regen(); if (t.dataset.rerender || t.dataset.k === 'target') renderDialog(); return;
    }
    return;
  }
  const b = selBody && findBody(selBody);
  if (t.id === 'bName' && b) { const name = t.value.trim(); if (name) { checkpoint(); (state.props[b.id] ||= {}).name = name; persist(); regen(); } return; }
  if (t.id === 'bMat' && b) { (state.props[b.id] ||= {}).mat = t.value; persist(); renderPanel(); return; }
  if (t.id === 'vDisp') { view.display = t.value; persist(); rebuildScene(); return; }
  if (t.id === 'vSec') { view.section = t.value !== 'off'; if (view.section) { view.secAxis = t.value; const bx = sceneBox(); view.secPos = +((bx.min[t.value] + bx.max[t.value]) / 2).toFixed(1); } rebuildScene(); renderPanel(); return; }
});
panel.addEventListener('keydown', ev => { if (ev.key === 'Enter' && editing && ev.target.tagName === 'INPUT') { ev.preventDefault(); clearTimeout(panel._t); regen(); commitEdit(); } });
panel.addEventListener('click', ev => {
  const t = ev.target.closest('button, .brow'); if (!t) return;
  if (t.id === 'dlgOk') { clearTimeout(panel._t); regen(); commitEdit(); return; }
  if (t.id === 'dlgCancel') { cancelEdit(); return; }
  if (t.id === 'dlgDel') { deleteFeature(); return; }
  if (t.dataset.eye) {
    if (t.dataset.eye === 'sketch') view.sketch = !view.sketch;
    else { const p = (state.props[t.dataset.eye] ||= {}); p.hidden = !p.hidden; }
    persist(); rebuildScene(); renderPanel(); return;
  }
  if (t.dataset.bcolor && selBody) { (state.props[selBody] ||= {}).color = t.dataset.bcolor; persist(); rebuildScene(); renderPanel(); return; }
  if (t.dataset.bid) { selBody = selBody === t.dataset.bid ? null : t.dataset.bid; rebuildScene(); renderPanel(); }
});
tl.addEventListener('click', ev => { const c = ev.target.closest('[data-fid]'); if (c) editFeature(+c.dataset.fid); });
document.querySelectorAll('[data-cmd3d]').forEach(b => b.addEventListener('click', () => command(b.dataset.cmd3d)));
function command(c) {
  if (NAMES[c]) return startFeature(c);
  switch (c) {
    case 'undo': return undo();
    case 'redo': return redo();
    case 'fit': return setView();
    case 'top': case 'front': case 'right': case 'iso': return setView(VIEWS[c]);
    case 'measure': measure.on = !measure.on; measure.pts = []; syncToolButtons(); rebuildMeasure(); draw(); if (!editing) renderPanel(); return;
    case 'stl': case 'obj': return exportMesh(c);
  }
}

// 클릭으로 프로파일 / 바디 / 측정점 고르기 (끌기는 화면 회전)
const ray = new THREE.Raycaster(), ndc = V2(0, 0);
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) { down = null; return; }
  down = null;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (editing && (editing.feat.type === 'extrude' || editing.feat.type === 'revolve')) {
    const hits = ray.intersectObjects(gSketch.children.filter(o => o.userData.region), false);
    if (hits.length) {
      // 겹친 면 중 가장 작은(안쪽) 영역을 고름
      const keys = hits.map(h => h.object.userData.region), best = keys.map(k => regionsByKey.get(k)).sort((a, b) => a.area - b.area)[0];
      const s = new Set(editing.feat.profiles); s.has(best.key) ? s.delete(best.key) : s.add(best.key); editing.feat.profiles = [...s]; regen(); return;
    }
    return;
  }
  const hits = ray.intersectObjects(gBodies.children.filter(o => o.userData.bid), false).filter(h => !view.section || clipPlane.distanceToPoint(h.point) >= -1e-6);
  if (measure.on) {
    if (!hits.length) return;
    if (measure.pts.length >= 2) measure.pts = [];
    measure.pts.push(hits[0].point.clone()); rebuildMeasure(); draw(); if (!editing) renderPanel(); return;
  }
  if (editing) return;
  selBody = hits.length ? hits[0].object.userData.bid : null; rebuildScene(); renderPanel();
});
addEventListener('keydown', e => {
  if (document.body.dataset.workspace !== '3d' || !$('#modal').hidden) return;
  if (e.target.matches && e.target.matches('input,textarea,select')) { if (e.key === 'Escape' && editing) { cancelEdit(); } return; }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (e.key === 'Escape') { if (editing) cancelEdit(); else if (measure.on) { measureOff(); renderPanel(); } else if (selBody) { selBody = null; rebuildScene(); renderPanel(); } return; }
  if (e.key === 'Enter' && editing) { commitEdit(); return; }
  if (k === 'e') startFeature('extrude');
  else if (k === 'f') setView();
  else if (k === 'm') command('measure');
});
addEventListener('draftline:ws', e => { if (e.detail === '3d') { resize(); if (dirty) regen(); else draw(); } });
D.onChange(() => { dirty = true; if (document.body.dataset.workspace === '3d') regen(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); rebuildScene(); });
new MutationObserver(() => { readTheme(); rebuildScene(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// 저장/불러오기 연동
window.Draftline3D = {
  getState: () => clone(state),
  setState(s) { checkpoint(); state = s && Array.isArray(s.features) ? sanitizeState(s) : { features: [], nextFid: 1, props: {} }; editing = null; selBody = null; persist(); regen(); setView(VIEWS.iso); },
  // 테스트·자동화용
  _debug: () => ({ bodies: bodies.map(b => ({ id: b.id, name: b.name, tris: triCount(b.geom), ...(p => ({ V: p.V, A: p.A }))(massProps(b.geom)) })), errors: { ...errors }, regions: regions.map(r => ({ key: r.key, holes: r.holes.length, area: r.area })) }),
  _start: startFeature, _set(k, v) { if (editing) { editing.feat[k] = v; regen(); } }, _commit: commitEdit,
};

// ---------------------------------------------------------------- 시작
load(); readTheme(); resize(); regen(); setView(VIEWS.iso);
