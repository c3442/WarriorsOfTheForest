/* DOM HUD: stat bars, info, banners, damage flash, overlays, toasts. */
(function () {
  const W = (window.WOTF = window.WOTF || {});

  const $ = (id) => document.getElementById(id);
  const els = {};
  const hud = {};

  hud.init = function () {
    ['hp', 'st', 'fd', 'th', 'todIcon', 'todLabel', 'dayNum', 'foeNum', 'woodNum', 'waterNum', 'berryNum', 'bandaidNum', 'killNum',
     'banner', 'flash', 'startOverlay', 'pauseOverlay', 'deadOverlay', 'deadStats',
     'craftPanel', 'craftWood', 'crow3', 'crow6', 'crow7', 'axeLv', 'axeCost', 'keyHelp',
     'weaponIc', 'slotShell', 'shellNum',
     'invPanel', 'invWood', 'invBerries', 'invBandaids', 'invWater', 'invAxe', 'invShells',
     'invSwordSlot', 'invArmorSlot', 'invShieldSlot', 'invShotgunSlot',
     'sleepOverlay', 'sleepCount', 'sleepWait', 'buildHint', 'buildHintName', 'minimap',
     'startBtn', 'resumeBtn', 'retryBtn'].forEach((id) => { els[id] = $(id); });
    if (els.sleepOverlay) {
      els.sleepOverlay.querySelectorAll('[data-hug]').forEach((b) => {
        b.onclick = () => W.player.hug(b.dataset.hug);
      });
    }
    els.hpFill = els.hp.querySelector('i');
    els.stFill = els.st.querySelector('i');
    els.fdFill = els.fd.querySelector('i');
    els.thFill = els.th.querySelector('i');
  };

  hud.update = function (s) {
    els.hpFill.style.width = s.health + '%';
    els.stFill.style.width = s.stamina + '%';
    els.fdFill.style.width = s.hunger + '%';
    els.thFill.style.width = s.thirst + '%';
    els.waterNum.textContent = s.bottle + '/' + s.bottleMax;
    els.berryNum.textContent = s.berries + '/' + s.berryMax;
    if (els.bandaidNum) els.bandaidNum.textContent = s.bandaids;
    if (els.craftWood) els.craftWood.textContent = s.wood;   // keep craft panel wood live
    els.todIcon.textContent = s.night ? '🌙' : '☀️';
    els.todLabel.textContent = s.night ? 'Night' : 'Day';
    els.dayNum.textContent = s.day;
    els.foeNum.textContent = s.foes;
    els.woodNum.textContent = s.wood;
    els.killNum.textContent = s.kills;
    // hotbar weapon + shells
    if (els.weaponIc) els.weaponIc.textContent = { axe: '🪓', sword: '⚔️', shotgun: '🔫' }[W.player.currentWeapon] || '🪓';
    if (els.slotShell) els.slotShell.classList.toggle('hidden', !W.player.hasShotgun);
    if (els.shellNum) els.shellNum.textContent = W.player.shells || 0;
    if (hud._inv) hud.refreshInv();          // keep the inventory live while open
    hud.drawMinimap();
  };

  // --- Minimap (north-up, player-centred) -------------------------------------
  hud.drawMinimap = function () {
    const cv = els.minimap; if (!cv) return;
    const ctx = hud._mmctx || (hud._mmctx = cv.getContext('2d'));
    const p = W.player; if (!p || !p.pos) return;
    const S = cv.width, c = S / 2, R = c - 3, RANGE = 300, sc = R / RANGE;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,14,9,0.85)'; ctx.fill();
    ctx.clip();

    // --- fog of war: explored ground fills in with biome colour as you roam ---
    if (!hud._explored) hud._explored = new Set();
    const CELL = 24, RAD = 2;
    const pcx = Math.round(p.pos.x / CELL), pcz = Math.round(p.pos.z / CELL);
    for (let dx = -RAD; dx <= RAD; dx++) for (let dz = -RAD; dz <= RAD; dz++) hud._explored.add((pcx + dx) + ',' + (pcz + dz));
    const cellPx = CELL * sc;
    const span = Math.ceil(RANGE / CELL) + 1;
    for (let cx = pcx - span; cx <= pcx + span; cx++) {
      for (let cz = pcz - span; cz <= pcz + span; cz++) {
        if (!hud._explored.has(cx + ',' + cz)) continue;
        const wx = cx * CELL, wz = cz * CELL;
        const h = W.world.heightAt(wx, wz);
        let col;
        if (h < -2.0) col = '#2f6fb0';                                  // water (blue)
        else {
          const d = W.world.desertAt ? W.world.desertAt(wx, wz) : 0;
          const g = [78, 124, 60], t = [206, 184, 126];                 // forest -> desert
          col = 'rgb(' + Math.round(g[0] + (t[0] - g[0]) * d) + ',' + Math.round(g[1] + (t[1] - g[1]) * d) + ',' + Math.round(g[2] + (t[2] - g[2]) * d) + ')';
        }
        ctx.fillStyle = col;
        ctx.fillRect(c + (wx - p.pos.x) * sc - cellPx / 2 - 0.5, c + (wz - p.pos.z) * sc - cellPx / 2 - 0.5, cellPx + 1, cellPx + 1);
      }
    }

    const dot = (x, z, color, rad) => {
      let mx = c + (x - p.pos.x) * sc, my = c + (z - p.pos.z) * sc;
      const dx = mx - c, dy = my - c, d = Math.hypot(dx, dy);
      if (d > R - 4) { const k = (R - 4) / d; mx = c + dx * k; my = c + dy * k; }
      ctx.beginPath(); ctx.arc(mx, my, rad, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    };
    dot(0, 0, '#ffb13a', 3.4);                                    // home camp (always known)
    const disc = (W.world && W.world.discovered) || {};
    // landmarks only appear once you (or a teammate) have discovered them
    if (W.world && W.world.villagePos && disc.village) dot(W.world.villagePos.x, W.world.villagePos.z, '#7fe07f', 3.4); // village (green)
    if (W.world && W.world.banditCampPos && disc.bandit) dot(W.world.banditCampPos.x, W.world.banditCampPos.z, '#ff5a4a', 3.8); // bandit hideout (red)
    if (W.world && W.world.outposts) {                            // bandit outposts (amber-red)
      for (const o of W.world.outposts) { if (o.found) dot(o.x, o.z, '#ff8c3a', 3.4); }
    }
    if (W.net && W.net.remote) {
      for (const id in W.net.remote) {                            // teammates (cyan) — always shown
        const r = W.net.remote[id];
        if (r && r.pose) dot(r.pose.x, r.pose.z, '#56d3ff', 4.2);
      }
    }
    ctx.restore();
    // player arrow at centre, pointing where you face
    ctx.save();
    ctx.translate(c, c); ctx.rotate(-p.yaw);
    ctx.beginPath(); ctx.moveTo(0, -6.5); ctx.lineTo(4.5, 5.5); ctx.lineTo(-4.5, 5.5); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    ctx.restore();
  };

  // --- Inventory --------------------------------------------------------------
  hud.toggleInventory = function (open) {
    hud._inv = open;
    if (els.invPanel) els.invPanel.classList.toggle('hidden', !open);
    if (open) hud.refreshInv();
  };
  hud.refreshInv = function () {
    const p = W.player; if (!els.invPanel) return;
    els.invWood.textContent = p.wood;
    els.invBerries.textContent = p.berries + '/' + p.berryMax;
    els.invBandaids.textContent = p.bandaids;
    els.invWater.textContent = p.bottle + '/' + p.bottleMax;
    els.invAxe.textContent = p.axeLevel;
    els.invShells.textContent = p.shells;
    els.invSwordSlot.classList.toggle('empty', !p.hasSword);
    els.invArmorSlot.classList.toggle('empty', !p.hasArmor);
    els.invShieldSlot.classList.toggle('empty', !p.hasShield);
    els.invShotgunSlot.classList.toggle('empty', !p.hasShotgun);
  };

  // --- Sleep overlay ----------------------------------------------------------
  hud.showSleep = function (show) {
    if (!els.sleepOverlay) return;
    els.sleepOverlay.classList.toggle('hidden', !show);
    if (show) els.sleepOverlay.querySelectorAll('[data-hug]').forEach((b) => b.classList.remove('sel'));
  };
  hud.setSleepCount = function (n, ready) {
    if (!els.sleepCount) return;
    els.sleepCount.textContent = ready ? '💤' : n;
    els.sleepWait.textContent = ready ? 'Waiting for the night to pass…' : 'Sleeping…';
  };
  hud.markHug = function (kind) {
    if (!els.sleepOverlay) return;
    els.sleepOverlay.querySelectorAll('[data-hug]').forEach((b) => b.classList.toggle('sel', b.dataset.hug === kind));
  };

  // --- Build placement hint ---------------------------------------------------
  hud.showBuildHint = function (show, name) {
    if (!els.buildHint) return;
    if (show && name) els.buildHintName.textContent = name;
    els.buildHint.classList.toggle('hidden', !show);
  };

  let bannerTimer = null;
  hud.banner = function (big, sub, color) {
    els.banner.querySelector('.big').textContent = big;
    els.banner.querySelector('.big').style.color = color || '#fff';
    els.banner.querySelector('.sub').textContent = sub || '';
    els.banner.style.opacity = 1;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { els.banner.style.opacity = 0; }, 2600);
  };

  let toastEl = null, toastTimer = null;
  hud.toast = function (text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', left: '50%', top: '58%', transform: 'translateX(-50%)',
        font: "bold 16px 'Trebuchet MS',sans-serif", color: '#d8f0b0',
        textShadow: '0 2px 6px #000', pointerEvents: 'none', transition: 'opacity .3s', opacity: 0, zIndex: 5,
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = 0; }, 900);
  };

  hud.toggleCraft = function (open) { els.craftPanel.classList.toggle('hidden', !open); };
  hud.updateCraft = function (s) {
    els.craftWood.textContent = s.wood;
    els.axeLv.textContent = 'Lv ' + s.axeLevel;
    els.axeCost.textContent = s.axeCost + ' wood';
    els.crow3.classList.toggle('owned', !!s.armor);
    els.crow6.classList.toggle('owned', !!s.sword);
    els.crow7.classList.toggle('owned', !!s.shield);
  };

  hud.showKeyHelp = function (show) { if (els.keyHelp) els.keyHelp.classList.toggle('hidden', !show); };

  hud.flashDamage = function (intensity) {
    els.flash.style.opacity = intensity;
    setTimeout(() => { els.flash.style.opacity = 0; }, 110);
  };

  hud.showStart = function (cb) { els.startBtn.onclick = cb; };
  hud.hideStart = function () { els.startOverlay.classList.add('hidden'); };
  hud.showPause = function (show) { els.pauseOverlay.classList.toggle('hidden', !show); };
  hud.onResume = function (cb) { els.resumeBtn.onclick = cb; };

  hud.showDead = function (stats, cb) {
    els.deadStats.innerHTML =
      `You survived <b>${stats.day - 1}</b> night${stats.day - 1 === 1 ? '' : 's'} in the forest.<br>` +
      `Beasts slain: <b>${stats.kills}</b> &nbsp;·&nbsp; Wood gathered: <b>${stats.wood}</b>`;
    els.deadOverlay.classList.remove('hidden');
    els.retryBtn.onclick = cb;
  };

  W.hud = hud;
})();
