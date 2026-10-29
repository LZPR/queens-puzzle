/* ============================================================================
 * history.js
 * 撤销 / 重做：整盘 marks 快照，最多 UNDO_MAX 步（core/state.js）。
 *
 * 放在 app 层：撤销要判「现在能不能操作」、要收起提示面板、要落盘，
 * 已经不是单纯的视图逻辑了。
 *
 * 撤销完了要留一层残影（ui/trace.js）：退回去之后人常常想不起刚才在干什么，
 * 把上一步**变化过**的那几格点亮，手一碰棋盘就灭。重做不留 —— 往前走回去
 * 的落点自己看得懂，再点亮反而像在提示「下回该点这儿」。
 * ========================================================================== */

import { canPlay } from './actions.js';
import { buzz, sfx } from '../core/audio.js';
import { guide, state, UNDO_MAX, view } from '../core/state.js';
import { save } from '../core/storage.js';
import { announce } from '../core/utils.js';
import { closeGuide } from '../ui/guide.js';
import { flashHint } from '../ui/hint.js';
import { renderQuiet } from '../ui/render.js';
import { clearTrace, markTrace } from '../ui/trace.js';

/* ==========================================================
   历史
   ========================================================== */
function snapshot() {
  return {
    marks: state.marks.slice(),
    hints: state.hints,
    moves: state.moves
  };
}

function pushEntry() {
  /* 棋盘要变了，上一步的残影到这一步就过期了：先收掉再记账。
   * 收在这里而不是每个动作里，是因为改棋盘的路远不止棋盘上那几下
   * （清空 / 一键补齐 / Backspace），凡是要压撤销点的都该从这里过。 */
  clearTrace();
  view.undo.push(snapshot());
  if (view.undo.length > UNDO_MAX) view.undo.shift();
  view.redo.length = 0;
}

export function pushHistory() {
  pushEntry();
  /* 步数不在这里涨了（2026-10-29）：改成「每变一格记一步」，由 ui/render.js 的
   * render() 数出来（拖拽连涂、自动打的 × 一起算）。这里只负责压撤销点。 */
}

/* 记录点的「还原」走的也是这一条：**占一个撤销位，但不算一步**。
 * 它没有往棋盘上落笔，跟撤销 / 重做是同一类动作（回到走过的位置），
 * 所以走 pushEntry 而不是 pushHistory —— 开了步数限制的局不该因为
 * 「回到记下的那一刻」被罚掉一步。 */
export function pushRestorePoint() {
  pushEntry();
}

export function undo() {
  if (!canPlay()) return;
  if (state.noUndo) { lockedHint(); return; }
  if (!view.undo.length) return;
  if (guide.open) closeGuide();
  var before = state.marks;      // 退回之前的那一盘（下面要拿它比出「刚撤掉的是哪几格」）
  view.redo.push(snapshot());
  var s = view.undo.pop();
  state.marks = s.marks;
  state.hints = s.hints;
  state.moves = s.moves;
  state.lastTap = null;
  var moved = markTrace(before, state.marks);
  sfx('undo');
  buzz(6);
  renderQuiet();      // 回到走过的位置：改棋盘，但不涨步数
  save();
  announce(undoSpeech(moved));
}

/* 撤销后的播报：残影是画给眼睛看的，读屏这边一句话补上「动了哪儿」。
 * 一格就说坐标（最有用），多格说格数（念一串坐标没人听得下去）。 */
function undoSpeech(cells) {
  if (!cells || !cells.length) return '已撤销';
  if (cells.length > 1) return '已撤销 · 刚才那一步动了 ' + cells.length + ' 格';
  var n = state.size;
  var i = cells[0];
  return '已撤销 · 刚才那一步在第 ' + (((i / n) | 0) + 1) +
    ' 行第 ' + ((i % n) + 1) + ' 列';
}

export function redo() {
  if (!canPlay()) return;
  if (state.noUndo) { lockedHint('重做'); return; }
  if (!view.redo.length) return;
  if (guide.open) closeGuide();
  view.undo.push(snapshot());
  var s = view.redo.pop();
  state.marks = s.marks;
  state.hints = s.hints;
  state.moves = s.moves;
  state.lastTap = null;
  clearTrace();     // 往前走回刚才的位置，上一步的残影这时候不该还亮着
  sfx('redo');
  buzz(6);
  renderQuiet();    // 跟撤销同一个口径：不算往前走了一步
  save();
  announce('已重做');
}

/* 挑战里关掉撤销后，按钮是灰的；键盘 Z 还能按，得给一句话说明为什么没反应 */
function lockedHint(what) {
  flashHint('挑战模式：这局不能' + (what || '撤销'));
  buzz(6);
}
