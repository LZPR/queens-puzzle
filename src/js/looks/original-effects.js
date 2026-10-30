/* 原版效果没有 play：运行器会交回作者已有的入场、胜利小跳和礼花。 */
const svg = '<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M18 54l10-33 12 17 12-17 10 33z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M21 62h38" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';
export default {
  id: 'original-effects', name: '原版', note: '保留作者原有的效果',
  deals: [{ id: 'original', name: '原版入场', desc: '作者原有的格子轻弹入场', svg }],
  reveals: [{ id: 'original', name: '保留棋盘', desc: '皇后轻跳，通关后仍显示棋盘', svg }],
  confettis: [{ id: 'original', name: '原版礼炮', desc: '作者原有的彩纸礼花', svg }]
};
