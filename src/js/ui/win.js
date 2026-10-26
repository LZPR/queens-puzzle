/* ============================================================================
 * win.js · 胜利判定、礼花、判负（超时 / 步数用尽 / 命用尽）
 * ----------------------------------------------------------------------------
 * 「这一局结束了」这件事在这里发生：判赢、判负、记战绩、放礼花。
 * 结束之后那张卡在 ui/panels/result.js（它自己管开关），这里只负责叫它出来。
 * ========================================================================== */

import { buzz, sfx } from '../core/audio.js';
import { limitExpired, stopTimer } from '../core/clock.js';
import { DIFF_BANDS, REDUCE_MOTION } from '../core/config.js';
import { boardEl, fxEl } from '../core/dom.js';
import { mark as markDaily } from '../core/daily.js';
import { add as addRecord } from '../core/records.js';
import { guide, state, view } from '../core/state.js';
import { save } from '../core/storage.js';
import { announce, formatTime } from '../core/utils.js';
import { queenCount, regionCounts } from '../game/rules.js';
import { closeGuide } from './guide.js';
import { updateHint } from './hint.js';
import { showResult } from './panels/result.js';
import { updateStats } from './render.js';

/* ==========================================================
   胜利
   ========================================================== */
export function checkWin() {
  if (state.status !== 'playing') return;
  var n = state.size;
  var counts = state.regionCounts || regionCounts();
  if (queenCount() !== n) return;
  if (state.conflicts && state.conflicts.count > 0) return;
  for (var g = 0; g < n; g++) if (counts[g] !== 1) return;

  state.status = 'won';
  state.lostBy = null;
  if (guide.open) closeGuide();
  stopTimer();
  sfx('win');
  buzz([20, 40, 20, 40, 80]);
  updateStats();
  updateHint();
  announce('解开了！用时 ' + formatTime(state.elapsed) +
    (state.daily ? '，今日挑战「' + DIFF_BANDS[state.daily.tier].name + '」记上了' : ''));

  boardEl.classList.add('is-won');
  for (var i = 0; i < view.cells.length; i++) {
    if (state.marks[i] !== 2) continue;
    var r = (i / n) | 0, c = i % n;
    view.cells[i].style.setProperty('--win-delay', ((r + c) * 36) + 'ms');
  }

  burstConfetti();

  save();
  recordFinish(true);

  window.setTimeout(function () {
    if (state.status !== 'won') return;
    showResult();
  }, REDUCE_MOTION ? 200 : 900);
}

/* ==========================================================
   战绩
   ----------------------------------------------------------
   一局结束就写一条（解开 / 超时都算），顺带记下这局在自己那组
   「限时 × 难度」里排第几快——结果层拿它说一句「本组最快」。
   写盘失败不影响游戏：core/records 自己会吞掉异常。
   ========================================================== */
function recordFinish(won) {
  view.lastFinish = null;
  if (!state.regions || !state.solution) return;
  var saved = addRecord({
    n: state.size,
    seed: state.seed,
    regions: state.regions,
    solution: state.solution,
    vib: state.vibe,
    limit: state.limit || 0,
    ms: state.elapsed,
    hints: state.hints,
    moves: state.moves,
    steps: state.steps || 0,
    stepLimit: state.stepLimit || 0,
    lostBy: won ? '' : (state.lostBy || ''),
    won: won,
    noHint: !!state.noHint,
    noUndo: !!state.noUndo,
    daily: state.daily
  });
  if (saved) view.lastFinish = { rank: saved.rank, total: saved.total };

  /* 每日挑战：解开了才记进日历（输的那局只留在战绩里）。
   * 同一挡只留最快的一次——第二遍是刷时间，不是刷新记录。 */
  if (won && state.daily) {
    markDaily(state.daily.day, state.daily.tier, state.elapsed, state.steps);
  }
}

/* ==========================================================
   判负
   ----------------------------------------------------------
   三种挑战都会把这一局封盘：时间到（超时）、步数用尽、命用尽。
   封盘后棋盘只读（canPlay 看 status），但「重试这一局」能把同一盘棋
   原样重开一遍，不用重新出题。文案只有结果层那一张卡在分叉，这里只记下原因。
   ========================================================== */
function failGame(reason) {
  if (state.status !== 'playing') return;
  state.status = 'lost';
  state.lostBy = reason;
  if (guide.open) closeGuide();
  stopTimer();
  updateStats();
  updateHint();
  boardEl.classList.add('is-lost');
  boardEl.classList.remove('is-won');
  sfx('fail');
  buzz([30, 60, 30]);
  announce(reason === 'steps' ? '步数用尽，这局没解开'
    : reason === 'lives' ? '命用完了，这局没解开'
      : '时间到，这局没解开');
  save();
  recordFinish(false);
  showResult();
}

/* 由入口的 250ms 心跳调用（见 main.js）：到点就把这局封盘。 */
export function checkTimeout() {
  if (state.status !== 'playing') return false;
  if (!limitExpired()) return false;
  failByTimeout();
  return true;
}

export function failByTimeout() { failGame('time'); }

/* 步数用尽：每落一笔检查一次（见 app/actions.js 的 setMarks）。
 * 判在判胜之后——最后一步同时放满皇后又正好用完步数，那是解开，不是用尽。 */
export function checkSteps() {
  if (state.status !== 'playing') return false;
  if (!state.stepLimit) return false;
  if ((state.steps || 0) < state.stepLimit) return false;
  failBySteps();
  return true;
}

export function failBySteps() { failGame('steps'); }

/* 命用完了：放错那一下由 app/actions.js 的 rejectQueen 直接判（扣到 0 才叫）；
 * 这里这个检查是给**读档**用的——存档里剩 0 条命的那局恢复成 playing 之后，
 * 得由 main.js 在启动时再判一次负，刷新页面不能把已经输掉的局救回来。 */
export function checkLives() {
  if (state.status !== 'playing') return false;
  if (!state.lifeLimit) return false;
  if ((state.lives || 0) > 0) return false;
  failByLives();
  return true;
}

export function failByLives() { failGame('lives'); }

export function burstConfetti() {
  if (REDUCE_MOTION) return;
  var rect = boardEl.getBoundingClientRect();
  var colors = ['#FFD93D', '#FF6B6B', '#4FC46F', '#5B9DFF', '#A06BE8', '#FFFFFF'];
  for (var i = 0; i < 34; i++) {
    var p = document.createElement('i');
    p.className = 'confetti';
    var x = rect.left + rect.width * (0.15 + Math.random() * 0.7);
    var y = rect.top + rect.height * (0.2 + Math.random() * 0.4);
    var dx = (Math.random() - 0.5) * (rect.width * 0.9);
    var dy = (0.35 + Math.random() * 0.6) * Math.min(window.innerHeight, 620);
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.setProperty('--x', dx + 'px');
    p.style.setProperty('--y', dy + 'px');
    p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    p.style.setProperty('--d', (Math.random() * 160) + 'ms');
    fxEl.appendChild(p);
    window.setTimeout(function (el) {
      return function () { if (el.parentNode) el.parentNode.removeChild(el); };
    }(p), 1900);
  }
}
