/* The Car — a drivable roadster hidden out in the map, plus fuel cans hidden
   around the world. Find the car, fuel it up, press M near it to drive (it's
   FAST), and race to the boss Sir Buffington. Runs out of fuel? Find more cans.
   Self-contained: its own meshes, loop, HUD and key capture. It drives by
   boosting the player's own movement (player.speedMult) so it never fights the
   game's physics or camera — no game-file edits. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;

  const BOOST = 3.3;          // top speed vs on foot
  const FUEL_MAX = 100, START_FUEL = 40, DRAIN = 2.2, CAN = 40, ENTER_R = 3.6, PICK_R = 1.9;
  const ODO_GOAL = 2000;      // drive this many metres to summon Sir Buffington

  let scene = null, ready = false, driving = false, savedMult = 1;
  let car = null, carHome = null, fuel = START_FUEL;
  let odo = 0, prevX = 0, prevZ = 0, buffSummoned = false;
  const cans = [];
  let last = performance.now() / 1000;
  const now = () => performance.now() / 1000;
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, flatShading: true }, o || {}));

  // ---- models ---------------------------------------------------------------
  function makeCar() {
    const g = new THREE.Group();
    const body = M(0xc42b2b, { metalness: 0.3, roughness: 0.4 });
    const dark = M(0x1c1e22, { roughness: 0.7 });
    const chrome = M(0xcbd0d6, { metalness: 0.8, roughness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.2 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xffe066, emissiveIntensity: 1.2, roughness: 0.4 });
    // main hull (long axis = +Z forward)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 3.6), body); hull.position.y = 0.62; hull.castShadow = true; g.add(hull);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.2), body); hood.position.set(0, 0.86, 1.15); g.add(hood);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.0), body); trunk.position.set(0, 0.88, -1.25); g.add(trunk);
    // open cockpit rim + two seats
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.22, 1.5), body); rim.position.set(0, 1.02, -0.15); g.add(rim);
    const seatM = M(0x2a2a2e, { roughness: 0.9 });
    for (const sx of [-0.4, 0.4]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), seatM); s.position.set(sx, 1.05, -0.35); g.add(s); }
    // windshield
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.5, 0.06), glass); ws.position.set(0, 1.28, 0.55); ws.rotation.x = -0.42; g.add(ws);
    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 16);
    for (const [wx, wz] of [[-0.9, 1.15], [0.9, 1.15], [-0.9, -1.2], [0.9, -1.2]]) {
      const w = new THREE.Mesh(wheelGeo, dark); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz); w.castShadow = true; g.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.36, 8), chrome); hub.rotation.z = Math.PI / 2; hub.position.set(wx, 0.42, wz); g.add(hub);
    }
    // bumpers + headlights
    for (const sx of [-0.5, 0.5]) { const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glow); hl.position.set(sx, 0.7, 1.78); g.add(hl); }
    const bmp = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.14), chrome); bmp.position.set(0, 0.55, 1.82); g.add(bmp);
    return g;
  }
  function makeCan() {
    const g = new THREE.Group();
    const red = M(0xd23a2a, { roughness: 0.6 });
    const dark = M(0x2a2a2e);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.18), red); body.position.y = 0.3; body.castShadow = true; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), dark); cap.position.set(0.1, 0.56, 0); g.add(cap);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), dark); spout.position.set(0.1, 0.64, 0); g.add(spout);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 10), dark); handle.position.set(-0.08, 0.55, 0); handle.rotation.y = Math.PI / 2; g.add(handle);
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.01), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0x554400, emissiveIntensity: 0.5 })); label.position.set(0, 0.3, 0.095); g.add(label);
    return g;
  }

  function landSpot(cx, cz, r0, r1) {
    for (let t = 0; t < 30; t++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (W.world.heightAt(x, z) > (W.CONFIG.WATER_LEVEL + 0.8)) return { x, z };
    }
    return { x: cx + r0, z: cz };
  }

  function spawnWorld() {
    // the car, parked out in the wild (a fair walk from camp so it's a find)
    const s = landSpot(0, 0, 70, 110);
    car = makeCar();
    car.position.set(s.x, W.world.heightAt(s.x, s.z), s.z); car.rotation.y = Math.random() * Math.PI * 2;
    scene.add(car); carHome = { x: s.x, z: s.z };
    // fuel cans hidden FAR and wide — no easy pickups near camp; you have to explore
    const spots = [];
    for (let i = 0; i < 7; i++) spots.push(landSpot(0, 0, 90, 360));
    if (W.world.villagePos) spots.push(landSpot(W.world.villagePos.x, W.world.villagePos.z, 25, 70));
    spots.forEach((sp) => {
      const m = makeCan(); const y = W.world.heightAt(sp.x, sp.z);
      m.position.set(sp.x, y, sp.z); scene.add(m);
      const light = new THREE.PointLight(0xff6a3a, 0.35, 2.6); light.position.set(sp.x, y + 0.5, sp.z); scene.add(light);
      cans.push({ group: m, light, y0: y, t: Math.random() * 6 });
    });
  }

  // ---- drive ----------------------------------------------------------------
  function nearCar() { const p = P(); return p && car && W.util.dist2(p.pos.x, p.pos.z, car.position.x, car.position.z) < ENTER_R; }
  function enter() {
    const p = P(); if (!p || driving) return;
    driving = true; savedMult = p.speedMult || 1; prevX = p.pos.x; prevZ = p.pos.z;
    toast(fuel > 0 ? '🚗 Driving! WASD to go · M to get out' : '🚗 In the car — but it\'s out of fuel! Find a fuel can ⛽');
  }
  function odoStep() {
    const p = P(); if (!p) return;
    const dx = p.pos.x - prevX, dz = p.pos.z - prevZ; prevX = p.pos.x; prevZ = p.pos.z;
    odo += Math.hypot(dx, dz);
    if (odo >= ODO_GOAL && !buffSummoned) {
      buffSummoned = true;
      if (W.enemies && W.enemies.spawnBuffington) W.enemies.spawnBuffington({ x: p.pos.x, z: p.pos.z });
      toast('💪 You drove far enough — SIR BUFFINGTON appears!');
    }
  }
  // Sir Buffington only shows up by driving 2000m — block the game's own timed spawn.
  function blockAutoBuff() { if (W.enemies && !buffSummoned) W.enemies.buffTimer = 1e9; }
  function exitCar() {
    const p = P(); if (!p || !driving) return;
    driving = false; p.speedMult = savedMult;
    if (car) { car.position.set(p.pos.x, W.world.heightAt(p.pos.x, p.pos.z), p.pos.z); car.rotation.y = p.yaw; carHome = { x: p.pos.x, z: p.pos.z }; }
    toast('🅿️ Parked the car');
  }
  function toast(m) { if (W.hud && W.hud.toast) W.hud.toast(m); }

  function loop() {
    requestAnimationFrame(loop);
    const t = now(); const dt = Math.min(0.1, t - last); last = t;
    const p = P(); if (!p || !p.active) { return; }

    // bob the fuel cans + auto-pickup
    for (let i = cans.length - 1; i >= 0; i--) {
      const c = cans[i]; c.t += dt; c.group.position.y = c.y0 + Math.sin(c.t * 2) * 0.1; c.group.rotation.y += dt * 1.3;
      if (p.alive && W.util.dist2(p.pos.x, p.pos.z, c.group.position.x, c.group.position.z) < PICK_R) {
        fuel = Math.min(FUEL_MAX, fuel + CAN);
        scene.remove(c.group); scene.remove(c.light); cans.splice(i, 1);
        toast('⛽ +' + CAN + '% fuel  (' + Math.round(fuel) + '%)');
      }
    }

    blockAutoBuff();
    if (driving) {
      const k = p.keys || {};
      const moving = k.KeyW || k.KeyS || k.KeyA || k.KeyD;
      if (fuel > 0) {
        p.speedMult = savedMult * BOOST;
        if (moving) fuel = Math.max(0, fuel - DRAIN * dt);
        if (fuel === 0) { p.speedMult = savedMult; toast('⛽ Out of fuel! Find a fuel can'); }
      } else {
        p.speedMult = savedMult;
      }
      odoStep();                       // count distance driven → summons the boss at 2000m
      // the car body rides under the player, facing where they steer
      if (car) { car.position.set(p.pos.x, W.world.heightAt(p.pos.x, p.pos.z), p.pos.z); car.rotation.y = p.yaw; }
      if (!p.alive) exitCar();
    }
    updateHud();
  }

  // ---- HUD ------------------------------------------------------------------
  let prompt = null, fuelPill = null, buffPill = null;
  function buildHud() {
    const css = document.createElement('style');
    css.textContent = `
      #carPrompt{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:6;display:none;
        padding:7px 14px;border-radius:20px;background:rgba(20,26,16,.72);border:2px solid rgba(200,150,90,.7);
        color:#fff;font:bold 14px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;}
      #carFuel{position:fixed;right:16px;top:128px;z-index:6;display:none;align-items:center;gap:7px;
        padding:6px 11px;border-radius:20px;background:rgba(20,26,16,.62);border:2px solid rgba(210,120,60,.7);
        color:#fff;font:bold 13px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;}
      #carFuel .bar{width:70px;height:9px;border-radius:5px;background:rgba(0,0,0,.5);overflow:hidden;}
      #carFuel .bar i{display:block;height:100%;background:linear-gradient(90deg,#ffcf5c,#ff7b3a);}
      #buffMark{position:fixed;right:16px;top:160px;z-index:6;display:none;
        padding:5px 10px;border-radius:16px;background:rgba(40,16,16,.6);border:2px solid rgba(255,120,60,.55);
        color:#ffd9c0;font:bold 12px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;}
    `;
    document.head.appendChild(css);
    prompt = document.createElement('div'); prompt.id = 'carPrompt'; prompt.textContent = '🚗 Press M (or tap Drive) to get in';
    fuelPill = document.createElement('div'); fuelPill.id = 'carFuel'; fuelPill.innerHTML = '⛽ <div class="bar"><i id="carFuelBar"></i></div><span id="carFuelPct">40%</span><span id="carOdo" style="margin-left:9px;opacity:.9">🏁 0/' + ODO_GOAL + 'm</span>';
    buffPill = document.createElement('div'); buffPill.id = 'buffMark';
    document.body.appendChild(prompt); document.body.appendChild(fuelPill); document.body.appendChild(buffPill);
  }
  function updateHud() {
    const p = P();
    if (prompt) prompt.style.display = (!driving && nearCar()) ? 'block' : 'none';
    if (fuelPill) {
      fuelPill.style.display = driving ? 'flex' : 'none';
      const bar = document.getElementById('carFuelBar'), pct = document.getElementById('carFuelPct'), od = document.getElementById('carOdo');
      if (bar) bar.style.width = fuel + '%'; if (pct) pct.textContent = Math.round(fuel) + '%';
      if (od) od.textContent = buffSummoned ? '🏁 boss summoned!' : ('🏁 ' + Math.round(odo) + '/' + ODO_GOAL + 'm');
    }
    // waypoint to Sir Buffington whenever he's on the field
    const buff = W.enemies && W.enemies.buff;
    if (buffPill) {
      if (buff && buff.alive && p) {
        const d = Math.round(W.util.dist2(p.pos.x, p.pos.z, buff.group.position.x, buff.group.position.z));
        buffPill.style.display = 'block'; buffPill.textContent = '💪 Sir Buffington — ' + d + 'm';
      } else buffPill.style.display = 'none';
    }
  }

  // ---- input ----------------------------------------------------------------
  // M enters the car when you're next to it, exits when driving — otherwise it
  // falls through to the normal horse mount.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat) return;
    if (driving) { e.stopImmediatePropagation(); exitCar(); }
    else if (nearCar()) { e.stopImmediatePropagation(); enter(); }
  }, true);

  function addMobile() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mCar')) return;
    const b = document.createElement('div'); b.id = 'mCar'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '🚗';
    const t = document.createElement('span'); t.textContent = 'Drive';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (driving) exitCar(); else if (nearCar()) enter(); else toast('Get closer to the car 🚗'); }, { passive: false });
    acts.insertBefore(b, acts.firstChild);
  }

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!W.player || !W.player.scene || !W.world || !W.world.heightAt) return;
    ready = true;
    scene = W.player.scene;
    buildHud();
    spawnWorld();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    W.car = { driving: () => driving, fuel: () => fuel, addFuel: (n) => { fuel = Math.min(FUEL_MAX, fuel + n); },
              pos: () => (car ? { x: car.position.x, z: car.position.z } : null), enter, exit: exitCar,
              _tick: (dt) => { const p = P(); blockAutoBuff(); if (driving && p) { if (fuel > 0) { p.speedMult = savedMult * BOOST; if (p.keys && (p.keys.KeyW||p.keys.KeyS||p.keys.KeyA||p.keys.KeyD)) fuel = Math.max(0, fuel - DRAIN * (dt||0.016)); if (fuel===0) p.speedMult = savedMult; } else p.speedMult = savedMult; odoStep(); } updateHud(); },
              odo: () => odo, _setOdo: (v) => { odo = v; }, buffSummoned: () => buffSummoned, cans: () => cans.length };
  }, 400);
})();
