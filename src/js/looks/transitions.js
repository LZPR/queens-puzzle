/* 翻面外观插件：选项、预览、资源和动作都在 looks/ 内。 */
import { captureTiles, flipTiles } from './effects/tiles.js';
const icon = axis => '<svg viewBox="0 0 80 80" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round">' +
  (axis === 'ripple' ? '<circle cx="40" cy="40" r="11"/><circle cx="40" cy="40" r="23"/><path d="M8 40h5m54 0h5M40 8v5m0 54v5"/>' :
    axis === 'wave' ? '<path d="M14 20h52v12H14zm0 27h52v13H14zM26 37l14 6 14-6"/>' :
      '<path d="M13 14h22v22H13zm32 30h22v22H45zM45 15l20 8-5 20-20-8z"/>') + '</g></svg>';

export default {
  id: 'transitions', name: '翻面', note: '翻格只改变画法',
  stylesheet: new URL('./effects/tiles.css', import.meta.url).href,
  deals: [
    { id: 'diagonal', name: '斜向折页', desc: '右半页向左翻，从左上推进到右下', svg: icon('diagonal'),
      capture: captureTiles, play: ctx => flipTiles(ctx, { mode: 'diagonal' }) },
    { id: 'wave', name: '逐行翻页', desc: '右半页向左翻，逐行向下推进', svg: icon('wave'),
      capture: captureTiles, play: ctx => flipTiles(ctx, { mode: 'wave' }) },
    { id: 'ripple', name: '涟漪折页', desc: '右半页向左翻，从中央向四周推进', svg: icon('ripple'),
      capture: captureTiles, play: ctx => flipTiles(ctx, { mode: 'ripple' }) }
  ]
};
