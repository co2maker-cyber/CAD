// Draftline 3D 모델 작업공간: 스케치 프로파일 → 파라메트릭 피처 → 솔리드 바디
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { makeDrawing, make3MF } from './extras3d.js';

const D = window.Draftline;
const KEY = 'draftline.model.v1';
const $ = s => document.querySelector(s);
const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

const host = $('#view3d'), panel = $('#panel3d'), tl = $('#timeline');

// ---------------------------------------------------------------- 상태
const NAMES = { extrude: '돌출', revolve: '회전', box: '상자', cylinder: '원통', sphere: '구', cone: '원뿔', torus: '토러스', boolean: '결합', move: '이동', pattern: '패턴', mirror: '대칭', split: '분할', fillet3d: '모깎기', chamfer3d: '모따기', shell: '쉘', remove: '지우기', wedge: '쐐기', pyramid: '피라미드', tube: '튜브', hemisphere: '반구', relief: '이미지 입체', place: '배치', copy: '복제', group: '그룹' };
const ICON = { extrude: '⬆', revolve: '↻', box: '▣', cylinder: '◎', sphere: '●', cone: '▲', torus: '◯', boolean: '⊕', move: '✥', pattern: '⁞', mirror: '⇋', split: '⫽', fillet3d: '◜', chamfer3d: '◸', shell: '▢', remove: '✕', wedge: '◺', pyramid: '△', tube: '⊚', hemisphere: '◓', relief: '▦', place: '✥', copy: '⧉', group: '⊞' };
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
  fillet3d: { body: '', edges: [], r: 3 },
  chamfer3d: { body: '', edges: [], d: 2 },
  shell: { body: '', t: 2, faces: [], dir: 'in' },
  remove: { body: '' },
  wedge: { w: 30, d: 20, h: 20, x: 0, y: 0, z: 0, op: 'new', target: '' },
  pyramid: { w: 30, h: 25, x: 0, y: 0, z: 0, op: 'new', target: '' },
  tube: { r: 15, r2: 10, h: 20, x: 0, y: 0, z: 0, op: 'new', target: '' },
  hemisphere: { r: 15, x: 0, y: 0, z: 0, op: 'new', target: '' },
  relief: { grid: null, width: 60, base: 1, height: 3, invert: true, x: 0, y: 0, z: 0, op: 'new', target: '' },
  place: { moves: {} },
  copy: { body: '', dx: 10, dy: 10, dz: 0 },
  group: { target: '', solids: [], holes: [] },
};
const PRIMS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pyramid', 'tube', 'hemisphere', 'relief'];
const MATERIALS = [['steel', '강철', 7.85], ['al', '알루미늄', 2.70], ['brass', '황동', 8.50], ['copper', '구리', 8.96], ['abs', 'ABS', 1.04], ['pla', 'PLA', 1.24], ['wood', '나무', 0.60], ['glass', '유리', 2.50], ['rubber', '고무', 1.20]];
// 사실적 렌더링용 겉모습 (c 없음 = 바디 색 사용)
const APPEAR = { steel: { c: '#a9b0b7', m: 1, r: 0.34 }, al: { c: '#d3d7db', m: 1, r: 0.42 }, brass: { c: '#c9a24a', m: 1, r: 0.38 }, copper: { c: '#c47a4c', m: 1, r: 0.32 }, abs: { m: 0, r: 0.45 }, pla: { m: 0, r: 0.35 }, wood: { c: '#a8743f', m: 0, r: 0.72 }, glass: { c: '#eef6f8', glass: true }, rubber: { c: '#2b2e31', m: 0, r: 0.9 } };
const BODY_COLORS = ['#9aa9b5', '#c9773f', '#5b8fc7', '#6aa36f', '#c8a64a', '#8e6fc1'];

let state = { features: [], nextFid: 1, props: {} };
let undoS = [], redoS = [];
let bodies = [];             // [{id, name, geom}]
let errors = {};             // fid → 메시지
let beforeIds = {};          // fid → 그 피처 직전의 바디 목록
let draftTool = null;        // 편집 중인 잘라내기/교차 도구 형상 (미리보기)
let pickGeom = null, pickSegs = [], draftEdges = [], pickLines = null, draftFaces = [], pickMesh = null; // 모깎기·모따기 모서리 고르기
let editing = null;          // {feat, isNew}
let selBody = null, selSet = new Set();
function selectOnly(id) { selBody = id || null; selSet = new Set(id ? [id] : []); }
function toggleSel(id) { if (selSet.has(id)) { selSet.delete(id); if (selBody === id) selBody = [...selSet].pop() || null; } else { selSet.add(id); selBody = id; } }
let regions = [], regionsByKey = new Map(), sketchLinesCache = [];
let view = { display: 'edges', sketch: true, section: false, secAxis: 'z', secPos: 0, snap: 1, explode: 0, draftDir: 'z', draftAng: 1 };
let clash = null;            // 간섭 검사 결과 {pairs:[{a,b,V,geom}], geoms:{id:geom}}
let measure = { on: false, pts: [] };
let dirty = true;
let memo = [];
function hashStr(str) { let h1 = 0x811c9dc5, h2 = 0x1234567; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + str.length; }

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
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(KEY + '.view', JSON.stringify({ display: view.display, sketch: view.sketch, snap: view.snap, draftDir: view.draftDir, draftAng: view.draftAng })); } catch (_) {}
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
    return { key: l.key, parentKey: l.parent ? l.parent.key : null, label: l.label, outer: l.pts, holes: holes.map(h => h.pts), area: l.area - holes.reduce((s, h) => s + h.area, 0) };
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
  // 넓이가 0인 삼각형 제거 (불리언 연산의 광선 판정이 실패하는 원인)
  const a = g.attributes.position.array; let w = 0;
  for (let i = 0; i < a.length; i += 9) {
    const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const c2 = cx * cx + cy * cy + cz * cz; if (c2 < 1e-16) continue;
    // 바늘처럼 가는 조각(폭 0.00005 mm 미만)도 버림: 모양엔 영향이 없고, 불리언 결과의 삼각형 폭증을 막음
    const l2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2);
    if (c2 < 2.5e-9 * l2) continue;
    if (w !== i) for (let k = 0; k < 9; k++) a[w + k] = a[i + k];
    w += 9;
  }
  if (w !== a.length) g.setAttribute('position', new THREE.Float32BufferAttribute(a.slice(0, w), 3));
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
// 같은 평면에 놓인 면(예: 바디와 높이가 똑같은 구멍)은 CSG가 삼각형을 수만 개로 쪼개며 몇십 초씩 걸림
// → 도구를 중심 기준으로 아주 조금(축마다 ±CSG_EPS mm) 키워 면이 겹치지 않게 함 (치수 영향 0.001 mm)
const CSG_EPS = 1e-3;
function nudgeTool(g) {
  g.computeBoundingBox(); const bb = g.boundingBox, c = bb.getCenter(V3()), s = bb.getSize(V3());
  const k = v => v > 1e-6 ? (v + 2 * CSG_EPS) / v : 1;
  const m = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(k(s.x), k(s.y), k(s.z))).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const out = g.clone(); out.applyMatrix4(m); return out;
}
// 키운 만큼 생긴 0.001 mm 단차를 없애려고, 결과 꼭짓점 좌표가 원래 두 형상의 좌표값 가까이에 있으면 그 값으로 되돌림
function snapBack(g, ga, gb) {
  const sets = [[], [], []];
  for (const src of [ga, gb]) { const a = src.attributes.position.array; for (let i = 0; i < a.length; i++) sets[i % 3].push(a[i]); }
  const sorted = sets.map(l => Float64Array.from(new Set(l.map(v => Math.round(v * 1e6) / 1e6))).sort());
  const a = g.attributes.position.array, tol = 2.5 * CSG_EPS;
  for (let i = 0; i < a.length; i++) {
    const L = sorted[i % 3], v = a[i]; let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < v) lo = m; else hi = m; }
    const c = Math.abs(L[lo] - v) < Math.abs(L[hi] - v) ? L[lo] : L[hi];
    if (Math.abs(c - v) < tol) a[i] = c;
  }
  g.attributes.position.needsUpdate = true;
  return g;
}
function csg(ga, gb, op) {
  const A = new Brush(ga.clone()), B = new Brush(nudgeTool(gb));
  A.updateMatrixWorld(); B.updateMatrixWorld();
  return prep(snapBack(EV.evaluate(A, B, OPS[op]).geometry, ga, gb));
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
    case 'wedge': { const w = num('w', 0), d = num('d', 0), h = num('h', 0); g = new THREE.ExtrudeGeometry(new THREE.Shape([V2(0, 0), V2(w, 0), V2(0, h)]), { depth: d, bevelEnabled: false });
      g.applyMatrix4(PLANES.XZ); g.translate(+f.x - w / 2, +f.y + d / 2, +f.z); break; }
    case 'pyramid': { const w = num('w', 0), h = num('h', 0); g = new THREE.ConeGeometry(w / Math.SQRT2, h, 4); g.rotateY(Math.PI / 4); g.rotateX(Math.PI / 2); g.translate(+f.x, +f.y, +f.z + h / 2); break; }
    case 'tube': { const r = num('r', 0), r2 = num('r2', 0), h = num('h', 0); if (r2 >= r) throw new Error('안쪽 반지름은 바깥 반지름보다 작아야 합니다');
      const sh = new THREE.Shape(); sh.absarc(0, 0, r, 0, TAU, false); const hole = new THREE.Path(); hole.absarc(0, 0, r2, 0, TAU, true); sh.holes.push(hole);
      g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 48 }); g.translate(+f.x, +f.y, +f.z); break; }
    case 'relief': g = reliefGeom(f); g.translate(+f.x, +f.y, +f.z); break;
    case 'hemisphere': { const r = num('r', 0), pts = [V2(0, 0), V2(r, 0)]; for (let i = 1; i <= 32; i++) { const a = Math.PI / 2 * i / 32; pts.push(V2(r * Math.cos(a), r * Math.sin(a))); }
      g = prep(new THREE.LatheGeometry(pts, 96)); g.rotateX(Math.PI / 2); if (massProps(g).V < 0) flipWinding(g); g.translate(+f.x, +f.y, +f.z); break; }
  }
  return prep(g);
}
// 이미지 밝기 → 높이. 위·아래·옆면을 모두 만들어 닫힌 솔리드로
function reliefGeom(f) {
  const G = f.grid; if (!G || !(G.w > 1) || !(G.h > 1) || !Array.isArray(G.d) || G.d.length !== G.w * G.h) throw new Error('이미지 데이터가 없습니다 — 이미지를 다시 넣어 주세요');
  const W = +f.width, base = +f.base, H = +f.height;
  if (!(W > 0)) throw new Error('폭은 0보다 커야 합니다'); if (!(base > 0)) throw new Error('바닥 두께는 0보다 커야 합니다'); if (!(H >= 0)) throw new Error('최대 높이는 0 이상이어야 합니다');
  const nx = G.w, ny = G.h, cell = W / (nx - 1), Dp = cell * (ny - 1), out = [];
  const P3 = (i, j, top) => { let v = G.d[j * nx + i] / 255; if (f.invert) v = 1 - v; return V3(-W / 2 + i * cell, Dp / 2 - j * cell, top ? base + H * v : 0); };
  const ab = V3(), ac = V3();
  const tri = (a, b, c, e) => { ab.subVectors(b, a); ac.subVectors(c, a); if (ab.clone().cross(ac).dot(e) < 0) [b, c] = [c, b]; out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); };
  const up = V3(0, 0, 1), dn = V3(0, 0, -1);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    tri(P3(i, j, 1), P3(i + 1, j, 1), P3(i, j + 1, 1), up); tri(P3(i + 1, j, 1), P3(i + 1, j + 1, 1), P3(i, j + 1, 1), up);
    tri(P3(i, j, 0), P3(i + 1, j, 0), P3(i, j + 1, 0), dn); tri(P3(i + 1, j, 0), P3(i + 1, j + 1, 0), P3(i, j + 1, 0), dn);
  }
  const wall = (a0, a1, e) => { tri(P3(...a0, 1), P3(...a1, 1), P3(...a0, 0), e); tri(P3(...a1, 1), P3(...a1, 0), P3(...a0, 0), e); };
  for (let i = 0; i < nx - 1; i++) { wall([i, 0], [i + 1, 0], V3(0, 1, 0)); wall([i, ny - 1], [i + 1, ny - 1], V3(0, -1, 0)); }
  for (let j = 0; j < ny - 1; j++) { wall([0, j], [0, j + 1], V3(-1, 0, 0)); wall([nx - 1, j], [nx - 1, j + 1], V3(1, 0, 0)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}
// 이미지 파일 → 밝기 격자 (긴 쪽 최대 n칸)
function imageToGrid(file, n = 80) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('파일을 읽지 못했습니다'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('이미지로 읽을 수 없는 파일입니다'));
      img.onload = () => {
        const k = n / Math.max(img.naturalWidth, img.naturalHeight), w = Math.max(2, Math.round(img.naturalWidth * k)), h = Math.max(2, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
        const px = x.getImageData(0, 0, w, h).data, d = [];
        for (let i = 0; i < w * h; i++) d.push(Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]));
        res({ w, h, d, aspect: img.naturalHeight / img.naturalWidth });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
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
  if (['extrude', 'revolve', ...PRIMS].includes(f.type)) {
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
    case 'fillet3d': case 'chamfer3d': {
      const b = targetOf(f, 'body'), base = b.geom, segs = edgeSegs(base), scale = geomScale(base);
      if (isDraft) { pickGeom = base; pickSegs = segs; }
      const kind = f.type === 'fillet3d' ? 'fillet' : 'chamfer', val = +(kind === 'fillet' ? f.r : f.d);
      if (!(val > 0)) throw new Error(kind === 'fillet' ? '반지름은 0보다 커야 합니다' : '거리는 0보다 커야 합니다');
      if (!f.edges.length) throw new Error('모서리를 하나 이상 고르세요 — 화면의 파란 모서리를 클릭');
      const res = f.edges.map((m, i) => { const r = resolveEdge(base, segs, m, scale); if (!r) throw new Error(`모서리 ${i + 1}을(를) 찾을 수 없습니다 — 앞 피처가 바뀌었다면 모서리를 다시 고르세요`); return r; });
      if (isDraft) draftEdges = res;
      let g = base;
      for (const ed of res) g = csg(g, edgeTool(ed, kind, val, scale), ed.convex ? 'cut' : 'join');
      if (!triCount(g)) throw new Error('결과가 비어 있습니다 — 크기를 줄여 보세요');
      b.geom = g; return;
    }
    case 'remove': {
      const b = targetOf(f, 'body'); bodies = bodies.filter(x => x !== b); return;
    }
    case 'place': {
      for (const [id, v] of Object.entries(f.moves || {})) { const b = findBody(id); if (!b || !v) continue; const m = toMat(v); if (m.equals(new THREE.Matrix4())) continue; b.geom = transformed(b.geom, m); }
      return;
    }
    case 'copy': {
      const src = targetOf(f, 'body'), nb = newBody(bid);
      nb.geom = transformed(src.geom, new THREE.Matrix4().makeTranslation(+f.dx || 0, +f.dy || 0, +f.dz || 0)); bodies.push(nb); return;
    }
    case 'group': {
      const t = findBody(f.target); if (!t) throw new Error('기준 바디가 없습니다');
      const sol = (f.solids || []).map(findBody).filter(b => b && b !== t), hol = (f.holes || []).map(findBody).filter(b => b && b !== t);
      if (!sol.length && !hol.length) throw new Error('함께 묶을 바디가 없습니다');
      for (const b of sol) t.geom = csg(t.geom, b.geom, 'join');
      for (const b of hol) { if (isDraft) draftTool = b.geom; t.geom = csg(t.geom, b.geom, 'cut'); }
      bodies = bodies.filter(b => !sol.includes(b) && !hol.includes(b));
      if (!triCount(t.geom)) throw new Error('결과가 비어 있습니다 — 구멍이 바디 전체를 덮습니다');
      return;
    }
    case 'shell': {
      const b = targetOf(f, 'body'), base = b.geom, scale = geomScale(base), t = +f.t;
      if (isDraft) { pickGeom = base; draftFaces = f.faces.map(fc => facePatch(base, fc, scale)); }
      if (!(t > 0)) throw new Error('두께는 0보다 커야 합니다');
      const dir = f.dir || 'in';
      let outer = base, inner;
      if (dir === 'out') { outer = offsetMesh(base, t, f.faces, scale, 'flush'); inner = f.faces.length ? offsetMesh(base, 0, f.faces, scale, 'push') : base; }
      else if (dir === 'both') { outer = offsetMesh(base, t / 2, f.faces, scale, 'flush'); inner = offsetMesh(base, -t / 2, f.faces, scale, 'push'); }
      else inner = offsetMesh(base, -t, f.faces, scale, 'push');
      const vo = massProps(outer).V, vi = massProps(inner).V;
      if (!(vi > 0) || !(vo > 0) || (vi >= vo && !f.faces.length)) throw new Error('두께가 너무 두꺼워 형상이 뒤집혔습니다 — 두께를 줄이세요');
      const g = csg(outer, inner, 'cut');
      if (!triCount(g)) throw new Error('결과가 비어 있습니다 — 두께를 줄이세요');
      if (Math.abs(massProps(g).V - vo) < vo * 1e-6) throw new Error('속을 비우지 못했습니다 — 두께를 줄이거나 열 면을 다시 고르세요');
      b.geom = g; return;
    }
  }
}

// ---------------------------------------------------------------- 쉘: 표면을 두께만큼 안쪽으로 오프셋한 형상
function triGrid(g, scale) {
  const a = g.attributes.position.array, cell = Math.max(scale / 40, 1e-3), grid = new Map(), tris = [];
  const p = V3(), q = V3(), r = V3();
  for (let i = 0; i < a.length; i += 9) {
    p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
    const n = V3().subVectors(q, p).cross(V3().subVectors(r, p)); if (n.lengthSq() < 1e-14) continue; n.normalize();
    const ti = tris.length, tri = new THREE.Triangle(p.clone(), q.clone(), r.clone()); tris.push({ tri, n, area: tri.getArea() });
    const lo = [Math.min(p.x, q.x, r.x), Math.min(p.y, q.y, r.y), Math.min(p.z, q.z, r.z)].map(v => Math.floor((v - 0.06) / cell));
    const hi = [Math.max(p.x, q.x, r.x), Math.max(p.y, q.y, r.y), Math.max(p.z, q.z, r.z)].map(v => Math.floor((v + 0.06) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = x + ',' + y + ',' + z; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(ti);
    }
  }
  return { tris, at: P => grid.get(Math.floor(P.x / cell) + ',' + Math.floor(P.y / cell) + ',' + Math.floor(P.z / cell)) || [] };
}
const faceOf = fc => ({ p: V3(fc[0], fc[1], fc[2]), n: V3(fc[3], fc[4], fc[5]).normalize() });
function shellInner(g, t, faces, scale) { return offsetMesh(g, -t, faces, scale, 'push'); }
// 표면을 s만큼(+ 바깥, - 안쪽) 옮긴 형상. 열 면은 'push'면 바깥으로 밀어 뚫고, 'flush'면 원래 평면에 그대로 둠
function offsetMesh(g, s, faces, scale, mode) {
  const t = Math.max(Math.abs(s), 1e-3);
  const a = g.attributes.position.array, { tris, at } = triGrid(g, scale), tol = Math.max(0.03, scale * 3e-4), tp = Math.max(0.01, scale * 1e-4);
  const open = faces.map(faceOf), ext = t + Math.max(1, scale * 0.02);
  if (Math.abs(s) < 1e-9 && !open.length) return g.clone();
  const K = (x, y, z) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
  const disp = new Map(), P = V3(), cp = V3();
  // 실제 모서리와 그 양쪽 면 방향 (모서리 가까이 있는 면 안쪽 점이 오프셋 후 접혀 넘어가지 않도록)
  const ecell = Math.max(t * 1.5, scale / 40), egrid = new Map(), edges = [];
  for (const [A, B] of edgeSegs(g, 20)) {
    const L = A.distanceTo(B); if (L < 1e-6) continue;
    const mid = A.clone().add(B).multiplyScalar(0.5), ns2 = [];
    for (const ti of at(mid)) { const T = tris[ti]; T.tri.closestPointToPoint(mid, cp); if (cp.distanceToSquared(mid) > tol * tol) continue; if (!ns2.some(n => n.dot(T.n) > 0.9999)) ns2.push(T.n); }
    if (ns2.length < 2) continue;
    const ei = edges.length; edges.push({ line: new THREE.Line3(A, B), ns: ns2 });
    const r = t * 1.2, lo = [Math.min(A.x, B.x) - r, Math.min(A.y, B.y) - r, Math.min(A.z, B.z) - r].map(v => Math.floor(v / ecell)), hi = [Math.max(A.x, B.x) + r, Math.max(A.y, B.y) + r, Math.max(A.z, B.z) + r].map(v => Math.floor(v / ecell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = x + ',' + y + ',' + z; let l = egrid.get(k); if (!l) egrid.set(k, l = []); l.push(ei); }
  }
  for (let i = 0; i < a.length; i += 3) {
    const k = K(a[i], a[i + 1], a[i + 2]); if (disp.has(k)) continue;
    P.set(a[i], a[i + 1], a[i + 2]);
    // 이 점이 닿은(변 위에 놓인 경우 포함) 모든 삼각형의 면 방향을 모음 → T자 이음매에서도 틈이 안 생김
    const cl = [];
    for (const ti of at(P)) {
      const T = tris[ti]; T.tri.closestPointToPoint(P, cp); if (cp.distanceToSquared(P) > tol * tol) continue;
      const c = cl.find(c => c.n.dot(T.n) > 0.9999); if (c) c.w += T.area; else cl.push({ n: T.n, w: T.area });
    }
    // 뒤집힌 조각 삼각형 때문에 정반대 법선이 함께 모이면 넓이가 작은 쪽을 버림 (서로 상쇄돼 점이 안 움직이는 것 방지)
    for (let i = cl.length - 1; i >= 0; i--) if (cl.some(c => c !== cl[i] && c.n.dot(cl[i].n) < -0.99 && c.w >= cl[i].w)) cl.splice(i, 1);
    // 면 하나에만 놓인 점이 같은 면의 모서리에서 두께 안쪽에 있으면, 그 모서리의 다른 면 방향도 따름
    if (cl.length === 1) {
      const n0 = cl[0].n, w0 = cl[0].w;
      for (const ei of egrid.get(Math.floor(P.x / ecell) + ',' + Math.floor(P.y / ecell) + ',' + Math.floor(P.z / ecell)) || []) {
        const E = edges[ei]; if (!E.ns.some(n => n.dot(n0) > 0.9999)) continue;
        E.line.closestPointToPoint(P, true, cp); if (cp.distanceTo(P) > t * 1.2 || Math.abs(n0.dot(V3().subVectors(cp, P))) > tol) continue;
        for (const n of E.ns) if (!cl.some(c => c.n.dot(n) > 0.9999)) cl.push({ n, w: w0 });
      }
    }
    const wmax = Math.max(1e-12, ...cl.map(c => c.w)), ns = cl.map(c => c.n);
    // 1단계: 모든 면을 두께만큼 안쪽으로 (닫힌 쉘). 2단계: 열 면 위의 점만 바깥으로 더 밀어 구멍을 냄
    const M = new THREE.Matrix3().set(1e-6, 0, 0, 0, 1e-6, 0, 0, 0, 1e-6), rhs = V3();
    // 면적 가중 최소제곱: 아주 얇은 조각 삼각형의 불안정한 법선은 거의 무시됨
    const avg = V3();
    for (const { n, w: w0 } of cl) {
      const w = Math.min(1, w0 / wmax * 20), e = M.elements;
      e[0] += w * n.x * n.x; e[1] += w * n.x * n.y; e[2] += w * n.x * n.z; e[3] += w * n.y * n.x; e[4] += w * n.y * n.y; e[5] += w * n.y * n.z; e[6] += w * n.z * n.x; e[7] += w * n.z * n.y; e[8] += w * n.z * n.z;
      rhs.addScaledVector(n, s * w); avg.addScaledVector(n, w0);
    }
    let d = cl.length ? rhs.applyMatrix3(M.invert()) : V3();
    if (d.length() > 2.5 * Math.abs(s) && avg.length() > 1e-12) d = avg.normalize().multiplyScalar(s);
    for (const o of open) if (ns.some(n => o.n.dot(n) > 0.9999) && Math.abs(o.n.dot(V3().subVectors(P, o.p))) < tp) {
      if (mode === 'flush') d.addScaledVector(o.n, -o.n.dot(d)); else d.addScaledVector(o.n, ext + Math.max(0, -s));
    }
    disp.set(k, d);
  }
  const out = [], A = V3(), B = V3(), C = V3(), mv = i => { const d = disp.get(K(a[i], a[i + 1], a[i + 2])); return V3(a[i] + d.x, a[i + 1] + d.y, a[i + 2] + d.z); };
  for (let i = 0; i < a.length; i += 9) {
    A.copy(mv(i)); B.copy(mv(i + 3)); C.copy(mv(i + 6));
    // 오프셋으로 넓이가 0이 된 삼각형은 버림 (불리언 연산 오류 방지)
    if (V3().subVectors(B, A).cross(V3().subVectors(C, A)).lengthSq() < 1e-12) continue;
    out.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
  }
  const ig = new THREE.BufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return prep(ig);
}
// 고른 평면에 놓인 삼각형들 (화면 강조용)
function facePatch(g, fc, scale) {
  const { p, n } = faceOf(fc), a = g.attributes.position.array, out = [], tp = Math.max(0.01, scale * 1e-4), A = V3(), B = V3(), C = V3();
  for (let i = 0; i < a.length; i += 9) {
    A.set(a[i], a[i + 1], a[i + 2]); B.set(a[i + 3], a[i + 4], a[i + 5]); C.set(a[i + 6], a[i + 7], a[i + 8]);
    const tn = V3().subVectors(B, A).cross(V3().subVectors(C, A)); if (tn.lengthSq() < 1e-14) continue; tn.normalize();
    if (tn.dot(n) > 0.9999 && Math.abs(n.dot(V3().subVectors(A, p))) < tp) out.push(...A.toArray(), ...B.toArray(), ...C.toArray());
  }
  return out;
}

// ---------------------------------------------------------------- 3D 모서리: 모깎기·모따기
const clamp1 = v => Math.max(-1, Math.min(1, v));
function geomScale(g) { g.computeBoundingBox(); return Math.max(1, g.boundingBox.getSize(V3(0, 0, 0)).length()); }
// 실제 모서리만 추출: 같은 직선 위에 겹치는 삼각형 변끼리 비교해 면이 꺾이는 곳만 남김 (CSG의 T자 이음매 대응)
const edgeCache = new WeakMap();
function edgeSegs(g, th = 20) {
  const ck = edgeCache.get(g); if (ck && ck.th === th) return ck.segs;
  const a = g.attributes.position.array, cosT = Math.cos(th * DEG), groups = new Map(), out = [];
  const p = V3(), q = V3(), r = V3(), n = V3(), t = V3();
  const R3 = v => Math.round(v * 1e3), R2 = v => Math.round(v * 1e2);
  for (let i = 0; i < a.length; i += 9) {
    p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
    n.subVectors(q, p).cross(t.subVectors(r, p)); const n2 = n.lengthSq(); if (n2 < 1e-14) continue;
    // 아주 가는 조각 삼각형: 법선이 불안정하므로 모서리 판단에 쓰지 않음
    const lmax = Math.max(p.distanceToSquared(q), q.distanceToSquared(r), r.distanceToSquared(p)), sl = Math.sqrt(n2 / lmax) < 0.02;
    n.normalize();
    for (const [A, B] of [[p, q], [q, r], [r, p]]) {
      const d = V3().subVectors(B, A), L = d.length(); if (L < 1e-7) continue; d.multiplyScalar(1 / L);
      if (d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && (d.y < -1e-9 || (Math.abs(d.y) <= 1e-9 && d.z < 0)))) d.negate();
      const perp = A.clone().addScaledVector(d, -A.dot(d));
      const ki = [R3(d.x), R3(d.y), R3(d.z), R2(perp.x), R2(perp.y), R2(perp.z)], key = ki.join(',');
      const t0 = A.dot(d), t1 = B.dot(d);
      let gr = groups.get(key); if (!gr) groups.set(key, gr = []);
      gr.push({ t0: Math.min(t0, t1), t1: Math.max(t0, t1), n: n.clone(), A: A.clone(), B: B.clone(), ki, d: d.clone(), sl });
    }
  }
  // 겹치는 선분들의 끝점으로 E를 잘게 나눠 조각마다 판단 (한 직선 위에 진짜 모서리와 면 안쪽 선이 이어진 경우 대응)
  const OFF = [-1, 0, 1];
  let tg = null; g.computeBoundingBox(); const sc = g.boundingBox.getSize(V3(0, 0, 0)).length();
  const overl = (E, list) => list.filter(O => O !== E).map(O => { const a = O.A.dot(E.d), b = O.B.dot(E.d); return { O, o0: Math.min(a, b), o1: Math.max(a, b) }; }).filter(x => x.o1 > E.t0 + 1e-5 && x.o0 < E.t1 - 1e-5);
  for (const gr of groups.values()) for (const E of gr) {
    if (E.sl) continue;
    let ov = overl(E, gr);
    if (!ov.length) {
      // 반올림 경계에 걸린 이웃 칸까지 찾아봄
      for (const a of OFF) for (const b of OFF) for (const c of OFF) for (const x of OFF) for (const y of OFF) for (const z of OFF) {
        if (!a && !b && !c && !x && !y && !z) continue;
        const k = E.ki, o = groups.get(`${k[0] + a},${k[1] + b},${k[2] + c},${k[3] + x},${k[4] + y},${k[5] + z}`); if (o) ov.push(...overl(E, o));
      }
    }
    const cuts = [E.t0, E.t1]; for (const x of ov) { if (x.o0 > E.t0 && x.o0 < E.t1) cuts.push(x.o0); if (x.o1 > E.t0 && x.o1 < E.t1) cuts.push(x.o1); }
    cuts.sort((u, v) => u - v);
    const base = E.A.dot(E.d), at = t => E.A.clone().addScaledVector(E.d, t - base);
    let runStart = null;
    const flush = t => { if (runStart !== null) { out.push([at(runStart), at(t)]); runStart = null; } };
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u = cuts[i], v = cuts[i + 1]; if (v - u < 1e-6) continue;
      const m = (u + v) / 2, here = ov.filter(x => x.o0 <= m && x.o1 >= m).map(x => x.O);
      let draw;
      if (!here.length) {
        // 짝이 없는 조각: 양옆이 같은 평면의 삼각형으로 덮여 있으면 평평한 면 안쪽 선
        if (!tg) tg = triGrid(g, Math.max(1, sc));
        const M = at(m), w = V3().crossVectors(E.n, E.d).normalize(), cp = V3();
        const covered = side => { const Q = M.clone().addScaledVector(w, side * 0.01); return tg.at(Q).some(ti => { const T = tg.tris[ti]; if (Math.abs(T.n.dot(E.n)) < 0.999) return false; T.tri.closestPointToPoint(Q, cp); return cp.distanceToSquared(Q) < 1e-6; }); };
        draw = !(covered(1) && covered(-1));
      } else {
        // 등을 맞댄 한 쌍(반대 방향 법선)은 부피 없는 내부 벽이므로 무시
        const real = here.filter(O => !O.sl && !here.some(Q => Q !== O && Q.n.dot(O.n) < -0.999));
        draw = real.some(O => Math.abs(E.n.dot(O.n)) < cosT);
      }
      if (draw) { if (runStart === null) runStart = u; } else flush(u);
    }
    flush(cuts[cuts.length - 1]);
  }
  edgeCache.set(g, { th, segs: out });
  return out;
}
// 모서리 위 점 M에 닿은 삼각형들의 면 방향 (법선 n, 모서리에서 면 안쪽으로 향하는 t)
function facesAt(g, M, e, tol) {
  const a = g.attributes.position.array, tri = new THREE.Triangle(), cp = V3(0, 0, 0), found = [];
  for (let i = 0; i < a.length; i += 9) {
    tri.a.set(a[i], a[i + 1], a[i + 2]); tri.b.set(a[i + 3], a[i + 4], a[i + 5]); tri.c.set(a[i + 6], a[i + 7], a[i + 8]);
    tri.closestPointToPoint(M, cp); if (cp.distanceToSquared(M) > tol * tol) continue;
    const n = tri.getNormal(V3(0, 0, 0)); if (n.lengthSq() < 0.5) continue;
    let cen = null; for (const v of [tri.a, tri.b, tri.c]) { const q = V3().subVectors(v, M); q.addScaledVector(e, -q.dot(e)); if (!cen || q.lengthSq() > cen.lengthSq()) cen = q; }
    if (cen.length() < 1e-6) continue;
    const t = V3(0, 0, 0).crossVectors(n, e).normalize(); if (t.dot(cen) < 0) t.negate();
    if (!found.some(f => f.n.dot(n) > 0.9995)) found.push({ n, t });
  }
  return found;
}
function expandStraight(segs, S, e, tol) {
  const o = S[0], iv = [], off = p => { const q = V3().subVectors(p, o); return q.addScaledVector(e, -q.dot(e)).length(); };
  for (const s of segs) {
    const d = V3().subVectors(s[1], s[0]), L = d.length(); if (L < 1e-9 || Math.abs(d.dot(e) / L) < 0.99999) continue;
    if (off(s[0]) > tol || off(s[1]) > tol) continue;
    const a = V3().subVectors(s[0], o).dot(e), b = V3().subVectors(s[1], o).dot(e); iv.push([Math.min(a, b), Math.max(a, b)]);
  }
  let lo = 0, hi = S[0].distanceTo(S[1]), grew = true;
  while (grew) { grew = false; for (const [a, b] of iv) if (a <= hi + tol && b >= lo - tol && (a < lo - 1e-9 || b > hi + 1e-9)) { lo = Math.min(lo, a); hi = Math.max(hi, b); grew = true; } }
  return { P0: o.clone().addScaledVector(e, lo), P1: o.clone().addScaledVector(e, hi) };
}
// 원형 모서리 찾기: 모서리 평면 위의 다른 모서리 끝점들이 "M을 지나고 방향 e에 접하는 원"의 중심 위치에 투표
function circleFromVotes(segs, M, e, fs, scale) {
  const pts = []; for (const s of segs) pts.push(s[0], s[1]);
  let best = null;
  for (const f of fs) {
    const ax = f.n.clone(); if (Math.abs(ax.dot(e)) > 1e-3) continue;
    const k = V3().crossVectors(ax, e).normalize(), tp = Math.max(0.01, scale * 1e-4), votes = [];
    for (const P of pts) {
      const q = V3().subVectors(P, M); if (Math.abs(q.dot(ax)) > tp) continue;
      const d2 = q.lengthSq(), dk = q.dot(k); if (d2 < 1e-4 || Math.abs(dk) < 1e-4) continue;
      votes.push({ s: d2 / (2 * dk), P });
    }
    votes.sort((x, y) => x.s - y.s);
    let i0 = 0;
    for (let i = 0; i < votes.length; i++) {
      while (votes[i].s - votes[i0].s > Math.max(0.02, Math.abs(votes[i].s) * 0.03)) i0++;
      const cnt = i - i0 + 1; if (!best || cnt > best.cnt) best = { cnt, ax, k, group: votes.slice(i0, i + 1) };
    }
  }
  if (!best || best.cnt < 6) return null;
  const ax = best.ax, sMed = best.group[best.group.length >> 1].s;
  let c = M.clone().addScaledVector(best.k, sMed), R = Math.abs(sMed);
  const tp = Math.max(0.01, scale * 1e-4), plane = pts.filter(P => Math.abs(V3().subVectors(P, M).dot(ax)) <= tp);
  const u = V3().subVectors(M, c).normalize(), v = V3().crossVectors(ax, u);
  let sel = [];
  for (const tolR of [0.06, 0.02, 0.006]) {
    sel = plane.filter(P => Math.abs(P.distanceTo(c) - R) <= R * tolR + 0.005); if (sel.length < 6) return null;
    // 평면 위 최소제곱 원 맞춤 (Kasa)
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    for (const P of sel) { const q = V3().subVectors(P, c), x = q.dot(u), y = q.dot(v), z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
    const A = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, sel.length);
    if (Math.abs(A.determinant()) < 1e-12) return null;
    const r = V3(sxz, syz, sz).applyMatrix3(A.invert()), cx = r.x / 2, cy = r.y / 2;
    c = c.clone().addScaledVector(u, cx).addScaledVector(v, cy); R = Math.sqrt(Math.max(0, r.z + cx * cx + cy * cy));
  }
  // 한 바퀴를 거의 다 덮는지 확인 (가장 큰 각도 빈틈 < 60°)
  const angs = sel.map(P => { const q = V3().subVectors(P, c); return Math.atan2(q.dot(v), q.dot(u)); }).sort((a, b) => a - b);
  let gap = TAU - (angs[angs.length - 1] - angs[0]); for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1]);
  if (gap > 60 * DEG || Math.abs(M.distanceTo(c) - R) > R * 0.02 + 0.01) return null;
  return { c, ax, R };
}
function resolveEdge(g, segs, m, scale) {
  const M0 = V3(m[0], m[1], m[2]), ln = new THREE.Line3(), cp = V3(0, 0, 0);
  let S = null, bd = Infinity;
  for (const s of segs) { ln.set(s[0], s[1]); ln.closestPointToPoint(M0, true, cp); const d = cp.distanceTo(M0); if (d < bd) { bd = d; S = s; } }
  if (!S || bd > Math.max(0.5, scale * 0.01)) return null;
  const e = V3().subVectors(S[1], S[0]).normalize(), M = V3().addVectors(S[0], S[1]).multiplyScalar(0.5), tol = Math.max(1e-3, scale * 2e-5);
  const fs = facesAt(g, M, e, tol);
  if (fs.length < 2) throw new Error('평평한 면 위의 선입니다 — 두 면이 만나는 모서리를 고르세요');
  let f1 = fs[0], f2 = fs[1], md = Infinity;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) { const d = fs[i].n.dot(fs[j].n); if (d < md) { md = d; f1 = fs[i]; f2 = fs[j]; } }
  const convex = f2.t.dot(f1.n) < 0, q = v => Math.round(v * 100) / 100;
  const circ = circleFromVotes(segs, M, e, [f1, f2], scale);
  if (circ) return { type: 'circle', ...circ, M, t1: f1.t, t2: f2.t, convex, key: `c${q(circ.c.x)},${q(circ.c.y)},${q(circ.c.z)},${q(circ.R)}` };
  const { P0, P1 } = expandStraight(segs, S, e, tol * 5);
  const k = [P0, P1].map(p => `${q(p.x)},${q(p.y)},${q(p.z)}`).sort().join('|');
  return { type: 'line', P0, P1, e, t1: f1.t, t2: f2.t, convex, key: 'l' + k };
}
// 모서리 단면(모서리 점 E, 두 면 방향 t1·t2) → 깎거나 채울 영역 다각형을 직선은 밀고 원형은 회전
function edgeTool(ed, kind, val, scale) {
  const t1 = ed.t1, w = V3().copy(ed.t2).addScaledVector(t1, -ed.t2.dot(t1));
  if (w.length() < 1e-6) throw new Error('두 면이 거의 평평하게 이어진 모서리라 처리할 수 없습니다');
  w.normalize();
  const al = Math.acos(clamp1(t1.dot(ed.t2)));
  if (al > Math.PI * 0.97) throw new Error('두 면이 거의 평평하게 이어진 모서리라 처리할 수 없습니다');
  const eps = Math.max(0.01, scale * 1e-4), ca = Math.cos(al), sa = Math.sin(al), bis = V2(Math.cos(al / 2), Math.sin(al / 2));
  const pts = [bis.clone().multiplyScalar(-eps / Math.sin(al / 2))];
  if (kind === 'chamfer') {
    pts.push(V2(val, -eps), V2(val, 0), V2(val * ca, val * sa), V2(val * ca - sa * eps, val * sa + ca * eps));
  } else {
    const k = val / Math.tan(al / 2), C = bis.clone().multiplyScalar(val / Math.sin(al / 2)), A = V2(k, 0), B = V2(k * ca, k * sa);
    const a0 = Math.atan2(A.y - C.y, A.x - C.x), a1 = Math.atan2(B.y - C.y, B.x - C.x), tgt = Math.atan2(-bis.y, -bis.x);
    let d = a1 - a0; while (d > Math.PI) d -= TAU; while (d <= -Math.PI) d += TAU;
    const midA = a0 + d / 2; if (Math.abs(Math.atan2(Math.sin(midA - tgt), Math.cos(midA - tgt))) > Math.PI / 2) d -= Math.sign(d) * TAU;
    pts.push(V2(k, -eps));
    const n = Math.max(8, Math.ceil(Math.abs(d) / TAU * 96));
    for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; pts.push(V2(C.x + val * Math.cos(a), C.y + val * Math.sin(a))); }
    pts.push(V2(k * ca - sa * eps, k * sa + ca * eps));
  }
  if (ed.type === 'line') {
    const ext = Math.max(0.02, scale * 1e-4), z = V3().crossVectors(t1, w);
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: ed.P0.distanceTo(ed.P1) + 2 * ext, bevelEnabled: false, curveSegments: 1 });
    const start = z.dot(ed.e) > 0 ? ed.P0.clone().addScaledVector(ed.e, -ext) : ed.P1.clone().addScaledVector(ed.e, ext);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(t1, w, z).setPosition(start));
    return prep(g);
  }
  const prof = pts.map(p => { const P = ed.M.clone().addScaledVector(t1, p.x).addScaledVector(w, p.y).sub(ed.c); const h = P.dot(ed.ax); return V2(P.addScaledVector(ed.ax, -h).length(), h); });
  prof.push(prof[0].clone());
  const g = new THREE.LatheGeometry(prof, 128);
  const u = Math.abs(ed.ax.x) < 0.9 ? V3(1, 0, 0) : V3(0, 1, 0); u.addScaledVector(ed.ax, -u.dot(ed.ax)).normalize();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(u, ed.ax, V3().crossVectors(u, ed.ax)).setPosition(ed.c));
  const out = prep(g); if (massProps(out).V < 0) flipWinding(out);
  return out;
}
function featureList() {
  const list = state.features.slice();
  if (editing) { const i = list.findIndex(f => f.id === editing.feat.id); if (i >= 0) list[i] = editing.feat; else list.push(editing.feat); }
  return list;
}
function regen() {
  const ents = D.getEnts();
  regions = sketchRegions(ents); regionsByKey = new Map(regions.map(r => [r.key, r]));
  bodies = []; errors = {}; beforeIds = {}; bodyCounter = 0; draftTool = null; pickGeom = null; pickSegs = []; draftEdges = []; draftFaces = [];
  // 바뀌지 않은 앞쪽 피처는 저장해 둔 결과를 다시 씀 (서명 = 스케치 + 이름 + 지금까지의 피처)
  let sig = hashStr(JSON.stringify(ents) + '|' + JSON.stringify(Object.entries(state.props).map(([k, v]) => [k, v && v.name])));
  const list = featureList(), nextMemo = [];
  list.forEach((f, i) => {
    beforeIds[f.id] = bodies.map(b => ({ id: b.id, name: b.name }));
    const isDraft = !!(editing && editing.feat === f);
    sig = hashStr(sig + '|' + JSON.stringify(f));
    const m = memo[i];
    if (!isDraft && m && m.sig === sig) {
      bodies = m.bodies.map(b => ({ ...b })); bodyCounter = m.counter; if (m.err) errors[f.id] = m.err;
      nextMemo.push(m); return;
    }
    if (!f.suppressed) {
      const snap = bodies.map(b => ({ ...b }));
      try { runFeature(f, ents, isDraft); }
      catch (err) { errors[f.id] = err && err.message ? err.message : String(err); bodies = snap; }
    }
    nextMemo.push(isDraft ? null : { sig, bodies: bodies.map(b => ({ ...b })), counter: bodyCounter, err: errors[f.id] });
  });
  memo = nextMemo;
  selSet = new Set([...selSet].filter(id => findBody(id))); if (selBody && !findBody(selBody)) selBody = [...selSet].pop() || null;
  dirty = false;
  if (clash && Object.entries(clash.geoms).some(([id, g]) => !findBody(id) || findBody(id).geom !== g)) clash = null;
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
// 휠 클릭(가운데 버튼)으로 화면 회전, 오른쪽 끌기로 이동, 휠로 확대
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
renderer.domElement.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
controls.addEventListener('change', draw);
const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.6, 0.4, 1); camera.add(key); scene.add(camera);
// 사실적 렌더링: 주변 환경 반사 + 그림자
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.visible = false; scene.add(sun, sun.target);
let envTex = null;
function envMap() { if (!envTex) { const pm = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment(); room.rotation.x = Math.PI / 2; room.updateMatrixWorld(true); envTex = pm.fromScene(room, 0.04).texture; pm.dispose(); } return envTex; }
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
  const xray = view.display === 'xray', wire = view.display === 'wire', real = view.display === 'render', dra = view.display === 'draft';
  scene.environment = real ? envMap() : null; renderer.toneMapping = real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = real ? 1.2 : 1;
  hemi.intensity = real ? 0.35 : 1.4; key.intensity = real ? 1.1 : 2.2; sun.visible = real; gHelpers.visible = !real;
  const exo = explodeOffsets();
  bodies.forEach((b, i) => {
    if (state.props[b.id] && state.props[b.id].hidden) return;
    const sel = selSet.has(b.id), hole = !!(state.props[b.id] && state.props[b.id].hole), ex = exo.get(b.id) || V3();
    const common = { side: THREE.DoubleSide, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      emissive: sel ? new THREE.Color(T.accent) : new THREE.Color(0), emissiveIntensity: sel ? 0.28 : 0 }; // DoubleSide: 불리언 결과에 섞인 뒤집힌 조각 삼각형도 제대로 칠함
    let mat, geom = b.geom, own = false;
    if (dra && !hole) { geom = draftGeom(b.geom); own = true; mat = new THREE.MeshLambertMaterial({ ...common, vertexColors: true }); }
    else if (real && !hole) {
      const p = state.props[b.id] || {}, ap = p.mat ? APPEAR[p.mat] : null;
      geom = smoothGeom(b.geom); own = true; common.envMapIntensity = ap && ap.m ? 1.35 : 1;
      mat = ap && ap.glass ? new THREE.MeshPhysicalMaterial({ ...common, color: ap.c, metalness: 0, roughness: 0.06, transmission: 1, thickness: 4, ior: 1.5, transparent: true })
        : new THREE.MeshStandardMaterial({ ...common, color: (ap && ap.c) || bodyColor(b, i), metalness: ap ? ap.m : 0.05, roughness: ap ? ap.r : 0.45 });
    } else mat = new THREE.MeshStandardMaterial({ ...common, color: hole ? '#8d979f' : bodyColor(b, i), roughness: 0.55, metalness: 0.08,
      transparent: xray || wire || hole, opacity: wire ? 0.06 : hole ? 0.32 : xray ? 0.35 : 1, depthWrite: !(xray || wire || hole) });
    const mesh = new THREE.Mesh(geom, mat); mesh.userData = { bid: b.id, keepGeom: !own, ex }; mesh.position.copy(ex);
    if (real) { mesh.castShadow = true; mesh.receiveShadow = true; }
    gBodies.add(mesh);
    if (view.display !== 'shaded' && !real) {
      const eg = new THREE.BufferGeometry(), ep = []; for (const [a, c] of edgeSegs(b.geom, 25)) ep.push(a.x, a.y, a.z, c.x, c.y, c.z);
      eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
      const ls = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: sel ? T.accent : (wire || hole ? T.ink : '#1e272d'), clippingPlanes: clip, transparent: true, opacity: hole ? 0.45 : wire ? 0.9 : 0.75 }));
      ls.userData.bidE = b.id; ls.userData.ex = ex; ls.position.copy(ex); gBodies.add(ls);
    }
  });
  if (real) {
    const bx = sceneBox(), c = bx.getCenter(V3()), r = Math.max(20, bx.getSize(V3()).length());
    sun.position.set(c.x + r * 0.6, c.y - r * 0.9, c.z + r * 1.4); sun.target.position.copy(c);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.near = 0.1; sc.far = r * 4; sc.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = r * 0.002;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(r * 8, r * 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.position.set(c.x, c.y, bx.min.z - 0.02); ground.receiveShadow = true; gBodies.add(ground);
  }
  if (clash) for (const p of clash.pairs) {
    const m = new THREE.Mesh(p.geom, new THREE.MeshBasicMaterial({ color: T.c1, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    m.userData.keepGeom = true; m.renderOrder = 8; gBodies.add(m);
  }
  pickMesh = null;
  if (editing && pickGeom && editing.feat.type === 'shell') {
    pickMesh = new THREE.Mesh(pickGeom, new THREE.MeshBasicMaterial({ visible: false })); pickMesh.userData.keepGeom = true; gBodies.add(pickMesh);
    for (const pos of draftFaces) {
      if (!pos.length) continue; const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide })); m.renderOrder = 6; gBodies.add(m);
    }
  }
  pickLines = null;
  if (editing && pickGeom && (editing.feat.type === 'fillet3d' || editing.feat.type === 'chamfer3d')) {
    const pos = []; for (const [a, b] of pickSegs) pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pickLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: T.c4, depthTest: false, transparent: true, opacity: 0.9 }));
    pickLines.renderOrder = 5; gBodies.add(pickLines);
    for (const ed of draftEdges) {
      let p;
      if (ed.type === 'line') p = [ed.P0, ed.P1];
      else { const u = V3().subVectors(ed.M, ed.c); u.addScaledVector(ed.ax, -u.dot(ed.ax)).normalize(); const v = V3().crossVectors(ed.ax, u); p = []; for (let i = 0; i <= 96; i++) { const a = TAU * i / 96; p.push(ed.c.clone().addScaledVector(u, ed.R * Math.cos(a)).addScaledVector(v, ed.R * Math.sin(a))); } }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: T.accent, depthTest: false })); l.renderOrder = 6; gBodies.add(l);
    }
  }
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
  rebuildRefImage();
  rebuildGizmo();
  draw();
}
// 참고 이미지 (스케치 바닥에 깐 그림)를 3D 바닥에도 보여 줌
const gRef = new THREE.Group(); scene.add(gRef); let refTex = null, refSrc = '';
function rebuildRefImage() {
  disposeGroup(gRef);
  const im = D.getRefImage && D.getRefImage();
  if (!im || !im.show || !view.sketch || !im.h) { draw(); return; }
  if (refSrc !== im.src) { if (refTex) refTex.dispose(); refTex = new THREE.TextureLoader().load(im.src, draw); refTex.colorSpace = THREE.SRGBColorSpace; refSrc = im.src; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(im.w, im.h), new THREE.MeshBasicMaterial({ map: refTex, transparent: true, opacity: im.op, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(im.x + im.w / 2, im.y + im.h / 2, 0.01); m.renderOrder = -1; gRef.add(m);
}
// 크기 조절(흰 상자) · 회전(고리) 손잡이
const gGizmo = new THREE.Group(); scene.add(gGizmo);
const AXC = ['#d0453a', '#3f9a4b', '#3d72c8'];
function rebuildGizmo() {
  disposeGroup(gGizmo);
  if (editing || measure.on || placing || selSet.size !== 1 || gizmoDrag || view.explode > 0) return;
  const b = findBody(selBody); if (!b || (state.props[b.id] && state.props[b.id].hidden)) return;
  b.geom.computeBoundingBox();
  const bb = b.geom.boundingBox, c = bb.getCenter(V3()), sz = bb.getSize(V3()), d = Math.max(sz.x, sz.y, sz.z, 1), hs = Math.max(0.8, d * 0.04);
  const box = new THREE.BoxGeometry(hs, hs, hs), boxE = new THREE.EdgesGeometry(box);
  const handle = (pos, data, fill) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: fill || '#ffffff', depthTest: false })); m.position.copy(pos); m.renderOrder = 30; m.userData = { handle: data, keepGeom: true }; gGizmo.add(m);
    const e = new THREE.LineSegments(boxE, new THREE.LineBasicMaterial({ color: '#1e272d', depthTest: false })); e.position.copy(pos); e.renderOrder = 31; e.userData.keepGeom = true; gGizmo.add(e);
  };
  const z0 = bb.min.z;
  handle(V3(bb.max.x, c.y, z0), { kind: 'size', axes: [[0, 1]] }); handle(V3(bb.min.x, c.y, z0), { kind: 'size', axes: [[0, -1]] });
  handle(V3(c.x, bb.max.y, z0), { kind: 'size', axes: [[1, 1]] }); handle(V3(c.x, bb.min.y, z0), { kind: 'size', axes: [[1, -1]] });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) handle(V3(sx > 0 ? bb.max.x : bb.min.x, sy > 0 ? bb.max.y : bb.min.y, z0), { kind: 'size', axes: [[0, sx], [1, sy]] });
  handle(V3(c.x, c.y, bb.max.z + hs * 1.2), { kind: 'size', axes: [[2, 1]] }, T.accent);
  const ring = (ax, R) => {
    const vis = new THREE.Mesh(new THREE.TorusGeometry(R, hs * 0.1, 6, 128), new THREE.MeshBasicMaterial({ color: AXC[ax], depthTest: false, transparent: true, opacity: 0.85 }));
    const pick = new THREE.Mesh(new THREE.TorusGeometry(R, hs * 0.5, 6, 64), new THREE.MeshBasicMaterial({ visible: false }));
    for (const m of [vis, pick]) { if (ax === 0) m.rotation.y = Math.PI / 2; if (ax === 1) m.rotation.x = Math.PI / 2; m.position.copy(c); m.renderOrder = 29; gGizmo.add(m); }
    pick.userData.handle = { kind: 'rot', ax };
  };
  ring(2, Math.hypot(sz.x, sz.y) / 2 + hs * 2); ring(0, Math.hypot(sz.y, sz.z) / 2 + hs * 3); ring(1, Math.hypot(sz.x, sz.z) / 2 + hs * 4);
}
let gizmoDrag = null;
function lineParam(o, dir) {
  // 카메라 광선과 (점 o, 방향 dir) 직선 사이 가장 가까운 점의 직선 위 매개변수
  const r = ray.ray, w0 = V3().subVectors(r.origin, o), b = r.direction.dot(dir), d = r.direction.dot(w0), e = dir.dot(w0), den = 1 - b * b;
  return Math.abs(den) < 1e-9 ? null : (e - b * d) / den;
}
function gizmoStart(e, hit) {
  const h = hit.object.userData.handle, b = findBody(selBody); if (!b) return false;
  b.geom.computeBoundingBox(); const bb = b.geom.boundingBox.clone(), c = bb.getCenter(V3()), sz = bb.getSize(V3());
  const g = { h, bid: b.id, bb, c, sz, M: new THREE.Matrix4() };
  if (h.kind === 'size') {
    if (h.axes.length === 1) { const ax = h.axes[0][0], dir = V3(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0); g.o = hit.object.position.clone(); g.dir = dir; g.p0 = lineParam(g.o, dir); }
    else { g.plane = new THREE.Plane(V3(0, 0, 1), -bb.min.z); g.q0 = ray.ray.intersectPlane(g.plane, V3()); }
  } else {
    const n = V3(h.ax === 0 ? 1 : 0, h.ax === 1 ? 1 : 0, h.ax === 2 ? 1 : 0); g.n = n; g.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c);
    g.u = V3(h.ax === 0 ? 0 : 1, h.ax === 0 ? 1 : 0, 0); if (h.ax === 2) g.u.set(1, 0, 0); g.v = V3().crossVectors(n, g.u);
    const q = ray.ray.intersectPlane(g.plane, V3()); if (!q) return false; q.sub(c); g.a0 = Math.atan2(q.dot(g.v), q.dot(g.u));
  }
  gizmoDrag = g; controls.enabled = false; gGizmo.visible = false; return true;
}
function gizmoMove(e) {
  const g = gizmoDrag; setNdc(e);
  const sn = v => Math.max(view.snap, Math.round(v / view.snap) * view.snap), bb = g.bb;
  if (g.h.kind === 'size') {
    const k = [1, 1, 1], anc = [g.c.x, g.c.y, bb.min.z];
    if (g.h.axes.length === 1) {
      const p = lineParam(g.o, g.dir); if (p === null || g.p0 === null) return;
      const [ax, sign] = g.h.axes[0], s0 = g.sz.getComponent(ax) || 1, ns = sn(s0 + (p - g.p0));
      k[ax] = ns / s0; anc[ax] = ax === 2 ? bb.min.z : sign > 0 ? bb.min.getComponent(ax) : bb.max.getComponent(ax);
    } else {
      const q = ray.ray.intersectPlane(g.plane, V3()); if (!q || !g.q0) return;
      for (const [ax, sign] of g.h.axes) { const s0 = g.sz.getComponent(ax) || 1; k[ax] = sn(s0 + sign * (q.getComponent(ax) - g.q0.getComponent(ax))) / s0; anc[ax] = sign > 0 ? bb.min.getComponent(ax) : bb.max.getComponent(ax); }
    }
    if (e.shiftKey) { const used = g.h.axes.map(a => a[0]), u = used.length === 1 ? k[used[0]] : Math.max(k[0], k[1]); k[0] = k[1] = k[2] = u; anc[2] = bb.min.z; for (let i = 0; i < 2; i++) if (!used.includes(i)) anc[i] = i === 0 ? g.c.x : g.c.y; }
    const A = V3(...anc);
    g.M = new THREE.Matrix4().makeTranslation(A.x, A.y, A.z).multiply(new THREE.Matrix4().makeScale(...k)).multiply(new THREE.Matrix4().makeTranslation(-A.x, -A.y, -A.z));
    flash(`크기 ${fmt(g.sz.x * k[0])} × ${fmt(g.sz.y * k[1])} × ${fmt(g.sz.z * k[2])} mm${e.shiftKey ? ' (비율 유지)' : ''}`);
  } else {
    const q = ray.ray.intersectPlane(g.plane, V3()); if (!q) return; q.sub(g.c);
    const step = (e.shiftKey ? 1 : 15) * DEG; let a = Math.atan2(q.dot(g.v), q.dot(g.u)) - g.a0; a = Math.round(a / step) * step;
    const c = g.c; g.M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(g.n, a)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    flash(`${'XYZ'[g.h.ax]}축 회전 ${fmt(a / DEG)}°${e.shiftKey ? '' : ' (Shift: 1° 단위)'}`);
  }
  for (const o of gBodies.children) if (o.userData.bid === g.bid || o.userData.bidE === g.bid) { o.matrixAutoUpdate = false; o.matrix.copy(g.M); o.matrixWorldNeedsUpdate = true; }
  draw();
}
function gizmoEnd() {
  const g = gizmoDrag; gizmoDrag = null; controls.enabled = true; gGizmo.visible = true;
  if (!g.M.equals(new THREE.Matrix4())) addXform(g.bid, g.M); else rebuildScene();
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
    case 'wedge': return [N('w', '폭 X'), N('d', '깊이 Y'), N('h', '높이 Z'), ...pos, ...opTarget];
    case 'pyramid': return [N('w', '밑변'), N('h', '높이'), ...pos, ...opTarget];
    case 'tube': return [N('r', '바깥 반지름'), N('r2', '안쪽 반지름'), N('h', '높이'), ...pos, ...opTarget];
    case 'hemisphere': return [N('r', '반지름'), ...pos, ...opTarget];
    case 'relief': return [N('width', '폭 (mm)'), N('base', '바닥 두께'), N('height', '최대 높이'), { k: 'invert', l: '어두운 곳을 높게', t: 'chk' }, ...pos, ...opTarget];
    case 'place': return [{ k: 'moves', t: 'moves' }];
    case 'copy': return [{ k: 'body', l: '원본 바디', t: 'body' }, N('dx', '간격 X'), N('dy', '간격 Y'), N('dz', '간격 Z')];
    case 'group': return [{ k: 'target', l: '기준 바디', t: 'body' }, { k: 'groupinfo', t: 'groupinfo' }];
    case 'boolean': return [{ k: 'target', l: '대상 바디', t: 'body' }, { k: 'tools', t: 'tools' }, S('op', '작업', OPLIST.slice(1)), { k: 'keep', l: '도구 바디 남기기', t: 'chk' }];
    case 'move': return [{ k: 'body', l: '바디', t: 'body' }, N('dx', '이동 X'), N('dy', '이동 Y'), N('dz', '이동 Z'), N('rx', '회전 X°'), N('ry', '회전 Y°'), N('rz', '회전 Z°')];
    case 'pattern': return [{ k: 'body', l: '바디', t: 'body' }, S('kind', '종류', [['rect', '직사각형 배열'], ['circ', '원형 배열 (Z축)']]),
      ...(f.kind === 'rect' ? [N('nx', 'X 개수'), N('dx', 'X 간격'), N('ny', 'Y 개수'), N('dy', 'Y 간격')] : [N('n', '개수'), N('angle', '전체 각도°'), N('cx', '중심 X'), N('cy', '중심 Y')])];
    case 'mirror': return [{ k: 'body', l: '바디', t: 'body' }, S('plane', '대칭 평면', planes), N('offset', '평면 위치'), { k: 'merge', l: '원본과 합치기', t: 'chk' }];
    case 'split': return [{ k: 'body', l: '바디', t: 'body' }, S('plane', '분할 평면', planes), N('offset', '평면 위치')];
    case 'fillet3d': return [{ k: 'body', l: '바디', t: 'body' }, N('r', '반지름'), { k: 'edges', t: 'edges' }];
    case 'chamfer3d': return [{ k: 'body', l: '바디', t: 'body' }, N('d', '거리'), { k: 'edges', t: 'edges' }];
    case 'shell': return [{ k: 'body', l: '바디', t: 'body' }, N('t', '벽 두께'), S('dir', '방향', [['in', '안쪽 (바깥 크기 유지)'], ['out', '바깥쪽 (안쪽 크기 유지)'], ['both', '양쪽 (반반)']]), { k: 'faces', t: 'faces' }];
    case 'remove': return [{ k: 'body', l: '지울 바디', t: 'body' }];
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
    else if (d.t === 'moves') {
      const ids = Object.keys(f.moves || {});
      h += `</div><p class="hint" style="margin:10px 0 6px">화면에서 끌거나 방향키로 옮긴 거리입니다 (mm).</p><div class="fields" style="grid-template-columns:auto repeat(3,minmax(0,1fr))">`;
      for (const id of ids) { const nm = (before.find(b => b.id === id) || {}).name || id, v = f.moves[id], off = v.length === 16 ? 12 : 0; h += `<label>${esc(nm)}${off ? ' *' : ''}</label>` + [0, 1, 2].map(i => `<input data-mv="${esc(id)}:${i}" inputmode="decimal" aria-label="${esc(nm)} ${'XYZ'[i]}" value="${fmt(v[off + i])}">`).join(''); }
      if (ids.some(id => f.moves[id].length === 16)) h += `<p class="hint" style="grid-column:1/-1;margin:4px 0 0">* 크기·회전 손잡이로 바꾼 바디 — 여기서는 이동 거리만 고칠 수 있습니다</p>`;
      h += `</div><div class="fields" style="margin-top:8px">`;
    }
    else if (d.t === 'groupinfo') {
      const nm = id => (before.find(b => b.id === id) || {}).name || id;
      h += `</div><p class="hint" style="margin:10px 0 0">솔리드: ${(f.solids || []).map(nm).map(esc).join(', ') || '없음'}<br>구멍: ${(f.holes || []).map(nm).map(esc).join(', ') || '없음'}</p><div class="fields">`;
    }
    else if (d.t === 'faces') {
      h += `</div><p class="hint" style="margin:10px 0 6px">열 면 <b id="faceCount">${f.faces.length}</b>개 — 화면에서 평평한 면을 클릭해 고르거나 다시 눌러 빼세요. 고르지 않으면 속이 빈 닫힌 바디가 됩니다. 안을 보려면 표시를 반투명으로 바꾸거나 단면을 켜세요.</p><div class="row"><button class="btn" id="faceClear">열 면 모두 빼기</button></div><div class="fields" style="margin-top:8px">`;
    }
    else if (d.t === 'edges') {
      h += `</div><p class="hint" style="margin:10px 0 6px">고른 모서리 <b id="edgeCount">${f.edges.length}</b>개 — 화면의 파란 모서리를 클릭해 고르거나 다시 눌러 빼세요. 직선과 원형 모서리를 고를 수 있습니다.</p><div class="row"><button class="btn" id="edgeClear">모서리 모두 빼기</button></div><div class="fields" style="margin-top:8px">`;
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
  const ec = $('#edgeCount'); if (ec) ec.textContent = editing.feat.edges.length;
  const fcn = $('#faceCount'); if (fcn) fcn.textContent = editing.feat.faces.length;
  panel.querySelectorAll('[data-prof]').forEach(c => { c.checked = editing.feat.profiles.includes(c.dataset.prof); });
}
function renderPanel() {
  if (editing) { renderDialog(); return; }
  if (placing) {
    const defs = fieldDefs({ type: placing.type, ...placing.f }).filter(d => (d.t === 'num' || d.t === 'chk') && !['x', 'y', 'z'].includes(d.k));
    let h = `<section><h2>${ICON[placing.type]} ${NAMES[placing.type]} 놓기</h2><div class="fields">`;
    for (const d of defs) h += d.t === 'chk' ? `<label for="p-${d.k}">${d.l}</label><input id="p-${d.k}" data-pf="${d.k}" type="checkbox" ${placing.f[d.k] ? 'checked' : ''} style="width:auto;justify-self:start">`
      : `<label for="p-${d.k}">${d.l}</label><input id="p-${d.k}" data-pf="${d.k}" inputmode="decimal" value="${esc(placing.f[d.k])}">`;
    if (placing.type === 'relief' && placing.f.grid) h += `<label>이미지</label><span class="muted">${placing.f.grid.w}×${placing.f.grid.h} 칸</span>`;
    h += `<label for="p-hole">구멍으로</label><input id="p-hole" data-pf="__hole" type="checkbox" ${placing.hole ? 'checked' : ''} style="width:auto;justify-self:start"></div>
      <p class="hint" style="margin-top:10px">화면에서 놓을 자리를 클릭하세요. 다른 바디 윗면을 누르면 그 위에 올라갑니다.</p><div class="row"><button class="btn" id="placeCancel">취소 (Esc)</button></div></section>`;
    panel.innerHTML = h; return;
  }
  let h = `<section><h2>도형</h2><div class="shapes"><button class="shape" draggable="true" data-shape="box" title="상자 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><path d="M3 7l7-4 7 4v7l-7 4-7-4z"/><path d="M3 7l7 4 7-4M10 11v7"/></svg><span>상자</span></button><button class="shape" draggable="true" data-shape="cylinder" title="원통 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><ellipse cx="10" cy="5" rx="6" ry="2.2"/><path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5"/></svg><span>원통</span></button><button class="shape" draggable="true" data-shape="sphere" title="구 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><ellipse cx="10" cy="10" rx="7" ry="2.5"/></svg><span>구</span></button><button class="shape" draggable="true" data-shape="cone" title="원뿔 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><path d="M10 3L4 15M10 3l6 12"/><ellipse cx="10" cy="15" rx="6" ry="2"/></svg><span>원뿔</span></button><button class="shape" draggable="true" data-shape="torus" title="토러스 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="7.5" ry="4.5"/><ellipse cx="10" cy="9.5" rx="3" ry="1.4"/></svg><span>토러스</span></button><button class="shape" draggable="true" data-shape="wedge" title="쐐기 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><path d="M3 16h14L3 5z"/><path d="M3 5l4-2 10 11"/></svg><span>쐐기</span></button><button class="shape" draggable="true" data-shape="pyramid" title="피라미드 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><path d="M10 3L3 15l7 2 7-2z"/><path d="M10 3v14"/></svg><span>피라미드</span></button><button class="shape" draggable="true" data-shape="tube" title="튜브 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><ellipse cx="10" cy="5" rx="6" ry="2.2"/><ellipse cx="10" cy="5" rx="3" ry="1.1"/><path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5"/></svg><span>튜브</span></button><button class="shape" draggable="true" data-shape="hemisphere" title="반구 — 클릭하거나 화면으로 끌어다 놓기"><svg viewBox="0 0 20 20"><path d="M3 13a7 7 0 0114 0z"/><ellipse cx="10" cy="13" rx="7" ry="2"/></svg><span>반구</span></button><button class="shape" data-shape="relief" title="이미지 입체 — 사진의 밝기를 높이로 바꾼 부조(리소페인)"><svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="M3 14l4-4 3 3 3-3 4 4"/></svg><span>이미지</span></button></div><p class="hint" style="margin-top:6px">누르고 치수를 정한 뒤 화면을 클릭해 놓습니다. 화면으로 끌어다 놓으면 기본 크기로 바로 놓입니다.</p></section>`;
  h += `<section><h2>브라우저</h2><div class="plist">`;
  h += `<div class="brow"><button class="eye" data-eye="sketch" aria-pressed="${view.sketch}" title="스케치 보이기/숨기기">${view.sketch ? '◉' : '○'}</button><span>스케치 (XY)</span><span class="muted">${regions.length}개 프로파일</span></div>`;
  bodies.forEach((b, i) => {
    const p = state.props[b.id] || {};
    h += `<div class="brow${selSet.has(b.id) ? ' on' : ''}" data-bid="${esc(b.id)}"><button class="eye" data-eye="${esc(b.id)}" aria-pressed="${!p.hidden}" title="보이기/숨기기">${p.hidden ? '○' : '◉'}</button><span class="dot" style="background:${p.hole ? 'transparent' : esc(bodyColor(b, i))}${p.hole ? ';border:1px dashed var(--muted)' : ''}"></span><span>${esc(b.name)}</span>${p.hole ? '<span class="muted">구멍</span>' : ''}</div>`;
  });
  if (!bodies.length) h += `<p class="hint">아직 바디가 없습니다. 위 도구 막대에서 <b>돌출</b>이나 <b>상자</b>로 시작하세요.</p>`;
  h += `</div></section>`;
  if (selSet.size > 1) {
    const al = (ax, list) => list.map(([v, l]) => `<button class="btn" data-align="${ax}:${v}">${l}</button>`).join('');
    h += `<section><h2>${selSet.size}개 선택</h2><div class="row"><button class="btn primary" data-cmd="group">그룹 (Ctrl+G)</button><button class="btn" data-cmd="dup">복제 (Ctrl+D)</button><button class="btn" data-cmd="drop">바닥에 (D)</button></div>
      <p class="hint" style="margin:10px 0 4px">그룹: 솔리드는 합치고 구멍은 뺍니다 · 정렬: 선택 범위 기준</p>
      <div class="aligns"><span>X</span>${al('x', [['min', '왼쪽'], ['mid', '가운데'], ['max', '오른쪽']])}<span>Y</span>${al('y', [['min', '앞'], ['mid', '가운데'], ['max', '뒤']])}<span>Z</span>${al('z', [['min', '아래'], ['mid', '가운데'], ['max', '위']])}</div>
      <div class="row" style="margin-top:10px"><button class="btn danger" data-cmd="delete">지우기 (Delete)</button></div></section>`;
  }
  const b = selSet.size === 1 && selBody && findBody(selBody);
  if (b) {
    const p0 = state.props[b.id] || {}, src = state.features.find(x => 'b' + x.id === b.id);
    h += `<section><h2>${esc(b.name)}</h2><div class="segs" role="group" aria-label="솔리드 또는 구멍"><button data-hole="0" aria-pressed="${!p0.hole}">솔리드</button><button data-hole="1" aria-pressed="${!!p0.hole}">구멍 (H)</button></div>
      <div class="row" style="margin-top:8px"><button class="btn" data-cmd="dup">복제 (Ctrl+D)</button><button class="btn" data-cmd="drop">바닥에 (D)</button>${src ? `<button class="btn" data-editf="${src.id}">피처 편집</button>` : ''}</div>`;
    if (src && PRIMS.includes(src.type)) {
      h += `<p class="hint" style="margin:10px 0 4px">치수 (만들 때 위치 기준)</p><div class="fields">` + fieldDefs(src).filter(d => d.t === 'num').map(d => `<label for="q-${d.k}">${d.l}</label><input id="q-${d.k}" data-qf="${d.k}" data-qid="${src.id}" inputmode="decimal" value="${esc(src[d.k])}">`).join('') + `</div>`;
    }
    h += `</section>`;
    const i = bodies.indexOf(b), p = state.props[b.id] || {}, mp = massProps(b.geom), sz = mp.bb.getSize(V3(0, 0, 0));
    const mat = MATERIALS.find(m => m[0] === p.mat) || MATERIALS[0];
    h += `<section><h2>${esc(b.name)}</h2><div class="fields"><label for="bName">이름</label><input id="bName" value="${esc(b.name)}">
      <label for="bMat">재질</label><select id="bMat">${opts(MATERIALS.map(m => [m[0], `${m[1]} (${m[2]} g/cm³)`]), mat[0])}</select></div>
      <div class="swatches" style="margin-top:10px">${BODY_COLORS.map(c => `<button class="sw" data-bcolor="${c}" aria-pressed="${bodyColor(b, i) === c}" style="background:${c}" title="색상"></button>`).join('')}</div>
      <dl class="info" style="margin-top:12px"><dt>부피</dt><dd>${fmt(mp.V / 1000)} cm³</dd><dt>표면적</dt><dd>${fmt(mp.A)} mm²</dd>
      <dt>질량</dt><dd>${fmt(mp.V / 1000 * mat[2])} g</dd><dt>크기</dt><dd>${fmt(sz.x)} × ${fmt(sz.y)} × ${fmt(sz.z)}</dd>
      <dt>무게중심</dt><dd>${fmt(mp.c.x)}, ${fmt(mp.c.y)}, ${fmt(mp.c.z)}</dd><dt>삼각형</dt><dd>${triCount(b.geom).toLocaleString()}</dd></dl><div class="row" style="margin-top:10px"><button class="btn danger" data-cmd="delete">바디 지우기 (Delete)</button></div></section>`;
  }
  if (clash) {
    h += `<section><h2>간섭 검사</h2>`;
    if (!clash.pairs.length) h += `<p class="hint">검사한 바디 ${clash.n}개 사이에 겹치는 부분이 없습니다 ✓</p>`;
    else { h += `<p class="hint" style="margin-bottom:6px">겹친 곳 ${clash.pairs.length}군데 — 빨간색으로 표시했습니다. 누르면 두 바디를 고릅니다.</p>`;
      for (const [i, p] of clash.pairs.entries()) h += `<div class="clash" data-clash="${i}"><span>${esc(p.an)} ↔ ${esc(p.bn)}</span><b>${fmt(p.V)} mm³</b></div>`; }
    if (clash.skipped) h += `<p class="hint">계산하지 못한 쌍 ${clash.skipped}개</p>`;
    h += `<div class="row" style="margin-top:8px"><button class="btn" data-cmd="clash">다시 검사</button><button class="btn" id="clashOff">결과 지우기</button></div></section>`;
  }
  if (measure.on) {
    let m = '모델 표면의 두 점을 클릭하세요';
    if (measure.pts.length === 1) m = '두 번째 점을 클릭하세요';
    if (measure.pts.length === 2) { const [a, c] = measure.pts, d = c.clone().sub(a); m = `<b>${fmt(d.length())} mm</b><br>ΔX ${fmt(d.x)} · ΔY ${fmt(d.y)} · ΔZ ${fmt(d.z)}`; }
    h += `<section><h2>측정</h2><p class="hint">${m}</p></section>`;
  }
  const box = sceneBox(), ax = { x: 'x', y: 'y', z: 'z' }[view.secAxis];
  h += `<section><h2>보기</h2><div class="fields"><label for="vSnap">그리드 스냅</label><select id="vSnap">${opts([[0.1, '0.1 mm'], [0.5, '0.5 mm'], [1, '1 mm'], [2, '2 mm'], [5, '5 mm'], [10, '10 mm']], view.snap)}</select><label for="vDisp">표시</label><select id="vDisp">${opts([['edges', '음영 + 모서리'], ['shaded', '음영'], ['render', '사실적 렌더링'], ['xray', '반투명'], ['wire', '와이어프레임'], ['draft', '구배 분석']], view.display)}</select>
    <label for="vSec">단면</label><select id="vSec">${opts([['off', '끄기'], ['x', 'X 방향'], ['y', 'Y 방향'], ['z', 'Z 방향']], view.section ? view.secAxis : 'off')}</select></div>
    ${view.section ? `<input type="range" id="vSecPos" min="${box.min[ax] - 1}" max="${box.max[ax] + 1}" step="0.1" value="${view.secPos}" style="width:100%;margin-top:8px" aria-label="단면 위치"><p class="hint">단면 위치 ${fmt(view.secPos)} mm</p>` : ''}
    ${view.display === 'render' ? `<p class="hint" style="margin-top:8px">바디의 <b>재질</b>(강철·황동·유리 등)에 따라 겉모습이 바뀝니다. PNG 버튼으로 이미지를 저장하세요.</p>` : ''}
    ${view.display === 'draft' ? `<div class="fields" style="margin-top:8px"><label for="vDDir">빼는 방향</label><select id="vDDir">${opts([['z', '+Z (위로)'], ['-z', '−Z (아래로)'], ['x', '+X'], ['-x', '−X'], ['y', '+Y'], ['-y', '−Y']], view.draftDir)}</select><label for="vDAng">최소 구배°</label><input id="vDAng" inputmode="decimal" value="${view.draftAng}"></div>
      <div class="legend"><i style="background:#3fa34d"></i><span>양(+) 구배 — 금형에서 잘 빠짐</span><i style="background:#e0b23a"></i><span>구배 부족 (±${fmt(view.draftAng)}° 안, 수직에 가까움)</span><i style="background:#d0453a"></i><span>음(−) 구배 — 언더컷, 반대쪽 금형</span></div>` : ''}
    <label class="hint" for="vExp" style="display:block;margin-top:10px">분해도 ${Math.round(view.explode * 100)}% (X)</label><input type="range" id="vExp" min="0" max="1.5" step="0.01" value="${view.explode}" style="width:100%">
    </section>`;
  h += `<section><h2>도움말</h2><div class="keys"><b>바디 끌기</b><span>바닥 위에서 옮기기</span><b>빈 곳 끌기</b><span>화면 회전</span><b>오른쪽 끌기</b><span>화면 이동</span><b>휠</b><span>확대·축소</span><b>Shift+클릭</b><span>여러 개 선택</span><b>방향키</b><span>조금씩 옮기기 (Shift ×10)</span><b>PgUp/PgDn</b><span>위아래로</span><b>D</b><span>바닥에 놓기</span><b>H</b><span>솔리드/구멍 전환</span><b>Ctrl+D/G</b><span>복제 / 그룹</span><b>Ctrl+A</b><span>모두 선택</span><b>E</b><span>돌출</span><b>X</b><span>분해도 켜기/끄기</span><b>Delete</b><span>선택한 바디 지우기</span><b>Ctrl+Z/Y</b><span>실행 취소/다시</span><b>Esc</b><span>취소</span></div>
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
  if ((type === 'boolean' || type === 'move' || type === 'pattern' || type === 'mirror' || type === 'split' || type === 'fillet3d' || type === 'chamfer3d' || type === 'shell' || type === 'copy') && !bodies.length) { flash('먼저 바디를 만드세요 — 돌출이나 상자부터 시작합니다'); return; }
  if (selBody) { if ('body' in f) f.body = selBody; if (type === 'boolean') { f.target = selBody; f.tools = [...selSet].filter(x => x !== selBody); } }
  const last = bodies.length ? bodies[bodies.length - 1].id : '';
  if ('body' in f && !f.body) f.body = last;
  if ('target' in f && !f.target) f.target = last;
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
function selected() { return [...selSet].map(findBody).filter(Boolean); }
function needSel(min = 1) {
  if (editing) { flash('먼저 편집 중인 피처를 확인하거나 취소하세요'); return null; }
  const list = selected(); if (list.length < min) { flash(min > 1 ? `바디를 ${min}개 이상 고르세요 — Shift+클릭으로 여러 개 고릅니다` : '바디를 먼저 클릭해서 고르세요'); return null; }
  return list;
}
function deleteBody() {
  const list = needSel(); if (!list) return;
  checkpoint();
  for (const b of list) state.features.push({ id: state.nextFid++, type: 'remove', body: b.id });
  selectOnly(null); persist(); regen();
  flash(`${list.map(b => b.name).join(', ')}을(를) 지웠습니다 — Ctrl+Z로 되돌리거나 타임라인의 지우기 피처를 삭제하면 돌아옵니다`);
}
// 끌기·방향키·정렬·바닥에 놓기는 맨 끝의 '배치' 피처 하나에 모아 기록 (타임라인이 어지럽지 않게)
const toMat = v => v.length === 16 ? new THREE.Matrix4().fromArray(v.map(Number)) : new THREE.Matrix4().makeTranslation(+v[0] || 0, +v[1] || 0, +v[2] || 0);
function placeFeature() {
  let f = state.features[state.features.length - 1];
  if (!f || f.type !== 'place' || f.suppressed) { f = { id: state.nextFid++, type: 'place', moves: {} }; state.features.push(f); }
  return f;
}
// 크기·회전 손잡이로 바꾼 변환을 배치 피처에 합침
function addXform(bid, M) {
  checkpoint();
  const f = placeFeature(), cur = f.moves[bid];
  const N = M.clone().multiply(cur ? toMat(cur) : new THREE.Matrix4());
  f.moves[bid] = N.toArray().map(v => +v.toFixed(8));
  persist(); regen();
}
function addPlace(map) {
  const ent = Object.entries(map).filter(([, d]) => Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-9); if (!ent.length) return;
  checkpoint();
  let f = state.features[state.features.length - 1];
  if (!f || f.type !== 'place' || f.suppressed) { f = { id: state.nextFid++, type: 'place', moves: {} }; state.features.push(f); }
  for (const [id, d] of ent) {
    const v = f.moves[id] || [0, 0, 0];
    f.moves[id] = v.length === 16 ? new THREE.Matrix4().makeTranslation(...d).multiply(toMat(v)).toArray().map(x => +x.toFixed(8)) : v.map((x, i) => +(x + d[i]).toFixed(6));
  }
  persist(); regen();
}
function nudge(dx, dy, dz) { const list = needSel(); if (!list) return; const m = {}; for (const b of list) m[b.id] = [dx, dy, dz]; addPlace(m); }
function dropToPlane() { const list = needSel(); if (!list) return; const m = {}; for (const b of list) { b.geom.computeBoundingBox(); m[b.id] = [0, 0, -b.geom.boundingBox.min.z]; } addPlace(m); }
function alignSel(ax, where) {
  const list = needSel(2); if (!list) return;
  const all = new THREE.Box3(); list.forEach(b => { b.geom.computeBoundingBox(); all.union(b.geom.boundingBox); });
  const m = {};
  for (const b of list) { const bb = b.geom.boundingBox, d = [0, 0, 0], i = 'xyz'.indexOf(ax);
    d[i] = where === 'min' ? all.min[ax] - bb.min[ax] : where === 'max' ? all.max[ax] - bb.max[ax] : (all.min[ax] + all.max[ax]) / 2 - (bb.min[ax] + bb.max[ax]) / 2; m[b.id] = d; }
  addPlace(m);
}
function duplicateSel() {
  const list = needSel(); if (!list) return;
  checkpoint(); const ns = [];
  for (const b of list) { const f = { id: state.nextFid++, type: 'copy', body: b.id, dx: 10, dy: 10, dz: 0 }; state.features.push(f); const nid = 'b' + f.id; const p = { ...(state.props[b.id] || {}) }; delete p.name; state.props[nid] = p; ns.push(nid); }
  selSet = new Set(ns); selBody = ns[ns.length - 1]; persist(); regen();
}
function groupSel() {
  const list = needSel(2); if (!list) return;
  const isHole = b => !!(state.props[b.id] && state.props[b.id].hole);
  const solids = list.filter(b => !isHole(b)), holes = list.filter(isHole);
  if (!solids.length) { flash('구멍만으로는 그룹을 만들 수 없습니다 — 솔리드를 하나 이상 함께 고르세요'); return; }
  checkpoint();
  const t = solids[0];
  state.features.push({ id: state.nextFid++, type: 'group', target: t.id, solids: solids.slice(1).map(b => b.id), holes: holes.map(b => b.id) });
  selectOnly(t.id); persist(); regen();
}
function setHole(on) { const list = needSel(); if (!list) return; checkpoint(); for (const b of list) (state.props[b.id] ||= {}).hole = on; persist(); regen(); }
const baseZ = (type, f) => type === 'sphere' ? +f.r : type === 'torus' ? +f.r : 0;
function quickAdd(type, at, params, hole) {
  if (editing) cancelEdit(false);
  const f = { id: state.nextFid++, type, ...clone(DEFAULTS[type]), ...(params ? clone(params) : {}), op: 'new' };
  const sn = v => Math.round(v / view.snap) * view.snap, c = at || controls.target;
  f.x = +sn(c.x).toFixed(4); f.y = +sn(c.y).toFixed(4);
  f.z = +((at && at.z ? at.z : 0) + baseZ(type, f)).toFixed(4);
  checkpoint(); state.features.push(f);
  if (hole) (state.props['b' + f.id] ||= {}).hole = true;
  selectOnly('b' + f.id); persist(); regen();
}
// 규격을 먼저 정하고 화면을 클릭해 놓기
let placing = null;
const gGhost = new THREE.Group(); scene.add(gGhost);
function armPlace(type, extra) {
  if (editing) cancelEdit(false);
  measureOff();
  const f = { ...clone(DEFAULTS[type]), ...(extra || {}), op: 'new' };
  placing = { type, f, hole: false, pos: null };
  selectOnly(null); updateGhost(); rebuildScene(); renderPanel();
  flash('치수를 정한 뒤 화면에서 놓을 자리를 클릭하세요 (Esc 취소)');
}
function endPlace() { placing = null; disposeGroup(gGhost); renderPanel(); rebuildScene(); }
function updateGhost() {
  disposeGroup(gGhost); if (!placing) return draw();
  let g; try { g = toolGeom({ type: placing.type, ...placing.f, x: 0, y: 0, z: baseZ(placing.type, placing.f) }, D.getEnts()); } catch (err) { flash(err.message); return draw(); }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: placing.hole ? '#8d979f' : T.accent, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
  gGhost.add(m); if (placing.pos) gGhost.position.copy(placing.pos); gGhost.visible = !!placing.pos; draw();
}
function placeAt(e) {
  setNdc(e);
  const hit = ray.intersectObjects(bodyMeshes(), false)[0];
  const p = hit && hit.face && hit.face.normal.z > 0.7 ? hit.point.clone() : ray.ray.intersectPlane(new THREE.Plane(V3(0, 0, 1), 0), V3());
  if (!p) return null;
  const sn = v => Math.round(v / view.snap) * view.snap; p.x = sn(p.x); p.y = sn(p.y); p.z = Math.max(0, +p.z.toFixed(4));
  return p;
}
function pickImageFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try { const G = await imageToGrid(file); armPlace('relief', { grid: { w: G.w, h: G.h, d: G.d } }); flash(`이미지를 ${G.w}×${G.h} 칸으로 읽었습니다 — 폭·높이를 정하고 화면을 클릭하세요`); }
    catch (err) { flash(err.message); }
  };
  inp.click();
}
function measureOff() { if (measure.on) { measure.on = false; measure.pts = []; syncToolButtons(); rebuildMeasure(); } }
function flash(msg) { const el = $('#flash3d'); if (!el) return; el.textContent = msg; el.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => el.hidden = true, 2800); }
function syncToolButtons() { document.querySelectorAll('[data-cmd3d="measure"]').forEach(b => b.setAttribute('aria-pressed', measure.on)); document.querySelectorAll('[data-cmd3d="explode"]').forEach(b => b.setAttribute('aria-pressed', view.explode > 0)); }

function exportMesh(kind) {
  const list = bodies.filter(b => selBody ? b.id === selBody : !(state.props[b.id] && state.props[b.id].hidden));
  if (!list.length) { flash('내보낼 바디가 없습니다'); return; }
  const grp = new THREE.Group(); list.forEach(b => { const m = new THREE.Mesh(b.geom); m.name = b.name; grp.add(m); }); grp.updateMatrixWorld(true);
  const text = kind === 'stl' ? new STLExporter().parse(grp, { binary: false }) : new OBJExporter().parse(grp);
  const what = selBody ? `선택한 바디 (${list[0].name})` : `보이는 바디 ${list.length}개`;
  D.openText(`${kind.toUpperCase()} 내보내기`, `${what}를 mm 단위로 내보냈습니다. ${kind === 'stl' ? '3D 프린터 슬라이서(Cura, PrusaSlicer 등)에서 열 수 있습니다.' : 'Blender 등 3D 프로그램에서 열 수 있습니다.'}`, text, `draftline.${kind}`);
}

// ---------------------------------------------------------------- 분해도 · 구배 분석 · 간섭 검사
function explodeOffsets() {
  const out = new Map(); if (!(view.explode > 0)) return out;
  const vis = bodies.filter(b => !(state.props[b.id] && state.props[b.id].hidden)); if (vis.length < 2) return out;
  const all = new THREE.Box3(), cs = new Map();
  for (const b of vis) { b.geom.computeBoundingBox(); all.union(b.geom.boundingBox); cs.set(b.id, b.geom.boundingBox.getCenter(V3())); }
  const C = all.getCenter(V3()), k = view.explode * 1.2;
  for (const [id, c] of cs) out.set(id, c.sub(C).multiplyScalar(k));
  return out;
}
function animateExplode(to) {
  if (editing) { flash('먼저 편집 중인 피처를 확인하거나 취소하세요'); return; }
  const vis = bodies.filter(b => !(state.props[b.id] && state.props[b.id].hidden));
  if (to > 0 && vis.length < 2) { flash('분해도는 바디가 2개 이상일 때 쓸 수 있습니다'); return; }
  const from = view.explode, t0 = performance.now();
  const step = now => { const t = Math.min(1, (now - t0) / 450), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; view.explode = from + (to - from) * e; rebuildScene(); if (t < 1) requestAnimationFrame(step); else { syncToolButtons(); renderPanel(); } };
  requestAnimationFrame(step);
}
// 렌더링용 부드러운 법선: 같은 위치의 꼭짓점끼리, 면 각도가 35° 안이면 법선을 평균 (곡면은 매끈, 모서리는 날카롭게)
const smoothCache = new WeakMap();
function smoothGeom(g) {
  let nrm = smoothCache.get(g);
  if (!nrm) {
    const a = g.attributes.position.array, nt = a.length / 9, fn = new Float32Array(nt * 3), fw = new Float32Array(nt * 3), groups = new Map(), cosT = Math.cos(35 * DEG);
    const p = V3(), q = V3(), r = V3(), n = V3(), t = V3(), R4 = v => Math.round(v * 1e4);
    for (let f = 0; f < nt; f++) {
      const i = f * 9; p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
      n.subVectors(q, p).cross(t.subVectors(r, p)); fw[f * 3] = n.x; fw[f * 3 + 1] = n.y; fw[f * 3 + 2] = n.z; n.normalize(); fn[f * 3] = n.x; fn[f * 3 + 1] = n.y; fn[f * 3 + 2] = n.z;
      for (let k = 0; k < 3; k++) { const j = i + k * 3, key = R4(a[j]) + ',' + R4(a[j + 1]) + ',' + R4(a[j + 2]); let l = groups.get(key); if (!l) groups.set(key, l = []); l.push(f * 3 + k); }
    }
    nrm = new Float32Array(a.length);
    for (const l of groups.values()) for (const v of l) {
      const f = (v / 3) | 0; let x = 0, y = 0, z = 0;
      for (const u of l) { const h = (u / 3) | 0; if (fn[f * 3] * fn[h * 3] + fn[f * 3 + 1] * fn[h * 3 + 1] + fn[f * 3 + 2] * fn[h * 3 + 2] >= cosT) { x += fw[h * 3]; y += fw[h * 3 + 1]; z += fw[h * 3 + 2]; } }
      const L = Math.hypot(x, y, z) || 1; nrm[v * 3] = x / L; nrm[v * 3 + 1] = y / L; nrm[v * 3 + 2] = z / L;
    }
    smoothCache.set(g, nrm);
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', g.attributes.position); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}
function draftGeom(g) {
  const src = g.index ? g.toNonIndexed() : g, a = src.attributes.position.array, col = new Float32Array(a.length);
  const dir = { z: V3(0, 0, 1), '-z': V3(0, 0, -1), x: V3(1, 0, 0), '-x': V3(-1, 0, 0), y: V3(0, 1, 0), '-y': V3(0, -1, 0) }[view.draftDir] || V3(0, 0, 1);
  const th = Math.sin((+view.draftAng || 0) * DEG), G = new THREE.Color('#3fa34d'), Y = new THREE.Color('#e0b23a'), Rr = new THREE.Color('#d0453a');
  const p = V3(), q = V3(), r = V3(), n = V3(), t = V3();
  for (let i = 0; i < a.length; i += 9) {
    p.set(a[i], a[i + 1], a[i + 2]); q.set(a[i + 3], a[i + 4], a[i + 5]); r.set(a[i + 6], a[i + 7], a[i + 8]);
    n.subVectors(q, p).cross(t.subVectors(r, p)).normalize();
    const s = n.dot(dir), c = s >= th - 1e-9 ? G : s <= -th + 1e-9 && th > 0 ? Rr : Math.abs(s) < th ? Y : s > 0 ? G : Rr;
    for (let k = 0; k < 3; k++) { col[i + k * 3] = c.r; col[i + k * 3 + 1] = c.g; col[i + k * 3 + 2] = c.b; }
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', src.attributes.position); out.setAttribute('normal', src.attributes.normal || (src.computeVertexNormals(), src.attributes.normal)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const isHole = b => !!(state.props[b.id] && state.props[b.id].hole);
function runClash() {
  if (editing) { flash('먼저 편집 중인 피처를 확인하거나 취소하세요'); return; }
  const pool = (selSet.size >= 2 ? selected() : bodies).filter(b => !isHole(b) && !(state.props[b.id] && state.props[b.id].hidden));
  if (pool.length < 2) { flash('간섭 검사는 바디가 2개 이상 있어야 합니다'); return; }
  flash('간섭 검사 중…');
  setTimeout(() => {
    const pairs = [], geoms = {}; let skipped = 0;
    pool.forEach(b => { b.geom.computeBoundingBox(); geoms[b.id] = b.geom; });
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const A = pool[i], B = pool[j], bb = A.geom.boundingBox.clone().intersect(B.geom.boundingBox);
      if (bb.isEmpty()) continue; const s = bb.getSize(V3()); if (Math.min(s.x, s.y, s.z) < 1e-4) continue;
      try { const g = csg(A.geom, B.geom, 'intersect'); const V = triCount(g) ? massProps(g).V : 0, gs = triCount(g) ? g.boundingBox.getSize(V3()) : V3(); if (V > 1e-3 && Math.min(gs.x, gs.y, gs.z) > 10 * CSG_EPS) /* 맞닿기만 한 면은 간섭 아님 */ pairs.push({ a: A.id, b: B.id, an: A.name, bn: B.name, V, geom: g }); else g.dispose(); }
      catch (_) { skipped++; }
    }
    clash = { pairs, geoms, n: pool.length, skipped };
    flash(pairs.length ? `겹친 곳 ${pairs.length}군데를 찾았습니다` : '겹치는 바디가 없습니다');
    rebuildScene(); renderPanel();
  }, 30);
}

// ---------------------------------------------------------------- 큰 창 (도면 · 부품표 · 스크립트 · 이미지)
const xsheet = $('#xsheet');
function openSheet(title, body, acts = []) {
  $('#xsTitle').textContent = title; $('#xsBody').innerHTML = body;
  const box = $('#xsActs'); box.innerHTML = '';
  for (const [label, fn, primary] of acts) { const b = document.createElement('button'); b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; box.appendChild(b); }
  xsheet.hidden = false;
}
function closeSheet() { xsheet.hidden = true; $('#xsBody').innerHTML = ''; }
$('#xsClose').onclick = closeSheet;
xsheet.addEventListener('pointerdown', ev => { if (ev.target === xsheet) closeSheet(); });
function download(name, data, type) {
  if (!D.canDownload) { flash('이 화면에서는 파일 저장이 막혀 있습니다 — GitHub Pages 주소에서 열어 저장하세요'); return false; }
  const u = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); return true;
}
const matOf = b => MATERIALS.find(m => m[0] === (state.props[b.id] || {}).mat) || MATERIALS[0];
function bomRows() {
  const groups = new Map();
  for (const b of bodies) {
    if (isHole(b)) continue;
    const mp = massProps(b.geom), sz = mp.bb.getSize(V3()), mat = matOf(b);
    const k = [mat[0], Math.round(Math.abs(mp.V) * 10), ...[sz.x, sz.y, sz.z].map(v => Math.round(v * 100))].join('|');
    const g = groups.get(k); if (g) { g.qty++; g.names.push(b.name); continue; }
    groups.set(k, { name: b.name, names: [b.name], mat: mat[1], density: mat[2], V: Math.abs(mp.V), size: sz, qty: 1 });
  }
  return [...groups.values()].map((g, i) => ({ ...g, no: i + 1, mass1: g.V / 1000 * g.density }));
}
function openBOM() {
  const rows = bomRows(); if (!rows.length) { flash('부품표에 넣을 바디가 없습니다'); return; }
  let tq = 0, tm = 0, h = `<table class="xtable"><thead><tr><th>번호</th><th>부품명</th><th>재질</th><th>수량</th><th>크기 (mm)</th><th>부피 (cm³)</th><th>개당 질량 (g)</th><th>합계 (g)</th></tr></thead><tbody>`;
  for (const r of rows) { tq += r.qty; tm += r.mass1 * r.qty;
    h += `<tr><td class="n">${r.no}</td><td title="${esc(r.names.join(', '))}">${esc(r.name)}${r.qty > 1 ? ` <span class="muted">외 ${r.qty - 1}</span>` : ''}</td><td>${esc(r.mat)}</td><td class="n">${r.qty}</td><td class="n">${fmt(r.size.x)} × ${fmt(r.size.y)} × ${fmt(r.size.z)}</td><td class="n">${fmt(r.V / 1000)}</td><td class="n">${fmt(r.mass1)}</td><td class="n">${fmt(r.mass1 * r.qty)}</td></tr>`; }
  h += `</tbody><tfoot><tr><td></td><td>합계</td><td></td><td class="n">${tq}</td><td></td><td></td><td></td><td class="n">${fmt(tm)}</td></tr></tfoot></table>
    <p class="hint">구멍 바디는 빼고, 재질·부피·크기가 같은 바디는 한 줄로 묶어 수량을 셉니다. 재질은 바디를 고른 뒤 오른쪽 패널에서 바꿉니다.</p>`;
  const csv = () => '﻿번호,부품명,재질,수량,X,Y,Z,부피cm3,개당질량g,합계g\n' + rows.map(r => [r.no, `"${r.name.replace(/"/g, '""')}"`, r.mat, r.qty, fmt(r.size.x), fmt(r.size.y), fmt(r.size.z), fmt(r.V / 1000), fmt(r.mass1), fmt(r.mass1 * r.qty)].join(',')).join('\n');
  openSheet('부품표 (BOM)', h, [['CSV 복사·저장', () => { closeSheet(); D.openText('부품표 CSV', '엑셀이나 구글 시트에 붙여넣거나 .csv로 저장하세요.', csv(), 'draftline-bom.csv'); }]]);
}
let lastDrawing = null;
function openDrawing(opt) {
  if (editing) { flash('먼저 편집 중인 피처를 확인하거나 취소하세요'); return; }
  const list = bodies.filter(b => !isHole(b) && !(state.props[b.id] && state.props[b.id].hidden));
  if (!list.length) { flash('도면으로 만들 바디가 없습니다'); return; }
  const o = Object.assign({ hidden: true, iso: true }, lastDrawing && lastDrawing.opt, opt);
  flash('도면을 만드는 중…');
  setTimeout(() => {
    let d;
    try {
      const parts = bomRows().map(r => ({ no: r.no, name: r.name, mat: r.mat, qty: r.qty, mass: fmt(r.mass1) }));
      d = makeDrawing(list.map(b => ({ geom: b.geom, edges: edgeSegs(b.geom, 25) })), { title: list.length === 1 ? list[0].name : 'Draftline 조립품', parts, date: new Date().toISOString().slice(0, 10), hidden: o.hidden, iso: o.iso });
    } catch (err) { flash('도면을 만들지 못했습니다: ' + (err && err.message || err)); return; }
    lastDrawing = { opt: o, d };
    const body = `<div class="row" style="font-size:13px"><label><input type="checkbox" id="dwHid" ${o.hidden ? 'checked' : ''}> 숨은 선 (파선)</label><label><input type="checkbox" id="dwIso" ${o.iso ? 'checked' : ''}> 등각도</label><span class="muted">척도 ${d.scale} · A3 · 3각법 · 선 ${d.counts.vis + d.counts.hid}개</span></div><div class="drawing">${d.svg}</div>
      <p class="hint">보이는 바디(구멍 제외)를 정면(앞) · 평면(위) · 우측면에서 투상하고 전체 치수와 부품표를 넣었습니다. 모델을 고친 뒤 다시 [도면]을 누르면 새로 그립니다.</p>`;
    openSheet('2D 도면', body, [['SVG', () => { closeSheet(); D.openText('도면 SVG', '브라우저·일러스트레이터·잉크스케이프에서 열 수 있습니다. 실제 크기(mm)로 인쇄됩니다.', d.svg, 'draftline-drawing.svg'); }], ['DXF', () => { closeSheet(); D.openText('도면 DXF', 'AutoCAD R12 형식 (도면 종이 좌표, mm). 레이어: VISIBLE / HIDDEN / DIM / BORDER.', d.dxf, 'draftline-drawing.dxf'); }], ['인쇄', () => printSVG(d.svg), true]]);
    $('#dwHid').onchange = e => openDrawing({ hidden: e.target.checked });
    $('#dwIso').onchange = e => openDrawing({ iso: e.target.checked });
  }, 30);
}
function printSVG(svg) {
  const w = window.open('', '_blank');
  if (!w) { flash('새 창을 열 수 없습니다 — SVG로 저장해서 인쇄하세요'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Draftline 도면</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{width:420mm;height:297mm;display:block}</style>${svg}<script>onload=()=>setTimeout(()=>print(),200)<\/script>`); w.document.close();
}
function export3MF() {
  const list = bodies.filter(b => !isHole(b) && (selBody ? selSet.has(b.id) : !(state.props[b.id] && state.props[b.id].hidden)));
  if (!list.length) { flash('내보낼 바디가 없습니다'); return; }
  const data = make3MF(list.map(b => ({ name: b.name, geom: b.geom, color: bodyColor(b, bodies.indexOf(b)) })));
  if (download('draftline.3mf', new Blob([data], { type: 'model/3mf' }))) flash(`3MF로 바디 ${list.length}개를 저장했습니다 (색상 포함)`);
}
function exportPNG() {
  const k = Math.min(3, 2 * (window.devicePixelRatio || 1)) / renderer.getPixelRatio();
  const old = renderer.getPixelRatio(); gGizmo.visible = false;
  renderer.setPixelRatio(old * k); resize(); renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(old); gGizmo.visible = true; resize();
  openSheet('화면 이미지', `<img src="${url}" alt="모델 화면 이미지"><p class="hint">표시 방식을 <b>사실적 렌더링</b>으로 바꾸면 재질과 그림자가 들어간 이미지를 얻을 수 있습니다. 이미지를 오른쪽 클릭해 저장할 수도 있습니다.</p>`,
    [['PNG 저장', () => { fetch(url).then(r => r.blob()).then(b => download('draftline.png', b)); }, true]]);
}

// ---------------------------------------------------------------- 스크립트 (매크로)
const SCRIPT_KEY = KEY + '.script';
const SCRIPT_SAMPLE = `// 예제: 구멍 4개 받침판 + 기둥 — [실행]을 눌러 보세요
// 도형: cad.box / cylinder / sphere / cone / torus / wedge / pyramid / tube / hemisphere ({치수..., x, y, z, hole, color, mat, name})
const X0 = 200;                                   // 기존 모델 옆에 만듦
const plate = cad.box({ w: 80, d: 50, h: 6, x: X0, mat: 'al', name: '받침판' });
const holes = [[-32, -17], [32, -17], [-32, 17], [32, 17]].map(([x, y]) => cad.cylinder({ r: 3, h: 6, x: X0 + x, y, hole: true }));
cad.group([plate, ...holes]);                      // 솔리드는 합치고 구멍은 뺌
const post = cad.tube({ r: 8, r2: 5, h: 30, x: X0 - 20, z: 6, mat: 'steel', name: '기둥' });
cad.pattern(post, { kind: 'rect', nx: 2, dx: 40 });
log('바디', cad.bodies().length, '개', cad.bodies().map(b => b.name + ' ' + b.volume.toFixed(0) + 'mm³'));
`;
const SCRIPT_HELP = `cad.<도형>({...})  상자 box{w,d,h} 원통 cylinder{r,h} 구 sphere{r} 원뿔 cone{r1,r2,h} 토러스 torus{R,r}
                   쐐기 wedge{w,d,h} 피라미드 pyramid{w,h} 튜브 tube{r,r2,h} 반구 hemisphere{r}
                   + 공통 x, y, z, op:'new'|'join'|'cut'|'intersect', target, hole, color:'#hex', mat, name  → 바디 id
cad.extrude({ profiles:'all' 또는 ['1'], distance, plane:'XY'|'XZ'|'YZ', offset, dir:'one'|'sym', op })
cad.revolve({ profiles, axis:'X'|'Y'|선id, angle })
cad.boolean(대상, [도구...], 'cut'|'join'|'intersect')   cad.group([id...])   cad.move(id, {dx,dy,dz,rx,ry,rz})
cad.pattern(id, {kind:'rect', nx,dx, ny,dy} 또는 {kind:'circ', n, angle, cx, cy})   cad.mirror(id, {plane, offset, merge})
cad.shell(id, {t, dir})   cad.copy(id, {dx,dy,dz})   cad.remove(id)   cad.set(id, {name,color,mat,hole,hidden})
cad.bodies() → [{id,name,volume,area,min,max,size}]   cad.clear()   cad.feature({type, ...})
sketch.line(x1,y1,x2,y2) rect(x,y,w,h) circle(x,y,r) polyline([[x,y],...], closed) arc(cx,cy,r,시작°,끝°) clear()
log(...)  재질 mat: ${MATERIALS.map(m => m[0]).join(' ')}`;
function scriptAPI(logf) {
  let stale = false;
  const sync = () => { if (stale) { stale = false; regen(); } };
  const push = f => { const nf = { ...clone(DEFAULTS[f.type] || {}), ...f, id: state.nextFid++ }; state.features.push(nf); stale = true; return nf; };
  const props = (id, p) => { if (!p) return; const o = (state.props[id] ||= {}); for (const k of ['name', 'color', 'mat', 'hole', 'hidden']) if (p[k] !== undefined) o[k] = p[k]; stale = true; };
  const NUMS = new Set(['w', 'd', 'h', 'r', 'r1', 'r2', 'R', 'x', 'y', 'z']);
  const prim = type => (p = {}) => {
    const f = { type, op: p.op || 'new', target: p.target || '' };
    for (const [k, v] of Object.entries(p)) if (NUMS.has(k)) { if (!isFinite(+v)) throw new Error(`${type}.${k} 값이 숫자가 아닙니다`); f[k] = +v; }
    const nf = push(f); const id = 'b' + nf.id;
    if (f.op === 'new') { props(id, p); return id; }
    return f.target || null;
  };
  const cad = {
    feature: f => { if (!f || !DEFAULTS[f.type] || f.type === 'place') throw new Error('알 수 없는 피처 종류: ' + (f && f.type)); return 'b' + push(clone(f)).id; },
    extrude(p = {}) {
      sync(); let keys = p.profiles;
      if (!keys || keys === 'all') keys = regions.filter(r => !r.parentKey).map(r => r.key);
      if (!keys.length) throw new Error('스케치에 닫힌 도형이 없습니다');
      const nf = push({ type: 'extrude', ...p, profiles: keys.map(String) }); props('b' + nf.id, p); return 'b' + nf.id;
    },
    revolve(p = {}) { sync(); let keys = p.profiles; if (!keys || keys === 'all') keys = regions.filter(r => !r.parentKey).map(r => r.key); const nf = push({ type: 'revolve', ...p, profiles: keys.map(String) }); props('b' + nf.id, p); return 'b' + nf.id; },
    boolean(target, tools, op = 'cut', keep = false) { push({ type: 'boolean', target, tools: [].concat(tools), op, keep }); return target; },
    group(ids) {
      sync(); const list = [].concat(ids).map(findBody).filter(Boolean), sol = list.filter(b => !isHole(b)), hol = list.filter(isHole);
      if (!sol.length) throw new Error('그룹에는 솔리드가 하나 이상 있어야 합니다');
      push({ type: 'group', target: sol[0].id, solids: sol.slice(1).map(b => b.id), holes: hol.map(b => b.id) }); return sol[0].id;
    },
    move(id, p = {}) { push({ type: 'move', body: id, ...p }); return id; },
    pattern(id, p = {}) { push({ type: 'pattern', body: id, ...p }); return id; },
    mirror(id, p = {}) { push({ type: 'mirror', body: id, ...p }); return id; },
    shell(id, p = {}) { push({ type: 'shell', body: id, ...p }); return id; },
    copy(id, p = {}) { const nf = push({ type: 'copy', body: id, ...p }); return 'b' + nf.id; },
    remove(id) { push({ type: 'remove', body: id }); },
    set(id, p) { props(id, p); return id; },
    bodies() { sync(); return bodies.map(b => { const mp = massProps(b.geom), bb = mp.bb; return { id: b.id, name: b.name, volume: Math.abs(mp.V), area: mp.A, min: bb.min.toArray(), max: bb.max.toArray(), size: bb.getSize(V3()).toArray(), hole: isHole(b) }; }); },
    clear() { state.features = []; state.props = {}; stale = true; },
  };
  for (const t of PRIMS) if (t !== 'relief') cad[t] = prim(t);
  const sk = list => { const ids = D.addEnts(list); stale = true; return ids.length === 1 ? ids[0] : ids; };
  const P = (x, y) => ({ x: +x, y: +y });
  const sketch = {
    line: (x1, y1, x2, y2) => sk([{ type: 'line', a: P(x1, y1), b: P(x2, y2) }]),
    rect: (x, y, w, h) => sk([{ type: 'rect', a: P(x, y), b: P(+x + +w, +y + +h) }]),
    circle: (x, y, r) => sk([{ type: 'circle', c: P(x, y), r: +r }]),
    polyline: (pts, closed = false) => sk([{ type: 'pline', pts: pts.map(([x, y]) => P(x, y)), closed }]),
    arc: (cx, cy, r, a0, a1) => sk([{ type: 'arc', c: P(cx, cy), r: +r, a0: a0 * DEG, a1: a1 * DEG }]),
    clear: () => { D.clearEnts(); stale = true; },
  };
  return { cad, sketch, log: logf, done: () => sync() };
}
function openScript() {
  let code = SCRIPT_SAMPLE; try { code = localStorage.getItem(SCRIPT_KEY) || SCRIPT_SAMPLE; } catch (_) {}
  openSheet('스크립트 (매크로)', `<textarea id="scCode" spellcheck="false" aria-label="스크립트">${esc(code)}</textarea><pre id="scOut">실행 결과가 여기에 나옵니다. 실행한 내용은 Ctrl+Z 한 번으로 되돌릴 수 있습니다.</pre><details><summary class="hint" style="cursor:pointer">명령 목록</summary><pre>${esc(SCRIPT_HELP)}</pre></details>`,
    [['예제로', () => { $('#scCode').value = SCRIPT_SAMPLE; }], ['실행 (Ctrl+Enter)', runScript, true]]);
  const ta = $('#scCode');
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runScript(); }
    else if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
    e.stopPropagation();
  });
}
function runScript() {
  const code = $('#scCode').value, out = $('#scOut'), lines = [];
  try { localStorage.setItem(SCRIPT_KEY, code); } catch (_) {}
  if (editing) cancelEdit(false); if (placing) endPlace();
  const snap = JSON.stringify(state); checkpoint();
  const show = v => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch (_) { return String(v); } })();
  const api = scriptAPI((...a) => lines.push(a.map(show).join(' ')));
  const t0 = performance.now();
  try {
    new Function('cad', 'sketch', 'log', 'Math', '"use strict";\n' + code)(api.cad, api.sketch, api.log, Math);
    api.done(); persist(); regen();
    const errs = Object.entries(errors).map(([fid, m]) => `피처 ${fid}: ${m}`);
    out.className = errs.length ? 'err' : '';
    out.textContent = [...lines, `— 완료 (${Math.round(performance.now() - t0)} ms) · 바디 ${bodies.length}개 · 피처 ${state.features.length}개`, ...errs].join('\n');
  } catch (err) {
    state = JSON.parse(snap); undoS.pop(); persist(); regen();
    out.className = 'err'; out.textContent = [...lines, '오류: ' + (err && err.message || err), '모델은 실행 전 상태로 되돌렸습니다.'].join('\n');
  }
}

// ---------------------------------------------------------------- 이벤트
panel.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'vExp') { view.explode = +t.value; const l = t.previousElementSibling; if (l) l.textContent = `분해도 ${Math.round(view.explode * 100)}% (X)`; syncToolButtons(); rebuildScene(); return; }
  if (t.id === 'vSecPos') { view.secPos = +t.value; t.nextElementSibling && (t.nextElementSibling.textContent = `단면 위치 ${fmt(view.secPos)} mm`); rebuildScene(); return; }
  if (placing && t.dataset.pf && t.type !== 'checkbox') { if (isFinite(+t.value) && t.value !== '') { placing.f[t.dataset.pf] = +t.value; clearTimeout(panel._g); panel._g = setTimeout(updateGhost, 120); } return; }
  if (editing && t.dataset.mv) { const [id, i] = t.dataset.mv.split(':'); const v = +t.value; if (isFinite(v)) { const arr = editing.feat.moves[id]; arr[(arr.length === 16 ? 12 : 0) + +i] = v; clearTimeout(panel._t); panel._t = setTimeout(regen, 160); } return; }
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
      if (t.dataset.k === 'body' && editing.feat.edges) editing.feat.edges = [];
      if (t.dataset.k === 'body' && editing.feat.faces) editing.feat.faces = [];
      regen(); if (t.dataset.rerender || t.dataset.k === 'target') renderDialog(); return;
    }
    return;
  }
  const b = selBody && findBody(selBody);
  if (t.id === 'bName' && b) { const name = t.value.trim(); if (name) { checkpoint(); (state.props[b.id] ||= {}).name = name; persist(); regen(); } return; }
  if (t.id === 'bMat' && b) { (state.props[b.id] ||= {}).mat = t.value; persist(); renderPanel(); return; }
  if (t.id === 'vDisp') { view.display = t.value; persist(); rebuildScene(); renderPanel(); return; }
  if (t.id === 'vSnap') { view.snap = +t.value || 1; persist(); return; }
  if (t.id === 'vDDir') { view.draftDir = t.value; persist(); rebuildScene(); return; }
  if (t.id === 'vDAng') { const v = +t.value; if (isFinite(v) && v >= 0 && v < 90) { view.draftAng = v; persist(); rebuildScene(); renderPanel(); } return; }
  if (placing && t.dataset.pf) {
    if (t.dataset.pf === '__hole') placing.hole = t.checked; else if (t.type === 'checkbox') placing.f[t.dataset.pf] = t.checked; else if (isFinite(+t.value)) placing.f[t.dataset.pf] = +t.value;
    updateGhost(); return;
  }
  if (t.dataset.qf) {
    const f = state.features.find(x => x.id === +t.dataset.qid), v = +t.value;
    if (!f || !isFinite(v)) { renderPanel(); return; }
    checkpoint(); f[t.dataset.qf] = v; persist(); regen(); return;
  }
  if (t.id === 'vSec') { view.section = t.value !== 'off'; if (view.section) { view.secAxis = t.value; const bx = sceneBox(); view.secPos = +((bx.min[t.value] + bx.max[t.value]) / 2).toFixed(1); } rebuildScene(); renderPanel(); return; }
});
panel.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && !editing && ev.target.dataset && ev.target.dataset.qf) { ev.target.blur(); return; } if (ev.key === 'Enter' && editing && ev.target.tagName === 'INPUT') { ev.preventDefault(); clearTimeout(panel._t); regen(); commitEdit(); } });
panel.addEventListener('click', ev => {
  const t = ev.target.closest('button, .brow'); if (!t) return;
  if (t.id === 'dlgOk') { clearTimeout(panel._t); regen(); commitEdit(); return; }
  if (t.id === 'dlgCancel') { cancelEdit(); return; }
  if (t.id === 'dlgDel') { deleteFeature(); return; }
  if (t.dataset.cmd) { command(t.dataset.cmd); return; }
  if (t.dataset.shape) {
    if (t.dataset.shape === 'relief') { pickImageFile(); return; }
    armPlace(t.dataset.shape); return;
  }
  if (t.id === 'placeCancel') { endPlace(); return; }
  if (t.id === 'clashOff') { clash = null; rebuildScene(); renderPanel(); return; }
  if (t.dataset.clash) { const p = clash && clash.pairs[+t.dataset.clash]; if (p) { selSet = new Set([p.a, p.b]); selBody = p.b; rebuildScene(); renderPanel(); } return; }
  if (t.dataset.align) { const [ax, w] = t.dataset.align.split(':'); alignSel(ax, w); return; }
  if (t.dataset.hole) { setHole(t.dataset.hole === '1'); return; }
  if (t.dataset.editf) { editFeature(+t.dataset.editf); return; }
  if (t.id === 'edgeClear' && editing) { editing.feat.edges = []; regen(); return; }
  if (t.id === 'faceClear' && editing) { editing.feat.faces = []; regen(); return; }
  if (t.dataset.eye) {
    if (t.dataset.eye === 'sketch') view.sketch = !view.sketch;
    else { const p = (state.props[t.dataset.eye] ||= {}); p.hidden = !p.hidden; }
    persist(); rebuildScene(); renderPanel(); return;
  }
  if (t.dataset.bcolor && selBody) { (state.props[selBody] ||= {}).color = t.dataset.bcolor; persist(); rebuildScene(); renderPanel(); return; }
  if (t.dataset.bid) { if (ev.shiftKey) toggleSel(t.dataset.bid); else if (selSet.size === 1 && selBody === t.dataset.bid) selectOnly(null); else selectOnly(t.dataset.bid); rebuildScene(); renderPanel(); }
});
panel.addEventListener('dragstart', ev => { const s = ev.target.closest && ev.target.closest('[data-shape]'); if (s) { ev.dataTransfer.setData('text/plain', 'shape:' + s.dataset.shape); ev.dataTransfer.effectAllowed = 'copy'; } });
host.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
host.addEventListener('drop', ev => {
  ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (!d.startsWith('shape:')) return;
  const type = d.slice(6); if (!DEFAULTS[type]) return;
  const r = renderer.domElement.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = ray.ray.intersectPlane(new THREE.Plane(V3(0, 0, 1), 0), V3()); quickAdd(type, p || null);
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
    case '3mf': return export3MF();
    case 'png': return exportPNG();
    case 'drawing': return openDrawing();
    case 'clash': return runClash();
    case 'explode': return animateExplode(view.explode > 0 ? 0 : 1);
    case 'bom': return openBOM();
    case 'script': return openScript();
    case 'delete': return deleteBody();
    case 'group': return groupSel();
    case 'dup': return duplicateSel();
    case 'drop': return dropToPlane();
  }
}

// 클릭으로 프로파일 / 바디 / 측정점 고르기 (끌기는 화면 회전)
const ray = new THREE.Raycaster(), ndc = V2(0, 0);
let down = null;
const setNdc = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); };
const bodyMeshes = () => gBodies.children.filter(o => o.userData.bid);
renderer.domElement.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY };
  if (e.button !== 0 || editing || measure.on || placing) return;
  setNdc(e);
  // 겹치면 크기 손잡이를 회전 고리보다 먼저 잡음
  const ghs = gGizmo.visible ? ray.intersectObjects(gGizmo.children.filter(o => o.userData.handle), false) : [];
  const gh = ghs.find(h => h.object.userData.handle.kind === 'size') || ghs[0] || null;
  if (gh && gizmoStart(e, gh)) { down.gizmo = true; return; }
  if (e.shiftKey) return;
  const hit = ray.intersectObjects(bodyMeshes(), false).filter(h => !view.section || clipPlane.distanceToPoint(h.point) >= -1e-6)[0];
  if (!hit) return;
  // 바디를 잡으면 화면 회전 대신 바닥과 나란한 평면 위에서 옮김
  down.drag = { bid: hit.object.userData.bid, plane: new THREE.Plane(V3(0, 0, 1), -hit.point.z), start: hit.point.clone(), moved: false, d: V3() };
  controls.enabled = false;
});
renderer.domElement.addEventListener('pointermove', e => {
  if (gizmoDrag) { gizmoMove(e); return; }
  if (placing) { const p = placeAt(e); if (p) { placing.pos = p; gGhost.position.copy(p); gGhost.visible = true; draw(); } return; }
  const g = down && down.drag; if (!g) return;
  if (!g.moved) {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) return;
    g.moved = true; if (!selSet.has(g.bid)) { selectOnly(g.bid); rebuildScene(); renderPanel(); }
  }
  setNdc(e); const p = ray.ray.intersectPlane(g.plane, V3()); if (!p) return;
  const sn = v => Math.round(v / view.snap) * view.snap;
  g.d.set(sn(p.x - g.start.x), sn(p.y - g.start.y), 0);
  for (const o of gBodies.children) if (selSet.has(o.userData.bid) || selSet.has(o.userData.bidE)) o.position.copy(o.userData.ex || V3()).add(g.d);
  flash(`이동 X ${fmt(g.d.x)} · Y ${fmt(g.d.y)} mm`); draw();
});
renderer.domElement.addEventListener('pointerup', e => {
  if (gizmoDrag) { down = null; gizmoEnd(); return; }
  if (placing && down && e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) {
    down = null; const p = placeAt(e); if (!p) return; const pl = placing; placing = null; disposeGroup(gGhost); quickAdd(pl.type, p, pl.f, pl.hole); return;
  }
  const g = down && down.drag; controls.enabled = true;
  if (g && g.moved) { down = null; const m = {}; for (const id of selSet) m[id] = [g.d.x, g.d.y, 0]; if (g.d.lengthSq() > 0) addPlace(m); else rebuildScene(); return; }
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) { down = null; return; }
  down = null;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (editing && pickMesh && editing.feat.type === 'shell') {
    const hit = ray.intersectObject(pickMesh, false)[0]; if (!hit) return;
    const n = hit.face.normal.clone().normalize(), p = hit.point, sc = geomScale(pickGeom), tp = Math.max(0.01, sc * 1e-4);
    const at = editing.feat.faces.findIndex(fc => { const o = faceOf(fc); return o.n.dot(n) > 0.9999 && Math.abs(o.n.dot(V3().subVectors(p, o.p))) < tp; });
    if (at >= 0) editing.feat.faces.splice(at, 1);
    else {
      const patch = facePatch(pickGeom, [p.x, p.y, p.z, n.x, n.y, n.z], sc);
      let area = 0; for (let i = 0; i < patch.length; i += 9) area += new THREE.Triangle(V3(...patch.slice(i, i + 3)), V3(...patch.slice(i + 3, i + 6)), V3(...patch.slice(i + 6, i + 9))).getArea();
      if (area < massProps(pickGeom).A * 0.015) { flash('곡면이나 너무 작은 면은 열 수 없습니다 — 평평한 면을 고르세요'); return; }
      editing.feat.faces.push([p.x, p.y, p.z, n.x, n.y, n.z].map(v => +v.toFixed(5)));
    }
    regen(); return;
  }
  if (editing && pickLines && (editing.feat.type === 'fillet3d' || editing.feat.type === 'chamfer3d')) {
    ray.params.Line.threshold = camera.position.distanceTo(controls.target) * 0.012;
    const hit = ray.intersectObject(pickLines, false)[0]; if (!hit) return;
    const arr = pickLines.geometry.attributes.position.array, i = hit.index * 3;
    const m = [(arr[i] + arr[i + 3]) / 2, (arr[i + 1] + arr[i + 4]) / 2, (arr[i + 2] + arr[i + 5]) / 2];
    let ed;
    try { ed = resolveEdge(pickGeom, pickSegs, m, geomScale(pickGeom)); } catch (err) { flash(err.message); return; }
    if (!ed) return;
    const at = draftEdges.findIndex(d => d.key === ed.key);
    if (at >= 0) editing.feat.edges.splice(at, 1); else editing.feat.edges.push(m);
    regen(); return;
  }
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
  const id = hits.length ? hits[0].object.userData.bid : null;
  if (e.shiftKey && id) toggleSel(id); else selectOnly(id);
  rebuildScene(); renderPanel();
});
addEventListener('keydown', e => {
  if (document.body.dataset.workspace !== '3d' || !$('#modal').hidden) return;
  if (!$('#xsheet').hidden) { if (e.key === 'Escape') closeSheet(); return; }
  if (e.target.matches && e.target.matches('input,textarea,select')) { if (e.key === 'Escape' && editing) { cancelEdit(); } return; }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && !editing && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && !editing && k === 'g') { e.preventDefault(); groupSel(); return; }
  if (mod && !editing && k === 'a') { e.preventDefault(); selSet = new Set(bodies.map(b => b.id)); selBody = bodies.length ? bodies[bodies.length - 1].id : null; rebuildScene(); renderPanel(); return; }
  if (!editing && selSet.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
    e.preventDefault(); const st = view.snap * (e.shiftKey ? 10 : 1);
    const z = e.key === 'PageUp' || (mod && e.key === 'ArrowUp') ? st : e.key === 'PageDown' || (mod && e.key === 'ArrowDown') ? -st : 0;
    if (z) nudge(0, 0, z); else nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? st : e.key === 'ArrowDown' ? -st : 0, 0);
    return;
  }
  if (mod) return;
  if (e.key === 'Escape' && placing) { endPlace(); return; }
  if (e.key === 'Escape') { if (editing) cancelEdit(); else if (measure.on) { measureOff(); renderPanel(); } else if (selSet.size) { selectOnly(null); rebuildScene(); renderPanel(); } return; }
  if (e.key === 'Enter' && editing) { commitEdit(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) { e.preventDefault(); deleteBody(); return; }
  if (k === 'd' && !editing) { dropToPlane(); return; }
  if (k === 'h' && !editing) { const l = selected(); if (l.length) setHole(!l.every(b => state.props[b.id] && state.props[b.id].hole)); else flash('바디를 먼저 클릭해서 고르세요'); return; }
  if (k === 'e') startFeature('extrude');
  else if (k === 'f') setView();
  else if (k === 'm') command('measure');
  else if (k === 'x' && !editing) command('explode');
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
  extrudeFrom(ids) {
    if (editing) cancelEdit(false); if (placing) endPlace();
    regen();
    const set = new Set(ids);
    let chosen = ids.length ? regions.filter(r => r.key.split(',').every(k => set.has(+k))) : regions.filter(r => !r.parentKey);
    chosen = chosen.filter(r => !chosen.some(o => o.key === r.parentKey));
    if (!chosen.length) { flash(ids.length ? '고른 것 중 닫힌 도형이 없습니다 — 사각형·원·닫힌 폴리선(또는 끝이 이어진 선)을 고르세요' : '스케치에 닫힌 도형이 없습니다'); return; }
    startFeature('extrude'); editing.feat.profiles = chosen.map(r => r.key); regen(); renderDialog();
    flash(`프로파일 ${chosen.length}개로 돌출합니다 — 거리를 정하고 확인을 누르세요`);
  },
  refImageChanged() { rebuildScene(); },
  _handles() { const r = renderer.domElement.getBoundingClientRect(); gGizmo.updateMatrixWorld(true); camera.updateMatrixWorld();
    return gGizmo.children.filter(o => o.userData.handle).map(o => { const w = o.userData.handle.kind === 'rot' ? V3(o.geometry.parameters.radius, 0, 0).applyMatrix4(o.matrixWorld) : o.getWorldPosition(V3()); const q = w.project(camera);
      return { ...o.userData.handle, x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; }); },
  _start: startFeature, _set(k, v) { if (editing) { editing.feat[k] = v; regen(); } }, _commit: commitEdit,
};

// ---------------------------------------------------------------- 시작
load(); readTheme(); resize(); regen(); setView(VIEWS.iso);
