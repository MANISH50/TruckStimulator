// Crash effects: sparks, smoke, fire, flying debris, dents, cracked glass,
// and a recorder for the slow-motion replay.
// Sparks/smoke/fire are pure functions of time, so the replay shows them exactly.
import * as THREE from 'three';
import { Builder, rng, VC_MAT, clamp } from '../util.js';

const G = 9.81;

function softTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.bursts = []; this.emitters = []; this.fireballs = [];
    // sparks
    this.NS = 240;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.NS * 3), 3));
    g.setDrawRange(0, 0);
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffcc55', size: 0.22, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    // smoke / flame sprites
    this.smokeTex = softTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.pool = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, color: '#666' }));
      m.visible = false; scene.add(m); this.pool.push(m);
    }
    const fb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: '#ffaa22', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fb.visible = false; scene.add(fb); this.fbMesh = fb;
  }
  clear() { this.bursts = []; this.emitters = []; this.fireballs = []; this.update(0); }
  dispose() {
    this.scene.remove(this.sparks); this.scene.remove(this.fbMesh);
    for (const m of this.pool) this.scene.remove(m);
  }
  sparkBurst(t0, x, y, z, nx, nz, power, n = 90) {
    const R = rng((t0 * 1000) | 0);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const sp = (4 + R() * 10) * clamp(power, 0.4, 2);
      const a = Math.atan2(nx, nz) + (R() - 0.5) * 2.6;
      parts.push([Math.sin(a) * sp, 1.5 + R() * 6 * clamp(power, 0.5, 1.5), Math.cos(a) * sp, 0.4 + R() * 0.9]);
    }
    this.bursts.push({ t0, x, y, z, parts });
  }
  // continuous smoke (or flame) emitter
  emitter(t0, obj, offset, opt) {
    this.emitters.push(Object.assign({ t0, obj, offset: offset.clone(), rate: 6, life: 2.5, size: 1.5, grow: 2.5, rise: 2.2, color: '#555', alpha: 0.55, dur: 99 }, opt));
  }
  puffs(t0, x, y, z, n, opt) {
    // a one-off cloud of n puffs
    this.emitters.push(Object.assign({ t0, pos: new THREE.Vector3(x, y, z), rate: n / 0.25, dur: 0.25, life: 1.8, size: 2, grow: 4, rise: 1.5, color: '#9a9a9a', alpha: 0.6, spread: 2.5 }, opt));
  }
  fireball(t0, x, y, z, size) { this.fireballs.push({ t0, x, y, z, size }); }

  update(T) {
    // sparks
    const P = this.sparks.geometry.attributes.position;
    let k = 0;
    for (const b of this.bursts) {
      const t = T - b.t0;
      if (t < 0 || t > 1.5) continue;
      for (const p of b.parts) {
        if (t > p[3] || k >= this.NS) continue;
        const y = Math.max(b.y + 0.05, b.y + p[1] * t - 0.5 * G * t * t);
        P.setXYZ(k++, b.x + p[0] * t, y, b.z + p[2] * t);
      }
    }
    P.needsUpdate = true;
    this.sparks.geometry.setDrawRange(0, k);
    // sprites
    let used = 0;
    for (const e of this.emitters) {
      const t = T - e.t0;
      if (t < 0) continue;
      const tEnd = Math.min(t, e.dur);
      const first = Math.max(0, Math.ceil((t - e.life) * e.rate));
      const last = Math.floor(tEnd * e.rate);
      for (let i = first; i <= last && used < this.pool.length; i++) {
        const age = t - i / e.rate;
        if (age < 0 || age > e.life) continue;
        const R = rng(i * 7919 + ((e.t0 * 100) | 0));
        const sp = this.pool[used++];
        let bx, by, bz;
        if (e.obj) { const w = e.offset.clone().applyMatrix4(e.obj.matrixWorld); bx = w.x; by = w.y; bz = w.z; }
        else { bx = e.pos.x; by = e.pos.y; bz = e.pos.z; }
        const spr = e.spread || 0.4;
        sp.position.set(bx + (R() - 0.5) * spr + (R() - 0.5) * age * 1.2, by + age * e.rise, bz + (R() - 0.5) * spr + (R() - 0.5) * age * 1.2);
        const sc = e.size + age * e.grow;
        sp.scale.set(sc, sc, sc);
        sp.material.color.set(e.color);
        sp.material.opacity = e.alpha * (1 - age / e.life) * Math.min(1, age * 6);
        sp.material.blending = e.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        sp.visible = true;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
    // fireball
    let fbv = false;
    for (const f of this.fireballs) {
      const t = T - f.t0;
      if (t < 0 || t > 1.4) continue;
      fbv = true;
      const s = f.size * (0.3 + Math.min(1, t / 0.5) * 0.9);
      this.fbMesh.position.set(f.x, f.y + t * 3, f.z);
      this.fbMesh.scale.set(s, s * 0.85, s);
      this.fbMesh.material.opacity = clamp(1.3 - t, 0, 1);
      this.fbMesh.material.color.setHSL(0.08 - t * 0.05, 1, 0.55 - t * 0.2);
    }
    this.fbMesh.visible = fbv;
  }
}

// ---------- flying debris (simple rigid bodies) ----------
const debrisGeos = {};
function dGeo(kind) {
  if (debrisGeos[kind]) return debrisGeos[kind];
  const b = new Builder();
  switch (kind) {
    case 'shard': b.box(0.25, 0.02, 0.18, 0, 0, 0, '#9fc3d9'); break;
    case 'panel': b.box(0.7, 0.05, 0.5, 0, 0, 0, '#ffffff'); break;
    case 'bumper': b.box(1.6, 0.25, 0.2, 0, 0, 0, '#cfcfcf'); break;
    case 'tyre': b.wheel(0.45, 0.3, 0, 0, 0); break;
    case 'box': b.box(0.6, 0.5, 0.6, 0, 0, 0, '#b8894f'); b.box(0.62, 0.08, 0.62, 0, 0.1, 0, '#8a6a3a'); break;
    case 'log': b.cyl(0.22, 0.22, 4, 7, 0, 0, 0, '#7a4c28', Math.PI / 2, 0, 0); break;
    case 'rock': b.sphere(0.35, 0, 0, 0, '#5b3a2a', 1, 0.7, 1); break;
    case 'coil': b.cyl(0.8, 0.8, 1.3, 12, 0, 0, 0, '#9aa4ae', 0, 0, Math.PI / 2); break;
    case 'bag': b.box(0.6, 0.22, 0.45, 0, 0, 0, '#c8c2b5'); break;
    case 'veg': b.sphere(0.16, 0, 0, 0, '#ffffff'); break;
    case 'car': b.box(1.6, 0.55, 3.6, 0, 0, 0, '#ffffff'); b.box(1.4, 0.5, 1.8, 0, 0.5, -0.2, '#2c3e50'); break;
    case 'drum': b.cyl(0.3, 0.3, 0.9, 10, 0, 0, 0, '#c0392b'); break;
  }
  debrisGeos[kind] = b.build();
  return debrisGeos[kind];
}

export class Debris {
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.list = [];
    this.group = new THREE.Group(); scene.add(this.group);
  }
  clear() { for (const d of this.list) this.group.remove(d.mesh); this.list = []; }
  dispose() { this.clear(); this.scene.remove(this.group); }
  spawn(kind, x, y, z, vx, vy, vz, color) {
    if (this.list.length > 70) return null;
    const mat = color ? new THREE.MeshLambertMaterial({ color }) : VC_MAT;
    const mesh = new THREE.Mesh(dGeo(kind), mat);
    mesh.position.set(x, y, z);
    mesh.userData.debris = true;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.group.add(mesh);
    const big = kind === 'coil' || kind === 'log' || kind === 'car';
    const d = { mesh, vx, vy, vz, wx: (Math.random() - 0.5) * (big ? 3 : 14), wy: (Math.random() - 0.5) * 8, wz: (Math.random() - 0.5) * (big ? 3 : 14), r: big ? 0.6 : 0.15, hint: -1, rest: 0 };
    this.list.push(d);
    return mesh;
  }
  update(dt) {
    for (const d of this.list) {
      if (d.rest > 1.5) continue;
      d.vy -= G * dt;
      const m = d.mesh;
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.rotation.x += d.wx * dt; m.rotation.y += d.wy * dt; m.rotation.z += d.wz * dt;
      const p = this.route.project(m.position.x, m.position.z, d.hint, {});
      d.hint = p.i;
      const gy = this.route.groundY(m.position.x, m.position.z, d.hint) + d.r;
      if (m.position.y < gy) {
        m.position.y = gy;
        if (d.vy < 0) d.vy = -d.vy * 0.3;
        d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wz *= 0.6; d.wy *= 0.6;
        if (Math.abs(d.vy) < 0.8 && Math.hypot(d.vx, d.vz) < 0.5) { d.vy = 0; d.rest += dt; }
      }
    }
  }
}

// ---------- dents ----------
export function dentMesh(mesh, worldPoint, worldDir, depth, radius) {
  if (!mesh || !mesh.geometry) return;
  if (!mesh.userData.ownGeo) { mesh.geometry = mesh.geometry.clone(); mesh.userData.ownGeo = true; }
  mesh.updateMatrixWorld();
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const lp = worldPoint.clone().applyMatrix4(inv);
  const ld = worldDir.clone().transformDirection(inv).normalize();
  const P = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const dx = v.x - lp.x, dz = v.z - lp.z, dy = (v.y - lp.y) * 0.6;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < radius) {
      const f = (1 - dist / radius) ** 2 * depth;
      v.addScaledVector(ld, f);
      v.y -= f * 0.25;
      P.setXYZ(i, v.x, v.y, v.z);
    }
  }
  P.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// ---------- cracked windshield overlay ----------
export function drawCracks(canvas, cx, cy, seed) {
  const W = canvas.width = canvas.clientWidth * Math.min(2, devicePixelRatio || 1);
  const H = canvas.height = canvas.clientHeight * Math.min(2, devicePixelRatio || 1);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const R = rng(seed);
  const x0 = cx * W, y0 = cy * H;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  const rays = 16;
  const pts = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + R() * 0.3;
    let x = x0, y = y0;
    const ray = [[x, y]];
    const len = (0.25 + R() * 0.5) * Math.max(W, H);
    const steps = 9;
    for (let k = 0; k < steps; k++) {
      const aa = a + (R() - 0.5) * 0.5;
      x += Math.cos(aa) * len / steps; y += Math.sin(aa) * len / steps;
      ray.push([x, y]);
    }
    pts.push(ray);
    g.beginPath(); g.moveTo(ray[0][0], ray[0][1]);
    for (const p of ray) g.lineTo(p[0], p[1]);
    g.stroke();
  }
  // concentric rings
  g.lineWidth = 1.2;
  for (let ring = 1; ring < 6; ring++) {
    g.beginPath();
    for (let i = 0; i <= rays; i++) {
      const r = pts[i % rays];
      const p = r[Math.min(r.length - 1, ring)];
      if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.strokeStyle = `rgba(255,255,255,${0.6 - ring * 0.08})`;
    g.stroke();
  }
  const gr = g.createRadialGradient(x0, y0, 0, x0, y0, 60);
  gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x0, y0, 60, 0, 7); g.fill();
}

// ---------- replay recorder ----------
export class Recorder {
  constructor() { this.frames = []; this.objs = new Set(); this.lastT = -1; this.maxAge = 5; }
  reset() { this.frames = []; this.objs.clear(); this.lastT = -1; }
  track(o) { if (o) this.objs.add(o); }
  untrack(o) { this.objs.delete(o); }
  sample(T, extra) {
    if (T - this.lastT < 1 / 40) return;
    this.lastT = T;
    const list = [];
    for (const o of this.objs) {
      if (!o.parent) { if (!this.keepAll) this.objs.delete(o); continue; }
      list.push([o, o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.visible]);
    }
    this.frames.push({ T, list, extra });
    while (this.frames.length && this.frames[0].T < T - this.maxAge && !this.keepAll) this.frames.shift();
  }
  // returns extra of frame applied
  apply(T) {
    const f = this.frames;
    if (!f.length) return null;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].T <= T) i++;
    const fr = f[i];
    const present = new Set();
    for (const r of fr.list) {
      const o = r[0];
      o.position.set(r[1], r[2], r[3]);
      o.quaternion.set(r[4], r[5], r[6], r[7]);
      o.visible = r[8];
      present.add(o);
    }
    for (const o of this.objs) if (!present.has(o) && o.userData.debris) o.visible = false;
    return fr.extra;
  }
  get t0() { return this.frames.length ? this.frames[0].T : 0; }
  get t1() { return this.frames.length ? this.frames[this.frames.length - 1].T : 0; }
}
