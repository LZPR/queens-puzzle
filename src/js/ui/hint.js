/* ============================================================================
 * hint.js
 * 提示行文案：常态提示、临时提示（1.7s 后自动回到常态）。
 *
 * 另外还管提示行上的那一颗「补齐」按钮：棋盘上只剩皇后没标时，
 * 整行让给它（见 game/rules.js 的 pendingQueens）。
 * ========================================================================== */

import { listOf } from '../looks/index.js';
import { btnFinish, finishText, hintEl, hintRowEl } from '../core/dom.js';
import { settings, state, view } from '../core/state.js';
import { pendingQueens, queenCount } from '../game/rules.js';
import { focusHint } from './hint-focus.js';

/* 临时提示的计时器：非 null 表示提示行正被一句临时文案占着，
 * 这期间 render() 触发的 updateHint() 不应该把话抢回去。 */
var hintTimer = null;

/* 常态那句「轻点标 ×」跟着外观走：换成「点」以后还念 × 会让人找不到东西。
 * 拖动方式（按行列对齐 / 随意涂）也是同一件事，一起在文案里说清楚。
 * 文案本身写在提供这套叉的插件里（looks/classic.js），这里只挑该怎么念。 */
function idleHint() {
  var marks = listOf('mark');
  for (var i = 0; i < marks.length; i++) {
    var st = marks[i];
    if (st.id !== settings.markStyle) continue;
    if (!settings.alignDrag && st.hintFree) return st.hintFree;
    if (st.hint) return st.hint;
    break;
  }
  return (marks[0] && marks[0].hint) || '轻点标记，按住可以连涂';
}

/* ---- 提示行上的「补齐」 ----
 * 0 表示不该露；露出来时整行只放这一颗按钮（文案里已经说了差几只），
 * 提示行的 36px 高度不变，棋盘一格都不会挪。 */
function setNudge(count) {
  if (!count) {
    if (!btnFinish.hidden) {
      btnFinish.hidden = true;
      hintRowEl.classList.remove('is-nudge');
    }
    return;
  }
  finishText.textContent = '只差 ' + count + ' 只皇后';
  btnFinish.setAttribute('aria-label', '自动补齐剩下 ' + count + ' 只皇后');
  if (btnFinish.hidden) {
    btnFinish.hidden = false;
    hintRowEl.classList.add('is-nudge');
  }
}

export function updateHint() {
  if (hintTimer) return;
  hintEl.classList.remove('is-alert', 'is-ok');

  /* 补齐那一串正在落子：棋盘上的数字一路在变，这里就别跟着数了 */
  if (view.filling) {
    setNudge(0);
    hintEl.textContent = '正在补齐…';
    return;
  }

  if (state.status === 'won') {
    setNudge(0);
    hintEl.textContent = '解开了，漂亮！';
    hintEl.classList.add('is-ok');
    return;
  }
  if (state.status === 'lost') {
    setNudge(0);
    hintEl.textContent = '时间到，这局没解开 · 重开或换一局';
    hintEl.classList.add('is-alert');
    return;
  }
  if (state.conflicts && state.conflicts.count > 0) {
    setNudge(0);
    hintEl.textContent = state.conflicts.pairs[0].reason;
    hintEl.classList.add('is-alert');
    return;
  }

  /* 只剩皇后没标：这一行让给「补齐」，其他文案都不用说了。
   * 「补齐」是单独一把开关（state.autoFill）：禁用提示只管提示，不再连带把
   * 这条捷径一起收掉——两件事在挑战里各占一颗开关。 */
  var rest = state.autoFill ? pendingQueens() : null;
  setNudge(rest ? rest.length : 0);
  if (rest) return;

  var q = queenCount();
  var n = state.size;
  if (q === 0) hintEl.textContent = idleHint();
  else if (q < n) hintEl.textContent = '还差 ' + (n - q) + ' 只皇后 · 双击放子';
  else hintEl.textContent = '每行每列每个色块，各一只皇后';
}

/**
 * 临时在提示行说一句，ms 之后自动回到常态文案。
 *
 * 第 4 个参数 opt 只有一项：`from` —— 触发这次提示的元素。
 * 传了就播一段「从点击点飞一颗光点到提示行 + 文字对上焦」的引导
 * （见 ui/hint-focus.js）。凡是**触发点在屏幕下部**、话却出现在顶部的场合
 * 都该传：不传的话，玩家的视线还停在手指上，会以为没点着。
 */
export function flashHint(text, ok, ms, opt) {
  /* 临时那句话优先：它写进的是提示行的正文，而正文在「补齐」露着的时候是藏起来的。
   * 所以先把按钮收回去，等这句话过期，updateHint() 自己会把按钮放回来。 */
  setNudge(0);
  hintEl.textContent = text;
  hintEl.classList.remove('is-alert', 'is-ok');
  hintEl.classList.add(ok ? 'is-ok' : 'is-alert');
  if (opt && opt.from) focusHint(opt.from, ok);
  if (hintTimer) window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(function () {
    hintTimer = null;
    updateHint();
  }, ms || 1700);
}
/** 立刻取消临时提示，回到常态文案（放皇后时用，免得旧提示压在新局面上）。 */
export function clearHintTimer() {
  if (hintTimer) {
    window.clearTimeout(hintTimer);
    hintTimer = null;
  }
}
