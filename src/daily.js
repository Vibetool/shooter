/* ==========================================================================
   Daily challenge: one special run a day with its own rules, told by Mira.
   The rules rotate day by day (the same for everyone on the same date), the
   monsters are as tough as the player's own progress, and the first win of
   the day pays gold, a little more on a streak.
   ========================================================================== */
const DAILY_TYPES = ['portal', 'rescue', 'survive', 'knife', 'speed'];
const DAILY_SHIFT = 3; // lines the rotation up so Hold the Portal comes first (on 6 Oct 2026), then Rescue
const DAILY = {
  portal: { name: 'Hold the Portal', say: 'Monsters are after my portal!', rules: () => [
    'The portal is here from the start, but it stays shut for you.',
    'Monsters march straight at it. If one touches it, the challenge fails.',
    'Defeat every monster, then step into the portal.'] },
  rescue: { name: 'Rescue', say: 'A little squirrel is trapped behind the monster line!', rules: () => [
    'A railing splits the map. You can slip through it, monsters cannot.',
    'The squirrel waits in a pen deep in monster land. Walk in to pick it up.',
    'Carry it back to the portal within 5 minutes.'] },
  survive: { name: 'Last Stand', say: 'They will not stop coming. Can you keep standing?', rules: () => [
    'Monsters keep coming, more and more of them.',
    'Stay alive for 3 minutes.'] },
  knife: { name: 'Knife Fight', say: 'No guns today. Just you and your knife.', rules: () => [
    'Guns stay holstered. Your knife strikes by itself, or click to swing it.',
    'Defeat every monster, then step into the portal.'] },
  speed: { name: 'Speed Clear', say: 'How fast can you clean up Dustwell?', rules: () => [
    `Defeat every monster within ${fmtTime(Daily.speedTime() * 1000)}.`,
    'Then step into the portal: the clock stops once they are all gone.'] }
};
const Daily = {
  /* local calendar day number, so the challenge changes at the player's own midnight */
  today() { return Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000); },
  type(day = this.today()) { const n = DAILY_TYPES.length; return DAILY_TYPES[(((day + DAILY_SHIFT) % n) + n) % n]; },
  level() { return clamp(SAVE.cleared.filter(Boolean).length, 1, LEVEL_N); },
  speedTime() { return 40 + (10 + (this.level() >> 1)) * 5; },
  doneToday() { return SAVE.daily.day === this.today(); },
  streakIfWon() { const t = this.today(); return SAVE.daily.day === t ? SAVE.daily.streak : SAVE.daily.day === t - 1 ? SAVE.daily.streak + 1 : 1; },
  reward() { return 30 + 6 * this.level() + Math.min(25, (this.streakIfWon() - 1) * 5); },
  /* the first win of the day: returns the gold paid (0 when already claimed) */
  complete() {
    if (this.doneToday()) return 0;
    const g = this.reward();
    SAVE.daily.streak = this.streakIfWon(); SAVE.daily.day = this.today(); SAVE.daily.wins++;
    SAVE.gold += g; SAVE.stats.goldEarned += g; persist();
    return g;
  },
  msToMidnight() { const d = new Date(), n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return n - d; },
  untilNext() { const m = Math.ceil(this.msToMidnight() / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
};
function startDaily(type) { setScene(new Challenge(type || Daily.type())); }

/* Mira explains today's rules */
class DailyDialog extends MenuScene {
  constructor() { super(); Coach.finish('daily'); }
  key(k) { if (k === 'escape') popScene(this); if (k === 'enter') startDaily(); }
  outside() { popScene(this); }
  draw() {
    dim(); this.begin();
    const type = Daily.type(), C = DAILY[type], done = Daily.doneToday();
    const x = 66, w = 328, h = 188, y = Math.round(129 - h / 2);
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('DAILY CHALLENGE', x + w / 2, y + 10, 'B', 'center');
    // Mira on her yellow tile, as in her job dialog
    const sq = [3, 4, 5, 21, 22, 23, 39, 40, 41];
    for (let k = 0; k < 9; k++) spr('ui', sq[k], x + 14 + (k % 3) * 16, y + 38 + Math.floor(k / 3) * 16);
    spr('players', NPCS.cat.f + (this.t % 1.2 < 0.6 ? 0 : 1), x + 20, y + 44, { scale: 1.5 });
    stext('Mira', x + 38, y + 96, 5.6, P.dark, 'center', 700);
    // what she says
    const tx = x + 74, tw = w - 88;
    stext(C.name, tx, y + 42, 7.4, P.redD, 'left', 700);
    let yy = y + 55;
    for (const l of wrapText('“' + C.say + '”', tw, 5.8, 500)) { stext(l, tx, yy, 5.8, P.dark, 'left', 500); yy += 8.5; }
    yy += 3;
    C.rules().forEach((rule, k) => {
      wrapText(rule, tw - 10, 5.4, 600).forEach((l, j) => { if (j === 0) stext((k + 1) + '.', tx, yy, 5.4, P.redD, 'left', 700); stext(l, tx + 9, yy, 5.4, P.dark, 'left', 600); yy += 7.6; });
      yy += 2;
    });
    // reward and streak
    const by = y + h - 64;
    ctx.fillStyle = 'rgba(71,50,75,0.12)'; ctx.fillRect(x + 14, by, w - 28, 28);
    spr('tiles', 225, x + 18, by + 6);
    if (done) {
      stext('Done for today! Streak: ' + SAVE.daily.streak + (SAVE.daily.streak === 1 ? ' day' : ' days'), x + 34, by + 9, 5.8, P.dark, 'left', 700);
      stext(`A new challenge comes in ${Daily.untilNext()}. You can still play for fun.`, x + 34, by + 19, 5, P.dark, 'left', 500);
    } else {
      const s = Daily.streakIfWon();
      stext(`Win it today for ${Daily.reward()} gold` + (s > 1 ? ` (streak day ${s})` : ''), x + 34, by + 9, 5.8, P.dark, 'left', 700);
      stext(`Monsters are as tough as Level ${Daily.level()}. Try as often as you like.`, x + 34, by + 19, 5, P.dark, 'left', 500);
    }
    textButton(this, 'red', x + w / 2 - 70, y + h - 30, 64, 21, done ? 'Play again' : 'Start', () => startDaily());
    textButton(this, 'grey', x + w / 2 + 6, y + h - 30, 64, 21, 'Back', () => popScene(this));
    this.end();
  }
}

/* the run itself: a normal run with today's rules plugged into the hooks Play offers */
function dailySetup(type, day, Ld) {
  const li = Ld - 1, themeLi = ((day % LEVEL_N) + LEVEL_N) % LEVEL_N, seed = 7001 + day * 31, key = `daily:${type}:${day}:${themeLi}`;
  let pool = LEVELS[li].pool.filter(k => !(type === 'rescue' && k === 'hound')); // the rescued animal is a squirrel: no squirrel-looking monsters
  if (!pool.length) pool = ['slime'];
  const map = MAP_CACHE[key] || (MAP_CACHE[key] = type === 'rescue' ? genRescueMap(seed) : genMap(themeLi, seed));
  const half = Ld >> 1, size = { portal: [10 + Ld, 4 + half], rescue: [Infinity, 6 + half], survive: [Infinity, 4], knife: [8 + half, 4 + half], speed: [10 + half, 10 + half] }[type];
  return { li, map, def: { name: DAILY[type].name, pool }, total: size[0], cap: size[1] };
}
class Challenge extends Play {
  constructor(type) {
    const day = Daily.today(), Ld = Daily.level(), s = dailySetup(type, day, Ld);
    super(s.li, { challenge: type, map: s.map, def: s.def, total: s.total, cap: s.cap, initial: 0,
      banner: { lines: ['DAILY CHALLENGE'], sub: DAILY[type].name, t: 2.6, kind: 'red' } });
    this.type = type; this.day = day; this.restartLabel = 'Restart';
    const m = this.map, sx = m.spawn.x * T + 8, sy = m.spawn.y * T + 8;
    if (type === 'portal' || type === 'rescue') this.portal = { x: sx, y: sy };
    if (type === 'portal') {
      this.pflow = new Int16Array(m.W * m.H); this.bfs(this.cell(sx, sy), this.pflow);
      this.steer = (e, dt) => this.toPortal(e, dt);
    }
    if (type === 'rescue') { this.animal = { x: m.animal.x * T + 8, y: m.animal.y * T + 12, carried: false }; this.timeLeft = 300; }
    if (type === 'survive') this.timeLeft = 180;
    if (type === 'speed') this.timeLeft = Daily.speedTime();
    if (type === 'knife') { this.p.wi = -1; this.p.ammo = 0; this.upg.final = 0; }
    const first = type === 'rescue' ? this.cap : Math.min(this.total, Math.ceil(this.cap * 0.6));
    for (let k = 0; k < first; k++) this.spawnEnemy(false);
    this.computeFlow();
  }
  /* Hold the Portal: walkers follow the paths to the portal, flyers head straight for it */
  toPortal(e, dt) {
    const g = this.portal;
    if (e.D.ai === 'fly') { e.wob += dt * 3; const dx = g.x - e.x, dy = g.y - e.y, d = Math.hypot(dx, dy) || 1; return [dx / d + Math.cos(e.wob) * 0.5, dy / d + Math.sin(e.wob * 1.3) * 0.5]; }
    return this.flowDirOn(e, this.pflow, g.x, g.y);
  }
  spawnEnemy(fromDoor) {
    if (this.type !== 'rescue' && this.type !== 'portal') { super.spawnEnemy(fromDoor); return; }
    if (this.spawned >= this.total) return;
    const m = this.map, W = m.W, pcx = (this.p.x / T) | 0, pcy = (this.p.y / T) | 0, far = (i, x, y) => Math.abs((i % W) - x) + Math.abs(((i / W) | 0) - y);
    let cells;
    if (this.type === 'rescue') { // the first wave guards the pen; the rest come from anywhere on the monster side
      const a = m.animal;
      cells = m.monsterFloor.filter(i => far(i, pcx, pcy) >= 7 && (fromDoor || (far(i, a.x, a.y) >= 4 && far(i, a.x, a.y) <= 9)));
    } else { // far from the portal, not on top of the hero, and with a path to the portal
      cells = m.floor.filter(i => far(i, m.spawn.x, m.spawn.y) >= 16 && far(i, pcx, pcy) >= 8 && this.pflow[i] >= 0);
    }
    if (!cells.length) return;
    const i = cells[(R() * cells.length) | 0], e = this.addEnemy(pick(R, this.def.pool), (i % W) * T + 8, ((i / W) | 0) * T + 10);
    this.spawned++; this.puff(e.x, e.y, 8, P.lav, 40);
  }
  ruleTick(dt) {
    if (this.state !== 'play') return;
    const p = this.p;
    if (this.timeLeft != null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) { if (this.type === 'survive') this.finish(true); else this.fail('Time is up!'); return; }
    }
    if (this.type === 'survive') this.cap = 4 + (this.L >> 2) + Math.floor((180 - this.timeLeft) / 30);
    if (this.type === 'portal') for (const e of this.ents) if (!e.dead && Math.hypot(e.x - this.portal.x, e.y - this.portal.y) < 12) { this.fail('A monster reached the portal!'); return; }
    if (this.type === 'rescue') {
      const a = this.animal, atPortal = Math.hypot(p.x - this.portal.x, p.y - this.portal.y) < 12;
      if (!a.carried && !p.dead && Math.hypot(p.x - a.x, p.y - a.y) < 13) {
        a.carried = true; sfx('coin-c', 0.8, 1.3);
        this.banner = { lines: ['GOT IT!'], sub: 'Carry the squirrel back to the portal', t: 2.2, kind: 'red' };
      }
      if (!a.carried && atPortal && !this.hinted) Game.toast('Bring the squirrel first: its pen is far up north');
      this.hinted = atPortal;
    }
  }
  fail(reason) {
    if (this.state !== 'play') return;
    this.state = 'dead'; this.deadT = 1.8; this.failReason = reason;
    this.banner = { lines: ['FAILED'], sub: reason, t: 2.2, kind: 'red' };
    sfx('lose-a', 0.8);
  }
  levelDone() { return ['portal', 'knife', 'speed'].includes(this.type) && super.levelDone(); }
  onClear() {
    if (this.type === 'speed') this.timeLeft = null; // the clock stops once the field is clear
    if (this.type !== 'portal') { super.onClear(); return; }
    this.state = 'clear';
    this.banner = { lines: ['PORTAL SAFE'], sub: 'Now step into the portal', t: 3, kind: 'red' };
    sfx('coin-d', 0.9); this.coins.forEach(c => { c.mag = true; });
  }
  canEnter() { return this.type === 'rescue' ? this.animal.carried : this.type === 'portal' ? this.state === 'clear' : true; }
  portalLocked() { return (this.type === 'portal' && this.state !== 'clear') || (this.type === 'rescue' && !this.animal.carried); }
  equip(wi) {
    if (this.type === 'knife' && wi >= 0) { if (!this.knifeSaid) Game.toast('Knife only today!'); this.knifeSaid = true; return; }
    super.equip(wi);
  }
  autoShot(dt) { if (this.type !== 'knife') super.autoShot(dt); }
  restart() { startDaily(this.type); }
  hudLines(left) {
    const clock = this.timeLeft != null ? '   ' + fmtTime(this.timeLeft * 1000) : '', clear = this.state === 'clear';
    const sub = {
      portal: clear ? 'Portal safe: step in!' : `Guard the portal. Monsters left: ${left}`,
      rescue: this.animal && this.animal.carried ? 'Bring the squirrel to the portal' : 'Find the squirrel in the pen up north',
      survive: 'Stay alive',
      knife: clear ? 'Find the portal' : `Knife only. Monsters left: ${left}`,
      speed: clear ? 'Find the portal' : `Monsters left: ${left}`
    }[this.type];
    return [`Daily: ${DAILY[this.type].name}${clock}`, sub];
  }
  /* the squirrel in its pen (picked up, it rides on the hero's head) */
  drawExtras() {
    if (this.type !== 'rescue' || this.animal.carried) return;
    const a = this.animal;
    ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.beginPath(); ctx.ellipse(a.x, a.y + 3, 6, 2.2, 0, 0, TAU); ctx.fill();
    spr('players', 4 + (Math.floor(this.t * 1.6) % 2), Math.round(a.x) - 12, Math.round(a.y) - 20);
    spr('ui', 60, Math.round(a.x) - 8, Math.round(a.y) - 40 + Math.round(Math.sin(this.t * 5)));
  }
  drawPlayer() {
    super.drawPlayer();
    const p = this.p;
    if (this.type === 'rescue' && this.animal.carried && !p.dead) spr('players', 4 + (p.moving ? Math.floor(p.walk * 6) % 2 : 0), Math.round(p.x) - 12, Math.round(p.y) - 36 + Math.round(Math.sin(this.t * 8)));
  }
  mapDots(dot) { if (this.type === 'rescue' && !this.animal.carried) dot(this.animal.x, this.animal.y, P.teal, 3); }
  /* an arrow toward the goal when it is off screen */
  hudExtra(u, HW, HH) {
    if (this.state === 'dead') return;
    let tgt = null;
    if (this.type === 'rescue') tgt = this.animal.carried ? this.portal : { x: this.animal.x, y: this.animal.y - 10 };
    else if (this.portal && (this.type !== 'portal' || this.state === 'clear')) tgt = this.portal;
    if (!tgt) return;
    const k = this.view().Z / u, sx = (tgt.x - this.cam.x) * k, sy = (tgt.y - this.cam.y) * k;
    if (sx < 20 || sy < 50 || sx > HW - 20 || sy > HH - 60) Coach.pointAt(this, u, HW, HH, tgt, this.t);
  }
  finish(won) {
    if (this.result) return;
    if (won && this.coins.length) { this.gainGold(this.coins.length); this.coins = []; }
    const reward = won && this.day === Daily.today() ? Daily.complete() : 0;
    this.result = { won, reward, streak: SAVE.daily.streak, reason: won ? '' : this.failReason || 'You were knocked out.' };
    if (won) { sfx('coin-d', 0.9); sfx('jump-c', 0.6, 1.2); }
    cv.style.cursor = 'default'; persist();
  }
  resultDefault() { if (this.result.won) this.toTown(); else this.restart(); }
  drawResult() {
    dim(); menuXf();
    const r = this.result, x = 120, y = 40, w = 220, h = 172;
    panel('grey', x, y, w, h);
    panel('red', x + 20, y - 10, w - 40, 30);
    ptext(r.won ? 'CHALLENGE WON' : 'FAILED', x + w / 2, y - 1, 'B', 'center');
    const rows = [['Challenge', DAILY[this.type].name], ['Gold collected', '+' + this.goldRun], ['Monsters defeated', this.killsRun], ['Time', fmtTime(this.time * 1000)]];
    rows.forEach((row, k) => { stext(row[0], x + 22, y + 34 + k * 11, 5.6, P.dark, 'left', 500); stext(String(row[1]), x + w - 22, y + 34 + k * 11, 5.6, P.dark, 'right', 700); });
    const note = r.won ? (r.reward ? `Daily reward: +${r.reward} gold. Streak: ${r.streak} ${r.streak === 1 ? 'day' : 'days'}` : 'Today’s reward is already yours. Nice run!') : r.reason;
    stext(note, x + w / 2, y + 86, 5.8, P.redD, 'center', 700);
    if (!r.won) stext('Try again as often as you like today.', x + w / 2, y + 96, 5.2, P.dark, 'center', 500);
    let any = false;
    any = this.overlayBtn('red', x + 16, y + h - 54, 90, 21, r.won ? 'Play again' : 'Retry', () => this.restart()) || any;
    any = this.overlayBtn('grey', x + w - 106, y + h - 54, 90, 21, 'Back to town', () => this.toTown()) || any;
    cv.style.cursor = any ? 'pointer' : 'default';
  }
}
