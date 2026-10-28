// ============================================================ 音频（OWK-CFG-005 §14）
// WebAudio 合成，不依赖外部音频文件；只做表现层，不影响任何计时、随机数与经济结算。
//
// v2.9 音频重做（用户反馈：音乐过轻、音效难听、缺小猫专属音效、大厅与局内音乐雷同）
// ---------------------------------------------------------------------------
// 旧版的三个病根，以及这次怎么治：
//   1. 音乐"过轻"：旧版每个音符只有 0.08 增益、纯单声部 triangle 打点，
//      且 bpm 70 时每 1.7 秒才响一次 —— 听起来又轻又空，像在等回复。
//      → 改成 **四声部编排**（pad 和声 + bass 根音 + arp 分解和弦 + 旋律），
//        音符密度提高 4 倍，总增益抬到0.9~1.1（外层还有 musicGain 总控）。
//   2. 音效"难听"：旧版大量用 square（方波，占满全频段，听着像老式电子 beep）
//      和 sawtooth（锯齿波，高频毛刺，尖锐刺耳）。
//      → 全部改成 **sine / triangle**（圆润），并给每个音效挂一个低通滤波器
//        （截止频率随 preset 定义），把刺耳的高频毛刺削掉。
//   3. 大厅/局内音乐一样：旧版两段只有 bpm 和音阶不同，听感上几乎分辨不出。
//      → 写成两首**真正不同的曲子**：不同的调式、和弦进行、节奏型、配器密度。
//
// 音量口径（重要，改动前请先读）：
//   PRESET.vol 是"这一条声音自身的峰值"，是相对值；
//   sfxGain / musicGain 才是玩家在设置页能调的总量。
//   所以"音效太大"的正确解法是**调低 PRESET.vol 并柔化音色**，而不是压 sfxGain ——
//   压总控会让玩家调大音量时把刺耳感一起放大。

// 音色库：全部避开 square / sawtooth，统一走圆润波形。
const TONE = {
  soft:    { wave: 'sine',     cutoff: 2400 },  // 通用柔和音，UI 反馈主力
  bell:    { wave: 'sine',     cutoff: 5200 },  // 铃铛音（外卖骑手铃、成就），保留一点清亮
  wood:    { wave: 'triangle', cutoff: 3000 },  // 木质音（键帽、投料成功）
  warm:    { wave: 'triangle', cutoff: 2000 },  // 暖音（合成完成）
  mallet:  { wave: 'sine',     cutoff: 3600 },  // 小锤音（点单、下单）
  meow:    { wave: 'sine',     cutoff: 2600 },  // 小猫叫（v2.9 新增，独立音色）
  low:     { wave: 'sine',     cutoff: 900  },  // 低频提示（失败、冷却）
};

const PRESET = {
  ui_click:         { tone: 'wood',   freq: 420, dur: 0.06, vol: 0.128, slide: 0 },
  keycap:           { tone: 'wood',   freq: 280, dur: 0.05, vol: 0.104, slide: -30 },
  ingredient_ok:    { tone: 'warm',   freq: 520, dur: 0.13, vol: 0.16, slide: 160 },
  ingredient_wrong: { tone: 'low',    freq: 200, dur: 0.18, vol: 0.136, slide: -50 },
  step_done:        { tone: 'warm',   freq: 640, dur: 0.15, vol: 0.152, slide: 60 },
  order_done:       { tone: 'mallet', freq: 500, dur: 0.30, vol: 0.192, slide: 190 },
  order_expired:    { tone: 'low',    freq: 400, dur: 0.28, vol: 0.136, slide: -130 },
  delivery_ring:    { tone: 'bell',   freq: 880, dur: 0.9,  vol: 0.16, slide: 0, ring: true },
  rider_bell:       { tone: 'bell',   freq: 1050, dur: 0.42, vol: 0.176, slide: 0, bell: true },
  delivery_done:    { tone: 'mallet', freq: 540, dur: 0.5,  vol: 0.208, slide: 220 },
  delivery_missed:  { tone: 'low',    freq: 330, dur: 0.36, vol: 0.128, slide: -110 },
  weather_change:   { tone: 'soft',   freq: 260, dur: 0.38, vol: 0.104, slide: 70, noise: true },
  purchase:         { tone: 'mallet', freq: 580, dur: 0.24, vol: 0.16, slide: 150 },
  achievement:      { tone: 'bell',   freq: 740, dur: 0.65, vol: 0.168, slide: 240, tri: true },
  // pause / resume：保留未接线 —— 暂停氛围由 duck()（压低 BGM + 关雨声）承担，
  // 再叠一条提示音会和 BGM 抢注意力。
  pause:            { tone: 'low',    freq: 300, dur: 0.12, vol: 0.104, slide: -60 },
  resume:           { tone: 'low',    freq: 300, dur: 0.12, vol: 0.104, slide: 60 },
  // v2.9 新增：小猫专属喵叫。玩家点猫、或摸猫成功时触发。
  // 刻意与其它音效区分 —— 它是"猫"的声音，不该和方波提示音混在一起。
  cat_meow:         { tone: 'meow',   freq: 640, dur: 0.34, vol: 0.192, slide: 380, meow: true },
  cat_happy:        { tone: 'meow',   freq: 560, dur: 0.26, vol: 0.168, slide: 460, meow: true },
};

// ===========================================================================
// BGM 曲库（v2.10 可爱风重制）
//
// 用户反馈「背景音乐很拉跨」。复盘 v2.9 / v2.9.1 两版，问题不在音量，
// 而在**曲风与配器方向就错了**：
//   · 没有任何打击乐 → 没有「跳」的感觉，怎么调都像环境音乐；
//   · pad 是长音和声垫 → 听觉重心全压在低频，显闷；
//   · 旋律写成「相对和弦根音的半音表」→ 跟着和弦一起飘，不成调；
//   · 两首只在 bpm / 根音上不同 → 听感仍是同一首。
//
// 这一版按「可爱风（kawaii / cozy game music）」的四条通用做法重写：
//   1. **音色换成音乐盒 / 玩具钢琴**：主旋律走 bell（基频 + 2 次 + 3 次泛音，
//      快起音 + 长衰减）。这是「可爱」最直接的听觉符号。
//   2. **加轻打击乐**：沙锤（带通噪声）、木块（短促 triangle）、软底鼓（低频下滑）。
//      音量压到 0.03~0.09，只负责「弹跳感」，绝不抢旋律。
//   3. **旋律改成绝对音高写谱**（C4 = 0 的半音），不再跟着和弦根音走 —— 这样才有调。
//   4. **两首曲子用不同的拍号 / 速度 / 配器 / 有无鼓**：
//        大厅 = 3/4 慢圆舞曲（88 BPM，无鼓，音乐盒 + 弱 pad + 华尔兹贝斯）
//        局内 = 4/4 快板（128 BPM，摇摆八分，木块 + 沙锤 + 软鼓 + 断奏贝斯 + 和弦扫弦）
//      拍号不同 → 循环体感从根上不同，这是「两首真的不一样」最硬的保证。
//
// 曲式：两首都是 **16 小节**（大厅 96 步 / 局内 128 步），单圈 30 秒以上，
// 彻底避开 v2.9 那种「4 小节、20 秒就回到原点」的复读感。
// ===========================================================================

const C4 = 261.6255653;
/** 半音 → 频率（C4 = 0） */
const hz = (semi) => C4 * Math.pow(2, semi / 12);

/**
 * 把「[第几步, 音高] 事件表」摊成定长数组（null = 休止）。
 * 旋律用事件表写，比手写一长串 null 更接近谱面，也不容易数错拍。
 */
function seq(total, events) {
  const a = new Array(total).fill(null);
  for (const [step, note] of events) {
    if (step >= 0 && step < total) a[step] = note;
  }
  return a;
}

/**
 * 声部字段说明（全部可选）：
 *   wave / cut / vol / env —— 音色，走 _voiceAt 的 ADSR
 *   bell: true             —— 改用音乐盒音色（_bellAt），音长自动延到下一个音
 *   chord: true            —— 音符值 = 和弦音序号（0,1,2…，越界自动升八度）
 *   all: true              —— 该步一次奏出整个和弦（扫弦），值 = 升八度数
 *   rel: true              —— 音符值 = 相对和弦根音的半音数（贝斯用）
 *   以上都没有             —— 音符值 = 绝对半音（C4 = 0），旋律用
 *   oct                    —— 整体八度偏移
 *   dur                    —— 音长（单位：step）
 *   bar: [...]             —— 每小节重复的节奏型（长度 = stepsPerBar）
 *   song: [...]            —— 整曲不重复的音符表（长度 = bars × stepsPerBar）
 */
const TRACKS = {
  // ---------------- 大厅：音乐盒圆舞曲 ----------------
  home: {
    label: '音乐盒圆舞曲',
    bpm: 88,
    stepsPerBar: 6,   // 3/4 拍，1 step = 八分音符
    bars: 16,
    swing: 0,
    // 16 小节：C | Am | F | G | C | Em | F | G7 | Am | Em | F | C | Dm | G | C | G7
    prog: [
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 9, chord: [0, 3, 7] },       // Am
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 4, chord: [0, 3, 7] },       // Em
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 7, chord: [0, 4, 7, 10] },   // G7
      { root: 9, chord: [0, 3, 7] },       // Am
      { root: 4, chord: [0, 3, 7] },       // Em
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 2, chord: [0, 3, 7] },       // Dm
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 7, chord: [0, 4, 7] },       // G（第 16 小节不带七音：旋律落 E/C，挂 F 会顶出小九度）
    ],
    parts: {
      // 主旋律：音乐盒。每小节两个音（第 1、2 拍），留大量空气给和声
      lead: {
        bell: true, vol: 0.497,
        song: seq(96, [
          [0, 19], [3, 16], [6, 21], [9, 16], [12, 17], [15, 21], [18, 19], [21, 14],
          [24, 16], [27, 19], [30, 16], [33, 19], [36, 17], [39, 21], [42, 14], [45, 17],
          [48, 21], [51, 24], [54, 23], [57, 19], [60, 21], [63, 17], [66, 16], [69, 12],
          [72, 14], [75, 17], [78, 19], [81, 23], [84, 24], [87, 19], [90, 16], [93, 11],
        ]),
      },
      // 和声垫：每小节第 1 拍轻扫一次整组和弦并拖满整小节（可爱风里它必须很弱）
      pad: {
        wave: 'sine', cut: 1200, vol: 0.093, detune: 6, chord: true, all: true, oct: 0, dur: 6,
        env: { a: 0.14, d: 0.6, s: 0.5, r: 1.0 },
        bar: [0, null, null, null, null, null],
      },
      // 华尔兹贝斯：第 1 拍根音、第 3 拍五度（"嘭-恰-恰"的低音那一半）
      bass: {
        wave: 'triangle', cut: 720, vol: 0.298, rel: true, oct: -1, dur: 1.6,
        env: { a: 0.01, d: 0.26, s: 0.34, r: 0.5 },
        bar: [0, null, null, 7, null, null],
      },
      // 八音盒琶音：第 2、3 拍各一颗高音（"恰-恰"的另一半，音色与主旋律同族）
      arp: {
        bell: true, vol: 0.199, chord: true, oct: 1, dur: 0.9,
        bar: [null, null, 3, null, 4, null],
      },
    },
    // 圆舞曲的沙锤只在第 2、3 拍，极轻
    perc: { shaker: { vol: 0.124, bar: [0, 0, 1, 0, 1, 0] } },
  },

  // ---------------- 局内：轻快小曲 ----------------
  day: {
    label: '营业小快板',
    bpm: 128,
    stepsPerBar: 8,   // 4/4 拍，1 step = 八分音符
    bars: 16,
    swing: 0.06,      // 反拍往后推 6% —— 这点摇摆就是「跳」的来源
    // 16 小节：C | G | Am | F | C | G | F | G | Am | Em | F | C | Dm | G | C | G
    prog: [
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 9, chord: [0, 3, 7] },       // Am
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 9, chord: [0, 3, 7] },       // Am
      { root: 4, chord: [0, 3, 7] },       // Em
      { root: 5, chord: [0, 4, 7] },       // F
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 2, chord: [0, 3, 7] },       // Dm
      { root: 7, chord: [0, 4, 7] },       // G
      { root: 0, chord: [0, 4, 7] },       // C
      { root: 7, chord: [0, 4, 7] },       // G
    ],
    parts: {
      // 主旋律：音乐盒，八分音符为主，句尾留一口气
      lead: {
        bell: true, vol: 0.559,
        song: seq(128, [
          [0, 19], [2, 16], [4, 19], [6, 21], [8, 23], [10, 19], [12, 21], [14, 19],
          [16, 21], [18, 16], [20, 21], [22, 24], [24, 17], [26, 21], [28, 19],
          [32, 16], [34, 19], [36, 24], [38, 19], [40, 23], [42, 19], [44, 14], [46, 19],
          [48, 17], [50, 21], [52, 24], [54, 21], [56, 23], [58, 19], [60, 21],
          [64, 24], [66, 21], [68, 16], [70, 21], [72, 23], [74, 19], [76, 16], [78, 19],
          [80, 21], [82, 24], [84, 21], [86, 17], [88, 16], [90, 19], [92, 16], [94, 12],
          [96, 17], [98, 21], [100, 24], [102, 21], [104, 19], [106, 23], [108, 19], [110, 14],
          [112, 24], [114, 19], [116, 16], [118, 12], [120, 19], [122, 17], [124, 14],
        ]),
      },
      // 断奏贝斯：1、3 拍根音，2、4 拍五度 —— 蹦跳感的底盘
      bass: {
        wave: 'triangle', cut: 820, vol: 0.435, rel: true, oct: -1, dur: 0.7,
        env: { a: 0.006, d: 0.12, s: 0.28, r: 0.2 },
        bar: [0, null, 7, null, 0, null, 7, null],
      },
      // 和弦扫弦（尤克里里感）：2、4 拍轻扫一下，12ms 逐音错开
      stab: {
        wave: 'triangle', cut: 1700, vol: 0.155, chord: true, all: true, oct: 0, dur: 0.85,
        env: { a: 0.006, d: 0.09, s: 0.12, r: 0.16 },
        bar: [null, null, 0, null, null, null, 0, null],
      },
      // 反拍点缀：高音单颗，填补旋律空档
      arp: {
        bell: true, vol: 0.217, chord: true, oct: 1, dur: 0.6,
        bar: [null, 2, null, 1, null, 2, null, 3],
      },
    },
    // 轻打击乐：软底鼓 1/3 拍、木块 2/4 拍、沙锤反拍
    perc: {
      kick:  { vol: 0.217, bar: [1, 0, 0, 0, 1, 0, 0, 0] },
      block: { vol: 0.202,  bar: [0, 0, 1, 0, 0, 0, 1, 0] },
      shaker: { vol: 0.155, bar: [0, 1, 0, 1, 0, 1, 0, 1] },
    },
  },
};

const KEY = 'owk.audio.v1';
// v3：v2 的默认值（music 0.42 / sfx 0.45）是按「单薄 BGM + 刺耳音效」配的，
// PRESET 重做后必须重新配比：音乐是主体，给高一些；音效收敛，靠音色而非音量取胜。
const DEF = { music: true, sfx: true, musicVol: 0.7, sfxVol: 0.45 };
// v4：v2.9.1 彻底重写了 BGM 引擎（多声部编排换成了前瞻调度 + ADSR）。
// v5：v2.10 换成可爱风配器（音乐盒 + 打击乐 + 3/4 与 4/4 两首），
//     老存档的音量平衡是按旧配器调的，升级后必须重置，否则新曲子会带着旧的音量偏置。
const VER = 6;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.sfxFilter = null;   // 全局音效低通：所有音效统一再过一层柔化
    this.bgmBus = null;      // BGM 淡入淡出总线（切曲用，不碰玩家音量）
    this.state = { ...DEF };
    this.lastPlay = {};
    this.bgmTimer = null;
    this.bgmPadTimer = null;
    this.bgmStep = 0;
    this.bgmMode = null;
    this._bgmSwitchT = null;
    this._noise = null;
    this.rainNode = null;
    this.ducked = false;
    this.active = 0; // 同时播放的一次性音效计数（上限 4）
  }

  /** 首次用户手势后解锁 AudioContext（浏览器自动播放策略） */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._initNodes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.applyGains();
    // 解锁前调用过 setBgm 的场景（首屏直接 setBgm('home')）：这里补启，否则永远没 BGM（L21）
    if (this.bgmMode && !this.bgmTimer) this.startBgm(this.bgmMode);
  }

  /**
   * 建立节点图（v2.10 抽出成独立方法）
   *
   * 目的有二：
   *   1. unlock() 与「离线渲染工具」（tools/bgm-render.mjs 注入 OfflineAudioContext）共用同一套接线，
   *      避免渲染工具里再抄一份增益结构 —— 抄一份就一定会漂移。
   *   2. 新增 **bgmBus**：BGM 专用的淡入淡出总线。
   *      切曲时只动 bgmBus，不去动 musicGain（那是玩家在设置页控制的音量），
   *      两者分离后「换曲淡出」不会把玩家的音量设置改掉。
   *
   * 信号链：BGM 声部 → bgmBus → musicGain → master → destination
   *        音效 → sfxGain → sfxFilter(低通) → master
   */
  _initNodes() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicTarget();
    this.musicGain.connect(this.master);

    // BGM 淡入淡出总线：切曲时 0.22s 淡出 → 换曲 → 0.45s 淡入
    this.bgmBus = ctx.createGain();
    this.bgmBus.gain.value = 1;

    // 音乐限幅器（v2.11.1）：用户反馈「音乐太小、音效太大」。
    // 直接把各声部音量抬上去，峰值会先撞顶（音乐盒瞬态峰值是 RMS 的 8 倍），
    // 玩家把音乐音量拉到 100% 就会削波。这里放一个**只在顶部工作**的限幅：
    // 阈值 -6dB（0.5）以下完全透明，超过才快速压住，因此不会产生"抽气"感
    // （起音 2ms 只抓瞬态尖峰；若用慢起音反而会把底鼓整个压下去）。
    this.bgmComp = ctx.createDynamicsCompressor();
    this.bgmComp.threshold.value = -6;
    this.bgmComp.knee.value = 0;
    this.bgmComp.ratio.value = 20;
    this.bgmComp.attack.value = 0.002;
    this.bgmComp.release.value = 0.25;
    this.bgmBus.connect(this.bgmComp);
    this.bgmComp.connect(this.musicGain);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxTarget();
    // v2.9：音效总线上挂一个低通。即便某个 preset 忘了设 cutoff，
    // 也能兜住「刺耳」这个最直观的抱怨。
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass';
    this.sfxFilter.frequency.value = 5200;
    this.sfxFilter.Q.value = 0.4;
    this.sfxGain.connect(this.sfxFilter);
    this.sfxFilter.connect(this.master);
  }

  loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      const sameVer = raw.v === VER;
      for (const k of Object.keys(DEF)) {
        // 旧版本存档的音量沿用新默认值，避免升级后仍停留在旧平衡
        if (!sameVer && (k === 'musicVol' || k === 'sfxVol')) continue;
        if (typeof raw[k] === typeof DEF[k]) this.state[k] = raw[k];
      }
      this.state.musicVol = Math.max(0, Math.min(1, Number(this.state.musicVol)));
      this.state.sfxVol = Math.max(0, Math.min(1, Number(this.state.sfxVol)));
    } catch (e) { /* 损坏存档 → 用默认值 */ }
  }

  saveState() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VER, ...this.state })); } catch (e) { /* 静默降级 */ }
  }

  musicTarget() { return this.state.music ? (this.ducked ? this.state.musicVol * 0.25 : this.state.musicVol) : 0; }
  sfxTarget() { return this.state.sfx ? this.state.sfxVol : 0; }

  applyGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const ramp = (node, val, dur) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(val, t + dur);
    };
    ramp(this.musicGain, this.musicTarget(), 0.25);
    ramp(this.sfxGain, this.sfxTarget(), 0.1);
    if (this.rainNode) {
      ramp(this.rainNode.g, this.state.music ? this.state.musicVol * 0.38 : 0, 0.2);
    }
  }

  setMusic(on) {
    this.state.music = !!on;
    this.saveState();
    this.applyGains();
    if (!this.state.music) this.stopBgm();
    else {
      // 关音乐时可能刚好停在一半淡出（bgmBus=0），重开必须把总线拉回来，否则静音
      this._fadeBus(1, 0.2);
      if (this.bgmMode) this.startBgm(this.bgmMode);
    }
  }

  setSfx(on) {
    this.state.sfx = !!on;
    this.saveState();
    this.applyGains();
  }

  /**
   * 设置音乐音量
   * @param {number} v 0~1
   * @param {boolean} [save=true] 是否落盘。拖动滑杆时传 false（oninput 每帧都触发），
   *                              松手（onchange）再传 true，避免高频写 localStorage。
   */
  setMusicVolume(v, save = true) {
    this.state.musicVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (save) this.saveState();
    this.applyGains();
  }

  /**
   * 设置音效音量（同 setMusicVolume，save=false 时只改增益）
   * @param {number} v 0~1
   * @param {boolean} [save=true]
   */
  setSfxVolume(v, save = true) {
    this.state.sfxVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (save) this.saveState();
    this.applyGains();
  }

  /** 暂停时压低 BGM / 淡出雨声；恢复时还原 */
  duck(on) {
    this.ducked = !!on;
    this.applyGains();
    if (on) this.setRain(false);
  }

  /**
   * 单个音符：振荡器 + 低通滤波 + 增益包络。
   * 所有声音（音效与 BGM 声部）都走这里，保证音色统一、都被柔化过。
   */
  _voice(freq, wave, cutoff, vol, dur, slideTo) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.6;
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(60, slideTo), t + dur * 0.85);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.28), t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(f);
    f.connect(g);
    return { osc, g, dest: g, t, dur };
  }

  /** 合成一段音效（表现层） */
  play(name) {
    if (!this.state.sfx || !this.ctx || this.ctx.state !== 'running') return;
    const p = PRESET[name];
    if (!p) return;
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < 50) return; // 50ms 防抖
    this.lastPlay[name] = now;
    if (this.active >= 4) return; // 同时最多 4 个一次性音效
    this.active += 1;
    const tone = TONE[p.tone] || TONE.soft;
    try {
      const dur = p.dur;
      const endFreq = p.slide ? p.freq + p.slide : 0;
      if (p.meow) {
        // v2.9 小猫叫：两段式「咪—呜」+ 轻微颤音，比单纯滑音更像猫
        this._meow(p.freq, endFreq || p.freq * 1.5, dur, p.vol);
      } else {
        const v = this._voice(p.freq, tone.wave, tone.cutoff, p.vol, dur, endFreq);
        v.g.connect(this.sfxGain);
        v.osc.start(v.t);
        v.osc.stop(v.t + dur + 0.02);
      }
      if (p.cat) setTimeout(() => this._cat(), 120);
      if (p.tri) setTimeout(() => this._blip(900, 0.16), 180);
    } catch (e) { this.active = Math.max(0, this.active - 1); }
    // 统一在时长结束时释放并发计数（meow 分支内部也有定时器，但统一收口更安全）
    setTimeout(() => { this.active = Math.max(0, this.active - 1); }, (p.dur + 0.2) * 1000);
  }

  /**
   * v2.9 小猫叫：上行再下滑的两段式 + 颤音（vibrato）。
   * 单独抽出来是因为它要做三段调制，_voice 的单条滑音做不了。
   */
  _meow(f0, f1, dur, vol) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    // 颤音：给基频加一条 LFO，这是「喵」和「滑音」最关键的区别
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = TONE.meow.cutoff;
    f.Q.value = 0.8;
    osc.type = TONE.meow.wave;
    // 第一段：快速上滑到高音（咪）
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.3);
    // 第二段：下滑（呜），带一点回弹
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.85, t + dur * 0.85);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.95, t + dur);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(22, t);
    lfo.frequency.linearRampToValueAtTime(16, t + dur); // 颤音逐渐放缓，更像猫
    lfoGain.gain.value = f1 * 0.045;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.62);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  /** 订单完成的「喵~」点缀（保留旧行为，只是音色跟着变柔了） */
  _cat() {
    if (!this.ctx || !this.state.sfx) return;
    try {
      this._meow(600, 780, 0.2, 0.14);
    } catch (e) { /* 忽略 */ }
  }

  _blip(freq, dur) {
    if (!this.ctx || !this.state.sfx) return;
    try {
      const v = this._voice(freq, TONE.soft.wave, TONE.soft.cutoff, 0.1, dur, 0);
      v.g.connect(this.sfxGain);
      v.osc.start(v.t);
      v.osc.stop(v.t + dur + 0.02);
    } catch (e) { /* 忽略 */ }
  }

  /**
   * BGM：home / day 两首不同的曲子。
   * 音频上下文尚未解锁时 startBgm 会直接返回，但 bgmMode 已记下，unlock() 会补启（L21）。
   *
   * 调度仍是**单条前瞻定时器**（lookahead scheduler，v2.9.1 引入）：
   * 每 25ms 醒一次，把「下一个 step」提前 0.18s 排进 WebAudio 时间轴。
   * 两条独立 setInterval 会各自漂移、和声错位（"听着诡异"的根源），也会在标签页
   * 被节流后积压补发；单条调度器只有一个时间基准，永不错位。
   *
   * v2.10 在切换曲目时加了**淡出/淡入**（走 bgmBus，不碰玩家的 musicGain）：
   * 原来 stopBgm → startBgm 是硬切，大厅进局内会"啪"一下断掉，很廉价。
   */
  setBgm(mode) {
    const want = mode || null;
    if (this.bgmMode === want && this.bgmTimer) return; // 同一段已在播
    this.bgmMode = want;

    // 上下文还没解锁：只记下目标曲目，unlock() 会补启（L21）
    if (!this.ctx || !this.bgmBus) {
      this.stopBgm();
      if (want) this.startBgm(want);
      return;
    }

    this._fadeBus(0, 0.22);
    clearTimeout(this._bgmSwitchT);
    this._bgmSwitchT = setTimeout(() => {
      this.stopBgm();
      if (!want || !this.state.music) return;
      this.startBgm(want);
      this._fadeBus(1, 0.45);
    }, 230);
  }

  /** BGM 总线的淡入淡出（0~1）。只影响 BGM，不影响玩家设置的音量。 */
  _fadeBus(to, dur) {
    if (!this.ctx || !this.bgmBus) return;
    const t = this.ctx.currentTime;
    const g = this.bgmBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + dur);
  }

  startBgm(mode) {
    if (!this.ctx || !this.state.music || this.bgmTimer) return;
    const track = TRACKS[mode] || TRACKS.home;
    // ⚠ 时间单位：这里一律用**秒**（AudioContext 的时间轴就是秒）。
    // v2.10.0 曾把「一个八分音符 = 234」当成秒累加到 nextTime 上，
    // 于是第一个音之后 nextTime 直接跳到 234 秒后 —— 每次开音乐只响 2 个音就静音。
    // 那次事故的表现就是"点开关只有一瞬间有音乐"，且 v2.9.1 的"诡异/陷入循环"同源。
    const stepSec = 60 / track.bpm / 2;     // 一个八分音符（秒）
    const LOOKAHEAD = 0.18;                // 提前量（秒）
    const TICK = 25;                       // 定时器间隔（毫秒）
    // 循环长度由曲式决定：16 小节 × 每小节步数（大厅 96 / 局内 128）
    const totalSteps = track.bars * track.stepsPerBar;

    let step = 0;
    let nextTime = this.ctx.currentTime + 0.06;
    this.bgmStep = 0;

    this.bgmTimer = setInterval(() => {
      if (!this.state.music || !this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      // 一次可能排多个 step（标签页恢复后追赶），但有上限防止雪崩
      let guard = 0;
      while (nextTime < now + LOOKAHEAD && guard++ < 8) {
        this._scheduleStep(track, step, nextTime, stepSec);
        step = (step + 1) % totalSteps;
        nextTime += stepSec;
      }
      this.bgmStep = step;
    }, TICK);
    // 保留句柄语义：bgmPadTimer 不再需要，但置空以兼容 stopBgm 的旧调用
    this.bgmPadTimer = null;
  }

  /**
   * 排一个 step（v2.10）。
   *
   * @param {number} stepSec 一个 step 的时长，**单位秒**（与 t0 / AudioContext 时间轴一致）
   *
   * 与 v2.9.1 的区别：不再有写死的 pad/bass/arp/melody 四个数组，
   * 而是遍历 track.parts —— 每首曲子可以自由增减声部（大厅没有鼓、局内有三种鼓）。
   * 音符值的解释方式由声部字段决定（chord / rel / all / 绝对半音），见 TRACKS 上方说明。
   */
  _scheduleStep(track, step, t0, stepSec) {
    const spb = track.stepsPerBar;
    const bar = track.prog[Math.floor(step / spb) % track.prog.length];
    const inBar = step % spb;
    // 摇摆：把反拍往后推一点点（day 的「弹跳感」就来自这里）。
    // ⚠ 必须乘 stepSec（秒）。v2.10.0 乘的是毫秒，反拍被推迟了 14 秒。
    const at = (track.swing && inBar % 2 === 1) ? t0 + track.swing * stepSec : t0;

    for (const part of Object.values(track.parts)) {
      const pat = part.song || part.bar;
      if (!pat || !pat.length) continue;
      const v = pat[part.song ? step % pat.length : inBar];
      if (v == null) continue;
      const oct = (part.oct || 0) * 12;
      const dur = (part.dur != null ? part.dur : 1.6) * stepSec;
      const env = part.env || { a: 0.01, d: 0.2, s: 0.4, r: 0.3 };

      // ---- 扫弦：一次奏出整个和弦，12ms 逐音错开（尤克里里感）----
      if (part.all) {
        bar.chord.forEach((tone, i) => {
          this._voiceAt(hz(bar.root + tone + oct + 12 * v),
            part.wave || 'triangle', part.cut || 2000, part.vol, dur, at + i * 0.012, env);
        });
        continue;
      }

      // ---- 单音：chord = 和弦音序号 / rel = 相对根音 / 其余 = 绝对半音 ----
      let f;
      if (part.chord) {
        const semi = bar.chord[v % bar.chord.length] + 12 * Math.floor(v / bar.chord.length);
        f = hz(bar.root + semi + oct);
      } else if (part.rel) {
        f = hz(bar.root + v + oct);
      } else {
        f = hz(v + oct);
      }

      if (part.bell) {
        // 音乐盒：音长自动延到下一个音（谱面连音），上限 4 步，避免糊成一团
        const gap = this._gapToNext(pat, step, spb * track.bars);
        this._bellAt(f, at, part.vol, Math.min(4, gap) * stepSec * 0.92);
      } else {
        this._voiceAt(f, part.wave || 'sine', part.cut || 2400, part.vol, dur, at, env);
      }
    }

    // ---- 打击乐 ----
    const pc = track.perc;
    if (pc) {
      if (pc.kick && pc.kick.bar && pc.kick.bar[inBar]) this._kick(at, pc.kick.vol);
      if (pc.block && pc.block.bar && pc.block.bar[inBar]) this._tick(at, 1040, pc.block.vol, 0.055);
      if (pc.shaker && pc.shaker.bar && pc.shaker.bar[inBar]) this._shaker(at, pc.shaker.vol);
    }
  }

  /** 到下一个非休止音还差几步（用于音乐盒的自动连音长度） */
  _gapToNext(pat, step, total) {
    const len = pat.length || total;
    for (let d = 1; d <= 8; d++) {
      if (pat[(step + d) % len] != null) return d;
    }
    return 4;
  }

  /**
   * 音乐盒 / 八音盒音色（v2.10 新增）。
   * 基频 + 2 次 + 3 次泛音三层叠加，快起音 + 长指数衰减 —— 这是「可爱」最直接的音色符号。
   * 三个泛音共用一条低通，避免 3 次泛音在高音区发尖。
   */
  _bellAt(freq, t, vol, dur) {
    try {
      const nodes = [];
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 6200;
      f.Q.value = 0.4;
      f.connect(this.bgmBus || this.musicGain);

      // [倍频, 相对音量]；2.0 / 3.01 是八音盒金属簧片的近似泛音比
      for (const [mul, amp] of [[1, 1], [2.0, 0.45], [3.01, 0.22]]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq * mul, t);
        const d = mul === 1 ? dur : dur * 0.55;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, vol * amp), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g);
        g.connect(f);
        o.start(t);
        o.stop(t + d + 0.02);
        nodes.push([o, g]);
      }
      const last = nodes[nodes.length - 1][0];
      last.onended = () => {
        for (const [, g] of nodes) { try { g.disconnect(); } catch (e) { /* 已断开 */ } }
        try { f.disconnect(); } catch (e) { /* 已断开 */ }
      };
      return true;
    } catch (e) { return false; }
  }

  /** 沙锤：带通噪声，60ms 衰减（可爱风的"沙沙"律动） */
  _shaker(t, vol) {
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf();
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4200;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 7200;
      bp.Q.value = 1.1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(hp); hp.connect(bp); bp.connect(g);
      g.connect(this.bgmBus || this.musicGain);
      src.start(t, Math.random() * 1.5);
      src.stop(t + 0.09);
      src.onended = () => { try { g.disconnect(); hp.disconnect(); bp.disconnect(); } catch (e) { /* 已断开 */ } };
    } catch (e) { /* 忽略 */ }
  }

  /** 木块：短促 triangle（"笃"），2、4 拍用 */
  _tick(t, freq, vol, dur) {
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 5000;
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.82, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g);
      g.connect(this.bgmBus || this.musicGain);
      o.start(t);
      o.stop(t + dur + 0.02);
      o.onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) { /* 已断开 */ } };
    } catch (e) { /* 忽略 */ }
  }

  /** 软底鼓：150Hz 快速下滑到 52Hz，只有 160ms —— 给"蹦跳"一个落点，不是舞曲那种重鼓 */
  _kick(t, vol) {
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 520;
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(f); f.connect(g);
      g.connect(this.bgmBus || this.musicGain);
      o.start(t);
      o.stop(t + 0.18);
      o.onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) { /* 已断开 */ } };
    } catch (e) { /* 忽略 */ }
  }

  /** 噪声源缓冲（2 秒，懒创建并复用；每次 start 随机取偏移，听感不重复） */
  _noiseBuf() {
    if (this._noise) return this._noise;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /**
   * 带 ADSR 的音符（v2.9.1 新增）。
   * 与 `_voice` 的区别：可指定起始时间（未来时刻）、有明确的 sustain 段、可失谐。
   * BGM 所有声部都走这里；音效仍用 `_voice`（一次性、无需 sustain）。
   *
   * @param {number} detune 失谐（cents）。pad 用极小的失谐（3~8）让纯音"活"起来，
   *                         同时因为两个osc 不同步，正好抵消纯同度齐奏的驻波。
   */
  _voiceAt(freq, wave, cutoff, vol, dur, t0, opt = {}) {
    try {
      const t = t0;
      const a = opt.a ?? 0.01, d = opt.d ?? 0.2, s = opt.s ?? 0.4, r = opt.r ?? 0.3;
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      f.Q.value = 0.5;
      g.connect(f);
      // v2.10：BGM 声部统一走 bgmBus（切曲淡入淡出），音效仍走 sfxGain
      f.connect(this.bgmBus || this.musicGain);

      const mk = (detCents) => {
        const o = this.ctx.createOscillator();
        o.type = wave;
        o.frequency.setValueAtTime(freq, t);
        if (detCents) o.detune.setValueAtTime(detCents, t);
        o.connect(g);
        return o;
      };
      const oscs = opt.detune ? [mk(-opt.detune), mk(opt.detune)] : [mk(0)];

      // ADSR：attack → decay到 sustain → 收尾时 release 到 0
      const peak = Math.max(0.0001, vol);
      const sus = Math.max(0.0001, peak * s);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.linearRampToValueAtTime(sus, t + a + d);
      const off = t + Math.max(a + d + 0.02, dur);
      g.gain.setValueAtTime(sus, off);
      g.gain.exponentialRampToValueAtTime(0.0001, off + r);

      for (const o of oscs) { o.start(t); o.stop(off + r + 0.02); }
      // 最后一个 osc 结束时自动断链，避免节点堆积
      oscs[oscs.length - 1].onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) {} };
      return true;
    } catch (e) { return false; }
  }

  stopBgm() {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
    if (this.bgmPadTimer) { clearInterval(this.bgmPadTimer); this.bgmPadTimer = null; }
  }

  /** 雨声环境（噪声源） */
  setRain(on) {
    if (!this.ctx) return;
    if (on && !this.rainNode) {
      try {
        const bufferSize = 2 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.25;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = this.state.music ? this.state.musicVol * 0.38 : 0;
        src.connect(g);
        g.connect(this.master);
        src.start();
        this.rainNode = { src, g };
      } catch (e) { /* 忽略 */ }
    } else if (!on && this.rainNode) {
      try {
        const { src, g } = this.rainNode;
        const t = this.ctx.currentTime;
        g.gain.linearRampToValueAtTime(0, t + 0.8);
        setTimeout(() => { try { src.stop(); } catch (e) {} }, 900);
      } catch (e) { /* 忽略 */ }
      this.rainNode = null;
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
}

export const audio = new AudioManager();

// 供离线渲染工具（tools/bgm-render.mjs）复用。
// 渲染必须用**同一份曲谱与音高换算**，否则「试听文件」和「游戏里听到的」会变成两首不同的曲子。
export { TRACKS, hz, DEF, PRESET };