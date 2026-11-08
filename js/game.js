// One trip: builds the world, runs the simulation, handles stops, crashes,
// parking and the end of the game.
import * as THREE from 'three';
import { clamp, lerp, wrapAngle, fmtTime } from './util.js';
import { Route, STEP } from './world/route.js';
import { World } from './world/scenery.js';
import { buildPlayerTruck } from './world/models.js';
import { Truck, truckBoxes } from './sim/truck.js';
import { Traffic } from './sim/traffic.js';
import { boxBox, circleBox, boxCorners } from './sim/collision.js';
import { Effects, Debris, Recorder, dentMesh, drawCracks } from './sim/crash.js';
import { CameraRig, VIEW_NAMES } from './cameras.js';
import { STATES } from './data/cities.js';

const $ = (id) => document.getElementById(id);
const tmpP = {};

export class Game {
  constructor(app, sel) {
    this.app = app;
    this.sel = sel;
    const { spec, cargo } = sel;
    this.spec = spec; this.cargo = cargo;
    this.route = new Route(sel.from, sel.to);
    this.scene = new THREE.Scene();
    const sky = new THREE.Color(this.route.themeAt(0).sky);
    this.scene.background = sky.clone();
    this.scene.fog = new THREE.Fog(sky.clone(), 120, app.quality.fog);
    this.hemi = new THREE.HemisphereLight('#fff6e0', '#5a6040', 1.25);
    this.sun = new THREE.DirectionalLight('#fff3d6', 2.0);
    this.sun.position.set(-60, 120, 40);
    this.scene.add(this.hemi, this.sun);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    this.rig = new CameraRig(this.camera);
    if (app.lastView) this.rig.view = app.lastView;

    this.model = buildPlayerTruck(spec, cargo);
    this.scene.add(this.model.root);
    if (this.model.trailer) this.scene.add(this.model.trailer.group);
    this.truck = new Truck(spec, cargo, sel.governor);
    if (this.model.trailer) this.truck.Lt = this.model.trailer.axle;
    const totalLen = this.model.trailer ? this.model.cabFront - (0.3 + this.model.trailer.back) : this.model.cabFront - this.model.rearZ;
    this.totalLen = totalLen;
    this.route.bay.l = totalLen + 5.5;
    this.route.bay.w = spec.width + 2.2;

    this.world = new World(this.scene, this.route);
    this.world.setDrawDistance(app.quality.ahead);
    this.traffic = new Traffic(this.scene, this.route);
    this.traffic.density = app.quality.traffic;
    this.fx = new Effects(this.scene);
    this.debris = new Debris(this.scene, this.route);
    this.rec = new Recorder();
    this.reset();
  }

  reset() {
    const r = this.route;
    const s = r.startS, d = 1.75;
    const p = r.pos(s, d, {});
    this.truck.reset(p.x, p.z, p.h);
    this.hint = r.idx(s);
    this.s = s; this.d = d; this.prevS = s;
    this.simT = 0; this.tripT = 0;
    this.fuel = 100; this.tired = 0; this.cargoCond = 100;
    this.redLights = 0; this.offroadT = 0; this.bumps = 0;
    this.state = 'intro'; this.introT = 0;
    this.parkT = 0; this.ctx = null; this.busy = false;
    this.crash = null; this.over = null;
    this.msgT = 0; this.lastMsg = '';
    this.borderIdx = 0; this.zoneIdx = -1;
    this.timeScale = 1;
    this.traffic.list.slice().forEach((o) => this.traffic.remove(o));
    this.traffic.crossers.forEach((c) => this.traffic.group.remove(c.mesh));
    this.traffic.crossers = [];
    this.traffic.frozen = false;
    this.fx.clear(); this.debris.clear(); this.rec.reset();
    // repair truck model (rebuild to remove dents)
    if (this.dented) {
      this.scene.remove(this.model.root); if (this.model.trailer) this.scene.remove(this.model.trailer.group);
      this.model = buildPlayerTruck(this.spec, this.cargo);
      this.scene.add(this.model.root); if (this.model.trailer) this.scene.add(this.model.trailer.group);
      this.dented = false;
    }
    this.model.cargoGroup.visible = true;
    if (this.model.trailer) this.model.trailer.cargoGroup.visible = true;
    this.world.update(s, true);
    this.traffic.populate(s);
    this.rec.track(this.model.root);
    this.rec.track(this.model.cargoGroup);
    if (this.model.trailer) { this.rec.track(this.model.trailer.group); this.rec.track(this.model.trailer.cargoGroup); }
    this.app.controls.reset();
    this.app.controls.enabled = false;
    this._placeModel(0);
    this.rig.inited = false;
    $('cracks').style.display = 'none';
    $('flash').style.opacity = 0;
    $('vignette').style.opacity = 0;
    this.app.canvas.style.filter = '';
    this.wasStopped = true;
  }

  dispose() {
    this.world.dispose(); this.traffic.dispose(); this.fx.dispose(); this.debris.dispose();
    this.scene.traverse((o) => { if (o.geometry && o.userData.ownGeo) o.geometry.dispose(); });
  }

  msg(t, dur = 2.5) {
    const el = $('msg');
    if (t !== this.lastMsg || this.msgT <= 0) { el.textContent = t; this.lastMsg = t; }
    el.classList.add('show');
    this.msgT = dur;
  }

  // ---------------------------------------------------------------
  update(dt) {
    const app = this.app;
    if (this.state === 'paused') return;
    if (this.state === 'intro') return this._intro(dt);
    if (this.state === 'crash') return this._crashUpdate(dt);
    if (this.state === 'replay') return this._replayUpdate(dt);
    if (this.state === 'over') return this._overUpdate(dt);
    if (this.state !== 'drive') return;

    const c = app.controls;
    c.update(dt);
    if (this.autopilot) this._autopilot(c);
    this.simT += dt; this.tripT += dt;
    const t = this.truck, r = this.route;

    // slope along heading
    const i = r.idx(this.s);
    const grade = (r.y[i + 1] - r.y[i]) / STEP;
    const align = Math.cos(wrapAngle(t.heading - r.h[i]));
    t.offroad = Math.abs(this.d) > 6.0 && !this._onPaved();
    t.update(dt, { steer: c.steer, throttle: c.throttle, brake: c.brake, gear: c.gear }, { slope: Math.atan(grade * align) });
    if (t.shiftEvent) { if (t.shiftEvent > 0 && t.throttle > 0.4) app.audio.blowoff(); t.shiftEvent = 0; }

    const p = r.project(t.x, t.z, this.hint, tmpP);
    this.hint = p.i; this.prevS = this.s; this.s = p.s; this.d = p.d;
    this._placeModel(dt);

    // fuel, tiredness, cargo
    this.fuel = Math.max(0, this.fuel - t.fuelBurn(dt));
    if (this.fuel <= 0 && t.engineOn) { t.engineOn = false; this.msg('⛽ Out of diesel! The engine stopped.', 4); }
    if (Math.abs(t.v) > 1) this.tired = Math.min(100, this.tired + dt * 100 / 330);
    const cg = this.cargo;
    let dmg = 0;
    if (t.longAcc < -4.2) dmg += (-t.longAcc - 4.2) * 0.9;
    if (Math.abs(t.latAcc) > t.aRoll * 0.75) dmg += 1.2;
    if (t.offroad && Math.abs(t.v) > 5) dmg += 0.8;
    this.cargoCond = Math.max(0, this.cargoCond - dmg * cg.fragility * dt * 3);
    if (t.offroad) this.offroadT += dt;

    // world streaming & traffic
    this.world.update(this.s);
    this.world.updateSignals(this.simT);
    this.traffic.update(dt, this.simT, { s: this.s }, this._playerObstacles());
    if (this.world.bayArrow) this.world.bayArrow.position.y = this.world.bayArrow.userData.baseY + Math.sin(this.simT * 3) * 0.6;

    this._events(dt);
    this._stops(dt);
    if (this.state !== 'drive') return;
    this._collisions();
    if (this.state !== 'drive') return;
    // rollover
    if (t.tip > 1) { this._accident({ kind: 'rollover', speed: Math.abs(t.v), px: t.x, pz: t.z, nx: -Math.cos(t.heading) * Math.sign(t.latAcc), nz: Math.sin(t.heading) * Math.sign(t.latAcc) }); return; }
    // out of fuel and stopped
    if (!t.engineOn && Math.abs(t.v) < 0.3) { this._end('fuel'); return; }
    this._parking(dt);

    for (const o of this.traffic.list) this.rec.track(o.mesh);
    for (const o of this.traffic.crossers) this.rec.track(o.mesh);
    this.rec.sample(this.simT, { T: this.simT });
    this.fx.update(this.simT);
    this.rig.update(dt, t, this.model);
    this._fatigueFx(dt);
    this._audio(dt);
  }

  _onPaved() {
    const r = this.route;
    for (const p of r.pumps) if (Math.abs(p.s - this.s) < 25 && this.d > 0 && this.d < 24) return true;
    for (const p of r.dhabas) if (Math.abs(p.s - this.s) < 25 && this.d > 0 && this.d < 27) return true;
    if (Math.abs(r.bayS - this.s) < 60 && this.d > 0 && this.d < 33) return true;
    if (r.zoneAt(this.s).type === 'city' && Math.abs(this.d) < 13) return true;
    for (const j of r.junctions) if (Math.abs(j.s - this.s) < 6) return true;
    return false;
  }

  _placeModel(dt) {
    const t = this.truck, r = this.route, m = this.model;
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
    const yR = r.groundY(t.x, t.z, this.hint);
    const yF = r.groundY(t.x + fx * t.L, t.z + fz * t.L, this.hint);
    t.y = yR;
    let pitch = -Math.atan2(yF - yR, t.L) + t.pitchVis;
    // off-road bumps
    if (t.offroad && Math.abs(t.v) > 1) pitch += Math.sin(this.simT * 23) * 0.01;
    m.root.position.set(t.x, yR, t.z);
    if (!t.wreck) m.root.rotation.set(pitch, t.heading, t.rollVis, 'YXZ');
    // wheels
    const spin = t.wheelSpin / m.wheelR;
    for (const w of m.wheels) w.rotation.x = spin;
    for (const fw of m.frontWheels) fw.rotation.y = t.steer;
    m.steerPivot.children[0].rotation.z = this.app.controls.wheelDeg * Math.PI / 180;
    if (m.interior.visible) {
      // needles sweep 270 degrees: speed 0-120, rpm 0-3000 (clockwise as seen by the driver)
      m.gauges[0].rotation.z = 2.356 - Math.min(1, t.speedKmh / 120) * 4.712;
      m.gauges[1].rotation.z = 2.356 - Math.min(1, t.rpm / 3000) * 4.712;
    }
    if (m.trailer) {
      const tg = m.trailer.group;
      const hp = t.hitchPos();
      const th = t.trailerVisH();
      const ax = hp.x - Math.sin(th) * m.trailer.axle, az = hp.z - Math.cos(th) * m.trailer.axle;
      const yH = r.groundY(hp.x, hp.z, this.hint), yA = r.groundY(ax, az, this.hint);
      tg.position.set(hp.x, yH + (pitch - t.pitchVis) * 0 , hp.z);
      if (!t.wreck) tg.rotation.set(-Math.atan2(yH - yA, m.trailer.axle), th, t.rollVis * 1.2, 'YXZ');
    }
  }

  _playerObstacles() {
    const out = [];
    const t = this.truck, r = this.route;
    for (const b of truckBoxes(t, this.model)) {
      const p = r.project(b.x, b.z, this.hint, {});
      const dh = wrapAngle(b.h - r.h[p.i]);
      const hl = b.hl * Math.abs(Math.cos(dh)) + b.hw * Math.abs(Math.sin(dh));
      const hw = b.hw * Math.abs(Math.cos(dh)) + b.hl * Math.abs(Math.sin(dh));
      out.push({ s0: p.s - hl, s1: p.s + hl, d: p.d, hw, v: t.v * Math.cos(dh), id: -1 });
    }
    return out;
  }

  // ---------------------------------------------------------------
  _events(dt) {
    const r = this.route, t = this.truck;
    // borders
    while (this.borderIdx < r.borders.length && this.s > r.borders[this.borderIdx].s) {
      const b = r.borders[this.borderIdx++];
      this.msg('🛣️ Welcome to ' + STATES[b.to].name + '!', 3.5);
      this.app.audio.chime(true);
    }
    // zone change messages
    const zi = r.zi[r.idx(this.s)];
    if (zi !== this.zoneIdx) {
      const z = r.zones[zi];
      if (this.zoneIdx >= 0) {
        const txt = { city: '🏙️ Entering ' + (z.city || 'city') + ' — watch for signals', industrial: '🏭 Industrial area', highway: '🌾 Open highway', hills: '⛰️ Ghat section — sharp curves, slow down!' }[z.type];
        if (txt) this.msg(txt, 3);
      }
      this.zoneIdx = zi;
      const sky = new THREE.Color(r.themeAt(this.s).sky);
      this.skyTarget = sky;
    }
    if (this.skyTarget) { this.scene.background.lerp(this.skyTarget, Math.min(1, dt * 0.5)); this.scene.fog.color.copy(this.scene.background); }
    // red lights
    for (const j of r.junctions) {
      const stop = j.s - 9;
      if (this.prevS < stop && this.s >= stop && Math.abs(this.d) < 4 && r.signalState(j, this.simT) === 'red') {
        this.redLights++; this.msg('🚦 You jumped a red light!', 2.5); this.app.audio.chime(false);
      }
    }
    // driving in the right-hand lane for too long?
    this.rightLaneT = this.d < -0.3 && this.d > -5 && t.v > 4 ? (this.rightLaneT || 0) + dt : 0;
    // warnings
    const w = $('warn');
    let warn = '';
    if (Math.abs(t.latAcc) > t.aRoll * 0.8 && Math.abs(t.v) > 5) warn = '⚠ TOO FAST FOR THIS TURN!';
    else if (this.fuel < 15 && t.engineOn) warn = '⛽ LOW FUEL — find a diesel pump';
    else if (this.tired > 85) warn = '😴 VERY TIRED — rest at a dhaba';
    else if (t.offroad && Math.abs(t.v) > 3) warn = '↩ OFF ROAD';
    else if (this.rightLaneT > 6) warn = '← KEEP LEFT (India drives on the left)';
    w.textContent = warn; w.style.display = warn ? 'block' : 'none';
    // approaching destination
    if (!this.destMsg && r.bayS - this.s < 420) { this.destMsg = true; this.msg('🏁 Depot ahead — park in the YELLOW BAY on the left', 5); }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('msg').classList.remove('show'); }
  }

  _stops(dt) {
    const r = this.route, t = this.truck;
    let ctx = null;
    const slow = Math.abs(t.v) < 0.6;
    const sFront = this.s + t.L * 0.5;
    for (const p of r.pumps) if (Math.abs(p.s - sFront) < 18 && this.d > 5 && this.d < 23) ctx = { kind: 'pump', p };
    for (const p of r.dhabas) if (Math.abs(p.s - sFront) < 20 && this.d > 5 && this.d < 27) ctx = { kind: 'dhaba', p };
    // hint when near
    if (!ctx) {
      for (const p of r.pumps) if (p.s - this.s > 0 && p.s - this.s < 120 && this.fuel < 70 && !p.hinted) { p.hinted = true; this.msg('⛽ Diesel pump ahead on the LEFT — pull in and stop', 3.5); }
      for (const p of r.dhabas) if (p.s - this.s > 0 && p.s - this.s < 120 && this.tired > 35 && !p.hinted) { p.hinted = true; this.msg('🍲 Dhaba ahead on the LEFT — stop to rest', 3.5); }
    }
    const btn = $('ctxBtn');
    if (ctx && slow && !this.busy) {
      btn.classList.remove('hidden');
      btn.textContent = ctx.kind === 'pump' ? '⛽ REFUEL' : '🍲 REST';
      this.ctx = ctx;
    } else if (!this.busy) { btn.classList.add('hidden'); this.ctx = null; }
    if (ctx && !slow && !this.busy && Math.abs(t.v) < 4) this.msg(ctx.kind === 'pump' ? 'Stop the truck to refuel' : 'Stop the truck to rest', 0.5);
    if (this.busy) {
      this.busyT -= dt;
      if (this.busy === 'pump') { this.fuel = Math.min(100, this.fuel + dt * 45); if (this.fuel >= 100 || this.busyT <= 0) { this.busy = false; this.msg('⛽ Tank full! (' + Math.round(this.refuelL) + ' litres)', 2.5); this.app.audio.chime(true); } }
      if (this.busy === 'dhaba') {
        const k = this.busyT > 1.2 ? 1 - (this.busyT - 1.2) / 0.8 : this.busyT / 1.2;
        $('blink').style.opacity = clamp(k, 0, 1);
        if (this.busyT < 1.3 && this.tired > 0) { this.tired = 0; }
        if (this.busyT <= 0) { this.busy = false; $('blink').style.opacity = 0; this.msg('🍲 Dal, roti and chai! You feel fresh again.', 3); this.app.audio.chime(true); }
      }
      btn.classList.add('hidden');
    }
  }
  useContext() {
    if (!this.ctx || this.busy) return;
    if (this.ctx.kind === 'pump') { this.busy = 'pump'; this.busyT = 4; this.refuelL = (100 - this.fuel) * 3.5; this.msg('⛽ Refuelling…', 2); }
    else { this.busy = 'dhaba'; this.busyT = 2.0; }
    this.app.audio.click();
  }

  _parking(dt) {
    const r = this.route, t = this.truck;
    const bar = $('parkBar');
    if (Math.abs(r.bayS - this.s) > 80) { bar.classList.add('hidden'); return; }
    const bay = r.bay;
    const c = r.pos(bay.s, bay.d, {});
    const F = [Math.sin(c.h), Math.cos(c.h)], L = [Math.cos(c.h), -Math.sin(c.h)];
    let inside = true, worst = 0;
    const boxes = truckBoxes(t, this.model);
    for (const b of boxes) for (const q of boxCorners(b)) {
      const dx = q[0] - c.x, dz = q[1] - c.z;
      const lf = Math.abs(dx * F[0] + dz * F[1]) - bay.l / 2, ll = Math.abs(dx * L[0] + dz * L[1]) - bay.w / 2;
      if (lf > 0 || ll > 0) inside = false;
      worst = Math.max(worst, lf, ll);
    }
    if (inside) {
      bar.classList.remove('hidden');
      if (Math.abs(t.v) < 0.25) this.parkT += dt; else this.parkT = Math.max(0, this.parkT - dt);
      $('parkFill').style.width = clamp(this.parkT / 1.5 * 100, 0, 100) + '%';
      if (this.parkT >= 1.5) {
        // accuracy: lateral offset of the truck box centre + angle error
        const b = boxes[0];
        const dx = b.x - c.x, dz = b.z - c.z;
        const lat = Math.abs(dx * L[0] + dz * L[1]);
        const ang = Math.abs(wrapAngle(t.heading - c.h)) * 180 / Math.PI;
        const angT = boxes[1] ? Math.abs(wrapAngle(boxes[1].h - c.h)) * 180 / Math.PI : ang;
        this.parkAcc = clamp(1 - (lat / 1.1) * 0.5 - (Math.max(ang, angT) / 12) * 0.5, 0, 1);
        this._end('win');
      }
    } else { bar.classList.add('hidden'); this.parkT = 0; if (Math.abs(t.v) < 0.3 && Math.abs(r.bayS - this.s) < 40 && this.d > 6) this.msg('Get the whole truck inside the yellow lines', 0.6); }
  }

  // ---------------------------------------------------------------
  _collisions() {
    const t = this.truck, r = this.route;
    const boxes = truckBoxes(t, this.model);
    const vt = { x: Math.sin(t.heading) * t.v, z: Math.cos(t.heading) * t.v };
    const hit = (info) => {
      if (info.speed > 1.25) { this._accident(info); return true; }
      // gentle touch: push back
      t.x -= info.nx * Math.min(0.3, info.depth); t.z -= info.nz * Math.min(0.3, info.depth);
      t.v *= -0.15;
      if (info.other && !info.other.wreck) { info.other.v = 0; }
      return false;
    };
    // vehicles
    for (const ob of this.traffic.boxes()) {
      for (const tb of boxes) {
        const c = boxBox(tb, ob);
        if (!c) continue;
        const vo = this.traffic.velocityOf(ob.ref);
        const closing = (vt.x - vo.x) * c.nx + (vt.z - vo.z) * c.nz;
        if (hit({ kind: 'vehicle', other: ob.ref, speed: Math.max(0, closing), nx: c.nx, nz: c.nz, px: c.px, pz: c.pz, depth: c.depth, part: tb.part })) return;
      }
    }
    // static objects
    for (const col of this.world.collidersNear(this.s)) {
      for (const tb of boxes) {
        const c = circleBox(col.x, col.z, col.r, tb);
        if (!c) continue;
        const closing = vt.x * c.nx + vt.z * c.nz;
        if (hit({ kind: col.kind, speed: Math.max(0, closing), nx: c.nx, nz: c.nz, px: c.px, pz: c.pz, depth: c.depth, part: tb.part })) return;
      }
    }
    // walls / barriers / buildings beside the road
    for (const tb of boxes) for (const q of boxCorners(tb)) {
      const p = r.project(q[0], q[1], this.hint, {});
      const lim = p.d > 0 ? r.limL[p.i] : r.limR[p.i];
      if (Math.abs(p.d) > lim) {
        const h = r.h[p.i];
        const sg = Math.sign(p.d);
        const nx = Math.cos(h) * sg, nz = -Math.sin(h) * sg;
        const closing = vt.x * nx + vt.z * nz;
        const kind = r.hillAmt[p.i] > 0.5 ? (sg === r.hillSide[p.i] ? 'rock wall' : 'crash barrier') : 'building';
        if (hit({ kind, speed: Math.max(0, closing), nx, nz, px: q[0], pz: q[1], depth: Math.abs(p.d) - lim, part: tb.part })) return;
      }
    }
  }

  _accident(info) {
    const t = this.truck, app = this.app, m = this.model;
    this.state = 'crash';
    app.controls.enabled = false;
    $('ctxBtn').classList.add('hidden'); $('parkBar').classList.add('hidden'); $('warn').style.display = 'none';
    const intensity = clamp(info.speed / 12, 0.35, 1.6) * clamp(Math.sqrt(t.mass / 15000), 0.6, 1.5);
    const y = t.y + 1.2;
    const T = this.simT;
    this.crash = { info, T, intensity, t: 0, real: 0, px: info.px, py: y, pz: info.pz };
    this.rec.keepAll = true;
    this.traffic.frozen = true;
    this.dented = true;
    // truck goes into wreck mode
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
    let vx = fx * t.v, vz = fz * t.v;
    const other = info.other;
    if (other) {
      const mo = other.mass, mt = t.mass;
      const vo = this.traffic.velocityOf(other);
      const rel = info.speed;
      // impulse along normal
      const J = (1 + 0.2) * rel / (1 / mt + 1 / mo);
      vx -= info.nx * J / mt; vz -= info.nz * J / mt;
      const dvo = J / mo;
      const small = mo < 2500;
      other.wreck = { vx: vo.x + info.nx * dvo, vz: vo.z + info.nz * dvo, vy: small ? Math.min(9, dvo * 0.35) : Math.min(3, dvo * 0.1), y: 0, w: (Math.random() - 0.5) * Math.min(6, dvo * 0.4), roll: 0, rollV: small ? (Math.random() < 0.5 ? -1 : 1) * Math.min(12, dvo * 0.6) : 0, pitch: 0, pitchV: small ? (Math.random() - 0.5) * dvo * 0.3 : 0, hint: -1 };
      this.rec.track(other.mesh);
      dentMesh(other.mesh, new THREE.Vector3(info.px, y - 0.4, info.pz), new THREE.Vector3(info.nx, 0, info.nz), clamp(rel * 0.06, 0.15, 0.7), 1.8);
      other.mesh.rotation.order = 'YXZ';
    } else if (info.kind !== 'rollover') {
      // solid object: bounce back
      const vn = vx * info.nx + vz * info.nz;
      vx -= 1.25 * vn * info.nx; vz -= 1.25 * vn * info.nz;
    }
    // track all nearby traffic for the replay
    for (const o of this.traffic.list) this.rec.track(o.mesh);
    for (const cO of this.traffic.crossers) this.rec.track(cO.mesh);
    const rollover = info.kind === 'rollover' || (intensity > 1.0 && this.truck.cogH > 2.0 && Math.random() < 0.6);
    t.wreck = { vx, vz, w: (Math.random() - 0.5) * 0.8 * intensity + (info.kind === 'rollover' ? 0 : 0), roll: t.rollVis, rollV: 0, rollTarget: rollover ? Math.sign(t.latAcc || 1) * Math.PI / 2 * 0.97 : t.rollVis * 2, rollover };
    // dents on the truck
    const dir = new THREE.Vector3(-info.nx, 0, -info.nz);
    const pt = new THREE.Vector3(info.px, y, info.pz);
    if (info.part === 'trailer' && m.trailer) dentMesh(m.trailer.body, pt, dir, clamp(info.speed * 0.05, 0.1, 0.6), 2.2);
    else { dentMesh(m.cabShell, pt, dir, clamp(info.speed * 0.06, 0.12, 0.8), 2.0); dentMesh(m.body, pt, dir, clamp(info.speed * 0.04, 0.08, 0.5), 2.0); }
    // effects
    const fxr = this.fx;
    fxr.sparkBurst(T, info.px, y - 0.3, info.pz, -info.nx, -info.nz, intensity, Math.round(70 + 90 * Math.min(1, intensity)));
    fxr.sparkBurst(T + 0.25, info.px, y - 0.6, info.pz, info.nx, info.nz, intensity * 0.6, 50);
    fxr.puffs(T, info.px, y, info.pz, 14, { color: '#bdb6a8', size: 2.4, grow: 5, life: 2.4, alpha: 0.55 });
    fxr.emitter(T + 0.3, m.root, new THREE.Vector3(0, 2.2, m.cabFront - 0.5), { color: '#3a3a3a', rate: 7, life: 3.2, size: 1.2, grow: 2.6, rise: 2.8, alpha: 0.6 });
    const hazmat = this.cargo.id === 'fuel';
    if (hazmat || (intensity > 1.2 && Math.random() < 0.3)) {
      const src = m.trailer ? m.trailer.group : m.root;
      fxr.fireball(T + 0.15, info.px, y, info.pz, hazmat ? 9 : 4);
      fxr.emitter(T + 0.2, src, new THREE.Vector3(0, 3, m.trailer ? -m.trailer.length / 2 : 0), { color: '#ff7a1a', additive: true, rate: 14, life: 1.1, size: 2.4, grow: 1.5, rise: 3.5, alpha: 0.9, spread: 3 });
      fxr.emitter(T + 0.4, src, new THREE.Vector3(0, 5, m.trailer ? -m.trailer.length / 2 : 0), { color: '#222', rate: 6, life: 4, size: 3, grow: 4, rise: 4, alpha: 0.6 });
      app.audio.explosion();
    }
    // debris
    const db = this.debris;
    const n = Math.round(10 + 18 * Math.min(1.3, intensity));
    const rnd = () => Math.random() - 0.5;
    for (let k = 0; k < n; k++) {
      const kind = k % 3 === 0 ? 'shard' : k % 3 === 1 ? 'panel' : (k % 6 === 2 ? 'bumper' : 'shard');
      const col = kind === 'panel' ? (k % 2 ? this.spec.color : (other ? '#9e9e9e' : '#888')) : null;
      const sp = 3 + Math.random() * 9 * intensity;
      this.rec.track(db.spawn(kind, info.px + rnd(), y + rnd(), info.pz + rnd(), -info.nx * sp * 0.5 + rnd() * sp, 2 + Math.random() * 5 * intensity, -info.nz * sp * 0.5 + rnd() * sp, col));
    }
    if (intensity > 0.7 && Math.random() < 0.5) this.rec.track(db.spawn('tyre', info.px, y, info.pz, rnd() * 8, 5, rnd() * 8));
    // cargo spill
    if (rollover || intensity > 0.8) this._spill(intensity, vx, vz);
    // screen effects
    this.rig.shake = clamp(intensity, 0.4, 1.4);
    const fl = $('flash'); fl.style.transition = 'none'; fl.style.opacity = 0.95; void fl.offsetWidth; fl.style.transition = 'opacity 0.6s'; fl.style.opacity = 0;
    if (this.rig.view === 'driver' && info.kind !== 'rollover') {
      const cv = $('cracks'); cv.style.display = 'block';
      drawCracks(cv, 0.35 + Math.random() * 0.3, 0.3 + Math.random() * 0.25, (T * 1000) | 0);
    }
    app.audio.crash(intensity);
    if (navigator.vibrate) try { navigator.vibrate([80, 40, 160]); } catch (e) { /* */ }
    const names = { vehicle: other ? ({ car: 'a car', suv: 'an SUV', bus: 'a bus', auto: 'an auto-rickshaw', bike: 'a motorbike', truck: 'a truck', tractor: 'a tractor' }[other.type] || 'a vehicle') : 'a vehicle',
      tree_avenue: 'a tree', tree_round: 'a tree', tree_neem: 'a tree', tree_palm: 'a palm tree', tree_khejri: 'a tree', pole: 'a pole', epole: 'an electric pole', signal: 'a traffic signal', cow: 'a cow', gate: 'the border gate', wall: 'a wall', pump: 'the pump canopy', building: 'a building', kmstone: 'a km stone', rock: 'a rock' };
    this.crashWhat = info.kind === 'rollover' ? 'Your truck rolled over on a sharp turn!' : 'You crashed into ' + (names[info.kind] || names[info.other ? 'vehicle' : 'wall'] || 'the ' + info.kind) + (other && this.traffic.velocityOf(other) && info.part === 'trailer' ? ' (with your trailer)' : '') + '!';
    this.crashStats = { kmh: Math.round(info.speed * 3.6), tons: (t.mass / 1000).toFixed(1), cargoLost: rollover || intensity > 0.8 ? 100 : Math.round(30 + 50 * Math.min(1, intensity)) };
    app.audio.update(0, { rpm: 0, load: 0, throttle: 0, boost: 0, jake: 0, engineOn: false, speed: 0, offroad: false, ambient: 0.2, screech: 0, reverse: false });
  }

  _spill(intensity, vx, vz) {
    const m = this.model, db = this.debris, cg = this.cargo;
    const holder = m.trailer ? m.trailer : null;
    const src = holder ? holder.group : m.root;
    src.updateMatrixWorld();
    const base = new THREE.Vector3(0, holder ? holder.deckY + 1 : 2.2, holder ? -holder.length / 2 : m.rearZ / 2).applyMatrix4(src.matrixWorld);
    const kinds = { boxes: 'box', ore: 'rock', logs: 'log', cars: 'car', coils: 'coil', bags: 'bag', veg: 'veg', fire: 'drum', milk: 'drum' };
    const kind = kinds[cg.spill] || 'box';
    const N = { box: 14, rock: 26, log: 7, car: 3, coil: 3, bag: 16, veg: 30, drum: 4 }[kind];
    const cols = ['#e8a317', '#3f9b2a', '#d12f2f', '#f2c12e', '#8bc34a'];
    for (let k = 0; k < N; k++) {
      const rnd = () => Math.random() - 0.5;
      const len = holder ? holder.length : 5;
      const p = base.clone().add(new THREE.Vector3(rnd() * 2, Math.random() * 1.5, rnd() * len * 0.6));
      const col = kind === 'veg' ? cols[k % cols.length] : kind === 'car' ? ['#d7263d', '#f4f4f4', '#1b998b'][k % 3] : null;
      this.rec.track(this.debris.spawn(kind, p.x, p.y, p.z, vx * 0.7 + rnd() * 6 * intensity, 2 + Math.random() * 4, vz * 0.7 + rnd() * 6 * intensity, col));
    }
    if (holder) holder.cargoGroup.visible = kind === 'drum' ? true : false;
    else m.cargoGroup.visible = false;
  }

  _crashUpdate(dtReal) {
    const c = this.crash;
    c.real += dtReal;
    // hit-stop then ramp to slow-mo then normal
    const ts = c.real < 0.35 ? 0.12 : c.real < 1.0 ? lerp(0.12, 0.7, (c.real - 0.35) / 0.65) : 1;
    const dt = dtReal * ts;
    this.simT += dt; c.t += dt;
    this._wreckPhysics(dt);
    this.debris.update(dt);
    this.rec.sample(this.simT, { T: this.simT });
    this.fx.update(this.simT);
    this.rig.update(dtReal, this.truck, this.model, c.real < 0.6 ? 0.6 * c.intensity : 0);
    if (c.t > 3.0) this._startReplay();
  }

  _wreckPhysics(dt) {
    const t = this.truck, w = t.wreck, m = this.model, r = this.route;
    if (w) {
      const sp = Math.hypot(w.vx, w.vz);
      const dec = Math.min(sp, (w.rollover ? 7 : 5) * dt);
      if (sp > 0) { w.vx -= w.vx / sp * dec; w.vz -= w.vz / sp * dec; }
      t.x += w.vx * dt; t.z += w.vz * dt;
      t.heading += w.w * dt; w.w *= Math.exp(-dt * 1.5);
      // roll with a spring
      const kk = w.rollover ? 9 : 40;
      w.rollV += ((w.rollTarget - w.roll) * kk - w.rollV * (w.rollover ? 1.5 : 8)) * dt;
      w.roll += w.rollV * dt;
      if (w.rollover && Math.abs(w.roll) > Math.abs(w.rollTarget)) { w.roll = w.rollTarget; w.rollV *= -0.3; }
      const p = r.project(t.x, t.z, this.hint, {}); this.hint = p.i;
      const y = r.groundY(t.x, t.z, this.hint);
      m.root.position.set(t.x, y + Math.abs(Math.sin(w.roll)) * t.spec.width * 0.45, t.z);
      m.root.rotation.set(0, t.heading, w.roll, 'YXZ');
      // trailer follows (jack-knifes)
      if (m.trailer) {
        const v = w.vx * Math.sin(t.heading) + w.vz * Math.cos(t.heading);
        const rel = wrapAngle(t.heading - t.trailerH);
        t.trailerH = wrapAngle(t.trailerH + (v * Math.sin(rel) / t.Lt) * dt * 1.5);
        const r2 = wrapAngle(t.heading - t.trailerH);
        if (Math.abs(r2) > 1.2) t.trailerH = wrapAngle(t.heading - Math.sign(r2) * 1.2);
        const hp = t.hitchPos();
        const yH = r.groundY(hp.x, hp.z, this.hint);
        m.trailer.group.position.set(hp.x, yH + Math.abs(Math.sin(w.roll)) * t.spec.width * 0.45, hp.z);
        m.trailer.group.rotation.set(0, t.trailerVisH(), w.roll * (w.rollover ? 1 : 0.5), 'YXZ');
      }
    }
    for (const o of [...this.traffic.list, ...this.traffic.crossers]) {
      const k = o.wreck; if (!k) continue;
      const sp = Math.hypot(k.vx, k.vz);
      const onGround = k.y <= 0.001;
      const dec = Math.min(sp, (onGround ? 6 : 0.5) * dt);
      if (sp > 0) { k.vx -= k.vx / sp * dec; k.vz -= k.vz / sp * dec; }
      o.x += k.vx * dt; o.z += k.vz * dt;
      k.vy -= 9.81 * dt; k.y += k.vy * dt;
      if (k.y < 0) { k.y = 0; k.vy = Math.abs(k.vy) > 2 ? -k.vy * 0.3 : 0; k.rollV *= 0.6; k.pitchV *= 0.6; }
      k.roll += k.rollV * dt; k.pitch += k.pitchV * dt;
      if (onGround && Math.abs(k.vy) < 0.1) {
        // settle on side or wheels
        const tgt = Math.round(k.roll / (Math.PI / 2)) * Math.PI / 2;
        k.roll += (tgt - k.roll) * Math.min(1, dt * 5);
        const tp = Math.round(k.pitch / Math.PI) * Math.PI;
        k.pitch += (tp - k.pitch) * Math.min(1, dt * 5);
      }
      o.h += k.w * dt; k.w *= Math.exp(-dt * 1.2);
      const p = r.project(o.x, o.z, k.hint, {}); k.hint = p.i;
      const gy = r.groundY(o.x, o.z, k.hint);
      o.mesh.position.set(o.x, gy + k.y + Math.abs(Math.sin(k.roll)) * o.wid * 0.5, o.z);
      o.mesh.rotation.set(k.pitch, o.h, k.roll, 'YXZ');
    }
  }

  _startReplay() {
    const c = this.crash;
    this.state = 'replay';
    this.rec.keepAll = true;
    this.replay = { T0: Math.max(this.rec.t0, c.T - 2.2), T1: Math.min(this.rec.t1, c.T + 2.6), u: 0 };
    this.replay.T = this.replay.T0;
    $('cracks').style.display = 'none';
    this.app.showScreen('replayUI');
    this.app.hud(false);
  }
  _replayUpdate(dt) {
    const rp = this.replay, c = this.crash;
    const rate = Math.abs(rp.T - c.T) < 0.8 ? 0.35 : 0.6;
    rp.T += dt * rate;
    const dur = rp.T1 - rp.T0;
    const u = clamp((rp.T - rp.T0) / dur, 0, 1);
    this.rec.apply(rp.T);
    this.fx.update(rp.T);
    const phase = Math.min(2, Math.floor(u * 3));
    const names = ['Low angle', 'Orbit cam', 'Top view'];
    $('replayAngle').textContent = 'Angle ' + (phase + 1) + ' • ' + names[phase];
    const tgt = this.model.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const q = this.model.root.quaternion;
    const hd = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    this.rig.replay({ x: c.px, y: c.py, z: c.pz, h: hd }, tgt, phase, (u * 3) % 1);
    this.model.cabShell.visible = true; this.model.interior.visible = false;
    if (u >= 1) this._end('crash');
  }
  skipReplay() { if (this.state === 'replay') this._end('crash'); }

  _overUpdate(dt) {
    // slow orbit around the scene behind the end screen
    this.orbit = (this.orbit || 0) + dt * 0.15;
    const p = this.model.root.position;
    this.camera.position.set(p.x + Math.sin(this.orbit) * 22, p.y + 9, p.z + Math.cos(this.orbit) * 22);
    this.camera.lookAt(p.x, p.y + 1, p.z);
    this.fx.update(this.simT += dt);
    this.debris.update(dt);
  }

  _end(kind) {
    const app = this.app;
    this.state = 'over';
    app.controls.enabled = false;
    $('ctxBtn').classList.add('hidden'); $('parkBar').classList.add('hidden'); $('warn').style.display = 'none';
    $('vignette').style.opacity = 0; this.app.canvas.style.filter = '';
    $('cracks').style.display = 'none';
    app.hud(false);
    app.audio.update(0, { rpm: 0, load: 0, throttle: 0, boost: 0, jake: 0, engineOn: false, speed: 0, offroad: false, ambient: 0.3, screech: 0, reverse: false });
    app.audio.hornOff();
    const t = this.truck;
    const km = (t.odometer / 1000).toFixed(1);
    const fuelUsed = (this.fuelUsedTotal || 0);
    if (kind === 'win') {
      const est = this.route.estSec;
      const timeScore = this.tripT <= est ? 1 : this.tripT <= est * 1.35 ? 0.7 : 0.4;
      const safe = clamp(1 - this.redLights * 0.2 - this.offroadT / 40 - (100 - this.cargoCond) / 200, 0, 1);
      const park = this.parkAcc ?? 0.5;
      let score = (timeScore + safe + park) / 3;
      if (this.cargo.timed && this.tripT > est * 1.25) score -= 0.2;
      const stars = clamp(Math.round(score * 3), 1, 3);
      const pay = Math.round(this.route.realKm * this.cargo.pay * (this.cargoCond / 100) * (0.6 + stars * 0.2));
      $('stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
      $('winBody').innerHTML = `<p class="reason">${this.cargo.icon} ${this.cargo.name} delivered to ${this.route.to.name}!</p>
        <div class="kv">
          <div><small>Time taken</small><b>${fmtTime(this.tripT)}</b></div>
          <div><small>Distance</small><b>${km} km</b></div>
          <div><small>Fuel used</small><b>${Math.round(this._fuelL())} L</b></div>
          <div><small>Cargo condition</small><b>${Math.round(this.cargoCond)}%</b></div>
          <div><small>Speed</small><b>${'★'.repeat(Math.round(timeScore * 3))}</b></div>
          <div><small>Safe driving</small><b>${'★'.repeat(Math.max(0, Math.round(safe * 3)))}</b></div>
          <div><small>Parking</small><b>${'★'.repeat(Math.max(0, Math.round(park * 3)))}</b></div>
          <div><small>Earnings</small><b>₹${pay.toLocaleString('en-IN')}</b></div>
        </div>`;
      app.audio.chime(true);
      setTimeout(() => app.audio.chime(true), 400);
      app.showScreen('win');
    } else {
      const reasons = { crash: '💥 Accident! ' + this.crashWhat, fuel: '⛽ Out of diesel! The truck stopped on the road.' };
      $('overReason').textContent = reasons[kind];
      const cs = this.crashStats;
      $('overCard').innerHTML = (kind === 'crash' ? `<div class="crashcard">Impact ${cs.kmh} km/h • ${cs.tons} t • Cargo lost ${cs.cargoLost}%</div>` : '') +
        `<div class="kv"><div><small>Time</small><b>${fmtTime(this.tripT)}</b></div><div><small>Distance driven</small><b>${km} km</b></div><div><small>Left to go</small><b>${Math.max(0, (this.route.bayS - this.s) / 1000).toFixed(1)} km</b></div></div>`;
      app.showScreen('over');
    }
  }
  _fuelL() { return this.fuelUsedL || 0; }

  // ---------------------------------------------------------------
  _intro(dt) {
    this.introT += dt;
    const m = this.model, t = this.truck;
    const cg = m.trailer ? m.trailer.cargoGroup : m.cargoGroup;
    const T = this.introT;
    const drop = clamp((T - 0.3) / 1.2, 0, 1);
    const bounce = drop < 1 ? (1 - drop) * (1 - drop) * 7 : Math.max(0, Math.sin((T - 1.5) * 12) * 0.25 * Math.exp(-(T - 1.5) * 4));
    cg.position.y = bounce;
    const a = 0.8 + T * 0.4;
    const L = this.totalLen;
    this.camera.position.set(t.x + Math.sin(t.heading + a) * (L + 8), t.y + 5 + L * 0.15, t.z + Math.cos(t.heading + a) * (L + 8));
    const mid = this.model.trailer ? -L * 0.3 : 0;
    this.camera.lookAt(t.x + Math.sin(t.heading) * mid, t.y + 1.8, t.z + Math.cos(t.heading) * mid);
    if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
    this.world.updateSignals(0);
    $('loadTxt').textContent = T < 1.6 ? 'Loading ' + this.cargo.name.toLowerCase() + '…' : 'Loaded! Get ready…';
    if (T > 2.6) {
      cg.position.y = 0;
      this.state = 'drive';
      this.app.controls.enabled = true;
      $('loading').classList.add('hidden');
      this.app.hud(true);
      this.msg('🚚 ' + this.route.from.name + ' → ' + this.route.to.name + ' • Keep LEFT!', 3.5);
      this.rig.inited = false;
      this.app.audio.airBrake();
    }
  }

  // ---------------------------------------------------------------
  _fatigueFx(dt) {
    const f = this.tired / 100;
    const v = $('vignette');
    if (f > 0.6) {
      const k = (f - 0.6) / 0.4;
      const pulse = 0.5 + 0.5 * Math.sin(this.simT * 1.7);
      v.style.opacity = (0.25 + 0.6 * k) * (0.7 + 0.3 * pulse);
      const blur = (0.6 + 2.6 * k) * pulse;
      this.app.canvas.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : '';
      // micro-sleep blinks when very tired
      if (f > 0.85) {
        this.blinkT = (this.blinkT ?? 3) - dt;
        if (this.blinkT < 0) { this.blinkT = 3 + Math.random() * 3; this.blinkDur = 0.45; }
        if (this.blinkDur > 0) { this.blinkDur -= dt; $('blink').style.opacity = Math.sin(Math.max(0, this.blinkDur) / 0.45 * Math.PI) * 0.9; }
      }
    } else if (!this.busy) {
      v.style.opacity = 0; if (this.app.canvas.style.filter) this.app.canvas.style.filter = '';
    }
  }

  _audio(dt) {
    const t = this.truck, a = this.app.audio;
    const zone = this.route.zoneAt(this.s).type;
    const loadF = clamp(t.throttle * (0.5 + 0.5 * t.boost) + Math.max(0, Math.sin(Math.atan((this.route.y[this.route.idx(this.s) + 1] - this.route.y[this.route.idx(this.s)]) / STEP))) * 3, 0, 1);
    a.update(dt, {
      rpm: t.rpm, load: loadF, throttle: t.throttle, boost: t.boost, jake: t.jake, engineOn: t.engineOn,
      speed: Math.abs(t.v), offroad: t.offroad, ambient: zone === 'city' ? 1 : zone === 'industrial' ? 0.6 : 0.3,
      screech: (Math.abs(t.latAcc) > t.aRoll * 0.8 ? (Math.abs(t.latAcc) / t.aRoll - 0.8) * 3 : 0) + (t.brake > 0.8 && Math.abs(t.v) > 12 ? 0.5 : 0),
      reverse: t.gear === 'R',
    });
    // air brake release when coming to a stop
    const stopped = Math.abs(t.v) < 0.05;
    if (stopped && !this.wasStopped && t.brake > 0.3) a.airBrake();
    this.wasStopped = stopped;
    // fuel litres used (for the stats): ~3.5 L per % of tank
    this.fuelUsedL = (this.fuelUsedL || 0) + t.fuelBurn(dt) * 3.5;
  }

  // ---------- debug helpers (only used by tests with ?debug=1) ----------
  teleport(s, d = 1.75, v = 0) {
    const r = this.route, p = r.pos(s, d, {});
    const t = this.truck;
    t.x = p.x; t.z = p.z; t.heading = p.h; t.trailerH = p.h; t.v = v; t.steer = 0;
    this.hint = r.idx(s); this.s = s; this.prevS = s; this.d = d;
    this.world.update(s, true);
    this.traffic.list.slice().forEach((o) => this.traffic.remove(o));
    this.traffic.populate(s);
    this.borderIdx = r.borders.filter((b) => b.s < s).length;
    this._placeModel(0);
    this.rig.inited = false;
  }
  _autopilot(c) {
    const r = this.route, t = this.truck;
    const target = this.autoD ?? 1.75;
    const look = this.s + 8 + Math.abs(t.v) * 0.9;
    const p = r.pos(look, target, {});
    const want = Math.atan2(p.x - t.x, p.z - t.z);
    const err = wrapAngle(want - t.heading);
    c.wheelDeg = clamp(-err * 900, -450, 450);
    c.steer = c.wheelDeg / 450;
    const vT = (this.autoV ?? 50) / 3.6;
    const kAhead = Math.abs(r.k[r.idx(this.s + 40)]);
    const vCurve = Math.sqrt(t.aRoll * 0.6 / Math.max(kAhead, 1e-4));
    const v = Math.min(vT, vCurve);
    c.throttle = t.v < v - 1 ? 1 : 0;
    c.brake = t.v > v + 2 ? 0.6 : 0;
  }

  hudData() {
    const t = this.truck, r = this.route;
    const left = Math.max(0, (r.bayS - this.s) / 1000);
    // direction arrow: heading of road ahead relative to truck heading
    let ang;
    if (r.bayS - this.s < 250) {
      const b = r.pos(r.bay.s, r.bay.d, {});
      ang = wrapAngle(Math.atan2(b.x - t.x, b.z - t.z) - t.heading);
    } else ang = wrapAngle(r.heading(this.s + 160) - t.heading);
    let next = '';
    const pump = r.pumps.find((p) => p.s > this.s - 10), dh = r.dhabas.find((p) => p.s > this.s - 10);
    const want = this.fuel < 45 ? 'pump' : this.tired > 45 ? 'dhaba' : (pump && dh ? (pump.s < dh.s ? 'pump' : 'dhaba') : pump ? 'pump' : 'dhaba');
    if (want === 'pump' && pump) next = '⛽ ' + ((pump.s - this.s) / 1000).toFixed(1);
    else if (dh) next = '🍲 ' + ((dh.s - this.s) / 1000).toFixed(1);
    else if (pump) next = '⛽ ' + ((pump.s - this.s) / 1000).toFixed(1);
    return { speed: Math.round(t.speedKmh), gear: t.gear === 'D' ? 'D' + t.dg : t.gear, fuel: this.fuel, tired: this.tired, cargo: this.cargoCond, left, ang, next, limit: t.limitKmh };
  }
}
