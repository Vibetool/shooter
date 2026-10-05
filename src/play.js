/* ==========================================================================
   Gameplay
   ========================================================================== */
function startLevel(i) { setScene(new Play(i)); }
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

class Play {
  constructor(li) {
    this.li = li; this.L = li + 1; this.def = LEVELS[li];
    const m = this.map = renderMap(getMap(li));
    this.t = 0; this.state = 'play'; this.time = 0;
    this.ents = []; this.bullets = []; this.ebullets = []; this.coins = []; this.parts = []; this.nums = [];
    this.chests = m.chests.map(c => ({ x: c.x * T + 8, y: c.y * T + 12, gold: c.gold, open: false }));
    this.meds = m.medkits.map(c => ({ x: c.x * T + 8, y: c.y * T + 12, used: false }));
    const wi = SAVE.owned[SAVE.equipped] ? SAVE.equipped : -1;
    this.p = { x: m.spawn.x * T + 8, y: m.spawn.y * T + 10, vx: 0, vy: 0, h: 0, ramp: false, hp: 10, maxHp: 10, inv: 1, aim: 0, wi,
      ammo: wi >= 0 ? WEAPONS[wi].mag : 0, reload: 0, cd: 0, knifeT: 0, knifeCd: 0, autoKnifeCd: 0, knifeA: 0, autoShotCd: 1, dashT: 0, dashCd: 0, dashX: 0, dashY: 0, walk: 0, moving: false, dead: false, scale: 1, shield: 1, maxShield: 1 };
    this.total = levelCount(this.L); this.spawned = 0; this.killed = 0; this.spawnT = 1.5;
    this.bossDef = BOSSES[this.L] || null; this.bossSpawned = false; this.bossEnt = null; this.bossDead = false;
    this.cap = 4 + Math.floor(this.L * 0.6);
    this.hits = 0; this.goldRun = 0; this.killsRun = 0; this.chestsRun = 0;
    this.cam = { x: 0, y: 0 }; this.shake = 0;
    this.flow = new Int16Array(m.W * m.H); this.flowT = 0; this.flowCell = -1; this.q = new Int32Array(m.W * m.H);
    this.portal = null;
    this.upg = { regen: SAVE.upg.regen, fighter: SAVE.upg.fighter, skill: SAVE.upg.skill, final: SAVE.upg.final };
    this.dz = { ammo: WEAPONS[5].mag, reload: 0, cd: 0.5, aura: 0 };
    this.regenT = 0; this.skillT = 0; this.shieldT = 0; this.ally = null;
    this.banner = { lines: ['LEVEL ' + this.L], sub: this.def.name, t: 2.2, kind: 'red' };
    this.paused = false; this.result = null; this.hot = []; this.saveT = 0;
    this.tMove = null; this.tAim = null;
    SAVE.stats.runs++; persist();
    Game.toast('Shield ready: it blocks 1 damage and recharges');
    Music.intensity = 1;
    const initial = Math.min(this.total, Math.ceil(this.cap * 0.6));
    for (let k = 0; k < initial; k++) this.spawnEnemy(false);
    this.computeFlow(); this.snapCam();
    sfx('jump-c', 0.6);
  }
  /* ---------- helpers ---------- */
  cell(x, y) { const m = this.map; const cx = clamp(Math.floor(x / T), 0, m.W - 1), cy = clamp(Math.floor(y / T), 0, m.H - 1); return cy * m.W + cx; }
  passable(i, e) { const m = this.map; if (m.solid[i] & 1) return false; const h = m.hgt[i]; return h === 2 || e.ramp || h === e.h; }
  blockedAt(x, y, e, r) {
    const m = this.map;
    for (let k = 0; k < 4; k++) {
      const cx = Math.floor((x + (k & 1 ? r : -r)) / T), cy = Math.floor((y + (k & 2 ? r : -r * 0.5)) / T);
      if (cx < 0 || cy < 0 || cx >= m.W || cy >= m.H) return true;
      if (!this.passable(cy * m.W + cx, e)) return true;
    }
    return false;
  }
  move(e, dx, dy, r = 4) {
    e.hitWall = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    for (let s = 0; s < steps; s++) {
      const sx = dx / steps, sy = dy / steps;
      if (sx) { if (!this.blockedAt(e.x + sx, e.y, e, r)) e.x += sx; else e.hitWall = true; }
      if (sy) { if (!this.blockedAt(e.x, e.y + sy, e, r)) e.y += sy; else e.hitWall = true; }
      const h = this.map.hgt[this.cell(e.x, e.y)];
      if (h === 2) e.ramp = true; else { e.ramp = false; e.h = h; }
    }
  }
  los(x0, y0, x1, y1) {
    const m = this.map, d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 6);
    for (let k = 1; k < n; k++) { const x = lerp(x0, x1, k / n), y = lerp(y0, y1, k / n); if (m.solid[this.cell(x, y)] & 2) return false; }
    return true;
  }
  computeFlow() { this.flowCell = this.bfs(this.cell(this.p.x, this.p.y), this.flow); }
  /* walking distance (in cells) from one cell to every reachable cell, honoring heights and ramps */
  bfs(s, f) {
    const m = this.map, W = m.W, q = this.q; f.fill(-1);
    f[s] = 0; let qh = 0, qt = 0; q[qt++] = s;
    while (qh < qt) {
      const i = q[qh++], x = i % W, ha = m.hgt[i];
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const j of nb) {
        if (j < 0 || j >= f.length || f[j] >= 0 || (m.solid[j] & 1)) continue;
        const hb = m.hgt[j]; if (!(ha === hb || ha === 2 || hb === 2)) continue;
        f[j] = f[i] + 1; q[qt++] = j;
      }
    }
    return s;
  }
  flowDir(e) { return this.flowDirOn(e, this.flow, this.p.x, this.p.y); }
  flowDirOn(e, f, gx, gy) {
    const m = this.map, W = m.W, i = this.cell(e.x, e.y);
    let best = f[i] < 0 ? 1e9 : f[i], bi = -1;
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= f.length || f[j] < 0) continue;
      if (!this.passable(j, e)) continue;
      if (f[j] < best) { best = f[j]; bi = j; }
    }
    if (bi < 0) { const dx = gx - e.x, dy = gy - e.y, d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; }
    const tx = (bi % W) * T + 8, ty = Math.floor(bi / W) * T + 9, dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    return [dx / d, dy / d];
  }
  snapCam() { const v = this.view(); this.cam.x = this.p.x - v.w / 2; this.cam.y = this.p.y - v.h / 2; this.clampCam(); }
  zoom() { let base = Math.min(CW / 400, CH / 240); if (CH > CW * 1.1) base = CW / 270; return Math.max(1, Math.floor(base)); }
  view() { const Z = this.zoom(); return { Z, w: CW / Z, h: CH / Z }; }
  clampCam() {
    const v = this.view(), mw = this.map.W * T, mh = this.map.H * T;
    this.cam.x = mw <= v.w ? (mw - v.w) / 2 : clamp(this.cam.x, 0, mw - v.w);
    this.cam.y = mh <= v.h ? (mh - v.h) / 2 : clamp(this.cam.y, 0, mh - v.h);
  }
  toWorld(sx, sy) { const v = this.view(); return [sx / v.Z + this.cam.x, sy / v.Z + this.cam.y]; }
  puff(x, y, n = 6, col = P.dust, sp = 30) { for (let k = 0; k < n; k++) { const a = R() * TAU, s = sp * (0.4 + R()); this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, t: 0.35 + R() * 0.3, max: 0.6, size: 1 + R() * 2, col }); } }
  spark(x, y, n = 4, col = P.yelL) { for (let k = 0; k < n; k++) { const a = R() * TAU, s = 40 + R() * 70; this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.15 + R() * 0.15, max: 0.3, size: 1, col }); } }

  /* ---------- spawning ---------- */
  spawnEnemy(fromDoor) {
    if (this.spawned >= this.total) return;
    const m = this.map, pcx = (this.p.x / T) | 0, pcy = (this.p.y / T) | 0;
    let pt = null;
    if (fromDoor && m.spawnPts.length && R() < 0.6) { const c = m.spawnPts.filter(s => Math.abs(s.x - pcx) + Math.abs(s.y - pcy) > 9); if (c.length) pt = pick(R, c); }
    for (let k = 0; k < 60 && !pt; k++) { const i = m.floor[(R() * m.floor.length) | 0]; const x = i % m.W, y = (i / m.W) | 0; if (Math.abs(x - pcx) + Math.abs(y - pcy) >= (k < 40 ? 13 : 8)) pt = { x, y }; }
    if (!pt) return;
    const type = pick(R, this.def.pool);
    const e = this.addEnemy(type, pt.x * T + 8, pt.y * T + 10);
    this.spawned++;
    this.puff(e.x, e.y, 8, P.lav, 40);
  }
  addEnemy(type, x, y, boss) {
    const D = MONSTERS[type], L = this.L, h = this.map.hgt[this.cell(x, y)];
    const e = { type, D, x, y, h: h === 1 ? 1 : 0, ramp: h === 2, hp: D.hp * hpMul(L), speed: D.speed * MONSTER_SPEED * (1 + 0.008 * (L - 1)) * (0.9 + R() * 0.2), dmg: D.dmg + enemyDmg(L) - 1,
      cd: 1 + R() * 2, flash: 0, face: 1, anim: R() * 2, dead: false, deadT: 0, boss: false, scale: 1, burst: 0, burstT: 0, wob: R() * 6, kbx: 0, kby: 0, strafe: R() < 0.5 ? 1 : -1, strafeT: 2, moving: true, hitWall: false };
    e.gun = D.gun != null ? enemyGun(L) : null;
    if (boss) {
      e.boss = true; e.hp = boss.hp * lateHp(L); e.scale = boss.scale; e.speed = boss.speed * MONSTER_SPEED; e.moves = boss.moves; e.moveCd = 2; e.charge = 0; e.chargeT = 0; e.name = boss.name; e.dmg = 2;
    }
    e.maxHp = e.hp;
    this.ents.push(e); return e;
  }
  spawnBoss() {
    const m = this.map, B = this.bossDef;
    let best = null, bd = -1;
    for (let k = 0; k < 80; k++) { const i = m.floor[(R() * m.floor.length) | 0]; const x = (i % m.W) * T + 8, y = ((i / m.W) | 0) * T + 10, d = Math.hypot(x - this.p.x, y - this.p.y); if (d > bd && d < 320 && m.hgt[i] === 0) { bd = d; best = { x, y }; } }
    if (!best) best = { x: m.spawn.x * T + 8, y: m.spawn.y * T - 60 };
    this.bossEnt = this.addEnemy(B.type, best.x, best.y, B);
    this.bossSpawned = true;
    this.banner = { lines: ['YOU WILL NEVER', 'DEFEAT ME'], sub: B.name + ' has appeared!', t: 2.8, kind: 'red' };
    this.puff(best.x, best.y, 20, P.lav, 70); this.shake = 8; sfx('explosion-b', 0.8);
  }

  /* ---------- combat ---------- */
  fire() {
    const p = this.p;
    if (p.wi < 0) { this.knife(); return; }
    if (p.reload > 0 || p.cd > 0) return;
    if (p.ammo <= 0) { this.startReload(); return; }
    const w = WEAPONS[p.wi];
    p.cd = 1 / w.rate; p.ammo--;
    const ox = p.x + Math.cos(p.aim) * 12, oy = p.y - 6 + Math.sin(p.aim) * 12;
    for (let k = 0; k < w.pellets; k++) {
      const a = p.aim + (R() - 0.5) * (w.spread * Math.PI / 180);
      const sp = w.speed * (w.pellets > 1 ? 0.85 + R() * 0.3 : 1);
      this.bullets.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: w.life * (w.pellets > 1 ? 0.8 + R() * 0.4 : 1), dmg: w.dmg * dmgMul(), kind: w.kind, pierce: w.pierce || 0, splash: w.splash || 0, hit: [], wi: p.wi });
    }
    this.parts.push({ x: ox, y: oy, vx: 0, vy: 0, t: 0.05, max: 0.05, size: 3, col: P.yelL });
    sfx(w.sfx, 0.5, 0.95 + R() * 0.1, 0.02);
    if (SAVE.settings.shake) this.shake = Math.max(this.shake, w.pellets > 1 || w.dmg > 10 ? 3 : 1);
    if (p.ammo <= 0) this.startReload();
  }
  startReload() { const p = this.p; if (p.wi < 0 || p.reload > 0 || p.ammo >= WEAPONS[p.wi].mag) return; p.reload = WEAPONS[p.wi].reload; sfx('move-a', 0.6); }
  knife(ang) {
    const p = this.p; if (p.knifeCd > 0 || p.dead) return;
    const a = ang == null ? p.aim : ang;
    p.knifeCd = 1 / KNIFE.rate; p.knifeT = 0.2; p.knifeA = a;
    sfx('jump-f', 0.6, 1.2);
    for (const e of this.ents) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = (e.y - 6 * e.scale) - (p.y - 6), d = Math.hypot(dx, dy);
      if (d < KNIFE.range + 6 * e.scale && (Math.abs(angDiff(Math.atan2(dy, dx), a)) < 1.2 || d < 12)) this.damage(e, KNIFE.dmg * dmgMul(), -1, Math.cos(a) * 160, Math.sin(a) * 160);
    }
  }
  /* the knife strikes on its own at the closest monster inside its reach, at most once every 2 seconds */
  autoKnife() {
    const p = this.p; if (p.autoKnifeCd > 0 || p.knifeCd > 0 || p.dead) return;
    let best = null, bd = Infinity;
    for (const e of this.ents) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = (e.y - 6 * e.scale) - (p.y - 6), d = Math.hypot(dx, dy);
      if (d < KNIFE.range + 6 * e.scale && d < bd) { bd = d; best = Math.atan2(dy, dx); }
    }
    if (best !== null) { this.knife(best); p.autoKnifeCd = KNIFE.autoCd; }
  }
  /* Level 9 reward: every 2 seconds a Long Pistol bullet flies out of the hero's body at the nearest monster in sight */
  autoShot(dt) {
    const p = this.p; p.autoShotCd -= dt;
    if (p.autoShotCd > 0) return;
    const w = WEAPONS[AUTO_GUN], range = w.speed * w.life - 10, ox = p.x, oy = p.y - 7;
    let best = null, bd = range;
    for (const e of this.ents) {
      if (e.dead) continue;
      const tx = e.x, ty = e.y - 7 * e.scale, d = Math.hypot(tx - ox, ty - oy);
      if (d < bd && this.los(ox, oy, tx, ty)) { bd = d; best = e; }
    }
    if (!best) return;
    const a = Math.atan2(best.y - 7 * best.scale - oy, best.x - ox);
    p.autoShotCd = AUTO_GUN_CD;
    this.bullets.push({ x: ox, y: oy, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, life: w.life, dmg: w.dmg * dmgMul(), kind: w.kind, pierce: 0, splash: 0, hit: [], wi: -3 });
    sfx(w.sfx, 0.35, 1.1, 0.02);
  }
  /* upgrades bought in town: regen, the fighter and the vanishing skill */
  upgradesTick(dt) {
    const p = this.p, u = this.upg;
    if (u.regen) {
      if (p.hp >= p.maxHp) this.regenT = 0;
      else if ((this.regenT += dt) >= regenEvery(u.regen)) {
        this.regenT = 0; p.hp = Math.min(p.maxHp, p.hp + 1);
        this.nums.push({ x: p.x, y: p.y - 22, t: 0.8, v: '+1', col: P.teal });
      }
    }
    if (u.fighter) { if (!this.ally) this.spawnAlly(); this.updAlly(dt); }
    if (u.final) this.deathZone(dt);
    if (p.shield < p.maxShield) {
      if ((this.shieldT += dt) >= this.shieldEvery()) { this.shieldT = 0; p.shield = p.maxShield; this.spark(p.x, p.y - 8, 10, P.blueL); sfx('select-a', 0.6, 1.3); }
    } else this.shieldT = 0;
    if (u.skill && (this.skillT += dt) >= skillEvery(u.skill)) {
      let best = null;
      const pool = this.ents.filter(e => !e.dead && !e.boss && !(e.zap > 0)), gunners = pool.filter(e => e.gun);
      for (const e of gunners.length ? gunners : pool) if (!best || e.hp > best.hp) best = e;
      if (best) { best.zap = 0.6; this.skillT = 0; sfx('select-a', 0.7, 0.7); }
    }
  }
  /* The Death zone: AK-47 bullets fly out of the hero's body with the orange AK-47's damage,
     and every monster within pistol range loses 1 health each second */
  deathZone(dt) {
    const p = this.p, ak = WEAPONS[5], z = this.dz;
    if ((z.aura += dt) >= 1) {
      z.aura -= 1;
      const r = WEAPONS[0].speed * WEAPONS[0].life;
      for (const e of this.ents) {
        if (e.dead || e.zap > 0 || Math.hypot(e.x - p.x, e.y - p.y) > r) continue;
        this.spark(e.x, e.y - 8 * e.scale, 3, P.purp); this.damage(e, 1, -7, 0, 0);
      }
    }
    if (z.reload > 0) { if ((z.reload -= dt) <= 0) z.ammo = ak.mag; return; }
    if ((z.cd -= dt) > 0) return;
    const ox = p.x, oy = p.y - 7;
    let best = null, bd = ak.speed * ak.life - 10;
    for (const e of this.ents) {
      if (e.dead || e.zap > 0) continue;
      const tx = e.x, ty = e.y - 7 * e.scale, d = Math.hypot(tx - ox, ty - oy);
      if (d < bd && this.los(ox, oy, tx, ty)) { bd = d; best = e; }
    }
    if (!best) { z.cd = 0; return; }
    const a = Math.atan2(best.y - 7 * best.scale - oy, best.x - ox) + (R() - 0.5) * ak.spread * Math.PI / 180;
    this.bullets.push({ x: ox, y: oy, vx: Math.cos(a) * ak.speed, vy: Math.sin(a) * ak.speed, life: ak.life, dmg: ak.dmg * dmgMul(), kind: ak.kind, pierce: 0, splash: 0, hit: [], wi: -6 });
    sfx(ak.sfx, 0.3, 1.05, 0.03);
    z.cd = 1 / ak.rate;
    if (--z.ammo <= 0) z.reload = ak.reload;
  }
  /* the shield comes back on its own: 8 s, or as fast as the Regen upgrade heals */
  shieldEvery() { return this.upg.regen ? regenEvery(this.upg.regen) : 8; }
  vanish(e) {
    this.spark(e.x, e.y - 8 * e.scale, 14, P.yel); this.spark(e.x, e.y - 8 * e.scale, 8, P.yelL);
    sfx('coin-c', 0.5, 1.6);
    this.kill(e, -5, true); e.deadT = 0;
  }
  spawnAlly() {
    const p = this.p;
    this.ally = { x: p.x, y: p.y, h: p.h, ramp: p.ramp, face: 1, anim: 0, moving: false, target: null, cd: 0.5, swingT: 0, swingA: 0, flowT: 0, flowCell: -1, lost: 0, chase: 0 };
    this.aflow = new Int16Array(this.map.W * this.map.H);
  }
  /* the fighter picks a random monster, runs to it and swings its orange knife; monsters ignore it */
  updAlly(dt) {
    const a = this.ally, p = this.p;
    a.anim += dt; a.cd = Math.max(0, a.cd - dt); a.swingT = Math.max(0, a.swingT - dt);
    if (a.target && (a.target.dead || a.target.zap > 0 || (a.chase += dt) > 6)) a.target = null;
    if (!a.target) { const live = this.ents.filter(e => !e.dead && !(e.zap > 0)); if (live.length) { a.target = pick(R, live); a.flowT = 0; a.lost = 0; a.chase = 0; } }
    let tx = p.x - 14, ty = p.y, f = this.flow;
    if (a.target) {
      const e = a.target, tc = this.cell(e.x, e.y); tx = e.x; ty = e.y;
      a.flowT -= dt; if (a.flowT <= 0 || tc !== a.flowCell) { a.flowCell = this.bfs(tc, this.aflow); a.flowT = 0.4; }
      f = this.aflow;
      if (f[this.cell(a.x, a.y)] < 0 && (a.lost += dt) > 0.5) a.target = null;
    }
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
    const stop = a.target ? 12 + 4 * a.target.scale : 18;
    let mx = 0, my = 0;
    if (d > stop) {
      if (d < 40 && this.los(a.x, a.y - 6, tx, ty - 6)) { mx = dx / d; my = dy / d; }
      else [mx, my] = this.flowDirOn(a, f, tx, ty);
    }
    a.moving = Math.hypot(mx, my) > 0.1;
    if (a.moving) { this.move(a, mx * 72 * dt, my * 72 * dt, 4); a.face = mx >= 0 ? 1 : -1; }
    if (a.target && a.cd <= 0) {
      const e = a.target, ex = e.x - a.x, ey = (e.y - 6 * e.scale) - (a.y - 6);
      if (Math.hypot(ex, ey) < KNIFE.range + 6 * e.scale) {
        const ang = Math.atan2(ey, ex);
        a.cd = fighterCd(this.upg.fighter); a.swingT = 0.2; a.swingA = ang; a.face = ex >= 0 ? 1 : -1; a.chase = 0;
        sfx('jump-f', 0.4, 1.35);
        for (const o of this.ents) {
          if (o.dead || o.zap > 0) continue;
          const ox = o.x - a.x, oy = (o.y - 6 * o.scale) - (a.y - 6), od = Math.hypot(ox, oy);
          if (od < KNIFE.range + 6 * o.scale && (Math.abs(angDiff(Math.atan2(oy, ox), ang)) < 1.2 || od < 12)) this.damage(o, KNIFE.dmg * dmgMul(), -4, Math.cos(ang) * 160, Math.sin(ang) * 160);
        }
      }
    }
    if (!a.target && Math.hypot(p.x - a.x, p.y - a.y) > 220) { a.x = p.x; a.y = p.y; a.h = p.h; a.ramp = p.ramp; }
  }
  damage(e, dmg, wi, kx, ky) {
    if (e.dead) return;
    e.hp -= dmg; e.flash = 0.09;
    const kb = e.boss ? 0.15 : 1; e.kbx += kx * kb; e.kby += ky * kb;
    if (SAVE.settings.nums) this.nums.push({ x: e.x + (R() - 0.5) * 6, y: e.y - 20 * e.scale, t: 0.7, v: Math.round(dmg * 10) / 10 });
    sfx('hurt-d', 0.32, 1.1 + R() * 0.25, 0.05);
    if (e.hp <= 0) this.kill(e, wi);
  }
  kill(e, wi, quiet) {
    e.dead = true; e.deadT = 0.8;
    if (!e.boss && !e.minion) this.killed++;
    this.killsRun++; SAVE.stats.kills++;
    questEvent({ k: 'kill', mon: e.type, L: this.L, w: wi });
    const n = goldPerKill(this.L);
    for (let k = 0; k < n; k++) this.dropCoin(e.x, e.y - 4);
    if (!quiet) { this.puff(e.x, e.y - 4, 10, P.lavD, 45); sfx('hurt-c', 0.5, 0.9 + R() * 0.2, 0.05); }
    if (e.boss) {
      this.bossDead = true; SAVE.stats.bosses++; questEvent({ k: 'boss', L: this.L });
      this.shake = 12; sfx('explosion-a', 0.9);
      for (let k = 0; k < 4; k++) this.puff(e.x + (R() - 0.5) * 30, e.y - 10 + (R() - 0.5) * 20, 12, P.redL, 80);
      for (const o of this.ents) if (o.minion && !o.dead) this.kill(o, -2);
    }
    if (R() < 0.05) this.meds.push({ x: e.x, y: e.y, used: false, drop: true });
  }
  dropCoin(x, y) { const a = R() * TAU, s = 25 + R() * 45; this.coins.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0, vz: 60 + R() * 40, t: 0, mag: false }); }
  hurtPlayer(dmg, kx, ky) {
    const p = this.p; if (p.inv > 0 || p.dead || this.state !== 'play') return;
    p.inv = 0.9; p.vx += kx * 120; p.vy += ky * 120;
    if (SAVE.settings.shake) this.shake = 6;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed; dmg -= absorbed;
      this.spark(p.x, p.y - 8, 12, P.blueL); this.puff(p.x, p.y - 8, 6, P.blue, 40);
      sfx('hurt-d', 0.8, 0.6);
      if (dmg <= 0) return;
    }
    p.hp -= dmg; this.hits++;
    sfx('hurt-a', 0.8);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; this.state = 'dead'; this.deadT = 1.6; SAVE.stats.deaths++;
      sfx('lose-a', 0.8); this.puff(p.x, p.y - 4, 16, P.blue, 60); persist();
      this.banner = { lines: ['YOU DIED'], sub: 'Gold you picked up is safe in your pouch.', t: 2.2, kind: 'red' };
    }
  }
  eshoot(x, y, a, speed, kind, dmg = 1) { this.ebullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 3.2, kind, dmg }); }

  /* ---------- update ---------- */
  update(dt) {
    if (this.paused || this.result) { Music.intensity = 0.3; return; }
    Music.intensity = 1;
    this.t += dt;
    if (this.state === 'play') { this.time += dt; SAVE.stats.playTime += dt; }
    const p = this.p, m = this.map;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    // input
    let ix = 0, iy = 0;
    if (!p.dead) {
      if (IN.keys.a || IN.keys.arrowleft) ix -= 1; if (IN.keys.d || IN.keys.arrowright) ix += 1;
      if (IN.keys.w || IN.keys.arrowup) iy -= 1; if (IN.keys.s || IN.keys.arrowdown) iy += 1;
      if (this.tMove) { const o = IN.touches[this.tMove]; if (o) { const dx = o.x - o.sx, dy = o.y - o.sy, d = Math.hypot(dx, dy), R0 = 40 * DPR; if (d > 6 * DPR) { ix = dx / Math.max(d, R0); iy = dy / Math.max(d, R0); } } }
      const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
      // aim
      if (this.tAim && IN.touches[this.tAim]) { const o = IN.touches[this.tAim]; const [wx, wy] = this.toWorld(o.x, o.y); p.aim = Math.atan2(wy - (p.y - 6), wx - p.x); }
      else if (IN.touch) { const tgt = this.nearestEnemy(170); if (tgt) p.aim = Math.atan2(tgt.y - 6 * tgt.scale - (p.y - 6), tgt.x - p.x); else if (ix || iy) p.aim = Math.atan2(iy, ix); }
      else { const [wx, wy] = this.toWorld(IN.mx, IN.my); p.aim = Math.atan2(wy - (p.y - 6), wx - p.x); }
      const firing = (IN.down && !IN.touch) || (this.tAim && IN.touches[this.tAim]);
      if (firing && this.state !== 'dead') this.fire();
      this.autoKnife();
      if (hasAutoGun() && this.state === 'play') this.autoShot(dt);
      if (this.state === 'play') this.upgradesTick(dt);
    }
    // timers
    p.cd = Math.max(0, p.cd - dt); p.knifeCd = Math.max(0, p.knifeCd - dt); p.autoKnifeCd = Math.max(0, p.autoKnifeCd - dt); p.knifeT = Math.max(0, p.knifeT - dt);
    p.inv = Math.max(0, p.inv - dt); p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = WEAPONS[p.wi].mag; sfx('move-c' in AUD.buf ? 'move-c' : 'select-a', 0.5); } }
    // movement
    const speed = 84;
    if (p.dashT > 0) { p.dashT -= dt; p.vx = p.dashX * 230; p.vy = p.dashY * 230; if (R() < 0.6) this.puff(p.x, p.y + 2, 1, P.dust, 10); }
    else { const k = 1 - Math.exp(-dt * 16); p.vx = lerp(p.vx, ix * speed, k); p.vy = lerp(p.vy, iy * speed, k); }
    if (!p.dead) this.move(p, p.vx * dt, p.vy * dt, 4);
    p.moving = Math.hypot(p.vx, p.vy) > 12; if (p.moving) { p.walk += dt; if (Math.floor(p.walk * 6) !== Math.floor((p.walk - dt) * 6) && Math.floor(p.walk * 6) % 2 === 0) this.puff(p.x, p.y + 3, 1, P.dust, 8); }
    // flow field
    this.flowT -= dt; const pc = this.cell(p.x, p.y);
    if (this.flowT <= 0 || pc !== this.flowCell) { this.computeFlow(); this.flowT = 0.4; }
    // spawning & boss
    if (this.state === 'play') {
      this.spawnT -= dt;
      const alive = this.ents.filter(e => !e.dead && !e.boss).length;
      if (this.spawnT <= 0 && this.spawned < this.total && alive < this.cap) { this.spawnEnemy(true); this.spawnT = Math.max(0.9, 2.6 - this.L * 0.06) * (0.7 + R() * 0.6); }
      if (this.bossDef && !this.bossSpawned && this.killed >= Math.ceil(this.total / 2)) this.spawnBoss();
      const done = this.spawned >= this.total && (!this.bossDef || this.bossDead) && !this.ents.some(e => !e.dead);
      if (done) {
        this.state = 'clear';
        this.portal = { x: m.spawn.x * T + 8, y: m.spawn.y * T + 8 };
        this.banner = { lines: ['LEVEL CLEAR'], sub: 'Step into the portal by your start point', t: 3, kind: 'red' };
        sfx('coin-d', 0.9); this.coins.forEach(c => { c.mag = true; });
      }
    }
    // enemies
    for (const e of this.ents) this.updEnemy(e, dt);
    this.ents = this.ents.filter(e => !e.dead || e.deadT > 0);
    // bullets
    for (const b of this.bullets) {
      b.life -= dt; const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (this.blockFire(b, nx, ny)) continue;
      if (m.solid[this.cell(nx, ny)] & 2 || nx < 0 || ny < 0 || nx > m.W * T || ny > m.H * T) { b.life = 0; this.spark(b.x, b.y, 3, P.white); if (b.splash) this.explode(b); continue; }
      b.x = nx; b.y = ny;
      for (const e of this.ents) {
        if (e.dead || b.hit.includes(e)) continue;
        const r = 7 * e.scale + 2;
        if (Math.abs(e.x - b.x) < r && Math.abs(e.y - 7 * e.scale - b.y) < r + 2) {
          b.hit.push(e);
          const sp = Math.hypot(b.vx, b.vy) || 1;
          this.damage(e, b.dmg, b.wi, b.vx / sp * 70, b.vy / sp * 70);
          this.spark(b.x, b.y, 3);
          if (b.splash) { this.explode(b); b.life = 0; break; }
          if (b.pierce > 0) b.pierce--; else { b.life = 0; break; }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.life > 0);
    for (const b of this.ebullets) {
      if (b.life <= 0) continue;
      b.life -= dt; const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (m.solid[this.cell(nx, ny)] & 2 || nx < 0 || ny < 0 || nx > m.W * T || ny > m.H * T) { b.life = 0; this.spark(b.x, b.y, 3, P.redL); continue; }
      b.x = nx; b.y = ny;
      if (!p.dead && Math.abs(b.x - p.x) < 5 && Math.abs(b.y - (p.y - 6)) < 7) { b.life = 0; const sp = Math.hypot(b.vx, b.vy) || 1; this.hurtPlayer(b.dmg, b.vx / sp, b.vy / sp); }
    }
    this.ebullets = this.ebullets.filter(b => b.life > 0);
    // coins
    for (const c of this.coins) {
      c.t += dt;
      if (c.z > 0 || c.vz > 0) { c.vz -= 260 * dt; c.z += c.vz * dt; if (c.z <= 0) { c.z = 0; c.vz = c.vz < -40 ? -c.vz * 0.35 : 0; } }
      c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= Math.pow(0.02, dt); c.vy *= Math.pow(0.02, dt);
      const dx = p.x - c.x, dy = (p.y - 4) - c.y, d = Math.hypot(dx, dy);
      if (!p.dead && (c.mag || (d < 38 && c.t > 0.35))) { c.mag = true; const s = 160 + (c.t * 60); c.x += dx / (d || 1) * s * dt; c.y += dy / (d || 1) * s * dt; }
      if (!p.dead && d < 6 && c.t > 0.2) { c.got = true; this.gainGold(1); }
    }
    this.coins = this.coins.filter(c => !c.got);
    // chests & medkits
    for (const c of this.chests) {
      if (c.open || p.dead) continue;
      if (Math.abs(p.x - c.x) < 11 && Math.abs(p.y - c.y) < 11) {
        c.open = true; sfx('coin-c', 0.9); this.chestsRun++; SAVE.stats.chests++; questEvent({ k: 'chest', L: this.L });
        for (let k = 0; k < (c.gold ? 15 : 5); k++) this.dropCoin(c.x, c.y - 8);
        this.spark(c.x, c.y - 8, 10, P.yel);
      }
    }
    for (const md of this.meds) {
      if (md.used || p.dead || p.hp >= p.maxHp) continue;
      if (Math.abs(p.x - md.x) < 10 && Math.abs(p.y - md.y) < 10) { md.used = true; p.hp = Math.min(p.maxHp, p.hp + 4); sfx('jump-a', 0.7, 1.3); this.spark(md.x, md.y - 8, 10, P.teal); Game.toast('+4 health'); }
    }
    // portal
    if (this.portal && !p.dead && Math.hypot(p.x - this.portal.x, p.y - this.portal.y) < 10) this.finish(true);
    if (this.state === 'dead') { this.deadT -= dt; if (this.deadT <= 0 && !this.result) this.finish(false); }
    // particles
    for (const q of this.parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= Math.pow(0.05, dt); q.vy *= Math.pow(0.05, dt); }
    this.parts = this.parts.filter(q => q.t > 0);
    for (const n of this.nums) { n.t -= dt; n.y -= 18 * dt; }
    this.nums = this.nums.filter(n => n.t > 0);
    // camera
    const v = this.view();
    let lx = 0, ly = 0;
    if (!IN.touch) { const [wx, wy] = this.toWorld(IN.mx, IN.my); lx = clamp((wx - p.x) * 0.18, -40, 40); ly = clamp((wy - p.y) * 0.18, -30, 30); }
    const tx = p.x + lx - v.w / 2, ty = p.y + ly - v.h / 2, k = 1 - Math.exp(-dt * 8);
    this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k); this.clampCam();
    this.shake = Math.max(0, this.shake - dt * 30);
    this.saveT += dt; if (this.saveT > 10) { this.saveT = 0; persist(); }
  }
  /* a player shot knocks a yellow imp's fireball out of the air */
  blockFire(b, nx, ny) {
    const sx = nx - b.x, sy = ny - b.y, ll = sx * sx + sy * sy || 1;
    for (const f of this.ebullets) {
      if (f.life <= 0 || f.kind !== 'fire') continue;
      const t = clamp(((f.x - b.x) * sx + (f.y - b.y) * sy) / ll, 0, 1);
      const cx = b.x + sx * t - f.x, cy = b.y + sy * t - f.y;
      if (cx * cx + cy * cy > 30) continue;
      f.life = 0;
      this.spark(f.x, f.y, 6, P.yel); this.puff(f.x, f.y, 4, P.redL, 30);
      sfx('explosion-a', 0.2, 2.2, 0.05);
      if (b.splash) { b.x = f.x; b.y = f.y; this.explode(b); b.life = 0; return true; }
      if (b.pierce > 0) { b.pierce--; return false; }
      b.life = 0; return true;
    }
    return false;
  }
  gainGold(n) { SAVE.gold += n; SAVE.stats.goldEarned += n; this.goldRun += n; questEvent({ k: 'gold', n }); sfx('coin-a', 0.45, 1 + R() * 0.15, 0.04); }
  nearestEnemy(r) { let best = null, bd = r; for (const e of this.ents) { if (e.dead) continue; const d = Math.hypot(e.x - this.p.x, e.y - this.p.y); if (d < bd) { bd = d; best = e; } } return best; }
  explode(b) {
    this.puff(b.x, b.y, 10, P.purp, 70); sfx('explosion-a', 0.35, 1.4, 0.08);
    for (const e of this.ents) { if (e.dead || b.hit.includes(e)) continue; const d = Math.hypot(e.x - b.x, e.y - 6 * e.scale - b.y); if (d < b.splash) this.damage(e, b.dmg * 0.6, b.wi, (e.x - b.x) * 3, (e.y - b.y) * 3); }
  }
  updEnemy(e, dt) {
    if (e.dead) { e.deadT -= dt; return; }
    if (e.zap > 0) { e.zap -= dt; if (e.zap <= 0) this.vanish(e); return; }
    const p = this.p, D = e.D;
    e.anim += dt; e.flash = Math.max(0, e.flash - dt); e.cd -= dt;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    e.face = dx >= 0 ? 1 : -1;
    let mx = 0, my = 0, sp = e.speed;
    const active = this.state === 'play' && !p.dead && this.t > 1.6;
    if (!active) { e.moving = false; }
    else if (e.boss && e.charge > 0) {
      e.charge -= dt;
      if (e.charge > 0.5) { sp = 0; e.flash = (Math.floor(e.charge * 20) % 2) ? 0.05 : 0; }
      else { if (!e.cdx) { e.cdx = dx / d; e.cdy = dy / d; } mx = e.cdx; my = e.cdy; sp = e.speed * 4.2; if (R() < 0.5) this.puff(e.x, e.y + 2, 1, P.dust, 20); }
      if (e.charge <= 0) { e.cdx = 0; e.cdy = 0; }
    } else if (D.ai === 'fly' && !e.boss) {
      e.wob += dt * 3; mx = dx / d + Math.cos(e.wob) * 0.7; my = dy / d + Math.sin(e.wob * 1.3) * 0.7;
    } else {
      const ranged = !!D.shot || e.boss;
      const see = this.los(e.x, e.y - 6, p.x, p.y - 6);
      e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = 1.5 + R() * 2; e.strafe *= -1; }
      const rng_ = e.gun ? e.gun.range : D.range || 110;
      if (ranged && see && d < rng_ && !e.boss) {
        mx = -dy / d * e.strafe * 0.8; my = dx / d * e.strafe * 0.8;
        if (d < rng_ * 0.55) { mx -= dx / d * 0.7; my -= dy / d * 0.7; }
        sp *= 0.7;
      } else if (see && d < 70 && (e.h === p.h || e.ramp || p.ramp)) { mx = dx / d; my = dy / d; }
      else { [mx, my] = this.flowDir(e); }
    }
    // separation
    for (const o of this.ents) {
      if (o === e || o.dead) continue;
      const ox = e.x - o.x, oy = e.y - o.y, od = ox * ox + oy * oy, rr = 9 * Math.max(e.scale, o.scale);
      if (od < rr * rr && od > 0.01) { const l = Math.sqrt(od); mx += ox / l * 0.6; my += oy / l * 0.6; }
    }
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    e.moving = ml > 0.1;
    e.kbx *= Math.pow(0.002, dt); e.kby *= Math.pow(0.002, dt);
    const vx = mx * sp + e.kbx, vy = my * sp + e.kby;
    if (D.ai === 'fly' && !e.boss) { e.x = clamp(e.x + vx * dt, 8, this.map.W * T - 8); e.y = clamp(e.y + vy * dt, 12, this.map.H * T - 4); }
    else this.move(e, vx * dt, vy * dt, e.boss ? 6 : 4);
    if (!active) return;
    // contact damage
    const reach = 8 + 4 * e.scale;
    if (Math.abs(dx) < reach && Math.abs(dy) < reach * 0.8) this.hurtPlayer(e.dmg, dx / d, dy / d);
    // ranged attacks
    if (e.boss) this.bossAI(e, dt, dx, dy, d);
    else if (D.shot) {
      if (e.burst > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          const a = Math.atan2(p.y - 6 - (e.y - 7), p.x - e.x) + (R() - 0.5) * D.shot.spread * Math.PI / 180;
          this.eshoot(e.x, e.y - 7, a, e.gun ? e.gun.speed : D.shot.speed * (1 + 0.006 * this.L), D.shot.kind, enemyDmg(this.L));
          sfx(D.shot.kind === 'fire' ? 'shoot-f' : 'shoot-a', 0.25, D.shot.kind === 'fire' ? 0.7 : 1.3, 0.06);
          e.burst--; e.burstT = D.shot.gap;
        }
      } else if (e.cd <= 0 && d < (e.gun ? e.gun.range : D.range || 100) * 1.35 && this.los(e.x, e.y - 7, p.x, p.y - 6)) {
        e.burst = D.shot.n; e.burstT = 0.25;
        e.cd = e.gun ? e.gun.cd + R() * 0.5 : D.cd * (0.8 + R() * 0.4) * Math.max(0.6, 1 - this.L * 0.008);
      }
    }
  }
  bossAI(e, dt, dx, dy, d) {
    e.moveCd -= dt;
    const enraged = e.hp < e.maxHp * 0.5;
    if (e.moveCd > 0 || e.charge > 0) return;
    const mv = pick(R, e.moves), a0 = Math.atan2(this.p.y - 6 - (e.y - 14), this.p.x - e.x), dmg = enemyDmg(this.L), kind = e.type === 'imp' ? 'fire' : 'ebullet';
    if (mv === 'charge') { e.charge = 1.0; sfx('jump-a', 0.7, 0.7); }
    else if (mv === 'spawn') {
      const alive = this.ents.filter(o => !o.dead && o.minion).length;
      if (alive < 6) for (let k = 0; k < 3; k++) { const a = R() * TAU; const m = this.addEnemy(e.type === 'imp' || e.type === 'bat' ? 'bat' : e.type === 'slime' ? 'slime' : pick(R, ['hound', 'imp', 'bat']), e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 12); m.minion = true; m.hp *= 0.7; m.maxHp = m.hp; this.puff(m.x, m.y, 6, P.lav, 40); }
      sfx('jump-c', 0.6, 0.8);
    } else if (mv === 'ring') {
      const n = enraged ? 18 : 14, off = R() * TAU;
      for (let k = 0; k < n; k++) this.eshoot(e.x, e.y - 14, off + k / n * TAU, 85, kind, dmg);
      sfx('explosion-a', 0.4, 1.6);
    } else if (mv === 'aim') {
      for (let k = 0; k < (enraged ? 5 : 3); k++) setTimeout(() => { if (!e.dead && this.state === 'play') { const a = Math.atan2(this.p.y - 6 - (e.y - 14), this.p.x - e.x); this.eshoot(e.x, e.y - 14, a, 150, kind, dmg); sfx('shoot-a', 0.3, 0.8, 0.05); } }, k * 140);
    } else if (mv === 'spread') {
      const n = enraged ? 7 : 5;
      for (let k = 0; k < n; k++) this.eshoot(e.x, e.y - 14, a0 + (k - (n - 1) / 2) * 0.16, 130, kind, dmg);
      sfx('shoot-h', 0.4, 0.8);
    }
    e.moveCd = (1.5 + R() * 0.9) * (enraged ? 0.7 : 1);
  }
  finish(won) {
    if (this.result) return;
    const p = this.p;
    if (won) {
      if (this.coins.length) { this.gainGold(this.coins.length); this.coins = []; }
      const first = !SAVE.cleared[this.li];
      if (first && this.li === 8) Game.toast('Level 9 reward: weapons hit 1.5x harder, and a Long Pistol now fires for you');
      SAVE.cleared[this.li] = 1;
      const tm = Math.round(this.time);
      if (!SAVE.best[this.li] || tm < SAVE.best[this.li]) SAVE.best[this.li] = tm;
      questEvent({ k: 'clear', L: this.L, hits: this.hits });
      sfx('coin-d', 0.9); sfx('jump-c', 0.6, 1.2);
      this.result = { won: true, first };
    } else this.result = { won: false };
    cv.style.cursor = 'default';
    persist();
  }

  /* ---------- input hooks ---------- */
  key(k) {
    if (k === 'escape' || k === 'p') { if (!this.result) this.paused = !this.paused; return; }
    if (this.paused || this.result) { if (k === 'enter' && this.result) this.resultDefault(); return; }
    const p = this.p;
    if (k === 'r') this.startReload();
    if ((k === ' ' || k === 'shift') && p.dashCd <= 0 && !p.dead) {
      let dx = p.vx, dy = p.vy, l = Math.hypot(dx, dy);
      if (l < 10) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); l = 1; }
      p.dashX = dx / l; p.dashY = dy / l; p.dashT = 0.17; p.dashCd = 0.9; p.inv = Math.max(p.inv, 0.25); sfx('jump-a', 0.5);
    }
    if (k === 'q' || k === 'tab') this.cycleWeapon(1);
    if (k >= '1' && k <= '8') { const wi = +k - 1, g = wi + ORANGE_N; if (SAVE.owned[g]) this.equip(g); else if (SAVE.owned[wi]) this.equip(wi); }
    if (k === '0') this.equip(-1);
  }
  wheel(dir) { if (!this.paused && !this.result) this.cycleWeapon(dir); }
  cycleWeapon(dir) {
    const list = [-1]; SAVE.owned.forEach((o, i) => { if (o) list.push(i); });
    const i = list.indexOf(this.p.wi); this.equip(list[(i + dir + list.length) % list.length]);
  }
  equip(wi) { const p = this.p; if (p.wi === wi) return; p.wi = wi; p.ammo = wi >= 0 ? WEAPONS[wi].mag : 0; p.reload = 0; p.cd = 0.2; SAVE.equipped = wi; sfx('move-a', 0.6); }
  blur() { if (!this.result) this.paused = true; }
  click(px, py) {
    if (this.paused || this.result) {
      const [mx, my] = toMenu(px, py);
      for (let i = this.hot.length - 1; i >= 0; i--) { const h = this.hot[i]; if (mx >= h.x && my >= h.y && mx < h.x + h.w && my < h.y + h.h) { sfx('select-a', 0.7); h.fn(); return; } }
      return;
    }
    if (IN.touch) return;
  }
  rclick() {}
  touchStart(id, x, y) {
    if (this.paused || this.result) { IN.mx = x; IN.my = y; this.click(x, y); return; }
    // pause button (top-right corner)
    const u = this.hudScale(); if (x > CW - 30 * u && y < 30 * u && x < CW && y > 0 && y < 24 * u && x > CW - 24 * u) { this.paused = true; return; }
    if (x < CW * 0.45 && !this.tMove) this.tMove = id;
    else if (!this.tAim) this.tAim = id;
  }
  touchEnd(id) { if (this.tMove === id) this.tMove = null; if (this.tAim === id) this.tAim = null; }
  resultDefault() { if (this.result.won && this.L < LEVEL_N) startLevel(this.li + 1); else this.toTown(); }
  toTown() { Music.intensity = 0; cv.style.cursor = 'default'; persist(); setScene(new Home()); }

  /* ---------- drawing ---------- */
  hudScale() { const s = Math.min(CW / 460, CH / 258); return s >= 1 ? Math.floor(s) : s; }
  draw() {
    const m = this.map, p = this.p, v = this.view(), Z = v.Z;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = P.sand; ctx.fillRect(0, 0, CW, CH);
    const sh = SAVE.settings.shake ? this.shake : 0;
    const sx = (R() - 0.5) * sh * Z * 0.6, sy = (R() - 0.5) * sh * Z * 0.6;
    ctx.setTransform(Z, 0, 0, Z, Math.round(-this.cam.x * Z + sx), Math.round(-this.cam.y * Z + sy));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(m.canvas, 0, 0);
    // ground objects
    for (const c of this.chests) spr('tiles', c.gold ? (c.open ? 219 : 218) : (c.open ? 217 : 216), c.x - 8, c.y - 14);
    for (const md of this.meds) if (!md.used) spr('tiles', 222, md.x - 8, md.y - 14 + (md.drop ? Math.round(Math.sin(this.t * 4)) : 0));
    if (this.portal) { const f = Math.floor(this.t * 6) % 2 ? 124 : 196; spr('tiles', f, this.portal.x - 8, this.portal.y - 8, { scale: 1 }); spr('tiles', f, this.portal.x - 12, this.portal.y - 12, { scale: 1.5, alpha: 0.35, rot: this.t * 2 }); }
    for (const c of this.coins) {
      ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.fillRect(Math.round(c.x) - 2, Math.round(c.y) + 3, 4, 1);
      spr('tiles', 225, Math.round(c.x) - 8, Math.round(c.y - c.z) - 8);
    }
    // entities, y-sorted
    const list = this.ents.slice(); list.push(p); if (this.ally) list.push(this.ally);
    list.sort((a, b) => a.y - b.y);
    for (const e of list) { if (e === p) this.drawPlayer(); else if (e === this.ally) this.drawAlly(); else this.drawEnemy(e); }
    ctx.drawImage(m.over, 0, 0);
    // bullets
    for (const b of this.bullets) this.drawBullet(b, false);
    for (const b of this.ebullets) this.drawBullet(b, true);
    for (const q of this.parts) { ctx.globalAlpha = clamp(q.t / q.max * 1.5, 0, 1); ctx.fillStyle = q.col; const s = q.size; ctx.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s); }
    ctx.globalAlpha = 1;
    for (const n of this.nums) { ctx.globalAlpha = clamp(n.t / 0.3, 0, 1); stextO(String(n.v), n.x, n.y, 6, n.col || P.white, P.dark, 'center', 700, 2); }
    ctx.globalAlpha = 1;
    this.drawHud();
  }
  drawPlayer() {
    const p = this.p, flip = Math.cos(p.aim) < 0;
    ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 3, 6, 2.2, 0, 0, TAU); ctx.fill();
    if (p.inv > 0 && !p.dead && Math.floor(p.inv * 20) % 2 === 0) ctx.globalAlpha = 0.45;
    const fr = p.dead ? 15 : p.inv > 0.55 ? 14 : (p.moving ? (Math.floor(p.walk * 8) % 2 ? 13 : 12) : (Math.floor(this.t * 1.6) % 2 ? 12 : 13));
    const gunBehind = Math.sin(p.aim) < -0.35;
    if (!p.dead && gunBehind) this.drawGun();
    spr('enemies', fr, Math.round(p.x) - 12, Math.round(p.y) - 20, flip ? { flip: true } : null);
    if (!p.dead && !gunBehind) this.drawGun();
    ctx.globalAlpha = 1;
    if (p.reload > 0) { const w = WEAPONS[p.wi]; const f = 1 - p.reload / w.reload; ctx.fillStyle = P.dark; ctx.fillRect(Math.round(p.x) - 9, Math.round(p.y) - 27, 18, 4); ctx.fillStyle = P.yel; ctx.fillRect(Math.round(p.x) - 8, Math.round(p.y) - 26, Math.round(16 * f), 2); }
  }
  drawGun() {
    const p = this.p, left = Math.cos(p.aim) < 0;
    if (p.knifeT > 0 || p.wi < 0) {
      const ka = p.knifeT > 0 ? p.knifeA : p.aim, kl = Math.cos(ka) < 0;
      const swing = p.knifeT > 0 ? (1 - p.knifeT / 0.2) * 2.2 - 1.1 : 0.5;
      const a = ka + (kl ? -swing : swing);
      spr('weapons', KNIFE.tile, p.x + Math.cos(a) * 9 - 12, p.y - 7 + Math.sin(a) * 9 - 12, { rot: a + Math.PI / 2 });
      if (p.knifeT > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y - 7, 16, ka - 1, ka + 1); ctx.stroke(); }
      if (p.wi < 0) return;
    }
    const w = WEAPONS[p.wi], rec = p.cd > 0 ? p.cd * w.rate * 2 : 0;
    spr('weapons', w.tile, p.x + Math.cos(p.aim) * (7 - rec) - 12, p.y - 6 + Math.sin(p.aim) * (7 - rec) - 12, { rot: p.aim, flipY: left });
  }
  drawAlly() {
    const a = this.ally;
    ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.beginPath(); ctx.ellipse(a.x, a.y + 3, 6, 2.2, 0, 0, TAU); ctx.fill();
    const fr = 8 + (a.swingT > 0 ? 2 : a.moving ? Math.floor(a.anim * 8) % 2 : Math.floor(a.anim * 1.6) % 2);
    spr('players', fr, Math.round(a.x) - 12, Math.round(a.y) - 20, a.face < 0 ? { flip: true } : null);
    const base = a.swingT > 0 ? a.swingA : (a.face > 0 ? 0.5 : Math.PI - 0.5), left = Math.cos(base) < 0;
    const swing = a.swingT > 0 ? (1 - a.swingT / 0.2) * 2.2 - 1.1 : 0.5, ka = base + (left ? -swing : swing);
    spr('weapons', KNIFE.tile, a.x + Math.cos(ka) * 9 - 12, a.y - 7 + Math.sin(ka) * 9 - 12, { rot: ka + Math.PI / 2 });
  }
  drawEnemy(e) {
    const D = e.D, sc = e.scale;
    if (e.dead && Math.floor(e.deadT * 12) % 2) return;
    ctx.fillStyle = 'rgba(71,50,75,0.25)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 3, 6 * sc, 2.2 * sc, 0, 0, TAU); ctx.fill();
    let fr = D.f + (e.moving ? (Math.floor(e.anim * (D.ai === 'fly' ? 10 : 6)) % 2) : (Math.floor(e.anim * 2) % 2));
    if (e.boss && e.charge > 0.5) fr = D.f + 2;
    if (e.dead) fr = D.f + 3;
    const sheet = e.zap > 0 ? D.sheet + 'Y' : e.flash > 0 && !e.dead ? D.sheet + 'W' : D.sheet;
    const bob = D.ai === 'fly' && !e.dead ? Math.round(Math.sin(e.anim * 6) * 1.5) - 4 : 0;
    const x = Math.round(e.x - 12 * sc), y = Math.round(e.y + 4 - 24 * sc) + bob;
    spr(sheet, fr, x, y, { flip: e.face < 0, scale: sc });
    if (e.gun && !e.dead) {
      const a = Math.atan2(this.p.y - 6 - (e.y - 7 * sc), this.p.x - e.x), left = Math.cos(a) < 0;
      spr('weapons', e.gun.tile, e.x + Math.cos(a) * 6 * sc - 12, e.y - 6 * sc + Math.sin(a) * 6 * sc - 12, { rot: a, flipY: left });
    }
    if (!e.boss && !e.dead && e.hp < e.maxHp) { ctx.fillStyle = P.dark; ctx.fillRect(Math.round(e.x) - 7, y - 3, 14, 3); ctx.fillStyle = P.red; ctx.fillRect(Math.round(e.x) - 6, y - 2, Math.max(1, Math.round(12 * e.hp / e.maxHp)), 1); }
  }
  drawBullet(b, enemy) {
    const a = Math.atan2(b.vy, b.vx), x = b.x, y = b.y;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const R2 = (w, h, c) => { ctx.fillStyle = c; ctx.fillRect(-w / 2, -h / 2, w, h); };
    if (enemy) {
      if (b.kind === 'fire') { const f = Math.floor(this.t * 20) % 2; R2(7, 7, P.dark); R2(5, 5, P.red); R2(3, 3, f ? P.yel : P.yelL); }
      else { R2(7, 5, P.dark); R2(5, 3, P.redL); R2(3, 1, P.white); }
    } else if (b.kind === 'laser') { R2(9, 4, P.dark); R2(7, 2, P.teal); R2(5, 1, P.white); }
    else if (b.kind === 'tracer') { R2(14, 3, P.dark); R2(12, 1, P.white); }
    else if (b.kind === 'plasma') { R2(8, 8, P.dark); R2(6, 6, P.purp); R2(3, 3, P.white); }
    else if (b.kind === 'pellet') { R2(4, 4, P.dark); R2(2, 2, P.yelL); }
    else { R2(7, 4, P.dark); R2(5, 2, P.yel); R2(2, 2, P.white); }
    ctx.restore();
  }
  drawHud() {
    const u = this.hudScale(); ctx.setTransform(u, 0, 0, u, 0, 0); ctx.imageSmoothingEnabled = false;
    const HW = CW / u, HH = CH / u, p = this.p;
    // health + gold
    bar(6, 6, 84, 12, p.hp / p.maxHp, 'red', 5);
    bar(92, 6, 18, 12, p.shield >= p.maxShield ? 1 : this.shieldT / this.shieldEvery(), 'blue', 1);
    spr('tiles', 225, 3, 19); ptext(String(SAVE.gold), 18, 20, 'A');
    // level info
    const left = Math.max(0, this.total - this.killed) + (this.bossDef && !this.bossDead ? 1 : 0);
    stextO(`Level ${this.L}: ${this.def.name}`, HW / 2, 10, 6.4, P.white, P.dark, 'center', 700, 2.2);
    stextO(this.state === 'clear' ? 'Find the portal' : `Monsters left: ${left}`, HW / 2, 20, 5.4, P.yelL, P.dark, 'center', 700, 2);
    // minimap (round frame)
    this.drawMinimap(HW - 54, 4);
    // jobs
    let jy = 60;
    for (const id of ['cat', 'mouse']) {
      const q = SAVE.npcs[id].quest; if (!q || q.status === 'offered') continue;
      const s = q.status === 'done' ? `${NPCS[id].name}: job done!` : `${NPCS[id].name}: ${q.prog}/${q.n} ${shortGoal(q)}`;
      stextO(s, HW - 6, jy, 5, q.status === 'done' ? P.yel : P.white, P.dark, 'right', 600, 2); jy += 9;
    }
    // weapon box
    panel('blue', 4, HH - 40, 92, 34, false);
    if (p.wi >= 0) {
      const w = WEAPONS[p.wi];
      spr('weapons', w.tile, 10, HH - 35);
      stextO(w.name, 36, HH - 28, 5.2, P.white, P.dark, 'left', 700, 2);
      stextO(p.reload > 0 ? 'Reloading' : `${p.ammo} / ${w.mag}`, 36, HH - 18, 5.6, p.ammo === 0 || p.reload > 0 ? P.yelL : P.white, P.dark, 'left', 700, 2);
    } else {
      spr('weapons', KNIFE.tile, 10, HH - 35);
      stextO('Knife', 36, HH - 28, 5.2, P.white, P.dark, 'left', 700, 2);
      stextO('Buy guns in town', 36, HH - 18, 4.6, P.white, P.dark, 'left', 600, 2);
    }
    // boss bar
    if (this.bossEnt && !this.bossEnt.dead) {
      const e = this.bossEnt, w = Math.min(220, HW - 220);
      ptext(e.name.toUpperCase(), HW / 2, HH - 34, 'B', 'center');
      bar(HW / 2 - w / 2, HH - 20, w, 12, e.hp / e.maxHp, 'red');
    }
    // banner
    if (this.banner && !this.result) {
      const b = this.banner, a = clamp(b.t / 0.35, 0, 1), lw = Math.max(...b.lines.map(l => ptW(l, 'B'))) + 40, bh = 30 + b.lines.length * 15;
      ctx.globalAlpha = a;
      const bx = HW / 2 - lw / 2, by = HH * 0.28 - bh / 2;
      panel('red', bx, by, lw, bh);
      b.lines.forEach((l, k) => ptext(l, HW / 2, by + 12 + k * 15, 'B', 'center'));
      stextO(b.sub, HW / 2, by + bh + 9, 6, P.white, P.dark, 'center', 700, 2.2);
      ctx.globalAlpha = 1;
    }
    // touch hints / pause icon
    if (IN.touch) {
      ctx.globalAlpha = 0.6; btn('grey', HW - 22, HH - 24, 18, 18, false); stext('II', HW - 13, HH - 15.5, 6, P.dark, 'center', 700); ctx.globalAlpha = 1;
      if (this.tMove && IN.touches[this.tMove]) { const o = IN.touches[this.tMove]; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.sx / u, o.sy / u, 22, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(o.x / u, o.y / u, 7, 0, TAU); ctx.fill(); }
    }
    // overlays
    this.hot = [];
    if (this.paused) this.drawPause();
    else if (this.result) this.drawResult();
    else if (!IN.touch && !p.dead) { cv.style.cursor = 'none'; spr('weapons', p.reload > 0 ? 29 : 25, IN.mx / u - 12, IN.my / u - 12); }
  }
  drawMinimap(x, y) {
    const rd = [0, 1, 2, 18, 19, 20, 36, 37, 38];
    for (let k = 0; k < 9; k++) spr('ui', rd[k], x + (k % 3) * 16, y + Math.floor(k / 3) * 16);
    const cx = x + 24, cy = y + 24, r = 17, k = 5, p = this.p, m = this.map;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    ctx.fillStyle = P.sand; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(m.canvas, p.x - r * k, p.y - r * k, r * 2 * k, r * 2 * k, cx - r, cy - r, r * 2, r * 2);
    ctx.imageSmoothingEnabled = false;
    const dot = (wx, wy, c, s = 2) => { const dx = (wx - p.x) / k, dy = (wy - p.y) / k; if (dx * dx + dy * dy < (r - 1) * (r - 1)) { ctx.fillStyle = P.dark; ctx.fillRect(Math.round(cx + dx) - s / 2 - 0.5, Math.round(cy + dy) - s / 2 - 0.5, s + 1, s + 1); ctx.fillStyle = c; ctx.fillRect(Math.round(cx + dx) - s / 2, Math.round(cy + dy) - s / 2, s, s); } };
    for (const c of this.chests) if (!c.open) dot(c.x, c.y, P.yel);
    for (const e of this.ents) if (!e.dead) dot(e.x, e.y, e.boss ? P.white : P.red, e.boss ? 3 : 2);
    if (this.portal) dot(this.portal.x, this.portal.y, P.purp, 3);
    ctx.restore();
    spr('ui', 74, cx - 8, cy - 8, { rot: p.aim + Math.PI / 2, scale: 0.75 });
  }
  overlayBtn(kind, x, y, w, h, label, fn) {
    const [mx, my] = toMenu(IN.mx, IN.my), on = !IN.touch && mx >= x && my >= y && mx < x + w && my < y + h;
    this.hot.push({ x, y, w, h, fn });
    btn(kind, x, y - (on ? 1 : 0), w, h);
    stext(label, x + w / 2, y + h / 2 - 0.5 - (on ? 1 : 0), BTN_FONT, kind === 'red' ? P.white : P.dark, 'center', 600);
    return on;
  }
  drawPause() {
    cv.style.cursor = 'default'; dim(); menuXf();
    const x = 150, y = 50, w = 160, h = 150;
    panel('grey', x, y, w, h);
    ptext('PAUSED', x + w / 2, y + 12, 'B', 'center');
    let any = false;
    any = this.overlayBtn('red', x + 30, y + 40, 100, 21, 'Resume', () => { this.paused = false; }) || any;
    any = this.overlayBtn('grey', x + 30, y + 66, 100, 21, 'Restart level', () => startLevel(this.li)) || any;
    any = this.overlayBtn('grey', x + 30, y + 92, 100, 21, 'Back to town', () => this.toTown()) || any;
    stext('Gold you picked up is already saved.', x + w / 2, y + 128, 4.8, P.dark, 'center', 500);
    cv.style.cursor = any ? 'pointer' : 'default';
  }
  drawResult() {
    dim(); menuXf();
    const r = this.result, x = 120, y = 36, w = 220, h = 182;
    panel('grey', x, y, w, h);
    panel('red', x + 20, y - 10, w - 40, 30);
    ptext(r.won ? 'LEVEL CLEAR' : 'YOU DIED', x + w / 2, y - 1, 'B', 'center');
    const rows = [['Level', `${this.L}: ${this.def.name}`], ['Gold collected', '+' + this.goldRun], ['Monsters defeated', this.killsRun], ['Chests opened', this.chestsRun], ['Hits taken', this.hits], ['Time', fmtTime(this.time * 1000)]];
    rows.forEach((row, k) => { stext(row[0], x + 22, y + 34 + k * 11, 5.6, P.dark, 'left', 500); stext(String(row[1]), x + w - 22, y + 34 + k * 11, 5.6, P.dark, 'right', 700); });
    if (r.won && r.first && this.L < LEVEL_N) stext(`Level ${this.L + 1} unlocked!`, x + w / 2, y + 104, 6, P.redD, 'center', 700);
    if (r.won && r.first && this.L === 9) stext('Bonus: 1.5x weapon damage + auto Long Pistol', x + w / 2, y + 113, 5, P.redD, 'center', 700);
    if (r.won && this.L === LEVEL_N) stext('The Sand Tyrant is defeated. Dustwell is safe!', x + w / 2, y + 104, 5.6, P.redD, 'center', 700);
    if (!r.won) stext('Your gold is kept. Try again or gear up in town.', x + w / 2, y + 104, 5.4, P.redD, 'center', 600);
    let any = false;
    if (r.won && this.L < LEVEL_N) any = this.overlayBtn('red', x + 16, y + h - 58, 90, 21, 'Next level', () => startLevel(this.li + 1)) || any;
    else any = this.overlayBtn('red', x + 16, y + h - 58, 90, 21, r.won ? 'Play again' : 'Retry', () => startLevel(this.li)) || any;
    any = this.overlayBtn('grey', x + w - 106, y + h - 58, 90, 21, 'Back to town', () => this.toTown()) || any;
    any = this.overlayBtn('grey', x + w / 2 - 45, y + h - 32, 90, 21, 'Level select', () => { this.toTown(); openLevels(); }) || any;
    cv.style.cursor = any ? 'pointer' : 'default';
  }
}
function shortGoal(q) {
  switch (q.type) {
    case 'kill': return MONSTERS[q.mon].plural;
    case 'killAny': return 'monsters';
    case 'weapon': return 'with ' + WEAPONS[q.w].name;
    case 'chests': return 'chests';
    case 'gold': return 'gold';
    case 'clear': return 'clear Lv ' + q.lvl + '+';
    case 'boss': return bossName(q.lvl);
    case 'flawless': return 'clean run Lv ' + q.lvl + '+';
  }
  return '';
}
