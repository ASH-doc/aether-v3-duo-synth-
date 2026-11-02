// Browser smoke check, not listening approval or real MIDI/CPU validation.
// PLAYWRIGHT_MODULE may select an installed playwright-core; CHROMIUM_PATH is optional.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      // Test-only tap of the final output; never embed in the instrument.
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...rest) {
        const result = connect.call(this, destination, ...rest);
        if (destination instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
          connect.call(this, analyser); window.outputTap = analyser;
        }
        return result;
      };
    });
    const url = process.argv[2] || pathToFileURL(resolve(__dirname, '../dist/DualSynth_A_M1.html')).href;
    await page.goto(url);
    await page.click('#start');
    await page.waitForFunction(() => document.querySelector('#log').textContent.includes('Engine A ready.'), null, { timeout: 15000 });
    const peak = () => page.evaluate(() => {
      const data = new Float32Array(window.outputTap.fftSize); window.outputTap.getFloatTimeDomainData(data);
      if (!data.every(Number.isFinite)) throw new Error('Non-finite audio');
      return Math.max(...data.map(Math.abs));
    });
    assert.equal(await peak(), 0);
    await page.keyboard.down('a'); await page.waitForTimeout(300);
    const sounding = await peak(); assert.ok(sounding > 0.001 && sounding <= 1, 'audible-range finite output');
    await page.keyboard.up('a'); await page.waitForTimeout(1600);
    assert.ok(await peak() < 1e-6, 'release returns to silence');
    assert.equal(await page.locator('[role=slider]').count(), 17);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browser.version(), protocol: new URL(url).protocol, heldPeak: sounding,
      silenceBeforeAndAfter: true, sliders: 17, pageErrors: errors,
      log: await page.locator('#log').textContent() }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
