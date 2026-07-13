/* Owner pack — a private, gated bundle of custom art + gadgets that only unlocks
   on the owner's own browser. Visit the game once with ?owner=lin8up in the URL
   and it's remembered (localStorage) on that device forever; everyone else gets
   nothing and never even downloads these assets.

   Unlocks:
     • all 11 custom images as real built 3D Build Mode (V) props
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
  // Every custom image is now a real built 3D model (see MODELS below) — the
  // wall/floor/room art wraps actual geometry instead of a flat cube.
  const SURFACES = [];

  // ---- real 3D models (procedural, flat-shaded — the game's low-poly style) ---
  const M = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, flatShading: true }, o || {}));

  // Cached, texture-mapped material from a custom PNG (repeats optional) — lets the
  // wall/floor/room art wrap real 3D geometry instead of sitting on a flat cube.
  const _texLoader = new THREE.TextureLoader();
  const _texMats = {};
  function texMat(file, rx, ry, o) {
    const key = file + ':' + (rx || 1) + 'x' + (ry || 1);
    if (_texMats[key]) return _texMats[key];
    const tex = _texLoader.load(BASE + file);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(rx || 1, ry || 1);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial(Object.assign({ map: tex, roughness: 0.9 }, o || {}));
    _texMats[key] = mat; return mat;
  }

  function makeBarrel() {
    const g = new THREE.Group();
    const wood = M(0x8a5524, { roughness: 0.9 }), dark = M(0x2f3238, { metalness: 0.5, roughness: 0.4 });
    const pts = [new THREE.Vector2(0.30, 0), new THREE.Vector2(0.40, 0.10), new THREE.Vector2(0.45, 0.45),
                 new THREE.Vector2(0.40, 0.80), new THREE.Vector2(0.30, 0.90)];
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), wood); body.castShadow = true; g.add(body);
    const lid = new THREE.CircleGeometry(0.30, 16);
    const top = new THREE.Mesh(lid, wood); top.rotation.x = -Math.PI / 2; top.position.y = 0.9; g.add(top);
    const bot = new THREE.Mesh(lid, wood); bot.rotation.x = Math.PI / 2; g.add(bot);
    [0.14, 0.45, 0.76].forEach((y, i) => {
      const r = i === 1 ? 0.46 : 0.42;
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 16, 1, true), dark); hoop.position.y = y; g.add(hoop);
    });
    return g;
  }
  function makePole() {
    const g = new THREE.Group();
    const iron = M(0x70757c, { metalness: 0.7, roughness: 0.35 }), dark = M(0x3a3d42, { metalness: 0.6, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 12), dark); base.position.y = 0.06; base.castShadow = true; g.add(base);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.4, 12), iron); shaft.position.y = 0.76; shaft.castShadow = true; g.add(shaft);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), iron); cap.position.y = 1.5; g.add(cap);
    return g;
  }
  function makeDoor() {
    const g = new THREE.Group();
    const frame = M(0x5b3b22, { roughness: 0.9 }), slabM = M(0x784a28, { roughness: 0.85 }), brass = M(0xc9a24a, { metalness: 0.6, roughness: 0.4 });
    const H = 2.0, Wd = 1.0, T = 0.14;
    const jamb = new THREE.BoxGeometry(0.12, H, 0.2);
    const L = new THREE.Mesh(jamb, frame); L.position.set(-Wd / 2 + 0.06, H / 2, 0); g.add(L);
    const R = new THREE.Mesh(jamb, frame); R.position.set(Wd / 2 - 0.06, H / 2, 0); g.add(R);
    const lint = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.14, 0.2), frame); lint.position.set(0, H - 0.07, 0); g.add(lint);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.16, H - 0.16, T), slabM); slab.position.set(0, (H - 0.16) / 2 + 0.02, 0); slab.castShadow = true; g.add(slab);
    [0.55, 1.25].forEach((y) => { const p = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.42, 0.5, T + 0.03), frame); p.position.set(0, y, 0); g.add(p); });
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), brass); h.position.set(Wd / 2 - 0.3, 1.0, T / 2 + 0.03); g.add(h);
    return g;
  }
  function makeBlaster() {
    const g = new THREE.Group();
    const body = M(0x33373d, { metalness: 0.6, roughness: 0.4 }), accent = M(0x1a1c20, { metalness: 0.5, roughness: 0.5 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x66eaff, emissive: 0x2bd4ff, emissiveIntensity: 1.4, roughness: 0.4, flatShading: true });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.5, 8), accent); stand.position.y = 0.25; g.add(stand);
    const gun = new THREE.Group(); gun.position.y = 0.55; gun.rotation.z = 0.12;
    gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.16), body));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 10), body); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.5, 0.02, 0); gun.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), accent); grip.position.set(-0.18, -0.2, 0); grip.rotation.z = 0.3; gun.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.1), accent); sight.position.set(0.05, 0.13, 0); gun.add(sight);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 10), glow); core.rotation.z = Math.PI / 2; core.position.set(0.16, 0.02, 0); gun.add(core);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), glow); muzzle.position.set(0.76, 0.02, 0); gun.add(muzzle);
    g.add(gun);
    return g;
  }
  function makeGrenadePineapple() {
    const g = new THREE.Group();
    const green = M(0x3f4a24, { roughness: 0.7, metalness: 0.2 }), dark = M(0x2a2d22), brass = M(0xc9a24a, { metalness: 0.6, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), green); body.scale.y = 1.25; body.position.y = 0.24; body.castShadow = true; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10), dark); cap.position.y = 0.46; g.add(cap);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.06), brass); lever.position.set(0.1, 0.4, 0); g.add(lever);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12), brass); ring.position.set(0.14, 0.5, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
    return g;
  }
  function makeGrenadeFuturistic() {
    const g = new THREE.Group();
    const metal = M(0x3a3f46, { metalness: 0.6, roughness: 0.4 }), dark = M(0x202329);
    const glow = new THREE.MeshStandardMaterial({ color: 0x8bff6a, emissive: 0x35cc22, emissiveIntensity: 1.2, roughness: 0.5, flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), metal); body.scale.y = 1.2; body.position.y = 0.24; body.castShadow = true; g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 16, 1, true), glow); band.position.y = 0.24; g.add(band);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 12), dark); cap.position.y = 0.46; g.add(cap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12), metal); ring.position.set(0.13, 0.5, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), glow); dot.position.set(0, 0.24, 0.2); g.add(dot);
    return g;
  }
  // A detailed low-poly M16 rifle (lies along +X, barrel forward).
  function makeM16() {
    const g = new THREE.Group();
    const black = M(0x24272b, { metalness: 0.4, roughness: 0.5 });
    const dark = M(0x141619, { metalness: 0.3, roughness: 0.6 });
    const metal = M(0x3a3e44, { metalness: 0.6, roughness: 0.4 });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.085), black); upper.position.set(-0.05, 0.02, 0); g.add(upper);   // upper receiver
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.08), dark); lower.position.set(-0.18, -0.055, 0); g.add(lower);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 8), metal); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.5, 0.03, 0); g.add(barrel);
    const flash = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.06, 8), dark); flash.rotation.z = Math.PI / 2; flash.position.set(0.83, 0.03, 0); g.add(flash);
    const hg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 10), dark); hg.rotation.z = Math.PI / 2; hg.position.set(0.32, 0.02, 0); g.add(hg);      // handguard
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.05), black); handle.position.set(-0.02, 0.1, 0); g.add(handle);                            // carry handle
    for (const hx of [-0.09, 0.05]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), black); p.position.set(hx, 0.065, 0); g.add(p); }
    const fsight = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), dark); fsight.position.set(0.5, 0.11, 0); g.add(fsight);                                    // front sight tower
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.06), dark); grip.position.set(-0.2, -0.15, 0); grip.rotation.z = 0.38; g.add(grip);            // pistol grip
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.21, 0.07), black); mag.position.set(-0.1, -0.19, 0); mag.rotation.z = 0.14; g.add(mag);               // magazine
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.07), dark); stock.position.set(-0.43, -0.03, 0); g.add(stock);                                 // buttstock
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.07), dark); butt.position.set(-0.57, -0.03, 0); g.add(butt);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // The case: clear glass display box (the model's white → glass) with an M16 inside.
  function makeGlassCase() {
    const g = new THREE.Group();
    const frameM = M(0x2a2d33, { metalness: 0.7, roughness: 0.35 });
    const gold = M(0xc9a24a, { metalness: 0.7, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.0, side: THREE.DoubleSide });
    const Wd = 1.6, Dp = 0.55, Ht = 0.7, baseH = 0.16, gy = baseH;
    const base = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.1, baseH, Dp + 0.1), frameM); base.position.y = baseH / 2; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.16, 0.03, Dp + 0.16), gold); trim.position.y = baseH; g.add(trim);
    const box = new THREE.Mesh(new THREE.BoxGeometry(Wd, Ht, Dp), glass); box.position.y = gy + Ht / 2; g.add(box);
    // gold frame along the 12 edges of the glass box
    const ex = Wd / 2, ez = Dp / 2, ey0 = gy, ey1 = gy + Ht, up = new THREE.Vector3(0, 1, 0);
    const edge = (x1, y1, z1, x2, y2, z2) => {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), gold);
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      m.quaternion.setFromUnitVectors(up, new THREE.Vector3(dx, dy, dz).normalize()); g.add(m);
    };
    for (const sx of [-ex, ex]) for (const sz of [-ez, ez]) edge(sx, ey0, sz, sx, ey1, sz);
    for (const y of [ey0, ey1]) { edge(-ex, y, -ez, ex, y, -ez); edge(-ex, y, ez, ex, y, ez); edge(-ex, y, -ez, -ex, y, ez); edge(ex, y, -ez, ex, y, ez); }
    // the M16 mounted inside, on a couple of clear risers
    const gun = makeM16(); gun.position.set(0, gy + Ht * 0.5, 0); gun.rotation.y = 0.25; g.add(gun);
    for (const rx of [-0.35, 0.35]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.03), glass); r.position.set(rx, gy + Ht * 0.28, 0); g.add(r); }
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.02), gold); plaque.position.set(0, baseH + 0.035, Dp / 2 + 0.06); g.add(plaque);
    return g;
  }

  // A wooden bar counter with a foot rail, stools, and a lit back shelf of bottles.
  function makeBar() {
    const g = new THREE.Group();
    const wood = M(0x4a3220, { roughness: 0.7 }), panelM = M(0x3a281a, { roughness: 0.8 });
    const top = M(0x2a2420, { roughness: 0.3, metalness: 0.3 }), brass = M(0xc9a24a, { metalness: 0.7, roughness: 0.35 });
    const leather = M(0x5a4636, { roughness: 0.8 });
    const Wd = 1.9, Ht = 1.05, Dp = 0.55;
    const body = new THREE.Mesh(new THREE.BoxGeometry(Wd, Ht, Dp), wood); body.position.set(0, Ht / 2, 0); body.castShadow = true; g.add(body);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.2, Ht - 0.3, 0.04), panelM); panel.position.set(0, Ht / 2, Dp / 2 + 0.02); g.add(panel);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.2, 0.08, Dp + 0.24), top); counter.position.set(0, Ht + 0.04, 0.06); counter.castShadow = true; g.add(counter);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, Wd - 0.2, 8), brass); rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.12, Dp / 2 + 0.18); g.add(rail);
    for (const rx of [-Wd / 2 + 0.2, Wd / 2 - 0.2]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), brass); post.position.set(rx, 0.06, Dp / 2 + 0.18); g.add(post); }
    for (const sx of [-0.55, 0.55]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), leather); seat.position.set(sx, 0.62, Dp / 2 + 0.5); seat.castShadow = true; g.add(seat);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), brass); pole.position.set(sx, 0.3, Dp / 2 + 0.5); g.add(pole);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), brass); foot.position.set(sx, 0.02, Dp / 2 + 0.5); g.add(foot);
    }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.2, 0.05, 0.18), wood); shelf.position.set(0, Ht + 0.5, -Dp / 2 - 0.05); g.add(shelf);
    const bottleCols = [0x3a7a3a, 0x8a2b2b, 0x2a5a8a, 0xc9a24a, 0x6a3b6a];
    for (let i = 0; i < 7; i++) {
      const bx = -Wd / 2 + 0.25 + i * (Wd - 0.5) / 6;
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8), new THREE.MeshStandardMaterial({ color: bottleCols[i % bottleCols.length], roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }));
      bottle.position.set(bx, Ht + 0.63, -Dp / 2 - 0.05); g.add(bottle);
    }
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffaa33, emissiveIntensity: 1.2 })); glow.position.set(0.6, Ht + 0.13, 0.06); g.add(glow);
    return g;
  }

  // A modern elevator car: steel walls, marble back, bronze doors, lit ceiling + call panel.
  function makeElevator() {
    const g = new THREE.Group();
    const steel = M(0x4a4e56, { metalness: 0.7, roughness: 0.35 }), dark = M(0x26292e, { metalness: 0.6, roughness: 0.4 });
    const bronze = M(0xb98a4a, { metalness: 0.7, roughness: 0.35 }), marble = M(0xcabfa8, { roughness: 0.3, metalness: 0.1 });
    const Wd = 1.7, Ht = 2.3, Dp = 1.5, T = 0.08;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd, T, Dp), dark); floor.position.set(0, T / 2, 0); floor.receiveShadow = true; g.add(floor);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(Wd, T, Dp), steel); ceil.position.set(0, Ht - T / 2, 0); g.add(ceil);
    const back = new THREE.Mesh(new THREE.BoxGeometry(Wd, Ht, T), marble); back.position.set(0, Ht / 2, -Dp / 2); back.castShadow = true; g.add(back);
    for (const sx of [-Wd / 2, Wd / 2]) { const w = new THREE.Mesh(new THREE.BoxGeometry(T, Ht, Dp), steel); w.position.set(sx, Ht / 2, 0); w.castShadow = true; g.add(w); }
    for (const sd of [-1, 1]) { const door = new THREE.Mesh(new THREE.BoxGeometry(Wd / 2 - 0.05, Ht - 0.12, T), bronze); door.position.set(sd * (Wd / 4), Ht / 2, Dp / 2); g.add(door); }
    for (const sx of [-Wd / 2, Wd / 2]) { const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.06, Ht, 0.12), bronze); jamb.position.set(sx, Ht / 2, Dp / 2); g.add(jamb); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.1, 0.12), bronze); lintel.position.set(0, Ht - 0.05, Dp / 2); g.add(lintel);
    const light = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.5, 0.04, Dp - 0.5), new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe6a8, emissiveIntensity: 0.9 })); light.position.set(0, Ht - 0.11, 0); g.add(light);
    const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Wd - 0.2, 8), bronze); hr.rotation.z = Math.PI / 2; hr.position.set(0, 1.0, -Dp / 2 + 0.1); g.add(hr);
    const cp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.28), dark); cp.position.set(Wd / 2 - 0.05, 1.1, 0.3); g.add(cp);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xffcf6a, emissive: 0xffaa22, emissiveIntensity: 0.8 })); b.rotation.z = Math.PI / 2; b.position.set(Wd / 2 - 0.09, 1.25 - i * 0.09, 0.3); g.add(b); }
    return g;
  }

  // A real brick wall: a textured slab with a few courses of protruding bricks so it
  // reads as 3D masonry rather than a flat photo.
  function makeBrickWall() {
    const g = new THREE.Group();
    const Wd = 2.0, Ht = 2.4, Dp = 0.28;
    const face = texMat('brick.png', 2, 2);
    const side = M(0x7a4632, { roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(Wd, Ht, Dp), [side, side, side, side, face, face]);
    wall.position.y = Ht / 2; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
    // raised individual bricks for relief, brick-coloured to match the art
    const brickM = M(0x9a4d34, { roughness: 0.95 });
    const bw = 0.34, bh = 0.14, gap = 0.04;
    for (let row = 0; row < 5; row++) {
      const y = 0.28 + row * (bh + 0.12);
      const off = (row % 2) ? (bw + gap) / 2 : 0;
      for (let x = -Wd / 2 + 0.2 + off; x < Wd / 2 - 0.2; x += bw + gap) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), brickM);
        b.position.set(x, y, Dp / 2 + 0.03); b.castShadow = true; g.add(b);
      }
    }
    return g;
  }

  // A 3D hotel room built from the floor art: a textured floor slab with real walls +
  // ceiling rising around it (hotel-room art on the walls), open front so you can walk in.
  function makeJapFloor() {
    const g = new THREE.Group();
    const S = 3.2, H = 0.18, Ht = 2.6, T = 0.14;
    const wood = M(0x6b4a2a, { roughness: 0.85 });
    const trim = M(0x4a3320, { roughness: 0.85 });
    const floorTex = texMat('jap-floor.png', 1, 1);
    const wallTex = texMat('room.png', 2, 1);
    // textured floor
    const slab = new THREE.Mesh(new THREE.BoxGeometry(S, H, S), [wood, wood, floorTex, wood, wood, wood]);
    slab.position.y = H / 2; slab.receiveShadow = true; g.add(slab);
    // back + two side walls (hotel-room art)
    const back = new THREE.Mesh(new THREE.BoxGeometry(S, Ht, T), wallTex);
    back.position.set(0, H + Ht / 2, -S / 2 + T / 2); back.castShadow = true; g.add(back);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(T, Ht, S), wallTex);
      w.position.set(sx * (S / 2 - T / 2), H + Ht / 2, 0); w.castShadow = true; g.add(w);
    }
    // front wall with a doorway gap (two side posts + a header)
    for (const sx of [-1, 1]) {
      const fw = new THREE.Mesh(new THREE.BoxGeometry(S / 2 - 0.55, Ht, T), wallTex);
      fw.position.set(sx * (S / 4 + 0.275), H + Ht / 2, S / 2 - T / 2); fw.castShadow = true; g.add(fw);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, T), wallTex);
    header.position.set(0, H + Ht - 0.25, S / 2 - T / 2); g.add(header);
    // ceiling + baseboard trim so it reads as an enclosed room
    const roof = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), trim);
    roof.position.y = H + Ht - T / 2; roof.castShadow = true; g.add(roof);
    for (const [dx, dz, w, d] of [[0, S / 2 - 0.05, S, 0.1], [0, -S / 2 + 0.05, S, 0.1], [S / 2 - 0.05, 0, 0.1, S], [-S / 2 + 0.05, 0, 0.1, S]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), trim);
      b.position.set(dx, H + 0.1, dz); g.add(b);
    }
    return g;
  }

  // A small room shell: floor + three textured walls (open front) you can stand inside.
  function makeRoom() {
    const g = new THREE.Group();
    const S = 3.0, Ht = 2.6, T = 0.16;
    const wallM = texMat('room.png', 2, 1);
    const floorM = M(0x5a4636, { roughness: 0.9 }), roofM = M(0x3a3d42, { roughness: 0.8 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), floorM); floor.position.y = T / 2; floor.receiveShadow = true; g.add(floor);
    const back = new THREE.Mesh(new THREE.BoxGeometry(S, Ht, T), wallM); back.position.set(0, Ht / 2, -S / 2 + T / 2); back.castShadow = true; g.add(back);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(T, Ht, S), wallM); w.position.set(sx * (S / 2 - T / 2), Ht / 2, 0); w.castShadow = true; g.add(w);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), roofM); roof.position.y = Ht - T / 2; roof.castShadow = true; g.add(roof);
    return g;
  }

  // [id, file, factory, height] — objects placed as real 3D models
  const MODELS = [
    ['brick', 'brick.png', makeBrickWall, 2.4], ['jap-floor', 'jap-floor.png', makeJapFloor, 0.2], ['room', 'room.png', makeRoom, 2.6],
    ['barrel', 'barrel.png', makeBarrel, 0.9], ['iron-pole', 'iron-pole.png', makePole, 1.55],
    ['cool-door', 'cool-door.png', makeDoor, 2.0], ['blaster', 'blaster.png', makeBlaster, 0.9],
    ['grenade-2', 'grenade-2.png', makeGrenadePineapple, 0.55], ['grenade-1', 'grenade-1.png', makeGrenadeFuturistic, 0.55],
    ['glass-case', 'case.png', makeGlassCase, 0.9],
    ['bar', 'bar.png', makeBar, 1.15], ['elevator', 'elevator.png', makeElevator, 2.3],
  ];

  const now = () => performance.now() / 1000;
  let scene = null, cam = null;
  const bolts = [], nades = [], fx = [];

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
  function throwGrenade() {
    const p = W.player; if (!p || !p.active || !p.alive || p.downed) return;
    if (now() - lastNade < NADE_CD) return; lastNade = now();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const pos = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.9);
    const m = makeGrenadePineapple();                              // the real 3D grenade model
    m.position.copy(pos); scene.add(m);
    const vel = dir.multiplyScalar(15); vel.y += 6.5;              // lob it forward + up (~12-14m throw)
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
    // load the custom pack into Build Mode: walls/floors as textured panels, objects as real 3D models
    const loadPack = () => {
      if (!(W.builder && W.builder.addModelPreset)) return;
      SURFACES.forEach(([id, f]) => W.builder.addPreset(id, BASE + f, 'box'));
      MODELS.forEach(([id, f, make, h]) => W.builder.addModelPreset(id, BASE + f, make, h));
    };
    if (W.builder && W.builder.addModelPreset) loadPack(); else setTimeout(loadPack, 1200);
    buildHud();
    requestAnimationFrame(loop);
    setTimeout(addMobile, 900); setTimeout(addMobile, 2600);
    if (W.hud && W.hud.toast) W.hud.toast('👑 Owner pack unlocked — P blaster · Y grenade · custom blocks in Build (V)');
    W.owner = {
      fireBlaster, throwGrenade, count: () => ({ bolts: bolts.length, nades: nades.length, fx: fx.length }),
      _step: (dt) => { stepBolts(dt); stepNades(dt); stepFx(dt); },   // test hook (preview rAF is suspended)
      makeGlassCase, makeM16, makeBar, makeElevator,                  // build-preview hooks
    };
  }, 400);
})();
