(function () {
  'use strict';

  // PK-01 placeholder for engine B. Written only to prove packaging.
  // The real engine B replaces this file.
  const FREQ = 330;
  const LEVEL = 0.1; // about -20 dBFS

  class WtTestTone extends AudioWorkletProcessor {
    constructor() {
      super();
      this.phase = 0;
    }

    process(inputs, outputs) {
      const out = outputs[0];
      const left = out[0];
      const right = out.length > 1 ? out[1] : null;
      const inc = FREQ / sampleRate;
      let ph = this.phase;
      for (let i = 0; i < left.length; i++) {
        // triangle, offset so the first sample is zero (no step at start)
        let p = ph + 0.25;
        p -= Math.floor(p);
        const s = (4 * Math.abs(p - 0.5) - 1) * LEVEL;
        left[i] = s;
        if (right) right[i] = s;
        ph += inc;
        if (ph >= 1) ph -= 1;
      }
      this.phase = ph;
      return true;
    }
  }

  registerProcessor('wt-pk01', WtTestTone);
})();
