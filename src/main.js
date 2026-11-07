// 食合物语 —— 启动器：装配配置 / 引擎 / 视图 / 存档 / 主循环
import { loadAll } from './config.js';
import { Game } from './engine.js';
import { View } from './view.js';
import { audio } from './audio.js';

const SAVE_KEY = 'owk.save.v1';
const UNLOCK_KEY = 'owk.hard.unlocked';
const CAT_KEY = 'owk.cats.v1'; // 局外：猫猫币 + 皮肤（跨局、跨周持久）
const ACH_KEY = 'owk.ach.v1'; // 局外：成就解锁列表（跨局持久）
const BANKRUPT_KEY = 'owk.lastBankrupt.v1'; // 上一局破产的周数：只在主页提示一次

const DEFAULT_CATS = { coins: 0, owned: ['orange'], skin: 'orange' };

const stage = document.getElementById('stage');
const safeLayer = document.getElementById('safe');
const rotateHint = document.getElementById('rotate-hint');

// ---------------------------------------------------------------- 画布分档（v2.20.0）
//
// 设计基准：高度固定，宽度按视口宽高比伸缩（数值来自 layout.json 的 fit 段）。
//
// **为什么要分档**：原实现把 height=660 写死，手机横屏（如 844×390）只能把这 660
// 等比压到 390，缩放系数 390/660 = 0.591 —— 全站元素都缩到设计值的 59%，
// 实测 89.5% 的可点元素小于 44px（合成台格位 42.5、HUD 按钮高 23.6、气泡 × 14.2）。
// 手机横屏是绝大多数玩家真正在用的姿态，所以给它一条「紧凑档」：
// 逻辑高 600（缩放 390/600 = 0.650，+10%），同时用 style.css 里的
// @media (max-height: 500px) 把关键控件放大。平板（1024×768）与桌面（1440×900）
// 的视口高 ≥ 500，继续走基准档，scale 与改前完全一致（0.914 / 1.286）。
const FIT_BASE = { height: 660, minAspect: 1120 / 660, maxAspect: 2.35 };
const FIT_COMPACT = { height: 600, minAspect: 1120 / 600, maxAspect: 2.35 };
/** 视口高低于此值视为「手机横屏」→ 紧凑档。与 style.css 的媒体查询阈值必须一致 */
const COMPACT_MAX_HEIGHT = 500;

// 【有意为之，勿当 bug 修】紧凑档的 minAspect 是 1120/600，而 1120 是布局能容下的最小逻辑宽
// （HUD 一行 + 操作列 470 + 仓储行都是按这个宽度排的）。宽度不足的机型（如 667×375）会被
// 这个下界卡住：scale = 667/1120 = 0.596，舞台高只有 357 < 375，于是上下各留 8.8px 黑边。
// 这是「要么留黑边、要么压坏 HUD 与仓储行」的二选一，已定留黑边。

let fitBase = { ...FIT_BASE };   // layout.json 提供的基准档（配置可覆盖）
let FIT = { ...FIT_BASE };       // 当前**生效**的档位（按视口高在基准 / 紧凑之间切换）
let stageW = 1120;
let stageScale = 1;
let stageCompact = false;

/**
 * 按当前视口高选择档位。只算「该用哪一档」，不改 DOM —— 真正的尺寸写入在 fitStage()。
 * 同时把档位写到 <html data-fit="compact|base">，便于自动化测试与排查直读。
 * @returns {boolean} 是否处于紧凑档
 */
function pickFit() {
  // 用 window.innerHeight 而不是 #safe 的高度：档位是「设备姿态」的语义，
  // 刘海内缩（几十 px）不应该把一台平板从基准档推到紧凑档。
  const compact = window.innerHeight < COMPACT_MAX_HEIGHT;
  FIT = compact
    ? { height: FIT_COMPACT.height, minAspect: FIT_COMPACT.minAspect, maxAspect: fitBase.maxAspect }
    : { height: fitBase.height, minAspect: fitBase.minAspect, maxAspect: fitBase.maxAspect };
  stageCompact = compact;
  document.documentElement.dataset.fit = compact ? 'compact' : 'base';
  return compact;
}

/**
 * 舞台可用的物理像素尺寸。
 * **必须取安全区包裹层**（#safe）的实际尺寸：桌面 / 平板 env() 恒为 0，#safe 等于视口，
 * 与改动前完全一致；手机横屏有刘海时 #safe 已经内缩，用 innerWidth/innerHeight 算出来的
 * 可用区还是满屏，内缩就白做了（游戏区会被刘海压住）。
 * @returns {{vw: number, vh: number}}
 */
function stageViewport() {
  const w = safeLayer ? safeLayer.clientWidth : 0;
  const h = safeLayer ? safeLayer.clientHeight : 0;
  return {
    vw: Math.max(1, w || window.innerWidth),
    vh: Math.max(1, h || window.innerHeight),
  };
}

function fitStage() {
  const { vw, vh } = stageViewport();
  pickFit();
  const aspect = Math.min(Math.max(vw / vh, FIT.minAspect), FIT.maxAspect);
  stageW = Math.round(FIT.height * aspect);
  const scale = Math.min(vw / stageW, vh / FIT.height);
  stage.style.width = stageW + 'px';
  stage.style.height = FIT.height + 'px';
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stageScale = scale;
}

/** 当前画布档位的只读快照（自动化测试 / 排查用） */
function fitInfo() {
  return {
    compact: stageCompact,
    height: FIT.height,
    minAspect: FIT.minAspect,
    maxAspect: FIT.maxAspect,
    stageW,
    scale: stageScale,
    viewport: stageViewport(),
  };
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
 * 把玩家粘贴进来的文本洗成纯码。
 * 真实场景里从聊天软件 / 备忘录复制，常带上换行、全角空格、零宽字符，
 * 直接 startsWith('OWK1.') 会误判成「码坏了」。base64 本身不含空白，去掉是安全的。
 */
function cleanSaveCode(code) {
  return String(code == null ? '' : code).replace(/[\s\u200b-\u200d\ufeff]/g, '');
}

/**
 * 只解析、不写入。给导入弹层做实时校验与预览用（写盘要走 importSaveCode）。
 * 只接受「品牌前缀 + 可解析 JSON + 每个值本身仍是合法 JSON」的输入。
 */
function decodeSaveCode(code) {
  const raw = cleanSaveCode(code);
  if (!raw) return { ok: false, reason: 'empty' };
  if (!raw.startsWith(SAVE_CODE_PREFIX)) return { ok: false, reason: 'badPrefix' };
  let payload;
  try { payload = JSON.parse(b64decode(raw.slice(SAVE_CODE_PREFIX.length))); } catch (e) {
    return { ok: false, reason: 'badCode' };
  }
  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    return { ok: false, reason: 'badCode' };
  }
  // 先全部校验，再统一写入 —— 半途失败会留下「一半新一半旧」的坏状态
  const entries = [];
  for (const k of SAVE_KEYS) {
    const v = payload.data[k];
    if (typeof v !== 'string') continue;
    try { JSON.parse(v); } catch (e) { return { ok: false, reason: 'badCode' }; }
    entries.push([k, v]);
  }
  if (!entries.length) return { ok: false, reason: 'badCode' };
  return { ok: true, entries, at: typeof payload.at === 'string' ? payload.at : '' };
}

/** 给 UI 的预览结果：解析出「这份码里有什么」，不写盘 */
function inspectSaveCode(code) {
  const r = decodeSaveCode(code);
  if (!r.ok) return r;
  return { ok: true, keys: r.entries.map((e) => e[0]), at: r.at };
}

/** 把存档码写回本地。校验全部通过才写，避免「一半新一半旧」。 */
function importSaveCode(code) {
  const r = decodeSaveCode(code);
  if (!r.ok) return r;
  let n = 0;
  for (const [k, v] of r.entries) {
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
  // layout.json 只提供**基准档**；紧凑档的高度 / 宽高比是设备姿态决定的常量（见文件头）
  fitBase = {
    height: fit.height || FIT_BASE.height,
    minAspect: fit.minAspect || FIT_BASE.minAspect,
    maxAspect: fit.maxAspect || FIT_BASE.maxAspect,
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
  // view.applyLayout() 会把 layout.json 的 fit.height（660）写回 stage.style.height，
  // 紧凑档下必须再按「当前生效档位」覆盖一次，否则手机会被撑回 660。
  fitStage();
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
   * - `catCoins`（累计猫币，`ach_cat_30` 的判据）同样走这条路径，但来源是 `s.catEarned`
   *   而不是 `s.ach`（见 achCountersNow）——此前它从来没被累加过，导致该成就永不可达。
   */
  const achFlushed = new WeakMap();
  /**
   * 本局计数器的「当前值」快照
   *
   * 绝大多数计数器直接住在 `s.ach` 上，但**本局累计猫猫币**是引擎发币时写的
   * `s.catEarned`（打烊 / 周结 / 周结金币奖励三处），并不在 `s.ach` 对象上。
   * 因此这里在快照时把它映射成 `catCoins` 字段，让它和其它计数器走同一套
   * 「当前值 − 已合并值 = 增量」的幂等合并逻辑（见下）。
   * @returns {object|null} 没有进行中的对局时返回 null
   */
  const achCountersNow = () => {
    const s = game.s;
    const a = s && s.ach;
    if (!a) return null;
    return { ...a, catCoins: Math.max(0, s.catEarned || 0) };
  };
  const flushAchCounters = () => {
    const a = game.s && game.s.ach;
    const cur = achCountersNow();
    if (!a || !cur) return false;
    // catCoins 必须出现在 prev 里：否则每次 flush 都会把「本局累计猫币」整额再加一遍
    const prev = achFlushed.get(a) || {
      orders: 0, revenue: 0, vip: 0, trash: 0, bigOrders: 0,
      deliveries: 0, crossDay: 0, maxStorage: 0, catCoins: 0,
    };
    const counters = ach.counters;
    const sumKeys = ['orders', 'revenue', 'vip', 'trash', 'bigOrders', 'deliveries', 'crossDay', 'catCoins'];
    let changed = false;
    for (const k of sumKeys) {
      const delta = (cur[k] || 0) - (prev[k] || 0);
      if (delta > 0) {
        counters[k] = (counters[k] || 0) + delta;
        changed = true;
      }
    }
    // maxStorage 是「峰值」而非可累加的增量，取全局最大值
    if ((cur.maxStorage || 0) > (counters.maxStorage || 0)) {
      counters.maxStorage = cur.maxStorage;
      changed = true;
    }
    achFlushed.set(a, {
      orders: cur.orders || 0, revenue: cur.revenue || 0, vip: cur.vip || 0,
      trash: cur.trash || 0, bigOrders: cur.bigOrders || 0,
      deliveries: cur.deliveries || 0, crossDay: cur.crossDay || 0,
      maxStorage: cur.maxStorage || 0, catCoins: cur.catCoins || 0,
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

  // 导入存档码后要 location.reload()，而 reload 会触发 beforeunload → persist()，
  // 用内存里的旧状态把刚导入的键覆盖回去（实测：皮肤生效、困难解锁被回滚成 false）。
  // 导入成功时调 suppressPersist() 关掉这条写入路径。
  let persistSuppressed = false;
  const persist = () => {
    if (persistSuppressed) return;
    // 终局不落盘：破产那局已经结束，写进存档只会让下次「继续上次」回到一个负金币的周
    if (game.s && game.s.phase === 'bankrupt') return;
    const snap = game.snapshot();
    if (snap) writeJSON(SAVE_KEY, snap);
    writeJSON(UNLOCK_KEY, game.hardUnlocked);
  };
  view.onSave = persist;

  /**
   * 主页渲染：顺便把「上一局破产」的提示读出来（只显示一次，显示后立刻清掉），
   * 否则玩家看到金币/设备被清零会以为数据丢了。
   */
  const showMenuWithNote = () => {
    const note = readJSON(BANKRUPT_KEY, null);
    view.showMenu(!!readJSON(SAVE_KEY, null), game.hardUnlocked, note && note.week ? note.week : 0);
    if (note) { try { localStorage.removeItem(BANKRUPT_KEY); } catch (e) { /* 隐私模式忽略 */ } }
  };

  const startScreen = () => {
    view.showGame();
    view.render();
    persist();
    if (game.s.tutorial.active) view.openRecipe();
    // 开门招呼只在非教学局弹：教学局会立刻弹配方书，toast 会被弹层盖住
    else view.toast(ctx.t('toast.started'), 2000);
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
    showMenuWithNote();
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
  game.on('trash', (d) => {
    audio.play('ingredient_wrong'); // 丢弃（复用现有 preset，不新增音频）
    // 垃圾桶升级的返还：丢一件返成本的一部分，钱少但看得见，给玩家一个正反馈
    if (d && d.refund > 0) view.toast(`+${d.refund}`, 900);
  });
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
    // 本局结束：先把存档删掉，再弹清算面板。
    // 回主页后「继续上次」应当是灰的，且下一次开局由 newRun 把金币/设备全部归零。
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 隐私模式忽略 */ }
    writeJSON(BANKRUPT_KEY, { week: w.week || 1 });
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
  // 局中定时落盘（v2.20.0）：原来只有「开局 / 日结 / 周结 / 破产 / 回主页 / 关页」六个点写盘，
  // 局中完全不写。玩家在营业中直接划掉 App（WebView 被系统回收）就会丢掉整天的进度。
  // 复用现成的帧循环计时，不新开 setInterval（避免多一条需要清理的定时器链路）；
  // 10 秒是上限，再密就是 localStorage 写放大，反而拖慢手机。
  const PERSIST_INTERVAL_MS = 10000;
  let lastPersist = performance.now();
  function loop(now) {
    let dt = now - last;
    last = now;
    if (dt > 120) dt = 120; // 切页回来别一次性扣光耐心
    try {
      game.tick(dt);
      acc += dt;
      if (acc > 40) { view.frame(); acc = 0; }
      if (now - lastPersist >= PERSIST_INTERVAL_MS) {
        lastPersist = now;
        // 只在「真正在营业」时落盘：暂停 / 结算 / 回主页都不写（状态没变，没必要写放大）
        if (game.s && game.s.phase === 'day' && !game.s.paused && !view.el.game.classList.contains('hidden')) {
          persist();
        }
      }
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
    if (!document.hidden) return;
    // v2.20.0：切后台 / 被系统回收之前先落盘，再暂停。
    // 原来只暂停不保存 —— 手机息屏后回来看到的是暂停面板，但如果进程被回收，
    // 这一整天的营业进度就没了（局中本来完全不写盘）。
    persist();
    if (game.s && game.s.phase === 'day' && !game.s.paused && !view.el.game.classList.contains('hidden')) {
      view.togglePause(); // 切走即冻结，回来时看到暂停面板
    }
  });
  window.addEventListener('beforeunload', persist);
  // pagehide 覆盖「进后台被直接回收」这条路径（iOS 上 beforeunload 常不触发）
  window.addEventListener('pagehide', persist);

  // ---------------------------------------------------------- 返回键（v2.20.0）
  //
  // 问题：APK / WebView / 独立 PWA 里，系统返回键默认直接把 App 关掉。
  // 局中按一下就退回桌面，玩家会以为「进度全丢了」（其实刚才那 10s 内可能还没落盘）。
  //
  // 做法：先用 pushState 压一条历史基线 —— 没有基线，popstate 根本不会派发。
  //   · 局中按返回 → 重新压基线（连按两次也不会退出）+ persist() + 二次确认；
  //                 确认回主页，取消留在局中。
  //   · 主页 / 结算 / 破产按返回 → 不拦截（消费掉基线后不再续压，下一次返回就真退出）。
  const BACK_STATE = { owk: 'guard' };
  let backArmed = false;
  const armBackGuard = () => {
    if (backArmed) return;
    try {
      history.pushState(BACK_STATE, '');
      backArmed = true;
    } catch (e) { /* 受限环境（部分 WebView / 隐私模式）忽略 */ }
  };

  const onBack = () => {
    const inGame = !!(game.s && game.s.phase === 'day' && !view.el.game.classList.contains('hidden'));
    if (!inGame) return; // 主页 / 结算 / 破产：交给系统正常退出
    armBackGuard();      // 续压基线，避免「确认框还开着」时再按一次就退出
    persist();           // 退出前保命一次（不依赖 10s 定时器）
    view.confirmBack({
      title: ctx.t('back.title'),
      body: ctx.t('back.body'),
      okLabel: ctx.t('back.ok'),
      cancelLabel: ctx.t('back.cancel'),
      onConfirm: () => { if (view.onQuit) view.onQuit(); },
    });
  };

  window.addEventListener('popstate', () => {
    backArmed = false; // 刚消费掉一条基线
    onBack();
  });
  armBackGuard();

  // Capacitor 打包接入点（v2.20.0 预留，打 APK 时按下面两行接即可，逻辑完全复用）：
  //   import { App } from '@capacitor/app';
  //   App.addListener('backButton', () => window.__OWK_BACK__());
  // 原生返回键由 Capacitor 截获，**不会**派发 popstate，必须转发到这个入口；
  // 否则 WebView 里按返回会直接 finish 掉 Activity。
  window.__OWK_BACK__ = onBack;

  /** 导入存档码后调用：关掉 persist，避免 reload 前的 beforeunload 把导入结果冲掉 */
  const suppressPersist = () => {
    persistSuppressed = true;
    window.removeEventListener('beforeunload', persist);
  };

  showMenuWithNote();

  // 便于自动化测试
  window.__OWK__ = { ctx, game, view, exportSaveCode, importSaveCode, inspectSaveCode, suppressPersist, fit: fitInfo };
}

boot();
