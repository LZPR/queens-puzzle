/* ============================================================================
 * panels/mismatch.js · 「没抽到够格的盘」
 * ----------------------------------------------------------------------------
 * 宁可先不出盘，也不让玩家玩一盘不符合设定的：这一档里抽不到分数落在
 * `DIFF_BANDS[x]` 的 `[min, max)` 区间里的盘时，由 app/puzzle.js 调 showMismatch()，
 * 那一盘**不装**。
 *
 * 注意它是个兜底，不是常规流程：puzzle 的 search() 会先替玩家多抽几秒
 * （默认 3 秒、极难 6 秒，见那边的 SEARCH_MS / SEARCH_MS_EXTREME），
 * 抽到了就当没这回事。等满还抽不到——这个档位
 * 在这个尺寸上根本够不着——才轮到这里。所以读数里报的是「找了多久」，
 * 不只是「抽了几张」：时间才是玩家刚才实际付出的东西。
 *
 * 两头都要拦，说法的方向正好相反：
 *   dir = 'low'  一张都没够到下限（「还不够困难」）→ 建议放大尺寸
 *   dir = 'high' 一张都超过了上限（「超出了困难」）→ 建议收小尺寸
 * 所以标题、两个读数的名字、按钮下面那句建议都由 dir 决定，别各写一套。
 *
 * 只给两条路：
 *   · 再抽一局：交给 puzzle 的 onRetry 再来一轮（同一尺寸、同一档）
 *   · 更换设置：打开「新的一局」面板并停在这一档上，可以换个更大的尺寸或换档
 *
 * 跟结果层一样不许 Esc 关掉：关掉之后既没新盘也没旧盘，只剩一块空棋盘。
 * 「继续尝试」这件事一定得由玩家自己决定——这就是这层的全部意义。
 * ========================================================================== */

import { announce } from '../../core/utils.js';
import { createSheet } from '../../core/sheet.js';
import { openSheetAt } from './newgame.js';

export var HTML = /* html */ `
<div class="result is-mismatch" id="mismatch" hidden>
  <div class="result-card" role="dialog" aria-modal="true" aria-labelledby="mmTitle" aria-describedby="mmSub">
    <p class="result-kicker" id="mmKicker">TOO EASY</p>
    <h2 class="result-title" id="mmTitle">还不够「极难」</h2>
    <p class="result-sub" id="mmSub">16×16 找了 6.0 秒，抽了 23 张</p>
    <div class="result-stats">
      <div class="result-stat"><b id="mmNeed">11.3</b><span id="mmNeedLabel">档位要求</span></div>
      <div class="result-stat"><b id="mmBest">11.1</b><span id="mmBestLabel">这批最高（困难）</span></div>
    </div>
    <button class="btn btn-hint" id="btnMmRetry" type="button">再抽一局</button>
    <div class="result-links">
      <button class="btn-text" id="btnMmSetup" type="button">更换设置</button>
    </div>
    <p class="mm-note" id="mmNote">同一档里盘越大越容易够格。</p>
  </div>
</div>`;

var el = null;          // #mismatch
var mmKicker = null, mmTitle = null, mmSub = null, mmNeed = null, mmNeedLabel = null;
var mmBest = null, mmBestLabel = null, mmNote = null;
var btnMmRetry = null, btnMmSetup = null;

var sheet = null;
/* 这一层要回调谁，只在开着的时候有效 */
var hook = null;

/* 按钮下面那句建议：说的是「该往哪边挪一格尺寸」。
 * dir='low' 是这批太软 → 放大；dir='high' 是这批太狠 → 收小。
 * 已经顶到这一档的边了，就别再劝他挪尺寸——劝他换档。 */
function nextHint(o) {
  var band = o.band, size = o.size;
  if (o.dir === 'high') {
    if (size > band.lo) {
      return '「' + band.name + '」里盘越大越容易过头：' + size + '×' + size +
        ' 都超了，试试 ' + (size - 1) + '×' + (size - 1) + '。';
    }
    return '这已经是「' + band.name + '」能开的最小的盘了：再抽一次，或者换个档位。';
  }
  if (size < band.hi) {
    return '「' + band.name + '」里盘越大越容易够格：' + size + '×' + size +
      ' 抽不到，就试试 ' + (size + 1) + '×' + (size + 1) + '。';
  }
  return '这已经是「' + band.name + '」能开的最大盘了：再抽一次，或者换个档位。';
}

export function showMismatch(o) {
  if (sheet.isOpen()) return;
  hook = o;
  fill(o);
  sheet.open();
}

/* 装上新盘 / 换了一局 / 收摊时都要把它收掉，否则会压在棋盘上 */
export function dismissMismatch() {
  if (!sheet.isOpen()) return;
  hook = null;
  sheet.close({ force: true });
}

/* 「找了多久」：一位小数就够，读数说的是「刚才等了这一截」 */
function waitText(ms) {
  return (Math.max(0, ms || 0) / 1000).toFixed(1) + ' 秒';
}

function fill(o) {
  var high = o.dir === 'high';
  var edge = high ? o.band.max : o.band.min;     // 差的那条线
  el.classList.toggle('is-over', high);

  mmKicker.textContent = high ? 'TOO HARD' : 'TOO EASY';
  mmTitle.textContent = (high ? '超出了「' : '还不够「') + o.band.name + '」';
  mmNeedLabel.textContent = high ? '档位上限' : '档位要求';
  /* 抽到的那张真实属于哪一档，挂在这个读数上：数值和「它是困难还是极难」
   * 是一件事，放进副标题会把那一行撑到两句（320 宽还会断在「最高 / 8.1」之间）。 */
  mmBestLabel.textContent = (high ? '这批最低' : '这批最高') + '（' + o.vibe.level + '）';
  mmNeed.textContent = edge.toFixed(1);
  mmBest.textContent = o.vibe.score.toFixed(1);
  // 副标题只说「刚才花了多少代价」：尺寸、等了多久、抽了几张
  mmSub.textContent = o.size + '×' + o.size + ' 找了 ' + waitText(o.waited) +
    '，抽了 ' + o.tried + ' 张';
  mmNote.textContent = nextHint(o);

  announce('没抽到「' + o.band.name + '」的盘：' + o.size + '×' + o.size + ' 找了 ' +
    waitText(o.waited) + '、抽了 ' + o.tried + ' 张，' + (high ? '最低 ' : '最高 ') +
    o.vibe.score.toFixed(1) +
    (high ? '，超过了上限 ' + edge.toFixed(1) : '，要 ' + edge.toFixed(1) + ' 起'));
}

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  el = document.getElementById('mismatch');
  mmKicker = document.getElementById('mmKicker');
  mmTitle = document.getElementById('mmTitle');
  mmSub = document.getElementById('mmSub');
  mmNeed = document.getElementById('mmNeed');
  mmNeedLabel = document.getElementById('mmNeedLabel');
  mmBest = document.getElementById('mmBest');
  mmBestLabel = document.getElementById('mmBestLabel');
  mmNote = document.getElementById('mmNote');
  btnMmRetry = document.getElementById('btnMmRetry');
  btnMmSetup = document.getElementById('btnMmSetup');

  /* Esc 关不掉：canClose 只认 force，只有在换盘 / 换局 / 点这两个按钮时才收。 */
  sheet = createSheet({
    id: 'mismatch',
    wrap: el,
    inert: false,   // 整屏盖住 + 自己锁焦点，不用把 #app 设成 inert
    panel: el.querySelector('.result-card'),
    focusEl: function () { return btnMmRetry; },
    /* Esc / 点背景都关不掉；只有换盘、换局、点这两个按钮时传 force 才收 */
    canClose: function (opt) { return !!(opt && opt.force); },
    beforeClose: function () { hook = null; }
  });

  btnMmRetry.addEventListener('click', function () {
    var h = hook;
    if (!h) return;
    // 先收层，再抽：抽出来的结果可能又不够格，那时会重新露一次
    sheet.close({ force: true });
    h.onRetry();
  });

  btnMmSetup.addEventListener('click', function () {
    var h = hook;
    if (!h) return;
    var band = h.difficulty;
    var size = h.size;
    sheet.close({ force: true });
    openSheetAt(band, size);
  });
}
