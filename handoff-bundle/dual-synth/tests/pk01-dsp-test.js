'use strict';
// Runs each PK-01 worklet's process() in Node with a stand-in for the
// AudioWorklet environment, and checks the numbers it produces.
// This does NOT test a browser, Blob loading, or anything audible.
// Run:  node tests/pk01-dsp-test.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
let passes = 0;
let failures = 0;

function ok(cond, msg) {
  if (cond) { passes++; console.log('PASS ' + msg); }
  else { failures++; console.log('FAIL ' + msg); }
}

function loadWorklet(file, sampleRate) {
  const registry = {};
  class AudioWorkletProcessor {
    constructor() { this.port = { postMessage() {}, onmessage: null }; }
  }
  const M = {};
  Object.getOwnPropertyNames(Math).forEach(function (k) { M[k] = Math[k]; });
  M.random = function () { throw new Error('Math.random was called'); };
  const sandbox = {
    AudioWorkletProcessor: AudioWorkletProcessor,
    registerProcessor: function (n, c) { registry[n] = c; },
    sampleRate: sampleRate,
    Math: M
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return { registry: registry, sandbox: sandbox };
}

function render(Cls, seconds, sr, mono) {
  const p = new Cls();
  const blocks = Math.ceil(seconds * sr / 128);
  const L = new Float32Array(blocks * 128);
  const R = new Float32Array(blocks * 128);
  let allTrue = true;
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    const outputs = [mono ? [l] : [l, r]];
    if (p.process([], outputs, {}) !== true) { allTrue = false; }
    L.set(l, b * 128);
    R.set(r, b * 128);
  }
  return { L: L, R: R, allTrue: allTrue };
}

function analyse(x, sr) {
  let peak = 0, maxDelta = 0, crossings = 0, finite = true;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { finite = false; }
    peak = Math.max(peak, Math.abs(v));
    if (i > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(v - x[i - 1]));
      if (x[i - 1] < 0 && v >= 0) { crossings++; }
    }
  }
  return { peak: peak, maxDelta: maxDelta, freq: crossings / (x.length / sr), finite: finite, first: x[0] };
}

const cases = [
  { name: 'A (va-pk01)', file: path.join(root, 'source/synth-a/pk01-worklet.js'), reg: 'va-pk01', freq: 220, slope: function (sr) { return 0.1 * 2 * Math.PI * 220 / sr; } },
  { name: 'B (wt-pk01)', file: path.join(root, 'source/synth-b/pk01-worklet.js'), reg: 'wt-pk01', freq: 330, slope: function (sr) { return 4 * 0.1 * 330 / sr; } }
];

// Negative control: prove the Math.random trap really fires inside the sandbox
{
  const probe = loadWorklet(cases[0].file, 48000);
  let threw = false;
  try { vm.runInContext('Math.random()', probe.sandbox); } catch (e) { threw = true; }
  ok(threw, 'control: the Math.random trap fires inside the test sandbox');
}

cases.forEach(function (c) {
  [44100, 48000].forEach(function (sr) {
    const w = loadWorklet(c.file, sr);
    const keys = Object.keys(w.registry);
    ok(keys.length === 1 && keys[0] === c.reg, c.name + ' @' + sr + ': registers exactly ' + c.reg);
    const Cls = w.registry[c.reg];
    const out = render(Cls, 2, sr, false);
    const m = analyse(out.L, sr);
    const db = 20 * Math.log10(m.peak);
    ok(out.allTrue, c.name + ' @' + sr + ': process() returns true every block');
    ok(m.finite, c.name + ' @' + sr + ': no NaN or Infinity in 2 s of output');
    ok(Math.abs(db + 20) < 0.2, c.name + ' @' + sr + ': peak ' + db.toFixed(2) + ' dBFS (target -20 +/- 0.2)');
    ok(Math.abs(m.freq - c.freq) < 1, c.name + ' @' + sr + ': frequency ' + m.freq.toFixed(2) + ' Hz (target ' + c.freq + ' +/- 1)');
    ok(Math.abs(m.first) < 1e-3, c.name + ' @' + sr + ': first sample is ' + m.first.toExponential(1) + ' (starts at zero, no step)');
    ok(m.maxDelta <= c.slope(sr) * 1.02, c.name + ' @' + sr + ': largest sample-to-sample jump ' + m.maxDelta.toFixed(5) + ' within ' + (c.slope(sr) * 1.02).toFixed(5) + ' (no clicks, including across block edges)');
    let identical = true;
    for (let i = 0; i < out.L.length; i++) { if (out.L[i] !== out.R[i]) { identical = false; break; } }
    ok(identical, c.name + ' @' + sr + ': left and right channels identical');
  });
  const w = loadWorklet(c.file, 48000);
  let noThrow = true;
  try { render(w.registry[c.reg], 0.1, 48000, true); } catch (e) { noThrow = false; }
  ok(noThrow, c.name + ': a mono output buffer does not throw');
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
