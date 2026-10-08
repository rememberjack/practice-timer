/* Dash theme renderer: a neon runner in the spirit of rhythm platformers, with its own original shapes and colours.
   Everything about the run (position, jumps, obstacles, crashes, attempts) comes from DashSim in the core; this only draws it. */
function makeDashView(cv, hud, sim, MT) {
  'use strict';
  const g = cv.getContext('2d'), reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GRACE = MT.DASH.GRACE;
  let W = 0, H = 0, dpr = 1, top = 0, clock = 0, flash = 0, pulse = 0, hue = 222, drawnAttempt = 1;
  const shards = [], bits = [];

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    return true;
  }
  function reset() { shards.length = 0; bits.length = 0; flash = 0; pulse = 0; drawnAttempt = 1; }
  function event(e, geo) {
    if (e === 'jump') pulse = Math.max(pulse, 0.6);
    if (e === 'land' && geo) for (let i = 0; i < 4; i++) bits.push({ x: geo.cx + (Math.random() - 0.5) * geo.U * 0.6, y: geo.gy - 2, vx: (Math.random() - 0.7) * 60, vy: -30 - Math.random() * 50, t: 0, life: 0.35, s: 3 });
    if (e === 'crash' && geo) { flash = reduceMotion ? 0 : 0.8;
      for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 260;
        shards.push({ x: geo.cx, y: geo.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, t: 0, life: 0.9, s: geo.U * (0.18 + Math.random() * 0.2), c: i % 3 ? '#2DE2FF' : '#FFE14D' }); } }
    if (e === 'complete' && geo) { flash = reduceMotion ? 0 : 0.5;
      for (let i = 0; i < 40; i++) bits.push({ x: geo.cx + (Math.random() - 0.3) * W * 0.6, y: geo.gy - Math.random() * geo.U * 5, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 160, t: 0, life: 1.2 + Math.random(), s: 4, c: ['#7CFF4F', '#FFE14D', '#2DE2FF', '#FF5BD1'][i % 4] }); }
  }
  const hsl = (h, s, l, a) => 'hsla(' + (((h % 360) + 360) % 360).toFixed(0) + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  function rrect(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

  /* v: {running, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return null;
    clock += dt;
    const free = H - top, U = Math.max(18, Math.min(46, free / 8.5)), gy = Math.round(top + free * 0.74), cx = Math.round(Math.min(W * 0.28, U * 5)), cy = gy - sim.y * U - U / 2;
    const geo = { U: U, gy: gy, cx: cx, cy: cy }, sx = wx => cx + (wx - sim.x) * U;
    // colours drift through the level: blue, violet, pink, orange, and green once the goal is reached
    const want = sim.done ? 150 : 222 + Math.min(1, Math.max(0, sim.progress)) * 165;
    hue += (want - hue) * Math.min(1, dt * 1.5);
    pulse = Math.max(0, pulse - dt * 2.4); const glow = Math.min(1, pulse + (v.music ? v.level * 0.5 : 0));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, gy); bg.addColorStop(0, hsl(hue, 78, 13 + glow * 5)); bg.addColorStop(1, hsl(hue, 85, 34 + glow * 8));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // far squares drifting by, for depth
    for (let layer = 0; layer < 2; layer++) { const par = layer ? 0.42 : 0.18, size = U * (layer ? 2.2 : 3.6), gap = size * 2.3, off = (sim.x * U * par) % gap;
      g.fillStyle = hsl(hue, 90, 60, layer ? 0.10 : 0.07);
      for (let x = -off - size; x < W + size; x += gap) { const k = Math.round((x + off) / gap), yy = gy - size * (1.25 + ((k * 37 + layer * 11) % 5) * 0.42); g.fillRect(Math.round(x), Math.round(yy), size, size); } }
    // ground
    g.fillStyle = hsl(hue, 80, 9); g.fillRect(0, gy, W, H - gy);
    g.fillStyle = hsl(hue, 90, 60, 0.16); const goff = (sim.x * U) % (U * 2); for (let x = -goff; x < W; x += U * 2) g.fillRect(Math.round(x), gy + 6, 2, H - gy);
    g.fillStyle = '#FFFFFF'; g.fillRect(0, gy - 1, W, 3); g.fillStyle = hsl(hue, 100, 70, 0.35); g.fillRect(0, gy + 2, W, 5);
    // checkpoints left by pauses
    for (const m of sim.marks) { const x = sx(m); if (x < -U || x > W + U) continue; g.save(); g.translate(x, gy - U * 1.5); g.rotate(Math.PI / 4); g.fillStyle = '#7CFF4F'; g.strokeStyle = '#06210A'; g.lineWidth = 2; g.fillRect(-U * 0.24, -U * 0.24, U * 0.48, U * 0.48); g.strokeRect(-U * 0.24, -U * 0.24, U * 0.48, U * 0.48); g.restore(); }
    // the attempt number stands in the level where each run begins
    if (sim.attempts !== drawnAttempt) drawnAttempt = sim.attempts;
    { const x = sx(sim.respawnX + 1.1); if (x > -W && x < W * 1.6) { g.font = '800 ' + Math.round(U * 0.86) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      g.lineWidth = Math.max(3, U * 0.14); g.strokeStyle = 'rgba(5,5,26,.9)'; g.fillStyle = '#FFFFFF'; const txt = 'Attempt ' + sim.attempts; g.strokeText(txt, x, gy - U * 3.4); g.fillText(txt, x, gy - U * 3.4); } }
    // obstacles
    for (const o of sim.obs) { const x = sx(o.x); if (x > W + U || x + o.w * U < -U) continue; const hot = o.danger && sim.silentT > 0;
      g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = hot ? (Math.sin(clock * 14) > 0 ? '#FF5B5B' : '#FFFFFF') : '#FFFFFF'; g.fillStyle = hot ? '#3A0A12' : '#07071A';
      if (o.kind === 'block') { g.fillRect(x, gy - o.h * U, o.w * U, o.h * U); g.strokeRect(x + 1, gy - o.h * U + 1, o.w * U - 2, o.h * U - 2); g.strokeStyle = hsl(hue, 100, 70, 0.6); g.strokeRect(x + U * 0.2, gy - o.h * U + U * 0.2, o.w * U - U * 0.4, o.h * U - U * 0.4); }
      else for (let i = 0; i < o.w; i++) { g.beginPath(); g.moveTo(x + i * U + 1, gy - 1); g.lineTo(x + (i + 0.5) * U, gy - o.h * U); g.lineTo(x + (i + 1) * U - 1, gy - 1); g.closePath(); g.fill(); g.stroke(); } }
    // dust, sparks
    for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.t += dt; if (b.t >= b.life) { bits.splice(i, 1); continue; } b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 320 * dt; g.globalAlpha = 1 - b.t / b.life; g.fillStyle = b.c || '#FFFFFF'; g.fillRect(b.x, b.y, b.s, b.s); }
    g.globalAlpha = 1;
    // the cube: an original two-tone block with a diamond core
    if (sim.mode !== 'crash') {
      if (sim.mode === 'run' && sim.y === 0 && sim.v > 2 && !reduceMotion && Math.random() < dt * 30) bits.push({ x: cx - U * 0.5, y: gy - 4, vx: -40 - Math.random() * 50, vy: -10 - Math.random() * 30, t: 0, life: 0.4, s: 3, c: '#2DE2FF' });
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
    for (let i = shards.length - 1; i >= 0; i--) { const s = shards[i]; s.t += dt; if (s.t >= s.life) { shards.splice(i, 1); continue; } s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 620 * dt; s.r += s.vr * dt; if (s.y > gy - s.s / 2) { s.y = gy - s.s / 2; s.vy *= -0.4; s.vx *= 0.7; }
      g.save(); g.translate(s.x, s.y); g.rotate(s.r); g.globalAlpha = 1 - s.t / s.life; g.fillStyle = s.c; g.fillRect(-s.s / 2, -s.s / 2, s.s, s.s); g.restore(); }
    g.globalAlpha = 1;
    if (flash > 0) { g.globalAlpha = Math.min(1, flash); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; flash -= dt * 2.5; }
    return geo;
  }
  return { resize: resize, draw: draw, event: event, reset: reset };
}
