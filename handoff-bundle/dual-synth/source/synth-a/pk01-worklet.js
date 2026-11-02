(function () {
  'use strict';

  // PK-01 test tone for engine A. Packaging proof only, not the real instrument.
  const FREQ = 220;
  const LEVEL = 0.1; // about -20 dBFS

  class VaTestTone extends AudioWorkletProcessor {
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
        const s = Math.sin(6.283185307179586 * ph) * LEVEL;
        left[i] = s;
        if (right) right[i] = s;
        ph += inc;
        if (ph >= 1) ph -= 1;
      }
      this.phase = ph;
      return true;
    }
  }

  registerProcessor('va-pk01', VaTestTone);
})();
