/* ============================================================================
 * main.js
 * 应用入口：挂载浮层、启动流程（恢复存档 / 载入分享码 / 开新局）、尺寸监听、调试探针。
 * ========================================================================== */

import './events.js';   // 事件接线（纯副作用模块，必须早于 boot 执行）
import { clearBoard } from './app/actions.js';
import { redo, undo } from './app/history.js';
import { applyBoard, lastRoll, newDaily, newGame, retryGame } from './app/puzzle.js';
import { clearSnap, restoreSnap, saveSnap } from './app/snap.js';
import { limitRemaining, paintClock, pauseTimer, startTimer } from './core/clock.js';
import { hintEl, sheetsHost, stage } from './core/dom.js';
import { guide, hasProgress, settings, state, view } from './core/state.js';
import { doSave, loadGame, loadSettings } from './core/storage.js';
import * as daily from './core/daily.js';
import * as records from './core/records.js';
import { closeTopSheet } from './core/sheet.js';
import { announce } from './core/utils.js';
import { buildBoard, buildRegionBar } from './game/board.js';
import { decodeShare, encodeShare } from './game/share-code.js';
import { computeVibe } from './game/vibe.js';
import { updateDiffChip } from './ui/difficulty.js';
import { applyFadeNow } from './ui/fade.js';
import { closeGuide, guideNext, guidePrev, useHint } from './ui/guide.js';
import { flashHint } from './ui/hint.js';
import { relayout } from './ui/layout.js';
import { mountAll } from './ui/panels/index.js';
import { closeDiff, openDiff, tick as infoTick } from './ui/panels/info.js';
import { applyLook, closeLook, openLook } from './ui/panels/look.js';
import { closeRecords, openRecords } from './ui/panels/records.js';
import { showResult } from './ui/panels/result.js';
import { render, updateStats } from './ui/render.js';
import { takeHashCode, tryLoadShare } from './ui/share.js';
import { traceCells } from './ui/trace.js';
import { checkLives, checkSteps, checkTimeout } from './ui/win.js';
import { playBoardLook } from './looks/effects.js';

/* 浮层先挂上：markup 进 #sheets，各面板的元素引用与事件在这一步接好。
 * 必须早于 boot()——外观面板要按面板里的展位建按钮，applyLook 靠它。 */
mountAll(sheetsHost);

var ro = null;
var ticker = null;
if (window.ResizeObserver) {
  ro = new ResizeObserver(function () { relayout(); });
  ro.observe(stage);
} else {
  window.addEventListener('resize', relayout);
}

window.addEventListener('orientationchange', function () {
  window.setTimeout(relayout, 140);
});

/* ==========================================================
   启动
   ========================================================== */
function boot() {
  if (!window.QueensEngine) {
    hintEl.textContent = '引擎加载失败，请确认 src/js/engine/engine.js 能正常加载';
    hintEl.classList.add('is-alert');
    return;
  }

  loadSettings();
  // 外观要在建棋盘之前落地：buildBoard 会照 settings.pieceStyle 画皇后，
  // 也会照 settings.surfaceStyle 给每格挂图案（defs 由 applySurface 先建好）
  applyLook();

  // 链接里带了棋盘代码（#QNS1-...）就直接开那一盘，否则照常续玩
  var handed = takeHashCode();
  var restored = !handed && loadGame();

  if (handed) {
    applyBoard(handed.size, handed.regions, handed.solution, 0);
    flashHint('已载入分享的 ' + handed.size + '×' + handed.size + ' 棋盘', true, 2400);
    announce('已载入分享的棋盘：' + handed.size + '×' + handed.size);
  } else if (restored) {
    state.diffApplied = settings.difficulty;   // 续玩的这局当作已按当前设置开出
    state.vibe = computeVibe(state.size, state.regions, state.solution);
    buildBoard(false);
    buildRegionBar();
    relayout();
    render();
    /* 续玩的盘已经写满了标记：这一步直接淡好，
     * 别让它先整盘亮 0.5 秒再透下去（那不是「刚做的」，是「早就有的」）。 */
    applyFadeNow();
    updateStats();
    updateDiffChip();
    playBoardLook(true);

    if (state.status === 'won') {
      showResult();
    } else if (hasProgress()) {
      state.runningSince = 0;
      startTimer();
    }
    announce('已恢复上一局：' + state.size + '×' + state.size);
  } else {
    newGame(settings.size);
  }

  /* 心跳：刷新计时胶囊，顺带看限时到没到点。
   * 判负放在这里而不是 clock 里——clock 只算时间账，封盘属于界面的事。 */
  clearInterval(ticker);
  ticker = window.setInterval(function () {
    if (state.status === 'playing') {
      if (checkTimeout()) {
        // 面板还开着就先收起来，别让失败层背后挂着一张面板
        // （设置 / 新的一局 / 本局信息都可能开着，收最上面那个就行）
        closeTopSheet();
        return;
      }
      if (state.runningSince) paintClock();
    }
    /* 信息页开着时计时还在走：卡片上的读数跟着一起动，
     * 不然盯着「用时 01:12」看半分钟，还以为面板把游戏暂停了。 */
    infoTick();
  }, 250);

  // 恢复出来的那局可能早就超时了（关着页面的时候不扣时间，但已用时的实打实的）
  checkTimeout();
  // 步数用尽同理：两次数都是存档里带回来的，回来就该看到同一张结局卡
  checkSteps();
  // 命用尽也一样：剩 0 条命的那局读回来，先判负再谈别的
  checkLives();
  paintClock();

  window.addEventListener('beforeunload', function () {
    pauseTimer();
    doSave();
  });
}

// 调试/自动化用（不影响正常游玩）
window.__QUEENS_DEBUG__ = {
  state: state,
  settings: settings,
  newGame: newGame,
  retry: retryGame,
  // 上一次出题花了多久、抽了几张、有没有装上（只给 tools/ 里的自动化测试用）
  rollInfo: lastRoll,
  useHint: useHint,
  clear: function () { clearBoard(true); },
  render: render,
  // 撤销 / 重做与两个栈的深度、以及撤销后亮着的那几格（残影）。
  // 只给 tools/ 里的自动化测试用——正常游玩都走工具栏那两颗
  undo: undo,
  redo: redo,
  history: function () { return { undo: view.undo.length, redo: view.redo.length }; },
  trace: function () { return traceCells(); },
  vibe: function () { return state.vibe; },
  openDiff: openDiff,
  closeDiff: closeDiff,
  // 当前开着的浮层 id（null = 没开）。只给 tools/ 里的自动化测试用
  sheet: function () { return view.sheet; },
  // 挑战相关的探针，只给 tools/ 里的自动化测试用
  remaining: limitRemaining,
  checkTimeout: checkTimeout,
  checkSteps: checkSteps,
  checkLives: checkLives,
  // 命数（挑战「标错惩罚」）：面板上换挡位走 newgame.js，这里是只读探针
  lives: function () { return { left: state.lives, limit: state.lifeLimit }; },
  // 记录点：手上那一份（null = 还没记）+ 三个动作，只给 tools/ 里的自动化测试用
  snap: function () {
    if (!state.snap) return null;
    return {
      marks: Array.prototype.slice.call(state.snap.marks),
      moves: state.snap.moves,
      hints: state.snap.hints
    };
  },
  saveSnap: saveSnap,
  restoreSnap: restoreSnap,
  clearSnap: clearSnap,
  // 引导相关的探针，只给 tools/ 里的自动化测试用
  guide: function () {
    return { open: guide.open, at: guide.at, plan: guide.plan };
  },
  guideNext: guideNext,
  guidePrev: guidePrev,
  guideClose: closeGuide,
  encode: function () {
    return state.regions ? encodeShare(state.size, state.regions, state.solution) : '';
  },
  decode: decodeShare,
  loadCode: tryLoadShare,
  // 战绩：只给 tools/ 里的自动化测试用（正常游玩都走面板）
  records: function () { return records.all(); },
  record: function (id) { return records.get(id); },
  recordDelete: records.remove,
  recordClear: records.clear,
  openRecords: openRecords,
  closeRecords: closeRecords,
  // 每日挑战：今天的日期键、四挡规矩、哪几挡打完了、哪几挡锁着。
  // 只给 tools/ 里的自动化测试用（正常游玩都走换一局面板与战绩页）
  daily: function () {
    var day = daily.dayKey();
    var out = { day: day, done: {}, unlocked: {}, complete: daily.complete(day) };
    for (var i = 0; i < daily.DAILY_TIERS.length; i++) {
      var t = daily.DAILY_TIERS[i];
      out.done[t] = daily.isDone(day, t);
      out.unlocked[t] = daily.unlocked(day, t);
      out[t] = daily.ruleOf(t);
    }
    return out;
  },
  dailyAll: daily.days,
  dailyMark: daily.mark,
  dailyClear: daily.clear,
  startDaily: newDaily,
  // 外观：面板开关 + 当前样式，只给 tools/ 里的自动化测试用
  look: function () {
    return {
      surface: settings.surfaceStyle,
      mark: settings.markStyle,
      piece: settings.pieceStyle,
      life: settings.lifeStyle
    };
  },
  openLook: openLook,
  closeLook: closeLook
};

boot();
