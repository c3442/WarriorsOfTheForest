/* First-person controller: look, movement, stats, axe + attack, eating. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;
  const C = W.CONFIG;

  const player = {
    active: false,
    alive: true,
    health: 100, stamina: 100, hunger: 100, thirst: 100,
    bottle: 5, bottleMax: 5,
    wood: 0, kills: 0,
    yaw: 0, pitch: 0,
    vy: 0, grounded: true,
    lastHurt: -99, lastAttack: -99,
    keys: {},
    _t: 0,
  };

  const SPEED = 5.2, SPRINT = 1.7, GRAV = 20, JUMP = 7.2;
  const ATTACK_CD = 0.45, ATTACK_RANGE = 4.0, ATTACK_DMG = 2;

  player.init = function (camera, dom, scene) {
    player.camera = camera;
    player.dom = dom;
    player.scene = scene;
    camera.rotation.order = 'YXZ';

    const start = { x: 0, z: 4 };
    player.pos = new THREE.Vector3(start.x, W.world.heightAt(start.x, start.z) + C.EYE_HEIGHT, start.z);

    buildAxe(camera);
    buildBottle(camera);

    // --- input (keyboard only): WASD move, arrows look, Q attack, E eat ---
    const PREVENT = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };
    window.addEventListener('keydown', (e) => {
      player.keys[e.code] = true;
      if (PREVENT[e.code]) e.preventDefault();
      if (e.code === 'KeyQ') player.attack();
      if (e.code === 'KeyE') player.eat();
      if (e.code === 'KeyF') player.drink();
    });
    window.addEventListener('keyup', (e) => { player.keys[e.code] = false; });
  };

  function buildAxe(camera) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xaeb6c2, roughness: 0.4, metalness: 0.45 });

    // Handle: hand sits at the group origin (y=0), head at the top (good swing pivot).
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 1.0, 8), wood);
    handle.position.y = 0.5; g.add(handle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), wood);
    knob.position.y = 0.02; g.add(knob);

    // Head assembly at the top of the handle.
    const head = new THREE.Group();
    head.position.y = 0.95;
    head.rotation.y = Math.PI; // blade faces the other way
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.14), metal);   // socket around the handle
    head.add(eye);
    const poll = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), metal); // blunt back
    poll.position.x = -0.11; head.add(poll);

    // Blade: a flat, curved bit that flares out to a cutting edge.
    const shape = new THREE.Shape();
    shape.moveTo(0.05, -0.14);
    shape.lineTo(0.05, 0.16);
    shape.lineTo(0.30, 0.24);
    shape.quadraticCurveTo(0.46, 0, 0.30, -0.24);
    shape.lineTo(0.05, -0.14);
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    bladeGeo.translate(0, 0, -0.025);
    const blade = new THREE.Mesh(bladeGeo, metal);
    head.add(blade);
    g.add(head);

    g.position.set(0.36, -0.52, -0.72);
    g.rotation.set(-0.15, -0.5, 0.2);
    g.scale.setScalar(0.46);
    camera.add(g);
    player.axe = g;
    player.axeRest = g.rotation.clone();
  }

  const BOTTLE_HOME = new THREE.Vector3(-0.42, -0.4, -0.7);
  function buildBottle(camera) {
    const g = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xc6e8ff, transparent: true, opacity: 0.26, roughness: 0.12 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.088, 0.26, 12), glass);
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 10), glass);
    neck.position.y = 0.16; g.add(neck);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }),
    );
    cap.position.y = 0.22; g.add(cap);

    // Water inside, anchored at the bottom so it drains downward as you sip.
    const fullH = 0.23;
    const wGeo = new THREE.CylinderGeometry(0.066, 0.078, fullH, 12);
    wGeo.translate(0, fullH / 2, 0);
    const water = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ color: 0x2f8fd8, transparent: true, opacity: 0.92, roughness: 0.2 }));
    water.position.y = -0.115;
    g.add(water);
    player.bottleWater = water;

    g.position.copy(BOTTLE_HOME);
    g.rotation.set(0, 0.3, 0.12);
    g.scale.setScalar(0.95);
    camera.add(g);
    player.bottle3d = g;
    player.bottleRest = g.rotation.clone();
    updateBottleWater();
  }

  function updateBottleWater() {
    const w = player.bottleWater;
    if (!w) return;
    w.visible = player.bottle > 0;                 // empty bottle shows no water
    w.scale.y = Math.max(0.03, player.bottle / player.bottleMax);
  }

  player.attack = function () {
    if (!player.alive || !player.active) return;
    const now = player._t;
    if (now - player.lastAttack < ATTACK_CD) return;
    player.lastAttack = now;
    player.swing = 0; // drives the swing animation

    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, player.camera);
    ray.far = ATTACK_RANGE;

    const targets = [];
    W.world.trees.forEach((t) => { if (t.userData.alive) targets.push(t); });
    W.enemies.list.forEach((e) => { if (e.alive) targets.push(e.group); });

    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) return;
    const root = findRoot(hits[0].object);
    if (!root) return;

    if (root.userData.type === 'enemy') {
      if (W.net && W.net.role === 'client') {
        W.net.sendHit(root.userData.id);          // host resolves the damage
      } else {
        const killed = W.enemies.damage(root, ATTACK_DMG, player.pos);
        if (killed) player.creditKill(root.userData.kind);
      }
    } else if (root.userData.type === 'tree') {
      const wood = W.world.chopTree(root);
      if (wood) {
        player.wood += wood; W.hud.toast('+' + wood + ' wood');
        if (W.net && W.net.role) W.net.sendChop(W.world.treeIndex(root));
      }
    }
  };

  // Reward for a kill (used locally, and by net for remote-credited kills).
  player.creditKill = function (kind) {
    player.kills += 1;
    const bonus = kind === 'werewolf' ? 2 : 1;
    if (Math.random() < 0.6) player.wood += bonus;
    if (Math.random() < 0.45) {
      player.hunger = U.clamp(player.hunger + 10 * bonus, 0, 100);
      W.hud.toast('+meat 🍖');
    }
  };

  function findRoot(obj) {
    let o = obj;
    while (o) {
      if (o.userData && o.userData.type) return o;
      o = o.parent;
    }
    return null;
  }

  player.eat = function () {
    if (!player.alive || !player.active) return;
    let best = null, bestD = 3.0;
    for (const b of W.world.bushes) {
      if (!b.ready) continue;
      const d = U.dist2(player.pos.x, player.pos.z, b.x, b.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return;
    best.ready = false;
    best.mesh.userData.berries.forEach((berry) => { berry.visible = false; });
    player.hunger = U.clamp(player.hunger + 35, 0, 100);
    W.hud.toast('+35 food 🍓');
    setTimeout(() => {
      best.ready = true;
      best.mesh.userData.berries.forEach((berry) => { berry.visible = true; });
    }, 25000);
  };

  player.drink = function () {
    if (!player.alive || !player.active) return;
    if (W.world.isWater(player.pos.x, player.pos.z)) {
      player.thirst = 100;
      player.bottle = player.bottleMax;
      W.hud.toast('Drank deeply & filled bottle 💧');
      player._drink = 0;
    } else if (player.bottle > 0) {
      player.bottle -= 1;
      player.thirst = U.clamp(player.thirst + 35, 0, 100);
      W.hud.toast('Sip 💧 (' + player.bottle + '/' + player.bottleMax + ')');
      player._drink = 0;
    } else {
      W.hud.toast('Bottle empty — find a lake');
    }
  };

  player.takeDamage = function (amount) {
    if (!player.alive) return;
    player.health -= amount;
    player.lastHurt = player._t;
    W.hud.flashDamage(U.clamp(amount / 14, 0.25, 0.9));
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      W.onDeath && W.onDeath();
    }
  };

  player.update = function (dt) {
    player._t += dt;
    if (!player.alive) return;
    const k = player.keys;

    // --- look with arrow keys ---
    const LOOK = 2.0; // radians/sec
    if (k.ArrowLeft) player.yaw += LOOK * dt;
    if (k.ArrowRight) player.yaw -= LOOK * dt;
    if (k.ArrowUp) player.pitch = U.clamp(player.pitch + LOOK * dt, -1.45, 1.45);
    if (k.ArrowDown) player.pitch = U.clamp(player.pitch - LOOK * dt, -1.45, 1.45);

    // --- movement direction relative to yaw ---
    let fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    let str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const len = Math.hypot(fwd, str) || 1;
    fwd /= len; str /= len;

    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    // forward = (-sin, -cos); right = (cos, -sin)
    let wishX = (-sin) * fwd + (cos) * str;
    let wishZ = (-cos) * fwd + (-sin) * str;

    const moving = fwd !== 0 || str !== 0;
    const wantSprint = k.ShiftLeft && moving && fwd > 0 && player.stamina > 1;
    const speed = SPEED * (wantSprint ? SPRINT : 1);

    player.pos.x += wishX * speed * dt;
    player.pos.z += wishZ * speed * dt;
    W.world.resolveCollision(player.pos, C.PLAYER_RADIUS);

    // keep inside the world
    const fromC = Math.hypot(player.pos.x, player.pos.z);
    if (fromC > C.WORLD_RADIUS + 6) {
      player.pos.x *= (C.WORLD_RADIUS + 6) / fromC;
      player.pos.z *= (C.WORLD_RADIUS + 6) / fromC;
    }

    // --- vertical (gravity, jump, terrain follow) ---
    const groundEye = W.world.heightAt(player.pos.x, player.pos.z) + C.EYE_HEIGHT;
    if (player.grounded && k.Space) { player.vy = JUMP; player.grounded = false; }
    player.vy -= GRAV * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= groundEye) {
      player.pos.y = groundEye; player.vy = 0; player.grounded = true;
    }
    // when walking, hug the terrain instead of stair-stepping
    if (player.grounded) player.pos.y = groundEye;

    // --- stats ---
    if (wantSprint) player.stamina = U.clamp(player.stamina - 22 * dt, 0, 100);
    else player.stamina = U.clamp(player.stamina + 13 * dt, 0, 100);

    player.hunger = U.clamp(player.hunger - 0.9 * dt, 0, 100);
    player.thirst = U.clamp(player.thirst - 1.15 * dt, 0, 100);
    if (player.hunger <= 0) player.takeDamage(2.2 * dt);
    if (player.thirst <= 0) player.takeDamage(2.0 * dt);
    if (player.hunger > 40 && player.thirst > 25 && player._t - player.lastHurt > 4) {
      player.health = U.clamp(player.health + 1.6 * dt, 0, 100);
    }
    // resting by the campfire heals faster
    if (W.world.nearCamp(player.pos) && player._t - player.lastHurt > 1.5) {
      player.health = U.clamp(player.health + 4 * dt, 0, 100);
    }

    // --- apply to camera ---
    player.camera.position.copy(player.pos);
    player.camera.rotation.y = player.yaw;
    player.camera.rotation.x = player.pitch;

    // head bob
    const bob = moving && player.grounded ? Math.sin(player._t * (wantSprint ? 14 : 9)) * 0.04 : 0;
    player.camera.position.y += bob;

    animateAxe(dt, moving);
    animateBottle(dt);
    updateBottleWater();
  };

  function animateBottle(dt) {
    const g = player.bottle3d;
    if (!g || player._drink === undefined) return;
    player._drink += dt;
    const k = player._drink / 0.6;
    if (k >= 1) {
      player._drink = undefined;
      g.rotation.copy(player.bottleRest);
      g.position.copy(BOTTLE_HOME);
    } else {
      const s = Math.sin(Math.min(k, 1) * Math.PI);
      g.rotation.x = player.bottleRest.x - s * 1.2;     // tip to mouth
      g.position.x = BOTTLE_HOME.x + s * 0.2;
      g.position.y = BOTTLE_HOME.y + s * 0.14;
    }
  }

  function animateAxe(dt, moving) {
    const axe = player.axe;
    if (player.swing !== undefined) {
      player.swing += dt;
      const k = player.swing / ATTACK_CD;
      if (k >= 1) { player.swing = undefined; axe.rotation.copy(player.axeRest); }
      else {
        // quick chop: down then back
        const s = Math.sin(Math.min(k, 1) * Math.PI);
        axe.rotation.x = player.axeRest.x - s * 1.5;
        axe.rotation.z = player.axeRest.z + s * 0.4;
      }
    } else {
      const sway = moving ? Math.sin(player._t * 9) * 0.05 : Math.sin(player._t * 2) * 0.015;
      axe.rotation.z = player.axeRest.z + sway;
    }
  }

  player.reset = function () {
    Object.assign(player, {
      alive: true, health: 100, stamina: 100, hunger: 100, thirst: 100,
      bottle: 5, bottleMax: 5, wood: 0, kills: 0, vy: 0,
    });
  };

  W.player = player;
})();
