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
