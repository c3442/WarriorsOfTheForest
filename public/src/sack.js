/* The Sack — a starting loot bag with limited slots (10), plus "sack upgraders"
   you find in/around buildings that add capacity. Loot orbs spawn near the camp
   and the village; walk over one to pocket it (if there's room). Self-contained:
   its own scene meshes, rAF loop, HUD pill + panel — never touches game files. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;

  const START_CAP = 10, UPGRADE_STEP = 5, PICK_R = 1.7;
  const LOOT = [
    { e: '🪙', n: 'Coin', c: 0xffcf4a }, { e: '💎', n: 'Gem', c: 0x5ad6ff }, { e: '💍', n: 'Ring', c: 0xffe08a },
    { e: '🏺', n: 'Relic', c: 0xc98a4a }, { e: '📜', n: 'Scroll', c: 0xe8d9a0 }, { e: '🔑', n: 'Key', c: 0xffd24a },
    { e: '🧪', n: 'Potion', c: 0x9a5ad6 }, { e: '🍯', n: 'Honey', c: 0xffb020 },
  ];

  let scene = null, ready = false, open = false;
  const loots = [], uppers = [];
  const dropped = [];                 // physical items lying on the ground (chopped wood, dropped sack items)
  let highlighted = null;             // the ground item you're currently looking at (outlined blue)
  const _ray = new THREE.Raycaster(); _ray.far = 6.5;   // "look at it" reach
  let last = performance.now() / 1000;
  const now = () => performance.now() / 1000;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function sack() { const p = P(); if (!p) return null; if (p.sack == null) { p.sack = []; p.sackCap = START_CAP; } return p; }

  // ---- pickups (3D) ---------------------------------------------------------
  const gemGeo = new THREE.IcosahedronGeometry(0.24, 0);
  function makeLoot(item, x, z) {
    const y = W.world.heightAt(x, z) + 0.7;
    const m = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({ color: item.c, emissive: item.c, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.3, flatShading: true }));
    m.position.set(x, y, z); m.castShadow = true; scene.add(m);
    const light = new THREE.PointLight(item.c, 0.5, 3); light.position.set(x, y, z); scene.add(light);
    return { mesh: m, light, item, y0: y, t: Math.random() * 6 };
  }
  function makeUpgrader(x, z) {
    const g = new THREE.Group();
    const burlap = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.95, flatShading: true });
    const tie = new THREE.MeshStandardMaterial({ color: 0x6b4a24, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), burlap); body.scale.set(1, 1.2, 1); body.position.y = 0.34; body.castShadow = true; g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.16, 8), burlap); neck.position.y = 0.68; g.add(neck);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12), tie); band.rotation.x = Math.PI / 2; band.position.y = 0.64; g.add(band);
    // glowing green "+" floating above
    const plusMat = new THREE.MeshStandardMaterial({ color: 0x9dff70, emissive: 0x46d020, emissiveIntensity: 1.3, roughness: 0.4 });
    const pv = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), plusMat); pv.position.y = 1.05; g.add(pv);
    const ph = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), plusMat); ph.position.y = 1.05; g.add(ph);
    const y = W.world.heightAt(x, z);
    g.position.set(x, y, z); scene.add(g);
    const light = new THREE.PointLight(0x8dff5a, 0.7, 4); light.position.set(x, y + 1, z); scene.add(light);
    return { group: g, light, y0: y, t: Math.random() * 6 };
  }

  // scatter n points in a ring on solid ground around a centre
  function ringSpots(cx, cz, r0, r1, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 8; tries++) {
        const a = Math.random() * Math.PI * 2, r = rnd(r0, r1);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (W.world.heightAt(x, z) > (W.CONFIG.WATER_LEVEL + 0.6)) { out.push([x, z]); break; }
      }
    }
    return out;
  }

  function spawnWorld() {
    // loot + one upgrader around the home camp (so you meet the mechanic immediately)
    ringSpots(0, 0, 5, 16, 5).forEach(([x, z]) => loots.push(makeLoot(LOOT[Math.floor(Math.random() * LOOT.length)], x, z)));
    ringSpots(0, 0, 8, 14, 1).forEach(([x, z]) => uppers.push(makeUpgrader(x, z)));
    // the village: loot among the houses + a few sack upgraders "in the buildings"
    const vp = W.world.villagePos;
    if (vp) {
      ringSpots(vp.x, vp.z, 6, 30, 8).forEach(([x, z]) => loots.push(makeLoot(LOOT[Math.floor(Math.random() * LOOT.length)], x, z)));
      ringSpots(vp.x, vp.z, 10, 28, 4).forEach(([x, z]) => uppers.push(makeUpgrader(x, z)));
    }
    // outposts, if any, hide an upgrader too
    (W.world.outposts || []).forEach((o) => ringSpots(o.x, o.z, 4, 12, 1).forEach(([x, z]) => uppers.push(makeUpgrader(x, z))));
  }

  // ---- loop -----------------------------------------------------------------
  function loop() {
    requestAnimationFrame(loop);
    const t = now(); const dt = Math.min(0.1, t - last); last = t;
    tickPickups(dt);
    updateDropped(dt);
  }
  function tickPickups(dt) {
    const p = sack(); if (!p || !p.active || !p.alive) return;
    const px = p.pos.x, pz = p.pos.z;

    for (let i = loots.length - 1; i >= 0; i--) {
      const L = loots[i]; L.t += dt;
      L.mesh.position.y = L.y0 + Math.sin(L.t * 2.2) * 0.12; L.mesh.rotation.y += dt * 1.6;
      if (W.util.dist2(px, pz, L.mesh.position.x, L.mesh.position.z) < PICK_R) {
        if (p.sack.length >= p.sackCap) { toast('🎒 Sack full! Find a sack upgrader'); L.t -= 0.8; continue; }
        p.sack.push({ e: L.item.e, n: L.item.n });
        scene.remove(L.mesh); scene.remove(L.light); loots.splice(i, 1);
        toast('+' + L.item.e + ' ' + L.item.n + '  (' + p.sack.length + '/' + p.sackCap + ')'); refreshPill(); if (open) refreshPanel();
      }
    }
    for (let i = uppers.length - 1; i >= 0; i--) {
      const U2 = uppers[i]; U2.t += dt;
      U2.group.position.y = U2.y0 + Math.sin(U2.t * 1.8) * 0.14; U2.group.rotation.y += dt * 1.1;
      if (W.util.dist2(px, pz, U2.group.position.x, U2.group.position.z) < PICK_R) {
        p.sackCap += UPGRADE_STEP;
        scene.remove(U2.group); scene.remove(U2.light); uppers.splice(i, 1);
        toast('🎒 Sack upgraded! Now holds ' + p.sackCap + ' items'); refreshPill(); if (open) refreshPanel();
      }
    }
  }
  function toast(m) { if (W.hud && W.hud.toast) W.hud.toast(m); }

  // ---- physical dropped items (chopped wood etc.) ---------------------------
  const logGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.62, 8);
  const logMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 1, flatShading: true });
  // wolf carcass parts (dropped when a wolf/werewolf dies): a grey furry body, stiff legs & a head
  const corpseGeo = new THREE.BoxGeometry(0.95, 0.32, 0.44);
  const corpseLegGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.34, 6);
  const corpseHeadGeo = new THREE.BoxGeometry(0.32, 0.3, 0.3);
  const corpseMat = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 1, flatShading: true });
  const noHit = function () {};
  // a ground pickup lying on the ground, with a hidden blue outline shell for the "look at it" highlight.
  // Wood = a log; a wolf corpse = a little carcass. Only the main mesh raycasts (decorations don't).
  function makeDrop(item, x, z) {
    const corpse = !!item.corpse;
    const y = W.world.heightAt(x, z) + (corpse ? 0.2 : 0.16);
    const m = new THREE.Mesh(corpse ? corpseGeo : logGeo, corpse ? corpseMat : logMat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (corpse) {
      m.rotation.set(0, Math.random() * 6.28, 0);
      for (const sx of [-0.27, 0.27]) for (const sz of [-0.13, 0.13]) { const leg = new THREE.Mesh(corpseLegGeo, corpseMat); leg.position.set(sx, 0.2, sz); leg.rotation.x = 0.25; leg.raycast = noHit; m.add(leg); }
      const head = new THREE.Mesh(corpseHeadGeo, corpseMat); head.position.set(0.62, -0.02, 0); head.raycast = noHit; m.add(head);
    } else {
      m.rotation.set(Math.PI / 2, Math.random() * 6.28, 0);
    }
    const outline = new THREE.Mesh(corpse ? corpseGeo : logGeo, new THREE.MeshBasicMaterial({ color: 0x3b8bff, side: THREE.BackSide }));
    outline.scale.set(corpse ? 1.22 : 1.35, corpse ? 1.35 : 1.15, corpse ? 1.25 : 1.35); outline.visible = false; outline.raycast = noHit; m.add(outline);
    scene.add(m);
    return { mesh: m, outline, item, x, z, y0: y, t: Math.random() * 6 };
  }
  // called by player.js when a tree is felled — one log per wood, so N wood = N sack slots
  function dropWoodAt(x, z, n) {
    const logs = Math.max(1, Math.min(12, Math.round(n)));         // one log = one wood = one sack slot
    for (let i = 0; i < logs; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.6, 2.4);
      const lx = x + Math.cos(a) * r, lz = z + Math.sin(a) * r;
      dropped.push(makeDrop({ e: '🪵', n: 'Wood', wood: 1 }, lx, lz));
    }
  }
  // called by the Wolf Ritual (via enemies.kill) when a wolf/werewolf dies — leaves a lootable carcass.
  // Caps ground corpses so a dawn cull of many wolves doesn't litter the whole map.
  function dropCorpseAt(x, z) {
    let n = 0; for (const d of dropped) if (d.item && d.item.corpse) n++;
    if (n >= 30) { for (let i = 0; i < dropped.length; i++) { if (dropped[i].item && dropped[i].item.corpse) { scene.remove(dropped[i].mesh); dropped.splice(i, 1); break; } } }
    const a = Math.random() * Math.PI * 2, r = rnd(0.2, 0.9);
    dropped.push(makeDrop({ e: '🐺', n: 'Wolf Corpse', corpse: 1 }, x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  function corpseCount() { const p = P(); if (!p || !p.sack) return 0; let n = 0; for (const s of p.sack) if (s.corpse) n++; return n; }
  function removeCorpses(max) {
    const p = P(); if (!p || !p.sack) return 0; let removed = 0;
    for (let i = p.sack.length - 1; i >= 0 && removed < max; i--) { if (p.sack[i].corpse) { p.sack.splice(i, 1); removed++; } }
    if (removed) { refreshPill(); if (open) refreshPanel(); }
    return removed;
  }
  // each frame: bob the logs, and raycast from the camera to outline the one you're looking at
  function updateDropped(dt) {
    const p = P(); const cam = p && p.camera;
    for (const d of dropped) { d.t += dt; d.mesh.position.y = d.y0 + Math.sin(d.t * 2) * 0.04; }
    let look = null;
    if (cam && p.active && p.alive && dropped.length) {
      _ray.setFromCamera({ x: 0, y: 0 }, cam);
      const hit = _ray.intersectObjects(dropped.map((d) => d.mesh), false)[0];
      if (hit) look = dropped.find((d) => d.mesh === hit.object) || null;
    }
    if (look !== highlighted) {
      if (highlighted) highlighted.outline.visible = false;
      highlighted = look;
      if (highlighted) highlighted.outline.visible = true;
    }
    refreshPrompt();
  }
  // J: pocket the item you're looking at into the sack (wood also credits your wood pile)
  function pocketLookedAt() {
    const p = sack(); if (!p || !highlighted) return false;
    if (p.sack.length >= p.sackCap) { toast('🎒 Sack full! Find a sack upgrader'); return true; }
    const it = highlighted.item;
    p.sack.push({ e: it.e, n: it.n, corpse: it.corpse ? 1 : 0, drop: { wood: it.wood || 0, corpse: it.corpse ? 1 : 0 } });
    if (it.wood) p.wood += it.wood;                               // wood becomes usable once sacked
    scene.remove(highlighted.mesh);
    const di = dropped.indexOf(highlighted); if (di >= 0) dropped.splice(di, 1);
    highlighted = null;
    toast('🎒 Sacked ' + it.e + ' ' + it.n + (it.wood ? ' (+' + it.wood + ' wood)' : '') + '  (' + p.sack.length + '/' + p.sackCap + ')');
    refreshPill(); if (open) refreshPanel(); refreshPrompt();
    return true;
  }
  // K: drop the most-recently-sacked physical item back onto the ground at your feet
  function dropFromSack() {
    const p = sack(); if (!p) return false;
    let idx = -1;
    for (let i = p.sack.length - 1; i >= 0; i--) { if (p.sack[i].drop) { idx = i; break; } }
    if (idx < 0) return false;                                    // nothing droppable -> let K fall through (sleep)
    const it = p.sack.splice(idx, 1)[0];
    if (it.drop.wood) p.wood = Math.max(0, p.wood - it.drop.wood);
    const sin = Math.sin(p.yaw || 0), cos = Math.cos(p.yaw || 0);
    dropped.push(makeDrop({ e: it.e, n: it.n, wood: it.drop.wood, corpse: it.drop.corpse }, p.pos.x - sin * 1.2, p.pos.z - cos * 1.2));
    toast('⬇️ Dropped ' + it.e + ' ' + it.n + (it.drop.wood ? ' (-' + it.drop.wood + ' wood)' : ''));
    refreshPill(); if (open) refreshPanel();
    return true;
  }

  // ---- HUD ------------------------------------------------------------------
  let pill = null, panel = null, grid = null, prompt = null;
  function buildHud() {
    const css = document.createElement('style');
    css.textContent = `
      #sackPill{position:fixed;right:16px;top:96px;z-index:6;display:flex;align-items:center;gap:6px;
        padding:6px 11px;border-radius:20px;background:rgba(20,26,16,.62);border:2px solid rgba(180,150,90,.6);
        color:#fff;font:bold 14px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;cursor:pointer;
        backdrop-filter:blur(2px);-webkit-tap-highlight-color:transparent;}
      #sackPill:active{transform:scale(.96);}
      #sackPanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;display:none;
        background:#b79a6a;border:3px solid #6b4a24;border-top-color:#e8cf9a;border-left-color:#e8cf9a;border-radius:5px;
        padding:12px 14px 14px;box-shadow:0 12px 34px rgba(0,0,0,.6);}
      #sackPanel.on{display:block;}
      #sackPanel .st{font:bold 15px 'Trebuchet MS',sans-serif;color:#3a2a12;margin-bottom:9px;letter-spacing:.5px;}
      #sackGrid{display:grid;grid-template-columns:repeat(5,46px);gap:5px;}
      #sackGrid .sl{width:46px;height:46px;background:#8a6f44;border:2px solid #4a3318;border-right-color:#caa16a;border-bottom-color:#caa16a;
        display:flex;align-items:center;justify-content:center;font-size:24px;}
      #sackGrid .sl.empty{opacity:.3;}
      #sackPanel .sh{color:#4a3318;font-size:11px;margin-top:9px;}
    `;
    document.head.appendChild(css);
    pill = document.createElement('div'); pill.id = 'sackPill'; pill.innerHTML = '🎒 <span id="sackN">0/' + START_CAP + '</span>';
    const tog = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } toggle(); };
    pill.addEventListener('click', tog); pill.addEventListener('touchstart', tog, { passive: false });
    document.body.appendChild(pill);
    panel = document.createElement('div'); panel.id = 'sackPanel';
    panel.innerHTML = '<div class="st">🎒 SACK</div><div id="sackGrid"></div><div class="sh">walk over 💎 loot to grab · find 🎒➕ upgraders in buildings · <b>`</b> or tap the pill to close</div>';
    document.body.appendChild(panel); grid = panel.querySelector('#sackGrid');
    prompt = document.createElement('div'); prompt.id = 'sackPrompt';
    prompt.style.cssText = 'position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:7;display:none;' +
      'background:rgba(14,26,44,.82);border:2px solid #3b8bff;border-radius:11px;padding:7px 15px;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#dcefff;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none;";
    document.body.appendChild(prompt);
  }
  function refreshPrompt() {
    if (!prompt) return;
    if (highlighted) { const it = highlighted.item; prompt.style.display = 'block'; prompt.innerHTML = 'Press <b style="background:#173a5e;border:1px solid #3b8bff;border-radius:5px;padding:0 6px;">J</b> to sack the ' + it.e + ' <b>' + it.n + '</b>'; }
    else prompt.style.display = 'none';
  }
  function refreshPill() { const p = sack(); const n = document.getElementById('sackN'); if (p && n) n.textContent = p.sack.length + '/' + p.sackCap; }
  function refreshPanel() {
    const p = sack(); if (!grid || !p) return;
    grid.innerHTML = '';
    for (let i = 0; i < p.sackCap; i++) {
      const s = document.createElement('div'); const it = p.sack[i];
      s.className = 'sl' + (it ? '' : ' empty'); s.textContent = it ? it.e : '·'; if (it) s.title = it.n;
      grid.appendChild(s);
    }
  }
  function toggle() { open = !open; if (panel) panel.classList.toggle('on', open); if (open) refreshPanel(); }
  window.addEventListener('keydown', (e) => { if (e.code === 'Backquote' && !e.repeat) { e.stopPropagation(); toggle(); } });

  function addMobile() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mSack')) return;
    const b = document.createElement('div'); b.id = 'mSack'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '🎒';
    const t = document.createElement('span'); t.textContent = 'Sack';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); }, { passive: false });
    acts.insertBefore(b, acts.firstChild);
  }

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!W.player || !W.player.scene || !W.world || !W.world.heightAt) return;
    ready = true;
    scene = W.player.scene;
    const p = W.player; if (p.sack == null) { p.sack = []; p.sackCap = START_CAP; }   // start WITH an empty sack
    buildHud(); refreshPill();
    // welcome message announcing the starting sack
    setTimeout(() => { if (W.hud && W.hud.toast) W.hud.toast('🎒 You got a Sack! Holds ' + START_CAP + ' items — press ` (or tap 🎒) to open'); }, 1600);
    spawnWorld();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    W.sack = { count: () => (P() ? P().sack.length : 0), cap: () => (P() ? P().sackCap : 0), toggle,
               loots: () => loots.length, uppers: () => uppers.length,
               dropWoodAt, pocketLookedAt, dropFromSack,        // tree-drop + look-J-pocket + K-drop
               looking: () => (highlighted ? highlighted.item : null), droppedCount: () => dropped.length,
               _tick: (dt) => tickPickups(dt || 0.016),
               _lootPos: () => (loots[0] ? { x: loots[0].mesh.position.x, z: loots[0].mesh.position.z } : null),
               _upPos: () => (uppers[0] ? { x: uppers[0].group.position.x, z: uppers[0].group.position.z } : null) };
  }, 400);
})();
