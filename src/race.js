/* Grand Prix theme renderer: a chase camera on a road drawn segment by segment (the way the old arcade racers did it, on a 2D canvas),
   at sunset, with timing-screen read-outs. Everything about the race (positions, speeds, the pit lane, the lights) comes from RaceSim
   in the core; this only draws it. */
/* exported makeRaceView */   // used by src/app.js, which the build puts after this file
function makeRaceView(cv, hud, sim, MT) {
  'use strict';
  const RC = MT.RACE, RP = MT.RACE_PIT, track = sim.T, N = track.n, SEG = RC.SEG, ROADW = RC.ROADW, LAP = RC.LAP, VNOM = RC.VNOM, PZ = RC.PZ, GRIDGAP = RC.GRIDGAP, START = RC.START;
  const RIVALS = RC.RIVALS, YOU = { c1: RC.YOU[1], c2: RC.YOU[2] }, rng = MT.raceRng;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, gridX = p => p % 2 ? -0.42 : 0.42, wrapLap = l => l - Math.round(l);
  const g = cv.getContext('2d'), RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CD = 1 / Math.tan(50 * Math.PI / 180), CAMH = 1000, MAXD = 240;
  const X1 = new Float32Array(MAXD + 2), Y1 = new Float32Array(MAXD + 2), W1 = new Float32Array(MAXD + 2), S1 = new Float32Array(MAXD + 2),
    X2 = new Float32Array(MAXD + 2), Y2 = new Float32Array(MAXD + 2), W2 = new Float32Array(MAXD + 2), VIS = new Uint8Array(MAXD + 2);
  let W = 0, H = 0, dpr = 1, top = 0, HY = 0, GY = 0, K = 1, DD = 150, bgX = 0, clock = 0, sky = null, far = null, near = null;
  let flagT = -1, shake = 0, pitSeen = null, pitFade = 0;   // the pit lane last drawn, and how far its garages have faded in
  const sparks = [], confetti = [], buckets = [];
  for (let i = 0; i <= MAXD; i++) buckets.push([]);

  /* ---------- colours, faded toward the haze with distance ---------- */
  const FOG = [214, 150, 128], FL = 16;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const BASE = { grassA: '#3B6F38', grassB: '#447C3F', roadA: '#3C3F48', roadB: '#393C44', rubber: '#34363D', line: '#E6E9EF', kerbR: '#D3313A', kerbW: '#ECECEC',
    gravel: '#C3A273', start: '#F4F4F4', pit: '#4B4F59', wall: '#A7AEBD', apron: '#5B606B', yellow: '#F2C230' };
  const PAL = [];
  for (let k = 0; k < FL; k++) { const f = Math.pow(k / (FL - 1), 1.15) * 0.92, o = {};
    for (const key in BASE) { const c = hex(BASE[key]); o[key] = 'rgb(' + c.map((v, j) => Math.round(v + (FOG[j] - v) * f)).join(',') + ')'; }
    PAL.push(o); }

  /* ---------- sprites, drawn once ---------- */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function carSprite(c1, c2, open) {
    const cv = mk(256, 140), c = cv.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,.42)'; c.beginPath(); c.ellipse(128, 130, 126, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#15161B'; rr(c, 28, 44, 26, 32, 6); c.fill(); rr(c, 202, 44, 26, 32, 6); c.fill();          // front tyres, just visible
    const tyre = x => { c.fillStyle = '#121318'; rr(c, x, 56, 56, 76, 11); c.fill(); c.fillStyle = '#2C2E36'; rr(c, x + 7, 60, 42, 7, 3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x + 9, 70, 4, 52); };
    tyre(2); tyre(198);
    c.fillStyle = '#17181E'; c.fillRect(56, 94, 144, 30);                                                 // floor and diffuser
    c.fillStyle = '#262830'; for (let i = 0; i < 8; i++) c.fillRect(66 + i * 17, 98, 4, 26);
    c.fillStyle = c1; c.beginPath(); c.moveTo(58, 98); c.lineTo(62, 74); c.quadraticCurveTo(80, 61, 104, 58); c.lineTo(111, 32);
    c.quadraticCurveTo(128, 23, 145, 32); c.lineTo(152, 58); c.quadraticCurveTo(176, 61, 194, 74); c.lineTo(198, 98); c.closePath(); c.fill();
    c.fillStyle = c2; c.beginPath(); c.moveTo(121, 30); c.lineTo(135, 30); c.lineTo(142, 98); c.lineTo(114, 98); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,200,150,.18)'; c.beginPath(); c.moveTo(152, 58); c.quadraticCurveTo(176, 61, 194, 74); c.lineTo(198, 98); c.lineTo(160, 98); c.closePath(); c.fill();   // the low sun on one flank
    c.fillStyle = c2; c.beginPath(); c.arc(128, 37, 9, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(119, 36, 18, 4);   // helmet and visor
    c.strokeStyle = '#0E0F14'; c.lineWidth = 5; c.beginPath(); c.moveTo(103, 54); c.quadraticCurveTo(128, 20, 153, 54); c.stroke();   // halo
    c.fillStyle = '#101116'; c.fillRect(124, 40, 8, 30);                                                  // wing pillar
    c.fillStyle = '#1A1B21'; c.fillRect(84, 84, 88, 6);                                                   // beam wing
    c.fillStyle = c1; c.fillRect(58, 12, 10, 64); c.fillRect(188, 12, 10, 64);                            // endplates
    c.fillStyle = c2; c.fillRect(58, 16, 140, 12);                                                        // main plane
    c.fillStyle = c1; if (open) c.fillRect(64, 4, 128, 4); else c.fillRect(64, 29, 128, 8);               // flap: up and open with DRS
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(58, 28, 140, 2);
    c.fillStyle = '#3A0C10'; c.fillRect(118, 88, 20, 10);                                                 // rain light
    return cv;
  }
  const SPR = { you: carSprite(YOU.c1, YOU.c2, false), youDrs: carSprite(YOU.c1, YOU.c2, true), cars: RIVALS.map(r => carSprite(r[1], r[2], false)) };
  const glow = mk(64, 64); { const c = glow.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,60,60,1)'); gr.addColorStop(0.35, 'rgba(255,40,40,.55)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }
  function treeSprite(kind) {
    const cv = mk(160, 240), c = cv.getContext('2d');
    c.fillStyle = '#3A2A22'; c.fillRect(74, 180, 12, 60);
    if (kind === 0) { for (let i = 0; i < 4; i++) { const y = 30 + i * 46, w = 46 + i * 18;
        c.fillStyle = '#1D3B2F'; c.beginPath(); c.moveTo(80, y - 30); c.lineTo(80 + w, y + 44); c.lineTo(80 - w, y + 44); c.closePath(); c.fill();
        c.fillStyle = '#5E7340'; c.beginPath(); c.moveTo(80, y - 30); c.lineTo(80 + w, y + 44); c.lineTo(80 + w * 0.45, y + 44); c.closePath(); c.fill(); } }
    else { const blobs = [[80, 70, 52], [48, 110, 42], [112, 110, 44], [80, 140, 50]];
      for (const [x, y, r] of blobs) { c.fillStyle = '#24452F'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
      for (const [x, y, r] of blobs) { c.fillStyle = 'rgba(214,170,90,.35)'; c.beginPath(); c.arc(x + r * 0.35, y - r * 0.2, r * 0.55, 0, Math.PI * 2); c.fill(); } }
    return cv;
  }
  function standSprite() {
    const cv = mk(640, 250), c = cv.getContext('2d');
    c.fillStyle = '#1C2236'; c.fillRect(0, 60, 640, 190);
    c.fillStyle = '#2B3350'; c.beginPath(); c.moveTo(-10, 66); c.lineTo(650, 66); c.lineTo(620, 18); c.lineTo(20, 18); c.closePath(); c.fill();
    c.fillStyle = '#86DCC0'; c.fillRect(20, 14, 600, 6);
    const cols = ['#F2F2F2', '#E8333B', '#FFC23D', '#86DCC0', '#7FA8FF', '#FF8A00', '#C9B6FF'];
    const rnd = rng(7);
    for (let r = 0; r < 8; r++) { c.fillStyle = '#262D46'; c.fillRect(0, 76 + r * 18, 640, 3);
      for (let x = 6; x < 636; x += 9) if (rnd() > 0.12) { c.fillStyle = cols[(rnd() * cols.length) | 0]; c.fillRect(x, 80 + r * 18, 5, 8); c.fillStyle = '#E7C3A2'; c.fillRect(x + 1, 78 + r * 18, 3, 3); } }
    c.fillStyle = '#0F1322'; c.fillRect(0, 222, 640, 28);
    c.fillStyle = '#F4F4F4'; c.font = '800 italic 22px "Barlow Condensed", "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const t = MT.tr('MUSIC TIMER GRAND PRIX'), step = c.measureText(t).width + 48;   // spaced by the text's own width, whatever font it gets
    for (let x = step / 2; x < 640 + step; x += step) c.fillText(t, x, 237);
    return cv;
  }
  function boardSprite(text) {
    const cv = mk(380, 150), c = cv.getContext('2d');
    c.fillStyle = '#20242E'; c.fillRect(40, 96, 10, 54); c.fillRect(330, 96, 10, 54);
    c.fillStyle = '#0E1430'; c.fillRect(0, 0, 380, 104); c.fillStyle = '#86DCC0'; c.fillRect(0, 0, 380, 8);
    c.fillStyle = '#F5F6FA'; c.font = '800 italic 64px "Barlow Condensed", "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 190, 58, 350);
    return cv;
  }
  function garageSprite(col, ours) {
    const cv = mk(560, 280), c = cv.getContext('2d');
    c.fillStyle = '#3B4254'; c.fillRect(0, 0, 560, 280);
    c.fillStyle = col; c.fillRect(0, 0, 560, 34);
    c.fillStyle = '#10131C'; c.fillRect(40, 70, 480, 210);
    const gr = c.createLinearGradient(0, 70, 0, 280); gr.addColorStop(0, '#F5F1E6'); gr.addColorStop(1, '#8D8A86'); c.fillStyle = gr; c.globalAlpha = 0.85; c.fillRect(48, 76, 464, 204); c.globalAlpha = 1;
    c.fillStyle = '#20232D'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(110 + i * 60, 248, 26, 0, Math.PI * 2); c.fill(); }   // tyre sets on the rack
    c.fillStyle = col; c.fillRect(330, 120, 140, 70);
    c.fillStyle = ours ? '#0D2A22' : '#FFFFFF'; c.font = '800 italic 42px "Barlow Condensed", "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(MT.tr(ours ? 'YOU' : 'PIT'), 400, 157);
    return cv;
  }
  let TREES, STAND, BOARDS, GARAGES, OURS;
  function buildSprites() {
    TREES = [treeSprite(0), treeSprite(1)]; STAND = standSprite(); BOARDS = {}; for (const b of track.boards) BOARDS[b.text] = boardSprite(b.text);
    GARAGES = RIVALS.map(r => garageSprite(r[1], false)); OURS = garageSprite(YOU.c2, true);
    buildScenery();
  }
  /* scenery by segment: {k, x (road half-widths from the centre), w (world width)} */
  const SCN = [];
  function buildScenery() {
    SCN.length = 0; for (let i = 0; i < N; i++) SCN.push([]);
    const rnd = rng(11);
    for (let i = 0; i < N; i++) {
      if (i < 160) { if (i % 34 === 12 && i > 20) { SCN[i].push({ k: 'stand', x: -3.6, w: 5200 }); SCN[i].push({ k: 'stand', x: 3.6, w: 5200 }); } continue; }
      if (i % 6 === 0) SCN[i].push({ k: 'tree', v: rnd() < 0.55 ? 0 : 1, x: -(2.1 + rnd() * 3.2), w: 1100 + rnd() * 500 });
      if (i % 6 === 3) SCN[i].push({ k: 'tree', v: rnd() < 0.55 ? 0 : 1, x: 2.1 + rnd() * 3.2, w: 1100 + rnd() * 500 });
      if (i % 17 === 5) SCN[i].push({ k: 'tree', v: 0, x: (rnd() < 0.5 ? -1 : 1) * (5.5 + rnd() * 3), w: 1500 });
    }
    for (const b of track.boards) { const i = (b.at - 18 + N) % N; SCN[i].push({ k: 'board', t: b.text, x: b.side * 1.95, w: 1900 }); }
  }

  /* ---------- background: sky, sun and two layers of hills, drawn at each resize ---------- */
  function buildBackground() {
    const hh = Math.max(40, Math.ceil(HY + 2));
    sky = mk(Math.ceil(W * dpr), Math.ceil(hh * dpr)); const c = sky.getContext('2d'); c.scale(dpr, dpr);
    const gr = c.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#121838'); gr.addColorStop(0.4, '#33336A'); gr.addColorStop(0.72, '#A65A78'); gr.addColorStop(0.9, '#EE8A5C'); gr.addColorStop(1, '#FFC27C');
    c.fillStyle = gr; c.fillRect(0, 0, W, hh);
    const sx = W * 0.7, sy = hh - Math.min(46, hh * 0.18), sr = Math.max(18, Math.min(W, 600) * 0.07);
    const sg = c.createRadialGradient(sx, sy, 0, sx, sy, sr * 6); sg.addColorStop(0, 'rgba(255,214,150,.65)'); sg.addColorStop(1, 'rgba(255,170,110,0)');
    c.fillStyle = sg; c.fillRect(0, 0, W, hh);
    c.fillStyle = '#FFE6B0'; c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.fill();
    const rnd = rng(3);
    for (let i = 0; i < 7; i++) { c.fillStyle = 'rgba(255,170,130,' + (0.12 + rnd() * 0.14) + ')'; c.beginPath(); c.ellipse(rnd() * W, hh * (0.25 + rnd() * 0.45), 60 + rnd() * 140, 4 + rnd() * 6, 0, 0, Math.PI * 2); c.fill(); }
    const layer = (h, col, amp, f, seed) => { const L = mk(1024, h), x = L.getContext('2d'); x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
      for (let i = 0; i <= 1024; i += 8) { const a = i / 1024 * Math.PI * 2; x.lineTo(i, h - amp * (0.55 + 0.25 * Math.sin(a * f + seed) + 0.15 * Math.sin(a * f * 3 + seed * 2) + 0.05 * Math.sin(a * 17))); }
      x.lineTo(1024, h); x.closePath(); x.fill(); return L; };
    far = layer(160, '#6E4C79', 120, 3, 1); near = layer(120, '#2C2D52', 70, 5, 4);
  }
  function resize() {
    const r = cv.parentElement, w = r.clientWidth, h = r.clientHeight; if (w < 10 || h < 10) return false;
    const d = Math.min(2, window.devicePixelRatio || 1), t = hud.offsetTop + hud.offsetHeight;
    if (w === W && h === H && d === dpr && t === top) return true;   // every theme change asks, after the frame is drawn: setting the canvas size clears it, and a blank frame would show
    dpr = d; W = w; H = h; top = t;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const free = H - top;
    GY = H - Math.max(8, free * 0.04);
    let gap = (GY - top) * 0.62; gap = Math.min(gap, 0.46 * W * CAMH / 760); HY = GY - gap;   // the car fills no more than 46% of the width
    K = gap * PZ / (CD * CAMH);
    DD = W * H > 500000 ? 220 : 150;
    buildBackground();
    cv.parentElement.style.setProperty('--gp-hy', Math.round(HY) + 'px');   // the banner and the start lights sit over the sky, above the horizon
    return true;
  }

  function event(e) {
    if (e === 'note' && !RM) for (let i = 0; i < 7; i++) sparks.push({ x: (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 520, vy: 80 + Math.random() * 260, t: 0, life: 0.22 + Math.random() * 0.2 });
    if (e === 'go') shake = 0.4;
    if (e === 'finish') { flagT = 0; if (!RM) for (let i = 0; i < 90; i++) confetti.push({ x: Math.random() * W, y: top - Math.random() * 60, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 90, r: Math.random() * 6, vr: (Math.random() - 0.5) * 9, t: 0, life: 3 + Math.random() * 2, c: ['#FFFFFF', '#111111', '#86DCC0', '#FFC23D', '#E8333B'][i % 5] }); }
  }
  function quad(col, a1, b1, a2, b2, y1, y2) { g.fillStyle = col; g.beginPath(); g.moveTo(a1, y1); g.lineTo(b1, y1); g.lineTo(b2, y2); g.lineTo(a2, y2); g.closePath(); g.fill(); }
  /* a strip from a to b half-widths out from the centre, on one side (-1 left, 1 right) of segment n */
  function strip(n, col, a, b, side) {
    const x1 = X1[n], w1 = W1[n], x2 = X2[n], w2 = W2[n];
    if (side > 0) quad(col, x1 + w1 * a, x1 + w1 * b, x2 + w2 * a, x2 + w2 * b, Y1[n], Y2[n]);
    else quad(col, x1 - w1 * b, x1 - w1 * a, x2 - w2 * b, x2 - w2 * a, Y1[n], Y2[n]);
  }
  function drawSegment(n, abs, P) {
    const i = abs % N, c = track.curve[i], y1 = Y1[n], y2 = Y2[n], x1 = X1[n], w1 = W1[n], x2 = X2[n], w2 = W2[n], wide = w1 > 30;
    g.fillStyle = ((abs / 6) | 0) & 1 ? P.grassA : P.grassB; g.fillRect(0, y2, W, y1 - y2 + 1);
    if (Math.abs(c) > 2.8) strip(n, P.gravel, 1.08, 1.8, c > 0 ? -1 : 1);
    quad(((abs / 3) | 0) & 1 ? P.roadA : P.roadB, x1 - w1, x1 + w1, x2 - w2, x2 + w2, y1, y2);
    if (wide) quad(P.rubber, x1 - w1 * 0.3, x1 + w1 * 0.3, x2 - w2 * 0.3, x2 + w2 * 0.3, y1, y2);
    if (Math.abs(c) > RC.KERB) { const k = abs & 1 ? P.kerbR : P.kerbW; strip(n, k, 0.97, 1.11, -1); strip(n, k, 0.97, 1.11, 1); }
    else if (w1 > 6) { strip(n, P.line, 0.955, 0.99, -1); strip(n, P.line, 0.955, 0.99, 1); }
    if (i === START) quad(P.start, x1 - w1, x1 + w1, x2 - w2, x2 + w2, y1, y1 + (y2 - y1) * 0.5);
    for (let p = 1; p <= 10; p++) if (i === START - 4 - (p - 1) * GRIDGAP + 2) {   // grid boxes
      const ym = y1 + (y2 - y1) * 0.25;
      if (gridX(p) > 0) quad(P.line, x1 + w1 * 0.1, x1 + w1 * 0.75, x2 + w2 * 0.1, x2 + w2 * 0.75, y1, ym);
      else quad(P.line, x1 - w1 * 0.75, x1 - w1 * 0.1, x2 - w2 * 0.75, x2 - w2 * 0.1, y1, ym);
    }
    const pit = sim.pit, c1 = pit ? sim.pitX(abs) : null, c2 = pit ? sim.pitX(abs + 1) : null;   // the pit lane, along the path the car keeps to
    if (c1 != null || c2 != null) {
      const H = RP.HALF, a1 = c1 == null ? c2 : c1, a2 = c2 == null ? c1 : c2, i1 = a1 - H, o1 = a1 + H, i2 = a2 - H, o2 = a2 + H;
      const main = abs >= pit.a + RP.IN && abs + 1 <= pit.m0, out = abs + 1 > pit.m0;   // beside the track past the garages; the bend back out
      if (o1 > 0.98 || o2 > 0.98) band(n, P.pit, Math.max(0.98, i1), Math.max(0.98, o1), Math.max(0.98, i2), Math.max(0.98, o2));   // its surface off the track
      if (main) { band(n, P.apron, o1, o1 + 1.6, o2, o2 + 1.6); band(n, P.wall, 1.03, 1.1, 1.03, 1.1); }
      else if (out || (i1 >= 0.96 && i2 >= 0.96)) band(n, P.line, i1 - 0.02, i1 + 0.02, i2 - 0.02, i2 + 0.02);   // the line along its inner edge, painted on into the track on the way out
      if (main && abs >= pit.boxSeg - 1 && abs <= pit.boxSeg + 4) { strip(n, P.yellow, 1.2, 1.24, 1); strip(n, P.yellow, 1.72, 1.76, 1);
        if (abs === pit.boxSeg - 1 || abs === pit.boxSeg + 4) strip(n, P.yellow, 1.2, 1.76, 1); }
    }
  }
  /* a band on the right of segment n from a to b half-widths out at its near end, c to d at its far end (a lane that bends) */
  function band(n, col, a, b, c, d) { quad(col, X1[n] + W1[n] * a, X1[n] + W1[n] * b, X2[n] + W2[n] * c, X2[n] + W2[n] * d, Y1[n], Y2[n]); }
  function sprite(img, n, xo, ww, alpha) {
    const s = S1[n], w = ww * s * K; if (w < 1.5) return;
    const h = w * img.height / img.width, X = X1[n] + s * xo * ROADW * K;
    if (X + w / 2 < 0 || X - w / 2 > W) return;
    if (alpha < 1) g.globalAlpha = alpha;
    g.drawImage(img, X - w / 2, Y1[n] - h, w, h);
    if (alpha < 1) g.globalAlpha = 1;
  }
  function gantry(n) {
    const k = S1[n] * K, X = X1[n], Y = Y1[n], w = W1[n];
    const pw = Math.max(1, 90 * k), hgt = 2100 * k, bh = 300 * k;
    g.fillStyle = '#1C2030'; g.fillRect(X - w * 1.25 - pw / 2, Y - hgt, pw, hgt); g.fillRect(X + w * 1.25 - pw / 2, Y - hgt, pw, hgt);
    g.fillRect(X - w * 1.25, Y - hgt, w * 2.5, bh);
    if (bh > 6) { const lit = sim.mode === 'lights' ? sim.lit : 0, r = bh * 0.22;
      for (let j = 0; j < 5; j++) { const cx = X + (j - 2) * bh * 1.1; g.fillStyle = '#05060A'; g.fillRect(cx - bh * 0.42, Y - hgt + bh * 0.08, bh * 0.84, bh * 0.84);
        g.fillStyle = j < lit || sim.mode === 'red' ? '#FF2B2B' : '#2A0B0E'; g.beginPath(); g.arc(cx, Y - hgt + bh * 0.5, r * 1.3, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#86DCC0'; g.fillRect(X - w * 1.25, Y - hgt + bh, w * 2.5, Math.max(1, bh * 0.08)); }
  }
  /* the rain light at the back of a car drawn w wide with its bottom centre at (x, y) */
  function rainLight(x, y, w) {
    const h = w * 140 / 256, lx = x - w / 2 + w * 118 / 256, ly = y - h + h * 88 / 140;
    g.fillStyle = '#FF3B3B'; g.fillRect(lx, ly, w * 20 / 256, h * 10 / 140);
    g.globalCompositeOperation = 'lighter'; g.drawImage(glow, lx - w * 0.06, ly - w * 0.07, w * 0.2, w * 0.16); g.globalCompositeOperation = 'source-over';
  }
  function car(img, n, frac, z, xo, alpha, light) {
    const s = CD / z, w = 760 * s * K; if (w < 2) return;
    const h = w * 140 / 256, X = X1[n] + (X2[n] - X1[n]) * frac + s * xo * ROADW * K, Y = Y1[n] + (Y2[n] - Y1[n]) * frac;
    if (X + w < 0 || X - w > W) return;
    if (alpha < 1) g.globalAlpha = alpha;
    g.drawImage(img, X - w / 2, Y - h, w, h);
    if (light && w > 8) rainLight(X, Y, w);
    if (alpha < 1) g.globalAlpha = 1;
  }
  /* the last minute, one bar a second, oldest on the left: played seconds full height in mint, quiet ones short */
  function minuteStrip(x, y, w, h, minute) {
    const bw = w / 60;
    for (let i = 0; i < 60; i++) { const v = minute ? minute[i] : null, on = v != null && v >= 0.5;
      g.fillStyle = v == null ? '#161B2E' : on ? '#86DCC0' : '#3A425E';
      g.fillRect(x + i * bw, v == null || on ? y : y + h * 0.6, Math.max(1, bw - 0.6), v == null || on ? h : h * 0.4); }
  }
  function wheelPanel(minute) {
    const bw = 128, bh = 92, bx = hud.offsetLeft + hud.offsetWidth - bw, by = top + 8;   // under the read-outs, at their right edge
    g.fillStyle = 'rgba(9,12,26,.84)'; g.beginPath(); if (g.roundRect) g.roundRect(bx, by, bw, bh, 8); else g.rect(bx, by, bw, bh); g.fill();
    const kmh = sim.v * 300 / VNOM, gears = [0, 75, 115, 150, 185, 220, 252, 282, 999];
    let gear = 1; while (gear < 8 && kmh >= gears[gear]) gear++;
    const rpm = sim.v < 30 ? (sim.mode === 'lights' ? 0.35 + 0.25 * Math.sin(clock * 9) : 0.12) : clamp((kmh - gears[gear - 1]) / (gears[gear] - gears[gear - 1]), 0, 1);
    const lit = Math.round(rpm * 15), lw = (bw - 16) / 15;
    for (let i = 0; i < 15; i++) { g.fillStyle = i < lit ? (i < 5 ? '#3BD16F' : i < 10 ? '#FF3B3B' : '#9B7BFF') : '#20263C'; g.beginPath(); g.arc(bx + 8 + lw * (i + 0.5), by + 10, lw * 0.36, 0, Math.PI * 2); g.fill(); }
    const F = '"Barlow Condensed", "Arial Narrow", sans-serif', gx = bx + bw - 30;
    g.fillStyle = '#20263C'; g.fillRect(gx, by + 20, 22, 32);
    g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = '#F5F6FA';
    g.font = '800 24px ' + F; g.fillText(sim.v < 30 ? 'N' : String(gear), gx + 11, by + 45);
    g.textAlign = 'left'; g.font = '800 italic 30px ' + F;
    const sp = String(Math.round(kmh)), sw = g.measureText(sp).width; g.fillText(sp, bx + 9, by + 48);
    g.font = '600 11px ' + F; g.fillStyle = '#A9B0C6'; const unit = MT.tr('KM/H'); if (bx + 12 + sw + g.measureText(unit).width < gx - 2) g.fillText(unit, bx + 12 + sw, by + 48);
    g.font = '600 10px ' + F; g.fillStyle = '#A9B0C6'; g.fillText(MT.tr('LAST MINUTE'), bx + 8, by + 64);
    minuteStrip(bx + 8, by + 67, bw - 16, 9, minute);
    g.font = '700 10px ' + F; const pills = [['DRS', sim.drs, '#3BD16F']]; if (sim.mode === 'red') pills.push([MT.tr('RED FLAG'), true, '#FF2B2B']); else if (sim.limiter) pills.push([MT.tr('PIT LIMIT'), true, '#FFC23D']);
    let px = bx + 8;
    for (const [t, on, col] of pills) { const tw = g.measureText(t).width + 10; g.fillStyle = on ? col : '#1C2238'; g.beginPath(); if (g.roundRect) g.roundRect(px, by + 79, tw, 12, 3); else g.rect(px, by + 79, tw, 12); g.fill();
      g.fillStyle = on ? '#0B1020' : '#56607E'; g.fillText(t, px + 5, by + 88.5); px += tw + 5; }
  }
  /* a flag waving below the read-outs: chequered at the finish, red while the race is paused */
  function flag(kind, a) {
    const fw = Math.min(W * 0.26, 104), fh = fw * 0.62, x0 = W / 2 - fw / 2 + 8, y0 = top + 104, cols = 8, rows = 5, cw = fw / cols, chh = fh / rows;
    g.globalAlpha = a; g.fillStyle = '#C9CED8'; g.fillRect(x0 - 6, y0 - 4, 4, fh * 1.8);
    for (let i = 0; i < cols; i++) { const ph = clock * 9 - i * 0.8, wv = RM ? 0 : Math.sin(ph) * 4 * (i / cols), lit = RM ? 0 : Math.cos(ph) * (i / cols);
      for (let j = 0; j < rows; j++) { g.fillStyle = kind === 'red' ? (lit > 0.15 ? '#FF4A4A' : lit < -0.15 ? '#B9161D' : '#E0222A') : (i + j) & 1 ? '#111' : '#FFF'; g.fillRect(x0 + i * cw, y0 + j * chh + wv, cw + 0.5, chh + 0.5); } }
    g.globalAlpha = 1;
  }

  /* v: {minute (the last minute, oldest first, or null)}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    const minute = v.minute;
    clock += dt;
    const d = sim.d, base = Math.floor(d / SEG), pct = d / SEG - base;
    const pa = (d + PZ) / SEG, ps = Math.floor(pa), pp = pa - ps, pi = ps % N;
    const playerY = track.y[pi] + (track.y[pi + 1] - track.y[pi]) * pp, camY = playerY + CAMH, camX = sim.x * ROADW;
    bgX += track.curve[base % N] * sim.v * dt * 0.00045;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) { shake -= dt; if (!RM) g.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2); }
    // sky and hills
    g.drawImage(sky, 0, 0, W, sky.height / dpr);
    const hill = clamp((playerY - track.y[(base + 60) % N]) / 60, -30, 30);
    for (const [L, par, hh] of [[far, 0.25, Math.min(110, HY * 0.45)], [near, 0.6, Math.min(70, HY * 0.3)]]) {
      const tw = 1024 * hh / L.height, ox = -(((bgX * par * W) % tw) + tw) % tw;
      for (let x = ox; x < W; x += tw) g.drawImage(L, x, HY - hh + 2 + hill * par, tw + 1, hh);
    }
    g.fillStyle = PAL[FL - 1].grassA; g.fillRect(0, HY + hill * 0.6, W, H);
    // pass 1, near to far: project each segment and find which can be seen over the hills
    let x = 0, dx = -track.curve[base % N] * pct, maxy = H;
    for (let n = 0; n <= DD; n++) {
      const abs = base + n, i = abs % N, z1 = abs * SEG - d, z2 = z1 + SEG;
      const cx1 = x - camX, cx2 = x + dx - camX;
      x += dx; dx += track.curve[i];
      VIS[n] = 0; if (z1 <= 40) { X1[n] = X2[n] = W / 2; continue; }
      const s1 = CD / z1, s2 = CD / z2;
      S1[n] = s1; X1[n] = W / 2 + s1 * cx1 * K; Y1[n] = HY - s1 * (track.y[i] - camY) * K; W1[n] = s1 * ROADW * K;
      X2[n] = W / 2 + s2 * cx2 * K; Y2[n] = HY - s2 * (track.y[i + 1] - camY) * K; W2[n] = s2 * ROADW * K;
      if (Y2[n] < Y1[n] && Y2[n] < maxy) { VIS[n] = 1; maxy = Y2[n]; }
      else if (Y1[n] < maxy) VIS[n] = 2;   // turned away from us, but its sprites can still be seen
    }
    // cars into the segments they are on
    for (let n = 0; n <= DD; n++) buckets[n].length = 0;
    if (!sim.inPit) for (const c of sim.cars) {   // in the pit lane the rivals are out of sight
      const rel = wrapLap(c.lead) * LAP; if (rel < -4 || rel > DD - 3) continue;
      const z = PZ + rel * SEG; if (z < 260) continue;
      const n = Math.floor((d + z) / SEG) - base; if (n < 1 || n > DD) continue;
      buckets[n].push({ c: c, z: z, f: (d + z) / SEG - base - n });
    }
    // pass 2, far to near
    const red = sim.mode === 'red', pit = sim.pit;
    if (pit !== pitSeen) { pitSeen = pit; pitFade = RM ? 1 : 0; } pitFade = Math.min(1, pitFade + dt * 2);   // the garages fade in as the car turns in; the trees there fade out
    for (let n = DD; n >= 1; n--) {
      const vis = VIS[n]; if (!vis) continue;
      const abs = base + n, i = abs % N, P = PAL[Math.min(FL - 1, Math.floor(Math.pow(n / DD, 1.6) * FL))], fa = 1 - 0.75 * Math.pow(n / DD, 2);
      if (vis === 1) drawSegment(n, abs, P);
      const sc = SCN[i], inPit = pit && abs >= pit.a && abs <= pit.m0, nearLane = pit && abs >= pit.a && abs <= pit.m1;   // the garage side, and the lane's whole length
      if (inPit && abs >= pit.a + RP.IN + 4 && abs + 1 <= pit.m0 && Math.abs(abs - pit.boxSeg) <= 63 && (abs - pit.boxSeg) % 9 === 0)
        sprite(abs === pit.boxSeg ? OURS : GARAGES[((abs / 9) | 0) % GARAGES.length], n, 3.15, 3000, fa * pitFade);
      for (let j = 0; j < sc.length; j++) { const o = sc[j]; const gone = o.x > 0 && (inPit || (nearLane && o.x < 2.6)); if (gone && pitFade >= 1) continue; sprite(o.k === 'tree' ? TREES[o.v] : o.k === 'stand' ? STAND : BOARDS[o.t], n, o.x, o.w, gone ? fa * (1 - pitFade) : fa); }   // nothing stands in the pit lane
      if (i === START + 1) gantry(n);
      const b = buckets[n]; if (b.length > 1) b.sort((p, q) => q.z - p.z);
      for (const o of b) car(SPR.cars[o.c.i], n, o.f, o.z, o.c.x, fa, red && (Math.floor(clock * 2.5) & 1));
    }
    // the player's car; its rain light flashes under the red flag
    const cw = 760 * (CD / PZ) * K, ch = cw * 140 / 256, moving = sim.v > 1500;
    const bounce = moving && !RM ? Math.sin(clock * 37) * 0.7 + (Math.random() - 0.5) * 0.8 : 0;
    const tilt = clamp((sim.tx - sim.x) * 0.12 + track.curve[pi] * 0.004, -0.06, 0.06);
    g.save(); g.translate(W / 2, GY + bounce); g.rotate(tilt);
    g.drawImage(sim.drs ? SPR.youDrs : SPR.you, -cw / 2, -ch, cw, ch);
    if (sim.limiter ? (Math.floor(clock * 5) & 1) : red && (Math.floor(clock * 2.5) & 1)) rainLight(0, 0, cw);
    g.restore();
    // sparks from the plank
    if (sparks.length) { g.globalCompositeOperation = 'lighter'; g.lineWidth = 2; g.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t += dt; if (p.t >= p.life) { sparks.splice(i, 1); continue; }
        const sx = W / 2 + p.x * cw + p.vx * p.t, sy = GY - ch * 0.1 + p.vy * p.t, k = 1 - p.t / p.life;
        g.strokeStyle = 'rgba(255,' + Math.round(150 + 80 * k) + ',90,' + k.toFixed(2) + ')'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - p.vx * 0.03, sy - p.vy * 0.03); g.stroke(); }
      g.globalCompositeOperation = 'source-over'; g.lineCap = 'butt'; }
    if (red) flag('red', 1);
    else if (flagT >= 0) { flagT += dt; if (flagT > 6) flagT = -1; else flag('chequered', Math.min(1, flagT * 3, (6 - flagT) * 2)); }
    for (let i = confetti.length - 1; i >= 0; i--) { const p = confetti[i]; p.t += dt; if (p.t >= p.life || p.y > H) { confetti.splice(i, 1); continue; }
      p.x += (p.vx + Math.sin(clock * 3 + i) * 30) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-3, -2, 6, 4); g.restore(); }
    wheelPanel(minute);
  }
  function reset() { sparks.length = 0; confetti.length = 0; flagT = -1; shake = 0; }
  buildSprites();
  return { resize: resize, draw: draw, event: event, reset: reset, rebuild: buildSprites };
}

