/* ============================================================================
 * panels/look.js · 外观面板
 * ----------------------------------------------------------------------------
 * 七排「展柜」：色块的花样、叉、皇后、生命（挑战「标错惩罚」的命数）长什么样，
 * 外加三样会动的 —— 点击特效、背景动画、棋盘滤镜。
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
import { isUnlocked } from '../../core/unlock.js';
import { DEFAULT_LOOK, KIND, KINDS, findOf, groupsOf, styleId, styleName } from '../../looks/index.js';
import { applyEffects } from '../effects.js';

/* 一排展柜的骨架：标题 + 「当前：…」 + 装展位的行。
 * 七排长得一样，所以按 KINDS 现场生成——加一类外观只改 looks/index.js，
 * 这个文件不用再抄一段 markup（以前的四排是手写的，加第五排就得double一遍）。 */
function caseHtml(kind) {
  var k = KIND[kind];
  return '<div class="case">' +
      '<div class="case-head"><b>' + k.label + '</b>' +
        '<span id="' + kind + 'Now">当前：' + styleName(kind, DEFAULT_LOOK[kind]) + '</span></div>' +
      '<div class="case-row" id="' + kind + 'Row" role="radiogroup" aria-label="' + k.label + '的样式"></div>' +
    '</div>';
}

/* 前四排画在棋盘上 / 命数条上（色块 / 叉 / 皇后 / 生命）；
 * 后三排是「动起来」的三样：
 *   · 点击特效只管被点的那一格，
 *   · 背景动画在棋盘之外，
 *   · 棋盘滤镜只罩棋盘本身。
 * 展位本身由 src/js/looks/ 里登记的插件现场生成。 */
var CASES = (function () {
  var out = '';
  for (var i = 0; i < KINDS.length; i++) out += caseHtml(KINDS[i]);
  return out;
})();

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
    <p class="sheet-note">外观从每日挑战的抽奖里解锁：完成一挡就能抽一次，
      转到三枚一样的，就把那套外观收进展柜；两枚一样再多转一次。
      每排的第一套是开局自带的，抽到的都在这里换。</p>

    ${CASES}
  </div>
</div>`;

var lookWrap = null, lookSheet = null, lookBackdrop = null;

var sheet = null;

/* 每类外观落在面板里的容器与「当前：…」那行小字。
 * 按 KINDS 一张表建齐（七排），加一类外观不用在这里加变量。
 * 注意：生命那一排的展位 id 是 lifeRow —— 跟舞台上方那条命数读数（#livesRow）
 * 差一个字母，别搞混。 */
var ROW_ELS = null;

/* 展位右上角那枚勾：选中才亮，用一块黄圆点把「就是这套」说清楚 */
var TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6.4 12.6l3.6 3.6 7.6-8" fill="none" stroke="currentColor" stroke-width="3.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/* 锁着的那几套在玻璃罩右下角挂一枚小锁：没解锁的就是没到手，别让人点半天没反应 */
var LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="4.6" y="10.4" width="14.8" height="10" rx="2.4" fill="currentColor"/>' +
  '<path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
  '<circle cx="12" cy="15.2" r="1.7" fill="#fff"/>' +
  '</svg>';

/* 色块图案的预览挑这四枚：图形彼此差得远，2×2 摆开一眼能看出这套花样是什么脾气 */
var SKIN_PICKS = [8, 14, 5, 10];

/* 一小块 2×2 的棋盘（底色 + 图形），就是它在盘子上缩小的样子。
 * 预览里的图案比棋盘上**深一点**（浓度放到三倍多）：缩到五十来像素，
 * 按棋盘那个浓度画就等于什么都没画，展柜里得让人认出这是哪一套。
 * 压暗 / 提亮由 surfaceInk 按这套图案自己的 ink 决定，预览不另算。
 * extra 是额外的行内样式（棋盘滤镜那排要把滤镜本身叠上去）。 */
function miniBoard(o, extra) {
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
  return '<span class="pv-skin" style="opacity:' + veil + (extra ? ';' + extra : '') + '">' +
    '<svg viewBox="0 0 100 100" aria-hidden="true">' + out + '</svg></span>';
}

/* 「无」这类开关的牌子：一个空落落的格子 + 一道 ∅。
 * 不画效果本身，免得看着像「这套也在动」。 */
function noneGlyph() {
  return '<span class="pv-tile is-empty">' +
    '<svg class="pv-none" viewBox="0 0 52 52" aria-hidden="true">' +
      '<circle cx="26" cy="26" r="16" fill="none" stroke="currentColor" stroke-width="2.2"' +
      ' stroke-dasharray="3.4 4.8"/>' +
      '<path d="M19.6 26h12.8" fill="none" stroke="currentColor" stroke-width="2.6"' +
      ' stroke-linecap="round"/>' +
    '</svg></span>';
}

/* 柜子里摆什么：把这一套缩小画一份摆在台子上 */
function preview(kind, o) {
  if (kind === 'surface') return miniBoard(o);

  /* 棋盘滤镜：拿**当前这套色块**当样本，一模一样的小盘，只差一道滤镜。
   * 滤镜的值由插件自己写在 `filter` 上，这里照抄——样式表不认识任何一套滤镜。 */
  if (kind === 'filter') {
    var surf = findOf('surface', settings.surfaceStyle) || {};
    return miniBoard(surf, o.filter ? 'filter:' + o.filter : '');
  }

  if (kind === 'click') {
    if (o.id === 'none') return noneGlyph();
    /* 涟漪：一小块格子 + 三圈由外到内、由淡到深的墨环，取「正在扩散」的那一帧 */
    return '<span class="pv-tile">' +
      '<i class="pv-rip r1"></i><i class="pv-rip r2"></i><i class="pv-rip r3"></i>' +
      '</span>';
  }

  if (kind === 'bg') {
    if (o.id === 'none') return noneGlyph();
    /* 几何：几枚形状高低错落，看得出是「往下落的一片」 */
    return '<span class="pv-tile">' +
      '<svg class="pv-snow" viewBox="0 0 52 52" aria-hidden="true">' +
        '<path d="M9.6 3.2l5 8.6h-10z" opacity=".5"/>' +
        '<rect x="34" y="6" width="7.4" height="7.4" rx="1.2" opacity=".3"' +
          ' transform="rotate(18 37.7 9.7)"/>' +
        '<path d="M38.6 20.4l4.6 7.8H34z" opacity=".26"/>' +
        '<circle cx="11.4" cy="26.4" r="3.8" opacity=".34"/>' +
        '<path d="M27 27.6l3.6 2.1v4.2L27 36l-3.6-2.1v-4.2z" opacity=".24"/>' +
        '<rect x="6.4" y="35.6" width="6.6" height="6.6" rx="1.1" opacity=".22"' +
          ' transform="rotate(-12 9.7 38.9)"/>' +
      '</svg></span>';
  }

  if (kind === 'mark') {
    return o.preview === 'dot'
      ? '<span class="pv-dot"></span>'
      : '<span class="pv-x"><i></i><i></i></span>';
  }

  return o.svg || '';
}

/* 一个展位：上面是罩在玻璃里的台子，下面是名牌（只写名字，不加描述）。
 * src 只有在这一排跨了多个插件时才给：一个插件的东西不用自己标自己。
 * 锁着的套挂在展位上照摆（让人知道有这么一套），但整柜褪色、名牌蒙灰，
 * 玻璃罩右下角一枚小锁——名字亮着不给选。 */
function slotHtml(kind, o, src, locked) {
  return '<span class="sc-case" aria-hidden="true">' +
      '<span class="sc-lamp"></span>' +
      '<span class="sc-item">' + preview(kind, o) + '</span>' +
      '<span class="sc-plinth"></span>' +
      '<span class="sc-glass"></span>' +
      (locked ? '<span class="sc-lock">' + LOCK_SVG + '</span>' : '') +
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
      var locked = !isUnlocked(kind, o.id);
      b.title = (src ? src + ' · ' : '') + o.name + (o.desc ? '：' + o.desc : '') +
        (locked ? '（还没解锁：抽奖抽到三枚一样的才开）' : '');
      b.innerHTML = slotHtml(kind, o, src, locked);
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
 * 点击特效 / 背景 / 棋盘滤镜：交给 ui/effects.js（它管三层：格子里的一下、
 * 棋盘外的一层、整块棋盘上的一道滤镜）。
 * 七样都只是「画法 / 动效」，不碰 state.marks，也不影响存档里的局面。 */
export function applyLook() {
  var root = document.documentElement;
  root.setAttribute('data-mark', settings.markStyle);
  root.setAttribute('data-piece', settings.pieceStyle);
  root.setAttribute('data-life', settings.lifeStyle);
  applySurface();   // 顺带写 data-surface、建 defs、给每格上墨色
  applyEffects();   // 顺带写 data-click / data-bg / data-filter、铺背景层、挂滤镜
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
      var bid = btns[i].dataset[kind];
      /* 锁是活的：抽奖解开了新套，展柜这边下次同步就把小锁摘掉。
       * aria-disabled 跟着走——读屏也知道这一格现在按了没用。 */
      var locked = !isUnlocked(kind, bid);
      btns[i].classList.toggle('is-locked', locked);
      btns[i].setAttribute('aria-disabled', locked ? 'true' : 'false');
      var on = bid === id;
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
  /* 锁着的展位点不出声色：响一下、报一句，别让玩家以为按钮坏了 */
  if (!isUnlocked(kind, id)) {
    buzz(8);
    announce('「' + styleName(kind, id) + '」还没解锁：去每日挑战抽奖，抽到三枚一样的才开');
    return;
  }
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

  ROW_ELS = {};
  for (var kk = 0; kk < KINDS.length; kk++) {
    var kind = KINDS[kk];
    ROW_ELS[kind] = {
      row: document.getElementById(kind + 'Row'),
      now: document.getElementById(kind + 'Now')
    };
    buildCase(kind);
  }

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
  lookBackdrop.addEventListener('click', closeLook);

  lookSheet.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.showcase') : null;
    if (!b) return;
    /* 七排的按钮都叫 .showcase，靠 data-surface / data-mark / … / data-filter
     * 分派。按 KINDS 挨个认，加一类外观不用再来这里加一支 else if。 */
    for (var i = 0; i < KINDS.length; i++) {
      var id = b.dataset[KINDS[i]];
      if (id) { pickLook(KINDS[i], id); return; }
    }
  });
}
