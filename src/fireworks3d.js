/* Fireworks in 3D (three.js r128): a harbour town at night across the bay, under a low moon, with a lighthouse, a Ferris wheel and boats.
   Shells burst as spheres and tilted rings at different depths, light up the town and show again in the water; the camera drifts along the shore. */
/* exported makeFirework3D */   // used by src/fireworks.js
function makeFirework3D(cv, hud, MT) {
  'use strict';
  const T = THREE, RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, TAU = Math.PI * 2;
  const MAX = RM ? 900 : 3200, FOV = 70, SHIFT = 1.45, TANF = Math.tan(FOV / 2 * Math.PI / 180);
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(FOV, 1, 0.5, 2400);
  const V = T.Vector3, HOR = new T.Color(0x2A3C5C), MOON = new V(0.15, 0.2, -1).normalize();   // the moonlit haze at the horizon; where the moon hangs
  scene.fog = new T.Fog(0x22324F, 260, 1100);
  let W = 0, H = 0, top = 0, dpr = 1, clock = 0, idleT = 1.5, lift = 0;
  const rockets = [], sparks = [], puffs = [], flash = new T.Color(0, 0, 0), tmp = new T.Color(), anim = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
  /* soft points of light in the scene (string lights, lamps, the wheel), sized in the world, twinkling a little */
  const lightMat = dim => new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { px: { value: 1 }, t: { value: 0 }, dim: { value: dim } },
    vertexShader: 'attribute vec3 aC;attribute float aS;attribute float aPh;uniform float px;uniform float t;uniform float dim;varying vec3 vC;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);' +
      'float s=aS*px/-mv.z;vC=aC*dim*min(1.0,s/2.0)*(0.85+0.15*sin(t*2.5+aPh));gl_PointSize=max(1.5,s);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vC;void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;gl_FragColor=vec4(vC*(exp(-d*d*5.0)+smoothstep(0.3,0.0,d)*0.6),1.0);}' });
  const lightMats = [lightMat(1), lightMat(0.5)];
  function lightPoints(list, mirrored) {   // list: [x, y, z, colour, size]
    const n = list.length, pos = new Float32Array(n * 3), c = new Float32Array(n * 3), sz = new Float32Array(n), ph = new Float32Array(n);
    list.forEach((q, i) => { pos.set([q[0], q[1], q[2]], i * 3); tmp.set(q[3]); c.set([tmp.r, tmp.g, tmp.b], i * 3); sz[i] = q[4]; ph[i] = i * 2.39; });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aC', new T.BufferAttribute(c, 3)); g.setAttribute('aS', new T.BufferAttribute(sz, 1)); g.setAttribute('aPh', new T.BufferAttribute(ph, 1));
    const p = new T.Points(g, lightMats[mirrored ? 1 : 0]); p.frustumCulled = false; p.renderOrder = mirrored ? 1 : 3; return p;
  }

  /* ---------- the sky: a gradient dome with the moon's glow, the moon, and stars ---------- */
  const sky = new T.Group(); scene.add(sky);
  const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color(0x040916) }, mid: { value: new T.Color(0x0D1931) }, hor: { value: HOR }, flash: { value: flash }, lift: { value: 0 }, moon: { value: MOON } },
    vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top;uniform vec3 mid;uniform vec3 hor;uniform vec3 flash;uniform float lift;uniform vec3 moon;varying vec3 vD;void main(){vec3 d=normalize(vD);float h=d.y;' +
      'vec3 c=mix(hor,mid,smoothstep(-0.02,0.24,h));c=mix(c,top,smoothstep(0.24,0.9,h));c*=1.0+lift;float m=max(dot(d,moon),0.0);' +
      'c+=vec3(0.5,0.58,0.76)*(pow(m,10.0)*0.16+pow(m,120.0)*0.3);c+=flash*(1.0-smoothstep(-0.05,0.7,h));gl_FragColor=vec4(c,1.0);}' });
  const dome = new T.Mesh(new T.SphereGeometry(1000, 24, 16), skyMat); dome.renderOrder = -3; sky.add(dome);
  {
    const mc = document.createElement('canvas'); mc.width = mc.height = 128; const g = mc.getContext('2d'), r = MT.raceRng(5);
    const gr = g.createRadialGradient(56, 56, 4, 64, 64, 62); gr.addColorStop(0, '#FFF8E8'); gr.addColorStop(0.9, '#EFE4C8'); gr.addColorStop(1, 'rgba(239,228,200,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill();
    for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(160,150,130,' + (0.12 + r() * 0.16).toFixed(2) + ')'; g.beginPath(); g.arc(30 + r() * 68, 30 + r() * 68, 5 + r() * 14, 0, TAU); g.fill(); }   // the seas
    const m = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(mc), fog: false, depthWrite: false, transparent: true }));
    m.position.copy(MOON).multiplyScalar(900); m.scale.setScalar(54); m.renderOrder = -2; sky.add(m);
  }
  {
    const pos = [], ph = [], sz = [];
    for (let i = 0; i < 700; i++) { const a = Math.random() * TAU, y = 0.06 + Math.pow(Math.random(), 0.7) * 0.94, r = Math.sqrt(1 - y * y), d = new V(Math.cos(a) * r, y, Math.sin(a) * r);
      if (d.dot(MOON) > 0.96) continue; pos.push(d.x * 950, d.y * 950, d.z * 950); ph.push(Math.random() * TAU); sz.push(Math.random() < 0.12 ? 2.4 : 1.3); }   // fewer stars by the moon
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aPh', new T.Float32BufferAttribute(ph, 1)); g.setAttribute('aSz', new T.Float32BufferAttribute(sz, 1));
    const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, uniforms: { t: { value: 0 }, px: { value: 1 } },
      vertexShader: 'attribute float aPh;attribute float aSz;uniform float t;uniform float px;varying float vA;void main(){vA=' + (RM ? '0.6' : '0.45+0.35*sin(t*(1.0+fract(aPh)*1.5)+aPh)') + ';gl_PointSize=aSz*px;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying float vA;void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;gl_FragColor=vec4(vec3(0.86,0.9,1.0)*vA*(1.0-d),1.0);}' });
    const st = new T.Points(g, m); st.renderOrder = -2; sky.add(st); sky.userData.stars = m;
  }

  /* ---------- the waterfront: built twice from the same seed, once on land and once upside down under the water for its reflection ---------- */
  const world = new T.Group(), mirror = new T.Group(); mirror.scale.y = -1; scene.add(world, mirror);
  const SHORE = -178;   // the quay's edge; the town climbs the hill behind it
  const hillY = (x, z) => { const d = Math.max(0, SHORE - 6 - z); return d * (0.34 + 0.12 * Math.sin(x / 47) + 0.07 * Math.sin(x / 19 + 1)) * (x > 30 && x < 90 ? 0.15 : 1); };
  const lam = c => new T.MeshLambertMaterial({ color: c });
  const M = { ground: lam(0x15232B), quay: lam(0x3A3A42), tree: lam(0x14291F), roof: lam(0xFFFFFF), stone: lam(0x2A2C33), white: lam(0xE8E2D6), red: lam(0xB8433A), steel: lam(0x4A5268), hull: lam(0x2E3442), sail: lam(0xD8D0BE) };
  M.sail.side = T.DoubleSide;
  M.house = new T.MeshLambertMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveMap: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = MT.raceRng(77); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (r() < 0.45) { g.fillStyle = r() < 0.75 ? '#FFB868' : '#FFE2A8'; g.globalAlpha = 0.45 + r() * 0.5; g.fillRect(8 + x * 19, 8 + y * 19, 9, 11); }
    const t = new T.CanvasTexture(c); t.magFilter = T.NearestFilter; return t; })() });
  M.lamp = new T.MeshBasicMaterial({ color: 0xFFE7A8 });
  M.beam = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false,
    vertexShader: 'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vU;void main(){gl_FragColor=vec4(vec3(1.0,0.92,0.7)*pow(vU.y,2.5)*0.22,1.0);}' });
  const box = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), cone = new T.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
  const roofGeo = (() => { const sh = new T.Shape(); sh.moveTo(-0.55, 0); sh.lineTo(0.55, 0); sh.lineTo(0, 0.5); sh.closePath(); return new T.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5); })();
  const HOUSE = ['#B8684A', '#C49A4A', '#C88276', '#C8BCA2', '#5E8E88', '#6C7EAA', '#A88A6A', '#9C5050', '#C4AA88'], ROOF = ['#7A3B2E', '#8C4A32', '#3B4152', '#5A3A36'];
  function ridge(z, h, top, bottom, seed) {   // a mountain ridge, moonlit along its top
    const sh = new T.Shape(), r = MT.raceRng(seed); sh.moveTo(-1600, -8);
    for (let x = -1600; x <= 1600; x += 50) sh.lineTo(x, h * (0.5 + 0.28 * Math.sin(x / 210 + seed) + 0.14 * Math.sin(x / 77 + seed * 2) + 0.12 * r()));
    sh.lineTo(1600, -8); sh.closePath();
    const g = new T.ShapeGeometry(sh), p = g.attributes.position, c = new Float32Array(p.count * 3), a = new T.Color(bottom), b = new T.Color(top);
    for (let i = 0; i < p.count; i++) { tmp.copy(a).lerp(b, Math.max(0, Math.min(1, p.getY(i) / h))); c.set([tmp.r, tmp.g, tmp.b], i * 3); }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true })); m.position.z = z; return m;
  }
  function instances(geo, mat, list) {   // list: [x, y, z, sx, sy, sz, colour, turn]
    const im = new T.InstancedMesh(geo, mat, list.length), o = new T.Object3D();
    list.forEach((q, i) => { o.position.set(q[0], q[1], q[2]); o.scale.set(q[3], q[4], q[5]); o.rotation.set(0, q[7] || 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); if (q[6]) im.setColorAt(i, tmp.set(q[6])); });
    return im;
  }
  function scenery(root, mirrored) {
    const r = MT.raceRng(2024), pick = a => a[Math.floor(r() * a.length)], add = (geo, mat, x, y, z, sx, sy, sz) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); root.add(m); return m; };
    root.add(ridge(-720, 170, 0x44587C, 0x1E2A44, 1), ridge(-560, 110, 0x31446A, 0x162036, 2), ridge(-420, 64, 0x22314E, 0x0E1628, 3));
    const ground = new T.PlaneGeometry(800, 180, 80, 18).rotateX(-Math.PI / 2).translate(0, 0, SHORE - 96), gp = ground.attributes.position;
    for (let i = 0; i < gp.count; i++) gp.setY(i, hillY(gp.getX(i), gp.getZ(i)) - 0.5);
    ground.computeVertexNormals(); root.add(new T.Mesh(ground, M.ground));
    add(box, M.quay, 0, 0, SHORE - 5, 800, 2.6, 10);   // the quay
    add(box, M.quay, -62, 0, SHORE + 24, 10, 3, 58);   // the breakwater out to the lighthouse
    // houses climbing the hill, close together by the water and thinning out higher up; the bell tower among them
    const houses = [], roofs = [], trees = [];
    for (let z = SHORE - 9; z > SHORE - 120; z -= 8 + r() * 4) for (let x = -260; x < 230; x += 7 + r() * 6) {
      const row = SHORE - 9 - z, wheel = x > 32 && x < 84 && row < 30, light = x > -76 && x < -48 && row < 12;
      if (wheel || light || r() > Math.max(0.12, 0.72 - row / 130)) { if (r() < 0.35 && !wheel) trees.push([x + rnd(-2, 2), hillY(x, z) - 0.5, z, 2.2, 8 + r() * 6, 2.2, 0]); continue; }
      const w = 5 + r() * 4, d = 5 + r() * 3, h = (row < 4 ? 8 : 5) + r() * 5, y = hillY(x, z) - 1, turn = (r() - 0.5) * 0.25;
      houses.push([x, y, z, w, h, d, pick(HOUSE), turn]); roofs.push([x, y + h, z, w * 1.12, 1 + r() * 2.2, d * 1.1, pick(ROOF), turn]);
    }
    const bt = [-16, hillY(-16, SHORE - 44) - 1, SHORE - 44]; houses.push([bt[0], bt[1], bt[2], 6, 30, 6, '#EBDDC0', 0]);
    add(new T.ConeGeometry(4.6, 14, 4).translate(0, 7, 0), M.roof, bt[0], bt[1] + 30, bt[2], 1, 1, 1).rotation.y = Math.PI / 4;
    root.add(instances(box, M.house, houses), instances(roofGeo, M.roof, roofs), instances(cone, M.tree, trees));
    // the lighthouse at the end of the breakwater, its beam sweeping the bay
    const lx = -62, lz = SHORE + 50, ly = 3;
    add(new T.CylinderGeometry(2.1, 2.9, 20, 16).translate(0, 10, 0), M.white, lx, ly, lz, 1, 1, 1);
    for (const y of [4, 11]) add(new T.CylinderGeometry(2.6, 2.75, 3, 16).translate(0, 1.5, 0), M.red, lx, ly + y, lz, 1, 1, 1);
    add(new T.CylinderGeometry(2.3, 2.3, 3, 12).translate(0, 1.5, 0), M.lamp, lx, ly + 20, lz, 1, 1, 1);
    add(new T.ConeGeometry(2.8, 3, 12).translate(0, 1.5, 0), M.red, lx, ly + 23, lz, 1, 1, 1);
    let beam = null;
    if (!mirrored && !RM) { beam = new T.Group(); beam.position.set(lx, ly + 21.5, lz);
      const b = new T.Mesh(new T.CylinderGeometry(0.4, 10, 170, 20, 1, true).translate(0, -85, 0).rotateZ(Math.PI / 2), M.beam); b.renderOrder = 4; beam.add(b); root.add(beam); }
    // the Ferris wheel on the promenade, lit in colours that chase round it
    const wx = 58, wz = SHORE - 12, wy = hillY(wx, wz) + 25, R = 20, wheel = new T.Group(); wheel.position.set(wx, wy, wz); root.add(wheel);
    for (const s of [-1, 1]) for (const k of [-1, 1]) { const leg = add(box, M.steel, wx + s * 0.5, hillY(wx, wz) - 1, wz + k * 3.5, 0.9, Math.hypot(25, 11), 0.9); leg.rotation.z = -s * Math.atan2(11, 25); leg.position.x = wx + s * 11; }
    const ring = [], spokes = [], bulbs = [];
    for (let i = 0; i <= 64; i++) { const a = i / 64 * TAU; ring.push(Math.cos(a) * R, Math.sin(a) * R, 0); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; spokes.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0); }
    for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; bulbs.push([Math.cos(a) * R, Math.sin(a) * R, 0, '#FFFFFF', 1.3]); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; bulbs.push([Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, 0, '#FFFFFF', 0.9]); }
    const steel = new T.LineBasicMaterial({ color: 0x8A96B4, transparent: true, opacity: 0.55 });
    wheel.add(new T.Line(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(ring, 3)), steel), new T.LineSegments(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(spokes, 3)), steel));
    const wl = lightPoints(bulbs, mirrored); wheel.add(wl);
    const cars = new T.InstancedMesh(box, M.house, 12); for (let i = 0; i < 12; i++) cars.setColorAt(i, tmp.set(HOUSE[i % HOUSE.length])); root.add(cars);
    // string lights along the promenade, between posts
    const posts = [], strings = [], LC = ['#FFC46B', '#FF8F8F', '#A8F0D8', '#FFF1D0'];
    for (let x = -120; x <= 120; x += 24) posts.push([x, 0, SHORE - 2, 0.5, 9, 0.5, 0]);
    for (let x = -120; x < 120; x += 24) for (let j = 0; j <= 8; j++) { const f = j / 8; strings.push([x + f * 24, 8.6 - 1.8 * (1 - (2 * f - 1) * (2 * f - 1)), SHORE - 2, LC[(j + x / 24 | 0) & 3], 1.1]); }
    strings.push([lx, ly + 21.5, lz, '#FFE7A8', 5]);   // the lighthouse lamp
    root.add(instances(box, M.stone, posts));
    // sailboats moored in the bay, bobbing
    const boats = [];
    for (const [bx, bz, s] of [[-96, -130, 1], [-34, -150, -1], [18, -138, 1], [84, -128, -1], [128, -148, 1]]) {
      const b = new T.Group(); b.position.set(bx, 0, bz); b.rotation.y = s * 0.35 + (r() - 0.5) * 0.4; root.add(b);
      const hs = new T.Shape(); hs.moveTo(-5, 1.4); hs.lineTo(5.6, 1.4); hs.lineTo(4.2, -0.4); hs.lineTo(-4.2, -0.4); hs.closePath();
      b.add(new T.Mesh(new T.ExtrudeGeometry(hs, { depth: 2.8, bevelEnabled: false }).translate(0, 0, -1.4), M.hull));
      const cab = new T.Mesh(box, M.white); cab.position.set(-1.2, 1.4, 0); cab.scale.set(3.2, 1.3, 1.8); b.add(cab);
      const mast = new T.Mesh(box, M.steel); mast.position.set(0.8, 1.4, 0); mast.scale.set(0.25, 13, 0.25); b.add(mast);
      const ss = new T.Shape(); ss.moveTo(0, 0); ss.lineTo(0, 11.5); ss.lineTo(-5.2, 0); ss.closePath();
      const sail = new T.Mesh(new T.ShapeGeometry(ss), M.sail); sail.position.set(0.6, 2.2, 0); b.add(sail);
      const top = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xFF7A6A, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: mirrored ? 0.5 : 1 })); top.position.set(0.8, 14.6, 0); top.scale.setScalar(2.4); b.add(top);
      boats.push({ g: b, ph: r() * TAU });
    }
    root.add(lightPoints(strings, mirrored));
    anim.push({ wheel: wheel, bulbs: wl, cars: cars, R: R, boats: boats, beam: beam });
  }
  scenery(world, false); scenery(mirror, true);
  const o3 = new T.Object3D();
  function animate() {
    const k = RM ? 0 : clock;
    for (const a of anim) {
      a.wheel.rotation.z = k * 0.09;
      for (let i = 0; i < 12; i++) { const ang = i / 12 * TAU + a.wheel.rotation.z; o3.position.set(a.wheel.position.x + Math.cos(ang) * a.R, a.wheel.position.y + Math.sin(ang) * a.R - 2.6, a.wheel.position.z); o3.scale.set(2.2, 2.2, 2); o3.updateMatrix(); a.cars.setMatrixAt(i, o3.matrix); }
      a.cars.instanceMatrix.needsUpdate = true;
      for (const b of a.boats) { b.g.position.y = Math.sin(k * 0.8 + b.ph) * 0.25; b.g.rotation.z = Math.sin(k * 0.6 + b.ph) * 0.04; }
      if (a.beam) a.beam.rotation.y = k * 0.55;
    }
    for (const a of anim) { const wl = a.bulbs.geometry.attributes.aC;   // the wheel's lights chase round in colour
      for (let i = 0; i < wl.count; i++) { tmp.setHSL(((i < 48 ? i / 48 : (i - 48) / 16) + k * 0.08) % 1, 0.9, 0.62); wl.setXYZ(i, tmp.r, tmp.g, tmp.b); }
      wl.needsUpdate = true; }
    for (const m of lightMats) m.uniforms.t.value = k;
  }
  scene.add(new T.AmbientLight(0x2A3654, 0.35), new T.HemisphereLight(0x5A6C94, 0x05070C, 0.3));
  for (const x of [-60, 0, 60]) { const l = new T.PointLight(0xFFA860, 0.35, 120, 1.5); l.position.set(x, 6, SHORE + 4); scene.add(l); }   // the promenade's warm glow on the houses
  const lamps = [0, 1, 2].map(() => { const l = new T.PointLight(0xFFFFFF, 0, 0, 1); l.userData.k = 0; scene.add(l); return l; });   // each burst lights the shore for a moment
  let lampI = 0;

  /* ---------- the water: dark, rippled, see-through to the reflection under it, with the moon's path glittering across it ---------- */
  const water = new T.Mesh(new T.PlaneGeometry(3000, 3000), new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false,
    uniforms: { t: { value: 0 }, hor: { value: HOR }, flash: { value: flash }, moon: { value: MOON } },
    vertexShader: 'varying vec3 vW;varying float vZ;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vec4 mv=viewMatrix*w;vZ=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform float t;uniform vec3 hor;uniform vec3 flash;uniform vec3 moon;varying vec3 vW;varying float vZ;' +
      'float wave(vec2 p){return sin(p.y*2.3+sin(p.x*0.07+t*0.5)*3.0+t*1.6)*0.5+0.35*sin(p.y*5.1-p.x*0.2-t*2.1)+0.25*sin(p.x*0.9+p.y*1.7+t*1.1);}' +
      'void main(){vec2 p=vW.xz;float h0=wave(p),hx=(wave(p+vec2(0.05,0.0))-h0)/0.05,hz=(wave(p+vec2(0.0,0.05))-h0)/0.05;' +
      'float far=smoothstep(120.0,900.0,vZ);vec3 n=normalize(vec3(-hx*0.07*(1.0-far*0.8),1.0,-hz*0.07*(1.0-far*0.8)));vec3 r=reflect(normalize(vW-cameraPosition),n);' +
      'float s=pow(max(dot(r,moon),0.0),260.0)*1.8;float rr=smoothstep(0.3,1.2,h0*0.5+0.5);' +
      'vec3 c=mix(vec3(0.014,0.026,0.05),hor*0.8,far)+flash*0.25+vec3(1.0,0.95,0.84)*s;gl_FragColor=vec4(c,clamp(mix(0.55+0.25*rr,1.0,far)+s,0.0,1.0));}' }));
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
  for (let i = 0; i < (RM ? 0 : 14); i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, fog: false, color: 0x8C8CB4 })); s.visible = false; s.renderOrder = 2.5; world.add(s); puffs.push({ s: s, t: 0, life: 1 }); }
  let puffI = 0;

  function resize() {
    const host = cv.parentElement, w = host.clientWidth, h = host.clientHeight; if (w < 10 || h < 10) return false;
    W = w; H = h; dpr = Math.min(2, window.devicePixelRatio || 1); top = Math.min(h * 0.55, hud.offsetTop + hud.offsetHeight);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    // a level camera with a shifted lens, so buildings stand straight: the full picture is SHIFT times the height left under the read-outs, and the
    // canvas shows its top part, with the horizon low down
    const full = (H - top) * SHIFT; camera.aspect = W / full; camera.setViewOffset(W, full, 0, -top, W, H); camera.updateProjectionMatrix();
    const px = full * dpr / (2 * TANF); pm.uniforms.px.value = pmM.uniforms.px.value = px; for (const m of lightMats) m.uniforms.px.value = px; sky.userData.stars.uniforms.px.value = dpr;
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
  /* the size of a burst on the screen, in the world at the shell's depth (per: world units a pixel there) */
  const SYM = (Hf, size) => Math.min(0.14 * Hf, 0.27 * W) * (0.85 + 0.25 * Math.min(1, size));   // a symbol's size on the screen
  const sizeR = (e, per) => (e.kind === 'trophy' ? Math.min(0.25 * (H - top), 0.48 * W) : e.kind === 'symbol' ? SYM(H - top, e.size) : (0.065 + 0.11 * e.size) * Math.min(W, (H - top) * 1.1)) * per;   // kept small beside the town's houses
  /* {k:'shell'} goes up and bursts by itself (the finale, and the shows before the start); {k:'launch'} goes up and waits for a note to set it off
     ({k:'burst'}), or fades and falls ({k:'fizzle'}) */
  function launch(e) {
    if (!W && !resize()) return;
    placeCamera();
    const wait = e.k === 'launch', trophy = e.kind === 'trophy', symbol = e.kind === 'symbol', Hf = H - top, Spx = symbol ? SYM(Hf, e.size) : 0;
    let py = trophy ? top + Hf * 0.36 : top + (1 - e.h) * Hf * 0.64, nx = trophy ? 0 : (e.x * 2 - 1) * 0.86, d = trophy ? 130 : rnd(85, 165);   // the trophy goes up in the middle of the sky
    if (symbol) { py = Math.max(top + Spx * 0.95, Math.min(top + Hf * 0.69 - Spx * 0.85, py)); const lim = Math.max(0, 1 - 1.8 * Spx / W); nx = Math.max(-lim, Math.min(lim, nx)); }   // a symbol stays whole in the sky
    ray.set(nx, 1 - 2 * py / H, 0.5).unproject(camera); cam.copy(camera.position); ray.sub(cam).normalize();
    const at = cam.clone().addScaledVector(ray, d), depth = d * ray.dot(camera.getWorldDirection(fwd));   // d away along the ray; its depth in front of the camera
    at.y = Math.max(14, at.y);
    const per = 2 * depth * TANF / ((H - top) * SHIFT), R = sizeR(wait ? { size: 0.8 } : e, per) * (wait ? 1.6 : 1);   // the burst's size on the screen, in the world at that depth
    const sx = trophy || symbol ? 0 : rnd(-4, 4);
    rockets.push({ p: new V(at.x + sx, 0.6, at.z), from: new V(at.x + sx, 0.6, at.z), to: at, t: 0, dur: 0.8 + 0.55 * e.h + Math.random() * 0.15, e: e, R: R, per: per, id: wait ? e.id : 0, wait: wait });
  }
  function event(e) {
    if (e.k === 'shell' || e.k === 'launch') launch(e);
    else if (e.k === 'burst') {                                         // a note sets a shell off where it is, rising or waiting
      let i = rockets.findIndex(r => r.id === e.id);
      if (i < 0) { const n = rockets.length; launch(Object.assign({}, e, { k: 'launch' })); if (rockets.length === n) return; i = rockets.length - 1; rockets[i].p.copy(rockets[i].to); }   // one sent up before the theme was on screen bursts where it would be
      const r = rockets.splice(i, 1)[0]; r.e = e; r.R = sizeR(e, r.per); r.to = r.p.clone(); burst(r);
    } else if (e.k === 'fizzle') { const r = rockets.find(q => q.id === e.id); if (r) { r.fz = 0; r.vy = 0; } }
    else if (e.k === 'finale' && !RM) flash.setRGB(0.12, 0.1, 0.08);
  }
  function spark(p) { if (sparks.length < MAX) sparks.push(p); }
  const unit = () => { const z = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - z * z); return new V(Math.cos(a) * r, z, Math.sin(a) * r); };
  const hsl = (h, s, l) => tmp.setHSL(h / 360, s / 100, l / 100).clone();
  /* the burst. k is drag (the sparks slow), g gravity (they fall), tr how long a streak they leave */
  function burst(r) {
    const e = r.e, o = r.to, R = r.R, n = (RM ? 0.45 : 1) * (0.6 + 0.5 * Math.min(1.2, e.size)), two = e.hue2 >= 0, ca = hsl(e.hue, 100, 58), cb = two ? hsl(e.hue2, 100, 58) : ca;
    const gold = hsl(40, 92, 52), add = (dir, sp, q) => spark(Object.assign({ x: o.x, y: o.y, z: o.z, vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp, t: 0 }, q));
    const ball = (N, k, g, life, s, tr, c, extra) => { for (let i = 0; i < N; i++) add(unit(), R * k * (0.93 + Math.random() * 0.1), Object.assign({ k: k, g: g, life: life * (0.85 + Math.random() * 0.3), s: s, tr: tr, c: c === 'two' ? (i % 2 ? cb : ca) : c }, extra)); };
    const s0 = (e.kind === 'trophy' ? R * 0.035 : R * 0.05);   // a star's size, in the world
    if (e.kind === 'trophy' || e.kind === 'symbol') {   // a shape facing the viewer: the finale's gold trophy, or a musical symbol in the note's colour; it opens, holds a moment, then falls
      const right = new V().setFromMatrixColumn(camera.matrixWorld, 0), up = new V().setFromMatrixColumn(camera.matrixWorld, 1), k = 2.4, trophy = e.kind === 'trophy', pale = hsl(48, 100, 80), c = trophy ? hsl(44, 95, 58) : hsl(e.hue, 100, 62);
      const at = (px, py, q) => { const d = right.clone().multiplyScalar(px * R).addScaledVector(up, py * R); sparks.push(Object.assign({ x: o.x, y: o.y, z: o.z, vx: d.x * k, vy: d.y * k, vz: d.z * k, k: k, g: R * 0.35, hold: trophy ? 1.8 : 1.4, t: 0, life: trophy ? 3.6 : 3, s: s0 * 1.5, tr: 0.05, c: c, glit: true }, q)); };
      for (const q of trophy ? MT.fwTrophyShape(0.05) : MT.fwSymbolShape(e.symbol, 0.05)) at(q[0], q[1]);
      if (trophy) for (let i = 0; i <= 8; i++) at(-0.3 + 0.06 * Math.sin(i / 8 * 1.6), 0.66 - i * 0.05, { c: pale, s: s0 * 0.9 });   // the shine down the cup, as on the trophy card
    } else if (e.kind === 'peony') ball(Math.round(110 * n), 1.7, R * 0.3, 1.3, s0, 0.05, 'two');
    else if (e.kind === 'chrysanthemum') ball(Math.round(120 * n), 1.5, R * 0.35, 1.7, s0 * 0.85, 0.16, 'two', { glit: true });
    else if (e.kind === 'ring') {   // a ring, tilted any way in the sky
      const nrm = unit(), u = new V().crossVectors(nrm, Math.abs(nrm.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(), w = new V().crossVectors(nrm, u), N = Math.round(80 * n);
      for (let i = 0; i < N; i++) { const a = i / N * TAU; add(u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)), R * 1.6, { k: 1.6, g: R * 0.25, life: 1.5, s: s0, tr: 0.07, c: i % 2 ? cb : ca }); }
      ball(Math.round(18 * n), 0.8, R * 0.3, 1, s0 * 0.8, 0.03, hsl(e.hue, 60, 85));
    } else if (e.kind === 'willow') { ball(Math.round(20 * n), 1.4, R * 0.3, 0.9, s0, 0.05, ca); ball(Math.round(110 * n), 2.2, R * 0.55, 3.1, s0 * 0.75, 0.3, gold, { glit: true, droop: true }); }
    else if (e.kind === 'palm') {
      const N = 8 + Math.floor(Math.random() * 3);
      for (let i = 0; i < N; i++) { const d = unit(); d.y = Math.abs(d.y) * 0.6 + 0.25; d.normalize(); add(d, R * 1.6, { k: 1.3, g: R * 0.7, life: 2, s: s0 * 1.6, tr: 0.32, c: i % 2 ? cb : ca, glit: true }); }
      ball(Math.round(30 * n), 1.2, R * 0.4, 1.4, s0 * 0.7, 0.1, gold);
    } else {   // crossette: stars that each split in four
      const N = 12 + Math.floor(Math.random() * 4);
      for (let i = 0; i < N; i++) add(unit(), R * 1.5, { k: 1.6, g: R * 0.3, life: 2, s: s0 * 1.2, tr: 0.12, c: i % 2 ? cb : ca, split: 0.55 + Math.random() * 0.15, R: R });
    }
    spark({ x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: 0.12, s: R * 0.22, tr: 0, c: hsl(e.hue, 50, 62), flare: true });   // the white-hot moment it bursts
    const l = lamps[lampI++ % lamps.length]; l.position.copy(o); l.color.copy(ca); l.userData.k = (e.finale ? 1.1 : 0.8) * (0.5 + 0.4 * e.size); l.intensity = l.userData.k * l.userData.k;
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
    clock += dt; placeCamera(); animate();
    if ((v.st === 'idle' || v.st === 'stopped') && !rockets.length) { idleT -= dt; if (idleT <= 0) { idleT = 2.6 + Math.random() * 1.6;   // a small shell now and then before the start and after the end
      launch({ x: 0.2 + Math.random() * 0.6, h: 0.45 + Math.random() * 0.3, size: 0.35, hue: Math.floor(Math.random() * 12) * 30, hue2: -1, kind: Math.random() < 0.5 ? 'peony' : 'ring' }); } }
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.t += dt; const p = Math.min(1, r.t / r.dur), q = 1 - (1 - p) * (1 - p);
      if (r.fz != null) {                                               // no note set it off: it fades as it falls
        r.fz += dt; r.vy += r.R * 0.4 * dt; r.p.y -= r.vy * dt; const a = 1 - r.fz / 1.5; if (a <= 0 || r.p.y < 0.5) { rockets.splice(i, 1); continue; }
        if (!RM && Math.random() < dt * 8) spark({ x: r.p.x, y: r.p.y, z: r.p.z, vx: rnd(-0.5, 0.5), vy: -1, vz: rnd(-0.5, 0.5), k: 2, g: r.R * 0.2, t: 0, life: 0.4, s: r.R * 0.02, tr: 0, c: hsl(30, 80, 40) });
        spark({ x: r.p.x, y: r.p.y, z: r.p.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: dt * 1.5, s: r.R * 0.04, tr: 0, c: hsl(36, 90, 70 * a) }); continue;
      }
      if (p < 1) { r.p.lerpVectors(r.from, r.to, q);
        if (!RM || Math.random() < 0.3) spark({ x: r.p.x + rnd(-0.3, 0.3), y: r.p.y - 0.5, z: r.p.z + rnd(-0.3, 0.3), vx: rnd(-1, 1), vy: rnd(-4, -1), vz: rnd(-1, 1), k: 2, g: -3, t: 0, life: rnd(0.35, 0.6), s: r.R * 0.025, tr: 0, c: hsl(34, 100, 62) }); }
      else if (r.wait) { r.p.copy(r.to); if (!RM) r.p.y += Math.sin(clock * 1.7 + r.id) * r.R * 0.03;   // waiting for a note: an ember that hovers and flickers
        if (!RM && Math.random() < dt * 14) spark({ x: r.p.x + rnd(-0.4, 0.4), y: r.p.y - 0.3, z: r.p.z, vx: rnd(-0.6, 0.6), vy: rnd(-3, -1), vz: rnd(-0.6, 0.6), k: 2, g: r.R * 0.15, t: 0, life: 0.7, s: r.R * 0.03, tr: 0.04, c: hsl(36, 100, 60), glit: true });
        const pulse = RM ? 0.8 : 0.65 + 0.35 * Math.sin(clock * 6 + r.id * 2);
        spark({ x: r.p.x, y: r.p.y, z: r.p.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: dt * 1.5, s: r.R * 0.3, tr: 0, c: hsl(34, 100, 58 * pulse) }); }   // its glow
      spark({ x: r.p.x, y: r.p.y, z: r.p.z, vx: 0, vy: 0, vz: 0, k: 0, g: 0, t: 0, life: dt * 1.5, s: r.R * (r.wait && p >= 1 ? 0.09 : 0.05), tr: 0, c: hsl(42, 100, 82) });   // the shell itself, for one frame
      if (p >= 1 && !r.wait) { rockets.splice(i, 1); burst(r); } }
    // move and fill the buffers
    let nh = 0, nl = 0; const kf = {};
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t += dt;
      if (p.split && p.t >= p.split) { sparks.splice(i, 1); split(p); continue; }
      if (p.t >= p.life) { sparks.splice(i, 1); continue; }
      const d = kf[p.k] || (kf[p.k] = Math.exp(-p.k * dt)); p.vx *= d; p.vz *= d; p.vy = p.vy * d - (p.hold && p.t < p.hold ? 0 : p.g) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const age = p.t / p.life; let a = p.flare ? 1 - age : age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
      if (p.glit && age > 0.55 && !RM) a *= Math.random() < 0.55 ? 1 : 0.12;   // glitter as they burn out
      const hot = age < 0.06 && !p.flare ? 1 + (1 - age / 0.06) * 0.6 : 1, fade = p.droop ? 1 - age * 0.45 : 1, m = a * hot * fade;
      if (p.y < 0.2) continue;   // gone into the water
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
  return { resize: resize, draw: draw, event: event, reset: reset, busy: busy };
}
