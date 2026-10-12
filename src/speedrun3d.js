/* Speedrun theme in 3D: the same blocky world seen from over the player's shoulder, drawn with three.js r128 (loaded the first time the
   theme is shown, as City does). Until it has loaded, or if it can't, the flat view in src/speedrun.js draws instead.
   Everything about the run comes from RunSim in the core, and the textures and the world's blocks from the flat view; this only draws them. */
/* exported makeRun3DView */   // used by src/app.js, which the build puts after this file
function makeRun3DView(cv, hud, sim, flat) {
  'use strict';
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const view = { ready: false, failed: false };
  let api = null, loading = false, failedAt = 0;
  /* load three.js once, sharing City's script if it is already on its way, so the page never holds two copies */
  view.ensure = function () {
    if (view.ready || loading || (view.failed && Date.now() - failedAt < 10e3)) return;
    loading = true;
    new Promise((res, rej) => {
      if (window.THREE) return res();
      let s = document.querySelector('script[src="' + THREE_URL + '"]');
      if (!s) { s = document.createElement('script'); s.src = THREE_URL; s.async = true; document.head.appendChild(s); }
      s.addEventListener('load', () => res()); s.addEventListener('error', () => { s.remove(); rej(new Error('three.js did not load')); });
    }).then(() => { api = build(); view.ready = true; view.failed = false; loading = false; api.resize(); })
      .catch(() => { view.failed = true; failedAt = Date.now(); loading = false; });
  };
  view.resize = () => { if (api) api.resize(); };
  view.reset = () => { if (api) api.reset(); };
  view.event = e => { if (api) api.event(e); };
  view.draw = (v, dt) => { if (api) api.draw(v, dt); };
  return view;

  function build() {
    const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, TAU = Math.PI * 2, T = flat.T, hash = flat.hash;
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
    scene.add(camera);
    const SKY = [0x9CC4FF, 0x4A120C, 0x18181F, 0x0B0716], FAR = [44, 30, 26, 46];
    const sky = new THREE.Color(SKY[0]); scene.background = sky; scene.fog = new THREE.Fog(sky, 18, FAR[0]);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x6a5a48, 0.62); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.5); sun.position.set(-0.4, 1, 0.7); scene.add(sun);
    const LIGHT = [[0.62, 0.5], [0.6, 0.3], [0.5, 0.2], [0.55, 0.3]];

    /* ---------- materials, from the flat view's 16-pixel textures ---------- */
    const tex = c => { const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; return t; };
    const lam = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ map: tex(c) }, o || {}));
    const MAT = {};
    for (const k of ['dirt', 'stone', 'coal', 'iron', 'diamond', 'leaves', 'obsidian', 'redrock', 'brick', 'stonebrick', 'mossy', 'endstone', 'frame']) MAT[k] = lam(T[k]);
    { const side = lam(T.grass), top = lam(T.grassTop); MAT.grass = [side, side, top, MAT.dirt, side, side]; }   // faces: +x, -x, +y, -y, +z, -z
    { const bark = lam(T.log), end = lam(T.logTop); MAT.log = [bark, bark, end, end, bark, bark]; }
    MAT.glow = lam(T.glow, { emissive: 0xffd27a, emissiveIntensity: 0.55, emissiveMap: tex(T.glow) });
    MAT.crystal = lam(T.crystal, { emissive: 0xff7ae0, emissiveIntensity: 0.6, emissiveMap: tex(T.crystal) });
    MAT.lava = new THREE.MeshBasicMaterial({ map: tex(T.lava) });
    const box = new THREE.BoxGeometry(1, 1, 1), M4 = new THREE.Matrix4(), MAX = { stonebrick: 2600, grass: 1200, dirt: 1600, leaves: 1600, lava: 1400, endstone: 2200, redrock: 1800 };
    const LISTS = {};
    for (const k in MAT) { const m = new THREE.InstancedMesh(box, MAT[k], MAX[k] || 900); m.count = 0; m.frustumCulled = false; scene.add(m); LISTS[k] = { mesh: m, n: 0, max: MAX[k] || 900 }; }
    const torch = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), new THREE.MeshBasicMaterial({ color: 0xffd86b }), 40); torch.count = 0; torch.frustumCulled = false; scene.add(torch);
    const cloud = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.85 }), 40); cloud.count = 0; cloud.frustumCulled = false; scene.add(cloud);
    let torchN = 0, cloudN = 0;
    const add = (k, x, y, z) => { const L = LISTS[k]; if (L.n >= L.max) return; M4.makeTranslation(x + 0.5, y + 0.5, z); L.mesh.setMatrixAt(L.n++, M4); };

    /* ---------- the world, rebuilt as the player moves on a block, or a block is mined ---------- */
    const sideH = (c, z) => Math.max(0, Math.min(4, Math.round((Math.abs(z) - 2) * 0.32 + Math.sin(c * 0.17 + z * 0.45) * 1.1 + Math.sin(c * 0.05 - z * 0.3) * 0.8)));   // rolling hills to the sides
    function column(c) {
      const w = sim.worldAt(c), h = sim.groundAt(c);
      if (w === 0) {                                                       // green land: the path, hills rising to the sides, trees, clouds
        for (let z = -10; z <= 5; z++) { const top = Math.abs(z) <= 1 ? h : h + Math.max(0, sideH(c, z)), deep = Math.abs(z) <= 2 ? 4 : 2;
          for (let r = top - 1, d = 0; d < deep; r--, d++) add(flat.surface(0, d, c, hash(c * 16 + z, r)), c, r, z); }
        for (const z of [-4, -7]) if (hash(c, 91 + z) < 0.2) { const b = h + Math.max(0, sideH(c, z)), t = 3 + Math.floor(hash(c, 93 + z) * 2);   // trees on the far side only, clear of the view
          for (let r = 0; r < t; r++) add('log', c, b + r, z);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let r = t - 1; r <= t; r++) if (dx || dz || r === t) add('leaves', c + dx, b + r, z + dz);
          add('leaves', c, b + t + 1, z); }
        if (cloudN < 40 && hash(c, 97) < 0.12) { M4.makeScale(3 + hash(c, 98) * 4, 1, 2 + hash(c, 99) * 3); M4.setPosition(c, 15 + hash(c, 96) * 3, -6 + hash(c, 95) * 10); cloud.setMatrixAt(cloudN++, M4); }
      } else if (w === 1) {                                                // the fire world: a rock causeway over a lava sea, glowing rock in it
        for (let z = -2; z <= 2; z++) for (let r = h - 1, d = 0; r >= -2; r--, d++) add(flat.surface(1, d, c, hash(c * 16 + z, r)), c, r, z);
        for (let z = -12; z <= 8; z++) if (Math.abs(z) > 2) add('lava', c, -2, z);
        if (hash(c, 81) < 0.12) { const z = -5 - Math.floor(hash(c, 82) * 6), t = 2 + Math.floor(hash(c, 83) * 7); for (let r = -1; r < t; r++) add(r === t - 1 && hash(c, 84) < 0.5 ? 'glow' : 'redrock', c, r, z); }
      } else if (w === 2) {                                                // the stronghold: a stone brick corridor with torches
        for (let z = -3; z <= 3; z++) { add(flat.surface(2, 0, c, 0), c, -1, z); add((c * 5 + z * 3) % 13 ? 'stonebrick' : 'mossy', c, 6, z); }
        for (const z of [-4, 4]) for (let r = -1; r < 7; r++) add((c * 7 + r * 3 + z) % 11 ? 'stonebrick' : 'mossy', c, r, z);   // walls clear of the camera
        if (c % 6 === 0 && torchN < 40) { M4.makeTranslation(c + 0.5, 2.6, -3.4); torch.setMatrixAt(torchN++, M4); }
      } else {                                                             // the End: floating islands of pale stone, pillars far off
        for (let z = -3; z <= 3; z++) { const low = -2 - Math.floor(hash(c * 16 + z, 77) * 3) + (Math.abs(z) === 3 ? 1 : 0); for (let r = h - 1; r >= low; r--) add('endstone', c, r, z); }
        if (c % 7 === 0) { const z = hash(c, 71) < 0.5 ? -9 - Math.floor(hash(c, 72) * 4) : 7 + Math.floor(hash(c, 72) * 3), t = 5 + Math.floor(hash(c, 73) * 7);
          for (let r = -3; r < t; r++) { add('obsidian', c, r, z); add('obsidian', c + 1, r, z); } add('crystal', c, t, z); }
      }
    }
    const portalMeshes = [0, 1, 2].map(i => { const cvs = document.createElement('canvas'); cvs.width = cvs.height = 32; const t = new THREE.CanvasTexture(cvs); t.magFilter = THREE.NearestFilter;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: i === 2 ? 1 : 0.82, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.y = Math.PI / 2; m.visible = false; scene.add(m); return { m: m, c: cvs, t: t, kind: i }; });
    function rebuild(c0, c1) {
      for (const k in LISTS) LISTS[k].n = 0; torchN = 0; cloudN = 0;
      for (let c = c0; c <= c1; c++) column(c);
      for (const o of sim.obs) { if (o.x < c0 || o.x > c1) continue; const h = sim.groundAt(o.x);   // the blocks to mine, standing on the path
        if (o.type === 'log') { for (let r = 0; r < 4; r++) add('log', o.x, h + r, 0);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let r = 3; r <= 4; r++) if (dx || dz || r === 4) add('leaves', o.x + dx, h + r, dz);
          add('leaves', o.x, h + 5, 0); }
        else add(o.type, o.x, h, 0); }
      sim.portals.forEach((p, i) => { const h = sim.groundAt(p), f = i === 2 ? 'frame' : 'obsidian', P = portalMeshes[Math.min(2, i)], on = p >= c0 - 2 && p <= c1;
        P.m.visible = on; if (!on) return;
        for (let r = 0; r < 4; r++) { add(f, p, h + r, -2); add(f, p, h + r, 2); } for (let z = -1; z <= 1; z++) add(f, p, h + 3, z);
        P.m.position.set(p + 0.5, h + 1.5, 0); P.m.scale.set(1, 1, 1); });
      for (const k in LISTS) { const L = LISTS[k]; L.mesh.count = L.n; L.mesh.instanceMatrix.needsUpdate = true; }
      torch.count = torchN; torch.instanceMatrix.needsUpdate = true; cloud.count = cloudN; cloud.instanceMatrix.needsUpdate = true;
    }
    function paintPortal(P) {
      const x = P.c.getContext('2d');
      if (P.kind === 2) { x.fillStyle = '#05060E'; x.fillRect(0, 0, 32, 32); for (let i = 0; i < 26; i++) { x.fillStyle = i % 3 ? '#7CE0B8' : '#FFFFFF'; x.fillRect(Math.floor(hash(i, 5) * 32), Math.floor((hash(i, 6) * 32 + clock * 5 * (0.5 + hash(i, 7))) % 32), 1, 1); } }
      else { x.fillStyle = '#7A2BD6'; x.fillRect(0, 0, 32, 32); for (let i = 0; i < 40; i++) { const k = (clock * 0.6 * (0.6 + hash(i, 8)) + hash(i, 9)) % 1; x.fillStyle = i % 2 ? '#C79BFF' : '#5A1BA8'; x.fillRect(Math.floor(hash(i, 10) * 30), Math.floor(32 - k * 34), 2, 1); } }
      P.t.needsUpdate = true;
    }

    /* ---------- the player: an original blocky figure in an orange hoodie, facing along the run (+x) ---------- */
    const PX = 1.8 / 32, bm = c => new THREE.MeshLambertMaterial({ color: c });
    const face = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
      x.fillStyle = '#E0A77A'; x.fillRect(0, 0, 8, 8); x.fillStyle = '#4A2E1A'; x.fillRect(0, 0, 8, 2); x.fillRect(0, 2, 1, 1); x.fillRect(7, 2, 1, 1);
      x.fillStyle = '#FFFFFF'; x.fillRect(1, 4, 2, 1); x.fillRect(5, 4, 2, 1); x.fillStyle = '#2B4A8C'; x.fillRect(2, 4, 1, 1); x.fillRect(5, 4, 1, 1); x.fillStyle = '#A9684A'; x.fillRect(3, 6, 2, 1);
      return lam(c); })();
    const hairSide = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#E0A77A'; x.fillRect(0, 0, 8, 8); x.fillStyle = '#4A2E1A'; x.fillRect(0, 0, 8, 3); x.fillRect(0, 0, 3, 6); return lam(c); })();
    const hair = bm(0x4A2E1A), skin = bm(0xE0A77A), hood = bm(0xD9573B), sleeve = bm(0xC24C33), jeans = bm(0x3B4A7A), shoe = bm(0x2A2A2A);
    const part = (w, h, d, mats, y) => { const g = new THREE.BoxGeometry(w * PX, h * PX, d * PX); g.translate(0, y * PX, 0); return new THREE.Mesh(g, mats); };
    const man = new THREE.Group(); scene.add(man);
    const pivot = (x, y, z) => { const g = new THREE.Group(); g.position.set(x * PX, y * PX, z * PX); man.add(g); return g; };
    const legs = [-2, 2].map(z => { const p = pivot(0, 12, z); p.add(part(4, 10, 4, jeans, -5)); p.add(part(4.05, 2, 4.05, shoe, -11)); return p; });
    man.add(part(4, 12, 8, hood, 18));
    const head = pivot(0, 24, 0); head.add(part(8, 8, 8, [face, hair, hair, skin, hairSide, hairSide], 4));
    const arms = [-6, 6].map(z => { const p = pivot(0, 23.5, z); p.add(part(4, 9, 4, sleeve, -3.5)); p.add(part(4, 3, 4, skin, -9.5)); return p; });
    const pickMats = flat.TOOL.map(c => c ? new THREE.MeshLambertMaterial({ map: tex(c), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }) : null);
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(16 * PX * 0.95, 16 * PX * 0.95), pickMats[1]);
    { const g = new THREE.Group(); g.position.set(0, -10 * PX, 2.3 * PX); g.rotation.z = -Math.PI / 4; pick.position.set(6.5 * PX * 0.95, 6.5 * PX * 0.95, 0); g.add(pick); arms[1].add(g); }   // the end of the handle in the hand
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

    /* ---------- the crack on the block being mined, pieces of blocks, the dropped item, the dragon, stars, a flash ---------- */
    const crackMats = flat.CRACK.map(c => new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMats[0]); crack.visible = false; scene.add(crack);
    const NB = 120, bitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshBasicMaterial(), NB); bitMesh.frustumCulled = false;
    bitMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NB * 3), 3); bitMesh.count = 0; scene.add(bitMesh);
    const bits = [], COL = new THREE.Color();
    const item = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), MAT.stone); item.visible = false; scene.add(item); let itemT = 9;
    const dragon = new THREE.Group(); scene.add(dragon);
    { const dk = bm(0x2C1D40), wg = new THREE.MeshLambertMaterial({ color: 0x4A3168, side: THREE.DoubleSide }), eye = new THREE.MeshBasicMaterial({ color: 0xD27BFF });
      const b = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); dragon.add(o); return o; };
      b(4, 1, 1.2, dk, 0, 0, 0); b(1.4, 0.9, 1, dk, 2.5, 0.2, 0); b(0.2, 0.2, 0.3, eye, 3.2, 0.4, 0.3); b(0.2, 0.2, 0.3, eye, 3.2, 0.4, -0.3); b(2.5, 0.5, 0.5, dk, -3, 0.1, 0); b(1.5, 0.35, 0.35, dk, -4.8, 0.2, 0);
      dragon.userData.wings = [1, -1].map(s => { const p = new THREE.Group(); p.position.set(0, 0.4, 0.6 * s); const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.4), wg); w.rotation.x = Math.PI / 2; w.position.z = 1.7 * s; p.add(w); dragon.add(p); return p; }); }
    dragon.visible = false;
    const starGeo = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 400; i++) { const a = Math.random() * TAU, e = Math.random() * 1.2 - 0.2, r = 90; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })); stars.visible = false; scene.add(stars);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    const flashQ = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), flashMat); flashQ.position.z = -0.5; flashQ.renderOrder = 9; camera.add(flashQ);

    let W = 0, clock = 0, showX = sim.x, footY = 0, camY = 0, walkT = 0, swing = 0, beat = 0, flash = 0, world = -1, key = '', lastBroke = null, lastSplit = sim.split;
    function resize() {
      const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return;
      W = w; renderer.setSize(w, h, false);
      const top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight), d = Math.max(0, top + (h - top) * 0.42 - h / 2);   // aim the view at the scene below the read-outs
      camera.aspect = w / (h + 2 * d); camera.setViewOffset(w, h + 2 * d, 0, 0, w, h); camera.updateProjectionMatrix();
    }
    function reset() { bits.length = 0; showX = sim.x; footY = camY = sim.groundAt(Math.floor(sim.x)); flash = 0; key = ''; lastBroke = sim.broke; lastSplit = sim.split; itemT = 9; }
    function burst(x, y, z, type, n, sp) {
      if (RM) return; const cols = flat.BITS[type] || ['#888888'];
      for (let i = 0; i < n; i++) { if (bits.length >= NB) bits.shift(); bits.push({ x: x, y: y, z: z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.7) * sp, vy: 1.5 + Math.random() * sp, vz: (Math.random() - 0.5) * sp, t: 0, life: 0.6 + Math.random() * 0.5, c: cols[i % cols.length] }); }
    }
    function event(e) { if (e === 'note') beat = 1; if (e === 'split' || e === 'done') flash = RM ? 0 : e === 'done' ? 0.6 : 0.3; }

    function draw(v, dt) {
      if (!W) resize(); if (!W) return;
      clock += dt; beat = Math.max(0, beat - dt * 3);
      if (Math.abs(sim.x - showX) > 30) { showX = sim.x; footY = camY = sim.groundAt(Math.floor(sim.x)); }
      const was = showX; showX += (sim.x - showX) * Math.min(1, dt * 10); if (showX > was + 1e-4) walkT += dt;
      // the world around the player, rebuilt when it moves on a block or a block goes
      const c = Math.floor(showX), k = c + '|' + sim.obs.length + '|' + sim.mined + '|' + sim.portals.length + '|' + sim.split;
      if (k !== key) { key = k; rebuild(c - 7, c + 40); }
      // sky, fog and light for the world the player is in; a flash on passing through a portal
      const w = sim.worldAt(showX);
      if (w !== world) { if (world >= 0) flash = RM ? 0 : 0.75; world = w; flashMat.color.set(w === 1 ? 0xffb27a : w === 3 ? 0xe2b8ff : 0xffffff); }
      sky.lerp(COL.set(SKY[world]), Math.min(1, dt * 3)); scene.fog.color.copy(sky); scene.fog.far += (FAR[world] - scene.fog.far) * Math.min(1, dt * 2);
      hemi.intensity += (LIGHT[world][0] - hemi.intensity) * Math.min(1, dt * 2); sun.intensity += (LIGHT[world][1] - sun.intensity) * Math.min(1, dt * 2);
      stars.visible = world === 3; stars.position.set(showX, 0, 0);
      for (const P of portalMeshes) if (P.m.visible && (P.kind === 2 || Math.floor(clock * 12) % 2 === 0)) paintPortal(P);
      // the player and the camera over its shoulder
      const ground = sim.groundAt(Math.floor(showX)); footY += (ground - footY) * Math.min(1, dt * 14); camY += (footY - camY) * Math.min(1, dt * 3);
      const mode = sim.mode, walking = mode === 'walk' && showX > was + 1e-4, mining = mode === 'mine' && v.running;
      man.position.set(showX, footY + (walking && !RM ? Math.abs(Math.sin(walkT * 9)) * 0.05 : 0), 0);
      const leg = walking && !RM ? Math.sin(walkT * 9) * 0.6 : 0;
      legs[0].rotation.z = leg; legs[1].rotation.z = -leg; arms[0].rotation.z = -leg * 0.8;
      if (mining) { const s0 = swing; swing = (swing + dt * (2.3 + beat * 1.5)) % 1;
        if (s0 < 0.5 && swing >= 0.5) { const o = sim.target; burst(o.x + 0.05, sim.groundAt(o.x) + 0.5, 0, o.type, 4, 1.8); } }
      else swing = 0;
      arms[1].rotation.z = mining ? 0.6 + 2.0 * (0.5 + 0.5 * Math.cos(swing * TAU)) : walking && !RM ? leg * 0.8 : 0.25;
      head.rotation.z = mining ? -0.18 : 0;
      const tier = Math.min(flat.TOOL.length - 1, sim.split); pick.visible = !!pickMats[tier]; if (pickMats[tier]) pick.material = pickMats[tier];
      shadow.position.set(showX, footY + 0.02, 0);
      camera.position.set(showX - 6.6, camY + 4.4, 2.3); camera.lookAt(showX + 5, camY + 0.5, -0.3);
      // the block being mined: cracks; when it breaks, its pieces and the item it drops
      const o = sim.target;
      crack.visible = mode === 'mine' && sim.dig > 0.02;
      if (crack.visible) { crack.material = crackMats[Math.min(3, Math.floor(sim.dig * 4))]; crack.position.set(o.x + 0.5, sim.groundAt(o.x) + 0.5, 0); }
      if (sim.broke && sim.broke !== lastBroke) { lastBroke = sim.broke; const b = lastBroke, h = sim.groundAt(b.x); burst(b.x + 0.5, h + 0.5, 0, b.type, 22, 3.2);
        if (!RM) { item.material = MAT[b.type] || MAT.stone; itemT = 0; item.position.set(b.x + 0.5, h + 0.4, 0); } }
      if (sim.split > lastSplit) burst(showX, footY + 2.2, 0, 'crystal', 30, 4); lastSplit = sim.split;
      itemT += dt; item.visible = itemT < 1.2;
      if (item.visible) { item.rotation.y += dt * 3; item.position.y += dt * 0.8; item.position.x += (showX + 0.2 - item.position.x) * Math.min(1, dt * 3); item.scale.setScalar(Math.max(0.01, 1 - Math.max(0, itemT - 0.8) / 0.4)); }
      let n = 0;
      for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.t += dt; if (b.t >= b.life) { bits.splice(i, 1); continue; }
        b.vy -= 14 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; const fl = sim.groundAt(Math.floor(b.x)); if (b.y < fl + 0.07) { b.y = fl + 0.07; b.vy *= -0.3; b.vx *= 0.6; b.vz *= 0.6; } }
      for (const b of bits) { M4.makeScale(1 - b.t / b.life, 1 - b.t / b.life, 1 - b.t / b.life); M4.setPosition(b.x, b.y, b.z); bitMesh.setMatrixAt(n, M4); bitMesh.setColorAt(n, COL.set(b.c)); n++; }
      bitMesh.count = n; bitMesh.instanceMatrix.needsUpdate = true; if (bitMesh.instanceColor) bitMesh.instanceColor.needsUpdate = true;
      // the dragon circles over the End until the last split
      dragon.visible = world === 3 && !sim.done;
      if (dragon.visible) { const a = clock * 0.32, R = 9; dragon.position.set(showX + 16 + Math.cos(a) * R, camY + 7 + Math.sin(clock * 0.9), -3 + Math.sin(a) * R); dragon.rotation.y = -a - Math.PI;
        const f = RM ? 0.2 : Math.sin(clock * 4) * 0.6; dragon.userData.wings[0].rotation.x = f; dragon.userData.wings[1].rotation.x = -f; }
      if (flash > 0) { flashMat.opacity = Math.min(1, flash); flash -= dt * 1.8; } else flashMat.opacity = 0;
      flashQ.visible = flashMat.opacity > 0;
      renderer.render(scene, camera);
    }
    return { resize: resize, reset: reset, event: event, draw: draw };
  }
}
