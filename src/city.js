/* City theme, after "Block City Defense": a voxel city at dusk, three cannons, and asteroids falling while the session runs.
   The cannons only fire while an instrument is heard, and reload faster the higher the power (efficiency). While nothing is
   played the asteroids get through. Playing pays for repairs: a lost cannon is rebuilt after 10 s of playing, and a fallen
   building rises again every 15 s of playing. The camera is fixed, and asteroids only fall where it can see them. The higher the power, the faster the reload and the steadier the aim. Pause freezes the sky. three.js is loaded the first time the theme is shown. */
function makeCityView(host) {
  'use strict';
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const CANNON_EVERY = 10, BUILD_EVERY = 15;
  const view = { ready: false, failed: false, loading: false, used: false, events: [], stats: { down: 0, imp: 0, rebuilt: 0, cannons: 3, standing: 0, total: 0 }, next: null };
  let api = null, promise = null;
  view.ensure = function () {
    if (promise) return promise;
    view.loading = true;
    promise = new Promise((res, rej) => {
      if (window.THREE) return res();
      const s = document.createElement('script'); s.src = THREE_URL; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('three.js did not load'));
      document.head.appendChild(s);
    }).then(() => { api = build(); view.ready = true; view.loading = false; view.resize(); })
      .catch(e => { view.failed = true; view.loading = false; view.error = String(e && e.message || e); });
    return promise;
  };
  view.reset = () => { view.events.length = 0; if (api) api.reset(); };
  view.resize = () => { if (api) api.resize(); };
  view.frame = (dt, inp) => { if (api) api.frame(dt, inp); };
  view.simulate = (sec, inp) => api ? api.simulate(sec, inp) : null;
  return view;

  function build() {
    const events = view.events;
    let armed = false, power = 0, cannonT = 0, buildT = 0;
    const V3 = THREE.Vector3;
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- renderer / scene ----------
    const canvas = host.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const FOG = new THREE.Color(0xd9835f);
    scene.fog = new THREE.Fog(FOG, 90, 330);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    const tmp = new V3(), tmp2 = new V3();

    function pix(n, fn) {
      const c = document.createElement('canvas'); c.width = c.height = n;
      const g = c.getContext('2d');
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = fn(x, y); g.fillRect(x, y, 1, 1); }
      return toTex(c);
    }
    function toTex(c) {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    }
    const gray = v => `rgb(${v | 0},${v | 0},${v | 0})`;
    const noiseTex = pix(16, () => gray(rand(190, 255)));
    const rockTex = pix(8, () => gray(rand(140, 255)));

    // ---------- sky ----------
    const skyGroup = new THREE.Group(); scene.add(skyGroup);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x0e1342) }, mid: { value: new THREE.Color(0x5b2f6b) }, hor: { value: FOG.clone() } },
      vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 mid;uniform vec3 hor;varying vec3 vD;void main(){float h=normalize(vD).y;vec3 c=mix(hor,mid,smoothstep(0.0,0.28,h));c=mix(c,top,smoothstep(0.28,0.85,h));gl_FragColor=vec4(c,1.0);}'
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), skyMat);
    sky.renderOrder = -3; skyGroup.add(sky);
    {
      const sp = [];
      for (let i = 0; i < 520; i++) {
        const u = Math.random() * Math.PI * 2, r = 650, y = rand(0.22, 1) * r, rr = Math.sqrt(r * r - y * y);
        sp.push(Math.cos(u) * rr, y, Math.sin(u) * rr);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
      stars.renderOrder = -2; skyGroup.add(stars);
      const moonTex = pix(8, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? gray(190) : gray(rand(228, 248))));
      const moon = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), new THREE.MeshBasicMaterial({ map: moonTex, fog: false, depthWrite: false }));
      moon.position.set(-260, 330, -480); moon.lookAt(0, 0, 0); moon.renderOrder = -2; skyGroup.add(moon);
    }

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xb0a4ff, 0x4a3020, 0.72));
    const sun = new THREE.DirectionalLight(0xffd2b0, 0.8); sun.position.set(-50, 60, 45); scene.add(sun);
    const flash = new THREE.PointLight(0xffaa55, 0, 80, 2); scene.add(flash);

    // ---------- ground (voxel columns) ----------
    const GN = 110, HALF = 55, BOTTOM = -10;
    const heights = new Float32Array(GN * GN);
    const baseCol = new Float32Array(GN * GN * 3);
    const ground = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ map: noiseTex }), GN * GN);
    ground.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GN * GN * 3), 3);
    scene.add(ground);
    const shade = (c, j) => { const k = rand(-j, j); return [c[0] + k, c[1] + k, c[2] + k]; };
    const cityCell = (cx, cz) => cx >= -33 && cx < 33 && cz >= -40 && cz < -4;
    const isRoad = (cx, cz) => (cx + 33) % 6 === 0 || (cz + 40) % 6 === 0;
    for (let i = 0; i < GN * GN; i++) {
      const cx = (i % GN) - HALF, cz = ((i / GN) | 0) - HALF;
      let c;
      if (cityCell(cx, cz)) c = isRoad(cx, cz) ? shade([0.24, 0.24, 0.27], 0.03) : shade([0.56, 0.56, 0.54], 0.05);
      else c = Math.random() < 0.08 ? [0.34, 0.52, 0.2] : shade([0.38, 0.62, 0.25], 0.05);
      baseCol.set(c, i * 3);
    }
    function setCell(i) {
      const cx = i % GN, cz = (i / GN) | 0, h = heights[i];
      dummy.position.set(cx - HALF + 0.5, (h + BOTTOM) / 2, cz - HALF + 0.5);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, h - BOTTOM, 1); dummy.updateMatrix();
      ground.setMatrixAt(i, dummy.matrix);
    }
    const setCol = (i, c) => ground.instanceColor.setXYZ(i, c[0], c[1], c[2]);
    const restoreCol = i => ground.instanceColor.setXYZ(i, baseCol[i * 3], baseCol[i * 3 + 1], baseCol[i * 3 + 2]);
    function cellIdx(x, z) {
      const cx = Math.floor(x) + HALF, cz = Math.floor(z) + HALF;
      if (cx < 0 || cz < 0 || cx >= GN || cz >= GN) return -1;
      return cz * GN + cx;
    }
    const groundH = (x, z) => { const i = cellIdx(x, z); return i < 0 ? 0 : heights[i]; };
    function groundDirty() { ground.instanceMatrix.needsUpdate = true; ground.instanceColor.needsUpdate = true; }
    function resetGround() { heights.fill(0); for (let i = 0; i < GN * GN; i++) { setCell(i); restoreCol(i); } groundDirty(); }

    // flat land beyond the voxel grid
    {
      const farMat = new THREE.MeshLambertMaterial({ color: 0x569038 });
      const E = 700, W = E - HALF;
      const fp = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), farMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); scene.add(m); };
      fp(2 * E, W, 0, -(HALF + W / 2)); fp(2 * E, W, 0, HALF + W / 2);
      fp(W, 2 * HALF, -(HALF + W / 2), 0); fp(W, 2 * HALF, HALF + W / 2, 0);
    }

    // ---------- city ----------
    const PALETTE = [0x9a9a9a, 0xd8cfa8, 0x5d6470, 0xa0563f, 0xe6e2dc, 0x6f8fa8, 0x7c6a58];
    function winTextures() {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const e = document.createElement('canvas'); e.width = e.height = 32;
      const g = c.getContext('2d'), ge = e.getContext('2d');
      ge.fillStyle = '#000'; ge.fillRect(0, 0, 32, 32);
      for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
        for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) { g.fillStyle = gray(rand(205, 250)); g.fillRect(bx * 4 + px, by * 4 + py, 1, 1); }
        const lit = Math.random() < 0.36;
        g.fillStyle = lit ? '#ffe29a' : '#2a3350'; g.fillRect(bx * 4 + 1, by * 4 + 1, 2, 2);
        if (lit) { ge.fillStyle = Math.random() < 0.3 ? '#ffb868' : '#ffe6a0'; ge.fillRect(bx * 4 + 1, by * 4 + 1, 2, 2); }
      }
      return [toTex(c), toTex(e)];
    }
    const winVariants = [0, 1, 2, 3, 4].map(winTextures);
    const buildings = [];
    for (let i = 0; i < 11; i++) for (let j = 0; j < 6; j++) {
      if (Math.random() < 0.1) continue;
      const cx = -33 + 6 * i + 3.5, cz = -40 + 6 * j + 3.5;
      const d = Math.hypot(cx, cz + 22);
      const h = Math.round(rand(5, 12) + Math.max(0, 34 - d) * rand(0.3, 1.1));
      const w = Math.random() < 0.35 ? 4 : 5;
      const col = new THREE.Color(PALETTE[(Math.random() * PALETTE.length) | 0]);
      const [m, e] = winVariants[(Math.random() * winVariants.length) | 0];
      const sm = m.clone(), se = e.clone(); sm.needsUpdate = se.needsUpdate = true;
      sm.repeat.set(w / 8, h / 8); se.repeat.set(w / 8, h / 8);
      const side = new THREE.MeshLambertMaterial({ color: col, map: sm, emissive: 0xffffff, emissiveMap: se, emissiveIntensity: 0.95 });
      const roof = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.7), map: noiseTex });
      const g = new THREE.Group(); g.position.set(cx, 0, cz);
      const body = new THREE.Mesh(box, [side, side, roof, roof, side, side]);
      body.scale.set(w, h, w); body.position.y = h / 2; g.add(body);
      if (h > 24 && Math.random() < 0.6) {
        const ant = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: 0x444444 }));
        ant.scale.set(0.4, 4, 0.4); ant.position.y = h + 2; g.add(ant);
        const tip = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xff3030 }));
        tip.scale.setScalar(0.6); tip.position.y = h + 4.2; g.add(tip);
      }
      scene.add(g);
      buildings.push({ g, x: cx, z: cz, w, h, col, alive: true, sink: false });
    }

    // ---------- trees ----------
    const CANNON_POS = [[-22, 14], [0, 19], [22, 14]];
    const trees = [];
    {
      let tries = 0;
      while (trees.length < 90 && tries++ < 4000) {
        const cx = Math.floor(rand(-53, 53)), cz = Math.floor(rand(-53, 53));
        if (cx >= -35 && cx < 35 && cz >= -42 && cz < -2) continue;
        if (CANNON_POS.some(p => Math.hypot(p[0] - cx, p[1] - cz) < 6)) continue;
        if (cz > 6) continue;                                      // keep the ground in front of the cannons open, so trees never hide them
        trees.push({ x: cx + 0.5, z: cz + 0.5, h: Math.floor(rand(3, 6)), alive: true });
      }
    }
    const trunkM = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0x6b4a2b, map: noiseTex }), trees.length);
    const leafM = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0x3c8a2c, map: noiseTex }), trees.length);
    scene.add(trunkM, leafM);
    function setTree(i) {
      const t = trees[i], s = t.alive ? 1 : 0.0001;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(t.x, t.h / 2, t.z); dummy.scale.set(s, t.h * s, s); dummy.updateMatrix(); trunkM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, t.h + 0.5, t.z); dummy.scale.set(3 * s, 3 * s, 3 * s); dummy.updateMatrix(); leafM.setMatrixAt(i, dummy.matrix);
      trunkM.instanceMatrix.needsUpdate = true; leafM.instanceMatrix.needsUpdate = true;
    }

    // ---------- clouds ----------
    const clouds = [];
    {
      const cm = new THREE.MeshLambertMaterial({ color: 0xffe6dc, emissive: 0x3a2a36, transparent: true, opacity: 0.78 });
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(box, cm);
        m.scale.set(rand(10, 26), 2, rand(8, 18));
        m.position.set(rand(-170, 170), rand(72, 84), rand(-200, 60));
        scene.add(m); clouds.push(m);
      }
    }

    // ---------- particles ----------
    class PS {
      constructor(max, material) {
        this.max = max; this.n = 0;
        this.mesh = new THREE.InstancedMesh(box, material, max);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false; this.mesh.count = 0;
        this.d = new Float32Array(max * 20);
        scene.add(this.mesh);
      }
      // mode: 0 glow (shrinks), 1 debris (bounces), 2 smoke (grows)
      emit(x, y, z, vx, vy, vz, life, size, c0, c1, grav, mode, drag) {
        if (this.n >= this.max) return;
        const o = this.n++ * 20, d = this.d;
        d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
        d[o + 6] = life; d[o + 7] = life; d[o + 8] = size;
        d[o + 9] = c0[0]; d[o + 10] = c0[1]; d[o + 11] = c0[2];
        d[o + 12] = c1[0]; d[o + 13] = c1[1]; d[o + 14] = c1[2];
        d[o + 15] = grav; d[o + 16] = mode; d[o + 17] = drag || 0;
        d[o + 18] = Math.random() * 6; d[o + 19] = rand(-6, 6);
      }
      update(dt) {
        const d = this.d, ic = this.mesh.instanceColor;
        let i = 0;
        while (i < this.n) {
          const o = i * 20;
          d[o + 6] -= dt;
          if (d[o + 6] <= 0) {
            this.n--;
            if (i !== this.n) d.copyWithin(o, this.n * 20, this.n * 20 + 20);
            continue;
          }
          d[o + 4] -= d[o + 15] * dt;
          const k = Math.max(0, 1 - d[o + 17] * dt);
          d[o + 3] *= k; d[o + 4] *= k; d[o + 5] *= k;
          d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
          const mode = d[o + 16];
          if (mode === 1) {
            const gh = groundH(d[o], d[o + 2]) + d[o + 8] * 0.5;
            if (d[o + 1] < gh) { d[o + 1] = gh; d[o + 4] *= -0.3; d[o + 3] *= 0.55; d[o + 5] *= 0.55; d[o + 19] *= 0.4; }
          }
          d[o + 18] += d[o + 19] * dt;
          const t = 1 - d[o + 6] / d[o + 7];
          let s = d[o + 8];
          if (mode === 1) s *= t > 0.85 ? (1 - t) / 0.15 : 1;
          else if (mode === 2) s *= (1 + t * 1.3) * (t > 0.75 ? (1 - t) / 0.25 : 1);
          else s *= 1 - t * 0.75;
          dummy.position.set(d[o], d[o + 1], d[o + 2]);
          dummy.rotation.set(d[o + 18], d[o + 18] * 0.7, 0);
          dummy.scale.setScalar(Math.max(s, 0.001));
          dummy.updateMatrix();
          this.mesh.setMatrixAt(i, dummy.matrix);
          ic.setXYZ(i, d[o + 9] + (d[o + 12] - d[o + 9]) * t, d[o + 10] + (d[o + 13] - d[o + 10]) * t, d[o + 11] + (d[o + 14] - d[o + 11]) * t);
          i++;
        }
        this.mesh.count = this.n;
        this.mesh.instanceMatrix.needsUpdate = true; ic.needsUpdate = true;
      }
      clear() { this.n = 0; this.mesh.count = 0; }
    }
    const glow = new PS(6000, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const debris = new PS(3500, new THREE.MeshLambertMaterial({ color: 0xffffff, map: noiseTex }));

    const C = {
      hot: [1, 0.95, 0.62], ember: [0.85, 0.18, 0.04], fire: [1, 0.6, 0.15],
      smoke0: [0.4, 0.35, 0.35], smoke1: [0.14, 0.12, 0.15],
      char: [0.14, 0.11, 0.1], scorch: [0.3, 0.2, 0.13], dirt: [0.45, 0.31, 0.19],
      stone: [0.55, 0.55, 0.55], grass: [0.38, 0.62, 0.25], magma: [1, 0.48, 0.12],
      metal: [0.36, 0.42, 0.5], dark: [0.2, 0.21, 0.24], gold: [0.88, 0.7, 0.23], leaf: [0.24, 0.55, 0.18]
    };
    const randDir = () => { tmp2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); if (tmp2.lengthSq() < 0.01) tmp2.set(0, 1, 0); return tmp2.normalize(); };
    const vary = (c, j = 0.06) => shade(c, j);

    let shake = 0;
    function explosion(p, k) {
      flash.position.copy(p); flash.intensity = 5 * k; flash.distance = 70 * k;
      for (let i = 0; i < 60 * k; i++) {
        const dir = randDir(), sp = rand(5, 22) * k;
        glow.emit(p.x, p.y, p.z, dir.x * sp, dir.y * sp + 3, dir.z * sp, rand(0.4, 1.1), rand(1, 2.6) * k, C.hot, C.ember, 0, 0, 2.5);
      }
      for (let i = 0; i < 28 * k; i++) {
        glow.emit(p.x + rand(-2, 2) * k, p.y + rand(0, 2), p.z + rand(-2, 2) * k, rand(-4, 4), rand(2, 7), rand(-4, 4), rand(2, 4), rand(1.6, 3.2) * k, C.smoke0, C.smoke1, -1.2, 2, 1.1);
      }
    }
    function smallBurst(p, n, size) {
      for (let i = 0; i < n; i++) {
        const dir = randDir(), sp = rand(4, 14);
        glow.emit(p.x, p.y, p.z, dir.x * sp, dir.y * sp, dir.z * sp, rand(0.3, 0.7), rand(0.5, 1.2) * size, C.hot, C.ember, 0, 0, 2.5);
      }
    }

    // ---------- cannons ----------
    const mats = {
      stone: new THREE.MeshLambertMaterial({ color: 0x8d8d8d, map: noiseTex }),
      metal: new THREE.MeshLambertMaterial({ color: 0x5c6b7d, map: noiseTex }),
      dark: new THREE.MeshLambertMaterial({ color: 0x2f333b, map: noiseTex }),
      gold: new THREE.MeshLambertMaterial({ color: 0xe0b43a, map: noiseTex }),
      rubble: new THREE.MeshLambertMaterial({ color: 0x2a2522, map: noiseTex }),
      lamp: new THREE.MeshBasicMaterial({ color: 0x6ff0ff })
    };
    function block(mat, sx, sy, sz, x, y, z, parent) {
      const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
    }
    const cannons = [];
    function makeCannon(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      const base = new THREE.Group(); g.add(base);
      block(mats.stone, 5, 1, 5, 0, 0.5, 0, base);
      block(mats.dark, 3, 1.4, 3, 0, 1.7, 0, base);
      const yaw = new THREE.Group(); yaw.position.y = 2.4; g.add(yaw);
      block(mats.gold, 2.9, 0.4, 2.9, 0, 0.2, 0, yaw);
      block(mats.metal, 2.6, 1.8, 2.6, 0, 1.1, 0, yaw);
      block(mats.lamp, 0.5, 0.5, 0.5, 0, 2.15, -0.8, yaw);
      const pitch = new THREE.Group(); pitch.position.y = 1.2; yaw.add(pitch);
      const recoil = new THREE.Group(); pitch.add(recoil);
      block(mats.metal, 1.3, 1.3, 1.6, 0, 0, 0.4, recoil);
      block(mats.dark, 0.8, 0.8, 4.4, 0, 0, 2.6, recoil);
      block(mats.metal, 1.1, 1.1, 0.8, 0, 0, 4.6, recoil);
      const muzzle = new THREE.Object3D(); muzzle.position.z = 5.2; recoil.add(muzzle);
      const rubble = new THREE.Group();
      for (let k = 0; k < 8; k++) block(mats.rubble, rand(0.8, 1.8), rand(0.6, 1.4), rand(0.8, 1.8), rand(-1.8, 1.8), rand(0.3, 0.9), rand(-1.8, 1.8), rubble);
      rubble.visible = false; g.add(rubble);
      const c = { g, base, yaw, pitch, recoil, muzzle, rubble, x, z, yawA: Math.PI, pitchA: 0.6, cool: rand(0, 1), alive: true, target: null, recoilT: 0, smoke: 0 };
      yaw.rotation.y = c.yawA; pitch.rotation.x = -c.pitchA;
      cannons.push(c);
    }
    CANNON_POS.forEach(p => makeCannon(p[0] + 0.5, p[1] + 0.5));

    function destroyCannon(c) {
      c.alive = false; c.target = null; events.push('cannonLost');
      c.yaw.visible = false; c.base.visible = false;
      c.rubble.visible = true; c.rubble.position.y = Math.min(0, groundH(c.x, c.z));
      explosion(new V3(c.x, 3, c.z), 1.2);
      const cols = [C.metal, C.dark, C.gold, C.stone];
      for (let i = 0; i < 45; i++) {
        const dir = randDir();
        debris.emit(c.x + rand(-1.5, 1.5), rand(1, 4), c.z + rand(-1.5, 1.5), dir.x * rand(5, 14), rand(8, 22), dir.z * rand(5, 14), rand(3, 5), rand(0.4, 1), vary(cols[i % 4]), vary(cols[i % 4]), 30, 1, 0.2);
      }
    }
    function repairCannon(c) {
      if (c.alive) return;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const i = cellIdx(c.x + dx, c.z + dz); if (i < 0) continue;
        heights[i] = 0; setCell(i); restoreCol(i);
      }
      groundDirty();
      c.alive = true; c.yaw.visible = true; c.base.visible = true; c.rubble.visible = false; c.cool = 0.5;
    }

    // ---------- asteroids & shells ----------
    const asteroids = [], shells = [];
    const magmaMat = new THREE.MeshBasicMaterial({ color: 0xff7a1f });
    const SHELL_SPEED = 80, MISS_CHANCE = 0.14, ENGAGE_Y = 118;
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
    let heavy = false;

    function spawnAsteroid() {
      const big = Math.random() < (heavy ? 0.38 : 0.3);
      const s = big ? 1.0 : 0.85, R = big ? 3.0 : 1.7;
      const voxR = [], voxM = [];
      const n = Math.ceil(R / s) + 1;
      for (let ix = -n; ix <= n; ix++) for (let iy = -n; iy <= n; iy++) for (let iz = -n; iz <= n; iz++) {
        const d = Math.hypot(ix, iy, iz) * s;
        if (d < R + rand(-0.5, 0.2)) {
          const p = [ix * s, iy * s, iz * s, rand(0.75, 1.1)];
          ((d < R * 0.55 && Math.random() < 0.5) || Math.random() < 0.1 ? voxM : voxR).push(p);
        }
      }
      const rockMat = new THREE.MeshLambertMaterial({ map: rockTex, color: 0x8a7f78, emissive: 0xff4a10, emissiveIntensity: 0.18 });
      const rock = new THREE.InstancedMesh(box, rockMat, Math.max(1, voxR.length));
      rock.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, voxR.length) * 3), 3);
      const mag = new THREE.InstancedMesh(box, magmaMat, Math.max(1, voxM.length));
      const g = new THREE.Group(); g.add(rock, mag); scene.add(g);
      // Every asteroid stays in view from the moment it appears: it aims at ground the camera can see, and starts where its
      // straight path leaves the top of the picture (just below the read-outs). Both ends in view means the whole path is.
      let tx = 0, tz = -20, start = null;
      for (let tries = 0; tries < 30 && !start; tries++) {
        const x = rand(-45, 45), z = rand(-45, 24);
        if (!inView(x, 0, z, 0.08)) continue;
        const dir = new V3(rand(-0.45, 0.45), 1, rand(-1.3, -0.35)).normalize();
        let lo = 0, hi = 230;
        if (inView(x + dir.x * hi, dir.y * hi, z + dir.z * hi, 0.01)) lo = hi;
        else for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (inView(x + dir.x * m, dir.y * m, z + dir.z * m, 0.01)) lo = m; else hi = m; }
        if (lo >= 70 || tries >= 24) { tx = x; tz = z; start = new V3(x + dir.x * lo, dir.y * lo, z + dir.z * lo); }
      }
      if (!start) start = new V3(0, 100, -80);
      const speed = big ? rand(22, 27) : rand(28, 38);
      const vel = new V3(tx, 0, tz).sub(start).normalize().multiplyScalar(speed);
      const a = { g, rock, mag, voxR, voxM, s, r: R, pos: start, vel, hp: big ? 2 : 1, pending: 0, big, alive: true, spin: new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)) };
      g.position.copy(start);
      layout(a);
      asteroids.push(a);
    }
    function layout(a) {
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(a.s);
      a.voxR.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.updateMatrix(); a.rock.setMatrixAt(i, dummy.matrix); a.rock.instanceColor.setXYZ(i, p[3], p[3], p[3]); });
      a.voxM.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.updateMatrix(); a.mag.setMatrixAt(i, dummy.matrix); });
      a.rock.count = a.voxR.length; a.mag.count = a.voxM.length;
      a.rock.instanceMatrix.needsUpdate = true; a.rock.instanceColor.needsUpdate = true; a.mag.instanceMatrix.needsUpdate = true;
    }
    function removeAsteroid(a) { a.alive = false; scene.remove(a.g); a.rock.material.dispose(); }
    function voxDebris(a, list, isMagma) {
      for (const p of list) {
        tmp.set(p[0], p[1], p[2]).applyMatrix4(a.g.matrixWorld);
        const dir = randDir(), sp = rand(6, 16);
        const col = isMagma ? C.magma : [0.54 * p[3], 0.5 * p[3], 0.47 * p[3]];
        debris.emit(tmp.x, tmp.y, tmp.z, a.vel.x * 0.35 + dir.x * sp, a.vel.y * 0.35 + dir.y * sp, a.vel.z * 0.35 + dir.z * sp, rand(4, 6), a.s * rand(0.7, 1), col, isMagma ? C.dark : col, 25, 1, 0.1);
      }
    }
    function chip(a) {
      a.g.updateMatrixWorld(true);
      const all = a.voxR.map(p => ({ p, m: false })).concat(a.voxM.map(p => ({ p, m: true })));
      const L = p => p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      all.sort((u, v) => L(v.p) - L(u.p) + rand(-1, 1));
      const cut = Math.floor(all.length * 0.45);
      const removed = all.slice(0, cut), kept = all.slice(cut);
      voxDebris(a, removed.filter(o => !o.m).map(o => o.p), false);
      voxDebris(a, removed.filter(o => o.m).map(o => o.p), true);
      a.voxR = kept.filter(o => !o.m).map(o => o.p);
      a.voxM = kept.filter(o => o.m).map(o => o.p);
      a.r *= 0.8; layout(a);
      smallBurst(a.pos, 30, 1.6);
      flash.position.copy(a.pos); flash.intensity = 3; flash.distance = 60;
    }
    const stats = { down: 0, imp: 0, rebuilt: 0 };
    function shootDown(a) {
      a.g.updateMatrixWorld(true);
      voxDebris(a, a.voxR, false); voxDebris(a, a.voxM, true);
      explosion(a.pos, a.big ? 1.3 : 0.9);
      removeAsteroid(a);
      stats.down++;
    }
    function onHit(a, p) {
      a.hp--;
      smallBurst(p, 14, 1);
      if (a.hp <= 0) shootDown(a); else chip(a);
    }

    function collapse(b) {
      if (!b.alive) return;
      b.alive = false; b.sink = true; b.rise = false; events.push('building');
      const n = Math.min(100, b.h * 3 + 20);
      const c = [b.col.r, b.col.g, b.col.b];
      for (let i = 0; i < n; i++) {
        const cc = vary(c, 0.08);
        debris.emit(b.x + rand(-b.w / 2, b.w / 2), rand(0, b.h), b.z + rand(-b.w / 2, b.w / 2), rand(-7, 7), rand(0, 9), rand(-7, 7), rand(3, 5), rand(0.6, 1.3), cc, cc, 30, 1, 0.2);
      }
      for (let i = 0; i < 20; i++) glow.emit(b.x + rand(-b.w, b.w), rand(0, b.h * 0.5), b.z + rand(-b.w, b.w), rand(-2, 2), rand(1, 4), rand(-2, 2), rand(2.5, 4), rand(2, 3.5), [0.55, 0.52, 0.5], [0.25, 0.23, 0.24], -0.6, 2, 0.8);
    }

    function crater(x, z, R, big) {
      const rr = Math.ceil(R + 2), cx0 = Math.floor(x), cz0 = Math.floor(z);
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        const wx = cx0 + dx + 0.5, wz = cz0 + dz + 0.5;
        const i = cellIdx(wx, wz); if (i < 0) continue;
        const d = Math.hypot(wx - x, wz - z);
        if (d < R) {
          const depth = Math.round((1 - (d / R) ** 2) * R * 0.55) + (d < R * 0.75 ? 1 : 0);
          const nh = Math.max(BOTTOM + 2, -depth);
          if (nh < heights[i]) heights[i] = nh;
          const t = d / R;
          setCol(i, t < 0.45 ? (Math.random() < 0.2 ? [0.55, 0.16, 0.05] : vary(C.char, 0.03)) : t < 0.8 ? vary(C.scorch, 0.04) : vary(C.dirt, 0.04));
          setCell(i);
        } else if (d < R + 1.5) {
          if (heights[i] === 0) heights[i] = 1;
          setCol(i, vary(C.dirt, 0.05));
          setCell(i);
        }
      }
      groundDirty();
      const cols = [C.dirt, C.stone, C.grass, C.scorch];
      for (let i = 0; i < (big ? 70 : 40); i++) {
        const dir = randDir(), cc = vary(cols[i % 4]);
        debris.emit(x + rand(-R / 2, R / 2), groundH(x, z) + 1, z + rand(-R / 2, R / 2), dir.x * rand(4, 14), rand(9, 24), dir.z * rand(4, 14), rand(2.5, 4.5), rand(0.5, 1.1), cc, cc, 30, 1, 0.2);
      }
      for (const b of buildings) if (b.alive && Math.hypot(b.x - x, b.z - z) < R + b.w * 0.4) collapse(b);
      for (const c of cannons) if (c.alive && Math.hypot(c.x - x, c.z - z) < R + 2.2) destroyCannon(c);
      trees.forEach((t, i) => {
        if (t.alive && Math.hypot(t.x - x, t.z - z) < R + 1) {
          t.alive = false; setTree(i);
          for (let k = 0; k < 8; k++) debris.emit(t.x, t.h, t.z, rand(-6, 6), rand(5, 12), rand(-6, 6), rand(2, 3.5), rand(0.5, 0.9), vary(C.leaf), vary(C.leaf), 30, 1, 0.2);
        }
      });
    }

    function impact(a, b) {
      const p = a.pos.clone();
      removeAsteroid(a);
      stats.imp++; events.push('impact');
      const R = a.big ? 7.5 : 4.8;
      explosion(p, a.big ? 1.7 : 1.1);
      if (b) collapse(b);
      const gp = new V3(p.x, groundH(p.x, p.z) + 1, p.z);
      if (b) explosion(gp, 0.8);
      crater(p.x, p.z, b ? R * 0.8 : R, a.big);
      shake = Math.min(2.5, shake + (a.big ? 1.6 : 1.0));
    }

    function intercept(src, p, v, s) {
      const dx = p.x - src.x, dy = p.y - src.y, dz = p.z - src.z;
      const a = v.x * v.x + v.y * v.y + v.z * v.z - s * s;
      const b = 2 * (dx * v.x + dy * v.y + dz * v.z);
      const c = dx * dx + dy * dy + dz * dz;
      let t;
      if (Math.abs(a) < 1e-6) t = -c / b;
      else {
        const disc = b * b - 4 * a * c; if (disc < 0) return null;
        const sq = Math.sqrt(disc), t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
        t = Math.min(t1, t2); if (t < 0) t = Math.max(t1, t2);
      }
      if (!(t > 0)) return null;
      return { t, point: new V3(p.x + v.x * t, p.y + v.y * t, p.z + v.z * t) };
    }
    function segDist(a, b, p) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
      const L = abx * abx + aby * aby + abz * abz;
      const t = clamp(L > 0 ? (apx * abx + apy * aby + apz * abz) / L : 0, 0, 1);
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

    function pickTarget(c) {
      let best = null, bs = 1e9;
      for (const a of asteroids) {
        if (!a.alive || a.hp - a.pending <= 0 || a.pos.y > ENGAGE_Y) continue;
        const score = a.pos.y / Math.max(1, -a.vel.y) + Math.hypot(a.pos.x - c.x, a.pos.z - c.z) / 120;
        if (score < bs) { bs = score; best = a; }
      }
      return best;
    }
    const muzzlePos = new V3();
    function fire(c, aim, target) {
      const dir = aim.clone().sub(muzzlePos).normalize();
      if (Math.random() < 0.3 - 0.27 * power) {              /* aim is steadier the higher the power: 4% misses at 95%, 14% at 60% */ dir.x += rand(-0.09, 0.09); dir.y += rand(-0.06, 0.06); dir.z += rand(-0.09, 0.09); dir.normalize(); }
      const m = new THREE.Mesh(box, shellMat); m.scale.setScalar(0.6); m.position.copy(muzzlePos); scene.add(m);
      shells.push({ m, pos: muzzlePos.clone(), vel: dir.clone().multiplyScalar(SHELL_SPEED), life: 4, target });
      target.pending++;
      c.recoilT = 1;
      for (let i = 0; i < 12; i++) glow.emit(muzzlePos.x, muzzlePos.y, muzzlePos.z, dir.x * rand(6, 18) + rand(-3, 3), dir.y * rand(6, 18) + rand(-3, 3), dir.z * rand(6, 18) + rand(-3, 3), rand(0.15, 0.35), rand(0.5, 1.1), C.hot, C.fire, 0, 0, 4);
      for (let i = 0; i < 4; i++) glow.emit(muzzlePos.x, muzzlePos.y, muzzlePos.z, rand(-1, 1), rand(0.5, 2), rand(-1, 1), rand(1, 1.8), rand(0.8, 1.4), [0.6, 0.58, 0.56], [0.3, 0.28, 0.3], -0.5, 2, 1);
    }
    function updateCannon(c, dt) {
      if (!c.alive) {
        c.smoke -= dt;
        if (c.smoke <= 0) {
          c.smoke = rand(0.08, 0.2);
          const y = c.rubble.position.y + 1;
          glow.emit(c.x + rand(-1, 1), y, c.z + rand(-1, 1), rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), rand(2.5, 4), rand(1, 1.8), [0.3, 0.28, 0.28], [0.12, 0.11, 0.12], -0.4, 2, 0.3);
          if (Math.random() < 0.4) glow.emit(c.x + rand(-1, 1), y, c.z + rand(-1, 1), 0, rand(1, 3), 0, rand(0.3, 0.6), rand(0.4, 0.8), C.hot, C.ember, 0, 0, 1);
        }
        return;
      }
      c.cool -= dt * (0.35 + 0.65 * power);
      c.recoilT = Math.max(0, c.recoilT - dt * 4);
      c.recoil.position.z = -c.recoilT * 1.2;
      if (!c.target || !c.target.alive || c.target.hp - c.target.pending <= 0) c.target = pickTarget(c);
      c.muzzle.getWorldPosition(muzzlePos);
      let wantYaw = c.yawA, wantPitch = c.pitchA, sol = null;
      if (c.target) {
        sol = intercept(muzzlePos, c.target.pos, c.target.vel, SHELL_SPEED);
        if (sol) {
          const dx = sol.point.x - c.x, dy = sol.point.y - 3.6, dz = sol.point.z - c.z;
          wantYaw = Math.atan2(dx, dz); wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        }
      }
      const rs = 2.6 * dt;
      const dyaw = angDiff(wantYaw, c.yawA);
      c.yawA += clamp(dyaw, -rs, rs);
      const dp = clamp(wantPitch, 0.05, 1.5) - c.pitchA;
      c.pitchA += clamp(dp, -rs, rs);
      c.yaw.rotation.y = c.yawA; c.pitch.rotation.x = -c.pitchA;
      if (armed && sol && Math.abs(dyaw) < 0.05 && Math.abs(dp) < 0.05 && c.cool <= 0 && sol.t < 3.2 && sol.point.y > 10) {
        fire(c, sol.point, c.target);
        c.cool = 0.9 + rand(0, 0.4);
      }
    }
    function releaseShell(i) {
      const s = shells[i];
      scene.remove(s.m);
      if (s.target && s.target.alive) s.target.pending = Math.max(0, s.target.pending - 1);
      shells.splice(i, 1);
    }

    // ---------- simulation step ----------
    let spawnT = 0.6;
    const prev = new V3();
    function step(dt) {
      scene.updateMatrixWorld();
      spawnT -= dt;
      if (spawnT <= 0 && asteroids.length < (heavy ? 10 : 5)) { spawnAsteroid(); spawnT = heavy ? rand(0.8, 1.7) : rand(2.4, 3.8); }

      const k = dt * 60;
      for (const a of asteroids) {
        if (!a.alive) continue;
        a.pos.addScaledVector(a.vel, dt);
        a.g.position.copy(a.pos);
        a.g.rotation.x += a.spin.x * dt; a.g.rotation.y += a.spin.y * dt; a.g.rotation.z += a.spin.z * dt;
        a.rock.material.emissiveIntensity = 0.16 + Math.random() * 0.1;
        const nT = Math.max(1, Math.round((a.big ? 3 : 2) * k));
        for (let i = 0; i < nT; i++) glow.emit(a.pos.x + rand(-0.5, 0.5) * a.r, a.pos.y + rand(-0.5, 0.5) * a.r, a.pos.z + rand(-0.5, 0.5) * a.r, -a.vel.x * 0.08 + rand(-1, 1), -a.vel.y * 0.08 + rand(-1, 1), -a.vel.z * 0.08 + rand(-1, 1), rand(0.4, 0.8), a.r * rand(0.5, 0.9), C.hot, C.ember, 0, 0, 1);
        if (Math.random() < k) glow.emit(a.pos.x, a.pos.y, a.pos.z, rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6), rand(1.6, 2.6), a.r * rand(0.6, 1), C.smoke0, C.smoke1, -0.5, 2, 0.6);

        if (a.pos.y - a.r * 0.6 <= groundH(a.pos.x, a.pos.z)) { impact(a, null); continue; }
        let hitB = null;
        for (const b of buildings) {
          if (b.alive && Math.abs(a.pos.x - b.x) < b.w / 2 + a.r * 0.6 && Math.abs(a.pos.z - b.z) < b.w / 2 + a.r * 0.6 && a.pos.y - a.r * 0.6 < b.h) { hitB = b; break; }
        }
        if (hitB) { impact(a, hitB); continue; }
        for (const c of cannons) {
          if (c.alive && Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 2.6 + a.r * 0.6 && a.pos.y < 6) { impact(a, null); break; }
        }
      }

      for (const c of cannons) updateCannon(c, dt);

      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        prev.copy(s.pos);
        s.pos.addScaledVector(s.vel, dt);
        s.life -= dt;
        s.m.position.copy(s.pos);
        s.m.rotation.x += dt * 10; s.m.rotation.y += dt * 7;
        glow.emit(s.pos.x, s.pos.y, s.pos.z, 0, 0, 0, 0.22, 0.4, C.hot, C.fire, 0, 0, 0);
        let hit = null;
        for (const a of asteroids) if (a.alive && segDist(prev, s.pos, a.pos) < a.r + 0.7) { hit = a; break; }
        if (hit) { const p = s.pos.clone(); releaseShell(i); onHit(hit, p); continue; }
        if (s.life <= 0) { smallBurst(s.pos, 6, 0.6); releaseShell(i); continue; }
        if (s.pos.y < groundH(s.pos.x, s.pos.z)) { smallBurst(s.pos, 8, 0.7); releaseShell(i); }
      }

      for (let i = asteroids.length - 1; i >= 0; i--) if (!asteroids[i].alive) asteroids.splice(i, 1);

      for (const b of buildings) {
        if (!b.sink) continue;
        b.g.position.y -= dt * (5 + b.h * 0.25);
        if (Math.random() < k * 0.6) glow.emit(b.x + rand(-b.w / 2, b.w / 2), 0.5, b.z + rand(-b.w / 2, b.w / 2), rand(-3, 3), rand(1, 3), rand(-3, 3), rand(1.5, 2.5), rand(1.2, 2.2), [0.55, 0.52, 0.5], [0.3, 0.28, 0.3], -0.3, 2, 1);
        if (b.g.position.y < -b.h - 2) { b.sink = false; b.g.visible = false; }
      }

      for (const b of buildings) if (b.rise) { b.g.position.y += dt * (6 + b.h * 0.3); if (b.g.position.y >= 0) { b.g.position.y = 0; b.rise = false; } }
      repairs(dt);
      for (const m of clouds) { m.position.x += dt * 2.2; if (m.position.x > 180) m.position.x = -180; }
      flash.intensity *= Math.pow(0.004, dt);

      glow.update(dt);
      debris.update(dt);
    }


    function repairs(dt) {                                        // playing repairs the damage, one piece at a time
      const play = armed ? dt : 0, downC = cannons.find(c => !c.alive), downB = buildings.find(b => !b.alive && !b.sink);
      if (downC) { cannonT += play; if (cannonT >= CANNON_EVERY) { cannonT = 0; repairCannon(downC); events.push('cannonBack'); } } else cannonT = 0;
      if (downB) { buildT += play; if (buildT >= BUILD_EVERY) { buildT = 0; rebuild(downB); events.push('rebuilt'); } } else buildT = 0;
      view.next = downC ? { what: 'cannon', left: CANNON_EVERY - cannonT } : downB ? { what: 'building', left: BUILD_EVERY - buildT } : null;
    }
    function rebuild(b) {
      const r = Math.ceil(b.w / 2) + 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const i = cellIdx(b.x + dx, b.z + dz); if (i < 0) continue; heights[i] = 0; setCell(i); restoreCol(i); }
      groundDirty();
      b.alive = true; b.sink = false; b.rise = true; b.g.visible = true; b.g.position.y = -b.h; stats.rebuilt++;
    }
    function resetAll() {
      asteroids.forEach(removeAsteroid); asteroids.length = 0;
      while (shells.length) releaseShell(shells.length - 1);
      glow.clear(); debris.clear();
      resetGround();
      for (const b of buildings) { b.alive = true; b.sink = false; b.rise = false; b.g.position.y = 0; b.g.visible = true; }
      trees.forEach((t, i) => { t.alive = true; setTree(i); });
      cannons.forEach(c => { c.alive = false; repairCannon(c); c.yawA = Math.PI; c.pitchA = 0.6; c.target = null; });
      stats.down = 0; stats.imp = 0; stats.rebuilt = 0; spawnT = 0.6; shake = 0; cannonT = 0; buildT = 0; view.next = null;
      flash.intensity = 0;
    }

    // Camera: fixed, no orbit. It is fitted so the three cannons sit along the bottom, the front of the city behind them, and the
    // sky the asteroids fall through above, all below the read-outs, and as large as the space allows. Fitted again whenever the
    // space changes (screen size, read-outs folded).
    const CAM_H = 14, LOOK_Z = -20;
    const KEEP = [[-26, 0, 15], [26, 0, 15], [0, 0, 23], [-23, 7, 13], [23, 7, 13], [-30, 0, -5], [30, 0, -5], [0, 112, -35]];   // cannons, front of the city, sky
    const area = { x: 0.94, lo: -0.94, hi: 0.9 }, pt = new V3(), camPos = new V3(), camLook = new V3();
    let aimCam = camera.clone(), hudPx = 0, W = 0, H = 0;
    function inCam(cam, x, y, z, m) { pt.set(x, y, z).project(cam); return pt.z < 1 && Math.abs(pt.x) <= area.x - m && pt.y >= area.lo + m && pt.y <= area.hi - m; }
    function inView(x, y, z, m) { return inCam(aimCam, x, y, z, m); }
    function place(ly, d) { camera.position.set(0, CAM_H, LOOK_Z + d); camera.lookAt(0, ly, LOOK_Z); camera.updateMatrixWorld(); }
    function fitsAll() { for (const k of KEEP) if (!inCam(camera, k[0], k[1], k[2], 0)) return false; return true; }
    function fitCamera() {
      let best = null;
      for (let ly = 16; ly <= 96; ly += 2) {
        place(ly, 600); if (!fitsAll()) continue;
        let lo = 20, hi = 600;
        for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; place(ly, mid); if (fitsAll()) hi = mid; else lo = mid; }
        if (!best || hi < best.d) best = { ly: ly, d: hi };
      }
      if (!best) best = { ly: 50, d: 220 };
      place(best.ly, best.d); camPos.copy(camera.position); camLook.set(0, best.ly, LOOK_Z);
      aimCam = camera.clone(); aimCam.updateMatrixWorld();
    }
    function resize() {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight), hud = host.querySelector('.city-hud');
      const hp = hud ? Math.min(h * 0.5, hud.offsetTop + hud.offsetHeight) : 0;
      if (w === W && h === H && hp === hudPx) return;               // every theme change asks; refitting the camera and the drawing buffer is costly
      hudPx = hp; W = w; H = h;
      renderer.setSize(w, h, false);
      camera.clearViewOffset(); camera.aspect = w / h; camera.updateProjectionMatrix();
      area.hi = 1 - 2 * (hudPx + 8) / h;
      KEEP[KEEP.length - 1][1] = w / h < 1 ? 112 : 90;                // on wide screens a little less sky, so the cannons are not tiny
      fitCamera();
    }
    function updateCam(dt) {
      camera.position.copy(camPos); camera.lookAt(camLook);
      if (shake > 0.01 && !reduceMotion) { camera.position.x += rand(-1, 1) * shake; camera.position.y += rand(-1, 1) * shake; camera.position.z += rand(-1, 1) * shake; }
      shake *= Math.pow(0.03, dt);
      skyGroup.position.copy(camera.position);
    }
    function frame(dt, inp) {
      dt = Math.min(0.25, Math.max(0, dt));
      if (host.clientWidth !== W || host.clientHeight !== H) resize();
      armed = !!(inp.running && inp.music); power = Math.max(0, Math.min(1, inp.power || 0));
      mats.lamp.color.setHex(armed ? 0x6ff0ff : 0x3a4048);
      if (inp.running && dt > 0) { for (let left = dt; left > 1e-4; left -= 0.05) step(Math.min(0.05, left)); }   // slow frames still keep real time
      updateCam(Math.min(0.05, dt));
      renderer.render(scene, camera);
      const st = view.stats; st.down = stats.down; st.imp = stats.imp; st.rebuilt = stats.rebuilt;
      st.cannons = cannons.filter(c => c.alive).length; st.standing = buildings.filter(b => b.alive).length; st.total = buildings.length;
    }
    resetGround();
    trees.forEach((t, i) => setTree(i));
    function simulate(sec, inp) {                                 // for tests: run the defence without drawing it
      armed = !!(inp.running && inp.music); power = inp.power || 0;
      let seen = 0, out = 0;
      for (let t = 0; t < sec; t += 0.05) { step(0.05); for (const a of asteroids) if (a.alive) { seen++; if (!inView(a.pos.x, a.pos.y, a.pos.z, -0.02)) out++; } }
      return { seen: seen, outside: out, down: stats.down, imp: stats.imp, cannons: cannons.filter(c => c.alive).length, standing: buildings.filter(b => b.alive).length, total: buildings.length, rebuilt: stats.rebuilt };
    }
    return { frame, reset: resetAll, resize, simulate };
  }
}
