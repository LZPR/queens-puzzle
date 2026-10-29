/* ============================================================================
 * 标错惩罚（新一局面板里的「标错惩罚」+ 外观里的「生命」）
 *
 *   python serve.py --no-open
 *   node tools/check-lives.mjs
 *
 * 规矩：
 *   1. 命数跟限时 / 步数一个规矩：只写 pending，点「换一局」才落地；
 *   2. 皇后放到**不是解位**的格子上：这一手不落成（格子还原成空的）、
 *      红 X 拍一下、扣一条命、震一下；扣到 0 判负（结果层「命用完了」）；
 *   3. 命数进存档：刷新回来还剩几条就是几条；剩 0 条的那局读回来直接判负；
 *   4. 不惩罚（lifeLimit = 0）时一个字节都不多管：放错了照样落子；
 *   5. 生命的画法在外观面板里换（红心 / 血条），只改 <html data-life>，不碰局面。
 *
 * 覆盖：
 *   1. 面板：五个挡位、默认不惩罚、只写 pending、关掉作废、不滚也不横向溢出
 *   2. 换一局才落地：命数、那一排命、读屏文案
 *   3. 放错：不落子 / 反而扣命 / 红 X 动效 / 碎心 / 步数不涨
 *   4. 扣光判负：结果层文案、棋盘封盘、战绩记下 lr=lives
 *   5. 重试这一局：同一盘、命补满
 *   6. 刷新：剩几条还是几条；剩 0 条读回来直接判负
 *   7. 不惩罚时不拦
 *   8. 外观：红心 / 血条两套、data-life、存盘；320 窄屏不溢出
 *   9. 输了之后从顶栏换一局：那张卡不许留在新棋盘上
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
/* 装个震动探针（`buzz` 读的就是 navigator.vibrate）。
 * 不装的话 headless 里没有用户手势，Chrome 会往 console 打一条 error，
 * 「无 JS 报错」那条就永远红——那条政策跟这个游戏一点关系都没有。 */
await page.evaluateOnNewDocument(() => {
  window.__vib = [];
  try {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p) => { window.__vib.push(p); return true; }
    });
  } catch (e) { /* 忽略 */ }
});

async function jsClick(sel) {
  const done = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return 'missing:' + s;
    el.click();
    return 'ok';
  }, sel);
  if (done !== 'ok') throw new Error(done);
}
/* 「干净的冷启动」：带 ?fresh=1 打开，这段脚本在**页面加载前**把存档删掉，
 * 随后把地址栏改回不带参数的 —— 免得后面每次 reload 都再清一次。
 * 不能先 localStorage.clear() 再 reload：reload 会触发 beforeunload → doSave()，
 * 把内存里那一局（哪怕已经输了）又写回去。 */
await page.evaluateOnNewDocument(() => {
  if (!/[?&]fresh=1/.test(location.search)) return;
  try { localStorage.clear(); } catch (e) { /* 忽略 */ }
  history.replaceState(null, '', location.pathname);
});
const boot = async () => {
  await page.goto(URL + (URL.indexOf('?') < 0 ? '?fresh=1' : '&fresh=1'), { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
  await sleep(700);
};
async function openSheet() {
  await jsClick('#btnNew');
  await page.waitForFunction(() => !document.getElementById('newWrap').hidden, { timeout: 5000 });
  await sleep(400);
}
async function shuffle(prevSeed) {
  await jsClick('#btnShuffle');
  await page.waitForFunction(s => {
    const st = __QUEENS_DEBUG__.state;
    return st.seed !== s && st.vibe && document.getElementById('newWrap').hidden;
  }, { timeout: 40000 }, prevSeed);
  await sleep(260);
}
const snap = () => page.evaluate(() => ({
  n: __QUEENS_DEBUG__.state.size,
  seed: __QUEENS_DEBUG__.state.seed
}));
const st = () => page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const row = document.getElementById('livesRow');
  return {
    status: d.state.status,
    lostBy: d.state.lostBy,
    left: d.state.lives,
    limit: d.state.lifeLimit,
    steps: d.state.steps,
    rowHidden: row.hidden,
    hearts: document.querySelectorAll('#lifeHearts .heart').length,
    lostHearts: document.querySelectorAll('#lifeHearts .heart.is-lost').length,
    brokenHearts: document.querySelectorAll('#lifeHearts .heart.is-broken').length,
    ticks: document.querySelectorAll('#lifeTicks i').length,
    ratio: document.getElementById('lives').style.getPropertyValue('--life-ratio').trim(),
    label: document.getElementById('lives').getAttribute('aria-label'),
    missCells: document.querySelectorAll('.cell.is-miss').length,
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}')
  };
});
/* 放错一步：挑一格「不是解位、没被手标、也不是自动打叉」的格子，双击落皇后。
 * 双击 = 连点两下（onCell 认 340ms 内的同一个 lastTap）。 */
async function missOnce() {
  const info = await page.evaluate(() => {
    const d = __QUEENS_DEBUG__, n = d.state.size, sol = d.state.solution;
    const cells = [...document.querySelectorAll('.cell')];
    for (let i = 0; i < n * n; i++) {
      if (sol[(i / n) | 0] === i % n) continue;
      if (d.state.marks[i] !== 0) continue;
      if (d.state.auto && d.state.auto[i]) continue;
      const before = d.state.steps;
      const vibAt = window.__vib.length;
      cells[i].click();
      cells[i].click();
      return {
        i, before,
        vib: window.__vib.slice(vibAt),
        mark: d.state.marks[i],
        stairs: document.getElementById('stepCount').textContent.trim(),
        queens: document.querySelectorAll('.cell.is-q').length
      };
    }
    return null;
  });
  await sleep(120);
  return info;
}

console.log('\n--- 1. 面板：五个挡位、默认不惩罚、只写 pending ---');
await boot();
const seed0 = await snap();
await openSheet();
let ui = await page.evaluate(() => {
  const sh = document.getElementById('newSheet');
  const r = sh.getBoundingClientRect();
  const ch = sh.querySelector('.challenge');
  return {
    labels: [...document.querySelectorAll('#lifeOpts .lbtn')].map(b => b.textContent.trim()),
    on: [...document.querySelectorAll('#lifeOpts .lbtn.is-on')].map(b => b.textContent.trim()),
    hint: document.getElementById('lifeHint').textContent.trim(),
    inView: r.top >= 0 && r.bottom <= innerHeight + 1,
    scrolls: sh.scrollHeight > sh.clientHeight + 4,
    overflowX: sh.scrollWidth - sh.clientWidth,
    switches: sh.querySelectorAll('.switch').length,
    // 挑战组在「换一局」之前（按文档顺序；那颗按钮现在粘在下沿，几何位置不可靠）
    aboveShuffle: !!(ch.compareDocumentPosition(sh.querySelector('.shuffle-row')) &
      Node.DOCUMENT_POSITION_FOLLOWING),
    // 三排挡位都在挑战组里
    rows: ch.querySelectorAll('.limit-row').length,
    title: document.getElementById('challengeTitle').textContent.trim()
  };
});
ok('标错惩罚有五档：不惩罚 / 1 / 3 / 5 / 8',
  ui.labels.join() === '不惩罚,1 条,3 条,5 条,8 条', ui.labels);
ok('默认是「不惩罚」', ui.on.length === 1 && ui.on[0] === '不惩罚', ui.on);
ok('默认说明是「会扣一条命，扣光判负」', /扣一条命/.test(ui.hint), ui.hint);
// 六颗开关：自动标 × / 唯一位置提示 / 自动补全 + 禁用提示 / 撤销 / 记录点
ok('挑战组里现在是三排挡位 + 六颗开关', ui.rows === 3 && ui.switches === 6, `${ui.rows}/${ui.switches}`);
ok('挑战组仍在「换一局」上面', ui.aboveShuffle);
ok('加了这一排之后面板仍然一屏装得下（不滚）', ui.inView && !ui.scrolls, `${ui.inView}/${ui.scrolls}`);
ok('面板不横向溢出', ui.overflowX <= 0, ui.overflowX);
await page.screenshot({ path: SHOTS + 'l1-sheet.png' });

await jsClick('#lifeOpts .lbtn[data-lives="3"]');
await sleep(260);
let a = await st();
ui = await page.evaluate(() => ({
  on: [...document.querySelectorAll('#lifeOpts .lbtn.is-on')].map(b => b.textContent.trim()),
  hint: document.getElementById('lifeHint').textContent.trim(),
  title: document.getElementById('challengeTitle').textContent.trim(),
  shuffleHint: document.getElementById('shuffleHint').textContent.trim()
}));
ok('选中 3 条', ui.on[0] === '3 条', ui.on);
ok('说明改成「换一局后生效」', /换一局后生效/.test(ui.hint), ui.hint);
ok('挑战标题点亮「待换一局生效」', /待换一局生效/.test(ui.title), ui.title);
ok('待生效清单里有「标错扣命 3 条」', /标错扣命 3 条/.test(ui.shuffleHint), ui.shuffleHint);
ok('这一局的命数还没变', a.limit === 0 && a.left === 0, `${a.left}/${a.limit}`);
ok('命数那一排还藏着', a.rowHidden);
ok('设置没被写盘', a.saved.lifeLimit === 0, a.saved.lifeLimit);

console.log('\n--- 2. 关面板作废，换一局才落地 ---');
await jsClick('#btnCloseNew');
await sleep(300);
await openSheet();
ui = await page.evaluate(() => ({
  on: [...document.querySelectorAll('#lifeOpts .lbtn.is-on')].map(b => b.textContent.trim()),
  title: document.getElementById('challengeTitle').textContent.trim()
}));
ok('重开面板回到「不惩罚」', ui.on[0] === '不惩罚' && !/待换一局/.test(ui.title), ui.on + ' / ' + ui.title);

await jsClick('#lifeOpts .lbtn[data-lives="3"]');
await sleep(200);
await shuffle(seed0.seed);
a = await st();
ok('换局后命数落地：3/3', a.limit === 3 && a.left === 3, `${a.left}/${a.limit}`);
ok('命数那一排露出来了', !a.rowHidden);
ok('红心画了 3 颗、一颗都没丢', a.hearts === 3 && a.lostHearts === 0, `${a.hearts}/${a.lostHearts}`);
ok('血条那边也有 2 道刻度（3 条命）', a.ticks === 2, a.ticks);
ok('血条填充是满的', a.ratio === '1.0000', a.ratio);
ok('读屏文案说清剩几条', /还剩 3 条命，共 3 条/.test(a.label), a.label);
ok('设置写盘', a.saved.lifeLimit === 3, a.saved.lifeLimit);
await page.screenshot({ path: SHOTS + 'l2-lives.png' });

console.log('\n--- 3. 放错一步：不落子、反而扣命 ---');
const m1 = await missOnce();
a = await st();
ok('找到了一格「不是解位」的空格', m1 && m1.i >= 0, m1 && m1.i);
ok('这一手没落成：格子上没有皇后', m1.mark === 0 && m1.queens === 0, `${m1.mark}/${m1.queens}`);
ok('反而扣了一条命（3 → 2）', a.left === 2, a.left);
ok('步数不涨（这一手压根没发生）', a.steps === 0 && m1.stairs === '0', `${a.steps}/${m1.stairs}`);
ok('跟着震了一下（最后一串是 5 段的短震）',
  m1 && JSON.stringify(m1.vib[m1.vib.length - 1]) === '[30,46,30,46,70]', m1 && m1.vib);
ok('那一格正在演红 X', a.missCells === 1, a.missCells);
ok('碎掉的是最右边那一颗', a.lostHearts === 1 && a.brokenHearts === 1,
  `${a.lostHearts}/${a.brokenHearts}`);
ok('血条缩到 2/3', a.ratio === '0.6667', a.ratio);
ok('读屏文案跟着变', /还剩 2 条命/.test(a.label), a.label);
await page.screenshot({ path: SHOTS + 'l3-miss.png' });
await sleep(900);
a = await st();
ok('动效演完就收干净（红 X 与碎心都不留类名）',
  a.missCells === 0 && a.brokenHearts === 0, `${a.missCells}/${a.brokenHearts}`);
ok('已经失去的那颗留在原位（虚影占位）', a.lostHearts === 1, a.lostHearts);

console.log('\n--- 4. 扣光判负 ---');
await missOnce();
await sleep(150);
a = await st();
ok('第二次放错：2 → 1，还能玩', a.left === 1 && a.status === 'playing', `${a.left}/${a.status}`);
const m3 = await missOnce();
await sleep(900);
const over = await page.evaluate(() => {
  const r = document.getElementById('result');
  const rec = (__QUEENS_DEBUG__.records() || [])[0] || {};
  return {
    status: __QUEENS_DEBUG__.state.status,
    lostBy: __QUEENS_DEBUG__.state.lostBy,
    open: !r.hidden,
    kind: r.dataset.kind,
    kicker: document.getElementById('resultKicker').textContent.trim(),
    title: document.getElementById('resultTitle').textContent.trim(),
    timeLbl: document.getElementById('resTimeLbl').textContent.trim(),
    time: document.getElementById('resTime').textContent.trim(),
    sub: document.getElementById('resultSub').textContent.trim(),
    btn: document.getElementById('btnAgain').textContent.trim(),
    alt: document.getElementById('btnPeek').textContent.trim(),
    boardLost: document.getElementById('board').classList.contains('is-lost'),
    rec: { won: rec.won, lr: rec.lr }
  };
});
ok('第三次放错：命扣到 0、status=lost', over.status === 'lost' && over.lostBy === 'lives',
  `${over.status}/${over.lostBy}`);
ok('结果层是 lost 版', over.open && over.kind === 'lost', over.kind);
ok('文案是「命用完了」', over.title === '命用完了' && over.kicker === 'OUT OF LIVES',
  `${over.title}/${over.kicker}`);
ok('中间那格是「3 条命」', over.timeLbl === '条命' && over.time === '3', `${over.timeLbl}/${over.time}`);
ok('副标题写清标错几次、还差几只', /标错 3 次/.test(over.sub) && /还差/.test(over.sub), over.sub);
ok('按钮是「重试这一局 / 换一局新的」', over.btn === '重试这一局' && over.alt === '换一局新的',
  `${over.btn}/${over.alt}`);
ok('棋盘压暗封盘', over.boardLost);
ok('封盘后那一格也没留下皇后', m3.mark === 0, m3.mark);
ok('战绩记下这一局（没解开 / 原因是命）', over.rec.won === false && over.rec.lr === 'lives',
  JSON.stringify(over.rec));
await page.screenshot({ path: SHOTS + 'l4-lost.png' });

await page.keyboard.press('Escape');
await sleep(260);
ok('Esc 关不掉失败层', await page.evaluate(() => !document.getElementById('result').hidden));
ok('封盘后棋盘点不动', await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const before = Array.from(d.state.marks).join('');
  [...document.querySelectorAll('.cell')].forEach(c => c.click());
  return before === Array.from(d.state.marks).join('');
}));

console.log('\n--- 5. 重试这一局：同一盘、命补满 ---');
const boardBefore = await page.evaluate(() => ({
  regions: Array.from(__QUEENS_DEBUG__.state.regions).join(),
  solution: Array.from(__QUEENS_DEBUG__.state.solution).join()
}));
await jsClick('#btnAgain');
await sleep(700);
a = await st();
const boardAfter = await page.evaluate(() => ({
  regions: Array.from(__QUEENS_DEBUG__.state.regions).join(),
  solution: Array.from(__QUEENS_DEBUG__.state.solution).join()
}));
ok('回到 playing、棋盘不暗了', a.status === 'playing', a.status);
ok('还是同一盘棋', boardBefore.regions === boardAfter.regions && boardBefore.solution === boardAfter.solution);
ok('命补满 3 条、一颗都没丢', a.left === 3 && a.lostHearts === 0, `${a.left}/${a.lostHearts}`);

console.log('\n--- 6. 刷新：剩几条就是几条 ---');
await missOnce();
await sleep(320);
const beforeReload = await st();
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(800);
a = await st();
ok('刷新前剩 2 条', beforeReload.left === 2, beforeReload.left);
ok('刷新后还是 2 条、3 颗心里丢 1 颗',
  a.left === 2 && a.limit === 3 && a.lostHearts === 1, `${a.left}/${a.limit}/${a.lostHearts}`);
ok('刷新后命数那一排还在', !a.rowHidden);

// 剩 0 条命的那局读回来直接判负（存的是「还在玩、但一条命都没了」）
// 直接写 localStorage 没用：刷新时 beforeunload → doSave() 会把内存里的真值盖回去。
// 改内存，然后照常 reload —— 存盘就是真实的那一条路。
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.lives = 0;
  d.state.status = 'playing';
  d.state.lostBy = '';
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(1000);
a = await st();
const dead = await page.evaluate(() => ({
  status: __QUEENS_DEBUG__.state.status,
  lostBy: __QUEENS_DEBUG__.state.lostBy,
  open: !document.getElementById('result').hidden,
  title: document.getElementById('resultTitle').textContent.trim()
}));
ok('剩 0 条命读回来直接判负', dead.status === 'lost' && dead.lostBy === 'lives', `${dead.status}/${dead.lostBy}`);
ok('直接摆出「命用完了」那张卡', dead.open && dead.title === '命用完了', dead.title);

console.log('\n--- 7. 不惩罚时不拦 ---');
const layers = () => page.evaluate(() => ({
  resultHidden: document.getElementById('result').hidden,
  sheet: __QUEENS_DEBUG__.sheet()
}));
await boot();
ok('冷启动进来没有残留的结果层', (await layers()).resultHidden === true);
await openSheet();
await jsClick('#lifeOpts .lbtn[data-lives="0"]');
await sleep(180);
const s2 = await snap();
await shuffle(s2.seed);
a = await st();
ok('换回「不惩罚」：命数 0、那一排藏起来', a.limit === 0 && a.rowHidden, `${a.limit}/${a.rowHidden}`);
const free = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size, sol = d.state.solution;
  const cells = [...document.querySelectorAll('.cell')];
  for (let i = 0; i < n * n; i++) {
    if (sol[(i / n) | 0] === i % n) continue;
    if (d.state.marks[i] !== 0) continue;
    if (d.state.auto && d.state.auto[i]) continue;
    cells[i].click();
    cells[i].click();
    return { mark: d.state.marks[i], miss: document.querySelectorAll('.cell.is-miss').length };
  }
  return null;
});
ok('没有惩罚时，放错的格子照样能落皇后', free.mark === 2, free.mark);
ok('也没有红 X', free.miss === 0, free.miss);

console.log('\n--- 8. 外观：红心 / 血条 ---');
await jsClick('#btnLook');
await sleep(450);
const lookUi = await page.evaluate(() => {
  const sh = document.getElementById('lookSheet');
  return {
    ids: [...document.querySelectorAll('#lifeRow .showcase')].map(b => b.dataset.life),
    plates: [...document.querySelectorAll('#lifeRow .sc-plate b')].map(b => b.textContent),
    now: document.getElementById('lifeNow').textContent.trim(),
    svgs: [...document.querySelectorAll('#lifeRow .sc-item svg')].length,
    // 四排都在（生命是最后一排）
    cases: sh.querySelectorAll('.case').length,
    attr: document.documentElement.getAttribute('data-life'),
    // 没有「知道了」按钮；内容超过一屏时面板自己滚
    doneBtn: !!sh.querySelector('.sheet-done'),
    scrolls: sh.scrollHeight > sh.clientHeight + 4
  };
});
ok('外观面板里有「生命」这一排：红心 / 血条',
  lookUi.ids.join() === 'heart,bar' && lookUi.plates.join() === '红心,血条',
  `${lookUi.ids}/${lookUi.plates}`);
ok('这一排有七个展柜组（四样画法 + 三样动效）', lookUi.cases === 7, lookUi.cases);
ok('两个摆件都有画', lookUi.svgs === 2, lookUi.svgs);
ok('默认是红心', lookUi.attr === 'heart' && /红心/.test(lookUi.now), lookUi.now);
ok('没有「知道了」按钮，内容超一屏自己滚',
  lookUi.doneBtn === false && lookUi.scrolls, `done=${lookUi.doneBtn} scrolls=${lookUi.scrolls}`);
await page.screenshot({ path: SHOTS + 'l5-look.png' });

// 先造一局带惩罚的盘，才看得出血条（命数那一排默认是藏着的）
await page.keyboard.press('Escape');
await sleep(260);
await openSheet();
await jsClick('#lifeOpts .lbtn[data-lives="5"]');
await sleep(180);
const s3 = await snap();
await shuffle(s3.seed);
await page.click('#btnLook');
await sleep(420);
// 血条是锁着的外观，测试要用先解锁（探针顺带刷新展柜的锁）
await page.evaluate(() => { __QUEENS_DEBUG__.lookUnlock('life', 'bar'); });
await page.evaluate(() => document.querySelector('#lifeRow [data-life="bar"]').click());
await sleep(300);
const bar = await page.evaluate(() => {
  const hearts = document.querySelector('.life-hearts');
  const barEl = document.querySelector('.life-bar');
  const fill = document.querySelector('.life-fill');
  return {
    attr: document.documentElement.getAttribute('data-life'),
    setting: __QUEENS_DEBUG__.settings.lifeStyle,
    heartsShown: getComputedStyle(hearts).display !== 'none',
    barShown: getComputedStyle(barEl).display !== 'none',
    fillW: Math.round(fill.getBoundingClientRect().width),
    trackW: Math.round(document.querySelector('.life-track').getBoundingClientRect().width),
    ticks: document.querySelectorAll('#lifeTicks i').length,
    transition: getComputedStyle(fill).transitionProperty + ' ' + getComputedStyle(fill).transitionDuration,
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').lifeStyle,
    now: document.getElementById('lifeNow').textContent.trim(),
    set: document.getElementById('btnLook').classList.contains('is-set'),
    hearts: document.querySelectorAll('.heart').length
  };
});
ok('切到血条：html[data-life] 变 bar', bar.attr === 'bar' && bar.setting === 'bar', bar.attr);
ok('红心让开、血条露出来', !bar.heartsShown && bar.barShown, `${bar.heartsShown}/${bar.barShown}`);
ok('血条是满的、5 条命 4 道刻度', bar.fillW === bar.trackW - 4 && bar.ticks === 4,
  `${bar.fillW}/${bar.trackW} · ${bar.ticks}`);
ok('血条宽度有过渡', /width/.test(bar.transition) && /\.\d+s/.test(bar.transition), bar.transition);
ok('红心那颗数没被换样式动过', bar.hearts === 5, bar.hearts);
ok('样式写进存档、标题跟着变', bar.saved === 'bar' && /血条/.test(bar.now), `${bar.saved}/${bar.now}`);
ok('换过样式后顶栏挂小黄点', bar.set === true);
await page.keyboard.press('Escape');
await sleep(300);
await page.screenshot({ path: SHOTS + 'l6-bar.png' });

// 血条扣命：填充缩回去
await missOnce();
await sleep(600);
const shrink = await page.evaluate(() => {
  const fill = document.querySelector('.life-fill');
  return {
    left: __QUEENS_DEBUG__.state.lives,
    ratio: document.getElementById('lives').style.getPropertyValue('--life-ratio').trim(),
    w: Math.round(fill.getBoundingClientRect().width),
    trackW: Math.round(document.querySelector('.life-track').getBoundingClientRect().width)
  };
});
ok('扣一条命：血条缩到 4/5', shrink.left === 4 && shrink.ratio === '0.8000', `${shrink.left}/${shrink.ratio}`);
ok('血条确实短了一截（不是只改了数字）', shrink.w < shrink.trackW - 4, `${shrink.w}/${shrink.trackW}`);

// 切回红心
await page.click('#btnLook');
await sleep(400);
await page.evaluate(() => document.querySelector('#lifeRow [data-life="heart"]').click());
await sleep(260);
const backHeart = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-life'),
  heartsShown: getComputedStyle(document.querySelector('.life-hearts')).display !== 'none',
  lost: document.querySelectorAll('.heart.is-lost').length,
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').lifeStyle
}));
ok('切回红心：data-life 变回 heart、丢的那颗留着虚影',
  backHeart.attr === 'heart' && backHeart.heartsShown && backHeart.lost === 1,
  `${backHeart.attr}/${backHeart.lost}`);
ok('存盘跟着切回来', backHeart.saved === 'heart', backHeart.saved);

// 刷新后样式还在
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
await sleep(800);
const afterReload = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-life'),
  left: __QUEENS_DEBUG__.state.lives,
  lost: document.querySelectorAll('.heart.is-lost').length
}));
ok('刷新后样式与剩余命数都还在',
  afterReload.attr === 'heart' && afterReload.left === 4 && afterReload.lost === 1,
  JSON.stringify(afterReload));

console.log('\n--- 9. 320 窄屏：8 条命也顶不到屏幕边 ---');
await page.evaluate(() => { __QUEENS_DEBUG__.settings.lifeLimit = 8; __QUEENS_DEBUG__.retry(); });
await sleep(700);
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(600);
const narrow = await page.evaluate(() => {
  const row = document.getElementById('livesRow');
  const r = row.getBoundingClientRect();
  return {
    hearts: document.querySelectorAll('.heart').length,
    left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    hidden: row.hidden
  };
});
ok('8 颗心都在', narrow.hearts === 8, narrow.hearts);
ok('这一排没顶出屏幕', narrow.left >= 0 && narrow.right <= narrow.vw && narrow.docOverflow <= 0,
  `${narrow.left}-${narrow.right}/${narrow.vw} overflow=${narrow.docOverflow}`);
await page.screenshot({ path: SHOTS + 'l7-320.png' });

console.log('\n--- 10. 输了之后从顶栏换一局：那张卡不许留在新棋盘上 ---');
/* 输掉那屏「不许关」只针对 Esc / 点背景：玩家主动点别的入口就是选了离开这一屏。
 * 曾经这里会留下一张亮着但没人管的卡，换完盘还浮在新棋盘上。 */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(500);
await openSheet();
await jsClick('#lifeOpts .lbtn[data-lives="1"]');
await sleep(180);
const s4 = await snap();
await shuffle(s4.seed);
a = await st();
ok('换成 1 条命', a.limit === 1 && a.left === 1, `${a.left}/${a.limit}`);
await missOnce();
await sleep(800);
a = await st();
ok('放错一格就扣光判负', a.status === 'lost' && a.lostBy === 'lives', `${a.status}/${a.lostBy}`);
ok('失败卡在（这是起点）', (await layers()).resultHidden === false);
await openSheet();   // 失败卡还开着，点顶栏「新的一局」
let ghost = await layers();
ok('点顶栏「新的一局」：失败卡让位给面板，不留在下面亮着',
  ghost.resultHidden === true && ghost.sheet === 'newgame', JSON.stringify(ghost));
const s5 = await snap();
await shuffle(s5.seed);
ghost = await layers();
a = await st();
ok('换完盘：新棋盘上没有那张旧卡',
  ghost.resultHidden === true && ghost.sheet === null, JSON.stringify(ghost));
ok('新局是干净的 1/1 血', a.status === 'playing' && a.left === 1, `${a.status}/${a.left}`);

console.log('\n--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} pass / ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
