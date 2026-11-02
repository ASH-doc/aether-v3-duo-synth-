// Real-browser smoke test for the Synth A M2 page.  Usage: node browser-check-m2.js <DualSynth_A_M2.html> [screenshot.png]
// Headless Chromium has no speakers: audio is measured by tapping whatever connects to the destination.
const { chromium } = require('playwright');
const path = require('path');
const file = path.resolve(process.argv[2]);
const shot = process.argv[3];
const tap = () => {
  const origConnect = AudioNode.prototype.connect;
  window.__an = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = origConnect.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode && !this.__t) {
        this.__t = true;
        const sp = this.context.createChannelSplitter(2), a0 = this.context.createAnalyser(), a1 = this.context.createAnalyser();
        a0.fftSize = a1.fftSize = 8192;
        origConnect.call(this, sp); sp.connect(a0, 0); sp.connect(a1, 1);
        window.__an = [a0, a1];
      }
    } catch (e) {}
    return r;
  };
  window.__meas = (ms) => new Promise((res) => {
    const [a0, a1] = window.__an; if (!a0) return res(null);
    const b0 = new Float32Array(a0.fftSize), b1 = new Float32Array(a1.fftSize);
    let pk = 0, d = 0, n = 0, t0 = performance.now();
    const tick = () => {
      a0.getFloatTimeDomainData(b0); a1.getFloatTimeDomainData(b1);
      for (let i = 0; i < b0.length; i++) { pk = Math.max(pk, Math.abs(b0[i]), Math.abs(b1[i])); d = Math.max(d, Math.abs(b0[i] - b1[i])); n++; }
      if (performance.now() - t0 < ms) setTimeout(tick, 40); else res({ peakDb: +(20 * Math.log10(pk || 1e-12)).toFixed(1), maxLRdiff: +d.toFixed(4) });
    };
    tick();
  });
};
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.addInitScript(tap);
  await page.goto(process.env.URL || ('file://' + file));
  await page.click('#start');
  await page.waitForTimeout(2000);
  console.log('--- log ---\n' + (await page.textContent('#log')));
  const R = {};
  const panel = () => page.evaluate(() => { const h = document.querySelector('#mount').firstElementChild, r = h && h.shadowRoot; return r ? { sliders: r.querySelectorAll('[role=slider]').length, selectorButtons: r.querySelectorAll('.seg button').length, groups: r.querySelectorAll('fieldset').length } : null; });
  R.panel = await panel();
  R.silence = await page.evaluate(() => window.__meas(400));
  await page.keyboard.down('a'); R.singleSaw = await page.evaluate(() => window.__meas(900)); await page.keyboard.up('a');
  await page.waitForTimeout(800);
  // press the "Hyper" button inside the panel's Shadow DOM
  const clicked = await page.evaluate(() => { const r = document.querySelector('#mount').firstElementChild.shadowRoot; const b = Array.from(r.querySelectorAll('.seg button')).find((x) => x.textContent === 'Hyper'); if (!b) return false; b.click(); return b.getAttribute('aria-pressed'); });
  R.hyperClicked = clicked;
  await page.keyboard.down('a'); await page.keyboard.down('d'); await page.keyboard.down('g');
  R.hyperChord = await page.evaluate(() => window.__meas(1200));
  await page.keyboard.up('a'); await page.keyboard.up('d'); await page.keyboard.up('g');
  // sustain: hold Space, play and release a note, it should keep sounding; then release Space
  await page.waitForTimeout(1200);
  await page.keyboard.down('Space'); await page.keyboard.down('h'); await page.waitForTimeout(300); await page.keyboard.up('h');
  await page.waitForTimeout(600); R.sustainStillSounding = await page.evaluate(() => window.__meas(400));
  await page.keyboard.up('Space'); await page.waitForTimeout(1500); R.afterPedalUp = await page.evaluate(() => window.__meas(400));
  // pitch bend and wheel sliders exist and accept input
  await page.fill('#wheel', '0.7'); R.wheelValue = await page.inputValue('#wheel');
  R.voicesText = await page.evaluate(() => document.querySelector('#mount').firstElementChild.shadowRoot.querySelector('.stat').textContent);
  console.log('--- results ---\n' + JSON.stringify(R, null, 1));
  console.log('--- console errors/warnings ---\n' + (errs.join('\n') || '(none)'));
  if (shot) await page.screenshot({ path: shot, fullPage: true });
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
