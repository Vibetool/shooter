/* ==========================================================================
   PvP: lobby, challenges and 1v1 duels.
   Players meet through a free public MQTT broker (no account needed). The
   claude.ai viewer blocks outside connections, so duels run on the website.
   Each player is the authority for their own hero: you send where you are,
   what you shot and your health; hits are judged on the side that gets hit.
   The public broker drops messages above ~10 per second per client (bursts
   included), so a duel sends 7 evenly spaced updates a second, never sends
   extra messages in between, and repeats every shot and knife swing once.
   Every copy of the game keeps a small account summary on the broker (retained),
   so the admin can see players who are offline. Admin changes are stored the same
   way, signed (ECDSA) with a key derived from the admin password, and applied the
   next time that player opens the game. Only the public half of that key lives
   here, so a copy of the game can check admin changes but cannot make them.
   Without a real server a modified copy can still ignore them.
   ========================================================================== */
const PVP_LIBS = ['https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js', 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js'];
const PVP_BROKERS = ['wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const PVP_PFX = 'dustwell-shooter/v1/';
/* in a duel you regenerate 3 health a second once 1 s has passed since the last hit;
   after 3 s, holding P heals 10 a second instead (the two do not stack) */
const PVP_REGEN_WAIT = 1, PVP_REGEN_RATE = 3, PVP_HEAL_WAIT = 3, PVP_HEAL_RATE = 10;
const PVP_HP = 200, PVP_MAP = 1, PVP_ASK_MS = 30000, PVP_SITE = 'https://vibetool.github.io/shooter/', PVP_RATE = 7;
const PVP_ADJ = ['Swift', 'Dusty', 'Brave', 'Sly', 'Lucky', 'Rusty', 'Sandy', 'Wild', 'Quiet', 'Bold', 'Sunny', 'Grumpy'];
const PVP_ANIMAL = ['Fox', 'Lizard', 'Hawk', 'Coyote', 'Gecko', 'Viper', 'Camel', 'Badger', 'Scorpion', 'Owl', 'Hare', 'Lynx'];
const PVP_STATUS = { town: 'In town', run: 'On a run', duel: 'In a duel' };
const PVP_ADMIN_SALT = 'dustwell-admin-v2';
const PVP_ADMIN_PUB = { kty: 'EC', crv: 'P-256', x: 'I-iTWHWYpGV1cvJxuZ3NjigCe6DtNSTbQtKyz6OdsEE', y: 'ZhjfHHvicswI3Am3w9Uaz9GHbhI8Lnszfx3ksO8V6ss' };
const ECDSA_KEY = { name: 'ECDSA', namedCurve: 'P-256' }, ECDSA_SIG = { name: 'ECDSA', hash: 'SHA-256' };
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
let adminPub = null;
/* admin messages are { d: JSON text, s: signature of d }; returns the parsed data, or null if the signature is wrong */
async function adminOpen(m) {
  try {
    if (!m || typeof m.d !== 'string' || typeof m.s !== 'string') return null;
    adminPub = adminPub || await crypto.subtle.importKey('jwk', PVP_ADMIN_PUB, ECDSA_KEY, false, ['verify']);
    return (await crypto.subtle.verify(ECDSA_SIG, adminPub, unb64u(m.s), new TextEncoder().encode(m.d))) ? JSON.parse(m.d) : null;
  } catch (e) { return null; }
}
async function adminSeal(key, data) {
  const d = JSON.stringify(data);
  return { d, s: b64u(new Uint8Array(await crypto.subtle.sign(ECDSA_SIG, key, new TextEncoder().encode(d)))) };
}
/* weapon bits: '1' give, '0' take away, '.' leave as it is */
const mergeBits = (base, over) => base.split('').map((ch, i) => (over && over[i] && over[i] !== '.' ? over[i] : ch)).join('');
const mergeUpg = (base, over) => base.map((x, j) => (over && over[j] != null ? over[j] : x));
const cleanName = n => String(n).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
function fitText(str, maxW, size, weight) {
  if (textW(str, size, weight) <= maxW) return str;
  let s = str; while (s.length > 1 && textW(s + '\u2026', size, weight) > maxW) s = s.slice(0, -1);
  return s + '\u2026';
}

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
  bans: new Map(), bansSeq: 0, banned: false, adminKey: null, adminFails: 0, adminLock: 0,
  lobbyOn: false, accounts: {}, pending: {}, acctT: 0, acctDirty: true,
  name() {
    if (!SAVE.pvpName) { SAVE.pvpName = this.randomName(); persist(); }
    return SAVE.pvpName;
  },
  randomName() { return pick(R, PVP_ADJ) + ' ' + pick(R, PVP_ANIMAL) + ' ' + rint(R, 10, 99); },
  setName(n) {
    n = cleanName(n);
    if (!n) return false;
    SAVE.pvpName = n; persist(); this.announce(true); return true;
  },
  blocked() { return !!(window.claude && typeof window.claude.use === 'function'); },
  async start() {
    if (this.state !== 'off' && this.state !== 'failed') return;
    if (this.blocked()) { this.state = 'blocked'; return; }
    if (!SAVE.pvpUid) { SAVE.pvpUid = 'p' + Math.random().toString(36).slice(2, 12); persist(); }
    this.id = SAVE.pvpUid;
    this.state = 'loading';
    if (!window.mqtt) for (const src of PVP_LIBS) { if (await loadScript(src) && window.mqtt) break; }
    if (!window.mqtt) { this.state = 'failed'; return; }
    this.state = 'connecting';
    for (const url of PVP_BROKERS) if (await this.connect(url)) { this.state = 'online'; this.announce(true); this.syncAccount(); return; }
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
        c.subscribe([PVP_PFX + 'p/+', PVP_PFX + 'u/' + this.id, PVP_PFX + 'bans', PVP_PFX + 'cmd/' + this.id], { qos: 1 });
        if (this.adminKey) c.subscribe([PVP_PFX + 'acct/+', PVP_PFX + 'cmd/+'], { qos: 1 });
        if (this.match) c.subscribe(this.match.topic, { qos: 0 });
        if (!settled) { this.client = c; done(true); } else if (this.client === c) { this.announce(true); this.syncAccount(); }
      });
      c.on('message', (topic, buf) => this.onMessage(topic, buf));
      c.on('error', () => {});
      setTimeout(() => done(false), 11000);
    });
  },
  status() { return this.match ? 'duel' : SCENES.some(sc => sc instanceof Play && !(sc instanceof PvpMatch)) ? 'run' : 'town'; },
  announce(force) {
    if (!this.client || this.state !== 'online' || !this.lobbyOn || this.banned || SAVE.banned) return;
    const st = this.status();
    if (!force && st === this.lastStatus) return;
    this.lastStatus = st; this.beat = performance.now();
    this.pub('p/' + this.id, { id: this.id, n: this.name(), s: st, v: 1, w: SAVE.pvp.wins, l: SAVE.pvp.losses }, true);
  },
  pub(path, obj, retain = false, qos = 0) {
    if (this.client) this.client.publish(PVP_PFX + path, obj == null ? '' : JSON.stringify(obj), { qos, retain });
  },
  send(to, obj) { obj.from = this.id; this.pub('u/' + to, obj, false, 1); },
  tick() {
    if (this.state !== 'online') return;
    const now = performance.now();
    this.announce(now - this.beat > 15000);
    if ((this.acctDirty && now - this.acctT > 10000) || now - this.acctT > 30000) this.syncAccount();
    for (const id in this.players) if (now - this.players[id].seen > 40000) delete this.players[id];
    const o = this.outgoing;
    if (o && Date.now() - o.at > PVP_ASK_MS) { this.send(o.to, { t: 'cancel', mid: o.mid }); Game.toast('No answer from ' + o.name); this.outgoing = null; }
  },
  onMessage(topic, buf) {
    const rest = topic.slice(PVP_PFX.length), txt = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
    let m = null;
    if (txt) { try { m = JSON.parse(txt); } catch (e) { return; } }
    if (rest === 'bans') { this.onBans(m); return; }
    if (rest === 'cmd/' + this.id) { this.onCmd(m); return; }
    if (rest.startsWith('acct/')) { const id = rest.slice(5); if (m && m.id === id) this.accounts[id] = m; else if (!m) delete this.accounts[id]; return; }
    if (rest.startsWith('cmd/')) {
      const id = rest.slice(4);
      if (!m) delete this.pending[id];
      else adminOpen(m).then(c => { if (c && c.id === id && c.set && !(this.pending[id] && this.pending[id].seq > c.seq)) this.pending[id] = c; });
      return;
    }
    if (rest.startsWith('p/')) {
      const id = rest.slice(2); if (id === this.id) return;
      const num = v => Math.max(0, Math.min(99999, Math.floor(Number(v)) || 0));
      if (!m || this.bans.has(id)) delete this.players[id];
      else this.players[id] = { id, name: String(m.n || 'Player').slice(0, 24), st: PVP_STATUS[m.s] ? m.s : 'town', w: num(m.w), l: num(m.l), seen: performance.now() };
      // an empty presence is also what the broker sends when a connection dies, so the admin list can mark that account offline
      if (!m && this.accounts[id] && !this.accounts[id].b) Object.assign(this.accounts[id], { off: 1, t: Date.now() });
    } else if (rest === 'u/' + this.id) { if (m && typeof m.from === 'string') this.onInbox(m); }
    else if (this.match && rest === 'm/' + this.match.mid) { if (m) this.match.onNet(m); }
  },
  onInbox(m) {
    const from = m.from, known = this.players[from];
    if (m.t === 'inv') {
      if (this.match || this.invite || this.banned || SAVE.banned || this.bans.has(from)) { this.send(from, { t: 'ans', mid: m.mid, ok: false, why: 'busy' }); return; }
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
    if (this.outgoing || this.match || this.state !== 'online' || this.banned || SAVE.banned || this.bans.has(pl.id)) return;
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
  openLobby() { setScene(new Home()); pushScene(new Levels()); pushScene(new PvpLobby()); },
  /* ---- moderation ---- */
  async onBans(m) {
    const b = await adminOpen(m);
    if (!b || !Array.isArray(b.list) || !(b.seq > this.bansSeq)) return;
    this.bansSeq = b.seq;
    this.bans = new Map(b.list.filter(x => x && typeof x.id === 'string').map(x => [x.id, String(x.name || 'Player').slice(0, 24)]));
    for (const id of this.bans.keys()) delete this.players[id];
    const was = this.banned; this.banned = this.bans.has(this.id);
    if (this.banned && !was) this.goDark(); else if (!this.banned && was) this.announce(true);
  },
  /* the account summary the admin sees, kept on the broker even while this player is offline */
  summary() {
    return { v: 1, id: this.id, n: this.name(), g: SAVE.gold, c: SAVE.cleared.filter(Boolean).length, o: SAVE.owned.map(x => (x ? 1 : 0)).join(''),
      u: [SAVE.upg.regen, SAVE.upg.fighter, SAVE.upg.skill, SAVE.upg.final], w: SAVE.pvp.wins, l: SAVE.pvp.losses, b: SAVE.banned ? 1 : 0, as: SAVE.adminSeq || 0, t: Date.now() };
  },
  syncAccount() { if (!this.client || this.state !== 'online') return; this.acctT = performance.now(); this.acctDirty = false; this.pub('acct/' + this.id, this.summary(), true, 1); },
  async onCmd(m) {
    const c = await adminOpen(m);
    if (!c || c.id !== this.id || typeof c.seq !== 'number' || !c.set || typeof c.set !== 'object') return;
    if (c.seq > (SAVE.adminSeq || 0)) this.applyCmd(c);
  },
  applyCmd(m) {
    const s = m.set, wasBanned = !!SAVE.banned, int = (v, a, b) => clamp(Math.floor(Number(v)) || 0, a, b);
    if (s.wipe) SAVE = Object.assign(defaultSave(), { pvpUid: SAVE.pvpUid, pvpName: SAVE.pvpName, settings: SAVE.settings, banned: SAVE.banned, adminSeq: SAVE.adminSeq });
    if (typeof s.n === 'string' && cleanName(s.n)) SAVE.pvpName = cleanName(s.n);
    if ('g' in s) SAVE.gold = int(s.g, 0, 9999999);
    if ('c' in s) { const n = int(s.c, 0, LEVEL_N); SAVE.cleared = SAVE.cleared.map((_, i) => (i < n ? 1 : 0)); }
    if (typeof s.o === 'string') { SAVE.owned = SAVE.owned.map((x, i) => (s.o[i] === '1' ? 1 : s.o[i] === '0' ? 0 : x)); if (SAVE.equipped >= 0 && !SAVE.owned[SAVE.equipped]) SAVE.equipped = -1; }
    if (Array.isArray(s.u)) ['regen', 'fighter', 'skill', 'final'].forEach((k, j) => { if (s.u[j] != null) SAVE.upg[k] = int(s.u[j], 0, j === 3 ? 1 : 5); });
    if ('w' in s) SAVE.pvp.wins = int(s.w, 0, 99999);
    if ('l' in s) SAVE.pvp.losses = int(s.l, 0, 99999);
    if ('b' in s) SAVE.banned = s.b ? 1 : 0;
    SAVE.adminSeq = m.seq; fixJobs(); persist(); this.syncAccount(); this.announce(true);
    if (SAVE.banned && !wasBanned) { this.goDark(); setScene(new BannedScreen()); }
    else if (!SAVE.banned && wasBanned) { setScene(new Home()); Game.toast('An admin lifted the ban on this account'); }
    else if (s.wipe) { setScene(new Home()); Game.toast('An admin reset this account'); }
    else Game.toast('An admin updated your account');
  },
  pendingFor(id) { const c = this.pending[id], a = this.accounts[id]; return c && (!a || (a.as || 0) < c.seq) ? c : null; },
  /* (re)subscribing makes the broker resend every stored account summary and change list */
  adminSubscribe() {
    if (!this.client || !this.adminKey) return;
    const c = this.client, t = [PVP_PFX + 'acct/+', PVP_PFX + 'cmd/+'];
    c.unsubscribe(t, () => { if (this.client === c) c.subscribe(t, { qos: 1 }); });
  },
  /* one signed change list per player, kept on the broker until they apply it; new edits merge into an unapplied one */
  adminSave(id, edits) {
    if (!this.adminKey || this.state !== 'online') { sfx('error-a'); Game.toast('Not connected to the game server'); return false; }
    if (id === this.id && edits.b) { sfx('error-a'); Game.toast('You cannot ban your own account'); return false; }
    const prev = this.pendingFor(id), a = this.accounts[id], set = Object.assign({}, prev ? prev.set : {}, edits);
    if (prev && prev.set.o && edits.o) set.o = mergeBits(prev.set.o, edits.o);
    if (prev && prev.set.u && edits.u) set.u = mergeUpg(prev.set.u, edits.u);
    const data = { id, seq: Math.max(Date.now(), (prev ? prev.seq : 0) + 1, ((a && a.as) || 0) + 1), set };
    this.pending[id] = data;
    adminSeal(this.adminKey, data).then(msg => this.pub('cmd/' + id, msg, true, 1));
    if ('b' in edits) this.setBan(id, set.n || (a && a.n) || 'Player', !!edits.b);
    return true;
  },
  goDark() {
    if (this.match && this.match.phase !== 'over') this.match.finishDuel('quit');
    if (this.outgoing) this.cancelChallenge();
    if (this.invite) this.answer(false);
    this.pub('p/' + this.id, null, true);
  },
  async tryAdmin(pin) {
    if (!(window.crypto && crypto.subtle)) { Game.toast('Admin needs the https website'); return false; }
    let key = null;
    try {
      const d = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(pin).trim() + PVP_ADMIN_SALT))));
      key = await crypto.subtle.importKey('jwk', Object.assign({ d }, PVP_ADMIN_PUB), ECDSA_KEY, false, ['sign']);
      if (!(await adminOpen(await adminSeal(key, 'probe')))) key = null; // a wrong password makes a key that fails the public check
    } catch (e) { key = null; }
    if (key) { this.adminKey = key; this.adminFails = 0; return true; }
    if (++this.adminFails >= 5) { this.adminFails = 0; this.adminLock = Date.now() + 30000; }
    return false;
  },
  setBan(id, name, on) {
    if (!this.adminKey || id === this.id) return;
    const next = new Map(this.bans); if (on) next.set(id, name); else next.delete(id);
    this.bans = next; this.bansSeq = Math.max(Date.now(), this.bansSeq + 1); if (on) delete this.players[id];
    adminSeal(this.adminKey, { seq: this.bansSeq, list: [...next].map(([bid, n]) => ({ id: bid, name: n })) }).then(msg => this.pub('bans', msg, true, 1));
  }
};
setInterval(() => PVP.tick(), 1000);
// leaving: say so right away (plain sends go out before the page closes; the socket closes with the page)
window.addEventListener('pagehide', () => {
  if (!PVP.client || PVP.state !== 'online') return;
  PVP.pub('p/' + PVP.id, null, true);
  PVP.pub('acct/' + PVP.id, Object.assign(PVP.summary(), { off: 1 }), true);
});
// back from the browser's page cache: start over with a fresh connection
window.addEventListener('pageshow', e => {
  if (!e.persisted || !PVP.client) return;
  try { PVP.client.end(true); } catch (err) { /* already closed */ }
  PVP.client = null; PVP.state = 'off'; PVP.start();
});

/* ---------------- lobby: who is online, challenge them ---------------- */
class PvpLobby extends MenuScene {
  constructor() { super(); this.scroll = 0; PVP.lobbyOn = true; PVP.start(); PVP.announce(true); }
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
    textButton(this, 'grey', nameX + textW(PVP.name(), 6.4, 700) + 8, 40, 56, 18, 'Rename', () => pushScene(new PvpTextDialog({
      title: 'YOUR NAME', hint: 'Other players see this name. Up to 16 characters.', value: PVP.name(), random: true,
      onSave: v => { if (PVP.setName(v)) { Game.toast('Name saved: ' + SAVE.pvpName); return true; } sfx('error-a'); Game.toast('Type a name first'); return false; }
    })));
    // small red square in the window corner: the admin door
    const rx = (CW - M.ox) / M.s - 12, ry = -M.oy / M.s + 4;
    const door = this.hit(rx - 3, ry - 3, 14, 14, () => pushScene(PVP.adminKey ? new AdminAccounts() : adminPinDialog()));
    ctx.fillStyle = P.dark; ctx.fillRect(rx, ry, 8, 8); ctx.fillStyle = door ? P.redL : P.red; ctx.fillRect(rx + 1, ry + 1, 6, 6);
    const pill = { online: ['Online', P.teal], loading: ['Connecting', P.yel], connecting: ['Connecting', P.yel], failed: ['Offline', P.lav], blocked: ['Website only', P.lav], off: ['Offline', P.lav] }[st];
    const pw = textW(pill[0], 5.2, 700) + 12;
    ctx.fillStyle = P.dark; ctx.fillRect(430 - pw, 42, pw, 13); ctx.fillStyle = pill[1]; ctx.fillRect(431 - pw, 43, pw - 2, 11);
    stext(pill[0], 430 - pw / 2, 49, 5.2, P.dark, 'center', 700);
    stext(`Every gun is unlocked, both players have ${PVP_HP} health, map: Cactus Flats (Level 2)`, 230, 64, 5, P.dark, 'center', 500);
    panel('blue', 30, 72, 400, 148);
    const say = (lines, y0 = 112) => lines.forEach((l, k) => stext(l, 230, y0 + k * 11, k === 0 ? 6.4 : 5.4, P.white, 'center', k === 0 ? 700 : 500));
    if (PVP.banned) say(['You are banned from PvP', 'An admin banned this player for unfair play.']);
    else if (st === 'blocked') say(['Duels need the website version of the game', 'Open ' + PVP_SITE + ' in your browser', 'and press PVP on the level screen.']);
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
        stext(fitText(pl.name, 108, 6.4, 700), 46, y + 9, 6.4, P.white, 'left', 700);
        stext(`${pl.w} ${pl.w === 1 ? 'win' : 'wins'}`, 160, y + 9, 5.4, P.yelL, 'left', 700);
        stext(PVP_STATUS[pl.st], 214, y + 9, 5.2, P.lavL, 'left', 600);
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

/* ---------------- a small dialog with a real text box (names in any language, passwords) ---------------- */
class PvpTextDialog extends MenuScene {
  constructor(o) {
    super(); this.o = o;
    const el = this.el = document.createElement('input');
    el.id = 'pvp-text'; el.type = o.type || 'text'; el.maxLength = o.maxLen || 16; el.value = o.value || ''; el.autocomplete = 'off'; el.spellcheck = false;
    if (o.type === 'password') el.inputMode = 'numeric';
    el.setAttribute('aria-label', o.title);
    Object.assign(el.style, { position: 'fixed', zIndex: 5, boxSizing: 'border-box', border: '2px solid #47324b', borderRadius: '0', background: '#ffffff', color: '#47324b', padding: '0 8px', fontFamily: FONT, fontWeight: '600', outline: 'none' });
    el.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); this.save(); } else if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    document.body.appendChild(el);
    setTimeout(() => { el.focus(); el.select(); }, 0);
  }
  async save() {
    if (this.busy) return; this.busy = true;
    const ok = await this.o.onSave(this.el.value); this.busy = false;
    if (ok) { this.close(); if (this.o.after) this.o.after(); } else this.el.focus();
  }
  close() { this.el.remove(); popScene(this); }
  key(k) { if (k === 'escape') this.close(); }
  draw() {
    dim(); this.begin();
    const x = 120, y = 70, w = 220, h = 110;
    this.hit(x, y, w, h, () => this.el.focus());
    panel('grey', x, y, w, h);
    ptext(this.o.title, x + w / 2, y + 10, 'B', 'center');
    stext(this.o.hint, x + w / 2, y + 33, 4.8, P.dark, 'center', 500);
    // keep the text box glued to the dialog at any window size
    const bx = x + 20, by = y + 42, bw = w - 40, bh = 20, st = this.el.style;
    st.left = (M.ox + bx * M.s) / DPR + 'px'; st.top = (M.oy + by * M.s) / DPR + 'px';
    st.width = bw * M.s / DPR + 'px'; st.height = bh * M.s / DPR + 'px'; st.fontSize = Math.max(12, bh * M.s / DPR * 0.5) + 'px';
    if (this.o.random) {
      textButton(this, 'red', x + 20, y + 72, 56, 21, this.o.ok || 'Save', () => this.save());
      textButton(this, 'grey', x + 82, y + 72, 56, 21, 'Random', () => { this.el.value = PVP.randomName(); this.el.focus(); });
      textButton(this, 'grey', x + 144, y + 72, 56, 21, 'Cancel', () => this.close());
    } else {
      textButton(this, 'red', x + 40, y + 72, 64, 21, this.o.ok || 'Save', () => this.save());
      textButton(this, 'grey', x + 116, y + 72, 64, 21, 'Cancel', () => this.close());
    }
    this.end();
  }
}
// if the dialog is swept away (for example by accepting a duel), drop its text box too
setInterval(() => { const el = document.getElementById('pvp-text'); if (el && !SCENES.some(sc => sc instanceof PvpTextDialog)) el.remove(); }, 250);

/* ---------------- admin: the password door and the moderation panel ---------------- */
function adminPinDialog() {
  return new PvpTextDialog({
    title: 'ADMIN', hint: 'Enter the admin password.', type: 'password', maxLen: 12, ok: 'Enter',
    onSave: async v => {
      if (Date.now() < PVP.adminLock) { sfx('error-a'); Game.toast('Too many wrong tries. Wait 30 seconds.'); return false; }
      if (await PVP.tryAdmin(v)) { sfx('coin-d', 0.6); Game.toast('Admin tools unlocked'); return true; }
      sfx('error-a'); Game.toast('Wrong password'); return false;
    },
    after: () => pushScene(new AdminAccounts())
  });
}
const isOnline = a => a.id === PVP.id || !!PVP.players[a.id] || (!a.off && Date.now() - (a.t || 0) < 75000); // summaries come every 30 s
function seenText(a) {
  if (!a || !a.t) return 'Never seen';
  if (isOnline(a)) return 'Online now';
  const mins = Math.floor((Date.now() - a.t) / 60000);
  return mins < 1 ? 'Just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`;
}
/* every player who has opened the game, online or not */
class AdminAccounts extends MenuScene {
  constructor() { super(); this.page = 0; PVP.adminSubscribe(); }
  key(k) { if (k === 'escape') popScene(this); }
  wheel(d) { this.page = Math.max(0, this.page + d); }
  draw() {
    dim(); this.begin();
    const x = 14, y = 4, w = 432, h = 250, rows = 8;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('ADMIN', x + w / 2, y + 9, 'B', 'center');
    stext('Every player who has opened the game. Click one to change their account.', x + w / 2, y + 32, 4.8, P.dark, 'center', 500);
    const list = Object.values(PVP.accounts).sort((a, b) => (b.t || 0) - (a.t || 0));
    this.page = clamp(this.page, 0, Math.max(0, list.length - rows));
    const cols = [x + 18, x + 140, x + 214, x + 266, x + 312, x + 366];
    ['Player', 'Last seen', 'Gold', 'Levels', 'Duels', ''].forEach((c, i) => stext(c, cols[i], y + 44, 4.8, P.dark, 'left', 700));
    if (PVP.state !== 'online') stext('Not connected to the game server.', x + w / 2, y + 120, 6, P.dark, 'center', 700);
    else if (!list.length) stext('No players yet. Players show up after they open the new version.', x + w / 2, y + 120, 5.4, P.dark, 'center', 600);
    list.slice(this.page, this.page + rows).forEach((a, k) => {
      const ry = y + 52 + k * 19, on = this.hit(x + 12, ry, w - 24, 17, () => pushScene(new AccountEditor(a.id)));
      ctx.fillStyle = on ? 'rgba(255,255,255,0.4)' : 'rgba(71,50,75,0.12)'; ctx.fillRect(x + 12, ry, w - 24, 17);
      stext(fitText(String(a.n || 'Player') + (a.id === PVP.id ? ' (you)' : ''), 116, 5.6, 700), cols[0], ry + 8.5, 5.6, P.dark, 'left', 700);
      stext(seenText(a), cols[1], ry + 8.5, 5, isOnline(a) ? P.tealD : P.dark, 'left', 600);
      stext(String(a.g || 0), cols[2], ry + 8.5, 5.2, P.dark, 'left', 600);
      stext(String(a.c || 0), cols[3], ry + 8.5, 5.2, P.dark, 'left', 600);
      stext(`${a.w || 0}W ${a.l || 0}L`, cols[4], ry + 8.5, 5.2, P.dark, 'left', 600);
      const tag = a.b ? ['BANNED', P.redD] : PVP.pendingFor(a.id) ? ['Pending', P.yelD] : null;
      if (tag) stext(tag[0], cols[5], ry + 8.5, 5, tag[1], 'left', 700);
    });
    if (list.length > rows) {
      stext(`${this.page + 1}-${Math.min(list.length, this.page + rows)} of ${list.length}`, x + 70, y + h - 17, 5, P.dark, 'left', 600);
      textButton(this, 'grey', x + 16, y + h - 28, 48, 21, 'Up', () => { this.page = Math.max(0, this.page - rows); });
      textButton(this, 'grey', x + w - 64, y + h - 28, 48, 21, 'Down', () => { this.page += rows; });
    }
    textButton(this, 'grey', x + w / 2 - 70, y + h - 28, 64, 21, 'Refresh', () => { PVP.adminSubscribe(); Game.toast('Reloading the account list'); });
    textButton(this, 'grey', x + w / 2 + 6, y + h - 28, 64, 21, 'Done', () => popScene(this));
    this.end();
  }
}
/* one player's account: changes are signed and wait on the server until that player opens the game */
class AccountEditor extends MenuScene {
  constructor(id) { super(); this.id = id; this.edits = {}; }
  key(k) { if (k === 'escape') popScene(this); }
  /* what the account will look like: last summary, then the unapplied change list, then the edits on screen */
  cur() {
    const a = PVP.accounts[this.id] || {}, pend = PVP.pendingFor(this.id);
    const v = { n: a.n || 'Player', g: a.g || 0, c: a.c || 0, o: String(a.o || '').padEnd(16, '0').slice(0, 16), u: Array.isArray(a.u) ? a.u.slice(0, 4) : [0, 0, 0, 0], w: a.w || 0, l: a.l || 0, b: a.b || 0, wipe: 0 };
    for (const s of [pend && pend.set, this.edits]) {
      if (!s) continue;
      if (s.wipe) Object.assign(v, { g: 0, c: 0, o: '0'.repeat(16), u: [0, 0, 0, 0], w: 0, l: 0, wipe: 1 });
      for (const f of ['n', 'g', 'c', 'w', 'l', 'b']) if (f in s) v[f] = s[f];
      if (typeof s.o === 'string') v.o = mergeBits(v.o, s.o);
      if (Array.isArray(s.u)) v.u = mergeUpg(v.u, s.u);
    }
    return v;
  }
  setUpg(j, val) { const u = (this.edits.u || [null, null, null, null]).slice(); u[j] = val; this.edits.u = u; }
  step(x, y, dec, inc) { textButton(this, 'grey', x, y, 16, 16, '-', dec); textButton(this, 'grey', x + 20, y, 16, 16, '+', inc); }
  save() {
    if (!Object.keys(this.edits).length) { Game.toast('Nothing to save'); return; }
    if (PVP.adminSave(this.id, this.edits)) { this.edits = {}; sfx('coin-d', 0.5); Game.toast('Saved. Offline players get it the next time they open the game.'); }
  }
  draw() {
    dim(); this.begin();
    const x = 14, y = 4, w = 432, h = 250, v = this.cur(), a = PVP.accounts[this.id] || {}, dirty = Object.keys(this.edits).length > 0;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('ACCOUNT', x + w / 2, y + 9, 'B', 'center');
    stext(fitText(v.n, 190, 7, 700), x + 16, y + 32, 7, P.dark, 'left', 700);
    const status = dirty ? 'Unsaved changes' : PVP.pendingFor(this.id) ? 'Waiting for this player to open the game' : 'Up to date';
    stext(`${seenText(a)}. ${status}`, x + w - 16, y + 32, 5, dirty ? P.redD : P.dark, 'right', 600);
    // left column: name, gold, levels, duel record, weapons
    const L = x + 16, row = (yy, label, value) => { stext(label, L, yy, 5.4, P.dark, 'left', 500); stext(String(value), L + 74, yy, 6, P.dark, 'left', 700); };
    row(y + 50, 'Name', fitText(v.n, 80, 6, 700));
    textButton(this, 'grey', L + 160, y + 42, 50, 16, 'Rename', () => pushScene(new PvpTextDialog({
      title: 'RENAME', hint: 'New name for this player', value: v.n,
      onSave: t => { const n = cleanName(t); if (!n) { sfx('error-a'); Game.toast('Type a name first'); return false; } this.edits.n = n; return true; }
    })));
    row(y + 70, 'Gold', v.g);
    textButton(this, 'grey', L + 160, y + 62, 50, 16, 'Set', () => pushScene(new PvpTextDialog({
      title: 'GOLD', hint: 'How much gold this player should have', value: String(v.g), maxLen: 7,
      onSave: t => { const g = Math.floor(Number(t)); if (!(g >= 0)) { sfx('error-a'); Game.toast('Type a number'); return false; } this.edits.g = g; return true; }
    })));
    row(y + 90, 'Levels cleared', `${v.c} / ${LEVEL_N}`);
    this.step(L + 160, y + 82, () => { this.edits.c = Math.max(0, this.cur().c - 1); }, () => { this.edits.c = Math.min(LEVEL_N, this.cur().c + 1); });
    row(y + 110, 'Duel record', `${v.w} won, ${v.l} lost`);
    textButton(this, 'grey', L + 160, y + 102, 50, 16, 'Reset', () => { this.edits.w = 0; this.edits.l = 0; });
    stext('Weapons (click to give or take away)', L, y + 128, 5.4, P.dark, 'left', 500);
    for (let i = 0; i < WEAPONS.length; i++) {
      const wx = L + (i % 8) * 26, wy = y + 132 + Math.floor(i / 8) * 24, own = v.o[i] === '1';
      const on = this.hit(wx, wy + 3, 24, 18, () => { const o = (this.edits.o || '.'.repeat(16)).split(''); o[i] = this.cur().o[i] === '1' ? '0' : '1'; this.edits.o = o.join(''); }, [WEAPONS[i].name, own ? 'Owned. Click to take it away.' : 'Not owned. Click to give it.']);
      ctx.fillStyle = on ? 'rgba(255,255,255,0.75)' : own ? 'rgba(255,255,255,0.4)' : 'rgba(71,50,75,0.12)'; ctx.fillRect(wx, wy + 3, 24, 18);
      spr('weapons', WEAPONS[i].tile, wx, wy, own ? null : { alpha: 0.3 });
    }
    // right column: upgrades, ban, wipe
    const Rx = x + 252;
    stext('Upgrades', Rx, y + 50, 5.8, P.dark, 'left', 700);
    ['Regen', 'Fighter', 'Skill'].forEach((nm, j) => {
      const yy = y + 68 + j * 18;
      stext(nm, Rx, yy, 5.4, P.dark, 'left', 500);
      stext(`${v.u[j] || 0} / 5`, Rx + 70, yy, 5.8, P.dark, 'left', 700);
      this.step(Rx + 112, yy - 8, () => this.setUpg(j, Math.max(0, (this.cur().u[j] || 0) - 1)), () => this.setUpg(j, Math.min(5, (this.cur().u[j] || 0) + 1)));
    });
    stext('Death zone', Rx, y + 122, 5.4, P.dark, 'left', 500);
    textButton(this, v.u[3] ? 'red' : 'grey', Rx + 70, y + 114, 50, 16, v.u[3] ? 'Owned' : 'No', () => this.setUpg(3, this.cur().u[3] ? 0 : 1));
    textButton(this, v.b ? 'grey' : 'red', Rx, y + 142, 88, 18, v.b ? 'Unban account' : 'Ban account', () => { this.edits.b = this.cur().b ? 0 : 1; });
    if (v.b) stext('BANNED', Rx + 96, y + 151, 6, P.redD, 'left', 700);
    textButton(this, 'red', Rx, y + 166, 88, 18, 'Wipe account', () => pushScene(new Confirm('Wipe this account?', 'Gold, weapons, levels, upgrades and duels reset.', 'Wipe', () => { this.edits = { wipe: 1 }; })));
    if (v.wipe) stext('Wipe waiting', Rx + 96, y + 175, 5.4, P.redD, 'left', 700);
    stext('Saved changes reach offline players the next time they open the game.', x + w / 2, y + 206, 4.8, P.dark, 'center', 500);
    textButton(this, 'red', x + w / 2 - 92, y + h - 30, 86, 21, 'Save changes', () => this.save());
    textButton(this, 'grey', x + w / 2 + 6, y + h - 30, 86, 21, dirty ? 'Discard' : 'Back', () => popScene(this));
    this.end();
  }
}
/* what a banned account sees instead of the game */
class BannedScreen extends MenuScene {
  draw() {
    sandBg(); this.begin();
    panel('red', 140, 78, 180, 36); ptext('BANNED', 230, 90, 'B', 'center');
    stext('An admin banned this account.', 230, 134, 7, P.dark, 'center', 700);
    stext('This browser can no longer play Dustwell Shooter.', 230, 148, 5.6, P.dark, 'center', 500);
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
    this.sinceHit = 99; this.healAcc = 0; this.healing = false;
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
      if (m.hp > o.hp + 0.5 && !o.dead) this.spark(o.x + (R() - 0.5) * 10, o.y - 10, 3, P.teal);
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
    p.hp = Math.max(0, p.hp - dmg); this.sinceHit = 0;
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
    // healing: 3 a second after 1 s without a hit; hold P (or + on touch) after 3 s for 10 a second
    this.sinceHit += dt;
    const hurt = this.phase === 'fight' && !p.dead && p.hp < PVP_HP;
    this.healing = hurt && !this.paused && this.sinceHit >= PVP_HEAL_WAIT && (IN.keys.p || this.tHeal != null);
    const rate = this.healing ? PVP_HEAL_RATE : hurt && this.sinceHit >= PVP_REGEN_WAIT ? PVP_REGEN_RATE : 0;
    if (rate) {
      const add = Math.min(rate * dt, PVP_HP - p.hp); p.hp += add;
      if ((this.healAcc += add) >= 10) { this.healAcc -= 10; this.nums.push({ x: p.x, y: p.y - 22, t: 0.7, v: '+10', col: P.teal }); }
      if (this.healing && R() < 0.3) this.spark(p.x + (R() - 0.5) * 10, p.y - 10, 1, P.teal);
    }
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
  healBtn() { const u = this.hudScale(), HW = CW / u, HH = CH / u; return { x: (HW - 46) * u, y: (HH - 26) * u, w: 22 * u, h: 22 * u }; }
  touchStart(id, x, y) {
    if (this.paused || this.phase === 'over') { IN.mx = x; IN.my = y; this.click(x, y); return; }
    const b = this.healBtn(); if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) { this.tHeal = id; return; }
    super.touchStart(id, x, y);
  }
  touchEnd(id) { if (this.tHeal === id) this.tHeal = null; super.touchEnd(id); }
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
    // heal status under your health bar
    if (!p.dead && p.hp < PVP_HP && this.phase === 'fight') {
      const key = IN.touch ? '+' : 'P', regenIn = PVP_REGEN_WAIT - this.sinceHit, healIn = PVP_HEAL_WAIT - this.sinceHit;
      const msg = this.healing ? `Healing +${PVP_HEAL_RATE} a second`
        : regenIn > 0 ? `Regen starts in ${regenIn.toFixed(1)}s`
        : healIn > 0 ? `Regen +${PVP_REGEN_RATE} a second. Hold ${key} in ${healIn.toFixed(1)}s for +${PVP_HEAL_RATE}`
        : `Regen +${PVP_REGEN_RATE} a second. Hold ${key} for +${PVP_HEAL_RATE}`;
      stextO(msg, 8, 33, 4.8, regenIn > 0 ? P.white : P.teal, P.dark, 'left', 700, 1.8);
    }
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
    if (IN.touch) {
      ctx.globalAlpha = 0.6; btn('grey', HW - 22, HH - 24, 18, 18, false); stext('II', HW - 13, HH - 15.5, 6, P.dark, 'center', 700);
      ctx.globalAlpha = this.tHeal != null ? 1 : 0.7; btn('grey', HW - 44, HH - 24, 18, 18, false); stext('+', HW - 35, HH - 15.5, 8, P.dark, 'center', 700); ctx.globalAlpha = 1;
    }
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
