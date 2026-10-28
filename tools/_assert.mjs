// 断言基础设施（纯 Node，零依赖）
// 供 tools/test-engine.mjs 与 7 个巡检脚本共用，统一「严格比较 + 单条断言不炸整轮」的行为。

/**
 * 严格深比较
 * - 基本类型按 Object.is：NaN 与 NaN 判等、NaN 与 null/undefined 判不等、-0 与 0 判不等
 * - 数组 / 普通对象按键集合递归比较（键数量与键名都必须一致）
 * 这修掉了旧实现的致命缺陷：JSON.stringify(NaN) 与 JSON.stringify(null) 都是 "null"，
 * 于是 162 条断言里「拿到 NaN 却期望 null」这种真错会被判成通过。
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** 打印用的值格式化（NaN / ±Infinity / -0 不伪装成 null） */
export function fmt(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return v !== v ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity');
  if (typeof v === 'number' && Object.is(v, -0)) return '-0';
  if (v === undefined) return 'undefined';
  if (typeof v === 'bigint') return `${v}n`;
  try {
    return JSON.stringify(v, (k, val) => {
      if (typeof val === 'number' && !Number.isFinite(val)) return `#${val}`;
      return val;
    }) ?? String(v);
  } catch (e) {
    return String(v);
  }
}

/** 取异常首行，避免整段堆栈刷屏 */
function errLine(e) {
  const msg = String((e && e.message) || e);
  return msg.split('\n')[0];
}

/**
 * 创建断言套件
 * - ok(id, cond, msg)：cond 可以是布尔值，也可以是**函数**（thunk）。
 *   传函数时会在 try/catch 内求值，因此 `() => g.s.stations.food.output.key` 这种
 *   「output 为 null 就抛错」的断言只会记一条 fail，不会中断后面所有断言（M18）。
 * - eq(id, a, b, msg)：a / b 同样支持 thunk，用 deepEqual 比较。
 * - finish()：打印汇总；有失败则 process.exit(1)。
 * @param {{exitOnFail?: boolean}} [opts]
 */
export function createSuite(opts = {}) {
  const exitOnFail = opts.exitOnFail !== false;
  let pass = 0;
  const fails = [];
  const warns = [];

  /** 已知缺陷：打印 ⚠ 并汇总，但**不计入失败**（避免长期红灯；问题必须在报告里跟踪） */
  const warn = (id, msg) => {
    warns.push(`${id} ${msg}`);
    console.log(`  ⚠ ${id} ${msg}`);
  };

  const record = (id, good, msg) => {
    if (good) {
      pass += 1;
      console.log(`  ✓ ${id} ${msg || ''}`);
      return true;
    }
    fails.push(`${id} ${msg || ''}`.trim());
    console.log(`  ✗ ${id} ${msg || ''}`);
    return false;
  };

  const evalArg = (v) => (typeof v === 'function' ? v() : v);

  function ok(id, cond, msg = '') {
    try {
      return record(id, !!evalArg(cond), msg);
    } catch (e) {
      return record(id, false, `${msg} — 抛错 ${errLine(e)}`.trim());
    }
  }

  function eq(id, a, b, msg = '') {
    let va;
    let vb;
    try {
      va = evalArg(a);
    } catch (e) {
      return record(id, false, `${msg} — 左值抛错 ${errLine(e)}`.trim());
    }
    try {
      vb = evalArg(b);
    } catch (e) {
      return record(id, false, `${msg} — 右值抛错 ${errLine(e)}`.trim());
    }
    return ok(id, deepEqual(va, vb), `${msg} (got ${fmt(va)}, want ${fmt(vb)})`.trim());
  }

  /** 区块级隔离：整块抛错只记一条 SEC 失败，后续区块继续跑 */
  function section(title, fn) {
    console.log(`\n— ${title} —`);
    try {
      return fn();
    } catch (e) {
      return record(`SEC:${title}`, false, `区块抛错 ${errLine(e)}`);
    }
  }

  function finish(label = '结果') {
    if (warns.length) {
      console.log(`\n已知缺陷（不计入失败，见实施记录）：\n - ${warns.join('\n - ')}`);
    }
    console.log(`\n${label}：${pass} 通过 / ${fails.length} 失败`
      + (warns.length ? ` / ${warns.length} 已知缺陷` : ''));
    if (fails.length) {
      console.log('失败项：\n - ' + fails.join('\n - '));
      if (exitOnFail) process.exit(1);
      return false;
    }
    console.log(`✓ ${pass} 项`);
    return true;
  }

  return { ok, eq, section, warn, finish, get pass() { return pass; }, get fails() { return fails; }, get warns() { return warns; } };
}
