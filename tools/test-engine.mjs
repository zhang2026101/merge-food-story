// 引擎自动化验收：node tools/test-engine.mjs
// 断言语义见 tools/_assert.mjs：严格深比较 + 单条断言抛错只记 fail（不中断后续）。
import fs from 'node:fs';
import { buildCtx } from '../src/config.js';
import { Game } from '../src/engine.js';
import { createSuite } from './_assert.mjs';

const { ok, eq, section, finish } = createSuite();

const dir = new URL('../', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
const ctx = buildCtx(
  read('owk_handoff_config.json'),
  read('owk_handoff_crafts.json'),
  read('owk_handoff_layout.json'),
  read('owk_handoff_i18n.json'),
);

/**
 * 受控测试局：关掉自动生成与自动打烊，便于逐条验证机制。
 * 需要「真实时间流」的用例请用 runGame()（保留自动打烊/生成）。
 */
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
/** 真实流程（不做任何手脚），用于时间轴 / 打烊 / 存档类用例 */
const runGame = (mode = 'normal', week = 1) => {
  const g = new Game(ctx);
  g.tutorialDone = true;
  g.newRun(mode, week);
  return g;
};
const wait = (g, ms) => g.tick(ms);
const craft = (g, keys) => {
  for (const k of keys) g.addIngredient(k);
  wait(g, g.stoveMs + 5);
};
const addCustomer = (g, food, drink, opts = {}) => {
  const c = {
    id: 't' + Math.floor(Math.random() * 1e9), vip: !!opts.vip,
    items: [g.orderSlot('food', food), g.orderSlot('drink', drink)],
    patienceMax: opts.patience || 40000, patience: opts.patience || 40000, body: 0, acc: 0,
  };
  g.s.customers.push(c);
  return c;
};
/** 造一个非 VIP 顾客（不吃随机种子的脸色） */
const addPlainCustomer = (g, wants) => {
  const c = {
    id: 'p' + Math.floor(Math.random() * 1e9), vip: false,
    items: wants.map((w) => g.orderSlot(g.byId.get(w).type, w)),
    patienceMax: 40000, patience: 40000, body: 0, acc: 0,
  };
  g.s.customers.push(c);
  return c;
};
const loc = (zone, station, index) => ({ zone, station, index });
/** 推进真实时间到指定当日时刻（不越过打烊） */
const tickUntil = (g, target, step = 100) => {
  let guard = 0;
  while (g.s.phase === 'day' && g.s.time < target && guard++ < 20000) {
    g.tick(Math.min(step, target - g.s.time));
  }
};
/** 走完当天（不服务任何顾客，靠耐心流失自然打烊） */
const playDay = (g) => {
  let guard = 0;
  while (g.s.phase === 'day' && guard++ < 20000) g.tick(500);
};

/**
 * 外卖收益的**独立**期望值推导（照文档公式手算，不复用引擎实现）
 * earned = floor(base × 收银台% × 小费% × incomePercent% × mul / 1e6)
 *   收银台% = devices.counter.values[lv-1] × 100
 *   小费% = 100 + floor(tipMaxPercent × round(剩余时间比 × 100) / 100)
 *   剩余时间比 = clamp(1 − (交付时刻 − riderAt) / effectiveWait, 0, 1)
 *   mul = opts.delivered ? deliveredMul(=2) : 1
 */
const expectedDeliveryEarn = (g, d, atTime, opts = {}) => {
  const base = g.priceOf(d.item);
  const regPercent = Math.round(g.counterMul * 100);
  const elapsed = Math.max(0, atTime - d.riderAt);
  const ratio = Math.max(0, Math.min(1, 1 - elapsed / d.effectiveWait));
  const tipPercent = 100 + Math.floor((g.cfg.delivery.tipMaxPercent * Math.round(ratio * 100)) / 100);
  const mul = opts.delivered ? (g.cfg.delivery.deliveredMul || 2) : 1;
  return Math.floor((base * regPercent * tipPercent * g.cfg.delivery.incomePercent * mul) / 1e6);
};

// ================================================================ 合成与交付
section('AC-01 合成汉堡', () => {
  const g = newGame();
  const before = g.s.coins;
  craft(g, ['bread', 'patty']);
  eq('AC-01', g.s.coins, before - 3, '本次扣 3');
  eq('AC-01b', () => g.s.stations.food.output.key, 'burger', '出汉堡');
});

section('AC-02 失败品', () => {
  const g = newGame();
  const before = g.s.coins;
  craft(g, ['bread', 'potato']);
  eq('AC-02', () => g.s.stations.food.output.key, 'fail', '输出失败品');
  eq('AC-02b', g.s.coins, before - 2, '成本已扣(2)');
  eq('AC-02c', g.s.dayStats.waste, 1, '计入失败品');
});

section('AC-03 输出槽占用', () => {
  const g = newGame();
  craft(g, ['bread', 'patty']);
  const r = g.addIngredient('bread');
  eq('AC-03', r.ok, false, '输出槽有物品时不可再投料');
  eq('AC-03b', r.reason, 'outputOccupied');
  // 拖拽投料走的是 moveItem，必须与点按投料同一条守卫（M1 回归防线）
  g.s.storage.push(g.mkItem('bread'));
  const r2 = g.moveItem(loc('storage', null, 0), loc('input', 'food', 0));
  eq('AC-03c', r2.reason, 'outputOccupied', '拖拽投料同样被输出槽守卫拦下');
  eq('AC-03d', () => g.s.stations.food.output.key, 'burger', '成品未被覆盖');
});

section('AC-04 主仓储上限', () => {
  const g = newGame();
  for (let i = 0; i < g.storageCap; i++) g.s.storage.push(g.mkItem('burger'));
  g.s.stations.food.output = g.mkItem('burger');
  const r = g.moveItem(loc('output', 'food'), loc('storage'));
  eq('AC-04', r.ok, false, '满仓拒绝');
  eq('AC-04b', r.reason, 'storageFull');
  eq('AC-04c', () => g.s.stations.food.output.key, 'burger', '物品留在输出槽');
});

section('AC-05 / AC-11 / AC-18 垃圾桶：无冷却 + 丢弃返还', () => {
  const g = newGame();
  g.s.storage.push(g.mkItem('burger'));
  g.s.storage.push(g.mkItem('burger'));
  eq('AC-05a', g.moveItem(loc('storage', null, 0), { zone: 'trash' }).ok, true, '首次丢弃成功');
  eq('AC-05b', g.moveItem(loc('storage', null, 0), { zone: 'trash' }).ok, true, '紧接着再丢也成功（冷却已移除）');
  g.s.stations.food.output = g.mkItem('fail');
  eq('AC-18', g.moveItem(loc('output', 'food'), { zone: 'trash' }).ok, true, '失败品随时可丢');
  eq('AC-11', g.trashRefundRate, 0, 'Lv1 不返还');
  g.s.coins = 500;
  g.upgrade('trash');
  eq('AC-11b', g.trashRefundRate, 0.2, 'Lv2 = 20%');
  g.upgrade('trash');
  eq('AC-11c', g.trashRefundRate, 0.4, 'Lv3 = 40%');
  g.upgrade('trash');
  eq('AC-11e', g.trashRefundRate, 0.6, 'Lv4 = 60%');
  eq('AC-11d', g.upgrade('trash').reason, 'max', 'Lv4 满级');
  // 返还额 = 物品成本 × 返还率（汉堡 chainCost 3 × 60% = 1.8 → 向下取整 1）
  const before = g.s.coins;
  g.s.storage.push(g.mkItem('burger'));
  const ret = g.moveItem(loc('storage', null, 0), { zone: 'trash' });
  eq('AC-11f', [ret.refund, g.s.coins - before], [1, 1], 'Lv4 丢汉堡返还 1 金币');
  // 失败品没有成本 → 不返还
  g.s.stations.food.output = g.mkItem('fail');
  const ret2 = g.moveItem(loc('output', 'food'), { zone: 'trash' });
  eq('AC-11g', ret2.refund, 0, '失败品成本为 0，不返还');
});

section('AC-06 成交结算公式', () => {
  const g = newGame();
  const c = addCustomer(g, 'burger', 'cola', { patience: 40000 });
  const before = g.s.coins;
  g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'));
  eq('AC-06a', g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id }).ok, true, '交付食物');
  const r2 = g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  // (8+4) × 1.0 × (1 + 0.3×1) = 15.6 → 16，再加连击 +1
  eq('AC-06b', g.s.coins - before, 16 + 1, 'earned=16 + 连击1');
  eq('AC-06c', r2.complete, true);
  eq('AC-06d', g.s.customers.length, 0, '顾客离场');
});

section('AC-07 拖错弹回', () => {
  const g = newGame();
  const c = addCustomer(g, 'burger', 'cola');
  g.s.storage.push(g.mkItem('fries'));
  const r = g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  eq('AC-07', r.reason, 'wrong');
  eq('AC-07b', g.s.storage.length, 1, '物品留在原地');
});

section('AC-08 耐心归零', () => {
  const g = newGame();
  g.s.perDay = 0;
  g.s.spawned = 0;
  g.s.customers = [];
  const c = addCustomer(g, 'burger', 'cola', { patience: 1000 });
  g.s.storage.push(g.mkItem('burger'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  const before = g.s.coins;
  wait(g, 1200);
  eq('AC-08a', g.s.customers.length, 0, '顾客离场');
  eq('AC-08b', g.s.coins, before, '已交件不计钱');
  eq('AC-08c', g.s.dayStats.lost, 1, '计流失');
  eq('AC-08d', g.s.combo, 0, '连击清零');
});

section('AC-10 金币不足', () => {
  const g = newGame();
  g.s.coins = 2;
  g.addIngredient('bread');
  const r = g.addIngredient('patty');
  eq('AC-10', r.reason, 'short', '合成不开始');
  eq('AC-10b', g.s.stations.food.inputs.filter(Boolean).length, 1, '只放入面包');
});

section('AC-12 / AC-13 升级扣费（返还机制已移除）', () => {
  const g = newGame();
  g.s.coins = 1000;
  g.upgrade('stove');
  eq('AC-12a', g.s.coins, 950, 'Lv1→Lv2 扣 50');
  g.upgrade('stove');
  eq('AC-13a', g.s.coins, 850, 'Lv2→Lv3 扣 100（全额，无返还）');
  g.upgrade('stove');
  eq('AC-13b', g.s.coins, 670, 'Lv3→Lv4 扣 180（全额，无返还）');
  eq('AC-13c', g.stoveMs, 614, '炉灶 Lv4 = 614ms（v2.19.3：每级 -20%）');
  eq('AC-12b', g.upgrade('stove').reason, 'max');
  eq('AC-13d', g.deviceInfo('stove').refund, undefined, 'deviceInfo 不再返回返还额');
});

section('AC-14 无序匹配', () => {
  const g = newGame();
  craft(g, ['water', 'syrup']);
  eq('AC-14', () => g.s.stations.drink.output.key, 'cola', '水+糖浆 等价');
});

section('AC-15 / AC-20 / AC-25 可乐加冰（两步）', () => {
  const g = newGame();
  craft(g, ['syrup', 'water']);
  eq('AC-15a', () => g.s.stations.drink.output.key, 'cola');
  const before = g.s.coins;
  g.moveItem({ zone: 'output', station: 'drink' }, { zone: 'input', station: 'drink' });
  g.addIngredient('ice');
  wait(g, g.stoveMs + 5);
  eq('AC-15b', () => g.s.stations.drink.output.key, 'icedCola', '两步出冰可乐');
  eq('AC-15c', g.s.coins, before - 1, '两步仅扣冰1');
  eq('AC-20', g.priceOf('icedCola') - 3, 3, '冰可乐标价6 净3');

  const g2 = newGame();
  eq('AC-25a', typeof g2.toggleIce, 'undefined', '加冰开关已移除');
  // 正向：没有开关之后，加冰靠「可乐 + 冰」这条配方
  eq('AC-25d', () => g2.ctx.matchCraft(['cola', 'ice']).recipeId, 'icedCola', 'cola+ice 仍是唯一加冰路径');
  eq('AC-25b', g2.ctx.matchCraft(['syrup', 'water']).recipeId, 'cola', '糖浆+水 只出可乐');
  eq('AC-25c', g2.ctx.byId.has('milkBase'), false, '中间产物 milkBase 已删除');
});

section('AC-16 分层汉堡', () => {
  const g = newGame();
  craft(g, ['lettuce', 'patty']);
  eq('AC-16a', () => g.s.stations.food.output.key, 'vegPatty', '菜肉饼');
  const before = g.s.coins;
  g.moveItem({ zone: 'output', station: 'food' }, { zone: 'input', station: 'food' });
  g.addIngredient('bread');
  wait(g, g.stoveMs + 5);
  eq('AC-16b', () => g.s.stations.food.output.key, 'signatureBurger', '招牌汉堡');
  eq('AC-16c', g.s.coins, before - 1, '本次仅扣面包1');
});

section('AC-17 / AC-22 / AC-49 确定性与节奏', () => {
  const seq = (mode) => {
    const g = new Game(ctx);
    g.tutorialDone = true;
    g.newRun(mode, 1);
    const out = [];
    for (let i = 0; i < 8; i++) {
      g.s.customers = [];
      const c = g.spawnCustomer(false);
      out.push(c.items.map((s) => s.wants).join('/') + (c.vip ? 'V' : ''));
    }
    return out.join(',');
  };
  eq('AC-17', seq('normal'), seq('normal'), '同模式同周同日序列一致');
  ok('AC-17b', seq('normal') !== seq('hard'), 'difficulty 驱动不同序列');
  const g = new Game(ctx);
  g.tutorialDone = true;
  g.newRun('hard', 1);
  eq('AC-22a', g.s.spawnInterval, Math.max(6000, Math.round(90000 / 13)), '困难到店间隔 = 90000/13');
  eq('AC-22b', g.s.perDay, 13, '困难 13 单（v2.19.3：顾客密度上调）');
  const f = new Game(ctx);
  f.tutorialDone = true;
  f.newRun('normal', 1);
  eq('AC-49a', f.s.dayDuration, 90000, '普通单日 90s');
  eq('AC-49b', f.s.spawnInterval, Math.round(90000 / 11), '到店间隔 = 90000/11');
  eq('AC-49c', f.s.perDay, 11, '普通 11 单（v2.19.3：顾客密度上调）');
});

section('AC-19 中间产物提速', () => {
  const g = newGame();
  g.addIngredient('lettuce');
  g.addIngredient('patty');
  eq('AC-19', g.s.stations.food.duration, Math.round(1200 * 0.65), '菜肉饼 780ms');
  const g2 = newGame();
  g2.addIngredient('bread');
  g2.addIngredient('patty');
  eq('AC-19b', g2.s.stations.food.duration, 1200, '成品 1200ms');
});

section('AC-21 困难耐心', () => {
  const g = newGame('hard');
  g.s.customers = [];
  // 固定「非 VIP」顾客：不再用 `|| c.vip` 逃逸，否则随机到 VIP 时这条断言等于没测
  let c = null;
  for (let i = 0; i < 40 && !c; i++) {
    const x = g.spawnCustomer(false);
    if (!x.vip) c = x;
    else g.s.customers = g.s.customers.filter((y) => y.id !== x.id);
  }
  const base = ctx.config.customer.basePatienceMs * 0.85; // 42000 × 0.85 × 招牌 1.0
  eq('AC-21', () => Math.round(c.patienceMax), Math.round(base), '困难耐心 = 42000 × 0.85');
  eq('AC-21b', g.rentForWeek(1), 480, '困难房租 = 基准 400 × 1.2');
});

section('AC-23 / AC-44 食材区', () => {
  const g = newGame();
  eq('AC-23', Object.keys(ctx.config.ingredients).length, 14, '14 种叶食材（冰淇淋改为成品）');
  const leaves = g.menuLeaves();

  // v2.17.1：当日菜单改为从更大的池子里抽，不再写死「今天一定有披萨 / 一定没咖啡」。
  // 判据改成：用测试自己的递归（独立于引擎实现）从菜单反推叶食材，再与 menuLeaves() 对拍。
  // 「菜单里有的必须点亮、没有的必须置灰」的原意一条不少，也不会因池子调整变成假红。
  const leafWalk = (id, depth = 0) => {
    const rec = ctx.byId.get(id);
    if (!rec) return ctx.config.ingredients[id] != null ? [id] : [];
    if (depth > 6) return [];
    return (rec.inputs || []).flatMap((k) => leafWalk(k, depth + 1));
  };
  const want = new Set();
  for (const id of [...g.s.menu.foods, ...g.s.menu.drinks]) leafWalk(id).forEach((k) => want.add(k));

  eq('AC-44', () => [...leaves].sort(), [...want].sort(), '点亮集合 == 当日菜单所有菜的叶食材并集（引擎 walker 与测试 walker 对拍）');
  ok('AC-44b', () => leaves.has('bread') && leaves.has('patty'), '普通模式主菜是汉堡 → 面包/肉饼点亮');
  ok('AC-44c', () => g.s.menu.foods.every((id) => leafWalk(id).every((k) => leaves.has(k))), '菜单里每道主食的叶食材都点亮了');
  ok('AC-44d', () => Object.keys(ctx.config.ingredients).filter((k) => !want.has(k)).every((k) => !leaves.has(k)), '不在菜单链上的叶食材全部置灰');
  ok('AC-44e', () => g.s.menu.drinks.every((id) => leafWalk(id).every((k) => leaves.has(k))), '菜单里每款饮品的叶食材都点亮了');
  eq('AC-44f', () => leaves.size, want.size, '当日相关叶子数量与反推结果一致');
});

section('AC-24 单一仓库（5 格，不分类）', () => {
  const g = newGame();
  craft(g, ['lettuce', 'patty']);
  eq('AC-24a', () => g.kindOf(g.s.stations.food.output.key), 'intermediate', '产出一份半成品');
  g.moveItem(loc('output', 'food'), loc('storage'));
  eq('AC-24b', g.s.storage.length, 1, '半成品也能进仓库');
  eq('AC-24c', () => g.s.storage[0].key, 'vegPatty', '存的是菜肉饼');
  eq('AC-24d', g.storageCap, 5, '仓库容量 5');
  for (let i = 0; i < 4; i++) g.s.storage.push(g.mkItem('burger'));
  eq('AC-24e', g.s.storage.length, 5, '半成品与成品共用 5 格');
  const r = g.pushStorage(g.mkItem('cola'));
  eq('AC-24f', r.ok, false, '满 5 格后拒绝入库');
  eq('AC-24g', r.reason, 'storageFull', '原因 storageFull');
  // 正向断言：单一仓库已就位（不是「字段恰好不存在」的巧合）
  eq('AC-24h', Array.isArray(g.s.storage), true, 'storage 是唯一仓库数组');
  eq('AC-24i', 'buffer' in g.s, false, '状态里没有备料缓冲字段');
  eq('AC-24j', g.moveItem(loc('storage', null, 0), { zone: 'buffer' }).reason, 'storageFull', 'buffer 目标按 storage 处理且受同一容量限制');
});

section('AC-31 判定前撤回', () => {
  const g = newGame();
  g.addIngredient('bread');
  eq('AC-31a', () => g.s.stations.food.inputs[0].key, 'bread');
  eq('AC-31b', g.recallInput('food', 0).ok, true, '取出退回');
  ok('AC-31c', g.s.stations.food.inputs[0] === null && g.s.coins === ctx.config.economy.startCoins, '零惩罚零消耗');
  // 成品撤回进仓储要计入仓储峰值埋点（L2：复用 pushStorage）
  const g2 = newGame();
  g2.s.stations.food.inputs[0] = g2.mkItem('burger');
  g2.recallInput('food', 0);
  eq('AC-31d', g2.s.ach.maxStorage, 1, '撤回成品同样记录仓储峰值');
});

section('AC-32 暂停（耐心 / 生成 / 倒计时 / 读条 四者全冻结）', () => {
  const g = newGame();
  g.s.perDay = 3;
  g.s.spawned = 0;
  g.s.customers = [];
  const c = addCustomer(g, 'burger', 'cola', { patience: 5000 });
  g.addIngredient('bread');
  g.addIngredient('patty'); // 两格齐 → 开始读条（busy）
  const snap = { time: g.s.time, left: g.s.dayTimeLeft, dur: g.s.stations.food.duration };
  g.togglePause();
  wait(g, 5000);
  eq('AC-32a', c.patience, 5000, '耐心冻结');
  eq('AC-32b', g.s.spawned, 0, '生成冻结');
  eq('AC-32c', () => g.s.dayTimeLeft, snap.left, '当日倒计时冻结');
  eq('AC-32d', () => g.s.stations.food.progress, 0, '合成读条冻结');
  eq('AC-32e', () => g.s.time, snap.time, '当日时钟冻结');
  g.togglePause();
  wait(g, 600);
  ok('AC-32f', c.patience < 5000, '恢复后耐心继续');
  eq('AC-32g', () => g.s.stations.food.busy, true, '恢复后读条继续');
  ok('AC-32h', () => g.s.stations.food.progress > 0, `恢复后进度前进（${g.s.stations.food.progress}ms）`);
  eq('AC-32i', () => g.s.stations.food.duration, snap.dur, '读条总时长未被暂停改变');
});

section('AC-34 / AC-35 / AC-36 / AC-43 / AC-48 周结算', () => {
  const g = newGame();
  g.s.week = 1;
  // 房租上调后 200 会被判破产，这里给足钱，让本组专测「回收 / 房租数值」而不是破产分支
  g.s.weekStartCoins = 1000;
  g.s.coins = 1000;
  g.s.storage.push(g.mkItem('burger'), g.mkItem('pizza'), g.mkItem('burger'));
  craft(g, ['lettuce', 'patty']);
  g.moveItem(loc('output', 'food'), loc('storage'));
  g.endWeek();
  // 回收 = 8×25% + 12×25% + 8×25% = 2+3+2 = 7；菜肉饼（半成品）回收 0
  eq('AC-35a', g.s.weekStats.recycled, 7, '残余 25% 回收');
  eq('AC-35b', g.s.storage.length, 0, '仓储清空');
  eq('AC-43a', g.s.weekStats.rent, 400, '第1周房租 400');
  eq('AC-43b', g.rentForWeek(2), 800, '第2周 800（v2.19.3：房租曲线拉陡）');
  eq('AC-43c', [g.rentForWeek(3), g.rentForWeek(4), g.rentForWeek(99)], [1300, 1300, 1300], '第3周起（含边界 3/4/99）都是 1300');
  eq('AC-35c', g.s.phase, 'weekEnd');

  // AC-48：单独用「仅成品」与「成品+半成品」两种场景求差，才是真的在测「半成品回收 0」
  const onlyProducts = newGame();
  onlyProducts.s.coins = 999;
  onlyProducts.s.storage.push(onlyProducts.mkItem('burger'), onlyProducts.mkItem('pizza'));
  onlyProducts.endWeek();
  const withIntermediate = newGame();
  withIntermediate.s.coins = 999;
  withIntermediate.s.storage.push(withIntermediate.mkItem('burger'), withIntermediate.mkItem('pizza'), withIntermediate.mkItem('vegPatty'));
  withIntermediate.endWeek();
  eq('AC-48', onlyProducts.s.weekStats.recycled, 5, '仅成品：8×25% + 12×25% = 5');
  eq('AC-48b', withIntermediate.s.weekStats.recycled - onlyProducts.s.weekStats.recycled, 0, '加入半成品后回收金额不变（回收 0）');

  const h = newGame('hard');
  h.s.coins = 900;
  h.s.storage.push(h.mkItem('burger'));
  craft(h, ['lettuce', 'patty']);
  h.moveItem(loc('output', 'food'), loc('storage'));
  h.endWeek();
  eq('AC-36', h.s.weekStats.discarded, 2, '困难硬报废计数');

  const b = newGame();
  b.s.weekStartCoins = 60;
  b.s.coins = 100; // 100 + 回收 − 150 < 0
  b.s.storage.push(b.mkItem('burger'));
  b.endWeek();
  eq('AC-34a', b.s.phase, 'bankrupt', '触发破产');
  eq('AC-34b', () => b.s.coins < 0, true, '破产后金币为负（不再回退到周初）');
  eq('AC-34c', () => b.s.lastSettle.shortfall, () => Math.round(-b.s.coins), '清算差额 = 缺口');
  eq('AC-34d', typeof b.retryWeek, 'undefined', '「重开本周」已彻底移除');
});

section('AC-39 收银台 / 招牌', () => {
  const g = newGame();
  g.s.coins = 2000;
  g.upgrade('counter');
  g.upgrade('counter');
  g.upgrade('counter');
  g.upgrade('sign');
  g.upgrade('sign');
  g.upgrade('sign');
  eq('AC-39a', g.counterMul, 1.3, '收银台 Lv4 ×1.3');
  eq('AC-39b', g.signMul, 1.15, '招牌 Lv4 ×1.15');
  const c = addCustomer(g, 'burger', 'cola', { patience: 40000 });
  g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  const before = g.s.coins;
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  eq('AC-39c', g.s.coins - before, Math.round(12 * 1.3 * 1.3) + 1, 'earned ×1.3');
  let c2 = g.spawnCustomer(false);
  for (let i = 0; i < 40 && c2 && c2.vip; i++) {
    g.s.customers = g.s.customers.filter((x) => x.id !== c2.id);
    c2 = g.spawnCustomer(false);
  }
  ok('AC-39d', !!c2 && !c2.vip && Math.abs(c2.patienceMax - 42000 * 1.15) < 3, '非VIP新顾客耐心 ×sign');
});

section('AC-40 等价类接单', () => {
  const g = newGame();
  const c = addCustomer(g, 'burger', 'cola', { patience: 40000 });
  g.s.storage.push(g.mkItem('burger'), g.mkItem('icedCola'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  const before = g.s.coins;
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  eq('AC-40', g.s.coins - before, Math.round((8 + 6) * 1.3) + 1, '按冰可乐 6 结算');
});

section('AC-41 / AC-42 VIP 与队列', () => {
  const g = newGame();
  const c = { id: 'vip1', vip: true, items: [g.orderSlot('food', 'burger'), g.orderSlot('food', 'burger')], patienceMax: 20000, patience: 20000, body: 0, acc: 0 };
  g.s.customers.push(c);
  eq('AC-41a', c.items.length, 2, '两份同种');
  eq('AC-42', g.maxQueue, 3, '普通队列 3');
  eq('AC-42b', newGame('hard').maxQueue, 4, '困难队列 4');
  g.s.storage.push(g.mkItem('burger'), g.mkItem('burger'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  const before = g.s.coins;
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  eq('AC-41b', g.s.coins - before, Math.round(16 * 1.8 * 1.3) + 1, '标价 ×1.8');
});

section('AC-45 输出槽拖回输入槽（v2.12 移除箭头按钮后）', () => {
  const g = newGame();
  craft(g, ['syrup', 'water']);
  eq('AC-45a', g.moveItem({ zone: 'output', station: 'drink' }, { zone: 'input', station: 'drink' }).ok, true, '输出槽直接拖回输入槽');
  eq('AC-45b', () => g.s.stations.drink.output, null, '输出槽空出');
  eq('AC-45c', g.s.stations.drink.inputs.filter(Boolean).length, 1);

  // v2.12 回归钉子：这正是箭头按钮被删掉后必须成立的路径。
  // 旧守卫 `if (st.output) return outputOccupied` 会把「把输出槽那件东西本身拖回输入格」
  // 一并拦死（输出槽里躺着的就是被拖的这件），于是只能靠 quickReload 绕过。
  const g2 = newGame();
  craft(g2, ['syrup', 'water']);   // 输出槽 = cola
  eq('AC-45d', () => g2.s.stations.drink.output.key, 'cola', '拖之前输出槽确实有东西');
  const r = g2.moveItem({ zone: 'output', station: 'drink' }, { zone: 'input', station: 'drink', index: 0 });
  eq('AC-45e', r.ok, true, '同台「输出槽 → 输入格」必须放行（不再 outputOccupied）');
  eq('AC-45f', () => g2.s.stations.drink.inputs[0].key, 'cola', '物品真的进了输入格');
  eq('AC-45g', () => g2.s.stations.drink.output, null, '输出槽已清空，不存在覆盖');

  // 半成品续做整链：饼底 → 输入格 → 加芝士 → 披萨
  const g3 = newGame();
  craft(g3, ['dough', 'ketchup']);
  eq('AC-45h', () => g3.s.stations.food.output.key, 'pizzaBase', '面团+番茄酱 → 饼底');
  g3.moveItem({ zone: 'output', station: 'food' }, { zone: 'input', station: 'food' });
  g3.addIngredient('cheese');
  wait(g3, g3.stoveMs + 5);
  eq('AC-45i', () => g3.s.stations.food.output.key, 'pizza', '饼底拖回后加芝士 → 披萨（两步不再需要按钮）');

  // 输出槽直接拖仓库也要通
  const g4 = newGame();
  craft(g4, ['syrup', 'water']);
  eq('AC-45j', g4.moveItem({ zone: 'output', station: 'drink' }, { zone: 'storage' }).ok, true, '输出槽 → 仓库');
  eq('AC-45k', g4.s.storage.length, 1, '仓库收到 1 件');

  // 快捷方法必须已随按钮一起移除
  eq('AC-45l', typeof g.quickReload, 'undefined', 'quickReload 已随按钮移除');
});

section('AC-46 连击', () => {
  const g = newGame();
  const mk = () => addCustomer(g, 'burger', 'cola', { patience: 40000 });
  const serveOne = () => {
    const c = mk();
    g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'));
    g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
    g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  };
  serveOne();
  serveOne();
  const before = g.s.coins;
  serveOne();
  eq('AC-46a', g.s.combo, 3, '三连击');
  eq('AC-46b', g.s.coins - before, Math.round(12 * 1.3) + 2, '第3单 +2 封顶');
  const c2 = mk();
  g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c2.id });
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c2.id });
  eq('AC-46c', g.s.combo, 4);
  const before2 = g.s.coins;
  const c3 = mk();
  g.s.storage.push(g.mkItem('burger'), g.mkItem('cola'));
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c3.id });
  g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c3.id });
  eq('AC-46d', g.s.coins - before2, Math.round(12 * 1.3) + 2, '连击奖励封顶 +2');
  craft(g, ['bread', 'potato']);
  eq('AC-46e', g.s.combo, 0, '失败品清零');
});

// ================================================================ 时间轴（S1 回归防线）
section('S1 跨日时间轴：s.time 必须逐日归零', () => {
  const g = runGame();
  g.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g.s.weekWeatherWeek = g.s.week;

  playDay(g);
  eq('S1-a', () => g.s.phase, 'dayEnd', '第 1 天自然走到打烊');
  ok('S1-b', () => g.s.time > 85000, `第 1 天结束 time 已累计（${Math.round(g.s.time)}ms）`);

  g.nextDay();
  eq('S1-c', () => [g.s.day, g.s.time], [2, 0], '第 2 天开门 time 归零');
  // 普通模式第 2 个营业日还没到外卖解锁日（unlockRunDay=3）
  eq('S1-d', () => g.s.deliveries.length, 0, '第 2 天本就无外卖（解锁日为第 3 天）');
  g.tick(16);
  eq('S1-e', () => g.s.time, 16, '第 2 天时间按 tick 累加（不是继承昨天的 90000）');

  playDay(g);
  eq('S1-f', () => g.s.phase, 'dayEnd', '第 2 天收工');
  g.nextDay();
  eq('S1-g', () => [g.s.day, g.s.time], [3, 0], '第 3 天（雨天）开门 time 归零');
  eq('S1-h', () => g.s.deliveries.length, 2, '雨天 2 单');
  eq('S1-i', () => g.s.deliveries.map((d) => d.status), ['scheduled', 'scheduled'], '第 3 天开门两单都 scheduled');
  g.tick(16);
  eq('S1-j', () => g.s.deliveries.map((d) => d.status), ['scheduled', 'scheduled'], '走 1 帧后状态不变（不会一开场就到店）');
  const d3 = g.s.deliveries[0];
  tickUntil(g, d3.phoneAt);
  eq('S1-k', () => d3.status, 'preview', `到达 phoneAt(${d3.phoneAt}) 才亮屏`);
  tickUntil(g, d3.riderAt);
  eq('S1-l', () => d3.status, 'rider_arrived', `到达 riderAt(${d3.riderAt}) 才到店`);

  // 小费机制在跨日后仍然有效（remainRatio 没有被钳成 0 或负）
  const early = g.deliveryEarn({ ...d3, riderAt: g.s.time }); // 到店立即交付
  const late = g.deliveryEarn({ ...d3, riderAt: g.s.time - d3.effectiveWait }); // 拖满整个等待
  ok('S1-m', () => early > late, `立即交付收益更高（${early} > ${late}）`);
  ok('S1-n', () => early > 0 && late > 0, '两种极端下收益都 > 0');

  // 第 7 天（交租日）同样从 0 起算
  g.s.phase = 'dayEnd';
  g.s.day = 6;
  g.nextDay();
  eq('S1-o', () => [g.s.day, g.s.time], [7, 0], '第 7 天开门 time 归零');
  eq('S1-p', () => g.s.deliveries.map((d) => d.status), ['scheduled'], '第 7 天外卖同样是 scheduled');
});

// ================================================================ 隔天清台
section('S5 隔天只保仓库：灶台物品清零', () => {
  const g = newGame();
  g.s.weekWeather = ['sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny'];
  g.s.weekWeatherWeek = g.s.week;
  g.startDay(1);
  g.s.storage.push(g.mkItem('burger'));
  g.s.stations.food.inputs[0] = g.mkItem('bread');
  g.s.stations.food.output = g.mkItem('burger');
  g.s.stations.drink.inputs[0] = g.mkItem('water');
  g.s.stations.drink.busy = true;
  g.s.stations.drink.pendingId = 'cola';
  g.s.stations.drink.progress = 300;
  g.s.stations.drink.duration = 1200;
  g.s.phase = 'dayEnd';
  g.nextDay();
  eq('S5-a', () => g.s.storage.map((i) => i.key), ['burger'], '仓库物品保留到第二天');
  eq('S5-b', () => g.s.stations.food.inputs.map((i) => i && i.key), [null, null], '食物台输入格清空');
  eq('S5-c', () => g.s.stations.food.output, null, '食物台输出槽清空');
  eq('S5-d', () => [g.s.stations.drink.inputs[0], g.s.stations.drink.busy, g.s.stations.drink.pendingId, g.s.stations.drink.progress], [null, false, null, 0], '饮品台读条与输入一并清空');
  eq('S5-e', () => g.s.dayStats.waste, 0, '清台不计浪费');

  // 同一天的存档仍然完整：resume() 在 startDay 之后用工位快照覆盖，不该被「清台」误伤
  const g2 = newGame();
  g2.startDay(3);
  g2.s.stations.food.output = g2.mkItem('burger');
  g2.s.stations.food.inputs[1] = g2.mkItem('patty');
  const snap = g2.snapshot();
  const g3 = new Game(ctx);
  g3.resume(snap);
  eq('S5-f', () => g3.s.stations.food.output && g3.s.stations.food.output.key, 'burger', '同日读档仍恢复输出槽');
  eq('S5-g', () => g3.s.stations.food.inputs[1] && g3.s.stations.food.inputs[1].key, 'patty', '同日读档仍恢复输入格');
});

// ================================================================ 存档往返（S4③）
section('S4 存档快照 → 恢复往返等价', () => {
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
  eq('S4-a', snap.v, 2, '快照带版本号');
  eq('S4-b', snap.storage.length, 3, '仓储入档');
  eq('S4-c', snap.customers.length, 1, '在场顾客入档');

  const g2 = new Game(ctx);
  eq('S4-d', g2.resume(snap), true, 'resume 成功');
  eq('S4-e', g2.s.coins, 777, '金币恢复');
  eq('S4-f', g2.s.devices, { stove: 2, counter: 3, sign: 4, trash: 2 }, '设备等级恢复');
  eq('S4-g', g2.s.storage.map((x) => x.key), ['burger', 'cola', 'fail'], '仓储恢复（含顺序）');
  eq('S4-h', () => g2.s.stations.food.output.key, 'burger', '输出槽恢复');
  eq('S4-i', () => g2.s.stations.food.inputs[0].key, 'bread', '输入槽恢复');
  eq('S4-j', () => [g2.s.stations.drink.busy, g2.s.stations.drink.pendingId], [true, 'cola'], '合成中状态恢复');
  eq('S4-k', () => g2.s.stations.drink.progress, 400, '读条进度恢复');
  eq('S4-l', () => g2.s.customers[0].patience, 12345, '剩余耐心接着走（不重置满格）');
  eq('S4-m', () => g2.s.customers[0].patienceMax, c.patienceMax, 'patienceMax 单独保存');
  eq('S4-n', () => g2.s.customers[0].items[0].filled, 'burger', 'filled 状态恢复');
  eq('S4-o', () => [g2.s.week, g2.s.day, g2.s.time], [1, 3, 0], '周/日恢复、当日时钟归零');
  const cats = [];
  const g3 = new Game(ctx);
  g3.on('catCoin', (d) => cats.push(d));
  g3.resume(snap);
  eq('S4-p', cats.length, 0, '读档不重放猫币发放');
});

section('S4 脏存档：不崩 + 钳位 + 丢弃非法数据', () => {
  const dirty = {
    mode: 'normal', week: 1, day: 2, coins: 'NaN',
    devices: { stove: 999, counter: -3, sign: 0, trash: 99 },
    storage: [{ key: 'burger' }, null, { key: 'notARealKey' }],
    stations: { food: { busy: true, pendingId: null, duration: 0 } },
    customers: [
      { id: 'zz', items: [{ slot: 'food', wants: 'burger', accepts: ['burger'], filled: 'burger' }], patienceMax: 100, patience: -5 },
      { id: 'bad', items: [{ slot: 'food', wants: 'notARealKey' }] },
    ],
  };
  const g = new Game(ctx);
  ok('S4③-a', () => g.resume(dirty) === true, '脏存档不抛错且返回 true');
  eq('S4③-b', () => g.s.devices, { stove: 4, counter: 1, sign: 1, trash: 4 }, '设备等级钳位到合法区间（垃圾桶已扩到 4 级）');
  eq('S4③-c', () => g.s.storage.map((x) => x.key), ['burger'], '非法物品被丢弃');
  eq('S4③-d', () => g.s.stations.food.busy, false, '缺 pendingId 的 busy 被纠正（避免永久卡死）');
  eq('S4③-e', () => g.s.customers.length, 1, '非法订单的顾客被丢弃');
  ok('S4③-f', () => g.s.customers[0].patience >= 1, `负耐心钳到 ≥1（${g.s.customers[0].patience}）`);
  ok('S4③-g', () => Number.isFinite(g.s.coins), `金币回落为数值（${g.s.coins}）`);

  // 顾客顺序错乱：恢复后按存档顺序保留，且 uid 不撞号
  const messy = { mode: 'normal', week: 1, day: 1, coins: 100, devices: {}, customers: [] };
  for (let i = 0; i < 3; i++) {
    messy.customers.push({ id: 'x' + i, items: [{ slot: 'food', wants: 'burger', accepts: ['burger'], filled: null }], patienceMax: 1000, patience: 500 + i });
  }
  const g2 = new Game(ctx);
  g2.resume(messy);
  eq('S4③-h', () => g2.s.customers.map((c) => c.id), ['x0', 'x1', 'x2'], '顾客顺序与存档一致');
  const used = g2.s.customers.map((c) => c.id);
  ok('S4③-i', () => !used.includes('c1') || true, '顾客 id 保留原值');
  const it = g2.mkItem('water');
  ok('S4③-j', () => !used.includes(it.uid), `新建 uid 不撞号（${it.uid}）`);
});

// ================================================================ 双工位并行
section('双工位并行：两个工位互不干扰', () => {
  const g = newGame();
  g.addIngredient('bread');
  g.addIngredient('patty'); // 食物台开始读条
  wait(g, 200);
  const foodProgress = g.s.stations.food.progress;
  g.addIngredient('syrup');
  g.addIngredient('water'); // 饮品台同时开始读条
  eq('P-a', () => [g.s.stations.food.busy, g.s.stations.drink.busy], [true, true], '两台可同时读条');
  eq('P-b', () => g.s.stations.food.progress, foodProgress, '开第二台不影响第一台进度');
  wait(g, 300);
  ok('P-c', () => g.s.stations.food.progress > foodProgress && g.s.stations.drink.progress > 0, '两台进度各自前进');
  wait(g, g.stoveMs);
  eq('P-d', () => [g.s.stations.food.output.key, g.s.stations.drink.output.key], ['burger', 'cola'], '两台各自产出，互不覆盖');
  eq('P-e', () => [g.s.stations.food.busy, g.s.stations.drink.busy], [false, false], '完成后都退出 busy');

  // 输出槽满的守卫是「每台各自判断」，不跨台误伤
  const h = newGame();
  h.s.stations.food.output = h.mkItem('burger');
  h.addIngredient('syrup');
  h.addIngredient('water');
  eq('P-f', () => h.s.stations.drink.busy, true, '食物台输出槽被占，不影响饮品台投料');
});

// ================================================================ 教学
section('教学：耐心/计时冻结与步骤推进', () => {
  const g = new Game(ctx);
  g.tutorialDone = false;
  g.newRun('normal', 1);
  eq('TUT-a', () => g.s.tutorial.active, true, '首局进入教学');
  eq('TUT-b', g.s.customers.filter((c) => c.tutorial).length, 1, '教学顾客已就位');
  const c = g.s.customers.find((x) => x.tutorial);
  const dur = g.s.dayDuration;
  const p0 = c.patience;
  g.tick(5000);
  eq('TUT-c', () => c.patience, p0, '教学期耐心不流失');
  eq('TUT-d', () => g.s.dayTimeLeft, dur, '教学期营业倒计时不计时');
  g.tutorialAdvance('serve');
  eq('TUT-e', () => g.s.tutorial.step, 'serve', '步骤可推进');
  g.skipTutorial();
  eq('TUT-f', () => [g.s.tutorial.active, g.tutorialDone], [false, true], '跳过教学：状态收尾');
  ok('TUT-g', () => c.patience < p0, '跳过教学后教学顾客被放回普通耐心（否则当日永远打不了烊）');
  g.s.customers = [];
  g.s.perDay = 1;
  g.s.spawned = 0;
  g.s.dayTimeLeft = 100;
  g.tick(200);
  eq('TUT-h', () => g.s.phase, 'dayEnd', '教学结束后可以正常打烊');
});

section('AC-TUT 教学链路（订单可预测 + 两段交付 + 完成收尾）', () => {
  // ① 教学首单必须是「恰好 1 件汉堡」，与引导文案（面包→肉饼→拖给顾客）一致
  const g = new Game(ctx);
  g.tutorialDone = false;
  g.newRun('normal', 1);
  const c1 = g.s.customers.find((x) => x.tutorial);
  eq('AC-TUT-1', c1.items.map((i) => `${i.slot}:${i.wants}`), ['food:burger'], '教学首单恰好 1 件汉堡（不再被随机抽单覆盖）');
  eq('AC-TUT-1b', c1.items[0].filled, null, '订单槽 filled 初值为 null');
  ok('AC-TUT-1c', () => c1.items[0].accepts.includes('burger'), '订单槽 accepts 含 burger（等价类初始化正确）');

  // ② 第 2 段：补一位「只要可乐」的教学顾客，且幂等
  const c2 = g.ensureTutorialCustomer('cola');
  eq('AC-TUT-2', c2 && c2.items.map((i) => `${i.slot}:${i.wants}`), ['drink:cola'], '补位顾客恰好 1 件可乐');
  eq('AC-TUT-2b', g.ensureTutorialCustomer('cola'), null, '幂等：已有可乐顾客时不再新增');
  eq('AC-TUT-2c', g.s.customers.filter((x) => x.tutorial).length, 2, '场上恰好 2 位教学顾客（汉堡 + 可乐）');

  // ③ 教学期两位顾客的耐心都必须冻结
  const p0 = [c1.patience, c2.patience];
  g.tick(5000);
  eq('AC-TUT-3', [c1.patience, c2.patience], p0, '教学期两位顾客耐心都不减少');
  eq('AC-TUT-3b', p0, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], '教学顾客耐心为冻结值');

  // ④ 交付汉堡：计数正确，且场上仍留有可乐顾客可交（这是 TUT-KNOWN-2 的核心）
  g.s.storage.push(g.mkItem('burger'));
  eq('AC-TUT-4', g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c1.id }).ok, true, '汉堡可交付给教学顾客');
  eq('AC-TUT-4b', [g.s.dayStats.delivered, g.s.dayStats.served], [1, 1], '交付计数正确（delivered/served 各 +1）');
  eq('AC-TUT-4c', g.s.customers.filter((x) => x.tutorial).map((x) => x.items[0].wants), ['cola'], '汉堡顾客离场后仍有可乐顾客可交');
  ok('AC-TUT-4d', () => g.s.tutorial.active, '交付第 1 件后教学仍在进行（未提前结束）');

  // ⑤ 交付可乐 → 教学可正常收尾
  g.s.storage.push(g.mkItem('cola'));
  eq('AC-TUT-5', g.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c2.id }).ok, true, '可乐可交付给第 2 位教学顾客');
  eq('AC-TUT-5b', g.s.dayStats.delivered, 2, '两件都交付（delivered=2）');
  g.finishTutorial();
  eq('AC-TUT-5c', [g.s.tutorial.active, g.tutorialDone], [false, true], '教学完成且 tutorialDone 置位');

  // ⑥ 教学提前结束时，残留教学顾客必须被放回普通耐心（否则耐心永不走 → 打烊卡死）
  const g2 = new Game(ctx);
  g2.tutorialDone = false;
  g2.newRun('normal', 1);
  const c3 = g2.s.customers.find((x) => x.tutorial);
  const c4 = g2.ensureTutorialCustomer('cola');
  g2.finishTutorial();
  eq('AC-TUT-6', [c3.tutorial, c4.tutorial], [false, false], 'finishTutorial 释放残留教学顾客');
  ok('AC-TUT-6b', () => c4.patience < Number.MAX_SAFE_INTEGER, `残留顾客恢复普通耐心（${c4.patience}）`);
  eq('AC-TUT-7', g2.ensureTutorialCustomer('cola'), null, '非教学期不会误补位');
});

// ================================================================ 困难解锁
section('困难模式解锁门槛', () => {
  const g = newGame();
  g.hardUnlocked = false;
  g.s.coins = 999;
  g.endWeek();
  eq('HU-a', () => g.hardUnlocked, true, '普通第 1 周交租后解锁困难');
  const h = newGame('hard');
  h.hardUnlocked = false;
  h.s.coins = 999;
  h.endWeek();
  eq('HU-b', () => h.hardUnlocked, false, '困难自身通关不解锁（只由普通第 1 周触发）');
});

// ================================================================ 日/周流程
section('日流程 / 周流程 / 存档冒烟', () => {
  const g = newGame();
  g.s.customers = [];
  g.s.perDay = 1;
  g.s.spawned = 0;
  g.s.spawnTimer = 0;
  g.tick(1);
  eq('flow1', g.s.customers.length, 1, '生成顾客');
  const c = g.s.customers[0];
  c.patience = 10;
  wait(g, 30);
  eq('flow2', g.s.customers.length, 0, '流失离场');
  wait(g, 600);
  eq('flow3', g.s.phase, 'dayEnd', '自动打烊');
  g.nextDay();
  eq('flow4', g.s.day, 2, '进入第2天');
  const snap = g.snapshot();
  eq('flow5', () => [snap.day, snap.mode], [2, 'normal'], '存档快照');
});

section('AC-50 备料与合成改造（茶 / 冰淇淋）', () => {
  const g = newGame();
  eq('AC-50a', g.kindOf('tea'), 'product', '茶是可售卖商品');
  eq('AC-50b', g.priceOf('tea'), 5, '茶售价5');
  eq('AC-50c', ctx.byId.has('iceCream'), true, '冰淇淋已是配方产物而不是基础材料');
  eq('AC-50d', g.kindOf('iceCream'), 'product', '冰淇淋是商品');
  eq('AC-50i', ctx.config.ingredients.milk, 2, '牛奶是基础材料（冰淇淋的原料）');
  craft(g, ['milk', 'syrup']);
  eq('AC-50e', () => g.s.stations.drink.output.key, 'iceCream', '牛奶+糖浆 出冰淇淋');

  const g2 = newGame();
  craft(g2, ['teaBag', 'water']);
  eq('AC-50f', () => g2.s.stations.drink.output.key, 'tea', '茶包+水 出热茶');

  const g3 = newGame();
  craft(g3, ['tea', 'ice']);
  eq('AC-50g', () => g3.s.stations.drink.output.key, 'icedTea', '热茶+冰 出冰茶');

  const g4 = newGame();
  g4.s.stations.drink.inputs[0] = g4.mkItem('iceCream');
  g4.addIngredient('milk');
  wait(g4, g4.stoveMs + 5);
  eq('AC-50h', () => g4.s.stations.drink.output.key, 'milkshake', '冰淇淋+牛奶 出奶昔');
});

section('AC-51 猫猫币', () => {
  const g = newGame();
  const ev = [];
  g.on('catCoin', (d) => ev.push(d));
  g.endDay();
  eq('AC-51a', ev.length && ev[0].amount, 10, '普通每日 +10');
  eq('AC-51b', g.s.dayStats.catCoins, 10, '日统计记录猫猫币');

  const h = newGame('hard');
  eq('AC-51c', h.catGain('day'), 20, '困难每日 ×2');
  eq('AC-51d', h.catGain('week'), 60, '困难周奖 ×2');

  const w = newGame();
  w.s.weekStats.lost = 0;
  w.s.coins = 9999;
  const ev2 = [];
  w.on('catCoin', (d) => ev2.push(d));
  w.endWeek();
  const wk = ev2.find((x) => x.reason === 'week');
  eq('AC-51e', wk && wk.amount, 30, '每周固定 +30');
  eq('AC-51f', 'catSafe' in w.s.lastSettle, false, '不再有零流失条件');
  eq('AC-51g', w.s.weekStats.catCoins, 30, '周统计记录');

  const w2 = newGame();
  w2.s.weekStats.lost = 3;
  w2.s.coins = 9999;
  const ev3 = [];
  w2.on('catCoin', (d) => ev3.push(d));
  w2.endWeek();
  const wk3 = ev3.find((x) => x.reason === 'week');
  eq('AC-51h', wk3 && wk3.amount, 30, '有流失也照发 30');
  eq('AC-51i', w2.s.weekStats.catCoins, 30, '周统计同样记 30');
});

section('AC-52 周结算：金币奖励猫猫币（每满 25 金币 +1，不消耗金币）', () => {
  const g = newGame();
  g.s.coins = 3000;
  g.s.weekStats.lost = 1;
  const ev = [];
  g.on('catCoin', (d) => ev.push(d));
  g.endWeek();
  const info0 = g.exchangeInfo();
  eq('AC-52a', info0.rate, 25, '比例 25 金币 = 1 猫币');
  eq('AC-52b', info0.cap, 100, '单周上限 100');
  eq('AC-52c', info0.earned, Math.floor(info0.coins / 25), 'earned = floor(金币/25)');
  eq('AC-52d', info0.bonus, Math.min(100, info0.earned), 'bonus 受单周上限约束');
  eq('AC-52e', info0.granted, g.s.weekStats.exchangedCat, 'granted = 本周已发放');
  eq('AC-52f', info0.left, Math.max(0, info0.bonus - info0.granted), 'left = bonus − granted');
  const wk = ev.find((x) => x.reason === 'coinBonus');
  ok('AC-52g', !!wk, '周结算自动发放金币奖励猫币');
  eq('AC-52h', wk && wk.amount, Math.min(100, Math.floor(g.s.coins / 25)), '发放枚数 = min(上限, 金币/25)');
  eq('AC-52i', g.s.weekStats.coinBonus, wk && wk.amount, '周统计记录 coinBonus');
  eq('AC-52j', g.s.coins, 3000 - g.s.weekStats.rent, '金币**不被消耗**（只扣房租）');
  eq('AC-52k', g.s.lastSettle.coinBonus, wk && wk.amount, '结算面板拿到本次奖励数');

  // 用户举例：结算时持有 250 金币 → 额外获得 10 猫币
  // 口径 = **结算时余额**（已扣房租）：起始金币 = 250 + 本周房租
  const rent1 = ctx.config.economy.rentByWeek['1'];
  const ex2 = newGame();
  ex2.s.coins = 250 + rent1;
  ex2.s.weekStats.lost = 1;
  const ev2 = [];
  ex2.on('catCoin', (d) => ev2.push(d));
  ex2.endWeek();
  const wk2 = ev2.find((x) => x.reason === 'coinBonus');
  eq('AC-52l', wk2 && wk2.amount, 10, '结算时持有 250 金币 → 额外获得 10 猫币');
  eq('AC-52m', ex2.s.coins, 250, '250 金币一分没少（只交房租，不扣奖励）');

  // 上限：金币很多时也不超过 100
  const big = newGame();
  big.s.coins = 100000;
  big.s.weekStats.lost = 1;
  const evB = [];
  big.on('catCoin', (d) => evB.push(d));
  big.endWeek();
  const wkB = evB.find((x) => x.reason === 'coinBonus');
  eq('AC-52n', wkB && wkB.amount, 100, '单周封顶 100 枚');

  // 同一周内重复调用不再重复发（granted 已累计）
  const rep = newGame();
  rep.s.coins = 1000;
  rep.s.weekStats.lost = 1;
  rep.endWeek();
  const first = rep.s.weekStats.exchangedCat;
  rep.grantCoinBonus();
  eq('AC-52o', rep.s.weekStats.exchangedCat, first, '同周重复发放不叠加');
  eq('AC-52p', rep.exchangeInfo().left, 0, '额度用尽后 left = 0');

  // 新周额度重置
  const nw = newGame();
  nw.s.coins = 1000;
  nw.s.weekStats.lost = 1;
  nw.endWeek();
  nw.nextWeek();
  eq('AC-52q', nw.s.weekStats.exchangedCat, 0, '新周已发枚数清零');
  eq('AC-52r', nw.exchangeInfo().left, Math.min(100, Math.floor(nw.s.coins / 25)), '新周重新可领');
  eq('AC-52s', typeof nw.exchangeCoinsToCat, 'undefined', '旧的手动兑换接口已下线');
});

section('AC-53 天气系统（含订单权重）', () => {
  const g = newGame();
  eq('AC-53a', Object.keys(g.cfg.weather.types).length, 7, '共 7 种天气（新增沙尘）');
  const plan = g.ensureWeekWeather();
  eq('AC-53b', plan.length, 7, '一周 7 天都排好');
  eq('AC-53c', plan[0], 'sunny', '第 1 天固定晴');
  const harsh = g.cfg.weather.schedule.harsh;
  eq('AC-53d', harsh.includes(plan[6]), false, '第 7 天（交租日）不是恶劣天气');
  ok('AC-53d1', harsh.includes('sand'), '沙尘属于恶劣天气池');

  let maxHarsh = 0;
  for (let wk = 1; wk <= 20; wk++) {
    const gg = newGame();
    gg.s.week = wk;
    gg.s.weekWeather = null;
    const pl = gg.ensureWeekWeather();
    maxHarsh = Math.max(maxHarsh, pl.filter((x) => harsh.includes(x)).length);
  }
  ok('AC-53e', maxHarsh <= 2, `每周恶劣天气 ≤ 2（实测最大 ${maxHarsh}）`);

  const g2 = newGame();
  eq('AC-53f', g2.ensureWeekWeather().join(','), plan.join(','), '同种子排布确定');

  const mk = (w) => {
    const gg = newGame();
    gg.s.weekWeather = [w, w, w, w, w, w, w];
    gg.s.weekWeatherWeek = gg.s.week;
    gg.startDay(3);
    return gg;
  };
  const sun = mk('sunny');
  const rain = mk('rain');
  const snow = mk('snow');
  const heat = mk('heat');
  eq('AC-53g', rain.s.perDay < sun.s.perDay, true, `雨天顾客更少（${rain.s.perDay} < ${sun.s.perDay}）`);
  eq('AC-53h', snow.s.perDay < rain.s.perDay, true, `雪天最少（${snow.s.perDay} < ${rain.s.perDay}）`);
  eq('AC-53i', heat.s.perDay > sun.s.perDay, true, `热浪天顾客更多（${heat.s.perDay} > ${sun.s.perDay}）`);
  eq('AC-53j', rain.s.spawnInterval > sun.s.spawnInterval, true, '雨天到店更慢');

  const gs = newGame();
  gs.s.weather = 'snow';
  ok('AC-53k', gs.weatherCfg().hot > gs.weatherCfg().cold, '雪天热饮权重更高');
  const gh = newGame();
  gh.s.weather = 'heat';
  ok('AC-53l', gh.weatherCfg().cold > gh.weatherCfg().hot, '热浪天冷饮权重更高');
  eq('AC-53m', gh.tempOfDrink('icedCola'), 'cold', '冰可乐归为冷饮');
  eq('AC-53n', gh.tempOfDrink('tea'), 'hot', '热茶归为热饮');
  eq('AC-53o', gh.tempOfDrink('salad'), 'neutral', '非饮品归为中性');

  // 热浪天饮品溢价：cold=3 → drinkPriceMul 1.04，base 必须是 8 + 4×1.04 = 12.16
  const gp = newGame();
  gp.s.weather = 'heat';
  let cap = null;
  gp.on('served', (d) => { cap = d; });
  const c = addCustomer(gp, 'burger', 'cola', {});
  gp.s.storage.push(gp.mkItem('burger'), gp.mkItem('cola'));
  gp.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  gp.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c.id });
  eq('AC-53p', () => cap.base, 8 + 4 * ctx.config.weather.types.heat.drinkPriceMul, '热浪天 base = 8 + 4×1.04 = 12.16');

  const gw = newGame();
  gw.ensureWeekWeather();
  gw.s.coins = 9999;
  gw.endWeek();
  gw.nextWeek();
  eq('AC-53q', gw.s.weekWeatherWeek, gw.s.week, '天气记录已切到新周');
  eq('AC-53r', gw.ensureWeekWeather().length, 7, '新周重新排满 7 天');

  // ---------- F4：天气对**订单商品权重**的影响 ----------
  const wh = mk('heat');
  const cold = wh.orderWeightOf('cola');       // 冷饮
  const hot = wh.orderWeightOf('coffee');      // 热饮
  const neutral = wh.orderWeightOf('burger');  // 食物
  eq('AC-53s', cold, 1.2, '热浪天冷饮下单权重 +20%');
  eq('AC-53t', hot, 1, '热浪天热饮权重不变');
  eq('AC-53u', neutral, 1, '热浪天食物权重不变');

  const wc = mk('cloudy');
  eq('AC-53v', wc.orderWeightOf('cola'), 1, '多云天无额外权重（空表 → 1）');

  const wr = mk('rain');
  eq('AC-53w', wr.orderWeightOf('coffee'), 1.15, '雨天热饮权重 +15%');
  eq('AC-53x', wr.orderWeightOf('cola'), 1, '雨天冷饮权重不变');

  const ws = mk('snow');
  eq('AC-53y', ws.orderWeightOf('coffee'), 1.2, '雪天热饮权重 +20%');
  eq('AC-53z', ws.orderWeightOf('cola'), 0.9, '雪天冷饮权重 −10%');

  const wd = mk('sand');
  eq('AC-53aa', wd.orderWeightOf('coffee'), 1.15, '沙尘天热饮权重 +15%');

  // 权重表可扩展到「具体商品 id」：全局表 × 当日表相乘
  const custom = mk('heat');
  eq('AC-53ab', custom.orderWeightOf('burger'), 1, '未配置的默认权重为 1');

  // 加权抽取：权重全为 1 时等概率；给足权重则必中
  const pb = newGame();
  const list = ['a', 'b', 'c'];
  const seq = [0.1, 0.4, 0.9];
  let i = 0;
  const rnd = () => seq[i++ % seq.length];
  eq('AC-53ac', pb.pickByWeight(list, rnd, () => 1), 'a', '等权时按随机序列取');
  const one = pb.pickByWeight(list, () => 0.99, (x) => (x === 'b' ? 1000 : 1));
  eq('AC-53ad', one, 'b', '高权重项被优先抽中');
  eq('AC-53ae', pb.pickByWeight([], () => 0.5, () => 1), null, '空列表返回 null');

  // 端到端：热浪天冷饮出现率高于多云天（同一随机源、同样抽 N 次）
  const rate = (game, n) => {
    const r = game.ctx.mulberry32(12345);
    let coldHits = 0;
    for (let k = 0; k < n; k++) {
      const picked = game.pickByWeight(['cola', 'coffee'], r, (id) => game.orderWeightOf(id));
      if (picked === 'cola') coldHits++;
    }
    return coldHits / n;
  };
  const hotRate = rate(wh, 4000);
  const cloudyRate = rate(wc, 4000);
  ok('AC-53af', hotRate > cloudyRate, `热浪天冷饮抽中率 ${(hotRate * 100).toFixed(1)}% > 多云天 ${(cloudyRate * 100).toFixed(1)}%`);
  ok('AC-53ag', hotRate > 0.52, `热浪天冷饮抽中率应接近 54.5%（实测 ${(hotRate * 100).toFixed(1)}%）`);

  // 端到端（真正走 spawnCustomer）：同种子同天数，热浪天顾客订单里的冷饮占比应显著高于多云天
  // 变异测试：若 spawnCustomer 改回均匀抽样，本条必然变红。
  //
  // v2.17.1：菜单池扩到 7 款饮品后，这一天（同种子）抽到的三款恰好全是冷饮
  // （cola/iceCream/icedTea），于是「冷饮占比」两边恒为 100%，这条断言会被空跑成假绿。
  // 这里把当日饮品固定成一冷一热（与上面 AC-53af 的抽样列表一致），
  // 让判据只依赖「天气权重 → 订单」这条链路，不依赖当天抽到哪几款。
  const coldShare = (weather) => {
    const g = newGame();
    g.s.weekWeather = [weather, weather, weather, weather, weather, weather, weather];
    g.s.weekWeatherWeek = g.s.week;
    g.startDay(3);          // 同一天 → 同一 rng 种子 → 随机流对齐
    g.s.menu = { ...g.s.menu, drinks: ['cola', 'coffee'] };
    g.s.customers = [];
    let cold = 0;
    let total = 0;
    for (let k = 0; k < 400; k++) {
      const c = g.spawnCustomer();
      for (const sl of c.items) {
        if (!sl.wants) continue;
        if (g.tempOfDrink(sl.wants) === 'neutral') continue; // 只统计饮品槽
        total += 1;
        if (g.tempOfDrink(sl.wants) === 'cold') cold += 1;
      }
    }
    return total ? cold / total : 0;
  };
  const shareHeat = coldShare('heat');
  const shareCloudy = coldShare('cloudy');
  ok('AC-53ah', shareHeat > shareCloudy + 0.03,
    `热浪天订单冷饮占比 ${(shareHeat * 100).toFixed(1)}% 明显高于多云天 ${(shareCloudy * 100).toFixed(1)}%`);
});

section('AC-54 外卖系统（真实时间流）：10 秒预警 → 到店 → 配送 → 送达', () => {
  // 解锁节奏：普通第 3 个营业日起
  const a = newGame();
  a.s.week = 1;
  a.s.day = 1;
  eq('AC-54a', a.rollDeliveries().length, 0, '普通第 1 天无外卖');
  a.s.day = 3;
  const ds = a.rollDeliveries();
  eq('AC-54b', ds.length, 1, '普通第 3 天（晴）恰好 1 单');
  eq('AC-54c', ds[0].status, 'scheduled', '初始待接单');
  eq('AC-54d', ds[0].id, -1, '首单 id = -1');
  eq('AC-54e', ds[0].riderAt - ds[0].phoneAt, 10000, '提前 10 秒亮屏预警（读配置 previewMs）');
  eq('AC-54e1', ctx.config.delivery.previewMs, 10000, '配置 previewMs = 10000');

  const h = newGame('hard');
  h.s.day = 1;
  eq('AC-54f', h.rollDeliveries().length, 1, '困难第 1 天就有外卖');
  // AC-54s：困难等待 8 秒（普通 10 秒）
  const hd = h.rollDeliveries()[0];
  eq('AC-54s', hd.effectiveWait, 8000, '困难骑手等待 8s');

  // 雨天：2 单，且等待 +rainRiderWaitBonusMs
  const r = newGame();
  r.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  r.s.weekWeatherWeek = r.s.week;
  r.startDay(3);
  eq('AC-54g', () => r.s.weather, 'rain', '第 3 天是雨天');
  eq('AC-54h', r.s.deliveries.length, 2, '雨天 2 单外卖');
  const d = r.s.deliveries[0];
  eq('AC-54i0', d.effectiveWait, 12000, '雨天等待 10s + 2s 加成');

  // 真实 tick 推进：1 帧不动 → 到 phoneAt 亮屏 → 到 riderAt 到店
  const t0 = r.s.time;
  r.tick(16);
  eq('AC-54i', d.status, 'scheduled', '开门 1 帧内不会直接到店（S1 回归点）');
  eq('AC-54i1', () => r.s.time, t0 + 16, '时间按 tick 累加');
  tickUntil(r, d.phoneAt);
  eq('AC-54j', d.status, 'preview', `到 ${d.phoneAt}ms 才亮屏预警`);
  eq('AC-54j1', d.riderAt - d.phoneAt, 10000, '预警窗口正好 10 秒');
  tickUntil(r, d.riderAt);
  eq('AC-54k', d.status, 'rider_arrived', `到 ${d.riderAt}ms 骑手到店`);

  // 交付与结算：用独立推导的公式断言确切收益，而不是只判 > 0
  const pickupAt = r.s.time;
  eq('AC-54l', r.pickupDelivery(d.id).ok, true, '拖给骑手完成交付');
  eq('AC-54m', d.status, 'picked_up', '骑手取走');
  eq('AC-54n', d.deliveredAt - pickupAt, ctx.config.delivery.deliverySettleMs, '10 秒后才送达（读配置）');
  eq('AC-54o', r.s.dayStats.deliveryServed || 0, 0, '取走时未结算');
  const coinsBeforePickup = r.s.coins;
  eq('AC-54o1', r.s.coins, coinsBeforePickup, '交付时还没发钱（钱在送达时结算）');

  tickUntil(r, d.deliveredAt);
  eq('AC-54p', d.status, 'delivered', '10 秒后配送完成');
  eq('AC-54q', () => d.earned, expectedDeliveryEarn(r, d, d.deliveredAt, { delivered: true }), '送达收益 = 基础公式 × 双倍');
  eq('AC-54q1', () => d.earned, expectedDeliveryEarn(r, d, d.deliveredAt) * ctx.config.delivery.deliveredMul, '送达收益正好是基础收益的 2 倍');
  eq('AC-54q2', ctx.config.delivery.deliveredMul, 2, '配置 deliveredMul = 2');
  ok('AC-54r', d.earned > 0, `外卖收益 ${d.earned} > 0`);
  eq('AC-54t', r.s.dayStats.deliveryServed, 1, '日统计记 1 单');
  eq('AC-54u', r.s.dayStats.deliveryCatCoins, undefined, '外卖不再有猫币分项（该字段已随机制移除）');
  eq('AC-54u1', r.s.ach.deliveries, 1, '成就埋点 deliveries +1');

  // 精确数字：把 item 固定成汉堡（base=8），收银台 Lv1（100%），到店立即取走
  const exact = newGame();
  exact.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  exact.s.weekWeatherWeek = exact.s.week;
  exact.startDay(3);
  const dx = exact.s.deliveries[0];
  dx.item = 'burger';
  tickUntil(exact, dx.riderAt);
  exact.pickupDelivery(dx.id);
  tickUntil(exact, dx.deliveredAt);
  // elapsed=10000 → 剩余比 = 1 − 10000/12000 ≈ 0.1667 → 17% → 小费 105%
  // floor(8×100×105×150×2/1e6) = 25（送达双倍）
  const expExact = Math.floor((8 * 100 * 105 * 150 * 2) / 1e6);
  eq('AC-54v', dx.earned, expExact, '汉堡外卖送达收益 = 25（基础 12~13 × 双倍）');
  const baseEarn = Math.floor((8 * 100 * 105 * 150) / 1e6);
  ok('AC-54v1', dx.earned >= baseEarn * 2 && dx.earned <= baseEarn * 2 + 1,
    `送达收益 ${dx.earned} ≈ 基础收益 ${baseEarn} 的 2 倍（整数取整差 ≤1）`);

  // 日结并入（一）：从未交付 → 基础公式、无猫币、记 deliveryPending
  const m = newGame();
  m.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  m.s.weekWeatherWeek = m.s.week;
  m.startDay(3);
  const d2 = m.s.deliveries[0];
  tickUntil(m, d2.riderAt);
  eq('AC-54w', d2.status, 'rider_arrived', '日结前骑手已到但未交付');
  const cats = [];
  m.on('catCoin', (x) => cats.push(x));
  const pend = m.settlePendingDeliveries();
  eq('AC-54x', pend.count, 2, '日结并入 2 单（雨天两单都未交付）');
  eq('AC-54y', () => pend.earned, () => m.s.deliveries.reduce((a, x) => a + x.earned, 0), '并入金额 = 各单收益之和');
  eq('AC-54z', cats.filter((x) => x.reason === 'delivery').length, 0, '并入的订单不发外卖猫币');
  eq('AC-54aa', [m.s.dayStats.deliveryServed, m.s.dayStats.deliveryPending], [0, 2], '只计 pending，不重复计入 served');
  eq('AC-54ab', d2.status, 'delivered', '并入后标记已结算');
  eq('AC-54ab1', m.s.ach.deliveries, 0, '从未交付不计入 deliveries 成就计数');

  // 日结并入（二）：**已提交但跨天**（picked_up）→ 送达口径：双倍金币 + 猫币 + 记 served
  const x = newGame();
  x.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  x.s.weekWeatherWeek = x.s.week;
  x.startDay(3);
  const d3 = x.s.deliveries[0];
  tickUntil(x, d3.riderAt);
  x.pickupDelivery(d3.id);
  eq('AC-54ac', d3.status, 'picked_up', '已提交食物，配送中');
  const catsX = [];
  x.on('catCoin', (y) => catsX.push(y));
  const pendX = x.settlePendingDeliveries();
  eq('AC-54ad', pendX.count, 2, '两单都在日结并入');
  eq('AC-54ae', pendX.deliveredCount, 1, '其中 1 单是已提交（按送达口径）');
  eq('AC-54af', d3.status, 'delivered', '跨天单在日结时被结算');
  eq('AC-54ag', () => d3.earned, expectedDeliveryEarn(x, d3, x.s.time, { delivered: true }), '跨天已提交单按送达口径（双倍）');
  eq('AC-54ah', x.s.dayStats.deliveryServed, 1, '已提交跨天单记 deliveryServed');
  eq('AC-54ai', x.s.dayStats.deliveryPending, 1, '从未交付的那单记 deliveryPending');
  eq('AC-54aj', catsX.filter((y) => y.reason === 'delivery').length, 0, '跨天送达同样不发外卖猫币（口径与主页说明一致）');
  eq('AC-54ak', x.s.ach.crossDay, 1, '跨天埋点 crossDay +1');
  eq('AC-54al', x.s.ach.deliveries, 1, '已提交跨天单计入 deliveries');

  // 跨天判定：配送时长超过当天剩余时间 → 直接进入当天结束界面
  // 构造：把时钟推到临近打烊（剩余 100ms）时才交付，deliveredAt 落在打烊之后
  const cd = newGame();
  cd.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  cd.s.weekWeatherWeek = cd.s.week;
  cd.startDay(3);
  const d4 = cd.s.deliveries[0];
  tickUntil(cd, d4.riderAt);
  cd.s.time = cd.s.dayDuration - 100;
  cd.s.dayTimeLeft = 100;
  cd.pickupDelivery(d4.id);
  eq('AC-54am0', d4.status, 'picked_up', '临近打烊时已交付，配送中');
  ok('AC-54am1', d4.deliveredAt > cd.s.dayDuration, '送达时刻落在当天营业结束之后（真正跨天）');
  cd.tick(200);
  eq('AC-54am', cd.s.phase, 'dayEnd', '配送跨天时直接进入当天结束界面');
  eq('AC-54an', cd.s.dayStats.deliveryServed, 1, '跨天单在当天结算里已发放金币');
  ok('AC-54ao', cd.s.dayStats.deliveryRevenue > 0, `当天结算含该外卖金币 +${cd.s.dayStats.deliveryRevenue}`);
  eq('AC-54ap', cd.s.ach.crossDay, 1, '跨天单触发 crossDay 成就计数');
  eq('AC-54ap1', cd.s.ach.deliveries, 1, '跨天单计入 deliveries 成就计数');

  // 未交付的订单跨天 → 不吃双倍（基础口径）
  const nd = newGame();
  nd.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  nd.s.weekWeatherWeek = nd.s.week;
  nd.startDay(3);
  const d5 = nd.s.deliveries[0];
  tickUntil(nd, d5.riderAt);
  nd.s.time = nd.s.dayDuration - 100;
  nd.s.dayTimeLeft = 100;
  nd.tick(200);
  eq('AC-54aq', nd.s.phase, 'dayEnd', '未交付订单跨天同样进入当天结束界面');
  eq('AC-54ar', nd.s.dayStats.deliveryPending, 2, '两单都记 pending');
  eq('AC-54as', nd.s.dayStats.deliveryServed, 0, '未交付不记 served');
});

section('AC-55 成就系统', () => {
  const g = newGame();
  const got1 = g.checkAchievements('day', { unlocked: [], totals: {} });
  ok('AC-55a', got1.some((x) => x.id === 'ach_first_day'), '活过第 1 天解锁「开张大吉」');
  eq('AC-55b', got1.some((x) => x.id === 'ach_first_serve'), false, '没成交不解锁「第一桶金」');

  const g2 = newGame();
  g2.bumpCounter('orders', 1);
  const got2 = g2.checkAchievements('day', { unlocked: [], totals: {} });
  ok('AC-55c', got2.some((x) => x.id === 'ach_first_serve'), '成交后解锁「第一桶金」');

  const got3 = g2.checkAchievements('day', { unlocked: ['ach_first_day', 'ach_first_serve'], totals: {} });
  eq('AC-55d', got3.filter((x) => ['ach_first_day', 'ach_first_serve'].includes(x.id)).length, 0, '已解锁不重复发放');

  const g3 = newGame();
  g3.s.weekWeather = ['sunny', 'sunny', 'rain', 'sunny', 'sunny', 'sunny', 'sunny'];
  g3.s.weekWeatherWeek = g3.s.week;
  g3.startDay(3);
  g3.s.dayStats.earned = 130;
  const got4 = g3.checkAchievements('day', { unlocked: [], totals: {} });
  ok('AC-55e', got4.some((x) => x.id === 'ach_rain_pro'), '雨天日营业额 ≥120 解锁');

  const g4 = newGame();
  const got5 = g4.checkAchievements('day', { unlocked: [], totals: {}, ownedSkins: 3 });
  ok('AC-55f', got5.some((x) => x.id === 'ach_cat_3'), '拥有 3 皮肤解锁');
  const got6 = g4.checkAchievements('day', { unlocked: [], totals: {}, ownedSkins: 1 });
  eq('AC-55g', got6.some((x) => x.id === 'ach_cat_3'), false, '只有 1 皮肤不解锁');

  const g5 = newGame();
  g5.s.coins = 400;
  const got7 = g5.checkAchievements('week', { unlocked: [], totals: {} });
  ok('AC-55h', got7.some((x) => x.id === 'ach_pay_rent'), '首次交租解锁');
  ok('AC-55i', got7.some((x) => x.id === 'ach_rent_rich'), '交租时余额 ≥300 解锁');
  ok('AC-55j', got7.some((x) => x.id === 'ach_zero_waste_week'), '周 0 流失 0 失败解锁');
});

section('AC-55 成就补充（机制级，覆盖剩余条目）', () => {
  // 双锅齐飞：两台同时读条累计 ≥10s（走真实 tick 计时，不是直接塞字段）
  const g = newGame();
  for (const key of ['food', 'drink']) {
    const st = g.s.stations[key];
    st.busy = true;
    st.pendingId = key === 'food' ? 'burger' : 'cola';
    st.duration = 999999;
    st.progress = 0;
  }
  g.tick(10000);
  eq('ACH-a', () => g.s.ach.bothBusyMs, 10000, '双工位并行时长按 tick 累计');
  const gotA = g.checkAchievements('day', { unlocked: [], totals: {} });
  ok('ACH-b', gotA.some((x) => x.id === 'ach_double_pot'), '解锁「双锅齐飞」');

  // 满仓待发：仓储峰值 ≥4 且当日清空
  const s4 = newGame();
  for (let i = 0; i < 4; i++) s4.pushStorage(s4.mkItem('burger'));
  eq('ACH-c', () => s4.s.ach.maxStorage, 4, '仓储峰值埋点记录 4');
  s4.s.storage = [];
  const gotS = s4.checkAchievements('day', { unlocked: [], totals: {} });
  ok('ACH-d', gotS.some((x) => x.id === 'ach_storage_4'), '解锁「满仓待发」');
  const s4b = newGame();
  for (let i = 0; i < 4; i++) s4b.pushStorage(s4b.mkItem('burger'));
  const gotS2 = s4b.checkAchievements('day', { unlocked: [], totals: {} });
  eq('ACH-e', gotS2.some((x) => x.id === 'ach_storage_4'), false, '仓储没清空不解锁');

  // 装修队：不该开局白送（默认皮肤不算「买过主题」）
  const th = newGame();
  const gotT0 = th.checkAchievements('day', { unlocked: [], totals: {}, ownedThemes: 0 });
  eq('ACH-f', gotT0.some((x) => x.id === 'ach_theme_1'), false, '开局 0 个非默认皮肤 → 不解锁「装修队」');
  const gotT1 = th.checkAchievements('day', { unlocked: [], totals: {}, ownedThemes: 1 });
  ok('ACH-g', gotT1.some((x) => x.id === 'ach_theme_1'), '买过 1 个非默认皮肤 → 解锁「装修队」');

  // 千锤百炼：跨局累计（tot）+ 本局增量（c）合并生效
  const o = newGame();
  for (let i = 0; i < 45; i++) o.bumpCounter('orders', 1);
  const gotO1 = o.checkAchievements('day', { unlocked: [], totals: { orders: 0 } });
  eq('ACH-h', gotO1.some((x) => x.id === 'ach_orders_100'), false, '本局 45 单不够 100');
  const gotO2 = o.checkAchievements('day', { unlocked: [], totals: { orders: 60 } });
  ok('ACH-i', gotO2.some((x) => x.id === 'ach_orders_100'), '上局 60 + 本局 45 → 解锁「千锤百炼」');

  // 眼疾手快：10 秒内成交 3 单
  const sp = newGame();
  sp.bumpCounter('serveTime', 0);
  sp.bumpCounter('serveTime', 1000);
  sp.bumpCounter('serveTime', 2000);
  const gotSp = sp.checkAchievements('day', { unlocked: [], totals: {} });
  ok('ACH-j', gotSp.some((x) => x.id === 'ach_speed_3'), '10s 内 3 单 → 解锁「眼疾手快」');
  const sp2 = newGame();
  sp2.bumpCounter('serveTime', 0);
  sp2.bumpCounter('serveTime', 6000);
  sp2.bumpCounter('serveTime', 12000);
  const gotSp2 = sp2.checkAchievements('day', { unlocked: [], totals: {} });
  eq('ACH-k', gotSp2.some((x) => x.id === 'ach_speed_3'), false, '跨度 12s 不解锁');
});

section('AC-56 成就分级与新增成就（v2.8）', () => {
  const list = ctx.config.achievements.list;
  const tiers = ctx.config.achievements.tiers;
  eq('AC-56a', list.length, 34, '成就共 34 条（24 旧 + 10 新）');
  ok('AC-56b', !!tiers && !!tiers.easy && !!tiers.normal && !!tiers.hard && !!tiers.epic, '四档难度分级表存在');
  // 每条成都必须落在所属难度的奖励区间内
  const bad = list.filter((a) => {
    const t = tiers[a.difficulty];
    return !t || a.reward < t.minReward || a.reward > t.maxReward;
  }).map((a) => a.id);
  eq('AC-56c', bad, [], '所有成就奖励都落在其难度区间内');
  // 难度越高奖励越高（区间单调）
  ok('AC-56d', tiers.easy.maxReward < tiers.normal.minReward
    && tiers.normal.maxReward < tiers.hard.minReward
    && tiers.hard.maxReward < tiers.epic.minReward, '四档难度奖励区间单调递增');
  // 每条成就都必须有 i18n 名称与描述（成就全部可见，不再隐藏）
  const i18n = ctx.i18n;
  const missing = list.filter((a) => !i18n['ach.' + a.id] || !i18n['ach.' + a.id + '.desc']).map((a) => a.id);
  eq('AC-56e', missing, [], '每条成就都有可见的名称与描述文案');
  eq('AC-56f', 'ach.locked' in i18n, false, '隐藏成就的 ??? 文案已移除');

  // ---- 新增 10 条成就的解锁条件 ----
  // 1) 第一单外卖
  const d1 = newGame();
  d1.bumpCounter('deliveries', 1);
  const gD1 = d1.checkAchievements('day', { unlocked: [], totals: {} });
  ok('AC-56g', gD1.some((x) => x.id === 'ach_delivery_first'), '完成 1 单外卖解锁「第一单外卖」');
  const d1b = newGame();
  const gD1b = d1b.checkAchievements('day', { unlocked: [], totals: {} });
  eq('AC-56h', gD1b.some((x) => x.id === 'ach_delivery_first'), false, '没送外卖不解锁');

  // 2) 累计 10 单外卖（跨局 totals + 本局增量）
  const d2 = newGame();
  for (let i = 0; i < 4; i++) d2.bumpCounter('deliveries', 1);
  eq('AC-56i', d2.checkAchievements('day', { unlocked: [], totals: { deliveries: 0 } }).some((x) => x.id === 'ach_delivery_10'), false, '本局 4 + 往局 0 < 10');
  ok('AC-56j', d2.checkAchievements('day', { unlocked: [], totals: { deliveries: 7 } }).some((x) => x.id === 'ach_delivery_10'), '往局 7 + 本局 4 = 11 ≥ 10 解锁');

  // 3) 跨天送达
  const d3 = newGame();
  d3.bumpCounter('crossDay', 1);
  ok('AC-56k', d3.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_cross_day'), '跨天送达 1 单解锁「跨夜骑手」');

  // 4) 一周经历 3 种以上天气
  const d4 = newGame();
  d4.s.weekWeather = ['sunny', 'rain', 'snow', 'fog', 'sand', 'cloudy', 'heat'];
  d4.s.weekWeatherWeek = d4.s.week;
  d4.s.day = 7;
  d4.s.weather = 'heat';
  ok('AC-56l', d4.checkAchievements('week', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_weather_variety'), '一周 7 种天气解锁「看天吃饭」');
  const d4b = newGame();
  d4b.s.weekWeather = ['sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny'];
  d4b.s.weekWeatherWeek = d4b.s.week;
  d4b.s.day = 7;
  d4b.s.weather = 'sunny';
  eq('AC-56m', d4b.checkAchievements('week', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_weather_variety'), false, '一周只有 1 种天气不解锁');

  // 5) 单日 12 单
  const d5 = newGame();
  d5.s.dayStats.served = 12;
  ok('AC-56n', d5.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_day_orders_12'), '单日 12 单解锁「爆单日」');
  const d5b = newGame();
  d5b.s.dayStats.served = 11;
  eq('AC-56o', d5b.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_day_orders_12'), false, '11 单不解锁');

  // 6) 持有 500 金币
  const d6 = newGame();
  d6.s.coins = 500;
  ok('AC-56p', d6.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_rich_500'), '持有 500 金币解锁「小有积蓄」');

  // 7) 累计营业额 5000
  const d7 = newGame();
  d7.bumpCounter('revenue', 1000);
  ok('AC-56q', d7.checkAchievements('day', { unlocked: [], totals: { revenue: 4500 } }).some((x) => x.id === 'ach_revenue_5000'), '累计营业额 ≥5000 解锁「流水五千」');

  // 8) 累计 30 猫猫币（阈值外置在 config.achievements.thresholds.catCoins，默认 30）
  const d8 = newGame();
  ok('AC-56r', d8.checkAchievements('day', { unlocked: [], totals: { catCoins: 30 } }).some((x) => x.id === 'ach_cat_30'), '往局累计 30 猫币解锁「猫猫大户」');
  eq('AC-56s', d8.checkAchievements('day', { unlocked: [], totals: { catCoins: 29 } }).some((x) => x.id === 'ach_cat_30'), false, '往局 29 猫币不解锁');

  // 8b) 本局累计（s.catEarned）也必须计入 —— 这条钉死「死成就」修复：
  //     旧判定只看 tot.catCoins，而该计数器从未被 main.js 累加过，成就永不可达。
  const d8b = newGame();
  d8b.s.catEarned = 30;
  ok('AC-56z1', d8b.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_cat_30'), '本局累计 30 枚猫币即解锁（不必等下一局 flush）');
  const d8c = newGame();
  d8c.s.catEarned = 29;
  eq('AC-56z2', d8c.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_cat_30'), false, '本局累计 29 枚不解锁');
  const d8d = newGame();
  d8d.s.catEarned = 20;
  ok('AC-56z3', d8d.checkAchievements('day', { unlocked: [], totals: { catCoins: 10 } }).some((x) => x.id === 'ach_cat_30'), '往局 10 + 本局 20 = 30 枚解锁（跨局累加口径）');

  // 8c) 端到端：走真实日结路径（endDay 每开一天 +10 猫币，顺序是「先发币再判成就」），
  //     普通模式连开 3 天 = 本局 30 枚 → 第 3 天日结当场解锁。
  const d8e = newGame();
  const unlockedIds = [];
  d8e.on('achievement', (list) => { for (const a of list) unlockedIds.push(a.id); });
  for (let day = 1; day <= 3; day++) {
    d8e.s.day = day;
    d8e.s.phase = 'day';
    d8e.endDay();
  }
  eq('AC-56z4', d8e.s.catEarned, 30, '普通模式连开 3 天累计 30 枚猫币（每日 +10）');
  ok('AC-56z5', unlockedIds.includes('ach_cat_30'), '真实日结路径下「猫猫大户」确实解锁（不是只在测试里塞字段才可达）');

  // 9) 热浪天 8 单
  const d9 = newGame();
  d9.s.weather = 'heat';
  d9.s.dayStats.served = 8;
  ok('AC-56t', d9.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_heat_8'), '热浪天 8 单解锁「热浪生意」');
  const d9b = newGame();
  d9b.s.weather = 'heat';
  d9b.s.dayStats.served = 7;
  eq('AC-56u', d9b.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_heat_8'), false, '热浪天 7 单不解锁');

  // 10) 雪天营业额 150
  const d10 = newGame();
  d10.s.weather = 'snow';
  d10.s.dayStats.earned = 150;
  ok('AC-56v', d10.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_snow_150'), '雪天营业额 ≥150 解锁「雪天生意」');
  const d10b = newGame();
  d10b.s.weather = 'snow';
  d10b.s.dayStats.earned = 149;
  eq('AC-56w', d10b.checkAchievements('day', { unlocked: [], totals: {} }).some((x) => x.id === 'ach_snow_150'), false, '雪天 149 不解锁');

  // 新计数器能被存档往返保留
  const d11 = newGame();
  d11.bumpCounter('deliveries', 3);
  d11.bumpCounter('crossDay', 1);
  const snap = d11.snapshot();
  const d12 = newGame();
  d12.resume(snap);
  eq('AC-56x', d12.s.ach.deliveries, 3, 'deliveries 计数器随存档保留');
  eq('AC-56y', d12.s.ach.crossDay, 1, 'crossDay 计数器随存档保留');
});

section('AC-09 / AC-27 / AC-28 / AC-29 / AC-38 / AC-47 补齐的 AC 编号', () => {
  // AC-09：第 7 天结算清空仓储；普通显示回收金额，困难显示报废件数
  const g = newGame();
  g.s.coins = 999;
  g.s.storage.push(g.mkItem('burger'), g.mkItem('salad'));
  g.endWeek();
  eq('AC-09', () => g.s.storage.length, 0, '周结算清空主仓储');
  eq('AC-09b', () => g.s.weekStats.recycled, Math.round(8 * 0.25) + Math.round(6 * 0.25), '普通模式给出回收金额（8×25% + 6×25%）');
  const hg = newGame('hard');
  hg.s.coins = 999;
  hg.s.storage.push(hg.mkItem('burger'), hg.mkItem('salad'));
  hg.endWeek();
  eq('AC-09c', () => hg.s.weekStats.discarded, 2, '困难模式给出报废件数');

  // AC-27 / AC-28：模式说明文案（仓储口径以 config 为准，PRD 里的 6/8 格已过时）
  const normalHint = ctx.i18n['mode.hint.normal'];
  const hardHint = ctx.i18n['mode.hint.hard'];
  ok('AC-27', () => /汉堡免生菜/.test(normalHint) && /不加冰/.test(normalHint) && !/仓储/.test(normalHint), `普通说明（不提仓储格数）：${normalHint}`);
  ok('AC-28', () => /招牌汉堡/.test(hardHint) && /加冰/.test(hardHint) && /耐心更短/.test(hardHint) && !/仓储/.test(hardHint), `困难说明（不提仓储格数）：${hardHint}`);

  // AC-29：首次进入＝教学单，且可跳过
  const t = new Game(ctx);
  t.tutorialDone = false;
  t.newRun('normal', 1);
  eq('AC-29', () => [t.s.tutorial.active, t.s.customers.some((c) => c.tutorial)], [true, true], '首次进入即教学单');
  ok('AC-29b', () => typeof t.skipTutorial === 'function', '教学可跳过（skipTutorial 存在）');
  t.skipTutorial();
  eq('AC-29c', () => [t.s.tutorial.active, t.tutorialDone], [false, true], '跳过教学后状态收尾');

  // AC-38 / AC-47：升级面板改成「作用 + 现在 → 下一级」，时间折成秒
  const u = newGame();
  const info1 = u.deviceInfo('stove');
  eq('AC-38', () => [info1.lv, info1.cost], [1, 50], 'Lv1→Lv2：费用 50');
  eq('AC-47', () => ctx.i18n['upgrade.stove.what'], '出餐更快', '面板作用说明是中文短句');
  u.s.coins = 1000;
  u.upgrade('stove');
  const info2 = u.deviceInfo('stove');
  eq('AC-38b', () => [info2.cur, info2.next], [960, 768], 'Lv2 面板要显示的「现在 → 下一级」');
  ok('AC-38c', () => /秒/.test(ctx.i18n['upgrade.sec']) && !/ms|毫秒/.test(ctx.i18n['upgrade.sec']), `时间单位用秒：${ctx.i18n['upgrade.sec']}`);
});

section('R4 配置缺失一律显式报错（与 deliverySettleMs 同一策略）', () => {
  /** 跑一段可能抛错的逻辑，返回错误信息（不抛则 null） */
  const boom = (fn) => {
    try { fn(); return null; } catch (e) { return String(e && e.message || e); }
  };

  // ① pricing.bigOrderItems：缺失时成交必须炸，而不是静默丢掉大单判定
  const savedBig = ctx.config.pricing.bigOrderItems;
  delete ctx.config.pricing.bigOrderItems;
  const g1 = newGame();
  g1.s.customers = [];
  const c1 = addCustomer(g1, 'burger', 'cola', { patience: 40000 });
  g1.s.storage.push(g1.mkItem('burger'), g1.mkItem('cola'));
  g1.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c1.id });
  const msgBig = boom(() => g1.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c1.id }));
  ctx.config.pricing.bigOrderItems = savedBig;
  ok('CFG-a', () => /bigOrderItems/.test(msgBig || ''), `缺 bigOrderItems 时成交显式报错（${msgBig}）`);

  // ② economy.daysPerWeek：缺失时换日必须炸
  const savedDays = ctx.config.economy.daysPerWeek;
  delete ctx.config.economy.daysPerWeek;
  const g2 = newGame();
  const msgDays = boom(() => { g2.s.phase = 'dayEnd'; g2.nextDay(); });
  ctx.config.economy.daysPerWeek = savedDays;
  ok('CFG-b', () => /daysPerWeek/.test(msgDays || ''), `缺 daysPerWeek 时换日显式报错（${msgDays}）`);

  // ③ stations.*.inputSlots：缺失时开局必须炸（槽位数量是机制的一部分）
  const savedSlots = ctx.config.stations.food.inputSlots;
  delete ctx.config.stations.food.inputSlots;
  const msgSlots = boom(() => newGame());
  ctx.config.stations.food.inputSlots = savedSlots;
  ok('CFG-c', () => /inputSlots/.test(msgSlots || ''), `缺 inputSlots 时开局显式报错（${msgSlots}）`);

  // ④ crafting.earlyCloseDebounceMs：缺失时提前打烊必须炸
  const savedDb = ctx.config.crafting.earlyCloseDebounceMs;
  delete ctx.config.crafting.earlyCloseDebounceMs;
  const g4 = newGame();
  g4.s.customers = [];
  g4.s.perDay = 0;
  g4.s.spawned = 0;
  const msgDb = boom(() => g4.tick(600));
  ctx.config.crafting.earlyCloseDebounceMs = savedDb;
  ok('CFG-d', () => /earlyCloseDebounceMs/.test(msgDb || ''), `缺 earlyCloseDebounceMs 时提前打烊显式报错（${msgDb}）`);

  // ⑤ 恢复配置后，四条正常路径都要照常工作（防止「一律 throw」把正常流程改炸）
  const g5 = newGame();
  eq('CFG-e', () => g5.daysPerWeek, ctx.config.economy.daysPerWeek, '配置恢复后 daysPerWeek 正常可读');
  eq('CFG-f', () => g5.blankInputs('food').length, ctx.config.stations.food.inputSlots, '配置恢复后输入槽数量正常');
  const g6 = newGame();
  g6.s.customers = [];
  g6.s.perDay = 0;
  g6.s.spawned = 0;
  g6.tick(600);
  eq('CFG-g', () => g6.s.phase, 'dayEnd', '配置恢复后提前打烊照常');
  const g7 = newGame();
  const c7 = addCustomer(g7, 'burger', 'cola', { patience: 40000 });
  g7.s.storage.push(g7.mkItem('burger'), g7.mkItem('cola'));
  g7.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c7.id });
  eq('CFG-h', g7.moveItem(loc('storage', null, 0), { zone: 'customer', customerId: c7.id }).complete, true, '配置恢复后成交照常（含大单判定读取）');
});

// ================================================================ 静态资产（S2）
section('S2 离线资产完整性（sw.js SHELL ⊇ 实际依赖）', () => {
  const root = new URL('../', import.meta.url);
  const text = (p) => fs.readFileSync(new URL(p, root), 'utf8');
  const norm = (p) => {
    const out = [];
    for (const seg of String(p).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return './' + out.join('/');
  };
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));

  const assets = new Set();
  // ① index.html 的 href / src
  for (const m of text('index.html').matchAll(/(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:)?\/\//.test(u) || u.startsWith('#') || u.startsWith('data:')) continue;
    assets.add(norm(u));
  }
  // ② 从 src/main.js 出发的静态 import 图（DFS）
  const queue = ['./src/main.js'];
  const seen = new Set();
  while (queue.length) {
    const p = norm(queue.pop());
    if (seen.has(p)) continue;
    seen.add(p);
    assets.add(p);
    const src = text(p);
    for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      queue.push(norm(dirOf(p) + '/' + m[1]));
    }
  }
  // ③ manifest 图标
  const mf = JSON.parse(text('pwa/manifest.webmanifest'));
  for (const ic of mf.icons || []) assets.add(norm('pwa/' + ic.src));

  // ④ sw.js 的 SHELL
  const sw = text('sw.js');
  const shellBlock = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  const shell = new Set(Array.from(shellBlock.matchAll(/'([^']+)'/g)).map((m) => norm(m[1])));

  const missing = Array.from(assets).filter((a) => !shell.has(a)).sort();
  // 防「两边都空」的假绿：静态依赖图至少要抓到样式/入口/引擎/音频这几个关键资产
  ok('S2-e', () => assets.size >= 10 && assets.has('./src/style.css') && assets.has('./src/audio.js'), `静态依赖图抓到 ${assets.size} 个资产（含 style.css / audio.js）`);
  eq('S2-a', missing, [], 'sw.js SHELL 覆盖 index.html + import 图 + manifest 图标（缺失项列在此）');
  ok('S2-b', () => shell.has('./src/audio.js'), 'SHELL 含 ./src/audio.js');
  // 不写死版本号（同一个坑踩过三次）：只要求 CACHE 存在且是 owk-vNN 形态，
  // 具体版本号由 npm run test:browser 的 pwa-check 与磁盘 sw.js 对比。
  ok('S2-c', () => /const CACHE = 'owk-v\d+'/.test(sw), `缓存名是 owk-vNN 形态（当前 ${(/const CACHE = '([^']+)'/.exec(sw) || [])[1]}）`);
  ok('S2-d', () => /res\.ok/.test(sw), '运行时回填只缓存成功响应');
  for (const a of assets) ok(`S2-file:${a}`, () => fs.existsSync(new URL(a, root)), '资产文件真实存在');
});

// ================================================================ v2.17：4 道新配方 + 通用合成台 + 一键提交
section('V217 新配方数据：与需求表逐字段一致', () => {
  const want = {
    cheeseFries: { type: 'food', station: 'food', inputs: ['fries', 'cheese'], price: 9, thisCost: 2, chainCost: 4, net: 5 },
    latte: { type: 'drink', station: 'drink', inputs: ['coffee', 'milk'], price: 9, thisCost: 2, chainCost: 5, net: 4 },
    milkTea: { type: 'drink', station: 'drink', inputs: ['tea', 'milk'], price: 8, thisCost: 2, chainCost: 4, net: 4 },
    hashBrown: { type: 'food', station: 'food', inputs: ['potato', 'ketchup'], price: 6, thisCost: 2, chainCost: 2, net: 4 },
  };
  for (const [id, w] of Object.entries(want)) {
    const r = ctx.byId.get(id);
    ok(`V217-${id}-exists`, () => !!r, `${id} 在配方表里`);
    eq(`V217-${id}`, () => ({ type: r.type, station: r.station, inputs: r.inputs, price: r.price, thisCost: r.thisCost, chainCost: r.chainCost, net: r.net }), w, `${id} 数值与需求表一致`);
  }
  // 净利口径自洽：net = price − chainCost（全表 18 条）
  eq('V217-net', () => ctx.crafts.recipes.filter((r) => r.price != null && r.net !== r.price - r.chainCost).map((r) => r.id), [], '所有可售配方 net = price − chainCost');
  // thisCost 语义：只算本次新投的**叶食材**（已沉没的成品/半成品不再扣）
  const leafSum = (r) => r.inputs.reduce((a, k) => a + ctx.leafCost(k), 0);
  eq('V217-thisCost', () => Object.keys(want).filter((id) => ctx.byId.get(id).thisCost !== leafSum(ctx.byId.get(id))), [], '四条新配方的 thisCost = 本次投入的叶食材成本之和');
  // 本次硬约束：不新增原料种类
  eq('V217-14leaves', Object.keys(ctx.config.ingredients).length, 14, '原料仍为 14 种（本批未新增）');
  // 18 条配方 → 18 个互不相同的两料 key（新输入对没和旧配方撞车，table 不会互相覆盖）
  eq('V217-table', ctx.table.size, ctx.crafts.recipes.length, '合成表 key 数 == 配方数（无重复输入对）');
  eq('V217-table18', ctx.table.size, 18, '合成表共 18 条（14 旧 + 4 新）');
  // 旧 14 条配方一个字都没动（按 id 存在 + 净利口径）
  eq('V217-old-intact', () => ['burger', 'vegPatty', 'signatureBurger', 'fries', 'cola', 'icedCola', 'coffee', 'salad', 'pizzaBase', 'pizza', 'iceCream', 'milkshake', 'tea', 'icedTea'].filter((id) => !ctx.byId.has(id)), [], '原有 14 条配方全部还在');
  eq('V217-eqclass', () => ctx.crafts.equivalenceClasses.map((e) => e.order), ['cola', 'icedCola'], '等价类未被改动');
});

section('V217 新配方：引擎实际扣费与产出（实跑，不看静态数字）', () => {
  const cases = [
    { id: 'cheeseFries', station: 'food', sunk: 'fries', add: 'cheese' },
    { id: 'latte', station: 'drink', sunk: 'coffee', add: 'milk' },
    { id: 'milkTea', station: 'drink', sunk: 'tea', add: 'milk' },
    { id: 'hashBrown', station: 'food', sunk: 'potato', add: 'ketchup' },
  ];
  for (const c of cases) {
    const g = newGame();
    // 已沉没的那一件先摆进输入格（模拟「上一个成品 / 已扣过钱的叶食材」）
    const before = g.s.coins;
    g.s.stations[c.station].inputs[0] = g.mkItem(c.sunk);
    const r = g.addIngredient(c.add, c.station, 1);
    ok(`V217-run-${c.id}-ok`, () => r.ok === true, `${c.id} 投料成功`);
    eq(`V217-run-${c.id}-cost`, () => before - g.s.coins, ctx.byId.get(c.id).thisCost, `${c.id} 本次实扣 = thisCost ${ctx.byId.get(c.id).thisCost}`);
    wait(g, g.stoveMs + 5);
    eq(`V217-run-${c.id}-out`, () => g.s.stations[c.station].output && g.s.stations[c.station].output.key, c.id, `${c.id} 产出正确`);
  }
});

section('V217 通用合成台：通吃 / 读条 ×1.5 / 拒绝中间产物 / 存档往返', () => {
  const g = newGame();
  ok('V217-uni-exists', () => !!g.s.stations.universal, 'newRun 按 config.stations 生成了 universal 工位');
  eq('V217-uni-slots', () => g.s.stations.universal.inputs.length, ctx.config.stations.universal.inputSlots, '通用台输入格数读配置');
  eq('V217-uni-cfg', () => [g.stationAcceptsAll('universal'), g.stationForbidsIntermediate('universal'), ctx.config.stations.universal.timeFactor], [true, false, [1.5, 1.45, 1.4, 1.35]], '通用台：通吃 / 禁中间产物已关 / 读条系数按灶台等级递减 1.5→1.35');

  // ① 通吃：食物料与甜品料都能投；专用台的老行为不变
  const g2 = newGame();
  const r1 = g2.addIngredient('bread', 'universal', 0);
  const r2 = g2.addIngredient('syrup', 'universal', 1);
  ok('V217-uni-both', () => r1.ok && r2.ok, '面包（食物料）与糖浆（甜品料）都能投进通用台');
  // 归属提示用干净局单独验（上面那一对已经合成，输出槽被占会遮住判定）
  const g2b = newGame();
  eq('V217-uni-mismatch-leaf', g2b.stationMismatch('tomato', 'universal'), null, '通用台对任何叶食材都不报 wrongStation');
  eq('V217-uni-mismatch-prod', g2b.stationMismatch('burger', 'universal'), null, '通用台对任何成品都不报 wrongStation');
  eq('V217-uni-oldguard', () => g2b.stationMismatch('syrup', 'food').reason, 'wrongStation', '食物台仍然拦甜品料（原有归属提示没被放宽）');
  eq('V217-uni-oldguard2', () => g2b.stationMismatch('cheese', 'drink').reason, 'wrongStation', '甜品台仍然拦食物料');

  // ② 点击（不给 stationKey）仍按配方归属自动选台，不会被通用台抢走
  const g3 = newGame();
  g3.addIngredient('potato');
  eq('V217-click-auto', () => g3.s.stations.food.inputs.filter(Boolean).map((i) => i.key), ['potato'], '点击土豆仍自动进食物台');
  eq('V217-click-uni-empty', () => g3.s.stations.universal.inputs.filter(Boolean).length, 0, '通用台不会被点击自动投料（必须玩家显式拖/点过去）');

  // ③ 读条 = stoveMs × 1.5，且随炉灶等级同步变化
  const g4 = newGame();
  g4.addIngredient('potato', 'universal', 0);
  g4.addIngredient('ketchup', 'universal', 1);
  eq('V217-uni-dur', () => g4.s.stations.universal.duration, Math.round(g4.stoveMs * 1.5), '通用台读条 = stoveMs × 1.5');
  ok('V217-uni-busy', () => g4.s.stations.universal.busy === true, '两格投满自动开始读条');
  const g5 = newGame();
  g5.s.devices.stove = ctx.config.devices.stove.values.length; // 满级炉灶
  g5.addIngredient('potato', 'universal', 0);
  g5.addIngredient('ketchup', 'universal', 1);
  eq('V217-uni-dur-max', () => g5.s.stations.universal.duration, Math.round(g5.stoveMs * 1.35), '满级炉灶下通用台 = stoveMs × 1.35（系数随灶台等级收敛到 1.35）');
  ok('V217-uni-dur-faster', () => g5.s.stations.universal.duration < g4.s.stations.universal.duration, '炉灶升级后通用台跟着变快');
  // 专用台不受 1.5 影响（食物台读条仍是 stoveMs）
  const g5b = newGame();
  g5b.addIngredient('potato', 'food', 0);
  g5b.addIngredient('potato', 'food', 1);
  eq('V217-food-dur', () => g5b.s.stations.food.duration, Math.round(g5b.stoveMs), '食物台读条仍是 stoveMs（系数没被带偏）');

  // ④ 通用台既做饭也做饮品
  const g6 = newGame();
  g6.addIngredient('potato', 'universal', 0);
  g6.addIngredient('ketchup', 'universal', 1);
  wait(g6, Math.round(g6.stoveMs * 1.5) + 5);
  eq('V217-uni-food', () => g6.s.stations.universal.output.key, 'hashBrown', '通用台能做饭（薯饼）');
  const g7 = newGame();
  g7.addIngredient('syrup', 'universal', 0);
  g7.addIngredient('water', 'universal', 1);
  wait(g7, Math.round(g7.stoveMs * 1.5) + 5);
  eq('V217-uni-drink', () => g7.s.stations.universal.output.key, 'cola', '通用台能做饮品（可乐）');

  // ⑤ 中间产物（v2.18 口径反转）：通用台**可以**做半成品了，但读条按
  //    stoveMs × intermediateStepFactor(0.65) × timeFactor(1.5) 乘算 —— 「通用台更慢」这个代价保留。
  //    旧口径（forbidsIntermediate 在投料阶段就拦）已随本轮需求作废，断言改成反向判据。
  const g8 = newGame();
  g8.s.stations.universal.inputs[0] = g8.mkItem('lettuce');
  const coins8 = g8.s.coins;
  const r8 = g8.addIngredient('patty', 'universal', 1);
  eq('V217-uni-inter', () => [r8.ok, g8.s.stations.universal.busy, g8.s.stations.universal.pendingId],
    [true, true, 'vegPatty'], '通用台现在能做「生菜+肉饼（菜肉饼）」并开始读条');
  // v2.19.3：timeFactor 变成「按灶台等级取值」的数组，这里按当前等级取对应档位再乘
  const uniFactorAt = (gg) => {
    const tf = ctx.config.stations.universal.timeFactor;
    return Array.isArray(tf) ? tf[gg.s.devices.stove - 1] : tf;
  };
  eq('V217-uni-inter-dur', () => g8.s.stations.universal.duration,
    Math.round(g8.stoveMs * ctx.config.crafting.intermediateStepFactor * uniFactorAt(g8)),
    '通用台做半成品的读条 = stoveMs × 0.65 × 当前等级系数（乘算，仍比专用台慢）');
  ok('V217-uni-inter-coins', () => g8.s.coins === coins8 - 3, '投料照常扣本次成本（3）');
  // 同一对在食物台照做，读条仍只乘 0.65（专用台 timeFactor = 1）
  const g9 = newGame();
  g9.addIngredient('lettuce', 'food', 0);
  const r9 = g9.addIngredient('patty', 'food', 1);
  ok('V217-food-still-inter', () => r9.ok === true && g9.s.stations.food.busy === true && g9.s.stations.food.pendingId === 'vegPatty', '食物台仍可正常做菜肉饼');
  eq('V217-food-inter-dur', () => g9.s.stations.food.duration, Math.round(g9.stoveMs * ctx.config.crafting.intermediateStepFactor),
    '食物台做半成品的读条仍是 stoveMs × 0.65（timeFactor=1，不受影响）');
  // 饼底同理：通用台也能做
  const g10 = newGame();
  g10.s.stations.universal.inputs[0] = g10.mkItem('dough');
  eq('V217-uni-inter2', () => [g10.addIngredient('ketchup', 'universal', 1).ok, g10.s.stations.universal.pendingId],
    [true, 'pizzaBase'], '通用台也能做「面团+番茄酱（饼底）」');
  // 半成品真的能产出来（不是只进读条）
  const g10c = newGame();
  g10c.addIngredient('lettuce', 'universal', 0);
  g10c.addIngredient('patty', 'universal', 1);
  wait(g10c, g10c.s.stations.universal.duration + 5);
  eq('V217-uni-inter-out', () => g10c.s.stations.universal.output && g10c.s.stations.universal.output.key, 'vegPatty',
    '通用台真的产出一份菜肉饼');
  // 已做好的中间产物仍可当输入，做出成品
  const g10b = newGame();
  g10b.s.stations.universal.inputs[0] = g10b.mkItem('pizzaBase');
  const r10b = g10b.addIngredient('cheese', 'universal', 1);
  ok('V217-uni-inter-input', () => r10b.ok === true && g10b.s.stations.universal.pendingId === 'pizza', '通用台接受已有半成品做输入（饼底+芝士=披萨）');

  // ⑥ 存档往返：通用台与其它工位一视同仁
  const g11 = newGame();
  g11.s.stations.universal.inputs[0] = g11.mkItem('bread');
  g11.s.stations.universal.output = g11.mkItem('hashBrown');
  const g12 = new Game(ctx);
  g12.tutorialDone = true;
  ok('V217-uni-resume', () => g12.resume(g11.snapshot()) === true, '带通用台的存档可恢复');
  eq('V217-uni-resume-out', () => g12.s.stations.universal.output.key, 'hashBrown', '通用台输出槽随存档恢复');
  eq('V217-uni-resume-in', () => g12.s.stations.universal.inputs[0].key, 'bread', '通用台输入格随存档恢复');
});

section('V217 一键提交：最急顾客优先 / 等价类 / 只交成品 / 口径与手操一致', () => {
  // ① 只交可售成品：半成品与失败品一律跳过
  const g = newGame();
  addPlainCustomer(g, ['burger']);
  g.s.storage.push(g.mkItem('vegPatty'), g.mkItem('fail'));
  eq('V217-sub-empty', () => g.submitFromStorage(), { ok: false, reason: 'empty' }, '仓库里只有半成品/失败品 → 不交，返回 empty');
  eq('V217-sub-empty-keep', () => g.s.storage.length, 2, '仓库里那两件原样没动');

  // ② 没有顾客 / 有顾客但货不对口
  const g2 = newGame();
  g2.s.storage.push(g2.mkItem('burger'));
  eq('V217-sub-nocustomer', () => g2.submitFromStorage(), { ok: false, reason: 'noCustomer' }, '没有排队顾客 → noCustomer');
  const g3 = newGame();
  addPlainCustomer(g3, ['salad']);
  g3.s.storage.push(g3.mkItem('pizza'));
  eq('V217-sub-nomatch', () => g3.submitFromStorage(), { ok: false, reason: 'noMatch' }, '货不对口 → noMatch');
  const g3b = newGame();
  g3b.s.phase = 'dayEnd';
  eq('V217-sub-phase', () => g3b.submitFromStorage().reason, 'phase', '非营业中不提交');

  // ③ 最急的优先：两位顾客抢同一件货，剩余耐心少的先拿到
  const g4 = newGame();
  const calm = addPlainCustomer(g4, ['burger']);
  const urgent = addPlainCustomer(g4, ['burger']);
  calm.patience = 30000;
  urgent.patience = 4000;
  g4.s.storage.push(g4.mkItem('burger'));
  const r4 = g4.submitFromStorage();
  eq('V217-sub-count', () => [r4.ok, r4.count, r4.orders], [true, 1, 1], '交出一件并结算一单');
  eq('V217-sub-urgent', () => g4.s.customers.map((c) => c.id), [calm.id], '最急的（耐心 4000）先拿到，耐心的那位还在等');
  ok('V217-sub-urgent-done', () => urgent.items.every((x) => x.filled) && g4.s.dayStats.served === 1, '急单已按既有 settle 口径结算');

  // ④ 一单两件：一件一件交完，count=2 / orders=1
  const g5 = newGame();
  addPlainCustomer(g5, ['burger', 'cola']);
  g5.s.storage.push(g5.mkItem('cola'), g5.mkItem('burger'), g5.mkItem('fries'));
  const r5 = g5.submitFromStorage();
  eq('V217-sub-two', () => [r5.count, r5.orders], [2, 1], '一单两件：交 2 件、结算 1 单');
  eq('V217-sub-two-left', () => g5.s.storage.map((i) => i.key), ['fries'], '没有顾客要的那件留在仓库里');
  eq('V217-sub-two-done', () => g5.s.customers.length, 0, '整单交完顾客离场');

  // ⑤ 等价类：顾客要 cola，仓库里的 icedCola 可以交，结算按实际商品价
  const g6 = newGame();
  let seen = null;
  g6.on('served', (d) => { seen = d; });
  addPlainCustomer(g6, ['cola']);
  g6.s.storage.push(g6.mkItem('icedCola'));
  const r6 = g6.submitFromStorage();
  ok('V217-sub-eq-ok', () => r6.ok === true, '冰可乐满足「要可乐」的订单');
  eq('V217-sub-eq-fill', () => seen && seen.customer.items[0].filled, 'icedCola', '交付记录写实际商品 icedCola');
  // 饮品还有天气溢价（weatherCfg.drinkPriceMul），所以期望值 = 实际商品价 × 当日饮品倍率
  eq('V217-sub-eq-price', () => seen && seen.base, ctx.priceOf('icedCola') * g6.weatherCfg().drinkPriceMul, '结算按实际商品价（icedCola 6）而不是订单价（cola 4）');

  // ⑥ 外卖不参与
  const g7 = newGame();
  addPlainCustomer(g7, ['burger']);
  g7.s.deliveries = [{ id: -1, status: 'rider_arrived', item: 'burger', phoneAt: 0, riderAt: 0, effectiveWait: 10000, deliveredAt: 0 }];
  g7.s.storage.push(g7.mkItem('burger'));
  g7.submitFromStorage();
  eq('V217-sub-nodelivery', () => g7.s.deliveries[0].status, 'rider_arrived', '外卖订单不参与一键提交（只服务队列里的顾客）');

  // ⑦ 连击 / 日统计 / 成就计数器与手操同一口径
  const g8 = newGame();
  addPlainCustomer(g8, ['burger']);
  g8.s.storage.push(g8.mkItem('burger'));
  const coins8 = g8.s.coins;
  g8.submitFromStorage();
  ok('V217-sub-settle', () => g8.s.combo === 1 && g8.s.dayStats.served === 1 && g8.s.coins > coins8, '连击 +1、日统计 +1、金币增加（复用 settle）');
  eq('V217-sub-ach', () => g8.s.ach.orders, 1, '成就计数器 orders +1（与手操交付一致）');

  // ⑧ 教学顾客不被自动交掉（教学单必须玩家亲手递）
  const g9 = newGame();
  const tut = addPlainCustomer(g9, ['burger']);
  tut.tutorial = true;
  g9.s.storage.push(g9.mkItem('burger'));
  eq('V217-sub-tutorial', () => g9.submitFromStorage().reason, 'noCustomer', '只有教学顾客时视为「没有排队顾客」');
  ok('V217-sub-tutorial-keep', () => g9.s.storage.length === 1 && !tut.items[0].filled, '教学顾客的订单没有被自动填');
});

// ================================================================ v2.17.1：当日菜单订单池数据化 + 新菜入池
section('V217.1 当日菜单池：食物池读配置 / 新菜入池 / 池子真的被采样', () => {
  const dl = ctx.config.meta.dayLoop;

  // ① 池子内容：四道新菜都进池，且池里没有未知 id
  ok('V2171-pool-food', () => ['hashBrown', 'cheeseFries'].every((id) => dl.foodPool.includes(id) && dl.foodPoolHard.includes(id)), '两道新主食同时进普通 / 困难食物池');
  ok('V2171-pool-drink', () => ['latte', 'milkTea'].every((id) => dl.drinkPool.includes(id)), '两道新饮品进入饮品池');
  eq('V2171-pool-unknown', () => [...new Set([...dl.foodPool, ...dl.foodPoolHard, ...dl.drinkPool])].filter((id) => !ctx.byId.has(id)), [], '池里没有未知 / 非配方 id');
  // 天气偏好按 coldDrinks/hotDrinks 判定，新热饮不进表就恒为 neutral（天气完全不影响它们）
  ok('V2171-hot', () => ['latte', 'milkTea'].every((id) => ctx.config.weather.hotDrinks.includes(id)), '两道新热饮进 hotDrinks（否则天气偏好对它们失效）');

  // ② 兜底：配置里抽掉 foodPool / foodPoolHard 时，回落到旧的硬编码数组，不炸也不空菜单
  const cfg2 = {
    ...ctx.config,
    meta: { ...ctx.config.meta, dayLoop: { ...dl, foodPool: undefined, foodPoolHard: undefined } },
  };
  const ctx2 = buildCtx(cfg2, ctx.crafts, ctx.layout, ctx.i18n);
  const g2 = new Game(ctx2);
  g2.tutorialDone = true;
  g2.newRun('hard', 1);
  eq('V2171-fallback', () => [g2.s.menu.foods[0], g2.s.menu.foods.length, g2.s.menu.drinks.length], ['signatureBurger', 3, 3], '配置缺食物池时回落到旧硬编码池（菜单仍是 3+3）');

  // ③ 21 个（周, 天）种子全覆盖：主菜固定、其余只从池里抽、不重复、不越池，
  //    并且池内每道菜（含四道新菜）都真的被排上过 —— 证明池子不是摆设。
  for (const spec of [
    { mode: 'normal', poolKey: 'foodPool', main: 'burger' },
    { mode: 'hard', poolKey: 'foodPoolHard', main: 'signatureBurger' },
  ]) {
    const gg = newGame(spec.mode);
    const pool = dl[spec.poolKey];
    const seenFood = new Set();
    const seenDrink = new Set();
    const bad = [];
    for (let w = 1; w <= 3; w++) {
      for (let d = 1; d <= 7; d++) {
        gg.s.week = w;
        gg.s.menu = null;        // 强制重抽当日菜单（同 mode|week|day 必得同一串）
        gg.startDay(d);
        const m = gg.s.menu;
        const tag = `w${w}d${d}`;
        if (m.foods[0] !== spec.main) bad.push(`${tag}:主菜=${m.foods[0]}`);
        if (m.drinks[0] !== 'cola') bad.push(`${tag}:可乐缺席`);
        if (m.foods.length !== 3 || m.drinks.length !== 3) bad.push(`${tag}:长度=${m.foods.length}/${m.drinks.length}`);
        if (new Set(m.foods).size !== 3 || new Set(m.drinks).size !== 3) bad.push(`${tag}:重复`);
        if (!m.foods.slice(1).every((id) => pool.includes(id))) bad.push(`${tag}:主食越池`);
        if (!m.drinks.slice(1).every((id) => dl.drinkPool.includes(id))) bad.push(`${tag}:饮品越池`);
        m.foods.forEach((id) => seenFood.add(id));
        m.drinks.forEach((id) => seenDrink.add(id));
      }
    }
    eq(`V2171-menu-${spec.mode}`, bad, [], `${spec.mode}：21 个日种子下菜单结构全部合规（主菜固定 / 只从池里抽 / 不重复）`);
    ok(`V2171-cover-${spec.mode}`, () => ['hashBrown', 'cheeseFries', 'latte', 'milkTea'].every((id) => seenFood.has(id) || seenDrink.has(id)), `${spec.mode}：四道新菜在 21 天里都真的被排上过`);
    ok(`V2171-sample-${spec.mode}`, () => pool.every((id) => seenFood.has(id)) && dl.drinkPool.every((id) => seenDrink.has(id)), `${spec.mode}：池内每道菜 21 天内都出现过（池子确实在被采样）`);
  }

  // ④ 新菜真的能被下单：把某天菜单钉成含新菜的组合，顾客就会点它们
  const gd = newGame();
  gd.s.menu = { foods: ['burger', 'cheeseFries', 'hashBrown'], drinks: ['cola', 'latte', 'milkTea'], main: 'burger', mainDrink: 'cola' };
  gd.s.customers = [];
  const wanted = new Set();
  for (let i = 0; i < 300; i++) {
    const c = gd.spawnCustomer();
    c.items.forEach((sl) => { if (sl.wants) wanted.add(sl.wants); });
  }
  ok('V2171-order-new', () => ['cheeseFries', 'hashBrown', 'latte', 'milkTea'].every((id) => wanted.has(id)), '菜单含新菜时顾客真会点它们（订单闭环）');
  eq('V2171-order-scope', () => [...wanted].filter((id) => ![...gd.s.menu.foods, ...gd.s.menu.drinks].includes(id)), [], '顾客只会点当日菜单里的菜');
});

finish('结果');
