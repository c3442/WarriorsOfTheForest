/* Start lobby — a walk-around Roblox-style forest clearing you drop into before
   playing. First-person: WASD to move, arrows/mouse to look. Five numbered JOIN
   squares sit in the middle — run onto one to open your customise panel, press B
   to leave. The party maker sets a countdown (2:00 max) that starts the game when
   it ends; or walk into the glowing portal (Enter) to start now.
   Renders live before the game boots, then tears itself down on start.
   Self-contained: reuses the exposed main scene/camera, touches no game files. */
(function () {
  const W = window.WOTF;
  if (!W) return;

  let scene = null, cam = null, canvas = null, group = null, hemi = null, sun = null, portal = null;
  let started = false, starting = false, raf = 0, tphase = 0, menuOpen = false, hint = null;
  let pads = [], curPad = -1, leftPad = -1;                  // 5 join squares in the middle
  let partyBar = null, partyLen = 60, partyRunning = false, partyEnd = 0;   // maker-set countdown (max 2:00)
  let partySize = 4;                                          // how many players allowed (1-5) -> active squares
  const HUD_IDS = ['minimap', 'stats', 'res', 'hotbar', 'info', 'tpVillage', 'cross', 'ownBar'];
  const hudPrev = {};
  const keys = {};
  let lobbyPlats = [];                            // walkable decks + ramps (tree houses)
  const EYE = 1.7;
  let yaw = 0, pitch = -0.08;
  const pos = { x: 0, y: EYE, z: 17 };            // spawn: standing back from the portal
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const HINT_HTML = '🎮 <b>WASD</b> move · <b>Arrows</b> or <b>click+Mouse</b> to look · run onto a numbered <b style="color:#8fe6ff">square</b> to join · press <b style="color:#8fe6ff">Enter</b> to PLAY';

  function makeTree(x, z, s) {
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const leaf = new THREE.MeshStandardMaterial({ color: [0x2f6b2a, 0x357a30, 0x3f8a38, 0x2b5f28][(Math.random() * 4) | 0], roughness: 1, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.18 * s, 1.3 * s, 6), bark);
    trunk.position.y = 0.65 * s; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry((0.95 - i * 0.2) * s, 0.95 * s, 7), leaf);
      c.position.y = (1.25 + i * 0.6) * s; g.add(c);
    }
    g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.28);
    return g;
  }

  function makePortal() {
    const g = new THREE.Group();
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x2bd4ff, emissive: 0x2bd4ff, emissiveIntensity: 1.5, roughness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.6, roughness: 0.35 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.16, 12, 30), glowMat); ring.position.y = 2.0; g.add(ring);
    const core = new THREE.Mesh(new THREE.CircleGeometry(1.42, 30), new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); core.position.y = 2.0; g.add(core);
    for (const sx of [-1.5, 1.5]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.0, 8), gold); p.position.set(sx, 1.0, 0); g.add(p); }
    // floating "PLAY" label
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 80;
    const cx2 = cv.getContext('2d'); cx2.font = "bold 52px 'Trebuchet MS',sans-serif"; cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
    cx2.lineWidth = 8; cx2.strokeStyle = 'rgba(6,20,26,.9)'; cx2.strokeText('▶ PLAY', 128, 42);
    cx2.fillStyle = '#bff6ff'; cx2.fillText('▶ PLAY', 128, 42);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    spr.scale.set(2.6, 0.8, 1); spr.position.y = 3.4; g.add(spr);
    return g;
  }

  // a wooden signboard sprite (always faces the camera)
  function makeSign(text) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 76;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(58,38,20,.94)'; ctx.fillRect(6, 10, 244, 56);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 5; ctx.strokeRect(6, 10, 244, 56);
    ctx.font = "bold 34px 'Trebuchet MS',sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,12,4,.9)'; ctx.strokeText(text, 128, 40);
    ctx.fillStyle = '#ffe6a8'; ctx.fillText(text, 128, 40);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    spr.scale.set(3.6, 1.07, 1);
    return spr;
  }

  // tree-house dimensions (shared with the walkable-platform math in build())
  const TH_H = 4.5, TH_DW = 5, TH_RUN = 6.5, TH_RX = 1.6, TH_RW = 1.7;   // deck top, deck size, ramp run, ramp centre-x, ramp width

  // a cosy climbable tree house (trunk + railed deck + cabin + canopy + planked ramp), optional sign
  function makeTreehouse(label) {
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, flatShading: true });
    const barkDk = new THREE.MeshStandardMaterial({ color: 0x442d18, roughness: 1, flatShading: true });
    const plank = new THREE.MeshStandardMaterial({ color: 0x9c6631, roughness: 0.9, flatShading: true });
    const plankDk = new THREE.MeshStandardMaterial({ color: 0x6f4622, roughness: 1, flatShading: true });
    const wallM = new THREE.MeshStandardMaterial({ color: 0xc79457, roughness: 0.95, flatShading: true });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1, flatShading: true });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x8a3d2c, roughness: 0.9, flatShading: true });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6f5, emissive: 0x3a6b80, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.1 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xffe6a0, emissive: 0xffcf5a, emissiveIntensity: 1.3, roughness: 0.5 });
    const gableM = new THREE.MeshStandardMaterial({ color: 0xc79457, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 1 });
    const flowerMats = [0xff6b9d, 0xffd54a, 0xff5a5a, 0xf5f5f5].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.7, flatShading: true }));
    const bulbMats = [0xffd36b, 0xff8f6b, 0x8fe6ff, 0xff6b9d].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.1, roughness: 0.5 }));
    const leafCols = [0x2f7a34, 0x3a8a3a, 0x276b2b, 0x429640];
    const leaf = (i) => new THREE.MeshStandardMaterial({ color: leafCols[i % leafCols.length], roughness: 1, flatShading: true });
    const H = TH_H, DW = TH_DW, e = DW / 2;

    // tapered trunk with flared roots + big layered canopy
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.2, H + 7, 9), bark); trunk.position.y = (H + 7) / 2; trunk.castShadow = true; g.add(trunk);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.34, 1.5, 6), barkDk); rt.position.set(Math.cos(a) * 0.95, 0.2, Math.sin(a) * 0.95); rt.rotation.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5); g.add(rt); }
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(4.9 - i * 0.72, 2.9, 9), leaf(i)); c.position.y = H + 5.6 + i * 1.5; c.castShadow = true; g.add(c); }
    // side tufts + hanging vines for a fuller, lusher canopy
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.6; const tuft = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 8), leaf(i + 1)); tuft.position.set(Math.cos(a) * 2.7, H + 6.4 + (i % 2) * 0.8, Math.sin(a) * 2.7); tuft.castShadow = true; g.add(tuft); }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3, vlen = 1.1 + (i % 3) * 0.5; const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, vlen, 4), leaf(2)); vine.position.set(Math.cos(a) * 3.7, H + 5.4 - vlen / 2, Math.sin(a) * 3.7); g.add(vine); const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 5), leaf(0)); tip.position.set(Math.cos(a) * 3.7, H + 5.4 - vlen, Math.sin(a) * 3.7); g.add(tip); }

    // deck with plank seams + support posts + diagonal braces
    const deck = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.3, DW), plank); deck.position.y = H - 0.15; deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    for (let k = -2; k <= 2; k++) { const ln = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.08, 0.03, 0.06), plankDk); ln.position.set(0, H + 0.01, k * 1.0); g.add(ln); }
    for (const sx of [-e + 0.35, e - 0.35]) for (const sz of [-e + 0.35, e - 0.35]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, H, 7), plankDk); p.position.set(sx, H / 2, sz); p.castShadow = true; g.add(p); }
    for (const sx of [-e + 0.35, e - 0.35]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, DW - 0.6), plankDk); br.position.set(sx, H * 0.5, 0); br.rotation.x = 0.5; g.add(br); }

    // cabin: warm plank walls, framed + ajar plank door, glowing windows w/ flower boxes,
    // a gabled shingle roof with eaves + ridge, a smoking chimney and a porch lantern
    const cw = 3.8, cd = 3.2, ch = 2.5, czc = -0.6, hw = cw / 2, hd = cd / 2, doorHalf = 0.72, TT = 0.16, wy = H + ch;
    const wmesh = (sx, sz, w, hh, d, yb) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), wallM); m.position.set(sx, yb === undefined ? H + hh / 2 : yb, sz); m.castShadow = true; g.add(m); };
    wmesh(0, czc - hd, cw, ch, TT);                       // back
    wmesh(-hw, czc, TT, ch, cd); wmesh(hw, czc, TT, ch, cd);   // sides
    const seg = hw - doorHalf;
    wmesh(-(doorHalf + hw) / 2, czc + hd, seg, ch, TT); wmesh((doorHalf + hw) / 2, czc + hd, seg, ch, TT);  // front flanks
    wmesh(0, czc + hd, doorHalf * 2, ch - 1.9, TT, H + 1.9 + (ch - 1.9) / 2);   // lintel over the door
    // door frame + a slightly-ajar plank slab, hinged on the left jamb
    for (const sx of [-doorHalf, doorHalf]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, TT + 0.06), frameM); j.position.set(sx, H + 0.95, czc + hd); g.add(j); }
    { const top = new THREE.Mesh(new THREE.BoxGeometry(doorHalf * 2 + 0.16, 0.12, TT + 0.06), frameM); top.position.set(0, H + 1.9, czc + hd); g.add(top); }
    { const dg = new THREE.Group(); dg.position.set(-doorHalf + 0.04, H + 0.06, czc + hd); const dwd = doorHalf * 2 - 0.1;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(dwd, 1.8, 0.07), plankDk); slab.position.set(dwd / 2, 0.9, 0); slab.castShadow = true; dg.add(slab);
      for (const sy of [0.5, 0.9, 1.3]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(dwd - 0.06, 0.045, 0.09), frameM); pl.position.set(dwd / 2, sy, 0); dg.add(pl); }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glow); knob.position.set(dwd - 0.14, 0.9, 0.06); dg.add(knob);
      dg.rotation.y = -0.66; g.add(dg); }
    // side windows with muntins + a flower box under each
    for (const sx of [-hw, hw]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(TT + 0.05, 0.78, 0.78), glass); win.position.set(sx, H + 1.4, czc); g.add(win);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(TT + 0.02, 0.1, 0.9), frameM); fr.position.set(sx, H + 1.4, czc); g.add(fr);
      const fr2 = new THREE.Mesh(new THREE.BoxGeometry(TT + 0.02, 0.9, 0.1), frameM); fr2.position.set(sx, H + 1.4, czc); g.add(fr2);
      const off = Math.sign(sx) * 0.13;
      const boxm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.92), plankDk); boxm.position.set(sx + off, H + 0.92, czc); g.add(boxm);
      for (let f = 0; f < 4; f++) { const zz = czc - 0.34 + f * 0.225; const fl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), flowerMats[f]); fl.position.set(sx + off, H + 1.06, zz); g.add(fl); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4), stemMat); st.position.set(sx + off, H + 0.99, zz); g.add(st); }
    }
    // gabled shingle roof (ridge along X) with eave overhang, ridge beam, and gable ends
    const roofRise = 1.4, oh = 0.5, spanZ = hd + oh, slope = Math.hypot(spanZ, roofRise), rtilt = Math.atan2(roofRise, spanZ);
    for (const dir of [1, -1]) { const plane = new THREE.Mesh(new THREE.BoxGeometry(cw + 2 * oh, 0.14, slope), roofM); plane.position.set(0, wy + roofRise / 2, czc + dir * spanZ / 2); plane.rotation.x = dir * rtilt; plane.castShadow = true; g.add(plane); }
    { const ridge = new THREE.Mesh(new THREE.BoxGeometry(cw + 2 * oh + 0.12, 0.17, 0.17), frameM); ridge.position.set(0, wy + roofRise + 0.03, czc); g.add(ridge); }
    for (const sx of [-hw, hw]) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([sx, wy, czc - hd, sx, wy, czc + hd, sx, wy + roofRise, czc]), 3)); geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, gableM)); }
    // smoking chimney + warm porch lantern
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), barkDk); chim.position.set(hw - 0.5, wy + 0.85, czc - hd + 0.5); chim.castShadow = true; g.add(chim);
    for (let s = 0; s < 3; s++) { const pf = new THREE.Mesh(new THREE.SphereGeometry(0.16 + s * 0.06, 6, 6), new THREE.MeshStandardMaterial({ color: 0xc2c7cb, transparent: true, opacity: 0.5 - s * 0.13, roughness: 1 })); pf.position.set(hw - 0.5, wy + 1.5 + s * 0.42, czc - hd + 0.5); g.add(pf); }
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), glow); lantern.position.set(doorHalf + 0.42, H + 1.55, czc + hd + 0.14); g.add(lantern);

    // railings: corner + edge posts with a continuous top + mid rail, gapped where the ramp lands (+Z front)
    for (const [x, z] of [[-e, -e], [0, -e], [e, -e], [e, 0], [e, e], [0, e], [-e, e], [-e, 0]]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.98, 0.09), plankDk); post.position.set(x, H + 0.49, z); g.add(post); }
    const rail = (x1, z1, x2, z2, y) => { const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz); const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), plank); r.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); r.rotation.y = Math.atan2(dx, dz); g.add(r); };
    const gapL = TH_RX - TH_RW / 2 - 0.15, gapR = TH_RX + TH_RW / 2 + 0.15;   // ramp opening on the front edge
    for (const y of [H + 0.92, H + 0.5]) { rail(-e, -e, e, -e, y); rail(-e, -e, -e, e, y); rail(e, -e, e, e, y); rail(-e, e, gapL, e, y); rail(gapR, e, e, e, y); }

    // planked ramp up the front to the deck, with cross-cleats for grip
    const RUN = TH_RUN, rampLen = Math.hypot(RUN, H), tilt = Math.atan2(H, RUN);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(TH_RW, 0.16, rampLen), plank); ramp.position.set(TH_RX, H / 2, e + RUN / 2); ramp.rotation.x = tilt; ramp.castShadow = true; ramp.receiveShadow = true; g.add(ramp);
    for (const rl of [-TH_RW / 2 + 0.05, TH_RW / 2 - 0.05]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, rampLen), plankDk); side.position.set(TH_RX + rl, H / 2 + 0.03, e + RUN / 2); side.rotation.x = tilt; g.add(side); }
    for (let t = 0.12; t < 0.9; t += 0.12) { const cl = new THREE.Mesh(new THREE.BoxGeometry(TH_RW - 0.16, 0.05, 0.1), plankDk); cl.position.set(TH_RX, H * t + 0.09, e + RUN * (1 - t)); cl.rotation.x = tilt; g.add(cl); }

    // warm string lights sagging along the two side rails
    for (const sx of [-e, e]) for (let i = 0; i <= 6; i++) { const t = i / 6; const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), bulbMats[i % bulbMats.length]); b.position.set(sx, H + 0.9 - Math.sin(t * Math.PI) * 0.14, -e + t * DW); g.add(b); }

    if (label) { const s = makeSign(label); s.position.set(0, H + 1.4, DW / 2 + 0.3); g.add(s); }   // on the front of the deck, clear of the canopy
    return g;
  }

  // register a tree house's deck + ramp as walkable platforms (world-space, rotated by ry)
  function registerTreehousePlats(tx, tz, ry) {
    const cs = Math.cos(ry), sn = Math.sin(ry), e = TH_DW / 2;
    lobbyPlats.push({ cx: tx, cz: tz, cos: cs, sin: sn, x0: -e, x1: e, z0: -e, z1: e, y: TH_H });                       // deck
    lobbyPlats.push({ cx: tx, cz: tz, cos: cs, sin: sn, x0: TH_RX - TH_RW / 2, x1: TH_RX + TH_RW / 2, z0: e, z1: e + TH_RUN, yLow: TH_H, yHigh: 0, ramp: true });   // ramp
  }

  // highest walkable surface (deck/ramp) under (x,z) reachable from feetY; ground (0) otherwise
  function lobbyStand(x, z, feetY) {
    let best = 0; const STEP = 0.7;
    for (const pl of lobbyPlats) {
      const dx = x - pl.cx, dz = z - pl.cz;
      const lx = pl.cos * dx - pl.sin * dz, lz = pl.sin * dx + pl.cos * dz;
      if (lx < pl.x0 || lx > pl.x1 || lz < pl.z0 || lz > pl.z1) continue;
      const surf = pl.ramp ? pl.yLow + (pl.yHigh - pl.yLow) * clamp((lz - pl.z0) / (pl.z1 - pl.z0), 0, 1) : pl.y;
      if (surf <= feetY + STEP && surf > best) best = surf;
    }
    return best;
  }

  // a glowing numbered JOIN square you run onto to customise your look
  function makePad(n) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x22301a, roughness: 0.85, flatShading: true }));
    base.position.y = 0.06; g.add(base);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.06, 1.62),
      new THREE.MeshStandardMaterial({ color: 0x2bd4ff, emissive: 0x2bd4ff, emissiveIntensity: 0.7, roughness: 0.4, transparent: true, opacity: 0.9 }));
    glow.position.y = 0.13; g.add(glow);
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.6, roughness: 0.35 });
    for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.85]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 6), gold); p.position.set(sx, 0.25, sz); g.add(p); }
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d'); c.font = "bold 92px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = 'rgba(6,20,26,.9)'; c.strokeText(String(n), 64, 70);
    c.fillStyle = '#eaffff'; c.fillText(String(n), 64, 70);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    spr.scale.set(1.1, 1.1, 1); spr.position.y = 1.5; g.add(spr);
    g.userData.glow = glow;
    return g;
  }

  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // the party maker's control: choose how long the lobby lasts (2:00 max), then START a countdown
  function makePartyBar() {
    partyBar = document.createElement('div');
    partyBar.id = 'lobbyParty';
    partyBar.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:12;display:flex;gap:6px;align-items:center;' +
      'background:rgba(12,16,10,.72);border:2px solid rgba(150,180,110,.5);border-radius:12px;padding:7px 12px;' +
      "font:bold 13px 'Trebuchet MS',sans-serif;color:#eaf4dd;text-shadow:0 1px 2px #000;backdrop-filter:blur(2px);";
    const bstyle = 'background:#2a3320;border:1px solid #46562f;border-radius:6px;color:#dfeec8;font:bold 12px sans-serif;padding:3px 8px;cursor:pointer;';
    // how many players are allowed in the party (1-5) -> lights up that many squares
    const plbl = document.createElement('span'); plbl.textContent = '👥 Players:'; partyBar.appendChild(plbl);
    [1, 2, 3, 4, 5].forEach((n) => {
      const b = document.createElement('button'); b.textContent = n; b.dataset.size = n; b.style.cssText = bstyle;
      b.onclick = () => { if (partyRunning) return; partySize = n; applyPadStates(); updateParty(); };
      partyBar.appendChild(b);
    });
    const sep = document.createElement('span'); sep.textContent = '·'; sep.style.opacity = '.5'; partyBar.appendChild(sep);
    const lbl = document.createElement('span'); lbl.textContent = '⏱ Length:'; partyBar.appendChild(lbl);
    [['0:30', 30], ['1:00', 60], ['1:30', 90], ['2:00', 120]].forEach(([l, s]) => {
      const b = document.createElement('button'); b.textContent = l; b.dataset.sec = s; b.style.cssText = bstyle;
      b.onclick = () => { if (partyRunning) return; partyLen = s; updateParty(); };
      partyBar.appendChild(b);
    });
    const start = document.createElement('button'); start.id = 'partyStart'; start.textContent = '▶ START';
    start.style.cssText = bstyle + 'background:#3c7a2c;border-color:#8fd36a;color:#fff;';
    start.onclick = () => startParty();
    partyBar.appendChild(start);
    const cd = document.createElement('span'); cd.id = 'partyCd'; cd.style.cssText = 'margin-left:6px;color:#8fe6ff;font-size:15px;min-width:44px;text-align:center;'; partyBar.appendChild(cd);
    document.body.appendChild(partyBar);
    applyPadStates(); updateParty();
  }
  function updateParty() {
    if (!partyBar) return;
    partyBar.querySelectorAll('button[data-sec]').forEach((b) => {
      const on = +b.dataset.sec === partyLen;
      b.style.background = on ? '#6a8a3a' : '#2a3320'; b.style.borderColor = on ? '#cff0a0' : '#46562f';
    });
    partyBar.querySelectorAll('button[data-size]').forEach((b) => {
      const on = +b.dataset.size === partySize;
      b.style.background = on ? '#3a6a8a' : '#2a3320'; b.style.borderColor = on ? '#a0d8f0' : '#46562f';
    });
    const cd = document.getElementById('partyCd');
    if (cd) cd.textContent = partyRunning ? '⏳ ' + fmt(partyEnd - performance.now() / 1000) : fmt(partyLen);
    const s = document.getElementById('partyStart'); if (s) s.textContent = partyRunning ? '● LIVE' : '▶ START';
  }
  // only the first `partySize` squares are joinable; the rest are locked & greyed
  function applyPadStates() {
    pads.forEach((p, i) => {
      p.active = i < partySize;
      const m = p.mesh && p.mesh.userData.glow; if (!m) return;
      if (!p.active) { m.material.color.setHex(0x4a4f42); m.material.emissive.setHex(0x1a1e16); m.material.emissiveIntensity = 0.12; }
      else { m.material.color.setHex(0x2bd4ff); m.material.emissive.setHex(0x2bd4ff); m.material.emissiveIntensity = 0.7; }
    });
  }
  function startParty() {
    if (partyRunning) return;
    partyRunning = true; partyEnd = performance.now() / 1000 + Math.min(120, partyLen);
    updateParty();
    if (hint) hint.innerHTML = '🎉 <b>Party started!</b> Run onto a numbered <b style="color:#8fe6ff">square</b> to join · <b>B</b> to leave · game begins when the timer ends';
  }

  // entering / leaving a square opens the per-player customise panel
  function padTag(n) {
    const menu = document.getElementById('menu'); if (!menu) return;
    let t = document.getElementById('lobbyTag');
    if (!t) { t = document.createElement('div'); t.id = 'lobbyTag'; t.style.cssText = 'font:bold 16px "Trebuchet MS",sans-serif;color:#8fe6ff;letter-spacing:1px;margin-bottom:4px;'; menu.insertBefore(t, menu.firstChild); }
    t.textContent = '🙂 PLAYER ' + n + ' — pick your look';
  }
  function enterPad(i) {
    padTag(i + 1);
    toggleMenu(true);
    if (hint) hint.innerHTML = '✨ You\'re in <b>square ' + (i + 1) + '</b> — pick your look, then press <b>B</b> to leave';
  }
  function closePad() { toggleMenu(false); if (hint && !partyRunning) hint.innerHTML = HINT_HTML; }

  function build() {
    group = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.CircleGeometry(240, 40), new THREE.MeshStandardMaterial({ color: 0x4f9040, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; group.add(ground);
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.3, 44), new THREE.MeshStandardMaterial({ color: 0xcbbf9c, roughness: 1, flatShading: true }));
    plaza.position.y = 0.15; group.add(plaza);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.28, 8, 44), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.6, roughness: 0.35 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; group.add(ring);
    // five numbered JOIN squares across the middle of the clearing
    pads = [];
    for (let i = 0; i < 5; i++) {
      const px = -4.6 + i * 2.3, pz = 5.5;
      const pad = makePad(i + 1); pad.position.set(px, 0.2, pz); group.add(pad);
      pads.push({ mesh: pad, x: px, z: pz, active: i < partySize });
    }
    // 4 tree houses ringing the clearing, ramps + signs facing inward
    const labels = ['', '', 'CLASSES', 'VEHICLES'];   // front-facing pair (in view on spawn)
    lobbyPlats = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = Math.cos(a) * 15, tz = Math.sin(a) * 15;
      const th = makeTreehouse(labels[i]);
      th.position.set(tx, 0, tz);
      const ry = Math.atan2(-tx, -tz);        // ramp/front faces the centre
      th.rotation.y = ry;
      registerTreehousePlats(tx, tz, ry);     // deck + ramp become climbable
      group.add(th);
    }
    for (let r = 13; r < 230; r += 6.5) {
      const n = Math.max(6, Math.floor(r * 0.42));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.35, 0.35), rr = r + rnd(-3, 3);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (Math.hypot(x, z) < 12) continue;
        group.add(makeTree(x, z, rnd(0.8, 1.9)));
      }
    }
    scene.add(group);
    hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a6b35, 1.05); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1d0, 1.15); sun.position.set(60, 130, 40); scene.add(sun);
    scene.background = new THREE.Color(0x9fd3ef);
    scene.fog = new THREE.FogExp2(0x9fd3ef, 0.0072);
    cam.rotation.order = 'YXZ';
  }

  function makeHint() {
    hint = document.createElement('div');
    hint.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:12;' +
      'background:rgba(12,16,10,.66);border:2px solid rgba(150,180,110,.5);border-radius:12px;padding:9px 16px;' +
      "font:bold 14px 'Trebuchet MS',sans-serif;color:#eaf4dd;text-shadow:0 1px 2px #000;text-align:center;" +
      'backdrop-filter:blur(2px);pointer-events:none;white-space:nowrap;';
    hint.innerHTML = HINT_HTML;
    document.body.appendChild(hint);
  }

  function toggleMenu(openState) {
    menuOpen = (openState === undefined) ? !menuOpen : openState;
    const menu = document.getElementById('menu');
    if (menu) menu.style.display = menuOpen ? '' : 'none';
    if (hint) hint.style.display = menuOpen ? 'none' : '';
    if (menuOpen && document.pointerLockElement) document.exitPointerLock();
  }

  function startGame() {
    if (started || starting) return; starting = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const solo = document.getElementById('soloBtn');
    if (solo) solo.click();     // -> beginGame -> overlay gets .hidden -> teardown()
  }

  function step() {
    if (started) return;
    raf = requestAnimationFrame(step);
    tphase += 0.02;
    if (partyRunning) { updateParty(); if (performance.now() / 1000 >= partyEnd) { startGame(); } }
    if (!menuOpen) {
      // arrow keys turn/look — works with NO mouse lock needed
      const LK = 2.0 / 60;
      if (keys.ArrowLeft) yaw += LK; if (keys.ArrowRight) yaw -= LK;
      if (keys.ArrowUp) pitch = clamp(pitch + LK, -1.4, 1.4); if (keys.ArrowDown) pitch = clamp(pitch - LK, -1.4, 1.4);
      // WASD move (relative to where you're facing) — no pointer lock required
      const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
      const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      if (fwd || str) {
        const sin = Math.sin(yaw), cos = Math.cos(yaw);
        let wx = (-sin) * fwd + (cos) * str, wz = (-cos) * fwd + (-sin) * str;
        const len = Math.hypot(wx, wz) || 1; const sp = (keys.ShiftLeft ? 12 : 7) / 60;
        pos.x += (wx / len) * sp; pos.z += (wz / len) * sp;
        const r = Math.hypot(pos.x, pos.z); if (r > 215) { pos.x *= 215 / r; pos.z *= 215 / r; }
      }
    }
    // which numbered square am I standing on? (locked squares can't be joined)
    let on = -1;
    for (let i = 0; i < pads.length; i++) { if (pads[i].active && Math.abs(pos.x - pads[i].x) < 0.95 && Math.abs(pos.z - pads[i].z) < 0.95) { on = i; break; } }
    pads.forEach((p, i) => {
      const m = p.mesh.userData.glow; if (!m) return;
      if (!p.active) { m.material.color.setHex(0x4a4f42); m.material.emissive.setHex(0x1a1e16); m.material.emissiveIntensity = 0.12; }
      else { m.material.color.setHex(0x2bd4ff); m.material.emissive.setHex(0x2bd4ff); m.material.emissiveIntensity = (i === on ? 1.9 : 0.7); }
    });
    if (on !== curPad) {
      curPad = on;
      if (on >= 0) { if (on !== leftPad) enterPad(on); }
      else { leftPad = -1; if (menuOpen) closePad(); }
    }
    // stand on / climb the tree-house ramps + decks (ground otherwise)
    const stand = lobbyStand(pos.x, pos.z, pos.y - EYE);
    pos.y += (stand + EYE - pos.y) * 0.4;    // smooth step up the ramp / settle onto the deck
    cam.position.set(pos.x, pos.y, pos.z);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  const onMove = (e) => { if (started || menuOpen || document.pointerLockElement !== canvas) return; yaw -= e.movementX * 0.0022; pitch = clamp(pitch - e.movementY * 0.0022, -1.4, 1.4); };
  const MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, ShiftLeft: 1 };
  const onDown = (e) => { if (started) return; keys[e.code] = true; if (MOVE_KEYS[e.code]) { e.preventDefault(); e.stopImmediatePropagation(); } if ((e.code === 'KeyB' || e.code === 'Escape') && menuOpen) { e.stopImmediatePropagation(); leftPad = curPad; closePad(); } else if (e.code === 'Enter' && !menuOpen) { startGame(); } };
  const onUp = (e) => { keys[e.code] = false; };
  const onCanvasDown = () => { if (started || menuOpen) return; if (document.pointerLockElement == null && canvas.requestPointerLock) canvas.requestPointerLock(); };

  function addControls() {
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp);
    canvas.addEventListener('mousedown', onCanvasDown);
  }

  function teardown() {
    if (started) return; started = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', onMove);
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp);
    if (canvas) canvas.removeEventListener('mousedown', onCanvasDown);
    try {
      if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); }); }
      if (hemi) scene.remove(hemi);
      if (sun) scene.remove(sun);
      if (hint) hint.remove();
      if (partyBar) partyBar.remove();
      const tg = document.getElementById('lobbyTag'); if (tg) tg.remove();
      HUD_IDS.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = hudPrev[id] || ''; });
    } catch (e) {}
  }

  function slimOverlay() {
    const ov = document.getElementById('startOverlay'); if (!ov) return;
    ov.classList.add('lobby');
    const p = ov.querySelector('p'); if (p) p.style.display = 'none';
    const keysBlk = ov.querySelector('.keys'); if (keysBlk) keysBlk.style.display = 'none';
    const h1 = ov.querySelector('h1'); if (h1) h1.style.display = 'none';
    const menu = document.getElementById('menu'); if (menu) menu.style.display = 'none';   // hidden until C
    HUD_IDS.forEach((id) => { const el = document.getElementById(id); if (el) { hudPrev[id] = el.style.display; el.style.display = 'none'; } });
    // teardown the instant the game begins (beginGame adds .hidden)
    new MutationObserver(() => { if (ov.classList.contains('hidden')) teardown(); }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  }

  const wait = setInterval(() => {
    if (!(W._scene && W._cam)) return;
    clearInterval(wait);
    try {
      scene = W._scene; cam = W._cam;
      canvas = document.querySelector('#app canvas') || document.querySelector('canvas');
      if (!canvas) throw new Error('no canvas');
      build(); makeHint(); makePartyBar(); addControls(); slimOverlay(); step();
    } catch (e) {
      // failsafe: never trap the player — restore the plain menu
      const menu = document.getElementById('menu'); if (menu) menu.style.display = '';
      const ov = document.getElementById('startOverlay'); if (ov) ov.classList.remove('lobby');
      const HUD = ['minimap', 'stats', 'res', 'hotbar', 'info', 'tpVillage', 'cross', 'ownBar'];
      HUD.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    }
  }, 150);
})();
