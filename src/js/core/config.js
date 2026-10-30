/* ============================================================================
 * config.js
 * 全局常量：棋盘尺寸范围、本地存储键、难度档位、默认设置。
 * （外观的画法不在这里了：色块图案 / 叉 / 皇后都搬进 src/js/looks/ 的插件，
 *   这里只留下「默认选哪一套」这一件事。）
 * ========================================================================== */

import { DEFAULT_LOOK } from '../looks/index.js';

export var SIZE_MIN = 4;
export var SIZE_MAX = 16;
export var STORE_SETTINGS = 'queens.settings.v1';
export var STORE_GAME = 'queens.game.v1';
export var STORE_RECORDS = 'queens.records.v1';
/* 每日挑战的完成记录（按天按档位，见 core/daily.js）。跟战绩分开存：
 * 「清空全部记录」不该把日历一起清掉。 */
export var STORE_DAILY = 'queens.daily.v1';

/* 设置的存档版本：改了某个默认值、又想让老存档跟上新默认值时 +1。
 *   v2：淡化 × 改成默认关闭（一铺半盘的 × 全淡下去，反而看不出棋盘的进度）。
 * 老存档（没有 sv 字段）里这一项一律按新默认走，别的偏好照旧保留。 */
export var SETTINGS_VERSION = 2;

/* 战绩：最多留多少条（新的在前，超出丢最老的）、列表一次画多少条、
 * 排行榜每组最多显示几名。都只影响展示，不影响统计。 */
export var RECORD_MAX = 300;
export var RECORD_PAGE = 20;
export var RECORD_TOP = 12;

/* 目标难度：档位跟难度分走，尺寸只是「可选范围」。
 * lo/hi 是该档开放给玩家的棋盘尺寸（选了档位就只能在这些尺寸里挑），
 * [min, max) 是该档的分数区间——生成时最多抽 4 张，落进区间就收（见 app/puzzle.js）。
 *
 * 两头都卡：只卡下限的话，选「困难」会给你一盘 8.6 的（顶栏写着极难），
 * 档位就名存实亡了。min/max 就是 levelOf 的那两个阈值，边界对齐、不重叠；
 * max 是开区间上界（正好 8.4 算极难），所以两档不会抢同一张盘。
 *
 * 区间与下限来自实测的可达性矩阵（docs/难度刻度v2-实施方案.md）：
 *   4×4 / 5×5 只可能「容易」；6–7 到中等封顶；8–10 到困难封顶；
 *   12×12 起才出得了极难，14×14 最稳。所以 13×13 归困难、不归极难。
 * 分数本身就是 1.0–9.9 截断过的，极难那一档写 10 就等于「不封顶」。 */
export var DIFF_BANDS = {
  easy: { name: '容易', lo: 4, hi: 5, min: 0, max: 5.5 },
  mid: { name: '中等', lo: 6, hi: 8, min: 5.5, max: 7.0 },
  hard: { name: '困难', lo: 9, hi: 13, min: 7.0, max: 8.4 },
  extreme: { name: '极难', lo: 14, hi: 16, min: 8.4, max: 10 }
};
export var DIFF_ORDER = ['any', 'easy', 'mid', 'hard', 'extreme'];

/** 档位的分数区间说法：困难「7.0–8.4 分」、容易「低于 5.5 分」、极难「8.4 分以上」。
 *  设置面板与「没抽到够格的盘」都读这一句，别各写一套。 */
export function bandRangeLabel(band) {
  if (!band) return '';
  if (band.max >= 9.9) return band.min.toFixed(1) + ' 分以上';
  if (!band.min) return '低于 ' + band.max.toFixed(1) + ' 分';
  return band.min.toFixed(1) + '–' + band.max.toFixed(1) + ' 分';
}

/* 挑战：限时挡位（毫秒，0 = 不限时）。
 * 设置面板的按钮按这张表生成，加挡位只改这里。 */
export var LIMIT_OPTIONS = [
  { ms: 0, label: '不限' },
  { ms: 180000, label: '3 分' },
  { ms: 300000, label: '5 分' },
  { ms: 600000, label: '10 分' },
  { ms: 1200000, label: '20 分' }
];

export var LIMIT_MAX = 3600000;

export function normalizeLimit(ms) {
  ms = parseInt(ms, 10);
  if (!ms || ms < 0) return 0;
  return Math.min(ms, LIMIT_MAX);
}

/** 限时的人话说法：「5 分钟」/「不限时」。 */
export function limitLabel(ms) {
  if (!ms) return '不限时';
  var m = Math.round(ms / 60000);
  return m >= 1 ? m + ' 分钟' : '不到 1 分钟';
}

/* 挑战：步数限制的挡位（0 = 不限）。
 * 一步 = 一次落笔（见 app/history.js 的 pushHistory）：点一格是一步，
 * 拖动连涂一整行也只算一步——跟撤销点同一个口径，玩家心里那笔账才对得上。
 * 挡位按「一局大概要落多少次笔」排：8×8 顺手时二三十步，16×16 慢慢推能到上百步。 */
export var STEP_OPTIONS = [
  { steps: 0, label: '不限' },
  { steps: 60, label: '60 步' },
  { steps: 100, label: '100 步' },
  { steps: 150, label: '150 步' },
  { steps: 250, label: '250 步' }
];

export var STEP_MAX = 9999;

export function normalizeSteps(v) {
  v = parseInt(v, 10);
  if (!v || v < 0) return 0;
  return Math.min(v, STEP_MAX);
}

/** 步数限制的人话说法：「100 步」/「不限步数」。 */
export function stepLimitLabel(n) {
  return n ? n + ' 步' : '不限步数';
}

/* 挑战：标错惩罚 —— 这一局一共给几条命（0 = 不惩罚）。
 * 判错的口径是「这一格是不是解位」：每盘唯一解，所以不是解位就是错的
 * （见 game/rules.js 的 isSolutionCell）。放错一次红 X 闪一下、格子还原成空的、
 * 扣一条命；扣到 0 就判负（ui/win.js 的 failGame('lives')）。
 *
 * 挡位从「1 条」起步：一条命等于「一次都不许错」，是这里最狠的一档。 */
export var LIFE_OPTIONS = [
  { lives: 0, label: '不惩罚' },
  { lives: 1, label: '1 条' },
  { lives: 3, label: '3 条' },
  { lives: 5, label: '5 条' },
  { lives: 8, label: '8 条' }
];

export var LIFE_MAX = 20;

export function normalizeLives(v) {
  v = parseInt(v, 10);
  if (!v || v < 0) return 0;
  return Math.min(v, LIFE_MAX);
}

/** 命数的人话说法：「3 条命」/「不惩罚」。 */
export function lifeLabel(n) {
  return n ? n + ' 条命' : '不惩罚';
}

export var DEFAULT_SETTINGS = {
  size: 8,
  difficulty: 'any',
  autoMark: true,
  conflict: true,
  forced: true,
  sound: true,
  haptics: true,
  /* 拖动标 × 的落点方式：开着按行列对齐（锁一行 / 一列，见 events.js），
   * 关掉就跟着手指走，想斜着涂也随便。 */
  alignDrag: true,
  // 挑战（即时生效，也跟着存盘）
  timeLimit: 0,     // 本局限时（毫秒），0 = 不限时
  stepLimit: 0,     // 本局步数限制（0 = 不限），用完还没解开就算输
  lifeLimit: 0,     // 本局命数（0 = 不惩罚），放错一次扣一条，扣光判负
  noHint: false,    // 禁用提示
  noUndo: false,    // 禁用撤销
  noSnap: false,    // 禁用记录点（记下这一刻 / 还原 / 长按清空都不给）
  // 外观（即时生效，跟着存盘）：色块的图案、叉的样式、皇后样式、生命的画法
  // 默认就是各自那一类里的第一套（见 looks/index.js 的 DEFAULT_LOOK）
  surfaceStyle: DEFAULT_LOOK.surface,
  markStyle: DEFAULT_LOOK.mark,
  pieceStyle: DEFAULT_LOOK.piece,
  lifeStyle: DEFAULT_LOOK.life,
  dealStyle: DEFAULT_LOOK.deal,
  revealStyle: DEFAULT_LOOK.reveal,
  confettiStyle: DEFAULT_LOOK.confetti,
  /* 淡化（即时生效）：填过的格子退到后面去，别跟空格抢眼睛。
   * 默认都关着——淡下去以后「这格处理过了」的分量也跟着没了，
   * 想要安静的棋盘再自己开。 */
  fadeMark: false,
  fadeQueen: false
};

export var REDUCE_MOTION = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
