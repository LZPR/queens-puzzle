/* ============================================================================
 * 杂项：设置面板只剩一列开关 / 换一局面板 / 分享搬到信息页且框里无滚动条 /
 *       淡化 × 默认关 / 拖动对齐与逐格震动 / 唯一位置提示的强度 /
 *       结果层的「重来这局」
 *
 *   python serve.py --no-open
 *   node tools/check-misc.mjs
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/* 截图目录跟着脚本走：仓库搬过家，写死绝对路径会在新机器上直接建不出来 */
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
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

await page.evaluateOnNewDocument(() => {
  window.__vib = [];
  try {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p) => { window.__vib.push(p); return true; }
    });
  } catch (e) { /* 忽略 */ }
});

async function boot(fresh) {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
  }
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 20000 });
  await sleep(500);
}

// ---------- 1. 设置面板：只剩一列开关 / 不折叠 / 无滚动条 ----------
await boot(true);

const sheet = await page.evaluate(() => {
  document.getElementById('btnSettings').click();
  const s = document.getElementById('sheet');
  const rows = [...s.querySelectorAll('.switch-row')];
  const cs = getComputedStyle(s);
  return {
    open: !document.getElementById('sheetWrap').hidden,
    moreBtn: !!document.getElementById('btnMoreOpts'),
    shareInSettings: !!s.querySelector('.share'),
    total: rows.length,
    visible: rows.filter(r => r.getClientRects().length).length,
    fadeMark: document.getElementById('swFadeMark').getAttribute('aria-checked'),
    alignDrag: document.getElementById('swAlignDrag').getAttribute('aria-checked'),
    scrollbarWidth: s.offsetWidth - s.clientWidth -
      parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth),
    sbCss: cs.scrollbarWidth,
    overflow: s.scrollHeight - s.clientHeight,
    settingsFade: __QUEENS_DEBUG__.settings.fadeMark
  };
});
check('设置面板是 9 个开关，且全部摊开',
  sheet.open && sheet.total === 9 && sheet.visible === 9, `${sheet.visible}/${sheet.total}`);
check('设置面板不再有「显示更多选项」', sheet.moreBtn === false);
check('分享已经不在设置面板里', sheet.shareInSettings === false);
check('淡化 × 默认关闭', sheet.fadeMark === 'false' && sheet.settingsFade === false);
check('拖动对齐默认开着', sheet.alignDrag === 'true');
check('设置面板没有垂直滚动条，也不用滚',
  sheet.scrollbarWidth === 0 && sheet.sbCss === 'none' && sheet.overflow <= 0,
  `sbw=${sheet.scrollbarWidth} css=${sheet.sbCss} overflow=${sheet.overflow}`);
await sleep(450);
await page.screenshot({ path: `${OUT}/misc-settings.png` });
await page.evaluate(() => document.getElementById('btnCloseSheet').click());
await sleep(260);

// ---------- 2. 「开一局新的」搬进了顶栏那颗按钮的面板 ----------
const ng = await page.evaluate(() => {
  document.getElementById('btnNew').click();
  const s = document.getElementById('newSheet');
  const ch = s.querySelector('.challenge');
  const sh = s.querySelector('.shuffle-row');
  return {
    open: !document.getElementById('newWrap').hidden,
    stepper: !!s.querySelector('.stepper'),
    quick: s.querySelectorAll('#quickRow .qbtn').length,
    diff: s.querySelectorAll('#diffOpts .dbtn').length,
    limit: s.querySelectorAll('#limitOpts .lbtn').length,
    step: s.querySelectorAll('#stepOpts .lbtn').length,
    challengeSw: s.querySelectorAll('.challenge .switch').length,
    shuffleAfterChallenge: ch.getBoundingClientRect().bottom <= sh.getBoundingClientRect().top + 1,
    share: !!s.querySelector('.share'),
    note: document.getElementById('newNote').textContent.trim()
  };
});
check('顶栏「新一局」打开的是换一局面板', ng.open);
check('尺寸 / 难度 / 挑战都在这一层',
  ng.stepper && ng.quick >= 5 && ng.diff === 6 && ng.limit === 6 && ng.step === 5 && ng.challengeSw === 3,
  ng);
check('「换一局」在挑战组的下面', ng.shuffleAfterChallenge === true);
check('换一局面板里没有分享', ng.share === false);
check('顶部标出当前这局', /当前这局/.test(ng.note), ng.note);
await sleep(450);
await page.screenshot({ path: `${OUT}/misc-newgame.png` });
await page.evaluate(() => document.getElementById('btnCloseNew').click());
await sleep(260);

// ---------- 2b. 分享只剩「说明 + 复制」：没有代码框，也没有输入 ----------
const shareUi = await page.evaluate(() => {
  document.getElementById('btnHud').click();
  const sh = document.getElementById('diffSheet');
  const sb = sh.getBoundingClientRect();
  const share = sh.querySelector('.share');
  const sr = share.getBoundingClientRect();
  return {
    open: !document.getElementById('diffWrap').hidden,
    inSheet: !!share,
    /* 整块都在首屏里（它就在读数卡片正下方，不用滑） */
    inViewport: sr.top >= sb.top && sr.bottom <= sb.bottom,
    fields: sh.querySelectorAll('textarea, input, [contenteditable]').length,
    codeBox: !!document.getElementById('shareCode'),
    /* 难度那五行的问号也是 button（.ds-help），这里只看「有 id 的」那几颗 */
    btns: Array.from(sh.querySelectorAll('button:not(.ds-help)')).map(b => b.id),
    copy: (() => {
      const b = document.getElementById('btnCopyCode');
      const r = b.getBoundingClientRect();
      const hd = sh.querySelector('.share-head').getBoundingClientRect();
      return {
        icon: !!b.querySelector('svg'),
        w: Math.round(r.width),
        inHead: r.top >= hd.top - 1 && r.bottom <= hd.bottom + 1
      };
    })(),
    oldTag: !!document.querySelector('.share-tag'),
    oldBtns: !!sh.querySelector('.share-btns'),
    footBtns: sh.querySelectorAll('.sheet-done, .info-setup').length,
    /* 复制出来的就是这一局的码（现算，不靠页面上的框） */
    code: __QUEENS_DEBUG__.encode()
  };
});
check('分享在本局信息页里，且整块不用滑就看得到',
  shareUi.open && shareUi.inSheet && shareUi.inViewport === true);
check('信息页里没有代码框、也没有任何输入框',
  shareUi.codeBox === false && shareUi.fields === 0, `box=${shareUi.codeBox} fields=${shareUi.fields}`);
check('信息页只剩 X 与复制两颗按钮',
  shareUi.btns.length === 2 && shareUi.btns.indexOf('btnCopyCode') >= 0 &&
  shareUi.btns.indexOf('btnCloseDiff') >= 0, shareUi.btns.join(','));
check('复制图标住在分享头的右边',
  shareUi.copy.icon && shareUi.copy.inHead && shareUi.copy.w >= 27, shareUi.copy);
check('尺寸小标签、两个文字按钮、页脚两颗按钮都已去掉',
  shareUi.oldTag === false && shareUi.oldBtns === false && shareUi.footBtns === 0,
  `tag=${shareUi.oldTag} btns=${shareUi.oldBtns} foot=${shareUi.footBtns}`);
check('复制用的码是这一局现算出来的', /^QNS1-\d\d-/.test(shareUi.code), shareUi.code.slice(0, 12));
await page.screenshot({ path: `${OUT}/misc-share.png` });
await page.evaluate(() => document.getElementById('btnCloseDiff').click());
await sleep(260);

// ---------- 3. 拖动：对齐 / 随意 + 每格震动 ----------
async function dragInBoard(dxCells, dyCells, alignDrag) {
  await page.evaluate((align) => {
    __QUEENS_DEBUG__.settings.alignDrag = align;
    __QUEENS_DEBUG__.clear();
    window.__vib.length = 0;
  }, alignDrag);
  await sleep(120);
  const geo = await page.evaluate(() => {
    const g = document.getElementById('grid').getBoundingClientRect();
    return { x: g.x, y: g.y, w: g.width, n: __QUEENS_DEBUG__.state.size };
  });
  const step = geo.w / geo.n;
  const sx = geo.x + step * 0.5;
  const sy = geo.y + step * 1.5;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + step * dxCells, sy + step * dyCells, { steps: 26 });
  await page.mouse.up();
  await sleep(180);
  return page.evaluate(() => {
    const n = __QUEENS_DEBUG__.state.size;
    const out = [];
    for (let i = 0; i < n * n; i++) if (__QUEENS_DEBUG__.state.marks[i] === 1) out.push(i);
    return { n, cols: out.map(i => i % n), rows: out.map(i => (i / n) | 0), vib: window.__vib.slice() };
  });
}

const aligned = await dragInBoard(4, 2, true);
check('对齐拖动只涂起始那一行',
  aligned.rows.length > 1 && aligned.rows.every(r => r === 1),
  `rows=${[...new Set(aligned.rows)].join(',')} cols=${aligned.cols.join(',')}`);
check('对齐拖动每格都有震动', aligned.vib.length >= aligned.cols.length,
  `vib=${aligned.vib.length} cells=${aligned.cols.length} sample=${JSON.stringify(aligned.vib.slice(0, 3))}`);

const free = await dragInBoard(4, 2, false);
check('关掉对齐后可以斜着涂',
  free.rows.length > 1 && new Set(free.rows).size > 1,
  `rows=${[...new Set(free.rows)].join(',')}`);

// ---------- 4. 唯一位置提示的视觉强度 ----------
const forced = await page.evaluate(() => {
  __QUEENS_DEBUG__.settings.alignDrag = true;
  __QUEENS_DEBUG__.settings.autoMark = true;
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = Array.from(d.state.solution, (c, r) => r * n + c);
  d.state.marks.fill(0);
  for (let r = 0; r < n - 1; r++) d.state.marks[sol[r]] = 2;
  d.render(false);
  const el = document.querySelector('.cell.is-forced');
  if (!el) return null;
  const cs = getComputedStyle(el, '::before');
  const af = getComputedStyle(el, '::after');
  return { name: cs.animationName, dur: cs.animationDuration, after: af.content, box: af.boxShadow };
});
check('唯一位置提示还在呼吸', !!forced && forced.name === 'forcedGlow', JSON.stringify(forced));
check('提示只加光、不加描边', !!forced && forced.after === 'none' && forced.box === 'none',
  forced ? `${forced.after} / ${forced.box}` : '');
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = '.cell.is-forced::before{animation-play-state:paused!important;animation-delay:-1.4s!important}';
  document.head.appendChild(s);
});
await sleep(150);
const box = await page.evaluate(() => {
  const el = document.querySelector('.cell.is-forced');
  const r = el.getBoundingClientRect();
  return { x: r.x - r.width * 1.2, y: r.y - r.width * 1.2, width: r.width * 3.4, height: r.width * 3.4 };
});
await page.screenshot({ path: `${OUT}/misc-forced-peak.png`, captureBeyondViewport: false, clip: box });

// ---------- 5. 通关后的「重来这局」 ----------
const beforeWin = await page.evaluate(() => ({ seed: __QUEENS_DEBUG__.state.seed, n: __QUEENS_DEBUG__.state.size }));
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = Array.from(d.state.solution, (c, r) => r * n + c);
  d.state.marks.fill(0);
  for (let r = 0; r < n - 1; r++) d.state.marks[sol[r]] = 2;
  d.render(false);
  d.state.status = 'playing';
});
const last = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = Array.from(d.state.solution, (c, r) => r * n + c);
  const el = document.querySelector('.cell[data-i="' + sol[n - 1] + '"]');
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(last.x, last.y);
await sleep(80);
await page.mouse.click(last.x, last.y);
await sleep(1300);

const wonUI = await page.evaluate(() => {
  const r = document.getElementById('result');
  const rep = document.getElementById('btnReplay');
  return {
    status: __QUEENS_DEBUG__.state.status,
    open: !r.hidden,
    kind: r.dataset.kind,
    replayHidden: rep.hidden,
    replayText: rep.textContent.trim(),
    btnAgain: document.getElementById('btnAgain').textContent.trim()
  };
});
check('解开后弹出结果层', wonUI.status === 'won' && wonUI.open && wonUI.kind === 'won', JSON.stringify(wonUI));
check('结果层有「重来这局」', wonUI.replayHidden === false && wonUI.replayText === '重来这局');
await page.screenshot({ path: `${OUT}/misc-result-won.png` });

await page.evaluate(() => document.getElementById('btnReplay').click());
await sleep(700);
const replayed = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  let any = 0;
  for (let i = 0; i < d.state.marks.length; i++) if (d.state.marks[i]) any++;
  return {
    status: d.state.status, seed: d.state.seed, n: d.state.size,
    marks: any, elapsed: d.state.elapsed, resultHidden: document.getElementById('result').hidden
  };
});
check('重来这局：同一盘棋重新开始',
  replayed.status === 'playing' && replayed.resultHidden && replayed.marks === 0 &&
  replayed.seed === beforeWin.seed && replayed.n === beforeWin.n,
  JSON.stringify(replayed));

// ---------- 6. 输了那一屏不重复给「重来这局」 ----------
const lostUI = await page.evaluate(() => {
  __QUEENS_DEBUG__.state.limit = 1000;
  __QUEENS_DEBUG__.state.limitFrom = 0;
  __QUEENS_DEBUG__.state.elapsed = 5000;
  __QUEENS_DEBUG__.checkTimeout();
  return {
    open: !document.getElementById('result').hidden,
    replayHidden: document.getElementById('btnReplay').hidden,
    peek: document.getElementById('btnPeek').textContent.trim(),
    again: document.getElementById('btnAgain').textContent.trim()
  };
});
check('超时那屏仍只有两个按钮', lostUI.open && lostUI.replayHidden === true,
  `${lostUI.again} / ${lostUI.peek}`);

console.log(`\n${fails ? 'FAILURES: ' + fails : 'ALL PASS'}`);
await browser.close();
process.exit(fails ? 1 : 0);
