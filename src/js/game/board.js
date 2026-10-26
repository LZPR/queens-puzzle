/* ============================================================================
 * board.js
 * 棋盘 DOM 构建与色块长按高亮。
 * ========================================================================== */

import { REDUCE_MOTION } from '../core/config.js';
import { gridEl, regionsEl, rlEl, rlPeek } from '../core/dom.js';
import { REGION_COLORS, assignRegionColors, glowOf } from '../core/palette.js';
import { settings, state, view } from '../core/state.js';
import { svgEl } from '../core/utils.js';
import { pieceSvg as pieceArt } from '../looks/index.js';
import { cellSize, regionCellsPath, regionPath } from './geometry.js';
import { paintSkin, skinMarkup } from './skin.js';

/* 皇后那一格画什么：外观插件说了算（默认是皇后，也可以是小猫）。
 * 两套画都塞进同一个 .piece 里，动画（落下 / 胜利小跳）都挂在 .piece 上，不用另写。 */
export function pieceSvg() {
  return pieceArt(settings.pieceStyle);
}

/** 换皇后样式：只换 .piece 里的画，格子、事件、动画都不动。 */
export function applyPieceStyle() {
  var html = pieceSvg();
  for (var i = 0; i < view.cells.length; i++) {
    var piece = view.cells[i].querySelector('.piece');
    if (piece) piece.innerHTML = html;
  }
  view.lookPiece = settings.pieceStyle;
}

/* ==========================================================
   棋盘构建
   ========================================================== */
export function buildBoard(deal) {
  var n = state.size;
  endPeek();               // 换盘时把上局长按留下的高亮清掉
  gridEl.innerHTML = '';
  view.cells = [];
  view.lastStates = new Array(n * n).fill('');
  gridEl.style.setProperty('--n', String(n));

  // 每盘按邻接关系重新分配底色（老实现是第 g 块取第 g 个色，相邻两块常常撞色）
  state.regionColors = assignRegionColors(n, state.regions);

  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      var i = r * n + c;
      var g = state.regions[i];
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.i = String(i);
      cell.style.setProperty('--rc', state.regionColors[g]);
      cell.style.setProperty('--rc-glow', glowOf(state.regionColors[g]));
      cell.setAttribute('role', 'gridcell');
      // 漫游 tabindex：整个棋盘只占一个 Tab 位，格内用方向键移动
      cell.tabIndex = i === 0 ? 0 : -1;

      // 色块粗边不再画在格子上（会在拐角漏缝），交给 #rb 图层统一描边
      if (c === n - 1) cell.classList.add('edge-r');
      if (r === n - 1) cell.classList.add('edge-b');

      if (deal && !REDUCE_MOTION) {
        cell.classList.add('deal');
        cell.style.setProperty('--deal-delay', ((r + c) * 13) + 'ms');
      }

      // 图案层在最底下：底色之上、× 与皇后之下，纯装饰、不吃点击
      // （窗口与图形由 skin.js 按「整块一枚图形」算，这里只放个空壳）
      // .miss 是挑战「标错惩罚」的红 X：放错那一下拍上来，自己缩掉（见 ui/lives.js）
      cell.innerHTML = skinMarkup() +
        '<span class="mark"><i></i><i></i></span>' +
        '<span class="piece">' + pieceSvg() + '</span>' +
        '<span class="miss"><i></i><i></i></span>' +
        '<span class="ring"></span>';
      paintSkin(cell, state.regionColors[g]);

      gridEl.appendChild(cell);
      view.cells.push(cell);
    }
  }

  window.setTimeout(function () {
    for (var k = 0; k < view.cells.length; k++) {
      view.cells[k].classList.remove('deal');
      view.cells[k].style.removeProperty('--deal-delay');
    }
  }, 620 + n * 30);
}

export function buildRegionBar() {
  var n = state.size;
  regionsEl.innerHTML = '';
  view.chips = [];
  for (var g = 0; g < n; g++) {
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.setProperty('--c', (state.regionColors || REGION_COLORS)[g]);
    chip.dataset.g = String(g);
    chip.title = '长按查看色块 ' + (g + 1) + ' 的位置';
    // 打叉笔画在这里先建好，靠 .is-bad 显形（CSS 建不了两笔手画的叉）
    chip.innerHTML = '<svg class="chip-x" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path class="cx-case" d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/>' +
      '<path class="cx-ink" d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/>' +
      '</svg>';
    // 长按：按下就在棋盘上把这块圈出来（不是把格子缩小 —— 缩放会在格间漏白缝，
    // 像给整块镶了道白边，跟这套墨线美术完全不搭）。
    chip.addEventListener('pointerdown', (function (gg, el) {
      return function (e) {
        // 只认主键 / 手指；右键、中键不参与
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        if (view.chips[gg] !== el) return;
        if (el.setPointerCapture) {
          try { el.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
        }
        el.classList.add('is-hold');
        // 90ms 才算「按住」：轻轻点一下不该在棋盘上闪一下高亮，那看着像手抖
        if (peekTimer) window.clearTimeout(peekTimer);
        peekTimer = window.setTimeout(function () {
          peekTimer = 0;
          showPeek(gg);
        }, 90);
      };
    })(g, chip));
    regionsEl.appendChild(chip);
    view.chips.push(chip);
  }
}

/* ==========================================================
   色块高亮（长按色卡）
   ----------------------------------------------------------
   用同一套描边：regionPath 生成的边界 + 墨线笔锋，外面罩一层这块自己的
   高饱和色当光晕。松手即灭，不留任何状态。
   ========================================================== */
var peekG = -1;
var peekTimer = 0;

export function showPeek(g) {
  var n = state.size;
  var cell = cellSize();
  if (!cell || !state.regions || g < 0 || g >= n) return;
  var d = regionPath(n, state.regions, g, cell);
  if (!d) return;

  var size = n * cell;
  rlEl.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  rlEl.setAttribute('width', String(size));
  rlEl.setAttribute('height', String(size));

  rlPeek.innerHTML = '';
  // 光晕跟着这块自己的颜色走：淡彩棋盘上，白边像缺口，本色光才像「这块亮了」
  rlPeek.style.setProperty('--peek', glowOf((state.regionColors || REGION_COLORS)[g]));

  var lw = cell < 26 ? 2.8 : 3.6;
  // 先给整盘压一层极淡的墨（evenodd 把这块的格子抠掉）：旁边退下去，
  // 这块自己就浮出来了。光靠加粗描边，大块淡彩里其实看不太出「是哪一块」。
  rlPeek.appendChild(svgEl('path', {
    d: 'M0 0h' + size + 'v' + size + 'h' + (-size) + 'z' + regionCellsPath(n, state.regions, g, cell),
    'class': 'rl-peek-veil',
    'fill-rule': 'evenodd'
  }));
  rlPeek.appendChild(svgEl('path', {
    d: d, 'class': 'rl-peek-halo', 'stroke-width': lw * 3
  }));
  var line = svgEl('path', { d: d, 'class': 'rl-peek-line', 'stroke-width': lw });
  rlPeek.appendChild(line);

  // 像拿笔描一遍：起笔到收笔 0.24s
  try {
    var len = line.getTotalLength();
    line.style.strokeDasharray = String(len);
    line.style.setProperty('--len', String(len));
    line.classList.add('is-draw');
  } catch (e) { /* 老浏览器不画描边动画 */ }

  peekG = g;
}

export function endPeek() {
  if (peekTimer) { window.clearTimeout(peekTimer); peekTimer = 0; }
  peekG = -1;
  rlPeek.innerHTML = '';
  for (var i = 0; i < view.chips.length; i++) view.chips[i].classList.remove('is-hold');
}
/** 格子尺寸变了 / 布局重排后，把正在长按的那块高亮按新尺寸重画一遍。 */
export function refreshPeek() {
  if (peekG >= 0) showPeek(peekG);
}
