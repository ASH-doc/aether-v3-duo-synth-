import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteLedger } from '../source/host/note-ledger.mjs';

function engine(engineId, sessionId = engineId + '-1') {
  const events = [];
  const controller = { engineId, sessionId };
  for (const method of ['noteOn', 'noteOff', 'allNotesOff', 'panic']) {
    controller[method] = (...args) => events.push([method, ...args]);
  }
  // Tripwire: the host must never touch DSP/ports.
  Object.defineProperty(controller, 'port', { get() { throw new Error('Port access'); } });
  return { controller, events };
}
const note = (overrides = {}) => ({ source: 'keyboard', key: 'KeyA', note: 60, ...overrides });

test('both engines receive matching IDs and independent transposed pitches', () => {
  const h = new NoteLedger(), a = engine('A'), b = engine('B');
  h.attach(a.controller, -12); h.attach(b.controller, 12);
  const id = h.noteOn(note({ channel: 3 }));
  assert.deepEqual(a.events, [['noteOn', id, 48, 0.8, 3]]);
  assert.deepEqual(b.events, [['noteOn', id, 72, 0.8, 3]]);
  h.setTranspose('A', 24); h.noteOff(note({ channel: 3 }));
  assert.deepEqual(a.events[1], ['noteOff', id]);
  assert.deepEqual(b.events[1], ['noteOff', id]);
  assert.deepEqual(h.snapshot(), []);
});

test('duplicate physical key is ignored; independent devices and channels are distinct', () => {
  const h = new NoteLedger(), a = engine('A'); h.attach(a.controller);
  const id = h.noteOn(note()); assert.equal(h.noteOn(note()), id);
  const id2 = h.noteOn(note({ source: 'midi:port-1' }));
  const id3 = h.noteOn(note({ source: 'midi:port-2' }));
  const id4 = h.noteOn(note({ source: 'midi:port-2', channel: 1 }));
  assert.equal(new Set([id, id2, id3, id4]).size, 4);
  assert.equal(a.events.length, 4);
  h.releaseSource('keyboard'); assert.equal(h.snapshot().length, 3);
  h.releaseSource('midi:port-2'); assert.equal(h.snapshot().length, 1);
  assert.equal(h.snapshot()[0].source, 'midi:port-1');
});

test('unknown noteOff is silent and snapshot is an isolated value', () => {
  const h = new NoteLedger(), a = engine('A'); h.attach(a.controller);
  assert.equal(h.noteOff(note()), false);
  h.noteOn(note()); const copy = h.snapshot();
  copy[0].destinations[0].sessionId = 'bad'; copy[0].noteId = -1;
  assert.equal(h.snapshot()[0].destinations[0].sessionId, 'A-1');
  assert.equal(h.snapshot()[0].noteId, 1); assert.equal(a.events.length, 1);
});

test('failed A dispatch and diagnostic observer do not prevent B note or release', () => {
  const h = new NoteLedger(() => { throw new Error('observer'); }), a = engine('A'), b = engine('B');
  a.controller.noteOn = a.controller.noteOff = () => { throw new Error('engine'); };
  h.attach(a.controller); h.attach(b.controller);
  const id = h.noteOn(note()); h.noteOff(note());
  assert.deepEqual(b.events, [['noteOn', id, 60, 0.8, 0], ['noteOff', id]]);
});

test('detach releases the old session; old key release never reaches a replacement', () => {
  const h = new NoteLedger(), a = engine('A'), replacement = engine('A', 'A-2');
  h.attach(a.controller); const id = h.noteOn(note());
  assert.throws(() => h.attach(replacement.controller), /Detach/);
  h.detach('A'); h.attach(replacement.controller); h.noteOff(note());
  assert.deepEqual(a.events[1], ['noteOff', id]); assert.deepEqual(replacement.events, []);
  assert.ok(h.noteOn(note()) > id);
});

test('transpose outside MIDI range skips only that destination', () => {
  const h = new NoteLedger(), a = engine('A'), b = engine('B');
  h.attach(a.controller, 12); h.attach(b.controller);
  h.noteOn(note({ note: 120 })); h.noteOff(note());
  assert.deepEqual(a.events, []); assert.equal(b.events.length, 2);
});

test('all notes off clears ownership without reusing IDs', () => {
  const h = new NoteLedger(), a = engine('A'); h.attach(a.controller);
  const id = h.noteOn(note()); h.allNotesOff();
  assert.deepEqual(h.snapshot(), []); assert.equal(h.noteOff(note()), false);
  assert.ok(h.noteOn(note()) > id); assert.deepEqual(a.events[1], ['allNotesOff']);
});

test('panic blocks live input until explicit fade completion', () => {
  const h = new NoteLedger(), a = engine('A'), b = engine('B');
  h.attach(a.controller); h.attach(b.controller); h.noteOn(note());
  h.beginPanic(); assert.equal(h.noteOn(note()), null);
  assert.deepEqual(h.snapshot(), []); assert.deepEqual(b.events[1], ['panic']);
  h.endPanic(); assert.equal(h.noteOn(note()), 2);
});

test('invalid events are rejected before either engine receives them', () => {
  const h = new NoteLedger(), a = engine('A'); h.attach(a.controller);
  for (const patch of [{ note: NaN }, { note: 60.2 }, { velocity: 0 }, { velocity: Infinity },
    { channel: 16 }, { source: '' }, { key: '' }]) assert.throws(() => h.noteOn(note(patch)), RangeError);
  assert.throws(() => h.setTranspose('A', 0.5), RangeError);
  assert.deepEqual(a.events, []); assert.deepEqual(h.snapshot(), []);
});

test('held-note storage is bounded and a release frees capacity', () => {
  const h = new NoteLedger();
  for (let i = 0; i < 4096; i++) h.noteOn(note({ key: String(i) }));
  assert.throws(() => h.noteOn(note({ key: 'extra' })), /capacity/);
  h.noteOff(note({ key: '0' })); assert.equal(h.noteOn(note({ key: 'extra' })), 4097);
});
