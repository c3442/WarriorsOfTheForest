/* Personal name crate — when you start playing, a wooden crate stamped with YOUR
   name drops in front of you. Walk up and press B to crack it open for a starter
   kit. It's yours alone: the crate remembers the owner's name, so you can only
   break open your own. Self-contained: own mesh, loop, HUD prompt & key capture. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;
  const OPEN_R = 3.2;

  let scene = null, ready = false, crate = null, owner = '', opened = false, spawned = false;
  let lid = null, phase = 0, opening = 0, prompt = null;

  // prefer the name you typed in the menu; fall back to the co-op net name
  const myName = () => {
    const ni = document.getElementById('nameInput');
    const typed = ni && ni.value.trim();
    return (typed || (W.net && W.net.myName) || 'Player').slice(0, 12);
  };

  // ---- crate model ----------------------------------------------------------
  function makeCrate(name) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c6a34, roughness: 0.95, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6f4a22, roughness: 1, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.6, roughness: 0.4, flatShading: true });
    const S = 0.9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(S, S * 0.8, S), wood); body.position.y = S * 0.4; body.castShadow = true; body.receiveShadow = true; g.add(body);
    // plank seams + diagonal braces on each side
    for (const sz of [-S / 2 - 0.01, S / 2 + 0.01]) for (const d of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(S * 0.14, S * 1.0, 0.02), dark);
      br.position.set(0, S * 0.4, sz); br.rotation.z = d * 0.72; g.add(br);
    }
    for (const sx of [-S / 2 - 0.01, S / 2 + 0.01]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, S * 0.8, 0.05), dark); edge.position.set(sx, S * 0.4, 0); g.add(edge);
    }
    // metal corner caps
    for (const sx of [-S / 2, S / 2]) for (const sz of [-S / 2, S / 2]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), iron); cap.position.set(sx, 0.05, sz); g.add(cap);
      const cap2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), iron); cap2.position.set(sx, S * 0.78, sz); g.add(cap2);
    }
    // the lid (hinged at the back) — pops open when you crack it
    lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(S + 0.06, 0.12, S + 0.06), wood); lidMesh.position.set(0, 0.06, S / 2); lidMesh.castShadow = true; lid.add(lidMesh);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.06), iron); latch.position.set(0, 0.02, S + 0.03); lid.add(latch);
    lid.position.set(0, S * 0.8, -S / 2); g.add(lid);

    // floating name banner
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 84;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(28,20,10,.92)'; c.fillRect(6, 8, 308, 64);
    c.strokeStyle = '#e8b24a'; c.lineWidth = 4; c.strokeRect(6, 8, 308, 64);
    c.font = "bold 30px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffe6a8'; c.fillText('📦 ' + name + "'s crate", 160, 42);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    spr.scale.set(2.4, 0.63, 1); spr.position.set(0, 1.55, 0); g.add(spr);
    g.userData.banner = spr;
    return g;
  }

  function spawnCrate() {
    if (spawned) return; const p = P(); if (!p || !p.pos) return;
    owner = myName();
    crate = makeCrate(owner);
    const yaw = p.yaw || 0;
    let cx = p.pos.x - Math.sin(yaw) * 2.8, cz = p.pos.z - Math.cos(yaw) * 2.8;
    if (W.world.heightAt(cx, cz) <= (W.CONFIG.WATER_LEVEL + 0.4)) { cx = p.pos.x; cz = p.pos.z - 2.8; }   // avoid water
    crate.position.set(cx, W.world.heightAt(cx, cz), cz);
    scene.add(crate); spawned = true;
  }

  function nearCrate() { const p = P(); return p && crate && !opened && W.util.dist2(p.pos.x, p.pos.z, crate.position.x, crate.position.z) < OPEN_R; }

  function openCrate() {
    if (opened || !crate) return;
    const p = P(); if (!p) return;
    if (owner !== myName()) { if (W.hud && W.hud.toast) W.hud.toast("That's not your crate! 📦"); return; }   // only your own
    opened = true; opening = 0.001;
    // ---- starter kit ----
    p.wood = (p.wood || 0) + 20;
    p.bandaids = (p.bandaids || 0) + 3;
    if (p.berryMax) p.berries = Math.min(p.berryMax, (p.berries || 0) + 2);
    if (p.bottleMax) p.bottle = p.bottleMax;
    if (p.heldBerry && p.berries > 0) p.heldBerry.visible = true;
    if (W.hud && W.hud.toast) W.hud.toast('📦 Opened your crate! +20 🪵  +3 🩹  +2 🍓  full 💧');
    if (W.hud && W.hud.banner) W.hud.banner('📦 ' + owner.toUpperCase() + "'S CRATE", 'A starter kit to get you going!', '#e8b24a');
  }

  // ---- loop -----------------------------------------------------------------
  function loop() {
    requestAnimationFrame(loop);
    if (!crate) return;
    phase += 0.03;
    if (crate.userData.banner) crate.userData.banner.material.rotation = 0;
    if (!opened) {
      crate.rotation.y = Math.sin(phase * 0.5) * 0.04;
    } else if (opening > 0) {
      opening += 0.03;
      if (lid) lid.rotation.x = -Math.min(2.2, opening * 3.5);          // swing the lid open
      crate.position.y -= 0.004;                                        // sink slightly
      crate.traverse((o) => { if (o.material && o.material.transparent !== undefined && o.isMesh) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - (opening - 0.6)); } });
      if (opening > 1.6) { scene.remove(crate); crate = null; }         // gone once opened
    }
    if (prompt) prompt.style.display = nearCrate() ? 'block' : 'none';
  }

  // ---- HUD + input ----------------------------------------------------------
  function buildPrompt() {
    const css = document.createElement('style');
    css.textContent = '#cratePrompt{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:6;display:none;' +
      'padding:7px 14px;border-radius:20px;background:rgba(28,20,10,.78);border:2px solid rgba(232,178,74,.75);' +
      "color:#ffe6a8;font:bold 14px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;}";
    document.head.appendChild(css);
    prompt = document.createElement('div'); prompt.id = 'cratePrompt'; prompt.textContent = '🔓 Press B to open your crate';
    document.body.appendChild(prompt);
  }
  // B opens the crate when you're right by it (else it falls through to car / bandaid)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyB' || e.repeat) return;
    if (nearCrate()) { e.stopImmediatePropagation(); openCrate(); }
  }, true);

  function addMobile() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mCrate')) return;
    const b = document.createElement('div'); b.id = 'mCrate'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '📦';
    const t = document.createElement('span'); t.textContent = 'Crate';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (nearCrate()) openCrate(); else if (W.hud && W.hud.toast) W.hud.toast('Get closer to your crate 📦'); }, { passive: false });
    acts.insertBefore(b, acts.firstChild);
  }

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!W.player || !W.player.scene || !W.player.active || !W.world || !W.world.heightAt) return;
    ready = true;
    scene = W.player.scene;
    buildPrompt();
    spawnCrate();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    W.namecrate = { near: nearCrate, open: openCrate, opened: () => opened, owner: () => owner, pos: () => (crate ? { x: crate.position.x, z: crate.position.z } : null) };
  }, 400);
})();
