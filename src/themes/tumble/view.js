/* Tumble's drawing: a wooden crate seen from the front, the blocks falling in from under the read-outs and piling up, the practice goal as a
   gold line, and the walls of past sessions marked on the crate like heights pencilled on a doorframe. What falls, and where, comes from TumbleSim
   and its pile (sim.js, pile.js); this only draws them. The view follows the top of the pile up as the wall grows; a finger dragged up or down
   the crate looks back through the layers, and the view goes back to following a moment later. Blocks deep in the wall are drawn once into
   strips of canvas (the record of the session), so drawing stays cheap however long the session.
   MT: { TU, tuColour, label(b) (a block's face, in the page's language), markText(k) (a past wall's name: 'last', 'best'), unitsFor, reduceMotion } */
'use strict';
function makeTumbleView(cv, hud, sim, MT) {
  const g = cv.getContext('2d'), TU = MT.TU, RM = MT.reduceMotion;
  const INK = '#2A1F18', WOOD = '#D1A265', WOOD_DK = '#A3733C', WOOD_LT = '#ECC993', GOLD = '#F0C04A', BOX = '#1F2C33', PENCIL = 'rgba(243,238,230,.55)';
  const WL = 12, WR = 22, CHU = 32, FONT = '"Fredoka", "Trebuchet MS", "Helvetica Neue", Arial, sans-serif';   // the walls, the strips of settled wall (units)
  let W = 0, H = 0, dpr = 1, top = 0, IL = WL, IR = 0, IW = 0, ppu = 16, VU = 20;   // ppu: pixels to a block unit; VU: units from the floor line to the read-outs
  let cam = -0.8, userCamUntil = 0, drag = null, chunks = {}, labels = 0;         // cam: the unit at the foot of the view (the floor sits 0.8 under it at first)
  const confetti = [], sparks = [];
  const sy = y => H - (y - cam) * ppu, sx = x => IL + x * ppu;

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h; top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight) + 6;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    IL = WL; IR = W - WR; IW = IR - IL; const was = ppu; ppu = IW / TU.COLS; VU = (H - top) / ppu;
    if (Math.abs(was - ppu) > 0.01) chunks = {};   // the settled wall is drawn again at the new size
    return true;
  }
  function reset() { cam = -0.8; userCamUntil = 0; drag = null; chunks = {}; confetti.length = 0; sparks.length = 0; }
  function relabel() { chunks = {}; labels++; }   // the language changed: the faces are written again

  /* ---------- the view's place ---------- */
  const floorCam = () => -0.8, follow = () => Math.max(floorCam(), sim.surface - 0.4 * VU);
  function camera(dt) {
    if ((drag && drag.on) || performance.now() < userCamUntil) return;
    const t = follow(); cam += (t - cam) * Math.min(1, dt * 3); if (Math.abs(t - cam) < 0.002) cam = t;
  }
  const clampCam = y => Math.max(floorCam(), Math.min(sim.surface + 0.5 * VU, y));
  /* a finger (or mouse) dragged up or down the crate looks back through the wall; a sideways drag is the page's swipe to another theme, which
     takes the pointer for itself, so the moves and the lift are heard on the window */
  cv.addEventListener('pointerdown', e => { if (e.button) return; drag = { x: e.clientX, y: e.clientY, cam: cam, on: false, id: e.pointerId }; });
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) { if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.3) drag.on = true; else if (Math.abs(dx) > 10) { drag = null; return; } else return; }
    cam = clampCam(drag.cam + dy / ppu);
  });
  const lift = e => { if (!drag || e.pointerId !== drag.id) return; if (drag.on) userCamUntil = performance.now() + 2500; drag = null; };
  window.addEventListener('pointerup', lift); window.addEventListener('pointercancel', lift);
  cv.addEventListener('wheel', e => { if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; e.preventDefault(); cam = clampCam(cam + e.deltaY / ppu); userCamUntil = performance.now() + 2500; }, { passive: false });

  /* ---------- the blocks ---------- */
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  const shades = new Map();
  function colour(b) {   // the note's colour, a little lighter an octave up and darker an octave down
    const key = b.pc + ':' + b.oct; let c = shades.get(key); if (c) return c;
    const [r, gg, bl] = hexRgb(MT.tuColour(b.pc)), t = Math.max(-0.4, Math.min(0.4, (b.oct - 4) * 0.12)), m = t > 0 ? 255 : 0, a = Math.abs(t), f = v => Math.round(v + (m - v) * a);
    c = 'rgb(' + f(r) + ',' + f(gg) + ',' + f(bl) + ')'; shades.set(key, c); return c;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
  /* the face: the note's name (with its octave on a wider block), sized once to fit and kept on the spec until the language changes */
  function face(c, b, w, h) {
    if (b._lk !== labels) { b._lk = labels; const name = b.kind === 'trophy' ? '★' : MT.label(b), sub = b.kind === 'note' && b.units >= 2 ? String(b.oct) : '';
      let fs = h * 0.62; const fit = () => { c.font = '600 ' + fs + 'px ' + FONT; const lw = c.measureText(name).width; let sw = lw; if (sub) { c.font = '500 ' + (fs * 0.6) + 'px ' + FONT; sw += c.measureText(sub).width + 1; } return [lw, sw]; };
      let m = fit(); if (m[1] > w - 6) { fs = Math.max(5, fs * (w - 6) / m[1]); m = fit(); } b._f = { name: name, sub: sub, fs: fs, lw: m[0], sw: m[1] }; }
    const f = b._f; c.fillStyle = b.kind === 'trophy' ? '#4A3408' : INK; c.textBaseline = 'middle';
    if (f.sub) { c.font = '600 ' + f.fs + 'px ' + FONT; c.textAlign = 'left'; c.fillText(f.name, -f.sw / 2, 0.6); c.font = '500 ' + (f.fs * 0.6) + 'px ' + FONT; c.fillText(f.sub, -f.sw / 2 + f.lw + 1, f.fs * 0.22); }
    else { c.font = '600 ' + f.fs + 'px ' + FONT; c.textAlign = 'center'; c.fillText(f.name, 0, 0.6); }
  }
  /* a block at x, y (canvas px) turned by a (radians): painted wood, a light edge above and left, a dark one below and right, the name on the face;
     gold for the trophy, a gold frame for a block in a chord outline, a little darker once settled deep in the wall */
  function drawBlock(c, x, y, a, b, w, h, aged) {
    c.save(); c.translate(x, y); if (a) c.rotate(a); const r = Math.min(4, h / 4);
    rr(c, -w / 2, -h / 2, w, h, r); c.fillStyle = b.kind === 'trophy' ? GOLD : colour(b); c.fill();
    c.fillStyle = 'rgba(255,255,255,.32)'; c.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, 1.5); c.fillRect(-w / 2 + 1, -h / 2 + 1, 1.5, h - 2);
    c.fillStyle = 'rgba(0,0,0,.26)'; c.fillRect(-w / 2 + 1, h / 2 - 2.5, w - 2, 1.5); c.fillRect(w / 2 - 2.5, -h / 2 + 1, 1.5, h - 2);
    if (b.chord) { c.strokeStyle = GOLD; c.lineWidth = 2; rr(c, -w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5, Math.max(1, r - 1)); c.stroke(); }
    face(c, b, w, h);
    if (aged) { c.fillStyle = 'rgba(50,35,20,.16)'; rr(c, -w / 2, -h / 2, w, h, r); c.fill(); }
    c.restore();
  }

  /* ---------- the settled wall: strips of canvas, CHU units tall, drawn once and kept ---------- */
  function chunk(key) {
    let c = chunks[key]; if (c) return c;
    const cvs = document.createElement('canvas'); cvs.width = Math.max(1, Math.round(IW * dpr)); cvs.height = Math.max(1, Math.round(CHU * ppu * dpr));
    const cc = cvs.getContext('2d'); cc.setTransform(dpr, 0, 0, dpr, 0, 0); c = chunks[key] = { canvas: cvs, ctx: cc, top: (key + 1) * CHU };
    for (const k of sim.pile.settled) if (k.y + k.h > key * CHU - 1 && k.y - k.h < c.top + 1) into(c, k);
    return c;
  }
  function into(c, k) { drawBlock(c.ctx, k.x * ppu, (c.top - k.y) * ppu, -k.a, k.b, k.w * ppu, k.h * ppu, true); }
  function settled(list) { for (const k of list) for (const key of new Set([Math.floor((k.y - k.h) / CHU), Math.floor((k.y + k.h) / CHU)])) if (key >= 0 && chunks[key]) into(chunks[key], k); }

  /* ---------- events from the sim ---------- */
  function event(e) {
    if (RM) return;
    if (e.k === 'goal') for (let i = 0; i < 70; i++) confetti.push({ x: TU.COLS / 2 + (Math.random() - 0.5) * TU.COLS * 0.5, y: sim.pile.spawnY, vx: (Math.random() - 0.5) * 7, vy: Math.random() * 6 + 2, c: MT.tuColour(i), life: 1.3, s: 2.5 + Math.random() * 3 });
    else if (e.k === 'chord') for (const id of e.ids) { const k = sim.pile.live.find(q => q.b.id === id); if (!k) continue;
      for (let i = 0; i < 7; i++) sparks.push({ x: k.x + (Math.random() - 0.5) * k.w, y: k.y + k.h / 2, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, life: 0.7 }); }
  }

  /* ---------- each frame: the pile moves on (shown or not), the view follows, deep blocks settle ---------- */
  function tick(dt) {
    if (!W && !resize()) return;
    camera(dt);
    sim.pile.spawnY = follow() + VU - 1;   // blocks fall in from just under the read-outs
    sim.pile.step(dt);
    const out = sim.pile.settleBelow(Math.min(cam, follow()) - 1); if (out.length) settled(out);
  }
  function line(x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  /* o: { st, music, goalText } */
  function draw(dt, o) {
    if (!W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = BOX; g.fillRect(0, 0, W, H);
    const bot = cam, up = cam + H / ppu, pile = sim.pile, s = sim.surface, play = sim.play;
    /* the settled wall */
    for (let key = Math.max(0, Math.floor(bot / CHU)); key <= Math.floor(up / CHU); key++) { if (!pile.settled.length) break; const c = chunk(key); g.drawImage(c.canvas, IL, sy(c.top), IW, CHU * ppu); }
    /* the height chart: a pencil line across the crate where each past wall reached (the last session's, the tallest), and the goal in gold */
    const marks = sim.marks.filter(m => m.y > bot - 2 && m.y < up + 2);
    g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeStyle = PENCIL;
    for (const m of marks) line(IL, sy(m.y), IR, sy(m.y));
    g.setLineDash([]);
    const gy = sim.goal > 0 ? (sim.goalDone ? sim.goalY : s + Math.max(0, sim.goal - play) / 60 * sim.perMin()) : -1, gOn = gy >= 0 && gy > bot - 2 && gy < up + 2;
    if (gOn) { g.setLineDash(sim.goalDone ? [] : [6, 4]); g.strokeStyle = GOLD; g.lineWidth = 2; line(IL, sy(gy), IR, sy(gy)); g.setLineDash([]); g.lineWidth = 1; }
    /* the live blocks */
    for (const k of pile.live) { if (k.y + k.w < bot || k.y - k.w > up) continue; drawBlock(g, sx(k.x), sy(k.y), -k.a, k.b, k.w * ppu, k.h * ppu, false); }
    /* the lines' names over the blocks, so they can be read: the goal's at the left, each past wall's at the right (above the line; under it when the next mark is close above) */
    g.font = '700 10px ' + FONT; g.textBaseline = 'bottom';
    if (gOn) { g.fillStyle = GOLD; g.textAlign = 'left'; g.fillText(o.goalText, IL + 6, sy(gy) - 3); }
    g.fillStyle = PENCIL; g.textAlign = 'right';
    marks.forEach((m, i) => { const under = i + 1 < marks.length && marks[i + 1].y - m.y < 1.6; g.textBaseline = under ? 'top' : 'bottom'; g.fillText(MT.markText(m.k), IR - 6, sy(m.y) + (under ? 3 : -3)); });
    /* the walls and the floor, over the blocks' edges, with the grain and the ruler's figures */
    g.fillStyle = WOOD; g.fillRect(0, 0, WL, H); g.fillRect(IR, 0, WR, H);
    g.fillStyle = WOOD_LT; g.fillRect(WL - 2, 0, 2, H); g.fillRect(IR, 0, 2, H);
    g.strokeStyle = 'rgba(120,80,30,.22)'; for (let i = 0; i < 3; i++) { line(3 + i * 3, 0, 3 + i * 3, H); line(IR + 7 + i * 4, 0, IR + 7 + i * 4, H); }
    if (bot < 0) { const fy = sy(0); g.fillStyle = WOOD_DK; g.fillRect(0, fy, W, H - fy + 2); g.fillStyle = WOOD_LT; g.fillRect(0, fy, W, 2); }
    g.fillStyle = 'rgba(42,31,24,.8)'; for (const m of marks) g.fillRect(IR + 2, sy(m.y) - 0.75, 10, 1.5);   // a pencil mark on the wall at each past wall's height
    if (gOn) { const y = sy(gy); g.fillStyle = GOLD; g.beginPath(); g.moveTo(IR + 4, y); g.lineTo(IR + 11, y - 5); g.lineTo(IR + 18, y); g.lineTo(IR + 11, y + 5); g.closePath(); g.fill(); }
    /* confetti at the goal, sparks on a chord outline (in units; they fall with the view) */
    for (let i = confetti.length - 1; i >= 0; i--) { const p = confetti[i]; p.vy -= 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.life -= dt * 0.6;
      if (p.life <= 0 || p.y < bot - 1) { confetti.splice(i, 1); continue; } g.globalAlpha = Math.max(0, Math.min(1, p.life)); g.fillStyle = p.c; g.fillRect(sx(p.x), sy(p.y), p.s, p.s * 0.6); }
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.vy -= 10 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { sparks.splice(i, 1); continue; } g.globalAlpha = Math.max(0, p.life / 0.7); g.fillStyle = GOLD; g.fillRect(sx(p.x) - 1.5, sy(p.y) - 1.5, 3, 3); }
    g.globalAlpha = 1;
    /* the hopper under the read-outs: a shadow, and the note being held, growing wider for as long as it sounds, where it will fall */
    const hy = sy(sim.pile.spawnY), grad = g.createLinearGradient(0, top - 6, 0, top + 2 * ppu); grad.addColorStop(0, 'rgba(0,0,0,.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(IL, top - 6, IW, 2 * ppu + 6);
    const cur = sim.cur;
    if (cur && o.st === 'running' && o.music) { const units = MT.unitsFor(sim.t - cur.start), w = units * ppu, x = Math.max(IL + w / 2 + 1, Math.min(IR - w / 2 - 1, sx(cur.x)));
      const b = cur.face || (cur.face = { kind: 'note', pc: cur.pc, oct: cur.oct, units: 1, chord: '' }); if (b.units !== units) { b.units = units; b._lk = -1; }
      drawBlock(g, x, hy, 0, b, w, ppu, false); }
  }
  return { resize: () => { W = 0; resize(); }, reset: reset, relabel: relabel, event: event, tick: tick, draw: draw, get surface() { return sim.surface; } };
}
module.exports = { makeTumbleView };
