/* The 3D world: terrain, foliage, sky, lighting and the day/night cycle. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;
  const C = W.CONFIG;

  const SKY_DAY = '#8ec5ef';
  const SKY_NIGHT = '#0a1230';
  const SKY_DUSK = '#e88a4e';
  const GROUND_DAY = '#5f8f3e';
  const GROUND_NIGHT = '#13243a';

  const world = {
    colliders: [],   // {x,z,r} solid objects (trees, rocks, tent walls)
    tentWalls: [],   // {x,z,r} tent-wall beads only (used for line-of-sight)
    hazards: [],     // {x,z,r,dps} barbed wire etc. that hurts enemies
    plots: [],       // farm plots that grow crops
    craftTables: [], // {x,z} workbenches you must stand near to craft
    tents: [],       // {group,x,z,quat,Wd,Dp,Hw,color,zipped,...} zip-up shelters
    trees: [],       // choppable groups
    bushes: [],      // {x,z,mesh,ready}
    daylight: 1,
    _isNight: false,
    _falling: [],
    isNight() { return this._isNight; },
  };

  // --- Terrain ---------------------------------------------------------------

  world.heightAt = function (x, z) {
    return (
      Math.sin(x * 0.045) * 1.6 +
      Math.cos(z * 0.05) * 1.5 +
      Math.sin((x + z) * 0.022) * 1.1 +
      Math.cos((x - z) * 0.013) * 1.4
    );
  };

  function buildTerrain(scene) {
    const size = C.WORLD_RADIUS * 2.6;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const lo = new THREE.Color('#33571f');
    const hi = new THREE.Color('#52803a');
    const sand = new THREE.Color('#c8b27a');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = world.heightAt(x, z);
      pos.setY(i, h);
      const t = U.clamp((h + 3) / 7, 0, 1);
      const col = lo.clone().lerp(hi, t);
      if (h < -2.2) col.lerp(sand, U.clamp((-2.2 - h) * 0.5, 0, 0.7)); // low = dirt/sand
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
    world.terrainMat = mat;
  }

  // --- Foliage ---------------------------------------------------------------

  const trunkMat = () => new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const foliagePalette = ['#2f6b35', '#36772f', '#27602f', '#3f8a40'];

  function makeTree() {
    const g = new THREE.Group();
    const scale = U.rand(0.8, 1.5);

    const trunkH = 2.2 * scale;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, trunkH, 6),
      trunkMat(),
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.userData.parent = g;
    g.add(trunk);

    const fColor = foliagePalette[U.randInt(0, foliagePalette.length - 1)];
    const fMat = new THREE.MeshStandardMaterial({ color: fColor, roughness: 1, flatShading: true });
    const tiers = U.randInt(2, 3);
    for (let i = 0; i < tiers; i++) {
      const r = (1.5 - i * 0.32) * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.7 * scale, 7), fMat);
      cone.position.y = trunkH + i * 1.0 * scale - 0.2;
      cone.castShadow = true;
      cone.userData.parent = g;
      g.add(cone);
    }
    g.userData = { type: 'tree', hp: 4, scale, alive: true };
    return g;
  }

  function makeRock() {
    const s = U.rand(0.5, 1.6);
    const geo = new THREE.IcosahedronGeometry(s, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d7f86, roughness: 1, flatShading: true });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.y = U.rand(0.6, 1.0);
    m.rotation.set(U.rand(0, 3), U.rand(0, 3), U.rand(0, 3));
    m.userData = { type: 'rock' };
    return m;
  }

  function makeBush() {
    const g = new THREE.Group();
    const s = U.rand(0.5, 0.8);
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 0),
      new THREE.MeshStandardMaterial({ color: 0x2e5a2a, roughness: 1, flatShading: true }),
    );
    body.scale.y = 0.7;
    body.castShadow = true;
    g.add(body);
    const berryMat = new THREE.MeshStandardMaterial({ color: 0xd23a4a, roughness: 0.6, emissive: 0x300000 });
    const berries = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), berryMat);
      b.position.set(U.rand(-s, s) * 0.8, U.rand(0, s) * 0.6, U.rand(-s, s) * 0.8);
      g.add(b);
      berries.push(b);
    }
    g.userData = { type: 'bush', berries };
    return g;
  }

  function scatter(scene) {
    const placed = [];
    const CAMP_CLEAR = 12;                        // no trees/bushes within this radius of camp
    const okSpot = (x, z, minGap) =>
      placed.every((p) => U.dist2(x, z, p.x, p.z) > minGap) &&
      U.dist2(x, z, 0, 0) > CAMP_CLEAR &&          // keep the camp clearing open
      world.heightAt(x, z) > C.WATER_LEVEL + 0.4;  // stay out of the water

    // Trees
    let tries = 0;
    while (world.trees.length < C.TREE_COUNT && tries < C.TREE_COUNT * 8) {
      tries++;
      const p = U.pointInDisc(C.WORLD_RADIUS);
      if (!okSpot(p.x, p.z, 3.2)) continue;
      const tree = makeTree();
      tree.position.set(p.x, world.heightAt(p.x, p.z) - 0.1, p.z);
      tree.rotation.y = U.rand(0, Math.PI * 2);
      scene.add(tree);
      world.trees.push(tree);
      world.colliders.push({ x: p.x, z: p.z, r: 0.5, ref: tree });
      placed.push(p);
    }
    // Rocks
    for (let i = 0; i < C.ROCK_COUNT; i++) {
      let p = U.pointInDisc(C.WORLD_RADIUS);
      let guard = 0;
      while (U.dist2(p.x, p.z, 0, 0) < CAMP_CLEAR && guard++ < 16) p = U.pointInDisc(C.WORLD_RADIUS);
      const m = makeRock();
      m.position.set(p.x, world.heightAt(p.x, p.z), p.z);
      scene.add(m);
      world.colliders.push({ x: p.x, z: p.z, r: m.geometry.parameters.radius * 0.8, ref: m });
    }
    // Bushes
    for (let i = 0; i < C.BUSH_COUNT; i++) {
      let p = U.pointInDisc(C.WORLD_RADIUS);
      let guard = 0;
      while ((world.heightAt(p.x, p.z) <= C.WATER_LEVEL + 0.4 || U.dist2(p.x, p.z, 0, 0) < CAMP_CLEAR) && guard++ < 16) {
        p = U.pointInDisc(C.WORLD_RADIUS);
      }
      const b = makeBush();
      b.position.set(p.x, world.heightAt(p.x, p.z) + 0.2, p.z);
      scene.add(b);
      world.bushes.push({ x: p.x, z: p.z, mesh: b, ready: true });
    }
  }

  // --- Sky, lights, stars ----------------------------------------------------

  function buildSky(scene) {
    world.hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a6b35, 0.9);
    scene.add(world.hemi);

    world.sun = new THREE.DirectionalLight(0xfff1d0, 1.1);
    world.sun.castShadow = true;
    world.sun.shadow.mapSize.set(2048, 2048);
    const d = 70;
    Object.assign(world.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 260 });
    world.sun.shadow.bias = -0.0005;
    scene.add(world.sun);
    scene.add(world.sun.target);

    // Sun disc
    world.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }),
    );
    scene.add(world.sunDisc);

    // Moon (rides opposite the sun, so it's up at night)
    world.moon = new THREE.Group();
    const MOON_R = 15;
    const moonBody = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_R, 28, 28),
      new THREE.MeshBasicMaterial({ color: 0xeaf0ff, fog: false }),
    );
    world.moon.add(moonBody);
    // craters on the +Z hemisphere (which we aim at the player each frame)
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xb9c4dc, fog: false });
    [[5, 3], [-6, 4.5], [1, -7.5], [7.5, -2], [-4.5, -4], [3.5, 6.5]].forEach(([cx, cy]) => {
      const cz = Math.sqrt(Math.max(MOON_R * MOON_R - cx * cx - cy * cy, 1));
      const crater = new THREE.Mesh(new THREE.SphereGeometry(U.rand(1.4, 2.8), 10, 10), craterMat);
      crater.position.set(cx, cy, cz);
      world.moon.add(crater);
    });
    // soft halo
    world.moon.add(new THREE.Mesh(
      new THREE.SphereGeometry(MOON_R + 5, 18, 18),
      new THREE.MeshBasicMaterial({ color: 0x9fb4e8, transparent: true, opacity: 0.16, fog: false, side: THREE.BackSide }),
    ));
    scene.add(world.moon);

    // Stars
    const sg = new THREE.BufferGeometry();
    const sv = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(
        600, Math.acos(U.rand(-0.2, 1)), U.rand(0, Math.PI * 2),
      );
      sv.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    world.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }),
    );
    scene.add(world.stars);

    scene.fog = new THREE.FogExp2(SKY_DAY, 0.006);
    world.scene = scene;
  }

  // --- Water -----------------------------------------------------------------

  function buildWater(scene) {
    const size = C.WORLD_RADIUS * 2.6;
    const geo = new THREE.PlaneGeometry(size, size, 120, 120);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: false,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color('#13405e') },
        uShallow: { value: new THREE.Color('#3a8fc0') },
        uSky: { value: new THREE.Color('#bfe0ff') },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: `
        uniform float uTime; varying vec3 vWorld; varying vec3 vN;
        void main(){
          vec3 p = position;
          float w = sin(p.x*0.25 + uTime*1.2)*0.13 + cos(p.z*0.32 + uTime*0.9)*0.13 + sin((p.x+p.z)*0.18 + uTime*0.6)*0.07;
          p.y += w;
          float dx = cos(p.x*0.25 + uTime*1.2)*0.25*0.13 + cos((p.x+p.z)*0.18 + uTime*0.6)*0.18*0.07;
          float dz = -sin(p.z*0.32 + uTime*0.9)*0.32*0.13 + cos((p.x+p.z)*0.18 + uTime*0.6)*0.18*0.07;
          vN = normalize(vec3(-dx, 1.0, -dz));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun;
        varying vec3 vWorld; varying vec3 vN;
        void main(){
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(viewDir, vN), 0.0), 3.0);
          vec3 base = mix(uDeep, uShallow, 0.45);
          vec3 col = mix(base, uSky, clamp(fres, 0.0, 1.0) * 0.65);
          vec3 h = normalize(viewDir + uSun);
          float spec = pow(max(dot(vN, h), 0.0), 90.0);
          col += vec3(1.0, 0.96, 0.82) * spec * 0.7;
          gl_FragColor = vec4(col, 0.88);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = C.WATER_LEVEL;
    mesh.name = 'water';
    scene.add(mesh);
    world.water = mesh;
    world._waterMat = mat;
    world._time = 0;
  }

  // True where the player is standing in/at the water's edge.
  world.isWater = function (x, z) {
    return world.heightAt(x, z) < C.WATER_LEVEL + 0.4;
  };

  // --- Camp (player's starting base) -----------------------------------------

  world.campPos = { x: 0, z: 0 };

  function buildCamp(scene) {
    const camp = new THREE.Group();
    const cx = world.campPos.x, cz = world.campPos.z;

    // --- campfire ---
    const fire = new THREE.Group();
    fire.position.set(cx, world.heightAt(cx, cz), cz);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7d7f86, roughness: 1, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(U.rand(0.16, 0.26), 0), stoneMat);
      s.position.set(Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72);
      s.castShadow = true; fire.add(s);
    }

    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 6), logMat);
      log.position.set(Math.cos(a) * 0.24, 0.42, Math.sin(a) * 0.24);
      log.rotation.x = Math.sin(a) * 0.5;
      log.rotation.z = -Math.cos(a) * 0.5;
      log.castShadow = true; fire.add(log);
    }

    const flames = [];
    [0xff6a18, 0xffab3a, 0xffe07a].forEach((col, i) => {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(0.24 - i * 0.06, 0.75 - i * 0.14, 7),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92, fog: false }),
      );
      f.position.y = 0.34 + i * 0.04;
      fire.add(f); flames.push(f);
    });

    const light = new THREE.PointLight(0xff7a33, 2.2, 24, 1.6);
    light.position.set(0, 0.9, 0);
    fire.add(light);
    camp.add(fire);
    world.campfire = { flames, light, base: 2.2, t: 0 };
    world.colliders.push({ x: cx, z: cz, r: 0.85 });

    // --- 4 roomy wall-tents (vertical walls + peaked roof), ringing the fire ---
    // Vertical walls keep your head well clear of the canvas, so no see-through.
    const tentCols = [0xe5352b, 0x25cdd6, 0xf266b0, 0x4e9c3a]; // fire red, aqua blue, pink, green
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x42301f, roughness: 1 });
    const R = 5.0, Wd = 3.6, Dp = 4.0, Hw = 2.4, Rh = 1.3;   // ring, width, depth, wall height, roof rise
    const wallT = 0.1;
    const thetaR = Math.atan2(Wd / 2, Rh);
    const Lr = Math.hypot(Rh, Wd / 2);
    const sideWallGeo = new THREE.BoxGeometry(wallT, Hw, Dp);
    const backWallGeo = new THREE.BoxGeometry(Wd, Hw, wallT);
    const roofGeo = new THREE.BoxGeometry(wallT, Lr, Dp);
    const gable = new THREE.Shape();
    gable.moveTo(-Wd / 2, 0); gable.lineTo(Wd / 2, 0); gable.lineTo(0, Rh); gable.lineTo(-Wd / 2, 0);
    const gableGeo = new THREE.ShapeGeometry(gable);

    function makeBed(blanketColor) {
      const bed = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 1.95),
        new THREE.MeshStandardMaterial({ color: 0x5e3f23, roughness: 1 }));
      frame.position.y = 0.13; frame.castShadow = true; bed.add(frame);
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.16, 1.86),
        new THREE.MeshStandardMaterial({ color: 0xdcd2bd, roughness: 1, flatShading: true }));
      mattress.position.y = 0.3; mattress.castShadow = true; bed.add(mattress);
      const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 1.05),
        new THREE.MeshStandardMaterial({ color: blanketColor, roughness: 1, flatShading: true }));
      blanket.position.set(0, 0.39, 0.36); bed.add(blanket);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.34),
        new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 1, flatShading: true }));
      pillow.position.set(0, 0.37, -0.7); bed.add(pillow);
      return bed;
    }

    // --- Plush stuffies (one kind per tent) ---
    const EYE = () => new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.5 });

    function makeBear(color) {
      const g = new THREE.Group();
      const fur = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), fur);
      body.scale.set(1, 1.1, 0.9); body.position.y = 0.12; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), fur);
      head.position.set(0, 0.29, 0.02); head.castShadow = true; g.add(head);
      for (const sx of [-0.06, 0.06]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), fur); ear.position.set(sx, 0.35, 0); g.add(ear); }
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshStandardMaterial({ color: 0xf0e2cc, roughness: 1 }));
      muzzle.position.set(0, 0.27, 0.085); g.add(muzzle);
      for (const sx of [-0.035, 0.035]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 6), EYE()); e.position.set(sx, 0.31, 0.088); g.add(e); }
      for (const sx of [-0.12, 0.12]) { const arm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), fur); arm.scale.set(1, 1.4, 1); arm.position.set(sx, 0.15, 0.04); g.add(arm); }
      for (const sx of [-0.06, 0.06]) { const leg = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), fur); leg.position.set(sx, 0.04, 0.07); g.add(leg); }
      return g;
    }

    function makeBunny(color) {
      const g = new THREE.Group();
      const fur = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), fur);
      body.scale.set(1, 1.2, 0.9); body.position.y = 0.12; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), fur);
      head.position.set(0, 0.28, 0.02); head.castShadow = true; g.add(head);
      for (const sx of [-0.04, 0.04]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), fur); ear.scale.set(1, 3.2, 0.7); ear.position.set(sx, 0.43, 0); ear.rotation.z = sx * 3; ear.castShadow = true; g.add(ear); }
      for (const sx of [-0.035, 0.035]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 6), EYE()); e.position.set(sx, 0.3, 0.078); g.add(e); }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), new THREE.MeshStandardMaterial({ color: 0xf07a90, roughness: 0.6 }));
      nose.position.set(0, 0.27, 0.085); g.add(nose);
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
      tail.position.set(0, 0.1, -0.1); g.add(tail);
      for (const sx of [-0.06, 0.06]) { const foot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), fur); foot.scale.set(1, 0.7, 1.5); foot.position.set(sx, 0.03, 0.08); g.add(foot); }
      return g;
    }

    function makeCat() { // Hello Kitty: white cat, red bow, yellow nose, whiskers, no mouth
      const g = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: 0xfdfdfd, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), white);
      body.scale.set(1, 1.1, 0.9); body.position.y = 0.11; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 9), white);
      head.scale.set(1.2, 1, 0.9); head.position.set(0, 0.3, 0.02); head.castShadow = true; g.add(head);
      for (const sx of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 4), white); ear.position.set(sx, 0.4, 0); ear.rotation.z = sx * 2; ear.castShadow = true; g.add(ear); }
      const bowMat = new THREE.MeshStandardMaterial({ color: 0xe23a4a, roughness: 0.7 });
      const bowC = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), bowMat); bowC.position.set(0.12, 0.41, 0.04); g.add(bowC);
      for (const dx of [-0.032, 0.032]) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), bowMat); lobe.scale.set(1, 1.3, 0.6); lobe.position.set(0.12 + dx, 0.41, 0.04); g.add(lobe); }
      for (const sx of [-0.05, 0.05]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), EYE()); e.scale.set(0.7, 1.2, 0.5); e.position.set(sx, 0.31, 0.1); g.add(e); }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshStandardMaterial({ color: 0xf2c84a, roughness: 0.5 }));
      nose.scale.set(1.4, 0.8, 0.6); nose.position.set(0, 0.28, 0.105); g.add(nose);
      const wMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a });
      for (const side of [-1, 1]) for (const wy of [0.275, 0.305]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 4), wMat); wh.rotation.z = Math.PI / 2; wh.position.set(side * 0.14, wy, 0.07); g.add(wh); }
      return g;
    }

    function makeDog(color) {
      const g = new THREE.Group();
      const fur = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      const earMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), fur);
      body.scale.set(1, 1, 1.2); body.position.y = 0.12; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), fur);
      head.position.set(0, 0.28, 0.05); head.castShadow = true; g.add(head);
      for (const sx of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), earMat); ear.scale.set(0.6, 1.7, 0.5); ear.position.set(sx, 0.26, 0.02); ear.castShadow = true; g.add(ear); }
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 7), fur); snout.scale.set(0.9, 0.8, 1); snout.position.set(0, 0.25, 0.14); g.add(snout);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), new THREE.MeshStandardMaterial({ color: 0x1a1410 })); nose.position.set(0, 0.26, 0.19); g.add(nose);
      for (const sx of [-0.04, 0.04]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), EYE()); e.position.set(sx, 0.31, 0.11); g.add(e); }
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), fur); tail.scale.set(1, 1, 2); tail.position.set(0, 0.16, -0.13); tail.rotation.x = -0.6; g.add(tail);
      for (const sx of [-0.07, 0.07]) for (const sz of [-0.05, 0.08]) { const leg = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), fur); leg.position.set(sx, 0.03, sz); g.add(leg); }
      return g;
    }

    // tent index -> stuffie: 0 red=blue bunny, 1 aqua=bear, 2 pink=Hello Kitty, 3 white=dog
    function makeStuffieFor(i) {
      if (i === 0) return makeBunny(0x5f8fe0);
      if (i === 1) return makeBear(0xc9874a);
      if (i === 2) return makeCat();
      return makeDog(0xc59a64);
    }

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = cx + Math.cos(a) * R, tz = cz + Math.sin(a) * R;
      const gy = world.heightAt(tx, tz);
      const tent = new THREE.Group();
      tent.position.set(tx, gy, tz);
      const mat = new THREE.MeshStandardMaterial({
        color: tentCols[i], roughness: 1, flatShading: true, side: THREE.DoubleSide,
      });

      // vertical walls (front, local +Z toward fire, is the open entrance)
      const lw = new THREE.Mesh(sideWallGeo, mat); lw.position.set(-Wd / 2, Hw / 2, 0); lw.castShadow = true;
      const rw = new THREE.Mesh(sideWallGeo, mat); rw.position.set(Wd / 2, Hw / 2, 0); rw.castShadow = true;
      const bw = new THREE.Mesh(backWallGeo, mat); bw.position.set(0, Hw / 2, -Dp / 2); bw.castShadow = true;
      tent.add(lw, rw, bw);

      // peaked roof: two slanted panels from the eaves up to the ridge
      const lr = new THREE.Mesh(roofGeo, mat); lr.position.set(-Wd / 4, Hw + Rh / 2, 0); lr.rotation.z = -thetaR; lr.castShadow = true;
      const rr = new THREE.Mesh(roofGeo, mat); rr.position.set(Wd / 4, Hw + Rh / 2, 0); rr.rotation.z = thetaR; rr.castShadow = true;
      tent.add(lr, rr);

      // gable triangles close the roof ends (above head height)
      const gB = new THREE.Mesh(gableGeo, mat); gB.position.set(0, Hw, -Dp / 2); tent.add(gB);
      const gF = new THREE.Mesh(gableGeo, mat); gF.position.set(0, Hw, Dp / 2); tent.add(gF);

      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, Dp, 6), ridgeMat);
      ridge.rotation.x = Math.PI / 2; ridge.position.set(0, Hw + Rh, 0); tent.add(ridge);

      const bed = makeBed(tentCols[i]);              // blanket matches the tent colour
      bed.position.set(-0.55, 0, -0.5);              // inside, toward the back; entrance stays clear
      const stuffie = makeStuffieFor(i);
      stuffie.position.set(0, 0.38, -0.2);           // themed one, near the pillow
      bed.add(stuffie);
      // a couple more little plushies scattered on the bed
      const extras = [
        () => makeBear(0x8a5a3a), () => makeBear(0xd8c084), () => makeBunny(0xe6a6c8),
        () => makeBunny(0x9ad0a0), () => makeDog(0x9a9a9a), () => makeCat(),
      ];
      for (let k = 0; k < 2; k++) {
        const ex = extras[U.randInt(0, extras.length - 1)]();
        ex.scale.setScalar(0.7);
        ex.position.set(-0.28 + k * 0.56, 0.4, 0.18 - k * 0.06);
        ex.rotation.y = U.rand(-0.6, 0.6);
        bed.add(ex);
      }
      tent.add(bed);

      tent.lookAt(cx, gy, cz); // open front faces the fire
      camp.add(tent);

      // Solid walls: collider beads along the two sides + closed back; front open.
      const addBead = (lx, lz) => {
        const p = new THREE.Vector3(lx, 0, lz).applyQuaternion(tent.quaternion).add(tent.position);
        const bead = { x: p.x, z: p.z, r: 0.3 };
        world.colliders.push(bead);
        world.tentWalls.push(bead);
      };
      for (let s = -Dp / 2; s <= Dp / 2 + 0.01; s += 0.42) { addBead(-Wd / 2, s); addBead(Wd / 2, s); }
      for (let s = -Wd / 2 + 0.42; s <= Wd / 2 - 0.42 + 0.01; s += 0.42) addBead(s, -Dp / 2);

      // remember this tent so the player can zip it shut later
      world.tents.push({
        group: tent, x: tx, z: tz, quat: tent.quaternion.clone(),
        Wd, Dp, Hw, color: tentCols[i], zipped: false, flap: null, seam: null, beads: [],
      });
    }

    scene.add(camp);
    world.camp = camp;
    world.placeCraftTable(cx + 1.7, cz + 1.4, -2.3);   // workbench right by the campfire
  }

  // Resting near the campfire heals you.
  world.nearCamp = function (pos) {
    return U.dist2(pos.x, pos.z, world.campPos.x, world.campPos.z) < 4;
  };

  // --- Tents: zip up the entrance so nothing can get in -----------------------

  const _tv = new THREE.Vector3(), _tq = new THREE.Quaternion();

  // Which tent (if any) the player is standing inside.
  world.insideTent = function (pos) {
    for (const t of world.tents) {
      _tv.set(pos.x - t.x, 0, pos.z - t.z).applyQuaternion(_tq.copy(t.quat).invert());
      if (Math.abs(_tv.x) < t.Wd / 2 + 0.25 && Math.abs(_tv.z) < t.Dp / 2 + 0.25) return t;
    }
    return null;
  };

  // Seal (or re-open) a tent's open front. Synced across the network by index.
  world.applyTentZip = function (idx, zipped) {
    const t = world.tents[idx];
    if (!t || t.zipped === zipped) return;
    t.zipped = zipped;
    if (zipped) {
      const mat = new THREE.MeshStandardMaterial({ color: t.color, roughness: 1, flatShading: true, side: THREE.DoubleSide });
      const flap = new THREE.Mesh(new THREE.BoxGeometry(t.Wd, t.Hw, 0.1), mat);
      flap.position.set(0, t.Hw / 2, t.Dp / 2); flap.castShadow = true;
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, t.Hw, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.3 }));
      seam.position.set(0, t.Hw / 2, t.Dp / 2 + 0.02);
      t.group.add(flap); t.group.add(seam); t.flap = flap; t.seam = seam;
      // collider beads across the entrance: stop movement, bites and line of sight
      for (let lx = -t.Wd / 2; lx <= t.Wd / 2 + 0.01; lx += 0.42) {
        const p = new THREE.Vector3(lx, 0, t.Dp / 2).applyQuaternion(t.quat).add(new THREE.Vector3(t.x, 0, t.z));
        const bead = { x: p.x, z: p.z, r: 0.3 };
        world.colliders.push(bead); world.tentWalls.push(bead); t.beads.push(bead);
      }
    } else {
      if (t.flap) { t.group.remove(t.flap); t.flap = null; }
      if (t.seam) { t.group.remove(t.seam); t.seam = null; }
      for (const b of t.beads) {
        let i = world.colliders.indexOf(b); if (i >= 0) world.colliders.splice(i, 1);
        i = world.tentWalls.indexOf(b); if (i >= 0) world.tentWalls.splice(i, 1);
      }
      t.beads = [];
    }
  };

  // Toggle the tent the player is standing in. Returns {idx, zipped} or null.
  world.toggleTentZip = function (pos) {
    const t = world.insideTent(pos);
    if (!t) return null;
    const idx = world.tents.indexOf(t);
    world.applyTentZip(idx, !t.zipped);
    return { idx, zipped: t.zipped };
  };

  // --- Richer visuals --------------------------------------------------------

  function buildSkyDome(scene) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2e6fb0') },
        bottom: { value: new THREE.Color('#bfe0ff') },
        exponent: { value: 0.7 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float exponent; varying vec3 vP; void main(){ float h = max(normalize(vP).y, 0.0); gl_FragColor = vec4(mix(bottom, top, pow(h, exponent)), 1.0); }',
    });
    world.skyDome = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), mat);
    world.skyDome.renderOrder = -1;
    scene.add(world.skyDome);
  }

  function buildMountains(scene) {
    const rock = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 1, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xeef3fb, roughness: 1, flatShading: true });
    const grp = new THREE.Group();
    const count = 20;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + U.rand(-0.12, 0.12);
      const r = U.rand(150, 195);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const baseY = world.heightAt(x, z) - 5;
      const radius = U.rand(30, 58), height = U.rand(48, 90);
      const m = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5, 1), rock);
      m.position.set(x, baseY + height / 2, z); m.rotation.y = U.rand(0, 6.28); grp.add(m);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.46, height * 0.42, 5, 1), snow);
      cap.position.set(x, baseY + height * 0.8, z); cap.rotation.y = m.rotation.y; grp.add(cap);
    }
    scene.add(grp);
    world.mountains = grp;
  }

  function buildGrass(scene) {
    const blade = new THREE.PlaneGeometry(0.04, 0.17, 1, 1);
    blade.translate(0, 0.085, 0);
    const base = new THREE.Color('#2c5520'), tip = new THREE.Color('#5fa03a'), cols = [];
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) { const t = U.clamp(pos.getY(i) / 0.17, 0, 1); const c = base.clone().lerp(tip, t); cols.push(c.r, c.g, c.b); }
    blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    const N = 90000;                                 // small but very dense grass
    const inst = new THREE.InstancedMesh(blade, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < N; i++) {
      const pt = U.pointInDisc(40);
      const h = world.heightAt(pt.x, pt.z);
      if (h <= C.WATER_LEVEL + 0.5) continue;
      e.set(U.rand(-0.08, 0.08), U.rand(0, Math.PI * 2), U.rand(-0.08, 0.08)); q.setFromEuler(e);
      const sc = U.rand(0.7, 1.2); s.set(sc, sc * U.rand(0.9, 1.4), sc); p.set(pt.x, h, pt.z);
      m.compose(p, q, s); inst.setMatrixAt(n, m);
      col.setHSL(0.28, 0.25, 0.82 + U.rand(-0.16, 0.12)); inst.setColorAt(n, col);
      n++;
    }
    inst.count = n; inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    world.grass = inst;
  }

  function buildFlowers(scene) {
    const geo = new THREE.IcosahedronGeometry(0.08, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true });
    const palette = ['#e8702a', '#f2c33a', '#f25a7a', '#f6f1e7', '#c25ad8'];
    const N = 1000;
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < N; i++) {
      const pt = U.pointInDisc(62);
      const h = world.heightAt(pt.x, pt.z);
      if (h <= C.WATER_LEVEL + 0.5) continue;
      const sc = U.rand(0.7, 1.4); s.set(sc, sc, sc); p.set(pt.x, h + 0.18, pt.z);
      m.compose(p, q, s); inst.setMatrixAt(n, m);
      col.set(palette[U.randInt(0, palette.length - 1)]); inst.setColorAt(n, col);
      n++;
    }
    inst.count = n; inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    world.flowers = inst;
  }

  // --- Public API ------------------------------------------------------------

  world.init = function (scene) {
    buildTerrain(scene);
    buildSky(scene);
    buildSkyDome(scene);
    buildMountains(scene);
    buildWater(scene);
    scatter(scene);
    buildCamp(scene);
  };

  // dayT in [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
  world.update = function (dt, dayT, playerPos) {
    const ang = dayT * Math.PI * 2;            // sun travels a full circle
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.5, Math.sin(ang), Math.cos(ang) * 0.85).normalize();
    const elev = sunDir.y;                      // -1..1
    // Night is the bottom slice of the cycle: with a 420s cycle this gives ~2 min
    // of night and ~5 min of day, with dusk/dawn at the boundary.
    const NIGHT = -0.63;
    const day = U.clamp((elev - NIGHT) / 0.45, 0, 1);
    world.daylight = day;
    world._isNight = elev < NIGHT;

    const dusk = U.clamp(1 - Math.abs(elev - NIGHT) / 0.3, 0, 1);
    const sky = U.mixColor(SKY_NIGHT, SKY_DAY, U.smooth(day)).lerp(new THREE.Color(SKY_DUSK), dusk * 0.55);

    if (world.scene) world.scene.background = sky;
    if (world.scene.fog) {
      world.scene.fog.color.copy(sky);
      world.scene.fog.density = U.lerp(0.011, 0.0048, day); // a bit clearer at night
    }
    // gradient sky dome: horizon = sky colour, zenith = a deeper blue
    if (world.skyDome) {
      world.skyDome.position.copy(playerPos);
      const u = world.skyDome.material.uniforms;
      u.bottom.value.copy(sky);
      u.top.value.copy(sky).lerp(new THREE.Color('#1c4f8c'), 0.6 * day);
    }

    world.hemi.intensity = U.lerp(0.42, 0.55, day);   // brighter moonlit nights
    world.hemi.color.copy(U.mixColor('#24406a', '#cfe6ff', day));
    world.hemi.groundColor.copy(U.mixColor(GROUND_NIGHT, GROUND_DAY, day));

    world.sun.intensity = U.lerp(0.32, 1.1, day);   // stronger moonlight
    world.sun.color.copy(U.mixColor('#8ea2d8', '#fff0cf', day)); // moonlight -> warm sunlight
    world.sun.position.copy(playerPos).addScaledVector(sunDir, 90);
    world.sun.target.position.copy(playerPos);
    world.sun.target.updateMatrixWorld();

    world.sunDisc.position.copy(playerPos).addScaledVector(sunDir, 380);
    world.sunDisc.visible = elev > -0.05;

    // Moon: opposite the sun, so it rises as the sun sets.
    const moonDir = sunDir.clone().multiplyScalar(-1);
    world.moon.position.copy(playerPos).addScaledVector(moonDir, 360);
    world.moon.lookAt(playerPos);
    world.moon.visible = moonDir.y > -0.08;

    world.stars.position.copy(playerPos);
    world.stars.material.opacity = U.clamp(1 - day * 1.6, 0, 1);

    // flicker the campfire
    if (world.campfire) {
      const cf = world.campfire;
      cf.t += dt;
      const fl = 1 + Math.sin(cf.t * 12) * 0.12 + Math.sin(cf.t * 7.3) * 0.08;
      cf.light.intensity = cf.base * fl * (world._isNight ? 1.4 : 0.7);
      cf.flames.forEach((f, i) => {
        f.scale.y = fl + Math.sin(cf.t * (9 + i * 3)) * 0.18;
        f.scale.x = 1 + Math.sin(cf.t * (8 + i * 2)) * 0.1;
        f.rotation.y = cf.t * 2;
      });
    }

    // grow farm-plot crops (full + ripe after ~60s)
    for (const p of world.plots) {
      if (!p.ripe) {
        p.t += dt;
        p.crop.scale.setScalar(0.05 + Math.min(p.t / 60, 1) * 0.95);
        if (p.t >= 60) p.ripe = true;
      }
    }

    // animate the water shader (waves + sun glint + sky reflection)
    if (world._waterMat) {
      world._time += dt;
      const u = world._waterMat.uniforms;
      u.uTime.value = world._time;
      u.uSky.value.copy(sky);
      u.uSun.value.copy(sunDir);
    }

    // advance tree-fall animations
    for (let i = world._falling.length - 1; i >= 0; i--) {
      const f = world._falling[i];
      f.t += dt;
      const k = U.clamp(f.t / 0.9, 0, 1);
      f.group.rotation.z = f.dir * k * 1.5;
      f.group.position.y = f.baseY - k * 0.4;
      if (k >= 1) {
        f.group.visible = false;
        world.scene.remove(f.group);
        world._falling.splice(i, 1);
      }
    }
  };

  // Damage a tree; returns wood gained when it falls (0 otherwise).
  world.chopTree = function (tree) {
    if (!tree.userData.alive) return 0;
    tree.userData.hp -= 1;
    // little shake
    tree.position.x += U.rand(-0.04, 0.04);
    if (tree.userData.hp <= 0) {
      tree.userData.alive = false;
      const idx = world.colliders.findIndex((c) => c.ref === tree);
      if (idx >= 0) world.colliders.splice(idx, 1);
      world._falling.push({ group: tree, t: 0, dir: U.chance(0.5) ? 1 : -1, baseY: tree.position.y });
      return U.randInt(2, 4);
    }
    return 0;
  };

  // True if a tent wall lies on the segment A->B (blocks a bite / line of sight).
  world.wallBetween = function (ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-6;
    for (const w of world.tentWalls) {
      let t = ((w.x - ax) * dx + (w.z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, pz = az + dz * t;
      if (Math.hypot(w.x - px, w.z - pz) < w.r) return true;
    }
    return false;
  };

  // Place a crafted wooden barricade (a solid wall that blocks wolves).
  world.placeBarricade = function (x, z, yaw) {
    const Wd = 1.9, H = 1.5, T = 0.18;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(Wd, H, T), mat);
    wall.position.y = H / 2; wall.castShadow = true; grp.add(wall);
    for (const sx of [-Wd / 2, Wd / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, H + 0.25, 6), mat);
      post.position.set(sx, (H + 0.25) / 2, 0); post.castShadow = true; grp.add(post);
    }
    grp.position.set(x, world.heightAt(x, z), z);
    grp.rotation.y = yaw;
    world.scene.add(grp);

    // collider beads along the wall's width (so it stops movement + bites + your axe)
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let t = -Wd / 2; t <= Wd / 2 + 0.01; t += 0.38) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.3 };
      world.colliders.push(bead);
      world.tentWalls.push(bead);
    }
    return grp;
  };

  // Barbed wire: blocks movement and hurts enemies that touch it.
  world.placeBarbedWire = function (x, z, yaw) {
    const Wd = 1.8;
    const grp = new THREE.Group();
    const post = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    const wire = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.4 });
    for (const t of [-Wd / 2, 0, Wd / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), post); p.position.set(t, 0.35, 0); p.castShadow = true; grp.add(p); }
    for (const hy of [0.28, 0.55]) { const w = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.03, 0.03), wire); w.position.set(0, hy, 0); grp.add(w); }
    for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), wire); b.position.set(i * 0.28, 0.42, 0); b.rotation.z = Math.PI / 4; grp.add(b); }
    grp.position.set(x, world.heightAt(x, z), z); grp.rotation.y = yaw;
    world.scene.add(grp);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let t = -Wd / 2; t <= Wd / 2 + 0.01; t += 0.4) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.28 };
      world.colliders.push(bead); world.tentWalls.push(bead);
    }
    world.hazards.push({ x, z, r: 1.3, dps: 6 });
  };

  // Stacked logs: a chunky obstacle that blocks movement.
  world.placeLogs = function (x, z, yaw) {
    const L = 1.7;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    let y = 0.18;
    for (const row of [[-0.2, 0.2], [0]]) {
      for (const off of row) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, L, 8), mat); log.rotation.z = Math.PI / 2; log.position.set(off, y, 0); log.castShadow = true; grp.add(log); }
      y += 0.34;
    }
    grp.position.set(x, world.heightAt(x, z), z); grp.rotation.y = yaw;
    world.scene.add(grp);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let t = -L / 2; t <= L / 2 + 0.01; t += 0.4) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.32 };
      world.colliders.push(bead); world.tentWalls.push(bead);
    }
  };

  // Farm plot: grows a crop over ~1 minute; harvest with E for food.
  world.placeFarmPlot = function (x, z) {
    const grp = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.4), new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 1 }));
    soil.position.y = 0.06; soil.receiveShadow = true; grp.add(soil);
    const furrow = new THREE.MeshStandardMaterial({ color: 0x432d1c, roughness: 1 });
    for (const fx of [-0.35, 0, 0.35]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 1.3), furrow); f.position.set(fx, 0.08, 0); grp.add(f); }
    const crop = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x3a7a35, roughness: 1 })); stem.position.y = 0.15; crop.add(stem);
    const veg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xe07a2a, roughness: 1, flatShading: true })); veg.position.y = 0.34; crop.add(veg);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 1 })); leaf.position.y = 0.52; crop.add(leaf);
    crop.position.y = 0.12; crop.scale.setScalar(0.05); grp.add(crop);
    grp.position.set(x, world.heightAt(x, z), z);
    world.scene.add(grp);
    world.plots.push({ group: grp, crop, x, z, t: 0, ripe: false });
  };

  // A crafting table / workbench.
  world.placeCraftTable = function (x, z, yaw) {
    const grp = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), wood);
    top.position.y = 0.85; top.castShadow = true; grp.add(top);
    for (const [lx, lz] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), dark);
      leg.position.set(lx, 0.42, lz); grp.add(leg);
    }
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.5, metalness: 0.3 }));
    anvil.position.set(-0.4, 1.0, 0); anvil.castShadow = true; grp.add(anvil);
    const saw = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.4, metalness: 0.4 }));
    saw.position.set(0.35, 0.93, -0.2); saw.rotation.y = -0.4; grp.add(saw);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.16), dark);
    plank.position.set(0.32, 0.95, 0.12); plank.rotation.y = 0.3; grp.add(plank);
    grp.position.set(x, world.heightAt(x, z), z); grp.rotation.y = yaw;
    world.scene.add(grp);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const lx of [-0.5, 0.5]) world.colliders.push({ x: x + cos * lx, z: z - sin * lx, r: 0.5 });
    world.craftTables.push({ x, z });
    return grp;
  };

  // Crafting only works near a workbench.
  world.nearCraftTable = function (pos, range) {
    return world.craftTables.some((t) => U.dist2(pos.x, pos.z, t.x, t.z) < (range || 3.5));
  };

  world.treeIndex = function (tree) { return world.trees.indexOf(tree); };

  // Fell a tree by index (used to mirror another player's chop over the network).
  world.felByIndex = function (idx) {
    const t = world.trees[idx];
    if (!t || !t.userData.alive) return;
    t.userData.hp = 1;
    world.chopTree(t);
  };

  // Resolve player/enemy against solid colliders. Mutates pos {x,z}.
  world.resolveCollision = function (pos, radius) {
    for (const c of world.colliders) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = radius + c.r;
      if (d < min && d > 0.0001) {
        const push = (min - d);
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
  };

  W.world = world;
})();
