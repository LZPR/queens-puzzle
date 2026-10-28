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
 * 「水面」这套背景自己还带一样东西：一条**真的在动**的水线。它是一维波动
 * 方程在跑（下面第三节），但结论仍旧落在这三条边界以内 —— 水面在棋盘底下，
 * 水在动、棋盘不动，点一下是「把水按下去」，不是「在光标底下画一圈水花」。
 * 它没有第二层、不盖任何内容、不参与命中测试，棋盘一格都没被它碰过。
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
import { settings, state } from '../core/state.js';
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
/* 现在铺的是不是水面那一场：浪花要认它（不是水就不溅），水位也只在这时才算 */
var tideOn = false;

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

var BG_SCENES = { snow: snowField, tide: tideField };

/* ==========================================================
   三、水面（背景动画的第二种）
   ----------------------------------------------------------
   整页是一池浅水，两层：
     · `.w-wash` 铺满视口的极淡水色，它不跟水位走 —— 有这一层，「整页都在
       水上」才成立，点屏幕最顶上也算点在水里；
     · `.w-rise` 是从水面往下那一整块水，靠 translateY 把上沿推到 --level
       那一行 —— 水位涨落是合成层的事，不碰 height，也就不触发布局。
   水面本身由 `<canvas class="w-surf">` **每帧重画**：一条一维高度场在跑波动
   方程，所以那条水线是真在动的 —— 不是把一张波形图横向平移。

   水位只读 state.marks（玩家自己落的叉与皇后）：自动打的叉不算 —— 那不是玩家填的。
   水位落在哪两行之间由 ui/layout.js 量「色卡下沿 → 工具栏上沿」那一段定（--w-lo /
   --w-hi），这里只把**完成度** --fill 报上去（涂了多少 + 放了几颗皇后，见 fillRatio）。
   ========================================================== */

/* wash 铺满视口（不跟水位走），rise 里是从水面往下的一整块水。
 * 水团 / 反光 / 水线都长在 rise 顶上，于是它们跟着水一起涨。 */
function tideField() {
  return '' +
    '<i class="w-wash"></i>' +
    '<div class="w-rise">' +
      '<div class="w-sway">' +
        '<div class="w-deep"></div>' +
        '<i class="w-swell s1"></i>' +
        '<i class="w-swell s2"></i>' +
        '<i class="w-glint g1"></i>' +
        '<i class="w-glint g2"></i>' +
        '<canvas class="w-surf" aria-hidden="true"></canvas>' +
      '</div>' +
    '</div>';
}

/* 棋盘完成到什么程度（0–1）。两把尺子，取并集：
 *
 *   · 涂了多少：state.marks 里非 0 的格（1 = 叉、2 = 皇后）占多少；
 *   · 皇后放了几颗：放满 n 颗就是这一局做完了。
 *
 * 为什么不能只数涂的格子：真正解题时玩家是「放皇后」，一盘 8×8 放满也只有
 * 8 格 —— 按涂格算的话水面几乎不动，解完还是贴着底。而只数皇后也不对：
 * 涂叉是玩家最主要的动作，涂了一整盘水面却不动，同样不合理。
 *
 * 合的方式是 1 - (1 - paint)(1 - done)（两个完成度取并集），不是 max：
 * 用 max 的话，涂到六七成之后再放皇后水位就一动不动了 —— 而放皇后恰恰是
 * 这一局里最重的一步。取并集则两边都在推、任一边做满就是满水。
 * 于是「解开了」那一刻水面正好涨到顶（皇后 n/n），不用再单独为胜利开一条路。 */
function fillRatio() {
  var marks = state.marks;
  var n = state.size;
  if (!marks || !n || !marks.length) return 0;
  var filled = 0;
  var queens = 0;
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    if (m !== 0) filled++;
    if (m === 2) queens++;
  }
  var paint = Math.min(1, filled / (n * n));
  var done = Math.min(1, queens / n);
  return 1 - (1 - paint) * (1 - done);
}

/* 把完成度写到 .bg-fx 上（--fill；水位由 CSS 按它与布局量出来的那一段空档算，
 * 见 styles/base/effects.css 的 .w-rise —— 这样水位永远落在「色卡与工具栏之间」
 * 那一条空白里，不用在 js 里猜屏高）。
 * 变量挂在整层的容器上而不是水块自己：换背景时 innerHTML 会整个重建，容器还在。
 * 没开水面时什么都不做（连 marks 都不数）。
 * 数出来的值没变就别碰 style：render() 在一笔涂抹里会被叫好几十次，
 * 每次都写一遍等于每次都让这一层重新算样式。 */
var lastFill = -1;

function paintTide() {
  if (!bgEl || !tideOn) return;
  var f = fillRatio();
  if (f === lastFill) return;
  lastFill = f;
  bgEl.style.setProperty('--fill', f.toFixed(3));
}

/** 棋盘变了：水位跟着完成度走（涂了多少 + 放了几颗皇后，见 fillRatio）。
 *  由 ui/render.js 的 render() 每画一遍棋盘就调一次（只是把 marks 数一遍，
 *  8×8 也就 64 个；没有开水面时这个函数什么都不做）。 */
export function updateWater() { paintTide(); }

/* ---- 水面那条线：一维波动方程 ----
 *
 * FIELD[i] 是第 i 个采样点比静水面高多少（1 = 一整幅，画的时候乘 AMP 换 px），
 * FIELD_V 是它的速度。半隐式欧拉推一步：
 *
 *     v[i] += (h[i-1] + h[i+1] - 2h[i]) * COUPLE   ← 拉普拉斯：邻居把我拽回去
 *     v[i] *= DAMP                                 ← 水有黏性，能量慢慢散掉
 *     h[i] += v[i]
 *
 * 这就是最朴素的波动方程（弦、浅水都长这样），两侧边界当墙（h[0] = h[1]）：
 * 波跑到屏幕边上原样弹回来，正是一个水池该有的样子。
 *
 * 三个参数都是趟出来的：
 * · COUPLE 是波速的平方。稳定上限是 1（离散拉普拉斯的谱半径 4，半隐式欧拉
 *   要求 couple × 4 ≤ 4），取 .12 → 波每个采样点每帧走 .35 格，横穿 390 宽
 *   约 1.5 秒：看得见「水在跑」，又不是一闪就没。往上加只会更快、更抖；
 * · DAMP 决定多久静下来：.972 约 2.6 秒收到看不出来（实测峰值 < 3%）。
 *   .985 要 5.6 秒 —— 那会儿已经没人记得自己点过；
 * · 步长固定 1/60 秒，跟屏幕刷新率脱钩：120Hz 上跑两倍快是错的。
 */
var STEP = 1 / 60;
var COUPLE = 0.12;
var DAMP = 0.972;
var PUSH = 0.9;          // 点一下把水压多深（1 = 满幅）
var N_MAX = 96;

var FIELD = new Float32Array(N_MAX);
var FIELD_V = new Float32Array(N_MAX);
var XS = new Float32Array(N_MAX);      // 采样点的 x（只在量尺寸时算）
var YS = new Float32Array(N_MAX);      // 这一帧水线的 y
var fieldN = 0;                        // 当前采样点数，0 = 没在跑
var waveT = 0;                         // 走了多少秒，只用来推进环境起伏的相位
var surfEl = null;
var surfCtx = null;
var surfGrad = null;
var surfW = 0;
var surfH = 0;
var surfRO = null;
var rafId = 0;
var lastTs = 0;
var acc = 0;

/* 推一步（固定 1/60 秒）。h 只在第二个循环里改，所以第一个循环里读到的
 * h[i-1] / h[i+1] 一定是**上一步的**值 —— 这点别改，改成就地更新会发散。 */
function stepField() {
  var h = FIELD;
  var v = FIELD_V;
  var n = fieldN;
  for (var i = 0; i < n; i++) {
    var lap = h[i > 0 ? i - 1 : 1] + h[i < n - 1 ? i + 1 : n - 2] - 2 * h[i];
    v[i] = (v[i] + lap * COUPLE) * DAMP;
  }
  for (var j = 0; j < n; j++) h[j] += v[j];
  /* 两侧当墙（Neumann）：水面贴着屏幕边上爬，不往屏幕外的空气里漏 */
  h[0] = h[1];
  h[n - 1] = h[n - 2];
  v[0] = v[1];
  v[n - 1] = v[n - 2];
}

/* 点一下：在 x 处按一个高斯凹陷。压下去多少，别处就抬起来多少 ——
 * 水面不该凭空少一块水。少了这一步，每点一下水面就**永久**矮一格：
 * 阻尼只衰减速度，去不掉位移的均值。 */
function kick(x) {
  var n = fieldN;
  if (!n || !surfW) return;
  var at = (x / surfW) * (n - 1);   // x 是视口坐标，水面这一层铺满整幅宽
  var k = 3.2;                      // 高斯半径（采样点数）：一下点下去压三格宽
  var sum = 0;
  for (var i = 0; i < n; i++) {
    var d = (i - at) / k;
    var dip = Math.exp(-d * d) * PUSH;
    FIELD[i] -= dip;
    sum += dip;
  }
  var m = sum / n;
  for (var j = 0; j < n; j++) FIELD[j] += m;
}

/* 把这一帧的水线描出来。平滑用「以采样点为控制点、以中点为落点」的二次贝塞尔：
 * 采样本就 12px 一根，直接 lineTo 能看出折线。 */
function traceSurface(g) {
  var n = fieldN;
  g.beginPath();
  g.moveTo(XS[0], YS[0]);
  for (var i = 1; i < n - 1; i++) {
    g.quadraticCurveTo(XS[i], YS[i],
      (XS[i] + XS[i + 1]) / 2, (YS[i] + YS[i + 1]) / 2);
  }
  g.lineTo(XS[n - 1], YS[n - 1]);
}

function drawField() {
  if (!surfCtx || !fieldN) return;
  var g = surfCtx;
  var n = fieldN;
  var w = surfW;
  var hh = surfH;
  var mid = hh / 2;       // 静水面在 canvas 的正中间
  var amp = mid * 0.9;    // 留一成给线宽与钳位，别把浪尖切平
  var t = waveT;

  for (var i = 0; i < n; i++) {
    var u = n > 1 ? i / (n - 1) : 0;
    /* 宁静时的那口气：两条极慢的正弦叠起来，只在画的时候加，不进方程 ——
     * 它不需要守恒，也不该被阻尼吃掉。合起来 ±0.1 幅（约 2px），
     * 不看的时候是「水在轻轻起伏」，盯着看也不觉得在演。 */
    var amb = Math.sin(u * 7.3 + t * 0.9) * 0.055 +
              Math.sin(u * 4.1 - t * 0.62) * 0.045;
    var y = mid - (FIELD[i] + amb) * amp;
    YS[i] = y < 3 ? 3 : (y > hh - 3 ? hh - 3 : y);
  }

  g.clearRect(0, 0, w, hh);

  /* 水面那张渐变按 canvas 的高度排：最上面几乎透明（浪尖是薄薄一层水，
   * 亮得能透出纸色），到最下面正好等于 .w-deep 的起始色 —— 两截接得上，
   * 才没有一条横缝。 */
  if (!surfGrad) {
    surfGrad = g.createLinearGradient(0, 0, 0, hh);
    surfGrad.addColorStop(0, 'rgba(150, 210, 220, .05)');
    surfGrad.addColorStop(1, 'rgba(140, 203, 214, .30)');
  }

  traceSurface(g);
  g.lineTo(w, hh);
  g.lineTo(0, hh);
  g.closePath();
  g.fillStyle = surfGrad;
  g.fill();

  /* 浪峰：先垫一道压低的深青（往下 2.2px，落在水里当浪的背光面），
   * 再压一道白亮线。顺序别反 —— 白线是「浪尖反的那点光」，得压在最上面。
   * 深青那道别调浓：它一浓，水面就成了一条灰色的缎带，不像水。 */
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.save();
  g.translate(0, 2.2);
  traceSurface(g);
  g.strokeStyle = 'rgba(52, 126, 150, .13)';
  g.lineWidth = 4;
  g.stroke();
  g.restore();

  traceSurface(g);
  g.strokeStyle = 'rgba(255, 255, 255, .94)';
  g.lineWidth = 1.6;
  g.stroke();
}

/* 量 canvas 的尺寸（只由 ResizeObserver 触发，不在每帧里读 clientWidth ——
 * 那会让浏览器每帧强制刷一次样式）。--amp 由 styles/base/effects.css 说了算，
 * 这里从量到的高度反推，免得同一条规矩写两遍还写岔。 */
function sizeSurf() {
  if (!surfEl || !surfCtx) return;
  var w = Math.round(surfEl.clientWidth || 0);
  var hh = Math.round(surfEl.clientHeight || 0);
  if (!w || !hh) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  surfW = w;
  surfH = hh;
  if (surfEl.width !== Math.round(w * dpr) ||
      surfEl.height !== Math.round(hh * dpr)) {
    surfEl.width = Math.round(w * dpr);
    surfEl.height = Math.round(hh * dpr);
  }
  surfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* 12px 一个采样点：390 宽 → 32 个。再密也画不出更多细节，只是多算几次；
   * 再疏，浪峰就成了一条折线。 */
  var n = Math.max(12, Math.min(N_MAX, Math.round(w / 12)));
  if (n !== fieldN) {
    fieldN = n;
    FIELD.fill(0, 0, n);
    FIELD_V.fill(0, 0, n);
  }
  for (var i = 0; i < n; i++) XS[i] = n > 1 ? (i / (n - 1)) * w : 0;
  surfGrad = null;
  drawField();      // 先画一帧，别让水面空着一块等下一帧
}

function tickWave(ts) {
  rafId = window.requestAnimationFrame(tickWave);
  if (!lastTs) lastTs = ts;
  var dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.2) dt = 0.2;     // 切回标签页时别一口气补上几十步
  waveT += dt;
  acc += dt;
  var guard = 0;
  while (acc >= STEP && guard < 4) {
    stepField();
    acc -= STEP;
    guard++;
  }
  if (guard >= 4) acc = 0;    // 追不上就不追了，宁可慢一点也别越拖越远
  drawField();
}

/* 水面铺上了：接过 canvas，把波动引擎点着。 */
function startWave() {
  var cv = bgEl && bgEl.querySelector('.w-surf');
  if (!cv || !cv.getContext) return;
  if (rafId && surfEl === cv) return;
  surfEl = cv;
  surfCtx = cv.getContext('2d');
  lastTs = 0;
  acc = 0;
  waveT = 0;
  if (!surfRO && window.ResizeObserver) {
    surfRO = new ResizeObserver(function () { sizeSurf(); });
  }
  if (surfRO) surfRO.observe(cv);
  sizeSurf();
  if (!rafId) rafId = window.requestAnimationFrame(tickWave);
}

/* 水面撤了：引擎必须停。这个 rAF 自己续自己，不停就会一直跑到天荒地老，
 * 而且 surfEl 已经跟着 innerHTML 一起没了。 */
function stopWave() {
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (surfRO) {
    surfRO.disconnect();
    surfRO = null;
  }
  surfEl = null;
  surfCtx = null;
  surfGrad = null;
  fieldN = 0;
  lastTs = 0;
  acc = 0;
}

/* 点一下 = 把水面按下去。按在哪儿就凹在哪儿（x 直接换算成采样点），
 * 波从那儿往两边跑、撞到屏幕边上弹回来，两三秒后自己静下去。
 *
 * 浮层里的点击归面板（点按钮、点背板关面板），不往水里捅；右键 / 中键也不算。
 * 引导面板（.coach）盖着半屏，点「下一步」不该顺手掀一下水。
 * 注意这一条**跟棋盘无关**：棋子落在哪儿，水就在谁的底下 —— 那是背景的事。 */
document.addEventListener('pointerdown', function (e) {
  if (!tideOn || REDUCE_MOTION || e.button !== 0) return;
  var t = e.target;
  if (t && t.closest && t.closest('.sheet-wrap, .coach')) return;
  kick(e.clientX);
}, true);

function buildBg(field) {
  if (!bgEl) {
    bgEl = document.createElement('div');
    bgEl.className = 'bg-fx';
    bgEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bgEl);
  }
  /* 先停引擎再换 markup：innerHTML 会把旧 canvas 一起扔掉，
   * 扔完之后引擎手里那只 canvas 就成了孤儿，还在往里画（白烧 CPU）。 */
  stopWave();
  /* 先把水位摆好，再插 markup：水块一出生就落在该落的地方，
   * 不会先从屏幕底下涨上来（那时还有 .62s 的过渡，看着像开机动画） */
  paintTide();
  bgEl.innerHTML = field;
  return bgEl;
}

/* 换 / 关背景：选中「无」（或系统要求少动画）就把整层收起来。
 * 收起来用 hidden（[hidden] { display: none }），动画跟着停，不白烧电。
 * 顺手决定 tideOn：只有水面才开波动引擎，水位也只在这时才算。 */
function applyBgLayer() {
  var o = findOf('bg', settings.bgStyle);
  var scene = o && o.id !== 'none' ? BG_SCENES[o.id] : null;
  tideOn = !!(scene && o.id === 'tide') && !REDUCE_MOTION;
  /* 换成几何 / 无 / 少动画了：波动引擎跟着停 —— 它是个每帧都跑的自续 rAF，
   * 留着既没用，还在往一只已经不在文档里的 canvas 上画。 */
  if (!tideOn) stopWave();
  if (!scene || REDUCE_MOTION) {
    if (bgEl) bgEl.hidden = true;
    return;
  }
  buildBg(scene()).hidden = false;
  if (tideOn) startWave();
}

/* ==========================================================
   四、棋盘滤镜 / 模糊背景
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
