/* ============================================================================
 * 每日挑战（换一局面板的「每日挑战」标签 + 战绩里的日历）
 *
 *   python serve.py --no-open
 *   node tools/check-daily.mjs
 *
 * 规矩：
 *   · 两种玩法（自定义 / 每日挑战）在面板顶上切；挑战组可折叠，选每日自动摊开
 *   · 每日挑战的每一项都锁死：棋盘 = 该挡最大盘、限时按挡位、步数不限、
 *     禁用提示、可以撤销、禁用记录点、标错 3 条命
 *   · 难度四挡，完成前一挡才解锁下一挡；打完任意一挡就算完成今日挑战
 *   · 同一挡的棋盘只跟日期有关：打两次拿到的是同一盘；只写内存里的状态，
 *     不改写玩家自己的设置
 *   · 解开才记账（core/daily.js），战绩里那本日历按天点亮
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
  const phase = await page.evaluateHandle(async () => {
    const { view } = await import('/src/js/core/state.js');
    const { isLookBusy } = await import('/src/js/looks/effects.js');
    return { get rolling() { return view.rolling; }, get animating() { return isLookBusy(); } };
  });
  try {
    await page.waitForFunction((s, phase) => {
      const st = __QUEENS_DEBUG__.state;
      return st.regions && !phase.rolling && !phase.animating && document.getElementById('newWrap').hidden &&
        (s === null || st.seed !== s);
    }, { timeout: 40000 }, prevSeed, phase);
  } finally { await phase.dispose(); }
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
    daily: d.state.daily,
    hintDisabled: document.getElementById('btnHint').disabled,
    undoLocked: document.getElementById('btnUndo').classList.contains('is-locked'),
    snapLocked: document.getElementById('btnSnap').classList.contains('is-locked'),
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}'),
    dailyAll: d.dailyAll()
  };
});

const st = () => page.evaluate(() => __QUEENS_DEBUG__.daily());

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
ok('后三档今天还锁着',
  ['mid', 'hard', 'extreme'].every(lv => p.diffs.some(d => d.lv === lv && d.dis)), p.diffs);
ok('棋盘固定 5×5（容易的最大盘）', p.sizeVal === '5', p.sizeVal);
ok('步进器按不动', p.sizeMinus && p.sizePlus);
ok('常用尺寸那一行收起', p.quickHidden);
ok('限时固定 3 分', p.limitOn.join() === '3 分', p.limitOn);
ok('限时挡位全灰', p.limitAllDisabled);
ok('步数固定「不限」', p.stepOn.join() === '不限', p.stepOn);
ok('标错固定 3 条', p.lifeOn.join() === '3 条', p.lifeOn);
ok('标错挡位全灰', p.lifeAllDisabled);
ok('禁用提示开 / 撤销关 / 记录点开',
  p.noHint === 'true' && p.noUndo === 'false' && p.noSnap === 'true',
  `${p.noHint}/${p.noUndo}/${p.noSnap}`);
ok('三颗开关都锁着', p.switchesLocked);
ok('说明写明「固定限时 3 分钟」', /固定限时 3 分钟/.test(p.limitHint), p.limitHint);
ok('说明写明不限步数', /不限步数/.test(p.stepHint), p.stepHint);
ok('说明写明扣 3 条', /3 条/.test(p.lifeHint), p.lifeHint);
ok('难度那行说清解锁关系', /解锁/.test(p.diffHint), p.diffHint);
ok('尺寸那行说是最大盘', /5×5/.test(p.sizeHint), p.sizeHint);
ok('按钮变成「开始今日挑战」', p.shuffle === '开始今日挑战', p.shuffle);
ok('今日进度 0/4', p.badge === '0/4', p.badge);
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
ok('限时 3 分钟', g.limit === 180000, g.limit);
ok('步数不限 / 标错 3 条 / 满血', g.stepLimit === 0 && g.lifeLimit === 3 && g.lives === 3,
  `${g.stepLimit}/${g.lifeLimit}/${g.lives}`);
ok('提示锁 / 记录点锁 / 撤销开着', g.hintDisabled && g.snapLocked && !g.undoLocked,
  `${g.hintDisabled}/${g.snapLocked}/${g.undoLocked}`);
ok('这一局记着是每日挑战', g.daily && g.daily.day === today.day && g.daily.tier === 'easy',
  JSON.stringify(g.daily));
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
await page.waitForFunction(() => __QUEENS_DEBUG__.state.status === 'won' &&
  !document.getElementById('result').hidden, { timeout: 5000 });
g = await game();
ok('解开了', await page.evaluate(() => __QUEENS_DEBUG__.state.status === 'won'));
ok('日历里记上了「容易」', !!g.dailyAll[today.day] && !!g.dailyAll[today.day].easy,
  JSON.stringify(g.dailyAll[today.day] || null));
let d0 = await st();
ok('完成「容易」就算完成今日挑战（任意一挡即算）',
  d0.done.easy === true && d0.complete === true, JSON.stringify({ done: d0.done, complete: d0.complete }));
ok('「中等」解锁了、后面还锁着',
  d0.unlocked.mid === true && d0.unlocked.hard === false && d0.unlocked.extreme === false, d0.unlocked);
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
ok('图例四挡齐全', cal.legend === 4, cal.legend);
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

console.log('\n--- 7. 再打两挡：点变多，完成状态不变 ---');
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const day = d.daily().day;
  d.dailyMark(day, 'mid', 240000, 40);
  d.dailyMark(day, 'hard', 480000, 70);
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
ok('今天三颗点（容易 / 中等 / 困难）', cal2.dots === 3, cal2.dots);
ok('仍然是点亮的整格 + ✓', cal2.done && cal2.check, `${cal2.done}/${cal2.check}`);
ok('角标还是 ✓（多打一挡不改变完成状态）', cal2.badge === '✓', cal2.badge);
ok('读数把三挡都列出来', /容易/.test(cal2.detail) && /中等/.test(cal2.detail) &&
  /困难/.test(cal2.detail), cal2.detail);
await page.screenshot({ path: `${SHOTS}/daily-5-done.png` });
await closeRecords();

console.log('\n--- 8. 解锁链：打完「困难」后「极难」也开了 ---');
d0 = await st();
ok('极难解锁、四挡都完成', d0.unlocked.extreme === true && d0.complete === true, d0.unlocked);
await openSheet();
await jsClick('#tabModeDaily');
await sleep(320);
p = await panel();
ok('面板四挡都能点', p.diffs.filter(d => d.lv !== 'any').every(d => !d.dis), p.diffs);
ok('默认停在还没完成的「极难」', p.diffs.some(d => d.lv === 'extreme' && d.on), p.diffs);
ok('极难 = 16×16 + 20 分钟', p.sizeVal === '16' && p.limitOn.join() === '20 分',
  p.sizeVal + '/' + p.limitOn);
ok('面板说今天已完成', /今日已完成/.test(p.note), p.note);
/* 停在还没打完的「极难」上：这一天虽然已经算完成，但这一挡还是第一次打 */
ok('按钮是「开始今日挑战」（极难还没打过）', p.shuffle === '开始今日挑战', p.shuffle);
await page.screenshot({ path: `${SHOTS}/daily-6-late.png` });
await closeSheet();

console.log('\n--- 9. 刷新：还是同一局、锁还在 ---');
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
ok('限时与三把锁都还在',
  back.limit === 300000 && back.noHint === true && back.noUndo === false && back.noSnap === true,
  `${back.limit}/${back.noHint}/${back.noUndo}/${back.noSnap}`);

console.log('\n--- 10. 重试这一局：还是同一盘，仍记在每日里 ---');
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.elapsed = 400000;   // 8×8 中等 = 5 分钟，超时
  d.state.runningSince = 0;
});
await sleep(900);
const lost = await page.evaluate(() => ({
  status: __QUEENS_DEBUG__.state.status,
  open: !document.getElementById('result').hidden,
  title: document.getElementById('resultTitle').textContent.trim()
}));
ok('超时判负', lost.status === 'lost' && lost.open && lost.title === '时间到', JSON.stringify(lost));
await jsClick('#btnAgain');
await sleep(800);
const retry = await game();
ok('重试仍是每日挑战（day / tier 没丢）',
  !!retry.daily && retry.daily.tier === 'mid', JSON.stringify(retry.daily));
ok('重试还是同一盘', retry.regions === beforeReload.regions);
ok('限时重新给满', retry.limit === 300000);

console.log('\n--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} pass / ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
