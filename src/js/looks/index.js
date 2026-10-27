/* ============================================================================
 * looks/index.js
 * 外观插件登记处。
 * ----------------------------------------------------------------------------
 * 外观（色块图案 / 叉 / 皇后 / 生命 / 点击特效 / 背景 / 棋盘滤镜）不再写死在
 * core/config.js 里，而是一批插件：`src/js/looks/` 下每个文件导出一个插件，
 * 一个插件可以只提供一样东西，也可以几样都给。面板（ui/panels/look.js）
 * 按这里登记的顺序现场生成展柜，棋盘（game/skin.js、game/board.js）
 * 与动效层（ui/effects.js）按存档里的 id 去取画法。
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
 *     lifes:    [ ... ],    // 生命：可以没有
 *     clicks:   [ ... ],    // 点击特效：可以没有
 *     bgs:      [ ... ],    // 背景动画：可以没有
 *     filters:  [ ... ]     // 棋盘滤镜：可以没有
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
 *   点击特效 click —— { id, name, desc }
 *     点任意一格时播的那一下。只有 id 有意义：动作在 ui/effects.js 里按 id 分派，
 *     画法在 styles/base/effects.css。**只作用于被点的那一格**（涟漪的圆被格子
 *     自己的 overflow: hidden 裁掉，不会漫到隔壁）。
 *
 *   背景动画 bg —— { id, name, desc }
 *     棋盘**之外**那层会动的东西（styles/base/effects.css 的 .bg-fx）。
 *     棋子、格子、滤镜都碰不到它；「模糊背景」那个开关也只糊这一层。
 *
 *   棋盘滤镜 filter —— { id, name, desc }
 *     整块棋盘的 CSS filter（styles/base/effects.css）。只罩 .board 本身，
 *     色卡、信息条、工具栏这些棋盘外的东西一点不受影响。
 *
 * 两个可选的公共字段（任何一类都能写）：
 *
 *   free: true   永远算解锁，不靠抽奖。给「无 / 关掉」这类开关用 —— 它们不是奖品。
 *   prize: false 不进抽奖池（也不上转轮），只当面板里的一个选项。
 *
 * 加一个插件：在 looks/ 里新建一个文件，然后在下面 PLUGINS 里加一行 import。
 * 别处都不用动 —— 面板会自己长出新的展位，存档认不出来的 id 也会退回默认。
 * ========================================================================== */

import classic from './classic.js';
import geometry from './geometry.js';
import life from './life.js';
import mono from './mono.js';
import nature from './nature.js';
import ripple from './ripple.js';
import sky from './sky.js';
import snow from './snow.js';
import sticker from './sticker.js';

/* 七类外观。key 是它存在 settings 里的字段，attr 是落到 <html> 上的钩子，
 * coll 是插件里那张表的字段名（`<名字>s` 的规矩，life 因此是 lifes）。 */
export var KIND = {
  surface: { key: 'surfaceStyle', attr: 'data-surface', label: '色块', coll: 'surfaces' },
  mark: { key: 'markStyle', attr: 'data-mark', label: '叉', coll: 'marks' },
  piece: { key: 'pieceStyle', attr: 'data-piece', label: '皇后', coll: 'pieces' },
  life: { key: 'lifeStyle', attr: 'data-life', label: '生命', coll: 'lifes' },
  click: { key: 'clickStyle', attr: 'data-click', label: '点击特效', coll: 'clicks' },
  bg: { key: 'bgStyle', attr: 'data-bg', label: '背景', coll: 'bgs' },
  filter: { key: 'filterStyle', attr: 'data-filter', label: '棋盘滤镜', coll: 'filters' }
};

/* 顺序就是面板里从上到下的顺序，也是每一类里第一项「默认」的意思。 */
export var KINDS = ['surface', 'mark', 'piece', 'life', 'click', 'bg', 'filter'];

/* ---- 插件清单 ----
 * 顺序就是展柜的顺序，也决定每一类里「白送的那一套」是谁（每类第一项）。
 * 「墨线」排在最前：它给的「纯色」是出厂默认——格子就是一块干净的颜色，
 * 不加任何图案，开局最容易看清。四套图案主题跟在后面，都要抽奖拿。
 * 生命单独一个插件——它不在棋盘上，跟哪套纹样都没关系。
 * 最后三个是「动起来」的三样，各自只有一个插件；点击与背景都把「无」写在
 * 第一位，于是出厂就是安静的，涟漪与飘落成了奖品。 */
var PLUGINS = [classic, geometry, nature, sky, sticker, life, ripple, snow, mono];

/* ==========================================================
   登记：把插件摊平成四张表
   ----------------------------------------------------------
   每一项都带上 plugin / pluginName，面板据此分组、按钮上挂小标签。
   ========================================================== */
export var PLUGIN_LIST = [];
var LISTS = { surface: [], mark: [], piece: [], life: [], click: [], bg: [], filter: [] };
var GROUPS = { surface: [], mark: [], piece: [], life: [], click: [], bg: [], filter: [] };

(function collect() {
  for (var p = 0; p < PLUGINS.length; p++) {
    var plug = PLUGINS[p] || {};
    var info = {
      id: plug.id || 'plugin-' + (p + 1),
      name: plug.name || plug.id || '插件 ' + (p + 1),
      note: plug.note || ''
    };
    PLUGIN_LIST.push(info);

    for (var k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var items = plug[KIND[kind].coll || kind + 's'] || [];
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
export var DEFAULT_LOOK = {
  surface: ((LISTS.surface || [])[0] || {}).id || '',
  mark: ((LISTS.mark || [])[0] || {}).id || '',
  piece: ((LISTS.piece || [])[0] || {}).id || '',
  life: ((LISTS.life || [])[0] || {}).id || '',
  click: ((LISTS.click || [])[0] || {}).id || '',
  bg: ((LISTS.bg || [])[0] || {}).id || '',
  filter: ((LISTS.filter || [])[0] || {}).id || ''
};

/** 皇后那一格画什么。认不出来就画第一套，不至于让格子空着。 */
export function pieceSvg(id) {
  var o = findOf('piece', id) || (LISTS.piece || [])[0];
  return o && o.svg ? o.svg : '';
}
