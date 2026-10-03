/* ==========================================================================
   Map generator: every level gets its own seeded desert in the Kenney style
   (sand, purple/teal mesas with cliffs and ramps, grey buildings, plazas,
   fenced yards, ground patches, cacti, rocks and bones).
   ========================================================================== */
const PT = {
  p: { tl: 0, t: 1, tr: 2, l: 18, c: 19, r: 20, dl: 36, d: 37, dr: 38, ramp: 40, bush: 39, trees: [57, 75] },
  t: { tl: 5, t: 6, tr: 7, l: 23, c: 24, r: 25, dl: 41, d: 42, dr: 43, ramp: 45, bush: 44, trees: [62, 80] }
};
const PS = {
  p: [90, 91, 92, 108, 109, 110, 126, 127, 128, 129, 130],
  t: [95, 96, 97, 113, 114, 115, 131, 132, 133, 134, 135],
  d: [154, 155, 156, 172, 173, 174, 190, 191, 192, 193, 194]
};
const FN = {
  red:   { tl: 105, t: 106, tr: 107, l: 123, r: 125, bl: 141, b: 142, br: 143, endL: 159, startR: 161 },
  chain: { tl: 177, t: 178, tr: 179, l: 195, r: 197, bl: 213, b: 214, br: 215, endL: 231, startR: 233 }
};
const MAP_CACHE = {};
function getMap(li) { if (!MAP_CACHE[li]) MAP_CACHE[li] = genMap(li); return MAP_CACHE[li]; }

function genMap(li) {
  const L = li + 1, def = LEVELS[li], th = def.th;
  const r = rng(1009 + L * 7919);
  const W = def.w, H = def.h, N = W * H;
  const g0 = new Int16Array(N), g1 = new Int16Array(N).fill(-1), g2 = new Int16Array(N).fill(-1), g3 = new Int16Array(N).fill(-1);
  const solid = new Uint8Array(N), hgt = new Uint8Array(N), occ = new Uint8Array(N), pocc = new Uint8Array(N);
  const id = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  for (let i = 0; i < N; i++) g0[i] = r() < 0.13 ? 65 : 64;
  const shadows = [], tops = [], yards = [], doorSpawns = [];

  const spots = [[W >> 1, H - 5], [5, H >> 1], [W - 6, H >> 1], [W >> 1, 5], [6, H - 6], [W - 7, H - 6]];
  const s0 = spots[(L * 5) % spots.length];
  const spawn = { x: s0[0], y: s0[1] };
  const reserve = (x0, y0, w, h, v = 1, arr = occ) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inb(x, y)) arr[id(x, y)] = v; };
  reserve(spawn.x - 4, spawn.y - 4, 9, 9);
  const fits = (x0, y0, w, h, arr) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (!inb(x, y) || arr[id(x, y)]) return false; } return true; };
  const place = (w, h, m, arr = occ, tries = 140) => {
    for (let k = 0; k < tries; k++) {
      const x = rint(r, 1 + m, W - w - 1 - m), y = rint(r, 1 + m, H - h - 1 - m);
      if (x < 1 || y < 1) continue;
      if (fits(x - m, y - m, w + 2 * m, h + 2 * m, arr)) return { x, y };
    }
    return null;
  };

  /* --- mesas (raised plateaus with a cliff face and ramps) --- */
  function plateau(col) {
    const S = PT[col];
    const w = rint(r, 5, 11), top = rint(r, 3, 6), cliff = r() < 0.35 ? 3 : 2, h = top + cliff;
    const pos = place(w, h, 1); if (!pos) return;
    reserve(pos.x - 1, pos.y - 1, w + 2, h + 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = id(pos.x + x, pos.y + y), L0 = x === 0, R0 = x === w - 1;
      let t;
      if (y === 0) t = L0 ? S.tl : R0 ? S.tr : S.t;
      else if (y < top) t = L0 ? S.l : R0 ? S.r : S.c;
      else if (y === top) t = L0 ? S.dl : R0 ? S.dr : S.d;
      else if (y === h - 1) t = L0 ? 72 : R0 ? 74 : 73;
      else t = L0 ? 54 : R0 ? 56 : 55;
      g1[i] = t;
      if (y < top) hgt[i] = 1; else solid[i] = 1;
    }
    const cols = [], nr = w >= 8 ? 2 : 1;
    for (let k = 0; k < 30 && cols.length < nr; k++) { const c = rint(r, 1, w - 2); if (cols.every(o => Math.abs(o - c) > 2)) cols.push(c); }
    for (const c of cols) for (let y = top; y < h; y++) { const i = id(pos.x + c, pos.y + y); g1[i] = S.ramp; solid[i] = 0; hgt[i] = 2; }
    const face = []; for (let x = 1; x < w - 1; x++) if (!cols.includes(x)) face.push(x);
    const isFace = x => face.includes(x);
    // cliff-face features
    let used = new Set();
    if (r() < 0.55 && w >= 6) {
      for (let k = 0; k < 10; k++) {
        const x = rint(r, 1, w - 4);
        if (isFace(x) && isFace(x + 1) && isFace(x + 2)) {
          for (let j = 0; j < 3; j++) { g1[id(pos.x + x + j, pos.y + h - 1)] = 77 + j; used.add(x + j); }
          doorSpawns.push({ x: pos.x + x + 1, y: pos.y + h }); break;
        }
      }
    } else if (r() < 0.5 && cliff === 2) {
      for (let k = 0; k < 10; k++) {
        const x = rint(r, 1, w - 3);
        if (isFace(x) && isFace(x + 1)) {
          g2[id(pos.x + x, pos.y + top)] = 188; g2[id(pos.x + x + 1, pos.y + top)] = 189;
          g2[id(pos.x + x, pos.y + top + 1)] = 206; g2[id(pos.x + x + 1, pos.y + top + 1)] = 207;
          used.add(x); used.add(x + 1); doorSpawns.push({ x: pos.x + x, y: pos.y + h }); break;
        }
      }
    }
    for (const x of face) {
      if (used.has(x)) continue;
      if (cliff === 3 && r() < 0.18) g1[id(pos.x + x, pos.y + top + 1)] = r() < 0.5 ? 60 : 61;
      else if (r() < 0.07) g2[id(pos.x + x, pos.y + h - 1)] = 208;
    }
    // mesa top decoration (keep the ramp landings clear)
    const landing = new Set(cols.map(c => c));
    for (let y = 1; y < top; y++) for (let x = 1; x < w - 1; x++) {
      if (y === top - 1 && (landing.has(x) || landing.has(x - 1) || landing.has(x + 1))) continue;
      const i = id(pos.x + x, pos.y + y), q = r();
      if (q < 0.07) { g2[i] = S.bush; }
      else if (q < 0.12) { g2[i] = pick(r, S.trees); solid[i] = 3; }
      else if (q < 0.14) { g2[i] = 58; }
    }
    shadows.push({ x: pos.x + w, y: pos.y + 1, h: h - 1 });
    tops.push({ x0: pos.x + 1, y0: pos.y + 1, x1: pos.x + w - 2, y1: pos.y + top - 2 });
  }

  /* --- grey buildings --- */
  function building() {
    const w = rint(r, 4, 8), roof = rint(r, 2, 3), h = roof + 2;
    const pos = place(w, h, 1); if (!pos) return;
    reserve(pos.x - 1, pos.y - 1, w + 2, h + 2);
    const vent = r() < 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = id(pos.x + x, pos.y + y), L0 = x === 0, R0 = x === w - 1;
      let t;
      if (y === 0) t = L0 ? (vent ? 10 : 15) : R0 ? (vent ? 12 : 17) : (vent ? 11 : 16);
      else if (y < roof) t = L0 ? (vent ? 28 : 33) : R0 ? (vent ? 30 : 35) : (vent ? 29 : 34);
      else if (y === roof) t = L0 ? 51 : R0 ? 53 : 52;
      else t = L0 ? 87 : R0 ? 89 : 88;
      g1[i] = t; solid[i] = 3;
    }
    const wy = pos.y + roof, by = pos.y + roof + 1;
    const feat = r();
    if (feat < 0.4 && w >= 4) {
      const x = pos.x + rint(r, 1, w - 3);
      g2[id(x, wy)] = 152; g2[id(x + 1, wy)] = 153; g2[id(x, by)] = 170; g2[id(x + 1, by)] = 171;
      doorSpawns.push({ x, y: by + 1 });
    } else if (feat < 0.75 && w >= 4) {
      const x = pos.x + rint(r, 1, w - 3);
      g2[id(x, wy)] = 150; g2[id(x + 1, wy)] = 151; g2[id(x, by)] = r() < 0.5 ? 168 : 186; g2[id(x + 1, by)] = g2[id(x, by)] + 1;
    } else {
      g2[id(pos.x + rint(r, 1, w - 2), by)] = pick(r, [208, 209, 210]);
    }
    if (roof >= 2 && w >= 5 && r() < 0.6) { const x = pos.x + rint(r, 1, w - 3); g2[id(x, pos.y)] = 211; g2[id(x + 1, pos.y)] = 212; g2[id(x, pos.y + 1)] = 229; g2[id(x + 1, pos.y + 1)] = 230; }
    else if (r() < 0.7) g2[id(pos.x + rint(r, 1, w - 2), pos.y + rint(r, 0, roof - 1))] = pick(r, [223, 224, 220, 221, 198, 201]);
    shadows.push({ x: pos.x + w, y: pos.y + 1, h: h - 1 });
  }

  /* --- paved plaza with four lamps --- */
  function plaza() {
    const w = rint(r, 5, 9), h = rint(r, 4, 6);
    const pos = place(w + 2, h + 2, 0); if (!pos) return;
    reserve(pos.x, pos.y, w + 2, h + 2);
    const px = pos.x + 1, py = pos.y + 1, S = [100, 101, 102, 118, 119, 120, 136, 137, 138];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = x === 0 ? 0 : x === w - 1 ? 2 : 1, row = y === 0 ? 0 : y === h - 1 ? 2 : 1;
      g0[id(px + x, py + y)] = S[row * 3 + col];
    }
    if (w >= 6 && h >= 4) { const cx = px + (w >> 1) - 1, cy = py + (h >> 1) - 1; g0[id(cx, cy)] = 103; g0[id(cx + 1, cy)] = 104; g0[id(cx, cy + 1)] = 121; g0[id(cx + 1, cy + 1)] = 122; }
    for (const [lx, ly] of [[px - 1, py + 1], [px + w, py + 1], [px - 1, py + h - 1], [px + w, py + h - 1]]) {
      if (!inb(lx, ly) || !inb(lx, ly - 1)) continue;
      g2[id(lx, ly)] = 86; solid[id(lx, ly)] = 3; g3[id(lx, ly - 1)] = 68;
    }
  }

  /* --- fenced yard with a gate --- */
  function yard() {
    const kind = r() < 0.5 ? 'red' : 'chain', F = FN[kind];
    const w = rint(r, 6, 10), h = rint(r, 5, 7);
    const pos = place(w, h, 1); if (!pos) return;
    reserve(pos.x - 1, pos.y - 1, w + 2, h + 2);
    const gap = rint(r, 2, w - 4);
    patch(r() < 0.5 ? 't' : 'p', pos.x + 1, pos.y + 1, w - 2, h - 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1; if (!edge) continue;
      const i = id(pos.x + x, pos.y + y);
      let t = -1;
      if (y === 0) t = x === 0 ? F.tl : x === w - 1 ? F.tr : F.t;
      else if (y === h - 1) {
        if (x === gap || x === gap + 1) t = -1;
        else if (x === 0) t = F.bl; else if (x === w - 1) t = F.br;
        else if (x === gap - 1) t = F.endL; else if (x === gap + 2) t = F.startR; else t = F.b;
      } else t = x === 0 ? F.l : F.r;
      if (t >= 0) { g1[i] = t; solid[i] = 1; }
    }
    for (let k = 0; k < 2; k++) { const x = pos.x + rint(r, 1, w - 2), y = pos.y + 1; const i = id(x, y); if (g2[i] < 0) { g2[i] = pick(r, [202, 203, 220]); solid[i] = 3; } }
    yards.push({ x0: pos.x + 1, y0: pos.y + 2, x1: pos.x + w - 2, y1: pos.y + h - 2 });
  }

  /* --- flat ground patches --- */
  function patch(kind, x0, y0, w, h) {
    const S = PS[kind];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = x === 0 ? 0 : x === w - 1 ? 2 : 1, row = y === 0 ? 0 : y === h - 1 ? 2 : 1;
      let t = S[row * 3 + col];
      if (row === 1 && col === 1 && r() < 0.12) t = S[9];
      g0[id(x0 + x, y0 + y)] = t;
    }
  }
  function freePatch(kind) {
    const w = rint(r, 3, 8), h = rint(r, 3, 6);
    for (let k = 0; k < 80; k++) {
      const x = rint(r, 1, W - w - 1), y = rint(r, 1, H - h - 1);
      if (!fits(x, y, w, h, occ) || !fits(x - 1, y - 1, w + 2, h + 2, pocc)) continue;
      patch(kind, x, y, w, h);
      reserve(x, y, w, h, 1, pocc);
      if (kind !== 'd') for (let j = 0; j < w * h; j++) {
        const xx = x + rint(r, -2, w + 1), yy = y + rint(r, -2, h + 1);
        if (inb(xx, yy) && !occ[id(xx, yy)] && !pocc[id(xx, yy)] && (g0[id(xx, yy)] === 64 || g0[id(xx, yy)] === 65) && r() < 0.35) g0[id(xx, yy)] = S_out(kind);
      }
      return;
    }
  }
  const S_out = kind => PS[kind][10];

  // order: big features first, then patches, then scattered decor
  const jobs = [];
  for (let k = 0; k < th.tP; k++) jobs.push(() => plateau('p'));
  for (let k = 0; k < th.tT; k++) jobs.push(() => plateau('t'));
  for (let k = 0; k < th.bld; k++) jobs.push(building);
  for (let k = 0; k < th.plz; k++) jobs.push(plaza);
  for (let k = 0; k < th.yard; k++) jobs.push(yard);
  for (let k = jobs.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [jobs[k], jobs[j]] = [jobs[j], jobs[k]]; }
  jobs.forEach(f => f());
  for (let k = 0; k < th.pP; k++) freePatch('p');
  for (let k = 0; k < th.pT; k++) freePatch('t');
  for (let k = 0; k < th.pD; k++) freePatch('d');

  const freeCell = () => {
    for (let k = 0; k < 60; k++) {
      const x = rint(r, 1, W - 2), y = rint(r, 1, H - 2), i = id(x, y);
      if (occ[i] || g1[i] >= 0 || g2[i] >= 0 || solid[i]) continue;
      return { x, y, i };
    }
    return null;
  };
  const scatter = (n, fn) => { for (let k = 0; k < n; k++) { const c = freeCell(); if (c) fn(c); } };
  scatter(th.cac, c => { g2[c.i] = r() < 0.6 ? 63 : 81; solid[c.i] = 3; occ[c.i] = 2; });
  scatter(th.rock, c => { const t = pick(r, [76, 76, 58, 82, 83]); g2[c.i] = t; if (t !== 58) { solid[c.i] = 3; occ[c.i] = 2; } });
  scatter(th.tree, c => {
    const onP = PS.p.includes(g0[c.i]), onT = PS.t.includes(g0[c.i]);
    g2[c.i] = onP ? pick(r, [57, 75]) : onT ? pick(r, [62, 80]) : pick(r, [62, 80, 57, 63]); solid[c.i] = 3; occ[c.i] = 2;
  });
  scatter(th.bone, c => {
    const ok = inb(c.x + 1, c.y + 1) && [id(c.x + 1, c.y), id(c.x, c.y + 1), id(c.x + 1, c.y + 1)].every(i => !occ[i] && g1[i] < 0 && g2[i] < 0 && !solid[i]);
    if (ok) { g2[c.i] = 66; g2[id(c.x + 1, c.y)] = 67; g2[id(c.x, c.y + 1)] = 84; g2[id(c.x + 1, c.y + 1)] = 85; }
  });
  scatter(1 + th.bld + th.yard, c => { g2[c.i] = pick(r, [202, 203, 49, 50]); solid[c.i] = 3; occ[c.i] = 2; });
  for (let i = 0; i < N; i++) {
    if (g1[i] >= 0 || g2[i] >= 0 || occ[i] === 2) continue;
    const t = g0[i];
    if ((t === PS.p[4] || t === PS.p[9]) && r() < 0.07) g2[i] = 39;
    else if ((t === PS.t[4] || t === PS.t[9]) && r() < 0.07) g2[i] = 44;
  }

  /* --- reachability from the player spawn (respecting heights & ramps) --- */
  const reach = new Uint8Array(N);
  const stack = [id(spawn.x, spawn.y)]; reach[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0, ha = hgt[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue;
      const j = id(nx, ny); if (reach[j] || (solid[j] & 1)) continue;
      const hb = hgt[j]; if (!(ha === hb || ha === 2 || hb === 2)) continue;
      reach[j] = 1; stack.push(j);
    }
  }
  const floor = []; for (let i = 0; i < N; i++) if (reach[i] && hgt[i] !== 2 && g2[i] < 0 && !solid[i]) floor.push(i);
  const far = (i, d) => { const x = i % W, y = (i / W) | 0; return Math.abs(x - spawn.x) + Math.abs(y - spawn.y) >= d; };
  const taken = new Set();
  const takeFrom = cands => { const ok = cands.filter(i => reach[i] && !solid[i] && hgt[i] !== 2 && g2[i] < 0 && !taken.has(i)); if (!ok.length) return -1; const i = pick(r, ok); taken.add(i); return i; };
  const rectCells = rc => { const out = []; for (let y = rc.y0; y <= rc.y1; y++) for (let x = rc.x0; x <= rc.x1; x++) if (inb(x, y)) out.push(id(x, y)); return out; };
  const special = [...tops, ...yards];
  const chests = [];
  const nOrange = 1 + (L % 3 === 0 ? 1 : 0) + (L >= 15 ? 1 : 0), nGold = L >= 11 ? 1 + (BOSSES[L] ? 1 : 0) : 0;
  for (let k = 0; k < nOrange + nGold; k++) {
    let i = -1;
    if (special.length && r() < 0.75) i = takeFrom(rectCells(pick(r, special)));
    if (i < 0) i = takeFrom(floor.filter(j => far(j, 10)));
    if (i >= 0) chests.push({ x: i % W, y: (i / W) | 0, gold: k >= nOrange });
  }
  const medkits = [];
  for (let k = 0; k < 1 + (L >= 8 ? 1 : 0); k++) { const i = takeFrom(floor.filter(j => far(j, 8))); if (i >= 0) medkits.push({ x: i % W, y: (i / W) | 0 }); }
  const spawnPts = doorSpawns.filter(p => inb(p.x, p.y) && reach[id(p.x, p.y)] && !solid[id(p.x, p.y)]);
  return { L, W, H, g0, g1, g2, g3, solid, hgt, reach, floor, spawn, spawnPts, chests, medkits, shadows, canvas: null, over: null };
}

function tileImg(i) { const s = SHEET.tiles; return [(i % 18) * 16, Math.floor(i / 18) * 16]; }
function renderMap(m) {
  if (m.canvas) return m;
  const c = document.createElement('canvas'); c.width = m.W * T; c.height = m.H * T;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const img = SHEET.tiles.img;
  const draw = (arr, gg) => { for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { const t = arr[y * m.W + x]; if (t >= 0) { const [sx, sy] = tileImg(t); gg.drawImage(img, sx, sy, 16, 16, x * T, y * T, 16, 16); } } };
  draw(m.g0, g);
  g.fillStyle = 'rgba(71,50,75,0.16)';
  for (const s of m.shadows) g.fillRect(s.x * T, s.y * T, 9, s.h * T);
  draw(m.g1, g); draw(m.g2, g);
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const og = o.getContext('2d'); og.imageSmoothingEnabled = false; draw(m.g3, og);
  m.canvas = c; m.over = o;
  return m;
}
