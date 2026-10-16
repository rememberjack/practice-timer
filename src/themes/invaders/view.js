/* Invaders' drawing, in the manner of the 1978 arcade cabinets: white pixels on black, under strips of coloured film (red across the top
   where the mystery ship flies, green over the shields, the cannon and the ground). Everything about the game comes from InvaderSim (sim.js);
   this only draws it, in the arcade's own pixels scaled to fit under the read-outs. MT: { INV, SPRITES } */
'use strict';
function makeInvadersView(cv, hud, sim, MT) {
  const g = cv.getContext('2d'), INV = MT.INV, SPRITES = MT.SPRITES;
  const RED = '#FF3B3B', GREEN = '#3CFF3C', RED_TO = 24, GREEN_FROM = INV.FLOOR;   // the film: red over the field's top, green from the floor down
  let W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0;
  const cache = {}, shieldCv = [], bursts = [], texts = [];
  let shieldVer = -1;

  /* each sprite frame drawn once, white, one canvas pixel per arcade pixel; drawn scaled up with smoothing off */
  function sprite(name, f) {
    const key = name + f; if (cache[key]) return cache[key];
    const rows = SPRITES[name][f], c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
    const x = c.getContext('2d'); x.fillStyle = '#FFFFFF';
    rows.forEach((r, y) => { for (let i = 0; i < r.length; i++) if (r[i] === 'X') x.fillRect(i, y, 1, 1); });
    return (cache[key] = c);
  }
  const px = v => Math.round(v * s * dpr) / dpr;   // arcade pixels to whole device pixels
  function put(c, x, y) { const X = px(x), Y = px(y); g.drawImage(c, ox + X, oy + Y, px(x + c.width) - X, px(y + c.height) - Y); }
  function rect(x, y, w, h) { const X = px(x), Y = px(y); g.fillRect(ox + X, oy + Y, Math.max(1 / dpr, px(x + w) - X), Math.max(1 / dpr, px(y + h) - Y)); }

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const top = Math.min(h * 0.5, hud.offsetTop + hud.offsetHeight) + 4;
    s = Math.max(0.6, Math.min((w - 8) / INV.W, (h - top - 4) / INV.H, 4));
    ox = Math.round((w - INV.W * s) / 2); oy = Math.round(Math.max(top, h - 4 - INV.H * s));
    return true;
  }
  function reset() { bursts.length = 0; texts.length = 0; shieldVer = -1; }
  function event(ev) {
    if (ev.e === 'kill') bursts.push({ x: ev.x, y: ev.y, t: 0, life: 0.28, k: 'burst' });
    else if (ev.e === 'ufo') { bursts.push({ x: ev.x, y: INV.UFO_Y + 4, t: 0, life: 0.4, k: 'burst' }); texts.push({ x: ev.x, y: INV.UFO_Y + 4, t: 0, life: 1.4, s: String(ev.pts) }); }
    else if (ev.e === 'miss' || ev.e === 'clash' || ev.e === 'shield' || ev.e === 'ground' || ev.e === 'block') bursts.push({ x: ev.x, y: ev.y, t: 0, life: 0.2, k: 'spark' });
  }
  function shields() {
    if (shieldVer === sim.shieldVer && shieldCv.length) return;
    shieldVer = sim.shieldVer;
    const w = SPRITES.shield[0][0].length, h = SPRITES.shield[0].length;
    sim.shields.forEach((sh, i) => {
      const c = shieldCv[i] || (shieldCv[i] = document.createElement('canvas')); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.clearRect(0, 0, w, h); x.fillStyle = '#FFFFFF';
      for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) if (sh.bits[y * w + k]) x.fillRect(k, y, 1, 1);
    });
  }
  function draw(dt, o) {
    if (!W && !resize()) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    /* the mystery ship, the fleet and the shot */
    if (sim.ufo) { const c = sprite('ufo', 0); put(c, sim.ufo.x - c.width / 2, INV.UFO_Y); }
    if (sim.gap <= 0) for (let i = 0; i < sim.alive.length; i++) if (sim.alive[i]) { const b = sim.box(i); put(sprite(MT.INV.KINDS[b.row], sim.frame), b.x, b.y); }
    g.fillStyle = '#FFFFFF';
    if (sim.shot) rect(sim.shot.x, sim.shot.y, 1, 4);
    for (const b of sim.bombs) put(sprite('bomb', Math.floor(b.t * 12) % 3), b.x - 1, b.y);
    /* the shields, the cannon and the ground */
    shields(); sim.shields.forEach((sh, i) => put(shieldCv[i], sh.x, INV.SHIELD_Y));
    const can = sprite('cannon', 0); put(can, Math.round(sim.cx) - Math.floor(can.width / 2), INV.CANNON_Y);
    g.fillStyle = '#FFFFFF'; rect(0, INV.GROUND, INV.W, 1);
    /* hits: a burst where an invader was, a spark where a shot or bomb ended, the mystery ship's points */
    for (let k = bursts.length - 1; k >= 0; k--) {
      const b = bursts[k]; if (o.running) b.t += dt; if (b.t >= b.life) { bursts.splice(k, 1); continue; }
      if (b.k === 'burst') { const c = sprite('burst', 0); put(c, b.x - c.width / 2, b.y - c.height / 2); }
      else { g.fillStyle = '#FFFFFF'; for (const [dx, dy] of [[-2, -1], [2, -1], [0, -2], [-1, 1], [1, 1], [0, 0]]) rect(b.x + dx, b.y + dy, 1, 1); }
    }
    g.font = Math.max(8, Math.min(16, Math.round(6 * s))) + 'px "Press Start 2P", "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = texts.length - 1; k >= 0; k--) {
      const t = texts[k]; t.t += dt; if (t.t >= t.life) { texts.splice(k, 1); continue; }
      g.fillStyle = '#FFFFFF'; g.fillText(t.s, ox + px(t.x), oy + px(t.y));
    }
    /* under the ground line, where the cabinets show the lives and credits: the wave on the left, the invaders left on the right */
    g.fillStyle = '#FFFFFF'; g.textBaseline = 'middle';
    if (o.wave) { g.textAlign = 'left'; g.fillText(o.wave.toUpperCase(), ox + px(4), oy + px(INV.GROUND + 9)); }
    if (o.left) { g.textAlign = 'right'; g.fillText(o.left.toUpperCase(), ox + px(INV.W - 4), oy + px(INV.GROUND + 9)); }
    /* the coloured film over the screen, as on the cabinets: white turns red at the top and green at the foot; black stays black */
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = RED; g.fillRect(0, oy, W, px(RED_TO));
    g.fillStyle = GREEN; g.fillRect(0, oy + px(GREEN_FROM), W, H - oy - px(GREEN_FROM));
    g.globalCompositeOperation = 'source-over';
  }
  return { resize: () => { W = 0; resize(); }, reset: reset, event: event, draw: draw };
}
module.exports = { makeInvadersView };
