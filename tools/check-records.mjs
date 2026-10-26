// 皇后 Queens · 战绩 / 排行榜回归测试
// 用法: node tools/check-records.mjs [url]   （先起 python serve.py --no-open）
// 覆盖：记录写入、棋盘缩略图、分享码、复制、排行榜分组、超时记账、删除 / 清空、刷新后仍在
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
const log = (...a) => console.log(...a);
const errors = [];
let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures++;
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2']
});
await browser.defaultBrowserContext().overridePermissions(URL, ['clipboard-read', 'clipboard-write']);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const cellBox = async (i) => page.evaluate((i) => {
  const c = document.querySelector(`.cell[data-i="${i}"]`).getBoundingClientRect();
  return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
}, i);

const tap = async (i, { dbl = false, gap = 90 } = {}) => {
  const p = await cellBox(i);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await page.mouse.up();
  if (dbl) { await sleep(gap); await page.mouse.down(); await page.mouse.up(); }
  await sleep(180);
};

const solutionCells = () => page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  return Array.from(d.state.solution, (c, r) => r * n + c);
});

async function solve() {
  const cells = await solutionCells();
  for (const q of cells) await tap(q, { dbl: true });
  await sleep(1200);   // 胜利 → 礼花 → 结果层
}

async function closeResultIfAny() {
  await page.evaluate(() => {
    const r = document.getElementById('result');
    if (!r.hasAttribute('hidden')) {
      const b = document.getElementById('btnPeek');
      if (b) b.click();
    }
  });
  await sleep(320);
}

async function openRecords() {
  await page.evaluate(() => document.getElementById('btnRecords').click());
  await sleep(360);
}

async function openTab(which) {
  await page.evaluate((w) => document.getElementById(w === 'board' ? 'tabBoard' : 'tabRecs').click(), which);
  await sleep(200);
}

/* ---------- 0. 干净开局 ---------- */
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.evaluate(() => { localStorage.removeItem('queens.records.v1'); localStorage.removeItem('queens.game.v1'); });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(400);

let r = await page.evaluate(() => __QUEENS_DEBUG__.records());
check('初始没有战绩', r.length === 0, `n=${r.length}`);

await openRecords();
r = await page.evaluate(() => ({
  open: !document.getElementById('recWrap').hasAttribute('hidden'),
  rows: document.querySelectorAll('#recList .rec').length,
  empty: !document.getElementById('recEmpty').hasAttribute('hidden')
}));
check('空态面板能打开', r.open && r.rows === 0 && r.empty, JSON.stringify(r));
await page.evaluate(() => document.getElementById('btnCloseRec').click());
await sleep(200);

/* ---------- 1. 通关 → 写一条记录 ---------- */
await solve();
r = await page.evaluate(() => {
  const list = __QUEENS_DEBUG__.records();
  const res = document.getElementById('result');
  return {
    n: list.length,
    rec: list[0] || null,
    status: __QUEENS_DEBUG__.state.status,
    resultOpen: !res.hasAttribute('hidden'),
    sub: document.getElementById('resultSub').textContent.trim(),
    stored: JSON.parse(localStorage.getItem('queens.records.v1') || '[]').length
  };
});
check('解开后写入一条记录', r.n === 1 && r.stored === 1 && r.status === 'won', `n=${r.n}/${r.stored}`);
check('记录带棋盘与用时', !!r.rec && r.rec.n === 8 && r.rec.rg.length === 64 && r.rec.so.length === 8 && r.rec.ms >= 0,
  r.rec ? `ms=${r.rec.ms} lv=${r.rec.lv}` : 'no rec');
check('记录带难度与限时', !!r.rec && !!r.rec.lv && r.rec.lim === 0 && r.rec.won === true,
  r.rec ? `lv=${r.rec.lv} lim=${r.rec.lim}` : '');
check('结果层说「本组最快」', r.sub.includes('本组最快'), r.sub);

/* ---------- 2. 记录列表：缩略图 / 分享码 ---------- */
await closeResultIfAny();
await openRecords();
r = await page.evaluate(() => {
  const row = document.querySelector('#recList .rec');
  if (!row) return { rows: 0 };
  const img = row.querySelector('.rec-thumb img');
  const box = row.getBoundingClientRect();
  const sheet = document.getElementById('recSheet').getBoundingClientRect();
  return {
    rows: document.querySelectorAll('#recList .rec').length,
    imgSrc: img ? img.src.slice(0, 30) : '',
    imgOk: !!(img && img.complete !== false),
    time: row.querySelector('.rec-time').textContent.trim(),
    size: row.querySelector('.rec-size').textContent.trim(),
    lv: row.querySelector('.rec-lv').textContent.trim(),
    lvl: __QUEENS_DEBUG__.state.vibe.level,
    meta: row.querySelector('.rec-l2').textContent.trim(),
    expanded: row.querySelector('.rec-hit').getAttribute('aria-expanded'),
    inSheet: box.left >= sheet.left - 1 && box.right <= sheet.right + 1,
    overflow: document.documentElement.scrollHeight - window.innerHeight
  };
});
check('记录列表画出一条', r.rows === 1, `rows=${r.rows}`);
check('缩略图是内联 SVG', r.imgSrc.startsWith('data:image/svg+xml'), r.imgSrc);
check('记录行信息完整', /^\d\d:\d\d$/.test(r.time) && r.size === '8×8' && r.lv.includes(r.lvl),
  `${r.time} ${r.size} ${r.lv}`);
check('记录行小字含限时与日期', r.meta.includes('不限时') && r.meta.includes('步') && r.meta.includes('今天'), r.meta);
check('行不超出面板', r.inSheet && r.overflow <= 0, `overflow=${r.overflow}`);
check('默认收起', r.expanded === 'false');

/* ---- 2b. 战绩是全屏页：高度固定一屏，滚的是分页 ---- */
r = await page.evaluate(() => {
  const sheet = document.getElementById('recSheet').getBoundingClientRect();
  const head = document.getElementById('recTitle').getBoundingClientRect();
  const pane = document.getElementById('paneRecs');
  return {
    h: Math.round(sheet.height), vh: window.innerHeight, top: Math.round(sheet.top),
    headTop: Math.round(head.top),
    overflowY: getComputedStyle(pane).overflowY,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight
  };
});
check('战绩页铺满一屏', r.h === r.vh && r.top === 0 && r.pageOverflow <= 0, JSON.stringify(r));
check('列表自己滚（高度不跟内容走）', r.overflowY === 'auto', r.overflowY);

/* ---- 2c. 缩略图：同色块内部不能有分割线 ----
 * 逐条矩形核对「缝只留在和别的色块挨着的边上」：
 * 上下邻居同块就该贴到边（inset 0），不同块才留半条缝。 */
r = await page.evaluate(() => {
  const img = document.querySelector('#recList .rec-thumb img');
  const svg = decodeURIComponent(img.src.split(',')[1]);
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)];
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const rg = Array.from(d.state.regions);
  const at = (rr, cc) => (rr < 0 || rr >= n || cc < 0 || cc >= n ? -1 : rg[rr * n + cc]);
  const near = (a, b) => Math.abs(a - b) < 0.004;
  let rects = 0, bad = 0, sample = '';
  for (const [, dstr] of paths) {
    for (const m of dstr.matchAll(/M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)h-[-\d.]+z/g)) {
      const x = +m[1], y = +m[2], w = +m[3], h = +m[4];
      const r0 = Math.round(y), c0 = Math.round(x);
      const g = at(r0, c0);
      const c1 = Math.round(x + w);                 // 这一行的下一格（run 的右边界）
      const tGap = at(r0 - 1, c0) === g ? 0 : 0.06;
      const bGap = at(r0 + 1, c0) === g ? 0 : 0.06;
      const lGap = at(r0, c0 - 1) === g ? 0 : 0.06;
      const rGap = at(r0, c1) === g ? 0 : 0.06;
      rects++;
      const ok = near(x - c0, lGap) && near(y - r0, tGap) &&
        near(h, 1 - tGap - bGap) && near(w, c1 - c0 - lGap - rGap);
      if (!ok) { bad++; if (!sample) sample = `r${r0}c${c0} x=${x} y=${y} w=${w} h=${h}`; }
    }
  }
  return { paths: paths.length, rects, bad, sample, regions: new Set(rg).size };
});
check('一块色块一条路径', r.paths === r.regions, `paths=${r.paths} regions=${r.regions}`);
check('同色块内部没有缝（缝只留在色块之间）', r.rects > 0 && r.bad === 0, `rects=${r.rects} bad=${r.bad} ${r.sample}`);

await page.evaluate(() => document.querySelector('#recList .rec-hit').click());
await sleep(260);
r = await page.evaluate(() => ({
  code: (document.querySelector('#recList .rec-code') || {}).textContent || '',
  now: __QUEENS_DEBUG__.encode(),
  btns: document.querySelectorAll('#recList .rec-btns .rbtn').length,
  expanded: document.querySelector('#recList .rec-hit').getAttribute('aria-expanded')
}));
check('展开后露出分享码', r.expanded === 'true' && r.code.startsWith('QNS1-'), r.code.slice(0, 20));
check('分享码就是这一盘', r.code === r.now, `${r.code.slice(0, 12)} vs ${r.now.slice(0, 12)}`);
check('展开后四个动作', r.btns === 4, `btns=${r.btns}`);
await page.screenshot({ path: `${OUT}/records-list.png` });

/* ---------- 3. 复制代码 ---------- */
await page.evaluate(() => document.querySelector('#recList [data-act="copy"]').click());
await sleep(300);
r = await page.evaluate(async () => ({
  clip: await navigator.clipboard.readText().catch(() => ''),
  status: document.getElementById('recStatus').textContent.trim(),
  tone: document.getElementById('recStatus').dataset.tone
}));
check('复制到剪贴板', r.clip.startsWith('QNS1-'), r.clip.slice(0, 16));
check('复制有回执', r.status.includes('已复制') && r.tone === 'good', r.status);

/* ---------- 4. 排行榜：默认落在这一组 ---------- */
await openTab('board');
r = await page.evaluate(() => ({
  lims: document.querySelectorAll('#limChips .rchip').length,
  lvs: document.querySelectorAll('#lvChips .rchip').length,
  limOn: (document.querySelector('#limChips .rchip.is-on') || {}).textContent || '',
  lvOn: (document.querySelector('#lvChips .rchip.is-on') || {}).textContent || '',
  note: document.getElementById('boardNote').textContent.trim(),
  rows: document.querySelectorAll('#boardList .lb-row').length,
  rank: (document.querySelector('#boardList .lb-rank') || {}).textContent || '',
  time: (document.querySelector('#boardList .lb-time') || {}).textContent || '',
  lvl: __QUEENS_DEBUG__.state.vibe.level,
  medal: (document.querySelector('#boardList .lb-row') || {}).dataset ? document.querySelector('#boardList .lb-row').dataset.medal : ''
}));
check('限时 6 挡 + 难度 5 挡', r.lims === 6 && r.lvs === 5, `lim=${r.lims} lv=${r.lvs}`);
/* 8×8 在 v2 刻度下大多数是中等，但也有少量容易/困难 —— 所以「默认落在哪一档」
 * 跟着这一局的真实档位走，别写死「中等」。 */
check('默认落在这局自己的「限时 + 难度」组',
  r.limOn.startsWith('不限') && r.lvOn.replace(/[0-9]+$/, '') === r.lvl,
  `${r.limOn} / ${r.lvOn} / 本局=${r.lvl}`);
check('榜单里有这一局', r.rows === 1 && r.rank === '1' && /^\d\d:\d\d$/.test(r.time), `${r.rows} ${r.rank} ${r.time}`);
check('第一名挂金牌', r.medal === '1', `medal=${r.medal}`);
check('分组说明写清楚', r.note.includes('不限时') && r.note.includes(r.lvl) && r.note.includes('最快'), r.note);
await page.screenshot({ path: `${OUT}/records-board.png` });

/* ---------- 5. 换一组筛选 → 空 ---------- */
await page.evaluate(() => document.querySelector('#limChips [data-lim="180000"]').click());
await sleep(240);
r = await page.evaluate(() => ({
  rows: document.querySelectorAll('#boardList .lb-row').length,
  empty: !document.getElementById('boardEmpty').hasAttribute('hidden'),
  note: document.getElementById('boardNote').textContent.trim()
}));
check('3 分钟组是空的', r.rows === 0 && r.empty, `rows=${r.rows}`);
check('空组说明带限时', r.note.includes('3 分钟'), r.note);

/* ---------- 6. 刷新后仍在 ---------- */
await page.evaluate(() => document.getElementById('btnCloseRec').click());
await sleep(200);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(400);
r = await page.evaluate(() => __QUEENS_DEBUG__.records().length);
check('刷新后记录还在', r === 1, `n=${r}`);
await closeResultIfAny();

/* ---------- 7. 换一盘限时 5 分钟 → 另一个组 ---------- */
await page.evaluate(() => document.getElementById('btnNew').click());
await sleep(320);
await page.evaluate(() => document.querySelector('#limitOpts [data-limit="300000"]').click());
await page.evaluate(() => document.getElementById('btnShuffle').click());
await sleep(1400);
await solve();
r = await page.evaluate(() => ({
  n: __QUEENS_DEBUG__.records().length,
  lim: __QUEENS_DEBUG__.records()[0].lim,
  sub: document.getElementById('resultSub').textContent.trim()
}));
check('第二局记成另一组', r.n === 2 && r.lim === 300000, `n=${r.n} lim=${r.lim}`);
check('结果层按组排名', r.sub.includes('本组最快') || r.sub.includes('本组第'), r.sub);

await closeResultIfAny();
await openRecords();
await openTab('board');
r = await page.evaluate(() => {
  /* 两局的档位不一定相同（8×8 偶尔会落在容易/困难），所以按限时把四个难度加起来数 */
  const tones = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  const count = (ms) => {
    document.querySelector('#limChips [data-lim="' + ms + '"]').click();
    let total = 0;
    for (const t of tones) {
      document.querySelector('#lvChips [data-lv="' + t + '"]').click();
      total += document.querySelectorAll('#boardList .lb-row').length;
    }
    return total;
  };
  const a = count(0), b = count(300000), c = count(180000);
  // 角标跟着当前选中的难度算：切回这局 5 分钟那盘的档位再读
  const recLv = __QUEENS_DEBUG__.records()[0].lv;
  document.querySelector('#lvChips [data-lv="' + recLv + '"]').click();
  document.querySelector('#limChips [data-lim="300000"]').click();
  const n5 = document.querySelector('#limChips [data-lim="300000"]').textContent.trim();
  return { a, b, c, n5 };
});
check('不同限时分开统计', r.a === 1 && r.b === 1 && r.c === 0, `不限=${r.a} 5分=${r.b} 3分=${r.c}`);
check('5 分钟组的角标是 1（当前难度下）', r.n5.endsWith('1'), r.n5);

/* ---------- 8. 超时那局：记下来但不进榜 ---------- */
await page.evaluate(() => document.getElementById('btnCloseRec').click());
await sleep(200);
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.limit = 60000;
  d.state.elapsed = 61000;
  d.state.runningSince = 0;
  d.state.status = 'playing';
  d.checkTimeout();
});
await sleep(400);
r = await page.evaluate(() => {
  const list = __QUEENS_DEBUG__.records();
  return { n: list.length, won: list[0].won, ms: list[0].ms, lim: list[0].lim, status: __QUEENS_DEBUG__.state.status };
});
check('超时也记一局', r.n === 3 && r.won === false && r.status === 'lost', JSON.stringify(r));

await closeResultIfAny();
await openRecords();
await openTab('list');
r = await page.evaluate(() => ({
  rows: document.querySelectorAll('#recList .rec').length,
  lost: document.querySelectorAll('#recList .rec[data-won="0"]').length,
  badge: document.querySelector('#recList .rec-lost').textContent.trim()
}));
check('记录列表标出未完成', r.rows === 3 && r.lost === 1 && r.badge === '未完成', `rows=${r.rows} lost=${r.lost}`);

await openTab('board');
r = await page.evaluate(() => {
  const tones = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  document.querySelector('#limChips [data-lim="0"]').click();
  let total = 0;
  for (const t of tones) {
    document.querySelector('#lvChips [data-lv="' + t + '"]').click();
    total += document.querySelectorAll('#boardList .lb-row').length;
  }
  return { a: total, records: __QUEENS_DEBUG__.records().length };
});
check('输掉的局不进榜', r.a === 1 && r.records === 3, `不限时全部难度=${r.a} 记录=${r.records}`);
await openTab('list');

/* ---------- 9. 删除一条（两步确认） ---------- */
await page.evaluate(() => {
  const row = document.querySelector('#recList .rec');
  row.querySelector('.rec-hit').click();
});
await sleep(240);
r = await page.evaluate(() => {
  const btn = document.querySelector('#recList [data-act="del"]');
  btn.click();
  return { armed: btn.dataset.armed, text: btn.textContent.trim(), n: __QUEENS_DEBUG__.records().length };
});
check('删除要两步', r.armed === '1' && r.text === '再点一次' && r.n === 3, JSON.stringify(r));
await page.evaluate(() => document.querySelector('#recList [data-act="del"]').click());
await sleep(260);
r = await page.evaluate(() => ({
  n: __QUEENS_DEBUG__.records().length,
  rows: document.querySelectorAll('#recList .rec').length,
  stored: JSON.parse(localStorage.getItem('queens.records.v1') || '[]').length
}));
check('确认后删掉一条', r.n === 2 && r.rows === 2 && r.stored === 2, JSON.stringify(r));

/* ---------- 10. 清空全部 ---------- */
r = await page.evaluate(() => {
  const btn = document.getElementById('btnClearRecs');
  btn.click();
  return { armed: btn.dataset.armed, text: btn.textContent.trim() };
});
check('清空要两步', r.armed === '1' && r.text.includes('全部清空'), JSON.stringify(r));
await page.evaluate(() => document.getElementById('btnClearRecs').click());
await sleep(280);
r = await page.evaluate(() => ({
  n: __QUEENS_DEBUG__.records().length,
  rows: document.querySelectorAll('#recList .rec').length,
  empty: !document.getElementById('recEmpty').hasAttribute('hidden'),
  stored: localStorage.getItem('queens.records.v1'),
  clearHidden: document.getElementById('btnClearRecs').hasAttribute('hidden')
}));
check('清空后回到空态', r.n === 0 && r.rows === 0 && r.empty && r.clearHidden, JSON.stringify(r));
check('存盘也清空', r.stored === '[]', String(r.stored));

/* ---------- 11. Esc 关闭 + 不拦截键盘 ---------- */
await page.keyboard.press('Escape');
await sleep(240);
r = await page.evaluate(() => ({
  closed: document.getElementById('recWrap').hasAttribute('hidden'),
  inert: document.getElementById('app').inert === true
}));
check('Esc 关面板并解除 inert', r.closed && !r.inert, JSON.stringify(r));

r = await page.evaluate(() => ({
  overflow: document.documentElement.scrollHeight - window.innerHeight,
  topbar: document.getElementById('btnRecords').getBoundingClientRect().right <= window.innerWidth
}));
check('顶栏没被挤出去', r.topbar && r.overflow <= 0, JSON.stringify(r));

/* ---------- 12. 一批记录：分页 + 榜单排序 ---------- */
// 造 25 条：难度按 easy→极难五挡轮转、限时按 0/3/5 分钟轮转、每 7 条有一条未完成，
// 用时随序号递减（越靠后越快），这样排序对不对一眼就能看出来。
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const hex = (v) => '0123456789ABCDEF'[v];
  const rg = Array.from(d.state.regions).map(hex).join('');
  const so = Array.from(d.state.solution).map(hex).join('');
  const lvs = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  const lims = [0, 180000, 300000];
  const out = [];
  for (let i = 0; i < 25; i++) {
    out.push({
      v: 1, id: 'seed' + i, at: Date.now() - i * 86400000, n: n, sd: 1, rg: rg, so: so,
      lv: lvs[i % 5], sc: 3 + (i % 7), sq: 3, lim: lims[i % 3], ms: 200000 - i * 3000,
      h: i % 3, mv: 20 + i, won: i % 7 !== 3, nh: false, nu: false
    });
  }
  localStorage.setItem('queens.records.v1', JSON.stringify(out));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(400);
await closeResultIfAny();
await openRecords();

r = await page.evaluate(() => ({
  n: __QUEENS_DEBUG__.records().length,
  rows: document.querySelectorAll('#recList .rec').length,
  more: document.getElementById('btnMoreRecs').textContent.trim(),
  moreHidden: document.getElementById('btnMoreRecs').hasAttribute('hidden'),
  total: document.getElementById('recTotal').textContent.trim()
}));
check('25 条只先画 20 条', r.n === 25 && r.rows === 20 && !r.moreHidden, `rows=${r.rows} n=${r.n}`);
check('「显示更多」报剩余数', r.more.includes('还有 5 局'), r.more);
check('标签页上有总数', r.total === '25', r.total);

await page.evaluate(() => document.getElementById('btnMoreRecs').click());
await sleep(260);
r = await page.evaluate(() => ({
  rows: document.querySelectorAll('#recList .rec').length,
  moreHidden: document.getElementById('btnMoreRecs').hasAttribute('hidden')
}));
check('显示更多后 25 条全在', r.rows === 25 && r.moreHidden, `rows=${r.rows}`);

/* 25 条撑满一屏：滚的是分页，头与标签钉着不动 */
r = await page.evaluate(() => {
  const top = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top);
  const pane = document.getElementById('paneRecs');
  const before = { head: top('recTitle'), tabs: top('tabRecs') };
  pane.scrollTop = 300;
  return new Promise((res) => setTimeout(() => res({
    before,
    after: { head: top('recTitle'), tabs: top('tabRecs') },
    scrolled: pane.scrollTop,
    sheetH: Math.round(document.getElementById('recSheet').getBoundingClientRect().height),
    vh: window.innerHeight
  }), 120));
});
check('分页能滚，头与标签钉住',
  r.scrolled > 0 && r.after.head === r.before.head && r.after.tabs === r.before.tabs,
  JSON.stringify(r));

await openTab('board');
r = await page.evaluate(() => ({
  h: Math.round(document.getElementById('recSheet').getBoundingClientRect().height),
  vh: window.innerHeight,
  paneTop: Math.round(document.getElementById('paneBoard').getBoundingClientRect().top)
}));
check('换成排行榜，面板高度不动', r.h === r.vh, JSON.stringify(r));

await openTab('board');
// 显式选「不限时」：打开面板时默认跟着当前这局的限时走，不一定是 0
await page.evaluate(() => document.querySelector('#limChips [data-lim="0"]').click());
await page.evaluate(() => document.querySelector('#lvChips [data-lv="easy"]').click());
await sleep(220);
r = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#boardList .lb-row')];
  return {
    n: rows.length,
    times: rows.map(x => x.querySelector('.lb-time').textContent.trim()),
    ranks: rows.map(x => x.querySelector('.lb-rank').textContent.trim()),
    medals: rows.map(x => x.dataset.medal),
    chip: document.querySelector('#limChips [data-lim="0"]').textContent.trim()
  };
});
// 不限时 + 容易：种子数据里 i=0 / i=15 两条，用时 200000-0 / 200000-45000
check('按要求分组（不限时 + 容易 2 条）', r.n === 2, `n=${r.n} ${r.times.join(',')}`);
check('按用时从快到慢', r.times[0] === '02:35' && r.times[1] === '03:20', r.times.join(' > '));
check('名次与奖牌', r.ranks.join(',') === '1,2' && r.medals.join(',') === '1,2', `${r.ranks} ${r.medals}`);
check('限时角标跟着换难度重算', r.chip.endsWith('2'), r.chip);
await page.screenshot({ path: `${OUT}/records-board-many.png` });

/* ---------- 13. 旧刻度的记录：留在列表里，但不进排行榜 ---------- */
// 刻度换成 v3 之后，老记录的 lv / sc 是按旧尺子量的（14×14 那时算极难、分数截在 9.9），
// 不能和新成绩放一张榜上比。老记录没有 sq 字段，正好用来验证这一点。
await page.evaluate(() => {
  const arr = JSON.parse(localStorage.getItem('queens.records.v1') || '[]');
  if (!arr.length) return;
  const old = JSON.parse(JSON.stringify(arr[12]));
  old.id = 'legacy1';
  old.at = Date.now();
  old.ms = 1000;        // 快得离谱：要是进了榜，第一名就会是它
  delete old.sq;
  arr.unshift(old);
  localStorage.setItem('queens.records.v1', JSON.stringify(arr));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(400);
await closeResultIfAny();
await openRecords();
r = await page.evaluate(() => {
  const row = document.querySelector('#recList .rec');
  return {
    id: row && row.dataset.id,
    tag: !!(row && row.querySelector('.rec-old')),
    text: row ? row.querySelector('.rec-lv').textContent.trim() : ''
  };
});
check('旧刻度记录留在列表里并挂「旧刻度」角标',
  r.id === 'legacy1' && r.tag && /旧刻度/.test(r.text), JSON.stringify(r));
await openTab('board');
await page.evaluate(() => document.querySelector('#limChips [data-lim="0"]').click());
await page.evaluate(() => document.querySelector('#lvChips [data-lv="easy"]').click());
await sleep(240);
r = await page.evaluate(() => ({
  n: document.querySelectorAll('#boardList .lb-row').length,
  times: [...document.querySelectorAll('#boardList .lb-time')].map(x => x.textContent.trim())
}));
check('旧刻度记录不进排行榜', r.n === 2 && r.times.indexOf('00:01') < 0,
  JSON.stringify(r));

/* ---------- 14. 小屏不挤 ---------- */
await page.setViewport({ width: 340, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(320);
await openTab('list');
r = await page.evaluate(() => {
  const sheet = document.getElementById('recSheet').getBoundingClientRect();
  const row = document.querySelector('#recList .rec').getBoundingClientRect();
  return {
    fits: row.left >= sheet.left - 1 && row.right <= sheet.right + 1,
    overflow: document.documentElement.scrollHeight - window.innerHeight,
    btns: document.querySelectorAll('#recList .rec-btns .rbtn').length
  };
});
check('340px 下记录行不溢出', r.fits && r.overflow <= 0, JSON.stringify(r));
await page.screenshot({ path: `${OUT}/records-narrow.png` });
await page.evaluate(() => document.getElementById('btnCloseRec').click());
await sleep(200);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/* ---------- 15. 没有页面报错 ---------- */
check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
