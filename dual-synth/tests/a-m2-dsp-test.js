'use strict';
// Runs the built Synth A M2 worklet in Node with a stand-in AudioWorklet environment.
// Tests the DSP numbers only: not a browser, not Blob loading, nothing audible.
// Run build_m2.py first. Usage: node tests/a-m2-dsp-test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../dist/va-m2-worklet.js'), 'utf8');
const P = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../source/synth-a/params-m2.json'), 'utf8'));
const idx = {}; P.forEach((p, i) => { idx[p.id] = i; });
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); }
function info(m) { console.log('INFO ' + m); }

function make(sr) {
  const reg = {}, msgs = [];
  class AWP { constructor() { this.port = { onmessage: null, postMessage: (m) => msgs.push(m) }; } }
  const M = {}; Object.getOwnPropertyNames(Math).forEach((k) => { M[k] = Math[k]; });
  M.random = () => { throw new Error('Math.random called'); };
  const sb = { AudioWorkletProcessor: AWP, registerProcessor: (n, c) => { reg[n] = c; }, sampleRate: sr, Math: M };
  vm.createContext(sb); vm.runInContext(src, sb);
  const p = new reg['va-m2']();
  return { sr, reg, msgs, p, send: (m) => p.port.onmessage({ data: m }) };
}
// Set parameters by id. Quiet defaults for measuring one thing at a time: no env sweep, filter open, no drift.
function set(e, o) { Object.keys(o).forEach((k) => { if (!(k in idx)) throw new Error('unknown param ' + k); e.send({ t: 'param', i: idx[k], v: o[k] }); }); }
const CLEAN = { fenv: 0, cutoff: 20000, res: 0, drive: 0, drift: 0, fvel: 0, avel: 0, ad: 0.001, as: 1, aa: 0.001, vol: 1 };
function clean(sr, o) { const e = make(sr || SR); set(e, CLEAN); if (o) set(e, o); return e; }
function run2(e, secs) {
  const blocks = Math.ceil(secs * e.sr / 128), L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128);
  let alwaysTrue = true;
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    if (e.p.process([], [[l, r]], {}) !== true) alwaysTrue = false;
    L.set(l, b * 128); R.set(r, b * 128);
  }
  return { L, R, alwaysTrue };
}
const run = (e, s) => run2(e, s).L;
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const finite = (x) => x.every(Number.isFinite);
const db = (v) => (20 * Math.log10(v)).toFixed(1) + ' dBFS';
// Latest status message. Status is posted about 4 times a second, so keep running until one reflects the present.
const last = (e) => { const n = e.msgs.length; for (let i = 0; i < 40 && e.msgs.length === n; i++) { const l = new Float32Array(128), r = new Float32Array(128); e.p.process([], [[l, r]], {}); } return e.msgs.filter((m) => m.t === 'status').pop(); };
const on = (e, id, note, vel) => e.send({ t: 'noteOn', id, note, vel: vel === undefined ? 1 : vel, ch: 0 });
const off = (e, id) => e.send({ t: 'noteOff', id });
const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Fundamental by autocorrelation: the first strong peak, so a multiple of the period is never chosen.
function f0(o, sr, from, len, lo, hi) {
  const a = from, N = len; let best = -1, acf = [];
  const minLag = Math.floor(sr / (hi || 4000)), maxLag = Math.floor(sr / (lo || 40));
  let e0 = 0; for (let i = 0; i < N; i++) e0 += o[a + i] * o[a + i];
  for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i < N; i++) s += o[a + i] * o[a + i + lag]; acf[lag] = s / e0; if (s / e0 > best) best = s / e0; }
  for (let lag = minLag + 1; lag < maxLag; lag++) if (acf[lag] >= 0.9 * best && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) {
    const y0 = acf[lag - 1], y1 = acf[lag], y2 = acf[lag + 1], d = y0 - 2 * y1 + y2;
    return { f: sr / (lag + (d !== 0 ? 0.5 * (y0 - y2) / d : 0)), strength: best };
  }
  return { f: 0, strength: best };
}
// Energy of one frequency (Goertzel).
function gz(o, sr, f, a, len) {
  const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const s = o[a + i] + c * s1 - s2; s2 = s1; s1 = s; }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (len * len);
}
const SR = 48000;
const harm = (o, f, hi, a, len) => { let t = 0; for (let h = 1; h * f < hi; h++) t += gz(o, SR, h * f, a, len); return t; };
const harmBand = (o, f, lo, hi, a, len) => { let t = 0; for (let h = 1; h * f < hi; h++) if (h * f >= lo) t += gz(o, SR, h * f, a, len); return t; };
function centroidH(o, f, a, len) { let num = 0, den = 0; for (let h = 1; h * f < 18000; h++) { const e = gz(o, SR, h * f, a, len); num += h * e; den += e; } return num / den; }

// ---------------------------------------------------------------- basics
{ const e = make(SR); let threw = false;
  try { vm.runInContext('Math.random()', vm.createContext({ Math: { random: () => { throw 1; } } })); } catch (x) { threw = true; }
  ok(threw && Object.keys(e.reg).join() === 'va-m2', 'registers exactly va-m2 (Math.random trap active)'); }
{ const e = make(SR); const r = run2(e, 0.5); ok(r.alwaysTrue && peak(r.L) === 0 && peak(r.R) === 0, 'silent with no notes, process() returns true, both channels'); }
{ const e = make(SR); const r = run2(e, 3); ok(r.alwaysTrue && peak(r.L) === 0, 'defaults: no notes, 3 s later still exactly silent'); }


// ---------------------------------------------------------------- M2 must keep M1's sound at default settings
{
  const m1p = path.resolve(__dirname, '../dist/va-m1-worklet.js');
  if (!fs.existsSync(m1p)) info('M1 worklet not built, regression check against M1 skipped');
  else {
    const m1src = fs.readFileSync(m1p, 'utf8');
    const mk1 = () => { const reg = {}; class A { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
      const sb = { AudioWorkletProcessor: A, registerProcessor: (n, c) => { reg[n] = c; }, sampleRate: SR, Math }; vm.createContext(sb); vm.runInContext(m1src, sb);
      const p = new reg['va-m1'](); return { p, send: (m) => p.port.onmessage({ data: m }) }; };
    const chord = [60, 64, 67, 72, 48, 55];
    const a = mk1(); chord.forEach((n, i) => a.send({ t: 'noteOn', id: i + 1, note: n, vel: 0.9, ch: 0 }));
    const b = make(SR); set(b, { drift: 0 }); chord.forEach((n, i) => on(b, i + 1, n, 0.9));
    let md = 0, n = 0; for (let k = 0; k < 600; k++) { const l1 = new Float32Array(128), r1 = new Float32Array(128), l2 = new Float32Array(128), r2 = new Float32Array(128);
      a.p.process([], [[l1, r1]], {}); b.p.process([], [[l2, r2]], {}); for (let i = 0; i < 128; i++) { md = Math.max(md, Math.abs(l1[i] - l2[i]), Math.abs(l1[i] - r2[i])); n++; } }
    ok(md < 1e-6, 'regression: M2 default patch with drift 0 reproduces M1 for a 6-note chord (largest sample difference ' + md.toExponential(1) + ' over ' + n + ' samples)');
  }
}

// ---------------------------------------------------------------- oscillators: pitch of every waveform
['Saw', 'Pulse', 'Tri', 'Sine'].forEach((nm, w) => {
  const e = clean(SR, { o1wave: w }); on(e, 1, 69); const o = run(e, 1.5);
  const r = f0(o, SR, 24000, 8192, 100, 2000);
  ok(finite(o) && peak(o) > 0.05 && Math.abs(r.f - 440) / 440 < 0.01, 'osc 1 ' + nm + ': A4 measures ' + r.f.toFixed(2) + ' Hz (target 440 +/- 1%)');
});
{ // octave, semitone and fine tune on osc 2, osc 1 silent
  const cases = [['octave +1', { o2oct: 1 }, 880], ['octave -1', { o2oct: -1 }, 220], ['+7 semitones', { o2semi: 7 }, 440 * Math.pow(2, 7 / 12)], ['+50 cents', { o2fine: 50 }, 440 * Math.pow(2, 50 / 1200)]];
  cases.forEach(([nm, o, want]) => {
    const e = clean(SR, Object.assign({ o1lvl: 0, o2lvl: 1, o2wave: 3 }, o)); on(e, 1, 69); const x = run(e, 1.5);
    const r = f0(x, SR, 24000, 8192, 100, 2000); ok(Math.abs(r.f - want) / want < 0.005, 'osc 2 ' + nm + ': ' + r.f.toFixed(2) + ' Hz (target ' + want.toFixed(2) + ')');
  });
}
{ // pulse width changes the spectrum (even harmonics appear when not 50%)
  const mk = (pw) => { const e = clean(SR, { o1wave: 1, o1pw: pw }); on(e, 1, 57); return run(e, 1.2); };
  const a = mk(0.5), b = mk(0.2), f = midiHz(57);
  const r50 = gz(a, SR, 2 * f, 24000, 16384) / gz(a, SR, f, 24000, 16384), r20 = gz(b, SR, 2 * f, 24000, 16384) / gz(b, SR, f, 24000, 16384);
  ok(r50 < 0.001 && r20 > 0.1, 'pulse width: 2nd harmonic / fundamental is ' + r50.toExponential(1) + ' at 50% and ' + r20.toFixed(2) + ' at 20%');
}
{ // aliasing: a 2.5 kHz saw should have little energy at the non-harmonic frequencies below it
  const e = clean(SR, { o1wave: 0 }); on(e, 1, 100); const o = run(e, 1.0);   // ~2637 Hz
  const f = midiHz(100); let sig = 0, alias = 0;
  for (let h = 1; h * f < 20000; h++) { const e1 = gz(o, SR, h * f, 20000, 16384); if (h * f < 20000) sig += e1; }
  for (let fa = 500; fa < 20000; fa += 137.3) { const r = Math.abs(fa / f - Math.round(fa / f)) * f; if (r > 150) alias += gz(o, SR, fa, 20000, 16384) / (20000 / 137.3); }
  info('saw at ' + f.toFixed(0) + ' Hz: mean energy at non-harmonic frequencies is ' + (10 * Math.log10(alias / sig)).toFixed(1) + ' dB relative to the harmonics');
  ok(10 * Math.log10(alias / sig) < -35, 'polyBLEP saw at ~2.6 kHz: non-harmonic energy below -35 dB relative to the harmonics');
}
{ // sub oscillator, osc 1 silent
  [['-1', 0, 220], ['-2', 1, 110]].forEach(([nm, so, want]) => {
    const e = clean(SR, { o1lvl: 0, sublvl: 1, suboct: so }); on(e, 1, 69); const x = run(e, 1.5);
    const r = f0(x, SR, 24000, 12288, 50, 1000); ok(Math.abs(r.f - want) / want < 0.005, 'sub octave ' + nm + ': ' + r.f.toFixed(2) + ' Hz (target ' + want + ')');
  });
  const e = clean(SR, { o1lvl: 0, sublvl: 1, subwave: 1 }); on(e, 1, 69); const x = run(e, 1.5);
  ok(finite(x) && peak(x) > 0.1 && Math.abs(f0(x, SR, 24000, 12288, 50, 1000).f - 220) < 2, 'sub square wave plays 220 Hz');
}
{ // noise: broadband, zero mean, deterministic
  const mk = () => { const e = clean(SR, { o1lvl: 0, noise: 1 }); on(e, 1, 60); return run(e, 1); };
  const a = mk(), b = mk(); let mean = 0; for (let i = 24000; i < 48000; i++) mean += a[i]; mean /= 24000;
  let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  const r = f0(a, SR, 24000, 8192, 60, 2000);
  ok(rms(a, 24000, 48000) > 0.1 && Math.abs(mean) < 0.02 && r.strength < 0.3 && same, 'noise: rms ' + rms(a, 24000, 48000).toFixed(2) + ', mean ' + mean.toFixed(4) + ', no strong periodicity (' + r.strength.toFixed(2) + '), identical on a second run');
}

// ---------------------------------------------------------------- hard sync
{
  const base = { o1lvl: 0, o2lvl: 1, o2wave: 0, o2semi: 7 };
  const e1 = clean(SR, Object.assign({ o2sync: 1 }, base)); on(e1, 1, 57); const a = run(e1, 1.5);
  const e0 = clean(SR, base); on(e0, 1, 57); const b = run(e0, 1.5);
  const fa = f0(a, SR, 24000, 12288, 50, 1500).f, fb = f0(b, SR, 24000, 12288, 50, 1500).f;
  ok(finite(a) && Math.abs(fa - midiHz(57)) / midiHz(57) < 0.01 && Math.abs(fb - midiHz(57) * Math.pow(2, 7 / 12)) / fb < 0.01,
    'hard sync: osc 2 (+7 st) repeats at osc 1 pitch (' + fa.toFixed(1) + ' Hz, want ' + midiHz(57).toFixed(1) + '); without sync it plays its own (' + fb.toFixed(1) + ' Hz)');
  info('sync is not band-limited in M2 (documented limit); it only fixes the period, with plain fractional-phase reset');
}

// ---------------------------------------------------------------- hypersaw
{
  const note = 57, f = midiHz(note);
  const mk = (o) => { const e = clean(SR, Object.assign({ o1wave: 4 }, o)); on(e, 1, note); return run2(e, 2.0); };
  const hs = mk({ hywid: 0 }), single = (() => { const e = clean(SR, {}); on(e, 1, note); return run2(e, 2.0); })();
  // Beating = the level changes from one period to the next. A single saw has a constant level; detuned blades do not.
  const beat = (r) => { const lag = Math.round(SR / f), v = []; for (let a = 24000; a + lag < 24000 + 40000; a += lag) v.push(rms(r.L, a, a + lag));
    const m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / v.length) / m; };
  ok(finite(hs.L) && beat(single) < 0.005 && beat(hs) > 0.03, 'hypersaw beating: level wobble across periods is ' + (100 * beat(single)).toFixed(2) + '% for a single saw and ' + (100 * beat(hs)).toFixed(1) + '% for the hypersaw (default detune)');
  let identical = true; for (let i = 0; i < hs.L.length; i++) if (hs.L[i] !== hs.R[i]) { identical = false; break; }
  ok(identical, 'hypersaw at width 0: left and right are identical');
  const w = mk({ hywid: 0.6 }); let diff = 0; for (let i = 48000; i < 64000; i++) diff = Math.max(diff, Math.abs(w.L[i] - w.R[i]));
  ok(diff > 0.02, 'hypersaw at width 0.6: channels differ (largest difference ' + diff.toFixed(3) + ')');
  const mono = new Float32Array(w.L.length); for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (w.L[i] + w.R[i]);
  const st = Math.sqrt(0.5 * (Math.pow(rms(w.L, 24000), 2) + Math.pow(rms(w.R, 24000), 2)));
  const loss = 20 * Math.log10(rms(mono, 24000) / st);
  ok(loss > -3, 'hypersaw mono-safe: summing L+R to mono changes the level by ' + loss.toFixed(2) + ' dB at width 0.6 (limit -3 dB)');
  const wmax = mk({ hywid: 1 }); const m2 = new Float32Array(wmax.L.length); for (let i = 0; i < m2.length; i++) m2[i] = 0.5 * (wmax.L[i] + wmax.R[i]);
  const lossMax = 20 * Math.log10(rms(m2, 24000) / Math.sqrt(0.5 * (Math.pow(rms(wmax.L, 24000), 2) + Math.pow(rms(wmax.R, 24000), 2))));
  info('mono collapse at width 1.0: ' + lossMax.toFixed(2) + ' dB');
  const n9 = mk({ hyn: 1 }), n7 = mk({ hyn: 0 }); let dd = 0; for (let i = 24000; i < 32000; i++) dd = Math.max(dd, Math.abs(n9.L[i] - n7.L[i]));
  ok(finite(n9.L) && dd > 0.01, '7 and 9 blades both run and sound different');
  const lo = mk({ hydet: 0.05 }), hi = mk({ hydet: 1 });
  const spread = (r) => { let t = 0, c = 0; for (let df = -80; df <= 80; df += 2) { const e1 = gz(r.L, SR, f + df, 24000, 24000); t += Math.abs(df) * e1; c += e1; } return t / c; };
  ok(spread(hi) > 2 * spread(lo), 'hypersaw detune: energy spread around the pitch is ' + spread(lo).toFixed(1) + ' Hz at detune 0.05 and ' + spread(hi).toFixed(1) + ' Hz at 1.0');
}

// ---------------------------------------------------------------- filters
{
  // saw at A2, cutoff 800, no resonance. Compare what each filter type does to low and high harmonics.
  const f = midiHz(45);
  const mk = (o) => { const e = clean(SR, Object.assign({ cutoff: 800 }, o)); on(e, 1, 45); return run(e, 1.5); };
  const bands = (o) => ({ low: harmBand(o, f, 80, 400, 24000, 16384), mid: harmBand(o, f, 600, 1200, 24000, 16384), high: harmBand(o, f, 3000, 9000, 24000, 16384) });
  const open = bands(mk({ fmode: 1, cutoff: 20000 })), l24 = bands(mk({ fmode: 0 })), l12 = bands(mk({ fmode: 1 })), bp = bands(mk({ fmode: 2 })), hp = bands(mk({ fmode: 3 })), bite = bands(mk({ fmode: 4 }));
  const r = (b) => b.high / b.low;
  ok(r(l24) < r(l12) && r(l12) < r(open), 'low-pass: high/low energy ratio falls from open (' + r(open).toExponential(1) + ') to LP 12 (' + r(l12).toExponential(1) + ') to LP 24 (' + r(l24).toExponential(1) + ')');
  ok(r(hp) > r(open), 'high-pass 12: removes lows (high/low ratio ' + r(hp).toExponential(1) + ' vs open ' + r(open).toExponential(1) + ')');
  ok(bp.low / bp.mid < open.low / open.mid && bp.high / bp.mid < open.high / open.mid, 'band-pass 12: both low and high fall away relative to the middle');
  ok(r(bite) < r(open) && Number.isFinite(r(bite)), 'bite: still a low-pass (high/low ratio ' + r(bite).toExponential(1) + ')');
  const slope = (b24, b12) => 10 * Math.log10(b12.high / b24.high);
  info('LP 24 has ' + slope(l24, l12).toFixed(1) + ' dB less energy than LP 12 in the 3-9 kHz band');
}
{ // every filter type is stable and quiet on silence input, and resonance raises a peak at the cutoff
  [0, 1, 2, 3, 4].forEach((m) => {
    const e = clean(SR, { fmode: m, cutoff: 1000, res: 1, drive: 1, pdrive: 1 }); [36, 48, 60, 72].forEach((n, i) => on(e, i + 1, n, 1)); const o = run(e, 1.5);
    ok(finite(o) && peak(o) <= 1, 'filter type ' + ['LP 24', 'LP 12', 'BP 12', 'HP 12', 'Bite'][m] + ' at max resonance and drive: finite, peak ' + db(peak(o)));
  });
  const f = midiHz(45); const mk = (res) => { const e = clean(SR, { fmode: 1, cutoff: 1000, res }); on(e, 1, 45); return run(e, 1.5); };
  const a = mk(0), b = mk(0.85);
  const peakE = (o) => { let m = 0; for (let h = 1; h * f < 3000; h++) { const hz = h * f; if (hz > 700 && hz < 1500) m = Math.max(m, gz(o, SR, hz, 24000, 16384)); } return m; };
  ok(peakE(b) > 3 * peakE(a), 'resonance: LP 12 boosts the harmonics near the cutoff (' + (10 * Math.log10(peakE(b) / peakE(a))).toFixed(1) + ' dB)');
}
{ // key tracking: with tracking on, brightness relative to the pitch stays the same across octaves
  const cen = (kt, note) => { const e = clean(SR, { cutoff: 600, fmode: 1, ktrack: kt }); on(e, 1, note); return centroidH(run(e, 1.5), midiHz(note), 24000, 16384); };
  const r0 = cen(0, 69) / cen(0, 45), r1 = cen(1, 69) / cen(1, 45);
  ok(Math.abs(r1 - 1) < 0.35 && Math.abs(r1 - 1) < Math.abs(r0 - 1), 'key tracking: brightness (in harmonics) of A4 vs A2 is ' + r0.toFixed(2) + ' with tracking off and ' + r1.toFixed(2) + ' with it fully on (1.0 = same)');
}
{ // filter FM: osc 2 modulates the cutoff, which must change the sound and stay stable
  const mk = (ffm) => { const e = clean(SR, { cutoff: 1500, fmode: 1, res: 0.5, o2lvl: 0, o2wave: 3, o2oct: 1, ffm }); on(e, 1, 45); return run(e, 1); };
  const a = mk(0), b = mk(1); let d = 0; for (let i = 24000; i < 30000; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  ok(finite(b) && peak(b) <= 1 && d > 0.02, 'filter FM: changes the sound (largest difference ' + d.toFixed(3) + ') and stays finite');
}
{ // drive: pre-drive adds harmonics, post-drive limits level, both stay bounded
  const f = midiHz(45); const mk = (o) => { const e = clean(SR, Object.assign({ o1wave: 3, fmode: 1, cutoff: 8000 }, o)); on(e, 1, 45); return run(e, 1.2); };
  const clean_ = mk({ drive: 0 }), driven = mk({ drive: 1 });
  const h3 = (o) => gz(o, SR, 3 * f, 24000, 16384) / gz(o, SR, f, 24000, 16384);
  ok(h3(driven) > 10 * h3(clean_) + 1e-9, 'drive in: a sine gains harmonics (3rd/1st ' + h3(clean_).toExponential(1) + ' -> ' + h3(driven).toExponential(1) + ')');
  const p0 = mk({ pdrive: 0 }), p1 = mk({ pdrive: 1 });
  ok(finite(p1) && peak(p1) <= 1 && h3(p1) > h3(p0), 'drive out: adds harmonics and stays bounded');
}

// ---------------------------------------------------------------- performance
{ // pitch bend
  const e = clean(SR, { bend: 2 }); e.send({ t: 'bend', v: 1 }); on(e, 1, 69); const o = run(e, 1.5);
  const r = f0(o, SR, 36000, 8192, 100, 2000), want = 440 * Math.pow(2, 2 / 12);
  ok(Math.abs(r.f - want) / want < 0.01, 'pitch bend +1 with range 2: ' + r.f.toFixed(1) + ' Hz (target ' + want.toFixed(1) + ')');
  const e2 = clean(SR, { bend: 12 }); e2.send({ t: 'bend', v: -1 }); on(e2, 1, 69); const o2 = run(e2, 1.5);
  const r2 = f0(o2, SR, 36000, 12288, 50, 1000); ok(Math.abs(r2.f - 220) / 220 < 0.01, 'pitch bend -1 with range 12: ' + r2.f.toFixed(1) + ' Hz (target 220)');
  e.send({ t: 'bend', v: Infinity }); e.send({ t: 'bend', v: 'x' }); ok(finite(run(e, 0.1)), 'bend ignores non-finite and non-numeric values');
}
{ // mod wheel opens the filter
  const mk = (w) => { const e = clean(SR, { cutoff: 400, fmode: 1, whcut: 3 }); e.send({ t: 'wheel', v: w }); on(e, 1, 45); return run(e, 1.5); };
  const f = midiHz(45), a = harmBand(mk(0), f, 1500, 9000, 24000, 16384), b = harmBand(mk(1), f, 1500, 9000, 24000, 16384);
  ok(b > 10 * a, 'mod wheel to cutoff: high-frequency energy rises ' + (10 * Math.log10(b / a)).toFixed(1) + ' dB with the wheel at 1');
}
{ // sustain pedal
  const e = clean(SR, { ar: 0.1 }); e.send({ t: 'sustain', on: true }); on(e, 1, 60); run(e, 0.3); off(e, 1);
  const o = run(e, 1.5); const s = last(e);
  ok(peak(o, 24000) > 0.1 && s.voices === 1, 'sustain pedal down: note released by the key keeps sounding (' + s.voices + ' voice, peak ' + db(peak(o, 24000)) + ')');
  e.send({ t: 'sustain', on: false }); const o2 = run(e, 2);
  ok(last(e).voices === 0 && peak(o2, o2.length - 12000) < 1e-9, 'sustain pedal up: the held note releases and ends');
  const e2 = clean(SR); e2.send({ t: 'sustain', on: true }); on(e2, 1, 60); off(e2, 1); run(e2, 0.2); e2.send({ t: 'allNotesOff' }); run(e2, 2);
  ok(last(e2).voices === 0, 'all notes off overrides the sustain pedal');
}
{ // mono mode
  const e = clean(SR, { mode: 1 }); on(e, 1, 60); run(e, 0.3); on(e, 2, 64); const o = run(e, 1.0); const s = last(e);
  const r = f0(o, SR, 24000, 8192, 100, 2000);
  ok(s.voices === 1 && Math.abs(r.f - midiHz(64)) / midiHz(64) < 0.01, 'mono: two held keys make one voice playing the newest note (' + r.f.toFixed(1) + ' Hz, want ' + midiHz(64).toFixed(1) + ')');
  off(e, 2); const o2 = run(e, 1.0); const r2 = f0(o2, SR, 24000, 8192, 100, 2000);
  ok(Math.abs(r2.f - midiHz(60)) / midiHz(60) < 0.01, 'mono: releasing the newest key falls back to the earlier held key (' + r2.f.toFixed(1) + ' Hz, want ' + midiHz(60).toFixed(1) + ')');
  off(e, 1); run(e, 2); ok(last(e).voices === 0, 'mono: releasing the last key ends the note');
  const e3 = clean(SR, { mode: 1 }); for (let i = 0; i < 6; i++) on(e3, i + 1, 50 + i); run(e3, 0.3); ok(last(e3).voices === 1 && last(e3).steals === 0, 'mono: six keys at once never use a second voice');
}
{ // legato: a new overlapping key does not restart the envelopes, mono does
  const mk = (mode) => { const e = clean(SR, { mode, ad: 0.5, as: 0.5 }); on(e, 1, 60); run(e, 0.2); const before = e.p.aS[0]; on(e, 2, 64); return { before, after: e.p.aS[0], aL: e.p.aL[0] }; };
  const lg = mk(2), mo = mk(1);
  ok(lg.before === 2 && lg.after === 2, 'legato: overlapping key leaves the envelope in decay (stage ' + lg.before + ' -> ' + lg.after + ')');
  ok(mo.before === 2 && mo.after === 1, 'mono: overlapping key restarts the envelope (stage ' + mo.before + ' -> ' + mo.after + ')');
}
{ // glide: pitch slides from the previous note to the new one
  const e = clean(SR, { glide: 0.6, mode: 2 }); on(e, 1, 60); run(e, 0.5); on(e, 2, 72);
  const early = f0(run(e, 0.12), SR, 1000, 4096, 100, 2000), late = f0((() => { run(e, 1.2); return run(e, 0.3); })(), SR, 1000, 4096, 100, 2000);
  ok(early.f > midiHz(60) * 1.02 && early.f < midiHz(72) * 0.98, 'glide: shortly after the new key the pitch is part-way (' + early.f.toFixed(0) + ' Hz between ' + midiHz(60).toFixed(0) + ' and ' + midiHz(72).toFixed(0) + ')');
  ok(Math.abs(late.f - midiHz(72)) / midiHz(72) < 0.01, 'glide: arrives at the new note (' + late.f.toFixed(1) + ' Hz, want ' + midiHz(72).toFixed(1) + ')');
  const e0 = clean(SR, { glide: 0 }); on(e0, 1, 60); run(e0, 0.4); off(e0, 1); run(e0, 0.5); on(e0, 2, 72); const n0 = f0(run(e0, 0.4), SR, 4000, 4096, 100, 2000);
  ok(Math.abs(n0.f - midiHz(72)) / midiHz(72) < 0.01, 'glide off: next note is in tune immediately');
}
{ // drift: zero is exact, nonzero is bounded and deterministic
  const mk = (d) => { const e = clean(SR, { drift: d, o1wave: 3, o2lvl: 0 }); on(e, 1, 69); return run(e, 3); };
  const z = mk(0), z2 = mk(0), dr = mk(1), dr2 = mk(1);
  const fz = f0(z, SR, 24000, 12288, 100, 2000).f, tail = f0(dr, SR, 120000, 12288, 100, 2000).f;
  const cents = (f) => 1200 * Math.log2(f / 440);
  let same = true; for (let i = 0; i < dr.length; i++) if (dr[i] !== dr2[i]) { same = false; break; }
  ok(Math.abs(cents(fz)) < 0.5, 'drift 0: pitch exact (' + cents(fz).toFixed(3) + ' cents off)');
  ok(Math.abs(cents(tail)) < 10 && same, 'drift 1: pitch wanders only ' + cents(tail).toFixed(2) + ' cents (bound 10) and repeats exactly on a second run');
  let zsame = true; for (let i = 0; i < z.length; i++) if (z[i] !== z2[i]) { zsame = false; break; }
  ok(zsame, 'drift 0: two runs are bit-identical');
}

// ---------------------------------------------------------------- levels (calibration patches)
{
  const e = make(SR); [60, 64, 67, 72].forEach((n, i) => on(e, i + 1, n, 1)); const o = run(e, 1.5);
  ok(finite(o) && peak(o) < 0.5, 'M1-style default patch, 4-note chord at full velocity: peak ' + db(peak(o)) + ' (headroom target >= 6 dB)');
}
{
  const cal = { o1wave: 4, hyn: 0, cutoff: 3000, res: 0.3, fenv: 2 };
  const e = make(SR); set(e, cal); [60, 64, 67, 72].forEach((n, i) => on(e, i + 1, n, 1)); const r = run2(e, 2);
  const pk = Math.max(peak(r.L), peak(r.R));
  ok(finite(r.L) && pk < 0.5, 'calibration patch A (7-blade hypersaw lead, LP 24, default volume), 4-note chord at full velocity: peak ' + db(pk) + ' (target <= -6 dBFS)');
  const e2 = make(SR); set(e2, Object.assign({}, cal, { hyn: 1, hydet: 1, hymix: 1, hywid: 1, o2lvl: 1, o2semi: 7, o3lvl: 1, o3oct: -1, sublvl: 1, noise: 0.3 }));
  [48, 55, 60, 64, 67, 72].forEach((n, i) => on(e2, i + 1, n, 1)); const r2 = run2(e2, 2);
  info('stress patch (9 blades, all oscillators, sub, noise, 6 notes) peak ' + db(Math.max(peak(r2.L), peak(r2.R))) + ' at default volume');
  ok(finite(r2.L) && Math.max(peak(r2.L), peak(r2.R)) <= 1, 'stress patch: output limited to +/-1 and finite');
}

// ---------------------------------------------------------------- stability, voices, panic, determinism
{ // parameter abuse: random-looking (seeded) settings, every filter type
  let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let allFinite = true, worst = 0, nanTotal = 0;
  for (let trial = 0; trial < 24; trial++) {
    const e = make(SR);
    P.forEach((p, i) => { e.send({ t: 'param', i, v: p.min + rnd() * (p.max - p.min) }); });
    e.send({ t: 'bend', v: rnd() * 2 - 1 }); e.send({ t: 'wheel', v: rnd() });
    for (let i = 0; i < 10; i++) on(e, i + 1, 24 + Math.floor(rnd() * 80), rnd());
    const r = run2(e, 0.5); if (!finite(r.L) || !finite(r.R)) allFinite = false; worst = Math.max(worst, peak(r.L), peak(r.R));
    nanTotal += last(e) ? last(e).nan : 0;
  }
  ok(allFinite && worst <= 1 && nanTotal === 0, '24 random patches, 10 notes each: always finite, peak <= 1 (' + db(worst) + '), repaired samples ' + nanTotal);
}
{ // worst case at every sample rate and quality
  [44100, 48000, 96000].forEach((sr) => [1, 2].forEach((q) => {
    const e = make(sr); e.send({ t: 'quality', q }); set(e, { o1wave: 4, hyn: 1, o2lvl: 1, o3lvl: 1, sublvl: 1, cutoff: 20000, res: 1, drive: 1 });
    [36, 43, 48, 55, 60, 67, 72, 79].forEach((n, i) => on(e, i + 1, n, 1)); const r = run2(e, 1);
    ok(finite(r.L) && finite(r.R) && peak(r.L) <= 1 && peak(r.L) > 0.01, 'sample rate ' + sr + ', ' + (q === 1 ? 'Eco' : 'Studio') + ', worst case, 8 hypersaw notes: finite, peak ' + db(Math.max(peak(r.L), peak(r.R))));
  }));
}
{ // voices free after release; stealing; limit
  const e = clean(SR); on(e, 1, 60); on(e, 2, 64); run(e, 0.5); off(e, 1); off(e, 2); const o = run(e, 4);
  ok(last(e).voices === 0 && peak(o, o.length - 24000) < 1e-9, 'after note off: voices freed, tail silent');
  const e2 = make(SR); for (let i = 0; i < 20; i++) on(e2, 100 + i, 40 + i, 0.8); const o2 = run(e2, 0.3);
  ok(finite(o2) && last(e2).voices <= 8 && last(e2).steals === 12, 'voice limit 8: ' + last(e2).voices + ' sounding, ' + last(e2).steals + ' stolen (expect 12)');
  const e3 = make(SR); e3.send({ t: 'voices', n: 16 }); for (let i = 0; i < 16; i++) on(e3, i + 1, 40 + i, 0.8); run(e3, 0.2); ok(last(e3).voices === 16 && last(e3).steals === 0, 'voice limit 16: all 16 sound, none stolen');
}
{ // panic, including the sustain pedal and mono stack
  const e = make(SR); e.send({ t: 'sustain', on: true }); for (let i = 0; i < 4; i++) on(e, i + 1, 55 + i * 4, 1); run(e, 0.3);
  e.send({ t: 'panic' }); run(e, 0.03); const o = run(e, 0.05); const active = Array.from(e.p.aS).filter((x) => x !== 0).length;
  ok(peak(o) === 0 && active === 0, 'panic: silent and all voices cleared within about 30 ms (voices left: ' + active + ')');
  on(e, 9, 60); const o2 = run(e, 0.3); ok(peak(o2) > 0.01 && e.p.sus === 0, 'after panic: new notes play again and the pedal state was reset');
}
{ // determinism with every feature on
  const f = () => { const e = make(SR); set(e, { o1wave: 4, o2lvl: 0.7, o2sync: 1, o2semi: 5, o3lvl: 0.5, o3wave: 2, sublvl: 0.5, noise: 0.2, ffm: 0.4, drift: 0.5, fmode: 4, glide: 0.1 });
    e.send({ t: 'bend', v: 0.3 }); [57, 64, 69].forEach((n, i) => on(e, i + 1, n, 0.7)); return run2(e, 1); };
  const a = f(), b = f(); let same = true; for (let i = 0; same && i < a.L.length; i++) if (a.L[i] !== b.L[i] || a.R[i] !== b.R[i]) same = false;
  ok(same, 'determinism: two identical runs with every feature on are bit-identical');
}
{ // note start is click-free
  const e = make(SR); run(e, 0.01); on(e, 1, 60, 1); const o = run(e, 0.05);
  ok(Math.abs(o[0]) < 0.05, 'note start: first sample ' + o[0].toExponential(1) + '; attack ramps from silence');
}
{ // bad messages never break it
  const e = make(SR);
  [null, undefined, 5, 'x', {}, { t: 7 }, { t: 'noteOn' }, { t: 'noteOn', note: 'a' }, { t: 'noteOn', note: 500 }, { t: 'param', i: -1, v: 1 }, { t: 'param', i: 9999, v: 1 }, { t: 'param', i: 0, v: NaN },
   { t: 'param', i: idx.cutoff, v: 'high' }, { t: 'patch', values: 3 }, { t: 'voices', n: -5 }, { t: 'quality', q: 'x' }, { t: 'sustain' }, { t: 'noteOff', id: 'zz' }].forEach((m) => e.send(m));
  on(e, 1, 60); ok(finite(run(e, 0.2)) && last(e) !== undefined, 'malformed messages are ignored and the engine keeps working');
}
{ // setting a patch loads all values, clamped
  const e = make(SR); const vals = P.map((p) => p.def); vals[idx.cutoff] = 99999; vals[idx.o1wave] = 3.4; e.send({ t: 'patch', values: vals });
  ok(e.p.pv[idx.cutoff] === 20000 && e.p.pv[idx.o1wave] === 3, 'patch message: values clamped to range, choice values rounded');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
