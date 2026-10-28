// 修复回归防线：把 v2.5 修复批次（Phase A 引擎/配置 + Phase B 装配/视图/样式/音频/SW）
// 逐条钉成可执行断言，接入 npm test。
//
// 运行：node tools/verify-fixes.mjs
// 说明：本文件**不依赖浏览器**——Phase B 的交互行为由 tools/interact-check.mjs 等
// 巡检脚本在真实浏览器里覆盖，这里只做「源码级契约」检查（事件是否有人订阅、
// 关键守卫是否还在、配置键读写是否走同一权威键），目的是让「删掉一行修复」能被 CI 抓到。
import fs from 'node:fs';
import { buildCtx } from '../src/config.js';
import { Game } from '../src/engine.js';
import { DEF, PRESET } from '../src/audio.js';
import { createSuite } from './_assert.mjs';

const { ok, eq, section, finish } = createSuite();

const root = new URL('../', import.meta.url);
const readJSON = (f) => JSON.parse(fs.readFileSync(new URL(f, root), 'utf8'));
const readText = (f) => fs.readFileSync(new URL(f, root), 'utf8');

const ctx = buildCtx(
  readJSON('owk_handoff_config.json'),
  readJSON('owk_handoff_crafts.json'),
  readJSON('owk_handoff_layout.json'),
  readJSON('owk_handoff_i18n.json'),
);

const newGame = (mode = 'normal') => {
  const g = new Game(ctx);
  g.tutorialDone = true;
  g.newRun(mode, 1);
  g.s.customers = [];
  g.s.perDay = 1e9;
  g.s.spawned = 0;
  g.s.spawnTimer = 1e9;
  return g;
};
const loc = (zone, station, index) => ({ zone, station, index });
const tickUntil = (g, target, step = 100) => {
  let guard = 0;
  while (g.s.phase === 'day' && g.s.time < target && guard++ < 20000) g.tick(Math.min(step, target - g.s.time));
};

// ================================================================ Phase A：引擎与配置
section('A1 跨日 s.time 归零（S1）', () => {
  const g = newGame();
  g.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g.s.weekWeatherWeek = g.s.week;
  g.startDay(3);
  eq('A1-a', () => g.s.time, 0, 'startDay 后 time=0');
  eq('A1-b', () => g.s.deliveries.map((d) => d.status), ['scheduled', 'scheduled'], '两单均为 scheduled');
  g.tick(16);
  eq('A1-c', () => g.s.deliveries.map((d) => d.status), ['scheduled', 'scheduled'], '1 帧后仍是 scheduled');
  g.s.time = 88000;
  g.s.phase = 'dayEnd';
  g.nextDay();
  eq('A1-d', () => [g.s.day, g.s.time], [4, 0], 'nextDay 后 time 归零');
  g.s.phase = 'weekEnd';
  g.nextWeek();
  eq('A1-e', () => g.s.time, 0, 'nextWeek 后 time 归零');
  g.s.phase = 'bankrupt';
  g.retryWeek();
  eq('A1-f', () => g.s.time, 0, 'retryWeek 后 time 归零');
});

section('A2 存档恢复链路（S4）', () => {
  const g = newGame();
  g.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g.s.weekWeatherWeek = g.s.week;
  g.startDay(3);
  g.s.coins = 777;
  g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'), g.mkItem('fail'));
  g.s.stations.food.inputs[0] = g.mkItem('bread');
  g.s.stations.food.output = g.mkItem('burger');
  g.s.stations.drink.busy = true;
  g.s.stations.drink.pendingId = 'cola';
  g.s.stations.drink.duration = 1000;
  g.s.stations.drink.progress = 400;
  g.s.devices = { stove: 2, counter: 3, sign: 4, trash: 2 };
  const c = g.spawnCustomer(false);
  c.patience = 12345;
  c.items[0].filled = 'burger';
  g.s.customers = [c];
  const snap = g.snapshot();

  eq('A2-a', snap.v, 2, '快照带版本号 v2');
  eq('A2-b', snap.storage.length, 3, '仓储入档');
  eq('A2-c', snap.customers.length, 1, '在场顾客入档');
  eq('A2-d', () => snap.customers[0].patience, 12345, '剩余耐心入档');
  eq('A2-e', () => snap.customers[0].items[0].filled, 'burger', 'filled 状态下入档');
  eq('A2-f', () => snap.stations.drink.pendingId, 'cola', '合成中产物入档');

  const g2 = new Game(ctx);
  eq('A2-g', g2.resume(snap), true, 'resume 返回 true');
  eq('A2-h', () => g2.s.coins, 777, '金币恢复');
  eq('A2-i', () => g2.s.devices, { stove: 2, counter: 3, sign: 4, trash: 2 }, '设备恢复');
  eq('A2-j', () => g2.s.storage.map((x) => x.key), ['burger', 'cola', 'fail'], '仓储恢复（同序）');
  eq('A2-k', () => g2.s.stations.food.output.key, 'burger', '输出槽恢复');
  eq('A2-l', () => g2.s.stations.food.inputs[0].key, 'bread', '输入槽恢复');
  eq('A2-m', () => g2.s.stations.drink.busy, true, '读条中状态恢复');
  eq('A2-n', () => g2.s.stations.drink.progress, 400, '读条进度恢复');
  eq('A2-o', () => g2.s.customers[0].patience, 12345, '耐心接着走');
  eq('A2-p', () => g2.s.customers[0].patienceMax, c.patienceMax, 'patienceMax 单独保存');
  eq('A2-q', () => g2.s.customers[0].items[0].filled, 'burger', 'filled 恢复');
  eq('A2-r', () => g2.s.day, 3, '天数恢复');
  eq('A2-s', () => g2.s.time, 0, '恢复后当日时钟从 0 起算');
  const used = g2.s.storage.map((x) => x.uid);
  const it = g2.mkItem('water');
  eq('A2-t', used.includes(it.uid), false, `uid 续号不撞（新 uid ${it.uid}）`);
  const cats = [];
  const g3 = new Game(ctx);
  g3.on('catCoin', (d) => cats.push(d));
  g3.resume(snap);
  eq('A2-u', cats.length, 0, '恢复不重放猫币事件');

  const dirty = {
    mode: 'normal', week: 1, day: 2, coins: 'NaN',
    devices: { stove: 999, counter: -3, sign: 0, trash: 99 },
    storage: [{ key: 'burger' }, null, { key: 'notARealKey' }],
    stations: { food: { busy: true, pendingId: null, duration: 0 } },
    customers: [{ id: 'zz', items: [{ slot: 'food', wants: 'burger', accepts: ['burger'], filled: 'burger' }], patienceMax: 100, patience: -5 }],
  };
  const g4 = new Game(ctx);
  let threw = null;
  try { g4.resume(dirty); } catch (e) { threw = e; }
  eq('A2-v', threw, null, '脏存档不抛错');
  eq('A2-w', () => g4.s.devices, { stove: 4, counter: 1, sign: 1, trash: 3 }, '设备等级钳位');
  eq('A2-x', () => g4.s.storage.map((x) => x.key), ['burger'], '非法物品被丢弃');
  eq('A2-y', () => g4.s.stations.food.busy, false, '无 pendingId 的 busy 被纠正');
  ok('A2-z', () => g4.s.customers[0].patience >= 1, '负耐心钳到 ≥1');
  ok('A2-aa', () => Number.isFinite(g4.s.coins), '金币回落为数值');
  eq('A2-ab', () => g4.trashCdMs, 400, 'trash 越界钳到最高级后 getter 正常');
  eq('A2-ac', () => g4.stoveMs, 740, 'stove 越界钳到最高级后 getter 正常');
  const legacy = { mode: 'hard', week: 2, day: 4, coins: 300, weekStartCoins: 200, devices: { stove: 1, counter: 1, sign: 1, trash: 1 }, hardUnlocked: true, tutorialDone: true };
  const g5 = new Game(ctx);
  let threw2 = null;
  try { g5.resume(legacy); } catch (e) { threw2 = e; }
  eq('A2-ad', threw2, null, '旧版 v1 存档可读');
  eq('A2-ae', () => [g5.s.week, g5.s.day, g5.s.coins, g5.s.storage.length], [2, 4, 300, 0], '旧档字段恢复 + 缺失字段走默认');
  eq('A2-af', new Game(ctx).resume(null), false, '空存档返回 false');
});

section('A3/A4/A5/A6 外卖链路（M1/M4/M5/M6）', () => {
  const g = newGame();
  g.s.stations.food.output = g.mkItem('burger');
  g.s.storage.push(g.mkItem('bread'));
  eq('A3-a', g.moveItem(loc('storage', null, 0), loc('input', 'food', 0)).reason, 'outputOccupied', '输出槽有成品时拒绝拖拽投料');
  eq('A3-b', () => g.s.stations.food.output.key, 'burger', '成品未被销毁');

  const earn = newGame();
  earn.s.time = 0;
  const d = { item: 'coffee', riderAt: 0, effectiveWait: 10000 };
  const lv = [];
  for (const n of [1, 2, 3, 4]) {
    earn.s.devices.counter = n;
    lv.push(earn.deliveryEarn(d));
  }
  // base=6、小费 130%、150%：Lv1..Lv4 = 11/12/14/15
  eq('A4-a', lv, [11, 12, 14, 15], '外卖收益随 devices.counter.values 单调递增');
  earn.s.devices.counter = 1;
  eq('A4-b', earn.deliveryEarn(d), Math.floor((6 * 100 * 130 * 150) / 1e6), 'Lv1 按 100% 计（不是 110%）');

  const settle = newGame();
  settle.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  settle.s.weekWeatherWeek = settle.s.week;
  settle.startDay(3);
  const dd = settle.s.deliveries[0];
  tickUntil(settle, dd.riderAt);
  settle.pickupDelivery(dd.id);
  eq('A5-a', () => dd.deliveredAt - settle.s.time, ctx.config.delivery.deliverySettleMs, '结算延迟读 cfg.delivery.deliverySettleMs');
  const orig = ctx.config.delivery.deliverySettleMs;
  ctx.config.delivery.deliverySettleMs = 15000;
  const g2 = newGame();
  g2.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g2.s.weekWeatherWeek = g2.s.week;
  g2.startDay(3);
  const d2 = g2.s.deliveries[0];
  tickUntil(g2, d2.riderAt);
  g2.pickupDelivery(d2.id);
  eq('A5-b', () => d2.deliveredAt - g2.s.time, 15000, '改配置立即生效');
  ctx.config.delivery.deliverySettleMs = orig;
  const g3 = newGame();
  g3.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g3.s.weekWeatherWeek = g3.s.week;
  g3.startDay(3);
  const d3 = g3.s.deliveries[0];
  d3.status = 'rider_arrived';
  delete ctx.config.delivery.deliverySettleMs;
  let msg = '';
  try { g3.pickupDelivery(d3.id); } catch (e) { msg = e.message; }
  ok('A5-c', /deliverySettleMs/.test(msg), `缺配置显式报错（${msg}）`);
  ctx.config.delivery.deliverySettleMs = orig;

  const week = newGame();
  week.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  week.s.weekWeatherWeek = week.s.week;
  week.startDay(3);
  const before = { served: week.s.weekStats.served, dl: week.s.weekStats.deliveryServed };
  week.endDay();
  eq('A6-a', () => week.s.weekStats.deliveryServed - before.dl, 2, '周统计吃到日结并入的 2 单');
  eq('A6-b', () => week.s.weekStats.served - before.served, 2, '周成交包含并入外卖');
});

section('A9/A10 困难加冰与外卖猫币（M20/M21）', () => {
  const hard = newGame('hard');
  eq('A9-a', () => hard.menuLeaves().has('ice'), true, '困难模式 ice 进入当日相关食材');
  eq('A9-b', () => newGame('normal').menuLeaves().has('ice'), false, '普通模式不并入 ice');

  const g = newGame();
  g.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g.s.weekWeatherWeek = g.s.week;
  g.startDay(3);
  const cats = [];
  g.on('catCoin', (d) => cats.push(d));
  g.endDay();
  eq('A10-a', cats.filter((x) => x.reason === 'delivery').length, 0, '日结并入的订单不发外卖猫币');
  eq('A10-b', () => g.s.dayStats.deliveryPending, 2, '记入 deliveryPending');
  eq('A10-c', () => g.s.dayStats.deliveryServed, 0, '不再同时记入 deliveryServed');
});

section('L1/L2/L3/L10 引擎收尾项', () => {
  const g = newGame();
  for (let i = 0; i < g.storageCap; i++) g.s.storage.push(g.mkItem('burger'));
  eq('L1-a', g.moveItem(loc('storage', null, 0), { zone: 'storage' }).ok, true, '满仓也能在仓储内挪位');
  eq('L1-b', () => g.s.storage.length, g.storageCap, '净数量不变');
  g.s.stations.food.output = g.mkItem('burger');
  eq('L1-c', g.moveItem(loc('output', 'food'), { zone: 'storage' }).reason, 'storageFull', '跨区入仓仍判满');

  const r = newGame();
  r.s.stations.food.inputs[0] = r.mkItem('burger');
  r.recallInput('food', 0);
  eq('L2-a', () => r.s.ach.maxStorage, 1, '撤回成品也记录仓储峰值');

  const w = newGame();
  w.s.coins = 900;
  w.s.stations.food.busy = true;
  w.s.stations.food.pendingId = 'burger';
  w.s.stations.food.duration = 1200;
  w.s.stations.food.progress = 500;
  w.endWeek();
  eq('L3-a', () => [w.s.stations.food.busy, w.s.stations.food.pendingId], [false, null], '周结算清掉读条状态');
  eq('L3-b', () => w.s.weekStats.recycled, 0, '普通模式合成中产物按半成品回收 0');
  const hw = newGame('hard');
  hw.s.coins = 900;
  hw.s.stations.food.busy = true;
  hw.s.stations.food.pendingId = 'burger';
  hw.s.stations.food.duration = 1200;
  hw.endWeek();
  eq('L3-c', () => hw.s.weekStats.discarded, 1, '困难模式合成中产物计 1 件报废');

  const p = newGame();
  p.s.paused = true;
  p.s.phase = 'dayEnd';
  p.nextDay();
  eq('L10-a', () => p.s.paused, false, '跨日不再继承暂停态');
});

section('L6/L7/L9/M9/M10/M12/M19 配置与文案', () => {
  eq('L6-a', ctx.config.economy.tipFactor, undefined, 'economy.tipFactor 已删（权威键 pricing.tipFactor）');
  eq('L6-b', ctx.config.devices.trash, undefined, 'devices.trash 已删（权威键 trash.levels）');
  eq('L6-c', [ctx.config.difficulty.normal.maxQueue, ctx.config.difficulty.hard.maxQueue], [undefined, undefined], 'difficulty.*.maxQueue 已删');
  eq('L6-d', ctx.config.difficulty.normal.pace.maxQueue, 3, '权威键 pace.maxQueue 保留');
  eq('L7-a', ctx.crafts.recipes.filter((r) => r.modes).length, 0, '配方表已无 modes（多分支机制废弃）');
  eq('L9-a', ctx.config.economy.daysPerWeek, 7, 'config.economy.daysPerWeek 存在');
  eq('L9-b', ctx.config.crafting.earlyCloseDebounceMs, 500, 'config.crafting.earlyCloseDebounceMs 存在');
  eq('L9-c', ctx.config.pricing.bigOrderItems, ['pizza', 'milkshake', 'icedTea'], 'config.pricing.bigOrderItems 存在');
  const g = newGame();
  eq('L9-d', () => g.blankStation('food').inputs.length, ctx.config.stations.food.inputSlots, '输入槽数读配置');
  eq('M9-a', ctx.t('shop.free'), '免费', 'i18n shop.free 存在');
  eq('M10-a', ctx.byId.get('vegPatty').net, 0, 'vegPatty net=0');
  eq('M10-b', ctx.byId.get('pizzaBase').net, 0, 'pizzaBase net=0');
  eq('M12-a', [ctx.config.difficulty.normal.storageCap, ctx.config.difficulty.hard.storageCap], [undefined, undefined], 'difficulty.*.storageCap 已删');
  eq('M12-b', ctx.i18n['mode.hint.normal'].includes('仓储 5 格'), true, '普通模式提示写 5 格');
  eq('M12-c', ctx.i18n['mode.hint.hard'].includes('仓储 5 格'), true, '困难模式提示写 5 格');
  eq('L11-a', ctx.i18n['shop.hint'].includes('平安一周 +30'), true, '商店提示改为 +30');
  const buffer = ctx.layout.regions.find((r) => r.id === 'bufferRow');
  eq('M19-a', buffer._deprecated, true, 'layout bufferRow 标注弃用');
  const ing = ctx.layout.regions.find((r) => r.id === 'ingredientArea');
  eq('M19-b', ing.content.includes('7 列 × 2 行'), true, '食材区描述 7×2');
  const storage = ctx.layout.regions.find((r) => r.id === 'storageRow');
  eq('M19-c', storage.content.includes('普通 5 / 困难 5'), true, '仓储描述 5/5');
});

// ================================================================ Phase B：源码级契约
section('B 装配层：事件接线与存档/成就持久化（M2/M7/M17）', () => {
  const main = readText('src/main.js');
  // 去掉行注释再检查「是否真的有订阅」：注释里那句"game.on('combine', ...) 有意不订阅"不该被算成接线
  const mainCode = main.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const [evt, preset] of [['craftDone', 'step_done'], ['upgraded', 'purchase'], ['trash', 'ingredient_wrong'], ['dayTimeUp', 'order_expired']]) {
    ok(`B7-${evt}`, () => new RegExp(`game\\.on\\('${evt}'[\\s\\S]{0,120}audio\\.play\\('${preset}'\\)`).test(mainCode), `${evt} → ${preset} 已接线`);
  }
  eq('B7-combine', /game\.on\('combine'/.test(mainCode), false, 'combine 有意不订阅（避免与 craftDone 叠音）');
  ok('B2-flush', () => /flushAchCounters/.test(main) && /new WeakMap\(\)/.test(main), '跨局成就计数器用 WeakMap 增量合并（幂等）');
  ok('B2-flush-call', () => /flushAchCounters\(\)/.test(main), '开始新局前调用 flush');
  ok('B2-no-flush-on-resume', () => !/flushAchCounters\(\);[^\n]*\n[^\n]*game\.resume/.test(main), '读档前不 flush（否则重复计入）');
  ok('B3-ownedThemes', () => /ownedThemes: owned\.filter/.test(main), '装修队只数非默认皮肤');
  ok('B3-refresh-on-buy', () => /onCatStore[\s\S]{0,200}refreshAchExtra\(\)/.test(main), '购买皮肤后刷新成就系数');
  ok('B11-boot-err', () => /boot-err-msg/.test(main) && /textContent = String\(err\.message/.test(main), 'boot 错误用 textContent 注入');
  ok('B11-loop-guard', () => /errStreak/.test(main) && /requestAnimationFrame\(loop\)/.test(main), '主循环有异常计数与继续调度');
});

section('B 视图层：交互守卫与死代码清理（S5/M13/L12~L21）', () => {
  const view = readText('src/view.js');
  ok('B5-applySelection', () => /applySelection\(\)/.test(view), 'render 后按位置重放选中态');
  ok('B5-clearOnDrop', () => /clearSelection\(\);[\s\S]{0,120}this\.render\(\);/.test(view), '拖拽投放后清空选中');
  ok('B6-window-pointerup', () => /window\.addEventListener\('pointerup'/.test(view), 'pointerup 挂 window（移出舞台也能收尾）');
  ok('B6-button-filter', () => /e\.button !== 0 \|\| e\.isPrimary === false/.test(view), '过滤非左键/非主指针');
  ok('B12-riderDirect', () => /find\(\(x\) => x\.status === 'rider_arrived'\)/.test(view), 'riderAction 直查 rider_arrived');
  ok('B13-failMap', () => ['slotEmpty', 'notNow', 'sameSpot', 'orderGone', 'badTarget'].every((k) => view.includes(`toast.${k}`)), 'fail() 补齐 5 个 reason 文案');
  ok('B13-configError', () => /configError/.test(view), 'fail() 覆盖 configError（配置缺失不再静默）');
  ok('B17-skinId', () => /this\.skinId = sk\.id/.test(view) && !/this\.themeId/.test(view), 'applyTheme 记 skinId 而非 theme.id');
  ok('B21-shopPause', () => /restoreShopPause\(\)/.test(view) && /closeModal\(\)[\s\S]{0,200}restoreShopPause/.test(view), 'closeModal 统一恢复商店暂停');
  ok('B20-toastTimers', () => /toastTimers/.test(view) && /clearToasts\(\)/.test(view), 'toast 定时器统一收口');
  ok('B19-upgradeOnce', () => !/this\.renderUpgrade\(\);\s*\n\s*this\.render\(\);/.test(view), 'doUpgrade 不再重复重建升级面板');
  eq('B14-phoneBtn', /phoneBtn|phone-btn/.test(view), false, '#phone-btn 已删除');
  eq('B14-windowArt', /windowArt|boardArt/.test(view), false, '死美术函数已删除');
  eq('B14-buffer', /zone === 'buffer'/.test(view), false, 'view 侧 buffer 死分支已删除');
  eq('B19-modes', /r\.modes/.test(view), false, 'view 侧配方 modes 死分支已删除');
  ok('B18-daysPerWeek', () => /economy && this\.ctx\.config\.economy\.daysPerWeek/.test(view), 'showDayEnd 日上限读配置');
  ok('B18-deliveryMs', () => /typeof dc\.previewMs === 'number'/.test(view) && /typeof dc\.deliverySettleMs === 'number'/.test(view), '外卖时长读配置');
  eq('B18-noFakeSettle', () => /\|\|\s*10000/.test(view) || /\|\|\s*20000/.test(view), false, '视图侧不再对时长做静默兜底（缺键就不画进度条）');
  ok('B13-keycap', () => /this\.sfx\('keycap'\)/.test(view), '食材键接线 keycap 音');
  ok('B15-inkStrong', () => /--ink-strong/.test(view), 'applyTheme 按背景亮度设置 --ink-strong');
});

section('B 样式 / 音频 / SW / i18n（M8/S2/L19/L21）', () => {
  const css = readText('src/style.css');
  // 去掉注释再判断选择器：注释里提到某个类名不算「定义了规则」
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const view = readText('src/view.js');
  ok('B8-book', () => ['.book-grid', '.book-card', '.book-detail', '.book-step', '.book-ic', '.book-d-head', '.book-steps', '.book-tabs'].every((s) => css.includes(s)), '.book-* 八类样式齐备');
  // 标签页：只断言「样式定义」与「视图真实使用者」两侧都存在，不再守护历史上从未渲染的 .shop-tabs
  ok('B8-bookTabs', () => /\.book-tabs\s*\{/.test(css) && /\.book-tabs \.tab\s*\{/.test(css), '.book-tabs 标签页规则存在');
  ok('B8-bookTabsUsed', () => /class="book-tabs"/.test(view), '.book-tabs 在视图里真的有使用者（不是孤儿样式）');
  eq('B8-shopTabsGone', () => cssCode.includes('.shop-tabs'), false, '.shop-tabs 死选择器已收敛（视图无此节点）');
  ok('B8-inkStrong', () => /--ink-strong/.test(css), '--ink-strong 变量已定义并被使用');
  // v2.12：输出槽右侧「↓ 入料」箭头按钮已删除（半成品直接拖回输入格/仓库）。
  // 加进死样式黑名单，防止哪天又被加回来 —— 它存在就说明「拖拽被 outputOccupied 拦了」这个根因没真正修好。
  for (const dead of ['.phone-btn', '.ice-switch', '.theme-card', '.theme-grid', '.theme-sw', '.qb-window', '.panel.peek', '.quick']) {
    eq(`B5-css${dead}`, () => cssCode.includes(dead), false, `死样式 ${dead} 已删`);
  }
  // 箭头按钮的三处实现都必须消失，只删样式不算删干净
  eq('B25-quickBtn', () => /class="quick"/.test(view), false, '视图里不再渲染箭头按钮');
  eq('B25-quickAct', () => /act === 'quick'/.test(view), false, '视图不再处理 quick 动作');
  eq('B25-quickEngine', () => /quickReload\s*\(/.test(readText('src/engine.js')), false, '引擎 quickReload 已随按钮移除');
  eq('B25-quickI18n', () => /"quick\.load"/.test(readText('owk_handoff_i18n.json')), false, 'i18n 不再保留 quick.load');
  eq('B25-quickConfig', () => /"quickReload"/.test(readText('owk_handoff_config.json')), false, 'config 不再保留 quickReload');
  const audio = readText('src/audio.js');
  ok('B19-volume', () => /setMusicVolume\(v, save = true\)/.test(audio) && /setSfxVolume\(v, save = true\)/.test(audio), '音量接口支持「只改增益不落盘」');
  ok('B21-bgmRetry', () => /if \(this\.bgmMode && !this\.bgmTimer\) this\.startBgm/.test(audio), 'unlock 后补启 pending BGM');
  ok('B2-pauseComment', () => /pause[\s\S]{0,200}保留未接线/.test(audio), 'pause/resume 未接线已在 PRESET 注释说明');
  const sw = readText('sw.js');
  ok('B4-audio', () => sw.includes("'./src/audio.js'"), 'SHELL 含 audio.js');
  ok('B4-version', () => /owk-v31/.test(sw), '缓存名 owk-v31');
  // v2.12：代码类资源必须网络优先，否则发版后玩家要刷两次才看到新版（会被当成「更新没生效」）
  ok('B26-swNetFirst', () => /const NETWORK_FIRST = \/\\\.\(\?:js\|mjs\|css\|json\|webmanifest\)\$\/i;/.test(sw), 'SW 定义 NETWORK_FIRST 代码资源白名单');
  ok('B26-swNetFirstUsed', () => /if \(NETWORK_FIRST\.test\(url\.pathname\)\)/.test(sw), 'SW 对代码资源走网络优先分支');
  ok('B26-swBranchOrder', () => {
    // cache-first 对图片仍然合法（体积大、几乎不变），关键是它必须排在
    // 代码资源的网络优先分支**之后**，不能抢在前面把旧 JS 先端出去。
    const iNet = sw.indexOf('NETWORK_FIRST.test(url.pathname)');
    const iCache = sw.indexOf('caches.match(e.request).then');
    return iNet > 0 && iCache > 0 && iNet < iCache;
  }, 'SW 分支顺序：代码网络优先 → 其余缓存优先');

  // v2.13：存档导出 / 导入（存档在 localStorage，按域名隔离，换域名=重新开号）
  const main = readText('src/main.js');
  const i18nTxt = readText('owk_handoff_i18n.json');
  ok('B27-saveKeys', () => {
    // 五个存档键必须全部纳入导出范围，漏一个就等于「迁移后少东西」
    const need = ['owk.cats.v1', 'owk.ach.v1', 'owk.hard.unlocked', 'owk.save.v1', 'owk.audio.v1'];
    const m = /const SAVE_KEYS = \[([^\]]*)\]/.exec(main);
    return !!m && need.every((k) => m[1].includes(k));
  }, 'SAVE_KEYS 覆盖全部 5 个存档键');
  ok('B27-exportFn', () => /function exportSaveCode\(\)/.test(main) && /OWK1\./.test(main), '导出函数与品牌前缀存在');
  ok('B27-importFn', () => /function importSaveCode\(/.test(main), '导入函数存在');
  ok('B27-importValidates', () => /JSON\.parse\(v\)/.test(main) && /pending/.test(main), '导入先全量校验再写入（避免半新半旧）');
  ok('B27-exposed', () => /window\.__OWK__ = \{ ctx, game, view, exportSaveCode, importSaveCode \}/.test(main), '导出/导入挂到 window.__OWK__');
  ok('B27-ui', () => /data-save="export"/.test(view) && /data-save="import"/.test(view), '设置页有导出/导入按钮');
  ok('B27-clipboard', () => /navigator\.clipboard\.writeText/.test(view), '导出尝试写剪贴板');
  ok('B27-textarea', () => /id="save-code"/.test(view), '导出后展示可手动复制的文本框');
  ok('B27-i18n', () => ['settings.save', 'settings.exportSave', 'settings.importSave', 'settings.exportCopied', 'settings.importBad']
    .every((k) => i18nTxt.includes('"' + k + '"')), '新增文案键齐备');
  ok('B27-css', () => /\.set-save-code textarea\s*\{/.test(css), '.set-save-code 样式存在');
  ok('B4-okOnly', () => /res\.ok/.test(sw), '只缓存成功响应');
  ok('B9-i18nNew', () => ['shop.free', 'toast.runtimeError', 'recipe.intermediate', 'delivery.notYet'].every((k) => ctx.i18n[k]), 'i18n 新增键齐备');
  for (const dead of ['storage.buffer', 'toast.bufferFull', 'buffer.count', 'ice.switch', 'ice.switch.on', 'ice.switch.off', 'cola.iced', 'delivery.selected', 'shop.balance', 'shop.owned', 'shop.preview']) {
    eq(`B5-i18n:${dead}`, () => dead in ctx.i18n, false, `死 i18n 键 ${dead} 已删`);
  }
});

section('A7/A8 跨局成就计数器合并语义（模拟 main.js 增量法）', () => {
  const achStore = { counters: {} };
  const flushed = new WeakMap();
  const flush = (a) => {
    const prev = flushed.get(a) || { orders: 0, revenue: 0, vip: 0, trash: 0, bigOrders: 0, maxStorage: 0 };
    for (const k of ['orders', 'revenue', 'vip', 'trash', 'bigOrders']) {
      const delta = (a[k] || 0) - (prev[k] || 0);
      if (delta > 0) achStore.counters[k] = (achStore.counters[k] || 0) + delta;
    }
    if ((a.maxStorage || 0) > (achStore.counters.maxStorage || 0)) achStore.counters.maxStorage = a.maxStorage;
    flushed.set(a, { orders: a.orders || 0, revenue: a.revenue || 0, vip: a.vip || 0, trash: a.trash || 0, bigOrders: a.bigOrders || 0, maxStorage: a.maxStorage || 0 });
  };
  const extra = () => ({ unlocked: [], totals: achStore.counters, ownedSkins: 1, ownedThemes: 0 });

  const g1 = newGame();
  for (let i = 0; i < 60; i++) { g1.bumpCounter('orders', 1); g1.bumpCounter('revenue', 10); }
  const r1 = g1.checkAchievements('day', extra());
  eq('A7-a', r1.some((x) => x.id === 'ach_orders_100'), false, '单局 60 单不解锁 100 单');
  flush(g1.s.ach);
  eq('A7-b', () => achStore.counters.orders, 60, '局终写入 counters');
  flush(g1.s.ach);
  eq('A7-c', () => achStore.counters.orders, 60, '重复 flush 不重复累加（幂等）');

  const g2 = newGame();
  for (let i = 0; i < 45; i++) { g2.bumpCounter('orders', 1); g2.bumpCounter('revenue', 10); }
  const r2 = g2.checkAchievements('day', extra());
  ok('A7-d', r2.some((x) => x.id === 'ach_orders_100'), '跨两局累计 105 单可解锁');
  flush(g2.s.ach);
  const g3 = newGame();
  for (let i = 0; i < 45; i++) { g3.bumpCounter('orders', 1); g3.bumpCounter('revenue', 50); }
  const r3 = g3.checkAchievements('day', extra());
  ok('A7-e', r3.some((x) => x.id === 'ach_revenue_2000'), '跨局流水累计 3300 解锁');
});

section('B9 主题商店单页化（v2.7）与功能页右上角 ✕', () => {
  const view = readText('src/view.js');
  const css = readText('src/style.css');
  const i18n = readJSON('owk_handoff_i18n.json');

  // ---- 弹层：右上角 ✕ -------------------------------------------------
  ok('B9-modalAPI', () => /modal\(\{[^}]*closable = false/.test(view), 'modal() 支持 closable 选项');
  ok('B9-modalHead', () => /class="modal-head"/.test(view) && /class="modal-x" data-modal-x/.test(view), '弹层有独立标题栏与 ✕ 按钮');
  // 主页 5 个功能页全部声明 closable；少一个就会有玩家被逼着滚到底部
  const closableCount = (view.match(/closable: true,/g) || []).length;
  eq('B9-fiveEntries', closableCount, 5, '主页五页（商店/成就/配方书/天气/设置）都带 ✕');
  // 按「方法定义」切片：不能直接 indexOf(`${fn}(`)，否则会先命中 showMenu 里的调用处
  const bodyOf = (name) => {
    const m = new RegExp(`^ {2}${name}\\(`, 'm').exec(view);
    if (!m) return null;
    const rest = view.slice(m.index + name.length + 3);
    const next = rest.search(/^ {2}[A-Za-z_$][\w$]*\(/m);
    return rest.slice(0, next < 0 ? rest.length : next);
  };
  for (const fn of ['renderShop', 'openAch', 'openRecipeBook', 'openWeatherIntro', 'renderSettings']) {
    const body = bodyOf(fn);
    ok(`B9-${fn}`, () => body != null && body.includes('closable: true'), `${fn} 传了 closable`);
  }
  // 结算 / 破产 / 暂停这类必须走按钮推进的弹层不能出现 ✕
  for (const fn of ['showDayEnd', 'showWeekEnd', 'showBankrupt', 'showPause']) {
    const body = bodyOf(fn);
    if (body == null) continue;
    eq(`B9-${fn}NoX`, () => body.includes('closable: true'), false, `${fn} 不给 ✕（必须走按钮推进）`);
  }

  // ---- 布局：头/脚固定，只有内容区滚动（✕ 才不会随长内容滚走）----
  ok('B9-flexCard', () => /\.modal-card\s*\{[^}]*flex-direction:\s*column/.test(css), '.modal-card 改为纵向 flex 布局');
  ok('B9-headFixed', () => /\.modal-head\s*\{[^}]*flex:\s*none/.test(css), '.modal-head 不参与滚动');
  ok('B9-bodyScroll', () => /\.modal-body\s*\{[^}]*overflow:\s*auto/.test(css), '.modal-body 承担滚动');
  ok('B9-xStyle', () => /\.modal-x\s*\{/.test(css) && /\.modal-x\s*\{[^}]*--ink-strong/.test(css), '✕ 用自适应描边色（深色主题不糊）');

  // ---- 主题商店：单页陈列（v2.7 起取消猫咪 / 主题分页，不再单独陈列小猫）----
  // 分页相关节点与状态必须彻底消失，否则等于「只是隐藏了」，玩家仍可能回到小猫陈列
  eq('B9-noTabbar', () => /shop-tabbar/.test(view), false, '商店不再有分页栏（view 内无 shop-tabbar）');
  eq('B9-noTabState', () => /this\.shopTab\b/.test(view), false, 'shopTab 分页状态已删除');
  eq('B9-noTabSwitch', () => /data-shop-tab/.test(view), false, '分页点击绑定已删除');
  eq('B9-noCatGrid', () => /skin-grid|skin-card/.test(view), false, '商店不再渲染小猫独立陈列网格');
  ok('B9-themeGrid', () => /class="th-grid"/.test(view) && /\.th-grid\s*\{/.test(css), '主题网格有 DOM 也有样式');
  ok('B9-themeCard', () => /themeCardHTML\(sk\)/.test(view) && /\.th-card\s*\{/.test(css), '主题卡由 themeCardHTML 渲染且有样式');
  // 「皮肤即主题」不能被破坏：主题卡复用同一套购买/切换按钮，没有第二条付费路径
  ok('B9-noDoublePay', () => /themeCardHTML[\s\S]{0,900}this\.shopBtnHTML\(sk\)/.test(view), '主题卡复用 shopBtnHTML（不引入独立付费）');
  eq('B9-buyPath', () => (view.match(/data-skin-buy=/g) || []).length, 1, '购买入口只有一处（skin-buy）');
  // 底部小字说明：猫皮肤随主题自动变化（文案要点必须逐字出现）
  // 它挂在 modal 的 footNote 槽位上（.modal-note，在 .modal-body 之外），
  // 因此不随内容滚动 —— 玩家不滚动也能看到这条规则。
  ok('B9-autoSkinHint', () => /footNote:\s*this\.t\('shop\.themeHint'\)/.test(view)
    && typeof i18n['shop.themeHint'] === 'string'
    && i18n['shop.themeHint'].includes('小猫皮肤会根据所选主题自动变化'), '底部小字说明「猫皮肤随主题自动变化」');
  ok('B9-footNoteSlot', () => /footNote = ''/.test(view) && /class="modal-note small"/.test(view), 'modal() 支持固定底部小字槽位');
  ok('B9-hintAfterGrid', () => /<div class="th-grid">\$\{cards\}<\/div>/.test(view) && /footNote:/.test(view), '主题网格在前、小字说明固定在页面下方');
  // 标题从「商店」改为「主题商店」
  eq('B9-title', [i18n['shop.title'], i18n['shop.entry']], ['主题商店', '主题商店'], '标题/入口文案已改为「主题商店」');
  ok('B9-i18n', () => ['shop.themeHint', 'shop.hint'].every((k) => typeof i18n[k] === 'string' && i18n[k].length > 0), '底部说明文案齐全');
  eq('B9-tabKeysGone', () => ['shop.tab.cat', 'shop.tab.theme'].filter((k) => k in i18n), [], '分页文案键已删除');
  // 「仅展示主题内容」：主题卡上不得再出现「归属：小橘」这类小猫身份信息
  eq('B9-noOwnerRow', () => /th-owner/.test(view) || /shop\.themeOwner/.test(view), false, '主题卡不再有「归属」小猫信息行');
  eq('B9-ownerKeyGone', () => 'shop.themeOwner' in i18n, false, '死 i18n 键 shop.themeOwner 已删');
  eq('B9-noOwnerCss', () => /\.th-owner/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), false, '死样式 .th-owner 已删');
  // 删掉的辅助函数不能再留尸体
  eq('B9-deadHelpers', () => ['skinThemeSw', 'shopTabHTML'].filter((n) => new RegExp(`${n}\\s*\\(`).test(view)), [], 'skinThemeSw / shopTabHTML 已删除');
  // 舞台上的真猫仍靠 catSVG 渲染，必须保留
  ok('B9-catSvgKept', () => /import \{[^}]*catSVG[^}]*\} from '\.\/art\.js'/.test(view) && /catSVG\(skin\)/.test(view), '舞台真猫仍用 catSVG（未误删）');
});

section('V28 外卖时序 / 跨天结算 / 金币奖励 / 天气权重 / 成就可见化（v2.8）', () => {
  const cfg = ctx.config;
  const view = readText('src/view.js');
  const main = readText('src/main.js');
  const css = readText('src/style.css');
  const eng = readText('src/engine.js');

  // ---- F1 提前 10 秒预警 → 到店 → 配送 → 送达双倍 ----
  eq('V28-1a', cfg.delivery.previewMs, 10000, '配置 previewMs = 10000（提前 10 秒预警）');
  eq('V28-1b', cfg.delivery.deliverySettleMs, 10000, '配置 deliverySettleMs = 10000（送达 10 秒后结算）');
  eq('V28-1c', cfg.delivery.deliveredMul, 2, '配置 deliveredMul = 2（送达双倍金币）');
  ok('V28-1d', () => eng.includes('riderAt: phoneAt + (dc.previewMs'), 'riderAt = phoneAt + previewMs（读配置）');
  ok('V28-1e', () => /opts\.delivered\s*\?\s*\(dc\.deliveredMul/.test(eng), '送达口径吃 deliveredMul 倍率');
  ok('V28-1f', () => /status === 'rider_arrived'/.test(view) && /d\.status === 'picked_up'/.test(view), '骑手仅在 rider_arrived 态显示');
  // 骑手离场动画已下线（picked_up 立即消失）
  eq('V28-1g', () => /riderLeave/.test(css), false, '骑手离场动画已清理');
  ok('V28-1h', () => /delivery\.sending/.test(view) && /delivery\.deliverIn/.test(view) && /delivery\.done/.test(view), '手机三态文案齐备（配送中/送达倒计时/已送达）');
  ok('V28-1i', () => /ctx\.t\('delivery\.sending'\)/.test(main), '交付后 toast 提示「骑手开始配送」');

  // ---- F2 跨天结算 ----
  ok('V28-2a', () => /const submitted = d\.status === 'picked_up'/.test(eng), '日结按 picked_up 分流两种口径');
  ok('V28-2b', () => /pending: !submitted, delivered: submitted/.test(eng), '已提交走送达口径、未交付走 pending 口径');
  ok('V28-2c', () => /bumpCounter\('crossDay', 1\)/.test(eng), '跨天单埋点 crossDay');
  ok('V28-2d', () => /opts\.crossDay/.test(eng), 'settleDelivery 支持 crossDay 标记');

  // ---- F3 金币奖励猫猫币（不消耗金币） ----
  eq('V28-3a', cfg.catCoins.exchangeRate, 25, '每满 25 金币奖励 1 猫币');
  eq('V28-3b', cfg.catCoins.weeklyExchangeCap, 100, '单周上限 100');
  ok('V28-3c', () => /grantCoinBonus\(\)/.test(eng) && /const bonus = this\.grantCoinBonus\(\)/.test(eng), '周结算自动发放金币奖励');
  eq('V28-3d', () => /exchangeCoinsToCat/.test(eng + view + main), false, '旧的手动兑换接口已彻底下线');
  ok('V28-3e', () => /id="exchange"/.test(view) && /id="ex-amount"/.test(view), '周结算面板保留只读展示容器');
  eq('V28-3f', () => /data-ex/.test(view), false, '周结算面板不再有手动兑换按钮');

  // ---- F4 天气订单权重 ----
  eq('V28-4a', Object.keys(cfg.weather.types).length, 7, '共 7 种天气（新增沙尘）');
  eq('V28-4b', cfg.weather.types.heat.orderWeights.cold, 1.2, '热天冷饮下单权重 +20%');
  ok('V28-4c', () => /orderWeightOf\(id\)/.test(eng) && /pickByWeight\(list, rnd, weightOf\)/.test(eng), '引擎提供权重查询与加权抽取');
  ok('V28-4d', () => /this\.pickByWeight\(pool\.length/.test(eng), 'spawnCustomer 走加权抽取');
  ok('V28-4e', () => Object.keys(ctx.i18n).some((k) => k.startsWith('weather.sand')), '沙尘天气有中英文案');

  // ---- F5 成就可见化 + 分级 ----
  eq('V28-5a', cfg.achievements.list.length, 34, '成就共 34 条');
  ok('V28-5b', () => /tiers/.test(JSON.stringify(cfg.achievements)), '成就带难度分级表');
  eq('V28-5c', () => /ach\.locked/.test(view + ctx.i18n['ach.title']), false, '成就不再有隐藏占位');
  ok('V28-5d', () => /ach-tier/.test(view) && /ach-tier/.test(css), '难度徽章有结构与样式');
  ok('V28-5e', () => /ach-row locked/.test(view) || /'locked'/.test(view), '未解锁成就仅灰态展示');
  // 新计数器贯穿引擎与装配层
  ok('V28-5f', () => /'deliveries'/.test(eng) && /'crossDay'/.test(eng), '引擎有 deliveries / crossDay 计数器');
  ok('V28-5g', () => /'deliveries', 'crossDay'/.test(main), '装配层把新计数器并入跨局存档');
  // 所有新成就都有 i18n
  const missing = cfg.achievements.list.filter((a) => !ctx.i18n['ach.' + a.id] || !ctx.i18n['ach.' + a.id + '.desc']);
  eq('V28-5h', missing.map((a) => a.id), [], '每条成就都有可见名称与描述');
});

// ============================================================ v2.10：可爱风 BGM + 垃圾袋重画
section('V30 BGM 可爱风重制（音乐盒 / 打击乐 / 两首拍号不同）', () => {
  const audio = readText('src/audio.js');
  const art = readText('src/art.js');
  const css = readText('src/style.css');
  const view = readText('src/view.js');

  // 曲式：两首都是 16 小节，且**拍号不同**（3/4 圆舞曲 vs 4/4 快板）。
  // 拍号不同是"两首真的不一样"最硬的判据 —— 只改 bpm 的两首会被听成同一首。
  ok('V30-1a', () => /stepsPerBar:\s*6/.test(audio) && /stepsPerBar:\s*8/.test(audio),
    '大厅 3/4（6 步/小节）与局内 4/4（8 步/小节）拍号不同');
  ok('V30-1b', () => (audio.match(/bars:\s*16/g) || []).length === 2, '两首曲子都是 16 小节（不是 4 小节复读）');
  ok('V30-1c', () => /const totalSteps = track\.bars \* track\.stepsPerBar/.test(audio),
    '循环长度由曲式推导（不再写死 32 步）');
  // 音色：主旋律必须是音乐盒（bell），不是 pad/正弦长音
  ok('V30-1d', () => /_bellAt/.test(audio) && /bell: true/.test(audio), '主旋律用音乐盒音色 _bellAt');
  ok('V30-1e', () => /\[\[1, 1\], \[2\.0, 0\.45\], \[3\.01, 0\.22\]\]/.test(audio),
    '音乐盒是基频 + 2 次 + 3 次泛音（可爱的金属簧片感）');
  // 打击乐：局内必须有鼓组，大厅不能有底鼓（圆舞曲靠沙锤轻打）
  ok('V30-1f', () => /_kick\(/.test(audio) && /_shaker\(/.test(audio) && /_tick\(/.test(audio),
    '有三种轻打击乐：软底鼓 / 沙锤 / 木块');
  ok('V30-1g', () => {
    const day = /day:\s*\{[\s\S]*?perc:\s*\{([\s\S]*?)\n    \},/.exec(audio);
    const home = /home:\s*\{[\s\S]*?perc:\s*\{([\s\S]*?)\n    \},/.exec(audio);
    return !!day && /kick:/.test(day[1]) && /block:/.test(day[1])
      && !!home && !/kick:/.test(home[1]) && /shaker:/.test(home[1]);
  }, '局内有 kick+block+shaker，大厅只有 shaker（配器真正不同）');
  ok('V30-1h', () => /swing:\s*0\.06/.test(audio), '局内八分音符带摇摆（弹跳感的来源）');
  // 旋律改成绝对音高写谱（跟着和弦根音走 = 不成调）
  ok('V30-1i', () => /song: seq\(96/.test(audio) && /song: seq\(128/.test(audio),
    '旋律是绝对音高写谱（不再跟着和弦根音飘）');
  ok('V30-1j', () => /function seq\(/.test(audio), '有事件表 → 定长数组的写谱工具');
  // 切换曲目要淡入淡出（硬切会"啪"一下）
  ok('V30-1k', () => /bgmBus/.test(audio) && /_fadeBus\(0, 0\.22\)/.test(audio) && /_fadeBus\(1, 0\.45\)/.test(audio),
    '切曲走 bgmBus 淡出 0.22s / 淡入 0.45s');
  ok('V30-1l', () => /const VER = 6/.test(audio), '音频存档版本升到 v6（音乐/音效配比重做，旧音量平衡作废）');
  // 曲谱数据必须可被离线渲染工具复用（否则试听文件 ≠ 游戏里的曲子）
  ok('V30-1m', () => /export \{ TRACKS, hz, DEF, PRESET \}/.test(audio),
    'TRACKS / hz / DEF / PRESET 对外导出，供离线渲染与配比测量复用');
  // 边界：切曲的淡出进行到一半时关掉音乐 → bgmBus 停在 0；重新打开必须把总线拉回 1，否则永远静音
  ok('V30-1n', () => /setMusic\(on\)[\s\S]{0,420}_fadeBus\(1, 0\.2\)/.test(audio),
    '重新开音乐时把 bgmBus 拉回 1（否则停在淡出中途会永久静音）');
  // v2.10.1：调度器时间轴必须是**秒**。v2.10.0 的 `nextTime += stepMs` 让每次开音乐
  // 只排 2 个音就静音（用户现象："点开关只有一瞬间有音乐"），这条钉子专治它。
  ok('V30-1o', () => /nextTime \+= stepSec/.test(audio) && !/nextTime \+= stepMs/.test(audio),
    '调度器时间轴用秒（nextTime += stepSec），不再混入毫秒');
  ok('V30-1p', () => /track\.swing \* stepSec/.test(audio) && !/track\.swing \* stepMs/.test(audio),
    '摇摆偏移按秒计算（曾把反拍推迟 14 秒）');
  // 音量滑杆"没反应"的真实原因：通道关着。关闭态必须给出说明。
  ok('V30-1q', () => /settings\.musicOffHint/.test(view) && /settings\.sfxOffHint/.test(view)
    && typeof ctx.i18n['settings.musicOffHint'] === 'string'
    && typeof ctx.i18n['settings.sfxOffHint'] === 'string',
    '通道关闭时音量滑杆旁有「为什么没反应」的说明');
  ok('V30-1r', () => /updateVolHint\(\)/.test(view) && /\.set-vol\.muted/.test(css),
    '关闭态给滑杆行降透明度，并在开关切换后刷新提示');

  // ---- 失败品垃圾袋（照参考图重画）----
  const fs0 = art.indexOf('fail: `');
  const fe = art.indexOf('`,', fs0);
  const failSvg = fs0 > 0 && fe > fs0 ? art.slice(fs0, fe) : '';
  ok('V30-2a', () => failSvg.length > 0, '能定位 fail 造型');
  ok('V30-2b', () => /fill="#D6D6DC"/.test(failSvg), '袋身是浅灰平涂（不是纯线条，小尺寸才认得出）');
  ok('V30-2c', () => /fill="#CFCFD6"/.test(failSvg), '袋口褶皱单独一档灰，能看出扎口感');
  ok('V30-2d', () => /<rect[^>]*rx=/.test(failSvg), '有束口圈（圆角矩形绑带）');
  ok('V30-2e', () => /stroke="#FCFCFF"/.test(failSvg), '右下有高光弧');
  ok('V30-2f', () => (failSvg.match(/M\d+ 4[67]/g) || []).length >= 3, '束口圈下方有三道褶皱');
  eq('V30-2g', () => /stroke-dasharray/.test(failSvg), false, '不是旧的虚线框造型');
  eq('V30-2h', () => /fill="none"/.test(failSvg), false, '不再是纯线条版（v2.9.1 的画法已废弃）');
  ok('V30-2i', () => /\.item\.fail\s*\{[^}]*background:\s*none/.test(css), '仍然不加暗色底衬（袋子本身够灰）');
});

// ============================================================ v2.11：文案可爱化 + 全量外置
section('V31 文案可爱化（全部外置 / 事实片段不破）', () => {
  const view = readText('src/view.js');
  const i18n = ctx.i18n;

  // ① 原来硬编码在模板里的中文，现在必须都走 i18n
  const need = ['hud.operating', 'recipe.costTitle', 'recipe.prep', 'recipe.emptyToday',
    'recipe.other', 'recipe.costLine', 'recipe.netInline', 'upgrade.refundInline'];
  eq('V31-a', need.filter((k) => !i18n[k]), [], '新文案全部外置到 i18n');

  // ② 模板里不得再出现这些中文字面量（改文案时漏改的典型位置）
  const leftover = ['先备：', '其他配方', '今日无固定菜单', '升级返还 ', '净利 ¥', '>营业<']
    .filter((s) => view.includes(s));
  eq('V31-b', leftover, [], 'view.js 不再残留硬编码中文文案');

  ok('V31-c', () => /this\.t\('recipe\.prep'/.test(view) && /this\.t\('hud\.operating'\)/.test(view),
    '配方书「先备」与 HUD「营业中」已走 i18n');

  // ③ 可爱化不能把事实改掉 —— 这些片段是玩法说明，测试与玩家都依赖
  ok('V31-d', () => i18n['mode.hint.normal'].includes('仓储 5 格') && i18n['mode.hint.hard'].includes('仓储 5 格'),
    '两个模式说明仍写明「仓储 5 格」');
  ok('V31-e', () => i18n['shop.hint'].includes('平安一周 +30')
    && i18n['shop.themeHint'].includes('小猫皮肤会根据所选主题自动变化'),
    '商店两条说明的关键事实保留');
  ok('V31-f', () => i18n['upgrade.noRefundFirst'] === '首级无返还'
    && i18n['delivery.sending'].includes('骑手开始配送')
    && i18n['delivery.riderHere'].includes('骑手已到'),
    '升级/外卖的关键文案未被改写');
  // ④ 数值占位符不能被吞掉（改文案最容易犯的错）
  ok('V31-g', () => ['settle.recycle', 'settle.spoiled', 'ex.rule', 'ex.note', 'cat.dayReward', 'cat.weekReward']
    .every((k) => /\{[a-z]+\}/.test(i18n[k])),
    '带数值的文案仍保留 {占位符}');
});

// ============================================================ v2.11.1：音乐/音效配比
section('V32 音频配比（音乐抬高 / 音效收敛 / 顶部限幅）', () => {
  const audio = readText('src/audio.js');

  // 默认音量：音乐明显高于音效（用户原话「音乐太小、音效太大」）
  ok('V32-a', () => DEF.musicVol >= 0.65 && DEF.musicVol <= 0.85,
    `音乐默认音量 ${DEF.musicVol}（旧版 0.55，偏小）`);
  ok('V32-b', () => DEF.sfxVol <= 0.48 && DEF.sfxVol >= 0.3,
    `音效默认音量 ${DEF.sfxVol}（旧版 0.5，偏大）`);
  ok('V32-c', () => DEF.musicVol > DEF.sfxVol, '音乐默认音量高于音效默认音量');

  // 音效单条峰值上限：18 条全部收敛（旧版最大 0.26）
  const sfxMax = Math.max(...Object.values(PRESET).map((x) => x.vol));
  ok('V32-d', () => sfxMax <= 0.22, `音效峰值上限 ${sfxMax}（旧版 0.26）`);
  // 实际听到的电平 = preset.vol × sfxVol，必须低于音乐 RMS 量级（≈0.1）
  ok('V32-e', () => sfxMax * DEF.sfxVol <= 0.11,
    `音效实际峰值 ${(sfxMax * DEF.sfxVol).toFixed(3)}，不再压过音乐（音乐 RMS ≈0.10）`);

  // 顶部限幅器：只兜峰值，保证玩家把音乐拉到 100% 也不削波
  ok('V32-f', () => /this\.bgmComp = ctx\.createDynamicsCompressor\(\)/.test(audio)
    && /this\.bgmBus\.connect\(this\.bgmComp\)/.test(audio)
    && /this\.bgmComp\.connect\(this\.musicGain\)/.test(audio),
    'BGM 链路插入限幅器（bgmBus → bgmComp → musicGain）');
  ok('V32-g', () => /this\.bgmComp\.threshold\.value = -6/.test(audio)
    && /this\.bgmComp\.ratio\.value = 20/.test(audio)
    && /this\.bgmComp\.knee\.value = 0/.test(audio),
    '限幅器只在顶部工作（-6dB / 20:1 / 硬拐点），不做全频压缩以免"抽气"');

  // 配比重做后旧存档的音量平衡必须作废
  ok('V32-h', () => /const VER = 6/.test(audio), '存档版本升到 v6，旧音量平衡不沿用');
});

finish('结果');
