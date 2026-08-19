/* The Wolf Ritual — the new way to summon Sir Buffington (the car is gone).
   Kill wolves and they leave a CORPSE on the ground (look at it, press J to
   sack it). Haul them to the 🩸 Blood Altar at camp and press F to sacrifice.
   Sacrifice 100 wolf corpses and 4 hidden altars rise across the woods; find
   all four and a colossal door appears at the edge of the map — boom… boom…
   BOOOOM — and Sir Buff bursts out.
   Self-contained: own scene meshes, rAF loop, HUD pill/prompt. It only reaches
   into other files through enemies.kill (corpse hook) and enemies.spawnBuffington. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;

  const NEED = 100;              // wolf corpses to sacrifice
  const N_ALTARS = 4;           // hidden altars to find
  const ALTAR_R = 3.2;          // reach to sacrifice at the Blood Altar
  const FIND_R = 5.0;           // how close you must get to "find" a hidden altar
  const DOOR_TRIGGER_R = 26;    // approach the door this close to start the booms

  let scene = null, ready = false;
  let altar = null, altarPos = null, altarEmber = null;   // the camp Blood Altar
  let sacrificed = 0;
  let finders = [];             // the 4 hidden altars: { group, x, z, found, beamMat }
  let foundCount = 0;
  let door = null, doorPos = null, doorLeft = null, doorRight = null, doorBeamMat = null;
  let doorOpened = false, doorOpenT = 0;
  let phase = 'collect';        // collect -> finding -> door -> done
  let boomT = -1, boomStep = 0; // boom finale timer
  let last = performance.now() / 1000;
  const now = () => performance.now() / 1000;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const WATER = () => (W.CONFIG ? W.CONFIG.WATER_LEVEL : -2) + 1.0;
  function toast(m) { if (W.hud && W.hud.toast) W.hud.toast(m); }
  function banner(a, b, c) { if (W.hud && W.hud.banner) W.hud.banner(a, b, c); }
  function heightAt(x, z) { return W.world.heightAt(x, z); }

  // pick a spot on solid ground near (cx,cz) between radii r0..r1
  function landSpot(cx, cz, r0, r1) {
    for (let i = 0; i < 48; i++) {
      const a = rnd(0, 6.283), r = rnd(r0, r1);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (heightAt(x, z) > WATER()) return { x, z };
    }
    return { x: cx + r0, z: cz };
  }

  // ---- meshes ---------------------------------------------------------------
  function makeBeam(color, h) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, h, 12, 1, true), mat);
    beam.position.y = h / 2; beam.raycast = function () {};
    return { beam, mat };
  }

  // the camp Blood Altar you sacrifice corpses at — a dark stone plinth with a glowing bowl
  function makeBloodAltar(x, z) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x4a4650, roughness: 1, flatShading: true });
    const stoneDk = new THREE.MeshStandardMaterial({ color: 0x332f38, roughness: 1, flatShading: true });
    const blood = new THREE.MeshStandardMaterial({ color: 0x8a1518, emissive: 0xd41f22, emissiveIntensity: 1.2, roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.55, 0.5, 8), stoneDk); base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 8), stone); col.position.y = 1.0; col.castShadow = true; g.add(col);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 0.35, 8), stone); top.position.y = 1.65; top.castShadow = true; g.add(top);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 0.4, 12), stoneDk); bowl.position.y = 1.9; g.add(bowl);
    const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.5, 0.18, 12), blood); ember.position.y = 2.02; g.add(ember);
    altarEmber = ember;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const runic = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), blood); runic.position.set(Math.cos(a) * 0.92, 1.0, Math.sin(a) * 0.92); g.add(runic); }
    const light = new THREE.PointLight(0xff2a2a, 0.9, 8); light.position.set(0, 2.2, 0); g.add(light);
    g.position.set(x, heightAt(x, z), z);
    scene.add(g);
    return g;
  }

  // a hidden altar out in the woods — a stone obelisk topped by a floating crystal + a sky beam
  function makeFinderAltar(x, z) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 1, flatShading: true });
    const stoneDk = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 1, flatShading: true });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x39d6ff, emissive: 0x2bb8e6, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.2, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.5, 6), stoneDk); base.position.y = 0.25; base.castShadow = true; g.add(base);
    const obel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.7, 3.0, 6), stone); obel.position.y = 2.0; obel.castShadow = true; g.add(obel);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 6), stone); cap.position.y = 3.7; g.add(cap);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crystalMat); crystal.position.y = 4.4; g.add(crystal);
    g.userData.crystal = crystal; g.userData.crystalMat = crystalMat;
    const b = makeBeam(0x39d6ff, 70); g.add(b.beam);
    const light = new THREE.PointLight(0x49c6ff, 0.9, 10); light.position.set(0, 4.4, 0); g.add(light);
    g.userData.light = light;
    g.position.set(x, heightAt(x, z), z);
    scene.add(g);
    return { group: g, x, z, found: false, beamMat: b.mat };
  }

  // the colossal door at the edge of the woods — a giant stone frame with two heavy plank doors
  function makeGiantDoor(x, z) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x5a5560, roughness: 1, flatShading: true });
    const stoneDk = new THREE.MeshStandardMaterial({ color: 0x3a3640, roughness: 1, flatShading: true });
    const plank = new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 1, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const H = 16, DW = 5.4;
    // frame: two pillars + a heavy lintel
    for (const sx of [-DW - 0.6, DW + 0.6]) { const pil = new THREE.Mesh(new THREE.BoxGeometry(1.8, H, 2.2), stone); pil.position.set(sx, H / 2, 0); pil.castShadow = true; g.add(pil); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * DW + 5.2, 2.4, 2.6), stoneDk); lintel.position.set(0, H - 1.0, 0); lintel.castShadow = true; g.add(lintel);
    const key = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.6, 4), stone); key.position.set(0, H + 0.4, 0); key.rotation.y = Math.PI / 4; g.add(key);
    // dark doorway backing (so it reads as a portal even before it opens)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * DW, H - 1.6), new THREE.MeshBasicMaterial({ color: 0x120a10 })); back.position.set(0, (H - 1.6) / 2, -0.3); g.add(back);
    // two door leaves (pivot at outer edges) — plank + iron studs
    const mkLeaf = (side) => {
      const leaf = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(DW, H - 1.8, 0.7), plank); slab.position.set(side * DW / 2, 0, 0); slab.castShadow = true; leaf.add(slab);
      for (const by of [-4.5, -1.5, 1.5, 4.5]) { const band = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.4, 0.8), iron); band.position.set(side * DW / 2, by, 0); leaf.add(band); }
      for (let ix = 0; ix < 3; ix++) for (const by of [-4.5, 1.5]) { const stud = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), iron); stud.position.set(side * (0.7 + ix * 1.9), by, 0.4); leaf.add(stud); }
      leaf.position.set(0, (H - 1.8) / 2 + 0.2, 0.2);
      g.add(leaf);
      return leaf;
    };
    doorLeft = mkLeaf(-1); doorRight = mkLeaf(1);
    // glowing seam + a huge sky beam so it's findable from far off
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, H - 2), glow); seam.position.set(0, (H - 1.8) / 2 + 0.2, 0.65); g.add(seam);
    const b = makeBeam(0xff5a2a, 120); g.add(b.beam); doorBeamMat = b.mat;
    const light = new THREE.PointLight(0xff6a2a, 1.4, 26); light.position.set(0, 8, 3); g.add(light);
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = Math.atan2(-x, -z);   // face roughly toward the centre of the map
    scene.add(g);
    return g;
  }

  // ---- ritual flow ----------------------------------------------------------
  function sacrifice() {
    const have = W.sack && W.sack.corpseCount ? W.sack.corpseCount() : 0;
    if (have <= 0) { toast('🩸 No wolf corpses in your sack — kill wolves, look at the carcass & press J'); return; }
    const take = Math.min(have, NEED - sacrificed);
    W.sack.removeCorpses(take);
    sacrificed += take;
    if (W.sfx && W.sfx.boom) W.sfx.boom();
    if (altarEmber) altarEmber.material.emissiveIntensity = 2.4;   // flares on each offering
    if (sacrificed >= NEED) { toast('🩸 The offering is complete… the woods tremble.'); raiseAltars(); }
    else toast('🩸 Sacrificed ' + take + ' corpse' + (take === 1 ? '' : 's') + ' — ' + sacrificed + '/' + NEED);
    refreshPill();
  }

  function raiseAltars() {
    phase = 'finding';
    finders = [];
    const c = altarPos || { x: 0, z: 0 };
    for (let i = 0; i < N_ALTARS; i++) {
      const a = (i / N_ALTARS) * Math.PI * 2 + rnd(-0.4, 0.4);   // spread into 4 quadrants
      const r = rnd(140, 300);
      const s = landSpot(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0, 30);
      finders.push(makeFinderAltar(s.x, s.z));
    }
    foundCount = 0;
    banner('🔮 FOUR ALTARS HAVE RISEN', 'Blue beams pierce the sky across the woods — find all four.', '#49c6ff');
    refreshPill();
  }

  function findAltar(f) {
    f.found = true; foundCount++;
    f.beamMat.color.setHex(0xffcf4a); f.beamMat.opacity = 0.5;
    if (f.group.userData.crystalMat) { f.group.userData.crystalMat.color.setHex(0xffd24a); f.group.userData.crystalMat.emissive.setHex(0xffb020); }
    if (f.group.userData.light) f.group.userData.light.color.setHex(0xffd24a);
    if (W.sfx && W.sfx.levelup) W.sfx.levelup();
    if (foundCount >= N_ALTARS) {
      banner('🚪 THE COLOSSAL DOOR APPEARS', 'At the edge of the woods, something ancient stirs… go to it.', '#ff7a3a');
      spawnDoor();
    } else {
      toast('🔮 Altar found! ' + foundCount + '/' + N_ALTARS + ' — follow the other beams');
    }
    refreshPill();
  }

  function spawnDoor() {
    phase = 'door';
    const c = altarPos || { x: 0, z: 0 };
    const a = rnd(0, 6.283), r = 340;                 // out at the edge of the woods
    const s = landSpot(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0, 60);
    doorPos = s;
    door = makeGiantDoor(s.x, s.z);
    refreshPill();
  }

  function startBooms() {
    if (boomT >= 0) return;
    boomT = 0; boomStep = 0;
    banner('💥 BANG!', 'Something enormous is pounding on the other side…', '#ff9a3a');
  }

  // camera-independent screen shake by jittering the #app container
  let shakeUntil = 0;
  function shake(sec) { shakeUntil = Math.max(shakeUntil, now() + sec); }
  function applyShake() {
    const app = document.getElementById('app'); if (!app) return;
    if (now() < shakeUntil) { const m = 10 * ((shakeUntil - now())); app.style.transform = 'translate(' + (Math.random() * 2 - 1) * m + 'px,' + (Math.random() * 2 - 1) * m + 'px)'; }
    else if (app.style.transform) { app.style.transform = ''; }
  }

  function openDoorAndSummon() {
    doorOpened = true; boomT = -1;
    banner('💪 SIR BUFF EMERGES!', 'The doors burst open — IT IS SWOLE O’CLOCK.', '#ff5a2a');
    if (W.sfx) { if (W.sfx.boom) W.sfx.boom(); if (W.sfx.roar) setTimeout(() => W.sfx.roar(), 250); }
    shake(1.4);
    const dp = doorPos || { x: 0, z: 0 };
    if (W.enemies && W.enemies.spawnBuffington) {
      // spawn just in front of the doorway, then let his own AI take over
      const fwd = door ? door.rotation.y : 0;
      const bx = dp.x + Math.sin(fwd) * 4, bz = dp.z + Math.cos(fwd) * 4;
      W.enemies.buffTimer = 1e9;   // keep the timed spawner off; this is THE Buff
      W.enemies.spawnBuffington({ x: bx, z: bz });
    }
    phase = 'done';
    refreshPill();
  }

  // ---- HUD ------------------------------------------------------------------
  let pill = null, prompt = null;
  function buildHud() {
    pill = document.createElement('div');
    pill.id = 'ritualPill';
    pill.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:6;display:none;' +
      'padding:6px 13px;border-radius:20px;background:rgba(30,12,14,.66);border:2px solid rgba(200,60,60,.6);' +
      "color:#ffd9d0;font:bold 13px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;backdrop-filter:blur(2px);white-space:nowrap;pointer-events:none;";
    document.body.appendChild(pill);
    prompt = document.createElement('div');
    prompt.id = 'ritualPrompt';
    prompt.style.cssText = 'position:fixed;left:50%;top:63%;transform:translateX(-50%);z-index:7;display:none;' +
      'background:rgba(40,10,12,.85);border:2px solid #d43a3a;border-radius:11px;padding:7px 15px;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#ffe0da;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none;";
    document.body.appendChild(prompt);
  }
  function nearestFinderDist(p) {
    let best = Infinity;
    for (const f of finders) { if (f.found) continue; best = Math.min(best, dist(p.pos.x, p.pos.z, f.x, f.z)); }
    return best;
  }
  function refreshPill() {
    if (!pill) return;
    let html = '';
    if (phase === 'collect') html = '🐺 Wolf Ritual — <b style="color:#ff8a8a">' + sacrificed + ' / ' + NEED + '</b> corpses sacrificed · offer them at the 🩸 Blood Altar';
    else if (phase === 'finding') html = '🔮 Altars found <b style="color:#ffcf4a">' + foundCount + ' / ' + N_ALTARS + '</b> · follow the blue beams';
    else if (phase === 'door') html = '🚪 The colossal door awaits at the edge of the woods — reach the orange beam';
    else html = '💪 Sir Buff has been summoned!';
    pill.innerHTML = html;
    pill.style.display = 'block';
  }
  function updatePrompt(p) {
    if (!prompt) return;
    let show = '';
    if (phase === 'collect' && altarPos && dist(p.pos.x, p.pos.z, altarPos.x, altarPos.z) < ALTAR_R) {
      const c = W.sack && W.sack.corpseCount ? W.sack.corpseCount() : 0;
      show = c > 0
        ? 'Press <b style="background:#4a1012;border:1px solid #d43a3a;border-radius:5px;padding:0 6px;">F</b> to sacrifice <b>' + c + '</b> wolf corpse' + (c === 1 ? '' : 's')
        : '🩸 Bring 🐺 <b>wolf corpses</b> here — kill wolves, look at the carcass & press <b>J</b>';
    }
    prompt.style.display = show ? 'block' : 'none';
    if (show) prompt.innerHTML = show;
  }

  // ---- loop -----------------------------------------------------------------
  function loop() {
    requestAnimationFrame(loop);
    const t = now(); const dt = Math.min(0.1, t - last); last = t;
    const p = P();
    // keep the timed auto-Buff spawner OFF until the ritual opens the door
    if (!doorOpened && W.enemies) W.enemies.buffTimer = 1e9;
    applyShake();

    // gentle idle animation
    if (altarEmber && altarEmber.material.emissiveIntensity > 1.2) altarEmber.material.emissiveIntensity = Math.max(1.2, altarEmber.material.emissiveIntensity - dt * 1.5);
    for (const f of finders) { const c = f.group.userData.crystal; if (c) { c.rotation.y += dt * 1.2; c.position.y = 4.4 + Math.sin(t * 2 + f.x) * 0.12; } }

    if (!p || !p.active || !p.alive) { if (prompt) prompt.style.display = 'none'; return; }

    if (phase === 'finding') {
      for (const f of finders) { if (!f.found && dist(p.pos.x, p.pos.z, f.x, f.z) < FIND_R) findAltar(f); }
    } else if (phase === 'door' && doorPos) {
      if (dist(p.pos.x, p.pos.z, doorPos.x, doorPos.z) < DOOR_TRIGGER_R) startBooms();
    }

    // boom finale: boom … boom … boom … BOOOOM (doors fling open, Buff emerges)
    if (boomT >= 0) {
      boomT += dt;
      const beats = [0.2, 1.4, 2.6];
      if (boomStep < beats.length && boomT >= beats[boomStep]) {
        boomStep++;
        if (W.sfx && W.sfx.boom) W.sfx.boom();
        shake(0.5);
        if (doorBeamMat) doorBeamMat.opacity = 0.7;
      }
      if (boomT >= 3.9 && !doorOpened) openDoorAndSummon();
    }
    // swing the doors open over ~1.2s once summoned
    if (doorOpened && doorLeft && doorOpenT < 1) {
      doorOpenT = Math.min(1, doorOpenT + dt / 1.2);
      const a = doorOpenT * (Math.PI * 0.62);
      doorLeft.rotation.y = a; doorRight.rotation.y = -a;
      if (doorBeamMat) doorBeamMat.opacity = 0.7 - doorOpenT * 0.5;
    }

    updatePrompt(p);
  }

  // ---- input: F at the Blood Altar sacrifices (runs before player.interactF) --
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat) return;
    if (phase !== 'collect' || !altarPos) return;
    const p = P(); if (!p || !p.active || !p.alive) return;
    if (dist(p.pos.x, p.pos.z, altarPos.x, altarPos.z) > ALTAR_R) return;
    e.stopImmediatePropagation();     // consume F so it doesn't also drink / open the starter box
    sacrifice();
  }, true);

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!(W.player && W.player.scene && W.world && W.world.heightAt && W.sack)) return;
    ready = true;
    scene = W.player.scene;
    if (W.enemies) W.enemies.buffTimer = 1e9;   // Buff no longer roams in on a timer — only the ritual summons him
    // place the Blood Altar just outside the spawn camp
    const camp = (W.world.campfires && W.world.campfires[0]) ? W.world.campfires[0] : { x: 0, z: 0 };
    altarPos = landSpot(camp.x, camp.z, 6, 11);
    altar = makeBloodAltar(altarPos.x, altarPos.z);
    buildHud(); refreshPill();
    requestAnimationFrame(loop);
    setTimeout(() => toast('🩸 A Blood Altar stands at camp — sacrifice ' + NEED + ' wolf corpses to summon something ancient…'), 2600);

    // public hook + owner/debug helpers
    W.ritual = {
      onKill: function (e) {
        if (!e || !e.group || e.buffBoss) return false;
        if (e.kind !== 'wolf' && e.kind !== 'werewolf') return false;
        const pos = e.group.position;
        if (W.enemies && W.enemies.scene) W.enemies.scene.remove(e.group);   // take the standing body away
        if (W.sack && W.sack.dropCorpseAt) W.sack.dropCorpseAt(pos.x, pos.z); // …and leave a lootable carcass
        return true;                                                          // handled: skip the shrink animation
      },
      progress: () => ({ sacrificed, need: NEED, foundCount, phase }),
      // debug (owner console): jump the ritual forward
      _sacrifice: (n) => { sacrificed = Math.min(NEED, sacrificed + (n || 0)); if (sacrificed >= NEED && phase === 'collect') raiseAltars(); refreshPill(); },
      _raise: () => { sacrificed = NEED; raiseAltars(); },
      _findAll: () => { for (const f of finders) if (!f.found) findAltar(f); },
      _door: () => { if (phase === 'finding' || phase === 'collect') { sacrificed = NEED; if (!finders.length) raiseAltars(); for (const f of finders) f.found = true; foundCount = N_ALTARS; spawnDoor(); } },
    };
  }, 400);
})();
