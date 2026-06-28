/* Enemy manager. Two nocturnal foes: Wolf and Werewolf.
   Both spawn only at night and burn off at dawn. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;

  const enemies = {
    list: [],
    _dying: [],
    spawnTimer: 0,
    boss: null,
    bossTimer: 10,     // first bandit boss appears ~10s in
  };

  // --- Models ---------------------------------------------------------------

  const WOLF_FUR = ['#6b6f76', '#565b62', '#7a7e84', '#4f5358'];
  const WERE_FUR = ['#39323f', '#2b2730', '#352c34', '#241f2a'];

  // Four-legged grey wolf.
  function makeWolf() {
    const g = new THREE.Group();
    const fur = WOLF_FUR[U.randInt(0, WOLF_FUR.length - 1)];
    const mat = new THREE.MeshStandardMaterial({ color: fur, roughness: 1, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 1.25), mat);
    body.position.y = 0.66; body.castShadow = true; g.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), mat);
    head.position.set(0, 0.82, 0.74); head.castShadow = true; g.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), mat);
    snout.position.set(0, 0.74, 1.0); g.add(snout);

    // pointed ears
    for (const sx of [-0.14, 0.14]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), mat);
      ear.position.set(sx, 1.05, 0.66); g.add(ear);
    }

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffc019, emissiveIntensity: 1.5 });
    for (const sx of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
      eye.position.set(sx, 0.9, 0.96); g.add(eye);
    }

    const legGeo = new THREE.BoxGeometry(0.15, 0.5, 0.15);
    const legs = [];
    for (const [lx, lz] of [[-0.22, 0.42], [0.22, 0.42], [-0.22, -0.42], [0.22, -0.42]]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, 0.26, lz); leg.castShadow = true; g.add(leg); legs.push(leg);
    }

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.5), mat);
    tail.position.set(0, 0.72, -0.8); tail.rotation.x = -0.4; g.add(tail);

    g.userData = { type: 'enemy', kind: 'wolf', legs, mat, eyeMat };
    return g;
  }

  // Taller, bipedal werewolf.
  function makeWerewolf() {
    const g = new THREE.Group();
    const fur = WERE_FUR[U.randInt(0, WERE_FUR.length - 1)];
    const mat = new THREE.MeshStandardMaterial({ color: fur, roughness: 1, flatShading: true });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.55), mat);
    torso.position.y = 1.5; torso.rotation.x = 0.12; torso.castShadow = true; g.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.6), mat);
    chest.position.set(0, 1.95, 0.05); chest.castShadow = true; g.add(chest);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.set(0, 2.35, 0.12); head.castShadow = true; g.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.3), mat);
    snout.position.set(0, 2.28, 0.4); g.add(snout);

    for (const sx of [-0.16, 0.16]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), mat);
      ear.position.set(sx, 2.66, 0.04); g.add(ear);
    }

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3322, emissive: 0xff1a0c, emissiveIntensity: 1.8 });
    for (const sx of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), eyeMat);
      eye.position.set(sx, 2.42, 0.36); g.add(eye);
    }

    // limbs: [leftLeg, rightLeg, leftArm, rightArm] for a diagonal gait
    const legs = [];
    const legGeo = new THREE.BoxGeometry(0.22, 1.0, 0.22);
    for (const sx of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx, 0.55, 0); leg.castShadow = true; g.add(leg); legs.push(leg);
    }
    const armGeo = new THREE.BoxGeometry(0.2, 0.9, 0.2);
    for (const sx of [-0.5, 0.5]) {
      const arm = new THREE.Mesh(armGeo, mat);
      arm.position.set(sx, 1.55, 0.1); arm.castShadow = true; g.add(arm); legs.push(arm);
    }

    g.userData = { type: 'enemy', kind: 'werewolf', legs, mat, eyeMat };
    return g;
  }

  // Slow, shambling zombie (arms outstretched).
  function makeZombie() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x6f8a55, roughness: 1, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x39414a, roughness: 1, flatShading: true });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.42), cloth);
    torso.position.y = 1.1; torso.rotation.x = 0.14; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
    head.position.set(0, 1.7, 0.1); head.rotation.x = 0.15; head.castShadow = true; g.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0e160e, emissive: 0x2a5a2a, emissiveIntensity: 0.9 });
    for (const sx of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
      eye.position.set(sx, 1.74, 0.29); g.add(eye);
    }
    // limbs: [leftLeg, rightLeg, leftArm, rightArm] — arms held out front
    const legs = [];
    const legGeo = new THREE.BoxGeometry(0.22, 0.6, 0.22);   // shorter, stockier legs
    for (const sx of [-0.16, 0.16]) { const leg = new THREE.Mesh(legGeo, cloth); leg.position.set(sx, 0.3, 0); leg.castShadow = true; g.add(leg); legs.push(leg); }
    const armGeo = new THREE.BoxGeometry(0.16, 0.72, 0.16);
    for (const sx of [-0.36, 0.36]) { const arm = new THREE.Mesh(armGeo, skin); arm.position.set(sx, 1.4, 0.34); arm.rotation.x = -1.45; arm.castShadow = true; g.add(arm); legs.push(arm); }
    g.userData = { type: 'enemy', kind: 'zombie', legs, mat: cloth, eyeMat };
    return g;
  }

  // The bandit boss: a tall outlaw in a coat & hat, shotgun in hand.
  function makeBandit() {
    const g = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 1, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 1, flatShading: true });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.3, 0.55), coat);
    torso.position.y = 1.8; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), skin);
    head.position.set(0, 2.62, 0); head.castShadow = true; g.add(head);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.54), new THREE.MeshStandardMaterial({ color: 0x8a2b2b, roughness: 1 }));
    mask.position.set(0, 2.52, 0.01); g.add(mask);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 10), dark); brim.position.set(0, 2.88, 0); g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.36, 10), dark); crown.position.set(0, 3.07, 0); g.add(crown);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xaa6600, emissiveIntensity: 1.0 });
    for (const sx of [-0.13, 0.13]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), eyeMat); e.position.set(sx, 2.68, 0.27); g.add(e); }
    const legs = [];
    const legGeo = new THREE.BoxGeometry(0.28, 1.2, 0.28);
    for (const sx of [-0.23, 0.23]) { const l = new THREE.Mesh(legGeo, dark); l.position.set(sx, 0.6, 0); l.castShadow = true; g.add(l); legs.push(l); }
    const armGeo = new THREE.BoxGeometry(0.24, 1.05, 0.24);
    for (const sx of [-0.54, 0.54]) { const a = new THREE.Mesh(armGeo, coat); a.position.set(sx, 1.78, 0.06); a.castShadow = true; g.add(a); legs.push(a); }
    // sawed-off shotgun in the right hand
    const gun = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.4, metalness: 0.5 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.6), metal); barrel.position.z = 0.28; gun.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 })); stock.position.z = -0.12; gun.add(stock);
    gun.position.set(0.6, 1.6, 0.35); gun.rotation.x = 0.12; g.add(gun);
    g.userData = { type: 'enemy', kind: 'bandit', legs, mat: coat, eyeMat };
    return g;
  }

  // A regular bandit / bodyguard — human-sized outlaw with a bandana, hat & revolver.
  function makeOutlaw() {
    const g = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33291c, roughness: 1, flatShading: true });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.4), shirt);
    torso.position.y = 1.2; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
    head.position.set(0, 1.85, 0); head.castShadow = true; g.add(head);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.44), new THREE.MeshStandardMaterial({ color: 0x9a3030, roughness: 1 }));
    mask.position.set(0, 1.78, 0.01); g.add(mask);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 8), dark); brim.position.set(0, 2.07, 0); g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.24, 8), dark); crown.position.set(0, 2.2, 0); g.add(crown);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x201810, roughness: 0.5 });
    for (const sx of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat); e.position.set(sx, 1.9, 0.21); g.add(e); }
    const legs = [];
    const legGeo = new THREE.BoxGeometry(0.2, 0.85, 0.2);
    for (const sx of [-0.16, 0.16]) { const l = new THREE.Mesh(legGeo, dark); l.position.set(sx, 0.42, 0); l.castShadow = true; g.add(l); legs.push(l); }
    const armGeo = new THREE.BoxGeometry(0.16, 0.75, 0.16);
    for (const sx of [-0.4, 0.4]) { const a = new THREE.Mesh(armGeo, shirt); a.position.set(sx, 1.22, 0.04); a.castShadow = true; g.add(a); legs.push(a); }
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.4 }));
    gun.position.set(0.42, 1.0, 0.18); g.add(gun);
    g.userData = { type: 'enemy', kind: 'outlaw', legs, mat: shirt, eyeMat };
    return g;
  }

  // A long rifle held across the chest — given to some outlaws so they snipe.
  function giveRifle(g) {
    if (!g || g.userData.hasRifle) return;
    const r = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x42454a, roughness: 0.4, metalness: 0.5 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 1.05), metal); barrel.position.z = 0.42; r.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.4), wood); stock.position.z = -0.16; r.add(stock);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.18), metal); scope.position.set(0, 0.08, 0.2); r.add(scope);
    r.position.set(0.26, 1.18, 0.18); r.rotation.y = -0.06;
    g.add(r); g.userData.hasRifle = true;
  }
  enemies._giveRifle = giveRifle;

  // A drawn sword held out to the side — given to the melee bandits.
  function giveSword(g) {
    if (!g || g.userData.hasSword) return;
    const s = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.5, metalness: 0.4 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.02), steel); blade.position.y = 0.5; s.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), steel); tip.position.y = 0.98; s.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), brass); guard.position.y = 0.12; s.add(guard);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), grip); handle.position.y = 0.02; s.add(handle);
    s.position.set(0.46, 1.0, 0.16); s.rotation.set(-0.5, 0, -0.2);   // held out, blade forward
    g.add(s); g.userData.hasSword = true;
  }
  enemies._giveSword = giveSword;

  // A big brown bear — tough, fast, and hunts day & night.
  function makeBear() {
    const g = new THREE.Group();
    const fur = ['#5a3f28', '#4a3320', '#6b4a2f'][U.randInt(0, 2)];
    const mat = new THREE.MeshStandardMaterial({ color: fur, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 1.7), mat);
    body.position.y = 0.95; body.castShadow = true; g.add(body);
    const hump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.6), mat);
    hump.position.set(0, 1.42, 0.3); g.add(hump);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.58, 0.6), mat);
    head.position.set(0, 1.2, 1.0); head.castShadow = true; g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.32), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }));
    snout.position.set(0, 1.12, 1.35); g.add(snout);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x140f0a }));
    nose.position.set(0, 1.18, 1.5); g.add(nose);
    for (const sx of [-0.2, 0.2]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 7), mat); ear.position.set(sx, 1.52, 0.92); ear.castShadow = true; g.add(ear); }
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x180f08, emissive: 0x301008, emissiveIntensity: 0.6 });
    for (const sx of [-0.16, 0.16]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat); e.position.set(sx, 1.3, 1.28); g.add(e); }
    const legGeo = new THREE.BoxGeometry(0.26, 0.72, 0.26);
    const legs = [];
    for (const [lx, lz] of [[-0.32, 0.6], [0.32, 0.6], [-0.32, -0.6], [0.32, -0.6]]) {
      const l = new THREE.Mesh(legGeo, mat); l.position.set(lx, 0.36, lz); l.castShadow = true; g.add(l); legs.push(l);
    }
    g.userData = { type: 'enemy', kind: 'bear', legs, mat, eyeMat };
    return g;
  }

  // Build a foe of the given kind and cache each limb's base rotation for the gait.
  function buildModel(kind) {
    const g = kind === 'werewolf' ? makeWerewolf() : kind === 'zombie' ? makeZombie()
      : kind === 'bandit' ? makeBandit() : kind === 'outlaw' ? makeOutlaw()
      : kind === 'bear' ? makeBear() : makeWolf();
    g.userData.legBases = g.userData.legs.map((l) => l.rotation.x);
    return g;
  }

  // --- Lifecycle ------------------------------------------------------------

  let _nextId = 1;

  enemies.init = function (scene) { enemies.scene = scene; };

  enemies.spawn = function (centerPos, dayNum) {
    const ring = U.rand(26, 42);
    const a = U.rand(0, Math.PI * 2);
    const x = centerPos.x + Math.cos(a) * ring;
    const z = centerPos.z + Math.sin(a) * ring;

    // Wolves are the staple; werewolves & zombies grow more common with depth.
    const roll = U.random();
    const zChance = U.clamp(0.18 + (dayNum - 1) * 0.05, 0, 0.5);
    const wChance = U.clamp(0.08 + (dayNum - 1) * 0.05, 0, 0.35);
    const kind = roll < zChance ? 'zombie' : roll < zChance + wChance ? 'werewolf' : 'wolf';

    const g = buildModel(kind);
    g.position.set(x, W.world.heightAt(x, z), z);
    g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++;
    g.userData.id = id;

    // foes grow tankier, faster and hit harder every night
    const stats = {
      wolf: { hp: 3 + Math.floor(dayNum * 0.7), speed: U.rand(2.6, 3.4) + dayNum * 0.14, dmg: 5 + dayNum },
      werewolf: { hp: 7 + dayNum * 2, speed: U.rand(3.0, 3.7) + dayNum * 0.16, dmg: 10 + Math.floor(dayNum * 1.5) },
      zombie: { hp: 5 + Math.floor(dayNum * 1.5), speed: U.rand(1.6, 2.2) + dayNum * 0.09, dmg: 7 + dayNum },
    }[kind];
    enemies.list.push({ id, group: g, kind, alive: true, hp: stats.hp, speed: stats.speed, dmg: stats.dmg, lastAttack: -99, t: U.rand(0, 10) });
  };

  // The bandit boss: spawns very far away, roams day & night, drops a shotgun.
  enemies.spawnBoss = function (center) {
    const a = U.rand(0, Math.PI * 2);
    const dist = U.rand(W.CONFIG.WORLD_RADIUS * 0.6, W.CONFIG.WORLD_RADIUS * 0.72);   // an epic expedition away
    const x = center.x + Math.cos(a) * dist, z = center.z + Math.sin(a) * dist;
    const g = buildModel('bandit');
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    const e = { id, group: g, kind: 'bandit', alive: true, hp: 55, speed: 3.0, dmg: 16, lastAttack: -99, t: 0, isBoss: true, summonCD: 8, shootCD: 3 };
    enemies.list.push(e); enemies.boss = e;
    if (W.world.placeBanditCamp) W.world.placeBanditCamp(x, z);   // a hideout at his spawn
    for (let i = 0; i < 3; i++) enemies.spawnGuard(e);   // starts with a few bodyguards
    if (W.hud) W.hud.banner('A BANDIT BOSS ROAMS', 'Guarded by his gang — hunt him for his shotgun 🔫', '#ffb24a');
  };

  // A bodyguard outlaw that orbits and protects a given boss.
  enemies.spawnGuard = function (boss) {
    const a = U.rand(0, Math.PI * 2), r = U.rand(2.5, 4.5);
    const x = boss.group.position.x + Math.cos(a) * r, z = boss.group.position.z + Math.sin(a) * r;
    const g = buildModel('outlaw');
    const rifle = U.chance(0.4);                 // ~40% of guards carry rifles
    if (rifle) giveRifle(g); else giveSword(g);
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    enemies.list.push({ id, group: g, kind: 'outlaw', alive: true, hp: 12, speed: 3.3, dmg: rifle ? 9 : 13, lastAttack: -99, t: U.rand(0, 5), guard: boss, rifle, sword: !rifle, shootCD: U.rand(1.5, 3) });
  };

  // Keep tougher foes (bears & bandits) at least 200m from the home camp.
  function farFromCamp(x, z) {
    const cp = W.world.campPos || { x: 0, z: 0 };
    return Math.hypot(x - cp.x, z - cp.z) >= 200;
  }

  // A bear that prowls the woods and hunts day & night.
  enemies.spawnBear = function (center, dayNum) {
    const ring = U.rand(28, 48), a = U.rand(0, Math.PI * 2);
    const x = center.x + Math.cos(a) * ring, z = center.z + Math.sin(a) * ring;
    if (!farFromCamp(x, z)) return;              // no bears near camp
    const g = buildModel('bear');
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    enemies.list.push({ id, group: g, kind: 'bear', alive: true, hp: (16 + dayNum * 2) * 3, speed: U.rand(3.2, 3.9), dmg: 12 + dayNum, lastAttack: -99, t: U.rand(0, 5) });
  };

  // A free-roaming bandit out in the desert (day & night).
  enemies.spawnDesertBandit = function (center) {
    const ring = U.rand(22, 40), a = U.rand(0, Math.PI * 2);
    const x = center.x + Math.cos(a) * ring, z = center.z + Math.sin(a) * ring;
    if (!farFromCamp(x, z)) return;              // no bandits near camp
    const g = buildModel('outlaw');
    const rifle = U.chance(0.5);                 // desert snipers: half carry rifles
    if (rifle) giveRifle(g); else giveSword(g);
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    enemies.list.push({ id, group: g, kind: 'outlaw', alive: true, hp: 10, speed: 3.0, dmg: rifle ? 8 : 11, lastAttack: -99, t: U.rand(0, 5), rifle, sword: !rifle, shootCD: U.rand(1.5, 3) });
  };

  // A raider that storms the home camp (day 8+ nightly raids).
  enemies.spawnRaider = function (dayNum, target) {
    const cp = target || W.world.campPos || { x: 0, z: 0 };
    const a = U.rand(0, Math.PI * 2), r = U.rand(16, 30);
    const x = cp.x + Math.cos(a) * r, z = cp.z + Math.sin(a) * r;
    const g = buildModel('outlaw');
    const rifle = U.chance(0.35);
    if (rifle) giveRifle(g); else giveSword(g);
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a + Math.PI;   // face the target
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    enemies.list.push({ id, group: g, kind: 'outlaw', alive: true, hp: 12 + dayNum, speed: 3.2,
      dmg: rifle ? 9 : 13, lastAttack: -99, t: U.rand(0, 5), raider: true, rifle, sword: !rifle, shootCD: U.rand(1.5, 3) });
  };

  // A HUGE raid on the village — a horde of bandits descends all at once.
  enemies.summonVillageRaid = function (dayNum) {
    const vp = W.world.villagePos; if (!vp) return;
    const n = 18 + dayNum * 2;
    for (let i = 0; i < n; i++) enemies.spawnRaider(dayNum, vp);
    if (W.hud && W.hud.banner) W.hud.banner('⚔ HUGE BANDIT RAID!', 'A horde descends on the village — hold the line!', '#ff3a2a');
  };

  // A roaming bandit patrol: a small armed group that prowls the wilds day & night.
  enemies.spawnPatrol = function (center, dayNum) {
    const a = U.rand(0, Math.PI * 2), r = U.rand(55, 90);
    const bx = center.x + Math.cos(a) * r, bz = center.z + Math.sin(a) * r;
    if (!farFromCamp(bx, bz)) return;                       // not right on the home camp
    const n = U.randInt(2, 4);
    for (let i = 0; i < n; i++) {
      const ox = bx + U.rand(-4, 4), oz = bz + U.rand(-4, 4);
      const g = buildModel('outlaw');
      const rifle = U.chance(0.4);
      if (rifle) giveRifle(g); else giveSword(g);
      g.position.set(ox, W.world.heightAt(ox, oz), oz); g.rotation.y = U.rand(0, 6.28);
      enemies.scene.add(g);
      const id = _nextId++; g.userData.id = id;
      enemies.list.push({ id, group: g, kind: 'outlaw', alive: true, hp: 11 + dayNum, speed: 3.1,
        dmg: rifle ? 8 : 12, lastAttack: -99, t: U.rand(0, 5), patrol: true, rifle, sword: !rifle, shootCD: U.rand(1.5, 3) });
    }
  };

  // An outlaw that defends a bandit outpost (spawns when you get close).
  enemies.spawnOutpostGuard = function (o, oi) {
    const a = U.rand(0, Math.PI * 2), r = U.rand(2, 7);
    const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
    const g = buildModel('outlaw');
    const rifle = U.chance(0.45);
    if (rifle) giveRifle(g); else giveSword(g);
    g.position.set(x, W.world.heightAt(x, z), z); g.rotation.y = a;
    enemies.scene.add(g);
    const id = _nextId++; g.userData.id = id;
    enemies.list.push({ id, group: g, kind: 'outlaw', alive: true, hp: 12, speed: 3.1, dmg: rifle ? 9 : 12, lastAttack: -99, t: U.rand(0, 5), outpost: oi, rifle, sword: !rifle, shootCD: U.rand(1.5, 3) });
  };

  // The boss fires its sawed-off shotgun — also a lousy shot, hits maybe 1 in 3.
  enemies.bossShoot = function (e, tgt) {
    const ex = e.group.position.x, ez = e.group.position.z;
    const d = Math.hypot(tgt.pos.x - ex, tgt.pos.z - ez) || 1;
    if (U.chance(0.34)) tgt.onBite(Math.max(6, Math.round(26 - d)));   // close = harder hit
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95, fog: false }));
    const nx = (tgt.pos.x - ex) / d, nz = (tgt.pos.z - ez) / d;
    flash.position.set(ex + nx * 0.8, e.group.position.y + 1.6, ez + nz * 0.8);
    enemies.scene.add(flash);
    setTimeout(() => enemies.scene.remove(flash), 90);
  };

  // A rifle outlaw fires from range — but the bandits have HORRIBLE aim and
  // miss most of their shots (the tracer visibly whizzes wide).
  enemies.rifleShoot = function (e, tgt) {
    const ex = e.group.position.x, ey = e.group.position.y + 1.3, ez = e.group.position.z;
    const d = Math.hypot(tgt.pos.x - ex, tgt.pos.z - ez) || 1;
    const hit = U.chance(0.25);                  // only lands ~1 in 4 shots
    if (hit) tgt.onBite(U.randInt(8, 13));
    // aim toward the target, but spray wide on a miss
    let aimx = tgt.pos.x, aimz = tgt.pos.z;
    if (!hit) { aimx += U.rand(-9, 9); aimz += U.rand(-9, 9); }
    const ax = aimx - ex, az = aimz - ez, ad = Math.hypot(ax, az) || 1;
    const nx = ax / ad, nz = az / ad;
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, fog: false }));
    flash.position.set(ex + nx * 1.0, ey, ez + nz * 1.0);
    enemies.scene.add(flash);
    const len = Math.min(d, 40);
    const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.6, fog: false }));
    tracer.position.set(ex + nx * (len / 2 + 1), ey, ez + nz * (len / 2 + 1));
    tracer.rotation.y = Math.atan2(nx, nz);
    enemies.scene.add(tracer);
    setTimeout(() => { enemies.scene.remove(flash); enemies.scene.remove(tracer); }, 80);
  };

  function applyHit(e, amount, fromPos) {
    e.hp -= amount;
    const mat = e.group.userData.mat;
    if (mat) { const orig = mat.color.getHex(); mat.color.setHex(0xffffff); setTimeout(() => mat.color.setHex(orig), 70); }
    const dx = e.group.position.x - fromPos.x;
    const dz = e.group.position.z - fromPos.z;
    const d = Math.hypot(dx, dz) || 1;
    const kb = e.kind === 'werewolf' ? 0.3 : 0.6;
    e.group.position.x += (dx / d) * kb;
    e.group.position.z += (dz / d) * kb;
    if (e.hp <= 0) { enemies.kill(e); return true; }
    return false;
  }

  // Damage by mesh root (the local player's swing). Returns true if it died.
  // Approx head height (above the enemy's feet) per kind — for headshots.
  const HEAD_Y = { wolf: 0.85, werewolf: 2.4, zombie: 1.72, bandit: 2.62, outlaw: 1.86, bear: 1.2 };
  enemies.headY = function (e) { return HEAD_Y[e && e.kind] || 1.7; };

  enemies.damage = function (rootGroup, amount, fromPos) {
    const e = enemies.list.find((x) => x.group === rootGroup);
    if (!e || !e.alive) return false;
    return applyHit(e, amount, fromPos);
  };

  // Damage by id (a remote player's swing, host-side). Returns true if it died.
  enemies.damageById = function (id, amount, fromPos) {
    const e = enemies.list.find((x) => x.id === id);
    if (!e || !e.alive) return false;
    return applyHit(e, amount, fromPos);
  };

  // Death only — kill credit/rewards are handled by the attacker (see player.creditKill).
  enemies.kill = function (e) {
    e.alive = false;
    const i = enemies.list.indexOf(e);
    if (i >= 0) enemies.list.splice(i, 1);
    enemies._dying.push({ group: e.group, t: 0 });
    if (e.isBoss) {
      enemies.boss = null; enemies.bossTimer = 120;     // a new bandit in ~2 min
      if (W.world.dropShotgun) W.world.dropShotgun(e.group.position.x, e.group.position.z);
      if (W.hud) W.hud.banner('BANDIT DOWN', 'He dropped a sawed-off shotgun 🔫 — grab it (G)', '#8fd36a');
    }
  };

  function animateDying(dt) {
    for (let i = enemies._dying.length - 1; i >= 0; i--) {
      const f = enemies._dying[i];
      f.t += dt;
      const k = U.clamp(f.t / 0.7, 0, 1);
      f.group.rotation.z = k * 1.6;
      f.group.position.y -= dt * 1.2;
      f.group.scale.setScalar(1 - k * 0.6);
      if (k >= 1) { enemies.scene.remove(f.group); enemies._dying.splice(i, 1); }
    }
  }

  // Is any living hostile within `range` of a point? (used to block sleeping)
  enemies.anyHostileNear = function (pos, range) {
    for (const e of enemies.list) {
      if (e.alive && Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z) < range) return true;
    }
    return false;
  };

  // Host/solo simulation. targets: [{ pos, onBite(dmg) }] — the nearest is hunted.
  // --- Village archers: 5 friendly bowmen who guard the village from foes -----
  const A_FWD = new THREE.Vector3(0, 0, -1);
  enemies.archers = [];
  enemies.archerArrows = [];

  function makeArcher() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 1, flatShading: true });
    const hood = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 1, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe2b48c, roughness: 1 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 1 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.32), cloth); torso.position.y = 1.1; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin); head.position.y = 1.68; head.castShadow = true; g.add(head);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.34, 6), hood); cap.position.y = 1.96; g.add(cap);
    for (const sx of [-0.14, 0.14]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.76, 0.19), hood); leg.position.set(sx, 0.38, 0); leg.castShadow = true; g.add(leg); }
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 6, 14, Math.PI * 1.25), wood); bow.position.set(0.3, 1.15, 0.2); bow.rotation.z = Math.PI / 2; g.add(bow);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.14), cloth); arm.position.set(0.3, 1.2, 0.12); g.add(arm);
    g.userData = { type: 'archer' };
    return g;
  }

  enemies.spawnVillageArchers = function () {
    const vp = W.world.villagePos; if (!vp || !enemies.scene) return;
    for (let i = 0; i < 10; i++) {                      // 10 guards ringing the bigger village
      const a = (i / 10) * Math.PI * 2, r = 20;
      const x = vp.x + Math.cos(a) * r, z = vp.z + Math.sin(a) * r;
      const g = makeArcher();
      g.position.set(x, W.world.heightAt(x, z), z);
      enemies.scene.add(g);
      enemies.archers.push({ group: g, x, z, cd: U.rand(0, 1.0) });
    }
    enemies._archersSpawned = true;
  };

  function archerShoot(ar, target) {
    const sy = W.world.heightAt(ar.x, ar.z) + 1.5;
    const tp = target.group.position;
    const dir = new THREE.Vector3(tp.x - ar.x, (tp.y + 1.0) - sy, tp.z - ar.z).normalize();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0xe6c54a, roughness: 0.7 }));
    shaft.rotation.x = Math.PI / 2;
    const arrow = new THREE.Group(); arrow.add(shaft);
    arrow.position.set(ar.x, sy, ar.z);
    arrow.quaternion.setFromUnitVectors(A_FWD, dir.clone());
    enemies.scene.add(arrow);
    enemies.archerArrows.push({ mesh: arrow, vel: dir.multiplyScalar(78), life: 0, dmg: 14 });  // fast, flat, hard-hitting
  }

  function updateArchers(dt) {
    if (!enemies._archersSpawned && W.world.villagePos) enemies.spawnVillageArchers();
    const host = !(W.net && W.net.role === 'client');
    for (const ar of enemies.archers) {
      ar.cd -= dt;
      let best = null, bd = 58 * 58;                   // spot foes from further off
      for (const e of enemies.list) { if (!e.alive) continue; const dx = e.group.position.x - ar.x, dz = e.group.position.z - ar.z; const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = e; } }
      if (best) {
        ar.group.rotation.y = Math.atan2(best.group.position.x - ar.x, best.group.position.z - ar.z);
        if (ar.cd <= 0) { ar.cd = U.rand(0.45, 0.95); archerShoot(ar, best); }   // fire faster
      }
    }
    for (let i = enemies.archerArrows.length - 1; i >= 0; i--) {
      const a = enemies.archerArrows[i]; a.life += dt;
      a.vel.y -= 9.8 * dt * 0.12;                       // flatter trajectory = better aim
      a.mesh.position.addScaledVector(a.vel, dt);
      a.mesh.quaternion.setFromUnitVectors(A_FWD, a.vel.clone().normalize());
      let done = false;
      for (const e of enemies.list) {
        if (!e.alive) continue;
        const ep = e.group.position;
        if (Math.hypot(a.mesh.position.x - ep.x, a.mesh.position.z - ep.z) < 1.4 && a.mesh.position.y > ep.y - 0.3 && a.mesh.position.y < ep.y + 2.6) {
          if (host) enemies.damage(e.group, a.dmg, { x: a.mesh.position.x, z: a.mesh.position.z });
          done = true; break;
        }
      }
      if (done || a.life > 3.5) { enemies.scene.remove(a.mesh); enemies.archerArrows.splice(i, 1); }
    }
  }

  enemies.update = function (dt, isNight, dayNum, targets) {
    const center = targets[0] ? targets[0].pos : { x: 0, z: 0 };
    updateArchers(dt);
    enemies.spawnTimer -= dt;
    // every night gets harder: more foes on the field, and they arrive faster
    const cap = Math.min(4 + dayNum * 3, 45) + (targets.length - 1) * 5;
    if (isNight && enemies.list.length < cap && enemies.spawnTimer <= 0) {
      enemies.spawn(center, dayNum);
      enemies.spawnTimer = Math.max(0.25, U.rand(0.7, 1.9) - dayNum * 0.07);
    }
    // from day 8, bandits raid the home camp once per night (bigger waves on later days)
    if (dayNum >= 8 && isNight && enemies._lastRaidDay !== dayNum) {
      enemies._lastRaidDay = dayNum;
      const wave = 3 + Math.floor((dayNum - 8) / 2);
      for (let i = 0; i < wave; i++) enemies.spawnRaider(dayNum, W.world.campPos);          // raid the home camp
      if (W.world.villagePos) for (let i = 0; i < wave; i++) enemies.spawnRaider(dayNum, W.world.villagePos); // and the village (archers defend it)
      if (W.hud && W.hud.banner) W.hud.banner('⚔ BANDIT RAID', 'Bandits are storming the camp & village!', '#ff6a4a');
    }
    // roaming bandit patrols prowl the wilds — and converge on the village when you're there
    enemies.patrolTimer = (enemies.patrolTimer || 0) - dt;
    const patrolBandits = enemies.list.filter((e) => e.kind === 'outlaw' && e.patrol && e.alive).length;
    const vp = W.world.villagePos;
    const atVillage = vp && Math.hypot(center.x - vp.x, center.z - vp.z) < 75;
    if (patrolBandits < (atVillage ? 10 : 6) && enemies.patrolTimer <= 0) {
      enemies.spawnPatrol(atVillage ? vp : center, dayNum);     // attack the village when you're defending it
      enemies.patrolTimer = atVillage ? U.rand(5, 11) : U.rand(16, 30);
    }
    // linger at the village a full day & night and the bandits muster a HUGE raid
    const DAYLEN = (W.CONFIG && W.CONFIG.DAY_LENGTH) || 420;
    if (atVillage) {
      enemies._villageStay = (enemies._villageStay || 0) + dt;
      if (enemies._villageStay >= DAYLEN) { enemies._villageStay = 0; enemies.summonVillageRaid(dayNum); }
    } else {
      enemies._villageStay = 0;                                 // leaving resets the buildup
    }
    // keep exactly one bandit boss prowling the map (respawns a while after death)
    if (!enemies.boss || !enemies.boss.alive) {
      enemies.bossTimer -= dt;
      if (enemies.bossTimer <= 0) { enemies.spawnBoss(center); enemies.bossTimer = 1e9; }
    }
    // free-roaming bandits patrol the desert, day & night
    enemies.desertTimer = (enemies.desertTimer || 0) - dt;
    const wildOutlaws = enemies.list.filter((e) => e.kind === 'outlaw' && !e.guard && e.alive).length;
    if (W.world.desertAt(center.x, center.z) > 0.4 && wildOutlaws < 6 && enemies.desertTimer <= 0) {
      enemies.spawnDesertBandit(center);
      enemies.desertTimer = U.rand(2.5, 5);
    }
    // bears prowl the woods/grassland, day & night
    enemies.bearTimer = (enemies.bearTimer || 0) - dt;
    const bears = enemies.list.filter((e) => e.kind === 'bear' && e.alive).length;
    if (W.world.desertAt(center.x, center.z) < 0.5 && bears < 4 && enemies.bearTimer <= 0) {
      enemies.spawnBear(center, dayNum);
      enemies.bearTimer = U.rand(8, 16);
    }
    // bandit outposts post guards that defend them when you come near
    if (W.world.outposts && W.world.outposts.length) {
      enemies.outpostTimer = (enemies.outpostTimer || 0) - dt;
      if (enemies.outpostTimer <= 0) {
        for (let oi = 0; oi < W.world.outposts.length; oi++) {
          const o = W.world.outposts[oi];
          if (Math.hypot(center.x - o.x, center.z - o.z) > 60) continue;
          const guards = enemies.list.filter((x) => x.outpost === oi && x.alive).length;
          if (guards < 4) enemies.spawnOutpostGuard(o, oi);
        }
        enemies.outpostTimer = U.rand(1.2, 2.2);
      }
    }
    if (!isNight) {
      for (const e of enemies.list.slice()) {
        // wolves/zombies burn off at dawn; bandits, outlaws & bears roam day & night
        if (e.alive && e.kind !== 'bandit' && e.kind !== 'outlaw' && e.kind !== 'bear' && U.chance(dt * 0.8)) enemies.kill(e);
      }
    }

    for (const e of enemies.list) {
      if (!e.alive) continue;
      e.t += dt;
      const g = e.group;
      let tgt = targets[0], bestD = 1e9;
      for (const t of targets) {
        const dd = Math.hypot(t.pos.x - g.position.x, t.pos.z - g.position.z);
        if (dd < bestD) { bestD = dd; tgt = t; }
      }
      const dx = tgt.pos.x - g.position.x;
      const dz = tgt.pos.z - g.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = e.kind === 'werewolf' ? 1.9 : (e.kind === 'zombie' ? 1.6 : (e.kind === 'bandit' ? 2.2 : (e.kind === 'outlaw' ? 1.8 : (e.kind === 'bear' ? 2.0 : 1.4))));

      // Bandit boss: summon more bodyguards + fire its shotgun from range
      if (e.isBoss) {
        e.summonCD -= dt;
        const guards = enemies.list.filter((x) => x.kind === 'outlaw' && x.guard === e && x.alive).length;
        if (e.summonCD <= 0 && bestD < 70 && guards < 6) {
          enemies.spawnGuard(e); enemies.spawnGuard(e);
          e.summonCD = U.rand(11, 17);
          if (W.hud) W.hud.toast('The bandit whistles up more guards! 🤠');
        }
        e.shootCD -= dt;
        if (e.shootCD <= 0 && bestD > reach && bestD < 24 &&
            !W.world.wallBetween(g.position.x, g.position.z, tgt.pos.x, tgt.pos.z)) {
          e.shootCD = U.rand(1.8, 2.8);
          enemies.bossShoot(e, tgt);
        }
      }

      // bodyguards orbit/protect the boss until the player gets close to it
      let aimX = tgt.pos.x, aimZ = tgt.pos.z, orbiting = false;
      if (e.guard) {
        if (!e.guard.alive) e.guard = null;
        else {
          const bg = e.guard.group.position;
          if (Math.hypot(tgt.pos.x - bg.x, tgt.pos.z - bg.z) > 16) {
            orbiting = true;
            aimX = bg.x + Math.cos(e.t * 0.7 + e.id) * 3.4;
            aimZ = bg.z + Math.sin(e.t * 0.7 + e.id) * 3.4;
          }
        }
      }
      // rifle outlaws snipe the player from long range when they have a clear shot
      if (e.rifle && !orbiting) {
        e.shootCD -= dt;
        if (e.shootCD <= 0 && bestD > reach && bestD < 42 &&
            !W.world.wallBetween(g.position.x, g.position.z, tgt.pos.x, tgt.pos.z)) {
          e.shootCD = U.rand(2.0, 3.2);
          enemies.rifleShoot(e, tgt);
        }
      }

      const adx = aimX - g.position.x, adz = aimZ - g.position.z, ad = Math.hypot(adx, adz) || 1;
      g.rotation.y = Math.atan2(adx, adz);

      if (ad > (orbiting ? 0.6 : reach)) {
        const nx = adx / ad, nz = adz / ad;
        g.position.x += nx * e.speed * dt;
        g.position.z += nz * e.speed * dt;
        const tmp = { x: g.position.x, z: g.position.z };
        W.world.resolveCollision(tmp, 0.5);
        g.position.x = tmp.x; g.position.z = tmp.z;
        const rate = e.kind === 'wolf' ? 12 : (e.kind === 'zombie' ? 5 : 9);
        const swing = Math.sin(e.t * rate) * (e.kind === 'zombie' ? 0.35 : 0.5);
        const legs = g.userData.legs, bb = g.userData.legBases;
        legs[0].rotation.x = bb[0] + swing; legs[3].rotation.x = bb[3] + swing;
        legs[1].rotation.x = bb[1] - swing; legs[2].rotation.x = bb[2] - swing;
      } else if (!orbiting && e.t - e.lastAttack > 1.0 &&
                 !W.world.wallBetween(g.position.x, g.position.z, tgt.pos.x, tgt.pos.z)) {
        e.lastAttack = e.t;
        tgt.onBite(e.dmg);
        g.position.x -= (dx / d) * 0.3;
        g.position.z -= (dz / d) * 0.3;
      }
      // barbed wire / hazards hurt enemies standing on them
      for (const hz of W.world.hazards) {
        if (Math.hypot(g.position.x - hz.x, g.position.z - hz.z) < hz.r) {
          e.hp -= hz.dps * dt;
          if (e.hp <= 0) { enemies.kill(e); break; }
        }
      }
      if (!e.alive) continue;

      const bob = Math.abs(Math.sin(e.t * (e.kind === 'zombie' ? 6 : 11))) * 0.06;
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + bob;
      g.rotation.z = Math.sin(e.t * (e.kind === 'zombie' ? 3 : 8)) * 0.04; // slight sway
    }
    animateDying(dt);
  };

  // --- Networking (host serialize / client mirror) ---------------------------

  enemies.serialize = function () {
    return enemies.list.map((e) => ({
      id: e.id, k: e.kind === 'werewolf' ? 1 : e.kind === 'zombie' ? 2 : e.kind === 'bandit' ? 3 : e.kind === 'outlaw' ? 4 : e.kind === 'bear' ? 5 : 0,
      x: +e.group.position.x.toFixed(2), z: +e.group.position.z.toFixed(2),
      r: +e.group.rotation.y.toFixed(2), rf: e.rifle ? 1 : 0, sw: e.sword ? 1 : 0,
    }));
  };

  // Client: reconcile ghost enemies toward the host's snapshot.
  enemies.applySnapshot = function (arr, dt) {
    enemies._gt = (enemies._gt || 0) + dt;
    const seen = {};
    for (const s of arr) {
      seen[s.id] = true;
      let e = enemies.list.find((x) => x.id === s.id);
      if (!e) {
        const kind = s.k === 5 ? 'bear' : s.k === 4 ? 'outlaw' : s.k === 3 ? 'bandit' : s.k === 2 ? 'zombie' : s.k === 1 ? 'werewolf' : 'wolf';
        const g = buildModel(kind);
        g.userData.id = s.id; g.position.set(s.x, 0, s.z);
        if (s.rf && kind === 'outlaw') giveRifle(g);
        if (s.sw && kind === 'outlaw') giveSword(g);
        enemies.scene.add(g);
        e = { id: s.id, group: g, kind, alive: true };
        enemies.list.push(e);
      }
      const g = e.group;
      const k = Math.min(1, dt * 12);
      g.position.x += (s.x - g.position.x) * k;
      g.position.z += (s.z - g.position.z) * k;
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(enemies._gt * 10)) * 0.05;
      g.rotation.y = s.r;
      const rate = e.kind === 'wolf' ? 12 : (e.kind === 'zombie' ? 5 : 9);
      const swing = Math.sin(enemies._gt * rate) * (e.kind === 'zombie' ? 0.35 : 0.5);
      const legs = g.userData.legs, bb = g.userData.legBases;
      legs[0].rotation.x = bb[0] + swing; legs[3].rotation.x = bb[3] + swing;
      legs[1].rotation.x = bb[1] - swing; legs[2].rotation.x = bb[2] - swing;
    }
    for (const e of enemies.list.slice()) {
      if (!seen[e.id]) {
        const i = enemies.list.indexOf(e); if (i >= 0) enemies.list.splice(i, 1);
        enemies._dying.push({ group: e.group, t: 0 });
      }
    }
    animateDying(dt);
  };

  enemies.clear = function () {
    for (const e of enemies.list) enemies.scene.remove(e.group);
    for (const f of enemies._dying) enemies.scene.remove(f.group);
    enemies.list = []; enemies._dying = [];
  };

  W.enemies = enemies;
})();
