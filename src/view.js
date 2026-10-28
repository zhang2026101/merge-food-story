// 食合物语 —— 视图层（DOM + 拖拽 + 面板）
import { icon, customerSVG, catSVG, riderSVG } from './art.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// v2.9：小猫气泡的内置冷却（毫秒）。防止玩家连点刷屏。
const CAT_BUBBLE_CD_MS = 5000;

export class View {
  constructor(ctx, game, stage) {
    this.ctx = ctx;
    this.game = game;
    this.stage = stage;
    this.t = ctx.t;
    this.custEls = new Map();
    this.selected = null;
    this.modalActions = null;
    this.drag = null;
    this.lastIngClick = 0;
    this.lastIngKey = '';
    this.tutTargets = [];
    this.lastTrashLabel = '';
    // 局外猫猫币与皮肤（由启动器注入并持久化）
    this.catStore = { coins: 0, owned: ['orange'], skin: 'orange' };
    this.catSkinApplied = '';
    this.lastPet = 0;
    // v2.9.1：气泡冷却时间戳 / 文案轮换游标 / 上次说的话
    // lastSay 用 -Infinity 表示「从未说过」——初值 0 会让开局前 5 秒都判为冷却中，
    // 玩家第一次点猫就会看到「让我歇一小会儿」，看起来像功能坏了。
    this.lastSay = -Infinity;
    this.sayCursor = 0;
    this.lastCatLine = '';
    this.bubbleTimer = null;
  }

  // ============================================================ mount
  mount() {
    this.stage.innerHTML = `
      <div id="screen-menu" class="screen"></div>
      <div id="screen-game" class="screen hidden">
        <header class="hud" id="hud">
          <div class="hud-left">
            <div class="coin-pill">${icon('coin')}<b id="hud-coins">0</b></div>
            <div class="coin-pill cat-pill" title="${this.t('cat.title')}">${icon('catcoin')}<b id="hud-cat">0</b></div>
            <div class="hud-day">
              <span id="hud-week"></span><i class="sep"></i><span id="hud-day"></span>
              <span class="mode-tag" id="hud-mode"></span>
            </div>
            <div class="day-timer" id="day-timer">
              <span class="dt-label">${this.t('hud.operating')}</span>
              <b id="dt-time">01:30</b>
              <i class="dt-bar"><em id="dt-fill"></em></i>
            </div>
            <div class="combo-pill" id="hud-combo"></div>
          </div>
          <div class="hud-right">
            <button class="act" data-act="recipe">${icon('book')}<span>${this.t('recipe.toggle')}</span></button>
            <button class="act" data-act="upgrade">${icon('up')}<span>${this.t('upgrade.title')}</span></button>
            <button class="act" data-act="pause">${icon('pause')}<span>${this.t('pause.title')}</span></button>
          </div>
        </header>

        <main class="board">
          <section class="queue" id="queue">
            <div class="queue-bg" aria-hidden="true">
              <div class="qb-pennant"></div>
              <div class="qb-plant">${View.plantArt()}</div>
              <div class="qb-floor"></div>
              <div class="wx-layer" id="wx-layer"></div>
            </div>
            <div class="qb-board wx-board" id="wx-board" title="">
              <span class="wx-ic" id="wx-ic"></span>
              <b id="wx-name"></b>
              <i id="wx-desc"></i>
            </div>
            <div class="phone" id="phone" data-drop="delivery" data-act="phone" title="${this.t('delivery.hint')}">
              <div class="phone-screen" id="phone-screen"></div>
            </div>
            <div id="tut-banner" class="tut-banner hidden">
              <span id="tut-text"></span>
              <button class="link" data-act="skip-tut">${this.t('tutorial.skip')}</button>
            </div>
            <div class="cust-row" id="cust-row"></div>
            <div class="cat" id="cat" data-act="pet-cat" title="${this.t('cat.hint')}">
              <span class="cat-heart" id="cat-heart"></span>
              <span class="cat-svg" id="cat-svg"></span>
            </div>
            <!-- v2.9.1：气泡独立成 .queue 的直接子元素。
                 v2.9 初版把它放在 .cat 内部，但 .cat 带着 petting 动画的 transform，
                 会自建层叠上下文，导致气泡被同级 .cust-row(z-index:1) 整个盖住 ——
                 现象是「有内容、有 class、有尺寸，却看不见」。 -->
            <div class="cat-bubble" id="cat-bubble"></div>
            <div class="rider hidden" id="rider" data-drop="delivery" data-act="rider" title="${this.t('delivery.hand')}"></div>
          </section>
          <section class="op" id="operation">
            <div class="stations" id="stations"></div>
            <div class="shelf" id="shelf">
              <div class="store">
                <div class="row-head"><span>${this.t('storage.title')}</span><em id="storage-count"></em></div>
                <div class="slots" id="storage-slots" data-drop="storage"></div>
              </div>
              <div class="trash" id="trash" data-drop="trash">
                <span class="trash-ic" id="trash-ic">${icon('trash')}</span>
                <span class="trash-lv" id="trash-lv"></span>
                <span class="trash-tip" id="trash-tip"></span>
              </div>
            </div>
          </section>
        </main>

        <section id="ingredients" class="ings"></section>

        <div id="recipe-panel" class="panel hidden"></div>
        <div id="upgrade-panel" class="panel hidden"></div>
      </div>

      <div id="toasts" class="toasts"></div>
      <div id="modal" class="modal hidden"></div>`;

    this.el = {
      menu: $('#screen-menu'),
      game: $('#screen-game'),
      hud: $('#hud'),
      coins: $('#hud-coins'),
      week: $('#hud-week'),
      day: $('#hud-day'),
      mode: $('#hud-mode'),
      combo: $('#hud-combo'),
      timer: $('#day-timer'),
      timerTime: $('#dt-time'),
      timerFill: $('#dt-fill'),
      catcoin: $('#hud-cat'),
      cat: $('#cat'),
      catSvg: $('#cat-svg'),
      catHeart: $('#cat-heart'),
      catBubble: $('#cat-bubble'),
      queue: $('#queue'),
      custRow: $('#cust-row'),
      op: $('#operation'),
      stations: $('#stations'),
      storage: $('#storage-slots'),
      storageCount: $('#storage-count'),
      shelf: $('#shelf'),
      wxBoard: $('#wx-board'),
      wxIc: $('#wx-ic'),
      wxName: $('#wx-name'),
      wxDesc: $('#wx-desc'),
      wxLayer: $('#wx-layer'),
      phone: $('#phone'),
      phoneScreen: $('#phone-screen'),
      rider: $('#rider'),
      trash: $('#trash'),
      trashIc: $('#trash-ic'),
      trashLv: $('#trash-lv'),
      trashTip: $('#trash-tip'),
      ings: $('#ingredients'),
      recipe: $('#recipe-panel'),
      upgrade: $('#upgrade-panel'),
      tut: $('#tut-banner'),
      tutText: $('#tut-text'),
      toasts: $('#toasts'),
      modal: $('#modal'),
    };

    this.applyLayout();
    this.buildStations();
    this.buildIngredients();
    this.bindEvents();
  }

  applyLayout() {
    const L = this.ctx.layout || {};
    const sz = L.sizing || {};
    const root = document.documentElement.style;
    const px = (k, v) => { if (v != null) root.setProperty(k, v + 'px'); };
    px('--hud-h', sz.hudH);
    px('--op-w', sz.opW);
    px('--shelf-h', sz.shelfH);
    px('--ings-h', sz.ingsH);
    px('--gap', sz.gap);
    px('--pad', sz.pad);
    px('--slot', sz.stationSlot);
    px('--store-slot', sz.storeSlot);
    const cols = sz.ingCols || 8;
    if (this.el.ings) this.el.ings.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 168px))`;
    const h = (L.fit && L.fit.height) || 660;
    this.stage.style.height = h + 'px';
  }

  buildStations() {
    const make = (key, name) => `
      <div class="station" data-station="${key}" data-drop="station" data-act-station="${key}">
        <div class="st-head">
          <span class="st-name">${name}</span>
          <span class="st-lv" data-lv="${key}">Lv1</span>
        </div>
        <div class="st-body">
          <div class="slot in" data-drop="input" data-station="${key}" data-index="0" data-slot="in0"></div>
          <div class="slot-plus">+</div>
          <div class="slot in" data-drop="input" data-station="${key}" data-index="1" data-slot="in1"></div>
          <div class="slot-arrow">→</div>
          <div class="slot out" data-drop="output" data-slot="out" data-station="${key}"></div>
        </div>
        <div class="st-bar"><i data-bar-station="${key}"></i></div>
      </div>`;
    this.el.stations.innerHTML =
      make('food', this.t('station.food')) +
      make('drink', this.t('station.drink'));
  }

  buildIngredients() {
    const names = Object.keys(this.ctx.config.ingredients);
    this.el.ings.innerHTML = names.map((k) => `
      <button class="ing" data-ing="${k}" data-tut="ing-${k}">
        <span class="ing-ic">${icon(k)}</span>
        <span class="ing-meta"><b>${this.t('ing.' + k)}</b><i>¥${this.ctx.config.ingredients[k]}</i></span>
      </button>`).join('');
  }

  // ============================================================ events
  bindEvents() {
    const stage = this.stage;
    stage.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    // 指针移动/抬起挂在 window：手指或鼠标移出舞台后再松手，也一定能结束拖拽（M13）。
    // 若只挂 stage，pointerup 落在舞台外就收不到，ghost 与 this.drag 会永久残留。
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
    stage.addEventListener('contextmenu', (e) => e.preventDefault());

    stage.addEventListener('click', (e) => this.onClick(e));
  }

  stagePoint(e) {
    const r = this.stage.getBoundingClientRect();
    // 舞台逻辑宽度是自适应的（1120~1551），必须用布局宽度换算，不能写死
    const logicalW = this.stage.offsetWidth || 1120;
    const scale = r.width / logicalW;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  onClick(e) {
    if (!e.target.closest('#screen-game')) return; // 菜单层点击不干扰游戏内面板
    const act = e.target.closest('[data-act]');
    if (act) { this.handleAct(act, e); return; }
    const ing = e.target.closest('[data-ing]');
    if (ing) { this.clickIngredient(ing.dataset.ing); return; }
    if (e.target.closest('[data-item]')) return;

    // 面板内部（含面板背景）的点击到此为止：面板自己绑定了按钮，剩下的是空白区
    if (e.target.closest('.panel')) return;
    // 点击面板外区域顺手收起抽屉
    if (!this.el.recipe.classList.contains('hidden')) this.closeRecipe();
    if (!this.el.upgrade.classList.contains('hidden')) this.closeUpgrade();

    // 点选交付
    const cust = e.target.closest('[data-drop="customer"]');
    if (cust && this.selected) {
      const r = this.game.moveItem(this.selected, { zone: 'customer', customerId: cust.dataset.customer });
      if (!r.ok) this.fail(r.reason);
      this.clearSelection();
      this.render();
      return;
    }
    const slot = e.target.closest('[data-drop]');
    if (slot && this.selected) {
      const zone = slot.dataset.drop;
      let dst = null;
      if (zone === 'storage' || zone === 'trash') dst = { zone };
      else if (zone === 'delivery') {
        const d = (this.game.s.deliveries || []).find((x) => x.status === 'rider_arrived');
        dst = { zone: 'delivery', deliveryId: d ? d.id : 0 };
      }
      else if (zone === 'input') dst = { zone: 'input', station: slot.dataset.station, index: Number(slot.dataset.index) };
      else if (zone === 'station' || zone === 'output') dst = { zone: 'input', station: slot.dataset.station };
      if (dst) {
        // v2.9：与拖拽一致 —— 点选后点工位也要提示「这是甜品台哦」
        const moved = this.game.itemAt(this.selected);
        if (moved && dst.zone === 'input' && dst.station) {
          const mis = this.game.stationMismatch(moved.key, dst.station);
          if (mis && mis.reason === 'wrongStation') {
            this.fail('wrongStation', null, mis);
            this.clearSelection();
            this.render();
            return;
          }
        }
        const r = this.game.moveItem(this.selected, dst);
        if (!r.ok) this.fail(r.reason);
        this.clearSelection();
        this.render();
        return;
      }
    }
    const st = e.target.closest('[data-act-station]');
    if (st && !e.target.closest('[data-item]')) this.game.setStation(st.dataset.actStation);
  }

  /** 音效（表现层） */
  sfx(name) {
    const a = window.__OWK_AUDIO__;
    if (a) a.play(name);
  }

  clickIngredient(key) {
    const now = performance.now();
    // 80ms 去抖：仅拦截「同一食材键」的连点，避免误触双投
    if (key === this.lastIngKey && now - this.lastIngClick < 80) return;
    this.lastIngKey = key;
    this.lastIngClick = now;
    // 食材键在视觉上是键帽（--keycap-*），按下先给 keycap 手感音，再由 ok/wrong 区分结果
    this.sfx('keycap');
    const r = this.game.addIngredient(key);
    if (!r.ok) { this.fail(r.reason); this.sfx('ingredient_wrong'); }
    else this.sfx('ingredient_ok');
    // 教学期间配方书展开后，一旦开始投料就收起，避免挡住工位
    if (this.game.s.tutorial.active && !this.el.recipe.classList.contains('hidden')) this.closeRecipe();
    this.render();
  }

  handleAct(el, e) {
    e.preventDefault();
    const act = el.dataset.act;
    this.sfx('ui_click');
    if (act === 'recipe') this.toggleRecipe();
    else if (act === 'upgrade') this.openUpgrade();
    else if (act === 'pause') this.togglePause();
    else if (act === 'dismiss') { this.game.dismiss(el.dataset.customer); this.render(); }
    else if (act === 'close-recipe') this.closeRecipe();
    else if (act === 'close-upgrade') this.closeUpgrade();
    else if (act === 'skip-tut') { this.game.skipTutorial(); this.closeRecipe(); this.render(); }
    else if (act === 'upgrade-dev') { this.doUpgrade(el.dataset.dev); }
    else if (act === 'pet-cat') this.petCat();
    else if (act === 'phone') this.phoneAction();
    else if (act === 'rider') this.riderAction();
    else if (act === 'ach') this.openAch();
    else if (act === 'resume') { this.closeModal(); if (this.game.s.paused) this.game.togglePause(); this.render(); }
  }

  doUpgrade(dev) {
    const r = this.game.upgrade(dev);
    if (r.ok) {
      const name = { stove: this.t('upgrade.stove'), counter: this.t('upgrade.counter'), sign: this.t('upgrade.sign'), trash: this.t('upgrade.trash') }[dev];
      const refundTxt = r.refund > 0 ? `　${this.t('upgrade.refund', { n: r.refund })}` : `　${this.t('upgrade.noRefundFirst')}`;
      this.toast(`${name} → Lv${r.lv}　-${r.cost}${refundTxt}`);
    } else if (r.reason === 'coins') {
      this.toast(this.t('cost.short'));
    } else if (r.reason === 'max') {
      this.toast(this.t('upgrade.max'));
    }
    // render() 里已包含「升级面板开着就重绘」，不再单独调 renderUpgrade()（重复重建 DOM）
    this.render();
  }

  // ---------------------------------------------------------------- drag
  /**
   * 按下物品：只登记「可能开始拖拽」的起点。
   * - 过滤非左键 / 非主指针，避免右键菜单与多指触摸误触发（L16）
   * - 不在这里 preventDefault：否则 pointerdown 会吞掉焦点，键盘可达性变差（U1）
   * - 结束拖拽依赖 window 上的 pointerup（见 bindEvents），移出舞台松手也能收尾（M13）
   */
  onDown(e) {
    if (e.button !== 0 || e.isPrimary === false) return;
    // v2.9：食材键也能拖了。原先这里只认 [data-item]，而食材键是 [data-ing]，
    // 导致「食材只能点击、不能拖」—— 实测确认 ing 按钮内没有任何 data-item。
    // 食材不占物品格（不在 storage / input / output 里），所以用 kind:'ing' 区分来源，
    // 落地时走 engine.addIngredient(ingKey, station, index) 而不是 moveItem。
    const ingEl = e.target.closest('[data-ing]');
    const itemEl = e.target.closest('[data-item]');
    let src = null;
    if (itemEl) {
      src = {
        zone: itemEl.dataset.zone,
        station: itemEl.dataset.station || undefined,
        index: itemEl.dataset.index === '' || itemEl.dataset.index == null ? undefined : Number(itemEl.dataset.index),
      };
    } else if (ingEl) {
      src = { kind: 'ing', ing: ingEl.dataset.ing };
    }
    if (!src) return;
    if (e.target.closest('[data-act]')) return;
    this.drag = { src, el: itemEl || ingEl, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
      d.moved = true;
      // 确认进入拖拽态后才阻止默认行为（避免长按选中/滚动，同时不干扰单纯点击）
      if (e.cancelable) e.preventDefault();
      // v2.9：配方书 / 升级面板会自动弹出并**浮在灶台上方**（实测 elementFromPoint
      // 落在 .rcp-panel 上），把食材拖到灶台会被它整个挡掉。
      // 既然已经开始拖拽，面板就必然挡住目标，先收起再拖。
      if (!this.el.recipe.classList.contains('hidden')) this.closeRecipe();
      if (!this.el.upgrade.classList.contains('hidden')) this.closeUpgrade();
      const g = document.createElement('div');
      g.className = 'ghost';
      // 食材来源没有 .item 包裹，直接复制按钮 innerHTML 会把整块「名称+价格」也带上，
      // 幽灵框会变得很大且和成品幽灵大小不一致。只取图标。
      g.innerHTML = d.src.kind === 'ing'
        ? `<span class="ic">${icon(d.src.ing)}</span>`
        : d.el.innerHTML;
      this.stage.appendChild(g);
      d.ghost = g;
      d.el.classList.add('dragging');
    }
    if (e.cancelable) e.preventDefault();
    const p = this.stagePoint(e);
    d.ghost.style.left = p.x + 'px';
    d.ghost.style.top = p.y + 'px';
    this.highlightDrop(e.clientX, e.clientY);
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.moved) {
      if (d.src.kind === 'ing') {
        // 食材键单击 = 投放到它自己的工位（v2.9 前只有这一条路，现在拖拽也能到）
        this.clickIngredient(d.src.ing);
        return;
      }
      // 单击：输入槽 = 撤回；其余 = 选中，等待点顾客/槽位
      if (d.src.zone === 'input') {
        const r = this.game.recallInput(d.src.station, d.src.index);
        if (!r.ok) this.fail(r.reason);
        this.render();
      } else {
        this.selectItem(d.src, d.el);
      }
      return;
    }
    d.ghost && d.ghost.remove();
    d.el.classList.remove('dragging');
    this.clearHighlight();

    const hit = this.dropTargetAt(e.clientX, e.clientY);
    const target = hit;
    if (!target) return; // 丢在空处：状态没变，不需要重绘
    const zone = target.dataset.drop;

    // v2.9：食材拖放 —— 落点是灶台/输入格才接；丢到垃圾桶等其它区一律忽略
    // （食材不能进垃圾桶：丢弃走的是「先投料再撤回」这条既有路径）
    if (d.src.kind === 'ing') {
      let station = null, index = undefined;
      if (zone === 'input') { station = target.dataset.station; index = Number(target.dataset.index); }
      else if (zone === 'station') station = target.dataset.station;
      else if (zone === 'output') station = target.dataset.station;
      if (!station) return;
      this.sfx('keycap');
      const r = this.game.addIngredient(d.src.ing, station, index);
      if (!r.ok) this.fail(r.reason, d.el, r);
      else this.sfx('ingredient_ok');
      // 教学期间配方书展开后，一旦开始投料就收起，避免挡住工位
      if (this.game.s.tutorial.active && !this.el.recipe.classList.contains('hidden')) this.closeRecipe();
      this.render();
      return;
    }

    let dst = null;
    if (zone === 'customer') dst = { zone: 'customer', customerId: target.dataset.customer };
    else if (zone === 'input') dst = { zone: 'input', station: target.dataset.station, index: Number(target.dataset.index) };
    else if (zone === 'station') dst = { zone: 'input', station: target.dataset.station };
    else if (zone === 'output') dst = { zone: 'input', station: target.dataset.station };
    else if (zone === 'storage' || zone === 'trash') dst = { zone };
    else if (zone === 'delivery') {
      const d2 = (this.game.s.deliveries || []).find((x) => x.status === 'rider_arrived');
      dst = { zone: 'delivery', deliveryId: d2 ? d2.id : 0 };
    }
    if (!dst) return;

    // v2.9：物品（半成品/成品）拖到不对的灶台时，先做一次前置检查并给可爱提示。
    // 放在这里而不是靠 moveItem 返回值，是因为 moveItem 对「类型不合」
    // 只会合成出失败品（合法但玩家难以理解），不该默默吃掉用户的意图。
    const moved = this.game.itemAt(d.src);
    if (moved && dst.zone === 'input' && dst.station) {
      const mis = this.game.stationMismatch(moved.key, dst.station);
      // 只有「工位归属不对」才拦；busy / outputOccupied 等交给 moveItem 走既有文案
      if (mis && mis.reason === 'wrongStation') {
        this.fail('wrongStation', d.el, mis);
        this.clearSelection();
        this.render();
        return;
      }
    }

    let r;
    try {
      r = this.game.moveItem(d.src, dst);
    } catch (err) {
      // 引擎为「配置缺失」这类问题选择显式抛错（如 deliverySettleMs），
      // 视图必须兜住并给出可读提示，否则玩家只会看到「拖了没反应」
      console.error('[OWK] 拖拽操作失败', err);
      r = { ok: false, reason: 'configError' };
    }
    if (!r.ok) this.fail(r.reason, d.el, r);
    // 拖拽结束等于「这次选中已用掉」：不清会把旧选中留在 this.selected 里，
    // 下一次点顾客/槽位就会拿它再交付一次（S5 误交付）
    this.clearSelection();
    this.render();
  }

  cancelDrag() {
    if (!this.drag) return;
    if (this.drag.ghost) this.drag.ghost.remove();
    if (this.drag.el) this.drag.el.classList.remove('dragging');
    this.drag = null;
    this.clearHighlight();
  }

  /**
   * v2.9：查找指针下的放置目标。
   * `document.elementFromPoint` 会命中**随手指移动的 .ghost**（它虽然
   * `pointer-events:none`，但在部分浏览器/测试驱动下仍可能被返回）。
   * 直接用它会导致「拖到了灶台上，却什么都没发生」。
   * 这里逐层向上找，遇到 ghost 或非放置区就跳过，命中真正的 [data-drop]。
   */
  dropTargetAt(x, y) {
    let el = document.elementFromPoint(x, y);
    let guard = 0;
    while (el && guard++ < 6) {
      if (el.classList && el.classList.contains('ghost')) { el = null; continue; }
      const t = el.closest ? el.closest('[data-drop]') : null;
      if (t) return t;
      el = el.parentElement;
    }
    // 兜底：ghost 正下方若压着某个槽位，按几何命中它
    if (this.drag && this.drag.ghost) {
      const r = this.drag.ghost.getBoundingClientRect();
      const under = document.elementsFromPoint(x, y)
        .find((e) => !(e.classList && e.classList.contains('ghost')));
      const cand = under && under.closest ? under.closest('[data-drop]') : null;
      if (cand) return cand;
      if (r.width) {
        const pool = this.stage.querySelectorAll('[data-drop]');
        for (const c of pool) {
          const cr = c.getBoundingClientRect();
          if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) return c;
        }
      }
    }
    return null;
  }

  highlightDrop(x, y) {
    this.clearHighlight();
    const t = this.dropTargetAt(x, y);
    if (t) t.classList.add('drop-hot');
  }

  clearHighlight() {
    $$('.drop-hot', this.stage).forEach((e) => e.classList.remove('drop-hot'));
  }

  selectItem(src, el) {
    this.selected = src;
    $$('.item.sel', this.stage).forEach((e) => e.classList.remove('sel'));
    el && el.classList.add('sel');
  }

  clearSelection() {
    this.selected = null;
    $$('.item.sel', this.stage).forEach((e) => e.classList.remove('sel'));
  }

  // ============================================================ render
  render() {
    const s = this.game.s;
    if (!s || !this.el) return;
    if (s.phase === 'day' && !this.el.game.classList.contains('hidden')) this.syncTutorial();

    this.el.coins.textContent = Math.round(s.coins);
    this.el.catcoin.textContent = this.catStore.coins;
    this.applyCatSkin();
    this.el.week.textContent = this.t('hud.week', { n: s.week });
    this.el.day.textContent = this.t('hud.day', { n: s.day });
    // 先算教学高亮目标，再渲染食材/工位，避免高亮慢一帧
    this.renderTutorialBanner();
    this.el.mode.textContent = this.t(s.mode === 'hard' ? 'difficulty.hard' : 'difficulty.normal');
    this.el.combo.textContent = `${this.t('combo.title')} ×${s.combo}`;
    this.el.combo.classList.toggle('on', s.combo > 0);

    this.renderWeather();
    this.renderPhone();
    this.renderStations();
    this.renderStorage();
    this.renderIngredients();
    this.renderTrash();
    this.renderCustomers();
    if (!this.el.upgrade.classList.contains('hidden')) this.renderUpgrade();
    if (!this.el.recipe.classList.contains('hidden')) this.renderRecipe();
    // 重建 DOM 会丢掉 .sel，选中态必须按位置重放，否则「看起来没选中、实际已选中」
    this.applySelection();
  }

  /** 按 this.selected 的位置描述，在重建后的 DOM 上重新标记选中态（S5） */
  applySelection() {
    $$('.item.sel', this.stage).forEach((e) => e.classList.remove('sel'));
    const sel = this.selected;
    if (!sel || !sel.zone) return;
    const sel2 = `.item[data-zone="${sel.zone}"]`
      + (sel.station ? `[data-station="${sel.station}"]` : '')
      + `[data-index="${sel.index == null ? '' : sel.index}"]`;
    const el = $(sel2, this.stage);
    if (el) el.classList.add('sel');
  }

  itemHTML(item, loc) {
    const kind = this.ctx.kindOf(item.key);
    return `<div class="item ${kind}" data-item data-zone="${loc.zone}" data-station="${loc.station || ''}" data-index="${loc.index == null ? '' : loc.index}">
      ${icon(item.key)}
    </div>`;
  }

  renderStations() {
    const s = this.game.s;
    for (const key of ['food', 'drink']) {
      const st = s.stations[key];
      const panel = $(`.station[data-station="${key}"]`, this.el.stations);
      panel.classList.toggle('sel', s.selectedStation === key);
      const lv = $('.st-lv', panel);
      lv.textContent = 'Lv' + s.devices.stove;
      st.inputs.forEach((item, i) => {
        const slot = $(`.slot[data-slot="in${i}"]`, panel);
        slot.innerHTML = item ? this.itemHTML(item, { zone: 'input', station: key, index: i }) : `<span class="slot-ph">+</span>`;
        slot.classList.toggle('filled', !!item);
      });
      const out = $('.slot[data-slot="out"]', panel);
      out.innerHTML = st.output
        ? this.itemHTML(st.output, { zone: 'output', station: key })
        : (st.busy ? `<span class="slot-ph busy">${this.t('craft.combine')}</span>` : `<span class="slot-ph">—</span>`);
      out.classList.toggle('filled', !!st.output);
      panel.classList.toggle('busy', st.busy);
      const bar = $(`[data-bar-station="${key}"]`, panel);
      bar.style.width = st.busy ? Math.min(100, (st.progress / st.duration) * 100) + '%' : '0%';
    }
  }

  /** 墙上天气牌 + 顾客区氛围层 */
  renderWeather() {
    const s = this.game.s;
    if (!s || !this.el.wxBoard) return;
    const id = s.weather || 'sunny';
    const wc = this.ctx.config.weather || {};
    const cfg = (wc.types && wc.types[id]) || {};
    const keyMap = { sunny: 'wxSun', cloudy: 'wxCloud', rain: 'wxRain', snow: 'snow', fog: 'wxFog', heat: 'wxHeat', sand: 'wxSand' };
    const name = this.t(cfg.nameKey || 'weather.sunny');
    const desc = this.t(cfg.descKey || 'weather.sunny.desc');
    if (this.el.wxBoard.dataset.wx !== id) {
      this.el.wxBoard.dataset.wx = id;
      this.el.wxIc.innerHTML = icon(keyMap[id] || 'wxSun');
      this.el.wxName.textContent = name;
      this.el.wxDesc.textContent = desc;
      if (this.el.wxLayer) this.el.wxLayer.className = 'wx-layer wx-' + id;
    }
    this.el.wxBoard.title = this.t('weather.today', { name, desc });
  }

  renderStorage() {
    const s = this.game.s;
    const cap = this.game.storageCap;
    // 内容指纹短路：只有物品序列/容量变了才重建，避免每次 change 全量重排（L19-②）
    const sig = `${cap}|${s.storage.map((it) => it.uid).join(',')}`;
    if (this.storageSig !== sig) {
      this.storageSig = sig;
      let html = '';
      for (let i = 0; i < cap; i++) {
        const it = s.storage[i];
        html += `<div class="slot sm ${it ? 'filled' : ''}" data-drop="storage">${it ? this.itemHTML(it, { zone: 'storage', index: i }) : ''}</div>`;
      }
      this.el.storage.innerHTML = html;
    }
    this.el.storageCount.textContent = this.t('storage.count', { n: s.storage.length, m: cap });
  }

  renderIngredients() {
    const s = this.game.s;
    const leaves = this.game.menuLeaves();
    for (const btn of $$('.ing', this.el.ings)) {
      const k = btn.dataset.ing;
      const cost = this.ctx.config.ingredients[k];
      const relevant = leaves.has(k);
      btn.classList.toggle('dim', !relevant);
      btn.classList.toggle('poor', s.coins < cost);
      btn.classList.toggle('tut', this.tutTargets.includes(`ing-${k}`));
    }
  }

  renderTrash() {
    const s = this.game.s;
    this.el.trashLv.textContent = this.t('trash.level', { n: s.devices.trash });
    this.el.trash.classList.toggle('cooling', s.trashCd > 0);
  }

  renderCustomers() {
    const s = this.game.s;
    const seen = new Set();
    s.customers.forEach((c, idx) => {
      seen.add(c.id);
      let el = this.custEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cust';
        el.dataset.drop = 'customer';
        el.dataset.customer = c.id;
        el.style.order = idx;
        this.el.custRow.appendChild(el);
        this.custEls.set(c.id, el);
      }
      el.style.order = idx;
      this.fillCustomer(el, c);
    });
    for (const [id, el] of Array.from(this.custEls.entries())) {
      if (!seen.has(id)) { el.remove(); this.custEls.delete(id); }
    }
  }

  fillCustomer(el, c) {
    const s = this.game.s;
    const order = c.items.map((it) => `
      <span class="ord ${it.filled ? 'ok' : ''}">
        ${icon(it.wants)}
        ${it.filled ? '<i class="tick">✓</i>' : ''}
      </span>`).join('');
    // 签名必须区分「已交付」状态：filled 与 wants 同名时，用 filled||wants 会算出相同签名，
    // 导致交付后不重建 DOM、对勾不出现。
    const sig = `${c.items.map((i) => `${i.wants}:${i.filled ? 1 : 0}`).join(',')}|${c.vip}`;
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `
        <div class="bubble" data-patience>
          ${c.vip ? '<span class="vip-badge">VIP</span>' : ''}
          <button class="dismiss" data-act="dismiss" data-customer="${c.id}">×</button>
          <div class="order">${order}</div>
          <div class="pbar"><i></i></div>
        </div>
        <div class="figure">${customerSVG(c.body, c.acc, c.vip)}</div>`;
    }
    el.classList.toggle('vip', !!c.vip);
    el.classList.toggle('tut', this.tutTargets.includes('customer'));
    const tut = s.tutorial.active && c.tutorial;
    el.classList.toggle('tut-focus', tut);
  }

  renderTutorialBanner() {
    const s = this.game.s;
    const tut = s.tutorial;
    if (!tut.active) {
      this.el.tut.classList.add('hidden');
      this.tutTargets = [];
      return;
    }
    const map = {
      bread: ['ing-bread', 'station-food'],
      patty: ['ing-patty', 'station-food'],
      serve: ['out-food', 'customer'],
      cola: ['ing-syrup', 'ing-water'],
      serveCola: ['out-drink', 'customer'],
    };
    this.tutTargets = map[tut.step] || [];
    this.el.tut.classList.remove('hidden');
    this.el.tutText.textContent = this.t('tutorial.step.' + tut.step);
    // 高亮工位/输出槽/顾客
    $$('.station', this.el.stations).forEach((st) => {
      st.classList.toggle('tut', this.tutTargets.includes('station-' + st.dataset.station));
    });
    $$('.slot.out', this.el.stations).forEach((sl) => {
      sl.classList.toggle('tut', this.tutTargets.includes('out-' + sl.dataset.station));
    });
  }

  syncTutorial() {
    const s = this.game.s;
    if (!s.tutorial.active) return;
    const food = s.stations.food;
    const drink = s.stations.drink;
    const delivered = s.dayStats.delivered || 0;
    // 逐级推进（允许一次跨过已满足的步骤）
    for (let guard = 0; guard < 6; guard++) {
      const step = s.tutorial.step;
      if (step === 'bread' && food.inputs.some((x) => x && x.key === 'bread')) {
        s.tutorial.step = 'patty';
      } else if (step === 'patty' && (food.busy || (food.output && food.output.key === 'burger'))) {
        s.tutorial.step = 'serve';
      } else if (step === 'serve' && delivered >= 1) {
        s.tutorial.step = 'cola';
        // 第 1 位教学顾客（汉堡）交付后已经离场，教学期又不生成普通顾客：
        // 这里补一位「只要可乐」的教学顾客，serveCola 才有可交付对象（TUT-KNOWN-2）。
        // 该调用是幂等的，重复 render 不会堆出多个人。
        this.game.ensureTutorialCustomer('cola');
        this.openRecipe();
      } else if (step === 'cola' && (drink.output || delivered >= 2)) {
        s.tutorial.step = 'serveCola';
        // 兜底：若玩家把可乐放进了仓储/丢掉了，仍保证场上有可交付对象
        this.game.ensureTutorialCustomer('cola');
      } else if (step === 'serveCola' && delivered >= 2) {
        this.game.finishTutorial();
        this.closeRecipe();
        return;
      } else break;
    }
  }

  /** 每帧：耐心、读条、垃圾桶冷却、营业倒计时 */
  frame() {
    const s = this.game.s;
    if (!s || this.el.game.classList.contains('hidden')) return;
    this.frameTimer(s);
    for (const c of s.customers) {
      const el = this.custEls.get(c.id);
      if (!el) continue;
      const b = el.querySelector('[data-patience]');
      if (!b) continue;
      const ratio = c.tutorial ? 1 : Math.max(0, c.patience / c.patienceMax);
      const bar = b.querySelector('.pbar > i');
      if (bar) bar.style.width = (ratio * 100).toFixed(1) + '%';
      b.style.borderWidth = (2 + 3 * ratio).toFixed(1) + 'px';
      el.classList.toggle('danger', ratio < 0.2);
    }
    for (const key of ['food', 'drink']) {
      const st = s.stations[key];
      const bar = $(`[data-bar-station="${key}"]`, this.el.stations);
      if (bar) bar.style.width = st.busy ? Math.min(100, (st.progress / st.duration) * 100) + '%' : '0%';
      const panel = $(`.station[data-station="${key}"]`, this.el.stations);
      if (panel) panel.classList.toggle('busy', st.busy);
    }
    const label = s.trashCd > 0 ? this.t('trash.cooldown') + ' ' + (s.trashCd / 1000).toFixed(1) + 's' : '';
    if (label !== this.lastTrashLabel) {
      this.lastTrashLabel = label;
      this.el.trashTip.textContent = label;
      this.el.trash.classList.toggle('cooling', s.trashCd > 0);
    }
  }

  // ---------------------------------------------------------------- 顾客区背景
  static plantArt() {
    return `<svg viewBox="0 0 60 66" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M32 42V22" stroke-width="2.6"/>
      <path d="M32 42c0-11-8-17-15-15 1 9 7 15 15 15z" fill="#8FC177"/>
      <path d="M32 42c0-13 8-19 16-17-1 10-8 17-16 17z" fill="#A8D08D"/>
      <path d="M32 30c-1-8-5-12-10-12 0 7 4 11 10 12z" fill="#B7DA9E"/>
      <path d="M18 44h24l-3 16a4 4 0 0 1-4 3h-10a4 4 0 0 1-4-3z" fill="#D98A5A"/>
      <path d="M16 44h28" stroke-width="3"/>
    </svg>`;
  }

  frameTimer(s) {
    const dur = s.dayDuration || 1;
    const left = Math.max(0, s.dayTimeLeft == null ? dur : s.dayTimeLeft);
    const sec = Math.ceil(left / 1000);
    if (sec !== this.lastTimerSec) {
      this.lastTimerSec = sec;
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      this.el.timerTime.textContent = `${mm}:${ss}`;
    }
    const ratio = Math.max(0, Math.min(1, left / dur));
    this.el.timerFill.style.width = (ratio * 100).toFixed(1) + '%';
    this.el.timer.classList.toggle('warn', ratio <= 0.2);
  }

  // ============================================================ panels
  toggleRecipe() {
    if (this.el.recipe.classList.contains('hidden')) this.openRecipe();
    else this.closeRecipe();
  }

  openRecipe() {
    this.renderRecipe();
    this.el.recipe.classList.add('drawer');
    this.el.recipe.classList.remove('hidden');
    this.el.upgrade.classList.add('hidden');
  }

  closeRecipe() { this.el.recipe.classList.add('hidden'); }

  /** 展开一条配方的前置步骤（用于多步配方提示） */
  chainOf(id, depth = 0) {
    if (depth > 4) return [];
    const r = this.ctx.byId.get(id);
    if (!r) return [];
    // 配方表已无 modes 字段（多分支机制随「加冰开关」一并移除），只按下标 inputs 展开
    const inputs = r.inputs || [];
    let steps = [];
    for (const k of inputs) if (this.ctx.byId.has(k)) steps = steps.concat(this.chainOf(k, depth + 1));
    steps.push({ out: id, inputs });
    return steps;
  }

  renderRecipe() {
    const s = this.game.s;
    const entries = [];
    for (const r of this.ctx.crafts.recipes) {
      entries.push({ out: r.id, price: r.price, inputs: r.inputs, cost: r.thisCost });
    }
    const today = new Set([...(s.menu ? s.menu.foods : []), ...(s.menu ? s.menu.drinks : [])]);
    const menuLine = s.menu ? [...s.menu.foods, ...s.menu.drinks] : [];
    entries.sort((a, b) => {
      const ta = today.has(a.out) ? 0 : 1;
      const tb = today.has(b.out) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      const ia = menuLine.indexOf(a.out);
      const ib = menuLine.indexOf(b.out);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    // 内容指纹短路：配方书展开时每次 change 都会进来，菜单/常做没变就不重建 DOM（L19-①）
    const sig = `recipe|${menuLine.join(',')}|${this.catStore.preferredCraft || ''}`;
    if (this.recipeSig === sig) return;
    this.recipeSig = sig;

    const row = (e) => {
      const isToday = today.has(e.out);
      const kind = this.ctx.kindOf(e.out);
      const pre = this.chainOf(e.out).slice(0, -1);
      const preTxt = pre.map((st) => `${st.inputs.map((k) => this.t(this.nameKey(k))).join('+')} → ${this.t(this.nameKey(st.out))}`).join('　');
      const price = kind === 'intermediate'
        ? `<em class="rcp-price mid">${this.t('recipe.intermediate')}</em>`
        : `<em class="rcp-price">¥${e.price}</em>`;
      const isPref = this.catStore.preferredCraft === e.out;
      return `<div class="rcp ${isToday ? 'today' : 'dim'} ${isPref ? 'pref' : ''}" title="${this.t('recipe.costTitle', { n: e.cost })}">
        <div class="rcp-main">
          <div class="rcp-in">${e.inputs.map((k) => `<span class="mini-ic">${icon(k)}</span>`).join('<i>+</i>')}</div>
          <div class="rcp-eq">=</div>
          <div class="rcp-out"><span class="mini-ic">${icon(e.out)}</span></div>
          <div class="rcp-txt"><b>${this.t(this.nameKey(e.out))}</b></div>
          ${e.note ? `<em class="rcp-note">${e.note}</em>` : ''}
          ${price}
        </div>
        ${pre.length ? `<p class="rcp-pre">${this.t('recipe.prep', { s: preTxt })}</p>` : ''}
      </div>`;
    };

    const todayRows = entries.filter((e) => today.has(e.out)).map(row).join('');
    const otherRows = entries.filter((e) => !today.has(e.out)).map(row).join('');
    this.el.recipe.innerHTML = `
      <div class="panel-head">
        <b>${this.t('recipe.book')}</b>
        <div class="panel-menu">
          ${menuLine.map((id) => `<span class="mini-ic" title="${this.t(this.nameKey(id))}">${icon(id)}</span>`).join('')}
        </div>
        <button class="mini icon" data-act="close-recipe">${this.t('btn.close')}</button>
      </div>
      <div class="panel-body single">
        <div class="rcp-sec on">${this.t('recipe.today')}</div>
        ${todayRows || `<p class="rcp-empty">${this.t('recipe.emptyToday')}</p>`}
        <div class="rcp-sec">${this.t('recipe.other')}</div>
        ${otherRows}
      </div>`;
  }

  nameKey(id) {
    if (this.ctx.config.ingredients[id] != null) return 'ing.' + id;
    const kind = this.ctx.kindOf(id);
    if (kind === 'intermediate') return 'mid.' + id;
    if (kind === 'fail') return 'item.fail';
    const r = this.ctx.byId.get(id);
    return (r && r.type === 'drink' ? 'drink.' : 'food.') + id;
  }

  openUpgrade() {
    this.renderUpgrade();
    this.el.upgrade.classList.add('drawer');
    this.el.upgrade.classList.remove('hidden');
    this.el.recipe.classList.add('hidden');
  }

  closeUpgrade() { this.el.upgrade.classList.add('hidden'); }

  renderUpgrade() {
    const devs = [
      ['stove', this.t('upgrade.stove'), 'stepTime'],
      ['counter', this.t('upgrade.counter'), 'earned ×'],
      ['sign', this.t('upgrade.sign'), 'patience ×'],
      ['trash', this.t('upgrade.trash'), 'cooldown'],
    ];
    const rows = devs.map(([key, name, eff]) => {
      const info = this.game.deviceInfo(key);
      let spec;
      if (key === 'trash') {
        spec = info.maxed ? `${info.cur}ms` : `${info.cur}ms → ${info.next}ms`;
      } else {
        spec = info.maxed ? this.fmtDev(key, info.cur) : `${this.fmtDev(key, info.cur)} → ${this.fmtDev(key, info.next)}`;
      }
      const btn = info.maxed
        ? `<button class="btn sm" disabled>${this.t('upgrade.max')}</button>`
        : `<button class="btn sm primary" data-act="upgrade-dev" data-dev="${key}" ${this.game.s.coins < info.cost ? 'disabled' : ''}>
             ${this.t('upgrade.cost', { n: info.cost })}
           </button>`;
      const refund = info.maxed ? '' : `<em class="refund">${info.refund > 0 ? this.t('upgrade.refundInline', { n: info.refund }) : this.t('upgrade.noRefundFirst')}</em>`;
      return `<div class="up-row">
        <div class="up-name"><b>${name}</b><span>Lv${info.lv} / ${info.max}　<span class="eff">${eff}</span></span></div>
        <div class="up-spec">${spec}${refund}</div>
        ${btn}
      </div>`;
    }).join('');
    this.el.upgrade.innerHTML = `
      <div class="panel-head">
        <b>${this.t('upgrade.title')}</b>
        <div class="panel-menu"><i>${this.t('upgrade.instant')} · ${this.t('upgrade.refund', { n: Math.round(this.ctx.config.devices.refund.rate * 100) + '%' })}</i></div>
        <button class="mini icon" data-act="close-upgrade">${this.t('btn.close')}</button>
      </div>
      <div class="panel-body single">${rows}</div>`;
  }

  fmtDev(key, v) {
    if (key === 'stove') return v + 'ms';
    if (key === 'trash') return v + 'ms';
    return '×' + v;
  }

  // ============================================================ modals
  /**
   * 通用弹层。
   * closable: true 时在标题栏右侧渲染 ✕ —— 给主页那几页（商店 / 成就 / 配方书 / 天气 / 设置）用。
   * 这些页面内容可能很长，玩家不该被逼着滚到最底部才能退出。
   * 结算 / 破产 / 暂停这类「必须走按钮才能推进」的弹层不要传 closable。
   */
  modal({ title, body, actions, tone = '', closable = false, onClose = null, footNote = '' }) {
    this.modalActions = actions || [];
    this.el.modal.innerHTML = `<div class="modal-card ${tone}">
      <div class="modal-head">
        <h2>${title}</h2>
        ${closable ? `<button class="modal-x" data-modal-x type="button" aria-label="${this.t('btn.close')}" title="${this.t('btn.close')}">×</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footNote ? `<p class="modal-note small">${footNote}</p>` : ''}
      <div class="modal-actions">${this.modalActions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''}" data-mi="${i}">${a.label}</button>`).join('')}</div>
    </div>`;
    this.el.modal.classList.remove('hidden');
    $$('[data-mi]', this.el.modal).forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.mi);
        const a = this.modalActions[i];
        this.closeModal();
        a && a.onClick && a.onClick();
      };
    });
    const x = $('[data-modal-x]', this.el.modal);
    if (x) x.onclick = () => { this.closeModal(); if (onClose) onClose(); };
  }

  closeModal() {
    this.el.modal.classList.add('hidden');
    this.el.modal.innerHTML = '';
    this.modalActions = null;
    this.clearToasts(); // 弹窗关闭时清掉挂起的 toast 定时器，避免回调打到已销毁的节点（L20）
    this.restoreShopPause(); // 商店弹层的所有关闭路径都在这里统一恢复暂停（L21）
  }

  /**
   * 营业中打开商店会自动暂停；任何关闭路径（按钮 / 换弹窗 / 中途关）都必须恢复，
   * 否则玩家会卡在「没有任何弹窗但时间冻结」的状态。
   */
  restoreShopPause() {
    if (!this.shopPaused) return;
    this.shopPaused = false;
    if (this.game.s && this.game.s.paused) this.game.togglePause();
  }

  toast(msg, ms = 1500) {
    if (!msg || !this.el.toasts) return;
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    // 统一维护句柄：弹窗关闭/重开时可以一次性清掉，避免定时器泄漏（L20）
    if (!this.toastTimers) this.toastTimers = new Set();
    const tOut = setTimeout(() => { d.classList.add('out'); this.toastTimers.delete(tOut); }, Math.max(400, ms - 400));
    const tDel = setTimeout(() => { d.remove(); this.toastTimers.delete(tDel); }, ms);
    this.toastTimers.add(tOut);
    this.toastTimers.add(tDel);
  }

  /** 清掉所有挂起的 toast 定时器与节点 */
  clearToasts() {
    if (this.toastTimers) {
      for (const id of this.toastTimers) clearTimeout(id);
      this.toastTimers.clear();
    }
    if (this.el && this.el.toasts) this.el.toasts.innerHTML = '';
  }

  fail(reason, el, extra) {
    const map = {
      cooldown: this.t('trash.cooldown'),
      storageFull: this.t('storage.full'),
      short: this.t('cost.short'),
      wrong: this.t('serve.wrong'),
      busy: this.t('craft.combine'),
      outputOccupied: this.t('toast.outputOccupied'),
      inputsFull: this.t('toast.inputsFull'),
      failOnlyTrash: this.t('toast.failOnlyTrash'),
      // 以下 5 个 reason 引擎会返回，此前没有文案 → 玩家看不到任何反馈（L13）
      empty: this.t('toast.slotEmpty'),
      phase: this.t('toast.notNow'),
      same: this.t('toast.sameSpot'),
      gone: this.t('toast.orderGone'),
      badTarget: this.t('toast.badTarget'),
      // 配置类异常（如 delivery.deliverySettleMs 缺失时引擎会 throw）：
      // 兜住后给玩家一句明确提示，而不是「拖给骑手毫无反应」
      configError: this.t('toast.configError'),
    };
    let msg = map[reason];
    // v2.9：拖错灶台时按「实际拖到的灶台」给一句可爱提示。
    // 文案刻意写成对玩家说话（"这是甜品台哦"），而不是"类型不匹配"。
    if (reason === 'wrongStation' && extra && extra.got) {
      msg = this.t('toast.wrongStation', { here: this.t('station.' + extra.got), want: this.t('station.' + (extra.want || extra.got)) });
    }
    if (msg) this.toast(msg);
    if (el) {
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 220);
    }
  }

  togglePause() {
    const paused = this.game.togglePause();
    if (paused) {
      const au = window.__OWK_AUDIO__;
      const ast = (au && au.state) || { music: true, sfx: true };
      this.modal({
        title: this.t('pause.title'),
        body: `<p class="p">${this.t('pause.desc')}</p>
          <div class="set-row"><span>${this.t('settings.music')}</span>
            <button class="switch ${ast.music ? 'on' : ''}" data-set="music" role="switch" aria-checked="${ast.music}">${ast.music ? this.t('settings.on') : this.t('settings.off')}</button></div>
          <div class="set-row"><span>${this.t('settings.sfx')}</span>
            <button class="switch ${ast.sfx ? 'on' : ''}" data-set="sfx" role="switch" aria-checked="${ast.sfx}">${ast.sfx ? this.t('settings.on') : this.t('settings.off')}</button></div>`,
        actions: [
          { label: this.t('pause.resume'), primary: true, onClick: () => { if (this.game.s.paused) this.game.togglePause(); this.render(); } },
          { label: this.t('btn.menu'), onClick: () => this.onQuit && this.onQuit() },
        ],
      });
      $$('[data-set]', this.el.modal).forEach((b) => {
        b.onclick = () => {
          const a = window.__OWK_AUDIO__;
          if (!a) return;
          const k = b.dataset.set;
          const next = !(k === 'music' ? a.state.music : a.state.sfx);
          if (k === 'music') a.setMusic(next); else a.setSfx(next);
          b.classList.toggle('on', next);
          b.textContent = next ? this.t('settings.on') : this.t('settings.off');
          b.setAttribute('aria-checked', String(next));
        };
      });
    } else this.closeModal();
  }

  // ============================================================ screens
  showMenu(hasSave, hardUnlocked) {
    this.el.menu.classList.remove('hidden');
    this.el.game.classList.add('hidden');
    this.el.menu.innerHTML = `
      <div class="menu-card">
        <div class="menu-left">
          <div class="logo">${icon('logo')}</div>
          <h1>${this.t('menu.title')}</h1>
          <p class="sub">${this.t('menu.subtitle')}</p>
        </div>
        <div class="menu-right">
          <div class="menu-cat">
            <span class="catbal" title="${this.t('cat.title')}">${icon('catcoin')}<b id="menu-cat-coins">0</b></span>
          </div>
          <div class="menu-entry">
            <button class="btn sm" id="btn-shop">${icon('catcoin')}<span>${this.t('shop.entry')}</span></button>
            <button class="btn sm" id="btn-ach">${icon('star')}<span>${this.t('ach.title')}</span></button>
            <button class="btn sm" id="btn-book">${icon('book')}<span>${this.t('home.recipe')}</span></button>
            <button class="btn sm" id="btn-wx">${icon('wxSun')}<span>${this.t('home.weather')}</span></button>
            <button class="btn sm" id="btn-set">${icon('up')}<span>${this.t('home.settings')}</span></button>
          </div>
          <div class="modes">
            <button class="mode-card" data-mode="normal">
              <b>${this.t('difficulty.normal')}</b>
              <p>${this.t('mode.hint.normal')}</p>
            </button>
            <button class="mode-card ${hardUnlocked ? '' : 'locked'}" data-mode="hard" ${hardUnlocked ? '' : 'disabled'}>
              <b>${this.t('difficulty.hard')}</b>
              <p>${this.t('mode.hint.hard')}</p>
              ${hardUnlocked ? '' : `<em class="lock">${this.t('difficulty.locked')}</em>`}
            </button>
          </div>
          <div class="menu-actions ${hasSave ? '' : 'single'}">
            <button class="btn primary big" id="btn-start">${this.t('menu.start')}</button>
            ${hasSave ? `<button class="btn big" id="btn-continue">${this.t('menu.continue')}</button>` : ''}
          </div>
          <p class="hint">${this.t('menu.tip')}</p>
        </div>
      </div>`;
    let mode = 'normal';
    $$('.mode-card', this.el.menu).forEach((b) => {
      b.onclick = () => {
        if (b.classList.contains('locked')) { this.toast(this.t('difficulty.locked')); return; }
        mode = b.dataset.mode;
        $$('.mode-card', this.el.menu).forEach((x) => x.classList.toggle('sel', x === b));
      };
    });
    $('.mode-card', this.el.menu).classList.add('sel');
    $('#btn-start').onclick = () => this.onStart && this.onStart(mode);
    // 商店在主菜单与局内都能开（弹层已挂在舞台层，不受屏幕切换影响）
    const shopBtn = $('#btn-shop');
    if (shopBtn) shopBtn.onclick = () => this.openShop();
    const achBtn = $('#btn-ach');
    if (achBtn) achBtn.onclick = () => this.openAch();
    const bookBtn = $('#btn-book');
    if (bookBtn) bookBtn.onclick = () => this.openRecipeBook();
    const wxBtn = $('#btn-wx');
    if (wxBtn) wxBtn.onclick = () => this.openWeatherIntro();
    const setBtn = $('#btn-set');
    if (setBtn) setBtn.onclick = () => this.openSettings();
    this.syncMenuCat();
    const cont = $('#btn-continue');
    if (cont) cont.onclick = () => this.onContinue && this.onContinue();
  }

  showGame() {
    this.el.menu.classList.add('hidden');
    this.el.game.classList.remove('hidden');
  }

  // ============================================================ day/week
  showDayEnd(stats) {
    const s = this.game.s;
    const daysPerWeek = (this.ctx.config.economy && this.ctx.config.economy.daysPerWeek) || 7;
    const isLast = s.day >= daysPerWeek;
    this.modal({
      title: this.t('day.title', { n: stats.day }),
      body: `<div class="stat-grid">
        <div><b>${stats.served}</b><span>${this.t('stat.served')}</span></div>
        <div><b>${stats.lost}</b><span>${this.t('stat.lost')}</span></div>
        <div><b>${stats.waste}</b><span>${this.t('stat.waste')}</span></div>
        <div><b>${stats.earned + stats.bonus}</b><span>${this.t('stat.todayIncome')}</span></div>
      </div>
      <p class="coinline">${this.t('stat.coins')} <b>${Math.round(s.coins)}</b></p>
      ${(stats.deliveryServed || stats.deliveryPending)
        ? `<p class="delivline">${this.t('delivery.today', { n: (stats.deliveryServed || 0) + (stats.deliveryPending || 0), coins: stats.deliveryRevenue || 0 })}</p>`
        : ''}
      <p class="catline">${icon('catcoin')}<b>+${stats.catCoins || 0}</b> ${this.t('cat.title')}</p>`,
      actions: [{
        label: isLast ? this.t('btn.week') : this.t('btn.next'),
        primary: true,
        onClick: () => {
          if (s.day < daysPerWeek) { this.game.nextDay(); this.render(); }
          else this.game.endWeek();
        },
      }],
    });
  }

  showWeekEnd(w) {
    const normal = this.game.s.mode === 'normal';
    const info = this.game.exchangeInfo();
    const clearLine = normal
      ? `<p class="p">${this.t('settle.recycle', { n: w.recycled })}</p>`
      : `<p class="p">${this.t('settle.spoiled', { n: w.discarded })}</p>`;
    this.modal({
      title: this.t('week.title', { n: w.week }),
      body: `<div class="stat-grid">
        <div><b>${w.served}</b><span>${this.t('stat.served')}</span></div>
        <div><b>${w.lost}</b><span>${this.t('stat.lost')}</span></div>
        <div><b>${w.waste}</b><span>${this.t('stat.waste')}</span></div>
        <div><b>${w.rent}</b><span>${this.t('stat.rent')}</span></div>
      </div>
      ${clearLine}
      <p class="p">${this.t('settle.clear')} · ${this.t('settle.keepDevices')}</p>
      ${(w.deliveryServed || 0)
        ? `<p class="delivline">${this.t('delivery.week', { n: w.deliveryServed, coins: w.deliveryRevenue || 0 })}</p>`
        : ''}
      <p class="catline">${icon('catcoin')}${this.t('cat.weekReward', { n: w.catCoins })}</p>
      <p class="coinline">${this.t('stat.balance')} <b>${Math.round(w.coins)}</b></p>
      <div class="exchange" id="exchange">
        <div class="ex-head">
          <b>${this.t('ex.title')}</b>
          <span id="ex-rule">${this.t('ex.rule', { rate: info.rate, cap: info.cap })}</span>
        </div>
        <div class="ex-row">
          <span class="ex-amount"><b id="ex-amount">+${w.coinBonus || 0}</b><i>${this.t('ex.unit')}</i></span>
          <span class="ex-note" id="ex-note">${this.t('ex.note', { coins: Math.round(w.coins), rate: info.rate })}</span>
        </div>
        <p class="ex-tip" id="ex-tip"></p>
      </div>`,
      actions: [{
        label: this.t('btn.nextweek'),
        primary: true,
        onClick: () => { this.game.nextWeek(); this.saveNow(); this.render(); },
      }],
    });
  }

  // ---------------------------------------------------------------- 金币奖励猫币（v2.8）
  // 旧版「手动扣金币兑换猫猫币」已下线：现在改为周结算时按「每满 25 金币额外奖励 1 猫币、
  // 不消耗金币」的规则**自动发放**（engine.grantCoinBonus）。此处保留只读展示，不含任何按钮与交互。

  showBankrupt(w) {
    this.modal({
      title: this.t('bankrupt.title'),
      tone: 'bad',
      body: `<p class="p">${this.t('bankrupt.desc')}</p>
        <div class="stat-grid two">
          <div><b>${w.rent}</b><span>${this.t('stat.rent')}</span></div>
          <div><b>${Math.round(this.game.s.weekStartCoins)}</b><span>${this.t('bankrupt.coins')}</span></div>
        </div>`,
      actions: [
        { label: this.t('bankrupt.retry'), primary: true, onClick: () => { this.game.retryWeek(); this.saveNow(); this.render(); } },
        { label: this.t('btn.menu'), onClick: () => this.onQuit && this.onQuit() },
      ],
    });
  }

  // ============================================================ 设置 / 主题（OWK-CFG-005 §12 §13）
  applyTheme(skinId) {
    const skins = (this.ctx.config.catSkins && this.ctx.config.catSkins.skins) || [];
    const sk = skins.find((x) => x.id === skinId) || skins[0];
    const th = sk && sk.theme;
    if (!th) return;
    const root = document.documentElement.style;
    root.setProperty('--paper', th.bg);
    root.setProperty('--paper-2', th.paper2);
    root.setProperty('--gold', th.gold);
    root.setProperty('--line', th.line);
    root.setProperty('--ink-2', th.ink2);
    // 主题装饰：背景纹理 + 键帽外观（不止换色）
    root.setProperty('--theme-deco', th.deco ? th.deco : 'none');
    root.setProperty('--keycap-top', th.keycapTop || '#FFF8EC');
    root.setProperty('--keycap-side', th.keycapSide || '#E8DCC8');
    root.setProperty('--keycap-text', th.keycapText || '#6B6055');
    root.setProperty('--keycap-gloss', th.keycapGloss || 'rgba(255,255,255,.5)');
    // --ink 是固定的深色（#2B2B2B），深色皮肤下会与背景撞色。
    // 这里按皮肤背景亮度推一个「正文强色」，供卡片标题等需要强调的文字使用。
    root.setProperty('--ink-strong', View.isDarkHex(th.bg) ? '#F4EFE4' : '#2B2B2B');
    // theme 段没有 id 字段（皮肤才是 id 持有者），记皮肤 id 才不会变成 undefined（L17）
    this.skinId = sk.id;
  }

  /** 十六进制颜色是否为深色（相对亮度 < 0.5），支持 #RGB / #RRGGBB */
  static isDarkHex(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return false;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }

  openSettings() {
    this.renderSettings();
  }

  renderSettings(saveCode) {
    const a = window.__OWK_AUDIO__;
    const st = (a && a.state) || { music: true, sfx: true, musicVol: 0.32, sfxVol: 0.6 };
    const mv = Math.round((st.musicVol || 0) * 100);
    const sv = Math.round((st.sfxVol || 0) * 100);
    this.modal({
      title: this.t('settings.title'),
      closable: true,
      body: `
        <div class="set-row"><span>${this.t('settings.music')}</span>
          <button class="switch ${st.music ? 'on' : ''}" data-set="music" role="switch" aria-checked="${st.music}">${st.music ? this.t('settings.on') : this.t('settings.off')}</button></div>
        <div class="set-row"><span>${this.t('settings.sfx')}</span>
          <button class="switch ${st.sfx ? 'on' : ''}" data-set="sfx" role="switch" aria-checked="${st.sfx}">${st.sfx ? this.t('settings.on') : this.t('settings.off')}</button></div>
        <div class="set-vol" data-volrow="music">
          <label>${this.t('settings.musicVol')}</label>
          <input type="range" min="0" max="100" value="${mv}" data-vol="music">
          <em id="vol-music">${mv}%</em>
        </div>
        <div class="set-vol" data-volrow="sfx">
          <label>${this.t('settings.sfxVol')}</label>
          <input type="range" min="0" max="100" value="${sv}" data-vol="sfx">
          <em id="vol-sfx">${sv}%</em>
        </div>
        <p class="set-hint hidden" id="vol-hint"></p>
        <div class="set-theme"><b>${this.t('settings.theme')}</b><i>${this.t('settings.themeNow', { name: this.currentThemeName() })}</i></div>
        <div class="set-save">
          <div class="set-save-head"><b>${this.t('settings.save')}</b><i>${this.t('settings.saveHint')}</i></div>
          <div class="set-save-btns">
            <button class="btn sm" data-save="export">${this.t('settings.exportSave')}</button>
            <button class="btn sm" data-save="import">${this.t('settings.importSave')}</button>
          </div>
          ${saveCode ? `<p class="set-save-code"><textarea id="save-code" readonly rows="4">${saveCode}</textarea></p>
          <p class="set-save-note">${this.t('settings.exportReady')}</p>` : ''}
        </div>`,
      actions: [{ label: this.t('btn.close'), primary: true }],
    });

    $$('[data-vol]', this.el.modal).forEach((r) => {
      // oninput 只改增益（实时听感），onchange（松手）才落盘：
      // 拖动一次会触发几十次 input，每次都写 localStorage 是纯浪费（L19-⑥）
      const apply = (save) => {
        const au = window.__OWK_AUDIO__;
        if (!au) return;
        const v = Number(r.value) / 100;
        if (r.dataset.vol === 'music') au.setMusicVolume(v, save); else au.setSfxVolume(v, save);
        const out = $('#vol-' + r.dataset.vol, this.el.modal);
        if (out) out.textContent = Math.round(v * 100) + '%';
      };
      r.oninput = () => apply(false);
      r.onchange = () => apply(true);
    });
    $$('[data-set]', this.el.modal).forEach((b) => {
      b.onclick = () => {
        const au = window.__OWK_AUDIO__;
        if (!au) return;
        const k = b.dataset.set;
        const next = !(k === 'music' ? au.state.music : au.state.sfx);
        if (k === 'music') au.setMusic(next); else au.setSfx(next);
        b.classList.toggle('on', next);
        b.textContent = next ? this.t('settings.on') : this.t('settings.off');
        b.setAttribute('aria-checked', String(next));
        this.updateVolHint();
      };
    });
    // 存档导出 / 导入（v2.12）
    // 存档全在 localStorage 且按域名隔离，换域名就等于重开新号 —— 这里给玩家一条自救的路。
    $$('[data-save]', this.el.modal).forEach((b) => {
      b.onclick = async () => {
        const api = window.__OWK__;
        if (!api) return;
        if (b.dataset.save === 'export') {
          const code = api.exportSaveCode();
          // 先尝试自动复制；失败（非安全上下文 / 无权限）也不影响，码会显示在下方供手动复制
          let copied = false;
          try {
            await navigator.clipboard.writeText(code);
            copied = true;
          } catch (e) { copied = false; }
          if (copied) this.toast(this.t('settings.exportCopied'));
          this.renderSettings(code);
          return;
        }
        // 导入
        const input = window.prompt(this.t('settings.importPrompt'), '');
        if (input == null) return;
        const r = api.importSaveCode(input);
        if (r.ok) {
          this.toast(this.t('settings.importOk'));
          // 存档在 boot 时一次性读入内存，必须重载才能生效
          setTimeout(() => location.reload(), 700);
        } else {
          this.toast(r.reason === 'empty' ? this.t('settings.importEmpty') : this.t('settings.importBad'));
        }
      };
    });
    // 导出后把 textarea 内容全选中，方便直接 Ctrl+C
    const codeBox = $('#save-code', this.el.modal);
    if (codeBox) {
      codeBox.onfocus = () => codeBox.select();
      setTimeout(() => { try { codeBox.focus(); codeBox.select(); } catch (e) { /* 忽略 */ } }, 60);
    }
    this.updateVolHint();
  }

  /**
   * 音量滑杆的"为什么没反应"提示（v2.10.1）
   *
   * 真实用户反馈：「调节音量按键没有用」。排查后确认滑杆本身是好的（20% → gain 0.2），
   * 但**对应通道关着时**拖滑杆听不出任何变化 —— 玩家会直接判定"坏了"。
   * 这里在关闭态给该行降透明度，并在下方补一句明确原因。
   * 没有 #vol-hint 的弹层（暂停页）调用时自动跳过。
   */
  updateVolHint() {
    const a = window.__OWK_AUDIO__;
    const modal = this.el && this.el.modal;
    if (!a || !modal) return;
    const rowM = modal.querySelector('[data-volrow="music"]');
    const rowS = modal.querySelector('[data-volrow="sfx"]');
    if (rowM) rowM.classList.toggle('muted', !a.state.music);
    if (rowS) rowS.classList.toggle('muted', !a.state.sfx);
    const hint = modal.querySelector('#vol-hint');
    if (!hint) return;
    const parts = [];
    if (!a.state.music) parts.push(this.t('settings.musicOffHint'));
    if (!a.state.sfx) parts.push(this.t('settings.sfxOffHint'));
    hint.textContent = parts.join('　');
    hint.classList.toggle('hidden', parts.length === 0);
  }

  /** 当前使用的小店主题名（跟随当前皮肤） */
  currentThemeName() {
    const skins = (this.ctx.config.catSkins && this.ctx.config.catSkins.skins) || [];
    // 以「实际套用的皮肤」为准（applyTheme 的入参），其次才回落到局外存档里的 skin
    const id = this.skinId || this.catStore.skin;
    const sk = skins.find((x) => x.id === id) || skins[0];
    return (sk && sk.themeName) || (sk && this.t(sk.nameKey)) || '';
  }

  // ============================================================ 主页配方书（标签 + 详情 + 设为常做）
  openRecipeBook(tab = 'all') {
    this.bookTab = tab;
    const recipes = (this.ctx.crafts.recipes || []);
    const list = recipes.filter((r) => tab === 'all' || r.type === tab);
    const cards = list.map((r) => {
      const pref = this.catStore.preferredCraft === r.id;
      const steps = (r.inputs || []).length;
      // 中间产物没有售价（price = null），不能把 null 直接拼成「¥null」
      const priceLabel = r.price == null ? this.t('recipe.intermediate') : '¥' + r.price;
      return '<div class="book-card ' + (pref ? 'pref' : '') + '" data-book="' + r.id + '">'
        + '<div class="book-ic">' + icon(r.id) + '</div>'
        + '<b>' + this.t(this.nameKey(r.id)) + '</b>'
        + '<em>' + priceLabel + '</em>'
        + '<span>' + steps + ' ' + this.t('recipe.stepUnit') + ' · ' + this.t('recipe.netInline', { n: r.net || 0 }) + '</span>'
        + '</div>';
    }).join('');
    this.modal({
      title: this.t('recipe.title'),
      closable: true,
      body: '<p class="p small">' + this.t('recipe.intro') + '</p>'
        + '<div class="book-tabs">'
        + '<button class="tab ' + (tab === 'all' ? 'on' : '') + '" data-btab="all">' + this.t('recipe.tab.all') + '</button>'
        + '<button class="tab ' + (tab === 'food' ? 'on' : '') + '" data-btab="food">' + this.t('recipe.tab.food') + '</button>'
        + '<button class="tab ' + (tab === 'drink' ? 'on' : '') + '" data-btab="drink">' + this.t('recipe.tab.drink') + '</button>'
        + '</div>'
        + '<div class="book-grid">' + cards + '</div>'
        + '<div class="book-detail" id="book-detail"></div>',
      actions: [{ label: this.t('btn.close'), primary: true }],
    });
    $$('[data-btab]', this.el.modal).forEach((b) => { b.onclick = () => this.openRecipeBook(b.dataset.btab); });
    $$('[data-book]', this.el.modal).forEach((c) => { c.onclick = () => this.showRecipeDetail(c.dataset.book); });
    if (this.catStore.preferredCraft) this.showRecipeDetail(this.catStore.preferredCraft);
  }

  /** 配方详情：步骤序列 + 成本净利 + 设为常做（局内配方书会高亮） */
  showRecipeDetail(id) {
    const r = (this.ctx.crafts.recipes || []).find((x) => x.id === id);
    const box = $('#book-detail', this.el.modal);
    if (!r || !box) return;
    const chain = this.chainOf(r.id);
    const steps = chain.map((st, i) => {
      const ins = st.inputs.map((k) => '<span class="mini-ic" title="' + this.t(this.nameKey(k)) + '">' + icon(k) + '</span>').join(' <em>+</em> ');
      return '<div class="book-step"><i>' + (i + 1) + '</i>' + ins + ' <em>→</em> <b>' + this.t(this.nameKey(st.out)) + '</b></div>';
    }).join('');
    const pref = this.catStore.preferredCraft === r.id;
    const stepMs = ((this.ctx.config.devices || { stove: { values: [1200] } }).stove.values || [1200])[0];
    const priceLabel = r.price == null ? this.t('recipe.intermediate') : '¥' + r.price;
    box.innerHTML = '<div class="book-d-head">'
      + '<span class="book-ic big">' + icon(r.id) + '</span>'
      + '<div><b>' + this.t(this.nameKey(r.id)) + '</b>'
      + '<em>' + priceLabel + ' · ' + this.t('recipe.costLine', { cost: r.chainCost, net: r.net || 0 }) + '</em></div>'
      + '<button class="btn sm ' + (pref ? '' : 'primary') + '" data-book-pick="' + r.id + '">' + (pref ? this.t('recipe.picked') : this.t('recipe.pick')) + '</button>'
      + '</div>'
      + '<div class="book-steps">' + steps + '</div>'
      + '<p class="p small">' + this.t('recipe.time', { n: (stepMs / 1000).toFixed(1) }) + '</p>';
    const pick = $('[data-book-pick]', this.el.modal);
    if (pick) {
      pick.onclick = () => {
        this.catStore.preferredCraft = this.catStore.preferredCraft === r.id ? null : r.id;
        this.commitCatStore();
        this.openRecipeBook(this.bookTab);
      };
    }
  }

  // ============================================================ 天气介绍
  openWeatherIntro() {
    const types = (this.ctx.config.weather && this.ctx.config.weather.types) || {};
    const icMap = { sunny: 'wxSun', cloudy: 'wxCloud', rain: 'wxRain', snow: 'snow', fog: 'wxFog', heat: 'wxHeat', sand: 'wxSand' };
    const rows = Object.entries(types).map(([id, w]) => {
      // 客流：配置是"相对倍率"（spawnMul 越大客人越少），展示成"约 N 位"更好懂
      const traffic = Math.round(9 / (w.spawnMul || 1));
      const priceUp = (w.drinkPriceMul || 1) > 1;
      // v2.9：天气 → 订单权重。显式写出来，玩家才懂「今天为什么冷饮好卖」。
      const ow = w.orderWeights || {};
      const wParts = [];
      if (ow.cold != null && ow.cold !== 1) wParts.push(this.t('weather.wCold', { n: Math.round((ow.cold - 1) * 100) }));
      if (ow.hot != null && ow.hot !== 1) wParts.push(this.t('weather.wHot', { n: Math.round((ow.hot - 1) * 100) }));
      return `
      <div class="wx-intro-row">
        <span class="wx-intro-ic">${icon(icMap[id] || 'wxSun')}</span>
        <div class="wx-intro-main">
          <b>${this.t(w.nameKey)}</b>
          <i>${this.t(w.descKey)}</i>
        </div>
        <div class="wx-intro-side">
          <em class="wx-stat">${this.t('weather.wxTraffic')} ${this.t('weather.wxTrafficVal', { n: traffic })} · ${priceUp ? this.t('weather.wxPriceUp', { n: Math.round((w.drinkPriceMul - 1) * 100) }) : this.t('weather.wxPriceFlat')}</em>
          <span class="wx-weights">${wParts.length ? wParts.join(' · ') : this.t('weather.wxNoWeight')}</span>
        </div>
      </div>`;
    }).join('');
    this.modal({
      title: this.t('weather.intro'),
      closable: true,
      body: `<p class="p small">${this.t('weather.introSub')}</p><div class="wx-intro">${rows}</div><p class="p small wx-tip">${this.t('weather.introSub2')}</p>`,
      actions: [{ label: this.t('btn.close'), primary: true }],
    });
  }



  // ================================================================ 手机（外卖）
  renderPhone() {
    const s = this.game.s;
    const el = this.el.phone;
    if (!el || !s) return;
    // 时长口径全部读配置。这里**不做静默兜底**：引擎侧 pickupDelivery() 缺键会 throw，
    // 视图若自己补一个 10000，就会出现「进度条按 10s 画、实际结算按别的值」的两套口径（R3）。
    // 配置缺失时宁可不画进度条，也不假装有个值。
    const dc = this.ctx.config.delivery || {};
    const previewMs = typeof dc.previewMs === 'number' ? dc.previewMs : 0;
    const settleMs = typeof dc.deliverySettleMs === 'number' ? dc.deliverySettleMs : 0;
    const list = s.deliveries || [];
    const cur = list.find((d) => d.status === 'delivered' && s.time - (d.deliveredAt || 0) < 1500)
      || list.find((d) => d.status === 'picked_up' || d.status === 'rider_arrived' || d.status === 'preview')
      || list.find((d) => d.status === 'delivered')
      || list[0];
    const scr = this.el.phoneScreen;
    if (!cur) {
      el.classList.add('off');
      el.dataset.did = '';
      scr.innerHTML = '<span class="ph-dot"></span>';
      this.renderRider(null);
      return;
    }
    el.classList.toggle('off', cur.status === 'scheduled');
    el.dataset.did = String(cur.id);

    const t = s.time;
    let html = '';
    if (cur.status === 'scheduled') {
      html = '<span class="ph-dot"></span>';
    } else if (cur.status === 'preview') {
      // 提前预警：显示所需物品 + 骑手到达倒计时
      const left = Math.max(0, Math.ceil((cur.riderAt - t) / 1000));
      const bar = previewMs > 0
        ? `<div class="ph-bar"><i style="width:${Math.round((1 - (cur.riderAt - t) / previewMs) * 100)}%"></i></div>`
        : '';
      html = `<div class="ph-row">${icon(cur.item)}</div>
        <div class="ph-names">${this.t(this.nameKey(cur.item))}</div>
        <div class="ph-time">${this.t('delivery.pickupIn', { n: left })}</div>
        ${bar}`;
    } else if (cur.status === 'rider_arrived') {
      html = `<div class="ph-row">${icon(cur.item)}</div>
        <div class="ph-names">${this.t(this.nameKey(cur.item))}</div>
        <div class="ph-time hot">${this.t('delivery.riderHere')}</div>`;
    } else if (cur.status === 'picked_up') {
      // 骑手已取走：显示配送中倒计时（骑手角色此时已离店消失）
      const left = Math.max(0, Math.ceil(((cur.deliveredAt || 0) - t) / 1000));
      const bar = settleMs > 0
        ? `<div class="ph-bar"><i style="width:${Math.round((1 - (left * 1000) / settleMs) * 100)}%"></i></div>`
        : '';
      html = `<div class="ph-ok">${icon('check')}<b>${this.t('delivery.sending')}</b></div>
        <div class="ph-time">${this.t('delivery.deliverIn', { n: left })}</div>
        ${bar}`;
    } else if (cur.status === 'delivered') {
      html = `<div class="ph-ok good">${icon('check')}<b>${this.t('delivery.done', { n: cur.earned || 0 })}</b></div>`;
    }
    scr.innerHTML = html;

    // 骑手角色
    this.renderRider(cur);
  }

  /**
   * 骑手：到店出现，交付后**立即消失**（v2.8：不再播放离场动画，店内不留骑手）
   */
  renderRider(d) {
    const el = this.el.rider;
    if (!el) return;
    const show = d && d.status === 'rider_arrived';
    el.classList.toggle('hidden', !show);
    el.classList.remove('leaving');
    if (show) {
      el.innerHTML = riderSVG();
      el.title = this.t('delivery.riderHere');
    } else {
      el.innerHTML = '';
    }
  }

  /** 点击手机：播报当前外卖单状态（真正交付靠把餐点拖到骑手身上） */
  phoneAction() {
    const s = this.game.s;
    const d = (s.deliveries || []).find((x) => x.status === 'preview' || x.status === 'rider_arrived' || x.status === 'picked_up');
    if (!d) { this.toast(this.t('delivery.none')); return; }
    if (d.status === 'preview') this.toast(this.t(this.nameKey(d.item)) + ' · ' + this.t('delivery.pickupIn', { n: Math.max(0, Math.ceil((d.riderAt - s.time) / 1000)) }));
    else if (d.status === 'rider_arrived') this.toast(this.t('delivery.riderHere') + ' · ' + this.t('delivery.hand'));
    else this.toast(this.t('delivery.sending'));
  }
  /** 点击骑手：交付餐点（拖拽也可） */
  riderAction() {
    // 直接查「骑手已到店」的单，不复用手机展示态 dataset.did：
    // 手机可能正在展示「刚送达」的那一单，此时用 did 会查不到待交付单而静默无响应（L12）
    const list = (this.game.s && this.game.s.deliveries) || [];
    const d = list.find((x) => x.status === 'rider_arrived');
    if (!d) {
      const waiting = list.some((x) => x.status === 'preview' || x.status === 'scheduled');
      this.toast(waiting ? this.t('delivery.notYet') : this.t('delivery.none'));
      return;
    }
    let r;
    try {
      r = this.game.pickupDelivery(d.id);
    } catch (err) {
      // 与拖拽路径一致：配置类异常兜住并提示（M5 的 throw 不该变成「点了没反应」）
      console.error('[OWK] 外卖交付失败', err);
      r = { ok: false, reason: 'configError' };
    }
    if (r.ok) {
      this.toast(this.t('delivery.sending'));
    } else this.fail(r.reason);
    this.render();
  }

  // ================================================================ 成就页
  openAch() {
    this.renderAch();
    this.modal({
      title: this.t('ach.title'),
      closable: true,
      body: this.achBody(),
      actions: [{ label: this.t('btn.close'), primary: true }],
    });
  }

  achBody() {
    const st = this.catStore && this.catStore.ach ? this.catStore.ach : { unlocked: [], counters: {} };
    const unlocked = new Set(st.unlocked || []);
    const groups = { survival: 'ach.group.survival', biz: 'ach.group.biz', skill: 'ach.group.skill', challenge: 'ach.group.challenge', collect: 'ach.group.collect' };
    const list = this.ctx.config.achievements.list;
    const tiers = this.ctx.config.achievements.tiers || {};
    let html = '';
    for (const [g, titleKey] of Object.entries(groups)) {
      const rows = list.filter((a) => a.group === g);
      if (!rows.length) continue;
      html += `<div class="ach-group"><b>${this.t(titleKey)}</b>`;
      for (const a of rows) {
        const got = unlocked.has(a.id);
        const tier = tiers[a.difficulty];
        const tierLabel = tier ? this.t(tier.labelKey) : '';
        // v2.8：全部成就直接可见（名称 + 描述 + 难度 + 奖励），未解锁只做灰态区分
        html += `<div class="ach-row ${got ? 'got' : 'locked'}">
          <span class="ach-ic">${icon(got ? 'star' : 'close')}</span>
          <span class="ach-txt">
            <b>${this.t('ach.' + a.id)}</b>
            <i>${this.t('ach.' + a.id + '.desc')}</i>
          </span>
          ${tierLabel ? `<span class="ach-tier t-${a.difficulty || 'normal'}">${tierLabel}</span>` : ''}
          <em class="ach-reward">${icon('catcoin')}+${a.reward}</em>
        </div>`;
      }
      html += '</div>';
    }
    return html;
  }

  renderAch() { /* modal 内容由 achBody 生成，这里仅保留扩展点 */ }

  /** 成就达成 toast（可叠加排队） */
  showAchievements(list) {
    if (!list || !list.length) return;
    for (const a of list) {
      this.toast(this.t('ach.toast', { name: this.t('ach.' + a.id), n: a.reward }), 2500);
    }
  }


  // ============================================================ 小猫 / 猫猫币 / 皮肤商店
  /** 由启动器注入局外存档（猫猫币余额、已拥有皮肤、当前皮肤） */
  setCatStore(store) {
    this.catStore = Object.assign({ coins: 0, owned: ['orange'], skin: 'orange' }, store || {});
    if (!this.catStore.owned.includes(this.catStore.skin)) this.catStore.skin = this.catStore.owned[0] || 'orange';
    if (this.el && this.el.catcoin) this.el.catcoin.textContent = this.catStore.coins;
    this.applyCatSkin(true);
    this.syncMenuCat();
  }

  /** 皮肤只在切换时重绘 SVG，避免每帧重建 DOM */
  applyCatSkin(force) {
    if (!this.el || !this.el.catSvg) return;
    const skin = this.catStore.skin || 'orange';
    if (!force && this.catSkinApplied === skin) return;
    this.catSkinApplied = skin;
    this.el.catSvg.innerHTML = catSVG(skin);
  }

  syncMenuCat() {
    const b = $('#menu-cat-coins');
    if (b) b.textContent = this.catStore.coins;
  }

  /** 抚摸：三帧联动（坐姿 → 眯眼压扁 → 满足）+ CSS 形变做出 Q 弹 */
  petCat() {
    const now = performance.now();
    if (now - this.lastPet < 280) return;
    this.lastPet = now;
    const cat = this.el.cat;
    if (!cat) return;
    cat.classList.remove('petting', 'squish', 'happy');
    void cat.offsetWidth; // 强制回流，重启 CSS 动画
    cat.classList.add('petting', 'squish');
    clearTimeout(this.petTimerA);
    clearTimeout(this.petTimerB);
    this.petTimerA = setTimeout(() => { cat.classList.remove('squish'); cat.classList.add('happy'); }, 300);
    this.petTimerB = setTimeout(() => { cat.classList.remove('happy', 'petting'); }, 640);
    this.spawnHeart();
    this.sayFromCat();
  }

  // ---------------------------------------------------------------- 小猫气泡
  /**
   * v2.9：小猫随机气泡。
   *
   * 设计要点（对应用户提出的「不能出现今天是阴天却说天气真好」）：
   * 文案分两层——
   *   1. **状态文案**：由当前真实游戏状态（天气 / 顾客数 / 金币 / 灶台忙 / 有外卖 / 今天失败过）
   *      决定。天气类文案**按当日天气键一一对应**，晴天才可能说"天气真好"，
   *      不存在"随机抽到不合语境"的可能。
   *   2. **通用文案**：与天气无关，任何时候说都不矛盾（"今天好多顾客呀"这类）。
   * 打乱顺序避免连着重复，但**只从当前合法的池子里抽**。
   */
  catLinePool() {
    const s = this.game && this.game.s;
    const pool = [];
    // ---- 1. 天气类：严格按当日天气（这是"不能矛盾"的关键）----
    const wxKey = 'cat.bubble.' + ((s && s.weather) || 'sunny');
    //兜底也要跟着天气走。v2.9 初版这里错误地兜到了 sunny 文案，
      // 导致「下雨天也可能说今天天气真好」—— 正是用户明确要求避免的情况。
    if (this.t(wxKey)) pool.push(this.t(wxKey));
    else pool.push(this.t('cat.bubble.quiet'));
    // ---- 2. 客流类：按真实顾客数量 ----
    const n = s ? (s.customers || []).length : 0;
    if (n >= 3) { pool.push(this.t('cat.bubble.manyCustomers'), this.t('cat.bubble.crowded')); }
    else if (n === 0 && s && s.phase === 'day') pool.push(this.t('cat.bubble.quiet'));
    // ---- 3. 经济类：按当前金币 ----
    if (s && typeof s.coins === 'number') {
      pool.push(s.coins >= 200 ? this.t('cat.bubble.rich') : this.t('cat.bubble.poor'));
    }
    // ---- 4. 灶台 / 外卖 ----
    if (s && s.phase === 'day') {
      const busy = Object.values(s.stations || {}).some((st) => st.busy);
      if (busy) pool.push(this.t('cat.bubble.busy'));
      if ((s.deliveries || []).length) pool.push(this.t('cat.bubble.delivery'));
    }
    // ---- 5. 今天出过失败品 ----
    if (s && s.dayStats && (s.dayStats.waste || 0) > 0) pool.push(this.t('cat.bubble.fail'));
    // ---- 6. 兜底通用（永远不为空，且与天气无关）----
    pool.push(this.t('cat.bubble.quiet'));
    return pool.filter(Boolean);
  }

  /**
   * 让小猫说一句话。
   * @param {boolean} [force] 冷却中是否强制说出（冷却中只播冷却提示，不做游戏化播报）
   */
  sayFromCat(force) {
    const el = this.el.catBubble;
    if (!el) return;
    const now = performance.now();

    // 注意：lastSay 必须初始化为 -Infinity，而不是 0。
    // v2.9.1 真实 bug：初值 0 时 `performance.now() - 0 < 5000` 在开局头5 秒恒成立，
    // 导致玩家**第一次点猫就看到「让我歇一小会儿」**，像坏了。
    if (!force && this.lastSay !== -Infinity && now - this.lastSay < CAT_BUBBLE_CD_MS) {
      el.textContent = this.t('cat.bubble.cooldown');
      this.pulseBubble(true);
      return;
    }
    this.lastSay = now;

    // 轮换起点：上次那句排到最后，避免短时间内重复同一句
    const pool = this.catLinePool();
    let line = pool[0];
    if (pool.length > 1) {
      let i = this.sayCursor % pool.length;
      if (pool[i] === this.lastCatLine) i = (i + 1) % pool.length;
      line = pool[i];
      this.sayCursor = i + 1;
    }
    this.lastCatLine = line;

    el.textContent = line;
    this.pulseBubble();
    // 每次说话都配一声猫叫，让"气泡"和"音效"在感知上绑成一件事
    this.sfx(Math.random() < 0.5 ? 'cat_meow' : 'cat_happy');
  }

  /** 重播气泡弹出动画 */
  pulseBubble(cooling) {
    const el = this.el.catBubble;
    if (!el) return;
    el.classList.remove('show');
    el.classList.toggle('cooling', !!cooling);
    void el.offsetWidth; // 强制回流，确保连续点击也能重播
    el.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => el.classList.remove('show'), cooling ? 1400 : 2600);
  }

  spawnHeart() {
    const h = this.el.catHeart;
    if (!h) return;
    h.textContent = ['♥', '♪', '✦'][Math.floor(Math.random() * 3)];
    h.style.setProperty('--dx', (Math.random() * 26 - 13).toFixed(0) + 'px');
    h.classList.remove('pop');
    void h.offsetWidth;
    h.classList.add('pop');
  }

  // ---------------------------------------------------------------- 商店
  skinList() {
    const cfg = this.ctx.config.catSkins || {};
    const fallbackPrice = cfg.price != null ? cfg.price : 100;
    return (cfg.skins || []).map((sk) => ({
      id: sk.id,
      name: this.t(sk.nameKey),
      desc: this.t(sk.descKey),
      price: sk.price != null ? sk.price : fallbackPrice,
      theme: sk.theme || null,
      themeName: sk.themeName || '',
    }));
  }

  openShop() {
    const s = this.game.s;
    const inGame = s && s.phase === 'day' && !this.el.game.classList.contains('hidden');
    this.shopPaused = !!(inGame && !s.paused);
    if (this.shopPaused) this.game.togglePause();
    this.renderShop();
  }

  closeShop() {
    this.closeModal(); // 暂停恢复已在 closeModal 里统一收口（restoreShopPause）
    this.render();
  }

  /**
   * 主题卡的购买 / 切换按钮。
   * 设计前提是「皮肤即主题」—— 每套主题绑一只猫的皮肤，
   * 因此主题卡与猫皮肤共享同一份 owned / skin 状态，买主题＝同时解锁该猫皮肤，不存在二次付费。
   */
  shopBtnHTML(sk) {
    const store = this.catStore;
    if (store.skin === sk.id) return `<button class="btn sm" disabled>${this.t('shop.inUse')}</button>`;
    if (store.owned.includes(sk.id)) return `<button class="btn sm primary" data-skin-use="${sk.id}">${this.t('shop.use')}</button>`;
    const afford = store.coins >= sk.price;
    return `<button class="btn sm ${afford ? 'primary' : ''}" data-skin-buy="${sk.id}" ${afford ? '' : 'disabled'}>
      ${sk.price === 0 ? this.t('shop.free') : this.t('shop.buy', { n: sk.price })}</button>`;
  }

  /**
   * 主题预览卡：不写死颜色，全部取该皮肤 theme 里的真实配色，
   * 拼一间「迷你小店」（墙 + 招牌 + 两块键帽 + 一行描边色），深浅主题都不会撞色。
   */
  themeCardHTML(sk) {
    const th = sk.theme;
    // 主题商店只展示主题：没有主题数据的皮肤不进卡，避免回落到小猫名
    if (!th || !sk.themeName) return '';
    const inUse = this.catStore.skin === sk.id;
    return `<div class="th-card ${inUse ? 'inuse' : ''}">
      <div class="th-prev" style="background:${th.bg};border-color:${th.line}">
        <span class="th-wall" style="background:${th.paper2};border-color:${th.line}"></span>
        <span class="th-sign" style="background:${th.gold}"></span>
        <span class="th-key k1" style="background:${th.keycapSide}"></span>
        <span class="th-key k2" style="background:${th.keycapTop}"></span>
        <i class="th-ink" style="background:${th.ink2}"></i>
        ${inUse ? `<em class="th-now">${this.t('shop.inUse')}</em>` : ''}
      </div>
      <b class="th-name">${sk.themeName}</b>
      ${this.shopBtnHTML(sk)}
    </div>`;
  }

  /**
   * 主题商店（v2.7 起单页）：只陈列 8 套主题，不再单独陈列小猫。
   * 「皮肤即主题」语义不变 —— 每套主题绑定一只猫的皮肤，买/换主题时
   * useSkin() / buySkin() 会同时应用猫皮肤与该主题，所以猫的样子由主题决定；
   * 页面底部用一行小字说明这一点，不再需要独立的猫咪分页或入口。
   */
  renderShop() {
    const store = this.catStore;
    const list = this.skinList();
    const cards = list.map((sk) => this.themeCardHTML(sk)).join('');

    this.modal({
      title: `${this.t('shop.title')}
        <span class="catbal">${icon('catcoin')}<b>${store.coins}</b></span>`,
      closable: true,
      onClose: () => this.render(),
      body: `<div class="th-grid">${cards}</div>
         <p class="p small">${this.t('shop.hint')}</p>`,
      footNote: this.t('shop.themeHint'),
      actions: [{ label: this.t('btn.close'), primary: true, onClick: () => this.closeShop() }],
    });

    $$('[data-skin-use]', this.el.modal).forEach((b) => {
      b.onclick = () => this.useSkin(b.dataset.skinUse);
    });
    $$('[data-skin-buy]', this.el.modal).forEach((b) => {
      b.onclick = () => this.buySkin(b.dataset.skinBuy);
    });
  }

  useSkin(id) {
    if (!this.catStore.owned.includes(id)) return;
    this.catStore.skin = id;
    this.applyCatSkin(true);
    this.applyTheme(id); // 皮肤即主题：整体视觉随皮肤切换
    this.commitCatStore();
    this.renderShop();
  }

  buySkin(id) {
    const sk = this.skinList().find((x) => x.id === id);
    if (!sk) return;
    if (this.catStore.owned.includes(id)) { this.useSkin(id); return; }
    if (this.catStore.coins < sk.price) { this.toast(this.t('shop.short')); return; }
    this.catStore.coins -= sk.price;
    this.catStore.owned.push(id);
    this.catStore.skin = id;
    this.applyCatSkin(true);
    this.applyTheme(id); // 买皮肤同时解锁并应用该主题
    this.sfx('purchase');
    this.commitCatStore();
    this.toast(`${sk.name} ✓`);
    this.renderShop();
  }

  commitCatStore() {
    if (this.el && this.el.catcoin) this.el.catcoin.textContent = this.catStore.coins;
    this.syncMenuCat();
    if (this.onCatStore) this.onCatStore(this.catStore);
  }

  saveNow() {
    if (this.onSave) this.onSave(this.game.snapshot());
  }
}
