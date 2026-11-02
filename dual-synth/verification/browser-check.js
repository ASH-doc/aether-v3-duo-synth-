// Usage: node browser-check.js <path-to-built-html> <m1|pk01>
const { chromium } = require('playwright');
const path = require('path');
const file = path.resolve(process.argv[2]);
const mode = process.argv[3];

// Tap: whatever gets connected to ctx.destination is also fed into an analyser we can poll.
const initScript = () => {
  const origConnect = AudioNode.prototype.connect;
  window.__taps = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = origConnect.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode && !this.__tapped) {
        this.__tapped = true;
        const an = this.context.createAnalyser();
        an.fftSize = 8192;
        origConnect.call(this, an);
        window.__taps.push(an);
      }
    } catch (e) {}
    return r;
  };
  window.__measure = (ms) => new Promise((res) => {
    const an = window.__taps[0]; if (!an) return res(null);
    const buf = new Float32Array(an.fftSize);
    let peak = 0, sumsq = 0, n = 0, zc = 0, prev = 0, t0 = performance.now();
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i]; if (!isFinite(v)) { peak = Infinity; continue; }
        const a = Math.abs(v); if (a > peak) peak = a;
        sumsq += v * v; n++;
        if (prev <= 0 && v > 0) zc++;
        prev = v;
      }
      if (performance.now() - t0 < ms) setTimeout(tick, 50);
      else res({ peak, rms: Math.sqrt(sumsq / Math.max(n, 1)), peakDb: 20 * Math.log10(peak || 1e-12), rmsDb: 20 * Math.log10(Math.sqrt(sumsq / Math.max(n, 1)) || 1e-12), samples: n });
    };
    tick();
  });
};

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
  await page.addInitScript(initScript);
  await page.goto('file://' + file);
  console.log('URL:', page.url());
  await page.click('#start');
  await page.waitForTimeout(2500);
  const log = await page.textContent('#log');
  console.log('--- page log ---\n' + log);
  if (mode === 'm1') {
    const silent = await page.evaluate(() => window.__measure(500));
    console.log('silence before any note:', JSON.stringify(silent));
    // hold A (MIDI 60 = C4) via computer key
    await page.keyboard.down('a');
    const held = await page.evaluate(() => window.__measure(1200));
    console.log('while holding C4 (key "a"):', JSON.stringify(held));
    await page.keyboard.up('a');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__measure(400));
    console.log('1.5 s after release:', JSON.stringify(after));
    // panel presence
    const panel = await page.evaluate(() => {
      const host = document.querySelector('#mount').firstElementChild;
      const root = host && host.shadowRoot;
      return { hasHost: !!host, shadow: !!root, sliders: root ? root.querySelectorAll('[role=slider]').length : 0 };
    });
    console.log('panel:', JSON.stringify(panel));
    await page.screenshot({ path: process.argv[4] || 'm1.png', fullPage: true });
  } else {
    await page.waitForTimeout(500);
    const both = await page.evaluate(() => window.__measure(800));
    console.log('PK01 output level:', JSON.stringify(both));
    console.log('status A/B:', await page.textContent('#st-a'), '/', await page.textContent('#st-b'));
    await page.screenshot({ path: process.argv[4] || 'pk01.png', fullPage: true });
  }
  console.log('--- console ---\n' + consoleMsgs.join('\n'));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
