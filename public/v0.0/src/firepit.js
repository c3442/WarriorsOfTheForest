/* The camp fire needs feeding. The home campfire has a fuel bar that slowly burns
   down. Bring wood to the fire (stand next to it) and your wood is fed in to keep
   it burning. If it goes OUT you can't sleep and the camp stops healing you or
   restoring your thirst — until you relight it with wood.
   Self-contained: own loop + HUD bar; exposes W.fire.lit() which player.js checks. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const P = () => W.player;
  const MAX = 100, DRAIN = 0.42, FEED_R = 3.8, PER_WOOD = 9, FEED_CD = 0.3;

  let fuel = MAX, ready = false, feedT = 0, wasLit = true, bar = null, fill = null, pct = null, feeding = false;
  let last = performance.now() / 1000;
  const now = () => performance.now() / 1000;
  const firePos = () => (W.world && W.world.campPos) || { x: 0, z: 0 };

  function loop() {
    requestAnimationFrame(loop);
    const t = now(); const dt = Math.min(0.1, t - last); last = t;
    const p = P();
    feeding = false;
    if (p && p.active) {
      fuel = Math.max(0, fuel - DRAIN * dt);                    // the fire burns down
      feedT -= dt;
      const fp = firePos();
      const near = p.alive && W.util.dist2(p.pos.x, p.pos.z, fp.x, fp.z) < FEED_R;
      if (near && fuel < MAX && (p.wood || 0) > 0 && feedT <= 0) {   // feed a log in
        p.wood -= 1; fuel = Math.min(MAX, fuel + PER_WOOD); feedT = FEED_CD; feeding = true;
      }
      if (wasLit && fuel <= 0) { wasLit = false; toast('🔥 The fire went out! No resting or camp-healing — bring wood to relight it'); }
      else if (!wasLit && fuel > 0) { wasLit = true; toast('🔥 The fire is lit again — the camp is a haven once more'); }
    }
    updateBar();
  }
  function toast(m) { if (W.hud && W.hud.toast) W.hud.toast(m); }

  // ---- HUD fuel bar ---------------------------------------------------------
  function buildBar() {
    const css = document.createElement('style');
    css.textContent = `
      #fireBar{position:fixed;left:16px;top:210px;z-index:5;display:flex;align-items:center;gap:7px;
        padding:5px 10px;border-radius:10px;background:rgba(12,14,10,.6);border:2px solid rgba(200,120,50,.55);
        color:#fff;font:bold 12px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;}
      #fireBar .track{width:96px;height:11px;border-radius:6px;background:rgba(0,0,0,.5);overflow:hidden;}
      #fireBar .track i{display:block;height:100%;width:100%;transition:width .15s linear;
        background:linear-gradient(90deg,#ffcf5c,#ff7b3a);}
      #fireBar.out{border-color:rgba(120,120,130,.6);}
      #fireBar.out .track i{background:#5a5a62;}
      #fireBar.feeding{border-color:#ffd27a;box-shadow:0 0 9px rgba(255,180,90,.6);}
    `;
    document.head.appendChild(css);
    bar = document.createElement('div'); bar.id = 'fireBar';
    bar.innerHTML = '🔥 <div class="track"><i id="fireFill"></i></div><span id="firePct">100%</span>';
    document.body.appendChild(bar);
    fill = document.getElementById('fireFill'); pct = document.getElementById('firePct');
  }
  function updateBar() {
    if (!bar) return;
    fill.style.width = fuel + '%';
    pct.textContent = Math.round(fuel) + (fuel <= 0 ? '% OUT' : '%');
    bar.classList.toggle('out', fuel <= 0);
    bar.classList.toggle('feeding', feeding);
  }

  // ---- init -----------------------------------------------------------------
  const wait = setInterval(() => {
    if (ready) { clearInterval(wait); return; }
    if (!W.player || !W.world || !W.world.heightAt) return;
    ready = true;
    buildBar();
    requestAnimationFrame(loop);
    W.fire = { lit: () => fuel > 0, fuel: () => fuel, max: () => MAX, feed: (n) => { fuel = Math.min(MAX, fuel + (n == null ? PER_WOOD : n)); } };
  }, 400);
})();
