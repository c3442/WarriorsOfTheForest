/* DOM HUD: stat bars, info, banners, damage flash, overlays, toasts. */
(function () {
  const W = (window.WOTF = window.WOTF || {});

  const $ = (id) => document.getElementById(id);
  const els = {};
  const hud = {};

  hud.init = function () {
    ['hp', 'st', 'fd', 'th', 'todIcon', 'todLabel', 'dayNum', 'foeNum', 'woodNum', 'waterNum', 'berryNum', 'killNum',
     'banner', 'flash', 'startOverlay', 'pauseOverlay', 'deadOverlay', 'deadStats',
     'craftPanel', 'craftWood', 'crow3', 'axeLv', 'axeCost', 'spearLv', 'spearCost',
     'startBtn', 'resumeBtn', 'retryBtn'].forEach((id) => { els[id] = $(id); });
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
    if (els.craftWood) els.craftWood.textContent = s.wood;   // keep craft panel wood live
    els.todIcon.textContent = s.night ? '🌙' : '☀️';
    els.todLabel.textContent = s.night ? 'Night' : 'Day';
    els.dayNum.textContent = s.day;
    els.foeNum.textContent = s.foes;
    els.woodNum.textContent = s.wood;
    els.killNum.textContent = s.kills;
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
    els.spearLv.textContent = 'Lv ' + s.spearLevel;
    els.spearCost.textContent = s.spearCost + ' wood';
    els.crow3.classList.toggle('owned', !!s.armor);
  };

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
