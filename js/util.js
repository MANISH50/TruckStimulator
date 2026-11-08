// Shared helpers: seeded random numbers, maths, and a "Builder" that merges
// many simple shapes (boxes, cylinders...) into ONE vertex-coloured mesh.
// One mesh = one draw call, which keeps the game fast on phones.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Mulberry32 seeded PRNG
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// One shared material for all vertex-coloured geometry.
export const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
export const VC_MAT_DS = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

const geoCache = {};
function baseGeo(key, make) {
  if (!geoCache[key]) { const g = make(); geoCache[key] = g.index ? g.toNonIndexed() : g; }
  return geoCache[key];
}

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  _add(geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const CA = color == null ? geo.attributes.color : null;
    if (!CA) _c.set(color);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(_m);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      if (CA) this.col.push(CA.getX(i), CA.getY(i), CA.getZ(i));
      else this.col.push(_c.r, _c.g, _c.b);
    }
    return this;
  }
  // box centred at x,y,z
  box(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    return this._add(baseGeo('box', () => new THREE.BoxGeometry(1, 1, 1)), color, x, y, z, rx, ry, rz, w, h, d);
  }
  // cylinder along Y axis centred at x,y,z
  cyl(rt, rb, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    const g = baseGeo('cyl' + seg + '_' + (rt / (rb || 1e-6)).toFixed(3), () => new THREE.CylinderGeometry(rt / Math.max(rb, 1e-6), 1, 1, seg));
    return this._add(g, color, x, y, z, rx, ry, rz, rb, h, rb);
  }
  // wheel: cylinder along X axis
  wheel(r, w, x, y, z, color = '#1b1b1b', hub = '#9a9a9a', seg = 10) {
    this.cyl(r, r, w, seg, x, y, z, color, 0, 0, Math.PI / 2);
    this.cyl(r * 0.5, r * 0.5, w * 1.04, 8, x, y, z, hub, 0, 0, Math.PI / 2);
    return this;
  }
  sphere(r, x, y, z, color, sx = 1, sy = 1, sz = 1, detail = 0) {
    const g = baseGeo('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail));
    return this._add(g, color, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz);
  }
  cone(r, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    const g = baseGeo('cone' + seg, () => new THREE.ConeGeometry(1, 1, seg));
    return this._add(g, color, x, y, z, rx, ry, rz, r, h, r);
  }
  // flat quad lying on XZ plane (y up), w along x, d along z
  plane(w, d, x, y, z, color, ry = 0) {
    const g = baseGeo('plane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    return this._add(g, color, x, y, z, 0, ry, 0, w, 1, d);
  }
  // triangular prism (roof) along z: w width, h height, d length
  prism(w, h, d, x, y, z, color, ry = 0) {
    const g = baseGeo('prism', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
      const e = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      e.translate(0, 0, -0.5);
      return e;
    });
    return this._add(g, color, x, y, z, 0, ry, 0, w, h, d);
  }
  addGeometry(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return this._add(geo.index ? geo.toNonIndexed() : geo, color, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  get empty() { return this.pos.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(mat = VC_MAT) { return new THREE.Mesh(this.build(), mat); }
}

// Canvas texture helper for signs
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
