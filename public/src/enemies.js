/* Enemy manager. Two nocturnal foes: Wolf and Werewolf.
   Both spawn only at night and burn off at dawn. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;

  const enemies = {
    list: [],
    _dying: [],
    spawnTimer: 0,
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
    const legGeo = new THREE.BoxGeometry(0.2, 0.9, 0.2);
    for (const sx of [-0.16, 0.16]) { const leg = new THREE.Mesh(legGeo, cloth); leg.position.set(sx, 0.5, 0); leg.castShadow = true; g.add(leg); legs.push(leg); }
    const armGeo = new THREE.BoxGeometry(0.16, 0.72, 0.16);
    for (const sx of [-0.36, 0.36]) { const arm = new THREE.Mesh(armGeo, skin); arm.position.set(sx, 1.4, 0.34); arm.rotation.x = -1.45; arm.castShadow = true; g.add(arm); legs.push(arm); }
    g.userData = { type: 'enemy', kind: 'zombie', legs, mat: cloth, eyeMat };
    return g;
  }

  // Build a foe of the given kind and cache each limb's base rotation for the gait.
  function buildModel(kind) {
    const g = kind === 'werewolf' ? makeWerewolf() : kind === 'zombie' ? makeZombie() : makeWolf();
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

    const stats = {
      wolf: { hp: 3, speed: U.rand(2.6, 3.4) + dayNum * 0.1, dmg: 5 + Math.floor(dayNum * 0.5) },
      werewolf: { hp: 7 + dayNum, speed: U.rand(3.0, 3.7) + dayNum * 0.12, dmg: 10 + dayNum },
      zombie: { hp: 5 + dayNum, speed: U.rand(1.6, 2.2) + dayNum * 0.06, dmg: 7 + Math.floor(dayNum * 0.5) },
    }[kind];
    enemies.list.push({ id, group: g, kind, alive: true, hp: stats.hp, speed: stats.speed, dmg: stats.dmg, lastAttack: -99, t: U.rand(0, 10) });
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

  // Host/solo simulation. targets: [{ pos, onBite(dmg) }] — the nearest is hunted.
  enemies.update = function (dt, isNight, dayNum, targets) {
    const center = targets[0] ? targets[0].pos : { x: 0, z: 0 };
    enemies.spawnTimer -= dt;
    const cap = Math.min(3 + dayNum * 2, 16) + (targets.length - 1) * 4;
    if (isNight && enemies.list.length < cap && enemies.spawnTimer <= 0) {
      enemies.spawn(center, dayNum);
      enemies.spawnTimer = U.rand(0.7, 1.9);
    }
    if (!isNight) {
      for (const e of enemies.list.slice()) {
        if (e.alive && U.chance(dt * 0.8)) enemies.kill(e);
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
      g.rotation.y = Math.atan2(dx, dz);

      const reach = e.kind === 'werewolf' ? 1.9 : (e.kind === 'zombie' ? 1.6 : 1.4);
      if (d > reach) {
        const nx = dx / d, nz = dz / d;
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
      } else if (e.t - e.lastAttack > 1.0 &&
                 !W.world.wallBetween(g.position.x, g.position.z, tgt.pos.x, tgt.pos.z)) {
        e.lastAttack = e.t;
        tgt.onBite(e.dmg);
        g.position.x -= (dx / d) * 0.3;
        g.position.z -= (dz / d) * 0.3;
      }
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(e.t * 10)) * 0.05;
    }
    animateDying(dt);
  };

  // --- Networking (host serialize / client mirror) ---------------------------

  enemies.serialize = function () {
    return enemies.list.map((e) => ({
      id: e.id, k: e.kind === 'werewolf' ? 1 : e.kind === 'zombie' ? 2 : 0,
      x: +e.group.position.x.toFixed(2), z: +e.group.position.z.toFixed(2),
      r: +e.group.rotation.y.toFixed(2),
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
        const kind = s.k === 2 ? 'zombie' : s.k === 1 ? 'werewolf' : 'wolf';
        const g = buildModel(kind);
        g.userData.id = s.id; g.position.set(s.x, 0, s.z);
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
