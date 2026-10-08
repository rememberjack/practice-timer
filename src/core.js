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
    this.P = new Float32Array(half); this.E = new Float32Array(half);
    this.floor = new Float32Array(half); this.used = new Uint8Array(half);
    this.W = Math.max(4, Math.round(100 / this.binHz));
    this.kLo = Math.max(3, Math.ceil(70 / this.binHz));
    this.kHi = Math.min(N / 2 - this.W - 4, Math.floor(5000 / this.binHz));
    this.tmp = new Float32Array(2 * this.W + 1);
    this.peaks = []; for (let i = 0; i < 40; i++) this.peaks.push({ f: 0, p: 0 });
    this.hp = new Float64Array(17);
    this.pf = new Float64Array(4); this.pd = new Float64Array(4);
    this.lh = new Float64Array(5); this.ld = new Float64Array(5);
    this.setSensitivity(opts.sensitivity || 'normal');
    this.out = { levelDb: -120, active: false, tonal: false, ter: 0, pitch: 0, note: '', score: 0,
      isMusic: false, kind: 'quiet', label: 'Quiet', detail: '', instrument: '' };
    this.reset();
  }
  setSensitivity(name) { this.sens = SENSITIVITY[name] || SENSITIVITY.normal; }
  reset() {
    this.floor.fill(1e-9); this.pf.fill(0); this.pd.fill(0.05);
    this.score = 0; this.isMusic = false; this.run = 0; this.glideHold = 0; this.flat = 0; this.bridge = 0;
    this.lh.fill(-120); this.ld.fill(0.05);
    this.duty = 0; this.trans = 0; this.prevLevel = -120; this.prevLevel2 = -120;
    this.lm = -80; this.lv = 0;
    this.fall = 0.3; this.poly = 0; this.oddR = 0.6; this.rich = 5; this.lf0 = Math.log(330); this.instN = 0;
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

    // fundamental by harmonic matching
    const hp = this.hp; hp.fill(0);
    let f0 = 0, harm = 0;
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
        let Em = 0, wsum = 0, fsum = 0;
        for (let j = 0; j < np; j++) {
          const q = peaks[j], h = Math.round(q.f / bestF); if (h < 1 || h > 16) continue;
          if (Math.abs(q.f - h * bestF) > Math.min(0.03 * q.f + 0.5 * binHz, 0.3 * bestF)) continue;
          Em += q.p; if (q.p > hp[h]) hp[h] = q.p;
          if (h <= 5) { const w = Math.sqrt(q.p); wsum += w; fsum += w * q.f / h; }
        }
        harm = Em / Epk; f0 = wsum > 0 ? fsum / wsum : bestF;
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
    const lh = this.lh, ld = this.ld;
    for (let i = 0; i < 4; i++) { lh[i] = lh[i + 1]; ld[i] = ld[i + 1]; } lh[4] = level; ld[4] = dt;
    if (tonal) {
      // between attacks, does the level keep falling (struck/plucked) or hold (bowed/blown)?
      if (this.run >= ld[1] + ld[2] + ld[3] + ld[4]) {
        let onset = false; for (let i = 1; i < 5; i++) if (lh[i] - lh[i - 1] > 1) onset = true;
        if (!onset) this.fall += (((lh[4] - lh[0]) / (ld[1] + ld[2] + ld[3] + ld[4]) < -2 ? 1 : 0) - this.fall) * (1 - Math.exp(-dt / 0.8));
      }
      this.poly += ((harm < 0.6 && np >= 4 ? 1 : 0) - this.poly) * a15;
      if (pitch > 0) {
        const odd = hp[1] + hp[3] + hp[5] + hp[7], even = hp[2] + hp[4] + hp[6] + hp[8];
        let mx = 0, rich = 0; for (let h = 1; h <= 12; h++) if (hp[h] > mx) mx = hp[h];
        for (let h = 1; h <= 12; h++) if (hp[h] > 0.01 * mx) rich++;
        const a = 1 - Math.exp(-dt / 1.2);
        this.oddR += (odd / (odd + even + 1e-20) - this.oddR) * a;
        this.rich += (rich - this.rich) * a;
        this.lf0 += (Math.log(pitch) - this.lf0) * a;
        this.instN++;
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
  classify() {
    const f0 = Math.exp(this.lf0);
    if (this.fall > 0.5 || this.poly > 0.4) return INSTRUMENTS.piano;
    if (this.instN < 4) return f0 < 185 ? INSTRUMENTS.cello : INSTRUMENTS.violin;
    if (this.oddR > 0.9 && this.rich >= 2.5 && f0 < 1000) return INSTRUMENTS.clarinet;
    if (this.rich <= 3.3 && f0 >= 240) return INSTRUMENTS.flute;
    if (f0 < 185) return INSTRUMENTS.cello;
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
  hum:      sr => synthNoise(sr, 24, 'hum', 0.02, 28)
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
function topInstrument(tl) { const c = {}; let best = '', bn = 0;
  for (const f of tl) if (f.music && f.inst) { c[f.inst] = (c[f.inst] || 0) + 1; if (c[f.inst] > bn) { bn = c[f.inst]; best = f.inst; } } return best; }

const DETECTION_CASES = [
  { name: 'Violin melody with vibrato', clip: 'violin', music: true, inst: 'Violin' },
  { name: 'Fast violin scales', clip: 'violinFast', music: true },
  { name: 'Quiet violin over room noise', clip: 'violinQuiet', music: true },
  { name: 'Detached (staccato) notes', clip: 'staccato', music: true, min: 0.8 },
  { name: 'Cello, low notes', clip: 'cello', music: true, inst: 'Cello' },
  { name: 'Clarinet melody', clip: 'clarinet', music: true, inst: 'Clarinet' },
  { name: 'Flute melody', clip: 'flute', music: true, inst: 'Flute' },
  { name: 'Piano melody with chords', clip: 'piano', music: true, inst: 'Piano' },
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
    if (c.inst) { const ins = topInstrument(tl); got += ', heard as ' + (ins || 'nothing'); if (ins !== c.inst) pass = false; }
    return { name: c.name, expect: c.music ? 'music' : 'not music', got: got, pass: pass };
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
    let scr = 0, crashes = 0, jumps = 0, dist = 0;
    for (const eff of [0.3, 0.6, 0.9, 1]) { const d = new DashSim(); let acc = 0;
      for (let t = 0; t < 300; t += 1 / 60) { acc += 1 / 60; let on = 0; if (acc >= 0.37 + 0.3 * d.rnd()) { acc = 0; on = 1; } d.update(1 / 60, { running: true, music: true, eff: eff, onsets: on, progress: t / 300 }); }
      scr += d.scrapes; crashes += d.attempts - 1; jumps += d.jumps; dist += d.x; }
    return { name: 'Dash: never crashes while music is heard', expect: 'no crash and no touch at any speed, over 20 minutes', got: crashes + ' crashes, ' + scr + ' touches, ' + jumps + ' jumps, ' + Math.round(dist) + ' cube lengths run', pass: scr === 0 && crashes === 0 && jumps > 400 }; } });
  list.push({ name: 'Dash: silence crashes once after the grace time, short gaps do not', run: () => {
    const d = new DashSim(), ev = []; let tCrash = -1, x1 = 0, x2 = 0;
    const run = (sec, music) => { for (let t = 0; t < sec; t += 1 / 60) { d.update(1 / 60, { running: true, music: music, eff: 0.9, onsets: 0, progress: 0 }); while (d.events.length) { const e = d.events.shift(); if (e !== 'jump' && e !== 'land') ev.push(e); if (e === 'crash' && tCrash < 0) tCrash = clock; } clock += 1 / 60; } };
    let clock = 0; run(10, true); run(2, false); run(6, true); const mark = clock; run(12, false); const after = d.attempts; x1 = d.x; run(3, true); x2 = d.x;
    for (let t = 0; t < 5; t += 1 / 60) d.update(1 / 60, { running: false, music: true, eff: 0.9, onsets: 1, progress: 0 }); const frozen = d.x === x2;
    const ok = ev.filter(e => e === 'crash').length === 1 && Math.abs(tCrash - mark - DASH.GRACE) < 0.4 && after === 2 && x2 > x1 + 5 && frozen && d.scrapes === 0;
    return { name: 'Dash: silence crashes once after the grace time, short gaps do not', expect: 'a 2 s gap is survived; a long silence crashes once, ' + DASH.GRACE + ' s in; it runs again with the music; pause freezes it',
      got: 'crashes ' + ev.filter(e => e === 'crash').length + (tCrash >= 0 ? ', ' + (tCrash - mark).toFixed(1) + ' s into the silence' : '') + ', attempt ' + after + ', ' + (x2 > x1 + 5 ? 'ran on' : 'stuck') + ', ' + (frozen ? 'pause holds' : 'moved while paused'), pass: ok }; } });
  return list;
}
function runDetectionTests(sr) { return detectionTests(sr).map(t => t.run()); }

/* ---------- Session clock ---------- */
class Session {
  constructor() { this.goal = 1800; this.reset(); }
  reset() { this.state = 'idle'; this.total = 0; this.active = 0; this.play = 0; this.pauses = 0;
    this.buckets = []; this.ba = 0; this.bp = 0; this.startedAt = 0; }
  start() { this.reset(); this.state = 'running'; this.startedAt = Date.now(); }
  pause() { if (this.state !== 'running') return false; this.state = 'paused'; this.pauses++; return true; }
  resume() { if (this.state !== 'paused') return false; this.state = 'running'; return true; }
  stop() { if (this.state !== 'running' && this.state !== 'paused') return false; this.state = 'stopped'; return true; }
  /* dt seconds have passed; music = instrument heard during that time */
  tick(dt, music) {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.total += dt;
    if (this.state !== 'running') return;
    this.active += dt; const p = music ? dt : 0; this.play += p;
    this.ba += dt; this.bp += p;
    if (this.ba >= 1) { this.buckets.push(this.ba, this.bp); if (this.buckets.length > 120) this.buckets.splice(0, 2); this.ba = 0; this.bp = 0; }
  }
  get efficiency() { return this.active > 0 ? Math.min(1, this.play / this.active) : 0; }
  get recentEfficiency() { let a = this.ba, p = this.bp; for (let i = 0; i < this.buckets.length; i += 2) { a += this.buckets[i]; p += this.buckets[i + 1]; } return a > 0 ? Math.min(1, p / a) : 0; }
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
    this.hold = eff >= 0.8 ? this.hold + dt : 0;
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

/* ---------- Dash theme: a cube runs a neon course while music is heard ----------
   Units are cube widths. The cube is centred at x, with its base at height y above the ground.
   - While music is heard it runs (speed follows efficiency) and can never crash: it hops every obstacle by itself.
   - Each note start makes it jump as well, when there is room to land before the next obstacle.
   - When the music stops it coasts towards a spike; after GRACE seconds of silence it hits it and shatters.
     Then it waits at the same spot for the music, and the attempt number goes up. No play time is ever lost.
   Jumps are arcs drawn over distance, not time, so an obstacle is cleared at any speed. */
const DASH = { SPEED: 8, GRACE: 4, VMIN: 1, TAU: 0.8, CRASH: 0.9 };
function dashSpeed(eff) { return eff >= 0.95 ? { m: 1.6, tag: '3\u00D7' } : eff >= 0.8 ? { m: 1.3, tag: '2\u00D7' } : eff >= 0.5 ? { m: 1, tag: '1\u00D7' } : { m: 0.7, tag: '\u00BD\u00D7' }; }
class DashSim {
  constructor() { this.events = []; this.reset(); }
  reset() {
    this.mode = 'idle'; this.x = 0; this.y = 0; this.ang = 0; this.v = 0; this.arc = null; this.silentT = 0; this.crashT = 0; this.danger = null;
    this.attempts = 1; this.jumps = 0; this.scrapes = 0; this.done = false; this.progress = 0; this.tag = '1\u00D7';
    this.obs = []; this.marks = []; this.genX = 14; this.seed = 20261005; this.respawnX = 0; this.events.length = 0;
  }
  rnd() { let t = this.seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  grow() {                                                                  // keep the course built a screen and a half ahead
    while (this.genX < this.x + 60) { const r = this.rnd(), w = r < 0.5 ? 1 : r < 0.75 ? 2 : r < 0.88 ? 3 : 1, block = r >= 0.88;
      this.obs.push({ x: this.genX, w: w, h: block ? 1.6 : 0.9, kind: block ? 'block' : 'spike' }); this.genX += w + 7 + this.rnd() * 9; }
    while (this.obs.length && this.obs[0].x + this.obs[0].w < this.x - 30) this.obs.shift();
    while (this.marks.length && this.marks[0] < this.x - 30) this.marks.shift();
  }
  next() { for (const o of this.obs) if (o.x + o.w > this.x - 0.5) return o; return null; }
  startArc(x1, H, turns) { this.arc = { x0: this.x, x1: Math.max(x1, this.x + 0.8), H: H, a0: this.ang, turns: turns }; this.jumps++; this.events.push('jump'); }
  mark() { this.marks.push(this.x); }                                       // a checkpoint flag, dropped when the session is paused
  /* inp: {running, music, eff, onsets (note starts since the last call), progress (play time / goal)} */
  update(dt, inp) {
    if (!inp.running || !(dt > 0)) return;
    this.grow();
    this.progress = inp.progress || 0;
    if (!this.done && this.progress >= 1) { this.done = true; this.events.push('complete'); }
    const sp = dashSpeed(inp.eff || 0); this.tag = sp.tag;
    if (this.mode === 'crash') { this.crashT += dt; if (this.crashT >= DASH.CRASH) { this.mode = 'wait'; this.attempts++; this.y = 0; this.ang = 0; this.arc = null; this.v = 0; this.respawnX = this.x; this.events.push('attempt'); } return; }
    if (this.mode === 'idle' || this.mode === 'wait') { if (!inp.music) return; this.mode = 'run'; this.silentT = 0; this.events.push('go'); }
    // speed
    if (inp.music) { if (this.silentT > 0) { this.silentT = 0; this.danger = null; this.events.push('saved'); } this.v += (DASH.SPEED * sp.m - this.v) * Math.min(1, dt * 3); }
    else {
      if (this.silentT === 0) {                                             // the music has just stopped: clear the way and set the spike it will reach in GRACE seconds
        const v0 = Math.max(this.v, DASH.VMIN), D = DASH.VMIN * DASH.GRACE + (v0 - DASH.VMIN) * DASH.TAU * (1 - Math.exp(-DASH.GRACE / DASH.TAU));
        const at = Math.max(this.x + D + 0.5, this.arc ? this.arc.x1 + 1.5 : 0);
        this.obs = this.obs.filter(o => o.x + o.w < this.x - 0.5 || o.x > at + 3);
        this.danger = { x: at, w: 1, h: 0.9, kind: 'spike', danger: true }; this.obs.push(this.danger); this.obs.sort((a, b) => a.x - b.x);
        this.genX = Math.max(this.genX, at + 8);
      }
      this.silentT += dt; this.v = DASH.VMIN + (this.v - DASH.VMIN) * Math.exp(-dt / DASH.TAU);
    }
    this.x += this.v * dt;
    // jumping
    const o = this.next();
    if (inp.music && !this.arc) {
      const front = o ? o.x - 0.5 - this.x : 1e9;                           // gap to the next obstacle, measured from the cube's leading edge
      if (o && front <= 1.3) this.startArc(o.x + o.w + 0.5 + Math.max(1.3, front), Math.min(4, o.h + 1.3), o.w >= 3 ? 2 : 1);
      else if (inp.onsets > 0 && front >= 5.2) this.startArc(this.x + 3.2, 1.7, 1);
    }
    if (this.arc) { const a = this.arc, c = (a.x0 + a.x1) / 2, L = (a.x1 - a.x0) / 2, u = (this.x - c) / L;
      if (this.x >= a.x1) { this.y = 0; this.ang = a.a0 + a.turns * Math.PI / 2; this.arc = null; this.events.push('land'); }
      else { this.y = a.H * (1 - u * u); this.ang = a.a0 + a.turns * Math.PI / 2 * (this.x - a.x0) / (a.x1 - a.x0); } }
    // touching an obstacle
    if (o && this.x + 0.5 > o.x + 0.12 && this.x - 0.5 < o.x + o.w - 0.12 && this.y < o.h - 0.1) {
      if (!inp.music) { this.mode = 'crash'; this.crashT = 0; this.v = 0; this.silentT = 0; this.danger = null; this.obs = this.obs.filter(q => q !== o); this.events.push('crash'); }
      else this.scrapes++;                                                  // never expected; counted so the tests can prove it
    }
  }
}

const api = { OnsetTracker, DashSim, DASH, dashSpeed, MusicDetector, Session, RocketSim, WORLD, MILESTONES, SENSITIVITY, CLIPS, DETECTION_CASES,
  detectionTests, runDetectionTests, analyzeClip, fraction, topInstrument, noteOf, smooth, pchip, clamp01 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MT = api;
})(typeof self !== 'undefined' ? self : this);
