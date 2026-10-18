'use strict';
const { seededRng } = require('../../core.js');
/* Fireworks: shells rise while you play, and every note sets one off. Pure logic, no DOM: view.js and view3d.js draw it, tests.js checks it.
   While the music plays, shells go up and wait in the sky as glowing embers: a pace of PACE shells a second at full intensity (FLOOR at the
   least), up to AIRMAX + AIRPER x intensity waiting at once. The last minute of playing (Session.recentEfficiency) is that intensity, shown as
   Intensity. Each note starting sets off the shell in the sky (waiting, or READY of the way up) whose height is nearest the note's (low notes the low ones,
   high notes the high ones), and it bursts in the note's colour (the twelve notes are twelve colours, a fifth apart round the colour wheel,
   so the notes of a scale all look different), its size and kind from the intensity (small round ones at first, rings and chrysanthemums, then
   willows, palms and crossettes). A note with no shell ready makes the next burst bigger. A shell no note sets off for WAIT seconds fades
   and falls. When the music starts a shell goes up at once, so the first note has something to set off. Nothing goes up while quiet; a pause
   holds everything where it is; stopping lets every waiting shell fall. Now and then (SYMBOL) a burst takes the shape of a musical symbol
   (fwSymbolShape). Reaching the practice goal sets off a grand finale once: FINALE shells over FINALE_T seconds that burst by themselves, the
   last into the shape of a trophy (fwTrophyShape), then a 'finaleEnd' event TROPHY_T seconds later, when the trophy card can show. The finale
   only plays while the theme is on screen (shown), so it waits for the player to come to it, and it holds through a pause like the clock.
   Events: {k:'launch', id, x, h}, {k:'burst', id, x, h, size, hue, hue2, kind, pc, symbol}, {k:'fizzle', id}, and for the finale {k:'finale'},
   {k:'shell', ...} (goes up and bursts by itself) and {k:'finaleEnd'}. The views only draw what this decides. */
const FW = { PACE: 3, FLOOR: 0.5, AIRMAX: 3, AIRPER: 7, WAIT: 2.5, READY: 0.8, AIR: 3.5, CHARGE: 0.15, FINALE: 28, FINALE_T: 7, LULL: 1.4, TROPHY_T: 3.6, SYMBOL: 0.13, SYMBOL_GAP: 6,
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
    this.shells = 0; this.notes = 0; this.charge = 0; this.due = 0; this.lastHue = -1; this.t = 0; this.up = []; this.symbolAt = -1e9; this.symbol = '';
    this.air = []; this.nid = 0; this.clock = 0; this.was = false; this.intensity = 0;                // the shells in the sky, each {id, x, h, at (clock when sent), rise (s)}
    this.finaleDone = false; this.finaleLeft = 0; this.finaleT = 0; this.finaleOn = false; this.events = [];
  }
  get colours() { let n = 0; for (let b = this.notes; b; b &= b - 1) n++; return n; }   // how many of the twelve notes have gone up
  get inFinale() { return this.finaleOn; }
  get aloft() { return this.air.length + this.up.length; }                    // about how many are in the sky now: waiting, and set off in the last AIR seconds
  get cap() { return FW.AIRMAX + FW.AIRPER * this.intensity; }
  /* i: {state, music, notes (note starts since the last update), midi (the pitch heard, fractional key number, or null), recent (last minute, 0..1), play (s),
     shown (the theme is on screen)} */
  update(dt, i) {
    const recent = this.intensity = Math.max(0, Math.min(1, i.recent || 0)), running = i.state === 'running';
    this.t += dt; while (this.up.length && this.t - this.up[0] > FW.AIR) this.up.shift();
    if (running) {
      this.clock += dt;
      if (i.music) {
        this.due += dt * Math.max(FW.FLOOR, FW.PACE * recent);
        if (!this.was && !this.air.length) this.due = Math.max(this.due, 1);   // the music starts: a shell goes up at once
        while (this.due >= 1 && this.air.length < this.cap) { this.send(); this.due -= 1; }
        this.due = Math.min(this.due, 1);
        let n = i.notes || 0;
        while (n > 0 && this.air.some(a => this.ready(a))) { this.burst(i.midi, recent); n--; }
        if (n > 0) this.charge = Math.min(1, this.charge + n * FW.CHARGE);         // notes with nothing ready in the sky: the next burst is bigger
      }
      for (let k = this.air.length - 1; k >= 0; k--) { const a = this.air[k]; if (this.clock - a.at > a.rise + FW.WAIT) { this.air.splice(k, 1); this.events.push({ k: 'fizzle', id: a.id }); } }
    } else if (i.state !== 'paused') { for (const a of this.air) this.events.push({ k: 'fizzle', id: a.id }); this.air.length = 0; }   // a pause holds them; stopping lets them fall
    this.was = running && !!i.music;
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
  /* a shell goes up to wait; rise is about how long it takes to get there, as the renderers draw it */
  send() {
    const r = this.rnd, h = 0.4 + r() * 0.45, a = { id: ++this.nid, x: 0.15 + r() * 0.7, h: h, at: this.clock, rise: 0.8 + 0.55 * h };
    this.air.push(a); this.events.push({ k: 'launch', id: a.id, x: a.x, h: a.h });
  }
  /* a shell a note can set off: nearly at the top of its climb (READY of the way), so a burst never happens down among the roofs */
  ready(a) { return this.clock - a.at >= a.rise * FW.READY; }
  /* a note sets off the ready shell nearest its height, in its colour */
  burst(midi, recent) {
    const r = this.rnd, known = midi != null && isFinite(midi), pc = known ? ((Math.round(midi) % 12) + 12) % 12 : Math.floor(r() * 12), hue = fwHue(pc);
    const want = known ? 0.45 + Math.max(0, Math.min(1, (midi - 40) / 50)) * 0.45 : 0.4 + r() * 0.45;   // low notes the low shells, high notes the high ones
    let best = -1; for (let k = 0; k < this.air.length; k++) if (this.ready(this.air[k]) && (best < 0 || Math.abs(this.air[k].h - want) < Math.abs(this.air[best].h - want))) best = k;
    const a = this.air.splice(best, 1)[0], kinds = FW.KINDS.filter(k => recent >= k[0]).map(k => k[1]), kind = kinds[Math.floor(r() * kinds.length)];
    const e = { k: 'burst', id: a.id, x: a.x, h: a.h, size: Math.min(1.25, 0.3 + 0.7 * recent + this.charge * 0.4), hue: hue, hue2: recent >= 0.6 && this.lastHue !== hue ? this.lastHue : -1, kind: kind, pc: pc };
    if (this.t - this.symbolAt >= FW.SYMBOL_GAP && r() < FW.SYMBOL) {   // now and then the burst takes the shape of a musical symbol, in the note's colour; never the same one twice running
      const pick = FW_SYMBOLS.filter(n => n !== this.symbol); e.kind = 'symbol'; e.symbol = this.symbol = pick[Math.floor(r() * pick.length)]; e.hue2 = -1; this.symbolAt = this.t;
    }
    this.events.push(e);
    this.charge = 0; this.lastHue = hue; this.shells++; this.notes |= 1 << pc; this.up.push(this.t);
  }
}

module.exports = { FW, FW_SYMBOLS, FireworkSim, fwHue, fwSymbolShape, fwTrophyShape };
