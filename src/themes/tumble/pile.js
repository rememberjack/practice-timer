/* Tumble's physics pile: the blocks fall, bounce, tip and settle in the crate under a rigid-body engine (Matter.js, loaded by view.js from
   cdnjs when the theme is shown, as City and Fireworks load three.js). It keeps the same shape as StackPile in sim.js, so the drawing and
   the logic need not know which pile they have: live blocks { b, x, y, w, h, a, rest } in block units (y up from the floor, a: the angle),
   settled blocks kept as a record, add, step, surface and settleBelow. The engine works in its own pixels (PX to a unit, y down); everything
   leaving here is in units. Resting blocks sleep (the engine's own idea), blocks deep under the surface are frozen, and frozen blocks below
   what is on screen are settled: taken out of the engine (a flat plate takes their place) and kept only to draw, so a half hour's wall of a
   few thousand blocks costs the engine nothing. M: the Matter global. */
'use strict';
const { TU } = require('./sim.js');

function makePhysicsPile(M) {
  const PX = 24, W = TU.COLS * PX, { Engine, Bodies, Body, Composite } = M;
  const engine = Engine.create({ enableSleeping: true }); engine.gravity.y = 1.3; engine.positionIterations = 8; engine.velocityIterations = 6;
  const world = engine.world;
  Composite.add(world, [Bodies.rectangle(W / 2, 40, W + 400, 80, { isStatic: true, friction: 0.9, label: 'floor' }),
    Bodies.rectangle(-20, -20000, 40, 40000, { isStatic: true, friction: 0.4, label: 'wall' }), Bodies.rectangle(W + 20, -20000, 40, 40000, { isStatic: true, friction: 0.4, label: 'wall' })]);
  const P = { kind: 'physics', live: [], settled: [], spawnY: 24, count: 0 };
  const binTop = new Array(TU.COLS).fill(0);   // the settled wall's height under each column
  let plate = null, plateTop = 0, acc = 0;
  const bins = body => [Math.max(0, Math.min(TU.COLS - 1, Math.floor(body.bounds.min.x / PX))), Math.max(0, Math.min(TU.COLS - 1, Math.floor(body.bounds.max.x / PX)))];
  const topOf = body => -body.bounds.min.y / PX;   // a body's top, in units up from the floor
  P.reset = () => {
    for (const k of P.live) Composite.remove(world, k.body);
    if (plate) { Composite.remove(world, plate); plate = null; }
    P.live.length = 0; P.settled.length = 0; P.count = 0; binTop.fill(0); plateTop = 0; acc = 0;
  };
  P.add = b => {
    const w = b.units * PX, h = (b.h || 1) * PX, x = Math.max(w / 2 + 1, Math.min(W - w / 2 - 1, b.x * PX));
    const body = Bodies.rectangle(x, -P.spawnY * PX, w, h, { chamfer: { radius: Math.min(3, h / 4) }, friction: 0.6, frictionStatic: 0.9, restitution: 0.05, density: 0.0015, label: 'block' });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05); Body.setVelocity(body, { x: (Math.random() - 0.5) * 0.6, y: 1.5 });
    const k = { b: b, x: x / PX, y: P.spawnY, w: b.units, h: b.h || 1, a: 0, rest: false, body: body };
    P.live.push(k); Composite.add(world, body); P.count++;
  };
  /* fixed steps of a sixtieth, at most three a frame, so a slow frame never throws the blocks about */
  P.step = dt => {
    acc += dt; let n = 0;
    while (acc >= 1 / 60 && n < 3) { Engine.update(engine, 1000 / 60); acc -= 1 / 60; n++; }
    if (n === 3) acc = 0;
    for (const k of P.live) { const bd = k.body; k.x = bd.position.x / PX; k.y = -bd.position.y / PX; k.a = -bd.angle; k.rest = bd.isSleeping || bd.isStatic; }
  };
  const heights = () => {
    const h = binTop.slice();
    for (const k of P.live) { if (!k.rest) continue; const [a, z] = bins(k.body), t = topOf(k.body); for (let i = a; i <= z; i++) if (t > h[i]) h[i] = t; }
    return h;
  };
  P.surface = () => { const s = heights().sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; };
  /* blocks resting deep under the surface are frozen (static, which costs the engine nothing); frozen blocks whose top is under y (what is on
     screen) are settled and leave the engine, a plate under the live blocks keeping anything from falling through */
  P.settleBelow = y => {
    const s = P.surface(), out = [];
    P.live = P.live.filter(k => {
      const bd = k.body, top = topOf(bd);
      if (!bd.isStatic && bd.isSleeping && top < s - TU.DEEP) Body.setStatic(bd, true);
      if (!bd.isStatic || top >= y) return true;
      const [a, z] = bins(bd); for (let i = a; i <= z; i++) if (top > binTop[i]) binTop[i] = top;
      if (top > plateTop) { plateTop = top; if (!plate) { plate = Bodies.rectangle(W / 2, -plateTop * PX + 1, W, 2, { isStatic: true, label: 'plate' }); Composite.add(world, plate); } else Body.setPosition(plate, { x: W / 2, y: -plateTop * PX + 1 }); }
      Composite.remove(world, bd); delete k.body; out.push(k); P.settled.push(k); return false;
    });
    return out;
  };
  return P;
}
module.exports = { makePhysicsPile };
