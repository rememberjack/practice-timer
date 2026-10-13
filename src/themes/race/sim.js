/* Grand Prix: the race, on session time. Pure logic, no DOM: view.js draws it, tests.js checks it. */
'use strict';
const { clamp01, seededRng } = require('../../core.js');
/* A ten-car race whose speeds are each player's efficiency over the last minute.
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
RACE.LAPU = RACE.LAP * RACE.SEG; RACE.KERB = 0.9; RACE.APEX = 0.86; RACE.BRAKE = 7000;   // braking for a bend, in road units a second squared   // a kerb where the bend is sharper than KERB; at the apex the inside tyres are on it
const RACE_PIT = { X: 1.48, HALF: 0.36, JOIN: 0.62, IN: 60, OUT: 80, LIMIT: 44 };   // LIMIT: segments of speed limit past the box before the bend out   // the pit lane: its middle and half-width (road half-widths), where it joins the track, the bends in and out (segments)
const raceGridX = p => p % 2 ? -0.42 : 0.42;                 // grid slot p (1 at the front): odd slots on the left
const raceWrap = l => l - Math.round(l);                    // a lead in laps, as the nearest place on the circuit
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
  return { n: N, curve: Float32Array.from(curve), y: Float32Array.from(y), ahead: ahead, boards: boards, line: raceLine(curve), corner: raceCorners(curve) };
}
/* How fast a car may take each segment, as a share of full speed: slower the sharper the bend (the hairpin at about 110 km/h, a fast
   sweeper a little under full speed), with the braking zone before each bend worked back from it, so the car arrives already slowed.
   Only the picture follows it: every car takes the same bends, so the race (distance, places, laps) comes from playing alone. */
function raceCorners(curve) {
  const N = curve.length, p = new Float32Array(N), V = RACE.VNOM, B = RACE.BRAKE * RACE.SEG * 2;
  for (let i = 0; i < N; i++) { const c = Math.abs(curve[i]); p[i] = c <= 0.5 ? 1 : Math.max(0.35, Math.min(1, 1 - 0.09 * c)); }
  for (let k = 2 * N - 1; k >= 0; k--) { const i = k % N, j = (i + 1) % N; p[i] = Math.min(p[i], Math.sqrt(p[j] * p[j] * V * V + B) / V); }   // twice round, so the last bend brakes into the first
  return p;
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
    const rnd = seededRng(this.seed), gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };   // a rival's form for the day
    this.cars = R.RIVALS.map((r, i) => ({ code: r[0], c1: r[1], c2: r[2], i: i, p: new RacePractiser(Math.max(0.3, Math.min(0.97, r[3] + R.FORM * gauss())), seededRng(this.seed * 31 + i * 7717 + 1)),   // each its own stream, so step sizes do not reorder the draws
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
      if (this.lit < 5) { if (music) { this.litT += dt; const n = Math.min(5, Math.floor(this.litT)); if (n > this.lit) { this.lit = n; ev.push('light'); if (n === 5) this.hold = 0.5 + seededRng(this.seed + 1)() * 1.3; } } }
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
  /* how fast a bend lets the car go at segment s (fractional), as a share of full speed */
  cornerAt(s) { const C = this.T.corner, n = this.T.n, i = Math.floor(s), u = s - i, a = ((i % n) + n) % n; return C[a] + (C[(a + 1) % n] - C[a]) * u; }
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
    const bend = this.cornerAt((this.d + R.PZ) / R.SEG);
    let vt = this.mode === 'race' && run ? Math.min(this.eff, bend) * R.VNOM : 0;   // the last minute's speed, or slower for a bend
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
      else this.v = Math.max(vt, this.v - (st === 'stopped' ? 6500 : vt < this.eff * R.VNOM - 1 ? R.BRAKE : 2400) * rdt);   // hard on the brakes for a bend
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

module.exports = { RACE, RACE_PIT, RacePractiser, RaceSim, raceTrack };
