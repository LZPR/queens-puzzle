/* ============================================================================
 * panels/index.js · 浮层注册表
 * ----------------------------------------------------------------------------
 * 整个应用里「有哪些浮层」只有这一处清单。加一个面板就两步：
 *
 *   1. 在 ui/panels/ 下新建一个文件，导出 mount(host)（markup + 引用 + 事件 +
 *      开关都在里面，照抄 look.js 最短的那一个）；
 *   2. 在下面 PANELS 里加一行 import + 加进数组。
 *
 * core/dom.js、events.js、app/actions.js、core/state.js 都不用动：
 * 引用是面板自己取的，事件是面板自己绑的，浮层开关只有 view.sheet 一个字段
 * （由 core/sheet.js 维护，canPlay() 只看它）。
 *
 * 数组顺序 = markup 在 #sheets 里的先后，也就是层级顺序（同时只会开一个，
 * 所以实际上只影响 DOM 顺序本身，不影响观感）。
 * ========================================================================== */

import * as settings from './settings.js';
import * as info from './info.js';
import * as newgame from './newgame.js';
import * as records from './records.js';
import * as look from './look.js';
import * as result from './result.js';
import * as mismatch from './mismatch.js';
import * as slot from './slot.js';

export var PANELS = [settings, info, newgame, records, look, result, mismatch, slot];

/** 把每个面板的 markup 挂进 #sheets，并把各自的元素引用与事件接好。
 *  必须在 boot() 之前跑：外观面板要按面板里的展位建按钮。 */
export function mountAll(host) {
  for (var i = 0; i < PANELS.length; i++) PANELS[i].mount(host);
}

export { settings, info, newgame, records, look, result, mismatch, slot };
