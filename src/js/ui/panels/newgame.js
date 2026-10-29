/* ============================================================================
 * panels/newgame.js · 换一局面板
 * ----------------------------------------------------------------------------
 * 顶栏那颗「新一局」开的就是这里。面板分成两条路，顶上那两颗标签切：
 *
 *   自定义 —— 棋盘大小、目标难度、挑战全都自己挑（原来的玩法，一个字没改）
 *   每日挑战 —— 一天一盘，只跟日期有关（见 core/daily.js / app/daily.js）：
 *                难度五挡，完成前一挡才解锁下一挡；棋盘固定该挡最大盘；
 *                **限时 / 限步 / 标错惩罚里每天每挡只抽两样**（限时按挡位
 *                3/5/10/15/20 分、限步按挡位 40/100/300/400/400 步、标错固定
 *                3 条命），剩下一项这局不设限；禁用提示、可以撤销、记录点可用。
 *                **自动标 × / 自动补全不随难度变**（2026-10-29 改）：默认都开，
 *                玩家在这一组里自己关，点「开始今日挑战」时生效；
 *                **唯一位置提示在这一路里锁定为关**（它是答案泄漏，开关灰着拨不动）。
 *                除这两颗可拨的辅助，其余全锁着，改不了。
 *
 * 自定义那一路的三组（尺寸 / 难度 / 挑战）都只写 pending，点「换一局」才落地
 * ——中途改完不换局就等于没改（开了限时又反悔，也不用担心这局被计时追着跑）。
 * 每日挑战没有这个「待生效」的概念：选好难度点「开始今日挑战」，当场换盘。
 *
 * 挑战那一组改成了可折叠（标题那一行就是开关，右边挂着当前设定的摘要）：
 * 三排挡位加六颗开关，铺开以后这一页在 390×844 上就顶到「换一局」了。
 * 折叠状态只在这一页里有效（模块变量，不落盘）；切到每日挑战会自动摊开，
 * 因为那一组的每一项都被锁住了，看不见就不知道自己在打什么。
 *
 * 右上角那颗下载样子的图标是**载入代码**：朋友发来一串 QNS1-…，点它就读剪贴板
 * 装上那一盘（见 ui/share.js 的 loadShareFromClipboard）。
 *
 * 这个文件自带四样东西（跟别的面板一个规矩）：
 *   markup    —— 折叠在 HTML 字符串里，index.html 里没有它
 *   refs      —— 元素引用在 mount() 里取，不进 core/dom.js
 *   events    —— 面板内所有点击都在这里绑
 *   open/close—— 走 core/sheet.js 的基座（inert / Esc / Tab 不用再各写一遍）
 * ========================================================================== */

import { newDaily, newGame } from '../../app/puzzle.js';
import { buzz, sfx } from '../../core/audio.js';
import {
  DIFF_BANDS, DIFF_ORDER, LIFE_OPTIONS, LIMIT_OPTIONS, SIZE_MAX, SIZE_MIN, STEP_OPTIONS,
  bandRangeLabel, lifeLabel, limitLabel, normalizeLives, normalizeLimit, normalizeSteps,
  stepLimitLabel
} from '../../core/config.js';
import {
  DAILY_TIERS, countDone, complete, dayKey, dayLabel, isDone, pickTier, ruleOf,
  unlocked
} from '../../core/daily.js';
import { btnNew } from '../../core/dom.js';
import { createSheet } from '../../core/sheet.js';
import { pending, settings, state, view } from '../../core/state.js';
import { saveSettings } from '../../core/storage.js';
import { announce, clamp } from '../../core/utils.js';
import { loadShareFromClipboard } from '../share.js';

export var HTML = /* html */ `
<div class="sheet-wrap" id="newWrap" hidden>
  <div class="sheet-backdrop" id="newBackdrop"></div>
  <div class="sheet" id="newSheet" role="dialog" aria-modal="true" aria-labelledby="newTitle" tabindex="-1">
    <div class="sheet-head">
      <h2 id="newTitle">新的一局</h2>
      <!-- 载入代码住在右上角：它的实质就是「换一局」，只是这盘是别人给的。
           点下去先读剪贴板（见 ui/share.js 的 loadShareFromClipboard）。 -->
      <div class="head-acts">
        <button class="icon-btn" id="btnLoadCode" type="button"
          title="载入代码" aria-label="载入别人发来的棋盘代码">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4v10"></path>
            <path d="M8 10.5 12 14.5l4-4"></path>
            <path d="M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V17"></path>
          </svg>
        </button>
        <button class="icon-btn" id="btnCloseNew" type="button" aria-label="关闭新的一局">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 两条路：自定义（原来的玩法）/ 每日挑战（一天一盘，规矩写死）。
         角标是今天的进度，没打完也能一眼看见还有几挡。
         id 都带 Mode 后缀：战绩面板里也有一颗「每日挑战」标签（那本是日历），
         两边都叫 tabDaily 的话 getElementById 只会拿到先挂上的那个，
         后挂上的那颗就永远点不动了。 -->
    <div class="mode-tabs" id="modeTabs" role="tablist" aria-label="玩法">
      <button class="mtab is-on" id="tabModeCustom" type="button" role="tab" data-mode="custom" aria-selected="true">自定义</button>
      <button class="mtab" id="tabModeDaily" type="button" role="tab" data-mode="daily" aria-selected="false">每日挑战<i id="dailyBadge"></i></button>
    </div>

    <p class="sheet-note" id="newNote">当前这局：8×8</p>

    <div class="stepper" id="sizeStepper">
      <div class="stepper-label">棋盘大小<small id="sizeHint">4×4 到 16×16，每盘唯一解</small></div>
      <div class="stepper-ctl">
        <button class="step-btn" type="button" id="sizeMinus" aria-label="减小棋盘">−</button>
        <span class="step-val" id="sizeVal">8</span>
        <button class="step-btn" type="button" id="sizePlus" aria-label="增大棋盘">+</button>
      </div>
    </div>

    <!-- 常用尺寸按钮按「目标难度」开放的范围重建，见 buildQuickRow。
         每日挑战里尺寸是定死的，这一行整个收起来（省下的高度留给摊开的挑战组）。 -->
    <div class="quick-row" id="quickRow">
      <span class="q-label">常用</span>
    </div>

    <div class="diff-row">
      <div class="stepper-label">目标难度<small id="diffHint">选好档位，点下面「换一局」生效</small></div>
      <div class="diff-opts" id="diffOpts" role="group" aria-label="目标难度">
        <button class="dbtn is-on" type="button" data-level="any" aria-pressed="true">不限</button>
        <button class="dbtn" type="button" data-level="easy" aria-pressed="false">容易</button>
        <button class="dbtn" type="button" data-level="mid" aria-pressed="false">中等</button>
        <button class="dbtn" type="button" data-level="advanced" aria-pressed="false">较难</button>
        <button class="dbtn" type="button" data-level="hard" aria-pressed="false">困难</button>
        <button class="dbtn" type="button" data-level="extreme" aria-pressed="false">极难</button>
      </div>
    </div>

    <!-- 挑战是可折叠的：这一行本身就是开关，右边挂着当前设定的摘要，
         收起来也知道这局加了什么规矩。做成一块带边的暖黄条 —— 它跟上面那些
         偏好设置不是一回事，是「给这局加难度」，得看得见。 -->
    <button class="group-toggle" id="btnChallenge" type="button"
      aria-expanded="false" aria-controls="challengeBody">
      <span class="group-title" id="challengeTitle">挑战</span>
      <span class="group-sum" id="challengeSum">不限时</span>
      <span class="group-chev" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6"></path>
        </svg>
      </span>
    </button>

    <div class="challenge" id="challengeBody" hidden>
      <div class="limit-row">
        <div class="stepper-label">限时<small id="limitHint">开启后第一次操作开始倒计时，超时判负</small></div>
        <!-- 挡位按钮按 core/config.js 的 LIMIT_OPTIONS 生成，见 buildLimitOpts -->
        <div class="limit-opts" id="limitOpts" role="group" aria-label="限时"></div>
      </div>

      <div class="limit-row">
        <div class="stepper-label">步数限制<small id="stepHint">用完还没解开就算输；每变一格算一步</small></div>
        <!-- 挡位按钮按 core/config.js 的 STEP_OPTIONS 生成，见 buildStepOpts -->
        <div class="limit-opts" id="stepOpts" role="group" aria-label="步数限制"></div>
      </div>

      <div class="limit-row">
        <div class="stepper-label">标错惩罚<small id="lifeHint">皇后放到错的格子上会扣一条命，扣光判负</small></div>
        <!-- 挡位按钮按 core/config.js 的 LIFE_OPTIONS 生成，见 buildLifeOpts -->
        <div class="limit-opts" id="lifeOpts" role="group" aria-label="标错惩罚"></div>
      </div>

      <!-- 三个「辅助」：自动标 × / 唯一位置提示 / 自动补全。它们是**这一局的规矩**，
           所以跟限时一样只在点「换一局」时落地。每日挑战里前一颗与最后一颗是可改的
           （不再随难度变化），中间那颗「唯一位置提示」**锁定为关**——它是答案泄漏，
           那一颗在每日挑战里灰着拨不动；限时 / 步数 / 标错那三项也锁死。 -->
      <div class="switch-row">
        <div class="stepper-label">自动标 ×<small>同行同列和同色块自动打叉</small></div>
        <button class="switch" id="swAutoMark" type="button" role="switch" aria-checked="true" aria-label="自动标记"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">唯一位置提示<small>某行某列只剩一格时亮</small></div>
        <button class="switch" id="swForced" type="button" role="switch" aria-checked="true" aria-label="唯一位置提示"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">自动补全<small>只剩皇后时露「补齐」</small></div>
        <button class="switch" id="swAutoFill" type="button" role="switch" aria-checked="true" aria-label="自动补全"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">禁用提示<small>提示按钮不可用</small></div>
        <button class="switch" id="swNoHint" type="button" role="switch" aria-checked="false" aria-label="禁用提示"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">禁用撤销<small>不能撤销和重做</small></div>
        <button class="switch" id="swNoUndo" type="button" role="switch" aria-checked="false" aria-label="禁用撤销"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">禁用记录点<small>不能记下或还原</small></div>
        <button class="switch" id="swNoSnap" type="button" role="switch" aria-checked="false" aria-label="禁用记录点"></button>
      </div>
    </div>

    <div class="shuffle-row">
      <button class="btn btn-hint" id="btnShuffle" type="button">换一局</button>
      <p class="shuffle-hint" id="shuffleHint">换一幅新棋盘，上面的棋盘大小、目标难度与挑战一起生效</p>
    </div>
  </div>
</div>`;

var wrap = null, sheet = null, backdrop = null, note = null;
var sizeHint = null, sizeMinus = null, sizePlus = null, sizeVal = null, quickRow = null;
var diffOpts = null, diffHint = null, limitOpts = null, limitHint = null;
var stepOpts = null, stepHint = null, lifeOpts = null, lifeHint = null;
var challengeBody = null, btnChallenge = null, challengeTitle = null, challengeSum = null;
var btnShuffle = null, shuffleHint = null;
var modeTabs = null, dailyBadge = null;

var ctl = null;

/* 面板自己的临时视图，只有这一页会读，不落盘：
 *   mode         'custom' | 'daily'
 *   challenge    挑战组摊开没摊开（只是这一页的观感，不需要持久化）
 *   dailyAssist  每日挑战里玩家挑的那两颗辅助（自动标 × / 自动补全）。
 *                这两颗现在**不再随难度变化**，所以选择权在玩家；记在模块里
 *                而不是 settings，是因为它不属于「自定义的默认值」那一套。
 *                每日挑战开新盘时按它走（见 btnShuffle 那一颗的点击）。
 * 两条都在同一次会话里记着：关了面板再打开，还是刚才那一路、那个开合状态。 */
var mode = 'custom';
var challengeOpen = false;
var dailyAssist = { autoMark: true, autoFill: true };

/* ==========================================================
   每日挑战：今天、哪一挡、锁没锁
   ========================================================== */
function today() { return dayKey(); }

/* 前一挡的名字，给「先完成 X 才能解锁 Y」那句话用 */
function prevTier(tier) {
  var i = DAILY_TIERS.indexOf(tier);
  return i > 0 ? DAILY_TIERS[i - 1] : '';
}

function tierLocked(tier) {
  return !unlocked(today(), tier);
}

/* ==========================================================
   落 pending：两条路各抄各的源
   ----------------------------------------------------------
   自定义从「这一局实际是什么」+ 设置起算；每日挑战从今天的进度起算
   （默认停在第一个还没完成的挡，它一定是解锁的）。
   ========================================================== */
function applyMode() {
  if (mode === 'daily') {
    var day0 = today();
    pending.difficulty = pickTier(day0);
    var r = ruleOf(pending.difficulty, day0);
    pending.size = r.size;
    pending.timeLimit = r.limit;
    pending.stepLimit = r.steps;
    pending.lifeLimit = r.lives;
    pending.noHint = true;
    pending.noUndo = false;
    pending.noSnap = false;
    /* 两颗辅助不跟挡位走（2026-10-29 起）：默认全开，之后由玩家自己拨，
     * 拨过的选择留在 dailyAssist 里，切挡位 / 关面板都不会把它冲掉。
     * 唯一位置提示例外：这一路里它**锁定为关**（开关灰着，摘要里照实写）。 */
    pending.autoMark = dailyAssist.autoMark;
    pending.autoFill = dailyAssist.autoFill;
    pending.forced = false;
    return;
  }

  /* 每日挑战不会改写 settings.size（见 app/puzzle.js 的 applyBoard），
   * 所以打完每日再回自定义，尺寸要回到「上次自定义的尺寸」而不是那盘盘面。 */
  pending.size = state.daily ? (settings.size || state.size) : state.size;
  pending.difficulty = state.diffApplied || settings.difficulty;
  pending.timeLimit = settings.timeLimit || 0;
  pending.stepLimit = settings.stepLimit || 0;
  pending.lifeLimit = settings.lifeLimit || 0;
  pending.noHint = !!settings.noHint;
  pending.noUndo = !!settings.noUndo;
  pending.noSnap = !!settings.noSnap;
  pending.autoMark = settings.autoMark !== false;
  pending.forced = settings.forced !== false;
  pending.autoFill = settings.autoFill !== false;
}

function setMode(next) {
  if (next !== 'custom' && next !== 'daily') return;
  if (next === mode) return;
  mode = next;
  applyMode();
  /* 每日挑战的挑战项全锁在那一组里：自动摊开，让人看见自己在打什么规矩。 */
  if (mode === 'daily') setChallengeOpen(true);
  syncNew();
  announce(mode === 'daily'
    ? '每日挑战：今天的棋盘已经备好，挑个难度开始'
    : '自定义：棋盘大小与挑战都可以自己挑');
}

function setChallengeOpen(open) {
  challengeOpen = !!open;
  if (challengeBody) challengeBody.hidden = !challengeOpen;
  if (btnChallenge) btnChallenge.setAttribute('aria-expanded', challengeOpen ? 'true' : 'false');
}

/* ==========================================================
   挑战：限时 / 步数限制挡位
   ----------------------------------------------------------
   按钮按 LIMIT_OPTIONS / STEP_OPTIONS 生成，省得配置和面板各写一份、
   改一边忘另一边。
   ========================================================== */
function buildLimitOpts() {
  if (!limitOpts || limitOpts.childNodes.length) return;
  for (var i = 0; i < LIMIT_OPTIONS.length; i++) {
    var o = LIMIT_OPTIONS[i];
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lbtn';
    b.dataset.limit = String(o.ms);
    b.textContent = o.label;
    b.setAttribute('aria-pressed', 'false');
    limitOpts.appendChild(b);
  }
}

/* 挑战只写 pending，跟棋盘大小 / 目标难度一个规矩：点「换一局」才落地。
 * 中途改完不换局就等于没改——开了限时又反悔，也不用担心这局被计时追着跑。 */
export function setPendingLimit(ms) {
  if (mode === 'daily') return;          // 每日挑战的挑战项是锁死的
  ms = normalizeLimit(ms);
  if (ms === pending.timeLimit) return;
  pending.timeLimit = ms;
  syncNew();
  announce('限时：' + (ms ? limitLabel(ms) : '不限') + '（换一局后生效）');
}

function buildStepOpts() {
  if (!stepOpts || stepOpts.childNodes.length) return;
  for (var i = 0; i < STEP_OPTIONS.length; i++) {
    var o = STEP_OPTIONS[i];
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lbtn';
    b.dataset.steps = String(o.steps);
    b.textContent = o.label;
    b.setAttribute('aria-pressed', 'false');
    stepOpts.appendChild(b);
  }
}

export function setPendingSteps(n) {
  if (mode === 'daily') return;
  n = normalizeSteps(n);
  if (n === pending.stepLimit) return;
  pending.stepLimit = n;
  syncNew();
  announce('步数限制：' + (n ? stepLimitLabel(n) : '不限') + '（换一局后生效）');
}

/* 标错惩罚：这一局给几条命。跟限时 / 步数一样只写 pending。
 * 0 是「不惩罚」（默认），不是「0 条命」——写文案时别把这两件事混起来。 */
function buildLifeOpts() {
  if (!lifeOpts || lifeOpts.childNodes.length) return;
  for (var i = 0; i < LIFE_OPTIONS.length; i++) {
    var o = LIFE_OPTIONS[i];
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lbtn';
    b.dataset.lives = String(o.lives);
    b.textContent = o.label;
    b.setAttribute('aria-pressed', 'false');
    lifeOpts.appendChild(b);
  }
}

export function setPendingLives(n) {
  if (mode === 'daily') return;
  n = normalizeLives(n);
  if (n === pending.lifeLimit) return;
  pending.lifeLimit = n;
  syncNew();
  announce('标错惩罚：' + (n ? lifeLabel(n) : '不惩罚') + '（换一局后生效）');
}

/* 这一组里有哪些还没落地的改动，给「换一局」下方的说明与读屏播报共用 */
function challengeBits() {
  var bits = [];
  if ((pending.timeLimit || 0) !== (settings.timeLimit || 0)) {
    bits.push(pending.timeLimit ? '限时 ' + limitLabel(pending.timeLimit) : '不限时');
  }
  if ((pending.stepLimit || 0) !== (settings.stepLimit || 0)) {
    bits.push(pending.stepLimit ? '限步 ' + stepLimitLabel(pending.stepLimit) : '不限步数');
  }
  if ((pending.lifeLimit || 0) !== (settings.lifeLimit || 0)) {
    bits.push(pending.lifeLimit ? '标错扣命 ' + pending.lifeLimit + ' 条' : '不惩罚');
  }
  if (!!pending.noHint !== !!settings.noHint) {
    bits.push(pending.noHint ? '禁用提示' : '提示可用');
  }
  if (!!pending.noUndo !== !!settings.noUndo) {
    bits.push(pending.noUndo ? '禁用撤销' : '撤销可用');
  }
  if (!!pending.noSnap !== !!settings.noSnap) {
    bits.push(pending.noSnap ? '禁用记录点' : '记录点可用');
  }
  /* 三个辅助是「开着」为正：关掉才算加了难度，所以只说关掉的那几样 */
  if (!!pending.autoMark !== (settings.autoMark !== false)) {
    bits.push(pending.autoMark ? '自动打 ×' : '不自动打 ×');
  }
  if (!!pending.forced !== (settings.forced !== false)) {
    bits.push(pending.forced ? '唯一位置提示' : '不提示唯一位置');
  }
  if (!!pending.autoFill !== (settings.autoFill !== false)) {
    bits.push(pending.autoFill ? '自动补全' : '不自动补全');
  }
  return bits;
}

export function challengeSummary() {
  return challengeBits().join(' · ');
}

/* 今天这一挡比哪两样：拼成「限时 3 分 · 60 步」这样一段话。
 * 摘要、播报、按钮下方那行共用一处；没被抽到的那一项（值为 0）不出现。 */
function dailyRuleBits(r) {
  var bits = [];
  if (!r) return bits;
  if (r.limit) bits.push('限时 ' + Math.round(r.limit / 60000) + ' 分');
  if (r.steps) bits.push(r.steps + ' 步');
  if (r.lives) bits.push(r.lives + ' 条命');
  return bits;
}

/* 折叠时标题右边那串摘要：一横看下来就知道这局加了什么规矩。
 * 每日挑战那几项写死，直接照着规矩说（别从 pending 推，pending 是给人改的）。 */
function challengeSumText() {
  if (mode === 'daily') {
    var r = ruleOf(pending.difficulty, today());
    /* 只列今天真比的那两样 + 恒定项。「限时 20 分 · 400 步 · 无提示」是这一行最长的形态，
       标题放大之后它窄了，320 上才不至于截得只剩半句。
       那三样辅助（补全 / 自动 × / 定位）**不进这一行**：塞进来一定会被省略号吃掉，
       它们挂在下面那行说明里，摊开的那一组里也逐颗写着。 */
    return r ? dailyRuleBits(r).concat(['无提示']).join(' · ') : '由难度决定';
  }
  var bits = [pending.timeLimit ? '限时 ' + limitLabel(pending.timeLimit) : '不限时'];
  if (pending.stepLimit) bits.push('限步 ' + stepLimitLabel(pending.stepLimit));
  if (pending.lifeLimit) bits.push('标错 ' + pending.lifeLimit + ' 条');
  if (pending.noHint) bits.push('无提示');
  if (pending.noUndo) bits.push('无撤销');
  if (pending.noSnap) bits.push('无记录点');
  return bits.concat(assistOffBits(pending)).join(' · ');
}

/* 关掉的辅助拼成一小段（开着的不提）：摘要与按钮下方那行共用。
 * 每日挑战里传进来的是 pending，forced 恒 false —— 所以那一行每天都会写「无定位」，
 * 这正好说明今天没有这层光（它跟「无提示」一样是恒定项）。
 * 只认真 false：自定义里 pending.forced 一定是布尔，不受影响。 */
function assistOffBits(a) {
  var bits = [];
  if (!a.autoFill) bits.push('无补全');
  if (!a.autoMark) bits.push('无自动×');
  if (a.forced === false) bits.push('无定位');
  return bits;
}

/* 换一局时把挑战的意向落到设置上：这是它唯一生效的时机 */
export function commitChallenge() {
  settings.timeLimit = normalizeLimit(pending.timeLimit);
  settings.stepLimit = normalizeSteps(pending.stepLimit);
  settings.lifeLimit = normalizeLives(pending.lifeLimit);
  settings.noHint = !!pending.noHint;
  settings.noUndo = !!pending.noUndo;
  settings.noSnap = !!pending.noSnap;
  /* 三个辅助也顺手记成「自定义下一次开局的默认值」。每日挑战不写这几项
   * （它整条路都不走 commitChallenge，见下面那颗按钮）。 */
  settings.autoMark = pending.autoMark !== false;
  settings.forced = pending.forced !== false;
  settings.autoFill = pending.autoFill !== false;
  saveSettings();
}

/* ==========================================================
   面板内容
   ========================================================== */
/* 档位开放给玩家的尺寸区间。没选档位就是全量 4–16。
 * 这不是「限制」，是实测出来的可达性：4×4 里不存在困难的盘，
 * 16×16 也不会是容易的，把够不着的组合收起来比让人选完失望好。
 * 区间可能只有一格（极难只开 16×16），文案就别写成「16×16–16×16」。 */
function rangeOf(level) {
  var b = level && level !== 'any' ? DIFF_BANDS[level] : null;
  return b ? [b.lo, b.hi] : [SIZE_MIN, SIZE_MAX];
}

function rangeText(lo, hi) {
  return lo === hi ? lo + '×' + lo : lo + '×' + lo + '–' + hi + '×' + hi;
}

/* 「不限」时给几个常用尺寸；选了档位就把这一档开放的尺寸全摊开 */
var QUICK_ANY = [6, 8, 10, 12, 15];
var quickKey = '';

function buildQuickRow(lo, hi) {
  var key = lo + '-' + hi;
  if (key === quickKey) return;
  quickKey = key;

  var all = lo === SIZE_MIN && hi === SIZE_MAX;
  var sizes = all ? QUICK_ANY : [];
  for (var i = lo; !all && i <= hi; i++) sizes.push(i);

  var html = '<span class="q-label">' + (all ? '常用' : '可选') + '</span>';
  for (var k = 0; k < sizes.length; k++) {
    html += '<button class="qbtn" type="button" data-size="' + sizes[k] + '">' +
      sizes[k] + '×' + sizes[k] + '</button>';
  }
  quickRow.innerHTML = html;
}

/* 顶部那行说明：自定义说「当前这局是什么」，每日挑战说「今天打到哪儿了」。 */
function noteText(day) {
  if (mode === 'daily') {
    var done = countDone(day);
    return '今日挑战 · ' + dayLabel(day) + ' · 已完成 ' + done + '/' + DAILY_TIERS.length +
      (complete(day) ? '（今日已完成）' : '');
  }
  return '当前这局：' + state.size + '×' + state.size +
    (state.vibe ? ' · ' + state.vibe.level + ' ' + state.vibe.score.toFixed(1) : '') +
    (state.limit ? ' · 限时 ' + limitLabel(state.limit) : '') +
    (state.stepLimit ? ' · 限步 ' + stepLimitLabel(state.stepLimit) : '') +
    (state.lifeLimit ? ' · 标错 ' + state.lifeLimit + ' 条命' : '');
}

export function syncNew() {
  var daily = mode === 'daily';
  var day = today();
  /* 兜底：每日挑战必须停在一个真档位上（正常路径由 applyMode 保证）。
   * 这一层后面处处要读 rule.size，宁可在这儿拉回来，也别让面板崩掉。 */
  if (daily && DAILY_TIERS.indexOf(pending.difficulty) < 0) pending.difficulty = pickTier(day);
  var diff = pending.difficulty;
  var band = diff && diff !== 'any' ? DIFF_BANDS[diff] : null;
  var rule = daily ? ruleOf(diff, day) : null;
  var rng = rangeOf(diff);
  var lo = rng[0], hi = rng[1];

  /* 换了档位就把待生效尺寸夹回它开放的区间：选完「极难」还挂着 8×8 是要闹哪样。
   * 每日挑战不夹——它压根就是定死的。 */
  pending.size = daily ? rule.size : clamp(pending.size, lo, hi);

  sizeVal.textContent = String(pending.size);
  sizeMinus.disabled = daily || pending.size <= lo;
  sizePlus.disabled = daily || pending.size >= hi;
  quickRow.hidden = daily;
  if (!daily) buildQuickRow(lo, hi);

  /* 两行各说一件事，别重复：尺寸那行说「这一档能挑多大」，
   * 难度那行说「这一档的分数区间」+ 什么时候生效。 */
  sizeHint.textContent = daily
    ? '每日挑战固定为「' + band.name + '」最大盘：' + rule.size + '×' + rule.size
    : (band ? '「' + band.name + '」开放 ' + rangeText(lo, hi)
        : '4×4 到 16×16，每盘唯一解');

  note.textContent = noteText(day);

  /* ---- 玩法标签 ---- */
  var tabs = modeTabs.querySelectorAll('.mtab');
  for (var t = 0; t < tabs.length; t++) {
    var onTab = tabs[t].dataset.mode === mode;
    tabs[t].classList.toggle('is-on', onTab);
    tabs[t].setAttribute('aria-selected', onTab ? 'true' : 'false');
  }
  dailyBadge.textContent = complete(day) ? '✓' : countDone(day) + '/' + DAILY_TIERS.length;

  /* ---- 目标难度 ---- */
  if (daily) {
    var left = DAILY_TIERS.indexOf(diff) + 1;
    if (isDone(day, diff)) {
      /* 打过这一挡就说明今天已经算完成了（任意一挡即完成），所以这里只提刷新时间，
       * 「今日已完成」由上面那行 note 说，不用再重复一遍。 */
      diffHint.textContent = '「' + band.name + '」今天已完成，再打一遍只刷新时间';
    } else if (left < DAILY_TIERS.length) {
      diffHint.textContent = '完成「' + band.name + '」解锁「' +
        DIFF_BANDS[DAILY_TIERS[left]].name + '」；打任意一挡就算完成今日挑战';
    } else {
      diffHint.textContent = '「' + band.name + '」是今天最后一挡了';
    }
  } else {
    /* 区间两头都写出来：只写「7.0 分起」会让人以为越难越好，抽到 8.6 的极难盘也算数 */
    diffHint.textContent = band
      ? '「' + band.name + '」' + bandRangeLabel(band) + ' · 挑好尺寸，点「换一局」生效'
      : '选好档位，再挑一个尺寸，点下面「换一局」生效';
  }

  var dbtns = diffOpts.querySelectorAll('.dbtn');
  for (var d = 0; d < dbtns.length; d++) {
    var lv = dbtns[d].dataset.level;
    var on = lv === diff;
    /* 每日挑战里没有「不限」；没解锁的挡位灰掉，鼠标停上去说清楚差哪一步。 */
    var lock = daily && lv !== 'any' && tierLocked(lv);
    dbtns[d].hidden = daily && lv === 'any';
    dbtns[d].disabled = lock;
    dbtns[d].classList.toggle('is-locked', lock);
    dbtns[d].setAttribute('title', lock
      ? '先完成「' + DIFF_BANDS[prevTier(lv)].name + '」才能解锁「' + DIFF_BANDS[lv].name + '」'
      : '');
    dbtns[d].classList.toggle('is-on', on);
    dbtns[d].setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ---- 挑战（自定义只写 pending，点「换一局」才生效；每日挑战全锁） ---- */
  var lim = pending.timeLimit || 0;
  var applied = settings.timeLimit || 0;
  var lbtns = limitOpts.querySelectorAll('.lbtn');
  for (var l = 0; l < lbtns.length; l++) {
    var lon = parseInt(lbtns[l].dataset.limit, 10) === lim;
    lbtns[l].classList.toggle('is-on', lon);
    lbtns[l].setAttribute('aria-pressed', lon ? 'true' : 'false');
    lbtns[l].disabled = daily;
    lbtns[l].classList.toggle('is-locked', daily);
  }
  limitHint.textContent = daily
    ? (rule.skip === 'time'
        ? '今日不比限时：这局不限时，慢推就行'
        : '每日挑战固定限时 ' + limitLabel(lim) + ' · 超时就判负，可以重试这一局')
    : (lim !== applied
        ? '换一局后生效：' + (lim ? '限时 ' + limitLabel(lim) : '不限时')
        : (lim ? '本局限时 ' + limitLabel(lim) + '，超时判负，可以重试这一局'
            : '开启后第一次操作开始倒计时，超时判负'));

  /* 步数限制：跟限时同一个读法，也跟前一排一样只写 pending */
  var sl = pending.stepLimit || 0;
  var slApplied = settings.stepLimit || 0;
  var sbtns = stepOpts.querySelectorAll('.lbtn');
  for (var s = 0; s < sbtns.length; s++) {
    var son = parseInt(sbtns[s].dataset.steps, 10) === sl;
    sbtns[s].classList.toggle('is-on', son);
    sbtns[s].setAttribute('aria-pressed', son ? 'true' : 'false');
    sbtns[s].disabled = daily;
    sbtns[s].classList.toggle('is-locked', daily);
  }
  stepHint.textContent = daily
    ? (rule.skip === 'steps'
        ? '今日不比步数：这局不限步数'
        : '每日挑战固定限步 ' + stepLimitLabel(sl) + ' · 用完判负，可以重试这一局')
    : (sl !== slApplied
        ? '换一局后生效：' + stepLimitLabel(sl)
        : (sl ? '本局限步 ' + stepLimitLabel(sl) + '，用完判负，可以重试这一局'
            : '用完还没解开就算输；拖动连涂一整行只算一步'));

  /* 标错惩罚：同一个读法，也只写 pending */
  var lv2 = pending.lifeLimit || 0;
  var lvApplied = settings.lifeLimit || 0;
  var lbts = lifeOpts.querySelectorAll('.lbtn');
  for (var q = 0; q < lbts.length; q++) {
    var qon = parseInt(lbts[q].dataset.lives, 10) === lv2;
    lbts[q].classList.toggle('is-on', qon);
    lbts[q].setAttribute('aria-pressed', qon ? 'true' : 'false');
    lbts[q].disabled = daily;
    lbts[q].classList.toggle('is-locked', daily);
  }
  lifeHint.textContent = daily
    ? (rule.skip === 'lives'
        ? '今日不比标错：放错不扣命，亮起冲突线自己擦掉'
        : '每日挑战固定扣 ' + lv2 + ' 条，放错一次扣一条')
    : (lv2 !== lvApplied
        ? '换一局后生效：' + (lv2 ? lifeLabel(lv2) : '不惩罚')
        : (lv2 ? '本局 ' + lifeLabel(lv2) + '，放错一次扣一条，可以重试这一局'
            : '皇后放到错的格子上会扣一条命，扣光判负'));

  setSwitch('swNoHint', pending.noHint, daily);
  setSwitch('swNoUndo', pending.noUndo, daily);
  setSwitch('swNoSnap', pending.noSnap, daily);
  /* 三颗辅助：自动标 × / 自动补全两种玩法都能拨（2026-10-29 放开的），
   * 差别只在「什么时候生效」：自定义等「换一局」，每日挑战等「开始今日挑战」。
   * 唯一位置提示例外：每日挑战里**锁着**（灰着、恒关），所以那颗还是传 daily。 */
  setSwitch('swAutoMark', pending.autoMark, false);
  setSwitch('swForced', pending.forced, daily);
  setSwitch('swAutoFill', pending.autoFill, false);

  // 有没落地的改动就把组标题点亮，别让人以为已经生效了。
  // 每日挑战没有「待生效」这回事：它说的是「今日规矩」，只有两颗辅助能拨。
  var cbits = daily ? [] : challengeBits();
  challengeTitle.textContent = daily ? '挑战 · 今日规矩'
    : (cbits.length ? '挑战 · 待换一局生效' : '挑战');
  challengeTitle.classList.toggle('is-pending', cbits.length > 0);
  challengeSum.textContent = challengeSumText();

  if (!daily) {
    var chips = quickRow.querySelectorAll('.qbtn');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', parseInt(chips[i].dataset.size, 10) === pending.size);
    }
  }

  syncShuffleRow();
}

function setSwitch(id, on, locked) {
  var el = document.getElementById(id);
  if (!el) return;
  el.setAttribute('aria-checked', on ? 'true' : 'false');
  el.disabled = !!locked;
  el.classList.toggle('is-locked', !!locked);
}

/* 换一局按钮下方的说明：有改动没落地就把改动列出来，顺带把按钮点亮 */
export function syncShuffleRow() {
  if (mode === 'daily') {
    var day = today();
    var tier = pending.difficulty;
    var band = DIFF_BANDS[tier];
    var r = ruleOf(tier, day);
    var done = isDone(day, tier);
    btnShuffle.textContent = done ? '再打一遍' : '开始今日挑战';
    btnShuffle.classList.toggle('is-pending', !done);
    shuffleHint.classList.toggle('is-pending', false);
    /* 这一行是可换行的说明，规则的细节都放这里：真比的那两样 + 恒定项 +
     * 玩家关掉的那两颗辅助（标题那条摘要塞不下，见 challengeSumText）。 */
    shuffleHint.textContent = '今日 ' + band.name + ' ' + r.size + '×' + r.size +
      ' · ' + dailyRuleBits(r).concat(['无提示'], assistOffBits(pending)).join(' · ') +
      (done ? ' · 今天打过了，只刷新时间' : '');
    return;
  }

  btnShuffle.textContent = '换一局';
  var bits = [];
  var any = !pending.difficulty || pending.difficulty === 'any';
  if (any) {
    if (pending.size !== state.size) bits.push(pending.size + '×' + pending.size);
    if (state.diffApplied && state.diffApplied !== 'any') bits.push('不限难度');
  } else if (pending.difficulty !== state.diffApplied || pending.size !== state.size) {
    // 档位和尺寸现在是一起选的：哪一项变了都说清楚，别只报档位
    bits.push(DIFF_BANDS[pending.difficulty].name + ' ' + pending.size + '×' + pending.size);
  }
  bits = bits.concat(challengeBits());

  var hasPending = bits.length > 0;
  btnShuffle.classList.toggle('is-pending', hasPending);
  shuffleHint.classList.toggle('is-pending', hasPending);
  shuffleHint.textContent = hasPending
    ? '点这里生效：' + bits.join(' · ')
    : '换一幅新棋盘，上面的棋盘大小、目标难度与挑战一起生效';
}

export function setPendingSize(n) {
  if (mode === 'daily') return;          // 每日挑战的尺寸是定死的
  var rng = rangeOf(pending.difficulty);
  n = clamp(n, rng[0], rng[1]);   // 只能落在这一档开放过的尺寸里
  if (n === pending.size) return;
  pending.size = n;
  syncNew();
}

/* ==========================================================
   开 / 关
   ========================================================== */
export function openNew() {
  /* 正在出题的那几秒别把面板压上去（遮罩挡得住鼠标，挡不住 N 键）：
   * 盘马上要换，换了之后面板上那些「待生效」的读数就对不上了。 */
  if (view.rolling) return;
  ctl.open();
}
/* 以「每日挑战」那一路打开：结果层上「再来一局 / 换一局新的」在每日挑战里
 * 走的就是这条 —— 下一盘打哪一挡由玩家自己挑（默认停在第一个没打过的）。 */
export function openNewDaily() {
  if (view.rolling) return;
  mode = 'daily';
  ctl.open();
}
export function closeNew() { ctl.close(); }
export function isNewOpen() { return !!ctl && ctl.isOpen(); }

/* 从「没抽到够格的盘」那层跳过来时，面板要停在他刚才要的那一档上：
 * 打开时是从「这局实际是什么」起算的，可这时压根没装上盘，
 * 照原样开出来会变成「不限」，看着像是他的选择没被记住。
 * 那条路只可能来自自定义出题，所以顺手切回自定义。 */
export function openSheetAt(difficulty, size) {
  mode = 'custom';
  applyMode();
  ctl.open();
  if (difficulty && difficulty !== 'any' && DIFF_BANDS[difficulty]) pending.difficulty = difficulty;
  if (size) pending.size = size;
  syncNew();
}

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  wrap = document.getElementById('newWrap');
  sheet = document.getElementById('newSheet');
  backdrop = document.getElementById('newBackdrop');
  note = document.getElementById('newNote');
  sizeHint = document.getElementById('sizeHint');
  sizeMinus = document.getElementById('sizeMinus');
  sizePlus = document.getElementById('sizePlus');
  sizeVal = document.getElementById('sizeVal');
  quickRow = document.getElementById('quickRow');
  diffOpts = document.getElementById('diffOpts');
  diffHint = document.getElementById('diffHint');
  limitOpts = document.getElementById('limitOpts');
  limitHint = document.getElementById('limitHint');
  stepOpts = document.getElementById('stepOpts');
  stepHint = document.getElementById('stepHint');
  lifeOpts = document.getElementById('lifeOpts');
  lifeHint = document.getElementById('lifeHint');
  challengeBody = document.getElementById('challengeBody');
  btnChallenge = document.getElementById('btnChallenge');
  challengeTitle = document.getElementById('challengeTitle');
  challengeSum = document.getElementById('challengeSum');
  btnShuffle = document.getElementById('btnShuffle');
  shuffleHint = document.getElementById('shuffleHint');
  modeTabs = document.getElementById('modeTabs');
  dailyBadge = document.getElementById('dailyBadge');

  buildLimitOpts();
  buildStepOpts();
  buildLifeOpts();

  ctl = createSheet({
    id: 'newgame',
    wrap: wrap,
    panel: sheet,
    opener: btnNew,
    /* 关掉之后直接 blur：键盘用户按 Esc 之后接着用 X / Q / Z 不会误触到按钮上 */
    focusOpener: false,
    beforeOpen: function () {
      // 每次打开都从两条路各自的源头重新起算，上次没落地的改动就作废
      applyMode();
      /* 每日挑战一打开就把挑战组摊开（那一组全锁着，看不见就不知道在打什么）；
       * 自定义保持上次的开合状态。 */
      setChallengeOpen(mode === 'daily' ? true : challengeOpen);
      syncNew();
    }
  });

  document.getElementById('btnCloseNew').addEventListener('click', closeNew);
  backdrop.addEventListener('click', closeNew);

  /* 载入代码：读剪贴板 → 校验 → 装上那一盘（面板由 share.js 自己收）。
   * 校验不过就在提示行说原因，这一层不会掉。 */
  document.getElementById('btnLoadCode').addEventListener('click', function () {
    loadShareFromClipboard();
  });

  /* 玩法：自定义 / 每日挑战 */
  modeTabs.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.mtab') : null;
    if (!btn) return;
    setMode(btn.dataset.mode);
    sfx('x');
    buzz(4);
  });

  /* 挑战组的开合 */
  btnChallenge.addEventListener('click', function () {
    setChallengeOpen(!challengeOpen);
    sfx('x');
    buzz(3);
    announce(challengeOpen ? '展开挑战设置' : '收起挑战设置');
  });

  sizeMinus.addEventListener('click', function () {
    setPendingSize(pending.size - 1);
  });
  sizePlus.addEventListener('click', function () {
    setPendingSize(pending.size + 1);
  });
  quickRow.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.qbtn') : null;
    if (!btn) return;
    setPendingSize(parseInt(btn.dataset.size, 10));
  });

  /* 目标难度：只记选择，不碰正在下的这局——点「换一局」才生效。 */
  diffOpts.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.dbtn') : null;
    if (!btn) return;
    var lv = btn.dataset.level;
    if (DIFF_ORDER.indexOf(lv) < 0 || lv === pending.difficulty) return;

    if (mode === 'daily') {
      if (lv === 'any' || tierLocked(lv)) return;   // 没解锁的挡位点不动（按钮本来就是灰的）
      pending.difficulty = lv;
      var r = ruleOf(lv, today());
      pending.size = r.size;
      /* 换挡就换一组规矩：抽到哪两样、步数与命数都跟着这一挡走。
       * 两颗辅助**不跟挡位走**（它们已经不受难度影响了），保持玩家自己拨的。 */
      pending.timeLimit = r.limit;
      pending.stepLimit = r.steps;
      pending.lifeLimit = r.lives;
      syncNew();
      announce('今日挑战：' + DIFF_BANDS[lv].name + ' ' + r.size + '×' + r.size +
        '，' + dailyRuleBits(r).concat(assistOffBits(pending)).join(' · '));
      return;
    }

    pending.difficulty = lv;
    syncNew();
    var band = lv !== 'any' ? DIFF_BANDS[lv] : null;
    announce(band
      ? '目标难度：' + band.name + '，' + bandRangeLabel(band) + '，开放 ' +
        rangeText(band.lo, band.hi) +
        '，先按 ' + pending.size + '×' + pending.size + ' 出（换一局后生效）'
      : '目标难度：不限（换一局后生效）');
  });

  /* 限时：跟尺寸 / 难度一样只记意向，点「换一局」才真的开始计时 */
  limitOpts.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.lbtn') : null;
    if (!btn) return;
    setPendingLimit(parseInt(btn.dataset.limit, 10));
    sfx('x');
    buzz(5);
  });

  /* 步数限制：同一套规矩，只记意向 */
  stepOpts.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.lbtn') : null;
    if (!btn) return;
    setPendingSteps(parseInt(btn.dataset.steps, 10));
    sfx('x');
    buzz(5);
  });

  /* 标错惩罚：同一套规矩，只记意向 */
  lifeOpts.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.lbtn') : null;
    if (!btn) return;
    setPendingLives(parseInt(btn.dataset.lives, 10));
    sfx('x');
    buzz(5);
  });

  /* 底下那颗：自定义是「换一局」（三组改动都在这落地），
   * 每日挑战是「开始今日挑战」（规矩写死，直接换盘）。 */
  btnShuffle.addEventListener('click', function () {
    if (mode === 'daily') {
      var day = today();
      var tier = pending.difficulty;
      if (!tier || !ruleOf(tier, day) || !unlocked(day, tier)) return;
      closeNew();
      /* 两颗辅助按玩家这一页里拨的走（不写 settings：每日挑战不该改写
       * 玩家自定义的默认值，见 app/puzzle.js 的 applyBoard）。 */
      dailyAssist.autoMark = pending.autoMark !== false;
      dailyAssist.autoFill = pending.autoFill !== false;
      newDaily(tier, dailyAssist);
      return;
    }

    var lv = pending.difficulty && pending.difficulty !== 'any' ? pending.difficulty : 'any';
    var band = DIFF_BANDS[lv] || null;
    var challenge = challengeSummary();   // 落地前先记下来，好念给读屏

    settings.difficulty = lv;
    /* 尺寸由玩家在这一档开放的区间里挑（见 syncNew），
     * 这里照抄就是；哪怕 pending 里残留了越界值，newGame 也会再夹一次。 */
    settings.size = clamp(pending.size, SIZE_MIN, SIZE_MAX);
    commitChallenge();
    saveSettings();

    closeNew();
    newGame(settings.size);

    if (band) {
      announce('已换局：' + band.name + ' ' + settings.size + '×' + settings.size +
        (challenge ? '，挑战：' + challenge : ''));
    } else {
      announce('已换局：' + settings.size + '×' + settings.size +
        (challenge ? '，挑战：' + challenge : ''));
    }
  });

  /* 挑战那几颗开关：跟限时 / 步数一样只写 pending，换一局才生效。
   * 每日挑战里只放开两颗辅助（自动标 × / 自动补全）——它们不再随难度变化，
   * 由玩家自己挑，点「开始今日挑战」时生效。其余三把锁与「唯一位置提示」
   * 都是灰的（定位在每日挑战里锁定为关，见 applyMode）。 */
  sheet.addEventListener('click', function (e) {
    var sw = e.target.closest ? e.target.closest('.switch') : null;
    if (!sw) return;
    var assist = sw.id === 'swAutoMark' || sw.id === 'swAutoFill';
    if (mode === 'daily' && !assist) return;
    if (sw.id === 'swNoHint') {
      pending.noHint = !pending.noHint;
      announce(pending.noHint ? '挑战：换一局后禁用提示' : '挑战：换一局后恢复提示');
    } else if (sw.id === 'swNoUndo') {
      pending.noUndo = !pending.noUndo;
      announce(pending.noUndo ? '挑战：换一局后禁用撤销' : '挑战：换一局后恢复撤销');
    } else if (sw.id === 'swNoSnap') {
      pending.noSnap = !pending.noSnap;
      announce(pending.noSnap ? '挑战：换一局后禁用记录点' : '挑战：换一局后恢复记录点');
    } else if (sw.id === 'swAutoMark') {
      pending.autoMark = !pending.autoMark;
      if (mode === 'daily') dailyAssist.autoMark = pending.autoMark;
      announce(pending.autoMark
        ? (mode === 'daily' ? '今日挑战：自动标 ×' : '挑战：换一局后自动标 ×')
        : (mode === 'daily' ? '今日挑战：不自动标 ×' : '挑战：换一局后不自动标 ×'));
    } else if (sw.id === 'swForced') {
      pending.forced = !pending.forced;
      announce(pending.forced ? '挑战：换一局后提示唯一位置' : '挑战：换一局后不提示唯一位置');
    } else if (sw.id === 'swAutoFill') {
      pending.autoFill = !pending.autoFill;
      if (mode === 'daily') dailyAssist.autoFill = pending.autoFill;
      announce(pending.autoFill
        ? (mode === 'daily' ? '今日挑战：可以一键补齐' : '挑战：换一局后可以一键补齐')
        : (mode === 'daily' ? '今日挑战：不给一键补齐' : '挑战：换一局后不给一键补齐'));
    } else {
      return;
    }
    syncNew();
  });
}
