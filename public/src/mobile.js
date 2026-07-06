/* Touch controls for phones/tablets: movement joystick, drag-to-look,
   and on-screen action buttons. Only activates on touch devices; desktop
   play is completely unchanged. Reuses the existing key handlers by
   dispatching synthetic key events, so it stays decoupled from game logic. */
(function () {
  const W = window.WOTF;
  if (!W) return;
  const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (!IS_TOUCH) return;

  // --- prevent pinch/double-tap zoom ---
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');

  // --- styles ---
  const style = document.createElement('style');
  style.textContent = `
    html,body{touch-action:none;-webkit-user-select:none;user-select:none;}
    #mc{position:fixed;inset:0;z-index:6;pointer-events:none;}
    #mLook{position:fixed;inset:0;z-index:5;}
    #mJoy{position:fixed;left:22px;bottom:120px;width:130px;height:130px;border-radius:50%;
      background:rgba(18,26,14,.32);border:2px solid rgba(150,180,110,.55);z-index:7;pointer-events:auto;}
    #mKnob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
      background:rgba(180,210,140,.65);border:2px solid rgba(255,255,255,.6);}
    .mbtn{position:fixed;z-index:7;border:2px solid rgba(255,255,255,.35);border-radius:50%;
      background:rgba(18,22,14,.5);color:#fff;font-size:22px;line-height:1;display:flex;align-items:center;
      justify-content:center;pointer-events:auto;text-shadow:0 1px 2px #000;backdrop-filter:blur(1px);}
    .mbtn:active{background:rgba(120,160,90,.75);transform:scale(.94);}
    #mAtk{right:24px;bottom:104px;width:94px;height:94px;font-size:36px;}
    #mJmp{right:130px;bottom:126px;width:66px;height:66px;font-size:26px;}
    #mSpr{left:62px;bottom:34px;width:62px;height:62px;font-size:15px;font-weight:bold;}
    #mActs{position:fixed;right:10px;top:46%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-end;gap:7px;z-index:7;pointer-events:auto;}
    #mMoreRow{position:fixed;right:10px;top:46%;transform:translateY(-50%);display:none;flex-direction:column;align-items:flex-end;gap:7px;z-index:7;pointer-events:auto;}
    #mMoreRow.open{display:flex;}
    .mpill{display:flex;align-items:center;gap:6px;padding:0 13px;height:46px;border-radius:23px;
      background:rgba(18,22,14,.62);border:2px solid rgba(255,255,255,.42);color:#fff;
      font:bold 15px 'Trebuchet MS',system-ui,sans-serif;text-shadow:0 1px 2px #000;pointer-events:auto;
      white-space:nowrap;backdrop-filter:blur(1px);letter-spacing:.5px;}
    .mpill:active{background:rgba(120,160,90,.85);transform:scale(.96);}
    .mpill .e{font-size:20px;line-height:1;}
    #mMore{position:fixed;right:10px;bottom:26px;z-index:7;}
  `;
  document.head.appendChild(style);

  // --- synthetic key helpers (drive existing handlers) ---
  const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  const tapKey = (code) => { press(code); setTimeout(() => release(code), 80); };
  const P = () => W.player;

  // press = start (bow draws on hold), release = loose the bow
  function pressAtk() { const p = P(); if (!p) return; if (p.building) { p.placeBuild(); return; } if (p.pressAttack) p.pressAttack(); else p.attack(); }
  function releaseAtk() { const p = P(); if (p && p.releaseAttack) p.releaseAttack(); }
  // a quick screen-tap: bow fires a medium-charge shot, other weapons swing
  function tapAttack() {
    const p = P(); if (!p) return;
    if (W.builder && W.builder.isOn && W.builder.isOn()) return;   // in Build Mode a tap positions the hologram, not an attack
    if (p.building) { p.placeBuild(); return; }
    if (p.currentWeapon === 'bow' && p.startDraw) { p.startDraw(); p._bowCharge = 0.55; p.releaseDraw(); }
    else p.attack();
  }

  // --- DOM ---
  const mk = (id, cls, label) => { const e = document.createElement('div'); if (id) e.id = id; if (cls) e.className = cls; if (label != null) e.textContent = label; return e; };
  const root = mk('mc');
  const look = mk('mLook');
  const joy = mk('mJoy'); const knob = mk('mKnob'); joy.appendChild(knob);
  const atk = mk('mAtk', 'mbtn', '⚔️');
  const jmp = mk('mJmp', 'mbtn', '⬆️');
  const spr = mk('mSpr', 'mbtn', 'RUN');
  const acts = mk('mActs');
  const more = mk('mMore', 'mpill', '⋯ More');
  const moreRow = mk('mMoreRow');

  const onTap = (el, fn) => el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); }, { passive: false });

  // a Roblox-style labelled button: emoji + the action's name
  function pill(emoji, text) {
    const b = document.createElement('div'); b.className = 'mpill';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = emoji;
    const t = document.createElement('span'); t.textContent = text;
    b.appendChild(e); b.appendChild(t); return b;
  }

  // primary action buttons (right column) — labelled
  [['KeyE', '🍖', 'Eat'], ['KeyF', '💧', 'Drink'], ['KeyG', '✊', 'Grab'], ['KeyU', '🌱', 'Plant'],
   ['KeyC', '🛠️', 'Craft'], ['KeyI', '🎒', 'Bag'], ['KeyX', '🔁', 'Swap'], ['KeyB', '🩹', 'Heal']]
    .forEach(([code, emoji, text]) => { const b = pill(emoji, text); onTap(b, () => tapKey(code)); acts.appendChild(b); });
  // secondary actions behind the "⋯ More" button — labelled
  [['KeyZ', '🤐', 'Zip'], ['KeyK', '💤', 'Sleep'], ['KeyR', '🪑', 'Sit'], ['KeyT', '🦊', 'Tame'], ['KeyH', '🤚', 'Drop']]
    .forEach(([code, emoji, text]) => { const b = pill(emoji, text); onTap(b, () => tapKey(code)); moreRow.appendChild(b); });
  onTap(more, () => {                            // swap the primary column for the extras
    const open = moreRow.classList.toggle('open');
    acts.style.display = open ? 'none' : 'flex';
    more.textContent = open ? '↩ Back' : '⋯ More';
  });

  // attack button: hold to draw/charge the bow, release to loose
  atk.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); pressAtk(); }, { passive: false });
  atk.addEventListener('touchend', (e) => { e.preventDefault(); releaseAtk(); }, { passive: false });
  atk.addEventListener('touchcancel', () => releaseAtk());
  // jump: hold Space while pressed
  jmp.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (P()) P().keys.Space = true; }, { passive: false });
  jmp.addEventListener('touchend', (e) => { e.preventDefault(); if (P()) P().keys.Space = false; }, { passive: false });
  // sprint: toggle Shift
  let sprinting = false;
  onTap(spr, () => { sprinting = !sprinting; if (P()) P().keys.ShiftLeft = sprinting; spr.style.background = sprinting ? 'rgba(120,160,90,.85)' : ''; });

  root.appendChild(look); root.appendChild(joy); root.appendChild(atk); root.appendChild(jmp);
  root.appendChild(spr); root.appendChild(acts); root.appendChild(more); root.appendChild(moreRow);
  document.body.appendChild(root);

  // --- movement joystick -> WASD keys ---
  const RAD = 54;
  let joyId = null;
  function setMove(nx, ny) {
    const k = P() && P().keys; if (!k) return; const dz = 0.32;
    k.KeyW = ny < -dz; k.KeyS = ny > dz; k.KeyA = nx < -dz; k.KeyD = nx > dz;
  }
  function clearMove() { const k = P() && P().keys; if (k) { k.KeyW = k.KeyS = k.KeyA = k.KeyD = false; } knob.style.transform = 'translate(0,0)'; }
  function moveJoy(t) {
    const r = joy.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy; const len = Math.hypot(dx, dy);
    if (len > RAD) { dx = dx / len * RAD; dy = dy / len * RAD; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    setMove(dx / RAD, dy / RAD);
  }
  joy.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); const t = e.changedTouches[0]; joyId = t.identifier; moveJoy(t); }, { passive: false });
  joy.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === joyId) moveJoy(t); }, { passive: false });
  const endJoy = (e) => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; clearMove(); } };
  joy.addEventListener('touchend', endJoy, { passive: false });
  joy.addEventListener('touchcancel', () => { joyId = null; clearMove(); });

  // --- look (drag) + tap-to-attack on the open screen ---
  let lookId = null, lx = 0, ly = 0, lt = 0, moved = 0;
  look.addEventListener('touchstart', (e) => {
    if (lookId !== null) return; const t = e.changedTouches[0];
    lookId = t.identifier; lx = t.clientX; ly = t.clientY; lt = Date.now(); moved = 0;
  }, { passive: false });
  look.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      const dx = t.clientX - lx, dy = t.clientY - ly; lx = t.clientX; ly = t.clientY; moved += Math.abs(dx) + Math.abs(dy);
      const p = P(); if (p) { const s = 0.005; p.yaw -= dx * s; p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - dy * s)); }
    }
    e.preventDefault();
  }, { passive: false });
  look.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      lookId = null;
      if (moved < 14 && Date.now() - lt < 300) tapAttack();   // quick tap = attack / place
    }
  }, { passive: false });
  look.addEventListener('touchcancel', () => { lookId = null; });

  // --- make craft-panel rows tappable (no number keys on a phone) ---
  function wireCraftRows() {
    const rows = document.querySelectorAll('#craftPanel .crow');
    rows.forEach((row) => {
      if (row._mwired) return; row._mwired = true;
      onTap(row, () => {
        const b = row.querySelector('b'); if (!b || !P() || !P().craft) return;
        let id = b.textContent.trim();
        if (id === '−' || id === '-') id = 'tent';
        else if (id === '=') id = 'fire';
        else if (id === '[') id = 'katana';
        P().craft(id);
      });
    });
  }
  wireCraftRows();
  setTimeout(wireCraftRows, 1500);   // in case rows are built/altered after load
})();
