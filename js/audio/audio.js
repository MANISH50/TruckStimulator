// All sounds are generated in code with the Web Audio API (no audio files).
import { clamp } from '../util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('its_muted') === '1'; } catch (e) { /* storage blocked */ }
    this.ready = false;
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // looping beds: road/wind and traffic ambience
    this.road = this._loopNoise('lowpass', 500, 0);
    this.wind = this._loopNoise('bandpass', 900, 0, 0.6);
    this.amb = this._loopNoise('lowpass', 300, 0);
    // tyre screech
    this.scr = this._screech();
    // reverse beeper
    this.beep = ctx.createOscillator(); this.beep.type = 'square'; this.beep.frequency.value = 1150;
    this.beepGain = ctx.createGain(); this.beepGain.gain.value = 0;
    this.beep.connect(this.beepGain); this.beepGain.connect(this.master); this.beep.start();
    this.beepOn = false; this.beepT = 0;
    this.hornTimer = 0;
    this.ready = true;
  }

  async setupEngine(cyl, size) {
    if (!this.ctx) return;
    if (this.engine) { try { this.engine.disconnect(); } catch (e) { /* */ } this.engine = null; }
    if (this.fallback) { for (const o of this.fallback.osc) o.stop(); this.fallback.out.disconnect(); this.fallback = null; }
    const ctx = this.ctx;
    this.engGain = this.engGain || ctx.createGain();
    this.engGain.gain.value = 0.85;
    this.engGain.connect(this.master);
    try {
      if (!this.workletLoaded) {
        await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
        this.workletLoaded = true;
      }
      this.engine = new AudioWorkletNode(ctx, 'diesel-engine', { processorOptions: { cyl, size }, outputChannelCount: [1] });
      this.engine.connect(this.engGain);
    } catch (e) {
      // fallback: oscillator based engine
      const out = ctx.createBiquadFilter(); out.type = 'lowpass'; out.frequency.value = 500;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const g1 = ctx.createGain(); g1.gain.value = 0.25; const g2 = ctx.createGain(); g2.gain.value = 0.15;
      o1.connect(g1); o2.connect(g2); g1.connect(out); g2.connect(out); out.connect(this.engGain);
      o1.start(); o2.start();
      this.fallback = { osc: [o1, o2], out, cyl };
    }
  }

  _loopNoise(type, freq, gain, q = 0.7) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { src, f, g };
  }
  _screech() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 950;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 23;
    const lg = ctx.createGain(); lg.gain.value = 80; lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(); lfo.start();
    return { o, g };
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('its_muted', m ? '1' : '0'); } catch (e) { /* */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // per-frame update
  update(dt, st) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = 0.05;
    if (this.engine) {
      const P = this.engine.parameters;
      P.get('rpm').setTargetAtTime(st.rpm, t, 0.03);
      P.get('load').setTargetAtTime(st.load, t, 0.08);
      P.get('throttle').setTargetAtTime(st.throttle, t, 0.05);
      P.get('boost').setTargetAtTime(st.boost, t, 0.1);
      P.get('jake').setTargetAtTime(st.jake, t, 0.1);
      P.get('gain').setTargetAtTime(st.engineOn ? 0.55 + 0.25 * st.load : 0, t, 0.08);
    } else if (this.fallback) {
      const f = st.rpm / 60 * this.fallback.cyl / 2;
      this.fallback.osc[0].frequency.setTargetAtTime(f, t, 0.03);
      this.fallback.osc[1].frequency.setTargetAtTime(f / 2, t, 0.03);
      this.fallback.out.frequency.setTargetAtTime(250 + st.load * 900, t, 0.05);
      this.engGain.gain.setTargetAtTime(st.engineOn ? 0.7 : 0, t, 0.1);
    }
    const sp = clamp(st.speed / 30, 0, 1.5);
    this.road.g.gain.setTargetAtTime(sp * 0.18 * (st.offroad ? 2.2 : 1), t, k);
    this.road.f.frequency.setTargetAtTime(st.offroad ? 300 : 500 + sp * 400, t, k);
    this.wind.g.gain.setTargetAtTime(sp * sp * 0.06, t, k);
    this.amb.g.gain.setTargetAtTime(st.ambient * 0.12, t, 0.3);
    this.scr.g.gain.setTargetAtTime(clamp(st.screech, 0, 1) * 0.12, t, 0.04);
    // reverse beeper
    if (st.reverse) {
      this.beepT += dt;
      const on = (this.beepT % 1.0) < 0.5;
      this.beepGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.01);
    } else { this.beepGain.gain.setTargetAtTime(0, t, 0.01); this.beepT = 0; }
    // distant horns in traffic
    this.hornTimer -= dt;
    if (this.hornTimer < 0) {
      this.hornTimer = 2 + Math.random() * 6 / Math.max(0.2, st.ambient);
      if (st.ambient > 0.2) this.distantHorn();
    }
  }

  _env(node, t0, a, peak, d) {
    node.gain.setValueAtTime(0, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  _noiseBurst(type, freq, q, peak, a, d, when = 0) {
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, t0, a, peak, d);
    src.start(t0, Math.random()); src.stop(t0 + a + d + 0.05);
  }

  hornOn() {
    if (!this.ready || this.horn) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    sh.curve = curve;
    const oscs = [311, 392, 466].map((fr) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(sh); o.start(); return o; });
    sh.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setTargetAtTime(0.22, t, 0.02);
    this.horn = { g, oscs };
  }
  hornOff() {
    if (!this.horn) return;
    const { g, oscs } = this.horn; this.horn = null;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.04);
    for (const o of oscs) o.stop(t + 0.3);
  }
  distantHorn() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = 350 + Math.random() * 300;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.master);
    const dur = 0.15 + Math.random() * 0.4;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.02); g.gain.setValueAtTime(0.025, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.start(t); o.stop(t + dur + 0.1);
  }
  airBrake() { if (this.ready) this._noiseBurst('highpass', 2500, 0.7, 0.22, 0.02, 0.9); }
  blowoff() { if (this.ready) this._noiseBurst('bandpass', 1700, 1.5, 0.12, 0.01, 0.22); }
  click() { if (this.ready) this._noiseBurst('bandpass', 3000, 2, 0.15, 0.002, 0.05); }
  chime(ok = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    (ok ? [660, 880, 1320] : [440, 330]).forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = ctx.createGain(); o.connect(g); g.connect(this.master);
      this._env(g, t + i * 0.12, 0.01, 0.15, 0.5);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.6);
    });
  }
  crash(intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const I = clamp(intensity, 0.3, 1.5);
    // big noise hit
    this._noiseBurst('lowpass', 2500, 0.5, 0.9 * I, 0.005, 1.4);
    // low thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const g = ctx.createGain(); o.connect(g); g.connect(this.master);
    this._env(g, t, 0.005, 0.9 * I, 0.7); o.start(t); o.stop(t + 0.8);
    // metal clanks and glass
    for (let i = 0; i < 6; i++) this._noiseBurst('bandpass', 700 + Math.random() * 2600, 12, 0.5 * I, 0.002, 0.25 + Math.random() * 0.5, Math.random() * 0.5);
    for (let i = 0; i < 10; i++) this._noiseBurst('highpass', 5000, 1, 0.18, 0.001, 0.06, 0.05 + Math.random() * 0.6);
    // scraping
    this._noiseBurst('bandpass', 1200, 3, 0.25 * I, 0.1, 1.6, 0.2);
  }
  explosion() {
    if (!this.ready) return;
    this._noiseBurst('lowpass', 600, 0.5, 1.2, 0.01, 2.5);
    this._noiseBurst('lowpass', 180, 0.7, 1.0, 0.02, 3.0);
  }
}
