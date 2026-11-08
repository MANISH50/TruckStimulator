// Diesel engine synthesiser (AudioWorklet). Original code.
// Model: combustion pulses at the firing frequency (rpm/60 * cylinders/2 for a
// 4-stroke engine), with small cylinder-to-cylinder differences (gives the
// lumpy diesel idle), exciting exhaust/body resonances; plus diesel knock
// (clatter), intake noise, turbo whistle and exhaust-brake rasp.

class Biquad {
  constructor() { this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  bandpass(f, q, fs) {
    const w = 2 * Math.PI * Math.min(f, fs * 0.45) / fs, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  lowpass(f, q, fs) {
    const w = 2 * Math.PI * Math.min(f, fs * 0.45) / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class DieselEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 650, minValue: 0, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'jake', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0.6, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.cyl = o.cyl || 6;
    this.size = o.size || 1; // 0.6 small engine .. 1.3 big
    this.phase = 0; this.ci = 0;
    this.cv = [];
    for (let i = 0; i < this.cyl; i++) this.cv.push((Math.random() - 0.5) * 0.5);
    this.pulseT = 1; this.pulseA = 0; this.pulseLen = 0.0016;
    this.knock = 0; this.jakeEnv = 0;
    this.r1 = new Biquad(); this.r2 = new Biquad(); this.r3 = new Biquad(); this.rk = new Biquad();
    this.lpOut = new Biquad(); this.lpIn = 0; this.tPhase = 0;
    this.dc = 0; this.dcx = 0;
    this.rpmS = 650;
  }
  process(inputs, outputs, P) {
    const out = outputs[0][0];
    if (!out) return true;
    const fs = sampleRate;
    const rpmT = P.rpm[0], load = P.load[0], thr = P.throttle[0], boost = P.boost[0], jake = P.jake[0], gain = P.gain[0];
    const sz = this.size;
    // update filters once per block
    const rn = Math.min(1.3, this.rpmS / 2400);
    this.r1.bandpass((62 + this.rpmS * 0.018) / sz, 2.2, fs);
    this.r2.bandpass((150 + load * 70 + rn * 40) / Math.sqrt(sz), 3.5, fs);
    this.r3.bandpass(420 + rn * 380 + load * 200, 2.5, fs);
    this.rk.bandpass(2300, 1.4, fs);
    this.lpOut.lowpass(1400 + load * 2600 + rn * 900, 0.7, fs);
    const g1 = 1.0, g2 = 0.8, g3 = (0.18 + 0.45 * load) * (1 + jake * 3.5);
    const knockLvl = (0.6 - 0.35 * load) * (1.2 - rn * 0.5);
    for (let i = 0; i < out.length; i++) {
      this.rpmS += (rpmT - this.rpmS) * 0.0006;
      const f = this.rpmS / 60 * this.cyl / 2;
      this.phase += f / fs;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.ci = (this.ci + 1) % this.cyl;
        const idleRough = 1 - Math.min(1, this.rpmS / 1400);
        let a = (1 + this.cv[this.ci] * (0.5 + idleRough)) * (0.5 + 0.7 * load + 0.2 * thr);
        a *= 1 + (Math.random() - 0.5) * (0.12 + 0.3 * idleRough);
        if (this.rpmS < 50) a = 0;
        this.pulseA = a; this.pulseT = 0;
        this.knock = a;
        this.jakeEnv = jake;
        this.pulseLen = 0.0012 + 0.0016 * (1 - rn);
      }
      // half-sine combustion pulse
      let p = 0;
      if (this.pulseT < this.pulseLen) { p = this.pulseA * Math.sin(Math.PI * this.pulseT / this.pulseLen); this.pulseT += 1 / fs; }
      const n = Math.random() * 2 - 1;
      this.knock *= 0.985;
      this.jakeEnv *= 0.996;
      let y = this.r1.run(p) * g1 * 9 + this.r2.run(p) * g2 * 7 + this.r3.run(p + n * this.jakeEnv * 0.4) * g3 * 8;
      y += this.rk.run(n * this.knock) * knockLvl * 0.9;
      // intake hiss
      this.lpIn += (n - this.lpIn) * 0.12;
      y += this.lpIn * thr * rn * 0.25;
      // turbo whistle
      this.tPhase += (1500 + boost * 4800) / fs;
      if (this.tPhase > 1) this.tPhase -= 1;
      y += Math.sin(this.tPhase * 2 * Math.PI) * boost * boost * 0.05;
      // tone shaping, DC block, soft clip
      y = this.lpOut.run(y);
      const yd = y - this.dcx + 0.995 * this.dc; this.dcx = y; this.dc = yd;
      out[i] = Math.tanh(yd * 0.55) * gain;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('diesel-engine', DieselEngine);
