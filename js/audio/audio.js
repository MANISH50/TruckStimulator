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
    this.engGain.gain.value = 0.6; // quieter, more relaxing engine
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
  // ---------- calm radio: tanpura drone, bansuri-style flute (raga Bhupali), soft pad ----------
  _reverb() {
    if (this.verb) return this.verb;
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const cv = ctx.createConvolver(); cv.buffer = ir;
    const g = ctx.createGain(); g.gain.value = 0.55;
    cv.connect(g); g.connect(this.master);
    this.verb = cv;
    return cv;
  }
  setRadio(on) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (!this.radioBus) {
      this.radioBus = ctx.createGain(); this.radioBus.gain.value = 0;
      this.radioBus.connect(this.master); this.radioBus.connect(this._reverb());
    }
    this.radioBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.6);
    if (on && !this.radioTimer) {
      this.mT = ctx.currentTime + 0.2; this.tanT = this.mT; this.fluteT = this.mT + 3; this.tanI = 0;
      this._pad();
      this.radioTimer = setInterval(() => this._schedule(), 200);
    }
    if (!on && this.radioTimer) { clearInterval(this.radioTimer); this.radioTimer = null; if (this.padNodes) { for (const o of this.padNodes) o.stop(ctx.currentTime + 1.5); this.padNodes = null; } }
  }
  _pad() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain);
    this.padNodes = [lfo];
    for (const fr of [146.83, 220, 293.66]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(f); o.start(); this.padNodes.push(o);
    }
    f.connect(g); g.connect(this.radioBus); lfo.start();
  }
  _pluck(t, fr) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(500, t + 3.5);
    for (const d of [0, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = d;
      o.connect(f); o.start(t); o.stop(t + 4.5);
    }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + 4.3);
    f.connect(g); g.connect(this.radioBus);
  }
  _flute(t, notes) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    const g2 = ctx.createGain(); g2.gain.value = 0.12;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.value = 0;
    vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    const breath = ctx.createBufferSource(); breath.buffer = this.noise; breath.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.Q.value = 4;
    const bg = ctx.createGain(); bg.gain.value = 0.025;
    breath.connect(bf); bf.connect(bg);
    const env = ctx.createGain(); env.gain.value = 0;
    o.connect(env); o2.connect(g2); g2.connect(env); bg.connect(env); env.connect(this.radioBus);
    let tt = t;
    for (let k = 0; k < notes.length; k++) {
      const [fr, dur] = notes[k];
      if (k === 0) { o.frequency.setValueAtTime(fr, tt); o2.frequency.setValueAtTime(fr * 2, tt); bf.frequency.setValueAtTime(fr, tt); }
      else { o.frequency.setTargetAtTime(fr, tt, 0.04); o2.frequency.setTargetAtTime(fr * 2, tt, 0.04); bf.frequency.setTargetAtTime(fr, tt, 0.04); }
      vg.gain.setValueAtTime(0, tt); vg.gain.linearRampToValueAtTime(14, tt + Math.min(dur, 0.6));
      tt += dur;
    }
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.09, t + 0.18);
    env.gain.setValueAtTime(0.09, tt - 0.1); env.gain.linearRampToValueAtTime(0, tt + 0.6);
    for (const n of [o, o2, vib, breath]) { n.start(t); n.stop(tt + 0.8); }
    return tt;
  }
  _schedule() {
    const ctx = this.ctx, ahead = ctx.currentTime + 1.5;
    // tanpura: Pa - Sa - Sa - low Sa, one string every 1.2 s
    const tan = [110, 146.83, 146.83, 73.42];
    while (this.tanT < ahead) { this._pluck(this.tanT, tan[this.tanI++ % 4]); this.tanT += 1.2; }
    // flute phrases with long, peaceful pauses
    if (this.fluteT < ahead) {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19]; // Sa Re Ga Pa Dha (Bhupali)
      let idx = 2 + Math.floor(Math.random() * 4);
      const n = 3 + Math.floor(Math.random() * 5), notes = [];
      for (let k = 0; k < n; k++) {
        idx = Math.max(0, Math.min(scale.length - 1, idx + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
        const dur = k === n - 1 ? 2.2 + Math.random() * 1.5 : 0.45 + Math.random() * 0.9;
        notes.push([293.66 * Math.pow(2, scale[idx] / 12), dur]);
      }
      const end = this._flute(this.fluteT, notes);
      this.fluteT = end + 3 + Math.random() * 6;
    }
  }
  // ---------- nature sounds ----------
  _chirp(t, pan) {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const n = 2 + Math.floor(Math.random() * 5), base = 2600 + Math.random() * 1800;
    for (let k = 0; k < n; k++) {
      const tt = t + k * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base, tt); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), tt + 0.06);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.025, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.08);
      o.connect(g); if (p) { g.connect(p); } else g.connect(this.master);
      o.start(tt); o.stop(tt + 0.1);
    }
    if (p) { p.pan.value = pan; p.connect(this.master); p.connect(this._reverb()); }
  }
  _crickets(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4400 + Math.random() * 600;
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 28;
    const ag = ctx.createGain(); ag.gain.value = 0.5; am.connect(ag);
    const g = ctx.createGain(); g.gain.value = 0;
    ag.connect(g.gain);
    o.connect(g); g.connect(this.master);
    const env = ctx.createGain();
    g.disconnect(); o.disconnect(); o.connect(g); g.connect(env); env.connect(this.master);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.012, t + 0.05); env.gain.setValueAtTime(0.012, t + 0.35); env.gain.linearRampToValueAtTime(0, t + 0.45);
    for (const x of [o, am]) { x.start(t); x.stop(t + 0.5); }
  }
  nature(dt, kind) {
    if (!this.ready || !kind) return;
    this.natT = (this.natT ?? 2) - dt;
    if (this.natT > 0) return;
    const t = this.ctx.currentTime + 0.05;
    if (kind === 'birds') { this._chirp(t, Math.random() * 1.6 - 0.8); this.natT = 2.5 + Math.random() * 5; }
    else { this._crickets(t); this.natT = 0.7 + Math.random() * 1.6; }
  }

  explosion() {
    if (!this.ready) return;
    this._noiseBurst('lowpass', 600, 0.5, 1.2, 0.01, 2.5);
    this._noiseBurst('lowpass', 180, 0.7, 1.0, 0.02, 3.0);
  }
}
