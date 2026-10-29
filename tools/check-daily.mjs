/* ============================================================================
 * 每日挑战（换一局面板的「每日挑战」标签 + 战绩里的日历）
 *
 *   python serve.py --no-open
 *   node tools/check-daily.mjs
 *
 * 规矩：
 *   · 两种玩法（自定义 / 每日挑战）在面板顶上切；挑战组可折叠，选每日自动摊开
 *   · 每日挑战的每一项都锁死：棋盘 = 该挡最大盘、限时与限步都按挡位、
 *     禁用提示、可以撤销、记录点可用、标错不惩罚
 *   · 难度五挡（容易→中等→较难→困难→极难），完成前一挡才解锁下一挡；
 *     打完任意一挡就算完成今日挑战
 *   · 同一挡的棋盘只跟日期有关：打两次拿到的是同一盘；只写内存里的状态，
 *     不改写玩家自己的设置
 *   · 解开才记账（core/daily.js），战绩里那本日历按天点亮
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots') + path.sep;
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

async function jsClick(sel) {
  const done = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return 'missing:' + s;
    el.click();
    return 'ok';
  }, sel);
  if (done !== 'ok') throw new Error(done);
}
async function openSheet() {
  await jsClick('#btnNew');
  await page.waitForFunction(() => !document.getElementById('newWrap').hidden, { timeout: 5000 });
  await sleep(360);
}
async function closeSheet() {
  const open = await page.evaluate(() => !document.getElementById('newWrap').hidden);
  if (open) { await jsClick('#btnCloseNew'); await sleep(320); }
}
async function waitFreshBoard(prevSeed) {
  await page.waitForFunction(s => {
    const st = __QUEENS_DEBUG__.state;
    return st.regions && document.getElementById('newWrap').hidden && (s === null || st.seed !== s);
  }, { timeout: 40000 }, prevSeed);
  await sleep(250);
}
async function openRecords() { await jsClick('#btnRecords'); await sleep(340); }
async function closeRecords() { await jsClick('#btnCloseRec'); await sleep(220); }

const panel = () => page.evaluate(() => {
  const txt = id => (document.getElementById(id) || {}).textContent || '';
  const q = (s) => document.querySelector(s);
  return {
    modeOn: (q('.mtab.is-on') || {}).id,
    badge: txt('dailyBadge').trim(),
    challengeOpen: !document.getElementById('challengeBody').hidden,
    title: txt('challengeTitle').trim(),
    sum: txt('challengeSum').trim(),
    note: txt('newNote').trim(),
    sizeVal: txt('sizeVal').trim(),
    sizeMinus: document.getElementById('sizeMinus').disabled,
    sizePlus: document.getElementById('sizePlus').disabled,
    quickHidden: document.getElementById('quickRow').hidden,
    diffs: [...document.querySelectorAll('#diffOpts .dbtn')].map(b => ({
      lv: b.dataset.level, on: b.classList.contains('is-on'),
      dis: b.disabled, hid: b.hidden
    })),
    limitOn: [...document.querySelectorAll('#limitOpts .lbtn.is-on')].map(b => b.textContent.trim()),
    limitAllDisabled: [...document.querySelectorAll('#limitOpts .lbtn')].every(b => b.disabled),
    stepOn: [...document.querySelectorAll('#stepOpts .lbtn.is-on')].map(b => b.textContent.trim()),
    lifeOn: [...document.querySelectorAll('#lifeOpts .lbtn.is-on')].map(b => b.textContent.trim()),
    lifeAllDisabled: [...document.querySelectorAll('#lifeOpts .lbtn')].every(b => b.disabled),
    noHint: document.getElementById('swNoHint').getAttribute('aria-checked'),
    noUndo: document.getElementById('swNoUndo').getAttribute('aria-checked'),
    noSnap: document.getElementById('swNoSnap').getAttribute('aria-checked'),
    autoMark: document.getElementById('swAutoMark').getAttribute('aria-checked'),
    forced: document.getElementById('swForced').getAttribute('aria-checked'),
    autoFill: document.getElementById('swAutoFill').getAttribute('aria-checked'),
    switchesLocked: [...document.querySelectorAll('#newSheet .switch')].every(b => b.disabled),
    limitHint: txt('limitHint').trim(),
    stepHint: txt('stepHint').trim(),
    lifeHint: txt('lifeHint').trim(),
    diffHint: txt('diffHint').trim(),
    sizeHint: txt('sizeHint').trim(),
    shuffle: txt('btnShuffle').trim(),
    shuffleHint: txt('shuffleHint').trim(),
    overflow: document.getElementById('newSheet').scrollHeight -
      document.getElementById('newSheet').clientHeight
  };
});

const game = () => page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  return {
    n: d.state.size,
    seed: d.state.seed,
    regions: d.state.regions ? Array.from(d.state.regions).join('') : '',
    limit: d.state.limit,
    stepLimit: d.state.stepLimit,
    lifeLimit: d.state.lifeLimit,
    lives: d.state.lives,
    noHint: d.state.noHint,
    noUndo: d.state.noUndo,
    noSnap: d.state.noSnap,
    autoMark: d.state.autoMark,
    forced: d.state.forced,
    autoFill: d.state.autoFill,
    fillHidden: document.getElementById('btnFinish').hidden,
    daily: d.state.daily,
    hintDisabled: document.getElementById('btnHint').disabled,
    undoLocked: document.getElementById('btnUndo').classList.contains('is-locked'),
    snapLocked: document.getElementById('btnSnap').classList.contains('is-locked'),
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}'),
    dailyAll: d.dailyAll()
  };
});

const st = () => page.evaluate(() => __QUEENS_DEBUG__.daily());

/* 今天的抽签：限时 / 限步 / 标错三样里每天每挡抽两样，抽哪两样只跟「日期 + 档位」有关。
 * 所以下面的断言一律对着 dailyRuleOf() 现算——写死「3 分 / 60 步」的写法第二天就会红。 */
const ruleOfTier = t => page.evaluate(
  tier => __QUEENS_DEBUG__.dailyRuleOf(tier, __QUEENS_DEBUG__.daily().day), t);
const limitTxt = ms => Math.round(ms / 60000) + ' 分';
const expectUi = r => ({
  limitOn: [r.limit ? limitTxt(r.limit) : '不限'],
  stepOn: [r.steps ? r.steps + ' 步' : '不限'],
  lifeOn: [r.lives ? r.lives + ' 条' : '不惩罚'],
  bits: [r.limit ? '限时 ' + limitTxt(r.limit) : '', r.steps ? r.steps + ' 步' : '',
    r.lives ? r.lives + ' 条命' : ''].filter(Boolean)
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(700);

console.log('\n--- 0. 全页 id 不许重名 ---');
/* 面板是各自 insertAdjacentHTML 挂上来的，id 撞了不会有任何报错：
 * getElementById 只认文档里第一个，另一个面板那颗就永远拿不到、绑不上事件。
 * 每日挑战这颗标签就栽过一次（换一局面板也叫 tabDaily，战绩那颗点不动）。 */
const dupIds = await page.evaluate(() => {
  const seen = {}, dup = [];
  document.querySelectorAll('[id]').forEach(function (el) {
    if (seen[el.id]) { if (dup.indexOf(el.id) < 0) dup.push(el.id); }
    else seen[el.id] = 1;
  });
  return dup;
});
ok('没有重复 id', dupIds.length === 0, dupIds);

console.log('\n--- 1. 两条路：自定义 / 每日挑战，挑战可折叠 ---');
await openSheet();
let p = await panel();
ok('默认停在「自定义」', p.modeOn === 'tabModeCustom', p.modeOn);
ok('挑战组默认收起', !p.challengeOpen, p.challengeOpen);
ok('收起时标题是「挑战」，右边有摘要', p.title === '挑战' && p.sum.length > 0, p.title + ' / ' + p.sum);
await jsClick('#btnChallenge');
await sleep(240);
p = await panel();
ok('点标题摊开挑战组', p.challengeOpen);
ok('摊开后「不限」那一颗还在（自定义有它）',
  p.diffs.some(d => d.lv === 'any' && !d.hid), p.diffs.map(d => d.lv + (d.hid ? '(隐)' : '')));
ok('自定义里尺寸可调', !p.sizeMinus && p.sizeVal !== '', p.sizeVal);
await page.screenshot({ path: `${SHOTS}/daily-1-custom.png` });

console.log('\n--- 2. 切到每日挑战：自动摊开 + 全部锁死 ---');
await jsClick('#tabModeDaily');
await sleep(420);
p = await panel();
ok('标签切到「每日挑战」', p.modeOn === 'tabModeDaily', p.modeOn);
ok('切过去自动摊开挑战组', p.challengeOpen);
ok('标题说明这一组是锁着的', /已锁定/.test(p.title), p.title);
ok('每日里没有「不限」难度', p.diffs.every(d => d.lv !== 'any' || d.hid), p.diffs);
ok('第一档「容易」开着', p.diffs.some(d => d.lv === 'easy' && !d.dis && d.on), p.diffs);
ok('后面四档今天还锁着',
  ['mid', 'advanced', 'hard', 'extreme'].every(lv => p.diffs.some(d => d.lv === lv && d.dis)), p.diffs);
ok('棋盘固定 5×5（容易的最大盘）', p.sizeVal === '5', p.sizeVal);
ok('步进器按不动', p.sizeMinus && p.sizePlus);
ok('常用尺寸那一行收起', p.quickHidden);
/* 三排挡位：抽到的那两样落在这一挡的值上，没抽到的那排停在「不限 / 不惩罚」。
 * 三样一个都不许落空、也不许三样全上——正好两样。 */
const easyRule = await ruleOfTier('easy');
const eUI = expectUi(easyRule);
ok('今天容易这一挡正好比两样',
  [easyRule.limit, easyRule.steps, easyRule.lives].filter(Boolean).length === 2, easyRule);
ok('限时那排跟着抽签（' + eUI.limitOn.join() + '）',
  p.limitOn.join() === eUI.limitOn.join(), p.limitOn);
ok('限时挡位全灰', p.limitAllDisabled);
ok('步数那排跟着抽签（' + eUI.stepOn.join() + '）',
  p.stepOn.join() === eUI.stepOn.join(), p.stepOn);
ok('标错那排跟着抽签（' + eUI.lifeOn.join() + '）',
  p.lifeOn.join() === eUI.lifeOn.join(), p.lifeOn);
ok('标错挡位全灰', p.lifeAllDisabled);
ok('禁用提示开 / 撤销关 / 记录点可用',
  p.noHint === 'true' && p.noUndo === 'false' && p.noSnap === 'false',
  `${p.noHint}/${p.noUndo}/${p.noSnap}`);
ok('六颗开关都锁着', p.switchesLocked);
/* 三样辅助按挡位递进关（2026-10-29）：容易这一挡三样全开 */
ok('容易这一挡三样辅助都开着',
  p.autoMark === 'true' && p.forced === 'true' && p.autoFill === 'true',
  `${p.autoMark}/${p.forced}/${p.autoFill}`);
ok('每排说明都对着今天的抽签说话',
  (easyRule.skip === 'time' ? /不比限时/.test(p.limitHint) : /固定限时/.test(p.limitHint)) &&
  (easyRule.skip === 'steps' ? /不比步数/.test(p.stepHint) : /固定限步/.test(p.stepHint)) &&
  (easyRule.skip === 'lives' ? /不比标错/.test(p.lifeHint) : /固定扣 3 条/.test(p.lifeHint)),
  [p.limitHint, p.stepHint, p.lifeHint]);
ok('摘要只列今天真比的两样',
  p.sum === eUI.bits.concat(['无提示']).join(' · '), p.sum);
/* 三样辅助不抽签，只按挡位定：较难起关补齐、困难起再关自动 ×、极难连定位也关。
 * 直接对着 ruleOf() 的纯函数值验一遍五挡。 */
const assistTable = await page.evaluate(() => ['easy', 'mid', 'advanced', 'hard', 'extreme']
  .map(t => {
    const r = __QUEENS_DEBUG__.dailyRuleOf(t, __QUEENS_DEBUG__.daily().day);
    return [t, r.autoFill, r.autoMark, r.forced];
  }));
const assistWant = [
  ['easy', true, true, true],
  ['mid', true, true, true],
  ['advanced', false, true, true],
  ['hard', false, false, true],
  ['extreme', false, false, false]
];
ok('辅助按挡位递进关（较难关补齐 / 困难关自动 × / 极难关定位）',
  JSON.stringify(assistTable) === JSON.stringify(assistWant), JSON.stringify(assistTable));
ok('辅助不进「真比哪两样」的抽签',
  (() => {
    const [t, f, m, p2] = assistTable[2];
    return t === 'advanced' && f === false && m === true && p2 === true;
  })());
ok('难度那行说清解锁关系', /解锁/.test(p.diffHint), p.diffHint);
ok('尺寸那行说是最大盘', /5×5/.test(p.sizeHint), p.sizeHint);
ok('按钮变成「开始今日挑战」', p.shuffle === '开始今日挑战', p.shuffle);
ok('今日进度 0/5', p.badge === '0/5', p.badge);
ok('面板不横向溢出 / 竖向可滚', true, p.overflow);
await page.screenshot({ path: `${SHOTS}/daily-2-daily-locked.png` });

console.log('\n--- 3. 开始：规矩落地，但不动玩家自己的设置 ---');
await page.evaluate(() => {
  // 先在设置里挂一份「自定义」的挑战，等下要验证它没被每日挑战改掉
  const d = __QUEENS_DEBUG__;
  d.settings.timeLimit = 300000;
  d.settings.lifeLimit = 0;
  d.settings.noHint = false;
  localStorage.setItem('queens.settings.v1', JSON.stringify(Object.assign({ sv: 2 }, d.settings)));
});
await jsClick('#btnShuffle');
await waitFreshBoard(null);
let g = await game();
const today = await st();
ok('装上 5×5', g.n === 5, g.n);
ok('限时按抽签落地', g.limit === easyRule.limit, `${g.limit}/${easyRule.limit}`);
ok('限步按抽签落地', g.stepLimit === easyRule.steps, `${g.stepLimit}/${easyRule.steps}`);
ok('命数按抽签落地（抽到才是 3 条）',
  g.lifeLimit === easyRule.lives && g.lives === easyRule.lives,
  `${g.lifeLimit}/${g.lives}/${easyRule.lives}`);
ok('提示锁 / 记录点可用 / 撤销开着', g.hintDisabled && !g.snapLocked && !g.undoLocked,
  `${g.hintDisabled}/${g.snapLocked}/${g.undoLocked}`);
ok('这一局记着是每日挑战', g.daily && g.daily.day === today.day && g.daily.tier === 'easy',
  JSON.stringify(g.daily));
ok('容易这一挡：自动标 × / 定位 / 补齐都开着',
  g.autoMark === true && g.forced === true && g.autoFill === true,
  `${g.autoMark}/${g.forced}/${g.autoFill}`);
ok('补齐按钮该在（还没到「只差皇后」，先收着）', g.fillHidden === true, g.fillHidden);
ok('玩家自己的设置没被改写',
  g.saved.timeLimit === 300000 && g.saved.lifeLimit === 0 && g.saved.noHint === false,
  [g.saved.timeLimit, g.saved.lifeLimit, g.saved.noHint]);
await page.screenshot({ path: `${SHOTS}/daily-3-board.png` });

console.log('\n--- 4. 只跟日期有关：再开一次还是同一盘 ---');
const first = g.regions;
await openSheet();
await jsClick('#btnShuffle');
await waitFreshBoard(null);
g = await game();
ok('同一挡再来一局，盘面一模一样', g.regions === first, g.regions.slice(0, 12) + '…');
await page.evaluate(() => { __QUEENS_DEBUG__.newGame(6); });
await page.waitForFunction(() => __QUEENS_DEBUG__.state.size === 6 && !__QUEENS_DEBUG__.state.daily,
  { timeout: 20000 });
await sleep(300);
g = await game();
ok('换回自定义就不再是每日挑战', !g.daily && g.limit === 300000, `${JSON.stringify(g.daily)}/${g.limit}`);

console.log('\n--- 5. 解开：记进日历，解锁下一挡 ---');
await openSheet();
await jsClick('#tabModeDaily');
await sleep(300);
g = await panel();
ok('自定义那局不影响每日进度（还是 0/4）', (await st()).complete === false);
await jsClick('#btnShuffle');
await waitFreshBoard(null);
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  d.state.marks.fill(0);
  for (let r = 0; r < n - 1; r++) d.state.marks[r * n + d.state.solution[r]] = 2;
  d.render(false);
  const last = (n - 1) * n + d.state.solution[n - 1];
  d.state.focus = last;
  const cells = document.querySelectorAll('.cell');
  for (let i = 0; i < cells.length; i++) cells[i].tabIndex = i === last ? 0 : -1;
  cells[last].focus();
});
await page.keyboard.press('KeyQ');
await sleep(1500);
g = await game();
ok('解开了', await page.evaluate(() => __QUEENS_DEBUG__.state.status === 'won'));
ok('日历里记上了「容易」', !!g.dailyAll[today.day] && !!g.dailyAll[today.day].easy,
  JSON.stringify(g.dailyAll[today.day] || null));
let d0 = await st();
ok('完成「容易」就算完成今日挑战（任意一挡即算）',
  d0.done.easy === true && d0.complete === true, JSON.stringify({ done: d0.done, complete: d0.complete }));
ok('「中等」解锁了、后面还锁着',
  d0.unlocked.mid === true && d0.unlocked.advanced === false &&
  d0.unlocked.hard === false && d0.unlocked.extreme === false, d0.unlocked);
/* 每日挑战里结果层的「再来一局」不该把玩家丢进一盘自定义：
 * 它回到换一局面板，而且仍停在每日挑战那一路（下一盘打哪挡自己挑）。 */
await jsClick('#btnAgain');
await sleep(500);
const afterWin = await page.evaluate(() => ({
  panel: !document.getElementById('newWrap').hidden,
  mode: (document.querySelector('.mtab.is-on') || {}).id,
  hasDaily: !!__QUEENS_DEBUG__.state.daily
}));
ok('「再来一局」回换一局面板', afterWin.panel, afterWin.panel);
ok('面板仍停在每日挑战那一路', afterWin.mode === 'tabModeDaily', afterWin.mode);
ok('原来的那盘还在（没有偷偷换成自定义）', afterWin.hasDaily, afterWin.hasDaily);
await closeSheet();

console.log('\n--- 6. 战绩第三栏：日历 ---');
await openRecords();

/* 这一颗必须用真实鼠标点：程序化 .click() 不经过命中测试，
 * 元素被盖住、或者宽度塌成 0 也照样「点得动」，测了等于没测。
 * 之前它就是因为 id 跟换一局面板那颗重名，被绑到了隐藏的那颗上：
 * 看着能点、点了没反应，而 jsClick 一路绿灯。 */
const tabBox = await page.evaluate(() => {
  const r = document.getElementById('tabDaily').getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    cx: cx, cy: cy,
    hit: hit ? (hit.id || hit.tagName) : null,
    paneHidden: document.getElementById('paneDaily').hidden
  };
});
ok('第三栏标签有实际尺寸、没被挡住', tabBox.w > 40 && tabBox.h > 20 && tabBox.hit === 'tabDaily', tabBox);
ok('点之前日历那一页还收着', tabBox.paneHidden, tabBox.paneHidden);
await page.mouse.click(tabBox.cx, tabBox.cy);
await sleep(340);

const cal = await page.evaluate(() => {
  const cell = document.querySelector('#calGrid .cal-cell.is-today');
  return {
    tabOn: document.getElementById('tabDaily').classList.contains('is-on'),
    paneShown: !document.getElementById('paneDaily').hidden,
    title: document.getElementById('calTitle').textContent.trim(),
    cells: document.querySelectorAll('#calGrid .cal-cell[data-day]').length,
    todayDots: cell ? cell.querySelectorAll('.cal-dots i.is-on').length : -1,
    todayDone: cell ? cell.classList.contains('is-done') : false,
    todayCheck: cell ? !!cell.querySelector('.cal-check') : false,
    doneCells: document.querySelectorAll('#calGrid .cal-cell.is-done').length,
    legend: document.querySelectorAll('#calLegend .cal-key').length,
    detail: document.getElementById('calDetail').textContent.trim(),
    status: document.getElementById('dailyStatus').textContent.trim(),
    month: document.getElementById('calMonth').textContent.trim(),
    badge: document.getElementById('dailyTabBadge').textContent.trim()
  };
});
ok('真实点击能打开第三栏', cal.tabOn && cal.paneShown, `${cal.tabOn}/${cal.paneShown}`);
ok('日历画满一个月的格子', cal.cells >= 28 && cal.cells <= 31, cal.cells);
ok('今天亮一颗点（容易）', cal.todayDots === 1, cal.todayDots);
/* 新规矩：打完「容易」这天就算完成，整格直接点亮 */
ok('只打了容易也整格点亮 + ✓', cal.todayDone && cal.todayCheck, `${cal.todayDone}/${cal.todayCheck}`);
ok('整月只有今天这一格点亮', cal.doneCells === 1, cal.doneCells);
ok('标签角标变成 ✓', cal.badge === '✓', cal.badge);
ok('图例五挡齐全', cal.legend === 5, cal.legend);
ok('选中那天的读数写着容易与用时', /容易/.test(cal.detail) && /\d\d:\d\d/.test(cal.detail), cal.detail);
ok('读数说完成今日挑战', /完成今日挑战/.test(cal.detail), cal.detail);
ok('今天的状态说清已完成', /今日挑战已完成/.test(cal.status), cal.status);
ok('本月小结记下 1 天 1 挡', /完成 1 天/.test(cal.month) && /记下 1 挡/.test(cal.month), cal.month);
ok('记录列表里这一局挂着「每日」角标', await page.evaluate(() => {
  document.getElementById('tabRecs').click();
  const r = document.querySelector('#recList .rec');
  return !!(r && r.querySelector('.rec-daily'));
}));
await jsClick('#tabDaily');
await sleep(200);
await page.screenshot({ path: `${SHOTS}/daily-4-calendar.png` });

/* 三个标签挤一行，窄屏最容易出问题：320 下量一下有没有横向溢出、
 * 「每日挑战」那颗还有没有地方可点（真鼠标点，别用 .click()）。 */
await jsClick('#tabRecs');          // 先退回第一栏，等下要验证点得回去
await sleep(180);
await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(360);
const narrow = await page.evaluate(() => {
  const row = document.querySelector('.rec-tabs');
  const tab = document.getElementById('tabDaily');
  const r = tab.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    rowOverflow: row.scrollWidth - row.clientWidth,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    w: Math.round(r.width),
    cx: cx, cy: cy,
    hit: hit ? (hit.id || hit.tagName) : null,
    paneHidden: document.getElementById('paneDaily').hidden
  };
});
ok('320 宽标签行不溢出', narrow.rowOverflow <= 0 && narrow.docOverflow <= 0,
  `${narrow.rowOverflow}/${narrow.docOverflow}`);
ok('320 宽「每日挑战」仍占得到位置', narrow.w > 60 && narrow.hit === 'tabDaily',
  `${narrow.w}/${narrow.hit}`);
ok('320 宽点之前日历还收着', narrow.paneHidden, narrow.paneHidden);
await page.mouse.click(narrow.cx, narrow.cy);
await sleep(320);
ok('320 宽真实点击也能打开', await page.evaluate(() =>
  !document.getElementById('paneDaily').hidden &&
  document.getElementById('tabDaily').classList.contains('is-on')));
await page.screenshot({ path: `${SHOTS}/daily-9-cal320.png` });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(320);

console.log('\n--- 7. 再打三挡：点变多，完成状态不变 ---');
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const day = d.daily().day;
  d.dailyMark(day, 'mid', 240000, 40);
  d.dailyMark(day, 'advanced', 480000, 70);
  d.dailyMark(day, 'hard', 660000, 90);
});
await jsClick('#tabRecs');
await sleep(150);
await jsClick('#tabDaily');
await sleep(300);
const cal2 = await page.evaluate(() => {
  const cell = document.querySelector('#calGrid .cal-cell.is-today');
  return {
    dots: cell ? cell.querySelectorAll('.cal-dots i.is-on').length : -1,
    done: cell ? cell.classList.contains('is-done') : false,
    check: cell ? !!cell.querySelector('.cal-check') : false,
    doneCells: document.querySelectorAll('#calGrid .cal-cell.is-done').length,
    badge: document.getElementById('dailyTabBadge').textContent.trim(),
    detail: document.getElementById('calDetail').textContent.trim()
  };
});
ok('今天四颗点（容易 / 中等 / 较难 / 困难）', cal2.dots === 4, cal2.dots);
ok('仍然是点亮的整格 + ✓', cal2.done && cal2.check, `${cal2.done}/${cal2.check}`);
ok('角标还是 ✓（多打一挡不改变完成状态）', cal2.badge === '✓', cal2.badge);
ok('读数把四挡都列出来', /容易/.test(cal2.detail) && /中等/.test(cal2.detail) &&
  /较难/.test(cal2.detail) && /困难/.test(cal2.detail), cal2.detail);
await page.screenshot({ path: `${SHOTS}/daily-5-done.png` });
await closeRecords();

console.log('\n--- 8. 解锁链：打完「困难」后「极难」也开了 ---');
d0 = await st();
ok('极难解锁、五挡都完成', d0.unlocked.extreme === true && d0.complete === true, d0.unlocked);
await openSheet();
await jsClick('#tabModeDaily');
await sleep(320);
p = await panel();
ok('面板五挡都能点', p.diffs.filter(d => d.lv !== 'any').every(d => !d.dis), p.diffs);
ok('默认停在还没完成的「极难」', p.diffs.some(d => d.lv === 'extreme' && d.on), p.diffs);
const extremeRule = await ruleOfTier('extreme');
const xUI = expectUi(extremeRule);
ok('极难 = 16×16 + 今天抽到的两项',
  p.sizeVal === '16' && p.limitOn.join() === xUI.limitOn.join() &&
  p.stepOn.join() === xUI.stepOn.join() && p.lifeOn.join() === xUI.lifeOn.join(),
  [p.sizeVal, p.limitOn, p.stepOn, p.lifeOn].join('/'));
ok('面板说今天已完成', /今日已完成/.test(p.note), p.note);
/* 极难：三样辅助全关，开关上就该是「关着」且锁死 */
ok('极难：三样辅助全关（补齐 / 自动 × / 定位）',
  p.autoFill === 'false' && p.autoMark === 'false' && p.forced === 'false',
  `${p.autoFill}/${p.autoMark}/${p.forced}`);
ok('锁着的辅助开关点不动', p.switchesLocked);
/* 停在还没打完的「极难」上：这一天虽然已经算完成，但这一挡还是第一次打 */
ok('按钮是「开始今日挑战」（极难还没打过）', p.shuffle === '开始今日挑战', p.shuffle);
await page.screenshot({ path: `${SHOTS}/daily-6-late.png` });
/* 开始极难这一局：辅助落地后整盘不该有自动 ×、也不该给补齐 */
await jsClick('#btnShuffle');
await waitFreshBoard(null);
const xg = await game();
ok('极难落地：三样辅助全关',
  xg.autoMark === false && xg.forced === false && xg.autoFill === false,
  `${xg.autoMark}/${xg.forced}/${xg.autoFill}`);
ok('极难：盘上没有自动 ×、也不亮唯一位置',
  await page.evaluate(() => document.querySelectorAll('.cell.is-auto, .cell.is-forced').length === 0));
await closeSheet();

console.log('\n--- 9. 刷新：还是同一局、锁还在 ---');
const midRule = await ruleOfTier('mid');
await openSheet();
await page.evaluate(() => { document.querySelector('#diffOpts [data-level="mid"]').click(); });
await sleep(220);
const seedBeforeMid = (await game()).seed;
await jsClick('#btnShuffle');
await waitFreshBoard(seedBeforeMid);
const beforeReload = await game();
ok('选中的是「中等」8×8 每日挑战',
  beforeReload.n === 8 && beforeReload.daily && beforeReload.daily.tier === 'mid',
  JSON.stringify(beforeReload.daily));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(700);
const back = await game();
ok('刷新后还是 8×8 的每日挑战',
  back.n === 8 && !!back.daily && back.daily.tier === 'mid', JSON.stringify(back.daily));
ok('盘面没变', back.regions === beforeReload.regions);
ok('刷新后规矩按「日期 + 档位」重算，一项不差',
  back.limit === midRule.limit && back.stepLimit === midRule.steps &&
  back.noHint === true && back.noUndo === false && back.noSnap === false &&
  back.autoMark === midRule.autoMark && back.forced === midRule.forced &&
  back.autoFill === midRule.autoFill,
  `${back.limit}/${back.stepLimit}/${back.noHint}/${back.noUndo}/${back.noSnap}` +
  ` · 辅助 ${back.autoMark}/${back.forced}/${back.autoFill}`);

console.log('\n--- 10. 超时判负 / 重试（挑一挡今天真比限时的来测） ---');
/* 五挡各抽到哪两样是日期定的，判负测试得先找到「今天比这一项」的档位。
 * 每项至少会出现在三挡里（3 选 2），五个档位全躲开的概率是 (1/3)^5 ≈ 0.4%。 */
const allRules = [];
for (const t of ['easy', 'mid', 'advanced', 'hard', 'extreme']) allRules.push(await ruleOfTier(t));
const timeRule = allRules.find(r => r.limit > 0);
const stepRule = allRules.find(r => r.steps > 0);

/* 从面板换到某一挡的每日挑战：换盘要等出题跑完（view.rolling 复位 + 面板收起） */
async function startTier(tier) {
  await openSheet();
  const onDaily = await page.evaluate(() =>
    (document.querySelector('.mtab.is-on') || {}).id === 'tabModeDaily');
  if (!onDaily) { await jsClick('#tabModeDaily'); await sleep(320); }
  await page.evaluate(t => {
    const b = document.querySelector('#diffOpts [data-level="' + t + '"]');
    if (b) b.click();
  }, tier);
  await sleep(240);
  await jsClick('#btnShuffle');
  await page.waitForFunction(t => {
    const d = __QUEENS_DEBUG__;
    return document.getElementById('newWrap').hidden && d.rolling() === false &&
      !!d.state.daily && d.state.daily.tier === t && d.state.status === 'playing' &&
      d.state.regions.length > 0;
  }, { timeout: 40000 }, tier);
  await sleep(320);
  return await game();
}

if (!timeRule) {
  console.log('  今天五挡都没抽到限时（跳过超时那节）：' + allRules.map(r => r.skip).join());
} else {
  const tb = await startTier(timeRule.tier);
  ok('挑中的这一挡今天真比限时：' + timeRule.tier + ' ' + limitTxt(timeRule.limit),
    tb.limit === timeRule.limit, `${tb.limit}/${timeRule.limit}`);
  await page.evaluate(ms => {
    const d = __QUEENS_DEBUG__;
    d.state.elapsed = ms + 5000;   // 越过这一挡的限时
    d.state.runningSince = 0;
  }, timeRule.limit);
  await sleep(900);
  const lost = await page.evaluate(() => ({
    status: __QUEENS_DEBUG__.state.status,
    lostBy: __QUEENS_DEBUG__.state.lostBy,
    open: !document.getElementById('result').hidden,
    title: document.getElementById('resultTitle').textContent.trim()
  }));
  ok('超时判负', lost.status === 'lost' && lost.lostBy === 'time' && lost.open &&
    lost.title === '时间到', JSON.stringify(lost));
  await jsClick('#btnAgain');
  await sleep(800);
  const retry = await game();
  ok('重试仍是每日挑战（day / tier 没丢）',
    !!retry.daily && retry.daily.tier === timeRule.tier, JSON.stringify(retry.daily));
  ok('重试还是同一盘', retry.regions === tb.regions);
  ok('限时重新给满、另外两项照旧',
    retry.limit === timeRule.limit && retry.stepLimit === timeRule.steps &&
    retry.lifeLimit === timeRule.lives,
    `${retry.limit}/${retry.stepLimit}/${retry.lifeLimit}`);
  await page.screenshot({ path: `${SHOTS}/daily-7-time-retry.png` });
}

console.log('\n--- 11. 步数用尽（挑一挡今天真比限步的来测） ---');
if (!stepRule) {
  console.log('  今天五挡都没抽到限步（跳过这一节）：' + allRules.map(r => r.skip).join());
} else {
  const sb = await startTier(stepRule.tier);
  ok('挑中的这一挡今天真比限步：' + stepRule.tier + ' ' + stepRule.steps + ' 步',
    sb.stepLimit === stepRule.steps, `${sb.stepLimit}/${stepRule.steps}`);
  /* 把计数器挪到「还差一步」，再真点一格：判负规矩跟自定义挑战一条 */
  await page.evaluate(() => {
    const d = __QUEENS_DEBUG__;
    d.state.steps = d.state.stepLimit - 1;
    document.querySelector('.cell').click();
  });
  await sleep(900);
  const overSteps = await page.evaluate(() => ({
    status: __QUEENS_DEBUG__.state.status,
    lostBy: __QUEENS_DEBUG__.state.lostBy,
    steps: __QUEENS_DEBUG__.state.steps,
    open: !document.getElementById('result').hidden,
    title: document.getElementById('resultTitle').textContent.trim(),
    timeLbl: document.getElementById('resTimeLbl').textContent.trim(),
    time: document.getElementById('resTime').textContent.trim()
  }));
  ok('第 ' + stepRule.steps + ' 步用完就判负',
    overSteps.status === 'lost' && overSteps.lostBy === 'steps' &&
    overSteps.steps === stepRule.steps,
    `${overSteps.status}/${overSteps.lostBy}/${overSteps.steps}`);
  ok('结果层是「步数用尽」', overSteps.open && overSteps.title === '步数用尽', overSteps.title);
  ok('中间那格写「限步 ' + stepRule.steps + '」',
    overSteps.timeLbl === '限步' && overSteps.time === String(stepRule.steps),
    `${overSteps.timeLbl}=${overSteps.time}`);
  await page.screenshot({ path: `${SHOTS}/daily-8-steps-lost.png` });
  await jsClick('#btnAgain');
  await sleep(800);
  const retrySteps = await game();
  const retryStepsNow = await page.evaluate(() => __QUEENS_DEBUG__.state.steps);
  ok('重试回到每日挑战、步数归零、限步还在',
    !!retrySteps.daily && retrySteps.daily.tier === stepRule.tier &&
    retryStepsNow === 0 && retrySteps.stepLimit === stepRule.steps,
    `${JSON.stringify(retrySteps.daily)}/${retryStepsNow}/${retrySteps.stepLimit}`);
}

console.log('\n--- 12. 三样抽两样：纯函数，只认日期 + 档位 ---');
/* 抽样 150 天 × 5 挡直接对表：每挡必须正好两样、值必须落在那张挡位表上、
 * 同一输入两次调用结果一致（刷新不换规矩），三种组合都得出现且大致均匀。 */
const matrix = await page.evaluate(() => {
  const f = __QUEENS_DEBUG__.dailyRuleOf;
  const tiers = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  const MS = { easy: 180000, mid: 300000, advanced: 600000, hard: 900000, extreme: 1200000 };
  const ST = { easy: 60, mid: 100, advanced: 150, hard: 250, extreme: 400 };
  const pad = n => (n < 10 ? '0' : '') + n;
  const combos = {}, bad = [];
  for (let i = 0; i < 150; i++) {
    const dt = new Date(2026, 0, 1 + i);
    const key = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    for (const t of tiers) {
      const a = f(t, key), b = f(t, key);
      if (JSON.stringify(a) !== JSON.stringify(b)) bad.push('不稳定 ' + key + '/' + t);
      if ([a.limit, a.steps, a.lives].filter(Boolean).length !== 2) {
        bad.push('不是两样 ' + key + '/' + t + ' ' + JSON.stringify(a));
      }
      if (a.day !== key) bad.push('day 没带上 ' + key + '/' + t);
      if (a.limit && a.limit !== MS[t]) bad.push('限时对不上 ' + key + '/' + t);
      if (a.steps && a.steps !== ST[t]) bad.push('限步对不上 ' + key + '/' + t);
      if (a.lives && a.lives !== 3) bad.push('命数不是 3 ' + key + '/' + t);
      if (a.skip !== (a.limit ? (a.steps ? 'lives' : 'steps') : 'time')) {
        bad.push('skip 对不上 ' + key + '/' + t);
      }
      combos[a.skip] = (combos[a.skip] || 0) + 1;
    }
  }
  return { bad: bad.slice(0, 6), badCount: bad.length, combos };
});
ok('150 天 × 5 挡全是「三选二」，值也对得上挡位表', matrix.badCount === 0, matrix.bad);
ok('三种组合都出现、分量大致均匀（各约 250）',
  Object.keys(matrix.combos).length === 3 &&
  Object.values(matrix.combos).every(n => n > 150 && n < 350), matrix.combos);

console.log('\n--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} pass / ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
