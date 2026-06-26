/* Shared helpers + config. Attaches to the global WOTF namespace. */
(function () {
  const W = (window.WOTF = window.WOTF || {});

  W.CONFIG = {
    WORLD_RADIUS: 1000,    // playable area radius (meters) — huge world, epic treks
    TREE_COUNT: 3400,
    ROCK_COUNT: 320,
    BUSH_COUNT: 620,
    EYE_HEIGHT: 1.7,
    DAY_LENGTH: 420,       // full cycle: ~5 min day + ~2 min night
    PLAYER_RADIUS: 0.45,
    WATER_LEVEL: -2.0,     // terrain below this fills with water
  };

  // Seedable PRNG (mulberry32) so every player generates the IDENTICAL world.
  // Until seeded it falls back to Math.random (solo play that hasn't seeded yet).
  let _seeded = false;
  let _state = 0;
  function _random() {
    if (!_seeded) return Math.random();
    _state = (_state + 0x6D2B79F5) | 0;
    let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  W.util = {
    clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },
    lerp(a, b, t) { return a + (b - a) * t; },
    seed(n) { _state = n >>> 0; _seeded = true; },   // call before world.init for shared worlds
    random: _random,
    rand(a, b) { return a + _random() * (b - a); },
    randInt(a, b) { return Math.floor(a + _random() * (b - a + 1)); },
    chance(p) { return _random() < p; },
    // smooth 0..1 ramp
    smooth(t) { return t * t * (3 - 2 * t); },
    // distance on the XZ plane
    dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },
    // pick a random point within a radius (roughly uniform)
    pointInDisc(radius) {
      const r = radius * Math.sqrt(_random());
      const a = _random() * Math.PI * 2;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    },
    // lerp between two hex colors -> THREE.Color
    mixColor(hexA, hexB, t) {
      const a = new THREE.Color(hexA);
      const b = new THREE.Color(hexB);
      return a.lerp(b, W.util.clamp(t, 0, 1));
    },
  };
})();
