'use strict';
const { seededRng } = require('../../core.js');
/* Fireworks: every note played sends a shell up into the night. Pure logic, no DOM: view.js and view3d.js draw it, tests.js checks it.
   A note starting launches a shell. Its colour is the note (the twelve notes are twelve colours, a fifth apart round the colour wheel, so the
   notes of a scale all look different) and its height is how high the note is. The last minute of playing (Session.recentEfficiency) sets how
   intense the show is, shown as Intensity: how many shells are in the sky at once, how big they are, and which kinds go up (small round ones at
   first, rings and chrysanthemums, then willows, palms and crossettes). While the music plays the show keeps a pace of PACE shells a second at
   full intensity: every note sends one up, and when the notes come slower than the pace, more go up in the colour of the note sounding (so a
   held note keeps the sky busy too). Only playing sends shells up: nothing goes up while quiet, paused or stopped. Fast runs cannot flood the
   sky: shells go up at most RATE + PER x intensity a second, and the notes over that make the next shell bigger. Reaching the practice goal sets
   off a grand finale once: FINALE shells over FINALE_T seconds, the last one bursting into the shape of a trophy (fwTrophyShape), then a
   'finaleEnd' event TROPHY_T seconds later, when the trophy card can show. The finale only plays while the theme is on screen (shown), so it waits
   for the player to come to it, and it holds through a pause like the clock. Now and then (SYMBOL) a shell bursts into a musical symbol
   (fwSymbolShape) in the colour of its note. The views only draw what this decides. */
const FW = { PACE: 3, RATE: 1, PER: 4, BURST: 2, BURSTPER: 3, AIR: 3.5, CHARGE: 0.15, FINALE: 28, FINALE_T: 7, LULL: 1.4, TROPHY_T: 3.6, SYMBOL: 0.13, SYMBOL_GAP: 6,   // SYMBOL: the chance a shell bursts into a musical symbol, at most one every SYMBOL_GAP s   // LULL: the quiet before the trophy goes up   // AIR: about how long a shell is in the sky, rising and burning
  KINDS: [[0, 'peony'], [0.3, 'ring'], [0.3, 'chrysanthemum'], [0.6, 'willow'], [0.6, 'palm'], [0.6, 'crossette']] };   // [intensity needed, kind]
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
/* the musical symbols a shell now and then bursts into: points along each outline, about step apart, in the trophy's units (1.5 high, centred on 0,
   y up). Note heads are tilted ovals, filled ones drawn as two rings; the clefs and the flat are smooth curves through a few points */
const FW_SYMBOLS = ['quarter', 'eighth', 'beamed', 'half', 'whole', 'treble', 'bass', 'sharp', 'flat'];
function fwSymbolShape(name, step) {
  step = step || 0.05; const out = [], dot = (x, y) => out.push([x, y]);
  const seg = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)); for (let i = 0; i <= n; i++) dot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); };
  const oval = (cx, cy, rx, ry, tilt) => { const n = Math.max(6, Math.round(Math.PI * (rx + ry) / step)), c = Math.cos(tilt), sn = Math.sin(tilt);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; dot(cx + x * c - y * sn, cy + x * sn + y * c); } };
  const curve = pts => {                                                    // a smooth line through the points (Catmull-Rom), spaced step apart
    const P = [pts[0]].concat(pts, [pts[pts.length - 1]]), fine = [];
    for (let k = 1; k < P.length - 2; k++) for (let t = 0; t < 1; t += 0.05) { const [a, b, c, d] = [P[k - 1], P[k], P[k + 1], P[k + 2]], t2 = t * t, t3 = t2 * t;
      fine.push([0, 1].map(m => 0.5 * (2 * b[m] + (c[m] - a[m]) * t + (2 * a[m] - 5 * b[m] + 4 * c[m] - d[m]) * t2 + (3 * b[m] - a[m] - 3 * c[m] + d[m]) * t3))); }
    fine.push(pts[pts.length - 1]); let left = 0; dot(fine[0][0], fine[0][1]);
    for (let k = 1; k < fine.length; k++) { left += Math.hypot(fine[k][0] - fine[k - 1][0], fine[k][1] - fine[k - 1][1]); if (left >= step) { dot(fine[k][0], fine[k][1]); left = 0; } } };
  const head = (x, y, filled) => { oval(x, y, 0.27, 0.18, 0.38); if (filled) oval(x, y, 0.13, 0.07, 0.38); };
  if (name === 'quarter' || name === 'eighth' || name === 'half') {
    head(-0.12, -0.57, name !== 'half'); seg(0.13, -0.5, 0.13, 0.75);
    if (name === 'eighth') curve([[0.13, 0.75], [0.3, 0.52], [0.48, 0.3], [0.42, 0.05]]);   // the flag
  } else if (name === 'beamed') {
    head(-0.42, -0.55, true); head(0.3, -0.4, true); seg(-0.17, -0.48, -0.17, 0.62); seg(0.55, -0.33, 0.55, 0.75);
    seg(-0.17, 0.62, 0.55, 0.75); seg(-0.17, 0.5, 0.55, 0.63);               // the beam
  } else if (name === 'whole') { oval(0, 0, 0.42, 0.27, 0); oval(0, 0, 0.11, 0.2, -0.75); }
  else if (name === 'treble') {
    curve([[0.04, -0.2], [0.16, -0.26], [0.18, -0.1], [0.04, 0.02], [-0.17, -0.06], [-0.25, -0.28], [-0.12, -0.48], [0.12, -0.5], [0.3, -0.36], [0.31, -0.1],
      [0.13, 0.12], [-0.1, 0.3], [-0.2, 0.5], [-0.12, 0.7], [0.02, 0.76], [0.08, 0.58], [0.01, 0.36], [-0.04, 0], [-0.02, -0.4], [0.0, -0.66], [-0.08, -0.75], [-0.2, -0.7]]);
    oval(-0.18, -0.64, 0.06, 0.06, 0);
  } else if (name === 'bass') {
    curve([[-0.32, 0.18], [-0.24, 0.36], [-0.04, 0.42], [0.16, 0.32], [0.22, 0.1], [0.1, -0.16], [-0.12, -0.38], [-0.36, -0.56]]);
    oval(-0.3, 0.16, 0.07, 0.07, 0); oval(0.4, 0.28, 0.05, 0.05, 0); oval(0.4, 0.02, 0.05, 0.05, 0);
  } else if (name === 'sharp') {
    seg(-0.15, -0.68, -0.15, 0.62); seg(0.15, -0.62, 0.15, 0.68);
    for (const y of [-0.2, 0.2]) { seg(-0.42, y - 0.08, 0.42, y + 0.08); seg(-0.42, y - 0.18, 0.42, y - 0.02); }
  } else if (name === 'flat') {
    seg(-0.2, -0.5, -0.2, 0.75); curve([[-0.2, -0.05], [0.05, 0.08], [0.24, 0.0], [0.16, -0.24], [-0.2, -0.5]]);
  }
  return out;
}
class FireworkSim {
  constructor() { this.reset(0, 1); }
  reset(goal, seed) {
    this.goal = goal || 0; this.seed = seed || 1; this.rnd = seededRng(this.seed);
    this.shells = 0; this.notes = 0; this.tokens = FW.BURST; this.charge = 0; this.due = 0; this.lastHue = -1; this.t = 0; this.up = []; this.symbolAt = -1e9; this.symbol = '';
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
    const size = Math.min(1.25, 0.3 + 0.7 * recent + this.charge * 0.4), e = { k: 'shell', x: 0.12 + r() * 0.76, h: Math.max(0.35, Math.min(0.95, h)), size: size, hue: hue, hue2: recent >= 0.6 && this.lastHue !== hue ? this.lastHue : -1, kind: kind, pc: pc };
    if (this.t - this.symbolAt >= FW.SYMBOL_GAP && r() < FW.SYMBOL) {   // now and then the shell bursts into a musical symbol, in the note's colour; never the same one twice running
      const pick = FW_SYMBOLS.filter(n => n !== this.symbol); e.kind = 'symbol'; e.symbol = this.symbol = pick[Math.floor(r() * pick.length)]; e.hue2 = -1; this.symbolAt = this.t;
    }
    this.events.push(e);
    this.tokens -= 1; this.charge = 0; this.lastHue = hue; this.shells++; this.notes |= 1 << pc; this.up.push(this.t);
  }
}

module.exports = { FW, FW_SYMBOLS, FireworkSim, fwHue, fwSymbolShape, fwTrophyShape };
