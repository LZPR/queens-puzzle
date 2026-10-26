/* ============================================================================
 * records.js
 * 每局战绩：数据结构、本地存储、按「限时 × 难度」分组排名。
 * ----------------------------------------------------------------------------
 * 这一层只管数据，不碰 DOM：想画棋盘、算分享码的都在上层（ui/panels/records.js）。
 *
 * 存法：色块与解都压成十六进制串（n*n 与 n 个字符），比直接存数组小一半左右。
 * 一条 8×8 的记录约 200 字节，上限 300 条也就几十 KB，localStorage 放得下。
 *
 * 记录只增不改：一局结束（解开 / 超时）写一条，删只能整条删。
 * ========================================================================== */

import { DIFF_BANDS, RECORD_MAX, SIZE_MAX, SIZE_MIN, STORE_RECORDS,
  normalizeLimit, normalizeSteps } from './config.js';

/** 难度档，和 DIFF_BANDS 的键、以及本局难度评估的 tone 是同一套（五档）。 */
export var RECORD_TONES = ['easy', 'mid', 'advanced', 'hard', 'extreme'];

/* 现在用的是第几版难度刻度（engine/difficulty.js 的 SCALE_VERSION）。
 * 老记录的 lv / sc 是按旧刻度算的，14×14 当时还算「极难」、分数截在 9.9，
 * 跟新记录没法比，所以它们只在列表里留着看，不进排行榜（见 group / countOf）。
 *   sq=1 / 2 → v1、v2 刻度（旧）；sq=3 → 当前刻度。 */
export var RECORD_SCALE = 3;

var HEX = '0123456789ABCDEF';

/* 第一次读盘之后就把结果留住：面板每次重画都走缓存，不反复 JSON.parse。
 * 写盘走 persist()，内存里的数组才是唯一的真源。 */
var cache = null;

/* ==========================================================
   小工具
   ========================================================== */
function clampNum(v, lo, hi) {
  v = parseInt(v, 10);
  if (!isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function hexEncode(arr, len) {
  var s = '', i;
  for (i = 0; i < len; i++) s += HEX.charAt((arr[i] | 0) & 15);
  return s;
}

function hexDecode(str, len) {
  var out = new Uint8Array(len), i;
  for (i = 0; i < len; i++) out[i] = parseInt(str.charAt(i), 16) || 0;
  return out;
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/** 难度档的中文名（「中等」这种），给面板文案用。 */
export function toneName(tone) {
  return DIFF_BANDS[tone] ? DIFF_BANDS[tone].name : '中等';
}

/** 没有难度评估时（引擎没加载 / 存档很老）按尺寸兜底分档。
 *  尺寸区间在 16×16 上是重叠的（困难 15–16、极难 16），所以**从难到易**找：
 *  先问极难，16×16 才算极难；15×15 落回困难，14×14 及以下才是较难。 */
export function toneOfSize(n) {
  n = clampNum(n, SIZE_MIN, SIZE_MAX);
  for (var i = RECORD_TONES.length - 1; i >= 0; i--) {
    var b = DIFF_BANDS[RECORD_TONES[i]];
    if (n >= b.lo && n <= b.hi) return RECORD_TONES[i];
  }
  return 'mid';
}

/* 一条记录的形状（字段名都很短，因为它要反复进出 localStorage）：
 *   id  本地唯一 id（删除用）
 *   at  结束时刻（Date.now）
 *   n   边长   sd 出题种子
 *   rg  色块（n*n 个十六进制字符）  so 解（每行皇后的列）
 *   lv  难度档（easy/mid/advanced/hard/extreme）  sc 难度体感分  sq 刻度版本
 *   lim 本局限时（0 = 不限）  ms 用时
 *   sl  本局步数限制（0 = 不限）  st 这一局走了几步
 *   h   提示次数  mv 落子次数（放了几只皇后，不是步数）
 *   won 是否解开  lr 输的原因（time / steps / lives，解开时为空）
 *   nh 禁用提示  nu 禁用撤销
 *   dy 每日挑战的日期（'2026-10-26'，不是每日挑战就没有这个字段）
 *   dt 每日挑战的档位（easy/mid/advanced/hard/extreme，跟 dy 一起出现）
 *
 *   st 与 mv 都留着：老记录没有 st（那时还没记真步数），列表里退回用 mv；
 *   mv 现在仍然进战绩，答的是「落了几只皇后」。
 */
function tidy(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var n = parseInt(raw.n, 10);
  if (!(n >= SIZE_MIN && n <= SIZE_MAX)) return null;
  if (typeof raw.rg !== 'string' || raw.rg.length !== n * n) return null;
  if (typeof raw.so !== 'string' || raw.so.length !== n) return null;
  if (!/^[0-9A-F]+$/.test(raw.rg) || !/^[0-9A-F]+$/.test(raw.so)) return null;

  return {
    v: 1,
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    at: clampNum(raw.at, 0, 4102444800000) || Date.now(),
    n: n,
    sd: clampNum(raw.sd, 0, 2147483647),
    rg: raw.rg,
    so: raw.so,
    lv: RECORD_TONES.indexOf(raw.lv) >= 0 ? raw.lv : toneOfSize(n),
    sc: isFinite(raw.sc) && raw.sc > 0 ? Math.round(raw.sc * 10) / 10 : null,
    // 没这个字段的都是 v2 之前的老记录（1 = 旧刻度）
    sq: clampNum(raw.sq, 1, 99) || 1,
    lim: normalizeLimit(raw.lim),
    sl: normalizeSteps(raw.sl),
    ms: clampNum(raw.ms, 0, 24 * 3600 * 1000),
    // null 而不是 0：老记录没记过步数，跟「走了 0 步」得分得开（列表退回 mv）
    st: raw.st == null ? null : clampNum(raw.st, 0, 999999),
    h: clampNum(raw.h, 0, 999),
    mv: clampNum(raw.mv, 0, 99999),
    won: raw.won === true || raw.won === 1,
    lr: raw.lr === 'time' || raw.lr === 'steps' || raw.lr === 'lives' ? raw.lr : '',
    nh: raw.nh === true,
    nu: raw.nu === true,
    /* 每日挑战：日期 + 档位。日期形状不对就当不是每日挑战——战绩列表只靠它
     * 挂「每日」角标，日历另有自己那份账（core/daily.js），坏一个字段不至于连累别的。 */
    dy: dayOk(raw.dy) ? raw.dy : '',
    dt: dayOk(raw.dy) && RECORD_TONES.indexOf(raw.dt) >= 0 ? raw.dt : ''
  };
}

/* 日期键只有一种形状：YYYY-MM-DD（本地日期，不是 UTC）。 */
function dayOk(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/* ==========================================================
   读写
   ========================================================== */
/** 全部记录（新的在前）。第一次调用会读盘，坏数据逐条丢掉，不连累整份。 */
export function all() {
  if (cache) return cache;
  cache = [];
  try {
    var raw = window.localStorage.getItem(STORE_RECORDS);
    var arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length && cache.length < RECORD_MAX; i++) {
        var r = tidy(arr[i]);
        if (r) cache.push(r);
      }
    }
  } catch (e) { /* 隐私模式 / 存档坏了：当没有战绩，游戏照常玩 */ }
  return cache;
}

export function persist() {
  try {
    window.localStorage.setItem(STORE_RECORDS, JSON.stringify(all()));
  } catch (e) { /* 配额满了就丢弃，别让玩到一半的局崩掉 */ }
}

/** 记一局。fields 是当前局面的裸数据，这里负责压缩与校验。
 *  返回 { rec, rank, total }；rank 是这一局在同「限时 × 难度」组里排第几快。 */
export function add(f) {
  if (!f || !f.regions || !f.solution) return null;
  var rec = tidy({
    id: newId(),
    at: Date.now(),
    n: f.n,
    sd: f.seed || 0,
    rg: hexEncode(f.regions, f.n * f.n),
    so: hexEncode(f.solution, f.n),
    lv: f.vib && DIFF_BANDS[f.vib.tone] ? f.vib.tone : toneOfSize(f.n),
    sc: f.vib ? f.vib.score : null,
    sq: (f.vib && f.vib.scale) || RECORD_SCALE,
    lim: f.limit,
    sl: f.stepLimit,
    ms: Math.round(f.ms || 0),
    st: f.steps == null ? null : f.steps,
    h: f.hints,
    mv: f.moves,
    won: !!f.won,
    lr: f.lostBy || '',
    nh: !!f.noHint,
    nu: !!f.noUndo,
    dy: f.daily && f.daily.day,
    dt: f.daily && f.daily.tier
  });
  if (!rec) return null;

  var list = all();
  list.unshift(rec);
  if (list.length > RECORD_MAX) list.splice(RECORD_MAX);
  persist();

  var st = rankOf(rec);
  return { rec: rec, rank: st.rank, total: st.total };
}

export function get(id) {
  var list = all();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function remove(id) {
  var list = all();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      list.splice(i, 1);
      persist();
      return true;
    }
  }
  return false;
}

export function clear() {
  all().length = 0;
  persist();
}

export function total() {
  return all().length;
}

/** 把记录里的十六进制串还原成棋盘。 */
export function board(rec) {
  if (!rec) return null;
  return {
    n: rec.n,
    regions: hexDecode(rec.rg, rec.n * rec.n),
    solution: hexDecode(rec.so, rec.n)
  };
}

/* ==========================================================
   分组与排名
   ----------------------------------------------------------
   排行榜的规矩：**先按限时分组，再按难度分组**，组内只比谁快。
   不同限时、不同难度的时间本来就没法比（3 分钟的中等和 20 分钟的困难
   放在一张表里，第一名永远属于最简单的那个），所以干脆分开。
   输掉的那局不进榜，但照样记在记录里。
   ========================================================== */
export function group(lim, tone, wonOnly) {
  var list = all();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (r.lim !== lim || r.lv !== tone) continue;
    if (r.sq !== RECORD_SCALE) continue;   // 旧刻度的成绩不进新榜（lv/sc 不是一回事）
    if (wonOnly && !r.won) continue;
    out.push(r);
  }
  // 用时短的在前；同样快就看谁先做到（老记录优先，榜位不会因为重复提交而翻来覆去）
  out.sort(function (a, b) { return a.ms - b.ms || a.at - b.at; });
  return out;
}

/** 这一局在自己组里排第几快（1 起）。解开的才算名次。 */
export function rankOf(rec) {
  var g = group(rec.lim, rec.lv, true);
  for (var i = 0; i < g.length; i++) if (g[i].id === rec.id) return { rank: i + 1, total: g.length };
  return { rank: 0, total: g.length };
}

/** 某个「限时 × 难度」组合里有多少个解开的成绩（排行榜筛选项上的角标）。
 *  跟 group() 一个口径：旧刻度的成绩不算，不然角标和榜上的条数对不上。 */
export function countOf(lim, tone) {
  var list = all();
  var c = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i].lim === lim && list[i].lv === tone && list[i].won &&
        list[i].sq === RECORD_SCALE) c++;
  }
  return c;
}

/** 这个「限时 × 难度」组合里有没有旧刻度的成绩（列表里还留着，只是不进榜）。 */
export function legacyOf(lim, tone) {
  var list = all();
  var c = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i].lim === lim && list[i].lv === tone && list[i].sq !== RECORD_SCALE) c++;
  }
  return c;
}

/** 同一个组合里最快的那条（没解开的跳过）。 */
export function bestOf(lim, tone) {
  var g = group(lim, tone, true);
  return g.length ? g[0] : null;
}
