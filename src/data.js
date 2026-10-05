/* ==========================================================================
   Data: weapons, monsters, levels, quests
   ========================================================================== */
const ORANGE = [
  { name: 'Pistol',       tile: 0, price: 1,   dmg: 2,   rate: 3.5, speed: 250, spread: 3,  pellets: 1, mag: 8,  reload: 0.9, life: 0.8,  sfx: 'shoot-a', kind: 'bullet' },
  { name: 'Long Pistol',  tile: 1, price: 5,   dmg: 3,   rate: 3.5, speed: 290, spread: 2,  pellets: 1, mag: 10, reload: 0.9, life: 0.9,  sfx: 'shoot-b', kind: 'bullet' },
  { name: 'Blaster',      tile: 2, price: 15,  dmg: 3,   rate: 6,   speed: 270, spread: 4,  pellets: 1, mag: 18, reload: 1.0, life: 0.85, sfx: 'shoot-c', kind: 'laser' },
  { name: 'SMG',          tile: 4, price: 30,  dmg: 2.5, rate: 11,  speed: 300, spread: 8,  pellets: 1, mag: 32, reload: 1.2, life: 0.75, sfx: 'shoot-d', kind: 'bullet' },
  { name: 'Sniper',       tile: 3, price: 60,  dmg: 22,  rate: 1.3, speed: 520, spread: 0,  pellets: 1, mag: 5,  reload: 1.5, life: 0.9,  sfx: 'shoot-g', kind: 'tracer', pierce: 4 },
  { name: 'AK-47',        tile: 5, price: 90,  dmg: 5,   rate: 9,   speed: 360, spread: 5,  pellets: 1, mag: 30, reload: 1.3, life: 0.8,  sfx: 'shoot-e', kind: 'bullet' },
  { name: 'Plasma Rifle', tile: 6, price: 100, dmg: 9,   rate: 4,   speed: 230, spread: 3,  pellets: 1, mag: 16, reload: 1.4, life: 1.0,  sfx: 'shoot-f', kind: 'plasma', splash: 24 },
  { name: 'Shotgun',      tile: 7, price: 115, dmg: 5,   rate: 1.8, speed: 330, spread: 26, pellets: 8, mag: 6,  reload: 1.5, life: 0.45, sfx: 'shoot-h', kind: 'pellet' }
];
/* green set: the same guns from the teal row of the sheet, twice the price and twice the damage.
   It shows up in the armory once every orange gun is owned, and is bought in order. */
const ORANGE_N = ORANGE.length;
const WEAPONS = ORANGE.concat(ORANGE.map(w => ({ ...w, name: 'Green ' + w.name, tile: w.tile + 10, price: w.price * 2, dmg: w.dmg * 2, green: true })));
const allOrange = () => SAVE.owned.slice(0, ORANGE_N).every(Boolean);
const canBuy = wi => wi < ORANGE_N || (allOrange() && (wi === ORANGE_N || !!SAVE.owned[wi - 1]));
/* clearing Level 9 makes every weapon hit 1.5x harder and adds an automatic Long Pistol shot from the hero's body */
const dmgMul = () => (SAVE && SAVE.cleared[8] ? 1.5 : 1);
const hasAutoGun = () => !!(SAVE && SAVE.cleared[8]);
const AUTO_GUN = 1, AUTO_GUN_CD = 2; // Long Pistol, one shot every 2 seconds
/* Upgrade menu: three tracks of five levels, bought in order. Every track costs the same per level. */
const UPG_PRICES = [60, 100, 120, 140, 160];
const regenEvery = lvl => 8 - 1.5 * (lvl - 1);                    // seconds per 1 health
const fighterCd = lvl => Math.max(0.25, 2 - 0.5 * (lvl - 1));     // fighter knife cooldown (floored so it never hits 0)
const skillEvery = lvl => 10 - 2 * (lvl - 1);                     // seconds between strikes
const UPGRADES = [
  { key: 'regen', name: 'Regen', icon: ['tiles', 222], steps: ['Buy Regen', 'Faster Regen', 'Faster Regen', 'Faster Regen', 'Faster Regen'],
    info: l => (l ? `Heals 1 health every ${regenEvery(l)} s during battle.` : 'Slowly heals you during battle.'),
    step: i => (i === 0 ? 'Heal 1 health every 8 s during battle' : `Heal every ${regenEvery(i + 1)} s instead of ${regenEvery(i)} s`) },
  { key: 'fighter', name: 'Fighter', icon: ['players', 8], steps: ['Hire Fighter', 'Upgrade Fighter', 'Upgrade Fighter', 'Upgrade Fighter', 'Upgrade Fighter'],
    info: l => (l ? `Pip\u2019s twin hunts monsters with an orange knife every ${fighterCd(l)} s. It can\u2019t be hurt.` : 'A fighter that looks like Pip and hunts monsters with an orange knife.'),
    step: i => (i === 0 ? 'Joins every run, knife every 2 s, cannot be hurt' : `Knife every ${fighterCd(i + 1)} s instead of ${fighterCd(i)} s`) },
  { key: 'skill', name: 'Skill', icon: ['ui', 55], steps: ['Buy Skill', 'Upgrade Skill', 'Upgrade Skill', 'Upgrade Skill', 'Upgrade Skill'],
    info: l => (l ? `Every ${skillEvery(l)} s the toughest monster turns yellow and vanishes, gunners first. Not bosses.` : 'Makes the toughest monster vanish, gunners first. Not bosses.'),
    step: i => (i === 0 ? 'Every 10 s the toughest monster vanishes, gunners first' : `Every ${skillEvery(i + 1)} s instead of ${skillEvery(i)} s`) }
];
const KNIFE = { name: 'Knife', tile: 8, dmg: 2.5, rate: 2.5, range: 26, autoCd: 2 }; // autoCd: seconds between automatic strikes

const MONSTERS = {
  slime:  { name: 'Slime', plural: 'slimes', sheet: 'enemies', f: 0, hp: 4, speed: 26, dmg: 1, ai: 'chase' },
  bat:    { name: 'Bat', plural: 'bats', sheet: 'enemies', f: 4, hp: 4, speed: 56, dmg: 1, ai: 'fly' },
  imp:    { name: 'Ember Imp', plural: 'ember imps', sheet: 'enemies', f: 8, hp: 9, speed: 36, dmg: 1, ai: 'shoot', range: 100, cd: 2.4, shot: { speed: 105, n: 1, gap: 0, spread: 0, kind: 'fire' } },
  hound:  { name: 'Dust Hound', plural: 'dust hounds', sheet: 'players', f: 4, hp: 16, speed: 44, dmg: 1, ai: 'shoot', range: 120, cd: 4, gun: 10, shot: { speed: 160, n: 1, gap: 0, spread: 6, kind: 'ebullet' } },
  raider: { name: 'Raider Rabbit', plural: 'raider rabbits', sheet: 'players', f: 12, hp: 22, speed: 52, dmg: 1, ai: 'shoot', range: 110, cd: 4, gun: 14, shot: { speed: 170, n: 1, gap: 0, spread: 8, kind: 'ebullet' } }
};
const LEVEL_N = 15;
/* theme knobs: tP/tT purple & teal plateaus, bld buildings, plz plazas, yard fenced yards,
   pP/pT/pD purple, teal, dark-sand ground patches, cac cacti, rock rocks, bone bones, tree trees */
const THEMES = [
  { tP: 0, tT: 1, bld: 0, plz: 0, yard: 0, pP: 0, pT: 3, pD: 3, cac: 14, rock: 6, bone: 1, tree: 2 },
  { tP: 0, tT: 1, bld: 1, plz: 0, yard: 0, pP: 1, pT: 2, pD: 2, cac: 22, rock: 6, bone: 2, tree: 1 },
  { tP: 3, tT: 0, bld: 0, plz: 0, yard: 0, pP: 4, pT: 0, pD: 2, cac: 6, rock: 6, bone: 1, tree: 4 },
  { tP: 0, tT: 1, bld: 2, plz: 1, yard: 2, pP: 1, pT: 1, pD: 3, cac: 6, rock: 10, bone: 1, tree: 1 },
  { tP: 2, tT: 2, bld: 0, plz: 1, yard: 0, pP: 3, pT: 3, pD: 1, cac: 6, rock: 4, bone: 2, tree: 3 },
  { tP: 0, tT: 3, bld: 1, plz: 1, yard: 1, pP: 0, pT: 5, pD: 1, cac: 8, rock: 4, bone: 0, tree: 6 },
  { tP: 2, tT: 2, bld: 0, plz: 0, yard: 1, pP: 2, pT: 2, pD: 3, cac: 10, rock: 10, bone: 2, tree: 2 },
  { tP: 1, tT: 0, bld: 3, plz: 1, yard: 2, pP: 1, pT: 1, pD: 3, cac: 6, rock: 6, bone: 1, tree: 1 },
  { tP: 4, tT: 0, bld: 1, plz: 0, yard: 0, pP: 5, pT: 0, pD: 2, cac: 6, rock: 10, bone: 3, tree: 4 },
  { tP: 2, tT: 1, bld: 1, plz: 1, yard: 1, pP: 2, pT: 1, pD: 4, cac: 8, rock: 10, bone: 3, tree: 2 },
  { tP: 0, tT: 1, bld: 1, plz: 0, yard: 1, pP: 0, pT: 2, pD: 6, cac: 18, rock: 8, bone: 4, tree: 1 },
  { tP: 1, tT: 1, bld: 2, plz: 1, yard: 3, pP: 1, pT: 1, pD: 3, cac: 8, rock: 6, bone: 2, tree: 1 },
  { tP: 2, tT: 2, bld: 0, plz: 1, yard: 0, pP: 2, pT: 2, pD: 2, cac: 6, rock: 6, bone: 2, tree: 4 },
  { tP: 0, tT: 1, bld: 2, plz: 1, yard: 5, pP: 1, pT: 2, pD: 2, cac: 4, rock: 6, bone: 1, tree: 2 },
  { tP: 1, tT: 1, bld: 4, plz: 2, yard: 2, pP: 1, pT: 1, pD: 3, cac: 6, rock: 6, bone: 2, tree: 1 },
  { tP: 2, tT: 0, bld: 0, plz: 0, yard: 1, pP: 3, pT: 0, pD: 5, cac: 10, rock: 12, bone: 8, tree: 2 },
  { tP: 1, tT: 4, bld: 2, plz: 1, yard: 1, pP: 1, pT: 6, pD: 1, cac: 6, rock: 6, bone: 1, tree: 8 },
  { tP: 0, tT: 0, bld: 5, plz: 3, yard: 3, pP: 1, pT: 1, pD: 2, cac: 4, rock: 6, bone: 1, tree: 2 },
  { tP: 3, tT: 3, bld: 1, plz: 1, yard: 1, pP: 3, pT: 3, pD: 3, cac: 10, rock: 8, bone: 3, tree: 4 },
  { tP: 3, tT: 2, bld: 3, plz: 2, yard: 2, pP: 2, pT: 2, pD: 4, cac: 8, rock: 10, bone: 4, tree: 3 }
];
const EARLY_POOLS = [['slime'], ['slime'], ['slime', 'bat'], ['slime', 'bat'], ['slime', 'bat'], ['slime', 'bat', 'imp'], ['bat', 'imp', 'slime'], ['imp', 'slime', 'bat'], ['imp', 'bat', 'hound'], ['imp', 'bat', 'hound'], ['hound', 'imp', 'slime'], ['hound', 'imp', 'bat'], ['hound', 'raider', 'bat'], ['raider', 'hound', 'imp'], ['raider', 'hound'], ['raider', 'imp', 'bat', 'hound'], ['raider', 'hound', 'slime', 'imp'], ['raider', 'hound', 'imp'], ['raider', 'hound', 'imp', 'bat'], ['raider', 'hound', 'imp']];
const LEVEL_NAMES = ['Dusty Outskirts', 'Cactus Flats', 'Lavender Mesa', 'Old Scrapyard', 'Slime Hollow', 'Teal Oasis', 'Canyon Crossing', 'Rusty Outpost', 'Violet Badlands', 'Ember Ridge', 'Golden Dunes', 'Bandit Camp', 'Twin Plateaus', 'Chain-Link Maze', 'Tyrant\u2019s Throne'];
const LEVELS = LEVEL_NAMES.map((name, i) => {
  const L = i + 1, src = i === LEVEL_N - 1 ? THEMES.length - 1 : i; // the last level uses the final arena's theme and monsters
  return { name, w: 40 + Math.min(20, Math.floor(L * 0.6)), h: 28 + Math.min(12, Math.floor(L * 0.4)), pool: EARLY_POOLS[src], th: { ...THEMES[src] } };
});
/* gun-holding monsters (hounds, raiders) fire one bullet at a time and carry a better gun later on */
const ENEMY_GUNS = [
  { tile: 10, cd: 4, speed: 160, range: 120 }, // Levels 1-10: green pistol, at most one shot every 4 s
  { tile: 11, cd: 4, speed: 200, range: 150 }, // Levels 11-13: green long pistol, longer reach
  { tile: 12, cd: 2, speed: 190, range: 140 }  // Levels 14-15: green blaster (third stage), one shot every 2 s
];
const enemyGun = L => ENEMY_GUNS[L >= 14 ? 2 : L >= 11 ? 1 : 0];
/* every monster (bosses included) moves at 2/3 of its listed speed */
const MONSTER_SPEED = 2 / 3;
const BOSS_KINDS = [
  { type: 'slime', names: ['King Slime', 'Slime Colossus'], moves: ['charge', 'spawn', 'ring'] },
  { type: 'imp', names: ['Fire Lord', 'Inferno Imp'], moves: ['ring', 'aim', 'spawn'] },
  { type: 'hound', names: ['Bandit Chief', 'Hound Marshal'], moves: ['spread', 'spawn', 'aim', 'charge'] },
  { type: 'raider', names: ['Raider Warlord', 'Rabbit Overlord'], moves: ['spread', 'aim', 'charge', 'spawn'] },
  { type: 'bat', names: ['Bat Queen', 'Night Queen'], moves: ['ring', 'spawn', 'charge'] }
];
const BOSSES = {};
for (let L = 5; L <= LEVEL_N; L += 5) {
  const k = L / 5 - 1, K = BOSS_KINDS[k % 5];
  BOSSES[L] = { type: K.type, name: K.names[Math.floor(k / 5) % 2], hp: Math.round(140 + (L - 5) * 62), scale: 2, speed: 30 + L * 0.3, moves: K.moves };
}
BOSSES[LEVEL_N] = { type: 'raider', name: 'Sand Tyrant', hp: Math.round((140 + (LEVEL_N - 5) * 62) * 1.2), scale: 2.3, speed: 48, moves: ['ring', 'spread', 'spawn', 'charge', 'aim'] };
const levelCount = L => { const n = 6 + Math.round(0.9 * L); return BOSSES[L] ? Math.round(n * 0.7) : n; };
/* past Level 15 every monster, bosses included, has 1.5x health */
const lateHp = L => (L > 15 ? 1.5 : 1);
const hpMul = L => (1 + 0.08 * (L - 1)) * lateHp(L);
const enemyDmg = L => 1 + Math.min(2, Math.floor((L - 1) / 17));
const goldPerKill = L => (L <= 10 ? 3 : 5);
function highestUnlocked() { let u = 1; for (let i = 0; i < LEVEL_N; i++) if (SAVE.cleared[i]) u = Math.min(LEVEL_N, i + 2); return u; }
function bossName(L) { return BOSSES[L] ? BOSSES[L].name : ''; }

/* ---------------- quests ---------------- */
const NPCS = {
  cat:   { name: 'Mira', title: 'the Sheriff', sheet: 'players', f: 0 },
  mouse: { name: 'Pip',  title: 'the Trader',  sheet: 'players', f: 8 }
};
const MAX_TIER = 10;
const REASONS = {
  slime: [
    'Slimes oozed into the town water tank again. Everything tastes like goo.',
    'A slime swallowed the mayor’s hat during the parade. The town wants payback.',
    'Slime trails are eating through the caravan wheels. Clear them before the next convoy.'
  ],
  bat: [
    'Bats keep stealing shiny coins from the market stalls every night.',
    'Nobody in Dustwell has slept in a week. Those wings sound like sandpaper.',
    'The bats nest in the water pipes and chew the seals. The pumps are leaking.'
  ],
  imp: [
    'Ember imps set the cactus farm on fire. Twice.',
    'The imps are melting fence posts for fun. Our goats keep wandering off.',
    'An ember imp torched the post office. Three weeks of letters, gone.'
  ],
  hound: [
    'Dust hound bandits robbed the supply caravan at dawn.',
    'The hounds put a bounty on my whiskers. Time to return the favor.',
    'Dust hounds are charging a toll on the only road to the oasis.'
  ],
  raider: [
    'Raider rabbits are digging tunnels under the town walls.',
    'The raiders stole the town’s only compass. Now the scouts keep getting lost.',
    'Raider rabbits ambushed the doctor’s wagon. We need that medicine.'
  ],
  killAny: [
    'The desert is getting crowded with monsters. Thin them out before the caravan arrives.',
    'The scouts counted too many monsters near the trade road. Bring that number down.',
    'Harvest season starts soon, and the farmers won’t go out until the dunes are safer.'
  ],
  clear: [
    'Scouts lost contact with {lname}. Clear it so we can reopen the road.',
    'An old map marks a well in {lname}. Make it safe and we can dig.',
    'Travelers keep vanishing around {lname}. Go see what’s out there.'
  ],
  boss: [
    'The {boss} has been raiding our caravans for months. End it.',
    'Every monster out there answers to the {boss}. Take it down and the rest will scatter.'
  ],
  weapon: [
    'I just tuned the {weapon}. Field-test it on {n} monsters and tell me how it handles.',
    'A buyer wants proof the {weapon} works before paying. Show them with {n} clean takedowns.'
  ],
  flawless: [
    'Speed and caution keep a sheriff alive. Clear Level {lvl} or later while taking 3 hits or fewer.',
    'The new deputies need to see how it’s done. Clear Level {lvl} or later with 3 hits or fewer.'
  ],
  chests: [
    'My old supply chests are scattered all over the dunes. Open {n} before the raiders do.',
    'I hid my savings in chests and forgot where. Find {n} of them and we split the profit.',
    'The caravan dropped crates during the sandstorm. Open {n} chests and the guild will pay.'
  ],
  gold: [
    'The well needs a new pump. Bring back {n} gold worth of loot from the wild.',
    'Prices went up at the bazaar. Collect {n} gold on your runs and I’ll make it worth your while.',
    'The town is saving for a wall. Collect {n} gold out there and I’ll add a bonus.'
  ]
};
const CHATTER = {
  cat: ['Quiet day in Dustwell. Enjoy it while it lasts.', 'Keep your knife sharp and your canteen full.', 'I’ll have another job soon. The desert never sleeps.'],
  mouse: ['Business is slow. Monsters scare away customers.', 'Gold buys guns, guns buy safety. Simple math.', 'Come back later. I’m sorting through some new rumors.']
};
function questText(q) {
  const lv = q.lvl || 1;
  switch (q.type) {
    case 'kill': return { title: 'Hunt ' + MONSTERS[q.mon].plural, goal: `Defeat ${q.n} ${MONSTERS[q.mon].plural}` + (q.minL > 1 ? ` in Level ${q.minL} or later` : '') };
    case 'killAny': return { title: 'Thin the herd', goal: `Defeat ${q.n} monsters` + (q.minL > 1 ? ` in Level ${q.minL} or later` : '') };
    case 'clear': return { title: 'Reopen ' + LEVELS[lv - 1].name, goal: `Clear Level ${lv} or a later level` };
    case 'boss': return { title: 'Bounty: ' + bossName(lv), goal: `Defeat the ${bossName(lv)} in Level ${lv}` };
    case 'weapon': return { title: 'Field test', goal: `Defeat ${q.n} monsters with the ${WEAPONS[q.w].name}` };
    case 'flawless': return { title: 'Clean run', goal: `Clear Level ${lv} or later taking 3 hits or fewer` };
    case 'chests': return { title: 'Treasure hunt', goal: `Open ${q.n} chests` };
    case 'gold': return { title: 'Fundraiser', goal: `Collect ${q.n} gold during runs` };
  }
  return { title: 'Job', goal: '' };
}
function fillReason(s, q) {
  return s.replace('{n}', q.n).replace('{lvl}', q.lvl).replace('{lname}', q.lvl ? LEVELS[q.lvl - 1].name : '')
    .replace('{boss}', q.lvl ? bossName(q.lvl) : '').replace('{weapon}', q.w != null ? WEAPONS[q.w].name : '');
}
function monstersUpTo(L) { const s = new Set(); for (let i = 0; i < L; i++) LEVELS[i].pool.forEach(m => s.add(m)); return [...s]; }
function makeQuest(npcId) {
  const npc = SAVE.npcs[npcId], t = Math.min(npc.count, MAX_TIER);
  const r = rng(npc.count * 7919 + (npcId === 'cat' ? 17 : 911) + (SAVE.created % 100003));
  const unl = highestUnlocked();
  const tierL = clamp(Math.round(1 + 1.4 * t), 1, LEVEL_N);
  const lvl = Math.max(1, Math.min(tierL, unl + 1));
  let q;
  if (npc.count === 0 && npcId === 'cat') {
    q = { type: 'kill', mon: 'slime', n: 8, minL: 1, reason: 'Welcome to Dustwell, stranger. Slimes keep oozing into our water tank. Take your knife, head out and defeat 8 of them. They drop coins, so stop by the armory afterwards.' };
  } else if (npc.count === 0 && npcId === 'mouse') {
    q = { type: 'chests', n: 2, reason: 'Psst. My supply chests got scattered when the slimes chased my wagon. Open 2 of them out there and the finder’s fee is yours.' };
  } else {
    const types = npcId === 'cat' ? ['kill', 'killAny', 'clear', 'boss', 'weapon', 'flawless'] : ['chests', 'gold', 'clear', 'kill', 'weapon'];
    let tries = 0;
    while (!q && tries++ < 20) {
      const ty = pick(r, types);
      if (ty === 'kill') {
        const minL = Math.max(1, lvl - 3);
        const mons = new Set(); for (let i = minL - 1; i < lvl; i++) LEVELS[i].pool.forEach(m => mons.add(m));
        const mon = pick(r, [...mons]);
        q = { type: 'kill', mon, n: 6 + 3 * t, minL, reason: pick(r, REASONS[mon]) };
      } else if (ty === 'killAny') q = { type: 'killAny', n: 10 + 5 * t, minL: Math.max(1, lvl - 3), reason: pick(r, REASONS.killAny) };
      else if (ty === 'clear') q = { type: 'clear', lvl, reason: pick(r, REASONS.clear) };
      else if (ty === 'boss') {
        const bl = Math.max(5, Math.floor(Math.min(lvl, unl) / 5) * 5);
        if (t < 2 || bl > unl) continue;
        q = { type: 'boss', lvl: bl, reason: pick(r, REASONS.boss) };
      } else if (ty === 'weapon') {
        const have = SAVE.owned.map((o, i) => (o ? i : -1)).filter(i => i >= 0);
        if (!have.length) continue;
        const cap = Math.min(Math.round(t * 1.5), WEAPONS.length - 1), fit = have.filter(i => i <= cap);
        const w = fit.length ? fit[fit.length - 1] : have[0];
        q = { type: 'weapon', w, n: 10 + 3 * t, reason: pick(r, REASONS.weapon) };
      } else if (ty === 'flawless') { if (t < 1) continue; q = { type: 'flawless', lvl: Math.max(1, lvl - 2), reason: pick(r, REASONS.flawless) }; }
      else if (ty === 'chests') q = { type: 'chests', n: Math.min(2 + t, 12), reason: pick(r, REASONS.chests) };
      else if (ty === 'gold') q = { type: 'gold', n: 20 + 15 * t, reason: pick(r, REASONS.gold) };
    }
    if (!q) q = { type: 'killAny', n: 10 + 5 * t, minL: 1, reason: pick(r, REASONS.killAny) };
    q.reason = fillReason(q.reason, q);
  }
  const bonus = { clear: 6, boss: 20, flawless: 10, weapon: 4, gold: 0, chests: 0, kill: 0, killAny: 2 }[q.type] || 0;
  q.reward = Math.round(12 + 9 * t + bonus);
  q.tier = t; q.prog = 0; q.status = 'offered'; q.npc = npcId;
  if (q.type === 'clear' || q.type === 'boss' || q.type === 'flawless') q.n = 1;
  return q;
}
/* job timing: each animal has a 20-minute cooldown and they take turns 10 minutes apart,
   so a new job shows up every 10 minutes. Mira goes first whenever both are due
   (a fresh game, or coming back after a long break). Each keeps at most one open job. */
function jobDueAt(id) { return Math.max(SAVE.npcs[id].next, (SAVE.lastJobAt || 0) + STAGGER_MS); }
/* jobs saved before the campaign shrank may point past the last level */
function fixJobs() {
  for (const id of ['cat', 'mouse']) {
    const q = SAVE.npcs[id].quest; if (!q) continue;
    if (q.lvl > LEVEL_N) q.lvl = LEVEL_N;
    if (q.minL > LEVEL_N) q.minL = LEVEL_N;
    if (q.type === 'boss' && !BOSSES[q.lvl]) q.lvl = Math.max(5, Math.floor(q.lvl / 5) * 5);
  }
}
function questTick() {
  if (!SAVE) return;
  const now = Date.now();
  for (const id of ['cat', 'mouse']) {
    const n = SAVE.npcs[id];
    if (n.quest || now < jobDueAt(id)) continue;
    n.quest = makeQuest(id);
    n.next = Math.max(now, n.next) + QUEST_MS;
    SAVE.lastJobAt = now;
    if (Game.toast) Game.toast(NPCS[id].name + ' has a new job for you');
    persist();
    break;
  }
}
function questEvent(ev) {
  for (const id of ['cat', 'mouse']) {
    const q = SAVE.npcs[id].quest;
    if (!q || q.status !== 'active') continue;
    let inc = 0;
    switch (q.type) {
      case 'kill': if (ev.k === 'kill' && ev.mon === q.mon && ev.L >= (q.minL || 1)) inc = 1; break;
      case 'killAny': if (ev.k === 'kill' && ev.L >= (q.minL || 1)) inc = 1; break;
      case 'weapon': if (ev.k === 'kill' && ev.w === q.w) inc = 1; break;
      case 'clear': if (ev.k === 'clear' && ev.L >= q.lvl) inc = 1; break;
      case 'flawless': if (ev.k === 'clear' && ev.L >= q.lvl && ev.hits <= 3) inc = 1; break;
      case 'boss': if (ev.k === 'boss' && ev.L === q.lvl) inc = 1; break;
      case 'chests': if (ev.k === 'chest') inc = 1; break;
      case 'gold': if (ev.k === 'gold') inc = ev.n; break;
    }
    if (inc) {
      q.prog = Math.min(q.n, q.prog + inc);
      if (q.prog >= q.n) { q.status = 'done'; sfx('coin-d', 0.8); if (Game.toast) Game.toast('Job done! Visit ' + NPCS[id].name + ' for your reward'); }
    }
  }
}
const Game = { toast: null };
