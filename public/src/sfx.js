/* Procedural sound effects — pure Web Audio, no asset files (works offline).
   W.sfx.chop(), .hit(), .headshot(), .bow(), .shotgun(), .hurt(), .die(),
   .eat(), .drink(), .kill(), .craft(), .select(), .step(), .portal().
   The audio context is created lazily and resumed on the first user gesture
   (browsers block sound until then). A small 🔊 button toggles mute. */
(function () {
  const W = window.WOTF || (window.WOTF = {});
  let ac = null, master = null, muted = false, noiseBuf = null;

  function ctx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ac.destination);
    // shared white-noise buffer (1s) for percussive / breathy sounds
    const n = ac.sampleRate * 1.0;
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  const now = () => (ac ? ac.currentTime : 0);

  // one pitched voice with an attack/decay envelope, optional pitch glide
  function tone(f0, f1, dur, type, peak, when) {
    if (!ctx()) return;
    const t = (when || now()) + 0.0001;
    const o = ac.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // a filtered noise burst (thuds, cracks, blasts, breath)
  function noise(dur, peak, filterType, fc0, fc1, when) {
    if (!ctx()) return;
    const t = (when || now()) + 0.0001;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const flt = ac.createBiquadFilter(); flt.type = filterType || 'lowpass';
    flt.frequency.setValueAtTime(fc0, t);
    if (fc1 && fc1 !== fc0) flt.frequency.exponentialRampToValueAtTime(Math.max(40, fc1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const sfx = {
    resume() { if (ctx() && ac.state === 'suspended') ac.resume(); },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.85; },
    // axe on wood: sharp chip + woody thud
    chop() { noise(0.13, 0.5, 'lowpass', 2600, 500); tone(210, 90, 0.12, 'triangle', 0.35); },
    // weapon connecting with flesh
    hit() { noise(0.10, 0.4, 'lowpass', 1400, 300); tone(150, 70, 0.10, 'sine', 0.4); },
    headshot() { noise(0.09, 0.5, 'highpass', 1800, 4000); tone(900, 300, 0.09, 'square', 0.22); tone(1500, 1500, 0.14, 'sine', 0.18, now() + 0.04); },
    // bow release: a twang + whoosh
    bow() { tone(680, 190, 0.18, 'sawtooth', 0.28); noise(0.22, 0.14, 'bandpass', 1200, 400, now() + 0.02); },
    // sawn-off shotgun: big blast + low boom
    shotgun() { noise(0.30, 0.85, 'lowpass', 5000, 250); tone(120, 45, 0.28, 'sine', 0.6); tone(70, 40, 0.32, 'sine', 0.5); },
    // player takes a hit
    hurt() { tone(300, 140, 0.20, 'square', 0.3); noise(0.14, 0.2, 'lowpass', 900, 300); },
    // player dies: long descent
    die() { tone(320, 70, 0.9, 'sawtooth', 0.32); tone(160, 45, 1.1, 'sine', 0.25, now() + 0.05); },
    // eat: two crunches
    eat() { noise(0.09, 0.3, 'bandpass', 1600, 900); noise(0.08, 0.26, 'bandpass', 1400, 800, now() + 0.13); },
    // drink: rising gulps
    drink() { tone(240, 380, 0.10, 'sine', 0.25); tone(280, 440, 0.10, 'sine', 0.22, now() + 0.14); },
    // enemy killed: happy two-note chime
    kill() { tone(680, 680, 0.10, 'square', 0.22); tone(1020, 1020, 0.18, 'square', 0.22, now() + 0.09); },
    // crafting: a metallic clink
    craft() { tone(1200, 1200, 0.05, 'square', 0.2); tone(1800, 1500, 0.12, 'triangle', 0.18, now() + 0.05); },
    // UI / weapon select: soft blip
    select() { tone(520, 720, 0.07, 'triangle', 0.2); },
    // footstep (alternates pitch by foot)
    step(right) { noise(0.06, right ? 0.13 : 0.11, 'lowpass', right ? 520 : 440, 180); },
    // portal / game start whoosh
    portal() { tone(300, 900, 0.5, 'sawtooth', 0.2); noise(0.5, 0.16, 'bandpass', 400, 2400); },
    // --- extra juice -------------------------------------------------------
    coin() { tone(880, 880, 0.06, 'square', 0.2); tone(1320, 1320, 0.13, 'square', 0.2, now() + 0.06); },   // treeling coin earned
    gun() { noise(0.12, 0.7, 'lowpass', 4200, 300); tone(150, 55, 0.13, 'square', 0.42); },                  // pistol / rifle crack
    star() { noise(0.16, 0.2, 'highpass', 3200, 6500); tone(1500, 700, 0.12, 'sine', 0.14); },               // ninja star whoosh
    boom() { noise(0.5, 0.95, 'lowpass', 1400, 55); tone(85, 38, 0.6, 'sine', 0.52); tone(170, 48, 0.4, 'sawtooth', 0.3); },  // explosion
    blast() { tone(950, 200, 0.13, 'square', 0.24); noise(0.09, 0.2, 'bandpass', 2200, 600); },              // blaster bolt
    pew() { tone(1300, 520, 0.05, 'square', 0.12); },                                                        // sentry turret
    levelup() { [523, 659, 880].forEach((f, i) => tone(f, f, 0.15, 'triangle', 0.22, now() + i * 0.1)); tone(1046, 1046, 0.34, 'sine', 0.2, now() + 0.32); },  // class upgrade
    revive() { [440, 660, 880, 1320].forEach((f, i) => tone(f, f, 0.18, 'sine', 0.2, now() + i * 0.09)); },  // Survivor cheats death
    roar() { tone(95, 58, 0.6, 'sawtooth', 0.42); noise(0.6, 0.34, 'lowpass', 720, 200); },                  // boss roar
    jump() { tone(300, 660, 0.13, 'sine', 0.16); },                                                          // hop
    // --- more sounds ------------------------------------------------------
    swing() { noise(0.13, 0.18, 'bandpass', 900, 2600); },                                                   // light melee whoosh
    heavySwing() { noise(0.22, 0.24, 'bandpass', 480, 1500); tone(150, 70, 0.2, 'sine', 0.16); },            // mace/heavy whoosh
    maceHit() { noise(0.17, 0.62, 'lowpass', 1000, 150); tone(120, 44, 0.18, 'sine', 0.5); tone(78, 36, 0.24, 'sine', 0.4, now() + 0.02); }, // heavy crush
    deagle() { noise(0.14, 0.9, 'lowpass', 5400, 320); tone(210, 60, 0.14, 'square', 0.5); tone(90, 44, 0.2, 'sine', 0.42); },  // hard pistol crack
    land() { noise(0.12, 0.32, 'lowpass', 480, 120); tone(120, 70, 0.10, 'sine', 0.2); },                    // landing thud
    growl() { tone(92, 60, 0.5, 'sawtooth', 0.3); noise(0.5, 0.2, 'lowpass', 480, 150); },                   // wolf / beast growl
    howl() { tone(420, 620, 0.5, 'sine', 0.24); tone(600, 360, 0.7, 'sine', 0.2, now() + 0.45); },           // distant wolf howl
    sizzle() { noise(0.55, 0.2, 'highpass', 2400, 5200); noise(0.5, 0.13, 'bandpass', 1800, 3000, now() + 0.1); },  // cooking meat
    openbox() { tone(300, 210, 0.15, 'triangle', 0.2); tone(720, 940, 0.09, 'square', 0.18, now() + 0.13); tone(1080, 1080, 0.15, 'square', 0.16, now() + 0.22); }, // crate creak + jingle
    buy() { tone(600, 600, 0.06, 'square', 0.2); tone(920, 920, 0.07, 'square', 0.2, now() + 0.06); tone(1320, 1320, 0.15, 'triangle', 0.2, now() + 0.13); },       // purchase chime
    heal() { [660, 880, 1100].forEach((f, i) => tone(f, f, 0.14, 'sine', 0.15, now() + i * 0.05)); },         // heal / lifesteal shimmer
    nightfall() { tone(230, 110, 0.9, 'sawtooth', 0.22); noise(0.9, 0.12, 'lowpass', 400, 140); },            // ominous dusk
    dawn() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.2, 'sine', 0.15, now() + i * 0.08)); },     // bright sunrise
    splash() { noise(0.3, 0.42, 'highpass', 1200, 4200); tone(600, 200, 0.2, 'sine', 0.14); },                // water splash
    thud() { noise(0.14, 0.36, 'lowpass', 700, 160); tone(150, 80, 0.12, 'sine', 0.24); },                   // building / block placed
    tame() { [523, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.2, now() + i * 0.11)); noise(0.2, 0.1, 'highpass', 3000, 5000, now() + 0.34); }, // befriend an animal
  };
  W.sfx = sfx;

  // unlock audio on the first real gesture (click / key / touch)
  const unlock = () => { sfx.resume(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, unlock, { once: false, passive: true }));

  // a small mute toggle in the corner
  function addButton() {
    if (document.getElementById('sfxBtn')) return;
    const b = document.createElement('button');
    b.id = 'sfxBtn'; b.textContent = '🔊';
    b.title = 'Sound on/off';
    b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:40;width:38px;height:38px;border-radius:9px;' +
      'border:2px solid rgba(150,180,110,.6);background:rgba(12,16,10,.72);color:#eaf4dd;font-size:18px;cursor:pointer;' +
      'backdrop-filter:blur(2px);line-height:1;';
    b.onclick = (e) => { e.stopPropagation(); sfx.resume(); sfx.setMuted(!muted); b.textContent = muted ? '🔇' : '🔊'; b.blur(); };
    document.body.appendChild(b);
  }
  if (document.body) addButton();
  else window.addEventListener('DOMContentLoaded', addButton);
})();
