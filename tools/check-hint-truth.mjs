/* ============================================================================
 * 界面回归：提示文案必须和玩家眼前的棋盘对得上
 * ----------------------------------------------------------------------------
 * 复现玩家反馈：「明明有两个没划掉，提示却说只有一个」。
 * 校验点：
 *   1. 关掉自动打叉时，引导不会在「这一行/这一块还有 2 格没划掉」的时候念「只剩一格」，
 *      而是先给一份「补划」（把被已放好的皇后管着、还没划掉的格子划掉）
 *   2. 照做之后再看提示，文案里说的那一格确实是盘面上唯一没划掉的那格
 *   3. 把某格真皇后画成 × 时，引导先报「检查」（这一格不该画 ×），
 *      而不是把这一格当成已经落子、继续往下推出错误的结论
 * 用法：node tools/check-hint-truth.mjs [url]
 * ========================================================================== */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
await sleep(600);

// 在页面里造局面：放对若干皇后，随机画 ×（关掉自动打叉），
// 一路找出「提示本该说只剩一格、但盘面上还有两格没划掉」的那种局面
const setup = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const H = window.QueensHint;
  /* 自动打 × 是这一局的规矩（state），而 d.newGame() 会照 settings 重开一局，
   * 所以两边都得拨掉——否则循环里每换一盘它又按默认开着回来了。 */
  d.settings.autoMark = false;
  d.state.autoMark = false;
  const found = [];

  const rand = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  for (const n of [6, 8]) {
    for (let s = 0; s < 60 && !found.length; s++) {
      d.newGame(n, (s * 7919 + n * 104729) >>> 0);
      const st = d.state;
      if (st.size !== n) continue;
      const total = n * n;
      const isSol = new Uint8Array(total);
      for (let r = 0; r < n; r++) isSol[r * n + st.solution[r]] = 1;
      const rnd = rand(s * 2654435761 + 13);
      const marks = new Uint8Array(total);

      const qCount = Math.floor(rnd() * n);
      const order = [];
      for (let r = 0; r < n; r++) order.push(r * n + st.solution[r]);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (let k = 0; k < qCount; k++) marks[order[k]] = 2;
      const xCount = Math.floor(rnd() * total * 0.5);
      for (let k = 0; k < xCount; k++) {
        const i = Math.floor(rnd() * total);
        if (marks[i]) continue;
        if (isSol[i]) continue;          // 不造「画错的 ×」，那种情况单独测
        marks[i] = 1;
      }

      st.marks = Array.from(marks);
      d.render();
      const p = H.plan({
        n, regions: st.regions, solution: st.solution,
        marks: st.marks, auto: null, maxK: 3, allowProbe: true
      });
      if (p.rule !== 'C1') continue;

      // 这份「补划」必须真的对得上：划掉之后同一条线/块只剩 1 格
      const cell = p.action.cells[0];
      const g = st.regions[cell];
      let live = 0;
      for (let i = 0; i < total; i++) {
        if (st.marks[i] !== 0) continue;
        if (p.action.cells.indexOf(i) >= 0) continue;
        if (st.regions[i] === g) live++;
      }
      found.push({
        n, seed: (s * 7919 + n * 104729) >>> 0,
        rule: p.rule, kind: p.kind, stale: p.action.cells.slice(),
        g, liveAfterCatchUp: live,
        texts: p.steps.map((x) => x.text)
      });
    }
  }
  return found.slice(0, 1);
});

check('能找到「盘面落后于提示」的局面', setup.length === 1, JSON.stringify(setup[0] && setup[0].texts));
if (setup.length) {
  const c = setup[0];
  check('这种局面先给「补划」，不冒充结论',
    c.rule === 'C1' && c.kind === 'cross' && /这里还有 \d+ 格没被划掉/.test(c.texts[1] || ''),
    c.texts.join(' | '));
  check('补划之后这条线/块真的只剩一格', c.liveAfterCatchUp === 1, 'live=' + c.liveAfterCatchUp);
}

// 照做 → 再看提示：文案里的那一格必须就是盘面上唯一没划掉的那格
const flow = await page.evaluate(async () => {
  const d = __QUEENS_DEBUG__;
  const H = window.QueensHint;
  d.state.marks = d.state.marks.slice();
  d.render();
  d.useHint();
  await new Promise((r) => setTimeout(r, 260));
  const p1 = d.guide().plan;
  const before = p1 && p1.rule;
  // 连点到底（最后一步是「照做」）
  for (let i = 0; i < 8; i++) { d.guideNext(); await new Promise((r) => setTimeout(r, 60)); }
  const applied = d.guide().open === false;

  d.useHint();
  await new Promise((r) => setTimeout(r, 260));
  const p2 = d.guide().plan;
  const txt = p2.steps.map((x) => x.text);
  const n = d.state.size;
  const hl = (p2.steps[1] && p2.steps[1].hl) || {};
  const cells = hl.regions && hl.regions.length ? (() => {
    const out = [];
    for (let i = 0; i < n * n; i++) if (d.state.regions[i] === hl.regions[0]) out.push(i);
    return out;
  })() : hl.rows && hl.rows.length ? (() => {
    const out = [];
    for (let c = 0; c < n; c++) out.push(hl.rows[0] * n + c);
    return out;
  })() : (() => {
    const out = [];
    for (let r = 0; r < n; r++) out.push(r * n + hl.cols[0]);
    return out;
  })();
  const live = cells.filter((i) => d.state.marks[i] === 0);
  d.guideClose();
  return { before, applied, rule: p2.rule, txt, live, target: p2.steps[1] && p2.steps[1].hl.cells[0] };
});

check('点「照做」后引导关闭、改动落地', flow.applied === true);
if (flow.rule === 'R1' || flow.rule === 'R2' || flow.rule === 'R3') {
  check('R1–R3 的文案对得上盘面（真的只剩一格）', flow.live.length === 1, `live=${flow.live.length}`);
  check('念的那一格就是盘面唯一那格', flow.live[0] === flow.target, `${flow.live[0]} vs ${flow.target}`);
} else {
  check('补划之后给的是落子提示', /只剩.*这一格没被划掉/.test(flow.txt.join('')), flow.txt.join(' | '));
}

// 画错 ×：把一座真皇后画成 ×，提示必须先报「检查」
const wrongX = await page.evaluate(async () => {
  const d = __QUEENS_DEBUG__;
  const n = d.state.size;
  d.state.marks = new Array(n * n).fill(0);
  // 放对 3 座皇后，再把第 4 行的真皇后位置画成 ×
  for (let r = 0; r < 3; r++) d.state.marks[r * n + d.state.solution[r]] = 2;
  const bad = 3 * n + d.state.solution[3];
  d.state.marks[bad] = 1;
  d.render();

  // 像玩家一样一路「点提示 → 照做」，直到它把这张错 × 指出来
  let rule = null, txt = [], rounds = 0;
  for (; rounds < 8; rounds++) {
    d.useHint();
    await new Promise((r) => setTimeout(r, 220));
    const p = d.guide().plan;
    if (!p) break;
    rule = p.rule; txt = p.steps.map((x) => x.text);
    if (rule === 'FX') {
      for (let i = 0; i < 8; i++) { d.guideNext(); await new Promise((r) => setTimeout(r, 40)); }
      break;
    }
    if (!p.action) { d.guideClose(); break; }
    for (let i = 0; i < 8; i++) { d.guideNext(); await new Promise((r) => setTimeout(r, 40)); }
  }
  d.guideClose();
  return { rule, txt, rounds, after: d.state.marks[bad] };
});
check('把真皇后画成 × 时先报「检查」', wrongX.rule === 'FX' && /不该画 ×/.test(wrongX.txt[0] || ''), wrongX.txt.join(' | '));
check('「检查」照做后这格的 × 被清掉', wrongX.after === 0, 'mark=' + wrongX.after);

check('无 JS 报错', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
