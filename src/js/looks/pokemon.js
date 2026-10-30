/* 宝可梦奖励插件：抽取、收藏、卡片与资源全部留在 looks/ 内。 */
import { CATALOG } from './cards/catalog.js';
import { awardCard, beginRound, collection, currentCard } from './cards/collection.js';
import { cardPicture, cardScene } from './cards/card.js';
import { mountAlbum, openAlbum } from './cards/album.js';
import { flipTiles } from './effects/tiles.js';

async function reveal(ctx, mode) {
  const p = currentCard();
  if (!p) return true;
  const picture = await cardPicture(p);
  if (ctx.signal.aborted) return false;
  const completed = await flipTiles(ctx, { mode, picture, label: p.name + '的宝可梦镭射卡片' });
  if (!completed || ctx.signal.aborted) return false;
  const layer = ctx.board.querySelector('.look-tiles.is-reward');
  if (!layer) return true;
  layer.classList.add('poke-reward'); layer.dataset.cardId = p.id;
  layer.style.backgroundImage = ''; layer.setAttribute('role', 'region');
  const copies = collection().counts[p.id] || 1;
  const caption = document.createElement('button'); caption.type = 'button'; caption.className = 'poke-reward-caption';
  caption.textContent = (copies === 1 ? '新伙伴' : '已收集 ×' + copies) + ' · 拖动看立体 · 卡册 ↗';
  caption.addEventListener('click', () => openAlbum(p.id));
  layer.replaceChildren(cardScene(p), caption);
  return true;
}
const preview = '<svg viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id="pokePreview"><stop stop-color="#7ce9cf"/><stop offset=".5" stop-color="#f5b9df"/><stop offset="1" stop-color="#e3cf76"/></linearGradient></defs><rect x="16" y="4" width="48" height="72" rx="8" fill="url(#pokePreview)"/><rect x="20" y="8" width="40" height="64" rx="5" fill="#383759"/><image href="' + CATALOG[0].art + '" x="14" y="13" width="52" height="52"/></svg>';
export default {
  id: 'pokemon', name: '宝可梦集卡', note: '解开一盘，遇见一位伙伴',
  stylesheet: new URL('./effects/cards.css', import.meta.url).href,
  mount: mountAlbum, onBoard: beginRound, onWin: awardCard,
  reveals: [
    { id: 'pokemon', name: '镭射藏卡', desc: '从左下逐格对半折页，揭开随机宝可梦藏卡', svg: preview,
      preload: () => cardPicture(CATALOG[0]), play: ctx => reveal(ctx, 'diagonal') },
    { id: 'pokemon-ripple', name: '星河藏卡', desc: '涟漪折页揭开本局藏卡，收藏不会重复领取', svg: preview,
      preload: () => cardPicture(CATALOG[0]), play: ctx => reveal(ctx, 'ripple') }
  ]
};
