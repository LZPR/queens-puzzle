/* ============================================================================
 * 难度刻度 v3 · 验收
 * ----------------------------------------------------------------------------
 * 断六条：
 *   1. 单调   —— 固定尺寸，试推越多分越高；固定试推，开局推进越少分越高
 *   2. 区分度 —— 同尺寸内分数散得开（旧刻度压成 0.05–0.16 的 σ）
 *   3. 跨尺寸 —— 大盘整体还是比小盘难（16×16 的 p10 > 4×4 的 p90）
 *   4. 可达性 —— 16×16 真能抽到极难（K=3 取最高的命中率）
 *   5. 量程   —— 分数没有上限（16×16 能过 10）；小盘不该出高档
 *   6. 阈值   —— config.js 的 DIFF_BANDS.min/max 与 difficulty.js 的 levelOf 对齐
 *
 *   node tools/check-scale.mjs
 *   node tools/check-scale.mjs --per=20     # 加样本（慢）
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] === undefined ? '1' : m[2]);
}
const per = Math.max(6, Number(args.get('per')) || 14);

const engine = require(path.join(root, 'src', 'js', 'engine', 'engine.js'));
const diff = require(path.join(root, 'src', 'js', 'engine', 'difficulty.js'));

/* config.js 是 ES 模块（还摸 window），不能在 node 里 import。
 * 只把 DIFF_BANDS 那段对象字面量抠出来 eval —— 一个真源，不复制常量。 */
const cfgSrc = fs.readFileSync(path.join(root, 'src', 'js', 'core', 'config.js'), 'utf8');
const bandSrc = cfgSrc.match(/export var DIFF_BANDS = (\{[\s\S]*?\n\});/);
if (!bandSrc) {
  console.error('读不出 config.js 的 DIFF_BANDS');
  process.exit(1);
}
const BANDS = new Function('return ' + bandSrc[1])();

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  PASS  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
  else { fail++; console.log('  FAIL  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const r1 = v => Math.round(v * 10) / 10;
function pct(arr, p) {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
}
function sd(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
}
function splitmix32(a) {
  return function () {
    a |= 0; a = (a + 0x9E3779B9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21F0AAAD);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735A2D97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}

/* ---------- 1. 单调 ---------- */
console.log('\n[1] 单调性');
{
  const n = 12;
  let last = -1, up = true;
  const seq = [];
  for (const probes of [0, 1, 3, 8, 20, 60, 150, 300, 600]) {
    const v = diff.scale(n, { probes: probes, l3Steps: 0 });
    seq.push(v);
    if (v < last) up = false;
    last = v;
  }
  ok('同尺寸下试推越多分越高', up, seq);

  let down = true;
  const seq2 = [];
  for (const openSteps of [12, 9, 6, 3, 1, 0]) {
    const v = diff.scale(n, { probes: 30, l3Steps: openSteps });
    seq2.push(v);
    if (seq2.length > 1 && v < seq2[seq2.length - 2]) down = false;
  }
  ok('同试推下开局越卡分越高', down, seq2);

  ok('同一输入结果稳定', diff.scale(13, { probes: 45, l3Steps: 2 }) ===
    diff.scale(13, { probes: 45, l3Steps: 2 }));
}

/* ---------- 抽样 ---------- */
console.log('\n[2] 同尺寸区分度（每尺寸 ' + per + ' 盘）');
const SIZES = [4, 6, 8, 10, 12, 13, 14, 15, 16];
const pools = new Map();
for (const n of SIZES) {
  const rnd = splitmix32((n * 7919) ^ 0x5F3A);
  const arr = [];
  for (let k = 0; k < per; k++) {
    const b = engine.generate(n, rnd());
    if (!b) continue;
    const v = diff.vibe(b.size, b.regions, b.solution);
    if (v) arr.push(v);
  }
  pools.set(n, arr);
}

{
  const rows = [];
  let wide = 0, widest = 0;
  for (const n of SIZES) {
    const sc = pools.get(n).map(v => v.score);
    const s = sd(sc), gap = Math.max(...sc) - Math.min(...sc);
    if (s >= 0.4) wide++;
    if (s > widest) widest = s;
    rows.push(`${n}×${n} σ${s.toFixed(2)} 极差${gap.toFixed(1)}`);
  }
  console.log('        ' + rows.join('  ·  '));
  ok('多数尺寸散得开（σ ≥ 0.4 的尺寸 ≥ 6 个）', wide >= 6, wide + '/' + SIZES.length);
  ok('至少一个尺寸 σ ≥ 0.9（旧刻度全部 < 0.2）', widest >= 0.9, widest.toFixed(2));
}

/* ---------- 3. 跨尺寸不塌 ---------- */
console.log('\n[3] 跨尺寸');
{
  const s4 = pools.get(4).map(v => v.score);
  const s16 = pools.get(16).map(v => v.score);
  ok('16×16 的 p10 高于 4×4 的 p90', r1(pct(s16, .1)) > r1(pct(s4, .9)),
    { p10_16: r1(pct(s16, .1)), p90_4: r1(pct(s4, .9)) });
}

/* ---------- 4. 可达性 ---------- */
console.log('\n[4] 极难可达性（16×16，模拟 K=3 取最高）');
{
  const ext = BANDS.extreme.min;
  const sc = pools.get(16).map(v => v.score);
  const rnd = splitmix32(0xC0FFEE + 16);
  let h = 0;
  for (let t = 0; t < 800; t++) {
    const bag = sc.slice();
    let best = -1;
    for (let i = 0; i < 3 && bag.length; i++) {
      const j = Math.floor((rnd() / 4294967296) * bag.length);
      const v = bag.splice(j, 1)[0];
      if (v > best) best = v;
    }
    if (best >= ext) h++;
  }
  const rate = h / 800;
  console.log(`        16×16 极难命中 ${Math.round(100 * rate)}%（池内最高 ${r1(Math.max(...sc))}）`);
  ok('16×16 抽得出 ≥' + ext + ' 分的盘', Math.max(...sc) >= ext, r1(Math.max(...sc)));
  /* 单张 5% 上下，K=3 取最高之后约三成 —— 门槛压到 15%，只证明「够得着」 */
  ok('16×16 的极难命中率（K=3 取最高）≥ 15%', rate >= 0.15, Math.round(100 * rate) + '%');

  const hard16 = sc.filter(v => v >= BANDS.hard.min && v < BANDS.hard.max);
  ok('16×16 同时出得了困难与极难（区间重叠是有意的）',
    hard16.length > 0 && sc.some(v => v >= BANDS.extreme.min), hard16.length + '/' + sc.length);
}

/* ---------- 5. 量程 ---------- */
console.log('\n[5] 量程');
{
  const all = [];
  pools.forEach(arr => arr.forEach(v => all.push(v.score)));
  /* v3 取消了 9.9 的硬上限，但也不该溢出到荒唐的数（16×16 实测最高约 12.4） */
  ok('下限 1 分起、没有 9.9 上限、也没有溢出', all.every(v => v >= 1 && v < 14),
    { min: Math.min(...all), max: Math.max(...all) });
  ok('下限没有塌到 2 分以下', Math.min(...all) >= 2, Math.min(...all));
  ok('16×16 的分数超过了 10（旧刻度在这一段全被截成 9.9）',
    Math.max(...pools.get(16).map(v => v.score)) > 10,
    r1(Math.max(...pools.get(16).map(v => v.score))));
  const small = pools.get(4).concat(pools.get(6)).map(v => v.score);
  ok('4×4 / 6×6 不出较难以上', small.every(v => v < BANDS.advanced.min), r1(Math.max(...small)));
}

/* ---------- 6. 阈值与档位 ---------- */
console.log('\n[6] 阈值与 DIFF_BANDS');
{
  const check = [
    ['easy', '容易'], ['mid', '中等'], ['advanced', '较难'], ['hard', '困难'], ['extreme', '极难']
  ];
  let aligned = true;
  for (const [tone, name] of check) {
    const b = BANDS[tone];
    if (!b || b.name !== name) { aligned = false; continue; }
    if (diff.levelOf(b.min).tone !== tone) aligned = false;
    if (b.min > 0 && diff.levelOf(b.min - 0.1).tone === tone) aligned = false;
  }
  ok('每档的分数下限正好是 levelOf 的分界线', aligned,
    Object.keys(BANDS).map(k => k + ':' + BANDS[k].min).join(' '));

  /* 上界同样要对齐：max 是开区间（正好 10.0 算困难），所以它必须就是下一档的 min，
   * 这样出题时才不会出现「选了困难、盘写着极难」。最后一档不封顶（写 99）。 */
  const chain = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  let caps = true;
  for (let i = 0; i < chain.length; i++) {
    const b = BANDS[chain[i]];
    const next = BANDS[chain[i + 1]];
    if (next) {
      if (!(b.max > b.min)) caps = false;
      if (b.max !== next.min) caps = false;
      if (diff.levelOf(b.max).level !== next.name) caps = false;
    } else if (!(b.max >= 11.3)) {
      caps = false;   // 最后一档的 max 只是个「不封顶」的写法，不能小于自己的下限
    }
  }
  ok('每档的分数上限正好是下一档的下限（开区间，不叠不漏）', caps,
    chain.map(t => t + ': ' + BANDS[t].min + '–' + BANDS[t].max).join('  '));

  ok('极难只开 16×16', BANDS.extreme.lo === 16 && BANDS.extreme.hi === 16,
    BANDS.extreme.lo + '–' + BANDS.extreme.hi);
  ok('困难开 15×16（和极难在 16 上重叠）', BANDS.hard.lo === 15 && BANDS.hard.hi === 16,
    BANDS.hard.lo + '–' + BANDS.hard.hi);

  const tones = ['easy', 'mid', 'advanced', 'hard', 'extreme'];
  let nested = true;
  for (let i = 1; i < tones.length; i++) {
    if (!(BANDS[tones[i]].lo >= BANDS[tones[i - 1]].hi)) nested = false;
    if (!(BANDS[tones[i]].min > BANDS[tones[i - 1]].min)) nested = false;
  }
  ok('尺寸区间由易到难依次抬高（边缘可以重叠）', nested,
    tones.map(t => BANDS[t].lo + '-' + BANDS[t].hi).join(' | '));

  ok('尺寸区间都在 4–16 之内', tones.every(t => BANDS[t].lo >= 4 && BANDS[t].hi <= 16),
    tones.map(t => BANDS[t].lo + '–' + BANDS[t].hi).join(' '));
}

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
process.exit(fail ? 1 : 0);
