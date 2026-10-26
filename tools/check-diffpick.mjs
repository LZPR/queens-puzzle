/* 目标难度出题（刻度 v3）：档位决定「开放哪些尺寸 + 分数区间」，玩家在这一档里挑尺寸；
 * 选档 / 选尺寸都只是意向，点「换一局」才生效；切回不限恢复全量尺寸；设置持久化。
 * 用法：先起本地服务（python serve.py），再 node tools/check-diffpick.mjs
 */
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

/* 档位表必须与 core/config.js 的 DIFF_BANDS 一致。
 * 区间是两头的：[min, max)，max 对齐下一档的 min（极难不封顶，写 99）。 */
const BANDS = {
  easy: { name: '容易', lo: 4, hi: 5, min: 0, max: 6.0 },
  mid: { name: '中等', lo: 6, hi: 8, min: 6.0, max: 7.0 },
  advanced: { name: '较难', lo: 9, hi: 14, min: 7.0, max: 10.0 },
  hard: { name: '困难', lo: 15, hi: 16, min: 10.0, max: 11.3 },
  extreme: { name: '极难', lo: 16, hi: 16, min: 11.3, max: 99 }
};
const LEVEL_MIN = { 容易: 0, 中等: 6.0, 较难: 7.0, 困难: 10.0, 极难: 11.3 };
const LEVEL_NEXT = { 容易: 6.0, 中等: 7.0, 较难: 10.0, 困难: 11.3, 极难: 99 };
const toneOk = s => s.score >= LEVEL_MIN[s.lvl] && s.score < LEVEL_NEXT[s.lvl];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// 面板里的按钮在 slide-up 动画期间拿不到稳定 bbox，统一用 JS click
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
  await sleep(420);
}
async function closeSheetIfOpen() {
  const open = await page.evaluate(() => !document.getElementById('newWrap').hidden);
  if (open) { await jsClick('#btnCloseNew'); await sleep(380); }
}
const snap = () => page.evaluate(() => ({
  n: __QUEENS_DEBUG__.state.size,
  seed: __QUEENS_DEBUG__.state.seed,
  lvl: __QUEENS_DEBUG__.state.vibe && __QUEENS_DEBUG__.state.vibe.level,
  score: __QUEENS_DEBUG__.state.vibe && Math.round(__QUEENS_DEBUG__.state.vibe.score * 10) / 10
}));
/* 面板读数：尺寸待生效值 / 可选尺寸 / 加减按钮状态 / 提示文案 */
const sheetUi = () => page.evaluate(() => ({
  val: parseInt(document.getElementById('sizeVal').textContent.trim(), 10),
  chips: Array.from(document.querySelectorAll('#quickRow .qbtn')).map(b => parseInt(b.dataset.size, 10)),
  minusOff: document.getElementById('sizeMinus').disabled,
  plusOff: document.getElementById('sizePlus').disabled,
  hint: document.getElementById('diffHint').textContent.trim(),
  sizeHint: document.getElementById('sizeHint').textContent.trim(),
  on: Array.from(document.querySelectorAll('.dbtn.is-on')).map(b => b.textContent.trim()),
  pending: document.getElementById('btnShuffle').classList.contains('is-pending'),
  shuffleHint: document.getElementById('shuffleHint').textContent.trim()
}));
const range = (lo, hi) => { const a = []; for (let i = lo; i <= hi; i++) a.push(i); return a; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* 一次换局只有两种结局：
 *   board    —— 新盘装上了（seed 变了、难度已就绪）
 *   mismatch —— 一批里一张都没落进档位区间，那张「没抽到够格的盘」冒出来，盘**没动**
 * 后者是这一版的重点：不装「错」的盘，改问玩家要不要再抽。 */
function waitOutcome(prevSeed) {
  return page.waitForFunction(p => {
    const mm = document.getElementById('mismatch');
    if (mm && !mm.hidden) return 'mismatch';
    const st = __QUEENS_DEBUG__.state;
    if (st.seed !== p && st.vibe && st.vibe.level) return 'board';
    return false;
  }, { timeout: 90000 }, prevSeed).then(h => h.jsonValue());
}

/* 换一局（trigger 只在第一批时点按钮），碰到那张卡就照玩家的做法点「再抽一局」。
 * 返回的状态里 blocked = 中途被挡了几回（正常是 0），batches = 一共抽了几批。 */
async function rollOnce(trigger) {
  /* prev 只在开头取一次：不够格时盘压根没动，seed 一直有效；
   * 每轮重新取会踩到「点完『再抽一局』、新盘先落地」的竞态——
   * 那时 prev 已经是新盘的 seed，等到天亮也不会再变。 */
  const prev = (await snap()).seed;
  for (let i = 0; i < 6; i++) {
    await trigger(i);
    let out;
    try {
      out = await waitOutcome(prev);
    } catch (err) {
      // 等不到结果时把现场打出来，不然只有一个 TimeoutError 看不出所以然
      const dump = await page.evaluate(() => ({
        seed: __QUEENS_DEBUG__.state.seed,
        n: __QUEENS_DEBUG__.state.size,
        status: __QUEENS_DEBUG__.state.status,
        vibe: __QUEENS_DEBUG__.state.vibe && __QUEENS_DEBUG__.state.vibe.level,
        mmHidden: document.getElementById('mismatch').hidden,
        veil: document.getElementById('veil').hidden,
        sheet: document.getElementById('newWrap').hidden,
        setting: __QUEENS_DEBUG__.settings.difficulty
      }));
      throw new Error(err.message + '\n  prev=' + prev + '  ' + JSON.stringify(dump) +
        '\n  ' + errs.join('\n  '));
    }
    if (out === 'board') {
      const st = await snap();
      st.batches = i + 1;
      st.blocked = i;
      return st;
    }
    await jsClick('#btnMmRetry');
    await sleep(140);
  }
  return null;
}

/* 换一局 + 等到新盘（不够格就再抽，最多 6 批） */
async function shuffle() {
  const st = await rollOnce(async i => { if (i === 0) await jsClick('#btnShuffle'); });
  if (!st) throw new Error('连抽 6 批都没够到档位下限');
  return st;
}

async function boot() {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.vibe', { timeout: 30000 });
  await sleep(450);
}

/* ---------- 1. 换一局面板外观 ---------- */
console.log('\n[1] 换一局面板');
await boot();
await closeSheetIfOpen();
await openSheet();
const ui0 = await page.evaluate(() => {
  const sheet = document.getElementById('newSheet');
  const kids = Array.from(sheet.children);
  return {
    opts: Array.from(document.querySelectorAll('.dbtn')).map(b => b.textContent.trim()),
    on: Array.from(document.querySelectorAll('.dbtn.is-on')).map(b => b.textContent.trim()),
    note: document.getElementById('newNote').textContent.trim(),
    hint: document.getElementById('diffHint').textContent.trim(),
    hasDone: !!document.getElementById('btnDone'),
    hasRestart: !!document.getElementById('btnRestart'),
    // 顺序：目标难度 → 挑战（也是「换一局才生效」的一组）→ 换一局
    shuffleAfterDiff: kids.indexOf(document.querySelector('.challenge')) ===
        kids.indexOf(document.querySelector('.diff-row')) + 2 &&
      kids.indexOf(document.querySelector('.shuffle-row')) ===
        kids.indexOf(document.querySelector('.challenge')) + 1,
    shuffleHint: document.getElementById('shuffleHint').textContent.trim()
  };
});
ok('六个档位齐全', ui0.opts.length === 6 && ui0.opts.join('') === '不限容易中等较难困难极难', ui0.opts);
ok('默认选中「不限」', ui0.on.length === 1 && ui0.on[0] === '不限', ui0.on);
ok('没有「好了」与「重开本局」', ui0.hasDone === false && ui0.hasRestart === false);
ok('「换一局」紧跟在挑战组之后（尺寸/难度/挑战都往这里落地）', ui0.shuffleAfterDiff === true);
ok('说明文案指向换一局', /换一局/.test(ui0.hint) && /生效/.test(ui0.shuffleHint), [ui0.hint, ui0.shuffleHint]);
ok('面板顶部标出当前这局', /当前这局/.test(ui0.note), ui0.note);
const ui0s = await sheetUi();
ok('不限档：可选尺寸是常用那几个', same(ui0s.chips, [6, 8, 10, 12, 15]), ui0s.chips);
await page.screenshot({ path: SHOTS + 'diff-setting.png' });

/* ---------- 2. 选「较难」：只记意向 + 尺寸夹进 9–14 ---------- */
console.log('\n[2] 选「较难」');
const before = await snap();
// 直接在元素实例上拦 hidden 的 setter：这是 showVeil/hideVeil 唯一的可见副作用，
// 比 MutationObserver 可靠（hidden 是反射属性，add/remove 的 oldValue 语义容易误判）
async function armVeil() {
  await page.evaluate(() => {
    const v = document.getElementById('veil');
    if (!Object.prototype.hasOwnProperty.call(v, 'hidden')) {
      v.__probe = { cur: v.hidden, log: [] };
      Object.defineProperty(v, 'hidden', {
        configurable: true,
        get() { return this.__probe.cur; },
        set(x) {
          this.__probe.cur = !!x;
          this.__probe.log.push({
            shown: !x,
            t: Math.round(performance.now()),
            title: document.getElementById('veilTitle').textContent.trim()
          });
        }
      });
    }
    v.__probe.log.length = 0;
  });
}
const veilLog = () => page.evaluate(() => document.getElementById('veil').__probe.log.slice());

await armVeil();
await jsClick('.dbtn[data-level="advanced"]');
await sleep(600);
const picked = await page.evaluate(() => ({
  seed: __QUEENS_DEBUG__.state.seed,
  setting: __QUEENS_DEBUG__.settings.difficulty,
  ls: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').difficulty,
  sheetClosed: document.getElementById('newWrap').hidden
}));
const hardUi = await sheetUi();
ok('当前局没被换掉', picked.seed === before.seed, { seed: picked.seed, was: before.seed });
ok('面板不自动收起', picked.sheetClosed === false);
ok('意向先挂在面板上，还没写进设置', picked.setting === 'any' && picked.ls === 'any', [picked.setting, picked.ls]);
ok('档位已高亮较难', hardUi.on.length === 1 && hardUi.on[0] === '较难', hardUi.on);
ok('「换一局」进入待生效态', hardUi.pending === true);
ok('待生效提示写明较难与尺寸', /较难/.test(hardUi.shuffleHint) && /9×9/.test(hardUi.shuffleHint), hardUi.shuffleHint);
ok('可选尺寸换成 9–14', same(hardUi.chips, range(9, 14)), hardUi.chips);
ok('原来的 8 被夹到 9（档位下界）', hardUi.val === 9, hardUi.val);
ok('说明文案写出分数区间（区间挪到「棋盘大小」那行）',
  /较难/.test(hardUi.hint) && /7\.0/.test(hardUi.hint) && /10\.0/.test(hardUi.hint) &&
  /换一局/.test(hardUi.hint), hardUi.hint);
ok('棋盘大小那行的副标题跟着变', /较难/.test(hardUi.sizeHint) && /9×9/.test(hardUi.sizeHint), hardUi.sizeHint);
ok('在下界时「−」不可用', hardUi.minusOff === true && hardUi.plusOff === false, hardUi);
await page.screenshot({ path: SHOTS + 'diff-setting-pending.png' });

/* ---------- 3. 档内挑 12×12，点「换一局」才落地 ---------- */
console.log('\n[3] 换一局（较难 12×12）');
await jsClick('.qbtn[data-size="12"]');
await sleep(200);
const pick12 = await sheetUi();
ok('点 12×12 只改待生效值', pick12.val === 12 && pick12.pending === true, pick12.val);
const hard1 = await shuffle();
const veil = await veilLog();
const veilShown = veil.filter(e => e.shown);
const afterShuffle = await page.evaluate(() => ({
  setting: __QUEENS_DEBUG__.settings.difficulty,
  size: __QUEENS_DEBUG__.settings.size,
  ls: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}'),
  chip: document.getElementById('diffSeg').textContent.replace(/\s+/g, ' ').trim(),
  sheetClosed: document.getElementById('newWrap').hidden
}));
ok('新局是 12×12', hard1.n === 12, hard1);
ok('较难档分数够 7.0', hard1.score >= 7.0, hard1);
ok('档位与分数自洽', toneOk(hard1), hard1);
ok('较难档不会抽到中等或容易', hard1.lvl !== '中等' && hard1.lvl !== '容易', hard1.lvl);
/* 上界也要卡住：较难档（9–14）里偶尔会出 10 分以上的困难盘，那一张不许装 */
ok('较难档不会抽到困难或极难', hard1.lvl === '较难' && hard1.score < 10.0, hard1);
/* 被「没抽到够格的盘」挡过的那一回中途会重抽一轮，遮罩自然也会跟着露第二次，
 * 所以这条只在一次性抽到时判（12×12 一批命中约九成，绝大多数时候都走这条路）。
 * 现在一批抽空不会马上弹卡，而是接着抽到 3 秒（见 SEARCH_MS），
 * 所以「露了没」改为跟这一次出题的真实耗时对照：90ms 内就出盘的，不该有遮罩。 */
const roll1 = await page.evaluate(() => __QUEENS_DEBUG__.rollInfo());
ok('快盘不闪遮罩（90ms 内出盘就没有遮罩）', !roll1 || roll1.ms >= 90 || veilShown.length === 0,
  { veil, roll: roll1, blocked: hard1.blocked });
ok('设置已写回 settings', afterShuffle.setting === 'advanced' && afterShuffle.size === 12, afterShuffle);
ok('设置已落 localStorage', afterShuffle.ls.difficulty === 'advanced' && afterShuffle.ls.size === 12, afterShuffle.ls);
ok('面板收起', afterShuffle.sheetClosed === true);
// 标签显示的是这盘真实的档位，跟选的档位一致（上界卡住之后不可能再漂到极难）
ok('顶栏难度标签已更新', afterShuffle.chip.indexOf(hard1.lvl) >= 0,
  afterShuffle.chip + ' / ' + hard1.lvl);
await page.screenshot({ path: SHOTS + 'diff-hard-board.png' });

/* ---------- 4. 尺寸只能在档内走 ---------- */
console.log('\n[4] 档内尺寸');
await openSheet();
const lockUi = await sheetUi();
ok('待生效尺寸仍是 12', lockUi.val === 12, lockUi.val);
ok('加减按钮在区间内都可用', lockUi.minusOff === false && lockUi.plusOff === false, lockUi);
const seedBefore = (await snap()).seed;
await jsClick('#sizePlus');
await sleep(250);
const plusUi = await sheetUi();
ok('「+」走到 13', plusUi.val === 13 && plusUi.plusOff === false, plusUi);
await jsClick('#sizePlus');
await sleep(250);
const plusUi2 = await sheetUi();
ok('「+」走到 14 就顶住了', plusUi2.val === 14 && plusUi2.plusOff === true, plusUi2);
const noNew = await snap();
ok('改尺寸不会立刻换局', noNew.seed === seedBefore, { seed: noNew.seed, was: seedBefore });
await closeSheetIfOpen();

/* ---------- 5. 连开 8 局（12×12）：档位达标、尺寸不飘 ---------- */
console.log('\n[5] 连开 8 局 12×12');
await page.evaluate(() => { __QUEENS_DEBUG__.settings.size = 12; });
await openSheet();
await jsClick('.qbtn[data-size="12"]');
await sleep(200);
await closeSheetIfOpen();
const seq = [];
for (let i = 0; i < 8; i++) {
  // 不够格会弹出「没抽到够格的盘」，rollOnce 会点「再抽一局」接着抽
  const st = await rollOnce(async j => {
    if (j === 0) await page.evaluate(sz => __QUEENS_DEBUG__.newGame(sz), 12);
  });
  if (!st) { ok('第 ' + (i + 1) + ' 局出盘', false, '六批都没够格'); break; }
  seq.push(st);
  console.log('    #' + (i + 1) + '  ' + st.n + '×' + st.n + '  ' + st.lvl + '  ' + st.score +
    (st.blocked ? '  （中途挡了 ' + st.blocked + ' 回）' : ''));
}
ok('8 局全是 12×12', seq.length === 8 && seq.every(s => s.n === 12), seq.map(s => s.n));
/* 区间是两头的：没落进去的盘一律不装，会退回「再抽一局 / 更换设置」，
 * 所以能落到这里的每一盘都该真的在 7.0–10.0 之间 */
ok('8 局都够到较难分', seq.length === 8 && seq.every(s => s.score >= 7.0), seq.map(s => s.score));
ok('8 局都没超到困难', seq.length === 8 && seq.every(s => s.score < 10.0 && s.lvl === '较难'),
  seq.map(s => s.lvl + s.score));
ok('档位与分数自洽（每局）', seq.every(toneOk), seq.map(s => s.lvl + s.score));
/* 12×12 单张落在 7–10 分的概率很高，3 秒窗口里基本一批到手；
 * 八局里偶尔要补一批是正常的，补得太多说明命中率掉了，得回头看刻度 */
ok('12×12 大多一批到手', seq.filter(s => s.batches === 1).length >= 6,
  seq.map(s => s.batches));

/* ---------- 6. 刷新后设置仍在 ---------- */
console.log('\n[6] 刷新持久化');
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.vibe', { timeout: 30000 });
await sleep(450);
const restored = await page.evaluate(() => ({
  setting: __QUEENS_DEBUG__.settings.difficulty,
  size: __QUEENS_DEBUG__.settings.size,
  chip: document.getElementById('diffSeg').textContent.replace(/\s+/g, ' ').trim(),
  lvl: __QUEENS_DEBUG__.state.vibe && __QUEENS_DEBUG__.state.vibe.level,
  hasVibe: !!__QUEENS_DEBUG__.state.vibe
}));
ok('刷新后设置仍是较难 12×12', restored.setting === 'advanced' && restored.size === 12, restored);
// 续玩的这盘可能正是 8 局里唯一没够到 7.0 的那张 —— 标签跟这盘的真实档位走
ok('刷新后顶栏仍显示这局的难度', !!restored.lvl && restored.chip.indexOf(restored.lvl) >= 0,
  restored.chip + ' / ' + restored.lvl);
ok('刷新后续玩盘仍带难度', restored.hasVibe === true);
await openSheet();
const uiR = await sheetUi();
ok('刷新后档位仍高亮较难', uiR.on.length === 1 && uiR.on[0] === '较难', uiR.on);
ok('刷新后待生效尺寸是 12', uiR.val === 12, uiR.val);
ok('刷新后没有待生效改动', uiR.pending === false, uiR.shuffleHint);

/* ---------- 7. 切回「不限」+ 手动尺寸 ---------- */
console.log('\n[7] 切回不限');
const seedAny0 = (await snap()).seed;
await jsClick('.dbtn[data-level="any"]');
await sleep(500);
const backAnyPending = await page.evaluate(() => ({
  setting: __QUEENS_DEBUG__.settings.difficulty,
  seed: __QUEENS_DEBUG__.state.seed
}));
const anyUi = await sheetUi();
ok('切不限也不会立刻换局', backAnyPending.seed === seedAny0 && backAnyPending.setting === 'advanced', backAnyPending);
ok('可选尺寸恢复常用那几个', same(anyUi.chips, [6, 8, 10, 12, 15]), anyUi.chips);
ok('「换一局」提示待生效', anyUi.pending === true);

await shuffle();
const backAny = await page.evaluate(() => ({
  setting: __QUEENS_DEBUG__.settings.difficulty,
  ls: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').difficulty
}));
ok('换一局后设置回到 any', backAny.setting === 'any' && backAny.ls === 'any', backAny);

await openSheet();
const seedManual = (await snap()).seed;
const boardNow = (await snap()).n;
const pick = boardNow === 6 ? 12 : 6;   // 挑一个跟当前不同的尺寸，才看得出「没立刻生效」
await jsClick('.qbtn[data-size="' + pick + '"]');
await sleep(400);
const manualPending = await page.evaluate(() => ({
  val: document.getElementById('sizeVal').textContent.trim(),
  board: __QUEENS_DEBUG__.state.size,
  seed: __QUEENS_DEBUG__.state.seed,
  pending: document.getElementById('btnShuffle').classList.contains('is-pending'),
  hint: document.getElementById('shuffleHint').textContent.trim()
}));
ok('点 ' + pick + '×' + pick + ' 只改待生效值',
  manualPending.val === String(pick) && manualPending.board === boardNow &&
  manualPending.seed === seedManual && manualPending.pending === true, manualPending);
ok('待生效提示写明 ' + pick + '×' + pick, new RegExp(pick + '×' + pick).test(manualPending.hint), manualPending.hint);
const manual = await shuffle();
ok('换一局后得到 ' + pick + '×' + pick, manual.n === pick, manual);
ok('不限档下尺寸可自由选（难度随之变化）', !!manual.lvl, manual);

/* ---------- 7b. 盘上有子时改档：同样只记意向 ---------- */
console.log('\n[7b] 有进度时改档');
const seedKeep = (await snap()).seed;
await page.evaluate(() => { __QUEENS_DEBUG__.state.marks[0] = 1; __QUEENS_DEBUG__.render(); });
await openSheet();
await jsClick('.dbtn[data-level="extreme"]');
await sleep(600);
const keep = await page.evaluate(() => ({
  seed: __QUEENS_DEBUG__.state.seed,
  lvl: __QUEENS_DEBUG__.state.vibe.level,
  setting: __QUEENS_DEBUG__.settings.difficulty,
  sheetClosed: document.getElementById('newWrap').hidden
}));
const extUi = await sheetUi();
ok('当前局没被换掉', keep.seed === seedKeep && keep.lvl !== '极难', { seed: keep.seed, was: seedKeep, lvl: keep.lvl });
ok('进度还在（面板没关、盘没重排）', keep.sheetClosed === false);
ok('意向已挂上极难', extUi.pending === true && keep.setting === 'any', keep);
ok('极难只开放 16×16', same(extUi.chips, [16]) && extUi.val === 16, extUi);
const freshExt = await shuffle();
ok('换一局后是 16×16', freshExt.n === 16, freshExt);
ok('极难档分数 ≥11.3', freshExt.score >= 11.3 && freshExt.lvl === '极难', freshExt);

/* ---------- 8. 慢设备模拟：遮罩该出来 ---------- */
console.log('\n[8] 慢设备模拟（出题卡 220ms）');
await closeSheetIfOpen();
await openSheet();
await jsClick('.dbtn[data-level="any"]');
await sleep(300);
// 换回不限档：顺手把档位清干净，也让下面挑的尺寸是「没测过的」
await shuffle();
const restoredSize = (await snap()).n;
// 挑一个这一轮还没生成过的尺寸，首局才是真正的「无实测」
const bigN = restoredSize === 13 ? 14 : 13;
const geo = await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('veil'));
  return { pos: cs.position, z: cs.zIndex };
});
ok('遮罩是全屏 fixed 层', geo.pos === 'fixed', geo);
ok('遮罩在弹层之上的层级', parseInt(geo.z, 10) >= 60, geo.z);

// 视觉快照：这张图看的是遮罩长相，所以先把真实 hidden 属性摘掉再拍
await sleep(250);
await page.evaluate(n => {
  const v = document.getElementById('veil');
  document.getElementById('veilTitle').textContent = '正在生成 ' + n + '×' + n;
  delete v.hidden;                 // 撤掉探针，恢复原生反射
  v.removeAttribute('hidden');
}, bigN);
await sleep(220);
await page.screenshot({ path: SHOTS + 'diff-loading.png' });
await page.evaluate(() => { document.getElementById('veil').setAttribute('hidden', ''); });
await sleep(150);

await page.evaluate(() => {
  if (!window.__origGen) {
    const orig = window.QueensEngine.generate;
    window.__origGen = orig;
    window.QueensEngine.generate = function (n, seed) {
      const t = performance.now();
      while (performance.now() - t < 220) { /* 空转，模拟低端机 */ }
      return orig(n, seed);
    };
  }
});

// 第一次：还没记录到这个尺寸的真实耗时 → 按估值走，先不露（只卡一下）
let s1 = (await snap()).seed;
await armVeil();
await page.evaluate(n => __QUEENS_DEBUG__.newGame(n), bigN);
await page.waitForFunction(s => __QUEENS_DEBUG__.state.seed !== s, { timeout: 60000 }, s1);
await sleep(250);
const slowFirst = await veilLog();

// 第二次：记录到真实耗时 → 立刻露遮罩
s1 = (await snap()).seed;
await armVeil();
await page.evaluate(n => __QUEENS_DEBUG__.newGame(n), bigN);
await page.waitForFunction(s => __QUEENS_DEBUG__.state.seed !== s, { timeout: 60000 }, s1);
await sleep(250);
const slowSecond = await veilLog();
const slow2Shown = slowSecond.filter(e => e.shown);

ok('首局（无实测）不闪遮罩', slowFirst.filter(e => e.shown).length === 0, slowFirst);
ok('第二局立刻露遮罩', slow2Shown.length > 0, slowSecond);
ok('遮罩文案带尺寸', new RegExp('正在生成.*' + bigN + '×' + bigN).test(slow2Shown[0] && slow2Shown[0].title || ''), slow2Shown[0]);
ok('遮罩用「不淡入」模式', await page.evaluate(() => document.getElementById('veil').classList.contains('is-instant')));
await page.evaluate(() => { if (window.__origGen) { window.QueensEngine.generate = window.__origGen; window.__origGen = null; } });

/* ---------- 9. 各档位抽查（选档 → 挑该档最强的尺寸 → 换一局） ---------- */
console.log('\n[9] 各档位抽查');
for (const [key, band] of Object.entries(BANDS)) {
  await closeSheetIfOpen();
  await openSheet();
  await jsClick('.dbtn[data-level="' + key + '"]');
  await sleep(250);
  await jsClick('.qbtn[data-size="' + band.hi + '"]');
  await sleep(250);
  // 区间两头：没落进去就再抽一批（该尺寸一批命中率大多在八九成）
  const got = await shuffle();
  ok(band.name + '档 → ' + band.hi + '×' + band.hi + ' 分数落进区间',
    got.n === band.hi && got.score >= band.min && got.score < band.max,
    { n: got.n, lvl: got.lvl, score: got.score, batches: got.batches, blocked: got.blocked });
  ok(band.name + '档的档位与分数自洽', toneOk(got), got.lvl + got.score);
}
await closeSheetIfOpen();

/* ---------- 10. 不够格的盘不装：让玩家自己选 ---------- */
console.log('\n[10] 不够格不装盘');
await closeSheetIfOpen();

/* 把出题锁死在 4×4：不管要多大，拿回来的都是 4×4（约 2 分），「困难」永远够不着。
 * 顺手再找一张真够困难的 16×16，留着验证「再抽一次就抽到了」。 */
const good = await page.evaluate(() => {
  const real = window.QueensEngine.generate;
  window.__realGen = real;
  window.__badGen = () => real(4);
  for (let i = 0; i < 200; i++) {
    const b = real(16);
    const v = window.QueensDifficulty.vibe(b.size, b.regions, b.solution);
    if (v.score >= 10.0 && v.score < 11.3) {
      return { size: b.size, seed: b.seed, score: v.score,
        regions: Array.from(b.regions), solution: Array.from(b.solution) };
    }
  }
  return null;
});
ok('测试素材：找得到一张 10–11.3 的 16×16', !!good, good && Math.round(good.score * 10) / 10);

const beforeMm = await snap();
const mmT0 = Date.now();
await page.evaluate(() => {
  __QUEENS_DEBUG__.settings.difficulty = 'hard';
  window.QueensEngine.generate = window.__badGen;
  __QUEENS_DEBUG__.newGame(16);
});
await page.waitForFunction(() => !document.getElementById('mismatch').hidden, { timeout: 30000 });
const mmWait = Date.now() - mmT0;
await sleep(150);
const mm = await page.evaluate(() => ({
  title: document.getElementById('mmTitle').textContent.trim(),
  sub: document.getElementById('mmSub').textContent.trim(),
  need: document.getElementById('mmNeed').textContent.trim(),
  best: document.getElementById('mmBest').textContent.trim(),
  note: document.getElementById('mmNote').textContent.trim(),
  focus: document.activeElement && document.activeElement.id,
  board: __QUEENS_DEBUG__.state.size,
  seed: __QUEENS_DEBUG__.state.seed,
  veil: document.getElementById('veil').hidden
}));
ok('弹出「没抽到够格的盘」', /还不够「困难」/.test(mm.title), mm.title);
/* 这一层现在的触发条件是时间：抽空就弹卡的话，玩家大部分时候都在为
 * 「其实再等半秒就有」的盘点按钮（见 app/puzzle.js 的 SEARCH_MS）。 */
ok('等够了才弹（约 3 秒，不是一抽空就弹）', mmWait >= 2600, mmWait);
ok('说明写清尺寸、找了多久、抽了几张',
  /16×16/.test(mm.sub) && /找了 \d+(\.\d)? 秒/.test(mm.sub) &&
  Number((mm.sub.match(/抽了 (\d+) 张/) || [])[1]) > 4, mm.sub);
ok('读数：档位要求 10.0', mm.need === '10.0', mm.need);
ok('读数：这批最高没够 10.0', parseFloat(mm.best) < 10.0, mm.best);
ok('16×16 已经是困难档最大的盘，就别再劝他挪尺寸了', /能开的最大盘/.test(mm.note), mm.note);
ok('这一盘没装（棋盘与 seed 都是上一盘的）',
  mm.board === beforeMm.n && mm.seed === beforeMm.seed, { now: mm.board, was: beforeMm.n });
ok('生成遮罩已收起', mm.veil === true);
ok('焦点落在「再抽一局」', mm.focus === 'btnMmRetry', mm.focus);
await page.screenshot({ path: SHOTS + 'diff-mismatch.png' });

await page.keyboard.press('Escape');
await sleep(200);
ok('Esc 关不掉（必须做个选择）',
  await page.evaluate(() => !document.getElementById('mismatch').hidden));

const marksBefore = await page.evaluate(() => Array.from(__QUEENS_DEBUG__.state.marks).join(''));
await page.evaluate(() => { const c = document.querySelector('.cell'); if (c) c.click(); });
await sleep(150);
const marksAfter = await page.evaluate(() => Array.from(__QUEENS_DEBUG__.state.marks).join(''));
ok('这一层开着时点不动棋盘', marksBefore === marksAfter);

await jsClick('#btnMmRetry');
await page.waitForFunction(() => !document.getElementById('mismatch').hidden, { timeout: 30000 });
await sleep(150);
const sub2 = await page.evaluate(() => document.getElementById('mmSub').textContent.trim());
const tried2 = (sub2.match(/抽了 (\d+) 张/) || [])[1];
// 再抽一轮也是一整段 3 秒，所以张数只增不减：这条只是确认「累计」没被清零
ok('再抽一轮：累计张数接着往上涨', tried2 && Number(tried2) > 4, sub2);

await jsClick('#btnMmSetup');
await sleep(460);
const setup = await page.evaluate(() => ({
  sheet: !document.getElementById('newWrap').hidden,
  mm: document.getElementById('mismatch').hidden,
  on: Array.from(document.querySelectorAll('.dbtn.is-on')).map(b => b.textContent.trim()),
  val: parseInt(document.getElementById('sizeVal').textContent.trim(), 10),
  chips: Array.from(document.querySelectorAll('#quickRow .qbtn')).map(b => parseInt(b.dataset.size, 10))
}));
ok('「更换设置」打开「新的一局」面板并收起那一层', setup.sheet === true && setup.mm === true, setup);
ok('面板停在他刚才要的档位与尺寸（不是「不限」）',
  setup.on.length === 1 && setup.on[0] === '困难' && setup.val === 16, [setup.on, setup.val]);
ok('面板里能挑的尺寸是 15–16', same(setup.chips, [15, 16]), setup.chips);

/* 换回「真的能出够格盘」的生成器：点一次「再抽一局」就该到手 */
await closeSheetIfOpen();
await page.evaluate(g => {
  window.QueensEngine.generate = () => ({
    size: g.size,
    seed: g.seed,
    regions: g.regions.slice(),
    solution: g.solution.slice(),
    areas: [], minArea: 0, maxArea: 0
  });
}, good);
const landed = await rollOnce(async j => {
  if (j === 0) await page.evaluate(() => __QUEENS_DEBUG__.newGame(16));
});
ok('换回正常出题后一次到手',
  !!landed && landed.n === 16 && landed.score >= 10.0 && landed.score < 11.3, landed);
ok('装上盘后那一层已收起',
  await page.evaluate(() => document.getElementById('mismatch').hidden));
await page.evaluate(() => { window.QueensEngine.generate = window.__realGen; });

/* ---------- 10b. 反过来：一批全都太狠，同样不装 ---------- */
console.log('\n[10b] 超过档位上限也不装');
/* 找一张 10 分以上的 14×14 当素材：较难档（9–14）里这种盘是会抽到的，
 * 上界没卡住的话它就会被当成「较难」装上——这正是这条要堵的口子。 */
const over = await page.evaluate(() => {
  const real = window.QueensEngine.generate;
  for (let i = 0; i < 200; i++) {
    const b = real(14);
    const v = window.QueensDifficulty.vibe(b.size, b.regions, b.solution);
    if (v.score >= 10.0) {
      return { size: b.size, seed: b.seed, score: v.score,
        regions: Array.from(b.regions), solution: Array.from(b.solution) };
    }
  }
  return null;
});
ok('测试素材：找得到一张够 10 分的 14×14', !!over, over && Math.round(over.score * 10) / 10);

const beforeHi = await snap();
await page.evaluate(g => {
  __QUEENS_DEBUG__.settings.difficulty = 'advanced';
  window.QueensEngine.generate = () => ({
    size: g.size, seed: g.seed,
    regions: g.regions.slice(), solution: g.solution.slice(),
    areas: [], minArea: 0, maxArea: 0
  });
  __QUEENS_DEBUG__.newGame(13);
}, over);
await page.waitForFunction(() => !document.getElementById('mismatch').hidden, { timeout: 30000 });
await sleep(150);
const mmHi = await page.evaluate(() => ({
  kicker: document.getElementById('mmKicker').textContent.trim(),
  title: document.getElementById('mmTitle').textContent.trim(),
  sub: document.getElementById('mmSub').textContent.trim(),
  need: document.getElementById('mmNeed').textContent.trim(),
  needLabel: document.getElementById('mmNeedLabel').textContent.trim(),
  best: document.getElementById('mmBest').textContent.trim(),
  bestLabel: document.getElementById('mmBestLabel').textContent.trim(),
  note: document.getElementById('mmNote').textContent.trim(),
  over: document.getElementById('mismatch').classList.contains('is-over'),
  board: __QUEENS_DEBUG__.state.size,
  seed: __QUEENS_DEBUG__.state.seed
}));
ok('卡片标题说「超出了」', /超出了「较难」/.test(mmHi.title), mmHi.title);
ok('英文小标题换成 TOO HARD', mmHi.kicker === 'TOO HARD', mmHi.kicker);
ok('读数改成上限 / 这批最低', mmHi.needLabel === '档位上限' && /^这批最低/.test(mmHi.bestLabel),
  [mmHi.needLabel, mmHi.bestLabel]);
ok('抽到的那张的档位挂在读数上', /困难/.test(mmHi.bestLabel), mmHi.bestLabel);
ok('上限写 10.0', mmHi.need === '10.0', mmHi.need);
ok('这批最低确实超了 10.0', parseFloat(mmHi.best) >= 10.0, mmHi.best);
ok('说明写清尺寸与抽了几张', /13×13/.test(mmHi.sub) && /抽了 \d+ 张/.test(mmHi.sub), mmHi.sub);
ok('建议改成收小一格（12×12）', /12×12/.test(mmHi.note), mmHi.note);
ok('卡片换成「超了」的配色', mmHi.over === true);
ok('这一盘也没装', mmHi.board === beforeHi.n && mmHi.seed === beforeHi.seed,
  { now: mmHi.board, was: beforeHi.n });
await page.screenshot({ path: SHOTS + 'diff-mismatch-over.png' });

await jsClick('#btnMmSetup');
await sleep(460);
const hiSetup = await page.evaluate(() => ({
  sheet: !document.getElementById('newWrap').hidden,
  on: Array.from(document.querySelectorAll('.dbtn.is-on')).map(b => b.textContent.trim()),
  val: parseInt(document.getElementById('sizeVal').textContent.trim(), 10),
  hint: document.getElementById('diffHint').textContent.trim()
}));
ok('「更换设置」停在较难 13×13',
  hiSetup.sheet === true && hiSetup.on[0] === '较难' && hiSetup.val === 13, hiSetup);
ok('设置里写出整段区间（不只是下限）',
  /7\.0/.test(hiSetup.hint) && /10\.0/.test(hiSetup.hint), hiSetup.hint);

await closeSheetIfOpen();
await page.evaluate(() => {
  window.QueensEngine.generate = window.__realGen;
  __QUEENS_DEBUG__.settings.difficulty = 'any';
});

/* ---------- 10c. 极难那一档的窗口是 6 秒（其余 3 秒） ---------- */
console.log('\n[10c] 极难的等待窗口');
const extWait = await page.evaluate(async () => {
  const real = window.QueensEngine.generate;
  window.QueensEngine.generate = () => real(4);   // 永远是 4×4，极难永远够不着
  __QUEENS_DEBUG__.settings.difficulty = 'extreme';
  const t = Date.now();
  __QUEENS_DEBUG__.newGame(16);
  await new Promise((res) => {
    const iv = setInterval(() => {
      if (!document.getElementById('mismatch').hidden) { clearInterval(iv); res(); }
    }, 120);
  });
  const ms = Date.now() - t;
  window.QueensEngine.generate = real;
  return {
    ms: ms,
    need: document.getElementById('mmNeed').textContent.trim(),
    title: document.getElementById('mmTitle').textContent.trim()
  };
});
/* 这一档单张命中率只有 5% 上下，3 秒窗口里一半的局都抽不到，所以单独放宽到 6 秒。
 * 放宽的是「抽多久」，不是「装不装」：等满了照样不装盘。 */
ok('极难等满约 6 秒才弹（不是 3 秒）', extWait.ms >= 5600 && extWait.ms <= 7400, extWait);
ok('这一档的读数是 11.3', /还不够「极难」/.test(extWait.title) && extWait.need === '11.3', extWait);
await page.evaluate(() => {
  __QUEENS_DEBUG__.settings.difficulty = 'any';
  __QUEENS_DEBUG__.newGame(8);
});
await sleep(1200);

/* ---------- 11. 无报错 ---------- */
console.log('\n[11] 运行期报错');
const realErrs = errs.filter(e => !/favicon|ERR_FAILED.*favicon/i.test(e));
ok('无 JS 报错', realErrs.length === 0, realErrs);

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
await browser.close();
process.exit(fail ? 1 : 0);
