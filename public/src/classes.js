/* Classes & Treeling Coins — a small persistent progression shared by the lobby
   CLASSES tree house (the wolf shop) and the game itself. Earn treeling coins by
   killing foes; spend them in the lobby to unlock a class. The selected class
   tweaks your stats & kit when you play. All state lives in localStorage. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const LS = window.localStorage;
  const KEY_COINS = 'wotf_treelings', KEY_OWNED = 'wotf_classes', KEY_SEL = 'wotf_class';

  // Class definitions. `villager` is the free default everyone starts with.
  const DEFS = {
    villager: {
      id: 'villager', name: 'Villager', emoji: '🪓', cost: 0, free: true,
      blurb: 'The plain woodsman — balanced stats, starts with an axe.',
      perks: ['Balanced health & speed'],
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
    samurai: {
      id: 'samurai', name: 'Samurai', emoji: '🗡️', cost: 500,
      blurb: 'An armoured swordmaster — starts with a katana and 10,000 health, but heavy and slow.',
      perks: ['Starts with a katana 🗡️', '10,000 health — nearly unkillable', '−50% move speed'],
      spawnHealth: 10000, speedMult: 0.5, katana: true,
    },
    ninja: {
      id: 'ninja', name: 'Ninja', emoji: '🥷', cost: 400,
      blurb: 'A blur of shadow — blindingly fast and deadly with shuriken, but frail.',
      perks: ['5× move speed', 'Throw ninja stars with F ⭐', 'Fragile — only 50 health'],
      spawnHealth: 50, speedMult: 5, ninja: true,
    },
    lumberjack: {
      id: 'lumberjack', name: 'Lumberjack', emoji: '🪓', cost: 150,
      blurb: 'A burly woodsman whose axe is an absolute monster — it one-shots most foes and fells trees in a single swing.',
      perks: ['Starts with an OP mega-axe 🪓', 'Massive melee damage (one-shots most foes)', 'Fells any tree in one hit'],
      axe: true, attackDmg: 500, axeLevel: 40,
    },
  };
  const ORDER = ['lumberjack', 'scout', 'ninja', 'ranger', 'samurai', 'king', 'hunter'];   // the shop list (villager is the free default)

  function num(k, d) { const v = parseInt(LS.getItem(k), 10); return isNaN(v) ? d : v; }
  function ownedSet() { try { return new Set(JSON.parse(LS.getItem(KEY_OWNED) || '[]')); } catch (e) { return new Set(); } }
  function saveOwned(s) { LS.setItem(KEY_OWNED, JSON.stringify([...s])); }

  // first run: seed a small stash so the Scout is affordable right away
  if (LS.getItem(KEY_COINS) == null) LS.setItem(KEY_COINS, '30');

  const classes = (W.classes = {
    DEFS, ORDER,
    coins() { return num(KEY_COINS, 0); },
    setCoins(n) { LS.setItem(KEY_COINS, String(Math.max(0, n | 0))); },
    addCoins(n) { const v = classes.coins() + (n | 0); classes.setCoins(v); return v; },
    owned(id) { return id === 'villager' || ownedSet().has(id); },
    selected() { const s = LS.getItem(KEY_SEL); return s && DEFS[s] ? s : 'villager'; },
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
      const d = DEFS[classes.selected()]; if (!d || !p) return null;
      p.playerClass = d.id;
      p.speedMult = d.speedMult || 1;
      p.sightMult = d.sightMult || 1;
      p.maxHealth = d.spawnHealth || 100;
      if (d.spawnHealth) p.health = d.spawnHealth;
      if (d.rifle) { p.hasRifle = true; p.rounds = d.rifle; }
      if (d.deagle) { p.hasDeagle = true; p.deagleRounds = d.deagle; }   // Ranger: bottomless Deagle
      if (d.katana) { p.hasKatana = true; p.currentWeapon = 'katana'; }  // Samurai: starts with a katana
      if (d.axe) { p.hasAxe = true; p.currentWeapon = 'axe'; }           // Lumberjack: starts with the axe
      if (d.attackDmg) p.attackDmg = d.attackDmg;                        // OP melee damage
      if (d.axeLevel) p.axeLevel = d.axeLevel;                           // fells trees fast
      p.canTameBears = !!d.tameBears;
      p.knightSummons = d.knights || 0;
      p.treelingCoins = classes.coins();   // seed the in-game counter from the saved wallet
      return d;
    },
  });
})();
