/* Speedrun theme renderer: a side view of a blocky world, in 16-pixel textures made here when the page loads (no images).
   Everything about the run (where the player is, the blocks to mine, the splits, the portals) comes from RunSim in the core; this only draws it. */
/* exported makeRunView */   // used by src/app.js, which the build puts after this file
function makeRunView(cv, hud, sim) {
  'use strict';
  const g = cv.getContext('2d'), RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, TAU = Math.PI * 2;
  let W = 0, H = 0, dpr = 1, top = 0, U = 24, clock = 0, camX = 0, showX = 0, footY = 0, swing = 0, beat = 0, flash = 0, world = 0, walkT = 0, lastBroke = null, lastSplit = 0;
  const bits = [], pops = [];

  /* ---------- textures, 16 x 16, drawn once from a fixed seed ---------- */
  const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (h, k) => { const c = rgb(h); return 'rgb(' + c.map(v => Math.max(0, Math.min(255, Math.round(v * k)))).join(',') + ')'; };
  const mk = () => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; return c; };
  function noise(base, spread, seed, fn) {
    const c = mk(), x = c.getContext('2d'), r = rng(seed);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { x.fillStyle = shade(base, 1 + (r() - 0.5) * spread); x.fillRect(i, j, 1, 1); }
    if (fn) fn(x, r); return c;
  }
  const px = (x, col, pts) => { x.fillStyle = col; for (let k = 0; k < pts.length; k += 2) x.fillRect(pts[k], pts[k + 1], 1, 1); };
  function ore(col, seed) {
    return noise('#7D7D7D', 0.28, seed, (x, r) => { for (let n = 0; n < 5; n++) { const i = 1 + Math.floor(r() * 12), j = 1 + Math.floor(r() * 12);
      px(x, shade(col, 0.75), [i, j + 1, i + 1, j + 1, i + 1, j + 2]); px(x, col, [i, j, i + 1, j]); px(x, shade(col, 1.25), [i, j]); } });
  }
  function bricks(base, mortar, seed, h) {
    return noise(base, 0.22, seed, x => { x.fillStyle = mortar;
      for (let j = 0; j < 16; j += h) { x.fillRect(0, j + h - 1, 16, 1); const off = (j / h) % 2 ? 4 : 0; for (let i = off; i < 16; i += 8) x.fillRect(i, j, 1, h - 1); } });
  }
  const T = {
    dirt: noise('#7A5434', 0.35, 3),
    grass: noise('#7A5434', 0.35, 4, (x, r) => { for (let i = 0; i < 16; i++) { const d = 3 + (r() < 0.4 ? 1 : 0) + (r() < 0.15 ? 1 : 0); for (let j = 0; j < d; j++) { x.fillStyle = shade('#5DA032', 1 + (r() - 0.5) * 0.35); x.fillRect(i, j, 1, 1); } } }),
    stone: noise('#7D7D7D', 0.28, 5, (x, r) => { for (let n = 0; n < 6; n++) px(x, '#666666', [Math.floor(r() * 15), Math.floor(r() * 15)]); }),
    coal: ore('#2B2B2B', 6), iron: ore('#D8AF93', 7), diamond: ore('#4FE3E0', 8),
    log: noise('#6B4F2A', 0.25, 9, (x, r) => { for (let i = 1; i < 16; i += 3 + Math.floor(r() * 2)) { x.fillStyle = '#4E3920'; x.fillRect(i, 0, 1, 16); } }),
    leaves: noise('#3E8A2A', 0.55, 10, (x, r) => { for (let n = 0; n < 14; n++) px(x, '#2C6620', [Math.floor(r() * 16), Math.floor(r() * 16)]); }),
    obsidian: noise('#1B1027', 0.6, 11, (x, r) => { for (let n = 0; n < 10; n++) px(x, '#3B2160', [Math.floor(r() * 16), Math.floor(r() * 16)]); }),
    redrock: noise('#6E2424', 0.45, 12, (x, r) => { for (let n = 0; n < 12; n++) px(x, '#8E3A3A', [Math.floor(r() * 16), Math.floor(r() * 16)]); }),
    brick: bricks('#3B1418', '#1E0A0D', 13, 4),
    glow: noise('#C9A23A', 0.35, 14, (x, r) => { for (let n = 0; n < 7; n++) { const i = Math.floor(r() * 14), j = Math.floor(r() * 14); x.fillStyle = '#FFE88A'; x.fillRect(i, j, 2, 2); } }),
    stonebrick: bricks('#717171', '#4A4A4A', 15, 8),
    mossy: bricks('#717171', '#4A4A4A', 16, 8),
    endstone: noise('#DCDDA0', 0.16, 17, (x, r) => { for (let n = 0; n < 9; n++) px(x, '#BDBD82', [Math.floor(r() * 16), Math.floor(r() * 16)]); }),
    frame: noise('#3F6F5E', 0.3, 18, x => { x.fillStyle = '#DCDDA0'; x.fillRect(0, 0, 16, 4); x.fillStyle = '#1F4A3C'; x.fillRect(5, 6, 6, 6); x.fillStyle = '#7CE0B8'; x.fillRect(7, 8, 2, 2); }),
    crystal: noise('#C04FA8', 0.3, 19, x => { x.fillStyle = '#FFB8EE'; x.fillRect(4, 4, 8, 8); x.fillStyle = '#FFFFFF'; x.fillRect(6, 6, 4, 4); x.fillStyle = '#7A2B6C'; x.fillRect(0, 0, 16, 1); x.fillRect(0, 15, 16, 1); x.fillRect(0, 0, 1, 16); x.fillRect(15, 0, 1, 16); }),
    lava: noise('#E2581C', 0.3, 20, (x, r) => { for (let n = 0; n < 6; n++) { x.fillStyle = '#FFAA33'; x.fillRect(Math.floor(r() * 14), Math.floor(r() * 15), 3, 1); } })
  };
  { const x = T.mossy.getContext('2d'), r = rng(21); for (let n = 0; n < 18; n++) px(x, n % 2 ? '#4E7A32' : '#5F8F3C', [Math.floor(r() * 16), Math.floor(r() * 16)]); }
  /* the colours a broken block falls apart into */
  const BITS = { log: ['#6B4F2A', '#4E3920', '#3E8A2A'], stone: ['#7D7D7D', '#5E5E5E'], iron: ['#7D7D7D', '#D8AF93'], diamond: ['#7D7D7D', '#4FE3E0', '#BFFFFB'], obsidian: ['#1B1027', '#3B2160'],
    brick: ['#3B1418', '#5A2026'], glow: ['#FFE88A', '#C9A23A'], stonebrick: ['#717171', '#4A4A4A'], crystal: ['#FFB8EE', '#C04FA8', '#FFFFFF'] };
  /* cracks, in four stages as a block is mined */
  const CRACK = []; { const c = mk(), x = c.getContext('2d'), r = rng(30); x.fillStyle = 'rgba(0,0,0,.62)';   // each stage adds to the one before
    for (let k = 0; k < 4; k++) { for (let n = 0; n < 2; n++) { let i = 4 + r() * 8, j = 4 + r() * 8, a = r() * TAU;
        for (let st = 0; st < 5 + k; st++) { a += (r() - 0.5) * 1.6; i += Math.cos(a); j += Math.sin(a); if (i >= 0 && i < 16 && j >= 0 && j < 16) x.fillRect(Math.floor(i), Math.floor(j), 1, 1); } }
      const s = mk(); s.getContext('2d').drawImage(c, 0, 0); CRACK.push(s); } }
  /* the pickaxe: none on the way to wood (it is punched), then wooden, stone, iron and diamond ones, as the splits go by */
  function pick(col) {
    const c = mk(), x = c.getContext('2d'), arc = [4, 2, 5, 1, 6, 1, 7, 1, 8, 1, 9, 1, 10, 2, 11, 2, 12, 3];
    for (let i = 0; i < 10; i++) { x.fillStyle = i % 3 ? '#7A5230' : '#5C3D22'; x.fillRect(1 + i, 14 - i, 2, 1); }
    for (let k = 0; k < arc.length; k += 2) { const a = arc[k], b = arc[k + 1];                        // the head, mirrored across the handle
      x.fillStyle = col; x.fillRect(a, b, 1, 1); x.fillRect(15 - b, 15 - a, 1, 1);
      x.fillStyle = shade(col, 0.68); x.fillRect(a, b + 1, 1, 1); x.fillRect(14 - b, 15 - a, 1, 1); }
    return c;
  }
  const TOOL = [null].concat(['#A07A45', '#9A9A9A', '#EDEDED', '#5FF2E8'].map(pick));

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    return true;
  }
  function reset() { bits.length = 0; pops.length = 0; camX = showX = sim.x; flash = 0; beat = 0; swing = 0; world = sim.worldAt(sim.x); lastBroke = null; lastSplit = sim.split; }
  function burst(x, y, cols, n, sp) { if (RM) return; for (let i = 0; i < n; i++) bits.push({ x: x, y: y, vx: (Math.random() - 0.5) * sp, vy: -Math.random() * sp * 0.9 - 40, t: 0, life: 0.5 + Math.random() * 0.5, s: Math.max(2, U * (0.1 + Math.random() * 0.1)), c: cols[i % cols.length] }); }
  function event(e) {
    if (e === 'note') beat = 1;
    if (e === 'split') flash = RM ? 0 : 0.35;
    if (e === 'done') flash = RM ? 0 : 0.6;
  }

  /* ---------- the world ---------- */
  const SKY = [['#6FA2FF', '#BFD8FF'], ['#250606', '#6B1A10'], ['#0E0E14', '#22222C'], ['#07040F', '#1D1236']];
  function surface(w, d, c, r) {
    if (w === 0) return d === 0 ? 'grass' : d < 3 ? 'dirt' : r < 0.05 ? 'coal' : r < 0.07 ? 'iron' : 'stone';
    if (w === 1) return r < 0.05 && d > 0 ? 'glow' : 'redrock';
    if (w === 2) return (c * 7 + d * 3) % 11 === 0 ? 'mossy' : 'stonebrick';
    return 'endstone';
  }
  const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function background(w, gy) {
    const sky = g.createLinearGradient(0, 0, 0, gy); sky.addColorStop(0, SKY[w][0]); sky.addColorStop(1, SKY[w][1]); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const step = U * 2;
    if (w === 0) {
      g.fillStyle = '#FFF6C9'; g.fillRect(Math.round(U * 0.8), Math.round(top + U * 0.8), Math.round(U * 1.4), Math.round(U * 1.4));   // a square sun
      g.fillStyle = 'rgba(255,255,255,.85)';
      for (let k = Math.floor(camX * 0.15 / 6) - 1; k < Math.floor(camX * 0.15 / 6) + W / (U * 6) + 2; k++) {   // blocky clouds, slow
        const x = Math.round((k * 6 - camX * 0.15) * U), y = Math.round(top + U * (0.4 + hash(k, 3) * 2.2)), n = 2 + Math.floor(hash(k, 4) * 3);
        g.fillRect(x, y, n * U, Math.round(U * 0.5)); g.fillRect(x + U * 0.5, y - U * 0.4, (n - 1) * U, Math.round(U * 0.45));
      }
      g.fillStyle = '#4C8A3C';                                                                                 // far hills
      for (let k = Math.floor(camX * 0.4 / 2) - 1; k < Math.floor(camX * 0.4 / 2) + W / step + 2; k++) { const x = Math.round((k * 2 - camX * 0.4) * U), hh = 1 + Math.floor((Math.sin(k * 0.5) + 1) * 1.6 + hash(k, 9));
        g.fillRect(x, Math.round(gy - U * (hh + 1)), step + 1, Math.round(U * (hh + 2))); }
    } else if (w === 1) {
      g.fillStyle = '#3E1010';
      for (let k = Math.floor(camX * 0.4 / 2) - 1; k < Math.floor(camX * 0.4 / 2) + W / step + 2; k++) { const x = Math.round((k * 2 - camX * 0.4) * U), hh = 1 + Math.floor(hash(k, 11) * 4);
        g.fillRect(x, Math.round(gy - U * (hh + 1)), step + 1, Math.round(U * (hh + 2))); g.fillRect(x, top, step + 1, Math.round(U * (0.4 + hash(k, 12) * 1.6))); }   // and the cavern roof
      g.fillStyle = 'rgba(255,170,90,.6)';
      for (let i = 0; i < 18; i++) { const x = ((hash(i, 13) * W - clock * 12 * (0.5 + hash(i, 14))) % W + W) % W, y = top + ((hash(i, 15) * (gy - top) - clock * 18) % (gy - top) + (gy - top)) % (gy - top); g.fillRect(Math.round(x), Math.round(y), 2, 2); }
    } else if (w === 2) {
      g.globalAlpha = 0.35; const s = U, c0 = Math.floor(camX * 0.6) - 1;                                    // the corridor's far wall
      for (let c = c0; c < c0 + W / s + 2; c++) for (let y = gy - s; y > top - s; y -= s) g.drawImage(T.stonebrick, Math.round((c - camX * 0.6) * s), Math.round(y), s, s);
      g.globalAlpha = 1;
      for (let c = Math.floor(camX * 0.6 / 6) - 1; c < Math.floor(camX * 0.6 / 6) + W / (U * 6) + 2; c++) { const x = Math.round((c * 6 - camX * 0.6) * U + U * 0.4), y = Math.round(gy - U * 2.6), f = RM ? 1 : 0.8 + 0.2 * Math.sin(clock * 9 + c);
        g.fillStyle = '#6B4F2A'; g.fillRect(x, y, Math.max(2, U * 0.14), U * 0.5); g.fillStyle = 'rgba(255,190,90,' + (0.18 * f) + ')'; g.beginPath(); g.arc(x, y, U * 1.4, 0, TAU); g.fill();
        g.fillStyle = '#FFD86B'; g.fillRect(x - 1, y - U * 0.16, Math.max(3, U * 0.18), U * 0.18); }   // torches
    } else {
      for (let i = 0; i < 70; i++) { const x = ((hash(i, 21) * W * 1.5 - camX * U * 0.05) % W + W) % W, y = top + hash(i, 22) * (gy - top); g.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.5 * hash(i, 23)) + ')'; g.fillRect(Math.round(x), Math.round(y), 2, 2); }
      for (let k = Math.floor(camX * 0.3 / 5) - 1; k < Math.floor(camX * 0.3 / 5) + W / (U * 5) + 2; k++) { const x = Math.round((k * 5 - camX * 0.3) * U), hh = 3 + Math.floor(hash(k, 24) * 4), y = Math.round(gy - U * hh);
        g.fillStyle = '#140B22'; g.fillRect(x, y, U, Math.round(U * (hh + 1))); g.fillStyle = 'rgba(255,140,230,' + (0.5 + 0.3 * Math.sin(clock * 2 + k)) + ')'; g.fillRect(x + U * 0.2, y - U * 0.6, U * 0.6, U * 0.6); }   // far pillars with crystals
    }
  }
  function dragon(gy) {
    if (world !== 3 || sim.done) return;
    const x = W * 0.62 + Math.sin(clock * 0.35) * W * 0.3, y = top + (gy - top) * 0.3 + Math.sin(clock * 0.9) * U, s = Math.max(2, Math.round(U / 8)), f = RM ? 0 : Math.sin(clock * 5), dir = Math.cos(clock * 0.35) >= 0 ? 1 : -1;
    g.save(); g.translate(Math.round(x), Math.round(y)); g.scale(dir, 1);
    g.fillStyle = '#3A2552'; g.fillRect(-10 * s, -2 * s, 20 * s, 4 * s); g.fillRect(10 * s, -3 * s, 6 * s, 5 * s); g.fillRect(-16 * s, -1 * s, 6 * s, 2 * s); g.fillRect(-20 * s, 0, 4 * s, 2 * s);   // body, head, tail
    g.fillStyle = '#C66BFF'; g.fillRect(14 * s, -2 * s, 2 * s, s);                                       // eyes
    g.fillStyle = '#56397A'; const wy = -2 * s - Math.round(f * 7 * s);
    g.beginPath(); g.moveTo(-6 * s, -2 * s); g.lineTo(-12 * s, wy - 4 * s); g.lineTo(4 * s, wy - 2 * s); g.lineTo(4 * s, -2 * s); g.closePath(); g.fill();   // the wings, flapping
    g.restore();
  }
  function portal(p, gy, kind) {
    const h = sim.groundAt(p), x0 = Math.round(sx(p - 1)), y0 = Math.round(gy - (h + 5) * U), frame = kind === 2 ? T.frame : T.obsidian;
    for (let r = 0; r < 5; r++) { g.drawImage(frame, x0, y0 + r * U, U, U); g.drawImage(frame, x0 + 3 * U, y0 + r * U, U, U); }
    g.drawImage(frame, x0 + U, y0, U, U); g.drawImage(frame, x0 + 2 * U, y0, U, U);
    const ix = x0 + U, iy = y0 + U, iw = 2 * U, ih = 4 * U;
    if (kind === 2) { g.fillStyle = '#05060E'; g.fillRect(ix, iy, iw, ih); for (let i = 0; i < 14; i++) { g.fillStyle = i % 3 ? '#7CE0B8' : '#FFFFFF'; g.fillRect(ix + Math.floor(hash(i, p) * iw), iy + Math.floor(((hash(i, p + 1) * ih + clock * 6) % ih)), 2, 2); } }
    else { g.fillStyle = 'rgba(122,43,214,.82)'; g.fillRect(ix, iy, iw, ih);
      g.fillStyle = 'rgba(214,160,255,.55)'; for (let i = 0; i < 10; i++) { const k = (clock * (RM ? 0 : 0.8) + i / 10) % 1; g.fillRect(ix + Math.floor(hash(i, p) * (iw - U * 0.3)), iy + ih - k * ih, Math.round(U * 0.3), Math.max(2, Math.round(U * 0.12))); } }
  }
  const sx = c => PX + (c - camX) * U;
  let PX = 0;
  function blockAt(t, c, row, gy) { g.drawImage(T[t], Math.round(sx(c)), Math.round(gy - (row + 1) * U), U, U); }
  function obstacle(o, gy, first) {
    const h = sim.groundAt(o.x);
    if (o.type === 'log') {
      for (let r = 0; r < 3; r++) blockAt('log', o.x, h + r, gy);
      for (let dc = -1; dc <= 1; dc++) for (let r = 3; r < 5; r++) blockAt('leaves', o.x + dc, h + r, gy);
      blockAt('leaves', o.x, h + 5, gy);
    } else {
      if (o.type === 'glow' || o.type === 'crystal') { const X = sx(o.x) + U / 2, Y = gy - (h + 0.5) * U, gr = g.createRadialGradient(X, Y, 0, X, Y, U * 1.6);
        gr.addColorStop(0, o.type === 'glow' ? 'rgba(255,220,120,.5)' : 'rgba(255,120,230,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - U * 1.6, Y - U * 1.6, U * 3.2, U * 3.2); }
      blockAt(o.type, o.x, h, gy);
    }
    if (first && sim.dig > 0.02) g.drawImage(CRACK[Math.min(3, Math.floor(sim.dig * 4))], Math.round(sx(o.x)), Math.round(gy - (h + 1) * U), U, U);
  }

  /* ---------- the player: an original blocky figure in an orange hoodie, seen from the side ---------- */
  function player(X, Y) {
    const p = U / 18, mode = sim.mode, walking = mode === 'walk', mining = mode === 'mine', bob = walking ? Math.abs(Math.sin(walkT * 9)) * p : RM ? 0 : Math.sin(clock * 2) * p * 0.4;
    const leg = walking && !RM ? Math.sin(walkT * 9) * 0.55 : 0, arm = mining ? -2.1 + 2.5 * (0.5 - 0.5 * Math.cos(swing * TAU)) : walking && !RM ? -Math.sin(walkT * 9) * 0.5 : 0.08;
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };
    g.save(); g.translate(Math.round(X), Math.round(Y - bob));
    const limb = (ang, x, y, w, h, c, c2) => { g.save(); g.translate(x, y); g.rotate(ang); R(-w / 2, 0, w, h, c); if (c2) R(-w / 2, h - 2 * p, w, 2 * p, c2); g.restore(); };
    limb(-leg, 0, -12 * p, 4 * p, 12 * p, '#2C3866', '#222222');                                         // back leg
    if (!mining) limb(-arm, 0, -23 * p, 4 * p, 11 * p, '#B5452E', '#D9A07A');                           // back arm
    R(-2 * p, -24 * p, 4 * p, 12 * p, '#D9573B'); R(-2 * p, -14 * p, 4 * p, 2 * p, '#B5452E');         // hoodie
    limb(leg, 0, -12 * p, 4 * p, 12 * p, '#3B4A7A', '#2A2A2A');                                         // front leg
    R(-4 * p, -32 * p, 8 * p, 8 * p, '#E0A77A');                                                        // head
    R(-4 * p, -32 * p, 8 * p, 2 * p, '#4A2E1A'); R(-4 * p, -30 * p, 3 * p, 4 * p, '#4A2E1A');           // hair
    R(2 * p, -28 * p, p, p, '#FFFFFF'); R(3 * p, -28 * p, p, p, '#2B4A8C'); R(1 * p, -25.5 * p, 2 * p, p * 0.8, '#A9684A');   // eye, mouth
    g.save(); g.translate(0, -23 * p); g.rotate(-arm);                                                  // front arm, with the tool in its hand
    const tool = TOOL[Math.min(TOOL.length - 1, sim.split)];
    if (tool) { const q = p * 0.9; g.save(); g.translate(0, 10 * p); g.rotate(Math.PI / 4); g.drawImage(tool, Math.round(-1.5 * q), Math.round(-14.5 * q), Math.round(16 * q), Math.round(16 * q)); g.restore(); }
    R(-2 * p, 0, 4 * p, 11 * p, '#C24C33'); R(-2 * p, 9 * p, 4 * p, 2 * p, '#E0A77A');
    g.restore();
    if (mode === 'pause') { R(-3 * p, -40 * p, 2 * p, 5 * p, '#FFFFFF'); R(1 * p, -40 * p, 2 * p, 5 * p, '#FFFFFF'); }   // the run timer is stopped
    g.restore();
  }

  /* v: {running, music}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    clock += dt; beat = Math.max(0, beat - dt * 3);
    const free = H - top; U = Math.round(Math.max(18, Math.min(W >= 700 ? 44 : 34, free / 9.5)));
    const gy = Math.round(top + free * 0.74); PX = Math.round(Math.min(W * 0.3, U * 6));
    if (Math.abs(sim.x - showX) > 30) showX = sim.x;                       // a new run, or a following device catching up: no slide across the world
    const was = showX; showX += (sim.x - showX) * Math.min(1, dt * 10); camX = showX;
    if (showX > was + 1e-4) walkT += dt;
    if (sim.mode === 'mine' && v.running) { const s0 = swing; swing = (swing + dt * (2.3 + beat * 1.5)) % 1; if (swing < s0) { const o = sim.target, h = sim.groundAt(o.x); burst(sx(o.x) + U * 0.1, gy - (h + 0.5) * U, BITS[o.type] || ['#888'], 3, 120); } }
    else swing = 0;
    if (sim.broke && sim.broke !== lastBroke) { lastBroke = sim.broke; const o = lastBroke, h = sim.groundAt(o.x), X = sx(o.x) + U / 2, Y = gy - (h + 0.5) * U;
      burst(X, Y, BITS[o.type] || ['#888'], 14, 220); if (!RM) pops.push({ x: X, y: Y, t: 0, type: o.type }); }
    if (sim.split !== lastSplit) { if (sim.split > lastSplit) burst(PX, gy - 2.4 * U, ['#FFE88A', '#FFFFFF', '#5FF2E8'], 24, 260); lastSplit = sim.split; }
    const w = sim.worldAt(showX); if (w !== world) { world = w; flash = RM ? 0 : 0.7; }

    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
    background(world, gy);
    dragon(gy);
    // the ground, column by column
    const c0 = Math.floor(camX - PX / U) - 1, c1 = c0 + Math.ceil(W / U) + 3;
    for (let c = c0; c <= c1; c++) {
      const wc = sim.worldAt(c), h = sim.groundAt(c), x = Math.round(sx(c)), low = wc === 3 ? -2 - Math.floor(hash(c, 77) * 2) : -99;   // the End's islands float
      for (let r = h - 1, d = 0; gy - (r + 1) * U < H && r >= low; r--, d++) g.drawImage(T[surface(wc, d, c, hash(c, r))], x, Math.round(gy - (r + 1) * U), U, U);
      if (wc === 2) for (let r = 6; gy - r * U > top - U; r++) g.drawImage(T.stonebrick, x, Math.round(gy - (r + 1) * U), U, U);   // the stronghold's ceiling
    }
    sim.portals.forEach((p, i) => { if (sx(p) > -4 * U && sx(p) < W + 4 * U) portal(p, gy, i); });
    for (let i = sim.obs.length - 1; i >= 0; i--) { const o = sim.obs[i]; if (sx(o.x) < W + 2 * U && sx(o.x) > -2 * U) obstacle(o, gy, i === 0); }
    // the player stands on the ground under its feet, stepping up and down smoothly
    const want = gy - sim.groundAt(Math.floor(showX)) * U; footY = footY ? footY + (want - footY) * Math.min(1, dt * 14) : want;
    player(PX, footY);
    // block pieces, and the item a broken block drops, floating up
    for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.t += dt; if (b.t >= b.life) { bits.splice(i, 1); continue; } b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 700 * dt;
      g.globalAlpha = 1 - b.t / b.life; g.fillStyle = b.c; g.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s); }
    g.globalAlpha = 1;
    for (let i = pops.length - 1; i >= 0; i--) { const q = pops[i]; q.t += dt; if (q.t >= 1.1) { pops.splice(i, 1); continue; } const s = U * 0.45, y = q.y - q.t * U * 1.6 - Math.sin(q.t * 6) * 3;
      g.globalAlpha = Math.min(1, 2.2 - q.t * 2); g.drawImage(T[q.type === 'log' ? 'log' : q.type], Math.round(q.x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s)); }
    g.globalAlpha = 1;
    if (flash > 0) { g.globalAlpha = Math.min(1, flash); g.fillStyle = world === 1 ? '#FFB27A' : world === 3 ? '#E2B8FF' : '#FFFFFF'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; flash -= dt * 1.8; }
  }
  return { resize: resize, draw: draw, event: event, reset: reset };
}
