/* ============================================================================
 * 皇后 Queens · 难度度量
 * ----------------------------------------------------------------------------
 * 目标：给一张已生成的棋盘（regions + solution）算出一组可复现的数字，
 *       用来描述「人解这盘有多费劲」，而不是描述「电脑解这盘有多快」。
 *
 * 度量分三层：
 *   A. 结构层（与解题过程无关，只看色块几何）
 *        · 面积分布：平均/最大/最小/变异系数/熵
 *        · 单格色块数量（等于白送的已知子）
 *        · 色块邻接边数、色块「跨度」（跨了几行几列）
 *   B. 逻辑层（人真正用的推理）
 *        · L1 = 唯一候选（naked single：某色块/行/列只剩一格）
 *        · L2 = L1 + 区块排除（line/box 互斥：某行候选全在一个色块里 …）
 *        · 记录纯逻辑能推几步、推到几轮、卡在哪
 *   C. 搜索层（逻辑推不动时必须猜，猜几次、回溯几次）
 *        · guesses：成功路径上的猜测次数（= 人要做几次「试一下」）
 *        · backtracks：走错的死胡同数
 *        · 搜索节点数
 *
 * 对外：analyze(n, regions, solution) -> metrics
 *       score(metrics)                -> { score, tier, label, parts }
 * 同时支持浏览器（window.QueensDifficulty）与 Node（require）。
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QueensDifficulty = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* ------------------------------------------------------------- 上下文字 */
  function makeCtx(n, regions) {
    var N = n * n;
    var regCells = [], rowCells = [], colCells = [];
    for (var g = 0; g < n; g++) regCells.push([]);
    for (var r = 0; r < n; r++) rowCells.push([]);
    for (var c = 0; c < n; c++) colCells.push([]);
    for (var i = 0; i < N; i++) {
      var rr = (i / n) | 0, cc = i % n;
      regCells[regions[i]].push(i);
      rowCells[rr].push(i);
      colCells[cc].push(i);
    }
    return { n: n, N: N, region: regions, regCells: regCells, rowCells: rowCells, colCells: colCells };
  }

  function initState(ctx) {
    var n = ctx.n;
    return {
      alive: new Uint8Array(ctx.N).fill(1),
      cnt: 0,
      rowDone: new Uint8Array(n),
      colDone: new Uint8Array(n),
      regDone: new Uint8Array(n),
      queens: new Int32Array(n).fill(-1)
    };
  }

  function copyState(s) {
    return {
      alive: s.alive.slice(),
      cnt: s.cnt,
      rowDone: s.rowDone.slice(),
      colDone: s.colDone.slice(),
      regDone: s.regDone.slice(),
      queens: s.queens.slice()
    };
  }

  function kill(state, ctx, idx) { state.alive[idx] = 0; }

  function place(state, ctx, idx) {
    var n = ctx.n;
    if (idx === undefined || idx === null || idx < 0 || idx >= ctx.N) return;
    var r = (idx / n) | 0, c = idx % n, g = ctx.region[idx];
    var k;
    state.alive[idx] = 0;
    state.cnt++;
    state.rowDone[r] = 1;
    state.colDone[c] = 1;
    state.regDone[g] = 1;
    state.queens[g] = idx;
    var cells;
    cells = ctx.rowCells[r]; for (k = 0; k < cells.length; k++) state.alive[cells[k]] = 0;
    cells = ctx.colCells[c]; for (k = 0; k < cells.length; k++) state.alive[cells[k]] = 0;
    cells = ctx.regCells[g]; for (k = 0; k < cells.length; k++) state.alive[cells[k]] = 0;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        state.alive[rr * n + cc] = 0;
      }
    }
  }

  /* 收集某单位（色块/行/列）的存活格 */
  function liveOf(state, cells, out) {
    out.length = 0;
    for (var i = 0; i < cells.length; i++) if (state.alive[cells[i]]) out.push(cells[i]);
    return out;
  }

  /* ------------------------------------------------------------- 逻辑传播
   * 这个题型（Star Battle 单星变体）的人类推理只有三类：
   *   S1 唯一候选：某色块 / 行 / 列只剩一个可放格
   *   S2 区块封锁（k=1 的集合计数）：某色块的候选全在同一行（或列）→ 该行其余格全排除
   *   S3 集合计数（k≥2）：k 个色块的可放格一共只落在 k 行里 → 这 k 行只能由这 k 个色块占用，
   *      于是这些行里其它色块的格子全部排除
   * level/maxK 控制允许的推理上限：0 = 只做 S1，1 = S1+S2，k = S1+S3(k)
   * 返回 { ok, solved, steps, rounds }
   */
  function propagate(state, ctx, maxK, stat) {
    var n = ctx.n;

    // 位掩码（n ≤ 30 够用；更大尺寸走对象回退）
    var rowMaskOf = new Int32Array(n).fill(0);
    var colMaskOf = new Int32Array(n).fill(0);
    var aliveCnt = new Int32Array(n).fill(0);

    function refresh() {
      for (var g = 0; g < n; g++) { rowMaskOf[g] = 0; colMaskOf[g] = 0; aliveCnt[g] = 0; }
      for (var i = 0; i < ctx.N; i++) {
        if (!state.alive[i]) continue;
        var g2 = ctx.region[i], r = (i / n) | 0, c = i % n;
        rowMaskOf[g2] |= (1 << r);
        colMaskOf[g2] |= (1 << c);
        aliveCnt[g2]++;
      }
    }

    var changed = true, rounds = 0, steps = 0;
    var tmp = [];

    while (changed) {
      changed = false;
      rounds++;
      refresh();

      // ---- S1 唯一候选
      for (var g = 0; g < n; g++) {
        if (state.regDone[g]) continue;
        var lg = liveOf(state, ctx.regCells[g], tmp);
        if (!lg.length) return { ok: false, solved: false, steps: steps, rounds: rounds };
        if (lg.length === 1) {
          place(state, ctx, lg[0]);
          steps++; changed = true;
          if (stat) stat.singles++;
        }
      }
      for (var r = 0; r < n; r++) {
        if (state.rowDone[r]) continue;
        var lr = liveOf(state, ctx.rowCells[r], tmp);
        if (!lr.length) return { ok: false, solved: false, steps: steps, rounds: rounds };
        if (lr.length === 1) {
          place(state, ctx, lr[0]);
          steps++; changed = true;
          if (stat) stat.singles++;
        }
      }
      for (var c = 0; c < n; c++) {
        if (state.colDone[c]) continue;
        var lc = liveOf(state, ctx.colCells[c], tmp);
        if (!lc.length) return { ok: false, solved: false, steps: steps, rounds: rounds };
        if (lc.length === 1) {
          place(state, ctx, lc[0]);
          steps++; changed = true;
          if (stat) stat.singles++;
        }
      }

      if (state.cnt === n) break;
      if (maxK < 1) continue;
      refresh();

      // ---- S2/S3 集合计数
      var groups = [];
      for (var g3 = 0; g3 < n; g3++) if (!state.regDone[g3] && aliveCnt[g3] > 0) groups.push(g3);
      var K = Math.min(maxK, groups.length);

      // 按行分组：k 个色块的候选行并集只有 k 行 → 这些行被它们占满
      applyCounting(groups, K, rowMaskOf, ctx.rowCells, state.rowDone);
      // 按列分组
      applyCounting(groups, K, colMaskOf, ctx.colCells, state.colDone);

      function applyCounting(regs, kMax, maskOf, lineCells, doneArr) {
        var m = regs.length;
        var idx = [];
        function rec(start, picked, union) {
          if (picked > 0) {
            var bits = popcount(union);
            if (bits === picked) {
              // 这 picked 个色块被这些行/列完全容纳 → 其它色块在这些行/列上的格子全排除
              var set = {};
              for (var t = 0; t < idx.length; t++) set[regs[idx[t]]] = 1;
              var kills = 0;
              for (var b = 0; b < n; b++) {
                if (!(union & (1 << b))) continue;
                if (doneArr[b]) continue;
                var cells = lineCells[b];
                for (var q = 0; q < cells.length; q++) {
                  var cell = cells[q];
                  if (!state.alive[cell]) continue;
                  if (set[ctx.region[cell]]) continue;
                  state.alive[cell] = 0;
                  changed = true;
                  kills++;
                }
              }
              if (kills) {
                if (stat) stat.countElim += kills;
                // 一次推理（不是一格）：k=1 算「区块封锁」，k≥2 算「集合计数」
                if (stat) { if (picked === 1) stat.k1++; else stat.k2++; }
              }
            } else if (bits < picked) {
              return; // 色块数多于可用行/列数，扩展下去只会更离谱
            }
            if (picked === kMax) return;
          }
          for (var i = start; i < m; i++) {
            idx.push(i);
            rec(i + 1, picked + 1, union | maskOf[regs[i]]);
            idx.pop();
          }
        }
        rec(0, 0, 0);
      }
    }

    return { ok: true, solved: state.cnt === n, steps: steps, rounds: rounds };
  }

  function popcount(v) {
    v = v - ((v >> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
    return (((v + (v >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
  }

  /* ------------------------------------------------- 带逻辑传播的搜索（人味） */
  function searchSolve(ctx, level, opt) {
    opt = opt || {};
    var limit = opt.limit || 1;
    var nodeCap = opt.nodeCap || 400000;
    var stat = {
      nodes: 0, branches: 0, tries: 0, fails: 0, solutions: 0,
      successDepth: -1, depthSum: 0, maxDepth: 0
    };
    var solutions = [];

    function dfs(state, depth) {
      if (stat.nodes > nodeCap) return false;
      stat.nodes++;
      var p = propagate(state, ctx, level);
      if (!p.ok) { stat.fails++; return false; }
      if (p.solved) {
        stat.solutions++;
        if (stat.successDepth < 0 || depth < stat.successDepth) stat.successDepth = depth;
        if (stat.maxDepth < depth) stat.maxDepth = depth;
        if (opt.collect) {
          var sol = new Int32Array(ctx.n).fill(-1);
          for (var g = 0; g < ctx.n; g++) sol[(state.queens[g] / ctx.n) | 0] = state.queens[g] % ctx.n;
          solutions.push(Array.from(sol));
        }
        return stat.solutions >= limit;
      }

      // 选候选最少的色块（人也会先盯「选择最少」的地方）
      var bestG = -1, bestList = null;
      for (var g2 = 0; g2 < ctx.n; g2++) {
        if (state.regDone[g2]) continue;
        var live = liveOf(state, ctx.regCells[g2], []);
        if (bestList === null || live.length < bestList.length) { bestG = g2; bestList = live; }
        if (live.length <= 1) break;
      }
      if (bestG < 0 || !bestList || !bestList.length) { stat.fails++; return false; }

      stat.branches++;
      for (var k = 0; k < bestList.length; k++) {
        stat.tries++;
        var st = copyState(state);
        place(st, ctx, bestList[k]);
        if (dfs(st, depth + 1)) return true;
        if (stat.nodes > nodeCap) return false;
      }
      return false;
    }

    dfs(initState(ctx), 0);
    return { stat: stat, solutions: solutions };
  }

  /* -------------------------------------------- 浅层试推（failed-literal）
   * 人类卡住时会想「假设这只皇后放这儿，会不会立刻矛盾」。这里做同样的事：
   * 对每个候选格，假设放子后再跑基础推理，若矛盾就把它划掉。
   * 返回 { ok, solved, probes, steps }
   */
  function solveByProbe(ctx, maxK, opt) {
    opt = opt || {};
    var cap = opt.cap || 20000;
    var state = initState(ctx);
    var probes = 0, steps = 0;
    var tmp = [];

    for (var guard = 0; guard < 400; guard++) {
      var p = propagate(state, ctx, maxK);
      if (!p.ok) return { ok: false, solved: false, probes: probes, steps: steps };
      if (p.solved) return { ok: true, solved: true, probes: probes, steps: steps };

      var eliminated = false;
      var live = [];
      for (var g = 0; g < ctx.n; g++) {
        if (state.regDone[g]) continue;
        liveOf(state, ctx.regCells[g], live);
        if (live.length < 2) continue;

        // 先做「假设后矛盾」的排除
        var kept = [];
        for (var k = 0; k < live.length; k++) {
          if (probes >= cap) { kept.push(live[k]); continue; }
          var st2 = copyState(state);
          place(st2, ctx, live[k]);
          probes++;
          var p2 = propagate(st2, ctx, maxK);
          if (p2.ok) kept.push(live[k]);
          else { state.alive[live[k]] = 0; eliminated = true; }
        }
        if (!eliminated) continue;
        if (kept.length === 1) {
          place(state, ctx, kept[0]);
          steps++;
        }
        break; // 状态变了，重新跑基础推理
      }
      if (!eliminated) break;
    }

    var p3 = propagate(state, ctx, maxK);
    return { ok: p3.ok, solved: p3.ok && p3.solved, probes: probes, steps: steps };
  }

  /* ------------------------------------------------------- 解题过程记账
   * 目的：给玩家看「这局是靠什么推出来的」。
   * 沿一条人类会走的路径记账（不回溯计数），依次是：
   *   1. 纯推理：唯一候选 / 区块封锁 / 集合计数
   *   2. 假设试推：假设一格 → 立刻矛盾 → 划掉（人真的会这么干）
   *   3. 试错落子：前两步都推不动，只能先落一只，错了再退（用真解引导，保证只记一次）
   * 返回各技巧用了几次，以及是否推完。
   */
  function probePass(state, ctx, maxK, stat, cap) {
    var eliminated = false;
    for (var g = 0; g < ctx.n; g++) {
      if (state.regDone[g]) continue;
      var live = liveOf(state, ctx.regCells[g], []);
      if (live.length < 2) continue;
      for (var k = 0; k < live.length; k++) {
        if (stat && cap && stat.probes >= cap) return eliminated;
        var st2 = copyState(state);
        place(st2, ctx, live[k]);
        if (stat) stat.probes++;
        var p2 = propagate(st2, ctx, maxK);
        if (!p2.ok) {
          state.alive[live[k]] = 0;
          eliminated = true;
        }
      }
      if (eliminated) break;
    }
    return eliminated;
  }

  function explain(n, regions, solution, opt) {
    opt = opt || {};
    var cap = opt.probeCap || 1200;
    var ctx = makeCtx(n, regions);
    var state = initState(ctx);
    var stat = { singles: 0, k1: 0, k2: 0, probes: 0, guesses: 0, countElim: 0 };
    var p = propagate(state, ctx, 3, stat);
    var openSingles = stat.singles;   // 开局纯推理能直接定下的子
    var guard = 0;

    // 1) 纯逻辑推 + 2) 假设试推，交替到推不动
    while (p.ok && !p.solved && guard++ < 4 * n && stat.probes < cap) {
      if (!probePass(state, ctx, 3, stat, cap)) break;
      p = propagate(state, ctx, 3, stat);
    }

    // 3) 还推不动 → 试错落子（用真解指路，保证走的是「最终成功」的那条路）
    if (p.ok && !p.solved) {
      var solCell = new Array(n);
      for (var r = 0; r < n; r++) solCell[regions[r * n + solution[r]]] = r * n + solution[r];
      var g2guard = 0;
      while (p.ok && !p.solved && g2guard++ < n) {
        var bestG = -1, bestList = null;
        for (var g = 0; g < n; g++) {
          if (state.regDone[g]) continue;
          var live = liveOf(state, ctx.regCells[g], []);
          if (!bestList || live.length < bestList.length) { bestG = g; bestList = live; }
        }
        if (bestG < 0 || !bestList || !bestList.length) break;
        var target = solCell[bestG];
        if (bestList.indexOf(target) < 0) break;   // 真解被误伤说明模型有问题，直接收手
        stat.guesses++;
        place(state, ctx, target);
        p = propagate(state, ctx, 3, stat);
        var guard2 = 0;
        while (p.ok && !p.solved && guard2++ < 4 * n && stat.probes < cap) {
          if (!probePass(state, ctx, 3, stat, cap)) break;
          p = propagate(state, ctx, 3, stat);
        }
      }
    }

    var areas = new Array(n).fill(0);
    for (var i = 0; i < n * n; i++) areas[regions[i]]++;
    var areaMax = 0;
    for (var a = 0; a < n; a++) if (areas[a] > areaMax) areaMax = areas[a];

    return {
      n: n,
      solved: !!(p.ok && p.solved),
      openSingles: openSingles,
      singles: stat.singles,
      block: stat.k1,
      count: stat.k2,
      probe: stat.probes,
      guess: stat.guesses,
      areaMax: areaMax
    };
  }

  /* ------------------------------------------------------ 人类视角分 v3
   * 旧刻度（下面的旧实现在 git 历史里）本质是「尺寸的另一种写法」：
   * 与尺寸的相关 0.99，与「人到底试推了几次」只有 0.38。实测 13×13 里既有
   * 纯逻辑推完的盘，也有要试推一百多次的盘；16×16 也有开局就能推完的。
   * 尺寸只决定「一次功有多贵」，不决定「要做多少次功」。
   *
   * v2 只看「要做多少功」，三个自变量各管一件事：
   *   n       盘面边长 —— 每落一只、每划一次叉要扫多少格
   *   probes  试推次数 —— 人做了多少次「假设 → 矛盾」
   *   open    开局纯逻辑推进率 = l3Steps / n —— 0 表示第一只就得假设
   *
   * v3 只改两处（见 docs/难度系统v3-无限分绝对阈值-实施计划.md）：
   *   1) 试推深度的指数 0.75 → 0.90：原来的 0.75 次幂在高试推段饱和得太早，
   *      9.0–9.9 挤成一团，真实差距拉不开；
   *   2) 取消 9.9 的硬上限：16×16 的深盘能到 12.4，截断之后它们全都一样。
   * 分数 = 尺寸基线 + 试推深度 + 开局卡壳，下限仍为 1.0，**没有上限**。
   * 跨尺寸不再严格单调（13×13 的中位分可能低于 12×12），这是实测事实：
   * 13×13 的难度分布比 16×16 还宽，强行单调只会把小盘里的硬盘压平。
   */
  var LEVELS = [
    { level: '容易', tone: 'easy' },
    { level: '中等', tone: 'mid' },
    { level: '较难', tone: 'advanced' },
    { level: '困难', tone: 'hard' },
    { level: '极难', tone: 'extreme' }
  ];

  var LN2 = Math.LN2;
  var SCALE_VERSION = 3;

  /* 三个分量：base 尺寸基线、depth 试推深度、stuck 开局卡壳。
   * w 是「大盘上一次试推更费眼」的权重（0.78 → 1.00）。 */
  function scaleFields(n, m) {
    m = m || {};
    var s = Math.log(n / 2.5) / LN2;                 // 4→0.68 … 16→2.68
    var base = 1.0 + 1.5 * s;                        // 尺寸基线 2.0 … 5.0
    var w = 0.70 + 0.30 * (s / 2.678);
    var depth = Math.pow(Math.log(1 + (m.probes || 0)) / LN2, 0.90);   // 饱和得晚一些
    var open = n ? Math.min(1, (m.l3Steps || 0) / n) : 0;
    var probePart = 0.90 * depth * w;
    var stuckPart = 0.70 * (1 - open);
    return {
      s: s,
      base: base,
      w: w,
      depth: depth,
      open: open,
      probe: probePart,
      stuck: stuckPart,
      value: base + probePart + stuckPart
    };
  }

  /* 只保下限与一位小数：上限没有了（16×16 的深盘能到 12 出头）。 */
  function scale(n, m) {
    var f = scaleFields(n, m);
    return Math.round(Math.max(1, f.value) * 10) / 10;
  }

  /* 分级阈值（绝对分，不跟分布走）：
   *   6.0  → 5×5 以下几乎全部在下面；
   *   7.0  → 9×9 起才稳定达到（旧的「困难」从这里开始）；
   *   10.0 → 旧的 9.0 上下，只有 12×12 以上的深盘够得到；
   *   11.3 → 旧的 9.8 上下，只有 16×16 最深的那些盘。
   * 四舍五入正好落在阈值上的盘归下一档（开区间的下界），不会出现空档或重叠。 */
  function levelOf(v) {
    if (v < 6.0) return LEVELS[0];
    if (v < 7.0) return LEVELS[1];
    if (v < 10.0) return LEVELS[2];
    if (v < 11.3) return LEVELS[3];
    return LEVELS[4];
  }

  /* 体感分 + 档位（分数可能超过 10）。旧签名多出来的 tier/extra 一律忽略：
   * 分数已经不看 tier 了，留着参数只是为了不惊动老工具。 */
  function display(n, m) {
    var v = scale(n, m);
    var lv = levelOf(v);
    return { score: v, level: lv.level, tone: lv.tone };
  }

  /* 一步到位：算指标 → 记账 → 出人类视角结论 */
  function vibe(n, regions, solution, opt) {
    var m = analyze(n, regions, solution, opt);
    var rt = score(m);
    var ex = explain(n, regions, solution, opt);
    var dp = display(n, m);
    return {
      score: dp.score,
      level: dp.level,
      tone: dp.tone,
      // 老战绩按旧刻度算的，靠这个版本号区分（见 core/records.js）
      scale: SCALE_VERSION,
      raw: rt.score,
      tier: rt.tier,
      label: rt.label,
      steps: ex,
      metrics: m
    };
  }

  function structure(ctx) {
    var n = ctx.n, N = ctx.N;
    var areas = new Array(n).fill(0);
    var i;
    for (i = 0; i < N; i++) areas[ctx.region[i]]++;

    var sum = 0, mx = 0, mn = N, singles = 0;
    for (i = 0; i < n; i++) {
      sum += areas[i];
      if (areas[i] > mx) mx = areas[i];
      if (areas[i] < mn) mn = areas[i];
      if (areas[i] === 1) singles++;
    }
    var mean = sum / n;
    var sq = 0;
    for (i = 0; i < n; i++) sq += (areas[i] - mean) * (areas[i] - mean);
    var std = Math.sqrt(sq / n);
    var ent = 0;
    for (i = 0; i < n; i++) {
      var p = areas[i] / sum;
      if (p > 0) ent -= p * Math.log(p);
    }
    ent = ent / Math.log(n);

    // 色块邻接边数（不同色块之间的四邻接边）
    var edges = 0;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var idx = r * n + c;
        if (c + 1 < n && ctx.region[idx] !== ctx.region[idx + 1]) edges++;
        if (r + 1 < n && ctx.region[idx] !== ctx.region[idx + n]) edges++;
      }
    }

    // 每个色块跨几行几列（细长色块的候选天然更少）
    var spanSum = 0;
    for (var g = 0; g < n; g++) {
      var rmin = n, rmax = -1, cmin = n, cmax = -1;
      var cs = ctx.regCells[g];
      for (var k = 0; k < cs.length; k++) {
        var rr = (cs[k] / n) | 0, cc = cs[k] % n;
        if (rr < rmin) rmin = rr;
        if (rr > rmax) rmax = rr;
        if (cc < cmin) cmin = cc;
        if (cc > cmax) cmax = cc;
      }
      spanSum += Math.max(rmax - rmin + 1, cmax - cmin + 1) / n;
    }

    return {
      cells: N,
      areaMean: mean,
      areaMax: mx,
      areaMin: mn,
      areaStd: Math.round(std * 100) / 100,
      areaCV: Math.round((std / mean) * 1000) / 1000,
      areaEntropy: Math.round(ent * 1000) / 1000,
      singleRegions: singles,
      adjEdges: edges,
      spanAvg: Math.round((spanSum / n) * 1000) / 1000
    };
  }

  /* ---------------------------------------------------------------- 主入口 */
  function analyze(n, regions, solution, opt) {
    opt = opt || {};
    var ctx = makeCtx(n, regions);
    var st = structure(ctx);

    // 三档推理能力，分别看能推到哪
    var s1 = { singles: 0, countElim: 0 };
    var p1 = propagate(initState(ctx), ctx, 0, s1);
    var s2 = { singles: 0, countElim: 0 };
    var p2 = propagate(initState(ctx), ctx, 1, s2);
    var s3 = { singles: 0, countElim: 0 };
    var p3 = propagate(initState(ctx), ctx, 3, s3);

    // 浅层试推：逻辑推不动时，人会不会靠「假设→矛盾」推完
    var pb = solveByProbe(ctx, 3, { cap: opt.probeCap || 600 });

    // 搜索层：真要猜时，猜几次
    var sr = searchSolve(ctx, 3, { limit: 2, nodeCap: opt.nodeCap || 400000 });
    var sr1 = searchSolve(ctx, 0, { limit: 1, nodeCap: opt.nodeCap || 400000 });

    var metrics = {
      n: n,
      cells: st.cells,
      areaMean: st.areaMean,
      areaMax: st.areaMax,
      areaMin: st.areaMin,
      areaStd: st.areaStd,
      areaCV: st.areaCV,
      areaEntropy: st.areaEntropy,
      singleRegions: st.singleRegions,
      adjEdges: st.adjEdges,
      spanAvg: st.spanAvg,

      l1Steps: p1.steps,
      l1Solved: !!p1.solved && p1.ok,
      l1Rounds: p1.rounds,
      l2Steps: p2.steps,
      l2Solved: !!p2.solved && p2.ok,
      l2Rounds: p2.rounds,
      l2Elim: s2.countElim,
      l3Steps: p3.steps,
      l3Solved: !!p3.solved && p3.ok,
      l3Rounds: p3.rounds,
      l3Elim: s3.countElim,

      probeSolved: !!pb.solved,
      probes: pb.probes,

      guessDepth: sr.stat.successDepth < 0 ? null : sr.stat.successDepth,
      branches: sr.stat.branches,
      tries: sr.stat.tries,
      fails: sr.stat.fails,
      searchNodes: sr.stat.nodes,
      solutions: sr.stat.solutions,
      guessDepthL1: sr1.stat.successDepth < 0 ? null : sr1.stat.successDepth,
      failsL1: sr1.stat.fails
    };

    return metrics;
  }

  /* ------------------------------------------------------------- 评分模型
   * 分数 0–100，按「需要多深的推理」分层：
   *   tier 1：纯唯一候选可解（最简单）
   *   tier 2：需要区块封锁（k=1）
   *   tier 3：需要集合计数（k≥2）
   *   tier 4：需要「假设→矛盾」的浅层试推
   *   tier 5：真的要盲猜并回溯
   */
  function score(m) {
    // 规模基线：n=4 约 0.05，n=16 约 1.0
    var sizeBase = Math.log(m.n / 3.2) / Math.log(16 / 3.2);
    sizeBase = Math.max(0, Math.min(1.15, sizeBase));

    // 结构负荷：色块大小越不均、单格色块越少，可选位置越多
    var cvPart = Math.min(1, m.areaCV / 0.55);
    var maxPart = Math.min(1, (m.areaMax / m.n) / 2.6);   // 最大色块 / 平均面积
    var giftPart = 1 - Math.min(1, m.singleRegions / Math.max(1, m.n * 0.25));

    // 推理负荷：需要多深的技巧
    var logicPart, tier;
    if (m.l1Solved) { logicPart = 0.06; tier = 1; }
    else if (m.l2Solved) { logicPart = 0.22; tier = 2; }
    else if (m.l3Solved) { logicPart = 0.42; tier = 3; }
    else if (m.probeSolved) { logicPart = 0.60; tier = 4; }
    else {
      var g = m.guessDepth == null ? 4 : m.guessDepth;
      logicPart = 0.76 + Math.min(0.24, 0.05 * g);
      tier = 5;
    }

    var raw = 0.34 * sizeBase + 0.2 * (0.5 * cvPart + 0.5 * maxPart) +
      0.1 * giftPart + 0.36 * logicPart;

    var s = Math.round(Math.max(1, Math.min(100, raw * 100)));
    var label = ['', '直觉型', '封锁型', '计数型', '试推型', '试错型'][tier];

    return {
      score: s,
      tier: tier,
      label: label,
      parts: {
        size: Math.round(sizeBase * 100) / 100,
        shape: Math.round((0.5 * cvPart + 0.5 * maxPart) * 100) / 100,
        gifts: Math.round(giftPart * 100) / 100,
        logic: Math.round(logicPart * 100) / 100
      }
    };
  }

  function rate(n, regions, solution) {
    var m = analyze(n, regions, solution);
    var s = score(m);
    return { metrics: m, rating: s };
  }

  return {
    version: '3.0.0',
    analyze: analyze,
    score: score,
    rate: rate,
    explain: explain,
    display: display,
    vibe: vibe,
    scale: scale,
    scaleFields: scaleFields,
    levelOf: levelOf,
    SCALE_VERSION: SCALE_VERSION,
    // 供工具使用的内部件
    makeCtx: makeCtx,
    propagate: propagate,
    initState: initState,
    searchSolve: searchSolve,
    solveByProbe: solveByProbe
  };
});
