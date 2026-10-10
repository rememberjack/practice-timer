/* Dash theme renderer: a neon runner in the spirit of rhythm platformers, with its own original shapes and colours.
   Everything about the run (the course, position, jumps, pads, orbs, crashes, attempts) comes from DashSim in the core; this only draws it. */
function makeDashView(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d'), reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GRACE = MT.DASH.GRACE, TAU = Math.PI * 2, SPEED_COL = { '\u00BD\u00D7': '#FFB347', '1\u00D7': '#2DE2FF', '2\u00D7': '#7CFF4F', '3\u00D7': '#FF5BD1' };
  let W = 0, H = 0, dpr = 1, top = 0, clock = 0, flash = 0, pulse = 0, beat = 0, hue = 222, camY = 0, speedT = 0, gone = null, glow = 0, U = 30;
  const shards = [], bits = [], rings = [], trail = [], fades = [], born = new WeakMap(), lit = new WeakMap();

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    return true;
  }
  function reset() { shards.length = 0; bits.length = 0; rings.length = 0; trail.length = 0; fades.length = 0; flash = 0; pulse = 0; beat = 0; camY = 0; speedT = 0; gone = null; }
  const ring = (y, c, r1, life) => { if (!reduceMotion) rings.push({ x: sim.x, y: y, t: 0, life: life || 0.45, r1: r1, c: c }); };   // in course units, so it stays where it went off
  function event(e, geo) {
    if (e === 'jump') pulse = Math.max(pulse, 0.6);
    if (e === 'note') beat = 1;
    if (e === 'speed') speedT = 1;
    if (e === 'pad') { pulse = 1; ring(sim.y + 0.15, '#FFE14D', 1.5); for (let i = 0; i < 8; i++) bits.push({ x: geo.cx + (Math.random() - 0.5) * geo.U * 0.8, y: geo.gy - 2, vx: (Math.random() - 0.5) * 50, vy: -120 - Math.random() * 140, t: 0, life: 0.5, s: 3, c: '#FFE14D' }); }
    if (e === 'orb') { pulse = 1; ring(sim.y + 0.5, '#FFE14D', 1.3); ring(sim.y + 0.5, '#FFFFFF', 0.9, 0.3); }
    if (e === 'saved') ring(sim.y + 0.5, '#7CFF4F', 1.8, 0.6);
    if (e === 'land' && geo) for (let i = 0; i < 4; i++) bits.push({ x: geo.cx + (Math.random() - 0.5) * geo.U * 0.6, y: geo.gy - 2, vx: (Math.random() - 0.7) * 60, vy: -30 - Math.random() * 50, t: 0, life: 0.35, s: 3 });
    if (e === 'crash' && geo) { flash = reduceMotion ? 0 : 0.8;
      for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, sp = 90 + Math.random() * 260;
        shards.push({ x: geo.cx, y: geo.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, t: 0, life: 0.9, s: geo.U * (0.18 + Math.random() * 0.2), c: i % 3 ? '#2DE2FF' : '#FFE14D', floor: geo.gy }); } }
    if (e === 'complete' && geo) { flash = reduceMotion ? 0 : 0.5;
      for (let i = 0; i < 40; i++) bits.push({ x: geo.cx + (Math.random() - 0.3) * W * 0.6, y: geo.gy - Math.random() * geo.U * 5, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 160, t: 0, life: 1.2 + Math.random(), s: 4, c: ['#7CFF4F', '#FFE14D', '#2DE2FF', '#FF5BD1'][i % 4] }); }
  }
  const hsl = (h, s, l, a) => 'hsla(' + (((h % 360) + 360) % 360).toFixed(0) + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  function rrect(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

  /* the pieces of course, drawn at screen position x (left edge) and y (ground under the piece, in pixels) */
  function block(o, x, y) {
    const w = o.w * U, h = o.h * U, yt = y - o.y * U - h;
    g.fillStyle = hsl(hue, 70, 6); g.fillRect(x, yt, w, h);
    g.save(); g.beginPath(); g.rect(x, yt, w, h); g.clip(); g.beginPath();                   // a grid of tiles, brighter with the music
    for (let i = 1; i < o.w; i++) { const X = Math.round(x + i * U) + 0.5; g.moveTo(X, yt); g.lineTo(X, yt + h); }
    for (let j = 1; j < o.h; j++) { const Y = Math.round(yt + j * U) + 0.5; g.moveTo(x, Y); g.lineTo(x + w, Y); }
    g.strokeStyle = hsl(hue, 90, 65, 0.16 + glow * 0.22); g.lineWidth = 1; g.stroke(); g.restore();
    if (h > U * 0.6) { g.strokeStyle = hsl(hue, 100, 70, 0.5 + glow * 0.3); g.lineWidth = 2; g.strokeRect(x + U * 0.2, yt + U * 0.2, w - U * 0.4, h - U * 0.4); }
    g.lineWidth = 2; g.strokeStyle = '#FFFFFF'; g.strokeRect(x + 1, yt + 1, w - 2, h - 2);
    g.fillStyle = hsl(hue, 100, 80, 0.5 + glow * 0.5); g.fillRect(x + 2, yt + 2, w - 4, 2);   // a lit top edge to land on
  }
  function spikes(o, x, y) {
    const hot = o.danger && sim.silentT > 0; let k = 1;
    if (o.danger) { if (!born.has(o)) born.set(o, clock); k = reduceMotion ? 1 : 1 - Math.pow(1 - Math.min(1, (clock - born.get(o)) / 0.3), 3); }   // the warning spike rises out of the floor
    const base = y - (o.down ? o.y + o.h : o.y) * U, tip = (o.down ? 1 : -1) * o.h * U * k;
    const edge = hot && Math.sin(clock * 14) > 0 ? '#FF5B5B' : '#FFFFFF', inner = hot ? '#FF7B6B' : hsl(hue, 100, 72, 0.55 + glow * 0.4);
    g.lineWidth = 2; g.lineJoin = 'round'; g.fillStyle = hot ? '#3A0A12' : '#07071A';
    for (let i = 0; i < o.w; i++) { const l = x + i * U, m = l + U / 2;
      g.beginPath(); g.moveTo(l + 1, base); g.lineTo(m, base + tip); g.lineTo(l + U - 1, base); g.closePath(); g.fill(); g.strokeStyle = edge; g.stroke();
      if (o.h > 0.7) { g.beginPath(); g.moveTo(m - U * 0.17, base + tip * 0.12); g.lineTo(m, base + tip * 0.62); g.lineTo(m + U * 0.17, base + tip * 0.12); g.strokeStyle = inner; g.stroke(); } }   // an inner chevron catches the light
  }
  function saw(o, x, y) {
    const R = o.w / 2 * U, X = x + R, Y = y - (o.y + o.w / 2) * U, n = 12, a0 = reduceMotion ? 0 : -clock * 7;
    g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = a0 + i * Math.PI / n, r = i % 2 ? R * 0.8 : R; if (i) g.lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); else g.moveTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = '#07071A'; g.fill(); g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = '#FFFFFF'; g.stroke();
    g.beginPath(); g.arc(X, Y, R * 0.55, 0, TAU); g.strokeStyle = hsl(hue, 100, 70, 0.6 + glow * 0.4); g.stroke();
    g.beginPath(); for (let i = 0; i < 3; i++) { const a = a0 * 1.5 + i * TAU / 3; g.moveTo(X, Y); g.lineTo(X + Math.cos(a) * R * 0.5, Y + Math.sin(a) * R * 0.5); } g.stroke();
    g.beginPath(); g.arc(X, Y, R * 0.14, 0, TAU); g.fillStyle = '#FFFFFF'; g.fill();
  }
  function pad(o, x, y) {
    if (o.hit && !lit.has(o)) lit.set(o, clock);
    const X = x + U / 2, Y = y - o.y * U, f = lit.has(o) ? Math.max(0, 1 - (clock - lit.get(o)) / 0.4) : 0;
    if (!reduceMotion && Math.random() < 0.1) bits.push({ x: X + (Math.random() - 0.5) * U * 0.7, y: Y - 3, vx: 0, vy: -50 - Math.random() * 40, t: 0, life: 0.45, s: 2, c: '#FFE14D', gr: 0 });
    g.save(); g.shadowColor = '#FFE14D'; g.shadowBlur = reduceMotion ? 0 : U * (0.4 + f); g.beginPath(); g.ellipse(X, Y, U * 0.46, U * (0.3 + f * 0.15), 0, Math.PI, TAU); g.closePath();
    g.fillStyle = f > 0 ? '#FFF6B8' : '#FFE14D'; g.fill(); g.restore(); g.lineWidth = 2; g.strokeStyle = '#05051A'; g.stroke();
  }
  function orb(o, x, y) {
    if (o.hit && !lit.has(o)) lit.set(o, clock);
    const X = x + U / 2, Y = y - (o.y + 0.5) * U, used = lit.has(o), r = U * 0.34 * (1 + (reduceMotion ? 0 : 0.07 * Math.sin(clock * 6)) + beat * 0.1);
    g.save(); if (used) g.globalAlpha = 0.45;
    g.setLineDash([U * 0.16, U * 0.11]); g.lineDashOffset = reduceMotion ? 0 : -clock * U * 0.8; g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.75)';
    g.beginPath(); g.arc(X, Y, U * 0.56, 0, TAU); g.stroke(); g.setLineDash([]);
    g.shadowColor = '#FFE14D'; g.shadowBlur = reduceMotion ? 0 : U * 0.5; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fillStyle = '#FFE14D'; g.fill(); g.shadowBlur = 0;
    g.lineWidth = Math.max(2, U * 0.07); g.strokeStyle = '#05051A'; g.stroke(); g.beginPath(); g.arc(X, Y, r * 0.42, 0, TAU); g.fillStyle = '#FFFFFF'; g.fill();
    g.restore();
  }
  const DRAW = { block: block, spike: spikes, saw: saw, pad: pad, orb: orb };

  /* v: {running, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return null;
    clock += dt;
    const free = H - top, gy0 = Math.round(top + free * 0.74), a = sim.arc;
    U = Math.max(18, Math.min(W >= 700 ? 60 : 46, free / 8.5));   // a larger course on a tablet, the same on a phone
    // the camera climbs with the cube on high ground, and keeps it clear of the read-outs on the biggest leaps
    camY += (Math.max(0, (a ? Math.min(sim.y, a.y1) : sim.y) - 1.2) - camY) * Math.min(1, dt * 3);
    camY = Math.max(camY, sim.y - ((gy0 - top) / U - 1.8));
    const gy = gy0 + camY * U, cx = Math.round(Math.min(W * 0.28, U * 5)), cy = gy - sim.y * U - U / 2;
    const geo = { U: U, gy: gy - sim.y * U, cx: cx, cy: cy }, sx = wx => cx + (wx - sim.x) * U;
    // colours drift through the level: blue, violet, pink, orange, and green once the goal is reached
    const want = sim.done ? 150 : 222 + Math.min(1, Math.max(0, sim.progress)) * 165;
    hue += (want - hue) * Math.min(1, dt * 1.5);
    pulse = Math.max(0, pulse - dt * 2.4); beat = Math.max(0, beat - dt * 3); speedT = Math.max(0, speedT - dt * 1.2);
    glow = Math.min(1, pulse + beat * 0.3 + (v.music ? v.level * 0.5 : 0));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, gy); bg.addColorStop(0, hsl(hue, 78, 13 + glow * 5)); bg.addColorStop(1, hsl(hue, 85, 34 + glow * 8));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // far squares drifting by, for depth; they rise and fall a little with the camera, and swell on each note
    for (let layer = 0; layer < 2; layer++) { const par = layer ? 0.42 : 0.18, size = U * (layer ? 2.2 : 3.6) * (1 + beat * 0.06), gap = U * (layer ? 2.2 : 3.6) * 2.3, off = (sim.x * U * par) % gap, fy = gy0 + camY * U * par;
      g.fillStyle = hsl(hue, 90, 60, layer ? 0.10 : 0.07);
      for (let x = -off - size; x < W + size; x += gap) { const k = Math.round((x + off) / gap), yy = fy - size * (1.25 + ((k * 37 + layer * 11) % 5) * 0.42); g.fillRect(Math.round(x), Math.round(yy), size, size); } }
    // ground
    g.fillStyle = hsl(hue, 80, 9); g.fillRect(0, gy, W, H - gy);
    g.fillStyle = hsl(hue, 90, 60, 0.16); const goff = (sim.x * U) % (U * 2); for (let x = -goff; x < W; x += U * 2) g.fillRect(Math.round(x), gy + 6, 2, H - gy);
    g.fillStyle = '#FFFFFF'; g.fillRect(0, gy - 1, W, 3); g.fillStyle = hsl(hue, 100, 70, 0.35 + beat * 0.3); g.fillRect(0, gy + 2, W, 5);
    // checkpoints left by pauses
    for (const m of sim.marks) { const x = sx(m.x); if (x < -U || x > W + U) continue; g.save(); g.translate(x, gy - (m.y + 1.5) * U); g.rotate(Math.PI / 4); g.fillStyle = '#7CFF4F'; g.strokeStyle = '#06210A'; g.lineWidth = 2; g.fillRect(-U * 0.24, -U * 0.24, U * 0.48, U * 0.48); g.strokeRect(-U * 0.24, -U * 0.24, U * 0.48, U * 0.48); g.restore(); }
    // the attempt number stands in the level where each run begins, centred on the screen until the cube sets off
    { const x = sx(sim.respawnX) + W / 2 - cx; if (x > -W && x < W * 1.6) { g.font = '800 ' + Math.round(U * 0.86) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      g.lineWidth = Math.max(3, U * 0.14); g.strokeStyle = 'rgba(5,5,26,.9)'; g.fillStyle = '#FFFFFF'; const txt = 'Attempt ' + sim.attempts, ty = gy - (sim.respawnY + 3.4) * U; g.strokeText(txt, x, ty); g.fillText(txt, x, ty); } }
    // the course: blocks first, then what stands on them; nothing shows below the ground (saws are half buried)
    if (sim.vanished !== gone) { gone = sim.vanished; for (const o of gone) fades.push({ o: o, t: 0 }); if (fades.length > 60) fades.splice(0, fades.length - 60); }
    g.save(); g.beginPath(); g.rect(0, 0, W, gy); g.clip();
    for (let pass = 0; pass < 2; pass++) for (const o of sim.obs) { if ((o.kind === 'block') !== !pass) continue; const x = sx(o.x); if (x > W + U || x + o.w * U < -U) continue; DRAW[o.kind](o, x, gy); }
    for (let i = fades.length - 1; i >= 0; i--) { const f = fades[i]; f.t += dt; if (f.t >= 0.3 || reduceMotion) { fades.splice(i, 1); continue; }   // cleared pieces sink away
      const o = f.o, x = sx(o.x); if (x > W + U || x + o.w * U < -U) continue; const k = 1 - f.t / 0.3, px = x + o.w * U / 2, py = gy - (o.y + o.h / 2) * U;
      g.save(); g.globalAlpha = k; g.translate(px, py); g.scale(k, k); g.translate(-px, -py); DRAW[o.kind](o, x, gy); g.restore(); }
    g.restore();
    // rings from pads, orbs and narrow escapes
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; if (r.t >= r.life) { rings.splice(i, 1); continue; } const k = r.t / r.life;
      g.globalAlpha = 1 - k; g.lineWidth = Math.max(2, U * 0.12 * (1 - k)); g.strokeStyle = r.c; g.beginPath(); g.arc(sx(r.x), gy - r.y * U, U * (0.3 + r.r1 * k), 0, TAU); g.stroke(); }
    g.globalAlpha = 1;
    // dust, sparks
    for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.t += dt; if (b.t >= b.life) { bits.splice(i, 1); continue; } b.x += b.vx * dt; b.y += b.vy * dt; b.vy += (b.gr == null ? 320 : b.gr) * dt; g.globalAlpha = 1 - b.t / b.life; g.fillStyle = b.c || '#FFFFFF'; g.fillRect(b.x, b.y, b.s, b.s); }
    g.globalAlpha = 1;
    // a streak behind the cube while a pad or orb throws it
    if (sim.mode === 'run' && a && (a.kind === 'pad' || a.kind === 'orb') && !reduceMotion) trail.push({ x: sim.x, y: sim.y }); else if (trail.length) trail.shift();
    if (trail.length > 16) trail.shift();
    for (let i = 0; i < trail.length; i++) { const p = trail[i], k = (i + 1) / trail.length, s = U * (0.25 + 0.55 * k); g.globalAlpha = 0.4 * k; g.fillStyle = i % 2 ? '#FFE14D' : '#2DE2FF'; g.fillRect(sx(p.x) - s / 2, gy - p.y * U - U / 2 - s / 2, s, s); }
    g.globalAlpha = 1;
    // the cube: an original two-tone block with a diamond core
    if (sim.mode !== 'crash') {
      if (sim.mode === 'run' && !a && sim.v > 2 && !reduceMotion && Math.random() < dt * 30) bits.push({ x: cx - U * 0.5, y: cy + U / 2 - 4, vx: -40 - Math.random() * 50, vy: -10 - Math.random() * 30, t: 0, life: 0.4, s: 3, c: '#2DE2FF' });
      if (speedT > 0) { g.strokeStyle = SPEED_COL[sim.tag] || '#2DE2FF'; g.lineWidth = Math.max(3, U * 0.12); g.lineJoin = 'round'; g.lineCap = 'round';   // chevrons when the speed changes
        for (let i = 0; i < 3; i++) { const x = cx - U * (1.1 + i * 0.5 + (1 - speedT) * 0.6); g.globalAlpha = speedT * (1 - i * 0.25); g.beginPath(); g.moveTo(x - U * 0.18, cy - U * 0.32); g.lineTo(x + U * 0.12, cy); g.lineTo(x - U * 0.18, cy + U * 0.32); g.stroke(); }
        g.globalAlpha = 1; g.lineCap = 'butt'; }
      const waiting = sim.mode === 'wait' || sim.mode === 'idle', quiet = sim.mode === 'run' && sim.silentT > 0;
      g.save(); g.translate(cx, cy); g.rotate(sim.ang); g.globalAlpha = waiting ? 0.75 + 0.25 * Math.sin(clock * 5) : 1;
      g.shadowColor = quiet ? '#FF5B5B' : '#2DE2FF'; g.shadowBlur = reduceMotion ? 0 : U * (0.35 + glow * 0.5);
      g.fillStyle = quiet ? '#8AA0B4' : '#2DE2FF'; rrect(-U / 2, -U / 2, U, U, U * 0.14); g.fill(); g.shadowBlur = 0;
      g.lineWidth = Math.max(2, U * 0.09); g.strokeStyle = '#05051A'; rrect(-U / 2, -U / 2, U, U, U * 0.14); g.stroke();
      g.rotate(Math.PI / 4); g.fillStyle = '#FFE14D'; g.fillRect(-U * 0.2, -U * 0.2, U * 0.4, U * 0.4); g.strokeRect(-U * 0.2, -U * 0.2, U * 0.4, U * 0.4);
      g.restore(); g.globalAlpha = 1;
      if (quiet) { g.font = '800 ' + Math.round(U * 0.7) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineWidth = 4; g.strokeStyle = 'rgba(5,5,26,.9)'; g.fillStyle = '#FF7B6B';
        const n = String(Math.max(1, Math.ceil(GRACE - sim.silentT))); g.strokeText(n, cx, cy - U * 0.95); g.fillText(n, cx, cy - U * 0.95); }
    }
    for (let i = shards.length - 1; i >= 0; i--) { const s = shards[i]; s.t += dt; if (s.t >= s.life) { shards.splice(i, 1); continue; } s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 620 * dt; s.r += s.vr * dt; if (s.y > s.floor - s.s / 2) { s.y = s.floor - s.s / 2; s.vy *= -0.4; s.vx *= 0.7; }
      g.save(); g.translate(s.x, s.y); g.rotate(s.r); g.globalAlpha = 1 - s.t / s.life; g.fillStyle = s.c; g.fillRect(-s.s / 2, -s.s / 2, s.s, s.s); g.restore(); }
    g.globalAlpha = 1;
    if (flash > 0) { g.globalAlpha = Math.min(1, flash); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; flash -= dt * 2.5; }
    return geo;
  }
  return { resize: resize, draw: draw, event: event, reset: reset };
}
