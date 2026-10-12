/* Music Timer core: detector, test signals, session clock, rocket flight model.
   Pure logic, no DOM. Runs in the browser and in Node (for tests). */
(function (root) {
'use strict';

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
      isMusic: false, kind: 'quiet', label: 'Quiet', detail: '', instrument: '' };
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
      o.kind = 'music'; o.instrument = ins.name; o.label = 'Music heard'; o.detail = 'The clock counts while you play';
    } else if (!active) { o.kind = 'quiet'; o.label = 'Quiet'; o.detail = 'Nothing loud enough to count'; }
    else if (this.duty > 0.85 && this.glideHold <= 0) { o.kind = 'tone'; o.label = 'A steady tone'; o.detail = 'Checking whether it is music'; }
    else if (this.duty > 0.22) { o.kind = 'voice'; o.label = 'Talking or a voice'; o.detail = 'Pitch slides and breaks up, unlike an instrument'; }
    else if (this.trans > 0) { o.kind = 'percussive'; o.label = 'Clapping, tapping or knocking'; o.detail = 'Short bursts with no steady pitch'; }
    else if (this.lv < 6) { o.kind = 'noise'; o.label = 'Steady background noise'; o.detail = 'A hum or hiss with no notes in it'; }
    else { o.kind = 'noise'; o.label = 'Noise'; o.detail = 'No clear notes'; }
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
    const now = s.startedAt + 600e3, snap = JSON.parse(JSON.stringify(liveSnapshot(s, 'Sam', { mode: 'orbit' }, now))), rec = liveRecord(snap);
    s.stoppedAt = now; const want = sessionRecord(s, sessionReport(s.runs), 'Sam', { mode: 'orbit' });
    const bad = [null, {}, Object.assign({}, snap, { v: 2 }), Object.assign({}, snap, { runs: [0, 5, 1] }), Object.assign({}, snap, { runs: [7, 5] }), Object.assign({}, snap, { savedAt: snap.startedAt - 1 })];
    const ok = rec && rec.id === s.startedAt && rec.end === now && Math.abs(rec.play - want.play) < 0.5 && Math.abs(rec.eff - want.eff) < 0.002 && rec.R.pauses === 1
      && rec.name === 'Sam' && rec.rocket.mode === 'orbit' && worthKeeping(rec.R) && bad.every(x => liveRecord(x) === null) && JSON.stringify(snap).length < 8000;
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
    const T = practiceStats(sampleLog('today', now), now), carried = new RocketSim().restore(rocketCarry(sampleLog('today', now), now));
    const space = new RocketSim(), orbit = new RocketSim(), months = sampleLog('months', now).length, back = practiceStats(sampleLog('back', now), now);
    ok = ok && T.today.sessions === 2 && T.today.level === 3 && carried && months > 30 && back.daysSince >= 21 && rocketAt(MILESTONES.space - 1) === null
      && space.restore(rocketAt(MILESTONES.space)) && space.mode === 'ascent' && orbit.restore(rocketAt(MILESTONES.orbit)) && orbit.mode === 'orbit';
    return { name: 'Debug tools: sample practice logs', expect: 'each sample log is valid and the same every time, and opens the Home Screen it is for; today has two sessions and the rocket carries on',
      got: got.join(', ') + '; today ' + durationText(T.today.play) + ', rocket ' + (carried ? 'carried on' : 'on the pad'), pass: ok }; } });
  // rocket timeline
  list.push({ name: 'Rocket: timeline from ignition to Moon orbit', run: () => {
    const sim = new RocketSim(), s = new Session(), at = {}; s.start();
    for (let t = 0; t < 1830; t += 0.1) { s.tick(0.1, true); sim.update(0.1, { running: true, playing: true, eff: s.efficiency });
      while (sim.events.length) { const e = sim.events.shift(); if (at[e] == null) at[e] = t + 0.1; } }
    const th1 = sim.th; for (let i = 0; i < 300; i++) { sim.update(0.1, { running: true, playing: false, eff: 0.2 }); while (sim.events.length) { const e = sim.events.shift(); if (at[e] == null) at[e] = 1830 + i * 0.1; } }
    const want = { ignition: 0, liftoff: 3, tower: 10, stage1: 190, space: 370, stage2: 610, orbit: 1810, spin: 1813 };
    let ok = sim.mode === 'orbit' && sim.th !== th1 && sim.spinUp === 1 && sim.spinA !== 0;
    for (const k in want) if (!(Math.abs(at[k] - want[k]) <= 2)) ok = false;
    return { name: 'Rocket: timeline from ignition to Moon orbit', expect: 'lift-off 3 s, tower 10 s, stage 1 3:10, space 6:10, stage 2 10:10, orbit 30:10, module spinning 3 s later, then keeps orbiting',
      got: Object.keys(want).map(k => k + ' ' + (at[k] == null ? 'never' : Math.round(at[k]) + ' s')).join(', ') + (sim.mode === 'orbit' && sim.th !== th1 ? ', orbiting' : ', not orbiting'), pass: ok }; } });
  list.push({ name: 'Rocket: carries on from earlier the same day', run: () => {
    const fly = (sim, secs, eff, playing) => { for (let t = 0; t < secs; t += 0.1) sim.update(0.1, { running: true, playing: playing !== false, eff: eff }); };
    const a = new RocketSim(); fly(a, 130, 1); const low = a.save(); fly(a, 300, 1); const high = a.save(); fly(a, 1500, 1); const orb = a.save();
    const f = new RocketSim(); fly(f, 60, 1); fly(f, 1, 0.2, false); const falling = f.mode === 'fall' && f.save() === null;
    const c = new RocketSim(), d = new RocketSim(), pad = new RocketSim(), forged = new RocketSim();
    const carriedHigh = c.restore(high) && c.mode === 'ascent' && c.fp === high.fp; fly(c, 5, 0.2, false); d.restore(orb); fly(d, 1, 1);
    const below = !forged.restore({ mode: 'ascent', fp: 130, l: 0.02, stage: 0, inSpace: false, th: 0, tOrb: 0 }) && forged.mode === 'pad' && forged.fp === 0;
    const at = (dd, h) => new Date(2026, 9, dd, h).getTime(), now = at(9, 18), rec = (dd, h, rk) => ({ start: at(dd, h), rocket: rk });
    const carry = [rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now) === high, rocketCarry([rec(8, 20, orb)], now) === null, rocketCarry([rec(9, 12, high), rec(9, 15, null)], now) === null,
      rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now, at(9, 13)) === null,                                  // a new flight after both sessions: the pad
      rocketCarry([rec(9, 8, orb), { start: at(9, 12), end: at(9, 14), rocket: high }], now, at(9, 13)) === high,  // chosen during a session: that session's flight carries on
      rocketCarry([rec(9, 8, orb), rec(9, 14, high)], now, at(9, 13)) === high];                                  // a session after the new flight carries on
    const ok = low === null && falling && below && high && high.inSpace && carriedHigh && c.mode === 'ascent' && c.events.indexOf('fall') < 0 && orb.mode === 'orbit'
      && d.mode === 'orbit' && d.spinUp === 1 && d.events.indexOf('spin') < 0 && pad.save() === null && !pad.restore({ mode: 'pad' }) && !pad.restore(null) && carry.every(Boolean);
    return { name: 'Rocket: carries on from earlier the same day', expect: 'in space and in Moon orbit it carries on; below the edge of space, falling, on a new day or after a new flight is chosen it starts on the pad',
      got: 'below space ' + (low === null && below ? 'back to the pad' : 'carried') + ', falling ' + (falling ? 'back to the pad' : 'carried') + '; in space ' + c.mode + '; orbit ' + d.mode + ' spin ' + d.spinUp + '; carry ' + carry.join(','), pass: ok }; } });
  list.push({ name: 'Rocket: lifts off at 50% engine power', run: () => {
    const fly = eff => { const sim = new RocketSim(); let at = -1; for (let t = 0; t < 30; t += 0.1) { sim.update(0.1, { running: true, playing: true, eff: eff }); if (at < 0 && sim.events.indexOf('liftoff') >= 0) at = t + 0.1; sim.events.length = 0; } return at; };
    const a = fly(0.55), b = fly(0.45), ok = Math.abs(a - 3) <= 0.3 && b < 0;
    return { name: 'Rocket: lifts off at 50% engine power', expect: 'at 55%: lift-off after 3 s; at 45%: stays on the pad',
      got: 'at 55%: ' + (a < 0 ? 'no lift-off' : 'lift-off at ' + a.toFixed(1) + ' s') + '; at 45%: ' + (b < 0 ? 'stays on the pad' : 'lift-off at ' + b.toFixed(1) + ' s'), pass: ok }; } });
  list.push({ name: 'Rocket: falls and explodes when power drops in the atmosphere', run: () => {
    const sim = new RocketSim(), s = new Session(), ev = []; s.start();
    for (let t = 0; t < 400; t += 0.1) { const p = t < 120; s.tick(0.1, p); sim.update(0.1, { running: true, playing: p, eff: s.efficiency });
      while (sim.events.length) ev.push(sim.events.shift()); }
    const ok = ev.indexOf('liftoff') >= 0 && ev.indexOf('fall') > ev.indexOf('liftoff') && ev.indexOf('crash') > ev.indexOf('fall') && sim.mode === 'pad' && sim.fp === 0;
    return { name: 'Rocket: falls and explodes when power drops in the atmosphere', expect: 'lift-off, fall below 50%, explosion, new rocket on the pad', got: ev.join(', '), pass: ok }; } });
  list.push({ name: 'Rocket: keeps flying when power drops in space', run: () => {
    const sim = new RocketSim(), ev = []; let fell = false;
    for (let t = 0; t < 420; t += 0.1) { sim.update(0.1, { running: true, playing: true, eff: 1 }); sim.events.length = 0; }
    for (let t = 0; t < 120; t += 0.1) { sim.update(0.1, { running: true, playing: false, eff: 0.3 }); while (sim.events.length) ev.push(sim.events.shift()); if (sim.mode === 'fall') fell = true; }
    const ok = !fell && sim.mode === 'ascent' && !sim.ignited && sim.inSpace;
    return { name: 'Rocket: keeps flying when power drops in space', expect: 'no fall once outside the atmosphere, engine off', got: 'mode ' + sim.mode + ', engine ' + (sim.ignited ? 'on' : 'off') + (ev.length ? ', events ' + ev.join(', ') : ''), pass: ok }; } });
  // note starts and the Dash course
  list.push({ name: 'Note starts: one per note, none for talking or silence', run: () => {
    const count = clip => { const x = CLIPS[clip](sr), det = new MusicDetector(sr, { sensitivity: 'normal' }), tr = new OnsetTracker(), N = det.N, hop = N >> 1, dt = hop / sr; let n = 0;
      for (let pos = 0; pos + N <= x.length; pos += hop) { const r = det.process(x.subarray(pos, pos + N), dt); if (tr.feed(dt, { music: r.isMusic, midi: r.pitch > 0 ? 69 + 12 * Math.log2(r.pitch / 440) : null, levelDb: r.levelDb })) n++; } return n; };
    const v = count('violin'), s = count('staccato'), t = count('talk'), q = count('quiet');
    return { name: 'Note starts: one per note, none for talking or silence', expect: 'violin 9 to 13 of its 12 notes (the first second is spent recognising it), talking 0, quiet 0',
      got: 'violin ' + v + ', detached notes ' + s + ', talking ' + t + ', quiet ' + q, pass: v >= 9 && v <= 13 && s >= 4 && t === 0 && q === 0 }; } });
  list.push({ name: 'Dash: never crashes while music is heard', run: () => {
    let scr = 0, fl = 0, crashes = 0, jumps = 0, hops = 0, dist = 0;
    for (const eff of [0.3, 0.6, 0.9, 1]) { const d = new DashSim(); let acc = 0;
      for (let t = 0; t < 300; t += 1 / 60) { acc += 1 / 60; let on = 0; if (acc >= 0.37 + 0.3 * d.rnd()) { acc = 0; on = 1; } d.update(1 / 60, { running: true, music: true, eff: eff, onsets: on, progress: t / 300 }); }
      scr += d.scrapes; fl += d.floats; crashes += d.attempts - 1; jumps += d.jumps; hops += d.used.hop || 0; dist += d.x; }
    return { name: 'Dash: never crashes while music is heard', expect: 'no crash, no touch and never standing on air, at any speed, over 20 minutes; notes add hops',
      got: crashes + ' crashes, ' + scr + ' touches, ' + fl + ' steps on air, ' + jumps + ' jumps (' + hops + ' on notes), ' + Math.round(dist) + ' cube lengths run', pass: scr === 0 && fl === 0 && crashes === 0 && jumps > 400 && hops > 300 }; } });
  list.push({ name: 'Dash: every kind of piece, cleared at any frame rate', run: () => {
    const d = new DashSim(), steps = [1 / 60, 1 / 30, 0.1, 1 / 144, 0.05]; let acc = 0, t = 0;
    for (let k = 0; t < 600; k++) { const dt = steps[k % 5]; t += dt; acc += dt; let on = 0; if (acc >= 0.45) { acc = 0; on = 1; }
      d.update(dt, { running: true, music: true, eff: [0.3, 0.6, 0.9, 1][Math.floor(t / 40) % 4], onsets: on, progress: t / 400 }); }
    const pieces = DASH_PIECES.map(q => q[0]).filter(k => !d.built[k]), moves = ['jump', 'hop', 'pad', 'orb', 'fall'].filter(k => !d.used[k]);
    return { name: 'Dash: every kind of piece, cleared at any frame rate', expect: 'all ' + DASH_PIECES.length + ' kinds of piece laid and every kind of move taken, with no crash, no touch and never standing on air while frames come unevenly',
      got: (pieces.length ? 'never laid: ' + pieces.join(', ') : 'all pieces laid') + ', ' + (moves.length ? 'never taken: ' + moves.join(', ') : 'all moves taken') + ', ' + (d.attempts - 1) + ' crashes, ' + d.scrapes + ' touches, ' + d.floats + ' steps on air',
      pass: !pieces.length && !moves.length && d.attempts === 1 && d.scrapes === 0 && d.floats === 0 }; } });
  list.push({ name: 'Dash: silence crashes once after the grace time, short gaps do not', run: () => {
    const d = new DashSim(), ev = []; let tCrash = -1, x1, x2;
    const run = (sec, music) => { for (let t = 0; t < sec; t += 1 / 60) { d.update(1 / 60, { running: true, music: music, eff: 0.9, onsets: 0, progress: 0 }); while (d.events.length) { const e = d.events.shift(); if (e !== 'jump' && e !== 'land') ev.push(e); if (e === 'crash' && tCrash < 0) tCrash = clock; } clock += 1 / 60; } };
    let clock = 0; run(10, true); run(2, false); run(6, true); const mark = clock; run(12, false); const after = d.attempts; x1 = d.x; run(3, true); x2 = d.x;
    for (let t = 0; t < 5; t += 1 / 60) d.update(1 / 60, { running: false, music: true, eff: 0.9, onsets: 1, progress: 0 }); const frozen = d.x === x2;
    const ok = ev.filter(e => e === 'crash').length === 1 && Math.abs(tCrash - mark - DASH.GRACE) < 0.4 && after === 2 && x2 > x1 + 5 && frozen && d.scrapes === 0;
    return { name: 'Dash: silence crashes once after the grace time, short gaps do not', expect: 'a 2 s gap is survived; a long silence crashes once, ' + DASH.GRACE + ' s in; it runs again with the music; pause freezes it',
      got: 'crashes ' + ev.filter(e => e === 'crash').length + (tCrash >= 0 ? ', ' + (tCrash - mark).toFixed(1) + ' s into the silence' : '') + ', attempt ' + after + ', ' + (x2 > x1 + 5 ? 'ran on' : 'stuck') + ', ' + (frozen ? 'pause holds' : 'moved while paused'), pass: ok }; } });
  list.push({ name: 'Dash: silence anywhere on the course', run: () => {
    const at = { ground: 0, platform: 0, air: 0 }, wrong = []; let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 48; k++) {
      const d = new DashSim(), eff = [0.3, 0.6, 0.9, 1][k % 4], progress = [0, 0.15, 0.35, 0.7][(k >> 2) % 4]; let clock = 0, crashes = 0, tCrash = -1;
      const run = (sec, music) => { for (let t = 0; t < sec; t += 1 / 60) { d.update(1 / 60, { running: true, music: music, eff: eff, onsets: music && Math.round(clock * 60) % 25 === 0 ? 1 : 0, progress: progress });
        clock += 1 / 60; while (d.events.length) if (d.events.shift() === 'crash') { crashes++; if (tCrash < 0) tCrash = clock; } } };
      const where = () => at[d.arc ? 'air' : d.y > 0 ? 'platform' : 'ground']++;
      run(3 + (k * 2.71) % 17, true); where(); run(2, false); const c1 = crashes; run(3 + (k * 1.37) % 5, true);
      where(); const mark = clock; run(7, false); const c2 = crashes - c1, x1 = d.x; run(4, true);
      if (tCrash >= 0) { lo = Math.min(lo, tCrash - mark); hi = Math.max(hi, tCrash - mark); }
      if (c1 || c2 !== 1 || Math.abs(tCrash - mark - DASH.GRACE) >= 0.4 || d.x < x1 + 10 || d.scrapes || d.floats)
        wrong.push('#' + k + ': ' + c1 + '+' + c2 + ' crashes' + (tCrash >= 0 ? ' at ' + (tCrash - mark).toFixed(1) + ' s' : '') + ', ' + d.scrapes + ' touches, ' + d.floats + ' on air');
    }
    return { name: 'Dash: silence anywhere on the course', expect: 'wherever the music stops (on the ground, up on a platform, in mid-air), a 2 s gap is survived and a long silence crashes once, ' + DASH.GRACE + ' s in; then it runs on with no touch',
      got: (at.ground + at.platform + at.air) + ' silences (' + at.ground + ' on the ground, ' + at.platform + ' on a platform, ' + at.air + ' in the air), crashes ' + lo.toFixed(1) + ' to ' + hi.toFixed(1) + ' s in' + (wrong.length ? '; wrong: ' + wrong.slice(0, 3).join('; ') : ''),
      pass: !wrong.length && at.platform > 0 && at.air > 0 }; } });
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
  // Grand Prix
  const gpRun = (s, sec, inp, dt) => { dt = dt || 0.05; for (let t = 0; t < sec - 1e-9; t += dt) { if (inp.state === 'running' && inp.music) inp.play = (inp.play || 0) + dt; s.update(dt, inp); s.move(dt); } };
  const gpStart = s => { const inp = { state: 'running', music: true, recent: 1, play: 0 }; for (let i = 0; i < 200 && s.mode !== 'race'; i++) gpRun(s, 0.1, inp); return inp; };
  list.push({ name: 'Grand Prix: the start lights', run: () => {
    const s = new RaceSim(); s.reset(1800, 3); const ev = [], inp = { state: 'running', music: true, recent: 1, play: 0 }, take = () => { while (s.events.length) ev.push(s.events.shift()); };
    gpRun(s, 3.02, inp); take(); const a = s.lit; inp.music = false; gpRun(s, 3, inp); take(); const b = s.lit, mb = s.mode, d0 = s.dist;
    inp.music = true; gpRun(s, 2.02, inp); take(); const c = s.lit; gpRun(s, 2, inp); take();
    const ok = a === 3 && b === 3 && mb === 'lights' && d0 === 0 && c === 5 && s.mode === 'race' && ev.filter(e => e === 'light').length === 5 && ev.filter(e => e === 'go').length === 1;
    return { name: 'Grand Prix: the start lights', expect: 'a light for each second of playing, none while quiet and the cars still, then lights out once', got: 'lights ' + a + ', ' + b + ' (' + mb + '), ' + c + ', then ' + s.mode + '; events ' + ev.join(' '), pass: ok }; } });
  list.push({ name: 'Grand Prix: speed is the last minute', run: () => {
    const s = new RaceSim(); s.reset(1800, 5); const inp = gpStart(s); inp.recent = 0.75; const d0 = s.dist;
    gpRun(s, 120, inp); const want = 0.75 * RACE.VNOM * 120, kmh = s.v * 300 / RACE.VNOM;
    inp.recent = 0; gpRun(s, 10, inp); const stopped = s.v, d1 = s.dist;
    const ok = Math.abs(s.dist - d0 - want) < 1 && Math.abs(kmh - 225) < 1 && stopped === 0 && d1 === s.dist && s.lap === 1 + Math.floor(s.dist / RACE.LAPU);
    return { name: 'Grand Prix: speed is the last minute', expect: 'at 75% of the last minute the car runs at 225 km/h and covers 75% of full-speed distance; at 0% it stops',
      got: Math.round((s.dist - d0) / want * 1000) / 10 + '% of the distance expected, ' + Math.round(kmh) + ' km/h, then ' + Math.round(stopped) + ' km/h at 0%, lap ' + s.lap, pass: ok }; } });
  list.push({ name: 'Grand Prix: a pause freezes the race and parks the car in the pit lane', run: () => {
    const s = new RaceSim(); s.reset(1800, 9); const inp = gpStart(s); inp.recent = 0.8; gpRun(s, 60, inp);
    const pos = s.pos, mine = s.dist, theirs = s.cars.map(c => c.dist).join(), ev = [];
    inp.state = 'paused'; gpRun(s, 1, inp); const red = s.mode; gpRun(s, 300, inp, 0.5); while (s.events.length) ev.push(s.events.shift());
    const frozen = s.dist === mine && s.cars.map(c => c.dist).join() === theirs, boxed = s.pit && s.pit.phase === 'box' && s.v === 0 && Math.abs(s.x - 1.48) < 0.05;
    inp.state = 'running'; s.update(0, inp); const back = s.mode, samePos = s.pos === pos; gpRun(s, 12, inp); while (s.events.length) ev.push(s.events.shift());
    const ok = red === 'red' && frozen && boxed && back === 'race' && samePos && !s.pit && Math.abs(s.x) < 0.7 && ['red', 'box', 'green', 'release', 'exit'].every(e => ev.includes(e));
    return { name: 'Grand Prix: a pause freezes the race and parks the car in the pit lane', expect: 'red flag; no car moves on while paused; the car waits in its box; on resume it rejoins in the same place and leaves the pit lane',
      got: red + ', ' + (frozen ? 'frozen' : 'moved') + ', ' + (boxed ? 'in the box' : 'not in the box') + ', back in ' + back + ' at P' + s.pos + ' (P' + pos + ' before), ' + (s.pit ? 'still in the pit lane' : 'out of the pit lane') + '; ' + ev.join(' '), pass: ok }; } });
  list.push({ name: 'Grand Prix: the car keeps to the pit lane, in and out', run: () => {
    const s = new RaceSim(); s.reset(1800, 11); const inp = gpStart(s); inp.recent = 0.9; gpRun(s, 30, inp); s.x = s.tx = -0.5;   // on the far side of the track when the flag comes out
    let worst = 0, off = 0, last = s.x, joined = null, boxOk = false, m0 = null, moved = false; const step = (sec, state) => { inp.state = state;
      for (let t = 0; t < sec; t += 1 / 60) { s.update(1 / 60, inp); s.move(1 / 60);
        const pa = (s.d + RACE.PZ) / RACE.SEG, lane = s.inPit ? s.pitX(pa) : null;
        if (lane != null && Math.abs(s.x - lane) > 1e-9) off++;
        worst = Math.max(worst, Math.abs(s.x - last)); last = s.x;
        if (s.pit && s.pit.phase === 'box') boxOk = s.pit.boxSeg >= s.pit.a + RACE_PIT.IN + 12;
        if (s.pit) { if (m0 == null) m0 = s.pit.m0; else if (s.pit.m0 !== m0) moved = true; }
        if (joined == null && s.pit && s.pit.exitAt) joined = s.x; } };
    step(6, 'paused'); step(14, 'running');
    const ok = off === 0 && worst < 0.05 && boxOk && !moved && joined != null && Math.abs(joined - RACE_PIT.JOIN) < 0.05 && !s.pit && Math.abs(s.x) <= RACE.APEX;
    return { name: 'Grand Prix: the car keeps to the pit lane, in and out', expect: 'the car follows the middle of the pit lane all the way, with no sudden sideways step; the box is past the bend in; where the lane bends out is set when the car turns in (so the garages stay put); it joins the track on the right and races on',
      got: (off ? off + ' frames off the lane' : 'always on the lane') + ', largest sideways step ' + worst.toFixed(3) + ' a frame, box ' + (boxOk ? 'past the bend' : 'too early') + ', joined at ' + (joined == null ? 'never' : joined.toFixed(2)) + ', ' + (s.pit ? 'still in the pit lane' : 'back racing at ' + s.x.toFixed(2)), pass: ok }; } });
  list.push({ name: 'Grand Prix: the racing line puts the inside tyres on the kerb at every corner', run: () => {
    const T = raceTrack(), L = T.line, N = T.n, half = 380 / RACE.ROADW, bad = []; let n = 0, step = 0;   // half the car's width, in road half-widths
    for (let i = 0; i < N; i++) step = Math.max(step, Math.abs(L[(i + 1) % N] - L[i]));
    for (let i = 0; i < N;) { if (Math.abs(T.curve[i]) <= RACE.KERB) { i++; continue; } const sg = Math.sign(T.curve[i]); let e = i, best = -9;
      while (e < N && Math.abs(T.curve[e]) > RACE.KERB && Math.sign(T.curve[e]) === sg) { best = Math.max(best, sg * L[e]); e++; }
      n++; if (best + half < 0.97) bad.push('corner at ' + i + ' reaches ' + (best + half).toFixed(2)); i = e; }
    // and the car keeps to it: a lap alone at full speed
    const s = new RaceSim(); s.reset(1800, 2); const inp = gpStart(s); s.cars = []; let off = 0;
    for (let t = 0; t < 40; t += 1 / 60) { s.update(1 / 60, inp); s.move(1 / 60); const pa = (s.d + RACE.PZ) / RACE.SEG; if (t > 6) off = Math.max(off, Math.abs(s.x - s.lineAt(pa))); }
    const ok = n >= 10 && !bad.length && Math.max(...L) <= RACE.APEX + 1e-6 && Math.min(...L) >= -RACE.APEX - 1e-6 && step < 0.07 && off < 0.08;
    return { name: 'Grand Prix: the racing line puts the inside tyres on the kerb at every corner', expect: 'at every corner the inside tyres reach the kerb (0.97 road half-widths out), the line stays on the road and bends smoothly, and the car keeps to it',
      got: n + ' corners' + (bad.length ? ', ' + bad.join('; ') : ', every one on the kerb') + ', largest step ' + step.toFixed(3) + ' a segment, car at most ' + off.toFixed(3) + ' off the line', pass: ok }; } });
  list.push({ name: 'Grand Prix: the same field however time is cut up', run: () => {
    const a = new RaceSim(), b = new RaceSim(); a.reset(1800, 42); b.reset(1800, 42);
    for (const s of [a, b]) { s.mode = 'race'; s.st = 'running'; }
    for (let i = 0; i < 300; i++) a.update(1, { state: 'running', music: true, recent: 0.8, play: i });
    for (let t = 0; t < 300 - 1e-9; t += 0.046) b.update(Math.min(0.046, 300 - t), { state: 'running', music: true, recent: 0.8, play: t });
    const worst = Math.max(...a.cars.map((c, i) => Math.abs(c.dist - b.cars[i].dist) / c.dist));
    return { name: 'Grand Prix: the same field however time is cut up', expect: 'one-second steps and 46 ms steps give the rivals the same distances (a following device races the same field)',
      got: 'largest difference ' + (worst * 100).toFixed(4) + '%', pass: worst < 1e-6 }; } });
  list.push({ name: 'Grand Prix: the steadier the session, the better the chance of first place', run: () => {
    const E = [0.7, 0.8, 0.9], wins = E.map(() => 0), place = E.map(() => 0), N = 60;
    for (let k = 0; k < N; k++) {
      const s = new RaceSim(); s.reset(600, 1000 + k * 7919); s.mode = 'race'; s.st = 'running';
      for (let t = 0; t < 600; t++) s.update(1, { state: 'running', music: true, recent: 0, play: 0 });   // the rivals race; you stand still, then are placed at each efficiency
      E.forEach((e, j) => { const mine = e * RACE.VNOM * 600, ahead = s.cars.filter(c => c.dist > mine).length; if (!ahead) wins[j]++; place[j] += 1 + ahead; });
    }
    const p = wins.map(w => w / N), avg = place.map(x => x / N);
    const ok = p[0] <= 0.15 && p[1] >= 0.25 && p[1] <= 0.75 && p[2] >= 0.8 && p[0] < p[1] && p[1] < p[2] && avg[0] > avg[1] && avg[1] > avg[2];
    return { name: 'Grand Prix: the steadier the session, the better the chance of first place', expect: 'in 10-minute races, first place rarely at 70% efficiency, about half the time at 80%, nearly always at 90%',
      got: E.map((e, j) => Math.round(e * 100) + '%: P1 in ' + Math.round(p[j] * 100) + '%, average P' + avg[j].toFixed(1)).join('; '), pass: ok }; } });
  // Fireworks
  const fwRun = (s, secs, inp, notesPerSec) => { const ev = []; let owed = 0;
    for (let t = 0; t < secs - 1e-9; t += 0.05) { owed += (notesPerSec || 0) * 0.05; const n = Math.floor(owed + 1e-9); owed -= n;
      s.update(0.05, Object.assign({}, inp, { notes: n })); while (s.events.length) ev.push(s.events.shift()); }
    return ev; };
  list.push({ name: 'Fireworks: only playing sends shells up', run: () => {
    const s = new FireworkSim(); s.reset(1800, 3);
    const a = fwRun(s, 20, { state: 'paused', music: true, midi: 60, recent: 0.8, play: 0 }, 1).length,
      b = fwRun(s, 20, { state: 'running', music: false, midi: 60, recent: 0.8, play: 0 }, 1).length,
      c = fwRun(s, 20, { state: 'stopped', music: true, midi: 60, recent: 0.8, play: 0 }, 1).length,
      d = fwRun(s, 20, { state: 'running', music: true, midi: 60, recent: 0, play: 0 }, 1).filter(e => e.k === 'shell').length;
    return { name: 'Fireworks: only playing sends shells up', expect: 'none while paused, quiet or stopped, however intense; with no intensity, one for each note played (20 notes, 20 shells)',
      got: a + ' paused, ' + b + ' quiet, ' + c + ' stopped, ' + d + ' playing; ' + s.shells + ' counted', pass: a === 0 && b === 0 && c === 0 && d === 20 && s.shells === 20 }; } });
  list.push({ name: 'Fireworks: each note is a colour, higher notes burst higher', run: () => {
    const s = new FireworkSim(); s.reset(1800, 5); const shot = midi => { s.tokens = FW.BURST; s.update(0.05, { state: 'running', music: true, notes: 1, midi: midi, recent: 0, play: 0 }); return s.events.pop(); };
    const lo = [], hi = []; for (let k = 0; k < 20; k++) { lo.push(shot(48)); hi.push(shot(84)); }
    const avg = a => a.reduce((x, e) => x + e.h, 0) / a.length, c4 = shot(60), c5 = shot(72), g4 = shot(67);
    const before = s.colours; for (let m = 60; m < 72; m++) shot(m);
    const hues = new Set(); for (let pc = 0; pc < 12; pc++) hues.add(fwHue(pc));
    const ok = c4.hue === c5.hue && c4.hue !== g4.hue && avg(hi) > avg(lo) + 0.2 && before === 2 && s.colours === 12 && hues.size === 12;
    return { name: 'Fireworks: each note is a colour, higher notes burst higher', expect: 'C4 and C5 the same colour, G another; C6 bursts well above C3; twelve notes, twelve colours',
      got: 'C4 ' + c4.hue + ', C5 ' + c5.hue + ', G4 ' + g4.hue + '; height ' + avg(lo).toFixed(2) + ' low, ' + avg(hi).toFixed(2) + ' high; colours ' + before + ' then ' + s.colours + ', ' + hues.size + ' hues', pass: ok }; } });
  list.push({ name: 'Fireworks: fast scales do not flood the sky', run: () => {
    const s = new FireworkSim(); s.reset(1800, 7);
    const ev = fwRun(s, 10, { state: 'running', music: true, midi: 64, recent: 1, play: 0 }, 12).filter(e => e.k === 'shell');
    const cap = (FW.RATE + FW.PER) * 10 + FW.BURST + FW.BURSTPER, big = ev.filter(e => e.size > 1.01).length;
    return { name: 'Fireworks: fast scales do not flood the sky', expect: '12 notes a second for 10 s sends up at most ' + cap + ' shells, the notes over that making shells bigger',
      got: ev.length + ' shells for 120 notes, ' + big + ' bigger than full size', pass: ev.length <= cap && ev.length >= cap - 6 && big > 0 }; } });
  list.push({ name: 'Fireworks: the last minute sets the size and the kinds', run: () => {
    const kinds = recent => { const s = new FireworkSim(); s.reset(1800, 11); const ev = fwRun(s, 60, { state: 'running', music: true, midi: 62, recent: recent, play: 0 }, 1);
      return { size: ev.reduce((x, e) => x + e.size, 0) / ev.length, kinds: new Set(ev.map(e => e.kind)) }; };
    const lo = kinds(0.2), mid = kinds(0.5), hi = kinds(0.9);
    const ok = hi.size > mid.size && mid.size > lo.size && lo.kinds.size === 1 && lo.kinds.has('peony') && !mid.kinds.has('willow') && mid.kinds.has('ring') && hi.kinds.has('willow') && hi.kinds.size >= 5 && fwCalibre(0.2) < fwCalibre(0.9) && fwCalibre(1) === 12;
    return { name: 'Fireworks: the last minute sets the size and the kinds', expect: 'bigger shells with more of the last minute played; round ones only at 20%, rings at 50%, willows and more at 90%',
      got: [['20%', lo], ['50%', mid], ['90%', hi]].map(p => p[0] + ': size ' + p[1].size.toFixed(2) + ', ' + [...p[1].kinds].sort().join(' ')).join('; '), pass: ok }; } });
  list.push({ name: 'Fireworks: a held note still sends shells up', run: () => {
    const s = new FireworkSim(); s.reset(1800, 13); const ev = fwRun(s, 20, { state: 'running', music: true, midi: 55, recent: 0.7, play: 0 }, 0).filter(e => e.k === 'shell');
    const want = FW.PACE * 0.7 * 20, same = ev.every(e => e.pc === 7);
    return { name: 'Fireworks: a held note still sends shells up', expect: 'the pace of the intensity (about ' + Math.round(want) + ' in 20 s of one long G at 70%), all in its colour',
      got: ev.length + ' shells' + (same ? ', all G' : ', not all G'), pass: same && ev.length >= want - 2 && ev.length <= want + 1 }; } });
  list.push({ name: 'Fireworks: the higher the intensity, the more shells in the sky at once', run: () => {
    const E = [0.2, 0.5, 0.9], slow = [], fast = [];
    for (const [rate, out] of [[1, slow], [8, fast]]) for (const e of E) { const s = new FireworkSim(); s.reset(1800, 21); let sum = 0, n = 0, owed = 0;
      for (let t = 0; t < 60; t += 0.05) { owed += rate * 0.05; const k = Math.floor(owed + 1e-9); owed -= k; s.update(0.05, { state: 'running', music: true, notes: k, midi: 64, recent: e, play: t }); s.events.length = 0; if (t > 10) { sum += s.aloft; n++; } }
      out.push(sum / n); }
    const up = a => a[0] < a[1] && a[1] < a[2], ok = up(slow) && up(fast) && slow[2] >= slow[0] * 2 && fast[2] >= fast[0] * 2;
    return { name: 'Fireworks: the higher the intensity, the more shells in the sky at once', expect: 'more shells aloft at 50% than 20%, more again at 90% (at least twice as many as at 20%), for slow notes and fast runs alike',
      got: E.map((e, j) => Math.round(e * 100) + '%: ' + slow[j].toFixed(1) + ' (1 note/s), ' + fast[j].toFixed(1) + ' (8 notes/s)').join('; '), pass: ok }; } });
  list.push({ name: 'Fireworks: a grand finale at the goal, once, ending in a trophy', run: () => {
    const s = new FireworkSim(); s.reset(60, 17); const ev = [], take = () => { while (s.events.length) ev.push(s.events.shift()); };
    const run = (secs, st, shown, t0) => { for (let t = 0; t < secs - 1e-9; t += 0.05) { s.update(0.05, { state: st, music: false, notes: 0, midi: null, recent: 0.8, play: t0 + t, shown: shown }); take(); } };
    run(70, 'running', false, 0); const away = ev.length;                            // the goal passes on another theme: the finale waits
    run(4, 'running', true, 70); const early = ev.filter(e => e.finale).length;
    run(5, 'paused', true, 74); const paused = ev.filter(e => e.finale).length;
    run(20, 'running', true, 74);
    const starts = ev.filter(e => e.k === 'finale').length, shells = ev.filter(e => e.finale), ends = ev.filter(e => e.k === 'finaleEnd').length;
    const last = shells[shells.length - 1], endAt = ev.findIndex(e => e.k === 'finaleEnd'), lastAt = ev.indexOf(last);
    const ok = away === 0 && starts === 1 && shells.length === FW.FINALE && last.kind === 'trophy' && ends === 1 && endAt > lastAt && early > 0 && early < FW.FINALE && paused === early && s.shells === 0 && !s.inFinale;
    return { name: 'Fireworks: a grand finale at the goal, once, ending in a trophy', expect: 'nothing while the theme is not shown; then one finale of ' + FW.FINALE + ' shells, held through a pause, the last a trophy, then the end of the finale (for the trophy card); not counted as the player\'s shells',
      got: away + ' events away, ' + starts + ' finale, ' + shells.length + ' shells (' + early + ' before the pause, ' + paused + ' after it), last ' + (last && last.kind) + ', ' + ends + ' end' + (endAt > lastAt ? ' after it' : ' before it') + ', ' + s.shells + ' counted', pass: ok }; } });
  list.push({ name: 'Fireworks: the trophy burst is a trophy', run: () => {
    const p = fwTrophyShape(0.05), xs = p.map(q => q[0]), ys = p.map(q => q[1]), key = q => Math.round(q[0] * 20) + ',' + Math.round(q[1] * 20), set = new Set(p.map(key));
    const mirrored = p.filter(q => set.has(Math.round(-q[0] * 20) + ',' + Math.round(q[1] * 20))).length / p.length;
    const rim = p.filter(q => q[1] > 0.74).length, base = p.filter(q => q[1] < -0.74).length, handles = p.filter(q => Math.abs(q[0]) > 0.7).length, stem = p.filter(q => q[1] < -0.05 && q[1] > -0.44).length;
    const ok = p.length >= 100 && p.length <= 200 && Math.min(...ys) >= -0.76 && Math.max(...ys) <= 0.76 && Math.max(...xs.map(Math.abs)) <= 0.8 && mirrored > 0.95 && rim > 15 && base > 12 && handles > 4 && stem >= 14;
    return { name: 'Fireworks: the trophy burst is a trophy', expect: '100 to 200 points, the same on both sides, 1.5 high and under 1.6 wide, with a rim, handles, a stem and a base',
      got: p.length + ' points, ' + Math.round(mirrored * 100) + '% mirrored, ' + (Math.max(...ys) - Math.min(...ys)).toFixed(2) + ' high, ' + (Math.max(...xs) - Math.min(...xs)).toFixed(2) + ' wide; rim ' + rim + ', handles ' + handles + ', stem ' + stem + ', base ' + base, pass: ok }; } });
  list.push({ name: 'Session: the last minute, a second at a time', run: () => {
    const s = new Session(); s.start(); for (let i = 0; i < 30; i++) s.tick(1, true); for (let i = 0; i < 10; i++) s.tick(1, false);
    const m = s.minute, ok = m.length === 60 && m.slice(0, 20).every(v => v === null) && m.slice(20, 50).every(v => v === 1) && m.slice(50).every(v => v === 0);
    return { name: 'Session: the last minute, a second at a time', expect: '20 empty seconds, 30 played, 10 quiet', got: m.map(v => v == null ? '.' : v >= 0.5 ? '#' : '_').join(''), pass: ok }; } });
  list.push({ name: 'Themes: the player turns off the ones they don\'t like', run: () => {
    const all = ['classic', 'rocket', 'city', 'dash', 'race', 'fireworks'];
    const got = [themesOn(all, '').join(' '), themesOn(all, 'city,dash').join(' '), themesOn(all, 'classic,rocket,city,dash,race,fireworks').join(' '), themesOn(all, 'space,dash').join(' '),
      themeSwitch(all, '', 'city', false), themeSwitch(all, 'city', 'classic', false), themeSwitch(all, 'classic,city', 'city', true), themeSwitch(all, 'rocket,city,dash', 'race', false),
      themeSwitch(all, 'space', 'rocket', false), themeLanding(['classic', 'dash'], 'rocket'), themeLanding(['classic', 'rocket', 'city'], 'dash'), themeLanding(['classic', 'city'], 'city'), themeLanding(['classic'], 'gone'), themeSwitch(all, 'rocket', 'fireworks', false), themeLanding(['classic', 'fireworks'], 'fireworks')];
    const want = ['classic rocket city dash race fireworks', 'classic rocket race fireworks', 'classic', 'classic rocket city race fireworks', 'city', 'city', '', 'rocket,city,dash,race', 'rocket', 'classic', 'classic', 'city', 'classic', 'rocket,fireworks', 'fireworks'];
    return { name: 'Themes: the player turns off the ones they don\'t like', expect: 'off themes leave the list, unknown ids are ignored, Classic is always on, and a theme turned off lands on the first one on, Classic (' + want.join(' | ') + ')',
      got: got.join(' | '), pass: got.every((g, i) => g === want[i]) }; } });
  return list;
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
/* what is saved for a finished session: its times and its report, rounded so the log stays small (no audio) */
function sessionRecord(s, R, name, rocket) {
  const round = (k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return { v: 1, id: s.startedAt, start: s.startedAt, end: s.stoppedAt || s.startedAt + Math.round(R.total * 1000), goal: s.goal,
    play: Math.round(R.play * 1000) / 1000, eff: Math.round(R.efficiency * 1000) / 1000, name: name || '', R: JSON.parse(JSON.stringify(R, round)), rocket: rocket || null };
}
/* the rocket flight to carry on today: where the day's latest saved session left it (null to start on the pad, as on a new day).
   from: when a new flight was last started; sessions that had ended by then no longer carry on, while one still running then does */
function rocketCarry(records, now, from) {
  const k = dayKey(now); let last = null;
  for (const r of records) if (dayKey(r.start) === k && !(from > 0 && (r.end || r.start) <= from) && (!last || r.start > last.start)) last = r;
  return last && last.rocket || null;
}
const worthKeeping = R => R.play >= KEEP_PLAY;
/* a session cut short: if the app is closed or iOS discards it mid-session, the session so far is still there next time.
   liveSnapshot is what is kept while it runs (now: when, rocket: RocketSim.save()); liveRecord turns it back into a saved record, or null */
function liveSnapshot(s, name, rocket, now) {
  return { v: 1, startedAt: s.startedAt, savedAt: now, goal: s.goal, name: name || '', rocket: rocket || null, runs: s.runs.map((x, i) => i % 2 ? Math.round(x * 100) / 100 : x) };
}
function liveRecord(x) {
  if (!x || x.v !== 1 || !(x.startedAt > 0) || !(x.savedAt >= x.startedAt) || !(x.goal > 0) || !Array.isArray(x.runs) || x.runs.length % 2) return null;
  for (let i = 0; i < x.runs.length; i += 2) if ([0, 1, 2].indexOf(x.runs[i]) < 0 || !(x.runs[i + 1] >= 0)) return null;
  const R = sessionReport(x.runs);
  return sessionRecord({ startedAt: x.startedAt, stoppedAt: x.savedAt, goal: x.goal }, R, typeof x.name === 'string' ? x.name : '', x.rocket && typeof x.rocket === 'object' ? x.rocket : null);
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
  const today = D.key === dayKey(now), when = today ? 'today' : 'that day', latest = D.n === D.count;
  const text = today && latest ? (ORDINALS[D.n - 1] ? 'This was your ' + ORDINALS[D.n - 1] + ' session today.' : 'This was session ' + D.n + ' today.') : 'This was session ' + D.n + ' of ' + D.count + ' ' + when + '.';
  return { lead: durationText(D.play) + ' of music ' + when + '.', text: text };
}
/* 4500 -> "1 h 15 min", 600 -> "10 min", 40 -> "40 s" */
function durationText(s) { s = Math.max(0, Math.round(s)); if (s < 60) return s + ' s'; const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
/* the encouraging line on the practice log, and its partner about the week. Low pressure: they only ever count what was played,
   never days missed or a streak to keep, so coming back after a break reads as good news rather than something lost */
function practiceNudge(P) {
  if (!P.sessions) return '';
  if (P.practicedToday) return 'Lovely playing today. Come back whenever you feel like it.';
  const n = P.week.filter(c => c.play > 0).length;
  if (n) return 'You have played ' + (n === 1 ? 'once' : 'on ' + n + ' days') + ' this week. Nice work.';
  return 'Welcome back. Even a few minutes of playing is worth it.';
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
function homeCopy(P, last, now, o) {
  o = o || {};
  const day = new Date(now), h = day.getHours(), r = o.seed ? rng(o.seed) : null, pick = a => a[r ? Math.floor(r() * a.length) : 0];
  // the greeting: the time of day comes first (and with no seed is the one used), then the playful ones, which may name the day too
  const hellos = [h < 12 ? 'Good morning, {name}' : h < 18 ? 'Good afternoon, {name}' : 'Good evening, {name}', h < 12 ? 'Rise and shine, {name}' : 'Happy ' + WEEKDAYS[day.getDay()] + ', {name}'].concat(HOME_HELLO);
  // with no name, a title the greeting has ("Captain") is the word for the player; else one of HOME_FRIEND (picked either way, so a name never changes the other words)
  const name = String(o.name || '').trim(), said = pick(hellos), other = pick(HOME_FRIEND), title = said.slice(said.lastIndexOf(', ') + 2).replace('{name}', '').trim();
  const friend = name ? undefined : title || other, hello = name ? said.replace('{name}', name) : title ? said.replace(/ \{name\}$/, '') : said.replace('{name}', other);
  if (!P.sessions || !last) return { kind: 'first', hello: hello, friend: friend, head: pick(HOME_WORDS.first.head), lede: 'It counts only the time the microphone hears you play.' };
  // a session that started before midnight and ended today still counts as playing today here (it is filed under the day it started)
  const lateLast = !P.practicedToday && dayKey(last.end || last.start) === dayKey(now);
  if (P.practicedToday || lateLast) { const t = P.today, n = t.sessions, play = lateLast ? last.play : t.play;
    return { kind: 'today', hello: hello, friend: friend, head: pick(HOME_WORDS.today.head), lede: 'You played for ' + durationText(play) + ' today' + (!lateLast && n > 1 ? ', in ' + n + ' sessions' : '') + '. ' + pick(HOME_WORDS.today.then),
      note: 'All together: ' + durationText(P.totalPlay) + ' of music.' }; }
  if (P.weekPlay > 0) { const days = Math.round((dayStart(now) - dayStart(last.start)) / 864e5), when = days <= 1 ? 'yesterday' : 'on ' + WEEKDAYS[new Date(last.start).getDay()];
    const d = P.week.find(c => c.key === dayKey(last.start)), n = d ? d.sessions : 1;   // every session that day, not only the last
    return { kind: 'week', hello: hello, friend: friend, head: pick(HOME_WORDS.week.head), lede: pick(HOME_WORDS.week.lede),
      note: n > 1 ? 'You last played ' + when + ', ' + durationText(d.play) + ' in ' + n + ' sessions.' : 'Your last session was ' + when + ', ' + durationText(last.play) + '.' }; }
  return { kind: 'back', hello: hello, friend: friend, head: pick(HOME_WORDS.back.head), lede: pick(HOME_WORDS.back.lede),
    fresh: 'A fresh week. Whenever you play, it shows up here.', note: 'So far you have made ' + durationText(P.totalPlay) + ' of music with Music Timer.' };
}
function weekLine(P) {
  let s = 'This week: ' + durationText(P.weekPlay) + ' of playing';
  if (P.lastWeekPlay <= 0) return s + '.';
  const d = P.weekPlay - P.lastWeekSoFar;
  if (P.weekPlay >= P.lastWeekPlay) return s + ', ' + (P.weekPlay - P.lastWeekPlay >= 60 ? durationText(P.weekPlay - P.lastWeekPlay) + ' more than all of last week.' : 'as much as all of last week.');
  if (d >= 60) return s + ', ' + durationText(d) + ' ahead of last week at this point.';
  return s + '.';                                                   // behind last week: no catching up to do, just this week's playing
}

/* ---------- Sample practice logs for the debug tools: made-up sessions, never saved, to see each page as it looks after some use ---------- */
const SAMPLE_LOGS = [['first', 'First visit'], ['today', 'Played today'], ['week', 'Played this week'], ['back', 'Back after a break'], ['months', 'Three months']];
/* a saved rocket flight fp seconds of playing in (as RocketSim.save gives it), or null below the edge of space, where it would start on the pad */
function rocketAt(fp) {
  if (!(fp >= MILESTONES.space)) return null;
  const sim = new RocketSim();
  if (fp < MILESTONES.orbit) return { mode: 'ascent', fp: fp, l: Math.round(sim.lenAt(fp) * 1e7) / 1e7, stage: fp >= MILESTONES.stage2 ? 2 : 1, inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 0 };
  return { mode: 'orbit', fp: fp, l: sim.L, stage: 2, inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 60 };
}
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
    out.push(sessionRecord({ startedAt: start, stoppedAt: start + Math.round(R.total * 1000), goal: goal }, R, '', null));
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
  // the rocket of each day's sessions, as if every session that day carried the flight on
  const flown = {}; for (const r of out) { const k = dayKey(r.start); flown[k] = (flown[k] || 0) + r.play; r.rocket = rocketAt(flown[k]); }
  return out;
}

/* ---------- Rocket flight model ---------- */
function pchip(xs, ys, m0, mn) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = m0 == null ? d[0] : m0; m[n - 1] = mn == null ? d[n - 2] : mn;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  return function (x) {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* World units are Earth radii; Earth is centred at (0,0) and the pad is at (0,1).
   Around the pad the proportions are real (a 100 m rocket on a 6371 km planet), and so is the first minute of the climb.
   Higher up the picture is stretched on purpose: the rocket is drawn pulling away from Earth much faster than the altitude
   read-out says, so that by the edge of space (SPACE) the whole planet is in view, small and distant. */
const KM = 1 / 6371;
const WORLD = { ROCKET_H: 0.1 * KM, SPACE: 4.0, MOON: { x: 6.2, y: 12.4, r: 0.62 }, ORBIT: 1.0 };
/* Flight timeline, in seconds of playing since ignition (E0). Each step is measured from the one before:
   E1 clear the tower +10 s, E2 stage 1 separation +3 min, E3 leave the atmosphere +3 min,
   E4 stage 2 separation +4 min, E5 reach Moon orbit +20 min, E6 send the module spinning about its length and keep orbiting. */
const STEPS = [['tower', 10], ['stage1', 180], ['space', 180], ['stage2', 240], ['orbit', 1200]];
const MILESTONES = {}; (function () { let t = 0; for (const s of STEPS) { t += s[1]; MILESTONES[s[0]] = t; } })();
const LIFTOFF = 0.5;   // engine power the rocket needs, held for HOLD seconds, to leave the pad
const HOLD = 3, ORBIT_PERIOD = 60, WRECK = 2.6, SPIN_AT = 3, SPIN_UP = 4, SPIN = 2 * Math.PI * 0.6;   // E6: 3 s after arrival the module starts to roll about its long axis, reaching 0.6 turns a second

class RocketSim {
  constructor() {
    const M = WORLD.MOON, Ro = WORLD.ORBIT, RH = WORLD.ROCKET_H, T = MILESTONES;
    const th0 = this.th0 = Math.atan2(-0.447, 0.894), tx = -Math.sin(th0), ty = Math.cos(th0);   // the path meets the orbit on a tangent
    const P3 = [M.x + Ro * Math.cos(th0), M.y + Ro * Math.sin(th0)], P2 = [P3[0] - tx * 5, P3[1] - ty * 5], P0 = [0, 1], P1 = [0, 6.5];
    const S = 800, xs = this.px = new Float64Array(S + 1), ys = this.py = new Float64Array(S + 1), ls = this.pl = new Float64Array(S + 1);
    for (let i = 0; i <= S; i++) { const t = i / S, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      xs[i] = a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0]; ys[i] = a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1];
      ls[i] = i ? ls[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) : 0; }
    this.S = S; const L = this.L = ls[S];
    /* Distance along the path at each point of the timeline.
       Lift-off is a real one: off the pad at about half a g, past the top of the tower at 10 s (30 m/s), 1.4 km up at 30 s, 5.8 km at 60 s.
       From there the drawn distance grows at a steady rate (the view widens about 2.7% a second) and eases off at the edge of space. */
    const RHs = v => Math.log(v * RH), far = [T.stage2 + 400, T.stage2 + 800], S1 = 0.031, SP = WORLD.SPACE, S2 = 5.2;
    const pad = pchip([0, HOLD, T.tower], [0, 0, 1.15 * RH], 0, 0.306 * RH);
    const climb = pchip([T.tower, 30, 60, T.stage1, T.space], [RHs(1.15), RHs(14.4), RHs(57.7), Math.log(S1), Math.log(SP)], 0.266, 0.00125);
    const cruise = pchip([T.space, T.stage2, far[0], far[1], T.orbit], [SP, S2, S2 + (L - S2) * 0.37, S2 + (L - S2) * 0.72, L], 0.005, 0.004);
    this.lenAt = t => t <= T.tower ? pad(t) : t <= T.space ? Math.exp(climb(t)) : cruise(t);
    this.lTower = 0.95 * RH; this.lStage1 = S1; this.lSpace = SP; this.lStage2 = S2;
    /* altitude read-out: a believable climb in kilometres (40 km at stage 1 separation, 100 km at the edge of space), tied to the same clock */
    const kmT = pchip([0, HOLD, T.tower, 30, 60, T.stage1, T.space], [0, 0, 0.115, 1.44, 5.77, 40, 100], 0, 0.33), kx = [0], ky = [0];
    for (const t of [4, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120, 150, 190, 220, 250, 280, 310, 340, 360, 370]) { kx.push(this.lenAt(t)); ky.push(kmT(t)); }
    this.kmAt = pchip(kx.concat([S2, S2 + (L - S2) * 0.37, S2 + (L - S2) * 0.72, L]), ky.concat([25000, 150000, 290000, 384400]));
    this.wOrbit = 2 * Math.PI / ORBIT_PERIOD;
    this.events = []; this.reset();
  }
  reset() { this.mode = 'pad'; this.l = 0; this.v = 0; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false;
    this.ignited = false; this.lit0 = false; this.fp = 0; this.power = 0; this.g = 0; this.prevT = 0; this.down = 0;
    this.th = this.th0; this.tOrb = 0; this.spinUp = 0; this.spinA = 0; this.events.length = 0; }
  /* where the flight has got to, to carry on in the day's next session. Only a rocket in space or in Moon orbit carries on:
     anywhere below the edge of space (on the pad, climbing or falling) is null, and the next session starts on the pad */
  save() {
    if (this.mode !== 'orbit' && !(this.mode === 'ascent' && this.inSpace)) return null;
    const r = (v, k) => Math.round(v * k) / k;
    return { mode: this.mode, fp: r(this.fp, 1e3), l: r(this.l, 1e7), stage: this.stage, inSpace: this.inSpace, cleared: this.cleared, th: r(this.th, 1e4), tOrb: r(Math.min(this.tOrb, 60), 1e3) };
  }
  /* carry on from save(). False, and on the pad, for anything that is not a saved flight in space or in orbit */
  restore(x) {
    this.reset();
    const n = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    if (!x || (x.mode !== 'orbit' && !(x.mode === 'ascent' && x.inSpace)) || !n(x.fp, HOLD, 1e6) || !n(x.l, 0, this.L) || !n(x.stage, 0, 2) || !n(x.th, -4, 4) || !n(x.tOrb, 0, 1e6)) return false;
    this.mode = x.mode; this.fp = x.fp; this.l = x.l; this.prevT = this.target(x.fp); this.stage = Math.round(x.stage); this.lit0 = true;
    this.inSpace = true; this.cleared = true;
    if (x.mode === 'orbit') { this.l = this.L; this.stage = 2; this.th = x.th; this.tOrb = x.tOrb; this.spinUp = smooth(SPIN_AT, SPIN_AT + SPIN_UP, x.tOrb); }
    return true;
  }
  target(fp) { return this.lenAt(Math.min(MILESTONES.orbit, fp)); }
  /* Advance by dt seconds. inp: {running, playing, eff (0..1), rdt (real seconds, when dt is sped up)}.
     fp is the flight clock: seconds of playing since ignition. */
  update(dt, inp) {
    if (!inp.running || !(dt > 0)) { if (!inp.running) this.ignited = false; return; }
    const eff = inp.eff, was = this.ignited, rdt = inp.rdt > 0 ? inp.rdt : dt; this.power = eff;
    this.hold = eff >= LIFTOFF ? this.hold + dt : 0;
    if (this.mode === 'pad') {
      if (this.down > 0) { this.down -= rdt; this.ignited = false; this.hold = 0; return; }       // wreckage is still being cleared
      this.ignited = eff >= 0.5 || (inp.playing && eff > 0);
      if (this.ignited && !was) { this.events.push('ignition'); this.lit0 = true; }
      if (this.lit0 && inp.playing) this.fp = Math.min(HOLD, this.fp + dt);                        // the clock waits at lift-off
      if (this.ignited && this.hold >= HOLD) { this.mode = 'ascent'; this.prevT = this.target(this.fp); this.v = 0; this.events.push('liftoff'); }
    } else if (this.mode === 'ascent') {
      if (eff < 0.5 && !this.inSpace) { this.mode = 'fall'; this.ignited = false; this.g = Math.max(this.l / 8, 2e-5); this.events.push('fall'); return; }
      this.ignited = eff >= 0.5;
      if (inp.playing) this.fp += dt;
      const tgt = this.target(this.fp), tv = (tgt - this.prevT) / dt, n = Math.max(1, Math.ceil(dt / 0.05)), h = dt / n, w = 1.2;
      for (let i = 0; i < n; i++) { const ti = this.prevT + (tgt - this.prevT) * (i + 1) / n;
        this.v += (w * w * (ti - this.l) + 2 * w * (tv - this.v)) * h; this.l += this.v * h; }
      if (this.l < 0) this.l = 0; if (this.l > this.L) this.l = this.L;
      this.prevT = tgt;
      const T = MILESTONES, fp = this.fp;
      if (!this.cleared && fp >= T.tower && this.l >= this.lTower) { this.cleared = true; this.events.push('tower'); }
      if (this.stage < 1 && fp >= T.stage1 && this.l >= this.lStage1 * 0.97) { this.stage = 1; this.events.push('stage1'); }
      if (!this.inSpace && fp >= T.space && this.l >= this.lSpace * 0.99) { this.inSpace = true; this.events.push('space'); }
      if (this.stage < 2 && fp >= T.stage2 && this.l >= this.lStage2 * 0.97) { this.stage = 2; this.events.push('stage2'); }
      if (fp >= T.orbit && this.l >= this.L - 0.03) { this.mode = 'orbit'; this.l = this.L; this.ignited = false; this.th = this.th0; this.tOrb = 0; this.events.push('orbit'); }
    } else if (this.mode === 'fall') {
      this.v -= this.g * dt; this.l += this.v * dt;
      if (this.l <= 0) { this.l = 0; this.v = 0; this.mode = 'pad'; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false;
        this.lit0 = false; this.fp = 0; this.down = WRECK; this.events.push('crash'); }
    } else if (this.mode === 'orbit') {
      this.ignited = false; this.tOrb += rdt;                                                       // circles the Moon for as long as the session runs
      this.th += (0.004 + (this.wOrbit - 0.004) * smooth(0, 12, this.tOrb)) * rdt;
      if (this.th > Math.PI) this.th -= 2 * Math.PI;
      const was = this.spinUp;                                                                      // E6: the module is sent spinning about its length
      this.spinUp = smooth(SPIN_AT, SPIN_AT + SPIN_UP, this.tOrb);
      if (was === 0 && this.spinUp > 0) this.events.push('spin');
      this.spin(rdt);
    }
  }
  spin(dt) { this.spinA = (this.spinA + SPIN * this.spinUp * dt) % (2 * Math.PI); }
  pose() {
    if (this.mode === 'orbit') { const M = WORLD.MOON, c = Math.cos(this.th), s = Math.sin(this.th), x = M.x + WORLD.ORBIT * c, y = M.y + WORLD.ORBIT * s;
      return { x: x, y: y, ang: Math.atan2(-s, c), alt: Math.max(0, Math.hypot(x, y) - 1) }; }
    const ls = this.pl, l = this.l; let lo = 0, hi = this.S;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ls[mid] <= l) lo = mid; else hi = mid; }
    const seg = ls[hi] - ls[lo], t = seg > 0 ? (l - ls[lo]) / seg : 0;
    const dx = this.px[hi] - this.px[lo], dy = this.py[hi] - this.py[lo];
    const x = this.px[lo] + dx * t, y = this.py[lo] + dy * t;
    return { x: x, y: y, ang: Math.atan2(dx, dy), alt: Math.max(0, Math.hypot(x, y) - 1) };
  }
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
   goes nowhere stays a tap). Letting go a quarter of the way across, or after a quick 40 px flick, steps one theme that way. */
class DragSwipe {
  constructor() { this.d = null; }
  down(id, x, y, t, w) { this.d = { id: id, x: x, y: y, t: t, w: w, lock: false }; }   // w: the scene's width, px
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

/* ---------- Dash theme: a cube runs a neon course while music is heard ----------
   Units are cube widths. The cube is centred at x, with its base at height y above the ground.
   - The course is laid one piece at a time: spikes and saws, steps and stairs, pillars and floating platforms over spike pits,
     low ceilings to run under, walls to vault, jump pads and jump orbs. Each piece is laid together with the moves that clear it
     (its route), so a run never depends on luck. Pieces get harder and come closer together as play time nears the goal.
   - While music is heard it runs (speed follows efficiency) and can never crash: it follows the route by itself.
   - Each note start makes it hop as well, when the hop is clear and lands before the route's next move.
   - When the music stops the way ahead is cleared down to one spike, set where the cube will reach it after GRACE seconds of
     silence; it hits that and shatters. Then it waits at the same spot for the music, and the attempt number goes up.
     No play time is ever lost.
   Jumps are arcs drawn over distance, not time (A*d - G*d*d higher after d cube widths), so the route is the same at any speed. */
const DASH = { SPEED: 8, GRACE: 4, VMIN: 1, TAU: 0.8, CRASH: 0.9,
  G: 2 / 4.41, JUMP: 4 / 2.1, PAD: 4 / 2.1 * Math.SQRT2, HOP: 4 / 2.1 * Math.sqrt(0.7), ROT: Math.PI / 4.2 };   // a jump peaks 2 high, 2.1 on, and turns the cube half over; a pad throws it twice as high, a note hop 1.4 high
function dashSpeed(eff) { return eff >= 0.95 ? { m: 1.6, tag: '3\u00D7' } : eff >= 0.8 ? { m: 1.3, tag: '2\u00D7' } : eff >= 0.5 ? { m: 1, tag: '1\u00D7' } : { m: 0.7, tag: '\u00BD\u00D7' }; }
/* how far an arc launched at slope A carries before it comes down to dy above where it began */
function dashLand(A, dy) { return (A + Math.sqrt(Math.max(0, A * A - 4 * DASH.G * dy))) / (2 * DASH.G); }
/* does a cube at (x, y) touch piece o? Spikes and saws are a little smaller than drawn; a block can be stood on but not run into.
   m grows the cube on every side, to make sure a hop has room to spare. */
function dashHit(o, x, y, m) {
  m = m || 0; const l = x - 0.5 - m, r = x + 0.5 + m, b = y - m, t = y + 1 + m;
  if (r <= o.x || l >= o.x + o.w || t <= o.y || b >= o.y + o.h) return false;
  if (o.kind === 'block') return r > o.x + 0.05 && l < o.x + o.w - 0.05 && b < o.y + o.h - 0.05 && t > o.y + 0.05;
  if (o.kind === 'saw') { const R = o.w / 2, cx = o.x + R, cy = o.y + R, dx = Math.max(l - cx, 0, cx - r), dy = Math.max(b - cy, 0, cy - t); return dx * dx + dy * dy < (R - 0.15) * (R - 0.15); }
  if (o.kind !== 'spike') return false;                                     // pads and orbs are never in the way
  for (let i = 0; i < o.w; i++) { const c = o.x + i + 0.5, k = o.h * (1 - 2 * Math.max(l - c, 0, c - r)) - 0.12;   // how tall the spike is where it comes nearest the cube
    if (k > 0 && (o.down ? t > o.y + o.h - k : b < o.y + k)) return true; }
  return false;
}
/* the pieces of course: name, the first tier it is laid at (tiers follow play time towards the goal), how often */
const DASH_PIECES = [['spike', 0, 3], ['step', 0, 2], ['saw', 0, 1.5], ['wall', 0, 1.5], ['rhythm', 1, 2], ['stairs', 1, 2], ['pillars', 1, 2], ['pad', 1, 2],
  ['tunnel', 2, 1.5], ['orb', 2, 2], ['platforms', 2, 2], ['padorb', 3, 2], ['orbs', 3, 2]];
class DashSim {
  constructor() { this.events = []; this.reset(); }
  reset() {
    this.mode = 'idle'; this.x = 0; this.y = 0; this.ang = 0; this.v = 0; this.arc = null; this.silentT = 0; this.crashT = 0; this.danger = null;
    this.attempts = 1; this.jumps = 0; this.scrapes = 0; this.floats = 0; this.done = false; this.progress = 0; this.tag = '1\u00D7';
    this.obs = []; this.plan = []; this.marks = []; this.vanished = []; this.built = {}; this.used = {}; this.last = '';
    this.genX = 14; this.seed = 20261005; this.respawnX = 0; this.respawnY = 0; this.landX = 0; this.events.length = 0;
  }
  rnd() { let t = this.seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  get tier() { const p = this.done ? 1 : this.progress; return p < 0.05 ? 0 : p < 0.25 ? 1 : p < 0.5 ? 2 : 3; }
  grow() {                                                                  // keep the course built a screen and a half ahead
    while (this.genX < this.x + 60) { const t = this.tier; this.genX = this.build(this.genX, t) + (t >= 2 ? 1.2 : 2.5) + this.rnd() * 6 + (this.rnd() < 0.3 ? 6 + this.rnd() * 6 : 0); }   // now and then an open stretch, for hops
    if (this.obs.length && this.obs[0].x + this.obs[0].w < this.x - 30) this.obs = this.obs.filter(o => o.x + o.w >= this.x - 30);
    while (this.marks.length && this.marks[0].x < this.x - 30) this.marks.shift();
  }
  /* lays one piece where the cube, running on the ground, can take off at x = p; returns where it is back on the ground */
  build(p, tier) {
    const G = DASH.G, J = DASH.JUMP, r = () => this.rnd(), put = o => { this.obs.push(o); return o; };
    const spikes = (x, y, n, h, down) => put({ kind: 'spike', x: x, y: y, w: n, h: h || 0.9, down: !!down });
    const block = (x, y, w, h) => put({ kind: 'block', x: x, y: y, w: w, h: h });
    const saw = (cx, cy, R) => put({ kind: 'saw', x: cx - R, y: cy - R, w: 2 * R, h: 2 * R });
    const pit = (a, b, h) => { const n = Math.floor(b - a + 1e-6); if (n > 0) spikes(a + (b - a - n) / 2, 0, n, h); };   // as many spikes as fit in [a, b], centred
    const move = (x, kind, A, y0, y1, o) => { this.plan.push({ x: x, kind: kind, A: A, y1: y1, o: o }); return x + dashLand(A, y1 - y0); };   // returns where it lands
    const jump = (x, y0, y1) => move(x, 'jump', J, y0, y1), fall = (x, y0) => move(x, 'fall', 0, y0, 0);
    const pad = (x, y1) => move(x, 'pad', DASH.PAD, 0, y1, put({ kind: 'pad', x: x - 0.5, y: 0, w: 1, h: 0.3 }));
    const orb = (x, y, y1) => move(x, 'orb', J, y, y1, put({ kind: 'orb', x: x - 0.5, y: y, w: 1, h: 1 }));   // drawn round the cube as it flies through
    let pick = 'spike', sum = 0;
    for (const q of DASH_PIECES) if (q[1] <= tier && q[0] !== this.last) sum += q[2];
    let u = r() * sum; for (const q of DASH_PIECES) if (q[1] <= tier && q[0] !== this.last) { pick = q[0]; if ((u -= q[2]) < 0) break; }
    this.last = pick; this.built[pick] = (this.built[pick] || 0) + 1;
    switch (pick) {
      case 'spike': { const n = tier >= 2 && r() < 0.35 ? 3 : r() < 0.45 ? 2 : 1; spikes(p + 2.1 - n / 2, 0, n); return jump(p, 0, 0); }   // one, two or three spikes
      case 'saw': saw(p + 2.1, 0, 1); return jump(p, 0, 0);                                                 // a half-buried saw blade
      case 'wall': spikes(p + 1.2, 0, 1); block(p + 2.47, 0, 1, 3); spikes(p + 3.6, 0, 1); return pad(p, 0);   // a pad vaults a wall three high
      case 'step': { const land = jump(p, 0, 1), s = land - 0.9, e = s + 2.5 + Math.floor(r() * 3); block(s, 0, e - s, 1);   // up onto a block and off again,
        if (tier < 1 || r() < 0.4) return fall(e + 0.5, 1);
        spikes(e + 0.8, 0, 2); return jump(e - 0.6, 1, 0); }                                                // or leaping off it over spikes
      case 'rhythm': { let x = p; for (let k = 0, n = tier >= 2 ? 4 : 3; k < n; k++) { const q = r();       // obstacles one leap apart: jump, jump, jump
        if (q < 0.3) saw(x + 2.1, 0, 1); else spikes(q < 0.6 ? x + 1.1 : x + 1.6, 0, q < 0.6 ? 2 : 1); x = jump(x, 0, 0); } return x; }
      case 'stairs': { const n = tier >= 2 && r() < 0.6 ? 3 : 2, at = []; let x = p;                        // climb two or three steps, then leap over spikes at the foot
        for (let k = 1; k <= n; k++) { const land = jump(x, k - 1, k); at.push(land - 0.9); x = land + 0.4 + (k === n ? r() * 1.5 : 0); }
        at.push(x + 0.6); for (let k = 1; k <= n; k++) block(at[k - 1], 0, at[k] - at[k - 1], k);
        spikes(x + 1, 0, n); return jump(x, n, 0); }
      case 'pillars': { let x = p, y = 0, a = p + 1.2;                                                       // pillar to pillar over spikes
        for (let k = 0, n = tier >= 2 ? 3 : 2; k < n; k++) { const h = k && r() < 0.5 ? 3 - y : y || 1, land = jump(x, y, h);
          pit(a, land - 0.5); block(land - 0.5, 0, 1, h); a = land + 0.5; x = land; y = h; }
        const land = jump(x, y, 0); pit(a, land - 1.4); return land; }
      case 'pad': { const top = tier >= 2 && r() < 0.5 ? 3 : 2, land = pad(p, top), s = land - 1; pit(p + 1, s - 0.2);   // a pad up onto a high platform,
        let x = land + 0.4; if (r() < 0.6) { spikes(x + 1.6, top, 1); x = jump(x, top, top) + 0.4; }           // a spike to jump on top, perhaps
        const e = x + 0.6 + r() * 1.5; block(s, 0, e - s, top); return fall(e + 0.5, top); }                    // and off the end
      case 'tunnel': { const x0 = p + 0.5, e = x0 + 3 + Math.floor(r() * 4); block(x0, 2.3, e - x0, 0.7); spikes(x0, 1.75, e - x0, 0.55, true);   // run under hanging spikes: no hops here
        if (r() < 0.4) return e + 0.5; spikes(e + 2.1, 0, 1); return jump(e + 0.5, 0, 0); }
      case 'orb': { jump(p, 0, 0); const land = orb(p + 2.1, 2, 0); pit(p + 0.6, land - 0.6); return land; }   // an orb at the top of the leap carries it over a wide pit
      case 'platforms': { let x = p, y = 0;                                                                  // floating platforms, climbing, over a pit of small spikes
        for (let k = 0, n = tier >= 3 ? 3 : 2; k < n; k++) { const h = Math.min(3, y + (k === 0 || r() < 0.65 ? 1 : 0)), land = jump(x, y, h), s = land - 0.9, w = 2 + Math.floor(r() * 2);
          block(s, h - 0.5, w, 0.5); x = s + w - 0.6; y = h; }
        const land = jump(x, y, 0); pit(p + 1.2, land - 1.4, 0.55); return land; }
      case 'padorb': { pad(p, 0); const xo = p + 4.5, land = orb(xo, DASH.PAD * 4.5 - G * 4.5 * 4.5, 2), s = land - 1, e = land + 1.2 + r() * 1.5;   // pad, orb, platform
        pit(p + 1, s - 0.2); block(s, 0, e - s, 2); return fall(e + 0.5, 2); }
      case 'orbs': { jump(p, 0, 0); orb(p + 2.1, 2, 0); const land = orb(p + 6.3, 2, 0); pit(p + 0.6, land - 0.6, 0.55); return land; }   // orb to orb over a long pit
    }
    return p;
  }
  mark() { this.marks.push({ x: this.x, y: this.y }); }                     // a checkpoint, dropped when the session is paused
  support(x, y) { if (y < 1e-3) return true;                               // is there something to stand on at (x, y)?
    for (const o of this.obs) if (o.kind === 'block' && Math.abs(o.y + o.h - y) < 1e-3 && x > o.x - 0.5 && x < o.x + o.w + 0.5) return true; return false; }
  startArc(x0, y0, A, y1, a0, kind, o) {
    const x1 = x0 + dashLand(A, y1 - y0), q = Math.PI / 2; let a1 = Math.round((a0 + (x1 - x0) * DASH.ROT) / q) * q; if (a1 < a0 + 0.1) a1 += q;   // always lands flat
    this.arc = { x0: x0, y0: y0, A: A, x1: x1, y1: y1, a0: a0, a1: a1, kind: kind }; this.used[kind] = (this.used[kind] || 0) + 1;
    if (kind !== 'fall') { this.jumps++; this.events.push(kind === 'hop' ? 'jump' : kind); }
    if (o) o.hit = true;                                                    // pads and orbs light up
  }
  follow(music) {                                                           // take the route's moves as they come; land
    for (let n = 0; n < 8; n++) {
      const a = this.arc, m = this.plan[0], go = m && m.x <= this.x && (music || m.kind === 'fall');
      if (a && !(go && m.kind === 'orb' && m.x < a.x1)) { if (this.x < a.x1) return; this.arc = null; this.y = a.y1; this.ang = a.a1; this.landX = a.x1; this.events.push('land'); continue; }
      if (!go) return;
      this.plan.shift();
      if (!a && m.kind === 'orb') continue;                                 // an orb only works in the air
      if (a) { const d = m.x - a.x0; this.startArc(m.x, a.y0 + a.A * d - DASH.G * d * d, m.A, m.y1, a.a0 + (a.a1 - a.a0) * d / (a.x1 - a.x0), m.kind, m.o); }   // taken exactly where the move is
      else this.startArc(Math.max(m.x, this.landX), this.y, m.A, m.y1, this.ang, m.kind, m.o);
    }
  }
  hop() {                                                                   // a note start: hop, if it lands before the route's next move and nothing is in the way
    const x0 = this.x, y0 = this.y, L = dashLand(DASH.HOP, 0), m = this.plan[0];
    if ((m && m.x < x0 + L) || !this.support(x0 + L, y0)) return;
    for (let i = 1; i < 16; i++) { const d = L * i / 16, y = y0 + DASH.HOP * d - DASH.G * d * d; for (const o of this.obs) if (dashHit(o, x0 + d, y, 0.15)) return; }
    this.startArc(x0, y0, DASH.HOP, y0, this.ang, 'hop');
  }
  clearAhead() {                                                            // the music has just stopped: clear the way and set the spike it will reach in GRACE seconds
    const v0 = Math.max(this.v, DASH.VMIN), D = DASH.VMIN * DASH.GRACE + (v0 - DASH.VMIN) * DASH.TAU * (1 - Math.exp(-DASH.GRACE / DASH.TAU));
    const a = this.arc, xs = a ? a.x1 : this.x, h = a ? a.y1 : this.y, at = Math.max(this.x + D + 0.5, xs + 1.7), end = at + 4;
    let floor = h > 1e-3 ? this.obs.find(o => o.kind === 'block' && Math.abs(o.y + o.h - h) < 1e-3 && xs > o.x - 0.5 && xs < o.x + o.w + 0.5) : null;   // what it will run on
    this.vanished = this.obs.filter(o => o !== floor && o.x + o.w > this.x + 0.5);
    this.obs = this.obs.filter(o => o === floor || o.x + o.w <= this.x + 0.5);
    if (h > 1e-3) { if (!floor) this.obs.push(floor = { kind: 'block', x: xs - 1, y: 0, w: 0, h: h }); floor.w = Math.max(floor.w, end - floor.x); }   // up high, the platform runs on past the spike
    this.danger = { kind: 'spike', x: at, y: h, w: 1, h: 0.9, danger: true }; this.obs.push(this.danger);
    this.plan = [{ x: at - 1.6, kind: 'jump', A: DASH.JUMP, y1: h, danger: true }];   // taken if the music comes back in time
    let back = end;
    if (floor) { const e = floor.x + floor.w + 0.5; this.plan.push({ x: e, kind: 'fall', A: 0, y1: 0 }); back = e + dashLand(0, -h); }
    this.genX = back + 2 + this.rnd() * 3;
  }
  saved() {                                                                 // the music is back before the spike was hit
    this.silentT = 0; this.events.push('saved');
    const m = this.plan[0];
    if (m && m.danger && m.x < this.x) { this.plan.shift(); this.obs = this.obs.filter(o => o !== this.danger); this.vanished = [this.danger]; }   // too close to jump it now: it goes
    this.danger = null;
  }
  /* inp: {running, music, eff, onsets (note starts since the last call), progress (play time / goal)} */
  update(dt, inp) {
    if (!inp.running || !(dt > 0)) return;
    this.progress = inp.progress || 0;
    this.grow();
    if (!this.done && this.progress >= 1) { this.done = true; this.events.push('complete'); }
    const sp = dashSpeed(inp.eff || 0); if (sp.tag !== this.tag && this.mode === 'run' && inp.music) this.events.push('speed'); this.tag = sp.tag;
    if (this.mode === 'crash') { this.crashT += dt; if (this.crashT >= DASH.CRASH) { this.mode = 'wait'; this.attempts++; this.ang = 0; this.arc = null; this.v = 0; this.respawnX = this.x; this.respawnY = this.y; this.events.push('attempt'); } return; }
    if (this.mode === 'idle' || this.mode === 'wait') { if (!inp.music) return; this.mode = 'run'; this.silentT = 0; this.events.push('go'); }
    // speed
    if (inp.music) { if (this.silentT > 0) this.saved(); this.v += (DASH.SPEED * sp.m - this.v) * Math.min(1, dt * 3); }
    else { if (this.silentT === 0) this.clearAhead(); this.silentT += dt; this.v = DASH.VMIN + (this.v - DASH.VMIN) * Math.exp(-dt / DASH.TAU); }
    this.x += this.v * dt;
    // the route, and hops
    this.follow(inp.music);
    if (inp.music && inp.onsets > 0) { this.events.push('note'); if (!this.arc) this.hop(); }   // the scene pulses with every note, hop or not
    if (this.arc) { const a = this.arc, d = this.x - a.x0; this.y = a.y0 + a.A * d - DASH.G * d * d; this.ang = a.a0 + (a.a1 - a.a0) * d / (a.x1 - a.x0); }
    else if (!this.support(this.x, this.y)) this.floats++;                  // never expected; counted so the tests can prove it
    // touching anything
    for (const o of this.obs) if (dashHit(o, this.x, this.y)) {
      if (!inp.music && o.kind !== 'block') { this.mode = 'crash'; this.crashT = 0; this.v = 0; this.silentT = 0; this.danger = null; this.arc = null;
        this.obs = this.obs.filter(q => q !== o); this.plan = this.plan.filter(q => q.x > this.x); this.events.push('crash'); return; }
      this.scrapes++;                                                       // never expected; counted so the tests can prove it
    }
  }
}

/* ---------- Grand Prix: a ten-car race whose speeds are each player's efficiency over the last minute ----------
   You start at the back of the grid. Five seconds of playing light the start lights; then every car's speed is the share of its
   last minute spent playing (100% is 300 km/h), so the car that covers the most distance has played most of the time, and the
   higher your session efficiency, the better your chance of first place. The nine rivals are simulated players: the same field
   for everyone (from Bach, who usually plays 78% of the time, to Schubert at 46%), each with a form for the day and good and bad
   spells within the race. A pause is a red flag: the race and every rival stop, and your car waits in the pit lane, which is only
   a picture (it changes nothing about the car); on resume you rejoin at the same distance. The race runs until the practice goal. */
const RACE = { SEG: 200, ROADW: 2000, LAP: 3000, VNOM: 10000, LIMIT: 2700, PZ: 900, GRIDGAP: 6, START: 80, FORM: 0.07, SWING: 0.05,
  RIVALS: [['BAC', '#C8102E', '#F5F5F5', 0.78], ['MOZ', '#1E5BC6', '#FFD23F', 0.74], ['BEE', '#30323A', '#FF7A1A', 0.70], ['CHO', '#0A7F5A', '#E8E8E8', 0.66],
    ['VIV', '#EDEDED', '#D3313A', 0.62], ['DEB', '#6B3FA0', '#7FE3FF', 0.58], ['HAN', '#FF8A00', '#1B1B1B', 0.54], ['RAV', '#0E9AA7', '#F6D55C', 0.50], ['SCH', '#8C1C3A', '#F2C14E', 0.46]],
  YOU: ['YOU', '#15213D', '#86DCC0'] };   // a lap (LAP segments of SEG) is one minute at full speed, VNOM a second; PZ: the camera sits this far behind your car
RACE.LAPU = RACE.LAP * RACE.SEG; RACE.KERB = 0.9; RACE.APEX = 0.86;   // a kerb where the bend is sharper than KERB; at the apex the inside tyres are on it
const RACE_PIT = { X: 1.48, HALF: 0.36, JOIN: 0.62, IN: 60, OUT: 80, LIMIT: 44 };   // LIMIT: segments of speed limit past the box before the bend out   // the pit lane: its middle and half-width (road half-widths), where it joins the track, the bends in and out (segments)
const raceGridX = p => p % 2 ? -0.42 : 0.42;                 // grid slot p (1 at the front): odd slots on the left
const raceWrap = l => l - Math.round(l);                    // a lead in laps, as the nearest place on the circuit
function raceRng(seed) { let s = (seed >>> 0) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
/* the circuit: [enter, hold, leave, curve, hill (in segment lengths), board by the corner]; it closes at the height it starts */
const RACE_SECTIONS = [
  [0, 160, 0, 0, 0],
  [20, 50, 20, 4.5, -12, 'ALLEGRO'], [0, 70, 0, 0, -6], [25, 70, 25, -2.6, 0, 'ANDANTE'], [0, 120, 0, 0, 26, 'CRESCENDO'],
  [12, 18, 12, 5.5, 0, 'STACCATO'], [12, 18, 12, -5.5, 0], [0, 260, 0, 0, -16, 'PRESTO'], [18, 60, 18, -7, 4, 'FERMATA'],
  [0, 90, 0, 0, 8], [16, 26, 16, 3.2, 0, 'LEGATO'], [16, 26, 16, -3.2, 0], [16, 26, 16, 3.2, 0],
  [35, 110, 35, 2, 12, 'RUBATO'], [0, 140, 0, 0, -10], [22, 45, 22, -4.2, 0, 'DA CAPO'], [0, 120, 0, 0, null]];
function raceTrack() {
  const curve = [], y = [0], boards = [], io = (a, b, p) => a + (b - a) * (0.5 - Math.cos(p * Math.PI) / 2);
  let h = 0;
  for (const [en, ho, le, c, hill, board] of RACE_SECTIONS) {
    const n = en + ho + le, h0 = h, h1 = hill == null ? 0 : h + hill * RACE.SEG;
    if (board) boards.push({ at: curve.length, text: board, side: c > 0 ? -1 : 1 });   // on the outside of the corner
    for (let i = 0; i < n; i++) { curve.push(i < en ? c * (i / en) * (i / en) : i < en + ho ? c : io(c, 0, (i - en - ho) / le)); h = io(h0, h1, (i + 1) / n); y.push(h); }
  }
  const N = curve.length, ahead = new Float32Array(N);   // the bend coming up
  for (let i = 0; i < N; i++) { let s = 0; for (let j = 4; j < 30; j++) s += curve[(i + j) % N]; ahead[i] = s / 26; }
  return { n: N, curve: Float32Array.from(curve), y: Float32Array.from(y), ahead: ahead, boards: boards, line: raceLine(curve) };
}
/* The racing line, as a real driver takes a corner: out wide on the way in, the inside tyres on the kerb at the apex (a little past
   the middle of the bend), and out wide again on the way out. Corners close together (a chicane, the esses) go apex to apex.
   x in road half-widths from the centre: the inside of a right-hand bend is positive. */
function raceLine(curve) {
  const N = curve.length, keys = [], corners = [], KERB = RACE.KERB, WIDE = 0.55, OFF = 35;
  for (let i = 0; i < N;) { if (Math.abs(curve[i]) <= KERB) { i++; continue; } let e = i; while (e + 1 < N && Math.abs(curve[e + 1]) > KERB && Math.sign(curve[e + 1]) === Math.sign(curve[i])) e++;
    corners.push({ s: i, e: e, sg: Math.sign(curve[i]) }); i = e + 1; }
  const apart = (c, d) => d.s - c.e > (c.sg === d.sg ? 2 * OFF : 2 * OFF + 100);   // far enough apart to go wide between them; bends the other way need more room
  corners.forEach((c, k) => { const prev = corners[k - 1], next = corners[k + 1];
    if (!prev || apart(prev, c)) keys.push([c.s - OFF, -c.sg * WIDE]);
    keys.push([c.s + (c.e - c.s) * 0.55, c.sg * RACE.APEX]);
    if (!next || apart(c, next)) keys.push([c.e + OFF, -c.sg * WIDE]); });
  const K = keys.length, at = k => { const q = keys[((k % K) + K) % K]; return [q[0] + Math.floor(k / K) * N, q[1]]; }, line = new Float32Array(N);
  for (let i = 0, k = -1; i < N; i++) {
    while (at(k + 1)[0] <= i) k++;
    const [s0, x0] = at(k), [s1, x1] = at(k + 1), u = (i - s0) / (s1 - s0);
    line[i] = x0 + (x1 - x0) * u * u * (3 - 2 * u);
  }
  return line;
}
/* A rival's player: phrases and quiet gaps in the proportion of its steadiness, which drifts through good and bad spells of a few
   minutes, and its efficiency over the last minute, counted like yours (60 one-second buckets). The same seed gives the same
   playing however the time is cut into steps, so a device following a session races the same field. */
class RacePractiser {
  constructor(steady, rnd) {
    this.base = steady; this.rnd = rnd; this.t = -60; this.per = 240 + rnd() * 300; this.ph = rnd() * Math.PI * 2;
    this.buf = new Float32Array(60); this.bi = 0; this.acc = 0; this.ap = 0; this.sum = 0;
    this.playing = rnd() < steady; this.left = this.dur();
    this.step(60);   // a minute of practice before the start, so the window is full
  }
  get s() { return Math.max(0.2, Math.min(0.98, this.base + RACE.SWING * Math.sin(this.t / this.per * Math.PI * 2 + this.ph))); }
  dur() { const r = this.rnd(), s = this.s; return this.playing ? 6 + r * 26 : 19 * (1 - s) / s * (0.3 + r * 1.4); }
  /* plays on for dt seconds; returns the distance covered, as seconds at full speed */
  step(dt) {
    let run = 0;
    while (dt > 1e-9) {
      const k = Math.min(dt, this.left, 1 - this.acc); run += this.eff * k; this.acc += k; this.t += k; if (this.playing) this.ap += k; this.left -= k; dt -= k;
      if (this.left <= 1e-9) { this.playing = !this.playing; this.left = this.dur(); }
      if (this.acc >= 1 - 1e-9) { this.sum += this.ap - this.buf[this.bi]; this.buf[this.bi] = this.ap; this.bi = (this.bi + 1) % 60; this.acc = 0; this.ap = 0; }
    }
    return run;
  }
  get eff() { return clamp01(this.sum / 60); }
}
class RaceSim {
  constructor() { this.T = raceTrack(); this.events = []; this.reset(1800, 7); }
  reset(goal, seed) {
    const R = RACE; this.goal = goal || 1800; this.seed = seed || 7;
    this.mode = 'grid'; this.st = 'idle'; this.lit = 0; this.litT = 0; this.hold = 0; this.finished = false; this.finishPos = 0; this.events.length = 0;
    this.dist = 0; this.eff = 0;                                              // your race distance, and speed as a share of full speed
    this.d = (R.START - 4 - 9 * R.GRIDGAP) * R.SEG - R.PZ; this.v = 0; this.x = raceGridX(10); this.tx = this.x; this.off = 0; this.drs = false; this.pit = null; this.limiter = false;
    const rnd = raceRng(this.seed), gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };   // a rival's form for the day
    this.cars = R.RIVALS.map((r, i) => ({ code: r[0], c1: r[1], c2: r[2], i: i, p: new RacePractiser(Math.max(0.3, Math.min(0.97, r[3] + R.FORM * gauss())), raceRng(this.seed * 31 + i * 7717 + 1)),   // each its own stream, so step sizes do not reorder the draws
      dist: (9 - i) * R.GRIDGAP * R.SEG, lead: 0, x: raceGridX(i + 1) }));
    this.order();
  }
  get racing() { return this.mode === 'race' || this.mode === 'red'; }
  get inPit() { return !!this.pit && !this.pit.exitAt; }
  get lap() { return Math.floor(this.dist / RACE.LAPU) + 1; }
  order() {
    let pos = 1, ahead = null, behind = null;
    for (const c of this.cars) { c.lead = (c.dist - this.dist) / RACE.LAPU;
      if (c.lead > 0) { pos++; if (!ahead || c.lead < ahead.lead) ahead = c; } else if (!behind || c.lead > behind.lead) behind = c; }
    this.pos = pos; this.ahead = ahead; this.behind = behind;
  }
  /* the race, on session time. inp: {state, music, recent (efficiency over the last minute), play (play time)} */
  update(dt, inp) {
    const ev = this.events, st = inp.state, run = st === 'running', music = !!inp.music && run; this.st = st;
    if (!(dt > 0)) dt = 0;
    if (this.mode === 'grid' && run) this.mode = 'lights';
    if (this.mode === 'lights' && run) {                                     // a light for each second of playing, then a short wait, then lights out
      if (this.lit < 5) { if (music) { this.litT += dt; const n = Math.min(5, Math.floor(this.litT)); if (n > this.lit) { this.lit = n; ev.push('light'); if (n === 5) this.hold = 0.5 + raceRng(this.seed + 1)() * 1.3; } } }
      else if ((this.hold -= dt) <= 0) { this.mode = 'race'; this.lit = 0; this.off = this.x - this.lineAt((this.d + RACE.PZ) / RACE.SEG); ev.push('go'); }   // away from the grid slot, onto the line
    }
    if (this.mode === 'race' && st === 'paused') { this.mode = 'red'; ev.push('red'); this.pitIn(); }
    if (this.mode === 'red' && run) { this.mode = 'race'; ev.push('green'); }
    if (this.mode === 'race' && run && dt > 0) {                            // only while the session runs: a pause freezes every car
      this.eff = clamp01(inp.recent || 0); this.dist += this.eff * RACE.VNOM * dt;
      for (const c of this.cars) c.dist += c.p.step(dt) * RACE.VNOM;
    }
    const was = this.pos; this.order();
    if (this.racing && this.pos < was) ev.push('up');
    if (!this.finished && this.racing && inp.play >= this.goal) { this.finished = true; this.finishPos = this.pos; ev.push('finish'); }
  }
  /* Under the red flag your car drives into the pit lane and stops in its box: only the picture moves, the race stays frozen.
     The lane is one path (pitX): it opens out from the car's line on the way in, runs beside the track past the garages, and on the
     way out bends gently back into the right side of the track. The car keeps to the middle of it, so it never crosses the line. */
  pitIn() {
    const R = RACE, seg = (this.d + R.PZ) / R.SEG, inLane = this.pit && this.pit.phase === 'out';   // stopped again on the limiter run: in the lane already
    if (!inLane) this.pit = { a: Math.floor(seg) + 2, x0: this.x, m0: 0, m1: 0 };
    const P = this.pit, least = inLane ? 24 * R.SEG : (P.a + RACE_PIT.IN + 12) * R.SEG - R.PZ - this.d;   // the box is past the bend in
    const D = Math.max(least, inLane ? 0 : this.v * this.v / (2 * 3800));
    Object.assign(P, { phase: 'in', box: this.d + D, dec: Math.max(2400, this.v * this.v / (2 * D)), out: 0, exitAt: false });
    P.boxSeg = Math.floor((P.box + R.PZ) / R.SEG); this.limiter = true;
    P.m0 = Math.max(inLane ? P.m0 : 0, P.boxSeg + RACE_PIT.LIMIT); P.m1 = P.m0 + RACE_PIT.OUT;   // where the lane bends out, set now, so the garages and the lane stay put
  }
  /* the racing line at segment s (fractional) */
  lineAt(s) { const L = this.T.line, n = this.T.n, i = Math.floor(s), u = s - i, a = ((i % n) + n) % n; return L[a] + (L[(a + 1) % n] - L[a]) * u; }
  /* the middle of the pit lane at segment s (fractional), in road half-widths from the centre; null where there is no lane */
  pitX(s) {
    const P = this.pit, L = RACE_PIT, sm = u => u * u * (3 - 2 * u); if (!P || s < P.a) return null;
    if (s < P.a + L.IN) return P.x0 + (L.X - P.x0) * sm((s - P.a) / L.IN);
    if (s < P.m0) return L.X;
    if (s < P.m1) return L.X + (L.JOIN - L.X) * sm((s - P.m0) / (P.m1 - P.m0));
    return null;
  }
  /* the motion on screen, on real time: the car runs at its speed, takes the racing line, passes on the side away from the car ahead,
     and goes into the pit lane and out again */
  move(rdt) {
    const R = RACE, st = this.st, run = st === 'running', P = this.pit;
    if (!(rdt > 0)) return;
    const seg = Math.floor((this.d + R.PZ) / R.SEG), ahead = this.T.ahead[seg % this.T.n];
    let vt = this.mode === 'race' && run ? this.eff * R.VNOM : 0;
    if (P && P.phase === 'in') {
      const rem = P.box - this.d;
      this.v = Math.min(this.v + 2500 * rdt, Math.sqrt(Math.max(0, 2 * P.dec * rem)));
      if (rem < 3 || (this.v < 30 && rem < 300)) { this.d = P.box; this.v = 0; P.phase = 'box'; this.events.push('box'); }
    } else if (P && P.phase === 'box') {
      this.v = 0;
      if (run) { P.phase = 'out'; P.out = this.d; this.events.push('release'); }
    } else {
      if (P && P.phase === 'out') { vt = run ? R.LIMIT : 0;          // the speed limit to the end of the pit lane, then the bend out
        if ((this.d + R.PZ) / R.SEG >= P.m0) { P.phase = 'merge'; this.limiter = false; } }
      if (this.v < vt) this.v = Math.min(vt, this.v + (this.v < 3000 ? 3600 : 2400) * rdt);
      else this.v = Math.max(vt, this.v - (st === 'stopped' ? 6500 : 2400) * rdt);
    }
    this.d += this.v * rdt;
    const pa = (this.d + R.PZ) / R.SEG;
    if (P && P.phase === 'merge' && pa >= P.m1) { P.phase = 'done'; P.exitAt = true; this.off = this.x - this.lineAt(pa); this.events.push('exit'); }   // joined the track: eases over to the line from there
    if (P && P.phase === 'done' && this.d / R.SEG > P.m1) this.pit = null;                     // and the camera is past the end of the lane
    const lane = this.inPit ? this.pitX(pa) : null, line = this.lineAt(pa);
    if (lane != null) { this.x = this.tx = lane; this.off = 0; }                                // in the pit lane: along its middle, nothing else
    else if (this.racing && !this.inPit) {
      let want = 0;                                                                              // on the racing line, unless a car ahead is on it: then beside it
      for (const c of this.cars) { const rel = raceWrap(c.lead) * R.LAP; if (rel > -5 && rel < 30 && (rel < 7 || Math.abs(c.x - line) < 0.62)) want = c.x > line ? Math.min(want, c.x - 0.8 - line) : Math.max(want, c.x + 0.8 - line); }
      this.off += (want - this.off) * Math.min(1, rdt * 1.6) * (this.v > 300 ? 1 : 0);
      this.tx = Math.max(-RACE.APEX, Math.min(RACE.APEX, line + this.off));
    }
    this.drs = this.mode === 'race' && !this.inPit && this.v > 3000 && Math.abs(ahead) < 0.4 && !!this.ahead && this.ahead.lead * R.LAPU / R.VNOM < 1;   // within a second of the car ahead
    const k = Math.min(1, rdt * 1.9) * (this.v > 300 ? 1 : 0);   // no steering while standing still
    if (lane == null) { const dx = this.racing ? this.tx - this.x : (this.tx - this.x) * k, cap = rdt * (0.3 + 3.2 * this.v / R.VNOM);   // on the line exactly, so the apex is not missed;
      this.x += Math.max(-cap, Math.min(cap, dx)); }                                           // off it (the start, the pit exit), back no faster sideways than the car's speed allows
    for (const c of this.cars) {                                                                // rivals keep to the line too, a little to one side, so two do not overlap
      const at = pa + raceWrap(c.lead) * R.LAP, want = this.racing ? Math.max(-RACE.APEX, Math.min(RACE.APEX, this.lineAt(at) + (c.i % 2 ? 0.12 : -0.12))) : raceGridX(c.i + 1);
      c.x += (want - c.x) * Math.min(1, rdt * (this.racing ? 6 : 0.9)) * (this.v > 300 || this.racing ? 1 : 0); }
  }
}
/* a gap in laps, in words for the read-outs: seconds at full speed, or whole laps */
function raceGap(l) { const a = Math.abs(l); return a >= 1 ? Math.floor(a) + (a >= 2 ? ' laps' : ' lap') : Math.max(0.1, a * RACE.LAPU / RACE.VNOM).toFixed(1); }

/* ---------- Fireworks: every note played sends a shell up into the night ----------
   A note starting launches a shell. Its colour is the note (the twelve notes are twelve colours, a fifth apart round the colour wheel, so the
   notes of a scale all look different) and its height is how high the note is. The last minute of playing (Session.recentEfficiency) sets how
   intense the show is, shown as Intensity: how many shells are in the sky at once, how big they are, and which kinds go up (small round ones at
   first, rings and chrysanthemums, then willows, palms and crossettes). While the music plays the show keeps a pace of PACE shells a second at
   full intensity: every note sends one up, and when the notes come slower than the pace, more go up in the colour of the note sounding (so a
   held note keeps the sky busy too). Only playing sends shells up: nothing goes up while quiet, paused or stopped. Fast runs cannot flood the
   sky: shells go up at most RATE + PER x intensity a second, and the notes over that make the next shell bigger. Reaching the practice goal sets
   off a grand finale once: FINALE shells over FINALE_T seconds, the last one bursting into the shape of a trophy (fwTrophyShape), then a
   'finaleEnd' event TROPHY_T seconds later, when the trophy card can show. The finale only plays while the theme is on screen (shown), so it waits
   for the player to come to it, and it holds through a pause like the clock. src/fireworks.js only draws what this decides. */
const FW = { PACE: 3, RATE: 1, PER: 4, BURST: 2, BURSTPER: 3, AIR: 3.5, CHARGE: 0.15, FINALE: 28, FINALE_T: 7, LULL: 1.4, TROPHY_T: 3.6,   // LULL: the quiet before the trophy goes up   // AIR: about how long a shell is in the sky, rising and burning
  KINDS: [[0, 'peony'], [0.3, 'ring'], [0.3, 'chrysanthemum'], [0.6, 'willow'], [0.6, 'palm'], [0.6, 'crossette']],   // [intensity needed, kind]
  CALIBRE: [2, 3, 4, 5, 6, 8, 10, 12] };                                    // shell sizes in inches, as real shells are measured, for the read-outs
function fwHue(pc) { return ((pc * 7) % 12) * 30; }                            // C red, G orange, D yellow, A lime, E green... round the circle of fifths
/* the finale's last burst: points along the outline of a trophy (the cup, its two handles, the stem and the base), about step apart, in units where
   the trophy is 1.5 high and centred on 0, y up. The renderers throw a spark at each point, so the burst opens into the shape and holds it a moment */
function fwTrophyShape(step) {
  step = step || 0.05; const out = [], seg = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)); for (let i = 0; i < n; i++) out.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  const arc = (cx, cy, r, a0, a1) => { const n = Math.max(2, Math.round(Math.abs(a1 - a0) * r / step)); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  seg(-0.55, 0.75, 0.55, 0.75);                                              // the rim
  for (const sx of [-1, 1]) {
    const n = Math.round(1.05 / step); for (let i = 1; i <= n; i++) { const t = i / n * Math.PI / 2; out.push([sx * (0.1 + 0.45 * Math.cos(t)), 0.75 - 0.75 * Math.sin(t)]); }   // the bowl
    arc(sx * 0.55, 0.45, 0.22, Math.PI / 2, sx > 0 ? -Math.PI / 2 : Math.PI * 1.5);   // a handle
    seg(sx * 0.08, 0, sx * 0.08, -0.45);                                     // the stem
  }
  seg(-0.32, -0.45, 0.32, -0.45); seg(0.32, -0.45, 0.42, -0.75); seg(0.42, -0.75, -0.42, -0.75); seg(-0.42, -0.75, -0.32, -0.45);   // the base
  return out;
}
function fwCalibre(recent) { return FW.CALIBRE[Math.max(0, Math.min(FW.CALIBRE.length - 1, Math.floor(recent * FW.CALIBRE.length)))]; }
class FireworkSim {
  constructor() { this.reset(0, 1); }
  reset(goal, seed) {
    this.goal = goal || 0; this.seed = seed || 1; this.rnd = raceRng(this.seed);
    this.shells = 0; this.notes = 0; this.tokens = FW.BURST; this.charge = 0; this.due = 0; this.lastHue = -1; this.t = 0; this.up = [];
    this.finaleDone = false; this.finaleLeft = 0; this.finaleT = 0; this.finaleOn = false; this.events = [];
  }
  get colours() { let n = 0; for (let b = this.notes; b; b &= b - 1) n++; return n; }   // how many of the twelve notes have gone up
  get inFinale() { return this.finaleOn; }
  get aloft() { return this.up.length; }                                   // the player's shells sent up in the last AIR seconds: about how many are in the sky now
  /* i: {state, music, notes (note starts since the last update), midi (the pitch heard, fractional key number, or null), recent (last minute, 0..1), play (s),
     shown (the theme is on screen)} */
  update(dt, i) {
    const recent = Math.max(0, Math.min(1, i.recent || 0)), running = i.state === 'running';
    this.t += dt; while (this.up.length && this.t - this.up[0] > FW.AIR) this.up.shift();
    this.tokens = Math.min(FW.BURST + FW.BURSTPER * recent, this.tokens + dt * (FW.RATE + FW.PER * recent));
    if (running && i.music) {
      let n = i.notes || 0;
      this.due += dt * FW.PACE * recent;                                        // the pace the intensity asks for; the notes played count toward it
      while (n > 0 && this.tokens >= 1) { this.launch(i.midi, recent); this.due = Math.max(-2, this.due - 1); n--; }   // notes ahead of the pace hold the extra shells back a little
      if (n > 0) this.charge = Math.min(1, this.charge + n * FW.CHARGE);         // too many notes for the sky: the next shell goes up bigger
      while (this.due >= 1 && this.tokens >= 1) { this.launch(i.midi, recent); this.due -= 1; }
      this.due = Math.min(this.due, 2);
    } else this.due = 0;
    if (running && !this.finaleDone && this.goal > 0 && i.play >= this.goal) { this.finaleDone = true; this.finaleOn = true; this.finaleLeft = FW.FINALE; this.finaleT = 0; }
    if (running && i.shown && this.finaleOn) {                                   // the finale waits for the theme to be on screen, and holds through a pause
      if (this.finaleT === 0) this.events.push({ k: 'finale' });
      this.finaleT += dt;
      while (this.finaleLeft > 0 && this.finaleT >= (this.finaleLeft === 1 ? FW.FINALE_T : (FW.FINALE - this.finaleLeft) * (FW.FINALE_T - FW.LULL) / (FW.FINALE - 2))) {
        const r = this.rnd;
        if (this.finaleLeft === 1) this.events.push({ k: 'shell', finale: true, kind: 'trophy', x: 0.5, h: 0.7, size: 1.2, hue: 44, hue2: -1 });   // the last one: a trophy
        else this.events.push({ k: 'shell', finale: true, x: 0.1 + r() * 0.8, h: 0.55 + r() * 0.4, size: 0.9 + r() * 0.3, hue: Math.floor(r() * 12) * 30, hue2: -1,
          kind: ['peony', 'ring', 'chrysanthemum', 'willow', 'palm', 'crossette'][Math.floor(r() * 6)] });
        this.finaleLeft--;
      }
      if (this.finaleLeft === 0 && this.finaleT >= FW.FINALE_T + FW.TROPHY_T) { this.finaleOn = false; this.events.push({ k: 'finaleEnd' }); }
    }
  }
  launch(midi, recent) {
    const r = this.rnd, known = midi != null && isFinite(midi), pc = known ? ((Math.round(midi) % 12) + 12) % 12 : Math.floor(r() * 12), hue = fwHue(pc);
    const kinds = FW.KINDS.filter(k => recent >= k[0]).map(k => k[1]), kind = kinds[Math.floor(r() * kinds.length)];
    const h = known ? 0.45 + Math.max(0, Math.min(1, (midi - 40) / 50)) * 0.45 + (r() - 0.5) * 0.08 : 0.55 + r() * 0.25;   // low notes burst low, high notes high
    const size = Math.min(1.25, 0.3 + 0.7 * recent + this.charge * 0.4);
    this.events.push({ k: 'shell', x: 0.12 + r() * 0.76, h: Math.max(0.35, Math.min(0.95, h)), size: size, hue: hue, hue2: recent >= 0.6 && this.lastHue !== hue ? this.lastHue : -1, kind: kind, pc: pc });
    this.tokens -= 1; this.charge = 0; this.lastHue = hue; this.shells++; this.notes |= 1 << pc; this.up.push(this.t);
  }
}

const api = { LIFTOFF, OnsetTracker, DragSwipe, WheelSwipe, DashSim, DASH, dashSpeed, RaceSim, RACE, RACE_PIT, raceTrack, FireworkSim, FW, fwHue, fwCalibre, fwTrophyShape, raceGap, raceRng, RacePractiser, MusicDetector, Session, RocketSim, WORLD, MILESTONES, SENSITIVITY, CLIPS, DETECTION_CASES,
  detectionTests, runDetectionTests, analyzeClip, sessionReport, clockText, sessionRecord, worthKeeping, liveSnapshot, liveRecord, rocketCarry, buildOf, newerBuild, themesOn, themeSwitch, themeLanding, practiceStats, dayRecap, dayLine, practiceNudge, homeCopy, weekLine, durationText, dayKey, LOG_MAX, LEVEL_MIN, SAMPLE_LOGS, sampleLog, rocketAt, fraction, heardAs, noteOf, smooth, pchip, clamp01 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MT = api;
})(typeof self !== 'undefined' ? self : this);
