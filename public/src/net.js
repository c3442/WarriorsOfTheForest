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
    const cloth = new THREE.MeshStandardMaterial({ color: girl ? 0xef5aa0 : 0x3f78d8, roughness: 0.85, flatShading: true });
    const lower = new THREE.MeshStandardMaterial({ color: girl ? 0x6a3a8a : 0x2f3d63, roughness: 0.95, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c19a, roughness: 0.8 });
    const hairMat = new THREE.MeshStandardMaterial({ color: girl ? 0x7a4a1f : 0x33241a, roughness: 1, flatShading: true });
    const boot = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, flatShading: true });
    const belt = new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 1, flatShading: true });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.5 });
    // torso + belt (+ a little skirt for the girl skin)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(girl ? 0.5 : 0.54, 0.68, 0.32), cloth);
    torso.position.y = 1.08; torso.castShadow = true; g.add(torso);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(girl ? 0.52 : 0.56, 0.12, 0.34), belt); bl.position.y = 0.76; g.add(bl);
    if (girl) { const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.44, 0.34, 8), cloth); skirt.position.y = 0.6; skirt.castShadow = true; g.add(skirt); }
    // head + hair + fringe + eyes
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skinMat);
    head.position.y = 1.64; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.41, girl ? 0.26 : 0.16, 0.41), hairMat);
    hair.position.y = girl ? 1.76 : 1.81; g.add(hair);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.11, 0.06), hairMat); fringe.position.set(0, 1.73, 0.19); g.add(fringe);
    if (girl) { const pony = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.48, 0.14), hairMat); pony.position.set(0, 1.48, -0.25); g.add(pony); }
    for (const ex of [-0.08, 0.08]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.03), eyeMat); eye.position.set(ex, 1.64, 0.19); g.add(eye); }
    // legs + boots
    for (const sx of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.58, 0.19), lower);
      leg.position.set(sx, 0.34, 0); leg.castShadow = true; g.add(leg);
      const bt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.27), boot); bt.position.set(sx, 0.08, 0.03); g.add(bt);
    }
    // arms + hands
    for (const sx of [-0.34, 0.34]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), cloth);
      arm.position.set(sx, 1.12, 0); arm.castShadow = true; g.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.16), skinMat); hand.position.set(sx, 0.82, 0); g.add(hand);
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
    } else if (m.t === 'gift') {
      const coins = m.coins || 0;
      const total = (W.classes && W.classes.addCoins) ? W.classes.addCoins(coins) : ((W.player.treelingCoins || 0) + coins);
      if (W.player) W.player.treelingCoins = total;
      if (W.hud && W.hud.toast) W.hud.toast('🪙 The maker gave you ' + coins + ' coins! (' + total + ')');
    }
  }

  // Gift a specific teammate some Treeling Coins (maker-only, host->client).
  net.sendGiftTo = function (peerId, coins) {
    for (const c of net._conns) { if (c.peer === peerId && c.open) c.send({ t: 'gift', coins: coins | 0 }); }
  };

  // A downed teammate within reach (so a bandaid can revive them).
  net.anyDownedNear = function (pos, range) {
    for (const id in net.remote) {
      const r = net.remote[id];
      if (r.pose && r.pose.down && Math.hypot(r.pose.x - pos.x, r.pose.z - pos.z) < range) return true;
    }
    return false;
  };
  net.sendRevive = function () { for (const c of net._conns) { if (c.open) c.send({ t: 'revive' }); } };

  // Nearest living teammate's position (a ghost flies to one to revive).
  net.nearestTeammate = function (pos) {
    let best = null, bd = 1e9;
    for (const id in net.remote) {
      const r = net.remote[id];
      if (!r.pose || r.pose.ghost) continue;            // can't revive on another ghost
      const d = Math.hypot(r.pose.x - pos.x, r.pose.z - pos.z);
      if (d < bd) { bd = d; best = { x: r.pose.x, z: r.pose.z }; }
    }
    return best;
  };
  // Ghost state rides along in the pose each tick; this is just a courtesy hook.
  net.sendGhost = function () {};

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
      const players = { host: Object.assign({ name: net.myName, skin: W.player.skin, down: !!W.player.downed, ghost: !!W.player.ghost, asleep: W.player.sleepReady() }, pose) };
      const snap = { t: 'snap', time: timeOfDay, day, e: W.enemies.serialize(), p: players };
      for (const conn of net._conns) { if (conn.open) conn.send(snap); }
    } else if (net.role === 'client') {
      const conn = net._conns[0];
      if (conn && conn.open) conn.send({ t: 'pose', x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, name: net.myName, skin: W.player.skin, down: !!W.player.downed, ghost: !!W.player.ghost, asleep: W.player.sleepReady() });
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

  // --- Public lobby hub ------------------------------------------------------
  // Everyone in the start lobby auto-joins ONE well-known P2P room so they can see
  // each other walk around. The first player claims the hub id (becomes host and
  // relays poses); the rest connect as clients. If the host leaves, a client claims it.
  const HUB_ID = 'wotf-hub-1';
  net.hub = { on: false, role: null, peer: null, conns: [], remote: {}, scene: null, me: null, acc: 0, getPose: null, getName: null, getSkin: null };

  function hubAvatar(id) {
    const h = net.hub, r = h.remote[id]; if (!r) return;
    if (!r.avatar && h.scene) { r.avatar = buildAvatar(r.skin || 'boy'); h.scene.add(r.avatar); }
    if (r.avatar && r.name && r.labelText !== r.name) {
      if (r.label) r.avatar.remove(r.label);
      r.label = makeLabel(r.name); r.labelText = r.name; r.avatar.add(r.label);
    }
  }
  function hubSet(id, m) {
    const h = net.hub; if (!id || id === h.me) return;   // never render myself
    let r = h.remote[id]; if (!r) r = h.remote[id] = { pose: null, avatar: null, name: null, skin: 'boy', label: null, labelText: null };
    r.pose = m;
    if (m.skin && r.skin !== m.skin) { r.skin = m.skin; if (r.avatar && h.scene) { h.scene.remove(r.avatar); r.avatar = null; r.labelText = null; } }
    if (m.name) r.name = m.name;
    hubAvatar(id);
  }
  function hubRemove(id) {
    const h = net.hub, r = h.remote[id];
    if (r && r.avatar && h.scene) h.scene.remove(r.avatar);
    delete h.remote[id];
  }

  net.joinHub = function (opts) {
    const h = net.hub; if (h.on) return; h.on = true;
    h.scene = opts.scene; h.getPose = opts.getPose; h.getName = opts.getName; h.getSkin = opts.getSkin;
    tryHost();
    function tryHost() {
      if (!h.on) return;
      h.role = 'host'; h.me = 'HOST';
      const peer = new Peer(HUB_ID); h.peer = peer;
      peer.on('error', (e) => { if (e && e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) {} beClient(); } });
      peer.on('connection', (conn) => {
        h.conns.push(conn);
        conn.on('data', (m) => {
          if (m.t !== 'hp') return;
          hubSet(conn.peer, m);
          const relay = { t: 'hp', id: conn.peer, x: m.x, y: m.y, z: m.z, yaw: m.yaw, name: m.name, skin: m.skin };
          for (const c of h.conns) { if (c !== conn && c.open) c.send(relay); }   // let the other clients see this one
        });
        conn.on('close', () => { h.conns = h.conns.filter((c) => c !== conn); hubRemove(conn.peer); for (const c of h.conns) { if (c.open) c.send({ t: 'bye', id: conn.peer }); } });
      });
    }
    function beClient() {
      if (!h.on) return;
      h.role = 'client';
      const peer = new Peer(); h.peer = peer;
      peer.on('open', (myid) => {
        h.me = myid;
        const conn = peer.connect(HUB_ID, { reliable: true }); h.conns = [conn];
        conn.on('data', (m) => { if (m.t === 'hp') hubSet(m.id, m); else if (m.t === 'bye') hubRemove(m.id); });
        conn.on('close', () => { if (!h.on) return; for (const id in h.remote) hubRemove(id); h.conns = []; setTimeout(tryHost, 200 + Math.floor(Math.random() * 500)); });   // host vanished -> race to claim the hub
      });
      peer.on('error', () => {});
    }
  };

  net.hubTick = function (dt) {
    const h = net.hub; if (!h.on) return;
    h.acc += dt;
    if (h.acc >= 1 / 12 && h.getPose) {           // broadcast my pose ~12Hz
      h.acc = 0;
      const p = h.getPose();
      if (p) {
        const msg = { t: 'hp', x: p.x, y: p.y, z: p.z, yaw: p.yaw, name: (h.getName && h.getName()) || 'Player', skin: (h.getSkin && h.getSkin()) || 'boy' };
        if (h.role === 'host') { msg.id = 'HOST'; for (const c of h.conns) { if (c.open) c.send(msg); } }
        else { const c = h.conns[0]; if (c && c.open) c.send(msg); }
      }
    }
    for (const id in h.remote) {                   // ease avatars toward their latest pose
      const r = h.remote[id]; if (!r.pose || !r.avatar) continue;
      const a = r.avatar, k = Math.min(1, dt * 12);
      a.position.x += (r.pose.x - a.position.x) * k;
      a.position.z += (r.pose.z - a.position.z) * k;
      a.position.y += (r.pose.y - a.position.y) * k;
      a.rotation.y = r.pose.yaw + Math.PI;
    }
  };

  net.leaveHub = function () {
    const h = net.hub; if (!h.on) return; h.on = false;
    for (const id in h.remote) hubRemove(id);
    try { for (const c of h.conns) { if (c && c.close) c.close(); } } catch (e) {}
    try { if (h.peer) h.peer.destroy(); } catch (e) {}
    h.conns = []; h.peer = null; h.role = null; h.me = null; h.scene = null;
  };

  W.net = net;
})();
