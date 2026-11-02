// Host-only control logic. No DSP, worklet ports, browser globals or dependencies.
// Review candidate H-01; not yet connected to the listening pages.
export class NoteLedger {
  #engines = new Map();
  #held = new Map();
  #nextId = 1;
  #blocked = false;
  #onError;

  constructor(onError = () => {}) {
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');
    this.#onError = onError;
  }

  #call(target, method, ...args) {
    try { target.controller[method](...args); }
    catch (error) {
      // A failing controller or diagnostic subscriber must not block its peer.
      try { this.#onError({ engineId: target.engineId, sessionId: target.sessionId, method, error }); }
      catch { /* diagnostic observer failed */ }
    }
  }

  attach(controller, transpose = 0) {
    if (!controller || !['A', 'B'].includes(controller.engineId) ||
        typeof controller.sessionId !== 'string' || !controller.sessionId ||
        !['noteOn', 'noteOff', 'allNotesOff', 'panic'].every(k => typeof controller[k] === 'function')) {
      throw new TypeError('Expected a public engine controller');
    }
    this.#validateTranspose(transpose);
    if (this.#engines.has(controller.engineId)) throw new Error('Detach the old session before attaching');
    this.#engines.set(controller.engineId, {
      engineId: controller.engineId, sessionId: controller.sessionId, controller, transpose
    });
  }

  detach(engineId) {
    const target = this.#engines.get(engineId);
    if (!target) return;
    for (const entry of this.#held.values()) {
      const destination = entry.destinations.get(engineId);
      if (destination) {
        this.#call(destination, 'noteOff', entry.noteId);
        entry.destinations.delete(engineId);
      }
    }
    this.#engines.delete(engineId);
    // Controller disposal and audio disconnection belong to the lifecycle owner.
  }

  #validateTranspose(value) {
    if (!Number.isInteger(value) || value < -127 || value > 127) throw new RangeError('Invalid transpose');
  }

  setTranspose(engineId, value) {
    this.#validateTranspose(value);
    const target = this.#engines.get(engineId);
    if (!target) throw new Error('Engine is not attached');
    target.transpose = value;
  }

  #key(source, channel, key) { return JSON.stringify([source, channel, key]); }

  noteOn({ source, channel = 0, key, note, velocity = 0.8 }) {
    if (typeof source !== 'string' || !source || typeof key !== 'string' || !key ||
        !Number.isInteger(channel) || channel < 0 || channel > 15 ||
        !Number.isInteger(note) || note < 0 || note > 127 ||
        !Number.isFinite(velocity) || velocity <= 0 || velocity > 1) {
      throw new RangeError('Invalid note event; normalize MIDI velocity-zero to noteOff');
    }
    if (this.#blocked) return null;
    const token = this.#key(source, channel, key);
    if (this.#held.has(token)) return this.#held.get(token).noteId;
    if (this.#held.size >= 4096) throw new RangeError('Host held-note capacity reached');
    // Current A uses signed Int32 IDs. Never wrap or recycle within this ledger.
    if (this.#nextId > 0x7fffffff) throw new RangeError('Note ID space exhausted; restart the host');
    const entry = { source, channel, key, originalPitch: note, velocity,
      noteId: this.#nextId++, physicalKeyDown: true, destinations: new Map() };
    this.#held.set(token, entry);
    for (const target of this.#engines.values()) {
      const pitch = note + target.transpose;
      if (pitch < 0 || pitch > 127) continue; // Do not fold/clamp pitches into another note.
      const destination = { ...target, dispatchedPitch: pitch };
      entry.destinations.set(target.engineId, destination);
      // Record before dispatch: even a controller that throws after sending gets a release.
      this.#call(destination, 'noteOn', entry.noteId, pitch, velocity, channel);
    }
    return entry.noteId;
  }

  noteOff({ source, channel = 0, key }) {
    const token = this.#key(source, channel, key);
    const entry = this.#held.get(token);
    if (!entry) return false;
    entry.physicalKeyDown = false;
    this.#held.delete(token);
    for (const target of entry.destinations.values()) this.#call(target, 'noteOff', entry.noteId);
    return true;
  }

  releaseSource(source) {
    for (const entry of [...this.#held.values()]) if (entry.source === source) this.noteOff(entry);
  }

  allNotesOff() {
    this.#held.clear();
    for (const target of this.#engines.values()) this.#call(target, 'allNotesOff');
  }

  beginPanic() {
    this.#blocked = true;
    this.#held.clear();
    for (const target of this.#engines.values()) this.#call(target, 'panic');
    // Remain blocked until lifecycle owner finishes host fade/reverb clear.
  }

  endPanic() { this.#blocked = false; }

  snapshot() {
    return [...this.#held.values()].map(({ destinations, ...entry }) => ({
      ...entry,
      destinations: [...destinations.values()].map(({ engineId, sessionId, dispatchedPitch }) =>
        ({ engineId, sessionId, dispatchedPitch }))
    }));
  }
}
