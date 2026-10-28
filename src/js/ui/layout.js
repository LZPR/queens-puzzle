/* ============================================================================
 * layout.js
 * 布局：棋盘边长只由舞台尺寸决定，任何浮层开关都不许挪动棋盘。
 * ========================================================================== */

import { app, boardEl, gridEl, regionsEl, stage, stageHeadEl, toolbarEl } from '../core/dom.js';
import { state } from '../core/state.js';
import { clamp } from '../core/utils.js';
import { refreshPeek } from '../game/board.js';
import { refreshGuidePaint } from './guide.js';
import { drawLinks, drawRegionBorders, refreshBad } from './render.js';
import { refreshTrace } from './trace.js';

/* ==========================================================
   水面的水位范围
   ----------------------------------------------------------
   把「水面最低 → 最高分别能到屏幕的百分之几」写成两个变量（--w-lo / --w-hi），
   交给 styles/base/effects.css 的 .w-rise 去和水位相乘。
   为什么不在量水位这里把水位算完：填充程度是 ui/effects.js 的事（它数 marks），
   布局只知道「空档在哪儿」——两件事各写一半，CSS 做那次映射。

   **要量两次**：ResizeObserver 回调里布局可能还没定（缩小窗口的那一刻，舞台
   上下那两块弹性空白还没重新分配），这时量出来的色卡位置偏低五十来像素 ——
   而偏低之后就再没有回调来纠正了（舞台尺寸最终没变，RO 不会再响）。
   开机那次是对的，缩放/转屏那次靠下一个任务补一遍。
   ========================================================== */
var bandTimer = 0;

/* 空盘时也留一小池水（占空档的三成）。
 * 为什么不留到最底：水面是**能点的** —— 点一下会被按出波纹。要是空盘时水全
 * 藏在工具栏底下，新开局第一分钟里那颗水面背景就是一片空白，点了也看不见动静，
 * 看着像坏了。留三成，屏幕底下永远有一池能看见的水。 */
var TIDE_REST = 0.3;

function measureWaterBand() {
  bandTimer = 0;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  if (!vh) return;
  var bandTop = regionsEl.getBoundingClientRect().bottom + 2;   // 色卡下沿再让 2px
  var bandBot = toolbarEl.getBoundingClientRect().top - 6;      // 工具栏上沿再让 6px
  var bandH = bandBot - bandTop;
  var hi = (vh - bandTop) / vh;
  var lo = (vh - (bandBot - bandH * TIDE_REST)) / vh;
  // 量不出来（元素还藏着 / 舞台没铺开）就保持上一次的值，CSS 那边也有兜底
  if (!(hi > lo && lo > 0)) return;
  document.documentElement.style.setProperty('--w-lo', lo.toFixed(4));
  document.documentElement.style.setProperty('--w-hi', hi.toFixed(4));
}

function queueWaterBand() {
  measureWaterBand();
  if (bandTimer) window.clearTimeout(bandTimer);
  bandTimer = window.setTimeout(measureWaterBand, 0);
}

/* ==========================================================
   布局
   ----------------------------------------------------------
   唯一目标：**棋盘的位置和大小只由「舞台尺寸 + 棋盘边长」决定**。
   所以这里的输入里没有引导面板、没有提示文案、没有难度标签 ——
   面板是浮层，提示行定高，标签用绝对留白，谁开关都不许动棋盘。
   ========================================================== */
export function relayout() {
  var n = state.size;
  // 24 = 舞台左右各 12px 内边距；再减 6 是棋盘外框（3px × 2），
  // 这样 n*cell + 6 永远塞得进内容区，不会溢出去（以前会多出 6px，提示行就对齐不上）
  var availW = stage.clientWidth - 24;
  // 提示行 + 信息条算作一块（.stage-head）：两者都贴着棋盘，占了多高就扣多高
  var headH = stageHeadEl.offsetHeight;
  // 上下那两块弹性空白在棋盘吃满时会缩到 0，所以可用高度就是
  // 「舞台高度 − 提示 / 信息条 − 调色板 − 工具栏 − 间距」。30 是三道 gap 的余量。
  var availH = stage.clientHeight - headH -
    regionsEl.offsetHeight - toolbarEl.offsetHeight - 30;

  if (availW < 40 || availH < 40) return;

  var cell = Math.floor(Math.min((availW - 6) / n, (availH - 6) / n));
  // 下限只是「再小就没法点了」的兜底：正常算出来的 cell 本来就塞得进舞台，
  // 一旦被下限抬上去，舞台内容就会溢出、浏览器还会为上滚焦点偷偷滚整个 app。
  cell = clamp(cell, 10, 78);

  boardEl.style.setProperty('--cell', cell + 'px');
  boardEl.style.setProperty('--n', String(n));
  boardEl.style.setProperty('--bw', cell < 26 ? '1.5px' : '2px');

  // 提示行整行的宽度跟着棋盘走（含左右各 3px 外框），难度标签才有地方对齐
  stage.style.setProperty('--board-w', (n * cell + 6) + 'px');

  var chip = clamp(Math.floor((Math.min(availW, 460) - (n - 1) * 4) / n), 10, 20);
  regionsEl.style.setProperty('--chip', chip + 'px');

  /* ---- 水面的水位范围（外观里的「水面」那一档，见 styles/base/effects.css）----
   * 水位只在色卡下沿 → 工具栏上沿这一段空档里涨落：棋盘与工具栏之间那一条
   * **空白**才是水该露出来的地方，别的都被不透明的东西挡住了。
   * 量「空档」而不是写死一个百分比 —— 320×640 与 414×896 的空档差一倍多，
   * 写死的话矮屏上水会涨到色卡后面去（那条浪尖就再也看不见了）。 */
  queueWaterBand();

  gridEl.style.setProperty('--cell', cell + 'px');
  gridEl.style.setProperty('--n', String(n));

  drawRegionBorders();
  // 只重画看得见的那层：已经淡出的旧 path 不用管，下次亮之前会按新格子重画
  refreshBad();
  // 格子尺寸变了，长按中的高亮也跟着重量一遍（否则横屏一转就错位）
  refreshPeek();
  drawLinks(state.conflicts || { pairs: [], cells: new Set(), count: 0 });
  // 格子尺寸变了，圈画层里的坐标也得跟着重画（否则横屏一转就错位）
  refreshGuidePaint();
  // 撤销残影那圈轮廓同理：它是按 --cell 算出来的 path
  refreshTrace();
}
