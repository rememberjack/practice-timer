/* Music Timer core: detector, test signals, session clock, practice log, and the registry of theme modules (src/themes/).
   Pure logic, no DOM. Runs in the browser and in Node (for tests). */
(function (root) {
'use strict';

/* ---------- Languages: the page's words in English, Simplified Chinese or French ----------
   English is the key: every word is written in English in the code, and tr() looks it up in the chosen language's table (WORDS, filled
   by src/lang.js), so a text with no translation shows in English. {x} in a text is filled in from vars. trn() picks the singular or
   plural by each language's rule (French counts 0 as singular; Chinese has one form). Each language: its id, its own name, its locale */
const LANGS = [['en', 'English', 'en'], ['zh', '简体中文', 'zh-CN'], ['fr', 'Français', 'fr-FR']];
const WORDS = { en: {} }, HOME_LANG = {};
let lang = 'en';
function addWords(id, words, home) { WORDS[id] = words; if (home) HOME_LANG[id] = home; }
function setLang(id) { lang = WORDS[id] && LANGS.some(l => l[0] === id) ? id : 'en'; return lang; }
function getLang() { return lang; }
/* the language to use: the one chosen in Settings, or with none chosen (''), the first of the device's languages there are words for */
function pickLang(chosen, device) {
  if (chosen && LANGS.some(l => l[0] === chosen)) return chosen;
  for (const d of device || []) { const p = String(d).toLowerCase().split('-')[0], l = LANGS.find(x => x[0] === p); if (l) return l[0]; }
  return 'en';
}
function locale() { return lang === 'en' ? [] : LANGS.find(l => l[0] === lang)[2]; }   // English dates keep the device's own format, as before
function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? String(vars[k]) : m) : s; }
function tr(s, vars) { const w = WORDS[lang][s]; return fill(w != null ? w : s.replace(/\|.*$/, ''), vars); }   // 'End|part': a context after | tells apart two uses of the same English word
function trn(n, one, other, vars) { const v = Object.assign({ n: n }, vars); return tr(lang === 'fr' ? (n < 2 ? one : other) : n === 1 ? one : other, v); }
function inLang(id, fn) { const was = lang; setLang(id); try { return fn(); } finally { lang = was; } }

/* ---------- FFT (in-place radix-2) ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const NOTE_NAMES = ['C', 'C\u266F', 'D', 'E\u266D', 'E', 'F', 'F\u266F', 'G', 'A\u266D', 'A', 'B\u266D', 'B'];
function noteOf(f) {
  const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* minDb: the quietest sound that is listened to at all (frame level, dBFS). Soft playing from across a room comes in around
   -70 dB on a phone, so only Strict leaves it out; what is not an instrument is told apart by its pitch, not by its loudness */
const SENSITIVITY = {
  strict:  { on: 0.70, off: 0.40, minDb: -55 },
  normal:  { on: 0.60, off: 0.32, minDb: -80 },
  lenient: { on: 0.50, off: 0.25, minDb: -95 }
};
/* How much a tonal frame counts, by how its pitch behaves (see MusicDetector). A pitch that holds, or swings either side of one
   note (vibrato), counts in full. A frame with no single pitch (a chord), the first frame of a new note, or a pitch that drifts
   counts for less, unless most of the pitched sound in the last couple of seconds held its notes (ctx), as an instrument's does,
   or the pitches of the last few seconds all lie on one tuning grid, a whole number of semitones apart (tune), as they do even in a
   scale too fast for any note to hold. A voice's pitches lie anywhere. The grid only ever adds credit, so a player who is not
   quite in tune counts as before */
const NOTE = { none: 0.7, step: 0.9, fresh: 0.5, drift: 0.15, lifted: 0.95, ctxT: 2, ctx0: 0.35, ctxW: 0.25, ctxStart: 0.45,
  tuneT: 3, tuneN: 8, tune0: 0.3, tuneW: 0.3, tuneM: -0.1 };

const INSTRUMENTS = {
  piano:    { name: 'Piano' },
  clarinet: { name: 'Clarinet' },
  flute:    { name: 'Flute' },
  cello:    { name: 'Cello' },
  violin:   { name: 'Violin' }
};

/* ---------- Music detector ----------
   Feed it one frame of raw samples (latest N samples) plus the time since the previous frame.
   It decides, frame by frame, whether the sound is a musical instrument:
   1. spectrum -> sharp, stable partials (tonal energy ratio) separate instruments from noise
   2. pitch track -> an instrument holds each note (or swings either side of it, with vibrato) and steps to the next;
      a voice glides, wanders and jumps about, even in a room whose echo joins its syllables up
   3. slow per-bin floor absorbs constant hums (fridge, fan, mains)
   4. smoothed score with hysteresis gives the on/off decision */
class MusicDetector {
  constructor(sampleRate, opts) {
    opts = opts || {};
    this.sr = sampleRate;
    const N = this.N = opts.fftSize || (sampleRate >= 32000 ? 4096 : 2048);
    this.binHz = sampleRate / N;
    this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    const half = N / 2 + 1;
    this.P = new Float32Array(half); this.P0 = new Float32Array(half); this.E = new Float32Array(half);
    this.floor = new Float32Array(half); this.used = new Uint8Array(half);
    this.W = Math.max(4, Math.round(100 / this.binHz));
    this.kLo = Math.max(3, Math.ceil(70 / this.binHz));
    this.kHi = Math.min(N / 2 - this.W - 4, Math.floor(5000 / this.binHz));
    this.tmp = new Float32Array(2 * this.W + 1);
    this.peaks = []; for (let i = 0; i < 40; i++) this.peaks.push({ f: 0, p: 0 });
    this.hp = new Float64Array(17);
    this.pf = new Float64Array(4); this.pd = new Float64Array(4);
    this.lh = new Float64Array(6); this.lp = new Float64Array(6); this.lpf = new Float64Array(6); this.lt = new Uint8Array(6); this.fq = new Int8Array(6);
    this.hist = new Float32Array(128); this.ch = new Float64Array(8); this.seg = new Float64Array(8);
    this.setSensitivity(opts.sensitivity || 'normal');
    this.out = { levelDb: -120, active: false, tonal: false, ter: 0, pitch: 0, note: '', score: 0,
      isMusic: false, kind: 'quiet', label: tr('Quiet'), detail: '', instrument: '' };
    this.reset();
  }
  setSensitivity(name) { this.sens = SENSITIVITY[name] || SENSITIVITY.normal; }
  reset() {
    this.floor.fill(1e-9); this.pf.fill(0); this.pd.fill(0.05);
    this.score = 0; this.isMusic = false; this.glideHold = 0; this.flat = 0; this.bridge = 0;
    this.ch.fill(NaN); this.gx = this.gy = this.gw = this.gq = 0; this.held = false; this.ctx = NOTE.ctxStart; this.lh.fill(-120); this.lp.fill(0); this.lpf.fill(0); this.lt.fill(0); this.fq.fill(-1); this.P0.fill(0); this.hist.fill(0);
    this.duty = 0; this.trans = 0; this.prevLevel = -120; this.prevLevel2 = -120;
    this.lm = -80; this.lv = 0;
    // what the instrument sounds like: averages that start from a guess worth three frames, then keep a 2.5 s memory (vibrato: 5 s, no guess)
    this.fall = 0.2; this.fallN = 0; this.fade = 0.3; this.fadeN = 0; this.inh = 0.2; this.inhN = 0; this.poly = 0;
    this.vib = 0; this.vibN = 0; this.oddR = 0.6; this.up = 0.1; this.h21 = 0; this.h21N = 0; this.lf0 = Math.log(330); this.instN = 0;
  }
  process(frame, dt) {
    const N = this.N, re = this.re, im = this.im, win = this.win, P = this.P, E = this.E, fl = this.floor;
    const binHz = this.binHz, W = this.W, kLo = this.kLo, kHi = this.kHi, o = this.out;
    if (!(dt > 0)) dt = 0.046; if (dt > 1) dt = 1;
    const n = Math.min(N, frame.length), off = frame.length - n;
    let mean = 0; for (let i = 0; i < n; i++) mean += frame[off + i]; mean /= n;
    let ss = 0;
    for (let i = 0; i < N; i++) { const v = i < n ? frame[off + i] - mean : 0; ss += v * v; re[i] = v * win[i]; im[i] = 0; }
    const level = 10 * Math.log10(ss / n + 1e-12);
    fft(re, im);

    // power spectrum, slow floor (absorbs constant hum), floor-relative energy
    const norm = 16 / (N * N), kTop = kHi + W + 2, rise = Math.pow(10, 0.3 * dt);
    let Etot = 0, maxE = 0;
    for (let k = 1; k <= kTop; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) * norm; P[k] = p;
      let f = fl[k] * rise; if (p < f) f = p < 1e-12 ? 1e-12 : p; fl[k] = f;
      const e = p > 8 * f ? p : 0; E[k] = e;
      if (k >= kLo && k <= kHi) { Etot += e; if (e > maxE) maxE = e; }
    }

    // spectral peaks that stand well clear of their neighbourhood
    const peaks = this.peaks, used = this.used, tmp = this.tmp;
    let np = 0, Epk = 0, maxPk = 0;
    if (maxE > 1e-9) {
      used.fill(0, 0, kTop + 3);
      const thr = Math.max(1e-9, maxE * 1e-4);
      for (let k = kLo; k <= kHi; k++) {
        const v = E[k];
        if (v < thr || v <= E[k - 1] || v < E[k + 1]) continue;
        let lo = k - W; if (lo < 1) lo = 1;
        for (let j = 0; j < tmp.length; j++) tmp[j] = P[lo + j];
        tmp.sort();
        const bg = tmp[(tmp.length * 0.25) | 0];
        if (v < 28 * (bg > 1e-13 ? bg : 1e-13)) continue;
        let pw = 0;
        for (let j = k - 2; j <= k + 2; j++) if (!used[j]) { used[j] = 1; pw += E[j]; }
        const a = Math.log(E[k - 1] + 1e-20), b = Math.log(v), c = Math.log(E[k + 1] + 1e-20), den = a - 2 * b + c;
        let d = den < 0 ? 0.5 * (a - c) / den : 0; if (d > 0.5) d = 0.5; else if (d < -0.5) d = -0.5;
        Epk += pw; if (pw > maxPk) maxPk = pw;
        if (np < 40) { const pk = peaks[np++]; pk.f = (k + d) * binHz; pk.p = pw; }
      }
    }
    const ter = Etot > 0 ? Epk / Etot : 0;

    // do the overtones that carry on from the last frame grow quieter (a struck string) or hold (bowed, blown)?
    // Each peak is compared with the same spot a frame ago; weighted share of them fading by more than 4 dB a second
    const P0 = this.P0; let fw = 0, fd = 0;
    for (let j = 0; j < np; j++) {
      const k0 = Math.round(peaks[j].f / binHz); let c = 0, b = 0;
      for (let k = k0 - 2; k <= k0 + 2; k++) { if (P[k] > c) c = P[k]; if (P0[k] > b) b = P0[k]; }
      const d = 10 * Math.log10((c + 1e-20) / (b + 1e-20)), w = Math.sqrt(peaks[j].p);
      if (d > -12 && d < 12) { fw += w; if (d < -4 * dt) fd += w; }                       // a peak that just began or ended is not compared
    }
    P0.set(P.subarray(0, kTop + 3));

    // fundamental by harmonic matching
    const hp = this.hp; hp.fill(0);
    let f0 = 0, harm = 0, stretch = null, fine = 0;
    if (np > 0) {
      let best = 0, bestF = 0;
      const m = Math.min(np, 8);
      for (let i = 0; i < m; i++) { // partial selection sort: strongest first
        let bi = i; for (let j = i + 1; j < np; j++) if (peaks[j].p > peaks[bi].p) bi = j;
        if (bi !== i) { const t = peaks[i]; peaks[i] = peaks[bi]; peaks[bi] = t; }
      }
      for (let i = 0; i < m; i++) for (let d = 1; d <= 4; d++) {
        const fc = peaks[i].f / d; if (fc < 55 || fc > 2200) continue;
        let S = 0;
        for (let j = 0; j < np; j++) {
          const q = peaks[j], h = Math.round(q.f / fc); if (h < 1 || h > 16) continue;
          if (Math.abs(q.f - h * fc) > Math.min(0.03 * q.f + 0.5 * binHz, 0.3 * fc)) continue;
          S += Math.sqrt(q.p) * Math.pow(0.85, h - 1);
        }
        if (S > best) { best = S; bestF = fc; }
      }
      if (bestF > 0) {
        let Em = 0, wsum = 0, fsum = 0, gw = 0, gf = 0, sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, nh = 0, hmax = 0;
        for (let j = 0; j < np; j++) {
          const q = peaks[j], h = Math.round(q.f / bestF); if (h < 1 || h > 16) continue;
          if (Math.abs(q.f - h * bestF) > Math.min(0.03 * q.f + 0.5 * binHz, 0.3 * bestF)) continue;
          Em += q.p; if (q.p > hp[h]) hp[h] = q.p;
          const w = Math.sqrt(q.p), x = h * h, r = q.f / (h * bestF) - 1;
          if (h <= 5) { wsum += w; fsum += w * q.f / h; }
          gw += w * h * h; gf += w * h * q.f;                                 // the high overtones pin the pitch down finest
          sw += w; sx += w * x; sy += w * r; sxx += w * x * x; sxy += w * x * r; nh++; if (h > hmax) hmax = h;
        }
        harm = Em / Epk; f0 = wsum > 0 ? fsum / wsum : bestF; fine = gw > 0 ? gf / gw : 0;
        // A stiff piano string sounds its overtones a little sharp, the more so the higher they go: f(h) = h f0 (1 + B h^2 / 2).
        // Bowed strings and wind instruments keep them exactly in tune. B comes from a weighted line fit of the mistuning against h^2.
        const den = sw * sxx - sx * sx;
        if (nh >= 4 && hmax >= 4 && den > 0) stretch = 2 * (sw * sxy - sx * sy) / den;
      }
    }

    const active = level > this.sens.minDb;
    const tonal = active && ter >= 0.3 && np >= 1 && maxPk > Math.pow(10, (this.sens.minDb - 15) / 10);   // the strongest partial clears the floor too
    const pitch = tonal && harm >= 0.6 ? f0 : 0;

    // pitch glide: talking slides, instruments hold or step (vibrato reverses too fast to count)
    const pf = this.pf, pd = this.pd;
    pf[0] = pf[1]; pf[1] = pf[2]; pf[2] = pf[3]; pf[3] = pitch;
    pd[0] = pd[1]; pd[1] = pd[2]; pd[2] = pd[3]; pd[3] = dt;
    let glide = false;
    if (pf[3] > 0 && pf[2] > 0 && pf[1] > 0) {
      const d2 = 1200 * Math.log2(pf[3] / pf[2]), d1 = 1200 * Math.log2(pf[2] / pf[1]);
      const r2 = Math.abs(d2 / pd[3]), r1 = Math.abs(d1 / pd[2]);
      if (d1 * d2 > 0 && r1 >= 500 && r2 >= 500 && r1 < 5000 && r2 < 5000) glide = true;
      else if (pf[0] > 0) {
        const d0 = 1200 * Math.log2(pf[1] / pf[0]), r0 = Math.abs(d0 / pd[1]);
        if (d0 * d1 > 0 && d1 * d2 > 0 && Math.min(r0, r1, r2) >= 120 && Math.max(r0, r1, r2) < 5000 &&
            Math.abs(d0 + d1 + d2) >= 30) glide = true;
      }
    }
    if (glide) this.glideHold = 0.25; else this.glideHold -= dt;

    // frame quality and smoothed decision
    // a burst that holds one pitch (a detached note) carries over a short gap
    if (pf[3] > 0 && pf[2] > 0 && Math.abs(1200 * Math.log2(pf[3] / pf[2]) / dt) < 150) this.flat++; else if (pf[3] > 0 || !tonal) this.flat = 0;
    // Does the pitch hold like a played note? It is followed back to the last step to another note, up to 8 frames
    // (an octave jump is the pitch tracker's mistake, not a step): within 3 cents plus 4 a frame it holds; vibrato swings
    // either side of one pitch, so the average of the later half stays near that of the earlier half; talking wanders off
    const ch = this.ch, seg = this.seg; for (let i = 0; i < 7; i++) ch[i] = ch[i + 1];
    ch[7] = pitch > 0 && fine > 0 ? 1200 * Math.log2(fine / 440) : NaN;
    let L = 0, lo = 0, hi = 0, turns = 0;
    if (ch[7] === ch[7]) { L = 1; seg[7] = lo = hi = ch[7];
      for (let i = 6; i >= 0; i--) { if (!(ch[i] === ch[i])) break;
        let d = ch[i] - ch[i + 1]; d -= 1200 * Math.round(d / 1200); if (Math.abs(d) >= 80) break;
        const v = seg[i] = seg[i + 1] + d; L++; if (v < lo) lo = v; if (v > hi) hi = v;
        if (i < 6 && (seg[i + 1] - v) * (seg[i + 2] - seg[i + 1]) < 0) turns++; } }
    let note = 0;
    if (tonal) {
      if (!L) note = NOTE.none;
      else if (L === 1) {                         // a new note: straight after a held one, or a whole number of semitones from the last
        const pv = ch[6] === ch[6] ? ch[6] : ch[5]; let d = ch[7] - pv; d = Math.abs(d - 1200 * Math.round(d / 1200));
        note = this.held || (pv === pv && d >= 70 && Math.abs(d - 100 * Math.round(d / 100)) <= 20) ? NOTE.step : NOTE.fresh;
      }
      else if (hi - lo <= 3 + 4 * L) note = 1;
      else if (L >= 5 && turns >= 2 && hi - lo <= 100) {
        const h = L >> 1; let m1 = 0, m2 = 0; for (let i = 0; i < h; i++) { m1 += seg[8 - L + i]; m2 += seg[7 - i]; }
        note = Math.abs(m2 - m1) / h <= 15 ? 1 : NOTE.drift;
      } else note = NOTE.drift;
    }
    this.held = note === 1;
    // the share of the pitched sound lately that held its notes: most of it while an instrument plays, little while talking.
    // While it is high, the frames in between count almost fully too, and a step between notes is not taken for a glide
    if (L) this.ctx += ((note === 1 ? 1 : 0) - this.ctx) * (1 - Math.exp(-dt / NOTE.ctxT));
    // how closely the pitches of the last few seconds keep to one tuning grid: the length of the average of their positions
    // within a semitone, taken round a circle (1 when all agree, near 0 when they lie anywhere). A few notes can agree by chance,
    // the more so the fewer and longer they are (gq adds up each note's frames squared), so the bar starts higher
    const gk = Math.exp(-dt / NOTE.tuneT); this.gx *= gk; this.gy *= gk; this.gw *= gk; this.gq *= gk * gk;
    if (L) { const a = 2 * Math.PI * ch[7] / 100; this.gx += Math.cos(a); this.gy += Math.sin(a); this.gw++; this.gq += 2 * L - 1; }
    const tune = this.gw >= NOTE.tuneN ? Math.hypot(this.gx, this.gy) / this.gw : 0;
    const bar = Math.max(NOTE.tune0, (this.gw > 0 ? Math.sqrt(this.gq) / this.gw : 1) + NOTE.tuneM);
    const lift = Math.max(clamp01((this.ctx - NOTE.ctx0) / NOTE.ctxW), clamp01((tune - bar) / NOTE.tuneW));
    if (tonal && note < 1) note += (NOTE.lifted - note) * lift;
    let q = 0;
    if (tonal) {
      q = clamp01((ter - 0.3) / 0.3) * note;
      if (this.glideHold > 0) { q *= 0.1 + 0.9 * lift; if (lift < 0.5) this.bridge = 0; } else if (this.flat >= 2) this.bridge = 0.2;
    } else {
      if (this.bridge > 0 && this.glideHold <= 0) { q = 0.6; this.bridge -= dt; }
    }
    this.score += (q - this.score) * (1 - Math.exp(-dt / 0.8));
    if (!this.isMusic && this.score >= this.sens.on) this.isMusic = true;
    else if (this.isMusic && this.score <= this.sens.off) this.isMusic = false;

    // slower statistics used to describe what is heard
    const a15 = 1 - Math.exp(-dt / 1.5), a1 = 1 - Math.exp(-dt / 1.0);
    this.duty += ((tonal ? 1 : 0) - this.duty) * a15;
    if (active && !tonal && level - Math.min(this.prevLevel, this.prevLevel2) > 9) this.trans = 0.9; else this.trans -= dt;
    this.lm += (level - this.lm) * a1; this.lv += ((level - this.lm) * (level - this.lm) - this.lv) * a1;
    const lh = this.lh, lp = this.lp, lpf = this.lpf, lt = this.lt, fq = this.fq;   // the last six frames: level, pitch, fine pitch, tonal, overtones fading
    for (let i = 0; i < 5; i++) { lh[i] = lh[i + 1]; lp[i] = lp[i + 1]; lpf[i] = lpf[i + 1]; lt[i] = lt[i + 1]; fq[i] = fq[i + 1]; }
    lh[5] = level; lp[5] = pitch; lpf[5] = pitch > 0 ? fine : 0; lt[5] = tonal ? 1 : 0; fq[5] = tonal && np >= 2 && fw > 0 ? (fd > 0.5 * fw ? 1 : 0) : -1;
    if (tonal) {
      const a = 1 - Math.exp(-dt / 2.5), wt = n => Math.max(a, 1 / (n + 3));
      // Struck (piano) or held (bowed, blown)? Three signs, each counted only where it can be judged:
      // the level of a note falls steadily, the overtones that carry on fade, the overtones are stretched sharp.
      // The first two are judged two frames late and only while the sound goes on, so the end of a note is not taken for a fade;
      // a held note wavers up and down instead (bow, breath, vibrato).
      let same = lp[3] > 0;
      for (let i = 0; i < 6 && same; i++) if (!(lp[i] > 0) || Math.abs(Math.log2(lp[i] / lp[3])) > 0.05 || (i > 0 && lh[i] - lh[i - 1] > 1)) same = false;
      if (same) { const rise = Math.max(lh[1] - lh[0], lh[2] - lh[1], lh[3] - lh[2]);
        this.fall += ((lh[3] - lh[0] < -0.9 && rise <= 0.25 ? 1 : 0) - this.fall) * wt(this.fallN++); }
      if (fq[3] >= 0 && lt[4] && lt[5] && lh[5] - lh[3] > -3) this.fade += (fq[3] - this.fade) * wt(this.fadeN++);   // chords too
      // the higher the note, the fewer overtones there are to measure it by (and the stiffer a piano's strings): the bar rises from 150 Hz
      if (stretch != null && pitch > 0 && pitch < 700) this.inh += ((stretch > 1e-4 * Math.max(1, pitch / 150) ? 1 : 0) - this.inh) * wt(this.inhN++);
      this.poly += ((harm < 0.6 && np >= 4 ? 1 : 0) - this.poly) * a15;
      if (pitch > 0) {
        const w = wt(this.instN++);
        let odd = 0, even = 0, tot = 0, up = 0;
        for (let h = 1; h <= 16; h++) { const p = hp[h]; tot += p; if (h > 1 && h * pitch >= 1800) up += p; if (h <= 8) { if (h & 1) odd += p; else even += p; } }
        this.oddR += (odd / (odd + even + 1e-20) - this.oddR) * w;              // a clarinet's lower notes have hardly any even overtones
        this.up += (up / (tot + 1e-20) - this.up) * w;                          // share of the sound above 1.8 kHz: a bright violin, a soft-edged flute
        this.lf0 += (Math.log(pitch) - this.lf0) * w;
        // below about 300 Hz a violin's body hardly sounds the fundamental, while a cello's sounds it strongly
        if (pitch < 300) this.h21 += (Math.max(-30, Math.min(30, 10 * Math.log10((hp[2] + 1e-20) / (hp[1] + 1e-20)))) - this.h21) * wt(this.h21N++);
        // Does the pitch of a held note waver? Vibrato on strings and flute; a clarinet, like a piano, holds it dead steady.
        // Judged in the middle of six frames of one note, away from its start and its end, as the share of those frames where the
        // pitch bends by more than 1.5 cents: under a half, the pitch mostly holds still (a few unsteady attacks do not change that)
        let held = lpf[3] > 0;
        for (let i = 0; i < 6 && held; i++) if (!(lpf[i] > 0) || Math.abs(Math.log2(lpf[i] / lpf[3])) > 0.05) held = false;
        if (held) this.vib += ((600 * Math.abs(Math.log2(lpf[4] * lpf[2] / (lpf[3] * lpf[3]))) > 1.5 ? 1 : 0) - this.vib) * Math.max(1 - Math.exp(-dt / 5), 1 / ++this.vibN);
        // which notes are played (held for three frames or more), over the last minute or so
        if (pf[1] > 0 && pf[2] > 0 && Math.abs(Math.log2(pf[1] / pf[3])) < 0.05 && Math.abs(Math.log2(pf[2] / pf[3])) < 0.05) {
          const hs = this.hist, k = Math.round(69 + 12 * Math.log2(pitch / 440)), d = Math.exp(-dt / 40);
          for (let i = 0; i < 128; i++) hs[i] *= d;
          if (k >= 0 && k < 128) hs[k] += dt;
        }
      }
    }
    this.prevLevel2 = this.prevLevel; this.prevLevel = level;

    o.levelDb = level; o.active = active; o.tonal = tonal; o.ter = ter; o.pitch = pitch;
    o.note = pitch > 0 ? noteOf(pitch) : ''; o.score = this.score; o.isMusic = this.isMusic;
    o.instrument = '';
    if (this.isMusic) {
      const ins = this.classify();
      o.kind = 'music'; o.instrument = ins.name; o.label = tr('Music heard'); o.detail = tr('The clock counts while you play');
    } else if (!active) { o.kind = 'quiet'; o.label = tr('Quiet'); o.detail = tr('Nothing loud enough to count'); }
    else if (this.duty > 0.85 && this.glideHold <= 0) { o.kind = 'tone'; o.label = tr('A steady tone'); o.detail = tr('Checking whether it is music'); }
    else if (this.duty > 0.22) { o.kind = 'voice'; o.label = tr('Talking or a voice'); o.detail = tr('Pitch slides and breaks up, unlike an instrument'); }
    else if (this.trans > 0) { o.kind = 'percussive'; o.label = tr('Clapping, tapping or knocking'); o.detail = tr('Short bursts with no steady pitch'); }
    else if (this.lv < 6) { o.kind = 'noise'; o.label = tr('Steady background noise'); o.detail = tr('A hum or hiss with no notes in it'); }
    else { o.kind = 'noise'; o.label = tr('Noise'); o.detail = tr('No clear notes'); }
    return o;
  }
  /* the key number (middle C = 60) that a share p of the notes held lately lie below */
  range(p) {
    const hs = this.hist; let t = 0; for (let i = 0; i < 128; i++) t += hs[i];
    let c = 0; for (let i = 0; i < 128; i++) { c += hs[i]; if (c > p * t) return i; } return -1;   // -1: no note held yet
  }
  /* Lowest notes, as key numbers: cello C2 (36), clarinet D3 (50), violin G3 (55), flute B3 (59); a semitone of leeway for tuning.
     The few lowest notes (4%) are ignored, so a stray wrong octave in the pitch does not count. */
  classify() {
    const f0 = Math.exp(this.lf0), lo = this.range(0.04);
    // a struck string: overtones stretched sharp, or fading, or several notes at once. A piano cannot play vibrato, so a
    // wavering pitch rules it out unless the signs are overwhelming (very fast notes leave few held frames to judge vibrato by)
    const struck = this.inh > 0.5 || this.fade > 0.62 || (this.fallN >= 10 && this.fall > 0.65) || this.poly > 0.4;
    if (struck && (this.vibN < 6 || this.vib < 0.5 || this.inh > 0.8 || this.fade > 0.8)) return INSTRUMENTS.piano;
    if (this.instN < 6 || lo < 0) return f0 < 185 ? INSTRUMENTS.cello : INSTRUMENTS.violin;   // too early to tell more
    if (this.vibN >= 6 && this.vib < 0.5 && lo >= 49 && this.oddR > 0.8 && this.up < 0.12) return INSTRUMENTS.clarinet;   // dead steady, hollow
    if (lo >= 58 && this.up < 0.08) return INSTRUMENTS.flute;                                  // soft-edged tone, nothing below the flute
    if (lo <= 54 || (this.h21N >= 8 && this.h21 < -6)) return INSTRUMENTS.cello;              // notes below the violin, or a cello's strong fundamental
    return INSTRUMENTS.violin;
  }
}

/* ---------- Synthetic sounds (for tests and for the demo source) ---------- */
function rng(seed) {
  let s = seed >>> 0;
  return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

const VOICES = {
  violin:   { amp: h => 1 / h, vibHz: 6, vibCents: 18, noise: 0.004, attack: 0.04, release: 0.04 },
  cello:    { amp: h => 1 / h, vibHz: 5.5, vibCents: 14, noise: 0.004, attack: 0.06, release: 0.05 },
  clarinet: { amp: h => (h % 2 ? 1 : 0.03) / h, vibHz: 0, vibCents: 0, noise: 0.003, attack: 0.03, release: 0.04 },
  flute:    { amp: h => [0, 1, 0.2, 0.06, 0.02][h] || 0, vibHz: 5, vibCents: 8, noise: 0.012, attack: 0.05, release: 0.05 }
};
/* notes: [midi, seconds, gapSeconds] */
function synthSustained(sr, voice, notes, level, seed) {
  const v = VOICES[voice], R = rng(seed || 1);
  let total = 0; for (const nt of notes) total += nt[1] + (nt[2] || 0);
  const out = new Float32Array(Math.ceil(total * sr));
  let pos = 0, T = 0; const amps = new Float64Array(25);
  for (const nt of notes) {
    const f0 = midiHz(nt[0]), dur = nt[1], n = Math.floor(dur * sr);
    let H = 0, e2 = 0;
    for (let h = 1; h <= 24 && h * f0 < 7000; h++) { amps[h] = v.amp(h); e2 += amps[h] * amps[h]; H = h; }
    const g = (level || 0.2) / Math.sqrt(e2);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.min(1, t / v.attack) * Math.min(1, (dur - t) / v.release);
      const vd = v.vibCents * Math.min(1, t / 0.15);
      ph += 2 * Math.PI * f0 * Math.pow(2, vd * Math.sin(2 * Math.PI * v.vibHz * (T + t)) / 1200) / sr;
      let s = 0; for (let h = 1; h <= H; h++) if (amps[h]) s += amps[h] * Math.sin(h * ph);
      out[pos + i] = g * env * s + v.noise * env * (R() * 2 - 1);
    }
    pos += n + Math.floor((nt[2] || 0) * sr); T += dur + (nt[2] || 0);
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.0006 * (R() * 2 - 1);
  return out;
}
/* events: [startSeconds, midi, heldSeconds] */
function synthPiano(sr, events, total, level, seed) {
  const R = rng(seed || 2), out = new Float32Array(Math.ceil(total * sr));
  for (const ev of events) {
    const f0 = midiHz(ev[1]), i0 = Math.floor(ev[0] * sr), held = ev[2];
    const n = Math.min(out.length - i0, Math.floor((held + 0.35) * sr));
    for (let h = 1; h <= 10 && h * f0 < 6000; h++) {
      const fh = h * f0 * Math.sqrt(1 + 0.0004 * h * h), a = (level || 0.18) / Math.pow(h, 1.3);
      const tau = (f0 < 200 ? 2.0 : 1.4) / (1 + 0.35 * (h - 1)), w = 2 * Math.PI * fh / sr;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        out[i0 + i] += a * (t < 0.004 ? t / 0.004 : 1) * Math.exp(-t / tau) * (t > held ? Math.exp(-(t - held) / 0.08) : 1) * Math.sin(w * i);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.0006 * (R() * 2 - 1);
  return out;
}
/* Instruments closer to how they really sound, checked against recordings of single violin, cello, flute and clarinet notes.
   The voices above are idealised, each built around one trait; these are not, and most of the instrument tests use them:
   - a bowed string is a sawtooth shaped by the body: its resonances sit at fixed frequencies, so vibrato also swells and dips
     each overtone, and a violin body barely sounds anything below its air resonance (about 275 Hz)
   - a flute's overtones depend on the register: strong in the low octave, almost none at the top; plenty of breath noise
   - a clarinet has hardly any even overtones in its low register but has them higher up; no vibrato
   - bow pressure and breath are never quite steady: the level wanders by a dB or so, the pitch by a cent or two
   db(h, f, f0): level of overtone h (dB), now sounding at f, of a note whose fundamental is f0. */
const below = (f, fc, s) => f < fc ? -s * Math.log2(fc / f) : 0, above = (f, fc, s) => f > fc ? -s * Math.log2(f / fc) : 0;
const bump = (f, fc, oct, g) => { const x = Math.log2(f / fc) / oct; return g * Math.exp(-0.5 * x * x); };
const ripple = f => 3.5 * Math.sin(2 * Math.PI * 2.7 * Math.log2(f / 100) + 1.3) + 2.5 * Math.sin(2 * Math.PI * 4.9 * Math.log2(f / 100) + 0.4);   // the many small body modes
const PLAYED = {
  violin:   { vibHz: 6, vibCents: 11, wander: 1.5, noise: -38, attack: 0.07, release: 0.06,
    db: (h, f) => -20 * Math.log10(h) + below(f, 275, 12) + bump(f, 280, 0.12, 5) + bump(f, 480, 0.25, 6) + bump(f, 2600, 0.7, 9) + above(f, 4500, 18) + ripple(f) },
  cello:    { vibHz: 5.5, vibCents: 11, wander: 1.5, noise: -38, attack: 0.08, release: 0.07,
    db: (h, f) => -20 * Math.log10(h) + below(f, 95, 12) + bump(f, 105, 0.12, 4) + bump(f, 210, 0.4, 7) + above(f, 500, 4) + bump(f, 1700, 0.6, 7) + above(f, 3200, 15) + ripple(f) },
  flute:    { vibHz: 5, vibCents: 10, am: 1.5, wander: 1.2, noise: -27, attack: 0.06, release: 0.06,
    db: (h, f, f0) => h === 1 ? 0 : 6 - 10 * Math.log2(f0 / 262) - (5 + 9 * clamp01(Math.log2(f0 / 440))) * (h - 2) },
  clarinet: { vibHz: 0, vibCents: 0, wander: 0.4, noise: -42, attack: 0.03, release: 0.05,
    db: (h, f, f0) => -3 * Math.log2(h) + above(f, 1600, 24) +
      (h % 2 ? 0 : (-28 + 25 * clamp01(Math.log2(f0 / 450) / Math.log2(650 / 450))) * clamp01(1 - Math.log2(f / 1600))) }
};
/* notes: [midi, seconds, gapSeconds]; o: {level, seed, vib (vibrato depth in cents; 0 plays without vibrato)} */
function synthPlayed(sr, inst, notes, o) {
  o = o || {}; const v = PLAYED[inst], R = rng(o.seed || 1), level = o.level || 0.2, nz = level * Math.pow(10, v.noise / 20);
  let total = 0.05; for (const nt of notes) total += nt[1] + (nt[2] || 0);
  const out = new Float32Array(Math.ceil(total * sr)), amp = new Float64Array(65), ph = new Float64Array(65);
  const vibC = o.vib != null ? o.vib : v.vibCents, vibHz = v.vibHz * (0.95 + 0.1 * R());
  const K = Math.ceil(total * 8) + 2, wl = new Float64Array(K), wp = new Float64Array(K);   // the wandering level (dB) and pitch (cents), 8 steps a second
  for (let i = 0; i < K; i++) { wl[i] = (R() * 2 - 1) * v.wander; wp[i] = (R() * 2 - 1) * 2; }
  const walk = (a, t) => { const x = t * 8, i = Math.floor(x), u = x - i; return a[i] + (a[i + 1] - a[i]) * u * u * (3 - 2 * u); };
  let pos = Math.floor(0.05 * sr), T = 0.05, vph = R() * 2 * Math.PI, prev = 0;
  for (const nt of notes) {
    const f0 = midiHz(nt[0]), dur = nt[1], n = Math.floor(dur * sr);
    let H = 0; for (let h = 1; h <= 64 && h * f0 < 6000; h++) H = h;
    let g = 0, fi = f0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) {                                                  // overtone levels follow the sounding pitch through the body
        const vd = vibC * clamp01((t - 0.12) / 0.25);                        // vibrato starts once the note is under way
        fi = f0 * Math.pow(2, (vd * Math.sin(vph) + walk(wp, T + t)) / 1200);
        let e2 = 0; for (let h = 1; h <= H; h++) { const a = Math.pow(10, v.db(h, h * fi, f0) / 20); amp[h] = a; e2 += a * a; }
        g = level / Math.sqrt(e2) * Math.pow(10, (walk(wl, T + t) + (v.am && vibC ? v.am * vd / vibC * Math.sin(vph) : 0)) / 20);
      }
      vph += 2 * Math.PI * vibHz / sr;
      const env = Math.min(1, t / v.attack, (dur - t) / v.release);
      let s = 0; for (let h = 1; h <= H; h++) { ph[h] += 2 * Math.PI * h * fi / sr; s += amp[h] * Math.sin(ph[h]); }
      const w = R() * 2 - 1; out[pos + i] += env * (g * s + nz * (w - 0.6 * prev)); prev = w;   // bow or breath noise, tilted towards the highs
    }
    for (let h = 1; h <= H; h++) ph[h] %= 2 * Math.PI;
    pos += n + Math.floor((nt[2] || 0) * sr); T += dur + (nt[2] || 0);
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.0006 * (R() * 2 - 1);
  return out;
}
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410]];
/* Speech-like sound: gliding pitch through moving formants, syllable rhythm, hissy consonants, pauses. */
function synthSpeech(sr, total, f0base, seed, glideSemis) {
  const R = rng(seed || 3), out = new Float32Array(Math.ceil(total * sr)), amps = new Float64Array(64);
  const gl = glideSemis == null ? 8 : glideSemis;
  let t = 0.1, st = 0;
  while (t < total - 0.4) {
    const r = R();
    if (r < 0.14) { t += 0.15 + R() * 0.3; continue; }
    if (r < 0.34) {
      const d = 0.05 + R() * 0.08, n = Math.floor(d * sr), i0 = Math.floor(t * sr); let prev = 0;
      for (let i = 0; i < n; i++) { const x = R() * 2 - 1; out[i0 + i] += 0.06 * Math.sin(Math.PI * i / n) * (x - prev); prev = x; }
      t += d; continue;
    }
    const d = 0.11 + R() * 0.2, n = Math.floor(d * sr), i0 = Math.floor(t * sr);
    const v0 = VOWELS[(R() * VOWELS.length) | 0], v1 = VOWELS[(R() * VOWELS.length) | 0];
    const s0 = st + (R() - 0.5) * 4, s1 = s0 + (R() - 0.5) * gl; st = s1 * 0.6;
    let ph = 0, H = 0, nrm = 1;
    for (let i = 0; i < n; i++) {
      const u = i / n, f0 = f0base * Math.pow(2, (s0 + (s1 - s0) * u) / 12);
      if ((i & 63) === 0) {
        let e2 = 0; H = 0;
        for (let h = 1; h < 64 && h * f0 < 4200; h++) {
          const fh = h * f0; let g = 0.02;
          for (let j = 0; j < 3; j++) { const F = v0[j] + (v1[j] - v0[j]) * u, x = (fh - F) / (90 + 40 * j); g += (1 - 0.35 * j) / (1 + x * x); }
          amps[h] = g / Math.pow(h, 0.7); e2 += amps[h] * amps[h]; H = h;
        }
        nrm = 0.2 / Math.sqrt(e2);
      }
      ph += 2 * Math.PI * f0 / sr;
      let s = 0; for (let h = 1; h <= H; h++) s += amps[h] * Math.sin(h * ph);
      out[i0 + i] += nrm * Math.pow(Math.sin(Math.PI * u), 0.6) * s;
    }
    t += d + 0.01 + R() * 0.05;
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.002 * (R() * 2 - 1);
  return out;
}
function synthNoise(sr, total, kind, level, seed) {
  const R = rng(seed || 4), out = new Float32Array(Math.ceil(total * sr));
  if (kind === 'white') for (let i = 0; i < out.length; i++) out[i] = level * (R() * 2 - 1);
  else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < out.length; i++) { const w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      out[i] = level * (b0 + b1 + b2 + w * 0.1848) * 0.25; }
  } else if (kind === 'claps') {
    for (let t = 0.3; t < total - 0.2; t += 0.35 + R() * 0.3) {
      const i0 = Math.floor(t * sr), n = Math.floor(0.06 * sr);
      for (let i = 0; i < n; i++) out[i0 + i] += level * Math.exp(-i / (0.012 * sr)) * (R() * 2 - 1);
    }
    for (let i = 0; i < out.length; i++) out[i] += 0.001 * (R() * 2 - 1);
  } else if (kind === 'hum') {
    for (let i = 0; i < out.length; i++) { const t = i / sr; let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * 60 * h * t + h) / h;
      out[i] = level * s + 0.001 * (R() * 2 - 1); }
  } else for (let i = 0; i < out.length; i++) out[i] = 0.0004 * (R() * 2 - 1);
  return out;
}
/* A sound played across a room from the phone. The direct sound falls off with distance (dist metres, 1 m as recorded); the
   echo (rt60: seconds to die away, the highs sooner) fills the room evenly, as strong as the direct sound at 0.9 m.
   gainDb sets how loud the playing is, and the room has a quiet hum of its own (noiseDb, dBFS: ventilation, traffic). */
function inRoom(sr, x, o) {
  const R = rng(o.seed || 61), rt = o.rt60 || 0.5, n = Math.floor(rt * 1.2 * sr), h = new Float64Array(n), g0 = Math.pow(10, (o.gainDb || 0) / 20);
  let lp = 0, e = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, w = R() * 2 - 1; lp += 0.2 * (w - lp);
    h[i] = Math.min(1, t / 0.005) * (2 * lp * Math.exp(-6.9 * t / (rt * 1.15)) + w * Math.exp(-6.9 * t / (rt * 0.6))); e += h[i] * h[i]; }
  const B = 16384; let M = 1; while (M < B + n) M <<= 1;
  const Hr = new Float64Array(M), Hi = new Float64Array(M), re = new Float64Array(M), im = new Float64Array(M), out = new Float32Array(x.length);
  for (let i = 0; i < n; i++) Hr[i] = h[i] * g0 / (0.9 * Math.sqrt(e)); fft(Hr, Hi);
  for (let p = 0; p < x.length; p += B) {                                  // the echo, by FFT, a block at a time
    re.fill(0); im.fill(0); for (let i = 0; i < B && p + i < x.length; i++) re[i] = x[p + i];
    fft(re, im);
    for (let k = 0; k < M; k++) { const a = re[k] * Hr[k] - im[k] * Hi[k], b = re[k] * Hi[k] + im[k] * Hr[k]; re[k] = a; im[k] = -b; }
    fft(re, im);                                                             // the inverse, by way of the conjugate
    for (let i = 0; i < M && p + i < out.length; i++) out[p + i] += re[i] / M;
  }
  const d = g0 / (o.dist || 1), nz = Math.pow(10, (o.noiseDb == null ? -80 : o.noiseDb) / 20) * 2.4;
  let b0 = 0, b1 = 0, b2 = 0, rum = 0;
  for (let i = 0; i < x.length; i++) { const w = R() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; rum += 0.015 * ((R() * 2 - 1) - rum);
    out[i] += x[i] * d + nz * (0.1 * (b0 + b1 + b2 + w * 0.1848) + 2 * rum); }
  return out;
}
function mix(a, b, gainB) { const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] || 0) + gainB * (b[i] || 0); return out; }
function concat(list) { let n = 0; for (const a of list) n += a.length; const out = new Float32Array(n);
  let p = 0; for (const a of list) { out.set(a, p); p += a.length; } return out; }

const mel = (ms, d, gap) => ms.map(m => [m, d, gap || 0]);
/* a major scale up two octaves from key number m and back down */
const scale2 = m => { const up = []; for (let o = 0; o < 2; o++) for (const k of [0, 2, 4, 5, 7, 9, 11]) up.push(m + 12 * o + k); up.push(m + 24); return up.concat(up.slice(0, -1).reverse()); };
const CLIPS = {
  violin:   sr => synthSustained(sr, 'violin', mel([69, 71, 73, 76, 74, 73, 71, 69, 76, 78, 76, 74], 0.5), 0.2, 11),
  violinFast: sr => synthSustained(sr, 'violin', mel([69, 71, 73, 74, 76, 78, 80, 81, 80, 78, 76, 74, 73, 71, 69, 71, 73, 74, 76, 78, 80, 81, 80, 78, 76, 74, 73, 71, 69, 71, 73, 74, 76, 78, 80, 81], 0.14), 0.2, 12),
  violinQuiet: sr => mix(synthSustained(sr, 'violin', mel([67, 69, 71, 72, 74, 72, 71, 69, 67, 71], 0.6), 0.03, 13), synthNoise(sr, 6, 'pink', 0.02, 14), 1),
  cello:    sr => synthSustained(sr, 'cello', mel([36, 43, 48, 50, 52, 50, 48, 43], 0.75), 0.2, 15),
  clarinet: sr => synthSustained(sr, 'clarinet', mel([62, 64, 65, 67, 69, 67, 65, 64, 62, 60], 0.6), 0.2, 16),
  flute:    sr => synthSustained(sr, 'flute', mel([72, 74, 76, 77, 79, 77, 76, 74, 72, 79], 0.6), 0.2, 17),
  staccato: sr => synthSustained(sr, 'violin', mel([69, 73, 76, 73, 69, 73, 76, 81, 76, 73, 69, 73, 76, 73, 69, 73, 76, 81, 76, 73], 0.16, 0.14), 0.2, 18),
  piano:    sr => { const ev = [], s = [60, 64, 67, 72, 71, 67, 64, 62, 60, 65, 69, 72, 67, 64, 60, 55];
    s.forEach((m, i) => ev.push([0.1 + i * 0.36, m, 0.5])); [0, 1.44, 2.88, 4.32].forEach((t, i) => { ev.push([0.1 + t, 48 - (i % 2) * 5, 1.3]); ev.push([0.1 + t, 55 - (i % 2) * 5, 1.3]); });
    return synthPiano(sr, ev, 6.2, 0.18, 19); },
  talk:     sr => synthSpeech(sr, 6, 120, 21),
  talkHigh: sr => synthSpeech(sr, 6, 230, 22),
  talkFlat: sr => synthSpeech(sr, 6, 150, 23, 2.5),
  white:    sr => synthNoise(sr, 5, 'white', 0.12, 24),
  pink:     sr => synthNoise(sr, 5, 'pink', 0.3, 25),
  claps:    sr => synthNoise(sr, 5, 'claps', 0.5, 26),
  quiet:    sr => synthNoise(sr, 4, 'quiet', 0, 27),
  hum:      sr => synthNoise(sr, 24, 'hum', 0.02, 28),
  // played in a room (see PLAYED), across each instrument's registers
  violinBowed:  sr => synthPlayed(sr, 'violin', mel([67, 69, 71, 74, 76, 74, 72, 71, 69, 67, 71, 74], 0.5), { seed: 41 }),
  violinHigh:   sr => synthPlayed(sr, 'violin', mel([76, 79, 81, 83, 84, 86, 88, 86, 84, 83, 81, 79], 0.45), { seed: 42 }),
  violinPlain:  sr => synthPlayed(sr, 'violin', mel([55, 57, 59, 60, 62, 64, 62, 60, 59, 57, 55, 62], 0.5), { seed: 43, vib: 0 }),
  celloTenor:   sr => synthPlayed(sr, 'cello', mel([50, 53, 57, 60, 62, 60, 57, 55, 53, 57, 60, 62], 0.55), { seed: 44 }),
  celloAString: sr => synthPlayed(sr, 'cello', mel([57, 59, 60, 62, 64, 65, 67, 65, 64, 62, 60, 59], 0.55), { seed: 45 }),
  clarinetHigh: sr => synthPlayed(sr, 'clarinet', mel([69, 71, 72, 74, 76, 77, 79, 77, 76, 74, 72, 71], 0.5), { seed: 46 }),
  fluteLow:     sr => synthPlayed(sr, 'flute', mel([60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 64], 0.5), { seed: 47 }),
  fluteHigh:    sr => synthPlayed(sr, 'flute', mel([81, 83, 84, 86, 88, 89, 91, 89, 88, 86, 84, 83], 0.45), { seed: 48 }),
  pianoTune:    sr => synthPiano(sr, [67, 64, 64, 65, 62, 62, 60, 62, 64, 65, 67, 67, 67, 64, 64, 65, 62, 62].map((m, i) => [0.1 + i * 0.32, m, 0.3]), 6.2, 0.18, 50),
  pianoScale:   sr => synthPiano(sr, [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52, 50, 48, 50, 52].map((m, i) => [0.1 + i * 0.25, m, 0.24]), 6.6, 0.18, 51),
  // played softly, with the phone across the room: about -70 dB at the phone, mostly echo, over the room's own hum
  roomViolin:   sr => inRoom(sr, synthPlayed(sr, 'violin', mel([67, 69, 71, 74, 76, 74, 72, 71, 69, 67, 71, 74], 0.5), { seed: 52 }), { gainDb: -58, dist: 3, seed: 62 }),
  roomFlute:    sr => inRoom(sr, synthPlayed(sr, 'flute', mel([72, 74, 76, 77, 79, 77, 76, 74, 72, 76, 79, 77], 0.5), { seed: 53, level: 0.1 }), { gainDb: -52, dist: 4, seed: 63 }),
  roomCello:    sr => inRoom(sr, synthPlayed(sr, 'cello', mel([43, 45, 47, 48, 50, 52, 50, 48, 47, 45, 43, 50], 0.55), { seed: 54 }), { gainDb: -56, dist: 3, rt60: 0.7, seed: 64 }),
  roomPiano:    sr => inRoom(sr, synthPiano(sr, [60, 64, 67, 72, 71, 67, 64, 62, 60, 65, 69, 72, 67, 64, 60, 62].map((m, i) => [0.1 + i * 0.36, m, 0.34]), 6.2, 0.18, 55), { gainDb: -54, dist: 4, seed: 65 }),
  // scales up and down two octaves, legato, at a brisk practice tempo, in a room
  scaleViolin:  sr => inRoom(sr, synthPlayed(sr, 'violin', mel(scale2(55), 1 / 12), { seed: 59 }), { gainDb: -24, dist: 3, rt60: 0.6, seed: 69 }),
  scaleCello:   sr => inRoom(sr, synthPlayed(sr, 'cello', mel(scale2(36), 1 / 8), { seed: 60 }), { gainDb: -24, dist: 3, rt60: 0.6, seed: 70 }),
  scaleFlute:   sr => inRoom(sr, synthPlayed(sr, 'flute', mel(scale2(62), 1 / 12), { seed: 61 }), { gainDb: -24, dist: 3, rt60: 0.6, seed: 71 }),
  scalePiano:   sr => inRoom(sr, synthPiano(sr, scale2(48).map((m, i) => [0.1 + i / 10, m, 1 / 10]), 0.1 + 29 / 10 + 0.4, 0.18, 62), { gainDb: -24, dist: 3, rt60: 0.6, seed: 72 }),
  // talking near the phone in a room whose echo joins up the syllables, and talking quietly across the room
  roomTalk:     sr => inRoom(sr, synthSpeech(sr, 6, 120, 56), { gainDb: -12, dist: 1, seed: 66 }),
  roomTalkHigh: sr => inRoom(sr, synthSpeech(sr, 6, 230, 57), { gainDb: -12, dist: 1, seed: 67 }),
  roomTalkFar:  sr => inRoom(sr, synthSpeech(sr, 6, 150, 58), { gainDb: -30, dist: 3, seed: 68 }),
  // a scale with a breath at the top of each run; talking that turns into playing; soft playing under a fan as loud as itself; one note again and again
  breathFlute:  sr => { const s = scale2(62), up = mel(s.slice(0, 14), 1 / 12), top = [[s[14], 0.4, 1.0]], down = mel(s.slice(15), 1 / 12);
    return inRoom(sr, synthPlayed(sr, 'flute', up.concat(top, down, up, top, down), { seed: 61 }), { gainDb: -24, dist: 3, rt60: 0.6, seed: 71 }); },
  talkThenCello: sr => inRoom(sr, concat([synthSpeech(sr, 5, 120, 56), synthPlayed(sr, 'cello', mel([50, 53, 57, 60, 62, 60, 57, 55], 0.55), { seed: 44 })]), { gainDb: -12, dist: 1, seed: 66 }),
  roomViolinFan: sr => inRoom(sr, synthPlayed(sr, 'violin', mel([67, 69, 71, 74, 76, 74, 72, 71, 69, 67, 71, 74], 0.5), { seed: 52 }), { gainDb: -58, dist: 3, seed: 62, noiseDb: -65 }),
  longTones:    sr => inRoom(sr, synthPlayed(sr, 'clarinet', mel([62, 62, 62, 62], 1.2, 0.3), { seed: 46 }), { gainDb: -20, dist: 2, seed: 66 })
};

/* Run a clip through the detector exactly as the live app does and return a timeline. */
function analyzeClip(samples, sr, sensitivity) {
  const det = new MusicDetector(sr, { sensitivity: sensitivity || 'normal' }), N = det.N, hop = N >> 1, dt = hop / sr;
  const tl = [];
  for (let pos = 0; pos + N <= samples.length; pos += hop) {
    const r = det.process(samples.subarray(pos, pos + N), dt);
    tl.push({ t: (pos + N) / sr, music: r.isMusic, inst: r.instrument, kind: r.kind });
  }
  return tl;
}
function fraction(tl, t0, t1) { let n = 0, m = 0; for (const f of tl) if (f.t >= t0 && f.t <= t1) { n++; if (f.music) m++; } return n ? m / n : 0; }
/* the instrument named most often while music was heard from t0 on, and for what share of that time */
function heardAs(tl, t0) { const c = {}; let best = '', bn = 0, n = 0;
  for (const f of tl) if (f.t >= t0 && f.music) { n++; if (f.inst) { c[f.inst] = (c[f.inst] || 0) + 1; if (c[f.inst] > bn) { bn = c[f.inst]; best = f.inst; } } }
  return { inst: best, share: n ? bn / n : 0 }; }

const DETECTION_CASES = [
  { name: 'Violin melody with vibrato', clip: 'violin', music: true, inst: 'Violin' },
  { name: 'Fast violin scales', clip: 'violinFast', music: true, inst: 'Violin' },
  { name: 'Quiet violin over room noise', clip: 'violinQuiet', music: true, inst: 'Violin' },
  { name: 'Detached (staccato) notes', clip: 'staccato', music: true, min: 0.8, inst: 'Violin' },
  { name: 'Cello, low notes', clip: 'cello', music: true, inst: 'Cello' },
  { name: 'Clarinet melody', clip: 'clarinet', music: true, inst: 'Clarinet' },
  { name: 'Flute melody', clip: 'flute', music: true, inst: 'Flute' },
  { name: 'Piano melody with chords', clip: 'piano', music: true, inst: 'Piano' },
  // the instruments as they sound in a room, in their other registers too (see PLAYED)
  { name: 'Violin, natural bowing (the level wavers)', clip: 'violinBowed', music: true, inst: 'Violin' },
  { name: 'Violin, high on the E string', clip: 'violinHigh', music: true, inst: 'Violin' },
  { name: 'Violin, beginner without vibrato', clip: 'violinPlain', music: true, inst: 'Violin' },
  { name: 'Cello, tenor range (D3 to D4)', clip: 'celloTenor', music: true, inst: 'Cello' },
  { name: 'Cello, up on the A string (A3 to G4)', clip: 'celloAString', music: true, inst: 'Cello' },
  { name: 'Clarinet, upper register (A4 to G5)', clip: 'clarinetHigh', music: true, inst: 'Clarinet' },
  { name: 'Flute, low register with breath noise', clip: 'fluteLow', music: true, inst: 'Flute' },
  { name: 'Flute, high register', clip: 'fluteHigh', music: true, inst: 'Flute' },
  { name: 'Piano tune, one note at a time', clip: 'pianoTune', music: true, inst: 'Piano' },
  { name: 'Piano scale, no chords', clip: 'pianoScale', music: true, inst: 'Piano' },
  // soft playing with the phone across a room: the echo is louder than the playing itself
  { name: 'Soft violin, phone across the room', clip: 'roomViolin', music: true, inst: 'Violin' },
  { name: 'Soft flute, phone across the room', clip: 'roomFlute', music: true, inst: 'Flute' },
  { name: 'Soft cello in an echoing room', clip: 'roomCello', music: true, inst: 'Cello' },
  { name: 'Quiet piano, phone across the room', clip: 'roomPiano', music: true, inst: 'Piano' },
  // fast legato scales, with the phone across the room: the steps between notes must not be taken for a voice's glides
  { name: 'Violin scale, 12 notes a second', clip: 'scaleViolin', music: true },
  { name: 'Cello scale from low C, 8 notes a second', clip: 'scaleCello', music: true },
  { name: 'Flute scale, 12 notes a second', clip: 'scaleFlute', music: true },
  { name: 'Piano scale, 10 notes a second', clip: 'scalePiano', music: true },
  { name: 'Talking, low voice', clip: 'talk', music: false },
  { name: 'Talking, high voice', clip: 'talkHigh', music: false },
  { name: 'Talking, flat monotone', clip: 'talkFlat', music: false },
  { name: 'Loud hiss (white noise)', clip: 'white', music: false },
  { name: 'Fan-like rumble (pink noise)', clip: 'pink', music: false },
  { name: 'Clapping', clip: 'claps', music: false },
  { name: 'Quiet room', clip: 'quiet', music: false },
  { name: 'Constant mains hum (after it settles)', clip: 'hum', music: false, from: 18 },
  { name: 'Talking in a room with an echo', clip: 'roomTalk', music: false },
  { name: 'Talking in a high voice, room with an echo', clip: 'roomTalkHigh', music: false },
  { name: 'Talking quietly across the room', clip: 'roomTalkFar', music: false },
  // a breath in a fast scale does not stop the clock; playing is told from the talking before it; a fan as loud as soft playing; long tones hold
  { name: 'Flute scale, 12 notes a second, with a breath at the top', clip: 'breathFlute', music: true, min: 0.97 },
  { name: 'Talking, before the playing starts', clip: 'talkThenCello', music: false, to: 5 },
  { name: 'Cello, starting after the talking', clip: 'talkThenCello', music: true, from: 6, inst: 'Cello' },
  { name: 'Soft violin across the room, over a fan as loud as itself', clip: 'roomViolinFan', music: true, inst: 'Violin' },
  { name: 'Long tones: one clarinet note again and again', clip: 'longTones', music: true, inst: 'Clarinet' }
];
/* One function per test, so a page can run them one at a time without freezing. */
function detectionTests(sr) {
  sr = sr || 44100;
  const list = DETECTION_CASES.map(c => ({ name: c.name, run: () => {
    const x = CLIPS[c.clip](sr), tl = analyzeClip(x, sr), end = x.length / sr;
    const fr = fraction(tl, c.from != null ? c.from : (c.music ? 1.2 : 0), c.to != null ? c.to : end);   // from and to: the part of the clip that is judged (s)
    let pass = c.music ? fr >= (c.min || 0.9) : fr <= 0.05, got = Math.round(fr * 100) + '% counted as music';
    if (c.inst) {                                                            // named right for most of the time, not just more often than the rest
      const h = heardAs(tl, 1.2); got += ', heard as ' + (h.inst ? h.inst + ' ' + Math.round(h.share * 100) + '% of the time' : 'nothing');
      if (h.inst !== c.inst || h.share < 0.7) pass = false;
    }
    return { name: c.name, expect: c.music ? 'music' + (c.inst ? ', heard as ' + c.inst + ' at least 70% of the time' : '') : 'not music', got: got, pass: pass };
  } }));
  // start/stop response: music, silence, music
  list.push({ name: 'Starts and stops with the music', run: () => {
    const v = CLIPS.violin(sr).subarray(0, 3 * sr), x = concat([v, synthNoise(sr, 3, 'quiet', 0, 31), v]), tl = analyzeClip(x, sr);
    let on1 = -1, off = -1, on2 = -1;
    for (const f of tl) { if (on1 < 0 && f.music) on1 = f.t; if (on1 >= 0 && off < 0 && f.t > 3 && !f.music) off = f.t - 3; if (off >= 0 && on2 < 0 && f.t > 6 && f.music) on2 = f.t - 6; }
    const ok = on1 > 0 && on1 < 1.3 && off > 0 && off < 1.6 && on2 > 0 && on2 < 1.3;
    return { name: 'Starts and stops with the music', expect: 'on within 1.3 s, off within 1.6 s',
      got: 'on ' + on1.toFixed(2) + ' s, off ' + off.toFixed(2) + ' s, on again ' + on2.toFixed(2) + ' s', pass: ok }; } });
  // timer rules
  list.push({ name: 'Timer: pause is excluded, sound ignored while paused', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 100; i++) s.tick(0.1, i < 60); s.pause(); for (let i = 0; i < 50; i++) s.tick(0.1, true);
    s.resume(); for (let i = 0; i < 100; i++) s.tick(0.1, true); s.stop(); s.tick(1, true);
    const ok = Math.abs(s.total - 25) < 1e-6 && Math.abs(s.active - 20) < 1e-6 && Math.abs(s.play - 16) < 1e-6 && s.pauses === 1 && Math.abs(s.efficiency - 0.8) < 1e-6;
    return { name: 'Timer: pause is excluded, sound ignored while paused', expect: 'total 25 s, active 20 s, play 16 s, 80%',
      got: 'total ' + s.total.toFixed(0) + ' s, active ' + s.active.toFixed(0) + ' s, play ' + s.play.toFixed(0) + ' s, ' + Math.round(s.efficiency * 100) + '%', pass: ok }; } });
  list.push({ name: 'Timer: short pauses keep counting', run: () => {
    const s = new Session(), step = (sec, m) => { for (let i = 0; i < sec * 10; i++) s.tick(0.1, m); }, near = (a, b) => Math.abs(a - b) < 0.15;
    s.hold = 5; s.start();
    step(4, false); const before = s.play;                                    // quiet before the first note is not counted
    step(10, true); step(1, false); const left = s.holdLeft, still = s.playing; step(2, false);   // a 3 s page turn counts
    step(10, true); step(20, false); const long = s.play;                     // a long quiet counts its first 5 s, then the clock stops
    step(5, true); step(2, false); s.pause(); step(5, true); s.resume(); step(3, false); s.stop();   // a pause ends the hold
    const ok = before === 0 && near(left, 4) && still && near(long, 28) && near(s.play, 35) && near(s.active, 57) && !s.playing;
    return { name: 'Timer: short pauses keep counting', expect: 'with a 5 s hold: a 3 s gap counts, a 20 s quiet counts its first 5 s, nothing before the first note or after a pause; 35 s of play',
      got: 'before the first note ' + before.toFixed(1) + ' s, 1 s into a gap ' + left.toFixed(1) + ' s of hold left, after the long quiet ' + long.toFixed(1) + ' s, play ' + s.play.toFixed(1) + ' s of ' + s.active.toFixed(1) + ' s', pass: ok }; } });
  // the session summary
  list.push({ name: 'Summary: where the time went', run: () => {
    const s = new Session(), step = (sec, m) => { for (let i = 0; i < sec * 10; i++) s.tick(0.1, m); };
    s.start(); step(60, true); step(3, false); step(60, true); step(40, false); step(30, true); s.pause(); step(20, true); s.resume(); step(10, false); s.stop();
    const R = sessionReport(s.runs), near = (a, b) => Math.abs(a - b) < 0.05, c = R.columns;
    const ok = near(R.total, 223) && near(R.play, 150) && near(R.quiet, 53) && near(R.paused, 20) && R.pauses === 1 && R.breaks === 1 && near(R.breakTime, 40)
      && near(R.longest.a, 0) && near(R.longest.b, 123) && R.bin === 60 && c.length === 4 && near(c[0].play, 60) && near(c[1].play, 57) && near(c[3].t, 43) && near(c[3].paused, 20) && near(c[3].play, 13) && R.best === null;
    return { name: 'Summary: where the time went', expect: 'total 223 s: play 150, quiet 53, paused 20; 1 break; longest stretch 0 to 123 s across a 3 s gap; 4 minute columns',
      got: 'total ' + R.total.toFixed(1) + ', play ' + R.play.toFixed(1) + ', quiet ' + R.quiet.toFixed(1) + ', paused ' + R.paused.toFixed(1) + ', ' + R.breaks + ' break, longest ' + R.longest.a.toFixed(1) + ' to ' + R.longest.b.toFixed(1) + ' s, ' + c.length + ' columns', pass: ok }; } });
  list.push({ name: 'Summary: start, middle, end and the best 10 minutes', run: () => {
    const s = new Session(); s.start();
    for (let i = 0; i < 600; i++) s.tick(1, true);                       // the first 10 minutes all playing
    for (let i = 0; i < 600; i++) s.tick(1, Math.floor(i / 10) % 2 === 0);   // then 10 s on, 10 s off
    for (let i = 0; i < 600; i++) s.tick(1, Math.floor(i / 10) % 4 === 0);   // then 10 s on, 30 s off
    s.stop();
    const R = sessionReport(s.runs), th = R.thirds.map(x => Math.round(x * 100));
    const ok = th.join() === '100,50,25' && R.best && R.best.a === 0 && R.best.len === 600 && R.best.eff === 1 && R.longest.a === 0 && R.longest.b === 610 && R.breaks === 0 && R.columns.length === 30;
    return { name: 'Summary: start, middle, end and the best 10 minutes', expect: 'thirds 100%, 50%, 25%; best 10 minutes from 0:00 at 100%; longest stretch 0:00 to 10:10',
      got: 'thirds ' + th.join('%, ') + '%; best from ' + (R.best ? clockText(R.best.a) + ' at ' + Math.round(R.best.eff * 100) + '%' : 'none') + '; longest ' + clockText(R.longest.a) + ' to ' + clockText(R.longest.b), pass: ok }; } });
  // the Home Screen
  list.push({ name: 'Home Screen: the words for each moment', run: () => {
    const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(9, 18);                // Friday 9 October 2026, 6 pm
    const rec = (d, play) => ({ start: at(d, 16), play: play, goal: 1800, eff: 0.8, R: { active: play / 0.8 } });
    const week = [rec(6, 900), rec(8, 600)], all = [rec(1, 1500)].concat(week), stats = rs => practiceStats(rs, now);
    const first = homeCopy(stats([]), null, at(9, 9)), today = homeCopy(stats(all.concat([rec(9, 1200)])), rec(9, 1200), now);
    const yest = homeCopy(stats(all), rec(8, 600), now), tue = homeCopy(stats([rec(6, 900)]), rec(6, 900), now), back = homeCopy(stats([rec(1, 1500)]), rec(1, 1500), at(9, 14));
    const all5 = [first, today, yest, tue, back], words = all5.map(c => [c.hello, c.head, c.lede, c.note || '', c.fresh || ''].join(' '));
    const ok = first.kind === 'first' && first.hello === 'Good morning, music maker' && first.friend === 'music maker' && today.kind === 'today' && today.lede === 'You played for 20 min today. Come back whenever you feel like it.'
      && today.note === 'All together: 1 h 10 min of music.' && yest.kind === 'week' && yest.note === 'Your last session was yesterday, 10 min.'
      && tue.note === 'Your last session was on Tuesday, 15 min.' && back.kind === 'back' && back.hello === 'Good afternoon, music maker' && back.note === 'So far you have made 25 min of music with Music Timer.'
      && !words.some(w => /streak|in a row|ago|miss|lost|keep/i.test(w));
    return { name: 'Home Screen: the words for each moment', expect: 'first time, played today, played this week, back after a break; nothing about streaks or days missed',
      got: all5.map(c => c.kind + ': ' + c.head + ' ' + (c.note || c.lede)).join(' | '), pass: ok }; } });
  list.push({ name: 'Home Screen: playful words that change', run: () => {
    const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(9, 18);                // Friday 9 October 2026, 6 pm
    const rec = (d, play) => ({ start: at(d, 16), play: play, goal: 1800, eff: 0.8, R: { active: play / 0.8 } });
    const moments = [[[], null], [[rec(9, 1200)], rec(9, 1200)], [[rec(8, 600)], rec(8, 600)], [[rec(1, 1500)], rec(1, 1500)]];
    const seeds = []; for (let i = 1; i <= 60; i++) seeds.push(i * 7919);
    const seen = moments.map(() => new Set()), hellos = new Set(), friends = new Set(); let same = true, named = true, clean = true;
    for (const [rs, last] of moments) for (const seed of seeds) {
      const P = practiceStats(rs, now), c = homeCopy(P, last, now, { seed: seed, name: 'Sam' }), plain = homeCopy(P, last, now, { seed: seed }), k = moments.findIndex(m => m[1] === last);
      seen[k].add(c.head); hellos.add(c.hello); friends.add(plain.friend);
      same = same && JSON.stringify(c) === JSON.stringify(homeCopy(P, last, now, { seed: seed, name: 'Sam' })) && c.head === plain.head;
      named = named && /Sam/.test(c.hello) && c.friend === undefined && !/[{}]|Sam|,\s*$|\s$/.test(plain.hello) && !!plain.friend && plain.hello.endsWith(' ' + plain.friend);
      clean = clean && ![c.hello, c.head, c.lede, c.note || '', c.fresh || ''].join(' ').match(/streak|in a row|ago|miss|lost|keep|[{}]|undefined/i) && /[.!?]$/.test(c.head) && /[.!?]$/.test(c.lede);
    }
    const all = Object.values(HOME_WORDS).flatMap(w => Object.values(w).flat()).concat(HOME_HELLO, HOME_FRIEND);
    const ok = same && named && clean && seen.every(s => s.size >= 4) && hellos.size >= 10 && friends.size >= 8 && friends.has('Captain') && homeCopy(practiceStats([], now), null, now).hello === 'Good evening, music maker'
      && homeCopy(practiceStats([], now), null, now, { name: 'Sam' }).hello === 'Good evening, Sam' && all.every(w => w.length <= 64 && !/streak|in a row|ago|miss|lost|keep/i.test(w));
    return { name: 'Home Screen: playful words that change', expect: 'each moment has several headlines and greetings, the same seed gives the same words, a name fits in, and with none a fun word for the player does',
      got: seen.map(s => s.size).join(', ') + ' headlines, ' + hellos.size + ' greetings, ' + friends.size + ' words for a player with no name; e.g. ' + homeCopy(practiceStats([], now), null, now, { seed: 5, name: 'Sam' }).hello + ' / ' + homeCopy(practiceStats([], now), null, now, { seed: 6 }).hello, pass: ok }; } });
  // the practice log
  list.push({ name: 'Practice log: week, calendar and encouraging lines', run: () => {
    const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(9, 18);                // Friday 9 October 2026, 6 pm
    const rec = (d, play, goal) => ({ start: at(d, 16), play: play, goal: goal || 1800, eff: 0.8, R: { active: play / 0.8 } });
    const recs = [rec(9, 1200), rec(8, 1800), rec(8, 600), rec(7, 900), rec(6, 300), rec(3, 1800), rec(2, 1000), rec(1, 1000), rec(30 - 31, 500)];
    const P = practiceStats(recs, now), wk = P.week.map(c => c.level).join('');
    const P2 = practiceStats(recs.filter(r => r.start < at(9, 0)), now), P3 = practiceStats([rec(3, 1800)], now), P0 = practiceStats([], now);
    const lines = [practiceNudge(P), practiceNudge(P2), practiceNudge(P3), weekLine(P), weekLine({ weekPlay: 600, lastWeekPlay: 4300, lastWeekSoFar: 2500 })];
    const ok = P.streak === 4 && P.bestStreak === 4 && P.practicedToday && P2.streak === 3 && !P2.practicedToday && P3.streak === 0 && P3.daysSince === 6 && P0.streak === 0 && practiceNudge(P0) === ''
      && wk === '0123200' && P.week[4].today && P.week[5].future && P.weekPlay === 4800 && P.lastWeekPlay === 4300 && P.lastWeekSoFar === 2500
      && P.grid.length === 12 && P.grid[11][0].key === '2026-10-05' && P.grid[10][3].level === 2 && P.sessions === 9 && P.longest.play === 1800 && Math.abs(P.efficiency - 0.8) < 1e-9
      && lines[0] === 'Lovely playing today. Come back whenever you feel like it.' && lines[1] === 'You have played on 3 days this week. Nice work.'
      && lines[2] === 'Welcome back. Even a few minutes of playing is worth it.' && lines[3] === 'This week: 1 h 20 min of playing, 8 min more than all of last week.'
      && lines[4] === 'This week: 10 min of playing.' && !lines.some(l => /streak|in a row|ago|match/.test(l));
    return { name: 'Practice log: week, calendar and encouraging lines', expect: 'week levels 0123200, 1 h 20 min this week, no streak or days-missed wording',
      got: 'streak ' + P.streak + ' (' + P2.streak + '), best ' + P.bestStreak + ', week ' + wk + ', ' + durationText(P.weekPlay) + ' | ' + lines.join(' | '), pass: ok }; } });
  list.push({ name: 'Several sessions in a day: the day adds up', run: () => {
    const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime(), now = at(9, 20);                // Friday 9 October 2026, 8 pm
    const rec = (d, h, play) => ({ id: at(d, h), start: at(d, h), play: play, goal: 1800, eff: 0.8, R: { active: play / 0.8 } });
    const a = rec(9, 8, 600), b = rec(9, 13, 900), c = rec(9, 18, 420), y1 = rec(8, 9, 300), y2 = rec(8, 17, 1200), recs = [c, y2, a, b, y1];
    const P = practiceStats(recs, now), D = dayRecap(recs, c), D1 = dayRecap(recs, a), Y = dayRecap(recs, y1), one = dayRecap([y1], y1);
    const L = dayLine(D, now), L1 = dayLine(D1, now), LY = dayLine(Y, now), H = homeCopy(P, c, now), HW = homeCopy(practiceStats([y1, y2], now), y2, now);
    const words = [L.lead, L.text, L1.text, LY.lead, LY.text, H.lede, HW.note].join(' ');
    const ok = P.today.sessions === 3 && P.today.play === 1920 && P.today.plays.join() === '600,900,420' && P.week[3].plays.join() === '300,1200' && P.today.level === 3
      && D.n === 3 && D.count === 3 && D.before === 1500 && D.upTo === 1920 && D1.n === 1 && D1.upTo === 600 && dayRecap(recs, rec(9, 21, 60)) === null
      && one.count === 1 && dayLine(one, now) === null
      && L.lead === '32 min of music today.' && L.text === 'This was your third session today.' && L1.text === 'This was session 1 of 3 today.'
      && LY.lead === '25 min of music that day.' && LY.text === 'This was session 1 of 2 that day.'
      && H.lede === 'You played for 32 min today, in 3 sessions. Come back whenever you feel like it.' && HW.note === 'You last played yesterday, 25 min in 2 sessions.'
      && !/streak|in a row|ago|miss|lost|keep|goal/i.test(words) && !('goal' in D);
    return { name: 'Several sessions in a day: the day adds up', expect: 'three sessions today make 32 min; the Home Screen and summary count every session of the day, without measuring the day against the session goal',
      got: 'today ' + durationText(P.today.play) + ' in ' + P.today.sessions + ' (' + P.today.plays.join(', ') + ') | ' + (L ? L.lead + ' ' + L.text : 'no line') + ' | ' + (LY ? LY.text : '') + ' | ' + H.lede + ' | ' + HW.note, pass: ok }; } });
  list.push({ name: 'Practice log: saved record keeps the summary', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 400; i++) s.tick(0.5, i % 10 < 7); s.stop();
    const R = sessionReport(s.runs), rec = JSON.parse(JSON.stringify(sessionRecord(s, R, 'Ana'))), Q = rec.R, short = new Session(); short.start(); for (let i = 0; i < 30; i++) short.tick(0.25, true); short.stop();
    const ok = rec.id === s.startedAt && rec.end >= rec.start && Math.abs(rec.play - R.play) < 0.05 && Math.abs(Q.efficiency - R.efficiency) < 1e-3 && Q.columns.length === R.columns.length
      && Math.abs(Q.longest.b - R.longest.b) < 1e-3 && Q.thirds.length === 3 && rec.name === 'Ana' && JSON.stringify(rec).length < 4000 && worthKeeping(R) && !worthKeeping(sessionReport(short.runs));
    return { name: 'Practice log: saved record keeps the summary', expect: 'the stored report matches, under 4 KB; a session with 7.5 s of playing is not kept',
      got: JSON.stringify(rec).length + ' bytes, play ' + rec.play + ' s, efficiency ' + Q.efficiency + ', ' + Q.columns.length + ' columns', pass: ok }; } });
  list.push({ name: 'New versions: the live page is newer', run: () => {
    const page = b => '<!doctype html><meta charset="utf-8"><meta name="build" content="' + b + '"><title>Music Timer</title>';
    const UNBUILT = '__' + 'BUILD__';                                    // split, or the build would fill it in
    const cases = [[newerBuild('bee9237 2026-10-11', page('c0ffee1 2026-10-12')), true], [newerBuild('bee9237 2026-10-11', page('bee9237 2026-10-11')), false],
      [newerBuild('dev', page('c0ffee1 2026-10-12')), true], [newerBuild(UNBUILT, page('c0ffee1 2026-10-12')), false], [newerBuild('bee9237 2026-10-11', page(UNBUILT)), false],
      [newerBuild('bee9237 2026-10-11', '<html>offline</html>'), false], [newerBuild('bee9237 2026-10-11', ''), false], [newerBuild('', page('c0ffee1 2026-10-12')), false]];
    const ok = cases.every(c => c[0] === c[1]) && buildOf(page('c0ffee1 2026-10-12')) === 'c0ffee1 2026-10-12';
    return { name: 'New versions: the live page is newer', expect: 'a different build stamp on the live page is newer; the same stamp, a missing one or an unbuilt page is not',
      got: cases.map(c => c[0]).join(', '), pass: ok }; } });
  list.push({ name: 'A session cut short is kept', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 900; i++) s.tick(0.5, i % 10 < 7); s.pause(); s.tick(30, false); s.resume(); for (let i = 0; i < 200; i++) s.tick(0.5, true);
    const now = s.startedAt + 600e3, snap = JSON.parse(JSON.stringify(liveSnapshot(s, 'Sam', { rocket: { mode: 'orbit' } }, now))), rec = liveRecord(snap);
    s.stoppedAt = now; const want = sessionRecord(s, sessionReport(s.runs), 'Sam', { rocket: { mode: 'orbit' } });
    const bad = [null, {}, Object.assign({}, snap, { v: 2 }), Object.assign({}, snap, { runs: [0, 5, 1] }), Object.assign({}, snap, { runs: [7, 5] }), Object.assign({}, snap, { savedAt: snap.startedAt - 1 })];
    const ok = rec && rec.id === s.startedAt && rec.end === now && Math.abs(rec.play - want.play) < 0.5 && Math.abs(rec.eff - want.eff) < 0.002 && rec.R.pauses === 1
      && rec.name === 'Sam' && rec.themes.rocket.mode === 'orbit' && worthKeeping(rec.R) && bad.every(x => liveRecord(x) === null) && JSON.stringify(snap).length < 8000;
    return { name: 'A session cut short is kept', expect: 'the kept session turns back into the same record as ending it there; damaged ones are ignored',
      got: rec ? 'play ' + rec.play + ' (' + want.play + '), efficiency ' + rec.eff + ' (' + want.eff + '), ' + JSON.stringify(snap).length + ' bytes kept' : 'no record', pass: !!ok }; } });
  list.push({ name: 'Session: time away counts like a pause', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 600; i++) s.tick(0.1, true); s.away(600); for (let i = 0; i < 150; i++) s.tick(0.1, true);
    const R = sessionReport(s.runs), ok = Math.abs(s.efficiency - 1) < 1e-9 && Math.abs(s.recentEfficiency - 1) < 1e-9 && Math.abs(s.total - 675) < 1e-6 && Math.abs(s.active - 75) < 1e-6
      && R.paused === 600 && R.pauses === 1 && s.pauses === 1 && Math.abs(R.efficiency - 1) < 1e-9;
    return { name: 'Session: time away counts like a pause', expect: '10 min with the app away between playing leaves efficiency and the last minute at 100%, shown as one pause',
      got: 'efficiency ' + Math.round(s.efficiency * 100) + '%, last minute ' + Math.round(s.recentEfficiency * 100) + '%, paused ' + R.paused + ' s', pass: ok }; } });
  list.push({ name: 'Home Screen: a session past midnight counts as today', run: () => {
    const mon = new Date(2026, 9, 12, 0, 30).getTime(), sun = new Date(2026, 9, 11, 23, 40).getTime(), r = { start: sun, end: sun + 2700e3, play: 2400, goal: 1800, eff: 0.9, R: { active: 2600 } };
    const c = homeCopy(practiceStats([r], mon), r, mon), D = { key: '2026-10-12', n: 21, count: 21, play: 9000 };
    const ok = c.kind === 'today' && c.lede === 'You played for 40 min today. Come back whenever you feel like it.' && dayLine(D, mon).text === 'This was session 21 today.';
    return { name: 'Home Screen: a session past midnight counts as today', expect: 'Sunday 23:40 to Monday 00:25 reads as played today on Monday; the 21st session reads "session 21"',
      got: c.kind + ': ' + c.lede + ' | ' + dayLine(D, mon).text, pass: ok }; } });
  list.push({ name: 'Debug tools: sample practice logs', run: () => {
    const now = new Date(2026, 9, 9, 18).getTime(), want = { first: 'first', today: 'today', week: 'week', back: 'back', months: 'today' }, got = [];   // Friday 9 October 2026, 6 pm
    let ok = SAMPLE_LOGS.length === 5;
    for (const [k] of SAMPLE_LOGS) {
      const log = sampleLog(k, now), P = practiceStats(log, now), c = homeCopy(P, log.length ? log[log.length - 1] : null, now), ids = new Set(log.map(r => r.id));
      const fine = log.every((r, i) => r.v === 1 && r.R && r.R.columns && r.start > 0 && r.start <= now && r.end > r.start && r.play > 0 && (!i || log[i - 1].start <= r.start));
      if (c.kind !== want[k] || !fine || ids.size !== log.length || log.length > LOG_MAX || JSON.stringify(log) !== JSON.stringify(sampleLog(k, now))) ok = false;
      got.push(k + ' ' + log.length + ' sessions, ' + c.kind);
    }
    const T = practiceStats(sampleLog('today', now), now), months = sampleLog('months', now).length, back = practiceStats(sampleLog('back', now), now);
    ok = ok && T.today.sessions === 2 && T.today.level === 3 && months > 30 && back.daysSince >= 21 && sampleLog('today', now).every(r => JSON.stringify(r.themes) === '{}');
    return { name: 'Debug tools: sample practice logs', expect: 'each sample log is valid and the same every time, and opens the Home Screen it is for; today has two sessions; the themes add their own data (sampleLog hook)',
      got: got.join(', ') + '; today ' + durationText(T.today.play), pass: ok }; } });
  // note starts and the Dash course
  list.push({ name: 'Note starts: one per note, none for talking or silence', run: () => {
    const count = clip => { const x = CLIPS[clip](sr), det = new MusicDetector(sr, { sensitivity: 'normal' }), tr = new OnsetTracker(), N = det.N, hop = N >> 1, dt = hop / sr; let n = 0;
      for (let pos = 0; pos + N <= x.length; pos += hop) { const r = det.process(x.subarray(pos, pos + N), dt); if (tr.feed(dt, { music: r.isMusic, midi: r.pitch > 0 ? 69 + 12 * Math.log2(r.pitch / 440) : null, levelDb: r.levelDb })) n++; } return n; };
    const v = count('violin'), s = count('staccato'), t = count('talk'), q = count('quiet');
    return { name: 'Note starts: one per note, none for talking or silence', expect: 'violin 9 to 13 of its 12 notes (the first second is spent recognising it), talking 0, quiet 0',
      got: 'violin ' + v + ', detached notes ' + s + ', talking ' + t + ', quiet ' + q, pass: v >= 9 && v <= 13 && s >= 4 && t === 0 && q === 0 }; } });
  // finger and mouse swipes on a 390 px scene: a press at 200,300, moved in even steps to (dx, dy) over ms, then let go there (or taken away by the browser)
  const press = (dx, dy, ms, cancel) => { const s = new DragSwipe(), seen = []; s.down(1, 200, 300, 0, 390);
    for (let k = 1; k <= 20; k++) { const m = s.move(200 + dx * k / 20, 300 + dy * k / 20); if (m != null) seen.push(m); }
    const r = s.up(cancel ? null : 200 + dx, ms);
    return { step: r == null ? 'none' : ['back', 'stay', 'next'][r + 1], follows: !seen.length || Math.abs(seen[seen.length - 1] - dx) < 1e-9, left: !s.has(1) }; };
  const dragTest = (name, expect, cases) => list.push({ name: name, run: () => {
    const bad = cases.filter(c => { const r = press(...c[1]); return r.step !== c[2] || !r.follows || !r.left; });
    return { name: name, expect: expect, got: bad.length ? bad.map(c => { const r = press(...c[1]); return c[0] + ': ' + r.step + (r.follows ? '' : ', the themes did not follow') + (r.left ? '' : ', still held') + ' (want ' + c[2] + ')'; }).join('; ') : cases.length + ' of ' + cases.length + ' right', pass: !bad.length }; } });
  dragTest('Swipe: a drag a quarter of the way across, or a flick, moves one theme', 'the themes follow the finger; letting go past a quarter of the scene, or after a quick flick, steps one theme that way, else they go back', [
    ['slow drag left, half way', [-195, 4, 900], 'next'], ['slow drag right, half way', [195, -4, 900], 'back'], ['all the way across', [-390, 0, 600], 'next'],
    ['slow drag left, a fifth of the way', [-78, 0, 900], 'stay'], ['quick flick left', [-60, 3, 200], 'next'], ['quick flick right', [60, 0, 200], 'back'],
    ['taken away mid-swipe', [-195, 0, 300, true], 'stay']]);
  dragTest('Swipe: taps and scrolls are not swipes', 'a press that hardly moves stays a tap (Classic\'s picture changes on a tap), and one that goes up or down first is left to scroll', [
    ['tap', [3, 2, 120], 'none'], ['scroll down', [0, 200, 400], 'none'], ['scroll up, drifting sideways', [-40, -200, 400], 'none'],
    ['steep diagonal', [-100, 90, 400], 'none'], ['shallow diagonal', [-200, 60, 500], 'next']]);
  list.push({ name: 'Swipe: the themes give only a little past either end', run: () => {
    const s = new DragSwipe(); s.down(1, 200, 300, 0, 390); const o = (dx, at) => Math.round(s.offset(dx, at, 4));
    const got = [o(-100, 1), o(100, 0), o(-100, 3), o(0, 2)], want = [-490, 30, -1200, -780];
    return { name: 'Swipe: the themes give only a little past either end', expect: 'mid-way the track moves with the finger; past Classic or Dash it moves 0.3 px per px (' + want.join(', ') + ')',
      got: got.join(', '), pass: got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Swipe: a second finger during a swipe is ignored', run: () => {
    const s = new DragSwipe(); s.down(1, 300, 300, 0, 390); let dx = 0; for (let k = 1; k <= 10; k++) dx = s.move(300 - 12 * k, 300);   // the first finger drags 120 px: a swipe
    s.down(2, 100, 500, 200, 390);                                                                                                    // a second finger touches the scene
    const kept = s.has(1) && !s.has(2) && s.locked, m = s.move(150, 300), r = s.up(150, 400);                                         // the first finger goes on, then lets go
    const t = new DragSwipe(); t.down(1, 300, 300, 0, 390); t.down(2, 100, 500, 50, 390);                                              // before any swipe, the newer press takes over, as before
    const ok = dx === -120 && kept && m === -150 && r === 1 && !s.has(1) && !t.has(1) && t.has(2);
    return { name: 'Swipe: a second finger during a swipe is ignored', expect: 'the swipe keeps following the first finger and steps to the next theme when it lets go; a second press before any swipe takes over',
      got: (kept ? 'still the first finger' : 'the second finger took over') + ', then ' + (m == null ? 'no drag' : m + ' px') + ' and ' + (r == null ? 'no landing' : ['back', 'stay', 'next'][r + 1]) + (t.has(2) ? '; a second press before a swipe takes over' : '; a second press before a swipe is lost'), pass: ok }; } });
  // trackpad swipes: recorded wheel events replayed as the page receives them, one theme step per swipe however quickly they follow
  const steps = evs => { const w = new WheelSwipe(), got = [];
    for (const e of evs) { if (Math.abs(e.dx) <= Math.abs(e.dy)) continue;   // mostly vertical: the page lets Classic scroll
      const d = w.feed({ t: e.t, now: e.now != null ? e.now : e.t, drawn: e.drawn != null ? e.drawn : e.t - 8, dx: e.dx }); if (d) got.push(d > 0 ? 'next' : 'back'); }
    return got.join(' ') || 'none'; };
  const cut = (evs, ms) => evs.filter(e => e.t <= ms), flip = evs => evs.map(e => ({ t: e.t, dx: -e.dx, dy: e.dy }));
  const then = (a, gap, b) => a.concat(b.map(e => ({ t: a[a.length - 1].t + gap + e.t, dx: e.dx, dy: e.dy })));   // fingers back on the pad: the momentum stops and the next swipe starts
  const wheelTest = (name, expect, cases) => list.push({ name: name, run: () => {
    const bad = cases.filter(c => steps(c[1]) !== c[2]);
    return { name: name, expect: expect, got: bad.length ? bad.map(c => c[0] + ': ' + steps(c[1]) + ' (want ' + c[2] + ')').join('; ') : cases.length + ' of ' + cases.length + ' right', pass: !bad.length }; } });
  wheelTest('Trackpad: one theme per swipe', 'one step for each recorded swipe: Chrome and Safari on a Mac trackpad, fast, slow, a Windows touchpad, and a Magic Mouse swipe in Firefox that falters just after it steps', [
    ['Mac', wheelTrace('mac'), 'back'], ['Mac, fast flick', wheelTrace('macFast'), 'back'], ['Safari', wheelTrace('safari'), 'next'],
    ['Safari, slow drag', wheelTrace('safariSlow'), 'back'], ['Windows touchpad', wheelTrace('win'), 'back'], ['Firefox, Magic Mouse', wheelTrace('ffMagic'), 'next']]);
  wheelTest('Trackpad: quick swipes in a row each count', 'each swipe steps once, even when it starts while the last one\'s momentum is still arriving', [
    ['recorded double swipe', wheelTrace('macDouble'), 'back back'],
    ['two swipes', then(cut(wheelTrace('mac'), 400), 40, wheelTrace('mac')), 'back back'],
    ['three swipes', then(then(cut(wheelTrace('mac'), 400), 40, cut(wheelTrace('mac'), 400)), 40, wheelTrace('mac')), 'back back back'],
    ['two on a Windows touchpad', then(cut(wheelTrace('win'), 400), 40, wheelTrace('win')), 'back back'],
    ['there and back', then(cut(flip(wheelTrace('mac')), 400), 40, wheelTrace('mac')), 'next back'],
    ['there and back in Safari', then(cut(wheelTrace('safari'), 400), 40, flip(wheelTrace('safari'))), 'next back']]);
  // a page busy for a second (City's first frame) holds the events back: the first comes when it wakes, the rest merged into one a frame later
  const busy = (evs, a, b) => { const out = [], held = evs.filter(e => e.t > a && e.t <= b);
    if (held.length) { const m = held.slice(1); out.push({ t: held[0].t, dx: held[0].dx, dy: held[0].dy, now: b, drawn: a });
      if (m.length) out.push({ t: m[m.length - 1].t, dx: m.reduce((s, e) => s + e.dx, 0), dy: m.reduce((s, e) => s + e.dy, 0), now: b + 16, drawn: b }); }
    return evs.filter(e => e.t <= a).concat(out, evs.filter(e => e.t > b)); };
  const busyOne = (evs, a, b) => { const h = evs.filter(e => e.t > a && e.t <= b);   // or all of them merged into one when it wakes, long after it last drew
    return evs.filter(e => e.t <= a).concat(h.length ? [{ t: h[h.length - 1].t, dx: h.reduce((s, e) => s + e.dx, 0), dy: h.reduce((s, e) => s + e.dy, 0), now: b, drawn: a }] : [], evs.filter(e => e.t > b)); };
  wheelTest('Trackpad: a busy page does not turn one swipe into two', 'one step when the page stops drawing for a second during the swipe', [
    ['Mac', busy(wheelTrace('mac'), 100, 1100), 'back'], ['Mac, fast flick', busy(wheelTrace('macFast'), 700, 1700), 'back'], ['Windows touchpad', busy(wheelTrace('win'), 120, 1120), 'back'],
    ['Mac, held events merged into one', busyOne(wheelTrace('mac'), 100, 500), 'back'], ['Windows touchpad, held events merged into one', busyOne(wheelTrace('win'), 120, 1120), 'back']]);
  const notches = (n, gap) => Array.from({ length: n }, (_, i) => ({ t: i * gap, dx: 100, dy: 0 }));
  wheelTest('Mouse wheel: sideways clicks of 100 px each move one theme', 'a 100 px sideways wheel click (as Chrome and Edge send on Windows) every 260 or 400 ms steps each time; a quick spin steps once', [
    ['every 400 ms', notches(3, 400), 'next next next'], ['every 260 ms', notches(3, 260), 'next next next'], ['a quick spin', notches(3, 100), 'next']]);
  list.push({ name: 'Session: the last minute, a second at a time', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 30; i++) s.tick(1, true); for (let i = 0; i < 10; i++) s.tick(1, false);
    const m = s.minute, ok = m.length === 60 && m.slice(0, 20).every(v => v === null) && m.slice(20, 50).every(v => v === 1) && m.slice(50).every(v => v === 0);
    return { name: 'Session: the last minute, a second at a time', expect: '20 empty seconds, 30 played, 10 quiet', got: m.map(v => v == null ? '.' : v >= 0.5 ? '#' : '_').join(''), pass: ok }; } });
  list.push({ name: 'Summary: the columns add up for any length of session', run: () => {
    const runsFor = secs => { const s = new Session(); s.start(); for (let t = 0; t < secs; t += 7) s.tick(Math.min(7, secs - t), Math.floor(t / 100) % 3 !== 2); s.stop(); return s.runs; };
    const near = (a, b) => Math.abs(a - b) < 1e-6, rows = [60, 61, 3000, 10800, 144000].map(secs => { const R = sessionReport(runsFor(secs)), c = R.columns;
      const t = c.reduce((a, x) => a + x.t, 0), all = c.reduce((a, x) => a + x.play + x.quiet + x.paused, 0), play = c.reduce((a, x) => a + x.play, 0);
      return { secs: secs, bin: R.bin, n: c.length, ok: near(t, secs) && near(all, secs) && near(play, R.play) && near(R.total, secs) && c.length === Math.ceil(secs / R.bin) && c.every(x => x.t > 0 && x.t <= R.bin + 1e-9) && (c.length <= 45 || R.bin === 3600) }; });
    const ok = rows.every(r => r.ok) && rows.map(r => r.bin).join() === '60,60,120,300,3600' && rows.map(r => r.n).join() === '1,2,25,36,40';
    return { name: 'Summary: the columns add up for any length of session', expect: 'sessions of 1 min, 61 s, 50 min, 3 h and 40 h get columns of 60, 60, 120, 300 and 3600 s (1, 2, 25, 36 and 40 of them, the 61 s session ending in a column of 1 s) whose times add up to the whole session and whose playing adds up to the playing',
      got: rows.map(r => clockText(r.secs) + ': ' + r.n + ' columns of ' + r.bin + ' s' + (r.ok ? '' : ', which do not add up')).join('; '), pass: ok }; } });
  list.push({ name: 'Summary: the best window needs 10 minutes, and the thirds need running time', run: () => {
    const best = runs => { const b = sessionReport(runs).best; return b ? clockText(b.a) + '+' + b.len : 'none'; }, th = runs => sessionReport(runs).thirds.map(x => x == null ? '-' : Math.round(x * 100)).join('/');
    const E = sessionReport([]), Z = sessionReport([2, 100]), got = [best([0, 300, 1, 299]), best([0, 300, 1, 300]), best([1, 600, 0, 599]), best([1, 600, 0, 600]), th([0, 100, 2, 200]), th([1, 100, 0, 100]), th([2, 100]), th([])];
    const want = ['none', '0:00+300', '10:00+300', '10:00+600', '100/-/-', '0/50/100', '-/-/-', '-/-/-'];
    const ok = got.every((g, i) => g === want[i]) && E.total === 0 && E.columns.length === 0 && E.best === null && E.longest.a === 0 && E.longest.b === 0 && E.efficiency === 0
      && Z.total === 100 && Z.paused === 100 && Z.pauses === 1 && Z.active === 0 && Z.efficiency === 0 && Z.best === null && Z.columns.length === 2 && Z.columns[1].paused === 40 && Z.longest.b === 0;
    return { name: 'Summary: the best window needs 10 minutes, and the thirds need running time', expect: 'no best window under 10 minutes, the best 5 minutes from 10 minutes and the best 10 from 20, placed where the playing is; a third with no running time is blank; no runs at all, or one long pause, give an empty report',
      got: got.join(' | ') + ' | empty: ' + E.columns.length + ' columns | one pause: ' + Z.paused + ' s paused, ' + Z.columns.length + ' columns', pass: ok }; } });
  list.push({ name: 'Session: away while paused, calls out of turn, and the hold', run: () => {
    const s = new Session(); s.start(); s.tick(10, true); s.pause(); s.away(30); const a = [s.pauses, s.total, s.runs.join()];   // away while paused: the pause goes on
    s.resume(); s.away(0); s.away(-5); s.away(NaN); const b = [s.total, s.runs.join()]; s.away(5); const c = [s.pauses, s.runs.join(), s.playing];
    const i = new Session(), idle = [i.pause(), i.resume(), i.stop(), i.tick(1, true), i.total]; i.start(); const r = [i.resume(), i.pause(), i.pause(), i.pauses, i.resume(), i.stop(), i.stop(), i.tick(1, true), i.total, i.resume(), i.pause(), i.state];
    const m = new Session(); m.start(); for (let k = 0; k < 60; k++) m.tick(1, true); for (let k = 0; k < 59; k++) m.tick(1, false); const r119 = m.recentEfficiency; m.tick(1, false); const r120 = m.recentEfficiency, eff = m.efficiency;
    const h = new Session(); h.hold = 5; h.start(); const hl = [h.holdLeft]; h.tick(1, true); hl.push(h.holdLeft); h.tick(2, false); hl.push(h.holdLeft); h.tick(3, false); hl.push(h.holdLeft, h.playing); h.tick(1, false); hl.push(h.holdLeft, h.playing);
    h.tick(1, true); h.pause(); hl.push(h.holdLeft); h.resume(); h.tick(1, false); hl.push(h.holdLeft, h.playing); h.tick(1, true); h.tick(2, false); hl.push(h.holdLeft); h.stop(); hl.push(h.holdLeft);
    const ok = a.join() === '1,40,0,10,2,30' && b.join() === '40,0,10,2,30' && c.join() === '2,0,10,2,35,false' && idle.join() === 'false,false,false,false,0' && r.join() === 'false,true,false,1,true,true,false,false,0,false,false,stopped'
      && Math.abs(r119 - 1 / 60) < 1e-9 && r120 === 0 && Math.abs(eff - 0.5) < 1e-9 && hl.join() === '0,0,3,0,true,0,false,0,0,false,3,0';
    return { name: 'Session: away while paused, calls out of turn, and the hold', expect: 'away while paused lengthens the pause without counting another; away for 0 s, a negative time or NaN changes nothing; pause, resume, stop and tick out of turn return false and change nothing; after exactly 120 s the last minute has let the first go; the hold counts down from 5 s and is 0 while playing is heard, once it has run out, while paused, after a resume and after End even mid-way',
      got: 'away while paused: ' + a.join(' ') + ' | out of turn: ' + idle.join(' ') + ' / ' + r.join(' ') + ' | last minute at 119 s ' + Math.round(r119 * 1000) / 10 + '%, at 120 s ' + Math.round(r120 * 100) + '% | hold ' + hl.join(' '), pass: ok }; } });
  list.push({ name: 'Swipe: a press has to start, go sideways and lock before it counts', run: () => {
    const d = new DragSwipe(), go = (dx, ms, x) => { d.down(1, 200, 300, 0, 390); d.move(200 + dx, 300); return d.up(x === undefined ? 200 + dx : x, ms); };
    const got = [d.move(10, 10), d.up(10, 100), d.has(1)];                                  // nothing pressed
    d.down(1, 200, 300, 0, 390); got.push(d.has(2), d.move(210, 300), d.locked, d.move(211, 300), d.locked, d.move(211, 400), d.up(159, 349));   // 10 px is still a tap, 11 px locks, then it stays locked however far down
    d.down(1, 200, 300, 0, 390); got.push(d.move(200, 315), d.has(1), d.move(100, 315), d.up(100, 500));   // a scroll took it: later sideways moves are ignored
    got.push(go(-41, 349), go(-41, 350), go(-40, 100), go(97.5, 1000), go(98, 1000), go(-200, 400, null), d.has(1));   // the flick and quarter edges; taken away after the lock it goes back
    d.down(1, 200, 300, 0, 390); d.move(100, 300); d.down(2, 50, 50, 10, 390); got.push(d.has(1), d.locked, d.move(40, 50), d.up(40, 100));   // a second finger during the swipe is ignored: the first goes on and lands
    const want = [null, null, false, false, null, false, 11, true, 11, 1, null, false, null, null, 1, 0, 0, 0, -1, 0, false, true, true, -160, 1];
    return { name: 'Swipe: a press has to start, go sideways and lock before it counts', expect: 'moving or letting go with nothing pressed is nothing; 10 px sideways is still a tap and 11 px locks the swipe, which then follows the finger whatever it does up or down; after a scroll takes the press, sideways moves and letting go count for nothing; a 41 px flick under 350 ms steps, 40 px or 350 ms does not; a quarter of the way (97.5 px) stays, a px more steps; taken away after the lock it goes back; a second finger during the swipe is ignored, and the first one lands it',
      got: got.map(String).join(' '), pass: got.length === want.length && got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Trackpad: small nudges, a change of mind and a reset', run: () => {
    const w = new WheelSwipe(), f = (t, dx) => w.feed({ t: t, now: t, drawn: t - 8, dx: dx });
    const got = [f(0, 20), f(16, 20), f(32, 19), f(48, 1), f(64, 30), f(80, 10), f(2000, 70)];   // 59 px is not a swipe, 60 is; the momentum after it is not another; a fresh swipe after a pause is
    w.reset(); got.push(f(0, 30), f(16, -10), f(32, 40), f(48, 30), f(64, -70), f(80, 70));         // a few px back wipe the count (else 30 + 40 would step); after a step, the other way is a new swipe
    w.reset(); got.push(f(0, 200), f(16, 150), f(32, 100)); w.reset(); got.push(f(48, 100), f(64, 0), f(80, 0));   // a reset lets the next event count at once; events of 0 px do nothing
    const want = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, -1, 1, 1, 0, 0, 1, 0, 0];
    return { name: 'Trackpad: small nudges, a change of mind and a reset', expect: 'nudges add up to a step at 60 px and the momentum after it does not step again; a few px the other way start the count again, while the other way after a step is a new swipe; after a reset the next event counts afresh',
      got: got.join(' '), pass: got.length === want.length && got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Themes: the player turns off the ones they don\'t like', run: () => {
    const all = ['classic', 'rocket', 'city', 'dash', 'race', 'fireworks'];
    const got = [themesOn(all, '').join(' '), themesOn(all, 'city,dash').join(' '), themesOn(all, 'classic,rocket,city,dash,race,fireworks').join(' '), themesOn(all, 'space,dash').join(' '),
      themeSwitch(all, '', 'city', false), themeSwitch(all, 'city', 'classic', false), themeSwitch(all, 'classic,city', 'city', true), themeSwitch(all, 'rocket,city,dash', 'race', false),
      themeSwitch(all, 'space', 'rocket', false), themeLanding(['classic', 'dash'], 'rocket'), themeLanding(['classic', 'rocket', 'city'], 'dash'), themeLanding(['classic', 'city'], 'city'), themeLanding(['classic'], 'gone'), themeSwitch(all, 'rocket', 'fireworks', false), themeLanding(['classic', 'fireworks'], 'fireworks')];
    const want = ['classic rocket city dash race fireworks', 'classic rocket race fireworks', 'classic', 'classic rocket city race fireworks', 'city', 'city', '', 'rocket,city,dash,race', 'rocket', 'classic', 'classic', 'city', 'classic', 'rocket,fireworks', 'fireworks'];
    return { name: 'Themes: the player turns off the ones they don\'t like', expect: 'off themes leave the list, unknown ids are ignored, Classic is always on, and a theme turned off lands on the first one on, Classic (' + want.join(' | ') + ')',
      got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Practice log: the week turns on Monday, and at the turn of the year', run: () => {
    const at = (y, m, d, h) => new Date(y, m - 1, d, h || 12).getTime(), rec = (t, play) => ({ start: t, play: play, goal: 1800, eff: 0.8, R: { active: play / 0.8 } });
    const recs = [rec(at(2026, 10, 4), 900), rec(at(2026, 10, 5), 600), rec(at(2026, 10, 11), 300)];   // Sunday 4, Monday 5 and Sunday 11 October 2026
    const S = practiceStats(recs, at(2026, 10, 11, 18)), M = practiceStats(recs, at(2026, 10, 12, 9)), Y = practiceStats([rec(at(2026, 12, 27), 120), rec(at(2026, 12, 28), 60), rec(at(2026, 12, 31), 600)], at(2027, 1, 1));
    const keys = P => P.week[0].key + '..' + P.week[6].key, sum = P => ' (' + P.weekPlay + ', ' + P.lastWeekSoFar + ' of ' + P.lastWeekPlay + ')';
    const shape = P => P.grid.length === 12 && P.grid.every(c => c.length === 7) && P.grid[11][0].key === P.week[0].key && P.grid[11][6].key === P.week[6].key;
    const ok = keys(S) === '2026-10-05..2026-10-11' && S.week[6].today && !S.week.some(c => c.future) && S.weekPlay === 900 && S.lastWeekPlay === 900 && S.lastWeekSoFar === 900
      && keys(M) === '2026-10-12..2026-10-18' && M.week[0].today && M.week.filter(c => c.future).length === 6 && M.weekPlay === 0 && M.lastWeekPlay === 900 && M.lastWeekSoFar === 600 && M.daysSince === 1
      && keys(Y) === '2026-12-28..2027-01-03' && Y.weekPlay === 660 && Y.lastWeekPlay === 120 && Y.lastWeekSoFar === 0 && Y.grid[10][0].key === '2026-12-21'
      && [S, M, Y].every(shape) && M.grid[0][0].key === '2026-07-27' && practiceStats([], at(2027, 1, 1), 3).grid.length === 3;
    return { name: 'Practice log: the week turns on Monday, and at the turn of the year', expect: 'on Sunday 11 October the week is Monday 5 to Sunday 11 and last week so far is all of last week; on Monday 12 a new week starts with six days to come and only last Monday counted so far; New Year\'s Day sits in the week of 28 December; the calendar is 12 columns of 7 ending in this week',
      got: keys(S) + sum(S) + ' | ' + keys(M) + sum(M) + ' | ' + keys(Y) + sum(Y), pass: ok }; } });
  list.push({ name: 'Practice log: an empty log, records in any order and the shades of the calendar', run: () => {
    const at = (d, h) => new Date(2026, 9, d, h || 12).getTime(), mon = at(12, 9), rec = (t, play, o) => Object.assign({ start: t, play: play, goal: 1800, eff: 0.8, R: { active: play / 0.8 } }, o);
    const E = practiceStats([], mon), O = practiceStats([rec(at(12), 100), rec(at(1), 700), rec(at(7), 500)], mon), N = practiceStats([rec(at(12, 8), 600, { eff: 0.5, R: null }), rec(at(12, 9), 300, { eff: 0, R: null })], mon);
    const level = plays => practiceStats(plays.map((p, i) => rec(at(12, 8 + i), p)), mon).today.level, levels = [[0], [1], [899], [900], [1799], [1800], [450, 450]].map(level).join('');
    const L = practiceStats([rec(at(11, 23), 2400, { end: at(12, 0) + 25 * 6e4 })], mon);   // Sunday 23:00 to Monday 00:25 is filed under Sunday
    const ok = E.sessions === 0 && E.totalPlay === 0 && E.efficiency === 0 && E.longest === null && E.daysSince === null && E.daysPlayed === 0 && E.weekPlay === 0 && E.today.level === 0 && E.grid.length === 12
      && O.longest.play === 700 && O.daysSince === 0 && O.daysPlayed === 3 && O.sessions === 3 && O.totalPlay === 1300
      && Math.abs(N.efficiency - 0.6) < 1e-9 && levels === '0112232' && LEVEL_MIN.join() === '15,30'
      && !L.practicedToday && L.today.play === 0 && L.weekPlay === 0 && L.lastWeekPlay === 2400 && L.daysSince === 1;
    return { name: 'Practice log: an empty log, records in any order and the shades of the calendar', expect: 'an empty log has no longest session and no days since; the longest and the days since come out the same in any order; a record with no report falls back to its efficiency (60%); the shades turn at exactly 15 and 30 minutes, two sessions adding up (0112232); a session over midnight is filed under the day it started',
      got: 'empty: ' + E.sessions + ' sessions, longest ' + E.longest + ', days since ' + E.daysSince + ' | any order: longest ' + (O.longest && O.longest.play) + ' s, ' + O.daysSince + ' days since | no report: ' + Math.round(N.efficiency * 100) + '% | shades ' + levels + ' | over midnight: ' + L.lastWeekPlay + ' s last week', pass: ok }; } });
  list.push({ name: 'A session cut short: every damaged snapshot is ignored', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 100; i++) s.tick(1, true); s.pause(); s.tick(5, false); s.resume(); s.tick(10, false);
    const snap = JSON.parse(JSON.stringify(liveSnapshot(s, 'Ana', { rocket: { mode: 'orbit', fp: 2000 } }, s.startedAt + 200e3))), vary = (k, v) => { const c = JSON.parse(JSON.stringify(snap)); if (v === undefined) delete c[k]; else c[k] = v; return c; };
    const bad = { 'no version': vary('v'), 'no start': vary('startedAt'), 'start 0': vary('startedAt', 0), 'no savedAt': vary('savedAt'), 'no goal': vary('goal'), 'goal 0': vary('goal', 0), 'no runs': vary('runs'), 'runs as text': vary('runs', '0,5'),
      'kind 3': vary('runs', [3, 5]), 'kind as text': vary('runs', ['0', 5]), 'negative seconds': vary('runs', [0, -1]), 'NaN seconds': vary('runs', [0, NaN]), 'text': 'x', 'a number': 5, 'a list': [] };
    const wrong = Object.keys(bad).filter(k => liveRecord(bad[k]) !== null), r = liveRecord(snap), r2 = liveRecord(vary('themes', { rocket: 'orbit', 'Not-an-id': {}, dash: [1] })), old = vary('themes'), r3 = liveRecord(vary('name', 5)), r4 = liveRecord(vary('runs', [])), r5 = liveRecord(vary('savedAt', snap.startedAt));
    const ok = !wrong.length && r && r.play === 100 && r.end - r.start === 200e3 && r.themes.rocket.mode === 'orbit' && r.name === 'Ana' && r.R.pauses === 1 && r2 && JSON.stringify(r2.themes) === '{}' && r3 && r3.name === '' && r4 && r4.play === 0 && r4.R.columns.length === 0 && r5 && r5.end === r5.start
      && (old.rocket = { mode: 'ascent' }) && liveRecord(old).themes.rocket.mode === 'ascent' && !('rocket' in liveRecord(old));
    return { name: 'A session cut short: every damaged snapshot is ignored', expect: Object.keys(bad).length + ' kinds of damage are ignored; a good one keeps its 100 s, its pause, its name and what its themes kept; kept data that is not an object, or under an id no theme could have, or a name that is not text is dropped; no runs at all is a session with nothing in it; a snapshot from before themes kept their own data still keeps its rocket',
      got: (wrong.length ? 'not ignored: ' + wrong.join(', ') : 'all ignored') + (r ? '; play ' + r.play + ' s, ' + r.R.pauses + ' pause, ' + r.name + ', rocket ' + (r.themes.rocket && r.themes.rocket.mode) : '; no record'), pass: !!ok }; } });
  list.push({ name: 'Themes: Classic can\'t be turned off, and the saved text stays tidy', run: () => {
    const all = ['classic', 'rocket', 'city', 'dash', 'race', 'fireworks'], off = themeSwitch(all, '', 'city', false), on = themeSwitch(all, off, 'city', true);
    const got = [themeSwitch(all, '', 'classic', false), themeSwitch(all, 'rocket', 'classic', false), themesOn(all, 'classic').length, themesOn(all, null).length, themesOn(all, undefined).length, themesOn(all, 'bogus,classic,rocket').join(' '),
      themeSwitch(all, 'rocket,bogus', 'city', false), themeSwitch(all, 'rocket,rocket', 'city', false), themeSwitch(all, 'rocket', 'rocket', false), on, themeLanding(themesOn(all, off), 'city'), themeLanding(themesOn(all, on), 'city')];
    const want = ['', 'rocket', 6, 6, 6, 'classic city dash race fireworks', 'rocket,city', 'rocket,city', 'rocket', '', 'classic', 'city'];
    return { name: 'Themes: Classic can\'t be turned off, and the saved text stays tidy', expect: 'turning Classic off changes nothing; nothing saved means all on; unknown and repeated ids go as soon as the text is written again; off then on gives back an empty text; the Home Screen lands on Classic while City is off and back on City once it is on',
      got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Clock and duration text at the edges, and the eleventh session of a day', run: () => {
    const clock = [0, 59.9, 3599, 3600, 5400, 86400, -5].map(clockText).join(' '), dur = [0, 29.5, 59.4, 59.5, 89, 90, 3569, 3570, 3600, 5400, 86400, -3].map(durationText).join(' | ');
    const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(12, 20), rec = t => ({ id: t, start: t, play: 60, goal: 1800, eff: 0.8, R: { active: 75 } }), recs = []; for (let i = 0; i < 11; i++) recs.push(rec(at(12, 7 + i)));
    const line = n => dayLine({ key: '2026-10-12', n: n, count: n, play: 600 }, now).text, D = dayRecap(recs.slice().reverse(), recs[10]), D1 = dayRecap(recs, recs[0]);
    const ok = clock === '0:00 0:59 59:59 1:00:00 1:30:00 24:00:00 0:00' && dur === '0 s | 30 s | 59 s | 1 min | 1 min | 2 min | 59 min | 1 h | 1 h | 1 h 30 min | 24 h | 0 s'
      && line(10) === 'This was your tenth session today.' && line(11) === 'This was session 11 today.' && dayLine({ key: '2026-10-12', n: 10, count: 11, play: 60 }, now).text === 'This was session 10 of 11 today.'
      && dayLine({ key: '2026-10-11', n: 11, count: 11, play: 60 }, now).lead === '1 min of music that day.' && dayLine({ key: '2026-10-12', n: 1, count: 1, play: 60 }, now) === null && dayLine(null, now) === null
      && D.n === 11 && D.count === 11 && D.before === 600 && D.upTo === 660 && D.play === 660 && D1.n === 1 && D1.before === 0 && D1.upTo === 60 && dayRecap(recs, rec(at(12, 19))) === null && dayRecap(recs, null) === null && dayRecap([], recs[0]) === null;
    return { name: 'Clock and duration text at the edges, and the eleventh session of a day', expect: 'the clock shows whole seconds (59.9 s is 0:59) and hours from 1:00:00; durations round to the minute from 59.5 s and to the hour from 59.5 min; the tenth session is "your tenth", the eleventh "session 11"; a day with one session, or a session not in the log, has no line',
      got: clock + ' | ' + dur + ' | ' + line(10) + ' ' + line(11) + ' | eleventh: ' + D.n + ' of ' + D.count + ', ' + D.before + ' s before it', pass: ok }; } });
  list.push({ name: 'New versions: placeholders, dev builds and whitespace', run: () => {
    const page = b => '<meta name="build" content="' + b + '">', P = '__' + 'BUILD__';
    const got = [buildOf(page(' 12 ')), buildOf(page('dev')), buildOf(page('')), buildOf(null), buildOf('<meta name="build">'), buildOf(page('x__y')),
      newerBuild('dev', page('dev')), newerBuild('12', page('dev')), newerBuild('dev', page('13')), newerBuild('12', page(' 12 ')), newerBuild(null, page('13')), newerBuild('12', null), newerBuild('12', page(P) + page('13'))];
    const want = ['12', 'dev', '', '', '', '', false, true, true, false, false, false, false];
    return { name: 'New versions: placeholders, dev builds and whitespace', expect: 'the stamp is trimmed; a page with no meta, no content or a placeholder has no stamp; dev against dev, or the same stamp with spaces round it, is not newer, while a dev page against a numbered build is; the first meta tag is the one that counts',
      got: got.join(', '), pass: got.every((g, i) => g === want[i]) }; } });
  // theme modules: the interface every theme keeps to (docs/theme-modules.md)
  const okTheme = () => ({ api: THEME_API, id: 'sample', name: 'Sample', line: 'A sample theme.', goalHint: 'The total play time to reach.', langs: ['en', 'fr'], words: { fr: { 'Sample': 'Échantillon', 'A sample theme.': 'Un thème pour essayer.', '{n} star': '{n} étoile' } },
    panel: 'pSample', chrome: 'pixel', fonts: ['Barlow+Condensed:wght@700'], tests: [{ name: 'Sample: a test', run: () => ({ pass: true }) }], create: () => ({}) });
  const vary = (k, v) => { const d = okTheme(); if (v === undefined) delete d[k]; else d[k] = v; return d; };
  list.push({ name: 'Theme modules: a definition that keeps to the interface is installed once', run: () => {
    const saved = THEMES.splice(0), base = Object.assign(okTheme(), { id: 'base', langs: LANGS.map(l => l[0]), words: undefined }), out = [];
    try {
      out.push(checkTheme(okTheme()).length, addTheme(Object.assign(okTheme(), { id: 'first' })).join(), addTheme(base).length, addTheme(okTheme()).length, addTheme(okTheme()).join(), themes().map(t => t.id).join(' '),
        checkTheme(Object.assign(okTheme(), { goalHint: undefined, words: undefined, fonts: undefined, tests: undefined, langs: ['en'] })).length, removeTheme('sample'), removeTheme('sample'), themes().map(t => t.id).join(' '));
    } finally { THEMES.splice(0, THEMES.length, ...saved); }
    const want = [0, 'the base theme (the first installed) must be written for every language', 0, 0, 'the id sample is taken by another installed theme', 'base sample', 0, true, false, 'base'];
    return { name: 'Theme modules: a definition that keeps to the interface is installed once', expect: 'a sound definition has no problems and installs; a second with the same id does not; the first installed (the base) must have every language; the optional keys can go; a theme can be taken out again',
      got: out.join(' | '), pass: out.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Theme modules: each way a definition can break is named', run: () => {
    const cases = [[null, 'exports its definition'], [vary('api'), 'no api'], [vary('api', 2), 'api must be the interface version'], [vary('id', 'Rocket'), 'id must be'], [vary('id', 'x'), 'id must be'], [vary('id', 'my-theme'), 'id must be'],
      [vary('name'), 'no name'], [vary('name', ' Sample'), 'name must be'], [vary('line', ''), 'line must be'], [vary('goalHint', 5), 'goalHint must be'], [vary('langs', ['fr']), 'langs must be'], [vary('langs', ['en', 'de']), 'langs must be'],
      [vary('langs', ['en', 'en']), 'langs must be'], [vary('langs', 'en'), 'langs must be'], [vary('words', { fr: {}, zh: {} }), 'words for zh, which is not in langs'], [vary('words', { en: { a: 'b' }, fr: {} }), 'English is the key'],
      [Object.assign(vary('langs', ['en', 'fr', 'zh'])), 'no words for zh'], [vary('words', { fr: { '{n} star': 'étoile' } }), 'same {blanks}'], [vary('words', { fr: { 'Sample': '' } }), 'same {blanks}'],
      [Object.assign(vary('langs', ['en', 'fr', 'zh']), { words: { fr: { a: 'b' }, zh: { c: 'd' } } }), 'not the same words as fr'], [vary('words', [1]), 'words must be'], [vary('panel', '#pSample'), 'panel must be'], [vary('panel'), 'no panel'],
      [vary('chrome', 'fancy'), 'chrome must be'], [vary('fonts', ['Barlow Condensed']), 'fonts must be'], [vary('fonts', 'Inter'), 'fonts must be'], [vary('tests', [{ name: 'x' }]), 'tests must be'], [vary('tests', {}), 'tests must be'],
      [vary('create'), 'no create'], [vary('create', {}), 'create must be'], [vary('crate', () => ({})), 'unknown key crate']];
    const bad = cases.filter(c => !checkTheme(c[0]).some(p => p.indexOf(c[1]) >= 0)).map(c => c[1] + ' (got ' + (checkTheme(c[0]).join('; ') || 'nothing') + ')');
    return { name: 'Theme modules: each way a definition can break is named', expect: cases.length + ' broken definitions, each with its problem in words', got: bad.length ? 'not named: ' + bad.slice(0, 3).join(' / ') : cases.length + ' of ' + cases.length + ' named', pass: !bad.length }; } });
  list.push({ name: 'Theme modules: what create returns has only hooks', run: () => {
    const all = {}; for (const h of THEME_HOOKS) all[h] = () => {};
    const got = [checkInstance({}).length, checkInstance(all).length, checkInstance({ draw: () => {} }).join(), checkInstance({ paint: 1 }).join(), checkInstance(null).length, THEME_HOOKS.length];
    const want = [0, 0, 'unknown hook draw', 'hook paint must be a function', 1, 21];
    return { name: 'Theme modules: what create returns has only hooks', expect: 'no hooks, or every hook, is fine; an unknown name or a hook that is not a function is named (' + want.join(' | ') + ')', got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Theme modules: a theme\'s own words first, then the page\'s, then English', run: () => {
    const { tr: say, trn: sayN } = translator({ fr: { 'Hello!': 'Bonjour !', 'Settings': 'Réglages du thème', '{n} star': '{n} étoile', '{n} stars': '{n} étoiles' } }), had = WORDS.fr;
    WORDS.fr = Object.assign({}, had, { 'Done': 'OK' });   // a page word, whatever lang.js says
    try {
      const fr = inLang('fr', () => [say('Hello!'), say('Settings'), say('Done'), say('Not translated'), sayN(0, '{n} star', '{n} stars'), sayN(2, '{n} star', '{n} stars'), say('End|part')]).join(' | ');
      const en = inLang('en', () => [say('Hello!'), sayN(2, '{n} star', '{n} stars')]).join(' | ');
      const want = 'Bonjour ! | Réglages du thème | OK | Not translated | 0 étoile | 2 étoiles | ' + inLang('fr', () => tr('End|part'));
      return { name: 'Theme modules: a theme\'s own words first, then the page\'s, then English', expect: 'its own French (with French spacing), its own over the page\'s, the page\'s, English for the rest; French counts 0 as one; in English the English',
        got: fr + ' || ' + en, pass: fr === want && en === 'Hello! | 2 stars' && word('{n} s') === '{n} s' }; }
    finally { WORDS.fr = had; } } });
  list.push({ name: 'Theme modules: a theme shows only in the languages it is written for', run: () => {
    const all = LANGS.map(l => l[0]), L = [{ id: 'classic', langs: all }, { id: 'english', langs: ['en'] }, { id: 'french', langs: ['en', 'fr'] }, { id: 'every', langs: all }];
    const got = [themesOpen(L, '', 'en'), themesOpen(L, '', 'fr'), themesOpen(L, '', 'zh'), themesOpen(L, 'every', 'fr'), themesOpen(L, 'classic,english,french,every', 'en'), themesOpen([{ id: 'base', langs: ['en'] }, L[3]], '', 'zh')].map(a => a.join(' '));
    const want = ['classic english french every', 'classic french every', 'classic every', 'classic french', 'classic', 'base every'];
    return { name: 'Theme modules: a theme shows only in the languages it is written for', expect: 'English-only themes go in French and Chinese; one turned off goes in any language; the base theme always stays (' + want.join(' | ') + ')',
      got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  list.push({ name: 'Theme modules: what a theme keeps with a session', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 40; i++) s.tick(0.5, true); s.stop();
    const R = sessionReport(s.runs), r = sessionRecord(s, R, '', { rocket: { mode: 'orbit' }, Bad: { a: 1 }, dash: 'text', race: null }), none = sessionRecord(s, R, '');
    const old = upgradeRecord({ v: 1, start: 1, rocket: { mode: 'ascent' } }), oldPad = upgradeRecord({ v: 1, start: 1, rocket: null }), both = upgradeRecord({ themes: { rocket: { mode: 'orbit' } }, rocket: { mode: 'ascent' } });
    const got = [Object.keys(r.themes).join(), JSON.stringify(none.themes), old.themes.rocket.mode, 'rocket' in old, JSON.stringify(oldPad.themes), both.themes.rocket.mode];
    const want = ['rocket', '{}', 'ascent', false, '{}', 'orbit'];
    return { name: 'Theme modules: what a theme keeps with a session', expect: 'a record keeps each theme\'s object under its id and drops the rest; a record saved before themes kept their own has its rocket moved under themes (' + want.join(' | ') + ')',
      got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  // languages
  list.push({ name: 'Languages: every word in Chinese and French', run: () => {
    const ids = LANGS.map(l => l[0]).filter(id => id !== 'en'), keys = id => Object.keys(WORDS[id] || {}).sort(), marks = t => (String(t).match(/\{\w+\}/g) || []).sort().join();
    const picked = [pickLang('', ['fr-CA', 'en']), pickLang('', ['zh-TW']), pickLang('', ['de-DE', 'zh-Hans-CN']), pickLang('', ['de']), pickLang('en', ['fr']), pickLang('xx', ['fr'])].join();
    const rules = inLang('en', () => [tr('{n} s', { n: 5 }), tr('End|part'), trn(0, 'on {n} day', 'on {n} days'), trn(1, 'on {n} day', 'on {n} days')]).join() + ';' + inLang('fr', () => trn(0, 'on {n} day', 'on {n} days') === tr('on {n} day', { n: 0 }));
    const bad = [], now = new Date(2026, 9, 9, 18).getTime(), P1 = practiceStats([{ start: now - 3600e3, play: 900, goal: 1800, eff: 0.8, R: { active: 1100 } }], now);
    for (const id of ids) {
      if (!WORDS[id]) { bad.push(id + ' has no words'); continue; }
      if (keys(id).join('\n') !== keys(ids[0]).join('\n')) bad.push(id + ' has other words than ' + ids[0]);
      for (const [k, v] of Object.entries(WORDS[id])) if (typeof v !== 'string' || !v || marks(k) !== marks(v)) bad.push(id + ': ' + k);
      const H = HOME_LANG[id], shape = W => Object.keys(W.words).map(k => k + ':' + Object.keys(W.words[k]).join('+')).join();
      if (!H || shape(H) !== shape(HOME_EN) || H.times.length !== 5 || !/\{day\}/.test(H.times[4]) || !H.friend.length || !H.hello.concat(H.times).every(h => /[,，]\s*(\S+ ?)?\{name\}$/.test(h))) { bad.push(id + ' Home Screen words'); continue; }
      inLang(id, () => { for (let seed = 1; seed < 40; seed++) for (const [P, last] of [[practiceStats([], now), null], [P1, { start: now - 3600e3, play: 900 }]]) {
        const c = homeCopy(P, last, now, { seed: seed }), named = homeCopy(P, last, now, { seed: seed, name: 'Sam' }), all = [c.hello, c.head, c.lede, c.note || '', named.hello].join(' ');
        if (/[{}]|undefined/.test(all) || !c.hello.endsWith(c.friend) || !/Sam$/.test(named.hello)) bad.push(id + ': ' + all); } });
    }
    const said = inLang('fr', () => durationText(4500) + ' / ' + weekLine({ weekPlay: 600, lastWeekPlay: 0 })) + ' / ' + inLang('zh', () => durationText(4500) + ' / ' + dayLine({ key: dayKey(now), n: 2, count: 2, play: 1500 }, now).text);
    return { name: 'Languages: every word in Chinese and French', expect: 'the device\'s language is picked when none is chosen; each language has a translation of every word with the same {blanks}, and Home Screen words of the same shape',
      got: picked + ' | ' + rules + ' | ' + ids.map(id => id + ' ' + keys(id).length + ' words').join(', ') + ' | ' + said + (bad.length ? ' | missing or wrong: ' + bad.slice(0, 4).join(' / ') : ''),
      pass: picked === 'fr,zh,zh,en,en,fr' && rules === '5 s,End,on 0 days,on 1 day;true' && !bad.length && ids.every(id => keys(id).length > 250) }; } });
  return list.map(t => Object.assign({}, t, { run: () => inLang('en', t.run) }));   // written for the English words, whatever language the page shows
}
function runDetectionTests(sr) { return detectionTests(sr).map(t => t.run()); }

/* ---------- New versions: a page kept open (an iPhone Home Screen app) checks the live page's build stamp ---------- */
/* the build stamp in a page's <meta name="build"> ('' when there is none, or it is still the unbuilt placeholder) */
function buildOf(html) { const m = /<meta name="build" content="([^"]*)"/.exec(html || ''); return m && m[1].indexOf('__') < 0 ? m[1].trim() : ''; }
/* is the live page (its html) a different build from the one running? Never for an unbuilt page */
function newerBuild(running, html) { const b = buildOf(html); return !!running && running.indexOf('__') < 0 && !!b && b !== running; }

/* ---------- theme choice: the player can turn off themes they don't like (Settings, Themes) ---------- */
/* all: every theme id, in swipe order, Classic first; off: the ids turned off, saved as text ('city,dash'). Ids no longer in all are left out,
   so a removed theme is forgotten and a new one starts on. The first theme (Classic) is always on and can't be turned off, so there is always somewhere to land. */
function themesOff(all, off) { const ids = String(off || '').split(','); return all.slice(1).filter(id => ids.indexOf(id) >= 0); }
function themesOn(all, off) { const o = themesOff(all, off); return all.filter(id => o.indexOf(id) < 0); }
/* turns one theme on or off; the new off text */
function themeSwitch(all, off, id, want) { const o = themesOff(all, off).filter(x => x !== id); if (!want) o.push(id); return themesOff(all, o.join(',')).join(','); }
/* the theme to show: cur while it is on, else the first one on (Classic), on the Home Screen and when the one on screen is turned off */
function themeLanding(on, cur) { return on.indexOf(cur) >= 0 ? cur : on[0]; }

/* ---------- Theme modules: each theme is a module in src/themes/<id>/ (docs/theme-modules.md) ----------
   A theme module exports a definition (checkTheme says what it must hold); the page installs the ones listed in src/themes/themes.json,
   in that order, with addTheme. The first one installed is the base theme (Classic): always on, written for every language, and where the
   page lands when the theme on screen goes. The page then calls create(host) once and drives what it returns through its hooks (THEME_HOOKS). */
const THEME_API = 1;                                         // the version of the interface below; a module says which one it is written for
const THEME_ID = /^[a-z][a-z0-9]{1,15}$/;
/* what a definition holds: each key, whether it must be there, and what it must be */
const isText = v => typeof v === 'string' && v.trim() === v && v.length > 0;
const THEME_KEYS = {
  api: [true, v => v === THEME_API, 'the interface version, ' + THEME_API],
  id: [true, v => typeof v === 'string' && THEME_ID.test(v), 'a short id of lower-case letters and digits, starting with a letter (2 to 16 long)'],
  name: [true, isText, 'its name in English'],
  line: [true, isText, 'one line in English for Settings, Themes'],
  goalHint: [false, isText, 'the practice goal\'s hint in English, for Settings opened from this theme'],
  langs: [true, v => Array.isArray(v) && v.indexOf('en') >= 0 && v.every(l => LANGS.some(x => x[0] === l)) && new Set(v).size === v.length, 'the languages it is written for: known ids, English among them, each once'],
  words: [false, v => !!v && typeof v === 'object' && !Array.isArray(v), 'its own words by language: { zh: { English: Chinese } }'],
  panel: [true, v => typeof v === 'string' && /^[A-Za-z][\w-]*$/.test(v), 'the id of its panel (the section in panel.html)'],
  chrome: [true, v => v === 'clean' || v === 'pixel', '\'clean\' (the Classic title row) or \'pixel\' (the compact title row over a scene)'],
  fonts: [false, v => Array.isArray(v) && v.every(f => typeof f === 'string' && /^[A-Za-z][A-Za-z+]*(:[A-Za-z0-9@;,.]+)?$/.test(f)), 'Google Fonts families it needs, as the css2 URL writes them'],
  tests: [false, v => Array.isArray(v) && v.every(t => t && isText(t.name) && typeof t.run === 'function'), 'its tests: a list of { name, run }, run returning { name, expect, got, pass }'],
  create: [true, v => typeof v === 'function', 'create(host): the instance whose hooks the page calls'],
};
/* the hooks an instance may have; all are optional (the docs say when each is called and with what) */
const THEME_HOOKS = ['show', 'hide', 'reset', 'restore', 'tick', 'frame', 'paint', 'notes', 'stopped', 'goalChanged', 'awardLine', 'holdAward', 'resize', 'langChanged',
  'share', 'follow', 'keep', 'sampleLog', 'homeLink', 'debugLine', 'debugTools'];
const blanks = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
/* what is wrong with a theme definition, in words; [] when it keeps to the interface */
function checkTheme(d) {
  if (!d || typeof d !== 'object') return ['a theme module exports its definition, an object'];
  const bad = [];
  for (const k in THEME_KEYS) { const [need, ok, what] = THEME_KEYS[k];
    if (d[k] === undefined) { if (need) bad.push('no ' + k + ' (' + what + ')'); }
    else if (!ok(d[k])) bad.push(k + ' must be ' + what); }
  for (const k in d) if (!THEME_KEYS[k]) bad.push('unknown key ' + k + ' (a typo, or an interface newer than ' + THEME_API + ')');
  if (Array.isArray(d.langs) && THEME_KEYS.words[1](d.words === undefined ? {} : d.words)) {
    const W = d.words || {}, own = d.langs.filter(l => l !== 'en'), first = own.find(l => W[l]);
    for (const l in W) if (own.indexOf(l) < 0) bad.push('words for ' + l + ', which is not in langs' + (l === 'en' ? ' (English is the key: it needs no words)' : ''));
    for (const l of own) {
      if (!W[l] || typeof W[l] !== 'object') { if (first) bad.push('no words for ' + l + ', which is in langs'); continue; }
      for (const [k, v] of Object.entries(W[l])) if (!isText(v) || blanks(k) !== blanks(v)) bad.push(l + ' words: "' + k + '" needs a translation with the same {blanks}');
      if (Object.keys(W[l]).sort().join('\n') !== Object.keys(W[first]).sort().join('\n')) bad.push(l + ' words: not the same words as ' + first);
    }
  }
  return bad;
}
/* what is wrong with what create(host) returned */
function checkInstance(x) {
  if (!x || typeof x !== 'object') return ['create(host) must return an object of hooks'];
  const bad = [];
  for (const k in x) if (THEME_HOOKS.indexOf(k) < 0) bad.push('unknown hook ' + k); else if (typeof x[k] !== 'function') bad.push('hook ' + k + ' must be a function');
  return bad;
}
/* a language's typography, applied to a theme's words as lang.js applies it to the page's: French keeps a space before ! ? : ; that does not break */
const TYPO = { fr: s => s.replace(/ ([!?:;])/g, '\u00A0$1') };
/* tr and trn for a theme: its own words first (words: { zh: {...}, fr: {...} }), then the page's, then the English */
function translator(words) {
  const own = {};
  for (const l in words || {}) { own[l] = {}; for (const k in words[l]) own[l][k] = TYPO[l] ? TYPO[l](words[l][k]) : words[l][k]; }
  const t = (s, vars) => { const w = own[lang] && own[lang][s] != null ? own[lang][s] : WORDS[lang][s]; return fill(w != null ? w : s.replace(/\|.*$/, ''), vars); };
  const tn = (n, one, other, vars) => t(lang === 'fr' ? (n < 2 ? one : other) : n === 1 ? one : other, Object.assign({ n: n }, vars));
  return { tr: t, trn: tn };
}
/* marks a word in a table, written now and translated where it is shown (npm test finds the words through it) */
const word = s => s;
/* words the page translates for every theme: the read-outs most themes share, which a theme can show without words of its own (src/lang.js) */
const COMMON_WORDS = [word('Play time'), word('Efficiency'), word('Goal'), word('Power'), word('Pauses'), word('Reached')];
/* the installed themes, in order; addTheme returns what is wrong with a definition, and installs it only when nothing is */
const THEMES = [];
function addTheme(d) {
  const bad = checkTheme(d);
  if (!bad.length && THEMES.some(t => t.id === d.id)) bad.push('the id ' + d.id + ' is taken by another installed theme');
  if (!bad.length && !THEMES.length && LANGS.some(l => d.langs.indexOf(l[0]) < 0)) bad.push('the base theme (the first installed) must be written for every language');
  if (!bad.length) THEMES.push(d);
  return bad;
}
function themes() { return THEMES.slice(); }
function removeTheme(id) { const i = THEMES.findIndex(t => t.id === id); if (i >= 0) THEMES.splice(i, 1); return i >= 0; }   // for tests that install their own
/* The themes to swipe through, in order: turned on (themesOn) and written for the page's language. The base theme always, so there is somewhere to land.
   A theme not written for the language waits in Settings, Themes until the language changes back; its on or off is kept */
function themesOpen(list, off, id) {
  const on = themesOn(list.map(t => t.id), off);
  return list.filter((t, i) => i === 0 || (on.indexOf(t.id) >= 0 && t.langs.indexOf(id) >= 0)).map(t => t.id);
}
/* the same random numbers for the same seed, however they are used (a following device races the same field) */
function seededRng(seed) { let s = (seed >>> 0) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/* ---------- Session clock ---------- */
class Session {
  /* hold: seconds of quiet after playing that still count as playing (a long soft note, a page turn, a cough), so a short
     pause never stops the clock; a longer quiet stops it once the hold runs out, and the seconds already counted stay */
  constructor() { this.goal = 1800; this.hold = 0; this.reset(); }
  reset() { this.state = 'idle'; this.total = 0; this.active = 0; this.play = 0; this.pauses = 0;
    this.buckets = []; this.ba = 0; this.bp = 0; this.startedAt = 0; this.stoppedAt = 0; this.quietFor = Infinity; this.playing = false;
    this.runs = []; }   // the whole session as [kind, seconds, kind, seconds, ...]; kind 0 playing, 1 quiet while running, 2 paused
  start() { this.reset(); this.state = 'running'; this.startedAt = Date.now(); }
  pause() { if (this.state !== 'running') return false; this.state = 'paused'; this.pauses++; this.quietFor = Infinity; this.playing = false; return true; }
  resume() { if (this.state !== 'paused') return false; this.state = 'running'; return true; }
  stop() { if (this.state !== 'running' && this.state !== 'paused') return false; this.state = 'stopped'; this.playing = false; this.stoppedAt = Date.now(); return true; }
  /* how much of a hold is left, in seconds (0 when playing is heard or the clock has stopped) */
  get holdLeft() { return this.playing && this.quietFor > 0 ? Math.max(0, this.hold - this.quietFor) : 0; }
  /* dt seconds have passed; heard = instrument heard during that time. Returns whether the time counted as playing */
  tick(dt, heard) {
    if (this.state !== 'running' && this.state !== 'paused') return false;
    let music = false;
    if (this.state === 'running') { this.quietFor = heard ? 0 : this.quietFor + dt; music = heard || this.quietFor <= this.hold; }
    this.playing = music;
    this.total += dt;
    const k = this.state !== 'running' ? 2 : music ? 0 : 1, r = this.runs, n = r.length;
    if (dt > 0) { if (n && r[n - 2] === k) r[n - 1] += dt; else r.push(k, dt); }
    if (this.state !== 'running') return false;
    this.active += dt; const p = music ? dt : 0; this.play += p;
    this.ba += dt; this.bp += p;
    if (this.ba >= 1) { this.buckets.push(this.ba, this.bp); if (this.buckets.length > 120) this.buckets.splice(0, 2); this.ba = 0; this.bp = 0; }
    return music;
  }
  /* dt seconds when the app could not listen (the phone asleep, the app in the background): they count like a pause, so they do not
     lower the efficiency or hold the last minute's power down afterwards */
  away(dt) {
    if ((this.state !== 'running' && this.state !== 'paused') || !(dt > 0)) return;
    this.total += dt; this.quietFor = Infinity; this.playing = false; if (this.state === 'running') this.pauses++;
    const r = this.runs, n = r.length; if (n && r[n - 2] === 2) r[n - 1] += dt; else r.push(2, dt);
  }
  get efficiency() { return this.active > 0 ? Math.min(1, this.play / this.active) : 0; }
  get recentEfficiency() { let a = this.ba, p = this.bp; for (let i = 0; i < this.buckets.length; i += 2) { a += this.buckets[i]; p += this.buckets[i + 1]; } return a > 0 ? Math.min(1, p / a) : 0; }
  /* the last minute, oldest first: 60 values, each the share of that second spent playing, null before the session had run that long */
  get minute() { const out = new Array(60).fill(null), n = this.buckets.length / 2; for (let i = 0; i < n; i++) out[60 - n + i] = this.buckets[i * 2] > 0 ? this.buckets[i * 2 + 1] / this.buckets[i * 2] : 0; return out; }
}

/* ---------- Session report: where the time went, for the summary ---------- */
const GAP_OK = 5, BREAK = 30;   // a quiet gap this short (a page turn) does not end a stretch of playing; a longer one than BREAK counts as a break
function sessionReport(runs) {
  const R = { total: 0, play: 0, quiet: 0, paused: 0, pauses: 0, breaks: 0, breakTime: 0, gaps: 0, gapTime: 0, longest: { a: 0, b: 0 } };
  let t = 0, cur = null;
  const close = () => { if (cur && cur.b - cur.a > R.longest.b - R.longest.a) R.longest = cur; cur = null; };
  for (let i = 0; i < runs.length; i += 2) {
    const k = runs[i], d = runs[i + 1];
    if (k === 0) { R.play += d; if (cur) cur.b = t + d; else cur = { a: t, b: t + d }; }
    else if (k === 1) { R.quiet += d; if (d > BREAK) { R.breaks++; R.breakTime += d; } else { R.gaps++; R.gapTime += d; } if (d > GAP_OK) close(); }
    else { R.paused += d; R.pauses++; close(); }
    t += d;
  }
  close(); R.total = t; R.active = R.play + R.quiet; R.efficiency = R.active > 0 ? Math.min(1, R.play / R.active) : 0;
  // playing and running time up to each whole second, for the windows below
  const n = Math.floor(t), P = new Float64Array(n + 1), A = new Float64Array(n + 1);
  let i = 0, t0 = 0, p0 = 0, a0 = 0;
  for (let s = 0; s <= n; s++) {
    while (i < runs.length && t0 + runs[i + 1] < s) { if (runs[i] === 0) p0 += runs[i + 1]; if (runs[i] !== 2) a0 += runs[i + 1]; t0 += runs[i + 1]; i += 2; }
    const into = i < runs.length ? s - t0 : 0;
    P[s] = p0 + (runs[i] === 0 ? into : 0); A[s] = a0 + (i < runs.length && runs[i] !== 2 ? into : 0);
  }
  const eff = (a, b) => A[b] - A[a] >= 1 ? Math.min(1, (P[b] - P[a]) / (A[b] - A[a])) : null;
  // start, middle and end: thirds of the clock
  R.thirds = [0, 1, 2].map(k => eff(Math.round(n * k / 3), Math.round(n * (k + 1) / 3)));
  // the best 10 minutes (5 in a shorter session): the window of clock time with the most playing
  const W = t >= 1200 ? 600 : t >= 600 ? 300 : 0; R.best = null;
  if (W) { let top = -1, at = 0; for (let s = 0; s + W <= n; s++) { const p = P[s + W] - P[s]; if (p > top + 1e-9) { top = p; at = s; } }
    R.best = { a: at, b: at + W, len: W, eff: eff(at, at + W) || 0 }; }
  // columns for the picture: one a minute, or wider steps so a long session still fits in about 45
  const bin = [60, 120, 300, 600, 900, 1800].find(b => t / b <= 45) || 3600; R.bin = bin; R.columns = [];
  for (let j = 0; j < Math.ceil(t / bin - 1e-9); j++) R.columns.push({ t: Math.min(bin, t - j * bin), play: 0, quiet: 0, paused: 0 });
  t = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const key = ['play', 'quiet', 'paused'][runs[i]]; let s = t; const e = t + runs[i + 1];
    while (s < e && R.columns.length) { const j = Math.min(R.columns.length - 1, Math.floor(s / bin)), stop = j === R.columns.length - 1 ? e : Math.min(e, (j + 1) * bin);
      R.columns[j][key] += stop - s; if (stop <= s) break; s = stop; }
    t = e;
  }
  return R;
}
/* 75 -> "1:15", 3725 -> "1:02:05" */
function clockText(s) { s = Math.max(0, Math.floor(s));   // down to the second, as the running clock shows it
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; }

/* ---------- Practice log: saved sessions and the week (the streak is worked out but not shown for now) ---------- */
const LOG_MAX = 2000, KEEP_PLAY = 10;   // the log keeps the latest LOG_MAX sessions (years of practice, about 2.5 MB); a session needs KEEP_PLAY seconds of playing to be saved
/* what is saved for a finished session: its times and its report, rounded so the log stays small (no audio).
   themes: what each theme keeps with the session ({ rocket: RocketSim.save() }, from the themes' keep() hooks), by theme id */
function sessionRecord(s, R, name, themes) {
  const round = (k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return { v: 1, id: s.startedAt, start: s.startedAt, end: s.stoppedAt || s.startedAt + Math.round(R.total * 1000), goal: s.goal,
    play: Math.round(R.play * 1000) / 1000, eff: Math.round(R.efficiency * 1000) / 1000, name: name || '', R: JSON.parse(JSON.stringify(R, round)), themes: keptThemes(themes) };
}
/* what themes keep with a session: only plain objects, by an id a theme could have (anything else is dropped) */
function keptThemes(x) {
  const out = {}; if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const k in x) if (THEME_ID.test(k) && x[k] && typeof x[k] === 'object' && !Array.isArray(x[k])) out[k] = x[k];
  return out;
}
/* a record saved before themes kept their own data had the rocket's flight as record.rocket: it moves to record.themes.rocket */
function upgradeRecord(r) {
  if (!r || typeof r !== 'object') return r;
  const t = keptThemes(r.themes); if (!t.rocket && r.rocket && typeof r.rocket === 'object') t.rocket = r.rocket;
  delete r.rocket; r.themes = t; return r;
}
const worthKeeping = R => R.play >= KEEP_PLAY;
/* a session cut short: if the app is closed or iOS discards it mid-session, the session so far is still there next time.
   liveSnapshot is what is kept while it runs (now: when, themes: what each theme keeps); liveRecord turns it back into a saved record, or null */
function liveSnapshot(s, name, themes, now) {
  return { v: 1, startedAt: s.startedAt, savedAt: now, goal: s.goal, name: name || '', themes: keptThemes(themes), runs: s.runs.map((x, i) => i % 2 ? Math.round(x * 100) / 100 : x) };
}
function liveRecord(x) {
  if (!x || x.v !== 1 || !(x.startedAt > 0) || !(x.savedAt >= x.startedAt) || !(x.goal > 0) || !Array.isArray(x.runs) || x.runs.length % 2) return null;
  for (let i = 0; i < x.runs.length; i += 2) if ([0, 1, 2].indexOf(x.runs[i]) < 0 || !(x.runs[i + 1] >= 0)) return null;
  const R = sessionReport(x.runs), themes = upgradeRecord({ themes: x.themes, rocket: x.rocket }).themes;   // a snapshot kept by an older version has its rocket on its own
  return sessionRecord({ startedAt: x.startedAt, stoppedAt: x.savedAt, goal: x.goal }, R, typeof x.name === 'string' ? x.name : '', themes);
}
/* local calendar days */
const dayKey = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayStart = d => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/* a calendar day's shade: under LEVEL_MIN[0] minutes of playing, under LEVEL_MIN[1], or more */
const LEVEL_MIN = [15, 30];
/* the figures on the practice log page, from saved records (any order) at time now */
function practiceStats(records, now, weeks) {
  weeks = weeks || 12;
  const today = dayStart(now), days = new Map();
  let totalPlay = 0, totalActive = 0, longest = null;
  for (const r of records) {
    const k = dayKey(r.start), d = days.get(k) || { play: 0, sessions: 0, goal: 0, last: 0, recs: [] };
    d.play += r.play; d.sessions++; d.recs.push(r); if (r.start >= d.last) { d.last = r.start; d.goal = r.goal; } days.set(k, d);
    totalPlay += r.play; totalActive += r.R && r.R.active > 0 ? r.R.active : r.eff > 0 ? r.play / r.eff : r.play;
    if (!longest || r.play > longest.play) longest = r;
  }
  const played = d => { const x = days.get(dayKey(d)); return !!x && x.play > 0; };
  // the streak runs back from today, or from yesterday while today is still open
  const practicedToday = played(today); let streak = 0;
  for (let d = practicedToday ? today : addDays(today, -1); played(d); d = addDays(d, -1)) streak++;
  // best streak ever
  let bestStreak = 0; for (const k of days.keys()) { const [y, m, dd] = k.split('-').map(Number), d = new Date(y, m - 1, dd);
    if (played(addDays(d, -1))) continue; let n = 0; for (let e = d; played(e); e = addDays(e, 1)) n++; if (n > bestStreak) bestStreak = n; }
  let lastStart = 0; for (const r of records) if (r.start > lastStart) lastStart = r.start;
  const daysSince = lastStart ? Math.round((today - dayStart(lastStart)) / 864e5) : null;
  const cell = d => { const x = days.get(dayKey(d)) || null, play = x ? x.play : 0, goal = x && x.goal > 0 ? x.goal : 0;
    const level = play <= 0 ? 0 : play < LEVEL_MIN[0] * 60 ? 1 : play < LEVEL_MIN[1] * 60 ? 2 : 3;   // by minutes played: the goal is for one session, not a day
    const plays = x ? x.recs.slice().sort((a, b) => a.start - b.start).map(r => r.play) : [];   // each session's playing that day, earliest first
    return { date: d, key: dayKey(d), play: play, goal: goal, sessions: x ? x.sessions : 0, plays: plays, level: level, today: d.getTime() === today.getTime(), future: d > today }; };
  // this week, Monday to Sunday, and the week before
  const monday = addDays(today, -((today.getDay() + 6) % 7)), week = [];
  let weekPlay = 0, lastWeekPlay = 0, lastWeekSoFar = 0;
  for (let i = 0; i < 7; i++) { const c = cell(addDays(monday, i)); week.push(c); weekPlay += c.play;
    const p = cell(addDays(monday, i - 7)); lastWeekPlay += p.play; if (!c.future) lastWeekSoFar += p.play; }
  // the calendar: whole weeks, the last one this week
  const grid = []; for (let w = weeks - 1; w >= 0; w--) { const col = []; for (let i = 0; i < 7; i++) col.push(cell(addDays(monday, i - 7 * w))); grid.push(col); }
  return { sessions: records.length, totalPlay: totalPlay, efficiency: totalActive > 0 ? Math.min(1, totalPlay / totalActive) : 0, longest: longest,
    streak: streak, bestStreak: bestStreak, practicedToday: practicedToday, daysSince: daysSince, daysPlayed: days.size, today: cell(today),
    week: week, weekPlay: weekPlay, lastWeekPlay: lastWeekPlay, lastWeekSoFar: lastWeekSoFar, grid: grid };
}
/* one saved session among the others played the same day: its number that day, and the day's playing up to it and in all.
   The practice goal is for each session, so nothing here measures the day against it.
   null when rec is not in records (a demo or a session too short to keep) */
function dayRecap(records, rec) {
  if (!rec || !records.some(r => r.id === rec.id)) return null;
  const k = dayKey(rec.start), day = records.filter(r => dayKey(r.start) === k).sort((a, b) => a.start - b.start);
  const n = day.findIndex(r => r.id === rec.id) + 1;
  let before = 0, play = 0; day.forEach((r, i) => { play += r.play; if (i < n - 1) before += r.play; });
  return { key: k, n: n, count: day.length, sessions: day, before: before, upTo: before + rec.play, play: play };
}
/* the words for a day of several sessions on the summary: { lead, text }, or null for a day with one session */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function dayLine(D, now) {
  if (!D || D.count < 2) return null;
  const today = D.key === dayKey(now), latest = D.n === D.count, v = { n: D.n, count: D.count, nth: ORDINALS[D.n - 1] ? tr(ORDINALS[D.n - 1]) : '' };
  const text = today && latest ? tr(v.nth ? 'This was your {nth} session today.' : 'This was session {n} today.', v) : tr(today ? 'This was session {n} of {count} today.' : 'This was session {n} of {count} that day.', v);
  return { lead: tr(today ? '{time} of music today.' : '{time} of music that day.', { time: durationText(D.play) }), text: text };
}
/* 4500 -> "1 h 15 min", 600 -> "10 min", 40 -> "40 s" */
function durationText(s) { s = Math.max(0, Math.round(s)); if (s < 60) return tr('{n} s', { n: s }); const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? tr(m % 60 ? '{h} h {m} min' : '{h} h', { h: h, m: m % 60 }) : tr('{m} min', { m: m }); }
/* two sentences in a row: a space between them, or none in Chinese */
function both(a, b) { return tr('{a} {b}', { a: a, b: b }); }
/* the encouraging line on the practice log, and its partner about the week. Low pressure: they only ever count what was played,
   never days missed or a streak to keep, so coming back after a break reads as good news rather than something lost */
function practiceNudge(P) {
  if (!P.sessions) return '';
  if (P.practicedToday) return tr('Lovely playing today. Come back whenever you feel like it.');
  const n = P.week.filter(c => c.play > 0).length;
  if (n) return trn(n, 'You have played once this week. Nice work.', 'You have played on {n} days this week. Nice work.');
  return tr('Welcome back. Even a few minutes of playing is worth it.');
}
/* the Home Screen's words for this moment: a greeting, a headline and a line or two. Low pressure, like the practice log: they speak
   of what was played, never of days missed, so opening the app after a break feels welcoming. last is the latest session, or null.
   o.seed picks among playful words for young players, so the greeting is seldom the same twice (no seed: the first of each);
   o.name goes into the greeting ("Ahoy, Captain Sam"); with no name a fun word for the player takes its place ("Hello, music maker", or the
   greeting's own title: "Ahoy, Captain"), given as friend too, so the page can make it the link that adds a name. Every greeting ends with it */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOME_HELLO = ['Hello, {name}', 'Hi there, {name}', 'Howdy, {name}', 'Ahoy, Captain {name}', 'Hello, Earthling {name}', 'Yo-ho-ho, {name}',
  'Hey, superstar {name}', 'Bonjour, {name}', 'Hiya, {name}', 'Well, hello there, {name}', 'Hey, Maestro {name}', 'Beep boop, hello, {name}'];
const HOME_FRIEND = ['music maker', 'superstar', 'rock star', 'maestro', 'friend', 'tune wizard', 'melody maker', 'star player', 'music hero'];
const HOME_WORDS = {
  first: { head: ['Let\u2019s make some music.', 'Ready to make some noise?', 'Your instrument looks excited.', 'Time to make music magic.', 'Let\u2019s get this party started.'] },
  today: { head: ['Lovely playing today.', 'Somewhere, a cat is clapping.', 'High five for playing today!', 'Your instrument says thank you.', 'The crowd wants an encore.', 'That was some fine music.', 'You rocked it today.'],
    then: ['Come back whenever you feel like it.', 'Your fingers have earned a snack.', 'Time for a big stretch, like a cat.', 'Play again whenever the music calls.', 'Go wiggle those fingers. They worked hard.'] },
  week: { head: ['Ready when you are.', 'The stage is all yours.', 'Your instrument wants to play.', 'Who\u2019s ready for some music?', 'Let\u2019s make some noise!', 'Lights, camera, music!'],
    lede: ['Pick up your instrument and play for as long as feels good.', 'Play a song you love, or make up a brand new one.', 'Wiggle your fingers, take a big breath and play.',
      'Short or long, every bit of playing counts.', 'Play something happy, something silly, or something loud.'] },
  back: { head: ['Welcome back.', 'Look who\u2019s here!', 'Hooray, it\u2019s you!', 'Cue the happy dance!', 'The band is back together.'],
    lede: ['Nice to see you. Even a few minutes of playing is worth it.', 'Give your instrument a little wake-up tune.', 'Play one song, or ten. Whatever feels good today.',
      'Even a few minutes of playing is worth it.'] }
};
/* the playful words in each language (src/lang.js gives the others): the same shape as English. Every greeting ends with {name}, after
   a comma; a title in it ("Captain") stands before {name}. The time of day's greetings: morning, afternoon, evening, then a second one
   for the morning, and for later in the day one that names the day */
const HOME_EN = { hello: HOME_HELLO, friend: HOME_FRIEND, words: HOME_WORDS,
  times: ['Good morning, {name}', 'Good afternoon, {name}', 'Good evening, {name}', 'Rise and shine, {name}', 'Happy {day}, {name}'] };
function weekday(ms) { return lang === 'en' ? WEEKDAYS[new Date(ms).getDay()] : new Date(ms).toLocaleDateString(locale(), { weekday: 'long' }); }
function homeCopy(P, last, now, o) {
  o = o || {};
  const day = new Date(now), h = day.getHours(), r = o.seed ? rng(o.seed) : null, pick = a => a[r ? Math.floor(r() * a.length) : 0], W = HOME_LANG[lang] || HOME_EN, T = W.times;
  // the greeting: the time of day comes first (and with no seed is the one used), then the playful ones, which may name the day too
  const hellos = [h < 12 ? T[0] : h < 18 ? T[1] : T[2], h < 12 ? T[3] : T[4].replace('{day}', weekday(now))].concat(W.hello);
  // with no name, a title the greeting has ("Captain") is the word for the player; else one of the friend words (picked either way, so a name never changes the other words)
  const name = String(o.name || '').trim(), said = pick(hellos), other = pick(W.friend), title = said.replace(/^.*[,\uFF0C]\s*/, '').replace('{name}', '').trim();
  const friend = name ? undefined : title || other, hello = name ? said.replace('{name}', name) : title ? said.replace(/ ?\{name\}$/, '') : said.replace('{name}', other);
  if (!P.sessions || !last) return { kind: 'first', hello: hello, friend: friend, head: pick(W.words.first.head), lede: tr('It counts only the time the microphone hears you play.') };
  // a session that started before midnight and ended today still counts as playing today here (it is filed under the day it started)
  const lateLast = !P.practicedToday && dayKey(last.end || last.start) === dayKey(now);
  if (P.practicedToday || lateLast) { const t = P.today, n = t.sessions, play = durationText(lateLast ? last.play : t.play);
    return { kind: 'today', hello: hello, friend: friend, head: pick(W.words.today.head),
      lede: both(!lateLast && n > 1 ? tr('You played for {time} today, in {n} sessions.', { time: play, n: n }) : tr('You played for {time} today.', { time: play }), pick(W.words.today.then)),
      note: tr('All together: {time} of music.', { time: durationText(P.totalPlay) }) }; }
  if (P.weekPlay > 0) { const days = Math.round((dayStart(now) - dayStart(last.start)) / 864e5), v = { day: weekday(last.start) };
    const d = P.week.find(c => c.key === dayKey(last.start)), n = d ? d.sessions : 1;   // every session that day, not only the last
    if (n > 1) Object.assign(v, { n: n, time: durationText(d.play) }); else v.time = durationText(last.play);
    return { kind: 'week', hello: hello, friend: friend, head: pick(W.words.week.head), lede: pick(W.words.week.lede),
      note: tr(n > 1 ? (days <= 1 ? 'You last played yesterday, {time} in {n} sessions.' : 'You last played on {day}, {time} in {n} sessions.')
        : days <= 1 ? 'Your last session was yesterday, {time}.' : 'Your last session was on {day}, {time}.', v) }; }
  return { kind: 'back', hello: hello, friend: friend, head: pick(W.words.back.head), lede: pick(W.words.back.lede),
    fresh: tr('A fresh week. Whenever you play, it shows up here.'), note: tr('So far you have made {time} of music with Music Timer.', { time: durationText(P.totalPlay) }) };
}
function weekLine(P) {
  const v = { time: durationText(P.weekPlay) };
  if (P.lastWeekPlay <= 0) return tr('This week: {time} of playing.', v);
  const d = P.weekPlay - P.lastWeekSoFar;
  if (P.weekPlay >= P.lastWeekPlay) return P.weekPlay - P.lastWeekPlay >= 60 ? tr('This week: {time} of playing, {more} more than all of last week.', Object.assign(v, { more: durationText(P.weekPlay - P.lastWeekPlay) }))
    : tr('This week: {time} of playing, as much as all of last week.', v);
  if (d >= 60) return tr('This week: {time} of playing, {more} ahead of last week at this point.', Object.assign(v, { more: durationText(d) }));
  return tr('This week: {time} of playing.', v);                   // behind last week: no catching up to do, just this week's playing
}

/* ---------- Sample practice logs for the debug tools: made-up sessions, never saved, to see each page as it looks after some use ---------- */
const SAMPLE_LOGS = [['first', 'First visit'], ['today', 'Played today'], ['week', 'Played this week'], ['back', 'Back after a break'], ['months', 'Three months']];
/* a session's runs (as Session keeps them) with about play seconds of playing: stretches of playing, short gaps, now and then a break or a pause */
function sampleRuns(play, rnd) {
  const runs = [1, 5 + rnd() * 20]; let left = play;      // a little quiet before the first note
  for (;;) {
    const p = Math.min(left, 40 + rnd() * 300); runs.push(0, p); left -= p;
    if (left <= 0) return runs;
    const x = rnd(); if (x < 0.08) runs.push(2, 30 + rnd() * 120); else if (x < 0.25) runs.push(1, 35 + rnd() * 80); else runs.push(1, 1 + rnd() * 12);
  }
}
/* the made-up practice log for one of SAMPLE_LOGS at time now, oldest first, as the app keeps it. The same kind and day give the same log */
function sampleLog(kind, now) {
  const plan = { today: [1, 83, 0.45], week: [1, 83, 0.5], back: [21, 75, 0.55], months: [0, 83, 0.7] }[kind];   // days ago from, to, and how often a day has playing
  if (!plan) return [];
  const rnd = rng(11), today = dayStart(now), out = [];
  const add = (ago, start, play, goal) => {
    const R = sessionReport(sampleRuns(play, rnd));
    out.push(sessionRecord({ startedAt: start, stoppedAt: start + Math.round(R.total * 1000), goal: goal }, R, '', null));   // the themes add their own (sampleLog hook)
  };
  const day = (ago, plays) => {
    const d = addDays(today, -ago), goal = kind === 'months' && ago > 42 ? 1200 : 1800;
    plays.forEach((p, i) => {
      let start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), [8, 13, 18][i], Math.floor(rnd() * 50)).getTime();
      if (ago === 0) start = Math.max(today.getTime() + i * 6e5, Math.min(start, now - (plays.length - i) * 5400e3));   // today's sessions start before now
      add(ago, start, p, goal);
    });
  };
  for (let ago = plan[1]; ago >= plan[0]; ago--) {
    const yes = rnd() < plan[2], n = rnd(), plays = [];
    for (let i = 0; i < (n < 0.7 ? 1 : n < 0.92 ? 2 : 3); i++) plays.push(Math.round(480 + rnd() * 1800));
    if (yes || (kind === 'week' && ago === 1)) day(ago, plays);             // played this week: yesterday at least (on a Monday that is last week, so it reads as a break)
  }
  if (kind === 'today') day(0, [840, 1140]);                                // two sessions today
  out.sort((a, b) => a.start - b.start);
  return out;
}

/* ---------- note starts: when a new note begins (used to make the Dash cube jump in time with the playing) ---------- */
class OnsetTracker {
  constructor() { this.reset(); }
  reset() { this.was = false; this.key = null; this.cand = null; this.candT = 0; this.lv = -120; this.dip = false; this.cool = 0; }
  /* r: {music, midi (fractional key number or null), levelDb}. True on the tick a note starts. */
  feed(dt, r) {
    this.cool = Math.max(0, this.cool - dt);
    if (!r.music) { this.was = false; this.key = null; this.cand = null; this.dip = false; this.lv = r.levelDb; return false; }
    let hit = !this.was;                                                  // the music begins
    const k = r.midi != null ? Math.round(r.midi) : null;
    if (k != null) {
      if (this.key == null) this.key = k;
      else if (Math.abs(r.midi - this.key) >= 0.7) {                      // a different pitch that holds for a moment (vibrato does not count)
        if (this.cand !== k) { this.cand = k; this.candT = 0; }
        this.candT += dt; if (this.candT >= 0.045) { this.key = k; this.cand = null; hit = true; }
      } else this.cand = null;
    }
    const slow = this.lv; this.lv += (r.levelDb - this.lv) * Math.min(1, dt / 0.12);   // the same note struck again: the level dips, then jumps back
    if (r.levelDb < slow - 4) this.dip = true;
    if (this.dip && r.levelDb > this.lv + 4) { this.dip = false; hit = true; }
    this.was = true;
    if (hit && this.cool > 0) hit = false;
    if (hit) this.cool = 0.12;
    return hit;
  }
}

/* ---------- finger and mouse swipes: the themes follow the drag, and letting go lands on one ----------
   A press becomes a swipe once it has gone 10 px sideways and more sideways than down; 14 px down first and it is left to scroll (a press that
   goes nowhere stays a tap). Letting go a quarter of the way across, or after a quick 40 px flick, steps one theme that way.
   A second finger touching the scene during a swipe (a thumb resting on it) is ignored: the swipe keeps following the first finger and lands
   when it lets go. Taking it over instead left the themes stranded between two of them, since neither finger's lifting then ended the swipe. */
class DragSwipe {
  constructor() { this.d = null; }
  down(id, x, y, t, w) { if (this.d && this.d.lock) return; this.d = { id: id, x: x, y: y, t: t, w: w, lock: false }; }   // w: the scene's width, px
  has(id) { return !!this.d && this.d.id === id; }
  get locked() { return !!this.d && this.d.lock; }
  /* Returns how far it has been dragged sideways (px, - = finger moving left, towards the next theme) once it is a swipe, else null */
  move(x, y) {
    const d = this.d; if (!d) return null;
    const dx = x - d.x, dy = y - d.y;
    if (!d.lock) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) d.lock = true; else { if (Math.abs(dy) > 14) this.d = null; return null; } }
    return dx;
  }
  /* Let go at x (null: the browser took the pointer away). Returns 1 (next theme), -1 (the one before) or 0 (back to where it was) for a swipe, null for a tap or a scroll */
  up(x, t) {
    const d = this.d; this.d = null; if (!d || !d.lock) return null;
    const dx = x == null ? 0 : x - d.x, fast = t - d.t < 350 && Math.abs(dx) > 40;
    return dx < 0 && (dx < -d.w * 0.25 || fast) ? 1 : dx > 0 && (dx > d.w * 0.25 || fast) ? -1 : 0;
  }
  /* Where the track sits (px) while theme `at` of `n` is dragged dx: it follows the finger, and only gives a little past either end */
  offset(dx, at, n) {
    const w = this.d ? this.d.w : 0, end = -(n - 1) * w; let x = -at * w + dx;
    if (x > 0) x *= 0.3; if (x < end) x = end + (x - end) * 0.3;
    return x;
  }
}

/* ---------- trackpad swipes: one theme per two-finger swipe, from the page's horizontal wheel events ----------
   After the fingers lift, momentum events keep coming, ever slower, for a second or two, and a quick next swipe starts as soon as the fingers
   touch again, with no pause between. So a swipe is new after a pause, when it goes the other way, or when it speeds up again after slowing
   down; momentum does none of these. */
class WheelSwipe {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.dir = 0; this.t = -1e9; this.h = -1e9; this.s = -1e9; this.v = 0; this.peak = 0; this.low = 0; }   // dir: the way the last step went, while its momentum may still be arriving
  /* e: {t: the event's own time, now: when it is handled, drawn: when the page last drew a frame (all ms), dx: px, + = fingers moving left}.
     Feed only mostly-horizontal events. Returns 1 or -1 on the event that completes a swipe (a step that way), else 0. */
  feed(e) {
    const t = e.t, dt = t - this.t, dx = e.dx, s = Math.sign(dx);
    this.v += (Math.abs(dx) / Math.max(8, dt) - this.v) * (1 - Math.exp(-Math.max(0, Math.min(dt, 1000)) / 16));   // px per ms by the events' own times, smoothed over ~16 ms: the same at 60 or 120 Hz and when events arrive merged
    if (dt > 250 && e.now - this.h > 150 && e.now - e.drawn < 150) { this.dir = 0; this.x = 0; }   // a pause, in the events' own times and as they arrive, while the page kept drawing: events a busy page held back arrive late and bunched
    this.t = t; this.h = e.now;
    if (s === this.dir) {   // the way the last step went: that swipe's own momentum, unless it fell below half its peak and then sped up again
      if (this.low < this.peak / 2 && (this.v > this.low * 2.5 + 0.25 || this.v > this.peak) && t - this.s > 200) { this.dir = 0; this.x = 0; }   // new fingers; not within 200 ms of a step, so one swipe that falters stays one
      else { if (this.v > this.peak) this.peak = this.low = this.v; else if (this.v < this.low) this.low = this.v; return 0; }
    }
    if (s !== Math.sign(this.x)) this.x = 0;   // count one way only: a few px back as the fingers lift never add up to a swipe
    this.x += dx; if (Math.abs(this.x) < 60) return 0;
    this.dir = s; this.x = 0; this.peak = this.low = this.v; this.s = t;
    return s;
  }
}

/* Wheel events recorded on real devices, for the trackpad tests: per trace, a flat list of [ms since the previous event, deltaX, deltaY].
   From the wheel-gestures project (https://github.com/xiel/wheel-gestures, src/test/fixtures). Copyright (c) 2020 Felix Leupold. MIT License:
   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the
   "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
   following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
const WHEEL_TRACES = {
  mac: [0,-1,0,11,-7,0,11.3,-8,0,11.2,-11,0,11.6,-24,0,11,-12,0,11.7,-29,0,11,-24,0,11,-28,0,11.5,-52,0,11.3,-54,0,28.9,-83,0,15.6,-83,0,17.6,-84,0,15.7,-84,0,17.3,-82,0,16.3,-82,0,16.4,-75,0,16.8,-72,0,16.7,-67,0,17.1,-59,0,16.2,-54,0,16.6,-49,0,17.8,-45,0,15.5,-41,0,17,-37,0,16.6,-33,0,17,-30,0,16.1,-29,0,17.2,-26,0,16.3,-23,0,17,-23,0,16.5,-20,0,16.2,-18,0,16.7,-17,0,17.2,-15,0,16.1,-15,0,17.3,-13,0,16,-13,0,16.7,-11,0,16.7,-10,0,17.2,-9,0,16.2,-9,0,16.6,-8,0,16.6,-7,0,16.7,-7,0,16.7,-7,0,17.5,-6,0,15.8,-5,0,17.1,-4,0,16.3,-4,0,17.1,-4,0,16.5,-3,0,16.2,-3,0,16.6,-3,0,16.7,-2,0,16.7,-2,0,17.6,-2,0,15.7,-1,0,17.3,-1,0,16.4,-1,0,32.9,-1,0,17.4,-1,0,32.7,-1,0],   // Chrome, Mac trackpad, one swipe
  macFast: [0,-3,0,16.8,-2,0,15.8,-2,0,16.9,-2,0,16.3,-1,0,16.8,-1,0,16.7,-1,0,33.3,-1,0,16.6,-1,0,34.5,-1,0,463.5,-1,0,10.9,-26,0,11.2,-39,0,11.4,-125,0,11.1,-156,0,11.4,-201,0,11.1,-371,0,11.2,-345,0,11.5,-450,0,11,-460,0,29.3,-662,0,15.7,-624,0,17.5,-590,0,16.7,-556,0,16.7,-526,0,15.5,-496,0,17.8,-471,0,15.8,-447,0,17.5,-430,0,16.5,-407,0,16,-389,0,17.6,-369,0,15.5,-348,0,16.6,-332,0,17.8,-314,0,16.7,-290,0,15.7,-271,0,17.6,-252,0,16.7,-237,0,15.8,-219,0,17.5,-205,0,16.6,-187,0,15.8,-173,0,17.6,-160,0,16.7,-147,0,15.7,-135,0,16.9,-122,0,17.4,-110,0,15.7,-102,0,17.6,-91,0,15.6,-84,0,16.7,-74,0,16.5,-68,0,17.8,-62,0,15.8,-57,0,17.6,-53,0,16.7,-48,0,16.7,-44,0,16.7,-40,0,16.7,-37,0,15.8,-33,0,17.6,-30,0,16.3,-27,0,16.1,-26,0,17.6,-23,0,15.5,-21,0,16.9,-20,0,17.6,-18,0,15.7,-15,0,16.7,-15,0,17.6,-13,0,16.7,-13,0,15.7,-11,0,17.5,-11,0,16.6,-10,0,15.9,-9,0,17.6,-9,0,16.7,-7,0,15.7,-7,0,17.6,-7,0,16.6,-6,0,15.8,-5,0,17.5,-5,0,16.7,-4,0,15.7,-4,0,17.6,-3,0,16.7,-3,0,15.8,-3,0,17.6,-2,0,16.2,-2,0,17.2,-2,0,16.7,-2,0,16.7,-1,0,15.7,-1,0,34.2,-1,0,15.7,-1,0,34.3,-1,0],   // Chrome, Mac trackpad, a pause then a fast flick
  macDouble: [0,-1,0,7.9,-4,1,8,-5,0,15.5,-13,2,16.1,-25,2,15.4,-39,2,7.7,-24,1,25,-52,0,16.7,-56,0,17.3,-56,0,16.2,-56,0,17.2,-55,0,16.7,-51,0,16.3,-49,0,17,-48,0,16.7,-45,0,16.5,-41,0,16.8,-38,0,15.7,-35,0,17.5,-32,0,16.4,-30,0,17,-27,0,16.6,-24,0,15.8,-22,0,16.6,-20,0,17.2,-19,0,16.1,-17,0,17.3,-16,0,16.2,-14,0,17.5,-13,0,16.8,-12,0,16.4,-11,0,39,-2,0,8.1,-9,0,7.8,-8,0,8.1,-9,0,8.1,-10,0,16,-20,0,15.8,-37,-1,16.2,-48,-1,15.5,-65,0,7.5,-43,0,25.2,-86,0,16.6,-88,0,16.6,-86,0,16.6,-84,0,16.1,-82,0,17.3,-78,0,16.7,-74,0,16.7,-72,0,16.1,-66,0,17.3,-62,0,16.8,-58,0,15.6,-55,0,17.7,-51,0,16.7,-47,0,16.7,-43,0,15.8,-40,0,16.7,-37,0,16.7,-34,0,16.7,-31,0,16.7,-28,0,16.3,-26,0,17.2,-24,0,16.4,-22,0,17.2,-20,0,16,-19,0,17.1,-17,0,16.4,-16,0,17.3,-14,0,16.4,-13,0,17,-12,0,16.5,-11,0,16.6,-10,0,16.3,-9,0,17.2,-8,0,16.6,-8,0,16.7,-7,0,15.7,-6,0,17.6,-6,0,16.7,-5,0,16.4,-5,0,16.9,-5,0,16.1,-4,0,17.2,-4,0,16.8,-4,0,16.1,-3,0,17.3,-3,0,15.8,-3,0,16.6,-3,0,17.6,-2,0,16.1,-2,0,16.2,-2,0,16.7,-2,0,17.4,-1,0,16.9,-1,0,16.3,-1,0,16.4,-1,0,16.7,-1,0,16.5,-1,0,33.2,-1,0,16.8,-1,0,33.3,-1,0],   // Chrome, Mac trackpad, two quick swipes
  safari: [0,3,0,8,6,0,8,8,-1,8,11,-1,8,12,-1,8,14,-1,8,24,-1,8,29,-1,8,41,-1,8,49,-1,8,55,-2,8,72,-2,8,54,-1,8,79,-1,7,58,-1,25,150,0,16,145,0,18,139,0,17,131,0,16,125,0,17,116,0,16,110,0,17,105,0,17,100,0,17,96,0,16,90,0,16,85,0,17,82,0,17,77,0,17,72,0,16,68,0,17,63,0,17,59,0,16,55,0,17,51,0,17,47,0,16,43,0,17,41,0,17,37,0,16,34,0,17,32,0,17,29,0,17,26,0,15,24,0,17,22,0,17,20,0,17,19,0,16,17,0,18,16,0,16,14,0,17,13,0,16,12,0,17,11,0,16,10,0,17,9,0,17,8,0,17,8,0,17,7,0,16,6,0,17,6,0,17,5,0,16,5,0,16,5,0,17,4,0,16,4,0,17,4,0,17,3,0,17,3,0,17,3,0,16,3,0,17,2,0,17,2,0,16,2,0,16,2,0,17,1,0,17,1,0,16,1,0,17,1,0,17,1,0,16,1,0,34,1,0,16,1,0,34,1,0],   // Safari, Mac trackpad, one swipe the other way
  safariSlow: [0,-1,0,7,-2,0,9,-2,0,8,-2,0,8,-2,0,8,-2,0,7,-3,0,8,-3,0,9,-4,-1,8,-4,0,7,-4,0,8,-5,0,9,-5,-1,8,-5,0,8,-5,0,8,-5,0,8,-6,-1,7,-6,0,9,-6,0,7,-6,-1,9,-6,0,8,-6,0,7,-9,0,9,-4,0,7,-7,0,8,-7,0,8,-7,0,8,-7,0,8,-8,-1,8,-11,0,8,-6,0,8,-10,0,8,-9,0,9,-8,0,7,-9,0,8,-13,0,8,-8,0,9,-12,0,8,-11,0,8,-9,1,7,-13,1,8,-10,0,8,-15,1,8,-12,1,8,-11,1,8,-14,1,8,-13,1,9,-13,1,8,-14,1,7,-9,1,8,-17,1,8,-13,1,8,-13,1,9,-13,1,8,-11,1,7,-16,0,8,-13,1,8,-15,1,8,-13,1,8,-9,0,8,-17,1,8,-8,0,8,-17,1,8,-12,0,8,-10,0,8,-13,0,8,-7,0,8,-16,0,8,-11,0,8,-12,0,8,-7,0,8,-15,0,8,-8,0,8,-15,0,8,-11,1,8,-7,0,8,-15,0,8,-7,0,8,-13,0,8,-12,0,8,-10,0,8,-9,0,8,-14,0,8,-7,0,8,-10,0,8,-10,0,8,-10,0,8,-9,0,8,-9,0,8,-12,0,8,-5,0,8,-9,0,8,-9,-1,8,-9,0,8,-8,0,8,-10,-1,8,-7,0,8,-8,-1,8,-8,0,8,-9,0,8,-9,-1,8,-8,-1,8,-11,0,8,-5,-1,8,-9,-1,8,-9,0,8,-8,0,8,-9,-1,8,-11,0,8,-5,0,8,-8,0,8,-8,0,8,-9,0,8,-9,0,8,-8,0,7,-11,0,8,-6,0,8,-8,0,9,-8,0,7,-8,0,8,-8,0,8,-8,1,9,-11,0,8,-5,0,8,-8,0,8,-8,1,8,-8,0,8,-7,0,8,-6,0,7,-6,0,8,-8,0,8,-5,0,8,-6,1,9,-7,0,7,-7,0,8,-7,0,8,-7,0,8,-7,0,8,-7,0,8,-7,0,8,-6,0,8,-7,0,8,-7,0,8,-6,0,8,-6,0,8,-7,0,8,-5,0,8,-6,0,9,-5,0,7,-6,0,8,-5,0,8,-5,0,8,-5,0,8,-4,0,8,-4,0,8,-4,0,8,-6,0,8,-3,0,8,-5,0,8,-3,1,8,-5,0,8,-3,0,8,-4,0,8,-4,0,8,-3,0,8,-4,0,8,-4,0,8,-3,0,8,-3,0,8,-3,0,8,-4,0,8,-2,0,8,-3,0,8,-3,0,8,-2,0,8,-2,0,8,-2,0,8,-2,0,8,-2,0,8,-2,0,8,-1,0,8,-1,0,8,-1,0,8,-2,0,8,-1,0,8,-1,0,8,-1,-1,8,-1,0,8,-1,0,8,-1,0,8,-1,-1,7,-1,0,8,-1,1,9,-1,0],   // Safari, Mac trackpad, a slow drag
  win: [0,-24,0,16.6,-78,0,16.8,-111,0,17.5,-186,0,16.2,-142.5,0,16.5,-123,0,17.8,-30,0,0.3,0,0,31.4,-93,0,17.4,-76.5,0,16.5,-63,0,16.3,-52.5,0,17.1,-48,0,16.4,-42,0,16.8,-39,0,17.1,-36,0,16.3,-31.5,0,16.9,-30,0,16.4,-28.5,0,16.8,-27,0,32.6,-46.5,0,34,-43.5,0,33.2,-39,0,16.4,-18,0,16.9,-16.5,0,16.9,-16.5,0,16.5,-15,0,16.8,-15,0,16.4,-13.5,0,17,-13.5,0,16.4,-13.5,0,16.8,-12,0,16.5,-12,0,16.9,-12,0,16.5,-10.5,0,16.1,-10.5,0,16.8,-10.5,0,16.7,-9,0,16.8,-9,0,16.8,-9,0,16.5,-9,0,16.5,-7.5,0,16.9,-9,0,16.7,-7.5,0,33.6,-15,0,16.7,-6,0,16.4,-7.5,0,16.3,-6,0,17.2,-6,0,16.5,-6,0,16.9,-6,0,16.7,-4.5,0,16.6,-6,0,16.9,-4.5,0,16.4,-4.5,0,16.8,-6,0,16.6,-4.5,0,16.8,-3,0,16.5,-4.5,0,17,-4.5,0,16.4,-3,0,16.8,-4.5,0,16.5,-3,0,16.7,-4.5,0,16.6,-3,0,17.3,-3,0,16.2,-3,0,17,-3,0,16.3,-3,0,17,-1.5,0,16.3,-3,0,17,-3,0,16.8,-1.5,0,16,-3,0,16.9,-1.5,0,16.9,-3,0,16.4,-1.5,0,17,-1.5,0,16.5,-1.5,0,16.8,-1.5,0,16.4,-1.5,0,16.9,-1.5,0,16.5,-1.5,0,16.8,-1.5,0,16.6,-1.5,0,16.8,-1.5,0,16.5,-1.5,0,16.9,-1.5,0,33.4,-1.5,0,33.3,-1.5,0,16.4,-1.5,0,33.4,-1.5,0,50.2,-1.5,0,49.7,-1.5,0,66.8,-1.5,0,116.5,-1.5,0],   // Chrome, Windows precision touchpad, one swipe
  ffMagic: [0,1,0,12,8,0,11,13,0,11,14,0,11,13,0,11,28,0,11,24,0,11,11,0,12,15,0,30,26,0,16,31,0,17,33,0,16,34,0,17,33,0,16,32,0,18,30,0,16,33,0,17,32,0,16,29,0,17,26,0,16,23,0,17,23,0,17,20,0,17,18,0,16,17,0,16,15,0,17,15,0,17,13,0,17,13,0,17,11,0,17,10,0,16,9,0,16,9,0,17,8,0,17,7,0,17,7,0,16,7,0,17,6,0,17,5,0,16,5,0,17,4,0,16,4,0,16,4,0,18,3,0,16,3,0,18,3,0,16,2,0,16,2,0,16,2,0,17,1,0,17,1,0,17,1,0,33,1,0,17,1,0,34,1,0],   // Firefox, Mac Magic Mouse, one swipe that slows and speeds up again just after it steps
};
function wheelTrace(k) { const a = WHEEL_TRACES[k], out = []; let t = 0; for (let i = 0; i < a.length; i += 3) { t += a[i]; out.push({ t: t, dx: a[i + 1], dy: a[i + 2] }); } return out; }

const api = { LANGS, addWords, setLang, getLang, pickLang, locale, tr, trn, inLang, both, OnsetTracker, DragSwipe, WheelSwipe, MusicDetector, Session, SENSITIVITY, CLIPS, DETECTION_CASES,
  detectionTests, runDetectionTests, analyzeClip, sessionReport, clockText, sessionRecord, upgradeRecord, worthKeeping, liveSnapshot, liveRecord, buildOf, newerBuild, themesOn, themeSwitch, themeLanding,
  THEME_API, THEME_HOOKS, checkTheme, checkInstance, translator, word, addTheme, removeTheme, themes, themesOpen, seededRng, COMMON_WORDS,
  practiceStats, dayRecap, dayLine, practiceNudge, homeCopy, weekLine, durationText, dayKey, dayStart, LOG_MAX, LEVEL_MIN, SAMPLE_LOGS, sampleLog, fraction, heardAs, noteOf, clamp01 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MT = api;
})(typeof self !== 'undefined' ? self : this);
