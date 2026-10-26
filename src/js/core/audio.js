/* ============================================================================
 * audio.js
 * 音效与震动：WebAudio 实时合成，无音频文件。
 * ========================================================================== */

import { settings } from './state.js';

/* ==========================================================
   音效：WebAudio 实时合成
   ========================================================== */
export var audio = {
  ctx: null,
  master: null,
  noiseBuf: null,
  ready: false,

  init: function () {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.ready = true;
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.ready = true;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.2;
      this.master.connect(this.ctx.destination);

      var len = Math.floor(this.ctx.sampleRate * 0.35);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch (e) {
      this.ctx = null;
    }
  },

  tone: function (type, f0, f1, dur, delay, gain) {
    var ctx = this.ctx;
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 && f1 !== f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    }
    var peak = gain === undefined ? 0.5 : gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  },

  noise: function (dur, freq, q, delay, gain) {
    var ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    var t0 = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq || 1000, t0);
    bp.Q.value = q || 1.1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain === undefined ? 0.5 : gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
};

export function buzz(pattern) {
  if (!settings.haptics) return;
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* 忽略 */ }
  }
}

export function sfx(name, detail) {
  if (!settings.sound || !audio.ready) return;
  if (!audio.ctx) return;

  switch (name) {
    case 'x':
      audio.tone('square', 590, 470, 0.045, 0, 0.22);
      break;
    case 'xOff':
      audio.tone('sine', 330, 240, 0.07, 0, 0.35);
      break;
    case 'queen':
      audio.noise(0.07, 900, 1.3, 0, 0.55);
      audio.tone('sine', 210, 148, 0.14, 0, 0.55);
      audio.tone('triangle', 1046, 1046, 0.06, 0.03, 0.16);
      break;
    case 'fill':
      /* 一键补齐那一串：一只一声很短的「嗒」，音高随着落子往上爬。
       * 十几只连起来是一条上扬的线；照搬 'queen' 会糊成一片噪声。 */
      var k = (detail && detail.i) || 0;
      audio.tone('sine', 520 + k * 26, 560 + k * 26, 0.045, 0, 0.16);
      break;
    case 'remove':
      audio.tone('sine', 300, 190, 0.09, 0, 0.4);
      break;
    case 'miss':
      /* 标错惩罚：放错的那一下。一声闷响 + 一点低频噪声，比 'remove' 沉得多，
       * 一听就知道「这不是我自己撤的」。跟震动一起出现（见 ui/lives.js）。 */
      audio.noise(0.11, 340, 0.9, 0, 0.42);
      audio.tone('square', 208, 92, 0.17, 0, 0.26);
      break;
    case 'auto':
      audio.tone('sine', 1250, 1320, 0.025, 0, 0.1);
      break;
    case 'conflict':
      audio.tone('sawtooth', 132, 126, 0.2, 0, 0.22);
      audio.tone('sawtooth', 139, 132, 0.2, 0.01, 0.18);
      break;
    case 'region':
      audio.tone('triangle', 784, 784, 0.08, 0, 0.3);
      audio.tone('triangle', 988, 988, 0.11, 0.075, 0.26);
      break;
    case 'hint':
      audio.tone('sine', 620, 1240, 0.18, 0, 0.28);
      break;
    case 'share':
      audio.tone('triangle', 880, 880, 0.055, 0, 0.2);
      audio.tone('triangle', 1174, 1174, 0.085, 0.055, 0.16);
      break;
    case 'undo':
      audio.tone('sine', 430, 300, 0.09, 0, 0.3);
      break;
    case 'redo':
      /* 重做：把 undo 那一句倒过来放（300 → 430）。
       * 同一个音色、上行的走向，「往回退」和「再往前走回去」一听就分得开 */
      audio.tone('sine', 300, 430, 0.09, 0, 0.3);
      break;
    case 'snap':
      /* 记录点：记下这一刻。一声干脆的「合页」，比 undo 亮一档 */
      audio.noise(0.045, 1700, 1.5, 0, 0.3);
      audio.tone('triangle', 900, 1010, 0.07, 0, 0.2);
      break;
    case 'restore':
      /* 还原：往回走一个三度，跟「记下」是反方向 */
      audio.tone('sine', 760, 560, 0.1, 0, 0.26);
      audio.tone('sine', 520, 420, 0.12, 0.06, 0.2);
      break;
    case 'new':
      audio.noise(0.2, 600, 0.7, 0, 0.22);
      audio.tone('sine', 300, 520, 0.2, 0, 0.18);
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
        audio.tone('triangle', f, f, 0.16, i * 0.1, 0.32);
      });
      audio.noise(0.5, 4200, 0.8, 0.1, 0.1);
      break;
    case 'fail':
      // 下行两句：不吵，但一听就知道这局完了
      audio.tone('triangle', 392, 330, 0.16, 0, 0.26);
      audio.tone('sine', 262, 175, 0.34, 0.12, 0.3);
      break;

    /* ---- 老虎机（ui/panels/slot.js）：跟原型同一套配方，走这里的统一开关 ---- */
    case 'slotTick':
      // 转轮滚过一格的「嗒」：越到后面间隔越长（间隔在 slot.js 里按缓动算）
      audio.tone('square', 1280, 620, 0.035, 0, 0.09);
      break;
    case 'slotClack':
      // 拉杆砸到底那一下
      audio.tone('square', 320, 110, 0.07, 0, 0.26);
      audio.tone('sine', 96, 48, 0.17, 0, 0.4);
      break;
    case 'slotThunk':
      // 一轮停稳：闷响 + 一点金属余音
      audio.tone('sine', 170, 54, 0.2, 0, 0.52);
      audio.tone('square', 460, 190, 0.05, 0, 0.14);
      break;
    case 'slotNope':
      // 拉了一半松手：杆子弹回去，不给抽
      audio.tone('square', 190, 120, 0.11, 0, 0.18);
      break;
    case 'slotLose':
      audio.tone('sine', 330, 210, 0.3, 0, 0.2);
      break;
    case 'slotSmall':
      // 两个一样：半份奖，短促两声
      audio.tone('triangle', 659, 659, 0.2, 0, 0.26);
      audio.tone('triangle', 880, 880, 0.2, 0.08, 0.26);
      break;
    case 'slotWin':
      // 三个一样：一小串上行琶音
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        audio.tone('triangle', f, f, 0.26, i * 0.085, 0.3);
      });
      break;
    case 'slotBig':
      // 传说档：琶音再多一级，音再长一点
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
        audio.tone('triangle', f, f, 0.38, i * 0.085, 0.32);
      });
      break;
    default:
      break;
  }
}
