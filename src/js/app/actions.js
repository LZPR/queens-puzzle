/* ============================================================================
 * actions.js
 * 玩家动作：点格子的语义（标 × / 取消 / 双击放皇后）、落子、清空。
 * ========================================================================== */

import { buzz, sfx } from '../core/audio.js';
import { REDUCE_MOTION } from '../core/config.js';
import { startTimer } from '../core/clock.js';
import { guide, state, view } from '../core/state.js';
import { save } from '../core/storage.js';
import { announce } from '../core/utils.js';
import { closeGuide } from '../ui/guide.js';
import { clearHintTimer, flashHint, updateHint } from '../ui/hint.js';
import { loseLife } from '../ui/lives.js';
import { isSolutionCell, pendingQueens } from '../game/rules.js';
import { pushHistory } from './history.js';
import { render } from '../ui/render.js';
import { clearTrace } from '../ui/trace.js';
import { checkSteps, checkWin, failByLives } from '../ui/win.js';

/* ==========================================================
   落子 / 标记
   ========================================================== */
/* 能不能往棋盘上落子。浮层开没开只看 view.sheet 一个字段——
 * 浮层基座负责维护它（core/sheet.js），新加面板不用再来这里加一条。
 * rolling 是「出题中」：遮罩挡得住鼠标挡不住键盘，那几秒里棋盘得是只读的。 */
export function canPlay() {
  return state.status === 'playing' && !view.sheet && !view.filling && !view.rolling;
}

export function setMarks(next, anim) {
  state.marks = next;
  render(anim);
  save();
  checkWin();
  /* 判完胜再判步数：最后一步「刚好摆满」时那是解开，不是步数用尽。
   * 放在这里而不是每个动作里，是因为所有改棋盘的路都会经过它。 */
  if (state.status === 'playing') checkSteps();
}

export function onCell(i) {
  if (!canPlay()) return;
  /* 手一碰棋盘，上一步的残影就收掉 —— 玩家说的是「点任意格子后就消失」，
   * 包括点在一格自动打了叉、这一下其实什么也没干的地方：
   * 手指落下就意味着注意力已经回到棋盘上了，光再留着只会碍事。 */
  clearTrace();
  // 玩家自己动手了，之前那张提示的圈就撤掉，免得指着一处已经变了的棋盘
  if (guide.open) closeGuide();
  // Tab 位跟着最后一次操作的格子走
  if (view.cells[i] && view.cells[i].tabIndex !== 0) {
    for (var k = 0; k < view.cells.length; k++) view.cells[k].tabIndex = k === i ? 0 : -1;
  }
  var now = performance.now();
  var last = state.lastTap;

  // 双击：撤销第一次点击的效果，直接放皇后
  if (last && last.i === i && (now - last.t) < 340) {
    state.lastTap = null;
    state.marks[i] = last.prev;
    /* 标错惩罚：这一格放不了皇后。第一下那笔也算这个手势的一部分，一起作废——
     * 不压撤销点、不涨步数（别的入口都走 placeQueen 里那道检查，这里先拦一道，
     * 是因为双击这条路已经把 marks 改回去了）。last.pushed 就是「第一下压过撤销点」。 */
    if (state.lifeLimit > 0 && !isSolutionCell(i)) { rejectQueen(i, last.pushed); return; }
    if (!last.pushed) pushHistory();
    placeQueen(i, true);
    return;
  }

  var prev = state.marks[i];

  if (state.marks[i] === 2) {
    pushHistory();
    state.marks[i] = 0;
    sfx('remove');
    buzz(6);
    state.lastTap = null;
    setMarks(state.marks);
    announce('已移除皇后');
    return;
  }

  if (state.marks[i] === 1) {
    pushHistory();
    state.marks[i] = 0;
    sfx('xOff');
    state.lastTap = { i: i, t: now, prev: prev, pushed: true };
    setMarks(state.marks);
    return;
  }

  if (state.auto && state.auto[i]) {
    buzz(3);
    flashHint('这一格已经自动标记过了，双击可以直接放皇后');
    state.lastTap = { i: i, t: now, prev: 0, pushed: false };
    return;
  }

  pushHistory();
  state.marks[i] = 1;
  startTimer();
  sfx('x');
  buzz(5);
  state.lastTap = { i: i, t: now, prev: prev, pushed: true };
  setMarks(state.marks);
}

export function placeQueen(i, skipHistory) {
  if (!canPlay()) return;     // 赢了 / 超时封盘的局，键盘也别想再落子
  clearTrace();               // 键盘落子不经过 onCell，残影在这儿收
  /* 标错惩罚（挑战）：这一格不是解位就别落子 —— 红 X 闪一下、格子还原成空的、
   * 扣一条命，扣光判负（见下面的 rejectQueen）。
   * 判在 pushHistory 之前：这一手压根没发生，不该进撤销栈、也不该涨步数。 */
  if (state.lifeLimit > 0 && !isSolutionCell(i)) { rejectQueen(i); return; }
  if (!skipHistory) pushHistory();
  if (guide.open) closeGuide();
  clearHintTimer();
  state.marks[i] = 2;
  state.moves++;
  startTimer();
  sfx('queen');
  buzz([10, 24, 14]);
  setMarks(state.marks, { from: i });
  announce('已放置皇后');
}

/* ==========================================================
   标错惩罚
   ----------------------------------------------------------
   棋盘上一个字都不改：这一手没落成，格子该是什么样还是什么样（多半是空的）。
   红 X、碎心、震动、播报全在 ui/lives.js 里，这里只负责「这一手算不算它的最后一下」。
   ========================================================== */
/* rejectQueen(i, tapped)
 *   tapped = 双击那条路上，第一下（标 ×）已经压过撤销点、也涨过一步。
 *            这一手既然没发生，那一笔也得跟着作废：撤销点弹掉、步数退回去。
 *            别的入口（键盘 Q / Enter、单击后落子）都还没压过，传 false。 */
function rejectQueen(i, tapped) {
  if (guide.open) closeGuide();
  state.lastTap = null;
  if (tapped && view.undo.length) {
    view.undo.pop();
    if (state.steps > 0) state.steps--;
  }
  /* 双击那条路会先把第一下那笔撤回去（state.marks 变了、DOM 还没重画），
   * 这里统一画一遍，保证棋盘就是 state 的样子：这手没落成，格子该是空的。 */
  render();
  var left = loseLife(i);
  // 命扣到 0：这一局封盘（文案与结果卡在 ui/win.js / panels/result.js）
  if (left <= 0) failByLives();
}

export function clearBoard(silent) {
  if (!canPlay()) return;
  if (guide.open) closeGuide();
  pushHistory();
  state.marks.fill(0);
  state.lastTap = null;
  sfx('xOff');
  buzz(8);
  setMarks(state.marks);
  if (!silent) flashHint('已清空，可撤销');
  announce('已清空棋盘');
}

/* ==========================================================
   一键补齐
   ----------------------------------------------------------
   棋盘上只剩皇后没标的时候（判据见 game/rules.js 的 pendingQueens），
   玩家点提示行那颗「补齐」，这里把剩下的皇后挨个落上去。
   赢还是由 checkWin 照常判——它跟手动落子走的是同一条路，
   所以这条捷径没法把一盘没解开的棋判成解开。

   两个刻意的取舍：
   · 整串只压一个撤销点（pushHistory 一次）：后悔了就退一步回到补齐之前，
     不会退成「一只一只往回掉」的十几步；
   · 落子期间 view.filling = true，棋盘只读。动画总长压在一秒上下，
     手快点两下也抢不过它，省得两边同时改 state.marks。
   ========================================================== */
export function fillQueens() {
  if (!canPlay()) return false;
  if (state.noHint) return false;   // 挑战里禁用提示，这条捷径也不给
  var list = pendingQueens();
  if (!list || !list.length) return false;

  if (guide.open) closeGuide();
  clearHintTimer();
  pushHistory();
  state.lastTap = null;
  startTimer();
  view.filling = true;

  /* 中途换盘 / 重试会把 state.marks 整个换成一个新数组，
   * 用它认「这串动画还属于现在这一盘吗」——比记一个计数器更省事。 */
  var marks = state.marks;
  var total = list.length;
  // 总数多就快一点，总长压在一秒上下：14 只约 78ms 一只，4 只约 120ms 一只
  var gap = REDUCE_MOTION ? 0 : Math.min(120, Math.max(45, Math.round(1100 / total)));
  var at = 0;

  buzz(10);

  function step() {
    if (state.marks !== marks || state.status !== 'playing') {
      view.filling = false;
      updateHint();
      return;
    }
    var i = list[at];
    at++;
    state.marks[i] = 2;
    state.moves++;
    sfx('fill', { i: at - 1 });
    setMarks(state.marks, { from: i });   // 画一遍、存盘、判胜
    if (at < total) { window.setTimeout(step, gap); return; }

    view.filling = false;
    updateHint();   // 「正在补齐…」换成「解开了」
    announce('已补齐剩下 ' + total + ' 只皇后');
  }

  step();
  return true;
}
