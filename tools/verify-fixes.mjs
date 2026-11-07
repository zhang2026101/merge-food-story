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
import { icon } from '../src/art.js';
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
  eq('A1-f', () => typeof g.retryWeek, 'undefined', '破产不再有「重开本周」，本局直接结束');
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
  eq('A2-w', () => g4.s.devices, { stove: 4, counter: 1, sign: 1, trash: 4 }, '设备等级钳位（垃圾桶 4 级）');
  eq('A2-x', () => g4.s.storage.map((x) => x.key), ['burger'], '非法物品被丢弃');
  eq('A2-y', () => g4.s.stations.food.busy, false, '无 pendingId 的 busy 被纠正');
  ok('A2-z', () => g4.s.customers[0].patience >= 1, '负耐心钳到 ≥1');
  ok('A2-aa', () => Number.isFinite(g4.s.coins), '金币回落为数值');
  eq('A2-ab', () => g4.trashRefundRate, 0.6, 'trash 越界钳到最高级后返还率正常');
  eq('A2-ac', () => g4.stoveMs, 614, 'stove 越界钳到最高级后 getter 正常');
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
  eq('M12-b', ctx.i18n['mode.hint.normal'].includes('仓储'), false, '普通模式提示不再提仓储格数');
  eq('M12-c', ctx.i18n['mode.hint.hard'].includes('仓储'), false, '困难模式提示不再提仓储格数');
  eq('L11-a', ctx.i18n['shop.hint'].includes('一直留着') && !ctx.i18n['shop.hint'].includes('+30'), true, '商店提示只讲「主题会保留」（猫币规则已移到弹层）');
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
  // 深色主题可读性（v2.15）：只翻背景、不翻「表面/弱文字」会得到白卡片配浅灰字（实测 1.9:1），
  // 而继承 body 的默认文字又是固定深色（1.09:1）。下面三条钉住「成套翻转」这件事。
  ok('B32-darkSurfaces', () => ['--surface', '--surface-2', '--surface-accent', '--muted', '--faint', '--warm-ink']
    .every((v) => new RegExp('\\' + v + '\\s*:').test(css)), '深色主题的语义表面色 / 弱文字色已定义为变量');
  ok('B32-darkFlips', () => {
    // applyTheme 里深色分支必须把这些变量都设一遍，少一个就会留下白块或浅灰字
    const m = /const dark = View\.isDarkHex[\s\S]{0,2500}?dataset\.theme/.exec(view);
    if (!m) return false;
    return ['--ink', '--ink-strong', '--surface', '--surface-2', '--surface-accent', '--muted', '--faint', '--warm-ink']
      .every((v) => new RegExp("setProperty\\('" + v + "'").test(m[0]));
  }, 'applyTheme 对深色主题整组翻转描边/正文/表面/弱文字（不是只换背景）');
  // 不用正则（反斜杠经过多层转义极易写坏），直接查字符串的两种写法
  eq('B32-noHardWhite', () => cssCode.includes('background: #fff') || cssCode.includes('background:#fff'),
    false, 'CSS 里没有裸的 background:#fff（深色主题下会变成刺眼白块）');
  // 导入存档码后必须关掉 persist：导入完要 location.reload()，而 reload 触发的 beforeunload
  // 会用内存里的旧状态把刚写入的键覆盖回去。实测会把 owk.hard.unlocked 冲成 false
  // （皮肤能生效是因为它不走 persist），玩家会以为「导入成功了但困难没解锁」。
  ok('B33-importGuard', () => {
    const m = readText('src/main.js');
    const v = readText('src/view.js');
    return m.includes('persistSuppressed') && m.includes('const suppressPersist =')
      && m.includes('removeEventListener(' + "'beforeunload', persist)")
      && v.includes('api.suppressPersist()');
  }, '导入存档码后关掉 persist，避免 reload 前被内存旧状态覆盖');
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
  // 不写死版本号（同一类问题第四次）：只校验形态；真实版本号由 pwa-check 与磁盘 sw.js 对比
  ok('B4-version', () => /const CACHE = 'owk-v\d+'/.test(sw), `缓存名是 owk-vNN 形态（当前 ${(/const CACHE = '([^']+)'/.exec(sw) || [])[1]}）`);
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
  ok('B27-importValidates', () => /JSON\.parse\(v\)/.test(main) && /entries/.test(main), '导入先全量校验再写入（避免半新半旧）');
  ok('B27-exposed', () => /window\.__OWK__ = \{ ctx, game, view, exportSaveCode, importSaveCode/.test(main), '导出/导入挂到 window.__OWK__');
  // v2.16：导入改用游戏内弹层。旧版 window.prompt 在 Android WebView 里未实现，
  // 会「点了没反应、也不报错」，玩家完全不知道发生了什么（MOBILE-TODO P1-2）。
  eq('B27-noPrompt', () => /window\.prompt\s*\(/.test(view), false, '导入不再用 window.prompt（WebView 上会静默失败）');
  ok('B27-importDialog', () => /openImportDialog\s*\(/.test(view) && /id="imp-code"/.test(view), '导入用的是游戏内弹层 + 文本框');
  ok('B27-importLiveCheck', () => /inspectSaveCode/.test(main) && /inspectSaveCode/.test(view), '弹层用 inspectSaveCode 做实时校验（解析与写盘分离）');
  ok('B27-importClean', () => /function cleanSaveCode\(/.test(main) && /cleanSaveCode\(code\)/.test(main), '粘贴内容先清洗再解析（换行/零宽字符）');
  // 判据要落到具体语句：只匹配 /doBtn\.disabled/ 会被 `= false` 那行蒙混过关
  ok('B27-importDisabled', () => /disabled: true/.test(view) && /doBtn\.disabled = true/.test(view) && /doBtn\.disabled = false/.test(view),
    '校验通过前「导入」按钮禁用、通过后才放开');
  ok('B27-importScroll', () => /box\.scrollTop = 0/.test(view), '粘贴长码后滚回开头（确保能看到 OWK1. 前缀）');
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
  // 主页 6 个功能页 + 导入存档码弹层，共 7 处声明 closable
  // （商店 / 成就 / 配方书 / 天气 / 设置 / 猫猫币说明 / 导入存档码）；
  // 少一个就会有玩家被逼着滚到底部才能退出
  const closableCount = (view.match(/closable: true,/g) || []).length;
  eq('B9-fiveEntries', closableCount, 7, '六个功能页 + 导入弹层都带 ✕');
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
    && i18n['shop.themeHint'].includes('皮肤') && i18n['shop.themeHint'].includes('主题'), '底部小字说明「猫皮肤随主题变化」');
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
    'recipe.other', 'recipe.costLine', 'recipe.netInline', 'upgrade.bought'];
  eq('V31-a', need.filter((k) => !i18n[k]), [], '新文案全部外置到 i18n');

  // ② 模板里不得再出现这些中文字面量（改文案时漏改的典型位置）
  const leftover = ['先备：', '其他配方', '今日无固定菜单', '升级返还 ', '净利 ¥', '>营业<']
    .filter((s) => view.includes(s));
  eq('V31-b', leftover, [], 'view.js 不再残留硬编码中文文案');

  ok('V31-c', () => /this\.t\('recipe\.prep'/.test(view) && /this\.t\('hud\.operating'\)/.test(view),
    '配方书「先备」与 HUD「营业中」已走 i18n');

  // ③ 可爱化不能把事实改掉 —— 这些片段是玩法说明，测试与玩家都依赖
  ok('V31-d', () => !/仓储/.test(i18n['mode.hint.normal'] + i18n['mode.hint.hard']),
    '两个模式说明不再提仓储格数');
  ok('V31-e', () => i18n['shop.hint'].includes('一直留着')
    && i18n['shop.themeHint'].includes('皮肤'),
    '商店两条说明的关键事实保留');
  ok('V31-f', () => !('upgrade.refund' in i18n) && !('upgrade.noRefundFirst' in i18n)
    && i18n['delivery.sending'].includes('骑手开始配送')
    && i18n['delivery.riderHere'].includes('骑手已到'),
    '升级返还文案已随机制移除；外卖关键文案未被改写');
  // ④ 数值占位符不能被吞掉（改文案最容易犯的错）
  ok('V31-g', () => ['settle.recycle', 'settle.spoiled', 'ex.rule', 'ex.note', 'cat.income.bonusNote', 'cat.income.achNote']
    .every((k) => /\{[a-z]+\}/.test(i18n[k] || '')),
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

// ============================================================ v2.17：4 道新配方 + 通用合成台 + 一键提交
section('V217 通用合成台 / 一键提交 / 新配方（源码级契约）', () => {
  const view = readText('src/view.js');
  const engine = readText('src/engine.js');
  const art = readText('src/art.js');
  const css = readText('src/style.css');

  // ---- 配置：能力开关必须在配置里，不能被写死进代码 ----
  eq('V217-cfg-slots', [ctx.config.stations.universal.inputSlots, ctx.config.stations.universal.outputSlots], [2, 1], '通用台 2 入 1 出');
  eq('V217-cfg-factor', ctx.config.stations.universal.timeFactor, [1.5, 1.45, 1.4, 1.35], '读条系数按灶台等级写在配置里（每级收敛 0.05）');
  // v2.18：forbidsIntermediate 由 true 改为 false（用户要求「通用台可制作所有内容，包括半成品」）。
  // 判据仍是「两个开关都在配置里且类型正确」，只是期望值跟着产品口径走；
  // 机制本身没删（stationForbidsIntermediate 仍在，改回 true 立刻恢复拦截），见 V217-eng-data-driven。
  eq('V217-cfg-flags', [ctx.config.stations.universal.acceptsAll, ctx.config.stations.universal.forbidsIntermediate], [true, false], '通吃开着、禁中间产物已关（v2.18 起通用台能做半成品），两个开关仍都在配置里');
  ok('V217-cfg-note', () => typeof ctx.config.stations.universal.note === 'string' && ctx.config.stations.universal.note.length > 10, '通用台配置带注释说明');

  // ---- 引擎：能力判定走配置，没有 === 'universal' 的硬编码分支 ----
  ok('V217-eng-data-driven', () => /stationAcceptsAll\(/.test(engine) && /stationForbidsIntermediate\(/.test(engine), '工位能力走配置开关');
  eq('V217-eng-nohardcode', () => /=== *'universal'/.test(engine), false, '引擎里没有 === universal 的硬编码分支');
  ok('V217-eng-add', () => /if \(stationKey && !this\.stationAcceptsAll\(stationKey\)\) \{/.test(engine), 'addIngredient 的 wrongStation 判定放过通吃工位');
  ok('V217-eng-mismatch', () => /const acceptAll = this\.stationAcceptsAll\(stationKey\);/.test(engine), 'stationMismatch 同样放过通吃工位');
  eq('V217-eng-guard3', () => (engine.match(/this\.craftGuard\(/g) || []).length, 3, 'craftGuard 在 addIngredient / moveItem / combine 三处都插上了');
  ok('V217-eng-duration', () => /stationDuration\(stationKey, recipeId\)/.test(engine) && /st\.duration = this\.stationDuration/.test(engine), '读条时长统一走 stationDuration（通用台 = stoveMs × timeFactor）');
  ok('V217-eng-click', () => /const target = stationKey \|\| this\.stationOfIngredient\(ingKey\) \|\| s\.selectedStation;/.test(engine), '点击投料仍按配方归属自动选台（原有行为不变）');
  ok('V217-eng-allsigns', () => /blankStations\(\)/.test(engine) && !/stations: \{ food: this\.blankStation/.test(engine), 'newRun 的工位集合由配置推导（不再写死 food/drink）');
  ok('V217-eng-resume', () => /const keys = new Set\(\['food', 'drink', \.\.\.Object\.keys\(this\.cfg\.stations \|\| \{\}\)\]\);/.test(engine), '读档时同样覆盖配置里的全部工位');

  // ---- 一键提交：引擎 + 视图 ----
  ok('V217-eng-submit', () => /submitFromStorage\(\) \{/.test(engine), '引擎提供 submitFromStorage()');
  ok('V217-eng-submit-sort', () => /sort\(\(a, b\) => \(a\.c\.patience - b\.c\.patience\) \|\| \(a\.i - b\.i\)\)/.test(engine), '按剩余耐心升序分配（最急的优先，等值保持入场顺序）');
  ok('V217-eng-submit-reuse', () => /const r = this\.serve\(item, c\);/.test(engine), '提交复用 serve()（不另写一套交付逻辑）');
  ok('V217-eng-slot', () => /fitsSlot\(itemKey, slot\) \{/.test(engine) && /slotFor\(customer, itemKey\) \{/.test(engine), '槽位匹配抽成 fitsSlot / slotFor，serve 与一键提交共用');
  ok('V217-eng-submit-product', () => /kindOf\(it\.key\) === 'product'/.test(engine), '只扫仓库里的可售成品（半成品/失败品跳过）');
  ok('V217-eng-submit-nodelivery', () => !/submitFromStorage[\s\S]{0,1600}(pickupDelivery|s\.deliveries)/.test(engine), '一键提交完全不碰外卖');
  ok('V217-view-btn', () => /id="submit-btn"[\s\S]{0,140}data-act="submit"/.test(view), '仓储行里有「一键提交」按钮');
  ok('V217-view-btn-act', () => /act === 'submit'/.test(view), '按钮动作已接线');
  ok('V217-view-cd', () => /const cd = 280/.test(view) && /this\.lastSubmitAt/.test(view), '按钮有 280ms 防连点冷却');
  ok('V217-view-btn-disable', () => /btn\.disabled = true/.test(view) && /btn\.disabled = false/.test(view), '点击期间禁用按钮（双保险）');
  ok('V217-view-toast', () => ['storage.submitDone', 'storage.submitEmpty', 'storage.submitNoCustomer', 'storage.submitNoMatch']
    .every((k) => view.includes("'" + k + "'")), '成功 / 各种失败都有 toast 文案');

  // ---- 通用台渲染：与两种专用台共用同一套钩子 ----
  ok('V217-view-uni', () => /buildUniversal\(\)/.test(view) && /data-panel-station="\$\{key\}"/.test(view), '通用台单独构建，且共用 data-panel-station 钩子');
  ok('V217-view-loop', () => /for \(const key of Object\.keys\(s\.stations\)\)/.test(view), 'renderStations 按 s.stations 遍历（不再写死 food/drink）');
  eq('V217-view-hardcode', () => /\['food', 'drink'\]/.test(view), false, 'view 里不再有写死的工位键数组');
  ok('V217-view-uni-slot', () => /--uni-slot/.test(view) && /--uni-slot/.test(css), '通用台格位走 --uni-slot（不套 82px 的 stationSlot）');
  ok('V217-view-uni-compact', () => /const compact = panel\.classList\.contains\('uni'\)/.test(view), '扁格位里不再塞「咕嘟咕嘟…」整行字（改由右侧进度条表达）');

  // ---- 布局文档 ----
  // v2.18：通用台搬进操作列。判据一律用**互相比对**（不写死 640/470/107/54），
  // 这样以后正常调尺寸不会误伤，只有「真的没和操作列/三台没对齐」才会红 ——
  // 上一次的教训就是断言里写死旧坐标，改一次布局红一片。
  const buffer = ctx.layout.regions.find((r) => r.id === 'bufferRow');
  ok('V217-layout-buffer', () => /通用合成台/.test(buffer.content) && buffer.reusedBy === 'universalStation', 'bufferRow 注明空间已由通用台接管');
  const uniRegion = ctx.layout.regions.find((r) => r.id === 'universalStation');
  const opRegion = ctx.layout.regions.find((r) => r.id === 'operation');
  const sz = ctx.layout.sizing;
  ok('V217-layout-rect', () => Array.isArray(uniRegion.rect) && uniRegion.rect.length === 4
    && uniRegion.rect[0] === opRegion.rect[0]
    && uniRegion.rect[2] === opRegion.rect[2]
    && uniRegion.rect[1] >= opRegion.rect[1]
    && uniRegion.rect[1] + uniRegion.rect[3] <= opRegion.rect[1] + opRegion.rect[3],
  `通用台 rect 与操作列对齐：左边缘 ${uniRegion.rect[0]}=${opRegion.rect[0]}、宽度 ${uniRegion.rect[2]}=${opRegion.rect[2]}，且整块落在操作列内`);
  ok('V217-layout-slot', () => typeof sz.stationSlot === 'number' && sz.stationSlot >= 48, `格位令牌 stationSlot 存在且不低于 48 的触控底线（当前 ${sz.stationSlot}）`);
  eq('V217-layout-w', () => uniRegion.rect[2], sz.opW, '通用台宽度 = 操作列宽 opW（不写死具体数值）');

  // ---- v2.18：三个合成台竖排（顺序 / 均分高度 / 单一格位令牌） ----
  ok('V218-layout-op', () => /三个合成台/.test(opRegion.content) && /竖排/.test(opRegion.content) && !/不在本区/.test(opRegion.content), 'operation 区说明改成「三个合成台竖排」，且不再声称通用台在别处');
  ok('V218-layout-slot-single', () => sz.universalSlot === undefined && sz.universalW === undefined, '格位尺寸收敛成 stationSlot 一个令牌（universalSlot / universalW 已下线）');
  ok('V218-layout-uni-h', () => Math.abs(uniRegion.rect[3] - (opRegion.rect[3] - 2 * sz.gap) / 3) <= 2, `通用台高度 = 操作列三分之一的均分值（${uniRegion.rect[3]} ≈ (${opRegion.rect[3]} − 2×${sz.gap}) / 3）`);
  ok('V218-layout-stack', () => uniRegion.rect[1] >= opRegion.rect[1] + 2 * (uniRegion.rect[3] + sz.gap) - 2, `通用台排在食物台 / 甜品台之后（y ${uniRegion.rect[1]} ≥ ${opRegion.rect[1]} + 2×(高+gap)）`);
  eq('V218-layout-buffer-keep', [buffer._deprecated, buffer.reusedBy], [true, 'universalStation'], 'bufferRow 的 _deprecated / reusedBy 历史留档没被删（M19-a 依赖）');

  // ---- 新配方图标：必须真的有一张独立 SVG，不能回落到失败品 ----
  const newIds = ['cheeseFries', 'latte', 'milkTea', 'hashBrown'];
  for (const id of newIds) {
    ok(`V217-art:${id}`, () => /<svg/.test(icon(id)) && icon(id) !== icon('fail'), `${id} 有自己的手绘图标（不是空白/失败品兜底）`);
    ok(`V217-art-shape:${id}`, () => new RegExp('^ {2}' + id + ': `', 'm').test(art), `${id} 的图形写在 art.js 的 SHAPES 里`);
  }

  // ---- i18n：新菜名与新 UI 文案全部外置 ----
  ok('V217-i18n-dish', () => ['food.cheeseFries', 'food.hashBrown', 'drink.latte', 'drink.milkTea'].every((k) => !!ctx.i18n[k]), '四道新菜的菜名齐备');
  ok('V217-i18n-ui', () => ['station.universal', 'station.universalNote', 'storage.submit', 'storage.submitTitle', 'toast.noIntermediate']
    .every((k) => !!ctx.i18n[k]), '新 UI 文案齐备（均已外置到 i18n）');
  eq('V217-i18n-nodish', () => newIds.filter((id) => ctx.i18n['food.' + id] && ctx.i18n['drink.' + id]).length, 0, '每道新菜只有一个命名空间（food.* 或 drink.*）');

  // ---- 样式：新 UI 只用语义变量，禁止裸色 / 白块 ----
  const uniBlocks = (css.match(/\.(?:uni|submit-btn)[^{]*\{[^}]*\}/g) || []).join('\n');
  ok('V217-css-uni', () => uniBlocks.includes('var(--surface)') && uniBlocks.includes('var(--surface-accent)'), '通用台 / 一键提交用语义变量铺底');
  ok('V217-css-nohex', () => !/(?:background|background-color|color)\s*:\s*#[0-9a-fA-F]{3,8}/.test(uniBlocks), '新 UI 没有裸写的十六进制背景/文字色（深色主题才不会出白块）');
  ok('V217-css-ink-strong', () => /\.submit-btn\s*\{[^}]*color:\s*var\(--ink-strong\)/.test(css) && /\.uni-name\s*\{[^}]*color:\s*var\(--ink-strong\)/.test(css), '文字色用 --ink-strong（--ink 只做描边）');
  // v2.18 定稿判据（v2.18 初版要求 .shelf 有 grid-column: 1 / -1，即仓储行横跨两列；
  // 同一批未发布的 v2.18 改动里把这个拓扑改掉了，所以这条跟着改，断言条数不变）。
  // 为什么改：操作列改成 grid-row: 1 / span 2 之后，仓储行如果还横跨两列就会钻到操作列底下，
  // 所以正确的拓扑变成「右列跨 2 行 + 左列第 2 行归仓储行」。
  // 新判据为什么不会放过回归：两条是互相比对的 —— 只要有人把 .op 改回 grid-row: 1（操作列缩回一行，
  // 下方又空出 104px），或者把 .shelf 改回 grid-column: 1 / -1（又压到右列），这条立刻红；
  // 判据里不写死 440 / 622 / 141 这类坐标，改尺寸不会误伤。
  ok('V217-css-row', () => {
    const opSpansTwoRows = /\.op\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2/.test(css);
    const shelfLeftOnly = /\.shelf\s*\{[^}]*grid-column:\s*1\s*;/.test(css)
      && !/\.shelf\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css);
    return opSpansTwoRows && shelfLeftOnly && /grid-template-rows:\s*minmax\(0, 1fr\) auto/.test(css);
  }, '操作列跨两行（.op 的 grid-row: 1 / span 2）+ 仓储行只占左列（.shelf 的 grid-column: 1，不再是 1 / -1）');

  // ---- v2.18：样式层 —— 仓储行收缩、格位令牌收敛、通用台容器不进布局 ----
  // 判据同样不写死数值：格位那两个变量「互相比对 + ≥48」，改尺寸不会误伤。
  const cssPx = (name) => {
    const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(css);
    return m ? parseFloat(m[1]) : null;
  };
  // v2.18 定稿判据（v2.18 初版要求 .shelf 有 width: max-content + .shelf .store 是 flex: 0 0 auto，
  // 即「仓储行收缩到内容宽度」；同一批未发布改动里用户把口径改成「仓储行铺满左列、垃圾桶贴右端」，
  // 所以这条必须反向 —— 新判据正是原判据的镜像：不能有 max-content，且 .store 必须能吃掉剩余宽度。
  // 为什么不弱化：初版那条锁的是「收缩」，这条锁的是「不收缩 + 可增长」，
  // 只要有人把 width: max-content 加回来（右侧又留白）或把 .store 改回 flex: 0 0 auto
  // （仓库缩成一团、垃圾桶不再贴右端），这条立刻红。
  ok('V218-css-shelf-shrink', () => {
    const noShrink = !/\.shelf\s*\{[^}]*width:\s*max-content/.test(css);
    const storeGrows = /\.shelf \.store\s*\{[^}]*flex:\s*1 1 auto/.test(css);
    return noShrink && storeGrows;
  }, '仓储行铺满左列（不再 width: max-content，且 .shelf .store 为 flex: 1 1 auto 吃掉剩余宽度）');
  ok('V218-css-slot-single', () => {
    const a = cssPx('slot');
    const b = cssPx('uni-slot');
    return a != null && a >= 48 && a === b;
  }, `--slot 与 --uni-slot 同值且不低于 48（${cssPx('slot')} / ${cssPx('uni-slot')}）`);
  ok('V218-css-uni-wrap', () => /\.uni-wrap\s*\{\s*display:\s*contents/.test(css), '通用台的填充容器不进布局（display:contents）—— 三台高度分配同源');
  ok('V218-css-uni-family', () => /\.station\.uni::before/.test(css) && !/\.uni-side\s*\{/.test(css) && !/\.uni-bar\s*\{/.test(css), '通用台复用 .station 结构（旧的紧凑横排 .uni-side / .uni-bar 已删）');

  // ---- v2.18：模板层 —— 通用台必须写在 .stations 里，且不能再写回仓储行 ----
  const shelfBlock = (/<section class="shelf" id="shelf">[\s\S]*?<\/section>/.exec(view) || [''])[0];
  ok('V218-view-uni-not-in-shelf', () => shelfBlock.length > 0 && !/id="universal"/.test(shelfBlock), '仓储行模板里不再有通用台（防止有人又把它塞回仓库行）');
  ok('V218-view-uni-in-stations', () => /id="stations"[\s\S]{0,300}id="universal"/.test(view), '通用台容器写在 #stations 里（三台同一容器，才能均分高度）');

  // ---- v2.17.1 当日菜单池：食物池数据化，新菜入池 ----
  const dl = ctx.config.meta.dayLoop;
  eq('V2171-cfg-food', [Array.isArray(dl.foodPool), Array.isArray(dl.foodPoolHard)], [true, true], 'config.meta.dayLoop 有 foodPool / foodPoolHard');
  ok('V2171-cfg-note', () => typeof dl.poolNote === 'string' && dl.poolNote.length > 10, '池子配置带注释（说明主菜会被 filter 掉）');
  ok('V2171-eng-reads', () => /const dayLoop = this\.cfg\.meta\.dayLoop \|\| \{\};/.test(engine)
    && /const foodCfg = hard \? \(dayLoop\.foodPoolHard \|\| dayLoop\.foodPool\) : dayLoop\.foodPool;/.test(engine),
    'buildMenu 从配置读食物池（困难优先 foodPoolHard）');
  ok('V2171-eng-filter-main', () => /\.filter\(\(x\) => x !== main && this\.byId\.has\(x\)\);/.test(engine), '主菜去重 + 未知 id 过滤保留了（否则困难模式 signatureBurger 会重复）');
  ok('V2171-eng-fallback', () => /const foodFallback = hard \? \['fries', 'salad', 'pizza', 'signatureBurger'\] : \['fries', 'salad', 'pizza', 'burger'\];/.test(engine), '旧硬编码数组留作兜底');
  ok('V2171-eng-drink', () => /const drinkPool = \(\(dayLoop\.drinkPool\) \|\| \['coffee', 'milkshake', 'icedTea'\]\)/.test(engine), '饮品池同样走配置 + 兜底');
});

// ============================================================ v2.19.2 视觉三改（源码级契约）
// 用户看截图后提的三个视觉问题，改动只碰 CSS 令牌 / 骑手图标，引擎与配方一行没动。
// 这里锁的是「改动的方向」而不是具体像素：仓库的 drop-hot 必须没有 box-shadow、
// 格位令牌必须 = 72 且与 layout.json 同源、台高必须容得下 72、骑手必须是黄色袋鼠。
section('v2.19.2 仓库高亮收敛 · 合成台格位 72 · 黄色袋鼠骑手', () => {
  const css = readText('src/style.css');
  const art = readText('src/art.js');
  const view = readText('src/view.js');
  const lay = readJSON('owk_handoff_layout.json');
  // 归一化空白，断言的判据写「规则内容」而不是「排版」
  const css1 = css.replace(/\s+/g, ' ');
  const cssPx = (name) => {
    const m = new RegExp(`(?:^|\\s)--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(css);
    return m ? parseFloat(m[1]) : null;
  };

  // ---- 需求 1：仓库拖拽时的金色大框去掉，但反馈保留（格位描边转金）----
  ok('V2192-css-dropframe-keep',
    () => css1.includes('.drop-hot { box-shadow: 0 0 0 4px var(--gold) inset; }'),
    '通用 .drop-hot 金框仍在 —— 合成台 / 垃圾桶 / 顾客的可放置提示不受本次改动影响');
  ok('V2192-css-store-noframe',
    () => css1.includes('.store.drop-hot, #storage-slots.drop-hot, .slot.sm.drop-hot { box-shadow: none; }'),
    '仓库（.store / #storage-slots / 单个 .slot.sm）命中 drop-hot 时一律 box-shadow: none（整块金框已去掉）');
  ok('V2192-css-store-slot-gold',
    () => css1.includes('.store.drop-hot .slot.sm, #storage-slots.drop-hot .slot.sm, .slot.sm.drop-hot { border-color: var(--gold); }'),
    '仓库格位描边转金（虚线金边替代大金框，玩家仍能看出「这里能放」）');
  ok('V2192-css-store-slot-filled',
    () => css1.includes('.slot.sm.filled.drop-hot { border-color: var(--gold); }'),
    '已填格位悬停也转金（不被 .slot.filled 的 --ink 描边盖掉）');
  ok('V2192-view-storage-drop',
    () => /data-drop="storage"/.test(view) && /id="storage-slots" data-drop="storage"/.test(view),
    '仓库投放区仍是 .store + #storage-slots 两层 data-drop（选择器命中的是真实 DOM，不是猜的）');

  // ---- 需求 2：合成台格位 54 → 72（CSS 令牌与 layout.json 同源）----
  eq('V2192-css-slot-72', cssPx('slot'), 72, 'style.css --slot 放大到 72px');
  eq('V2192-css-uni-slot-72', cssPx('uni-slot'), 72, 'style.css --uni-slot 同步 72px（通用台不再单独一套尺寸）');
  eq('V2192-layout-station-slot', lay.sizing.stationSlot, 72, 'layout.json sizing.stationSlot 放大到 72');
  eq('V2192-layout-slot-pair', lay.sizing.stationSlot, lay.sizing.storeSlot,
    '合成台格位与仓库格位同尺寸（stationSlot === storeSlot）');
  ok('V2192-geom-slot-fits', () => {
    const op = lay.regions.find((r) => r.id === 'operation');
    const stationH = (op.rect[3] - 2 * lay.sizing.gap) / 3; // 三台均分操作列
    // 台内固定开销：上下边框 5 + 上下内边距 9 + 标题行 23.1 + 进度条(8 + 4) + .st-body 的 padding-top 3
    const chrome = 5 + 9 + 23.1 + 12 + 3;
    return stationH - chrome >= lay.sizing.stationSlot + 2;
  }, `台高 ${((lay.regions.find((r) => r.id === 'operation').rect[3] - 2 * lay.sizing.gap) / 3).toFixed(1)} 扣掉边框/内边距/标题行/进度条后仍容得下 72 的格位（静态估算：不裁切）`);

  // ---- 需求 3：骑手是「黄色袋鼠」（造型特征由 interact-check 在浏览器里按包围盒验）----
  const riderSrc = (/export function riderSVG\(\)[\s\S]*?\r?\n\}/.exec(art) || [''])[0];
  ok('V2192-art-rider-fn', () => riderSrc.length > 300, 'riderSVG() 仍是 art.js 里独立的函数');
  ok('V2192-art-rider-viewbox', () => riderSrc.includes('viewBox="0 0 128 160"'),
    'viewBox 仍是 0 0 128 160（.figure 的 aspect-ratio 依赖它，改了会变形）');
  // v2.19.2：用户提供参考图后改为「3D 玩偶风 + 允许渐变」，这条从「必须简笔画」反转成
  // 「必须是渐变立体风」—— 判据方向变了，不是放宽：现在但凡有人把它改回纯色平涂会红。
  ok('V2192-art-rider-stroke', () => !riderSrc.includes('stroke="#2B2B2B"')
    && !/stroke-width="4\.4"/.test(riderSrc),
  '不再复用全站的黑粗描边（3D 块面靠明暗分层，不用线稿勾边）');
  ok('V2192-art-rider-grad', () => /linearGradient/.test(riderSrc) && /radialGradient/.test(riderSrc)
    && !/<image|filter=/.test(riderSrc),
  '用渐变做立体感（linear + radial），且不用外部图片 / 重滤镜');
  ok('V2192-art-rider-grad-id', () => {
    const ids = [...riderSrc.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    return ids.length > 0 && ids.every((id) => id.startsWith('rider-'));
  }, '渐变 id 一律 rider- 前缀，避免与页面其它内联 SVG 撞车');
  ok('V2192-art-rider-yellow', () => ['#FFE066', '#F9C22E', '#E09112', '#FACB3A'].every((c) => riderSrc.includes(c)),
    '主色调是黄色系（亮黄 / 主黄 / 暗部 / 头部高光四档）');
  ok('V2192-art-rider-no-orange', () => !riderSrc.includes('#E8763A'),
    '旧的橙色夹克 / 头盔 #E8763A 已从骑手身上移除');
  // 参考图是纯袋鼠、没有背包，骑手身份改由气泡上的「外卖」角标承担（见 V2192-rider-tag）
  ok('V2192-rider-tag', () => /rdr-tag/.test(view) && /delivery\.tag/.test(view),
    '骑手身份由气泡左上角的「外卖」角标标识（SVG 不再画外卖箱）');
  ok('V2192-art-rider-features', () => /耳朵/.test(riderSrc) && /鼻头/.test(riderSrc)
    && /肚子/.test(riderSrc) && /尾巴/.test(riderSrc),
  '函数体内的注释写明四个袋鼠识别特征（耳朵 / 鼻头 / 肚子 / 尾巴），后续改动有据可依');
  ok('V2192-view-rider-hooks', () => /data-act="rider"/.test(view) && /data-drop="delivery"/.test(view)
    && /order: 9999/.test(readText('src/style.css')),
  '骑手的 DOM 位置与交互钩子没动（data-act / data-drop / order:9999 仍在）');
});

// ============================================================ v2.20.0 紧凑画布档 · 安全区 · 局中落盘 · 返回键
// 这一轮的目标是「APK 打包前的手机体验」：分档让手机横屏有更大的物理像素，
// 安全区让刘海不吃 HUD，局中落盘 + 返回键确认避免进度丢失。
// 判据全部是「契约级」的：令牌值、档位阈值、数据源（#safe 而不是 innerWidth）、
// 落盘触发点、返回键链路。具体像素由 interact-check 的 V220-* 在浏览器里实测。
section('v2.20.0 紧凑档 · 安全区 · 局中落盘 · 返回键', () => {
  const main = readText('src/main.js');
  const cssRaw = readText('src/style.css');
  const css1 = cssRaw.replace(/\s+/g, ' ');
  const html = readText('index.html');
  const viewSrc = readText('src/view.js');
  const engineSrc = readText('src/engine.js');
  const pkg = readJSON('package.json');
  const manifest = readJSON('pwa/manifest.webmanifest');
  const i18n = readJSON('owk_handoff_i18n.json');
  const swSrc = readText('sw.js');

  // ---- 1) 分档：阈值 500，紧凑档 600 / minAspect 1120÷600 ----
  eq('V220-fit-threshold', /COMPACT_MAX_HEIGHT\s*=\s*500\b/.test(main), true,
    '紧凑档阈值 COMPACT_MAX_HEIGHT = 500（与 style.css 媒体查询同源）');
  ok('V220-fit-compact-tokens', /FIT_COMPACT\s*=\s*\{[^}]*height:\s*600\b/.test(main)
    && /FIT_COMPACT\s*=\s*\{[^}]*minAspect:\s*1120\s*\/\s*600\b/.test(main),
  '紧凑档是 FIT_COMPACT = { height: 600, minAspect: 1120/600, maxAspect: 2.35 }');
  ok('V220-fit-base-kept', /FIT_BASE\s*=\s*\{\s*height:\s*660\b/.test(main)
    && /maxAspect:\s*2\.35/.test(main),
  '基准档仍是 660（平板 / 桌面零退化），maxAspect 2.35 两档共用');
  ok('V220-fit-uses-innerHeight', /window\.innerHeight\s*<\s*COMPACT_MAX_HEIGHT/.test(main),
    '档位判定读 window.innerHeight（设备姿态语义，不被刘海内缩误伤）');
  ok('V220-fit-internalized', /function fitStage\(\)[\s\S]{0,400}pickFit\(\)/.test(main),
    'fitStage() 每次重算前先重新选档 —— resize / orientationchange 后能切换档位');

  // ---- 2) 安全区：包裹层 + env() 四值 + fitStage 按包裹层算 ----
  ok('V220-safe-html', /<div id="safe">[\s\S]{0,200}id="stage"/.test(html),
    'index.html 用 #safe 包裹 #stage（安全区内缩的载体）');
  ok('V220-safe-css', ['top', 'right', 'bottom', 'left'].every((k) =>
    new RegExp(`--safe-${k[0]}:\\s*env\\(safe-area-inset-${k}`).test(cssRaw)),
  '#safe 的四个方向都用 env(safe-area-inset-*) 取值（并带 0px 回落，桌面恒为 0）');
  ok('V220-safe-fit-source', /safeLayer\.clientWidth/.test(main) && /safeLayer\.clientHeight/.test(main),
    'fitStage() 的可用区来自 #safe 的 clientWidth/clientHeight（不是 innerWidth，否则内缩白做）');
  ok('V220-safe-not-innerWidth', !/function fitStage\(\)[\s\S]{0,400}window\.innerWidth/.test(main),
    'fitStage() 内部不再读 window.innerWidth');

  // ---- 3) 紧凑档的元素尺寸（媒体查询里用 !important 覆盖 view.js 写的内联变量）----
  const mediaBlock = (/@media \(max-height: 500px\)\s*\{([\s\S]*)\n\}/.exec(cssRaw) || ['', ''])[1];
  ok('V220-compact-media', mediaBlock.length > 500, `存在 @media (max-height: 500px) 紧凑档（${mediaBlock.length} 字符）`);
  const mediaTok = (name) => {
    const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px\\s*!important`).exec(mediaBlock);
    return m ? parseFloat(m[1]) : null;
  };
  eq('V220-compact-hud-h', mediaTok('hud-h'), 70, '紧凑档 --hud-h = 70px !important（物理 45.5）');
  eq('V220-compact-slot', mediaTok('slot'), 78, '紧凑档 --slot = 78px !important（物理 50.7）');
  eq('V220-compact-uni-slot', mediaTok('uni-slot'), 78, '紧凑档 --uni-slot 同步 78px');
  ok('V220-compact-act', /\.act\s*\{\s*height:\s*54px/.test(mediaBlock),
    '紧凑档 HUD 按钮 .act 高 54px（物理 35.1 + 纵向热区 = 44.2）');
  ok('V220-compact-act-heat', /\.act::after\s*\{\s*inset:\s*-7px\s+-4px/.test(mediaBlock),
    '.act 的透明热区纵向 -7px（54+14=68 逻辑 → 44.2 物理），横向只 -4px 避免相邻按钮互抢');
  ok('V220-compact-dismiss', /\.dismiss\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/.test(mediaBlock),
    '紧凑档气泡 × 放大到 40×40（物理 26，改动前 14.2）');
  // QA 复测抓到的回归：× 放大后中心被 .order 里的 .ord（position:relative，DOM 在后）盖住，
  // elementFromPoint(中心) 返回图标 → 中心区域点不动。紧凑档必须给按钮一个 z-index。
  ok('V220-compact-dismiss-z', /\.dismiss\s*\{[^}]*z-index:\s*2/.test(mediaBlock),
    '紧凑档 .dismiss 带 z-index:2（否则放大后被订单图标盖住、中心是死区 —— 浏览器侧由 V220-9a/b/c 兜底）');
  ok('V220-compact-bubble-noshrink', /\.bubble\s*\{\s*flex:\s*0 0 auto/.test(mediaBlock)
    && /\.figure\s*\{\s*min-height:\s*0/.test(mediaBlock),
  '紧凑档气泡不参与收缩（flex:0 0 auto）、顾客图可让位（min-height:0）—— 气泡不会被压出容器');
  ok('V220-compact-station-chrome', /\.st-head[^{]*\{|\.st-name\s*\{\s*font-size:\s*18px/.test(mediaBlock)
    && /\.st-bar\s*\{\s*height:\s*6px/.test(mediaBlock),
  '紧凑档把台内固定开销压薄（标题行 18px / 进度条 6px），78 的格位才装得进 118 的台子');

  // ---- 4) 应用名（角色名「小灶猫」不动）----
  eq('V220-manifest-short-name', manifest.short_name, '食合物语', 'manifest.short_name 改为「食合物语」');
  eq('V220-manifest-name-kept', manifest.name, '食合物语｜Merge Food Story', 'manifest.name 未动');
  ok('V220-apple-title', /apple-mobile-web-app-title" content="食合物语"/.test(html),
    'index.html 的 apple-mobile-web-app-title 改为「食合物语」');
  eq('V220-no-stray-rename',
    /小灶/.test(JSON.stringify(i18n) + JSON.stringify(readJSON('owk_handoff_config.json'))
      + JSON.stringify(readJSON('owk_handoff_crafts.json'))),
    false,
    '运行时文案 / 配置 / 配方里没有旧名「小灶」的残留（改名只落在 manifest.short_name 与 apple-title 两处）');
  eq('V220-cat-skin-kept', readJSON('owk_handoff_config.json').catSkins.skins[0].themeName, '暖橘小店',
    '猫猫皮肤 / 主题名（角色名同批）未被改名波及');
  // ---- 4b) 版本号 / SW 缓存名：只验「格式合法 + 文档与代码一致」，**不写死具体版本** ----
  // 为什么不写死：旧的 tools/v212-sw-fresh.mjs 把 'owk-v30' / '2.12.0' 钉在断言里，升到 v31 / 2.12.1
  // 之后立刻假红 2 条 —— 看着像功能坏了，其实只是测试没跟上版本，白花时间排查。
  // 现在改成三条不会随版本失效的断言：
  //   ① package.json.version 是合法 semver；
  //   ② 它与 PROJECT.md 头部「版本基线：vX.Y.Z」一致；
  //   ③ sw.js 的 CACHE 形如 owk-v<数字>，且与 PROJECT.md 头部「sw vN」一致。
  // 这样既保留「缓存名格式正确」，又多验一层「文档与代码不脱节」，下次升版也不会假红。
  const projHead = (readText('PROJECT.md').split(/\r?\n/).find((l) => /版本基线/.test(l)) || '');
  const declaredVer = (/版本基线[:：]\s*v(\d+\.\d+\.\d+)/.exec(projHead) || [])[1] || '';
  const declaredSw = (/\bsw\s*v(\d+)\b/.exec(projHead) || [])[1] || '';
  const swCache = (/const\s+CACHE\s*=\s*'([^']+)'/.exec(swSrc) || [])[1] || '';
  ok('V220-version-semver', /^\d+\.\d+\.\d+$/.test(pkg.version),
    `package.json 的 version 是合法 semver（当前 ${pkg.version || '缺失'}）`);
  eq('V220-version', pkg.version, declaredVer,
    'package.json 版本与 PROJECT.md 头部「版本基线」一致（升版必须两处同改）');
  ok('V220-sw-cache-format', /^owk-v\d+$/.test(swCache),
    `sw.js 的 CACHE 形如 owk-v<数字>（当前 ${swCache || '缺失'}）`);
  eq('V220-sw-cache', swCache, declaredSw ? `owk-v${declaredSw}` : '',
    'sw.js 缓存名与 PROJECT.md 头部「sw vN」一致（改缓存名必须同步文档）');

  // ---- 5) 局中落盘 ----
  ok('V220-persist-interval', /PERSIST_INTERVAL_MS\s*=\s*10000/.test(main),
    '局中定时落盘间隔 10s（上限，不能再密）');
  ok('V220-persist-in-loop', /function loop\(now\)[\s\S]{0,1200}PERSIST_INTERVAL_MS/.test(main),
    '定时落盘复用现有帧循环（不新开 setInterval，不会泄漏）');
  ok('V220-persist-hidden', /visibilitychange[\s\S]{0,260}persist\(\);[\s\S]{0,260}togglePause\(\)/.test(main),
    'visibilitychange 变 hidden 时**先 persist 再暂停**');
  ok('V220-persist-pagehide', /addEventListener\('pagehide',\s*persist\)/.test(main),
    'pagehide 也落盘（iOS 上 beforeunload 常不触发）');

  // ---- 6) 返回键 ----
  ok('V220-back-guard', /history\.pushState\(BACK_STATE/.test(main) && /addEventListener\('popstate'/.test(main),
    'pushState 建立历史基线 + 监听 popstate（没有基线 popstate 不会触发）');
  ok('V220-back-rearm', /const onBack = \(\) => \{[\s\S]{0,300}armBackGuard\(\)/.test(main),
    '局中把基线续压回去（连按两次返回也不会退出，不会陷入死循环）');
  ok('V220-back-persist', /const onBack = \(\) => \{[\s\S]{0,400}persist\(\)/.test(main),
    '按返回先落盘再问');
  // v2.20.0 收尾：confirmBack 除了「弹二次确认 + 取消回暂停面板」，还必须**打开前先冻结**。
  // 判据改成在 confirmBack 函数体内做三次语义检查（比原来「900 字符窗口里出现 showPauseModal」
  // 更严，也不再因为注释变长而误判窗口溢出）。
  const confirmBody = (/confirmBack\(\{[\s\S]*?\n  \}/.exec(viewSrc) || [''])[0];
  ok('V220-back-confirm', () => /view\.confirmBack\(\{/.test(main) && confirmBody.length > 400
    && /if\s*\(!wasPaused\)\s*\{[\s\S]{0,140}togglePause\(\)/.test(confirmBody)
    && /this\.shopPaused\s*=\s*true/.test(confirmBody)
    && /showPauseModal\(\)/.test(confirmBody),
  `局中返回：main.js 调 view.confirmBack()，弹层打开前先冻结（if(!wasPaused) togglePause + shopPaused，closeModal 自动解冻），取消后放回暂停面板（函数体 ${confirmBody.length} 字符）`);
  ok('V220-back-capacitor', /__OWK_BACK__/.test(main) && /App\.addListener\('backButton'/.test(main),
    '预留 Capacitor App.backButton 接入点（原生返回键不派发 popstate，必须转发）');
  eq('V220-engine-untouched', /localStorage|popstate|history\./.test(engineSrc), false,
    '引擎层一行未动（落盘 / 返回键全在 main.js 层）');
});

// ============================================================ v2.20.1：成就阈值外置 + catCoins 死成就
section('V221 成就阈值外置（config ↔ engine 双向一致）与猫币累计', () => {
  const eng = readText('src/engine.js');
  const mainSrc = readText('src/main.js');
  const cfg = readJSON('owk_handoff_config.json');
  const thr = (cfg.achievements && cfg.achievements.thresholds) || {};

  // ---- 1) 阈值表存在且是「语义名 → 数字」 ----
  const cfgKeys = Object.keys(thr).filter((k) => k !== 'note').sort();
  ok('V221-1a', cfgKeys.length >= 20, `config.achievements.thresholds 存在（${cfgKeys.length} 个语义阈值键）`);
  eq('V221-1b', cfgKeys.filter((k) => typeof thr[k] !== 'number'), [], '所有阈值都是数字（note 除外）');

  // ---- 2) 双向一致：配置里的键都被代码读，代码读的键都在配置里 ----
  // 这条能防两类回归：配置里加了没人读的死键 / 代码里读了配置没有的键（永远走 fallback，
  // 于是「改配置不生效」却没人发现）。
  const calls = [...eng.matchAll(/_achN\('([A-Za-z0-9_]+)',\s*(-?\d+(?:\.\d+)?)\)/g)]
    .map((m) => [m[1], Number(m[2])]);
  const codeKeys = [...new Set(calls.map((c) => c[0]))].sort();
  eq('V221-2a', cfgKeys.filter((k) => !codeKeys.includes(k)), [], '配置里的每个阈值键都被 engine.js 的 _achN() 读到（无死键）');
  eq('V221-2b', codeKeys.filter((k) => !cfgKeys.includes(k)), [], 'engine.js 读的每个键都在配置里（不会静默走 fallback）');
  // fallback 必须与原字面量同值，否则「配置缺失」与「配置存在」两种行为会悄悄分叉
  const drift = calls.filter(([k, fb]) => thr[k] !== fb).map(([k, fb]) => `${k}: code=${fb} config=${thr[k]}`);
  eq('V221-2c', drift, [], '每个 _achN(key, fallback) 的 fallback 与配置同值');

  // ---- 3) 行为断言：阈值真的从配置读（内存里改小，不动磁盘） ----
  // 注意：`thr` 是上面为了静态比对**重新读盘**得到的对象，和 Game 持有的 ctx.config 不是同一个
  // 引用；运行时改配置必须改 ctx.config 上那一份，否则断言测的是空气。
  const liveThr = ctx.config.achievements.thresholds;
  const gThr = newGame();
  gThr.s.dayStats.earned = 1;
  eq('V221-3a', gThr.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_day_100'),
    false, '营业额 1 < 阈值 100 → 「日进斗金」不解锁');
  const backup = liveThr.dayEarned;
  try {
    liveThr.dayEarned = 1; // 仅内存改动
    const gSmall = newGame();
    gSmall.s.dayStats.earned = 1;
    ok('V221-3b', gSmall.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_day_100'),
      '把 thresholds.dayEarned 改成 1 后，营业额 1 即解锁（阈值确实读配置）');
  } finally {
    liveThr.dayEarned = backup; // 必须还原：ctx 是模块级共享对象
  }

  // ---- 4) catCoins 死成就：装配层必须把本局累计猫币并入 ach.counters ----
  // 旧实现：engine 判定只看 tot.catCoins，而 main.js 的 sumKeys 里没有 catCoins，
  // 该计数器永远是 undefined → ach_cat_30 永不可达，且文案写 30、代码写 300。
  const sumKeysSrc = (/const sumKeys = \[([^\]]*)\]/.exec(mainSrc) || ['', ''])[1];
  ok('V221-4a', /'catCoins'/.test(sumKeysSrc), 'main.js 的 sumKeys 包含 catCoins（跨局累计猫币会被合并）');
  ok('V221-4b', /catCoins:\s*Math\.max\(0,\s*s\.catEarned \|\| 0\)/.test(mainSrc),
    'catCoins 的来源是本局累计 s.catEarned（不是从不累加的 s.ach.catCoins）');
  ok('V221-4c', /catCoins:\s*cur\.catCoins \|\| 0/.test(mainSrc),
    'prev 快照里也记 catCoins 的已合并量（否则重复 flush 会重复累加）');
  // 判定侧：往局 + 本局都要算，且阈值为外置的 30
  ok('V221-4d', /\(tot\.catCoins \|\| 0\) \+ \(s\.catEarned \|\| 0\)/.test(eng),
    'engine 判定 = 往局 tot.catCoins + 本局 s.catEarned');
  eq('V221-4e', thr.catCoins, 30, '猫币成就阈值 = 30（与文案「累计获得 30 枚猫猫币」一致）');
  eq('V221-4f', ctx.i18n['ach.ach_cat_30.desc'], '累计获得 30 枚猫猫币', 'i18n 文案与新阈值一致');

  // ---- 5) 端到端：本局拿满 30 枚猫币后该成就确实能解锁 ----
  const gCat = newGame();
  gCat.s.catEarned = 30;
  ok('V221-5a', gCat.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_cat_30'),
    '本局累计 30 枚猫币 → 「猫猫大户」解锁（死成就已复活）');
});

finish('结果');
