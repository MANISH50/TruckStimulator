// Streams the world around the truck: road chunks, instanced scenery
// (trees, buildings, fields...), stops, signals, signs and colliders.
import * as THREE from 'three';
import { Builder, VC_MAT, rng, canvasTexture, clamp } from '../util.js';
import { STEP, ROAD_HALF } from './route.js';
import { buildRoadChunk, CHUNK } from './road.js';
import { propGeo, pumpStationGeo, dhabaGeo, signalGeo, gateGeo } from './models.js';
import { STATES } from '../data/cities.js';

const CHUNK_LEN = CHUNK * STEP;
const PROTOS = ['tree_round', 'tree_mango', 'tree_neem', 'tree_teak', 'tree_khejri', 'tree_palm', 'tree_banana', 'tree_bamboo', 'tree_avenue',
  'bush', 'rock', 'dune', 'mountain', 'field', 'building', 'shop', 'hut', 'factory', 'warehouse', 'tank', 'pole', 'epole', 'kmstone', 'cow', 'temple'];
const CAP = { mountain: 80, field: 500, building: 400, tree_palm: 500, tree_round: 500 };

let protoGeos = null;
function getProtoGeos() {
  if (protoGeos) return protoGeos;
  protoGeos = {};
  for (const p of PROTOS) {
    if (p === 'tree_avenue') {
      const b = new Builder();
      b.cyl(0.2, 0.26, 2.4, 6, 0, 1.2, 0, '#6b4a2b');
      b.cyl(0.27, 0.27, 0.5, 6, 0, 0.35, 0, '#f2f2f2');
      b.cyl(0.27, 0.27, 0.25, 6, 0, 0.72, 0, '#c62828');
      b.sphere(1.9, 0, 3.6, 0, '#4f8a2e', 1.1, 0.8, 1.1);
      protoGeos[p] = b.build();
    } else protoGeos[p] = propGeo(p);
  }
  return protoGeos;
}

// shared materials for signal lamps
const LAMP = {
  redOn: new THREE.MeshBasicMaterial({ color: '#ff2a1a' }), redOff: new THREE.MeshLambertMaterial({ color: '#3a0e0a' }),
  yelOn: new THREE.MeshBasicMaterial({ color: '#ffc21a' }), yelOff: new THREE.MeshLambertMaterial({ color: '#3a300a' }),
  grnOn: new THREE.MeshBasicMaterial({ color: '#2aff5a' }), grnOff: new THREE.MeshLambertMaterial({ color: '#0a3a14' }),
};
const lampGeo = new THREE.SphereGeometry(0.15, 8, 6);

const texCache = new Map();
function signTexture(kind, text, dir) {
  const key = kind + '|' + (text ? text.join('|') : '') + '|' + (dir || '');
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTexture(256, 128, (g, w, h) => {
    if (kind === 'turn') {
      g.fillStyle = '#00000000'; g.clearRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(128, 6); g.lineTo(250, 122); g.lineTo(6, 122); g.closePath(); g.fill();
      g.strokeStyle = '#d00'; g.lineWidth = 12; g.stroke();
      g.strokeStyle = '#111'; g.lineWidth = 10; g.beginPath();
      const sx = dir > 0 ? 1 : -1; // + = left turn
      g.moveTo(128 + sx * 10, 110); g.lineTo(128 + sx * 10, 70); g.quadraticCurveTo(128 + sx * 10, 45, 128 - sx * 25, 45); g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(128 - sx * 45, 45); g.lineTo(128 - sx * 22, 30); g.lineTo(128 - sx * 22, 60); g.fill();
      return;
    }
    const bg = kind === 'board' ? '#0b7a3a' : kind === 'city' ? '#7a1f2b' : kind === 'gate' ? '#f2a516' : '#1450a0';
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = kind === 'gate' ? '#5a1010' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (s, size, y) => { let f = size; do { g.font = 'bold ' + f + 'px sans-serif'; f -= 2; } while (g.measureText(s).width > w - 28 && f > 10); g.fillText(s, w / 2, y); };
    fit(text[0], 30, h * 0.38);
    if (text[1]) fit(text[1], 22, h * 0.72);
  });
  texCache.set(key, t);
  return t;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _p = {};

export class World {
  constructor(scene, route) {
    this.scene = scene;
    this.route = route;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.chunks = new Map();
    this.inst = {};
    const geos = getProtoGeos();
    for (const p of PROTOS) {
      const cap = CAP[p] || 260;
      const im = new THREE.InstancedMesh(geos[p], VC_MAT, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.root.add(im);
      this.inst[p] = im;
    }
    this.signals = [];
    this.dirty = true;
    this.ahead = 520; this.behind = 140;
    this.bayArrow = null;
    this.lampPositions = []; this.lampVersion = 0;
  }

  setDrawDistance(ahead) { this.ahead = ahead; }

  update(s, buildAll = false) {
    const c0 = Math.max(0, Math.floor((s - this.behind) / CHUNK_LEN));
    const c1 = Math.floor((s + this.ahead) / CHUNK_LEN);
    for (const [c, ch] of this.chunks) if (c < c0 || c > c1) { this._dispose(ch); this.chunks.delete(c); this.dirty = true; }
    let built = 0;
    for (let c = c0; c <= c1; c++) {
      if (this.chunks.has(c)) continue;
      if (!buildAll && built >= 1) break;
      const ch = this._build(c);
      if (ch) { this.chunks.set(c, ch); built++; this.dirty = true; }
    }
    if (this.dirty) this._rebuildInstances();
  }

  _dispose(ch) {
    this.root.remove(ch.group);
    ch.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    this.signals = this.signals.filter((sg) => sg.chunk !== ch);
  }

  _rebuildInstances() {
    this.dirty = false;
    const counts = {};
    for (const p of PROTOS) counts[p] = 0;
    for (const ch of this.chunks.values()) for (const it of ch.items) {
      const im = this.inst[it.p];
      const k = counts[it.p];
      if (k >= im.instanceMatrix.count) continue;
      im.setMatrixAt(k, it.m);
      im.setColorAt(k, it.c);
      counts[it.p] = k + 1;
    }
    // street-lamp heads (for night glows)
    this.lampPositions = [];
    const v = new THREE.Vector3();
    for (const ch of this.chunks.values()) for (const it of ch.items) {
      if (it.p !== 'pole') continue;
      v.set(1.3, 7.6, 0).applyMatrix4(it.m);
      this.lampPositions.push(v.clone());
    }
    this.lampVersion = (this.lampVersion || 0) + 1;
    for (const p of PROTOS) {
      const im = this.inst[p];
      im.count = counts[p];
      im.visible = counts[p] > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // colliders near a point (circles)
  collidersNear(s) {
    const out = [];
    const c = Math.floor(s / CHUNK_LEN);
    for (let k = c - 1; k <= c + 1; k++) { const ch = this.chunks.get(k); if (ch) for (const o of ch.colliders) out.push(o); }
    return out;
  }

  updateSignals(t) {
    for (const sg of this.signals) {
      const st = this.route.signalState(sg.j, t);
      if (st === sg.last) continue;
      sg.last = st;
      for (const L of sg.lamps) {
        L[0].material = st === 'red' ? LAMP.redOn : LAMP.redOff;
        L[1].material = st === 'yellow' ? LAMP.yelOn : LAMP.yelOff;
        L[2].material = st === 'green' ? LAMP.grnOn : LAMP.grnOff;
      }
    }
  }

  // ------------------------------------------------------------
  _build(c) {
    const route = this.route;
    const road = buildRoadChunk(route, c);
    if (!road) return null;
    const group = new THREE.Group();
    group.add(road);
    this.root.add(group);
    const ch = { c, group, items: [], colliders: [] };
    const R = rng(route.seed ^ (c * 2654435761));
    const s0 = c * CHUNK_LEN, s1 = s0 + CHUNK_LEN;
    const items = ch.items, cols = ch.colliders;

    const put = (p, s, d, rot = 0, sx = 1, sy = 1, sz = 1, color = null, collideR = 0, yOff = 0, pitch = 0) => {
      if (s < 0 || s > route.length) return;
      route.pos(s, d, _p);
      _e.set(pitch, _p.h + rot, 0, 'YXZ');
      _q.setFromEuler(_e);
      _v.set(_p.x, _p.y + yOff, _p.z);
      _s.set(sx, sy, sz);
      const m = new THREE.Matrix4().compose(_v, _q, _s);
      items.push({ p, m, c: color ? new THREE.Color(color) : new THREE.Color(1, 1, 1) });
      if (collideR > 0) cols.push({ x: _p.x, z: _p.z, r: collideR, kind: p });
    };
    const shade = (base, amt = 0.15) => { const col = new THREE.Color(base); const f = 1 - amt / 2 + R() * amt; col.multiplyScalar(f); return col; };
    const tint = (amt = 0.25) => { const f = 1 - amt / 2 + R() * amt; return new THREE.Color(f, f + (R() - 0.5) * 0.1, f); };

    for (let s = s0; s < s1; s += 6) {
      const z = route.zoneAt(s);
      const th = route.themeAt(s);
      const i = route.idx(s);
      const hill = route.hillAmt[i] > 0.3;
      const nearJ = route.junctions.some((j) => Math.abs(j.s - s) < 20);
      const nearStop = [...route.pumps, ...route.dhabas].some((p) => Math.abs(p.s - s) < 45);
      const nearBay = Math.abs(s - route.bayS) < 85;
      const nearBorder = route.borders.some((b) => Math.abs(b.s - s) < 15);
      const village = nearStop || nearBorder ? null : route.villages.find((v) => s > v.s && s < v.s + v.len);

      if (z.type === 'city') {
        if (Math.floor(s / 6) % 5 === 0 && !nearJ) for (const sd of [1, -1]) if (!(nearBay && sd > 0)) put('pole', s, sd * 6.6, sd > 0 ? Math.PI : 0, 1, 1, 1, null, 0.25);
        if (!nearJ && !nearBay && Math.floor(s / 6) % 2 === 0) {
          for (const sd of [1, -1]) {
            if (R() < 0.85) {
              if (R() < 0.45) put('shop', s, sd * 15, sd > 0 ? Math.PI : 0, 1, 0.9 + R() * 0.5, 1, tint(0.5).multiply(new THREE.Color(R.pick(['#f4e3c1', '#d7ecf7', '#f7d7e0', '#e7f5d0', '#fff3b0']))));
              else {
                const hgt = R.range(6, z.dest || s < 500 ? 26 : 18);
                put('building', s, sd * R.range(19, 24), 0, R.range(8, 11), hgt, R.range(9, 12), shade(R.pick(['#e8d5b0', '#d9c3a5', '#c9d6df', '#f0e0d0', '#e3c9c9', '#cfd8c4', '#f2f2f2'])));
              }
            }
            if (R() < 0.3) put('building', s, sd * R.range(34, 60), 0, R.range(10, 16), R.range(10, 35), R.range(10, 16), shade('#cfc6b8'));
          }
        }
        if (R() < 0.05 && !nearJ && !nearBay && s > 220) put('cow', s, (R() < 0.5 ? 1 : -1) * R.range(6.3, 7.5), R() * 6, 1, 1, 1, null, 0.9);
        if (R() < 0.08) put('tree_neem', s, (R() < 0.5 ? 1 : -1) * 9.5, R() * 6, 0.8, 0.8, 0.8, tint(), 0.35);
      } else if (z.type === 'industrial') {
        if (Math.floor(s / 6) % 7 === 0) put('epole', s, 9, 0, 1, 1, 1, null, 0.3);
        if (R() < 0.05) put(R.pick(['factory', 'warehouse', 'tank']), s, (R() < 0.5 ? 1 : -1) * R.range(40, 70), R.pick([0, Math.PI / 2]), 1, 1, 1, tint(0.2));
        if (R() < 0.03) put('factory', s, (R() < 0.5 ? 1 : -1) * R.range(80, 120), 0, 1.2, 1.2, 1.2, tint(0.2));
        if (R() < 0.15) put('bush', s, (R() < 0.5 ? 1 : -1) * R.range(9, 20), 0, 1, 1, 1, tint());
        if (R() < 0.1) put('tree_round', s, (R() < 0.5 ? 1 : -1) * R.range(11, 26), R() * 6, 1, 1, 1, tint(), 0.35);
      } else {
        // highway / hills
        const dens = th.treeDensity;
        if (!hill) {
          // avenue trees with painted trunks
          if (!nearStop && !nearBorder && Math.floor(s / 6) % 3 === 0 && R() < 0.5 * dens) for (const sd of [1, -1]) if (R() < 0.7) put(th.trees.includes('palm') ? 'tree_palm' : th.trees.includes('khejri') ? 'tree_khejri' : 'tree_avenue', s + R() * 3, sd * R.range(9.5, 11), R() * 6, 1, R.range(0.85, 1.15), 1, tint(), 0.35);
          if (Math.floor(s / 6) % 8 === 0) put('epole', s, -12, 0, 1, 1, 1, null, 0.3);
          if (Math.floor(s / 6) % 33 === 0) put('kmstone', s, 6.4, Math.PI / 2, 1, 1, 1, null, 0.3);
          // fields
          if (Math.floor(s / 6) % 5 === 0 && !village) for (const sd of [1, -1]) {
            if (nearStop && sd > 0) continue;
            if (th.dunes && R() < 0.5) { put('dune', s, sd * R.range(30, 80), R() * 3, R.range(12, 22), R.range(14, 26), R.range(10, 20), shade('#dcbf85', 0.1), 0, -1); continue; }
            if (R() < 0.85) {
              const depth = R.range(20, 50), dc = sd * (R.range(15, 20) + depth / 2);
              const g = (route.y[Math.min(route.n - 1, i + 6)] - route.y[Math.max(0, i - 6)]) / 24;
              put('field', s + 15, dc, 0, depth, 1, 29, shade(R.pick(th.field), 0.15), 0, 0, -Math.atan(g));
            }
          }
          // random trees
          const nTrees = 3 * dens;
          for (let k = 0; k < nTrees; k++) if (R() < 0.35) {
            const sd = R() < 0.5 ? 1 : -1;
            const d = sd * R.range(14, 90);
            const t = 'tree_' + R.pick(th.trees);
            put(t === 'tree_bush' ? 'bush' : t, s + R() * 6, d, R() * 6, 1, R.range(0.8, 1.3), 1, tint(), Math.abs(d) < 16 ? 0.35 : 0);
          }
          if (th.rocks && R() < 0.15) { const d = (R() < 0.5 ? 1 : -1) * R.range(12, 60); put('rock', s, d, R() * 6, R.range(1, 3), R.range(0.8, 2), R.range(1, 3), tint(0.2), Math.abs(d) < 16 ? 1.5 : 0); }
          // villages
          if (village && Math.floor(s / 6) % 2 === 0) {
            const sd = village.side;
            if (R() < 0.7) put('hut', s, sd * R.range(15, 30), sd > 0 ? Math.PI : 0, 1, 1, 1, tint(0.2).multiply(new THREE.Color(th.hut)), 0);
            if (R() < 0.4) put('shop', s, -sd * 14, -sd > 0 ? Math.PI : 0, 0.9, 0.8, 0.8, tint(0.4).multiply(new THREE.Color(R.pick(['#f6d365', '#a1c4fd', '#fbc2eb', '#c2e9fb']))));
            if (R() < 0.08) put('temple', s, sd * R.range(30, 40), 0, 1, 1, 1, null);
            if (R() < 0.08) put('cow', s, sd * R.range(6.4, 9), R() * 6, 1, 1, 1, null, 0.9);
          }
        } else {
          // ghat road: trees on slopes, rocks, mountains
          const hs = route.hillSide[i];
          for (let k = 0; k < 3; k++) {
            const sd = R() < 0.5 ? hs : -hs;
            const d = sd * R.range(10, 60);
            if (R() < 0.6) put('tree_' + R.pick(th.trees.filter((t) => t !== 'bush').concat(['teak'])), s + R() * 6, d, R() * 6, 1, R.range(0.9, 1.4), 1, tint(), 0);
          }
          if (R() < 0.3) put('rock', s, hs * R.range(9, 20), R() * 6, R.range(1, 3), R.range(1, 2), R.range(1, 3), tint(0.2));
        }
        // mountain backdrop
        if ((th.hills || hill) && Math.floor(s / 6) % 4 === 0 && R() < 0.5) {
          const sd = R() < 0.5 ? 1 : -1;
          const sc = R.range(50, 130);
          put('mountain', s + R() * 20, sd * R.range(140, 300), R() * 6, sc * R.range(1, 1.6), sc * R.range(0.7, 1.1), sc, shade(th.mountain, 0.2), 0, -8);
        }
      }
    }

    // ---------- unique objects ----------
    const ub = new Builder();
    const addGeo = (geo, s, d, rot = 0, yOff = 0) => {
      route.pos(s, d, _p);
      ub.addGeometry(geo, null, _p.x, _p.y + yOff, _p.z, 0, _p.h + rot, 0);
    };
    // colour-preserving merge (addGeometry tints with white = keep colours)
    for (const p of route.pumps) if (p.s >= s0 && p.s < s1) {
      addGeo(pumpStationGeo(), p.s, 15, Math.PI);
      const pillars = [[-4.5, -7], [-4.5, 7], [-4.5, -4], [-4.5, 4]];
      for (const [x, zz] of pillars) { route.pos(p.s - zz, 15 - x, _p); cols.push({ x: _p.x, z: _p.z, r: 0.6, kind: 'pump' }); }
      route.pos(p.s - 13.5, 8, _p); cols.push({ x: _p.x, z: _p.z, r: 0.3, kind: 'pole' });
    }
    for (const p of route.dhabas) if (p.s >= s0 && p.s < s1) {
      addGeo(dhabaGeo(), p.s, 17, Math.PI);
      route.pos(p.s + 14, 10, _p); cols.push({ x: _p.x, z: _p.z, r: 0.3, kind: 'pole' });
      route.pos(p.s + 6, 22, _p); cols.push({ x: _p.x, z: _p.z, r: 4.5, kind: 'building' });
    }
    // signals at junctions
    for (const j of route.junctions) if (j.s >= s0 && j.s < s1) {
      const sg = { j, lamps: [], last: null, chunk: ch };
      for (const [ds, dd, rot] of [[-10, 6.8, Math.PI / 2], [10, -6.8, -Math.PI / 2]]) {
        addGeo(signalGeo(), j.s + ds, dd, rot);
        route.pos(j.s + ds, dd, _p);
        cols.push({ x: _p.x, z: _p.z, r: 0.3, kind: 'signal' });
        // lamp positions: arm end at local (0, y, -2.7)
        const h = _p.h + rot;
        const lx = _p.x - Math.sin(h) * 2.7, lz = _p.z - Math.cos(h) * 2.7;
        const trio = [];
        [4.8, 4.4, 4.0].forEach((ly, k) => {
          const m = new THREE.Mesh(lampGeo, LAMP.redOff);
          m.userData.shared = true;
          m.position.set(lx - Math.sin(_p.h) * 0.2 * (ds < 0 ? 1 : -1), _p.y + ly, lz - Math.cos(_p.h) * 0.2 * (ds < 0 ? 1 : -1));
          group.add(m); trio.push(m);
        });
        sg.lamps.push(trio);
      }
      // buildings at corners leave gaps for side roads: add small kiosk and pole
      this.signals.push(sg);
    }
    // border gates
    for (const b of route.borders) if (b.s >= s0 && b.s < s1) {
      addGeo(gateGeo(17, '#e07a1f'), b.s, 0, Math.PI / 2);
      for (const dd of [8.5, -8.5]) { route.pos(b.s, dd, _p); cols.push({ x: _p.x, z: _p.z, r: 0.9, kind: 'gate' }); }
      this._signPlane(group, signTexture('gate', ['Welcome to ' + STATES[b.to].name, 'Drive slow • Pay toll'], 0), b.s - 0.75, 0, 9.0, 15, 2.0);
    }
    // signs
    for (const sg of route.signs) if (sg.s >= s0 && sg.s < s1) {
      const tex = signTexture(sg.kind, sg.text, sg.dir);
      if (sg.kind === 'turn') {
        route.pos(sg.s, 6.5, _p);
        ub.box(0.1, 2.4, 0.1, _p.x, _p.y + 1.2, _p.z, '#777');
        cols.push({ x: _p.x, z: _p.z, r: 0.2, kind: 'pole' });
        this._signPlane(group, tex, sg.s, 6.5, 2.7, 1.5, 0.75, true);
      } else {
        const big = sg.kind !== 'stop';
        const d = 8.2, W = big ? 5.2 : 3.4, H = W / 2;
        for (const o of [-W / 2 + 0.4, W / 2 - 0.4]) {
          route.pos(sg.s, d + o, _p);
          ub.box(0.15, 3.5 + H, 0.15, _p.x, _p.y + (3.5 + H) / 2, _p.z, '#888');
          cols.push({ x: _p.x, z: _p.z, r: 0.25, kind: 'pole' });
        }
        this._signPlane(group, tex, sg.s - 0.1, d, 3.5 + H / 2, W, H);
      }
    }
    // destination depot
    if (route.bayS >= s0 && route.bayS < s1) {
      const bs = route.bayS;
      const wall = (sa, da, sb, db) => {
        const n = Math.ceil(Math.hypot(sb - sa, db - da) / 1.5);
        for (let k = 0; k <= n; k++) {
          const s = sa + (sb - sa) * k / n, d = da + (db - da) * k / n;
          route.pos(s, d, _p);
          if (k < n) {
            const s2 = sa + (sb - sa) * (k + 1) / n, d2 = da + (db - da) * (k + 1) / n;
            const q = route.pos(s2, d2, {});
            const len = Math.hypot(q.x - _p.x, q.z - _p.z);
            ub.box(0.4, 2.2, len + 0.05, (_p.x + q.x) / 2, _p.y + 1.1, (_p.z + q.z) / 2, k % 2 ? '#d9cfc0' : '#c9bfb0', 0, Math.atan2(q.x - _p.x, q.z - _p.z), 0);
          }
          cols.push({ x: _p.x, z: _p.z, r: 0.75, kind: 'wall' });
        }
      };
      wall(bs - 45, 32, bs + 45, 32); wall(bs + 45, 32, bs + 45, 8.5);
      // bay markings
      const bay = route.bay;
      if (bay) {
        const lineW = 0.22;
        const edges = [[-bay.l / 2, bay.w / 2, bay.l / 2, bay.w / 2], [-bay.l / 2, -bay.w / 2, bay.l / 2, -bay.w / 2], [-bay.l / 2, -bay.w / 2, -bay.l / 2, bay.w / 2], [bay.l / 2, -bay.w / 2, bay.l / 2, bay.w / 2]];
        for (const [a1, b1, a2, b2] of edges) {
          const n = Math.max(1, Math.ceil(Math.abs(a2 - a1) / 2));
          for (let k = 0; k < n; k++) {
            const sa = bay.s + a1 + (a2 - a1) * k / n, sb = bay.s + a1 + (a2 - a1) * (k + 1) / n;
            const da = bay.d + b1 + (b2 - b1) * k / n, db = bay.d + b1 + (b2 - b1) * (k + 1) / n;
            const pa = route.pos(sa, da, {}), pb = route.pos(sb, db, {});
            const len = Math.hypot(pb.x - pa.x, pb.z - pa.z) || lineW;
            ub.box(a1 === a2 ? lineW : lineW, 0.03, len + lineW, (pa.x + pb.x) / 2, Math.max(pa.y, pb.y) + 0.07, (pa.z + pb.z) / 2, '#ffd600', 0, Math.atan2(pb.x - pa.x, pb.z - pa.z), 0);
          }
        }
        // floating arrow
        const ag = new Builder();
        ag.cone(0.9, 1.6, 4, 0, 0, 0, '#ffd600', Math.PI, 0, 0);
        const arrow = ag.mesh();
        route.pos(bay.s, bay.d, _p);
        arrow.position.set(_p.x, _p.y + 8, _p.z);
        arrow.userData.baseY = _p.y + 8;
        arrow.scale.setScalar(1.6);
        group.add(arrow);
        this.bayArrow = arrow;
        // warehouse behind
        addGeo(propGeo('warehouse'), bs, 46, Math.PI);
      }
    }
    // road-end barricade and start barricade
    for (const se of [12, route.length - 22]) if (se >= s0 && se < s1) {
      for (let d = -6; d <= 6; d += 1.5) {
        route.pos(se, d, _p);
        ub.box(1.5, 1.0, 0.4, _p.x, _p.y + 0.5, _p.z, Math.round(d / 1.5) % 2 ? '#d32f2f' : '#f5f5f5', 0, _p.h + Math.PI / 2, 0);
        cols.push({ x: _p.x, z: _p.z, r: 0.8, kind: 'wall' });
      }
    }
    // city building lines act as walls (handled by route lateral limits)
    if (!ub.empty) group.add(ub.mesh());
    return ch;
  }

  _signPlane(group, tex, s, d, y, w, h, small = false) {
    route_pos(this.route, s, d, _p);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: small, side: THREE.DoubleSide, fog: true }));
    m.position.set(_p.x, _p.y + y, _p.z);
    m.rotation.y = _p.h + Math.PI;
    group.add(m);
    return m;
  }

  dispose() {
    for (const ch of this.chunks.values()) this._dispose(ch);
    this.chunks.clear();
    for (const p of PROTOS) this.root.remove(this.inst[p]);
    this.scene.remove(this.root);
  }
}
function route_pos(route, s, d, out) { return route.pos(s, d, out); }
