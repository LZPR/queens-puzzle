/* ============================================================================
 * events.js · 棋盘与全局交互
 * ----------------------------------------------------------------------------
 * 只留「骨架上的东西」：棋盘的指针与键盘、工具栏三颗按钮、提示行、引导面板、
 * 全局监听（失焦 / 切后台 / 首次触碰解锁音频）。
 *
 * 浮层里的点击不在这里——每个面板自己的 mount() 绑自己的元素，
 * 加一个面板不用再往这个文件里插一段。
 * ========================================================================== */

import { canPlay, clearBoard, fillQueens, onCell, placeQueen, setMarks } from './app/actions.js';
import { pushHistory, redo, undo } from './app/history.js';
import { clearSnap } from './app/snap.js';
import { audio, buzz, sfx } from './core/audio.js';
import { pauseTimer, startTimer } from './core/clock.js';
import {
  btnClear, btnFinish, btnHint, btnNew, btnRedo, btnUndo, coachClose, coachNext, coachPrev, gridEl,
  regionsEl
} from './core/dom.js';
import { handleKey } from './core/sheet.js';
import { guide, hasProgress, settings, state, view } from './core/state.js';
import { save } from './core/storage.js';
import { endPeek } from './game/board.js';
import { clickFx } from './ui/effects.js';
import { closeGuide, guideNext, guidePrev, useHint } from './ui/guide.js';
import { flashHint } from './ui/hint.js';
import { openNew } from './ui/panels/newgame.js';
import { render } from './ui/render.js';
import { bindSnap, snapTap } from './ui/snap.js';

// 松手 / 手势被打断 / 窗口失焦，都算结束（指针被捕获在老色卡上时也能兜住）
window.addEventListener('pointerup', endPeek, true);
window.addEventListener('pointercancel', endPeek, true);
window.addEventListener('blur', endPeek);
regionsEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* ==========================================================
   指针：轻点标 × / 双击放皇后 / 按住拖动批量涂抹
   ========================================================== */
var stroke = null;          // 当前这一笔：{ id, mode, x, y, moved, last }
var PAINT_SLOP = 6;         // 位移超过这么多像素才算「拖动」
var lastPaintTick = 0;

function cellAt(x, y, clampToBoard) {
  var n = state.size;
  if (!n) return -1;
  var rect = gridEl.getBoundingClientRect();
  if (!rect.width) return -1;
  var step = rect.width / n;
  var c = Math.floor((x - rect.left) / step);
  var r = Math.floor((y - rect.top) / step);
  if (clampToBoard) {
    // 拖出棋盘也继续往边缘涂，手感更连贯
    c = Math.max(0, Math.min(n - 1, c));
    r = Math.max(0, Math.min(n - 1, r));
  } else if (r < 0 || r >= n || c < 0 || c >= n) {
    return -1;
  }
  return r * n + c;
}

// 只改一格，不写历史、不存盘（整笔结束时统一处理）
function paintOne(i, mode) {
  if (i < 0) return false;
  /* 「拖动只标同色」（设置里那颗）：划出起点所在的那一块颜色就停手，画和擦都算。
   * 判定落在每一格上，不是「起笔时定死一块」——手指从一块颜色划进隔壁时，
   * 隔壁那几格直接不涂，回头再划回来还能接着涂。 */
  if (settings.dragSameColor && stroke && state.regions[i] !== stroke.region) return false;
  if (mode === 'paint') {
    if (state.marks[i] !== 0) return false;
    if (state.auto && state.auto[i]) return false;
    state.marks[i] = 1;
    /* 每涂上一格震一下：拖动时手指盖住了棋盘，靠这一下知道「这格算进去了」。
     * 每次 pointermove 通常只跨一格，所以震动脉冲之间有空隙，听着是连点，
     * 不是一直嗡嗡响。 */
    buzz(4);
    return true;
  }
  if (mode === 'erase') {
    if (state.marks[i] !== 1) return false;
    state.marks[i] = 0;
    return true;
  }
  return false;
}

// 两次 pointermove 之间可能跨过好几格，按直线补齐，快速划也不会断
function paintAlong(to, mode) {
  var n = state.size;
  var from = stroke.last;
  var r0 = (from / n) | 0, c0 = from % n;
  var r1 = (to / n) | 0, c1 = to % n;
  var steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  var changed = false;
  for (var s = 1; s <= steps; s++) {
    var rr = Math.round(r0 + (r1 - r0) * s / steps);
    var cc = Math.round(c0 + (c1 - c0) * s / steps);
    if (paintOne(rr * n + cc, mode)) changed = true;
  }
  return changed;
}

function paintTick() {
  var t = performance.now();
  if (t - lastPaintTick < 40) return;
  lastPaintTick = t;
  sfx('x');
}

gridEl.addEventListener('pointerdown', function (e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  var cell = e.target.closest ? e.target.closest('.cell') : null;
  if (!cell) return;
  var i = parseInt(cell.dataset.i, 10);
  if (isNaN(i) || !canPlay()) return;

  var now = performance.now();
  var last = state.lastTap;
  var dbl = !!(last && last.i === i && (now - last.t) < 340);
  var prev = state.marks[i];
  var autoHere = !!(state.auto && state.auto[i]);

  /* 点击特效（外观面板的「涟漪」）：按在哪儿就从哪儿漾开。
   * 放在 onCell 之前——这一下按下去本来就有动静，哪怕它最后什么都没改
   * （比如点在自动打的 × 上），水面也该动一下。 */
  clickFx(cell, e.clientX, e.clientY);

  onCell(i);  // 沿用原来的单击 / 双击语义（这一格立刻生效）

  // 落笔方向决定这一笔是「画」还是「擦」：落点原本是空的就画，原本是手标 × 就擦
  var mode = 'none';
  if (!dbl) {
    if (prev === 0 && !autoHere) mode = 'paint';
    else if (prev === 1) mode = 'erase';
  }
  stroke = {
    id: e.pointerId, mode: mode,
    x: e.clientX, y: e.clientY,
    moved: false, last: i,
    axis: '',                 // 首次超过阈值时定方向，之后整笔只走那一行 / 那一列
    region: state.regions ? state.regions[i] : -1,   // 起笔那一格的颜色（「只标同色」认它）
    startR: (i / state.size) | 0,
    startC: i % state.size
  };

  if (mode !== 'none') {
    e.preventDefault();
    if (gridEl.setPointerCapture) {
      try { gridEl.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    }
  }
});

gridEl.addEventListener('pointermove', function (e) {
  if (!stroke || e.pointerId !== stroke.id || stroke.mode === 'none') return;
  // 拖到一半限时到了：这局已经封盘，别再往棋盘上涂
  if (!canPlay()) return;
  var dx = e.clientX - stroke.x;
  var dy = e.clientY - stroke.y;
  if (!stroke.axis) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    var big = Math.max(ax, ay);
    if (big < PAINT_SLOP) return;
    if (settings.alignDrag) {
      // 两个方向差不多时再等等，免得手指刚起手的一下抖动把方向判反
      if (big < PAINT_SLOP * 2 && big < Math.min(ax, ay) * 1.8) return;
      // 先明确的那个方向定死整笔走向：横向只涂这一行，纵向只涂这一列
      stroke.axis = ax >= ay ? 'x' : 'y';
    } else {
      // 不对齐：方向不重要，跟着指针走就是（'free' 只是「已经起笔」的标记）
      stroke.axis = 'free';
    }
    stroke.moved = true;
    state.lastTap = null;  // 开始拖动后就不再判双击，免得划回原格变放皇后
    gridEl.classList.add('is-painting');
  }
  e.preventDefault();
  var n = state.size;
  var target;
  if (stroke.axis === 'free') {
    // 随便涂的格子：指针出棋盘就停手，不往边上贴（贴边会把边缘一整排都涂掉）
    target = cellAt(e.clientX, e.clientY, false);
    if (target < 0) return;
  } else {
    var i = cellAt(e.clientX, e.clientY, true);
    if (i < 0) return;
    var r = stroke.startR;
    var c = stroke.startC;
    if (stroke.axis === 'x') c = i % n;
    else r = (i / n) | 0;
    target = r * n + c;
  }
  if (target === stroke.last) return;
  var changed = paintAlong(target, stroke.mode);
  stroke.last = target;
  if (changed) {
    render();
    paintTick();
  }
});

function endStroke(e) {
  if (!stroke) return;
  if (e && e.pointerId != null && e.pointerId !== stroke.id) return;
  var moved = stroke.moved;
  var id = stroke.id;
  stroke = null;
  gridEl.classList.remove('is-painting');
  if (gridEl.hasPointerCapture && gridEl.hasPointerCapture(id)) {
    try { gridEl.releasePointerCapture(id); } catch (err) { /* 忽略 */ }
  }
  if (moved) save();  // 一整笔只存一次盘
}

gridEl.addEventListener('pointerup', endStroke);
gridEl.addEventListener('pointercancel', endStroke);
window.addEventListener('pointerup', endStroke);
window.addEventListener('pointercancel', endStroke);

// 长按时别弹系统菜单
gridEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

gridEl.addEventListener('click', function (e) {
  // 指针的点击已经在 pointerdown 里处理；这里只兜住键盘 / 读屏器合成的 click。
  // 不支持 Pointer Events 的老浏览器退化成「只能点、不能拖」。
  if (window.PointerEvent && e.detail !== 0) return;
  var cell = e.target.closest ? e.target.closest('.cell') : null;
  if (!cell) return;
  var i = parseInt(cell.dataset.i, 10);
  if (isNaN(i)) return;
  // 没有坐标的点击（键盘回车 / 读屏器）：涟漪从格子正中漾开
  clickFx(cell);
  onCell(i);
});

/* ==========================================================
   工具栏 / 提示行 / 引导
   ========================================================== */
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);
btnHint.addEventListener('click', useHint);
btnClear.addEventListener('click', function () { clearBoard(false); });
/* 记录点：点一下记下 / 再点一下还原，按住清空（手势都在 ui/snap.js 里绑） */
bindSnap();
/* 提示行上的「补齐」：只剩皇后没标时才露出来（见 ui/hint.js），
 * 点一下把剩下的皇后挨个落上去（见 app/actions.js 的 fillQueens） */
btnFinish.addEventListener('click', function () { fillQueens(); });

coachPrev.addEventListener('click', guidePrev);
coachNext.addEventListener('click', guideNext);
coachClose.addEventListener('click', function () {
  closeGuide();
  flashHint('需要的时候再点「提示」');
});

/* 「新一局」不再是「立刻换盘」：棋盘大小 / 目标难度 / 挑战都在那层浮层里挑，
 * 点浮层底下的「换一局」才真的换（见 ui/panels/newgame.js）。 */
btnNew.addEventListener('click', openNew);

/* ==========================================================
   全局
   ========================================================== */
document.addEventListener('pointerdown', function () { audio.init(); }, { capture: true, once: true });
document.addEventListener('keydown', function () { audio.init(); }, { capture: true, once: true });

document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    pauseTimer();
    save();
  } else {
    if (state.status === 'playing' && hasProgress()) startTimer();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  }
});

document.addEventListener('keydown', function (e) {
  /* 浮层优先：开着一个浮层时，Esc / Tab / 层内快捷键全归它（core/sheet.js），
   * 游戏快捷键一律让路——否则面板背后还能落子。 */
  if (handleKey(e)) return;

  if (e.key === 'Escape') {
    if (guide.open) {
      e.preventDefault();
      closeGuide();
    }
    state.lastTap = null;
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    /* 撤销 / 重做两套读法都收：Z 与 Shift+Z 是 Mac 与游戏里那一套，
     * Ctrl+Y 是 Windows 上大家肌肉记忆里的重做。 */
    var k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (k === 'y') {
      e.preventDefault();
      redo();
    }
    return;
  }

  var key = e.key;
  var active = document.activeElement;
  var focused = active && active.classList && active.classList.contains('cell')
    ? parseInt(active.dataset.i, 10) : -1;

  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    e.preventDefault();
    var n = state.size;
    var i = focused >= 0 ? focused : state.focus;
    var r = (i / n) | 0, c = i % n;
    if (key === 'ArrowUp') r = (r - 1 + n) % n;
    if (key === 'ArrowDown') r = (r + 1) % n;
    if (key === 'ArrowLeft') c = (c - 1 + n) % n;
    if (key === 'ArrowRight') c = (c + 1) % n;
    state.focus = r * n + c;
    for (var k = 0; k < view.cells.length; k++) view.cells[k].tabIndex = -1;
    view.cells[state.focus].tabIndex = 0;
    view.cells[state.focus].focus();
    return;
  }

  if (key === 'x' || key === 'X') {
    if (focused >= 0) { e.preventDefault(); onCell(focused); }
    return;
  }

  if (key === 'q' || key === 'Q') {
    if (focused >= 0) {
      e.preventDefault();
      placeQueen(focused);
    }
    return;
  }

  if (key === 'Enter' || key === ' ') {
    if (focused >= 0) {
      e.preventDefault();
      placeQueen(focused);
    }
    return;
  }

  if (key === 'Backspace' || key === 'Delete') {
    if (focused >= 0) {
      e.preventDefault();
      if (!canPlay()) return;
      pushHistory();
      state.marks[focused] = 0;
      state.lastTap = null;
      // 走 setMarks 而不是 render：判胜 / 判步数用尽都在那一条路上
      setMarks(state.marks);
    }
    return;
  }

  if (key === 'z' || key === 'Z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }

  /* S 记录点（有就还原、没有就记下），Shift+S 清空——
   * 跟 Z / Shift+Z 一套读法。长按是触屏的说法，键盘这边给它一个等价键。 */
  if (key === 's' || key === 'S') {
    e.preventDefault();
    if (e.shiftKey) clearSnap(); else snapTap();
    return;
  }

  if (key === 'h' || key === 'H') {
    e.preventDefault();
    useHint();
    return;
  }

  if (key === 'n' || key === 'N') {
    e.preventDefault();
    openNew();
  }
});
