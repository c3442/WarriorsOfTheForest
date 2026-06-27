/* Upgrades system: a panel (open with O, number keys / tap to buy) that spends
   wood on player, weapon, base-defense and pet upgrades. Self-contained — runs
   its own effect loop (health regen, arrow turrets, fox fighters) and only needs
   two tiny guarded hooks in player.js (speedMult, bowDmgBonus). */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;

  // --- upgrade definitions ---
  // lvl-based ones store a level on player.up.<key>; cost rises with level.
  const UP = {
    vitality: { name: 'Vitality', emoji: '❤️', max: 5, cost: (l) => 15 + l * 12, blurb: 'faster health regen' },
    swift: { name: 'Swift Boots', emoji: '👟', max: 5, cost: (l) => 20 + l * 14, blurb: '+12% move speed' },
    tough: { name: 'Toughness', emoji: '🛡️', max: 5, cost: (l) => 18 + l * 14, blurb: '-15% damage taken' },
    pack: { name: 'Big Pack', emoji: '🎒', max: 4, cost: (l) => 18 + l * 12, blurb: '+3 berry & water' },
    sharp: { name: 'Sharp Arrows', emoji: '🏹', max: 6, cost: (l) => 14 + l * 9, blurb: '+2 arrow damage' },
    foxfight: { name: 'Fox Fighters', emoji: '🦊', max: 1, cost: () => 30, blurb: 'tamed foxes maul enemies' },
  };
  const ORDER = ['vitality', 'swift', 'tough', 'pack', 'sharp', 'foxfight'];   // 1..6, turret = 7

  function ensure() {
    const p = P(); if (!p) return null;
    if (!p.up) { p.up = { vitality: 0, swift: 0, tough: 0, pack: 0, sharp: 0, foxfight: 0 }; }
    return p;
  }

  function applyDerived() {
    const p = P(); if (!p || !p.up) return;
    p.speedMult = 1 + p.up.swift * 0.12;
    p.bowDmgBonus = p.up.sharp * 2;
  }

  // --- buy ---
  function buy(key) {
    const p = ensure(); if (!p) return;
    const def = UP[key]; const lvl = p.up[key];
    if (lvl >= def.max) { W.hud.toast(def.name + ' is maxed ✨'); return; }
    const c = def.cost(lvl);
    if (p.wood < c) { W.hud.toast('Need ' + c + ' wood (have ' + p.wood + ')'); return; }
    p.wood -= c; p.up[key] = lvl + 1;
    // immediate one-off effects
    if (key === 'tough') p.armor *= 0.85;                 // permanent 15% damage cut
    if (key === 'pack') { p.berryMax += 3; p.bottleMax += 3; }
    if (key === 'vitality') p.health = Math.min(100, p.health + 20);
    if (key === 'foxfight') p._foxFight = true;
    applyDerived();
    W.hud.toast(def.emoji + ' ' + def.name + ' → Lv ' + p.up[key] + '!');
    refresh();
  }
  function buyTurret() {
    const p = ensure(); if (!p) return;
    const cost = 40;
    if (p.wood < cost) { W.hud.toast('Need ' + cost + ' wood for a turret 🗼'); return; }
    p.wood -= cost;
    placeTurret();
    W.hud.toast('🗼 Arrow turret built!');
    refresh();
  }

  // --- arrow turret ---
  const turrets = [];
  function placeTurret() {
    const p = P(); const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const x = p.pos.x + (-sin) * 2.6, z = p.pos.z + (-cos) * 2.6;
    const gy = W.world.heightAt(x, z);
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1, flatShading: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8), wood); post.position.y = 0.65; post.castShadow = true; g.add(post);
    const head = new THREE.Group(); head.position.y = 1.35;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.5), dark); head.add(body);
    const bowMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 16, Math.PI), bowMat);
    limb.rotation.y = Math.PI / 2; limb.position.z = 0.24; head.add(limb);
    const dart = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 0.4 }));
    dart.rotation.x = Math.PI / 2; dart.position.z = 0.18; head.add(dart);
    g.add(head);
    g.position.set(x, gy, z); W.world.scene.add(g);
    W.world.colliders.push({ x, z, r: 0.4 });
    turrets.push({ group: g, head, x, z, y: gy + 1.35, cd: 0 });
  }

  // a quick fading tracer line from a -> b
  const tracers = [];
  function tracer(ax, ay, az, bx, by, bz, color) {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az); const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4),
      new THREE.MeshBasicMaterial({ color: color || 0xfff0a0, transparent: true, opacity: 0.9, fog: false }));
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    W.world.scene.add(m); tracers.push({ m, t: 0 });
  }

  // --- effect loop ---
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    const p = P();
    if (p && p.alive && p.active && dt > 0) {
      // Vitality: passive regen
      if (p.up && p.up.vitality > 0 && p.health < 100) p.health = Math.min(100, p.health + p.up.vitality * 1.4 * dt);
      // Arrow turrets: auto-fire at the nearest foe in range
      const foes = (W.enemies && W.enemies.list) || [];
      for (const t of turrets) {
        t.cd -= dt;
        let best = null, bd = 24;
        for (const e of foes) { if (!e.alive) continue; const d = Math.hypot(e.group.position.x - t.x, e.group.position.z - t.z); if (d < bd) { bd = d; best = e; } }
        if (best) {
          t.head.rotation.y = Math.atan2(best.group.position.x - t.x, best.group.position.z - t.z);
          if (t.cd <= 0) {
            t.cd = 1.1;
            const ep = best.group.position;
            tracer(t.x, t.y, t.z, ep.x, ep.y + 1.2, ep.z, 0xfff0a0);
            const killed = W.enemies.damage(best.group, 5, { x: t.x, z: t.z });
            if (p.popDamage) p.popDamage(ep, 5);
            if (killed && p.creditKill) p.creditKill(best.kind);
          }
        }
      }
      // Fox Fighters: tamed foxes maul nearby foes
      if (p._foxFight && W.critters && W.critters.list) {
        for (const c of W.critters.list) {
          if (!c.tamed) continue;
          c._fcd = (c._fcd || 0) - dt; if (c._fcd > 0) continue;
          const fp = c.group.position;
          for (const e of foes) {
            if (!e.alive) continue;
            if (Math.hypot(e.group.position.x - fp.x, e.group.position.z - fp.z) < 3.4) {
              c._fcd = 0.8;
              const killed = W.enemies.damage(e.group, 4, { x: fp.x, z: fp.z });
              if (p.popDamage) p.popDamage(e.group.position, 4);
              if (killed && p.creditKill) p.creditKill(e.kind);
              break;
            }
          }
        }
      }
    }
    // fade tracers
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i]; tr.t += dt; tr.m.material.opacity = Math.max(0, 0.9 - tr.t * 6);
      if (tr.t > 0.15) { W.world.scene.remove(tr.m); tr.m.material.dispose(); tracers.splice(i, 1); }
    }
  }
  requestAnimationFrame(loop);

  // --- panel UI ---
  const style = document.createElement('style');
  style.textContent = `
    #upPanel{position:fixed;right:16px;top:84px;width:300px;max-width:92vw;background:rgba(12,14,10,.82);
      border:1px solid #3c5a2c;border-radius:12px;padding:12px 14px;z-index:9;backdrop-filter:blur(2px);}
    #upPanel.hidden{display:none;}
    #upPanel .utitle{font-size:15px;color:#cfe8b6;font-weight:bold;margin-bottom:8px;letter-spacing:.5px;}
    #upPanel .utitle b{color:#ffce9a;}
    #upPanel .urow{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:rgba(0,0,0,.3);
      margin-bottom:6px;font-size:13px;color:#e7e0cf;cursor:pointer;}
    #upPanel .urow:active{background:rgba(120,160,90,.5);}
    #upPanel .urow .uk{width:18px;height:18px;line-height:18px;text-align:center;background:#3a4a2a;border-radius:4px;color:#dfeec8;font-size:11px;}
    #upPanel .urow .ue{font-size:18px;}
    #upPanel .urow .un{flex:1;}
    #upPanel .urow .un small{display:block;color:#9a9583;font-size:10px;}
    #upPanel .urow .ulv{color:#9adcff;font-size:11px;}
    #upPanel .urow .uc{color:#ffce9a;font-size:12px;}
    #upPanel .urow.maxed{opacity:.5;}
    #upPanel .uhint{color:#8fae74;font-size:11px;margin-top:4px;}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'upPanel'; panel.className = 'hidden';
  document.body.appendChild(panel);

  function rows() {
    const p = ensure(); if (!p) return '';
    let html = '<div class="utitle">⬆️ UPGRADES &nbsp;·&nbsp; Wood <b id="upWood">' + p.wood + '</b></div>';
    ORDER.forEach((key, i) => {
      const def = UP[key]; const lvl = p.up[key]; const maxed = lvl >= def.max;
      const cost = maxed ? '' : def.cost(lvl) + ' wood';
      html += '<div class="urow ' + (maxed ? 'maxed' : '') + '" data-key="' + key + '">' +
        '<span class="uk">' + (i + 1) + '</span><span class="ue">' + def.emoji + '</span>' +
        '<span class="un">' + def.name + '<small>' + def.blurb + '</small></span>' +
        '<span class="ulv">Lv ' + lvl + '/' + def.max + '</span><span class="uc">' + cost + '</span></div>';
    });
    html += '<div class="urow" data-key="turret"><span class="uk">7</span><span class="ue">🗼</span>' +
      '<span class="un">Arrow Turret<small>auto-fires at foes nearby</small></span><span class="uc">40 wood</span></div>';
    html += '<div class="uhint">press a number (or tap) to buy &nbsp;·&nbsp; <b>O</b> to close</div>';
    return html;
  }
  function refresh() { if (!panel.classList.contains('hidden')) panel.innerHTML = rows(); wire(); }
  function wire() {
    panel.querySelectorAll('.urow').forEach((r) => {
      if (r._w) return; r._w = true;
      const handler = (e) => { e.preventDefault(); const k = r.dataset.key; if (k === 'turret') buyTurret(); else buy(k); };
      r.addEventListener('click', handler);
      r.addEventListener('touchstart', handler, { passive: false });
    });
  }

  let open = false;
  function toggle(show) {
    open = (show == null) ? !open : show;
    if (open) { if (P()) { P().craftOpen = false; W.hud.toggleCraft && W.hud.toggleCraft(false); } panel.innerHTML = rows(); wire(); }
    panel.classList.toggle('hidden', !open);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') { toggle(); return; }
    if (open && /^Digit[1-7]$/.test(e.code)) {
      const n = +e.code.slice(5);
      if (n === 7) buyTurret(); else buy(ORDER[n - 1]);
    }
  });

  // mobile: add an "Upgrades" pill to the touch controls if present
  function addMobileButton() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mUp')) return;
    const b = document.createElement('div'); b.id = 'mUp'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '⬆️';
    const t = document.createElement('span'); t.textContent = 'Upgrade';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); }, { passive: false });
    acts.insertBefore(b, acts.firstChild);
  }
  setTimeout(addMobileButton, 800);
  setTimeout(addMobileButton, 2500);
})();
