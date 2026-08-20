/* Auto-shoot: press N to toggle. While on, your current weapon fires by itself
   (the bow auto-draws to a strong charge, then looses). Self-contained — drives
   the existing press/release/attack functions from its own loop. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;
  const CHARGE = 0.85;          // auto-bow draws to ~85% (fast + hard-hitting)

  function loop() {
    requestAnimationFrame(loop);
    const p = P();
    if (!p || !p.autoShoot || !p.active || !p.alive) return;
    if (p.building || p.sitting || p.sleeping || p.downed) return;
    if (p.currentWeapon === 'bow') {
      if (!p._bowDrawing && p._bowSnap === undefined && (p._t - (p.lastAttack || 0) > 0.18)) {
        if (p.startDraw) p.startDraw();
      } else if (p._bowDrawing && (p._bowCharge || 0) >= CHARGE) {
        if (p.releaseDraw) p.releaseDraw();
      }
    } else {
      // axe / sword / katana / shotgun all respect their own cooldown in attack()
      if (p.pressAttack) p.pressAttack(); else if (p.attack) p.attack();
    }
  }
  requestAnimationFrame(loop);

  let btn = null;
  function updateBtn() { if (btn) btn.style.background = (P() && P().autoShoot) ? 'rgba(120,160,90,.9)' : ''; }

  function toggle() {
    const p = P(); if (!p) return;
    p.autoShoot = !p.autoShoot;
    if (!p.autoShoot && p._bowDrawing && p.releaseDraw) p.releaseDraw();   // loose any held draw
    if (W.hud) W.hud.toast(p.autoShoot ? '🎯 Auto-shoot ON (N to stop)' : 'Auto-shoot OFF');
    updateBtn();
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat) toggle(); });

  // mobile: add an "Auto" pill to the touch controls if present
  function addBtn() {
    const acts = document.getElementById('mActs'); if (!acts || document.getElementById('mAuto')) return;
    const b = document.createElement('div'); b.id = 'mAuto'; b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = '🎯';
    const t = document.createElement('span'); t.textContent = 'Auto';
    b.appendChild(e); b.appendChild(t);
    b.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); }, { passive: false });
    acts.insertBefore(b, acts.firstChild); btn = b; updateBtn();
  }
  setTimeout(addBtn, 900); setTimeout(addBtn, 2600);
})();
