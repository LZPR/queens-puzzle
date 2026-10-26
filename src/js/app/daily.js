/* ============================================================================
 * daily.js · 每日挑战的出题
 * ----------------------------------------------------------------------------
 * 每日挑战的棋盘必须「只跟日期有关」：同一台设备、不同的手机、刷新多少回，
 * 今天这一挡都是同一盘。所以这里不用 Math.random，而是拿
 * 「日期 + 档位 + 第几次尝试」算一个稳定的 32 位种子，交给
 * engine.generate(n, seed) —— 引擎本来就是给定种子就出同一盘的。
 *
 * 为什么要试几次：固定尺寸的盘不一定落进同名档位（14×14 也可能只有 6.9 分，
 * 那就是中等）。所以顺着同一个日期往后取几个种子，挑第一张真的属于这一档的；
 * 都试不到就用手上**分数最高**的那张，照常开局 —— 每日挑战不允许「今天这档打不了」，
 * 那是 ui/panels/mismatch.js 那种兜底才管的事。
 *
 * 尝试次数是个定数，别改成「抽到够格为止」：那样在慢设备上会抽到天荒地老，
 * 而每次尝试本身就要几十毫秒（16×16 更久）。
 * 极难（≥11.3 分）单张命中率只有 5% 上下，所以那一挡多试几次；即便如此也常有
 * 一天抽不到，此时装的是这批里最硬的那张 —— 差一点，但不会是一张随手的软盘。
 * ========================================================================== */

import { dayKey, ruleOf } from '../core/daily.js';
import { computeVibe } from '../game/vibe.js';

/* 每挡试几张：低三挡 6 张就够（命中率高），困难 / 极难逐级加码。 */
var ATTEMPTS = { easy: 6, mid: 6, advanced: 6, hard: 8, extreme: 10 };

/* FNV-1a：把一句话揉成一个 32 位整数。用它而不是 Math.random：
 * 同一句话在任何设备上都得到同一个数。 */
function hash32(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 某天某档第 n 次尝试的种子（纯函数，测试可以直接对表）。 */
export function seedOf(day, tier, attempt) {
  return hash32('queens-daily/' + day + '/' + tier + '/' + (attempt | 0));
}

/** 出今天这一挡的盘：{ board, vibe }，出不了返回 null。
 *  同一个 (day, tier) 在任何设备上都得到同一副棋盘。 */
export function buildDaily(tier, day) {
  var rule = ruleOf(tier);
  if (!rule || !window.QueensEngine) return null;
  var d = day || dayKey();
  var tries = ATTEMPTS[tier] || 6;
  var last = null;
  var hardest = null;
  for (var i = 0; i < tries; i++) {
    var b = null;
    try { b = window.QueensEngine.generate(rule.size, seedOf(d, tier, i)); } catch (e) { b = null; }
    if (!b) continue;
    var v = computeVibe(b.size, b.regions, b.solution);
    last = { board: b, vibe: v };
    if (v && (!hardest || v.score > hardest.vibe.score)) hardest = last;
    if (v && v.tone === tier) return last;   // 正好落进同名档位，就是它了
  }
  /* 一张都没对上：装这批里分数最高的那张（极难常常走到这里）。
   * 没有可比的分数（度量挂了）就退回最后一张，跟以前的兜底一致。 */
  return hardest || last;
}
