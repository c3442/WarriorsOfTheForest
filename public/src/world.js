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
    const lo = new THREE.Color('#46732e');
    const hi = new THREE.Color('#74a24a');
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
    const okSpot = (x, z, minGap) =>
      placed.every((p) => U.dist2(x, z, p.x, p.z) > minGap) &&
      U.dist2(x, z, 0, 0) > 9 &&                  // keep the camp clearing open
      world.heightAt(x, z) > C.WATER_LEVEL + 0.4; // stay out of the water

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
      const p = U.pointInDisc(C.WORLD_RADIUS);
      const m = makeRock();
      m.position.set(p.x, world.heightAt(p.x, p.z), p.z);
      scene.add(m);
      world.colliders.push({ x: p.x, z: p.z, r: m.geometry.parameters.radius * 0.8, ref: m });
    }
    // Bushes
    for (let i = 0; i < C.BUSH_COUNT; i++) {
      let p = U.pointInDisc(C.WORLD_RADIUS);
      let guard = 0;
      while (world.heightAt(p.x, p.z) <= C.WATER_LEVEL + 0.4 && guard++ < 8) p = U.pointInDisc(C.WORLD_RADIUS);
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
    const geo = new THREE.PlaneGeometry(size, size, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f74b8, transparent: true, opacity: 0.8, roughness: 0.22, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = C.WATER_LEVEL;
    mesh.name = 'water';
    scene.add(mesh);
    world.water = mesh;
    world._waterGeo = geo;
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
    const tentCols = [0xc09257, 0xa9763f, 0x8f9c5a, 0xb56b4a];
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
    }

    scene.add(camp);
    world.camp = camp;
  }

  // Resting near the campfire heals you.
  world.nearCamp = function (pos) {
    return U.dist2(pos.x, pos.z, world.campPos.x, world.campPos.z) < 4;
  };

  // --- Public API ------------------------------------------------------------

  world.init = function (scene) {
    buildTerrain(scene);
    buildSky(scene);
    buildWater(scene);
    scatter(scene);
    buildCamp(scene);
  };

  // dayT in [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
  world.update = function (dt, dayT, playerPos) {
    const ang = dayT * Math.PI * 2;            // sun travels a full circle
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.5, Math.sin(ang), Math.cos(ang) * 0.85).normalize();
    const elev = sunDir.y;                      // -1..1
    const day = U.clamp(elev / 0.3 + 0.15, 0, 1);
    world.daylight = day;
    world._isNight = elev < -0.02;

    const dusk = U.clamp(1 - Math.abs(elev) / 0.28, 0, 1) * (elev > -0.3 ? 1 : 0);
    const sky = U.mixColor(SKY_NIGHT, SKY_DAY, U.smooth(day)).lerp(new THREE.Color(SKY_DUSK), dusk * 0.55);

    if (world.scene) world.scene.background = sky;
    if (world.scene.fog) {
      world.scene.fog.color.copy(sky);
      world.scene.fog.density = U.lerp(0.02, 0.0055, day); // thicker, scarier nights
    }

    world.hemi.intensity = U.lerp(0.18, 0.95, day);
    world.hemi.color.copy(U.mixColor('#24406a', '#bfe0ff', day));
    world.hemi.groundColor.copy(U.mixColor(GROUND_NIGHT, GROUND_DAY, day));

    world.sun.intensity = U.lerp(0.12, 1.15, day);
    world.sun.color.copy(U.mixColor('#6f86c8', '#fff1d0', day)); // moonlight -> sunlight
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

    // ripple the water surface
    if (world.water) {
      world._time += dt;
      const t = world._time;
      const wp = world._waterGeo.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        const x = wp.getX(i), z = wp.getZ(i);
        wp.setY(i, Math.sin(x * 0.25 + t * 1.4) * 0.12 + Math.cos(z * 0.3 + t * 1.1) * 0.12);
      }
      wp.needsUpdate = true;
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
