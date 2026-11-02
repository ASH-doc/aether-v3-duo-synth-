'use strict';
// Runs the built Synth A M1 worklet in Node with a stand-in AudioWorklet environment.
// Tests the DSP numbers only: not a browser, not Blob loading, nothing audible.
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../dist/va-m1-worklet.js'), 'utf8');
const P = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../source/synth-a/params.json'), 'utf8'));
const idx = {}; P.forEach((p, i) => { idx[p.id] = i; });
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); }

function make(sr) {
  const reg = {}, msgs = [];
  class AWP { constructor() { this.port = { onmessage: null, postMessage: (m) => msgs.push(m) }; } }
  const M = {}; Object.getOwnPropertyNames(Math).forEach((k) => { M[k] = Math[k]; });
  M.random = () => { throw new Error('Math.random called'); };
  const sb = { AudioWorkletProcessor: AWP, registerProcessor: (n, c) => { reg[n] = c; }, sampleRate: sr, Math: M };
  vm.createContext(sb); vm.runInContext(src, sb);
  const p = new reg['va-m1']();
  return { sr, reg, msgs, p, send: (m) => p.port.onmessage({ data: m }) };
}
function run(e, secs) {
  const blocks = Math.ceil(secs * e.sr / 128), out = new Float32Array(blocks * 128);
  let alwaysTrue = true;
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    if (e.p.process([], [[l, r]], {}) !== true) alwaysTrue = false;
    out.set(l, b * 128);
  }
  out.alwaysTrue = alwaysTrue; return out;
}
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const finite = (x) => x.every(Number.isFinite);
const db = (v) => (20 * Math.log10(v)).toFixed(1) + ' dBFS';
const last = (e) => e.msgs.filter((m) => m.t === 'status').pop();
const on = (e, id, note, vel) => e.send({ t: 'noteOn', id, note, vel, ch: 0 });

const SR = 48000;
{ // control: trap works
  const e = make(SR); let threw = false;
  try { vm.runInContext('Math.random()', vm.createContext({ Math: Object.assign({}, { random: () => { throw 1; } }) })); } catch (x) { threw = true; }
  ok(threw && Object.keys(e.reg).join() === 'va-m1', 'registers exactly va-m1 (Math.random trap active)');
}
{ const e = make(SR); const o = run(e, 0.5); ok(o.alwaysTrue && peak(o) === 0, 'silent with no notes, process() returns true'); }
{ // pitch
  const e = make(SR); on(e, 1, 69, 0.8); const o = run(e, 1.2);
  const a = Math.floor(0.6 * SR), N = 8192; let best = 0, bl = 0;
  for (let lag = 40; lag < SR / 200; lag++) { let s = 0; for (let i = 0; i < N; i++) s += o[a + i] * o[a + i + lag]; if (s > best) { best = s; bl = lag; } }
  const f = SR / bl; ok(finite(o) && Math.abs(f - 440) / 440 < 0.02, 'A4 pitch ' + f.toFixed(1) + ' Hz (target 440 +/- 2%)');
}
{ // headroom on default patch, 4-note chord
  const e = make(SR); [60, 64, 67, 72].forEach((n, i) => on(e, i + 1, n, 1)); const o = run(e, 1.5);
  const pk = peak(o); ok(finite(o) && pk < 0.5, 'default patch, 4-note chord at full velocity: peak ' + db(pk) + ' (headroom target >= 6 dB)');
  const e1 = make(SR); on(e1, 1, 48, 1); const o1 = run(e1, 1.5); console.log('INFO single low C at full velocity peak ' + db(peak(o1)));
}
{ // abuse
  const e = make(SR);
  [['cutoff', 20000], ['res', 1], ['drive', 1], ['fenv', 8], ['vol', 1]].forEach(([k, v]) => e.send({ t: 'param', i: idx[k], v }));
  for (let i = 0; i < 8; i++) on(e, i + 1, 36 + i * 7, 1);
  const o = run(e, 2); const s = last(e);
  ok(finite(o) && peak(o) <= 1 && s && s.nan === 0, 'worst-case settings, 8 notes, 2 s: finite, peak ' + db(peak(o)) + ', repaired samples ' + (s ? s.nan : '?'));
}
{ // release frees voices
  const e = make(SR); on(e, 1, 60, 0.8); on(e, 2, 64, 0.8); run(e, 0.5);
  e.send({ t: 'noteOff', id: 1 }); e.send({ t: 'noteOff', id: 2 }); const o = run(e, 4);
  const s = last(e); ok(s.voices === 0 && peak(o, o.length - 24000) < 1e-9, 'after note off: voices freed (' + s.voices + '), tail silent');
}
{ // stealing
  const e = make(SR); for (let i = 0; i < 20; i++) on(e, 100 + i, 40 + i, 0.8); const o = run(e, 0.3); const s = last(e);
  ok(finite(o) && s.voices <= 8 && s.steals === 12, 'voice limit 8: ' + s.voices + ' sounding, ' + s.steals + ' stolen (expect 12)');
}
{ // panic
  const e = make(SR); for (let i = 0; i < 4; i++) on(e, i + 1, 55 + i * 4, 1); run(e, 0.3);
  e.send({ t: 'panic' }); run(e, 0.03); const o = run(e, 0.05);
  const active = Array.from(e.p.aS).filter((x) => x !== 0).length;
  ok(peak(o) === 0 && active === 0, 'panic: silent and all voices cleared within about 30 ms (voices left: ' + active + ')');
}
{ // determinism
  const f = () => { const e = make(SR); [57, 64, 69].forEach((n, i) => on(e, i + 1, n, 0.7)); return run(e, 1); };
  const a = f(), b = f(); let same = a.length === b.length; for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
  ok(same, 'determinism: two identical runs are bit-identical');
}
[44100, 48000, 96000].forEach((sr) => {
  [1, 2].forEach((q) => {
    const e = make(sr); e.send({ t: 'quality', q }); [48, 55, 60].forEach((n, i) => on(e, i + 1, n, 0.9)); const o = run(e, 1);
    ok(finite(o) && peak(o) <= 1 && peak(o) > 0.01, 'sample rate ' + sr + ', quality ' + (q === 1 ? 'Eco' : 'Studio') + ': finite, peak ' + db(peak(o)));
  });
});
{ // click check at note start and note off
  const e = make(SR); const lead = run(e, 0.01); on(e, 1, 60, 1); const o = run(e, 0.05);
  let md = 0; for (let i = 1; i < o.length; i++) md = Math.max(md, Math.abs(o[i] - o[i - 1]));
  ok(Math.abs(o[0]) < 0.05, 'note start: first sample ' + o[0].toExponential(1) + ' (attack ramps from silence); largest sample step in first 50 ms ' + md.toFixed(3));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
