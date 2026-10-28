# PWA 脚手架使用说明（让游戏在手机/电脑均可"安装"并断网运行）

本目录是为实现 Agent 准备的 **PWA（渐进式 Web 应用）脚手架**。游戏本身是纯前端网页，
加上下面几样东西后，就能在 **桌面（Chrome/Edge 一键安装为 App）**、**Android（添加到主屏幕）**、
**iOS（Safari 分享→添加到主屏幕，全屏运行）** 全部"可安装"，且首次联网加载后**断网可用**，无需写两套代码。

## 1. 已提供的文件（在 handoff 根目录 / pwa 目录）
- `handoff/sw.js` —— Service Worker（根作用域，运行时全量缓存同源资源，离线可用）。
- `pwa/manifest.webmanifest` —— 应用名、图标、全屏显示模式。
- `pwa/icons/` —— 由 `pwa/gen_icons.py` 生成的占位图标（实现中后期替换为真实简笔画）。
- 入口 `handoff/index.html` 已包含 manifest 链接、iOS meta、SW 注册脚本，**无需再手动加**。

## 2. 图标尺寸（必须，缺任意一张部分平台不显示"安装"）
| 文件 | 尺寸 | 用途 |
|---|---|---|
| `pwa/icons/icon-192.png` | 192×192 | 安装图标 / 桌面 |
| `pwa/icons/icon-512.png` | 512×512 | 启动图 / 高分屏 |
| `pwa/icons/icon-maskable-512.png` | 512×512 | Android 自适应图标（四周留安全边距 40%） |

> 简笔画风格即可，描边 #2B2B2B，纯色填充，符合主游戏视觉规范。运行 `python pwa/gen_icons.py`（在 handoff/ 下）即可生成占位图。

## 3. 接入状态（index.html 已就绪，供核对）
```html
<link rel="manifest" href="./pwa/manifest.webmanifest" />
<link rel="apple-touch-icon" href="./pwa/icons/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#2B2B2B" />
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
</script>
```
> SW 注册路径是根目录 `./sw.js`（与 `index.html` 同级），作用域覆盖整个 handoff/，因此能缓存 `index.html` 及全部 `src/`、`pwa/` 资源。

## 4. 验收
- 桌面 Chrome/Edge 地址栏出现"安装"图标，点击后作为独立窗口运行（无地址栏）。
- Android "添加到主屏幕"后出现启动图标；**离线（飞行模式）也能进入游戏**。
- iOS Safari "分享→添加到主屏幕"后主屏出现图标，打开为全屏；离线可开。
- Lighthouse → PWA → Installable 通过（manifest 合法 + SW 已注册）。

## 5. 上线发布（网页端可运行 + 安装）
静态站点即可，PWA 安装前提是 **HTTPS（localhost 调试除外）**：
- WorkBuddy 内置 `sites` 技能：发布为在线链接，自动获得 HTTPS。
- 其它静态托管：GitHub Pages / Vercel / Netlify / 任意支持 HTTPS 的静态空间。

## 6. 进阶（可选，非必需）
- 应用商店版（.exe / .apk / .ipa）：用 **Tauri**（最轻）或 **Capacitor** 把网页包成原生壳。
- 跨设备云存档：接入 `cloud-service`（数据库 + 登录），否则用 `localStorage` 本地存档即可。
