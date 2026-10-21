import { SKIN_MAP, CASE_MAP, DAILY_REWARDS, TASKS } from './catalog.js';

export const STORAGE_KEY = 'caseclub:v1';
export const START_BALANCE = 2500;
export const MAX_INVENTORY = 500;
const DAY = 86400000;
const integer = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;
export const dayNumber = (now = Date.now()) => Math.floor(now / DAY);
export function initialState() {
  return { version:1, balance:START_BALANCE, inventory:[], history:[], stats:{opened:0,sold:0,earned:0,bestValue:0}, daily:{day:null,streak:0}, claimed:[], settings:{sound:true,fast:false} };
}

export function readState(raw) {
  if (!raw) return initialState();
  let s;
  try { s = JSON.parse(raw); } catch { throw new Error('Сохранение повреждено. Можно восстановить резервную копию в профиле.'); }
  const validItem = i => i && typeof i.uid === 'string' && i.uid.length < 120 && SKIN_MAP[i.skinId] && integer(i.at) && CASE_MAP[i.caseId];
  if (!s || s.version !== 1 || !integer(s.balance) || !Array.isArray(s.inventory) || s.inventory.length > MAX_INVENTORY || !s.inventory.every(validItem) || new Set(s.inventory.map(i=>i.uid)).size !== s.inventory.length || !s.stats || !['opened','sold','earned','bestValue'].every(k=>integer(s.stats[k])) || !s.daily || !(s.daily.day === null || integer(s.daily.day)) || !integer(s.daily.streak,7) || !Array.isArray(s.claimed) || !s.claimed.every(id=>TASKS.some(t=>t.id===id))) {
    throw new Error('Не удалось прочитать сохранение. Нужна резервная копия CASECLUB.');
  }
  // Copy only known fields. Imported files never provide skin prices or executable markup.
  const cleanItem = i => ({uid:i.uid,skinId:i.skinId,at:i.at,caseId:i.caseId});
  return { version:1, balance:s.balance, inventory:s.inventory.map(cleanItem), history:Array.isArray(s.history) ? s.history.filter(validItem).slice(0,40).map(cleanItem) : [], stats:{opened:s.stats.opened,sold:s.stats.sold,earned:s.stats.earned,bestValue:s.stats.bestValue}, daily:{day:s.daily.day,streak:s.daily.streak}, claimed:[...new Set(s.claimed)], settings:{sound:s.settings?.sound !== false,fast:s.settings?.fast === true} };
}

export function randomUnit() {
  const data = new Uint32Array(1);
  globalThis.crypto.getRandomValues(data);
  return data[0] / 4294967296;
}

export function chooseDrop(caseId, random = randomUnit) {
  const c = CASE_MAP[caseId];
  if (!c) throw new Error('Кейс не найден.');
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Некорректное случайное число.');
  const total = c.drops.reduce((sum,d)=>sum+d.weight,0);
  const point = roll * total;
  let cumulative = 0;
  for (const d of c.drops) { cumulative += d.weight; if (point < cumulative) return d.skinId; }
  return c.drops.at(-1).skinId;
}

export function openCase(state, caseId, count = 1, random = randomUnit, now = Date.now()) {
  const c = CASE_MAP[caseId];
  if (!c || ![1,3,5].includes(count)) throw new Error('Выбери кейс и количество открытий.');
  if (state.balance < c.price * count) throw new Error('Не хватает монет. Продай скины или забери бонус.');
  if (state.inventory.length + count > MAX_INVENTORY) throw new Error('Инвентарь заполнен. Продай несколько скинов.');
  const items = Array.from({length:count}, () => ({uid:globalThis.crypto.randomUUID(),skinId:chooseDrop(caseId,random),caseId,at:now}));
  return { state:{...state, balance:state.balance-c.price*count, inventory:[...items,...state.inventory], history:[...items,...state.history].slice(0,40), stats:{...state.stats,opened:state.stats.opened+count,bestValue:Math.max(state.stats.bestValue,...items.map(i=>SKIN_MAP[i.skinId].value))}}, items };
}

export function sellItems(state, ids) {
  const unique = new Set(ids);
  const sold = state.inventory.filter(i=>unique.has(i.uid));
  if (!sold.length) throw new Error('Эти предметы уже проданы.');
  const total = sold.reduce((sum,i)=>sum+SKIN_MAP[i.skinId].value,0);
  return { state:{...state,balance:state.balance+total,inventory:state.inventory.filter(i=>!unique.has(i.uid)),stats:{...state.stats,sold:state.stats.sold+sold.length,earned:state.stats.earned+total}},total,count:sold.length };
}

export function dailyInfo(state, now = Date.now()) {
  const today = dayNumber(now);
  const canClaim = state.daily.day === null || state.daily.day < today;
  const nextStreak = state.daily.day === today-1 ? state.daily.streak % 7 + 1 : 1;
  const streak = canClaim ? nextStreak : state.daily.streak;
  return {canClaim,streak,reward:DAILY_REWARDS[streak-1] ?? DAILY_REWARDS[0],nextAt:(today+1)*DAY};
}
export function claimDaily(state, now = Date.now()) {
  const info = dailyInfo(state,now);
  if (!info.canClaim) throw new Error('Сегодняшний бонус уже получен. Возвращайся завтра!');
  return {...state,balance:state.balance+info.reward,daily:{day:dayNumber(now),streak:info.streak}};
}
export function claimTask(state, taskId) {
  const task = TASKS.find(t=>t.id===taskId);
  if (!task || state.claimed.includes(taskId) || state.stats[task.stat] < task.target) throw new Error('Это задание пока нельзя забрать.');
  return {...state,balance:state.balance+task.reward,claimed:[...state.claimed,taskId]};
}
// A soft landing keeps the simulator playable if the player runs out of coins.
export function claimRescue(state) {
  if (state.balance >= 150 || state.inventory.length) throw new Error('Поддержка доступна при балансе ниже 150 и пустом инвентаре.');
  return {...state,balance:state.balance+300};
}
