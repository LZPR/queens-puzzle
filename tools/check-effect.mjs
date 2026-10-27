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
ok('十七个展位全部解锁', unlocked.total === 17 && unlocked.locked === 0, unlocked);
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
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

// ---------- 汇总 ----------
console.log('\n--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
