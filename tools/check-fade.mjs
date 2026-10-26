/* ============================================================================
 * 淡化（设置里的「淡化 ×」/「淡化皇后」）
 *
 *   python serve.py --no-open
 *   node tools/check-fade.mjs
 *
 * 规矩：淡化是**即时生效**的外观偏好，跟音效 / 冲突高亮一类；拨开关立刻落地，
 * 而棋盘上的变动走 **0.5 秒防抖**——手停下来才一起淡下去。
 *
 * 覆盖：
 *   1. 设置里有这两个开关、**两个默认都关**、aria 与标签对得上（文案不点名具体外观）
 *   2. 拨开「淡化 ×」后：× 格（手标 + 自动）0.5 秒后透成纸色；空格永不淡
 *   3. 皇后默认不淡；打开开关立刻淡（不等防抖），关掉立刻回来
 *   4. 防抖：落子后 250ms 还没淡、600ms 之后淡了；连涂会从最后一笔重新计时
 *   5. 已经淡着的格子不跟着闪：新落一子只点亮那一格
 *   6. 淡的是**整个格子**：底色换成背景纸色（不是掺白），画退一档；
 *      色块边线那层不动；冲突格不淡
 *   7. 换过外观之后还是照样淡（脚本只认 marks，不认画法）
 *   8. 写进存档，刷新还在；解开时皇后亮回来
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

const boot = async () => {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
  await sleep(600);
};
await boot();
await page.evaluate(() => { localStorage.clear(); });
await boot();

/* 摆几格：一颗皇后、两个手标；顺便让自动标记铺开 */
async function setup() {
  return page.evaluate(() => {
    const d = __QUEENS_DEBUG__;
    d.state.marks.fill(0);
    d.state.marks[0] = 2;           // 皇后
    d.state.marks[1] = 1;           // 手标 ×
    d.state.marks[2] = 1;           // 手标 ×
    d.state.lastTap = null;
    d.render(false);
    const auto = [];
    for (let i = 0; i < d.state.auto.length; i++) if (d.state.auto[i]) auto.push(i);
    return { auto: auto.length, empty: d.state.auto.findIndex((v, i) => !v && !d.state.marks[i]) };
  });
}
const dimOf = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return el ? el.classList.contains('is-dim') : null;
}, sel);

// ---------- 1. 设置面板 ----------
console.log('\n--- 设置里的两个开关 ---');
await page.click('#btnSettings');
await page.waitForFunction(() => !document.getElementById('sheetWrap').hidden);
await sleep(300);
const ui = await page.evaluate(() => {
  const m = document.getElementById('swFadeMark');
  const q = document.getElementById('swFadeQueen');
  const rowText = el => el.closest('.switch-row').querySelector('.stepper-label').textContent.trim();
  return {
    mark: { exists: !!m, checked: m.getAttribute('aria-checked'), label: m.getAttribute('aria-label'), text: rowText(m) },
    queen: { exists: !!q, checked: q.getAttribute('aria-checked'), label: q.getAttribute('aria-label'), text: rowText(q) },
    settings: { mark: __QUEENS_DEBUG__.settings.fadeMark, queen: __QUEENS_DEBUG__.settings.fadeQueen },
    // 跟「自动打叉」挨着，读起来是一组
    order: [...document.querySelectorAll('#sheet .switch-row .switch')].map(b => b.id)
  };
});
ok('两个开关都在设置里', ui.mark.exists && ui.queen.exists);
ok('默认：两个都关（淡化 × 不再默认开）',
  ui.mark.checked === 'false' && ui.queen.checked === 'false' &&
  ui.settings.mark === false && ui.settings.queen === false,
  ui.settings);
ok('标题与说明写清了 0.5 秒', /淡化 ×/.test(ui.mark.text) && /0\.5 秒/.test(ui.mark.text), ui.mark.text);
ok('文案不点名具体外观（以后加新外观不用改字）',
  !/(小猫|圆点|「点」|叉的样式)/.test(ui.mark.text + ui.queen.text) && /外观/.test(ui.queen.text),
  `${ui.mark.text} / ${ui.queen.text}`);
ok('两个淡化开关挨在一起（自动打叉 / 拖动对齐之后）',
  ui.order.indexOf('swFadeMark') === ui.order.indexOf('swAlignDrag') + 1 &&
  ui.order.indexOf('swFadeQueen') === ui.order.indexOf('swAlignDrag') + 2,
  ui.order.join(','));
await page.screenshot({ path: SHOTS + '22-fade-sheet.png' });

// ---------- 2. 拨开「淡化 ×」后的行为 ----------
console.log('\n--- 拨开淡化 ×：× 淡、皇后不淡 ---');
await page.evaluate(() => document.getElementById('swFadeMark').click());
await sleep(150);
ok('拨开后设置与存档都跟上', await page.evaluate(() =>
  __QUEENS_DEBUG__.settings.fadeMark === true &&
  JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').fadeMark === true));
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(320);
const st = await setup();
await sleep(120);
const fresh = await page.evaluate(() => ({
  x: document.querySelector('.cell[data-i="1"]').classList.contains('is-dim'),
  auto: __QUEENS_DEBUG__.state.auto.some((v, i) => v && document.querySelector(`.cell[data-i="${i}"]`).classList.contains('is-dim'))
}));
ok('刚落笔的 × 先亮着（防抖没到）', fresh.x === false && fresh.auto === false, fresh);

await sleep(120);
const stillFresh = await dimOf('.cell[data-i="1"]');
await sleep(400);
const dimX = await dimOf('.cell[data-i="1"]');
const dimAuto = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const i = d.state.auto.findIndex(v => v);
  return document.querySelector(`.cell[data-i="${i}"]`).classList.contains('is-dim');
});
const dimQ = await dimOf('.cell[data-i="0"]');
const emptyDim = await page.evaluate(i => document.querySelector(`.cell[data-i="${i}"]`).classList.contains('is-dim'), st.empty);
ok('250ms 时还没淡（0.5 秒防抖）', stillFresh === false);
ok('手标 × 淡了', dimX === true);
ok('自动打的 × 也淡了', dimAuto === true, st.auto);
ok('皇后默认不淡', dimQ === false);
ok('空格永不淡', emptyDim === false);

await sleep(350);   // 等淡下去那 .3s 过渡走完，后面量的是落定值

const look = await page.evaluate(async () => {
  const cell = document.querySelector('.cell[data-i="1"]');
  const mark = cell.querySelector('.mark');
  const q = document.querySelector('.cell[data-i="0"]');
  const rb = document.getElementById('rb');
  const border = rb ? rb.querySelector('path') : null;
  const done = ms => new Promise(r => setTimeout(r, ms));

  // 背景纸色（页面底色）—— 淡下去就该是这个色，而不是「色块色掺白」
  const paper = getComputedStyle(document.body).backgroundColor;

  // 先量「淡定」之后的样子
  const bgDim = getComputedStyle(cell).backgroundColor;
  const markOpacity = +getComputedStyle(mark).opacity;
  const queenBg = getComputedStyle(q).backgroundColor;
  const rc = getComputedStyle(cell).getPropertyValue('--rc').trim();

  // 摘下再挂上：底色该回到色块自己的颜色
  cell.classList.remove('is-dim');
  await done(400);
  const bgPlain = getComputedStyle(cell).backgroundColor;
  cell.classList.add('is-dim');
  await done(400);

  // 冲突格不淡：底色与画都还原
  cell.classList.add('is-conflict');
  await done(400);
  const conflictBg = getComputedStyle(cell).backgroundColor;
  const conflictMark = +getComputedStyle(mark).opacity;
  cell.classList.remove('is-conflict');

  return {
    paper,
    bgDim,
    bgPlain,
    rc,
    markOpacity,
    queenBg,
    conflictBg,
    conflictMark,
    rbOpacity: +getComputedStyle(rb).opacity,
    borderOpacity: border ? +getComputedStyle(border).opacity : null
  };
});
ok('淡下去就是背景纸色（不是掺白）', look.bgDim === look.paper, `${look.bgDim} vs 纸色 ${look.paper}`);
ok('不淡时还是色块自己的颜色', look.bgPlain !== look.paper && look.bgPlain !== look.bgDim, `${look.bgPlain} rc=${look.rc}`);
ok('格子里的画退一档但还看得见', look.markOpacity > .2 && look.markOpacity < .5, look.markOpacity);
ok('皇后那格没淡（开关没开）', look.queenBg !== look.paper, look.queenBg);
ok('色块边线那层没跟着淡', look.rbOpacity === 1 && look.borderOpacity === 1,
  `rb=${look.rbOpacity} path=${look.borderOpacity}`);
ok('冲突格不淡（底色与画都还原）',
  look.conflictBg === look.bgPlain && look.conflictMark === 1,
  `${look.conflictBg} vs ${look.bgPlain}, mark=${look.conflictMark}`);

// 收面板拍一张棋盘：面板开着时 app 是 inert 的，拍也拍不到棋盘
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(400);
await page.screenshot({ path: SHOTS + '23-fade-board.png' });
await page.click('#btnSettings');
await sleep(320);

// ---------- 3. 开 / 关皇后淡化（立刻生效） ----------
console.log('\n--- 拨开关：立刻落地 ---');
await page.evaluate(() => document.getElementById('swFadeQueen').click());
await sleep(80);
const queenOn = await page.evaluate(() => ({
  checked: document.getElementById('swFadeQueen').getAttribute('aria-checked'),
  dim: document.querySelector('.cell[data-i="0"]').classList.contains('is-dim'),
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').fadeQueen
}));
ok('打开后 80ms 内就淡（不等防抖）', queenOn.dim === true);
ok('开关状态与存档同步', queenOn.checked === 'true' && queenOn.saved === true);
await sleep(400);
const queenFinal = await page.evaluate(() => ({
  bg: getComputedStyle(document.querySelector('.cell[data-i="0"]')).backgroundColor,
  paper: getComputedStyle(document.body).backgroundColor,
  piece: +getComputedStyle(document.querySelector('.cell[data-i="0"] .piece')).opacity
}));
ok('皇后那格的底色也变成纸色', queenFinal.bg === queenFinal.paper, queenFinal.bg);
ok('皇后本身退一档（0.3–0.6）', queenFinal.piece > .3 && queenFinal.piece < .6, queenFinal.piece);

await page.evaluate(() => document.getElementById('swFadeQueen').click());
await sleep(80);
const queenOff = await page.evaluate(() => ({
  dim: document.querySelector('.cell[data-i="0"]').classList.contains('is-dim'),
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').fadeQueen
}));
ok('关掉立刻摘掉淡化', queenOff.dim === false && queenOff.saved === false);

// ---------- 4. 防抖：从最后一笔重新计时 ----------
console.log('\n--- 防抖 ---');
await page.evaluate(() => { document.getElementById('btnCloseSheet').click(); });
await sleep(300);
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.marks.fill(0); d.state.lastTap = null; d.render(false);
});
await sleep(700);

const t0 = Date.now();
await page.evaluate(() => { const d = __QUEENS_DEBUG__; d.state.marks[5] = 1; d.render(false); });
await sleep(300);
await page.evaluate(() => { const d = __QUEENS_DEBUG__; d.state.marks[6] = 1; d.render(false); });
const at420 = await dimOf('.cell[data-i="5"]');
await sleep(250);
const at670 = await dimOf('.cell[data-i="5"]');
await sleep(400);
const at1070 = await dimOf('.cell[data-i="5"]');
ok('第二笔之后、0.5 秒没到，第一格还亮着（计时被重置）', at420 === false, `${Date.now() - t0}ms`);
ok('第二笔后 550ms 还没到点', at670 === false, `${Date.now() - t0}ms`);
ok('手停下满 0.5 秒后一起淡', at1070 === true, `${Date.now() - t0}ms`);

// ---------- 5. 已淡的不跟着闪 ----------
console.log('\n--- 新的一笔不整盘闪 ---');
const flash = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const before = document.querySelectorAll('.cell.is-dim').length;
  d.state.marks[7] = 1; d.render(false);
  const after = document.querySelectorAll('.cell.is-dim').length;
  return { before, after, newOne: document.querySelector('.cell[data-i="7"]').classList.contains('is-dim') };
});
ok('旧格子保持淡（没整盘亮一下）', flash.after >= flash.before - 0, `${flash.before}→${flash.after}`);
ok('新落的这一格先亮着', flash.newOne === false);
await sleep(700);
ok('半秒后新格子也归队', (await dimOf('.cell[data-i="7"]')) === true);

// ---------- 6. 换外观照样淡 ----------
console.log('\n--- 换过外观之后 ---');
await setup();
await sleep(900);          // 等它淡好（0.5s 防抖 + 0.3s 过渡）
await page.evaluate(() => {
  // 点与猫现在是锁着的外观，测试要用先解锁（探针顺带刷新展柜）
  __QUEENS_DEBUG__.lookUnlock('mark', 'dot');
  __QUEENS_DEBUG__.lookUnlock('piece', 'cat');
  document.getElementById('btnLook').click();
});
await sleep(320);
await page.evaluate(() => {
  document.querySelector('#markRow [data-mark="dot"]').click();
  document.querySelector('#pieceRow [data-piece="cat"]').click();
});
await sleep(260);
await page.evaluate(() => { document.getElementById('btnLookDone').click(); });
await sleep(600);
const other = await page.evaluate(() => {
  const x = document.querySelector('.cell.is-x');
  const q = document.querySelector('.cell.is-q');
  const paper = getComputedStyle(document.body).backgroundColor;
  return {
    mark: document.documentElement.getAttribute('data-mark'),
    piece: document.documentElement.getAttribute('data-piece'),
    xDim: x ? x.classList.contains('is-dim') : null,
    qDim: q ? q.classList.contains('is-dim') : null,
    xBg: x ? getComputedStyle(x).backgroundColor : null,
    qBg: q ? getComputedStyle(q).backgroundColor : null,
    paper
  };
});
ok('换过外观之后 × 那格照样淡成纸色',
  other.mark === 'dot' && other.xDim === true && other.xBg === other.paper, other.xBg);
ok('皇后开关关着时皇后那格不淡', other.piece === 'cat' && other.qDim === false, other.qDim);

// 打开皇后淡化，确认换过的外观也一样
await page.click('#btnSettings');
await sleep(300);
await page.evaluate(() => document.getElementById('swFadeQueen').click());
await sleep(450);
const queenDim = await page.evaluate(() => {
  const q = document.querySelector('.cell.is-q');
  return {
    dim: q.classList.contains('is-dim'),
    bg: getComputedStyle(q).backgroundColor,
    paper: getComputedStyle(document.body).backgroundColor,
    piece: +getComputedStyle(q.querySelector('.piece')).opacity
  };
});
ok('皇后那格也淡成纸色（与画法无关）',
  queenDim.dim === true && queenDim.bg === queenDim.paper, queenDim.bg);
ok('那笔画还留得下影子', queenDim.piece > .3 && queenDim.piece < .6, queenDim.piece);
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(260);

// ---------- 7. 存档 + 解开亮回来 ----------
console.log('\n--- 存档与胜利 ---');
await boot();
const saved = await page.evaluate(() => ({
  s: { mark: __QUEENS_DEBUG__.settings.fadeMark, queen: __QUEENS_DEBUG__.settings.fadeQueen },
  // 续玩恢复出来的盘：不该先整盘亮 0.5 秒
  dimSoon: document.querySelectorAll('.cell.is-dim').length,
  marked: __QUEENS_DEBUG__.state.marks.filter(v => v !== 0).length
}));
ok('刷新后设置还在', saved.s.mark === true && saved.s.queen === true, saved.s);
ok('续玩恢复的盘直接就淡着（没有闪一下）', saved.dimSoon > 0, `dim=${saved.dimSoon} marked=${saved.marked}`);

// 面板每次打开都按设置刷一遍开关（跟其它即时生效的开关一个规矩）
await page.click('#btnSettings');
await page.waitForFunction(() => !document.getElementById('sheetWrap').hidden);
await sleep(300);
const panel = await page.evaluate(() => ({
  mark: document.getElementById('swFadeMark').getAttribute('aria-checked'),
  queen: document.getElementById('swFadeQueen').getAttribute('aria-checked')
}));
ok('面板上的开关跟着存档走', panel.mark === 'true' && panel.queen === 'true', panel);
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(260);

const won = await page.evaluate(async () => {
  const paper = getComputedStyle(document.body).backgroundColor;
  document.getElementById('board').classList.add('is-won');
  await new Promise(r => setTimeout(r, 400));
  const q = document.querySelector('.cell.is-q');
  return {
    paper,
    bg: q ? getComputedStyle(q).backgroundColor : null,
    piece: q ? +getComputedStyle(q.querySelector('.piece')).opacity : null
  };
});
ok('解开时皇后那格亮回来（底色不是纸色）',
  won.bg && won.bg !== won.paper && won.piece === 1, won);
await page.evaluate(() => document.getElementById('board').classList.remove('is-won'));

// ---------- 汇总 ----------
console.log('\n--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
