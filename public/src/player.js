/* First-person controller: look, movement, stats, axe + attack, eating. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;
  const C = W.CONFIG;

  // Everyone starts with nothing — all your gear (axe, Deagle, meat) comes from the starter crate.
  const START_WOOD = 0;

  const player = {
    active: false,
    alive: true,
    downed: false, bleedT: 0, bandaids: 0, ghost: false, ghostT: 0,
    sleeping: false, sleepT: 0, hugStuffie: null,
    building: null, invOpen: false,
    sitting: false, _seat: null, _seatHint: false,
    hasShotgun: false, shells: 0,
    hasRifle: false, rounds: 0,                                                // rifle is a rare 5% chest find
    hasDeagle: false, deagleRounds: 0,                                         // Desert Eagle — from your starter box (7 rounds, 150 dmg)
    hasFists: true, hasAxe: false, wolfMeat: 0, cookedMeat: 0,                 // you start bare-fisted; wolfMeat = raw (cook it), cookedMeat = edible
    hasBow: false, arrowCount: 0, bowColor: 0x7a4a24, arrowColor: 0xe6c54a,   // bow is chest-only; arrows are limited ammo
    saplings: 0,
    berries: 0, berryMax: 5,
    health: 100, stamina: 100, hunger: 100, thirst: 100,
    bottle: 5, bottleMax: 5,
    wood: START_WOOD, kills: 0,
    banditKills: 0, treelingCoins: 0,                 // 5 bandit kills -> 1 Treeling Coin
    attackDmg: 2, attackRange: 4.0, armor: 1.0,        // upgraded by crafting
    axeLevel: 0,
    craftOpen: false, hasArmor: false, hasSword: false, hasKatana: false, hasMace: false, hasShield: false, currentWeapon: 'fists',
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

    buildFists(camera);
    buildAxe(camera);
    buildSword(camera);
    buildKatana(camera);
    buildMace(camera);
    buildScythe(camera);
    buildShotgun(camera);
    buildRifle(camera);
    buildDeagle(camera);
    buildBow(camera);
    buildShield(camera);
    buildBottle(camera);
    buildHeldBerry(camera);
    equipWeapon('fists');               // start bare-fisted — open your starter box for the axe & Deagle
    player.dropped = [];

    // --- input: WASD move, trackpad/mouse look, click attack, etc. ---
    window.addEventListener('keydown', (e) => {
      player.keys[e.code] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyQ' && !e.repeat) player.pressAttack();
      if (e.code === 'KeyX') player.switchWeapon();
      if (e.code === 'KeyE') player.eat();
      if (e.code === 'KeyF') player.interactF();
      if (e.code === 'KeyG') player.grab();
      if (e.code === 'KeyH') player.dropBerry();
      if (e.code === 'KeyB') player.useBandaid();
      if (e.code === 'KeyZ') player.zipTent();
      if (e.code === 'KeyK') { if (!(W.sack && W.sack.dropFromSack && W.sack.dropFromSack())) player.sleep(); }   // drop a sacked item, else sleep
      if (e.code === 'KeyR') player.sit();
      if (e.code === 'KeyU') player.plant();
      if (e.code === 'KeyM') player.toggleMount();
      if (e.code === 'KeyT' && player.active) W.critters.tryTame(player.pos);
      if (e.code === 'KeyV') player.teleportVillage();
      if (e.code === 'KeyJ') { if (!(W.sack && W.sack.pocketLookedAt && W.sack.pocketLookedAt())) W.hud.showKeyHelp(true); }   // pocket the item you're eyeing, else show controls
      if (e.code === 'KeyI') player.toggleInventory();
      if (e.code === 'KeyC') {
        if (player.building) { player.cancelBuild(); return; }   // C also cancels a pending build
        if (!player.craftOpen && !W.world.canCraftHere(player.pos)) {
          W.hud.toast('Craft near a workbench, village house or hotel 🛠️'); return;
        }
        player.craftOpen = !player.craftOpen; W.hud.toggleCraft(player.craftOpen); refreshCraft();
      }
      if (e.code === 'KeyL') player.toggleBuildMenu();
      // King: 0 opens the knight command menu; while it's open, 1–5 pick a formation
      if (player.knights && player.knights.length && !player.craftOpen && !player.buildOpen) {
        if (e.code === 'Digit0') { player.toggleKnightMenu(); return; }
        if (player._knightMenuOpen && /^Digit[1-5]$/.test(e.code)) { player.knightCommand(+e.code.slice(5)); return; }
      }
      if (player.craftOpen) {
        if (/^Digit[0-9]$/.test(e.code)) player.craft(e.code.slice(5));
        else if (e.code === 'Minus') player.craft('tent');
        else if (e.code === 'Equal') player.craft('fire');
        else if (e.code === 'BracketLeft') player.craft('katana');
      } else if (player.buildOpen && /^Digit[1-9]$/.test(e.code)) {
        player.pickBuild(+e.code.slice(5) - 1);
      } else if (/^Digit[0-9]$/.test(e.code)) {                 // number keys pick a hotbar slot (1-9, 0)
        const d = e.code.slice(5); player.selectSlot(d === '0' ? 9 : (+d - 1));
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
  // A heavy spiked mace — a wooden haft topped by a studded iron ball (the Juggernaut's weapon).
  function buildMace(camera) {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.45, metalness: 0.65 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.92, 8), wood); haft.position.y = 0.36; g.add(haft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), dark); grip.position.y = 0.02; g.add(grip);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), iron); ball.position.y = 0.95; g.add(ball);
    const dirs = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, t = (i % 2 ? 0.5 : -0.5); dirs.push(new THREE.Vector3(Math.cos(a) * Math.cos(t), Math.sin(t), Math.sin(a) * Math.cos(t))); }
    dirs.push(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.4, 0.3, 0.4));
    for (const d of dirs) { const n = d.clone().normalize(); const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.17, 5), iron); sp.position.set(n.x * 0.2, 0.95 + n.y * 0.2, n.z * 0.2); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); sp.castShadow = true; g.add(sp); }
    g.position.set(0.36, -0.46, -0.66);
    g.rotation.set(-0.2, -0.3, 0.1);
    g.scale.setScalar(0.85);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.mace = g;
  }
  function buildScythe(camera) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd2d7df, roughness: 0.22, metalness: 0.78, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: 0x8a1030, emissive: 0xd0204a, emissiveIntensity: 1.1, roughness: 0.4 });
    // long wooden snath (the shaft), running up the screen
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 2.1, 8), wood); pole.position.y = 0.5; g.add(pole);
    // the classic curved crescent blade sweeping off the TOP of the shaft (a flattened torus arc)
    const bladeGrp = new THREE.Group(); bladeGrp.position.set(0, 1.55, 0);
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.045, 5, 26, Math.PI * 0.92), steel);
    blade.scale.set(1, 1, 0.32);                       // flatten the tube into a thin blade
    blade.rotation.set(Math.PI / 2, 0, -0.35);         // lay it flat, sweeping forward from the shaft
    bladeGrp.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 4), steel);   // pointed tip at the far end of the arc
    tip.position.set(-0.52, 0, 0.34); tip.rotation.set(Math.PI / 2, 0, 1.2); bladeGrp.add(tip);
    g.add(bladeGrp);
    // wrapped collar + glowing red gem where blade meets shaft
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 8), wood); collar.position.y = 1.5; g.add(collar);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), glow); gem.position.y = 1.5; g.add(gem);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8), wood); grip.position.set(0.12, 0.55, 0); grip.rotation.z = Math.PI / 2; g.add(grip);   // hand-grip
    g.position.set(0.42, -0.62, -0.78); g.rotation.set(-0.12, -0.45, 0.16); g.scale.setScalar(0.55); g.visible = false;
    g.userData.rest = g.rotation.clone(); g.userData.home = g.position.clone();
    camera.add(g); player.scythe = g;
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

  // A rifle: long barrel, wooden stock, scope + magazine — a rare chest find.
  function buildRifle(camera) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.35, metalness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4326, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.5, metalness: 0.4 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 10), metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.5); g.add(barrel);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), wood); body.position.set(0, 0, -0.02); g.add(body);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.3), wood); stock.position.set(0, -0.03, 0.28); g.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), dark); mag.position.set(0, -0.16, 0.02); mag.rotation.x = 0.15; g.add(mag);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), dark); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.11, -0.02); g.add(scope);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), wood); grip.position.set(0, -0.13, 0.12); grip.rotation.x = -0.35; g.add(grip);
    g.position.set(0.32, -0.38, -0.6);
    g.rotation.set(-0.04, 0, 0);
    g.scale.setScalar(0.95);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.rifle = g;
  }

  // Bare fists — a simple gloved hand shown when you carry no weapon.
  function buildFists(camera) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a878, roughness: 1 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1 });
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.24), skin); fist.position.set(0, 0, -0.06); g.add(fist);
    for (let i = 0; i < 4; i++) { const kn = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.06), skin); kn.position.set(-0.07 + i * 0.047, 0.05, -0.19); g.add(kn); }
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.18), sleeve); wrist.position.set(0, -0.02, 0.12); g.add(wrist);
    g.position.set(0.34, -0.42, -0.5);
    g.rotation.set(-0.1, -0.1, 0);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.fists = g;
  }

  // A Desert Eagle — a heavy chrome pistol (your starter-box sidearm).
  function buildDeagle(camera) {
    const g = new THREE.Group();
    const chrome = new THREE.MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.25, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5, metalness: 0.5 });
    const gripM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.5), chrome); slide.position.set(0, 0.02, -0.16); g.add(slide);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), chrome); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.44); g.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.24, 0.12), gripM); grip.position.set(0, -0.16, 0.08); grip.rotation.x = 0.28; g.add(grip);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 12), dark); guard.position.set(0, -0.05, -0.04); g.add(guard);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), dark); trig.position.set(0, -0.06, -0.03); g.add(trig);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), dark); sight.position.set(0, 0.09, -0.35); g.add(sight);
    g.position.set(0.3, -0.36, -0.55);
    g.rotation.set(-0.03, 0, 0);
    g.scale.setScalar(1.0);
    g.visible = false;
    g.userData.rest = g.rotation.clone();
    g.userData.home = g.position.clone();
    camera.add(g);
    player.deagle = g;
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

  const WEAPON_OBJ = () => ({ fists: player.fists, axe: player.axe, sword: player.sword, katana: player.katana, mace: player.mace, scythe: player.scythe, shotgun: player.shotgun, rifle: player.rifle, deagle: player.deagle, bow: player.bow });
  function equipWeapon(which) {
    const have = { fists: true, axe: !!player.hasAxe, bow: !!player.hasBow, sword: !!player.hasSword, katana: !!player.hasKatana, mace: !!player.hasMace, scythe: !!player.hasScythe, shotgun: !!player.hasShotgun, rifle: !!player.hasRifle, deagle: !!player.hasDeagle };
    if (!have[which]) which = player.hasAxe ? 'axe' : 'fists';
    player._bowDrawing = false; player._bowCharge = 0; player._bowSnap = undefined;   // cancel any draw
    if (player.bowNock && player._nockHome) { player.bowNock.visible = true; player.bowNock.position.copy(player._nockHome); }
    const objs = WEAPON_OBJ();
    if (player.fists) player.fists.visible = which === 'fists';
    if (player.katana) player.katana.visible = which === 'katana';
    if (player.mace) player.mace.visible = which === 'mace';
    if (player.scythe) player.scythe.visible = which === 'scythe';
    player.axe.visible = which === 'axe';
    if (player.sword) player.sword.visible = which === 'sword';
    if (player.shotgun) player.shotgun.visible = which === 'shotgun';
    if (player.rifle) player.rifle.visible = which === 'rifle';
    if (player.deagle) player.deagle.visible = which === 'deagle';
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

  // Equip whatever weapon a class handed us (called once after the class is applied).
  player.equipCurrent = function () { equipWeapon(player.currentWeapon || 'fists'); };

  // X cycles through the weapons you own (bow → axe → sword → shotgun).
  player.switchWeapon = function () {
    const order = ['fists'];
    if (player.hasBow) order.push('bow');
    if (player.hasAxe) order.push('axe');
    if (player.hasSword) order.push('sword');
    if (player.hasKatana) order.push('katana');
    if (player.hasMace) order.push('mace');
    if (player.hasScythe) order.push('scythe');
    if (player.hasShotgun) order.push('shotgun');
    if (player.hasRifle) order.push('rifle');
    if (player.hasDeagle) order.push('deagle');
    if (order.length === 1) { W.hud.toast('Open your starter box (F) for the Deagle & axe'); return; }
    const i = order.indexOf(player.currentWeapon);
    equipWeapon(order[(i + 1) % order.length]);
    if (W.sfx) W.sfx.select();
    W.hud.toast({ fists: '👊 Fists', bow: '🏹 Bow', axe: '🪓 Axe', sword: '⚔️ Sword', katana: '🗡️ Katana', mace: '🔨 Spiked Mace', scythe: '🌾 Vampire Scythe', shotgun: '🔫 Sawed-off shotgun', rifle: '🎯 Rifle', deagle: '🔫 Desert Eagle' }[player.currentWeapon] + ' equipped');
  };

  // --- 10-slot number-key hotbar (press 1-9,0) --------------------------------
  // Fixed layout: sack (opens the bag/inventory), then your weapons. Slots for
  // gear you haven't found yet are locked/dimmed. Resource counts (wood etc.)
  // live in the inventory (press I).
  const SACK = { key: 'sack', ic: '🎒', name: 'Sack' };
  const WEAPONS = [
    { key: 'axe', ic: '🪓', name: 'Axe' },
    { key: 'deagle', ic: '🔫', name: 'Desert Eagle' },
    { key: 'bow', ic: '🏹', name: 'Bow' },
    { key: 'shotgun', ic: '🔫', name: 'Shotgun' },
    { key: 'rifle', ic: '🎯', name: 'Rifle' },
    { key: 'sword', ic: '⚔️', name: 'Sword' },
    { key: 'katana', ic: '🗡️', name: 'Katana' },
    { key: 'scythe', ic: '🌾', name: 'Vampire Scythe' },
    { key: 'mace', ic: '🔨', name: 'Spiked Mace' },
  ];
  const OWN_FLAG = { axe: 'hasAxe', deagle: 'hasDeagle', bow: 'hasBow', shotgun: 'hasShotgun', rifle: 'hasRifle', sword: 'hasSword', katana: 'hasKatana', scythe: 'hasScythe', mace: 'hasMace' };
  // Pack owned gear into the EARLIEST free slots — no fixed gaps: slot 1 = sack,
  // then each weapon you actually own fills 2, 3, 4… in order (nothing lands on
  // slot 6/8 while earlier slots sit empty).
  function packedHotbar() {
    const list = [SACK];
    for (const w of WEAPONS) if (player[OWN_FLAG[w.key]]) list.push(w);
    return list;
  }
  Object.defineProperty(player, 'hotbar', { configurable: true, get: packedHotbar });
  player.slotOwned = (s) => !!s;                                            // only owned gear is in the packed list
  player.selectSlot = function (i) {
    const s = packedHotbar()[i]; if (!s) return;
    if (s.key === 'sack') { player.toggleInventory(); return; }            // slot 1: open the bag / see your wood etc.
    equipWeapon(s.key); if (W.sfx) W.sfx.select();
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
    if (!player.alive || !player.active || player.ghost) return;   // ghosts can't attack
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
      if (!player.isKawaii && (player.arrowCount || 0) <= 0) {   // limited ammo — out of arrows (Kawaii's are endless)
        if (player.bowNock) player.bowNock.visible = false;
        if (player._t - (player._noAmmoT || 0) > 1.2) { player._noAmmoT = player._t; W.hud.toast('Out of arrows! 🏹 Find more in chests'); }
        return;
      }
      if (!player.isKawaii) player.arrowCount -= 1;
      player.lastAttack = player._t;
      if (W.sfx) W.sfx.bow();
      fireArrow(charge);
      if (player.bowNock) player.bowNock.visible = false;
      player._bowSnap = 0;                // release recoil (HUD ammo refreshes each frame)
    }
  };

  player.attack = function () {
    if (!player.alive || !player.active) return;
    const now = player._t;
    const cd = player.currentWeapon === 'scythe' ? 1.1 : ATTACK_CD;   // the scythe swings slow but hits like a truck
    if (now - player.lastAttack < cd) return;
    player.lastAttack = now;
    player.swing = 0; // drives the swing / recoil animation

    if (player.currentWeapon === 'shotgun') { fireShotgun(); return; }
    if (player.currentWeapon === 'rifle') { fireRifle(); return; }
    if (player.currentWeapon === 'deagle') { fireDeagle(); return; }

    // melee swing whoosh (heavier for the mace / scythe)
    if (W.sfx) { const heavy = player.currentWeapon === 'mace' || player.currentWeapon === 'scythe'; W.sfx[heavy ? 'heavySwing' : 'swing'](); }

    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, player.camera);
    ray.far = player.currentWeapon === 'fists' ? 2.6 : player.attackRange;

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
      let dmg = player.attackDmg;
      if (player.currentWeapon === 'axe') dmg = Math.max(1, Math.round(dmg * 0.55));   // nerf: the axe is a wood-chopper, weak in a real fight
      if (head) dmg = Math.round(dmg * 2.2);
      if (W.net && W.net.role === 'client') {
        W.net.sendHit(root.userData.id, dmg);  // host resolves the damage
      } else {
        const killed = W.enemies.damage(root, dmg, player.pos);
        if (killed) player.creditKill(root.userData.kind);
      }
      // Vampire lifesteal: heal for the damage dealt (2x at night)
      if (player.isVampire) { player.health = Math.min(player.maxHealth, player.health + dmg * ((W.world.isNight && W.world.isNight()) ? 5 : 1)); }
      player.popDamage(root.position, dmg, head);
      if (W.sfx) { if (head) W.sfx.headshot(); else if (player.currentWeapon === 'mace' && W.sfx.maceHit) W.sfx.maceHit(); else W.sfx.hit(); }
      if (head) W.hud.toast('🎯 HEADSHOT! ' + dmg);
    } else if (root.userData.type === 'tree') {
      const dmg = 10 + player.axeLevel * 5;                 // sharper axe = bigger chips
      if (W.sfx) W.sfx.chop();
      const wood = W.world.chopTree(root, dmg);
      showTreeHealth(root, dmg);                            // floating damage + a health bar
      if (wood) {
        // the felled tree's wood drops on the ground — look at it & press J to sack it
        if (W.sack && W.sack.dropWoodAt) { W.sack.dropWoodAt(root.position.x, root.position.z, wood); W.hud.toast('🪵 Timber! ' + wood + ' wood on the ground — look & press J'); }
        else { player.wood += wood; W.hud.toast('+' + wood + ' wood'); }
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
    if (W.sfx) W.sfx.shotgun();
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

  // The rifle: a fast, long-range precision shot — single target, high damage, with a muzzle tracer.
  function fireRifle() {
    if (player.rounds <= 0) { W.hud.toast('Out of rounds 🎯 — find more in chests'); return; }
    player.rounds -= 1;
    if (W.sfx && W.sfx.gun) W.sfx.gun();
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, player.camera);
    ray.far = 90;
    const targets = [];
    W.enemies.list.forEach((e) => { if (e.alive) targets.push(e.group); });
    const hits = ray.intersectObjects(targets, true);
    if (hits.length) {
      const root = findRoot(hits[0].object);
      if (root && root.userData.type === 'enemy') {
        const e = W.enemies.list.find((x) => x.group === root);
        const headY = root.position.y + (W.enemies.headY ? W.enemies.headY(e) : 1.7);
        const head = Math.abs(hits[0].point.y - headY) < 0.5;
        let dmg = 18; if (head) dmg = Math.round(dmg * 2.2);
        if (W.net && W.net.role === 'client') W.net.sendHit(root.userData.id, dmg);
        else { const killed = W.enemies.damage(root, dmg, player.pos); if (killed) player.creditKill(root.userData.kind); }
        player.popDamage(root.position, dmg, head);
        if (head && W.hud) W.hud.toast('🎯 HEADSHOT! ' + dmg);
        if (player.isHunter && (player.classLevel || 1) >= 2 && Math.random() < 0.5) { player.rounds += 1; if (W.hud) W.hud.toast('🎯 Bullet recovered! (' + player.rounds + ')'); }   // Hunter Lv2 perk
      }
    }
    // muzzle tracer down the barrel line
    const dir = player.camera.getWorldDirection(new THREE.Vector3());
    const start = player.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.7);
    const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 30),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.6, fog: false }));
    tracer.position.copy(start.clone().addScaledVector(dir, 15));
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    player.scene.add(tracer);
    setTimeout(() => player.scene.remove(tracer), 70);
    W.hud.toast('🎯 ' + player.rounds + ' rounds left');
  }

  // The Desert Eagle — a hard-hitting hitscan pistol (150 dmg, 7-round mag).
  function fireDeagle() {
    if (player.deagleRounds <= 0) { W.hud.toast('Deagle empty 🔫 — out of rounds'); return; }
    player.deagleRounds -= 1;
    if (W.sfx) (W.sfx.deagle || W.sfx.gun)();
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, player.camera);
    ray.far = 80;
    const targets = [];
    W.enemies.list.forEach((e) => { if (e.alive) targets.push(e.group); });
    const hits = ray.intersectObjects(targets, true);
    if (hits.length) {
      const root = findRoot(hits[0].object);
      if (root && root.userData.type === 'enemy') {
        const e = W.enemies.list.find((x) => x.group === root);
        const headY = root.position.y + (W.enemies.headY ? W.enemies.headY(e) : 1.7);
        const head = Math.abs(hits[0].point.y - headY) < 0.5;
        let dmg = 150; if (head) dmg = Math.round(dmg * 1.5);
        if (W.net && W.net.role === 'client') W.net.sendHit(root.userData.id, dmg);
        else { const killed = W.enemies.damage(root, dmg, player.pos); if (killed) player.creditKill(root.userData.kind); }
        player.popDamage(root.position, dmg, head);
        if (head && W.hud) W.hud.toast('🎯 HEADSHOT! ' + dmg);
      }
    }
    const dir = player.camera.getWorldDirection(new THREE.Vector3());
    const start = player.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6);
    const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.65, fog: false }));
    tracer.position.copy(start.clone().addScaledVector(dir, 12));
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    player.scene.add(tracer);
    setTimeout(() => player.scene.remove(tracer), 70);
    W.hud.toast('🔫 ' + player.deagleRounds + '/7 rounds');
  }

  // The bow: looses a coloured arrow that flies and hits a foe.
  const ARROW_FWD = new THREE.Vector3(0, 0, -1);
  // A pink cupid heart that flies instead of an arrow (Kawaii Fighter).
  function buildHeartArrow() {
    const g = new THREE.Group();
    const pink = new THREE.MeshStandardMaterial({ color: 0xff5aa0, emissive: 0xff2a80, emissiveIntensity: 0.55, roughness: 0.5, flatShading: true });
    for (const sx of [-0.06, 0.06]) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), pink); lobe.position.set(sx, 0.05, 0); g.add(lobe); }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 4), pink); tip.rotation.x = Math.PI; tip.position.set(0, -0.09, 0); g.add(tip);
    return g;
  }
  function fireArrow(charge) {
    const c = charge == null ? 1 : U.clamp(charge, 0, 1);
    const dir = player.camera.getWorldDirection(new THREE.Vector3());
    const start = player.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6);
    start.y -= 0.14;                                   // leaves from the bow, just under the crosshair
    const kawaii = !!player.isKawaii;
    const arrow = kawaii ? buildHeartArrow() : buildFlyingArrow();
    arrow.position.copy(start);
    if (!kawaii) arrow.quaternion.setFromUnitVectors(ARROW_FWD, dir.clone().normalize());
    player.scene.add(arrow);
    const speed = 38 + c * 40;                         // buffed: fuller draw → faster, flatter arrow
    player.arrows.push({ mesh: arrow, vel: dir.clone().multiplyScalar(speed), life: 0, pow: c, heart: kawaii });
  }
  function applyArrow(root, pow, head) {
    const c = pow == null ? 1 : pow;
    let dmg = Math.round(9 + c * 15) + (player.bowDmgBonus || 0);    // buffed: fuller draw hits much harder (up to 24)
    if (head) dmg = Math.round(dmg * 2.2);                           // headshot!
    // Kawaii heart arrows: stun the foe 2s, pop hearts overhead & drop their defense 5s.
    if (player.isKawaii && W.enemies.kawaiiStun) W.enemies.kawaiiStun(root, 2, 5);
    if (W.net && W.net.role === 'client') W.net.sendHit(root.userData.id, dmg);
    else { const killed = W.enemies.damage(root, dmg, player.pos); if (killed) { player.creditKill(root.userData.kind); if (player.isKawaii && player.spawnCupid) player.spawnCupid(); } }   // Kawaii bow kill -> a cupid
    player.popDamage(root.position, dmg, head);
    if (W.sfx) { if (head) W.sfx.headshot(); else W.sfx.hit(); }
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
      if (a.heart) { a.mesh.rotation.z += dt * 7; a.mesh.rotation.y += dt * 2; }   // hearts tumble prettily
      else a.mesh.quaternion.setFromUnitVectors(ARROW_FWD, a.vel.clone().normalize());
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
    if (W.sfx) W.sfx.kill();
    // Bandits (raiders, outlaws & the bandit boss) pay out: every 5 killed = 1 Treeling Coin.
    if (kind === 'bandit' || kind === 'outlaw') {
      player.banditKills += 1;
      if (player.banditKills % 5 === 0) {
        player.treelingCoins = W.classes ? W.classes.addCoins(1) : player.treelingCoins + 1;   // persist to the wallet
        if (W.sfx && W.sfx.coin) W.sfx.coin();
        W.hud.toast('🪙 +1 Treeling Coin! (' + player.treelingCoins + ')');
      } else {
        W.hud.toast('🗡️ Bandit down — ' + (player.banditKills % 5) + '/5 to a 🪙');
      }
    }
    const bonus = kind === 'werewolf' ? 2 : 1;
    if (Math.random() < 0.6) player.wood += bonus;
    // wolves & their kin drop RAW meat into your sack — cook it at a fire before it feeds you
    const meat = { wolf: 1, werewolf: 2, bear: 3 }[kind] || 0;
    if (meat) { player.wolfMeat += meat; W.hud.toast('🥩 +' + meat + ' raw wolf meat — cook it at a fire'); }
    // Hunter: every 5 wolves killed rallies another alpha wolf to the pack
    if (player.isHunter && kind === 'wolf') {
      player._wolfKills = (player._wolfKills || 0) + 1;
      if (player._wolfKills % 5 === 0 && player.spawnAlphaWolf) player.spawnAlphaWolf();
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

  // --- your personal STARTER BOX: spawns at your feet with your name; press F to open ---
  let boxPromptEl = null;
  function boxPrompt() {
    if (boxPromptEl) return boxPromptEl;
    boxPromptEl = document.createElement('div');
    boxPromptEl.id = 'starterBoxPrompt';
    boxPromptEl.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:9;display:none;' +
      'background:rgba(12,16,10,.82);border:2px solid #ffd873;border-radius:10px;padding:8px 16px;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#ffe9b0;text-shadow:0 1px 2px #000;pointer-events:none;white-space:nowrap;";
    document.body.appendChild(boxPromptEl);
    return boxPromptEl;
  }
  function makeStarterBoxMesh(name) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c6631, roughness: 0.9, flatShading: true });
    const woodDk = new THREE.MeshStandardMaterial({ color: 0x6f4622, roughness: 1, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffcf4a, emissive: 0xffb020, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), wood); body.position.y = 0.35; body.castShadow = true; g.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.16, 0.98), woodDk); lid.position.y = 0.78; g.add(lid);
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), woodDk); p.position.set(sx, 0.36, sz); g.add(p); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.06), gold); lock.position.set(0, 0.5, 0.47); g.add(lock);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 84;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(20,24,14,.92)'; c.fillRect(6, 8, 308, 68);
    c.strokeStyle = '#ffd873'; c.lineWidth = 4; c.strokeRect(6, 8, 308, 68);
    c.font = "bold 22px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffe9b0'; c.fillText('📦 ' + name, 160, 30);
    c.font = "bold 15px 'Trebuchet MS',sans-serif"; c.fillStyle = '#bcd48a'; c.fillText('press F to open', 160, 56);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    spr.scale.set(1.7, 0.45, 1); spr.position.y = 1.45; g.add(spr);
    g.userData.tag = spr;
    return g;
  }
  player.spawnStarterBox = function (name) {
    if (player.starterBox && player.starterBox.group) player.scene.remove(player.starterBox.group);
    const nm = (name || 'You').toString().slice(0, 12);
    const dir = new THREE.Vector3(); player.camera.getWorldDirection(dir); dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1); dir.normalize();
    const bx = player.pos.x + dir.x * 2.0, bz = player.pos.z + dir.z * 2.0;
    const g = makeStarterBoxMesh(nm);
    g.position.set(bx, W.world.heightAt(bx, bz), bz);
    player.scene.add(g);
    player.starterBox = { group: g, x: bx, z: bz, opened: false };
  };
  function openStarterBox() {
    const b = player.starterBox; if (!b || b.opened) return;
    b.opened = true;
    player.hasDeagle = true; player.deagleRounds = 7;
    player.hasAxe = true;
    player.cookedMeat += 5;                                   // 5 ready-to-eat cooked meat (eat with E)
    equipWeapon('deagle');
    if (W.sfx) (W.sfx.openbox || W.sfx.select)();
    if (W.hud) { W.hud.banner('📦 STARTER KIT', 'Desert Eagle · Axe · 5 Cooked Meat', '#ffd873'); W.hud.toast('🔫 Deagle (7)  ·  🪓 Axe  ·  🍖 x5 cooked meat'); }
    if (boxPromptEl) boxPromptEl.style.display = 'none';
    player.scene.remove(b.group);
  }
  function nearCampfire() {
    const fires = W.world && W.world.campfires; if (!fires) return false;
    for (const f of fires) if (Math.hypot(player.pos.x - f.x, player.pos.z - f.z) < 3.2) return true;
    return false;
  }
  function cookMeat() {
    const n = player.wolfMeat; if (n <= 0) return;
    player.wolfMeat = 0; player.cookedMeat += n;
    if (W.sfx) (W.sfx.sizzle || W.sfx.eat)();
    if (W.hud) W.hud.toast('🍖🔥 Cooked ' + n + ' wolf meat — eat with E');
  }
  player.interactF = function () {
    const b = player.starterBox;
    if (b && !b.opened && Math.hypot(player.pos.x - b.x, player.pos.z - b.z) < 3.0) { openStarterBox(); return; }
    if (player.playerClass === 'ninja') { player.throwNinjaStar(); return; }   // Ninja: F hurls a shuriken
    if (player.wolfMeat > 0 && nearCampfire()) { cookMeat(); return; }
    player.drink();
  };

  // --- Ninja stars (shuriken) ------------------------------------------------
  function makeNinjaStar() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b93a2, metalness: 0.7, roughness: 0.3, flatShading: true });
    for (let a = 0; a < 4; a++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.09), mat); blade.rotation.y = a * (Math.PI / 4); blade.castShadow = true; g.add(blade); }   // 8-point star
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4 })));
    return g;
  }
  player.throwNinjaStar = function () {
    if (!player.alive || !player.active) return;
    if ((player._starCD || 0) > 0) return;
    player._starCD = 0.24;                                    // rapid throws
    const dir = player.camera.getWorldDirection(new THREE.Vector3());
    const start = player.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6); start.y -= 0.1;
    const star = makeNinjaStar(); star.position.copy(start); player.scene.add(star);
    if (!player._stars) player._stars = [];
    player._stars.push({ mesh: star, vel: dir.clone().multiplyScalar(34), life: 0 });
    if (W.sfx && W.sfx.star) W.sfx.star();
  };
  function updateStars(dt) {
    if (player._starCD > 0) player._starCD -= dt;
    const ss = player._stars; if (!ss || !ss.length) return;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i]; s.life += dt;
      s.vel.y -= 9.8 * dt * 0.18;                             // slight drop
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.y += dt * 34;                           // spin
      let done = false;
      for (const e of W.enemies.list) {
        if (!e.alive) continue;
        const ep = e.group.position, hd = Math.hypot(s.mesh.position.x - ep.x, s.mesh.position.z - ep.z);
        if (hd < 1.0 && s.mesh.position.y > ep.y - 0.2 && s.mesh.position.y < ep.y + 2.9) {
          const dmg = 16;
          if (W.net && W.net.role === 'client') W.net.sendHit(e.group.userData.id, dmg);
          else { const killed = W.enemies.damage(e.group, dmg, player.pos); if (killed) player.creditKill(e.group.userData.kind); }
          player.popDamage(e.group.position, dmg);
          if (W.sfx && W.sfx.hit) W.sfx.hit();
          done = true; break;
        }
      }
      const groundY = W.world.heightAt(s.mesh.position.x, s.mesh.position.z);
      if (done || s.life > 2.6 || s.mesh.position.y < groundY - 0.1) { player.scene.remove(s.mesh); ss.splice(i, 1); }
    }
  }

  player.eat = function () {
    if (!player.alive || !player.active) return;
    // harvest a ripe crop from a nearby farm plot first
    if (W.world.plots) {
      for (const plot of W.world.plots) {
        if (plot.ripe && U.dist2(player.pos.x, player.pos.z, plot.x, plot.z) < 2.6) {
          plot.ripe = false; plot.t = 0;
          player.hunger = U.clamp(player.hunger + 45, 0, 100);
          if (W.sfx) W.sfx.eat();
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
    if (!best) {
      if (player.cookedMeat > 0) {                         // eat COOKED meat from your pack (raw won't feed you)
        player.cookedMeat -= 1;
        player.hunger = U.clamp(player.hunger + 40, 0, 100);
        if (W.sfx) W.sfx.eat();
        W.hud.toast('Ate cooked meat 🍖 +40 food (' + player.cookedMeat + ' left)');
      } else if (player.wolfMeat > 0) {
        W.hud.toast('🥩 Raw meat — cook it at a campfire first (stand by a fire & press F)');
      }
      return;
    }
    best.ready = false;
    best.mesh.userData.berries.forEach((berry) => { berry.visible = false; });
    player.hunger = U.clamp(player.hunger + 35, 0, 100);
    if (W.sfx) W.sfx.eat();
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
    // rare: a RIFLE with a full box of 120 rounds
    if (loot.rifle) {
      player.rounds += (loot.rounds || 120);
      if (!player.hasRifle) { player.hasRifle = true; equipWeapon('rifle'); parts.push('🎯 a RIFLE!'); }
      parts.push('+' + (loot.rounds || 120) + ' rounds 🎯');
    }
    // every chest holds a bundle of arrows; the first chest also contains the BOW itself
    const arrows = U.randInt(5, 12);
    player.arrowCount = (player.arrowCount || 0) + arrows;
    if (!player.hasBow) { player.hasBow = true; if (!loot.rifle) equipWeapon('bow'); parts.push('🏹 a BOW!'); }   // a rifle in the same chest takes priority
    parts.push('+' + arrows + ' arrows 🏹');
    if (loot.rifle) equipWeapon('rifle');   // ensure the shiny new rifle is the one in hand
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
    // most recipes need a crafting spot (workbench / village house / hotel); base structures don't
    if (!NO_TABLE_NEEDED[id] && !W.world.canCraftHere(player.pos)) {
      W.hud.toast('Craft near a workbench, house or hotel 🛠️');
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
    if (W.sfx) W.sfx.craft();
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

  // --- Build menu (L): place structures & building pieces ANYWHERE ------------
  const BUILD_PIECES = [
    { id: 'floor', cost: 4, dist: 2.2, name: 'Wood Floor', ic: '🟫' },
    { id: 'wall', cost: 5, dist: 2.2, name: 'Wall', ic: '🧱' },
    { id: 'doorway', cost: 5, dist: 2.2, name: 'Doorway', ic: '🚪' },
    { id: 'window', cost: 5, dist: 2.2, name: 'Window Wall', ic: '🪟' },
    { id: 'roof', cost: 6, dist: 2.4, name: 'Roof', ic: '🔺' },
    { id: 'pillar', cost: 3, dist: 1.6, name: 'Pillar', ic: '🪵' },
    { id: 'table', cost: 15, dist: 2.0, name: 'Crafting Table', ic: '🛠️' },
    { id: 'tent', cost: 25, dist: 3.2, name: 'Tent', ic: '⛺' },
    { id: 'fire', cost: 12, dist: 2.4, name: 'Campfire', ic: '🔥' },
  ];
  let buildPanelEl = null;
  function ensureBuildPanel() {
    if (buildPanelEl) return buildPanelEl;
    const el = document.createElement('div');
    el.id = 'buildPanel';
    Object.assign(el.style, {
      position: 'fixed', right: '16px', top: '84px', width: '252px', display: 'none',
      background: 'rgba(12,14,10,.72)', borderRadius: '10px', padding: '12px 14px',
      zIndex: 6, font: "13px 'Trebuchet MS',sans-serif", color: '#e9e4d6', backdropFilter: 'blur(2px)',
    });
    document.body.appendChild(el);
    buildPanelEl = el;
    return el;
  }
  function renderBuildPanel() {
    const el = ensureBuildPanel();
    let html = '<div style="font-size:15px;color:#cfe8b6;margin-bottom:8px;letter-spacing:.5px">🏗️ BUILD &nbsp;·&nbsp; Wood <b style="color:#fff">' + player.wood + '</b></div>';
    BUILD_PIECES.forEach((p, i) => {
      html += '<div style="padding:5px 7px;border-radius:6px;background:rgba(0,0,0,.28);margin-bottom:5px">'
        + '<b style="display:inline-block;width:16px;text-align:center;background:#3a4a2a;border-radius:4px;color:#dfeec8">' + (i + 1) + '</b> '
        + p.ic + ' ' + p.name + '<i style="color:#ffce9a;font-style:normal;float:right">' + p.cost + ' 🪵</i></div>';
    });
    html += '<div style="color:#8fae74;font-size:11px;margin-top:4px">press a number · aim &amp; click to place · <b>L</b> to close</div>';
    el.innerHTML = html;
  }
  player.toggleBuildMenu = function () {
    if (!player.alive || !player.active) return;
    if (player.building) player.cancelBuild();
    player.buildOpen = !player.buildOpen;
    if (player.buildOpen && player.craftOpen) { player.craftOpen = false; W.hud.toggleCraft(false); }
    if (player.buildOpen) renderBuildPanel();
    ensureBuildPanel().style.display = player.buildOpen ? 'block' : 'none';
  };
  player.pickBuild = function (idx) {
    const p = BUILD_PIECES[idx];
    if (!p) return;
    if (player.wood < p.cost) { W.hud.toast('Need ' + p.cost + ' wood (have ' + player.wood + ')'); return; }
    player.buildOpen = false; ensureBuildPanel().style.display = 'none';
    startBuild(p.id, { kind: p.id, cost: p.cost, dist: p.dist, name: p.name });
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
      if (W.sfx) W.sfx.drink();
      W.hud.toast('Drank deeply & filled bottle 💧');
      player._drink = 0;
    } else if (player.bottle > 0) {
      player.bottle -= 1;
      player.thirst = U.clamp(player.thirst + 35, 0, 100);
      if (W.sfx) W.sfx.drink();
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
    if (player.health < (player.maxHealth || 100)) {
      player.bandaids -= 1;
      player.health = U.clamp(player.health + 50, 0, player.maxHealth || 100);
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
    if (W.fire && !W.fire.lit()) { W.hud.toast('🔥 The fire is out — feed it wood before you can sleep'); return; }
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
      player.health = U.clamp(player.health + 20, 0, player.maxHealth || 100);
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
    if (!player.alive || player.downed || player.ghost) return;   // ghosts are invulnerable
    if (player.sleeping) player.wake(true);     // a hit jolts you awake
    amount *= player.armor;          // wooden armor reduces incoming damage
    player.health -= amount;
    player.lastHurt = player._t;
    W.hud.flashDamage(U.clamp(amount / 14, 0.25, 0.9));
    if (W.sfx) { if (player.health <= 0) W.sfx.die(); else W.sfx.hurt(); }
    if (player.health <= 0) {
      player.health = 0;
      // Survivor class: chance to cheat death — spring back up instead of dying
      if ((player.reviveChance || 0) > 0 && Math.random() < player.reviveChance) {
        player.health = Math.round((player.maxHealth || 100) * 0.5);
        player.lastHurt = player._t;
        if (W.hud && W.hud.banner) W.hud.banner('✨ SURVIVOR!', 'You cheated death and sprang back up!', '#8fe6ff');
        if (W.sfx && W.sfx.revive) W.sfx.revive();
        return;
      }
      if (W.net && W.net.role) {
        // co-op: turn into a ghost — reach a teammate within 15s to revive
        player.enterGhost();
      } else {
        player.alive = false;
        W.onDeath && W.onDeath();
      }
    }
  };

  // --- Ghost form (co-op death): float to a teammate within 15s to revive ----
  const GHOST_TIME = 15;
  player.enterGhost = function () {
    player.ghost = true; player.ghostT = 0; player.health = 0; player.active = true;
    if (W.net && W.net.sendGhost) W.net.sendGhost(true);
    showGhostHud(true);
    W.hud.banner('YOU DIED 👻', 'Ghost form — touch a teammate within 15s to revive!', '#bcd4ff');
  };
  player.reviveGhost = function () {
    player.ghost = false; player.ghostT = 0; player.health = 50; player.alive = true; player.active = true;
    if (W.net && W.net.sendGhost) W.net.sendGhost(false);
    showGhostHud(false);
    W.hud.banner('REVIVED! 👻➡️🧍', 'A teammate brought you back', '#8fd36a');
  };
  let ghostHud = null;
  function showGhostHud(show) {
    if (!ghostHud && show) {
      ghostHud = document.createElement('div');
      ghostHud.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;display:flex;flex-direction:column;'
        + 'align-items:center;justify-content:flex-start;padding-top:18%;text-align:center;'
        + 'background:radial-gradient(circle at 50% 45%,rgba(120,160,220,.10),rgba(20,30,60,.45));'
        + "font-family:'Trebuchet MS',sans-serif;text-shadow:0 2px 10px #000;";
      ghostHud.innerHTML = '<div style="font-size:34px;font-weight:bold;letter-spacing:2px;color:#cfe0ff">👻 GHOST FORM</div>'
        + '<div style="font-size:15px;color:#aac4ee;margin-top:4px">Reach a teammate to revive</div>'
        + '<div class="gc" style="font-size:60px;font-weight:bold;color:#fff;margin-top:6px">15</div>';
      document.body.appendChild(ghostHud);
    }
    if (ghostHud) ghostHud.style.display = show ? 'flex' : 'none';
  }
  function updateGhost(dt) {
    player.ghostT += dt;
    const k = player.keys;
    // free-fly movement (no collisions), look with arrows + mouse as usual
    if (k.ArrowLeft) player.yaw += 2.0 * dt;
    if (k.ArrowRight) player.yaw -= 2.0 * dt;
    if (k.ArrowUp) player.pitch = U.clamp(player.pitch + 2.0 * dt, -1.45, 1.45);
    if (k.ArrowDown) player.pitch = U.clamp(player.pitch - 2.0 * dt, -1.45, 1.45);
    let fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    let str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const len = Math.hypot(fwd, str) || 1; fwd /= len; str /= len;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw), sp = 8.5;   // glide a bit faster
    player.pos.x += ((-sin) * fwd + cos * str) * sp * dt;
    player.pos.z += ((-cos) * fwd + (-sin) * str) * sp * dt;
    const fly = W.world.heightAt(player.pos.x, player.pos.z) + C.EYE_HEIGHT + 0.7;
    player.pos.y += (fly - player.pos.y) * Math.min(1, dt * 4);
    player.camera.position.copy(player.pos);
    player.camera.rotation.y = player.yaw; player.camera.rotation.x = player.pitch;
    // countdown HUD
    const remain = Math.max(0, GHOST_TIME - player.ghostT);
    if (ghostHud) { const gc = ghostHud.querySelector('.gc'); if (gc) gc.textContent = Math.ceil(remain); }
    // reach a teammate → revive
    const tm = W.net && W.net.nearestTeammate && W.net.nearestTeammate(player.pos);
    if (tm && Math.hypot(tm.x - player.pos.x, tm.z - player.pos.z) < 2.8) { player.reviveGhost(); return; }
    if (player.ghostT >= GHOST_TIME) { player.ghost = false; showGhostHud(false); player.alive = false; W.onDeath && W.onDeath(); }
  }

  // --- Knights of the King: a summoned royal guard that follows you & fights ---
  function makeKnight() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x9098a4, metalness: 0.5, roughness: 0.5, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x9a2b2b, roughness: 1, flatShading: true });    // royal red tabard
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a878, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.4 });
    const blade = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.6, roughness: 0.3 });
    const legs = [];
    for (const sx of [-0.11, 0.11]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), dark); l.position.set(sx, 0.3, 0); l.castShadow = true; g.add(l); legs.push(l); }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.28), steel); torso.position.y = 0.9; torso.castShadow = true; g.add(torso);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.31), cloth); tab.position.set(0, 0.86, 0.0); g.add(tab);
    for (const sx of [-0.3, 0.3]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), steel); a.position.set(sx, 0.9, 0.02); g.add(a); legs.push(a); }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), skin); head.position.y = 1.36; g.add(head);
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.28), steel); helm.position.y = 1.46; g.add(helm);
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), cloth); plume.position.set(0, 1.62, -0.02); g.add(plume);
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), blade); sword.position.set(0.34, 1.06, 0.14); g.add(sword);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), dark); guard.position.set(0.34, 0.78, 0.14); g.add(guard);
    // left-arm heraldic shield — steel plate, red cross, shiny centre boss
    const shieldMat = new THREE.MeshStandardMaterial({ color: 0x707784, metalness: 0.55, roughness: 0.45, flatShading: true });
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.06), shieldMat); shield.position.set(-0.36, 0.98, 0.16); shield.rotation.y = 0.18; shield.castShadow = true; g.add(shield);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.02), cloth); crossV.position.set(-0.36, 0.98, 0.2); crossV.rotation.y = 0.18; g.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.02), cloth); crossH.position.set(-0.36, 1.0, 0.2); crossH.rotation.y = 0.18; g.add(crossH);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), blade); boss.position.set(-0.36, 0.98, 0.22); g.add(boss);
    g.userData.legs = legs;
    return g;
  }
  player.summonKnights = function () {
    const n = player.knightSummons || 0; if (!n || !player.scene) return;
    player.knights = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 2.4 + (i % 6) * 0.85;
      const kx = player.pos.x + Math.cos(a) * r, kz = player.pos.z + Math.sin(a) * r;
      const g = makeKnight();
      g.position.set(kx, W.world.heightAt(kx, kz), kz);
      player.scene.add(g);
      player.knights.push({ g, t: U.rand(0, 6), atk: U.rand(0, 0.8), a, r, hp: 26, maxHp: 26 });
    }
    player.knightMode = 'follow';
    if (W.hud && W.hud.banner) W.hud.banner('👑 KNIGHTS OF THE KING', n + ' knights rally! Press 0 for commands', '#ffe08a');
  };

  // --- Knight command menu (press 0) + formations ---------------------------
  function buildKnightMenu() {
    const d = document.createElement('div');
    d.id = 'knightMenu';
    d.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:9;display:none;' +
      'background:rgba(20,16,6,.93);border:2px solid #ffe08a;border-radius:12px;padding:12px 16px;' +
      "font:bold 14px 'Trebuchet MS',sans-serif;color:#ffe6a8;text-shadow:0 1px 2px #000;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,.6);";
    const opts = ['1 · Follow', '2 · Teleport to me', '3 · Line', '4 · Circle', '5 · Square'];
    d.innerHTML = '<div style="font-size:16px;color:#ffd24a;margin-bottom:9px;letter-spacing:1px;">👑 KNIGHT COMMANDS</div>' +
      '<div style="display:flex;gap:9px;flex-wrap:wrap;justify-content:center;">' +
      opts.map((t) => '<span style="background:rgba(255,224,138,.14);border:1px solid #7a6a3a;border-radius:7px;padding:7px 11px;">' + t + '</span>').join('') +
      '</div><div style="font-size:11px;color:#c9b98a;margin-top:8px;">press <b>1–5</b> to command · <b>0</b> to close</div>';
    document.body.appendChild(d);
    player._knightMenuEl = d;
  }
  player.toggleKnightMenu = function () {
    if (!player._knightMenuEl) buildKnightMenu();
    player._knightMenuOpen = !player._knightMenuOpen;
    player._knightMenuEl.style.display = player._knightMenuOpen ? 'block' : 'none';
  };
  player.closeKnightMenu = function () { player._knightMenuOpen = false; if (player._knightMenuEl) player._knightMenuEl.style.display = 'none'; };
  player.knightCommand = function (nkey) {
    if (nkey === 2) {                                            // teleport all knights to the King
      const ks = player.knights || [];
      for (const k of ks) { const a = Math.random() * Math.PI * 2, r = 1.4 + Math.random() * 1.8; const kx = player.pos.x + Math.cos(a) * r, kz = player.pos.z + Math.sin(a) * r; k.g.position.set(kx, W.world.heightAt(kx, kz), kz); }
      if (W.hud) W.hud.toast('👑 Knights teleported to you!');
    } else {
      const modes = { 1: 'follow', 3: 'line', 4: 'circle', 5: 'square' };
      if (modes[nkey]) { player.knightMode = modes[nkey]; if (W.hud) W.hud.toast('👑 Knights: ' + modes[nkey] + (nkey === 1 ? '' : ' formation')); }
    }
    player.closeKnightMenu();
  };
  player.stepKnights = function (dt) {
    const ks = player.knights; if (!ks || !ks.length) return;
    const foes = (W.enemies && W.enemies.list) || [];
    const host = !(W.net && W.net.role === 'client');
    const n = ks.length, mode = player.knightMode || 'follow';
    const yaw = player.yaw || 0;
    const fdx = -Math.sin(yaw), fdz = -Math.cos(yaw), rdx = -fdz, rdz = fdx;   // King's forward + right
    for (let i = 0; i < n; i++) {
      const k = ks[i]; k.t += dt; const g = k.g;
      // in follow mode knights sweep the field (20m); in formation they only stab adjacent foes
      let tgt = null, bd = (mode === 'follow') ? 36 : 5;   // aggressive: hunt foes from much farther
      for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - g.position.x, e.group.position.z - g.position.z); if (d < bd) { bd = d; tgt = e; } }
      let tx, tz;
      if (tgt) { tx = tgt.group.position.x; tz = tgt.group.position.z; }
      else if (mode === 'circle') { const R = Math.max(4, n * 0.145), ang = (i / n) * Math.PI * 2; tx = player.pos.x + Math.cos(ang) * R; tz = player.pos.z + Math.sin(ang) * R; }
      else if (mode === 'square') { const S = Math.max(4, n * 0.23), half = S / 2, per = (i / n) * 4, seg = Math.floor(per), f = per - seg; let sx, sz; if (seg === 0) { sx = -half + f * S; sz = -half; } else if (seg === 1) { sx = half; sz = -half + f * S; } else if (seg === 2) { sx = half - f * S; sz = half; } else { sx = -half; sz = half - f * S; } tx = player.pos.x + sx; tz = player.pos.z + sz; }
      else if (mode === 'line') { const side = (i - (n - 1) / 2) * 0.8; tx = player.pos.x + rdx * side + fdx * 3; tz = player.pos.z + rdz * side + fdz * 3; }
      else { tx = player.pos.x + Math.cos(k.a + player._t * 0.15) * k.r; tz = player.pos.z + Math.sin(k.a + player._t * 0.15) * k.r; }   // follow: gentle orbit
      const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz) || 1;
      const reach = tgt ? 1.7 : 0.4;
      if (d > reach) {
        const sp = (tgt ? 9.0 : 5.0) * dt; g.position.x += (dx / d) * sp; g.position.z += (dz / d) * sp;
        g.rotation.y = Math.atan2(dx, dz);
        const sw = Math.sin(k.t * 11) * 0.5, lg = g.userData.legs;
        if (lg) { lg[0].rotation.x = sw; lg[1].rotation.x = -sw; lg[2].rotation.x = -sw; lg[3].rotation.x = sw; }
      } else if (tgt) {
        g.rotation.y = Math.atan2(dx, dz);
        k.atk -= dt;
        if (k.atk <= 0) { k.atk = 0.5; if (host && W.enemies.damage) W.enemies.damage(tgt.group, 11, { x: g.position.x, z: g.position.z }); }
        k.hp -= (tgt.dmg || 8) * dt * 0.45;                 // the foe fights back — knights can fall
        if (k.hp <= 0) k.dead = true;
      } else if (mode !== 'follow') {
        g.rotation.y = Math.atan2(g.position.x - player.pos.x, g.position.z - player.pos.z);   // hold: face outward
      }
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(k.t * 8)) * 0.04;
    }
    // clear out any knights that fell in battle
    if (ks.some((k) => k.dead)) {
      for (const k of ks) { if (k.dead && k.g.parent) k.g.parent.remove(k.g); }
      player.knights = ks.filter((k) => !k.dead);
      if (W.hud && W.hud.toast && player._t - (player._knightFellT || 0) > 2.5) {
        player._knightFellT = player._t; W.hud.toast('⚔️ Knights are falling! ' + player.knights.length + ' hold the line');
      }
    }
  };

  // --- Kawaii Fighter: every BOW KILL summons a flying cupid that shoots foes for 60s ---
  const cupidShots = [];
  function makeCupid() {
    const g = new THREE.Group();
    const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, flatShading: true }, o || {}));
    const skin = mat(0xffdcc4), cheekM = mat(0xff9db0, { roughness: 0.85 }), hairM = mat(0xffdf8a);
    const featherM = mat(0xfdfdff, { roughness: 0.55 }), togaM = mat(0xfff2f7, { roughness: 0.7 });
    const gold = mat(0xffe066, { emissive: 0xffcf5a, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.3 });
    const bowM = mat(0xff7ab0, { roughness: 0.55 }), darkM = mat(0x3a2a34, { roughness: 0.5 });
    const heartM = mat(0xff4f92, { emissive: 0xff2f80, emissiveIntensity: 0.5 });

    // chubby cherub body + a little draped toga
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin); body.scale.set(1, 0.92, 1); body.castShadow = true; g.add(body);
    const toga = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.235, 0.15, 12), togaM); toga.position.y = -0.05; toga.rotation.z = 0.12; g.add(toga);
    for (const sx of [-0.1, 0.1]) { const leg = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skin); leg.position.set(sx, -0.22, 0.03); leg.scale.set(1, 1.1, 1); g.add(leg); }
    // arms — the front one holds the little bow
    const armL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin); armL.position.set(-0.24, 0.02, 0.06); armL.scale.set(1, 1.6, 1); armL.rotation.z = 0.5; g.add(armL);
    const armR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin); armR.position.set(0.22, 0.02, 0.1); armR.scale.set(1, 1.6, 1); armR.rotation.z = -0.6; g.add(armR);

    // big cute head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin); head.position.y = 0.36; head.castShadow = true; g.add(head);
    for (const sx of [-0.09, 0.09]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), darkM); eye.position.set(sx, 0.37, 0.18); g.add(eye);
      const gleam = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), featherM); gleam.position.set(sx + 0.012, 0.385, 0.2); g.add(gleam); }
    for (const sx of [-0.13, 0.13]) { const ch = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), cheekM); ch.position.set(sx, 0.31, 0.16); ch.scale.set(1, 0.7, 0.5); g.add(ch); }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), darkM); smile.position.set(0, 0.3, 0.18); smile.rotation.z = Math.PI; g.add(smile);
    // golden curls
    for (const [hx, hy, hz, s] of [[0, 0.52, 0.02, 0.11], [-0.11, 0.48, 0.03, 0.09], [0.11, 0.48, 0.03, 0.09], [-0.05, 0.5, -0.1, 0.08], [0.06, 0.5, -0.1, 0.08]]) {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), hairM); curl.position.set(hx, hy, hz); g.add(curl);
    }
    // halo
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 18), gold); halo.rotation.x = Math.PI / 2 - 0.25; halo.position.y = 0.62; g.add(halo);

    // feathered wings (3 layered feathers each), grouped so they can flap
    const wings = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.075 - i * 0.011, 0.36 - i * 0.05, 6), featherM);
        f.position.set(0, 0.02 + i * 0.055, -0.03 - i * 0.03); f.rotation.x = Math.PI * 0.5 + 0.35; f.scale.set(1, 1, 0.45); f.castShadow = true; w.add(f);
      }
      w.position.set(side * 0.2, 0.05, -0.13); w.rotation.y = side * 0.5; g.add(w); wings.push(w);
    }

    // little bow + a heart-tipped arrow held out front
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 12, Math.PI), bowM); bow.position.set(-0.02, 0.03, 0.24); bow.rotation.y = Math.PI / 2; g.add(bow);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 5), mat(0xe9c07a)); shaft.rotation.x = Math.PI / 2; shaft.position.set(0, 0.03, 0.3); g.add(shaft);
    for (const sx of [-0.03, 0.03]) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), heartM); lobe.position.set(sx, 0.05, 0.42); g.add(lobe); }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 6), heartM); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.02, 0.45); g.add(tip);

    g.userData.wings = wings;
    return g;
  }
  player.spawnCupid = function () {
    if (!player.scene) return;
    if (!player.cupids) player.cupids = [];
    if (player.cupids.length >= 10) return;                        // cap the swarm
    const g = makeCupid();
    const a = Math.random() * Math.PI * 2;
    g.position.set(player.pos.x + Math.cos(a) * 1.6, W.world.heightAt(player.pos.x, player.pos.z) + 2.4, player.pos.z + Math.sin(a) * 1.6);
    player.scene.add(g);
    player.cupids.push({ g, born: player._t, t: Math.random() * 6, shootCD: 0.4, a });
    if (W.hud && W.hud.toast) W.hud.toast('💘 A cupid joins the fight! (60s · ' + player.cupids.length + ')');
  };
  function cupidShoot(from, tgt) {
    const heart = buildHeartArrow();
    const dir = new THREE.Vector3(tgt.group.position.x - from.x, (tgt.group.position.y + 1.0) - from.y, tgt.group.position.z - from.z).normalize();
    heart.position.copy(from); player.scene.add(heart);
    cupidShots.push({ mesh: heart, vel: dir.multiplyScalar(26), life: 0 });
  }
  player.stepCupids = function (dt) {
    const cs = player.cupids; if (!cs || !cs.length) { if (cupidShots.length) stepCupidShots(dt); return; }
    const foes = (W.enemies && W.enemies.list) || [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i], g = c.g; c.t += dt;
      if (player._t - c.born > 60) { if (g.parent) g.parent.remove(g); cs.splice(i, 1); continue; }   // gone after a minute
      let tgt = null, bd = 24;
      for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - g.position.x, e.group.position.z - g.position.z); if (d < bd) { bd = d; tgt = e; } }
      let hx, hz;
      if (tgt && bd > 8) { hx = tgt.group.position.x; hz = tgt.group.position.z; }
      else { hx = player.pos.x + Math.cos(c.a + player._t * 0.4) * 2.4; hz = player.pos.z + Math.sin(c.a + player._t * 0.4) * 2.4; }
      const dx = hx - g.position.x, dz = hz - g.position.z, d = Math.hypot(dx, dz) || 1;
      const sp = 6.0 * dt; if (d > 0.4) { g.position.x += (dx / d) * sp; g.position.z += (dz / d) * sp; }
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + 2.4 + Math.sin(c.t * 2.5) * 0.15;    // flies, bobbing
      if (tgt) g.rotation.y = Math.atan2(tgt.group.position.x - g.position.x, tgt.group.position.z - g.position.z);
      const wg = g.userData.wings; if (wg) { const fl = Math.sin(c.t * 22) * 0.5; wg[0].rotation.z = fl; wg[1].rotation.z = -fl; }
      c.shootCD -= dt;
      if (tgt && bd < 22 && c.shootCD <= 0) { c.shootCD = 0.75; cupidShoot(g.position, tgt); }
    }
    stepCupidShots(dt);
  };
  function stepCupidShots(dt) {
    const host = !(W.net && W.net.role === 'client');
    const foes = (W.enemies && W.enemies.list) || [];
    for (let i = cupidShots.length - 1; i >= 0; i--) {
      const s = cupidShots[i]; s.life += dt; s.mesh.position.addScaledVector(s.vel, dt); s.mesh.rotation.z += dt * 8;
      let hit = false;
      for (const e of foes) {
        if (!e.alive) continue; const ep = e.group.position;
        if (Math.hypot(s.mesh.position.x - ep.x, s.mesh.position.z - ep.z) < 1.2 && s.mesh.position.y > ep.y - 0.3 && s.mesh.position.y < ep.y + 2.6) {
          if (host && W.enemies.damage) { const killed = W.enemies.damage(e.group, 16, { x: s.mesh.position.x, z: s.mesh.position.z }); if (killed && player.creditKill) player.creditKill(e.group.userData.kind); }
          hit = true; break;
        }
      }
      if (hit || s.life > 2.5) { if (s.mesh.parent) s.mesh.parent.remove(s.mesh); cupidShots.splice(i, 1); }
    }
  }

  // --- Hunter: an ALPHA WOLF pack that hunts foes for you ---------------------
  function makeWolfPet() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.1), fur); body.position.y = 0.6; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), fur); head.position.set(0, 0.72, 0.66); g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.26), dark); snout.position.set(0, 0.66, 0.9); g.add(snout);
    for (const sx of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), fur); ear.position.set(sx, 0.98, 0.6); g.add(ear); }
    for (const sx of [-0.1, 0.1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 1.3 })); eye.position.set(sx, 0.78, 0.86); g.add(eye); }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), fur); tail.position.set(0, 0.74, -0.68); tail.rotation.x = 0.5; g.add(tail);
    const legs = [];
    for (const [lx, lz] of [[-0.17, 0.4], [0.17, 0.4], [-0.17, -0.4], [0.17, -0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), dark); leg.position.set(lx, 0.28, lz); leg.castShadow = true; g.add(leg); legs.push(leg);
    }
    g.userData.legs = legs; g.scale.setScalar(1.35);   // alphas are big
    return g;
  }
  player.spawnAlphaWolf = function () {
    if (!player.scene) return;
    if (!player.wolves) player.wolves = [];
    if (player.wolves.length >= 8) return;                         // pack cap
    const a = Math.random() * Math.PI * 2, r = 2.0 + Math.random() * 1.5;
    const wx = player.pos.x + Math.cos(a) * r, wz = player.pos.z + Math.sin(a) * r;
    const g = makeWolfPet(); g.position.set(wx, W.world.heightAt(wx, wz), wz); player.scene.add(g);
    player.wolves.push({ g, t: Math.random() * 6, atk: 0, a, hp: 60, maxHp: 60 });
    if (W.hud && W.hud.toast) W.hud.toast('🐺 An ALPHA WOLF joins your pack! (' + player.wolves.length + ')');
  };
  player.stepWolves = function (dt) {
    const ws = player.wolves; if (!ws || !ws.length) return;
    const foes = (W.enemies && W.enemies.list) || [];
    const host = !(W.net && W.net.role === 'client');
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], g = w.g; w.t += dt;
      let tgt = null, bd = 34;
      for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - g.position.x, e.group.position.z - g.position.z); if (d < bd) { bd = d; tgt = e; } }
      let tx, tz;
      if (tgt) { tx = tgt.group.position.x; tz = tgt.group.position.z; }
      else { tx = player.pos.x + Math.cos(w.a + player._t * 0.2) * 2.6; tz = player.pos.z + Math.sin(w.a + player._t * 0.2) * 2.6; }   // trot around the hunter
      const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz) || 1;
      const reach = tgt ? 1.5 : 0.5;
      if (d > reach) {
        const sp = (tgt ? 11 : 7) * dt; g.position.x += (dx / d) * sp; g.position.z += (dz / d) * sp;
        g.rotation.y = Math.atan2(dx, dz);
        const sw = Math.sin(w.t * 13) * 0.5, lg = g.userData.legs;
        if (lg) { lg[0].rotation.x = sw; lg[1].rotation.x = -sw; lg[2].rotation.x = -sw; lg[3].rotation.x = sw; }
      } else if (tgt) {
        g.rotation.y = Math.atan2(dx, dz);
        w.atk -= dt;
        if (w.atk <= 0) { w.atk = 0.6; if (host && W.enemies.damage) { const killed = W.enemies.damage(tgt.group, 30, { x: g.position.x, z: g.position.z }); if (killed && player.creditKill) player.creditKill(tgt.group.userData.kind); } }   // 5× a normal wolf's bite
        w.hp -= (tgt.dmg || 8) * dt * 0.3;
        if (w.hp <= 0) w.dead = true;
      }
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(w.t * 9)) * 0.03;
    }
    if (ws.some((w) => w.dead)) {
      for (const w of ws) { if (w.dead && w.g.parent) w.g.parent.remove(w.g); }
      player.wolves = ws.filter((w) => !w.dead);
      if (W.hud && W.hud.toast) W.hud.toast('🐺 An alpha wolf fell! ' + player.wolves.length + ' left');
    }
  };

  // --- Hunter: FALCONS that dive-bomb foes and peel away (hit & run) -----------
  function makeFalcon() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1, flatShading: true });
    const light = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 1, flatShading: true });
    const beak = new THREE.MeshStandardMaterial({ color: 0xf0b030, roughness: 0.6, flatShading: true });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), body); b.scale.set(1, 0.9, 1.5); g.add(b);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), body); head.position.set(0, 0.06, 0.22); g.add(head);
    const bk = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), beak); bk.rotation.x = Math.PI / 2; bk.position.set(0, 0.04, 0.34); g.add(bk);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.28), light); tail.position.set(0, 0, -0.3); g.add(tail);
    const wings = [];
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.24), light); w.position.set(sx * 0.32, 0.02, 0); g.add(w); wings.push(w); }
    g.userData.wings = wings; g.scale.setScalar(1.2);
    return g;
  }
  player.spawnFalcon = function () {
    if (!player.scene) return;
    if (!player.falcons) player.falcons = [];
    if (player.falcons.length >= 6) return;                        // sky cap
    const a = Math.random() * Math.PI * 2;
    const g = makeFalcon();
    g.position.set(player.pos.x + Math.cos(a) * 2, W.world.heightAt(player.pos.x, player.pos.z) + 4.5, player.pos.z + Math.sin(a) * 2);
    player.scene.add(g);
    player.falcons.push({ g, t: Math.random() * 6, a, mode: 'orbit', cd: 0 });
    if (W.hud && W.hud.toast) W.hud.toast('🦅 A falcon joins the hunt! (' + player.falcons.length + ')');
  };
  player.stepFalcons = function (dt) {
    const fs = player.falcons; if (!fs || !fs.length) return;
    const foes = (W.enemies && W.enemies.list) || [];
    const host = !(W.net && W.net.role === 'client');
    for (const f of fs) {
      const g = f.g; f.t += dt; f.cd -= dt;
      let tgt = null, bd = 30;
      for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - g.position.x, e.group.position.z - g.position.z); if (d < bd) { bd = d; tgt = e; } }
      const wg = g.userData.wings; if (wg) { const fl = Math.sin(f.t * 26) * 0.7; wg[0].rotation.z = fl; wg[1].rotation.z = -fl; }
      if (f.mode === 'dive' && tgt) {                               // strike run: swoop onto the foe
        const ep = tgt.group.position;
        const dx = ep.x - g.position.x, dy = (ep.y + 1.4) - g.position.y, dz = ep.z - g.position.z, d = Math.hypot(dx, dy, dz) || 1;
        const sp = 24 * dt; g.position.x += (dx / d) * sp; g.position.y += (dy / d) * sp; g.position.z += (dz / d) * sp;
        g.rotation.y = Math.atan2(dx, dz);
        if (d < 1.3) {                                              // hit! then peel away
          if (host && W.enemies.damage) { const killed = W.enemies.damage(tgt.group, 22, { x: g.position.x, z: g.position.z }); if (killed && player.creditKill) player.creditKill(tgt.group.userData.kind); }
          if (player.popDamage) player.popDamage(tgt.group.position, 22, false);
          f.mode = 'retreat'; f.cd = 1.0;
        }
      } else {                                                      // orbit high, then dive again when ready
        const hx = player.pos.x + Math.cos(f.a + player._t * 0.7) * 4.5, hz = player.pos.z + Math.sin(f.a + player._t * 0.7) * 4.5;
        const dx = hx - g.position.x, dz = hz - g.position.z, ty = W.world.heightAt(g.position.x, g.position.z) + 6;
        const d = Math.hypot(dx, dz) || 1, sp = 13 * dt;
        g.position.x += (dx / d) * sp; g.position.z += (dz / d) * sp; g.position.y += (ty - g.position.y) * Math.min(1, dt * 3);
        g.rotation.y = Math.atan2(dx, dz);
        if (f.cd <= 0 && tgt) f.mode = 'dive';
      }
    }
  };
  // A survived night rewards the Hunter with a falcon (spawnFalcon toasts on its own).
  player.onNightSurvived = function () {
    if (player.isHunter) player.spawnFalcon();
  };

  // --- Engineer: fortify the base with barbed wire, spikes & sentry turrets ---
  function makeBarbedSeg() {
    const g = new THREE.Group();
    const post = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const wire = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.4, flatShading: true });
    for (const t of [-0.9, 0, 0.9]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), post); p.position.set(t, 0.37, 0); p.castShadow = true; g.add(p); }
    for (const hy of [0.3, 0.58]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.03), wire); w.position.set(0, hy, 0); g.add(w); }
    for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.13, 4), wire); b.position.set(i * 0.3, 0.44, 0); b.rotation.z = Math.PI / 4; g.add(b); }
    return g;
  }
  function makeSpikeCluster() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1, flatShading: true });
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 5), mat); s.position.set((Math.random() - 0.5) * 0.7, 0.45, (Math.random() - 0.5) * 0.7); s.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4); s.castShadow = true; g.add(s); }
    return g;
  }
  function makeSentry() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.6, metalness: 0.4, flatShading: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.5, 8), wood); post.position.y = 0.75; post.castShadow = true; g.add(post);
    const head = new THREE.Group(); head.position.y = 1.6;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.5), dark));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), dark); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.42; head.add(barrel);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff4a3a, emissive: 0xff2a1a, emissiveIntensity: 1.4 })); eye.position.set(0, 0.05, 0.28); head.add(eye);
    g.add(head); g.userData.head = head;
    return g;
  }
  player.fortifyBase = function () {
    const S = player.scene, W2 = W.world; if (!S || !W2) return;
    if (!W2.hazards) W2.hazards = [];
    const lvl = player.classLevel || 1;                              // Lv2/Lv3 Engineer = deadlier defenses
    const N = 44;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let x = Math.cos(a) * 11, z = Math.sin(a) * 11;                 // barbed-wire ring (walk-through: hazard only, no collider)
      const bw = makeBarbedSeg(); bw.position.set(x, W2.heightAt(x, z), z); bw.rotation.y = a + Math.PI / 2; S.add(bw);
      W2.hazards.push({ x, z, r: 1.3, dps: 16 * lvl });
      x = Math.cos(a) * 12.3; z = Math.sin(a) * 12.3;                 // spike ring outside it
      const sp = makeSpikeCluster(); sp.position.set(x, W2.heightAt(x, z), z); S.add(sp);
      W2.hazards.push({ x, z, r: 1.1, dps: 24 * lvl });
    }
    player._sentries = [];
    const NS = 4 + lvl * 2;                                          // Lv1=6, Lv2=8, Lv3=10 sentries
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * Math.PI * 2 + 0.3, x = Math.cos(a) * 8.5, z = Math.sin(a) * 8.5, gy = W2.heightAt(x, z);
      const g = makeSentry(); g.position.set(x, gy, z); S.add(g);                // no collider -> walk-through
      player._sentries.push({ g, head: g.userData.head, x, z, y: gy + 1.6, cd: U.rand(0, 0.3) });
    }
    if (W.hud && W.hud.banner) W.hud.banner('🛠️ ENGINEER', 'Base fortified — barbed wire, spikes & ' + NS + ' sentries deployed!', '#ffd24a');
  };
  function stepSentries(dt) {
    const ss = player._sentries; if (!ss || !ss.length) return;
    const foes = (W.enemies && W.enemies.list) || [];
    const host = !(W.net && W.net.role === 'client');
    for (const t of ss) {
      t.cd -= dt;
      let best = null, bd = 28;
      for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - t.x, e.group.position.z - t.z); if (d < bd) { bd = d; best = e; } }
      if (best) {
        t.head.rotation.y = Math.atan2(best.group.position.x - t.x, best.group.position.z - t.z);
        if (t.cd <= 0) {
          t.cd = 0.32;                                                // rapid fire
          const sdmg = 20 * (player.classLevel || 1);                 // sentries hit harder at higher Engineer levels
          if (host && W.enemies.damage) { const killed = W.enemies.damage(best.group, sdmg, { x: t.x, z: t.z }); if (player.popDamage) player.popDamage(best.group.position, sdmg); if (killed && player.creditKill) player.creditKill(best.kind); }
        }
      }
    }
  }

  // Vampire sunburn shade test: cast a ray straight up from the eyes — if a tree
  // canopy (or any structure) is overhead, the vampire is out of direct sun and safe.
  const _sunRay = new THREE.Raycaster(); const _sunEye = new THREE.Vector3(); const _sunUp = new THREE.Vector3(0, 1, 0);
  function vampInShade() {
    if (!W.world || !W.world.trees) return false;
    player.camera.getWorldPosition(_sunEye);
    _sunRay.set(_sunEye, _sunUp); _sunRay.far = 60;
    const cover = W.world.trees.filter((t) => t.userData.alive);
    return _sunRay.intersectObjects(cover, true).length > 0;
  }

  player.update = function (dt) {
    player._t += dt;
    // Vampire: 5,000 hp / 2× speed by day (burns 5 hp/sec in DIRECT sun); 15,000 hp / 10× speed at night
    if (player.isVampire && player.alive) {
      const night = W.world.isNight && W.world.isNight();
      player.maxHealth = night ? (player._vampNightHp || 15000) : (player._vampDayHp || 5000);
      if (player.health > player.maxHealth) player.health = player.maxHealth;
      player.speedMult = night ? 10 : 2;                                    // day 2×, night 10×
      if (!night && player.active) { player._sunT = (player._sunT || 0) + dt; if (player._sunT >= 1) { player._sunT = 0; if (!vampInShade()) player.takeDamage(5); } }
    }
    if (player.isEngineer && !player._fortified) { player._fortified = true; player.fortifyBase(); }   // build defenses once
    if (player._sentries) stepSentries(dt);
    if (player.knightSummons > 0 && !player.knights) player.summonKnights();   // rally the King's guard once
    if (player.knights) player.stepKnights(dt);
    if (player.cupids) player.stepCupids(dt);                                  // Kawaii's cupid swarm
    if (player.isHunter && !player._hunterStarted) { player._hunterStarted = true; player.spawnAlphaWolf(); }   // Hunter's starting alpha wolf
    if (player.wolves) player.stepWolves(dt);                                  // Hunter's alpha-wolf pack
    if (player.falcons) player.stepFalcons(dt);                               // Hunter's falcons
    if (player.arrows && player.arrows.length) updateArrows(dt);   // arrows fly even while sitting/sleeping
    updateStars(dt);                                               // ninja stars in flight (+ throw cooldown)
    if (player._dmgNums && player._dmgNums.length) updateDamageNums(dt);
    if (player._treeBars && player._treeBars.length) updateTreeBars();
    // context [F] prompt: open your starter box, or cook raw meat at a campfire
    const box = player.starterBox;
    if (box && !box.opened && box.group.userData.tag) box.group.userData.tag.position.y = 1.45 + Math.sin(player._t * 3) * 0.06;
    let fHtml = null;
    const kb = (t) => 'Press <b style="background:#3a2f10;border:1px solid #ffd873;border-radius:5px;padding:0 7px;">F</b> ' + t;
    if (player.active && box && !box.opened && Math.hypot(player.pos.x - box.x, player.pos.z - box.z) < 3.2) {
      fHtml = kb('to open your 📦 box');
    } else if (player.active && player.wolfMeat > 0 && nearCampfire()) {
      fHtml = kb('to cook 🥩 x' + player.wolfMeat + ' at the fire');
    }
    if (fHtml) { boxPrompt().style.display = 'block'; boxPromptEl.innerHTML = fHtml; }
    else if (boxPromptEl && boxPromptEl.style.display !== 'none') { boxPromptEl.style.display = 'none'; }
    if (!player.alive) return;
    if (player.ghost) { updateGhost(dt); return; }
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

    // Build Mode = spectator: fly + no-clip (move through walls, Space up / Shift down)
    const spectator = !!(W.builder && W.builder.isOn && W.builder.isOn());

    player.pos.x += wishX * speed * dt;
    player.pos.z += wishZ * speed * dt;
    if (!spectator) W.world.resolveCollision(player.pos, C.PLAYER_RADIUS, player.pos.y - C.EYE_HEIGHT);  // feet height: jump over low walls

    // keep inside the world
    const fromC = Math.hypot(player.pos.x, player.pos.z);
    if (fromC > C.WORLD_RADIUS + 6) {
      player.pos.x *= (C.WORLD_RADIUS + 6) / fromC;
      player.pos.z *= (C.WORLD_RADIUS + 6) / fromC;
    }

    // --- vertical (gravity, jump, terrain + building floors/stairs) ---
    if (spectator) {
      player.vy = 0; player.grounded = false;
      const fly = 10;
      if (k.Space) player.pos.y += fly * dt;                              // ascend
      if (k.ShiftLeft || k.ShiftRight) player.pos.y -= fly * dt;          // descend
    } else {
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
        if (!player.grounded && player.vy < -7 && W.sfx && W.sfx.land) W.sfx.land();   // thud on a real landing
        player.pos.y = groundEye; player.vy = 0; player.grounded = true;
      } else if (player.grounded) {
        // follow gentle slopes / steps up; fall when stepping off a ledge
        if (player.pos.y - groundEye <= 0.6) { player.pos.y = groundEye; player.vy = 0; }
        else player.grounded = false;
      }
    }

    // --- stats ---
    const atBase = W.world.nearCamp(player.pos);   // the camp is a safe haven
    const fireLit = !W.fire || W.fire.lit();        // ...but only while the camp fire is fed

    // stamina: infinite at base, otherwise drains while sprinting / recovers at rest
    if (atBase) player.stamina = 100;
    else if (wantSprint) player.stamina = U.clamp(player.stamina - 12 * dt, 0, 100);
    else player.stamina = U.clamp(player.stamina + 15 * dt, 0, 100);

    // hunger & thirst: recover fast at base (10x), otherwise tick down
    if (atBase) {
      player.hunger = U.clamp(player.hunger + 25 * dt, 0, 100);
      // thirst only recovers at camp while the fire is lit; if it's out, it drains as usual
      player.thirst = U.clamp(player.thirst + (fireLit ? 25 : -1.15) * dt, 0, 100);
    } else {
      player.hunger = U.clamp(player.hunger - 0.45 * dt, 0, 100);                   // lasts longer
      player.thirst = U.clamp(player.thirst - 1.15 * dt, 0, 100);
    }
    if (player.playerClass === 'ninja') player.thirst = 100;                        // Ninja never thirsts (F throws stars, not drink)
    if (player.hunger <= 0) player.takeDamage(2.2 * dt);
    if (player.thirst <= 0) player.takeDamage(2.0 * dt);
    if (player.hunger > 40 && player.thirst > 25 && player._t - player.lastHurt > 4) {
      player.health = U.clamp(player.health + 1.6 * dt, 0, player.maxHealth || 100);   // class cap (Scout regens to 60)
    }
    // resting at the base heals you very fast — but only while the camp fire is lit
    if (atBase && fireLit && player._t - player.lastHurt > 1.5) {
      player.health = U.clamp(player.health + 70 * dt, 0, player.maxHealth || 100);
    }

    // --- apply to camera ---
    player.camera.position.copy(player.pos);
    player.camera.rotation.y = player.yaw;
    player.camera.rotation.x = player.pitch;

    // head bob
    const bob = moving && player.grounded ? Math.sin(player._t * (wantSprint ? 14 : 9)) * 0.04 : 0;
    player.camera.position.y += bob;

    // footstep sounds, paced to the walk/run cadence
    if (moving && player.grounded && !player._mount) {
      player._stepT = (player._stepT || 0) + dt;
      if (player._stepT >= (wantSprint ? 0.30 : 0.42)) {
        player._stepT = 0; player._stepR = !player._stepR;
        if (W.sfx) W.sfx.step(player._stepR);
      }
    } else { player._stepT = 0.4; }

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
      alive: true, downed: false, bleedT: 0, bandaids: 0, ghost: false, ghostT: 0,
      sleeping: false, sleepT: 0, hugStuffie: null, building: null, invOpen: false,
      sitting: false, _seat: null, _seatHint: false,
      hasShotgun: false, shells: 0, hasRifle: false, rounds: 0, hasBow: false, arrowCount: 0, saplings: 0,
      hasDeagle: false, deagleRounds: 0, hasFists: true, hasAxe: false, wolfMeat: 0, cookedMeat: 0,
      health: 100, stamina: 100, hunger: 100, thirst: 100,
      bottle: 5, bottleMax: 5, berries: 0, wood: START_WOOD, kills: 0, banditKills: 0, treelingCoins: 0, vy: 0,
      attackDmg: 2, attackRange: 4.0, armor: 1.0, axeLevel: 0, hasArmor: false, hasSword: false, hasKatana: false, hasMace: false, hasShield: false, currentWeapon: 'fists',
    });
  };

  W.player = player;
})();
