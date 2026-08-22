/* Classes & Treeling Coins — a small persistent progression shared by the lobby
   CLASSES tree house (the wolf shop) and the game itself. Earn treeling coins by
   killing foes; spend them in the lobby to unlock a class. The selected class
   tweaks your stats & kit when you play. All state lives in localStorage. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const LS = window.localStorage;
  const KEY_COINS = 'wotf_treelings', KEY_OWNED = 'wotf_classes', KEY_SEL = 'wotf_class', KEY_LVLS = 'wotf_classlvls';
  let OWNER = false; try { OWNER = LS.getItem('wotf_owner') === 'lin8up'; } catch (e) {}   // the maker has infinite coins

  // Class definitions. `villager` is the free default everyone starts with.
  const DEFS = {
    villager: {
      id: 'villager', stars: 2, name: 'Survivor', emoji: '🪓', cost: 0, free: true,
      blurb: 'The hardy woodsman — balanced stats, and a 50% chance to cheat death when killed.',
      perks: ['Balanced health & speed', '50% chance to revive on death ✨'],
      reviveChance: 0.5,
    },
    scout: {
      id: 'scout', stars: 1, name: 'Scout', emoji: '🏃', cost: 10,
      blurb: 'Light and quick — sees far across the woods, but fragile.',
      perks: ['+35% move speed', 'Sees much farther', 'Less health (60)'],
      speedMult: 1.35, spawnHealth: 60, sightMult: 1.6,
    },
    king: {
      id: 'king', stars: 3, name: 'King', emoji: '👑', cost: 500,
      blurb: 'Summon 50 loyal knights to fight for you. Regal but slow.',
      perks: ['Summons 50 knights that guard & fight for you', '−25% move speed', 'Commands the battlefield'],
      speedMult: 0.75, knights: 50,
    },
    hunter: {
      id: 'hunter', stars: 5, name: 'Hunter', emoji: '🔫', cost: 2500,
      blurb: 'A beastmaster marksman — commands alpha wolves & falcons, and rarely wastes a bullet.',
      perks: ['Starts with a rifle (120 rounds)', '🐺 Starts with an ALPHA WOLF (5× a normal wolf) — +1 per 5 wolf kills', '🦅 +1 Falcon every night you survive (dive-bombs foes)', '🎯 Lv2: 50% chance to recover the bullet on a hit', 'Can still tame bears 🐻'],
      rifle: 120, tameBears: true, hunterPets: true,
    },
    ranger: {
      id: 'ranger', stars: 3, name: 'Ranger', emoji: '🎯', cost: 250,
      blurb: 'A crack shot with a bottomless Desert Eagle and iron constitution.',
      perks: ['Desert Eagle with ∞ rounds (9,999,999)', '+100 max health (200 total)', 'Spawns locked & loaded'],
      spawnHealth: 200, deagle: 9999999,
    },
    juggernaut: {
      id: 'juggernaut', stars: 4, name: 'Juggernaut', emoji: '🔨', cost: 1000,
      blurb: 'An unstoppable tank — crushes foes with a huge spiked mace and shrugs off almost anything, but heavy and slow.',
      perks: ['Starts with a spiked mace 🔨', '10,000 health — nearly unkillable', 'Heavy hits (50 dmg)', '−50% move speed'],
      spawnHealth: 10000, speedMult: 0.5, mace: true, attackDmg: 50,
    },
    ninja: {
      id: 'ninja', stars: 4, name: 'Ninja', emoji: '🥷', cost: 1000,
      blurb: 'A blur of shadow — blindingly fast and deadly with shuriken, but frail.',
      perks: ['10× move speed', 'Throw ninja stars with F ⭐', 'Fragile — only 50 health'],
      spawnHealth: 50, speedMult: 10, ninja: true,
    },
    vampire: {
      id: 'vampire', stars: 4, name: 'Vampire', emoji: '🧛', cost: 1000,
      blurb: 'Reaps souls with a lifesteal scythe — frail in daylight, monstrous at night.',
      perks: ['🌾 Vampire Scythe: slow, but hits for 250', '🩸 Lifesteal — heal for the damage you deal (5× at night)', '☀️ Day: 5,000 hp · 2× speed · burns in sun (−100 hp/sec)', '🌙 Night: 15,000 hp · 10× speed'],
      spawnHealth: 5000, speedMult: 2, attackDmg: 250, vampire: true, scythe: true,
    },
    kawaii: {
      id: 'kawaii', stars: 5, name: 'Kawaii Fighter', emoji: '💕', cost: 0, hidden: true,   // 🥚 secret: only appears if your name is Sophia
      blurb: 'A secret cupid warrior — endless love, and enemies who just can’t fight back. 💖',
      perks: ['💘 Cupid’s Bow — unlimited heart arrows', '💫 Heart arrows STUN foes for 2s', '💗 Hearts pop overhead & drop their defense 5s'],
      kawaii: true,
    },
    catmaster: {
      id: 'catmaster', stars: 5, name: 'Cat Master', emoji: '🐱', cost: 0, hidden: true,   // 🥚 secret: only appears if your name is Vivian
      blurb: 'A secret feline commander — press K to conjure cats. Every cat makes you hit harder… but they’re fragile. 🐾',
      perks: ['🐱 Press K to spawn a cat (5s cooldown)', '💪 The more cats you have, the stronger you hit', '💔 Cats are fragile — foes one-shot them'],
      catmaster: true,
    },
    engineer: {
      id: 'engineer', stars: 4, name: 'Engineer', emoji: '🛠️', cost: 1000,
      blurb: 'Master of defense — your base loads in pre-fortified with barbed wire, spikes and auto-sentries.',
      perks: ['Base pre-built with barbed wire & spikes', 'Auto-firing sentry turrets 🗼', 'All defenses are walk-through for you'],
      engineer: true,
    },
    president: {
      id: 'president', stars: 5, name: 'President', emoji: '🎩', cost: 5000,
      blurb: 'Commands 50 loyal soldiers and rules from a heavily-fortified base — the ultimate commander.',
      perks: ['🪖 50 soldiers march & fight for you', '🏰 Base loads in fully fortified — barbed wire, spikes & auto-sentries', 'Press 0 to command your troops'],
      knights: 50, engineer: true,
    },
    ares: {
      id: 'ares', stars: 5, name: 'Ares', emoji: '⚔️', cost: 5000,
      blurb: 'The God of War — 10,000 health, grows stronger with every kill, and marshals an endless Spartan phalanx that fights, shields and knocks foes flying.',
      perks: ['⚔️ 10,000 health', '💪 Every kill makes your strikes stronger', '🛡️ Spartans: 150 hp · 50 spear dmg · shield · knockback ✨', '🔺 +1 Spartan per kill — up to 500 strong'],
      spawnHealth: 10000, ares: true, spartans: 500, attackDmg: 120,
    },
    lumberjack: {
      id: 'lumberjack', stars: 3, name: 'Lumberjack', emoji: '🪓', cost: 250,
      blurb: 'A burly woodsman whose axe is an absolute monster — it one-shots most foes and fells trees in a single swing.',
      perks: ['Starts with an OP mega-axe 🪓', 'Massive melee damage (one-shots most foes)', 'Fells any tree in one hit'],
      axe: true, attackDmg: 500, axeLevel: 40,
    },
  };
  const ORDER = ['lumberjack', 'vampire', 'scout', 'ninja', 'ranger', 'juggernaut', 'engineer', 'king', 'hunter', 'president', 'ares'];   // the shop list (villager is the free default)

  function num(k, d) { const v = parseInt(LS.getItem(k), 10); return isNaN(v) ? d : v; }
  function ownedSet() { try { return new Set(JSON.parse(LS.getItem(KEY_OWNED) || '[]')); } catch (e) { return new Set(); } }
  function saveOwned(s) { LS.setItem(KEY_OWNED, JSON.stringify([...s])); }

  // 🥚 secret class gate: the Kawaii Fighter only exists for players named "Sophia".
  // `curName` tracks the name being typed in the lobby; falls back to the play name.
  let curName = '';
  function isSophia(name) {
    const nm = (name != null ? name : (curName || (W.net && W.net.myName) || '')).toString().trim().toLowerCase();
    return nm === 'sophia';
  }
  // 🥚 second secret: the Cat Master only exists for players named "Vivian".
  function isVivian(name) {
    const nm = (name != null ? name : (curName || (W.net && W.net.myName) || '')).toString().trim().toLowerCase();
    return nm === 'vivian';
  }

  // start with no coins — earn them all by killing bandits (5 kills = 1 coin)
  if (LS.getItem(KEY_COINS) == null) LS.setItem(KEY_COINS, '0');

  const classes = (W.classes = {
    DEFS, ORDER,
    coins() { return OWNER ? 999999999 : num(KEY_COINS, 0); },   // owner: effectively infinite
    setCoins(n) { LS.setItem(KEY_COINS, String(Math.max(0, n | 0))); },
    addCoins(n) { const v = classes.coins() + (n | 0); classes.setCoins(v); return v; },
    owned(id) { return id === 'villager' || (id === 'kawaii' && isSophia()) || (id === 'catmaster' && isVivian()) || ownedSet().has(id); },   // secret classes are free for the right name
    setName(n) { curName = n || ''; },                 // lobby feeds the live name box here
    secretUnlocked() { return isSophia() || isVivian(); },   // any secret unlocked by the current name
    secretList() { const o = []; if (isSophia()) o.push('kawaii'); if (isVivian()) o.push('catmaster'); return o; },   // which secret ids the current name unlocks
    // --- class levels: Lv1 base, Lv2 = 2x price, Lv3 = 5x price, each way stronger ---
    level(id) { let m; try { m = JSON.parse(LS.getItem(KEY_LVLS) || '{}'); } catch (e) { m = {}; } return Math.max(1, Math.min(3, m[id] || 1)); },
    upgradeCost(id) { const d = DEFS[id]; if (!d) return null; const lv = classes.level(id); if (lv >= 3) return null; const base = d.cost || 100; return base * (lv === 1 ? 2 : 5); },
    upgrade(id) {
      const d = DEFS[id]; if (!d) return { ok: false, reason: 'unknown' };
      if (!classes.owned(id)) return { ok: false, reason: 'notowned' };
      const lv = classes.level(id); if (lv >= 3) return { ok: false, reason: 'maxed' };
      const cost = classes.upgradeCost(id), c = classes.coins();
      if (c < cost) return { ok: false, reason: 'poor', need: cost - c };
      classes.setCoins(c - cost);
      let m; try { m = JSON.parse(LS.getItem(KEY_LVLS) || '{}'); } catch (e) { m = {}; }
      m[id] = lv + 1; LS.setItem(KEY_LVLS, JSON.stringify(m));
      return { ok: true, level: lv + 1 };
    },
    selected() { const s = LS.getItem(KEY_SEL); if (s === 'kawaii' && !isSophia()) return 'villager'; if (s === 'catmaster' && !isVivian()) return 'villager'; return s && DEFS[s] ? s : 'villager'; },
    select(id) { if (classes.owned(id)) { LS.setItem(KEY_SEL, id); return true; } return false; },
    // Try to buy a class. Returns {ok, reason, need}.
    buy(id) {
      const d = DEFS[id]; if (!d) return { ok: false, reason: 'unknown' };
      if (classes.owned(id)) { classes.select(id); return { ok: true, already: true }; }
      const c = classes.coins();
      if (c < d.cost) return { ok: false, reason: 'poor', need: d.cost - c };
      classes.setCoins(c - d.cost);
      const s = ownedSet(); s.add(id); saveOwned(s); classes.select(id);
      return { ok: true };
    },
    // Apply the selected class to a freshly-initialised player object.
    applyToPlayer(p) {
      let d = DEFS[classes.selected()];
      if (d && d.kawaii && !isSophia(W.net && W.net.myName)) d = DEFS.villager;   // 🥚 never leak the secret to a non-Sophia
      if (d && d.catmaster && !isVivian(W.net && W.net.myName)) d = DEFS.villager;   // 🥚 never leak the secret to a non-Vivian
      if (!d || !p) return null;
      p.playerClass = d.id;
      p.speedMult = d.speedMult || 1;
      p.sightMult = d.sightMult || 1;
      p.maxHealth = d.spawnHealth || 100;
      if (d.spawnHealth) p.health = d.spawnHealth;
      if (d.rifle) { p.hasRifle = true; p.rounds = d.rifle; }
      if (d.deagle) { p.hasDeagle = true; p.deagleRounds = d.deagle; }   // Ranger: bottomless Deagle
      if (d.katana) { p.hasKatana = true; p.currentWeapon = 'katana'; }  // (legacy) starts with a katana
      if (d.mace) { p.hasMace = true; p.currentWeapon = 'mace'; }        // Juggernaut: starts with a spiked mace
      if (d.scythe) { p.hasScythe = true; p.currentWeapon = 'scythe'; }  // Vampire: soul-reaping scythe
      p.isVampire = !!d.vampire;
      p.isKawaii = !!d.kawaii;
      p.isCatMaster = !!d.catmaster;   // 🐱 secret: K spawns cats that buff you
      if (d.kawaii) {                                                     // Kawaii Fighter: Cupid's Bow + endless heart arrows
        p.hasBow = true; p.currentWeapon = 'bow'; p.arrowCount = 999999;
        p.bowColor = 0xff5aa0; p.arrowColor = 0xff4f97;
        if (p.bowLimbMat) p.bowLimbMat.color.setHex(0xff5aa0);
        if (p.bowArrowMat) p.bowArrowMat.color.setHex(0xff4f97);
      }
      if (d.axe) { p.hasAxe = true; p.currentWeapon = 'axe'; }           // Lumberjack: starts with the axe
      if (d.attackDmg) p.attackDmg = d.attackDmg;                        // OP melee damage
      if (d.axeLevel) p.axeLevel = d.axeLevel;                           // fells trees fast
      p.canTameBears = !!d.tameBears;
      p.isHunter = !!d.hunterPets;                  // Hunter: alpha-wolf pack + falcons + bullet recovery
      p.knightSummons = d.knights || 0;
      p.treelingCoins = classes.coins();   // seed the in-game counter from the saved wallet
      if (OWNER) p.wood = 999999999999999999999999999999999999;   // maker perk: effectively infinite wood
      p.reviveChance = d.reviveChance || 0;         // Survivor: chance to cheat death
      p.isEngineer = !!d.engineer;                  // Engineer: fortify the base on spawn
      p.isAres = !!d.ares;                          // Ares: war-god who grows per kill + Spartan phalanx
      p.spartanCap = d.spartans || 0;              // max Spartans Ares can field
      // --- level scaling: Lv2/Lv3 make the class way better ---
      const lvl = classes.level(d.id); p.classLevel = lvl;
      if (lvl > 1) {
        const hb = lvl === 2 ? 1.8 : 3.2;           // health & summon boost
        const sb = lvl === 2 ? 1.3 : 1.7;           // speed boost
        p.maxHealth = Math.round(p.maxHealth * hb); p.health = p.maxHealth;
        if (p.speedMult) p.speedMult *= sb;
        if (p.knightSummons) p.knightSummons = Math.round(p.knightSummons * hb);
        if (p.spartanCap) p.spartanCap = Math.round(p.spartanCap * hb);
        if (p.rounds) p.rounds = Math.round(p.rounds * hb);
        if (p.reviveChance) p.reviveChance = Math.min(1, p.reviveChance + (lvl - 1) * 0.22);
        if (p.attackDmg) p.attackDmg = Math.round(p.attackDmg * (lvl === 2 ? 1.6 : 2.5));
      }
      if (p.isVampire) { const vm = lvl === 1 ? 1 : (lvl === 2 ? 1.8 : 3.2); p._vampDayHp = Math.round(5000 * vm); p._vampNightHp = Math.round(15000 * vm); }
      return d;
    },
  });
})();
