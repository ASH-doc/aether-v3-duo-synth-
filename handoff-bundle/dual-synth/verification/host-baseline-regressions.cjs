// Regression coverage for host findings in the A M1 harness.
// The first three assertions failed on baseline 7883591; fixed by Codex H-02a.
// Node/DOM-controller stubs only: this is not a browser or hardware MIDI test.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

function harness() {
  const html = readFileSync(resolve(__dirname, '../source/host/m1-harness.html'), 'utf8');
  const source = html.match(/<script id="harness-main">([\s\S]*?)<\/script>/)[1];
  const calls = [], nodes = new Map(), handlers = new Map();
  function element() {
    return { textContent: '', classList: { add() {}, remove() {} }, append() {},
      addEventListener(name, fn) { this[name] = fn; } };
  }
  const ports = new Map([['one', { id: 'one' }], ['two', { id: 'two' }]]);
  const access = { inputs: ports };
  const controller = { node: { connect() {} }, panel: {} };
  for (const method of ['noteOn', 'noteOff', 'allNotesOff', 'panic']) {
    controller[method] = (...args) => calls.push([method, ...args]);
  }
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.audioWorklet = {}; }
    addEventListener() {} async resume() {} createGain() { return { gain: {}, connect() {} }; }
  }
  const scope = {
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
      createElement: element
    },
    window: { AudioContext: Context, isSecureContext: true, addEventListener(k, fn) { handlers.set(k, fn); } },
    location: { protocol: 'test:' }, performance: { now: () => 0 },
    navigator: { userAgent: 'Node test stub', requestMIDIAccess: async () => access },
    SynthA: { create: async () => controller }
  };
  vm.runInNewContext(source, scope);
  return {
    async start() { await nodes.get('start').click(); await Promise.resolve(); },
    send(port, data) { ports.get(port).onmidimessage({ data, target: ports.get(port) }); },
    disconnect(port) { const p = ports.get(port); p.state = 'disconnected'; access.onstatechange({ port: p }); },
    click(id) { nodes.get(id).click(); },
    blur() { handlers.get('blur')(); },
    calls
  };
}

test('different MIDI inputs playing the same pitch allocate two notes', async () => {
  const h = harness(); await h.start();
  h.send('one', [0x90, 60, 100]); h.send('two', [0x90, 60, 100]);
  assert.equal(h.calls.filter(c => c[0] === 'noteOn').length, 2);
});

test('disconnect releases only notes belonging to that input', async () => {
  const h = harness(); await h.start();
  h.send('one', [0x90, 60, 100]); h.send('two', [0x90, 60, 100]);
  const firstId = h.calls[0][1], secondId = h.calls[1][1];
  h.disconnect('one');
  assert.equal(h.calls.filter(c => c[0] === 'noteOff').length, 1);
  assert.equal(h.calls.at(-1)[1], firstId);
  h.send('two', [0x80, 60, 0]); assert.equal(h.calls.at(-1)[1], secondId);
});

test('all notes off permits replay and blur leaves external MIDI held', async () => {
  const h = harness(); await h.start(); h.send('one', [0x90, 60, 100]);
  h.blur(); assert.equal(h.calls.length, 1);
  h.click('allOff'); h.send('one', [0x90, 60, 100]);
  assert.equal(h.calls.filter(c => c[0] === 'noteOn').length, 2);
});

test('CC123 affects only its input and channel', async () => {
  const h = harness(); await h.start();
  h.send('one', [0x90, 60, 100]); h.send('one', [0x91, 60, 100]); h.send('two', [0x90, 60, 100]);
  const firstId = h.calls[0][1]; h.send('one', [0xb0, 123, 0]);
  assert.equal(h.calls.filter(c => c[0] === 'noteOff').length, 1);
  assert.equal(h.calls.at(-1)[1], firstId);
});

test('panic blocks note admission during its audio-time fade', async () => {
  const h = harness(); await h.start(); h.send('one', [0x90, 60, 100]);
  h.click('panic'); h.send('two', [0x90, 62, 100]);
  assert.equal(h.calls.filter(c => c[0] === 'noteOn').length, 1);
});

test('incoming MIDI channel is preserved in the controller call', async () => {
  const h = harness(); await h.start(); h.send('one', [0x95, 60, 100]);
  assert.equal(h.calls[0][4], 5);
});

test('CC123 clears ownership so a later noteOn is not suppressed', async () => {
  const h = harness(); await h.start();
  h.send('one', [0x90, 60, 100]); h.send('one', [0xb0, 123, 0]);
  h.send('one', [0x90, 60, 100]);
  assert.equal(h.calls.filter(c => c[0] === 'noteOn').length, 2);
});
