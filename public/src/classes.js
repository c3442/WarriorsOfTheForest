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
      id: 'villager', name: 'Survivor', emoji: '🪓', cost: 0, free: true,
      blurb: 'The hardy woodsman — balanced stats, and a 50% chance to cheat death when killed.',
      perks: ['Balanced health & speed', '50% chance to revive on death ✨'],
      reviveChance: 0.5,
    },
    scout: {
      id: 'scout', name: 'Scout', emoji: '🏃', cost: 10,
      blurb: 'Light and quick — sees far across the woods, but fragile.',
      perks: ['+35% move speed', 'Sees much farther', 'Less health (60)'],
      speedMult: 1.35, spawnHealth: 60, sightMult: 1.6,
    },
    king: {
      id: 'king', name: 'King', emoji: '👑', cost: 500,
      blurb: 'Summon 50 loyal knights to fight for you. Regal but slow.',
      perks: ['Summons 50 knights that guard & fight for you', '−25% move speed', 'Commands the battlefield'],
      speedMult: 0.75, knights: 50,
    },
    hunter: {
      id: 'hunter', name: 'Hunter', emoji: '🔫', cost: 1000,
      blurb: 'Starts with a rifle and can tame wild bears with meat.',
      perks: ['Starts with a rifle (120 rounds)', 'Can tame bears 🐻', 'Taming meat drops from wolves'],
      rifle: 120, tameBears: true,
    },
    ranger: {
      id: 'ranger', name: 'Ranger', emoji: '🎯', cost: 250,
      blurb: 'A crack shot with a bottomless Desert Eagle and iron constitution.',
      perks: ['Desert Eagle with ∞ rounds (9,999,999)', '+100 max health (200 total)', 'Spawns locked & loaded'],
      spawnHealth: 200, deagle: 9999999,
    },
    juggernaut: {
      id: 'juggernaut', name: 'Juggernaut', emoji: '🔨', cost: 500,
      blurb: 'An unstoppable tank — crushes foes with a huge spiked mace and shrugs off almost anything, but heavy and slow.',
      perks: ['Starts with a spiked mace 🔨', '10,000 health — nearly unkillable', 'Heavy hits (50 dmg)', '−50% move speed'],
      spawnHealth: 10000, speedMult: 0.5, mace: true, attackDmg: 50,
    },
    ninja: {
      id: 'ninja', name: 'Ninja', emoji: '🥷', cost: 400,
      blurb: 'A blur of shadow — blindingly fast and deadly with shuriken, but frail.',
      perks: ['10× move speed', 'Throw ninja stars with F ⭐', 'Fragile — only 50 health'],
      spawnHealth: 50, speedMult: 10, ninja: true,
    },
    vampire: {
      id: 'vampire', name: 'Vampire', emoji: '🧛', cost: 75,
      blurb: 'Reaps souls with a lifesteal scythe — frail in daylight, monstrous at night.',
      perks: ['🌾 Vampire Scythe: slow, but hits for 250', '🩸 Lifesteal — heal for the damage you deal (5× at night)', '☀️ Day: 5,000 hp · 2× speed · burns in sun (−5 hp/sec)', '🌙 Night: 15,000 hp · 10× speed'],
      spawnHealth: 5000, speedMult: 2, attackDmg: 250, vampire: true, scythe: true,
    },
    kawaii: {
      id: 'kawaii', name: 'Kawaii Fighter', emoji: '💕', cost: 0, hidden: true,   // 🥚 secret: only appears if your name is Sophia
      blurb: 'A secret cupid warrior — endless love, and enemies who just can’t fight back. 💖',
      perks: ['💘 Cupid’s Bow — unlimited heart arrows', '💫 Heart arrows STUN foes for 2s', '💗 Hearts pop overhead & drop their defense 5s'],
      kawaii: true,
    },
    engineer: {
      id: 'engineer', name: 'Engineer', emoji: '🛠️', cost: 2500,
      blurb: 'Master of defense — your base loads in pre-fortified with barbed wire, spikes and auto-sentries.',
      perks: ['Base pre-built with barbed wire & spikes', 'Auto-firing sentry turrets 🗼', 'All defenses are walk-through for you'],
      engineer: true,
    },
    lumberjack: {
      id: 'lumberjack', name: 'Lumberjack', emoji: '🪓', cost: 150,
      blurb: 'A burly woodsman whose axe is an absolute monster — it one-shots most foes and fells trees in a single swing.',
      perks: ['Starts with an OP mega-axe 🪓', 'Massive melee damage (one-shots most foes)', 'Fells any tree in one hit'],
      axe: true, attackDmg: 500, axeLevel: 40,
    },
  };
  const ORDER = ['lumberjack', 'vampire', 'scout', 'ninja', 'ranger', 'juggernaut', 'engineer', 'king', 'hunter'];   // the shop list (villager is the free default)

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

  // start with no coins — earn them all by killing bandits (5 kills = 1 coin)
  if (LS.getItem(KEY_COINS) == null) LS.setItem(KEY_COINS, '0');

  const classes = (W.classes = {
    DEFS, ORDER,
    coins() { return OWNER ? 999999999 : num(KEY_COINS, 0); },   // owner: effectively infinite
    setCoins(n) { LS.setItem(KEY_COINS, String(Math.max(0, n | 0))); },
    addCoins(n) { const v = classes.coins() + (n | 0); classes.setCoins(v); return v; },
    owned(id) { return id === 'villager' || (id === 'kawaii' && isSophia()) || ownedSet().has(id); },   // Kawaii is free for Sophia
    setName(n) { curName = n || ''; },                 // lobby feeds the live name box here
    secretUnlocked() { return isSophia(); },           // true only while the typed/play name is Sophia
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
    selected() { const s = LS.getItem(KEY_SEL); if (s === 'kawaii' && !isSophia()) return 'villager'; return s && DEFS[s] ? s : 'villager'; },
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
      p.knightSummons = d.knights || 0;
      p.treelingCoins = classes.coins();   // seed the in-game counter from the saved wallet
      if (OWNER) p.wood = 999999999999999999999999999999999999;   // maker perk: effectively infinite wood
      p.reviveChance = d.reviveChance || 0;         // Survivor: chance to cheat death
      p.isEngineer = !!d.engineer;                  // Engineer: fortify the base on spawn
      // --- level scaling: Lv2/Lv3 make the class way better ---
      const lvl = classes.level(d.id); p.classLevel = lvl;
      if (lvl > 1) {
        const hb = lvl === 2 ? 1.8 : 3.2;           // health & summon boost
        const sb = lvl === 2 ? 1.3 : 1.7;           // speed boost
        p.maxHealth = Math.round(p.maxHealth * hb); p.health = p.maxHealth;
        if (p.speedMult) p.speedMult *= sb;
        if (p.knightSummons) p.knightSummons = Math.round(p.knightSummons * hb);
        if (p.rounds) p.rounds = Math.round(p.rounds * hb);
        if (p.reviveChance) p.reviveChance = Math.min(1, p.reviveChance + (lvl - 1) * 0.22);
        if (p.attackDmg) p.attackDmg = Math.round(p.attackDmg * (lvl === 2 ? 1.6 : 2.5));
      }
      if (p.isVampire) { const vm = lvl === 1 ? 1 : (lvl === 2 ? 1.8 : 3.2); p._vampDayHp = Math.round(5000 * vm); p._vampNightHp = Math.round(15000 * vm); }
      return d;
    },
  });
})();
