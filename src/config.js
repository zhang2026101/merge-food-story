// 食合物语 —— 配置层
// 铁律：所有数值一律从 owk_handoff_*.json 读取，代码中不硬编码任何金币/成本/价格/等级数值。

const CFG_DIR = new URL('../', import.meta.url);

const FILES = {
  config: 'owk_handoff_config.json',
  crafts: 'owk_handoff_crafts.json',
  layout: 'owk_handoff_layout.json',
  i18n: 'owk_handoff_i18n.json',
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url.pathname || url} (${res.status})`);
  return res.json();
}

export async function loadAll() {
  const keys = Object.keys(FILES);
  const list = await Promise.all(keys.map((k) => fetchJSON(new URL(FILES[k], CFG_DIR))));
  const bag = {};
  keys.forEach((k, i) => { bag[k] = list[i]; });
  return buildCtx(bag.config, bag.crafts, bag.layout, bag.i18n);
}

/** 无序集合的键：排序后拼接，投放顺序不影响结果 */
export function key2(keys) {
  return [...keys].sort().join('+');
}

export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 确定性伪随机（mulberry32） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCtx(config, crafts, layout, i18n) {
  const byId = new Map(crafts.recipes.map((r) => [r.id, r]));
  const intermediates = new Set(crafts.intermediates || []);

  // 两输入合成表（无序键）
  // 配方表已无 modes 字段：多分支匹配机制自 v1.4 移除「加冰开关」后废弃
  // （加冰改为普通配方 cola + ice → icedCola），这里只按下标 inputs 建表。
  const table = new Map();
  for (const r of crafts.recipes) {
    if (r.inputs && r.inputs.length === 2) {
      table.set(key2(r.inputs), { recipeId: r.id, cost: r.thisCost, mode: 'base' });
    }
  }

  const t = (key, vars) => {
    let s = i18n[key] != null ? i18n[key] : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  };

  const priceOf = (id) => {
    const r = byId.get(id);
    return r && typeof r.price === 'number' ? r.price : 0;
  };

  const leafCost = (key) => {
    const v = config.ingredients[key];
    return typeof v === 'number' ? v : 0;
  };

  const kindOf = (id) => {
    if (id === 'fail') return 'fail';
    if (intermediates.has(id)) return 'intermediate';
    const r = byId.get(id);
    if (r && (r.type === 'food' || r.type === 'drink')) return 'product';
    if (config.ingredients[id] != null) return 'leaf';
    return 'unknown';
  };

  const typeOf = (id) => {
    const r = byId.get(id);
    return r ? r.type : null; // 'food' | 'drink' | 'intermediate'
  };

  /**
   * 合成判定（纯函数）
   * 两输入无序匹配；冰已是基础材料，不再有「加冰开关」特例。
   * @param {string[]} keys 两个输入的 key
   */
  const matchCraft = (keys) => {
    if (!keys || keys.length !== 2 || keys.some((k) => !k)) return null;
    return table.get(key2(keys)) || null;
  };

  return {
    config, crafts, layout, i18n,
    byId, intermediates, table,
    t, priceOf, leafCost, kindOf, typeOf, matchCraft,
    key2, hash, mulberry32,
  };
}
