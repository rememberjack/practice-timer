/* Coins theme renderer: an arcade coin pusher in 3D. Metal coins with the note that dropped each one pressed into its face, on a
   lacquered shelf behind glass; a chrome plate slides in and out under the back wall; won coins tumble over the front edge into the
   tray. Bulbs chase round the back wall, where the last note played is lit up.
   three.js is loaded the first time the theme is shown (as City does); until then, or if it cannot load, a flat drawing stands in.
   Everything about the machine (where each coin is, the plate, what is won) comes from CoinSim in the core; this only draws it. */
/* exported makeCoinView */   // used by src/app.js, which the build puts after this file
function makeCoinView(cv, hud, sim, MT) {
  'use strict';
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const flat = makeFlatCoins(cv, hud, sim, MT);
  let deep = null, promise = null, failedAt = 0;
  /* the same script tag as City's, so three.js is only ever loaded once */
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    return new Promise((res, rej) => {
      let s = document.querySelector('script[src="' + THREE_URL + '"]');
      if (!s) { s = document.createElement('script'); s.src = THREE_URL; s.async = true; document.head.appendChild(s); }
      s.addEventListener('load', () => window.THREE ? res() : rej(new Error('three.js did not load')));
      s.addEventListener('error', () => { s.remove(); rej(new Error('three.js did not load')); });
    });
  }
  function ensure() {
    if (deep || promise || Date.now() - failedAt < 10e3) return;      // after a failed load, try again every 10 s while Coins is shown
    promise = loadThree().then(() => { deep = makeDeepCoins(cv.parentElement, hud, sim, MT); cv.style.visibility = 'hidden'; deep.resize(); })
      .catch(() => { failedAt = Date.now(); }).then(() => { promise = null; });
  }
  return {
    ensure: ensure,
    resize: () => { flat.resize(); if (deep) deep.resize(); },
    draw: (v, dt) => { if (deep) deep.draw(v, dt); else { ensure(); flat.draw(v, dt); } },
    event: e => { if (deep) deep.event(e); else flat.event(e); },
    reset: () => { flat.reset(); if (deep) deep.reset(); },
  };
}

function makeDeepCoins(host, hud, sim, MT) {
  'use strict';
  const T = window.THREE, reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = MT.COIN, S = 10, D = C.D * S, TH = 0.15, BACK = -D / 2, FRONT = D / 2;   // world units: the shelf is 10 wide; TH: a coin's thickness
  const WALL_Y = 1.0, SLOT_Y = WALL_Y + 2.35, TOP_Y = WALL_Y + 3.05, TRAY_Y = -1.5, TRAY_Z0 = FRONT + 0.6, TRAY_Z1 = FRONT + 2.5, PLATE_H = 0.9;
  const lin = hex => new T.Color(hex).convertSRGBToLinear();
  const hash = (n, k) => { const a = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return a - Math.floor(a); };

  // ---------- renderer, scene, camera ----------
  const canvas = document.createElement('canvas'); canvas.className = 'coin-gl'; canvas.setAttribute('aria-hidden', 'true'); host.insertBefore(canvas, hud);
  const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  let dpr = Math.min(2, window.devicePixelRatio || 1); renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(34, 1, 0.5, 120);
  scene.environment = environment();

  function tex(w, h, paint, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }
  /* what the metal reflects: a dark arcade with a big soft light overhead, warm bulbs all round and a pink glow low down */
  function environment() {
    const t = tex(512, 256, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a1830'); bg.addColorStop(0.5, '#7A4A3E'); bg.addColorStop(0.7, '#3a1626'); bg.addColorStop(1, '#0c0410'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const soft = (x, y, rx, ry, col) => { const r = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); r.addColorStop(0, col); r.addColorStop(1, 'rgba(0,0,0,0)');
        g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y); g.fillStyle = r; g.fillRect(x - Math.max(rx, ry), y - Math.max(rx, ry), 2 * Math.max(rx, ry), 2 * Math.max(rx, ry)); g.restore(); };
      const ceil = g.createLinearGradient(0, 0, 0, h * 0.42); ceil.addColorStop(0, '#FFF6E8'); ceil.addColorStop(0.7, '#C9A88E'); ceil.addColorStop(1, 'rgba(90,40,50,0)');
      g.fillStyle = ceil; g.fillRect(0, 0, w, h * 0.42);                                // a ceiling of soft light panels
      for (let i = 0; i < 6; i++) soft((i + 0.5) * w / 6, h * 0.18, w * 0.06, h * 0.06, 'rgba(255,255,255,1)');
      soft(w * 0.25, h * 0.32, w * 0.12, h * 0.08, 'rgba(255,236,210,.9)'); soft(w * 0.75, h * 0.32, w * 0.12, h * 0.08, 'rgba(255,236,210,.9)');
      for (let i = 0; i < 16; i++) soft((i + 0.5) * w / 16, h * 0.47, 9, 7, 'rgba(255,190,90,1)');   // bulbs round the room
      soft(w * 0.5, h * 0.62, w * 0.6, h * 0.08, 'rgba(255,80,140,.35)');
    }, true);
    t.mapping = T.EquirectangularReflectionMapping;
    const pm = new T.PMREMGenerator(renderer), env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose(); return env;
  }

  // ---------- materials ----------
  const gold = new T.MeshStandardMaterial({ color: lin('#F4C24E'), metalness: 1, roughness: 0.26 });
  const chrome = new T.MeshStandardMaterial({ color: lin('#F2F4F7'), metalness: 1, roughness: 0.1 });
  const lacquer = new T.MeshPhysicalMaterial({ color: lin('#5C0B22'), metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new T.MeshStandardMaterial({ color: lin('#170610'), metalness: 0.6, roughness: 0.45 });
  const glass = new T.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 2 });
  const led = new T.MeshBasicMaterial({ color: lin('#FFB45A'), toneMapped: false });
  const reeds = tex(512, 16, (g, w, h) => { for (let x = 0; x < w; x += 4) { g.fillStyle = '#fff'; g.fillRect(x, 0, 2, h); g.fillStyle = '#000'; g.fillRect(x + 2, 0, 2, h); } });
  const rimMat = new T.MeshStandardMaterial({ color: lin('#F0BB45'), metalness: 1, roughness: 0.3, bumpMap: reeds, bumpScale: 0.006 });
  const silverRim = new T.MeshStandardMaterial({ color: lin('#D5DAE0'), metalness: 1, roughness: 0.32, bumpMap: reeds, bumpScale: 0.006 });
  const faces = new Map();
  /* a coin's face: the note pressed into the gold inside a raised rim; a medal has a red enamel ring and the minute it was earned.
     The machine's own coins are silver with a star, so every gold coin is one that was played */
  function faceMat(c) {
    const key = c.medal ? 'm' + c.medal : c.plain ? '*' : c.note || '♪'; let m = faces.get(key); if (m) return m;
    const N = 256, mid = N / 2, R = N / 2 - 2, font = s => '800 ' + Math.round(s) + 'px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const draw = (g, bump) => {
      g.fillStyle = bump ? '#808080' : '#000'; g.fillRect(0, 0, N, N);
      const sv = c.plain;
      if (!bump) { const r = g.createRadialGradient(mid - 40, mid - 50, 10, mid, mid, R); r.addColorStop(0, sv ? '#FFFFFF' : '#FFE9A8'); r.addColorStop(0.55, sv ? '#D9DEE4' : '#F3C04C'); r.addColorStop(1, sv ? '#A9B0B9' : '#CF931F');
        g.fillStyle = r; g.beginPath(); g.arc(mid, mid, R, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = R * 0.09; g.strokeStyle = bump ? '#FFFFFF' : sv ? '#C4CAD1' : '#E6AE36'; g.beginPath(); g.arc(mid, mid, R * 0.95, 0, Math.PI * 2); g.stroke();   // the raised rim
      g.lineWidth = 3; g.strokeStyle = bump ? '#404040' : sv ? '#8E959E' : '#A86F12'; g.beginPath(); g.arc(mid, mid, R * 0.86, 0, Math.PI * 2); g.stroke();
      if (c.medal) { g.lineWidth = R * 0.17; g.strokeStyle = bump ? '#9A9A9A' : '#B81E2E'; g.beginPath(); g.arc(mid, mid, R * 0.69, 0, Math.PI * 2); g.stroke(); }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = bump ? '#202020' : '#7A4B06';
      if (c.medal) { g.font = font(R * (c.medal > 99 ? 0.6 : 0.78)); g.fillText(String(c.medal), mid, mid - R * 0.08); g.font = font(R * 0.24); g.fillText('min', mid, mid + R * 0.4); }
      else if (c.plain) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.2 : R * 0.46; g.lineTo(mid + Math.cos(a) * r, mid + Math.sin(a) * r); }
        g.closePath(); g.fillStyle = bump ? '#FFFFFF' : '#C9CED5'; g.fill(); }
      else { g.font = font(R * (key.length > 1 ? 1.08 : 1.35)); g.fillText(key, mid, mid + R * 0.08); }
    };
    m = new T.MeshStandardMaterial({ map: tex(N, N, g => draw(g, false), true), bumpMap: tex(N, N, g => draw(g, true)), bumpScale: 0.012, metalness: 1, roughness: 0.27 });
    faces.set(key, m); return m;
  }
  const backMat = faceMat({ plain: true }), goldBack = new T.MeshStandardMaterial({ color: lin('#E9B643'), metalness: 1, roughness: 0.3 });

  // ---------- coin geometry: a rounded rim turned on a lathe, with flat faces top and bottom, merged into one ----------
  function coinGeo(r) {
    const b = TH * 0.4, pts = [];
    for (let i = 0; i <= 4; i++) { const a = Math.PI / 2 - i / 4 * Math.PI / 2; pts.push(new T.Vector2(r - b + Math.cos(a) * b, TH / 2 - b + Math.sin(a) * b)); }
    for (let i = 0; i <= 4; i++) { const a = -i / 4 * Math.PI / 2; pts.push(new T.Vector2(r - b + Math.cos(a) * b, -TH / 2 + b + Math.sin(a) * b)); }
    const rim = new T.LatheGeometry(pts, 40), top = new T.CircleGeometry(r - b, 40), bot = new T.CircleGeometry(r - b, 40);
    top.rotateX(-Math.PI / 2); top.translate(0, TH / 2, 0); bot.rotateX(Math.PI / 2); bot.translate(0, -TH / 2, 0);
    const out = new T.BufferGeometry(), pos = [], nor = [], uv = []; let at = 0;
    [rim, top, bot].forEach((geo, i) => { const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count;
      pos.push.apply(pos, g.attributes.position.array); nor.push.apply(nor, g.attributes.normal.array); uv.push.apply(uv, g.attributes.uv.array); out.addGroup(at, n, i); at += n; });
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    return out;
  }
  const COIN_GEO = coinGeo(C.R * S), MEDAL_GEO = coinGeo(C.MEDAL * S);

  // ---------- the machine ----------
  const box = (w, h, d, mat, x, y, z, shadow) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (shadow) { m.castShadow = true; m.receiveShadow = true; } scene.add(m); return m; };
  const rod = (len, r, mat, x, y, z, axis) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 20), mat); if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2; m.position.set(x, y, z); scene.add(m); return m; };
  // the shelf: deep blue lacquer printed with gold stars and lanes, under a clear coat
  const field = tex(1024, 1024, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#040E22'); bg.addColorStop(1, '#0A2552'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.55); sun.addColorStop(0, 'rgba(90,160,255,.28)'); sun.addColorStop(1, 'rgba(90,160,255,0)'); g.fillStyle = sun; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,205,90,.16)'; g.lineWidth = 3; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(i * w / 6, 0); g.lineTo(i * w / 6, h); g.stroke(); }
    g.fillStyle = 'rgba(255,205,90,.14)';
    for (let i = 0; i < 40; i++) { const x = hash(i, 1) * w, y = hash(i, 2) * h, r = 10 + hash(i, 3) * 18; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? r * 0.42 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(255,205,90,.5)'; for (let i = 0; i < 7; i++) { const x = (i + 0.5) * w / 7, y = h - 46; g.beginPath(); g.moveTo(x - 22, y - 14); g.lineTo(x, y + 12); g.lineTo(x + 22, y - 14); g.lineTo(x, y - 2); g.closePath(); g.fill(); }   // arrows to the edge
  }, true);
  const floorLen = D + 3, floor = new T.Mesh(new T.PlaneGeometry(S, floorLen), new T.MeshPhysicalMaterial({ map: field, roughness: 0.4, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, FRONT - floorLen / 2); floor.receiveShadow = true; scene.add(floor);
  rod(S + 0.3, 0.09, chrome, 0, -0.02, FRONT + 0.05, 'x');                             // the front edge
  box(S + 0.2, -TRAY_Y + 0.1, 0.2, lacquer, 0, TRAY_Y / 2, FRONT + 0.2);                 // under it, the front of the machine
  box(S - 0.6, 0.06, 0.04, led, 0, -0.3, FRONT + 0.31);
  // glass walls on both sides, rimmed in chrome, and the red lacquer cabinet beyond them with gold trim and a light strip
  for (const sx of [-1, 1]) {
    const x = sx * (S / 2 + 0.05);
    box(0.06, 1.5, D + 2, glass, x, 0.75, FRONT - (D + 2) / 2);
    rod(D + 2, 0.06, chrome, x, 1.5, FRONT - (D + 2) / 2, 'z'); rod(D + 2, 0.05, chrome, x, 0.02, FRONT - (D + 2) / 2, 'z');
    box(1.4, 4.2, D + 5.6, lacquer, sx * (S / 2 + 0.8), -0.1, FRONT + 2.6 - (D + 5.6) / 2, true);
    box(0.12, 0.12, D + 5.6, gold, sx * (S / 2 + 0.16), 2.02, FRONT + 2.6 - (D + 5.6) / 2);
    box(0.05, 0.05, D + 5.2, led, sx * (S / 2 + 0.12), 1.9, FRONT + 2.5 - (D + 5.2) / 2);
  }
  // the back wall over the plate, with the coin slot, a display for the last note and a frame of bulbs
  box(S + 2.8, TOP_Y - WALL_Y + 0.2, 0.6, lacquer, 0, (TOP_Y + WALL_Y) / 2 + 0.1, BACK - 0.3, true);
  box(S + 0.4, 0.14, 0.1, gold, 0, WALL_Y + 0.05, BACK + 0.02);
  box(S - 0.8, 0.26, 0.12, dark, 0, SLOT_Y, BACK + 0.02); box(S - 0.6, 0.06, 0.16, chrome, 0, SLOT_Y + 0.16, BACK + 0.04); box(S - 0.6, 0.06, 0.16, chrome, 0, SLOT_Y - 0.16, BACK + 0.04);
  const shown = { note: null };
  const screenCv = document.createElement('canvas'); screenCv.width = 512; screenCv.height = 160;
  const screenTex = new T.CanvasTexture(screenCv); screenTex.encoding = T.sRGBEncoding;
  const screen = new T.Mesh(new T.PlaneGeometry(3.4, 1.06), new T.MeshBasicMaterial({ map: screenTex, toneMapped: false })); screen.position.set(0, WALL_Y + 1.2, BACK + 0.07); scene.add(screen);
  box(3.62, 1.28, 0.08, gold, 0, WALL_Y + 1.2, BACK - 0.02);
  function paintScreen(note) {
    shown.note = note; const g = screenCv.getContext('2d'), w = screenCv.width, h = screenCv.height;
    const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6); bg.addColorStop(0, '#2A0A22'); bg.addColorStop(1, '#0B0209'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#E7A6C9'; g.font = '700 26px Inter, system-ui, sans-serif'; g.fillText(note ? 'LAST NOTE' : 'COIN PUSHER', w / 2, 24);
    g.shadowColor = '#FF9A1F'; g.shadowBlur = 30; g.fillStyle = '#FFD15C'; g.font = '800 ' + (note ? 118 : 56) + 'px Inter, system-ui, sans-serif'; g.fillText(note || 'Play a note', w / 2, 100); g.shadowBlur = 0;
    screenTex.needsUpdate = true;
  }
  paintScreen('');
  // bulbs round the back wall, chasing in three groups
  const glowTex = tex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.25, 'rgba(255,190,90,.6)'); r.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }, true);
  const phases = [0, 1, 2].map(() => ({ bulb: new T.MeshBasicMaterial({ color: lin('#FFE7A8'), toneMapped: false }), glow: new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }) }));
  const bulbGeo = new T.SphereGeometry(0.1, 12, 8); let nb = 0;
  const bulb = (x, y) => { const p = phases[nb++ % 3], m = new T.Mesh(bulbGeo, p.bulb), s = new T.Sprite(p.glow); m.position.set(x, y, BACK + 0.08); s.position.set(x, y, BACK + 0.12); s.scale.set(0.7, 0.7, 1); scene.add(m); scene.add(s); };
  for (let i = 0; i <= 20; i++) bulb(-S / 2 - 0.9 + i * (S + 1.8) / 20, TOP_Y - 0.25);
  for (let i = 0; i <= 12; i++) { const x = -S / 2 + 0.6 + i * (S / 2 - 2.6) / 12; bulb(x, WALL_Y + 1.2 + (i % 2 ? 0.25 : -0.25)); bulb(-x, WALL_Y + 1.2 + (i % 2 ? 0.25 : -0.25)); }   // zigzags either side of the display
  // the plate: chrome, with a red stripe and gold trim along its front; it slides out from under the back wall
  const brushed = tex(16, 256, (g, w, h) => { for (let y = 0; y < h; y++) { const k = 150 + Math.round(hash(y, 9) * 90); g.fillStyle = 'rgb(' + k + ',' + k + ',' + k + ')'; g.fillRect(0, y, w, 1); } });
  brushed.wrapS = brushed.wrapT = T.RepeatWrapping; brushed.repeat.set(1, 3);
  const plateMat = new T.MeshStandardMaterial({ color: lin('#AEB6C0'), metalness: 1, roughness: 0.32, roughnessMap: brushed });
  const plate = new T.Group(), plateBody = new T.Mesh(new T.BoxGeometry(S - 0.04, PLATE_H, 1), plateMat); plateBody.castShadow = true; plateBody.receiveShadow = true; plate.add(plateBody);
  const stripe = new T.Mesh(new T.BoxGeometry(S - 0.04, 0.22, 0.02), new T.MeshPhysicalMaterial({ color: lin('#B0172B'), roughness: 0.3, clearcoat: 1 })); plate.add(stripe);
  const trim = new T.Mesh(new T.BoxGeometry(S - 0.04, 0.07, 0.07), gold); plate.add(trim); scene.add(plate);
  function placePlate() { const zf = BACK + (sim.push * S), z0 = BACK - 2, len = zf - z0;
    plateBody.scale.z = len; plateBody.position.set(0, PLATE_H / 2, z0 + len / 2); stripe.position.set(0, PLATE_H * 0.52, zf + 0.011); trim.position.set(0, PLATE_H - 0.02, zf - 0.02); }
  // the tray the won coins fall into
  const trayW = S - 0.6, trayD = TRAY_Z1 - TRAY_Z0;
  box(trayW, 0.1, trayD, dark, 0, TRAY_Y - 0.05, (TRAY_Z0 + TRAY_Z1) / 2).receiveShadow = true;
  box(trayW, 0.7, 0.1, chrome, 0, TRAY_Y + 0.3, TRAY_Z1 + 0.05); for (const sx of [-1, 1]) box(0.1, 0.7, trayD, chrome, sx * trayW / 2, TRAY_Y + 0.3, (TRAY_Z0 + TRAY_Z1) / 2);
  rod(trayW + 0.2, 0.08, gold, 0, TRAY_Y + 0.66, TRAY_Z1 + 0.06, 'x');
  box(S + 2.8, 1.0, 0.3, lacquer, 0, TRAY_Y - 0.6, TRAY_Z1 + 0.3);

  // ---------- lights ----------
  scene.add(new T.HemisphereLight(lin('#FFE6CC'), lin('#2A0C1E'), 0.45));
  const key = new T.DirectionalLight(lin('#FFF4E6'), 1.5); key.position.set(3, 14, 7); key.target.position.set(0, 0, 0.5); scene.add(key); scene.add(key.target);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  Object.assign(key.shadow.camera, { left: -6.5, right: 6.5, top: 7, bottom: -7, near: 2, far: 30 }); key.shadow.camera.updateProjectionMatrix();
  const warm = new T.PointLight(lin('#FFB060'), 0.9, 16, 2); warm.position.set(0, TOP_Y + 0.5, BACK + 1.5); scene.add(warm);
  const fill = new T.DirectionalLight(lin('#9EB8FF'), 0.35); fill.position.set(-6, 4, 12); scene.add(fill);

  // ---------- sparkles: points that fade out ----------
  const NS = 80, sp = { pos: new Float32Array(NS * 3), col: new Float32Array(NS * 3), v: new Float32Array(NS * 3), t: new Float32Array(NS).fill(1), life: new Float32Array(NS).fill(1), next: 0 };
  const spGeo = new T.BufferGeometry(); spGeo.setAttribute('position', new T.BufferAttribute(sp.pos, 3)); spGeo.setAttribute('color', new T.BufferAttribute(sp.col, 3));
  const sparkles = new T.Points(spGeo, new T.PointsMaterial({ size: 0.35, map: glowTex, vertexColors: true, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  sparkles.frustumCulled = false; scene.add(sparkles);
  function spark(x, y, z, n, up) { if (reduceMotion) return;
    for (let k = 0; k < n; k++) { const i = sp.next++ % NS; sp.pos[i * 3] = x; sp.pos[i * 3 + 1] = y; sp.pos[i * 3 + 2] = z;
      sp.v[i * 3] = (Math.random() - 0.5) * 3; sp.v[i * 3 + 1] = up + Math.random() * up; sp.v[i * 3 + 2] = (Math.random() - 0.3) * 2.5; sp.t[i] = 0; sp.life[i] = 0.4 + Math.random() * 0.3; } }

  // ---------- camera: fitted so the whole machine, back wall to tray, fills the scene below the read-outs ----------
  let W = 0, H = 0, top = 0;
  const PITCH = 0.95, FIT = [[-5.3, TOP_Y, BACK], [5.3, TOP_Y, BACK], [-5.2, TRAY_Y + 0.7, TRAY_Z1 + 0.1], [5.2, TRAY_Y + 0.7, TRAY_Z1 + 0.1], [-5.3, 0, FRONT], [5.3, 0, FRONT]].map(p => new T.Vector3(p[0], p[1], p[2]));
  function fit() {
    const dir = new T.Vector3(0, Math.sin(PITCH), Math.cos(PITCH)), aim = new T.Vector3(0, 0.6, 1.2), v = new T.Vector3();
    const place = d => { camera.position.copy(aim).addScaledVector(dir, d); camera.lookAt(aim); camera.updateMatrixWorld(); };
    const ext = () => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const p of FIT) { v.copy(p).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } return { x0, x1, y0, y1 }; };
    let d = 30;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 5, hi = 80; for (let i = 0; i < 30; i++) { d = (lo + hi) / 2; place(d); const e = ext(); if (e.x0 < -0.97 || e.x1 > 0.97 || e.y0 < -0.97 || e.y1 > 0.97) lo = d; else hi = d; }
      d = hi; place(d); const e = ext(), up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);   // centre it up and down
      aim.addScaledVector(up, (e.y1 + e.y0) / 2 * d * Math.tan(camera.fov * Math.PI / 360));
    }
    place(d);
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return;
    top = Math.round(Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight)); W = w; H = h - top;
    canvas.style.top = top + 'px'; canvas.style.height = H + 'px'; canvas.style.width = w + 'px';
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); fit();
  }

  // ---------- coins: one mesh each, made when a coin first shows and dropped when it is gone ----------
  const meshes = new Map(), qa = new T.Quaternion(), qb = new T.Quaternion(), ax = new T.Vector3(), Y = new T.Vector3(0, 1, 0), X = new T.Vector3(1, 0, 0);
  let stamp = 0;
  function mesh(c, shadow) {
    let m = meshes.get(c.id);
    if (!m) { m = new T.Mesh(c.medal ? MEDAL_GEO : COIN_GEO, c.plain ? [silverRim, faceMat(c), backMat] : [rimMat, faceMat(c), goldBack]); m.receiveShadow = true; m.userData.yaw = (hash(c.id, 4) - 0.5) * 0.6; scene.add(m); meshes.set(c.id, m); }
    m.castShadow = shadow; m.userData.seen = stamp; return m;
  }
  /* a coin lying on the shelf: flat, or tipped up on the edge of one it has slid onto (the later coin lies on top) */
  function lie(c, m, list) {
    let best = null, bk = 0;
    for (const o of list) { if (o === c || o.id > c.id) continue; const dx = o.x - c.x, dy = o.y - c.y, rr = o.r + c.r; if (Math.abs(dx) >= rr || Math.abs(dy) >= rr) continue;
      const d = Math.hypot(dx, dy), k = Math.min(1, (rr - d) / (0.9 * Math.min(o.r, c.r))); if (d < rr && k > bk) { bk = k; best = { dx: dx, dy: dy, d: d }; } }
    qa.setFromAxisAngle(Y, m.userData.yaw);
    if (best) { ax.set(-best.dy / (best.d || 1), 0, best.dx / (best.d || 1)); qb.setFromAxisAngle(ax, Math.atan2(TH, 2 * c.r * S) * bk * 1.6); m.quaternion.multiplyQuaternions(qb, qa); }
    else m.quaternion.copy(qa);
    m.position.set((c.x - 0.5) * S, TH / 2 + TH * 0.9 * bk, BACK + c.y * S);
  }
  // the tray: the latest coins won, each dropped on the heap where it lands
  let heapKey = '', heap = [];
  function placeHeap(list) {
    const k = list.length + ':' + (list.length ? list[0].id + '-' + list[list.length - 1].id : ''); if (k === heapKey) return; heapKey = k; heap = [];
    for (const c of list) { const r = c.r * S, x = -trayW / 2 + r + 0.1 + hash(c.id, 5) * (trayW - 2 * r - 0.2), z = TRAY_Z0 + r + hash(c.id, 6) * Math.max(0.01, trayD - 2 * r); let y = TRAY_Y + TH / 2;
      for (const o of heap) if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.9) y = Math.max(y, o.y + TH * 0.95);
      heap.push({ c: c, x: x, y: y, z: z, r: r, rx: (hash(c.id, 7) - 0.5) * 0.3, rz: (hash(c.id, 8) - 0.5) * 0.3 }); }
  }

  const BULB = lin('#FFE7A8'), LED = lin('#FFB45A');
  let clock = 0, flash = 0, beat = 0, slow = 0;
  function event(e) {
    if (e.k === 'land') { beat = 1; spark((e.c.x - 0.5) * S, TH, BACK + e.c.y * S, 3, 1.2); }
    if (e.k === 'won') spark((e.c.x - 0.5) * S, 0.1, FRONT + 0.1, 7, 2.5);
    if (e.k === 'medal') flash = reduceMotion ? 0 : 1;
  }
  function reset() { flash = 0; beat = 0; sp.t.fill(1); }

  /* v: {running, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W) resize(); if (!W) return;
    clock += dt; stamp++; beat = Math.max(0, beat - dt * 3); flash = Math.max(0, flash - dt * 0.8);
    // a phone that cannot keep up draws fewer pixels
    slow = dt > 0.03 ? slow + dt : Math.max(0, slow - dt * 0.5);
    if (slow > 2 && dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); slow = 0; }
    if (sim.last !== shown.note) paintScreen(sim.last);
    placePlate();
    const glow = Math.min(1, beat * 0.5 + flash + (v.music ? v.level * 0.7 : 0)), on = Math.floor(clock * 7);
    phases.forEach((p, i) => { const lit = reduceMotion ? i === 0 : (on + i) % 3 === 0 || flash > 0.4, k = lit ? 1 : 0.18;
      p.bulb.color.copy(BULB).multiplyScalar(lit ? 1.6 : 0.35); p.glow.opacity = k * (0.6 + glow * 0.4); });
    warm.intensity = 0.7 + glow * 0.8; led.color.copy(LED).multiplyScalar(1 + glow * 0.8);
    // coins on the shelf, in the air, falling into the tray, and in it
    const cs = sim.coins;
    for (const c of cs) lie(c, mesh(c, true), cs);
    for (const c of sim.air) { const m = mesh(c, true), k = Math.min(1, c.z / C.DROP), zl = BACK + c.y * S;
      m.position.set((c.x - 0.5) * S, TH / 2 + k * (SLOT_Y - TH / 2), zl + (BACK + 0.3 - zl) * k);
      qa.setFromAxisAngle(X, k * (Math.PI / 2 - 0.25)); qb.setFromAxisAngle(Y, m.userData.yaw * (1 - k) + (reduceMotion ? 0 : Math.sin(c.spin) * 0.35 * k)); m.quaternion.multiplyQuaternions(qb, qa); }
    const falling = new Set();
    for (const f of sim.falling) { const c = f.c, m = mesh(c, true), t = f.t / C.AIR, zt = TRAY_Z0 + 0.6 + hash(c.id, 6) * (trayD - 1.2); falling.add(c.id);
      m.position.set((c.x - 0.5) * S, TH / 2 + 0.5 * t - (TH / 2 - TRAY_Y + 0.5) * t * t, FRONT + (zt - FRONT) * t);
      qa.setFromAxisAngle(X, (reduceMotion ? 0 : t * Math.PI * 2)); qb.setFromAxisAngle(Y, m.userData.yaw); m.quaternion.multiplyQuaternions(qb, qa); }
    placeHeap(sim.tray);
    for (const p of heap) { if (falling.has(p.c.id)) continue; const m = mesh(p.c, false); m.position.set(p.x, p.y, p.z); m.rotation.set(p.rx, m.userData.yaw * 3, p.rz); }
    for (const [id, m] of meshes) if (m.userData.seen !== stamp) { scene.remove(m); meshes.delete(id); }
    // sparkles
    for (let i = 0; i < NS; i++) { if (sp.t[i] >= sp.life[i]) { sp.col[i * 3] = sp.col[i * 3 + 1] = sp.col[i * 3 + 2] = 0; continue; }
      sp.t[i] += dt; const k = Math.max(0, 1 - sp.t[i] / sp.life[i]); sp.v[i * 3 + 1] -= 9 * dt;
      for (let a = 0; a < 3; a++) sp.pos[i * 3 + a] += sp.v[i * 3 + a] * dt;
      sp.col[i * 3] = k; sp.col[i * 3 + 1] = 0.8 * k; sp.col[i * 3 + 2] = 0.45 * k; }
    spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
    renderer.toneMappingExposure = 1.1 + flash * 0.5;
    renderer.render(scene, camera);
  }
  return { resize: resize, draw: draw, event: event, reset: reset };
}

/* the flat stand-in, drawn on a 2D canvas while three.js loads (or if it cannot) */
function makeFlatCoins(cv, hud, sim, MT) {
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
