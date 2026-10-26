/* ============================================================================
 * panels/slot.js · 幸运抽奖（老虎机）
 * ----------------------------------------------------------------------------
 * 头一回解开某一挡的每日挑战，结算界面送一次抽奖。入口在 ui/panels/result.js
 * 的「抽一次奖」按钮，这里只有机器本身：
 *
 *   · 视觉与手感来自 prototype/slot-machine.html：拉杆（可拖 / 空格也行）、
 *     三条转轮按速度动态模糊、奖品条按结果分档点亮；
 *   · 不用抽奖券、不记账（没有「抽没抽过」的存档）：机器弹出资格就算用掉
 *     （view.drawUsed），默认只抽一杆；两个一样 / 抽中已解锁的面板里加送一杆，
 *     关掉或者错过都算放弃；
 *   · 转动中 Esc 关不掉（canClose 拦住），抽完「收下」回结算界面；
 *   · 奖品就是外观（core/unlock.js 的账本）：三个一样 = 解锁那套外观；
 *     两个一样 = 送一次再抽；抽中的那套已经解锁了 = 也送一次再抽；
 *   · 奖池里锁着的套占大多数、已解锁的只是占位的小份——转出来的
 *     「三个一样」绝大多数都是还没到手的；
 *   · 外观全都解锁了之后机器还在，但转不出任何奖励；
 *   · 概率由 drawOutcome() 统一控（三样解锁 15% / 两样再抽 44% /
 *     谢谢参与 41%），?luck=unlock|repeat|pair|none 可以钉死档位（只钉一抽），
 *     给自动化测试用；
 *   · ?slot=easy|mid|hard|extreme 开机直接把面板拉起来（测试模式，
 *     不占资格、可反复抽）。
 * ========================================================================== */

import { buzz, sfx } from '../../core/audio.js';
import { DIFF_BANDS } from '../../core/config.js';
import { fxEl } from '../../core/dom.js';
import { DAILY_TIERS, dayKey, dayLabel } from '../../core/daily.js';
import { REGION_COLORS } from '../../core/palette.js';
import { createSheet } from '../../core/sheet.js';
import { state, view } from '../../core/state.js';
import { allUnlocked, isUnlocked, unlock } from '../../core/unlock.js';
import { KIND, KINDS, listOf } from '../../looks/index.js';
import { surfaceInk } from '../../game/skin.js';
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
        <span id="slotPrizeNote">三个一样解锁外观 · 两个一样再抽一次</span>
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
   1. 奖池：转轮上转的就是外观（looks/index.js 登记的全部套目）
   ========================================================== */
/* 转轮里只有两枚符号不是外观：「谢谢参与」的空圈与「全都解锁了」的皇冠，
 * 都不进奖池。 */
var ICONS = {
  crown: `<path d="M3.4 7.4l4.1 3.2L12 5l4.5 5.6 4.1-3.2-1.8 11.1H5.2z"/>
          <path d="M7 15.6h10"/>`,
  /* 只在「什么都没中」的奖品条上用，不进转轮 */
  blank: `<circle cx="12" cy="12" r="7.4" stroke-dasharray="3.2 3.4"/>
          <path d="M9.5 12h5"/>`
};

function icon(k) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>';
}

/* 转轮符号的键是「kind:id」——四类外观里 id 各自起名，跨类可能撞，
 * 拼上类别才唯一定位到一套。 */
function entryKey(e) { return e.kind + ':' + e.o.id; }

/* 奖池的快照： locks 状态是活的（这一抽解锁了，下一抽就少一件），
 * 所以每次拉杆都重新抄一遍，别缓存。 */
function buildPool() {
  var out = [];
  for (var k = 0; k < KINDS.length; k++) {
    var kind = KINDS[k];
    var items = listOf(kind);
    for (var i = 0; i < items.length; i++) {
      out.push({ kind: kind, o: items[i], locked: !isUnlocked(kind, items[i].id) });
    }
  }
  return out;
}

/* 奖池的分量：没解锁的占大多数，已解锁的只是占位的小份
 * （5 : 1 —— 11 套里默认开 4 套，锁着的 7 套合计 35 份 vs 占位 4 份）。
 * 权重是按套算的，不按类偏心。 */
var WEIGHT_OPEN = 5, WEIGHT_GOT = 1;

function pickEntry(pool, exclude) {
  var total = 0, i;
  for (i = 0; i < pool.length; i++) {
    if (exclude && entryKey(pool[i]) === exclude) continue;
    total += pool[i].locked ? WEIGHT_OPEN : WEIGHT_GOT;
  }
  var r = Math.random() * total;
  for (i = 0; i < pool.length; i++) {
    if (exclude && entryKey(pool[i]) === exclude) continue;
    r -= pool[i].locked ? WEIGHT_OPEN : WEIGHT_GOT;
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/* 锁着的套里按登记顺序数第一套：?luck=unlock 用它钉出确定的结果 */
function firstLocked(pool) {
  for (var i = 0; i < pool.length; i++) if (pool[i].locked) return pool[i];
  return null;
}

function pickDistinctKeys(pool, n) {
  var out = [];
  while (out.length < n) {
    var e = pickEntry(pool);
    if (out.indexOf(entryKey(e)) < 0) out.push(entryKey(e));
  }
  return out;
}

/* ---- 转轮 / 奖品条上的小画：按外观自己的画法缩一份 ---- */
var SKIN_PICKS = [8, 14, 5, 10];   // 色块预览用哪四块色（跟外观展柜同一组）

function symIcon(e) {
  var o = e.o;
  /* 色块：一小块 2×2 的盘（底色 + 图形），浓度放大的路数跟外观展柜一样——
   * 缩到这么小还按棋盘的浓度画就等于什么都没画。 */
  if (e.kind === 'surface') {
    var c = 50;
    var k = o.motifs ? Math.max(.02, Math.min(.5, (o.tone || 0) * 3.2)) : 0;
    var out = '';
    for (var i = 0; i < 4; i++) {
      var ci = SKIN_PICKS[i] % REGION_COLORS.length;
      var color = REGION_COLORS[ci];
      var x = (i % 2) * c, y = ((i / 2) | 0) * c;
      out += '<rect x="' + x + '" y="' + y + '" width="' + c + '" height="' + c +
        '" fill="' + color + '"/>';
      if (o.motifs && o.motifs[ci]) {
        out += '<g transform="translate(' + x + ' ' + y + ') scale(.5)" fill="' +
          surfaceInk(color, o, k) + '">' + o.motifs[ci] + '</g>';
      }
    }
    return '<svg viewBox="0 0 100 100" style="stroke:none" aria-hidden="true">' + out + '</svg>';
  }
  /* 叉：跟棋盘上一套比例的两根斜杠 / 圆点 */
  if (e.kind === 'mark') {
    return o.preview === 'dot'
      ? '<svg viewBox="0 0 24 24" style="stroke:none" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="5.6" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  }
  /* 生命：插件里只有名字，画在这里——一颗心 / 一格血条 */
  if (e.kind === 'life') {
    return o.id === 'bar'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="3" y="7.5" width="18" height="9" rx="2.5"/>' +
        '<rect x="5.6" y="9.9" width="8.6" height="4.2" rx="1.2" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 24 24" style="stroke:none" aria-hidden="true">' +
        '<path fill="currentColor" d="M12 20.2S3.6 15 3.6 9.3C3.6 6.4 5.9 4.6 8.2 4.6c1.7 0 3 .9 3.8 2.1' +
        '.8-1.2 2.1-2.1 3.8-2.1 2.3 0 4.6 1.8 4.6 4.7C20.4 15 12 20.2 12 20.2z"/></svg>';
  }
  /* 皇后：直接用插件的整段画。转轮的 CSS 给 svg 上的是描边那套，
   * 剪影是填色的，垫一行 style 压回去。 */
  return o.svg.replace('<svg ', '<svg style="fill:currentColor;stroke:none" ');
}

/* 档位：三个一样 15%（锁着的 → 解锁；占位 → 也送一次再抽）
   + 两个一样 44%（送一次再抽）+ 谢谢参与 41%（到此为止）。
   ?luck=unlock|repeat|pair|none 可以钉死档位，专门用来看某一种结局；
   钉的那一下只管一抽，下一抽回到真随机（不然测试里两个一样的链条走不完）。 */
var FORCE = new URLSearchParams(location.search).get('luck');
if (FORCE && ['unlock', 'repeat', 'pair', 'none'].indexOf(FORCE) < 0) FORCE = null;

function forceOnce() {
  var f = FORCE;
  FORCE = null;
  return f;
}

/* ?slot=easy|mid|hard|extreme：开机直接把抽奖面板拉起来，而且抽了不记账——
   专门用来看机器、调手感，不用先去赢一盘每日挑战。跟 ?luck= 可以叠着用。 */
var TEST_TIER = (function () {
  var t = new URLSearchParams(location.search).get('slot');
  return DAILY_TIERS.indexOf(t) >= 0 ? t : null;
})();

function drawOutcome() {
  var pool = buildPool();

  /* 都抽完了：机器照转，但转不出任何东西——没有奖励、也没有再抽 */
  if (allUnlocked()) {
    return { tier: 'done', extra: false, reels: pickDistinctKeys(pool, 3), prize: null };
  }

  var tier = forceOnce();
  if (!tier) {
    var r = Math.random();
    tier = r < 0.15 ? 'unlock' : r < 0.59 ? 'pair' : 'none';
  }

  /* 三个一样：锁着的 → 解锁它；抽中的是占位（已解锁）→ 也送一次再抽 */
  if (tier === 'unlock') {
    var e = firstLocked(pool);
    /* 钉着要解锁但手里一套锁都没了：落回「都抽完了」 */
    if (!e) return { tier: 'done', extra: false, reels: pickDistinctKeys(pool, 3), prize: null };
    var key = entryKey(e);
    return {
      tier: e.locked ? 'unlock' : 'repeat',
      extra: !e.locked,
      reels: [key, key, key],
      prize: e
    };
  }
  /* 钉着要「已解锁的三个一样」：拿奖池头一枚（出厂默认那套，永远开着） */
  if (tier === 'repeat') {
    var head = pool[0], k2 = entryKey(head);
    return { tier: 'repeat', extra: true, reels: [k2, k2, k2], prize: head };
  }

  if (tier === 'pair') {
    var s = pickEntry(pool), o = pickEntry(pool, entryKey(s));
    var arr = [entryKey(s), entryKey(s), entryKey(o)].sort(function () {
      return Math.random() - 0.5;
    });
    return { tier: 'pair', extra: true, reels: arr, prize: s };
  }

  return { tier: 'none', extra: false, reels: pickDistinctKeys(pool, 3), prize: null };
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
    out += '<div class="slot-sym" data-k="' + keys[i] + '">' + symIconByKey(keys[i]) + '</div>';
  }
  strip.innerHTML = out;
}

/* 按键取画：转轮上滚的每一格都查它（filler 格随机填的也是外观） */
function symIconByKey(key) {
  var i = key.indexOf(':');
  var kind = key.slice(0, i), id = key.slice(i + 1);
  var items = listOf(kind) || [];
  for (var j = 0; j < items.length; j++) {
    if (items[j].id === id) return symIcon({ kind: kind, o: items[j] });
  }
  return icon('blank');
}

/* 开面板先摆一盘：摆成「每行三个都不一样」的九宫格，别让中奖线
   一开机就三条同花，看着像已经中过了。 */
function idleFill() {
  if (!el || el.hidden || !reels.length) return;
  var pool = buildPool();
  var grid = [[], [], []];
  for (var row = 0; row < 3; row++) {
    for (var col = 0; col < 3; col++) {
      var k, n = 0;
      do { k = entryKey(pickEntry(pool)); n++; }
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

  var pool = buildPool();
  var keys = [];
  for (var j = 0; j < N; j++) keys.push(entryKey(pickEntry(pool)));
  // 最后三格决定停下来时窗口里的三行（中间那行是中奖线）
  keys[N - 4] = entryKey(pickEntry(pool, midKey));
  keys[N - 3] = midKey;
  keys[N - 2] = entryKey(pickEntry(pool, midKey));
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
  if (out.tier === 'unlock' || out.tier === 'repeat') durs[2] += 420;

  await Promise.all(reels.map(function (_, i) { return spinReel(i, out.reels[i], durs[i]); }));

  resolve(out);

  busy = false;
  document.getElementById('slot').classList.remove('is-spinning');
}

function resolve(out) {
  /* 谢谢参与：三个都不重样 */
  if (out.tier === 'none') {
    sfx('slotLose');
    setPrize('lose', icon('blank'), '谢谢参与', '三个都不重样 · 明天的每日挑战再来看');
    return;
  }

  /* 都抽完了：机器还在，奖励没有了 */
  if (out.tier === 'done') {
    sfx('slotLose');
    setPrize('done', icon('crown'), '外观全都解锁了', '没有新的奖励了 · 谢谢参与');
    return;
  }

  var e = out.prize;
  var nm = KIND[e.kind].label + '「' + e.o.name + '」';

  /* 三个一样，而且这套还是锁着的：解锁，落定 */
  if (out.tier === 'unlock') {
    unlock(e.kind, e.o.id);
    sfx('slotBig');
    confetti(64);
    setPrize('prize', symIcon(e), nm + ' 解锁！', '去外观面板换上它');
    return;
  }

  /* 抽中的那套已经解锁（占位的小份）：不值钱，送一次再抽 */
  if (out.tier === 'repeat') {
    sfx('slotSmall');
    setPrize('half', symIcon(e), nm + '已经解锁', '再抽一次');
    return;
  }

  /* 两个一样：小奖不算中，送一次再抽 */
  sfx('slotSmall');
  setPrize('half', symIcon(e), '两个「' + e.o.name + '」', '再抽一次');
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
      dayLabel(state.daily ? state.daily.day : null) + ' · 只能抽这一次，关掉就当放弃';
  }
  busy = false;
  lever.dragging = false;
  setPrize('idle', icon('crown'), '拉动右侧的杆子', '三个一样解锁外观 · 两个一样再抽一次');
}

export function openSlot() {
  if (!el || busy) return false;
  var opened = sheet.open();
  /* 资格弹出即作数：这一杆抽不抽、抽成什么都只有这一次，
   * 关掉或者错过都不补（view.drawUsed，结果层据此收按钮）。
   * 测试模式（?slot=）不占资格，方便反复试。 */
  if (opened && !testMode) view.drawUsed = true;
  return opened;
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
