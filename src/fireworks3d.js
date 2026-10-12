/* Fireworks in 3D (three.js r128, from cdnjs, as City loads it): a harbour at night seen from the water's edge. Shells burst as real spheres
   and tilted rings at different depths, light up the buildings on the far shore as they go off, and show again in the water. The camera drifts
   slowly along the shore so the depth reads. src/fireworks.js uses this once three.js is there, and its flat drawing until then (or if it never
   comes). What goes up, and when, comes from FireworkSim in the core; this only draws it. */
/* exported makeFirework3D */   // used by src/fireworks.js
function makeFirework3D(cv, hud, MT) {
  'use strict';
  const T = THREE, RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, TAU = Math.PI * 2;
  const MAX = RM ? 900 : 3200, FOV = 70, SHIFT = 1.6, TANF = Math.tan(FOV / 2 * Math.PI / 180);
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(FOV, 1, 0.5, 2400);
  const HOR = new T.Color(0x2B2050);
  scene.fog = new T.Fog(0x0E0D28, 160, 560);
  let W = 0, H = 0, top = 0, dpr = 1, clock = 0, idleT = 1.5, lift = 0;
  const rockets = [], sparks = [], puffs = [], flash = new T.Color(0, 0, 0), tmp = new T.Color(), V = T.Vector3;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------- the sky: a gradient dome that the bursts light from below, and stars ---------- */
  const sky = new T.Group(); scene.add(sky);
  const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color(0x02030C) }, mid: { value: new T.Color(0x0C1030) }, hor: { value: HOR }, flash: { value: flash }, lift: { value: 0 } },
    vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top;uniform vec3 mid;uniform vec3 hor;uniform vec3 flash;uniform float lift;varying vec3 vD;void main(){float h=normalize(vD).y;' +
      'vec3 c=mix(hor,mid,smoothstep(-0.02,0.22,h));c=mix(c,top,smoothstep(0.22,0.85,h));c*=1.0+lift;c+=flash*(1.0-smoothstep(-0.05,0.7,h));gl_FragColor=vec4(c,1.0);}' });
  const dome = new T.Mesh(new T.SphereGeometry(1000, 24, 16), skyMat); dome.renderOrder = -3; sky.add(dome);
  {
    const n = 700, pos = new Float32Array(n * 3), ph = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, y = 0.06 + Math.pow(Math.random(), 0.7) * 0.94, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 950, y * 950, Math.sin(a) * r * 950], i * 3); ph[i] = Math.random() * TAU; sz[i] = Math.random() < 0.12 ? 2.4 : 1.3; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aPh', new T.BufferAttribute(ph, 1)); g.setAttribute('aSz', new T.BufferAttribute(sz, 1));
    const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, uniforms: { t: { value: 0 }, px: { value: 1 } },
      vertexShader: 'attribute float aPh;attribute float aSz;uniform float t;uniform float px;varying float vA;void main(){vA=' + (RM ? '0.6' : '0.45+0.35*sin(t*(1.0+fract(aPh)*1.5)+aPh)') + ';gl_PointSize=aSz*px;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying float vA;void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;gl_FragColor=vec4(vec3(0.86,0.9,1.0)*vA*(1.0-d),1.0);}' });
    const st = new T.Points(g, m); st.renderOrder = -2; sky.add(st); sky.userData.stars = m;
  }

  /* ---------- the far shore: hills, then buildings with lit windows; the bursts light their faces ---------- */
  const world = new T.Group(), mirror = new T.Group(); mirror.scale.y = -1; scene.add(world, mirror);   // the mirror is the reflection in the water
  function hills(z, h, col, seed) {
    const s = new T.Shape(), r = MT.raceRng(seed); s.moveTo(-1400, -5);
    for (let x = -1400; x <= 1400; x += 40) s.lineTo(x, h * (0.45 + 0.3 * Math.sin(x / 190 + seed) + 0.25 * r()));
    s.lineTo(1400, -5); s.closePath();
    const m = new T.Mesh(new T.ShapeGeometry(s), new T.MeshBasicMaterial({ color: col })); m.position.z = z; return m;
  }
  for (const m of [hills(-420, 46, 0x0D1030, 3), hills(-300, 30, 0x090A20, 7)]) { world.add(m); mirror.add(new T.Mesh(m.geometry, m.material).copy(m)); }
  {
    const wc = document.createElement('canvas'); wc.width = 64; wc.height = 128; const w = wc.getContext('2d'), r = MT.raceRng(99);
    w.fillStyle = '#000'; w.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 6) for (let x = 3; x < 61; x += 5) if (r() < 0.22) { w.fillStyle = r() < 0.6 ? '#FFC979' : '#9DB8FF'; w.globalAlpha = 0.35 + r() * 0.5; w.fillRect(x, y, 3, 3); }
    const tex = new T.CanvasTexture(wc); tex.magFilter = T.NearestFilter;
    const geo = new T.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mat = new T.MeshLambertMaterial({ color: 0x1A1D33, emissive: 0xFFFFFF, emissiveMap: tex });
    const rr = MT.raceRng(42), list = [];
    for (let x = -330; x < 330;) { const wd = 7 + rr() * 14, far = Math.abs(x) > 140; list.push([x + wd / 2, 0, -190 - rr() * 45, wd, (far ? 6 : 9) + rr() * rr() * (far ? 22 : 34), 6 + rr() * 10]); x += wd + (rr() < 0.3 ? 2 + rr() * 6 : 0.5); }
    const make = () => new T.InstancedMesh(geo, mat, list.length), a = make(), b = make(), o = new T.Object3D();
    list.forEach((q, i) => { o.position.set(q[0], q[1], q[2]); o.scale.set(q[3], q[4], q[5]); o.updateMatrix(); a.setMatrixAt(i, o.matrix); b.setMatrixAt(i, o.matrix); });
    world.add(a); mirror.add(b);
    const wall = new T.Mesh(new T.BoxGeometry(900, 2.2, 8), new T.MeshLambertMaterial({ color: 0x0A0B16 })); wall.position.set(0, 1.1, -178); world.add(wall);   // the sea wall
  }
  scene.add(new T.AmbientLight(0x30365E, 0.9));
  const moon = new T.DirectionalLight(0x8090C0, 0.35); moon.position.set(-1, 2, 2); scene.add(moon);
  const lamps = [0, 1, 2].map(() => { const l = new T.PointLight(0xFFFFFF, 0, 0, 1); l.userData.k = 0; scene.add(l); return l; });   // each burst lights the shore for a moment
  let lampI = 0;

  /* ---------- the water: dark, rippled, and see-through to the reflection under it ---------- */
  const water = new T.Mesh(new T.PlaneGeometry(3000, 3000), new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false,
    uniforms: { t: { value: 0 }, hor: { value: HOR }, flash: { value: flash } },
    vertexShader: 'varying vec3 vW;varying float vZ;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vec4 mv=viewMatrix*w;vZ=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform float t;uniform vec3 hor;uniform vec3 flash;varying vec3 vW;varying float vZ;void main(){' +
      'float r=sin(vW.z*2.3+sin(vW.x*0.07+t*0.5)*3.0+t*1.6)*0.5+0.5+0.35*sin(vW.z*5.1-vW.x*0.2-t*2.1);r=smoothstep(0.3,1.2,r);' +
      'float far=smoothstep(120.0,700.0,vZ);vec3 c=mix(vec3(0.012,0.016,0.04),hor*0.75,far)+flash*0.25;' +
      'gl_FragColor=vec4(c,mix(0.55+0.25*r,1.0,far));}' }));
  water.rotation.x = -Math.PI / 2; water.renderOrder = 2; scene.add(water);

  /* ---------- sparks: soft points for the stars, lines for the streaks behind them, both shared with the reflection ---------- */
  const hp = new Float32Array(MAX * 3), hc = new Float32Array(MAX * 3), hs = new Float32Array(MAX), lp = new Float32Array(MAX * 6), lc = new Float32Array(MAX * 6);
  const heads = new T.BufferGeometry(), lines = new T.BufferGeometry();
  const dyn = (g, name, arr, n) => { const a = new T.BufferAttribute(arr, n); a.setUsage(T.DynamicDrawUsage); g.setAttribute(name, a); };
  dyn(heads, 'position', hp, 3); dyn(heads, 'aC', hc, 3); dyn(heads, 'aS', hs, 1); dyn(lines, 'position', lp, 3); dyn(lines, 'aC', lc, 3);
  heads.boundingSphere = lines.boundingSphere = new T.Sphere(new V(), 1e5);
  const pointMat = dim => new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, uniforms: { px: { value: 1 }, dim: { value: dim } },
    vertexShader: 'attribute vec3 aC;attribute float aS;uniform float px;uniform float dim;varying vec3 vC;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);' +
      'float s=aS*px/-mv.z;vC=aC*dim*min(1.0,s/2.0);gl_PointSize=max(2.0,s);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vC;void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;float a=exp(-d*d*3.5);gl_FragColor=vec4(vC*a+vec3(smoothstep(0.4,0.0,d)*0.45)*max(vC.r,max(vC.g,vC.b)),1.0);}' });
  const lineMat = dim => new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, uniforms: { dim: { value: dim } },
    vertexShader: 'attribute vec3 aC;uniform float dim;varying vec3 vC;void main(){vC=aC*dim;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vC;void main(){gl_FragColor=vec4(vC,1.0);}' });
  const pm = pointMat(1), pmM = pointMat(0.42);
  const P = new T.Points(heads, pm), L = new T.LineSegments(lines, lineMat(1)), PM = new T.Points(heads, pmM), LM = new T.LineSegments(lines, lineMat(0.42));
  P.renderOrder = L.renderOrder = 3; PM.renderOrder = LM.renderOrder = 1; P.frustumCulled = L.frustumCulled = PM.frustumCulled = LM.frustumCulled = false;
  world.add(P, L); mirror.add(PM, LM);

  /* ---------- smoke: a few soft puffs that hang where shells burst, lit by the newest ---------- */
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
  for (let i = 0; i < (RM ? 0 : 14); i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0, fog: false, color: 0x8C8CB4 })); s.visible = false; s.renderOrder = 2.5; world.add(s); puffs.push({ s: s, t: 0, life: 1 }); }
  let puffI = 0;

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    W = w; H = h; dpr = Math.min(2, window.devicePixelRatio || 1); top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    // a level camera with a shifted lens, so buildings stand straight: the full picture is SHIFT times the height left under the read-outs, and the
    // canvas shows its top part, with the horizon low down
    const full = (H - top) * SHIFT; camera.aspect = W / full; camera.setViewOffset(W, full, 0, -top, W, H); camera.updateProjectionMatrix();
    const px = full * dpr / (2 * TANF); pm.uniforms.px.value = pmM.uniforms.px.value = px; sky.userData.stars.uniforms.px.value = dpr;
    return true;
  }
  function reset() { rockets.length = 0; sparks.length = 0; for (const p of puffs) { p.s.visible = false; p.t = p.life; } for (const l of lamps) { l.intensity = 0; l.userData.k = 0; } flash.setRGB(0, 0, 0); idleT = 1.5; }
  function placeCamera() {
    const k = RM ? 0 : clock;
    camera.position.set(Math.sin(k * 0.035) * 22, 6 + Math.sin(k * 0.05) * 1.5, 72 + Math.sin(k * 0.027) * 6);
    camera.lookAt(camera.position.x * 0.35, camera.position.y, -40); camera.updateMatrixWorld(); sky.position.copy(camera.position);
  }

  /* a shell from the core: {x, h, size, hue, hue2, kind, finale}. It bursts where the flat drawing would put it on the screen, at a depth of its own */
  const ray = new V(), cam = new V(), fwd = new V();
  function launch(e) {
    if (!W && !resize()) return;
    placeCamera();
    const py = top + (1 - e.h) * (H - top) * 0.72, d = rnd(85, 165);
    ray.set((e.x * 2 - 1) * 0.86, 1 - 2 * py / H, 0.5).unproject(camera); cam.copy(camera.position); ray.sub(cam).normalize();
    const at = cam.clone().addScaledVector(ray, d), depth = d * ray.dot(camera.getWorldDirection(fwd));   // d away along the ray; its depth in front of the camera
    at.y = Math.max(14, at.y);
    const per = 2 * depth * TANF / ((H - top) * SHIFT), R = (0.12 + 0.2 * e.size) * Math.min(W, (H - top) * 1.1) * per;   // the burst's size on the screen, in the world at that depth
    rockets.push({ p: new V(at.x + rnd(-4, 4), 0.6, at.z), from: new V(at.x + rnd(-4, 4), 0.6, at.z), to: at, t: 0, dur: 0.8 + 0.55 * e.h + Math.random() * 0.15, e: e, R: R });
  }
  function event(e) { if (e.k === 'shell') launch(e); else if (e.k === 'finale' && !RM) flash.setRGB(0.12, 0.1, 0.08); }
  function spark(p) { if (sparks.length < MAX) sparks.push(p); }
  const unit = () => { const z = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - z * z); return new V(Math.cos(a) * r, z, Math.sin(a) * r); };
  const hsl = (h, s, l) => tmp.setHSL(h / 360, s / 100, l / 100).clone();
  /* the burst. k is drag (the sparks slow), g gravity (they fall), tr how long a streak they leave */
  function burst(r) {
    const e = r.e, o = r.to, R = r.R, n = (RM ? 0.45 : 1) * (0.6 + 0.5 * Math.min(1.2, e.size)), two = e.hue2 >= 0, ca = hsl(e.hue, 100, 58), cb = two ? hsl(e.hue2, 100, 58) : ca;
    const gold = hsl(40, 92, 52), add = (dir, sp, q) => spark(Object.assign({ x: o.x, y: o.y, z: o.z, vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp, t: 0 }, q));
    const ball = (N, k, g, life, s, tr, c, extra) => { for (let i = 0; i < N; i++) add(unit(), R * k * (0.93 + Math.random() * 0.1), Object.assign({ k: k, g: g, life: life * (0.85 + Math.random() * 0.3), s: s, tr: tr, c: c === 'two' ? (i % 2 ? cb : ca) : c }, extra)); };
    const s0 = R * 0.035;                                                  // a star's size, in the world
    if (e.kind === 'peony') ball(Math.round(110 * n), 1.7, R * 0.3, 1.3, s0, 0.05, 'two');
    else if (e.kind === 'chrysanthemum') ball(Math.round(120 * n), 1.5, R * 0.35, 1.7, s0 * 0.85, 0.16, 'two', { glit: true });
    else if (e.kind === 'ring') {                                          // a ring, tilted any way in the sky
      const nrm = unit(), u = new V().crossVectors(nrm, Math.abs(nrm.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(), w = new V().crossVectors(nrm, u), N = Math.round(80 * n);
      for (let i = 0; i < N; i++) { const a = i / N * TAU; add(u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)), R * 1.6, { k: 1.6, g: R * 0.25, life: 1.5, s: s0, tr: 0.07, c: i % 2 ? cb : ca }); }
      ball(Math.round(18 * n), 0.8, R * 0.3, 1, s0 * 0.8, 0.03, hsl(e.hue, 60, 85));
    } else if (e.kind === 'willow') { ball(Math.round(20 * n), 1.4, R * 0.3, 0.9, s0, 0.05, ca); ball(Math.round(110 * n), 2.2, R * 0.55, 3.1, s0 * 0.75, 0.3, gold, { glit: true, droop: true }); }
    else if (e.kind === 'palm') {
      const N = 8 + Math.floor(Math.random() * 3);
      for (let i = 0; i < N; i++) { const d = unit(); d.y = Math.abs(d.y) * 0.6 + 0.25; d.normalize(); add(d, R * 1.6, { k: 1.3, g: R * 0.7, life: 2, s: s0 * 1.6, tr: 0.32, c: i % 2 ? cb : ca, glit: true }); }
      ball(Math.round(30 * n), 1.2, R * 0.4, 1.4, s0 * 0.7, 0.1, gold);
    } else {                                                              // crossette: stars that each split in four
      const N = 12 + Math.floor(Math.random() * 4);
      for (let i = 0; i < N; i++) add(unit(), R * 1.5, { k: 1.6, g: R * 0.3, life: 2, s: s0 * 1.2, tr: 0.12, c: i % 2 ? cb : ca, split: 0.55 + Math.random() * 0.15, R: R });
    }
    spark({ x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: 0.12, s: R * 0.22, tr: 0, c: hsl(e.hue, 50, 62), flare: true });   // the white-hot moment it bursts
    const l = lamps[lampI++ % lamps.length]; l.position.copy(o); l.color.copy(ca); l.userData.k = (e.finale ? 1.4 : 1) * (0.7 + 0.5 * e.size); l.intensity = l.userData.k;
    tmp.copy(ca).multiplyScalar(0.07 * Math.min(1.3, e.size)); flash.add(tmp);
    for (let i = 0; i < 2 && puffs.length; i++) { const p = puffs[puffI++ % puffs.length]; p.s.visible = true; p.t = 0; p.life = rnd(5, 7); p.s.position.set(o.x + rnd(-R, R) * 0.5, o.y + rnd(-R, R) * 0.3, o.z + rnd(-R, R) * 0.5); p.r = R * rnd(1, 1.6); }
  }
  function split(p) {
    const v = new V(p.vx, p.vy, p.vz), sp = v.length() * 0.9 + p.R * 0.5; v.normalize();
    const u = new V().crossVectors(v, new V(0, 1, 0)).normalize(), w = new V().crossVectors(v, u);
    for (const d of [u, u.clone().negate(), w, w.clone().negate()]) { d.addScaledVector(v, 0.4).normalize(); spark({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, k: 2, g: p.g, t: 0, life: 0.8, s: p.s * 0.8, tr: 0.1, c: p.c, glit: true }); }
  }

  /* v: {st, music, level 0..1}; dt in real seconds */
  function draw(v, dt) {
    if (!W && !resize()) return;
    clock += dt; placeCamera();
    if ((v.st === 'idle' || v.st === 'stopped') && !rockets.length) { idleT -= dt; if (idleT <= 0) { idleT = 2.6 + Math.random() * 1.6;   // a small shell now and then before the start and after the end
      launch({ x: 0.2 + Math.random() * 0.6, h: 0.45 + Math.random() * 0.3, size: 0.35, hue: Math.floor(Math.random() * 12) * 30, hue2: -1, kind: Math.random() < 0.5 ? 'peony' : 'ring' }); } }
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.t += dt; const p = Math.min(1, r.t / r.dur), q = 1 - (1 - p) * (1 - p);
      r.p.lerpVectors(r.from, r.to, q);
      if (!RM || Math.random() < 0.3) spark({ x: r.p.x + rnd(-0.3, 0.3), y: r.p.y - 0.5, z: r.p.z + rnd(-0.3, 0.3), vx: rnd(-1, 1), vy: rnd(-4, -1), vz: rnd(-1, 1), k: 2, g: -3, t: 0, life: rnd(0.35, 0.6), s: r.R * 0.025, tr: 0, c: hsl(34, 100, 62) });
      spark({ x: r.p.x, y: r.p.y, z: r.p.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: dt * 0.5, s: r.R * 0.05, tr: 0, c: hsl(40, 100, 80) });   // the shell itself, for one frame
      if (p >= 1) { rockets.splice(i, 1); burst(r); } }
    // move and fill the buffers
    let nh = 0, nl = 0; const kf = {};
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t += dt;
      if (p.split && p.t >= p.split) { sparks.splice(i, 1); split(p); continue; }
      if (p.t >= p.life) { sparks.splice(i, 1); continue; }
      const d = kf[p.k] || (kf[p.k] = Math.exp(-p.k * dt)); p.vx *= d; p.vz *= d; p.vy = p.vy * d - p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const age = p.t / p.life; let a = p.flare ? 1 - age : age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
      if (p.glit && age > 0.55 && !RM) a *= Math.random() < 0.55 ? 1 : 0.12;   // glitter as they burn out
      const hot = age < 0.06 && !p.flare ? 1 + (1 - age / 0.06) * 0.6 : 1, fade = p.droop ? 1 - age * 0.45 : 1, m = a * hot * fade;
      if (p.y < 0.2) continue;                                              // gone into the water
      hp[nh * 3] = p.x; hp[nh * 3 + 1] = p.y; hp[nh * 3 + 2] = p.z; hc[nh * 3] = p.c.r * m; hc[nh * 3 + 1] = p.c.g * m; hc[nh * 3 + 2] = p.c.b * m; hs[nh] = p.s; nh++;
      if (p.tr) { const j = nl * 6, b = p.tr; lp[j] = p.x; lp[j + 1] = p.y; lp[j + 2] = p.z; lp[j + 3] = p.x - p.vx * b; lp[j + 4] = p.y - p.vy * b + (p.droop ? p.g * b * b * 0.5 : 0); lp[j + 5] = p.z - p.vz * b;
        lc[j] = p.c.r * m * 0.7; lc[j + 1] = p.c.g * m * 0.7; lc[j + 2] = p.c.b * m * 0.7; lc[j + 3] = lc[j + 4] = lc[j + 5] = 0; nl++; }
    }
    heads.setDrawRange(0, nh); lines.setDrawRange(0, nl * 2);
    for (const k of ['position', 'aC', 'aS']) heads.attributes[k].needsUpdate = true;
    for (const k of ['position', 'aC']) lines.attributes[k].needsUpdate = true;
    for (const l of lamps) if (l.userData.k > 0) { l.userData.k = Math.max(0, l.userData.k - dt * 1.6); l.intensity = l.userData.k * l.userData.k; }
    for (const p of puffs) if (p.s.visible) { p.t += dt; if (p.t >= p.life) { p.s.visible = false; continue; } p.s.position.x += dt * 1.2; p.s.position.y += dt * 0.4; p.r += dt * 1.5;
      p.s.scale.setScalar(p.r); let lit = 0; for (const l of lamps) lit = Math.max(lit, l.intensity); p.s.material.opacity = (1 - p.t / p.life) * (0.05 + Math.min(1, lit) * 0.1); }
    flash.multiplyScalar(Math.exp(-dt * 2.2));
    lift += ((v.music ? v.level * 0.25 : 0) - lift) * Math.min(1, dt * 3); skyMat.uniforms.lift.value = lift;
    sky.userData.stars.uniforms.t.value = clock; water.material.uniforms.t.value = RM ? 0 : clock;
    renderer.render(scene, camera);
  }
  function busy() { return rockets.length + sparks.length; }
  function dispose() { renderer.dispose(); }
  return { resize: resize, draw: draw, event: event, reset: reset, busy: busy, dispose: dispose };
}
