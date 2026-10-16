/* Invaders' logic, with no DOM: a fleet of 55 invaders marches side to side over four shields, and a laser cannon below shoots them down.
   Only playing moves the game on: while music is heard the fleet marches and the cannon charges its shots (faster the more of the last minute
   was played), so a wave falls quicker with a higher efficiency. In a quiet moment the invaders wait where they are, and they never come
   lower than just above the shields, so nothing is lost by stopping. Everything is in the arcade's own pixels (INV.W by INV.H), y downwards. */
'use strict';
const { seededRng } = require('../../core.js');
const { SPRITES } = require('./sprites.js');

const INV = {
  W: 224, H: 200,                       // the field
  COLS: 11, ROWS: 5, CELL: 16,          // the fleet: 11 by 5, one invader in each 16 px cell
  KINDS: ['bug', 'claw', 'claw', 'blob', 'blob'],   // by row, the top first
  POINTS: { bug: 30, claw: 20, blob: 10 },
  TOP: 30, START_DROP: 8, MAX_START: 24,   // the fleet's top row at the first wave; each wave starts a step lower, up to MAX_START
  DROP: 8, MARGIN: 4, STEP_PX: 2,       // it steps down this far at each edge; a march step is 2 px
  STEP: 1 / 60, MIN_STEP: 1 / 30,       // seconds per invader for one march step: the fewer are left, the faster they go
  UFO_Y: 12, UFO_V: 36, UFO_EVERY: 25, UFO_POINTS: [50, 100, 150, 300],   // the mystery ship: after this many seconds of playing
  SHIELD_Y: 150, SHIELD_X: 29, SHIELD_GAP: 48,
  CANNON_Y: 176, CANNON_V: 70, GROUND: 190,
  SHOT_V: 240, BOMB_V: 75, BOMB_EVERY: 1.4, BOMBS: 3,
  RATE: 0.15, RATE_PW: 0.35,            // shots charged a second while playing: RATE + RATE_PW × the last minute of playing
  NOTE_WINDOW: 0.6, HELD: 1.5, CHARGE_MAX: 2,   // a note just started fires a charged shot at once; a held note fires once 1.5 are charged
  NEXT_WAVE: 2,                         // seconds of playing between waves
  SUB: 1 / 120,                         // the longest step the sim takes, so a shot never jumps over an invader
};
const size = name => ({ w: SPRITES[name][0][0].length, h: SPRITES[name][0].length });
const SHIELD = size('shield'), CANNON = size('cannon'), UFO = size('ufo'), BOMB = size('bomb');
INV.FLOOR = INV.SHIELD_Y - 6;           // the lowest the fleet's bottom row comes

class InvaderSim {
  constructor(seed) { this.reset(seed); }
  reset(seed) {
    this.seed = seed || 1; this.rnd = seededRng(this.seed);
    this.score = 0; this.wave = 0; this.kills = 0; this.shots = 0; this.hits = 0; this.ufos = 0;
    this.cx = INV.W / 2; this.aimX = this.cx; this.shot = null; this.bombs = []; this.ufo = null; this.ufoT = 0; this.ufoSide = 1; this.bombT = 0;
    this.charge = 0; this.noteT = 0; this.frame = 0; this.gap = 0; this.played = 0; this.lowest = 0; this.events = [];
    this.newWave(); this.events = [];
  }
  newWave() {
    this.wave++; this.alive = new Array(INV.COLS * INV.ROWS).fill(true); this.left = this.alive.length;
    this.fx = (INV.W - INV.COLS * INV.CELL) / 2; this.fy = INV.TOP + Math.min(INV.MAX_START, (this.wave - 1) * INV.START_DROP);
    this.dir = 1; this.stepT = 0; this.bombs.length = 0; this.ufo = null;
    const bits = SPRITES.shield[0].join('').split('').map(c => c === 'X' ? 1 : 0);
    this.shields = []; for (let i = 0; i < 4; i++) this.shields.push({ x: INV.SHIELD_X + i * INV.SHIELD_GAP, bits: bits.slice() });
    this.shieldVer = (this.shieldVer || 0) + 1;
    this.events.push({ e: 'wave', wave: this.wave });
  }
  /* an invader's box: its sprite centred in its cell */
  box(i) { const col = i % INV.COLS, row = Math.floor(i / INV.COLS), w = size(INV.KINDS[row]).w;
    return { x: this.fx + col * INV.CELL + (INV.CELL - w) / 2, y: this.fy + row * INV.CELL, w: w, h: 8, row: row, col: col }; }
  interval() { return Math.max(INV.MIN_STEP, this.left * INV.STEP); }
  extent() {   // the left and right edges of the invaders still there, from the fleet's origin
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < this.alive.length; i++) if (this.alive[i]) { const b = this.box(i), x = b.x - this.fx; lo = Math.min(lo, x); hi = Math.max(hi, x + b.w); }
    return { lo: lo, hi: hi };
  }
  bottomRow() { for (let i = this.alive.length - 1; i >= 0; i--) if (this.alive[i]) return Math.floor(i / INV.COLS); return 0; }
  /* one step of the march: sideways, or down and back at an edge (never below the floor) */
  march() {
    const ex = this.extent();
    if (this.fx + (this.dir > 0 ? ex.hi : ex.lo) + this.dir * INV.STEP_PX > INV.W - INV.MARGIN || this.fx + ex.lo + this.dir * INV.STEP_PX < INV.MARGIN) {
      this.dir = -this.dir;
      this.fy = Math.min(this.fy + INV.DROP, Math.max(this.fy, INV.FLOOR - 8 - this.bottomRow() * INV.CELL));
    } else this.fx += this.dir * INV.STEP_PX;
    this.frame ^= 1;
    this.lowest = Math.max(this.lowest, this.fy + this.bottomRow() * INV.CELL + 8);
  }
  /* where the fleet's origin will be after t more seconds of marching, turning at the edges as it does */
  fleetX(t) {
    const iv = this.interval(), ex = this.extent(); let x = this.fx, d = this.dir, n = Math.floor((this.stepT + t) / iv);
    for (; n > 0; n--) { if (x + (d > 0 ? ex.hi : ex.lo) + d * INV.STEP_PX > INV.W - INV.MARGIN || x + ex.lo + d * INV.STEP_PX < INV.MARGIN) d = -d; else x += d * INV.STEP_PX; }
    return x;
  }
  /* where the cannon aims: under the mystery ship if a shot can still reach it, else under the nearest invader at the foot of its column,
     allowing for how far each moves while the shot climbs */
  aim(marching) {
    const flight = y => (INV.CANNON_Y - y) / INV.SHOT_V;
    if (this.ufo) { const t = flight(INV.UFO_Y + UFO.h), x = this.ufo.x + this.ufo.v * t;
      if (x > 10 && x < INV.W - 10 && Math.abs(x - this.cx) / INV.CANNON_V < Math.abs((INV.W - 10 - this.ufo.x) / this.ufo.v)) return x; }
    let best = null, bestD = 1e9;
    for (let col = 0; col < INV.COLS; col++) {
      let i = -1; for (let row = INV.ROWS - 1; row >= 0; row--) if (this.alive[row * INV.COLS + col]) { i = row * INV.COLS + col; break; }
      if (i < 0) continue;
      const b = this.box(i), t = flight(b.y + b.h), x = b.x + b.w / 2 + (marching ? this.fleetX(t) - this.fx : 0), d = Math.abs(x - this.cx);
      if (d < bestD) { bestD = d; best = x; }
    }
    return best == null ? this.cx : best;
  }
  /* o: { running, music, pw (the last minute of playing, 0..1), notes (note starts since the last update) } */
  update(dt, o) {
    if (!o.running || !(dt > 0)) return;              // a pause holds everything where it is
    if (o.notes) this.noteT = INV.NOTE_WINDOW;
    dt = Math.min(dt, 5);
    while (dt > 1e-9) { const h = Math.min(INV.SUB, dt); this.step(h, !!o.music, Math.max(0, Math.min(1, o.pw || 0))); dt -= h; }
  }
  step(dt, music, pw) {
    const ev = this.events;
    this.noteT = Math.max(0, this.noteT - dt);
    if (music) { this.played += dt; this.charge = Math.min(INV.CHARGE_MAX, this.charge + dt * (INV.RATE + INV.RATE_PW * pw)); }
    if (this.gap > 0) { if (music) { this.gap -= dt; if (this.gap <= 0) { this.gap = 0; this.newWave(); } } }
    else if (music) {
      this.stepT += dt; let iv = this.interval();
      while (this.stepT >= iv) { this.stepT -= iv; this.march(); iv = this.interval(); }
      this.bombT += dt;
      if (this.bombT >= INV.BOMB_EVERY) { this.bombT = 0; this.drop(); }
      this.ufoT += dt;
      if (this.ufoT >= INV.UFO_EVERY && !this.ufo && this.left >= 8) { this.ufoT = 0; this.ufoSide = -this.ufoSide; this.ufo = { x: this.ufoSide > 0 ? -UFO.w : INV.W + UFO.w, v: this.ufoSide * INV.UFO_V }; ev.push({ e: 'ufoIn' }); }
    }
    /* the cannon lines up its shot, and fires while playing */
    this.aimX = Math.max(CANNON.w / 2 + 2, Math.min(INV.W - CANNON.w / 2 - 2, this.aim(music)));
    const mv = INV.CANNON_V * dt, dx = this.aimX - this.cx; this.cx += Math.abs(dx) <= mv ? dx : Math.sign(dx) * mv;
    if (music && !this.shot && (this.gap <= 0 || this.ufo) && Math.abs(this.aimX - this.cx) < 1 && (this.charge >= INV.HELD || (this.charge >= 1 && this.noteT > 0))) {
      this.charge -= 1; this.noteT = 0; this.shots++; this.shot = { x: Math.round(this.cx), y: INV.CANNON_Y - 4 }; ev.push({ e: 'fire' });
    }
    if (this.shot) this.moveShot(dt);
    for (let k = this.bombs.length - 1; k >= 0; k--) if (this.moveBomb(this.bombs[k], dt)) this.bombs.splice(k, 1);
    if (this.ufo) { this.ufo.x += this.ufo.v * dt; if (this.ufo.x < -UFO.w * 1.5 || this.ufo.x > INV.W + UFO.w * 1.5) { this.ufo = null; ev.push({ e: 'ufoOut' }); } }
  }
  moveShot(dt) {
    const s = this.shot, ev = this.events; s.y -= INV.SHOT_V * dt;
    if (s.y < 0) { this.shot = null; ev.push({ e: 'miss', x: s.x, y: 0 }); return; }
    const u = this.ufo;
    if (u && s.x >= u.x - UFO.w / 2 && s.x < u.x + UFO.w / 2 && s.y < INV.UFO_Y + UFO.h && s.y + 4 > INV.UFO_Y) {
      const pts = INV.UFO_POINTS[Math.floor(this.rnd() * INV.UFO_POINTS.length)];
      this.score += pts; this.ufos++; this.hits++; this.shot = null; this.ufo = null; ev.push({ e: 'ufo', x: u.x, pts: pts }); return;
    }
    for (const b of this.bombs) if (Math.abs(b.x - s.x) <= 2 && s.y < b.y + BOMB.h && s.y + 4 > b.y) {   // a shot and a bomb meet: both go
      this.bombs.splice(this.bombs.indexOf(b), 1); this.shot = null; ev.push({ e: 'clash', x: s.x, y: s.y }); return; }
    const col = Math.floor((s.x - this.fx) / INV.CELL), row = Math.floor((s.y - this.fy) / INV.CELL);
    for (const r of [row, row - 1]) {
      if (col < 0 || col >= INV.COLS || r < 0 || r >= INV.ROWS) continue;
      const i = r * INV.COLS + col; if (!this.alive[i]) continue;
      const b = this.box(i);
      if (s.x >= b.x && s.x < b.x + b.w && s.y < b.y + b.h && s.y + 4 > b.y) {
        const kind = INV.KINDS[r]; this.alive[i] = false; this.left--; this.kills++; this.hits++; this.score += INV.POINTS[kind]; this.shot = null;
        ev.push({ e: 'kill', x: b.x + b.w / 2, y: b.y + b.h / 2, kind: kind });
        if (!this.left) { this.gap = INV.NEXT_WAVE; this.bombs.length = 0; ev.push({ e: 'cleared', wave: this.wave }); }
        return;
      }
    }
  }
  /* an invader at the foot of a column drops a bomb */
  drop() {
    if (this.bombs.length >= INV.BOMBS) return;
    const cols = []; for (let col = 0; col < INV.COLS; col++) for (let row = INV.ROWS - 1; row >= 0; row--) if (this.alive[row * INV.COLS + col]) { cols.push(row * INV.COLS + col); break; }
    if (!cols.length) return;
    const b = this.box(cols[Math.floor(this.rnd() * cols.length)]);
    this.bombs.push({ x: Math.round(b.x + b.w / 2), y: b.y + b.h, t: 0 });
  }
  /* true when the bomb is gone: into a shield (wearing it away), onto the cannon (which it cannot harm) or the ground */
  moveBomb(b, dt) {
    b.y += INV.BOMB_V * dt; b.t += dt;
    const foot = Math.floor(b.y + BOMB.h - 1), ev = this.events;
    for (const sh of this.shields) {
      const lx = Math.floor(b.x - sh.x), ly = foot - INV.SHIELD_Y;
      if (lx < 0 || lx >= SHIELD.w || ly < 0 || ly >= SHIELD.h) continue;
      if (sh.bits[ly * SHIELD.w + lx]) { this.erode(sh, lx, ly); ev.push({ e: 'shield', x: b.x, y: foot }); return true; }
    }
    if (Math.abs(b.x - this.cx) < CANNON.w / 2 && foot >= INV.CANNON_Y) { ev.push({ e: 'block', x: b.x, y: INV.CANNON_Y }); return true; }
    if (foot >= INV.GROUND - 1) { ev.push({ e: 'ground', x: b.x, y: INV.GROUND - 2 }); return true; }
    return false;
  }
  erode(sh, lx, ly) {
    for (let dy = -1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = lx + dx, y = ly + dy; if (x < 0 || x >= SHIELD.w || y < 0 || y >= SHIELD.h) continue;
      if ((!dx && dy <= 1) || this.rnd() < 0.55 - Math.abs(dx) * 0.08) sh.bits[y * SHIELD.w + x] = 0;
    }
    this.shieldVer++;
  }
  /* what a saved session keeps (keep), and the best score in the practice log */
  save() { return { score: this.score, wave: this.wave, kills: this.kills }; }
}
function hiScore(log) {
  let hi = 0;
  for (const r of log || []) { const t = r && r.themes && r.themes.invaders; if (t && t.score > hi) hi = t.score; }
  return hi;
}
module.exports = { INV, InvaderSim, hiScore, size };
