/* Wild critters you can tame. Foxes wander the forest; feed one a berry (T) to
   tame it, and it follows you and bites enemies at night. */
(function () {
  const W = (window.WOTF = window.WOTF || {});
  const U = W.util;
  const C = W.CONFIG;

  const critters = { list: [], scene: null, _t: 0 };

  function makeFox() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xd9742f, roughness: 1, flatShading: true });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.7), fur);
    body.position.y = 0.34; body.castShadow = true; g.add(body);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), white);
    chest.position.set(0, 0.28, 0.28); g.add(chest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.26), fur);
    head.position.set(0, 0.46, 0.42); head.castShadow = true; g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14), white);
    snout.position.set(0, 0.42, 0.58); g.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), dark);
    nose.position.set(0, 0.43, 0.66); g.add(nose);
    for (const sx of [-0.09, 0.09]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.13, 4), fur);
      ear.position.set(sx, 0.63, 0.4); g.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), dark);
      eye.position.set(sx * 0.7, 0.5, 0.55); g.add(eye);
    }
    const legGeo = new THREE.BoxGeometry(0.08, 0.26, 0.08);
    const legs = [];
    for (const [lx, lz] of [[-0.12, 0.22], [0.12, 0.22], [-0.12, -0.22], [0.12, -0.22]]) {
      const leg = new THREE.Mesh(legGeo, dark);
      leg.position.set(lx, 0.13, lz); leg.castShadow = true; g.add(leg); legs.push(leg);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.34), fur);
    tail.position.set(0, 0.4, -0.42); tail.rotation.x = 0.5; g.add(tail);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), white);
    tip.position.set(0, 0.47, -0.58); g.add(tip);

    g.userData = { legs };
    return g;
  }

  function spawnFox() {
    let p = U.pointInDisc(C.WORLD_RADIUS * 0.85);
    let guard = 0;
    while (U.dist2(p.x, p.z, 0, 0) < 16 && guard++ < 12) p = U.pointInDisc(C.WORLD_RADIUS * 0.85);
    const g = makeFox();
    g.position.set(p.x, W.world.heightAt(p.x, p.z), p.z);
    g.rotation.y = U.rand(0, Math.PI * 2);
    critters.scene.add(g);
    critters.list.push({ group: g, tamed: false, t: U.rand(0, 10), nextWander: 0, heading: 0, moveT: false, lastBite: -99 });
  }

  // A batch of fresh wild foxes — called each morning.
  critters.spawnMorning = function (n) { for (let i = 0; i < n; i++) spawnFox(); };

  critters.init = function (scene) { critters.scene = scene; critters.spawnMorning(6); };

  // Wild (untamed) foxes hide away at nightfall; tamed companions stay with you.
  critters.clearWild = function () {
    for (const c of critters.list.slice()) {
      if (!c.tamed) { critters.scene.remove(c.group); critters.list.splice(critters.list.indexOf(c), 1); }
    }
  };

  // Press T near a wild fox (costs a berry) to tame it.
  critters.tryTame = function (pos) {
    let best = null, bestD = 3.5;
    for (const c of critters.list) {
      if (c.tamed) continue;
      const d = U.dist2(pos.x, pos.z, c.group.position.x, c.group.position.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) { W.hud.toast('No wild fox nearby'); return; }
    if (W.player.berries <= 0) { W.hud.toast('Need a berry to tame 🍓'); return; }
    W.player.berries -= 1;
    if (W.player.heldBerry) W.player.heldBerry.visible = W.player.berries > 0;
    best.tamed = true;
    W.hud.toast('Tamed a fox! 🦊 It follows you now');
  };

  function gait(c, on) {
    if (!on) return;
    const sw = Math.sin(c.t * 12) * 0.5;
    const L = c.group.userData.legs;
    L[0].rotation.x = sw; L[3].rotation.x = sw;
    L[1].rotation.x = -sw; L[2].rotation.x = -sw;
  }

  critters.update = function (dt, playerPos, isNight) {
    critters._t += dt;
    for (const c of critters.list) {
      c.t += dt;
      const g = c.group;
      let moving = false;

      if (c.tamed) {
        // hunt the nearest enemy at night, otherwise stay near the player
        let foe = null, fd = 7;
        if (isNight && W.enemies) {
          for (const e of W.enemies.list) {
            if (!e.alive) continue;
            const ed = Math.hypot(e.group.position.x - g.position.x, e.group.position.z - g.position.z);
            if (ed < fd) { fd = ed; foe = e; }
          }
        }
        if (foe) {
          const ex = foe.group.position.x - g.position.x, ez = foe.group.position.z - g.position.z;
          const ed = Math.hypot(ex, ez) || 1;
          g.rotation.y = Math.atan2(ex, ez);
          if (ed > 1.0) { g.position.x += (ex / ed) * 4.2 * dt; g.position.z += (ez / ed) * 4.2 * dt; moving = true; }
          else if (c.t - c.lastBite > 0.7) { c.lastBite = c.t; W.enemies.damage(foe.group, 1, g.position); }
        } else {
          const dx = playerPos.x - g.position.x, dz = playerPos.z - g.position.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > 2.5) { g.position.x += (dx / d) * 3.6 * dt; g.position.z += (dz / d) * 3.6 * dt; g.rotation.y = Math.atan2(dx, dz); moving = true; }
        }
      } else {
        // wild: flee from the player, otherwise wander
        const dpl = Math.hypot(playerPos.x - g.position.x, playerPos.z - g.position.z);
        if (dpl < 4.5) {
          const fx = g.position.x - playerPos.x, fz = g.position.z - playerPos.z, fdist = Math.hypot(fx, fz) || 1;
          g.position.x += (fx / fdist) * 3.0 * dt; g.position.z += (fz / fdist) * 3.0 * dt;
          g.rotation.y = Math.atan2(fx, fz); moving = true;
        } else {
          if (critters._t > c.nextWander) { c.nextWander = critters._t + U.rand(1.5, 4); c.heading = U.rand(0, Math.PI * 2); c.moveT = U.rand(0, 1) < 0.6; }
          if (c.moveT) { g.position.x += Math.cos(c.heading) * 1.3 * dt; g.position.z += Math.sin(c.heading) * 1.3 * dt; g.rotation.y = c.heading; moving = true; }
        }
      }

      if (moving) {
        const tmp = { x: g.position.x, z: g.position.z };
        W.world.resolveCollision(tmp, 0.3);
        g.position.x = tmp.x; g.position.z = tmp.z;
      }
      g.position.y = W.world.heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(c.t * 11)) * 0.03;
      gait(c, moving);
    }
  };

  W.critters = critters;
})();
