/* ============================================================================
 * ui/effects.js · 三类「动起来」的外观：点击特效 / 背景动画 / 棋盘滤镜
 * ----------------------------------------------------------------------------
 * 前四类外观（色块 / 叉 / 皇后 / 生命）改的是「画成什么样」；这三类改的是
 * 「动不动、怎么动」，所以单独一层，谁都不碰 state.marks，也不进撤销栈。
 *
 * 三样东西各有一条边界，改之前先认清楚：
 *
 *   · 点击特效只管**被点的那一格**。圆是格子里的一个 <span>，格子自己
 *     overflow: hidden，长到边上就被裁掉，绝不会漫到隔壁。
 *   · 背景动画在**棋盘之外**：一层 .bg-fx 挂在 body 上（z-index: -1），
 *     在纸背景之上、所有内容之下 —— 不吃点击、不盖棋子，谁也不用给它让位。
 *   · 棋盘滤镜只罩 .board 本身。色卡、信息条、工具栏、背景动画都不受影响。
 *
 * 三样都受「动画偏好」约束：prefers-reduced-motion 时涟漪不播、背景层直接收起
 * （滤镜是静态的，留着）。
 *
 * 画法按 id 登记在下面两张表里（CLICK_FX / BG_SCENES）：
 * 插件（looks/）只负责把 id 与名字报上来，具体怎么画在这里。
 * 加一种新特效 = looks/ 里加插件 + 这里加一条画法，别处都不用动。
 * ========================================================================== */

import { REDUCE_MOTION } from '../core/config.js';
import { boardEl } from '../core/dom.js';
import { settings } from '../core/state.js';
import { findOf } from '../looks/index.js';

/* ==========================================================
   一、点击特效
   ----------------------------------------------------------
   涟漪：从指尖那一处漾开一圈墨晕（Material 按钮那套水面效果）。
   圆心用 --fx-x / --fx-y，直径用 --fx-size（取落点到最远那个角的距离 ×2，保证盖满整格）。
   ========================================================== */
var RIPPLE_FALLBACK_MS = 760;

function rippleAt(cell, x, y) {
  var rect = cell.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // 没给坐标（键盘 / 读屏器合成的那一下）就从正中间漾开
  var px = x == null ? rect.width / 2 : x - rect.left;
  var py = y == null ? rect.height / 2 : y - rect.top;
  /* 直径 = 从落点到**最远那个角**的距离 × 2：涨满的时候正好把整格盖住。
   * 按对角线算不够：落在边角上时，斜对面那个角比对角线的一半还远，
   * 收尾会留下一块没被水漫过的死角。 */
  var dx = Math.max(px, rect.width - px);
  var dy = Math.max(py, rect.height - py);
  var size = Math.ceil(Math.hypot(dx, dy) * 2 * 1.02);

  var el = document.createElement('span');
  el.className = 'fx-rip';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--fx-size', size + 'px');
  el.style.setProperty('--fx-x', px.toFixed(1) + 'px');
  el.style.setProperty('--fx-y', py.toFixed(1) + 'px');
  el.addEventListener('animationend', function () { dropNode(el); });
  cell.appendChild(el);
  /* 兜底：切后台 / 面板强收时 animationend 不一定来，
   * 留一个定时器保证节点一定被摘掉（同一个节点摘两次是安全的） */
  window.setTimeout(function () { dropNode(el); }, RIPPLE_FALLBACK_MS);
}

function dropNode(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* id → 画法。加一种新特效在这里加一行。 */
var CLICK_FX = { ripple: rippleAt };

/**
 * 点一格时播一下。cell 是那个 .cell，x / y 是指针的视口坐标（可省）。
 * 什么都不选、选了「无」、或者系统要求少动画时，这里直接返回。
 */
export function clickFx(cell, x, y) {
  if (!cell || REDUCE_MOTION) return;
  var o = findOf('click', settings.clickStyle);
  if (!o || o.id === 'none') return;
  var play = CLICK_FX[o.id];
  if (play) play(cell, x, y);
}

/* ==========================================================
   二、背景动画
   ----------------------------------------------------------
   一层固定在视口上的 .bg-fx，里面撒十几枚几何形状，各自一个时长 / 起点 /
   横移 / 自转（都写在自己的行内变量上，见 styles/base/effects.css）。
   形状是 CSS 裁出来的，没有图、没有 canvas，动的是 transform 与 opacity，
   整层 pointer-events: none。
   ========================================================== */
var bgEl = null;
var BG_COUNT = 14;

/* 固定的种子：每次开机撒成同一个样子（截图与自动化测试才对得上）。
 * 想换个排布就改这个数。 */
function makeRandom(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 几何：三角 / 方块 / 菱形 / 圆 / 六边形轮流，参数各随机一份。
 *
 * 一枚形状一个颜色：这一小组比棋盘那 18 个淡彩**再饱和一点**——背景在棋盘之外，
 * 色相认得出来就够了，不必抢；但要是一路用极淡的粉，糊开之后（模糊背景）
 * 就只剩一团灰。五个形状各占一色，才看得出「这一片是彩色的」。 */
var BG_TINTS = {
  tri: '#DE6249',      // 暖红
  square: '#DFA01F',   // 琥珀
  diamond: '#4E9E5C',  // 草绿
  circle: '#3D93BC',   // 湖蓝
  hex: '#7263C4'       // 淡紫
};

function snowField() {
  var r = makeRandom(0x51F0A3);
  var shapes = ['tri', 'square', 'diamond', 'circle', 'hex'];
  var out = '';
  for (var i = 0; i < BG_COUNT; i++) {
    var name = shapes[i % shapes.length];
    var left = 3 + r() * 94;
    var size = 8 + r() * 13;
    var dur = 17 + r() * 15;
    /* 负的起点：开机那一刻它们已经散在半空，不用等第一批飘下来 */
    var delay = -(r() * dur);
    var sway = (r() * 2 - 1) * 70;
    var spin = (r() < .5 ? -1 : 1) * Math.round(200 + r() * 520);
    /* 最浓时 .72–.94：形状本来就小（8–21px），半透明叠在纸色上会把色相
     * 洗掉 —— 尤其糊开之后只剩几粒灰点。这个浓度下它们是「彩纸屑」，
     * 因为小、又在棋盘外，仍然抢不走棋盘的注意力。 */
    var op = .72 + r() * .22;
    out += '<i class="bg-s bg-' + name + '" style="' +
      '--l:' + left.toFixed(1) + '%;' +
      '--s:' + size.toFixed(1) + 'px;' +
      '--d:' + dur.toFixed(1) + 's;' +
      '--delay:' + delay.toFixed(1) + 's;' +
      '--sway:' + sway.toFixed(0) + 'px;' +
      '--spin:' + spin + 'deg;' +
      '--o:' + op.toFixed(3) + ';' +
      '--c:' + BG_TINTS[name] + '">' +
      '</i>';
  }
  return out;
}

var BG_SCENES = { snow: snowField };

function buildBg(field) {
  if (!bgEl) {
    bgEl = document.createElement('div');
    bgEl.className = 'bg-fx';
    bgEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bgEl);
  }
  bgEl.innerHTML = field;
  return bgEl;
}

/* 换 / 关背景：选中「无」（或系统要求少动画）就把整层收起来。
 * 收起来用 hidden（[hidden] { display: none }），动画跟着停，不白烧电。 */
function applyBgLayer() {
  var o = findOf('bg', settings.bgStyle);
  var scene = o && o.id !== 'none' ? BG_SCENES[o.id] : null;
  if (!scene || REDUCE_MOTION) {
    if (bgEl) bgEl.hidden = true;
    return;
  }
  buildBg(scene()).hidden = false;
}

/* ==========================================================
   三、棋盘滤镜 / 模糊背景
   ========================================================== */
/* 滤镜的值由插件自己给（mono.js 里的 filter 字段），这里只管把它挂到 .board 上。
 * 不走 CSS 选择器认 id —— 那样每加一套滤镜都得改样式表。 */
function applyBoardFilter() {
  var o = findOf('filter', settings.filterStyle);
  if (boardEl) boardEl.style.filter = (o && o.filter) || '';
}

/** 「模糊背景」开关：只糊背景那一层（棋盘之外的飘落），棋盘一点不动。
 *  设置面板拨开关时立刻调，applyEffects 里也调一次（开机 / 换背景都要跟上）。 */
export function applyBgBlur() {
  document.documentElement.classList.toggle('is-blur-bg', !!settings.blurBg);
}

/* ==========================================================
   落地
   ========================================================== */
/**
 * 把三样外观落到页面上：<html data-click / data-bg / data-filter> 三个钩子
 * （给 CSS 与调试用）+ 背景层 + 棋盘滤镜 + 模糊背景。
 * 由 ui/panels/look.js 的 applyLook() 调用——那边是外观的总入口。
 */
export function applyEffects() {
  var root = document.documentElement;
  root.setAttribute('data-click', settings.clickStyle);
  root.setAttribute('data-bg', settings.bgStyle);
  root.setAttribute('data-filter', settings.filterStyle);
  applyBgLayer();
  applyBgBlur();
  applyBoardFilter();
}
