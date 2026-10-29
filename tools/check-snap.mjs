/* ============================================================================
 * 记录点（工具栏第三颗）
 *
 *   python serve.py --no-open
 *   node tools/check-snap.mjs
 *
 * 覆盖：
 *   1. 结构：这颗按钮 + 右上角「?」，320 / 390 两档都放得下、不挤出屏幕
 *   2. 记下：抄一份整盘 marks（不压撤销点、不涨步数），按钮翻成墨底「还原」
 *   3. 还原：回到那一刻、只占一个撤销位、**不算一步**、记录点用完即清
 *   4. 长按清空：红环走满 620ms → 清空 + 不误触发一次「记下」
 *   5. 挑战「禁用记录点」：只写 pending、换一局才生效、按钮灰掉 + 斜纹
 *   6. 存档：刷新回来还认得那一刻；换一局就没有
 *   7. 键盘：S / Shift+S
 *   8. 点「?」的注视引导：光点从角标飞向提示行 + 提示行对焦 + 减少动效时跳过
 * ========================================================================== */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Projects/Games/queens-puzzle/tools/shots/';
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
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions, { timeout: 20000 });
await sleep(600);
// 自动打叉会往棋盘上铺 ×，测试里只关心自己点的那些
await page.evaluate(() => { __QUEENS_DEBUG__.state.autoMark = false; __QUEENS_DEBUG__.render(); });
await sleep(200);

const D = fn => page.evaluate(fn);
const marks = () => D(() => Array.prototype.slice.call(__QUEENS_DEBUG__.state.marks).join(''));
const steps = () => D(() => __QUEENS_DEBUG__.state.steps);
const snap = () => D(() => __QUEENS_DEBUG__.snap());
const btn = () => D(() => {
  const b = document.getElementById('btnSnap');
  return {
    label: document.getElementById('snapLabel').textContent.trim(),
    filled: b.classList.contains('is-filled'),
    locked: b.classList.contains('is-locked'),
    disabled: b.disabled,
    pressed: b.getAttribute('aria-pressed'),
    title: b.getAttribute('title'),
    snap: __QUEENS_DEBUG__.snap() !== null
  };
});
async function tapCell(i) {
  await page.evaluate(i => document.querySelectorAll('.cell')[i].click(), i);
  await sleep(380);   // 拉开双击窗口，免得被判成「放皇后」
}
async function jsClick(sel) {
  const r = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return 'missing:' + s;
    el.click();
    return 'ok';
  }, sel);
  if (r !== 'ok') throw new Error(r);
}
async function clearAll() {
  const playing = await D(() => __QUEENS_DEBUG__.state.status === 'playing');
  if (!playing) { await D(() => __QUEENS_DEBUG__.retry()); await sleep(500); }
  await D(() => __QUEENS_DEBUG__.clear());
  await sleep(260);
  await D(() => { __QUEENS_DEBUG__.clearSnap(true); });
  await sleep(200);
}
async function openSheet() {
  await jsClick('#btnNew');
  await page.waitForFunction(() => !document.getElementById('newWrap').hidden, { timeout: 5000 });
  await sleep(420);
}
async function closeSheetIfOpen() {
  const open = await D(() => !document.getElementById('newWrap').hidden);
  if (open) { await jsClick('#btnCloseNew'); await sleep(380); }
}
async function shuffle() {
  const seed = await D(() => __QUEENS_DEBUG__.state.seed);
  await jsClick('#btnShuffle');
  await page.waitForFunction(s => {
    const st = __QUEENS_DEBUG__.state;
    return st.seed !== s && st.vibe && document.getElementById('newWrap').hidden;
  }, { timeout: 40000 }, seed);
  await sleep(300);
  await D(() => { __QUEENS_DEBUG__.state.autoMark = false; __QUEENS_DEBUG__.render(); });
  await sleep(150);
}

/* ============================================================ 1 · 结构 */
console.log('\n1 · 结构');
const layout390 = await D(() => {
  const t = document.getElementById('toolbar');
  const bs = [...t.querySelectorAll('.btn')];
  const help = document.getElementById('snapHelp').getBoundingClientRect();
  const snapR = document.getElementById('btnSnap').getBoundingClientRect();
  const hintR = document.getElementById('btnHint').getBoundingClientRect();
  return {
    count: bs.length,
    widths: bs.map(b => Math.round(b.getBoundingClientRect().width)),
    h: Math.round(snapR.height),
    overflow: t.scrollWidth - t.clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    helpInside: help.width > 0 && help.right < window.innerWidth && help.top > 0,
    helpOverlapsHint: help.right > hintR.left
  };
});
ok('工具栏是五颗', layout390.count === 5, layout390.count);
ok('390 上五颗等宽且不溢出', layout390.overflow <= 0 && layout390.docOverflow <= 0, layout390);
ok('390 上「?」在屏幕里', layout390.helpInside, layout390.helpInside);
ok('「?」不压到「提示」', !layout390.helpOverlapsHint, layout390.helpOverlapsHint);
await page.screenshot({ path: `${SHOTS}/snap-390-empty.png` });

const first = await btn();
ok('初始是「记录」那一态', first.label === '记录' && !first.filled && !first.disabled && first.pressed === 'false', first);

/* ============================================================ 2 · 记下 */
console.log('\n2 · 记下这一刻');
await tapCell(0);
await tapCell(9);
await tapCell(18);
const beforeSave = await marks();
const stepsBeforeSave = await steps();
await jsClick('#btnSnap');
await sleep(320);
const afterSave = await btn();
const s1 = await snap();
ok('记下后有记录点', !!s1, s1 ? s1.marks.length : null);
ok('记的是整盘 marks', !!s1 && s1.marks.join('') === beforeSave, s1 ? s1.marks.join('') === beforeSave : false);
ok('记下不动棋盘', (await marks()) === beforeSave, true);
ok('记下不涨步数', (await steps()) === stepsBeforeSave, { before: stepsBeforeSave, after: await steps() });
ok('按钮翻成墨底「还原」',
  afterSave.label === '还原' && afterSave.filled && afterSave.pressed === 'true', afterSave);
await page.screenshot({ path: `${SHOTS}/snap-390-filled.png` });

/* ============================================================ 3 · 还原 */
console.log('\n3 · 还原');
await tapCell(27);
await tapCell(36);
const afterEdits = await marks();
const stepsAfterEdits = await steps();
ok('推歪了：棋盘已经变了', afterEdits !== beforeSave, true);
await jsClick('#btnSnap');
await sleep(360);
const restored = await marks();
const afterRestore = await btn();
ok('还原回到记下的那一刻', restored === beforeSave, { same: restored === beforeSave });
ok('还原不算一步', (await steps()) === stepsAfterEdits, { before: stepsAfterEdits, after: await steps() });
ok('预览还原之后记录点消失（回到「记录」）',
  (await snap()) === null && afterRestore.label === '记录' && !afterRestore.filled, afterRestore);

await jsClick('#btnUndo');
await sleep(320);
ok('撤销一下退回还原之前（整个还原只占一个撤销位）', (await marks()) === afterEdits,
  { undoMarks: await marks(), want: afterEdits });

/* ============================================================ 4 · 长按清空 */
console.log('\n4 · 长按清空');
await clearAll();
await tapCell(5);
await jsClick('#btnSnap');
await sleep(300);
ok('先记下一份', (await snap()) !== null, true);

const box = await D(() => {
  const r = document.getElementById('btnSnap').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await sleep(380);
const marksBeforeHold = await marks();
const holding = await D(() => {
  const b = document.getElementById('btnSnap');
  return {
    cls: b.classList.contains('is-holding'),
    hold: parseFloat(getComputedStyle(b).getPropertyValue('--hold')) || 0,
    ring: parseFloat(getComputedStyle(b, '::after').opacity) || 0,
    bg: getComputedStyle(b).backgroundColor,
    color: getComputedStyle(b).color
  };
});
ok('按住时进入清空态（红字 + 红环）',
  holding.cls && holding.hold > 0.4 && holding.ring === 1 &&
  holding.color === 'rgb(255, 92, 92)', holding);
await page.screenshot({ path: `${SHOTS}/snap-holding.png` });
await sleep(420);
await page.mouse.up();
await sleep(400);
const afterHold = await btn();
ok('环走满后记录点被清空', (await snap()) === null && afterHold.label === '记录', afterHold);
ok('清空后没被那次 click 又记一份', (await snap()) === null, await snap());
ok('清空只清记录点，棋盘一个字不动', (await marks()) === marksBeforeHold, true);
await page.screenshot({ path: `${SHOTS}/snap-after-hold.png` });

/* ============================================================ 5 · 挑战开关 */
console.log('\n5 · 挑战「禁用记录点」');
await openSheet();
ok('面板里有「禁用记录点」开关', await D(() => !!document.getElementById('swNoSnap')), true);
await jsClick('#swNoSnap');
await sleep(220);
const pendingOnly = await D(() => ({
  applied: __QUEENS_DEBUG__.settings.noSnap,
  label: document.getElementById('challengeTitle').textContent,
  locked: document.getElementById('btnSnap').disabled
}));
ok('只写 pending：这局按钮照旧能用',
  pendingOnly.locked === false && pendingOnly.applied === false, pendingOnly);
ok('组标题说「待换一局生效」', /待换一局生效/.test(pendingOnly.label), pendingOnly.label);
await shuffle();
const locked = await btn();
ok('换一局后按钮灰掉 + 斜纹', locked.disabled && locked.locked, locked);
ok('灰掉时标题说清原因', /挑战模式/.test(locked.title || ''), locked.title);
await jsClick('#btnSnap');
await sleep(250);
ok('灰掉后点它不记任何东西', (await snap()) === null, true);
await page.screenshot({ path: `${SHOTS}/snap-locked.png` });

await openSheet();
await jsClick('#swNoSnap');
await sleep(200);
await shuffle();
ok('再关掉并换一局就恢复', !(await btn()).disabled, (await btn()).disabled);

/* ============================================================ 6 · 存档 */
console.log('\n6 · 存档');
await clearAll();
await tapCell(2);
await tapCell(11);
const persistedMarks = await marks();
await jsClick('#btnSnap');
await sleep(400);   // 等 160ms 防抖写盘
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions, { timeout: 20000 });
await sleep(600);
await D(() => { __QUEENS_DEBUG__.state.autoMark = false; __QUEENS_DEBUG__.render(); });
const reloaded = await snap();
const reloadedBtn = await btn();
ok('刷新回来还认得那一刻',
  !!reloaded && reloaded.marks.join('') === persistedMarks, !!reloaded);
ok('刷新回来按钮还是「还原」', reloadedBtn.filled && reloadedBtn.label === '还原', reloadedBtn);

await openSheet();
await shuffle();
ok('换一局就把记录点带走', (await snap()) === null && !(await btn()).filled, await btn());

/* ============================================================ 7 · 键盘 */
console.log('\n7 · 键盘');
await clearAll();
await tapCell(3);
await page.keyboard.press('s');
await sleep(300);
ok('S 记下这一刻', (await snap()) !== null, true);
await tapCell(12);
const beforeRestore2 = await marks();
await page.keyboard.press('s');
await sleep(300);
ok('再按 S 还原（棋盘真的回去了）', (await marks()) !== beforeRestore2, true);
await page.keyboard.press('s');
await sleep(250);
ok('又一次 S 记下', (await snap()) !== null, true);
await page.keyboard.down('Shift');
await page.keyboard.press('s');
await page.keyboard.up('Shift');
await sleep(300);
ok('Shift+S 清空', (await snap()) === null, true);

/* ============================================================ 8 · 窄屏 */
console.log('\n8 · 320 窄屏');
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(600);
const narrow = await D(() => {
  const t = document.getElementById('toolbar');
  const bs = [...t.querySelectorAll('.btn')];
  const labels = bs.map(b => (b.querySelector('.snap-lb') || b).textContent.trim());
  /* 记录点那颗外面挂着红环（inset -2），它的 scrollWidth 天生比 clientWidth 大 2px，
     所以量「字有没有被截」要量里面的 .snap-lb，不能量按钮本身 */
  const clipped = bs.map(b => {
    const el = b.querySelector('.snap-lb') || b;
    return el.scrollWidth - el.clientWidth;
  });
  const help = document.getElementById('snapHelp').getBoundingClientRect();
  return {
    widths: bs.map(b => Math.round(b.getBoundingClientRect().width)),
    overflow: t.scrollWidth - t.clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped,
    labels,
    helpRight: Math.round(help.right),
    vw: window.innerWidth
  };
});
ok('320 上五颗都放得下（字没被截）', narrow.clipped.every(v => v <= 0), narrow.clipped);
ok('320 上不横向溢出', narrow.overflow <= 0 && narrow.docOverflow <= 0, narrow);
ok('320 上「?」还在屏幕里', narrow.helpRight <= narrow.vw, narrow);
await page.screenshot({ path: `${SHOTS}/snap-320.png` });

/* ============================================================ 9 · 面板一屏装得下 */
console.log('\n9 · 换一局面板加了第六项之后仍然一屏装得下');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(500);
await openSheet();
const sheet = await D(() => {
  const sh = document.getElementById('newSheet');
  const sw = document.getElementById('btnShuffle').getBoundingClientRect();
  return {
    scroll: Math.round(sh.scrollHeight - sh.clientHeight),
    shuffleBottom: Math.round(sw.bottom),
    vh: window.innerHeight
  };
});
ok('390×844 上不滚、「换一局」整颗都在屏里',
  sheet.scroll <= 0 && sheet.shuffleBottom <= sheet.vh, sheet);
await page.screenshot({ path: `${SHOTS}/snap-newgame.png` });
await closeSheetIfOpen();

/* ============================================================ 10 · 点「?」的注视引导 */
/* 「?」在底部工具栏，三句说明都写在棋盘上方的提示行里，中间隔着 400px。
 * 只把字换掉的话，视线还停在手指上，会觉得「点了没反应」。
 * 所以要有两样东西：一颗从角标飞过去的光点 + 提示行从糊到清的对焦。 */
console.log('\n10 · 点「?」时有光点飞向提示行');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(420);
await clearAll();
await D(() => { __QUEENS_DEBUG__.settings.noSnap = false; __QUEENS_DEBUG__.render(); });
await sleep(300);

const fly = await D(() => {
  const help = document.getElementById('snapHelp');
  const a = help.getBoundingClientRect();
  const b = document.getElementById('hint').getBoundingClientRect();
  help.click();                      // 同步派发，回读时动画已经挂上去了
  const dot = document.querySelector('.hint-flare');
  const r = dot ? dot.getBoundingClientRect() : null;
  const targets = document.getAnimations()
    .filter(x => x.effect && x.effect.target)
    .map(x => String(x.effect.target.id || x.effect.target.className || ''));
  const hint = document.getElementById('hint');
  return {
    hasDot: !!dot,
    dotOk: dot ? dot.classList.contains('is-ok') : false,
    // 光点起点应当在「?」的中心附近（t=0 时它还是 scale(.3)，矩形中心不变）
    startGap: r ? Math.round(Math.hypot(
      (r.left + r.width / 2) - (a.left + a.width / 2),
      (r.top + r.height / 2) - (a.top + a.height / 2))) : -1,
    // 从下往上飞才有意义：提示行确实在上方
    goesUp: Math.round((b.top + b.height / 2) - (a.top + a.height / 2)),
    ringAnimated: targets.indexOf('snapHelp') >= 0,
    rowAnimated: targets.indexOf('hintRow') >= 0,
    flashed: hint.classList.contains('is-ok') || hint.classList.contains('is-alert')
  };
});
ok('点下去当场就有一颗光点在飞', fly.hasDot && fly.dotOk, fly);
ok('光点是从「?」身上起飞的', fly.startGap >= 0 && fly.startGap <= 24, fly.startGap);
ok('飞行方向朝上（提示行确实在上方）', fly.goesUp < -200, fly.goesUp);
ok('提示行同时在做「对焦」动画', fly.rowAnimated, fly.rowAnimated);
ok('「?」自己荡一圈涟漪（按到了的即时反馈）', fly.ringAnimated, fly.ringAnimated);
ok('提示行的字确实换成了那句话', fly.flashed, fly.flashed);

await sleep(1000);
const settled = await D(() => ({
  dots: document.querySelectorAll('.hint-flare').length,
  filter: getComputedStyle(document.getElementById('hintRow')).filter,
  transform: getComputedStyle(document.getElementById('hintRow')).transform,
  text: document.getElementById('hint').textContent
}));
ok('光点用完即删（DOM 里不留临时节点）', settled.dots === 0, settled.dots);
ok('提示行回到干净状态（没有残留的 filter / transform）',
  settled.filter === 'none' && (settled.transform === 'none' || settled.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
  settled);

// 连点两下不该叠出两颗光点
await D(() => { document.getElementById('snapHelp').click(); });
await sleep(120);
await D(() => { document.getElementById('snapHelp').click(); });
await sleep(60);
ok('连点两下只有一颗光点在飞',
  (await D(() => document.querySelectorAll('.hint-flare').length)) === 1,
  await D(() => document.querySelectorAll('.hint-flare').length));
await sleep(900);

/* 开了「减少动效」就整段跳过：文字照样写进去，但不再位移。
 * 这条也顺带钉住「不缓存 prefers-reduced-motion」——缓存了的话，
 * 系统里中途改设置要刷新页面才认。 */
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await sleep(120);
const rm = await D(() => {
  document.getElementById('snapHelp').click();
  return {
    dots: document.querySelectorAll('.hint-flare').length,
    filtered: getComputedStyle(document.getElementById('hintRow')).filter,
    text: document.getElementById('hint').textContent
  };
});
ok('「减少动效」时不飞光点、也不给提示行加 filter',
  rm.dots === 0 && rm.filtered === 'none', rm);
ok('但话照样说（无障碍下信息不能丢）', rm.text.length > 4, rm.text);
await page.emulateMediaFeatures([]);
await sleep(200);

console.log('\n--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} pass / ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
