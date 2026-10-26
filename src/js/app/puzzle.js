/* ============================================================================
 * puzzle.js
 * 出题与换盘：按目标难度夹尺寸、挑出落进档位区间的一张、生成遮罩、把棋盘装上。
 * ========================================================================== */

import { sfx } from '../core/audio.js';
import { DIFF_BANDS, limitLabel, SIZE_MAX, SIZE_MIN } from '../core/config.js';
import { dayKey, ruleOf, rulesFor } from '../core/daily.js';
import { boardEl, veil, veilTitle } from '../core/dom.js';
import { guide, settings, state, view } from '../core/state.js';
import { save, saveSettings } from '../core/storage.js';
import { announce, clamp } from '../core/utils.js';
import { buildDaily } from './daily.js';
import { buildBoard, buildRegionBar } from '../game/board.js';
import { computeVibe } from '../game/vibe.js';
import { updateDiffChip } from '../ui/difficulty.js';
import { closeGuide, paintGl } from '../ui/guide.js';
import { flashHint } from '../ui/hint.js';
import { relayout } from '../ui/layout.js';
import { render, resetBad, updateStats } from '../ui/render.js';
import { clearTrace } from '../ui/trace.js';
import { closeSheet, isOpen } from '../core/sheet.js';
import { dismissMismatch, showMismatch } from '../ui/panels/mismatch.js';

/* ==========================================================
   新一局
   ----------------------------------------------------------
   尺寸由玩家在「目标难度」开放的区间里挑（见 DIFF_BANDS），这里只负责夹一次；
   然后一张一张抽，抽到分数落进 [min, max) 的就装。抽不到就一直抽，
   最多给这轮 3 秒（见 SEARCH_MS）；3 秒都没抽到才不装盘，反过来问玩家
   「再抽一局 / 更换设置」——见下面的 roll()。
   出题是同步的：算的时候主线程被占住，动画也会冻住，所以遮罩只是「告知」，
   不是「装饰」。快的时候根本不该出现——见 showVeil 的 delay；
   慢的时候每 CHUNK_MS 让出一帧，读数和动画才不会停在第一帧。
   ========================================================== */
var veilTimer = 0;

/* 每个尺寸单张生成实际阻塞了多久（生成 + 难度分析）。
 * 没测过就按 n^2.4 估：8×8≈2.5ms、16×16≈13ms —— 宁可估小，
 * 估小了最多是「该露遮罩时没露」，估大了会在快机器上每次都闪一下。 */
var blockCost = {};
function estBlock(n) {
  if (blockCost[n]) return blockCost[n];
  return Math.pow(Math.max(n, 4) / 8, 2.4) * 2.5;
}
/* 遮罩什么时候露：
 *   单张生成本身就慢（实测/估算 ≥ 90ms）→ 0，立刻露脸且不做淡入；
 *   否则给个拖延（默认 90ms，挑盘时 260ms）——比这还快就当没这回事。
 * 挑盘那条（有目标难度）等得更久：一轮最长 3 秒，但「抽两张就中」才是常态，
 * 摊上三四百毫秒的局也不少，90ms 就露会让遮罩看着闪了一下。 */
export function veilDelayFor(n, quiet) {
  if (estBlock(n) >= 90) return 0;
  return quiet || 90;
}

/* delay>0：先等一会儿再露脸，算得快就当没这回事（避免闪一下）。
 * delay=0 ：立刻露脸，用于确定会卡住的场合，此时关掉淡入动画——
 *           淡入是靠主线程跑的，一阻塞就会停在半透明那一帧。 */
export function showVeil(n, label, delay) {
  veilTitle.textContent = label || ('正在生成 ' + n + '×' + n + ' 谜题');
  window.clearTimeout(veilTimer);
  veil.classList.toggle('is-instant', !delay);
  if (delay > 0) {
    veil.hidden = true;
    veilTimer = window.setTimeout(function () { veil.hidden = false; }, delay);
  } else {
    veil.hidden = false;
  }
}

export function hideVeil() {
  window.clearTimeout(veilTimer);
  veil.hidden = true;
}

function targetBand() {
  var t = settings.difficulty;
  return t && t !== 'any' && DIFF_BANDS[t] ? DIFF_BANDS[t] : null;
}

/* ------------------------------------------------------------ 挑盘
 * 一张一张抽，落进 [min, max) 的就装。引擎本来每局就要抽 2~3 张
 * （挑色块最均匀的那张），所以平均成本基本不变；度量本身是 1ms 级，
 * 瓶颈始终在生成。
 *
 * 为什么不在引擎里挑：engine.js 是独立 UMD，引用 difficulty.js 会破坏分层、
 * 也拖慢引擎。这里是 app 层，两边都看得见，正合适。
 *
 * band 为 null（不限难度）时只生成一张就走。
 *
 * 两头都不够格不是「失败」——这时**先别问玩家，自己接着抽**（见 search()）。
 * 单张落进档内的概率只有二到五成（8×8 的困难盘只有约一成），一抽空就弹卡的话，
 * 玩家大部分时候都要为一个「其实再等半秒就有」的盘去点一下鼠标。
 * 时间才是他唯一有直觉的尺度：给这轮 3 秒，抽到了就当没这回事。
 *
 * 真等满了还没抽到，才**不装盘**，交给 mismatch 层问玩家要不要再抽
 * （见 ui/panels/mismatch.js）；凑合装上去，目标难度就名存实亡。
 * 上界同样要卡：只卡下限的话，选「困难」会掉出一盘 8.6 的极难盘。
 * 那一层拿到的读数是「离区间最近」的那一头 —— 偏低报最高、偏高报最低。
 *
 * 一轮下来累计抽了多少张（acc.draws）只为了给那一层照实报个数，
 * 不再是收手的条件：收手看时间。
 */
var SEARCH_MS = 3000;

/* 每占住主线程这么久就让出一帧：遮罩上的读数才刷得出来、动画才走得动，
 * 也不至于长到浏览器想报「页面无响应」。单张生成本身就超过这个数的
 * （16×16 约 150ms）就一张一让。 */
var CHUNK_MS = 110;

/* 这一轮的编号：roll() 每次自增。玩家中途又换了一局时，上一轮的定时器
 * 醒来发现编号变了就自己收手，不会把旧盘装到新局上。 */
var rollToken = 0;

/* 抽一张，按分数分到三条路上：
 *   落进 [min, max)  → 返回 { board, vibe }，这一轮就可以收了
 *   偏低 / 偏高      → 记下「这头最接近区间的那张」，返回 null，接着抽
 * 全部张数记在 acc.draws；band 为空时第一张就返回（不限难度没什么可挑的）。 */
function drawOne(n, band, acc) {
  var b = null;
  try { b = window.QueensEngine.generate(n); } catch (e) { return null; }
  if (!b) return null;
  acc.draws++;
  var v = computeVibe(b.size, b.regions, b.solution);
  if (!v) return { board: b, vibe: null };
  if (!band) return { board: b, vibe: v };
  if (v.score >= band.max) { if (!acc.over || v.score < acc.over.score) acc.over = v; return null; }
  if (v.score < band.min) { if (!acc.under || v.score > acc.under.score) acc.under = v; return null; }
  return { board: b, vibe: v };
}

/* 抽得比预想的久：遮罩上照实说一声还在抽，免得玩家以为卡死了。 */
function saySearching(n, band, draws) {
  veilTitle.textContent = (band
    ? '正在生成「' + band.name + '」' + n + '×' + n
    : '正在生成 ' + n + '×' + n + ' 谜题') + ' · 已抽 ' + draws + ' 张';
}

/* 一直抽，直到：抽到够格的 / 时间用完 / 又换了一局。
 * 每 CHUNK_MS 还一帧，这一帧里浏览器能刷遮罩、能画动画。 */
function search(n, band, acc, token, done) {
  var soft = performance.now() + CHUNK_MS;
  var before = acc.draws;                       // 这一截开始时已经抽掉的张数
  for (;;) {
    if (token !== rollToken) return;            // 又换了一局，这一轮作废
    var got = drawOne(n, band, acc);
    if (got) return done(got);
    var now = performance.now();
    if (now >= acc.deadline) return done(null); // 等够了，交给那一层去问玩家
    if (now < soft) continue;
    /* 整整一截一张都没生成出来（引擎连着抛错）：那是真失败，别干等 3 秒 */
    if (acc.draws === before) return done(null);
    saySearching(n, band, acc.draws);
    window.setTimeout(function () { search(n, band, acc, token, done); }, 0);
    return;
  }
}

/* 一张都没落进区间：报「离区间最近」的那一头（正好两边都有就取更近的），
 * 那一层据此说「最高 6.8，还差点」还是「最低 8.6，超了」。 */
function nearest(acc, band) {
  if (!band) return null;
  if (acc.under && acc.over) {
    return band.min - acc.under.score <= acc.over.score - band.max
      ? { vibe: acc.under, dir: 'low' } : { vibe: acc.over, dir: 'high' };
  }
  if (acc.under) return { vibe: acc.under, dir: 'low' };
  if (acc.over) return { vibe: acc.over, dir: 'high' };
  return null;
}

export function newGame(size) {
  var band = targetBand();
  var n = clamp(size || state.size, SIZE_MIN, SIZE_MAX);
  // 选了档位就只在这个档开放过的尺寸里出题（4×4 不可能难，16×16 也不会容易）
  if (band) n = clamp(n, band.lo, band.hi);
  roll(n, band, 0);
}

/* 上一次出题的实际读数：花了多久、抽了几张、最后有没有装上。
 * 只给 tools/ 里的自动化测试用（main.js 挂在 __QUEENS_DEBUG__.rollInfo 上）。 */
var lastRollInfo = null;
export function lastRoll() { return lastRollInfo; }

/* 出一盘：抽到够格的装上；等满 SEARCH_MS 还没抽到，才摆出两条路让玩家选。
 * tried 是「这次换局之前已经抽掉多少张」——再抽时累加上去，
 * 好让那一层照实说「13×13 找了 3.0 秒、抽了 26 张」。 */
function roll(n, band, tried) {
  if (isOpen('result')) closeSheet('result', { force: true });
  dismissMismatch();
  boardEl.classList.remove('is-won', 'is-lost');

  var token = ++rollToken;
  var t0 = performance.now();
  var acc = { draws: 0, under: null, over: null, deadline: t0 + SEARCH_MS };
  // 已知这一档会卡就立刻露遮罩，否则先等一会儿——算得快就当没这回事
  var heavy = !!band || n >= 13;
  if (heavy) {
    showVeil(n, band ? '正在生成「' + band.name + '」' + n + '×' + n : null,
      veilDelayFor(n, band ? 260 : 90));
  }
  /* 出题期间棋盘只读：遮罩挡得住鼠标，挡不住键盘，
   * 不然手快的人能在旧盘上落子、或者把「新的一局」面板压到换盘之前。 */
  view.rolling = true;

  var done = function (got) {
    if (token !== rollToken) return;    // 这一轮已被后来的一局顶掉
    view.rolling = false;

    var cost = Math.round(performance.now() - t0);
    lastRollInfo = { size: n, ms: cost, draws: acc.draws, ok: !!got };
    /* 记下单张的大致成本（不是这一轮的总时长）：下次同尺寸靠它决定要不要
     * 提前露遮罩。按总时长记的话，一次抽空花掉的 3 秒会让之后每一局
     * 都立刻闪出一层遮罩。 */
    blockCost[n] = Math.max(blockCost[n] || 0, Math.round(cost / Math.max(acc.draws, 1)));

    if (!got) {
      hideVeil();
      var off = nearest(acc, band);
      // 有 band 时至少抽过一张就会有 off；没有就是真生成失败
      if (!off) { flashHint('生成失败，请再试一次'); return; }

      /* 等满时间还没抽到：这一盘不装。
       * 尺寸和档位都在 allowed 范围内，只是手气不好——玩家说了算：
       * 再抽一轮，还是换个尺寸/档位。dir 说明是「不够」还是「超了」，
       * 那一层的标题、读数、建议都跟着这个走。 */
      showMismatch({
        size: n,
        band: band,
        difficulty: settings.difficulty,
        dir: off.dir,
        vibe: off.vibe,
        tried: tried + acc.draws,
        waited: cost,
        onRetry: function () { roll(n, band, tried + acc.draws); }
      });
      return;
    }

    applyBoard(got.board.size, got.board.regions, got.board.solution, got.board.seed, got.vibe);

    if (n >= 13 && cost > 320) {
      flashHint('这局生成用了 ' + (cost / 1000).toFixed(1) + ' 秒', true, 1400);
    }
    sfx('new');
    announce('新一局：' + got.board.size + '×' + got.board.size +
      (band ? '，目标难度' + band.name : '') + '，每行每列每个色块各一只皇后');
  };

  if (heavy) {
    window.requestAnimationFrame(function () {
      window.setTimeout(function () { search(n, band, acc, token, done); }, 30);
    });
  } else {
    search(n, band, acc, token, done);
  }
}

/* 把一副已经确定的棋盘装上（新生成 / 载入分享码 / 恢复存档 / 重试 / 每日挑战共用）。
 *
 * rules 是「这一局的规矩」：限时 / 步数 / 命数 / 三把禁用的锁 / 是不是每日挑战。
 * 不传就照 settings 抄（自定义开新局的常规路径）。传了就不碰 settings ——
 * 每日挑战的规矩是写死的，不该顺手改写玩家自己的偏好。
 * 之所以要把 noHint / noUndo / noSnap 也收进 state：那三样以前直接读 settings，
 * 每日挑战一开就会把玩家的设置顶掉。 */
export function applyBoard(n, regions, solution, seed, preVibe, rules) {
  if (isOpen('result')) closeSheet('result', { force: true });
  dismissMismatch();   // 真装上了，那张「不够格」的卡就不该还挂着
  /* 手上这一盘由别人（分享码 / 存档 / 重试 / 每日挑战）拍板了：还在抽的那一轮立刻作废，
   * 否则几秒后它醒来会把刚装上的盘又顶掉。 */
  rollToken++;
  view.rolling = false;
  if (guide.open) closeGuide();
  paintGl(null);
  resetBad();          // 上局的红框 / 待提醒计时一起作废
  boardEl.classList.remove('is-won', 'is-lost');

  var r = rules || null;

  state.size = n;
  state.seed = seed || 0;
  state.regions = regions;
  state.solution = solution;
  state.vibe = preVibe || computeVibe(n, regions, solution);
  state.marks = new Uint8Array(n * n);
  state.hints = 0;
  state.moves = 0;
  state.steps = 0;
  state.elapsed = 0;
  state.runningSince = 0;
  state.status = 'playing';
  state.lostBy = null;
  state.focus = 0;
  state.lastTap = null;
  /* 记录点是「这一刻的这张盘」上的锚点：换上另一张盘就没有意义了，
   * 一律清掉（按钮随之回到「记录」）。 */
  state.snap = null;
  state.conflicts = { pairs: [], cells: new Set(), count: 0 };
  state.forced = null;
  // 记下这盘实际用到的难度档，用来判断设置面板里选的东西「是否还没生效」
  state.diffApplied = settings.difficulty;
  /* 挑战：限时从这一局的第一笔操作起算（新局 / 重试都把起算点归零）；
   * 步数限制看的是这一局走了几步，也一并从设置里取；
   * 命数同理——重试这一局就是把命补满，不是接着上回剩下的往下扣。
   * 有 rules 就按 rules（每日挑战），没有才照设置抄。 */
  state.limit = r ? (r.timeLimit || 0) : (settings.timeLimit || 0);
  state.limitFrom = 0;
  state.stepLimit = r ? (r.stepLimit || 0) : (settings.stepLimit || 0);
  state.lifeLimit = r ? (r.lifeLimit || 0) : (settings.lifeLimit || 0);
  state.lives = state.lifeLimit;
  state.noHint = r ? !!r.noHint : !!settings.noHint;
  state.noUndo = r ? !!r.noUndo : !!settings.noUndo;
  state.noSnap = r ? !!r.noSnap : !!settings.noSnap;
  state.daily = r && r.daily ? r.daily : null;
  view.lastConflictCount = 0;
  view.undo = [];
  view.redo = [];
  /* 换盘 / 重试 / 载入分享码：上一步的残影是「那张盘上的一件事」，
   * 跟着撤销栈一起清掉（clean 之后 buildBoard 又会重建格子，类名本来也不在了） */
  clearTrace();
  /* 上一局可能还有一串「补齐」在落子：换盘时把锁解开，
   * 那一串自己会发现 state.marks 已经不是它记的那个数组，随即收手。 */
  view.filling = false;
  view.lastFinish = null;   // 上一局的成绩别飘到这一局的结果卡上

  /* 每日挑战不改写玩家自己的偏好（尺寸 / 难度 / 挑战那几项都是写死的），
   * 所以 settings.size 只在自定义开局时跟着走。 */
  if (!r) {
    settings.size = n;
    saveSettings();
  }

  buildBoard(true);
  buildRegionBar();
  relayout();
  render();
  hideVeil();
  updateStats();
  updateDiffChip();
  save();
}

/* 重试这一局：同一盘棋原样重开（不重新出题），用时、标记、撤销栈一起归零。
 * 限时的那局重试后重新计时——挑战里输了不该被按住不动。
 * 每日挑战重试还是那一盘，而且仍然算在同一个日期 / 档位上（否则解开了也不记账）。 */
export function retryGame() {
  if (!state.regions) { newGame(state.size); return; }
  var rules = state.daily ? {
    timeLimit: state.limit,
    stepLimit: state.stepLimit,
    lifeLimit: state.lifeLimit,
    noHint: state.noHint,
    noUndo: state.noUndo,
    noSnap: state.noSnap,
    daily: state.daily
  } : null;
  applyBoard(state.size, state.regions, state.solution, state.seed, state.vibe, rules);
  var msg = state.limit ? '重新开始，限时 ' + limitLabel(state.limit) : '重新开始这一局';
  flashHint(msg, true, 2000);
  announce(msg);
}

/* ==========================================================
   每日挑战
   ----------------------------------------------------------
   棋盘由 app/daily.js 按「日期 + 档位」算种子生成，同一档永远是同一盘。
   出题这几百毫秒里棋盘同样只读（view.rolling），跟 roll() 一个规矩：
   遮罩挡得住鼠标，挡不住键盘。
   ========================================================== */
export function newDaily(tier) {
  var rule = ruleOf(tier);
  if (!rule) return;
  var day = dayKey();
  var band = DIFF_BANDS[tier];

  if (isOpen('result')) closeSheet('result', { force: true });
  dismissMismatch();
  boardEl.classList.remove('is-won', 'is-lost');

  var token = ++rollToken;
  var t0 = performance.now();
  /* 大棋盘光出一张就要上百毫秒，遮罩得立刻露脸（delay=0）；
   * 小棋盘先等 90ms，算得快就当没这回事。 */
  showVeil(rule.size, '正在准备今日挑战 · ' + band.name, veilDelayFor(rule.size, 90));
  view.rolling = true;

  var run = function () {
    if (token !== rollToken) return;          // 期间又换了一局，这一轮作废
    var got = buildDaily(tier, day);
    if (token !== rollToken) return;
    view.rolling = false;
    if (!got) {
      hideVeil();
      flashHint('生成失败，请再试一次');
      return;
    }
    var taken = Math.round(performance.now() - t0);
    blockCost[rule.size] = Math.max(blockCost[rule.size] || 0, taken);

    applyBoard(got.board.size, got.board.regions, got.board.solution,
      got.board.seed, got.vibe, rulesFor(day, tier));

    sfx('new');
    announce('今日挑战：' + band.name + ' ' + rule.size + '×' + rule.size +
      '，限时 ' + limitLabel(rule.limit) + '，一天只有这一盘');
    if (rule.size >= 13 && taken > 320) {
      flashHint('这局生成用了 ' + (taken / 1000).toFixed(1) + ' 秒', true, 1400);
    }
  };

  /* 先让遮罩画出来再做重活：直接算的话那一层要等到算完才出现 */
  window.requestAnimationFrame(function () {
    window.setTimeout(run, 30);
  });
}
