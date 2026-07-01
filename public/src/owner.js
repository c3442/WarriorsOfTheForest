/* Owner pack — a private, gated bundle of custom art + gadgets that only unlocks
   on the owner's own browser. Visit the game once with ?owner=lin8up in the URL
   and it's remembered (localStorage) on that device forever; everyone else gets
   nothing and never even downloads these assets.

   Unlocks:
     • all 11 custom images as built-in Build Mode (V) block textures
     • a futuristic BLASTER — press P to fire fast energy bolts
     • THROWABLE GRENADES — press Y to lob one; it arcs, fuses, and explodes (AoE)
   Fully self-contained: its own loops, key handlers and HUD. Reuses the public
   builder + enemies APIs, so it never touches contested game files. */
(function () {
  const W = window.WOTF;
  if (!W) return;

  // ---- owner gate -----------------------------------------------------------
  const SECRET = 'lin8up';
  try {
    const code = new URLSearchParams(location.search).get('owner');
    if (code) localStorage.setItem('wotf_owner', code);
  } catch (e) {}
  let OWNER = false;
  try { OWNER = localStorage.getItem('wotf_owner') === SECRET; } catch (e) {}
  if (!OWNER) return;                              // not the owner -> do nothing at all

  const BASE = 'assets/custom/';
  // [build-palette id, file, 3D shape] — all 11 become placeable 3D props; some double as gadgets
  const PACK = [
    ['brick', 'brick.png', 'box'], ['jap-floor', 'jap-floor.png', 'box'], ['cool-door', 'cool-door.png', 'slab'],
    ['barrel', 'barrel.png', 'cylinder'], ['iron-pole', 'iron-pole.png', 'rod'], ['elevator', 'elevator.png', 'box'],
    ['room', 'room.png', 'box'], ['bar', 'bar.png', 'box'], ['blaster', 'blaster.png', 'prop'],
    ['grenade-1', 'grenade-1.png', 'sphere'], ['grenade-2', 'grenade-2.png', 'sphere'],
  ];

  const now = () => performance.now() / 1000;
  let scene = null, cam = null;
  const bolts = [], nades = [], fx = [];
  const tl = new THREE.TextureLoader();
  let nadeTex = null;

  // ---- blaster --------------------------------------------------------------
  const BLAST_CD = 0.13, BLAST_DMG = 34, BLAST_SPEED = 90;
  let lastBlast = 0;
  const boltGeo = new THREE.SphereGeometry(0.16, 8, 8);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x33ccff, emissiveIntensity: 1.6, roughness: 0.4 });
  function fireBlaster() {
    const p = W.player; if (!p || !p.active || !p.alive || p.downed) return;
    if (now() - lastBlast < BLAST_CD) return; lastBlast = now();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const pos = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.8);
    const m = new THREE.Mesh(boltGeo, boltMat); m.position.copy(pos); scene.add(m);
    bolts.push({ mesh: m, vel: dir.multiplyScalar(BLAST_SPEED), life: 0 });
    if (W.audio && W.audio.blip) W.audio.blip();
  }
  function stepBolts(dt) {
    const host = !(W.net && W.net.role === 'client');
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.life += dt; b.mesh.position.addScaledVector(b.vel, dt);
      let hit = false;
      const list = (W.enemies && W.enemies.list) || [];
      for (const e of list) {
        if (!e.alive) continue;
        const ep = e.group.position;
        if (Math.hypot(b.mesh.position.x - ep.x, b.mesh.position.z - ep.z) < 1.3 &&
            b.mesh.position.y > ep.y - 0.3 && b.mesh.position.y < ep.y + 2.6) {
          if (host && W.enemies.damage) W.enemies.damage(e.group, BLAST_DMG, { x: b.mesh.position.x, z: b.mesh.position.z });
          hit = true; break;
        }
      }
      const ground = W.world.heightAt(b.mesh.position.x, b.mesh.position.z);
      if (hit || b.life > 2.2 || b.mesh.position.y < ground) { scene.remove(b.mesh); bolts.splice(i, 1); }
    }
  }

  // ---- grenades -------------------------------------------------------------
  const NADE_CD = 0.7, NADE_FUSE = 1.5, NADE_RADIUS = 7, NADE_DMG = 95;
  let lastNade = 0;
  const nadeGeo = new THREE.BoxGeometry(0.34, 0.46, 0.34);
  function throwGrenade() {
    const p = W.player; if (!p || !p.active || !p.alive || p.downed) return;
    if (now() - lastNade < NADE_CD) return; lastNade = now();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const pos = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.9);
    const mat = nadeTex ? new THREE.MeshStandardMaterial({ map: nadeTex, roughness: 0.7 })
                        : new THREE.MeshStandardMaterial({ color: 0x3c5a30, roughness: 0.7 });
    const m = new THREE.Mesh(nadeGeo, mat); m.position.copy(pos); m.castShadow = true; scene.add(m);
    const vel = dir.multiplyScalar(15); vel.y += 6.5;               // lob it forward + up (~12-14m throw)
    nades.push({ mesh: m, vel, fuse: NADE_FUSE, spin: new THREE.Vector3(7, 5, 9) });
  }
  function explode(pos) {
    // AoE damage with falloff
    const host = !(W.net && W.net.role === 'client');
    const list = (W.enemies && W.enemies.list) || [];
    if (host && W.enemies.damage) {
      for (const e of list) {
        if (!e.alive) continue;
        const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z);
        if (d < NADE_RADIUS) W.enemies.damage(e.group, Math.round(NADE_DMG * (1 - d / NADE_RADIUS)), { x: pos.x, z: pos.z });
      }
    }
    // flash sphere + light
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 }));
    flash.position.copy(pos); scene.add(flash);
    const light = new THREE.PointLight(0xffa030, 4, NADE_RADIUS * 2.4); light.position.copy(pos); light.position.y += 1; scene.add(light);
    fx.push({ flash, light, t: 0 });
    if (W.hud && W.hud.shake) W.hud.shake(0.4);
  }
  function stepNades(dt) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const g = nades[i]; g.fuse -= dt; g.vel.y -= 18 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt; g.mesh.rotation.z += g.spin.z * dt;
      const ground = W.world.heightAt(g.mesh.position.x, g.mesh.position.z);
      if (g.mesh.position.y <= ground + 0.2) { g.mesh.position.y = ground + 0.2; g.vel.multiplyScalar(0.4); g.vel.y = Math.abs(g.vel.y) * 0.3; }  // bounce
      if (g.fuse <= 0) { explode(g.mesh.position.clone()); scene.remove(g.mesh); nades.splice(i, 1); }
    }
  }
  function stepFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt; const k = f.t / 0.45;
      f.flash.scale.setScalar(1 + k * NADE_RADIUS * 0.7); f.flash.material.opacity = Math.max(0, 0.85 * (1 - k));
      f.light.intensity = Math.max(0, 4 * (1 - k));
      if (k >= 1) { scene.remove(f.flash); scene.remove(f.light); fx.splice(i, 1); }
    }
  }

  // ---- loop -----------------------------------------------------------------
  let last = now();
  function loop() {
    requestAnimationFrame(loop);
    const t = now(); let dt = t - last; last = t; if (dt > 0.1) dt = 0.1;
    if (!scene || !cam) return;
    stepBolts(dt); stepNades(dt); stepFx(dt);
  }

  // ---- HUD + input ----------------------------------------------------------
  function buildHud() {
    const css = document.createElement('style');
    css.textContent = `
      #ownBar{position:fixed;right:14px;bottom:84px;z-index:20;display:flex;flex-direction:column;gap:6px;
        font:bold 12px 'Trebuchet MS',system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;align-items:flex-end;}
      #ownBar .og{display:flex;align-items:center;gap:6px;background:rgba(14,18,12,.6);border:2px solid rgba(150,180,110,.5);
        border-radius:20px;padding:4px 10px 4px 6px;}
      #ownBar .og img{width:26px;height:26px;border-radius:5px;object-fit:cover;}
      #ownBar .k{background:#2a3320;border:1px solid #46562f;border-radius:4px;padding:0 5px;}
    `;
    document.head.appendChild(css);
    const bar = document.createElement('div'); bar.id = 'ownBar';
    bar.innerHTML =
      '<div class="og"><img src="' + BASE + 'blaster.png"><span>Blaster <b class="k">P</b></span></div>' +
      '<div class="og"><img src="' + BASE + 'grenade-2.png"><span>Grenade <b class="k">Y</b></span></div>';
    document.body.appendChild(bar);
  }

  window.addEventListener('keydown', (e) => {
    if (W.builder && W.builder.isOn && W.builder.isOn()) return;   // don't fire while building
    if (e.code === 'KeyP') { e.stopImmediatePropagation(); fireBlaster(); }
    else if (e.code === 'KeyY' && !e.repeat) { e.stopImmediatePropagation(); throwGrenade(); }
  }, true);

  function addMobile() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mBlast')) return;
    const mk = (id, emoji, fn) => {
      const b = document.createElement('div'); b.id = id; b.className = 'mpill';
      const e = document.createElement('span'); e.className = 'e'; e.textContent = emoji;
      b.appendChild(e);
      b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); }, { passive: false });
      acts.insertBefore(b, acts.firstChild);
    };
    mk('mNade', '💣', throwGrenade); mk('mBlast', '🔫', fireBlaster);
  }

  // ---- init -----------------------------------------------------------------
  let started = false;
  const wait = setInterval(() => {
    if (started) { clearInterval(wait); return; }
    if (!W.player || !W.player.scene || !W.player.camera || !W.world || !W.world.heightAt) return;
    started = true;
    scene = W.player.scene; cam = W.player.camera;
    nadeTex = tl.load(BASE + 'grenade-2.png');
    // load all 11 custom images as Build Mode block textures
    const loadPack = () => { if (W.builder && W.builder.addPreset) PACK.forEach(([id, f, shape]) => W.builder.addPreset(id, BASE + f, shape)); };
    if (W.builder && W.builder.addPreset) loadPack(); else setTimeout(loadPack, 1200);
    buildHud();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    if (W.hud && W.hud.toast) W.hud.toast('👑 Owner pack unlocked — P blaster · Y grenade · custom blocks in Build (V)');
    W.owner = {
      fireBlaster, throwGrenade, count: () => ({ bolts: bolts.length, nades: nades.length, fx: fx.length }),
      _step: (dt) => { stepBolts(dt); stepNades(dt); stepFx(dt); },   // test hook (preview rAF is suspended)
    };
  }, 400);
})();
