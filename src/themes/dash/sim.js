'use strict';
/* Dash: a cube runs a neon course while music is heard. Pure logic, no DOM: view.js draws it, tests.js checks it.
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

module.exports = { DASH, DASH_PIECES, DashSim, dashSpeed };
