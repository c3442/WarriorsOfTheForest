/* Bootstrap: renderer, scene, camera, menu (solo/host/join), loop, day tracking. */
(function () {
  const W = window.WOTF;
  const C = W.CONFIG;

  let renderer, scene, camera, clock;
  let started = false, paused = false, built = false;
  let timeOfDay = 0.18 * C.DAY_LENGTH; // start mid-morning
  let day = 1, wasNight = false;

  function init() {
    const app = document.getElementById('app');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    app.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = 'none';
    renderer.domElement.addEventListener('mousedown', () => renderer.domElement.focus());

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a1230');
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.add(camera);

    W.hud.init();
    W.hud.onResume(setResume);
    W.onDeath = onDeath;
    wireMenu();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && started && W.player.alive) setPause(!paused);
    });
    window.addEventListener('blur', () => {
      if (started && W.player.alive && !paused) setPause(true);
    });
    window.addEventListener('resize', onResize);
    clock = new THREE.Clock();
    requestAnimationFrame(loop);
  }

  // --- Menu / mode selection -------------------------------------------------

  function setStatus(html) { document.getElementById('netStatus').innerHTML = html; }

  function wireMenu() {
    const soloBtn = document.getElementById('soloBtn');
    const hostBtn = document.getElementById('hostBtn');
    const joinBtn = document.getElementById('joinBtn');
    const codeInput = document.getElementById('codeInput');
    const nameInput = document.getElementById('nameInput');
    const myName = () => (nameInput.value.trim() || 'Player').slice(0, 12);

    soloBtn.onclick = () => beginGame((Math.random() * 1e9) | 0);

    hostBtn.onclick = () => {
      W.net.myName = myName();
      setStatus('Creating room…');
      W.net.host({
        onCode: (code) => setStatus('Your code: <b>' + code + '</b><br>Share it, then press ENTER FOREST. Friends can JOIN anytime.'),
        onStatus: (m) => setStatus(m),
        onPeer: () => W.hud.toast('A friend joined! 🧍'),
      });
      soloBtn.classList.add('hidden');
      document.querySelector('.joinrow').classList.add('hidden');
      hostBtn.textContent = 'ENTER FOREST';
      hostBtn.onclick = () => beginGame(W.net.seed);
    };

    joinBtn.onclick = () => {
      const code = codeInput.value.toUpperCase().trim();
      if (code.length < 4) { setStatus('Enter the host’s 5-letter code.'); return; }
      W.net.myName = myName();
      setStatus('Connecting…');
      W.net.join(code, {
        onInit: (seed) => beginGame(seed),
        onStatus: (m) => setStatus(m),
      });
    };
    codeInput.addEventListener('keydown', (e) => { if (e.code === 'Enter') joinBtn.onclick(); });
  }

  function buildWorld(seed) {
    if (built) return;
    built = true;
    W.util.seed(seed);
    W.world.init(scene);
    W.player.init(camera, renderer.domElement, scene);
    W.enemies.init(scene);
    W.net.attach(scene);
  }

  function beginGame(seed) {
    buildWorld(seed);
    if (W.net.role === 'client') { timeOfDay = W.net.time; day = W.net.day; }
    started = true; paused = false;
    W.player.active = true;
    document.getElementById('startOverlay').classList.add('hidden');
    renderer.domElement.focus();
    W.hud.banner('SURVIVE', W.net.role ? 'Co-op — survive together' : 'Chop wood by day · fight beasts by night', '#cfe8b6');
  }

  // --- Pause / death ---------------------------------------------------------

  function setPause(p) { paused = p; W.player.active = !p; W.hud.showPause(p); }
  function setResume() { setPause(false); renderer.domElement.focus(); }
  function onDeath() {
    W.player.active = false;
    W.hud.showDead({ day, kills: W.player.kills, wood: W.player.wood }, () => location.reload());
  }
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- Loop ------------------------------------------------------------------

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const role = W.net.role; // null solo | 'host' | 'client'

    if (started && !paused && W.player.alive) {
      if (role === 'client') { timeOfDay = W.net.time; day = W.net.day; }
      else { timeOfDay += dt; }
      const dayT = (timeOfDay / C.DAY_LENGTH) % 1;

      W.world.update(dt, dayT, W.player.pos);
      W.player.update(dt);
      const night = W.world.isNight();

      if (role === 'client') {
        W.enemies.applySnapshot(W.net.enemySnap, dt);
      } else {
        const targets = role === 'host'
          ? W.net.hostTargets()
          : [{ pos: W.player.pos, onBite: (dmg) => W.player.takeDamage(dmg) }];
        W.enemies.update(dt, night, day, targets);
      }

      if (role) {
        W.net.tick(dt, { x: W.player.pos.x, y: W.player.pos.y, z: W.player.pos.z, yaw: W.player.yaw }, timeOfDay, day);
        W.net.updateAvatars(dt);
      }

      if (night && !wasNight) {
        W.hud.banner('NIGHT FALLS', 'The beasts are coming — stay alive', '#ff7b7b');
      } else if (!night && wasNight) {
        if (role !== 'client') day += 1;
        W.hud.banner('DAWN BREAKS', `You survived night ${(role === 'client' ? day : day - 1)}`, '#ffe08a');
      }
      wasNight = night;

      W.hud.update({
        health: Math.round(W.player.health), stamina: Math.round(W.player.stamina),
        hunger: Math.round(W.player.hunger), thirst: Math.round(W.player.thirst),
        bottle: W.player.bottle, bottleMax: W.player.bottleMax,
        night, day,
        foes: W.enemies.list.length, wood: W.player.wood, kills: W.player.kills,
      });
    }

    renderer.render(scene, camera);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
