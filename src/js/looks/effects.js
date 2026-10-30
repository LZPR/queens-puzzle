/* 外观动作的通用接线。这里只负责选择、资源、取消与时序，不实现任何具体动画。
 * 插件的 play(ctx) 返回 Promise<boolean>；ctx 只提供画面和只读局面快照。
 * signal 负责换盘 / 换样式时的收尾，插件不能改 state、战绩或挑战规则。 */
import { REDUCE_MOTION } from '../core/config.js';
import { boardEl, fxEl, gridEl } from '../core/dom.js';
import { settings, state, view } from '../core/state.js';
import { KIND, PLUGIN_LIST, findOf } from './index.js';

const active = new Map();
const sheets = new Map();
const artifacts = new Set();
let generation = 0;
let previous = null;
let signature = null;
let winJob = null;
let mounted = false;

function option(kind) { return findOf(kind, settings[KIND[kind].key]); }
function context(signal, extra = {}) {
  return Object.assign({
    n: state.size, regions: Array.from(state.regions || []), cells: view.cells.slice(),
    board: boardEl, grid: gridEl, fx: fxEl, reducedMotion: !!REDUCE_MOTION, signal,
    won: state.status === 'won',
    boardKey: JSON.stringify([state.size, state.seed, Array.from(state.regions || [])]),
    retain: cleanup => artifacts.add(cleanup)
  }, extra);
}

function styles(pluginId) {
  return Promise.all(PLUGIN_LIST.filter(p => p.stylesheet && (!pluginId || p.id === pluginId)).map(p => {
    if (!sheets.has(p.id)) sheets.set(p.id, new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = p.stylesheet;
      link.dataset.lookPlugin = p.id;
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      document.head.appendChild(link);
    }));
    return sheets.get(p.id);
  })).then(results => results.every(Boolean));
}

function cancelTasks(keepReward = false) {
  for (const task of active.values()) task.controller.abort({ keepReward });
  active.clear();
  if (!keepReward) {
    for (const cleanup of artifacts) cleanup();
    artifacts.clear();
  }
}

export function cancelBoardLooks(keepReward = false) {
  generation++;
  winJob = null;
  cancelTasks(keepReward);
}

export function isLookBusy() {
  return !!active.get('deal')?.busy;
}

export function playLookEffect(kind, extra) {
  const selected = option(kind);
  active.get(kind)?.controller.abort();
  active.delete(kind);
  if (!selected?.play) return { handled: false, finished: Promise.resolve(true) };
  const task = { controller: new AbortController(), busy: kind === 'deal' && !REDUCE_MOTION };
  active.set(kind, task);
  const ctx = context(task.controller.signal, extra);
  const finished = styles(selected.plugin).then(loaded => {
    if (!loaded) return true; // 样式加载失败时照常结算，原版棋盘仍可用。
    if (ctx.signal.aborted) return false;
    return selected.play(ctx);
  }).then(ok => !ctx.signal.aborted && ok !== false, () => !ctx.signal.aborted)
    .finally(() => { task.busy = false; });
  return { handled: true, finished };
}

/** 装新盘前让当前插件留下旧画面；游戏本身仍由 applyBoard 正常装盘。 */
export function prepareBoardLook() {
  previous = option('deal')?.capture?.(context(null)) || null;
  cancelBoardLooks();
}

export function playBoardLook(restored = false) {
  for (const p of PLUGIN_LIST) p.onBoard?.(context(null, { restored }));
  if (restored && state.status === 'won') return playLookEffect('reveal', { animate: false });
  const before = previous;
  previous = null;
  return playLookEffect('deal', { previous: before, restored });
}

/** 胜利判定与记账仍在 win.js；插件结束之后，才继续礼炮与原版成绩卡。 */
export function afterWinLook(callback) {
  for (const p of PLUGIN_LIST) p.onWin?.(context(null));
  const job = { callback, marks: state.marks, generation, started: false };
  winJob = job;
  const current = () => generation === job.generation && state.marks === job.marks &&
    state.status === 'won' && !view.rolling;
  playLookEffect('reveal').finished.then(completed => {
    if (!completed || winJob !== job || !current()) return;
    job.started = true;
    callback(current);
  });
}

/** 外观面板即时生效；所选动作与素材都由登记项提供。 */
export function applyEffectLooks() {
  styles();
  if (!mounted) {
    mounted = true;
    for (const p of PLUGIN_LIST) p.mount?.(context(null));
  }
  option('reveal')?.preload?.();
  const kinds = ['deal', 'reveal', 'confetti'];
  const next = Object.fromEntries(kinds.map(kind => [kind, settings[KIND[kind].key]]));
  if (signature) {
    const changed = kinds.filter(kind => signature[kind] !== next[kind]);
    for (const kind of changed) {
      active.get(kind)?.controller.abort();
      active.delete(kind);
    }
    // 礼炮和开局选项不重建通关画面，也不重启等待中的胜利流程。
    if (changed.includes('reveal')) {
      for (const cleanup of artifacts) cleanup();
      artifacts.clear();
      const pending = winJob;
      if (state.status === 'won') {
        if (pending && !pending.started) afterWinLook(pending.callback);
        else playLookEffect('reveal', { animate: false });
      }
    }
  }
  signature = next;
}
