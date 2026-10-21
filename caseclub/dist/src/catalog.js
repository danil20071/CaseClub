import { SKINS } from './skins.js';

export { SKINS };
export const SKIN_MAP = Object.fromEntries(SKINS.map(s => [s.id, s]));
export const RARITIES = {
  blue: { name: 'Армейское', color: '#7199ff' },
  purple: { name: 'Запрещённое', color: '#b28bff' },
  pink: { name: 'Засекреченное', color: '#e783da' },
  red: { name: 'Тайное', color: '#fb8c83' },
  gold: { name: 'Особое', color: '#e7ca76' },
};
// Weights are out of 10,000. These are custom simulator odds, not Valve odds.
const drops = (entries) => entries.map(([skinId, weight]) => ({ skinId, weight }));
export const CASES = [
  { id: 'rookie', name: 'Первый дроп', subtitle: 'Большая коллекция начинается с малого', price: 150, color: '#a3d8a4', tag: 'ДЛЯ СТАРТА', category: 'classic', featured: 'elite-build', number: '01',
    drops: drops([['capillary',2000],['oxide',1800],['abyss',1600],['elite-build',1400],['ticket',1000],['moonrise',900],['atheris',650],['cortex',400],['mac-neon',200],['neon-rider',50]]) },
  { id: 'neon', name: 'Неоновый рай', subtitle: 'Яркие скины. Громкие попадания.', price: 490, color: '#b496ec', tag: 'ВЫБОР КЛУБА', category: 'themed', featured: 'neon-rider', number: '02',
    drops: drops([['moonrise',2300],['pulse',2100],['vogue',1700],['food-chain',1300],['cortex',1000],['decimator',700],['mac-neon',450],['neon-rider',300],['karambit',150]]) },
  { id: 'asiimov', name: 'Код «Азимов»', subtitle: 'Классика из другого измерения', price: 790, color: '#ecb37b', tag: 'КЛАССИКА CS', category: 'classic', featured: 'awp-asiimov', number: '03',
    drops: drops([['slate',2400],['flashback',1800],['p250-asiimov',2300],['p90-asiimov',1700],['ak-asiimov',1000],['awp-asiimov',650],['m9',150]]) },
  { id: 'noir', name: 'После полуночи', subtitle: 'Тёмная сторона твоего инвентаря', price: 990, color: '#8ebfc7', tag: 'NEO-NOIR', category: 'themed', featured: 'm4-neo-noir', number: '04',
    drops: drops([['ticket',1600],['slate',1800],['redline',2200],['m4-neo-noir',1900],['awp-neo-noir',1300],['kill-confirmed',750],['deagle-printstream',350],['karambit',100]]) },
  { id: 'dragon', name: 'Легенда дракона', subtitle: 'Охота за тем самым Dragon Lore', price: 1490, color: '#e69b81', tag: 'ЛЕГЕНДАРНЫЙ', category: 'premium', featured: 'dragon-lore', number: '05',
    drops: drops([['pit-viper',2000],['atheris',2400],['dragonfire',2400],['awp-asiimov',1700],['blaze',800],['dragon-lore',200],['butterfly',500]]) },
  { id: 'edge', name: 'На острие', subtitle: 'Твой шанс на золотой дроп', price: 2490, color: '#d8cf91', tag: '10% НА НОЖ', category: 'premium', featured: 'butterfly', number: '06',
    drops: drops([['slate',2000],['redline',1800],['ak-asiimov',1700],['m4-printstream',1500],['deagle-printstream',2000],['m9',500],['karambit',300],['butterfly',200]]) },
];
export const CASE_MAP = Object.fromEntries(CASES.map(c => [c.id, c]));
export const DAILY_REWARDS = [500, 600, 700, 800, 900, 1000, 1500];
export const TASKS = [
  { id:'first', title:'Первый шаг', text:'Открой свой первый кейс', target:1, stat:'opened', reward:250 },
  { id:'collector', title:'Войти во вкус', text:'Открой 10 кейсов', target:10, stat:'opened', reward:1000 },
  { id:'trader', title:'Выгодная сделка', text:'Продай 5 скинов', target:5, stat:'sold', reward:600 },
  { id:'club', title:'Резидент клуба', text:'Открой 50 кейсов', target:50, stat:'opened', reward:3000 },
];
