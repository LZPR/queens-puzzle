/* ============================================================================
 * panels/slot.js · 幸运抽奖（老虎机）
 * ----------------------------------------------------------------------------
 * 第一次解开某一挡的每日挑战，结算界面送一次抽奖（四挡各一次，core/draw.js
 * 记账）。入口在 ui/panels/result.js 的「抽一次奖」按钮，这里只有机器本身：
 *
 *   · 视觉与手感来自 prototype/slot-machine.html：拉杆（可拖 / 空格也行）、
 *     三条转轮按速度动态模糊、奖品条按结果分档点亮；
 *   · 不用抽奖券：面板开着就能抽，抽一次就完（resolve 时 markDrawn），
 *     转动中 Esc 关不掉（canClose 拦住），抽完「收下」回结算界面；
 *   · 概率由 drawOutcome() 统一控（三连 0.6% / 三个一样 5.4% / 两个一样 24% /
 *     空 70%），?luck=triple|pair|none|jackpot 可以钉死档位，给自动化测试用；
 *   · 具体奖励还没定：奖品表 PRIZES 先照原型占位，发奖逻辑等定下来再接。
 * ========================================================================== */

import { buzz, sfx } from '../../core/audio.js';
import { DIFF_BANDS } from '../../core/config.js';
import { fxEl } from '../../core/dom.js';
import { markDrawn } from '../../core/draw.js';
import { DAILY_TIERS, dayKey, dayLabel } from '../../core/daily.js';
import { createSheet } from '../../core/sheet.js';
import { state, view } from '../../core/state.js';
import { showResult } from './result.js';

export var HTML = /* html */ `
<div class="slot" id="slot" hidden>
  <div class="slot-card" role="dialog" aria-modal="true" aria-labelledby="slotTitle">
    <div class="slot-head">
      <div class="slot-brand">
        <p class="slot-kicker">LUCKY DRAW</p>
        <h2 class="slot-title" id="slotTitle">幸运抽奖</h2>
      </div>
      <button class="icon-btn" id="btnCloseSlot" type="button" aria-label="关闭抽奖">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18"></path>
        </svg>
      </button>
    </div>
    <p class="slot-note" id="slotNote">第一次解开这一挡的奖励，只能抽这一次。</p>

    <div class="slot-stage">
      <div class="slot-machine" id="slotMachine">
        <div class="slot-cab">
          <div class="slot-marquee" data-bulbs></div>

          <div class="slot-window">
            <div class="slot-reel" data-i="0"><div class="slot-strip"></div></div>
            <div class="slot-reel" data-i="1"><div class="slot-strip"></div></div>
            <div class="slot-reel" data-i="2"><div class="slot-strip"></div></div>
            <div class="slot-payline" aria-hidden="true"></div>
          </div>

          <div class="slot-marquee" data-bulbs></div>

          <div class="slot-cab-foot">
            <span>PULL</span>
            <span class="slot-pull-tip">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
                   stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </span>
          </div>
        </div>
      </div>

      <div class="slot-lever" id="slotLever">
        <svg class="slot-lever-track" id="slotLeverTrack" aria-hidden="true">
          <path class="slot-track-base" id="slotTrackBase"></path>
          <path class="slot-track-on" id="slotTrackOn" pathLength="1"></path>
        </svg>

        <div class="slot-lever-arm" id="slotLeverArm">
          <div class="slot-lever-rod"></div>
          <div class="slot-lever-knob" id="slotLeverKnob" role="button" tabindex="0"
               aria-label="向下拉动拉杆抽奖"></div>
        </div>

        <div class="slot-lever-hinge" aria-hidden="true"></div>
      </div>
    </div>

    <section class="slot-prize" id="slotPrize" data-tone="idle" aria-live="polite">
      <div class="slot-prize-ico" id="slotPrizeIco"></div>
      <div class="slot-prize-txt">
        <b id="slotPrizeName">拉动右侧的杆子</b>
        <span id="slotPrizeNote">拖动或按空格开抽</span>
      </div>
    </section>

    <button class="btn sheet-done" id="btnSlotDone" type="button">收下</button>
  </div>
</div>`;

var el = null, card = null, noteEl = null;
var machineEl = null, leverEl = null, knobEl = null;
var prizeBar = null, prizeIco = null, prizeName = null, prizeNote = null;

var sheet = null;

/* 这一轮的机器状态：busy = 转着（Esc 拦住），drawn = 这一开已经抽过了 */
var busy = false;

/* 测试模式（?slot= 开进来的那一开）：抽了不记账，关面板也不回结算层 */
var testMode = false;

/* ==========================================================
   0. 小工具
   ========================================================== */
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ==========================================================
   1. 奖品：符号即奖品（奖励待定，名字先照原型占位）
   ========================================================== */
var ICONS = {
  hint: `<path d="M12 3.4a5.7 5.7 0 0 0-3.4 10.3c.6.45 1 1.1 1 1.85V16h4.8v-.45c0-.75.4-1.4 1-1.85A5.7 5.7 0 0 0 12 3.4z"/>
         <path d="M10.2 19.2h3.6M11 21.4h2"/>`,
  undo: `<path d="M4.2 10h9.4a5.1 5.1 0 0 1 0 10.2H8.4"/>
         <path d="M8.4 5.5 3.9 10l4.5 4.5"/>`,
  ticket: `<path d="M4 8.6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.1a2.35 2.35 0 0 0 0 4.6v1.1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.1a2.35 2.35 0 0 0 0-4.6z"/>
           <path d="M14.2 7.6v8.8" stroke-dasharray="2 2.6"/>`,
  crown: `<path d="M3.4 7.4l4.1 3.2L12 5l4.5 5.6 4.1-3.2-1.8 11.1H5.2z"/>
          <path d="M7 15.6h10"/>`,
  star: `<path d="M12 3.2l2.7 5.6 6.1.86-4.44 4.3 1.07 6.05L12 17.05l-5.43 2.96 1.07-6.05L3.2 9.66l6.1-.86z"/>`,
  gem: `<path d="M7.2 3.6h9.6l3.9 6.1-8.7 10.9-8.7-10.9z"/>
        <path d="M3.2 9.7h17.6M9.2 9.7 12 20.4l2.8-10.7L12 3.6z"/>`,
  /* 只在「什么都没中」的奖品条上用，不进转轮 */
  blank: `<circle cx="12" cy="12" r="7.4" stroke-dasharray="3.2 3.4"/>
          <path d="M9.5 12h5"/>`
};

function icon(k) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>';
}

var PRIZES = {
  hint:   { full: '提示券 ×1',  half: '提示券 ×1',  note: '卡住时点一下，替你摆一颗' },
  undo:   { full: '撤销券 ×1',  half: '撤销券 ×1',  note: '多退一步，少一步悔恨' },
  ticket: { full: '抽奖券 ×1',  half: '抽奖券 ×1',  note: '奖励待定 · 先占个位' },
  crown:  { full: '皇冠 ×1',    half: '皇冠碎片 ×1', note: '奖励待定 · 先占个位' },
  star:   { full: '免提示卡',   half: '提示券 ×2',  note: '这一局什么时候都能看提示' },
  gem:    { full: '钻石 ×30',   half: '钻石 ×12',   note: '奖励待定 · 先占个位' }
};

var KEYS = Object.keys(PRIZES);
var WEIGHT = { hint: 30, undo: 26, ticket: 17, crown: 12, star: 9, gem: 6 };

function pickSymbol(exclude) {
  var pool = KEYS.filter(function (k) { return k !== exclude; });
  var total = 0, i;
  for (i = 0; i < pool.length; i++) total += WEIGHT[pool[i]];
  var r = Math.random() * total;
  for (i = 0; i < pool.length; i++) {
    r -= WEIGHT[pool[i]];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function pickDistinct(n) {
  var out = [];
  while (out.length < n) {
    var k = pickSymbol();
    if (out.indexOf(k) < 0) out.push(k);
  }
  return out;
}

/* 档位：三连 0.6% + 三个一样 5.4% + 两个一样 24% + 空 70%
   ?luck=triple / pair / none / jackpot 可以钉死档位，专门用来看某一种结局 */
var FORCE = new URLSearchParams(location.search).get('luck');

/* ?slot=easy|mid|hard|extreme：开机直接把抽奖面板拉起来，而且抽了不记账——
   专门用来看机器、调手感，不用先去赢一盘每日挑战。跟 ?luck= 可以叠着用。 */
var TEST_TIER = (function () {
  var t = new URLSearchParams(location.search).get('slot');
  return DAILY_TIERS.indexOf(t) >= 0 ? t : null;
})();

function drawOutcome() {
  var r = Math.random(), tier;
  if (r < 0.006) tier = 'jackpot';
  else if (r < 0.06) tier = 'triple';
  else if (r < 0.30) tier = 'pair';
  else tier = 'none';
  if (FORCE && ['jackpot', 'triple', 'pair', 'none'].indexOf(FORCE) >= 0) tier = FORCE;

  var i, s, o, arr;
  if (tier === 'none') return { tier: tier, reels: pickDistinct(3), prize: null };

  if (tier === 'pair') {
    s = pickSymbol();
    o = pickSymbol(s);
    arr = [s, s, o].sort(function () { return Math.random() - 0.5; });
    return { tier: tier, reels: arr, prize: { key: s, half: true } };
  }

  // 三个一样：大奖只从最稀的两个里出
  var key = tier === 'jackpot' ? (Math.random() < 0.68 ? 'gem' : 'star') : pickSymbol();
  return { tier: tier, reels: [key, key, key], prize: { key: key, half: false } };
}

/* ==========================================================
   2. 拉杆
   ----------------------------------------------------------
   手感靠三件事：
     a. 指针位移 → --pull 的映射留了一点「反向缓冲」（拖过头会硬回来）
     b. 杆子的角度走 --pull 的 CSS transition，回弹用带回火的贝塞尔
     c. 松手过了 0.66（或者只是点了一下）就开抽：先「砸」到底再回弹
   ========================================================== */
var lever = { pull: 0, dragging: false, startY: 0, startT: 0, travel: 120 };

/* 只改数，怎么过渡由 .slot-lever 上的三个类决定（is-drag / is-slam / is-free） */
function setPull(v) {
  lever.pull = v;
  leverEl.style.setProperty('--pull', v.toFixed(4));
}

/* 拉到底要拖多远：跟屏幕高度走，手机上一把能撸到底 */
function travelPx() {
  return clamp(window.innerHeight * 0.14, 96, 128);
}

function onDown(e) {
  if (busy || !sheet.isOpen()) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  lever.dragging = true;
  lever.startY = e.clientY;
  lever.startT = performance.now();
  lever.travel = travelPx();
  leverEl.classList.add('is-drag');
  leverEl.classList.remove('is-free', 'is-slam');
  try { knobEl.setPointerCapture(e.pointerId); } catch (_) { /* 老浏览器就算了 */ }
}

function onMove(e) {
  if (!lever.dragging) return;
  var dy = e.clientY - lever.startY;
  var p;
  if (dy <= 0) {
    p = 0;                                  // 往上推不给动，杆子是死的
  } else {
    p = dy / lever.travel;
    if (p > 1) p = 1 + (p - 1) * 0.22;      // 拖过头：只给一点位移，硬回来
    p = Math.min(p, 1.1);
  }
  setPull(p);
}

function onUp(e) {
  if (!lever.dragging) return;
  lever.dragging = false;
  leverEl.classList.remove('is-drag');

  var dt = performance.now() - lever.startT;
  var tapped = Math.abs((e.clientY || 0) - lever.startY) < 8 && dt < 520;

  if (tapped || lever.pull >= 0.66) {
    trigger();
  } else {
    sfx('slotNope');
    springBack();
  }
}

function springBack() {
  leverEl.classList.remove('is-slam');
  leverEl.classList.add('is-free');
  lever.pull = 0;
  leverEl.style.setProperty('--pull', '0');
}

/* 砸到底：先极速推到 1，转轮起步之后再回弹 */
function slam() {
  leverEl.classList.remove('is-free');
  leverEl.classList.add('is-slam');
  leverEl.style.setProperty('--pull', '1');
  lever.pull = 1;
}

/* 轨道弧：圆规一支脚扎在轴心上，从「收着」划到「拉到底」。
   弧长交给 pathLength=1 归一化，CSS 那边只吃 --pull 就够了。 */
function layoutTrack() {
  if (!leverEl || !el || el.hidden) return;
  var arm = document.getElementById('slotLeverArm');
  var W = leverEl.clientWidth;
  var H = leverEl.clientHeight;
  var L = arm.offsetHeight || 100;
  var R = L + 26;

  var cs = getComputedStyle(document.documentElement);
  var pivotY = parseFloat(cs.getPropertyValue('--slot-pivot-y')) || 26;
  var rest = parseFloat(cs.getPropertyValue('--slot-rest')) || 18;
  var full = parseFloat(cs.getPropertyValue('--slot-full')) || 58;

  var cx = 0, cy = H - pivotY;
  var at = function (deg) {
    var a = deg * Math.PI / 180;
    return [cx + Math.sin(a) * R, cy - Math.cos(a) * R];
  };
  var p1 = at(rest), p2 = at(full);

  document.getElementById('slotLeverTrack').setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var d = 'M ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
    ' A ' + R + ' ' + R + ' 0 0 1 ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
  document.getElementById('slotTrackBase').setAttribute('d', d);
  document.getElementById('slotTrackOn').setAttribute('d', d);
}

/* ==========================================================
   3. 转轮
   ========================================================== */
var reels = [];

function buildStrip(strip, keys) {
  var out = '';
  for (var i = 0; i < keys.length; i++) {
    out += '<div class="slot-sym" data-k="' + keys[i] + '">' + icon(keys[i]) + '</div>';
  }
  strip.innerHTML = out;
}

/* 开面板先摆一盘：摆成「每行三个都不一样」的九宫格，别让中奖线
   一开机就三条同花，看着像已经中过了。 */
function idleFill() {
  if (!el || el.hidden || !reels.length) return;
  var grid = [[], [], []];
  for (var row = 0; row < 3; row++) {
    for (var col = 0; col < 3; col++) {
      var k, n = 0;
      do { k = pickSymbol(); n++; }
      while ((grid[row].indexOf(k) >= 0 || grid[0][col] === k) && n < 24);
      grid[row][col] = k;
    }
  }
  reels.forEach(function (r, c) {
    buildStrip(r.strip, [grid[0][c], grid[1][c], grid[2][c]]);
    r.strip.style.transform = 'translateY(0px)';
    r.el.classList.remove('is-hit');
  });
}

/* 把 cubic-bezier 变成可以按时间取进度的函数（打点要跟它对上） */
function makeEasing(x1, y1, x2, y2) {
  var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  var sx = function (t) { return ((ax * t + bx) * t + cx) * t; };
  var sy = function (t) { return ((ay * t + by) * t + cy) * t; };
  var dx = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
  return function (x) {
    var t = x;
    for (var i = 0; i < 6; i++) {
      var d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      var err = sx(t) - x;
      if (Math.abs(err) < 1e-6) break;
      t -= err / d;
    }
    return sy(clamp(t, 0, 1));
  };
}

var SPIN_EASE = [0.15, 0.68, 0.14, 1];
var easeFn = makeEasing.apply(null, SPIN_EASE);

/* ---- 动态模糊只跟「此刻转得多快」有关：按每个时刻的真实速度取样，
   速度掉多少，模糊就掉多少——不然轮子慢成爬，画面上还糊着一层。 ---- */
var SPEED_H = 1e-3;
function spinSpeed(t) {
  var a = easeFn(Math.max(0, t - SPEED_H));
  var b = easeFn(Math.min(1, t + SPEED_H));
  return (b - a) / (2 * SPEED_H);
}

var SPEED_MAX = (function () {
  var m = 0;
  for (var i = 0; i <= 100; i++) m = Math.max(m, spinSpeed(i / 100));
  return m;
})();

/* 模糊值量化到 0.4px 一档：滤镜每变一次都要重新栅格化，
   连续变化的模糊值就是每帧一次全条重画，掉帧主要在这儿。
   分段量化后栅格化次数砍掉一大半，肉眼分不出档差。 */
var BLUR_STEP = 0.4;

function quantBlur(v) {
  return Math.round(v / BLUR_STEP) * BLUR_STEP;
}

function blurKeyframes(dur, dist) {
  var peak = SPEED_MAX * dist / dur;
  var maxBlur = Math.min(2.4, peak * 0.85);
  var N = 10;
  var frames = [{ filter: 'blur(0px)', offset: 0, easing: 'linear' }];
  for (var i = 1; i < N; i++) {
    var t = i / N;
    var v = Math.max(0, spinSpeed(t) / SPEED_MAX);
    frames.push({ filter: 'blur(' + quantBlur(maxBlur * v).toFixed(2) + 'px)', offset: t, easing: 'linear' });
  }
  frames.push({ filter: 'blur(0px)', offset: 1 });
  return frames;
}

/* 滚过一格就滴一声，间隔按缓动自己算——越到后面越慢。
   高速段一帧能跨好几格，逐格排 tick 会在一帧里塞十几个振荡器：
   限一个最小间隔（30ms），听感不变，音频节点少一大截。 */
function scheduleTicks(dur, dist, cell) {
  var last = -1, lastT = -1e9;
  for (var k = 0; k <= 260; k++) {
    var t = k / 260;
    var idx = Math.floor((easeFn(t) * dist) / cell);
    if (idx === last || t * dur - lastT < 30) continue;
    last = idx;
    lastT = t * dur;
    setTimeout(function () { sfx('slotTick'); }, lastT);
  }
}

function kickMachine() {
  machineEl.classList.remove('is-kick');
  void machineEl.offsetWidth;
  machineEl.classList.add('is-kick');
}

function spinReel(i, midKey, dur) {
  var r = reels[i];
  var cell = r.el.offsetHeight / 3;
  var N = 24;

  var keys = [];
  for (var j = 0; j < N; j++) keys.push(pickSymbol());
  // 最后三格决定停下来时窗口里的三行（中间那行是中奖线）
  keys[N - 4] = pickSymbol(midKey);
  keys[N - 3] = midKey;
  keys[N - 2] = pickSymbol(midKey);
  buildStrip(r.strip, keys);

  var dist = (N - 4) * cell;
  r.strip.style.transform = 'translateY(0px)';

  var move = r.strip.animate(
    [{ transform: 'translateY(0px)' }, { transform: 'translateY(' + (-dist) + 'px)' }],
    { duration: dur, easing: 'cubic-bezier(' + SPIN_EASE.join(',') + ')', fill: 'forwards' }
  );
  var blur = r.strip.animate(blurKeyframes(dur, dist), { duration: dur, easing: 'linear' });

  scheduleTicks(dur, dist, cell);

  return move.finished.then(function () {
    r.strip.style.transform = 'translateY(' + (-dist) + 'px)';
    move.cancel();
    blur.cancel();
    r.strip.style.filter = '';
    r.el.classList.add('is-hit');
    setTimeout(function () { r.el.classList.remove('is-hit'); }, 620);
    sfx('slotThunk');
    // 停稳那一下机身顶一下
    kickMachine();
  }).catch(function () { /* 面板被强收时动画会 abort，随它去 */ });
}

/* ==========================================================
   4. 奖品条 / 礼花
   ========================================================== */
function setPrize(tone, icoHTML, name, note) {
  prizeBar.dataset.tone = tone;
  // 换 key 让入场动画每次都能重放
  prizeBar.style.animation = 'none';
  void prizeBar.offsetWidth;
  prizeBar.style.animation = '';
  prizeIco.innerHTML = icoHTML;
  prizeName.textContent = name;
  prizeNote.textContent = note;
}

var FX_COLORS = ['#FFD93D', '#FFB03A', '#FF5C5C', '#22B573', '#FFF0B8'];

function confetti(n) {
  for (var i = 0; i < n; i++) {
    var p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = (4 + Math.random() * 92) + '%';
    p.style.top = '18%';
    p.style.setProperty('--c', pick(FX_COLORS));
    p.style.setProperty('--x', (Math.random() * 280 - 140).toFixed(0) + 'px');
    p.style.setProperty('--y', (320 + Math.random() * 320).toFixed(0) + 'px');
    p.style.setProperty('--r', (Math.random() * 900 - 450).toFixed(0) + 'deg');
    p.style.setProperty('--d', (Math.random() * 260).toFixed(0) + 'ms');
    if (Math.random() < 0.34) p.style.borderRadius = '50%';
    fxEl.appendChild(p);
    setTimeout(function (node) {
      return function () { if (node.parentNode) node.parentNode.removeChild(node); };
    }(p), 2000);
  }
}

/* ==========================================================
   5. 一次完整的抽奖
   ========================================================== */
async function trigger() {
  if (busy || !sheet.isOpen()) return;

  busy = true;
  document.getElementById('slot').classList.add('is-spinning');
  setPrize('spinning', '<span class="slot-dots"><i></i><i></i><i></i></span>', '转动中…', '别急，让它停稳');
  slam();
  buzz(12);

  var out = drawOutcome();

  await wait(110);
  kickMachine();
  sfx('slotClack');
  springBack();       // 杆子回弹交给 --pull 的 transition

  /* 三轮停下的间隔就是悬念的长度；有戏的时候第三轮再多吊一会儿 */
  var durs = [1080, 1620, 2160];
  if (out.tier !== 'none') durs[2] += 420;

  await Promise.all(reels.map(function (_, i) { return spinReel(i, out.reels[i], durs[i]); }));

  resolve(out);

  // 资格到此为止：标记这一挡今天抽过了（core/draw.js）。
  // 测试模式（?slot=）不记，方便反复试。
  if (!testMode && state.daily) markDrawn(state.daily.day, state.daily.tier);

  busy = false;
  document.getElementById('slot').classList.remove('is-spinning');
}

function resolve(out) {
  if (!out.prize) {
    sfx('slotLose');
    setPrize('lose', icon('blank'), '谢谢参与', '三个都不重样 · 明天再来');
    return;
  }

  var p = PRIZES[out.prize.key];
  var name = out.prize.half ? p.half : p.full;
  var note = out.prize.half ? '两个一样 · 半份奖' : '三个一样！';

  if (out.tier === 'jackpot') {
    sfx('slotBig');
    confetti(70);
    setPrize('legend', icon(out.prize.key), name, note + ' · 传说档');
  } else if (out.tier === 'triple') {
    sfx('slotWin');
    confetti(48);
    setPrize('prize', icon(out.prize.key), name, note);
  } else {
    sfx('slotSmall');
    setPrize('half', icon(out.prize.key), name, note);
  }
}

/* ==========================================================
   6. 面板开关（createSheet：互斥 / Esc / Tab / 焦点）
   ========================================================== */
function paint() {
  var tier = TEST_TIER || (state.daily && state.daily.tier);
  var band = tier && DIFF_BANDS[tier];
  if (TEST_TIER) {
    testMode = true;
    noteEl.textContent = '测试模式：「' + (band ? band.name : TEST_TIER) + '」挡 · 抽了不记账 · 可反复试';
  } else {
    testMode = false;
    noteEl.textContent = '第一次解开「' + (band ? band.name : tier || '') + '」挡的奖励 · ' +
      dayLabel(state.daily ? state.daily.day : null) + ' · 只能抽这一次';
  }
  busy = false;
  lever.dragging = false;
  setPrize('idle', icon('ticket'), '拉动右侧的杆子', '拖动或按空格开抽');
}

export function openSlot() {
  if (!el || busy) return false;
  return sheet.open();
}

/* ?slot=<挡位>：boot 之后由 main.js 调一次，把面板直接拉起来。
 * 先礼让一小会儿（boot 可能恢复出结算层之类的临时浮层），一直被占就直接
 * 接管——这是调试参数，用户在链接里点名要它，得保证真的开得出来。 */
export function maybeOpenFromUrl() {
  if (!TEST_TIER || !el) return false;
  var tries = 0;
  (function attempt() {
    if (!el) return;
    if (view.sheet && ++tries <= 5) { window.setTimeout(attempt, 500); return; }
    openSlot();
  })();
  return true;
}

export function isSlotOpen() { return !!sheet && sheet.isOpen(); }

/* 自动化测试探针：机器忙不忙、奖品条现在什么档（见 tools/check-slot.mjs） */
export function slotProbe() {
  return {
    open: !!sheet && sheet.isOpen(),
    busy: busy,
    tone: prizeBar ? prizeBar.dataset.tone : null,
    prize: prizeName ? prizeName.textContent : '',
    reels: reels.length ? reels.map(function (r) { return r.strip.children.length; }) : []
  };
}

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  el = document.getElementById('slot');
  card = el.querySelector('.slot-card');
  noteEl = document.getElementById('slotNote');
  machineEl = document.getElementById('slotMachine');
  leverEl = document.getElementById('slotLever');
  knobEl = document.getElementById('slotLeverKnob');
  prizeBar = document.getElementById('slotPrize');
  prizeIco = document.getElementById('slotPrizeIco');
  prizeName = document.getElementById('slotPrizeName');
  prizeNote = document.getElementById('slotPrizeNote');

  reels = $$('.slot-reel', el).map(function (node) {
    return { el: node, strip: node.querySelector('.slot-strip') };
  });

  // 跑马灯的灯泡
  $$('[data-bulbs]', el).forEach(function (row) {
    var out = '';
    for (var i = 0; i < 13; i++) out += '<i style="--i:' + i + '"></i>';
    row.innerHTML = out;
  });

  sheet = createSheet({
    id: 'slot',
    wrap: el,
    inert: false,   // 整屏盖住 + 自己锁焦点，不把 #app 设成 inert
    panel: card,
    focusEl: function () { return knobEl; },
    beforeOpen: paint,
    afterOpen: function () {
      // 布局要等元素真的展开：先摆一盘、再画拉杆的轨道弧
      idleFill();
      layoutTrack();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (sheet.isOpen()) layoutTrack(); });
      }
    },
    /* 转动中不许关：Esc 拦住，抽完再看收 */
    canClose: function () { return !busy; },
    afterClose: function () {
      /* 抽完回结算界面（按钮已经收掉了，不会又跳进抽奖）。
       * 等一拍：浮层基座收层还没走完，当场开层会撞上。
       * 测试模式（?slot=）没有「这一局」，收掉就收掉了。 */
      if (!testMode && state.status === 'won') {
        setTimeout(function () { showResult(); }, 0);
      }
    },
    onKey: function (e) {
      if (e.code !== 'Space' || e.repeat) return;
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      e.preventDefault();
      trigger();
    }
  });

  // 拉杆：拖 / 点一下 / 键盘都算
  knobEl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  knobEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
  });

  document.getElementById('btnCloseSlot').addEventListener('click', function () { sheet.close(); });
  document.getElementById('btnSlotDone').addEventListener('click', function () { sheet.close(); });

  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (sheet.isOpen()) { layoutTrack(); idleFill(); }
    }, 140);
  });
}
