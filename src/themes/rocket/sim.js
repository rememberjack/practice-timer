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

/* The flight path, built once: arrays of points (x, y) with the distance along the path to each (l), the way a real flight to the Moon goes.
   E0-E3, the ascent: straight up past the tower, then a gravity turn. The rocket pitches over to the right, 20° from upright by stage 1 separation,
   and keeps turning as it climbs until it flies level at the edge of space, in a parking orbit round Earth at 1 + SPACE.
   E3-E4, the parking orbit: on round Earth to the side away from where it will meet the Moon.
   E4, translunar injection, then the transfer: half an ellipse with Earth at one focus, out to the Moon, fast near Earth and slow near the Moon,
   as Kepler has it. It meets the Moon's orbit on a tangent on its near side and goes round the other way: a figure of eight, as the Apollo flights flew. */
const PATH = (function () {
  const RH = WORLD.ROCKET_H, H = WORLD.SPACE, R = 1 + H, M = WORLD.MOON, Ro = WORLD.ORBIT;
  const xs = [0], ys = [1], ls = [0], hs = [0], push = (x, y) => { ls.push(ls[ls.length - 1] + Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1])); xs.push(x); ys.push(y); };
  /* the ascent, by height: the angle from upright grows to G1 by stage 1 (H1), then turns level on a square-root curve, so it meets the circle
     of the parking orbit smoothly, after a quarter of the way round Earth */
  const HA = 2 * RH, H1 = 0.026, G1 = 20 * Math.PI / 180;
  const tilt = h => h < H1 ? G1 * smooth(Math.log(HA), Math.log(H1), Math.log(Math.max(h, 1e-12))) : Math.PI / 2 - (Math.PI / 2 - G1) * Math.sqrt(Math.max(0, H - h) / (H - H1));
  let h = 0, phi = Math.PI / 2;
  while (H - h > 1e-9) { const dh = Math.min(Math.max(RH * 0.05, h * 0.003), (H - h) * 0.02, 0.01);
    phi -= Math.tan(tilt(h + dh / 2)) * dh / (1 + h + dh / 2); h += dh; push((1 + h) * Math.cos(phi), (1 + h) * Math.sin(phi)); hs.push(h); }
  const lSpace = ls[ls.length - 1], nAscent = ls.length;
  /* where the transfer ends: on the line from Earth to the Moon, one orbit radius short of the Moon; it starts on the far side of Earth */
  const toMoon = Math.atan2(M.y, M.x), ra = Math.hypot(M.x, M.y) - Ro, phiP = toMoon - Math.PI;
  for (let f = phi - 0.004; f > phiP; f -= 0.004) push(R * Math.cos(f), R * Math.sin(f));
  push(R * Math.cos(phiP), R * Math.sin(phiP));
  const lStage2 = ls[ls.length - 1], e = (ra - R) / (ra + R), p = R * (1 + e), NU = [0], NL = [lStage2];
  for (let i = 1; i <= 1600; i++) { const nu = Math.PI * i / 1600, r = p / (1 + e * Math.cos(nu)); push(r * Math.cos(phiP - nu), r * Math.sin(phiP - nu)); NU.push(nu); NL.push(ls[ls.length - 1]); }
  return { px: Float64Array.from(xs), py: Float64Array.from(ys), pl: Float64Array.from(ls), hs: Float64Array.from(hs), nAscent, lSpace, lStage2, e, NU, NL, R,
    th0: Math.atan2(-Math.sin(toMoon), -Math.cos(toMoon)) };                                  // where it joins the Moon's orbit, seen from the Moon
})();
const lerpAt = (xs, ys, x) => { let lo = 0, hi = xs.length - 1; if (x <= xs[0]) return ys[0]; if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]); };
/* Distance along the path at each point of the timeline.
   Lift-off is a real one: off the pad at about half a g, past the top of the tower at 10 s (30 m/s), 1.4 km up at 30 s, 5.8 km at 60 s.
   From there the drawn distance grows at a steady rate (the view widens about 3% a second) up to the edge of space, round the parking orbit
   at a steady speed, then out along the transfer on Kepler's clock: the same half ellipse in 20 minutes, fast at first and slow near the Moon. */
const TIMING = (function () {
  const RH = WORLD.ROCKET_H, T = MILESTONES, RHs = v => Math.log(v * RH), S1 = 0.031, SP = PATH.lSpace, S2 = PATH.lStage2, L = PATH.pl[PATH.pl.length - 1], e = PATH.e;
  const TT = T.orbit - T.stage2, n = Math.PI / TT, vPark = (S2 - SP) / (T.stage2 - T.space), vTLI = PATH.R * n * (1 + e) * (1 + e) / Math.pow(1 - e * e, 1.5);
  const pad = pchip([0, HOLD, T.tower], [0, 0, 1.15 * RH], 0, 0.306 * RH);
  const climb = pchip([T.tower, 30, 60, T.stage1, T.space], [RHs(1.15), RHs(14.4), RHs(57.7), Math.log(S1), Math.log(SP)], 0.266, vPark / SP);
  const park = pchip([T.space, T.stage2], [SP, S2], vPark, vTLI), k = Math.sqrt((1 + e) / (1 - e));
  function transfer(t) {
    const Mn = Math.PI * Math.min(1, (t - T.stage2) / TT); let E = Mn;
    for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - Mn) / (1 - e * Math.cos(E));    // Kepler's equation
    return lerpAt(PATH.NU, PATH.NL, 2 * Math.atan(k * Math.tan(E / 2)) || (E > 3 ? Math.PI : 0));
  }
  const lenAt = t => t <= T.tower ? pad(t) : t <= T.space ? Math.exp(climb(t)) : t <= T.stage2 ? park(t) : t < T.orbit ? transfer(t) : L;
  /* altitude read-out: a believable climb in kilometres (40 km at stage 1 separation, 100 km at the edge of space), tied to the same clock;
     up to the 185 km of the parking orbit, then out along the real transfer, to the Moon's 384,400 km */
  const kmT = pchip([0, HOLD, T.tower, 30, 60, T.stage1, T.space], [0, 0, 0.115, 1.44, 5.77, 40, 100], 0, 0.33), kx = [0], ky = [0];
  for (const t of [4, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120, 150, 190, 220, 250, 280, 310, 340, 360, 370]) { kx.push(lenAt(t)); ky.push(kmT(t)); }
  const rp = 6371 + 185, rA = 6371 + 384400, er = (rA - rp) / (rA + rp);
  kx.push(S2); ky.push(185);
  for (let i = 1; i <= 60; i++) { const nu = Math.PI * (1 - Math.pow(1 - i / 60, 1.6)); kx.push(lerpAt(PATH.NU, PATH.NL, nu)); ky.push(rp * (1 + er) / (1 + er * Math.cos(nu)) - 6371); }
  const kmAt = pchip(kx, ky);
  return { lenAt, kmAt, kmAtAlt: a => kmAt(lerpAt(PATH.hs, PATH.pl.subarray(0, PATH.nAscent), a)), S1, SP, S2, L };
})();

class RocketSim {
  constructor() {
    const RH = WORLD.ROCKET_H;
    this.px = PATH.px; this.py = PATH.py; this.pl = PATH.pl; this.S = PATH.pl.length - 1; this.L = TIMING.L; this.th0 = PATH.th0;
    this.lenAt = TIMING.lenAt; this.kmAt = TIMING.kmAt; this.kmAtAlt = TIMING.kmAtAlt;
    this.lTower = 0.95 * RH; this.lStage1 = TIMING.S1; this.lSpace = TIMING.SP; this.lStage2 = TIMING.S2;
    this.wOrbit = 2 * Math.PI / ORBIT_PERIOD;
    this.events = []; this.reset();
  }
  reset() { this.mode = 'pad'; this.l = 0; this.v = 0; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false;
    this.ignited = false; this.lit0 = false; this.fp = 0; this.fallT = 0; this.power = 0; this.g = 0; this.prevT = 0; this.down = 0;
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
      if (eff < 0.5 && !this.inSpace) { this.mode = 'fall'; this.fallT = 0; this.ignited = false; this.g = Math.max(this.l / 8, 2e-5); this.events.push('fall'); return; }
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
      this.v -= this.g * dt; this.l += this.v * dt; this.fallT += rdt;
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
    const tip = this.mode === 'fall' ? Math.PI * smooth(0, 1.6, this.fallT) : 0;                 // falling, it tips over and comes down nose first
    return { x: x, y: y, ang: Math.atan2(dx, dy) + tip, alt: Math.max(0, Math.hypot(x, y) - 1) };
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

module.exports = { LIFTOFF, MILESTONES, WORLD, RocketSim, pchip, rocketAt, rocketCarry, sampleFlights, smooth };
