# 食合物语｜Merge Food Story — 项目技术文档

> 版本基线：v2.20.1（sw v40）　｜　断言 **944 条**（Node 944 ＝ 引擎 524 + 修复回归 420）　｜　纯前端 · 零运行时依赖 · PWA
>
> **断言口径（全文统一，勿混用）**
> - 「**引擎断言**」= `tools/test-engine.mjs` 的单条断言数（每个 `ok()/eq()` 计 1），当前 **524**；由脚本末尾 `结果：N 通过` 打印。
> - 「**修复回归**」= `tools/verify-fixes.mjs` 的单条断言数，当前 **420**；与引擎断言分列，不并入「引擎断言」。
> - 「**浏览器巡检**」= 本地那批 Playwright 巡检脚本（visual / interact / day / flow / hard / pwa / leaf / v28 / v29）的合计。
>   **这些脚本不随仓库发布**（硬编码本机 playwright 路径，发布版 package.json 里也没有 `test:browser` 入口），
>   所以本文不给它们写死条数 —— 需要时在本地跑 `npm run test:browser`，以实际 `结果：N 通过` 为准。
> - 「**合计**」= 524 + 420 = **944**，全部是 Node 侧、零依赖、可在任何机器上原样复现（`npm test`）。
> - 改完代码请以实际输出为准，不要手抄本文档。

本文档基于当前仓库代码实际状态编写，描述游戏的玩法结构、模块划分、系统实现、接口契约与运行方式。数值以 `owk_handoff_*.json` 为准，本文只列关键项。

---

## 目录

1. [游戏概述](#1-游戏概述)
2. [核心玩法循环](#2-核心玩法循环)
3. [项目结构与模块职责](#3-项目结构与模块职责)
4. [主要系统实现](#4-主要系统实现)
5. [核心类与关键接口清单](#5-核心类与关键接口清单)
6. [配置与资源说明](#6-配置与资源说明)
7. [游戏流程与状态流转](#7-游戏流程与状态流转)
8. [运行与构建方式](#8-运行与构建方式)
9. [已知限制与可扩展方向](#9-已知限制与可扩展方向)

---

## 1. 游戏概述

### 1.1 定位

一款**休闲经营 + 手操烹饪**的网页小游戏。玩家经营一间「食合物语」：每天开门营业接待火柴人顾客，靠三个合成台（食物台 / 饮品台 / 通用台）合成食物与饮品、拖拽交付赚取金币，用金币升级设备、熬过每周房租，同时靠**猫猫币**给店里的猫换皮肤与小店风格。

- **平台**：桌面 / Android / iOS 浏览器，横屏游玩
- **形态**：单页应用 + 可安装 PWA（Service Worker 全量缓存，**断网可玩**）
- **技术栈**：原生 ES Modules + 内联 SVG，**无任何运行时第三方依赖**
- **美术**：全部为代码绘制的简笔画 / 卡通 SVG（描边 + 平涂，无位图、无渐变、无粒子）

### 1.2 一句话玩法

> 顾客头顶气泡＝订单；点食材凑齐配方 → 拖给顾客 → 收钱；经营之外还要养猫、换皮肤、扛房租。

### 1.3 关键内容规模

| 内容 | 数量 | 位置 |
|---|---|---|
| 基础食材 | 14 种 | `owk_handoff_config.json` → `ingredients` |
| 配方（可产出物品） | 18 条 | `owk_handoff_crafts.json` → `recipes` |
| 工位 | 2（食物台 / 饮品甜品台） | `config.stations` |
| 顾客订单形态 | 1 / 2 / 3 种餐点 | `engine.spawnCustomer` |
| 天气 | 7 种 | `config.weather.types` |
| 猫皮肤（= 小店主题） | 8 款 | `config.catSkins.skins` |
| 成就 | 34 个 | `config.achievements.list` |
| 音效 | 14 个已接线 + 2 个保留未接线 + 2 段 BGM + 雨声 | `src/audio.js` |

---

## 2. 核心玩法循环

### 2.1 单日循环（90 秒）

```
开门 → 顾客陆续到店（气泡显示订单）→ 玩家投料合成 → 拖给顾客 → 结算收款
     → 耐心耗尽则流失 → 倒计时归零打烊 → 日结算（房租前攒钱 + 猫币）→ 次日
```

1. **订单**：顾客气泡列出 1~3 种餐点（食物/饮品混合，25% / 50% / 25% 概率分布；VIP 固定两份同种）。
2. **制作**：**点食材选中它 → 再点合成台**（食物台 / 甜品台 / 通用台任选）落料；**双击食材键**则是快捷方式，直接投到它配方归属的专业台；也可以把食材**直接拖到**任意合成台。三条路径并存，走同一个引擎入口。两个输入槽满即**自动合成**（无序匹配，糖浆+水 ≡ 水+糖浆）。
3. **交付**：成品在输出槽，**拖到顾客身上**（或点成品再点顾客）。交付后该条目在气泡上**打绿勾**。
4. **收款**：`标价 × 收银台倍率 × (1 + 0.3 × 剩余耐心比) + min(连击数, 2)`。
5. **打烊**：90 秒倒计时归零，未处理顾客计流失。

### 2.2 单周循环（7 天）

```
第 1 天 … 第 7 天 → 周结算（扣房租）→ 下一周（周数↑、房租↑）→ 房租不足则本局直接结束
```

- 房租：第 1/2/3+ 周分别 **400 / 700 / 950**（`economy.rentMulByDiff` 普通 ×1.0、困难 **×1.2** → 480 / 840 / 1140；困难另有耐心 ×0.85、队列 4、顾客 11 单、招牌汉堡强制生菜）
- 顾客数随周数增长：`perDay = 基准(受天气) + (周数−1) × economy.customersPerWeekGrowth(2)`，夹到 `customersPerDayCap(14)`。第 1 周 9 人，第 2 周 11，第 3 周起 13~14
- 周末清空仓库：普通模式残余按 **25%** 回收，困难模式直接报废
- 房租不足 = **本局结束**：弹清算面板（房租 / 缺口 / 本周成交）→ 回主页。金币与设备等级在下一局全部归零，猫猫币与成就保留（局外存档）。**没有「重开本周」**

### 2.3 长线循环

```
日结 +10 猫币  →  周结必定 +30 猫币  →  成就再发猫币
     →  猫币换猫皮肤（100~200）→  皮肤同时切换整间小店的主题风格
```

**皮肤即主题**：8 款猫皮肤各自绑定一整套小店视觉（背景 / 面板 / 主色 / 描边 / 字体色 / 背景纹理 / 食材键帽），买一款皮肤＝同时解锁该风格。

---

## 3. 项目结构与模块职责

```
merge-food-story/           # 仓库根目录
├── handoff/                     # 开发源目录（权威副本）
│   ├── index.html               # 单页入口：舞台骨架 + 弹层挂载点
│   ├── sw.js                    # Service Worker：预缓存全部资源，离线可启动
│   ├── server.mjs               # 零依赖静态服务器（本地开发用）
│   ├── package.json             # npm scripts：dev / start / test
│   ├── src/
│   │   ├── main.js              # 启动装配层：接线引擎↔视图↔存档↔音频
│   │   ├── engine.js            # 纯逻辑引擎（无 DOM，可在 Node 直测）
│   │   ├── view.js              # 渲染 / 交互 / 面板 / 弹层
│   │   ├── art.js               # 内联 SVG 素材（顾客、猫、骑手、物品、天气图标）
│   │   ├── audio.js             # WebAudio 音频管理器（合成音效 + BGM + 雨声）
│   │   ├── config.js            # 配置装载 + 合成表 / 价格 / 成本 / i18n / RNG
│   │   └── style.css            # 全部界面样式（横版舞台 + 主题变量）
│   ├── owk_handoff_*.json       # 权威数值：config / crafts / i18n / layout
│   ├── tools/                   # 自动化测试与截图脚本（test-engine / verify-fixes / 7 个巡检脚本）
│   ├── pwa/                     # manifest + 应用图标
│   ├── reference/               # 需求与评审文档
│   └── PROGRESS.md              # 逐版本变更与验收记录
├── owk-github/                  # 发布目录（由 deploy-github.mjs 从 handoff 同步）
└── deploy-github.mjs            # 发布脚本（同步 + 标准 git 提交 + git push）
```

### 3.1 分层原则

| 层 | 文件 | 依赖 | 可否脱离浏览器 |
|---|---|---|---|
| 数据 | `owk_handoff_*.json` | 无 | ✅ |
| 逻辑 | `engine.js` + `config.js` | 仅数据 | ✅ 可在 Node 直接跑 |
| 表现 | `view.js` + `art.js` + `style.css` | 逻辑层 | ❌ |
| 装配 | `main.js` | 全部 | ❌ |
| 音频 | `audio.js` | 独立 | 需要 AudioContext |

> **引擎与视图严格分离**是本项目的核心约束：所有数值与状态变化只发生在 `engine.js`，`view.js` 只读状态并渲染。这使得 300+ 条机制断言可以在 Node 里无头运行（`npm test`）。

---

## 4. 主要系统实现

### 4.1 合成与三个合成台

- **匹配规则**：`config.js` 的 `matchCraft(keys)` 把两个输入键排序后查合成表，得到 `{ out, cost, mode }`（`mode` 恒为 `'base'`）。**同配方多分支（`modes`）机制自 v1.4 起废弃**：加冰不再是开关，而是普通配方 `cola + ice → icedCola`；`crafts.json` 里已无任何 `modes` 字段，`config.js` / `engine.js` / `view.js` 三处的兼容分支均已删除。
- **工位**：`food`（食物台）与 `drink`（饮品甜品台），各 2 输入 + 1 输出，**互不占用**、可并行读条。
- **中间产物**：菜肉饼、饼底等读条时间 ×0.65（`crafting.intermediateStepFactor`）。
- **失败品**：不匹配的组合产出「失败品」，丢进垃圾桶，计一次浪费。**丢弃没有冷却**；垃圾桶升级只提高「按物品成本返还」的比例（Lv1 0% / Lv2 20% / Lv3 40% / Lv4 60%），失败品成本为 0 不返还。
- **撤回**：输出槽占用时输入槽可撤回（`recallInput`），已扣费的退回仓库，未扣费的直接消失。

关键文件：`src/engine.js`（`addIngredient` / `combine` / `quickReload` / `recallInput`）、`src/config.js`（`matchCraft`）。

### 4.2 顾客与订单

- 顾客由 `spawnCustomer()` 生成：**体型 × 配饰**（各 6 种）、VIP 标记、耐心值。
- 订单条目 `orderSlot(slot, id)` 记录：槽位（food/drink）、需求键、**等价类**（如 `cola` 与 `icedCola` 互认）、`filled` 状态。
- 耐心：`basePatienceMs × 难度倍率 × 招牌倍率 × VIP 倍率`，归零即流失。
- **气泡对勾**：交付后该条目图标淡化 + 绿框 + 右下角 ✓，未交付保持原样，一眼看出还差什么。

### 4.3 仓库（单一 5 格）

- 普通 / 困难**统一 5 格**（`storage.capByDiff`），唯一权威；`difficulty.*.storageCap`（旧口径 6/8）**已删除**，UI 与提示文案统一写「仓储 5 格」。
- 备料缓冲（`bufferRow`）已下线：`layout.json` 中该 region 保留但标记 `_deprecated: true`，机制与 i18n 键均已移除。
- **任何物品都能放**：食材、半成品、成品混放，按到货顺序占位，满格返回 `storageFull`。
- **整张仓库卡都是投放区**（v2.19）：`data-drop="storage"` 挂在 `.store` 上，拖到「仓库 / 1/5」标签行或卡片空白处同样入仓；
  落点仍是「第一个空格」，与拖到具体格位等价。
- **卡片无外框**（v2.19）：去掉 `.store` 的描边与白底，只留标签、5 个格位、一键提交 —— 避免「卡片框 + 格位框」两层框叠在一起。
- 周日清空：普通模式按售价 25% 回收，半成品回收 0，困难模式直接报废。

### 4.4 天气系统

每天一种天气，**只影响四个旋钮**，不动耐心与制作耗时（避免难度失控）：

| 天气 | 当日顾客 | 冷 : 热饮偏好 | 饮品售价 | 订单权重 | 视觉 |
|---|---|---|---|---|---|
| 晴 `sunny` | 9 | 2 : 1 | +2% | 冷饮 ×1.10 | 暖金斜光 |
| 多云 `cloudy` | 9 | 1 : 1 | — | — | 柔灰云影 |
| 雨 `rain` | 7 | 1 : 2 | — | 热饮 ×1.15 | 斜雨线 + 冷蓝底 |
| 雪 `snow` | 6 | 1 : 3 | +3% | 热饮 ×1.20 / 冷饮 ×0.90 | 飘雪点 + 冷白底 |
| 雾 `fog` | 8 | 1 : 1.5 | +1% | 热饮 ×1.10 | 横向雾带 |
| 热浪 `heat` | 10 | 3 : 1 | +4% | **冷饮 ×1.20** | 橙底 + 波浪线 |
| 沙尘 `sand` | 7 | 1 : 2 | +2% | 热饮 ×1.15 | 昏黄风沙线 |

**排布规则**（`ensureWeekWeather`，确定性 RNG）：
- 第 1 天固定「晴」（新手友好）
- 第 7 天（交租日）只从安全池 `晴 / 多云 / 热浪` 抽
- 中间 5 天最多 2 天恶劣天气（雨 / 雪 / 雾 / 沙尘）

**订单权重（v2.8 新增，`orderWeights`）**：天气不再只影响「卖什么价、卖多少」，还影响**「什么更好卖」**。
- 表结构：`config.weather.orderWeights`（全局表）× `config.weather.types[今天].orderWeights`（当日表），**相乘生效**，便于「通用规则 + 当天特例」叠加。
- 键的两种写法可自由组合：**具体商品 id**（如 `salad: 1.2`）与**温度类别** `cold` / `hot`（按饮品冷热归类）。
- 生效点：`engine.spawnCustomer()` 的订单槽抽取由均匀随机改为 `pickByWeight(list, rnd, id => orderWeightOf(id))`（**只消耗一次随机数**，与原抽样保持同样的随机流长度，保证同种子的可复现性）。
- **热天冷饮下单权重 +20%**（`heat.orderWeights.cold = 1.2`）—— 这是需求里点名的例子。
- 天气介绍页会把这个权重显式写出来（「冷饮下单 +20%」），玩家能看懂今天为什么冷饮好卖。

**表现**：顾客区右上角的**墙上天气牌**（图标 + 名称 + 一句话效果），以及覆盖整区的氛围层（7 种 CSS 平铺纹理，`pointer-events: none`）。

### 4.5 外卖系统

可选增益订单：不占顾客并发、不改制作与耐心规则、失败无惩罚。

```
订单生成 → 手机亮屏预警（提前 10s 显示所需物品 + 到店倒计时）
        → 骑手到店（v2.19 起是「人物 + 气泡」的顾客形态，站在队列最右端；手机提示「骑手已到店」）
        → 玩家把餐点拖到骑手身上交付
        → 骑手离店配送（手机提示「骑手开始配送」，店内骑手角色立即消失）
        → 10 秒后「外卖已送达 +N 金币」并结算（**双倍金币**）
        → 若当天时间不足：直接进入当天结束界面，结算时把该外卖并入当天总账
```

- **解锁**：普通模式第 3 个营业日起、困难模式第 1 天起（按本局累计天数，跨周不重置）
- **雨天**多 1 单（合计 2 单），骑手等待 +2 秒
- **收益**：`floor(base × 收银台% × 小费% × 150% × mul / 10⁶)`，整数运算；`mul = deliveredMul = 2` **仅在送达口径生效**
- **猫币**：**不发**。外卖只结金币；猫猫币只来自「每日打烊 / 每周结算 / 金币奖励 / 成就」四条
- 状态机：`scheduled → preview → rider_arrived → picked_up → delivered`

#### 4.5.1 五态机与时序（v2.8）

| 状态 | 触发时刻 | 手机显示 | 店内骑手 | 钱 |
|---|---|---|---|---|
| `scheduled` | 生成 | 灭屏（待接单） | 无 | — |
| `preview` | `phoneAt`（**提前 10 秒预警**） | 所需物品 + 「骑手 Ns 后到店」+ 进度条 | 无 | — |
| `rider_arrived` | `riderAt = phoneAt + previewMs(10s)` | 「骑手已到店」 | **出现**（顾客形态：人物 + 气泡，气泡里是餐点 + 「外卖」角标） | — |
| `picked_up` | 玩家交付瞬间 | 「骑手开始配送」+ 送达倒计时 | **立即消失** | 未结算 |
| `delivered` | `deliveredAt = 交付时刻 + deliverySettleMs(10s)` | 「外卖已送达 +N 金币」 | 无 | **双倍金币** |

三个时长全部读配置（`previewMs` / `deliverySettleMs` / `riderWaitMs`），视图与引擎不各写一份。

#### 4.5.2 跨天结算的双口径（v2.8）

日结时 `settlePendingDeliveries()` 按**是否已交付**分流，这是 v2.8 的关键口径：

| 日结时的状态 | 结算口径 | 金币 | 猫币 | 日统计 | 埋点 |
|---|---|---|---|---|---|
| `picked_up`（**已提交食物、配送中跨天**） | **送达口径** | **双倍** | 不发 | `deliveryServed` | `deliveries` +1、`crossDay` +1 |
| `scheduled` / `preview` / `rider_arrived`（**从未交付**） | 基础公式 | 基础 | 不发 | `deliveryPending` | 无 |

理由：玩家已经完成了「把餐点交给骑手」这个动作，不该因为跨天而少拿钱；反之从没交付的单不该吃送达倍率。两者互斥，同一单只会落进其中一个统计字段。

### 4.6 猫猫币经济

| 来源 | 数值 | 说明 |
|---|---|---|
| 每日存活 | +10 | 日结算发放 |
| 每周结算 | **+30（必定）** | 与流失无关 |
| 成就 | 见 34 条清单 | 一次性 |
| **金币奖励（v2.8）** | **每满 25 金币额外奖励 1 猫币，单周上限 100** | **周结算自动发放，不消耗金币** |

金币是**局内生存资源**（会被房租吃掉、周末清零），猫猫币是**局外收集货币**（永久累积、只用于皮肤/主题），两者不互通以杜绝双向失衡。

#### 4.6.1 金币奖励猫猫币（v2.8 取代「手动兑换」）

**规则**：周结算时，**每满 25 金币额外奖励 1 枚猫猫币，金币不被扣除**。例：第一周结算时持有 250 金币 → 额外获得 10 枚猫币。

| 接口 | 职责 |
|---|---|
| `engine.exchangeInfo()` | **只读**查询：`{ rate, cap, coins, earned, bonus, granted, left }` |
| `engine.grantCoinBonus()` | **自动发放**：`left` 枚猫币 → `weekStats.exchangedCat` / `weekStats.coinBonus` / `catEarned`，并 `emit('catCoin', { reason: 'coinBonus' })` |
| `engine.endWeek()` | 在周固定猫币之后、成就检查之前调用 `grantCoinBonus()`，结果写进 `lastSettle.coinBonus` |

- 旧的 `exchangeCoinsToCat(amount)`（手动扣币兑换）**已彻底删除**，视图层不再有兑换按钮 —— 兑换区退化为**只读展示**（`#exchange` / `#ex-amount` / `#ex-note`）。
- 口径：**结算时余额**（已扣房租），`earned = floor(coins / 25)`，`bonus = min(单周上限, earned)`，`left = bonus − granted`。
- 金币一分不少：奖励是「额外」的，不是「兑换」。

### 4.7 皮肤与小店主题

`config.catSkins.skins[]` 中每条皮肤携带：

- `price` 猫币价格、`nameKey` / `descKey` 文案
- `theme`：该皮肤对应的整套小店视觉（`bg` / `paper2` / `gold` / `line` / `ink2` / `deco` 背景纹理 / `keycapTop|Side|Text|Gloss` 键帽外观）
- `themeName`：风格名（如「深夜黑猫小店」）

`view.applyTheme(skinId)` 把这些写成 CSS 变量（`--paper` / `--gold` / `--theme-deco` / `--keycap-*`），**背景、面板、按钮、字体、纹理、键帽一次性全部切换**。

**商店入口（v2.7 起单页）**：主页只有一个「主题商店」入口（`shop.entry` = `shop.title` = 「主题商店」），弹层**只陈列 8 张主题卡**，不再有分页、也不再单独陈列小猫。
- 主题卡（`view.themeCardHTML()`）：用该皮肤 `theme` 里的**真实配色**拼一间迷你小店预览（墙 / 招牌 / 两块键帽 / 描边色），卡面只有「主题风格名 + 购买/切换按钮」，**不再出现「归属：XX」这类小猫身份信息**。
- 底部固定一行 `.modal-note` 小字说明（**在滚动区之外，不随内容滚动**，始终可见）：「小猫皮肤会根据所选主题自动变化，选好主题即可，无需单独切换。」
- 主题卡复用 `view.shopBtnHTML()`，与皮肤共享同一份 `owned` / `skin` 状态 —— **买主题即同时解锁对应猫皮肤**，全仓只有一条付费路径（`data-skin-buy`）。

这是把「皮肤即主题」显式化，而不是引入独立的主题商品。

### 4.8 成就系统

**34 个**一次性成就（v2.8 从 24 条扩到 34 条），分生存 / 经营 / 技巧 / 挑战 / 收集五组。

- **判定时机**：日结算 / 周结算时批量检查（`checkAchievements(when, extra)`），不与帧循环耦合
- **计数器埋点**：成交数、营业额、VIP 数、大单、垃圾桶使用、仓储峰值、双工位同时读条时长、最近成交时刻、**已完成外卖数（`deliveries`）**、**跨天送达数（`crossDay`）**、**累计猫猫币（`catCoins`，来源是本局累计 `s.catEarned`，由启动器在本局结束时并入 `ach.counters`）**
- **阈值外置（v2.20.1）**：解锁阈值不再写死在 `pass()` 的 `switch` 里，全部住在 `config.achievements.thresholds`（语义名 → 数字，30 个键）；代码一律 `this._achN(key, fallback)` 读取，fallback 与配置同值，配置缺失时行为不变。`tools/verify-fixes.mjs` 有一条**双向一致性断言**：配置里的键必须都被代码读、代码读的键必须都在配置里、且 fallback 与配置同值。
- **发放**：自动加猫猫币 + toast（2.5 秒，可排队）
- **展示（v2.8 取消隐藏）**：主页「成就」入口 → 分组列表，**全部成就直接可见**：名称 + 描述 + 难度徽章 + 奖励数额全部展示；未解锁**仅灰态**（`.ach-row.locked`），不再用 `???` 遮蔽条件
- **难度分级（v2.8）**：每条成就带 `difficulty` 字段（`easy` / `normal` / `hard` / `epic`），奖励数值按难度分档

| 难度 | 标签 | 奖励区间 | 徽章色 |
|---|---|---|---|
| `easy` | 轻松 | 5 – 10 | 绿 |
| `normal` | 普通 | 15 – 25 | 蓝 |
| `hard` | 困难 | 30 – 40 | 橙 |
| `epic` | 传说 | 50 – 60 | 玫红 |

**新增 10 条**（覆盖外卖 / 跨天 / 天气 / 经营四个维度，用来延长单局与跨局游玩时长）：

| id | 名称 | 难度 | 奖励 | 条件 |
|---|---|---|---|---|
| `ach_delivery_first` | 第一单外卖 | easy | 5 | 完成 1 单外卖 |
| `ach_delivery_10` | 外卖熟客 | normal | 20 | 累计完成 10 单外卖 |
| `ach_cross_day` | 跨夜骑手 | hard | 35 | 完成 1 单跨天送达的外卖 |
| `ach_weather_variety` | 看天吃饭 | normal | 20 | 一周经历 ≥3 种天气 |
| `ach_day_orders_12` | 爆单日 | hard | 32 | 单日成交 12 单 |
| `ach_rich_500` | 小有积蓄 | normal | 20 | 持有 500 金币 |
| `ach_revenue_5000` | 流水五千 | hard | 38 | 累计营业额 ≥5000 |
| `ach_cat_30` | 猫猫大户 | epic | 50 | 累计获得 30 枚猫猫币 |
| `ach_heat_8` | 热浪生意 | normal | 22 | 热浪天成交 8 单 |
| `ach_snow_150` | 雪天生意 | hard | 34 | 雪天单日营业额 ≥150 |

- **跨局累计口径**：`deliveries` / `crossDay` 与既有的 `orders` / `revenue` 一样，跨局由 `main.js` 的 `flushAchCounters()` 增量并入 `ach.counters`（WeakMap 幂等法）。
- **存档**：`owk.ach.v1`

### 4.9 音频

`src/audio.js` 用 WebAudio 振荡器/噪声**实时合成**，无音频文件。

- **14 个已接线音效**：点击、键帽、投料正确/错误、合成完成、成交、流失、手机铃、骑手铃、交付、错过、天气变化、购买、成就
- **2 个保留未接线**：`pause` / `resume` —— 暂停氛围由 `duck()`（压低 BGM + 关雨声）承担，再叠提示音会与 BGM 抢注意力；PRESET 表内已加注释说明。`combine`（配方匹配成功、开始读条）**无音效需求**，不与 `craftDone` 叠音。
- **2 段 BGM（v2.10 可爱风重制）**：**大厅 = 3/4 音乐盒圆舞曲（88 BPM，16 小节）**、**局内 = 4/4 轻快小曲（128 BPM，摇摆八分，16 小节）**。两首在**拍号、速度、配器、有无鼓组**四个维度上都不同，不是同一段换 bpm。
  - 主旋律走 **bell 音色**（基频 + 2 次 + 3 次泛音，快起音 + 长衰减）＝ 八音盒；和声垫/贝斯/扫弦走 `_voiceAt` 的独立 ADSR。
  - 局内带**轻打击乐**：软底鼓（150→52 Hz 下滑）、木块（短促 triangle）、沙锤（带通噪声），音量 0.03~0.14，只提供弹跳感。
  - 旋律用**绝对音高写谱**（C4=0 的半音，`seq()` 把事件表摊成定长数组），不再跟着和弦根音飘。
  - 切曲走 `bgmBus` **淡出 0.22s → 换曲 → 淡入 0.45s**，不硬切；`musicGain` 仍是玩家音量，两者分离。
  - 单圈 32.7s / 30.0s（16 小节），彻底避开 v2.9 的「4 小节 20 秒回到原点」。
  - **可离线试听**：`npm run test:bgm` 用 OfflineAudioContext 跑生产代码的 `_scheduleStep`，输出 `tools/shots/bgm-home.wav` / `bgm-day.wav` 并打印峰值 / RMS / 分频段能量。
- **雨声环境**：仅雨天营业时叠加
- **音量配比（v2.11.1）**：默认音乐 **0.70** / 音效 **0.45**；BGM 链路插入**顶部限幅器**（`bgmBus → bgmComp(-6dB, 20:1, 硬拐点) → musicGain`），
  只在峰值处工作、阈值以下完全透明，保证玩家把音乐拉到 100% 也不削波（实测峰值 0.84 → 0.62）。
  改前音乐 RMS 0.061（−24dBFS）偏小、音效峰值是音乐平均电平的 2.1 倍；改后音乐 RMS 0.10~0.12、比值 0.8~1.0。
  配比变了必须升 `VER`（当前 6），否则老存档会沿用旧音量。
- **控制**：`owk.audio.v1` 存 `{music, sfx, musicVol, sfxVol}`；设置页与暂停页共用同一状态源；音量变化走 gain ramp（避免爆音）；页面隐藏时 `suspend()`
- **音量滑杆的可理解性（v2.10.1）**：对应通道关闭时，该行降透明度（`.set-vol.muted`），并在下方显示原因（`settings.musicOffHint` / `settings.sfxOffHint`）。
  起因是用户反馈「调节音量没有用」—— 实测滑杆本身正常（20% → gain 0.20），只是**音乐关着时拖滑杆当然听不出变化**。
- 默认平衡：**音乐 0.42 / 音效 0.45**（音乐更响、音效更轻）

### 4.10 教学、暂停与模式

- **新手引导**：5 步分步高亮，可随时跳过；**两位教学顾客**串起两段交付：
  1. `bread`（点面包 → 点主食台）→ `patty`（点肉饼 → 点主食台）→ `serve`（把汉堡拖给顾客）
  2. 第 1 位教学顾客离场后**自动补一位只看可乐的顾客** → `cola`（点糖浆/水 → 点甜品台）→ `serveCola`（把可乐拖给新顾客）→ 教学完成
- **教学订单可预测**：教学顾客订单由 `spawnCustomer(tutorial, forceItems)` 直接构造（第 1 位固定 `burger`、第 2 位固定 `cola`，各 1 件），不参与随机抽单——否则引导文案会和实际需求对不上。
- **教学期冻结**：教学顾客耐心为 `MAX_SAFE_INTEGER`（不走）、营业倒计时不计时、不生成普通顾客；教学（含跳过）结束时残留教学顾客会被放回普通耐心，保证当日仍能打烊。
- **暂停**：所有计时冻结（顾客耐心、倒计时、读条），弹窗提供继续 / 回主菜单
- **模式**：普通（汉堡免生菜）与困难（招牌汉堡、可乐可能加冰、耐心 ×0.85、队列 4）；困难需普通模式通关后解锁（`owk.hard.unlocked`）

### 4.11 弹层结构与退出方式（v2.6）

所有弹层共用 `view.modal()`，结构固定为三段：

```
.modal-card（纵向 flex，自身不滚动）
├── .modal-head   ← 标题 + 可选 .modal-x（右上角 ✕），不参与滚动
├── .modal-body   ← 唯一滚动区
└── .modal-actions← 底部按钮，不参与滚动
```

- **主页 5 个功能页**（商店 / 成就 / 配方书 / 天气介绍 / 设置）都传 `closable: true`，右上角常驻 ✕。
  原文缺陷：退出按钮只出现在底部 `modal-actions`，配方书有 14 张卡、成就有 24 条时玩家必须滚到底才能退出。
  现在头部与底部都不随内容滚动，**任何位置都能一键退出**。
- **结算 / 破产 / 暂停类弹层不传 `closable`**：它们必须走「下一天 / 重开 / 继续」按钮推进，给 ✕ 会造成状态机悬空。
- `.modal-x` 的描边与文字用 `--ink-strong`（按皮肤背景亮度翻转），避免深色主题下糊在深底上。

---

### 4.12 设备升级与垃圾桶返还

四台设备各自 4 级，**升级全额扣费，没有任何返现**（旧的「按累计投入返还 50%」已删除）：

| 设备 | 升级效果 | 面板写法 |
|---|---|---|
| 炉灶 | 合成读条缩短 1200 → 1020 → 870 → 740 ms | 出餐 1.2 秒 → 1.0 秒 |
| 收银台 | 每单收入倍率 ×1.0 → ×1.3 | 每单收入 +0% → +10% |
| 招牌 | 顾客耐心 ×1.00 → ×1.15 | 顾客耐心 +0% → +5% |
| 垃圾桶 | **丢弃返还比例** 0% / 20% / 40% / 60% | 丢弃返还 0% → 20% |

- **面板一律不出现英文标记与毫秒**：数值在 `view.devText()` 里折算——时间折成秒、倍率折成百分比。
- **垃圾桶不再有冷却**：丢弃随时可做；升级的唯一作用是把「丢掉的成本」按比例退回来（`floor(chainCost × rate)`），失败品成本为 0 故不返还。
- HUD 右侧（配方书左边）常驻显示**本周租金**，第 6 天起若仍不够房租，数字标红提示。

### 4.13 主题配色与深色可读性

皮肤 = 整店主题，`catSkins.skins[].theme` 提供 `bg / paper2 / gold / line / ink2 / deco / keycap*`。
`view.applyTheme()` 把它们写进 `<html>` 的内联样式变量。

**颜色分工（改颜色前先读这条，否则深色主题必糊）**

| 变量 | 只用来做 | 浅色主题 | 深色主题 |
|---|---|---|---|
| `--ink` | **描边**（边框、虚线） | `#2B2B2B` | `#E9E4D8` |
| `--ink-strong` | **所有正文文字**（含 body 继承色） | `#2B2B2B` | `#F6F2E8` |
| `--ink-2` | 次要文字（主题提供） | `#6C6455` | 皮肤自带（`#B9BCD0`） |
| `--muted` | 辅助说明文字 | `#A79C87` | `#A7ADC6` |
| `--faint` | 占位符号 `+ → —` | `#BEB5A2` | `#B4BACF` |
| `--warm-ink` | 价格、链接、提示徽标 | `#8C7A4E` | `#D9BE7E` |
| `--surface` | 卡片 / 格子 / 按钮填充 | `#FFFFFF` | `#363A55` |
| `--surface-2` | 槽底、进度条轨道、徽章底 | `#F7F2E6` | `#2E3149` |
| `--surface-accent` | 输出槽、选中态、VIP 气泡 | `#FFF8E7` | `#3F4468` |
| `--queue-deco` | 客人队列斜纹（data URI，**没法读变量**） | 暖黄 | 深蓝紫 |

三条铁律：

1. **`--ink` 不是文字色**。它固定为深色只为卡通描边；文字一律用 `--ink-strong`
   （`body` 的 `color` 也是 `--ink-strong`，否则所有未单独设色的文字在深色主题下会继承成近黑）。
2. **不要写裸的 `background: #fff`**。深色主题不会翻它 → 得到「白卡片 + 浅灰字」（实测 1.9:1）。
   用 `--surface` / `--surface-2` / `--surface-accent`。`verify-fixes.mjs` 的 `B32-noHardWhite` 会拦。
3. **表面色与文字色必须成套翻转**。`applyTheme()` 的深色分支一次性设置表面、描边、正文、弱文字、
   暖金与队列纹理；少设一个就留一块白斑或一行浅灰字。`B32-darkFlips` 逐个变量校验。

**深色特例**：写死的品牌色（猫币粉、警示红、成就徽章、教学条深棕）无法用单一变量表达，
统一收在 `style.css` 末尾的 `html[data-theme="dark"] { … }` 覆盖块里，浅色主题不进这个块。
注意：`applyTheme()` 设的是**内联样式**，优先级高于该块，所以**变量**的深色值必须写在
`applyTheme()` 里（`--red` 例外，它不在 `:root` 内联覆盖范围内）。

### 4.14 通用合成台与一键提交（v2.17）

**原料仍是 14 种，配方 14 → 18 条。** 新增四道只用现有原料的 2 料配方：

| id | 名称 | 台 | 输入 | 价 | 链成本 | 净利 |
|---|---|---|---|---|---|---|
| `cheeseFries` | 芝士薯条 | food | 薯条 + 芝士 | 9 | 4 | 5 |
| `latte` | 拿铁 | drink | 咖啡 + 牛奶 | 9 | 5 | 4 |
| `milkTea` | 奶茶 | drink | 茶 + 牛奶 | 8 | 4 | 4 |
| `hashBrown` | 薯饼 | food | 土豆 + 番茄酱 | 6 | 2 | 4 |

这四组输入对与原有 9 组**两两不冲突**（`table` 里 18 条唯一），且前三道的输入含一道已沉没的成品，
所以 `thisCost` 只算新投的那件叶食材（2），不是链成本。

**通用合成台 `universal`**（配置在 `stations.universal`，能力全部走开关，引擎里没有 `=== 'universal'` 硬编码）：

- 2 入 1 出，**能做饭也能做饮品**（`acceptsAll`）
- **读条 = 炉灶当前读条 × `timeFactor`(1.5)**，专用台不受影响（系数 1）
- **可制作全部内容**（v2.18 起）：`forbidsIntermediate` 已关，菜肉饼 / 饼底这类半成品也能在通用台做。
  半成品读条按 **`stoveMs × intermediateStepFactor(0.65) × timeFactor(1.5)` 乘算**（≈0.975× 炉灶），
  仍比专用台的 0.65× 慢 —— 「通用台更慢」这个代价保留。
  开关与拦截代码（`craftGuard` / `stationForbidsIntermediate`）都还在，改回 `true` 立刻恢复拦截。
- 点击链路与两台专业台完全一致（v2.18 起）：点食材选中 → 点通用台即落料；拖动同样可用。
  **双击食材键的快捷投料不包含通用台**（只投到配方归属的专业台），避免手滑把料送进慢灶。
  引擎侧仍保留「不传 station 就按配方归属」的兜底（`addIngredient(key)`），供 Node 断言直接调用。

**一键提交**（`engine.submitFromStorage()`）：

- 扫描仓库里的**可售成品**，跳过中间产物与失败品；**外卖不参与**；教学顾客跳过。
- 分配规则：**剩余耐心升序**（最急的先拿），等值按入场顺序。
- 遵守 `equivalenceClasses`（顾客要可乐时仓库的冰可乐可交，**结算按实际商品价**）。
- 交付走的是 `serve()` 抽出的 `fitsSlot`/`slotFor`，匹配口径与手操同源，连击与成就计数不会漂移。
- UI 侧有 280ms 防连点。

**每日菜单池已数据化**：`meta.dayLoop.foodPool` / `foodPoolHard` / `drinkPool`，`buildMenu` 读配置（配置缺失回落到内联兜底）。
新菜必须在这三个池子里才会被顾客点到 —— 只加配方不进池等于做出来卖不掉。

**布局（v2.18）**：三个合成台（食物台 / 甜品台 / 通用台）全部竖排在右列 `.op` 里，
`.op` 占 `grid-row: 1 / span 2`（高度 = 首行 + gap + 仓储行 = 440），三台靠 `flex: 1 1 0` 均分，
所以永远等高（141.3）、同宽（= `sizing.opW`）、同左边缘，竖排顺序固定。
仓储行 `.shelf` 只占左列（`grid-column: 1`）、铺满到操作列左边缘，行内顺序
「仓库（`flex: 1 1 auto` 吃掉剩余宽度）→ 一键提交 → 垃圾桶贴右端」；
格位令牌 `sizing.stationSlot`（台内 54，用户明确「不放大」）/ `sizing.storeSlot`（仓库 72）/ `sizing.trashW`（110）。
`layout.json` 里 `bufferRow` 保留 `_deprecated:true` 并被 `universalStation` 复用（`M19-a` 断言依赖它），
`universalStation.rect` 现为 `[640,373,470,141]`，`storageRow.rect` 现为 `[10,418,622,96]`。

## 5. 核心类与关键接口清单

### 5.1 `Game`（`src/engine.js`）

纯逻辑引擎，构造时注入 `ctx`（配置与派生数据）。

| 分类 | 接口 | 说明 |
|---|---|---|
| 事件 | `on(evt, fn)` / `emit(evt, data)` | 引擎与外部的唯一通信方式 |
| 局次 | `newRun(mode, week)` / `resume(save)` | 开局 / 读档（破产为终局，无重开） |
| 日循环 | `startDay(d)` / `endDay()` / `nextDay()` / `closeDay(reason)` / `tick(dt)` | 每日推进 |
| 周循环 | `endWeek()` / `nextWeek()` / `rentForWeek(week)` | 每周结算与房租 |
| 制作 | `addIngredient(key)` / `combine(station)` / `quickReload(station)` / `recallInput(station, i)` | 投料 / 合成 / 输出回投 / 撤回 |
| 交互 | `moveItem(src, dst)` / `serve(item, customer)` / `dismiss(id)` / `loseCustomer(c)` | 拖放与交付 |
| 物品 | `mkItem(key)` / `itemAt(loc)` / `takeAt(loc)` / `pushStorage(item)` | 物品与位置寻址 |
| 顾客 | `spawnCustomer(tutorial)` / `orderSlot(slot, id)` / `buildMenu()` / `menuLeaves()` | 顾客与当日菜单 |
| 天气 | `ensureWeekWeather()` / `weatherCfg()` / `pickDrink(list, main, rnd)` / `tempOfDrink(id)` | 天气排布与饮品加权 |
| 外卖 | `rollDeliveries()` / `updateDeliveries()` / `pickupDelivery(id)` / `deliveryEarn(d)` / `settlePendingDeliveries()` | 外卖全流程 |
| 经济 | `catGain(reason)` / `exchangeInfo()` / `exchangeCoinsToCat(n)` | 猫币与兑换 |
| 成就 | `bumpCounter(key, n)` / `checkAchievements(when, extra)` | 埋点与判定 |
| 设备 | `upgrade(key)` / `deviceInfo(key)` / `togglePause()` | 升级与暂停 |
| 存档 | `snapshot()` | 序列化当前局 |

### 5.2 `View`（`src/view.js`）

| 分类 | 接口 | 说明 |
|---|---|---|
| 装配 | `mount()` / `render()` | 首次搭建 DOM / 全量重绘 |
| 渲染 | `renderStations()` / `renderStorage()` / `renderCustomers()` / `renderWeather()` / `renderPhone()` / `renderRider()` / `renderRecipe()` | 各区域渲染 |
| 交互 | `onDown(e)` / `onMove(e)` / `onUp(e)` / `onClick(e)` / `handleAct(el, e)` | 拖拽与点击 |
| 点击投料 | `clickIngredient(key)` / `placeSelectedIng(station, index)` / `clearIngSelection()` / `stationRejectsIng(ing, station)` | 点食材=选中 → 点台=落料；`stationRejectsIng` 供「可放/不可放」视觉提示 |
| 弹层 | `modal({title, body, actions, tone, closable, onClose})` / `closeModal()` / `toast(msg, ms)` | 通用弹层与提示；`closable: true` 时标题栏右上角渲染 `.modal-x` 关闭按钮 |
| 页面 | `showMenu()` / `showDayEnd()` / `showWeekEnd()` / `openShop()` / `openAch()` / `openRecipeBook()` / `openWeatherIntro()` / `openSettings()` | 各功能页 |
| 主题 | `applyTheme(skinId)` / `currentThemeName()` | 主题切换 |
| 辅助 | `sfx(name)` / `nameKey(id)` / `chainOf(id)` | 音效、命名、配方链 |

### 5.3 `AudioManager`（`src/audio.js`）

| 接口 | 说明 |
|---|---|
| `unlock()` | 首次用户手势后创建 / 恢复 AudioContext |
| `loadState()` / `saveState()` | 读写 `owk.audio.v1` |
| `setMusic(on)` / `setSfx(on)` | 开关，立即生效 |
| `setMusicVolume(v)` / `setSfxVolume(v)` | 音量，0~1，立即生效 |
| `duck(on)` | 暂停时压低 BGM、停止雨声 |
| `play(name)` | 播放一次性音效（50ms 防抖，最多并发 4） |
| `setBgm(mode)` / `setRain(on)` | 背景音乐 / 雨声环境 |
| `suspend()` / `resume()` | 页面隐藏时挂起 |

### 5.4 引擎事件

| 事件 | 触发时机 | 主要消费方 |
|---|---|---|
| `change` | 状态变化 | 视图重绘 |
| `served` / `lost` | 成交 / 顾客流失 | 音效、成就埋点 |
| `craftDone` / `craftFail` | 合成成功 / 失败 | 音效、统计 |
| `trash` | 丢弃物品 | 成就埋点（惜物如金） |
| `dayEnd` / `weekEnd` | 日 / 周结算 | 结算弹窗、成就结算 |
| `catCoin` | 发放猫币 | 启动器累加并落盘 |
| `achievement` | 成就解锁 | 启动器发币 + toast |
| `deliveryPreview` / `deliveryRiderArrived` / `deliveryPickedUp` / `deliveryDone` | 外卖各阶段 | 手机 UI、音效 |
| `upgraded` / `bankrupt` / `dayTimeUp` | 升级 / 破产 / 打烊 | 弹窗、音效 |

### 5.5 存档键

| 键 | 内容 | 生命周期 |
|---|---|---|
| `owk.save.v1` | 当前局快照 **v2**：模式/周/日、金币、设备等级、天气排布、**主仓储、三个工位的输入/输出/读条进度/合成中产物、在场顾客（订单 + filled 状态 + 剩余耐心 + patienceMax + 体型/配饰/VIP/教学标记）**、本局成就计数器 | 随局变化（打烊 / 退出 / 每帧存档点写入） |
| `owk.cats.v1` | 猫币、已拥有皮肤、当前皮肤、常做配方 | 永久 |
| `owk.ach.v1` | 已解锁成就列表 | 永久 |
| `owk.audio.v1` | 音乐 / 音效开关与音量 | 永久 |
| `owk.hard.unlocked` | 困难模式解锁标记 | 永久 |

---

## 6. 配置与资源说明

### 6.1 权威数值文件

| 文件 | 内容 | 关键字段 |
|---|---|---|
| `owk_handoff_config.json` | 经济、难度、节奏、顾客、定价、设备、仓库、猫币、皮肤、天气、外卖、成就 | `economy.rentByWeek`、`difficulty.*.pace`、`weather.types`、`delivery.*`、`catCoins.*` |
| `owk_handoff_crafts.json` | 配方表、合成规则、等价类 | `recipes[]`（`inputs` / `price` / `thisCost` / `chainCost` / `net`）、`equivalenceClasses` |
| `owk_handoff_i18n.json` | 全部界面文案（约 300 键） | `ing.*` / `food.*` / `drink.*` / `shop.*` / `weather.*` / `ach.*` |
| `owk_handoff_layout.json` | 舞台尺寸与固定布局 | `sizing`（`opW` / `shelfH` / `storeSlot` / `ingCols`） |

**改数值不用碰代码**：例如房租、天气效果、外卖时序、皮肤价格与主题配色，全部在这几个 JSON 里。

### 6.2 关键数值速查

| 项 | 普通 | 困难 |
|---|---|---|
| 单日时长 | 90 s | 90 s |
| 每日顾客（基准 / 雪天 / 热浪，第 1 周） | 9 / 6 / 10 | 11 / 7 / 12 |
| 第 3 周起（含周增长，上限 14） | 13 / 10 / 14 | 14 / 11 / 14 |
| 顾客间隔 | 10 s | 8.2 s |
| 基础耐心 | 42 s | 35.7 s（×0.85） |
| 起始金币 | 65 | 65 |
| 房租（1 / 2 / 3+ 周） | 400 / 700 / 950 | **×1.2 = 480 / 840 / 1140** |
| 仓库 | 5 格 | 5 格 |
| 队列上限 | 3 | 4 |
| 合成读条 | 1200 ms（满级 740 ms） | 同 |

### 6.3 美术资源

- 全部为**运行时生成的内联 SVG**（`src/art.js`）：顾客（6 体型 × 6 配饰）、猫（8 皮肤 × 3 表情帧）、骑手、食材 / 成品 / 天气图标
- 主题纹理与键帽效果用 **CSS 平铺 data-URI** 实现，无位图
- PWA 图标：`pwa/icons/icon-192.png`（另有 `tools/gen-icons.py` 与 `pwa/gen_icons.py` 两个等价脚本，都是本地一次性生成器，**运行时不使用**；产物已入库，改图标才需要重跑其中一个）

### 6.4 工具脚本（`handoff/tools/`）

| 脚本 | 作用 |
|---|---|
| `test-engine.mjs` | 引擎回归：**524 条**机制断言（AC-01 ~ AC-56 + S1 时间轴 / S4 存档往返 / S5 隔天清台 / 双工位并行 / 暂停 4 项 / 成就补充 / 教学 / 困难解锁 / S2 资产完整性 / V217 通用台与一键提交 / V217.1 菜单池）；严格深比较，单条断言抛错只记 fail 不中断整轮 |
| `verify-fixes.mjs` | 修复回归：**420 条**（v2.5：A1~A11 / L1~L11 / M9/M10/M12/M19 引擎侧 + main.js/view.js/style.css/audio.js/sw.js/i18n 的源码级契约；v2.6：B9 商店分页合并 + 功能页 ✕；v2.7：B9 扩为 36 条，主题商店单页化；v2.20.1：V221 成就阈值外置的双向一致性与 catCoins 累计、V220 版本/SW 缓存改为动态一致性断言） |
| `_assert.mjs` | 断言基础设施（`deepEqual` 严格比较、`createSuite`、`warn` 已知缺陷通道），供上面两个脚本与 7 个巡检脚本复用 |
| `visual-check.mjs` | 画面与元素状态巡检 + **配方书 `.book-*` 样式（浅色/深色两套）** + 死样式清理核查 + AC-26/AC-33 配方书 + **AC-TUT-6~9 教学全链路** + **V-24~V-37 商店分页与功能页 ✕**（59 条） |
| `flow-check.mjs` | 整周流程（开局 → 打烊 → 周结算 → 兑换区 → 下一周）与困难解锁（17 条） |
| `hard-check.mjs` | 困难模式全链路（菜肉饼→招牌汉堡、两步冰可乐、升级、失败品、垃圾桶无冷却）+ **AC-30 困难解锁门槛（未通关时按钮 disabled）**（20 条） |
| `day-check.mjs` | 日循环、打烊小结弹窗、跨日时钟归零（10 条） |
| `interact-check.mjs` | 拖拽 / 点选交付 / 撤回 / 指针过滤 / 舞台外松手 / 反馈文案 / 点骑手 / 主题与音量 / BGM 补启 / 手机进度条 / toast 收口（47 条） |
| `pwa-check.mjs` | 手机横屏可玩 + **离线启动** + SW 缓存清单（缓存名取磁盘 `sw.js`，不写死版本）（18 条） |
| `leaf-check.mjs` | 食材点亮/置灰（横屏视口）+ 困难模式「冰」点亮（13 条） |
| `v28-check.mjs` | v2.8 外卖预警/跨天/金币奖励/天气权重/成就分级（32 条） |
| `v29-check.mjs` | v2.9~v2.11 音频（含 **BGM 调度器活性 + 离线渲染 + 限幅器接线**）/ 拖拽 / 天气页 / 小猫气泡 / 失败品 / 猫猫币说明（97 条） |
| `sim-economy.mjs` | **开发工具（不进 npm test）**：用真实引擎跑「普通/困难」整周经济模拟，输出周收入、房租结余、成交/流失/失败品与日均营业时长，用于配平。`node tools/sim-economy.mjs 5`，`SIM_DELAY=400` 可模拟真人手速 |
| `bgm-render.mjs` | **开发工具**：把两首 BGM 用 OfflineAudioContext 渲染成 WAV（`shots/bgm-home.wav` / `bgm-day.wav`），并量峰值/RMS/分频段能量 |
| `shots/` | 截图产物 |

**本表口径**：`test-engine.mjs` 的 **524** 条是「引擎断言」；`verify-fixes.mjs` 的 **420** 条单列为「修复回归」；两者相加 = **944**，`npm test` 一次跑完。那 9 个浏览器巡检脚本是本地工具、不随仓库发布，本文不给它们写死条数。表中「N 条」均为脚本实际打印值（`结果：N 通过`）。

**AC 覆盖情况：54 / 55**（AC-01 ~ AC-55 中除 AC-37 外全部有可执行断言）。
- 唯一未覆盖：**AC-37**「加冰开关开，糖浆+水+冰 一步出冰可乐」——该机制自 v1.4 起**已废弃**（开关移除，加冰改为普通配方 `cola + ice → icedCola`，见 AC-25/AC-25d），属**不适用**而非漏测；PRD §12 该行需同步作废。
- 覆盖分布：`test-engine.mjs`（AC + S/M/L 机制）、`verify-fixes.mjs`（修复回归）、`hard-check.mjs`（AC-30 模式门槛）、`visual-check.mjs`（AC-26/AC-33 配方书面板）。

---

## 7. 游戏流程与状态流转

### 7.1 局内状态机

```
          ┌──────────── nextDay() ────────────┐
          ▼                                      │
      [day] ──closeDay()──▶ [dayEnd] ──────────┘
          │  ▲
          │  └── 倒计时归零 / 手动打烊
          │
          └── endWeek() ──▶ [weekEnd] ──nextWeek()──▶ [day]
                                  │
                                  └── 金币 < 0 ──▶ [bankrupt] ──（终局）──▶ 回主页
```

- `phase` 取值：`day` / `dayEnd` / `weekEnd` / `bankrupt`
- 另有独立标志 `paused`（暂停）与 `tutorial`（教学进行中）
- 屏幕层：`#screen-menu` / `#screen-game`，弹层 `#modal` / `#toasts` 挂在舞台层，**跨屏幕可见**

### 7.2 一次制作与交付

```
点食材（只选中，不落台）→ 点合成台 / 输入格 → addIngredient(key, station, index)
        或：把食材直接拖到合成台 → 同一个 addIngredient 入口（两条路径守卫同源）
        → 输入槽满 → 自动 combine()
        → 成功：输出槽出成品（读条 1.2s）
        → 失败：输出「失败品」
拖成品 → 顾客气泡 → serve() → 命中订单槽位 → 该条目打勾
        → 全部完成 → settle() → 收款 + 连击 + 成就埋点
```

### 7.3 存档与恢复

```
局内变化 → main.js 的 change 监听 → persist() → localStorage['owk.save.v1']
重新打开 → resume(save) → 恢复天数/金币/设备/仓库/顾客
局外（猫币/成就/音频/皮肤）各自独立存档，不随局重置
```

---

## 8. 运行与构建方式

### 8.1 本地开发

```bash
cd handoff
npm install        # 无依赖，可跳过
npm run dev        # 启动零依赖静态服务器 → http://localhost:8080
npm test           # **只含 Node 侧**：引擎 524 + 修复回归 420 = 944 条（无头运行，0 失败才 exit 0）
npm run test:bgm   # 把两首 BGM 离线渲染成 WAV 并量电平（需先 npm run dev；本地工具，未随仓库发布）
npm run test:browser  # 浏览器巡检（本地工具，未随仓库发布）：需先 npm run dev，并依赖 .pw 下的 playwright
```

> **口径提醒**：`npm test` **不包含**浏览器巡检。浏览器巡检脚本（visual / interact / day / flow / hard / pwa / leaf / v28 / v29）
> 与 `test:bgm` / `test:proof` / `test:measure` 一样**只在本机存在**，发布版 `package.json` 已剔除这些入口 ——
> 所以本文不给它们写死条数，以本地实跑打印的 `结果：N 通过` 为准。
> `test:engine` / `test:fixes` 可单独跑两个 Node 套件。必须通过 **HTTP(S) / localhost** 访问；`file://` 会被浏览器拦截 `fetch` 与 Service Worker。

### 8.2 部署

> **硬性规则：本项目发布只走「标准 git 提交 + `git push`」。**
> **严禁改回 GitHub REST API 逐文件写 Git 对象库**
> （即 `/git/blobs`、`/git/trees`、`/git/commits`、`/git/refs` 那一整套）。
> 逐文件写 blob 会在极短时间内产生大量细碎、机器形态的提交，与「机器人刷量」的特征高度相似，
> 是平台判定异常自动化行为的高风险特征。**git 推不通时应修网络 / 代理 / 凭据，而不是退回 REST API。**

`deploy-github.mjs` 只做两件事：把 `handoff/` 同步到 `owk-github/`，然后在 `owk-github/` 里执行标准 git 提交与推送。

```bash
node deploy-github.mjs              # 同步 + 提交 + 推送到 main
node deploy-github.mjs --sync-only  # 只同步本地发布目录，完全不碰 git
node deploy-github.mjs --force      # 远端历史可被覆盖时才用
node deploy-github.mjs --dry-run    # 只打印将要执行的 git 命令，不写文件、不联网
```

- **认证**：PAT 放在一次性 `http.extraheader` 里交给 `git push`，**不写入 `.git/config`、不拼进远端 URL**；同时禁用交互式凭据弹窗（`GIT_TERMINAL_PROMPT=0`）
- **凭据来源**：仓库根 `.git-token`（也可设 `GITHUB_TOKEN`），该文件被 `.gitignore` 与脚本双重排除
- **密钥闸门**：提交前 `assertNoSecrets()` 扫描 `owk-github/`，文件名像凭据、或内容含 `ghp_` / `github_pat_` 样式字符串则直接中止
- **换账号/换仓库不改代码**：`OWK_OWNER=新账号 OWK_REPO=仓库名 node deploy-github.mjs`；提交作者会自动对齐到该账号的 noreply 邮箱
- **推送被拒时**：脚本会区分「非快进（历史不一致）」与「认证失败」并给出对应处置，不会静默失败
- 站点：GitHub Pages（`main` 分支构建），SW 缓存版本号手动递增（`owk-vNN`）

### 8.3 PWA

- `sw.js` 预缓存全部静态资源，缓存名按版本递增，升级时自动清理旧缓存
- `pwa/manifest.webmanifest` 提供安装信息、图标与横屏偏好
- 首次联网加载后即可完全离线游玩

---

## 9. 已知限制与可扩展方向

### 9.1 已知限制

| 限制 | 说明 |
|---|---|
| 强制横屏 | 竖屏显示「请旋转设备」遮罩并冻结计时（`portraitHint`） |
| 无音量滑杆之外的音频控制 | 本期只做「是否开启」与音量百分比，不做音效包 / 均衡器 |
| 配方无「解锁」概念 | 18 条配方全部可见可查看（含困难模式专属），避免玩家在简单模式无从了解 |
| 成就「装修队」依赖主题 | 主题已并入皮肤，该成就在购买任意非默认皮肤时即可解锁 |
| 深色主题对比度 | 8 款皮肤中 `black` / `lucky` 两套深色底：弹窗标题、配方书卡片、标签页已走 `--ink-strong`（按皮肤背景亮度自动翻转）修正；但 HUD 药丸、`.stat-grid`、`.st-lv`、`.ord.ok`、`.combo-pill` 等**约 15 处既有硬编码浅底**尚未逐屏标定，深色皮肤下会呈现「白色小卡片」 |
| `--ink-strong` 是亮度启发式 | `view.applyTheme()` 按 `theme.bg` 的相对亮度 < 0.5 判深色并给出 `#F4EFE4` 文字色；若将来新增「中灰」皮肤（亮度≈0.5）可能判错。更稳的做法是给 `catSkins[].theme` 增加显式 `inkOnPaper` 字段（需改 config JSON） |
| 存档不恢复当日倒计时与外卖进度 | `resume()` 恢复仓储/工位/在场顾客/设备，但**当日营业倒计时重置为满**（避免「存档即打烊」），也不会保存当天的外卖单（按 `mode|week|day` 确定性重掷，刷新会丢一趟既有外卖交互） |
| 教学订单与引导文案（已在 v2.5 修复） | `spawnCustomer(tutorial, forceItems)` 曾让非 VIP 随机抽单覆盖教学订单，导致文案与需求不符、单件订单还会把引导链断在 `serveCola`。v2.5 已改为教学单直接构造（`burger` / `cola` 各一位顾客），并由 `AC-TUT-1~9` 钉死；本条保留以记录历史 |
| 单人本地存档 | 无账号、无云同步，多标签页同时游玩会互相覆盖 `owk.save.v1` |
| 音频为合成音 | 音色是振荡器合成，非真实乐器采样；追求质感需替换为音频素材 |
| 拖拽命中区偏小 | 手机横屏下骑手热区约 52×66 px，密集操作时可能偏紧 |

### 9.2 可扩展方向

| 方向 | 说明 | 落点 |
|---|---|---|
| 新增天气 | 只改 `config.weather.types` + 氛围层 class 即可，引擎无需改动 | `config.json` / `style.css` |
| 新增皮肤与主题 | 加一条 `catSkins.skins`（含 `theme`）即自动出现在商店 | `config.json` / `art.js` |
| 新增成就 | 加一条 `achievements.list`（`cond` 对应 `checkAchievements` 的判定分支） | `config.json` / `engine.js` |
| 新增配方 | 加一条 `crafts.recipes`（`inputs` / `price` / `thisCost`） | `crafts.json` |
| 外卖规则扩展 | 骑手外观、更多时间点、骑手等待时长都在 `config.delivery` | `config.json` |
| 成就 / 主题 / 音频 / 主页扩展 | 参考规格 `F:\opencode\owk.md`（OWK-CFG-005）§12~§15 | 视需求分批实施 |
| 排行榜 / 成就墙 | 可挂在既有 `owk.ach.v1` 与 `owk.cats.v1` 上 | `main.js` |
| 触屏手感 | 扩大拖放热区、长按替代拖拽（当前已支持点选交付） | `view.js` |

### 9.3 改动本项目的注意事项

1. **数值只改 JSON**，不要写进 `engine.js` / `view.js`。
2. **引擎改动必须补断言**：新增机制在 `tools/test-engine.mjs` 补一条带 AC 编号的用例（无对应 AC 编号时用 `S*/M*/L*` 编号并在 §6.4 说明）；**引擎断言 524 条只增不减**。改动 v2.5 修过的点时同步补 `tools/verify-fixes.mjs`（420 条）。`npm test` 必须 0 失败。
3. **JS 字符串替换的坑**：`String.replace()` 的替换串里 `$$` 表示字面 `$`，批量替换 `$$(` 会被压成 `$(`（曾多次导致 `forEach` 抛错）。请用**函数形式**替换，或改用编辑工具直接改。
4. **SVG 分层**：实心形状会整块盖住后画的兄弟元素（曾导致头部花纹被头圆吃掉）。新增图案需明确绘制顺序。
5. **改完跑两件套**：`npm test`（引擎断言 524 + 修复回归 420 = 944 条，零依赖，必须 0 失败）+ 本地 `npm run test:browser`（浏览器巡检脚本不随仓库发布，需先 `npm run dev`，条数以本地输出为准，全部应 `exit 0`）。

---

*文档随代码演进更新；最新变更记录见 `PROGRESS.md`（含逐版本验收结论）。*
