/* Coins theme renderer: an arcade coin pusher seen from the front, a little above. Gold coins, each stamped with the note that
   dropped it, on a teal shelf; a chrome plate slides in and out at the back; won coins fall over the front edge into the tray.
   Everything about the machine (where each coin is, the plate, what is won) comes from CoinSim in the core; this only draws it. */
/* exported makeCoinView */   // used by src/app.js, which the build puts after this file
function makeCoinView(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d'), reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = MT.COIN.D, DROP = MT.COIN.DROP, AIR = MT.COIN.AIR, TAU = Math.PI * 2;
  let W = 0, H = 0, dpr = 1, top = 0, clock = 0, flash = 0, beat = 0, glow = 0;
  let cx = 0, sb = 0, sf = 0, Wf = 0, sq = 0.5, trayB = 0, slotY = 0, sizeAt = 0;
  const sparks = [], sprites = new Map();

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    // the machine: a back wall with the coin slot, the shelf, then the tray. The shelf is as wide as fits, seen from 0.42 (flat) to 0.85 (from above)
    sf = Math.round(h - Math.max(44, Math.min(130, (h - top) * 0.2))); trayB = h - 6;
    const room = Math.max(10, sf - top - 34);                             // 34: the bulbs and the slot
    Wf = Math.min(w - 28, 620, room / (D * 0.9 * 0.42));
    const shelfH = Math.min(room, D * Wf * 0.9 * 0.85); sb = sf - shelfH; sq = shelfH / (D * Wf * 0.9);
    cx = w / 2; slotY = top + Math.min(18, (sb - top) * 0.3);
    if (sizeAt !== Wf * dpr) { sizeAt = Wf * dpr; sprites.clear(); }      // coin faces are drawn once per size
    return true;
  }
  function reset() { sparks.length = 0; flash = 0; beat = 0; }
  // shelf (x 0..1 across, y 0..D back to front) to screen
  const sc = y => 0.8 + 0.2 * y / D, X = (x, y) => cx + (x - 0.5) * Wf * sc(y), Y = y => sb + (sf - sb) * y / D;

  /* a coin's face, drawn flat once and squashed into place: gold with a raised rim and the note in the middle; a medal is larger,
     with a red ring and the minute it was earned */
  function face(c) {
    const key = c.medal ? 'm' + c.medal : c.plain ? '*' : c.note || '\u266A'; let s = sprites.get(key); if (s) return s;
    const R = Math.ceil(c.r * Wf * dpr), n = R * 2 + 4; s = document.createElement('canvas'); s.width = s.height = n;
    const q = s.getContext('2d'), m = n / 2, gr = q.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.1, m, m, R * 1.1);
    gr.addColorStop(0, '#FFF6C2'); gr.addColorStop(0.45, '#FFCC3E'); gr.addColorStop(1, '#D98E0B');
    q.beginPath(); q.arc(m, m, R, 0, TAU); q.fillStyle = gr; q.fill();
    q.lineWidth = Math.max(1, R * 0.09); q.strokeStyle = c.medal ? '#D23B2A' : '#B57A0C'; q.beginPath(); q.arc(m, m, R * (c.medal ? 0.8 : 0.82), 0, TAU); q.stroke();
    if (c.medal) { q.lineWidth = Math.max(1, R * 0.05); q.strokeStyle = '#B57A0C'; q.beginPath(); q.arc(m, m, R * 0.68, 0, TAU); q.stroke(); }
    q.textAlign = 'center'; q.textBaseline = 'middle';
    const ink = (txt, size, y) => { q.font = '800 ' + Math.round(size) + 'px Inter, system-ui, -apple-system, sans-serif';
      q.fillStyle = 'rgba(255,248,214,.85)'; q.fillText(txt, m - size * 0.04, y - size * 0.05); q.fillStyle = '#7A4A00'; q.fillText(txt, m, y); };
    if (c.medal) { ink(String(c.medal), R * (c.medal > 99 ? 0.6 : 0.8), m - R * 0.1); ink('min', R * 0.3, m + R * 0.45); }
    else if (c.plain) { q.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.22 : R * 0.5; q.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); }
      q.closePath(); q.fillStyle = 'rgba(160,100,8,.55)'; q.fill(); }
    else ink(key, R * (key.length > 1 ? 0.92 : 1.1), m + R * 0.06);
    sprites.set(key, s); return s;
  }
  /* a coin lying at screen (x, y): its edge, then the face on top. k flattens it (1: seen from straight ahead, sq: lying on the shelf) */
  function coin(c, x, y, s, k, rot) {
    const rx = c.r * Wf * s, ry = rx * k, th = rx * 0.16 * Math.max(0, Math.min(1, (1 - k) / (1 - sq)));   // the edge shows less the more it faces you
    g.save(); g.translate(x, y); if (rot) g.rotate(rot);
    g.fillStyle = c.medal ? '#9A2E1E' : '#9A660A'; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI); g.lineTo(-rx, -th); g.ellipse(0, -th, rx, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
    g.drawImage(face(c), -rx, -th - ry, rx * 2, ry * 2);
    g.restore();
  }
  function bulbs(y, x0, x1, n) {
    const step = (x1 - x0) / (n - 1), on = Math.floor(clock * 7), r = Math.max(2, Math.min(4.5, step * 0.22));
    for (let i = 0; i < n; i++) { const lit = reduceMotion ? i % 2 === 0 : (i + on) % 3 === 0 || flash > 0.3, x = x0 + i * step;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = lit ? '#FFF0A8' : 'rgba(255,214,120,.28)'; g.fill();
      if (lit) { g.beginPath(); g.arc(x, y, r * 2.4, 0, TAU); g.fillStyle = 'rgba(255,200,80,' + (0.12 + glow * 0.18) + ')'; g.fill(); } }
  }
  function event(e) {
    if (e.k === 'land') { beat = 1; const c = e.c, x = X(c.x, c.y), y = Y(c.y);
      if (!reduceMotion) for (let i = 0; i < 4; i++) sparks.push({ x: x, y: y, vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 50, t: 0, life: 0.35, c: '#FFE58A' }); }
    if (e.k === 'won' && !reduceMotion) { const c = e.c, x = X(c.x, D);
      for (let i = 0; i < 6; i++) sparks.push({ x: x + (Math.random() - 0.5) * 10, y: sf, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 80, t: 0, life: 0.5, c: i % 2 ? '#FFFFFF' : '#FFD54A' }); }
    if (e.k === 'medal') flash = reduceMotion ? 0 : 1;
    if (sparks.length > 120) sparks.splice(0, sparks.length - 120);
  }

  /* v: {running, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    clock += dt; beat = Math.max(0, beat - dt * 3); flash = Math.max(0, flash - dt * 1.2);
    glow = Math.min(1, beat * 0.5 + flash + (v.music ? v.level * 0.6 : 0));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the cabinet
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2A0C30'); bg.addColorStop(1, '#14051A'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const fl = cx - Wf / 2, fr = cx + Wf / 2, bl = X(0, 0), br = X(1, 0);
    // back wall, with a row of bulbs and the slot coins come out of
    const wt = top + 4, wg = g.createLinearGradient(0, wt, 0, sb); wg.addColorStop(0, '#6A1830'); wg.addColorStop(1, '#2E0A18');
    g.fillStyle = wg; g.beginPath(); g.moveTo(bl - 6, wt); g.lineTo(br + 6, wt); g.lineTo(br, sb); g.lineTo(bl, sb); g.closePath(); g.fill();
    g.fillStyle = '#0A0206'; g.fillRect(bl + 10, slotY - 3, br - bl - 20, 6);
    if (sb - wt > 40) bulbs(wt + 9, bl + 4, br - 4, Math.max(8, Math.round((br - bl) / 22)));
    const ph = Math.max(6, Wf * 0.035), wb = sb - ph;                      // ph: the plate's height; wb: where it hides the wall
    if (sim.last && wb - slotY > 34) {                                       // the last note played, lit up on the back wall
      const fs = Math.min(26, (wb - slotY) * 0.42); g.font = '800 ' + Math.round(fs) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,214,90,' + (0.35 + glow * 0.6) + ')'; g.fillText(sim.last, cx, (slotY + wb) / 2 + 2); }
    // the shelf
    const sg = g.createLinearGradient(0, sb, 0, sf); sg.addColorStop(0, '#0B3A48'); sg.addColorStop(1, '#17707F');
    g.fillStyle = sg; g.beginPath(); g.moveTo(bl, sb); g.lineTo(br, sb); g.lineTo(fr, sf); g.lineTo(fl, sf); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(160,240,255,.08)'; g.lineWidth = 1; g.beginPath();
    for (let i = 1; i < 6; i++) { const y = D * i / 6; g.moveTo(X(0, y), Y(y)); g.lineTo(X(1, y), Y(y)); }
    for (let i = 1; i < 8; i++) { g.moveTo(X(i / 8, 0), Y(0)); g.lineTo(X(i / 8, D), Y(D)); } g.stroke();
    // the plate: its top from the back wall to where it has slid out, and its chrome front
    const p = sim.push;
    g.fillStyle = '#5E6874'; g.beginPath(); g.moveTo(X(0, 0), Y(0) - ph); g.lineTo(X(1, 0), Y(0) - ph); g.lineTo(X(1, p), Y(p) - ph); g.lineTo(X(0, p), Y(p) - ph); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); for (let i = 1; i < 4; i++) { const y = p * i / 4; g.moveTo(X(0, y), Y(y) - ph); g.lineTo(X(1, y), Y(y) - ph); } g.stroke();
    const pg = g.createLinearGradient(0, Y(p) - ph, 0, Y(p)); pg.addColorStop(0, '#F2F6FA'); pg.addColorStop(0.5, '#A9B4BF'); pg.addColorStop(1, '#6D7782');
    g.fillStyle = pg; g.fillRect(X(0, p), Y(p) - ph, X(1, p) - X(0, p), ph);
    // coins on the shelf, back to front
    const cs = sim.coins.slice().sort((a, b) => a.y - b.y);
    for (const c of cs) coin(c, X(c.x, c.y), Y(c.y), sc(c.y), sq, 0);
    // chrome rails on both sides, and the front edge
    g.strokeStyle = '#C9D3DC'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(bl, sb - ph); g.lineTo(fl, sf - 3); g.moveTo(br, sb - ph); g.lineTo(fr, sf - 3); g.stroke(); g.lineCap = 'butt';
    const eg = g.createLinearGradient(0, sf, 0, sf + 7); eg.addColorStop(0, '#FFFFFF'); eg.addColorStop(1, '#7D8A96'); g.fillStyle = eg; g.fillRect(fl - 2, sf, Wf + 4, 7);
    // the tray, with the latest coins won heaped in it
    const tt = sf + 14, tl = fl + 6, tw = Wf - 12;
    if (trayB - tt > 12) {
      g.fillStyle = '#0C0310'; g.beginPath(); if (g.roundRect) g.roundRect(tl, tt, tw, trayB - tt, 10); else g.rect(tl, tt, tw, trayB - tt); g.fill();
      g.save(); g.beginPath(); g.rect(tl, tt, tw, trayB - tt); g.clip();
      const tr = sim.tray, n = tr.length, k = sq * 0.85, base = sim.won - n;
      for (let i = 0; i < n; i++) { const id = base + i, a = Math.sin(id * 12.9898) * 43758.5453, b = Math.sin(id * 78.233) * 12345.678, fx = a - Math.floor(a), fy = b - Math.floor(b);
        const s = 0.82, rx = tr[i].r * Wf * s; coin(tr[i], tl + rx + fx * (tw - 2 * rx), trayB - 4 - rx * k - fy * Math.max(0, trayB - tt - rx * 2.4) * 0.7, s, k, 0); }
      g.restore();
    }
    // won coins tumbling over the edge into the tray
    for (const f of sim.falling) { const c = f.c, t = f.t / AIR, x = X(c.x, D), y = sf + 4 + (trayB - sf - 10) * t * t;
      coin(c, x, y, 1, sq + (1 - sq) * Math.abs(Math.sin(t * 5)), reduceMotion ? 0 : (c.x < 0.5 ? -1 : 1) * t * 2); }
    // coins dropping from the slot, nearly face on so their notes can be read, with a shadow where they will land
    for (const c of sim.air) { const k = Math.min(1, c.z / DROP), gx = X(c.x, c.y), gy = Y(c.y), s = sc(c.y);
      g.globalAlpha = 0.35 * (1 - k); g.fillStyle = '#000'; g.beginPath(); g.ellipse(gx, gy, c.r * Wf * s, c.r * Wf * s * sq, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
      coin(c, gx, gy - k * (gy - slotY), s, sq + (1 - sq) * k * (reduceMotion ? 1 : 0.8 + 0.2 * Math.cos(c.spin)), 0); }
    // sparkles
    for (let i = sparks.length - 1; i >= 0; i--) { const b = sparks[i]; b.t += dt; if (b.t >= b.life) { sparks.splice(i, 1); continue; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 260 * dt; g.globalAlpha = 1 - b.t / b.life; g.fillStyle = b.c; g.fillRect(b.x - 1.5, b.y - 1.5, 3, 3); }
    g.globalAlpha = 1;
    if (flash > 0.6) { g.globalAlpha = (flash - 0.6) * 0.6; g.fillStyle = '#FFE9A0'; g.fillRect(0, top, W, H - top); g.globalAlpha = 1; }
  }
  return { resize: resize, draw: draw, event: event, reset: reset };
}
