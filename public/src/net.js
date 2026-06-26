/* Peer-to-peer co-op via PeerJS (WebRTC). Host is authoritative for the
   world seed, wolves and day/night clock; clients mirror them and send input.
   No server to install — players connect with a short room code. */
(function () {
  const W = (window.WOTF = window.WOTF || {});

  const ATTACK_DMG = 2;
  const SEND_HZ = 15;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused chars

  const net = {
    role: null,        // null (solo) | 'host' | 'client'
    myName: 'Player',
    seed: 0,
    time: 0,           // timeOfDay seconds (client reads from host)
    day: 1,
    enemySnap: [],
    remote: {},        // peerId -> { pose:{x,y,z,yaw}, avatar }
    _peer: null,
    _conns: [],        // host: client conns; client: [hostConn]
    _acc: 0,
    _scene: null,
  };

  function randomCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function buildAvatar(skin) {
    const girl = skin === 'girl';
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: girl ? 0xe85a9a : 0x3f6fc4, roughness: 1, flatShading: true });
    const lower = new THREE.MeshStandardMaterial({ color: girl ? 0x7a3a8a : 0x3a4a6a, roughness: 1, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe2b48c, roughness: 1 });
    const hairMat = new THREE.MeshStandardMaterial({ color: girl ? 0x6a3b1c : 0x352617, roughness: 1, flatShading: true });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(girl ? 0.46 : 0.5, 0.72, 0.3), cloth);
    torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
    head.position.y = 1.62; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.38, girl ? 0.3 : 0.14, 0.38), hairMat);
    hair.position.y = girl ? 1.71 : 1.76; g.add(hair);
    if (girl) { const pony = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.13), hairMat); pony.position.set(0, 1.42, -0.22); g.add(pony); }
    for (const sx of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), lower);
      leg.position.set(sx, 0.35, 0); leg.castShadow = true; g.add(leg);
    }
    for (const sx of [-0.32, 0.32]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.6, 0.15), cloth);
      arm.position.set(sx, 1.05, 0); g.add(arm);
    }
    g.userData.skin = girl ? 'girl' : 'boy';
    return g;
  }

  function makeLabel(text) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,8,0.55)';
    ctx.fillRect(8, 14, 240, 40);
    ctx.font = "bold 32px 'Trebuchet MS', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e9ffd0'; ctx.fillText(text, 128, 35);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.8, 0.45, 1); spr.position.y = 2.35; spr.renderOrder = 999;
    return spr;
  }

  function applyName(id) {
    const r = net.remote[id];
    if (!r || !r.avatar || !r.name || r.labelText === r.name) return;
    if (r.label) r.avatar.remove(r.label);
    r.label = makeLabel(r.name); r.labelText = r.name; r.avatar.add(r.label);
  }

  function ensureAvatar(id) {
    if (!net.remote[id]) net.remote[id] = { pose: null, avatar: null, name: null, skin: 'boy' };
    const r = net.remote[id];
    if (!r.avatar && net._scene) { r.avatar = buildAvatar(r.skin); net._scene.add(r.avatar); }
    applyName(id);
    return r;
  }

  function setRemoteSkin(id, skin) {
    if (!skin) return;
    const r = ensureAvatar(id);
    if (r.skin !== skin) {
      r.skin = skin;
      if (r.avatar && net._scene) {
        net._scene.remove(r.avatar);
        r.avatar = buildAvatar(skin); net._scene.add(r.avatar);
        r.labelText = null; applyName(id);
      }
    }
  }

  function setRemoteName(id, name) {
    const r = ensureAvatar(id);
    if (name && r.name !== name) {
      r.name = name; applyName(id);
      if (!r._hi) { r._hi = true; W.hud.toast(name + ' joined the forest! 🧍'); }
    }
  }

  function removePeer(id) {
    const r = net.remote[id];
    if (r && r.avatar && net._scene) net._scene.remove(r.avatar);
    delete net.remote[id];
  }

  // --- Hosting ---------------------------------------------------------------

  net.host = function (opts) {
    net.role = 'host';
    net.seed = (Math.floor(Math.random() * 1e9)) >>> 0;
    tryOpen();

    function tryOpen() {
      const code = randomCode();
      const peer = new Peer('wotf-' + code);
      net._peer = peer;
      peer.on('open', () => { opts.onCode && opts.onCode(code); });
      peer.on('error', (e) => {
        if (e && e.type === 'unavailable-id') { peer.destroy(); tryOpen(); }
        else { opts.onStatus && opts.onStatus('Connection error: ' + (e.type || e)); }
      });
      peer.on('connection', (conn) => {
        net._conns.push(conn);
        conn.on('open', () => {
          conn.send({ t: 'init', seed: net.seed, time: net.time, day: net.day });
          opts.onStatus && opts.onStatus('A player joined!');
          opts.onPeer && opts.onPeer();
        });
        conn.on('data', (m) => onHostData(conn, m));
        conn.on('close', () => {
          net._conns = net._conns.filter((c) => c !== conn);
          removePeer(conn.peer);
        });
      });
    }
  };

  function onHostData(conn, m) {
    if (m.t === 'pose') {
      ensureAvatar(conn.peer).pose = m;
      setRemoteSkin(conn.peer, m.skin);
      setRemoteName(conn.peer, m.name);
    } else if (m.t === 'hit') {
      const killed = W.enemies.damageById(m.id, m.dmg || ATTACK_DMG, { x: m.x, z: m.z });
      if (killed) conn.send({ t: 'killcredit', kind: m.k });
    } else if (m.t === 'chop') {
      W.world.felByIndex(m.idx);
    } else if (m.t === 'revive') {
      if (W.player.downed) W.player.revive();
    } else if (m.t === 'zip') {
      W.world.applyTentZip(m.idx, m.zipped);
      for (const c of net._conns) { if (c !== conn && c.open) c.send({ t: 'zip', idx: m.idx, zipped: m.zipped }); }
    } else if (m.t === 'build') {
      W.world.buildById(m.id, m.x, m.z, m.yaw);
      for (const c of net._conns) { if (c !== conn && c.open) c.send(m); }   // relay to other clients
    }
  }

  // --- Joining ---------------------------------------------------------------

  net.join = function (code, opts) {
    net.role = 'client';
    const peer = new Peer();
    net._peer = peer;
    peer.on('error', (e) => { opts.onStatus && opts.onStatus('Could not connect: ' + (e.type || e)); });
    peer.on('open', () => {
      opts.onStatus && opts.onStatus('Connecting…');
      const conn = peer.connect('wotf-' + code.toUpperCase().trim(), { reliable: true });
      net._conns = [conn];
      conn.on('open', () => { opts.onStatus && opts.onStatus('Connected — entering the forest…'); });
      conn.on('data', (m) => onClientData(m, opts));
      conn.on('close', () => { opts.onStatus && opts.onStatus('Host disconnected.'); });
    });
  };

  function onClientData(m, opts) {
    if (m.t === 'init') {
      net.seed = m.seed; net.time = m.time; net.day = m.day;
      opts.onInit && opts.onInit(m.seed);
    } else if (m.t === 'snap') {
      net.time = m.time; net.day = m.day; net.enemySnap = m.e;
      for (const id in m.p) { const p = m.p[id]; ensureAvatar(id).pose = p; setRemoteName(id, p.name); setRemoteSkin(id, p.skin); }
    } else if (m.t === 'bite') {
      W.player.takeDamage(m.dmg);
    } else if (m.t === 'chop') {
      W.world.felByIndex(m.idx);
    } else if (m.t === 'killcredit') {
      W.player.creditKill(m.kind === 1 ? 'werewolf' : 'wolf');
    } else if (m.t === 'revive') {
      if (W.player.downed) W.player.revive();
    } else if (m.t === 'zip') {
      W.world.applyTentZip(m.idx, m.zipped);
    } else if (m.t === 'build') {
      W.world.buildById(m.id, m.x, m.z, m.yaw);
    }
  }

  // A downed teammate within reach (so a bandaid can revive them).
  net.anyDownedNear = function (pos, range) {
    for (const id in net.remote) {
      const r = net.remote[id];
      if (r.pose && r.pose.down && Math.hypot(r.pose.x - pos.x, r.pose.z - pos.z) < range) return true;
    }
    return false;
  };
  net.sendRevive = function () { for (const c of net._conns) { if (c.open) c.send({ t: 'revive' }); } };

  // True when every connected teammate is asleep (so the host can skip the night).
  net.allRemoteSleeping = function () {
    for (const c of net._conns) {
      const r = net.remote[c.peer];
      if (!r || !r.pose || !r.pose.asleep) return false;
    }
    return true;
  };
  net.sendZip = function (idx, zipped) { for (const c of net._conns) { if (c.open) c.send({ t: 'zip', idx, zipped }); } };
  net.sendBuild = function (id, x, z, yaw) { for (const c of net._conns) { if (c.open) c.send({ t: 'build', id, x, z, yaw }); } };

  // --- Per-frame -------------------------------------------------------------

  net.attach = function (scene) { net._scene = scene; };

  // Host targets for the enemy AI: local player + each connected client.
  net.hostTargets = function () {
    const targets = [{ pos: W.player.pos, onBite: (dmg) => W.player.takeDamage(dmg) }];
    for (const conn of net._conns) {
      const r = net.remote[conn.peer];
      if (r && r.pose) targets.push({ pos: { x: r.pose.x, z: r.pose.z }, onBite: (dmg) => conn.send({ t: 'bite', dmg }) });
    }
    return targets;
  };

  net.tick = function (dt, pose, timeOfDay, day) {
    net._acc += dt;
    if (net._acc < 1 / SEND_HZ) return;
    net._acc = 0;
    if (net.role === 'host') {
      net.time = timeOfDay; net.day = day; // keep current so late joiners sync via init
      const players = { host: Object.assign({ name: net.myName, skin: W.player.skin, down: !!W.player.downed, asleep: W.player.sleepReady() }, pose) };
      const snap = { t: 'snap', time: timeOfDay, day, e: W.enemies.serialize(), p: players };
      for (const conn of net._conns) { if (conn.open) conn.send(snap); }
    } else if (net.role === 'client') {
      const conn = net._conns[0];
      if (conn && conn.open) conn.send({ t: 'pose', x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, name: net.myName, skin: W.player.skin, down: !!W.player.downed, asleep: W.player.sleepReady() });
    }
  };

  net.updateAvatars = function (dt) {
    for (const id in net.remote) {
      const r = net.remote[id];
      if (!r.pose || !r.avatar) continue;
      const a = r.avatar;
      const k = Math.min(1, dt * 12);
      a.position.x += (r.pose.x - a.position.x) * k;
      a.position.z += (r.pose.z - a.position.z) * k;
      a.position.y = W.world.heightAt(a.position.x, a.position.z);
      a.rotation.y = r.pose.yaw + Math.PI;
    }
  };

  net.sendHit = function (id, dmg) {
    const conn = net._conns[0];
    if (conn && conn.open) {
      const e = W.enemies.list.find((x) => x.id === id);
      conn.send({ t: 'hit', id, dmg: dmg || ATTACK_DMG, x: W.player.pos.x, z: W.player.pos.z, k: e && e.kind === 'werewolf' ? 1 : 0 });
    }
  };

  net.sendChop = function (idx) {
    for (const conn of net._conns) { if (conn.open) conn.send({ t: 'chop', idx }); }
  };

  W.net = net;
})();
