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
  let chosenPad = -1, filled = 0;                            // the ONE shared box everyone piles into, and how many are in it
  let inBox = false, boxCount = 0, boxCountCanvas = null, boxCountTex = null;   // the infinite-capacity JOIN BOX at the back
  const BOX = { x: 0, z: -6, w: 6, d: 4 };                    // footprint of the walk-in box (removed)
  let confirmed = false, readyBox = -1, timerEl = null;      // auto-customise, then boxes open a player-count picker
  let countOpen = false, countEl = null;                     // the "how many players 1-5" picker + 30s countdown
  let lockedIn = false, joined = 0;                          // step in a box -> locked in (can't leave); press J to leave the party
  let myBox = -1, coopStarting = false, joinWait = false;    // shared party boxes: which box I'm in, whether a co-op start is underway, and if I'm waiting on a host
  const HUD_IDS = ['minimap', 'stats', 'res', 'hotbar', 'info', 'tpVillage', 'cross', 'ownBar'];
  const hudPrev = {};
  const keys = {};
  let lobbyPlats = [];                            // walkable decks + ramps (tree houses)
  let bandit = null, banditPos = null, banditBaseY = 0;   // the friendly "Update Keeper" in the UPDATES house
  let nearBandit = false, updatesOpen = false, updatesPanel = null, fPrompt = null;  // his versions menu (press F)
  let wolf = null, wolfPos = null, wolfBaseY = 0, nearWolf = false, classesOpen = false, classesPanel = null;  // CLASSES house wolf shop (press F)
  let scholar = null, scholarPos = null, scholarBaseY = 0, nearScholar = false, chaptersOpen = false, chaptersPanel = null;  // CHAPTER house — read the story (press F)
  let were = null, werePos = null, wereBaseY = 0, nearWere = false, talentsOpen = false, talentsPanel = null, talentsView = null;  // TALENTS house — the Talented Werewolf (press F)
  // a class's power rating shown as gold ★ (filled) out of 5
  const classStars = (d) => { const n = Math.max(0, Math.min(5, (d && d.stars) || 0)); return '<span style="color:#ffd24a;">' + '★'.repeat(n) + '</span><span style="color:#3f5266;">' + '★'.repeat(5 - n) + '</span>'; };
  let vy = 0;                                     // vertical velocity for jumping in the lobby
  const EYE = 1.7;
  let yaw = 0, pitch = -0.08;
  const pos = { x: 0, y: EYE, z: 17 };            // spawn: standing back from the portal
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const HINT_HTML = '🎮 <b>WASD</b> move · <b>Space</b> jump · walk into a numbered <b style="color:#8fe6ff">box</b>, then pick <b>how many players</b> (1–5) to start a 30s countdown';

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

  // a friendly bandit — the "Update Keeper" who stands in the UPDATES tree house.
  // Walk up and press F and he opens the versions/updates menu.
  function makeBandit() {
    const g = new THREE.Group();
    const DS = THREE.DoubleSide;
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a878, roughness: 1, flatShading: true, side: DS });
    const coat = new THREE.MeshStandardMaterial({ color: 0x2f8f6a, roughness: 1, flatShading: true, side: DS });   // friendly green
    const trews = new THREE.MeshStandardMaterial({ color: 0x38291a, roughness: 1, flatShading: true, side: DS });
    const bandana = new THREE.MeshStandardMaterial({ color: 0x9c3b3b, roughness: 1, flatShading: true, side: DS });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1, flatShading: true });
    const mk = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    mk(0.24, 0.72, 0.24, trews, -0.15, 0.36, 0); mk(0.24, 0.72, 0.24, trews, 0.15, 0.36, 0);   // legs
    mk(0.74, 0.82, 0.42, coat, 0, 1.13, 0);                                                     // coat / torso
    mk(0.78, 0.12, 0.46, dark, 0, 0.78, 0);                                                     // belt
    mk(0.17, 0.72, 0.19, coat, -0.46, 1.12, 0); mk(0.17, 0.72, 0.19, coat, 0.46, 1.12, 0);      // arms
    mk(0.44, 0.44, 0.44, skin, 0, 1.78, 0);                                                     // head
    mk(0.5, 0.18, 0.5, bandana, 0, 2.0, 0);                                                     // bandana cap
    mk(0.5, 0.12, 0.5, bandana, 0, 1.62, 0.0);                                                  // bandana across face
    mk(0.07, 0.07, 0.05, dark, -0.1, 1.84, 0.23); mk(0.07, 0.07, 0.05, dark, 0.1, 1.84, 0.23);  // eyes
    // floating nametag
    const cv = document.createElement('canvas'); cv.width = 340; cv.height = 76;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(22,40,28,.92)'; c.fillRect(6, 8, 328, 60);
    c.strokeStyle = '#8fd36a'; c.lineWidth = 4; c.strokeRect(6, 8, 328, 60);
    c.font = "bold 30px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#e8ffe0'; c.fillText('🛡️ UPDATE KEEPER', 170, 38);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    tag.scale.set(3.4, 0.76, 1); tag.position.y = 2.7; g.add(tag);
    return g;
  }

  // the versions / updates menu the Update Keeper opens — a list of builds with Play buttons
  function makeUpdatesPanel() {
    const p = document.createElement('div');
    p.id = 'lobbyUpdates';
    p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:14;display:none;width:min(460px,92vw);' +
      'background:rgba(14,20,12,.96);border:2px solid #6f8a3a;border-radius:14px;padding:18px 20px;' +
      "font-family:'Trebuchet MS',sans-serif;color:#eaf4dd;box-shadow:0 16px 50px rgba(0,0,0,.6);backdrop-filter:blur(3px);";
    const versions = [
      { v: 'v1.10', tag: 'Newest', legacy: false, desc: 'The full game — classes (Ninja, Samurai, Ranger…), King\'s knights, sandbag walls, Treeling coins, bandit raids & more.', cur: true },
      { v: 'v0.0', tag: 'Original', legacy: true, desc: 'The very first build: a bare forest — no camp, just wolves & werewolves.' },
    ];
    let rows = '';
    versions.forEach((r, i) => {
      rows += '<div style="display:flex;gap:12px;align-items:center;background:rgba(0,0,0,.28);border:1px solid #3d4a2a;border-radius:10px;padding:11px 12px;margin-bottom:10px;">' +
        '<div style="flex:1;"><div style="font-size:16px;font-weight:bold;color:#cfe8b6;">' + r.v +
        ' <span style="font-size:11px;color:' + (r.cur ? '#8fe6ff' : '#ffd08a') + ';border:1px solid currentColor;border-radius:5px;padding:0 6px;margin-left:4px;">' + r.tag + '</span></div>' +
        '<div style="font-size:12px;color:#b9c6a6;margin-top:3px;line-height:1.35;">' + r.desc + '</div></div>' +
        '<button data-legacy="' + (r.legacy ? 1 : 0) + '" style="background:#3c7a2c;border:2px solid #8fd36a;color:#fff;font:bold 14px \'Trebuchet MS\',sans-serif;border-radius:9px;padding:9px 14px;cursor:pointer;white-space:nowrap;">▶ Play</button>' +
      '</div>';
    });
    p.innerHTML = '<div style="font-size:18px;font-weight:bold;letter-spacing:1px;color:#8fd36a;margin-bottom:4px;">🛡️ THE UPDATE KEEPER</div>' +
      '<div style="font-size:12px;color:#9fb488;margin-bottom:12px;">"Pick a version of the woods to play, friend."</div>' + rows +
      '<div style="font-size:11px;color:#8fae74;text-align:center;margin-top:2px;">press <b style="background:#2a3320;border:1px solid #46562f;border-radius:4px;padding:0 5px;">F</b> or <b style="background:#2a3320;border:1px solid #46562f;border-radius:4px;padding:0 5px;">Esc</b> to close</div>';
    p.querySelectorAll('button[data-legacy]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.legacy === '1') { window.location.href = 'v0.0/'; return; }   // v0.0 = a FROZEN snapshot in /v0.0/ — new updates never touch it
        closeUpdates(); startGame(false);
      };
    });
    document.body.appendChild(p);
    return p;
  }
  function openUpdates() {
    if (!updatesPanel) updatesPanel = makeUpdatesPanel();
    updatesOpen = true; updatesPanel.style.display = 'block';
    if (fPrompt) fPrompt.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeUpdates() {
    updatesOpen = false;
    if (updatesPanel) updatesPanel.style.display = 'none';
    if (hint) hint.style.display = '';
  }

  // --- the CHAPTER tree house: a boy player named "Bob" you press F to read the story ---
  function makeBob() {
    const g = new THREE.Group();
    const DS = THREE.DoubleSide;
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3f78d8, roughness: 1, flatShading: true, side: DS });   // blue shirt (boy skin)
    const pants = new THREE.MeshStandardMaterial({ color: 0x2f3d63, roughness: 1, flatShading: true, side: DS });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c19a, roughness: 1, flatShading: true, side: DS });
    const hair = new THREE.MeshStandardMaterial({ color: 0x33241a, roughness: 1, flatShading: true });
    const boot = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1, flatShading: true });
    const mk = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    mk(0.22, 0.6, 0.22, pants, -0.14, 0.42, 0); mk(0.22, 0.6, 0.22, pants, 0.14, 0.42, 0);         // legs
    mk(0.24, 0.14, 0.26, boot, -0.14, 0.1, 0.03); mk(0.24, 0.14, 0.26, boot, 0.14, 0.1, 0.03);     // boots
    mk(0.6, 0.7, 0.34, shirt, 0, 1.05, 0);                                                          // torso
    mk(0.16, 0.6, 0.18, shirt, -0.4, 1.05, 0); mk(0.16, 0.6, 0.18, shirt, 0.4, 1.05, 0);           // arms
    mk(0.16, 0.14, 0.16, skin, -0.4, 0.72, 0); mk(0.16, 0.14, 0.16, skin, 0.4, 0.72, 0);           // hands
    mk(0.42, 0.42, 0.42, skin, 0, 1.62, 0);                                                         // head
    mk(0.46, 0.16, 0.46, hair, 0, 1.86, 0);                                                         // hair
    mk(0.46, 0.1, 0.08, hair, 0, 1.78, 0.22);                                                       // fringe
    mk(0.07, 0.09, 0.05, dark, -0.1, 1.62, 0.22); mk(0.07, 0.09, 0.05, dark, 0.1, 1.62, 0.22);      // eyes
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 76;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(20,30,50,.92)'; c.fillRect(6, 8, 288, 60);
    c.strokeStyle = '#8fbfff'; c.lineWidth = 4; c.strokeRect(6, 8, 288, 60);
    c.font = "bold 32px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#e8f0ff'; c.fillText('👦 BOB', 150, 38);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    tag.scale.set(3.0, 0.76, 1); tag.position.y = 2.6; g.add(tag);
    return g;
  }
  const CHAPTERS = [
    { n: 'I', t: 'The First Night', d: 'You wake in the deep woods with nothing but an axe. Chop wood by day — and keep the campfire fed, for it is all that holds back the dark.' },
    { n: 'II', t: 'The Howling Dark', d: 'Each dusk the treeline stirs: wolves, then werewolves. Raise walls, sharpen your blade, and hold the line until dawn.' },
    { n: 'III', t: 'Bandits at the Gate', d: 'From the eighth night the outlaws come raiding — and their King rides at their head, hungry for your camp.' },
    { n: 'IV', t: 'The Village on the Hill', d: 'To the west stands a town of riflemen and machine-gunners. Trade with it, raid it, or burn it to the ground.' },
    { n: 'V', t: 'Blood & Moonlight', d: 'Some warriors trade their humanity for power. The Vampire feeds, the Ninja vanishes, the President commands — the night belongs to the bold.' },
    { n: 'VI', t: 'The Reckoning', d: 'Then Sir Buffington marches: a hundred thousand pounds of muscle and menace. Only the mightiest see the sun rise after.' },
  ];
  function makeChaptersPanel() {
    const p = document.createElement('div');
    p.id = 'lobbyChapters';
    p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:14;display:none;width:min(480px,92vw);max-height:82vh;overflow-y:auto;' +
      'background:rgba(22,14,32,.96);border:2px solid #8a6ac2;border-radius:14px;padding:18px 20px;' +
      "font-family:'Trebuchet MS',sans-serif;color:#efe4ff;box-shadow:0 16px 50px rgba(0,0,0,.6);backdrop-filter:blur(3px);";
    let rows = '';
    CHAPTERS.forEach((ch) => {
      rows += '<div style="display:flex;gap:12px;align-items:flex-start;background:rgba(0,0,0,.28);border:1px solid #4a3568;border-radius:10px;padding:11px 12px;margin-bottom:10px;">' +
        '<div style="font-size:20px;font-weight:bold;color:#c9a8ff;min-width:34px;text-align:center;">' + ch.n + '</div>' +
        '<div><div style="font-size:15px;font-weight:bold;color:#e6d6ff;">' + ch.t + '</div>' +
        '<div style="font-size:12px;color:#c3b3da;margin-top:3px;line-height:1.4;">' + ch.d + '</div></div></div>';
    });
    p.innerHTML = '<div style="font-size:18px;font-weight:bold;letter-spacing:1px;color:#8fbfff;margin-bottom:4px;">👦 BOB\'S STORY</div>' +
      '<div style="font-size:12px;color:#a8bcd8;margin-bottom:12px;">"Hey! Wanna hear the story of these woods? Sit down…"</div>' + rows +
      '<div style="font-size:11px;color:#a892c8;text-align:center;margin-top:2px;">press <b style="background:#2a2038;border:1px solid #56466a;border-radius:4px;padding:0 5px;">F</b> or <b style="background:#2a2038;border:1px solid #56466a;border-radius:4px;padding:0 5px;">Esc</b> to close</div>';
    document.body.appendChild(p);
    return p;
  }
  function openChapters() {
    if (!chaptersPanel) chaptersPanel = makeChaptersPanel();
    chaptersOpen = true; chaptersPanel.style.display = 'block';
    if (fPrompt) fPrompt.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeChapters() {
    chaptersOpen = false;
    if (chaptersPanel) chaptersPanel.style.display = 'none';
    if (hint) hint.style.display = '';
  }

  // --- the TALENTS tree house: the Talented Werewolf sells permanent perks ------
  function makeWerewolf() {
    const g = new THREE.Group();
    const DS = THREE.DoubleSide;
    const fur = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true, side: DS });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33281c, roughness: 1, flatShading: true, side: DS });
    const claw = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6, flatShading: true });
    const eye = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb020, emissiveIntensity: 1.2, roughness: 0.4 });
    const mk = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    mk(0.28, 0.8, 0.28, dark, -0.22, 0.42, 0); mk(0.28, 0.8, 0.28, dark, 0.22, 0.42, 0);          // digitigrade legs
    mk(0.32, 0.24, 0.4, dark, -0.22, 0.12, 0.08); mk(0.32, 0.24, 0.4, dark, 0.22, 0.12, 0.08);    // big paws
    mk(0.82, 0.95, 0.5, fur, 0, 1.25, 0);                                                          // hulking torso
    mk(0.22, 0.9, 0.24, fur, -0.56, 1.2, 0.02); mk(0.22, 0.9, 0.24, fur, 0.56, 1.2, 0.02);         // long arms
    for (const sx of [-0.56, 0.56]) for (const cx of [-0.06, 0, 0.06]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), claw); c.position.set(sx + cx, 0.74, 0.06); c.rotation.x = Math.PI; g.add(c); }   // claws
    mk(0.46, 0.42, 0.46, fur, 0, 1.95, 0.02);                                                      // head
    mk(0.26, 0.2, 0.3, dark, 0, 1.88, 0.28);                                                       // snout
    mk(0.1, 0.06, 0.06, claw, 0, 1.84, 0.44);                                                      // fangs
    for (const sx of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), fur); ear.position.set(sx, 2.22, 0); g.add(ear); }   // pointed ears
    mk(0.09, 0.09, 0.05, eye, -0.12, 2.0, 0.24); mk(0.09, 0.09, 0.05, eye, 0.12, 2.0, 0.24);       // glowing eyes
    // nametag
    const cv = document.createElement('canvas'); cv.width = 360; cv.height = 76;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(30,22,12,.92)'; c.fillRect(6, 8, 348, 60);
    c.strokeStyle = '#ffce6a'; c.lineWidth = 4; c.strokeRect(6, 8, 348, 60);
    c.font = "bold 27px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffe6a8'; c.fillText('🐺 THE TALENTED WEREWOLF', 180, 38);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    tag.scale.set(3.7, 0.78, 1); tag.position.y = 2.9; g.add(tag);
    return g;
  }
  function talentAction(id) {
    const T = W.talents, K = W.classes, d = T.TDEFS[id], owned = T.owned(id), afford = K.coins() >= d.cost;
    if (owned) return '<div style="text-align:center;padding:11px;background:rgba(60,140,80,.18);border:2px solid #8fd36a;border-radius:10px;color:#8fd36a;font-weight:bold;font-size:15px;">✓ LEARNED</div>';
    return '<button data-tbuy="' + id + '" ' + (afford ? '' : 'disabled') + ' style="width:100%;background:' + (afford ? '#a06a1a' : '#33383f') + ';border:2px solid ' + (afford ? '#ffd873' : '#556') + ';color:' + (afford ? '#fff' : '#9aa') + ';font:bold 15px sans-serif;border-radius:10px;padding:11px;cursor:' + (afford ? 'pointer' : 'not-allowed') + ';">' + (afford ? '🪙 Learn for ' + d.cost : '🔒 Need ' + (d.cost - K.coins()) + ' more 🪙') + '</button>';
  }
  function renderTalentsPanel() {
    const T = W.talents, coins = W.classes.coins();
    let rows = '';
    T.TORDER.forEach((id) => {
      const d = T.TDEFS[id], owned = T.owned(id);
      const perks = d.perks.map((x) => '<li style="margin-bottom:4px;">' + x + '</li>').join('');
      rows += '<div style="background:rgba(0,0,0,.28);border:1px solid ' + (owned ? '#8fd36a' : '#5a4a2a') + ';border-radius:11px;padding:12px 14px;margin-bottom:10px;">' +
        '<div style="display:flex;gap:12px;align-items:center;"><div style="font-size:30px;">' + d.emoji + '</div>' +
        '<div style="flex:1;"><div style="font-size:17px;font-weight:bold;color:#ffe6a8;">' + d.name + (owned ? ' <span style="font-size:11px;color:#8fd36a;border:1px solid #8fd36a;border-radius:5px;padding:0 6px;">LEARNED</span>' : '') + '</div>' +
        '<div style="font-size:12px;color:#c9b98a;margin-top:2px;line-height:1.35;">' + d.blurb + '</div></div></div>' +
        '<ul style="margin:8px 0 10px;padding-left:20px;font-size:13px;color:#e8dcbf;line-height:1.4;">' + perks + '</ul>' +
        talentAction(id) + '</div>';
    });
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<div style="font-size:19px;font-weight:bold;letter-spacing:1px;color:#ffce6a;">🐺 THE TALENTED WEREWOLF</div>' +
      '<div style="font-size:15px;font-weight:bold;color:#ffd873;">🪙 ' + coins + '</div></div>' +
      '<div style="font-size:12px;color:#c9b98a;margin-bottom:12px;">"Learn a talent, pup. It sticks with you forever."</div>' + rows +
      '<div style="font-size:11px;color:#b9a878;text-align:center;margin-top:2px;">press <b style="background:#2a2418;border:1px solid #56492a;border-radius:4px;padding:0 5px;">F</b> or <b style="background:#2a2418;border:1px solid #56492a;border-radius:4px;padding:0 5px;">Esc</b> to close</div>';
  }
  function makeTalentsPanel() {
    const p = document.createElement('div');
    p.id = 'lobbyTalents';
    p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:14;display:none;width:min(460px,92vw);max-height:82vh;overflow-y:auto;' +
      'background:rgba(24,18,10,.96);border:2px solid #a6842f;border-radius:14px;padding:18px 20px;' +
      "font-family:'Trebuchet MS',sans-serif;color:#f0e6cf;box-shadow:0 16px 50px rgba(0,0,0,.6);backdrop-filter:blur(3px);";
    document.body.appendChild(p);
    return p;
  }
  function refreshTalents() {
    if (!talentsPanel || !W.talents) return;
    talentsPanel.innerHTML = renderTalentsPanel();
    talentsPanel.querySelectorAll('button[data-tbuy]').forEach((b) => {
      b.onclick = () => {
        const r = W.talents.buy(b.dataset.tbuy);
        if (!r.ok && r.reason === 'poor') { if (W.hud && W.hud.toast) W.hud.toast('Need ' + r.need + ' more 🪙'); }
        else if (r.ok && !r.already && W.hud && W.hud.toast) W.hud.toast('🐺 Learned ' + W.talents.TDEFS[b.dataset.tbuy].name + '!');
        refreshTalents();
      };
    });
  }
  function openTalents() {
    if (!talentsPanel) talentsPanel = makeTalentsPanel();
    refreshTalents();
    talentsOpen = true; talentsPanel.style.display = 'block';
    if (fPrompt) fPrompt.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeTalents() {
    talentsOpen = false;
    if (talentsPanel) talentsPanel.style.display = 'none';
    if (hint) hint.style.display = '';
  }

  // --- the CLASSES tree house: a tame grey wolf you press F to open the class shop ---
  function makeWolf() {
    const g = new THREE.Group();
    const DS = THREE.DoubleSide;
    const fur = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 1, flatShading: true, side: DS });
    const furDk = new THREE.MeshStandardMaterial({ color: 0x4f5358, roughness: 1, flatShading: true, side: DS });
    const dark = new THREE.MeshStandardMaterial({ color: 0x161a1e, roughness: 1, flatShading: true });
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 0.8, roughness: 0.5 });
    const mk = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    mk(0.62, 0.5, 1.15, fur, 0, 0.62, 0);                                        // body
    for (const sx of [-0.22, 0.22]) for (const sz of [-0.42, 0.42]) mk(0.15, 0.62, 0.15, furDk, sx, 0.31, sz);   // legs
    mk(0.16, 0.12, 0.5, furDk, 0, 0.66, -0.78); const tail = g.children[g.children.length - 1]; tail.rotation.x = -0.6;  // tail
    mk(0.34, 0.34, 0.3, fur, 0, 0.92, 0.62);                                     // neck/base of head
    const head = mk(0.4, 0.4, 0.44, fur, 0, 1.12, 0.82);                          // head
    mk(0.26, 0.2, 0.24, furDk, 0, 1.04, 1.06);                                    // snout
    mk(0.11, 0.18, 0.05, fur, -0.13, 1.36, 0.72); mk(0.11, 0.18, 0.05, fur, 0.13, 1.36, 0.72);   // ears
    mk(0.06, 0.06, 0.04, eyeM, -0.1, 1.16, 1.04); mk(0.06, 0.06, 0.04, eyeM, 0.1, 1.16, 1.04);    // eyes
    // floating nametag
    const cv = document.createElement('canvas'); cv.width = 340; cv.height = 76;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(20,28,40,.92)'; c.fillRect(6, 8, 328, 60);
    c.strokeStyle = '#8fbfff'; c.lineWidth = 4; c.strokeRect(6, 8, 328, 60);
    c.font = "bold 28px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#e6f0ff'; c.fillText('🐺 CLASS WOLF', 170, 38);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    tag.scale.set(3.2, 0.72, 1); tag.position.y = 2.1; g.add(tag);
    return g;
  }

  function makeClassesPanel() {
    const p = document.createElement('div');
    p.id = 'lobbyClasses';
    p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:14;display:none;width:min(500px,94vw);max-height:88vh;overflow:auto;' +
      'background:rgba(12,18,26,.97);border:2px solid #4f7fb0;border-radius:14px;padding:18px 20px;' +
      "font-family:'Trebuchet MS',sans-serif;color:#eaf2fb;box-shadow:0 16px 50px rgba(0,0,0,.6);backdrop-filter:blur(3px);";
    document.body.appendChild(p);
    return p;
  }
  let classesView = null;   // null = the class LIST; a class id = that class's ability detail
  let lastUpgrade = null;   // {id, lvl, list[]} — shows "what upgraded" after an upgrade
  // describe what a Lv2/Lv3 upgrade improves for a class
  function upgradeSummary(id, lvl) {
    const d = W.classes.DEFS[id]; const hb = lvl === 2 ? 1.8 : 3.2, sb = lvl === 2 ? 1.3 : 1.7; const out = [];
    out.push('🩹 Max health ×' + hb);
    out.push('🏃 Move speed ×' + sb);
    if (d.knights) out.push('⚔️ Knight guard ×' + hb + ' (' + Math.round(d.knights * hb) + ' knights)');
    if (d.rifle) out.push('🎯 Rifle ammo ×' + hb);
    if (d.reviveChance) out.push('✨ Revive chance → ' + Math.round(Math.min(1, d.reviveChance + (lvl - 1) * 0.22) * 100) + '%');
    if (d.attackDmg) out.push('💥 Attack damage ×' + (lvl === 2 ? 1.6 : 2.5));
    if (d.engineer) out.push('🗼 ' + (4 + lvl * 2) + ' sentries + ×' + lvl + ' trap/turret damage');
    return out;
  }
  const kbd = (t) => '<b style="background:#22303f;border:1px solid #3a5570;border-radius:4px;padding:0 5px;">' + t + '</b>';
  // the Buy / Equip / Equipped action for a class
  function classAction(id) {
    const K = W.classes, d = K.DEFS[id], owned = K.owned(id), equipped = K.selected() === id, afford = K.coins() >= d.cost;
    if (equipped) return '<div style="text-align:center;padding:11px;background:rgba(60,140,80,.18);border:2px solid #8fd36a;border-radius:10px;color:#8fd36a;font-weight:bold;font-size:15px;">✓ EQUIPPED</div>';
    if (owned) return '<button data-act="select" data-id="' + id + '" style="width:100%;background:#2f5a8a;border:2px solid #8fbfff;color:#fff;font:bold 15px sans-serif;border-radius:10px;padding:11px;cursor:pointer;">⚔️ EQUIP THIS CLASS</button>';
    return '<button data-act="buy" data-id="' + id + '" ' + (afford ? '' : 'disabled') + ' style="width:100%;background:' + (afford ? '#3c7a2c' : '#33383f') + ';border:2px solid ' + (afford ? '#8fd36a' : '#556') + ';color:' + (afford ? '#fff' : '#9aa') + ';font:bold 15px sans-serif;border-radius:10px;padding:11px;cursor:' + (afford ? 'pointer' : 'not-allowed') + ';">' + (afford ? '🪙 Unlock for ' + d.cost : '🔒 Need ' + (d.cost - K.coins()) + ' more 🪙') + '</button>';
  }
  function renderClassList() {
    const K = W.classes, coins = K.coins(), sel = K.selected();
    let rows = '';
    const order = K.ORDER.slice();
    if (K.DEFS.villager && order.indexOf('villager') < 0) order.unshift('villager');  // Survivor: always equippable (free starter class)
    if (K.secretList) K.secretList().forEach((id) => order.push(id));   // 🥚 secret classes show only for the right name (Sophia → Kawaii, Vivian → Cat Master)
    else if (K.secretUnlocked && K.secretUnlocked()) order.push('kawaii');
    order.forEach((id) => {
      const d = K.DEFS[id], owned = K.owned(id), equipped = sel === id;
      const rest = equipped ? 'rgba(60,140,80,.14)' : 'rgba(255,255,255,.03)';
      const badge = equipped ? '<span style="color:#8fd36a;font-weight:bold;font-size:12px;">✓ EQUIPPED</span>'
        : owned ? '<span style="color:#8fbfff;font-weight:bold;font-size:12px;">OWNED</span>'
        : '<span style="color:#ffd873;font-weight:bold;font-size:14px;">🪙 ' + d.cost + '</span>';
      rows += '<div data-view="' + id + '" style="display:flex;gap:12px;align-items:center;background:' + rest + ';border:1px solid ' + (equipped ? '#8fd36a' : '#2f4560') + ';border-radius:11px;padding:11px 14px;margin-bottom:8px;cursor:pointer;" ' +
        'onmouseover="this.style.background=\'rgba(120,170,220,.16)\'" onmouseout="this.style.background=\'' + rest + '\'">' +
        '<div style="font-size:29px;width:40px;text-align:center;">' + d.emoji + '</div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:bold;color:#eaf2fb;">' + d.name + ' <span style="font-size:12px;letter-spacing:1px;">' + classStars(d) + '</span></div>' +
        '<div style="font-size:11.5px;color:#9fb4cc;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + d.blurb + '</div></div>' +
        '<div style="text-align:right;min-width:66px;">' + badge + '</div>' +
        '<div style="color:#5f7fa0;font-size:20px;">›</div></div>';
    });
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<div style="font-size:19px;font-weight:bold;letter-spacing:1px;color:#8fbfff;">🐺 THE CLASS WOLF</div>' +
      '<div style="font-size:15px;font-weight:bold;color:#ffd873;">🪙 ' + coins + '</div></div>' +
      '<div style="font-size:12px;color:#9fb4cc;margin-bottom:12px;">Tap a class to see its abilities.</div>' + rows +
      '<div style="font-size:11px;color:#7f9ab8;text-align:center;margin-top:6px;">' + kbd('F') + ' / ' + kbd('Esc') + ' to close</div>';
  }
  // Level display + Upgrade button (Lv2 = 2x price, Lv3 = 5x price)
  function upgradeAction(id) {
    const K = W.classes; if (!K.owned(id)) return '';
    const lv = K.level(id), stars = '★'.repeat(lv) + '☆'.repeat(3 - lv);
    let btn;
    if (lv >= 3) btn = '<div style="text-align:center;padding:9px;color:#ffd873;font-weight:bold;">★ MAX LEVEL ★</div>';
    else {
      const cost = K.upgradeCost(id), afford = K.coins() >= cost;
      btn = '<button data-act="upgrade" data-id="' + id + '" ' + (afford ? '' : 'disabled') + ' style="width:100%;background:' + (afford ? '#a06a1a' : '#33383f') + ';border:2px solid ' + (afford ? '#ffd873' : '#556') + ';color:' + (afford ? '#fff' : '#9aa') + ';font:bold 14px sans-serif;border-radius:10px;padding:10px;margin-top:8px;cursor:' + (afford ? 'pointer' : 'not-allowed') + ';">' + (afford ? '⬆️ Upgrade to Lv' + (lv + 1) + ' — 🪙 ' + cost : '🔒 Lv' + (lv + 1) + ': need ' + (cost - K.coins()) + ' more 🪙') + '</button>';
    }
    return '<div style="margin-top:14px;font-size:12px;color:#ffd873;font-weight:bold;letter-spacing:1px;">LEVEL ' + lv + '/3 <span style="letter-spacing:2px;">' + stars + '</span> — higher = way stronger</div>' + btn;
  }
  function renderClassDetail(id) {
    const K = W.classes, d = K.DEFS[id], owned = K.owned(id);
    let upBox = '';
    if (lastUpgrade && lastUpgrade.id === id) {
      upBox = '<div style="background:rgba(60,140,80,.16);border:2px solid #8fd36a;border-radius:11px;padding:11px 13px;margin-bottom:13px;">' +
        '<div style="font-size:14px;font-weight:bold;color:#8fd36a;margin-bottom:6px;">✓ UPGRADED TO LEVEL ' + lastUpgrade.lvl + '!</div>' +
        '<div style="font-size:12.5px;color:#dfeaf5;line-height:1.7;">' + lastUpgrade.list.map((x) => '• ' + x).join('<br>') + '</div></div>';
    }
    const perks = d.perks.map((x) => '<li style="margin-bottom:6px;">' + x + '</li>').join('');
    const tag = owned ? '<span style="font-size:12px;color:#8fbfff;border:1px solid #8fbfff;border-radius:5px;padding:1px 7px;margin-left:6px;vertical-align:middle;">OWNED</span>'
      : '<span style="font-size:14px;color:#ffd873;margin-left:6px;">🪙 ' + d.cost + '</span>';
    return '<button data-back="1" style="background:none;border:none;color:#8fbfff;font:bold 14px sans-serif;cursor:pointer;padding:0 0 10px;">‹ All classes</button>' + upBox +
      '<div style="display:flex;gap:14px;align-items:center;margin-bottom:12px;">' +
        '<div style="font-size:52px;line-height:1;">' + d.emoji + '</div>' +
        '<div><div style="font-size:23px;font-weight:bold;color:#eaf2fb;">' + d.name + tag + '</div>' +
        '<div style="font-size:16px;letter-spacing:2px;margin-top:3px;">' + classStars(d) + '</div>' +
        '<div style="font-size:12.5px;color:#9fb4cc;margin-top:4px;line-height:1.4;">' + d.blurb + '</div></div></div>' +
      '<div style="font-size:12px;font-weight:bold;letter-spacing:1.5px;color:#8fd36a;margin:4px 0 8px;">⚡ ABILITIES</div>' +
      '<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#dfeaf5;line-height:1.5;">' + perks + '</ul>' +
      classAction(id) + upgradeAction(id);
  }
  function refreshClasses() {
    if (!classesPanel || !W.classes) return;
    if (classesView && !W.classes.DEFS[classesView]) classesView = null;
    classesPanel.innerHTML = classesView ? renderClassDetail(classesView) : renderClassList();
    classesPanel.querySelectorAll('[data-view]').forEach((el) => { el.onclick = () => { classesView = el.dataset.view; lastUpgrade = null; refreshClasses(); }; });
    const back = classesPanel.querySelector('[data-back]'); if (back) back.onclick = () => { classesView = null; lastUpgrade = null; refreshClasses(); };
    classesPanel.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id;
        if (b.dataset.act === 'buy') {
          const r = W.classes.buy(id);
          if (!r.ok && r.reason === 'poor') { if (W.hud && W.hud.toast) W.hud.toast('Need ' + r.need + ' more 🪙'); }
          else if (r.ok) { if (W.sfx && W.sfx.buy) W.sfx.buy(); if (W.hud && W.hud.toast) W.hud.toast('Unlocked ' + W.classes.DEFS[id].name + '! ' + W.classes.DEFS[id].emoji); }
        } else if (b.dataset.act === 'upgrade') {
          const r = W.classes.upgrade(id);
          if (!r.ok && r.reason === 'poor') { if (W.hud && W.hud.toast) W.hud.toast('Need ' + r.need + ' more 🪙 to upgrade'); }
          else if (r.ok) { lastUpgrade = { id: id, lvl: r.level, list: upgradeSummary(id, r.level) }; if (W.sfx && W.sfx.levelup) W.sfx.levelup(); if (W.hud && W.hud.toast) W.hud.toast('⬆️ ' + W.classes.DEFS[id].name + ' → Lv' + r.level + '!'); }
        } else { W.classes.select(id); if (W.sfx && W.sfx.select) W.sfx.select(); if (W.hud && W.hud.toast) W.hud.toast('Equipped ' + W.classes.DEFS[id].name + ' ' + W.classes.DEFS[id].emoji); }
        refreshClasses();
      };
    });
  }
  function openClasses() {
    if (!classesPanel) classesPanel = makeClassesPanel();
    const ni = document.getElementById('nameInput'); if (ni && W.classes.setName) W.classes.setName(ni.value);   // sync the live name for the secret gate
    classesView = null;
    refreshClasses();
    classesOpen = true; classesPanel.style.display = 'block';
    if (fPrompt) fPrompt.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeClasses() {
    classesOpen = false;
    if (classesPanel) classesPanel.style.display = 'none';
    if (hint) hint.style.display = '';
  }

  // tree-house dimensions (shared with the walkable-platform math in build())
  const TH_H = 4.5, TH_DW = 5, TH_RUN = 6.5, TH_RX = 1.6, TH_RW = 1.7;   // deck top, deck size, ramp run, ramp centre-x, ramp width

  // a cosy climbable tree house (trunk + railed deck + cabin + canopy + planked ramp), optional sign
  function makeTreehouse(label, hollow) {
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, flatShading: true });
    const barkDk = new THREE.MeshStandardMaterial({ color: 0x442d18, roughness: 1, flatShading: true });
    const DS = THREE.DoubleSide;   // solid walls — never see-through / hollow
    const plank = new THREE.MeshStandardMaterial({ color: 0x9c6631, roughness: 0.9, flatShading: true, side: DS });
    const plankDk = new THREE.MeshStandardMaterial({ color: 0x6f4622, roughness: 1, flatShading: true, side: DS });
    const wallM = new THREE.MeshStandardMaterial({ color: 0xc79457, roughness: 0.95, flatShading: true, side: DS });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1, flatShading: true, side: DS });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x8a3d2c, roughness: 0.9, flatShading: true, side: DS });
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

    // cabin: warm plank walls, framed closed door, glowing windows w/ flower boxes, a SOLID interior,
    // a gabled shingle roof with eaves + ridge, a smoking chimney and a porch lantern
    const cw = 3.8, cd = 3.2, ch = 2.5, czc = -0.6, hw = cw / 2, hd = cd / 2, doorHalf = 0.72, TT = 0.16, wy = H + ch;
    const wmesh = (sx, sz, w, hh, d, yb) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), wallM); m.position.set(sx, yb === undefined ? H + hh / 2 : yb, sz); m.castShadow = true; g.add(m); };
    wmesh(0, czc - hd, cw, ch, TT);                       // back
    wmesh(-hw, czc, TT, ch, cd); wmesh(hw, czc, TT, ch, cd);   // sides
    const seg = hw - doorHalf;
    wmesh(-(doorHalf + hw) / 2, czc + hd, seg, ch, TT); wmesh((doorHalf + hw) / 2, czc + hd, seg, ch, TT);  // front flanks
    wmesh(0, czc + hd, doorHalf * 2, ch - 1.9, TT, H + 1.9 + (ch - 1.9) / 2);   // lintel over the door
    // solid interior core (fills the room top-to-deck) so the cabin isn't a hollow shell
    // — skipped for hollow houses (e.g. UPDATES) so someone can actually stand inside
    if (!hollow) { const core = new THREE.Mesh(new THREE.BoxGeometry(cw - 0.34, ch - 0.02, cd - 0.34), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true })); core.position.set(0, H + (ch - 0.02) / 2, czc); core.castShadow = true; g.add(core); }
    if (hollow) { const fl = new THREE.Mesh(new THREE.BoxGeometry(cw - 0.3, 0.08, cd - 0.3), plankDk); fl.position.set(0, H + 0.02, czc); fl.receiveShadow = true; g.add(fl); }   // an actual floor to stand on
    // door frame + a closed plank slab set flush in the doorway
    for (const sx of [-doorHalf, doorHalf]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, TT + 0.06), frameM); j.position.set(sx, H + 0.95, czc + hd); g.add(j); }
    { const top = new THREE.Mesh(new THREE.BoxGeometry(doorHalf * 2 + 0.16, 0.12, TT + 0.06), frameM); top.position.set(0, H + 1.9, czc + hd); g.add(top); }
    if (!hollow) { const dg = new THREE.Group(); dg.position.set(-doorHalf + 0.04, H + 0.06, czc + hd); const dwd = doorHalf * 2 - 0.1;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(dwd, 1.8, 0.07), plankDk); slab.position.set(dwd / 2, 0.9, 0); slab.castShadow = true; dg.add(slab);
      for (const sy of [0.5, 0.9, 1.3]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(dwd - 0.06, 0.045, 0.09), frameM); pl.position.set(dwd / 2, sy, 0); dg.add(pl); }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glow); knob.position.set(dwd - 0.14, 0.9, 0.06); dg.add(knob);
      dg.rotation.y = 0; g.add(dg); }   // closed door (hollow houses leave the doorway open so you can walk in)
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

  // (the old top party bar is gone — the ∞ START box arms a 2:00 timer instead)
  // floating countdown (top-centre) — the party bar is gone
  function updateTimerUI() {
    if (!timerEl) return;
    if (partyRunning) {
      timerEl.style.display = 'block';
      const bi = (W.net && W.net.hubBoxInfo) ? W.net.hubBoxInfo(myBox) : { count: 0 };
      const inBox = bi.count + 1;
      const left = fmt(partyEnd - performance.now() / 1000);
      timerEl.innerHTML = '👥 <b style="color:#bfffca">' + inBox + ' / ' + partySize + '</b> in box · ⏳ <b style="color:#8fe6ff;font-size:19px">' + left +
        '</b> · <b style="color:#8fd36a">Enter</b> start · <b style="color:#ff9a9a">J</b> leave';
    } else { timerEl.style.display = 'none'; }
  }
  // paint one small box's glow: cyan=open customise spot, green=the one you're standing in
  function paintPad(p, i, hovered) {
    const m = p.mesh && p.mesh.userData.glow; if (!m) return;
    if (i === curPad) { m.material.color.setHex(0x36e05a); m.material.emissive.setHex(0x36e05a); m.material.emissiveIntensity = hovered ? 2.0 : 1.2; }
    else { m.material.color.setHex(0x2bd4ff); m.material.emissive.setHex(0x2bd4ff); m.material.emissiveIntensity = hovered ? 1.9 : 0.7; }
  }
  function refreshActive() { pads.forEach((p) => { p.active = confirmed; }); }   // boxes open once you've customised
  function applyPadStates() { refreshActive(); pads.forEach((p, i) => paintPad(p, i, false)); }
  function startCountdown(sec) {
    if (partyRunning) return;
    partyRunning = true; partyEnd = performance.now() / 1000 + sec;
    updateTimerUI();
  }

  // --- Auto customise on entry: name + look, then CONFIRM ---
  function openCustomise() {
    const menu = document.getElementById('menu'); if (!menu) return;
    let t = document.getElementById('lobbyTag');
    if (!t) { t = document.createElement('div'); t.id = 'lobbyTag'; t.style.cssText = 'font:bold 16px "Trebuchet MS",sans-serif;color:#8fe6ff;letter-spacing:1px;margin-bottom:4px;'; menu.insertBefore(t, menu.firstChild); }
    t.textContent = '🙂 CUSTOMISE YOUR HERO — name & look';
    let b = document.getElementById('lobbySubmit');
    if (!b) {
      b = document.createElement('button'); b.id = 'lobbySubmit'; b.className = 'btn';
      b.style.cssText = 'background:#3c7a2c;border:2px solid #8fd36a;color:#fff;font:bold 15px "Trebuchet MS",sans-serif;border-radius:9px;padding:8px 18px;margin-top:8px;cursor:pointer;';
      menu.appendChild(b);
    }
    b.textContent = '✓ CONFIRM'; b.onclick = confirmLook;
    toggleMenu(true);
    const ni = document.getElementById('nameInput'); if (ni) setTimeout(() => { try { ni.focus(); ni.select(); } catch (e) {} }, 40);
  }
  function confirmLook() {
    const ni = document.getElementById('nameInput');
    if (ni && !ni.value.trim()) { if (W.hud && W.hud.toast) W.hud.toast('✍️ Type a name first!'); try { ni.focus(); } catch (e) {} return; }
    confirmed = true; toggleMenu(false); applyPadStates();
    if (hint) hint.innerHTML = HINT_HTML;
  }

  // --- Numbered boxes: walk into one -> pick how many players (1-5) -> 30s countdown -> start ---
  function makeCountPicker() {
    countEl = document.createElement('div');
    countEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:13;display:none;text-align:center;' +
      'background:rgba(14,20,12,.96);border:2px solid #8fd36a;border-radius:14px;padding:16px 22px;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#eaf4dd;box-shadow:0 14px 44px rgba(0,0,0,.6);";
    let btns = '';
    for (let n = 1; n <= 5; n++) btns += '<button data-count="' + n + '" style="width:54px;height:54px;margin:4px;font-size:24px;font-weight:bold;background:#2a3320;border:2px solid #6f8a3a;border-radius:10px;color:#eaffe0;cursor:pointer;">' + n + '</button>';
    countEl.innerHTML = '<div style="font-size:17px;color:#8fd36a;margin-bottom:10px;">🔒 HOW MANY PLAYERS?</div><div>' + btns + '</div><div style="font-size:11px;color:#9fb488;margin-top:8px;">press <b>1–5</b> to start a 30s countdown · press <b style="color:#ff9a9a">J</b> to leave the box</div>';
    countEl.querySelectorAll('button[data-count]').forEach((b) => { b.onclick = () => pickCount(+b.dataset.count); });
    document.body.appendChild(countEl);
  }
  function openCountPicker(idx) {
    if (partyRunning || !confirmed) return;      // customise first, and don't reopen once counting down
    lockedIn = true; joined = 1;                 // stepping in the box locks you in — you can't walk out until you press J
    myBox = (idx == null ? 9 : idx);             // which box (numbered pad index, or 9 = the ∞ box)
    if (W.net && W.net.setHubBox) W.net.setHubBox(myBox, false);
    if (document.pointerLockElement) document.exitPointerLock();
    // if someone in this box is already hosting a party, join them instead of picking a count
    const info = (W.net && W.net.hubBoxInfo) ? W.net.hubBoxInfo(myBox) : { count: 0, hosted: false, names: [] };
    if (info.hosted) { enterJoinWait(info); return; }
    joinWait = false;
    countOpen = true; if (countEl) countEl.style.display = 'block';
    if (hint) hint.innerHTML = '🔒 <b>Locked in the box</b> — pick players <b>1</b>–<b>5</b>, or press <b style="color:#ff9a9a">J</b> to leave';
  }
  // Someone else in this box already started a party — wait for them to launch it.
  function enterJoinWait(info) {
    joinWait = true; countOpen = false; if (countEl) countEl.style.display = 'none';
    const who = (info && info.names && info.names[0]) ? info.names[0] : 'a friend';
    if (hint) hint.innerHTML = '👥 <b>In ' + who + '’s party</b> — waiting for the host to start… (press <b style="color:#ff9a9a">J</b> to leave)';
    if (W.hud && W.hud.toast) W.hud.toast('👥 Joined the party in this box — waiting for the host…');
  }
  function closeCountPicker() {
    countOpen = false; if (countEl) countEl.style.display = 'none';
    if (hint && !partyRunning && !lockedIn) hint.innerHTML = HINT_HTML;
  }
  // press J while locked in a box — leave the party: unlock, cancel the countdown, walk back into a box to play
  function leaveParty() {
    if (!lockedIn) return;
    lockedIn = false; joined = 0; partyRunning = false;
    myBox = -1; joinWait = false; coopStarting = false;
    if (W.net && W.net.setHubBox) W.net.setHubBox(-1, false);
    closeCountPicker(); updateTimerUI();
    if (W.hud && W.hud.toast) W.hud.toast('🚪 You left the party — step back into a box to play');
    if (hint) hint.innerHTML = '🚪 <b>You left the party</b> — walk back into a <b style="color:#8fe6ff">box</b> to play';
  }
  function pickCount(n) {
    if (!countOpen) return;
    partySize = n; closeCountPicker();
    if (n === 1) { if (W.hud && W.hud.toast) W.hud.toast('🎮 Solo — entering the forest…'); startGame(); return; }   // 1 player -> start instantly
    if (W.net && W.net.setHubBox) W.net.setHubBox(myBox, true);   // I'm hosting this box's party — friends who step in now can join
    startCountdown(30);
    if (W.hud && W.hud.toast) W.hud.toast('👥 Box open for ' + n + ' — friends can walk in! Starts when full or in 30s.');
    if (hint) hint.innerHTML = '⏳ <b>Starting in 30s…</b> (press <b>Enter</b> to start now)';
  }

  // --- the ∞ JOIN BOX at the back: the Animal-Hostal start zone (first player arms a 2:00 timer, host starts anytime) ---

  // --- the infinite-capacity JOIN BOX at the back of the clearing ---
  function paintBoxCount() {
    if (!boxCountCanvas) return;
    const c = boxCountCanvas.getContext('2d'); c.clearRect(0, 0, 256, 92);
    c.font = "bold 46px 'Trebuchet MS',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = 'rgba(6,20,26,.9)'; c.strokeText('👥 ' + boxCount, 128, 46);
    c.fillStyle = '#bfffca'; c.fillText('👥 ' + boxCount, 128, 46);
    if (boxCountTex) boxCountTex.needsUpdate = true;
  }
  function makeJoinBox() {
    const g = new THREE.Group(); g.position.set(BOX.x, 0, BOX.z);
    const woodM = new THREE.MeshStandardMaterial({ color: 0x9c6631, roughness: 0.9, flatShading: true });
    const woodDk = new THREE.MeshStandardMaterial({ color: 0x6f4622, roughness: 1, flatShading: true });
    const glowM = new THREE.MeshStandardMaterial({ color: 0x36e05a, emissive: 0x36e05a, emissiveIntensity: 0.9, roughness: 0.4, transparent: true, opacity: 0.85 });
    const w = BOX.w, d = BOX.d, wallH = 0.95, t = 0.18;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, 0.08, d - 0.24), glowM); floor.position.y = 0.12; g.add(floor);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), woodDk); rim.position.y = 0.09; g.add(rim);
    const wall = (x, z, wl, dl) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wl, wallH, dl), woodM); m.position.set(x, wallH / 2 + 0.18, z); m.castShadow = true; g.add(m); };
    wall(0, -d / 2, w, t);                                  // back
    wall(-w / 2, 0, t, d); wall(w / 2, 0, t, d);            // sides
    const stub = (w - 2.6) / 2;                             // front, with a wide entrance (open toward the plaza)
    wall(-(1.3 + stub / 2), d / 2, stub, t); wall(1.3 + stub / 2, d / 2, stub, t);
    for (const sx of [-w / 2, w / 2]) for (const sz of [-d / 2, d / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, wallH + 0.6, 7), woodDk); p.position.set(sx, (wallH + 0.6) / 2 + 0.18, sz); p.castShadow = true; g.add(p); }
    // header sign + live player count floating over the box
    const lab = makeSign('▶ START · ∞ PLAYERS'); lab.position.set(0, 3.1, -d / 2 - 0.05); lab.scale.set(4.2, 1.25, 1); g.add(lab);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 92; boxCountCanvas = cv;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    boxCountTex = spr.material.map; spr.scale.set(3.0, 1.08, 1); spr.position.set(0, 2.15, 0); g.add(spr);
    paintBoxCount();
    return g;
  }
  function enterStartZone() {                         // ∞ box = Animal-Hostal start zone
    boxCount = 1; paintBoxCount();
    if (!partyRunning) { partyLen = 120; startParty(); if (W.hud && W.hud.toast) W.hud.toast('⏳ 2:00 countdown started — press Enter to START now'); }
    if (hint) hint.innerHTML = '📦 <b>In the START box</b> — press <b style="color:#8fd36a">Enter</b> to begin now · game auto-starts when the timer ends';
  }
  function leaveStartZone() { boxCount = 0; paintBoxCount(); if (hint && !menuOpen) hint.innerHTML = HINT_HTML; }

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
      pads.push({ mesh: pad, x: px, z: pz, active: true });
    }
    // the ∞ START box at the back — walk in to arm the 2:00 timer / start the game
    inBox = false; boxCount = 0;
    group.add(makeJoinBox());
    // 4 tree houses ringing the clearing, ramps + signs facing inward
    const labels = ['UPDATES', 'TALENTS', 'CLASSES', 'CHAPTER'];   // house 0 = version picker · 1 = talents · 2 = class shop · 3 = the story house
    lobbyPlats = [];
    for (let i = 0; i < 4; i++) {
      // (all 4 slots now hold a tree house)
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = Math.cos(a) * 15, tz = Math.sin(a) * 15;
      const th = makeTreehouse(labels[i], true);   // all houses are hollow so their keeper stands INSIDE
      th.position.set(tx, 0, tz);
      const ry = Math.atan2(-tx, -tz);        // ramp/front faces the centre
      th.rotation.y = ry;
      registerTreehousePlats(tx, tz, ry);     // deck + ramp become climbable
      group.add(th);
      if (i === 0) {                          // UPDATES house: the Update Keeper stands on its deck
        const dl = Math.hypot(tx, tz) || 1;
        const bx = tx + tx / dl * 0.6, bz = tz + tz / dl * 0.6;   // standing INSIDE the hollow cabin, past the doorway
        banditPos = { x: bx, z: bz }; banditBaseY = TH_H;
        bandit = makeBandit();
        bandit.position.set(bx, TH_H, bz);
        bandit.rotation.y = Math.atan2(-bx, -bz);   // face the centre (where the player climbs up)
        group.add(bandit);
      }
      if (i === 1) {                          // TALENTS house: the Talented Werewolf stands INSIDE
        const dl = Math.hypot(tx, tz) || 1;
        const rx = tx + tx / dl * 0.6, rz = tz + tz / dl * 0.6;
        werePos = { x: rx, z: rz }; wereBaseY = TH_H;
        were = makeWerewolf();
        were.position.set(rx, TH_H, rz);
        were.rotation.y = Math.atan2(-rx, -rz);
        group.add(were);
      }
      if (i === 2) {                          // CLASSES house: the class-shop wolf stands INSIDE the cabin
        const dl = Math.hypot(tx, tz) || 1;
        const wx = tx + tx / dl * 0.6, wz = tz + tz / dl * 0.6;   // past the doorway, inside the hollow cabin
        wolfPos = { x: wx, z: wz }; wolfBaseY = TH_H;
        wolf = makeWolf();
        wolf.position.set(wx, TH_H, wz);
        wolf.rotation.y = Math.atan2(-wx, -wz);
        group.add(wolf);
      }
      if (i === 3) {                          // CHAPTER house: the Lorekeeper stands INSIDE, in the old VEHICLES spot
        const dl = Math.hypot(tx, tz) || 1;
        const sx2 = tx + tx / dl * 0.6, sz2 = tz + tz / dl * 0.6;
        scholarPos = { x: sx2, z: sz2 }; scholarBaseY = TH_H;
        scholar = makeBob();
        scholar.position.set(sx2, TH_H, sz2);
        scholar.rotation.y = Math.atan2(-sx2, -sz2);
        group.add(scholar);
      }
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
    // no hollow / see-through walls anywhere in the lobby — double-side every mesh material
    group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m && 'side' in m && m.side !== THREE.BackSide) m.side = THREE.DoubleSide; }
    });
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

  // the "[F] Talk to the Update Keeper" prompt, shown when you're up on his deck
  function makeFPrompt() {
    fPrompt = document.createElement('div');
    fPrompt.style.cssText = 'position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:13;display:none;' +
      'background:rgba(20,32,16,.9);border:2px solid #8fd36a;border-radius:12px;padding:8px 16px;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#eaffe0;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none;";
    fPrompt.innerHTML = 'Press <b style="background:#2a3320;border:1px solid #8fd36a;border-radius:5px;padding:0 7px;">F</b> to talk to the 🛡️ <b>Update Keeper</b>';
    document.body.appendChild(fPrompt);
  }

  // floating 2:00 countdown (top-centre) — appears once someone's armed it in the ∞ START box
  function makeTimerUI() {
    timerEl = document.createElement('div');
    timerEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:12;display:none;' +
      'background:rgba(12,16,10,.82);border:2px solid #8fd36a;border-radius:12px;padding:8px 18px;text-align:center;' +
      "font:bold 15px 'Trebuchet MS',sans-serif;color:#eaf4dd;text-shadow:0 1px 2px #000;cursor:pointer;";
    timerEl.onclick = () => { if (partyRunning) beginParty(); };   // click the timer to start now too
    document.body.appendChild(timerEl);
  }

  function toggleMenu(openState) {
    menuOpen = (openState === undefined) ? !menuOpen : openState;
    const menu = document.getElementById('menu');
    if (menu) menu.style.display = menuOpen ? '' : 'none';
    if (hint) hint.style.display = menuOpen ? 'none' : '';
    if (menuOpen && document.pointerLockElement) document.exitPointerLock();
  }

  function startGame(legacy) {
    if (started || starting) return; starting = true;
    W.LEGACY = !!legacy;        // v0.0 launcher passes true -> world/enemies build the bare legacy mode
    const ni = document.getElementById('nameInput'); if (ni && !ni.value.trim()) ni.value = 'Player';   // never block the start
    const vt = document.getElementById('verTag'); if (vt) vt.textContent = legacy ? 'v0.0' : 'v1.10';
    if (document.pointerLockElement) document.exitPointerLock();
    const solo = document.getElementById('soloBtn');
    if (solo) solo.click();     // -> beginGame -> overlay gets .hidden -> teardown()
  }

  // Start the box's party: if friends are in the box with me, host a co-op game and
  // hand them the room code over the hub; otherwise just drop into a solo game.
  function beginParty() {
    if (coopStarting || started || starting) return;
    const info = (W.net && W.net.hubBoxInfo) ? W.net.hubBoxInfo(myBox) : { count: 0 };
    const hubOn = W.net && W.net.hub && W.net.hub.on;
    if (!hubOn || info.count === 0) { startGame(); return; }   // no one else here -> plain solo start
    coopStarting = true;
    if (W.net.setHubBox) W.net.setHubBox(myBox, true);
    W.net.myName = ((document.getElementById('nameInput') || {}).value || 'Player').trim().slice(0, 12) || 'Player';
    if (W.hud && W.hud.toast) W.hud.toast('🎮 Starting co-op with ' + (info.count + 1) + ' players…');
    W.net.host({
      onCode: (code) => {
        // tell box-mates the room code (twice, ~150ms apart) so it reliably lands...
        if (W.net.hubGo) { W.net.hubGo({ box: myBox, code: code }); setTimeout(() => { if (W.net.hubGo) W.net.hubGo({ box: myBox, code: code }); }, 150); }
        // ...then start our own game a beat later, once the signal has propagated
        setTimeout(() => { if (W._begin) W._begin(W.net.seed); }, 550);
      },
      onStatus: () => {}, onPeer: () => {},
    });
  }
  // The host of my box just launched — join their game.
  function onHubGo(m) {
    if (coopStarting || started || starting) return;
    if (!m || m.box == null || m.box !== myBox) return;         // only if I'm standing in that same box
    if (W.net && W.net.hub && W.net.hub.hosting) return;        // I'm the host, not a joiner
    coopStarting = true;
    W.net.myName = ((document.getElementById('nameInput') || {}).value || 'Player').trim().slice(0, 12) || 'Player';
    if (W.hud && W.hud.toast) W.hud.toast('🎮 Joining the party…');
    W.net.join(m.code, { onInit: (seed) => { if (W._begin) W._begin(seed); }, onStatus: () => {} });
  }

  // Join the shared public lobby so everyone here can see each other walk around.
  function joinHub() {
    if (!(W.net && W.net.joinHub)) return;
    try {
      W.net.joinHub({
        scene: scene,
        getPose: () => ({ x: pos.x, y: pos.y - EYE, z: pos.z, yaw: yaw }),   // feet position
        getName: () => { const ni = document.getElementById('nameInput'); return ((ni && ni.value.trim()) || (W.net && W.net.myName) || 'Player').slice(0, 12); },
        getSkin: () => (W.player && W.player.skin) || 'boy',
      });
      if (W.net.hub) W.net.hub.onGo = onHubGo;   // receive party-start signals from the box host
    } catch (e) {}
  }

  function step() {
    if (started) return;
    raf = requestAnimationFrame(step);
    tphase += 0.02;
    if (W.net && W.net.hubTick) W.net.hubTick(1 / 60);   // sync + render other lobby players
    if (partyRunning) {
      updateTimerUI();
      const bi = (W.net && W.net.hubBoxInfo) ? W.net.hubBoxInfo(myBox) : { count: 0 };
      if ((bi.count + 1) >= partySize || performance.now() / 1000 >= partyEnd) { beginParty(); }   // box full or time up -> go
    }
    // if another player in my box took the host role, flip me into join-wait
    if (lockedIn && !joinWait && !coopStarting && myBox >= 0 && !(W.net && W.net.hub && W.net.hub.hosting)) {
      const info = (W.net && W.net.hubBoxInfo) ? W.net.hubBoxInfo(myBox) : null;
      if (info && info.hosted) { partyRunning = false; updateTimerUI(); enterJoinWait(info); }
    }
    if (!menuOpen && !updatesOpen && !classesOpen && !chaptersOpen && !talentsOpen && !countOpen && !lockedIn) {
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
    // which box am I standing on? -> open the "how many players?" picker
    let on = -1;
    for (let i = 0; i < pads.length; i++) { if (pads[i].active && Math.abs(pos.x - pads[i].x) < 0.95 && Math.abs(pos.z - pads[i].z) < 0.95) { on = i; break; } }
    pads.forEach((p, i) => paintPad(p, i, i === on));
    if (on !== curPad) {
      curPad = on;
      if (on >= 0) openCountPicker(on);   // stepped into a box -> pick player count (or join a party already forming)
      else if (!inBox) closeCountPicker();
    }
    // the ∞ box at the back also opens the player-count picker
    const inNow = Math.abs(pos.x - BOX.x) < BOX.w / 2 && Math.abs(pos.z - BOX.z) < BOX.d / 2;
    if (inNow && !inBox) { inBox = true; openCountPicker(9); }
    else if (!inNow && inBox) { inBox = false; if (curPad < 0) closeCountPicker(); }
    // the Update Keeper bandit: gently bob, face the player, show an [F] prompt when you're up on his deck
    if (bandit) {
      bandit.position.y = banditBaseY + Math.sin(tphase * 2) * 0.05;
      bandit.rotation.y = Math.atan2(pos.x - banditPos.x, pos.z - banditPos.z);
      nearBandit = !menuOpen && pos.y > TH_H - 1 && Math.hypot(pos.x - banditPos.x, pos.z - banditPos.z) < 2.6;
    }
    // the class wolf: bob, face the player, near-check when up on the CLASSES deck
    if (wolf) {
      wolf.position.y = wolfBaseY + Math.sin(tphase * 2 + 1) * 0.04;
      wolf.rotation.y = Math.atan2(pos.x - wolfPos.x, pos.z - wolfPos.z);
      nearWolf = !menuOpen && pos.y > TH_H - 1 && Math.hypot(pos.x - wolfPos.x, pos.z - wolfPos.z) < 2.6;
    }
    // the Lorekeeper: bob, face the player, near-check when up on the CHAPTER deck
    if (scholar) {
      scholar.position.y = scholarBaseY + Math.sin(tphase * 2 + 2) * 0.04;
      scholar.rotation.y = Math.atan2(pos.x - scholarPos.x, pos.z - scholarPos.z);
      nearScholar = !menuOpen && pos.y > TH_H - 1 && Math.hypot(pos.x - scholarPos.x, pos.z - scholarPos.z) < 2.6;
    }
    // the Talented Werewolf: bob, face the player, near-check on the TALENTS deck
    if (were) {
      were.position.y = wereBaseY + Math.sin(tphase * 2 + 3) * 0.05;
      were.rotation.y = Math.atan2(pos.x - werePos.x, pos.z - werePos.z);
      nearWere = !menuOpen && pos.y > TH_H - 1 && Math.hypot(pos.x - werePos.x, pos.z - werePos.z) < 2.6;
    }
    // shared [F] prompt — shows for whichever NPC you're standing beside
    if (fPrompt) {
      const show = (nearBandit && !updatesOpen) || (nearWolf && !classesOpen) || (nearScholar && !chaptersOpen) || (nearWere && !talentsOpen);
      fPrompt.style.display = show ? 'block' : 'none';
      if (show) fPrompt.innerHTML = nearWolf
        ? 'Press <b style="background:#22303f;border:1px solid #8fbfff;border-radius:5px;padding:0 7px;">F</b> to open the 🐺 <b>Class Wolf</b> shop'
        : nearWere
        ? 'Press <b style="background:#2a2418;border:1px solid #ffce6a;border-radius:5px;padding:0 7px;">F</b> to learn a <b>Talent</b> from the 🐺 Werewolf'
        : nearScholar
        ? 'Press <b style="background:#22303f;border:1px solid #8fbfff;border-radius:5px;padding:0 7px;">F</b> to read the story with 👦 <b>Bob</b>'
        : 'Press <b style="background:#2a3320;border:1px solid #8fd36a;border-radius:5px;padding:0 7px;">F</b> to talk to the 🛡️ <b>Update Keeper</b>';
    }
    // stand on / climb the ramps + decks, with jumping (Space) and gravity
    const floorY = lobbyStand(pos.x, pos.z, pos.y - EYE) + EYE;
    if (keys.Space && !menuOpen && !updatesOpen && !classesOpen && !lockedIn && pos.y <= floorY + 0.06 && vy <= 0.01) { vy = 7.4; if (W.sfx && W.sfx.jump) W.sfx.jump(); }   // hop when grounded
    vy -= 24 / 60;                           // gravity (fixed ~60fps step)
    pos.y += vy / 60;
    if (pos.y <= floorY) { pos.y = floorY; vy = 0; }   // land, or ride ramps/decks up
    cam.position.set(pos.x, pos.y, pos.z);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  const onMove = (e) => { if (started || menuOpen || document.pointerLockElement !== canvas) return; yaw -= e.movementX * 0.0022; pitch = clamp(pitch - e.movementY * 0.0022, -1.4, 1.4); };
  const MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, ShiftLeft: 1, Space: 1 };
  const onDown = (e) => {
    if (started) return;
    // typing in the name box: let every key through (Enter finishes & submits)
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      if (e.code === 'Enter') { ae.blur(); } else { return; }
    }
    keys[e.code] = true;
    if (MOVE_KEYS[e.code]) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (countOpen && /^Digit[1-5]$/.test(e.code)) { e.stopImmediatePropagation(); pickCount(+e.code.slice(5)); return; }   // pick player count
    if (e.code === 'KeyJ' && lockedIn) { e.stopImmediatePropagation(); leaveParty(); return; }                            // J = leave the party / box
    if (countOpen && (e.code === 'Escape' || e.code === 'KeyB')) { e.stopImmediatePropagation(); leaveParty(); return; }
    if (e.code === 'KeyF' && !menuOpen) {                       // talk to the Update Keeper / Class Wolf / Lorekeeper
      if (updatesOpen) { e.stopImmediatePropagation(); closeUpdates(); }
      else if (classesOpen) { e.stopImmediatePropagation(); closeClasses(); }
      else if (chaptersOpen) { e.stopImmediatePropagation(); closeChapters(); }
      else if (talentsOpen) { e.stopImmediatePropagation(); closeTalents(); }
      else if (nearBandit) { e.stopImmediatePropagation(); openUpdates(); }
      else if (nearWolf) { e.stopImmediatePropagation(); openClasses(); }
      else if (nearScholar) { e.stopImmediatePropagation(); openChapters(); }
      else if (nearWere) { e.stopImmediatePropagation(); openTalents(); }
    } else if ((e.code === 'Escape' || e.code === 'KeyB') && talentsOpen) { e.stopImmediatePropagation(); closeTalents(); }
    else if ((e.code === 'Escape' || e.code === 'KeyB') && chaptersOpen) { e.stopImmediatePropagation(); closeChapters(); }
    else if ((e.code === 'Escape' || e.code === 'KeyB') && updatesOpen) { e.stopImmediatePropagation(); closeUpdates(); }
    else if ((e.code === 'Escape' || e.code === 'KeyB') && classesOpen) { e.stopImmediatePropagation(); if (classesView) { classesView = null; refreshClasses(); } else closeClasses(); }
    else if (e.code === 'Enter' && menuOpen) { e.stopImmediatePropagation(); confirmLook(); }   // Enter = confirm your look
    else if (e.code === 'Enter' && !menuOpen && !updatesOpen && !classesOpen && !countOpen && partyRunning) { beginParty(); }   // start now (skip the countdown)
  };
  const onUp = (e) => { keys[e.code] = false; };
  const onCanvasDown = () => { if (started || menuOpen || updatesOpen || classesOpen) return; if (document.pointerLockElement == null && canvas.requestPointerLock) canvas.requestPointerLock(); };

  function addControls() {
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp);
    canvas.addEventListener('mousedown', onCanvasDown);
    const ni = document.getElementById('nameInput');
    if (ni) ni.addEventListener('input', () => { if (W.classes && W.classes.setName) W.classes.setName(ni.value); if (classesOpen) refreshClasses(); });   // reveal the 🥚 secret class live as you type
  }

  function teardown() {
    if (started) return; started = true;
    cancelAnimationFrame(raf);
    if (W.net && W.net.leaveHub) W.net.leaveHub();   // drop the public lobby before the game's own co-op takes over
    document.removeEventListener('mousemove', onMove);
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp);
    if (canvas) canvas.removeEventListener('mousedown', onCanvasDown);
    try {
      if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); }); }
      if (hemi) scene.remove(hemi);
      if (sun) scene.remove(sun);
      if (hint) hint.remove();
      if (fPrompt) fPrompt.remove();
      if (timerEl) timerEl.remove();
      if (countEl) countEl.remove();
      if (updatesPanel) updatesPanel.remove();
      if (classesPanel) classesPanel.remove();
      if (chaptersPanel) chaptersPanel.remove();
      if (talentsPanel) talentsPanel.remove();
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
    const menu = document.getElementById('menu'); if (menu) menu.style.display = 'none';   // hidden until you enter a square
    // the pad panel is just look-customization now — starting happens via the portal/timer,
    // and the party size is picked in the top bar. Hide the launch/co-op controls.
    // (soloBtn stays in the DOM so startGame() can still click it programmatically.)
    ['soloBtn', 'hostBtn'].forEach((id) => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });
    const jr = document.querySelector('#menu .joinrow'); if (jr) jr.style.display = 'none';
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
      build(); makeHint(); makeFPrompt(); makeTimerUI(); makeCountPicker(); addControls(); slimOverlay(); openCustomise(); joinHub(); step();
    } catch (e) {
      // failsafe: never trap the player — restore the plain menu
      const menu = document.getElementById('menu'); if (menu) menu.style.display = '';
      const ov = document.getElementById('startOverlay'); if (ov) ov.classList.remove('lobby');
      const HUD = ['minimap', 'stats', 'res', 'hotbar', 'info', 'tpVillage', 'cross', 'ownBar'];
      HUD.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    }
  }, 150);
})();
