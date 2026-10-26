// 皇后 Queens · 端到端回归测试
// 用法: NODE_PATH=... node tools/e2e.mjs [url]
// 配套: node tools/check-diffpick.mjs（目标难度出题 / 尺寸锁定 / 加载遮罩，45 项）
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

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', r => errors.push('reqfail: ' + r.url() + ' ' + r.failure()?.errorText));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(600);

// ---------- 1. 首屏 ----------
const boot = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  return {
    size: d.state.size,
    cells: document.querySelectorAll('.cell').length,
    queens: d.state.solution,
    unique: (() => {
      const areas = {}; d.state.regions.forEach(g => areas[g] = (areas[g] || 0) + 1);
      return Object.keys(areas).length;
    })(),
    engineLoaded: typeof window.QueensEngine === 'object',
    sizePill: document.getElementById('hudSize').textContent.trim(),
    queenPill: document.getElementById('queenPill').textContent.trim(),
    chips: document.querySelectorAll('#regions .chip').length,
    // 色块粗边现在画在一张统一的 SVG 图层上（#rb），不再是逐格的 border
    borders: (() => { const p = document.querySelector('#rb path'); return p ? p.getTotalLength() : 0; })(),
    overflow: document.documentElement.scrollHeight - window.innerHeight
  };
});
check('默认 8×8', boot.size === 8 && boot.cells === 64, `cells=${boot.cells}`);
check('色块数 = 边长', boot.unique === 8, `regions=${boot.unique}`);
check('engine.js 已加载', boot.engineLoaded);
check('信息条棋盘段', boot.sizePill === '8×8', boot.sizePill);
check('信息条皇后段', boot.queenPill === '0/8', boot.queenPill);
check('色块条与描边', boot.chips === 8 && boot.borders > 100, `chips=${boot.chips} 描边长度=${Math.round(boot.borders)}px`);
check('无页面溢出', boot.overflow <= 0, `overflow=${boot.overflow}`);
await page.screenshot({ path: `${OUT}/01-boot.png` });

// ---------- 2. 单击 → × ----------
const cellBox = async (i) => {
  const el = await page.$(`.cell[data-i="${i}"]`);
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const tap = async (i, { dbl = false, gap = 90 } = {}) => {
  const p = await cellBox(i);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await page.mouse.up();
  if (dbl) { await sleep(gap); await page.mouse.down(); await page.mouse.up(); }
  await sleep(220);
};

// 自动打叉的开关只剩设置面板里一处（顶栏那颗按钮已换成「外观」），
// 所以就着这个面板来回切，顺手把「面板开着时棋盘不动」一并验了。
// 设置面板现在是一整列摊开的开关，没有折叠。
const setAutoMark = async (want) => {
  const open = await page.evaluate(() => !document.getElementById('sheetWrap').hidden);
  if (!open) { await page.click('#btnSettings'); await sleep(420); }
  const cur = await page.evaluate(() =>
    document.getElementById('swAuto').getAttribute('aria-checked') === 'true');
  if (cur !== want) { await page.click('#swAuto'); await sleep(300); }
  await page.click('#btnCloseSheet');
  await sleep(320);
};

await tap(0);
let s = await page.evaluate(() => ({ mark: __QUEENS_DEBUG__.state.marks[0], cls: document.querySelector('.cell[data-i="0"]').className }));
check('单击标记 ×', s.mark === 1, `mark=${s.mark} cls=${s.cls}`);
await sleep(420);
await tap(0);
s = await page.evaluate(() => __QUEENS_DEBUG__.state.marks[0]);
check('再次单击清空', s === 0, `mark=${s}`);
await sleep(420);

// ---------- 3. 双击 → 皇后 + 自动 × ----------
const sol = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  return Array.from(d.state.solution, (c, r) => r * n + c);
});
const q0 = sol[0];
await tap(q0, { dbl: true });
const afterQueen = await page.evaluate((q0) => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const r = (q0 / n) | 0, c = q0 % n;
  const exp = new Set();
  for (let k = 0; k < n; k++) { if (k !== c) exp.add(r * n + k); if (k !== r) exp.add(k * n + c); }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) exp.add(rr * n + cc);
  }
  const g0 = d.state.regions[q0];
  for (let i = 0; i < n * n; i++) if (d.state.regions[i] === g0) exp.add(i);  // 同色块整块打叉
  exp.delete(q0);
  d.state.marks.forEach((m, i) => { if (m === 2) exp.delete(i); });
  const act = [...document.querySelectorAll('.cell')].map((el, i) => el.classList.contains('is-auto') ? i : -1).filter(i => i >= 0);
  return {
    mark: d.state.marks[q0],
    autoCount: act.length,
    autoExact: act.length === exp.size && [...exp].every(i => act.includes(i)),
    piece: !!document.querySelector(`.cell[data-i="${q0}"] .piece`),
    queenPill: document.getElementById('queenPill').textContent.trim(),
    hint: document.getElementById('hint').textContent.trim()
  };
}, q0);
check('双击落皇后', afterQueen.mark === 2 && afterQueen.piece, `mark=${afterQueen.mark}`);
check('自动 × 与理论集合一致', afterQueen.autoExact, `auto=${afterQueen.autoCount}`);
check('皇后计数更新', afterQueen.queenPill === '1/8', afterQueen.queenPill);
await page.screenshot({ path: `${OUT}/02-queen-auto.png` });

// ---------- 4. 自动 × 不可手改 ----------
const autoIdx = await page.evaluate(() => [...document.querySelectorAll('.cell')].findIndex(el => el.classList.contains('is-auto')));
await tap(autoIdx);
await sleep(120);
const autoLock = await page.evaluate((i) => ({
  mark: __QUEENS_DEBUG__.state.marks[i],
  stillAuto: document.querySelector(`.cell[data-i="${i}"]`).classList.contains('is-auto'),
  hint: document.getElementById('hint').textContent.trim()
}), autoIdx);
check('自动 × 点不出手标', autoLock.mark === 0 && autoLock.stillAuto, `mark=${autoLock.mark} auto=${autoLock.stillAuto}`);
check('提示解释了不能改', /自动/.test(autoLock.hint), autoLock.hint);
await sleep(420);

// ---------- 4b. 自动打叉（设置面板里的开关）+ 自动/手动 × 同款 ----------
// 顶栏那颗按钮换成了「外观」，自动打叉只剩设置面板里这一个入口
const freeIdx = await page.evaluate(() => [...document.querySelectorAll('.cell')]
  .findIndex(el => !el.classList.contains('is-auto') && !el.classList.contains('is-q')));
await tap(freeIdx);
// 等淡化的 0.5 秒防抖 + 过渡走完：自动 × 早就淡着了，手标这一格得等它跟上，
// 否则比的是「淡化状态」而不是「样式」
await sleep(900);
const parity = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel + ' .mark i');
    if (!el) return null;
    const cs = getComputedStyle(el);
    // 只比影响视觉的几项：带色块边框的格子内框窄 2px，left 会有 1px 偏移，不算样式差异
    return [cs.backgroundColor, cs.width, cs.height, cs.borderRadius].join('|');
  };
  const wrap = (sel) => {
    const el = document.querySelector(sel + ' .mark');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return [cs.opacity, cs.transform].join('|');
  };
  const a = pick('.cell.is-auto'), m = pick('.cell.is-x');
  const wa = wrap('.cell.is-auto'), wm = wrap('.cell.is-x');
  return { a, m, wa, wm, same: !!a && a === m && wa === wm };
});
check('自动 × 与手动 × 样式一致', parity.same, `auto=${parity.a} manual=${parity.m}`);

check('顶栏不再有自动打叉按钮（换成外观）', await page.evaluate(() =>
  !document.getElementById('btnAuto') && !!document.getElementById('btnLook')));

await page.click('#btnSettings');
await sleep(420);
await page.click('#swAuto');
await sleep(300);
const autoOff = await page.evaluate(() => ({
  on: __QUEENS_DEBUG__.settings.autoMark,
  cells: document.querySelectorAll('.cell.is-auto').length,
  checked: document.getElementById('swAuto').getAttribute('aria-checked')
}));
check('设置里可关闭自动打叉', autoOff.on === false && autoOff.cells === 0 && autoOff.checked === 'false',
  `on=${autoOff.on} cells=${autoOff.cells}`);

await page.click('#swAuto');
await sleep(300);
const autoOn = await page.evaluate(() => ({
  on: __QUEENS_DEBUG__.settings.autoMark,
  cells: document.querySelectorAll('.cell.is-auto').length,
  checked: document.getElementById('swAuto').getAttribute('aria-checked'),
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').autoMark
}));
check('再点一次恢复自动打叉', autoOn.on === true && autoOn.cells > 0 && autoOn.checked === 'true',
  `cells=${autoOn.cells} saved=${autoOn.saved}`);
await page.click('#btnCloseSheet');
await sleep(320);
// 细线：每格都带 inset 阴影，最右列/最下行不重复补线
const grid = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.cell')];
  const shadow = (el) => getComputedStyle(el).boxShadow;
  const mid = all[0];
  const corner = all[all.length - 1];
  const rightEdge = all[all.length - 2];
  return {
    mid: shadow(mid), corner: shadow(corner), rightEdge: shadow(rightEdge),
    hasHair: shadow(mid).includes('inset'),
    cornerNone: shadow(corner) === 'none'
  };
});
check('每格有细分隔线', grid.hasHair, grid.mid);
check('棋盘右下角不叠双线', grid.cornerNone, `corner=${grid.corner}`);

// ---------- 5. 冲突高亮 ----------
// 在同一行的另一列落第二只皇后 → 必然同行冲突
const nC = await page.evaluate(() => __QUEENS_DEBUG__.state.size);
const conflictCell = Math.floor(q0 / nC) * nC + ((q0 % nC) + 1) % nC;  // 同行另一列，必定冲突
await tap(conflictCell, { dbl: true });
const conf = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  return {
    count: d.state.conflicts.count,
    cells: d.state.conflicts.cells.size,
    rings: document.querySelectorAll('.cell.is-conflict').length,
    lines: document.querySelectorAll('#links line, #links path').length,
    hint: document.getElementById('hint').textContent.trim(),
    pill: document.getElementById('queenPill').className
  };
});
check('检测到冲突', conf.count >= 1, `pairs=${conf.count}`);
check('冲突格高亮', conf.rings >= 2, `rings=${conf.rings}`);
check('虚线连线出现', conf.lines >= 1, `lines=${conf.lines}`);
check('提示文案说明冲突', /同一行|同一列|同一个色块|冲突/.test(conf.hint), conf.hint);
await page.screenshot({ path: `${OUT}/03-conflict.png` });

// ---------- 6. 撤销 ----------
await page.click('#btnUndo');
await sleep(250);
s = await page.evaluate(() => ({ q: __QUEENS_DEBUG__.state.marks.filter(m => m === 2).length, conf: __QUEENS_DEBUG__.state.conflicts.count }));
check('撤销回到 1 只皇后', s.q === 1 && s.conf === 0, `q=${s.q} conf=${s.conf}`);

// ---------- 7. 提示（现在是分步引导，不再直接给答案） ----------
await page.click('#btnHint');
await sleep(400);
const hintState = await page.evaluate(() => ({
  hints: __QUEENS_DEBUG__.state.hints,
  open: __QUEENS_DEBUG__.guide().open,
  coach: document.getElementById('coachText').textContent.trim(),
  gl: document.getElementById('gl').childElementCount,
  tags: document.querySelectorAll('#glTags .gl-tag').length
}));
check('提示打开引导面板', hintState.open && hintState.hints >= 1, `open=${hintState.open} hints=${hintState.hints}`);
check('引导有文案和圈画', !!hintState.coach && hintState.gl >= 1,
  `text=${hintState.coach} shapes=${hintState.gl} tags=${hintState.tags}`);
await page.screenshot({ path: `${OUT}/04-hint.png` });
await page.click('#coachClose');
await sleep(250);
check('结束按钮收起引导', await page.evaluate(() => !__QUEENS_DEBUG__.guide().open &&
  document.getElementById('gl').childElementCount === 0));

// ---------- 8. 清空 ----------
await page.click('#btnClear');
await sleep(300);
s = await page.evaluate(() => __QUEENS_DEBUG__.state.marks.filter(m => m !== 0).length);
check('清空棋盘', s === 0, `left=${s}`);

// ---------- 8b. 拖动连涂 / 连擦（锁方向） ----------
const gb = await page.evaluate(() => {
  const r = document.getElementById('grid').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width };
});
const cs = gb.w / (await page.evaluate(() => __QUEENS_DEBUG__.state.size));
const pt = (r, c) => ({ x: gb.x + (c + 0.5) * cs, y: gb.y + (r + 0.5) * cs });
async function drag(from, to, steps = 6, holdCheck = false) {
  const a = pt(from[0], from[1]), b = pt(to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  let mid = null;
  if (holdCheck) mid = await page.evaluate(() => document.getElementById('grid').classList.contains('is-painting'));
  await page.mouse.up();
  await sleep(240);
  return mid;
}
const marksAt = () => page.evaluate(() => {
  const n = __QUEENS_DEBUG__.state.size;
  return [...__QUEENS_DEBUG__.state.marks]
    .map((m, i) => m === 1 ? { i, r: (i / n) | 0, c: i % n } : null)
    .filter(Boolean);
});
const show = (list) => list.map(o => o.r + ',' + o.c).join(' ');

const midPainting = await drag([3, 1], [3, 6], 6, true);
check('拖动时进入涂抹态', midPainting === true, `is-painting=${midPainting}`);
let mk = await marksAt();
check('横向拖涂连成 6 格', mk.length === 6, `marks=${mk.length}`);
check('横向只落在本行', mk.every(o => o.r === 3), show(mk));

await page.click('#btnUndo');
await sleep(280);
check('一次撤销回退整笔', (await marksAt()).length === 0, `marks=${(await marksAt()).length}`);

await drag([2, 2], [5, 6], 1);   // 斜着拖（横向分量更大）→ 应锁成第 2 行
mk = await marksAt();
check('斜拖被锁成同一行', mk.length === 5 && mk.every(o => o.r === 2 && o.c >= 2 && o.c <= 6), show(mk));

await page.click('#btnUndo');
await sleep(280);

await drag([0, 7], [7, 7], 8);   // 竖拖
mk = await marksAt();
check('竖向拖涂连成整列', mk.length === 8 && mk.every(o => o.c === 7), show(mk));

await drag([7, 7], [0, 7], 8);   // 从本列的 × 起手 → 沿同列擦除
check('同列反向拖擦干净', (await marksAt()).length === 0, `marks=${(await marksAt()).length}`);

// ---------- 8c. 唯一位置提示 ----------
const nF = await page.evaluate(() => __QUEENS_DEBUG__.state.size);
const solF = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  return Array.from(d.state.solution, (c, r) => r * n + c);
});
for (let r = 0; r < nF - 1; r++) await tap(solF[r], { dbl: true });
const forced = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const qs = [];
  for (let i = 0; i < n * n; i++) if (d.state.marks[i] === 2) qs.push(i);
  const rowQ = new Set(qs.map(i => (i / n) | 0));
  const colQ = new Set(qs.map(i => i % n));
  const regQ = new Set(qs.map(i => d.state.regions[i]));
  const legal = (i) => {
    if (d.state.marks[i] !== 0) return false;
    const r = (i / n) | 0, c = i % n;
    if (rowQ.has(r) || colQ.has(c)) return false;
    for (const q of qs) {
      const qr = (q / n) | 0, qc = q % n;
      if (Math.max(Math.abs(qr - r), Math.abs(qc - c)) <= 1) return false;
    }
    return true;
  };
  const want = [];
  const pushAll = (list) => { for (const i of list) if (!want.includes(i)) want.push(i); };
  // 色块 / 行 / 列 三种单位各自独立数一遍，取并集
  for (let g = 0; g < n; g++) {
    if (regQ.has(g)) continue;
    const only = [];
    for (let i = 0; i < n * n; i++) if (d.state.regions[i] === g && legal(i)) only.push(i);
    if (only.length === 1) pushAll(only);
  }
  for (let r = 0; r < n; r++) {
    const only = [];
    for (let c = 0; c < n; c++) { const i = r * n + c; if (legal(i)) only.push(i); }
    if (only.length === 1) pushAll(only);
  }
  for (let c = 0; c < n; c++) {
    const only = [];
    for (let r = 0; r < n; r++) { const i = r * n + c; if (legal(i)) only.push(i); }
    if (only.length === 1) pushAll(only);
  }
  const got = [...document.querySelectorAll('.cell.is-forced')].map(el => +el.dataset.i);
  const forcedEl = document.querySelector('.cell.is-forced');
  return {
    want: want.sort((a, b) => a - b),
    got: got.sort((a, b) => a - b),
    aria: forcedEl ? forcedEl.getAttribute('aria-label') : ''
  };
});
check('唯一位置判定与独立计算一致',
  JSON.stringify(forced.want) === JSON.stringify(forced.got),
  `want=${forced.want.join(',')} got=${forced.got.join(',')}`);
check('最后一格只剩唯一位置', forced.got.length === 1, `got=${forced.got.length}`);
check('唯一位置正好是正解', forced.got[0] === solF[nF - 1], `cell=${forced.got[0]} want=${solF[nF - 1]}`);
check('行 / 列 独存也能触发提示',
  /这一行/.test(forced.aria) && /这一列/.test(forced.aria), `aria=${forced.aria}`);

// 多种残局扫一遍：前 k 行放正解皇后，再撒一层固定的手标 ×，
// 逐盘比较页面标出来的 is-forced 与「独立按 色块 / 行 / 列 各数一遍取并集」的结果
const sweep = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const sol = Array.from(d.state.solution, (c, r) => r * n + c);
  const recompute = (marks) => {
    const qs = [];
    for (let i = 0; i < n * n; i++) if (marks[i] === 2) qs.push(i);
    const rowQ = new Set(qs.map(i => (i / n) | 0));
    const colQ = new Set(qs.map(i => i % n));
    const regQ = new Set(qs.map(i => d.state.regions[i]));
    const legal = (i) => {
      if (marks[i] !== 0) return false;
      const r = (i / n) | 0, c = i % n;
      if (rowQ.has(r) || colQ.has(c) || regQ.has(d.state.regions[i])) return false;
      for (const q of qs) {
        if (Math.max(Math.abs(((q / n) | 0) - r), Math.abs((q % n) - c)) <= 1) return false;
      }
      return true;
    };
    const out = new Set();
    const scan = (cells) => {
      const only = cells.filter(legal);
      if (only.length === 1) out.add(only[0]);
    };
    const all = [...Array(n * n).keys()];
    for (let g = 0; g < n; g++) scan(all.filter(i => d.state.regions[i] === g));
    for (let r = 0; r < n; r++) scan([...Array(n).keys()].map(c => r * n + c));
    for (let c = 0; c < n; c++) scan([...Array(n).keys()].map(r => r * n + c));
    return [...out].sort((a, b) => a - b);
  };
  const bad = [];
  let cases = 0;
  for (let k = 0; k <= n; k++) {
    const marks = new Uint8Array(n * n);
    for (let r = 0; r < k; r++) marks[sol[r]] = 2;
    for (let i = 0; i < n * n; i++) {
      if (marks[i] === 2) continue;
      if ((i * 7 + k * 13) % 11 === 0) marks[i] = 1;
    }
    d.state.marks.set(marks);
    d.render(false);
    const got = [...document.querySelectorAll('.cell.is-forced')].map(el => +el.dataset.i).sort((a, b) => a - b);
    const want = recompute(marks);
    cases++;
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ k, got, want });
  }
  // 复原成「只剩最后一格」的盘面，后面的用例还要接着用
  const back = new Uint8Array(n * n);
  for (let r = 0; r < n - 1; r++) back[sol[r]] = 2;
  d.state.marks.set(back);
  d.render(false);
  return { cases, bad: bad.slice(0, 3) };
});
check('多种残局下色块 / 行 / 列 判定一致', sweep.bad.length === 0,
  `cases=${sweep.cases} bad=${JSON.stringify(sweep.bad)}`);

// ---------- 8d. 提示只认「看得见的 ×」 ----------
// 关掉自动打叉后棋盘上一片空白，这时不该凭空指出唯一位置。
// 例外：出题偶尔会生成「只有一格」的色块，那一格本来就是唯一位置，
// 随机盘碰上它不算 bug —— 所以只要求「被点亮的那几格都落在单格色块里」。
await setAutoMark(false);
const noMark = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  const area = {};
  for (let i = 0; i < n * n; i++) area[d.state.regions[i]] = (area[d.state.regions[i]] || 0) + 1;
  const forced = [...document.querySelectorAll('.cell.is-forced')].map(e => +e.dataset.i);
  return {
    on: d.settings.autoMark,
    auto: document.querySelectorAll('.cell.is-auto').length,
    x: document.querySelectorAll('.cell.is-x').length,
    forced: forced.length,
    singleCell: forced.every(i => area[d.state.regions[i]] === 1)
  };
});
check('关自动打叉 + 无 × 时不出唯一位置提示（单格色块除外）',
  noMark.on === false && noMark.auto === 0 && noMark.x === 0 &&
  (noMark.forced === 0 || noMark.singleCell),
  `auto=${noMark.auto} x=${noMark.x} forced=${noMark.forced} 单格色块=${noMark.singleCell}`);

// 手动把最后一行除正解外全划掉 → 这时才该提示
const manualForced = await page.evaluate((want) => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  for (let c = 0; c < n; c++) {
    const i = (n - 1) * n + c;
    if (i !== want) d.state.marks[i] = 1;
  }
  d.render(false);
  const el = document.querySelector('.cell.is-forced');
  return {
    got: [...document.querySelectorAll('.cell.is-forced')].map(e => +e.dataset.i),
    aria: el ? el.getAttribute('aria-label') : ''
  };
}, solF[nF - 1]);
check('手标 × 划满后提示出现且指向正解',
  manualForced.got.length === 1 && manualForced.got[0] === solF[nF - 1],
  `got=${manualForced.got.join(',')} want=${solF[nF - 1]}`);

// 复原：清掉手标 ×、恢复自动打叉，回到「只剩最后一格」的盘面
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  for (let i = 0; i < d.state.marks.length; i++) if (d.state.marks[i] === 1) d.state.marks[i] = 0;
  d.render(false);
});
await setAutoMark(true);
const restored = await page.evaluate(() => ({
  on: __QUEENS_DEBUG__.settings.autoMark,
  forced: document.querySelectorAll('.cell.is-forced').length
}));
check('恢复自动打叉后提示回到 1 格', restored.on === true && restored.forced === 1,
  `on=${restored.on} forced=${restored.forced}`);

await page.click('#btnSettings');
await sleep(420);
await page.click('#swForced');
await sleep(260);
const forcedOff = await page.evaluate(() => ({
  on: __QUEENS_DEBUG__.settings.forced,
  cells: document.querySelectorAll('.cell.is-forced').length,
  aria: document.getElementById('swForced').getAttribute('aria-checked')
}));
check('可关闭唯一位置提示', forcedOff.on === false && forcedOff.cells === 0 && forcedOff.aria === 'false',
  `cells=${forcedOff.cells}`);

await page.click('#swForced');
await sleep(260);
const forcedOn = await page.evaluate(() => ({
  on: __QUEENS_DEBUG__.settings.forced,
  cells: document.querySelectorAll('.cell.is-forced').length,
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').forced
}));
check('再打开恢复提示', forcedOn.on === true && forcedOn.cells === 1 && forcedOn.saved === true,
  `cells=${forcedOn.cells} saved=${forcedOn.saved}`);
await page.click('#btnCloseSheet');
await sleep(420);

// ---------- 9. 完整解盘 → 胜利 ----------
const placed = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  return Array.from(d.state.solution, (c, r) => (d.state.marks[r * n + c] === 2 ? r : -1)).filter(r => r >= 0);
});
for (let r = 0; r < sol.length; r++) {
  if (placed.includes(r)) continue;
  await tap(sol[r], { dbl: true });
  await sleep(200);
}
await sleep(900);
const win = await page.evaluate(() => {
  const r = document.getElementById('result');
  return {
    hidden: r.hasAttribute('hidden'),
    title: document.getElementById('resultTitle').textContent.trim(),
    sub: document.getElementById('resultSub').textContent.trim(),
    stats: [...r.querySelectorAll('.result-stat b')].map(e => e.textContent.trim()),
    status: __QUEENS_DEBUG__.state.status,
    queens: __QUEENS_DEBUG__.state.marks.filter(m => m === 2).length
  };
});
check('解盘触发胜利', !win.hidden && win.status === 'won', `status=${win.status}`);
check('结果卡文案', win.title.length > 0 && win.sub.includes('8×8'), `${win.title} / ${win.sub}`);
check('结果卡统计三项', win.stats.length === 3, win.stats.join('|'));
await page.screenshot({ path: `${OUT}/05-win.png` });

// ---------- 10. 设置面板 / 换一局面板 ----------
await page.evaluate(() => document.getElementById('result').setAttribute('hidden', ''));
await page.click('#btnSettings');
await sleep(500);
const sheet = await page.evaluate(() => {
  const sh = document.getElementById('sheet');
  const r = sh.getBoundingClientRect();
  return {
    open: !document.getElementById('sheetWrap').hasAttribute('hidden'),
    inView: r.top >= 0 && r.bottom <= window.innerHeight + 1,
    sw: sh.querySelectorAll('.switch').length,
    more: !!document.getElementById('btnMoreOpts'),
    share: !!sh.querySelector('.share'),
    scrollable: sh.scrollHeight > sh.clientHeight + 4
  };
});
check('设置面板打开', sheet.open, `inView=${sheet.inView}`);
check('设置面板完整可见', sheet.inView);
// 八个偏好开关：自动打叉 / 拖动对齐 / 淡化 × / 淡化皇后 / 冲突 / 唯一位置 / 音效 / 震动。
// 挑战那两颗跟着「开一局新的」搬去了换一局面板，分享搬去了信息页。
check('设置面板只剩 8 个开关', sheet.sw === 8, `sw=${sheet.sw}`);
check('设置面板不再折叠、也没有分享', sheet.more === false && sheet.share === false);
check('设置面板一屏放得下', !sheet.scrollable);
await page.screenshot({ path: `${OUT}/06-settings.png` });

// 顶栏那颗「新一局」现在开的是一层浮层：尺寸 / 难度 / 挑战 / 换一局都在里面
await page.click('#btnCloseSheet');
await sleep(320);
await page.click('#btnNew');
await sleep(500);
const newUi = await page.evaluate(() => {
  const sh = document.getElementById('newSheet');
  const r = sh.getBoundingClientRect();
  return {
    open: !document.getElementById('newWrap').hidden,
    inView: r.top >= 0 && r.bottom <= window.innerHeight + 1,
    quick: sh.querySelectorAll('#quickRow button').length,
    sizeVal: document.getElementById('sizeVal').textContent.trim(),
    limit: sh.querySelectorAll('#limitOpts .lbtn').length,
    step: sh.querySelectorAll('#stepOpts .lbtn').length,
    shuffle: !!document.getElementById('btnShuffle'),
    share: !!sh.querySelector('.share')
  };
});
check('换一局面板从顶栏打开', newUi.open, `inView=${newUi.inView}`);
check('换一局面板完整可见', newUi.inView);
check('换一局面板有快捷尺寸', newUi.quick >= 5, `quick=${newUi.quick}`);
check('换一局面板带着挑战挡位', newUi.limit === 6 && newUi.step === 5, `${newUi.limit}/${newUi.step}`);
check('换一局面板底部是「换一局」且没有分享', newUi.shuffle && !newUi.share);
await page.screenshot({ path: `${OUT}/06b-newgame.png` });

// ---------- 11. 改尺寸到 12 ----------
// 新规则：改尺寸只写「待生效」，点「换一局」才真的开新盘
for (let k = 0; k < 4; k++) { await page.click('#sizePlus'); await sleep(60); }
s = await page.evaluate(() => ({
  val: document.getElementById('sizeVal').textContent.trim(),
  board: __QUEENS_DEBUG__.state.size,
  pending: document.getElementById('btnShuffle').classList.contains('is-pending')
}));
check('步进器 +4（只改待生效值）', s.val === '12' && s.board === 8 && s.pending === true,
  `val=${s.val} board=${s.board} pending=${s.pending}`);
await page.click('#btnShuffle');
await sleep(1600);
const n12 = await page.evaluate(() => ({
  size: __QUEENS_DEBUG__.state.size,
  cells: document.querySelectorAll('.cell').length,
  cell: getComputedStyle(document.getElementById('board')).getPropertyValue('--cell').trim(),
  overflow: document.documentElement.scrollHeight - window.innerHeight,
  saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').size
}));
check('12×12 生成完成', n12.size === 12 && n12.cells === 144, `cells=${n12.cells} cell=${n12.cell}`);
check('12×12 无溢出', n12.overflow <= 0, `overflow=${n12.overflow}`);
check('尺寸已持久化', n12.saved === 12, `saved=${n12.saved}`);
await page.screenshot({ path: `${OUT}/07-12x12.png` });

// ---------- 12. 刷新续玩 ----------
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  d.state.marks[d.state.solution[0]] = 2;
  d.render(false);
});
await sleep(400);
const before = await page.evaluate(() => ({ q: __QUEENS_DEBUG__.state.marks.filter(m => m === 2).length }));
await sleep(1200);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(800);
const after = await page.evaluate(() => ({
  q: __QUEENS_DEBUG__.state.marks.filter(m => m === 2).length,
  size: __QUEENS_DEBUG__.state.size,
  cells: document.querySelectorAll('.cell').length,
  time: document.getElementById('timeText').textContent.trim()
}));
check('刷新后续玩', after.q === before.q && after.size === 12 && after.cells === 144, `before=${before.q} after=${after.q} size=${after.size}`);
check('计时继续走', after.time !== '00:00', after.time);
await page.screenshot({ path: `${OUT}/08-resume.png` });

// ---------- 13. 小屏 16×16 ----------
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluate(() => __QUEENS_DEBUG__.newGame(16));
await sleep(2000);
const big = await page.evaluate(() => ({
  size: __QUEENS_DEBUG__.state.size,
  cells: document.querySelectorAll('.cell').length,
  cell: getComputedStyle(document.getElementById('board')).getPropertyValue('--cell').trim(),
  overflow: document.documentElement.scrollHeight - window.innerHeight,
  scrollW: document.documentElement.scrollWidth - window.innerWidth
}));
check('16×16 正常渲染', big.size === 16 && big.cells === 256, `cells=${big.cells} cell=${big.cell}`);
check('16×16 无溢出', big.overflow <= 0 && big.scrollW <= 0, `v=${big.overflow} h=${big.scrollW}`);
await page.screenshot({ path: `${OUT}/09-16x16.png` });

// ---------- 14. 分享棋盘（住在本局信息页里） ----------
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluate(() => __QUEENS_DEBUG__.newGame(8));
await sleep(900);
await page.click('#btnHud');
await sleep(420);

const share = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, n = d.state.size;
  /* 页面上已经没有代码框了：码是点复制那一刻现算的（share.js 的 currentShareCode）。
   * 这里用调试口暴露的 encode 算同一串，好核对复制出去的东西。 */
  const code = d.encode();   // 调试口不带参数：算的就是当前这盘
  const re = new RegExp('^QNS1-' + String(n).padStart(2, '0') + '-[0-9A-F]{' + n * n +
    '}-[0-9A-F]{' + n + '}-[0-9A-Z]{6}$');
  const back = d.decode(code);
  const btn = document.getElementById('btnCopyCode');
  const head = document.querySelector('#diffSheet .share-head').getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  return {
    code, len: code.length, want: 4 + 1 + 2 + 1 + n * n + 1 + n + 1 + 6,
    format: re.test(code),
    /* 「分享这一局」右边换成了复制图标钮：以前那个 8×8 小标签去掉了 */
    copyIcon: !!btn.querySelector('svg') && btn.classList.contains('icon-btn'),
    copyW: Math.round(r.width),
    copyFlush: Math.round(head.right - r.right),
    oldTag: !!document.querySelector('.share-tag'),
    oldBtns: !!document.querySelector('#diffSheet .share-btns'),
    codeBox: !!document.getElementById('shareCode'),
    /* 分享那一块只剩「说明 + 复制」：不再有输入框，也不该有别的按钮 */
    shareBtns: document.querySelectorAll('#diffSheet .share button').length,
    footBtns: { done: !!document.getElementById('btnDiffDone'), setup: !!document.getElementById('btnInfoSetup') },
    ok: back.ok,
    roundTrip: back.ok && back.size === n &&
      Array.from(back.regions).join() === Array.from(d.state.regions).join() &&
      Array.from(back.solution).join() === Array.from(d.state.solution).join()
  };
});
check('分享代码格式 QNS1-08-…', share.format && share.len === share.want, `len=${share.len} want=${share.want}`);
check('分享头右边是复制图标钮（尺寸标签已去掉）',
  share.copyIcon && share.oldTag === false && share.copyW >= 27 && share.copyFlush <= 2,
  `w=${share.copyW} flush=${share.copyFlush} tag=${share.oldTag}`);
check('信息页没有代码框，分享区只剩复制一颗按钮',
  share.codeBox === false && share.shareBtns === 1, `box=${share.codeBox} btns=${share.shareBtns}`);
check('底部「复制代码 / 载入代码」两个文字按钮都没了', share.oldBtns === false);
check('信息页底部不再挂「知道了」「改棋盘大小与难度」',
  !share.footBtns.done && !share.footBtns.setup, JSON.stringify(share.footBtns));
check('代码解码后与原盘完全一致', share.ok && share.roundTrip);

// 复制到剪贴板：没有框也要能把这一局的码拿出来
await page.browserContext().overridePermissions(URL, ['clipboard-read', 'clipboard-write']);
await page.click('#btnCopyCode');
await sleep(320);
const copied = await page.evaluate(async () => {
  let clip = '';
  try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'ERR'; }
  const st = document.getElementById('shareStatus');
  return { clip, text: st.textContent.trim(), good: st.classList.contains('is-good') };
});
check('复制按钮写入剪贴板', copied.clip === share.code, `clip=${copied.clip.slice(0, 14)}…`);
check('复制后有提示', copied.good && /已复制/.test(copied.text), copied.text);
await page.screenshot({ path: `${OUT}/10-share-copy.png` });

// 信息页不接受任何输入：这一页没有能粘东西进去的地方
const noImport = await page.evaluate(() => {
  const sheet = document.getElementById('diffSheet');
  return {
    fields: sheet.querySelectorAll('textarea, input, [contenteditable]').length,
    /* 难度那五行的问号也是 button（.ds-help），这里只看「有 id 的」那几颗 */
    buttons: Array.from(sheet.querySelectorAll('button:not(.ds-help)')).map(b => b.id)
  };
});
check('信息页里没有任何输入框', noImport.fields === 0, `fields=${noImport.fields}`);
check('信息页只有 X 与复制两颗按钮',
  noImport.buttons.length === 2 && noImport.buttons.indexOf('btnCopyCode') >= 0 &&
  noImport.buttons.indexOf('btnCloseDiff') >= 0, noImport.buttons.join(','));

// ---------- 14b. 载入代码搬到「新的一局」右上角 ----------
await page.evaluate(() => document.getElementById('btnCloseDiff').click());
await sleep(260);
const preSeed2 = await page.evaluate(() => __QUEENS_DEBUG__.state.seed);
await page.evaluate(() => __QUEENS_DEBUG__.newGame(10));
await page.waitForFunction((s) => {
  const st = __QUEENS_DEBUG__.state;
  return st.size === 10 && st.regions.length === 100 && st.seed !== s;
}, { timeout: 30000 }, preSeed2);
await sleep(320);
await page.click('#btnNew');
await sleep(420);

const loadUi = await page.evaluate(() => {
  const head = document.querySelector('#newSheet .sheet-head');
  const load = document.getElementById('btnLoadCode');
  const close = document.getElementById('btnCloseNew');
  const lr = load.getBoundingClientRect(), cr = close.getBoundingClientRect();
  return {
    inHead: !!head.querySelector('.head-acts #btnLoadCode'),
    icon: !!load.querySelector('svg') && !load.textContent.trim(),
    leftOfClose: lr.right <= cr.left,
    gap: Math.round(cr.left - lr.right),
    sameSize: Math.round(lr.width) === Math.round(cr.width),
    label: load.getAttribute('aria-label') || '',
    inInfo: !!document.querySelector('#diffSheet #btnLoadCode')
  };
});
check('载入代码在「新的一局」右上角、X 的左边，是一颗图标钮',
  loadUi.inHead && loadUi.icon && loadUi.leftOfClose && loadUi.sameSize && loadUi.gap <= 12,
  `gap=${loadUi.gap} same=${loadUi.sameSize}`);
check('载入图标与 X 同一套样子、有无障碍名称', /载入/.test(loadUi.label), loadUi.label);
check('载入代码已经不在信息页', loadUi.inInfo === false);
await page.screenshot({ path: `${OUT}/10b-load-icon.png` });

// 剪贴板里那串就是刚才复制的那盘：点一下应当装回来
await page.evaluate((c) => {
  try {
    Object.defineProperty(navigator.clipboard, 'readText', {
      configurable: true,
      value: () => Promise.resolve(c)
    });
  } catch (e) { /* 老浏览器没有 clipboard 对象，走原生输入框那一路 */ }
}, share.code);
await page.click('#btnLoadCode');
await sleep(900);
const rowLoad = await page.evaluate((code) => {
  const d = __QUEENS_DEBUG__;
  return {
    size: d.state.size,
    cells: document.querySelectorAll('.cell').length,
    same: Array.from(d.decode(code).regions).join() === Array.from(d.state.regions).join(),
    sheetClosed: document.getElementById('newWrap').hidden,
    hint: document.getElementById('hint').textContent.trim()
  };
}, share.code);
check('点载入图标就用剪贴板那串开局',
  rowLoad.size === 8 && rowLoad.cells === 64 && rowLoad.same, `size=${rowLoad.size} cells=${rowLoad.cells}`);
check('载入后面板收起并提示', rowLoad.sheetClosed && /已载入/.test(rowLoad.hint), rowLoad.hint);

// 坏代码：这一层不会掉，原因说到提示行上（信息页那行字此时是藏着的）
await page.click('#btnNew');
await sleep(400);
await page.evaluate(() => {
  try {
    Object.defineProperty(navigator.clipboard, 'readText', {
      configurable: true,
      value: () => Promise.resolve('QNS1-08-00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF-01234567-ABCDEF')
    });
  } catch (e) { /* 同上 */ }
});
await page.click('#btnLoadCode');
await sleep(500);
const rowBad = await page.evaluate(() => {
  const hint = document.getElementById('hint');
  return {
    text: hint.textContent.trim(),
    alert: hint.classList.contains('is-alert'),
    sheetOpen: !document.getElementById('newWrap').hidden,
    size: __QUEENS_DEBUG__.state.size
  };
});
check('坏代码在这条路上也被拒，原因说到提示行',
  rowBad.alert && /校验|不完整|太短/.test(rowBad.text), rowBad.text);
check('坏代码不换盘、也不收面板', rowBad.sheetOpen && rowBad.size === 8, `size=${rowBad.size}`);

// 没有剪贴板 API 的浏览器（局域网 http 下就是）：退回原生输入框，取消就当没点过
await page.evaluate(() => document.getElementById('btnCloseNew').click());
await sleep(260);
await page.evaluate(() => __QUEENS_DEBUG__.newGame(6));
await page.waitForFunction(() => {
  const st = __QUEENS_DEBUG__.state;
  return st.size === 6 && st.regions.length === 36;
}, { timeout: 20000 });
await sleep(280);
await page.evaluate(() => {
  window.__clipOrig = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});
await page.click('#btnNew');
await sleep(380);

let dlgSeen = '';
const onDlg = async (d) => { dlgSeen = d.type() + ':' + d.message(); await d.accept(share.code); };
page.on('dialog', onDlg);
await page.click('#btnLoadCode');
await sleep(1000);
page.removeAllListeners('dialog');
const noClip = await page.evaluate(() => ({
  size: __QUEENS_DEBUG__.state.size,
  cells: document.querySelectorAll('.cell').length,
  closed: document.getElementById('newWrap').hidden,
  hint: document.getElementById('hint').textContent.trim()
}));
check('没有剪贴板 API 时退到原生输入框，粘进去照样能载入',
  /^prompt:/.test(dlgSeen) && noClip.size === 8 && noClip.cells === 64 && noClip.closed,
  `${dlgSeen} size=${noClip.size} closed=${noClip.closed}`);

// 取消那一支：什么都不该发生（不换盘、不报错、层还开着）
await page.evaluate(() => __QUEENS_DEBUG__.newGame(6));
await page.waitForFunction(() => {
  const st = __QUEENS_DEBUG__.state;
  return st.size === 6 && st.regions.length === 36;
}, { timeout: 20000 });
await sleep(280);
await page.click('#btnNew');
await sleep(380);
const onDlgCancel = async (d) => { await d.dismiss(); };
page.on('dialog', onDlgCancel);
await page.click('#btnLoadCode');
await sleep(500);
page.removeAllListeners('dialog');
const cancelled = await page.evaluate(() => ({
  size: __QUEENS_DEBUG__.state.size,
  open: !document.getElementById('newWrap').hidden,
  alert: document.getElementById('hint').classList.contains('is-alert')
}));
check('输入框里点取消就当没点过', cancelled.size === 6 && cancelled.open && !cancelled.alert,
  JSON.stringify(cancelled));

await page.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: window.__clipOrig });
});
await page.evaluate(() => document.getElementById('btnCloseNew').click());
await sleep(300);

// 抄错一位 / 抄漏一位
const tamper = await page.evaluate((code) => {
  const d = __QUEENS_DEBUG__;
  const i = 20;
  const ch = code.charAt(i) === '0' ? '1' : '0';
  const typo = code.slice(0, i) + ch + code.slice(i + 1);
  const short = code.slice(0, code.length - 2);
  return {
    typo: d.decode(typo).msg,
    short: d.decode(short).msg,
    clear: d.decode('').msg,
    lower: d.decode(code.toLowerCase().replace(/-/g, ' ')).ok
  };
}, share.code);
check('抄错一位被校验拦住', /校验/.test(tamper.typo), tamper.typo);
check('抄漏几位被长度拦住', /不完整/.test(tamper.short), tamper.short);
check('空内容有提示', /太短/.test(tamper.clear), tamper.clear);
check('小写 / 空格 / 换行照样认', tamper.lower);
await page.screenshot({ path: `${OUT}/11-share-bad.png` });

// 链接 #code 直接开局
const p2 = await browser.newPage();
await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p2.on('pageerror', e => errors.push('hash: ' + e.message));
await p2.goto(URL + '#' + share.code, { waitUntil: 'networkidle0' });
await p2.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(600);
const hashLoad = await p2.evaluate((code) => {
  const d = __QUEENS_DEBUG__;
  return {
    size: d.state.size,
    cells: document.querySelectorAll('.cell').length,
    same: Array.from(d.decode(code).regions).join() === Array.from(d.state.regions).join(),
    hash: location.hash
  };
}, share.code);
check('#code 链接直接开局', hashLoad.size === 8 && hashLoad.cells === 64 && hashLoad.same, `size=${hashLoad.size}`);
check('载入后清掉 # 参数', hashLoad.hash === '', `hash=${hashLoad.hash}`);
await p2.screenshot({ path: `${OUT}/12-share-hash.png` });
await p2.close();

// ---------- 难度标签 ----------
log('\n--- 难度 ---');
// 前面的分享用例把面板留在了打开状态（app 被 inert），先收起来
await page.evaluate(() => {
  const closes = { sheetWrap: 'btnCloseSheet', diffWrap: 'btnCloseDiff', newWrap: 'btnCloseNew' };
  for (const wrap of Object.keys(closes)) {
    if (!document.getElementById(wrap).hidden) { document.getElementById(closes[wrap]).click(); break; }
  }
});
await sleep(300);
// newGame 是异步抽盘：上一局也是 8×8，光等 size 会立刻返回（读到的还是旧盘），
// 必须等 seed 换掉，否则后面 chip 与信息页读的是两盘棋
const preSeed = await page.evaluate(() => __QUEENS_DEBUG__.state.seed);
await page.evaluate(() => __QUEENS_DEBUG__.newGame(8));
await page.waitForFunction(s => {
  const st = __QUEENS_DEBUG__.state;
  return st.size === 8 && st.vibe && st.seed !== s;
}, { timeout: 20000 }, preSeed);
await sleep(400);

const chip = await page.evaluate(() => {
  const hud = document.getElementById('btnHud');
  const seg = document.getElementById('diffSeg');
  const v = __QUEENS_DEBUG__.state.vibe;
  return {
    hidden: seg.hidden,
    level: document.getElementById('diffLevel').textContent,
    score: document.getElementById('diffScore').textContent,
    aria: hud.getAttribute('aria-label'),
    vibe: { level: v.level, score: v.score, tone: v.tone, tier: v.tier },
    steps: v.steps,
    inHud: !!seg.closest('.hud'),
    chipBottom: hud.getBoundingClientRect().bottom,
    boardTop: document.getElementById('board').getBoundingClientRect().top
  };
});
check('信息条难度段可见', !chip.hidden && chip.inHud);
check('难度段文案是常见分级', /^(容易|中等|较难|困难|极难)$/.test(chip.level), chip.level);
check('难度段分数一位小数（可能两位整数）', /^\d{1,2}\.\d$/.test(chip.score), chip.score);
check('难度段与模型一致', chip.level === chip.vibe.level && chip.score === chip.vibe.score.toFixed(1));
check('信息条不压到棋盘', chip.chipBottom <= chip.boardTop + 1,
  `hud=${Math.round(chip.chipBottom)} board=${Math.round(chip.boardTop)}`);
check('无障碍标签带分数', /难度/.test(chip.aria) && /分/.test(chip.aria), chip.aria);
await page.screenshot({ path: `${OUT}/13-diff-chip.png` });

// 点开信息页（信息条整条是一个按钮，点哪一段都一样）
await page.click('#btnHud');
await sleep(350);
const sheet1 = await page.evaluate(() => {
  const v = __QUEENS_DEBUG__.state.vibe;
  const rows = Array.from(document.querySelectorAll('.diff-step'));
  const sh = document.getElementById('diffSheet');
  const sb = sh.getBoundingClientRect();
  const shareEl = document.querySelector('#diffSheet .share');
  const sr = shareEl.getBoundingClientRect();
  return {
    open: !document.getElementById('diffWrap').hidden,
    big: document.getElementById('diffBig').textContent,
    badge: document.getElementById('diffBadge').textContent,
    lead: document.getElementById('diffLead').textContent,
    names: rows.map(r => r.querySelector('.ds-name').textContent),
    counts: rows.map(r => r.querySelector('.ds-n').textContent),
    bars: rows.map(r => r.querySelector('.ds-bar i').style.width),
    steps: v.steps,
    focus: document.activeElement && document.activeElement.id,
    // 分享只剩一行（说明 + 复制），代码框与页脚按钮都去掉了——整块就在读数卡片
    // 正下方，不用滑就看得见；面板在 390×844 上也回到一屏装得下
    shareVisible: sr.top >= sb.top && sr.bottom <= sb.bottom + 1,
    shareCopy: !!document.getElementById('btnCopyCode'),
    over: sh.scrollHeight - sh.clientHeight
  };
});
check('信息页打开', sheet1.open);
check('信息页难度与信息条一致', sheet1.big === chip.score && sheet1.badge === chip.level,
  `${sheet1.big}/${sheet1.badge}`);
check('信息页列出 5 类构成', sheet1.names.length === 5, sheet1.names.join('|'));
check('每类都有次数', sheet1.counts.every(c => /^×\d+$/.test(c)), sheet1.counts.join(' '));
check('次数与模型一致', sheet1.counts[0] === '×' + sheet1.steps.openSingles &&
  sheet1.counts[3] === '×' + sheet1.steps.probe, sheet1.counts.join(' '));
check('条形有长度且不超 100%', sheet1.bars.every(b => {
  const w = parseFloat(b || '0');
  return w >= 0 && w <= 100;
}), sheet1.bars.join(' '));
check('有一句难度来源说明', /8×8/.test(sheet1.lead) && /试推|推完/.test(sheet1.lead), sheet1.lead);
check('分享这一局在首屏就看得见（复制钮在那一行）', sheet1.shareVisible && sheet1.shareCopy);
check('打开后焦点在弹层里', sheet1.focus === 'diffSheet', `focus=${sheet1.focus}`);
await page.screenshot({ path: `${OUT}/14-diff-sheet.png` });

// 名词解释收进每行的问号：默认不占版面，点开才出现
const tips0 = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.diff-step'));
  const row = rows[3];
  const btn = row.querySelector('.ds-help');
  const tip = row.querySelector('.ds-tip');
  const lg = document.getElementById('diffLegend');
  return {
    helps: document.querySelectorAll('.ds-help').length,
    tips: document.querySelectorAll('.ds-tip').length,
    shown: getComputedStyle(tip).display !== 'none',
    expanded: btn.getAttribute('aria-expanded'),
    label: btn.getAttribute('aria-label'),
    ids: rows.every(r => {
      const b = r.querySelector('.ds-help'), t = r.querySelector('.ds-tip');
      return b && t && b.getAttribute('aria-describedby') === t.id;
    }),
    legend: lg.textContent.replace(/\s+/g, ''),
    legendH: Math.round(lg.getBoundingClientRect().height)
  };
});
check('五类技巧各有一枚问号', tips0.helps === 5 && tips0.tips === 5, `${tips0.helps}/${tips0.tips}`);
check('说明默认收起', !tips0.shown && tips0.expanded === 'false');
check('问号有无障碍名称并与说明关联', /假设试推/.test(tips0.label) && tips0.ids, tips0.label);
check('底部常显的是差异说明而非名词表',
  /读数与实际的差异/.test(tips0.legend) && !/一上手|直接就能落子/.test(tips0.legend), tips0.legend.slice(0, 24));

const tipOpen = await page.evaluate(() => {
  const row = document.querySelectorAll('.diff-step')[3];
  const btn = row.querySelector('.ds-help');
  const sh = document.getElementById('diffSheet');
  /* 信息页底下已经没有按钮了，拿「读数与实际的差异」那一块当参照物：
     它在那几行下面，展开说明不该把它推走 */
  const before = Math.round(document.getElementById('diffLegend').getBoundingClientRect().top);
  const overBefore = sh.scrollHeight;
  btn.click();
  const tip = row.querySelector('.ds-tip');
  const r = tip.getBoundingClientRect();
  const box = sh.getBoundingClientRect();
  const after = Math.round(document.getElementById('diffLegend').getBoundingClientRect().top);
  return {
    display: getComputedStyle(tip).display,
    expanded: btn.getAttribute('aria-expanded'),
    text: tip.textContent,
    /* 说明是浮层：展开它不该把面板内容撑高（分享搬进来之后面板本来就能滚，
     * 所以比的是「撑没撑高」而不是「要不要滚」） */
    noGrow: sh.scrollHeight === overBefore,
    inside: r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1,
    noShift: before === after
  };
});
check('点问号展开该行说明', tipOpen.display === 'block' && tipOpen.expanded === 'true', tipOpen.display);
check('展开的是那一行的解释', /假设/.test(tipOpen.text) && /矛盾/.test(tipOpen.text), tipOpen.text.slice(0, 16));
check('说明浮在面板内，不把内容撑高', tipOpen.inside && tipOpen.noGrow);
check('展开不推走下面的内容', tipOpen.noShift);
await page.screenshot({ path: `${OUT}/14b-diff-tip.png` });

const tipClosed = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.diff-step'));
  rows[3].querySelector('.ds-help').click();          // 再点一次收起
  const closedByToggle = !rows[3].classList.contains('is-on');
  rows[1].querySelector('.ds-help').click();          // 开另一行
  const other = rows[1].classList.contains('is-on') && !rows[3].classList.contains('is-on');
  document.getElementById('diffTitle').click();       // 点别处收起
  const open = document.querySelectorAll('.diff-step.is-on').length;
  return { closedByToggle, other, open, expanded: rows[1].querySelector('.ds-help').getAttribute('aria-expanded') };
});
check('再点一次收起', tipClosed.closedByToggle);
check('一次只展开一行', tipClosed.other);
check('点别处收起且 aria 复位', tipClosed.open === 0 && tipClosed.expanded === 'false', `open=${tipClosed.open}`);

// 弹层开着时棋盘点不动
const locked = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const cell = document.querySelectorAll('.cell')[0];
  const before = d.state.marks[0];
  cell.click();
  return { before, after: d.state.marks[0] };
});
check('信息页打开时棋盘锁定', locked.before === locked.after, `${locked.before}→${locked.after}`);

// Esc 关闭 + 焦点回到标签
await page.keyboard.press('Escape');
await sleep(300);
const afterEsc = await page.evaluate(() => ({
  hidden: document.getElementById('diffWrap').hidden,
  focus: document.activeElement && document.activeElement.id,
  expanded: document.getElementById('btnHud').getAttribute('aria-expanded')
}));
check('Esc 关闭信息页', afterEsc.hidden);
check('关闭后焦点回到信息条', afterEsc.focus === 'btnHud', `focus=${afterEsc.focus}`);
check('aria-expanded 复位', afterEsc.expanded === 'false');

// 点背景关闭（信息页面板盖住屏幕下方大半，点最上面那一条背景）
await page.click('#btnHud');
await sleep(300);
await page.mouse.click(195, 24);
await sleep(300);
check('点背景关闭', await page.evaluate(() => document.getElementById('diffWrap').hidden));

// 关闭后可以继续落子
const playable = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  document.querySelectorAll('.cell')[0].click();
  return d.state.marks[0];
});
check('关闭后恢复操作', playable === 1, `marks[0]=${playable}`);
await page.evaluate(() => __QUEENS_DEBUG__.clear());

// 尺寸决定「一次功有多贵」：大盘整体更难，但不再严格单调
// （v2 刻度看的是要做多少功，8×8 里也有纯逻辑一遍推完的盘）
await page.evaluate(() => { __QUEENS_DEBUG__.settings.difficulty = 'any'; });
const ladders = [];
for (const n of [4, 8, 16]) {
  await page.evaluate((size) => __QUEENS_DEBUG__.newGame(size), n);
  await page.waitForFunction(`__QUEENS_DEBUG__.state.size === ${n} && __QUEENS_DEBUG__.state.vibe`, { timeout: 30000 });
  ladders.push(await page.evaluate(() => __QUEENS_DEBUG__.state.vibe.score));
}
check('大盘整体更难（16×16 比 4×4 高 1.5 分以上）', ladders[2] - ladders[0] >= 1.5, ladders.join(' / '));
check('分数在 1.0 以上、没有 9.9 上限', ladders.every(v => v >= 1 && v < 14), ladders.join(' / '));

// 4×4 物理上不可能难；16×16 偶尔会抽到特别顺的盘（约 3% 是中等），所以抽三次看两次
const smallTone = await page.evaluate(() => {
  __QUEENS_DEBUG__.newGame(4);
  return __QUEENS_DEBUG__.state.vibe && __QUEENS_DEBUG__.state.vibe.level;
});
check('4×4 一定是容易', smallTone === '容易', smallTone);
const bigTones = [];
for (let i = 0; i < 3; i++) {
  const prevSeed = await page.evaluate(() => __QUEENS_DEBUG__.state.seed);
  await page.evaluate(() => __QUEENS_DEBUG__.newGame(16));
  await page.waitForFunction(s => __QUEENS_DEBUG__.state.seed !== s && __QUEENS_DEBUG__.state.vibe,
    { timeout: 40000 }, prevSeed);
  bigTones.push(await page.evaluate(() => __QUEENS_DEBUG__.state.vibe.level));
}
check('16×16 大多落在较难以上',
  bigTones.filter(t => t === '较难' || t === '困难' || t === '极难').length >= 2, bigTones.join(' '));

// 续玩（从存档恢复）也要有难度：新开一页会走 loadGame 分支
await sleep(500);   // 等 save() 的 160ms 防抖落地
const p4 = await browser.newPage();
await p4.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p4.on('pageerror', e => errors.push('restore: ' + e.message));
await p4.goto(URL, { waitUntil: 'networkidle0' });
await p4.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.vibe', { timeout: 20000 });
await sleep(400);
const resumed = await p4.evaluate(() => ({
  size: __QUEENS_DEBUG__.state.size,
  vibe: __QUEENS_DEBUG__.state.vibe && __QUEENS_DEBUG__.state.vibe.level,
  chip: !document.getElementById('diffSeg').hidden,
  text: document.getElementById('diffLevel').textContent
}));
check('续玩恢复后仍有难度', resumed.chip && resumed.size === 16 && resumed.vibe === resumed.text,
  `size=${resumed.size} ${resumed.vibe}/${resumed.text}`);
await p4.close();

// ---------- 汇总 ----------
log('\n--- console errors ---');
log(errors.length ? errors.join('\n') : '(none)');
check('无 JS 报错 / 资源失败', errors.length === 0, `count=${errors.length}`);

await browser.close();
log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
