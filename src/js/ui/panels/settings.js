/* ============================================================================
 * panels/settings.js · 设置面板
 * ----------------------------------------------------------------------------
 * 只剩那一列「拨了立刻生效」的开关：自动打 × / 拖动对齐 / 两个淡化 / 模糊背景 /
 * 冲突高亮 / 唯一位置提示 / 音效 / 震动。它们改的是玩起来的手感与观感，
 * 跟棋盘上摆的是什么无关，所以不需要「换一局」来落地。
 *
 * 这个面板原先还装着「开一局新的」（棋盘大小 / 目标难度 / 挑战）与「分享这一
 * 局」，现在都搬走了：
 *   · 开新局 → panels/newgame.js（顶栏那颗「新一局」）
 *   · 分享   → panels/info.js（本局信息页）
 * 于是这里既没有折叠，也没有下半截——一屏摊开就这九行。
 *
 * 行本身的样式（.switch-row / .switch / .stepper-label）在 base/buttons.css，
 * 换一局面板也在用；这份文件只写「设置这一列」的节奏。
 * ========================================================================== */

import { audio, buzz, sfx } from '../../core/audio.js';
import { btnSettings } from '../../core/dom.js';
import { createSheet } from '../../core/sheet.js';
import { settings, view } from '../../core/state.js';
import { saveSettings } from '../../core/storage.js';
import { announce } from '../../core/utils.js';
import { applyBgBlur } from '../effects.js';
import { applyFadeNow } from '../fade.js';
import { updateHint } from '../hint.js';
import { render } from '../render.js';

export var HTML = /* html */ `
<div class="sheet-wrap" id="sheetWrap" hidden>
  <div class="sheet-backdrop" id="sheetBackdrop"></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" tabindex="-1">
    <div class="sheet-head">
      <h2 id="sheetTitle">设置</h2>
      <button class="icon-btn" id="btnCloseSheet" type="button" aria-label="关闭设置">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18"></path>
        </svg>
      </button>
    </div>
    <p class="sheet-note">拨完即时生效，不影响棋盘上的这一局</p>

    <div class="settings-list">
      <div class="switch-row">
        <div class="stepper-label">自动打 ×<small>同行、同列、相邻格和整片同色块都会自动打叉</small></div>
        <button class="switch" id="swAuto" type="button" role="switch" aria-checked="true" aria-label="自动标记"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">拖动按行列对齐<small>开着时长按拖动只涂一行或一列；关掉后可以顺着手指轨迹随意涂</small></div>
        <button class="switch" id="swAlignDrag" type="button" role="switch" aria-checked="true" aria-label="拖动按行列对齐"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">淡化 ×<small>打过 × 的格子整格透成背景色，手停 0.5 秒后生效</small></div>
        <button class="switch" id="swFadeMark" type="button" role="switch" aria-checked="false" aria-label="淡化叉"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">淡化皇后<small>放了皇后的格子整格透成背景色，换什么外观都一样</small></div>
        <button class="switch" id="swFadeQueen" type="button" role="switch" aria-checked="false" aria-label="淡化皇后"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">模糊背景<small>背景动画糊成一层纱，安静一些；棋盘本身不受影响</small></div>
        <button class="switch" id="swBlurBg" type="button" role="switch" aria-checked="false" aria-label="模糊背景"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">冲突高亮<small>皇后互相冲突时闪红并连线</small></div>
        <button class="switch" id="swConflict" type="button" role="switch" aria-checked="true" aria-label="冲突高亮"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">唯一位置提示<small>某行、某列或某个色块只剩一格没标 × 时，这格会亮一下</small></div>
        <button class="switch" id="swForced" type="button" role="switch" aria-checked="true" aria-label="唯一位置提示"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">音效<small>落子、打叉、冲突与胜利提示音</small></div>
        <button class="switch" id="swSound" type="button" role="switch" aria-checked="true" aria-label="音效"></button>
      </div>

      <div class="switch-row">
        <div class="stepper-label">震动<small>手机上的触感反馈</small></div>
        <button class="switch" id="swHaptics" type="button" role="switch" aria-checked="true" aria-label="震动"></button>
      </div>
    </div>
  </div>
</div>`;

var sheetWrap = null, sheet = null, sheetBackdrop = null;

var sheetCtl = null;

/* 开关列：顺序与 markup 一致，syncSheet 按这张表把 aria-checked 刷回真实值 */
var SWITCHES = [
  ['swAuto', 'autoMark'],
  ['swAlignDrag', 'alignDrag'],
  ['swFadeMark', 'fadeMark'],
  ['swFadeQueen', 'fadeQueen'],
  ['swBlurBg', 'blurBg'],
  ['swConflict', 'conflict'],
  ['swForced', 'forced'],
  ['swSound', 'sound'],
  ['swHaptics', 'haptics']
];

export function syncSheet() {
  for (var i = 0; i < SWITCHES.length; i++) {
    var el = document.getElementById(SWITCHES[i][0]);
    if (el) el.setAttribute('aria-checked', settings[SWITCHES[i][1]] ? 'true' : 'false');
  }
}

/* ==========================================================
   开 / 关
   ========================================================== */
export function openSettings() { sheetCtl.open(); }
export function closeSettings() { sheetCtl.close(); }
export function isSettingsOpen() { return !!sheetCtl && sheetCtl.isOpen(); }

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  sheetWrap = document.getElementById('sheetWrap');
  sheet = document.getElementById('sheet');
  sheetBackdrop = document.getElementById('sheetBackdrop');

  sheetCtl = createSheet({
    id: 'settings',
    wrap: sheetWrap,
    panel: sheet,
    opener: btnSettings,
    /* 关掉之后把焦点还给触发按钮（设置 / 战绩这两层沿用原来的做法：
     * 直接 blur，键盘用户按 Esc 之后接着用 X / Q / Z 不会误触到按钮上） */
    focusOpener: false,
    beforeOpen: syncSheet
  });

  btnSettings.addEventListener('click', openSettings);
  document.getElementById('btnCloseSheet').addEventListener('click', closeSettings);
  sheetBackdrop.addEventListener('click', closeSettings);

  /* ---- 开关：即时生效，跟音效 / 冲突高亮一个规矩 ---- */
  sheet.addEventListener('click', function (e) {
    var sw = e.target.closest ? e.target.closest('.switch') : null;
    if (!sw) return;
    var id = sw.id;
    if (id === 'swAuto') {
      settings.autoMark = !settings.autoMark;
      render();
    } else if (id === 'swAlignDrag') {
      // 拖动对齐只影响手指怎么涂，棋盘不用重画；提示行那句话跟着换
      settings.alignDrag = !settings.alignDrag;
      updateHint();
      announce(settings.alignDrag ? '拖动：按行列对齐' : '拖动：可以随意涂');
    } else if (id === 'swFadeMark' || id === 'swFadeQueen') {
      // 淡化是纯外观，不用重画格子：只加减一个类。拨开关的人正盯着效果，
      // 这里不跟 0.5 秒防抖，立刻落地（见 ui/fade.js 的 applyFadeNow）。
      if (id === 'swFadeMark') settings.fadeMark = !settings.fadeMark;
      else settings.fadeQueen = !settings.fadeQueen;
      applyFadeNow();
    } else if (id === 'swBlurBg') {
      /* 模糊背景：只糊背景动画那一层（ui/effects.js），棋盘一像素都不动，
       * 所以也不用重画。拨完立刻见效果，跟上面两个淡化一个规矩。 */
      settings.blurBg = !settings.blurBg;
      applyBgBlur();
      announce(settings.blurBg ? '背景已模糊' : '背景恢复清晰');
    } else if (id === 'swConflict') {
      settings.conflict = !settings.conflict;
      if (!settings.conflict) view.lastConflictCount = 0;
      render();
    } else if (id === 'swForced') {
      settings.forced = !settings.forced;
      render();
    } else if (id === 'swSound') {
      settings.sound = !settings.sound;
      if (settings.sound) { audio.init(); sfx('x'); }
    } else if (id === 'swHaptics') {
      settings.haptics = !settings.haptics;
      if (settings.haptics) buzz(12);
    }
    syncSheet();
    saveSettings();
  });
}
