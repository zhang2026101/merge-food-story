// 食合物语 —— 简笔画素材（内联 SVG）
// 规范：描边 #2B2B2B、圆角端点、纯色填充、无渐变/无粒子。

const INK = '#2B2B2B';
const SW = 4.4;

function svg(inner, vb = '0 0 96 96') {
  return `<svg class="ic" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const SHAPES = {
  // ---------------- 叶食材 ----------------
  bread: `<path d="M16 64V50c0-13 14-22 32-22s32 9 32 22v14a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z" fill="#F0C27C"/><path d="M30 42l3 8M45 38l3 8M60 42l3 8" stroke="#C9903F"/>`,
  patty: `<ellipse cx="48" cy="57" rx="30" ry="14" fill="#A9704B"/><ellipse cx="48" cy="47" rx="30" ry="14" fill="#BE855C"/><path d="M28 44h7M42 41h7M56 44h7" stroke="#8A5A3C"/>`,
  potato: `<path d="M27 40c6-13 25-16 35-6s9 27-5 33-27 2-32-9c-3-6-2-12 2-18z" fill="#D9B36C"/><circle cx="40" cy="47" r="2.6" fill="#2B2B2B" stroke="none"/><circle cx="57" cy="58" r="2.6" fill="#2B2B2B" stroke="none"/>`,
  // 糖浆：细高琥珀色玻璃瓶 + 深色木塞 + 滴落感，与番茄酱的矮胖红瓶明确区分
  syrup: `<rect x="41" y="13" width="14" height="8" rx="2.5" fill="#6B4A34"/><path d="M44 21h8v12h-8z" fill="#E0A62F"/><path d="M38 33h20v36a10 10 0 0 1-10 10 10 10 0 0 1-10-10z" fill="#F5BE4B"/><path d="M42 40v18" stroke="#FFD98A"/><rect x="40" y="47" width="16" height="15" rx="2.5" fill="#FFFDF8"/><path d="M48 50c2.6 3.2 3.6 4.8 3.6 6.2a3.6 3.6 0 0 1-7.2 0c0-1.4 1-3 3.6-6.2z" fill="#E0A62F" stroke="none"/>`,
  ice: `<rect x="26" y="28" width="44" height="42" rx="7" fill="#D7EDF7"/><path d="M40 28v42M26 49h44" stroke="#8FB9CB"/>`,
  coffeeBean: `<g transform="rotate(-20 48 48)"><ellipse cx="48" cy="48" rx="21" ry="30" fill="#6B4A34"/><path d="M48 21c-9 11-9 44 0 55" stroke="#F3E7D6" stroke-width="4"/></g>`,
  water: `<path d="M48 18c13 17 20 27 20 37a20 20 0 0 1-40 0c0-10 7-20 20-37z" fill="#C3E2F1"/><path d="M37 58c0 7 4 11 10 11" stroke="#7FB6D0"/>`,
  dough: `<circle cx="48" cy="50" r="25" fill="#F1DDA9"/><path d="M32 46c9-7 23-7 32 0M34 59c9 5 20 5 28 0" stroke="#D8C08A"/>`,
  // 番茄酱：矮胖红瓶 + 挤嘴 + 标签上的番茄，形状与糖浆完全不同
  ketchup: `<path d="M46 15h4v6h-4z" fill="#8E2F22"/><rect x="43" y="21" width="10" height="9" rx="2" fill="#B33E2E"/><path d="M31 30h34v25a11 11 0 0 1-11 11H42a11 11 0 0 1-11-11z" fill="#D0402F"/><path d="M35 38v14" stroke="#EE6A55"/><rect x="36" y="44" width="24" height="19" rx="3.5" fill="#FFF7F2"/><circle cx="48" cy="54" r="5.2" fill="#E4593F" stroke="none"/><path d="M48 49l-3.5-3M48 49l3.5-3" stroke="#6FAE5B" stroke-width="3"/>`,
  cheese: `<path d="M16 66h64V48L16 40z" fill="#F5C445"/><circle cx="32" cy="55" r="4" fill="#FFF0BE" stroke="none"/><circle cx="52" cy="57" r="5" fill="#FFF0BE" stroke="none"/><circle cx="66" cy="53" r="3.4" fill="#FFF0BE" stroke="none"/>`,
  lettuce: `<circle cx="48" cy="50" r="26" fill="#93C479"/><path d="M30 40c7-7 13-9 18-9M46 25c7 2 12 7 15 12M29 58c9 9 24 11 37 2" stroke="#5F9450"/>`,
  tomato: `<circle cx="48" cy="54" r="23" fill="#E0593F"/><path d="M48 33c-5-9-14-10-18-7 4 6 10 8 18 7z" fill="#8FC177"/><path d="M48 33c5-9 14-10 18-7-4 6-10 8-18 7z" fill="#8FC177"/><path d="M48 33v-9" stroke="#5F9450"/>`,
  milk: `<path d="M34 38l7-14h14l7 14v38a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4z" fill="#F7F3E9"/><path d="M34 50h28" stroke="#9AC4DE"/><path d="M41 24h14v8H41z" fill="#E9E2D2"/>`,
  iceCream: `<path d="M36 46h24L48 84z" fill="#E8B45F"/><path d="M41 54l7 10M55 54l-7 10" stroke="#C9903F"/><circle cx="48" cy="34" r="16" fill="#F3B6C3"/><path d="M39 28c5-7 16-7 19 1" stroke="#D98FA0"/>`,
  teaBag: `<rect x="28" y="42" width="30" height="32" rx="4" fill="#EFE3C4"/><path d="M36 52h14M36 60h14" stroke="#C9B896"/><path d="M58 46l10-9"/><rect x="66" y="27" width="14" height="11" rx="2" fill="#F5C445"/>`,

  // ---------------- 成品 ----------------
  burger: `<path d="M16 44c0-14 14-22 32-22s32 8 32 22z" fill="#F0C27C"/><rect x="16" y="46" width="64" height="8" rx="4" fill="#93C479"/><rect x="18" y="55" width="60" height="11" rx="5.5" fill="#A9704B"/><path d="M20 67h56v5a9 9 0 0 1-9 9H29a9 9 0 0 1-9-9z" fill="#F0C27C"/><path d="M32 36h4M44 32h4M56 36h4" stroke="#C9903F"/>`,
  signatureBurger: `<path d="M62 9v17" stroke="#8A5A3C" stroke-width="2.6"/><path d="M62 9l15 4.5-15 4.5z" fill="#E0593F"/>
    <path d="M14 46c0-15 15-24 34-24s34 9 34 24z" fill="#F0C27C"/>
    <path d="M27 34c4-4 9-6 14-6M53 28c6 1 10 3 14 6" stroke="#C9903F" stroke-width="2.4"/>
    <path d="M13 46h70l-4 7H17z" fill="#F5C445"/>
    <path d="M21 53c2 4 5 5 8 5M37 53c2 4 5 5 8 5M53 53c2 4 5 5 8 5" stroke="#E0A62F" stroke-width="2.2"/>
    <path d="M14 56h68c-3 6-9 9-14 9H28c-5 0-11-3-14-9z" fill="#93C479"/>
    <rect x="15" y="64" width="66" height="9" rx="4.5" fill="#A9704B"/>
    <rect x="17" y="72" width="62" height="9" rx="4.5" fill="#BE855C"/>
    <path d="M16 81h64v1a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10z" fill="#F0C27C"/>`,
  fries: `<path d="M34 40V24M44 40V20M54 40V22M63 40V26" stroke="#F5C445" stroke-width="8"/><path d="M30 40h36l-4 38a5 5 0 0 1-5 4H39a5 5 0 0 1-5-4z" fill="#D94F3D"/><path d="M36 54h24" stroke="#FFFDF8"/>`,
  cola: `<path d="M32 38h32l-4 40a5 5 0 0 1-5 4H41a5 5 0 0 1-5-4z" fill="#D94F3D"/><path d="M35 44h26" stroke="#B33E2E"/><rect x="29" y="31" width="38" height="9" rx="4.5" fill="#F7F3E9"/><path d="M56 31l7-18"/><path d="M38 58h9" stroke="#FFFDF8"/>`,
  icedCola: `<path d="M32 38h32l-4 40a5 5 0 0 1-5 4H41a5 5 0 0 1-5-4z" fill="#D94F3D"/><path d="M37 52h9v9h-9z" fill="#EAF6FB" stroke="#B9D9E6"/><path d="M49 62h8v8h-8z" fill="#EAF6FB" stroke="#B9D9E6"/><rect x="29" y="31" width="38" height="9" rx="4.5" fill="#F7F3E9"/><path d="M56 31l7-18"/>`,
  // 咖啡：矮宽陶瓷杯 + 杯碟 + 深棕液面 + 心形拉花 + 两道热气（与高瘦玻璃杯的茶明确区分）
  coffee: `<ellipse cx="48" cy="82" rx="27" ry="6.5" fill="#E7DCD0"/><path d="M23 38h42v16a21 21 0 0 1-21 21 21 21 0 0 1-21-21z" fill="#FBF7EE"/><path d="M65 44h6.5a8.5 8.5 0 0 1 0 17H65"/><ellipse cx="44" cy="40" rx="21" ry="6" fill="#5A3A24"/><path d="M44 36.6c-2.4-2.4-5.6-1-5.6 1.3 0 1.9 2.8 3.4 5.6 5.2 2.8-1.8 5.6-3.3 5.6-5.2 0-2.3-3.2-3.7-5.6-1.3z" fill="#E4CDA8" stroke="none"/><path d="M33 24c-3.2-5 3-7 0-12M47 22c-3.2-5 3-7 0-12" stroke="#C6BEAE"/>`,
  salad: `<path d="M18 50h60c0 16-13 26-30 26S18 66 18 50z" fill="#F7F3E9"/><circle cx="36" cy="44" r="11" fill="#93C479"/><circle cx="50" cy="39" r="12" fill="#A8D08D"/><circle cx="62" cy="46" r="10" fill="#93C479"/><circle cx="46" cy="51" r="4.5" fill="#E0593F" stroke="none"/><circle cx="58" cy="53" r="4" fill="#E0593F" stroke="none"/>`,
  pizza: `<path d="M48 16L80 74H16z" fill="#F5C445"/><path d="M23 69h50" stroke="#D9A63B" stroke-width="7"/><circle cx="48" cy="48" r="5" fill="#D94F3D" stroke="none"/><circle cx="37" cy="62" r="4.5" fill="#D94F3D" stroke="none"/><circle cx="58" cy="63" r="4.5" fill="#D94F3D" stroke="none"/>`,
  milkshake: `<path d="M32 44h32l-4 34a5 5 0 0 1-5 4H41a5 5 0 0 1-5-4z" fill="#F7F3E9"/><path d="M32 44c0-11 7-17 16-17s16 6 16 17z" fill="#F3B6C3"/><path d="M54 28l7-15"/><circle cx="50" cy="21" r="5" fill="#D94F3D"/><path d="M37 58h22" stroke="#E7DCD0"/>`,
  icedTea: `<path d="M34 30h28l-3 46a5 5 0 0 1-5 4H42a5 5 0 0 1-5-4z" fill="#F8E7C8"/><path d="M34 44h28" stroke="#D9A63B"/><path d="M40 52h9v9h-9z" fill="#FFFDF8" stroke="#B9D9E6"/><path d="M52 64h8v7h-8z" fill="#FFFDF8" stroke="#B9D9E6"/><circle cx="64" cy="32" r="9" fill="#F5C445"/><path d="M64 23v18M55 32h18" stroke="#E0B02F"/>`,
  // 芝士薯条（薯条 + 芝士）：红纸盒薯条为底，上面盖一层融化芝士，靠「黄帽子 + 滴落」区别于纯薯条
  cheeseFries: `<path d="M34 34V20M44 34V16M54 34V18M63 34V22" stroke="#F5C445" stroke-width="8"/><path d="M30 34h36l-4 44a5 5 0 0 1-5 4H39a5 5 0 0 1-5-4z" fill="#D94F3D"/><path d="M39 62h24" stroke="#FFFDF8"/><path d="M29 32c6-7 15-3 21-6s14 2 17 7c1.8 3-1 6.5-5 7-4 .6-5 6-9.5 6.6-4.4.6-6-5-11-4-4.6.8-6 4.6-10 3-4-1.7-5.6-9-2.5-13.6z" fill="#F5C445"/><circle cx="40" cy="37" r="2.6" fill="#FFF0BE" stroke="none"/><circle cx="55" cy="34" r="3" fill="#FFF0BE" stroke="none"/>`,
  // 拿铁（咖啡 + 牛奶）：细长玻璃杯 + 底部深咖 + 顶部奶泡 + 奶泡上的拉花心
  latte: `<path d="M33 30h30l-3.5 48a5 5 0 0 1-5 4.5H41.5a5 5 0 0 1-5-4.5z" fill="#F7F3E9"/><path d="M35.6 50h24.8l-2.9 28a5 5 0 0 1-5 4.5H43.5a5 5 0 0 1-5-4.5z" fill="#B07A4A" stroke="none"/><path d="M35 50h26" stroke="#D9C3A6"/><ellipse cx="48" cy="30" rx="15" ry="5" fill="#FFFDF8"/><path d="M48 33.6c-2.4-2.4-5.8-1-5.8 1.4 0 1.9 2.9 3.4 5.8 5.3 2.9-1.9 5.8-3.4 5.8-5.3 0-2.4-3.4-3.8-5.8-1.4z" fill="#C99A63" stroke="none"/><path d="M57 28l7-16" stroke="#F5F1E8" stroke-width="5"/><rect x="31" y="26" width="34" height="8" rx="4" fill="#F7F3E9"/>`,
  // 奶茶（茶 + 牛奶）：矮胖珍珠杯 —— 奶茶色杯身 + 杯底一串深色珍珠 + 粗吸管，与拿铁的细高杯形区分
  milkTea: `<path d="M56 24l7-16" stroke="#8FC177" stroke-width="7"/><path d="M30 30h36l-5 48a5 5 0 0 1-5 4.5H40a5 5 0 0 1-5-4.5z" fill="#E8CBA0"/><path d="M32.4 52h31.2l-3.6 26a5 5 0 0 1-5 4.5H41a5 5 0 0 1-5-4.5z" fill="#C99A63" stroke="none"/><circle cx="42" cy="70" r="3.4" fill="#5A3A24" stroke="none"/><circle cx="52" cy="74" r="3.4" fill="#5A3A24" stroke="none"/><circle cx="59" cy="67" r="3" fill="#5A3A24" stroke="none"/><circle cx="47" cy="63" r="2.8" fill="#5A3A24" stroke="none"/><ellipse cx="48" cy="30" rx="19" ry="5" fill="#F7F3E9"/><path d="M35 30h26" stroke="#E7DCD0"/>`,
  // 薯饼（土豆 + 番茄酱）：扁平金黄圆饼 + 表面煎纹 + 右下角一小碟番茄酱
  hashBrown: `<ellipse cx="70" cy="72" rx="15" ry="9.5" fill="#F7F3E9"/><ellipse cx="70" cy="71" rx="10" ry="6" fill="#D0402F"/><ellipse cx="48" cy="48" rx="30" ry="21" fill="#E8B45F"/><ellipse cx="48" cy="45" rx="30" ry="21" fill="#F0C27C"/><path d="M26 36c8-5 15 4 23 0s14 4 21 0M25 52c8-5 16 4 24 0s14 4 22 0M29 62c7-4 13 3 20 0s12 3 18 0" stroke="#D9A63B" stroke-width="2.8"/>`,

  // ---------------- 中间产物 ----------------
  vegPatty: `<ellipse cx="48" cy="57" rx="30" ry="14" fill="#A9704B"/><ellipse cx="48" cy="47" rx="30" ry="14" fill="#BE855C"/><path d="M28 44c5-4 9 2 14-1s9 2 14-1" stroke="#93C479" stroke-width="4"/><circle cx="37" cy="53" r="3" fill="#93C479" stroke="none"/><circle cx="56" cy="51" r="3" fill="#93C479" stroke="none"/>`,
  pizzaBase: `<circle cx="48" cy="50" r="29" fill="#F1DDA9"/><circle cx="48" cy="50" r="21" fill="#D94F3D"/><circle cx="41" cy="44" r="3" fill="#E87763" stroke="none"/><circle cx="56" cy="56" r="3" fill="#E87763" stroke="none"/>`,
  milkBase: `<path d="M32 32h32v44a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4z" fill="#F7F3E9"/><path d="M32 50h32v30H32z" fill="#F3E2CE" stroke="none"/><path d="M32 50h32"/><rect x="30" y="23" width="36" height="9" rx="3" fill="#9AC4DE"/>`,
  // 热茶：高瘦玻璃杯 + 琥珀茶汤 + 垂在杯外的茶包标签 + 热气（无冰块，区别于冰茶）
  tea: `<path d="M32 24h32v44a9 9 0 0 1-9 9H41a9 9 0 0 1-9-9z" fill="#EAF4F8"/><path d="M35.5 47h25v21a6.5 6.5 0 0 1-6.5 6.5H42a6.5 6.5 0 0 1-6.5-6.5z" fill="#CE9550" stroke="none"/><ellipse cx="48" cy="24" rx="16" ry="4.5" fill="#F6FBFD"/><path d="M32 70h16" stroke="#BBD9E6"/><path d="M63 28l12-7" stroke-width="3"/><rect x="72" y="12" width="14" height="11" rx="2.5" fill="#C89A5B"/><path d="M40 16c-3-4 3-6 0-10M54 14c-3-4 3-6 0-10" stroke="#C6BEAE"/>`,

  // v2.10 失败品：照用户给的参考图重画的「扎口垃圾袋」。
  //
  // 造型四要素（缺一个就认不出是垃圾袋）：
  //   ① 波浪袋口（扎口后上方散开的褶皱）② 束口圈（椭圆绑带 + 一道压痕）
  //   ③ 宽底圆肚的袋身 ④ 右下一道高光弧
  // 上一版（v2.9.1）为了"轻"做成了纯线条，在 46px 的格子里只剩几根线，
  // 语义反而丢了；这一版按参考图改回**浅灰平涂 + 深色描边**（无渐变、无阴影、无背景），
  // 与项目其它图标同一套画法，小尺寸下靠"灰色实心团块"一眼可辨。
  fail: `<g stroke="#3A3A42" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M36 41C28 38 23 31 25 26c2-5 9-4 12 1-3-8 0-16 7-16 6 0 7 8 5 15 3-8 10-12 14-9 5 3 3 11-1 16 4-1 8 1 7 5-.5 2-3 2.5-6 3z" fill="#CFCFD6"/>
    <path d="M36 41c-14 8-24 19-24 28 0 11 14 19 36 19s36-8 36-19c0-9-10-20-24-28z" fill="#D6D6DC"/>
    <rect x="34" y="37" width="28" height="8.5" rx="4.2" fill="#B9B9C3"/>
    <path d="M38 41.2h20" stroke="#8E8E9A" stroke-width="2.2"/>
    <path d="M40 46c-3 5-4 9-3 13M48 46v11M56 46c3 5 4 9 3 13" stroke="#8E8E9A" stroke-width="3"/>
    <path d="M56 80c6-2 11-7 12-13" stroke="#FCFCFF" stroke-width="6"/>
  </g>`,

  // ---------------- 图标 ----------------
  // ---------------- 天气图标 -------------
  wxSun: `<circle cx="48" cy="48" r="17" fill="#F5C445"/><path d="M48 13v9M48 74v9M13 48h9M74 48h9M24 24l6.5 6.5M65.5 65.5L72 72M72 24l-6.5 6.5M30.5 65.5L24 72" stroke="#E0A62F" stroke-width="4.4"/>`,
  wxCloud: `<path d="M31 69h35a13.5 13.5 0 0 0 1-27 18 18 0 0 0-34-3 11 11 0 0 0-2 30z" fill="#F1F4F7"/>`,
  wxRain: `<path d="M31 55h35a12 12 0 0 0 1-24 17 17 0 0 0-32-3 10 10 0 0 0-4 27z" fill="#F1F4F7"/><path d="M37 63l-4 13M49 63l-4 13M61 63l-4 13" stroke="#6FB6D6" stroke-width="4.4"/>`,
  wxFog: `<path d="M31 52h35a11 11 0 0 0 1-22 16 16 0 0 0-31-3 9.5 9.5 0 0 0-5 25z" fill="#F1F4F7"/><path d="M25 64h46M32 75h32M41 86h22" stroke="#BAC7D0" stroke-width="4.4"/>`,
  wxHeat: `<circle cx="48" cy="38" r="15" fill="#F58B4C"/><path d="M30 17l6 6M66 17l-6 6M48 14v7" stroke="#E0703A" stroke-width="4"/><path d="M20 64c6 6 12-6 18 0s12-6 18 0 12-6 18 0M20 80c6 6 12-6 18 0s12-6 18 0 12-6 18 0" stroke="#E0703A" stroke-width="4"/>`,
  // 沙尘：昏黄的风沙线
  wxSand: `<circle cx="48" cy="34" r="14" fill="#E8C88A"/><path d="M18 58c7 6 13-5 20 0s13-5 20 0 12-5 16 0M16 74c7 6 13-5 20 0s13-5 20 0 12-5 16 0M22 88h44" stroke="#C9A24B" stroke-width="4"/>`,
  // 猫猫币：粉色爪印币，与金色金币一眼区分
  catcoin: `<circle cx="48" cy="48" r="27" fill="#F3C6D2"/><circle cx="48" cy="48" r="20.5" fill="#FBE6ED" stroke="none"/><ellipse cx="48" cy="58" rx="11" ry="9" fill="#E88FA8" stroke="none"/><circle cx="34" cy="43" r="4.2" fill="#E88FA8" stroke="none"/><circle cx="43" cy="36.5" r="4.4" fill="#E88FA8" stroke="none"/><circle cx="53" cy="36.5" r="4.4" fill="#E88FA8" stroke="none"/><circle cx="62" cy="43" r="4.2" fill="#E88FA8" stroke="none"/>`,
  check: `<path d="M27 50l14 14 27-30" stroke="#6BAF5E" stroke-width="7"/>`,
  coin: `<circle cx="48" cy="48" r="27" fill="#F5C445"/><circle cx="48" cy="48" r="17" fill="#FFE08A"/><path d="M48 38v20M41 43h14M41 53h14" stroke="#C9903F"/>`,
  // HUD 的本周租金：小屋 + 一枚带「¥」的钱币（和金币图标区分开：这是「要交出去」的钱）
  rent: `<path d="M18 50l30-26 30 26" stroke-width="4"/><path d="M26 46v36h44V46" fill="#F7F3E9"/><circle cx="48" cy="62" r="12" fill="#F5C445"/><path d="M48 55v14M43 59h10M43 65h10" stroke-width="2.4" stroke="#C9903F"/>`,
  trash: `<path d="M28 34h40l-4 44a6 6 0 0 1-6 5H38a6 6 0 0 1-6-5z" fill="#F7F3E9"/><path d="M24 30h48v8H24z" fill="#E7DCD0"/><path d="M40 44v24M56 44v24" stroke="#B9B2A4"/>`,
  star: `<path d="M48 14l10 22 24 3-17 17 4 24-21-12-21 12 4-24L14 39l24-3z" fill="#F5C445"/>`,
  logo: `<path d="M18 44h46v8a17 17 0 0 1-17 17H35a17 17 0 0 1-17-17z" fill="#F5C445"/><ellipse cx="41" cy="44" rx="23" ry="5" fill="#FFE08A"/><path d="M64 50h10a7 7 0 0 1 0 14H64"/><path d="M30 30c-3-5 3-7 0-12M42 28c-3-5 3-7 0-12M54 30c-3-5 3-7 0-12" stroke="#C9903F"/><path d="M30 78h28" stroke-width="4"/>`,
  book: `<path d="M20 24h26a8 8 0 0 1 8 8v44a8 8 0 0 0-8-6H20z" fill="#F7F3E9"/><path d="M76 24H50a8 8 0 0 0-8 8v44a8 8 0 0 1 8-6h26z" fill="#F7F3E9"/><path d="M28 38h14M28 48h14M54 38h14M54 48h14" stroke="#B9B2A4"/>`,
  up: `<path d="M48 74V26" stroke-width="6"/><path d="M30 44l18-18 18 18" stroke-width="6"/><path d="M26 82h44" stroke-width="5"/>`,
  pause: `<rect x="30" y="24" width="12" height="48" rx="3" fill="#2B2B2B"/><rect x="54" y="24" width="12" height="48" rx="3" fill="#2B2B2B"/>`,
  close: `<path d="M30 30l36 36M66 30L30 66" stroke-width="6"/>`,
  snow: `<path d="M48 16v64M20 32l56 32M76 32L20 64" stroke="#6FB6D6"/><path d="M48 16l-7 8M48 16l7 8M48 80l-7-8M48 80l7-8" stroke="#6FB6D6"/>`,
};

export function icon(key) {
  const shape = SHAPES[key] || SHAPES.fail;
  return svg(shape);
}

/** 火柴人：6 款身体 + 6 款配饰（128×160） */
export function customerSVG(bodyIdx = 0, accIdx = 0, vip = false) {
  const shirt = ['#8FB8D8', '#E2A25B', '#8FC177', '#D98FA0', '#B9A6D8', '#E8C25B'][bodyIdx % 6];
  const skin = '#FFE0C2';
  const head = `<circle cx="64" cy="44" r="20" fill="${skin}"/>`;
  const face = `<circle cx="57" cy="42" r="2.6" fill="${INK}" stroke="none"/><circle cx="71" cy="42" r="2.6" fill="${INK}" stroke="none"/><path d="M58 52q6 5 12 0" stroke-width="3.4"/>`;

  const bodies = [
    // 0 标准站姿
    `<path d="M64 64v44" /><path d="M64 84l-22 16M64 84l22 16M64 108l-16 32M64 108l16 32"/>`,
    // 1 挥手
    `<path d="M64 64v44"/><path d="M64 84l-22 18M64 84l24-20"/><path d="M64 108l-14 32M64 108l16 32"/>`,
    // 2 抱臂
    `<path d="M64 64v44"/><path d="M64 86l-20 12M64 86l20 12"/><path d="M44 98h40" stroke-width="4"/><path d="M64 108l-15 32M64 108l15 32"/>`,
    // 3 叉腰
    `<path d="M64 64v44"/><path d="M64 84l-24 6 -2 16M64 84l24 6 2 16"/><path d="M64 108l-16 32M64 108l16 32"/>`,
    // 4 并腿托腮
    `<path d="M64 64v44"/><path d="M64 84l-16 22M64 84l18 8"/><path d="M64 108l-8 32M64 108l8 32"/>`,
    // 5 倚靠
    `<path d="M64 64v46"/><path d="M64 86l-20 8M64 86l22 14"/><path d="M62 110l-18 30M66 110l14 30"/>`,
  ];

  const accs = [
    // 0 帽子
    `<path d="M44 30h40v8H44z" fill="${shirt}"/><path d="M46 30c0-9 6-15 16-15s16 6 16 15z" fill="${shirt}"/>`,
    // 1 眼镜
    `<circle cx="57" cy="42" r="8"/><circle cx="71" cy="42" r="8"/><path d="M65 42h-0M49 42h-6M79 42h5" stroke-width="3"/>`,
    // 2 围巾
    `<path d="M48 62c6 6 26 6 32 0" stroke-width="7" stroke="#D94F3D"/><path d="M70 66l4 18" stroke-width="6" stroke="#D94F3D"/>`,
    // 3 胡子
    `<path d="M54 48h10M64 48h10" stroke-width="5"/>`,
    // 4 挎包
    `<path d="M56 66l22 34" stroke-width="3.4"/><rect x="72" y="98" width="20" height="16" rx="3" fill="#C9903F"/>`,
    // 5 发型
    `<path d="M46 40c-2-14 8-22 18-22s20 8 18 22" stroke-width="5" fill="none"/><path d="M50 26c8 6 20 6 26 0" stroke-width="3.4"/>`,
  ];

  return `<svg class="ic" viewBox="0 0 128 160" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${head}${face}${bodies[bodyIdx % 6]}${accs[accIdx % 6]}
  </svg>`;
}

// ============================================================ 小猫
// 皮肤表：加一条即扩展（config.catSkins 里同步加一条即可在商店出现）
// pattern: 'tabby' 虎斑 / 'cow' 奶牛斑 / 'patch' 单侧眼罩斑
export const CAT_SKINS = {
  orange: {
    body: '#F9A85E', belly: '#FFF3E2', mark: '#DE7C30',
    earL: '#F9A85E', earR: '#F9A85E', earInner: '#FFC3C8',
    eye: '#3B2E2A', blush: '#F79FB0', pattern: 'tabby',
  },
  cow: {
    body: '#FFF8EE', belly: '#FFFFFF', mark: '#6E6873',
    earL: '#FFF8EE', earR: '#6E6873', earInner: '#FFC3C8',
    eye: '#3B2E2A', blush: '#F79FB0', pattern: 'cow',
  },
  // 小怪：白底灰蓝斑，右眼圈带「眼罩」斑，尾巴整条灰蓝
  xiaoguai: {
    body: '#FFFDF8', belly: '#FFFFFF', mark: '#8FA6BF',
    earL: '#FFFDF8', earR: '#8FA6BF', earInner: '#FFC3C8',
    eye: '#2E2A33', blush: '#F79FB0', pattern: 'patch', tail: '#8FA6BF',
  },
    // 以下为 v5.1 新增皮肤（OWK-CFG-005 §3）
  black: {
    body: '#3A3A3A', belly: '#5A5A5A', mark: '#F5F1E8',
    earL: '#3A3A3A', earR: '#3A3A3A', earInner: '#8A7E86',
    eye: '#FFFFFF', blush: '#F79FB0', pattern: 'patch', tail: '#3A3A3A',
  },
  calico: {
    body: '#FFFDF8', belly: '#FFFFFF', mark: '#E8973E',
    earL: '#FFFDF8', earR: '#E8973E', earInner: '#FFC3C8',
    eye: '#3B2E2A', blush: '#F79FB0', pattern: 'patch',
  },
  blue: {
    body: '#8FA3B8', belly: '#C7D3DF', mark: '#6E8298',
    earL: '#8FA3B8', earR: '#8FA3B8', earInner: '#FFC3C8',
    eye: '#C97B2D', blush: '#F79FB0', pattern: 'tabby',
  },
  siamese: {
    body: '#F0E2C8', belly: '#FBF3E3', mark: '#6B4A32',
    earL: '#6B4A32', earR: '#6B4A32', earInner: '#FFC3C8',
    eye: '#4E7FBF', blush: '#F79FB0', pattern: 'patch',
  },
  lucky: {
    body: '#FFFDF8', belly: '#FFFFFF', mark: '#C3423F',
    earL: '#FFFDF8', earR: '#FFFDF8', earInner: '#FFC3C8',
    eye: '#3B2E2A', blush: '#F79FB0', pattern: 'patch',
  },
};


/**
 * 可爱卡通小猫（96×96）
 * 造型参照手绘线稿猫：方圆脸（脸颊略鼓、下巴圆）、大而尖的耳朵、S 形细长尾、
 * 前腿并拢成两个脚掌；靠大眼双高光与 ω 嘴拉亲和力。
 * 分层顺序（漏了会出 bug）：尾巴 → 耳朵 → 身体 → 肚子 → 身体花纹 → 前爪
 *   → 头 → 头部花纹 → 胡须 → 鼻嘴 → 三帧五官。
 * 三帧：0 大眼坐姿 / 1 被摸时「> <」+ 腮红 / 2 回弹后「^ ^」+ 腮红吐舌。
 * 形变（变矮变宽）由 CSS 负责，帧只换表情，保证切换时不跳。
 */
export function catSVG(skinId = 'orange') {
  const k = CAT_SKINS[skinId] || CAT_SKINS.orange;
  const LINE = '#4B3A30';
  const SW = 2.8;
  const tailColor = k.tail || k.body;

  // 身体花纹（身体之后、头之前）
  const bodyMarks = k.pattern === 'patch'
    ? '<path d="M30.5 68c7-6 17-2.4 19 5-7.4 4.8-16 2.4-19-5z" fill="' + k.mark + '" stroke="none"/>'
    : k.pattern === 'cow'
      ? '<path d="M28 66c6-5 15-2 17 5-6 4-14 2-17-5z" fill="' + k.mark + '" stroke="none"/>'
        + '<path d="M64.5 70.5c5-2.2 9 .6 9 4.6-4.2 2.2-8 .4-9-4.6z" fill="' + k.mark + '" stroke="none"/>'
      : '<path d="M28.5 67c3.4 1.4 5.2 3.8 5.8 7M67.5 67c-3.4 1.4-5.2 3.8-5.8 7" stroke="' + k.mark + '" stroke-width="3" fill="none"/>'
        + '<path d="M31.5 62c3 1 4.8 2.8 5.4 5.4M64.5 62c-3 1-4.8 2.8-5.4 5.4" stroke="' + k.mark + '" stroke-width="2.8" fill="none"/>';

  // 头部花纹（头之后、五官之前）
  const headMarks = k.pattern === 'patch'
    ? '<path d="M58.2 31c4.8.4 8.6 5 8.6 10.8 0 5.8-3.8 10.4-8.8 10.4-5.2 0-9-4.8-9-10.8s4-10.8 9.2-10.4z" fill="' + k.mark + '" stroke="none"/>'
    : k.pattern === 'cow'
      ? '<path d="M54 19c7 2.4 10 8 8 13-4.6-.6-8-4.6-9.4-9-.6-2 .2-3.4 1.4-4z" fill="' + k.mark + '" stroke="none"/>'
      : '<path d="M43.4 22.2c1 3.4 1 5.6 0 7.4M48 20.6c1 3.8 1 6.2 0 8.2M52.6 22.2c-1 3.4-1 5.6 0 7.4" stroke="' + k.mark + '" stroke-width="3" fill="none"/>'
        + '<path d="M28.4 33c-1.4 1.8-2 3.6-2.2 5.4M67.6 33c1.4 1.8 2 3.6 2.2 5.4" stroke="' + k.mark + '" stroke-width="2.8" fill="none"/>';

  const face0 =
    '<ellipse cx="38.2" cy="42" rx="6" ry="7" fill="' + k.eye + '" stroke="none"/>'
    + '<ellipse cx="57.8" cy="42" rx="6" ry="7" fill="' + k.eye + '" stroke="none"/>'
    + '<circle cx="36.1" cy="38.9" r="2.35" fill="#FFFFFF" stroke="none"/>'
    + '<circle cx="55.7" cy="38.9" r="2.35" fill="#FFFFFF" stroke="none"/>'
    + '<circle cx="40.4" cy="45.4" r="1.15" fill="#FFFFFF" stroke="none" opacity="0.85"/>'
    + '<circle cx="60" cy="45.4" r="1.15" fill="#FFFFFF" stroke="none" opacity="0.85"/>';

  const face1 =
    '<path d="M33.2 38.6l5.6 3.8-5.6 3.8M62.8 38.6L57.2 42.4l5.6 3.8" stroke-width="3" fill="none"/>'
    + '<ellipse cx="28" cy="50.6" rx="5" ry="3.2" fill="' + k.blush + '" stroke="none" opacity="0.7"/>'
    + '<ellipse cx="68" cy="50.6" rx="5" ry="3.2" fill="' + k.blush + '" stroke="none" opacity="0.7"/>';

  const face2 =
    '<path d="M33 44.4c2.6-5.4 8.8-5.4 11.4 0M51.6 44.4c2.6-5.4 8.8-5.4 11.4 0" stroke-width="3" fill="none"/>'
    + '<ellipse cx="27.8" cy="50.6" rx="5.4" ry="3.4" fill="' + k.blush + '" stroke="none" opacity="0.85"/>'
    + '<ellipse cx="68.2" cy="50.6" rx="5.4" ry="3.4" fill="' + k.blush + '" stroke="none" opacity="0.85"/>'
    + '<path d="M44.6 57h6.8c0 4.4-2.2 6.2-3.4 6.2S44.6 61.4 44.6 57z" fill="#F27C8D" stroke="none"/>';

  const HEAD = 'M48 17c13.6 0 24.5 9.6 24.5 21.6 0 7.6-3.8 13.4-9.6 16.6'
    + '-4 2.2-9.2 3.3-14.9 3.3s-10.9-1.1-14.9-3.3C27.3 52 23.5 46.2 23.5 38.6 23.5 26.6 34.4 17 48 17z';

  return '<svg class="cat-ic" viewBox="0 0 96 96" preserveAspectRatio="xMidYMax meet" '
    + 'xmlns="http://www.w3.org/2000/svg" fill="none" stroke="' + LINE + '" stroke-width="' + SW + '" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    // 尾巴：一条连续粗线（外层描边 + 内层填色），S 形上翘
    + '<path d="M66 85c13 2 20-6 19-14 0-5-2.2-8.4-5.6-9.8" fill="none" stroke-width="10.6"/>'
    + '<path d="M66 85c13 2 20-6 19-14 0-5-2.2-8.4-5.6-9.8" fill="none" stroke="' + tailColor + '" stroke-width="6"/>'
    // 耳朵
    + '<path d="M24 30.4L28.6 6.4l16 12.8z" fill="' + k.earL + '"/>'
    + '<path d="M72 30.4L67.4 6.4l-16 12.8z" fill="' + k.earR + '"/>'
    + '<path d="M29.8 26.4l3.2-12.6 9 8.4z" fill="' + k.earInner + '" stroke="none"/>'
    + '<path d="M66.2 26.4l-3.2-12.6-9 8.4z" fill="' + k.earInner + '" stroke="none"/>'
    // 身体 + 肚子 + 花纹
    + '<ellipse cx="48" cy="72.5" rx="23.5" ry="19.5" fill="' + k.body + '"/>'
    + '<ellipse cx="48" cy="79" rx="13" ry="10" fill="' + k.belly + '" stroke="none"/>'
    + bodyMarks
    // 前腿并拢、脚掌分开
    + '<ellipse cx="39.6" cy="86.6" rx="6.2" ry="4.6" fill="' + k.body + '"/>'
    + '<ellipse cx="56.4" cy="86.6" rx="6.2" ry="4.6" fill="' + k.body + '"/>'
    // 头
    + '<path d="' + HEAD + '" fill="' + k.body + '"/>'
    + headMarks
    // 胡须
    + '<path d="M25.2 45.4c-5-.4-8 .6-9.2 1.8M25 51.2c-4.8.6-7.6 2.2-8.6 3.6" stroke-width="2.4"/>'
    + '<path d="M70.8 45.4c5-.4 8 .6 9.2 1.8M71 51.2c4.8.6 7.6 2.2 8.6 3.6" stroke-width="2.4"/>'
    // 鼻 + ω 嘴
    + '<path d="M45.6 49.8h4.8l-2.4 3z" fill="#F28C9E" stroke="none"/>'
    + '<path d="M42 56.2c1.9 2.8 4.2 2.8 6 0 1.8 2.8 4.1 2.8 6 0" stroke-width="2.8"/>'
    + '<g class="cf cf0">' + face0 + '</g>'
    + '<g class="cf cf1">' + face1 + '</g>'
    + '<g class="cf cf2">' + face2 + '</g>'
    + '</svg>';
}

/**
 * 外卖骑手：黄色袋鼠（v2.19.2 重画为 3D 玩偶风）
 *
 * 按用户提供的参考图还原：坐姿、圆胖梨形身体、浅色大肚子、两只竖起的长耳、
 * 向前突出的深棕鼻头、黑豆眼带高光、短圆手臂垂在身前、粗壮的尾巴从右侧伸出并上翘。
 *
 * 与旧稿的区别：不再用黑粗描边 + 纯色填充的简笔画，改成
 * linearGradient / radialGradient 做「顶部高光 → 底部暗部」的立体感
 * （用户明确要求「可以用渐变尽量美观」）。轮廓改用略深的黄做细边（1.2~1.5），
 * 否则 3D 块面在浅色背景上会糊成一片。
 *
 * 尺寸：外层 <g> 把整只袋鼠缩放 0.87、底边落在 y≈140 —— 与顾客火柴人
 * （墨迹高约 125、底边 140）同一条视觉地平线，并排时不至于一大一小。
 * 渐变 id 一律 rider- 前缀，避免与页面其它内联 SVG 的 id 撞车。
 *
 * @returns {string} 内联 SVG 字符串
 */
export function riderSVG() {
  return '<svg class="ic rider-ic" viewBox="0 0 128 160" preserveAspectRatio="xMidYMax meet" '
    + 'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<defs>'
    // 身体：上亮下暗的竖向渐变（顶部受光、底部入影）
    + '<linearGradient id="rider-body" x1="0" y1="0" x2="0.25" y2="1">'
    + '<stop offset="0" stop-color="#FFE066"/><stop offset="0.5" stop-color="#F9C22E"/><stop offset="1" stop-color="#E09112"/>'
    + '</linearGradient>'
    // 头部：偏左上打光的径向渐变
    + '<radialGradient id="rider-head" cx="0.36" cy="0.28" r="0.85">'
    + '<stop offset="0" stop-color="#FFEA85"/><stop offset="0.55" stop-color="#FACB3A"/><stop offset="1" stop-color="#E89A18"/>'
    + '</radialGradient>'
    // 肚子：奶油色，中心最亮
    + '<radialGradient id="rider-belly" cx="0.42" cy="0.34" r="0.8">'
    + '<stop offset="0" stop-color="#FFFBE0"/><stop offset="0.6" stop-color="#FFF0B8"/><stop offset="1" stop-color="#FFDF8A"/>'
    + '</radialGradient>'
    // 尾巴：根部沉、梢部亮
    + '<linearGradient id="rider-tail" x1="1" y1="1" x2="0" y2="0">'
    + '<stop offset="0" stop-color="#F2B223"/><stop offset="1" stop-color="#FFD34D"/>'
    + '</linearGradient>'
    + '</defs>'
    + '<g transform="translate(2.2 16.5) scale(0.87)">'
    // 尾巴：从身体右下伸出、末端上翘 —— 袋鼠最易辨识的部位
    + '<path d="M96 118C108 122 120 114 124 99C126 90 117 87 112 96C105 109 100 113 92 111Z" fill="url(#rider-tail)" stroke="#D98E12" stroke-width="1.4" stroke-linejoin="round"/>'
    // 两只脚掌（坐姿，向两侧摊开）
    + '<ellipse cx="33" cy="134" rx="15" ry="8.5" fill="url(#rider-body)" stroke="#D98E12" stroke-width="1.4"/>'
    + '<ellipse cx="95" cy="134" rx="15" ry="8.5" fill="url(#rider-body)" stroke="#D98E12" stroke-width="1.4"/>'
    // 耳朵先画：根部要藏在头后面。外耳深一档、内耳浅色
    + '<path d="M48 34C41 21 37 7 43 2C51 5 58 21 60 34Z" fill="url(#rider-head)" stroke="#D98E12" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<path d="M80 34C82 21 87 5 94 2C99 7 94 22 87 35Z" fill="url(#rider-head)" stroke="#D98E12" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<path d="M51 31C46 21 43 11 47 7C52 10 56 22 57 31Z" fill="#FFE9A8" stroke="none"/>'
    + '<path d="M82 31C84 21 88 10 92 8C95 12 92 23 87 32Z" fill="#FFE9A8" stroke="none"/>'
    // 身体：梨形（窄肩宽胯），坐姿重心在下方
    + '<path d="M64 62C86 62 100 80 102 106C104 128 88 142 64 142C40 142 24 128 26 106C28 80 42 62 64 62Z" fill="url(#rider-body)" stroke="#D98E12" stroke-width="1.5" stroke-linejoin="round"/>'
    // 肚子：占正面大半的浅色大块（参考图里最显眼的特征之一）
    + '<ellipse cx="64" cy="110" rx="28" ry="26" fill="url(#rider-belly)" stroke="none"/>'
    // 头：与身体连成一体，没有脖子
    + '<ellipse cx="64" cy="50" rx="27" ry="25" fill="url(#rider-head)" stroke="#D98E12" stroke-width="1.5"/>'
    // 眼睛：黑豆 + 一点高光
    + '<ellipse cx="55" cy="47" rx="3.6" ry="4" fill="#2B2B2B" stroke="none"/>'
    + '<ellipse cx="75" cy="47" rx="3.6" ry="4" fill="#2B2B2B" stroke="none"/>'
    + '<circle cx="56.3" cy="45.4" r="1.2" fill="#FFFFFF" stroke="none"/>'
    + '<circle cx="76.3" cy="45.4" r="1.2" fill="#FFFFFF" stroke="none"/>'
    // 鼻头：深棕大椭圆，明显前突；左上一点反光让它是「圆的」
    + '<ellipse cx="65" cy="60" rx="10.5" ry="8.6" fill="#8A4B2A" stroke="#6E3820" stroke-width="1.2"/>'
    + '<ellipse cx="61.4" cy="56.8" rx="3.4" ry="2" fill="#B8744C" stroke="none" opacity="0.75"/>'
    // 嘴：鼻下一条微笑弧
    + '<path d="M58 70.5C61 74.2 69 74.2 72 70.5" fill="none" stroke="#8A4B2A" stroke-width="2" stroke-linecap="round"/>'
    // 手臂：短圆的两条，垂在肚子两侧前方。
    // 先描边色打底、再叠主色 —— 手臂压在浅色肚子上，只靠颜色区分会糊成肚子的边。
    + '<path d="M41 91C34 100 34 111 39 117" fill="none" stroke="#D98E12" stroke-width="14" stroke-linecap="round"/>'
    + '<path d="M41 91C34 100 34 111 39 117" fill="none" stroke="#F0AE1E" stroke-width="10.5" stroke-linecap="round"/>'
    + '<path d="M87 91C94 100 94 111 89 117" fill="none" stroke="#D98E12" stroke-width="14" stroke-linecap="round"/>'
    + '<path d="M87 91C94 100 94 111 89 117" fill="none" stroke="#F0AE1E" stroke-width="10.5" stroke-linecap="round"/>'
    // 手臂上的高光，避免两条臂看起来是死板的色块
    + '<path d="M39.5 95C34.5 101 34.5 108 36 112" fill="none" stroke="#FFDD6B" stroke-width="3.5" stroke-linecap="round" opacity="0.75"/>'
    + '<path d="M88.5 95C93.5 101 93.5 108 92 112" fill="none" stroke="#FFDD6B" stroke-width="3.5" stroke-linecap="round" opacity="0.75"/>'
    + '</g>'
    + '</svg>';
}
