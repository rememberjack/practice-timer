/* Classic theme: the clock, the play time and efficiency, and the sound monitor with five sound pictures. It is the base theme: always on,
   written for every language, and where the page lands when the theme on screen goes (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);
const W = MT.word;
/* the sound pictures, in the order a tap goes through them */
const VIZ = [['piano', W('Piano roll')], ['spectrogram', W('Spectrogram')], ['trail', W('Pitch trail')], ['waterfall', W('Harmonic waterfall')], ['halo', W('Halo')]];

module.exports = {
  api: 1,
  id: 'classic',
  name: 'Classic',
  line: 'The clock, with your play time and efficiency.',
  goalHint: 'The total play time to reach.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pClassic',
  chrome: 'clean',
  create: function (host) {
    const $ = host.$, V = host.view, reduceMotion = host.reduceMotion, noteText = host.noteText, bars = host.audio.bars, NB = bars.length, shown = new Float32Array(NB), text = host.text, width = host.width;
    const clockEl = $('cClock'); let clockTxt = '';
    function clock(t) {
      if (t === clockTxt) return;
      if (t.length !== clockTxt.length) { clockEl.textContent = ''; for (const ch of t) { const s = document.createElement('span'); s.className = ch === ':' ? 'c' : 'd'; s.textContent = ch; clockEl.appendChild(s); } }
      else for (let i = 0; i < t.length; i++) if (t[i] !== clockTxt[i]) clockEl.children[i].textContent = t[i];
      clockTxt = t;
    }
    /* the sound pictures: tap the picture to change it
       piano       - the notes you play rise as bars from a keyboard, the key under each one lit
       spectrogram - the full spectrum over the last few seconds on a musical scale: the note and every overtone as bright lines
       trail       - the melody drawn as a line across a treble staff
       waterfall   - a scrolling picture of the overtones: clean stripes for an instrument, smears for talking and noise
       halo        - a ring of bars around the note name */
    const viz = $('viz'), vg = viz.getContext('2d'), vizBox = $('vizBox');
    let COL = { rule: '#2C3A4F', mute: '#7C8AA1', accent: '#86DCC0', ink: '#F4F7FB' }, colN = 0, vizI = Math.max(0, VIZ.findIndex(v => v[0] === host.pref('viz'))), vizNameT = 0;
    function setViz(i, announce) {
      vizI = ((i % VIZ.length) + VIZ.length) % VIZ.length; host.pref('viz', VIZ[vizI][0]);
      vizBox.setAttribute('aria-label', tr('Sound picture: {name}. Tap to change', { name: tr(VIZ[vizI][1]) }));
      if (announce) { const n = $('vizName'); n.textContent = tr(VIZ[vizI][1]); n.classList.add('on'); clearTimeout(vizNameT); vizNameT = setTimeout(() => n.classList.remove('on'), 1700); }
    }
    vizBox.addEventListener('click', () => { if (performance.now() - host.lastSwipe() > 400) setViz(vizI + 1, true); });
    vizBox.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViz(vizI + 1, true); } });
    setViz(vizI, false);

    /* what was played, kept for the pictures that show time: a pitch history, and whole notes for the piano roll */
    const hist = [], notes = [], sparks = []; let vt = 0, curKey = null, candKey = null, candT = 0;
    function trackNotes(dt) {
      vt += dt; const live = V.st === 'running', m = live && V.midi != null ? V.midi : null, mu = live && V.music;
      hist.push({ t: vt, m: m, mu: mu }); while (hist.length && vt - hist[0].t > 6) hist.shift();
      let k = mu && m != null ? Math.round(m) : null;
      if (k != null && curKey != null && Math.abs(m - curKey) < 0.7) k = curKey;          // vibrato does not break a note in two
      if (k === curKey) { candKey = k; candT = 0; }
      else { if (k !== candKey) { candKey = k; candT = 0; } candT += dt;
        if (candT >= (k == null ? 0.09 : 0.05)) { if (curKey != null && notes.length) notes[notes.length - 1].t1 = vt; curKey = k; if (k != null) notes.push({ k: k, t0: vt, t1: -1 }); } }
      while (notes.length && notes[0].t1 > 0 && vt - notes[0].t1 > 8) notes.shift();
    }
    const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0x86DCC0; return [n >> 16, (n >> 8) & 255, n & 255]; };
    function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else g.rect(x, y, w, h); }

    /* piano roll, after the falling-note piano videos: a dark stage, glowing bars, a lit key, a blue glow along the keyboard */
    /* The keyboard fits the instrument that has been heard: its whole range and nothing more, so the keys are as wide as they can be.
       Sounding ranges, as piano key numbers (middle C = 60). A note played outside the range stretches the keyboard to reach it. */
    const RANGES = { Violin: [55, 100], Cello: [36, 81], Flute: [60, 96], Clarinet: [50, 94], Piano: [21, 108] }, ANY_RANGE = [36, 96];
    const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0], WIDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], KEYN = ['C', 'C\u266F', 'D', 'E\u266D', 'E', 'F', 'F\u266F', 'G', 'A\u266D', 'A', 'B\u266D', 'B'];
    const pc = k => ((k % 12) + 12) % 12, whiteU = k => 7 * Math.floor(k / 12) + WIDX[pc(k)], keyName = k => noteText(KEYN[pc(k)] + (Math.floor(k / 12) - 1));
    let kbLo = whiteU(ANY_RANGE[0]), kbHi = whiteU(ANY_RANGE[1]) + 1, kbShown = null, kbEnds = ANY_RANGE;
    function fitKeyboard(dt) {
      const inst = RANGES[V.inst] ? V.inst : '', r = RANGES[inst] || ANY_RANGE; let lo = r[0], hi = r[1];
      for (const n of notes) if (n.t1 < 0 || vt - n.t1 < 3.4) { if (n.k < lo) lo = n.k; if (n.k > hi) hi = n.k; }      // every note still on the stage stays in view
      lo = Math.max(12, lo); hi = Math.min(120, hi); if (BLACK[pc(lo)]) lo--; if (BLACK[pc(hi)]) hi++;
      const tLo = whiteU(lo), tHi = whiteU(hi) + 1, f = kbShown === null || reduceMotion ? 1 : Math.min(1, dt * 5);
      kbLo += (tLo - kbLo) * f; kbHi += (tHi - kbHi) * f; kbEnds = [lo, hi];
      kbShown = inst;
    }
    /* where a key sits across the picture: white keys one unit wide, black keys on the line between two whites */
    function keyBox(k, ww) { const u = whiteU(k); return BLACK[pc(k)] ? { x: (u + 1 - kbLo) * ww, w: Math.max(3, ww * 0.62), black: true } : { x: (u + 0.5 - kbLo) * ww, w: ww, black: false }; }
    function drawPiano(w, h, dt) {
      fitKeyboard(dt);
      // keys in a piano's proportions, 5.5 times as long as they are wide, but no more than 40% of the picture, so the notes keep room to fall
      const g = vg, ww = w / (kbHi - kbLo), kbH = Math.max(14, Math.min(ww * 5.5, h * 0.4)), top = h - kbH, speed = top / 3.2, lit = curKey != null ? curKey : -1;
      g.save(); rrect(g, 0, 0, w, h, 10); g.clip();
      g.fillStyle = '#080D15'; g.fillRect(0, 0, w, h);
      for (const n of notes) { const yB = n.t1 < 0 ? top : top - (vt - n.t1) * speed, yT = Math.max(-6, top - (vt - n.t0) * speed); if (yB < 0) continue;
        const b = keyBox(n.k, ww), bw = Math.max(4, b.w * (b.black ? 1 : 0.74));
        g.fillStyle = COL.accent; g.globalAlpha = 0.92; rrect(g, b.x - bw / 2, yT, bw, Math.max(3, yB - yT), 3); g.fill();
        g.globalAlpha = 0.9; g.strokeStyle = '#E3FFF5'; g.lineWidth = 1; rrect(g, b.x - bw / 2 + 0.5, yT + 0.5, bw - 1, Math.max(2, yB - yT - 1), 3); g.stroke(); }
      g.globalAlpha = 1;
      if (top > 40) { g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = COL.mute; g.textBaseline = 'alphabetic';                // the lowest and highest notes on the keyboard
        g.textAlign = 'left'; g.fillText(keyName(kbEnds[0]), 6, top - 16); g.textAlign = 'right'; g.fillText(keyName(kbEnds[1]), w - 6, top - 16); g.textAlign = 'start'; }
      const glow = g.createLinearGradient(0, top - 12, 0, top); glow.addColorStop(0, 'rgba(60,130,255,0)'); glow.addColorStop(1, 'rgba(60,130,255,0.5)');
      g.fillStyle = glow; g.fillRect(0, top - 12, w, 12); g.fillStyle = '#5B9BFF'; g.fillRect(0, top - 1, w, 2);
      const gap = ww > 5 ? 1 : 0.5, u0 = Math.floor(kbLo) - 1, u1 = Math.ceil(kbHi) + 1, litU = lit >= 0 && !BLACK[pc(lit)] ? whiteU(lit) : -1;
      // white keys shaded under the glow line and rounded at the near end; black keys with a lighter front edge
      const ivory = g.createLinearGradient(0, top, 0, h); ivory.addColorStop(0, '#CDD5E0'); ivory.addColorStop(Math.min(0.5, 10 / kbH), '#EEF2F7'); ivory.addColorStop(1, '#F8FAFC');
      const end = (x, y, bw, bh, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, [0, 0, r, r]); else g.rect(x, y, bw, bh); g.fill(); };
      const rW = Math.min(4, ww * 0.12), bH = kbH * 0.62, lip = Math.max(1, Math.min(5, bH * 0.07));
      for (let u = u0; u <= u1; u++) { g.fillStyle = u === litU ? COL.accent : ivory; end((u - kbLo) * ww + gap / 2, top + 1, ww - gap, kbH - 1, rW); }
      const kA = 12 * Math.floor(u0 / 7) - 1, kZ = 12 * Math.ceil(u1 / 7) + 12;
      for (let k = kA; k <= kZ; k++) if (BLACK[pc(k)]) { const b = keyBox(k, ww); if (b.x < -b.w || b.x > w + b.w) continue;
        g.fillStyle = k === lit ? COL.accent : '#0B1019'; end(b.x - b.w / 2, top + 1, b.w, bH, rW * 0.6);
        if (k !== lit) { g.fillStyle = '#323C4E'; g.fillRect(b.x - b.w / 2 + 1, top + 1 + bH - lip - 1, b.w - 2, lip); } }
      if (lit >= 0) { const b = keyBox(lit, ww);                                               // where the note meets the key: a flash and a few sparks
        g.fillStyle = COL.accent; g.globalAlpha = 0.35; g.beginPath(); g.arc(b.x, top, 11, 0, 7); g.fill();
        g.fillStyle = '#FFFFFF'; g.globalAlpha = 0.95; g.beginPath(); g.arc(b.x, top, 4.5, 0, 7); g.fill(); g.globalAlpha = 1;
        if (!reduceMotion && Math.random() < dt * 40 && sparks.length < 40) sparks.push({ x: b.x + (Math.random() - 0.5) * 8, y: top - 2, vx: (Math.random() - 0.5) * 46, vy: -18 - Math.random() * 46, t: 0, life: 0.45 + Math.random() * 0.45 }); }
      for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t += dt; if (s.t >= s.life) { sparks.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 30 * dt; g.globalAlpha = 1 - s.t / s.life; g.fillStyle = i % 3 ? COL.accent : '#FFFFFF'; g.fillRect(s.x, s.y, 1.6, 1.6); }
      g.globalAlpha = 1; g.restore();
    }

    function drawTrail(w, h) {
      const g = vg, y = m => Math.max(5, Math.min(h - 5, h - (m - 46) / 40 * h)), head = w - 48, pps = head / 4.5;
      g.fillStyle = COL.rule; for (const m of [64, 67, 71, 74, 77]) g.fillRect(0, Math.round(y(m)), w, 1);
      g.lineCap = 'round';
      for (let i = 1; i < hist.length; i++) { const a = hist[i - 1], b = hist[i], x = head - (vt - b.t) * pps; if (x < -4) continue;
        if (a.mu && b.mu && a.m != null && b.m != null) { g.strokeStyle = COL.accent; g.globalAlpha = 0.3 + 0.7 * Math.max(0, x / head); g.lineWidth = 3; g.beginPath(); g.moveTo(head - (vt - a.t) * pps, y(a.m)); g.lineTo(x, y(b.m)); g.stroke(); }
        else if (b.m != null) { g.fillStyle = COL.mute; g.globalAlpha = 0.5 * Math.max(0, x / head); g.fillRect(x - 1, y(b.m) - 1, 2, 2); } }
      g.globalAlpha = 1; const last = hist[hist.length - 1];
      if (last && last.mu && last.m != null) { const hy = y(last.m); g.fillStyle = COL.accent; g.beginPath(); g.arc(head, hy, 5, 0, 7); g.fill();
        g.font = '800 15px Inter, system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(noteText(V.note || ''), head + 10, Math.max(10, Math.min(h - 10, hy))); }
    }

    /* spectrogram: one column per detector frame (46 ms), taken from the detector's full power spectrum, about 11 Hz per bin.
       Rows run from 60 Hz to 6 kHz on a log scale, so each octave gets the same height, like the keyboard. Colour follows the
       loudest recent sound over a 70 dB range, so a quiet microphone still shows its overtones while silence stays dark.
       A device following a session has no spectrum, only the 44 shared level bands, so it draws its columns from those. */
    const SG_ROWS = 192, SG_COLS = 150, SG_LO = 60, SG_HI = 6000, SG_DT = 0.046, SG_RANGE = 70;
    const sgCv = document.createElement('canvas'); sgCv.width = SG_COLS; sgCv.height = SG_ROWS;
    const sgG = sgCv.getContext('2d'), sgCol = sgG.createImageData(1, SG_ROWS), sgV = new Float32Array(SG_ROWS);
    let sgAt = 0, sgAcc = 0, sgRef = -40, sgInit = false;
    const SG_LUT = (function () {                                   // near black, violet, magenta, orange, yellow, then pale yellow: each step louder is a new colour
      const stops = [[0, 0x080D15], [0.18, 0x2A1260], [0.38, 0x7A1FA2], [0.56, 0xD8327E], [0.72, 0xFF6A3D], [0.87, 0xFFC23A], [1, 0xFFF6C8]], lut = new Uint8Array(256 * 3);
      for (let i = 0; i < 256; i++) { const t = i / 255; let j = 0; while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
        const [t0, c0] = stops[j], [t1, c1] = stops[j + 1], u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
        for (let k = 0; k < 3; k++) { const sh = 16 - 8 * k, a = (c0 >> sh) & 255, b = (c1 >> sh) & 255; lut[i * 3 + k] = Math.round(a + (b - a) * u); } }
      return lut;
    })();
    const sgY = (f, h) => h * (1 - Math.log(f / SG_LO) / Math.log(SG_HI / SG_LO));   // where a frequency sits in a picture h high
    function sgColumn(live) {
      if (!live) sgV.fill(0);
      else if (host.audio.det() && !host.following()) {
        const P = host.audio.det().P, bh = host.audio.det().binHz, top = P.length - 2, step = Math.pow(SG_HI / SG_LO, 1 / SG_ROWS); let peak = -200;
        for (let r = 0, f0 = SG_LO; r < SG_ROWS; r++, f0 *= step) {
          const x0 = f0 / bh, x1 = f0 * step / bh; let p;
          if (x1 - x0 < 1) { const x = Math.min(top, (x0 + x1) / 2), k = Math.floor(x), u = x - k; p = P[k] * (1 - u) + P[k + 1] * u; }   // low notes: between two bins
          else { p = 0; for (let k = Math.floor(x0), e = Math.min(top, Math.ceil(x1)); k <= e; k++) if (P[k] > p) p = P[k]; }          // high notes: the strongest bin in the row
          const d = 10 * Math.log10(p + 1e-20); sgV[r] = d; if (d > peak) peak = d; }
        sgRef = Math.max(peak, sgRef - 0.15, -40);                      // follows a louder sound at once and a quieter one by about 3 dB a second
        for (let r = 0; r < SG_ROWS; r++) { const v = (sgV[r] - sgRef + SG_RANGE) / SG_RANGE; sgV[r] = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 1.25); }
      } else {
        const L = Math.log(5000 / 70), step = Math.pow(SG_HI / SG_LO, 1 / SG_ROWS);
        for (let r = 0, f = SG_LO * Math.sqrt(step); r < SG_ROWS; r++, f *= step) {
          const x = NB * Math.log(f / 70) / L - 0.5, k = Math.floor(x), u = x - k;
          const a = k >= 0 && k < NB ? bars[k] : 0, b = k + 1 >= 0 && k + 1 < NB ? bars[k + 1] : 0; sgV[r] = Math.pow(a + (b - a) * u, 1.3); }
      }
      const d = sgCol.data;
      for (let r = 0; r < SG_ROWS; r++) { const o = (SG_ROWS - 1 - r) * 4, c = Math.round(sgV[r] * 255) * 3; d[o] = SG_LUT[c]; d[o + 1] = SG_LUT[c + 1]; d[o + 2] = SG_LUT[c + 2]; d[o + 3] = 255; }
      sgG.putImageData(sgCol, sgAt, 0); sgAt = (sgAt + 1) % SG_COLS;
    }
    function drawSpectrogram(w, h, dt) {
      const g = vg;
      if (!sgInit) { sgInit = true; sgG.fillStyle = '#080D15'; sgG.fillRect(0, 0, SG_COLS, SG_ROWS); }
      sgAcc += dt; let n = 0; while (sgAcc >= SG_DT && n++ < 8) { sgAcc -= SG_DT; sgColumn(V.st === 'running'); } if (sgAcc > 0.5) sgAcc = 0;
      g.save(); rrect(g, 0, 0, w, h, 10); g.clip(); g.imageSmoothingEnabled = true;
      const cw = w / (SG_COLS - 1), x0 = -sgAcc / SG_DT * cw, a = SG_COLS - sgAt;          // oldest column on the left; slides a little each frame so the scroll is smooth
      g.drawImage(sgCv, sgAt, 0, a, SG_ROWS, x0, 0, a * cw, h);
      if (sgAt > 0) g.drawImage(sgCv, 0, 0, sgAt, SG_ROWS, x0 + a * cw, 0, sgAt * cw, h);
      g.font = '11px Inter, system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
      const oct = sgY(SG_LO, h) - sgY(2 * SG_LO, h), every = oct < 22 ? 2 : 1;                 // a short picture labels every other C
      for (let o = 2; o <= 8; o++) { const y = Math.round(sgY(440 * Math.pow(2, (12 * (o + 1) - 69) / 12), h)) + 0.5; if (y < 8 || y > h - 6) continue;   // each C, from C2 up
        g.fillStyle = 'rgba(244,247,251,.08)'; g.fillRect(0, y, w, 1);
        if (o % every === 0) { g.shadowColor = 'rgba(8,13,21,.95)'; g.shadowBlur = 4; g.fillStyle = COL.mute; g.fillText(noteText('C' + o), 6, y - 7); g.shadowBlur = 0; } }
      g.shadowColor = 'rgba(8,13,21,.95)'; g.shadowBlur = 4;                                         // labels stay readable over bright overtones
      if (V.st === 'running' && V.music && V.midi != null) {                                        // the note being played, at the right edge
        const f = 440 * Math.pow(2, (V.midi - 69) / 12), y = sgY(f, h);
        if (y > 4 && y < h - 4) { g.fillStyle = COL.accent; g.beginPath(); g.moveTo(w - 2, y - 6); g.lineTo(w - 10, y); g.lineTo(w - 2, y + 6); g.closePath(); g.fill();
          if (V.note) { g.font = '800 13px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(noteText(V.note), w - 14, Math.max(9, Math.min(h - 9, y))); } }
      }
      g.restore();
    }

    const WCOLS = 180, wcv = document.createElement('canvas'); wcv.width = WCOLS; wcv.height = NB;
    const wg = wcv.getContext('2d'), wimg = wg.createImageData(WCOLS, NB); let wAcc = 0, wInit = false;
    function drawWaterfall(w, h, dt) {
      const d = wimg.data, bg = [20, 29, 43], ac = hexRgb(COL.accent), gr = hexRgb(COL.mute), hi = [244, 247, 251], live = V.st === 'running';
      if (!wInit) { wInit = true; for (let i = 0; i < d.length; i += 4) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = 255; } }
      wAcc += dt; let n = 0;
      while (wAcc >= 1 / 40 && n++ < 6) { wAcc -= 1 / 40;
        for (let r = 0; r < NB; r++) { const row = r * WCOLS * 4, o = row + (WCOLS - 1) * 4, v = live ? bars[NB - 1 - r] : 0; d.copyWithin(row, row + 4, row + WCOLS * 4);
          let c0 = bg, c1 = gr, u = Math.min(1, v * 1.25);
          if (V.music) { if (v < 0.6) { c1 = ac; u = v / 0.6; } else { c0 = ac; c1 = hi; u = Math.min(1, (v - 0.6) / 0.4); } }
          d[o] = c0[0] + (c1[0] - c0[0]) * u; d[o + 1] = c0[1] + (c1[1] - c0[1]) * u; d[o + 2] = c0[2] + (c1[2] - c0[2]) * u; } }
      if (wAcc > 0.2) wAcc = 0;
      wg.putImageData(wimg, 0, 0);
      const g = vg; g.save(); rrect(g, 0, 0, w, h, 10); g.clip(); g.imageSmoothingEnabled = true; g.drawImage(wcv, 0, 0, w, h);
      if (h > 56) { g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = COL.mute; g.textBaseline = 'middle';
        for (const f of [[200, '200 Hz'], [1000, '1 kHz'], [3000, '3 kHz']]) g.fillText(f[1], 6, h - Math.log(f[0] / 70) / Math.log(5000 / 70) * h); }
      g.restore();
    }

    function drawHalo(w, h) {
      const g = vg, cx = w / 2, cy = h / 2, r0 = Math.max(10, h * 0.25), maxLen = Math.max(4, h / 2 - r0 - 3);
      g.strokeStyle = COL.rule; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, Math.max(4, r0 - 5), 0, 7); g.stroke();
      g.lineCap = 'round'; g.lineWidth = Math.max(2, Math.min(3.5, h / 40)); g.strokeStyle = V.music ? COL.accent : COL.mute; g.globalAlpha = V.music ? 1 : 0.6;
      for (let i = 0; i < NB; i++) { const a = -Math.PI / 2 + i / NB * 2 * Math.PI, len = 2 + shown[i] * maxLen, c = Math.cos(a), s = Math.sin(a);
        g.beginPath(); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * (r0 + len), cy + s * (r0 + len)); g.stroke(); }
      g.globalAlpha = 1;
      if (V.music && V.note && r0 > 16) { g.fillStyle = COL.accent; g.font = '800 ' + Math.round(Math.min(24, r0 * 0.8)) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(noteText(V.note), cx, cy + 1); g.textAlign = 'start'; }
    }

    function drawViz(dt) {
      trackNotes(dt);
      const w = viz.clientWidth, h = viz.clientHeight; if (w < 10 || h < 10) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(w * dpr), chh = Math.round(h * dpr);
      if (viz.width !== cw || viz.height !== chh) { viz.width = cw; viz.height = chh; }
      if (colN-- <= 0) { colN = 40; const cs = getComputedStyle(document.getElementById('app')), v = (n, f) => cs.getPropertyValue(n).trim() || f;
        COL = { rule: v('--rule', COL.rule), mute: v('--mute-2', COL.mute), accent: v('--accent', COL.accent), ink: v('--ink', COL.ink) }; }
      vg.setTransform(dpr, 0, 0, dpr, 0, 0); vg.clearRect(0, 0, w, h);
      const live = V.st === 'running', a = Math.min(1, dt * 16);
      for (let i = 0; i < NB; i++) shown[i] += ((live ? bars[i] : 0) - shown[i]) * a;
      const kind = VIZ[vizI][0];
      if (kind === 'piano') drawPiano(w, h, dt); else if (kind === 'spectrogram') drawSpectrogram(w, h, dt); else if (kind === 'trail') drawTrail(w, h); else if (kind === 'waterfall') drawWaterfall(w, h, dt); else drawHalo(w, h);
    }

    return {
      frame(dt, f) { if (f.shown) drawViz(dt); },
      paint(v) {
        const st = v.st, fol = v.follow;
        let status, label = v.label, detail = v.detail, note = st === 'running' ? v.note : '';
        if (st === 'idle') { status = tr('Ready when you are'); label = tr('Press Start, then play'); detail = tr('The timer only counts while an instrument is heard.'); }
        else if (st === 'running') status = tr(v.hold ? 'Counting: a short pause' : v.music ? 'Counting: music heard' : 'Waiting for music');
        else if (st === 'paused') { status = tr('Paused'); label = tr('Not listening'); detail = tr('Sound is ignored until you resume.'); }
        else { status = tr('Session finished'); label = tr(fol ? 'The session has ended' : 'Nicely done'); detail = fol ? '' : tr('Start again whenever you like.'); }
        if (fol) status = tr(v.followName ? 'Following live ({name}): {status}' : 'Following live: {status}', { name: v.followName, status: status.toLowerCase() });
        const play = host.fmt(v.play), reached = v.play >= v.goal && st !== 'idle', fmt = host.fmt;
        clock(play); text($('cTenths'), '.' + Math.floor(v.play * 10) % 10);
        text($('cMic'), tr(st === 'running' ? (v.music ? 'Music' : fol ? 'Live' : v.demo ? 'Demo' : 'Listening') : st === 'paused' ? 'Paused' : 'Mic off'));
        text($('cStatus'), status); text($('cHeard'), label); text($('cDetail'), detail); text($('cNote'), noteText(note));
        text($('cEff'), (v.eff * 100).toFixed(1) + '%'); width($('cEffBar'), v.eff);
        text($('cGoalV'), fmt(v.goal)); text($('cGoal'), reached ? '' : host.goalLeft(v)); text($('cGoalK'), tr(reached ? 'Goal reached' : 'Practice goal')); width($('cGoalBar'), v.play / v.goal);
        text($('cActive'), fmt(v.active));
        text($('cTotal'), fmt(v.total)); text($('cPauses'), trn(v.pauses, '{n} pause', '{n} pauses'));
      },
      langChanged() { setViz(vizI, false); },
    };
  },
};
