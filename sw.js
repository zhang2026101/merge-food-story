// 食合物语 Service Worker —— 全量离线缓存
// 首次联网加载后，断网（飞行模式）也能完整运行。
const CACHE = 'owk-v40';

// v2.12：代码 / 配置类资源改「网络优先」。
//
// 原来这里对**所有**资源都用 cache-first。后果是：发版后旧 sw 仍然从缓存里
// 端出旧的 src/*.js，玩家必须**刷新两次**（第一次装新 sw、第二次才用新缓存）
// 才看得到改动 —— 实测用户会直接判定「更新没生效 / 还是旧的」。
// 现在 js / css / json 一律先走网络，拿到就回填缓存；断网时再回退缓存。
// 静态图片仍用 cache-first（体积大、几乎不变，没必要每次重下）。
const NETWORK_FIRST = /\.(?:js|mjs|css|json|webmanifest)$/i;

const SHELL = [
  './',
  './index.html',
  './pwa/manifest.webmanifest',
  './pwa/icons/icon-192.png',
  './pwa/icons/icon-512.png',
  './pwa/icons/icon-maskable-512.png',
  // 游戏本体
  './src/style.css',
  './src/main.js',
  './src/config.js',
  './src/engine.js',
  './src/view.js',
  './src/art.js',
  './src/audio.js',
  // 权威配置
  './owk_handoff_config.json',
  './owk_handoff_crafts.json',
  './owk_handoff_layout.json',
  './owk_handoff_i18n.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 只缓存同源资源

  // ① 导航请求：网络优先，失败时回退已缓存首页（离线可进入）
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // 顺手把最新首页回填，保证离线时拿到的是最近一次成功的版本
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // ② 代码 / 配置：网络优先（否则发版后玩家会一直看到旧界面，见文件头说明）
  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // ③ 其余资源（图片等）：缓存优先，未命中则网络拉取并回填缓存
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // 只回填成功响应：404/500 一旦写进缓存，cache-first 会永久命中这张错误页
        if (res && res.ok && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
    })
  );
});
