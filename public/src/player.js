/* First-person controller: look, movement, stats, axe + attack, eating. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;
  const C = W.CONFIG;

  const player = {
    active: false,
    alive: true,
    downed: false, bleedT: 0, bandaids: 0,
    sleeping: false, sleepT: 0, hugStuffie: null,
    building: null, invOpen: false,
    berries: 0, berryMax: 5,
    health: 100, stamina: 100, hunger: 100, thirst: 100,
    bottle: 5, bottleMax: 5,
    wood: 0, kills: 0,
    attackDmg: 2, attackRange: 4.0, armor: 1.0,        // upgraded by crafting
    axeLevel: 0,
    craftOpen: false, hasArmor: false, hasSword: false, hasShield: false, currentWeapon: 'axe',
    yaw: 0, pitch: 0,
    vy: 0, grounded: true,
    lastHurt: -99, lastAttack: -99,
    keys: {},
    _t: 0,
  };

  const SPEED = 5.2, SPRINT = 1.7, GRAV = 20, JUMP = 7.9;   // a bit higher: hop over barricades
  const ATTACK_CD = 0.45;

  player.init = function (camera, dom, scene) {
    player.camera = camera;
    player.dom = dom;
    player.scene = scene;
    camera.rotation.order = 'YXZ';

    const start = { x: 0, z: 4 };
    player.pos = new THREE.Vector3(start.x, W.world.heightAt(start.x, start.z) + C.EYE_HEIGHT, start.z);

    buildAxe(camera);
    buildSword(camera);
    buildShield(camera);
    buildBottle(camera);
    buildHeldBerry(camera);
    equipWeapon('axe');
    player.dropped = [];

    // --- input: WASD move, trackpad/mouse look, click attack, etc. ---
    window.addEventListener('keydown', (e) => {
      player.keys[e.code] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyQ') player.attack();
      if (e.code === 'KeyX') player.switchWeapon();
      if (e.code === 'KeyE') player.eat();
      if (e.code === 'KeyF') player.drink();
      if (e.code === 'KeyG') player.grab();
      if (e.code === 'KeyH') player.dropBerry();
      if (e.code === 'KeyB') player.useBandaid();
      if (e.code === 'KeyZ') player.zipTent();
      if (e.code === 'KeyK') player.sleep();
      if (e.code === 'KeyT' && player.active) W.critters.tryTame(player.pos);
      if (e.code === 'KeyJ') W.hud.showKeyHelp(true);
      if (e.code === 'KeyI') player.toggleInventory();
      if (e.code === 'KeyC') {
        if (player.building) { player.cancelBuild(); return; }   // C also cancels a pending build
        player.craftOpen = !player.craftOpen; W.hud.toggleCraft(player.craftOpen); refreshCraft();
      }
      if (player.craftOpen && /^Digit[0-9]$/.test(e.code)) player.craft(e.code.slice(5));
    });
    window.addEventListener('keyup', (e) => {
      player.keys[e.code] = false;
      if (e.code === 'KeyJ') W.hud.showKeyHelp(false);
    });

    // Left click = place a pending build (if any), else swing your weapon.
    // Right click = cancel a pending build.
    document.addEventListener('mousedown', (e) => {
      if (player.building) {
        if (e.button === 0) player.placeBuild();
        else if (e.button === 2) player.cancelBuild();
        return;
      }
      if (e.button === 0 && player.active) player.attack();
    });
    window.addEventListener('contextmenu', (e) => { if (player.building) e.preventDefault(); });

    // Trackpad / mouse move = look around. Captured so you can turn freely (no edge-stop).
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement == null) return;
      const s = 0.0024;
      player.yaw -= e.movementX * s;
      player.pitch = U.clamp(player.pitch - e.movementY * s, -1.55, 1.55);
    });
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
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.14), metal);   // socket around the handle
    head.add(eye);

    // Double-bit head: a curved cutting blade flaring out on BOTH sides.
    const shape = new THREE.Shape();
    shape.moveTo(0.05, -0.14);
    shape.lineTo(0.05, 0.16);
    shape.lineTo(0.30, 0.24);
    shape.quadraticCurveTo(0.46, 0, 0.30, -0.24);
    shape.lineTo(0.05, -0.14);
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    bladeGeo.translate(0, 0, -0.025);
    const blade1 = new THREE.Mesh(bladeGeo, metal);
    head.add(blade1);
    const blade2 = new THREE.Mesh(bladeGeo, metal);
    blade2.rotation.y = Math.PI; // mirror to the other side
    head.add(blade2);
    g.add(head);

    g.position.set(0.36, -0.52, -0.72);
    g.rotation.set(-0.15, -0.5, 0.2);
    g.scale.setScalar(0.46);
    camera.add(g);
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    player.axe = g;
  }

  function buildSword(camera) {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dce4, roughness: 0.28, metalness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9a7634, roughness: 0.5, metalness: 0.4 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.02), steel); blade.position.y = 0.72; g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), steel); tip.position.y = 1.31; g.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.09), brass); guard.position.y = 0.2; g.add(guard);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), grip); handle.position.y = 0.06; g.add(handle);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), brass); pommel.position.y = -0.08; g.add(pommel);
    g.position.set(0.34, -0.5, -0.7);
    g.rotation.set(-0.2, -0.4, 0.15);
    g.scale.setScalar(0.5);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.sword = g;
  }

  function buildShield(camera) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1, flatShading: true });
    const rim = new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.5, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 10), wood);
    body.rotation.x = Math.PI / 2; g.add(body);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), rim); boss.position.z = 0.05; g.add(boss);
    g.position.set(-0.52, -0.32, -0.62);
    g.rotation.set(0, 0.3, 0);
    g.visible = false;
    camera.add(g);
    player.shield3d = g;
  }

  function equipWeapon(which) {
    const isSword = which === 'sword' && !!player.sword;
    const w = isSword ? player.sword : player.axe;
    player.axe.visible = !isSword;
    if (player.sword) player.sword.visible = isSword;
    player.weapon = w;
    player.weaponRest = w.userData.rest;
    player.weaponHome = w.userData.home;
    player.currentWeapon = isSword ? 'sword' : 'axe';
    player.swing = undefined;
    w.rotation.copy(w.userData.rest);
    w.position.copy(w.userData.home);
  }

  // X switches between the axe and the crafted sword.
  player.switchWeapon = function () {
    if (!player.hasSword) { W.hud.toast('Craft a Sword first (C)'); return; }
    equipWeapon(player.currentWeapon === 'sword' ? 'axe' : 'sword');
    W.hud.toast(player.currentWeapon === 'sword' ? '⚔️ Sword equipped' : '🪓 Axe equipped');
  };

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
    ray.far = player.attackRange;

    const targets = [];
    W.world.trees.forEach((t) => { if (t.userData.alive) targets.push(t); });
    W.enemies.list.forEach((e) => { if (e.alive) targets.push(e.group); });

    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) return;
    const root = findRoot(hits[0].object);
    if (!root) return;

    if (root.userData.type === 'enemy') {
      // can't strike a wolf through a tent wall (same cover rule as their bite)
      if (W.world.wallBetween(player.pos.x, player.pos.z, root.position.x, root.position.z)) return;
      if (W.net && W.net.role === 'client') {
        W.net.sendHit(root.userData.id, player.attackDmg);  // host resolves the damage
      } else {
        const killed = W.enemies.damage(root, player.attackDmg, player.pos);
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
    // harvest a ripe crop from a nearby farm plot first
    if (W.world.plots) {
      for (const plot of W.world.plots) {
        if (plot.ripe && U.dist2(player.pos.x, player.pos.z, plot.x, plot.z) < 2.6) {
          plot.ripe = false; plot.t = 0;
          player.hunger = U.clamp(player.hunger + 45, 0, 100);
          W.hud.toast('Harvested a crop 🥕 +45 food');
          return;
        }
      }
    }
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

  function buildHeldBerry(camera) {
    const g = new THREE.Group();
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xd23a4a, roughness: 0.45, emissive: 0x320000 }));
    g.add(berry);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 4),
      new THREE.MeshStandardMaterial({ color: 0x3a7a35, roughness: 1 }));
    leaf.position.y = 0.06; leaf.rotation.x = 0.4; g.add(leaf);
    g.position.set(0.0, -0.26, -0.42);
    g.visible = false;
    camera.add(g);
    player.heldBerry = g;
  }

  function makeGroundBerry() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xd23a4a, roughness: 0.45, emissive: 0x320000 }));
    b.castShadow = true; g.add(b);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 4),
      new THREE.MeshStandardMaterial({ color: 0x3a7a35, roughness: 1 }));
    leaf.position.y = 0.09; leaf.rotation.x = 0.4; g.add(leaf);
    return g;
  }

  // G: pick up a berry (carry up to 5) from a dropped berry or a nearby bush.
  player.grab = function () {
    if (!player.alive || !player.active) return;
    if (player.berries >= player.berryMax) { W.hud.toast('Hands full (5/5)'); return; }
    // nearest dropped berry first
    let best = -1, bestD = 2.5;
    for (let i = 0; i < player.dropped.length; i++) {
      const g = player.dropped[i];
      const d = U.dist2(player.pos.x, player.pos.z, g.position.x, g.position.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      player.scene.remove(player.dropped[best]);
      player.dropped.splice(best, 1);
    } else {
      // otherwise pick one off a nearby bush
      let fromBush = false;
      for (const bush of W.world.bushes) {
        if (bush.ready && U.dist2(player.pos.x, player.pos.z, bush.x, bush.z) < 3.0) { fromBush = true; break; }
      }
      if (!fromBush) { W.hud.toast('No berries nearby'); return; }
    }
    player.berries += 1;
    player.heldBerry.visible = true;
    W.hud.toast('Picked a berry 🍓 (' + player.berries + '/' + player.berryMax + ')');
  };

  // K: drop one carried berry onto the ground in front of you.
  player.dropBerry = function () {
    if (!player.alive || !player.active) return;
    if (player.berries <= 0) { W.hud.toast('No berries to drop'); return; }
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const fx = player.pos.x + (-sin) * 1.0;
    const fz = player.pos.z + (-cos) * 1.0;
    const g = makeGroundBerry();
    g.position.set(fx, W.world.heightAt(fx, fz) + 0.09, fz);
    player.scene.add(g);
    player.dropped.push(g);
    player.berries -= 1;
    player.heldBerry.visible = player.berries > 0;
    W.hud.toast('Dropped a berry 🍓 (' + player.berries + '/' + player.berryMax + ')');
  };

  // --- Crafting / upgrades ----------------------------------------------------
  const axeCost = () => 8 + player.axeLevel * 4;     // each upgrade costs more

  function refreshCraft() {
    W.hud.updateCraft({
      wood: player.wood,
      axeLevel: player.axeLevel, axeCost: axeCost(),
      armor: player.hasArmor, sword: player.hasSword, shield: player.hasShield,
    });
  }

  // Placeables go into "hologram" build mode; everything else crafts instantly.
  const BUILDABLES = {
    '1': { kind: 'barricade', cost: 5, dist: 1.7, name: 'Barricade' },
    '4': { kind: 'barbed', cost: 8, dist: 1.7, name: 'Barbed wire' },
    '5': { kind: 'logs', cost: 4, dist: 1.5, name: 'Logs' },
    '8': { kind: 'farm', cost: 12, dist: 2.0, name: 'Farm plot' },
    '9': { kind: 'table', cost: 15, dist: 2.0, name: 'Crafting table' },
  };

  player.craft = function (id) {
    if (!player.alive || !player.active) return;
    // crafting always needs a workbench nearby (there's one at camp to start)
    if (!W.world.nearCraftTable(player.pos, 3.6)) {
      W.hud.toast('Stand by a crafting table 🛠️');
      return;
    }
    const pay = (c) => {
      if (player.wood < c) { W.hud.toast('Need ' + c + ' wood (have ' + player.wood + ')'); return false; }
      player.wood -= c; return true;
    };

    const b = BUILDABLES[id];
    if (b) {                                 // enter placement mode (pay on placing)
      if (player.wood < b.cost) { W.hud.toast('Need ' + b.cost + ' wood (have ' + player.wood + ')'); return; }
      startBuild(id, b);
      return;
    }

    if (id === '2') {                        // Upgrade Axe (repeatable weapon)
      if (!pay(axeCost())) return;
      player.axeLevel += 1; player.attackDmg += 2;
      W.hud.toast('Axe upgraded! ⚔️ Lv ' + player.axeLevel + ' · dmg ' + player.attackDmg);
    } else if (id === '3') {                 // Wooden Armor (one-time defence)
      if (player.hasArmor) { W.hud.toast('Already have armor'); return; }
      if (!pay(10)) return;
      player.hasArmor = true; player.armor *= 0.6;
      W.hud.toast('Wooden armor on 🛡️ less damage');
    } else if (id === '6') {                 // Sword (one-time weapon)
      if (player.hasSword) { W.hud.toast('Already have a sword'); return; }
      if (!pay(12)) return;
      player.hasSword = true; player.attackDmg += 3; equipWeapon('sword');
      W.hud.toast('Sword forged! ⚔️ +damage · press X to switch');
    } else if (id === '7') {                 // Shield (one-time defence)
      if (player.hasShield) { W.hud.toast('Already have a shield'); return; }
      if (!pay(10)) return;
      player.hasShield = true; player.armor *= 0.65;
      if (player.shield3d) player.shield3d.visible = true;
      W.hud.toast('Shield ready 🛡️ blocks more');
    } else if (id === '0') {                 // Bandaid (revive / heal)
      if (!pay(6)) return;
      player.bandaids += 1;
      W.hud.toast('Bandaid crafted 🩹 (' + player.bandaids + ')');
    } else { return; }
    refreshCraft();
  };

  // --- Build placement: aim a green hologram, click to place -----------------

  function buildAheadPos(dist) {
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    return { x: player.pos.x + (-sin) * dist, z: player.pos.z + (-cos) * dist };
  }

  function startBuild(id, b) {
    if (player.building) player.cancelBuild();
    player.craftOpen = false; W.hud.toggleCraft(false);
    const ghost = W.world.makeGhost(b.kind);
    player.scene.add(ghost);
    player.building = { id, kind: b.kind, cost: b.cost, dist: b.dist, name: b.name, ghost };
    W.hud.showBuildHint(true, b.name);
  }

  player.placeBuild = function () {
    const b = player.building;
    if (!b) return;
    if (player.wood < b.cost) { W.hud.toast('Need ' + b.cost + ' wood'); player.cancelBuild(); return; }
    player.wood -= b.cost;
    const gx = b.ghost.position.x, gz = b.ghost.position.z, yaw = player.yaw;
    W.world.buildById(b.id, gx, gz, yaw);
    if (W.net && W.net.role && W.net.sendBuild) W.net.sendBuild(b.id, gx, gz, yaw);
    W.hud.toast('Placed a ' + b.name.toLowerCase() + ' ✅');
    player.scene.remove(b.ghost);
    player.building = null; W.hud.showBuildHint(false);
    refreshCraft();
  };

  player.cancelBuild = function () {
    if (!player.building) return;
    player.scene.remove(player.building.ghost);
    player.building = null; W.hud.showBuildHint(false);
    W.hud.toast('Build cancelled');
  };

  // --- Inventory --------------------------------------------------------------

  player.toggleInventory = function () {
    player.invOpen = !player.invOpen;
    W.hud.toggleInventory(player.invOpen);
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

  // B: revive a downed teammate (co-op) or patch yourself up with a bandaid.
  player.useBandaid = function () {
    if (!player.alive || player.downed) return;
    if (player.bandaids <= 0) { W.hud.toast('No bandaids — craft one (C → 0)'); return; }
    if (W.net && W.net.role && W.net.anyDownedNear && W.net.anyDownedNear(player.pos, 2.8)) {
      player.bandaids -= 1; W.net.sendRevive();
      W.hud.toast('Revived a teammate! 🩹');
      return;
    }
    if (player.health < 100) {
      player.bandaids -= 1;
      player.health = U.clamp(player.health + 50, 0, 100);
      W.hud.toast('Patched up 🩹 +50 health');
    } else { W.hud.toast('Already full health'); }
  };

  // Z: zip the nearest tent shut (works from outside too). Nothing can get in.
  player.zipTent = function () {
    if (!player.alive || !player.active) return;
    const res = W.world.toggleTentZip(player.pos);
    if (!res) { W.hud.toast('Get closer to a tent to zip it 🏕️'); return; }
    if (res.zipped) {
      W.hud.toast(W.world.isNight() ? 'Zipped shut 🤐 — press K to sleep 💤' : 'Tent zipped shut 🤐 — nothing gets in');
    } else { W.hud.toast('Tent opened'); }
    if (W.net && W.net.role && W.net.sendZip) W.net.sendZip(res.idx, res.zipped);
  };

  // K: lie down in a tent. Takes ~5s; you may hug a stuffie for a cosy bonus.
  // The night only skips once you're done (and in co-op, everyone is).
  player.sleep = function () {
    if (!player.alive || player.downed || !player.active) return;
    if (player.sleeping) { player.wake(true); return; }   // press again to get up early
    if (!W.world.insideTent(player.pos)) { W.hud.toast('Get in a tent to sleep 🛏️'); return; }
    if (!W.world.isNight()) { W.hud.toast('You can only sleep at night 🌙'); return; }
    if (player.building) player.cancelBuild();
    player.sleeping = true; player.sleepT = 0; player.hugStuffie = null;
    W.hud.showSleep(true);
  };

  // Pick a stuffie to hug while sleeping (cosy +health on waking).
  player.hug = function (kind) {
    if (!player.sleeping) return;
    player.hugStuffie = kind;
    W.hud.markHug(kind);
  };

  // True once this player has finished their 5s of sleep (used to sync co-op).
  player.sleepReady = function () { return player.sleeping && player.sleepT >= 5; };

  // Wake up: `early` = got up before dawn (no bonus); otherwise dawn + cosy bonus.
  player.wake = function (early) {
    if (!player.sleeping) return;
    if (!early && player.hugStuffie) {
      player.health = U.clamp(player.health + 20, 0, 100);
      W.hud.toast('Slept cosy with a stuffie 🧸 +20 health');
    }
    player.sleeping = false; player.sleepT = 0; player.hugStuffie = null;
    W.hud.showSleep(false);
    if (early) W.hud.toast('You got up');
  };

  player.revive = function () {
    if (!player.downed) return;
    player.downed = false; player.bleedT = 0;
    player.health = 50; player.active = true;
    W.hud.banner('REVIVED!', 'Back on your feet', '#8fd36a');
  };

  player.takeDamage = function (amount) {
    if (!player.alive || player.downed) return;
    if (player.sleeping) player.wake(true);     // a hit jolts you awake
    amount *= player.armor;          // wooden armor reduces incoming damage
    player.health -= amount;
    player.lastHurt = player._t;
    W.hud.flashDamage(U.clamp(amount / 14, 0.25, 0.9));
    if (player.health <= 0) {
      player.health = 0;
      if (W.net && W.net.role) {
        // co-op: go DOWN instead of dying — a teammate can revive you
        player.downed = true; player.bleedT = 0; player.active = false;
        W.hud.banner('YOU ARE DOWN', 'Hold on — a teammate can revive you 🩹', '#ff7b7b');
      } else {
        player.alive = false;
        W.onDeath && W.onDeath();
      }
    }
  };

  player.update = function (dt) {
    player._t += dt;
    if (!player.alive) return;
    if (player.downed) {
      player.bleedT += dt;
      player.camera.position.copy(player.pos); player.camera.position.y -= 0.95;
      player.camera.rotation.set(-0.55, player.yaw, 0, 'YXZ');
      if (player.bleedT > 60) { player.downed = false; player.alive = false; W.onDeath && W.onDeath(); }
      return;
    }
    if (player.sleeping) {
      player.sleepT += dt;
      player.camera.position.copy(player.pos);
      player.camera.rotation.y = player.yaw; player.camera.rotation.x = player.pitch;
      W.hud.setSleepCount(Math.max(0, Math.ceil(5 - player.sleepT)), player.sleepT >= 5);
      return;
    }
    const k = player.keys;

    // --- look with arrow keys (works alongside trackpad/mouse) ---
    const LOOK = 2.0; // radians/sec
    if (k.ArrowLeft) player.yaw += LOOK * dt;
    if (k.ArrowRight) player.yaw -= LOOK * dt;
    if (k.ArrowUp) player.pitch = U.clamp(player.pitch + LOOK * dt, -1.55, 1.55);
    if (k.ArrowDown) player.pitch = U.clamp(player.pitch - LOOK * dt, -1.55, 1.55);

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
    W.world.resolveCollision(player.pos, C.PLAYER_RADIUS, player.pos.y - C.EYE_HEIGHT);  // feet height: jump over low walls

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
    const atBase = W.world.nearCamp(player.pos);   // the camp is a safe haven

    // stamina: infinite at base, otherwise drains while sprinting / recovers at rest
    if (atBase) player.stamina = 100;
    else if (wantSprint) player.stamina = U.clamp(player.stamina - 12 * dt, 0, 100);
    else player.stamina = U.clamp(player.stamina + 15 * dt, 0, 100);

    // hunger & thirst: slowly recover at base, otherwise tick down
    if (atBase) {
      player.hunger = U.clamp(player.hunger + 2.5 * dt, 0, 100);
      player.thirst = U.clamp(player.thirst + 2.5 * dt, 0, 100);
    } else {
      player.hunger = U.clamp(player.hunger - 0.45 * dt, 0, 100);                   // lasts longer
      player.thirst = U.clamp(player.thirst - 1.15 * dt, 0, 100);
    }
    if (player.hunger <= 0) player.takeDamage(2.2 * dt);
    if (player.thirst <= 0) player.takeDamage(2.0 * dt);
    if (player.hunger > 40 && player.thirst > 25 && player._t - player.lastHurt > 4) {
      player.health = U.clamp(player.health + 1.6 * dt, 0, 100);
    }
    // resting at the base heals you fast
    if (atBase && player._t - player.lastHurt > 1.5) {
      player.health = U.clamp(player.health + 7 * dt, 0, 100);
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

    // keep the build hologram floating where you're aiming
    if (player.building) {
      const a = buildAheadPos(player.building.dist);
      player.building.ghost.position.set(a.x, W.world.heightAt(a.x, a.z), a.z);
      player.building.ghost.rotation.y = player.yaw;
    }
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
    const w = player.weapon;
    if (!w) return;
    const rest = player.weaponRest, home = player.weaponHome;
    if (player.swing !== undefined) {
      player.swing += dt;
      const k = Math.min(player.swing / ATTACK_CD, 1);
      if (k >= 1) { player.swing = undefined; w.rotation.copy(rest); w.position.copy(home); return; }
      // wind back quickly, then chop down hard, with a small forward lunge
      const wind = k < 0.28 ? (k / 0.28) : (1 - (k - 0.28) / 0.72);   // 0..1..0 peak at the chop
      const chop = Math.sin(Math.min(k, 1) * Math.PI);
      w.rotation.x = rest.x + wind * 0.5 - chop * 1.8;
      w.rotation.z = rest.z + chop * 0.55;
      w.position.z = home.z - chop * 0.14;
      w.position.y = home.y - chop * 0.06;
    } else {
      const sway = moving ? Math.sin(player._t * 9) * 0.05 : Math.sin(player._t * 2) * 0.015;
      w.rotation.x = rest.x;
      w.rotation.z = rest.z + sway;
      w.position.copy(home);
    }
  }

  player.reset = function () {
    Object.assign(player, {
      alive: true, downed: false, bleedT: 0, bandaids: 0,
      sleeping: false, sleepT: 0, hugStuffie: null, building: null, invOpen: false,
      health: 100, stamina: 100, hunger: 100, thirst: 100,
      bottle: 5, bottleMax: 5, berries: 0, wood: 0, kills: 0, vy: 0,
      attackDmg: 2, attackRange: 4.0, armor: 1.0, axeLevel: 0, hasArmor: false, hasSword: false, hasShield: false, currentWeapon: 'axe',
    });
  };

  W.player = player;
})();
