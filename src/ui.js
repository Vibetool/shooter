/* ==========================================================================
   Menus: home (sample-B layout), level select, options, credits, NPC jobs
   ========================================================================== */
const TOASTS = [];
Game.toast = msg => { TOASTS.push({ msg, t: 3.2 }); if (TOASTS.length > 3) TOASTS.shift(); };
function drawToasts(dt) {
  menuXf();
  let y = 6;
  for (let i = 0; i < TOASTS.length; i++) {
    const t = TOASTS[i]; t.t -= dt;
    const a = clamp(t.t / 0.4, 0, 1);
    const w = textW(t.msg, 6, 600) + 16;
    ctx.globalAlpha = a;
    ctx.fillStyle = P.white; ctx.fillRect(MW / 2 - w / 2 - 1, y - 1, w + 2, 16);
    ctx.fillStyle = P.dark; ctx.fillRect(MW / 2 - w / 2, y, w, 14);
    stext(t.msg, MW / 2, y + 7.5, 6, P.white, 'center', 600);
    ctx.globalAlpha = 1; y += 18;
  }
  for (let i = TOASTS.length - 1; i >= 0; i--) if (TOASTS[i].t <= 0) TOASTS.splice(i, 1);
}
function disc(cx, cy, r) { for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy + 0.5)); ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1); } }
function drawTip(lines, mx, my) {
  if (!lines || !lines.length) return;
  const size = 5.6, lh = 8;
  let w = 0; lines.forEach((l, i) => { w = Math.max(w, textW(l, size, i === 0 ? 700 : 500)); });
  w = Math.ceil(w) + 12; const h = lines.length * lh + 8;
  let x = mx + 10, y = my + 10;
  if (x + w > MW - 2) x = mx - w - 6; if (y + h > MH - 2) y = my - h - 6;
  x = Math.max(2, x); y = Math.max(2, y);
  ctx.fillStyle = P.white; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = P.dark; ctx.fillRect(x, y, w, h);
  lines.forEach((l, i) => stext(l, x + 6, y + 4 + lh / 2 + i * lh, size, i === 0 ? P.yel : P.white, 'left', i === 0 ? 700 : 500));
}
let BTN_FONT = 6.2;
function calibrateFont() { const w = textW('Start run', 10, 600) / 10; if (w > 0) BTN_FONT = clamp(29 / w, 4.5, 8); }
function sandBg() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = P.sand; ctx.fillRect(0, 0, CW, CH); ctx.restore(); }
function dim() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(71,50,75,0.55)'; ctx.fillRect(0, 0, CW, CH); ctx.restore(); }

/* shared clickable-area plumbing for menu scenes */
class MenuScene {
  constructor() { this.hot = []; this.t = 0; this.tip = null; }
  hit(x, y, w, h, fn, tip) {
    this.hot.push({ x, y, w, h, fn });
    if (topScene() !== this || IN.touch) return false;
    const [mx, my] = toMenu(IN.mx, IN.my);
    const on = mx >= x && my >= y && mx < x + w && my < y + h;
    if (on) { this.anyHover = true; if (tip) this.tip = tip; }
    return on;
  }
  begin() { this.hot = []; this.tip = null; this.anyHover = false; menuXf(); }
  end() {
    if (topScene() === this) {
      cv.style.cursor = this.anyHover ? 'pointer' : 'default';
      if (this.tip) { const [mx, my] = toMenu(IN.mx, IN.my); drawTip(this.tip, mx, my); }
    }
  }
  click(px, py) {
    const [mx, my] = toMenu(px, py);
    for (let i = this.hot.length - 1; i >= 0; i--) {
      const h = this.hot[i];
      if (mx >= h.x && my >= h.y && mx < h.x + h.w && my < h.y + h.h) { if (h.fn) { sfx('select-a', 0.7); h.fn(); } return; }
    }
    if (this.outside) this.outside(mx, my);
  }
  update(dt) { this.t += dt; }
}
function textButton(sc, kind, x, y, w, h, label, fn, tip) {
  const on = sc.hit(x, y, w, h, fn, tip);
  btn(kind, x, y + (on ? -1 : 0), w, h);
  stext(label, x + w / 2, y + h / 2 - 0.5 + (on ? -1 : 0), BTN_FONT, kind === 'red' ? P.white : P.dark, 'center', 600);
  return on;
}

/* ---------------- HOME (replicates the Kenney sample layout) ---------------- */
const SLOTS = [[301, 69], [326, 69], [301, 89], [326, 89]];
class Home extends MenuScene {
  constructor() { super(); this.arrowY = 138; }
  key(k) { if (k === 'enter' || k === ' ') openLevels(); }
  draw() {
    sandBg(); this.begin();
    const t = this.t;
    // gold counter
    spr('tiles', 225, 4, 4);
    ptext(String(SAVE.gold), 19, 5, 'A');
    this.hit(2, 2, 22 + ptW(String(SAVE.gold)), 18, null, ['Gold', 'Earn it by defeating monsters,', 'opening chests and finishing jobs.']);

    // dust puffs behind the animals
    ctx.fillStyle = P.dust;
    disc(130, 97, 3); disc(124, 101, 3); disc(129, 106, 2); disc(121, 104, 1);
    disc(180, 95, 3); disc(172, 104, 3); disc(178, 104, 2); disc(183, 99, 1);

    // NPCs + speech bubbles
    const npcDraw = (id, x, y, bx, by, flip) => {
      const n = SAVE.npcs[id], q = n.quest, alert = q && (q.status === 'offered' || q.status === 'done');
      const on = this.hit(Math.min(x, bx) - 2, by - 2, 28, y + 24 - by + 2, () => pushScene(new NpcDialog(id)), npcTip(id));
      const fr = NPCS[id].f + ((t + (id === 'cat' ? 0 : 0.35)) % 1.3 < 0.95 ? 2 : 1);
      spr('players', fr, x, y - (on ? 1 : 0), flip ? { flip: true } : null);
      const bob = alert ? Math.round(Math.sin(t * 5 + (id === 'cat' ? 0 : 1.5)) * 1) : 0;
      spr('ui', alert ? 60 : 59, bx, by + bob);
      if (on) spr('ui', 104, x, y - 1, { scale: 1.5 });
    };
    npcDraw('cat', 129, 81, 134, 64, false);
    npcDraw('mouse', 160, 76, 164, 59, true);

    // upgrade button (grey panel from the pack)
    const up = this.hit(62, 34, 77, 24, () => pushScene(new UpgradeMenu()), ['Upgrade', 'Regen, a fighter and a skill', 'that help you during runs.']);
    smallPanel(62, 34 - (up ? 1 : 0), 77, 24);
    stext('Upgrade', 100.5, 46 - (up ? 1 : 0), BTN_FONT, P.white, 'center', 600);

    // square map (yellow)
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(200, 39, 48, 48);
    const sq = [3, 4, 5, 21, 22, 23, 39, 40, 41];
    for (let k = 0; k < 9; k++) spr('ui', sq[k], 200 + (k % 3) * 16, 37 + Math.floor(k / 3) * 16);
    spr('ui', 56, 228, 39);
    spr('ui', 72, 194, 45); spr('ui', 72, 203, 57); spr('ui', 72, 238, 62);
    spr('ui', 74, 216, 53);
    this.hit(194, 37, 56, 50, openLevels, ['World map', `${SAVE.cleared.filter(Boolean).length} levels cleared so far.`, 'Click to choose a level.']);

    // round map
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; disc(244, 118, 23);
    const rd = [0, 1, 2, 18, 19, 20, 36, 37, 38];
    for (let k = 0; k < 9; k++) spr('ui', rd[k], 220 + (k % 3) * 16, 92 + Math.floor(k / 3) * 16);
    spr('ui', 55, 252, 95); spr('ui', 54, 222, 111); spr('ui', 54, 223, 126);
    spr('ui', 74, 236, 108);
    this.hit(220, 92, 48, 50, null, radarTip());

    // health bar + 100% + campaign / arsenal bars
    bar(66, 124, 52, 12, 1, 'red', 3);
    ptext('100%', 122, 122, 'A');
    this.hit(66, 122, 92, 16, null, ['Health 100%', 'You heal fully in town between runs.', 'Every run starts with a 1-point shield', 'that recharges after it breaks.']);
    const ao = allOrange(), ownedN = SAVE.owned.slice(ao ? ORANGE_N : 0, ao ? WEAPONS.length : ORANGE_N).filter(Boolean).length;
    const unl = highestUnlocked(), nb = Math.ceil(unl / 5) * 5;
    let stretch = 0; for (let L = nb - 4; L <= nb; L++) if (SAVE.cleared[L - 1]) stretch++;
    bar(66, 140, 64, 12, stretch / 5, 'blue');
    this.hit(66, 140, 64, 12, null, ['Road to the next boss', `Boss waits at Level ${nb}`, `${stretch} of the 5 levels on this stretch cleared`]);
    bar(66, 155, 64, 12, ownedN / ORANGE_N, 'blue');
    this.hit(66, 155, 64, 12, null, [ao ? 'Green arsenal' : 'Arsenal', `${ownedN} / ${ORANGE_N} ${ao ? 'green' : 'orange'} weapons owned`]);

    // villain banner
    panel('red', 152, 159, 143, 53);
    const won = SAVE.cleared[LEVEL_N - 1];
    ptext(won ? 'YOU GOT LUCKY' : 'YOU WILL NEVER', 223.5, 172, 'B', 'center');
    ptext(won ? 'THIS TIME' : 'DEFEAT ME', 223.5, 187, 'B', 'center');
    this.hit(152, 159, 143, 53, null, won ? ['The Sand Tyrant', 'Defeated. For now.'] : ['The Sand Tyrant', 'Waits at the end of the road.']);

    // weapon panel
    this.drawArmory();

    // buttons
    const B = [['Start run', 'red', openLevels], ['Options', 'grey', () => pushScene(new Options())], ['Credits', 'grey', () => pushScene(new Credits())]];
    let hov = -1;
    B.forEach((b, i) => { const y = [136, 159, 182][i]; if (textButton(this, b[1], 318, y, 66, 21, b[0], b[2])) hov = i; });
    const ty = [138, 161, 184][hov < 0 ? 0 : hov];
    this.arrowY = lerp(this.arrowY, ty, 0.35);
    spr('ui', 78, 381 + Math.round(Math.sin(t * 6) * 1.2), Math.round(this.arrowY), { rot: -Math.PI / 2 });
    this.end();
  }
  drawArmory() {
    panel('blue', 285, 57, 83, 68);
    const ao = allOrange(), maxPage = ao ? WEAPONS.length / 4 - 1 : ORANGE_N / 4 - 1;
    const page = clamp(SAVE.page || 0, 0, maxPage); SAVE.page = page;
    for (let k = 0; k < 4; k++) {
      const wi = page * 4 + k, W_ = WEAPONS[wi], [x, y] = SLOTS[k], owned = SAVE.owned[wi], ok = canBuy(wi);
      const on = this.hit(x + 2, y + 4, 21, 17, () => armoryClick(wi), weaponTip(wi));
      spr('weapons', W_.tile, x, y - (on ? 1 : 0), owned ? null : { alpha: ok ? 0.6 : 0.3 });
      if (!owned) {
        const s = String(W_.price), w = textW(s, 4.6, 700) + 4;
        ctx.fillStyle = P.dark; ctx.fillRect(x + 21 - w, y + 15, w, 7);
        stext(s, x + 21 - w / 2, y + 18.7, 4.6, !ok ? P.lav : SAVE.gold >= W_.price ? P.yel : P.lavL, 'center', 700);
      }
      if (on) spr('ui', 104, x + 4, y + 3);
    }
    const eq = SAVE.equipped;
    if (eq >= 0 && Math.floor(eq / 4) === page) { const [x, y] = SLOTS[eq % 4]; spr('ui', 77, x + 6, y + 17 + Math.round(Math.sin(this.t * 4))); }
    // page arrows on the frame
    const prev = page > 0, next = page < maxPage;
    const l = this.hit(279, 83, 12, 16, prev ? () => { SAVE.page = page - 1; } : null, prev ? ['Previous page'] : null);
    const r = this.hit(362, 83, 12, 16, next ? () => { SAVE.page = page + 1; } : null, next ? ['Next page'] : ao ? null : ['More weapons', 'Own every orange weapon to unlock more.']);
    spr('ui', 74, 277 - (l && prev ? 1 : 0), 83, { rot: -Math.PI / 2, alpha: prev ? 1 : 0.55 });
    spr('ui', 74, 360 + (r && next ? 1 : 0), 83, { rot: Math.PI / 2, alpha: next ? 1 : 0.55 });
    const n = maxPage + 1, dw = n * 6 + 1, dx = Math.round(326.5 - dw / 2);
    ctx.fillStyle = P.dark; ctx.fillRect(dx, 117, dw, 3);
    for (let i = 0; i < n; i++) { ctx.fillStyle = i === page ? P.white : i * 4 >= ORANGE_N ? P.teal : P.lav; ctx.fillRect(dx + 1 + i * 6, 118, 5, 1); }
  }
}
function npcTip(id) {
  const n = SAVE.npcs[id], q = n.quest, N = NPCS[id];
  if (!q) return [N.name + ' ' + N.title, 'Next job in ' + fmtTime(jobDueAt(id) - Date.now())];
  if (q.status === 'offered') return [N.name + ' ' + N.title, 'Has a new job for you!'];
  if (q.status === 'done') return [N.name + ' ' + N.title, 'Job done. Click to claim ' + q.reward + ' gold.'];
  return [N.name + ' ' + N.title, questText(q).goal, `Progress ${q.prog} / ${q.n}`];
}
function radarTip() {
  const out = ['Job radar'];
  for (const id of ['cat', 'mouse']) {
    const n = SAVE.npcs[id], q = n.quest;
    out.push(NPCS[id].name + ': ' + (!q ? 'next job in ' + fmtTime(jobDueAt(id) - Date.now()) : q.status === 'offered' ? 'new job waiting' : q.status === 'done' ? 'reward ready' : `${q.prog}/${q.n} ${questText(q).goal.toLowerCase()}`));
  }
  return out;
}
function weaponTip(wi) {
  const w = WEAPONS[wi], owned = SAVE.owned[wi], m = dmgMul(), dmg = +(w.dmg * m).toFixed(1);
  const dps = (dmg * w.pellets * w.rate).toFixed(0);
  const status = owned ? (SAVE.equipped === wi ? 'Equipped' : 'Owned. Click to equip.')
    : !canBuy(wi) ? `${w.price} gold. ` + lockReason(wi)
    : `Price: ${w.price} gold` + (SAVE.gold >= w.price ? '. Click to buy.' : ` (you have ${SAVE.gold})`);
  return [w.name, status,
    `Damage ${dmg}${w.pellets > 1 ? ' x' + w.pellets : ''}${m > 1 ? ' (1.5x bonus)' : ''}, ${w.rate} shots/s, ${w.mag} rounds`, `Raw damage per second: ${dps}` + (w.pierce ? ', pierces' : '') + (w.splash ? ', splash' : '')];
}
function lockReason(wi) { return wi >= ORANGE_N && !allOrange() ? 'Own every orange weapon first.' : `Buy the ${WEAPONS[wi - 1].name} first.`; }
function armoryClick(wi) {
  const w = WEAPONS[wi];
  if (SAVE.owned[wi]) { SAVE.equipped = SAVE.equipped === wi ? -1 : wi; persist(); Game.toast(SAVE.equipped === wi ? w.name + ' equipped' : 'Knife only. Weapon holstered.'); return; }
  if (!canBuy(wi)) { sfx('error-a'); Game.toast(lockReason(wi)); return; }
  if (SAVE.gold < w.price) { sfx('error-a'); Game.toast(`${w.name} costs ${w.price} gold. You have ${SAVE.gold}.`); return; }
  pushScene(new Confirm(`Buy the ${w.name}?`, `${w.price} gold. You have ${SAVE.gold}.`, 'Buy', () => {
    SAVE.gold -= w.price; SAVE.stats.goldSpent += w.price; SAVE.owned[wi] = 1; SAVE.equipped = wi; persist();
    sfx('coin-d'); Game.toast(w.name + ' bought and equipped');
  }));
}
function openLevels() { pushScene(new Levels()); }
function upgradeClick(u, i) {
  const lvl = SAVE.upg[u.key], price = UPG_PRICES[i];
  if (i < lvl) { Game.toast(u.steps[i] + ' is already yours'); return; }
  if (i > lvl) { sfx('error-a'); Game.toast('Buy the earlier ' + u.name.toLowerCase() + ' upgrade first'); return; }
  if (SAVE.gold < price) { sfx('error-a'); Game.toast(`${u.steps[i]} costs ${price} gold. You have ${SAVE.gold}.`); return; }
  pushScene(new Confirm(u.steps[i] + '?', `${price} gold. You have ${SAVE.gold}.`, 'Buy', () => {
    SAVE.gold -= price; SAVE.stats.goldSpent += price; SAVE.upg[u.key] = i + 1; persist();
    sfx('coin-d'); Game.toast(u.steps[i] + ' bought');
  }));
}

function finalUpgradeClick() {
  const F = FINAL_UPG;
  if (SAVE.upg.final) { Game.toast(F.name + ' is already yours'); return; }
  if (!F.ready()) { sfx('error-a'); Game.toast('Max out Regen, Fighter and Skill first'); return; }
  if (SAVE.gold < F.price) { sfx('error-a'); Game.toast(`${F.name} costs ${F.price} gold. You have ${SAVE.gold}.`); return; }
  pushScene(new Confirm('Buy ' + F.name + '?', `${F.price} gold. You have ${SAVE.gold}.`, 'Buy', () => {
    SAVE.gold -= F.price; SAVE.stats.goldSpent += F.price; SAVE.upg.final = 1; persist();
    sfx('coin-d'); sfx('explosion-a', 0.4, 0.8); Game.toast(F.name + ' is yours');
  }));
}
/* ---------------- UPGRADE menu (red banner panel, three tracks + the final upgrade) ---------------- */
class UpgradeMenu extends MenuScene {
  key(k) { if (k === 'escape') popScene(this); }
  outside() { popScene(this); }
  draw() {
    dim(); this.begin();
    const x = 36, y = 4, w = 388, h = 250;
    this.hit(x, y, w, h, () => {});
    panel('red', x, y, w, h);
    ptext('UPGRADE', x + w / 2, y + 10, 'B', 'center');
    spr('tiles', 225, x + w - 70, y + 9); ptext(String(SAVE.gold), x + w - 55, y + 10, 'A');
    UPGRADES.forEach((u, r) => {
      const lvl = SAVE.upg[u.key], y0 = y + 30 + r * 48;
      if (u.icon[0] === 'players') spr('players', u.icon[1], x + 10, y0 - 1); else spr(u.icon[0], u.icon[1], x + 14, y0 + 4);
      stext(u.name, x + 40, y0 + 8, 7, P.white, 'left', 700);
      stext(lvl ? `Level ${lvl} / 5` : 'Not bought', x + 40, y0 + 18, 4.8, P.yelL, 'left', 600);
      for (let i = 0; i < 5; i++) {
        const nx = x + 118 + i * 52, nw = 46, nh = 24, owned = i < lvl, next = i === lvl;
        const tip = [u.steps[i], u.step(i), owned ? 'Owned' : `${UPG_PRICES[i]} gold` + (next ? (SAVE.gold >= UPG_PRICES[i] ? '. Click to buy.' : ` (you have ${SAVE.gold})`) : '. Buy the earlier upgrade first.')];
        const on = this.hit(nx, y0, nw, nh, () => upgradeClick(u, i), tip);
        const ny = y0 - (on && next ? 1 : 0);
        ctx.globalAlpha = owned || next ? 1 : 0.5;
        btn('grey', nx, ny, nw, nh);
        stext(u.steps[i], nx + nw / 2, ny + 8.5, 4.3, P.dark, 'center', 700);
        stext(owned ? 'Owned' : `${UPG_PRICES[i]} gold`, nx + nw / 2, ny + 16, 4.6, owned ? P.redD : P.dark, 'center', 700);
        ctx.globalAlpha = 1;
        if (next && on) spr('ui', 104, nx + nw - 15, ny + nh - 15);
      }
      bar(x + 118, y0 + 28, 254, 9, lvl / 5, 'yellow', 5);
      stext(u.info(lvl), x + 118, y0 + 43, 4.8, P.white, 'left', 500);
    });
    // final upgrade
    const F = FINAL_UPG, fy = y + 182, ready = F.ready(), own = SAVE.upg.final;
    spr('weapons', WEAPONS[ORANGE_N + 5].tile, x + 8, fy - 1);
    stext(F.name, x + 40, fy + 8, 6.2, P.white, 'left', 700);
    stext(own ? 'Owned' : ready ? 'Unlocked' : 'Locked', x + 40, fy + 18, 4.8, P.yelL, 'left', 600);
    const fon = this.hit(x + 118, fy, 254, 24, finalUpgradeClick, [F.name, F.info, own ? 'Owned' : ready ? `${F.price} gold` + (SAVE.gold >= F.price ? '. Click to buy.' : ` (you have ${SAVE.gold})`) : 'Max out Regen, Fighter and Skill first.']);
    const fny = fy - (fon && ready && !own ? 1 : 0);
    ctx.globalAlpha = own || ready ? 1 : 0.5;
    btn('grey', x + 118, fny, 254, 24);
    stext(own ? 'Owned' : ready ? `Buy for ${F.price} gold` : 'Max out all three tracks to unlock', x + 245, fny + 11.5, 5.4, own ? P.redD : P.dark, 'center', 700);
    ctx.globalAlpha = 1;
    stext(F.info, x + 118, fy + 31, 4.8, P.white, 'left', 500);
    textButton(this, 'grey', x + w / 2 - 32, y + h - 28, 64, 21, 'Done', () => popScene(this));
    this.end();
  }
}

/* ---------------- generic confirm ---------------- */
class Confirm extends MenuScene {
  constructor(title, body, yes, fn) { super(); Object.assign(this, { title, body, yes, fn }); }
  key(k) { if (k === 'escape') popScene(this); if (k === 'enter') { popScene(this); this.fn(); } }
  outside() { popScene(this); }
  draw() {
    dim(); this.begin();
    const x = 140, y = 86, w = 180, h = 84;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    stext(this.title, x + w / 2, y + 20, 7, P.dark, 'center', 700);
    stext(this.body, x + w / 2, y + 33, 5.6, P.dark, 'center', 500);
    textButton(this, 'red', x + 20, y + 50, 64, 21, this.yes, () => { popScene(this); this.fn(); });
    textButton(this, 'grey', x + 96, y + 50, 64, 21, 'Cancel', () => popScene(this));
    this.end();
  }
}

/* ---------------- LEVEL SELECT ---------------- */
class Levels extends MenuScene {
  constructor() { super(); this.page = Math.floor((highestUnlocked() - 1) / 20); }
  key(k) { if (k === 'escape') popScene(this); if (k === 'arrowleft') this.turn(-1); if (k === 'arrowright') this.turn(1); }
  pages() { return Math.ceil(Math.min(LEVEL_N, highestUnlocked() + 3) / 20); }
  turn(d) { this.page = clamp(this.page + d, 0, this.pages() - 1); }
  wheel(d) { this.turn(d); }
  draw() {
    sandBg(); this.begin();
    panel('red', 150, 6, 160, 30);
    ptext('SELECT LEVEL', 230, 15, 'B', 'center');
    textButton(this, 'grey', 10, 10, 50, 21, 'Back', () => popScene(this));
    spr('tiles', 225, 400, 12); ptext(String(SAVE.gold), 415, 13, 'A');
    const unl = highestUnlocked(), shown = Math.min(LEVEL_N, unl + 3), pages = this.pages();
    this.page = clamp(this.page, 0, pages - 1);
    const first = this.page * 20, last = Math.min(shown, first + 20);
    for (let i = first; i < last; i++) {
      const L = i + 1, k = i - first, x = 18 + (k % 5) * 86, y = 46 + Math.floor(k / 5) * 52, w = 80, h = 46;
      const open = L <= unl, cleared = SAVE.cleared[i];
      const def = LEVELS[i];
      const tip = open ? [`Level ${L}: ${def.name}`, 'Monsters: ' + def.pool.map(m => MONSTERS[m].plural).join(', '), `${goldPerKill(L)} gold per monster` + (L >= 11 ? ', gold chests (15)' : ', orange chests (5)'), BOSSES[L] ? 'Boss: ' + BOSSES[L].name : `${levelCount(L)} monsters`, ...(L === 9 && !cleared ? ['Clear reward: 1.5x weapon damage and an auto Long Pistol'] : []), cleared ? 'Cleared. Replay for more gold.' : 'Click to play'] : [`Level ${L}`, 'Locked. Clear Level ' + (L - 1) + ' first.'];
      const on = this.hit(x, y, w, h, open ? () => startLevel(i) : () => { sfx('error-a'); }, tip);
      const yy = y - (on && open ? 1 : 0);
      panel(open ? 'blue' : 'grey', x, yy, w, h);
      if (open) {
        const m = renderMap(getMap(i));
        ctx.fillStyle = P.dark; ctx.fillRect(x + 6, yy + 7, 38, 28);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(m.canvas, x + 7, yy + 8, 36, 26); ctx.imageSmoothingEnabled = false;
        ptext(String(L), x + 47, yy + 6, 'A');
        const lines = wrapText(def.name, 30, 4.6, 600).slice(0, 2);
        lines.forEach((l, j) => stext(l, x + 47, yy + 26 + j * 6, 4.6, P.white, 'left', 600));
        if (cleared) { ctx.fillStyle = P.dark; ctx.fillRect(x + 6, yy + 36, 28, 7); stext('CLEARED', x + 20, yy + 39.6, 4.2, P.yel, 'center', 700); }
      } else {
        spr('tiles', 198, x + 32, yy + 8);
        stext('Level ' + L, x + 40, yy + 33, 5.4, P.dark, 'center', 600);
      }
      if (BOSSES[L]) spr('ui', 55, x + w - 13, yy - 5);
      if (on && open) spr('ui', 104, x + w - 18, yy + h - 18);
    }
    if (pages > 1) {
      if (this.page > 0) { const l = this.hit(2, 118, 14, 20, () => this.turn(-1), ['Previous levels']); spr('ui', 78, 1 - (l ? 1 : 0), 120, { rot: -Math.PI / 2 }); }
      if (this.page < pages - 1) { const r = this.hit(444, 118, 14, 20, () => this.turn(1), ['More levels']); spr('ui', 78, 443 + (r ? 1 : 0), 120, { rot: Math.PI / 2 }); }
    }
    this.end();
  }
}

/* ---------------- OPTIONS ---------------- */
class Options extends MenuScene {
  constructor() { super(); this.confirmT = 0; }
  key(k) { if (k === 'escape') popScene(this); }
  update(dt) { super.update(dt); this.confirmT = Math.max(0, this.confirmT - dt); }
  draw() {
    dim(); this.begin();
    const x = 96, y = 18, w = 268, h = 222;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('OPTIONS', x + w / 2, y + 10, 'B', 'center');
    const S = SAVE.settings;
    const row = (i, label) => { const yy = y + 36 + i * 22; stext(label, x + 16, yy + 7, 6, P.dark, 'left', 600); return yy; };
    const vol = (i, label, key) => {
      const yy = row(i, label);
      const minus = this.hit(x + 120, yy, 14, 14, () => { S[key] = Math.max(0, Math.round((S[key] - 0.1) * 10) / 10); applyVolumes(); persist(); sfx('coin-a'); });
      btn('grey', x + 120, yy - (minus ? 1 : 0), 14, 14, false); spr('ui', 92, x + 119, yy - 1 - (minus ? 1 : 0));
      bar(x + 138, yy + 1, 70, 12, S[key], 'blue');
      const plus = this.hit(x + 212, yy, 14, 14, () => { S[key] = Math.min(1, Math.round((S[key] + 0.1) * 10) / 10); applyVolumes(); persist(); sfx('coin-a'); });
      btn('grey', x + 212, yy - (plus ? 1 : 0), 14, 14, false); spr('ui', 91, x + 211, yy - 1 - (plus ? 1 : 0));
      stext(Math.round(S[key] * 100) + '%', x + 232, yy + 7, 5.4, P.dark, 'left', 600);
    };
    const tog = (i, label, on, fn, labels = ['On', 'Off']) => { const yy = row(i, label); textButton(this, on ? 'red' : 'grey', x + 120, yy - 3, 50, 19, on ? labels[0] : labels[1], fn); };
    vol(0, 'Sound effects', 'sfx');
    vol(1, 'Music', 'music');
    tog(2, 'Screen shake', S.shake, () => { S.shake = S.shake ? 0 : 1; persist(); });
    tog(3, 'Damage numbers', S.nums, () => { S.nums = S.nums ? 0 : 1; persist(); });
    tog(4, 'Fullscreen', !!document.fullscreenElement, () => {
      try { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => Game.toast('Fullscreen is not available here')); else Game.toast('Fullscreen is not available here'); } catch (e) { Game.toast('Fullscreen is not available here'); }
    });
    const yy = row(5, 'Reset progress');
    textButton(this, this.confirmT > 0 ? 'red' : 'grey', x + 120, yy - 3, 70, 19, this.confirmT > 0 ? 'Confirm wipe' : 'Reset', () => {
      if (this.confirmT > 0) { const s = SAVE.settings; SAVE = defaultSave(); SAVE.settings = s; persist(); this.confirmT = 0; Game.toast('Progress reset. Welcome back to Dustwell.'); }
      else this.confirmT = 3;
    });
    if (this.confirmT > 0) stext('Click again to erase gold, weapons and levels', x + 196, yy + 7, 4.4, P.redD, 'left', 600);
    const help = ['WASD or arrows move. Mouse aims, hold left click to shoot.', 'Your knife strikes by itself every 2 seconds when a monster is close.', 'Space dashes, R reloads, Esc pauses.'];
    help.forEach((l, k) => stext(l, x + w / 2, y + 168 + k * 8, 5, P.dark, 'center', 500));
    textButton(this, 'red', x + w / 2 - 32, y + h - 31, 64, 21, 'Done', () => popScene(this));
    this.end();
  }
}

/* ---------------- CREDITS: how far the upgrades have come ---------------- */
class Credits extends MenuScene {
  key(k) { if (k === 'escape') popScene(this); }
  draw() {
    dim(); this.begin();
    const x = 26, y = 8, w = 408, h = 242;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('CREDITS', x + w / 2, y + 9, 'B', 'center');
    // upgrade path
    stext('Upgrade path', x + 16, y + 32, 6.4, P.dark, 'left', 700);
    const ao = allOrange(), oN = SAVE.owned.slice(0, ORANGE_N).filter(Boolean).length, gN = SAVE.owned.slice(ORANGE_N).filter(Boolean).length;
    stext(`Orange ${oN} / ${ORANGE_N}` + (ao ? `, green ${gN} / ${ORANGE_N}` : ''), x + w - 16, y + 32, 5.4, P.dark, 'right', 600);
    bar(x + 16, y + 97, w - 32, 9, (oN + gN) / WEAPONS.length, 'yellow');
    for (let i = 0; i < WEAPONS.length; i++) {
      const col = i % ORANGE_N, wx = x + 16 + col * ((w - 32) / ORANGE_N) + 10, wy = y + 36 + Math.floor(i / ORANGE_N) * 30, o = SAVE.owned[i];
      const hidden = i >= ORANGE_N && !ao;
      const on = this.hit(wx, wy + 4, 26, 26, null, hidden ? ['???', 'Own every orange weapon to find out.'] : weaponTip(i));
      spr('weapons', WEAPONS[i].tile, wx, wy, o ? null : { alpha: hidden ? 0.12 : 0.35 });
      const label = o ? (SAVE.equipped === i ? 'Equipped' : 'Owned') : hidden ? '???' : WEAPONS[i].price + ' gold';
      stext(label, wx + 12, wy + 25, 4.4, o ? P.redD : P.dark, 'center', 700);
      if (on) spr('ui', 104, wx + 4, wy + 4);
    }
    // campaign (no total shown: the road keeps going)
    const cl = SAVE.cleared.filter(Boolean).length, unl = highestUnlocked(), dec = Math.floor((unl - 1) / 10) * 10;
    stext('Campaign', x + 16, y + 116, 6.4, P.dark, 'left', 700);
    stext(`${cl} levels cleared, furthest Level ${unl}`, x + w - 16, y + 116, 5.4, P.dark, 'right', 600);
    for (let k = 0; k < 10; k++) {
      const i = dec + k, L = i + 1; if (L > LEVEL_N) break;
      const bx = x + 16 + k * 37.6, by = y + 124;
      ctx.fillStyle = P.white; ctx.fillRect(bx, by, 34, 12);
      ctx.fillStyle = SAVE.cleared[i] ? P.teal : L <= unl ? P.sand : P.lavD; ctx.fillRect(bx + 1, by + 1, 32, 10);
      ctx.fillStyle = P.dark; ctx.fillRect(bx + 1, by + 1, 32, 1);
      stext(L <= unl ? String(L) : '?', bx + 17, by + 6.8, 4.6, P.dark, 'center', 700);
      if (BOSSES[L]) spr('ui', 54, bx + 22, by - 6);
      this.hit(bx, by, 34, 12, null, L <= unl ? [`Level ${L}: ${LEVELS[i].name}`, SAVE.cleared[i] ? 'Cleared' : 'Unlocked'] : ['Locked', 'Keep going to find out.']);
    }
    // job tiers
    stext('Job difficulty', x + 16, y + 148, 6.4, P.dark, 'left', 700);
    stext('Upgrades: ' + UPGRADES.map(u => `${u.name} ${SAVE.upg[u.key]}/5`).join(', ') + (SAVE.upg.final ? ', Death zone' : ''), x + w - 16, y + 148, 5.4, P.dark, 'right', 600);
    ['cat', 'mouse'].forEach((id, k) => {
      const n = SAVE.npcs[id], tier = Math.min(n.count, MAX_TIER);
      stext(`${NPCS[id].name} ${NPCS[id].title}`, x + 16, y + 160 + k * 14, 5.4, P.dark, 'left', 600);
      bar(x + 100, y + 154 + k * 14, 120, 11, tier / MAX_TIER, 'red');
      stext(tier >= MAX_TIER ? 'Max tier' : `Tier ${tier} / ${MAX_TIER}`, x + 226, y + 160 + k * 14, 5, P.dark, 'left', 600);
    });
    // stats
    const st = SAVE.stats;
    const stats = [['Monsters defeated', st.kills], ['Gold earned', st.goldEarned], ['Gold spent', st.goldSpent], ['Chests opened', st.chests], ['Jobs finished', st.quests], ['Bosses beaten', st.bosses], ['Runs', st.runs], ['Time in the desert', fmtTime(st.playTime * 1000)]];
    stats.forEach((s, k) => {
      const cx = x + 16 + (k % 4) * 96, cy = y + 194 + Math.floor(k / 4) * 13;
      stext(s[0], cx, cy, 4.8, P.dark, 'left', 500);
      stext(String(s[1]), cx + 88, cy, 5.2, P.dark, 'right', 700);
    });
    stext('Art and sounds: Kenney Desert Shooter Pack (kenney.nl, CC0)', x + 16, y + h - 12, 4.6, P.dark, 'left', 500);
    textButton(this, 'red', x + w - 76, y + h - 27, 60, 20, 'Done', () => popScene(this));
    this.end();
  }
}

/* ---------------- NPC job dialog ---------------- */
class NpcDialog extends MenuScene {
  constructor(id) { super(); this.id = id; }
  key(k) { if (k === 'escape') popScene(this); }
  outside() { popScene(this); }
  draw() {
    dim(); this.begin();
    const id = this.id, N = NPCS[id], n = SAVE.npcs[id], q = n.quest;
    const x = 76, y = 28, w = 308, h = 200;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    const sq = [3, 4, 5, 21, 22, 23, 39, 40, 41];
    for (let k = 0; k < 9; k++) spr('ui', sq[k], x + 12 + (k % 3) * 16, y + 12 + Math.floor(k / 3) * 16);
    spr('players', N.f + (this.t % 1.2 < 0.6 ? 0 : 1), x + 18, y + 18, { scale: 1.5, flip: id === 'mouse' });
    ptext(N.name, x + 70, y + 16, 'A');
    stext(N.title + ' of Dustwell', x + 71, y + 40, 5.6, P.dark, 'left', 600);
    const bx = x + 14, bw = w - 28;
    let yy = y + 70;
    const para = (s, size = 5.8, weight = 500, color = P.dark) => { wrapText(s, bw, size, weight).forEach(l => { stext(l, bx, yy, size, color, 'left', weight); yy += size * 1.45; }); };
    if (!q) {
      para('“' + CHATTER[id][n.count % CHATTER[id].length] + '”');
      yy += 6;
      para('Next job in ' + fmtTime(jobDueAt(id) - Date.now()) + '. I find a new job every 20 minutes, and ' + (id === 'cat' ? 'Pip' : 'Mira') + ' takes the turns in between.', 5.4, 600);
      textButton(this, 'red', x + w / 2 - 30, y + h - 32, 60, 21, 'OK', () => popScene(this));
    } else {
      const tx = questText(q);
      para(tx.title, 7.2, 700);
      yy += 2;
      para('“' + q.reason + '”', 5.6, 500);
      yy += 4;
      para('Goal: ' + tx.goal, 5.8, 700);
      spr('tiles', 225, bx - 4, yy - 6);
      stext(`Reward: ${q.reward} gold`, bx + 10, yy + 1.5, 5.8, P.dark, 'left', 700);
      yy += 10;
      if (q.status === 'offered') {
        textButton(this, 'red', x + w / 2 - 70, y + h - 32, 64, 21, 'Accept', () => { q.status = 'active'; persist(); popScene(this); Game.toast('Job accepted: ' + tx.goal); });
        textButton(this, 'grey', x + w / 2 + 6, y + h - 32, 64, 21, 'Later', () => popScene(this));
      } else if (q.status === 'active') {
        bar(bx, yy, 150, 11, q.prog / q.n, 'blue');
        stext(`${q.prog} / ${q.n}`, bx + 156, yy + 5.5, 5.6, P.dark, 'left', 700);
        textButton(this, 'red', x + w / 2 - 70, y + h - 32, 64, 21, 'On it', () => popScene(this));
        textButton(this, 'grey', x + w / 2 + 6, y + h - 32, 64, 21, 'Drop job', () => {
          pushScene(new Confirm('Drop this job?', 'The next job still waits for its timer.', 'Drop', () => { n.quest = null; persist(); popScene(this); }));
        });
      } else {
        bar(bx, yy, 150, 11, 1, 'blue');
        stext('Done!', bx + 156, yy + 5.5, 5.6, P.redD, 'left', 700);
        textButton(this, 'red', x + w / 2 - 40, y + h - 32, 80, 21, 'Claim reward', () => {
          SAVE.gold += q.reward; SAVE.stats.goldEarned += q.reward; SAVE.stats.quests++; n.count++; n.quest = null;
          persist(); sfx('coin-d'); sfx('coin-c', 0.7); Game.toast(`+${q.reward} gold from ${N.name}`); popScene(this); questTick();
        });
      }
    }
    this.end();
  }
}
