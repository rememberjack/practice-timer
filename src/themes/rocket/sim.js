'use strict';
const { clamp01, dayKey } = require('../../core.js');
/* Rocket: the flight model, from the launch pad to Moon orbit, and where a day's flight carries on from. Pure logic, no DOM: view.js draws it, tests.js checks it. */
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

/* World units are Earth radii; Earth is centred at (0,0) and the pad is at (0,1). Everything is to scale: a 100 m rocket, the edge of space
   100 km up, Earth orbit 191 km up, and the Moon 1,737 km in radius and 384,400 km away, its orbit 110 km above its ground. */
const KM = 1 / 6371, R_KM = 6371, MU = 398600.4418;   // Earth's radius and gravitational parameter (km, km³/s²)
const WORLD = { ROCKET_H: 0.1 * KM, SPACE: 100 * KM, MOON: { x: 0, y: 0, r: 1737.4 * KM }, ORBIT: (1737.4 + 110) * KM, DIST: 384400 * KM };
/* Flight timeline, in seconds of playing since ignition (E0). Up to Earth orbit it keeps a real flight's time (Apollo 11's Saturn V):
   E1 clear the tower 8 s, E2 stage 1 separation 2:43 (67 km up), E3 the edge of space 3:25 (100 km); Earth orbit (191 km) at 11:50, a minute's
   coast and a minute's burn for the Moon (PHASES), E4 stage 2 separation 14:10; then the three-day coast to the Moon, sped up about 275 times,
   so that E5, Moon orbit, comes at 30:00; E6 send the module spinning about its length and keep orbiting. Each step is from the one before. */
const STEPS = [['tower', 8], ['stage1', 155], ['space', 42], ['stage2', 645], ['orbit', 950]];
const MILESTONES = {}; (function () { let t = 0; for (const s of STEPS) { t += s[1]; MILESTONES[s[0]] = t; } })();
const PHASES = { insert: 710, tli: 770, coast: 830 };   // Earth orbit, the burn for the Moon (TLI) and the coast after it
const LIFTOFF = 0.5;   // engine power the rocket needs, held for HOLD seconds, to leave the pad
const HOLD = 1, ORBIT_PERIOD = 60, WRECK = 2.6, SPIN_AT = 3, SPIN_UP = 4, SPIN = 2 * Math.PI * 0.6;   // E6: 3 s after arrival the module starts to roll about its long axis, reaching 0.6 turns a second
const TILT = 26 * Math.PI / 180;
/* the climb to Earth orbit: seconds since ignition, height (km) and distance downrange (km). Off the pad at about half a g and past the tower at
   8 s; then Apollo 11's: stage 1 separation at 67 km and 94 km downrange, 96 km up at 3:18, stage 2 cut-off at 186 km, orbit at 191 km */
const CLIMB = [[0, 0, 0], [HOLD, 0, 0], [8, 0.115, 0], [30, 1.44, 0.1], [60, 5.77, 1.5], [84, 13.5, 6], [106, 24, 18], [136, 44.4, 50], [163, 67, 94],
  [199, 96, 186], [241, 120, 306], [301, 145, 504], [361, 160, 738], [421, 171, 1011], [461, 179, 1217], [549, 186, 1745], [621, 189, 2235], [PHASES.insert, 191, 2800]];

/* The flight path, built once along the timeline: points (x, y) at each time (t), with the distance along the path to each (l) and the height
   above Earth (km). The climb, then Earth orbit at 7.8 km/s, the burn for the Moon to 10.83 km/s at 336 km, and from there a Kepler orbit round
   Earth (the Moon's own pull left out), whose far end reaches the Moon's distance three days later. The Moon is where the rocket meets its
   orbit on a tangent, one orbit radius to the rocket's right, so it passes behind the Moon and goes round it clockwise. */
const PATH = (function () {
  const Ro = WORLD.ORBIT, P = PHASES, ts = [], xs = [], ys = [], ls = [], ks = [];
  const add = (t, x, y) => { const n = xs.length; ls.push(n ? ls[n - 1] + Math.hypot(x - xs[n - 1], y - ys[n - 1]) : 0); ts.push(t); xs.push(x); ys.push(y); ks.push((Math.hypot(x, y) - 1) * R_KM); };
  const put = (t, h, d) => { const a = d / R_KM, r = 1 + h / R_KM; add(t, r * Math.sin(a), r * Math.cos(a)); };   // d downrange, round Earth clockwise from the pad
  const V0 = 7.8 * R_KM / (R_KM + 191), H1 = 336, V1 = 10.83;                                                        // ground speed in orbit; the burn's end
  const hC = pchip(CLIMB.map(c => c[0]), CLIMB.map(c => c[1]), 0, 0), dC = pchip(CLIMB.map(c => c[0]), CLIMB.map(c => c[2]), 0, V0);
  for (let t = 0; t < P.insert; t += t < 60 ? 0.05 : 0.25) put(t, hC(t), dC(t));
  const d0 = dC(P.insert), d1 = d0 + V0 * (P.tli - P.insert), V1g = V1 * R_KM / (R_KM + H1);
  for (let t = P.insert; t < P.tli; t += 0.25) put(t, 191, d0 + V0 * (t - P.insert));
  for (let t = P.tli; t < P.coast; t += 0.25) { const u = (t - P.tli) / (P.coast - P.tli); put(t, 191 + (H1 - 191) * smooth(0, 1, u), d1 + (P.coast - P.tli) * (V0 * u + (V1g - V0) * u * u / 2)); }
  /* the coast: an ellipse with its nearest point to Earth where the burn ends */
  const r0 = R_KM + H1, a = 1 / (2 / r0 - V1 * V1 / MU), e = 1 - r0 / a, n = Math.sqrt(MU / (a * a * a)), f0 = (d1 + (P.coast - P.tli) * (V0 + V1g) / 2) / R_KM;
  const kep = E => { const r = a * (1 - e * Math.cos(E)) * KM, nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)); return { x: r * Math.sin(f0 + nu), y: r * Math.cos(f0 + nu) }; };
  let E = 0, M;                                                                                                       // where the coast ends: the Moon one orbit radius to the right
  for (;; E += 1e-5) { const q = kep(E), q2 = kep(E + 1e-6), dx = q2.x - q.x, dy = q2.y - q.y, d = Math.hypot(dx, dy), m = { x: q.x + Ro * dy / d, y: q.y - Ro * dx / d };
    if (Math.hypot(m.x, m.y) >= WORLD.DIST) { M = m; break; } }
  const Eend = E, tauEnd = (Eend - e * Math.sin(Eend)) / n, D = MILESTONES.orbit - P.coast, RAMP = 90;
  /* coast time sped up: from real time at the end of the burn to K times over RAMP seconds, K chosen so the coast takes D seconds */
  const K = 1 + (tauEnd - D) / (D - RAMP / 2), tau = t => { const x = Math.min(1, t / RAMP); return t + (K - 1) * (t < RAMP ? RAMP * (x * x * x - x * x * x * x / 2) : t - RAMP / 2); };
  const Eat = tm => { const Mn = n * tm; let E1 = Mn < Math.PI ? Mn + e / 2 : Mn; for (let i = 0; i < 40; i++) E1 -= (E1 - e * Math.sin(E1) - Mn) / (1 - e * Math.cos(E1)); return Math.min(E1, Eend); };
  for (let t = P.coast; t <= MILESTONES.orbit + 1e-9; t += 0.1) { const q = kep(Eat(tau(t - P.coast))); add(t, q.x, q.y); }
  const q = kep(Eend); add(MILESTONES.orbit + 0.1, q.x, q.y);
  const end = xs.length - 1;
  return { pt: Float64Array.from(ts), px: Float64Array.from(xs), py: Float64Array.from(ys), pl: Float64Array.from(ls), pk: Float64Array.from(ks), moon: M, K: K,
    th0: Math.atan2(ys[end] - M.y, xs[end] - M.x) };                                               // where it joins the Moon's orbit, seen from the Moon
})();
WORLD.MOON.x = PATH.moon.x; WORLD.MOON.y = PATH.moon.y;
const lerpAt = (xs, ys, x) => { let lo = 0, hi = xs.length - 1; if (x <= xs[0]) return ys[0]; if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]); };
/* distance along the path at each point of the timeline, and the height read-out (km above Earth) at each distance along it */
const TIMING = (function () {
  const T = MILESTONES, L = PATH.pl[PATH.pl.length - 1], lenAt = t => lerpAt(PATH.pt, PATH.pl, Math.min(t, T.orbit));
  return { lenAt, kmAt: l => lerpAt(PATH.pl, PATH.pk, l), kmAtAlt: a => a * R_KM, S1: lenAt(T.stage1), SP: lenAt(T.space), S2: lenAt(T.stage2), L };
})();

class RocketSim {
  constructor() {
    const RH = WORLD.ROCKET_H;
    this.px = PATH.px; this.py = PATH.py; this.pl = PATH.pl; this.S = PATH.pl.length - 1; this.L = TIMING.L; this.th0 = PATH.th0; this.tilt = TILT;
    this.lenAt = TIMING.lenAt; this.kmAt = TIMING.kmAt; this.kmAtAlt = TIMING.kmAtAlt;
    this.lTower = 0.95 * RH; this.lStage1 = TIMING.S1; this.lSpace = TIMING.SP; this.lStage2 = TIMING.S2;
    this.wOrbit = 2 * Math.PI / ORBIT_PERIOD;
    this.events = []; this.reset();
  }
  reset() { this.mode = 'pad'; this.l = 0; this.v = 0; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false;
    this.ignited = false; this.lit0 = false; this.fp = 0; this.power = 0; this.g = 0; this.prevT = 0; this.down = 0;
    this.th = this.th0; this.tOrb = 0; this.spinUp = 0; this.spinA = 0; this.events.length = 0; }
  /* how far along the flight plan the rocket is, from 0 on the pad to 1 in Moon orbit: four equal legs (to stage 1, the edge of space,
     stage 2 and the Moon), each filled by the playing it takes. Falling, it drops back with the rocket */
  plan() {
    if (this.mode === 'orbit') return 1;
    const T = MILESTONES, at = [0, T.stage1, T.space, T.stage2, T.orbit], fp = this.fp;
    let i = 0; while (i < 3 && fp >= at[i + 1]) i++;
    const p = Math.min(1, (i + clamp01((fp - at[i]) / (at[i + 1] - at[i]))) / 4);
    if (this.mode !== 'fall') return p;
    const l0 = this.lenAt(fp); return l0 > 0 ? p * clamp01(this.l / l0) : 0;
  }
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
    if (!x || (x.mode !== 'orbit' && !(x.mode === 'ascent' && x.inSpace)) || !n(x.fp, HOLD, 1e6) || !n(x.l, 0, 1e3) || !n(x.stage, 0, 2) || !n(x.th, -4, 4) || !n(x.tOrb, 0, 1e6)) return false;
    this.mode = x.mode; this.fp = x.fp; this.l = this.lenAt(x.fp); this.prevT = this.target(x.fp); this.stage = Math.round(x.stage); this.lit0 = true;
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
      this.th -= (0.004 + (this.wOrbit - 0.004) * smooth(0, 12, this.tOrb)) * rdt;              // clockwise, the way it came round Earth
      if (this.th < -Math.PI) this.th += 2 * Math.PI;
      const was = this.spinUp;                                                                      // E6: the module is sent spinning about its length
      this.spinUp = smooth(SPIN_AT, SPIN_AT + SPIN_UP, this.tOrb);
      if (was === 0 && this.spinUp > 0) this.events.push('spin');
      this.spin(rdt);
    }
  }
  spin(dt) { this.spinA = (this.spinA + SPIN * this.spinUp * dt) % (2 * Math.PI); }
  pose() {
    if (this.mode === 'orbit') { const M = WORLD.MOON, c = Math.cos(this.th), s = Math.sin(this.th), x = M.x + WORLD.ORBIT * c, y = M.y + WORLD.ORBIT * s;
      return { x: x, y: y, ang: Math.atan2(s, -c), alt: Math.max(0, Math.hypot(x, y) - 1) }; }
    const ls = this.pl, l = this.l; let lo = 0, hi = this.S;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ls[mid] <= l) lo = mid; else hi = mid; }
    const seg = ls[hi] - ls[lo], t = seg > 0 ? (l - ls[lo]) / seg : 0;
    const dx = this.px[hi] - this.px[lo], dy = this.py[hi] - this.py[lo];
    const x = this.px[lo] + dx * t, y = this.py[lo] + dy * t;
    return { x: x, y: y, ang: Math.atan2(dx, dy), alt: Math.max(0, Math.hypot(x, y) - 1) };
  }
}
/* the rocket flight to carry on today: where the day's latest saved session left it (null to start on the pad, as on a new day).
   from: when a new flight was last started; sessions that had ended by then no longer carry on, while one still running then does */
function rocketCarry(records, now, from) {
  const k = dayKey(now); let last = null;
  for (const r of records) if (dayKey(r.start) === k && !(from > 0 && (r.end || r.start) <= from) && (!last || r.start > last.start)) last = r;
  return last && last.themes && last.themes.rocket || null;
}
/* a saved rocket flight fp seconds of playing in (as RocketSim.save gives it), or null below the edge of space, where it would start on the pad */
function rocketAt(fp) {
  if (!(fp >= MILESTONES.space)) return null;
  const sim = new RocketSim();
  if (fp < MILESTONES.orbit) return { mode: 'ascent', fp: fp, l: Math.round(sim.lenAt(fp) * 1e7) / 1e7, stage: fp >= MILESTONES.stage2 ? 2 : 1, inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 0 };
  return { mode: 'orbit', fp: fp, l: sim.L, stage: 2, inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 60 };
}
/* a sample practice log (the debug tools): the rocket of each day's sessions, as if every session that day carried the flight on (records oldest first) */
function sampleFlights(records) {
  const flown = {}; for (const r of records) { const k = dayKey(r.start); flown[k] = (flown[k] || 0) + r.play; const at = rocketAt(flown[k]); if (at) r.themes.rocket = at; }
  return records;
}

module.exports = { HOLD, LIFTOFF, MILESTONES, PHASES, TILT, WORLD, RocketSim, pchip, rocketAt, rocketCarry, sampleFlights, smooth };
