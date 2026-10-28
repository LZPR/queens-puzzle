/* ============================================================================
 * 动效三样（点击特效 / 背景动画 / 棋盘滤镜）+ 模糊背景 + ?unlock=all
 *
 *   python serve.py --no-open
 *   node tools/check-effect.mjs
 *
 * 规矩：
 *   · 三样都挂在**外观插件**这套上：面板里一排展位、能选、能存、能锁，
 *     跟色块 / 叉 / 皇后一个待遇（见 tools/check-look.mjs 的展柜部分）；
 *   · 涟漪只作用于**被点的那一格**：节点长在 .cell 里，格子自己 overflow: hidden
 *     裁掉多出来的部分；圆心跟着指尖，不是永远在正中；
 *   · 背景动画在**棋盘之外**：一层 fixed + z-index: -1 的 .bg-fx，
 *     pointer-events: none，谁也点不到它，它也盖不住谁；
 *   · 棋盘滤镜只罩 .board：棋盘外的色卡 / 工具栏一点不受影响，
 *     值由插件给（mono.js 的 filter 字段），挂在行内 style 上；
 *   · 设置里的「模糊背景」只糊背景那一层，棋盘不动；开关写进存档；
 *   · ?unlock=all 临时全解开、**不落盘**，刷新回到真实账本；
 *   · prefers-reduced-motion 下涟漪不播、背景层根本不会被建出来。
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Projects/Games/queens-puzzle/tools/shots/';
mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  PASS  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
  else { fail++; console.log('  FAIL  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function boot(url) {
  await page.goto(url || URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0',
    { timeout: 20000 });
  await sleep(650);
}

/* 真鼠标点一格（不走 el.click()：那会绕过命中测试，被盖住也照样「点得到」）。
 * fx / fy 是格内的相对位置（0–1），涟漪的圆心应该落在那儿。 */
async function tapCell(fx, fy) {
  const at = await page.evaluate((fx, fy) => {
    const cells = [...document.querySelectorAll('.cell')];
    const cell = cells[Math.min(10, cells.length - 1)];
    const r = cell.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y);
    return {
      x, y, left: r.left, top: r.top, w: r.width, h: r.height,
      hit: hit ? (hit.closest('.cell') ? 'cell' : hit.className) : 'none',
      cellLeft: r.left, cellTop: r.top
    };
  }, fx, fy);
  await page.mouse.click(at.x, at.y);
  return at;
}

await boot();
await page.evaluate(() => localStorage.clear());
await boot();

// ---------- 1. 出厂状态 ----------
console.log('\n--- 1. 出厂：三样都关着 ---');
const init = await page.evaluate(() => ({
  look: __QUEENS_DEBUG__.look(),
  attrs: ['data-click', 'data-bg', 'data-filter'].map(a => document.documentElement.getAttribute(a)),
  bg: (() => {
    const e = document.querySelector('.bg-fx');
    if (!e) return null;
    const cs = getComputedStyle(e);
    return {
      hidden: e.hidden, n: e.children.length, z: cs.zIndex, pos: cs.position,
      pe: cs.pointerEvents, parent: e.parentElement.tagName
    };
  })(),
  boardFilter: document.getElementById('board').style.filter,
  blur: document.documentElement.classList.contains('is-blur-bg')
}));
ok('默认是「无 / 无 / 无滤镜」（涟漪与飘落都是奖品）',
  init.look.click === 'none' && init.look.bg === 'none' && init.look.filter === 'none',
  JSON.stringify(init.look));
ok('三个钩子落在 <html> 上', init.attrs.join() === 'none,none,none', init.attrs);
ok('出厂连背景层都不建（安静着，不白烧电）', init.bg === null, init.bg);
ok('模糊背景默认关着', init.blur === false);
ok('棋盘上没有滤镜', init.boardFilter === '');
await page.screenshot({ path: SHOTS + 'fx-1-default.png' });

// ---------- 2. 涟漪 ----------
console.log('\n--- 2. 涟漪：只作用于被点的那一格 ---');
// 涟漪是奖品：先发下来再选上
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.lookUnlock('click', 'ripple');
  d.openLook();
});
await sleep(350);
await page.evaluate(() => document.querySelector('#clickRow [data-click="ripple"]').click());
await sleep(250);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(300);
const at = await tapCell(0.3, 0.35);
ok('鼠标真的落在了格子上', at.hit === 'cell', at.hit);
const rip = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.fx-rip')];
  if (!all.length) return { n: 0 };
  const e = all[0];
  const cell = e.closest('.cell');
  const cs = getComputedStyle(e);
  return {
    n: all.length,
    inCell: !!cell,
    // 每一枚都长在某个 .cell 里 —— 棋盘外不该有涟漪节点
    allInCell: all.every(x => !!x.closest('.cell')),
    overflow: cell ? getComputedStyle(cell).overflow : '',
    left: parseFloat(cs.left), top: parseFloat(cs.top),
    w: parseFloat(cs.width), radius: cs.borderRadius,
    pe: cs.pointerEvents,
    cellW: cell ? cell.getBoundingClientRect().width : 0
  };
});
ok('点下去就有一枚涟漪', rip.n >= 1, rip.n);
ok('涟漪只长在格子里（棋盘外没有）', rip.inCell === true && rip.allInCell === true);
ok('格子自己 overflow: hidden 把它裁在里面', rip.overflow === 'hidden', rip.overflow);
ok('圆心跟着指尖（不是永远在正中）',
  Math.abs(rip.left - rip.cellW * 0.3) < 2.5 && Math.abs(rip.top - rip.cellW * 0.35) < 2.5,
  `left=${rip.left} top=${rip.top} cell=${rip.cellW.toFixed(1)}`);
ok('直径按到最远那个角算，盖得住整格', rip.w > rip.cellW * 1.2, `${rip.w} vs ${rip.cellW.toFixed(1)}`);
ok('是圆的、且不吃点击', rip.radius === '50%' && rip.pe === 'none', [rip.radius, rip.pe]);
await page.screenshot({ path: SHOTS + 'fx-2-ripple.png' });

await sleep(900);
const gone = await page.evaluate(() => document.querySelectorAll('.fx-rip').length);
ok('动画放完自己摘掉节点', gone === 0, gone);

/* 面板开着时棋盘是锁的（canPlay），点格子不该有涟漪 */
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(400);
const lockedTap = await page.evaluate(() => {
  const cell = document.querySelectorAll('.cell')[3];
  const r = cell.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(lockedTap.x, lockedTap.y);
await sleep(120);
ok('面板开着时棋盘锁住，点了没有涟漪',
  await page.evaluate(() => document.querySelectorAll('.fx-rip').length) === 0);
// 顺手在面板里把涟漪换成「无」
await page.evaluate(() => document.querySelector('#clickRow [data-click="none"]').click());
await sleep(250);
const noFx = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-click'),
  now: document.getElementById('clickNow').textContent,
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').clickStyle
}));
ok('选「无」：钩子变 none、写进存档', noFx.attr === 'none' && noFx.saved === 'none', noFx);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(300);
await page.mouse.click(at.x, at.y);
await sleep(120);
ok('选「无」之后点格子不再有涟漪',
  await page.evaluate(() => document.querySelectorAll('.fx-rip').length) === 0);
// 换回涟漪
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(350);
await page.evaluate(() => document.querySelector('#clickRow [data-click="ripple"]').click());
await sleep(250);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(300);

// ---------- 3. 背景 ----------
console.log('\n--- 3. 背景：在棋盘之外飘 ---');
// 飘落也是奖品：先发下来再选上
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.lookUnlock('bg', 'snow');
  d.openLook();
});
await sleep(350);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="snow"]').click());
await sleep(300);
const bgGeo = await page.evaluate(() => {
  const e = document.querySelector('.bg-fx');
  const kids = [...e.children];
  const shapes = new Set(kids.map(k => [...k.classList].find(c => c !== 'bg-s')));
  // 形状自己动：duration / delay / 横移 / 自转都写在行内变量上
  const vars = kids.map(k => ['--d', '--delay', '--sway', '--spin', '--o'].every(v => !!k.style.getPropertyValue(v)));
  const box = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  // 彩色：每枚自带 --c，掰成 rgb 之后看「这一枚是不是真的有色相」（max-min 够大）
  const tints = [...new Set(kids.map(k => k.style.getPropertyValue('--c').trim()))];
  const rgbs = kids.map(k => getComputedStyle(k).backgroundColor);
  const vivid = c => {
    const m = c.match(/\d+/g);
    if (!m || m.length < 3) return false;
    const v = m.slice(0, 3).map(Number);
    return Math.max(...v) - Math.min(...v) > 40;
  };
  return {
    n: kids.length,
    shapes: [...shapes].sort(),
    vars: vars.every(Boolean),
    full: Math.round(box.width) >= window.innerWidth - 1 && Math.round(box.height) >= window.innerHeight - 1,
    anim: getComputedStyle(kids[0]).animationName,
    // 背景层在 body 上、且排在所有内容之前（z-index: -1 让它永远在下面）
    inBody: e.parentElement === document.body,
    z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents,
    tints: tints,
    colors: [...new Set(rgbs)],
    allVivid: rgbs.every(vivid),
    // 每一枚都得挂上颜色变量，不能退回墨色
    allTinted: kids.every(k => /^#[0-9a-f]{6}$/i.test(k.style.getPropertyValue('--c').trim()))
  };
});
ok('14 枚形状、五种几何都齐',
  bgGeo.n === 14 && bgGeo.shapes.join() === 'bg-circle,bg-diamond,bg-hex,bg-square,bg-tri',
  bgGeo.shapes.join());
ok('形状是彩色的：五种形状五种颜色，没有一枚退回墨色',
  bgGeo.tints.length === 5 && bgGeo.allTinted && bgGeo.colors.length === 5,
  bgGeo.tints);
ok('五种颜色都真的有彩度（不是灰的）', bgGeo.allVivid, bgGeo.colors);
ok('每一枚都带着自己的时长 / 起点 / 横移 / 自转', bgGeo.vars);
ok('那一层铺满整个视口、挂在 body 上', bgGeo.full && bgGeo.inBody, [bgGeo.full, bgGeo.inBody]);
ok('在内容之下（fixed + z-index: -1）、且不吃点击',
  bgGeo.z === '-1' && bgGeo.pos === 'fixed' && bgGeo.pe === 'none',
  [bgGeo.z, bgGeo.pos, bgGeo.pe]);
ok('跑的是 bgFall 动画', bgGeo.anim === 'bgFall', bgGeo.anim);

// 点在背景上的空白处（棋盘以外）：不吃点击，也不该有任何副作用
const bgTap = await page.evaluate(() => {
  const x = 20, y = Math.round(window.innerHeight * 0.5);
  const hit = document.elementFromPoint(x, y);
  return { hit: hit ? (hit.className || hit.tagName) : 'none', bgHit: !!(hit && hit.closest('.bg-fx')) };
});
ok('背景层不出现在命中测试里（点不到它）', bgTap.bgHit === false, bgTap);

// 换成「无」
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(400);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="none"]').click());
await sleep(250);
const bgOff = await page.evaluate(() => ({
  hidden: document.querySelector('.bg-fx').hidden,
  n: document.querySelectorAll('.bg-fx .bg-s').length,
  attr: document.documentElement.getAttribute('data-bg')
}));
ok('选「无」：整层收起来（节点留着，动画停）',
  bgOff.hidden === true && bgOff.n === 14 && bgOff.attr === 'none', bgOff);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="snow"]').click());
await sleep(250);
ok('换回来就接着飘',
  await page.evaluate(() => document.querySelector('.bg-fx').hidden === false));

// ---------- 3.5 水面 ----------
console.log('\n--- 3.5 水面：水位跟着填充走 ---');
// 水面也是奖品：先发下来再选上
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.lookUnlock('bg', 'tide');
  d.openLook();
});
await sleep(350);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="tide"]').click());
await sleep(300);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(500);

/* 空盘：水面贴在工具栏上方那一条水带里 */
async function tideState() {
  return page.evaluate(() => {
    const layer = document.querySelector('.bg-fx');
    const rise = document.querySelector('.w-rise');
    const band = document.getElementById('regions').getBoundingClientRect().bottom;
    const bar = document.getElementById('toolbar').getBoundingClientRect().top;
    return {
      hidden: layer.hidden,
      fill: parseFloat(getComputedStyle(layer).getPropertyValue('--fill')) || 0,
      surface: Math.round(rise.getBoundingClientRect().top),
      paletteBottom: Math.round(band),
      toolbarTop: Math.round(bar),
      vh: window.innerHeight
    };
  });
}

/* 水线探针：扫 canvas 的像素，每列找最亮的那一行 —— 那就是白亮的水线。
 * 返回值一律换算成 CSS px。span 是整条线的起伏幅度：静止时只剩环境呼吸
 * （两三像素），点一下能到十五像素以上。 */
const lineProbe = () => page.evaluate(() => {
  const cv = document.querySelector('.w-surf');
  if (!cv) return null;
  const g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const d = g.getImageData(0, 0, w, h).data;
  const cssH = cv.getBoundingClientRect().height;
  const dpr = cssH ? h / cssH : 1;
  const ys = [];
  for (let c = 0; c < 9; c++) {
    const x = Math.min(w - 1, Math.round((c + 0.5) / 9 * w));
    let best = -1, by = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const lum = d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1 + d[i + 3] * 0.5;
      if (lum > best) { best = lum; by = y; }
    }
    ys.push(+(by / dpr).toFixed(1));
  }
  return {
    ys,
    w, h, dpr,
    cssW: Math.round(cv.getBoundingClientRect().width),
    cssH: Math.round(cssH),
    mid: +(cssH / 2).toFixed(1),
    span: +(Math.max(...ys) - Math.min(...ys)).toFixed(1),
    mean: +(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1)
  };
});

/* 水面这一层：一块 wash + 一块水 + 两团涌 + 两块反光 + 一块 canvas 水线 */
const tideEmpty = await page.evaluate(() => {
  const layer = document.querySelector('.bg-fx');
  const cv = document.querySelector('.bg-fx .w-surf');
  const swells = [...document.querySelectorAll('.bg-fx .w-swell')];
  const cs = getComputedStyle(layer);
  return {
    hidden: layer.hidden,
    wash: !!document.querySelector('.bg-fx .w-wash'),
    deep: !!document.querySelector('.bg-fx .w-deep'),
    swells: swells.length,
    // 水团仍在跑漂移动画（水在流）
    anims: swells.map(e => getComputedStyle(e).animationName),
    canvas: document.querySelectorAll('.bg-fx canvas').length,
    surf: cv ? {
      w: Math.round(cv.getBoundingClientRect().width),
      h: Math.round(cv.getBoundingClientRect().height),
      // 水线那块画布必须让开顶部 --amp，才能既画浪尖又不缺一截水
      top: Math.round(cv.getBoundingClientRect().top),
      pe: getComputedStyle(cv).pointerEvents
    } : null,
    amp: cs.getPropertyValue('--amp').trim(),
    z: cs.zIndex,
    pe: cs.pointerEvents
  };
});
ok('选水面：背景层建出来，一层水色 + 一块水 + 两团涌 + 一块水线画布',
  tideEmpty.hidden === false && tideEmpty.wash && tideEmpty.deep &&
  tideEmpty.swells === 2 && tideEmpty.canvas === 1 && !!tideEmpty.surf,
  `${tideEmpty.swells} 水团 / canvas=${tideEmpty.canvas}`);
ok('水团还在跑漂移动画（水在流，不是一张静止的图）',
  tideEmpty.anims.join() === 'wDriftL,wDriftR', tideEmpty.anims);
ok('水线画布宽满屏、高 = 2×--amp（--amp 让给浪尖），不挡点击',
  tideEmpty.amp === '24px' && tideEmpty.surf.w >= 300 &&
  tideEmpty.surf.h === 48 && tideEmpty.surf.pe === 'none',
  [tideEmpty.amp, tideEmpty.surf.w, tideEmpty.surf.h, tideEmpty.surf.pe]);
ok('水面那一层仍旧在内容之下、不吃点击',
  tideEmpty.z === '-1' && tideEmpty.pe === 'none', [tideEmpty.z, tideEmpty.pe]);

const t0 = await tideState();
/* 空盘也留一池水（空档的三成）：水面是能点的，全藏到工具栏底下就成空白了 */
const bandH = t0.toolbarTop - t0.paletteBottom;
ok('空盘：屏幕底下仍留一池水（不会整条藏到按钮底下）',
  t0.surface < t0.toolbarTop - 24 &&
  t0.surface > t0.toolbarTop - bandH * 0.5,
  `surface=${t0.surface} toolbar=${t0.toolbarTop} band=${bandH}`);
await page.screenshot({ path: SHOTS + 'fx-6-tide-low.png' });

/* 涂一半：水位升上去（过渡 0.62s，等它走完再量） */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  for (let i = 0; i < n * n; i++) d.state.marks[i] = (i % 2 === 0) ? 1 : 0;
  d.render();
});
await sleep(800);
const t1 = await tideState();
ok('棋盘涂一半：水面升起来（transform 抬高了整块水）',
  t1.fill > 0.45 && t1.fill < 0.55 && t1.surface < t0.surface - 40,
  `fill=${t1.fill} ${t0.surface}→${t1.surface}`);
await page.screenshot({ path: SHOTS + 'fx-6-tide-mid.png' });

/* 涂满：水面涨到色卡下沿，再高就糊住色卡了 */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  for (let i = 0; i < n * n; i++) d.state.marks[i] = 1;
  d.render();
});
await sleep(800);
const t2 = await tideState();
ok('涂满：水面涨到色卡下沿（不糊住色卡，也不涨进棋盘）',
  t2.fill === 1 && t2.surface < t1.surface - 40 &&
  t2.surface > t2.paletteBottom - 8 && t2.surface < t2.paletteBottom + 8,
  `surface=${t2.surface} palette=${t2.paletteBottom}`);
await page.screenshot({ path: SHOTS + 'fx-6-tide-high.png' });

/* 清空：水位跟着落回去 */
await page.evaluate(() => __QUEENS_DEBUG__.clear());
await sleep(800);
const t3 = await tideState();
ok('清空棋盘：水位退回最低（跟着局面走，不是只涨不落）',
  t3.fill === 0 && Math.abs(t3.surface - t0.surface) <= 2, `${t3.surface} vs ${t0.surface}`);

// ---- 水线本身：波动方程在跑 ----
console.log('\n--- 3.6 水线：点一下水面被按下去，波跑开再静下来 ---');
await sleep(600);
const rest = await lineProbe();
ok('静水：水线是活的（环境呼吸 1–6px），但整体还在中线附近',
  rest && rest.span >= 0.8 && rest.span <= 8 &&
  Math.abs(rest.mean - rest.mid) <= 6,
  rest && `span=${rest.span} mean=${rest.mean} mid=${rest.mid}`);

/* 点在水面左 1/4 处：那一段被压下去（y 变大 = 往下），两侧顶起来 */
const poke = await page.evaluate(() => {
  const r = document.querySelector('.w-surf').getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width * 0.25),
    y: Math.round(r.top + r.height * 0.5)
  };
});
await page.mouse.click(poke.x, poke.y);
await sleep(90);
const hit = await lineProbe();
/* 点在水面左 1/4：那一段被压下去（y 变大 = 往下），整条线的最低点也该落在左半 */
const leftMax = arr => Math.max(...arr.slice(0, 4));
const deepest = hit ? hit.ys.indexOf(Math.max(...hit.ys)) : -1;
ok('点一下：水线在按的位置被压下去（左半明显低于按之前）',
  hit && leftMax(hit.ys) > leftMax(rest.ys) + 5 && deepest <= 4,
  hit && `按前 ${rest.ys.slice(0, 4)} → 按后 ${hit.ys.slice(0, 4)}，最低点在 #${deepest}`);
ok('点一下：整条线被掀起来（起伏幅度从两三像素涨到十像素以上）',
  hit && hit.span > rest.span + 8 && hit.span > 11,
  hit && `${rest.span} → ${hit.span}`);
await page.screenshot({ path: SHOTS + 'fx-7-tide-poke.png' });

/* 波往两边跑：同一时刻的剖面在变（凹陷挪位、两侧冒峰） */
await sleep(300);
const spread = await lineProbe();
const moved = spread && spread.ys.reduce((m, y, i) => Math.max(m, Math.abs(y - hit.ys[i])), 0);
ok('波在跑：0.3 秒后同一条线的形状已经变了（不是原地上下抖）',
  moved >= 6, spread && `最大位移 ${moved.toFixed(1)}px`);
await page.screenshot({ path: SHOTS + 'fx-7-tide-spread.png' });

/* 两三秒后自己静下来：阻尼把能量收掉，水面回到中线 */
await sleep(2600);
const calm = await lineProbe();
ok('两三秒后自己静下来（波不会一直荡），水面回到中线附近',
  calm && calm.span < 8 && Math.abs(calm.mean - calm.mid) <= 6,
  calm && `span=${calm.span} mean=${calm.mean} mid=${calm.mid}`);

/* 浮层里的点击不掀水：点面板自己的按钮不该顺手把水面推一下 */
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(400);
const sheetPos = await page.evaluate(() => {
  const r = document.querySelector('#lookSheet .sheet-head').getBoundingClientRect();
  return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.click(sheetPos.x, sheetPos.y);
await sleep(120);
const inSheet = await lineProbe();
ok('浮层里的点击不掀水（面板归面板）',
  inSheet && inSheet.span < 8, inSheet && `span=${inSheet.span}`);
await page.keyboard.press('Escape');
await sleep(320);

/* ---- 放皇后也算完成（水面跟着「解到哪一步」涨） ----
 * 真正的解题动作是放皇后，一盘 8×8 放满也才 8 格 —— 只按「涂了多少格」算，
 * 解完水面还贴着底。这里验证：放几颗就涨几成，放满 n 颗就是满水。 */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  for (let i = 0; i < n * n; i++) d.state.marks[i] = 0;
  const sol = d.state.solution;            // solution[row] = 这一行该放哪一列
  for (let r = 0; r < 3; r++) d.state.marks[r * n + sol[r]] = 2;
  d.render();
});
await sleep(800);
const q3 = await tideState();
ok('放 3 颗皇后：水面自己涨起来（没涂一格，水位离底）',
  q3.fill >= 3 / 8 && q3.fill < 0.46 && q3.surface < t0.surface - 30,
  `fill=${q3.fill}（3/8 = ${(3 / 8).toFixed(3)}，另有 3 格涂色的零头）surface=${q3.surface} vs 空盘 ${t0.surface}`);

await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = d.state.solution;
  for (let r = 0; r < n; r++) d.state.marks[r * n + sol[r]] = 2;
  d.render();
});
await sleep(800);
const qAll = await tideState();
ok('放满 n 颗（解开那一刻）：水面正好涨到色卡下沿',
  qAll.fill === 1 && qAll.surface > qAll.paletteBottom - 8 &&
  qAll.surface < qAll.paletteBottom + 8,
  `fill=${qAll.fill} surface=${qAll.surface} palette=${qAll.paletteBottom}`);

/* 撤掉一颗：跟着落回去（不是只涨不落） */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = d.state.solution;
  for (let r = 4; r < n; r++) d.state.marks[r * n + sol[r]] = 0;
  d.render();
});
await sleep(800);
const q4 = await tideState();
ok('撤掉一半皇后：水面跟着落回去',
  q4.fill >= 0.5 && q4.fill < 0.58 && q4.surface > qAll.surface + 30,
  `fill=${q4.fill} surface=${q4.surface}`);
await page.evaluate(() => __QUEENS_DEBUG__.clear());
await sleep(800);

/* 换回「几何」：水块与引擎一起收掉，不白挂一趟每帧都跑的循环 */
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(350);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="snow"]').click());
await sleep(300);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(300);
const tideOff = await page.evaluate(() => ({
  surf: document.querySelectorAll('.bg-fx .w-surf').length,
  water: document.querySelectorAll('.bg-fx .w-rise').length,
  snow: document.querySelectorAll('.bg-fx .bg-s').length
}));
ok('换回几何：水块与水线画布都收掉了（波动引擎跟着停）',
  tideOff.surf === 0 && tideOff.water === 0 && tideOff.snow === 14, tideOff);

// ---------- 4. 棋盘滤镜 ----------
console.log('\n--- 4. 棋盘滤镜只罩棋盘 ---');
// 「黑白」是奖品，先发下来
await page.evaluate(() => __QUEENS_DEBUG__.lookUnlock('filter', 'mono'));
await page.evaluate(() => document.querySelector('#filterRow [data-filter="mono"]').click());
await sleep(300);
const mono = await page.evaluate(() => {
  const board = document.getElementById('board');
  return {
    inline: board.style.filter,
    computed: getComputedStyle(board).filter,
    attr: document.documentElement.getAttribute('data-filter'),
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').filterStyle,
    // 棋盘外面：色卡 / 工具栏 / 背景层都不该带滤镜
    outside: [
      getComputedStyle(document.getElementById('regions')).filter,
      getComputedStyle(document.getElementById('toolbar')).filter,
      getComputedStyle(document.querySelector('.bg-fx')).filter,
      getComputedStyle(document.body).filter
    ]
  };
});
ok('滤镜挂在 .board 的行内 style 上', /grayscale\(1\)/.test(mono.inline), mono.inline);
ok('浏览器真的算出了灰度',
  /grayscale\(1\)/.test(mono.computed) && /brightness\(0\.9\)/.test(mono.computed), mono.computed);
ok('钩子与存档都跟上', mono.attr === 'mono' && mono.saved === 'mono', [mono.attr, mono.saved]);
ok('棋盘外一点滤镜都没有（色卡 / 工具栏 / 背景 / body）',
  mono.outside.every(f => f === 'none'), mono.outside);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(400);
await page.screenshot({ path: SHOTS + 'fx-3-mono.png' });
await (await page.$('#board')).screenshot({ path: SHOTS + 'fx-3-mono-board.png' });

// 棋盘上还能正常落子（滤镜只是画法）
const playable = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const i = d.state.marks.findIndex((v, k) => v === 0 && !d.state.auto[k]);
  document.querySelectorAll('.cell')[i].click();
  return d.state.marks[i];
});
ok('套着滤镜照样能落子', playable === 1, playable);

// ---------- 5. 模糊背景 ----------
console.log('\n--- 5. 设置里的「模糊背景」 ---');
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(300);
await page.evaluate(() => document.querySelector('#filterRow [data-filter="none"]').click());
await sleep(200);
await page.keyboard.press('Escape');
await sleep(320);
await page.click('#btnSettings');
await page.waitForFunction(() => !document.getElementById('sheetWrap').hidden, { timeout: 5000 });
await sleep(320);
const sw = await page.evaluate(() => {
  const b = document.getElementById('swBlurBg');
  const row = b.closest('.switch-row');
  const sheet = document.getElementById('sheet');
  return {
    exists: !!b,
    checked: b.getAttribute('aria-checked'),
    label: b.getAttribute('aria-label'),
    text: row.querySelector('.stepper-label').textContent.trim(),
    // 九个开关在 390×844 上仍然一屏放得下
    over: sheet.scrollHeight - sheet.clientHeight,
    count: sheet.querySelectorAll('.switch').length,
    // 跟两个淡化挨在一起（视觉降噪是一组）
    order: [...sheet.querySelectorAll('.switch')].map(x => x.id).indexOf('swBlurBg'),
    fadeQueen: [...sheet.querySelectorAll('.switch')].map(x => x.id).indexOf('swFadeQueen')
  };
});
ok('设置里有「模糊背景」这一行', sw.exists && sw.label === '模糊背景', sw.label);
ok('说明写清了它只管背景', /背景/.test(sw.text) && /棋盘/.test(sw.text), sw.text);
ok('默认关着', sw.checked === 'false');
ok('紧跟在两个淡化后面', sw.order === sw.fadeQueen + 1, [sw.fadeQueen, sw.order]);
ok('九个开关在 390×844 上仍一屏放得下', sw.count === 9 && sw.over <= 0, `n=${sw.count} over=${sw.over}`);

await page.evaluate(() => document.getElementById('swBlurBg').click());
await sleep(250);
const blurred = await page.evaluate(() => {
  const layer = document.querySelector('.bg-fx');
  const kids = [...layer.children];
  const cs = getComputedStyle(layer);
  return {
    cls: document.documentElement.classList.contains('is-blur-bg'),
    // 模糊应该挂在**每一枚**上，但 14 枚用的是同一条规则
    itemFilters: [...new Set(kids.map(k => getComputedStyle(k).filter))],
    // 容器自己不许再套 filter / opacity：那会把 14 个子层拍平成一张 surface
    layerFilter: cs.filter,
    layerOpacity: cs.opacity,
    board: getComputedStyle(document.getElementById('board')).filter,
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').blurBg,
    checked: document.getElementById('swBlurBg').getAttribute('aria-checked')
  };
});
ok('拨开：html 挂上 is-blur-bg', blurred.cls && blurred.checked === 'true');
ok('模糊挂在每一枚形状上、半径只有原来的一半（3.5px）',
  blurred.itemFilters.length === 1 && /blur\(3\.5px\)/.test(blurred.itemFilters[0]),
  blurred.itemFilters);
ok('容器自己不套滤镜、也不压透明度（套了就把子层拍平，每帧重新合成）',
  blurred.layerFilter === 'none' && blurred.layerOpacity === '1',
  [blurred.layerFilter, blurred.layerOpacity]);
ok('棋盘不受影响', blurred.board === 'none', blurred.board);
ok('写进存档', blurred.saved === true);
await page.screenshot({ path: SHOTS + 'fx-4-blur.png' });
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(300);

await boot();
const blurReload = await page.evaluate(() => {
  const layer = document.querySelector('.bg-fx');
  return {
    cls: document.documentElement.classList.contains('is-blur-bg'),
    item: layer && layer.children[0] ? getComputedStyle(layer.children[0]).filter : '',
    setting: __QUEENS_DEBUG__.look().blurBg
  };
});
ok('刷新后模糊背景还在', blurReload.cls && blurReload.setting === true && /blur/.test(blurReload.item),
  blurReload);

// 关掉它，后面的截图/清理都干净
await page.evaluate(() => {
  __QUEENS_DEBUG__.settings.blurBg = false;
  document.documentElement.classList.remove('is-blur-bg');
  localStorage.setItem('queens.settings.v1',
    JSON.stringify(Object.assign({ sv: 2 }, __QUEENS_DEBUG__.settings)));
});

// ---------- 6. ?unlock=all ----------
console.log('\n--- 6. ?unlock=all：临时全解开、不落盘 ---');
/* 前面第 4 节把「黑白」真的解锁过一次（写进了账本）。这里先清干净：
 * 基线得是「锁着的那些还锁着」，才验得出「临时解锁不落盘、刷新就退回去」。 */
await page.evaluate(() => __QUEENS_DEBUG__.lookClear());
await sleep(120);
const beforeLedger = await page.evaluate(() => localStorage.getItem('queens.looks.v1'));
await boot(URL + '?unlock=all');
const unlocked = await page.evaluate(() => {
  __QUEENS_DEBUG__.openLook();
  const all = [...document.querySelectorAll('.showcase')];
  return {
    total: all.length,
    locked: all.filter(b => b.classList.contains('is-locked')).length,
    badges: all.filter(b => {
      const l = b.querySelector('.sc-lock');
      return !!l && l.offsetParent !== null;
    }).length,
    ledger: localStorage.getItem('queens.looks.v1')
  };
});
ok('十八个展位全部解锁', unlocked.total === 18 && unlocked.locked === 0, unlocked);
ok('小锁一个都不露', unlocked.badges === 0, unlocked.badges);
ok('临时解锁不写账本', unlocked.ledger === beforeLedger, [beforeLedger, unlocked.ledger]);
// 能直接选上「黑白」并落地（真账本里它还锁着，这一趟说了算）
await page.evaluate(() => document.querySelector('#filterRow [data-filter="mono"]').click());
await sleep(250);
ok('锁定的一套也能当场选上并生效',
  await page.evaluate(() => document.documentElement.getAttribute('data-filter') === 'mono' &&
    /grayscale/.test(document.getElementById('board').style.filter)));
await page.screenshot({ path: SHOTS + 'fx-5-unlockall.png' });

// 刷新（不带参数）回到真实账本
await boot();
const after = await page.evaluate(() => ({
  filter: __QUEENS_DEBUG__.look().filter,
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').filterStyle,
  ledger: localStorage.getItem('queens.looks.v1')
}));
ok('不带参数刷新：滤镜退回「无」（没解锁的存不住）', after.filter === 'none', after);
ok('账本没被弄脏', after.ledger === beforeLedger, [beforeLedger, after.ledger]);

// ---------- 7. 少动画 ----------
console.log('\n--- 7. prefers-reduced-motion ---');
/* 先把涟漪与飘落真的打开并存进设置，再切「少动画」——出厂本来就是三样都无，
 * 不先打开的话这条只会证明「默认关着」，证明不了 reduced-motion 管用。 */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.lookUnlock('click', 'ripple');
  d.lookUnlock('bg', 'snow');
  d.settings.clickStyle = 'ripple';
  d.settings.bgStyle = 'snow';
  localStorage.setItem('queens.settings.v1',
    JSON.stringify(Object.assign({ sv: 2 }, d.settings)));
});
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await boot();
const reduced = await page.evaluate(() => {
  const cell = document.querySelectorAll('.cell')[5];
  const r = cell.getBoundingClientRect();
  return {
    look: __QUEENS_DEBUG__.look(),
    hasBg: !!document.querySelector('.bg-fx'),
    x: r.left + r.width / 2, y: r.top + r.height / 2
  };
});
await page.mouse.click(reduced.x, reduced.y);
await sleep(150);
ok('少动画：设置里仍是涟漪 / 飘落，但背景层根本不建',
  reduced.look.click === 'ripple' && reduced.look.bg === 'snow' && reduced.hasBg === false,
  JSON.stringify(reduced.look) + ' hasBg=' + reduced.hasBg);
ok('少动画时点格子没有涟漪',
  await page.evaluate(() => document.querySelectorAll('.fx-rip').length) === 0);

/* 水面也一样：少动画时整块水都不建，水线画布更不会有 */
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.lookUnlock('bg', 'tide');
  d.settings.bgStyle = 'tide';
  localStorage.setItem('queens.settings.v1',
    JSON.stringify(Object.assign({ sv: 2 }, d.settings)));
});
await boot();
const reducedTide = await page.evaluate(() => {
  const cell = document.querySelectorAll('.cell')[9];
  const r = cell.getBoundingClientRect();
  return {
    bg: __QUEENS_DEBUG__.look().bg,
    water: document.querySelectorAll('.w-rise, .w-wash').length,
    surf: document.querySelectorAll('.w-surf').length,
    x: r.left + r.width / 2, y: r.top + r.height / 2
  };
});
await page.mouse.click(reducedTide.x, reducedTide.y);
await sleep(180);
ok('少动画：水面设着也不建水块、更不会有水线画布',
  reducedTide.bg === 'tide' && reducedTide.water === 0 && reducedTide.surf === 0,
  JSON.stringify(reducedTide));
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

// ---------- 汇总 ----------
console.log('\n--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
