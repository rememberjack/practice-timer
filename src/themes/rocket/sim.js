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
const KM = 1 / 6371, R_KM = 6371, MU = 398600.4418, MU_MOON = 4904.87, SOI = 66100;   // Earth's radius and gravitational parameter (km, km³/s²); the Moon's, and how near its pull takes over (km)
const WORLD = { ROCKET_H: 0.1 * KM, SPACE: 100 * KM, MOON: { x: 0, y: 0, r: 1737.4 * KM }, ORBIT: (1737.4 + 110) * KM, DIST: 384400 * KM };
/* Flight timeline, in seconds of playing since ignition (E0). Up to Earth orbit it keeps a real flight's time (Apollo 11's Saturn V):
   E1 clear the tower 8 s, E2 stage 1 separation 2:43 (67 km up), E3 the edge of space 3:25 (100 km), stage 2 separation 9:09 (186 km); the third
   stage puts it in Earth orbit (191 km) at 11:50, then a minute's coast and a minute's burn for the Moon (PHASES), and E4 stage 3 separation at
   14:29, 27 minutes after the burn as on Apollo 11 (on the coast's sped-up clock); then the three-day coast to the Moon, sped up about 275 times,
   so that E5, Moon orbit, comes at 30:00; E6 send the module spinning about its length and keep orbiting. Each step is from the one before. */
const STEPS = [['tower', 8], ['stage1', 155], ['space', 42], ['stage2', 344], ['stage3', 320], ['orbit', 931]];
const MILESTONES = {}; (function () { let t = 0; for (const s of STEPS) { t += s[1]; MILESTONES[s[0]] = t; } })();
const stageAt = fp => fp >= MILESTONES.stage3 ? 3 : fp >= MILESTONES.stage2 ? 2 : fp >= MILESTONES.stage1 ? 1 : 0;   // stages dropped by then
const PHASES = { insert: 710, tli: 770, coast: 830 };   // Earth orbit, the burn for the Moon (TLI) and the coast after it
const LIFTOFF = 0.5;   // engine power the rocket needs, held for HOLD seconds, to leave the pad
const HOLD = 1, ORBIT_PERIOD = 60, WRECK = 2.6, SPIN_AT = 3, SPIN_UP = 4, SPIN = 2 * Math.PI * 0.6;   // E6: 3 s after arrival the module starts to roll about its long axis, reaching 0.6 turns a second
/* E7, the Moon landing, Apollo 11's sped up. After LAND.wait seconds of playing in orbit the lunar module undocks as the module crosses the
   DOI point on the far side, and a burn there lowers the low point of its orbit to 15 km; it coasts half an orbit down to it (an hour, played in
   LAND.coast seconds, its pace easing from the orbit's to the descent's), then the powered descent (12.5 minutes on Apollo 11, played in
   braking + approach + final seconds): braking almost on its back, pitching over at high gate (2.3 km) to see the landing site, slowing to a
   hover at low gate (150 m) and touching down 480 km past the start of the burn, 23.5° past the point under Earth, where Tranquility Base is.
   It rests there, and the command module keeps circling. The descent only moves on while music is heard, like the climb. The lunar module rides
   inside stage 3 until that separates (its view.js shows the capsule turning round to dock with it, as Apollo did) */
const LAND = { wait: 300, coast: 60, braking: 90, approach: 60, final: 60, periKm: 15.2, downKm: 480, siteDeg: 23.5, LM_CM: 0.0035 };   // LM_CM: the module's middle is 3.5 m above its pads
LAND.powered = LAND.braking + LAND.approach + LAND.final; LAND.len = LAND.coast + LAND.powered;
LAND.undock = MILESTONES.orbit + LAND.wait; LAND.land = LAND.undock + LAND.len;
/* the climb to Earth orbit: seconds since ignition, height (km) and distance downrange (km). Off the pad at about half a g and past the tower at
   8 s; then Apollo 11's: stage 1 separation at 67 km and 94 km downrange, 96 km up at 3:18, stage 2 cut-off at 186 km, orbit at 191 km */
const CLIMB = [[0, 0, 0], [HOLD, 0, 0], [8, 0.115, 0], [30, 1.44, 0.1], [60, 5.77, 1.5], [84, 13.5, 6], [106, 24, 18], [136, 44.4, 50], [163, 67, 94],
  [199, 96, 186], [241, 120, 306], [301, 145, 504], [361, 160, 738], [421, 171, 1011], [461, 179, 1217], [549, 186, 1745], [621, 189, 2235], [PHASES.insert, 191, 2800]];

/* The flight path, built once along the timeline: points (x, y) at each time (t), with the distance along the path to each (l) and the height
   above Earth (km). The climb, then Earth orbit at 7.8 km/s, the burn for the Moon to 10.83 km/s at 336 km, and from there a Kepler orbit round
   Earth, whose far end reaches the Moon's distance three days later. Once within the Moon's reach (SOI) the Moon's pull speeds it up again,
   from 0.7 km/s to 2.4 km/s as it arrives. The Moon is where the rocket meets its orbit on a tangent, one orbit radius to the rocket's right,
   so it passes behind the Moon and goes round it clockwise. On the way it passes the coast's moments (COAST), each at its real time or place. */
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
  const moonAt = E => { const q = kep(E), q2 = kep(E + 1e-7), dx = q2.x - q.x, dy = q2.y - q.y, d = Math.hypot(dx, dy); return { x: q.x + Ro * dy / d, y: q.y - Ro * dx / d }; };
  let E = 0, lo = 0;                                                                                                  // where the coast ends: the Moon one orbit radius to the right
  while (Math.hypot(moonAt(E).x, moonAt(E).y) < WORLD.DIST) { lo = E; E += 1e-4; }
  for (let i = 0; i < 40; i++) { const mid = (lo + E) / 2; if (Math.hypot(moonAt(mid).x, moonAt(mid).y) < WORLD.DIST) lo = mid; else E = mid; }
  const M = moonAt(E), Eend = E, D = MILESTONES.orbit - P.coast, RAMP = 90;
  /* real time along the coast, sample by sample: Kepler's until the Moon's pull takes over, then each step's length over the speed it has then */
  const ce = [], cx = [], cy = [], ct = []; let soi = -1;
  for (let i = 0, N = Math.ceil(Eend / 1e-4); i <= N; i++) { const E1 = Eend * i / N, q1 = kep(E1), dm = Math.hypot(q1.x - M.x, q1.y - M.y) * R_KM;
    let tm = (E1 - e * Math.sin(E1)) / n;
    if (dm <= SOI) { if (soi < 0) soi = i; else { const r = Math.hypot(q1.x, q1.y) * R_KM, v = Math.sqrt(MU * (2 / r - 1 / a) + 2 * MU_MOON * (1 / dm - 1 / SOI));
      tm = ct[i - 1] + Math.hypot(q1.x - cx[i - 1], q1.y - cy[i - 1]) * R_KM / v; } }
    ce.push(E1); cx.push(q1.x); cy.push(q1.y); ct.push(tm); }
  const tauEnd = ct[ct.length - 1];
  /* coast time sped up: from real time at the end of the burn to K times over RAMP seconds, K chosen so the coast takes D seconds */
  const K = 1 + (tauEnd - D) / (D - RAMP / 2), tau = t => { const x = Math.min(1, t / RAMP); return t + (K - 1) * (t < RAMP ? RAMP * (x * x * x - x * x * x * x / 2) : t - RAMP / 2); };
  const fpAt = tm => { let lo = P.coast, hi = MILESTONES.orbit; for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (tau(mid - P.coast) < tm) lo = mid; else hi = mid; } return hi; };
  const at = tm => { let lo = 0, hi = ct.length - 1; if (tm >= ct[hi]) return { x: cx[hi], y: cy[hi] };
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ct[mid] <= tm) lo = mid; else hi = mid; }
    const u = (tm - ct[lo]) / (ct[hi] - ct[lo]); return { x: cx[lo] + (cx[hi] - cx[lo]) * u, y: cy[lo] + (cy[hi] - cy[lo]) * u }; };
  for (let t = P.coast; t <= MILESTONES.orbit + 1e-9; t += 0.1) { const q = at(tau(t - P.coast)); add(t, q.x, q.y); }
  /* the coast's moments, on the flight clock: passing the GPS satellites (20,200 km up) and the weather satellites (35,786 km), the slow roll
     that warms every side (7 hours out), halfway to the Moon, Apollo 11's one course correction (24 hours out), and into the Moon's pull */
  const first = f => { for (let i = 0; i < ct.length; i++) if (f(i)) return fpAt(ct[i]); return MILESTONES.orbit; };
  const COASTAT = { gps: first(i => (Math.hypot(cx[i], cy[i]) - 1) * R_KM >= 20200), geo: first(i => (Math.hypot(cx[i], cy[i]) - 1) * R_KM >= 35786),
    roll: fpAt(7 * 3600), halfway: first(i => Math.hypot(cx[i], cy[i]) >= WORLD.DIST / 2), correction: fpAt(24 * 3600), pull: fpAt(ct[soi]) };
  const q = kep(Eend); add(MILESTONES.orbit + 0.1, q.x, q.y);
  const end = xs.length - 1;
  return { pt: Float64Array.from(ts), px: Float64Array.from(xs), py: Float64Array.from(ys), pl: Float64Array.from(ls), pk: Float64Array.from(ks), moon: M, K: K, coast: COASTAT,
    real: t => t <= P.coast ? t : P.coast + tau(t - P.coast),                                     // real time at a time on the flight clock
    th0: Math.atan2(ys[end] - M.y, xs[end] - M.x) };                                               // where it joins the Moon's orbit, seen from the Moon
})();
WORLD.MOON.x = PATH.moon.x; WORLD.MOON.y = PATH.moon.y;
/* the lunar module's descent, tD seconds of playing after undocking: its distance from the Moon's centre, its angle round the Moon (clockwise,
   the way the orbit goes), its lean back from upright (engine forward to brake, then pitching over to upright for the landing) and the height of
   its pads above the ground in km */
const DESCENT = (function () {
  const M = WORLD.MOON, R = M.r, RKM = R / KM, sub = Math.atan2(-M.y, -M.x);                       // the angle of the point under Earth, seen from the Moon
  const site = sub - LAND.siteDeg * Math.PI / 180, doi = site + Math.PI + LAND.downKm / RKM;      // the landing site; the DOI point is half an orbit and the descent's ground track before it
  const ra = WORLD.ORBIT, rp = R + LAND.periKm * KM, a = (ra + rp) / 2, e = (ra - rp) / (ra + rp), p = a * (1 - e * e);   // the descent orbit, 110 km by 15 km
  // the coast's half turn: a cubic in time from the orbit's pace to the pace the braking starts at
  const h = LAND.coast, m0 = 2 * h / ORBIT_PERIOD, m1 = LAND.downKm / LAND.braking / RKM * h / Math.PI;
  const turn = t => { const u = clamp01(t / h), u2 = u * u, u3 = u2 * u; return Math.PI * ((3 * u2 - 2 * u3) + (u3 - 2 * u2 + u) * m0 + (u3 - u2) * m1); };
  const tP = [0, LAND.braking, LAND.braking + LAND.approach, LAND.powered - 30, LAND.powered - 15, LAND.powered];   // PDI, high gate, low gate (600 m short), 30 m up, 10 m up, touchdown
  const altAt = pchip(tP, [LAND.periKm, 2.3, 0.15, 0.03, 0.01, 0].map(k => k + LAND.LM_CM)), downAt = pchip(tP, [0, 471, 479.4, 479.93, 479.985, LAND.downKm], undefined, 0);   // the last metres straight down
  const leanAt = pchip([0, LAND.coast, tP[1] + LAND.coast, tP[2] + LAND.coast, LAND.len], [85, 85, 45, 8, 0].map(d => d * Math.PI / 180));
  return { site: site, doi: doi, sub: sub, at: function (tD) {
    let r, th;
    if (tD < LAND.coast) { const f = turn(tD); r = p / (1 - e * Math.cos(f)); th = doi - f; }
    else { const t = Math.min(LAND.powered, tD - LAND.coast); r = R + altAt(t) * KM; th = doi - Math.PI - downAt(t) / RKM; }
    return { r: r, th: th, lean: leanAt(Math.min(tD, LAND.len)), alt: Math.max(0, (r - R) / KM - LAND.LM_CM) }; } };
})();
LAND.site = DESCENT.site;
/* the ISS passing overhead in the climb: 420 km up at 7.66 km/s, faster than the rocket still gathering speed, so it comes from behind,
   is right overhead at 7:00 (at) and pulls ahead. Once the rocket is in its lower orbit it is the faster, and after the burn for the Moon
   it overtakes the ISS, passing under it, and leaves it going on round Earth (on the coast's clock, sped up like the rest) */
const ISS = { at: 420, km: 420, v: 7.66 };
/* the moments along the way in the order they come, each with its time on the flight clock: the ISS, then the coast's */
const COAST = Object.keys(PATH.coast).map(k => ({ id: k, at: Math.round(PATH.coast[k] * 10) / 10 })).concat([{ id: 'iss', at: ISS.at }]).sort((p, q) => p.at - q.at);
const lerpAt = (xs, ys, x) => { let lo = 0, hi = xs.length - 1; if (x <= xs[0]) return ys[0]; if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]); };
/* distance along the path at each point of the timeline, and the height read-out (km above Earth) at each distance along it */
const TIMING = (function () {
  const T = MILESTONES, L = PATH.pl[PATH.pl.length - 1], lenAt = t => lerpAt(PATH.pt, PATH.pl, Math.min(t, T.orbit));
  return { lenAt, kmAt: l => lerpAt(PATH.pl, PATH.pk, l), kmAtAlt: a => a * R_KM, S1: lenAt(T.stage1), SP: lenAt(T.space), S2: lenAt(T.stage2), S3: lenAt(T.stage3), L, realAt: PATH.real };
})();

class RocketSim {
  constructor() {
    const RH = WORLD.ROCKET_H;
    this.px = PATH.px; this.py = PATH.py; this.pl = PATH.pl; this.S = PATH.pl.length - 1; this.L = TIMING.L; this.th0 = PATH.th0;
    this.lenAt = TIMING.lenAt; this.kmAt = TIMING.kmAt; this.kmAtAlt = TIMING.kmAtAlt; this.realAt = TIMING.realAt;
    const q = this.pathAt(this.lenAt(ISS.at)); this.issFrom = Math.atan2(q.x, q.y);
    this.lTower = 0.95 * RH; this.lStage1 = TIMING.S1; this.lSpace = TIMING.SP; this.lStage2 = TIMING.S2; this.lStage3 = TIMING.S3;
    this.wOrbit = 2 * Math.PI / ORBIT_PERIOD;
    this.events = []; this.reset();
  }
  reset() { this.mode = 'pad'; this.l = 0; this.v = 0; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false; this.parked = false; this.tli = false; this.ci = 0;
    this.ignited = false; this.lit0 = false; this.fp = 0; this.power = 0; this.g = 0; this.prevT = 0; this.down = 0;
    this.th = this.th0; this.tOrb = 0; this.tD = 0; this.wIn = 2 * Math.PI / ORBIT_PERIOD; this.spinUp = 0; this.spinA = 0; this.events.length = 0; }
  /* the height read-out: above Earth's ground on the way up, and above the Moon's from Moon orbit on (the lunar module's pads, in the descent) */
  altKm() { return this.mode === 'orbit' ? (WORLD.ORBIT - WORLD.MOON.r) / KM : this.mode === 'descent' || this.mode === 'landed' ? DESCENT.at(this.tD).alt : this.kmAt(this.l); }
  /* how far along the flight plan the rocket is, from 0 on the pad to 1 in Moon orbit: the share of the flight's playing time flown, so it
     fills at an even pace. Falling, it drops back with the rocket */
  plan() {
    if (this.mode === 'orbit' || this.mode === 'descent' || this.mode === 'landed') return 1;
    const fp = this.fp, p = clamp01(fp / MILESTONES.orbit);
    if (this.mode !== 'fall') return p;
    const l0 = this.lenAt(fp); return l0 > 0 ? p * clamp01(this.l / l0) : 0;
  }
  /* where the flight has got to, to carry on in the day's next session. Only a rocket in space, in Moon orbit, landing or landed carries on:
     anywhere below the edge of space (on the pad, climbing or falling) is null, and the next session starts on the pad */
  save() {
    if (!AT_MOON[this.mode] && !(this.mode === 'ascent' && this.inSpace)) return null;
    const r = (v, k) => Math.round(v * k) / k;
    return { mode: this.mode, fp: r(this.fp, 1e3), l: r(this.l, 1e7), stage: this.stage, inSpace: this.inSpace, cleared: this.cleared, th: r(this.th, 1e4), tOrb: r(Math.min(this.tOrb, 60), 1e3), tD: r(this.tD, 1e3) };
  }
  /* carry on from save(). False, and on the pad, for anything that is not a saved flight in space, in orbit or at the Moon */
  restore(x) {
    this.reset();
    const n = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    if (!x || (!AT_MOON[x.mode] && !(x.mode === 'ascent' && x.inSpace)) || !n(x.fp, HOLD, 1e6) || !n(x.l, 0, 1e3) || !n(x.stage, 0, 3) || !n(x.th, -4, 4) || !n(x.tOrb, 0, 1e6)) return false;
    if (x.mode === 'descent' && !n(x.tD, 0, LAND.len)) return false;
    const fp = x.fp;   // where the rocket is, and what it has passed, follow the flight clock (a flight saved before the path was drawn to scale too)
    this.mode = x.mode; this.fp = fp; this.l = this.lenAt(fp); this.prevT = this.target(fp); this.stage = stageAt(fp); this.lit0 = true;
    this.inSpace = true; this.cleared = true; this.parked = fp >= PHASES.insert; this.tli = fp >= PHASES.tli; this.ci = COAST.filter(c => c.at <= fp).length;
    if (AT_MOON[x.mode]) { this.l = this.L; this.stage = 3; this.th = x.th; this.tOrb = x.tOrb; this.tD = x.mode === 'landed' ? LAND.len : x.mode === 'descent' ? x.tD : 0;
      this.spinUp = x.mode === 'orbit' ? smooth(SPIN_AT, SPIN_AT + SPIN_UP, x.tOrb) * (1 - smooth(LAND.undock - 12, LAND.undock - 4, fp)) : 0; }
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
      if (!this.parked && fp >= PHASES.insert) { this.parked = true; this.events.push('earthOrbit'); }
      if (!this.tli && fp >= PHASES.tli) { this.tli = true; this.events.push('tli'); }
      if (this.stage < 3 && fp >= T.stage3 && this.l >= this.lStage3 * 0.97) { this.stage = 3; this.events.push('stage3'); }
      while (this.ci < COAST.length && fp >= COAST[this.ci].at) this.events.push(COAST[this.ci++].id);
      if (fp >= T.orbit && this.l >= this.L - 0.03) { this.mode = 'orbit'; this.wIn = Math.min(0.6, Math.max(this.wOrbit, this.v / WORLD.ORBIT)); this.l = this.L; this.ignited = false; this.th = this.th0; this.tOrb = 0; this.events.push('orbit'); }
    } else if (this.mode === 'fall') {
      this.v -= this.g * dt; this.l += this.v * dt;
      if (this.l <= 0) { this.l = 0; this.v = 0; this.mode = 'pad'; this.hold = 0; this.stage = 0; this.inSpace = false; this.cleared = false;
        this.lit0 = false; this.fp = 0; this.down = WRECK; this.events.push('crash'); }
    } else if (this.mode === 'orbit') {
      this.ignited = false; this.tOrb += rdt; if (inp.playing) this.fp += dt;                      // circles the Moon for as long as the session runs
      const from = this.th;
      this.th -= (this.wIn + (this.wOrbit - this.wIn) * smooth(0, 8, this.tOrb)) * rdt;        // clockwise, the way it came round Earth, easing from the speed it arrived at
      if (this.th < -Math.PI) this.th += 2 * Math.PI;
      const was = this.spinUp;                                                                      // E6: the module is sent spinning about its length, and is steadied again before the undocking
      this.spinUp = smooth(SPIN_AT, SPIN_AT + SPIN_UP, this.tOrb) * (1 - smooth(LAND.undock - 12, LAND.undock - 4, this.fp));
      if (was === 0 && this.spinUp > 0) this.events.push('spin');
      this.spin(rdt);
      if (this.fp >= LAND.undock && crossed(from, this.th, DESCENT.doi)) { this.mode = 'descent'; this.tD = 0; this.spinUp = 0; this.events.push('undock'); }   // E7
    } else if (this.mode === 'descent' || this.mode === 'landed') {
      this.tOrb += rdt; this.th -= this.wOrbit * rdt; if (this.th < -Math.PI) this.th += 2 * Math.PI;   // the command module keeps circling
      if (inp.playing) this.fp += dt;
      if (this.mode === 'landed') { this.ignited = false; return; }
      const was = this.tD; if (inp.playing) this.tD += dt; const tD = this.tD;
      this.ignited = inp.playing && eff > 0 && ((tD >= 5 && tD < 8) || tD >= LAND.coast);             // the burn at the DOI point, once clear of the command module, then the powered descent
      if (was < LAND.coast && tD >= LAND.coast) this.events.push('pdi');
      if (was < LAND.coast + LAND.braking && tD >= LAND.coast + LAND.braking) this.events.push('highgate');
      if (tD >= LAND.len) { this.tD = LAND.len; this.mode = 'landed'; this.ignited = false; this.events.push('landed'); }
    }
  }
  spin(dt) { this.spinA = (this.spinA + SPIN * this.spinUp * dt) % (2 * Math.PI); }
  pose() {
    if (this.mode === 'orbit') return this.cmPose();
    if (this.mode === 'descent' || this.mode === 'landed') { const d = DESCENT.at(this.tD), M = WORLD.MOON, c = Math.cos(d.th), s = Math.sin(d.th), x = M.x + d.r * c, y = M.y + d.r * s;
      return { x: x, y: y, ang: Math.atan2(c, s) - d.lean, alt: Math.max(0, Math.hypot(x, y) - 1), lean: d.lean }; }       // upright away from the Moon, leaned back from the way it is going
    return this.pathAt(this.l);
  }
  /* the module in Moon orbit (the command module, once the lunar module has left it) */
  cmPose() { const M = WORLD.MOON, c = Math.cos(this.th), s = Math.sin(this.th), x = M.x + WORLD.ORBIT * c, y = M.y + WORLD.ORBIT * s;
    return { x: x, y: y, ang: Math.atan2(s, -c), alt: Math.max(0, Math.hypot(x, y) - 1) }; }
  /* where the ISS is at a time on the flight clock: going round Earth at its height and speed, right over the rocket at ISS.at */
  issAt(fp) { const a = this.issFrom + ISS.v / (6371 + ISS.km) * (this.realAt(fp) - ISS.at), r = 1 + ISS.km / R_KM; return { x: r * Math.sin(a), y: r * Math.cos(a) }; }
  /* the point on the path l along it, with its heading */
  pathAt(l) {
    const ls = this.pl; let lo = 0, hi = this.S;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ls[mid] <= l) lo = mid; else hi = mid; }
    const seg = ls[hi] - ls[lo], t = seg > 0 ? (l - ls[lo]) / seg : 0;
    const dx = this.px[hi] - this.px[lo], dy = this.py[hi] - this.py[lo];
    const x = this.px[lo] + dx * t, y = this.py[lo] + dy * t;
    return { x: x, y: y, ang: Math.atan2(dx, dy), alt: Math.max(0, Math.hypot(x, y) - 1) };
  }
}
const AT_MOON = { orbit: true, descent: true, landed: true };
/* a clockwise crossing of the angle at, going from angle a to b (both round the Moon, in (-pi, pi]) */
function crossed(a, b, at) { const w = d => { d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return d; }, d0 = w(a - at), d1 = w(b - at); return d0 > 0 && d1 <= 0 && d0 - d1 < 1; }
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
  if (fp < MILESTONES.orbit) return { mode: 'ascent', fp: fp, l: Math.round(sim.lenAt(fp) * 1e7) / 1e7, stage: stageAt(fp), inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 0 };
  const mode = fp >= LAND.land ? 'landed' : fp >= LAND.undock ? 'descent' : 'orbit';
  return { mode: mode, fp: fp, l: sim.L, stage: 3, inSpace: true, cleared: true, th: Math.round(sim.th0 * 1e4) / 1e4, tOrb: 60, tD: mode === 'landed' ? LAND.len : mode === 'descent' ? fp - LAND.undock : 0 };
}
/* a sample practice log (the debug tools): the rocket of each day's sessions, as if every session that day carried the flight on (records oldest first) */
function sampleFlights(records) {
  const flown = {}; for (const r of records) { const k = dayKey(r.start); flown[k] = (flown[k] || 0) + r.play; const at = rocketAt(flown[k]); if (at) r.themes.rocket = at; }
  return records;
}

module.exports = { COAST, HOLD, ISS, LAND, LIFTOFF, MILESTONES, PHASES, WORLD, RocketSim, pchip, rocketAt, rocketCarry, sampleFlights, smooth };
