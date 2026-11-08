// Builds the whole trip as one long road: a centre line sampled every 2 m,
// plus zones (city / industrial / highway / hills), states, stops and signs.
// Everything else (road mesh, traffic, mini-map) reads from this.
import { rng, clamp, smooth, hashStr, haversineKm } from '../util.js';
import { STATES, THEMES, statePath, cityById } from '../data/cities.js';

export const STEP = 2;            // metres between samples
export const LANE = 3.5;
export const ROAD_HALF = 3.6;     // asphalt half width
export const SHOULDER = 5.6;

export function tripInfo(fromId, toId) {
  const a = cityById(fromId), b = cityById(toId);
  const straight = haversineKm(a, b);
  const realKm = Math.round(straight * 1.25);
  const gameM = Math.round(clamp(4000 + (realKm / 2500) * 8500, 4000, 12500));
  const states = statePath(a.state, b.state);
  const estSec = gameM / (46 / 3.6);
  return { from: a, to: b, realKm, gameM, states, estSec };
}

export class Route {
  constructor(fromId, toId) {
    const info = tripInfo(fromId, toId);
    Object.assign(this, info);
    this.seed = hashStr(fromId + '>' + toId);
    const R = rng(this.seed);
    this.PRE = 160;
    this.POST = 190;
    this.startS = 130;
    this.length = this.PRE + info.gameM + this.POST;
    this.n = Math.ceil(this.length / STEP) + 1;
    this.bayS = this.length - 120;
    this.bay = { s: this.bayS, d: 18, l: 26, w: 4.6 };
    this._zones(R);
    this._widths();
    this._centreline(R);
    this._heights(R);
    this._events(R);
    this._limits();
  }

  // ---------- zone layout ----------
  _zones(R) {
    const L = this.length;
    const Z = [];
    const add = (s0, s1, type, state, extra = {}) => { if (s1 > s0) Z.push(Object.assign({ s0, s1, type, state }, extra)); };
    const cityLen = 700, indLen = 380;
    const a = this.from.state, b = this.to.state;
    add(0, cityLen, 'city', a, { city: this.from.name });
    add(cityLen, cityLen + indLen, 'industrial', a);
    const endInd = L - cityLen - indLen;
    // split the middle between the states on the path
    const mid0 = cityLen + indLen, mid1 = endInd;
    const st = this.states;
    const weights = st.map((s, i) => (i === 0 || i === st.length - 1 ? 0.7 : 1));
    const wsum = weights.reduce((x, y) => x + y, 0);
    let s = mid0;
    this.borders = [];
    st.forEach((code, i) => {
      const len = (mid1 - mid0) * weights[i] / wsum;
      const e = s + len;
      const th = THEMES[code];
      if (th.hills && len > 1100) {
        const hl = Math.min(950, len * 0.45);
        const h0 = s + (len - hl) * (0.35 + R() * 0.3);
        add(s, h0, 'highway', code);
        add(h0, h0 + hl, 'hills', code, { side: R() < 0.5 ? 1 : -1 });
        add(h0 + hl, e, 'highway', code);
      } else add(s, e, 'highway', code);
      if (i > 0) this.borders.push({ s: s, from: st[i - 1], to: code });
      s = e;
    });
    add(endInd, L - cityLen, 'industrial', b);
    add(L - cityLen, L, 'city', b, { city: this.to.name, dest: true });
    this.zones = Z;
    // per-sample zone index
    this.zi = new Uint8Array(this.n);
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const si = i * STEP;
      while (k < Z.length - 1 && si >= Z[k].s1) k++;
      this.zi[i] = k;
    }
  }
  // road width per sample: 2 lanes in cities, 4 lanes (divided) elsewhere, with tapers
  _widths() {
    const n = this.n;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = this.zones[this.zi[i]].type === 'city' ? 0 : 1;
    const W = 35; // +-70 m taper
    this.wide = new Float32Array(n); this.edge = new Float32Array(n); this.med = new Float32Array(n);
    const pre = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - W), b = Math.min(n, i + W + 1);
      const w = smooth((pre[b] - pre[a]) / (b - a));
      // a city section always fully 2 lanes, so the taper happens just outside it
      const f = raw[i] === 0 ? 0 : clamp((w - 0.5) * 2, 0, 1);
      this.wide[i] = smooth(f);
      this.edge[i] = ROAD_HALF + 4.0 * this.wide[i];
      this.med[i] = 0.7 * this.wide[i];
    }
  }
  extra(i) { return this.edge[i] - ROAD_HALF; }
  extraAt(s) { return this.extra(this.idx(s)); }
  // centre of a lane: lane 0 = left (slow), lane 1 = right (fast); dir +1 = our direction (positive d)
  laneD(s, dir, lane) {
    const i = this.idx(s);
    const d = lane === 0 ? this.edge[i] - 1.85 : 1.75 + this.med[i];
    return dir * d;
  }

  zoneAt(s) { return this.zones[this.zi[clamp(Math.round(s / STEP), 0, this.n - 1)]]; }

  // ---------- centre line ----------
  _centreline(R) {
    const n = this.n;
    const k = new Float32Array(n);
    const junction = [];
    this.sharpTurns = [];
    let s = 0;
    let heading = 0; // approximate heading used for bias
    const curve = (len, kk) => {
      const i0 = Math.floor(s / STEP), i1 = Math.min(n, Math.floor((s + len) / STEP));
      for (let i = i0; i < i1; i++) k[i] = kk;
      heading += kk * len;
      s += len;
    };
    const signBias = () => (Math.abs(heading) > 0.35 ? -Math.sign(heading) : (R() < 0.5 ? 1 : -1));
    // keep start and end straight
    curve(this.PRE + 120, 0);
    while (s < this.length - this.POST - 260) {
      const z = this.zoneAt(s);
      if (z.type === 'city') {
        const len = R.range(170, 260);
        // junction in the middle of a straight
        if (s > 180 && s + len < this.length - 260) junction.push(s + len * 0.5);
        curve(len, 0);
        if (R.chance(0.35)) { const r = R.range(380, 700), ang = R.range(0.12, 0.3); curve(ang * r, signBias() / r); }
      } else if (z.type === 'industrial') {
        curve(R.range(140, 260), 0);
        const r = R.range(250, 500), ang = R.range(0.15, 0.4); curve(ang * r, signBias() / r);
      } else if (z.type === 'hills') {
        curve(R.range(15, 50), 0);
        const r = R.range(32, 70), ang = R.range(0.8, 1.6);
        const sg = signBias();
        if (r < 45) this.sharpTurns.push({ s: s, dir: sg });
        curve(ang * r, sg / r);
      } else {
        curve(R.range(140, 380), 0);
        if (R.chance(0.18)) {
          const r = R.range(60, 95), ang = R.range(0.7, 1.2), sg = signBias();
          this.sharpTurns.push({ s: s, dir: sg });
          curve(ang * r, sg / r);
        } else {
          const r = R.range(200, 650), ang = R.range(0.15, 0.6);
          curve(ang * r, signBias() / r);
        }
      }
    }
    // straighten the last part (destination)
    for (let i = Math.floor(s / STEP); i < n; i++) k[i] = 0;
    // smooth curvature (easement curves)
    const ks = new Float32Array(n);
    const W = 10;
    for (let i = 0; i < n; i++) {
      let a = 0, c = 0;
      for (let j = -W; j <= W; j++) { const q = i + j; if (q >= 0 && q < n) { a += k[q]; c++; } }
      ks[i] = a / c;
    }
    // integrate
    const x = new Float32Array(n), zz = new Float32Array(n), h = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      h[i] = h[i - 1] + ks[i - 1] * STEP;
      const hm = (h[i] + h[i - 1]) / 2;
      x[i] = x[i - 1] + Math.sin(hm) * STEP;
      zz[i] = zz[i - 1] + Math.cos(hm) * STEP;
    }
    this.x = x; this.z = zz; this.h = h; this.k = ks;
    // max |k| in a window - used to stop ground strips folding on the inside of curves
    const km = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = -20; j <= 20; j += 2) { const q = i + j; if (q >= 0 && q < n) m = Math.max(m, Math.abs(ks[q])); }
      km[i] = m;
    }
    this.kmax = km;
    this.junctions = junction.map((js, i) => ({ s: js, id: i, offset: R.range(0, 30), cycle: 30 }));
  }

  // ---------- height profile ----------
  _heights(R) {
    const n = this.n;
    const g = new Float32Array(n);
    const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
    this.hillAmt = new Float32Array(n);
    this.hillSide = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      const z = this.zones[this.zi[i]];
      let grade = 0.022 * Math.sin(s / 260 + ph[0]) + 0.012 * Math.sin(s / 97 + ph[1]);
      if (z.type === 'city') grade *= 0.25;
      if (z.type === 'industrial') grade *= 0.4;
      if (z.type === 'hills') {
        const t = (s - z.s0) / (z.s1 - z.s0);
        const ramp = smooth(clamp(t / 0.12, 0, 1)) * smooth(clamp((1 - t) / 0.12, 0, 1));
        grade = (t < 0.5 ? 0.058 : -0.058) * ramp + 0.01 * Math.sin(s / 60 + ph[2]);
        const edge = smooth(clamp((s - z.s0) / 90, 0, 1)) * smooth(clamp((z.s1 - s) / 90, 0, 1));
        this.hillAmt[i] = edge;
        this.hillSide[i] = z.side;
      }
      g[i] = grade;
    }
    // flat at junctions and start / end
    for (const j of this.junctions) {
      for (let i = Math.max(0, Math.floor((j.s - 50) / STEP)); i < Math.min(n, (j.s + 50) / STEP); i++) g[i] *= 0.1;
    }
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      if (s < this.PRE + 60 || s > this.bayS - 160) g[i] *= 0.05;
    }
    const y = new Float32Array(n);
    for (let i = 1; i < n; i++) y[i] = y[i - 1] + g[i - 1] * STEP;
    // smooth heights
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0, c = 0;
      for (let j = -6; j <= 6; j++) { const q = i + j; if (q >= 0 && q < n) { a += y[q]; c++; } }
      ys[i] = a / c;
    }
    this.y = ys;
  }

  // ---------- stops, signs ----------
  _events(R) {
    const okSpot = (s) => {
      const z = this.zoneAt(s);
      if (z.type === 'city' || z.type === 'hills') return false;
      const i = Math.round(s / STEP);
      for (let j = i - 40; j <= i + 40; j++) if (j >= 0 && j < this.n && this.wide[j] < 0.999) return false;
      for (let j = i - 40; j <= i + 40; j++) if (j >= 0 && j < this.n && (Math.abs(this.k[j]) > 1 / 300 || this.hillAmt[j] > 0)) return false;
      for (const b of this.borders) if (Math.abs(b.s - s) < 120) return false;
      return true;
    };
    const place = (s, lo, hi) => {
      for (let t = 0; t < 60; t++) { const c = s + (t % 2 ? 1 : -1) * t * 20; if (c > lo && c < hi && okSpot(c)) return c; }
      return null;
    };
    this.pumps = []; this.dhabas = [];
    const lo = 900, hi = this.bayS - 600;
    for (let s = 1300 + R() * 500; s < hi; s += R.range(1700, 2400)) {
      const p = place(s, lo, hi); if (p !== null) this.pumps.push({ s: p, kind: 'pump' });
    }
    for (let s = 2100 + R() * 600; s < hi; s += R.range(2100, 3000)) {
      let p = place(s, lo, hi);
      if (p !== null && this.pumps.some((q) => Math.abs(q.s - p) < 250)) p = place(p + 320, lo, hi);
      if (p !== null && !this.pumps.some((q) => Math.abs(q.s - p) < 200)) this.dhabas.push({ s: p, kind: 'dhaba' });
    }
    // villages along highways
    this.villages = [];
    for (const z of this.zones) if (z.type === 'highway') {
      for (let s = z.s0 + R.range(200, 600); s < z.s1 - 200; s += R.range(700, 1400)) this.villages.push({ s, len: R.range(120, 200), side: R() < 0.5 ? 1 : -1 });
    }
    // signs
    this.signs = [];
    this.signs.push({ s: 520, kind: 'board', text: [this.to.name.toUpperCase() + ' ' + this.realKm + ' km', 'NH  •  ' + STATES[this.to.state].name] });
    this.signs.push({ s: 660, kind: 'city', text: ['Thank you for visiting', this.from.name] });
    for (const b of this.borders) this.signs.push({ s: b.s - 120, kind: 'board', text: [STATES[b.to].name.toUpperCase(), 'border 100 m'] });
    const step = 1500;
    for (let s = 1700; s < this.bayS - 900; s += step) {
      const z = this.zoneAt(s);
      if (z.type === 'hills') continue;
      const remReal = Math.max(1, Math.round(this.realKm * (this.bayS - s) / (this.bayS - this.startS)));
      this.signs.push({ s, kind: 'board', text: [this.to.name.toUpperCase() + '  ' + remReal + ' km', 'Drive safe • Arrive safe'] });
    }
    this.signs.push({ s: this.length - 700 + 30, kind: 'city', text: ['Welcome to', this.to.name] });
    this.signs.push({ s: this.bayS - 260, kind: 'board', text: ['TRUCK DEPOT', 'Park in yellow bay  ←'] });
    for (const t of this.sharpTurns) this.signs.push({ s: t.s - 90, kind: 'turn', dir: t.dir });
    for (const p of this.pumps) this.signs.push({ s: p.s - 220, kind: 'stop', text: ['DIESEL PUMP', '200 m  ⛽'] });
    for (const p of this.dhabas) this.signs.push({ s: p.s - 220, kind: 'stop', text: ['DHABA', 'Food • Rest 200 m'] });
    this.signs = this.signs.filter((g) => g.s > 40 && g.s < this.length - 40);
  }

  // lateral limits (walls/barriers/buildings) per sample. +d = left of road.
  _limits() {
    const n = this.n;
    this.limL = new Float32Array(n).fill(1e9);
    this.limR = new Float32Array(n).fill(1e9);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      const z = this.zones[this.zi[i]];
      if (this.hillAmt[i] > 0.6) {
        const hs = this.hillSide[i];
        // rock wall on hill side, crash barrier on valley side
        const e = this.edge[i];
        if (hs > 0) { this.limL[i] = e + 3.4; this.limR[i] = e + 2.8; } else { this.limR[i] = e + 3.4; this.limL[i] = e + 2.8; }
      } else if (z.type === 'city') {
        let free = false;
        for (const j of this.junctions) if (Math.abs(j.s - s) < 13) free = true;
        if (Math.abs(s - this.bayS) < 60) free = true;
        if (!free) { this.limL[i] = 12.5; this.limR[i] = 12.5; }
        if (Math.abs(s - this.bayS) < 60) this.limL[i] = 1e9;
      }
    }
  }

  // ---------- queries ----------
  idx(s) { return clamp(Math.floor(s / STEP), 0, this.n - 2); }
  // world position of (s, d): d = lateral offset, + is left
  pos(s, d = 0, out = {}) {
    const i = this.idx(s), f = clamp(s / STEP - i, 0, 1);
    const h = this.h[i] + (this.h[i + 1] - this.h[i]) * f;
    const x = this.x[i] + (this.x[i + 1] - this.x[i]) * f;
    const z = this.z[i] + (this.z[i + 1] - this.z[i]) * f;
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * f;
    // left vector = (cos h, -sin h)
    out.x = x + Math.cos(h) * d;
    out.z = z - Math.sin(h) * d;
    out.y = y + this.sideH(i, d);
    out.h = h;
    return out;
  }
  heading(s) { const i = this.idx(s), f = clamp(s / STEP - i, 0, 1); return this.h[i] + (this.h[i + 1] - this.h[i]) * f; }
  // height of ground beside road, relative to road centre
  sideH(i, d) {
    const a = this.hillAmt[i];
    let h = 0;
    const ad = Math.abs(d);
    const e = this.edge[i];
    if (a > 0 && ad > e + 3) {
      const hill = Math.sign(d) === this.hillSide[i];
      if (hill) h = Math.min(45, (ad - e - 3) * 1.6) * a;
      else h = -Math.min(55, (ad - e - 3.6) * 0.9) * a;
    }
    if (ad > 5.6 && ad < 8.2 && this.zones[this.zi[i]].type === 'city') h += 0.15;
    if (ad < this.med[i] - 0.05) h += 0.15 * this.wide[i];
    return h;
  }
  // project world x,z to (s, d). hint = sample index to search around.
  project(x, z, hint = -1, out = {}) {
    let best = 1e18, bi = 0;
    let lo = 0, hi = this.n - 1;
    if (hint >= 0) { lo = Math.max(0, hint - 40); hi = Math.min(this.n - 1, hint + 40); }
    const stride = hint >= 0 ? 1 : 4;
    for (let i = lo; i <= hi; i += stride) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    if (stride > 1) for (let i = Math.max(0, bi - 4); i <= Math.min(this.n - 1, bi + 4); i++) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    const i = clamp(bi, 0, this.n - 2);
    const h = this.h[i];
    const dx = x - this.x[i], dz = z - this.z[i];
    const along = dx * Math.sin(h) + dz * Math.cos(h);
    out.s = i * STEP + along;
    out.d = dx * Math.cos(h) - dz * Math.sin(h);
    out.i = i;
    return out;
  }
  groundY(x, z, hint) {
    const p = this.project(x, z, hint, _pp);
    const i = this.idx(p.s), f = clamp(p.s / STEP - i, 0, 1);
    return this.y[i] + (this.y[i + 1] - this.y[i]) * f + this.sideH(i, p.d);
  }
  themeAt(s) { return THEMES[this.zoneAt(s).state]; }
  signalState(j, t) {
    // main road: green 0-16, yellow 16-19, red 19-30
    const c = (t + j.offset) % j.cycle;
    return c < 16 ? 'green' : c < 19 ? 'yellow' : 'red';
  }
}
const _pp = {};
