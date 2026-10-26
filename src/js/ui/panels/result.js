/* ============================================================================
 * panels/result.js · 结果层（解开 / 时间到 / 步数用尽 / 命用尽）
 * ----------------------------------------------------------------------------
 * 四种结局共用一张卡，按 state.status + state.lostBy 换文案与按钮：
 *   解开：再来一局 / 重来这局 / 看看棋盘
 *   超时：重试这一局（同一盘棋重开）/ 换一局新的
 *   步数用尽：跟超时同一套按钮，标题与中间那格读数换成「限步」
 *   命用尽：同上，中间那格读数是「几条命」，副标题说错了几次
 *
 * 输掉的那一屏必须做个选择（重试 / 换一局），Esc 关不掉、点背景也关不掉：
 * 关掉之后棋盘是封的，只剩「新一局」一条路，容易点得莫名其妙。
 * 真的要收掉的地方（换盘、重开）传 force。
 * ========================================================================== */

import { newGame, retryGame } from '../../app/puzzle.js';
import { limitLabel } from '../../core/config.js';
import { boardEl } from '../../core/dom.js';
import { createSheet } from '../../core/sheet.js';
import { state, view } from '../../core/state.js';
import { formatTime } from '../../core/utils.js';
import { queenCount } from '../../game/rules.js';
import { updateStats } from '../render.js';
import { openNewDaily } from './newgame.js';
import { openSlot } from './slot.js';

export var HTML = /* html */ `
<div class="result" id="result" hidden>
  <div class="result-card" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
    <p class="result-kicker" id="resultKicker">PUZZLE SOLVED</p>
    <h2 class="result-title" id="resultTitle">解开了</h2>
    <p class="result-sub" id="resultSub">8×8 · 用时 00:00</p>
    <div class="result-stats">
      <div class="result-stat"><b id="resSize">8×8</b><span>棋盘</span></div>
      <div class="result-stat"><b id="resTime">00:00</b><span id="resTimeLbl">用时</span></div>
      <div class="result-stat"><b id="resHints">0</b><span>提示</span></div>
    </div>
    <button class="btn btn-lucky" id="btnDraw" type="button" hidden>抽一次奖</button>
    <button class="btn btn-hint" id="btnAgain" type="button">再来一局</button>
    <div class="result-links">
      <button class="btn-text" id="btnReplay" type="button">重来这局</button>
      <button class="btn-text" id="btnPeek" type="button">看看棋盘</button>
    </div>
  </div>
</div>`;

var el = null;
var resultKicker = null, resultTitle = null, resultSub = null;
var resSize = null, resTime = null, resTimeLbl = null, resHints = null;
var btnAgain = null, btnReplay = null, btnPeek = null, btnDraw = null;

var sheet = null;

/* 结果层那一行小字：这局在自己组里排第几快。
 * 只有解开的才有名次；本组只此一局时说「本组最快」也不算吹牛。 */
function rankText() {
  var f = view.lastFinish;
  if (!f || !f.rank) return '';
  return f.rank === 1 ? ' · 本组最快' : ' · 本组第 ' + f.rank;
}

/* 抽奖资格：这一局是每日挑战、解开了，而且是这一挡今天「头一回」解开——
 * 起局时记下的快照（state.dailyFresh，解开那一刻 isDone 已经翻成 true）。
 * 资格不落账：老虎机一弹出就算用掉（view.drawUsed），关掉或者错过都不补。 */
function drawOffered() {
  return state.status === 'won' && !!state.daily && !!state.dailyFresh && !view.drawUsed;
}

/* 打开前把这一局的读数写进卡片。who 由 state.status 决定，调用方不用传；
 * 输掉的三种（超时 / 步数用尽 / 命用尽）只有文案与中间那格读数不一样。 */
function paint() {
  var lost = state.status === 'lost';
  var bySteps = lost && state.lostBy === 'steps';
  var byLives = lost && state.lostBy === 'lives';

  el.dataset.kind = lost ? 'lost' : 'won';
  resultKicker.textContent = byLives ? 'OUT OF LIVES'
    : bySteps ? 'OUT OF MOVES' : (lost ? 'TIME UP' : 'PUZZLE SOLVED');
  resultTitle.textContent = byLives ? '命用完了'
    : bySteps ? '步数用尽' : (lost ? '时间到' : '解开了');

  resSize.textContent = state.size + '×' + state.size;
  if (byLives) {
    /* 跟「限时 / 限步」对称：输在什么上，就报那条限制是多少 */
    resTime.textContent = String(state.lifeLimit);
    resTimeLbl.textContent = '条命';
  } else if (bySteps) {
    resTime.textContent = String(state.stepLimit);
    resTimeLbl.textContent = '限步';
  } else {
    resTime.textContent = lost ? limitLabel(state.limit) : formatTime(state.elapsed);
    resTimeLbl.textContent = lost ? '限时' : '用时';
  }
  resHints.textContent = String(state.hints);

  /* 步数写进副标题：它是这一局最实在的一个读数（撤销不退、刷新还在），
   * 解开与没解开都值得看一眼。步数用尽那一屏不必再写一遍——限步多少就是走了多少。 */
  var stepsText = bySteps ? '' : ' · ' + (state.steps || 0) + ' 步';
  /* 解开的那屏另外报一句「错了几次」：开了标错惩罚的局，失掉几条命就是错了几次 */
  var missText = !lost && state.lifeLimit
    ? ' · 标错 ' + Math.max(0, state.lifeLimit - state.lives) + ' 次' : '';
  /* 每日挑战那一局在副标题前面挂一句：这是「今天的盘」，不是随手换的一盘
   * （它到底算不算完成，换一局面板与战绩里的日历会说） */
  var dailyLead = state.daily ? '今日挑战 · ' : '';
  resultSub.textContent = lost
    ? dailyLead + state.size + '×' + state.size +
      (byLives ? ' · 标错 ' + state.lifeLimit + ' 次'
        : bySteps ? ' · 限步 ' + state.stepLimit + ' 步'
          : ' · 限时 ' + limitLabel(state.limit) + stepsText) +
      ' · 还差 ' + Math.max(0, state.size - queenCount()) + ' 只皇后'
    : dailyLead + state.size + '×' + state.size + ' · 用时 ' + formatTime(state.elapsed) + stepsText +
      missText +
      (state.vibe ? ' · ' + state.vibe.level + ' ' + state.vibe.score.toFixed(1) : '') +
      rankText();

  btnAgain.textContent = lost ? '重试这一局' : '再来一局';
  btnPeek.textContent = lost ? '换一局新的' : '看看棋盘';
  // 「重来这局」只在解开后露面：输掉的那屏第一个按钮就是重试同一盘，不必再给一个
  btnReplay.hidden = lost;
  /* 首通某一挡的每日挑战才有的抽奖按钮（资格用过即没，见 drawOffered） */
  btnDraw.hidden = !drawOffered();
}

export function showResult() {
  if (sheet.isOpen()) return;
  paint();
  sheet.open();
}

/* 「下一局」在这一层只分两种：
 *   每日挑战 → 回换一局面板（还停在每日挑战那一路）：下一盘打哪一挡由玩家挑，
 *              而且今天打过的挡位会显示成「再打一遍」，不会糊里糊涂开一盘自定义；
 *   自定义   → 照旧直接换一盘新棋（跟以前一样，一下就到）。 */
function nextGame() {
  if (state.daily) { openNewDaily(); return; }
  newGame(state.size);
}

/* 换盘、重开这类真的要收掉的地方传 force = true；
 * 输掉时不给 force 就关不动（Esc / 点背景都走这条）。 */
export function dismissResult(force) {
  if (!sheet.isOpen()) return;
  sheet.close({ force: !!force });
}

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  el = document.getElementById('result');
  resultKicker = document.getElementById('resultKicker');
  resultTitle = document.getElementById('resultTitle');
  resultSub = document.getElementById('resultSub');
  resSize = document.getElementById('resSize');
  resTime = document.getElementById('resTime');
  resTimeLbl = document.getElementById('resTimeLbl');
  resHints = document.getElementById('resHints');
  btnAgain = document.getElementById('btnAgain');
  btnReplay = document.getElementById('btnReplay');
  btnPeek = document.getElementById('btnPeek');
  btnDraw = document.getElementById('btnDraw');

  sheet = createSheet({
    id: 'result',
    wrap: el,
    inert: false,   // 整屏盖住 + 自己锁焦点，不用把 #app 设成 inert
    panel: el.querySelector('.result-card'),
    focusEl: function () { return btnAgain; },
    beforeOpen: paint,
    /* 输掉的那一屏不许关：只有 force（换盘 / 重开 / 按 N）能收掉 */
    canClose: function (opt) { return state.status !== 'lost' || !!(opt && opt.force); },
    afterClose: function () {
      boardEl.classList.remove('is-won');
      updateStats();
    },
    /* 结果层上按 N 直接开下一局（输掉的那屏也算「重试这一局」） */
    onKey: function (e) {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      var lost = state.status === 'lost';
      sheet.close({ force: true });
      if (lost) retryGame(); else nextGame();
    }
  });

  btnAgain.addEventListener('click', function () {
    var lost = state.status === 'lost';
    sheet.close({ force: true });
    if (lost) retryGame(); else nextGame();
  });
  /* 抽一次奖：开老虎机面板（浮层基座会把结算层收掉，抽完再回来） */
  btnDraw.addEventListener('click', function () { openSlot(); });
  /* 重来这局：同一盘棋从零再下一遍（解开后才会露出来）。
   * 输了那一屏的主按钮本来就是「重试这一局」，这里就不重复了。 */
  btnReplay.addEventListener('click', function () {
    sheet.close({ force: true });
    retryGame();
  });
  btnPeek.addEventListener('click', function () {
    var lost = state.status === 'lost';
    sheet.close({ force: true });
    // 解开时是「看看棋盘」（结果层收掉就行）；输了就只有「换一局新的」这条路
    if (lost) nextGame();
  });
  el.addEventListener('click', function (e) {
    if (e.target === el) sheet.close();
  });
}
