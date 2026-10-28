// 食合物语 —— 游戏引擎（纯逻辑，无 DOM 依赖，可在 Node 中直接验收）
// 数值一律来自 ctx.config / ctx.crafts，不写业务字面量。
//
// 配置缺失处理约定（v2.5 统一，口径与 deliverySettleMs 一致）：
//   · 业务关键配置（影响结算/天数/槽位/大单判定等机制）缺失或非法 → **显式 throw**，
//     宁可炸在调用点，也不要用一个假默认值把错误藏起来；
//   · 纯展示性默认值（如 phone 进度条的兜底文案）可以保留，但必须在注释里标明是展示兜底。

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.cfg = ctx.config;
    this.crafts = ctx.crafts;
    this.byId = ctx.byId;
    this.t = ctx.t;
    this._uid = 1;
    this._listeners = new Map();
    this.s = null;
    this.hardUnlocked = false;
    this.tutorialDone = false;
  }

  // ---------------------------------------------------------------- events
  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, []);
    this._listeners.get(evt).push(fn);
  }

  /**
   * 派发事件（同步）
   * 每个监听器单独 try/catch：视图/音频任一回调抛错都不得拖垮其他监听器，
   * 更不能沿 tick → emit 冒泡打断主循环（M17）。
   */
  emit(evt, data) {
    const arr = this._listeners.get(evt);
    if (!arr) return;
    for (const fn of arr.slice()) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[OWK] 事件 ${evt} 的监听器抛出异常`, err);
      }
    }
  }

  // ---------------------------------------------------------------- getters
  get stoveMs() { return this.cfg.devices.stove.values[this.s.devices.stove - 1]; }
  get counterMul() { return this.cfg.devices.counter.values[this.s.devices.counter - 1]; }
  get signMul() { return this.cfg.devices.sign.values[this.s.devices.sign - 1]; }
  get trashCdMs() { return this.cfg.trash.levels[this.s.devices.trash - 1].cooldownMs; }
  get storageCap() { return this.cfg.storage.capByDiff[this.s.mode]; }
  get maxQueue() { return this.cfg.difficulty[this.s.mode].pace.maxQueue; }
  get pace() { return this.cfg.difficulty[this.s.mode].pace; }
  get diffCfg() { return this.cfg.difficulty[this.s.mode]; }

  /**
   * 每周营业天数（唯一来源：config.economy.daysPerWeek）
   * 业务关键配置：缺失即显式报错。统一策略见本文件顶部「配置缺失处理约定」。
   */
  get daysPerWeek() {
    const v = this.cfg.economy && this.cfg.economy.daysPerWeek;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error('[OWK] config.economy.daysPerWeek 缺失或非法');
    }
    return v;
  }

  kindOf(id) { return this.ctx.kindOf(id); }
  priceOf(id) { return this.ctx.priceOf(id); }
  leafCost(id) { return this.ctx.leafCost(id); }

  mkItem(key) { return { uid: 'i' + (this._uid++), key }; }

  /** 某工位的空输入槽（槽数来自 config.stations[key].inputSlots，代码里不写死 2） */
  blankInputs(stationKey) {
    const st = this.cfg.stations && this.cfg.stations[stationKey];
    const n = st && Number(st.inputSlots);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`[OWK] config.stations.${stationKey}.inputSlots 缺失或非法`);
    }
    return Array.from({ length: n }, () => null);
  }

  blankStation(key) {
    return { inputs: this.blankInputs(key), output: null, busy: false, progress: 0, duration: 0, pendingId: null };
  }

  // ---------------------------------------------------------------- 存档取值的数值工具
  /** 只接受有限数值，其余一律回落（NaN / undefined / 字符串都算脏数据） */
  _num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  /** 取整并钳位到 [min, max] */
  _clampInt(v, fallback, min, max) {
    const n = Math.round(this._num(v, fallback));
    return Math.max(min, Math.min(max, n));
  }

  /** 物品 key 是否合法（成品 / 半成品 / 叶食材 / 失败品） */
  _validKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (key === 'fail') return true;
    return this.byId.has(key) || this.cfg.ingredients[key] != null;
  }

  // ================================================================ 外卖（OWK-CFG-005 §10，按用户流程重做）
  /** 本局累计营业日（跨周不重置） */
  runDay() {
    const s = this.s;
    return (s.week - 1) * 7 + s.day;
  }

  /** 生成当日外卖订单：每单 1 个餐点（食物或饮品），时间点固定，不消耗店内 RNG */
  rollDeliveries() {
    const s = this.s;
    const dc = this.cfg.delivery;
    if (!dc || !dc.enabled) return [];
    const dm = dc.modes[s.mode] || dc.modes.normal;
    if (this.runDay() < (dm.unlockRunDay || 99)) return [];
    const rainy = s.weather === 'rain';
    const times = (rainy ? dm.rainPhoneAtMs : dm.phoneAtMs) || [];
    const rnd = this.ctx.mulberry32(this.ctx.hash(`${s.mode}|${s.week}|${s.day}|delivery`));
    return times.map((phoneAt, i) => {
      // 每单 1 个餐点：50% 食物、50% 饮品
      const isDrink = rnd() < 0.5;
      const list = isDrink ? (s.menu.drinks || []) : (s.menu.foods || []);
      const item = list.length ? list[Math.floor(rnd() * list.length)] : (isDrink ? 'cola' : 'burger');
      return {
        id: -(i + 1),
        status: 'scheduled', // scheduled → preview → rider_arrived → picked_up → delivered
        item,
        phoneAt,
        // 预警提前量：手机在骑手到店前 previewMs 毫秒亮屏，提示所需物品并倒计时
        riderAt: phoneAt + (dc.previewMs || 10000),
        effectiveWait: (dm.riderWaitMs || 10000) + (rainy ? (dc.rainRiderWaitBonusMs || 0) : 0),
        deliveredAt: 0, // 骑手取走后 10 秒结算
      };
    });
  }

  /** 推进外卖时序：亮屏预警 → 骑手到店 → 取走 10 秒后送达结算 */
  updateDeliveries() {
    const s = this.s;
    if (!s || !s.deliveries || s.phase !== 'day') return;
    const t = s.time;
    for (const d of s.deliveries) {
      if (d.status === 'delivered') continue;
      if (d.status === 'scheduled' && t >= d.phoneAt) {
        d.status = 'preview';
        this.emit('deliveryPreview', d); // 手机预警：提前提示所需物品并倒计时
      }
      if (d.status === 'preview' && t >= d.riderAt) {
        d.status = 'rider_arrived';
        this.emit('deliveryRiderArrived', d); // 倒计时结束，骑手到店
      }
      // 骑手取走 10 秒后配送完成并结算（按送达口径：双倍金币）
      if (d.status === 'picked_up' && d.deliveredAt && t >= d.deliveredAt) {
        d.status = 'delivered';
        const earned = this.deliveryEarn(d, { delivered: true });
        this.settleDelivery(d, earned, { delivered: true });
      }
    }
  }

  deliveryById(id) {
    return (this.s && this.s.deliveries) ? this.s.deliveries.find((d) => d.id === id) : null;
  }

  /** 把餐点拖给骑手：骑手到店后才可交付；交付后骑手取走离开 */
  pickupDelivery(id) {
    const s = this.s;
    const d = this.deliveryById(id);
    if (!d) return { ok: false, reason: 'gone' };
    if (d.status !== 'rider_arrived') return { ok: false, reason: 'status' };
    // 结算延迟读 cfg.delivery.deliverySettleMs；缺配置就显式报错，而不是静默用错值（M5）
    const settleMs = this.cfg.delivery && this.cfg.delivery.deliverySettleMs;
    if (typeof settleMs !== 'number' || !Number.isFinite(settleMs)) {
      throw new Error('[OWK] config.delivery.deliverySettleMs 缺失或非法');
    }
    d.status = 'picked_up';
    d.deliveredAt = s.time + settleMs;
    this.emit('deliveryPickedUp', d); // 骑手离开，手机提示「骑手已离开」
    this.emit('change');
    return { ok: true };
  }

  /**
   * 外卖收益（整数运算）：base × 收银台% × 小费% × 150%
   * 收银台加成与堂食共用 config.devices.counter.values（Lv1=100% … Lv4=130%），此处不再另立口径（M4）
   * @param {object} d 订单
   * @param {{delivered?: boolean}} [opts]
   *   delivered = true 表示「玩家已把餐点交给骑手、订单按送达口径结算」：
   *   收益再乘 config.delivery.deliveredMul（默认 2），即「正常订单的双倍金币」（F1）。
   *   未交付（pending）的订单只按基础公式给钱，不吃这个倍率（F2）。
   */
  deliveryEarn(d, opts = {}) {
    const dc = this.cfg.delivery;
    const base = this.priceOf(d.item) || 0;
    const regPercent = Math.round((this.counterMul || 1) * 100);
    // 小费按交付时机：骑手到店后尽快交付
    const elapsed = Math.max(0, this.s.time - d.riderAt);
    const remainRatio = Math.max(0, Math.min(1, 1 - elapsed / (d.effectiveWait || 10000)));
    const patRatioPct = Math.round(remainRatio * 100);
    const tipPercent = 100 + Math.floor(((dc.tipMaxPercent || 30) * patRatioPct) / 100);
    const mul = opts.delivered ? (dc.deliveredMul || 2) : 1;
    return Math.floor((base * regPercent * tipPercent * (dc.incomePercent || 150) * mul) / 1000000);
  }

  /**
   * 外卖结算（交付后 deliverySettleMs 或日结并入时调用）
   * @param {object} d 订单
   * @param {number} earned 本次收益
   * @param {{pending?: boolean, delivered?: boolean}} [opts]
   *   pending = true 表示「玩家从未交付、日结并入」：按基础公式给钱、不吃送达倍率，
   *   不发猫猫币（§4.6「仅成功交付 +1」），日统计记 deliveryPending 而非 deliveryServed —— 同一单只会在日统计里出现一次（M21）。
   *   delivered = true 表示「已把餐点交给骑手」（正常送达，或已提交但跨天由日结兜底）：
   *   收益按送达口径（双倍），发猫猫币，日统计记 deliveryServed。
   *   周统计 deliveryServed 是「本周外卖总单数」，两种来源都计入（周弹窗只展示这一个字段）。
   */
  settleDelivery(d, earned, opts = {}) {
    const s = this.s;
    const pending = !!opts.pending;
    const delivered = !!opts.delivered;
    d.status = 'delivered';
    s.coins += earned;
    s.dayStats.served += 1;
    s.dayStats.earned += earned;
    s.dayStats.income += earned;
    s.dayStats.delivered = (s.dayStats.delivered || 0) + 1;
    if (pending) s.dayStats.deliveryPending = (s.dayStats.deliveryPending || 0) + 1;
    else s.dayStats.deliveryServed = (s.dayStats.deliveryServed || 0) + 1;
    s.dayStats.deliveryRevenue = (s.dayStats.deliveryRevenue || 0) + earned;
    s.weekStats.deliveryServed = (s.weekStats.deliveryServed || 0) + 1;
    s.weekStats.deliveryRevenue = (s.weekStats.deliveryRevenue || 0) + earned;
    d.earned = earned;

    let cat = 0;
    if (!pending) {
      const dc = this.cfg.delivery || {};
      const cap = dc.catCoinDayCap != null ? dc.catCoinDayCap : 2;
      if ((s.dayStats.deliveryCatCoins || 0) < cap) {
        cat = dc.catCoinPerOrder || 1;
        s.dayStats.deliveryCatCoins = (s.dayStats.deliveryCatCoins || 0) + cat;
        s.catEarned += cat;
        this.emit('catCoin', { amount: cat, reason: 'delivery' });
      }
      // 成就埋点：送达口径的外卖单才计入「已完成外卖」（F5）
      this.bumpCounter('deliveries', 1);
      if (opts.crossDay) this.bumpCounter('crossDay', 1);
    }
    this.emit('deliveryDone', { ...d, earned, cat, pending });
    this.emit('change');
    return { earned, cat };
  }

  /**
   * 日结：把未完成的外卖并入当天总结算（不惩罚，直接按公式给钱）
   * 状态机里没有 'missed' 终态 —— 骑手驻足至日结，只会出现 scheduled / preview /
   * rider_arrived / picked_up / delivered 五种状态（L4）。
   *
   * 两类未完成订单在日结时的口径不同（F2）：
   * - picked_up（玩家已把餐点交给骑手，配送途中跨天）：按**送达口径**结算 ——
   *   双倍金币 + 猫猫币，计入 deliveryServed；玩家已完成交付动作，不该因跨天而少拿钱。
   * - scheduled / preview / rider_arrived（玩家从未交付）：按**基础公式**结算 ——
   *   不吃送达倍率、不发猫猫币，计入 deliveryPending。
   */
  settlePendingDeliveries() {
    const s = this.s;
    if (!s || !s.deliveries) return { count: 0, earned: 0, deliveredCount: 0 };
    let count = 0;
    let earned = 0;
    let deliveredCount = 0;
    for (const d of s.deliveries) {
      if (d.status === 'delivered') continue;
      const submitted = d.status === 'picked_up';
      const e = this.deliveryEarn(d, { delivered: submitted });
      const r = this.settleDelivery(d, e, { pending: !submitted, delivered: submitted, crossDay: submitted });
      count += 1;
      earned += r.earned;
      if (submitted) deliveredCount += 1;
    }
    return { count, earned, deliveredCount };
  }

  // ================================================================ 成就（OWK-CFG-005 §1）
  /** 累计计数器（跨周/跨局由启动器持久化；这里只在本局内累计后交给它合并） */
  bumpCounter(key, n = 1) {
    const s = this.s;
    if (!s) return;
    if (!s.ach) s.ach = this.blankAch();
    const c = s.ach;
    if (key === 'orders') c.orders += n;
    else if (key === 'revenue') c.revenue += n;
    else if (key === 'vip') c.vip += n;
    else if (key === 'trash') c.trash += n;
    else if (key === 'bigOrder') c.bigOrders += n;
    else if (key === 'deliveries') c.deliveries += n;
    else if (key === 'crossDay') c.crossDay += n;
    else if (key === 'maxStorage') c.maxStorage = Math.max(c.maxStorage, n);
    else if (key === 'serveTime') {
      c.serveTimes.push(n);
      if (c.serveTimes.length > 8) c.serveTimes.shift();
    }
  }

  /** 本周已出现过的不同天气数量（用于「一周经历 3 种以上天气」成就） */
  weekWeatherVariety() {
    const s = this.s;
    const plan = s && Array.isArray(s.weekWeather) ? s.weekWeather : [];
    // 只统计已经过的日子（day 为当前进行中的第几天，前面 day-1 天已过）
    const seen = plan.slice(0, Math.max(0, (s.day || 1) - 1));
    if (s.weather) seen.push(s.weather);
    return new Set(seen).size;
  }

  /**
   * 结算时批量检查成就（不与 tick 耦合）
   * @param {'day'|'week'} when
   * @param {object} extra  跨局数据（累计订单/营业额/VIP/皮肤/主题），由启动器提供
   * @returns {Array} 本次新解锁的成就
   */
  checkAchievements(when, extra = {}) {
    const s = this.s;
    const cfg = this.cfg.achievements;
    if (!s || !cfg) return [];
    if (!s.ach) s.ach = this.blankAch();
    const c = s.ach;
    const st = s.dayStats;
    const ws = s.weekStats;
    const tot = extra.totals || {};
    const unlocked = new Set(extra.unlocked || []);

    const bothBusyMs = s.ach.bothBusyMs;
    // 最近 3 单的成交时间跨度 ≤ 10 秒（滚动窗口，serveTimes 只保留最近 8 条）
    const speed3 = c.serveTimes.length >= 3
      && (c.serveTimes[c.serveTimes.length - 1] - c.serveTimes[c.serveTimes.length - 3] <= 10000);

    const pass = (cond) => {
      switch (cond) {
        case 'daySurvived': return true;
        case 'paidRent': return when === 'week';
        case 'day5': return s.day >= 5;
        case 'weeks3': return s.week >= 3;
        case 'weeks5': return s.week >= 5;
        case 'hardPaidRent': return s.mode === 'hard' && when === 'week';
        case 'firstServe': return (tot.orders || 0) + c.orders >= 1;
        case 'dayEarned100': return (st.earned + st.bonus) >= 100;
        case 'totalOrders100': return (tot.orders || 0) + c.orders >= 100;
        case 'totalRevenue2000': return (tot.revenue || 0) + c.revenue >= 2000;
        case 'rentRich': return when === 'week' && s.coins >= 300;
        case 'vip10': return (tot.vip || 0) + c.vip >= 10;
        case 'zeroWasteDay': return st.waste === 0 && st.lost === 0;
        case 'zeroWasteWeek': return when === 'week' && ws.waste === 0 && ws.lost === 0 && ws.discarded === 0;
        case 'doublePot10s': return bothBusyMs >= 10000;
        case 'speed3': return speed3;
        case 'storage4': return c.maxStorage >= 4 && s.storage.length === 0;
        case 'noTrashWeek': return when === 'week' && c.trash === 0;
        case 'bigOrder3': return c.bigOrders >= 3;
        case 'rainDay120': return s.weather === 'rain' && (st.earned + st.bonus) >= 120;
        case 'heatDayLost1': return s.weather === 'heat' && st.lost <= 1;
        case 'fogDay8Orders': return s.weather === 'fog' && st.served >= 8;
        case 'own3Skins': return (extra.ownedSkins || 0) >= 3;
        case 'own1Theme': return (extra.ownedThemes || 0) >= 1;
        // ---- v2.8 新增 ----
        // 完成第一单外卖（送达口径才计数：pending 并入不算「完成」）
        case 'deliveryFirst': return c.deliveries >= 1;
        // 累计 10 单外卖（跨局 tot + 本局增量）
        case 'totalDeliveries10': return (tot.deliveries || 0) + c.deliveries >= 10;
        // 跨天结算时仍完成了一单外卖（食物已提交、骑手配送跨天）
        case 'crossDayDelivery': return c.crossDay >= 1;
        // 一周内经历 3 种以上天气
        case 'weatherVariety3': return when === 'week' && this.weekWeatherVariety() >= 3;
        // 单日成交 12 单
        case 'dayOrders12': return st.served >= 12;
        // 持有金币达到 500
        case 'coins500': return s.coins >= 500;
        // 累计营业额 5000
        case 'totalRevenue5000': return (tot.revenue || 0) + c.revenue >= 5000;
        // 累计获得 30 枚猫猫币（跨局持久化在 ach.counters.catCoins）
        case 'catCoins30': return (tot.catCoins || 0) >= 30;
        // 热浪天成交 8 单
        case 'heatDay8Orders': return s.weather === 'heat' && st.served >= 8;
        // 雪天单日营业额 ≥ 150
        case 'snowDay150': return s.weather === 'snow' && (st.earned + st.bonus) >= 150;
        default: return false;
      }
    };

    const got = [];
    for (const a of cfg.list) {
      if (a.when !== when) continue;
      if (unlocked.has(a.id)) continue;
      if (!pass(a.cond)) continue;
      got.push({ id: a.id, reward: a.reward, group: a.group });
    }
    return got;
  }

  /** 猫猫币收益（困难模式翻倍） */
  catGain(reason) {
    const cc = this.cfg.catCoins || {};
    const base = reason === 'week' ? (cc.perWeek != null ? cc.perWeek : 0) : (cc.perDay || 0);
    const mul = this.s && this.s.mode === 'hard' ? (cc.hardMul || 1) : 1;
    return Math.round(base * mul);
  }

  /**
   * 周结算「金币奖励猫猫币」查询（v2.8 新规则）
   *
   * 规则：每满 rate（25）金币**额外奖励** 1 枚猫猫币，**不消耗金币**。
   * 例：第一周结算时持有 250 金币 → 额外获得 10 枚猫猫币。
   * 上限：单周最多 cap（100）枚，由 config.catCoins.weeklyExchangeCap 控制。
   *
   * 口径说明：
   * - earned  = 按当前金币余额可得的枚数（未封顶）＝ floor(coins / rate)
   * - bonus   = 本次可发放上限（受单周 cap 约束）
   * - granted = 本周已发放枚数（weekStats.exchangedCat）
   * - left    = 本次实际可发放枚数 ＝ bonus − granted
   * - 金币**不被扣除**：这是「额外奖励」而非兑换，玩家金币余额保持不变。
   */
  exchangeInfo() {
    const s = this.s;
    const cc = this.cfg.catCoins || {};
    const rate = cc.exchangeRate || 25;
    const cap = cc.weeklyExchangeCap || 100;
    const coins = s ? Math.max(0, Math.floor(s.coins)) : 0;
    const earned = Math.floor(coins / rate);
    const granted = s ? (s.weekStats.exchangedCat || 0) : 0;
    const bonus = Math.min(cap, earned);
    return { rate, cap, coins, earned, bonus, granted, left: Math.max(0, bonus - granted) };
  }

  /**
   * 周结算发放「金币奖励猫猫币」（自动，不再是手动兑换）
   * 金币不被消耗，只是额外奖励猫猫币。
   * @returns {{amount:number, coins:number}|null}
   */
  grantCoinBonus() {
    const s = this.s;
    if (!s) return null;
    const info = this.exchangeInfo();
    const amount = Math.max(0, info.left);
    s.weekStats.coinBonus = amount;
    if (!amount) return { amount: 0, coins: s.coins };
    s.weekStats.exchangedCat = (s.weekStats.exchangedCat || 0) + amount;
    s.catEarned += amount;
    this.emit('catCoin', { amount, reason: 'coinBonus', week: s.week });
    return { amount, coins: s.coins };
  }

  blankDayStats() {
    return {
      served: 0, lost: 0, waste: 0, income: 0, earned: 0, bonus: 0, voided: 0, delivered: 0,
      // 外卖分项：deliveryServed = 玩家实际交付；deliveryPending = 日结并入（两者互斥，同一单只落其一）
      deliveryServed: 0, deliveryPending: 0, deliveryRevenue: 0, deliveryCatCoins: 0,
    };
  }

  blankWeekStats() {
    return {
      served: 0, lost: 0, waste: 0, earned: 0, bonus: 0, recycled: 0, discarded: 0,
      rent: 0, days: 0, exchangedCat: 0, coinBonus: 0,
      // 本周外卖总单数（实际交付 + 日结并入）与总收益
      deliveryServed: 0, deliveryRevenue: 0,
    };
  }

  /** 一局内的成就计数器（跨局累计值由启动器持久化，这里只存本局增量） */
  blankAch() {
    return {
      orders: 0, revenue: 0, vip: 0, trash: 0, bigOrders: 0, bothBusyMs: 0, maxStorage: 0, serveTimes: [],
      // deliveries = 已完成（送达口径）外卖单数；crossDay = 其中跨天结算的单数
      deliveries: 0, crossDay: 0,
    };
  }

  // ---------------------------------------------------------------- lifecycle
  newRun(mode = 'normal', week = 1) {
    this.s = {
      mode, week, day: 1,
      coins: this.cfg.economy.startCoins,
      weekStartCoins: this.cfg.economy.startCoins,
      devices: { stove: 1, counter: 1, sign: 1, trash: 1 },
      selectedStation: 'food',
      catEarned: 0,
      weather: 'sunny', weekWeather: null, weekWeatherWeek: 0,
      deliveries: [],
      ach: this.blankAch(),
      stations: { food: this.blankStation('food'), drink: this.blankStation('drink') },
      storage: [], customers: [],
      spawnTimer: 0, spawned: 0, perDay: 0, spawnInterval: 0, endTimer: 0,
      paused: false, phase: 'day',
      combo: 0, bestCombo: 0,
      trashCd: 0,
      time: 0,
      tutorial: { active: false, step: 0 },
      dayStats: this.blankDayStats(),
      weekStats: this.blankWeekStats(),
      lastSettle: null,
      menu: null,
      rng: null,
    };
    const wantsTutorial = !this.tutorialDone && mode === 'normal' && week === 1;
    if (wantsTutorial) this.s.tutorial = { active: true, step: 'bread' };
    this.startDay(1);
    this.emit('change');
  }

  /**
   * 从存档恢复（当日开门）
   * 约定：
   * - 存档只覆盖「中局快照」：天数/金币/设备/仓储/两工位/在场顾客（含剩余耐心）。
   * - 旧版本存档缺字段一律回落默认值，不抛错（向后兼容）。
   * - 设备等级与所有数值做钳位，脏存档不会把工位卡死在 busy。
   * - 恢复不重放任何「发放」类事件（猫币 / 成就）—— 那些已在当时的存档点落盘。
   * - 本局成就计数器（s.ach）原样恢复：跨局累计值只在「上一局结束」时并入局外存档，
   *   因此这里恢复本局增量不会造成重复累加（见 main.js 的 flushAchCounters）。
   * @param {object} save
   * @returns {boolean} 是否恢复成功
   */
  resume(save) {
    if (!save || typeof save !== 'object' || !save.mode) return false;
    const mode = save.mode === 'hard' ? 'hard' : 'normal';
    this.hardUnlocked = !!(save.hardUnlocked || this.hardUnlocked);
    this.tutorialDone = !!save.tutorialDone;
    // 先建立干净状态（内部会 startDay(1)，随后再用存档覆盖）
    this.newRun(mode, this._clampInt(save.week, 1, 1, 9999));
    const s = this.s;

    s.coins = this._num(save.coins, this.cfg.economy.startCoins);
    s.weekStartCoins = this._num(save.weekStartCoins, s.coins);
    s.catEarned = this._num(save.catEarned, 0);
    s.devices = this._clampDevices(save.devices);
    s.ach = this._sanitizeAch(save.ach);
    s.storage = this._restoreItems(save.storage);
    // 天气：存档里有整整一周的排布就照用，否则由 ensureWeekWeather 按 mode/week 确定性重排
    if (Array.isArray(save.weekWeather) && save.weekWeather.length === this.daysPerWeek) {
      s.weekWeather = save.weekWeather.slice();
      s.weekWeatherWeek = this._clampInt(save.weekWeatherWeek, s.week, 0, 9999);
    }

    const day = this._clampInt(save.day, 1, 1, this.daysPerWeek);
    this.startDay(day); // 重置当日统计/菜单/外卖，并把 s.time 归零

    // startDay 会清空在场顾客，因此工位与顾客必须在其后恢复
    s.stations = this._restoreStations(save.stations);
    s.customers = this._restoreCustomers(save.customers);
    if (save.tutorial && typeof save.tutorial === 'object') {
      s.tutorial = {
        active: !!save.tutorial.active,
        step: save.tutorial.step != null ? save.tutorial.step : 0,
      };
    }
    // 教学态兜底：显示「教学中」却找不到教学顾客 → 判定教学已结束，避免整局既不再生成顾客也不打烊
    if (s.tutorial.active && !s.customers.some((c) => c.tutorial)) this.finishTutorial();

    // uid 续号：存档里的物品/顾客自带 id，继续自增会撞号（拖拽按 uid 比对）
    this._uid = Math.max(this._uid, this._maxUidInState() + 1);
    this.emit('change');
    return true;
  }

  /** 扫描当前状态里已用的最大 uid 序号（i12 / c34） */
  _maxUidInState() {
    const s = this.s;
    let max = 0;
    const bump = (uid) => {
      const m = /^[ic](\d+)$/.exec(String(uid || ''));
      if (m) max = Math.max(max, Number(m[1]));
    };
    for (const it of s.storage) bump(it.uid);
    for (const st of Object.values(s.stations)) {
      if (st.output) bump(st.output.uid);
      for (const it of st.inputs) if (it) bump(it.uid);
    }
    for (const c of s.customers) bump(c.id);
    return max;
  }

  /** 设备等级钳位：Math.max(1, Math.min(等级表长度, n))，非法值回落 1（S4-②） */
  _clampDevices(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const limits = {
      stove: this.cfg.devices.stove.values.length,
      counter: this.cfg.devices.counter.values.length,
      sign: this.cfg.devices.sign.values.length,
      trash: this.cfg.trash.levels.length,
    };
    const out = {};
    for (const key of Object.keys(limits)) {
      const max = Math.max(1, limits[key]);
      out[key] = Math.max(1, Math.min(max, this._clampInt(src[key], 1, 1, max)));
    }
    return out;
  }

  _sanitizeAch(raw) {
    const out = this.blankAch();
    if (!raw || typeof raw !== 'object') return out;
    for (const key of ['orders', 'revenue', 'vip', 'trash', 'bigOrders', 'bothBusyMs', 'maxStorage', 'deliveries', 'crossDay']) {
      out[key] = Math.max(0, this._num(raw[key], 0));
    }
    if (Array.isArray(raw.serveTimes)) {
      out.serveTimes = raw.serveTimes
        .filter((x) => typeof x === 'number' && Number.isFinite(x))
        .slice(-8);
    }
    return out;
  }

  /** 存档物品还原（key 非法则丢弃；超出当前仓储容量则截断） */
  _itemFrom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!this._validKey(raw.key)) return null;
    const uid = typeof raw.uid === 'string' && raw.uid ? raw.uid : 'i' + (this._uid++);
    return { uid, key: raw.key };
  }

  _restoreItems(rawList) {
    const out = [];
    if (!Array.isArray(rawList)) return out;
    const cap = this.storageCap;
    for (const raw of rawList) {
      if (out.length >= cap) break;
      const it = this._itemFrom(raw);
      if (it) out.push(it);
    }
    return out;
  }

  /** 两工位还原：输入/输出槽、读条进度、合成中的产物 */
  _restoreStations(raw) {
    const out = {};
    // 至少保留 food / drink 两个工位，即使配置缺失也不会让 tick 里 s.stations.food 变成 undefined
    const keys = new Set(['food', 'drink', ...Object.keys(this.cfg.stations || {})]);
    for (const key of keys) {
      const st = this.blankStation(key);
      const src = raw && raw[key];
      if (src && typeof src === 'object') {
        const inputs = this.blankInputs(key);
        if (Array.isArray(src.inputs)) {
          for (let i = 0; i < inputs.length; i++) inputs[i] = this._itemFrom(src.inputs[i]);
        }
        st.inputs = inputs;
        st.output = this._itemFrom(src.output);
        st.pendingId = typeof src.pendingId === 'string' && src.pendingId ? src.pendingId : null;
        const duration = this._num(src.duration, 0);
        const progress = this._num(src.progress, 0);
        // 只有在「有产物可出 + 时长合法」时 busy 才成立，脏数据不会造成永久卡死
        st.busy = !!src.busy && !!st.pendingId && duration > 0;
        st.duration = duration > 0 ? duration : 0;
        st.progress = st.busy ? Math.max(0, Math.min(progress, st.duration)) : 0;
        if (!st.busy) st.duration = 0;
      }
      out[key] = st;
    }
    return out;
  }

  /** 在场顾客还原：订单（含 filled 状态）、剩余耐心、体型/配饰/VIP/教学标记 */
  _restoreCustomers(rawList) {
    const out = [];
    if (!Array.isArray(rawList)) return out;
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      if (!Array.isArray(raw.items) || !raw.items.length) continue;
      const items = [];
      let bad = false;
      for (const slot of raw.items) {
        if (!slot || typeof slot !== 'object' || !this._validKey(slot.wants)) { bad = true; break; }
        const accepts = Array.isArray(slot.accepts)
          ? slot.accepts.filter((k) => this._validKey(k))
          : [];
        items.push({
          slot: slot.slot === 'drink' ? 'drink' : 'food',
          wants: slot.wants,
          accepts: accepts.length ? accepts : [slot.wants],
          filled: this._validKey(slot.filled) ? slot.filled : null,
        });
      }
      if (bad) continue;
      // patienceMax 与 patience 分开存：恢复后耐心接着走，而不是从满格重来
      const pMax = Math.max(1, this._num(raw.patienceMax, this.cfg.customer.basePatienceMs));
      const pNow = Math.max(1, Math.min(this._num(raw.patience, pMax), pMax));
      out.push({
        id: typeof raw.id === 'string' && raw.id ? raw.id : 'c' + (this._uid++),
        vip: !!raw.vip,
        items,
        tutorial: !!raw.tutorial,
        patienceMax: pMax,
        patience: pNow,
        body: this._clampInt(raw.body, 0, 0, 5),
        acc: this._clampInt(raw.acc, 0, 0, 5),
        bornAt: this._num(raw.bornAt, 0),
      });
    }
    return out;
  }

  startDay(d) {
    const s = this.s;
    s.day = d;
    s.phase = 'day';
    s.paused = false; // 跨日/跨周不再继承暂停态（L10）
    s.time = 0; // 当日时钟从 0 起算（外卖 phoneAt/riderAt 是当日 0ms 基准，S1）
    s.customers = [];
    s.spawned = 0;
    s.endTimer = 0;
    s.combo = 0;
    s.trashCd = 0;
    s.dayStats = this.blankDayStats();
    const pace = this.pace;
    s.dayDuration = pace.dayDurationMs || (pace.spawnIntervalMs * pace.customersPerDay);
    s.dayTimeLeft = s.dayDuration;
    // 天气先定：当日顾客数 = 基准 / 天气客流倍率（雨天雪天人少，热浪天人多）
    this.ensureWeekWeather();
    s.weather = s.weekWeather[d - 1] || 'sunny';
    const w = this.weatherCfg();
    s.perDay = Math.max(1, Math.round(pace.customersPerDay / (w.spawnMul || 1)));
    // 到店间隔由单日时长推导：保证所有顾客能在营业时间内出现
    s.spawnInterval = Math.max(
      pace.minSpawnIntervalMs || 6000,
      Math.round(s.dayDuration / Math.max(1, s.perDay)),
    );
    s.rng = this.ctx.mulberry32(this.ctx.hash(`${s.mode}|${s.week}|${s.day}|owk`));
    s.menu = this.buildMenu();
    s.deliveries = this.rollDeliveries();
    s.spawnTimer = 0;
    if (s.tutorial.active) {
      this.spawnCustomer(true);
      s.spawned += 1;
    }
    this.emit('change');
  }

  /** 本周 7 天的天气排布（确定性：同 mode/week 必得同一串） */
  ensureWeekWeather() {
    const s = this.s;
    const wc = this.cfg.weather;
    if (!wc || !wc.enabled) { s.weekWeather = null; return null; }
    if (Array.isArray(s.weekWeather) && s.weekWeather.length === 7 && s.weekWeatherWeek === s.week) return s.weekWeather;
    const ids = Object.keys(wc.types);
    const harsh = wc.schedule.harsh || [];
    const safePool = (wc.schedule.lastDaySafePool || ['sunny']).filter((x) => wc.types[x]);
    const rnd = this.ctx.mulberry32(this.ctx.hash(`${s.mode}|${s.week}|weather`));
    const plan = [];
    let harshLeft = wc.schedule.maxHarshPerWeek != null ? wc.schedule.maxHarshPerWeek : 0;
    for (let d = 1; d <= 7; d++) {
      if (d === 1) { plan.push(wc.schedule.firstDayOfWeek || 'sunny'); continue; }
      if (d === 7) { plan.push(safePool[Math.floor(rnd() * safePool.length)] || 'sunny'); continue; }
      const pool = harshLeft > 0 ? ids : ids.filter((x) => !harsh.includes(x));
      const pick = pool[Math.floor(rnd() * pool.length)] || 'sunny';
      if (harsh.includes(pick)) harshLeft -= 1;
      plan.push(pick);
    }
    s.weekWeather = plan;
    s.weekWeatherWeek = s.week;
    return plan;
  }

  /** 当前天气的配置块（缺省回落到晴天） */
  weatherCfg() {
    const wc = this.cfg.weather;
    const id = (this.s && this.s.weather) || 'sunny';
    const t = wc && wc.types && wc.types[id];
    return t || { spawnMul: 1, cold: 1, hot: 1, drinkPriceMul: 1, nameKey: 'weather.sunny', tone: 'warm' };
  }

  /** 饮品冷热归类（未列出的按中性处理） */
  tempOfDrink(id) {
    const wc = this.cfg.weather;
    if (!wc) return 'neutral';
    if ((wc.coldDrinks || []).includes(id)) return 'cold';
    if ((wc.hotDrinks || []).includes(id)) return 'hot';
    return 'neutral';
  }

  /**
   * 当前天气对某个商品的**下单权重倍率**（F4）
   *
   * orderWeights 的键有两种写法，可自由组合扩展：
   * - 具体商品 id（如 'salad': 1.2）—— 精确到某一道菜
   * - 温度类别 'cold' / 'hot' —— 按饮品冷热归类（如热天 cold: 1.2 即冷饮下单权重 +20%）
   *
   * 全局表 config.weather.orderWeights 与当日天气表 config.weather.types[今天].orderWeights
   * 相乘生效，便于「某类天气通用规则 + 某天特例」叠加。
   */
  orderWeightOf(id) {
    const wc = this.cfg.weather;
    if (!wc) return 1;
    const temp = this.tempOfDrink(id);
    const tables = [wc.orderWeights || {}, (this.weatherCfg() || {}).orderWeights || {}];
    let mul = 1;
    for (const tbl of tables) {
      if (!tbl) continue;
      if (tbl[id] != null) mul *= tbl[id];
      if (temp === 'cold' && tbl.cold != null) mul *= tbl.cold;
      if (temp === 'hot' && tbl.hot != null) mul *= tbl.hot;
    }
    return mul;
  }

  /**
   * 按权重抽取一个元素（只消耗一次随机数，与原均匀抽样保持同样的随机流长度）
   * 权重全为 1 时退化为等概率抽取。
   */
  pickByWeight(list, rnd, weightOf) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    const weights = list.map((x) => Math.max(0, weightOf(x)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return list[Math.floor(rnd() * list.length)];
    let r = rnd() * total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** 按天气的冷热偏好加权抽饮品（主推饮品略高，但不绝对） */
  pickDrink(list, main, rnd) {
    if (!list || !list.length) return main;
    const w = this.weatherCfg();
    const weightOf = (id) => {
      const t = this.tempOfDrink(id);
      const base = id === main ? 1.6 : 1;
      const bias = t === 'cold' ? (w.cold || 1) : t === 'hot' ? (w.hot || 1) : 1;
      return base * bias;
    };
    const total = list.reduce((a, id) => a + weightOf(id), 0);
    let r = rnd() * total;
    for (const id of list) {
      r -= weightOf(id);
      if (r <= 0) return id;
    }
    return list[list.length - 1];
  }

  /** 当日菜单（确定性；用于配方高亮与食材置灰） */
  buildMenu() {
    const s = this.s;
    const rnd = s.rng;
    const hard = s.mode === 'hard';
    const main = hard ? 'signatureBurger' : 'burger';
    const foodPool = (hard ? ['fries', 'salad', 'pizza', 'signatureBurger'] : ['fries', 'salad', 'pizza', 'burger'])
      .filter((x) => x !== main);
    const drinkPool = ((this.cfg.meta.dayLoop && this.cfg.meta.dayLoop.drinkPool) || ['coffee', 'milkshake', 'icedTea'])
      .filter((id) => this.byId.has(id));
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const foods = [main, ...shuffle(foodPool).slice(0, 2)];
    const drinks = ['cola', ...shuffle(drinkPool).slice(0, 2)];
    return { foods, drinks, main, mainDrink: 'cola' };
  }

  /**
   * 当日菜单涉及的叶食材集合
   * 注意：困难模式下 icedCola 是**按顾客临时抽的**（colaIceChance），不在 menu.drinks 里，
   * 因此必须把 ice 手动并入，否则「冰」键会被置灰而它其实是刚需（M20）。
   */
  menuLeaves() {
    const set = new Set();
    const visit = (id, depth = 0) => {
      if (depth > 6) return;
      const r = this.byId.get(id);
      if (!r) { if (this.cfg.ingredients[id] != null) set.add(id); return; }
      // 配方表已无 modes 字段（加冰开关 v1.4 起移除），多分支机制废弃，只按下标 inputs 展开
      for (const k of r.inputs || []) visit(k, depth + 1);
    };
    if (!this.s || !this.s.menu) return set;
    for (const id of [...this.s.menu.foods, ...this.s.menu.drinks]) visit(id);
    const drinks = this.s.menu.drinks || [];
    if (this.s.mode === 'hard' && drinks.includes('cola') && (this.diffCfg.colaIceChance || 0) > 0) {
      set.add('ice');
    }
    return set;
  }

  // ---------------------------------------------------------------- customers
  orderSlot(slot, id) {
    const accepts = [id];
    const eq = (this.crafts.equivalenceClasses || []).find((e) => e.order === id);
    if (eq) accepts.push(...eq.accepts);
    return { slot, wants: id, accepts: Array.from(new Set(accepts)), filled: null };
  }

  /**
   * 生成一位顾客
   * @param {boolean} [tutorial=false] 是否教学顾客（耐心冻结、不计入当日客流）
   * @param {string[]|null} [forceItems=null] 教学专用：指定订单餐点（默认 `['burger']`）。
   *   教学单**必须可预测**——引导文案写的是「面包 → 肉饼 → 拖给顾客」，
   *   若让随机抽单逻辑覆盖，玩家会拿到一份文案对不上的订单（TUT-KNOWN-1）。
   * @returns {object} 顾客对象
   */
  spawnCustomer(tutorial = false, forceItems = null) {
    const s = this.s;
    const rnd = s.rng;
    const dc = this.diffCfg;
    const vip = !tutorial && rnd() < this.cfg.customer.vip.chance;
    let food, drink;
    if (tutorial) {
      food = 'burger';
      drink = 'cola';
    } else {
      food = this.pickWeighted(s.menu.foods, s.menu.main, rnd);
      drink = this.pickDrink(s.menu.drinks, s.menu.mainDrink, rnd);
      if (s.mode === 'hard' && drink === 'cola' && rnd() < dc.colaIceChance) drink = 'icedCola';
    }
    let items;
    if (tutorial) {
      // 教学单走独立分支：按指定餐点直接构造订单槽（复用 orderSlot，等价类/filled 初值一并对齐），
      // 绝不进入下面的随机抽单分支。
      const keys = (Array.isArray(forceItems) && forceItems.length) ? forceItems : ['burger'];
      items = keys.map((key) => {
        const rec = this.byId.get(key);
        return this.orderSlot(rec ? rec.type : 'food', key);
      });
    } else if (vip) {
      items = [this.orderSlot(this.byId.get(food).type, food), this.orderSlot(this.byId.get(food).type, food)];
    } else {
      // 订单可含 1 / 2 / 3 种餐点（25% / 50% / 25%），食物与饮品交替抽取且不重复
      const r = rnd();
      const count = r < 0.25 ? 1 : r < 0.75 ? 2 : 3;
      const used = new Set();
      items = [];
      for (let i = 0; i < count; i++) {
        const wantDrink = i > 0 && i % 2 === 1;
        const list = wantDrink ? s.menu.drinks : s.menu.foods;
        const pool = list.filter((x) => !used.has(x));
        // 天气订单权重：热天冷饮权重 +20% 之类（F4）
        const key = this.pickByWeight(pool.length ? pool : list, rnd, (id) => this.orderWeightOf(id))
          || list[0];
        used.add(key);
        items.push(this.orderSlot(this.byId.get(key).type, key));
      }
    }

    const base = this.cfg.customer.basePatienceMs;
    const mul = dc.patienceMul * this.signMul * (vip ? this.cfg.customer.vip.patienceMul : 1);
    const patience = tutorial ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.round(base * mul));
    const c = {
      id: 'c' + (this._uid++),
      vip, items, tutorial,
      patienceMax: patience,
      patience: patience,
      body: Math.floor(rnd() * 6),
      acc: Math.floor(rnd() * 6),
      bornAt: s.time,
    };
    s.customers.push(c);
    this.emit('change');
    return c;
  }

  pickWeighted(list, main, rnd) {
    if (!list || !list.length) return main;
    if (list.length === 1) return list[0];
    if (rnd() < 0.6) return main;
    const others = list.filter((x) => x !== main);
    if (!others.length) return main;
    return others[Math.floor(rnd() * others.length)];
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    const s = this.s;
    if (!s || s.phase !== 'day' || s.paused) return;
    s.time += dt;
    this.updateDeliveries();
    if (s.ach && s.stations.food.busy && s.stations.drink.busy) s.ach.bothBusyMs += dt;

    // 营业倒计时（教学期不计时，避免新手被时间追着走）
    if (!s.tutorial.active) s.dayTimeLeft = Math.max(0, s.dayTimeLeft - dt);

    // 读条
    for (const key of Object.keys(s.stations)) {
      const st = s.stations[key];
      if (!st.busy) continue;
      st.progress += dt;
      if (st.progress >= st.duration) {
        st.busy = false;
        st.progress = 0;
        if (!st.pendingId) { st.pendingId = null; this.emit('change'); continue; }
        st.output = this.mkItem(st.pendingId);
        st.pendingId = null;
        this.emit('craftDone', { station: key });
        this.emit('change');
      }
    }

    // 耐心
    for (const c of s.customers.slice()) {
      if (c.tutorial) continue;
      c.patience -= dt;
      if (c.patience <= 0) this.loseCustomer(c);
    }

    // 垃圾桶冷却
    if (s.trashCd > 0) s.trashCd = Math.max(0, s.trashCd - dt);

    // 生成
    if (!s.tutorial.active && s.spawned < s.perDay) {
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        if (s.customers.length < this.maxQueue) {
          this.spawnCustomer(false);
          s.spawned += 1;
          s.spawnTimer = s.spawnInterval;
        } else {
          s.spawnTimer = 0;
        }
      }
    }

    // 打烊判定：倒计时归零 → 强制打烊；或全部顾客处理完 → 提前打烊
    if (!s.tutorial.active && s.dayTimeLeft <= 0) { this.closeDay('timeup'); return; }
    const done = !s.tutorial.active && s.spawned >= s.perDay && s.customers.length === 0;
    if (done) {
      s.endTimer += dt;
      // 提前打烊的防抖窗口：业务关键（决定何时打烊），缺失即报错，不再静默用 500
      const debounceMs = this.cfg.crafting && this.cfg.crafting.earlyCloseDebounceMs;
      if (typeof debounceMs !== 'number' || !Number.isFinite(debounceMs) || debounceMs < 0) {
        throw new Error('[OWK] config.crafting.earlyCloseDebounceMs 缺失或非法');
      }
      if (s.endTimer >= debounceMs) this.endDay();
    } else {
      s.endTimer = 0;
    }
  }

  /** 时间到：未处理的顾客离场并计流失，然后进入小结 */
  closeDay(reason) {
    const s = this.s;
    if (s.phase !== 'day') return;
    for (const c of s.customers.slice()) {
      if (c.tutorial) { this.finishTutorial(); continue; }
      s.dayStats.lost += 1;
      if (c.items.some((x) => x.filled)) s.dayStats.voided += 1;
    }
    s.customers = [];
    s.combo = 0;
    this.emit('dayTimeUp', { reason });
    this.endDay();
  }

  endDay() {
    const s = this.s;
    if (s.phase !== 'day') return;
    s.phase = 'dayEnd';
    // 日结并入必须先做：它会回写 dayStats（served/earned/delivery*），
    // 之后再累加进 weekStats，周统计才不会漏掉当天未交付的外卖（M6）
    this.settlePendingDeliveries();
    s.weekStats.served += s.dayStats.served;
    s.weekStats.lost += s.dayStats.lost;
    s.weekStats.waste += s.dayStats.waste;
    s.weekStats.earned += s.dayStats.earned;
    s.weekStats.bonus += s.dayStats.bonus;
    s.weekStats.days += 1;
    // 猫猫币：每营业一天发放一次（局外货币，由启动器持久化）
    const dailyCat = this.catGain('day');
    s.dayStats.catCoins = dailyCat;
    s.catEarned += dailyCat;
    this.emit('catCoin', { amount: dailyCat, reason: 'day', day: s.day });
    const achDay = this.checkAchievements('day', this.achExtra || {});
    if (achDay.length) this.emit('achievement', achDay);
    this.emit('dayEnd', { ...s.dayStats, day: s.day, coins: s.coins });
    this.emit('change');
  }

  nextDay() {
    const s = this.s;
    if (s.phase !== 'dayEnd') return false;
    const maxDay = this.daysPerWeek;
    if (s.day < maxDay) {
      this.startDay(s.day + 1);
      return true;
    }
    return false;
  }

  /** 周结算：残余回收/报废 + 房租 + 破产判定 */
  endWeek() {
    const s = this.s;
    if (s.phase === 'weekEnd' || s.phase === 'bankrupt') return;
    let recycled = 0;
    let discarded = 0;
    const normal = s.mode === 'normal';
    const rate = this.cfg.economy.recycleSellableRateNormal;
    const interRate = this.cfg.economy.recycleIntermediateRateNormal;

    const scan = (item) => {
      const kind = this.kindOf(item.key);
      if (normal) {
        recycled += Math.round(this.priceOf(item.key) * (kind === 'intermediate' ? interRate : rate));
      } else {
        discarded += 1;
      }
    };
    for (const it of s.storage) scan(it);
    for (const st of Object.values(s.stations)) {
      if (st.output) scan(st.output);
      for (const i of st.inputs) if (i) scan(i);
      // 合成中的产物（pendingId）：按半成品口径结算 —— 普通回收率 0（不计钱），困难计 1 件报废。
      // 不扫描它会让「周结算时正在读条的那一份」凭空蒸发（L3）
      if (st.busy && st.pendingId) {
        if (!normal) discarded += 1;
      }
    }
    s.storage = [];
    this._resetStations(s);

    s.coins += recycled;
    const rent = this.rentForWeek(s.week);
    s.coins -= rent;
    s.weekStats.recycled = recycled;
    s.weekStats.discarded = discarded;
    s.weekStats.rent = rent;
    s.lastSettle = { ...s.weekStats, week: s.week, coins: s.coins, rent, recycled, discarded };

    if (s.coins < 0) {
      s.phase = 'bankrupt';
      this.emit('bankrupt', s.lastSettle);
    } else {
      s.phase = 'weekEnd';
      if (normal && s.week === 1) this.hardUnlocked = true;
      // 每周结算固定发放（与流失无关）
      const weeklyCat = this.catGain('week');
      s.weekStats.catCoins = weeklyCat;
      s.lastSettle = { ...s.lastSettle, catCoins: weeklyCat };
      if (weeklyCat) {
        s.catEarned += weeklyCat;
        this.emit('catCoin', { amount: weeklyCat, reason: 'week', week: s.week });
      }
      // 金币奖励猫猫币：每满 25 金币额外奖励 1 枚，**不消耗金币**（F3）
      // 口径取「结算时余额」（扣完房租后的 s.coins），与周结算面板显示的金币一致。
      const bonus = this.grantCoinBonus();
      if (bonus && bonus.amount) {
        s.lastSettle = { ...s.lastSettle, coinBonus: bonus.amount };
      }
      const achWeek = this.checkAchievements('week', this.achExtra || {});
      if (achWeek.length) this.emit('achievement', achWeek);
      this.emit('weekEnd', s.lastSettle);
    }
    this.emit('change');
  }

  rentForWeek(week) {
    const table = this.cfg.economy.rentByWeek;
    const base = table[String(week)] != null ? table[String(week)] : table['3+'];
    const mul = this.cfg.economy.rentMulByDiff[this.s.mode] != null ? this.cfg.economy.rentMulByDiff[this.s.mode] : 1;
    return Math.round(base * mul);
  }

  nextWeek() {
    const s = this.s;
    if (s.phase !== 'weekEnd') return;
    s.week += 1;
    s.weekWeather = null;
    s.weekWeatherWeek = 0;
    s.weekStartCoins = s.coins;
    s.weekStats = this.blankWeekStats();
    // 与 retryWeek() 对齐：清空读条状态，避免「上一周读条中的产物」跨周残留（L3）
    this._resetStations(s);
    this.startDay(1);
  }

  /** 破产软着陆：重开本周，金币回到进入该周时的实际金币，设备保留 */
  retryWeek() {
    const s = this.s;
    s.coins = s.weekStartCoins;
    s.weekWeather = null;
    s.weekWeatherWeek = 0;
    s.storage = [];
    this._resetStations(s);
    s.weekStats = this.blankWeekStats();
    this.startDay(1);
  }

  /** 清空两工位（槽位 / 读条 / 合成中的产物） */
  _resetStations(s) {
    for (const [key, st] of Object.entries(s.stations)) {
      st.inputs = this.blankInputs(key);
      st.output = null;
      st.busy = false;
      st.progress = 0;
      st.duration = 0;
      st.pendingId = null;
    }
  }

  // ---------------------------------------------------------------- stations
  setStation(key) {
    if (!this.s.stations[key]) return;
    this.s.selectedStation = key;
    this.emit('change');
  }

  /**
   * 某食材归属的工位
   * 配方表已无 modes 字段（多分支匹配机制自 v1.4 加冰开关移除后废弃），只按 r.inputs 判定
   */
  stationOfIngredient(key) {
    for (const r of this.crafts.recipes) {
      const list = r.inputs;
      if (list && list.includes(key)) return r.station;
    }
    return null;
  }

  /**
   * v2.9：半成品 / 成品归属的工位（拖拽提示用）。
   * 与 stationOfIngredient 互补：那个只管叶食材，这个只管配方产物。
   */
  stationOfProduct(key) {
    const r = this.crafts.recipes.find((x) => x.id === key);
    return r ? r.station : null;
  }

  /**
   * 投放食材到指定工位
   *
   * v2.9：拖拽改造后，食材键也能被拖到灶台上。这里是拖拽与点击的**共同入口**，
   * 保证两条路径的守卫（金币、busy、输出槽占用、输入格已满）完全一致 ——
   * 如果拖拽另写一套校验，迟早会和 addIngredient 的规则漂移。
   *
   * @param {string} ingKey 食材 id
   * @param {string} [stationKey] 目标工位。省略时按配方归属自动决定（= 旧点击行为）。
   * @param {number} [index] 目标输入格下标。省略时填第一个空格。
   */
  addIngredient(ingKey, stationKey, index) {
    const s = this.s;
    if (!s || s.phase !== 'day') return { ok: false, reason: 'phase' };
    // 拖拽显式指定了工位就尊重它；点击则自动归属
    const target = stationKey || this.stationOfIngredient(ingKey) || s.selectedStation;
    s.selectedStation = target;
    const st = s.stations[target];
    if (!st) return { ok: false, reason: 'phase' };
    if (st.busy) return { ok: false, reason: 'busy' };
    if (st.output) return { ok: false, reason: 'outputOccupied' };

    // v2.9：拖到「不对的灶台」时给出可区分的理由，好让视图弹出
    // 「这是甜品台哦」这类可爱提示，而不是笼统的「合成失败」。
    if (stationKey) {
      const own = this.stationOfIngredient(ingKey);
      if (own && own !== stationKey) return { ok: false, reason: 'wrongStation', want: own, got: stationKey };
    }

    let idx = index;
    if (idx == null || st.inputs[idx]) idx = st.inputs.findIndex((x) => !x);
    if (idx == null || idx < 0) return { ok: false, reason: 'inputsFull' };

    // 即将判定时先校验金币（AC-10）
    const keys = [...st.inputs.filter(Boolean).map((i) => i.key), ingKey];
    if (keys.length === 2) {
      const m = this.ctx.matchCraft(keys);
      const cost = m ? m.cost : keys.reduce((a, k) => a + this.leafCost(k), 0);
      if (s.coins < cost) return { ok: false, reason: 'short', cost };
    }

    st.inputs[idx] = this.mkItem(ingKey);
    this.emit('change');
    if (st.inputs.every(Boolean)) this.combine(target);
    return { ok: true, station: target };
  }

  /**
   * v2.9：判断某物品「能不能」放进某工位，仅用于拖拽时给出前置提示。
   * 返回 null 表示没有明显冲突（真正的合法性仍由addIngredient / moveItem 判定）。
   * @returns {null | { reason:string, want?:string, got?:string }}
   */
  stationMismatch(itemKey, stationKey) {
    if (!stationKey || !itemKey) return null;
    const st = this.s.stations[stationKey];
    if (!st) return null;
    if (st.busy) return { reason: 'busy' };
    if (st.output) return { reason: 'outputOccupied' };
    // 失败品只能进垃圾桶，这条不放宽
    if (itemKey === 'fail') return { reason: 'failOnlyTrash' };
    // 叶食材按配方归属判定
    if (this.leafCost(itemKey) > 0) {
      const own = this.stationOfIngredient(itemKey);
      if (own && own !== stationKey) return { reason: 'wrongStation', want: own, got: stationKey };
      return null;
    }
    // 半成品 / 成品：看它自己（及其下一环）属于哪个工位
    const own = this.stationOfProduct(itemKey);
    if (own && own !== stationKey) return { reason: 'wrongStation', want: own, got: stationKey };
    return null;
  }

  combine(stationKey) {
    const s = this.s;
    const st = s.stations[stationKey];
    const keys = st.inputs.map((i) => i.key);
    const m = this.ctx.matchCraft(keys);
    st.inputs = this.blankInputs(stationKey);

    if (m) {
      s.coins -= m.cost;
      const isInter = this.kindOf(m.recipeId) === 'intermediate';
      const factor = isInter ? this.cfg.crafting.intermediateStepFactor : 1;
      st.busy = true;
      st.progress = 0;
      st.duration = Math.round(this.stoveMs * factor);
      st.pendingId = m.recipeId;
      st.lastMode = m.mode;
      this.emit('combine', { station: stationKey, recipeId: m.recipeId, cost: m.cost });
    } else {
      const cost = keys.reduce((a, k) => a + this.leafCost(k), 0);
      s.coins -= cost;
      st.output = this.mkItem('fail');
      s.combo = 0;
      s.dayStats.waste += 1;
      this.emit('craftFail', { station: stationKey, cost, keys });
      this.emit('change');
    }
  }

  /** 判定前撤回输入（B3）：叶子食材零消耗退回；成品/中间产物回仓储 */
  recallInput(stationKey, index) {
    const s = this.s;
    const st = s.stations[stationKey];
    if (!st || st.busy) return { ok: false, reason: 'busy' };
    const item = st.inputs[index];
    if (!item) return { ok: false, reason: 'empty' };
    const kind = this.kindOf(item.key);
    if (kind === 'leaf') {
      st.inputs[index] = null; // 未扣费，直接退回
    } else {
      // 复用 pushStorage：容量校验与 maxStorage 埋点（ach_storage_4）只在一处维护（L2）
      const r = this.pushStorage(item);
      if (!r.ok) return r;
      st.inputs[index] = null;
    }
    this.emit('change');
    return { ok: true };
  }

  // ---------------------------------------------------------------- items
  itemAt(loc) {
    const s = this.s;
    if (!loc) return null;
    if (loc.zone === 'storage') return s.storage[loc.index] || null;

    if (loc.zone === 'input') return s.stations[loc.station] ? s.stations[loc.station].inputs[loc.index] : null;
    if (loc.zone === 'output') return s.stations[loc.station] ? s.stations[loc.station].output : null;
    return null;
  }

  takeAt(loc) {
    const s = this.s;
    const item = this.itemAt(loc);
    if (!item) return null;
    if (loc.zone === 'storage') s.storage.splice(loc.index, 1);

    else if (loc.zone === 'input') s.stations[loc.station].inputs[loc.index] = null;
    else if (loc.zone === 'output') s.stations[loc.station].output = null;
    return item;
  }

  /** 单一仓库：不分食材 / 半成品 / 成品，按到货顺序占格 */
  pushStorage(item) {
    const s = this.s;
    if (s.storage.length >= this.storageCap) return { ok: false, reason: 'storageFull' };
    s.storage.push(item);
    this.bumpCounter('maxStorage', s.storage.length);
    return { ok: true, to: 'storage' };
  }

  /**
   * 统一移动：src = {zone,station,index}，dst = {zone,station,index,customerId}
   */
  moveItem(src, dst) {
    const s = this.s;
    if (!src || !dst || s.phase !== 'day') return { ok: false, reason: 'phase' };
    const item = this.itemAt(src);
    if (!item) return { ok: false, reason: 'empty' };

    if (dst.zone === 'customer') {
      const c = s.customers.find((x) => x.id === dst.customerId);
      if (!c) return { ok: false, reason: 'gone' };
      const r = this.serve(item, c);
      if (r.ok) this.takeAt(src);
      return r;
    }

    if (dst.zone === 'delivery') {
      const d = this.deliveryById(dst.deliveryId);
      if (!d || d.item !== item.key) return { ok: false, reason: 'wrong' };
      const r = this.pickupDelivery(dst.deliveryId);
      if (r.ok) this.takeAt(src);
      return r;
    }

    if (dst.zone === 'trash') {
      if (item.key !== 'fail' && s.trashCd > 0) return { ok: false, reason: 'cooldown' };
      this.takeAt(src);
      if (item.key !== 'fail') s.trashCd = this.trashCdMs;
      this.bumpCounter('trash', 1);
      this.emit('trash', { item, bypass: item.key === 'fail' });
      this.emit('change');
      return { ok: true };
    }

    if (dst.zone === 'storage' || dst.zone === 'buffer') {
      if (item.key === 'fail') return { ok: false, reason: 'failOnlyTrash' };
      // 仓储内部挪位：源与目标同区，净数量不变，不该被容量校验挡住（L1）
      const inPlace = src.zone === 'storage' && dst.zone === 'storage';
      if (!inPlace && s.storage.length >= this.storageCap) return { ok: false, reason: 'storageFull' };
      this.takeAt(src);
      const r = this.pushStorage(item);
      this.emit('change');
      return r;
    }

    if (dst.zone === 'input') {
      if (item.key === 'fail') return { ok: false, reason: 'failOnlyTrash' };
      const st = s.stations[dst.station];
      if (!st) return { ok: false, reason: 'phase' };
      if (st.busy) return { ok: false, reason: 'busy' };
      // v2.12：允许「本台输出槽 → 本台输入槽」直接拖回（半成品续做）。
      //
      // 原守卫 `if (st.output)` 的本意是拦住「输出槽还有成品时又投新料，读条完会静默覆盖成品」（M1）。
      // 但它把「把输出槽里那件东西本身挪回输入槽」也一并拦了 —— 输出槽里躺着的正是被拖的这件，
      // 于是永远返回 outputOccupied。这正是右侧「↓」按钮存在的原因：quickReload 绕过了这个守卫。
      //
      // 现在按钮已删除，必须在这里放行同台回流。安全性不变：下面 takeAt(src) 会先把输出槽
      // 清空，再写进输入格，不存在任何覆盖。
      const ownOutput = src.zone === 'output' && src.station === dst.station;
      if (st.output && !ownOutput) return { ok: false, reason: 'outputOccupied' };
      let idx = dst.index;
      if (idx == null || st.inputs[idx]) idx = st.inputs.findIndex((x) => !x);
      if (idx == null || idx < 0) return { ok: false, reason: 'inputsFull' };
      // 与源为同一格则忽略
      if (src.zone === 'input' && src.station === dst.station && src.index === idx) return { ok: false, reason: 'same' };
      // 放入后若两格都满 → 预校验金币
      const other = st.inputs.find((x, i) => x && i !== idx);
      if (other) {
        const keys = [other.key, item.key];
        const m = this.ctx.matchCraft(keys);
        const cost = m ? m.cost : keys.reduce((a, k) => a + this.leafCost(k), 0);
        if (s.coins < cost) return { ok: false, reason: 'short', cost };
      }
      this.takeAt(src);
      st.inputs[idx] = item;
      this.emit('change');
      if (st.inputs.every(Boolean)) this.combine(dst.station);
      return { ok: true };
    }

    return { ok: false, reason: 'badTarget' };
  }

  // ---------------------------------------------------------------- serving
  serve(item, customer) {
    const s = this.s;
    const rec = this.byId.get(item.key);
    if (!rec || !rec.type || rec.type === 'intermediate') return { ok: false, reason: 'wrong' };
    const slot = customer.items.find((x) => !x.filled && x.slot === rec.type && x.accepts.includes(item.key));
    if (!slot) return { ok: false, reason: 'wrong' };
    slot.filled = item.key;
    s.dayStats.delivered = (s.dayStats.delivered || 0) + 1;
    const complete = customer.items.every((x) => x.filled);
    if (complete) this.settle(customer);
    else this.emit('change');
    return { ok: true, complete };
  }

  settle(customer) {
    const s = this.s;
    const vipCfg = this.cfg.customer.vip || {};
    const vipMul = customer.vip
      ? (this.cfg.pricing && this.cfg.pricing.vipPriceMul != null ? this.cfg.pricing.vipPriceMul : (vipCfg.priceMul || 1))
      : 1;
    const drinkMul = this.weatherCfg().drinkPriceMul || 1;
    const base = customer.items.reduce((a, sl) => {
      const p = this.priceOf(sl.filled);
      const rec = this.byId.get(sl.filled);
      return a + (rec && rec.type === 'drink' ? p * drinkMul : p);
    }, 0) * vipMul;
    const ratio = Math.max(0, Math.min(1, customer.patience / customer.patienceMax));
    const earned = Math.round(base * this.counterMul * (1 + this.cfg.pricing.tipFactor * ratio));
    s.combo += 1;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    // E11：每单额外 +min(连击数, cap)
    const comboBonus = Math.min(s.combo, this.cfg.combo.cap);
    s.coins += earned + comboBonus;
    s.dayStats.served += 1;
    s.dayStats.income += earned;
    s.dayStats.earned += earned;
    s.dayStats.bonus += comboBonus;
    s.customers = s.customers.filter((c) => c.id !== customer.id);
    this.bumpCounter('orders', 1);
    this.bumpCounter('revenue', earned + comboBonus);
    this.bumpCounter('serveTime', s.time);
    if (customer.vip) this.bumpCounter('vip', 1);
    // 大单白名单来自 config.pricing.bigOrderItems（新增高价菜品不再需要改代码）
    // 与 deliverySettleMs 同一策略：业务关键配置缺了就显式报错，不要静默失效
    const bigItems = this.cfg.pricing && this.cfg.pricing.bigOrderItems;
    if (!Array.isArray(bigItems)) throw new Error('[OWK] config.pricing.bigOrderItems 缺失或非法');
    if (customer.items.some((it) => bigItems.includes(it.filled))) this.bumpCounter('bigOrder', 1);
    this.emit('served', { customer, earned, bonus: comboBonus, ratio, combo: s.combo, base, vipMul });
    this.emit('change');
  }

  loseCustomer(c) {
    const s = this.s;
    if (c.tutorial) { this.finishTutorial(); return; }
    s.customers = s.customers.filter((x) => x.id !== c.id);
    s.dayStats.lost += 1;
    s.combo = 0;
    if (c.items.some((x) => x.filled)) s.dayStats.voided += 1;
    this.emit('lost', { customer: c });
    this.emit('change');
  }

  dismiss(customerId) {
    const s = this.s;
    const c = s.customers.find((x) => x.id === customerId);
    if (!c) return;
    if (c.tutorial) { this.finishTutorial(); return; }
    s.customers = s.customers.filter((x) => x.id !== customerId);
    s.dayStats.lost += 1;
    s.combo = 0;
    this.emit('lost', { customer: c, dismissed: true });
    this.emit('change');
  }

  // ---------------------------------------------------------------- upgrades
  deviceInfo(key) {
    const s = this.s;
    const lv = s.devices[key];
    if (key === 'trash') {
      const lvls = this.cfg.trash.levels;
      const max = lvls.length;
      if (lv >= max) return { key, lv, max, maxed: true, cost: 0, refund: 0, next: null };
      return {
        key, lv, max, maxed: false,
        cost: lvls[lv].upgradeCost,
        refund: Math.floor(lvls.slice(0, lv).reduce((a, x) => a + (x.upgradeCost || 0), 0) * this.cfg.devices.refund.rate),
        next: lvls[lv].cooldownMs,
        cur: lvls[lv - 1].cooldownMs,
      };
    }
    const dev = this.cfg.devices[key];
    const max = dev.levels;
    if (lv >= max) return { key, lv, max, maxed: true, cost: 0, refund: 0, next: null };
    return {
      key, lv, max, maxed: false,
      cost: dev.upgradeCost[lv - 1],
      refund: Math.floor(dev.upgradeCost.slice(0, lv - 1).reduce((a, x) => a + x, 0) * this.cfg.devices.refund.rate),
      next: dev.values[lv],
      cur: dev.values[lv - 1],
    };
  }

  upgrade(key) {
    const s = this.s;
    const info = this.deviceInfo(key);
    if (info.maxed) return { ok: false, reason: 'max' };
    if (s.coins < info.cost) return { ok: false, reason: 'coins', cost: info.cost };
    s.coins += info.refund - info.cost;
    s.devices[key] = info.lv + 1;
    this.emit('upgraded', { key, lv: info.lv + 1, cost: info.cost, refund: info.refund });
    this.emit('change');
    return { ok: true, lv: info.lv + 1, cost: info.cost, refund: info.refund };
  }

  // ---------------------------------------------------------------- misc
  togglePause() {
    this.s.paused = !this.s.paused;
    this.emit(this.s.paused ? 'pause' : 'resume');
    this.emit('change');
    return this.s.paused;
  }

  /** 教学结束时，把教学顾客还原为普通顾客（否则耐心不会走，当日无法打烊） */
  releaseTutorialCustomers() {
    const s = this.s;
    if (!s) return;
    const p = Math.max(1, Math.round(this.cfg.customer.basePatienceMs * this.diffCfg.patienceMul * this.signMul));
    for (const c of s.customers) {
      if (!c.tutorial) continue;
      c.tutorial = false;
      c.patienceMax = p;
      c.patience = p;
    }
  }

  skipTutorial() {
    this.s.tutorial = { active: false, step: 0 };
    this.tutorialDone = true;
    this.releaseTutorialCustomers();
    this.emit('change');
    return this;
  }

  /**
   * 教学推进用：确保场上有一位「只要指定餐点」的教学顾客（幂等）
   * 用于第 2 步（可乐）：玩家交完汉堡后第 1 位顾客会离场，若教学期不生成新顾客，
   * `serveCola` 就没有可交付对象，引导链会断在这里（TUT-KNOWN-2）。
   * @param {string} itemKey 需要的餐点 id
   * @returns {object|null} 新建的顾客；已存在或教学未开启时返回 null
   */
  ensureTutorialCustomer(itemKey) {
    const s = this.s;
    if (!s || !s.tutorial.active) return null;
    const has = s.customers.some((c) => c.tutorial && c.items.some((i) => i.wants === itemKey));
    if (has) return null;
    return this.spawnCustomer(true, [itemKey]);
  }

  tutorialAdvance(step) {
    const s = this.s;
    if (!s.tutorial.active) return;
    s.tutorial.step = step;
    this.emit('change');
  }

  finishTutorial() {
    const s = this.s;
    if (!s.tutorial.active) return;
    s.tutorial = { active: false, step: 0 };
    this.tutorialDone = true;
    // 兜底：若还有未处理的教学顾客，放回普通耐心，避免「耐心永不走」把当日打烊卡死
    this.releaseTutorialCustomers();
    this.emit('change');
  }

  /**
   * 生成存档快照（与 resume() 严格对称）
   * 内容：模式/周/日、金币、设备、硬解锁与教学标记、天气排布、
   * 主仓储、两工位的输入/输出/读条/合成中产物、在场顾客（剩余耐心 + 订单 + filled 状态）、
   * 本局成就计数器（跨局累计值由启动器单独落盘）。
   */
  snapshot() {
    const s = this.s;
    if (!s) return null;
    const stations = {};
    for (const [key, st] of Object.entries(s.stations)) {
      stations[key] = {
        inputs: st.inputs.map((it) => (it ? { uid: it.uid, key: it.key } : null)),
        output: st.output ? { uid: st.output.uid, key: st.output.key } : null,
        busy: !!st.busy,
        progress: this._num(st.progress, 0),
        duration: this._num(st.duration, 0),
        pendingId: st.pendingId || null,
      };
    }
    return {
      v: 2, // 快照版本：v1 = 只有 mode/week/day/coins/devices；v2 起含仓储/工位/顾客
      mode: s.mode, week: s.week, day: s.day,
      coins: s.coins, weekStartCoins: s.weekStartCoins,
      catEarned: s.catEarned,
      devices: { ...s.devices },
      hardUnlocked: this.hardUnlocked,
      tutorialDone: this.tutorialDone,
      tutorial: { active: !!(s.tutorial && s.tutorial.active), step: (s.tutorial && s.tutorial.step) || 0 },
      weather: s.weather,
      weekWeather: Array.isArray(s.weekWeather) ? s.weekWeather.slice() : null,
      weekWeatherWeek: s.weekWeatherWeek || 0,
      storage: s.storage.map((it) => ({ uid: it.uid, key: it.key })),
      stations,
      customers: s.customers.map((c) => ({
        id: c.id,
        vip: !!c.vip,
        tutorial: !!c.tutorial,
        items: c.items.map((sl) => ({
          slot: sl.slot, wants: sl.wants, accepts: sl.accepts.slice(), filled: sl.filled || null,
        })),
        patienceMax: c.patienceMax,
        patience: c.patience,
        body: c.body,
        acc: c.acc,
        bornAt: c.bornAt,
      })),
      ach: {
        orders: s.ach.orders, revenue: s.ach.revenue, vip: s.ach.vip,
        trash: s.ach.trash, bigOrders: s.ach.bigOrders,
        bothBusyMs: s.ach.bothBusyMs, maxStorage: s.ach.maxStorage,
        deliveries: s.ach.deliveries, crossDay: s.ach.crossDay,
        serveTimes: s.ach.serveTimes.slice(),
      },
      uid: this._uid,
      savedAt: Date.now(),
    };
  }
}
