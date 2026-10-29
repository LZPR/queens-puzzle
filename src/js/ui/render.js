/* ============================================================================
 * render.js
 * 渲染：把 state 画到 DOM 上（格子状态、描边、连线、色块进度、红框防抖）。
 * ========================================================================== */

import { buzz, sfx } from '../core/audio.js';
import { paintClock } from '../core/clock.js';
import { boardEl, btnClear, btnHint, btnRedo, btnSnap, btnUndo, hudSize, linksEl, queenCountEl,
  queenPill, rbEl, rlBad, rlEl, snapLabel, stepCountEl, stepPill, stepUnitEl } from '../core/dom.js';
import { settings, state, view } from '../core/state.js';
import { pulseClass, svgEl } from '../core/utils.js';
import { cellSize, regionPath } from '../game/geometry.js';
import { FORCED_COL, FORCED_REGION, FORCED_ROW, badRegions, computeAuto, computeConflicts,
  computeForced, queenCount, regionCounts } from '../game/rules.js';
import { updateHint } from './hint.js';
import { syncLives } from './lives.js';
import { paintHudLabel } from './difficulty.js';
import { updateWater } from './effects.js';
import { fadeCell, settleFade } from './fade.js';

/* ==========================================================
   渲染
   ========================================================== */
export function render(anim) {
  var n = state.size;
  /* 自动打 × / 唯一位置提示现在是**这一局的规矩**（state.*），不再是设置里的偏好：
   * 每日挑战里前一颗由玩家自己挑、后一颗锁死为关，而玩家自己的设置可能都开着
   * （见 core/state.js）。 */
  var auto = state.autoMark ? computeAuto() : new Uint8Array(n * n);
  var cf = computeConflicts();
  var forced = state.forced ? computeForced(auto) : new Uint8Array(n * n);
  var showConflict = settings.conflict;
  var counts = regionCounts();

  state.auto = auto;
  state.conflicts = cf;
  state.regionCounts = counts;
  // 整块被 × 填满却没皇后的色块：棋盘描红边、色卡打叉，两处一起说同一件事。
  // 注意这里只是「算出实情」，亮不亮由 syncBad 按 1s 防抖决定（见 drawBadRegions 上方）
  var bad = state.status === 'playing' ? badRegions(auto) : [];
  state.badRegions = bad;

  /* 步数按格记账（2026-10-29）：一格从「空 / 手标 × / 自动 × / 皇后」变成另一种，
   * 就是一步。放在 render 里而不是各个动作里，是因为**棋盘变化只有这一条路**：
   * 拖拽涂抹、单击、双击落子、清空、一键补齐最后都走到这儿，
   * 连「放一只皇后带出来的一片自动 ×」也自然算进去了。
   * 撤销 / 重做 / 还原记录点 / 判错作废走 renderQuiet()，它们不算步。 */
  var flips = 0;

  for (var i = 0; i < n * n; i++) {
    var cell = view.cells[i];
    var mark = state.marks[i];
    var s = mark === 2 ? 'q' : mark === 1 ? 'x' : auto[i] ? 'a' : '';
    var prev = view.lastStates[i];
    var g = state.regions[i];

    cell.classList.toggle('is-q', s === 'q');
    cell.classList.toggle('is-x', s === 'x');
    cell.classList.toggle('is-auto', s === 'a');
    cell.classList.toggle('r-over', counts[g] > 1);
    cell.classList.toggle('is-conflict', showConflict && cf.cells.has(i));
    cell.classList.toggle('is-forced', forced[i] !== 0);

    /* 淡化：刚变过的这一格先亮着，手停下来 0.5 秒后才整盘一起淡
     * （见 ui/fade.js；淡成什么样在 styles/base/board-states.css 里） */
    fadeCell(cell, i, s !== prev);

    if (anim) {
      if (s === 'q' && prev !== 'q') {
        pulseClass(cell, 'drop', 520);
      } else if (s === 'x' && prev === '') {
        cell.style.setProperty('--stamp-delay', '0ms');
        pulseClass(cell, 'stamp', 400);
      } else if (s === 'a' && prev === '' && anim.from != null) {
        var fr = (anim.from / n) | 0, fc = anim.from % n;
        var rr = (i / n) | 0, cc = i % n;
        var dist = Math.max(Math.abs(fr - rr), Math.abs(fc - cc));
        var delay = Math.min(8, dist) * 26;
        cell.style.setProperty('--stamp-delay', delay + 'ms');
        cell.classList.remove('stamp');
        void cell.offsetWidth;
        cell.classList.add('stamp');
        (function (el) {
          window.setTimeout(function () { el.classList.remove('stamp'); }, delay + 420);
        })(cell);
      }
    }

    // aria
    var label = '第' + (((i / n) | 0) + 1) + '行第' + ((i % n) + 1) + '列，色块' +
      (g + 1) + '，' +
      (s === 'q' ? '皇后' : s === 'x' ? '叉' : s === 'a' ? '自动标记' : '空');
    if (cf.cells.has(i)) label += '，冲突';
    if (forced[i]) {
      var fw = [];
      if (forced[i] & FORCED_REGION) fw.push('色块');
      if (forced[i] & FORCED_ROW) fw.push('这一行');
      if (forced[i] & FORCED_COL) fw.push('这一列');
      label += '，' + fw.join('、') + '都只剩这一格可填';
    }
    cell.setAttribute('aria-label', label);
    cell.setAttribute('aria-selected', s === 'q' ? 'true' : 'false');

    if (s !== prev) flips++;
    view.lastStates[i] = s;
  }

  /* 记步：只在真变了、且不是「回到走过的位置」那几条路上才加。
   * 换盘时 buildBoard 会把 lastStates 清成空串，所以装上的一盘一格都不记。 */
  if (flips && !view.quietSteps) state.steps += flips;

  settleFade();

  // 色块进度条
  for (var g2 = 0; g2 < view.chips.length; g2++) {
    view.chips[g2].classList.toggle('is-done', counts[g2] === 1);
    view.chips[g2].classList.toggle('is-over', counts[g2] > 1);
    view.chips[g2].classList.toggle('is-bad', badShown.indexOf(g2) >= 0);
  }

  syncBad(bad);

  drawLinks(showConflict ? cf : { pairs: [], cells: new Set(), count: 0 });
  updateHint();
  updateStats();
  /* 水面（外观里的背景那一档）：水位跟着棋盘的填充程度走。
   * 放在这里是因为「棋盘变了」只有这一条路 —— 落子 / 涂抹 / 撤销 / 重做 /
   * 一键补齐 / 换盘最后都走到 render()。没开水面时它什么都不做。 */
  updateWater();

  if (anim && cf.count > view.lastConflictCount) {
    sfx('conflict');
    buzz([28, 46, 28]);
  }
  view.lastConflictCount = cf.count;
}

/* ---- 不记步数地画一遍 ----
 * 撤销 / 重做 / 还原记录点 / 判错作废会改棋盘，但它们是「回到走过的位置」，
 * 不该涨步数（口径见 core/state.js 的 state.steps）。
 * 用计数器包一层而不是传参数：调用点散在 app/ 里，改参数要逐个签名跟着动。 */
export function renderQuiet(anim) {
  view.quietSteps++;
  try {
    render(anim);
  } finally {
    view.quietSteps--;
  }
}

/* ---- 色块描边 ----
 * 把「上下 / 左右不是同块」的边全都找出来，同一条直线上的连续边合并成一笔
 * （M x1 y L x2 y），整盘只用一条 path。
 * 合并的意义：拐角处不再由两个格子各画半截，而是同一笔连续画过去；
 * 竖横交汇的两个端点靠 stroke-linecap:square 各伸出半线宽叠在一起，缝就没了。 */
export function drawRegionBorders() {
  if (!rbEl) return;
  var n = state.size, regions = state.regions;
  var cell = parseFloat(getComputedStyle(boardEl).getPropertyValue('--cell')) || 0;
  rbEl.innerHTML = '';
  if (!regions || !cell || regions.length < n * n) return;

  var size = n * cell;
  rbEl.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  rbEl.setAttribute('width', String(size));
  rbEl.setAttribute('height', String(size));

  var d = '', r, c, start, on;
  // 横边：第 r 行与第 r-1 行之间
  for (r = 1; r < n; r++) {
    start = -1;
    for (c = 0; c <= n; c++) {
      on = c < n && regions[r * n + c] !== regions[(r - 1) * n + c];
      if (on && start < 0) start = c;
      else if (!on && start >= 0) {
        d += 'M' + (start * cell) + ' ' + (r * cell) +
          'L' + (c * cell) + ' ' + (r * cell);
        start = -1;
      }
    }
  }
  // 竖边：第 c 列与第 c-1 列之间
  for (c = 1; c < n; c++) {
    start = -1;
    for (r = 0; r <= n; r++) {
      on = r < n && regions[r * n + c] !== regions[r * n + c - 1];
      if (on && start < 0) start = r;
      else if (!on && start >= 0) {
        d += 'M' + (c * cell) + ' ' + (start * cell) +
          'L' + (c * cell) + ' ' + (r * cell);
        start = -1;
      }
    }
  }
  if (d) rbEl.appendChild(svgEl('path', { d: d }));
}

var lastBadSig = '';

/* ---- 红框防抖 ----
 * 双击放皇后时，第一下先把这一格打成 ×、第二下才落子：中间那几十毫秒里，
 * 这块可能刚好被划满 × 且没有皇后，红框就会闪一下又消失 —— 明明没做错事。
 * 所以「变错」要等够 BAD_DELAY 才算数（期间局面再变就重新等），
 * 而「不再错」立刻收回：宁可晚一点提醒，也不让红框多留一帧。 */
var BAD_DELAY = 1000;
var badShown = [];      // 已经亮在棋盘上的那几块
var badPending = null;  // 正在等计时的那几块
var badTimer = 0;
var badVisible = false; // 红框此刻是不是亮的（亮灭交给 #rlBad.is-on 过渡）

function sameBad(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* 亮灭都走同一条 .16s 的 opacity 过渡：灭的时候 DOM 留在原地，透明就看不见了。
   这样「同一块又错了」时不必重建 path，淡入直接从 0 起，不会闪。 */
function paintBad(list) {
  if (!list || !list.length) {
    if (badVisible) {
      badVisible = false;
      rlBad.classList.remove('is-on');
    }
    return;
  }
  drawBadRegions(list);
  if (!badVisible) {
    badVisible = true;
    // 先让「画好但透明」这一帧落地，再上 is-on，过渡才会真的播出来
    rlBad.getBoundingClientRect();
    rlBad.classList.add('is-on');
  }
}

function applyBad(list) {
  badShown = list.slice();
  state.badShown = badShown;
  for (var i = 0; i < view.chips.length; i++) {
    view.chips[i].classList.toggle('is-bad', badShown.indexOf(i) >= 0);
  }
  var wasVisible = badVisible;
  paintBad(badShown);
  // 亮起来的那一下才震：这是「这块已经摆不下了」的唯一触觉信号
  if (!wasVisible && badVisible && list.length) buzz([14, 46, 14]);
}

function syncBad(list) {
  if (!list.length) {
    // 不再错：立即收回，并取消还没到点的提醒
    if (badTimer) { window.clearTimeout(badTimer); badTimer = 0; }
    badPending = null;
    if (badShown.length) applyBad([]);
    return;
  }
  if (badVisible && sameBad(list, badShown)) {
    // 已经亮着、且就是这几块：等着的那次提醒作废
    if (badTimer) { window.clearTimeout(badTimer); badTimer = 0; }
    badPending = null;
    return;
  }
  // 同一批还在等：别重新计时，否则一直动就一直不提醒
  if (badTimer && sameBad(list, badPending)) return;
  if (badTimer) window.clearTimeout(badTimer);
  badPending = list.slice();
  badTimer = window.setTimeout(function () {
    badTimer = 0;
    var fire = badPending || [];
    badPending = null;
    applyBad(fire);
  }, BAD_DELAY);
}

export function resetBad() {
  if (badTimer) { window.clearTimeout(badTimer); badTimer = 0; }
  badPending = null;
  badShown = [];
  state.badShown = [];
  badVisible = false;
  if (rlBad) {
    rlBad.classList.remove('is-on');
    rlBad.innerHTML = '';
  }
  lastBadSig = '';
}

function drawBadRegions(list) {
  if (!rlBad) return;
  var n = state.size, cell = cellSize();
  // 没变就不重画：path 一样的重建会把呼吸动画从头拨一遍，看着像抽了一下
  var sig = (list || []).join(',') + '|' + cell + '|' + n;
  if (!cell || !state.regions || !list || !list.length) {
    rlBad.innerHTML = '';
    lastBadSig = '';
    return;
  }
  if (sig === lastBadSig) return;
  lastBadSig = sig;
  rlBad.innerHTML = '';

  var size = n * cell;
  rlEl.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  rlEl.setAttribute('width', String(size));
  rlEl.setAttribute('height', String(size));

  var lw = cell < 26 ? 2.8 : 3.4;
  for (var i = 0; i < list.length; i++) {
    var d = regionPath(n, state.regions, list[i], cell);
    if (!d) continue;
    rlBad.appendChild(svgEl('path', { d: d, 'class': 'rl-bad-fill' }));
    rlBad.appendChild(svgEl('path', { d: d, 'class': 'rl-bad-halo', 'stroke-width': lw * 3.4 }));
    rlBad.appendChild(svgEl('path', { d: d, 'class': 'rl-bad-line', 'stroke-width': lw }));
  }
}

export function drawLinks(cf) {
  var n = state.size;
  var cell = parseFloat(getComputedStyle(boardEl).getPropertyValue('--cell')) || 0;
  var size = n * cell;
  linksEl.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  linksEl.setAttribute('width', String(size));
  linksEl.setAttribute('height', String(size));
  linksEl.innerHTML = '';

  for (var i = 0; i < cf.pairs.length; i++) {
    var p = cf.pairs[i];
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(p.a.c * cell + cell / 2));
    line.setAttribute('y1', String(p.a.r * cell + cell / 2));
    line.setAttribute('x2', String(p.b.c * cell + cell / 2));
    line.setAttribute('y2', String(p.b.r * cell + cell / 2));
    linksEl.appendChild(line);
  }
}

export function updateStats() {
  var total = state.size;
  var q = queenCount();
  var playing = state.status === 'playing';
  queenCountEl.textContent = q + '/' + total;
  queenPill.classList.toggle('is-full', q === total && playing);
  hudSize.textContent = total + '×' + total;

  /* 步数：这一局一共落了几次笔（读 state.steps）。撤销栈封顶 60、刷新还会清空，
   * 拿它当读数会越玩越不像话；这个数不封顶，也跟着存档走。
   * 开了步数限制就把尾缀换成 /60，剩余不多时整段转红。 */
  var st = state.steps || 0;
  stepCountEl.textContent = String(st);
  stepUnitEl.textContent = state.stepLimit ? '/' + state.stepLimit : '步';
  stepPill.classList.toggle('is-zero', st === 0);
  /* 窄屏上「步」这个字会被让出去（见 responsive.css），但 /60 这种上限得留着：
   * 少了它，玩家只看见「57」不知道自己还剩几步 */
  stepPill.classList.toggle('has-limit', state.stepLimit > 0);
  var leftSteps = state.stepLimit ? Math.max(0, state.stepLimit - st) : 0;
  stepPill.classList.toggle('is-low',
    state.stepLimit > 0 && playing && leftSteps <= 5);
  stepPill.title = !st
    ? '还没有动手'
    : '这一局走了 ' + st + ' 步' +
      (state.stepLimit ? '（限步 ' + state.stepLimit + '，还剩 ' + leftSteps + ' 步）' : '') +
      ' · 可撤销 ' + view.undo.length + ' 步';

  paintHudLabel();

  /* 挑战里禁用的按钮跟「暂时没得撤」是两回事：
   * 前者要多一句话说明为什么点了没反应，所以单独挂 is-locked + title。 */
  btnUndo.disabled = state.noUndo || view.undo.length === 0;
  btnUndo.classList.toggle('is-locked', !!state.noUndo);
  btnUndo.setAttribute('title', state.noUndo ? '挑战模式：这局不能撤销' : '撤销（Z）');
  /* 重做跟撤销同一套读法：判据从「有得撤」换成「有得重做」（view.redo 在
   * 新的一笔落下时就被 pushEntry 清空，所以「改了主意」这条路自然断开）。 */
  btnRedo.disabled = state.noUndo || view.redo.length === 0;
  btnRedo.classList.toggle('is-locked', !!state.noUndo);
  btnRedo.setAttribute('title', state.noUndo ? '挑战模式：这局不能重做' : '重做（Shift+Z）');
  btnHint.disabled = !playing || state.noHint;
  btnHint.classList.toggle('is-locked', !!state.noHint);
  btnHint.setAttribute('title', state.noHint ? '挑战模式：这局不能用提示' : '提示（H）');
  btnClear.disabled = !playing;

  syncSnap(playing);

  /* 命数（挑战「标错惩罚」）：惩罚没开时这一条整块收起来，棋盘一像素都不挪。
   * 这里只负责「画成什么样」，碎心那一下由 ui/lives.js 自己在扣命时点名播。 */
  syncLives();

  paintClock();
}

/* ---- 记录点那一颗 ----
 * 两副面孔：空着 = 白底「记录」，记下了 = 墨底「还原」（外加图标填实）。
 * 靠 state.snap 一个字段判断，别在按钮上另存一份。
 * 挑战「禁用记录点」跟「禁用提示 / 撤销」同一个读法：灰掉 + 斜纹 + 一句为什么。 */
function syncSnap(playing) {
  if (!btnSnap) return;
  var filled = !!state.snap;
  var locked = !!state.noSnap;
  btnSnap.classList.toggle('is-filled', filled);
  btnSnap.classList.toggle('is-locked', locked);
  btnSnap.disabled = locked || !playing;
  btnSnap.setAttribute('aria-pressed', filled ? 'true' : 'false');
  if (snapLabel) snapLabel.textContent = filled ? '还原' : '记录';
  btnSnap.setAttribute('aria-label', locked
    ? '记录点（本局被挑战禁用）'
    : filled ? '还原到记录点，按住可清空' : '记下这一刻');
  btnSnap.setAttribute('title', locked
    ? '挑战模式：这局不能用记录点'
    : filled ? '回到记下的那一刻（S）· 按住清空（Shift+S）' : '记下这一刻（S）');
}

/** 布局重排后，如果红框正亮着，按新格子尺寸重画（否则横屏一转就错位）。 */
export function refreshBad() {
  if (badVisible) drawBadRegions(state.badShown || []);
}
