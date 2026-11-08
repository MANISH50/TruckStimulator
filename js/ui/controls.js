// Touch controls: steering wheel (rotate with a finger), accelerator and
// brake pedals (hold), D/N/R switch, horn. Keyboard works too on desktop.
import { clamp } from '../util.js';

const MAX_WHEEL = 450; // degrees of wheel rotation for full lock

export class Controls {
  constructor() {
    this.steer = 0; this.throttle = 0; this.brake = 0; this.gear = 'D'; this.horn = false;
    this.wheelDeg = 0; this.wheelHeld = false;
    this.accHeld = false; this.brkHeld = false;
    this.keys = {};
    this.enabled = true;
    this.onHornStart = null; this.onHornEnd = null; this.onGear = null;
    this._wheel(); this._pedals(); this._gears(); this._horn(); this._keys();
  }

  _wheel() {
    const el = document.getElementById('wheel');
    const img = document.getElementById('wheelImg');
    this.wheelImg = img;
    let pid = null, lastA = 0;
    const ang = (e) => {
      const r = el.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      // tap on the hub = horn
      if (Math.hypot(dx, dy) < r.width * 0.15) { this._hornOn(); el.setPointerCapture(e.pointerId); this._hubPid = e.pointerId; return; }
      pid = e.pointerId; lastA = ang(e); this.wheelHeld = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const a = ang(e);
      let d = a - lastA;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      lastA = a;
      this.wheelDeg = clamp(this.wheelDeg + d, -MAX_WHEEL, MAX_WHEEL);
    });
    const up = (e) => {
      if (e.pointerId === this._hubPid) { this._hubPid = null; this._hornOff(); return; }
      if (e.pointerId !== pid) return;
      pid = null; this.wheelHeld = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _hold(id, set) {
    const el = document.getElementById(id);
    const pids = new Set();
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); pids.add(e.pointerId); el.setPointerCapture(e.pointerId); set(true); el.classList.add('on'); });
    const up = (e) => { if (!pids.has(e.pointerId)) return; pids.delete(e.pointerId); if (!pids.size) { set(false); el.classList.remove('on'); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return el;
  }

  _pedals() {
    this._hold('accel', (v) => (this.accHeld = v));
    this._hold('brake', (v) => (this.brkHeld = v));
  }

  _gears() {
    for (const g of ['D', 'N', 'R']) {
      document.getElementById('g' + g).addEventListener('pointerdown', (e) => { e.preventDefault(); this.setGear(g); });
    }
  }
  setGear(g) {
    this.gear = g;
    for (const k of ['D', 'N', 'R']) document.getElementById('g' + k).classList.toggle('on', k === g);
    if (this.onGear) this.onGear(g);
  }

  _horn() {
    this._hold('horn', (v) => (v ? this._hornOn() : this._hornOff()));
  }
  _hornOn() { if (!this.horn) { this.horn = true; this.onHornStart && this.onHornStart(); } }
  _hornOff() { if (this.horn) { this.horn = false; this.onHornEnd && this.onHornEnd(); } }

  _keys() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyH') this._hornOn();
      if (e.code === 'Digit1') this.setGear('D');
      if (e.code === 'Digit2') this.setGear('N');
      if (e.code === 'Digit3') this.setGear('R');
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyH') this._hornOff(); });
    addEventListener('blur', () => { this.keys = {}; this.accHeld = this.brkHeld = false; });
  }

  update(dt) {
    const k = this.keys;
    const kl = k.ArrowLeft || k.KeyA, kr = k.ArrowRight || k.KeyD;
    if (kl || kr) {
      this.wheelDeg = clamp(this.wheelDeg + (kr ? 1 : 0) * 300 * dt - (kl ? 1 : 0) * 300 * dt, -MAX_WHEEL, MAX_WHEEL);
    } else if (!this.wheelHeld) {
      // self-centering
      const back = 380 * dt;
      this.wheelDeg = Math.abs(this.wheelDeg) < back ? 0 : this.wheelDeg - Math.sign(this.wheelDeg) * back;
    }
    this.steer = this.wheelDeg / MAX_WHEEL;
    const acc = this.accHeld || k.ArrowUp || k.KeyW;
    const brk = this.brkHeld || k.ArrowDown || k.KeyS || k.Space;
    // pedals ramp smoothly
    this.throttle = clamp(this.throttle + (acc && this.enabled ? 4 : -6) * dt, 0, 1);
    this.brake = clamp(this.brake + (brk && this.enabled ? 6 : -8) * dt, 0, 1);
    if (this.wheelImg) this.wheelImg.style.transform = `rotate(${this.wheelDeg}deg)`;
  }

  reset() {
    this.wheelDeg = 0; this.throttle = 0; this.brake = 0; this.accHeld = this.brkHeld = false;
    this.setGear('D'); this._hornOff();
    document.getElementById('accel').classList.remove('on'); document.getElementById('brake').classList.remove('on');
  }
}
