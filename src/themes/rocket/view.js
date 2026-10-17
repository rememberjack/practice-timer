/* Rocket theme renderer: a low-resolution pixel canvas, drawn fresh every frame.
   World units are Earth radii (see RocketSim in sim.js). RES canvas pixels stand where one stood before: sizes in pixels below are
   written for the coarser canvas and multiplied by it, so the framing is the same and only the detail is finer. */
function makeRocketView(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d');
  const WORLD = MT.WORLD, RH = WORLD.ROCKET_H, SPACE_ALT = WORLD.SPACE, MOON = WORLD.MOON, RO = WORLD.ORBIT, B = RH / 8;
  const smooth = MT.smooth, lerp = (a, b, t) => a + (b - a) * t;
  const RES = 2;
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
  for (let i = 0; i <= LUTN; i++) SKYLUT[i] = Math.min(1, sim.kmAtAlt(Math.exp(LLO + i * LSTEP)) / 100) * SKYN;
  const STAR_FROM = 0.74 * SKYN;

  /* far view of Earth: a blocky map looked at from the side; the pad (top of the disc) sits on land */
  const EN = 32 * RES, EARTH = new Uint32Array(EN * EN);
  (function () {
    const lat = (x, y, s, seed) => { x /= RES; y /= RES; const xi = Math.floor(x / s), yi = Math.floor(y / s), fx = x / s - xi, fy = y / s - yi;
      const v = (i, j) => (h2(i * 7 + seed, j * 13 + seed * 3) & 1023) / 1023;
      return lerp(lerp(v(xi, yi), v(xi + 1, yi), fx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), fx), fy); };
    const OC = [rgb(38, 92, 190), rgb(46, 104, 204), rgb(32, 82, 176)], LA = [rgb(88, 160, 60), rgb(76, 146, 52), rgb(104, 170, 70)];
    const DE = rgb(196, 176, 104), IC = rgb(232, 240, 248), CL = rgb(240, 244, 250);
    for (let y = 0; y < EN; y++) for (let x = 0; x < EN; x++) {
      const n = 0.65 * lat(x, y, 9, 5) + 0.35 * lat(x, y, 4, 11) + 0.55 * Math.max(0, 1 - Math.hypot(x - EN / 2, y) / (9 * RES));
      const h = h2(x + 91, y + 17); let c;
      if (y >= EN - 3 * RES && n > 0.3) c = IC; else if (n > 0.52) c = lat(x, y, 6, 23) > 0.66 && y > 8 * RES ? DE : LA[h % 3]; else c = OC[h % 3];
      if (y > 4 * RES && (h >>> 8) % 100 < 7) c = CL;
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
    t = new Uint32Array(N * N); const ss = N < 56 ? 3 : N < 160 ? 2 : 1;                        // a few samples per texel keep small sizes clean
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
  /* Scale2x (EPX): each sprite pixel becomes RES x RES, and its corners follow the diagonals, so the slopes are smoother than plain blocks */
  function scale2x(rows) {
    const at = (i, j) => (rows[j] && rows[j][i]) || '.', out = [];
    for (let j = 0; j < rows.length; j++) { let a = '', b = '';
      for (let i = 0; i < rows[j].length; i++) { const P = at(i, j), A = at(i, j - 1), B = at(i + 1, j), C = at(i - 1, j), D = at(i, j + 1);
        a += (C === A && C !== D && A !== B ? A : P) + (A === B && A !== C && B !== D ? B : P);
        b += (D === C && D !== B && C !== A ? C : P) + (B === D && B !== A && D !== C ? D : P); }
      out.push(a, b); }
    return out;
  }
  function sprite(rows, raw, pal) {
    if (RES === 2 && !raw) rows = scale2x(rows);
    const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; const x = c.getContext('2d'), P = pal || PAL;
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (P[row[i]]) { x.fillStyle = P[row[i]]; x.fillRect(i, j, 1, 1); } });
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
  /* drawn smaller than one canvas pixel to a Scale2x pixel (high in the climb), the plain sprites keep every row */
  const SMALL = [sprite(CAPSULE.concat(STAGE2, STAGE1), true), sprite(CAPSULE.concat(STAGE2), true), sprite(CAPSULE.concat(ENGINE), true)];
  /* the module close up (deep space): the same 11 x 11 footprint drawn at three times the pixels. A nose with an antenna tip, a round
     porthole in a metal frame with a glint on the glass, the hull shaded round from the light side, panel seams and rivets, the red band,
     control thrusters on either side, the base ring and a ribbed engine bell. Frame f has it rolled f sixteenths of a turn about its length
     (the slow roll in the coast): the porthole, the rivets, two seams and a red stripe on the far side come round, while the light stays put */
  function detail(f) {
    const phi = -2 * Math.PI * f / ROLL_N, rim = a => 16 + 10.5 * 0.92 * Math.sin(phi + a), shows = a => Math.cos(phi + a);
    const N = 33, cx = 16, P = { H: '#FFFFFF', W: '#E8ECF2', w: '#C3CAD6', v: '#9AA3B2', R: '#D23B2E', r: '#A82C22', S: '#F0645A', B: '#5CC8FF', b: '#2F86C8',
      L: '#DDF6FF', F: '#8A93A3', f: '#5E6470', G: '#8A93A3', M: '#B8C0CE', D: '#3A3F4B', E: '#5A606C', e: '#7C8494', K: '#2A2F3A' };
    const px = []; for (let y = 0; y < N; y++) px.push(new Array(N).fill(''));
    const hull = (x, y, hw) => { const u = (x - cx) / hw; return u < -0.86 ? 'w' : u < -0.55 ? 'H' : u < 0.5 ? 'W' : u < 0.84 ? 'w' : 'v'; };   // light from the left
    /* rows as the 11 x 11 module, each three pixels tall: tip and nose 0-8, shoulder 9-11, body 12-23 with the porthole high up and the
       red band at 18-20, base ring 24-26, then the engine: a ribbed grey skirt 27-29 and the nozzle 30-32 */
    for (let y = 0; y < N; y++) {
      const hw = y < 2 ? 0.5 : y < 9 ? 1 + 6.5 * (y - 2) / 6 : y < 12 ? 7.5 + (y - 8) : y < 27 ? 10.5 : y < 30 ? 7.5 - (y - 27) * 0.5 : 3.5 + (y - 30) * 0.8;
      for (let x = 0; x < N; x++) { const dx = x - cx; if (Math.abs(dx) > hw) continue;
        let c;
        if (y < 2) c = y === 0 ? 'H' : 'M';                                                        // antenna tip
        else if (y < 24) {
          c = hull(x, y, hw);
          if (y >= 18 && y <= 20) { const u = dx / hw; c = y === 18 ? (u < 0.5 ? 'S' : 'R') : y === 20 ? 'r' : (u < 0.6 ? 'R' : 'r'); }   // the red band
          else if ((y === 13 || y === 22) && (x + f) % 3 === 1 && Math.abs(dx) < hw - 1) c = 'v';   // rivets
          else if (y === 16 && Math.abs(dx) < hw - 0.5) c = c === 'H' ? 'W' : c === 'W' ? 'w' : 'v';   // a panel seam
          else if (y >= 12 && shows(Math.PI) > 0.15 && Math.abs(x - rim(Math.PI)) < 1.3 * shows(Math.PI) + 0.3) c = dx / hw < 0.5 ? 'R' : 'r';   // the stripe on the far side
          else if (y >= 12 && (shows(Math.PI / 2) > 0.1 && Math.abs(x - rim(Math.PI / 2)) < 0.5 || shows(-Math.PI / 2) > 0.1 && Math.abs(x - rim(-Math.PI / 2)) < 0.5)) c = 'v';   // seams
        }
        else if (y < 27) c = y === 24 ? 'M' : y === 25 ? 'G' : 'D';                                  // base ring
        else if (y < 30) { const u = dx / hw; c = u < -0.5 ? 'M' : (x % 2 ? 'G' : 'F'); }              // engine skirt, ribbed
        else { const u = dx / hw; c = y === N - 1 ? 'K' : u < -0.3 ? 'e' : 'E'; }                    // nozzle
        px[y][x] = c; }
    }
    const pc = rim(0), sq = Math.max(0.25, shows(0));                                              // the porthole, squeezed as it turns away
    if (shows(0) > 0.2) for (let y = 5; y < 19; y++) for (let x = 0; x < N; x++) { const d = Math.hypot((x - pc) / sq, y - 11);
      if (d > 4.6) continue;
      px[y][x] = d > 3.4 ? ((x - pc) / sq + y - 11 < 0 ? 'M' : 'F') : (x - pc) / sq + (y - 11) > 2.2 ? 'b' : 'B';
      if (d < 3.4 && Math.abs((x - pc) / sq + 1.5) + Math.abs(y - 11 + 1.5) < 1.2) px[y][x] = 'L'; }
    for (const side of [-1, 1]) for (let y = 13; y < 16; y++) for (let i = 0; i < 2; i++) {         // control thrusters
      const x = side < 0 ? cx - 11 - i : cx + 11 + i; px[y][x] = i ? 'G' : (y === 14 ? 'K' : 'D'); }
    const c = document.createElement('canvas'); c.width = N; c.height = N; const g2 = c.getContext('2d');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[y][x]) { g2.fillStyle = P[px[y][x]]; g2.fillRect(x, y, 1, 1); }
    return c;
  }
  const DETAILS = []; for (let f = 0; f < ROLL_N; f++) DETAILS.push(detail(f));   // DETAILS[0] is the module not rolled
  /* Earth and the Moon as small pictures for the view of the whole way (map), where they would be specks */
  function disc(N, tex) { const c = document.createElement('canvas'); c.width = N; c.height = N; const x = c.getContext('2d'), im = x.createImageData(N, N), d = new Uint32Array(im.data.buffer);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1; d[j * N + i] = u * u + v * v < 1 ? tex[j * N + i] : 0; }
    x.putImageData(im, 0, 0); return c; }
  const EARTH_DISC = disc(EN, EARTH), MOON_DISC = disc(32 * RES, moonTex(32 * RES));
  const DROP = [null, sprite(STAGE1), sprite(STAGE2)], DROP_SMALL = [null, sprite(STAGE1, true), sprite(STAGE2, true)];
  /* stage 1 glowing as it falls back through the air */
  const PAL_HOT = { W: '#FFE0A8', w: '#F4A85C', R: '#FF6A2E', r: '#C8381E', K: '#7E2C14', G: '#E8843E', D: '#5E2612' };
  const HOT = sprite(STAGE1, false, PAL_HOT), HOT_SMALL = sprite(STAGE1, true, PAL_HOT), EMBER = ['#FFF3B0', '#FFD23F', '#FFB629', '#E2502C', '#A82C22', '#5E2612'];
  const CUT = [0, 14, 21];           // rows gone from the tail after each separation
  const FLAME_W = [7, 5, 3];

  /* clouds fixed in the world: [x, altitude, width, height] */
  const CLOUDS = [[-0.62 * RH, 1.25 * RH, 0.55 * RH, 0.14 * RH], [0.7 * RH, 1.7 * RH, 0.6 * RH, 0.15 * RH]];
  (function () { let a = 4 * RH; for (let i = 0; i < 20; i++) { const side = i % 2 ? 1 : -1, r = (h2(i, 77) & 255) / 255;
    CLOUDS.push([side * a * (0.3 + 0.55 * r), a, a * (0.34 + 0.2 * r), a * 0.09]); a *= 1.2; } })();

  const parts = [], debris = [], blast = [], embers = [];
  const rcs = { wait: 1.5, t: 0, on: false, side: 1, a: 3, along: 0, x: 0, y: 0, jx: 0, jy: 0 };   // reaction-control thruster firings in Moon orbit: for show only
  let flick = 0, flickT = 0, flash = 0, shake = 0;
  const STAR_PAR = 5 * RES;         // stars drift this many pixels per Earth radius travelled
  /* deep space at speed: streaks of light rush past from ahead, faster the faster the rocket goes, and the starfield behind slides too */
  const STREAKS = [], vRef = (sim.L - sim.lStage2) / (MT.MILESTONES.orbit - MT.MILESTONES.stage2);
  let rush = 0, driftX = 0, driftY = 0;
  for (let i = 0; i < 12; i++) STREAKS.push({ x: -1, y: -1, d: 0.45 + Math.random(), b: 0.3 + 0.5 * Math.random(), front: i % 6 === 0 });   // a few, now and then one in front
  /* close up in deep space the still starfield gives way to one that drifts past, nearer stars faster, stretching into short trails at speed */
  const DEEP = []; let deepW = 0;
  function deepSky(cam, hx, hy, dt) {
    if (deepW !== W * 1e5 + H) { deepW = W * 1e5 + H; DEEP.length = 0;
      for (let i = 0; i < Math.round(W * H / (480 * RES * RES)); i++) { const d = Math.pow(Math.random(), 1.6); DEEP.push({ x: Math.random() * W, y: Math.random() * H, d: d, c: Math.random() < 0.15 ? '#FFE2A0' : Math.random() < 0.3 ? '#96A0C4' : '#FFFFFF' }); } }
    const v = (12 + 180 * rush) * RES * dt, len = 1 + 3.5 * rush;
    for (const q of DEEP) {
      q.x = ((q.x - hx * v * (0.2 + q.d)) % W + W) % W; q.y = ((q.y - hy * v * (0.2 + q.d)) % H + H) % H;
      g.globalAlpha = cam.wC * (0.35 + 0.65 * q.d); g.fillStyle = q.c; const l = Math.max(1, Math.round(len * q.d)) * RES;
      for (let j = 0; j < l; j += RES) g.fillRect(Math.round(q.x + hx * j), Math.round(q.y + hy * j), RES, RES);
    }
    g.globalAlpha = 1;
  }
  function streaks(front, hx, hy, a0, dt) {
    for (const q of STREAKS) {
      if (!front) {                                                                              // moved once a frame, on the first pass
        if (q.x < -60 * RES || q.y < -60 * RES || q.x > W + 60 * RES || q.y > H + 60 * RES || q.x < 0 && q.y < 0) {   // off screen (or new): back in, ahead
          q.x = Math.random() * W; q.y = Math.random() * H;
          const t = Math.min(hx > 0 ? (W - q.x) / hx : hx < 0 ? -q.x / hx : 1e9, hy > 0 ? (H - q.y) / hy : hy < 0 ? -q.y / hy : 1e9);
          q.x += hx * (t + 4 * RES); q.y += hy * (t + 4 * RES); }
        const v = 1300 * RES * rush * q.d * dt; q.x -= hx * v; q.y -= hy * v;
      }
      if (q.front !== front) continue;
      const len = (6 + 18 * rush * q.d) * (q.front ? 1.3 : 1) * RES, b = q.front ? 0.8 : q.b, z = RES;
      g.fillStyle = '#D6E4FF';
      for (let j = 0; j < len; j += RES) { g.globalAlpha = a0 * b * (1 - j / len); g.fillRect(Math.round(q.x + hx * j), Math.round(q.y + hy * j), z, z); }
    }
    g.globalAlpha = 1;
  }

  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return false;
    const dpr = window.devicePixelRatio || 1;                                                    // whole device pixels to a canvas pixel keep them crisp
    ps = Math.max(1, Math.round(Math.max(2, Math.round(r.height / 200)) * dpr / RES)) / dpr;
    const w = Math.max(40 * RES, Math.ceil(r.width / ps)), h = Math.max(60 * RES, Math.ceil(r.height / ps));
    topInset = Math.min(h * 0.5, (hud.offsetTop + hud.offsetHeight) / ps);
    if (w === W && h === H) return true;
    W = w; H = h; cv.width = W; cv.height = H; cv.style.width = W * ps + 'px'; cv.style.height = H * ps + 'px';
    img = g.createImageData(W, H); px = new Uint32Array(img.data.buffer);
    stars = new Uint32Array(W * H);
    for (let i = 0; i < stars.length; i++) { const h = h2(i, 4242) % (1000 * RES); stars[i] = h < 3 ? rgb(255, 255, 255) : h < 6 ? rgb(150, 160, 196) : h < 8 ? rgb(255, 226, 160) : SPACE; }
    return true;
  }

  /* The view turns with the rocket: away from Earth is always up the screen at the rocket, so the horizon stays level under it as it pitches
     over to fly level in Earth orbit, then climbs away; nearing the Moon the view turns until it flies level over the Moon, and it never points
     down the screen on the way. In Moon orbit the view holds still, the Moon in the middle, and the rocket goes round it.
     Four framings, blended along the flight clock (seconds of playing since ignition), all worked out in that turned view:
     Earth    - the view widens with altitude and shows more sky and less ground as the rocket climbs, a thin strip in Earth orbit; after the burn
                for the Moon the horizon curves and the whole planet comes into view, small and distant; the rocket, true to size on the pad,
                is drawn smaller and smaller as it climbs (k);
     Earth and rocket - a minute into the coast, Earth and the rocket, small, climbing away from it, until Earth slips out of view below;
     deep space - then the view closes on the rocket alone, Earth out of sight, stars streaking past;
     Moon     - from 5 minutes before Moon orbit the view widens to take in the Moon, small and far, then tightens as the rocket nears it.
     Each framing says how big the world is drawn and where the rocket sits on screen; blending those keeps the rocket in view throughout. */
  const KS = 0.5;                   // the rocket's size from the edge of space until the view closes in on it: one canvas pixel to a sprite pixel
  const CT = {}; for (const c of MT.COAST) CT[c.id] = c.at;    // the moments along the way on the flight clock
  /* the ISS, drawn at the rocket's scale (it is about as wide as the rocket is tall): its long truss, a solar array at each end and its
     modules in the middle. It goes round Earth at its own height and speed, right over the rocket at ISS.at */
  const ISS = MT.ISS, KMW = 10 * RH;                                    // KMW: a kilometre in world units
  const ISS_SPR = sprite(['A.a.........a.A', 'A.a.........a.A', 'A.a....M....a.A', 'TTTTTTTMTTTTTTT', 'A.a...MMM...a.A', 'A.a....M....a.A', 'A.a.........a.A'], true,
    { A: '#D9A441', a: '#B07A2A', T: '#A3ACC2', M: '#E8ECF2' });
  const issFrom = (function () { const q = sim.pathAt(sim.lenAt(ISS.at)); return Math.atan2(q.x, q.y); })();
  const issAt = fp => { const a = issFrom + ISS.v / (6371 + ISS.km) * (fp - ISS.at), r = 1 + ISS.km * KMW; return [r * Math.sin(a), r * Math.cos(a)]; };
  /* now and then in the coast the view pulls back slowly to show the whole way: Earth, the path flown and still to fly, the rocket and the
     Moon (one of them just after halfway); 8 s out, 10 s held, 8 s back */
  const MAPS = [CT.roll + 80, CT.halfway + 4, CT.correction + 100, CT.correction + 230];
  const mapW = fp => { let w = 0; for (const a of MAPS) w = Math.max(w, smooth(a, a + 8, fp) * (1 - smooth(a + 18, a + 26, fp))); return w; };
  /* the heights the satellites fly at: the GPS satellites (20,200 km) and the weather and TV satellites' ring (35,786 km). Each is a faint
     dotted ring round Earth with its satellites as specks moving slowly along it, shown while the rocket climbs through them:
     [moment, height in km, satellites, seconds of playing to go round, colour] */
  const SHELLS = [['gps', 20200, 24, 150, '#7FB8F0'], ['geo', 35786, 30, 300, '#E8D08A']];
  function camera(pw) {
    const T = MT.MILESTONES, PH = MT.PHASES, fp = sim.fp, orbit = sim.mode === 'orbit', lvl = orbit ? 1 : smooth(T.orbit - 90, T.orbit - 5, fp);
    let rot = Math.atan2(pw.y, pw.x) - Math.PI / 2;
    // nearing the Moon the view turns until the rocket flies level over it, as it arrives; in Moon orbit the view stays as it was then
    const level = Math.PI / 2 - (orbit ? Math.atan2(Math.sin(sim.th0), -Math.cos(sim.th0)) : pw.ang);
    if (lvl > 0) { let dr = level - rot; dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI; rot += dr * lvl; }
    const rc = Math.cos(rot), rs = Math.sin(rot);
    const turn = (x, y) => ({ x: rc * x + rs * y, y: -rs * x + rc * y });                    // world to the turned view
    const pt = turn(pw.x, pw.y), p = { x: pt.x, y: pt.y, alt: pw.alt, ang: pw.ang + rot }, Mt = turn(MOON.x, MOON.y);
    const usable = Math.max(40 * RES, H - topInset), r0 = topInset + usable / 2;
    // Earth framing: the ground takes less and less of the picture as the rocket climbs (30% at the pad, 16% at 30 s, 7% at a minute),
    // then the horizon curves away and thins to a sliver, and only near the edge of space does the whole planet come into view, small and distant
    const alt = p.alt, top = 0.9 * alt + 1.6 * RH, lalt = Math.log10(Math.max(alt, RH) / RH), share = lerp(0.30, 0.04, smooth(0, 2.2, lalt));
    const d = lerp(share / (1 - share) * (alt + top), 2.35, smooth(2.5, 4.2, alt)), yBot = Math.min(1 - d, p.y - 0.3 * alt), yTop = p.y + top;
    const wE = smooth(0.25, 2.0, alt), padX = 0.3 * alt + RH;
    const xMin = Math.min(p.x - padX, -1.08 * wE), xMax = Math.max(p.x + padX, 1.08 * wE);
    let s = Math.min(0.32 * H / RH, usable / (yTop - yBot), W * 0.9 / (xMax - xMin));
    let rx = W / 2 + (p.x - (xMin + xMax) / 2) * s, ry = H - (p.y - yBot) * s;      // where the rocket's tail sits on screen
    /* fit the rocket and the bodies given ([x, y, radius]) into the scene, clear of the flight plan down the right, with room on screen
       for the rocket's body and for the flame trailing behind it */
    const fw = W - 40 / ps, bx = -Math.sin(p.ang), by = -Math.cos(p.ang);
    function frame(bodies) {
      const fit = (a0, a1, b0, b1) => Math.min(usable / (b1 - b0), fw * 0.94 / (a1 - a0));
      let x0 = p.x, x1 = p.x, y0 = p.y, y1 = p.y;
      for (const b of bodies) { x0 = Math.min(x0, b[0] - b[2]); x1 = Math.max(x1, b[0] + b[2]); y0 = Math.min(y0, b[1] - b[2]); y1 = Math.max(y1, b[1] + b[2]); }
      const s0 = fit(x0, x1, y0, y1), back = 36 * RES / s0, ahead = (32 * 1.4 + 8) * RES / s0, side = 14 * RES / s0;   // p is the full rocket's tail: the nose stays put as stages drop
      x0 = Math.min(x0, p.x + bx * back - side, p.x - bx * ahead - side); x1 = Math.max(x1, p.x + bx * back + side, p.x - bx * ahead + side);
      y0 = Math.min(y0, p.y + by * back - side, p.y - by * ahead - side); y1 = Math.max(y1, p.y + by * back + side, p.y - by * ahead + side);
      const sF = fit(x0, x1, y0, y1);
      return [sF, fw / 2 + (p.x - (x0 + x1) / 2) * sF, r0 - (p.y - (y0 + y1) / 2) * sF];
    }
    const blend = (f, w) => { s = Math.exp(lerp(Math.log(s), Math.log(f[0]), w)); rx = lerp(rx, f[1], w); ry = lerp(ry, f[2], w); };
    // the rocket's size, against the icon it was: past true size it keeps shrinking as it climbs, quickly at first, to half by the edge of space
    const kE = KS + (1 - KS) * Math.exp(-lalt / 1.6);
    // the ISS passing overhead: the view widens to take in its height above the rocket, and the stretch of sky it crosses
    const wI = orbit ? 0 : smooth(ISS.at - 75, ISS.at - 55, fp) * (1 - smooth(ISS.at + 55, ISS.at + 75, fp));
    if (wI > 0) { const h = 1 + ISS.km * KMW - Math.hypot(pw.x, pw.y); blend(frame([[p.x, p.y + h, 0.6 * h]]), wI); }
    // orbit framing: Earth and the rocket going round it
    const wO = orbit ? 0 : smooth(PH.coast + 40, PH.coast + 60, fp);
    if (wO > 0) blend(frame([[0, 0, 1.3]]), wO);
    // then Earth falls away: the view brings the rocket to just below the middle, so the planet slips out of the bottom before the view closes in on it
    const wL = orbit ? 0 : smooth(PH.coast + 70, PH.coast + 110, fp);
    if (wL > 0) blend([s, fw / 2, r0 + usable * 0.12], wL);
    // Moon framing
    // deep space: once Earth has fallen away there is only the rocket, close up, rushing on (streaks in draw)
    const wC = orbit ? 0 : smooth(PH.coast + 120, PH.coast + 160, fp);
    if (wC > 0) blend([usable / 5, fw * 0.46, r0 + usable * 0.04], wC);                // zoomed in: the capsule (centred on p, see cut) fills the middle
    const wW = orbit ? 0 : mapW(fp);                                                   // the view of the whole way
    if (wW > 0) blend(frame([[0, 0, 5], [Mt.x, Mt.y, 2.5]]), wW);                  // room round Earth and the Moon for their pictures
    const wM = orbit ? 1 : smooth(T.orbit - 300, T.orbit - 220, fp);              // then the Moon comes into view
    // on the way in, the margins tighten and the rocket is drawn larger, so it does not shrink to a speck beside the Moon
    const appr = orbit ? 1 : smooth(T.orbit - 220, T.orbit - 20, fp);
    if (wM > 0) { const f = frame([[Mt.x, Mt.y, RO * lerp(1.3, 1.22, appr)]]);
      // in Moon orbit the Moon stays still in the middle, with room round it for the rocket going round
      const still = orbit ? 1 : smooth(T.orbit - 25, T.orbit, fp), sO = (Math.min(usable, fw * 0.94) / 2 - 20 * RES) / RO;
      if (still > 0) { f[0] = Math.exp(lerp(Math.log(f[0]), Math.log(sO), still)); f[1] = lerp(f[1], fw / 2 + (p.x - Mt.x) * sO, still); f[2] = lerp(f[2], r0 - (p.y - Mt.y) * sO, still); }
      blend(f, wM); }
    const ox = (rx - W / 2) / s, oy = -(ry - H / 2) / s;                                      // the rocket's offset from the middle of the screen, turned
    return { s: s, rot: rot, rc: rc, rs: rs, cx: pw.x - (rc * ox - rs * oy), cy: pw.y - (rs * ox + rc * oy), wM: wM, wW: wW, wI: wI, wC: wC * (1 - wM) * (1 - wW), k: lerp(lerp(lerp(lerp(kE, KS, wO), 3.2, wC), KS, wW), lerp(0.9, 1.15, appr) + 0.3 * sim.spinUp, wM) };          // a little larger still once it is spinning in orbit
  }

  function background(cam) {
    const inv = 1 / cam.s, rc = cam.rc, rs = cam.rs, m2r = MOON.r * MOON.r, iv = inv * RES, near = iv < B, fade = iv > B * 0.45;   // iv: world size of a pixel as it was
    const MN = Math.max(12 * RES, Math.min(160 * RES, 2 * Math.round(MOON.r * cam.s))), mscale = MN / (2 * MOON.r);
    const moonOn = Math.hypot(cam.cx - MOON.x, cam.cy - MOON.y) < Math.hypot(W, H) / 2 * inv + MOON.r, MTX = moonOn ? moonTex(MN) : null;
    const tf = Math.round(256 * Math.min(1, Math.max(0, (iv - B * 0.45) / (B * 0.55)))), en2 = EN / 2;
    /* ground texture between the close-up blocks and the far-away map: blocks that regroup as the view widens, so the climb reads as motion */
    const lv = Math.log2(iv / B), lf = lv - Math.floor(lv), S0 = B * Math.pow(2, Math.floor(lv) + 3), S1 = S0 * 2, amp = lv > -1 ? Math.round(9 * (1 - smooth(0.05, 0.5, 1.5 * inv * H))) : 0;
    const n = W * H, so = ((Math.round(-cam.cy * STAR_PAR + driftY) * W + Math.round(cam.cx * STAR_PAR + driftX)) % n + n) % n;
    const keep = Math.round((1 - cam.wC) * 256), star = j => { const sc = stars[(j + so) % n]; return sc === SPACE || ((j * 2654435761) >>> 24) < keep ? sc : SPACE; };
    let i = 0;
    for (let py = 0; py < H; py++) {
      const vy = -(py + 0.5 - H / 2) * inv, vx = (0.5 - W / 2) * inv, dx = rc * inv, dy = rs * inv;
      let x = cam.cx + rc * vx - rs * vy, y = cam.cy + rs * vx + rc * vy;
      for (let qx = 0; qx < W; qx++, i++, x += dx, y += dy) {
        const r2 = x * x + y * y; let c;
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
              if (t > STAR_FROM) { const sc = star(i); if (sc !== SPACE) c = sc; } }
            else c = star(i); }
        }
        px[i] = c;
      }
    }
    g.putImageData(img, 0, 0);
  }

  function addPart(x, y, vx, vy, life, sz, shade) { if (parts.length > 160) parts.shift(); parts.push({ x: x, y: y, vx: vx, vy: vy, t: 0, life: life, sz: sz, c: shade }); }

  function event(name) {
    if (name === 'stage1' || name === 'stage2') debris.push({ i: name === 'stage1' ? 1 : 2, t: 0, a: 0, va: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random()) });
    if (name === 'crash') {                       // blocky fireball, flying wreckage, then smoke
      flash = 1; shake = 0.7;
      const cols = ['#FFF3B0', '#FFD23F', '#FFB629', '#E2502C', '#A82C22', '#E8ECF2', '#8A93A3', '#3A3F4B'];
      for (let i = 0; i < 90; i++) { const a = Math.random() * Math.PI, sp = (0.4 + Math.random() * 2.6) * RH, fire = i < 60;
        blast.push({ x: (Math.random() - 0.5) * RH * 0.3, y: 1 + Math.random() * RH * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 1.2, t: 0, life: 0.7 + Math.random() * 1.3,
          sz: fire ? 2 + Math.random() * 3 : 2 + Math.random() * 2, c: fire ? cols[(Math.random() * 5) | 0] : cols[5 + ((Math.random() * 3) | 0)], g: fire ? 0.6 : 2.2 }); }
      for (let i = 0; i < 40; i++) addPart((Math.random() - 0.5) * RH * 0.5, 1 + Math.random() * RH * 0.3, (Math.random() - 0.5) * RH * 1.2, (0.2 + Math.random() * 0.9) * RH, 1.4 + Math.random() * 1.6, 4 * RES, 40 + Math.random() * 70);
    }
  }
  function reset() { parts.length = 0; debris.length = 0; blast.length = 0; embers.length = 0; flash = 0; shake = 0; rcs.on = false; rcs.t = 0; rcs.wait = 1.5; }

  /* v: {running, playing, power}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    const p = sim.pose(), cam = camera(p), s = cam.s, hx = Math.sin(p.ang + cam.rot), hy = -Math.cos(p.ang + cam.rot);   // heading on screen
    rush += ((cam.wC > 0 && sim.mode === 'ascent' ? Math.max(0, Math.min(1.4, sim.v / vRef)) : 0) - rush) * Math.min(1, dt * 2);   // eases with the rocket's speed
    if (rush > 0.01) { const sp = 70 * RES * rush * cam.wC * dt; driftX += hx * sp; driftY += hy * sp; }
    const rc = cam.rc, rs = cam.rs;
    const P = (x, y) => { const dx = x - cam.cx, dy = y - cam.cy; return [W / 2 + (rc * dx + rs * dy) * s, H / 2 - (rc * dy - rs * dx) * s]; };   // world to screen
    const toW = (sx, sy) => { const vx = (sx - W / 2) / s, vy = -(sy - H / 2) / s; return [cam.cx + rc * vx - rs * vy, cam.cy + rs * vx + rc * vy]; };
    const velW = (vx, vy) => [(rc * vx + rs * vy) / s, (rs * vx - rc * vy) / s];             // a speed in screen pixels (y down) as a world one
    const ang = p.ang + cam.rot;                                                            // the rocket's heading on screen
    background(cam);
    g.imageSmoothingEnabled = false;

    // clouds
    g.fillStyle = '#F4F8FF';
    for (const c of CLOUDS) { const w = c[2] * s; if (w < 4 * RES || w > W * 3) continue; const h = Math.max(2 * RES, c[3] * s);
      const cp = P(c[0], 1 + c[1]), x = Math.round(cp[0] - w / 2), y = Math.round(cp[1]);
      if (y < -h * 2 || y > H + h || x > W || x + w < 0) continue;
      g.globalAlpha = 0.9 * smooth(4 * RES, 9 * RES, w);
      g.fillRect(x, y, Math.round(w), Math.round(h)); g.fillRect(x + Math.round(w * 0.18), y - Math.round(h * 0.6), Math.round(w * 0.5), Math.round(h * 0.6)); g.fillRect(x + Math.round(w * 0.1), y + Math.round(h), Math.round(w * 0.7), Math.max(1, Math.round(h * 0.4))); }
    g.globalAlpha = 1;

    // deep space: the drifting starfield, then streaks rushing past from ahead of the rocket to behind it, tails pointing where it is going
    if (cam.wC > 0) deepSky(cam, hx, hy, dt);
    const streaking = rush > 0.01 && cam.wC > 0, a0 = 0.7 * cam.wC * Math.min(1, rush);
    if (streaking) streaks(false, hx, hy, a0, dt);

    // after an explosion everything drawn over the scenery shakes for a moment
    if (shake > 0) { shake -= dt; g.save(); g.translate(Math.round((Math.random() - 0.5) * 5 * RES * shake), Math.round((Math.random() - 0.5) * 5 * RES * shake)); } else g.save();

    // true size near the pad, then an icon that shrinks as the rocket climbs: close up in deep space and larger on the approach to the Moon; pk: the size of a sprite pixel
    const hp = s * RH, k = Math.max(cam.k * RES, Math.min(2.5 * RES, hp / 32)), pk = k / RES;
    const sp0 = P(p.x, p.y), mp = P(MOON.x, MOON.y), md = Math.hypot(sp0[0] - mp[0], sp0[1] - mp[1]), wreck = sim.mode === 'pad' && sim.down > 0;
    // in Moon orbit, 110 km up, the rocket's icon would sink into the Moon: it rides on top of the orbit, just clear of the ground
    const up = 6.5 * k * smooth(3 * RO * s, 1.3 * RO * s, md), sx = md > 0 ? sp0[0] + (sp0[0] - mp[0]) * up / md : sp0[0], sy = md > 0 ? sp0[1] + (sp0[1] - mp[1]) * up / md : sp0[1];

    // the orbit around the Moon, as a dotted ring, at the height the rocket rides
    if (cam.wM > 0.3) { g.fillStyle = '#A3ACC2'; g.globalAlpha = 0.5 * smooth(0.3, 1, cam.wM); const rr = RO * s + up;
      for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24; g.fillRect(Math.round(mp[0] + rr * Math.cos(a)), Math.round(mp[1] + rr * Math.sin(a)), RES, RES); }
      g.globalAlpha = 1; }

    // the view of the whole way: the path flown in gold and still to fly in grey, Earth and the Moon as small pictures
    if (cam.wW > 0.02) { let lx = -1e9, ly = -1e9;
      for (let i = 0; i < sim.px.length; i += 12) { const q = P(sim.px[i], sim.py[i]), done = sim.pl[i] <= sim.l; if (Math.hypot(q[0] - lx, q[1] - ly) < 5 * RES) continue; lx = q[0]; ly = q[1];
        g.globalAlpha = cam.wW * (done ? 0.9 : 0.7); g.fillStyle = done ? '#FFD23F' : '#A3ACC2'; g.fillRect(Math.round(q[0] - RES / 2), Math.round(q[1] - RES / 2), RES, RES); }
      const e0 = P(0, 0), rE = Math.max(s, 7 * RES), m0 = P(MOON.x, MOON.y), rM = Math.max(MOON.r * s, 4.5 * RES);
      g.globalAlpha = cam.wW; g.drawImage(EARTH_DISC, Math.round(e0[0] - rE), Math.round(e0[1] - rE), Math.round(2 * rE), Math.round(2 * rE));
      g.drawImage(MOON_DISC, Math.round(m0[0] - rM), Math.round(m0[1] - rM), Math.round(2 * rM), Math.round(2 * rM)); g.globalAlpha = 1; }

    // launch pad and tower, at true scale
    const kp = hp / 32;
    if (kp > 0.3 * RES) { const gp = P(0, 1), gx = gp[0], gy = gp[1], u = v2 => Math.max(1, Math.round(v2 * kp));
      g.globalAlpha = smooth(0.3 * RES, 0.6 * RES, kp);
      g.fillStyle = '#5E6470'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy), u(22), u(2));
      g.fillStyle = '#8A93A3'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy), u(22), u(1));
      for (let j = 0; j < 10; j++) { g.fillStyle = j % 2 ? '#E8ECF2' : '#D23B2E'; g.fillRect(Math.round(gx - 11 * kp), Math.round(gy - (j + 1) * 3 * kp), u(3), u(3)); }
      g.fillStyle = '#5E6470'; g.fillRect(Math.round(gx - 8 * kp), Math.round(gy - 25 * kp), u(3), u(1));
      if (wreck) { g.fillStyle = '#23262E'; g.fillRect(Math.round(gx - 7 * kp), Math.round(gy - kp), u(15), u(2)); g.fillRect(Math.round(gx - 4 * kp), Math.round(gy - 2 * kp), u(6), u(1)); }
      g.globalAlpha = 1; }

    // engine state: the flame follows engine power, and gutters whenever efficiency is dropping
    flickT -= dt; if (flickT <= 0) { flickT = 0.07; flick = Math.random(); }
    // Where the tail end sits along the rocket's axis. While stages remain the nose stays put when one drops;
    // close up in deep space and beside the Moon the capsule is centred on its true position (so it rides on the orbit line).
    const stage = sim.stage, cut = lerp(CUT[stage] * k, -SPR[stage].height * pk / 2, Math.min(1, cam.wM + cam.wC)), lit = sim.ignited && v.running && !wreck, sput = lit && !v.playing;
    const tilt = sim.mode === 'fall' ? Math.sin(performance.now() / 260) * 0.5 : sput ? (flick - 0.5) * 0.07 : 0;
    const sn = Math.sin(ang), cs = Math.cos(ang);
    const tailX = sx + sn * cut, tailY = sy - cs * cut;              // screen position of the current tail end
    const tw = toW(tailX, tailY), tailWX = tw[0], tailWY = tw[1];

    // smoke: white while the engine pulls, dark and heavy while it loses power or the rocket falls
    if (dt > 0 && (lit || sim.mode === 'fall')) {
      if (sim.mode === 'pad') for (let i = 0; i < 2; i++) { const side = Math.random() < 0.5 ? -1 : 1;
        addPart(side * RH * 0.03, 1 + RH * 0.02, side * RH * (0.5 + Math.random() * 1.2) * (0.4 + v.power), RH * Math.random() * 0.25, 0.7 + Math.random() * 0.8, 2.2 * k, sput ? 70 : 200 + Math.random() * 50); }
      else if (sim.mode === 'fall') addPart(tailWX + (Math.random() - 0.5) * 4 * RES / s, tailWY + (Math.random() - 0.5) * 4 * RES / s, (Math.random() - 0.5) * 8 * RES / s, 6 * RES / s, 1.1 + Math.random() * 0.8, 2 * k, 50 + Math.random() * 40);
      else if (p.alt < 0.03 || sput) addPart(tailWX + (Math.random() - 0.5) * 3 * RES / s, tailWY + (Math.random() - 0.5) * 3 * RES / s, (Math.random() - 0.5) * 6 * RES / s, (Math.random() - 0.5) * 6 * RES / s, 0.9 + Math.random() * 0.6, (sput ? 2.2 : 1.6) * k, sput ? 60 + Math.random() * 30 : 190 + Math.random() * 60);
    }
    if (dt > 0 && sim.spinUp > 0 && sim.spinUp < 1 && v.running) { const side = Math.random() < 0.5 ? -1 : 1, d = 6 * k;      // small thruster puffs set the spin going
      const at = toW(sx + cs * side * d, sy + sn * side * d), sv = velW(cs * side * 14 * RES, sn * side * 14 * RES);
      addPart(at[0], at[1], sv[0], sv[1], 0.35 + Math.random() * 0.3, 1.2 * k, 225); }
    // E6, for show only: now and then a reaction-control thruster fires a short burst. Nothing about the orbit or the spin changes.
    // In the coast's course correction they fire in quick bursts for a few seconds.
    const correcting = sim.mode === 'ascent' && sim.fp >= CT.correction && sim.fp < CT.correction + 4;
    if (correcting) rcs.wait = Math.min(rcs.wait, 0.3);
    if ((sim.mode === 'orbit' && sim.spinUp >= 1 || correcting) && v.running && dt > 0) {
      if (rcs.t > 0) { rcs.t -= dt; rcs.on = true;
        rcs.x = sx + sn * rcs.a * k + cs * rcs.side * 5 * k; rcs.y = sy - cs * rcs.a * k + sn * rcs.side * 5 * k;                     // the nozzle, on screen
        rcs.jx = rcs.along ? sn * rcs.along : cs * rcs.side; rcs.jy = rcs.along ? -cs * rcs.along : sn * rcs.side;                       // which way the jet points
        for (let i = 0; i < 2; i++) { const sp = (26 + Math.random() * 22) * RES;
          const at = toW(rcs.x, rcs.y), jv = velW(rcs.jx * sp + (Math.random() - 0.5) * 9 * RES, rcs.jy * sp + (Math.random() - 0.5) * 9 * RES);
          addPart(at[0], at[1], jv[0], jv[1], 0.22 + Math.random() * 0.26, 1.1 * k, 236); } }
      else { rcs.on = false; rcs.wait -= dt;
        if (rcs.wait <= 0) { rcs.t = 0.2 + Math.random() * 0.3; rcs.wait = correcting ? 0.1 + Math.random() * 0.2 : Math.random() < 0.3 ? 0.35 : 3 + Math.random() * 5;   // sometimes a quick second pulse
          rcs.side = Math.random() < 0.5 ? -1 : 1; rcs.a = (Math.random() < 0.5 ? -1 : 1) * 3; rcs.along = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0; } }
    } else { rcs.on = false; rcs.t = 0; }
    for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.t += dt; if (q.t >= q.life) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      const u = q.t / q.life, z = Math.max(1, Math.round(q.sz * (0.6 + u))), c = q.c | 0;
      g.globalAlpha = 0.85 * (1 - u); g.fillStyle = 'rgb(' + c + ',' + c + ',' + (c + 6) + ')';
      const qp = P(q.x, q.y); g.fillRect(Math.round(qp[0] - z / 2), Math.round(qp[1] - z / 2), z, z); }
    g.globalAlpha = 1;

    // dropped stages drift away behind the rocket. Stage 1 falls back into the air: it starts to glow, sheds sparks and flames behind it,
    // then breaks up and burns away, always before it reaches the ground
    const pr = Math.hypot(p.x, p.y), groundY = P(p.x / pr, p.y / pr)[1];
    for (let i = debris.length - 1; i >= 0; i--) { const d = debris[i], burn = d.i === 1;
      if (d.t === 0) { const v = burn ? 6 : 9; d.x = tailX; d.y = tailY; d.vx = (-sn * v + (Math.random() - 0.5) * 4) * RES; d.vy = cs * v * RES; d.a = ang; d.k = k; }
      d.t += dt; if (d.t > (burn ? 5.2 : 6)) { debris.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.vy += (burn ? 2.2 : 5) * RES * dt; d.a += d.va * dt;
      const kk = d.k * (1 - d.t / 7), im = kk < RES ? DROP_SMALL[d.i] : DROP[d.i], hh = im.height * kk / (im === DROP[d.i] ? RES : 1);
      if (burn && d.t < 3.8 && d.y > groundY - 16 * RES) d.t = 3.8;                                    // too near the ground: it burns away now
      const heat = burn ? smooth(0.9, 2.8, d.t) : 0, gone = burn ? smooth(3.8, 4.9, d.t) : 0;
      g.save(); g.translate(Math.round(d.x), Math.round(d.y)); g.rotate(d.a); g.globalAlpha = burn ? (1 - gone) * (1 - 0.85 * heat) : Math.min(1, (6 - d.t) / 1.5);
      g.drawImage(im, -5.5 * kk, 0, 11 * kk, hh);
      if (heat > 0 && gone < 1) { g.globalAlpha = heat * (1 - gone); g.drawImage(kk < RES ? HOT_SMALL : HOT, -5.5 * kk, 0, 11 * kk, hh); }
      g.restore();
      if (burn && heat > 0.1 && gone < 1 && dt > 0) {
        const cx = d.x - Math.sin(d.a) * hh / 2, cy = d.y + Math.cos(d.a) * hh / 2, mv = Math.hypot(d.vx, d.vy) || 1, ux = d.vx / mv, uy = d.vy / mv;
        for (let n = Math.round(heat * (1 - gone) * 5 * Math.min(2, dt * 60)); n > 0; n--) { const sp = (12 + Math.random() * 22) * RES;   // sparks streaming away behind it
          embers.push({ x: cx + (Math.random() - 0.5) * 9 * kk, y: cy + (Math.random() - 0.5) * 9 * kk, vx: -ux * sp + (Math.random() - 0.5) * 8 * RES, vy: -uy * sp + (Math.random() - 0.5) * 8 * RES,
            t: 0, life: 0.25 + Math.random() * 0.45, sz: Math.max(RES, kk * (0.5 + Math.random() * 0.7)) }); }
        if (gone > 0 && !d.split) { d.split = true;                                                    // it breaks up: glowing pieces fly apart and fade
          for (let n = 0; n < 16; n++) { const a = Math.random() * 2 * Math.PI, sp = (4 + Math.random() * 14) * RES;
            embers.push({ x: cx + (Math.random() - 0.5) * 8 * kk, y: cy + (Math.random() - 0.5) * 14 * kk, vx: d.vx * 0.6 + Math.cos(a) * sp, vy: d.vy * 0.6 + Math.sin(a) * sp, t: 0, life: 0.7 + Math.random() * 0.7, sz: Math.max(RES, kk * (0.9 + Math.random())) }); } }
      } }
    for (let i = embers.length - 1; i >= 0; i--) { const q = embers[i]; q.t += dt; if (q.t >= q.life) { embers.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; const u = q.t / q.life, z = Math.max(1, Math.round(q.sz * (1 - 0.5 * u)));
      g.globalAlpha = 1 - u * u; g.fillStyle = EMBER[Math.min(EMBER.length - 1, Math.floor(u * EMBER.length))]; g.fillRect(Math.round(q.x - z / 2), Math.round(q.y - z / 2), z, z); }
    if (embers.length > 300) embers.splice(0, embers.length - 300);
    g.globalAlpha = 1;

    // the ISS passing overhead, level, at the rocket's scale
    if (cam.wI > 0.01) { const q = issAt(sim.fp), sq = P(q[0], q[1]), z = Math.max(RES, k * 0.9);
      g.globalAlpha = smooth(0.01, 0.2, cam.wI); g.drawImage(ISS_SPR, Math.round(sq[0] - 7.5 * z), Math.round(sq[1] - 3.5 * z), Math.round(15 * z), Math.round(7 * z)); g.globalAlpha = 1; }
    // the satellites' heights as the rocket climbs through them: faint rings round Earth, their satellites specks moving along them
    if (sim.mode === 'ascent') { const e0 = P(0, 0);
      for (const [id, km, n, per, col] of SHELLS) { const a = smooth(CT[id] - 30, CT[id] - 18, sim.fp) * (1 - smooth(CT[id] + 25, CT[id] + 40, sim.fp)) * (1 - cam.wC); if (!(a > 0)) continue;
        const rr = (1 + km * 10 * RH) * s, nd = Math.max(48, Math.min(400, Math.round(2 * Math.PI * rr / (4 * RES))));   // RH is 0.1 km
        g.fillStyle = col; g.globalAlpha = 0.35 * a;
        for (let i = 0; i < nd; i++) { const t = i * 2 * Math.PI / nd, x = e0[0] + rr * Math.cos(t), y = e0[1] + rr * Math.sin(t);
          if (x > -RES && y > -RES && x < W && y < H) g.fillRect(Math.round(x), Math.round(y), RES, RES); }
        g.fillStyle = '#F4F6FA'; g.globalAlpha = 0.9 * a;
        for (let i = 0; i < n; i++) { const t = i * 2 * Math.PI / n + i * 0.37 - sim.fp * 2 * Math.PI / per; g.fillRect(Math.round(e0[0] + rr * Math.cos(t) - RES / 2), Math.round(e0[1] + rr * Math.sin(t) - RES / 2), RES, RES); } }
      g.globalAlpha = 1; }

    // rocket, nose anchored so a separation never makes it jump; gone while the wreck is cleared, then a new one fades in
    const shown = wreck ? Math.max(0, 1 - sim.down / 0.6) : 1;
    // the slow roll in the coast: a turn every 10 s of playing, until the Moon's pull takes over
    const roll = sim.mode === 'ascent' && sim.fp >= CT.roll ? Math.floor((Math.min(sim.fp, CT.pull) - CT.roll) / 10 * ROLL_N) % ROLL_N : 0;
    if (shown > 0) {
      const spr = stage === 2 && sim.spinUp > 0 ? ROLL[Math.floor(sim.spinA / (2 * Math.PI) * ROLL_N) % ROLL_N] : stage === 2 && roll && k >= RES ? ROLL[roll] : (k < RES ? SMALL : SPR)[stage], hh = spr.height * k / (spr === SMALL[stage] ? 1 : RES);   // in Moon orbit the module spins about its length (E6)
      g.save(); g.translate(Math.round(sx), Math.round(sy)); g.rotate(ang + tilt); g.globalAlpha = shown;
      const fine = stage === 2 && sim.spinUp === 0 ? smooth(0.5, 0.95, cam.wC) : 0;               // close up, the detailed module fades in
      if (fine < 1) { g.globalAlpha = shown * (1 - fine); g.drawImage(spr, -5.5 * k, -cut - hh, 11 * k, hh); }
      if (fine > 0) { g.globalAlpha = shown * fine; g.drawImage(DETAILS[roll], -5.5 * k, -cut - 11 * k, 11 * k, 11 * k); }
      g.globalAlpha = shown;
      if (lit) {
        const blk = Math.max(1, Math.round(lerp(pk, k / 3, fine))), fw = FLAME_W[stage] * k, flying = sim.mode !== 'pad';
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

    if (streaking) streaks(true, hx, hy, a0, dt);                                             // the nearest streaks pass in front of the rocket
    if (rcs.on) { const b = Math.max(1, Math.round(pk * 0.8)); g.fillStyle = '#E4F3FF';
      for (let j = 0; j < 3 * RES; j++) g.fillRect(Math.round(rcs.x + rcs.jx * j * b - b / 2), Math.round(rcs.y + rcs.jy * j * b - b / 2), b, b); }

    // explosion: fireball blocks and wreckage thrown out from the pad
    for (let i = blast.length - 1; i >= 0; i--) { const q = blast[i]; q.t += dt; if (q.t >= q.life) { blast.splice(i, 1); continue; }
      q.vy -= q.g * RH * dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.y < 1) { q.y = 1; q.vy *= -0.3; q.vx *= 0.6; }
      const u = q.t / q.life, z = Math.max(1, Math.round(q.sz * Math.max(0.5 * RES, hp / 40) * (1 - 0.5 * u)));
      g.globalAlpha = u > 0.6 ? (1 - u) / 0.4 : 1; g.fillStyle = q.c; const qp = P(q.x, q.y); g.fillRect(Math.round(qp[0] - z / 2), Math.round(qp[1] - z / 2), z, z); }
    g.globalAlpha = 1;

    g.globalAlpha = 1;
    g.restore();
    if (flash > 0) { g.globalAlpha = Math.min(1, flash) * 0.85; g.fillStyle = '#FFF6D0'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; flash -= dt * 2.6; }
  }

  return { resize: resize, draw: draw, event: event, reset: reset, rcs: rcs };
}

module.exports = { makeRocketView };
