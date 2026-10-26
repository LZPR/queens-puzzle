/* ============================================================================
 * unlock.js · 外观解锁账本
 * ----------------------------------------------------------------------------
 * 外观不再全白送：每一类（色块 / 叉 / 皇后 / 生命）只有**第一套**开局就有，
 * 其余的都锁在展柜里，靠每日挑战首通的抽奖解锁（ui/panels/slot.js）。
 * 「抽到了没有」得自己记一笔——settings 里存的是「现在用哪套」，
 * 不是「家里有哪些」，两件事不能混（清偏好不该清家底）。单独一份账本：

 *   { v: 1, got: { 'surface:nature': { at }, 'piece:cat': { at } } }

 * 每类第一项永远算解锁（不必写进账本）：它既是出厂默认，也是兜底——
 * 账本丢了 / 换了机器，至少还有一套能用的。反过来，settings 里存着一套
 * 没解锁的样式（老存档 / 手改的）也退回第一套，见 unlockedStyle()。
 *
 * 跟 core/daily.js 一样只管数据：不碰 DOM、不碰音效。
 * ========================================================================== */

import { STORE_LOOKS } from './config.js';
import { KINDS, findOf, listOf } from '../looks/index.js';

var cache = null;

function read() {
  if (cache) return cache;
  cache = { v: 1, got: {} };
  try {
    var raw = window.localStorage.getItem(STORE_LOOKS);
    var o = raw ? JSON.parse(raw) : null;
    var got = o && o.got && typeof o.got === 'object' ? o.got : null;
    if (got) {
      for (var key in got) {
        // 只认「kind:id」且确实存在的样式：插件删掉了就当没有，别留下幽灵解锁
        var i = key.indexOf(':');
        if (i <= 0) continue;
        var kind = key.slice(0, i), id = key.slice(i + 1);
        if (KINDS.indexOf(kind) < 0 || !findOf(kind, id)) continue;
        if (got[key]) cache.got[key] = { at: parseInt(got[key].at, 10) || 0 };
      }
    }
  } catch (e) { /* 隐私模式 / 账本坏了：当什么都没抽到，默认那几套照样能玩 */ }
  return cache;
}

function persist(data) {
  try {
    window.localStorage.setItem(STORE_LOOKS, JSON.stringify({ v: 1, got: data.got }));
  } catch (e) { /* 配额满了就丢弃：顶多重抽一次，不是大事 */ }
}

/* ==========================================================
   查询 / 记账
   ========================================================== */
/** 这套样式解锁了没有。每一类的第一套（出厂默认）永远是开的。 */
export function isUnlocked(kind, id) {
  if (KINDS.indexOf(kind) < 0) return false;
  var list = listOf(kind);
  if (list.length && list[0].id === id) return true;
  return !!read().got[kind + ':' + id];
}

/** 解锁一套。真解开了（之前锁着）返回 true，本来就开着返回 false。 */
export function unlock(kind, id) {
  if (KINDS.indexOf(kind) < 0 || !findOf(kind, id)) return false;
  var key = kind + ':' + id;
  var data = read();
  if (data.got[key] || isUnlocked(kind, id)) return false;
  data.got[key] = { at: Date.now() };
  persist(data);
  return true;
}

/** 全部解开（只给 tools/ 里的自动化测试用）。有没有真的开了新的。 */
export function unlockAll() {
  var any = false;
  for (var k = 0; k < KINDS.length; k++) {
    var list = listOf(KINDS[k]);
    for (var i = 0; i < list.length; i++) {
      if (unlock(KINDS[k], list[i].id)) any = true;
    }
  }
  return any;
}

/** 全部解开了没有（锁定的一套都不剩）。抽奖机拿它判断「都抽完了」。 */
export function allUnlocked() {
  for (var k = 0; k < KINDS.length; k++) {
    var list = listOf(KINDS[k]);
    for (var i = 0; i < list.length; i++) {
      if (!isUnlocked(KINDS[k], list[i].id)) return false;
    }
  }
  return true;
}

/** 还锁着几套（顺带给出总数），给面板文案用。 */
export function lockedCount() {
  var locked = 0, total = 0;
  for (var k = 0; k < KINDS.length; k++) {
    var list = listOf(KINDS[k]);
    total += list.length;
    for (var i = 0; i < list.length; i++) {
      if (!isUnlocked(KINDS[k], list[i].id)) locked++;
    }
  }
  return { locked: locked, total: total };
}

/** settings 该用哪套：存的这套真的解锁了就用它，否则退回第一套。
 * 读盘的兜底（storage.loadSettings 用）：老存档里白送时代选过的样式、
 * 或者手改进去的怪值，都不能再把棋盘画成没解锁的样子。 */
export function unlockedStyle(kind, id) {
  var list = listOf(kind) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id && isUnlocked(kind, id)) return id;
  }
  return list.length ? list[0].id : '';
}

/** 解锁账本的快照：{ surface: { geo: true }, ... }（每类第一套也算上）。
 * 只给 tools/ 里的自动化测试用。 */
export function snapshot() {
  var out = {};
  for (var k = 0; k < KINDS.length; k++) {
    var kind = KINDS[k], m = {};
    var list = listOf(kind) || [];
    for (var i = 0; i < list.length; i++) {
      if (isUnlocked(kind, list[i].id)) m[list[i].id] = true;
    }
    out[kind] = m;
  }
  return out;
}

/** 清空账本（只给 tools/ 里的自动化测试用）。 */
export function clear() {
  cache = { v: 1, got: {} };
  persist(cache);
}
