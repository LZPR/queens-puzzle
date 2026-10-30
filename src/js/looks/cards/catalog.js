/* 原有官方立绘：本地 PNG，无 AI 图像或运行时外部 API。 */
const entries = [
  [25, '皮卡丘', 'Pikachu', '电', '#f4bd35', '#604c9e'],
  [1, '妙蛙种子', 'Bulbasaur', '草 · 毒', '#67c59c', '#285f78'],
  [4, '小火龙', 'Charmander', '火', '#ff9d60', '#a53f6b'],
  [7, '杰尼龟', 'Squirtle', '水', '#6bceeb', '#4265b8'],
  [6, '喷火龙', 'Charizard', '火 · 飞行', '#f9a04e', '#7945aa'],
  [39, '胖丁', 'Jigglypuff', '一般 · 妖精', '#ef9cce', '#8664bc'],
  [54, '可达鸭', 'Psyduck', '水', '#edd367', '#3c9bb5'],
  [94, '耿鬼', 'Gengar', '幽灵 · 毒', '#b69bed', '#5b377d'],
  [132, '百变怪', 'Ditto', '一般', '#d4a9ef', '#7f5fa6'],
  [133, '伊布', 'Eevee', '一般', '#daba83', '#8a5c81'],
  [143, '卡比兽', 'Snorlax', '一般', '#83c6c6', '#3f667c'],
  [149, '快龙', 'Dragonite', '龙 · 飞行', '#f3be73', '#5c9d9f'],
  [150, '超梦', 'Mewtwo', '超能力', '#c9b3f0', '#6751b9'],
  [151, '梦幻', 'Mew', '超能力', '#efb3dc', '#8376c5'],
  [196, '太阳伊布', 'Espeon', '超能力', '#d5b7ed', '#765fb6'],
  [197, '月亮伊布', 'Umbreon', '恶', '#e5ca61', '#374b76'],
  [448, '路卡利欧', 'Lucario', '格斗 · 钢', '#68bfe6', '#3a5b8a'],
  [658, '甲贺忍蛙', 'Greninja', '水 · 恶', '#69bfdc', '#534b8b']
];
export const CATALOG = entries.map(([id, name, english, type, color, night]) => ({
  id, name, english, type, color, night,
  art: new URL('../assets/pokemon/' + id + '.png', import.meta.url).href
}));
export const pokemonOf = id => CATALOG.find(p => p.id === Number(id)) || null;
