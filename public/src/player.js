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
    sitting: false, _seat: null, _seatHint: false,
    hasShotgun: false, shells: 0,
    hasBow: true, bowColor: 0x7a4a24, arrowColor: 0xe6c54a,   // start with a bow (colours from the menu)
    saplings: 0,
    berries: 0, berryMax: 5,
    health: 100, stamina: 100, hunger: 100, thirst: 100,
    bottle: 5, bottleMax: 5,
    wood: 0, kills: 0,
    attackDmg: 2, attackRange: 4.0, armor: 1.0,        // upgraded by crafting
    axeLevel: 0,
    craftOpen: false, hasArmor: false, hasSword: false, hasKatana: false, hasShield: false, currentWeapon: 'axe',
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

    player.arrows = [];                 // arrows currently in flight (colours chosen in the menu)
    player._dmgNums = [];               // floating Fortnite-style damage numbers

    buildAxe(camera);
    buildSword(camera);
    buildKatana(camera);
    buildShotgun(camera);
    buildBow(camera);
    buildShield(camera);
    buildBottle(camera);
    buildHeldBerry(camera);
    equipWeapon('bow');                 // you START WITH THE BOW (user request)
    player.dropped = [];

    // --- input: WASD move, trackpad/mouse look, click attack, etc. ---
    window.addEventListener('keydown', (e) => {
      player.keys[e.code] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyQ' && !e.repeat) player.pressAttack();
      if (e.code === 'KeyX') player.switchWeapon();
      if (e.code === 'KeyE') player.eat();
      if (e.code === 'KeyF') player.drink();
      if (e.code === 'KeyG') player.grab();
      if (e.code === 'KeyH') player.dropBerry();
      if (e.code === 'KeyB') player.useBandaid();
      if (e.code === 'KeyZ') player.zipTent();
      if (e.code === 'KeyK') player.sleep();
      if (e.code === 'KeyR') player.sit();
      if (e.code === 'KeyU') player.plant();
      if (e.code === 'KeyM') player.toggleMount();
      if (e.code === 'KeyT' && player.active) W.critters.tryTame(player.pos);
      if (e.code === 'KeyV') player.teleportVillage();
      if (e.code === 'KeyJ') W.hud.showKeyHelp(true);
      if (e.code === 'KeyI') player.toggleInventory();
      if (e.code === 'KeyC') {
        if (player.building) { player.cancelBuild(); return; }   // C also cancels a pending build
        player.craftOpen = !player.craftOpen; W.hud.toggleCraft(player.craftOpen); refreshCraft();
      }
      if (player.craftOpen) {
        if (/^Digit[0-9]$/.test(e.code)) player.craft(e.code.slice(5));
        else if (e.code === 'Minus') player.craft('tent');
        else if (e.code === 'Equal') player.craft('fire');
        else if (e.code === 'BracketLeft') player.craft('katana');
      }
    });
    window.addEventListener('keyup', (e) => {
      player.keys[e.code] = false;
      if (e.code === 'KeyJ') W.hud.showKeyHelp(false);
      if (e.code === 'KeyQ') player.releaseAttack();      // loose the bow
    });

    // Left click = place a pending build (if any), else swing your weapon.
    // Right click = cancel a pending build.
    document.addEventListener('mousedown', (e) => {
      if (player.building) {
        if (e.button === 0) player.placeBuild();
        else if (e.button === 2) player.cancelBuild();
        return;
      }
      if (e.button === 0 && player.active) player.pressAttack();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) player.releaseAttack();          // loose the bow on release
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
    const metal = new THREE.MeshStandardMaterial({ color: (player.axeColor != null ? player.axeColor : 0xaeb6c2), roughness: 0.4, metalness: 0.45 });

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

  function buildKatana(camera) {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, roughness: 0.18, metalness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.5, metalness: 0.5 });
    // long slim blade, slightly curved by stacking a couple of segments
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.3, 0.02), steel); blade.position.y = 0.92; blade.rotation.z = 0.05; g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 4), steel); tip.position.set(0.05, 1.66, 0); tip.rotation.z = 0.05; g.add(tip);
    // circular tsuba (guard) + wrapped handle
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), gold); tsuba.rotation.x = Math.PI / 2; tsuba.position.y = 0.24; g.add(tsuba);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 8), black); handle.position.y = 0.06; g.add(handle);
    g.position.set(0.34, -0.5, -0.7);
    g.rotation.set(-0.2, -0.4, 0.12);
    g.scale.setScalar(0.5);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.katana = g;
  }

  function buildShotgun(camera) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.4, metalness: 0.55 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
    const barrels = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.7), metal); barrels.position.set(0, 0, -0.35); g.add(barrels);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.32), wood); stock.position.set(0, -0.03, 0.12); g.add(stock);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), wood); grip.position.set(0, -0.13, 0.02); grip.rotation.x = -0.4; g.add(grip);
    g.position.set(0.32, -0.4, -0.6);
    g.rotation.set(-0.05, 0, 0);
    g.scale.setScalar(0.95);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.shotgun = g;
  }

  function buildBow(camera) {
    const g = new THREE.Group();
    const bcol = (player.bowColor != null ? player.bowColor : 0x7a4a24);
    const limbMat = new THREE.MeshStandardMaterial({ color: bcol, roughness: 0.55, metalness: 0.1, flatShading: false });
    player.bowLimbMat = limbMat;

    // recurve limbs: a smooth curve through the riser that flips back at the tips
    const V = (y, z) => new THREE.Vector3(0, y, z);
    const curve = new THREE.CatmullRomCurve3([
      V(0.40, 0.05), V(0.34, -0.05), V(0.20, -0.14), V(0.07, -0.07),
      V(0, -0.05), V(-0.07, -0.07), V(-0.20, -0.14), V(-0.34, -0.05), V(-0.40, 0.05),
    ]);
    const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.014, 8, false), limbMat);
    g.add(body);
    // limb tip caps + a leather grip wrap in the middle
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 1 }));
    grip.position.set(0, 0, -0.045); g.add(grip);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.05), limbMat);
    riser.position.set(0, 0, -0.06); g.add(riser);

    // bowstring drawn back to the nock (forms a shallow V toward the camera)
    const strMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, emissive: 0x222222 });
    const nockPt = V(0, 0.10);
    const strU = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, V(0.40, 0.05).distanceTo(nockPt), 4), strMat);
    strU.position.copy(V(0.40, 0.05).clone().lerp(nockPt, 0.5)); strU.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(0.40, 0.05).clone().sub(nockPt).normalize()); g.add(strU);
    const strL = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, V(-0.40, 0.05).distanceTo(nockPt), 4), strMat);
    strL.position.copy(V(-0.40, 0.05).clone().lerp(nockPt, 0.5)); strL.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(-0.40, 0.05).clone().sub(nockPt).normalize()); g.add(strL);

    // nocked arrow ready to loose (coloured), pointing forward (-Z)
    const aMat = new THREE.MeshStandardMaterial({ color: (player.arrowColor != null ? player.arrowColor : 0xe6c54a), roughness: 0.7, flatShading: true });
    player.bowArrowMat = aMat;
    const nock = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.74, 6), aMat); shaft.rotation.x = Math.PI / 2; nock.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 6), new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.35, metalness: 0.5 }));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.42; nock.add(tip);
    const fMat = new THREE.MeshStandardMaterial({ color: (player.arrowColor != null ? player.arrowColor : 0xe6c54a), roughness: 1, side: THREE.DoubleSide });
    for (const r of [0, Math.PI / 2, Math.PI]) { const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), fMat); fin.position.z = 0.3; fin.rotation.z = r; fin.rotation.y = Math.PI / 2; nock.add(fin); }
    nock.position.copy(nockPt); g.add(nock);
    player.bowNock = nock;
    player._nockHome = nock.position.clone();   // resting nock position (for the draw animation)

    g.position.set(0.22, -0.24, -0.62);
    g.rotation.set(0.05, 0.18, 0.0);
    g.scale.setScalar(1.0);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.bow = g;
  }

  // A coloured arrow that flies through the world (points along its local -Z).
  function buildFlyingArrow() {
    const g = new THREE.Group();
    const acol = (player.arrowColor != null ? player.arrowColor : 0xe6c54a);
    const aMat = new THREE.MeshStandardMaterial({ color: acol, roughness: 0.7, flatShading: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 6), aMat); shaft.rotation.x = Math.PI / 2; g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.11, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.4 }));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.41; g.add(tip);
    const fMat = new THREE.MeshStandardMaterial({ color: acol, roughness: 1, side: THREE.DoubleSide });
    for (const r of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.13), fMat);
      fin.position.z = 0.32; fin.rotation.z = r; fin.rotation.y = Math.PI / 2; g.add(fin);
    }
    return g;
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

  const WEAPON_OBJ = () => ({ axe: player.axe, sword: player.sword, katana: player.katana, shotgun: player.shotgun, bow: player.bow });
  function equipWeapon(which) {
    const have = { axe: true, bow: !!player.hasBow, sword: !!player.hasSword, katana: !!player.hasKatana, shotgun: !!player.hasShotgun };
    if (!have[which]) which = 'axe';
    player._bowDrawing = false; player._bowCharge = 0; player._bowSnap = undefined;   // cancel any draw
    if (player.bowNock && player._nockHome) { player.bowNock.visible = true; player.bowNock.position.copy(player._nockHome); }
    const objs = WEAPON_OBJ();
    if (player.katana) player.katana.visible = which === 'katana';
    player.axe.visible = which === 'axe';
    if (player.sword) player.sword.visible = which === 'sword';
    if (player.shotgun) player.shotgun.visible = which === 'shotgun';
    if (player.bow) player.bow.visible = which === 'bow';
    const w = objs[which];
    player.weapon = w;
    player.weaponRest = w.userData.rest;
    player.weaponHome = w.userData.home;
    player.currentWeapon = which;
    player.swing = undefined;
    w.rotation.copy(w.userData.rest);
    w.position.copy(w.userData.home);
  }

  // X cycles through the weapons you own (bow → axe → sword → shotgun).
  player.switchWeapon = function () {
    const order = [];
    if (player.hasBow) order.push('bow');
    order.push('axe');
    if (player.hasSword) order.push('sword');
    if (player.hasKatana) order.push('katana');
    if (player.hasShotgun) order.push('shotgun');
    if (order.length === 1) { W.hud.toast('Craft a Sword or find the bandit’s shotgun'); return; }
    const i = order.indexOf(player.currentWeapon);
    equipWeapon(order[(i + 1) % order.length]);
    W.hud.toast({ bow: '🏹 Bow', axe: '🪓 Axe', sword: '⚔️ Sword', katana: '🗡️ Katana', shotgun: '🔫 Sawed-off shotgun' }[player.currentWeapon] + ' equipped');
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

  // Press/release routing: the bow draws on hold & looses on release; everything
  // else swings/fires immediately on press.
  player.pressAttack = function () {
    if (!player.alive || !player.active) return;
    if (player.currentWeapon === 'bow') player.startDraw();
    else player.attack();
  };
  player.releaseAttack = function () {
    if (player.currentWeapon === 'bow') player.releaseDraw();
  };

  // Begin pulling the bowstring back (charges while held).
  player.startDraw = function () {
    if (!player.alive || !player.active || player.currentWeapon !== 'bow') return;
    if (player._bowDrawing || player._bowSnap !== undefined) return;
    if (player._t - player.lastAttack < 0.15) return;
    player._bowDrawing = true; player._bowCharge = 0;
    if (player.bowNock) { player.bowNock.visible = true; player.bowNock.position.copy(player._nockHome); }
  };
  // Release the string: the arrow flies with power scaled by how far you drew.
  player.releaseDraw = function () {
    if (!player._bowDrawing) return;
    player._bowDrawing = false;
    const charge = player._bowCharge || 0;
    player._bowCharge = 0;
    if (charge >= 0.12) {                 // too short a draw fizzles (no shot)
      player.lastAttack = player._t;
      fireArrow(charge);
      if (player.bowNock) player.bowNock.visible = false;
      player._bowSnap = 0;                // release recoil
    }
  };

  player.attack = function () {
    if (!player.alive || !player.active) return;
    const now = player._t;
    if (now - player.lastAttack < ATTACK_CD) return;
    player.lastAttack = now;
    player.swing = 0; // drives the swing / recoil animation

    if (player.currentWeapon === 'shotgun') { fireShotgun(); return; }

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
      const e = W.enemies.list.find((x) => x.group === root);
      const headY = root.position.y + (W.enemies.headY ? W.enemies.headY(e) : 1.7);
      const head = Math.abs(hits[0].point.y - headY) < 0.45;          // struck the head
      let dmg = player.attackDmg; if (head) dmg = Math.round(dmg * 2.2);
      if (W.net && W.net.role === 'client') {
        W.net.sendHit(root.userData.id, dmg);  // host resolves the damage
      } else {
        const killed = W.enemies.damage(root, dmg, player.pos);
        if (killed) player.creditKill(root.userData.kind);
      }
      player.popDamage(root.position, dmg, head);
      if (head) W.hud.toast('🎯 HEADSHOT! ' + dmg);
    } else if (root.userData.type === 'tree') {
      const dmg = 10 + player.axeLevel * 5;                 // sharper axe = bigger chips
      const wood = W.world.chopTree(root, dmg);
      showTreeHealth(root, dmg);                            // floating damage + a health bar
      if (wood) {
        player.wood += wood; W.hud.toast('+' + wood + ' wood');
        if (W.net && W.net.role) W.net.sendChop(W.world.treeIndex(root));
        const sap = rollSaplings();                         // each felled tree may drop saplings
        if (sap > 0) { player.saplings += sap; W.hud.toast('🌱 +' + sap + ' sapling' + (sap === 1 ? '' : 's') + (sap >= 100 ? ' JACKPOT!! 🎉' : '')); }
      }
    }
  };

  // Sapling drop roll per felled tree: 25% for 1, 10% for 2, 5% for 3, 1% for 4,
  // 0.5% for 5, and 0.00000000000000001% for a jackpot of 100.
  function rollSaplings() {
    const r = Math.random();
    if (r < 1e-19) return 100;
    if (r < 0.005) return 5;
    if (r < 0.015) return 4;
    if (r < 0.065) return 3;
    if (r < 0.165) return 2;
    if (r < 0.415) return 1;
    return 0;
  }

  // Show the damage dealt and the tree's remaining health when you chop it.
  function showTreeHealth(tree, dmg) {
    player.popDamage(tree.position, dmg);                  // floating damage number
    if (!player._treeBars) player._treeBars = [];
    let s = tree.userData._hpBar;
    if (!s) {
      const cv = document.createElement('canvas'); cv.width = 140; cv.height = 36;
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
      s.userData.cv = cv; s.scale.set(2.4, 0.62, 1); s.renderOrder = 997;
      tree.userData._hpBar = s; player.scene.add(s);
      player._treeBars.push(tree);
    }
    const hp = Math.max(0, tree.userData.hp), max = tree.userData.maxHp, frac = hp / max;
    const cv = s.userData.cv, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 140, 36);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(8, 8, 124, 18);
    ctx.fillStyle = frac > 0.5 ? '#6fdc54' : (frac > 0.25 ? '#f2c33a' : '#e5483a');
    ctx.fillRect(10, 10, 120 * frac, 14);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeRect(8, 8, 124, 18);
    ctx.font = "bold 14px 'Trebuchet MS', sans-serif"; ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(hp) + ' / ' + max, 70, 17);
    s.material.map.needsUpdate = true;
    s.position.set(tree.position.x, tree.position.y + (tree.userData.big ? 9.5 : 6.2), tree.position.z);
    s.material.opacity = 1;
    tree.userData._hpBarT = player._t;
  }
  function updateTreeBars() {
    if (!player._treeBars) return;
    for (let i = player._treeBars.length - 1; i >= 0; i--) {
      const tree = player._treeBars[i], s = tree.userData._hpBar;
      if (!s) { player._treeBars.splice(i, 1); continue; }
      const age = player._t - tree.userData._hpBarT;
      if (!tree.userData.alive || age > 2.5) s.material.opacity = Math.max(0, 1 - (age - 2.5) / 0.6);
      if (!tree.userData.alive || age > 3.1) {
        player.scene.remove(s);
        if (s.material.map) s.material.map.dispose();
        s.material.dispose();
        tree.userData._hpBar = null; player._treeBars.splice(i, 1);
      }
    }
  }

  // The sawed-off shotgun: a hard-hitting short-range blast with buckshot splash.
  function applyShot(root, dmg) {
    if (W.net && W.net.role === 'client') W.net.sendHit(root.userData.id, dmg);
    else { const killed = W.enemies.damage(root, dmg, player.pos); if (killed) player.creditKill(root.userData.kind); }
    player.popDamage(root.position, dmg);
  }
  function fireShotgun() {
    if (player.shells <= 0) { W.hud.toast('Out of shells 🔫'); return; }
    player.shells -= 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, player.camera);
    ray.far = 22;
    const targets = [];
    W.enemies.list.forEach((e) => { if (e.alive) targets.push(e.group); });
    const hits = ray.intersectObjects(targets, true);
    const dmg = 9;
    let hitPos = null, hitRoot = null;
    if (hits.length) { hitRoot = findRoot(hits[0].object); hitPos = hits[0].point; }
    if (hitRoot && hitRoot.userData.type === 'enemy') applyShot(hitRoot, dmg);
    if (hitPos) {                              // buckshot splash to nearby foes
      for (const e of W.enemies.list) {
        if (!e.alive || e.group === hitRoot) continue;
        if (Math.hypot(e.group.position.x - hitPos.x, e.group.position.z - hitPos.z) < 3) applyShot(e.group, 4);
      }
    }
    W.hud.toast('💥 BOOM — ' + player.shells + ' shells left');
  }

  // The bow: looses a coloured arrow that flies and hits a foe.
  const ARROW_FWD = new THREE.Vector3(0, 0, -1);
  function fireArrow(charge) {
    const c = charge == null ? 1 : U.clamp(charge, 0, 1);
    const dir = player.camera.getWorldDirection(new THREE.Vector3());
    const start = player.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6);
    start.y -= 0.14;                                   // leaves from the bow, just under the crosshair
    const arrow = buildFlyingArrow();
    arrow.position.copy(start);
    arrow.quaternion.setFromUnitVectors(ARROW_FWD, dir.clone().normalize());
    player.scene.add(arrow);
    const speed = 32 + c * 32;                         // fuller draw → faster, flatter arrow
    player.arrows.push({ mesh: arrow, vel: dir.clone().multiplyScalar(speed), life: 0, pow: c });
  }
  function applyArrow(root, pow, head) {
    const c = pow == null ? 1 : pow;
    let dmg = Math.round(4 + c * 8) + (player.bowDmgBonus || 0);     // fuller draw hits harder
    if (head) dmg = Math.round(dmg * 2.2);                           // headshot!
    if (W.net && W.net.role === 'client') W.net.sendHit(root.userData.id, dmg);
    else { const killed = W.enemies.damage(root, dmg, player.pos); if (killed) player.creditKill(root.userData.kind); }
    player.popDamage(root.position, dmg, head);
    if (head) W.hud.toast('🎯 HEADSHOT! ' + dmg);
  }

  // --- Floating damage numbers (Fortnite-style) -------------------------------
  function makeDamageSprite(amount, color) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.font = "900 60px 'Trebuchet MS', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineJoin = 'round';
    ctx.strokeText(amount, 64, 50); ctx.fillStyle = color; ctx.fillText(amount, 64, 50);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 2;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.renderOrder = 998;
    return spr;
  }
  player.popDamage = function (pos, amount, head) {
    if (!player._dmgNums) player._dmgNums = [];
    const big = head || amount >= 9;
    const spr = makeDamageSprite(Math.round(amount), head ? '#ff5a5a' : (big ? '#ffd23a' : '#ffffff'));
    spr.position.set(pos.x + (Math.random() - 0.5) * 0.7, pos.y + (head ? 2.4 : 1.9), pos.z + (Math.random() - 0.5) * 0.7);
    player.scene.add(spr);
    player._dmgNums.push({ spr, t: 0, vx: (Math.random() - 0.5) * 0.8, vy: 1.5, big });
  };
  function updateDamageNums(dt) {
    for (let i = player._dmgNums.length - 1; i >= 0; i--) {
      const d = player._dmgNums[i]; d.t += dt;
      d.spr.position.y += d.vy * dt; d.spr.position.x += d.vx * dt; d.vy *= (1 - dt * 1.5);
      const k = d.t / 1.2;
      const pop = 1 + Math.min(d.t * 5, 0.5) - Math.max(0, k - 0.5) * 0.45;   // pop in, then shrink
      const base = d.big ? 1.05 : 0.78;
      d.spr.scale.set(base * pop, base * 0.75 * pop, 1);
      d.spr.material.opacity = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
      if (d.t > 1.2) {
        player.scene.remove(d.spr);
        if (d.spr.material.map) d.spr.material.map.dispose();
        d.spr.material.dispose();
        player._dmgNums.splice(i, 1);
      }
    }
  }
  // advance arrows in flight; hit foes or expire
  function updateArrows(dt) {
    for (let i = player.arrows.length - 1; i >= 0; i--) {
      const a = player.arrows[i];
      a.life += dt;
      a.vel.y -= 9.8 * dt * 0.45;                       // gentle gravity drop
      a.mesh.position.addScaledVector(a.vel, dt);
      a.mesh.quaternion.setFromUnitVectors(ARROW_FWD, a.vel.clone().normalize());
      let done = false;
      for (const e of W.enemies.list) {
        if (!e.alive) continue;
        const ep = e.group.position;
        const hd = Math.hypot(a.mesh.position.x - ep.x, a.mesh.position.z - ep.z);
        if (hd < 1.0 && a.mesh.position.y > ep.y - 0.2 && a.mesh.position.y < ep.y + 2.9) {
          const headY = ep.y + (W.enemies.headY ? W.enemies.headY(e) : 1.7);
          const head = Math.abs(a.mesh.position.y - headY) < 0.42;     // arrow struck the head
          applyArrow(e.group, a.pow, head); done = true; break;
        }
      }
      const groundY = W.world.heightAt(a.mesh.position.x, a.mesh.position.z);
      if (done || a.life > 3.5 || a.mesh.position.y < groundY - 0.1) {
        player.scene.remove(a.mesh); player.arrows.splice(i, 1);
      }
    }
  }

  // Teleport to the village (press V) — handy for visiting the archers & houses.
  player.teleportVillage = function () {
    const vp = W.world.villagePos;
    if (!vp) { if (W.hud && W.hud.toast) W.hud.toast('No village on this map'); return; }
    const gx = vp.x, gz = vp.z + 15;                          // arrive just outside the plaza
    if (player._mount) player.toggleMount && player.toggleMount();
    player.pos.set(gx, W.world.heightAt(gx, gz) + C.EYE_HEIGHT, gz);
    player.vy = 0; player.grounded = true;
    if (W.hud && W.hud.toast) W.hud.toast('🏹 Teleported to the village');
    if (W.hud && W.hud.banner) W.hud.banner('THE VILLAGE', 'Guarded by archers', '#cfe8b6');
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

  // G: pick up the bandit's dropped shotgun, or a berry from the ground / a bush.
  player.grab = function () {
    if (!player.alive || !player.active) return;
    // open a nearby lootable chest first
    if (W.world.openChestNear) {
      const loot = W.world.openChestNear(player.pos, 2.6);
      if (loot) { player.applyLoot(loot); return; }
    }
    if (W.world.takeShotgunNear && W.world.takeShotgunNear(player.pos, 2.6)) {
      player.hasShotgun = true; player.shells += 8; equipWeapon('shotgun');
      W.hud.toast('Picked up the sawed-off shotgun! 🔫 (X to switch)');
      return;
    }
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
      if (!fromBush) {
        if (player.tryFish()) return;            // by a lake with nothing to grab → cast a line
        W.hud.toast('No berries nearby'); return;
      }
    }
    player.berries += 1;
    player.heldBerry.visible = true;
    W.hud.toast('Picked a berry 🍓 (' + player.berries + '/' + player.berryMax + ')');
  };

  // Loot from a chest into your pack.
  player.applyLoot = function (loot) {
    const parts = [];
    if (loot.wood) { player.wood += loot.wood; parts.push('+' + loot.wood + ' 🪵'); }
    if (loot.berries) { player.berries = U.clamp(player.berries + loot.berries, 0, player.berryMax); if (player.heldBerry) player.heldBerry.visible = player.berries > 0; parts.push('+' + loot.berries + ' 🍓'); }
    if (loot.bandaids) { player.bandaids += loot.bandaids; parts.push('+' + loot.bandaids + ' 🩹'); }
    if (loot.shells && player.hasShotgun) { player.shells += loot.shells; parts.push('+' + loot.shells + ' 🔫'); }
    if (loot.food) { player.hunger = U.clamp(player.hunger + loot.food, 0, 100); parts.push('+' + loot.food + ' 🍖'); }
    W.hud.toast('Looted a chest! ' + parts.join('  '));
  };

  // --- Fishing: cast a line by a lake, wait, reel in a fish for food ----------
  function nearWater() {
    if (W.world.isWater(player.pos.x, player.pos.z)) return true;
    for (let a = 0; a < 6.28; a += 0.7) {
      if (W.world.isWater(player.pos.x + Math.cos(a) * 2.8, player.pos.z + Math.sin(a) * 2.8)) return true;
    }
    return false;
  }
  player.tryFish = function () {
    if (player._fishUntil) { W.hud.toast('Already fishing… hold still 🎣'); return true; }
    if (!nearWater()) return false;
    player._fishUntil = player._t + U.rand(1.8, 3.6);
    W.hud.toast('Casting a line… 🎣 (hold still)');
    return true;
  };

  // --- Mounts: hop on a horse to gallop around (M) ----------------------------
  player.toggleMount = function () {
    if (!player.alive || !player.active) return;
    if (player._mount) {                          // dismount: drop the horse beside you
      const h = player._mount; h.ridden = false; player._mount = null;
      const sx = Math.cos(player.yaw), sz = Math.sin(player.yaw);
      h.group.position.set(player.pos.x + sx * 1.8, W.world.heightAt(player.pos.x, player.pos.z), player.pos.z + sz * 1.8);
      W.hud.toast('Dismounted 🐴');
      return;
    }
    const h = W.world.nearestHorse && W.world.nearestHorse(player.pos, 3.4);
    if (!h) { W.hud.toast('No horse nearby to ride 🐴'); return; }
    if (player._fishUntil) player._fishUntil = 0;
    h.ridden = true; player._mount = h;
    W.hud.toast('Giddy-up! 🐴 — M to dismount, faster on horseback');
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
    'tent': { kind: 'tent', cost: 25, dist: 3.2, name: 'Tent' },
    'fire': { kind: 'campfire', cost: 12, dist: 2.4, name: 'Campfire' },
  };
  // Base structures can be built anywhere so you can set up a camp away from spawn.
  const NO_TABLE_NEEDED = { '9': 1, tent: 1, fire: 1 };

  player.craft = function (id) {
    if (!player.alive || !player.active) return;
    // most recipes need a workbench nearby; base structures don't (build a camp anywhere)
    if (!NO_TABLE_NEEDED[id] && !W.world.nearCraftTable(player.pos, 3.6)) {
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
    } else if (id === 'katana') {            // Katana (one-time, stronger blade)
      if (player.hasKatana) { W.hud.toast('Already have a katana'); return; }
      if (!pay(20)) return;
      player.hasKatana = true; player.attackDmg += 6; player.attackRange += 0.6; equipWeapon('katana');
      W.hud.toast('Katana forged! 🗡️ sharp & long · press X to switch');
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

  // R: sit on a nearby chair (press again, or move, to stand up).
  const SIT_EYE = 0.85;
  player.sit = function () {
    if (!player.alive || player.downed || !player.active) return;
    if (player.sitting) { player.standUp(); return; }
    if (player.building) player.cancelBuild();
    const s = W.world.nearestSeat(player.pos, 1.8);
    if (!s) { W.hud.toast('No seat nearby 🪑'); return; }
    player.sitting = true; player._seat = s;
    player.pos.set(s.x, s.y + SIT_EYE, s.z);
    player.yaw = s.yaw;
    W.hud.toast('Took a seat 🪑 — R or move to stand');
  };
  player.standUp = function () {
    if (!player.sitting) return;
    player.sitting = false; player._seat = null;
    W.hud.toast('Stood up');
  };

  // P: plant a sapling on the ground ahead of you; it grows into a tree.
  player.plant = function () {
    if (!player.alive || !player.active) return;
    if (player.saplings <= 0) { W.hud.toast('No saplings — chop trees to find some 🌱'); return; }
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const x = player.pos.x + (-sin) * 2.2, z = player.pos.z + (-cos) * 2.2;
    if (W.world.isWater(x, z)) { W.hud.toast("Can't plant in water 💧"); return; }
    player.saplings -= 1;
    W.world.plantSapling(x, z);
    W.hud.toast('🌱 Planted a sapling (' + player.saplings + ' left)');
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
    if (!W.world.canSleep(player.pos)) { W.hud.toast('Get in a tent or hotel to sleep 🛏️'); return; }
    if (W.world.stuffiesBroken) {
      const left = 5 - (W.world._dayCount - W.world._stuffieBreakDay);
      W.hud.toast('🧸 Your stuffies are wrecked — no sleep for ' + left + ' more day' + (left === 1 ? '' : 's'));
      return;
    }
    if (!W.world.isNight()) { W.hud.toast('You can only sleep at night 🌙'); return; }
    if (W.enemies.anyHostileNear && W.enemies.anyHostileNear(player.pos, 5)) {
      W.hud.toast('Too dangerous to sleep — a hostile is within 5m!'); return;
    }
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
    if (player.arrows && player.arrows.length) updateArrows(dt);   // arrows fly even while sitting/sleeping
    if (player._dmgNums && player._dmgNums.length) updateDamageNums(dt);
    if (player._treeBars && player._treeBars.length) updateTreeBars();
    if (!player.alive) return;
    if (player.downed) {
      player.bleedT += dt;
      player.camera.position.copy(player.pos); player.camera.position.y -= 0.95;
      player.camera.rotation.set(-0.55, player.yaw, 0, 'YXZ');
      if (player.bleedT > 60) { player.downed = false; player.alive = false; W.onDeath && W.onDeath(); }
      return;
    }
    if (player.sleeping) {
      // a hostile creeping within 5m jolts you awake
      if (W.enemies.anyHostileNear && W.enemies.anyHostileNear(player.pos, 5)) {
        player.wake(true); W.hud.toast('A hostile crept up — sleep interrupted!');
      } else {
        player.sleepT += dt;
        player.camera.position.copy(player.pos);
        player.camera.rotation.y = player.yaw; player.camera.rotation.x = player.pitch;
        W.hud.setSleepCount(Math.max(0, Math.ceil(5 - player.sleepT)), player.sleepT >= 5);
        return;
      }
    }
    // sitting: hold still on the chair, look around freely; any movement stands you up
    if (player.sitting) {
      const sk = player.keys;
      if (sk.KeyW || sk.KeyS || sk.KeyA || sk.KeyD || sk.Space) {
        player.standUp();
      } else {
        const L = 2.0;
        if (sk.ArrowLeft) player.yaw += L * dt;
        if (sk.ArrowRight) player.yaw -= L * dt;
        if (sk.ArrowUp) player.pitch = U.clamp(player.pitch + L * dt, -1.55, 1.55);
        if (sk.ArrowDown) player.pitch = U.clamp(player.pitch - L * dt, -1.55, 1.55);
        const s = player._seat;
        player.camera.position.set(s.x, s.y + SIT_EYE, s.z);
        player.camera.rotation.y = player.yaw; player.camera.rotation.x = player.pitch;
        animateAxe(dt, false);
        return;
      }
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
    const speed = SPEED * (wantSprint ? SPRINT : 1) * (player.speedMult || 1) * (player._mount ? 2.2 : 1);   // horseback = fast

    player.pos.x += wishX * speed * dt;
    player.pos.z += wishZ * speed * dt;
    W.world.resolveCollision(player.pos, C.PLAYER_RADIUS, player.pos.y - C.EYE_HEIGHT);  // feet height: jump over low walls

    // keep inside the world
    const fromC = Math.hypot(player.pos.x, player.pos.z);
    if (fromC > C.WORLD_RADIUS + 6) {
      player.pos.x *= (C.WORLD_RADIUS + 6) / fromC;
      player.pos.z *= (C.WORLD_RADIUS + 6) / fromC;
    }

    // --- vertical (gravity, jump, terrain + building floors/stairs) ---
    const feetY = player.pos.y - C.EYE_HEIGHT;
    let standY = W.world.heightAt(player.pos.x, player.pos.z);
    if (W.world.standHeight) {
      const s = W.world.standHeight(player.pos.x, player.pos.z, feetY);
      if (s > standY) standY = s;
    }
    const groundEye = standY + C.EYE_HEIGHT;
    if (player.grounded && k.Space) { player.vy = JUMP; player.grounded = false; }
    player.vy -= GRAV * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= groundEye) {
      player.pos.y = groundEye; player.vy = 0; player.grounded = true;
    } else if (player.grounded) {
      // follow gentle slopes / steps up; fall when stepping off a ledge
      if (player.pos.y - groundEye <= 0.6) { player.pos.y = groundEye; player.vy = 0; }
      else player.grounded = false;
    }

    // --- stats ---
    const atBase = W.world.nearCamp(player.pos);   // the camp is a safe haven

    // stamina: infinite at base, otherwise drains while sprinting / recovers at rest
    if (atBase) player.stamina = 100;
    else if (wantSprint) player.stamina = U.clamp(player.stamina - 12 * dt, 0, 100);
    else player.stamina = U.clamp(player.stamina + 15 * dt, 0, 100);

    // hunger & thirst: recover fast at base (10x), otherwise tick down
    if (atBase) {
      player.hunger = U.clamp(player.hunger + 25 * dt, 0, 100);
      player.thirst = U.clamp(player.thirst + 25 * dt, 0, 100);
    } else {
      player.hunger = U.clamp(player.hunger - 0.45 * dt, 0, 100);                   // lasts longer
      player.thirst = U.clamp(player.thirst - 1.15 * dt, 0, 100);
    }
    if (player.hunger <= 0) player.takeDamage(2.2 * dt);
    if (player.thirst <= 0) player.takeDamage(2.0 * dt);
    if (player.hunger > 40 && player.thirst > 25 && player._t - player.lastHurt > 4) {
      player.health = U.clamp(player.health + 1.6 * dt, 0, 100);
    }
    // resting at the base / village heals you very fast (2x the old rate)
    if (atBase && player._t - player.lastHurt > 1.5) {
      player.health = U.clamp(player.health + 70 * dt, 0, 100);
    }

    // --- apply to camera ---
    player.camera.position.copy(player.pos);
    player.camera.rotation.y = player.yaw;
    player.camera.rotation.x = player.pitch;

    // head bob
    const bob = moving && player.grounded ? Math.sin(player._t * (wantSprint ? 14 : 9)) * 0.04 : 0;
    player.camera.position.y += bob;

    // riding a horse: sit up high, place the horse under you, gallop its legs
    if (player._mount) {
      player.camera.position.y += 1.05;
      const h = player._mount.group;
      h.position.set(player.pos.x, W.world.heightAt(player.pos.x, player.pos.z), player.pos.z);
      h.rotation.y = player.yaw + Math.PI;
      const gait = moving ? Math.sin(player._t * 13) * 0.55 : Math.sin(player._t * 2) * 0.05;
      const lg = h.userData.legs;
      lg[0].rotation.x = gait; lg[3].rotation.x = gait;
      lg[1].rotation.x = -gait; lg[2].rotation.x = -gait;
    }

    // fishing: cancels if you move; otherwise reel in after the wait
    if (player._fishUntil) {
      if (moving) { player._fishUntil = 0; W.hud.toast('Line reeled in'); }
      else if (player._t >= player._fishUntil) {
        player._fishUntil = 0;
        if (U.chance(0.82)) {
          player.hunger = U.clamp(player.hunger + 26, 0, 100);
          player.fishCaught = (player.fishCaught || 0) + 1;
          W.hud.toast('Caught a fish! 🐟 +26 food');
        } else W.hud.toast('It got away…');
      }
    }

    animateAxe(dt, moving);
    animateBottle(dt);
    updateBottleWater();

    // keep the build hologram floating where you're aiming
    if (player.building) {
      const a = buildAheadPos(player.building.dist);
      player.building.ghost.position.set(a.x, W.world.heightAt(a.x, a.z), a.z);
      player.building.ghost.rotation.y = player.yaw;
    }

    // contextual hint when you wander up to a chair
    const nearSeat = W.world.nearestSeat ? W.world.nearestSeat(player.pos, 1.8) : null;
    if (nearSeat && !player._seatHint) { player._seatHint = true; W.hud.toast('Press R to sit 🪑'); }
    else if (!nearSeat && player._seatHint) { player._seatHint = false; }
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

  // Minecraft-style bow: draw the string + arrow back, loose at full draw, then re-nock.
  const DRAW_TIME = 0.7;   // seconds to reach a full draw
  function animateBow(dt, moving, w, rest, home) {
    const nock = player.bowNock, nh = player._nockHome;
    // release recoil: the bow snaps forward, then re-nocks a fresh arrow
    if (player._bowSnap !== undefined) {
      player._bowSnap += dt / 0.16;
      if (player._bowSnap >= 1) {
        player._bowSnap = undefined;
        w.rotation.copy(rest); w.position.copy(home);
        if (nock) { nock.position.copy(nh); nock.visible = true; }
        return;
      }
      const s = 1 - player._bowSnap;
      w.rotation.copy(rest); w.rotation.x = rest.x + s * 0.07;
      w.position.copy(home); w.position.z = home.z + s * 0.05;
      return;
    }
    if (player._bowDrawing) {                          // pulling the string back (held)
      player._bowCharge = Math.min(1, (player._bowCharge || 0) + dt / DRAW_TIME);
      const draw = U.smooth(player._bowCharge);
      w.position.copy(home);
      w.position.z = home.z + draw * 0.10;
      w.position.x = home.x - draw * 0.03 + (player._bowCharge >= 1 ? Math.sin(player._t * 34) * 0.004 : 0); // full-draw tension jitter
      w.rotation.copy(rest); w.rotation.x = rest.x - draw * 0.10;
      if (nock && nock.visible) nock.position.z = nh.z + draw * 0.24;  // arrow + string draw toward your eye
    } else {
      const sway = moving ? Math.sin(player._t * 9) * 0.04 : Math.sin(player._t * 2) * 0.012;
      w.rotation.copy(rest); w.rotation.z = rest.z + sway;
      w.position.copy(home);
    }
  }

  function animateAxe(dt, moving) {
    const w = player.weapon;
    if (!w) return;
    const rest = player.weaponRest, home = player.weaponHome;
    if (player.currentWeapon === 'bow') { animateBow(dt, moving, w, rest, home); return; }
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
      sitting: false, _seat: null, _seatHint: false,
      hasShotgun: false, shells: 0, hasBow: true, saplings: 0,
      health: 100, stamina: 100, hunger: 100, thirst: 100,
      bottle: 5, bottleMax: 5, berries: 0, wood: 0, kills: 0, vy: 0,
      attackDmg: 2, attackRange: 4.0, armor: 1.0, axeLevel: 0, hasArmor: false, hasSword: false, hasKatana: false, hasShield: false, currentWeapon: 'bow',
    });
  };

  W.player = player;
})();
