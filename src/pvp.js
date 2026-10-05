/* ==========================================================================
   PvP: lobby, challenges and 1v1 duels.
   Players meet through a free public MQTT broker (no account needed). The
   claude.ai viewer blocks outside connections, so duels run on the website.
   Each player is the authority for their own hero: you send where you are,
   what you shot and your health; hits are judged on the side that gets hit.
   The public broker drops messages above ~10 per second per client (bursts
   included), so a duel sends 7 evenly spaced updates a second, never sends
   extra messages in between, and repeats every shot and knife swing once.
   ========================================================================== */
const PVP_LIBS = ['https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js', 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js'];
const PVP_BROKERS = ['wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const PVP_PFX = 'dustwell-shooter/v1/';
const PVP_HP = 200, PVP_MAP = 1, PVP_ASK_MS = 30000, PVP_SITE = 'https://vibetool.github.io/shooter/', PVP_RATE = 7;
const PVP_ADJ = ['Swift', 'Dusty', 'Brave', 'Sly', 'Lucky', 'Rusty', 'Sandy', 'Wild', 'Quiet', 'Bold', 'Sunny', 'Grumpy'];
const PVP_ANIMAL = ['Fox', 'Lizard', 'Hawk', 'Coyote', 'Gecko', 'Viper', 'Camel', 'Badger', 'Scorpion', 'Owl', 'Hare', 'Lynx'];
const PVP_STATUS = { town: 'In town', run: 'On a run', duel: 'In a duel' };

function loadScript(src) {
  return new Promise(res => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(true); s.onerror = () => { s.remove(); res(false); };
    document.head.appendChild(s);
  });
}

const PVP = {
  state: 'off', client: null, id: 'p' + Math.random().toString(36).slice(2, 10),
  players: {}, outgoing: null, invite: null, match: null, lastStatus: '', beat: 0,
  name() {
    if (!SAVE.pvpName) { SAVE.pvpName = pick(R, PVP_ADJ) + ' ' + pick(R, PVP_ANIMAL) + ' ' + rint(R, 10, 99); persist(); }
    return SAVE.pvpName;
  },
  rename() { SAVE.pvpName = ''; this.name(); this.announce(true); },
  blocked() { return !!(window.claude && typeof window.claude.use === 'function'); },
  async start() {
    if (this.state !== 'off' && this.state !== 'failed') return;
    if (this.blocked()) { this.state = 'blocked'; return; }
    this.state = 'loading';
    if (!window.mqtt) for (const src of PVP_LIBS) { if (await loadScript(src) && window.mqtt) break; }
    if (!window.mqtt) { this.state = 'failed'; return; }
    this.state = 'connecting';
    for (const url of PVP_BROKERS) if (await this.connect(url)) { this.state = 'online'; this.announce(true); return; }
    this.state = 'failed';
  },
  connect(url) {
    return new Promise(resolve => {
      let settled = false;
      const c = mqtt.connect(url, {
        clientId: 'dws_' + this.id + '_' + Math.random().toString(36).slice(2, 6), keepalive: 30, clean: true,
        reconnectPeriod: 4000, connectTimeout: 10000, will: { topic: PVP_PFX + 'p/' + this.id, payload: '', retain: true, qos: 0 }
      });
      const done = ok => { if (settled) return; settled = true; if (!ok) { try { c.end(true); } catch (e) { /* closed */ } } resolve(ok); };
      c.on('connect', () => {
        c.subscribe([PVP_PFX + 'p/+', PVP_PFX + 'u/' + this.id], { qos: 1 });
        if (this.match) c.subscribe(this.match.topic, { qos: 0 });
        if (!settled) { this.client = c; done(true); } else if (this.client === c) this.announce(true);
      });
      c.on('message', (topic, buf) => this.onMessage(topic, buf));
      c.on('error', () => {});
      setTimeout(() => done(false), 11000);
    });
  },
  status() { return this.match ? 'duel' : SCENES.some(sc => sc instanceof Play && !(sc instanceof PvpMatch)) ? 'run' : 'town'; },
  announce(force) {
    if (!this.client || this.state !== 'online') return;
    const st = this.status();
    if (!force && st === this.lastStatus) return;
    this.lastStatus = st; this.beat = performance.now();
    this.pub('p/' + this.id, { id: this.id, n: this.name(), s: st, v: 1 }, true);
  },
  pub(path, obj, retain = false, qos = 0) {
    if (this.client) this.client.publish(PVP_PFX + path, obj == null ? '' : JSON.stringify(obj), { qos, retain });
  },
  send(to, obj) { obj.from = this.id; this.pub('u/' + to, obj, false, 1); },
  tick() {
    if (this.state !== 'online') return;
    const now = performance.now();
    this.announce(now - this.beat > 15000);
    for (const id in this.players) if (now - this.players[id].seen > 40000) delete this.players[id];
    const o = this.outgoing;
    if (o && Date.now() - o.at > PVP_ASK_MS) { this.send(o.to, { t: 'cancel', mid: o.mid }); Game.toast('No answer from ' + o.name); this.outgoing = null; }
  },
  onMessage(topic, buf) {
    const rest = topic.slice(PVP_PFX.length), txt = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
    let m = null;
    if (txt) { try { m = JSON.parse(txt); } catch (e) { return; } }
    if (rest.startsWith('p/')) {
      const id = rest.slice(2); if (id === this.id) return;
      if (!m) delete this.players[id];
      else this.players[id] = { id, name: String(m.n || 'Player').slice(0, 24), st: PVP_STATUS[m.s] ? m.s : 'town', seen: performance.now() };
    } else if (rest === 'u/' + this.id) { if (m && typeof m.from === 'string') this.onInbox(m); }
    else if (this.match && rest === 'm/' + this.match.mid) { if (m) this.match.onNet(m); }
  },
  onInbox(m) {
    const from = m.from, known = this.players[from];
    if (m.t === 'inv') {
      if (this.match || this.invite) { this.send(from, { t: 'ans', mid: m.mid, ok: false, why: 'busy' }); return; }
      if (this.outgoing) { this.send(this.outgoing.to, { t: 'cancel', mid: this.outgoing.mid }); this.outgoing = null; }
      this.invite = { from, name: String(m.n || (known && known.name) || 'A player').slice(0, 24), bo: m.bo === 3 ? 3 : 1, mid: String(m.mid), at: Date.now(), accepted: false };
      const top = topScene(); if (top instanceof Play && !(top instanceof PvpMatch)) top.paused = true;
      pushScene(new PvpInviteDialog()); sfx('coin-d', 0.6);
    } else if (m.t === 'ans') {
      const o = this.outgoing; if (!o || o.mid !== m.mid || o.to !== from) return;
      this.outgoing = null;
      if (m.ok) { this.send(from, { t: 'go', mid: m.mid }); this.startMatch({ mid: m.mid, role: 'A', opp: from, oppName: o.name, bo: o.bo }); }
      else { sfx('error-a'); Game.toast(o.name + (m.why === 'busy' ? ' is busy right now' : ' declined the duel')); }
    } else if (m.t === 'go') {
      const inv = this.invite; if (!inv || inv.mid !== m.mid || !inv.accepted) return;
      this.invite = null; this.startMatch({ mid: inv.mid, role: 'B', opp: inv.from, oppName: inv.name, bo: inv.bo });
    } else if (m.t === 'cancel') {
      const inv = this.invite; if (!inv || inv.mid !== m.mid) return;
      this.invite = null; Game.toast(inv.name + ' withdrew the challenge');
    }
  },
  challenge(pl, bo) {
    if (this.outgoing || this.match || this.state !== 'online') return;
    const mid = this.id + '-' + Date.now().toString(36);
    this.outgoing = { to: pl.id, name: pl.name, bo, mid, at: Date.now() };
    this.send(pl.id, { t: 'inv', n: this.name(), bo, mid });
  },
  cancelChallenge() { const o = this.outgoing; if (!o) return; this.send(o.to, { t: 'cancel', mid: o.mid }); this.outgoing = null; },
  answer(ok) {
    const inv = this.invite; if (!inv || inv.accepted) return;
    this.send(inv.from, { t: 'ans', mid: inv.mid, ok, why: ok ? '' : 'no' });
    if (ok) { inv.accepted = true; inv.acceptedAt = Date.now(); } else this.invite = null;
  },
  startMatch(o) {
    this.match = new PvpMatch(o);
    if (this.client) this.client.subscribe(this.match.topic, { qos: 0 });
    setScene(this.match); this.announce(true);
  },
  endMatch() {
    if (this.client && this.match) this.client.unsubscribe(this.match.topic);
    this.match = null; this.announce(true);
  },
  openLobby() { setScene(new Home()); pushScene(new Levels()); pushScene(new PvpLobby()); }
};
setInterval(() => PVP.tick(), 1000);
window.addEventListener('pagehide', () => { if (PVP.client) { PVP.pub('p/' + PVP.id, null, true); try { PVP.client.end(); } catch (e) { /* closing */ } } });

/* ---------------- lobby: who is online, challenge them ---------------- */
class PvpLobby extends MenuScene {
  constructor() { super(); this.scroll = 0; PVP.start(); }
  key(k) { if (k === 'escape') popScene(this); }
  wheel(d) { this.scroll = Math.max(0, this.scroll + d); }
  draw() {
    sandBg(); this.begin();
    panel('red', 150, 6, 160, 30); ptext('PVP', 230, 15, 'B', 'center');
    textButton(this, 'grey', 10, 10, 50, 21, 'Back', () => popScene(this));
    stext(`Record: ${SAVE.pvp.wins} won, ${SAVE.pvp.losses} lost`, 450, 21, 5.4, P.dark, 'right', 600);
    const st = PVP.state, nameX = 30 + textW('You are ', 5.8, 500);
    stext('You are ', 30, 49, 5.8, P.dark, 'left', 500);
    stext(PVP.name(), nameX, 49, 6.4, P.dark, 'left', 700);
    textButton(this, 'grey', nameX + textW(PVP.name(), 6.4, 700) + 8, 40, 56, 18, 'New name', () => PVP.rename());
    const pill = { online: ['Online', P.teal], loading: ['Connecting', P.yel], connecting: ['Connecting', P.yel], failed: ['Offline', P.lav], blocked: ['Website only', P.lav], off: ['Offline', P.lav] }[st];
    const pw = textW(pill[0], 5.2, 700) + 12;
    ctx.fillStyle = P.dark; ctx.fillRect(430 - pw, 42, pw, 13); ctx.fillStyle = pill[1]; ctx.fillRect(431 - pw, 43, pw - 2, 11);
    stext(pill[0], 430 - pw / 2, 49, 5.2, P.dark, 'center', 700);
    stext(`Every gun is unlocked, both players have ${PVP_HP} health, map: Cactus Flats (Level 2)`, 230, 64, 5, P.dark, 'center', 500);
    panel('blue', 30, 72, 400, 148);
    const say = (lines, y0 = 112) => lines.forEach((l, k) => stext(l, 230, y0 + k * 11, k === 0 ? 6.4 : 5.4, P.white, 'center', k === 0 ? 700 : 500));
    if (st === 'blocked') say(['Duels need the website version of the game', 'Open ' + PVP_SITE + ' in your browser', 'and press PVP on the level screen.']);
    else if (st === 'loading' || st === 'connecting' || st === 'off') say(['Connecting to the duel server...', 'This takes a few seconds.']);
    else if (st === 'failed') {
      say(['Could not reach the duel server', 'Check your connection and try again.'], 104);
      textButton(this, 'grey', 200, 140, 60, 21, 'Retry', () => { PVP.state = 'off'; PVP.start(); });
    } else {
      const list = Object.values(PVP.players).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) say(['No one else is online right now', 'Send a friend the game link: ' + PVP_SITE, 'They show up here once they open PVP.']);
      const rows = 5; this.scroll = Math.min(this.scroll, Math.max(0, list.length - rows));
      list.slice(this.scroll, this.scroll + rows).forEach((pl, k) => {
        const y = 82 + k * 26, free = pl.st !== 'duel' && !PVP.outgoing;
        if (k) { ctx.fillStyle = 'rgba(71,50,75,0.35)'; ctx.fillRect(42, y - 3, 376, 1); }
        stext(pl.name, 46, y + 9, 6.4, P.white, 'left', 700);
        stext(PVP_STATUS[pl.st], 190, y + 9, 5.2, P.yelL, 'left', 600);
        ctx.globalAlpha = free ? 1 : 0.45;
        textButton(this, 'grey', 282, y + 1, 58, 17, 'One round', free ? () => PVP.challenge(pl, 1) : null);
        textButton(this, 'grey', 346, y + 1, 70, 17, 'Best of three', free ? () => PVP.challenge(pl, 3) : null);
        ctx.globalAlpha = 1;
      });
      if (list.length > rows) stext(`Scroll for more (${list.length} online)`, 230, 212, 4.6, P.white, 'center', 500);
    }
    const o = PVP.outgoing;
    if (o) {
      const left = Math.max(0, Math.ceil((PVP_ASK_MS - (Date.now() - o.at)) / 1000));
      ctx.fillStyle = P.white; ctx.fillRect(90, 225, 280, 24); ctx.fillStyle = P.dark; ctx.fillRect(91, 226, 278, 22);
      stext(`Waiting for ${o.name} to answer (${left}s)`, 100, 237, 5.6, P.white, 'left', 600);
      textButton(this, 'grey', 312, 228, 52, 17, 'Cancel', () => PVP.cancelChallenge());
    }
    this.end();
  }
}

/* ---------------- popup on the challenged player's screen ---------------- */
class PvpInviteDialog extends MenuScene {
  key(k) { if (k === 'escape') this.decline(); if (k === 'enter') PVP.answer(true); }
  decline() { PVP.answer(false); popScene(this); }
  update(dt) {
    super.update(dt);
    const inv = PVP.invite;
    if (!inv) { popScene(this); return; }
    if (!inv.accepted && Date.now() - inv.at > PVP_ASK_MS) { PVP.answer(false); popScene(this); Game.toast('The duel request timed out'); }
    else if (inv.accepted && Date.now() - inv.acceptedAt > 6000) { PVP.invite = null; popScene(this); Game.toast('The challenge expired'); }
  }
  draw() {
    dim(); this.begin();
    const inv = PVP.invite; if (!inv) { this.end(); return; }
    const x = 120, y = 62, w = 220, h = 130, under = SCENES[SCENES.indexOf(this) - 1];
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('DUEL', x + w / 2, y + 10, 'B', 'center');
    stext(`${inv.name} challenges you!`, x + w / 2, y + 38, 7, P.dark, 'center', 700);
    stext(inv.bo === 3 ? 'Best of three rounds' : 'One round', x + w / 2, y + 50, 5.8, P.redD, 'center', 700);
    stext(`Cactus Flats, ${PVP_HP} health each, every gun unlocked`, x + w / 2, y + 61, 4.8, P.dark, 'center', 500);
    if (under instanceof Play) stext('Accepting ends your current run. Your gold is kept.', x + w / 2, y + 71, 4.6, P.dark, 'center', 500);
    if (inv.accepted) stext('Starting the duel...', x + w / 2, y + 96, 6.4, P.dark, 'center', 700);
    else {
      textButton(this, 'red', x + 34, y + 84, 70, 21, 'Accept', () => PVP.answer(true));
      textButton(this, 'grey', x + w - 104, y + 84, 70, 21, 'Decline', () => this.decline());
      stext(`Answer within ${Math.max(0, Math.ceil((PVP_ASK_MS - (Date.now() - inv.at)) / 1000))}s`, x + w / 2, y + 116, 4.8, P.dark, 'center', 600);
    }
    this.end();
  }
}

/* ---------------- the duel ---------------- */
class PvpMatch extends Play {
  constructor(o) {
    super(PVP_MAP, { pvp: true });
    this.mid = o.mid; this.role = o.role; this.oppId = o.opp; this.oppName = o.oppName; this.bestOf = o.bo;
    this.topic = PVP_PFX + 'm/' + this.mid; this.need = this.bestOf === 3 ? 2 : 1;
    this.round = 1; this.myWins = 0; this.oppWins = 0; this.roundResult = '';
    this.obullets = []; this.outShots = []; this.prevShots = []; this.outKnife = null; this.prevKnife = null; this.sendT = 0;
    this.seq = 0; this.seen = new Set();
    this.lastRecv = performance.now(); this.gotAny = false; this.started = performance.now();
    // spawn points: the map's start and the walkable cell farthest from it, kept off the map border
    const m = this.map, d = new Int16Array(m.W * m.H), a = m.spawn.y * m.W + m.spawn.x;
    this.bfs(a, d);
    let far = a;
    for (const i of m.floor) {
      const cx = i % m.W, cy = Math.floor(i / m.W);
      if (cx >= 2 && cy >= 2 && cx <= m.W - 3 && cy <= m.H - 3 && d[i] > d[far]) far = i;
    }
    this.spawnA = { x: m.spawn.x * T + 8, y: m.spawn.y * T + 10 };
    this.spawnB = { x: (far % m.W) * T + 8, y: Math.floor(far / m.W) * T + 10 };
    const p = this.p; p.maxHp = PVP_HP; p.shield = p.maxShield = 0;
    this.opp = { x: 0, y: 0, tx: 0, ty: 0, aim: 0, wi: 0, hp: PVP_HP, moving: false, walk: 0, dead: false, knifeT: 0, knifeA: 0 };
    if (p.wi < 0) this.equip(0);
    this.resetRound();
    Music.intensity = 1; sfx('jump-c', 0.6);
  }
  // monster-run extras stay off in duels
  autoKnife() {} autoShot() {} upgradesTick() {} blur() {}
  nearestEnemy(r) { const o = this.opp; return !o.dead && Math.hypot(o.x - this.p.x, o.y - this.p.y) < r ? { x: o.x, y: o.y, scale: 1 } : null; }
  equip(wi) { const p = this.p; if (p.wi === wi) return; p.wi = wi; p.ammo = wi >= 0 ? WEAPONS[wi].mag : 0; p.reload = 0; p.cd = 0.2; sfx('move-a', 0.6); }
  cycleWeapon(dir) { const n = WEAPONS.length + 1; this.equip(((this.p.wi + 1 + dir + n) % n) - 1); }
  resetRound() {
    const me = this.role === 'A' ? this.spawnA : this.spawnB, them = this.role === 'A' ? this.spawnB : this.spawnA, p = this.p, o = this.opp;
    const h = this.map.hgt[this.cell(me.x, me.y)];
    Object.assign(p, { x: me.x, y: me.y, vx: 0, vy: 0, hp: PVP_HP, dead: false, reload: 0, cd: 0, inv: 0, dashT: 0, h: h === 1 ? 1 : 0, ramp: h === 2 });
    if (p.wi >= 0) p.ammo = WEAPONS[p.wi].mag;
    Object.assign(o, { x: them.x, y: them.y, tx: them.x, ty: them.y, hp: PVP_HP, dead: false, knifeT: 0 });
    this.bullets = []; this.obullets = []; this.outShots = []; this.prevShots = []; this.outKnife = this.prevKnife = null; this.roundResult = '';
    this.phase = 'countdown'; this.phaseT = 3; this.noInput = true; this.snapCam();
  }
  onShots(list) {
    const r2 = v => Math.round(v * 10) / 10;
    for (const b of list) if (this.outShots.length < 40) this.outShots.push([++this.seq, r2(b.x), r2(b.y), Math.round(Math.atan2(b.vy, b.vx) * 1000) / 1000, Math.round(Math.hypot(b.vx, b.vy)), b.wi, Math.round(b.life * 100) / 100]);
  }
  onKnife(a) { this.outKnife = [++this.seq, Math.round(a * 100) / 100]; }
  fresh(id) { if (this.seen.has(id)) return false; this.seen.add(id); if (this.seen.size > 600) this.seen.delete(this.seen.values().next().value); return true; }
  sendState() {
    if (!PVP.client || this.phase === 'over') return;
    const p = this.p, r2 = v => Math.round(v * 10) / 10;
    const msg = { i: PVP.id, r: this.round, x: r2(p.x), y: r2(p.y), a: Math.round(p.aim * 100) / 100, w: p.wi, hp: r2(p.hp), mv: p.moving ? 1 : 0 };
    // every shot and knife swing rides in two packets in a row, in case one is dropped
    const sh = this.prevShots.concat(this.outShots); if (sh.length) msg.sh = sh;
    this.prevShots = this.outShots; this.outShots = [];
    const kn = [this.prevKnife, this.outKnife].filter(Boolean); if (kn.length) msg.k = kn;
    this.prevKnife = this.outKnife; this.outKnife = null;
    if (p.dead) msg.d = this.round;
    PVP.client.publish(this.topic, JSON.stringify(msg), { qos: 0 });
  }
  onNet(m) {
    if (m.i !== this.oppId) return;
    this.lastRecv = performance.now(); this.gotAny = true;
    if (m.leave) { this.finishDuel('left'); return; }
    if (m.r !== this.round || this.phase === 'over') return;
    const o = this.opp;
    if (typeof m.x === 'number' && typeof m.y === 'number') { o.tx = m.x; o.ty = m.y; }
    if (typeof m.a === 'number') o.aim = m.a;
    if (typeof m.w === 'number' && m.w >= -1 && m.w < WEAPONS.length) o.wi = m.w;
    o.moving = !!m.mv;
    if (typeof m.hp === 'number') {
      if (m.hp < o.hp && SAVE.settings.nums) this.nums.push({ x: o.x, y: o.y - 22, t: 0.7, v: Math.round((o.hp - m.hp) * 10) / 10 });
      o.hp = Math.max(0, m.hp);
    }
    if (Array.isArray(m.k)) for (const k of m.k) if (Array.isArray(k) && Number.isFinite(k[1]) && this.fresh(k[0])) { o.knifeT = 0.2; o.knifeA = k[1]; this.knifeFrom(k[1]); }
    if (Array.isArray(m.sh)) for (const s of m.sh) this.theirShot(s);
    if (m.d === this.round && !o.dead) {
      o.dead = true; this.puff(o.x, o.y - 4, 16, P.blue, 60);
      if (this.phase === 'fight') this.roundOver(true);
      else if (this.phase === 'roundEnd' && this.roundResult === 'lost') { this.oppWins--; this.roundResult = 'draw'; }
    }
  }
  theirShot(s) {
    if (!Array.isArray(s) || s.length < 7 || !this.fresh(s[0])) return;
    const [, x, y, a, v, wi, life] = s;
    if (!(wi >= 0 && wi < WEAPONS.length) || ![x, y, a, v, life].every(Number.isFinite)) return;
    const w = WEAPONS[wi];
    this.obullets.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: Math.min(life, 2), wi, kind: w.kind, splash: w.splash || 0 });
  }
  knifeFrom(a) {
    const p = this.p, o = this.opp, dx = p.x - o.tx, dy = p.y - o.ty, d = Math.hypot(dx, dy);
    if (d < KNIFE.range + 6 && (Math.abs(angDiff(Math.atan2(dy, dx), a)) < 1.2 || d < 12)) this.takeHit(KNIFE.dmg, null);
  }
  splashMe(b, direct) {
    const p = this.p, d = Math.hypot(p.x - b.x, p.y - 6 - b.y);
    this.puff(b.x, b.y, 10, P.purp, 70);
    if (direct) this.takeHit(WEAPONS[b.wi].dmg, b); else if (d < b.splash) this.takeHit(WEAPONS[b.wi].dmg * 0.6, b);
  }
  takeHit(dmg, b) {
    const p = this.p; if (p.dead || p.inv > 0 || this.phase !== 'fight') return;
    p.hp = Math.max(0, p.hp - dmg);
    if (SAVE.settings.nums) this.nums.push({ x: p.x, y: p.y - 22, t: 0.7, v: Math.round(dmg * 10) / 10, col: P.redL });
    sfx('hurt-a', 0.45, 1, 0.08); if (SAVE.settings.shake) this.shake = Math.max(this.shake, 3);
    if (b) { const sp = Math.hypot(b.vx, b.vy) || 1; p.vx += b.vx / sp * 40; p.vy += b.vy / sp * 40; }
    if (p.hp <= 0) { p.dead = true; this.puff(p.x, p.y - 4, 16, P.blue, 60); this.roundOver(false); }
  }
  roundOver(iWon) {
    if (this.phase !== 'fight') return;
    this.phase = 'roundEnd'; this.phaseT = 3; this.noInput = true; this.roundResult = iWon ? 'won' : 'lost';
    if (iWon) this.myWins++; else this.oppWins++;
    sfx(iWon ? 'coin-d' : 'lose-d', 0.7);
  }
  finishDuel(how) {
    if (this.phase === 'over') return;
    this.phase = 'over'; this.noInput = true; this.outcome = how;
    if (how === 'won' || how === 'left') SAVE.pvp.wins++; else if (how === 'lost' || how === 'quit') SAVE.pvp.losses++;
    persist();
    if (how === 'quit' && PVP.client) PVP.client.publish(this.topic, JSON.stringify({ i: PVP.id, leave: 1 }), { qos: 1 });
    PVP.endMatch();
    sfx(how === 'won' || how === 'left' ? 'coin-d' : how === 'noshow' ? 'error-a' : 'lose-a', 0.8);
  }
  update(dt) {
    this.t += dt;
    const p = this.p, o = this.opp, m = this.map;
    if (this.phase === 'countdown' && (this.phaseT -= dt) <= 0) { this.phase = 'fight'; this.noInput = false; this.fightT = 0.8; sfx('jump-c', 0.6, 1.2); }
    else if (this.phase === 'roundEnd' && (this.phaseT -= dt) <= 0) {
      if (this.myWins >= this.need || this.oppWins >= this.need) this.finishDuel(this.myWins >= this.need ? 'won' : 'lost');
      else { this.round++; this.resetRound(); }
    }
    this.fightT = Math.max(0, (this.fightT || 0) - dt);
    this.controlPlayer(dt);
    // the other duelist glides toward their last reported spot
    if (Math.hypot(o.tx - o.x, o.ty - o.y) > 90) { o.x = o.tx; o.y = o.ty; }
    else { const k = Math.min(1, dt * 9); o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    if (o.moving) o.walk += dt; o.knifeT = Math.max(0, o.knifeT - dt);
    const outside = (x, y) => (m.solid[this.cell(x, y)] & 2) || x < 0 || y < 0 || x > m.W * T || y > m.H * T;
    // my bullets only show where they land; the other player judges real hits
    for (const b of this.bullets) {
      b.life -= dt; const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (outside(nx, ny)) { b.life = 0; this.spark(b.x, b.y, 3, P.white); if (b.splash) this.puff(b.x, b.y, 10, P.purp, 70); continue; }
      b.x = nx; b.y = ny;
      if (!o.dead && Math.abs(o.x - b.x) < 6 && Math.abs(o.y - 7 - b.y) < 8) { b.life = 0; this.spark(b.x, b.y, 3); if (b.splash) this.puff(b.x, b.y, 10, P.purp, 70); }
    }
    this.bullets = this.bullets.filter(b => b.life > 0);
    // their bullets can hurt me
    for (const b of this.obullets) {
      b.life -= dt; const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (outside(nx, ny)) { b.life = 0; this.spark(b.x, b.y, 3, P.redL); if (b.splash) this.splashMe(b, false); continue; }
      b.x = nx; b.y = ny;
      if (!p.dead && Math.abs(b.x - p.x) < 5 && Math.abs(b.y - (p.y - 6)) < 7) { b.life = 0; if (b.splash) this.splashMe(b, true); else this.takeHit(WEAPONS[b.wi].dmg, b); }
    }
    this.obullets = this.obullets.filter(b => b.life > 0);
    // network: a few updates a second, and watch for a missing opponent
    if ((this.sendT -= dt) <= 0) { this.sendT = 1 / PVP_RATE; this.sendState(); }
    if (this.phase !== 'over') {
      const now = performance.now();
      if (this.gotAny && now - this.lastRecv > 10000) this.finishDuel('left');
      else if (!this.gotAny && now - this.started > 15000) this.finishDuel('noshow');
    }
    this.updateFx(dt); this.updateCamera(dt);
  }
  key(k) {
    if (this.phase === 'over') { if (k === 'enter' || k === 'escape') PVP.openLobby(); return; }
    if (k === 'escape') { this.paused = !this.paused; return; }
    if (this.paused) return;
    if (k === 'r') this.startReload();
    if (k === ' ' || k === 'shift') this.dash();
    if (k === 'q' || k === 'tab') this.cycleWeapon(1);
    if (k >= '1' && k <= '8') { const wi = +k - 1; this.equip(this.p.wi === wi ? wi + ORANGE_N : wi); }
    if (k === '0') this.equip(-1);
  }
  wheel(dir) { if (!this.paused && this.phase !== 'over') this.cycleWeapon(dir); }
  click(px, py) {
    if (!this.paused && this.phase !== 'over') return;
    const [mx, my] = toMenu(px, py);
    for (let i = this.hot.length - 1; i >= 0; i--) { const h = this.hot[i]; if (mx >= h.x && my >= h.y && mx < h.x + h.w && my < h.y + h.h) { sfx('select-a', 0.7); h.fn(); return; } }
  }
  touchStart(id, x, y) { if (this.paused || this.phase === 'over') { IN.mx = x; IN.my = y; this.click(x, y); return; } super.touchStart(id, x, y); }
  leave() { this.finishDuel('quit'); PVP.openLobby(); }
  drawOpp() {
    const o = this.opp, flip = Math.cos(o.aim) < 0;
    ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 3, 6, 2.2, 0, 0, TAU); ctx.fill();
    const fr = o.dead ? 15 : o.moving ? (Math.floor(o.walk * 8) % 2 ? 13 : 12) : (Math.floor(this.t * 1.6) % 2 ? 12 : 13);
    spr('enemies', fr, Math.round(o.x) - 12, Math.round(o.y) - 20, flip ? { flip: true } : null);
    if (!o.dead) {
      if (o.knifeT > 0 || o.wi < 0) {
        const ka = o.knifeT > 0 ? o.knifeA : o.aim, kl = Math.cos(ka) < 0, sw = o.knifeT > 0 ? (1 - o.knifeT / 0.2) * 2.2 - 1.1 : 0.5, a = ka + (kl ? -sw : sw);
        spr('weapons', KNIFE.tile, o.x + Math.cos(a) * 9 - 12, o.y - 7 + Math.sin(a) * 9 - 12, { rot: a + Math.PI / 2 });
      }
      if (o.wi >= 0) spr('weapons', WEAPONS[o.wi].tile, o.x + Math.cos(o.aim) * 7 - 12, o.y - 6 + Math.sin(o.aim) * 7 - 12, { rot: o.aim, flipY: Math.cos(o.aim) < 0 });
    }
    stextO(this.oppName, o.x, o.y - 26, 4.6, P.redL, P.dark, 'center', 700, 1.8);
  }
  drawHud() {
    const u = this.hudScale(); ctx.setTransform(u, 0, 0, u, 0, 0); ctx.imageSmoothingEnabled = false;
    const HW = CW / u, HH = CH / u, p = this.p, o = this.opp;
    // health: you on the left, them on the right
    stextO('You', 8, 9, 5.4, P.white, P.dark, 'left', 700, 2);
    bar(6, 14, 100, 12, p.hp / PVP_HP, 'red', 5); stextO(String(Math.ceil(p.hp)), 110, 20, 5.4, P.white, P.dark, 'left', 700, 2);
    stextO(this.oppName, HW - 8, 9, 5.4, P.white, P.dark, 'right', 700, 2);
    bar(HW - 106, 14, 100, 12, o.hp / PVP_HP, 'red', 5); stextO(String(Math.ceil(o.hp)), HW - 110, 20, 5.4, P.white, P.dark, 'right', 700, 2);
    stextO(`${this.myWins} : ${this.oppWins}`, HW / 2, 12, 9, P.yelL, P.dark, 'center', 700, 2.6);
    stextO(this.bestOf === 3 ? `Round ${this.round}, best of three` : 'One round', HW / 2, 24, 5, P.white, P.dark, 'center', 600, 2);
    // where the other duelist is when off screen
    const v = this.view(), sx = (o.x - this.cam.x) / v.w * HW, sy = (o.y - 8 - this.cam.y) / v.h * HH;
    if (!o.dead && (sx < 0 || sy < 0 || sx > HW || sy > HH)) {
      const a = Math.atan2(sy - HH / 2, sx - HW / 2), r = Math.min(HW, HH) / 2 - 22;
      spr('ui', 75, HW / 2 + Math.cos(a) * r - 8, HH / 2 + Math.sin(a) * r - 8, { rot: a + Math.PI / 2 });
    }
    // weapon box: every gun is unlocked here
    panel('blue', 4, HH - 40, 112, 34, false);
    const w = p.wi >= 0 ? WEAPONS[p.wi] : null;
    spr('weapons', w ? w.tile : KNIFE.tile, 10, HH - 35);
    stextO(w ? w.name : 'Knife', 36, HH - 28, 5.2, P.white, P.dark, 'left', 700, 2);
    stextO(!w ? 'Click to swing' : p.reload > 0 ? 'Reloading' : `${p.ammo} / ${w.mag}`, 36, HH - 18, 5.4, w && (p.ammo === 0 || p.reload > 0) ? P.yelL : P.white, P.dark, 'left', 700, 2);
    stextO('Q or wheel: switch gun. 1-8: pick one, press twice for green.', 6, HH - 46, 4.4, P.white, P.dark, 'left', 600, 1.6);
    // round banners
    let lines = null, sub = '';
    if (this.phase === 'countdown') { lines = [String(Math.max(1, Math.ceil(this.phaseT)))]; sub = this.round === 1 ? `Duel with ${this.oppName}` : `Round ${this.round}`; }
    else if (this.phase === 'fight' && this.fightT > 0) lines = ['FIGHT'];
    else if (this.phase === 'roundEnd') { lines = [this.roundResult === 'won' ? 'ROUND WON' : this.roundResult === 'draw' ? 'DRAW' : 'ROUND LOST']; sub = `${this.myWins} : ${this.oppWins}`; }
    if (lines) {
      const lw = Math.max(...lines.map(l => ptW(l, 'B'))) + 40, bh = 45, bx = HW / 2 - lw / 2, by = HH * 0.3 - bh / 2;
      panel('red', bx, by, lw, bh); ptext(lines[0], HW / 2, by + 16, 'B', 'center');
      if (sub) stextO(sub, HW / 2, by + bh + 9, 6, P.white, P.dark, 'center', 700, 2.2);
    }
    if (IN.touch) { ctx.globalAlpha = 0.6; btn('grey', HW - 22, HH - 24, 18, 18, false); stext('II', HW - 13, HH - 15.5, 6, P.dark, 'center', 700); ctx.globalAlpha = 1; }
    this.hot = [];
    if (this.phase === 'over') this.drawDuelResult();
    else if (this.paused) this.drawLeave();
    else if (!IN.touch && !p.dead) { cv.style.cursor = 'none'; spr('weapons', p.reload > 0 ? 29 : 25, IN.mx / u - 12, IN.my / u - 12); }
  }
  drawLeave() {
    cv.style.cursor = 'default'; dim(); menuXf();
    const x = 140, y = 80, w = 180, h = 90;
    panel('grey', x, y, w, h);
    stext('Leave the duel?', x + w / 2, y + 24, 7, P.dark, 'center', 700);
    stext('Leaving counts as a loss. The duel keeps going.', x + w / 2, y + 37, 4.8, P.dark, 'center', 500);
    let any = this.overlayBtn('red', x + 20, y + 54, 64, 21, 'Leave', () => this.leave());
    any = this.overlayBtn('grey', x + 96, y + 54, 64, 21, 'Stay', () => { this.paused = false; }) || any;
    cv.style.cursor = any ? 'pointer' : 'default';
  }
  drawDuelResult() {
    cv.style.cursor = 'default'; dim(); menuXf();
    const how = this.outcome, x = 120, y = 50, w = 220, h = 150, won = how === 'won' || how === 'left';
    panel('grey', x, y, w, h);
    panel('red', x + 20, y - 10, w - 40, 30);
    ptext(how === 'noshow' ? 'NO DUEL' : won ? 'VICTORY' : 'DEFEAT', x + w / 2, y - 1, 'B', 'center');
    stext(`You ${this.myWins} : ${this.oppWins} ${this.oppName}`, x + w / 2, y + 36, 7, P.dark, 'center', 700);
    const note = { left: `${this.oppName} left the duel, so you win.`, noshow: `${this.oppName} never joined the duel.`, quit: 'You left the duel.', won: 'Nice shooting!', lost: 'Gear up and try again.' }[how];
    stext(note, x + w / 2, y + 52, 5.6, P.redD, 'center', 600);
    stext(`Your record: ${SAVE.pvp.wins} won, ${SAVE.pvp.losses} lost`, x + w / 2, y + 66, 5.4, P.dark, 'center', 500);
    let any = this.overlayBtn('red', x + 20, y + h - 40, 84, 21, 'Back to PvP', () => PVP.openLobby());
    any = this.overlayBtn('grey', x + w - 104, y + h - 40, 84, 21, 'Town', () => setScene(new Home())) || any;
    cv.style.cursor = any ? 'pointer' : 'default';
  }
}
