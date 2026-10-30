/* ============================================================================
 * panels/look.js · 外观面板
 * ----------------------------------------------------------------------------
 * 按类别生成「展柜」：色块、棋子、生命，以及开局 / 通关 / 礼炮。
 * 选项不写在这个文件里：按钮是按 looks/index.js 登记的外观插件现场生成的，
 * 一排里跨了好几个插件时，每个展位左上角会挂一个插件名的小标签。
 *
 * 跟棋盘大小那套 pending 不一样：外观是**即时生效**的（跟音效 / 冲突高亮一类），
 * 选完立刻写 settings、存盘、落到 <html data-*> 上，棋盘跟着变。
 *
 * 这个文件同时管「外观」这件事本身（applyLook / pickLook），面板只是它的门面：
 * 开一局时 main.js 要先 applyLook() 再建棋盘，那时面板还没打开过。
 * ========================================================================== */

import { buzz, sfx } from '../../core/audio.js';
import { btnLook } from '../../core/dom.js';
import { REGION_COLORS } from '../../core/palette.js';
import { createSheet } from '../../core/sheet.js';
import { settings, view } from '../../core/state.js';
import { saveSettings } from '../../core/storage.js';
import { announce } from '../../core/utils.js';
import { applyPieceStyle } from '../../game/board.js';
import { applySurface, surfaceInk } from '../../game/skin.js';
import { DEFAULT_LOOK, KIND, KINDS, groupsOf, styleId, styleName } from '../../looks/index.js';
import { applyEffectLooks } from '../../looks/effects.js';

export var HTML = /* html */ `
<div class="sheet-wrap" id="lookWrap" hidden>
  <div class="sheet-backdrop" id="lookBackdrop"></div>
  <div class="sheet look-sheet" id="lookSheet" role="dialog" aria-modal="true" aria-labelledby="lookTitle" tabindex="-1">
    <div class="sheet-head">
      <h2 id="lookTitle">外观</h2>
      <button class="icon-btn" id="btnCloseLook" type="button" aria-label="关闭外观">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18"></path>
        </svg>
      </button>
    </div>
    <p class="sheet-note">棋盘、棋子和动画各挑一样。选完立刻生效，局面和成绩都不变。</p>

    <!-- 三排展柜：选项按钮由 src/js/looks/ 里登记的外观插件现场生成。
         一排里跨了多个插件时，展位左上角会挂一个插件名的小标签。 -->
    <div class="case">
      <div class="case-head"><b>色块</b><span id="surfaceNow">当前：几何</span></div>
      <div class="case-row" id="surfaceRow" role="radiogroup" aria-label="色块的样式"></div>
    </div>

    <div class="case">
      <div class="case-head"><b>叉</b><span id="markNow">当前：叉</span></div>
      <div class="case-row" id="markRow" role="radiogroup" aria-label="叉的样式"></div>
    </div>

    <div class="case">
      <div class="case-head"><b>皇后</b><span id="pieceNow">当前：皇后</span></div>
      <div class="case-row" id="pieceRow" role="radiogroup" aria-label="皇后样式"></div>
    </div>

    <!-- 生命的画法只影响挑战「标错惩罚」那一排命（信息条下面，见 base/lives.css）：
         惩罚没开的时候是收起来的，所以这一排平时看不出来。 -->
    <div class="case">
      <div class="case-head"><b>生命</b><span id="lifeNow">当前：红心</span></div>
      <div class="case-row" id="lifeRow" role="radiogroup" aria-label="生命的样式"></div>
    </div>

    <div id="effectCases"></div>
    <button class="btn sheet-done" id="btnLookDone" type="button">知道了</button>
  </div>
</div>`;

var lookWrap = null, lookSheet = null, lookBackdrop = null;
var surfaceRow = null, surfaceNow = null;
var markRow = null, markNow = null;
var pieceRow = null, pieceNow = null;
/* 注意：lifeRow 是这一排展位，跟舞台上方那条命数读数（#livesRow）不是一回事 */
var lifeRow = null, lifeNow = null;

var sheet = null;

/* 每类外观落在面板里的容器与「当前：…」那行小字 */
var ROW_ELS = null;

/* 展位右上角那枚勾：选中才亮，用一块黄圆点把「就是这套」说清楚 */
var TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6.4 12.6l3.6 3.6 7.6-8" fill="none" stroke="currentColor" stroke-width="3.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/* 色块图案的预览挑这四枚：图形彼此差得远，2×2 摆开一眼能看出这套花样是什么脾气 */
var SKIN_PICKS = [8, 14, 5, 10];

/* 柜子里摆什么：把这一套缩小画一份摆在台子上 */
function preview(kind, o) {
  if (kind === 'surface') {
    /* 2×2 的一小块棋盘：底色 + 图形，就是它在盘子上缩小的样子。
     * 预览里的图案比棋盘上**深一点**（浓度放到三倍多）：缩到五十来像素，
     * 按棋盘那个浓度画就等于什么都没画，展柜里得让人认出这是哪一套。
     * 压暗 / 提亮由 surfaceInk 按这套图案自己的 ink 决定，预览不另算。 */
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
        var ink = surfaceInk(color, o, k);
        out += '<g transform="translate(' + x + ' ' + y + ') scale(.5)"' +
          ' fill="' + ink + '" style="color:' + ink + '">' + o.motifs[ci] + '</g>';
      }
    }
    /* 预览也戴上这套图案自己的纱（veil）：展柜里看到什么，选完棋盘上就是什么。
     * 只戴一半——纱开个方（.45 → .67）：小盘只有四十来像素，全戴上就糊成一片，
     * 展柜毕竟还得让人认出这是哪一套。 */
    var veil = isFinite(o.veil) ? Math.sqrt(o.veil) : 1;
    return '<span class="pv-skin" style="opacity:' + veil + '">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true">' + out + '</svg></span>';
  }

  if (kind === 'mark') {
    return o.preview === 'dot'
      ? '<span class="pv-dot"></span>'
      : '<span class="pv-x"><i></i><i></i></span>';
  }

  return o.svg || '';
}

/* 一个展位：上面是罩在玻璃里的台子，下面是名牌（只写名字，不加描述）。
 * src 只有在这一排跨了多个插件时才给：一个插件的东西不用自己标自己。 */
function slotHtml(kind, o, src) {
  return '<span class="sc-case" aria-hidden="true">' +
      '<span class="sc-lamp"></span>' +
      '<span class="sc-item">' + preview(kind, o) + '</span>' +
      '<span class="sc-plinth"></span>' +
      '<span class="sc-glass"></span>' +
      (src ? '<span class="sc-src">' + src + '</span>' : '') +
    '</span>' +
    '<span class="sc-plate"><b>' + o.name + '</b></span>' +
    '<span class="sc-tick" aria-hidden="true">' + TICK_SVG + '</span>';
}

/* 选项按插件现场生成，跟限时挡位一个规矩：插件登记一处，面板跟着变。
 * 按钮的可读名就取名牌上的字（预览是 aria-hidden 的），不再另写 aria-label，
 * 免得读屏念出「叉的样式：叉」这种自己重复一遍的话。 */
function buildCase(kind) {
  var host = ROW_ELS[kind].row;
  if (!host || host.childNodes.length) return;
  var groups = groupsOf(kind);
  var multi = groups.length > 1;
  for (var g = 0; g < groups.length; g++) {
    var items = groups[g].items;
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'showcase';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset[kind] = o.id;
      b.dataset.plugin = o.plugin;
      /* 插件名只在「说了多一件事」的时候才露出来：这一排跨了几个插件、
       * 而这套的名字又跟插件不一样（比如「纯色」出自「墨线」）。
       * 几何 / 自然 / 天空 / 贴纸 是一套一个插件，名字本来就是它，再标一遍是废话。 */
      var src = multi && o.pluginName !== o.name ? o.pluginName : '';
      b.title = (src ? src + ' · ' : '') + o.name + (o.desc ? '：' + o.desc : '');
      b.innerHTML = slotHtml(kind, o, src);
      host.appendChild(b);
    }
  }
}

/* ==========================================================
   落地与同步
   ========================================================== */
/* 色块：<html data-surface> + 重建图案 defs + 逐格换 href（game/skin.js）。
 * 叉：只改 <html data-mark>，CSS 自己会换画法（不需要重画格子）。
 * 皇后：<html data-piece> 管占位，格子里的画由 board.js 换。
 * 生命：只改 <html data-life>，命数那一排的两套画法都在 DOM 里，CSS 决定露哪套。
 * 四样都只是「画法」，不碰 state.marks，也不影响存档里的局面。 */
export function applyLook() {
  var root = document.documentElement;
  root.setAttribute('data-mark', settings.markStyle);
  root.setAttribute('data-piece', settings.pieceStyle);
  root.setAttribute('data-life', settings.lifeStyle);
  for (var kind of KINDS) root.setAttribute(KIND[kind].attr, settings[KIND[kind].key]);
  applyEffectLooks();
  applySurface();   // 顺带写 data-surface、建 defs、给每格上墨色
  // 只在真的换了样式时重画格子里的画：新棋盘本来是照当前样式建的，不用再刷一遍
  if (view.lookPiece !== settings.pieceStyle) applyPieceStyle();
  syncLook();
}

export function syncLook() {
  if (!ROW_ELS) return;
  for (var k = 0; k < KINDS.length; k++) {
    var kind = KINDS[k];
    var els = ROW_ELS[kind];
    var id = settings[KIND[kind].key];
    var btns = els.row ? els.row.querySelectorAll('.showcase') : [];
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset[kind] === id;
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (els.now) els.now.textContent = '当前：' + styleName(kind, id);
  }

  /* 顶栏那颗按钮上挂一颗小黄点：说明「你现在看的是换过的样式」，
   * 不然以后忘了默认长什么样，会以为是坏了。 */
  var custom = false;
  for (var j = 0; j < KINDS.length; j++) {
    if (settings[KIND[KINDS[j]].key] !== DEFAULT_LOOK[KINDS[j]]) custom = true;
  }
  if (btnLook) {
    btnLook.classList.toggle('is-set', custom);
    btnLook.setAttribute('aria-label', custom ? '外观，已换过样式' : '外观');
  }
}

export function pickLook(kind, id) {
  if (!KIND[kind]) return;
  var key = KIND[kind].key;
  id = styleId(kind, id);
  if (settings[key] === id) return;
  settings[key] = id;
  saveSettings();
  applyLook();
  sfx('x');
  buzz(6);
  announce(KIND[kind].label + '改成「' + styleName(kind, id) + '」');
}

export function openLook() { sheet.open(); }
export function closeLook() { sheet.close(); }
export function isLookOpen() { return !!sheet && sheet.isOpen(); }

/* ==========================================================
   挂载
   ========================================================== */
export function mount(host) {
  host.insertAdjacentHTML('beforeend', HTML);

  lookWrap = document.getElementById('lookWrap');
  lookSheet = document.getElementById('lookSheet');
  lookBackdrop = document.getElementById('lookBackdrop');
  surfaceRow = document.getElementById('surfaceRow');
  surfaceNow = document.getElementById('surfaceNow');
  markRow = document.getElementById('markRow');
  markNow = document.getElementById('markNow');
  pieceRow = document.getElementById('pieceRow');
  pieceNow = document.getElementById('pieceNow');
  lifeRow = document.getElementById('lifeRow');
  lifeNow = document.getElementById('lifeNow');

  ROW_ELS = {
    surface: { row: surfaceRow, now: surfaceNow },
    mark: { row: markRow, now: markNow },
    piece: { row: pieceRow, now: pieceNow },
    life: { row: lifeRow, now: lifeNow }
  };
  // 新的外观类别沿用作者的展柜结构，选项仍全部来自 looks/ 的插件登记。
  var effectCases = document.getElementById('effectCases');
  for (var kind of KINDS) {
    if (ROW_ELS[kind]) continue;
    effectCases.insertAdjacentHTML('beforeend', '<div class="case">' +
      '<div class="case-head"><b>' + KIND[kind].label + '</b><span id="' + kind + 'Now"></span></div>' +
      '<div class="case-row" id="' + kind + 'Row" role="radiogroup" aria-label="' + KIND[kind].label + '的样式"></div></div>');
    ROW_ELS[kind] = { row: document.getElementById(kind + 'Row'), now: document.getElementById(kind + 'Now') };
  }
  for (var kk = 0; kk < KINDS.length; kk++) buildCase(KINDS[kk]);

  /* 跟设置 / 本局信息 / 战绩同一套：inert、canPlay、Esc、Tab 都在 core/sheet.js 里。
   * 关掉之后焦点回到顶栏那颗按钮，键盘用户不用重新 Tab 一遍。 */
  sheet = createSheet({
    id: 'look',
    wrap: lookWrap,
    panel: lookSheet,
    opener: btnLook,
    focusOpener: true,
    beforeOpen: syncLook
  });

  btnLook.addEventListener('click', openLook);
  document.getElementById('btnCloseLook').addEventListener('click', closeLook);
  document.getElementById('btnLookDone').addEventListener('click', closeLook);
  lookBackdrop.addEventListener('click', closeLook);

  lookSheet.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.showcase') : null;
    if (!b) return;
    for (var kind of KINDS) if (b.dataset[kind]) { pickLook(kind, b.dataset[kind]); break; }
  });
}
