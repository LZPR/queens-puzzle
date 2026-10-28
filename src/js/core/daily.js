/* ============================================================================
 * daily.js · 每日挑战的数据层
 * ----------------------------------------------------------------------------
 * 「今天」= 本机时区的一个日期（YYYY-MM-DD）。同一台设备上，同一挡的棋盘
 * 无论打几次、什么时候打、刷新多少回，都是同一盘——棋盘由 app/daily.js
 * 按「日期 + 档位 + 第几次尝试」算种子生成，不用 Math.random。
 * 到了第二天日期变了，种子自然换一批，也就是「到第二天重置」。
 *
 * 这一层只管数据：日期键、五挡的规矩、完成记录（localStorage）。不碰 DOM、
 * 不碰引擎。棋盘怎么出在 app/daily.js，面板怎么画在 ui/panels/ 里。
 *
 * 五挡的规矩（玩家改不了，见 requirement）：
 *   棋盘 = 这一挡能开的最大盘（借 DIFF_BANDS 的 hi，别另写一份尺寸）
 *   限时 = 3 / 5 / 10 / 15 / 20 分钟
 *   限步 = 60 / 100 / 150 / 250 / 400 步（跟限时同一条链，一挡比一挡宽）
 *   禁用提示 · 可以撤销 · 记录点可用 · 标错不惩罚
 *   完成任意一挡就算完成今日挑战（五挡是同一天里可选的五个尺寸，不是五道关卡）；
 *   解锁链照旧，完成前一挡才开下一挡。
 *
 * 解锁：只有完成了前一挡，才解锁下一挡（容易永远开着）。
 * ========================================================================== */

import { DIFF_BANDS, STORE_DAILY } from './config.js';

/** 五挡，顺序就是解锁顺序。跟 DIFF_BANDS 的键是同一套（难度 v3 起多了「较难」）。 */
export var DAILY_TIERS = ['easy', 'mid', 'advanced', 'hard', 'extreme'];

/* 每挡给多少步：跟限时同一套节奏（3/5/10/15/20 分钟 → 60/100/150/250/400 步），
 * 数值取自 config.js 的 STEP_OPTIONS（挑挡位时那排按钮就是这几个数）——
 * 改这里先看那边有没有同一挡，别两边各说一套。 */
var TIER_STEPS = { easy: 60, mid: 100, advanced: 150, hard: 250, extreme: 400 };

/* 每挡多久：容易到极难 3 → 20 分钟，一挡比一挡宽。 */
var TIER_MS = { easy: 180000, mid: 300000, advanced: 600000, hard: 900000, extreme: 1200000 };

/** 留多少天的记录：一年多一点。再老的按日期丢掉，不至于把 localStorage 撑爆。 */
var KEEP_DAYS = 400;

/* ==========================================================
   日期
   ========================================================== */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** 本地日期键 'YYYY-MM-DD'。刻意不用 toISOString：那是 UTC，东八区早上 8 点前会串到昨天。 */
export function dayKey(d) {
  var t = d instanceof Date ? d : new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

/** '2026-10-26' → '10月26日'。日历与读数都读这一句。 */
export function dayLabel(key) {
  if (typeof key !== 'string') return '';
  var p = key.split('-');
  if (p.length !== 3) return key;
  return (parseInt(p[1], 10) || 1) + '月' + (parseInt(p[2], 10) || 1) + '日';
}

function validKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/* ==========================================================
   规矩
   ========================================================== */
/** 某一挡的规矩：棋盘固定这一档能开的最大盘，限时与限步都按档位。 */
export function ruleOf(tier) {
  var b = DIFF_BANDS[tier];
  if (!b) return null;
  return {
    tier: tier, size: b.hi,
    limit: TIER_MS[tier] || 0,
    steps: TIER_STEPS[tier] || 0
  };
}

/** 交给 app/puzzle.js 的 applyBoard 的那一包「本局规矩」。
 *  day 一起带上：战绩与日历都认这个键（见 core/records.js 的 dy / dt）。 */
export function rulesFor(day, tier) {
  var r = ruleOf(tier);
  if (!r) return null;
  return {
    timeLimit: r.limit,
    stepLimit: r.steps,
    lifeLimit: 0,        // 标错不惩罚：放错的皇后亮冲突线，自己擦掉就行
    noHint: true,
    noUndo: false,
    noSnap: false,       // 记录点可用（只有「禁用提示」这一把锁了）
    daily: { day: day, tier: tier }
  };
}

/** 存档 / 分享码里带回来的 daily 字段：形状不对就当没有（老存档本来也没有）。 */
export function parseDaily(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validKey(raw.day)) return null;
  if (DAILY_TIERS.indexOf(raw.tier) < 0) return null;
  return { day: raw.day, tier: raw.tier };
}

/* ==========================================================
   存盘
   ----------------------------------------------------------
   { v: 1, days: { '2026-10-26': { easy: { ms, st, at }, hard: {…} } } }
   ms = 最快的那次用时，st = 那一次的步数，at = 写下它的时刻。
   ========================================================== */
var cache = null;

function read() {
  if (cache) return cache;
  cache = { days: {} };
  try {
    var raw = window.localStorage.getItem(STORE_DAILY);
    var o = raw ? JSON.parse(raw) : null;
    var days = o && o.days && typeof o.days === 'object' ? o.days : null;
    if (days) {
      for (var key in days) {
        if (!validKey(key) || !days[key] || typeof days[key] !== 'object') continue;
        var src = days[key], dst = {};
        for (var i = 0; i < DAILY_TIERS.length; i++) {
          var t = DAILY_TIERS[i], e = src[t];
          if (!e || typeof e !== 'object') continue;
          var ms = parseInt(e.ms, 10);
          if (!isFinite(ms) || ms < 0) continue;
          dst[t] = {
            ms: ms,
            st: Math.max(0, parseInt(e.st, 10) || 0),
            at: parseInt(e.at, 10) || 0
          };
        }
        if (DAILY_TIERS.some(function (t) { return !!dst[t]; })) cache.days[key] = dst;
      }
    }
  } catch (e) { /* 隐私模式 / 存档坏了：当没有记录，游戏照常玩 */ }
  return cache;
}

function persist(data) {
  try {
    window.localStorage.setItem(STORE_DAILY, JSON.stringify({ v: 1, days: data.days }));
  } catch (e) { /* 配额满了就丢弃，别让玩到一半的局崩掉 */ }
}

/* 只留最近 KEEP_DAYS 天：键是 YYYY-MM-DD，按字典序排就是按日期排 */
function prune(data) {
  var keys = Object.keys(data.days);
  if (keys.length <= KEEP_DAYS) return;
  keys.sort();
  for (var i = 0; i < keys.length - KEEP_DAYS; i++) delete data.days[keys[i]];
}

/* ==========================================================
   查询
   ========================================================== */
/** 某一天的完成情况：{ easy: {ms,st,at}, hard: {…} }（没有就是空对象）。 */
export function doneOf(day) {
  return read().days[day] || {};
}

export function isDone(day, tier) {
  return !!doneOf(day)[tier];
}

/** 这一挡今天能不能选：容易永远开着，其余要先完成前一挡。 */
export function unlocked(day, tier) {
  var i = DAILY_TIERS.indexOf(tier);
  if (i < 0) return false;
  if (i === 0) return true;
  return isDone(day, DAILY_TIERS[i - 1]);
}

/** 完成任意一挡就算完成今日挑战（打哪挡都算：「今天来过」就算数）。
 *  五挡只是同一天里可选的五个尺寸，不是五道关卡；解锁链仍然按顺序开。 */
export function complete(day) {
  var d = doneOf(day);
  for (var i = 0; i < DAILY_TIERS.length; i++) if (d[DAILY_TIERS[i]]) return true;
  return false;
}

/** 今天完成了几挡（0–5），面板与战绩都读这个数。 */
export function countDone(day) {
  var d = doneOf(day), n = 0;
  for (var i = 0; i < DAILY_TIERS.length; i++) if (d[DAILY_TIERS[i]]) n++;
  return n;
}

/** 默认停在「第一个还没完成」的挡：它一定是解锁的，也正好是下一步该打的。 */
export function pickTier(day) {
  for (var i = 0; i < DAILY_TIERS.length; i++) {
    if (!isDone(day, DAILY_TIERS[i])) return DAILY_TIERS[i];
  }
  return 'extreme';
}

/* ==========================================================
   记账
   ========================================================== */
/** 解开一局每日挑战：同一挡只留最快的那次（打第二遍是刷时间，不是刷新记录）。 */
export function mark(day, tier, ms, steps) {
  if (!validKey(day) || DAILY_TIERS.indexOf(tier) < 0) return false;
  var data = read();
  var d = data.days[day] || (data.days[day] = {});
  ms = Math.max(0, Math.round(ms || 0));
  if (d[tier] && d[tier].ms <= ms) return false;
  d[tier] = { ms: ms, st: Math.max(0, parseInt(steps, 10) || 0), at: Date.now() };
  prune(data);
  persist(data);
  return true;
}

/** 全部日期（日历自己按月份挑）。 */
export function days() {
  return read().days;
}

/** 清空每日挑战的记录（只给 tools/ 里的自动化测试用）。 */
export function clear() {
  cache = { days: {} };
  persist(cache);
}
