/* ==========================================================================
   Save data: take progress to another device or browser (a save code or a
   file) and start over. A save code is the save as JSON in base64url plus a
   checksum, so a cut-off or damaged code is caught before it replaces anything.
   ========================================================================== */
const SaveCode = {
  prefix: 'DWS1',
  /* cyrb53, a quick 53-bit string hash: plenty to notice a damaged code */
  hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  },
  toB64(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  fromB64(t) { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; },
  make() { const json = JSON.stringify(SAVE); return `${this.prefix}.${this.toB64(new TextEncoder().encode(json))}.${this.hash(json + '|dustwell')}`; },
  /* the save inside a code, or an Error the player can read */
  read(text) {
    const t = String(text || '').replace(/\s+/g, ''), parts = t.split('.');
    if (!t.startsWith(this.prefix + '.')) throw new Error('That is not a Dustwell save code.');
    if (parts.length !== 3) throw new Error('The code is cut off. Copy all of it.');
    let json;
    try { json = new TextDecoder().decode(this.fromB64(parts[1])); } catch (e) { throw new Error('The code is cut off. Copy all of it.'); }
    if (this.hash(json + '|dustwell') !== parts[2]) throw new Error('The code is damaged or cut off. Copy all of it.');
    const d = JSON.parse(json);
    if (!d || typeof d.gold !== 'number' || !Array.isArray(d.owned) || !Array.isArray(d.cleared)) throw new Error('That code does not hold a save.');
    return d;
  },
  summary(d) {
    const lv = d.cleared.filter(Boolean).length, guns = d.owned.filter(Boolean).length;
    return `${d.gold} gold, ${lv} ${lv === 1 ? 'level' : 'levels'}, ${guns} ${guns === 1 ? 'gun' : 'guns'}`;
  },
  fileName() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `Dustwell save ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.txt`; },
  /* ask before replacing this save; then reload so duels, admin changes and jobs all start from the loaded save */
  offer(text) {
    let d;
    try { d = this.read(text); } catch (e) { sfx('error-a'); Game.toast(e.message); return false; }
    pushScene(new Confirm('Load this save?', [this.summary(d), 'It replaces the progress here.'], 'Load', () => {
      SAVE = normalizeSave(d); SAVE.savedAt = Date.now(); persist();
      Game.toast('Save loaded'); setTimeout(() => location.reload(), 600);
    }));
    return true;
  },
  copy() {
    const code = this.make(), byHand = () => pushScene(new SaveCodeView(code));
    try { navigator.clipboard.writeText(code).then(() => Game.toast('Save code copied: paste it into the game on your other device'), byHand); } catch (e) { byHand(); }
  },
  download() {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([this.make() + '\n'], { type: 'text/plain' }));
      a.download = this.fileName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      Game.toast('Save file downloaded');
    } catch (e) { Game.toast('The download was blocked. Use Copy save code instead.'); }
  },
  load() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt,text/plain';
    input.onchange = () => { const f = input.files && input.files[0]; if (f) f.text().then(t => this.offer(t), () => Game.toast('Could not read that file')); };
    input.click();
  }
};

class SaveDialog extends MenuScene {
  constructor() { super(); this.confirmT = 0; }
  key(k) { if (k === 'escape') popScene(this); }
  outside() { popScene(this); }
  update(dt) { super.update(dt); this.confirmT = Math.max(0, this.confirmT - dt); }
  draw() {
    dim(); this.begin();
    const x = 100, y = 28, w = 260, h = 202;
    this.hit(x, y, w, h, () => {});
    panel('grey', x, y, w, h);
    ptext('SAVE DATA', x + w / 2, y + 10, 'B', 'center');
    stext('This save: ' + SaveCode.summary(SAVE), x + w / 2, y + 36, 5.8, P.dark, 'center', 700);
    const L = x + 18, R2 = x + 134, head = (t, yy) => stext(t, L, yy, 5.4, P.redD, 'left', 700);
    head('Take it to another device or browser', y + 52);
    textButton(this, 'grey', L, y + 59, 108, 19, 'Copy save code', () => SaveCode.copy());
    if (Shortcut.site()) textButton(this, 'grey', R2, y + 59, 108, 19, 'Download file', () => SaveCode.download());
    head('Bring progress here from another device', y + 94);
    textButton(this, 'grey', L, y + 101, 108, 19, 'Paste code', () => pushScene(new PvpTextDialog({
      title: 'PASTE CODE', hint: 'Paste the code from Options > Save data on the other device.', maxLen: 200000, ok: 'Load', onSave: t => SaveCode.offer(t)
    })));
    textButton(this, 'grey', R2, y + 101, 108, 19, 'Load file', () => SaveCode.load());
    head('Start over', y + 136);
    textButton(this, this.confirmT > 0 ? 'red' : 'grey', L, y + 143, 108, 19, this.confirmT > 0 ? 'Confirm wipe' : 'Reset progress', () => {
      if (this.confirmT <= 0) { this.confirmT = 3; return; }
      const keep = { settings: SAVE.settings, pvpUid: SAVE.pvpUid, pvpName: SAVE.pvpName, pvp: SAVE.pvp, adminSeq: SAVE.adminSeq };
      SAVE = Object.assign(defaultSave(), keep); persist(); this.confirmT = 0; Game.toast('Progress reset. Welcome back to Dustwell.');
    });
    if (this.confirmT > 0) stext('Click again to erase gold, guns and levels', R2, y + 152.5, 4.6, P.redD, 'left', 600);
    textButton(this, 'red', x + w / 2 - 32, y + h - 28, 64, 21, 'Done', () => popScene(this));
    this.end();
  }
}

/* when the browser will not copy for us: show the code so the player can select and copy it */
class SaveCodeView extends MenuScene {
  constructor(code) {
    super();
    const el = this.el = document.createElement('textarea');
    el.id = 'save-code'; el.readOnly = true; el.value = code; el.spellcheck = false;
    Object.assign(el.style, { position: 'fixed', zIndex: 5, boxSizing: 'border-box', border: '2px solid #47324b', borderRadius: '0', background: '#ffffff',
      color: '#47324b', padding: '6px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', resize: 'none', outline: 'none', wordBreak: 'break-all' });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    document.body.appendChild(el);
    setTimeout(() => { el.focus(); el.select(); }, 0);
  }
  close() { this.el.remove(); popScene(this); }
  key(k) { if (k === 'escape') this.close(); }
  draw() {
    dim(); this.begin();
    const x = 90, y = 40, w = 280, h = 172;
    this.hit(x, y, w, h, () => { this.el.focus(); this.el.select(); });
    panel('grey', x, y, w, h);
    ptext('SAVE CODE', x + w / 2, y + 10, 'B', 'center');
    stext('Copying was blocked here: select the whole code and copy it.', x + w / 2, y + 33, 4.8, P.dark, 'center', 500);
    const bx = x + 16, by = y + 42, bw = w - 32, bh = 92, st = this.el.style;
    st.left = (M.ox + bx * M.s) / DPR + 'px'; st.top = (M.oy + by * M.s) / DPR + 'px';
    st.width = bw * M.s / DPR + 'px'; st.height = bh * M.s / DPR + 'px'; st.fontSize = Math.max(10, 4.4 * M.s / DPR) + 'px';
    textButton(this, 'red', x + w / 2 - 32, y + h - 28, 64, 21, 'Done', () => this.close());
    this.end();
  }
}
setInterval(() => { const el = document.getElementById('save-code'); if (el && !SCENES.some(sc => sc instanceof SaveCodeView)) el.remove(); }, 250);
