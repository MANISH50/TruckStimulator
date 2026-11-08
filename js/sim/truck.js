// Heavy truck physics: torque curve + automatic gearbox + turbo, brakes,
// drag, hills, kinematic steering (bicycle model), rollover risk and an
// articulated trailer that swings on turns.
import { clamp, lerp, wrapAngle } from '../util.js';

const G = 9.81;
const IDLE = 650, REDLINE = 2400;
// normalised diesel torque curve: strong low-down torque
function torqueCurve(rpm) {
  const pts = [[500, 0.5], [800, 0.78], [1100, 0.97], [1300, 1.0], [1700, 1.0], [2000, 0.9], [2300, 0.72], [2500, 0.4]];
  if (rpm <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (rpm < pts[i][0]) {
    const [r0, t0] = pts[i - 1], [r1, t1] = pts[i];
    return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
  }
  return 0.4;
}

export class Truck {
  constructor(spec, cargo, governorOn) {
    this.spec = spec;
    this.cargo = cargo;
    this.cargoMass = cargo.mass * spec.capacity;
    this.mass = spec.mass + this.cargoMass;
    this.refMass = spec.mass + 0.5 * spec.capacity * 15000;
    this.governorOn = governorOn;
    const limits = [];
    if (governorOn) { limits.push(spec.governor); if (cargo.cap) limits.push(cargo.cap); }
    this.limitKmh = limits.length ? Math.min(...limits) : null;
    this.vTop = spec.vmax / 3.6;                // m/s at redline in top gear
    this.F1 = this.refMass * spec.a1;           // peak force in 1st gear
    this.nGears = 6;
    this.cogH = (spec.id === 'mini' ? 1.0 : 1.35) + cargo.cog * Math.min(1, spec.capacity + 0.2);
    this.track = spec.width * 0.82;
    this.aRoll = G * (this.track / 2) / this.cogH;      // lateral accel that tips the truck
    this.CdA = spec.id === 'mini' ? 4.5 : spec.id === 'express' ? 6.0 : spec.id === 'turbo' ? 6.5 : 8.0;
    // engine power: enough to reach top speed with margin (good mid-range pickup)
    const vt = this.vTop, crr0 = 0.008;
    this.Pmax = (0.5 * 1.2 * this.CdA * vt * vt + crr0 * this.refMass * G) * vt * (spec.pmul || 1.5);
    this.bmax = spec.brake * Math.pow(spec.mass / this.mass, 0.3) * (cargo.id === 'steel' ? 0.85 : 1);
    this.L = spec.wheelbase;
    this.hasTrailer = spec.trailer > 0;
    this.Lt = 0; // set by model (kingpin -> trailer axle)
    this.hitch = 0.3;
    this.reset(0, 0, 0);
  }

  reset(x, z, h) {
    this.x = x; this.z = z; this.y = 0; this.heading = h;
    this.v = 0; this.steer = 0; this.yawRate = 0; this.prevYawRate = 0;
    this.gear = 'D'; this.dg = 1; this.rpm = IDLE; this.boost = 0; this.shiftT = 0;
    this.throttle = 0; this.brake = 0; this.engineOn = true;
    this.trailerH = h; this.sway = 0; this.swayV = 0;
    this.latAcc = 0; this.longAcc = 0; this.tip = 0; this.rollVis = 0; this.pitchVis = 0;
    this.slosh = 0; this.sloshV = 0;
    this.offroad = false; this.shiftEvent = 0; this.jake = 0; this.wheelSpin = 0;
    this.odometer = 0; this.fuelUsed = 0; this.gust = 0; this.gustT = 0;
  }

  get speedKmh() { return Math.abs(this.v) * 3.6; }
  get gearLabel() { return this.gear === 'D' ? 'D' + this.dg : this.gear; }

  maxSteerAt(v) {
    // stability assist: limits steering so full lock at speed is only slightly above the tipping point
    const av = Math.abs(v);
    if (av < 4) return this.spec.maxSteer;
    const aLim = this.aRoll * 1.3;
    return Math.min(this.spec.maxSteer, Math.atan(this.L * aLim / (av * av)));
  }

  update(dt, inp, env) {
    const s = this.spec;
    // ---------- steering (heavy, rate limited) ----------
    const target = -inp.steer * this.maxSteerAt(this.v);
    const rate = 1.4;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    // ---------- pedals ----------
    this.throttle = this.engineOn ? inp.throttle : 0;
    this.brake = inp.brake;
    if (inp.gear !== this.gear) { this.gear = inp.gear; if (this.gear === 'D') this.dg = 1; }

    // ---------- engine & gearbox ----------
    const q = s.q;
    const ratio = (g) => Math.pow(q, this.nGears - g); // relative to top gear
    let wheelRpm; // rpm the engine would have from wheel speed
    let drive = 0;
    const av = Math.abs(this.v);
    if (this.gear === 'D') {
      wheelRpm = REDLINE * (av / this.vTop) * ratio(this.dg);
      if (this.shiftT <= 0) {
        const up = 1550 + 650 * this.throttle;
        const down = 950 + 300 * this.throttle;
        if (wheelRpm > up && this.dg < this.nGears) { this.dg++; this.shiftT = s.fast ? 0.16 : 0.24; this.shiftEvent = 1; }
        else if (wheelRpm < down && this.dg > 1) { this.dg--; this.shiftT = 0.18; this.shiftEvent = -1; }
        else if (this.throttle > 0.9 && this.dg > 1 && wheelRpm < 1250 && wheelRpm * q < 2050) { this.dg--; this.shiftT = 0.2; this.shiftEvent = -1; }
      }
      wheelRpm = REDLINE * (av / this.vTop) * ratio(this.dg);
    } else if (this.gear === 'R') {
      wheelRpm = REDLINE * (av / 4.0);
    } else wheelRpm = 0;

    // clutch slip at low speed lets rpm rise with throttle
    const slipRpm = IDLE + this.throttle * 900;
    let rpmT = this.gear === 'N' ? IDLE + this.throttle * 1500 : Math.max(wheelRpm, this.dg === 1 || this.gear === 'R' ? slipRpm : IDLE);
    if (!this.engineOn) rpmT = 0;
    if (this.shiftT > 0) rpmT = lerp(this.rpm, rpmT, 0.5);
    this.rpm += (Math.min(rpmT, REDLINE + 80) - this.rpm) * Math.min(1, dt * 9);
    this.shiftT -= dt;

    // turbo spool
    const bt = this.throttle * clamp((this.rpm - 850) / 700, 0, 1);
    this.boost += (bt - this.boost) * Math.min(1, dt / (bt > this.boost ? 0.55 : 0.2));

    const tq = torqueCurve(this.rpm) * (0.82 + 0.18 * this.boost);
    if (this.engineOn && this.shiftT <= 0) {
      // traction-limited at low speed, power-limited at higher speed
      const powerF = this.Pmax * tq / Math.max(av, 1.5);
      if (this.gear === 'D') drive = Math.min(this.F1 * tq, powerF) * this.throttle;
      else if (this.gear === 'R') drive = -this.F1 * 0.6 * tq * this.throttle;
    }
    // speed limiter (governor) and reverse limiter
    if (this.gear === 'D' && this.limitKmh && this.v * 3.6 > this.limitKmh - 1.5) drive *= clamp((this.limitKmh - this.v * 3.6) / 1.5, 0, 1);
    if (this.gear === 'R' && this.v < -12 / 3.6) drive = 0;
    if (this.gear === 'D' && this.v > this.vTop * 1.02) drive = 0;

    // ---------- resistances ----------
    const m = this.mass;
    const crr = this.offroad ? 0.03 : 0.008;
    const sgn = Math.sign(this.v);
    let F = drive;
    F -= 0.5 * 1.2 * this.CdA * this.v * Math.abs(this.v);
    F -= crr * m * G * sgn;
    F -= m * G * Math.sin(env.slope || 0);
    // engine braking + exhaust brake
    this.jake = 0;
    if (this.gear === 'D' && this.throttle < 0.05 && av > 6 && this.engineOn) {
      F -= m * 0.35 * (this.rpm / REDLINE) * sgn;
      this.jake = clamp((av - 6) / 10, 0, 1) * (this.rpm / REDLINE);
    }
    // wind gusts for tall loads
    if (this.cargo.id === 'container' || this.cargo.id === 'cars') {
      this.gustT -= dt;
      if (this.gustT < 0) { this.gustT = 3 + Math.random() * 5; this.gust = (Math.random() - 0.5) * 0.06 * clamp(av / 20, 0, 1); }
    }
    // tanker slosh: liquid surges back and forth
    const sloshK = 6, sloshC = 1.4;
    if (this.cargo.id === 'fuel' || this.cargo.id === 'milk') {
      this.sloshV += (-sloshK * this.slosh - sloshC * this.sloshV - this.longAcc) * dt;
      this.slosh += this.sloshV * dt;
      F += this.cargoMass * 0.35 * sloshK * this.slosh;
    }

    // brakes
    let a = F / m;
    const vPrev = this.v;
    if (this.brake > 0) {
      const bdec = this.bmax * this.brake;
      if (Math.abs(this.v) <= bdec * dt) { this.v = 0; if (Math.abs(a) < bdec) a = 0; }
      else a -= bdec * sgn;
    }
    // static hold when stopped with no drive and small slope
    if (this.v === 0 && drive === 0 && Math.abs(a) < 0.6) a = 0;
    this.v += a * dt;
    if (this.brake > 0 && vPrev !== 0 && Math.sign(this.v) !== Math.sign(vPrev)) this.v = 0;
    this.longAcc = (this.v - vPrev) / Math.max(dt, 1e-4);

    // ---------- yaw / position ----------
    this.prevYawRate = this.yawRate;
    this.yawRate = (this.v / this.L) * Math.tan(this.steer) + this.gust;
    this.latAcc = this.v * this.yawRate;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.x += fx * this.v * dt;
    this.z += fz * this.v * dt;
    this.odometer += Math.abs(this.v) * dt;
    this.wheelSpin += this.v * dt;

    // ---------- rollover risk ----------
    const ratioRoll = Math.abs(this.latAcc) / this.aRoll;
    if (ratioRoll > 1) this.tip += dt * (ratioRoll - 1) * 4.5; else this.tip = Math.max(0, this.tip - dt * 1.5);
    // body leans to the outside of the turn (+ = lean right)
    this.rollVis = lerp(this.rollVis, clamp(this.latAcc / this.aRoll, -1.2, 1.2) * 0.06 + Math.sign(this.latAcc) * this.tip * 0.18, Math.min(1, dt * 6));
    this.pitchVis = lerp(this.pitchVis, clamp(-this.longAcc * 0.006, -0.03, 0.03), Math.min(1, dt * 5));

    // ---------- trailer ----------
    if (this.hasTrailer && this.Lt > 0) {
      const rel = wrapAngle(this.heading - this.trailerH);
      const dpsi = (this.v * Math.sin(rel) + this.hitch * this.yawRate * Math.cos(rel)) / this.Lt;
      this.trailerH = wrapAngle(this.trailerH + dpsi * dt);
      // jack-knife limit
      const r2 = wrapAngle(this.heading - this.trailerH);
      if (Math.abs(r2) > 1.35) this.trailerH = wrapAngle(this.heading - Math.sign(r2) * 1.35);
      // sway: spring-damper excited by changes in yaw rate
      const yawAcc = (this.yawRate - this.prevYawRate) / Math.max(dt, 1e-4);
      const loadF = 0.6 + this.cargoMass / 20000 + this.cargo.cog * 0.4;
      const w0 = 2 * Math.PI * 0.55, zeta = 0.22;
      this.swayV += (-w0 * w0 * this.sway - 2 * zeta * w0 * this.swayV - yawAcc * 0.35 * loadF * clamp(av / 15, 0, 1.5)) * dt;
      this.sway = clamp(this.sway + this.swayV * dt, -0.14, 0.14);
    }
    return { a };
  }

  // fuel (percent) consumption for this frame
  fuelBurn(dt) {
    if (!this.engineOn) return 0;
    const perM = 100 / (this.spec.tank * 1000) * Math.sqrt(this.mass / this.refMass);
    const load = 0.45 + 0.75 * this.throttle * (0.6 + 0.4 * this.boost);
    return Math.abs(this.v) * dt * perM * load + dt * 0.012;
  }

  // world positions of key points
  hitchPos() {
    return { x: this.x + Math.sin(this.heading) * this.hitch, z: this.z + Math.cos(this.heading) * this.hitch };
  }
  trailerVisH() { return this.trailerH + this.sway; }
}

// Oriented boxes (2D) for the truck and trailer, used for collisions & parking.
export function truckBoxes(t, model) {
  const out = [];
  const h = t.heading, fx = Math.sin(h), fz = Math.cos(h);
  const front = model.cabFront + 0.2, rear = model.rearZ;
  const cz = (front + rear) / 2;
  out.push({ x: t.x + fx * cz, z: t.z + fz * cz, h, hl: (front - rear) / 2, hw: t.spec.width / 2 + 0.05, part: 'truck' });
  if (model.trailer) {
    const hp = t.hitchPos();
    const th = t.trailerVisH();
    const tfx = Math.sin(th), tfz = Math.cos(th);
    const tf = model.trailer.front, tb = model.trailer.back;
    const tc = (tf + tb) / 2;
    out.push({ x: hp.x + tfx * tc, z: hp.z + tfz * tc, h: th, hl: (tf - tb) / 2, hw: t.spec.width / 2 + 0.05, part: 'trailer' });
  }
  return out;
}
