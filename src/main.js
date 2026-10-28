// 食合物语 —— 启动器：装配配置 / 引擎 / 视图 / 存档 / 主循环
import { loadAll } from './config.js';
import { Game } from './engine.js';
import { View } from './view.js';
import { audio } from './audio.js';

const SAVE_KEY = 'owk.save.v1';
const UNLOCK_KEY = 'owk.hard.unlocked';
const CAT_KEY = 'owk.cats.v1'; // 局外：猫猫币 + 皮肤（跨局、跨周持久）
const ACH_KEY = 'owk.ach.v1'; // 局外：成就解锁列表（跨局持久）

const DEFAULT_CATS = { coins: 0, owned: ['orange'], skin: 'orange' };

const stage = document.getElementById('stage');
const rotateHint = document.getElementById('rotate-hint');

// 设计基准：高度固定，宽度按视口宽高比伸缩（数值来自 layout.json 的 fit 段）
let FIT = { height: 660, minAspect: 1120 / 660, maxAspect: 2.35 };
let stageW = 1120;

function fitStage() {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const aspect = Math.min(Math.max(vw / vh, FIT.minAspect), FIT.maxAspect);
  stageW = Math.round(FIT.height * aspect);
  const scale = Math.min(vw / stageW, vh / FIT.height);
  stage.style.width = stageW + 'px';
  stage.style.height = FIT.height + 'px';
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function isPortrait() {
  return window.innerHeight > window.innerWidth * 1.02;
}

let pausedByRotate = false;
let gameRef = null;
let viewRef = null;

// 竖屏（手机未横过来）时给出提示，并冻结计时，避免"看不见却在掉耐心"
function updateOrientation() {
  const portrait = isPortrait();
  if (rotateHint) rotateHint.classList.toggle('hidden', !portrait);
  if (!gameRef || !gameRef.s) return;
  if (portrait) {
    if (gameRef.s.phase === 'day' && !gameRef.s.paused && !viewRef.el.game.classList.contains('hidden')) {
      pausedByRotate = true;
      gameRef.togglePause();
    }
  } else if (pausedByRotate) {
    pausedByRotate = false;
    if (gameRef.s.paused) gameRef.togglePause();
    viewRef.closeModal();
  }
}

function onViewportChange() {
  fitStage();
  updateOrientation();
}

// 触屏设备上尝试锁定横屏（Android 有效；iOS 不支持，靠竖屏提示）
async function tryLandscapeLock() {
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) { /* 忽略：不支持就交给提示层 */ }
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略隐私模式写入失败 */ }
}

// ---------------------------------------------------------------- 存档码（导出 / 导入）
//
// 为什么要这个：存档全在 localStorage，而 localStorage **按域名隔离**。
// 换域名（GitHub Pages → 别的托管）、换浏览器、清站点数据，进度就彻底没了 ——
// 游戏没有账号、没有云同步，官方也没给任何备份途径。
// 这里产出一段可复制的「存档码」，用于备份与跨域名迁移。
//
// 格式：`OWK1.` + base64(JSON)。前缀既是版本标记，也用于拒绝明显不是存档码的输入。
const SAVE_KEYS = ['owk.cats.v1', 'owk.ach.v1', 'owk.hard.unlocked', 'owk.save.v1', 'owk.audio.v1'];
const SAVE_CODE_PREFIX = 'OWK1.';

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  // 分块拼接，避免超长存档时 String.fromCharCode(...bytes) 撑爆调用栈
  for (let i = 0; i < bytes.length; i += 0x2000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  }
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 把本地存档打包成一段可复制的存档码。 */
function exportSaveCode() {
  const data = {};
  for (const k of SAVE_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) data[k] = v;
  }
  const payload = { v: 1, at: new Date().toISOString(), keys: Object.keys(data).length, data };
  return SAVE_CODE_PREFIX + b64encode(JSON.stringify(payload));
}

/**
 * 把存档码写回本地。
 * 只接受「品牌前缀 + 可解析 JSON + 每个值本身仍是合法 JSON」的输入，
 * 免得把一段乱码写进 localStorage 反而把存档弄坏。
 */
function importSaveCode(code) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (!raw.startsWith(SAVE_CODE_PREFIX)) return { ok: false, reason: 'badCode' };
  let payload;
  try { payload = JSON.parse(b64decode(raw.slice(SAVE_CODE_PREFIX.length))); } catch (e) {
    return { ok: false, reason: 'badCode' };
  }
  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    return { ok: false, reason: 'badCode' };
  }
  // 先全部校验，再统一写入 —— 半途失败会留下「一半新一半旧」的坏状态
  const pending = [];
  for (const k of SAVE_KEYS) {
    const v = payload.data[k];
    if (typeof v !== 'string') continue;
    try { JSON.parse(v); } catch (e) { return { ok: false, reason: 'badCode' }; }
    pending.push([k, v]);
  }
  if (!pending.length) return { ok: false, reason: 'badCode' };
  let n = 0;
  for (const [k, v] of pending) {
    try { localStorage.setItem(k, v); n++; } catch (e) { /* 隐私模式忽略 */ }
  }
  return { ok: true, count: n };
}

async function boot() {
  fitStage();
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(onViewportChange, 220));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

  let ctx;
  try {
    ctx = await loadAll();
  } catch (err) {
    // 错误信息可能来自网络/JSON，直接拼进 innerHTML 会被当成标签解析（L21）
    stage.innerHTML = `<div class="boot-err">
      <h2>配置加载失败</h2>
      <p id="boot-err-msg"></p>
      <p>请通过本地 HTTP 服务打开（如 <code>node server.mjs</code> 或 <code>npx serve</code>），不要直接双击 file:// 打开。</p>
    </div>`;
    const msgEl = document.getElementById('boot-err-msg');
    if (msgEl) msgEl.textContent = String(err.message || err);
    console.error(err);
    return;
  }

  const fit = (ctx.layout && ctx.layout.fit) || {};
  FIT = {
    height: fit.height || 660,
    minAspect: fit.minAspect || 1120 / 660,
    maxAspect: fit.maxAspect || 2.35,
  };
  fitStage();

  const game = new Game(ctx);
  audio.loadState();
  const unlockAudio = () => { audio.unlock(); document.removeEventListener('pointerdown', unlockAudio); document.removeEventListener('keydown', unlockAudio); };
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  const save = readJSON(SAVE_KEY, null);
  const unlocked = readJSON(UNLOCK_KEY, false);
  game.hardUnlocked = !!(unlocked || (save && save.hardUnlocked));
  game.tutorialDone = !!(save && save.tutorialDone);

  const view = new View(ctx, game, stage);
  view.mount();
  gameRef = game;
  viewRef = view;
  setTimeout(updateOrientation, 60);

  // ---------------------------------------------------------- 局外猫猫币存档
  const readCats = () => {
    const raw = readJSON(CAT_KEY, null);
    const st = Object.assign({}, DEFAULT_CATS, raw || {});
    if (!Array.isArray(st.owned) || !st.owned.length) st.owned = ['orange'];
    if (!st.owned.includes(st.skin)) st.skin = st.owned[0];
    return st;
  };
  let cats = readCats();
  const saveCats = () => writeJSON(CAT_KEY, cats);

  const readAch = () => {
    const raw = readJSON(ACH_KEY, null);
    return { unlocked: Array.isArray(raw && raw.unlocked) ? raw.unlocked : [], counters: (raw && raw.counters) || {} };
  };
  let ach = readAch();
  cats.ach = ach;
  view.setCatStore(cats);
  view.onCatStore = (store) => {
    cats = Object.assign({}, cats, store);
    cats.ach = ach;
    saveCats();
    // 买/换皮肤后必须刷新成就系数，否则当日日结用的还是购买前的皮肤数快照（M3）
    refreshAchExtra();
  };

  // 成就判定所需的跨局数据（累计订单/营业额/VIP/皮肤/主题）
  const DEFAULT_SKIN = (ctx.config.catSkins && ctx.config.catSkins.defaultSkin) || 'orange';
  const refreshAchExtra = () => {
    const owned = Array.isArray(cats.owned) ? cats.owned : [DEFAULT_SKIN];
    game.achExtra = {
      unlocked: ach.unlocked,
      totals: ach.counters,
      ownedSkins: owned.length,
      // 「装修队」统计的是**非默认**皮肤数：默认皮肤不存在「买过主题」这回事（M3）
      ownedThemes: owned.filter((id) => id !== DEFAULT_SKIN).length,
    };
  };
  refreshAchExtra();
  audio.setBgm('home'); // 主页 BGM

  /**
   * 把本局成就计数器合并进跨局存档 ach.counters（M2）
   *
   * 幂等方案：用 WeakMap 记住「某个 s.ach 对象已经被合并到哪个偏移量」，
   * 每次只合并增量（本次值 − 已合并值），因此重复调用不会重复累加。
   *
   * 合并时机：只在**开始新局前**调用一次（此时上一局确定结束）。
   * - 读档（继续上次）不合并：存档里的 s.ach 与本局计数器是同一份数据，先合并再读档会重复计入；
   * - 本局尚未合并的部分随 snapshot 一起存盘，读档时原样恢复，等这一局真正结束时再合并；
   * - 于是引擎侧恒有「tot（已结束的局）+ c（本局）」的口径，`ach_orders_100` / `ach_revenue_2000` /
   *   `ach_vip_10` 这类跨局累计成就在多局之间终于可达（M2）。
   */
  const achFlushed = new WeakMap();
  const flushAchCounters = () => {
    const a = game.s && game.s.ach;
    if (!a) return false;
    const prev = achFlushed.get(a) || { orders: 0, revenue: 0, vip: 0, trash: 0, bigOrders: 0, deliveries: 0, crossDay: 0, maxStorage: 0 };
    const counters = ach.counters;
    const sumKeys = ['orders', 'revenue', 'vip', 'trash', 'bigOrders', 'deliveries', 'crossDay'];
    let changed = false;
    for (const k of sumKeys) {
      const delta = (a[k] || 0) - (prev[k] || 0);
      if (delta > 0) {
        counters[k] = (counters[k] || 0) + delta;
        changed = true;
      }
    }
    // maxStorage 是「峰值」而非可累加的增量，取全局最大值
    if ((a.maxStorage || 0) > (counters.maxStorage || 0)) {
      counters.maxStorage = a.maxStorage;
      changed = true;
    }
    achFlushed.set(a, {
      orders: a.orders || 0, revenue: a.revenue || 0, vip: a.vip || 0,
      trash: a.trash || 0, bigOrders: a.bigOrders || 0,
      deliveries: a.deliveries || 0, crossDay: a.crossDay || 0,
      maxStorage: a.maxStorage || 0,
    });
    if (changed) writeJSON(ACH_KEY, ach);
    return changed;
  };

  // 音频与主题：暴露给视图，主题跨局持久
  window.__OWK_AUDIO__ = audio;
  // 旧版独立主题 id → 皮肤 id 迁移（主题已并入皮肤）
  const LEGACY_THEME_TO_SKIN = {
    default: 'orange', midnight: 'black', sakura: 'calico',
    seaside: 'blue', foodcourt: 'lucky', space: 'xiaoguai', snow: 'siamese',
  };
  if (!cats.skin && cats.theme) cats.skin = LEGACY_THEME_TO_SKIN[cats.theme] || 'orange';
  if (!cats.skin) cats.skin = 'orange';
  view.applyTheme(cats.skin);

  const persist = () => {
    const snap = game.snapshot();
    if (snap) writeJSON(SAVE_KEY, snap);
    writeJSON(UNLOCK_KEY, game.hardUnlocked);
  };
  view.onSave = persist;

  const startScreen = () => {
    view.showGame();
    view.render();
    persist();
    if (game.s.tutorial.active) view.openRecipe();
  };

  view.onStart = (mode) => {
    tryLandscapeLock();
    flushAchCounters(); // 上一局的累计计数器在这里定稿，新局从 0 起算（避免重复累加）
    game.newRun(mode, 1);
    audio.setBgm('day');
    audio.setRain(game.s.weather === 'rain');
    startScreen();
  };

  view.onContinue = () => {
    const s = readJSON(SAVE_KEY, null);
    if (!s) return;
    tryLandscapeLock();
    // 注意：这里**不能** flushAchCounters()。存档里的 s.ach 就是本局计数器本身，
    // 先合并再读档会让同一批成交同时在 counters 与本局计数器里出现（重复计入）。
    let resumed = false;
    try {
      resumed = game.resume(s);
    } catch (err) {
      // 脏存档不得让「继续上次」整条路径瘫痪：降级为开新局，并清掉坏档
      console.error('[OWK] 读档失败，已降级为新开一局', err);
    }
    if (!resumed) {
      flushAchCounters(); // 旧局（若有）在内存里定稿，再开新局
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 隐私模式忽略 */ }
      game.newRun(s.mode === 'hard' ? 'hard' : 'normal', 1);
    }
    audio.setBgm('day');
    audio.setRain(game.s.weather === 'rain');
    startScreen();
  };

  view.onQuit = () => {
    persist();
    view.showMenu(!!readJSON(SAVE_KEY, null), game.hardUnlocked);
    view.bindMenu = null;
  };

  // ---------------------------------------------------------- 引擎事件
  game.on('change', () => view.render());
  // 音效触发（表现层，不影响逻辑）
  game.on('served', () => audio.play('order_done'));
  game.on('lost', () => audio.play('order_expired'));
  game.on('craftFail', () => audio.play('ingredient_wrong'));
  game.on('dayEnd', () => audio.play('weather_change'));
  // M7：引擎已发但此前全代码库无订阅的事件，补上接线
  game.on('craftDone', () => audio.play('step_done')); // 合成完成：最高频的正反馈
  game.on('upgraded', () => audio.play('purchase')); // 设备升级成功
  game.on('trash', () => audio.play('ingredient_wrong')); // 丢弃（复用现有 preset，不新增音频）
  game.on('dayTimeUp', () => audio.play('order_expired')); // 收摊：沿用"结束"听感，无专用收摊音
  // game.on('combine', ...) 有意不订阅：它只表示「配方匹配成功、开始读条」，
  // 与 craftDone 相隔一个读条时间，接音效会和键盘声叠成噪音；统计也不需要（本局数据都能从 state 取）。
  game.on('deliveryPreview', () => audio.play('delivery_ring'));
  game.on('deliveryRiderArrived', () => {
    audio.play('rider_bell');
    view.toast(ctx.t('delivery.riderHere'), 2200); // 屏幕明确提示
  });
  game.on('deliveryPickedUp', () => {
    audio.play('delivery_missed');
    view.toast(ctx.t('delivery.sending'), 1800); // v2.8：交付后明确提示「骑手开始配送」
  });
  game.on('deliveryDone', () => audio.play('delivery_done'));
  game.on('achievement', () => audio.play('achievement'));
  game.on('catCoin', () => {}); // 猫币只走 toast，不另发音
  game.on('served', (d) => {
    view.toast(`+${d.earned + d.bonus}`);
  });
  game.on('lost', (d) => {
    view.toast(d.dismissed ? ctx.t('toast.dismissed') : ctx.t('toast.lost'));
  });
  game.on('craftFail', () => {
    view.toast(ctx.t('craft.fail'));
  });
  // 成就达成：加猫猫币 + toast + 落盘
  game.on('achievement', (list) => {
    for (const a of list) {
      if (!ach.unlocked.includes(a.id)) ach.unlocked.push(a.id);
      cats.coins += a.reward || 0;
    }
    writeJSON(ACH_KEY, ach);
    saveCats();
    cats.ach = ach;
    view.setCatStore(cats);
    refreshAchExtra();
    view.showAchievements(list);
  });
  // 猫猫币：每天营业 / 平安一周时由引擎发放，这里累加并落盘（结算弹窗里已有明示，不另弹 toast）
  game.on('catCoin', (d) => {
    cats.coins += d.amount;
    saveCats();
    view.setCatStore(cats);
  });
  game.on('dayEnd', (stats) => {
    persist();
    audio.setBgm('home');
    audio.setRain(false);
    view.showDayEnd(stats);
  });
  game.on('weekEnd', (w) => {
    persist();
    view.showWeekEnd(w);
  });
  game.on('bankrupt', (w) => {
    persist();
    view.showBankrupt(w);
  });

  // 暂停：BGM 压低 + 雨声停止；恢复后还原
  game.on('pause', () => audio.duck(true));
  game.on('resume', () => { audio.duck(false); if (game.s && game.s.phase === 'day') audio.setRain(game.s.weather === 'rain'); });
  // 天气变化时切换雨声
  game.on('change', () => {
    if (game.s && game.s.phase === 'day') audio.setRain(game.s.weather === 'rain');
  });
  // 页面隐藏时挂起音频
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else audio.resume();
  });
  // ---------------------------------------------------------- 主循环
  let last = performance.now();
  let acc = 0;
  let errStreak = 0; // 连续异常帧数
  const ERR_LIMIT = 60; // 连续 60 帧异常才熔断，避免偶发错误直接停服
  let errFatal = false;
  function loop(now) {
    let dt = now - last;
    last = now;
    if (dt > 120) dt = 120; // 切页回来别一次性扣光耐心
    try {
      game.tick(dt);
      acc += dt;
      if (acc > 40) { view.frame(); acc = 0; }
      errStreak = 0;
    } catch (err) {
      // 单帧异常不得终止 requestAnimationFrame 链（否则整局静止且不再渲染），
      // 但也不能无限刷屏：每 30 帧打印一次，连续超限才熔断并提示一次（M17）
      errStreak += 1;
      if (errStreak === 1 || errStreak % 30 === 0) console.error('[OWK] 主循环异常（已跳过该帧）', err);
      if (errStreak > ERR_LIMIT) {
        if (!errFatal) {
          errFatal = true;
          console.error(`[OWK] 连续 ${errStreak} 帧异常，渲染循环已停止`);
          // 提示本身也不允许再抛错（否则会在 catch 里再抛，彻底失去降级机会）
          try { view.toast(ctx.t('toast.runtimeError'), 8000); } catch (e) { /* 忽略 */ }
        }
        return; // 熔断：不再排下一帧
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------------------------------------------------------- 页面隐藏自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.s && game.s.phase === 'day' && !game.s.paused && !view.el.game.classList.contains('hidden')) {
      view.togglePause(); // 切走即冻结，回来时看到暂停面板
    }
  });
  window.addEventListener('beforeunload', persist);

  view.showMenu(!!save, game.hardUnlocked);

  // 便于自动化测试
  window.__OWK__ = { ctx, game, view, exportSaveCode, importSaveCode };
}

boot();
