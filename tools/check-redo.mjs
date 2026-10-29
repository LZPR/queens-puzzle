/* ============================================================================
 * 重做（工具栏第二颗）+ 撤销 / 还原之后的那层残影
 *
 *   python serve.py --no-open
 *   node tools/check-redo.mjs
 *
 * 覆盖：
 *   1. 结构：工具栏五颗、重做一开始是灰的、320 / 390 都不溢出
 *   2. 重做：撤销过的能走回来、棋盘回到撤销之前、不退步数、不多压撤销点
 *   3. 多步：连撤连重做对得上；中途落一笔就把重做栈清空（改主意了）
 *   4. 刷新不保存：重载之后两边一起空，重做还是灰的
 *   5. 挑战「禁用撤销」：重做跟着一起锁（斜纹 + 一句为什么），点了没反应
 *   6. 残影：撤销后亮的正好是被撤掉那一步动过的格子；点任意格 / 重做 /
 *      换盘 都灭；拖涂一整行那种「一格以上」也要亮全
 *   7. 还原记录点同样留残影
 *   8. 键盘：Shift+Z 与 Ctrl+Y
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
const hist = () => D(() => __QUEENS_DEBUG__.history());
const trace = () => D(() => __QUEENS_DEBUG__.trace());
const redoBtn = () => D(() => {
  const b = document.getElementById('btnRedo');
  return {
    disabled: b.disabled,
    locked: b.classList.contains('is-locked'),
    title: b.getAttribute('title'),
    text: b.textContent.trim()
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
}
async function openSheet() {
  await jsClick('#btnNew');
  await page.waitForFunction(() => !document.getElementById('newWrap').hidden, { timeout: 5000 });
  await sleep(420);
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
const layout = await D(() => {
  const t = document.getElementById('toolbar');
  const bs = [...t.querySelectorAll('.btn')];
  return {
    count: bs.length,
    labels: bs.map(b => (b.querySelector('.snap-lb') || b).textContent.trim()),
    widths: bs.map(b => Math.round(b.getBoundingClientRect().width)),
    overflow: t.scrollWidth - t.clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    redoRight: Math.round(document.getElementById('btnRedo').getBoundingClientRect().right),
    undoLeft: Math.round(document.getElementById('btnUndo').getBoundingClientRect().left)
  };
});
ok('工具栏是五颗', layout.count === 5, layout.count);
ok('顺序是 撤销 / 重做 / 记录 / 提示 / 清空',
  layout.labels.join('/') === '撤销/重做/记录/提示/清空', layout.labels);
ok('390 上五颗等宽且不溢出', layout.overflow <= 0 && layout.docOverflow <= 0, layout);
ok('撤销与重做并排（重做紧贴撤销右边）', layout.redoRight - layout.undoLeft === layout.widths[0] * 2 + 6, layout.widths);

const first = await redoBtn();
ok('一开局重做是灰的', first.disabled && !first.locked, first);
ok('灰着时标题说清怎么用', /Shift\+Z/.test(first.title || ''), first.title);
ok('残影是一层独立的 SVG（不挂在格子里，光才出得来）',
  await D(() => {
    const tr = document.getElementById('tr');
    return !!tr && tr.parentElement.id === 'board' && tr.childElementCount === 0;
  }));
ok('开局没有任何残影',
  (await trace()).length === 0 && await D(() => document.querySelectorAll('#tr path').length === 0));
await page.screenshot({ path: `${SHOTS}/redo-01-idle.png` });

/* ============================================================ 2 · 重做的语义 */
console.log('\n2 · 重做');
await clearAll();
await tapCell(5);
const afterTap = await marks();
const stepsAfterTap = await steps();
const histAfterTap = await hist();
/* clearAll() 自己也是一笔（清空压了一个撤销点），所以这里该是 2：清空 + 这一下 */
ok('先落一笔：有得撤、没得重做',
  histAfterTap.undo === 2 && histAfterTap.redo === 0 && (await redoBtn()).disabled, histAfterTap);

await jsClick('#btnUndo');
await sleep(320);
ok('撤销后重做亮起来', !(await redoBtn()).disabled, await redoBtn());
ok('撤销真的把那一格退掉了', (await marks()) !== afterTap, { now: await marks() });

await jsClick('#btnRedo');
await sleep(320);
const afterRedo = await marks();
const histAfterRedo = await hist();
ok('重做把棋盘走回撤销之前', afterRedo === afterTap, { now: afterRedo, want: afterTap });
ok('重做不退步数（跟撤销一套：这不是又走了一步）',
  (await steps()) === stepsAfterTap, { before: stepsAfterTap, after: await steps() });
ok('重做不多压撤销点（回到同样的深度）',
  histAfterRedo.undo === histAfterTap.undo && histAfterRedo.redo === 0, histAfterRedo);
ok('重做完重做又灰回去', (await redoBtn()).disabled, await redoBtn());
/* 把这一局撤空（清空 + 那一笔），重做栈该跟着攒满，一个都不丢 */
await jsClick('#btnUndo');
await jsClick('#btnUndo');
await sleep(320);
ok('一直撤到空盘，重做栈攒着这两步',
  (await marks()) === '0'.repeat(64) && (await hist()).redo === 2 && !(await redoBtn()).disabled,
  { marks: (await marks()).slice(0, 8), hist: await hist() });

/* ============================================================ 3 · 多步与「改主意」 */
console.log('\n3 · 多步 / 改主意');
await clearAll();
await tapCell(0);
await tapCell(9);
await tapCell(18);
const three = await marks();
const stepsThree = await steps();
await jsClick('#btnUndo');
await jsClick('#btnUndo');
await jsClick('#btnUndo');
await sleep(320);
ok('连撤三步回到空盘', (await marks()) === '0'.repeat(64), await marks());
ok('重做栈攒了三步', (await hist()).redo === 3, await hist());
await jsClick('#btnRedo');
await jsClick('#btnRedo');
await jsClick('#btnRedo');
await sleep(320);
ok('连重做三步回到同一盘', (await marks()) === three, { now: await marks() });
ok('连重做也不退步数', (await steps()) === stepsThree, await steps());

await jsClick('#btnUndo');
await jsClick('#btnUndo');
await sleep(300);
ok('撤两步后重做栈有两步', (await hist()).redo === 2, await hist());
await tapCell(40);
const afterBranch = await marks();
const branch = await D(() => ({ h: __QUEENS_DEBUG__.history(), disabled: document.getElementById('btnRedo').disabled }));
ok('落一笔就把重做栈清空（改主意了）', branch.h.redo === 0, branch.h);
ok('清空后重做按钮跟着灰掉', branch.disabled, branch.disabled);
await jsClick('#btnRedo');
await sleep(280);
ok('灰掉时点它什么也不做', (await marks()) === afterBranch, { now: await marks() });

/* ============================================================ 4 · 刷新不保存 */
console.log('\n4 · 刷新不保存');
await jsClick('#btnUndo');       // 留一步可重做
await sleep(300);
ok('撤销后确实有得重做', (await hist()).redo === 1, await hist());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions, { timeout: 20000 });
await sleep(600);
await D(() => { __QUEENS_DEBUG__.state.autoMark = false; __QUEENS_DEBUG__.render(); });
await sleep(150);
const reloaded = await D(() => ({ h: __QUEENS_DEBUG__.history(), disabled: document.getElementById('btnRedo').disabled, trace: __QUEENS_DEBUG__.trace().length }));
ok('刷新后撤销栈不落盘（两边一起空）', reloaded.h.undo === 0 && reloaded.h.redo === 0, reloaded.h);
ok('刷新后重做按钮是灰的', reloaded.disabled, reloaded.disabled);
ok('刷新后残影也没了', reloaded.trace === 0, reloaded.trace);

/* ============================================================ 5 · 挑战锁定 */
console.log('\n5 · 挑战「禁用撤销」');
await clearAll();
await tapCell(2);
await jsClick('#btnUndo');
await sleep(300);
ok('先造一步可重做的局面', (await hist()).redo === 1, await hist());
await openSheet();
await jsClick('#swNoUndo');
await sleep(220);
await shuffle();
const locked = await redoBtn();
ok('换一局后重做灰掉 + 斜纹', locked.disabled && locked.locked, locked);
ok('灰掉时标题说清是挑战', /挑战模式/.test(locked.title || ''), locked.title);
const undoLocked = await D(() => {
  const b = document.getElementById('btnUndo');
  return { disabled: b.disabled, locked: b.classList.contains('is-locked'), title: b.getAttribute('title') };
});
ok('撤销一起锁着（同一把锁）', undoLocked.disabled && undoLocked.locked, undoLocked);
ok('换一局也把重做栈带走', (await hist()).redo === 0, await hist());
await page.screenshot({ path: `${SHOTS}/redo-02-locked.png` });
await openSheet();
await jsClick('#swNoUndo');
await sleep(200);
await shuffle();
ok('再关掉并换一局就恢复', !(await redoBtn()).disabled === false, await redoBtn());

/* ============================================================ 6 · 残影 */
console.log('\n6 · 撤销后的残影');
await clearAll();
await tapCell(27);
await tapCell(5);
const beforeUndo = await marks();
await jsClick('#btnUndo');
await sleep(320);
const one = await D(() => {
  const t = __QUEENS_DEBUG__.trace();
  const g = document.querySelector('#tr .tr-g');
  const line = document.querySelector('#tr .tr-line');
  const cs = g ? getComputedStyle(g) : null;
  /* 边框要比格子小一圈（内描边）：SVG 用户单位就是 px，所以直接跟格子的
     矩形对一下（两者都以棋盘的 padding box 为原点），四边各该往内缩
     一两个像素、而且缩得一样多 —— 它得始终待在格子里面，别去蹭色块那条墨线。 */
  const cell = document.querySelector('.cell[data-i="5"]').getBoundingClientRect();
  const grid = document.getElementById('grid').getBoundingClientRect();
  const bb = line ? line.getBBox() : null;
  const off = bb ? {
    left: bb.x - (cell.left - grid.left),
    top: bb.y - (cell.top - grid.top),
    right: (cell.right - grid.left) - (bb.x + bb.width),
    bottom: (cell.bottom - grid.top) - (bb.y + bb.height)
  } : null;
  /* 进场与呼吸要接得上：淡入的终点得等于呼吸的起点，否则 0.24s 处会
     突然暗一下（上一版 淡入到 1 / 呼吸从 .5 起跳，就是这么「一顿」的）。 */
  /* 样式都走 all.css 的 @import，关键帧藏在被 import 的那一层里，要递归进去 */
  const kf = {};
  const collect = (sheet) => {
    let rules = [];
    try { rules = sheet.cssRules; } catch (e) { return; }
    for (const r of rules) {
      if (r.type === 7) kf[r.name] = r;          // 7 = CSSKeyframesRule
      else if (r.styleSheet) collect(r.styleSheet);
    }
  };
  for (const s of document.styleSheets) collect(s);
  /* 关键帧选择器可能是一条写好几个（`0%, 100% {}`），按逗号拆开比 */
  const hits = (f, key) => f.keyText.split(',')
    .map(s => s.trim())
    .some(s => s === key || (key === '100%' && s === 'to'));
  const at = (name, key) => {
    const rule = kf[name];
    if (!rule) return null;
    for (const f of rule.cssRules) if (hits(f, key)) return parseFloat(f.style.opacity);
    return null;
  };
  const rbPath = document.querySelector('#rb path');
  return {
    trace: t,
    groups: document.querySelectorAll('#tr .tr-g').length,
    paths: document.querySelectorAll('#tr path').length,
    stroke: line ? getComputedStyle(line).stroke : '',
    rbStroke: rbPath ? getComputedStyle(rbPath).stroke : '',
    width: line ? parseFloat(getComputedStyle(line).strokeWidth) : 0,
    bw: parseFloat(getComputedStyle(document.getElementById('board')).getPropertyValue('--bw')),
    filter: line ? getComputedStyle(line).filter : '',
    opacity: cs ? parseFloat(cs.opacity) : 0,
    zTr: getComputedStyle(document.getElementById('tr')).zIndex,
    zRb: getComputedStyle(document.getElementById('rb')).zIndex,
    inExit: at('trIn', '100%'),
    breathLow: at('trBreath', '0%'),
    breathPeak: at('trBreath', '40%'),
    pointer: getComputedStyle(document.getElementById('tr')).pointerEvents,
    // 单格的外轮廓 = 四条边
    edges: line ? (line.getAttribute('d').match(/M/g) || []).length : 0,
    off: off,
    aria: document.getElementById('srStatus').textContent
  };
});
ok('撤一格就圈那一格', one.trace.length === 1 && one.trace[0] === 5, one.trace);
ok('只有一圈线（不是每格一个方框）',
  one.groups === 1 && one.paths === 1 && one.edges === 4,
  { groups: one.groups, paths: one.paths, edges: one.edges });
ok('外沿压在格线上：四边各让开半个线宽（内描边，不跟格子分家）',
  !!one.off && ['left', 'top', 'right', 'bottom']
    .every(k => Math.abs(one.off[k] - one.bw / 2) <= 0.3),
  { off: one.off, halfBw: one.bw / 2 });
ok('笔画还是棋盘那套墨色 + --bw（不是另一种颜色）',
  one.stroke !== 'none' && one.stroke === one.rbStroke
  && Math.abs(one.width - one.bw) < 0.05,
  { stroke: one.stroke, rbStroke: one.rbStroke, width: one.width, bw: one.bw });
ok('但整层很淡、起伏也小（.32–.5 呼吸，峰值也不到实墨）',
  one.breathLow === 0.32 && one.breathPeak === 0.5,
  { low: one.breathLow, peak: one.breathPeak });
ok('错开了位置，所以层级仍压在色块描边之下（不跟边线抢）',
  one.zTr === 'auto' || Number(one.zTr) < Number(one.zRb),
  { tr: one.zTr, rb: one.zRb });
ok('只剩一圈线：没有洗色、没有光晕、也没有模糊',
  one.paths === 1 && one.filter === 'none' && one.opacity > 0.15 && one.opacity <= 0.55,
  { paths: one.paths, filter: one.filter, opacity: one.opacity });
ok('淡入的终点接上呼吸的起点（不会在 0.24s 处突然一暗）',
  one.inExit !== null && one.breathLow !== null && one.inExit === one.breathLow,
  { inExit: one.inExit, breathLow: one.breathLow });
ok('这层不吃点击（还能照常往这格落笔）', one.pointer === 'none', one.pointer);
ok('读屏也听得出刚才动了哪一格', /第 1 行第 6 列/.test(one.aria), one.aria);
await page.screenshot({ path: `${SHOTS}/redo-03-trace.png` });

await tapCell(0);
await sleep(200);
ok('点任意一格（哪怕不是圈着的那格）就灭',
  (await trace()).length === 0 && await D(() => document.querySelectorAll('#tr path').length === 0),
  await trace());

// 一格以上：拖涂一整行再撤
await clearAll();
const gb = await D(() => {
  const r = document.getElementById('grid').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, n: __QUEENS_DEBUG__.state.size };
});
const cs2 = gb.w / gb.n;
const pt = (r, c) => ({ x: gb.x + (c + 0.5) * cs2, y: gb.y + (r + 0.5) * cs2 });
const a = pt(3, 1), b = pt(3, 6);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await sleep(60);
for (let k = 1; k <= 6; k++) {
  await page.mouse.move(a.x + (b.x - a.x) * k / 6, a.y);
  await sleep(40);
}
await page.mouse.up();
await sleep(280);
const paintedCount = await D(() => [...__QUEENS_DEBUG__.state.marks].filter(m => m === 1).length);
ok('拖涂一整行', paintedCount >= 3, paintedCount);
await jsClick('#btnUndo');
await sleep(340);
const row = await D(() => __QUEENS_DEBUG__.trace().slice().sort((x, y) => x - y));
ok('一整笔撤掉时整行的格子一起圈', row.length === paintedCount, { lit: row.length, want: paintedCount });
ok('圈中的正好是第 3 行那几格', row.every(i => ((i / 8) | 0) === 3), row);
ok('连成一片时中间的格缝不画线（一整圈，不是六个方框）',
  await D(() => {
    const d = document.querySelector('#tr .tr-line').getAttribute('d');
    /* 6 格横排：外轮廓是 4 条边（上下各一条 6 格长边 + 左右两条竖边），
       逐格画的话会是 6 × 4 = 24 条 */
    return (d.match(/M/g) || []).length === 4;
  }),
  await D(() => (document.querySelector('#tr .tr-line').getAttribute('d').match(/M/g) || []).length));
await page.screenshot({ path: `${SHOTS}/redo-04-trace-row.png` });

await jsClick('#btnRedo');
await sleep(320);
ok('重做不点亮残影（往前走回去的落点自己看得懂）',
  (await trace()).length === 0, await trace());

await jsClick('#btnUndo');
await sleep(300);
ok('再撤一次又亮了', (await trace()).length > 0, (await trace()).length);

/* 连贯性：淡入要直接接上呼吸的最低点，整条曲线只许往上爬。
   上一版在 0.24s 处从 1 掉到 .5，看着就是「闪一下又暗下来」。 */
await tapCell(40);
await sleep(220);
const curve = await D(async () => {
  const out = [];
  const t0 = performance.now();
  document.getElementById('btnUndo').click();
  while (performance.now() - t0 < 700) {
    const g = document.querySelector('#tr .tr-g');
    out.push([Math.round(performance.now() - t0), g ? +getComputedStyle(g).opacity : -1]);
    await new Promise(r => setTimeout(r, 25));
  }
  return out;
});
let back = 0;
for (let i = 1; i < curve.length; i++) back = Math.max(back, curve[i - 1][1] - curve[i][1]);
ok('淡入直接接上呼吸，整条亮度曲线只升不降',
  curve.length > 8 && back <= 0.03
  && curve[0][1] < 0.1 && curve[curve.length - 1][1] > 0.3,
  { samples: curve.length, back: +back.toFixed(3), first: curve[0][1], last: curve[curve.length - 1][1] });

await openSheet();
await shuffle();
ok('换一局也把残影带走',
  (await trace()).length === 0 && await D(() => document.querySelectorAll('#tr path').length === 0),
  (await trace()).length);

/* ============================================================ 7 · 还原记录点 */
console.log('\n7 · 还原记录点的残影');
await clearAll();
await tapCell(8);
await tapCell(17);
await jsClick('#btnSnap');        // 记下这一刻
await sleep(300);
const snapMarks = await marks();
await tapCell(26);
await tapCell(35);
const pushed = await marks();
await jsClick('#btnSnap');        // 还原
await sleep(360);
const restored = await D(() => ({
  marks: Array.prototype.slice.call(__QUEENS_DEBUG__.state.marks).join(''),
  trace: __QUEENS_DEBUG__.trace().slice().sort((x, y) => x - y)
}));
const reverted = [...pushed].filter((c, i) => c !== snapMarks[i]).length;
ok('还原回到记下的那一刻', restored.marks === snapMarks, { same: restored.marks === snapMarks });
ok('跳回去确实撤掉了两格', reverted === 2, reverted);
ok('但只亮「记录之后的那一步」动过的格子（不是全部）',
  restored.trace.length === 1 && restored.trace[0] === 26, restored.trace);
await page.screenshot({ path: `${SHOTS}/redo-05-trace-snap.png` });

// 记完只走一步就还原：也要亮那一格（走一步时「后一步的盘面」就是还原前的盘面）
await clearAll();
await tapCell(6);
await jsClick('#btnSnap');
await sleep(240);
await tapCell(31);
await jsClick('#btnSnap');        // 还原
await sleep(340);
ok('记完只走一步就还原：那一格也亮', (await trace()).join() === '31', await trace());

// 记完一步都没走：没有「后一步」，还原时不亮
await clearAll();
await tapCell(3);
await tapCell(12);
await jsClick('#btnSnap');
await sleep(260);
await jsClick('#btnSnap');        // 立刻还原
await sleep(320);
ok('记完还没走就还原：没有后一步，不亮', (await trace()).length === 0, await trace());

/* ============================================================ 8 · 键盘 */
console.log('\n8 · 键盘');
await clearAll();
await tapCell(1);
const k1 = await marks();
await page.keyboard.press('z');
await sleep(280);
ok('Z 撤销', (await marks()) !== k1, true);
await page.keyboard.down('Shift');
await page.keyboard.press('z');
await page.keyboard.up('Shift');
await sleep(300);
ok('Shift+Z 重做回原样', (await marks()) === k1, { now: await marks() });
await page.keyboard.press('z');
await sleep(300);
await page.keyboard.down('Control');
await page.keyboard.press('y');
await page.keyboard.up('Control');
await sleep(320);
ok('Ctrl+Y 也能重做', (await marks()) === k1, { now: await marks() });

/* ============================================================ 9 · 320 窄屏 */
console.log('\n9 · 320 窄屏');
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(600);
const narrow = await D(() => {
  const t = document.getElementById('toolbar');
  const bs = [...t.querySelectorAll('.btn')];
  return {
    widths: bs.map(b => Math.round(b.getBoundingClientRect().width)),
    clipped: bs.map(b => {
      const el = b.querySelector('.snap-lb') || b;
      return el.scrollWidth - el.clientWidth;
    }),
    labels: bs.map(b => (b.querySelector('.snap-lb') || b).textContent.trim()),
    iconShown: getComputedStyle(document.querySelector('#btnSnap .snap-ico')).display !== 'none',
    overflow: t.scrollWidth - t.clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth
  };
});
ok('320 上五颗都放得下（字没被截）', narrow.clipped.every(v => v <= 0), narrow.clipped);
ok('320 上不横向溢出', narrow.overflow <= 0 && narrow.docOverflow <= 0, narrow);
ok('320 上记录点让图标让位，留着「记录 / 还原」两个字', !narrow.iconShown && narrow.labels[2] === '记录', narrow);
await page.screenshot({ path: `${SHOTS}/redo-06-320.png` });

console.log('\n--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} pass / ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
