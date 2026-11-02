const SynthA = (function () {
  'use strict';

  const P = /*@PARAMS@*/;
  const GROUPS = [['osc', 'Oscillator'], ['filter', 'Filter'], ['fenv', 'Filter envelope'], ['aenv', 'Amp envelope'], ['out', 'Output']];

  const CSS = ':host{display:block;color:#e9dfc8;font:14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.panel{background:linear-gradient(#27241f,#1a1815);border:1px solid #4a4439;border-radius:8px;padding:16px;box-shadow:inset 0 1px 0 #3a352c}' +
    '.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;justify-content:space-between}' +
    '.title{font:700 20px/1 Georgia,"Times New Roman",serif;color:#e0a24a;letter-spacing:.04em}' +
    '.sub{color:#9c927b;font-size:12px}' +
    '.groups{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}' +
    'fieldset{border:1px solid #4a4439;border-radius:6px;padding:6px 12px 12px;margin:0;min-width:0}' +
    'legend{padding:0 6px;color:#b9ad92;font-size:12px}' +
    '.row{display:flex;flex-wrap:wrap;gap:10px}' +
    '.cell{width:76px;text-align:center}' +
    '.knob{width:46px;height:46px;margin:2px auto 5px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#4d473b,#14120f 70%);border:2px solid #6a604d;position:relative;touch-action:none;cursor:ns-resize}' +
    '.knob:focus-visible{outline:2px solid #e0a24a;outline-offset:3px}' +
    '.dial{position:absolute;inset:0}' +
    '.dial::after{content:"";position:absolute;left:50%;top:4px;width:3px;height:14px;margin-left:-1.5px;background:#f0d9a0;border-radius:2px}' +
    '.lab{font-size:12px;color:#b9ad92;min-height:2.6em}' +
    '.val{font-size:12px;font-variant-numeric:tabular-nums}' +
    '.q{display:flex;gap:6px;align-items:center;margin-top:14px;color:#b9ad92;font-size:12px}' +
    '.q button{font:inherit;color:#e9dfc8;background:#2a2722;border:1px solid #5a5242;border-radius:5px;padding:4px 10px;cursor:pointer}' +
    '.q button[aria-pressed="true"]{background:#e0a24a;color:#1a1815;border-color:#e0a24a}' +
    '.q button:focus-visible{outline:2px solid #e0a24a;outline-offset:2px}' +
    '.stat{margin-left:auto;font-variant-numeric:tabular-nums}';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function desc(e) { return (e && (e.name ? e.name + ': ' : '') + (e.message || e)) || String(e); }
  function sign(v) { return v > 0 ? '+' : ''; }
  function fmt(p, v) {
    if (p.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz';
    if (p.unit === 's') return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
    if (p.unit === 'oct') return sign(v) + v.toFixed(1) + ' oct';
    if (p.unit === 'cents') return sign(v) + Math.round(v) + ' c';
    if (p.step === 1) return sign(v) + Math.round(v);
    return Math.round(v * 100) + '%';
  }
  function toNorm(p, v) {
    return p.curve === 'log' ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
  }
  function fromNorm(p, n) {
    n = Math.min(1, Math.max(0, n));
    let v = p.curve === 'log' ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min);
    if (p.step) v = Math.round(v / p.step) * p.step;
    return v;
  }

  function buildPanel(ctl) {
    const host = el('div');
    const root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS; root.append(style);
    const panel = el('div', 'panel'); root.append(panel);
    const head = el('div', 'head');
    head.append(el('div', 'title', 'VULCAN-VA'), el('div', 'sub', 'M1 prototype: one saw, ladder filter, two envelopes'));
    panel.append(head);
    const groups = el('div', 'groups'); panel.append(groups);
    const refresh = [];

    GROUPS.forEach(function (g) {
      const fs = el('fieldset'); fs.append(el('legend', '', g[1]));
      const row = el('div', 'row'); fs.append(row);
      P.forEach(function (p, i) {
        if (p.group !== g[0]) return;
        const cell = el('div', 'cell');
        const knob = el('div', 'knob'); knob.tabIndex = 0;
        knob.setAttribute('role', 'slider');
        knob.setAttribute('aria-label', g[1] + ' ' + p.label);
        knob.setAttribute('aria-valuemin', p.min); knob.setAttribute('aria-valuemax', p.max);
        const dial = el('div', 'dial'); knob.append(dial);
        const lab = el('div', 'lab', p.label);
        const val = el('div', 'val');
        cell.append(knob, lab, val); row.append(cell);

        function show(v) {
          dial.style.transform = 'rotate(' + (-135 + 270 * toNorm(p, v)) + 'deg)';
          val.textContent = fmt(p, v);
          knob.setAttribute('aria-valuenow', v);
          knob.setAttribute('aria-valuetext', fmt(p, v));
        }
        refresh[i] = show;
        const nudge = function (d) {
          const cur = ctl.getPatch()[i];
          ctl.setParam(i, p.step ? Math.min(p.max, Math.max(p.min, cur + d * p.step * 50)) : fromNorm(p, toNorm(p, cur) + d));
        };
        let startY = 0, startN = 0, drag = false;
        knob.addEventListener('pointerdown', function (e) {
          drag = true; startY = e.clientY; startN = toNorm(p, ctl.getPatch()[i]);
          knob.setPointerCapture(e.pointerId); knob.focus(); e.preventDefault();
        });
        knob.addEventListener('pointermove', function (e) {
          if (!drag) return;
          ctl.setParam(i, fromNorm(p, startN + (startY - e.clientY) / (e.shiftKey ? 700 : 170)));
        });
        const stop = function () { drag = false; };
        knob.addEventListener('pointerup', stop); knob.addEventListener('pointercancel', stop);
        knob.addEventListener('dblclick', function () { ctl.setParam(i, p.def); });
        knob.addEventListener('wheel', function (e) { e.preventDefault(); nudge(e.deltaY < 0 ? 0.02 : -0.02); }, { passive: false });
        knob.addEventListener('keydown', function (e) {
          const k = e.key;
          if (k === 'ArrowUp' || k === 'ArrowRight') nudge(0.02);
          else if (k === 'ArrowDown' || k === 'ArrowLeft') nudge(-0.02);
          else if (k === 'PageUp') nudge(0.1);
          else if (k === 'PageDown') nudge(-0.1);
          else if (k === 'Home') ctl.setParam(i, p.min);
          else if (k === 'End') ctl.setParam(i, p.max);
          else return;
          e.preventDefault();
        });
        show(p.def);
      });
      groups.append(fs);
    });

    const q = el('div', 'q');
    const eco = el('button', '', 'Eco'), studio = el('button', '', 'Studio');
    eco.type = 'button'; studio.type = 'button';
    const setQ = function (n) {
      eco.setAttribute('aria-pressed', String(n === 1)); studio.setAttribute('aria-pressed', String(n === 2));
      ctl.setQuality(n);
    };
    eco.addEventListener('click', function () { setQ(1); });
    studio.addEventListener('click', function () { setQ(2); });
    const stat = el('div', 'stat', 'Waiting for audio');
    q.append(el('span', '', 'Filter quality (applies to new notes):'), eco, studio, stat);
    panel.append(q);
    eco.setAttribute('aria-pressed', 'false'); studio.setAttribute('aria-pressed', 'true');

    ctl.onParam(function (i, v) { if (refresh[i]) refresh[i](v); });
    ctl.onStatus(function (s) {
      stat.textContent = 'Voices ' + s.voices + ', stolen ' + s.steals + ', repaired samples ' + s.nan;
    });
    return host;
  }

  async function create(ctx, src, log) {
    const say = log || function () {};
    const errs = [];
    let how = null;
    let url = null;
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      how = 'Blob URL';
    } catch (e) {
      errs.push('Blob URL: ' + desc(e));
      say('Engine A: loading from a Blob URL failed (' + desc(e) + ')');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
    if (!how) {
      try {
        await ctx.audioWorklet.addModule('data:text/javascript;base64,' + btoa(src));
        how = 'data URL (fallback)';
      } catch (e) {
        errs.push('data URL: ' + desc(e));
        say('Engine A: loading from a data URL failed too (' + desc(e) + ')');
      }
    }
    if (!how) throw new Error(errs.join(' | '));
    say('Engine A: module loaded via ' + how);

    const node = new AudioWorkletNode(ctx, 'va-m1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const vals = P.map(function (p) { return p.def; });
    const subs = { param: [], status: [] };
    const post = function (m) { node.port.postMessage(m); };
    node.port.onmessage = function (e) {
      const m = e.data;
      if (m && m.t === 'status') subs.status.forEach(function (f) { f(m); });
    };
    node.onprocessorerror = function () { say('Engine A: the browser reported a processor error'); };

    const ctl = {
      engineId: 'A', sessionId: 'A-' + Date.now().toString(36), node: node, loadMethod: how, params: P,
      noteOn: function (id, note, vel, ch) { post({ t: 'noteOn', id: id, note: note, vel: vel, ch: ch | 0 }); },
      noteOff: function (id) { post({ t: 'noteOff', id: id }); },
      allNotesOff: function () { post({ t: 'allNotesOff' }); },
      panic: function () { post({ t: 'panic' }); },
      setParam: function (i, v) { vals[i] = v; post({ t: 'param', i: i, v: v }); subs.param.forEach(function (f) { f(i, v); }); },
      getPatch: function () { return vals.slice(); },
      resetToInit: function () { P.forEach(function (p, i) { ctl.setParam(i, p.def); }); },
      setQuality: function (q) { post({ t: 'quality', q: q }); },
      onParam: function (f) { subs.param.push(f); },
      onStatus: function (f) { subs.status.push(f); },
      dispose: function () { try { post({ t: 'panic' }); node.disconnect(); } catch (e) { /* already gone */ } }
    };
    ctl.panel = buildPanel(ctl);
    return ctl;
  }

  return { create: create };
})();
