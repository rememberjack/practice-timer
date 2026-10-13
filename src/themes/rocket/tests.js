/* Rocket's tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { Session, practiceStats, sampleLog } = require('../../core.js');
const { MILESTONES, RocketSim, rocketAt, rocketCarry, sampleFlights } = require('./sim.js');
const list = [];
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
list.push({ name: 'Rocket: carries on from earlier the same day', run: () => {
  const fly = (sim, secs, eff, playing) => { for (let t = 0; t < secs; t += 0.1) sim.update(0.1, { running: true, playing: playing !== false, eff: eff }); };
  const a = new RocketSim(); fly(a, 130, 1); const low = a.save(); fly(a, 300, 1); const high = a.save(); fly(a, 1500, 1); const orb = a.save();
  const f = new RocketSim(); fly(f, 60, 1); fly(f, 1, 0.2, false); const falling = f.mode === 'fall' && f.save() === null;
  const c = new RocketSim(), d = new RocketSim(), pad = new RocketSim(), forged = new RocketSim();
  const carriedHigh = c.restore(high) && c.mode === 'ascent' && c.fp === high.fp; fly(c, 5, 0.2, false); d.restore(orb); fly(d, 1, 1);
  const below = !forged.restore({ mode: 'ascent', fp: 130, l: 0.02, stage: 0, inSpace: false, th: 0, tOrb: 0 }) && forged.mode === 'pad' && forged.fp === 0;
  const at = (dd, h) => new Date(2026, 9, dd, h).getTime(), now = at(9, 18), rec = (dd, h, rk) => ({ start: at(dd, h), themes: { rocket: rk } });
  const carry = [rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now) === high, rocketCarry([rec(8, 20, orb)], now) === null, rocketCarry([rec(9, 12, high), rec(9, 15, null)], now) === null,
    rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now, at(9, 13)) === null,                                  // a new flight after both sessions: the pad
    rocketCarry([rec(9, 8, orb), { start: at(9, 12), end: at(9, 14), themes: { rocket: high } }], now, at(9, 13)) === high,  // chosen during a session: that session's flight carries on
    rocketCarry([rec(9, 8, orb), rec(9, 14, high)], now, at(9, 13)) === high];                                  // a session after the new flight carries on
  const ok = low === null && falling && below && high && high.inSpace && carriedHigh && c.mode === 'ascent' && c.events.indexOf('fall') < 0 && orb.mode === 'orbit'
    && d.mode === 'orbit' && d.spinUp === 1 && d.events.indexOf('spin') < 0 && pad.save() === null && !pad.restore({ mode: 'pad' }) && !pad.restore(null) && carry.every(Boolean);
  return { name: 'Rocket: carries on from earlier the same day', expect: 'in space and in Moon orbit it carries on; below the edge of space, falling, on a new day or after a new flight is chosen it starts on the pad',
    got: 'below space ' + (low === null && below ? 'back to the pad' : 'carried') + ', falling ' + (falling ? 'back to the pad' : 'carried') + '; in space ' + c.mode + '; orbit ' + d.mode + ' spin ' + d.spinUp + '; carry ' + carry.join(','), pass: ok }; } });
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
list.push({ name: 'Rocket: a new flight while a session is still running', run: () => {
  const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(12, 18), up = { mode: 'ascent', fp: 400 }, orb = { mode: 'orbit', fp: 2000 };
  const got = [rocketCarry([{ start: at(12, 8), end: at(12, 9), themes: { rocket: up } }], now, at(12, 9)),              // ended just as the new flight was chosen: the pad
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, at(12, 8)),                                          // no end saved, and started by then: the pad
    rocketCarry([{ start: at(12, 8), end: at(12, 20), themes: { rocket: up } }], now, at(12, 19)),                        // chosen while it still ran: carries on
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, at(12, 7)),                                          // chosen before it started: carries on
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, 0), rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now),   // never chosen
    rocketCarry([{ start: at(12, 14), themes: { rocket: orb } }, { start: at(11, 20), themes: { rocket: up } }, { start: at(12, 8), themes: { rocket: up } }], now),   // the day's latest, whatever the order
    rocketCarry([], now), rocketCarry([{ start: at(12, 8) }], now), rocketCarry([{ start: at(11, 8), themes: { rocket: orb } }], now)];
  const want = [null, null, up, up, up, up, orb, null, null, null];
  return { name: 'Rocket: a new flight while a session is still running', expect: 'a session that had ended (or, with no end saved, had started) by the time the new flight was chosen starts on the pad; one still running then, or started later, carries on; the latest session of the day wins in any order; yesterday, no sessions or no saved flight give the pad',
    got: got.map(g => g ? g.mode : 'pad').join(', '), pass: got.every((g, i) => g === want[i]) }; } });list.push({ name: 'Rocket: sample practice logs carry the flight on', run: () => {
  const now = new Date(2026, 9, 9, 18).getTime(), today = sampleFlights(sampleLog('today', now)), carried = new RocketSim().restore(rocketCarry(today, now));
  const space = new RocketSim(), orbit = new RocketSim(), T = practiceStats(today, now);
  const ok = T.today.sessions === 2 && carried && rocketAt(MILESTONES.space - 1) === null && space.restore(rocketAt(MILESTONES.space)) && space.mode === 'ascent' && orbit.restore(rocketAt(MILESTONES.orbit)) && orbit.mode === 'orbit'
    && sampleFlights(sampleLog('first', now)).length === 0;
  return { name: 'Rocket: sample practice logs carry the flight on', expect: 'in a sample log each day\'s sessions fly one flight on, so today\'s rocket carries on; below the edge of space a flight starts on the pad',
    got: 'today ' + T.today.sessions + ' sessions, rocket ' + (carried ? 'carried on' : 'on the pad'), pass: !!ok }; } });

module.exports = list;
