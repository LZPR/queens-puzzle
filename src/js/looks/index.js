/* ============================================================================
 * looks/index.js
 * 外观插件登记处。
 * ----------------------------------------------------------------------------
 * 外观（色块图案 / 叉 / 皇后 / 生命 / 开局 / 通关 / 礼炮）由一批插件提供：
 * `src/js/looks/` 下每个文件导出一个插件，一个插件可以只提供一样东西，
 * 也可以几样都给。面板（ui/panels/look.js）按这里登记的顺序现场生成展柜，
 * 棋盘（game/skin.js、game/board.js）按存档里的 id 去取画法。
 *
 * 一个插件长这样：
 *
 *   export default {
 *     id: 'geometry',       // 插件名，只用来在面板上分组
 *     name: '几何',
 *     note: '一句话说明',
 *     surfaces: [ ... ],    // 色块：可以没有
 *     marks:    [ ... ],    // 叉：可以没有
 *     pieces:   [ ... ],    // 皇后：可以没有
 *     lifes:    [ ... ],    // 生命：可以没有（键名按 `<名字>s` 的规矩，所以是 lifes）
 *     deals:    [ ... ],    // 开局动画：可以没有
 *     reveals:  [ ... ],    // 通关画面：可以没有
 *     confettis:[ ... ],    // 礼炮：可以没有
 *     stylesheet: '...'     // 插件自己的 CSS URL：可以没有
 *   };
 *
 * 几类样式各自的字段：
 *
 *   色块 surface —— { id, name, tone, motifs, desc, ink?, veil? }
 *     tone    图形跟底色差多少（0–1）。0 = 没有图案（纯色）。
 *     ink     'shade'（默认，压暗）/ 'tint'（朝纸白提亮，天空那套用）。
 *     veil    整层图案的透明度（0–1，默认 1）。有的主题自己就亮（贴纸的白边），
 *             全套淡一档才不跟 × 抢；是对这套图案的定义，不分打没打叉。
 *     motifs  按 core/palette.js 调色板下标排的图形，viewBox 一律 0 0 100 100，
 *             只给形状不给颜色（填色继承外面），画在 20–80 之间、四周留白当格距。
 *             长度不必等于 18：缺的下标就是「这格不画」。
 *
 *   叉 mark —— { id, name, hint, hintFree, preview }
 *     hint / hintFree  提示行文案（按行列对齐 / 随意涂两种说法），可省。
 *     preview  'x' | 'dot'：展柜里那个小预览怎么画（棋盘上的画法在 styles/panels/look.css，
 *              按 <html data-mark> 切换）。
 *
 *   皇后 piece —— { id, name, svg }
 *     svg  整段 SVG 源码，剪影走 currentColor（跟格子的墨色同步）。
 *
 *   生命 life —— { id, name, desc }
 *     只给名字与说明：画法在 styles/base/lives.css，按 <html data-life> 切换。
 *     这一条不在棋盘上（挑战「标错惩罚」的命数指示），打完名册就是一套能用的样式。
 *
 * 加一个插件：在 looks/ 里新建一个文件，然后在下面 PLUGINS 里加一行 import。
 * 别处都不用动 —— 面板会自己长出新的展位，存档认不出来的 id 也会退回默认。
 * ========================================================================== */

import classic from './classic.js';
import geometry from './geometry.js';
import life from './life.js';
import nature from './nature.js';
import sky from './sky.js';
import sticker from './sticker.js';
import transitions from './transitions.js';
import pokemon from './pokemon.js';
import originalEffects from './original-effects.js';
import celebration from './celebration.js';

/* 外观类别。key 是它存在 settings 里的字段，attr 是落到 <html> 上的钩子。 */
export var KIND = {
  surface: { key: 'surfaceStyle', attr: 'data-surface', label: '色块' },
  mark: { key: 'markStyle', attr: 'data-mark', label: '叉' },
  piece: { key: 'pieceStyle', attr: 'data-piece', label: '皇后' },
  life: { key: 'lifeStyle', attr: 'data-life', label: '生命' },
  deal: { key: 'dealStyle', attr: 'data-deal', label: '开局' },
  reveal: { key: 'revealStyle', attr: 'data-reveal', label: '通关' },
  confetti: { key: 'confettiStyle', attr: 'data-confetti', label: '礼炮' }
};

/* 顺序就是面板里从上到下的顺序，也是每一类里第一项「默认」的意思。 */
export var KINDS = ['surface', 'mark', 'piece', 'life', 'deal', 'reveal', 'confetti'];

/* ---- 插件清单 ----
 * 色块图案的几套主题排在前面（面板里是同一排），墨线那套垫底：
 * 它提供的「纯色」就是没有图案的那一档。生命单独一个插件——它不在棋盘上，
 * 跟哪套纹样都没关系。 */
var PLUGINS = [geometry, nature, sky, sticker, classic, life, transitions, pokemon, originalEffects, celebration];

/* ==========================================================
   登记：把插件按类别摊平成表
   ----------------------------------------------------------
   每一项都带上 plugin / pluginName，面板据此分组、按钮上挂小标签。
   ========================================================== */
export var PLUGIN_LIST = [];
var LISTS = {}, GROUPS = {};
for (var kind of KINDS) { LISTS[kind] = []; GROUPS[kind] = []; }

(function collect() {
  for (var p = 0; p < PLUGINS.length; p++) {
    var plug = PLUGINS[p] || {};
    var info = {
      id: plug.id || 'plugin-' + (p + 1),
      name: plug.name || plug.id || '插件 ' + (p + 1),
      note: plug.note || '',
      stylesheet: plug.stylesheet || '',
      mount: plug.mount, onBoard: plug.onBoard, onWin: plug.onWin
    };
    PLUGIN_LIST.push(info);

    for (var k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var items = plug[kind + 's'] || [];
      var mine = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        // 没有 id 的条目既存不下也认不回来，直接跳过（插件写错不至于把面板画空）
        if (!it || !it.id) continue;
        it.plugin = info.id;
        it.pluginName = info.name;
        LISTS[kind].push(it);
        mine.push(it);
      }
      if (mine.length) GROUPS[kind].push({ plugin: info, items: mine });
    }
  }
})();

/** 某一类的全部样式（跨插件，按登记顺序）。 */
export function listOf(kind) {
  return LISTS[kind] || [];
}

/** 某一类按插件分好的组：[{ plugin, items }]。面板靠它决定要不要显示插件小标签。 */
export function groupsOf(kind) {
  return GROUPS[kind] || [];
}

/** 按 id 找一套样式；找不到给 null。 */
export function findOf(kind, id) {
  var list = LISTS[kind] || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** 认一个样式 id：认不出来（老存档 / 手改过 / 插件被删了）就退回这一类里的第一套。 */
export function styleId(kind, id) {
  if (kind === 'reveal') id = ({ kitten: 'pokemon', starlight: 'pokemon-ripple' })[id] || id;
  if (findOf(kind, id)) return id;
  var first = (LISTS[kind] || [])[0];
  return first ? first.id : '';
}

/** 样式的人话名字：面板标题、读屏播报共用。 */
export function styleName(kind, id) {
  var o = findOf(kind, id) || (LISTS[kind] || [])[0];
  return o ? o.name : '';
}

/** 出厂的这一套：每一类的第一项。settings 的默认值就是它。 */
export var DEFAULT_LOOK = {};
for (var kind of KINDS) DEFAULT_LOOK[kind] = ((LISTS[kind] || [])[0] || {}).id || '';

/** 皇后那一格画什么。认不出来就画第一套，不至于让格子空着。 */
export function pieceSvg(id) {
  var o = findOf('piece', id) || (LISTS.piece || [])[0];
  return o && o.svg ? o.svg : '';
}
