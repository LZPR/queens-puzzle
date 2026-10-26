/* ============================================================================
 * 难度刻度 v3 · 可达性矩阵
 * ----------------------------------------------------------------------------
 * 每个尺寸抽一批盘，按 v3 刻度打分，统计：
 *   · 单盘分数的 p10 / 中位 / p90 / 最大
 *   · 模拟「每局抽 K 张取最高分」之后的分位数
 *   · 各档位占比（档位阈值与 DIFF_BANDS.min 一致）
 *
 *   node tools/scale-matrix.mjs                 # 默认 4–16，每尺寸 24 盘
 *   node tools/scale-matrix.mjs --per=48        # 池子加倍（结论更稳，慢一倍）
 *   node tools/scale-matrix.mjs --sizes=13-16 --per=12
 *
 * 注意种子的取法：用 splitmix32 打散，**不要**用 k * 0x9E3779B1 当步长——
 * 那是 generate() 内部的重试步长，会造成样本重叠。
 * ========================================================================== */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] === undefined ? '1' : m[2]);
}
const [sLo, sHi] = (args.get('sizes') || '4-16').split('-').map(Number);
const per = Math.max(1, Number(args.get('per')) || 24);
const K = Math.max(1, Number(args.get('k')) || 3);

const engine = require(path.join(here, '..', 'src', 'js', 'engine', 'engine.js'));
const diff = require(path.join(here, '..', 'src', 'js', 'engine', 'difficulty.js'));

/* 阈值与 core/config.js 的 DIFF_BANDS 一致（绝对分，容易从 0 起） */
const BANDS = [
  { tone: 'easy', name: '容易', min: 0 },
  { tone: 'mid', name: '中等', min: 6.0 },
  { tone: 'advanced', name: '较难', min: 7.0 },
  { tone: 'hard', name: '困难', min: 10.0 },
  { tone: 'extreme', name: '极难', min: 11.3 }
];

/* splitmix32：给每个 (n, k) 一个互不相关的种子 */
function splitmix32(a) {
  return function () {
    a |= 0; a = (a + 0x9E3779B9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21F0AAAD);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735A2D97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}

function pct(arr, p) {
  if (!arr.length) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[i];
}
const r1 = v => Math.round(v * 10) / 10;

function pool(n) {
  const out = [];
  for (let k = 0; k < per; k++) {
    const seed = splitmix32((n * 7919 + k * 104729) ^ 0x5F3A)();
    const b = engine.generate(n, seed);
    if (!b) continue;
    const v = diff.vibe(b.size, b.regions, b.solution);
    if (!v) continue;
    out.push({ score: v.score, probes: v.metrics.probes, open: v.steps.openSingles });
  }
  return out;
}

/* 模拟「每局抽 K 张取最高」：从池子里无放回地抽 K 张（池子不够就全用） */
function pickK(poolScores, k) {
  const out = [];
  const rnd = splitmix32(0xC0FFEE);
  for (let t = 0; t < 800; t++) {
    const bag = poolScores.slice();
    let best = -1;
    for (let i = 0; i < k && bag.length; i++) {
      const j = Math.floor((rnd() / 4294967296) * bag.length);
      const v = bag.splice(j, 1)[0];
      if (v > best) best = v;
    }
    if (best >= 0) out.push(best);
  }
  return out;
}

console.log(`刻度 v${diff.SCALE_VERSION} · 每尺寸 ${per} 盘 · 取最高 K=${K}\n`);
const head = '尺寸'.padEnd(7) + '单盘 p10/中位/p90/max'.padEnd(24) +
  'K=' + K + ' p10/中位/p90'.padEnd(20) + '各档占比';
console.log(head);
console.log('-'.repeat(88));

const pools = new Map();
const rows = [];

for (let n = sLo; n <= sHi; n++) {
  const t0 = Date.now();
  const p = pool(n);
  pools.set(n, p);
  if (!p.length) { console.log(n + '×' + n + '  生成失败'); continue; }
  const sc = p.map(x => x.score);
  const picked = pickK(sc, K);

  const cnt = BANDS.map(() => 0);
  for (const v of picked) {
    for (let i = BANDS.length - 1; i >= 0; i--) {
      if (v >= BANDS[i].min) { cnt[i]++; break; }
    }
  }
  const total = picked.length || 1;
  const share = BANDS.map((b, i) => cnt[i] ? b.name + ' ' + Math.round(100 * cnt[i] / total) + '%' : '')
    .filter(Boolean).join(' ');

  console.log(
    (n + '×' + n).padEnd(8) +
    [pct(sc, .1), pct(sc, .5), pct(sc, .9), Math.max(...sc)].map(r1).join(' / ').padEnd(24) +
    [pct(picked, .1), pct(picked, .5), pct(picked, .9)].map(r1).join(' / ').padEnd(20) +
    share
  );
  rows.push({ n, sc, picked });
  process.stderr.write(`  ${n}×${n}: ${Date.now() - t0}ms\n`);
}

/* 顺带报一下「试推次数」与「开局推进」的中位，便于手算核对分数 */
console.log('\n（每尺寸的试推中位 / 开局零推进占比）');
for (const n of pools.keys()) {
  const p = pools.get(n);
  if (!p.length) continue;
  const pr = p.map(x => x.probes);
  const zero = p.filter(x => !x.open).length / p.length;
  console.log(`  ${n}×${n}  试推中位 ${pct(pr, .5)}  ·  开局零推进 ${Math.round(zero * 100)}%`);
}

/* 同尺寸内的离散程度：新旧刻度最大的差别就在这里 */
console.log('\n（同尺寸内 σ / 极差）');
for (const r of rows) {
  const m = r.sc.reduce((a, b) => a + b, 0) / r.sc.length;
  const sd = Math.sqrt(r.sc.reduce((a, b) => a + (b - m) * (b - m), 0) / r.sc.length);
  console.log(`  ${r.n}×${r.n}  σ ${sd.toFixed(2)}  极差 ${(Math.max(...r.sc) - Math.min(...r.sc)).toFixed(1)}`);
}
