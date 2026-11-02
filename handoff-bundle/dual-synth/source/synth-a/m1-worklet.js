(function () {
  'use strict';

  // Engine A, milestone M1: one saw, ladder filter, drive, two ADSRs, velocity.
  const P = /*@PARAMS@*/;
  const N = P.length;
  const NV = 16;
  const SUB = 16;
  const TWO_PI = 6.283185307179586;
  const IX = {};
  for (let i = 0; i < N; i++) IX[P[i].id] = i;

  // Own soft clipper (rational, deterministic, output limited to +/-1).
  function sat(x) {
    if (x > 3) x = 3; else if (x < -3) x = -3;
    return x * (27 + x * x) / (27 + 9 * x * x);
  }

  function stepEnv(L, S, v, inc, dec, sus, rel) {
    let lv = L[v];
    const st = S[v];
    if (st === 1) { lv += inc; if (lv >= 1) { lv = 1; S[v] = 2; } }
    else if (st === 2) { lv = sus + (lv - sus) * dec; if (Math.abs(lv - sus) < 1e-5) { lv = sus; S[v] = 3; } }
    else if (st === 3) { lv = sus; }
    else if (st === 4) { lv *= rel; if (lv < 1e-5) { lv = 0; S[v] = 0; } }
    L[v] = lv;
    return lv;
  }

  // Four-pole ladder, tanh-style saturation in every stage, one-sample feedback delay.
  function lad(st, v, x, k, g) {
    const b = v * 8;
    let y1 = st[b], y2 = st[b + 1], y3 = st[b + 2], y4 = st[b + 3];
    let t1 = st[b + 4], t2 = st[b + 5], t3 = st[b + 6], t4 = st[b + 7];
    const inp = sat(x - k * y4);
    y1 += g * (inp - t1); t1 = sat(y1);
    y2 += g * (t1 - t2); t2 = sat(y2);
    y3 += g * (t2 - t3); t3 = sat(y3);
    y4 += g * (t3 - t4); t4 = sat(y4);
    st[b] = y1; st[b + 1] = y2; st[b + 2] = y3; st[b + 3] = y4;
    st[b + 4] = t1; st[b + 5] = t2; st[b + 6] = t3; st[b + 7] = t4;
    return y4;
  }

  class VaM1 extends AudioWorkletProcessor {
    constructor() {
      super();
      this.pv = new Float64Array(N);
      for (let i = 0; i < N; i++) this.pv[i] = P[i].def;
      this.ph = new Float64Array(NV);
      this.base = new Float64Array(NV);
      this.vel = new Float64Array(NV);
      this.st = new Float64Array(NV * 8);
      this.pin = new Float64Array(NV);
      this.aL = new Float64Array(NV);
      this.fL = new Float64Array(NV);
      this.aS = new Uint8Array(NV);
      this.fS = new Uint8Array(NV);
      this.gate = new Uint8Array(NV);
      this.os = new Uint8Array(NV);
      this.nid = new Int32Array(NV);
      this.age = new Float64Array(NV);
      this.mix = new Float64Array(128);
      this.limit = 8;
      this.quality = 2;
      this.counter = 0;
      this.clock = 0;
      this.steals = 0;
      this.nan = 0;
      this.panic = 0;
      this.panicTotal = 1;
      this.sCut = Math.log2(this.pv[IX.cutoff]);
      this.sRes = this.pv[IX.res];
      this.sDrv = this.pv[IX.drive];
      this.sEnv = this.pv[IX.fenv];
      this.sVol = this.pv[IX.vol];
      this.recalc();
      this.port.onmessage = (e) => this.handle(e.data);
    }

    recalc() {
      const pv = this.pv, sr = sampleRate;
      this.aInc = 1 / (pv[IX.aa] * sr);
      this.aDec = Math.exp(-6.9 / (pv[IX.ad] * sr));
      this.aRel = Math.exp(-6.9 / (pv[IX.ar] * sr));
      this.fInc = 1 / (pv[IX.fa] * sr);
      this.fDec = Math.exp(-6.9 / (pv[IX.fd] * sr));
      this.fRel = Math.exp(-6.9 / (pv[IX.fr] * sr));
      this.tune = Math.pow(2, Math.round(pv[IX.oct]) + pv[IX.fine] / 1200);
    }

    setP(i, v) {
      i = i | 0;
      if (i < 0 || i >= N || typeof v !== 'number' || !Number.isFinite(v)) return;
      const d = P[i];
      this.pv[i] = v < d.min ? d.min : (v > d.max ? d.max : v);
      this.recalc();
    }

    kill(v) {
      for (let j = 0; j < 8; j++) this.st[v * 8 + j] = 0;
      this.pin[v] = 0; this.aL[v] = 0; this.fL[v] = 0;
      this.aS[v] = 0; this.fS[v] = 0; this.gate[v] = 0;
    }

    release(v) {
      if (this.gate[v]) {
        this.gate[v] = 0;
        if (this.aS[v] !== 0) this.aS[v] = 4;
        if (this.fS[v] !== 0) this.fS[v] = 4;
      }
    }

    alloc() {
      for (let i = 0; i < this.limit; i++) if (this.aS[i] === 0) return i;
      // Steal: quietest releasing voice first, otherwise the oldest held voice.
      let best = 0, bestScore = Infinity;
      for (let i = 0; i < this.limit; i++) {
        const score = this.gate[i] ? 1e9 + this.age[i] : this.aL[i];
        if (score < bestScore) { bestScore = score; best = i; }
      }
      this.steals++;
      return best;
    }

    noteOn(m) {
      if (this.panic > 0) return;
      if (typeof m.note !== 'number' || !(m.note >= 0 && m.note <= 127)) return;
      const id = m.id | 0;
      for (let i = 0; i < NV; i++) if (this.aS[i] !== 0 && this.gate[i] && this.nid[i] === id) this.release(i);
      const v = this.alloc();
      if (this.aS[v] === 0) {
        this.ph[v] = 0;
        this.kill(v);
      }
      let vel = typeof m.vel === 'number' && Number.isFinite(m.vel) ? m.vel : 0.8;
      vel = vel < 0 ? 0 : (vel > 1 ? 1 : vel);
      this.base[v] = 440 * Math.pow(2, (Math.round(m.note) - 69) / 12);
      this.vel[v] = vel;
      this.nid[v] = id;
      this.gate[v] = 1;
      this.aS[v] = 1;
      this.fS[v] = 1;
      this.os[v] = this.quality;
      this.age[v] = ++this.counter;
    }

    handle(m) {
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'noteOn') this.noteOn(m);
      else if (m.t === 'noteOff') {
        const id = m.id | 0;
        for (let i = 0; i < NV; i++) if (this.aS[i] !== 0 && this.gate[i] && this.nid[i] === id) this.release(i);
      }
      else if (m.t === 'allNotesOff') { for (let i = 0; i < NV; i++) this.release(i); }
      else if (m.t === 'panic') { this.panicTotal = Math.max(1, Math.round(0.02 * sampleRate)); this.panic = this.panicTotal; }
      else if (m.t === 'param') this.setP(m.i, m.v);
      else if (m.t === 'patch' && Array.isArray(m.values)) { for (let i = 0; i < N; i++) this.setP(i, m.values[i]); }
      else if (m.t === 'quality') this.quality = m.q === 1 ? 1 : 2;
      else if (m.t === 'voices') this.limit = Math.min(NV, Math.max(1, m.n | 0));
    }

    process(inputs, outputs) {
      const out = outputs[0];
      const L = out[0];
      const R = out.length > 1 ? out[1] : null;
      const n = L.length;
      if (this.mix.length < n) this.mix = new Float64Array(n);
      const mix = this.mix, pv = this.pv, sr = sampleRate, st = this.st;
      mix.fill(0, 0, n);

      for (let s0 = 0; s0 < n; s0 += SUB) {
        const len = Math.min(SUB, n - s0);
        this.sCut += (Math.log2(pv[IX.cutoff]) - this.sCut) * 0.04;
        this.sRes += (pv[IX.res] - this.sRes) * 0.04;
        this.sDrv += (pv[IX.drive] - this.sDrv) * 0.04;
        this.sEnv += (pv[IX.fenv] - this.sEnv) * 0.04;
        this.sVol += (pv[IX.vol] - this.sVol) * 0.04;
        const k = 4 * this.sRes;
        const dg = 1 + 14 * this.sDrv * this.sDrv;
        const pre = dg * (1 + 0.5 * k);
        const velF = pv[IX.fvel], velA = pv[IX.avel];

        for (let v = 0; v < NV; v++) {
          if (this.aS[v] === 0) continue;
          const os = this.os[v];
          const vel = this.vel[v];
          const fscale = this.fL[v] * ((1 - velF) + velF * vel);
          let fc = Math.pow(2, this.sCut + this.sEnv * fscale);
          const fmax = Math.min(20000, 0.45 * sr * os);
          fc = fc < 20 ? 20 : (fc > fmax ? fmax : fc);
          const g = 1 - Math.exp(-TWO_PI * fc / (sr * os));
          const post = 0.35 / Math.sqrt(dg) * ((1 - velA) + velA * vel);
          const dt = Math.min(0.45, this.base[v] * this.tune / sr);
          let p = this.ph[v];
          for (let j = 0; j < len; j++) {
            const ae = stepEnv(this.aL, this.aS, v, this.aInc, this.aDec, pv[IX.as], this.aRel);
            stepEnv(this.fL, this.fS, v, this.fInc, this.fDec, pv[IX.fs], this.fRel);
            let x = 2 * p - 1;
            if (p < dt) { const t = p / dt; x -= t + t - t * t - 1; }
            else if (p > 1 - dt) { const t = (p - 1) / dt; x -= t * t + t + t + 1; }
            p += dt;
            if (p >= 1) p -= 1;
            x *= pre;
            let y;
            if (os === 2) {
              y = 0.5 * (lad(st, v, 0.5 * (this.pin[v] + x), k, g) + lad(st, v, x, k, g));
              this.pin[v] = x;
            } else {
              y = lad(st, v, x, k, g);
            }
            mix[s0 + j] += y * ae * post;
            if (this.aS[v] === 0) break;
          }
          this.ph[v] = p;
          if (this.aS[v] === 0) this.kill(v);
        }

        const vg = this.sVol * this.sVol;
        for (let j = 0; j < len; j++) {
          let pg = 1;
          if (this.panic > 0) {
            pg = this.panic / this.panicTotal;
            this.panic--;
            if (this.panic === 0) { for (let v = 0; v < NV; v++) this.kill(v); }
          }
          let o = sat(mix[s0 + j] * vg * pg);
          if (o !== o) { o = 0; this.nan++; }
          L[s0 + j] = o;
          if (R) R[s0 + j] = o;
        }
      }

      this.clock += n;
      if (this.clock >= sr / 4) {
        this.clock = 0;
        let c = 0;
        for (let v = 0; v < NV; v++) if (this.aS[v] !== 0) c++;
        this.port.postMessage({ t: 'status', voices: c, steals: this.steals, nan: this.nan });
      }
      return true;
    }
  }

  registerProcessor('va-m1', VaM1);
})();
