/* Rocket theme renderer: a low-resolution pixel canvas, drawn fresh every frame.
   World units are Earth radii (see RocketSim in the core). */
function makeRocketView(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d');
  const WORLD = MT.WORLD, RH = WORLD.ROCKET_H, SPACE_ALT = WORLD.SPACE, MOON = WORLD.MOON, RO = WORLD.ORBIT, B = RH / 8;
  const smooth = MT.smooth, lerp = (a, b, t) => a + (b - a) * t;
  let W = 0, H = 0, ps = 3, img = null, px = null, stars = null, topInset = 50;

  const rgb = (r, gg, b) => ((255 << 24) | (b << 16) | (gg << 8) | r) >>> 0;
  function h2(a, b) { let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return (n ^ (n >>> 16)) >>> 0; }

  /* sky: light blue at the ground, through deep blue, to space */
  const SPACE = rgb(7, 10, 20), SKYN = 22, SKY = new Uint32Array(SKYN + 2);
  (function () {
    const st = [[0, 150, 208, 255], [0.22, 92, 162, 240], [0.5, 40, 72, 168], [0.72, 15, 22, 64], [0.86, 9, 13, 30], [1, 7, 10, 20]];
    for (let i = 0; i <= SKYN + 1; i++) { const t = Math.min(1, i / SKYN); let k = 0; while (k < st.length - 2 && t > st[k + 1][0]) k++;
      const a = st[k], b = st[k + 1], u = (t - a[0]) / (b[0] - a[0]);
      SKY[i] = rgb(Math.round(lerp(a[1], b[1], u)), Math.round(lerp(a[2], b[2], u)), Math.round(lerp(a[3], b[3], u))); }
  })();
  /* how dark the sky is at a given height above the ground, following the altitude read-out (black at 100 km on the read-out) */
  const LUTN = 400, LLO = Math.log(RH * 0.2), LSTEP = (Math.log(SPACE_ALT) - LLO) / LUTN, SKYLUT = new Float32Array(LUTN + 1);
  for (let i = 0; i <= LUTN; i++) SKYLUT[i] = Math.min(1, sim.kmAt(Math.exp(LLO + i * LSTEP)) / 100) * SKYN;
  const STAR_FROM = 0.74 * SKYN;

  /* far view of Earth: a blocky map looked at from the side; the pad (top of the disc) sits on land */
  const EN = 32, EARTH = new Uint32Array(EN * EN);
  (function () {
    const lat = (x, y, s, seed) => { const xi = Math.floor(x / s), yi = Math.floor(y / s), fx = x / s - xi, fy = y / s - yi;
      const v = (i, j) => (h2(i * 7 + seed, j * 13 + seed * 3) & 1023) / 1023;
      return lerp(lerp(v(xi, yi), v(xi + 1, yi), fx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), fx), fy); };
    const OC = [rgb(38, 92, 190), rgb(46, 104, 204), rgb(32, 82, 176)], LA = [rgb(88, 160, 60), rgb(76, 146, 52), rgb(104, 170, 70)];
    const DE = rgb(196, 176, 104), IC = rgb(232, 240, 248), CL = rgb(240, 244, 250);
    for (let y = 0; y < EN; y++) for (let x = 0; x < EN; x++) {
      const n = 0.65 * lat(x, y, 9, 5) + 0.35 * lat(x, y, 4, 11) + 0.55 * Math.max(0, 1 - Math.hypot(x - EN / 2, y) / 9);
      const h = h2(x + 91, y + 17); let c;
      if (y >= EN - 3 && n > 0.3) c = IC; else if (n > 0.52) c = lat(x, y, 6, 23) > 0.66 && y > 8 ? DE : LA[h % 3]; else c = OC[h % 3];
      if (y > 4 && (h >>> 8) % 100 < 7) c = CL;
      EARTH[y * EN + x] = c;
    }
  })();
  const GRASS = [rgb(96, 170, 62), rgb(88, 160, 56), rgb(104, 178, 68), rgb(92, 166, 60)];
  const DIRT = [rgb(134, 96, 67), rgb(121, 85, 58), rgb(145, 104, 72), rgb(128, 90, 62)];
  const STONE = [rgb(125, 125, 125), rgb(112, 112, 112), rgb(136, 136, 136), rgb(118, 118, 118)];
  const COAL = rgb(58, 58, 62), GEM = rgb(92, 219, 213);
  /* The Moon: the near side as we know it, painted once per size so every texel lands on one screen pixel.
     Dark seas with ragged shores, the big named craters with lit and shadowed walls, bright rays from Tycho, Copernicus and Kepler,
     a scatter of small craters (thickest in the southern highlands), and soft shading that rounds it into a ball. Sun from the upper left. */
  const MARIA = [[-0.55, 0.15, 0.27, 0.50], [-0.22, 0.48, 0.27, 0.25], [0.25, 0.42, 0.17, 0.16], [0.42, 0.14, 0.20, 0.16], [0.72, 0.28, 0.085, 0.115], [0.62, -0.08, 0.12, 0.16],
    [0.45, -0.25, 0.085, 0.085], [-0.18, -0.35, 0.19, 0.16], [-0.52, -0.38, 0.10, 0.10], [-0.20, 0.82, 0.20, 0.05], [0.24, 0.77, 0.20, 0.045], [0.05, 0.22, 0.07, 0.06], [-0.40, -0.12, 0.12, 0.10]];
  /* x, y, radius, floor (albedo shift), ray length, ray strength */
  const CRATERS = [[-0.12, -0.68, 0.075, 0.05, 0.95, 0.20], [-0.33, 0.17, 0.075, 0.04, 0.36, 0.18], [-0.60, 0.14, 0.050, 0.06, 0.22, 0.15], [-0.67, 0.40, 0.050, 0.18, 0.14, 0.14],
    [-0.13, 0.78, 0.075, -0.20, 0, 0], [-0.10, -0.86, 0.105, -0.04, 0, 0], [0.86, -0.15, 0.065, -0.03, 0, 0], [0.42, -0.20, 0.060, -0.03, 0, 0], [-0.03, -0.16, 0.075, -0.06, 0, 0],
    [0.10, -0.25, 0.060, -0.04, 0, 0], [-0.92, -0.09, 0.075, -0.20, 0, 0], [0.30, 0.64, 0.055, -0.03, 0, 0], [0.18, -0.48, 0.070, -0.04, 0, 0], [-0.32, -0.80, 0.075, -0.04, 0, 0],
    [0.34, -0.64, 0.075, -0.04, 0, 0], [0.56, 0.62, 0.065, -0.04, 0, 0], [-0.47, 0.74, 0.050, -0.03, 0, 0], [0.10, 0.05, 0.040, 0.04, 0.12, 0.10], [0.52, 0.36, 0.040, 0.06, 0.12, 0.10],
    [0.58, -0.46, 0.065, -0.03, 0, 0], [-0.52, -0.62, 0.065, -0.03, 0, 0], [0.05, -0.62, 0.060, -0.03, 0, 0], [0.74, 0.50, 0.050, -0.03, 0, 0]];
  (function () { for (let i = 0; i < 40; i++) { const a = (h2(i, 311) & 4095) / 4096 * 2 * Math.PI, d = Math.sqrt((h2(i, 733) & 4095) / 4096) * 0.93; let x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (i % 3) y = -Math.abs(y) * 0.9 - 0.08;                                              // two in three go to the southern highlands
      CRATERS.push([x, y, 0.028 + (h2(i, 97) & 255) / 255 * 0.030, -0.03, 0, 0]); } })();
  const vnoise = (x, y, seed) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, v = (i, j) => (h2(i * 7 + seed, j * 13 + seed * 3) & 1023) / 1023;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return lerp(lerp(v(xi, yi), v(xi + 1, yi), sx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), sx), sy); };
  const LX = -0.62, LY = 0.62, LZ = 0.48;                                                       // towards the Sun
  function moonLight(x, y) {
    const edge = vnoise(x * 9 + 20, y * 9 + 20, 3) - 0.5 + 0.5 * (vnoise(x * 22 + 5, y * 22 + 5, 9) - 0.5);
    let sea = 0;
    for (const m of MARIA) { const dx = (x - m[0]) / m[2], dy = (y - m[1]) / m[3], d = Math.sqrt(dx * dx + dy * dy) - 0.28 * edge; if (d < 1.12) { const t = d < 0.88 ? 1 : (1.12 - d) / 0.24; if (t > sea) sea = t; } }
    let b = lerp(0.84 + 0.10 * (vnoise(x * 14, y * 14, 17) - 0.5) + 0.06 * (vnoise(x * 34, y * 34, 23) - 0.5), 0.50 + 0.07 * (vnoise(x * 12, y * 12, 31) - 0.5), sea), relief = 0;
    for (const c of CRATERS) { const dx = x - c[0], dy = y - c[1], rr = c[2], d2 = dx * dx + dy * dy, R = c[4];
      if (R > 0 && d2 < R * R && d2 > rr * rr) { const d = Math.sqrt(d2), th = Math.atan2(dy, dx), k = Math.sin(th * 7 + c[0] * 40) * Math.sin(th * 11 + c[1] * 30);   // rays
        if (k > 0.25) b += c[5] * (k - 0.25) * 1.6 * (1 - d / R) * (1 - 0.5 * sea); }
      if (d2 > rr * rr * 1.7) continue;
      const d = Math.sqrt(d2) / rr, toSun = (dx * LX + dy * LY) / (rr * 0.88);
      if (d < 1) { b += c[3] * (1 - d * d * 0.5) - 0.05; if (d > 0.35) relief -= 0.34 * toSun * (d - 0.35) / 0.65; else if (rr > 0.07 && d < 0.18) relief += 0.12; }   // floor, walls, central peak
      else relief += (0.08 + 0.16 * toSun) * (1.3 - d) / 0.3;                                                                                              // raised rim
    }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)), ndl = Math.max(0, x * LX + y * LY + z * LZ);
    return (b + relief) * (0.70 + 0.30 * Math.pow(ndl, 0.7)) * (0.86 + 0.14 * z);
  }
  const moonCache = new Map();
  function moonTex(N) {
    let t = moonCache.get(N); if (t) return t;
    if (moonCache.size > 40) moonCache.clear();
    t = new Uint32Array(N * N); const ss = N < 56 ? 3 : 2;                                      // a few samples per texel keep small sizes clean
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let b = 0;
      for (let a = 0; a < ss; a++) for (let c = 0; c < ss; c++) { let x = (i + (a + 0.5) / ss) / N * 2 - 1, y = 1 - (j + (c + 0.5) / ss) / N * 2; const q = x * x + y * y; if (q > 0.998) { const f = Math.sqrt(0.998 / q); x *= f; y *= f; } b += moonLight(x, y); }
      const v = Math.max(0.14, Math.min(1, Math.round(b / (ss * ss) * 14) / 14));                 // a 14-step grey ramp keeps the pixel-art look
      t[j * N + i] = rgb(Math.round(236 * v + 10), Math.round(234 * v + 10), Math.round(230 * v + 18)); }
    moonCache.set(N, t); return t;
  }

  /* rocket sprites */
  const PAL = { W: '#E8ECF2', w: '#C3CAD6', R: '#D23B2E', r: '#A82C22', B: '#5CC8FF', K: '#2A2F3A', G: '#8A93A3', D: '#3A3F4B' };
  const CAPSULE = ['.....W.....', '....WWw....', '...WWWWw...', '...WBBBw...', '..WWBBBWw..', '..WWWWWWw..', '..WRRRRRr..', '..WWWWWWw..', '..GGGGGGG..'];
  const STAGE2 = ['..WWWWWWw..', '..WWWKWWw..', '..WWWKWWw..', '..WRRRRRr..', '..WWWWWWw..', '..WWWWWWw..', '..WWWWWWw..', '..GGGGGGG..', '...DDDDD...'];
  const STAGE1 = ['.WWWWWWWWw.', '.WWWWKWWWw.', '.WRRRRRRRr.', '.WWWWWWWWw.', '.WWWWKWWWw.', '.WWWWWWWWw.', '.WKWKWKWKw.', '.WWWWWWWWw.', '.WWWWWWWWw.', 'RWWWWWWWWwr', 'RWWWWWWWWwr', 'RRWWWWWWwrr', 'RRGGGGGGGrr', 'R.DD.D.DD.r'];
  const ENGINE = ['...GGGGG...', '....DDD....'];
  function sprite(rows) {
    const c = document.createElement('canvas'); c.width = 11; c.height = rows.length; const x = c.getContext('2d');
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (PAL[row[i]]) { x.fillStyle = PAL[row[i]]; x.fillRect(i, j, 1, 1); } });
    return c;
  }
  /* The module spinning about its long axis (E6): its markings are wrapped round the hull, 16 columns to a turn, and each frame shows
     the half that faces us. Frame 0 is the ordinary module; a red stripe down the far side and two seam lines come round as it turns. */
  const ROLL_N = 16, ROLL = [];
  for (let f = 0; f < ROLL_N; f++) {
    const rows = CAPSULE.map((row, j) => { const c0 = row.search(/[^.]/), c1 = row.length - 1 - row.split('').reverse().join('').search(/[^.]/), wr = c1 - c0 + 1; let out = '';
      for (let i = 0; i < row.length; i++) { if (i < c0 || i > c1) { out += '.'; continue; }
        const u = ((Math.round(Math.asin((i - c0 + 0.5) / wr * 2 - 1) / (2 * Math.PI) * ROLL_N) + f) % ROLL_N + ROLL_N) % ROLL_N, edge = i === c1;
        let ch = j === 8 ? 'G' : j === 6 ? (edge ? 'r' : 'R') : edge ? 'w' : 'W';
        if (j !== 6 && j !== 8) { if ((j === 3 || j === 4) && (u === 15 || u <= 1)) ch = 'B'; else if (j >= 2 && u >= 7 && u <= 9) ch = edge ? 'r' : 'R'; else if (j >= 4 && (u === 5 || u === 11)) ch = 'K'; }
        out += ch; }
      return out; });
    ROLL.push(sprite(rows.concat(ENGINE)));
  }
  const SPR = [sprite(CAPSULE.concat(STAGE2, STAGE1)), sprite(CAPSULE.concat(STAGE2)), ROLL[0]];
  const DROP = [null, sprite(STAGE1), sprite(STAGE2)];
  const CUT = [0, 14, 21];           // rows gone from the tail after each separation
  const FLAME_W = [7, 5, 3];

  /* clouds fixed in the world: [x, altitude, width, height] */
  const CLOUDS = [[-0.62 * RH, 1.25 * RH, 0.55 * RH, 0.14 * RH], [0.7 * RH, 1.7 * RH, 0.6 * RH, 0.15 * RH]];
  (function () { let a = 4 * RH; for (let i = 0; i < 20; i++) { const side = i % 2 ? 1 : -1, r = (h2(i, 77) & 255) / 255;
    CLOUDS.push([side * a * (0.3 + 0.55 * r), a, a * (0.34 + 0.2 * r), a * 0.09]); a *= 1.2; } })();

  const parts = [], debris = [], blast = [];
  const rcs = { wait: 1.5, t: 0, on: false, side: 1, a: 3, along: 0, x: 0, y: 0, jx: 0, jy: 0 };   // reaction-control thruster firings in Moon orbit: for show only
  let flick = 0, flickT = 0, flash = 0, shake = 0;
  const STAR_PAR = 5;               // stars drift this many pixels per Earth radius travelled

  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return false;
    ps = Math.max(2, Math.round(r.height / 200));
    const w = Math.max(40, Math.ceil(r.width / ps)), h = Math.max(60, Math.ceil(r.height / ps));
    topInset = Math.min(h * 0.5, hud.offsetHeight / ps);
    if (w === W && h === H) return true;
    W = w; H = h; cv.width = W; cv.height = H; cv.style.width = W * ps + 'px'; cv.style.height = H * ps + 'px';
    img = g.createImageData(W, H); px = new Uint32Array(img.data.buffer);
    stars = new Uint32Array(W * H);
    for (let i = 0; i < stars.length; i++) { const h = h2(i, 4242) % 1000; stars[i] = h < 3 ? rgb(255, 255, 255) : h < 6 ? rgb(150, 160, 196) : h < 8 ? rgb(255, 226, 160) : SPACE; }
    return true;
  }

  /* Three framings, blended along the flight clock (seconds of playing since ignition):
     Earth    - the view widens with altitude and shows more sky and less ground, until the whole planet is small and distant;
     close-up - from the edge of space (E3) Earth slides out of sight and the view closes on the rocket;
     Moon     - from stage 2 separation (E4) the view widens again until the Moon is in the picture, then tightens as the rocket nears it.
     Each framing says how big the world is drawn and where the rocket sits on screen; blending those keeps the rocket in view throughout. */
  function camera(p) {
    const usable = Math.max(40, H - topInset), r0 = topInset + usable / 2, T = MT.MILESTONES, fp = sim.fp, orbit = sim.mode === 'orbit';
    // Earth framing
    // Earth framing: the ground takes less and less of the picture as the rocket climbs (30% at the pad, under 10% high up),
    // then the horizon curves, the planet rounds into a ball, and by the edge of space all of it is in view, small and distant
    const alt = p.alt, top = 0.9 * alt + 1.6 * RH, share = lerp(0.30, 0.09, smooth(0, 3.2, Math.log10(Math.max(alt, RH) / RH)));
    const d = lerp(share / (1 - share) * (alt + top), 2.35, smooth(0.25, 3.2, alt)), yBot = 1 - d, yTop = p.y + top;
    const wE = smooth(0.25, 2.0, alt), padX = 0.3 * alt + RH;
    const xMin = Math.min(p.x - padX, -1.08 * wE), xMax = Math.max(p.x + padX, 1.08 * wE);
    let s = Math.min(0.32 * H / RH, usable / (yTop - yBot), W * 0.9 / (xMax - xMin));
    let rx = W / 2 + (p.x - (xMin + xMax) / 2) * s, ry = H - (p.y - yBot) * s;      // where the rocket's tail sits on screen
    // close-up
    const wC = orbit ? 0 : smooth(T.space, T.space + 120, fp);
    if (wC > 0) { s = Math.exp(lerp(Math.log(s), Math.log(usable / 6), wC)); rx = lerp(rx, W / 2, wC); ry = lerp(ry, r0 + 0.14 * H, wC); }
    // Moon framing
    const wM = orbit ? 1 : smooth(T.stage2 + 3, T.stage2 + 55, fp);
    // on the way in, the margins tighten and the rocket is drawn larger, so it does not shrink to a speck beside the Moon
    const appr = orbit ? 1 : smooth(T.stage2 + 55, T.orbit - 60, fp);
    if (wM > 0) { const m = RO * lerp(1.3, 1.22, appr), fit = (a0, a1, b0, b1) => Math.min(usable / (b1 - b0), W * 0.94 / (a1 - a0));
      let x0 = Math.min(p.x, MOON.x - m), x1 = Math.max(p.x, MOON.x + m), y0 = Math.min(p.y, MOON.y - m), y1 = Math.max(p.y, MOON.y + m);
      const s0 = fit(x0, x1, y0, y1), back = 36 / s0, side = 14 / s0;          // room on screen for the flame trailing behind and for the body
      x0 = Math.min(p.x - back, MOON.x - m); x1 = Math.max(p.x + side, MOON.x + m); y0 = Math.min(p.y - back, MOON.y - m); y1 = Math.max(p.y + side, MOON.y + m);
      const sM = fit(x0, x1, y0, y1);
      s = Math.exp(lerp(Math.log(s), Math.log(sM), wM)); rx = lerp(rx, W / 2 + (p.x - (x0 + x1) / 2) * sM, wM); ry = lerp(ry, r0 - (p.y - (y0 + y1) / 2) * sM, wM); }
    return { s: s, cx: p.x - (rx - W / 2) / s, cy: p.y + (ry - H / 2) / s, wM: wM, k: lerp(lerp(1, 2.2, wC), lerp(1.05, 1.6, appr) + 0.5 * sim.spinUp, wM) };          // a little larger still once it is spinning in orbit
  }

  function background(cam) {
    const inv = 1 / cam.s, x0 = cam.cx - W / 2 * inv, m2r = MOON.r * MOON.r, near = inv < B, fade = inv > B * 0.45;
    const MN = Math.max(12, Math.min(160, 2 * Math.round(MOON.r * cam.s))), mscale = MN / (2 * MOON.r);
    const moonOn = Math.abs(cam.cx - MOON.x) < W / 2 * inv + MOON.r && Math.abs(cam.cy - MOON.y) < H / 2 * inv + MOON.r, MTX = moonOn ? moonTex(MN) : null;
    const tf = Math.round(256 * Math.min(1, Math.max(0, (inv - B * 0.45) / (B * 0.55)))), en2 = EN / 2;
    /* ground texture between the close-up blocks and the far-away map: blocks that regroup as the view widens, so the climb reads as motion */
    const lv = Math.log2(inv / B), lf = lv - Math.floor(lv), S0 = B * Math.pow(2, Math.floor(lv) + 3), S1 = S0 * 2, amp = lv > -1 ? Math.round(9 * (1 - smooth(0.05, 0.5, 1.5 * inv * H))) : 0;
    const n = W * H, so = ((Math.round(-cam.cy * STAR_PAR) * W + Math.round(cam.cx * STAR_PAR)) % n + n) % n;
    let i = 0;
    for (let py = 0; py < H; py++) {
      const y = cam.cy - (py + 0.5 - H / 2) * inv, yy = y * y;
      for (let qx = 0; qx < W; qx++, i++) {
        const x = x0 + (qx + 0.5) * inv, r2 = x * x + yy; let c;
        if (r2 < 1) {
          let far = 0;
          if (!near || fade) { let u = ((x + 1) * en2) | 0, v = ((1 - y) * en2) | 0; if (u >= EN) u = EN - 1; if (v >= EN) v = EN - 1; far = EARTH[v * EN + u];
            if (amp > 0) { const dep = 1 - Math.sqrt(r2), a0 = h2(Math.floor(x / S0), Math.floor(dep / S0) + 7919) & 15, a1 = h2(Math.floor(x / S1), Math.floor(dep / S1) + 7919) & 15;
              const m = 256 + (((a0 * (1 - lf) + a1 * lf) - 7.5) * amp | 0);
              let r = ((far & 255) * m) >> 8, gg = (((far >>> 8) & 255) * m) >> 8, bb = (((far >>> 16) & 255) * m) >> 8;
              far = (0xFF000000 | (bb > 255 ? 255 : bb) << 16 | (gg > 255 ? 255 : gg) << 8 | (r > 255 ? 255 : r)) >>> 0; } }
          if (!near) c = far;
          else { const depth = 1 - Math.sqrt(r2), by = Math.floor(depth / B), h = h2(Math.floor(x / B), by);
            if (by < 1) c = GRASS[h & 3]; else if (by < 4) c = DIRT[h & 3];
            else { const o = (h >>> 4) % 61; c = o === 0 ? GEM : o < 4 ? COAL : STONE[h & 3]; }
            if (fade) { const u = 256 - tf;      // blocks melt into the far-away map as the camera pulls back
              c = (0xFF000000 | ((((c >>> 16) & 255) * u + ((far >>> 16) & 255) * tf) >> 8) << 16 | ((((c >>> 8) & 255) * u + ((far >>> 8) & 255) * tf) >> 8) << 8 | (((c & 255) * u + (far & 255) * tf) >> 8)) >>> 0; } }
        } else {
          const mx = x - MOON.x, my = y - MOON.y, m2 = mx * mx + my * my;
          if (m2 < m2r && MTX) { let tu = ((mx + MOON.r) * mscale) | 0, tv = ((MOON.r - my) * mscale) | 0; if (tu >= MN) tu = MN - 1; if (tv >= MN) tv = MN - 1; c = MTX[tv * MN + tu]; }
          else { const a = Math.sqrt(r2) - 1;
            if (a < SPACE_ALT) { let li = ((Math.log(a) - LLO) / LSTEP) | 0; if (li < 0) li = 0;
              const t = SKYLUT[li]; c = SKY[(t + (((qx ^ py) & 1) ? 0.5 : 0)) | 0];
              if (t > STAR_FROM) { const sc = stars[(i + so) % n]; if (sc !== SPACE) c = sc; } }
            else c = stars[(i + so) % n]; }
        }
        px[i] = c;
      }
    }
    g.putImageData(img, 0, 0);
  }

  function addPart(x, y, vx, vy, life, sz, shade) { if (parts.length > 160) parts.shift(); parts.push({ x: x, y: y, vx: vx, vy: vy, t: 0, life: life, sz: sz, c: shade }); }

  function event(name) {
    if (name === 'stage1' || name === 'stage2') debris.push({ img: DROP[name === 'stage1' ? 1 : 2], t: 0, a: 0, va: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random()) });
    if (name === 'crash') {                       // blocky fireball, flying wreckage, then smoke
      flash = 1; shake = 0.7;
      const cols = ['#FFF3B0', '#FFD23F', '#FFB629', '#E2502C', '#A82C22', '#E8ECF2', '#8A93A3', '#3A3F4B'];
      for (let i = 0; i < 90; i++) { const a = Math.random() * Math.PI, sp = (0.4 + Math.random() * 2.6) * RH, fire = i < 60;
        blast.push({ x: (Math.random() - 0.5) * RH * 0.3, y: 1 + Math.random() * RH * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 1.2, t: 0, life: 0.7 + Math.random() * 1.3,
          sz: fire ? 2 + Math.random() * 3 : 2 + Math.random() * 2, c: fire ? cols[(Math.random() * 5) | 0] : cols[5 + ((Math.random() * 3) | 0)], g: fire ? 0.6 : 2.2 }); }
      for (let i = 0; i < 40; i++) addPart((Math.random() - 0.5) * RH * 0.5, 1 + Math.random() * RH * 0.3, (Math.random() - 0.5) * RH * 1.2, (0.2 + Math.random() * 0.9) * RH, 1.4 + Math.random() * 1.6, 4, 40 + Math.random() * 70);
    }
  }
  function reset() { parts.length = 0; debris.length = 0; blast.length = 0; flash = 0; shake = 0; rcs.on = false; rcs.t = 0; rcs.wait = 1.5; }

  /* v: {running, playing, power}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    const p = sim.pose(), cam = camera(p), s = cam.s;
    const X = x => W / 2 + (x - cam.cx) * s, Y = y => H / 2 - (y - cam.cy) * s;
    background(cam);
    g.imageSmoothingEnabled = false;

    // clouds
    g.fillStyle = '#F4F8FF';
    for (const c of CLOUDS) { const w = c[2] * s; if (w < 4 || w > W * 3) continue; const h = Math.max(2, c[3] * s);
      const x = Math.round(X(c[0]) - w / 2), y = Math.round(Y(1 + c[1]));
      if (y < -h * 2 || y > H + h || x > W || x + w < 0) continue;
      g.globalAlpha = 0.9 * smooth(4, 9, w);
      g.fillRect(x, y, Math.round(w), Math.round(h)); g.fillRect(x + Math.round(w * 0.18), y - Math.round(h * 0.6), Math.round(w * 0.5), Math.round(h * 0.6)); g.fillRect(x + Math.round(w * 0.1), y + Math.round(h), Math.round(w * 0.7), Math.max(1, Math.round(h * 0.4))); }
    g.globalAlpha = 1;

    // after an explosion everything drawn over the scenery shakes for a moment
    if (shake > 0) { shake -= dt; g.save(); g.translate(Math.round((Math.random() - 0.5) * 5 * shake), Math.round((Math.random() - 0.5) * 5 * shake)); } else g.save();

    const hp = s * RH, k = Math.max(cam.k, Math.min(2.5, hp / 32));     // true size near the pad, an icon after that: larger in the close-up and on the approach to the Moon
    const sx = X(p.x), sy = Y(p.y), wreck = sim.mode === 'pad' && sim.down > 0;

    // the orbit around the Moon, as a dotted ring
    if (cam.wM > 0.3) { g.fillStyle = '#A3ACC2'; g.globalAlpha = 0.5 * smooth(0.3, 1, cam.wM);
      for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24; g.fillRect(Math.round(X(MOON.x + RO * Math.cos(a))), Math.round(Y(MOON.y + RO * Math.sin(a))), 1, 1); }
      g.globalAlpha = 1; }

    // launch pad and tower, at true scale
    const kp = hp / 32;
    if (kp > 0.3) { const gx = X(0), gy = Y(1), u = v2 => Math.max(1, Math.round(v2 * kp));
      g.globalAlpha = smooth(0.3, 0.6, kp);
      g.fillStyle = '#5E6470'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy), u(22), u(2));
      g.fillStyle = '#8A93A3'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy), u(22), u(1));
      for (let j = 0; j < 10; j++) { g.fillStyle = j % 2 ? '#E8ECF2' : '#D23B2E'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy - (j + 1) * 3 * kp), u(3), u(3)); }
      g.fillStyle = '#5E6470'; g.fillRect(Math.round(gx - 8 * kp), Math.round(gy - 25 * kp), u(3), u(1));
      if (wreck) { g.fillStyle = '#23262E'; g.fillRect(Math.round(gx - 7 * kp), Math.round(gy - kp), u(15), u(2)); g.fillRect(Math.round(gx - 4 * kp), Math.round(gy - 2 * kp), u(6), u(1)); }
      g.globalAlpha = 1; }

    // engine state: the flame follows engine power, and gutters whenever efficiency is dropping
    flickT -= dt; if (flickT <= 0) { flickT = 0.07; flick = Math.random(); }
    // Where the tail end sits along the rocket's axis. While stages remain the nose stays put when one drops;
    // beside the Moon the capsule is centred on its true position, so it rides on the orbit line.
    const stage = sim.stage, cut = lerp(CUT[stage] * k, -SPR[stage].height * k / 2, cam.wM), lit = sim.ignited && v.running && !wreck, sput = lit && !v.playing;
    const tilt = sim.mode === 'fall' ? Math.sin(performance.now() / 260) * 0.5 : sput ? (flick - 0.5) * 0.07 : 0;
    const sn = Math.sin(p.ang), cs = Math.cos(p.ang);
    const tailX = sx + sn * cut, tailY = sy - cs * cut;              // screen position of the current tail end
    const tailWX = cam.cx + (tailX - W / 2) / s, tailWY = cam.cy - (tailY - H / 2) / s;

    // smoke: white while the engine pulls, dark and heavy while it loses power or the rocket falls
    if (dt > 0 && (lit || sim.mode === 'fall')) {
      if (sim.mode === 'pad') for (let i = 0; i < 2; i++) { const side = Math.random() < 0.5 ? -1 : 1;
        addPart(side * RH * 0.03, 1 + RH * 0.02, side * RH * (0.5 + Math.random() * 1.2) * (0.4 + v.power), RH * Math.random() * 0.25, 0.7 + Math.random() * 0.8, 2.2 * k, sput ? 70 : 200 + Math.random() * 50); }
      else if (sim.mode === 'fall') addPart(tailWX + (Math.random() - 0.5) * 4 / s, tailWY + (Math.random() - 0.5) * 4 / s, (Math.random() - 0.5) * 8 / s, 6 / s, 1.1 + Math.random() * 0.8, 2 * k, 50 + Math.random() * 40);
      else if (p.alt < 0.03 || sput) addPart(tailWX + (Math.random() - 0.5) * 3 / s, tailWY + (Math.random() - 0.5) * 3 / s, (Math.random() - 0.5) * 6 / s, (Math.random() - 0.5) * 6 / s, 0.9 + Math.random() * 0.6, (sput ? 2.2 : 1.6) * k, sput ? 60 + Math.random() * 30 : 190 + Math.random() * 60);
    }
    if (dt > 0 && sim.spinUp > 0 && sim.spinUp < 1 && v.running) { const side = Math.random() < 0.5 ? -1 : 1, d = 6 * k;      // small thruster puffs set the spin going
      addPart(cam.cx + (sx + cs * side * d - W / 2) / s, cam.cy - (sy + sn * side * d - H / 2) / s, cs * side * 14 / s, -sn * side * 14 / s, 0.35 + Math.random() * 0.3, 1.2 * k, 225); }
    // E6, for show only: now and then a reaction-control thruster fires a short burst. Nothing about the orbit or the spin changes.
    if (sim.mode === 'orbit' && sim.spinUp >= 1 && v.running && dt > 0) {
      if (rcs.t > 0) { rcs.t -= dt; rcs.on = true;
        rcs.x = sx + sn * rcs.a * k + cs * rcs.side * 5 * k; rcs.y = sy - cs * rcs.a * k + sn * rcs.side * 5 * k;                     // the nozzle, on screen
        rcs.jx = rcs.along ? sn * rcs.along : cs * rcs.side; rcs.jy = rcs.along ? -cs * rcs.along : sn * rcs.side;                       // which way the jet points
        for (let i = 0; i < 2; i++) { const sp = 26 + Math.random() * 22;
          addPart(cam.cx + (rcs.x - W / 2) / s, cam.cy - (rcs.y - H / 2) / s, (rcs.jx * sp + (Math.random() - 0.5) * 9) / s, -(rcs.jy * sp + (Math.random() - 0.5) * 9) / s, 0.22 + Math.random() * 0.26, 1.1 * k, 236); } }
      else { rcs.on = false; rcs.wait -= dt;
        if (rcs.wait <= 0) { rcs.t = 0.2 + Math.random() * 0.3; rcs.wait = Math.random() < 0.3 ? 0.35 : 3 + Math.random() * 5;                // sometimes a quick second pulse
          rcs.side = Math.random() < 0.5 ? -1 : 1; rcs.a = (Math.random() < 0.5 ? -1 : 1) * 3; rcs.along = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0; } }
    } else { rcs.on = false; rcs.t = 0; }
    for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.t += dt; if (q.t >= q.life) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      const u = q.t / q.life, z = Math.max(1, Math.round(q.sz * (0.6 + u))), c = q.c | 0;
      g.globalAlpha = 0.85 * (1 - u); g.fillStyle = 'rgb(' + c + ',' + c + ',' + (c + 6) + ')';
      g.fillRect(Math.round(X(q.x) - z / 2), Math.round(Y(q.y) - z / 2), z, z); }
    g.globalAlpha = 1;

    // dropped stages drift away behind the rocket
    for (let i = debris.length - 1; i >= 0; i--) { const d = debris[i];
      if (d.t === 0) { d.x = tailX; d.y = tailY; d.vx = -sn * 9 + (Math.random() - 0.5) * 4; d.vy = cs * 9; d.a = p.ang; d.k = k; }
      d.t += dt; if (d.t > 6) { debris.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 5 * dt; d.a += d.va * dt;
      const kk = d.k * (1 - d.t / 7);
      g.save(); g.translate(Math.round(d.x), Math.round(d.y)); g.rotate(d.a); g.globalAlpha = Math.min(1, (6 - d.t) / 1.5);
      g.drawImage(d.img, -5.5 * kk, 0, 11 * kk, d.img.height * kk); g.restore(); }

    // rocket, nose anchored so a separation never makes it jump; gone while the wreck is cleared, then a new one fades in
    const shown = wreck ? Math.max(0, 1 - sim.down / 0.6) : 1;
    if (shown > 0) {
      const spr = stage === 2 && sim.spinUp > 0 ? ROLL[Math.floor(sim.spinA / (2 * Math.PI) * ROLL_N) % ROLL_N] : SPR[stage], hh = spr.height * k;   // in Moon orbit the module spins about its length (E6)
      g.save(); g.translate(Math.round(sx), Math.round(sy)); g.rotate(p.ang + tilt); g.globalAlpha = shown;
      g.drawImage(spr, -5.5 * k, -cut - hh, 11 * k, hh);
      if (lit) {
        const blk = Math.max(1, Math.round(k)), fw = FLAME_W[stage] * k, flying = sim.mode !== 'pad';
        const thrust = flying ? Math.max(0, Math.min(1, (v.power - 0.5) / 0.5)) : v.power;
        let len = k * (flying ? 5 + 16 * thrust : 3 + 11 * thrust) * (0.82 + 0.36 * flick);
        if (sput) len *= flick < 0.5 ? 0.15 : 0.55;
        const hot = sput ? '#FFB629' : '#FFF3B0', mid = sput ? '#E2502C' : '#FFB629', cool = sput ? '#A82C22' : '#E2502C';
        if (!flying) {                             // on the pad the exhaust spreads sideways along the ground
          const side = len * 0.9;
          for (let j = 0; j < side; j += blk) { const u = j / side; g.fillStyle = u < 0.3 ? hot : u < 0.65 ? mid : cool;
            const hgt = Math.max(blk, Math.round(2.4 * k * (1 - 0.6 * u)));
            g.fillRect(Math.round(fw / 2 + j), -hgt, blk, hgt); g.fillRect(Math.round(-fw / 2 - j - blk), -hgt, blk, hgt); }
          len = 0;
        }
        for (let j = 0; j < len; j += blk) { const u = j / len, half = Math.max(blk / 2, fw / 2 * Math.pow(1 - u, 0.7));
          g.fillStyle = u < 0.25 ? hot : u < 0.6 ? mid : cool;
          const jit = u > 0.3 && ((h2(j, (flick * 97) | 0) & 3) === 0) ? blk : 0;
          g.fillRect(Math.round(-half + jit), Math.round(-cut + j), Math.max(1, Math.round(half * 2)), blk); }
      }
      g.restore();
    }

    if (rcs.on) { const b = Math.max(1, Math.round(k * 0.8)); g.fillStyle = '#E4F3FF';
      for (let j = 0; j < 3; j++) g.fillRect(Math.round(rcs.x + rcs.jx * j * b - b / 2), Math.round(rcs.y + rcs.jy * j * b - b / 2), b, b); }

    // explosion: fireball blocks and wreckage thrown out from the pad
    for (let i = blast.length - 1; i >= 0; i--) { const q = blast[i]; q.t += dt; if (q.t >= q.life) { blast.splice(i, 1); continue; }
      q.vy -= q.g * RH * dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.y < 1) { q.y = 1; q.vy *= -0.3; q.vx *= 0.6; }
      const u = q.t / q.life, z = Math.max(1, Math.round(q.sz * Math.max(0.5, hp / 40) * (1 - 0.5 * u)));
      g.globalAlpha = u > 0.6 ? (1 - u) / 0.4 : 1; g.fillStyle = q.c; g.fillRect(Math.round(X(q.x) - z / 2), Math.round(Y(q.y) - z / 2), z, z); }
    g.globalAlpha = 1;

    g.globalAlpha = 1;
    g.restore();
    if (flash > 0) { g.globalAlpha = Math.min(1, flash) * 0.85; g.fillStyle = '#FFF6D0'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; flash -= dt * 2.6; }
  }

  return { resize: resize, draw: draw, event: event, reset: reset, rcs: rcs };
}
