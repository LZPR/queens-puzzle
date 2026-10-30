/* 集卡独立存档。一局绑定一张卡；刷新、换外观不再次抽卡或加数量。 */
import { CATALOG, pokemonOf } from './catalog.js';

export const STORE_CARDS = 'queens.cards.v1';
const STORE_ROUND = 'queens.cards.round.v1';
let memory = { counts: {}, claims: {}, round: null };
let round = null;
let saved = true;
export function collection() {
  try {
    const raw = saved && localStorage.getItem(STORE_CARDS);
    if (raw) {
      const data = JSON.parse(raw), counts = {};
      for (const p of CATALOG) {
        const n = Number(data?.counts?.[p.id]);
        if (Number.isSafeInteger(n) && n > 0 && n <= 999999) counts[p.id] = n;
      }
      const claims = {};
      for (const [key, id] of Object.entries(data?.claims || {}).slice(-1000)) {
        if (/^[a-z0-9-]{10,80}$/i.test(key) && pokemonOf(id)) claims[key] = Number(id);
      }
      const r = data?.round;
      memory = { counts, claims, round: r && typeof r.key === 'string' && typeof r.boardKey === 'string' &&
        (r.cardId == null || pokemonOf(r.cardId)) ? r : null };
    }
  } catch (_) { /* 损坏或禁用存储时仍可玩，使用本页内存。 */ }
  const counts = { ...memory.counts };
  return { counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    unique: Object.keys(counts).length, saved };
}
function write(data) {
  memory = { ...data, claims: data.claims || memory.claims };
  try { sessionStorage.setItem(STORE_ROUND, JSON.stringify(memory.round)); } catch (_) { /* 本页仍可领取。 */ }
  try { localStorage.setItem(STORE_CARDS, JSON.stringify({ v: 1, ...memory })); saved = true; }
  catch (_) { saved = false; }
  window.dispatchEvent(new CustomEvent('queens:cards'));
}
export function beginRound(ctx) {
  collection();
  let previous = memory.round;
  try {
    const own = JSON.parse(sessionStorage.getItem(STORE_ROUND));
    if (own?.boardKey === ctx.boardKey && typeof own.key === 'string' && (own.cardId == null || pokemonOf(own.cardId))) previous = own;
  } catch (_) { /* 不依赖 sessionStorage 也可玩。 */ }
  round = ctx.restored && previous?.boardKey === ctx.boardKey ? { ...previous } : {
    key: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2),
    boardKey: ctx.boardKey, cardId: null
  };
  write({ counts: { ...memory.counts }, round });
  // 旧版已通关存档首次使用集卡时补领一张，之后恢复仍是同一张。
  if (ctx.restored && ctx.won) awardCard();
}
export function awardCard() {
  if (!round) return null;
  const current = collection();
  if (memory.claims[round.key] && round.cardId !== memory.claims[round.key]) {
    round = { ...round, cardId: memory.claims[round.key] };
    write({ counts: { ...current.counts }, round });
  }
  if (round.cardId) return { pokemon: pokemonOf(round.cardId), copies: current.counts[round.cardId] || 1, fresh: false };
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const pokemon = CATALOG[Math.floor(random[0] / 4294967296 * CATALOG.length)];
  round = { ...round, cardId: pokemon.id };
  const copies = (current.counts[pokemon.id] || 0) + 1;
  const claims = Object.fromEntries(Object.entries({ ...memory.claims, [round.key]: pokemon.id }).slice(-1000));
  write({ counts: { ...current.counts, [pokemon.id]: copies }, claims, round });
  return { pokemon, copies, fresh: copies === 1 };
}
export function currentCard() { return pokemonOf(round?.cardId); }
