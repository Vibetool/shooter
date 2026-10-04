/* ==========================================================================
   Boot & main loop
   ========================================================================== */
async function boot(hotData) {
  const local = loadLocal(), hot = hotData && hotData.save;
  SAVE = normalizeSave(hot && (!local || (hot.savedAt || 0) >= (local.savedAt || 0)) ? hot : local);
  if (!SAVE.savedAt) persist();
  await loadImages();
  makeWhite('enemies'); makeWhite('players');
  makeTint('enemies', 'Y', 'rgba(255,214,64,0.72)'); makeTint('players', 'Y', 'rgba(255,214,64,0.72)');
  buildGlyphs();
  try { await Promise.race([document.fonts.load('600 20px Poppins'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* fallback font */ }
  calibrateFont();
  const bootEl = document.getElementById('boot'); if (bootEl) bootEl.remove();
  questTick();
  setScene(new Home());
  Cloud.init();
  setInterval(questTick, 1000);
  let last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    try {
      for (const s of SCENES.slice()) if (s.update) s.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const s of SCENES.slice()) s.draw();
      drawToasts(dt);
    } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
(function start() {
  const H = window.claude && window.claude.hot;
  try { if (H && H.snapshot) H.snapshot(() => ({ save: SAVE })); } catch (e) { /* viewer hook unavailable */ }
  if (H && H.ready) H.ready(boot); else boot((H && H.data) || {});
})();
