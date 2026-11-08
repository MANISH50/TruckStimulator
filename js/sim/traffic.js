// AI traffic: cars, buses, auto-rickshaws, bikes, trucks, tractors.
// They keep to the LEFT lane of their direction, follow the vehicle ahead
// (Intelligent Driver Model), stop at red signals, and overtake sometimes.
import * as THREE from 'three';
import { VC_MAT, clamp, lerp } from '../util.js';
import { buildVehicleGeo, VEHICLE_TYPES } from '../world/models.js';
import { LANE } from '../world/route.js';

const MIX = {
  city: [['car', 30], ['auto', 20], ['bike', 20], ['bus', 9], ['truck', 7], ['suv', 14]],
  industrial: [['truck', 40], ['car', 20], ['bike', 15], ['auto', 10], ['suv', 10], ['bus', 5]],
  highway: [['car', 26], ['truck', 28], ['bus', 14], ['bike', 10], ['suv', 12], ['tractor', 5], ['auto', 5]],
  hills: [['truck', 30], ['car', 30], ['bus', 20], ['bike', 10], ['suv', 10]],
};
const TARGET = { city: 18, industrial: 11, highway: 11, hills: 7 };

const geoCache = {};
function vehicleGeo(type, variant) {
  const k = type + variant;
  if (!geoCache[k]) geoCache[k] = buildVehicleGeo(type, variant);
  return geoCache[k];
}

let uid = 1;
export class Traffic {
  constructor(scene, route) {
    this.scene = scene;
    this.route = route;
    this.list = [];
    this.crossers = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spawnT = 0;
    this.density = 1;
    this.frozen = false;
    this.tmp = {};
  }

  dispose() { this.scene.remove(this.group); this.list = []; this.crossers = []; }

  pickType(zoneType, R = Math.random) {
    const mix = MIX[zoneType] || MIX.highway;
    let tot = 0; for (const [, w] of mix) tot += w;
    let r = R() * tot;
    for (const [t, w] of mix) { r -= w; if (r <= 0) return t; }
    return 'car';
  }

  spawn(s, dir, type, v) {
    const T = VEHICLE_TYPES[type];
    const variant = Math.floor(Math.random() * 9);
    const mesh = new THREE.Mesh(vehicleGeo(type, variant), VC_MAT);
    this.group.add(mesh);
    const edge = type === 'bike' || type === 'auto' || type === 'tractor' ? 0.6 : 0;
    const laneD = dir * (LANE / 2 + edge);
    const zone = this.route.zoneAt(s).type;
    const v0 = T.vmax * (zone === 'city' ? 0.55 : zone === 'hills' ? 0.6 : 1) * (0.8 + Math.random() * 0.3);
    const o = {
      id: uid++, type, mesh, s, d: laneD, laneD, targetD: laneD, dir, v: v ?? v0 * 0.8, v0,
      len: T.len, wid: T.wid, mass: T.mass, accel: T.accel, aggressive: Math.random() < 0.45,
      overtaking: false, overtakeT: 0, x: 0, z: 0, h: 0, wreck: null, honk: 0,
    };
    this.list.push(o);
    this._place(o);
    return o;
  }

  remove(o) {
    this.group.remove(o.mesh);
    if (o.mesh.userData.ownGeo) o.mesh.geometry.dispose();
    const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1);
  }

  _place(o) {
    const p = this.route.pos(o.s, o.d, this.tmp);
    o.x = p.x; o.z = p.z;
    const dd = (o.targetD - o.d);
    const yaw = o.dir > 0 ? p.h : p.h + Math.PI;
    const steerYaw = Math.atan2(dd * 0.35 * o.dir, Math.max(3, o.v)) ;
    o.h = yaw + steerYaw * (o.dir > 0 ? 1 : 1);
    o.mesh.position.set(p.x, p.y, p.z);
    o.mesh.rotation.set(0, o.h, 0);
  }

  // obstacles = [{ s0, s1, d, hw, v (along +s), id }]
  update(dt, t, player, obstacles) {
    if (this.frozen) return;
    const route = this.route;
    const sP = player.s;
    const zone = route.zoneAt(sP).type;

    // spawn / despawn
    this.spawnT -= dt;
    const target = Math.round((TARGET[zone] || 10) * this.density);
    if (this.spawnT <= 0 && this.list.length < target) {
      this.spawnT = 0.35;
      const dir = Math.random() < 0.5 ? 1 : -1;
      let s = dir > 0 ? (Math.random() < 0.8 ? sP + 170 + Math.random() * 230 : sP - 130 - Math.random() * 60) : sP + 260 + Math.random() * 200;
      if (s > 60 && s < route.bayS - 150) {
        const nearJ = route.junctions.some((j) => Math.abs(j.s - s) < 30);
        const clear = !this.list.some((o) => Math.abs(o.s - s) < 28 && o.dir === dir);
        const behindVisible = dir > 0 && s < sP;
        if (!nearJ && clear && !(behindVisible && Math.abs(sP - s) < 100)) {
          const type = this.pickType(route.zoneAt(s).type);
          this.spawn(s, dir, type);
        }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if (!o.wreck && (o.s < sP - 230 || o.s > sP + 520 || o.s < 20 || o.s > route.length - 30)) this.remove(o);
    }

    // build obstacle list for following (vehicles + player + signals)
    const all = obstacles.slice();
    for (const o of this.list) all.push({ s0: o.s - o.len / 2, s1: o.s + o.len / 2, d: o.d, hw: o.wid / 2, v: o.dir * o.v, id: o.id, ref: o });

    for (const o of this.list) {
      if (o.wreck) continue;
      // find leader
      let gap = 1e9, vLead = 0, leader = null;
      const front = o.s + o.dir * o.len / 2;
      for (const b of all) {
        if (b.id === o.id) continue;
        if (Math.abs(b.d - o.d) > b.hw + o.wid / 2 + 0.35) continue;
        const g = o.dir > 0 ? b.s0 - front : front - b.s1;
        if (g > -1 && g < gap) { gap = g; vLead = b.v * o.dir; leader = b; }
      }
      // signals
      for (const j of route.junctions) {
        const stopS = j.s - o.dir * 9;
        const dist = (stopS - front) * o.dir;
        if (dist > 0 && dist < 70) {
          const st = route.signalState(j, t);
          const brakeDist = o.v * o.v / (2 * 3);
          if (st === 'red' || (st === 'yellow' && dist > brakeDist * 0.8)) {
            if (dist < gap) { gap = dist; vLead = 0; leader = null; }
          }
        }
      }
      // curve speed
      const ahead = route.k[route.idx(o.s + o.dir * 30)];
      const vCurve = Math.sqrt(3.2 / Math.max(1e-4, Math.abs(ahead)));
      const v0 = Math.min(o.overtaking ? o.v0 * 1.25 : o.v0, vCurve);
      // IDM
      const s0 = 2.5, T = 1.2, b = 3.0;
      const dv = o.v - vLead;
      const sStar = s0 + Math.max(0, o.v * T + o.v * dv / (2 * Math.sqrt(o.accel * b)));
      let acc = o.accel * (1 - Math.pow(o.v / Math.max(0.1, v0), 4) - Math.pow(sStar / Math.max(0.1, gap), 2));
      acc = clamp(acc, -8, o.accel);
      o.v = Math.max(0, o.v + acc * dt);
      o.s += o.dir * o.v * dt;

      // overtaking decision
      if (!o.overtaking && o.aggressive && leader && leader.ref && gap < 25 && leader.v * o.dir < o.v0 - 2.5 && o.type !== 'bus') {
        if (this._canOvertake(o, all, route)) { o.overtaking = true; o.targetD = -o.laneD; o.overtakeT = 0; o.passing = leader.id; }
      }
      if (o.overtaking) {
        o.overtakeT += dt;
        const passed = !this.list.some((q) => q.id === o.passing && (q.s - o.s) * o.dir > -o.len - 8);
        let danger = false;
        for (const b of all) {
          if (b.id === o.id) continue;
          if (Math.abs(b.d - o.d) < 2 && (b.v * o.dir) < 0) {
            const g = o.dir > 0 ? b.s0 - o.s : o.s - b.s1;
            if (g > 0 && g < 50 + o.v * 2) danger = true;
          }
        }
        if (passed || danger || o.overtakeT > 14) { o.overtaking = false; o.targetD = o.laneD; }
      }
      o.d += clamp(o.targetD - o.d, -1.6 * dt, 1.6 * dt);
      this._place(o);
    }

    this._crossers(dt, t, sP);
  }

  _canOvertake(o, all, route) {
    // no junctions or sharp curves within 150 m, opposite lane clear
    for (const j of route.junctions) if ((j.s - o.s) * o.dir > -10 && (j.s - o.s) * o.dir < 150) return false;
    for (let k = 0; k < 150; k += 10) {
      const i = route.idx(o.s + o.dir * k);
      if (Math.abs(route.k[i]) > 1 / 250 || route.hillAmt[i] > 0.1) return false;
    }
    for (const b of all) {
      if (b.id === o.id) continue;
      if (Math.abs(b.d + o.laneD) < 2.5) {
        const g = (b.s0 - o.s) * o.dir;
        if (g > -15 && g < 230) return false;
      }
    }
    return true;
  }

  // cross traffic at junctions moves while the main road has red
  _crossers(dt, t, sP) {
    const route = this.route;
    for (const j of route.junctions) {
      if (Math.abs(j.s - sP) > 260) continue;
      const st = route.signalState(j, t);
      j.crossT = (j.crossT || 0) - dt;
      if (st === 'red' && j.crossT <= 0 && this.crossers.filter((c) => c.j === j).length < 3) {
        j.crossT = 1.8 + Math.random() * 2;
        const type = ['car', 'auto', 'bike', 'car', 'bus', 'suv'][Math.floor(Math.random() * 6)];
        const T = VEHICLE_TYPES[type];
        const side = Math.random() < 0.5 ? 1 : -1; // travels from +d to -d (side 1) or reverse
        const mesh = new THREE.Mesh(vehicleGeo(type, Math.floor(Math.random() * 9)), VC_MAT);
        this.group.add(mesh);
        this.crossers.push({ j, type, mesh, side, u: 42, v: T.vmax * 0.5, len: T.len, wid: T.wid, mass: T.mass, id: uid++, x: 0, z: 0, h: 0, wreck: null });
      }
    }
    for (let i = this.crossers.length - 1; i >= 0; i--) {
      const c = this.crossers[i];
      if (c.wreck) continue;
      c.u -= c.v * dt;
      // lateral position along side road: d = side * u, lane offset in s by the side (keep left)
      const d = c.side * c.u;
      const sOff = c.side * 1.8;
      const p = route.pos(c.j.s + sOff, d, this.tmp);
      c.x = p.x; c.z = p.z;
      c.h = p.h + (c.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      c.mesh.position.set(p.x, p.y + 0.18, p.z);
      c.mesh.rotation.set(0, c.h, 0);
      if (c.u < -45 || Math.abs(c.j.s - sP) > 300) { this.group.remove(c.mesh); this.crossers.splice(i, 1); }
    }
  }

  // all vehicles as boxes for collision
  boxes() {
    const out = [];
    for (const o of this.list) out.push({ x: o.x, z: o.z, h: o.h, hl: o.len / 2, hw: o.wid / 2, ref: o });
    for (const c of this.crossers) out.push({ x: c.x, z: c.z, h: c.h, hl: c.len / 2, hw: c.wid / 2, ref: c });
    return out;
  }
  velocityOf(o) {
    if (o.wreck) return { x: o.wreck.vx, z: o.wreck.vz };
    const sp = o.v;
    return { x: Math.sin(o.h) * sp, z: Math.cos(o.h) * sp };
  }
}
