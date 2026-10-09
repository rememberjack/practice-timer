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

const SENSITIVITY = {
  strict:  { on: 0.70, off: 0.40, minDb: -52 },
  normal:  { on: 0.60, off: 0.32, minDb: -58 },
  lenient: { on: 0.50, off: 0.25, minDb: -64 }
};

const INSTRUMENTS = {
  piano:    { name: 'Piano',    detail: 'Struck strings: each note rings, then fades' },
  clarinet: { name: 'Clarinet', detail: 'Reed tone: hollow, odd overtones stand out' },
  flute:    { name: 'Flute',    detail: 'Pure, airy tone with few overtones' },
  cello:    { name: 'Cello',    detail: 'Low bowed strings with rich overtones' },
  violin:   { name: 'Violin',   detail: 'Bowed strings: sustained, rich overtones' }
};

/* ---------- Music detector ----------
   Feed it one frame of raw samples (latest N samples) plus the time since the previous frame.
   It decides, frame by frame, whether the sound is a musical instrument:
   1. spectrum -> sharp, stable partials (tonal energy ratio) separate instruments from noise
   2. pitch track -> gliding pitch and short broken-up voiced bursts separate talking from playing
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
    this.hist = new Float32Array(128);
    this.setSensitivity(opts.sensitivity || 'normal');
    this.out = { levelDb: -120, active: false, tonal: false, ter: 0, pitch: 0, note: '', score: 0,
      isMusic: false, kind: 'quiet', label: 'Quiet', detail: '', instrument: '' };
    this.reset();
  }
  setSensitivity(name) { this.sens = SENSITIVITY[name] || SENSITIVITY.normal; }
  reset() {
    this.floor.fill(1e-9); this.pf.fill(0); this.pd.fill(0.05);
    this.score = 0; this.isMusic = false; this.run = 0; this.glideHold = 0; this.flat = 0; this.bridge = 0;
    this.lh.fill(-120); this.lp.fill(0); this.lpf.fill(0); this.lt.fill(0); this.fq.fill(-1); this.P0.fill(0); this.hist.fill(0);
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
    const tonal = active && ter >= 0.3 && np >= 1 && maxPk > 1e-7;
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
    // a burst that holds one pitch (a detached note) earns full credit and carries over a short gap
    if (pf[3] > 0 && pf[2] > 0 && Math.abs(1200 * Math.log2(pf[3] / pf[2]) / dt) < 150) this.flat++; else if (pf[3] > 0 || !tonal) this.flat = 0;
    let q = 0;
    if (tonal) {
      this.run += dt;
      q = clamp01((ter - 0.3) / 0.3) * (this.flat >= 2 ? 1 : Math.min(1, Math.max(0.5, this.run / 0.2)));
      if (this.glideHold > 0) { q *= 0.1; this.bridge = 0; } else if (this.flat >= 2) this.bridge = 0.2;
    } else {
      this.run = 0;
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
      o.kind = 'music'; o.instrument = ins.name; o.label = 'Sounds like ' + ins.name.toLowerCase(); o.detail = ins.detail;
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
function mix(a, b, gainB) { const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] || 0) + gainB * (b[i] || 0); return out; }
function concat(list) { let n = 0; for (const a of list) n += a.length; const out = new Float32Array(n);
  let p = 0; for (const a of list) { out.set(a, p); p += a.length; } return out; }

const mel = (ms, d, gap) => ms.map(m => [m, d, gap || 0]);
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
  pianoScale:   sr => synthPiano(sr, [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52, 50, 48, 50, 52].map((m, i) => [0.1 + i * 0.25, m, 0.24]), 6.6, 0.18, 51)
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
  { name: 'Talking, low voice', clip: 'talk', music: false },
  { name: 'Talking, high voice', clip: 'talkHigh', music: false },
  { name: 'Talking, flat monotone', clip: 'talkFlat', music: false },
  { name: 'Loud hiss (white noise)', clip: 'white', music: false },
  { name: 'Fan-like rumble (pink noise)', clip: 'pink', music: false },
  { name: 'Clapping', clip: 'claps', music: false },
  { name: 'Quiet room', clip: 'quiet', music: false },
  { name: 'Constant mains hum (after it settles)', clip: 'hum', music: false, from: 18 }
];
/* One function per test, so a page can run them one at a time without freezing. */
function detectionTests(sr) {
  sr = sr || 44100;
  const list = DETECTION_CASES.map(c => ({ name: c.name, run: () => {
    const x = CLIPS[c.clip](sr), tl = analyzeClip(x, sr), end = x.length / sr;
    const fr = fraction(tl, c.from != null ? c.from : (c.music ? 1.2 : 0), end);
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
  // the session summary
  list.push({ name: 'Summary: where the time went', run: () => {
    const s = new Session(), step = (sec, m) => { for (let i = 0; i < sec * 10; i++) s.tick(0.1, m); };
    s.start(); step(60, true); step(3, false); step(60, true); step(40, false); step(30, true); s.pause(); step(20, true); s.resume(); step(10, false); s.stop();
    const R = sessionReport(s.runs), near = (a, b) => Math.abs(a - b) < 0.05, c = R.columns, line = reportSentence(R);
    const ok = near(R.total, 223) && near(R.play, 150) && near(R.quiet, 53) && near(R.paused, 20) && R.pauses === 1 && R.breaks === 1 && near(R.breakTime, 40)
      && near(R.longest.a, 0) && near(R.longest.b, 123) && R.bin === 60 && c.length === 4 && near(c[0].play, 60) && near(c[1].play, 57) && near(c[3].t, 43) && near(c[3].paused, 20) && near(c[3].play, 13) && R.best === null
      && line === 'The clock ran for 3:43. Of the 0:53 of quiet, 0:40 came from 1 break longer than 30 seconds. You paused once, for 20 seconds.';
    return { name: 'Summary: where the time went', expect: 'total 223 s: play 150, quiet 53, paused 20; 1 break; longest stretch 0 to 123 s across a 3 s gap; 4 minute columns',
      got: 'total ' + R.total.toFixed(1) + ', play ' + R.play.toFixed(1) + ', quiet ' + R.quiet.toFixed(1) + ', paused ' + R.paused.toFixed(1) + ', ' + R.breaks + ' break, longest ' + R.longest.a.toFixed(1) + ' to ' + R.longest.b.toFixed(1) + ' s, ' + c.length + ' columns | ' + line, pass: ok }; } });
  list.push({ name: 'Summary: start, middle, end and the best 10 minutes', run: () => {
    const s = new Session(); s.start();
    for (let i = 0; i < 600; i++) s.tick(1, true);                       // the first 10 minutes all playing
    for (let i = 0; i < 600; i++) s.tick(1, Math.floor(i / 10) % 2 === 0);   // then 10 s on, 10 s off
    for (let i = 0; i < 600; i++) s.tick(1, Math.floor(i / 10) % 4 === 0);   // then 10 s on, 30 s off
    s.stop();
    const R = sessionReport(s.runs), th = R.thirds.map(x => Math.round(x * 100)), line = reportSentence(R);
    const ok = th.join() === '100,50,25' && R.best && R.best.a === 0 && R.best.len === 600 && R.best.eff === 1 && R.longest.a === 0 && R.longest.b === 610 && R.breaks === 0 && R.columns.length === 30
      && line === 'The clock ran for 30:00. Of the 12:30 of quiet, most was short gaps of under 30 seconds, such as page turns and restarting a phrase.';
    return { name: 'Summary: start, middle, end and the best 10 minutes', expect: 'thirds 100%, 50%, 25%; best 10 minutes from 0:00 at 100%; longest stretch 0:00 to 10:10',
      got: 'thirds ' + th.join('%, ') + '%; best from ' + (R.best ? clockText(R.best.a) + ' at ' + Math.round(R.best.eff * 100) + '%' : 'none') + '; longest ' + clockText(R.longest.a) + ' to ' + clockText(R.longest.b) + ' | ' + line, pass: ok }; } });
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
    const d = new DashSim(), ev = []; let tCrash = -1, x1 = 0, x2 = 0;
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
  return list;
}
function runDetectionTests(sr) { return detectionTests(sr).map(t => t.run()); }

/* ---------- Session clock ---------- */
class Session {
  constructor() { this.goal = 1800; this.reset(); }
  reset() { this.state = 'idle'; this.total = 0; this.active = 0; this.play = 0; this.pauses = 0;
    this.buckets = []; this.ba = 0; this.bp = 0; this.startedAt = 0; this.stoppedAt = 0;
    this.runs = []; }   // the whole session as [kind, seconds, kind, seconds, ...]; kind 0 playing, 1 quiet while running, 2 paused
  start() { this.reset(); this.state = 'running'; this.startedAt = Date.now(); }
  pause() { if (this.state !== 'running') return false; this.state = 'paused'; this.pauses++; return true; }
  resume() { if (this.state !== 'paused') return false; this.state = 'running'; return true; }
  stop() { if (this.state !== 'running' && this.state !== 'paused') return false; this.state = 'stopped'; this.stoppedAt = Date.now(); return true; }
  /* dt seconds have passed; music = instrument heard during that time */
  tick(dt, music) {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.total += dt;
    const k = this.state !== 'running' ? 2 : music ? 0 : 1, r = this.runs, n = r.length;
    if (dt > 0) { if (n && r[n - 2] === k) r[n - 1] += dt; else r.push(k, dt); }
    if (this.state !== 'running') return;
    this.active += dt; const p = music ? dt : 0; this.play += p;
    this.ba += dt; this.bp += p;
    if (this.ba >= 1) { this.buckets.push(this.ba, this.bp); if (this.buckets.length > 120) this.buckets.splice(0, 2); this.ba = 0; this.bp = 0; }
  }
  get efficiency() { return this.active > 0 ? Math.min(1, this.play / this.active) : 0; }
  get recentEfficiency() { let a = this.ba, p = this.bp; for (let i = 0; i < this.buckets.length; i += 2) { a += this.buckets[i]; p += this.buckets[i + 1]; } return a > 0 ? Math.min(1, p / a) : 0; }
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
function clockText(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; }
/* 75 -> "1 minute and 15 seconds" */
function spokenTime(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), x = s % 60, unit = (v, w) => v + ' ' + w + (v === 1 ? '' : 's');
  return !m ? unit(x, 'second') : unit(m, 'minute') + (x && m < 10 ? ' and ' + unit(x, 'second') : ''); }
/* the sentence under "Where the time went" */
function reportSentence(R) {
  if (R.total <= 0) return '';
  if (R.active < 1) return 'The timer was paused the whole time.';
  let s = 'The clock ran for ' + clockText(R.total) + '. ';
  if (R.play < 1) s += 'No playing was heard while the timer ran.';
  else if (R.quiet <= R.active * 0.05) s += 'Almost all of the running time was playing.';
  else if (R.breakTime <= R.gapTime) s += 'Of the ' + clockText(R.quiet) + ' of quiet, most was short gaps of under 30 seconds, such as page turns and restarting a phrase.';
  else s += 'Of the ' + clockText(R.quiet) + ' of quiet, ' + clockText(R.breakTime) + ' came from ' + (R.breaks === 1 ? '1 break' : R.breaks + ' breaks') + ' longer than 30 seconds.';
  if (R.pauses) s += ' You paused ' + (R.pauses === 1 ? 'once, for ' : R.pauses + ' times, for ') + spokenTime(R.paused) + (R.pauses === 1 ? '.' : ' in all.');
  return s;
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

const api = { LIFTOFF, OnsetTracker, WheelSwipe, DashSim, DASH, dashSpeed, MusicDetector, Session, RocketSim, WORLD, MILESTONES, SENSITIVITY, CLIPS, DETECTION_CASES,
  detectionTests, runDetectionTests, analyzeClip, sessionReport, reportSentence, clockText, spokenTime, fraction, heardAs, noteOf, smooth, pchip, clamp01 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MT = api;
})(typeof self !== 'undefined' ? self : this);
