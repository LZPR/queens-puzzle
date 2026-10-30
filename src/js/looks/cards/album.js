/* 集卡册沿用作者的 createSheet：焦点、Esc、游戏快捷键和遮罩统一处理。 */
import { CATALOG, pokemonOf } from './catalog.js';
import { collection, currentCard } from './collection.js';
import { cardScene } from './card.js';

let sheet, wrap, grid, detail, progress, notice, badge, rewardButton;
let filter = 'all', selected = null;
export function openAlbum(id = null) {
  selected = pokemonOf(id)?.id || null;
  if (sheet.isOpen()) render(); else sheet.open();
}
function render() {
  const data = collection();
  progress.textContent = `${data.unique} / ${CATALOG.length} 种 · 共 ${data.total} 张`;
  badge.textContent = data.unique;
  notice.textContent = data.saved ? '收藏保存在当前浏览器。每次通关随机获得一张，重复卡累计数量。' : '当前浏览器无法保存收藏，本页关闭后将丢失本次进度。';
  grid.replaceChildren(); detail.replaceChildren();
  for (const p of CATALOG) {
    const count = data.counts[p.id] || 0;
    if (filter === 'owned' && !count) continue;
    const slot = document.createElement('button');
    slot.type = 'button'; slot.className = 'poke-slot' + (count ? ' is-owned' : '');
    slot.dataset.cardId = p.id;
    slot.setAttribute('aria-label', count ? `${p.name}，已收集 ${count} 张，查看卡片` : `未收集，图鉴编号 ${p.id}`);
    if (count) {
      slot.append(cardScene(p, false));
      const label = document.createElement('span'); label.className = 'poke-slot-label'; label.textContent = `${p.name} ×${count}`; slot.append(label);
      slot.addEventListener('click', () => { selected = p.id; render(); document.getElementById('pokeBack').focus(); });
    } else {
      slot.disabled = true;
      slot.innerHTML = `<span class="poke-unknown">?</span><span class="poke-slot-label">NO. ${String(p.id).padStart(3, '0')} · 待发现</span>`;
    }
    grid.appendChild(slot);
  }
  if (filter === 'owned' && data.unique === 0) {
    const empty = document.createElement('p'); empty.className = 'poke-empty'; empty.textContent = '收藏从第一次通关开始。去解开一盘棋，遇见第一位伙伴吧。'; grid.append(empty);
  }
  const p = pokemonOf(selected);
  grid.hidden = !!p; detail.hidden = !p;
  if (p) {
    const back = document.createElement('button'); back.type = 'button'; back.id = 'pokeBack'; back.className = 'btn-text'; back.textContent = '← 返回卡册';
    back.addEventListener('click', () => { const id = selected; selected = null; render(); grid.querySelector(`[data-card-id="${id}"]`)?.focus(); });
    const title = document.createElement('h3'); title.textContent = `${p.name} · 已拥有 ${data.counts[p.id] || 0} 张`;
    const hint = document.createElement('p'); hint.className = 'poke-angle-hint'; hint.textContent = '拖动卡片查看角度 · 双击回正 · 也可用方向键';
    detail.append(back, title, cardScene(p), hint);
  }
  for (const b of wrap.querySelectorAll('[data-card-filter]')) b.setAttribute('aria-pressed', String(b.dataset.cardFilter === filter));
  const reward = currentCard();
  rewardButton.hidden = !reward;
  if (reward) rewardButton.textContent = `本局获得 ${reward.name} · 查看卡片 ↗`;
}
export async function mountAlbum() {
  if (sheet) return;
  const { createSheet } = await import('../../core/sheet.js');
  const opener = document.createElement('button');
  opener.id = 'btnCollection'; opener.type = 'button'; opener.className = 'icon-btn poke-album-opener';
  opener.title = '宝可梦集卡册';
  opener.setAttribute('aria-label', '宝可梦集卡册'); opener.setAttribute('aria-expanded', 'false');
  opener.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="3" width="14" height="18" rx="3"/><path d="M3 6v12m6-7h8m-4-4v8"/></svg><span class="poke-count">0</span>';
  document.getElementById('btnLook').insertAdjacentElement('afterend', opener);
  badge = opener.querySelector('.poke-count');
  wrap = document.createElement('div'); wrap.id = 'collectionWrap'; wrap.className = 'sheet-wrap'; wrap.hidden = true;
  wrap.innerHTML = `<div class="sheet-backdrop" id="collectionBackdrop"></div>
    <section class="sheet poke-album" id="collectionSheet" role="dialog" aria-modal="true" aria-labelledby="collectionTitle" tabindex="-1">
    <div class="sheet-head"><div><p class="poke-kicker">QUEENS · POKÉMON</p><h2 id="collectionTitle">我的集卡册</h2></div>
    <button class="icon-btn" id="btnCloseCollection" type="button" aria-label="关闭集卡册">×</button></div>
    <p class="poke-progress" aria-live="polite"></p><p class="sheet-note poke-storage-note"></p>
    <div class="poke-filters" role="group" aria-label="收藏筛选"><button type="button" data-card-filter="all" aria-pressed="true">全部卡片</button><button type="button" data-card-filter="owned" aria-pressed="false">已收集</button></div>
    <div class="poke-album-grid"></div><div class="poke-detail" hidden></div>
    <p class="poke-credit">立绘来自 <a href="https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/other/official-artwork" target="_blank" rel="noopener noreferrer">PokéAPI 官方立绘目录</a> · © The Pokémon Company</p>
    </section>`;
  document.getElementById('sheets').append(wrap);
  grid = wrap.querySelector('.poke-album-grid'); detail = wrap.querySelector('.poke-detail');
  progress = wrap.querySelector('.poke-progress'); notice = wrap.querySelector('.poke-storage-note');
  rewardButton = document.createElement('button'); rewardButton.id = 'btnRewardCard'; rewardButton.className = 'btn-text poke-result-link'; rewardButton.type = 'button'; rewardButton.hidden = true;
  document.querySelector('.result-stats').insertAdjacentElement('afterend', rewardButton);
  rewardButton.addEventListener('click', () => openAlbum(currentCard()?.id));
  sheet = createSheet({ id: 'collection', wrap, panel: wrap.querySelector('.sheet'), opener, focusOpener: true, beforeOpen: render });
  opener.addEventListener('click', () => openAlbum());
  wrap.querySelector('#btnCloseCollection').addEventListener('click', () => sheet.close());
  wrap.querySelector('#collectionBackdrop').addEventListener('click', () => sheet.close());
  for (const b of wrap.querySelectorAll('[data-card-filter]')) b.addEventListener('click', () => { filter = b.dataset.cardFilter; selected = null; render(); });
  window.addEventListener('queens:cards', render);
  window.addEventListener('storage', e => { if (e.key === 'queens.cards.v1') render(); });
  render();
}
