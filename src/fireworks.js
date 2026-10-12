/* Fireworks theme renderer: drawn in 3D (src/fireworks3d.js) once three.js has loaded, as City loads it, and by the flat drawing here until
   then or without it. What goes up, and when, comes from FireworkSim in the core. Nothing here makes a sound: the microphone is listening. */
/* exported makeFireworkView */   // used by src/app.js, which the build puts after this file
function makeFireworkView(host, hud, sim, MT) {
  'use strict';
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const cv2 = host.querySelector('#fireCv'), cv3 = host.querySelector('#fire3d'), flat = makeFirework2D(cv2, hud, sim, MT);
  let deep = null, loading = null, failedAt = 0;
  function loadThree() {
    return new Promise((res, rej) => {
      if (window.THREE) return res();
      const s = [...document.scripts].find(x => x.src === THREE_URL) || document.head.appendChild(Object.assign(document.createElement('script'), { src: THREE_URL, async: true }));   // City may be loading it already
      s.addEventListener('load', () => res()); s.addEventListener('error', () => { s.remove(); rej(new Error('three.js did not load')); });
    });
  }
  /* called when the theme is shown: load three.js and move to 3D; after a failure, try again at most every 10 s */
  function ensure() {
    if (deep || loading || Date.now() - failedAt < 10e3) return;
    loading = loadThree().then(() => { deep = makeFirework3D(cv3, hud, MT); cv3.hidden = false; cv2.hidden = true; deep.resize(); })
      .catch(() => { deep = null; failedAt = Date.now(); cv3.hidden = true; cv2.hidden = false; })
      .then(() => { loading = null; });
  }
  const now = () => deep || flat;
  return { ensure: ensure, resize: () => { flat.resize(); if (deep) deep.resize(); }, draw: (v, dt) => now().draw(v, dt), event: e => now().event(e),
    reset: () => { flat.reset(); if (deep) deep.reset(); }, busy: () => now().busy(), get is3d() { return !!deep; } };
}

/* the flat drawing, on a 2D canvas: the stand-in for the 3D one */
function makeFirework2D(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d'), RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, TAU = Math.PI * 2;
  const MAX = RM ? 700 : 2600;   // sparks in the air at once; a fast run on a phone stays smooth
  let W = 0, H = 0, dpr = 1, top = 0, GY = 0, SKY = 0, clock = 0, idleT = 1.5, flash = 0, skyline = null, stars = [];
  const rockets = [], sparks = [], glows = [], smoke = [], cols = new Map();
  const col = (h, s, l) => { const k = h * 1e4 + s * 100 + l; let c = cols.get(k); if (!c) { c = 'hsl(' + h + ',' + s + '%,' + l + '%)'; cols.set(k, c); } return c; };

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    GY = Math.round(H - Math.max(26, Math.min(72, (H - top) * 0.2)));   // the waterline
    SKY = Math.max(40, GY - top);
    buildScene();
    return true;
  }
  /* the stars and the skyline are the same every time (a fixed seed), drawn once per size */
  /* the stars and the waterfront are the same every time (a fixed seed), drawn once per size: moonlit ridges, a harbour town of pastel houses
     climbing the hill, the bell tower, the lighthouse on the left and the Ferris wheel on the right, as in the 3D scene */
  function buildScene() {
    const r = MT.raceRng(1234); stars = [];
    for (let i = 0; i < 90; i++) stars.push({ x: r() * W, y: r() * GY * 0.92, s: r() < 0.15 ? 1.6 : 1, p: r() * TAU, f: 0.6 + r() * 1.8 });
    MOONX = W * 0.58; MOONY = GY - Math.max(40, Math.min(150, SKY * 0.3)); MOONR = Math.max(7, Math.min(16, W * 0.025));
    skyline = document.createElement('canvas'); skyline.width = Math.round(W * dpr); const tall = Math.max(30, Math.min(120, SKY * 0.32)); skyline.height = Math.round((tall + 4) * dpr);
    const s = skyline.getContext('2d'); s.setTransform(dpr, 0, 0, dpr, 0, 0); const base = tall + 4;
    const ridge = (h, top, bot, k) => { const gr = s.createLinearGradient(0, base - h, 0, base); gr.addColorStop(0, top); gr.addColorStop(1, bot); s.fillStyle = gr; s.beginPath(); s.moveTo(0, base);
      for (let x = 0; x <= W + 20; x += 12) s.lineTo(x, base - h * (0.55 + 0.25 * Math.sin(x / 90 + k) + 0.12 * Math.sin(x / 31 + k * 2))); s.lineTo(W, base); s.closePath(); s.fill(); };
    ridge(tall * 0.95, '#3E5276', '#1E2A44', 1); ridge(tall * 0.7, '#2A3A58', '#141D30', 2);
    const hillTop = x => base - tall * (0.32 + 0.12 * Math.sin(x / 60) + 0.06 * Math.sin(x / 17));   // the hill the town climbs
    s.fillStyle = '#14212A'; s.beginPath(); s.moveTo(0, base); for (let x = 0; x <= W + 8; x += 8) s.lineTo(x, hillTop(x)); s.lineTo(W, base); s.closePath(); s.fill();
    const HOUSE = ['#6E4A3E', '#7A6440', '#7A5450', '#7C7464', '#3E5A58', '#46506C', '#6A5844', '#643838'], unit = Math.max(5, Math.min(9, tall * 0.09));
    for (let row = 0; row < 4; row++) for (let x = -4; x < W;) {   // rows of houses, the back ones higher up the hill and further apart
      const w = unit * (0.9 + r() * 0.7), h = unit * (0.9 + r() * 0.8) * (row === 3 ? 1.25 : 1), yb = base - (3 - row) * (base - hillTop(x)) * 0.28 - 1;
      if (r() < 0.25 + (3 - row) * 0.12 || (x > W * 0.22 && x < W * 0.29 && row > 1) || (x > W * 0.66 && x < W * 0.86 && row > 1)) { x += w + 2; continue; }
      s.fillStyle = HOUSE[Math.floor(r() * HOUSE.length)]; s.fillRect(x, yb - h, w, h);
      s.fillStyle = r() < 0.5 ? '#4A2A24' : '#2C303C'; s.beginPath(); s.moveTo(x - 1, yb - h); s.lineTo(x + w / 2, yb - h - w * 0.4); s.lineTo(x + w + 1, yb - h); s.closePath(); s.fill();   // a pitched roof
      for (let j = 0; j < 2; j++) if (r() < 0.55) { s.fillStyle = r() < 0.7 ? 'rgba(255,184,104,.85)' : 'rgba(255,226,168,.8)'; s.fillRect(x + w * (0.2 + j * 0.42), yb - h * 0.7, Math.max(1, w * 0.18), Math.max(1.2, h * 0.25)); }
      x += w + (r() < 0.3 ? 1 + r() * 3 : 0.5);
    }
    const bx = W * 0.45, bh = tall * 0.62, bw = Math.max(4, unit * 0.8);   // the bell tower and its spire
    s.fillStyle = '#8A8070'; s.fillRect(bx, base - bh, bw, bh - 1); s.fillStyle = '#3A3E4A'; s.beginPath(); s.moveTo(bx - 1, base - bh); s.lineTo(bx + bw / 2, base - bh - bw * 2.2); s.lineTo(bx + bw + 1, base - bh); s.closePath(); s.fill();
    s.fillStyle = 'rgba(255,214,150,.9)'; s.fillRect(bx + bw * 0.3, base - bh * 0.85, bw * 0.4, bw * 0.5);
    const lx = W * 0.22, lh = tall * 0.42, lw = Math.max(3, unit * 0.55);   // the lighthouse, striped
    for (let j = 0; j < 4; j++) { s.fillStyle = j % 2 ? '#A8463C' : '#D8D2C6'; s.fillRect(lx, base - lh + j * lh / 4, lw, lh / 4 + 0.5); }
    s.fillStyle = '#FFE7A8'; s.fillRect(lx - 0.5, base - lh - lw * 0.8, lw + 1, lw * 0.8); s.fillStyle = '#A8463C'; s.beginPath(); s.moveTo(lx - 1, base - lh - lw * 0.8); s.lineTo(lx + lw / 2, base - lh - lw * 1.6); s.lineTo(lx + lw + 1, base - lh - lw * 0.8); s.closePath(); s.fill();
    LIGHT = { x: lx + lw / 2, y: GY - (base - lh - lw * 0.4) };   // where the beam comes from, on the main canvas
    s.fillStyle = '#2C2F38'; s.fillRect(0, base - 2, W, 3);   // the quay
    WHEEL = { x: W * 0.76, y: GY - tall * 0.55, r: tall * 0.42 };   // the Ferris wheel is drawn live, so it can turn
    s.strokeStyle = '#4A5268'; s.lineWidth = 1.5; s.beginPath(); s.moveTo(WHEEL.x - WHEEL.r * 0.55, base); s.lineTo(WHEEL.x, base - tall * 0.55); s.lineTo(WHEEL.x + WHEEL.r * 0.55, base); s.stroke();
  }
  let MOONX = 0, MOONY = 0, MOONR = 8, LIGHT = { x: 0, y: 0 }, WHEEL = { x: 0, y: 0, r: 10 };
  function reset() { rockets.length = 0; sparks.length = 0; glows.length = 0; smoke.length = 0; flash = 0; idleT = 1.5; }

  /* a shell from the core: {x, h, size, hue, hue2, kind, finale} */
  function launch(e) {
    if (!W && !resize()) return;
    const trophy = e.kind === 'trophy', R = trophy ? Math.min(0.4 * SKY, 0.55 * W) : (0.12 + 0.2 * e.size) * Math.min(W, SKY * 1.5), ty = trophy ? top + SKY * 0.46 : Math.max(top + R * 0.6, GY - e.h * SKY);
    rockets.push({ x: e.x * W, x0: e.x * W, y: GY, y0: GY, ty: ty, t: 0, dur: 0.75 + 0.55 * e.h + Math.random() * 0.15, drift: trophy ? 0 : (Math.random() - 0.5) * W * 0.05, e: e, R: R });
  }
  function event(e) {
    if (e.k === 'shell') launch(e);
    else if (e.k === 'finale') flash = RM ? 0 : 0.35;
  }
  function spark(p) { if (sparks.length < MAX) sparks.push(p); }
  /* the burst: how the sparks fly out. k is drag (they slow), gr gravity (they fall), n the trail drawn behind each */
  function burst(r) {
    const e = r.e, x = r.x, y = r.y, R = r.R, n = (RM ? 0.5 : 1) * (0.6 + 0.5 * Math.min(1.2, e.size)), two = e.hue2 >= 0;
    const hueOf = i => two && i % 2 ? e.hue2 : e.hue;
    const sphere = (N, k, gr, life, s, trail, l, extra) => {   // sparks spread over a ball, seen from the side
      for (let i = 0; i < N; i++) { const a = Math.random() * TAU, u = Math.random(), sp = R * k * Math.sqrt(1 - u * u) * (0.92 + Math.random() * 0.12);
        spark(Object.assign({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k: k, gr: gr, t: 0, life: life * (0.85 + Math.random() * 0.3), s: s, n: trail, h: hueOf(i), sat: 100, l: l }, extra)); } };
    if (e.kind === 'trophy') {   // the finale's last shell opens into a gold trophy, holds it, then lets it fall
      const k = 2.4, at = (px, py, q) => sparks.push(Object.assign({ x: x, y: y, vx: px * R * k, vy: -py * R * k, k: k, gr: R * 0.35, hold: 1.8, t: 0, life: 3.6, s: 3, n: 1, h: 44, sat: 95, l: 60, glit: true }, q));
      for (const q of MT.fwTrophyShape(0.05)) at(q[0], q[1]);
      for (let i = 0; i <= 8; i++) at(-0.3 + 0.06 * Math.sin(i / 8 * 1.6), 0.66 - i * 0.05, { h: 48, sat: 100, l: 80, s: 2 });   // the shine down the cup, as on the trophy card
    } else if (e.kind === 'peony') sphere(Math.round(90 * n), 1.7, R * 0.3, 1.3, 2.2, 1, 60);
    else if (e.kind === 'chrysanthemum') sphere(Math.round(100 * n), 1.5, R * 0.35, 1.7, 1.8, 4, 60, { glit: true });
    else if (e.kind === 'ring') {
      const N = Math.round(64 * n), tilt = Math.random() * Math.PI, sq = 0.3 + Math.random() * 0.5, c = Math.cos(tilt), s = Math.sin(tilt);
      for (let i = 0; i < N; i++) { const a = i / N * TAU, ux = Math.cos(a) * R * 1.3, uy = Math.sin(a) * R * 1.3 * sq;
        spark({ x: x, y: y, vx: ux * c - uy * s, vy: ux * s + uy * c, k: 1.6, gr: R * 0.25, t: 0, life: 1.4, s: 2.2, n: 2, h: hueOf(i), sat: 100, l: 60 }); }
      sphere(Math.round(14 * n), 0.9, R * 0.3, 1.0, 1.8, 1, 80);   // a bright heart in the middle
    } else if (e.kind === 'willow') {
      sphere(Math.round(16 * n), 1.4, R * 0.3, 0.9, 2, 1, 62);   // a heart in the note's colour, then long gold trails that droop
      sphere(Math.round(90 * n), 2.2, R * 0.55, 3, 1.6, 6, 54, { h: 40, sat: 90, glit: true, droop: true });
    } else if (e.kind === 'palm') {
      const N = 7 + Math.floor(Math.random() * 3);
      for (let i = 0; i < N; i++) { const a = i / N * TAU + Math.random() * 0.3, sp = R * 1.6;
        spark({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - R * 0.3, k: 1.3, gr: R * 0.7, t: 0, life: 1.9, s: 3.2, n: 7, h: hueOf(i), sat: 95, l: 60, glit: true }); }
      sphere(Math.round(24 * n), 1.2, R * 0.4, 1.4, 1.5, 2, 70, { h: 42, sat: 90 });
    } else {   // crossette: a few stars that each split in four
      const N = 10 + Math.floor(Math.random() * 4);
      for (let i = 0; i < N; i++) { const a = i / N * TAU + Math.random() * 0.2, sp = R * 1.5;
        spark({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k: 1.6, gr: R * 0.3, t: 0, life: 2, s: 2.6, n: 3, h: hueOf(i), sat: 100, l: 64, split: 0.55 + Math.random() * 0.15 }); }
    }
    glows.push({ x: x, y: y, h: e.hue, t: 0, life: 0.6, r: R * 1.7 });
    if (!RM) for (let i = 0; i < 2; i++) smoke.push({ x: x + (Math.random() - 0.5) * R, y: y + (Math.random() - 0.3) * R * 0.6, r: R * (0.4 + Math.random() * 0.4), t: 0, life: 5 + Math.random() * 2 });
    if (smoke.length > 16) smoke.splice(0, smoke.length - 16);
  }
  function splitStar(p) {
    const sp = Math.hypot(p.vx, p.vy) * 0.9 + p.R0 * 0.4, a0 = Math.atan2(p.vy, p.vx) + Math.PI / 4;
    for (let j = 0; j < 4; j++) { const a = a0 + j * Math.PI / 2; spark({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k: 2, gr: p.gr, t: 0, life: 0.8, s: 1.8, n: 3, h: p.h, sat: 100, l: 72, glit: true }); }
  }

  /* v: {st, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    clock += dt;
    // before the start and after the end, a small shell now and then, so the sky is never quite empty
    if ((v.st === 'idle' || v.st === 'stopped') && !rockets.length) { idleT -= dt; if (idleT <= 0) { idleT = 2.6 + Math.random() * 1.6;
      launch({ x: 0.2 + Math.random() * 0.6, h: 0.45 + Math.random() * 0.3, size: 0.35, hue: Math.floor(Math.random() * 12) * 30, hue2: -1, kind: Math.random() < 0.5 ? 'peony' : 'ring' }); } }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    // the night sky, a little lighter while the music plays
    const lift = (v.music ? v.level * 6 : 0) + flash * 30, sky = g.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, col(222, 66, Math.round(5 + lift * 0.4))); sky.addColorStop(0.6, col(218, 58, Math.round(12 + lift * 0.6))); sky.addColorStop(1, col(215, 38, Math.round(26 + lift * 0.6)));
    g.fillStyle = sky; g.fillRect(0, 0, W, GY);
    const halo = g.createRadialGradient(MOONX, MOONY, 0, MOONX, MOONY, MOONR * 9); halo.addColorStop(0, 'rgba(150,170,215,.35)'); halo.addColorStop(1, 'rgba(150,170,215,0)');
    g.fillStyle = halo; g.fillRect(MOONX - MOONR * 9, MOONY - MOONR * 9, MOONR * 18, MOONR * 18);
    for (const s of stars) { g.globalAlpha = RM ? 0.6 : 0.35 + 0.35 * Math.sin(clock * s.f + s.p); g.fillStyle = '#DDE4FF'; g.fillRect(s.x, s.y, s.s, s.s); }
    g.globalAlpha = 1; g.fillStyle = '#F4EBD6'; g.beginPath(); g.arc(MOONX, MOONY, MOONR, 0, TAU); g.fill();   // the moon
    // smoke left by the bursts, drifting with the breeze and lit by the newest ones
    let light = flash; for (const o of glows) light = Math.max(light, 1 - o.t / o.life);
    for (let i = smoke.length - 1; i >= 0; i--) { const o = smoke[i]; o.t += dt; if (o.t >= o.life) { smoke.splice(i, 1); continue; } o.x += dt * 6; o.y -= dt * 2; o.r += dt * 4;
      const a = (1 - o.t / o.life) * (0.025 + light * 0.05), gr = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      gr.addColorStop(0, 'rgba(150,150,180,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(150,150,180,0)'); g.fillStyle = gr; g.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); }
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    // the sky lights up round each burst
    for (let i = glows.length - 1; i >= 0; i--) { const o = glows[i]; o.t += dt; if (o.t >= o.life) { glows.splice(i, 1); continue; } const k = 1 - o.t / o.life;
      const gr = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r); gr.addColorStop(0, 'hsla(' + o.h + ',100%,60%,' + (0.2 * k * k).toFixed(3) + ')'); gr.addColorStop(1, 'hsla(' + o.h + ',100%,50%,0)');
      g.fillStyle = gr; g.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
      if (o.t < 0.12 && !RM) { g.globalAlpha = 1 - o.t / 0.12; g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(o.x, o.y, 2 + o.r * 0.03, 0, TAU); g.fill(); g.globalAlpha = 1; } }
    // shells on the way up, with a trail of sparks
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.t += dt; const p = Math.min(1, r.t / r.dur), q = 1 - (1 - p) * (1 - p);
      r.x = r.x0 + r.drift * q; r.y = r.y0 + (r.ty - r.y0) * q;
      if (!RM || Math.random() < 0.3) spark({ x: r.x + (Math.random() - 0.5) * 1.5, y: r.y + 2, vx: (Math.random() - 0.5) * 12, vy: 10 + Math.random() * 20, k: 2, gr: 30, t: 0, life: 0.35 + Math.random() * 0.25, s: 1.4, n: 0, h: 34, sat: 100, l: 70 });
      g.fillStyle = '#FFE9B8'; g.fillRect(r.x - 1.2, r.y - 1.2, 2.4, 2.4);
      if (p >= 1) { rockets.splice(i, 1); burst(r); } }
    // the sparks
    const kf = {};
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t += dt;
      if (p.split && p.t >= p.split) { p.R0 = Math.hypot(p.vx, p.vy) * 0.25; sparks.splice(i, 1); splitStar(p); continue; }
      if (p.t >= p.life) { sparks.splice(i, 1); continue; }
      const d = kf[p.k] || (kf[p.k] = Math.exp(-p.k * dt)); p.vx *= d; p.vy = p.vy * d + (p.hold && p.t < p.hold ? 0 : p.gr) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const age = p.t / p.life; let a = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
      if (p.glit && age > 0.55 && !RM) a *= Math.random() < 0.55 ? 1 : 0.15;   // glitter as they burn out
      const l = Math.round(p.l + (age < 0.06 ? (1 - age / 0.06) * 18 : 0) - (p.droop ? age * 16 : 0)), c = col(p.h, p.sat, Math.max(28, Math.min(90, l)));
      if (p.n) { const b = p.n * 0.03; g.strokeStyle = c; g.lineWidth = p.s * 0.75; g.globalAlpha = a * 0.55;   // a streak behind it, the length of its last moments
        g.beginPath(); g.moveTo(p.x - p.vx * b, p.y - p.vy * b + (p.droop ? p.gr * b * b : 0)); g.lineTo(p.x, p.y); g.stroke(); }
      g.fillStyle = c; g.globalAlpha = a; g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.lineCap = 'butt';
    // the skyline in front, then the harbour giving it all back upside down
    g.drawImage(skyline, 0, GY - skyline.height / dpr, W, skyline.height / dpr);
    { const k = RM ? 0 : clock, Wh = WHEEL; g.lineWidth = 1; g.strokeStyle = 'rgba(138,150,180,.6)'; g.beginPath(); g.arc(Wh.x, Wh.y, Wh.r, 0, TAU); g.stroke();   // the Ferris wheel, its lights chasing round
      g.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + k * 0.09; g.moveTo(Wh.x, Wh.y); g.lineTo(Wh.x + Math.cos(a) * Wh.r, Wh.y + Math.sin(a) * Wh.r); } g.stroke();
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + k * 0.09; g.fillStyle = col(Math.round(((i / 24 + k * 0.08) % 1) * 360), 90, 62); g.fillRect(Wh.x + Math.cos(a) * Wh.r - 1, Wh.y + Math.sin(a) * Wh.r - 1, 2, 2); }
      if (!RM) { const a = Math.sin(k * 0.55), len = W * 0.45, dir = a >= 0 ? 1 : -1, spread = 0.08 + 0.12 * (1 - Math.abs(a));   // the lighthouse beam swinging across the bay
        g.globalCompositeOperation = 'lighter'; const bg = g.createLinearGradient(LIGHT.x, 0, LIGHT.x + dir * len * Math.abs(a), 0); bg.addColorStop(0, 'rgba(255,235,180,.28)'); bg.addColorStop(1, 'rgba(255,235,180,0)');
        g.fillStyle = bg; g.beginPath(); g.moveTo(LIGHT.x, LIGHT.y); g.lineTo(LIGHT.x + dir * len * Math.abs(a), LIGHT.y - len * spread * 0.5); g.lineTo(LIGHT.x + dir * len * Math.abs(a), LIGHT.y + len * spread * 0.3); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over'; } }
    const WH = H - GY, srcH = Math.min(GY, WH * 2.4);
    g.fillStyle = '#060C16'; g.fillRect(0, GY, W, WH);
    g.save(); g.setTransform(dpr, 0, 0, -dpr, 0, (GY + H) * dpr); g.globalAlpha = 0.42;
    g.drawImage(cv, 0, Math.round((GY - srcH) * dpr), Math.round(W * dpr), Math.round(srcH * dpr), 0, GY, W, WH); g.restore();
    g.fillStyle = 'rgba(4,5,12,.55)';   // ripples break the reflection into lines
    for (let y = GY + 1, j = 0; y < H; y += 3, j++) { const off = RM ? 0 : Math.sin(clock * 1.6 + j * 0.9) * 6; g.fillRect(off - 6, y, W + 12, 1 + (j % 3 === 0 ? 1 : 0)); }
    const fade = g.createLinearGradient(0, GY, 0, H); fade.addColorStop(0, 'rgba(4,5,12,0)'); fade.addColorStop(1, 'rgba(4,5,12,.7)'); g.fillStyle = fade; g.fillRect(0, GY, W, WH);
    g.fillStyle = 'rgba(160,180,255,.18)'; g.fillRect(0, GY, W, 1);
    g.globalCompositeOperation = 'lighter';   // the moon's path glittering on the water
    for (let y = GY + 2, j = 0; y < H; y += 2, j++) { const f = (y - GY) / (H - GY), w = MOONR * (1.2 + f * 5), on = RM ? 0.6 : 0.35 + 0.65 * Math.abs(Math.sin(clock * 2.1 + j * 1.7));
      g.fillStyle = 'rgba(255,240,210,' + (0.32 * on * (1 - f * 0.5)).toFixed(3) + ')'; g.fillRect(MOONX - w / 2 + Math.sin(clock * 1.3 + j) * w * 0.15, y, w * (0.5 + 0.5 * on), 1); }
    g.globalCompositeOperation = 'source-over';
    flash = Math.max(0, flash - dt * 0.6);
  }
  function busy() { return rockets.length + sparks.length; }
  return { resize: resize, draw: draw, event: event, reset: reset, busy: busy };
}
