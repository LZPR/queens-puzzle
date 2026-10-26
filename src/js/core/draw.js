/* ============================================================================
 * draw.js · 每日挑战的抽奖记录
 * ----------------------------------------------------------------------------
 * 第一次解开某一挡的每日挑战，结算界面会送一次抽奖（四个挡位各一次）。
 * 「抽没抽过」得自己记下来——完成记录（core/daily.js）只存最快成绩，
 * 重复游玩会覆盖它，说不了「这是不是头一回」；这里单独记一笔：
 *
 *   { v: 1, days: { '2026-10-26': { easy: { at }, hard: { at } } } }
 *
 * 口径是「该挡今天完成过、且还没抽过」就能抽：
 *   · 抽完立刻 markDrawn，重复游玩自然不能再抽；
 *   · 首通之后先去打了别的挡、或者中途刷新，回来结算界面按钮还在——
 *     资格跟着「完成 + 未抽」走，不跟某一次具体的胜利走，刷新丢不了。
 *
 * 跟完成记录一样只管数据：不碰 DOM、不碰音效。面板在 ui/panels/slot.js。
 * ========================================================================== */

import { STORE_DAILY_DRAW } from './config.js';
import { DAILY_TIERS } from './daily.js';

/** 留多少天的抽奖记录：跟 core/daily.js 的 KEEP_DAYS 对齐，再老的按日期丢。 */
var KEEP_DAYS = 400;

function validKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

var cache = null;

function read() {
  if (cache) return cache;
  cache = { days: {} };
  try {
    var raw = window.localStorage.getItem(STORE_DAILY_DRAW);
    var o = raw ? JSON.parse(raw) : null;
    var days = o && o.days && typeof o.days === 'object' ? o.days : null;
    if (days) {
      for (var key in days) {
        if (!validKey(key) || !days[key] || typeof days[key] !== 'object') continue;
        var src = days[key], dst = {};
        for (var i = 0; i < DAILY_TIERS.length; i++) {
          var t = DAILY_TIERS[i];
          if (src[t]) dst[t] = { at: parseInt(src[t].at, 10) || 0 };
        }
        if (DAILY_TIERS.some(function (t) { return !!dst[t]; })) cache.days[key] = dst;
      }
    }
  } catch (e) { /* 隐私模式 / 存档坏了：当没抽过，别挡着玩家玩 */ }
  return cache;
}

function persist(data) {
  try {
    window.localStorage.setItem(STORE_DAILY_DRAW, JSON.stringify({ v: 1, days: data.days }));
  } catch (e) { /* 配额满了就丢弃：顶多重抽一次，不是大事 */ }
}

/* 只留最近 KEEP_DAYS 天：键是 YYYY-MM-DD，按字典序排就是按日期排 */
function prune(data) {
  var keys = Object.keys(data.days);
  if (keys.length <= KEEP_DAYS) return;
  keys.sort();
  for (var i = 0; i < keys.length - KEEP_DAYS; i++) delete data.days[keys[i]];
}

/* ==========================================================
   查询 / 记账
   ========================================================== */
/** 某天的已抽记录：{ easy: {at}, hard: {at} }（没抽过的档不在里面）。 */
export function drawnOf(day) {
  return read().days[day] || {};
}

/** 这一挡今天抽过没有。 */
export function hasDrawn(day, tier) {
  return !!drawnOf(day)[tier];
}

/** 抽完了记一笔。同一天同一挡只记一次，重复记返回 false。 */
export function markDrawn(day, tier) {
  if (!validKey(day) || DAILY_TIERS.indexOf(tier) < 0) return false;
  var data = read();
  var d = data.days[day] || (data.days[day] = {});
  if (d[tier]) return false;
  d[tier] = { at: Date.now() };
  prune(data);
  persist(data);
  return true;
}

/** 清空抽奖记录（只给 tools/ 里的自动化测试用）。 */
export function clear() {
  cache = { days: {} };
  persist(cache);
}
