/* The Wolf Ritual — the way to summon Sir Buffington (the car is gone).
   Kill wolves and they leave a CORPSE on the ground (look at it, press J to
   sack it). Haul them to a CAMPFIRE 🔥 and press F to burn them as an offering.
   Burn 100 wolf corpses and 4 blood SEALS rise across the woods. SHOOT a seal
   and a gym cub bursts out of it — fight it. Break all four seals and beat all
   four cubs, and… BANG… BANG… BOOOOM — a colossal door at the edge of the map
   splits open and Sir Buff comes hunting for YOU.
   Self-contained: own scene meshes, rAF loop, HUD pill/prompt. It reaches into
   other files only through enemies.kill (the onKill hook), enemies.spawnGymCub,
   and enemies.spawnBuffington. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;

  const NEED = 100;             // wolf corpses to sacrifice (burn in a campfire)
  const N_SEALS = 4;            // blood seals to shoot (each hides a gym cub)
  const FIRE_R = 3.4;           // reach to burn corpses at a campfire
  const DOOR_TRIGGER_R = 26;    // approach the door this close to start the booms

  let scene = null, ready = false;
  let campCenter = { x: 0, z: 0 };   // camp origin — where seals/door are measured from
  let sacrificed = 0;
  let seals = [];               // the 4 blood seals: { group, x, z, shot, disc, runeMat, beamMat, enemy }
  let sealsShot = 0, cubsDown = 0;
  let door = null, doorPos = null, doorLeft = null, doorRight = null, doorBeamMat = null;
  let doorOpened = false, doorOpenT = 0;
  let phase = 'collect';        // collect -> seals -> door -> done
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

  // find the nearest campfire to a point (camp haven fire + any crafted ones), or null
  function nearestCampfire(px, pz) {
    const fires = (W.world && W.world.campfires) || [];
    let best = null, bd = Infinity;
    for (const c of fires) { const d = dist(px, pz, c.x, c.z); if (d < bd) { bd = d; best = c; } }
    return best ? { x: best.x, z: best.z, d: bd } : null;
  }

  // A blood SEAL out in the woods — a stone dais holding a floating rune sigil and
  // a red sky beam. It is registered as a shootable "enemy" so any weapon pops it.
  function makeSeal(x, z) {
    const g = new THREE.Group();
    const stoneDk = new THREE.MeshStandardMaterial({ color: 0x33262a, roughness: 1, flatShading: true });
    const runeMat = new THREE.MeshStandardMaterial({ color: 0xff3a3a, emissive: 0xd41f1f, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.2, flatShading: true });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 8), stoneDk); dais.position.y = 0.25; dais.castShadow = true; g.add(dais);
    // the floating sigil: a glowing ring + inner star
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.14, 8, 24), runeMat); ring.rotation.x = Math.PI / 2; ring.position.y = 2.0; g.add(ring);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), runeMat); star.position.y = 2.0; g.add(star);
    const disc = new THREE.Group(); disc.add(ring); disc.add(star); disc.position.y = 0; g.add(disc);
    // a fat invisible hitbox so it's easy to shoot
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.7; g.add(hit);
    const b = makeBeam(0xff2a2a, 90); g.add(b.beam);
    const light = new THREE.PointLight(0xff4a4a, 1.2, 12); light.position.set(0, 2.2, 0); g.add(light);
    g.position.set(x, heightAt(x, z), z);
    // register as a one-hit "enemy" so the existing shoot/arrow code can hit it
    g.userData.type = 'enemy'; g.userData.kind = 'seal';
    scene.add(g);
    let enemy = null;
    if (W.enemies && W.enemies.list) {
      enemy = { id: (W.enemies._nextRitualId = (W.enemies._nextRitualId || 900000) + 1), group: g, kind: 'seal', isSeal: true, alive: true, hp: 1, maxHp: 1, speed: 0, dmg: 0, lastAttack: -99, t: 0 };
      g.userData.id = enemy.id;
      W.enemies.list.push(enemy);
    }
    return { group: g, x, z, shot: false, disc, runeMat, beamMat: b.mat, enemy };
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
    for (const sx of [-DW - 0.6, DW + 0.6]) { const pil = new THREE.Mesh(new THREE.BoxGeometry(1.8, H, 2.2), stone); pil.position.set(sx, H / 2, 0); pil.castShadow = true; g.add(pil); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * DW + 5.2, 2.4, 2.6), stoneDk); lintel.position.set(0, H - 1.0, 0); lintel.castShadow = true; g.add(lintel);
    const key = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.6, 4), stone); key.position.set(0, H + 0.4, 0); key.rotation.y = Math.PI / 4; g.add(key);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * DW, H - 1.6), new THREE.MeshBasicMaterial({ color: 0x120a10 })); back.position.set(0, (H - 1.6) / 2, -0.3); g.add(back);
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
    if (have <= 0) { toast('🔥 No wolf corpses in your sack — kill wolves, look at the carcass & press J'); return; }
    const take = Math.min(have, NEED - sacrificed);
    W.sack.removeCorpses(take);
    sacrificed += take;
    if (W.sfx && W.sfx.boom) W.sfx.boom();
    if (sacrificed >= NEED) { toast('🔥 The offering is complete… the woods bleed.'); revealSeals(); }
    else toast('🔥 Burned ' + take + ' corpse' + (take === 1 ? '' : 's') + ' — ' + sacrificed + '/' + NEED);
    refreshPill();
  }

  function revealSeals() {
    phase = 'seals';
    seals = [];
    const c = campCenter;
    for (let i = 0; i < N_SEALS; i++) {
      const a = (i / N_SEALS) * Math.PI * 2 + rnd(-0.4, 0.4);   // spread into 4 quadrants
      const r = rnd(140, 300);
      const s = landSpot(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0, 30);
      seals.push(makeSeal(s.x, s.z));
    }
    sealsShot = 0; cubsDown = 0;
    banner('🩸 FOUR BLOOD SEALS RISE', 'Red beams pierce the sky — SHOOT each seal to unleash what waits inside.', '#ff3a3a');
    refreshPill();
  }

  // a seal was shot (routed here from the enemies onKill hook) — burst it and spawn a cub
  function onSealShot(enemy) {
    const s = seals.find((x) => x.enemy === enemy);
    if (!s || s.shot) return;
    s.shot = true; sealsShot++;
    // hide the sigil, keep a dim broken dais + fading beam
    if (s.disc) s.disc.visible = false;
    if (s.beamMat) { s.beamMat.color.setHex(0x662020); s.beamMat.opacity = 0.14; }
    if (W.sfx) { if (W.sfx.boom) W.sfx.boom(); if (W.sfx.roar) W.sfx.roar(); }
    shake(0.5);
    if (W.enemies && W.enemies.spawnGymCub) W.enemies.spawnGymCub(s.x + rnd(-1.5, 1.5), s.z + rnd(-1.5, 1.5));
    banner('🐻 A GYM CUB BURSTS OUT!', 'Seal ' + sealsShot + '/' + N_SEALS + ' broken — put it down.', '#ff9a3a');
    refreshPill();
  }

  // one of the seal cubs was killed (routed from onKill)
  function onCubDown() {
    cubsDown++;
    if (cubsDown >= N_SEALS && sealsShot >= N_SEALS) {
      banner('🚪 THE EARTH SPLITS', 'A colossal door tears open at the edge of the map…', '#ff5a2a');
      summonFinale();
    } else {
      toast('🐻 Gym cub down — ' + cubsDown + '/' + N_SEALS);
    }
    refreshPill();
  }

  // all four cubs are dead: raise the door at the map edge and start the booms at once
  function summonFinale() {
    phase = 'door';
    const c = campCenter;
    const a = rnd(0, 6.283), r = 340;                 // out at the edge of the woods
    const s = landSpot(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0, 60);
    doorPos = s;
    door = makeGiantDoor(s.x, s.z);
    startBooms();                                     // no need to walk to it — he's coming NOW
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
    banner('💪 SIR BUFF EMERGES!', 'The doors burst open — HE IS HUNTING YOU.', '#ff5a2a');
    if (W.sfx) { if (W.sfx.boom) W.sfx.boom(); if (W.sfx.roar) setTimeout(() => W.sfx.roar(), 250); }
    shake(1.4);
    const dp = doorPos || { x: 0, z: 0 };
    if (W.enemies && W.enemies.spawnBuffington) {
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
  function refreshPill() {
    if (!pill) return;
    let html = '';
    if (phase === 'collect') html = '🐺 Wolf Ritual — <b style="color:#ff8a8a">' + sacrificed + ' / ' + NEED + '</b> corpses burned · burn them at a 🔥 campfire';
    else if (phase === 'seals') html = '🩸 Seals broken <b style="color:#ff6a6a">' + sealsShot + ' / ' + N_SEALS + '</b> · cubs beaten <b style="color:#ffcf4a">' + cubsDown + ' / ' + N_SEALS + '</b> — shoot the red beams';
    else if (phase === 'door') html = '🚪 A colossal door splits open at the edge of the map…';
    else html = '💪 Sir Buff is hunting you!';
    pill.innerHTML = html;
    pill.style.display = 'block';
  }
  function updatePrompt(p) {
    if (!prompt) return;
    let show = '';
    if (phase === 'collect') {
      const c = W.sack && W.sack.corpseCount ? W.sack.corpseCount() : 0;
      const fire = c > 0 ? nearestCampfire(p.pos.x, p.pos.z) : null;
      if (fire && fire.d < FIRE_R) {
        show = 'Press <b style="background:#4a1012;border:1px solid #d43a3a;border-radius:5px;padding:0 6px;">F</b> to burn <b>' + c + '</b> wolf corpse' + (c === 1 ? '' : 's') + ' in the 🔥 fire';
      }
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

    // spin the seal sigils
    for (const s of seals) { if (s.shot) continue; const d = s.disc; if (d) { d.rotation.y += dt * 1.6; d.position.y = Math.sin(t * 2 + s.x) * 0.12; } }

    if (!p || !p.active || !p.alive) { if (prompt) prompt.style.display = 'none'; return; }

    // fallback: if the player walks up to the door before the auto-booms, that's fine too
    if (phase === 'door' && doorPos && boomT < 0 && !doorOpened) {
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

  // ---- input: F at a campfire burns corpses (runs before player.interactF) ----
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat) return;
    if (phase !== 'collect') return;
    const p = P(); if (!p || !p.active || !p.alive) return;
    if ((W.sack && W.sack.corpseCount ? W.sack.corpseCount() : 0) <= 0) return;   // no corpses -> let F cook/drink as usual
    const fire = nearestCampfire(p.pos.x, p.pos.z);
    if (!fire || fire.d > FIRE_R) return;
    e.stopImmediatePropagation();     // consume F so it doesn't also cook / drink
    sacrifice();
  }, true);

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!(W.player && W.player.scene && W.world && W.world.heightAt && W.sack)) return;
    ready = true;
    scene = W.player.scene;
    if (W.enemies) W.enemies.buffTimer = 1e9;   // Buff no longer roams in on a timer — only the ritual summons him
    const camp = (W.world.campfires && W.world.campfires[0]) ? W.world.campfires[0] : { x: 0, z: 0 };
    campCenter = { x: camp.x, z: camp.z };      // measure seals/door from the spawn camp
    buildHud(); refreshPill();
    requestAnimationFrame(loop);
    setTimeout(() => toast('🔥 Burn ' + NEED + ' wolf corpses in a campfire to summon something ancient…'), 2600);

    // public hook + owner/debug helpers
    W.ritual = {
      onKill: function (e) {
        if (!e || !e.group) return false;
        if (e.isSeal) { onSealShot(e); return true; }          // seal popped -> spawn a cub (don't shrink the sigil)
        if (e.ritualCub) { onCubDown(e); return false; }        // a seal cub fell -> advance; let it shrink normally
        if (e.buffBoss) return false;
        if (e.kind !== 'wolf' && e.kind !== 'werewolf') return false;
        const pos = e.group.position;
        if (W.enemies && W.enemies.scene) W.enemies.scene.remove(e.group);   // take the standing body away
        if (W.sack && W.sack.dropCorpseAt) W.sack.dropCorpseAt(pos.x, pos.z); // …and leave a lootable carcass
        return true;                                                          // handled: skip the shrink animation
      },
      progress: () => ({ sacrificed, need: NEED, sealsShot, cubsDown, phase }),
      // debug (owner console): jump the ritual forward
      _sacrifice: (n) => { sacrificed = Math.min(NEED, sacrificed + (n || 0)); if (sacrificed >= NEED && phase === 'collect') revealSeals(); refreshPill(); },
      _reveal: () => { sacrificed = NEED; if (phase === 'collect') revealSeals(); },
      _popSeals: () => { for (const s of seals) if (!s.shot && s.enemy && s.enemy.alive) { s.enemy.alive = false; const i = W.enemies.list.indexOf(s.enemy); if (i >= 0) W.enemies.list.splice(i, 1); onSealShot(s.enemy); } },
      _finale: () => { sealsShot = N_SEALS; cubsDown = N_SEALS; summonFinale(); },
    };
  }, 400);
})();
