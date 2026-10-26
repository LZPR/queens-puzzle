/* ============================================================================
 * 皇后 Queens · 全局状态
 * ----------------------------------------------------------------------------
 * 拆模块后，原先那个大闭包里的可变状态集中放在这里。
 *
 * 约定：
 *   · state / settings / pending / guide / view 里的**字段**谁都可以改；
 *   · 但这几个对象本身**不许重新赋值**（ESM 的 import 绑定不可写）；
 *   · 万一以后真需要整个换掉，用 Object.assign(state, next) 而不是 state = next。
 * ========================================================================== */

import { DEFAULT_SETTINGS } from './config.js';

/** 当前这一局的局面。 */
export const state = {
  size: 8,
  seed: 0,
  regions: null,
  solution: null,
  marks: null,
  hints: 0,
  moves: 0,
  /* 步数：这一局一共落了几次笔（每次改动棋盘算一次，见 app/history.js 的 pushHistory）。
   * 它**不是**撤销栈的深度：撤销 / 重做不改它，刷新页面照样保留（存档里带着）；
   * 撤销栈封顶 UNDO_MAX（更早的退不回去），这个数不封顶。
   * 挑战的「步数限制」看 stepLimit，用完还没解开就判负。 */
  steps: 0,
  stepLimit: 0,
  /* 挑战「标错惩罚」：这一局一共给几条命（0 = 不惩罚）与还剩几条。
   * 放错一次扣一条（见 app/actions.js 的 rejectQueen），扣到 0 判负。
   * 两条都跟着存档走，重试这一局时一起回到满格（puzzle.js 的 applyBoard）。 */
  lives: 0,
  lifeLimit: 0,
  elapsed: 0,
  runningSince: 0,
  status: 'playing',
  /* 输掉的原因：'time'（超时）/ 'steps'（步数用尽）/ 'lives'（命用完了），
   * 没输时为 null。结果层与战绩都靠它挑文案——同样是 lost，说的话不一样。 */
  lostBy: null,
  auto: null,
  conflicts: null,
  regionCounts: null,
  focus: 0,
  lastTap: null,
  /* 记录点：手动试推走到一半时「记下这一刻」存的一整盘 marks（null = 还没记）。
   * 只留一份；还原一次就用掉（回到「记录」那一态），长按按钮可以提前清掉。
   * 跟撤销快照同一份口径（marks + hints + moves），还原时这几个数一起回去；
   * 但它跟撤销栈不一样，是**跟着存档走**的——刷新页面回来还认得那一刻。 */
  snap: null,
  vibe: null,         // 本局难度评估（由 game/vibe.js 算，见 applyBoard）
  diffApplied: 'any', // 本局真正用到的目标难度档（用来判断设置里是否有改动待生效）
  /* 本局的三把「不给用」的锁。它们是**这一局的规矩**，不是偏好：
   * 每日挑战把提示与记录点锁死，而玩家自己的设置里那两个开关可能开着，
   * 所以要跟着局面走（存档也带着）。自定义开新局时从 settings 抄一遍。
   * 读它们的地方一律读 state.*，别再回头读 settings。 */
  noHint: false,
  noUndo: false,
  noSnap: false,
  /* 这一局是不是每日挑战：{ day: '2026-10-26', tier: 'hard' }，不是就是 null。
   * 解开时据此记账（core/daily.js 的 mark），战绩也据此挂「每日」角标。 */
  daily: null,
  /* 挑战：本局限时（毫秒，0 = 不限）与倒计时起点。
   * limitFrom 记的是「起算那一刻的已用时」，所以剩余 = limit - (已用时 - limitFrom)，
   * 中途改限时不会因为之前耗掉的时间直接判负。 */
  limit: 0,
  limitFrom: 0
};

/** 用户设置，会持久化到 localStorage。 */
export const settings = Object.assign({}, DEFAULT_SETTINGS);

/* 设置面板上半部分（棋盘大小 / 目标难度 / 挑战）只是「意向」，选完不立刻作废当前这局，
 * 点「换一局」才把 pending 落到 settings 上并真的出一盘新的。
 * 下半部分的开关（自动打叉 / 音效…）是即时生效的。 */
export const pending = {
  size: 8,
  difficulty: 'any',
  timeLimit: 0,
  stepLimit: 0,
  lifeLimit: 0,
  noHint: false,
  noUndo: false,
  noSnap: false
};

/* 提示引导的当前进度。提前声明：relayout() 会在 boot() 里先跑，
 * 那时函数体内的 guide 还不能是 undefined。 */
export const guide = { open: false, plan: null, at: 0 };

/* 视图层的可变引用（原闭包里的 var，拆模块后集中放这里）：
 *   cells / chips        棋盘格子与色卡元素数组，换盘时整体重建
 *   undo / redo          撤销重做栈
 *   sheet                当前开着的浮层 id（null = 没开），canPlay() 只看它
 *   lastConflictCount    上一次渲染时的冲突对数，用来决定要不要响一声
 *
 * 浮层各自的临时状态（设置面板的「更多选项」、战绩看的是哪一页哪个筛选）
 * 不进这里：它们只有那一个面板会读，放回面板模块自己身上。
 * 这里只留「跨模块要看的」——sheet 是 canPlay 的判据，lastFinish 是结果层要念的。 */
export const view = {
  cells: [],
  chips: [],
  lastStates: [],
  undo: [],
  redo: [],
  /* 「一键补齐」正在一串串落子：这期间棋盘只读（canPlay 看它），
   * 免得手快的人跟动画抢同一个格子。换盘 / 重开时由 applyBoard 复位。 */
  filling: false,
  /* 正在出题（可能要抽好几秒，见 app/puzzle.js 的 SEARCH_MS）：棋盘同样只读，
   * 否则遮罩挡不住的键盘还能往旧盘上落子。applyBoard / 这一轮收手时复位。 */
  rolling: false,
  sheet: null,
  /* 已经画进 .piece 的皇后样式：外观面板只在真的换了样式时才重画一遍格子里的画 */
  lookPiece: '',
  lastFinish: null,    // 刚结束那局的成绩 { rank, total }，结果层拿它说「本组最快」
  lastConflictCount: 0
};

/** 棋盘上有没有玩家的痕迹（皇后或手标 ×）。计时靠它决定要不要起表。 */
export function hasProgress() {
  for (var i = 0; i < state.marks.length; i++) if (state.marks[i] !== 0) return true;
  return false;
}

/* 撤销栈的深度上限：整盘快照，太深了占内存（8×8 一步 64 字节，16×16 一步 256）。
 * 到顶以后最早的几步就撤不回去了。注意这是**撤销**的上限，不是步数的上限：
 * 信息条上的步数读 state.steps，不封顶（见上面 state.steps 的说明）。 */
export var UNDO_MAX = 60;
