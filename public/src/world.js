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
    campfires: [],   // {x,z} safe-haven fires (camp + crafted ones)
    seats: [],       // {x,y,z,yaw} chairs you can sit on
    pickups: [],     // {x,z,mesh,kind} items dropped in the world (e.g. shotgun)
    outposts: [],    // {x,z,found} bandit outposts (guarded camps; found once discovered)
    discovered: { village: false, bandit: false },  // minimap fog-of-war
    stuffies: [],    // {mesh,tentIdx,alive} plushies enemies can smash
    stuffiesBroken: false, _stuffieBreakDay: -1, _dayCount: 0,
    trees: [],       // choppable groups
    bushes: [],      // {x,z,mesh,ready}
    daylight: 1,
    _isNight: false,
    _falling: [],
    _treeRegrow: [], // {idx,x,z,t} felled trees waiting to grow back
    _extraFires: [], // crafted campfires to flicker
    _growing: [],    // {group,x,z,t,grow} planted saplings growing into trees
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

  // Desert biome: fades in toward the east (+X) far side. 0 = grassland, 1 = full desert.
  world.desertAt = function (x, z) {
    return U.clamp((x - 330) / 450, 0, 1);     // the far east third is desert
  };
  // Snowy tundra: fades in toward the far north (-Z), but not into the desert.
  world.snowAt = function (x, z) {
    return U.clamp((-z - 330) / 450, 0, 1) * (1 - world.desertAt(x, z));
  };
  // Murky swamp: fades in toward the far south (+Z), away from the desert.
  world.swampAt = function (x, z) {
    return U.clamp((z - 360) / 460, 0, 1) * (1 - world.desertAt(x, z));
  };
  // Lush rainforest: fades in toward the far west (-X), away from snow/swamp.
  world.rainforestAt = function (x, z) {
    return U.clamp((-x - 320) / 460, 0, 1) * (1 - world.snowAt(x, z)) * (1 - world.swampAt(x, z));
  };

  function buildTerrain(scene) {
    const size = C.WORLD_RADIUS * 2.6;
    const seg = 380;          // more segments to keep the huge terrain smooth
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const lo = new THREE.Color('#33571f');
    const hi = new THREE.Color('#52803a');
    const sand = new THREE.Color('#c8b27a');
    const desert = new THREE.Color('#d9c188');
    const snow = new THREE.Color('#e6edf2');
    const swamp = new THREE.Color('#3c4a2c');
    const jungle = new THREE.Color('#184a1c');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = world.heightAt(x, z);
      pos.setY(i, h);
      const t = U.clamp((h + 3) / 7, 0, 1);
      const col = lo.clone().lerp(hi, t);
      if (h < -2.2) col.lerp(sand, U.clamp((-2.2 - h) * 0.5, 0, 0.7)); // low = dirt/sand
      col.lerp(desert, world.desertAt(x, z) * 0.85);                   // east becomes desert
      col.lerp(snow, world.snowAt(x, z) * 0.92);                       // north becomes snowy tundra
      col.lerp(swamp, world.swampAt(x, z) * 0.8);                      // south becomes murky swamp
      col.lerp(jungle, world.rainforestAt(x, z) * 0.85);               // west becomes lush rainforest
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

  function makeTree(big) {
    const g = new THREE.Group();
    const scale = big ? U.rand(2.6, 3.6) : U.rand(0.8, 1.5);

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
    const tiers = big ? U.randInt(3, 4) : U.randInt(2, 3);
    for (let i = 0; i < tiers; i++) {
      const r = (1.5 - i * 0.32) * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.7 * scale, 7), fMat);
      cone.position.y = trunkH + i * 1.0 * scale - 0.2;
      cone.castShadow = true;
      cone.userData.parent = g;
      g.add(cone);
    }
    // big trees are tougher but drop a lot more wood
    g.userData = { type: 'tree', hp: big ? 80 : 40, maxHp: big ? 80 : 40, scale, alive: true, big: !!big };
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

  // Tall green cactus for the desert biome.
  function makeCactus() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b7d3a, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.8, 7), mat);
    body.position.y = 0.9; body.castShadow = true; g.add(body);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.7, 6), mat);
      arm.position.set(sx * 0.3, 0.95, 0); arm.rotation.z = sx * 0.6; g.add(arm);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 6), mat);
      up.position.set(sx * 0.5, 1.32, 0); up.castShadow = true; g.add(up);
    }
    g.userData = { type: 'cactus' };
    return g;
  }

  // A primitive hut you can walk into: a ring of wall panels with a doorway gap
  // (at local +Z), a dirt floor, and a conical thatched roof. Player-sized inside.
  function makeHut() {
    const g = new THREE.Group();
    const wallCols = ['#8a6a44', '#9a7a4e', '#7e623e'];
    const wall = new THREE.MeshStandardMaterial({ color: wallCols[U.randInt(0, wallCols.length - 1)], roughness: 1, flatShading: true });
    const thatch = new THREE.MeshStandardMaterial({ color: U.chance(0.5) ? 0xb59a55 : 0x9c8038, roughness: 1, flatShading: true });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 1, flatShading: true });
    const R = U.rand(3.0, 3.6), H = U.rand(2.6, 3.0), N = 14;
    const seg = (2 * Math.PI * R) / N, half = seg * 0.5;

    // wall ring — every panel except panel 0, which is the doorway opening
    for (let i = 0; i < N; i++) {
      if (i === 0) continue;
      const ang = (i / N) * Math.PI * 2;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(seg * 1.18, H, 0.14), wall);
      panel.position.set(Math.sin(ang) * R, H / 2, Math.cos(ang) * R);
      panel.rotation.y = ang; panel.castShadow = true; panel.receiveShadow = true; g.add(panel);
    }
    // doorway frame (posts + lintel) and a filled strip above the door
    const DOOR_H = 2.2;
    for (const sx of [-half, half]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, DOOR_H, 0.2), frameMat);
      post.position.set(sx, DOOR_H / 2, R); g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(seg * 1.1, 0.2, 0.2), frameMat);
    lintel.position.set(0, DOOR_H, R); g.add(lintel);
    if (H > DOOR_H + 0.1) {
      const above = new THREE.Mesh(new THREE.BoxGeometry(seg * 1.18, H - DOOR_H, 0.14), wall);
      above.position.set(0, DOOR_H + (H - DOOR_H) / 2, R); g.add(above);
    }
    // dirt floor + thatched cone roof
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.08, N), new THREE.MeshStandardMaterial({ color: 0x6b5436, roughness: 1 }));
    floor.position.y = 0.04; floor.receiveShadow = true; g.add(floor);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(R * 1.3, R * 0.95, N), thatch);
    roof.position.y = H + R * 0.42; roof.castShadow = true; g.add(roof);

    furnishHut(g, R);
    g.userData = { type: 'hut', R, H, N };
    return g;
  }

  // Furnish a hut's interior: a rug, a bed, a table with crockery, stools & a chest.
  function furnishHut(g, R) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5e3f23, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 1, flatShading: true });
    const y0 = 0.085;                                   // sit on the dirt floor

    // woven rug in the middle
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.02, 18),
      new THREE.MeshStandardMaterial({ color: U.chance(0.5) ? 0x8a3b3b : 0x355a7a, roughness: 1 }));
    rug.position.y = y0 + 0.01; g.add(rug);

    // bed against the back-left wall
    const bed = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 1.9), wood); frame.position.y = 0.18; frame.castShadow = true; bed.add(frame);
    const matt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 1.8), cloth); matt.position.y = 0.34; bed.add(matt);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 1.0), new THREE.MeshStandardMaterial({ color: U.chance(0.5) ? 0x9a5a3a : 0x3a6a5a, roughness: 1, flatShading: true }));
    blanket.position.set(0, 0.42, 0.34); bed.add(blanket);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.34), new THREE.MeshStandardMaterial({ color: 0xe8ddc8, roughness: 1 })); pillow.position.set(0, 0.42, -0.72); bed.add(pillow);
    bed.position.set(-R * 0.46, y0, -R * 0.44); bed.rotation.y = 0.4; g.add(bed);

    // round table with a bowl + jug, flanked by two stools
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12), wood); top.position.y = 0.62; top.castShadow = true; table.add(top);
    const tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8), dark); tleg.position.y = 0.31; table.add(tleg);
    const tbase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 8), dark); tbase.position.y = 0.03; table.add(tbase);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }));
    bowl.rotation.x = Math.PI; bowl.position.set(0.16, 0.72, 0.04); table.add(bowl);
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 1 })); jug.position.set(-0.18, 0.74, 0.04); table.add(jug);
    table.position.set(R * 0.4, y0, R * 0.12); g.add(table);
    for (const sa of [0.7, -0.8]) {
      const stool = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 8), wood); seat.position.y = 0.4; stool.add(seat);
      const sleg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6), dark); sleg.position.y = 0.2; stool.add(sleg);
      stool.position.set(R * 0.4 + Math.cos(sa) * 0.9, y0, R * 0.12 + Math.sin(sa) * 0.9); g.add(stool);
    }

    // a storage chest by the wall
    const chest = new THREE.Group();
    const cbody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.45), wood); cbody.position.y = 0.2; cbody.castShadow = true; chest.add(cbody);
    const clid = new THREE.Mesh(new THREE.BoxGeometry(0.73, 0.16, 0.48), dark); clid.position.y = 0.46; chest.add(clid);
    chest.position.set(R * 0.42, y0, -R * 0.5); chest.rotation.y = -0.5; g.add(chest);
  }

  // A low leafy fern/shrub for the rainforest floor (decor, no collider).
  function makeFern() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: U.chance(0.5) ? 0x2f6b2a : 0x357a30, roughness: 1, flatShading: true });
    const blades = U.randInt(5, 8);
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + U.rand(-0.3, 0.3);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, U.rand(0.5, 0.9), 4), mat);
      leaf.position.set(Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12);
      leaf.rotation.z = Math.cos(a) * 0.9; leaf.rotation.x = Math.sin(a) * 0.9;
      g.add(leaf);
    }
    g.userData = { type: 'fern' };
    return g;
  }

  function scatter(scene) {
    const placed = [];
    const CAMP_CLEAR = 12;                        // no trees/bushes within this radius of camp
    const okSpot = (x, z, minGap) =>
      placed.every((p) => U.dist2(x, z, p.x, p.z) > minGap) &&
      U.dist2(x, z, 0, 0) > CAMP_CLEAR &&          // keep the camp clearing open
      world.heightAt(x, z) > C.WATER_LEVEL + 0.4;  // stay out of the water

    const addTree = (p, big) => {
      const tree = makeTree(big);
      tree.position.set(p.x, world.heightAt(p.x, p.z) - 0.1, p.z);
      tree.rotation.y = U.rand(0, Math.PI * 2);
      scene.add(tree);
      world.trees.push(tree);
      world.colliders.push({ x: p.x, z: p.z, r: big ? 0.9 : 0.5, ref: tree });
      placed.push(p);
    };

    // Trees everywhere except desert (barren) and tundra (sparse); rainforest is densest.
    let tries = 0;
    while (world.trees.length < C.TREE_COUNT && tries < C.TREE_COUNT * 8) {
      tries++;
      const p = U.pointInDisc(C.WORLD_RADIUS);
      const rf = world.rainforestAt(p.x, p.z);
      if (!okSpot(p.x, p.z, rf > 0.4 ? 1.8 : 3.0)) continue;   // pack tighter in the jungle
      if (world.desertAt(p.x, p.z) > 0.45 && U.chance(0.9)) continue;
      if (world.snowAt(p.x, p.z) > 0.5 && U.chance(0.7)) continue;   // sparse trees in the tundra
      addTree(p, U.chance(rf > 0.4 ? 0.32 : 0.16));            // bigger canopy in the rainforest
    }
    // extra-dense canopy for the rainforest — sample directly in the west and pack
    // tightly (overlapping canopies read as thick jungle; skip the slow gap test).
    let rfPlaced = 0, rfTries = 0;
    while (rfPlaced < 1300 && rfTries < 9000) {
      rfTries++;
      const x = -U.rand(345, 985), z = U.rand(-560, 560);
      if (Math.hypot(x, z) > C.WORLD_RADIUS) continue;
      if (world.rainforestAt(x, z) < 0.4) continue;
      if (world.heightAt(x, z) <= C.WATER_LEVEL + 0.4) continue;
      addTree({ x, z }, U.chance(0.32));
      rfPlaced++;
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
    // Cacti in the desert region
    for (let i = 0; i < 70; i++) {
      const p = U.pointInDisc(C.WORLD_RADIUS);
      if (world.desertAt(p.x, p.z) < 0.5) continue;
      if (world.heightAt(p.x, p.z) <= C.WATER_LEVEL + 0.4) continue;
      if (U.dist2(p.x, p.z, 0, 0) < CAMP_CLEAR) continue;
      const c = makeCactus();
      c.position.set(p.x, world.heightAt(p.x, p.z), p.z); c.rotation.y = U.rand(0, 6.28);
      scene.add(c);
      world.colliders.push({ x: p.x, z: p.z, r: 0.4, ref: c });
    }
    // Primitive huts dotted around the grasslands & jungle (not desert/tundra, not at camp)
    for (let i = 0; i < 26; i++) {
      const p = U.pointInDisc(C.WORLD_RADIUS);
      if (world.heightAt(p.x, p.z) <= C.WATER_LEVEL + 0.6) continue;
      if (U.dist2(p.x, p.z, 0, 0) < 26) continue;
      if (world.desertAt(p.x, p.z) > 0.4 || world.snowAt(p.x, p.z) > 0.5) continue;
      const hut = makeHut();
      hut.position.set(p.x, world.heightAt(p.x, p.z) - 0.05, p.z); hut.rotation.y = U.rand(0, 6.28);
      scene.add(hut);
      // wall colliders ring the hut but leave the doorway (panel 0) open so you can walk in
      const R = hut.userData.R, N = hut.userData.N, ry = hut.rotation.y;
      for (let s = 1; s < N; s++) {
        const ang = (s / N) * Math.PI * 2 + ry;
        world.colliders.push({ x: p.x + Math.sin(ang) * R, z: p.z + Math.cos(ang) * R, r: 0.7, ref: hut });
      }
    }
    // Leafy ferns carpet the rainforest floor
    let ferns = 0, ftries = 0;
    while (ferns < 500 && ftries < 4000) {
      ftries++;
      const x = -U.rand(345, 985), z = U.rand(-560, 560);
      if (Math.hypot(x, z) > C.WORLD_RADIUS) continue;
      if (world.rainforestAt(x, z) < 0.4 || world.heightAt(x, z) <= C.WATER_LEVEL + 0.4) continue;
      const f = makeFern();
      f.position.set(x, world.heightAt(x, z), z); f.rotation.y = U.rand(0, 6.28);
      scene.add(f);
      ferns++;
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

    const logMat = new THREE.MeshStandardMaterial({ color: 0x3f2a18, roughness: 1, flatShading: true });
    const logGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.95, 7);
    // criss-crossed logs lying flat at the base (no upright/teepee logs)
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      log.position.set(0, 0.12 + i * 0.02, 0);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i * (Math.PI / 3) + 0.3;
      log.castShadow = true; fire.add(log);
    }
    // glowing ember bed beneath the flames
    const embers = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.44, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff5a14, emissiveIntensity: 1.3, roughness: 1 }),
    );
    embers.position.y = 0.07; fire.add(embers);

    // layered flames: deep orange -> yellow -> bright core
    const flames = [];
    [0xff4e10, 0xff7a18, 0xffaa2c, 0xffd64a, 0xfff0a8].forEach((col, i) => {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(0.3 - i * 0.05, 1.0 - i * 0.15, 8),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 - i * 0.05, fog: false }),
      );
      f.position.set(U.rand(-0.03, 0.03), 0.32 + i * 0.05, U.rand(-0.03, 0.03));
      fire.add(f); flames.push(f);
    });

    const light = new THREE.PointLight(0xff7a33, 2.2, 24, 1.6);
    light.position.set(0, 0.9, 0);
    fire.add(light);

    // a cooking tripod with a hanging cauldron over the flames
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.7, 5), ironMat);
      leg.position.set(Math.cos(a) * 0.55, 0.78, Math.sin(a) * 0.55);
      leg.rotation.x = Math.cos(a) * 0.32; leg.rotation.z = -Math.sin(a) * 0.32;
      leg.castShadow = true; fire.add(leg);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.18, 0.32, 12),
      new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.7, metalness: 0.4 }));
    pot.position.y = 1.0; pot.castShadow = true; fire.add(pot);
    const potRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 14), ironMat);
    potRim.rotation.x = Math.PI / 2; potRim.position.y = 1.16; fire.add(potRim);

    camp.add(fire);
    world.campfire = { flames, light, base: 2.2, t: 0 };
    world.colliders.push({ x: cx, z: cz, r: 0.85 });
    world.campfires.push({ x: cx, z: cz });          // spawn camp is a haven

    // --- log benches ringing the fire (sit on them with R) ---
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const benchEnd = new THREE.MeshStandardMaterial({ color: 0xc9a878, roughness: 1, flatShading: true });
    const NB = 5, BR = 1.85;
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * Math.PI * 2 + 0.3;
      const bx = cx + Math.cos(a) * BR, bz = cz + Math.sin(a) * BR;
      const gy = world.heightAt(bx, bz);
      const bench = new THREE.Group();
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 10), benchMat);
      log.rotation.z = Math.PI / 2; log.position.y = 0.2; log.castShadow = true; bench.add(log);
      for (const ex of [-0.76, 0.76]) {            // pale cut ends
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.03, 10), benchEnd);
        cap.rotation.z = Math.PI / 2; cap.position.set(ex, 0.2, 0); bench.add(cap);
      }
      // little stub legs so it reads as a hewn bench
      for (const ex of [-0.5, 0.5]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6), benchMat);
        leg.position.set(ex, 0.05, 0); bench.add(leg);
      }
      bench.position.set(bx, gy, bz);
      bench.rotation.y = a + Math.PI / 2;          // log lies tangent to the fire ring
      camp.add(bench);
      world.colliders.push({ x: bx, z: bz, r: 0.5 });
      // sittable: perch on top, facing the fire
      world.seats.push({ x: bx, y: gy + 0.4, z: bz, yaw: Math.atan2(bx - cx, bz - cz) });
    }

    // --- a stacked firewood pile beside the fire ---
    const woodPile = new THREE.Group();
    const pileMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, flatShading: true });
    const pileEnd = new THREE.MeshStandardMaterial({ color: 0xb89466, roughness: 1, flatShading: true });
    let py = 0.16;
    for (const row of [[-0.22, 0, 0.22], [-0.11, 0.11]]) {
      for (const off of row) {
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.95, 8), pileMat);
        fl.rotation.x = Math.PI / 2; fl.position.set(off, py, 0); fl.castShadow = true; woodPile.add(fl);
        for (const ez of [-0.48, 0.48]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.02, 8), pileEnd); cap.rotation.x = Math.PI / 2; cap.position.set(off, py, ez); woodPile.add(cap); }
      }
      py += 0.2;
    }
    const px = cx + Math.cos(1.1) * 2.4, pz = cz + Math.sin(1.1) * 2.4;
    woodPile.position.set(px, world.heightAt(px, pz), pz);
    woodPile.rotation.y = 0.6;
    camp.add(woodPile);
    world.colliders.push({ x: px, z: pz, r: 0.55 });

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
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.26, 2.45),
        new THREE.MeshStandardMaterial({ color: 0x5e3f23, roughness: 1 }));
      frame.position.y = 0.15; frame.castShadow = true; bed.add(frame);
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.2, 2.34),
        new THREE.MeshStandardMaterial({ color: 0xdcd2bd, roughness: 1, flatShading: true }));
      mattress.position.y = 0.38; mattress.castShadow = true; bed.add(mattress);
      const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.14, 1.35),
        new THREE.MeshStandardMaterial({ color: blanketColor, roughness: 1, flatShading: true }));
      blanket.position.set(0, 0.5, 0.46); bed.add(blanket);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.44),
        new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 1, flatShading: true }));
      pillow.position.set(0, 0.48, -0.88); bed.add(pillow);
      return bed;
    }

    function makeTable() {
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1, flatShading: true });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.55), wood);
      top.position.y = 0.6; top.castShadow = true; g.add(top);
      const legGeo = new THREE.BoxGeometry(0.08, 0.56, 0.08);
      for (const [lx, lz] of [[-0.36, -0.21], [0.36, -0.21], [-0.36, 0.21], [0.36, 0.21]]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(lx, 0.28, lz); leg.castShadow = true; g.add(leg);
      }
      // a little candle on top
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0xf2e8d0, roughness: 1 }));
      candle.position.set(0.22, 0.7, 0); g.add(candle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 6),
        new THREE.MeshBasicMaterial({ color: 0xffb24a, fog: false }));
      flame.position.set(0.22, 0.79, 0); g.add(flame);
      return g;
    }

    function makeChair() {
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.4), wood);
      seat.position.y = 0.42; seat.castShadow = true; g.add(seat);
      const legGeo = new THREE.BoxGeometry(0.06, 0.42, 0.06);
      for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(lx, 0.21, lz); leg.castShadow = true; g.add(leg);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.06), wood);
      back.position.set(0, 0.65, -0.17); back.castShadow = true; g.add(back);
      return g;
    }

    // --- Gadgets that sit on each tent's table ---
    function makePhone(color) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.32),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      body.castShadow = true; g.add(body);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.27), new THREE.MeshBasicMaterial({ color: 0xe8f4ff }));
      screen.rotation.x = -Math.PI / 2; screen.position.y = 0.014; g.add(screen);
      return g;
    }
    function makePigPhone() {
      const g = makePhone(0xf28db5);
      const pig = new THREE.MeshStandardMaterial({ color: 0xe07ba0, roughness: 1, flatShading: true });
      for (const sx of [-0.05, 0.05]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 4), pig);
        ear.position.set(sx, 0.02, -0.16); ear.rotation.x = -0.5; g.add(ear);
      }
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), pig);
      snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.026, 0.07); g.add(snout);
      for (const sx of [-0.012, 0.012]) {
        const n = new THREE.Mesh(new THREE.SphereGeometry(0.006, 5, 5), new THREE.MeshStandardMaterial({ color: 0x7a3a55 }));
        n.position.set(sx, 0.037, 0.07); g.add(n);
      }
      return g;
    }
    function makeIpad() {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.58),
        new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.2 }));
      frame.castShadow = true; g.add(frame);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.5), new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
      screen.rotation.x = -Math.PI / 2; screen.position.y = 0.017; g.add(screen);
      g.rotation.x = -0.12;
      return g;
    }
    function makeLaptop() {
      const g = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.3 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.32), body); base.castShadow = true; g.add(base);
      const keys = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.006, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1 }));
      keys.position.set(0, 0.018, 0.03); g.add(keys);
      const screen = new THREE.Group();
      const sback = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.025), body);
      const sface = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ color: 0x9fe0ff }));
      sface.position.z = 0.014;
      screen.add(sback, sface);
      screen.position.set(0, 0.15, -0.15); screen.rotation.x = -0.42; // tilt up toward the chair
      g.add(screen);
      return g;
    }
    // 0=red→iPad, 1=aqua→blue phone, 2=pink→pig phone, 3=green→computer
    function makeDevice(i) {
      if (i === 0) return makeIpad();
      if (i === 1) return makePhone(0x3a6fd0);
      if (i === 2) return makePigPhone();
      return makeLaptop();
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

      // wooden floor so the inside isn't grass, plus a cosy rug
      const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.04, 0.08, Dp - 0.04),
        new THREE.MeshStandardMaterial({ color: 0x7a5734, roughness: 1, flatShading: true }));
      floor.position.set(0, 0.05, 0); floor.receiveShadow = true; tent.add(floor);
      const rug = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 2.2),
        new THREE.MeshStandardMaterial({ color: tentCols[i], roughness: 1, flatShading: true }));
      rug.position.set(0.55, 0.1, 0.3); tent.add(rug);

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

      // wooden floor so you don't see grass inside the tent
      const tentFloor = new THREE.Mesh(
        new THREE.BoxGeometry(Wd - 0.06, 0.12, Dp - 0.06),
        new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 1, flatShading: true }),
      );
      tentFloor.position.y = 0.03; tentFloor.receiveShadow = true; tent.add(tentFloor);

      const bed = makeBed(tentCols[i]);              // blanket matches the tent colour
      bed.position.set(-0.55, 0, -0.6);              // inside, toward the back; entrance stays clear
      const stuffie = makeStuffieFor(i);
      stuffie.position.set(0, 0.5, -0.3);            // themed one, near the pillow
      bed.add(stuffie);
      world.stuffies.push({ mesh: stuffie, tentIdx: i, alive: true });
      // a couple more little plushies scattered on the bed
      const extras = [
        () => makeBear(0x8a5a3a), () => makeBear(0xd8c084), () => makeBunny(0xe6a6c8),
        () => makeBunny(0x9ad0a0), () => makeDog(0x9a9a9a), () => makeCat(),
      ];
      for (let k = 0; k < 2; k++) {
        const ex = extras[U.randInt(0, extras.length - 1)]();
        ex.scale.setScalar(0.7);
        ex.position.set(-0.36 + k * 0.72, 0.52, 0.28 - k * 0.06);
        ex.rotation.y = U.rand(-0.6, 0.6);
        bed.add(ex);
        world.stuffies.push({ mesh: ex, tentIdx: i, alive: true });
      }
      tent.add(bed);

      const table = makeTable();
      table.position.set(0.9, 0, 0.15);   // opposite the bed, entrance stays clear
      const device = makeDevice(i);        // gadget on the tabletop, per tent
      device.position.set(0, 0.66, 0.05);
      table.add(device);
      tent.add(table);

      const chair = makeChair();
      chair.position.set(0.9, 0, 0.78);   // next to the table, facing it
      chair.rotation.y = Math.PI;
      tent.add(chair);

      tent.lookAt(cx, gy, cz); // open front faces the fire
      camp.add(tent);

      // register the chair as a sittable seat (in world space, now the tent is oriented)
      const sp = new THREE.Vector3(chair.position.x, 0.42, chair.position.z).applyQuaternion(tent.quaternion).add(tent.position);
      const fd = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.quaternion).applyQuaternion(tent.quaternion);
      world.seats.push({ x: sp.x, y: tent.position.y + 0.42, z: sp.z, yaw: Math.atan2(-fd.x, -fd.z) });

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

  // --- A far-off village (~500m from camp) -----------------------------------

  function makeHouse() {
    const g = new THREE.Group();
    const wallCols = ['#cbb083', '#bd965c', '#cfc3a6', '#b0a890', '#c79a6a'];
    const wall = new THREE.MeshStandardMaterial({ color: wallCols[U.randInt(0, wallCols.length - 1)], roughness: 1, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: U.chance(0.5) ? 0x7a3b2a : 0x5a4030, roughness: 1, flatShading: true });
    const Wd = U.rand(3.0, 4.4), Dp = U.rand(3.0, 4.4), H = U.rand(2.4, 3.2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(Wd, H, Dp), wall);
    body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(Wd, Dp) / 2 * 1.04, H * 0.7, 4), roofMat);
    roof.position.y = H + H * 0.35; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 1 }));
    door.position.set(0, 0.8, Dp / 2 + 0.02); g.add(door);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x9fd0e8, emissive: 0x20303c, roughness: 0.4 });
    for (const sx of [-Wd / 2 - 0.02, Wd / 2 + 0.02]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.6), winMat);
      win.position.set(sx, 1.45, 0); g.add(win);
    }
    g.userData = { type: 'house', Wd, Dp };
    return g;
  }

  function buildVillage(scene) {
    // pick a spot ~500m out that isn't underwater
    let vx = 0, vz = 0, guard = 0;
    do {
      const a = U.rand(0, Math.PI * 2), r = U.rand(470, 520);
      vx = Math.cos(a) * r; vz = Math.sin(a) * r;
    } while (world.heightAt(vx, vz) <= C.WATER_LEVEL + 0.6 && guard++ < 20);
    world.villagePos = { x: vx, z: vz };

    // houses ringed around a plaza, each facing inward
    const n = U.randInt(7, 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + U.rand(-0.18, 0.18);
      const rr = U.rand(7, 12);
      const hx = vx + Math.cos(a) * rr, hz = vz + Math.sin(a) * rr;
      const h = makeHouse();
      const hy = world.heightAt(hx, hz);
      h.position.set(hx, hy, hz);
      h.lookAt(vx, hy, vz);                 // door faces the plaza
      scene.add(h);
      world.colliders.push({ x: hx, z: hz, r: Math.max(h.userData.Wd, h.userData.Dp) * 0.6 });
    }

    // a stone well at the centre
    const wellMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 1, flatShading: true });
    const well = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.7, 12), wellMat); ring.position.y = 0.35; ring.castShadow = true; well.add(ring);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x2f6f9e, roughness: 0.3 })); water.position.y = 0.5; well.add(water);
    for (const sx of [-0.62, 0.62]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 })); post.position.set(sx, 1.0, 0); post.castShadow = true; well.add(post); }
    const wroof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x7a3b2a, roughness: 1, flatShading: true })); wroof.position.y = 1.9; wroof.rotation.y = Math.PI / 4; wroof.castShadow = true; well.add(wroof);
    well.position.set(vx, world.heightAt(vx, vz), vz);
    scene.add(well);
    world.colliders.push({ x: vx, z: vz, r: 0.95 });

    // a campfire just off the plaza makes the village a rest-stop haven
    world.placeCampfire(vx + 3.2, vz + 3.2);
  }

  // --- Bandit outposts: fortified camps, guarded by bandits -------------------

  function makeCrate() {
    const s = U.rand(0.5, 0.8);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1, flatShading: true }));
    body.position.y = s / 2; body.castShadow = true; g.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.07, s * 1.02),
      new THREE.MeshStandardMaterial({ color: 0x5a4426, roughness: 1 }));
    band.position.y = s / 2; g.add(band);
    g.userData = { s };
    return g;
  }

  function makeWatchtower() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1, flatShading: true });
    const H = 4.2, half = 1.0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, H, 0.13), wood);
      post.position.set(sx * half, H / 2, sz * half); post.castShadow = true; g.add(post);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.5, 0.16, half * 2 + 0.5), dark);
    plat.position.y = H; plat.castShadow = true; g.add(plat);
    for (const [sx, sz, rot] of [[0, -1, 0], [0, 1, 0], [-1, 0, Math.PI / 2], [1, 0, Math.PI / 2]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.5, 0.5, 0.08), wood);
      rail.position.set(sx * (half + 0.2), H + 0.35, sz * (half + 0.2)); rail.rotation.y = rot; g.add(rail);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(half * 1.8, 1.1, 4),
      new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 1, flatShading: true }));
    roof.position.y = H + 1.15; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    return g;
  }

  // A bandit's own campfire — flickers, but is NOT a player haven.
  function makeOutpostFire() {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6c72, roughness: 1, flatShading: true });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const s = new THREE.Mesh(new THREE.IcosahedronGeometry(U.rand(0.14, 0.22), 0), stoneMat); s.position.set(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55); g.add(s); }
    const logMat = new THREE.MeshStandardMaterial({ color: 0x3f2a18, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.8, 6), logMat); log.position.set(Math.cos(a) * 0.18, 0.32, Math.sin(a) * 0.18); log.rotation.x = Math.sin(a) * 0.5; log.rotation.z = -Math.cos(a) * 0.5; g.add(log); }
    const flames = [];
    [0xff5a16, 0xffab3a, 0xffe07a].forEach((col, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.2 - i * 0.05, 0.6 - i * 0.12, 7), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, fog: false })); f.position.y = 0.28 + i * 0.04; g.add(f); flames.push(f); });
    const light = new THREE.PointLight(0xff7a33, 1.5, 16, 1.6); light.position.set(0, 0.7, 0); g.add(light);
    g.userData = { flames, light };
    return g;
  }

  function buildOutpost(scene, ox, oz) {
    const grp = new THREE.Group();
    const gy = world.heightAt(ox, oz);

    // spiked palisade ring with an entrance gap
    const R = 7.5, logH = 2.0;
    const palMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, flatShading: true });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 1, flatShading: true });
    const N = 30;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      if (t > 0.2 && t < 0.32) continue;          // leave an entrance gap
      const a = t * Math.PI * 2;
      const px = ox + Math.cos(a) * R, pz = oz + Math.sin(a) * R, py = world.heightAt(px, pz);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, logH, 6), palMat);
      log.position.set(px, py + logH / 2, pz); log.castShadow = true; grp.add(log);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.35, 6), tipMat);
      tip.position.set(px, py + logH + 0.15, pz); grp.add(tip);
      world.colliders.push({ x: px, z: pz, r: 0.3 });
    }

    // watchtower toward the back
    const tower = makeWatchtower();
    const tx = ox + Math.cos(Math.PI) * 3.8, tz = oz + Math.sin(Math.PI) * 3.8;
    tower.position.set(tx, world.heightAt(tx, tz), tz); grp.add(tower);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) world.colliders.push({ x: tx + lx, z: tz + lz, r: 0.25 });

    // a shack (reuse the village house model)
    const shack = makeHouse();
    const hx = ox + 3.0, hz = oz + 3.0;
    shack.position.set(hx, world.heightAt(hx, hz), hz); shack.rotation.y = U.rand(0, 6.28); grp.add(shack);
    world.colliders.push({ x: hx, z: hz, r: Math.max(shack.userData.Wd, shack.userData.Dp) * 0.6 });

    // their campfire (decorative, flickers — not a haven)
    const fire = makeOutpostFire();
    fire.position.set(ox, gy, oz); grp.add(fire);
    world._extraFires.push({ flames: fire.userData.flames, light: fire.userData.light, t: U.rand(0, 5) });
    world.colliders.push({ x: ox, z: oz, r: 0.7 });

    // scattered loot crates
    for (let i = 0; i < 4; i++) {
      const c = makeCrate();
      const cx2 = ox + U.rand(-3.5, 3.5), cz2 = oz + U.rand(-3.5, 3.5);
      c.position.set(cx2, world.heightAt(cx2, cz2), cz2); c.rotation.y = U.rand(0, 6.28); grp.add(c);
      world.colliders.push({ x: cx2, z: cz2, r: c.userData.s * 0.6 });
    }

    scene.add(grp);
    world.outposts.push({ x: ox, z: oz });
  }

  function buildBanditOutposts(scene) {
    let tries = 0;
    while (world.outposts.length < 3 && tries < 80) {
      tries++;
      const a = U.rand(0, Math.PI * 2), r = U.rand(220, 680);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (world.heightAt(x, z) <= C.WATER_LEVEL + 0.8) continue;
      if (world.villagePos && U.dist2(x, z, world.villagePos.x, world.villagePos.z) < 70) continue;
      if (world.outposts.some((o) => U.dist2(x, z, o.x, o.z) < 140)) continue;
      buildOutpost(scene, x, z);
    }
  }

  // The base haven: heal, infinite stamina, recover hunger/thirst near ANY campfire
  // (the spawn camp plus any campfire you craft to set up a base elsewhere).
  world.nearCamp = function (pos) {
    return world.campfires.some((c) => U.dist2(pos.x, pos.z, c.x, c.z) < 8);
  };

  // Nearest seat (chair) within range, so the player can sit on it.
  world.nearestSeat = function (pos, range) {
    let best = null, bd = range || 1.8;
    for (const s of world.seats) {
      const d = U.dist2(pos.x, pos.z, s.x, s.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  // --- Tents: zip up the entrance so nothing can get in -----------------------

  const _tv = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ev = new THREE.Vector3(), _ep = new THREE.Vector3();

  // Which tent (if any) the player is standing inside.
  world.insideTent = function (pos) {
    for (const t of world.tents) {
      _tv.set(pos.x - t.x, 0, pos.z - t.z).applyQuaternion(_tq.copy(t.quat).invert());
      if (Math.abs(_tv.x) < t.Wd / 2 + 0.25 && Math.abs(_tv.z) < t.Dp / 2 + 0.25) return t;
    }
    return null;
  };

  // --- Stuffies: enemies that get inside a tent smash them ---------------------
  world.intactStuffies = function () { return world.stuffies.reduce((n, s) => n + (s.alive ? 1 : 0), 0); };

  // A hostile creature at `pos` wrecks one stuffie in the tent it's standing in.
  world.damageStuffieAt = function (pos) {
    const t = world.insideTent(pos);
    if (!t) return false;
    const idx = world.tents.indexOf(t);
    const s = world.stuffies.find((x) => x.alive && x.tentIdx === idx);
    if (!s) return false;
    s.alive = false; s.mesh.visible = false;
    if (W.hud) W.hud.toast('🧸💥 A beast wrecked a stuffie!');
    if (world.stuffies.length && world.stuffies.every((x) => !x.alive)) {
      world.stuffiesBroken = true; world._stuffieBreakDay = world._dayCount;
      if (W.hud) W.hud.banner('STUFFIES DESTROYED', 'No sleeping until they mend — 5 days', '#ff7b7b');
    }
    return true;
  };

  // Bring every stuffie back (after the 5-day mend).
  world.reviveStuffies = function () {
    for (const s of world.stuffies) { s.alive = true; s.mesh.visible = true; }
    world.stuffiesBroken = false; world._stuffieBreakDay = -1;
    if (W.hud) W.hud.banner('STUFFIES MENDED', 'Your plushies are back — you can sleep again 🧸', '#8fd36a');
  };

  // Nearest tent you can reach the zipper of — inside OR within ~1.4m outside.
  world.tentForZip = function (pos) {
    let best = null, bestD = 1e9;
    for (const t of world.tents) {
      _tv.set(pos.x - t.x, 0, pos.z - t.z).applyQuaternion(_tq.copy(t.quat).invert());
      const ox = Math.max(0, Math.abs(_tv.x) - t.Wd / 2);
      const oz = Math.max(0, Math.abs(_tv.z) - t.Dp / 2);
      const out = Math.hypot(ox, oz);             // 0 when inside the footprint
      if (out < 2.0 && out < bestD) { bestD = out; best = t; }   // reach the zipper from outside
    }
    return best;
  };

  // Seal (or re-open) a tent's open front. Synced across the network by index.
  world.applyTentZip = function (idx, zipped) {
    const t = world.tents[idx];
    if (!t || t.zipped === zipped) return;
    t.zipped = zipped;
    if (zipped) {
      t.flapHp = 100;                // fresh flap; beasts can claw it open
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

  // Toggle the nearest reachable tent (works from outside too). Returns {idx, zipped} or null.
  world.toggleTentZip = function (pos) {
    const t = world.tentForZip(pos);
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
    world.skyDome = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 16), mat);
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
      const r = U.rand(1050, 1300);                     // ring the huge world's edge
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const baseY = world.heightAt(x, z) - 5;
      const radius = U.rand(95, 180), height = U.rand(160, 320);  // bigger so they read from afar
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
    // gentle wind: sway the blade tips (scaled by local height) using a time uniform
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      world._grassUniform = shader.uniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.5;
         float h = position.y * 6.0;
         transformed.x += sin(uTime * 1.6 + ph) * 0.05 * h;
         transformed.z += cos(uTime * 1.2 + ph) * 0.04 * h;`,
      );
    };
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
    // tiny geometry merger (no BufferGeometryUtils dependency)
    const mergeParts = (parts) => {
      const pos = [], nrm = [];
      for (const part of parts) {
        const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
        g.applyMatrix4(part.m);
        const pa = g.attributes.position.array, na = g.attributes.normal && g.attributes.normal.array;
        for (let i = 0; i < pa.length; i++) pos.push(pa[i]);
        if (na) for (let i = 0; i < na.length; i++) nrm.push(na[i]);
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (nrm.length === pos.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      else out.computeVertexNormals();
      return out;
    };

    const HEAD_Y = 0.22;
    // flower head: a ring of flattened petals (tinted per flower)
    const petal = new THREE.SphereGeometry(1, 6, 4);
    const petalParts = [], PET = 6;
    for (let k = 0; k < PET; k++) {
      const ang = (k / PET) * Math.PI * 2;
      const mm = new THREE.Matrix4()
        .makeTranslation(Math.cos(ang) * 0.06, HEAD_Y, Math.sin(ang) * 0.06)
        .multiply(new THREE.Matrix4().makeScale(0.05, 0.018, 0.05));
      petalParts.push({ geo: petal, m: mm });
    }
    const headGeo = mergeParts(petalParts);
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true });

    const stemGeo = new THREE.CylinderGeometry(0.008, 0.012, HEAD_Y, 5);
    stemGeo.translate(0, HEAD_Y / 2, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 1, flatShading: true });

    const coreGeo = new THREE.SphereGeometry(0.032, 6, 5);
    coreGeo.translate(0, HEAD_Y + 0.004, 0);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xf2d23a, roughness: 0.6, emissive: 0x33280a, emissiveIntensity: 0.25 });

    const palette = ['#e8702a', '#f2c33a', '#f25a7a', '#f6f1e7', '#c25ad8', '#6aa6ff', '#ff8fbf'];
    const N = 1000;
    const heads = new THREE.InstancedMesh(headGeo, headMat, N);
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
    const cores = new THREE.InstancedMesh(coreGeo, coreMat, N);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < N; i++) {
      const pt = U.pointInDisc(62);
      const h = world.heightAt(pt.x, pt.z);
      if (h <= C.WATER_LEVEL + 0.5) continue;
      const sc = U.rand(0.7, 1.4); s.set(sc, sc, sc); p.set(pt.x, h, pt.z);
      e.set(0, U.rand(0, Math.PI * 2), 0); q.setFromEuler(e);
      m.compose(p, q, s);
      heads.setMatrixAt(n, m); stems.setMatrixAt(n, m); cores.setMatrixAt(n, m);
      col.set(palette[U.randInt(0, palette.length - 1)]); heads.setColorAt(n, col);
      n++;
    }
    heads.count = stems.count = cores.count = n;
    heads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = cores.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    scene.add(stems); scene.add(heads); scene.add(cores);
    world.flowers = heads;
  }

  // Soft drifting clouds high overhead — they follow the player so the sky is
  // always full, and slowly drift on the wind.
  function buildClouds(scene) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85, fog: false, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const cloud = new THREE.Group();
      const puffs = U.randInt(4, 7);
      for (let j = 0; j < puffs; j++) {
        const r = U.rand(7, 14);
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
        puff.position.set(U.rand(-16, 16), U.rand(-2, 2), U.rand(-10, 10));
        puff.scale.y = 0.5;
        cloud.add(puff);
      }
      const a = U.rand(0, Math.PI * 2), rad = U.rand(40, 260);
      cloud.position.set(Math.cos(a) * rad, U.rand(120, 200), Math.sin(a) * rad);
      cloud.userData.drift = U.rand(0.4, 1.1);
      grp.add(cloud);
    }
    scene.add(grp);
    world.clouds = grp;
  }

  // Flocks of birds gliding & flapping overhead (follow the player → always alive).
  function buildBirds(scene) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const bird = new THREE.Group();
      const lw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 3), mat); lw.rotation.z = Math.PI / 2; lw.position.x = -0.4; bird.add(lw);
      const rw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 3), mat); rw.rotation.z = -Math.PI / 2; rw.position.x = 0.4; bird.add(rw);
      bird.userData = { wings: [lw, rw], r: U.rand(20, 90), h: U.rand(28, 60), a: U.rand(0, Math.PI * 2), sp: U.rand(0.1, 0.25), flap: U.rand(6, 10), ph: U.rand(0, 6) };
      grp.add(bird);
    }
    scene.add(grp);
    world.birds = grp;
  }

  // Butterflies fluttering around the meadow near camp.
  function buildButterflies(scene) {
    const grp = new THREE.Group();
    const cols = [0xf2c33a, 0xf25a7a, 0xe8702a, 0xa56be0, 0xf6f1e7];
    for (let i = 0; i < 40; i++) {
      const b = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: cols[U.randInt(0, cols.length - 1)], roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
      const lw = new THREE.Mesh(new THREE.CircleGeometry(0.07, 6), mat); lw.position.x = -0.05; b.add(lw);
      const rw = new THREE.Mesh(new THREE.CircleGeometry(0.07, 6), mat); rw.position.x = 0.05; b.add(rw);
      const a = U.rand(0, Math.PI * 2), rad = U.rand(4, 34);
      b.userData = { wings: [lw, rw], bx: Math.cos(a) * rad, bz: Math.sin(a) * rad, ph: U.rand(0, 6), sp: U.rand(0.4, 1.0) };
      grp.add(b);
    }
    scene.add(grp);
    world.butterflies = grp;
  }

  // A glowing gold "★ HOTEL ★" sign (always-bright sprite).
  function makeHotelSign() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = "bold 30px 'Trebuchet MS', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,28,0,0.85)';
    ctx.strokeText('★ HOTEL ★', 128, 34);
    ctx.fillStyle = '#ffd76a'; ctx.fillText('★ HOTEL ★', 128, 34);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: true, transparent: true }));
    spr.scale.set(3.4, 0.85, 1);
    return spr;
  }

  // A tiny luxury resort hotel (cream walls, gold trim, glass, entrance canopy,
  // infinity pool + sun loungers facing the lake).
  function makeLuxuryHotel() {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4ece0, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.32, metalness: 0.75 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x244a66, roughness: 0.08, metalness: 0.35, emissive: 0x0c2236, emissiveIntensity: 0.45 });
    const water = new THREE.MeshStandardMaterial({ color: 0x36bcd8, roughness: 0.12, metalness: 0.2, emissive: 0x0a3a4a, emissiveIntensity: 0.35 });
    const W = 5.5, D = 4.5, FLOOR = 2.3, FLOORS = 3, H = FLOOR * FLOORS;

    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
    body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    for (let f = 1; f < FLOORS; f++) {                          // gold bands between floors
      const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.12, D + 0.12), gold);
      band.position.y = f * FLOOR; g.add(band);
    }
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 0.34, 0.26, D + 0.34), gold);
    cornice.position.y = H; g.add(cornice);
    // window grids (front/back)
    for (const zf of [D / 2 + 0.03, -D / 2 - 0.03]) {
      for (let f = 0; f < FLOORS; f++) for (let c = -1; c <= 1; c++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.06), glass);
        win.position.set(c * 1.6, FLOOR * f + FLOOR * 0.55, zf); g.add(win);
      }
    }
    for (const xf of [W / 2 + 0.03, -W / 2 - 0.03]) {          // side windows
      for (let f = 0; f < FLOORS; f++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 1.3), glass);
        win.position.set(xf, FLOOR * f + FLOOR * 0.55, 0); g.add(win);
      }
    }
    // grand entrance (front = +Z): canopy, gold columns, glass door, red carpet
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.16, 1.5), gold);
    canopy.position.set(0, 2.4, D / 2 + 0.75); g.add(canopy);
    for (const sx of [-1.05, 1.05]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 10), gold);
      col.position.set(sx, 1.2, D / 2 + 1.3); g.add(col);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.08), glass);
    door.position.set(0, 1.0, D / 2 + 0.05); g.add(door);
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 2.6), new THREE.MeshStandardMaterial({ color: 0x9a1f2a, roughness: 0.95 }));
    carpet.position.set(0, 0.03, D / 2 + 1.4); g.add(carpet);
    // infinity pool + rim + loungers facing the lake
    const rim = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 2.4), wallMat);
    rim.position.set(0, 0.09, D / 2 + 3.6); g.add(rim);
    const pool = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.26, 2.0), water);
    pool.position.set(0, 0.18, D / 2 + 3.6); g.add(pool);
    for (const sx of [-2.4, 2.4]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 1.1), wallMat);
      seat.position.set(sx, 0.22, D / 2 + 3.4); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), wallMat);
      back.position.set(sx, 0.4, D / 2 + 2.95); back.rotation.x = -0.5; g.add(back);
    }
    // rooftop railing + glowing sign
    for (const [w, d, x, z] of [[W, 0.08, 0, D / 2], [W, 0.08, 0, -D / 2], [0.08, D, W / 2, 0], [0.08, D, -W / 2, 0]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), gold);
      rail.position.set(x, H + 0.45, z); g.add(rail);
    }
    const sign = makeHotelSign(); sign.position.set(0, H + 1.4, 0); g.add(sign);

    g.userData = { type: 'hotel', R: Math.max(W, D) * 0.6 + 0.3 };
    return g;
  }

  // Drop a few tiny luxury hotels on lake shores, facing the water.
  function buildLakeHotels(scene) {
    let placed = 0, tries = 0;
    while (placed < 6 && tries++ < 800) {
      const p = U.pointInDisc(C.WORLD_RADIUS * 0.92);
      if (U.dist2(p.x, p.z, 0, 0) < 60) continue;                 // not on top of camp
      const h = world.heightAt(p.x, p.z);
      if (h <= C.WATER_LEVEL + 0.4 || h > C.WATER_LEVEL + 2.0) continue;  // low shore land only
      // find the nearest water and its direction
      let wx = 0, wz = 0, found = false, near = 1e9;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang);
        for (let d = 3; d <= 14; d += 2.5) {
          if (world.heightAt(p.x + cx * d, p.z + cz * d) <= C.WATER_LEVEL + 0.1) {
            if (d < near) { near = d; wx = cx; wz = cz; found = true; }
            break;
          }
        }
      }
      if (!found) continue;
      const hx = p.x - wx * 2.5, hz = p.z - wz * 2.5;             // sit back from the shore
      if (world.heightAt(hx, hz) <= C.WATER_LEVEL + 0.4) continue;
      const hotel = makeLuxuryHotel();
      hotel.position.set(hx, world.heightAt(hx, hz) - 0.05, hz);
      hotel.rotation.y = Math.atan2(wx, wz);                      // front (+Z) faces the lake
      scene.add(hotel);
      world.colliders.push({ x: hx, z: hz, r: hotel.userData.R, ref: hotel });
      placed++;
    }
    world._hotelCount = placed;
  }

  // --- Public API ------------------------------------------------------------

  world.init = function (scene) {
    buildTerrain(scene);
    buildSky(scene);
    buildSkyDome(scene);
    buildMountains(scene);
    buildWater(scene);
    buildClouds(scene);
    scatter(scene);
    buildCamp(scene);
    buildVillage(scene);
    buildBanditOutposts(scene);
    buildLakeHotels(scene);            // tiny luxury hotels on the lake shores
    // buildGrass(scene);              // tall grass removed (user request)
    buildFlowers(scene);
    buildBirds(scene);                 // ambient life: birds overhead + butterflies
    buildButterflies(scene);
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
    const wasNight = world._isNight;
    world._isNight = elev < NIGHT;

    // --- stuffies: count days, let enemies smash them, mend after 5 days ---
    if (wasNight && !world._isNight) world._dayCount += 1;        // a new dawn
    if (world.stuffiesBroken && world._dayCount - world._stuffieBreakDay >= 5) world.reviveStuffies();
    // hostile creatures claw at a zipped tent's flap until it tears open
    if (W.enemies && W.enemies.list) {
      for (let ti = 0; ti < world.tents.length; ti++) {
        const t = world.tents[ti];
        if (!t.zipped) continue;
        _ev.set(0, 0, t.Dp / 2).applyQuaternion(t.quat).add(_ep.set(t.x, 0, t.z));   // entrance in world space
        let clawing = false;
        for (const e of W.enemies.list) {
          if (!e.alive) continue;
          if (Math.hypot(e.group.position.x - _ev.x, e.group.position.z - _ev.z) < 2.4) { clawing = true; break; }
        }
        if (clawing) {
          const before = t.flapHp != null ? t.flapHp : 100;
          t.flapHp = before - dt * 6;                  // ~17s to tear open with one attacker
          if (before > 40 && t.flapHp <= 40 && W.hud) W.hud.toast('🪓 Something is tearing at your tent!');
          if (t.flapHp <= 0) {
            world.applyTentZip(ti, false);
            if (W.hud) W.hud.banner('TENT BREACHED', 'The beasts tore your tent open! 🐺', '#ff7b7b');
          }
        }
      }
    }
    if (W.enemies && W.enemies.list && world.intactStuffies() > 0) {
      world._stuffieT = (world._stuffieT || 0) - dt;
      if (world._stuffieT <= 0) {
        for (const e of W.enemies.list) {
          if (!e.alive) continue;
          if (world.damageStuffieAt(e.group.position)) { world._stuffieT = 1.4; break; }
        }
      }
    }

    // --- landmark discovery: reveal on the minimap once you (or a teammate) get close ---
    const finders = [playerPos];
    if (W.net && W.net.remote) { for (const id in W.net.remote) { const r = W.net.remote[id]; if (r && r.pose) finders.push(r.pose); } }
    const nearAny = (x, z, rng) => finders.some((f) => Math.hypot(f.x - x, f.z - z) < rng);
    if (world.villagePos && !world.discovered.village && nearAny(world.villagePos.x, world.villagePos.z, 50)) {
      world.discovered.village = true; if (W.hud) W.hud.toast('🏘️ Discovered a village');
    }
    if (world.banditCampPos && !world.discovered.bandit && nearAny(world.banditCampPos.x, world.banditCampPos.z, 55)) {
      world.discovered.bandit = true; if (W.hud) W.hud.toast('🏴‍☠️ Found the bandit hideout');
    }
    for (const o of world.outposts) {
      if (!o.found && nearAny(o.x, o.z, 50)) { o.found = true; if (W.hud) W.hud.toast('🏚️ Discovered a bandit outpost'); }
    }

    const dusk = U.clamp(1 - Math.abs(elev - NIGHT) / 0.3, 0, 1);
    const sky = U.mixColor(SKY_NIGHT, SKY_DAY, U.smooth(day)).lerp(new THREE.Color(SKY_DUSK), dusk * 0.55);

    if (world.scene) world.scene.background = sky;
    if (world.scene.fog) {
      world.scene.fog.color.copy(sky);
      world.scene.fog.density = U.lerp(0.0042, 0.0015, day); // thin enough to see across the huge world
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

    // sway the grass on the wind
    if (world._grassUniform) world._grassUniform.value = world._time;

    // drift the clouds and keep them centred over the player; tint them with the sky
    if (world.clouds) {
      world.clouds.position.x = playerPos.x;
      world.clouds.position.z = playerPos.z;
      for (const c of world.clouds.children) {
        c.position.x += c.userData.drift * dt;
        if (c.position.x > 280) c.position.x = -280;
      }
      const cloudCol = U.mixColor('#3a4660', '#ffffff', world.daylight);
      world.clouds.children.forEach((c) => c.children.forEach((p) => p.material.color.copy(cloudCol)));
    }

    // birds circle overhead and flap (kept near the player so the sky is alive)
    if (world.birds) {
      const tt = world._time;
      for (const b of world.birds.children) {
        const u = b.userData;
        u.a += u.sp * dt;
        b.position.set(playerPos.x + Math.cos(u.a) * u.r, u.h + Math.sin(u.a * 1.7) * 3, playerPos.z + Math.sin(u.a) * u.r);
        b.rotation.y = -u.a + Math.PI / 2;
        const flap = Math.sin(tt * u.flap + u.ph) * 0.6;
        u.wings[0].rotation.x = flap; u.wings[1].rotation.x = flap;
      }
    }
    // butterflies flutter around the meadow near camp
    if (world.butterflies) {
      const tt = world._time;
      for (const b of world.butterflies.children) {
        const u = b.userData;
        const x = u.bx + Math.sin(tt * u.sp + u.ph) * 2.2;
        const z = u.bz + Math.cos(tt * u.sp * 0.8 + u.ph) * 2.2;
        b.position.set(x, world.heightAt(x, z) + 0.7 + Math.sin(tt * 2 + u.ph) * 0.3, z);
        b.rotation.y = tt * u.sp + u.ph;
        const flap = Math.sin(tt * 14 + u.ph) * 1.1;
        u.wings[0].rotation.y = flap; u.wings[1].rotation.y = -flap;
      }
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

    // regrow felled trees after a while (reuse the slot so net indices stay valid)
    for (let i = world._treeRegrow.length - 1; i >= 0; i--) {
      const r = world._treeRegrow[i];
      r.t += dt;
      if (r.t >= 75) {
        const nt = makeTree(r.big);
        nt.position.set(r.x, world.heightAt(r.x, r.z) - 0.1, r.z);
        nt.rotation.y = U.rand(0, Math.PI * 2);
        world.scene.add(nt);
        world.trees[r.idx] = nt;
        world.colliders.push({ x: r.x, z: r.z, r: r.big ? 0.9 : 0.5, ref: nt });
        world._treeRegrow.splice(i, 1);
      }
    }

    // grow planted saplings into full, choppable trees
    for (let i = world._growing.length - 1; i >= 0; i--) {
      const s = world._growing[i];
      s.t += dt;
      const k = Math.min(s.t / s.grow, 1);
      s.group.scale.setScalar(0.08 + k * 0.92);
      if (k >= 1) {
        world.trees.push(s.group);
        world.colliders.push({ x: s.x, z: s.z, r: 0.5, ref: s.group });
        world._growing.splice(i, 1);
      }
    }

    // flicker crafted campfires
    for (const cf of world._extraFires) {
      cf.t += dt;
      const fl = 1 + Math.sin(cf.t * 12) * 0.12 + Math.sin(cf.t * 7.3) * 0.08;
      cf.light.intensity = 2.0 * fl * (world._isNight ? 1.4 : 0.7);
      cf.flames.forEach((f, k) => { f.scale.y = fl + Math.sin(cf.t * (9 + k * 3)) * 0.18; });
    }

    // spin/bob dropped pickups so they're easy to spot
    for (const pk of world.pickups) {
      pk.mesh.rotation.y += dt * 1.6;
      pk.mesh.position.y = world.heightAt(pk.x, pk.z) + 0.6 + Math.sin(world._time * 2) * 0.1;
    }
  };

  // Damage a tree; returns wood gained when it falls (0 otherwise).
  world.chopTree = function (tree, dmg) {
    if (!tree.userData.alive) return 0;
    tree.userData.hp -= (dmg || 10);
    // little shake
    tree.position.x += U.rand(-0.04, 0.04);
    if (tree.userData.hp <= 0) {
      tree.userData.alive = false;
      const idx = world.colliders.findIndex((c) => c.ref === tree);
      if (idx >= 0) world.colliders.splice(idx, 1);
      world._falling.push({ group: tree, t: 0, dir: U.chance(0.5) ? 1 : -1, baseY: tree.position.y });
      const big = tree.userData.big;
      const ti = world.trees.indexOf(tree);              // schedule a sapling to grow back here
      if (ti >= 0) world._treeRegrow.push({ idx: ti, x: tree.position.x, z: tree.position.z, t: 0, big });
      return big ? U.randInt(9, 15) : U.randInt(2, 4);   // giant trees yield much more wood
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
    const Wd = 1.9, H = 1.35, T = 0.18;
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
    // `top` lets the player hop over it; wolves (resolved at ground) still can't pass.
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const top = world.heightAt(x, z) + H;
    for (let t = -Wd / 2; t <= Wd / 2 + 0.01; t += 0.38) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.3, top };
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
    const top = world.heightAt(x, z) + 0.6;       // low enough to hop over
    for (let t = -Wd / 2; t <= Wd / 2 + 0.01; t += 0.4) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.28, top };
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
    const top = world.heightAt(x, z) + 0.78;      // stacked logs you can hop over
    for (let t = -L / 2; t <= L / 2 + 0.01; t += 0.4) {
      const bead = { x: x + cos * t, z: z - sin * t, r: 0.32, top };
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

  // --- Build placement: a green hologram you aim, then click to place --------

  const GHOST_DIMS = {
    barricade: [1.9, 1.35, 0.2], barbed: [1.8, 0.6, 0.2], logs: [1.7, 0.7, 0.5],
    farm: [1.4, 0.14, 1.4], table: [1.4, 0.85, 0.9],
    tent: [3.2, 3.3, 3.6], campfire: [1.5, 0.7, 1.5],
  };

  // A translucent green preview of a buildable, for the placement cursor.
  world.makeGhost = function (kind) {
    const d = GHOST_DIMS[kind] || GHOST_DIMS.table;
    const geo = new THREE.BoxGeometry(d[0], d[1], d[2]);
    const g = new THREE.Group();
    const box = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x16622f, transparent: true, opacity: 0.4, depthWrite: false }));
    box.position.y = d[1] / 2 + 0.03; g.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x3a8f54 }));
    edges.position.copy(box.position); g.add(edges);
    return g;
  };

  // Place a buildable by its craft id (shared by local placement + network sync).
  world.buildById = function (id, x, z, yaw) {
    if (id === '1') world.placeBarricade(x, z, yaw);
    else if (id === '4') world.placeBarbedWire(x, z, yaw);
    else if (id === '5') world.placeLogs(x, z, yaw);
    else if (id === '8') world.placeFarmPlot(x, z);
    else if (id === '9') world.placeCraftTable(x, z, yaw);
    else if (id === 'tent') world.placeTent(x, z, yaw);
    else if (id === 'fire') world.placeCampfire(x, z);
  };

  // A craftable tent for building a base out in the world (sleepable + zippable).
  world.placeTent = function (x, z, yaw) {
    const Wd = 3.2, Dp = 3.6, Hw = 2.2, Rh = 1.1, wallT = 0.1, color = 0xb5853f;
    const tent = new THREE.Group();
    tent.position.set(x, world.heightAt(x, z), z);
    tent.rotation.y = yaw;                              // entrance faces the player
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.04, 0.08, Dp - 0.04),
      new THREE.MeshStandardMaterial({ color: 0x7a5734, roughness: 1, flatShading: true }));
    floor.position.set(0, 0.05, 0); floor.receiveShadow = true; tent.add(floor);
    const lw = new THREE.Mesh(new THREE.BoxGeometry(wallT, Hw, Dp), mat); lw.position.set(-Wd / 2, Hw / 2, 0); lw.castShadow = true;
    const rw = new THREE.Mesh(new THREE.BoxGeometry(wallT, Hw, Dp), mat); rw.position.set(Wd / 2, Hw / 2, 0); rw.castShadow = true;
    const bw = new THREE.Mesh(new THREE.BoxGeometry(Wd, Hw, wallT), mat); bw.position.set(0, Hw / 2, -Dp / 2); bw.castShadow = true;
    tent.add(lw, rw, bw);
    const thetaR = Math.atan2(Wd / 2, Rh), Lr = Math.hypot(Rh, Wd / 2);
    const roofGeo = new THREE.BoxGeometry(wallT, Lr, Dp);
    const lr = new THREE.Mesh(roofGeo, mat); lr.position.set(-Wd / 4, Hw + Rh / 2, 0); lr.rotation.z = -thetaR; lr.castShadow = true;
    const rr = new THREE.Mesh(roofGeo, mat); rr.position.set(Wd / 4, Hw + Rh / 2, 0); rr.rotation.z = thetaR; rr.castShadow = true;
    tent.add(lr, rr);
    const gable = new THREE.Shape();
    gable.moveTo(-Wd / 2, 0); gable.lineTo(Wd / 2, 0); gable.lineTo(0, Rh); gable.lineTo(-Wd / 2, 0);
    const gg = new THREE.ShapeGeometry(gable);
    const gB = new THREE.Mesh(gg, mat); gB.position.set(0, Hw, -Dp / 2); tent.add(gB);
    const gF = new THREE.Mesh(gg, mat); gF.position.set(0, Hw, Dp / 2); tent.add(gF);
    const bed = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.24, 2.0), new THREE.MeshStandardMaterial({ color: 0x5e3f23, roughness: 1 }));
    frame.position.y = 0.18; bed.add(frame);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 1.9), new THREE.MeshStandardMaterial({ color: 0xdcd2bd, roughness: 1, flatShading: true }));
    mattress.position.y = 0.36; bed.add(mattress);
    bed.position.set(-0.5, 0, -0.4); tent.add(bed);
    world.scene.add(tent);
    const addBead = (lx, lz) => {
      const p = new THREE.Vector3(lx, 0, lz).applyQuaternion(tent.quaternion).add(tent.position);
      const b = { x: p.x, z: p.z, r: 0.3 }; world.colliders.push(b); world.tentWalls.push(b);
    };
    for (let s = -Dp / 2; s <= Dp / 2 + 0.01; s += 0.42) { addBead(-Wd / 2, s); addBead(Wd / 2, s); }
    for (let s = -Wd / 2 + 0.42; s <= Wd / 2 - 0.42 + 0.01; s += 0.42) addBead(s, -Dp / 2);
    world.tents.push({ group: tent, x, z, quat: tent.quaternion.clone(), Wd, Dp, Hw, color, zipped: false, flap: null, seam: null, beads: [] });
    return tent;
  };

  // A craftable campfire — makes a new safe-haven (heal/stamina/food) anywhere.
  world.placeCampfire = function (x, z) {
    const fire = new THREE.Group();
    fire.position.set(x, world.heightAt(x, z), z);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7d7f86, roughness: 1, flatShading: true });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const s = new THREE.Mesh(new THREE.IcosahedronGeometry(U.rand(0.16, 0.26), 0), stoneMat); s.position.set(Math.cos(a) * 0.7, 0.08, Math.sin(a) * 0.7); fire.add(s); }
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 1 });
    for (let i = 0; i < 3; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 6), logMat); log.position.set(0, 0.14 + i * 0.02, 0); log.rotation.z = Math.PI / 2; log.rotation.y = i * (Math.PI / 3) + 0.3; log.castShadow = true; fire.add(log); }
    const flames = [];
    [0xff6a18, 0xffab3a, 0xffe07a].forEach((col, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.24 - i * 0.06, 0.75 - i * 0.14, 7), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92, fog: false })); f.position.y = 0.34 + i * 0.04; fire.add(f); flames.push(f); });
    const light = new THREE.PointLight(0xff7a33, 2.0, 22, 1.6); light.position.set(0, 0.9, 0); fire.add(light);
    world.scene.add(fire);
    world.campfires.push({ x, z });
    world._extraFires.push({ flames, light, t: U.rand(0, 5) });
    world.colliders.push({ x, z, r: 0.8 });
    return fire;
  };

  // The bandit boss's hideout: a flickering campfire, ragged tents, loot crates & a red banner.
  world.placeBanditCamp = function (x, z) {
    if (world._banditCamp) {
      world.scene.remove(world._banditCamp);
      const i = world._extraFires.indexOf(world._banditFireEntry);
      if (i >= 0) world._extraFires.splice(i, 1);
    }
    const camp = new THREE.Group();
    const gy = world.heightAt(x, z);
    camp.position.set(x, gy, z);
    const H = (lx, lz) => world.heightAt(x + lx, z + lz) - gy;

    // campfire (flickers via _extraFires, but is NOT a player safe-haven)
    const fire = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 1, flatShading: true });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const s = new THREE.Mesh(new THREE.IcosahedronGeometry(U.rand(0.16, 0.24), 0), stoneMat); s.position.set(Math.cos(a) * 0.6, 0.08, Math.sin(a) * 0.6); s.castShadow = true; fire.add(s); }
    const logMat = new THREE.MeshStandardMaterial({ color: 0x33240f, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.85, 6), logMat); log.position.set(Math.cos(a) * 0.18, 0.36, Math.sin(a) * 0.18); log.rotation.x = Math.sin(a) * 0.6; log.rotation.z = -Math.cos(a) * 0.6; fire.add(log); }
    const flames = [];
    [0xff5212, 0xffab2e, 0xffd86a].forEach((col, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.05, 0.72 - i * 0.13, 7), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92, fog: false })); f.position.y = 0.3 + i * 0.04; fire.add(f); flames.push(f); });
    const light = new THREE.PointLight(0xff7a33, 1.8, 18, 1.8); light.position.set(0, 0.9, 0); fire.add(light);
    camp.add(fire);
    const fireEntry = { flames, light, t: U.rand(0, 5) };
    world._extraFires.push(fireEntry); world._banditFireEntry = fireEntry;

    // ragged tents around the fire
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6, r = 4.2;
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r;
      const t = new THREE.Group(); t.position.set(tx, H(tx, tz), tz);
      const Wd = 2.2, Hd = 1.7, theta = Math.atan2(Wd / 2, Hd), L = Math.hypot(Hd, Wd / 2);
      const panel = new THREE.BoxGeometry(0.06, L, 2.6);
      const left = new THREE.Mesh(panel, canvasMat); left.position.set(-Wd / 4, Hd / 2, 0); left.rotation.z = -theta; left.castShadow = true;
      const right = new THREE.Mesh(panel, canvasMat); right.position.set(Wd / 4, Hd / 2, 0); right.rotation.z = theta; right.castShadow = true;
      t.add(left, right); t.rotation.y = a; camp.add(t);
    }

    // loot crates strewn about
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const a = U.rand(0, Math.PI * 2), r = U.rand(1.6, 3.4), cxp = Math.cos(a) * r, czp = Math.sin(a) * r, sz = U.rand(0.4, 0.6);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), crateMat);
      crate.position.set(cxp, H(cxp, czp) + sz / 2, czp); crate.rotation.y = U.rand(0, 3); crate.castShadow = true; camp.add(crate);
    }

    // a red bandit banner on a pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3, 6), new THREE.MeshStandardMaterial({ color: 0x352616, roughness: 1 }));
    pole.position.set(2.4, H(2.4, -2.2) + 1.5, -2.2); pole.castShadow = true; camp.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), new THREE.MeshStandardMaterial({ color: 0x8a2b2b, roughness: 1, side: THREE.DoubleSide }));
    flag.position.set(2.86, H(2.4, -2.2) + 2.55, -2.2); camp.add(flag);

    world.scene.add(camp);
    world._banditCamp = camp;
    world.banditCampPos = { x, z };
  };

  // Drop a sawed-off shotgun pickup at a spot (left by the slain bandit).
  world.dropShotgun = function (x, z) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.4, metalness: 0.5 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), metal); barrel.position.z = 0.2; g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.34), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 })); stock.position.z = -0.2; g.add(stock);
    g.position.set(x, world.heightAt(x, z) + 0.6, z);
    world.scene.add(g);
    world.pickups.push({ x, z, mesh: g, kind: 'shotgun' });
    return g;
  };

  // Grab the nearest shotgun pickup within range (removes it). Returns true if taken.
  world.takeShotgunNear = function (pos, range) {
    for (let i = 0; i < world.pickups.length; i++) {
      const pk = world.pickups[i];
      if (pk.kind === 'shotgun' && U.dist2(pos.x, pos.z, pk.x, pk.z) < range) {
        world.scene.remove(pk.mesh); world.pickups.splice(i, 1); return true;
      }
    }
    return false;
  };

  // Crafting only works near a workbench.
  world.nearCraftTable = function (pos, range) {
    return world.craftTables.some((t) => U.dist2(pos.x, pos.z, t.x, t.z) < (range || 3.5));
  };

  // Plant a sapling that grows into a choppable tree over ~22s.
  world.plantSapling = function (x, z) {
    const tree = makeTree(false);
    tree.position.set(x, world.heightAt(x, z) - 0.1, z);
    tree.rotation.y = U.rand(0, Math.PI * 2);
    tree.scale.setScalar(0.08);
    world.scene.add(tree);
    world._growing.push({ group: tree, x, z, t: 0, grow: 22 });
    return tree;
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
  // feetY (optional): when given, low obstacles with a `top` are skipped if you're above them (jumping over).
  world.resolveCollision = function (pos, radius, feetY) {
    for (const c of world.colliders) {
      if (c.top !== undefined && feetY !== undefined && feetY > c.top) continue;
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
