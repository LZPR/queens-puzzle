/* ============================================================================
 * 步数与「一键补齐」
 *   · 信息条上的步数段：一次落笔涨一步、没有 60+ 封顶、撤销重做不退、
 *     刷新页面还能接着这个数、信息页与信息条一致
 *   · 提示行上的「补齐」：只在「除了皇后位别处都划掉了」时露出，
 *     点下去挨个落子、只压一个撤销点、最后照常判胜
 *
 *   python serve.py --no-open
 *   node tools/check-finish.mjs
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'E:/Projects/Games/queens-puzzle/tools/shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => { fails++; console.log('FAIL  pageerror: ' + e.message); });
page.on('console', m => { if (m.type() === 'error') { fails++; console.log('FAIL  console: ' + m.text()); } });

async function boot(fresh) {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
  }
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
  await sleep(500);
}

/* 读信息条那一段 */
const stepState = () => page.evaluate(() => {
  const pill = document.getElementById('stepPill');
  return {
    text: document.getElementById('stepCount').textContent,
    zero: pill.classList.contains('is-zero'),
    title: pill.getAttribute('title'),
    aria: document.getElementById('btnHud').getAttribute('aria-label'),
    hudOverflow: document.getElementById('btnHud').scrollWidth - document.getElementById('btnHud').clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth
  };
});

/* 一格一格点（.click() 走 detail=0 那条合成 click，跟读屏器同一条路） */
const clickCells = (list) => page.evaluate((ids) => {
  const cells = [...document.querySelectorAll('.cell')];
  ids.forEach(i => cells[i].click());
}, list);

const boardTop = () => page.evaluate(() =>
  Math.round(document.getElementById('board').getBoundingClientRect().top));

/* 把解位以外的格子全点成 × —— 模拟「推到最后只剩皇后」 */
const markAllButQueens = (skip) => page.evaluate((skipCount) => {
  const d = __QUEENS_DEBUG__;
  const n = d.state.size;
  const onSol = new Set(Array.from(d.state.solution).map((c, r) => r * n + c));
  const cells = [...document.querySelectorAll('.cell')];
  let left = skipCount;
  for (let i = 0; i < n * n; i++) {
    if (onSol.has(i)) continue;
    if (d.state.marks[i] !== 0) continue;
    if (left > 0) { left--; continue; }     // 留几格不标，用来验「不满足条件就不露」
    cells[i].click();
  }
  return { n, sol: Array.from(d.state.solution) };
}, skip);

/* 换一盘干净棋，并等到真的装上：不拿固定的 sleep 赌出题快慢 */
async function newBoard(n) {
  await page.evaluate((size) => __QUEENS_DEBUG__.newGame(size), n);
  await page.waitForFunction((size) => {
    const d = window.__QUEENS_DEBUG__;
    return d.state.size === size && d.state.status === 'playing' &&
      document.querySelectorAll('.cell').length === size * size &&
      [...d.state.marks].every(m => m === 0);
  }, { timeout: 15000 }, n);
  await sleep(120);
}

/* 等按钮出现（不出现就等超时，让后面的断言自己红） */
const waitNudge = (shown) => page.waitForFunction(
  (want) => (document.getElementById('btnFinish').hidden === false) === want,
  { timeout: 6000 }, shown).catch(() => {});

const nudgeState = () => page.evaluate(() => {
  const b = document.getElementById('btnFinish');
  return {
    hidden: b.hidden,
    text: b.textContent.replace(/\s+/g, ' ').trim(),
    aria: b.getAttribute('aria-label'),
    rowClass: document.getElementById('hintRow').className,
    hintDisplay: getComputedStyle(document.getElementById('hint')).display,
    // 用 offsetHeight 而不是 getBoundingClientRect：后者会算进 nudgeIn 那一下 scale(.94)，
    // 刚露出来的 60ms 里量到 28 而不是 30
    h: b.offsetHeight,
    rowH: document.getElementById('hintRow').offsetHeight
  };
});

// ============================================================
// 1. 步数：首屏 / 单击 / 双击 / 连涂 / 撤销 / 重做 / 清空
// ============================================================
await boot(true);

const s0 = await stepState();
check('首屏步数为 0', s0.text === '0', s0.text);
check('0 步时整段淡下去', s0.zero === true && /还没有/.test(s0.title), s0.title);
check('读屏文案带步数', /走了 0 步/.test(s0.aria), s0.aria);
check('信息条没有横向溢出', s0.hudOverflow <= 0 && s0.docOverflow <= 0,
  `hud=${s0.hudOverflow} doc=${s0.docOverflow}`);
await page.screenshot({ path: `${OUT}/finish-01-boot.png` });

await clickCells([0]);
await sleep(160);
const s1 = await stepState();
await clickCells([9]);
await sleep(160);
const s2 = await stepState();
check('点一格算一步', s1.text === '1' && s2.text === '2', `${s1.text} → ${s2.text}`);
check('有步数后不再淡', s2.zero === false);

// 双击 = 标 × + 放皇后，只算一步（第二下是同一个动作的收尾，不另立撤销点）
const cellBox = async (i) => {
  const el = await page.$(`.cell[data-i="${i}"]`);
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const p = await cellBox(20);
await page.mouse.click(p.x, p.y);
await sleep(90);
await page.mouse.click(p.x, p.y);
await sleep(230);
const s3 = await stepState();
check('双击放皇后只算一步', s3.text === '3', s3.text);

// 拖一整行：整笔只留一个撤销点（不然一排十几格要按十几次撤销）
/* 无头浏览器偶尔会把 pointerdown / pointermove 合并掉，整笔没起笔（unhandled 的观察：1/7 次）。
 * 所以这里不赌一次成功：真的没起笔就再来一次，断言看的是「涂了几格 ↔ 涨了几步」，不是绝对数字。 */
const xCount = () => page.evaluate(() =>
  [...__QUEENS_DEBUG__.state.marks].filter(m => m === 1).length);

async function dragRow() {
  const a = await cellBox(24), b2 = await cellBox(31);
  await page.mouse.move(a.x, a.y);
  await sleep(40);
  await page.mouse.down();
  await sleep(60);
  for (let k = 1; k <= 6; k++) {
    await page.mouse.move(a.x + (b2.x - a.x) * k / 6, a.y);
    await sleep(40);
  }
  await page.mouse.up();
  await sleep(280);
  return xCount();
}

const beforeDrag = await stepState();
const xBefore = await xCount();
let painted = (await dragRow()) - xBefore;
if (painted <= 0) painted = (await dragRow()) - xBefore;
const s4 = await stepState();
check('拖一整行只算一步',
  Number(s4.text) === Number(beforeDrag.text) + 1 && painted >= 3,
  `${beforeDrag.text} → ${s4.text}，涂了 ${painted} 格`);

await page.click('#btnUndo');
await sleep(220);
const s5 = await stepState();
check('撤销不退步数（步数记的是走过的路）', s5.text === s4.text, `${s4.text} → ${s5.text}`);
check('撤销确实把棋盘退回去了', (await xCount()) < xBefore + painted, String(await xCount()));
await page.keyboard.down('Shift');
await page.keyboard.press('z');
await page.keyboard.up('Shift');
await sleep(220);
const s6 = await stepState();
check('重做也不改进步数', s6.text === s5.text, `${s5.text} → ${s6.text}`);
await page.click('#btnClear');
await sleep(220);
const s7 = await stepState();
check('清空也算一步（可撤销）', Number(s7.text) === Number(s6.text) + 1, `${s6.text} → ${s7.text}`);

/* 撤销栈到顶（UNDO_MAX = 60）之后步数照涨：栈里更早的几步撤不回去，
 * 但「这一局走了几步」跟能不能撤没关系，写成 60+ 就失去了参考意义。 */
await page.evaluate(() => __QUEENS_DEBUG__.clear());
await sleep(200);
const before61 = await stepState();   // clear() 自己也压了一个撤销点，算一步
const ids = [];
for (let i = 0; i < 61; i++) ids.push(i);
await clickCells(ids);
await sleep(300);
const sCap = await stepState();
check('超过 60 步照实写（不再是 60+）',
  sCap.text === String(Number(before61.text) + 61) && !/\+/.test(sCap.text),
  `${before61.text} → ${sCap.text}`);
check('步数确实走过了 60', Number(sCap.text) > 60, sCap.text);
check('三位数时信息条仍然不溢出', sCap.hudOverflow <= 0, String(sCap.hudOverflow));
await page.screenshot({ path: `${OUT}/finish-02-steps.png` });

// 刷新页面：步数跟着存档回来（撤销栈是不落盘的，两者在这里分道扬镳）
const beforeReload = sCap.text;
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(600);
const afterReload = await stepState();
check('刷新后步数还在', afterReload.text === beforeReload, `${beforeReload} → ${afterReload.text}`);
const reloadSub = await page.evaluate(() => {
  document.getElementById('btnHud').click();
  const sh = document.getElementById('diffSheet');
  return {
    steps: document.getElementById('infoSteps').textContent,
    sub: document.getElementById('infoStepsSub').textContent,
    open: sh.getBoundingClientRect().height > 0
  };
});
check('刷新后信息页读数也是同一个数', reloadSub.steps === beforeReload, `${reloadSub.steps}`);

// 信息页上那一张卡片
await sleep(200);
const info = await page.evaluate(() => {
  const sh = document.getElementById('diffSheet');
  return {
    steps: document.getElementById('infoSteps').textContent,
    sub: document.getElementById('infoStepsSub').textContent,
    cards: document.querySelectorAll('.info-card').length,
    /* 分享区只剩「说明 + 复制」：没有代码框可滚，也没有输入框 */
    share: !!sh.querySelector('.share'),
    copy: !!document.getElementById('btnCopyCode'),
    fields: sh.querySelectorAll('textarea, input, [contenteditable]').length,
    cardW: Math.round(document.querySelector('.info-card.is-wide').getBoundingClientRect().width),
    gridW: Math.round(document.querySelector('.info-grid').getBoundingClientRect().width)
  };
});
check('信息页卡片与信息条一致', info.steps === sCap.text, info.steps);
check('信息页解释了步数怎么读', /撤销不退/.test(info.sub), info.sub);
check('信息页五张卡片（步数占满一行）',
  info.cards === 5 && Math.abs(info.cardW - info.gridW) <= 2, `${info.cards} 张 / ${info.cardW} of ${info.gridW}`);
check('信息页带分享区（复制钮在、没有输入框）',
  info.share && info.copy && info.fields === 0, `share=${info.share} copy=${info.copy} fields=${info.fields}`);
await page.screenshot({ path: `${OUT}/finish-03-info.png` });
await page.click('#btnCloseDiff');
await sleep(280);

// ============================================================
// 2. 补齐：什么时候露、露出来长什么样
// ============================================================
await newBoard(8);
const freshTop = await boardTop();
const freshNudge = await nudgeState();
check('开局不露补齐', freshNudge.hidden === true);
check('没露时提示行还是正文', freshNudge.hintDisplay !== 'none', freshNudge.hintDisplay);

// 少标一格：活格比缺的皇后多一个，不是「只差皇后」
await markAllButQueens(1);
await sleep(400);
const notYet = await nudgeState();
check('还差别处没收尾时不露', notYet.hidden === true, notYet.text);

// 补齐剩下的那一格
await markAllButQueens(0);
await waitNudge(true);
const ready = await nudgeState();
const sameTop = await boardTop();
check('只剩皇后时露出补齐', ready.hidden === false && ready.rowClass.indexOf('is-nudge') >= 0, ready.rowClass);
check('按钮上写着差几只', /只差 8 只皇后/.test(ready.text) && /补齐/.test(ready.text), ready.text);
check('按钮有无障碍标签', /自动补齐剩下 8 只皇后/.test(ready.aria || ''), ready.aria);
check('正文让位给按钮', ready.hintDisplay === 'none', ready.hintDisplay);
check('提示行高度不变（36px）', ready.rowH === 36 && ready.h === 30, `${ready.rowH}/${ready.h}`);
check('露出按钮没有挪动棋盘', sameTop === freshTop, `${freshTop} → ${sameTop}`);
await page.screenshot({ path: `${OUT}/finish-03-nudge.png` });

// 自己放一只：按钮还在，但数字跟着少一只（不逼你非按它不可）
const manual = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const n = d.state.size;
  const cells = [...document.querySelectorAll('.cell')];
  let target = -1;
  for (let r = 0; r < n && target < 0; r++) {
    const i = r * n + d.state.solution[r];
    if (d.state.marks[i] === 0) target = i;
  }
  cells[target].click();
  cells[target].click();     // 340ms 内两下 = 放皇后
  return { target, queens: [...d.state.marks].filter(m => m === 2).length };
});
await waitNudge(true);
const afterManual = await nudgeState();
check('手动放一只后按钮还在、数字减一',
  afterManual.hidden === false && /只差 7 只皇后/.test(afterManual.text), afterManual.text);
check('手动放的那只真的落上了', manual.queens === 1, String(manual.queens));

// 解位被自己划成 × ：补不进去，也不该露（判据第 2 条）
await newBoard(8);
const crossed = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const n = d.state.size;
  const cells = [...document.querySelectorAll('.cell')];
  const solCell = d.state.solution[0];       // 第一行皇后所在的格子
  cells[solCell].click();                    // 手标 × 划在解位上
  const onSol = new Set(Array.from(d.state.solution).map((c, r) => r * n + c));
  for (let i = 0; i < n * n; i++) if (!onSol.has(i) && d.state.marks[i] === 0) cells[i].click();
  return { marks: d.state.marks[solCell], open: [...d.state.marks].filter(m => m === 0).length };
});
await sleep(500);
const afterCross = await nudgeState();
check('解位被划掉时不露', crossed.marks === 1 && afterCross.hidden === true,
  `mark=${crossed.marks} open=${crossed.open}`);

// 回到干净的一盘，重新推到「只差皇后」，留给下一节点按钮
await newBoard(8);
await markAllButQueens(0);
await waitNudge(true);
check('重来一盘仍然能露', (await nudgeState()).hidden === false);

// 「补齐」与「禁用提示」已经分开（2026-10-29）：前者看 state.autoFill，
// 后者只管提示按钮。两把都记在**这一局的状态**上（每日挑战会按挡位关掉补齐）。
const fillGates = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.noHint = true;              // 禁用提示：不该再连带收回补齐
  d.render();
  const withNoHint = document.getElementById('btnFinish').hidden;
  d.state.autoFill = false;           // 关掉自动补全：这一行才收回去
  d.render();
  const withNoFill = document.getElementById('btnFinish').hidden;
  d.state.autoFill = true;
  d.state.noHint = false;
  d.render();
  return { withNoHint, withNoFill, back: document.getElementById('btnFinish').hidden };
});
check('禁用提示不再连带收回补齐', fillGates.withNoHint === false);
check('关掉自动补全就不给补齐', fillGates.withNoFill === true);
check('两个开关都恢复后补齐又露出来', fillGates.back === false);

// ============================================================
// 3. 点下去：挨个落子、只压一个撤销点、最后照常判胜
// ============================================================
const before = await stepState();
await page.click('#btnFinish');
await sleep(60);
const justClicked = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const q = [...d.state.marks].filter(m => m === 2).length;
  return { q, status: d.state.status, hint: document.getElementById('hint').textContent, nudge: document.getElementById('btnFinish').hidden };
});
check('点下去立刻落第一只', justClicked.q >= 1 && justClicked.status === 'playing', `q=${justClicked.q}`);
check('落子期间提示行说「正在补齐」', /正在补齐/.test(justClicked.hint), justClicked.hint);
check('落子期间按钮先收起来', justClicked.nudge === true);
await page.screenshot({ path: `${OUT}/finish-04-filling.png` });

// 一串落子约 1s，赢了以后结果层还要等 0.9s 才弹（见 ui/win.js 的 checkWin）
await page.waitForFunction(() => __QUEENS_DEBUG__.state.status === 'won', { timeout: 8000 });
await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 6000 });
const done = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const n = d.state.size;
  const counts = new Array(n).fill(0);
  [...d.state.marks].forEach((m, i) => { if (m === 2) counts[d.state.regions[i]]++; });
  return {
    status: d.state.status,
    queens: [...d.state.marks].filter(m => m === 2).length,
    oneEach: counts.every(c => c === 1),
    conflicts: d.state.conflicts ? d.state.conflicts.count : 0,
    result: !document.getElementById('result').hidden,
    hint: document.getElementById('hint').textContent,
    nudge: document.getElementById('btnFinish').hidden,
    moves: d.state.moves,
    records: d.records().length
  };
});
check('补齐后判胜', done.status === 'won', done.status);
check('每块各一只、没有冲突', done.queens === 8 && done.oneEach && done.conflicts === 0,
  `q=${done.queens} one=${done.oneEach} cf=${done.conflicts}`);
check('赢了照常弹结果层', done.result === true);
check('提示行换成「解开了」', /解开了/.test(done.hint), done.hint);
check('赢了以后按钮收起来', done.nudge === true);
check('每一只都记进了步数', done.moves === 8, String(done.moves));
check('这一局进了战绩', done.records >= 1, String(done.records));
await page.screenshot({ path: `${OUT}/finish-05-won.png` });

const after = await stepState();
check('整串补齐只压一个撤销点', Number(after.text) === Number(before.text) + 1,
  `${before.text} → ${after.text}`);

// ============================================================
// 4. 换局：数字归零、按钮退场
// ============================================================
await newBoard(8);
const reset = await stepState();
const resetNudge = await nudgeState();
check('换局后步数归零', reset.text === '0', reset.text);
check('换局后补齐退场', resetNudge.hidden === true);

// ============================================================
// 5. 320 窄屏：多出来的一段不把信息条撑破
// ============================================================
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(500);
await clickCells([0, 1, 2]);
await sleep(250);
const narrow = await stepState();
check('320 宽也不溢出', narrow.hudOverflow <= 0 && narrow.docOverflow <= 0,
  `hud=${narrow.hudOverflow} doc=${narrow.docOverflow} 数字=${narrow.text}`);
await page.screenshot({ path: `${OUT}/finish-06-320.png` });

console.log('--------------------------------------------------');
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
