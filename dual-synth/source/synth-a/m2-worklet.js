(function () {
  'use strict';

  // Engine A, milestone M2: three oscillators + sub + noise, hypersaw, ladder / multimode / bite filters,
  // key tracking, filter FM, pre and post drive, pitch bend, mod wheel, sustain, mono / legato / glide, drift.
  // Subtractive only: every sound starts as a classic waveform and is shaped by filters and envelopes.
  const P = /*@PARAMS@*/;
  const N = P.length;
  const NV = 16;      // voices allocated
  const SUB = 16;     // control-rate block, in samples
  const HB = 9;       // most hypersaw blades
  const HS = HB + 1;  // phase slots per voice: nine blades plus one for the plain single oscillator
  const TWO_PI = 6.283185307179586;
  const IX = {};
  for (let i = 0; i < N; i++) IX[P[i].id] = i;

  // Own soft clipper (rational, deterministic, output limited to +/-1).
  function sat(x) {
    if (x > 3) x = 3; else if (x < -3) x = -3;
    return x * (27 + x * x) / (27 + 9 * x * x);
  }

  // PolyBLEP residual for a unit-height edge. A step of size s is corrected with x += (s / 2) * blep.
  function blep(p, d) {
    if (p < d) { const t = p / d; return t + t - t * t - 1; }
    if (p > 1 - d) { const t = (p - 1) / d; return t * t + t + t + 1; }
    return 0;
  }

  // One band-limited oscillator sample. w: 0 saw, 1 pulse, 2 triangle (integrated square), 3 sine.
  function gen(w, p, d, pw, tz, zi) {
    if (w === 0) return 2 * p - 1 - blep(p, d);
    if (w === 1) {
      let q = p - pw; if (q < 0) q += 1;
      return (p < pw ? 1 : -1) + blep(p, d) - blep(q, d);
    }
    if (w === 2) {
      let q = p - 0.5; if (q < 0) q += 1;
      const sq = (p < 0.5 ? 1 : -1) + blep(p, d) - blep(q, d);
      const z = tz[zi] * 0.99999 + 4 * d * sq;
      tz[zi] = z;
      return z;
    }
    return Math.sin(TWO_PI * p);
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

  // ---- Filters. F holds the settings for the voice being processed. Each filter channel has its own 8 states. ----
  const F = { mode: 0, os: 2, k: 0, sk: 1 };

  // Four-pole ladder, saturation in every stage, one-sample feedback delay.
  function lad(st, bi, x, k, g) {
    const b = bi * 8;
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

  // Two-pole state variable filter (trapezoidal). The band-pass state is soft-limited at about +/-3, which keeps
  // strong resonance bounded and gives it a little grit without flattening the resonant peak. mode 1 LP, 2 BP, 3 HP, 4 Bite.
  function svf(st, bi, x, g, mode) {
    const b = bi * 8, k = F.sk;
    if (mode === 4) x = sat(1.6 * x + 0.2) - 0.1977;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const ic1 = st[b], ic2 = st[b + 1];
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    st[b] = 3 * sat((2 * v1 - ic1) * 0.3333333333333333);
    st[b + 1] = 2 * v2 - ic2;
    if (mode === 1) return v2;
    if (mode === 2) return k * v1;
    if (mode === 3) return x - k * v1 - v2;
    return v2 + 0.5 * k * v1;
  }

  function core(st, bi, x, g) {
    const m = F.mode;
    return m === 0 ? lad(st, bi, x, F.k, g) : svf(st, bi, x, g, m);
  }

  // One filtered sample for voice v, channel c. In Studio mode (os 2) the filter runs twice per sample.
  function fil(st, pin, v, c, x, g) {
    const bi = v * 2 + c;
    if (F.os === 2) {
      const xm = 0.5 * (pin[bi] + x);
      pin[bi] = x;
      return 0.5 * (core(st, bi, xm, g) + core(st, bi, x, g));
    }
    return core(st, bi, x, g);
  }

  class VaM2 extends AudioWorkletProcessor {
    constructor() {
      super();
      this.pv = new Float64Array(N);
      for (let i = 0; i < N; i++) this.pv[i] = P[i].def;
      // per-voice state
      this.ph1 = new Float64Array(NV * HS);
      this.ph2 = new Float64Array(NV);
      this.ph3 = new Float64Array(NV);
      this.phs = new Float64Array(NV);
      this.tz = new Float64Array(NV * 3);
      this.dph = new Float64Array(NV * 3);
      this.cur = new Float64Array(NV);       // current pitch, octaves from A4 (glides toward the note)
      this.note = new Float64Array(NV);
      this.vel = new Float64Array(NV);
      this.st = new Float64Array(NV * 2 * 8);
      this.pin = new Float64Array(NV * 2);
      this.aL = new Float64Array(NV);
      this.fL = new Float64Array(NV);
      this.aS = new Uint8Array(NV);
      this.fS = new Uint8Array(NV);
      this.gate = new Uint8Array(NV);
      this.pend = new Uint8Array(NV);        // released by the key but held by the sustain pedal
      this.os = new Uint8Array(NV);
      this.nid = new Int32Array(NV);
      this.age = new Float64Array(NV);
      // mono / legato note stack
      this.sId = new Int32Array(16);
      this.sNote = new Float64Array(16);
      this.sVel = new Float64Array(16);
      this.sPend = new Uint8Array(16);
      this.sn = 0;
      // hypersaw tables
      this.hyN = 7; this.hyJc = 3;
      this.hyR = new Float64Array(HB);
      this.hyLg = new Float64Array(HB);
      this.hyRg = new Float64Array(HB);
      this.mixL = new Float64Array(128);
      this.mixR = new Float64Array(128);
      this.limit = 8;
      this.quality = 2;
      this.counter = 0;
      this.clock = 0;
      this.steals = 0;
      this.nan = 0;
      this.panic = 0;
      this.panicTotal = 1;
      this.sus = 0;
      this.bend = 0; this.wheel = 0;
      this.sBend = 0; this.sWheel = 0;
      this.lastLp = NaN;
      this.rs = 2463534242;                  // private noise generator state (xorshift32), fixed seed
      this.sCut = Math.log2(this.pv[IX.cutoff]);
      this.sRes = this.pv[IX.res];
      this.sDrv = this.pv[IX.drive];
      this.sPdr = this.pv[IX.pdrive];
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

      // Hypersaw: detune spread follows a curve (fine at low settings, wide at the top), side blades are
      // balanced against the centre blade, and width pans the blades with a law that cannot cancel in mono.
      const nb = Math.round(pv[IX.hyn]) === 1 ? 9 : 7;
      const mj = (nb - 1) / 2;
      const d = pv[IX.hydet], m = pv[IX.hymix];
      const cents = 70 * (0.3 * d + 0.7 * d * d);
      const cg = 1 - 0.6 * m, sg = Math.pow(m, 1.4);
      const norm = 1 / Math.sqrt(cg * cg + (nb - 1) * sg * sg);
      const wid = pv[IX.hywid];
      this.hyN = nb; this.hyJc = mj;
      for (let jj = 0; jj < nb; jj++) {
        const j = jj - mj, a = Math.abs(j) / mj;
        this.hyR[jj] = Math.pow(2, (j < 0 ? -1 : 1) * cents * Math.pow(a, 1.35) / 1200);
        const lev = (j === 0 ? cg : sg) * norm;
        const pos = (j / mj) * wid;
        this.hyLg[jj] = lev * (pos > 0 ? 1 - pos : 1);
        this.hyRg[jj] = lev * (pos < 0 ? 1 + pos : 1);
      }
    }

    setP(i, v) {
      i = i | 0;
      if (i < 0 || i >= N || typeof v !== 'number' || !Number.isFinite(v)) return;
      const d = P[i];
      v = v < d.min ? d.min : (v > d.max ? d.max : v);
      if (d.step === 1) v = Math.round(v);
      this.pv[i] = v;
      this.recalc();
    }

    kill(v) {
      for (let j = 0; j < 16; j++) this.st[v * 16 + j] = 0;
      this.pin[v * 2] = 0; this.pin[v * 2 + 1] = 0;
      this.aL[v] = 0; this.fL[v] = 0;
      this.aS[v] = 0; this.fS[v] = 0; this.gate[v] = 0; this.pend[v] = 0;
    }

    // Fresh voice: clean filter, oscillators start in a known state (hypersaw blades spread by a fixed rule).
    initVoice(v) {
      this.kill(v);
      const c = this.counter;
      for (let j = 0; j < HB; j++) {
        const x = (j + 1) * 0.6180339887 + 0.3819660113 * c;
        this.ph1[v * HS + j] = j === this.hyJc ? 0 : x - Math.floor(x);
      }
      this.ph1[v * HS + HB] = 0;   // a plain oscillator always starts at phase 0
      this.ph2[v] = 0; this.ph3[v] = 0; this.phs[v] = 0;
      this.tz[v * 3] = -1; this.tz[v * 3 + 1] = -1; this.tz[v * 3 + 2] = -1;
      for (let k = 0; k < 3; k++) {
        const x = c * 0.3819660113 + k * 0.2753 + v * 0.1137;
        this.dph[v * 3 + k] = x - Math.floor(x);
      }
    }

    release(v) {
      this.pend[v] = 0;
      if (this.gate[v]) {
        this.gate[v] = 0;
        if (this.aS[v] !== 0) this.aS[v] = 4;
        if (this.fS[v] !== 0) this.fS[v] = 4;
      }
    }

    alloc() {
      for (let i = 0; i < this.limit; i++) if (this.aS[i] === 0) return i;
      let best = 0, bestScore = Infinity;
      for (let i = 0; i < this.limit; i++) {
        const score = this.gate[i] ? 1e9 + this.age[i] : this.aL[i];
        if (score < bestScore) { bestScore = score; best = i; }
      }
      this.steals++;
      return best;
    }

    setNote(v, note, vel, id, fresh) {
      const tgt = (note - 69) / 12;
      this.note[v] = note; this.vel[v] = vel; this.nid[v] = id;
      if (fresh) this.cur[v] = (this.pv[IX.glide] > 0.0005 && Number.isFinite(this.lastLp)) ? this.lastLp : tgt;
      this.lastLp = tgt;
    }

    noteOn(m) {
      if (this.panic > 0) return;
      if (typeof m.note !== 'number' || !(m.note >= 0 && m.note <= 127)) return;
      const id = m.id | 0;
      const note = Math.round(m.note);
      let vel = typeof m.vel === 'number' && Number.isFinite(m.vel) ? m.vel : 0.8;
      vel = vel < 0 ? 0 : (vel > 1 ? 1 : vel);
      const mode = Math.round(this.pv[IX.mode]);
      if (mode > 0) { this.monoOn(id, note, vel, mode); return; }
      for (let i = 0; i < NV; i++) if (this.aS[i] !== 0 && this.gate[i] && this.nid[i] === id) this.release(i);
      const v = this.alloc();
      const fresh = this.aS[v] === 0;
      this.counter++;
      if (fresh) this.initVoice(v);
      this.setNote(v, note, vel, id, fresh);
      this.pend[v] = 0;
      this.gate[v] = 1;
      this.aS[v] = 1;
      this.fS[v] = 1;
      if (fresh) this.os[v] = this.quality;
      this.age[v] = this.counter;
    }

    monoOn(id, note, vel, mode) {
      this.stackRemove(id);
      if (this.sn >= 16) this.stackDrop(0);
      const t = this.sn++;
      this.sId[t] = id; this.sNote[t] = note; this.sVel[t] = vel; this.sPend[t] = 0;
      const fresh = this.aS[0] === 0;
      const held = !fresh && this.gate[0] === 1;
      this.counter++;
      if (fresh) { this.initVoice(0); this.os[0] = this.quality; }
      this.setNote(0, note, vel, id, fresh);
      if (!held || mode === 1) { this.aS[0] = 1; this.fS[0] = 1; }
      this.gate[0] = 1; this.pend[0] = 0;
      this.age[0] = this.counter;
    }

    stackIndex(id) { for (let i = 0; i < this.sn; i++) if (this.sId[i] === id) return i; return -1; }
    stackDrop(i) {
      for (let j = i; j < this.sn - 1; j++) {
        this.sId[j] = this.sId[j + 1]; this.sNote[j] = this.sNote[j + 1];
        this.sVel[j] = this.sVel[j + 1]; this.sPend[j] = this.sPend[j + 1];
      }
      this.sn--;
    }
    stackRemove(id) { const i = this.stackIndex(id); if (i >= 0) this.stackDrop(i); }

    // Take a note out of the mono stack. If it was the sounding one, fall back to the one before it.
    monoRemove(i) {
      const wasTop = i === this.sn - 1;
      this.stackDrop(i);
      if (!wasTop) return;
      if (this.sn > 0) {
        const t = this.sn - 1;
        this.setNote(0, this.sNote[t], this.sVel[t], this.sId[t], false);
        if (Math.round(this.pv[IX.mode]) === 1) { this.aS[0] = 1; this.fS[0] = 1; }
        this.gate[0] = 1;
      } else {
        this.release(0);
      }
    }

    noteOff(id) {
      const i = this.stackIndex(id);
      if (i >= 0) {
        if (this.sus) this.sPend[i] = 1; else this.monoRemove(i);
        return;
      }
      for (let j = 0; j < NV; j++) {
        if (this.aS[j] !== 0 && this.gate[j] && this.nid[j] === id) {
          if (this.sus) this.pend[j] = 1; else this.release(j);
        }
      }
    }

    setSustain(on) {
      this.sus = on ? 1 : 0;
      if (on) return;
      for (let i = this.sn - 1; i >= 0; i--) if (this.sPend[i]) this.monoRemove(i);
      for (let j = 0; j < NV; j++) if (this.pend[j]) this.release(j);
    }

    handle(m) {
      if (!m || typeof m.t !== 'string') return;
      const t = m.t;
      if (t === 'noteOn') this.noteOn(m);
      else if (t === 'noteOff') this.noteOff(m.id | 0);
      else if (t === 'allNotesOff') { this.sn = 0; for (let i = 0; i < NV; i++) this.release(i); }
      else if (t === 'panic') { this.panicTotal = Math.max(1, Math.round(0.02 * sampleRate)); this.panic = this.panicTotal; this.sn = 0; this.sus = 0; }
      else if (t === 'param') this.setP(m.i, m.v);
      else if (t === 'patch' && Array.isArray(m.values)) { for (let i = 0; i < N; i++) this.setP(i, m.values[i]); }
      else if (t === 'quality') this.quality = m.q === 1 ? 1 : 2;
      else if (t === 'voices') this.limit = Math.min(NV, Math.max(1, m.n | 0));
      else if (t === 'bend') { if (typeof m.v === 'number' && Number.isFinite(m.v)) this.bend = m.v < -1 ? -1 : (m.v > 1 ? 1 : m.v); }
      else if (t === 'wheel') { if (typeof m.v === 'number' && Number.isFinite(m.v)) this.wheel = m.v < 0 ? 0 : (m.v > 1 ? 1 : m.v); }
      else if (t === 'sustain') this.setSustain(!!m.on);
    }

    process(inputs, outputs) {
      const out = outputs[0];
      const L = out[0];
      const R = out.length > 1 ? out[1] : null;
      const n = L.length;
      if (this.mixL.length < n) { this.mixL = new Float64Array(n); this.mixR = new Float64Array(n); }
      const mixL = this.mixL, mixR = this.mixR, pv = this.pv, sr = sampleRate, st = this.st, pin = this.pin;
      mixL.fill(0, 0, n); mixR.fill(0, 0, n);
      const tz = this.tz, ph1 = this.ph1, ph2 = this.ph2, ph3 = this.ph3, phs = this.phs, dph = this.dph;
      const hyR = this.hyR, hyLg = this.hyLg, hyRg = this.hyRg;
      let rs = this.rs;

      for (let s0 = 0; s0 < n; s0 += SUB) {
        const len = Math.min(SUB, n - s0);
        this.sCut += (Math.log2(pv[IX.cutoff]) - this.sCut) * 0.04;
        this.sRes += (pv[IX.res] - this.sRes) * 0.04;
        this.sDrv += (pv[IX.drive] - this.sDrv) * 0.04;
        this.sPdr += (pv[IX.pdrive] - this.sPdr) * 0.04;
        this.sEnv += (pv[IX.fenv] - this.sEnv) * 0.04;
        this.sVol += (pv[IX.vol] - this.sVol) * 0.04;
        this.sBend += (this.bend - this.sBend) * 0.3;
        this.sWheel += (this.wheel - this.sWheel) * 0.12;

        const w1 = Math.round(pv[IX.o1wave]), w2 = Math.round(pv[IX.o2wave]), w3 = Math.round(pv[IX.o3wave]);
        const pw1 = pv[IX.o1pw], pw2 = pv[IX.o2pw], pw3 = pv[IX.o3pw];
        const sy2 = pv[IX.o2sync] >= 1, sy3 = pv[IX.o3sync] >= 1;
        const l1 = pv[IX.o1lvl], l2 = pv[IX.o2lvl], l3 = pv[IX.o3lvl], ls = pv[IX.sublvl], ln = pv[IX.noise];
        const subSq = pv[IX.subwave] >= 1;
        const subOct = pv[IX.suboct] >= 1 ? -2 : -1;
        const tot = l1 * l1 + l2 * l2 + l3 * l3 + ls * ls + ln * ln;
        const mnorm = 1 / Math.sqrt(tot > 1 ? tot : 1);
        const m1 = l1 * mnorm, m2 = l2 * mnorm, m3 = l3 * mnorm, ms = ls * mnorm, mn = ln * mnorm;
        const hyper = w1 === 4;
        const stereo = hyper && pv[IX.hywid] > 0.001;
        const nb = this.hyN, jc = this.hyJc;
        const oct1 = Math.round(pv[IX.o1oct]) + pv[IX.o1semi] / 12, fn1 = pv[IX.o1fine];
        const oct2 = Math.round(pv[IX.o2oct]) + pv[IX.o2semi] / 12, fn2 = pv[IX.o2fine];
        const oct3 = Math.round(pv[IX.o3oct]) + pv[IX.o3semi] / 12, fn3 = pv[IX.o3fine];

        const mode = Math.round(pv[IX.fmode]);
        const k4 = 4 * this.sRes;
        const dg = 1 + 14 * this.sDrv * this.sDrv;
        const rcomp = pv[IX.rcomp];
        const skv = mode === 4 ? 1.4 * (1 - 0.95 * this.sRes) : 2 * (1 - 0.975 * this.sRes);
        let pre, comp;
        if (mode === 0) { pre = dg * (1 + rcomp * k4); comp = 1; }
        else { pre = dg; comp = 1 / (1 + rcomp * 0.03 * Math.max(0, 1 / skv - 0.5)); }
        const gp = 1 + 5 * this.sPdr;
        const pmk = this.sPdr > 0.0005 ? 1 / Math.pow(gp, 0.6) : 1;
        const velF = pv[IX.fvel], velA = pv[IX.avel];
        const kt = pv[IX.ktrack], ffm = pv[IX.ffm];
        const bendOct = this.sBend * pv[IX.bend] / 12;
        const whOct = this.sWheel * pv[IX.whcut];
        const drift = pv[IX.drift];
        const glide = pv[IX.glide];
        const ga = glide > 0.0005 ? 1 - Math.exp(-SUB / (sr * glide / 4.6)) : 1;
        const aInc = this.aInc, aDec = this.aDec, aRel = this.aRel, aSus = pv[IX.as];
        const fInc = this.fInc, fDec = this.fDec, fRel = this.fRel, fSus = pv[IX.fs];

        for (let v = 0; v < NV; v++) {
          if (this.aS[v] === 0) continue;
          const os = this.os[v];
          const vel = this.vel[v];

          // pitch: glide toward the note, then bend, drift and each oscillator's own tuning
          const tgt = (this.note[v] - 69) / 12;
          let cur = this.cur[v];
          cur = ga >= 1 ? tgt : cur + (tgt - cur) * ga;
          this.cur[v] = cur;
          let d1 = 0, d2 = 0, d3 = 0, dc = 0;
          if (drift > 0.0005) {
            const q = v * 3;
            dph[q] += SUB * 0.113 / sr; dph[q + 1] += SUB * 0.271 / sr; dph[q + 2] += SUB * 0.439 / sr;
            if (dph[q] >= 1) dph[q] -= 1; if (dph[q + 1] >= 1) dph[q + 1] -= 1; if (dph[q + 2] >= 1) dph[q + 2] -= 1;
            d1 = 6 * drift * Math.sin(TWO_PI * dph[q]);
            d2 = 6 * drift * Math.sin(TWO_PI * dph[q + 1]);
            d3 = 6 * drift * Math.sin(TWO_PI * dph[q + 2]);
            dc = 0.12 * drift * Math.sin(TWO_PI * (dph[q] + dph[q + 2]));
          }
          const fb = 440 * Math.pow(2, cur + bendOct);
          const dt1 = Math.min(0.45, fb * Math.pow(2, oct1 + (fn1 + d1) / 1200) / sr);
          const dt2 = Math.min(0.45, fb * Math.pow(2, oct2 + (fn2 + d2) / 1200) / sr);
          const dt3 = Math.min(0.45, fb * Math.pow(2, oct3 + (fn3 + d3) / 1200) / sr);
          const dts = Math.min(0.45, fb * Math.pow(2, subOct) / sr);

          // filter settings for this voice
          const fscale = this.fL[v] * ((1 - velF) + velF * vel);
          let fc = Math.pow(2, this.sCut + this.sEnv * fscale + whOct + kt * (cur + 0.75) + dc);
          const fmax = Math.min(20000, 0.45 * sr * os);
          fc = fc < 20 ? 20 : (fc > fmax ? fmax : fc);
          const gbase = mode === 0 ? 1 - Math.exp(-TWO_PI * fc / (sr * os)) : Math.tan(Math.PI * fc / (sr * os));
          const gmax = mode === 0 ? 0.95 : 6;
          F.mode = mode; F.os = os; F.k = k4; F.sk = skv;
          const post = 0.35 / Math.sqrt(dg) * ((1 - velA) + velA * vel) * comp * pmk;

          const b1 = v * HS;
          let p2 = ph2[v], p3 = ph3[v], ps = phs[v];
          for (let j = 0; j < len; j++) {
            const ae = stepEnv(this.aL, this.aS, v, aInc, aDec, aSus, aRel);
            stepEnv(this.fL, this.fS, v, fInc, fDec, fSus, fRel);

            // oscillator 1 (or the hypersaw); its centre phase is the sync master
            let hl, hr, wrap = false, wf = 0;
            if (hyper) {
              hl = 0; hr = 0;
              for (let jj = 0; jj < nb; jj++) {
                let p = ph1[b1 + jj];
                const dj = dt1 * hyR[jj];
                const x = 2 * p - 1 - blep(p, dj);
                p += dj;
                const wr = p >= 1;
                if (wr) p -= 1;
                ph1[b1 + jj] = p;
                if (jj === jc && wr) { wrap = true; wf = p / dj; }
                hl += x * hyLg[jj]; hr += x * hyRg[jj];
              }
              hl *= m1; hr *= m1;
            } else {
              let p = ph1[b1 + HB];
              hl = gen(w1 < 4 ? w1 : 0, p, dt1, pw1, tz, v * 3) * m1;
              hr = hl;
              p += dt1;
              if (p >= 1) { p -= 1; wrap = true; wf = p / dt1; }
              ph1[b1 + HB] = p;
            }

            // oscillators 2 and 3 (hard sync resets them when the master wraps), sub, noise
            const x2 = gen(w2, p2, dt2, pw2, tz, v * 3 + 1);
            p2 += dt2;
            if (p2 >= 1) p2 -= 1;
            if (sy2 && wrap) { p2 = wf * dt2; tz[v * 3 + 1] = -1; }
            const x3 = gen(w3, p3, dt3, pw3, tz, v * 3 + 2);
            p3 += dt3;
            if (p3 >= 1) p3 -= 1;
            if (sy3 && wrap) { p3 = wf * dt3; tz[v * 3 + 2] = -1; }
            let xs = 0;
            if (ms > 0) {
              xs = subSq ? (ps < 0.5 ? 1 : -1) + blep(ps, dts) - blep(ps < 0.5 ? ps + 0.5 : ps - 0.5, dts) : Math.sin(TWO_PI * ps);
            }
            ps += dts;
            if (ps >= 1) ps -= 1;
            let nz = 0;
            if (mn > 0) {
              rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
              nz = (rs >>> 0) / 2147483648 - 1;
            }

            const mono = x2 * m2 + x3 * m3 + xs * ms + nz * mn;
            let g = gbase;
            if (ffm > 0) { g = gbase * (1 + 3 * ffm * x2); g = g < 1e-4 ? 1e-4 : (g > gmax ? gmax : g); }

            const a = ae * post;
            const yl = fil(st, pin, v, 0, (hl + mono) * pre, g);
            const ol = gp > 1.0005 ? sat(yl * gp) : yl;
            mixL[s0 + j] += ol * a;
            if (stereo) {
              const yr = fil(st, pin, v, 1, (hr + mono) * pre, g);
              mixR[s0 + j] += (gp > 1.0005 ? sat(yr * gp) : yr) * a;
            } else {
              mixR[s0 + j] += ol * a;
            }
            if (this.aS[v] === 0) break;
          }
          ph2[v] = p2; ph3[v] = p3; phs[v] = ps;
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
          let ol = sat(mixL[s0 + j] * vg * pg);
          let or = sat(mixR[s0 + j] * vg * pg);
          if (ol !== ol) { ol = 0; this.nan++; }
          if (or !== or) { or = 0; this.nan++; }
          if (R) { L[s0 + j] = ol; R[s0 + j] = or; } else { L[s0 + j] = 0.5 * (ol + or); }
        }
      }

      this.rs = rs;
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

  registerProcessor('va-m2', VaM2);
})();
