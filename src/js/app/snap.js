/* ============================================================================
 * snap.js · 记录点（记下这一刻 / 还原 / 清空）
 * ----------------------------------------------------------------------------
 * 手动假设推演最难的地方不是推，是**推着推着忘了棋盘原来长什么样**。
 * 这颗按钮就干一件事：把这一刻的整盘 marks 抄一份存着，推歪了再点一下就回来。
 *
 * 三条规矩：
 *   · 只留一份。记下了按钮就是「还原」，还原一次就用掉、回到「记录」
 *     ——「存 / 取 / 存 / 取」交替，不用去选「这是第几号记录点」。
 *   · 还原占**一个撤销位**（走 app/history.js 的 pushRestorePoint），
 *     但**不算一步**：它没有往棋盘上落笔，撤销一下就能退回去。
 *   · 存的是 marks + hints + moves，跟撤销快照同一份口径；跟随存档落盘，
 *     刷新页面回来还认得那一刻（撤销栈则根本不落盘）。
 *
 * 动作在这里（跟 app/ 其它文件一样只管流程与落盘），按钮长什么样在
 * ui/render.js 的 updateStats()，手势（点 / 长按）在 ui/snap.js。
 * ========================================================================== */

import { buzz, sfx } from '../core/audio.js';
import { guide, state, view } from '../core/state.js';
import { save } from '../core/storage.js';
import { announce } from '../core/utils.js';
import { closeGuide } from '../ui/guide.js';
import { clearHintTimer, flashHint } from '../ui/hint.js';
import { render, renderQuiet } from '../ui/render.js';
import { markTrace } from '../ui/trace.js';
import { canPlay } from './actions.js';
import { pushRestorePoint } from './history.js';

/* ------------------------------------------------------------ 记下这一刻
 * 只读棋盘：不压撤销点、不涨步数、不动任何格子，也不收起引导面板
 * （棋盘没变，指着它的那些圈还成立）。记完按钮翻成「还原」。 */
export function saveSnap() {
  if (!canPlay()) return false;
  if (state.snap) return false;      // 已经有了：按钮这一下该走「还原」
  state.snap = {
    marks: state.marks.slice(),      // 拷一份，之后棋盘怎么变都不影响它
    hints: state.hints,
    moves: state.moves
  };
  sfx('snap');
  buzz(10);
  render();
  save();
  flashHint('已记下这一刻 · 再点就是「还原」', true, 2000);
  announce('已记下这一刻');
  return true;
}

/* ------------------------------------------------------------ 还原
 * 回到记下的那一刻：占一个撤销位（撤销能退回还原之前），不算一步。
 * 记录点用完即清 —— 一次只能存一个，取走就空了。 */
export function restoreSnap() {
  if (!canPlay()) return false;
  var s = state.snap;
  if (!s) return false;
  if (guide.open) closeGuide();
  clearHintTimer();

  /* 只圈「记录之后的那一步」：跳得远时，前后一比往往有十几格不一样，
   * 一次全点亮，屏幕上一大片，反而看不出「我记完那一刻之后先走的是哪一步」。
   * 找法见 stepAfterSnap() —— 必须在 pushRestorePoint() 之前取，
   * 否则刚压进去的那一条（还原前的盘面）会顶到栈顶，把要找的那一条挤远。
   * 找不到就什么都不亮：宁可安静，也不把十几格一起点亮。 */
  var next = stepAfterSnap(s.marks, state.marks);

  pushRestorePoint();
  state.marks = s.marks.slice();     // 同样拷一份：存的那盘不能被棋盘改掉
  state.hints = s.hints;
  state.moves = s.moves;
  state.lastTap = null;
  state.snap = null;

  markTrace(state.marks, next || state.marks);

  sfx('restore');
  buzz([12, 26, 12]);
  renderQuiet();     // 回到记下的那一刻：改棋盘，但不算步
  save();
  flashHint('已回到记录点 · 撤销可退回', true, 2000);
  announce('已回到记录点');
  return true;
}

/* ------------------------------------------------------------ 记录之后的第一步
 * 撤销栈里每一条存的都是「某一步**做之前**的盘面」（app/history.js 的
 * pushEntry 在改棋盘之前压）。所以记下那一刻的盘面 S 落在栈里第 i 条时，
 * 第 i+1 条就是「记录之后第一步做完」的盘面 —— 两者一比，正好是那一步动的格子。
 *
 * 只走了一步时，第 i 条就是**栈顶**，后面没有第 i+1 条：那一步做完的盘面
 * 正是眼下这块棋盘（`currentMarks`，还原之前的那一盘）。少了这一条兜底，
 * 「记完只走一步就还原」会一格都不亮。
 *
 * 同一盘面可能被走到过好几回，从栈顶往下找**最近**的那一次：离现在最近的那条
 * 后面跟的，才是玩家这次真正「记完先走的那一步」。
 * 找不到就返回 null（记完还没落笔，或撤销已经把那一刻挤出栈了）。 */
function stepAfterSnap(snapMarks, currentMarks) {
  var stack = view.undo;
  for (var i = stack.length - 1; i >= 0; i--) {
    if (!sameMarks(stack[i].marks, snapMarks)) continue;
    var after = stack[i + 1];
    return after ? after.marks : currentMarks;
  }
  return null;
}

function sameMarks(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------ 清空
 * 长按按钮（ui/snap.js）与 Shift+S 都走这里。棋盘一个字都不动，
 * 只是把存着的那份丢掉，按钮回到「记录」。
 * 不要求 canPlay：这局封盘了也允许把记录点扔掉（它已经没用了）。 */
export function clearSnap(silent) {
  if (!state.snap) return false;
  state.snap = null;
  buzz([18, 40, 18, 40, 26]);
  render();
  save();
  if (!silent) flashHint('记录点已清空');
  announce('记录点已清空');
  return true;
}
