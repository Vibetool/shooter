'use strict';
/* ==========================================================================
   Dustwell Shooter — core: canvas, sprites, text, audio, input, save
   Art & sound: Kenney "Desert Shooter Pack" (CC0)
   ========================================================================== */
const MW = 460, MH = 258, T = 16;
const QUEST_MS = 20 * 60 * 1000;   // each animal's job cooldown
const STAGGER_MS = 10 * 60 * 1000; // they take turns, so a new job shows up every 10 minutes
const P = {
  dark: '#47324b', white: '#ffffff', red: '#dd674c', redL: '#f78d68', redD: '#b94f37',
  lav: '#999ac4', lavL: '#c3c6e9', lavD: '#81759b', yel: '#ffb84c', yelL: '#ffde8c', yelD: '#ec9a1e',
  blue: '#778fdb', blueL: '#a1b6f5', sand: '#f3cdac', sandD: '#dfa988', sandL: '#fbe5c9',
  purp: '#a386ce', teal: '#7bd8c4', tealD: '#63b8a6', dust: '#dfa988'
};
const FONT = '"Poppins", "Segoe UI", system-ui, -apple-system, sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = Math.random;
const rint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function fmtTime(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* ---------------- canvas ---------------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let CW = 1, CH = 1, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  CW = Math.max(1, Math.round(window.innerWidth * DPR));
  CH = Math.max(1, Math.round(window.innerHeight * DPR));
  cv.width = CW; cv.height = CH;
}
window.addEventListener('resize', resize);
resize();

/* menu space: 460x258 art pixels, centered and scaled */
const M = { s: 1, ox: 0, oy: 0 };
function menuXf() {
  let s = Math.min(CW / MW, CH / MH);
  if (s >= 2) s = Math.floor(s);
  M.s = s; M.ox = Math.round((CW - MW * s) / 2); M.oy = Math.round((CH - MH * s) / 2);
  ctx.setTransform(s, 0, 0, s, M.ox, M.oy);
  ctx.imageSmoothingEnabled = false;
}
const toMenu = (x, y) => [(x - M.ox) / M.s, (y - M.oy) / M.s];

/* ---------------- sprites ---------------- */
const SHEET = {};
const SHEET_DEF = { tiles: [16, 18], ui: [16, 18], players: [24, 4], enemies: [24, 4], weapons: [24, 10] };
function loadImages() {
  return Promise.all(Object.keys(SHEET_DEF).map(k => new Promise(res => {
    const img = new Image();
    img.onload = () => { SHEET[k] = { img, ts: SHEET_DEF[k][0], cols: SHEET_DEF[k][1] }; res(); };
    img.onerror = () => res();
    img.src = ASSETS.img[k];
  })));
}
function makeWhite(k) {
  const s = SHEET[k]; const c = document.createElement('canvas');
  c.width = s.img.width; c.height = s.img.height;
  const g = c.getContext('2d'); g.drawImage(s.img, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  SHEET[k + 'W'] = { img: c, ts: s.ts, cols: s.cols };
}
/* yellow-tinted copy of a sheet (used when the skill strikes a monster) */
function makeTint(k, suffix, color) {
  const s = SHEET[k]; const c = document.createElement('canvas');
  c.width = s.img.width; c.height = s.img.height;
  const g = c.getContext('2d'); g.drawImage(s.img, 0, 0);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  SHEET[k + suffix] = { img: c, ts: s.ts, cols: s.cols };
}
/* draw a tile; (x,y) = top-left of the (scaled) tile box */
function spr(k, i, x, y, o) {
  const s = SHEET[k]; if (!s) return;
  const ts = s.ts, sx = (i % s.cols) * ts, sy = Math.floor(i / s.cols) * ts;
  if (!o) { ctx.drawImage(s.img, sx, sy, ts, ts, x, y, ts, ts); return; }
  const sc = o.scale || 1, w = ts * sc;
  ctx.save();
  ctx.translate(x + w / 2, y + w / 2);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(o.flip ? -sc : sc, o.flipY ? -sc : sc);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.drawImage(s.img, sx, sy, ts, ts, -ts / 2, -ts / 2, ts, ts);
  ctx.restore();
}
function nine(k, sx, sy, sw, sh, l, t, r, b, x, y, w, h) {
  const img = SHEET[k].img, mw = sw - l - r, mh = sh - t - b, dw = w - l - r, dh = h - t - b;
  const D = (a, bb, c, d, e, f, g, hh) => { if (c > 0 && d > 0 && g > 0 && hh > 0) ctx.drawImage(img, a, bb, c, d, e, f, g, hh); };
  D(sx, sy, l, t, x, y, l, t); D(sx + l, sy, mw, t, x + l, y, dw, t); D(sx + sw - r, sy, r, t, x + w - r, y, r, t);
  D(sx, sy + t, l, mh, x, y + t, l, dh); D(sx + l, sy + t, mw, mh, x + l, y + t, dw, dh); D(sx + sw - r, sy + t, r, mh, x + w - r, y + t, r, dh);
  D(sx, sy + sh - b, l, b, x, y + h - b, l, b); D(sx + l, sy + sh - b, mw, b, x + l, y + h - b, dw, b); D(sx + sw - r, sy + sh - b, r, b, x + w - r, y + h - b, r, b);
}
const PANEL = { yellow: [48, 0], red: [96, 0], grey: [144, 0], orange: [192, 0], blue: [240, 0] };
/* the grey panel (UI tiles 9-11 / 27-29 / 45-47) cut down to any small size: 6px rim from the corner/edge tiles */
function smallPanel(x, y, w, h, shadow = true) {
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + 2, w, h); }
  const img = SHEET.ui.img, b = 6, T_ = (i, sx, sy, sw, sh, dx, dy, dw, dh) => ctx.drawImage(img, (i % 18) * 16 + sx, Math.floor(i / 18) * 16 + sy, sw, sh, dx, dy, dw, dh);
  T_(28, 0, 0, 16, 16, x + b, y + b, w - 2 * b, h - 2 * b);
  T_(10, 0, 0, 16, b, x + b, y, w - 2 * b, b); T_(46, 0, 16 - b, 16, b, x + b, y + h - b, w - 2 * b, b);
  T_(27, 0, 0, b, 16, x, y + b, b, h - 2 * b); T_(29, 16 - b, 0, b, 16, x + w - b, y + b, b, h - 2 * b);
  T_(9, 0, 0, b, b, x, y, b, b); T_(11, 16 - b, 0, b, b, x + w - b, y, b, b);
  T_(45, 0, 16 - b, b, b, x, y + h - b, b, b); T_(47, 16 - b, 16 - b, b, b, x + w - b, y + h - b, b, b);
}
function panel(kind, x, y, w, h, shadow = true) {
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + 2, w, h); }
  const p = PANEL[kind];
  nine('ui', p[0], p[1], 48, 48, 16, 16, 16, 16, x, y, w, h);
}
function btn(kind, x, y, w, h, shadow = true) {
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + 2, w, h); }
  if (kind === 'red') nine('ui', 112, 48, 48, 16, 4, 4, 4, 5, x, y, w, h);
  else nine('ui', 176, 48, 48, 16, 8, 4, 8, 5, x, y, w, h);
}
/* bar in the Kenney style: white rim, dark frame, light-edged fill */
function bar(x, y, w, h, frac, col, segs) {
  const C = col === 'red' ? [P.redL, P.red] : col === 'yellow' ? [P.yelL, P.yel] : [P.blueL, P.blue];
  frac = clamp(frac, 0, 1);
  ctx.fillStyle = P.white; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = P.dark; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  const ix = x + 3, iy = y + 3, iw = w - 6, ih = h - 6;
  if (segs) {
    const sw = (iw - (segs - 1) * 2) / segs, n = frac * segs;
    for (let i = 0; i < segs; i++) {
      const sx = Math.round(ix + i * (sw + 2)), ww = Math.round(ix + i * (sw + 2) + sw) - sx;
      const f = clamp(n - i, 0, 1);
      ctx.fillStyle = P.sand; ctx.fillRect(sx, iy, ww, ih);
      if (f > 0) {
        const fw = Math.max(2, Math.round(ww * f));
        ctx.fillStyle = C[0]; ctx.fillRect(sx, iy, fw, ih);
        ctx.fillStyle = C[1]; ctx.fillRect(sx + 1, iy + 1, fw - 2, ih - 2);
      }
    }
    return;
  }
  const fw = Math.round(iw * frac);
  ctx.fillStyle = P.sand; ctx.fillRect(ix, iy, iw, ih);
  if (fw > 0) {
    ctx.fillStyle = C[0]; ctx.fillRect(ix, iy, fw, ih);
    if (fw > 2) { ctx.fillStyle = C[1]; ctx.fillRect(ix + 1, iy + 1, fw - 2, ih - 2); }
    if (fw < iw) {
      ctx.fillStyle = P.dark; ctx.fillRect(ix + fw, iy, Math.min(2, iw - fw), ih);
      if (iw - fw > 2) { ctx.fillStyle = P.white; ctx.fillRect(ix + fw + 2, iy, 1, ih); }
    }
  }
}

/* ---------------- pixel font (Kenney UI glyph tiles) ---------------- */
const GLYPH = { A: {}, B: {} };
function buildGlyphs() {
  const img = SHEET.ui.img, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const defs = { A: { sym: 90, am: 108, nz: 126, y0: 1, h: 14 }, B: { sym: 144, am: 162, nz: 180, y0: 2, h: 12 } };
  const syms = '%+-0123456789';
  for (const s in defs) {
    const d = defs[s];
    const add = (ch, idx) => {
      const tx = (idx % 18) * 16, ty = Math.floor(idx / 18) * 16;
      let x0 = 16, x1 = -1;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (data[((ty + y) * c.width + tx + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
      if (x1 >= x0) GLYPH[s][ch] = { sx: tx + x0, sy: ty + d.y0, w: x1 - x0 + 1, h: d.h };
    };
    for (let i = 0; i < 13; i++) add(syms[i], d.sym + i);
    for (let i = 0; i < 13; i++) add(String.fromCharCode(65 + i), d.am + i);
    for (let i = 0; i < 13; i++) add(String.fromCharCode(78 + i), d.nz + i);
  }
}
function ptW(str, set = 'A') {
  let w = 0, n = 0;
  for (const ch of String(str).toUpperCase()) { const g = GLYPH[set][ch]; if (g) { w += g.w - 2; n++; } else w += 4; }
  return n ? w + 2 : w;
}
function ptext(str, x, y, set = 'A', align = 'left', sc = 1) {
  const img = SHEET.ui.img, tw = ptW(str, set) * sc;
  let cx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  cx = Math.round(cx * 2) / 2;
  for (const ch of String(str).toUpperCase()) {
    const g = GLYPH[set][ch];
    if (g) { ctx.drawImage(img, g.sx, g.sy, g.w, g.h, cx, y, g.w * sc, g.h * sc); cx += (g.w - 2) * sc; } else cx += 4 * sc;
  }
}
/* sans text (scaled with the current transform, crisp at device resolution) */
function stext(str, x, y, size, color, align = 'left', weight = 600, base = 'middle') {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(str, x, y);
}
function stextO(str, x, y, size, color, outline, align = 'center', weight = 700, ow = 1.6) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = ow; ctx.strokeStyle = outline; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function wrapText(str, maxW, size, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function textW(str, size, weight = 600) { ctx.font = `${weight} ${size}px ${FONT}`; return ctx.measureText(str).width; }

/* ---------------- audio ---------------- */
const AUD = { ctx: null, buf: {}, sfx: null, mus: null, last: {} };
function b64ToBuf(b64) {
  const bin = atob(b64.slice(b64.indexOf(',') + 1)), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function audioUnlock() {
  if (AUD.ctx) { if (AUD.ctx.state === 'suspended') AUD.ctx.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = new AC(); AUD.ctx = ac;
    AUD.sfx = ac.createGain(); AUD.sfx.connect(ac.destination);
    AUD.mus = ac.createGain(); AUD.mus.connect(ac.destination);
    applyVolumes();
    for (const k in ASSETS.sfx) {
      const done = b => { AUD.buf[k] = b; };
      try { const p = ac.decodeAudioData(b64ToBuf(ASSETS.sfx[k]), done, () => {}); if (p && p.catch) p.catch(() => {}); } catch (e) { /* skip */ }
    }
    Music.start();
  } catch (e) { AUD.ctx = null; }
}
function applyVolumes() {
  if (!AUD.ctx || !SAVE) return;
  AUD.sfx.gain.value = SAVE.settings.sfx * 0.9;
  AUD.mus.gain.value = SAVE.settings.music * 0.55;
}
function sfx(name, vol = 1, rate = 1, minGap = 0.03) {
  const ac = AUD.ctx, b = AUD.buf[name]; if (!ac || !b || !SAVE || SAVE.settings.sfx <= 0) return;
  const now = ac.currentTime; if (AUD.last[name] && now - AUD.last[name] < minGap) return; AUD.last[name] = now;
  const s = ac.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = ac.createGain(); g.gain.value = vol; s.connect(g); g.connect(AUD.sfx); s.start();
}
/* tiny procedural desert loop (the pack has no music) */
const Music = {
  on: false, step: 0, next: 0, timer: 0, intensity: 0,
  start() { if (this.on || !AUD.ctx) return; this.on = true; this.next = AUD.ctx.currentTime + 0.1; this.timer = setInterval(() => this.tick(), 90); },
  note(f, t, d, type, v) {
    const ac = AUD.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(g); g.connect(AUD.mus); o.start(t); o.stop(t + d + 0.02);
  },
  noise(t, v) {
    const ac = AUD.ctx; if (!this.nb) { const b = ac.createBuffer(1, 2205, 22050); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.nb = b; }
    const s = ac.createBufferSource(); s.buffer = this.nb; const g = ac.createGain(); const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(f); f.connect(g); g.connect(AUD.mus); s.start(t); s.stop(t + 0.06);
  },
  tick() {
    const ac = AUD.ctx; if (!ac || !SAVE || SAVE.settings.music <= 0) { if (ac) this.next = ac.currentTime + 0.1; return; }
    const spb = 60 / 104 / 2; // eighth notes
    const mf = m => 440 * Math.pow(2, (m - 69) / 12);
    const BASS = [45, 45, 52, 45, 41, 41, 48, 41, 43, 43, 50, 43, 40, 40, 47, 44];
    const LEAD = [69, 0, 72, 0, 74, 76, 0, 74, 72, 0, 69, 0, 67, 0, 69, 0, 65, 0, 69, 72, 0, 74, 72, 0, 71, 0, 67, 0, 64, 0, 68, 0];
    while (this.next < ac.currentTime + 0.25) {
      const s = this.step, t = this.next;
      if (s % 2 === 0) this.note(mf(BASS[(s >> 1) % 16] - 12 + 12), t, spb * 1.7, 'triangle', 0.16);
      const l = LEAD[s % 32]; if (l && (s >> 5) % 2 === 1) this.note(mf(l), t, spb * 1.4, 'square', 0.035);
      if (this.intensity > 0 && s % 2 === 1) this.noise(t, 0.05 * this.intensity);
      if (this.intensity > 0 && s % 8 === 0) this.note(mf(33), t, 0.16, 'sine', 0.22 * this.intensity);
      this.step++; this.next += spb;
    }
  }
};

/* ---------------- input ---------------- */
const IN = { keys: {}, mx: -9999, my: -9999, down: false, rdown: false, touch: false, touches: {} };
let SCENES = [];
const topScene = () => SCENES[SCENES.length - 1];
function setScene(s) { SCENES = [s]; }
function pushScene(s) { SCENES.push(s); }
function popScene(s) { const i = SCENES.lastIndexOf(s || topScene()); if (i > 0) SCENES.splice(i, 1); }
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  audioUnlock();
  if (!IN.keys[k]) { const s = topScene(); if (s && s.key) s.key(k, e); }
  IN.keys[k] = true;
});
window.addEventListener('keyup', e => { IN.keys[e.key.toLowerCase()] = false; });
cv.addEventListener('mousemove', e => { IN.mx = e.clientX * DPR; IN.my = e.clientY * DPR; IN.touch = false; });
cv.addEventListener('mousedown', e => {
  audioUnlock(); cv.focus();
  IN.mx = e.clientX * DPR; IN.my = e.clientY * DPR; IN.touch = false;
  const s = topScene();
  if (e.button === 0) { IN.down = true; if (s && s.click) s.click(IN.mx, IN.my); }
  if (e.button === 2) { IN.rdown = true; if (s && s.rclick) s.rclick(); }
});
window.addEventListener('mouseup', e => { if (e.button === 0) IN.down = false; if (e.button === 2) IN.rdown = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { const s = topScene(); if (s && s.wheel) s.wheel(Math.sign(e.deltaY)); }, { passive: true });
window.addEventListener('blur', () => { IN.keys = {}; IN.down = IN.rdown = false; const s = topScene(); if (s && s.blur) s.blur(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { const s = topScene(); if (s && s.blur) s.blur(); } });
function touchList(e, fn) { for (const t of e.changedTouches) fn(t, t.clientX * DPR, t.clientY * DPR); }
cv.addEventListener('touchstart', e => {
  e.preventDefault(); audioUnlock(); IN.touch = true;
  touchList(e, (t, x, y) => {
    IN.touches[t.identifier] = { x, y, sx: x, sy: y };
    const s = topScene();
    if (s && s.touchStart) s.touchStart(t.identifier, x, y);
    else if (s && s.click) { IN.mx = x; IN.my = y; s.click(x, y); }
  });
}, { passive: false });
cv.addEventListener('touchmove', e => { e.preventDefault(); touchList(e, (t, x, y) => { const o = IN.touches[t.identifier]; if (o) { o.x = x; o.y = y; } }); }, { passive: false });
const touchEnd = e => { touchList(e, t => { const s = topScene(); if (s && s.touchEnd) s.touchEnd(t.identifier); delete IN.touches[t.identifier]; }); };
cv.addEventListener('touchend', touchEnd); cv.addEventListener('touchcancel', touchEnd);

/* ---------------- save (local + private cloud copy when the viewer offers one) ---------------- */
const SAVE_KEY = 'dustwell-shooter-save-v1';
let SAVE = null;
function defaultSave() {
  const now = Date.now();
  return {
    v: 1, created: now, savedAt: 0, gold: 0, owned: new Array(16).fill(0), equipped: -1, page: 0,
    cleared: new Array(LEVEL_N).fill(0), best: new Array(LEVEL_N).fill(0),
    stats: { kills: 0, goldEarned: 0, goldSpent: 0, chests: 0, deaths: 0, quests: 0, bosses: 0, playTime: 0, runs: 0 },
    npcs: { cat: { next: now, quest: null, count: 0 }, mouse: { next: now + STAGGER_MS, quest: null, count: 0 } }, lastJobAt: 0,
    upg: { regen: 0, fighter: 0, skill: 0 },
    settings: { sfx: 0.8, music: 0.45, shake: 1, nums: 1 }
  };
}
function normalizeSave(s) {
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  for (const k in d) {
    if (s[k] === undefined || s[k] === null && d[k] !== null) continue;
    if (Array.isArray(d[k])) { if (Array.isArray(s[k])) d[k] = d[k].map((v, i) => (s[k][i] !== undefined ? s[k][i] : v)); }
    else if (typeof d[k] === 'object' && d[k]) { if (typeof s[k] === 'object') { for (const j in d[k]) if (s[k][j] !== undefined) d[k][j] = s[k][j]; } }
    else d[k] = s[k];
  }
  for (const n of ['cat', 'mouse']) { const o = d.npcs[n]; if (typeof o !== 'object' || !o) d.npcs[n] = defaultSave().npcs[n]; }
  return d;
}
function loadLocal() { try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function persist() {
  SAVE.savedAt = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* storage unavailable */ }
  Cloud.queue();
}
const Cloud = {
  ref: null, busy: false, pending: false, timer: 0,
  async init() {
    try {
      const C = window.claude; if (!C || typeof C.use !== 'function') return;
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
      if (!db || !user) return;
      const id = await user.id(); if (!id) return;
      const ref = db.doc('data/users/' + id + '/save');
      const snap = await ref.get();
      if (snap && snap.exists) {
        const body = snap.data();
        if (body && typeof body.json === 'string') {
          const remote = JSON.parse(body.json);
          if (remote && (remote.savedAt || 0) > (SAVE.savedAt || 0)) {
            SAVE = normalizeSave(remote);
            try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* ignore */ }
            applyVolumes(); fixJobs(); questTick();
          }
        }
      }
      this.ref = ref;
      if (SAVE.savedAt) this.queue();
    } catch (e) { this.ref = null; }
  },
  queue() { if (!this.ref) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 4000); },
  async flush() {
    if (!this.ref) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    try { await this.ref.set({ json: JSON.stringify(SAVE), savedAt: SAVE.savedAt }); }
    catch (e) { const c = e && e.code; if (c === 'invalid_argument' || c === 'revoked' || c === 'not_granted' || c === 'quota_exceeded') this.ref = null; }
    this.busy = false;
    if (this.pending) { this.pending = false; this.queue(); }
  }
};
