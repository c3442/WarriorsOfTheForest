/* Build Mode — a self-contained creative map editor.
   Press V to toggle. Aim with the crosshair and:
     left-click  = place a block        right-click = delete a block
     1..8        = pick a palette slot   F = toggle erase   [ ] = cycle palette
     L           = load your own pixel art (becomes a block texture)
     X           = clear everything (asks first)
   Placed blocks snap to a 1-unit grid, are solid to stand on, and are saved to
   THIS browser only (localStorage) — so every player builds their own private map.
   Decoupled from the rest of the game: its own loop + key capture, reuses
   world.platforms so the player can walk on what they build. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const KEY = 'wotf_build_v1';
  const REACH = 60;        // how far you can place/delete
  const MAX_BLOCKS = 2000; // safety cap (platforms are scanned every frame)
  const GEO = new THREE.BoxGeometry(1, 1, 1);

  // default colour palette (indices are stable so saves stay valid)
  const COLORS = ['#7ab648', '#caa46a', '#9a9aa2', '#5a3b25', '#cf4b3b',
                  '#3b7fd1', '#e8d44d', '#e08fd0', '#222428', '#f4f4f4'];

  let on = false, erase = false, sel = 0, ready = false;
  let group = null, ghost = null, ghostMat = null;
  const palette = [];            // { kind:'color'|'tex'|'preset', hex?, url?, id?, mat }
  const textures = [];           // dataURLs of uploaded pixel art (parallel to tex palette entries)
  const presetMats = {};         // id -> material for built-in (URL-loaded) textures
  const presetShape = {};        // id -> 3D shape name ('box'|'cylinder'|'rod'|'slab'|'sphere'|'prop')
  const presetModel = {};        // id -> { make:()=>Object3D, h:number } for real built 3D models
  const blocks = new Map();      // "cx,cy,cz" -> { mesh, plat, desc }
  const ray = new THREE.Raycaster(); ray.far = REACH;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  // ---- palette --------------------------------------------------------------
  function colorMat(hex) { return new THREE.MeshStandardMaterial({ color: hex, roughness: 1, flatShading: true }); }
  function texMat(tex) { return new THREE.MeshStandardMaterial({ map: tex, roughness: 1, flatShading: true }); }
  function makeTex(dataURL, cb) {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;   // crisp pixels, no blur
      tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
      tex.needsUpdate = true; cb(tex);
    };
    img.src = dataURL;
  }
  function buildPalette() {
    palette.length = 0;
    COLORS.forEach((hex) => palette.push({ kind: 'color', hex, mat: colorMat(hex) }));
  }
  function addTexFromURL(dataURL) {
    makeTex(dataURL, (tex) => {
      const mat = texMat(tex);
      textures.push(dataURL);
      const ti = textures.length - 1;
      palette.push({ kind: 'tex', url: dataURL, ti, mat });
      blocks.forEach((b) => { if (b.desc === 't:' + ti) b.mesh.material = mat; });   // re-skin restored blocks
      sel = palette.length - 1; erase = false; refreshBar(); save();
    });
  }
  // built-in textures loaded by URL (e.g. owner asset pack). Referenced by a stable
  // id ('p:<id>'), so they are NOT copied into localStorage — only the id is saved.
  // Each preset can carry a 3D shape so props look like real objects, not flat cubes.
  function addPreset(id, url, shape) {
    presetShape[id] = shape || 'box';
    if (presetMats[id]) return;                       // already loaded
    makeTex(url, (tex) => {
      const mat = texMat(tex);
      presetMats[id] = mat;
      palette.push({ kind: 'preset', id, url, mat, shape: presetShape[id] });
      const g = geoForShape(presetShape[id]);
      blocks.forEach((b) => { if (b.desc === 'p:' + id) { b.mesh.material = mat; if (b.mesh.geometry !== g) b.mesh.geometry = g; } });   // re-skin + re-shape restored blocks
      refreshBar();
    });
  }

  // shared geometries per shape (each ~1 unit so they fit the grid cell)
  const shapeGeo = {};
  function geoForShape(shape) {
    if (shapeGeo[shape]) return shapeGeo[shape];
    let g;
    switch (shape) {
      case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 18); break;      // barrel
      case 'rod': g = new THREE.CylinderGeometry(0.14, 0.14, 1.5, 12); break;       // iron pole
      case 'slab': g = new THREE.BoxGeometry(1, 1, 0.16); break;                    // door
      case 'sphere': g = new THREE.SphereGeometry(0.5, 18, 14); break;              // grenade
      case 'prop': g = new THREE.BoxGeometry(0.9, 0.5, 0.32); break;                // blaster
      default: g = GEO;                                                             // box (surfaces)
    }
    shapeGeo[shape] = g; return g;
  }
  function geoForDesc(desc) {
    if (desc[0] === 'p') return geoForShape(presetShape[desc.slice(2)] || 'box');
    return GEO;
  }

  // Register a real built 3D model (a factory returning an Object3D whose base sits
  // at y=0). Placing this preset spawns the model instead of a textured primitive.
  function addModelPreset(id, url, makeFn, h) {
    presetModel[id] = { make: makeFn, h: h || 1 };
    if (!palette.some((p) => p.kind === 'preset' && p.id === id)) palette.push({ kind: 'preset', id, url, model: true });
    blocks.forEach((b, key) => { if (b.desc === 'p:' + id) rebuildBlock(key); });   // upgrade any restored placeholders to the model
    refreshBar();
  }

  // Build the Object3D for a block descriptor. Model presets -> the built model
  // (base at cell floor); everything else -> a textured 1x1 primitive (centered).
  function buildNode(desc, cx, cy, cz) {
    if (desc[0] === 'p') {
      const id = desc.slice(2), pm = presetModel[id];
      if (pm) { const n = pm.make(); n.position.set(cx + 0.5, cy, cz + 0.5); n.userData.cell = [cx, cy, cz]; return { node: n, top: cy + pm.h }; }
    }
    const mesh = new THREE.Mesh(geoForDesc(desc), matForDesc(desc));
    mesh.position.set(cx + 0.5, cy + 0.5, cz + 0.5);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.cell = [cx, cy, cz];
    return { node: mesh, top: cy + 1 };
  }
  function rebuildBlock(key) {
    const b = blocks.get(key); if (!b) return;
    const [cx, cy, cz] = key.split(',').map(Number);
    group.remove(b.mesh);
    const built = buildNode(b.desc, cx, cy, cz);
    group.add(built.node); b.mesh = built.node; b.plat.y = built.top;
  }

  // ---- block storage --------------------------------------------------------
  const ck = (x, y, z) => x + ',' + y + ',' + z;
  function descOf(pi) {
    const p = palette[pi];
    if (p.kind === 'tex') return 't:' + p.ti;
    if (p.kind === 'preset') return 'p:' + p.id;
    return 'c:' + p.hex;
  }
  function matForDesc(desc) {
    if (desc[0] === 't') { const i = +desc.slice(2); const p = palette.find((q) => q.kind === 'tex' && q.ti === i); return p ? p.mat : palette[0].mat; }
    if (desc[0] === 'p') { return presetMats[desc.slice(2)] || palette[0].mat; }
    const hex = desc.slice(2); const p = palette.find((q) => q.kind === 'color' && q.hex === hex); return p ? p.mat : colorMat(hex);
  }
  function placeAt(cx, cy, cz, desc) {
    if (blocks.size >= MAX_BLOCKS) { if (W.hud) W.hud.toast('Block limit reached (' + MAX_BLOCKS + ')'); return; }
    const key = ck(cx, cy, cz);
    if (blocks.has(key)) removeKey(key);                  // overwrite
    const built = buildNode(desc, cx, cy, cz);
    group.add(built.node);
    // register a 1x1 standable top so the player can walk on it
    const plat = { cx: cx + 0.5, cz: cz + 0.5, cos: 1, sin: 0, x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5, y: built.top };
    W.world.platforms.push(plat);
    blocks.set(key, { mesh: built.node, plat, desc });
  }
  function removeKey(key) {
    const b = blocks.get(key); if (!b) return;
    group.remove(b.mesh);
    const i = W.world.platforms.indexOf(b.plat); if (i >= 0) W.world.platforms.splice(i, 1);
    blocks.delete(key);
  }

  // ---- persistence (this browser only) --------------------------------------
  let saveT = null;
  function save() {
    if (saveT) return; saveT = setTimeout(() => {
      saveT = null;
      try {
        const data = { tex: textures, b: [] };
        blocks.forEach((b, key) => { const [x, y, z] = key.split(',').map(Number); data.b.push([x, y, z, b.desc]); });
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) { /* storage full / disabled — ignore */ }
    }, 250);
  }
  function load() {
    let data = null; try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!data) return;
    (data.b || []).forEach(([x, y, z, desc]) => placeAt(x, y, z, desc));   // place now (textured ones get a placeholder colour)
    (data.tex || []).forEach((url) => addTexFromURL(url));                 // textures decode async, then re-skin matching blocks
  }

  // ---- aiming / raycast -----------------------------------------------------
  function target() {
    const cam = W.player && W.player.camera; if (!cam) return null;
    const terrain = W.player.scene.getObjectByName('terrain');
    const objs = group.children.slice(); if (terrain) objs.push(terrain);
    ray.set(cam.getWorldPosition(tmpA), cam.getWorldDirection(tmpB));
    const hit = ray.intersectObjects(objs, true)[0];      // recursive: models are multi-mesh groups
    if (!hit) return null;
    // walk up to the placed block node (a direct child of the builder group) to get its cell
    let cell = null;
    if (hit.object !== terrain) {
      let nd = hit.object; while (nd && nd.parent !== group) nd = nd.parent;
      if (nd && nd.userData && nd.userData.cell) cell = nd.userData.cell;
    }
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const add = hit.point.clone().addScaledVector(n, 0.5);
    return {
      isBlock: !!cell,
      cell: cell,                                          // exact cell of the block being aimed at (for delete)
      add: [Math.floor(add.x), Math.floor(add.y), Math.floor(add.z)],
    };
  }

  // ---- actions --------------------------------------------------------------
  function doPlace() {
    const t = target(); if (!t) return;
    const [x, y, z] = t.add; placeAt(x, y, z, descOf(sel)); save();
  }
  function doDelete() {
    const t = target(); if (!t || !t.cell) return;
    removeKey(ck(t.cell[0], t.cell[1], t.cell[2])); save();
  }
  function clearAll() {
    if (!blocks.size) return;
    if (!confirm('Delete all ' + blocks.size + ' blocks on your map?')) return;
    Array.from(blocks.keys()).forEach(removeKey); save();
    if (W.hud) W.hud.toast('Map cleared');
  }

  // ---- ghost preview --------------------------------------------------------
  function ensureGhost() {
    if (ghost) return;
    ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85 });
    ghost = new THREE.Mesh(GEO, ghostMat); ghost.visible = false; group.add(ghost);
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!on || !ghost) { if (ghost) ghost.visible = false; return; }
    const t = target();
    if (!t) { ghost.visible = false; return; }
    const cell = (erase && t.cell) ? t.cell : t.add;
    ghost.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    ghostMat.color.setHex(erase ? 0xff5544 : 0x66ff88);
    ghost.visible = true;
  }

  // ---- toolbar (HUD strip; also tappable on mobile) -------------------------
  let bar = null, swatches = null, hint = null, fileIn = null;
  function buildBar() {
    const css = document.createElement('style');
    css.textContent = `
      #bldBar{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:30;display:none;
        align-items:center;gap:8px;padding:8px 12px;border-radius:14px;background:rgba(14,18,12,.82);
        border:2px solid rgba(150,180,110,.55);color:#fff;font:bold 13px 'Trebuchet MS',system-ui,sans-serif;
        text-shadow:0 1px 2px #000;backdrop-filter:blur(2px);max-width:96vw;flex-wrap:wrap;justify-content:center;}
      #bldBar.on{display:flex;}
      #bldSw{display:flex;gap:5px;flex-wrap:wrap;}
      .bldS{width:26px;height:26px;border-radius:6px;border:2px solid rgba(255,255,255,.4);cursor:pointer;
        background-size:cover;background-position:center;image-rendering:pixelated;}
      .bldS.sel{border-color:#fff;box-shadow:0 0 0 2px #6f6,0 0 8px #6f6;}
      .bldBtn{padding:5px 10px;border-radius:9px;border:2px solid rgba(255,255,255,.4);cursor:pointer;
        background:rgba(30,38,24,.7);color:#fff;white-space:nowrap;}
      .bldBtn:active{background:rgba(120,160,90,.8);}
      .bldBtn.act{background:rgba(200,70,60,.85);border-color:#fff;}
      #bldHint{opacity:.85;font-weight:normal;}
    `;
    document.head.appendChild(css);

    bar = document.createElement('div'); bar.id = 'bldBar';
    const title = document.createElement('span'); title.textContent = '🧱';
    swatches = document.createElement('div'); swatches.id = 'bldSw';
    const load = document.createElement('div'); load.className = 'bldBtn'; load.textContent = '🖼️ Art (L)';
    const er = document.createElement('div'); er.className = 'bldBtn'; er.id = 'bldErase'; er.textContent = '🗑️ Erase (F)';
    const clr = document.createElement('div'); clr.className = 'bldBtn'; clr.textContent = '🧹 Clear (X)';
    const close = document.createElement('div'); close.className = 'bldBtn'; close.textContent = '✕ Done (V)';
    hint = document.createElement('span'); hint.id = 'bldHint'; hint.textContent = 'Z / L-click place · N / R-click delete';

    fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.style.display = 'none';
    fileIn.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => addTexFromURL(r.result); r.readAsDataURL(f); fileIn.value = '';
    });

    const tap = (el, fn) => { el.addEventListener('click', fn); el.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); }, { passive: false }); };
    tap(load, () => fileIn.click());
    tap(er, () => { erase = !erase; refreshBar(); });
    tap(clr, clearAll);
    tap(close, () => toggle());

    bar.appendChild(title); bar.appendChild(swatches);
    bar.appendChild(load); bar.appendChild(er); bar.appendChild(clr); bar.appendChild(close); bar.appendChild(hint);
    bar.appendChild(fileIn);
    document.body.appendChild(bar);
    refreshBar();
  }
  function refreshBar() {
    if (!swatches) return;
    swatches.innerHTML = '';
    palette.forEach((p, i) => {
      const s = document.createElement('div'); s.className = 'bldS' + (i === sel && !erase ? ' sel' : '');
      if (p.kind === 'tex' || p.kind === 'preset') s.style.backgroundImage = 'url(' + p.url + ')'; else s.style.background = p.hex;
      s.addEventListener('click', () => { sel = i; erase = false; refreshBar(); });
      s.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); sel = i; erase = false; refreshBar(); }, { passive: false });
      swatches.appendChild(s);
    });
    const er = document.getElementById('bldErase'); if (er) er.classList.toggle('act', erase);
  }

  // ---- mode toggle ----------------------------------------------------------
  function toggle() {
    on = !on; if (bar) bar.classList.toggle('on', on);
    if (W.hud) W.hud.toast(on ? '🧱 Build Mode ON — V to exit' : 'Build Mode off');
    if (!on && ghost) ghost.visible = false;
  }

  // ---- input (capture phase so build keys/clicks don't reach the game) -------
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) { e.stopImmediatePropagation(); toggle(); return; }
    if (!on) return;
    let used = true;
    if (e.code === 'KeyZ') { doPlace(); }            // Z = place a block
    else if (e.code === 'KeyN') { doDelete(); }      // N = delete the block you're aiming at
    else if (/^Digit[1-8]$/.test(e.code)) { const n = +e.code.slice(5) - 1; if (n < palette.length) { sel = n; erase = false; refreshBar(); } }
    else if (e.code === 'KeyF') { erase = !erase; refreshBar(); }
    else if (e.code === 'KeyL') { if (fileIn) fileIn.click(); }
    else if (e.code === 'KeyX') { clearAll(); }
    else if (e.code === 'BracketRight') { sel = (sel + 1) % palette.length; erase = false; refreshBar(); }
    else if (e.code === 'BracketLeft') { sel = (sel - 1 + palette.length) % palette.length; erase = false; refreshBar(); }
    else used = false;
    if (used) e.stopImmediatePropagation();
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!on || !W.player || !W.player.active) return;
    if (document.pointerLockElement == null) return;          // let UI clicks through when not in FPS view
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.button === 0) { erase ? doDelete() : doPlace(); }
    else if (e.button === 2) { doDelete(); }
  }, true);
  window.addEventListener('contextmenu', (e) => { if (on) e.preventDefault(); }, true);

  // mobile: a tap on the look area places/deletes; add a toggle pill
  function addMobile() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mBuild')) return;
    const b = document.createElement('div'); b.id = 'mBuild'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '🧱';
    const t = document.createElement('span'); t.textContent = 'Build';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); b.style.background = on ? 'rgba(120,160,90,.9)' : ''; }, { passive: false });
    acts.insertBefore(b, acts.firstChild);
    const look = document.getElementById('mLook');
    if (look) look.addEventListener('touchend', () => { if (on) (erase ? doDelete() : doPlace()); });
  }

  // ---- init -----------------------------------------------------------------
  function init() {
    if (ready) return;
    if (!W.player || !W.player.scene || !W.world || !W.world.heightAt) return;
    ready = true;
    W.world.platforms = W.world.platforms || [];
    group = new THREE.Group(); group.name = 'builder'; W.player.scene.add(group);
    ensureGhost();
    buildPalette();
    buildBar();
    load();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    window.addEventListener('beforeunload', () => { if (saveT) { clearTimeout(saveT); saveT = null; } save(); });
    W.builder = {
      toggle, isOn: () => on, count: () => blocks.size,
      place: (cx, cy, cz, i) => { const o = sel; if (i != null) sel = i; placeAt(cx, cy, cz, descOf(sel)); sel = o; save(); },
      remove: (cx, cy, cz) => { removeKey(ck(cx, cy, cz)); save(); },
      addArt: addTexFromURL,
      addPreset: addPreset,
      addModelPreset: addModelPreset,
    };
  }
  const waitInit = setInterval(() => { init(); if (ready) clearInterval(waitInit); }, 400);
})();
