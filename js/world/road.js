// Builds the road + ground for one 150 m chunk as a single vertex-coloured mesh.
import * as THREE from 'three';
import { VC_MAT, Builder } from '../util.js';
import { STEP, ROAD_HALF } from './route.js';

export const CHUNK = 75; // samples per chunk (150 m)
const OFFS = [-420, -160, -70, -32, -16, -8.2, -5.6, -ROAD_HALF, ROAD_HALF, 5.6, 8.2, 16, 32, 70, 160, 420];

const C = (h) => new THREE.Color(h);
const ASPHALT = C('#4b4d50'), ASPHALT2 = C('#55575a'), SIDEWALK = C('#a9a49a'), URBAN = C('#8c8576'),
  WHITE = C('#e8e8e2'), YELLOW = C('#e8c22a'), ROCK = C('#7d6e5d'), ROCK2 = C('#6a5c4c'), INDUS = C('#8a8478');
const tmp = new THREE.Color();

export function buildRoadChunk(route, c) {
  const n = route.n;
  const i0 = c * CHUNK, i1 = Math.min(n - 1, i0 + CHUNK);
  if (i0 >= n - 1) return null;
  const P = [], N = [], Col = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), nn = new THREE.Vector3();
  const tri = (p0, p1, p2, col) => {
    a.subVectors(p1, p0); b.subVectors(p2, p0); nn.crossVectors(a, b).normalize();
    if (nn.y < 0) nn.negate();
    for (const p of [p0, p1, p2]) { P.push(p.x, p.y, p.z); N.push(nn.x, nn.y, nn.z); Col.push(col.r, col.g, col.b); }
  };
  const quad = (p00, p01, p10, p11, col) => { tri(p00, p10, p11, col); tri(p00, p11, p01, col); };

  // per-sample clamp of offsets on the inside of curves
  const clampD = (i, d) => {
    let kin = 0;
    for (let j = -24; j <= 24; j += 3) {
      const q = Math.min(n - 1, Math.max(0, i + j));
      const k = route.k[q];
      if (Math.sign(k) === Math.sign(d)) kin = Math.max(kin, Math.abs(k));
    }
    if (kin > 0) { const m = Math.max(9, 0.8 / kin); return Math.sign(d) * Math.min(Math.abs(d), m); }
    return d;
  };
  const pt = (i, d) => {
    const v = new THREE.Vector3();
    const h = route.h[i];
    const dd = Math.abs(d) > 9 ? clampD(i, d) : d;
    v.set(route.x[i] + Math.cos(h) * dd, route.y[i] + route.sideH(i, dd), route.z[i] - Math.sin(h) * dd);
    return v;
  };

  // cross-section columns for each sample
  const cols = [];
  for (let i = i0; i <= i1; i++) cols.push(OFFS.map((d) => pt(i, d)));

  for (let i = i0; i < i1; i++) {
    const r0 = cols[i - i0], r1 = cols[i - i0 + 1];
    const zone = route.zones[route.zi[i]];
    const th = route.themeAt(i * STEP);
    const city = zone.type === 'city', ind = zone.type === 'industrial';
    const hill = route.hillAmt[i] > 0.05, hs = route.hillSide[i];
    for (let j = 0; j < OFFS.length - 1; j++) {
      const d0 = OFFS[j], d1 = OFFS[j + 1];
      const mid = (d0 + d1) / 2, ad = Math.abs(mid);
      let col;
      if (ad < ROAD_HALF) col = ((i >> 2) % 3 === 0) ? ASPHALT2 : ASPHALT;
      else if (ad < 5.6) col = tmp.set(city ? '#7a7670' : th.shoulder).clone();
      else if (ad < 8.2 && city) col = SIDEWALK;
      else if (hill && Math.sign(mid) === hs) col = ad < 33 ? (j % 2 ? ROCK : ROCK2) : tmp.set(th.mountain).clone();
      else if (city) col = URBAN;
      else if (ind && ad < 70) col = INDUS;
      else {
        col = tmp.set(th.ground).clone();
        if (hill) col.multiplyScalar(0.85);
      }
      quad(r0[j], r0[j + 1], r1[j], r1[j + 1], col);
    }
  }

  // lane markings
  const mb = [];
  const strip = (i, d0, d1, col, lift = 0.03) => {
    const p00 = pt(i, d0), p01 = pt(i, d1), p10 = pt(i + 1, d0), p11 = pt(i + 1, d1);
    for (const p of [p00, p01, p10, p11]) p.y += lift;
    quad(p00, p01, p10, p11, col);
  };
  for (let i = i0; i < i1; i++) {
    const s = i * STEP;
    const noPass = route.hillAmt[i] > 0.05 || Math.abs(route.k[i]) > 1 / 150;
    if (noPass) { strip(i, -0.2, -0.08, YELLOW); strip(i, 0.08, 0.2, YELLOW); }
    else if (Math.floor(s / 6) % 2 === 0) strip(i, -0.08, 0.08, WHITE);
    strip(i, ROAD_HALF - 0.22, ROAD_HALF - 0.1, WHITE);
    strip(i, -ROAD_HALF + 0.1, -ROAD_HALF + 0.22, WHITE);
  }
  // junctions: zebra crossings, stop lines and side roads
  for (const jn of route.junctions) {
    const ji = Math.round(jn.s / STEP);
    if (ji < i0 - 6 || ji > i1 + 6) continue;
    for (let k = -4; k <= 4; k++) {
      const i = ji + k;
      if (i < i0 || i >= i1) continue;
      // side road surface
      strip(i, ROAD_HALF, 45, ASPHALT, 0.2);
      strip(i, -45, -ROAD_HALF, ASPHALT, 0.2);
    }
    for (const sgn of [-1, 1]) {
      const zi = ji + sgn * 6;
      if (zi >= i0 && zi < i1) for (let z = -3.2; z < 3.2; z += 0.9) strip(zi, z, z + 0.45, WHITE, 0.04);
      const si = ji - sgn * 5;
      if (si >= i0 && si < i1) {
        if (sgn > 0) strip(si, 0.1, ROAD_HALF, WHITE, 0.04); else strip(si, -ROAD_HALF, -0.1, WHITE, 0.04);
      }
    }
  }
  // parking bay & depot yard paint at destination
  if (route.bayS / STEP > i0 - 30 && route.bayS / STEP < i1 + 30) {
    for (let i = i0; i < i1; i++) {
      const s = i * STEP;
      if (Math.abs(s - route.bayS) < 40) strip(i, ROAD_HALF + 0.01, 30, tmp.set('#9e9a92').clone(), 0.05);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, VC_MAT);

  // crash barriers on the valley side in hills
  const bb = new Builder();
  for (let i = i0; i < i1; i += 2) {
    if (route.hillAmt[i] < 0.6) continue;
    const d = -route.hillSide[i] * 6.6;
    const p = route.pos(i * STEP + 2, d);
    bb.box(0.1, 0.35, 4.05, p.x, p.y + 0.65, p.z, '#d9d9d9', 0, p.h, 0);
    bb.box(0.12, 0.08, 4.05, p.x, p.y + 0.86, p.z, '#c62828', 0, p.h, 0);
    bb.box(0.12, 0.75, 0.12, p.x, p.y + 0.37, p.z, '#8a8a8a', 0, p.h, 0);
  }
  if (!bb.empty) mesh.add(bb.mesh());
  return mesh;
}
