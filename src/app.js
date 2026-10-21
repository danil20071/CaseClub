import { CASES, CASE_MAP, SKINS, SKIN_MAP, RARITIES, DAILY_REWARDS, TASKS } from './catalog.js';
import { STORAGE_KEY, START_BALANCE, initialState, readState, openCase, sellItems, dailyInfo, claimDaily, claimTask, claimRescue } from './engine.js';
import { icon } from './icons.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastEl = document.querySelector('#toast');
const fmt = n => new Intl.NumberFormat('ru-RU').format(n);
const esc = text => String(text).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const money = n => `<span class="money">${icon('coin')}${fmt(n)}</span>`;
let tg;
let state, storageError='', corrupt=false;
try { state=readState(localStorage.getItem(STORAGE_KEY)); }
catch(error) { state=initialState(); storageError=error.message; corrupt=true; }
let route = location.hash.slice(1) || 'cases';
let filter='all', inventoryFilter='all', sort='new', search='', count=1, busy=false, currentResult=[];
let toastTimer, audioContext, spinTimer, lastFocus, queued=false;
let selected = new Set();

function initTelegram() {
  tg=window.Telegram?.WebApp;
  if (!tg) return;
  try {
    tg.ready(); tg.expand();
    if (tg.isVersionAtLeast('6.1')) {tg.setHeaderColor('#111413');tg.setBackgroundColor('#111413');}
    if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor('#111413');
    tg.BackButton?.onClick(()=>navigate('cases'));
    const updateInsets = () => {
      document.documentElement.style.setProperty('--safe-top',`${Math.max(tg.safeAreaInset?.top||0,tg.contentSafeAreaInset?.top||0)}px`);
      document.documentElement.style.setProperty('--safe-bottom',`${tg.safeAreaInset?.bottom||0}px`);
    };
    updateInsets();
    tg.onEvent('safeAreaChanged',updateInsets);tg.onEvent('contentSafeAreaChanged',updateInsets);
  } catch { /* Older Telegram clients still run the browser version. */ }
}
initTelegram();
window.addEventListener('load',()=>{if(!tg){initTelegram();render();}});

function haptic(kind='light') { try { if(tg?.isVersionAtLeast('6.1')) tg.HapticFeedback.impactOccurred(kind); } catch {} }
function sound(kind='tick') {
  if (!state.settings.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if(audioContext.state==='suspended') audioContext.resume();
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.type=kind==='win'?'sine':'triangle';
    osc.frequency.setValueAtTime(kind==='win'?660:420,audioContext.currentTime);
    if(kind==='win')osc.frequency.exponentialRampToValueAtTime(990,audioContext.currentTime+.18);
    gain.gain.setValueAtTime(kind==='win'?.06:.018,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+(kind==='win'?.5:.035));
    osc.start();osc.stop(audioContext.currentTime+(kind==='win'?.55:.04));
  } catch {}
}
function toast(message) {
  clearTimeout(toastTimer);toastEl.innerHTML=`${icon('info')}<span>${esc(message)}</span>`;
  toastEl.classList.add('show');toastTimer=setTimeout(()=>toastEl.classList.remove('show'),4200);
}

// The balance debit and awarded items are persisted together, before animation.
// Web Locks serialize transactions between tabs on HTTPS and localhost.
async function transact(update) {
  const run=()=>{
    if(corrupt) throw new Error('Сначала восстанови или сбрось сохранение в профиле.');
    let latest=state;
    try { const raw=localStorage.getItem(STORAGE_KEY); if(raw) latest=readState(raw); }
    catch(error) { throw new Error('Не удалось прочитать сохранение: '+error.message); }
    const result=update(latest);
    const next=result.state||result;
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); }
    catch { throw new Error('Браузер не разрешил сохранение. Освободи место или разреши хранение данных.'); }
    state=next;
    return result;
  };
  return navigator.locks ? navigator.locks.request('caseclub-transaction',run) : run();
}
window.addEventListener('storage',event=>{
  if(event.key===STORAGE_KEY) {
    try { state=readState(event.newValue);selected.clear();if(!busy)render();else queued=true; }
    catch {toast('Сохранение изменено в другой вкладке. Перезагрузи страницу.');}
  }
});

function navigate(next) {
  if(busy){toast('Кейс открывается — ещё несколько секунд.');return;}
  if(route===next){document.querySelector('#case-list')?.scrollIntoView({behavior:'smooth'});return;}
  location.hash=next;
}
window.addEventListener('hashchange',()=>{
  if(busy){history.replaceState(null,'',`#${route}`);return;}
  route=location.hash.slice(1)||'cases';count=1;selected.clear();closeModal();render();window.scrollTo({top:0});
});

function header() {
  const name=tg?.initDataUnsafe?.user?.first_name || 'Игрок';
  const active=route.startsWith('case/')?'cases':route;
  return `<header class="header"><div class="header-inner">
    <a href="#cases" class="brand" aria-label="CASECLUB — главная"><span class="brand-symbol">${icon('box')}</span>CASE<span>CLUB</span><span class="brand-dot"></span></a>
    <nav class="desktop-nav" aria-label="Основная навигация">${[['cases','box','Кейсы'],['inventory','bag','Инвентарь'],['bonuses','gift','Бонусы']].map(([id,ico,label])=>`<a href="#${id}" class="nav-link ${active===id?'active':''}">${icon(ico)}${label}${id==='bonuses'&&dailyInfo(state).canClaim?'<i class="notification-dot"></i>':''}</a>`).join('')}</nav>
    <div class="header-right"><button class="balance" data-action="balance" aria-label="Баланс ${state.balance} монет. Получить бонусы">${money(state.balance)}<span class="balance-plus">${icon('plus')}</span></button><a href="#profile" class="avatar" aria-label="Профиль: ${esc(name)}">${esc(name.charAt(0).toUpperCase())}</a></div>
  </div></header>`;
}
function mobileNav(){
  const active=route.startsWith('case/')?'cases':route;
  return `<nav class="mobile-nav" aria-label="Мобильная навигация">${[['cases','box','Кейсы'],['inventory','bag','Инвентарь'],['bonuses','gift','Бонусы'],['profile','user','Профиль']].map(([id,ico,label])=>`<a href="#${id}" class="${active===id?'active':''}">${icon(ico)}<span>${label}</span></a>`).join('')}</nav>`;
}
function footer(){return `<footer><div class="footer-brand">${icon('box')} CASECLUB <span>PLAY. COLLECT. REPEAT.</span></div><p>Только виртуальные монеты. Только удовольствие от дропа.</p><button class="text-button" data-action="about">О симуляторе ${icon('external')}</button></footer>`;}

function skinImage(id, cls='', lazy=true) {const s=SKIN_MAP[id];return `<img class="skin-image ${cls}" src="./${s.image}" alt="${esc(s.weapon+' | '+s.name)}" ${lazy?'loading="lazy"':'fetchpriority="high"'} draggable="false" width="512" height="384">`;}
function crate(c) {
  return `<svg class="crate" viewBox="0 0 320 220" aria-hidden="true"><defs><linearGradient id="front-${c.id}" x1="0" y1="0" x2="0.6" y2="1"><stop stop-color="${c.color}" stop-opacity=".65"/><stop offset="1" stop-color="${c.color}" stop-opacity=".18"/></linearGradient><linearGradient id="top-${c.id}" x2="0" y2="1"><stop stop-color="${c.color}" stop-opacity=".85"/><stop offset="1" stop-color="${c.color}" stop-opacity=".25"/></linearGradient></defs><path d="m36 73 192-29 61 36-193 34Z" fill="url(#top-${c.id})" stroke="${c.color}" stroke-opacity=".65"/><path d="m36 73 60 41v88l-60-44Z" fill="${c.color}" opacity=".25" stroke="${c.color}"/><path d="m96 114 193-34v89L96 202Z" fill="url(#front-${c.id})" stroke="${c.color}" stroke-opacity=".65"/><path d="m109 128 167-28v56l-167 29Zm-59-39 31 22v63l-31-23Z" fill="#151a17" opacity=".6" stroke="${c.color}" stroke-opacity=".5"/><path d="m83 67 61 38v92m66-151 60 37v90" fill="none" stroke="#1a211b" stroke-width="12"/><path d="m85 66 61 38m63-58 60 37" fill="none" stroke="${c.color}" stroke-opacity=".7" stroke-width="4"/><path d="m174 125 26-4v14l-26 4Z" fill="#121a16" stroke="${c.color}" stroke-opacity=".7"/><path d="m182 122 11-2v6l-11 2Z" fill="${c.color}"/><text x="160" y="165" transform="rotate(-10 160 165)" fill="${c.color}" font-family="monospace" font-size="11" opacity=".7">CASE / ${c.number}</text><path d="m39 155 55 40m6 4 185-32" fill="none" stroke="${c.color}" stroke-opacity=".6" stroke-width="4"/></svg>`;
}
function caseCard(c){return `<button class="case-card" style="--case-color:${c.color}" data-case="${c.id}" aria-label="Кейс ${c.name}, ${c.price} монет"><div class="case-card-top"><span class="case-tag">${c.tag}</span><span class="card-number">/${c.number}</span></div><div class="case-art"><span class="case-halo"></span><span class="case-cross c1">+</span><span class="case-cross c2">+</span>${crate(c)}${skinImage(c.featured,'case-weapon')}</div><div class="case-card-bottom"><div><h3>${c.name}</h3><p>${c.subtitle}</p></div><span class="case-price">${money(c.price)}${icon('arrow')}</span></div></button>`;}
function home() {
  const last=state.history.slice(0,6);
  return `<div class="home-topline"><span><i class="status-dot"></i> ТВОЙ ЛИЧНЫЙ КЕЙС-КЛУБ</span><span class="sim-label">COUNTER-STRIKE · СИМУЛЯТОР</span></div>
    <section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="small-pill">СЕЗОН 01</span> КОЛЛЕКЦИЯ НАЧИНАЕТСЯ ЗДЕСЬ</div><h1>Твой следующий<br>дроп — <span>легенда.</span></h1><p>Открывай кейсы. Находи редкие скины.<br>Собирай коллекцию, которая говорит за тебя.</p><div class="hero-actions"><button class="primary" data-action="explore">Выбрать кейс ${icon('arrow')}</button><button class="hero-how" data-action="how">${icon('info')} Как это работает</button></div><div class="hero-note">${icon('coin')} <span>${fmt(START_BALANCE)} монет на старте <b>·</b> Всё по-настоящему виртуально</span></div></div>
    <div class="hero-art"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="orbit-label">RARE FIND / 001</span><span class="hero-plus">+</span><span class="hero-plus second">+</span><span class="hero-big-text">RARE</span>${skinImage('karambit','hero-knife',false)}<div class="hero-item-tag"><span class="gold-dot"></span><div><strong>Karambit <span>★</span></strong><small>Doppler · Особое</small></div>${icon('arrow')}</div><span class="hero-coordinate">48° 12′ N / 16° 22′ E</span></div></section>
    <section class="quick-stats" aria-label="Твоя статистика"><div>${icon('box')}<span><strong>${fmt(state.stats.opened)}</strong><small>Открыто кейсов</small></span></div><div>${icon('bag')}<span><strong>${fmt(state.inventory.length)}</strong><small>В твоей коллекции</small></span></div><div>${icon('trophy')}<span><strong>${fmt(state.stats.bestValue)} <span class="stat-unit">C</span></strong><small>Лучший дроп</small></span></div><a href="#bonuses" class="daily-mini">${icon('gift')}<span><strong>${dailyInfo(state).canClaim?'Подарок каждый день':'До встречи завтра'}</strong><small>${dailyInfo(state).canClaim?`Забери +${fmt(dailyInfo(state).reward)} монет`:'Бонус уже в твоём кошельке'}</small></span>${icon('arrow')}</a></section>
    <section class="cases-section" id="case-list"><div class="section-heading"><div><div class="eyebrow">ВЫБЕРИ СВОЁ НАСТРОЕНИЕ</div><h2>Кейсы клуба <span>06</span></h2></div><span class="section-note">${icon('shield')} Шансы открыты. Выбор за тобой.</span></div><div class="filter-bar"><div class="tabs" role="group" aria-label="Категории кейсов">${[['all','Все кейсы'],['classic','Классика'],['themed','Тематические'],['premium','Премиум']].map(([id,label])=>`<button class="tab ${filter===id?'active':''}" data-filter="${id}" aria-pressed="${filter===id}">${label}${id==='all'?'<span>6</span>':''}</button>`).join('')}</div><span class="filter-caption">${icon('filter')} На любой баланс</span></div><div class="cases-grid">${CASES.filter(c=>filter==='all'||c.category===filter).map(caseCard).join('')}</div></section>
    <section class="bonus-banner"><span class="bonus-banner-icon">${icon('gift')}</span><div><span class="eyebrow">ЗАХОДИТЬ КАЖДЫЙ ДЕНЬ — ХОРОШАЯ ПРИВЫЧКА</span><h3>Больше монет. Больше возможностей.</h3><p>Ежедневные подарки и награды за твои первые достижения.</p></div><a class="outline-button" href="#bonuses">Мои бонусы ${icon('arrow')}</a></section>
    <section class="spotlight"><div class="section-heading"><h2>${last.length?'Твои последние дропы':'В центре внимания'} <span>${last.length?'':'THE WISHLIST'}</span></h2>${last.length?'<a href="#inventory" class="text-button">В инвентарь '+icon('arrow')+'</a>':'<span class="section-note">Возможно, следующий — твой</span>'}</div><div class="spotlight-grid">${(last.length?last.map(i=>i.skinId):['neon-rider','awp-asiimov','m4-printstream','butterfly','dragon-lore','deagle-printstream']).map(id=>miniSkin(id)).join('')}</div></section>`;
}
function miniSkin(id) {const s=SKIN_MAP[id];return `<div class="mini-skin" style="--rarity:${RARITIES[s.rarity].color}">${skinImage(id)}<small>${s.weapon}</small><strong>${s.name}</strong><span>${money(s.value)}</span></div>`;}

function casePage(c){
  const total=c.price*count;
  return `<div class="page-top"><a href="#cases" class="back-link">${icon('left')} Все кейсы</a><span class="section-note">КОЛЛЕКЦИЯ / ${c.number}</span></div><div class="case-title"><span class="eyebrow" style="color:${c.color}">${c.tag}</span><h1>${c.name}</h1><p>${c.subtitle}</p></div>
    <section class="opening-panel" style="--case-color:${c.color}"><div class="opening-top"><span><i class="status-dot"></i> <span id="opening-label">ГОТОВ К ОТКРЫТИЮ</span></span><button class="icon-button" data-action="sound" aria-label="${state.settings.sound?'Выключить':'Включить'} звук">${icon(state.settings.sound?'volume':'mute')}</button></div><div class="roulette" id="roulette"><div class="roulette-marker"></div><div class="roulette-track" id="roulette-track">${[...c.drops.slice(0,6),...c.drops.slice(0,6)].map(d=>rouletteCard(d.skinId)).join('')}</div><div class="roulette-fade"></div></div><div class="opening-controls"><div class="quantity" role="group" aria-label="Количество кейсов">${[1,3,5].map(n=>`<button data-count="${n}" class="${count===n?'active':''}" aria-pressed="${count===n}">×${n}</button>`).join('')}</div><button class="primary open-button" data-action="open" ${state.balance<total?'disabled':''}>${icon('box')} Открыть ${count===1?'кейс':`${count} кейса${count===5?'ов':''}`} <span class="button-divider"></span>${money(total)}</button><label class="fast-toggle"><input type="checkbox" id="fast" ${state.settings.fast?'checked':''}>${icon('bolt')} Быстро</label></div><p class="opening-hint">${state.balance<total?`Не хватает ${fmt(total-state.balance)} монет. <a href="#bonuses">Забрать бонусы ${icon('arrow')}</a>`:'Каждый дроп остаётся в твоём инвентаре. Решай сам: продать или сохранить.'}</p></section>
    <div class="section-heading content-heading"><div><div class="eyebrow">ВОЗМОЖНО, ТВОЙ СЛЕДУЮЩИЙ</div><h2>Внутри кейса <span>${c.drops.length}</span></h2></div><button class="text-button" data-action="odds">${icon('info')} Как устроены шансы</button></div><div class="contents-grid">${[...c.drops].sort((a,b)=>SKIN_MAP[b.skinId].value-SKIN_MAP[a.skinId].value).map(d=>{const s=SKIN_MAP[d.skinId];return `<div class="content-card" style="--rarity:${RARITIES[s.rarity].color}"><div class="content-top"><span class="rarity-dot"></span><span>${(d.weight/100).toLocaleString('ru-RU')}%</span></div>${skinImage(s.id)}<small>${s.weapon}</small><h3>${s.name}</h3><div class="content-bottom">${money(s.value)}<small>${RARITIES[s.rarity].name}</small></div></div>`;}).join('')}</div>`;
}
function rouletteCard(id){const s=SKIN_MAP[id];return `<div class="roulette-card" style="--rarity:${RARITIES[s.rarity].color}" data-skin="${id}">${skinImage(id,'',false)}<small>${s.weapon}</small><strong>${s.name}</strong><span class="roulette-rarity"></span></div>`;}

function inventoryPage(){
  const total=state.inventory.reduce((a,i)=>a+SKIN_MAP[i.skinId].value,0);
  return `<div class="page-heading"><div><span class="eyebrow">ТВОЯ ЛИЧНАЯ КОЛЛЕКЦИЯ</span><h1>Инвентарь <span>${state.inventory.length}</span></h1><p>Каждый скин — история одного открытия.</p></div><div class="inventory-value"><span>Стоимость коллекции</span><strong>${money(total)}</strong></div></div>
    <div class="inventory-toolbar"><label class="search">${icon('search')}<input id="inventory-search" placeholder="Найти скин…" value="${esc(search)}" aria-label="Поиск по инвентарю"></label><select id="rarity-filter" aria-label="Фильтр по редкости"><option value="all">Все редкости</option>${Object.entries(RARITIES).map(([id,r])=>`<option value="${id}" ${inventoryFilter===id?'selected':''}>${r.name}</option>`).join('')}</select><select id="inventory-sort" aria-label="Сортировка"><option value="new" ${sort==='new'?'selected':''}>Сначала новые</option><option value="price-desc" ${sort==='price-desc'?'selected':''}>Сначала дорогие</option><option value="price-asc" ${sort==='price-asc'?'selected':''}>Сначала дешёвые</option></select></div>
    <div class="inventory-selection"><label><input type="checkbox" id="select-all"> Выбрать найденные</label><button class="outline-button small" data-action="sell-selected" ${selected.size?'':'disabled'}>Продать выбранное <span id="selected-count">${selected.size?`(${selected.size})`:''}</span></button></div><div id="inventory-items">${inventoryItems()}</div>`;
}
function filteredItems(){
  return state.inventory.filter(i=>{const s=SKIN_MAP[i.skinId];return (inventoryFilter==='all'||s.rarity===inventoryFilter)&&(s.weapon+' '+s.name).toLowerCase().includes(search.toLowerCase());}).sort((a,b)=>sort==='price-desc'?SKIN_MAP[b.skinId].value-SKIN_MAP[a.skinId].value:sort==='price-asc'?SKIN_MAP[a.skinId].value-SKIN_MAP[b.skinId].value:b.at-a.at);
}
function inventoryItems(){
  const items=filteredItems();
  if(!items.length)return `<div class="empty-state"><span class="empty-icon">${icon(state.inventory.length?'search':'bag')}</span><h2>${state.inventory.length?'Ничего не нашлось':'Место для первого трофея'}</h2><p>${state.inventory.length?'Попробуй другое название или редкость.':'Открой кейс, и твой первый скин появится здесь.'}</p>${state.inventory.length?'<button class="outline-button" data-action="clear-filters">Сбросить фильтры</button>':'<a href="#cases" class="primary">Выбрать кейс '+icon('arrow')+'</a>'}</div>`;
  return `<div class="inventory-grid">${items.map(i=>{const s=SKIN_MAP[i.skinId];return `<article class="content-card inventory-card ${selected.has(i.uid)?'selected':''}" style="--rarity:${RARITIES[s.rarity].color}"><div class="content-top"><span class="rarity-label"><i class="rarity-dot"></i>${RARITIES[s.rarity].name}</span><input type="checkbox" data-select="${esc(i.uid)}" ${selected.has(i.uid)?'checked':''} aria-label="Выбрать ${esc(s.weapon+' '+s.name)}"></div>${skinImage(s.id)}<small>${s.weapon}</small><h3>${s.name}</h3><button class="sell-button" data-sell="${esc(i.uid)}">Продать ${money(s.value)}</button></article>`;}).join('')}</div>`;
}
function refreshInventory(){document.querySelector('#inventory-items').innerHTML=inventoryItems();updateSelection();}
function updateSelection(){
  const btn=document.querySelector('[data-action="sell-selected"]');if(!btn)return;
  btn.disabled=!selected.size;document.querySelector('#selected-count').textContent=selected.size?`(${selected.size})`:'';
  const all=document.querySelector('#select-all'),items=filteredItems();
  all.checked=items.length>0&&items.every(i=>selected.has(i.uid));all.indeterminate=items.some(i=>selected.has(i.uid))&&!all.checked;
}

function bonusPage(){
  const info=dailyInfo(state);
  const nextTime=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(info.nextAt);
  return `<div class="page-heading"><div><span class="eyebrow">КЛУБ ЗАБОТИТСЯ О СВОИХ</span><h1>Бонусы и задания</h1><p>Возвращайся за подарками. Собирай больше.</p></div><span class="page-heading-icon">${icon('gift')}</span></div><section class="daily-panel"><div class="daily-heading"><div><span class="eyebrow">7 ДНЕЙ — 7 ПОДАРКОВ</span><h2>Твоя ежедневная порция удачи</h2><p>Заходи каждый день: серия растёт, а с ней и награда.</p></div><span class="streak-pill">${icon('bolt')} День ${info.streak} / 7</span></div><div class="daily-grid">${DAILY_REWARDS.map((reward,i)=>{const claimed=info.canClaim?i+1<info.streak:i+1<=info.streak;const active=i+1===info.streak;return `<div class="daily-day ${claimed?'claimed':''} ${active?'current':''}"><span>День ${i+1}</span>${icon(claimed?'check':i===6?'gift':'coin')}<strong>+${fmt(reward)}</strong>${active?`<small>${info.canClaim?'СЕГОДНЯ':'ПОЛУЧЕНО'}</small>`:''}</div>`;}).join('')}</div><div class="daily-bottom"><p>${icon('clock')} ${info.canClaim?'Забери подарок сегодня и продолжи серию завтра.':`Следующий подарок — в ${nextTime} по времени твоего устройства.`}</p><button class="primary" data-action="daily" ${info.canClaim?'':'disabled'}>${icon(info.canClaim?'gift':'check')} ${info.canClaim?`Забрать ${fmt(info.reward)} монет`:'Бонус получен'}</button></div></section>
    <div class="section-heading"><h2>Маленькие шаги. Большие бонусы.</h2></div><div class="tasks-grid">${TASKS.map(t=>{const got=state.claimed.includes(t.id),progress=Math.min(state.stats[t.stat],t.target),done=progress>=t.target;return `<article class="task-card"><span class="task-icon">${icon(got?'check':t.stat==='sold'?'coin':t.target===1?'box':'trophy')}</span><div class="task-body"><h3>${t.title}</h3><p>${t.text}</p><div class="task-progress"><span style="width:${progress/t.target*100}%"></span></div><small>${progress} / ${t.target}</small></div><button class="${done&&!got?'primary':'task-reward'} small" data-task="${t.id}" ${!done||got?'disabled':''}>${got?icon('check')+'Получено':done?'Забрать '+money(t.reward):'+'+money(t.reward)}</button></article>`;}).join('')}</div>
    <section class="rescue-panel">${icon('heart')}<div><h3>Начать снова — тоже ход</h3><p>Если монет меньше 150 и инвентарь пуст, клуб подарит 300 монет.</p></div><button class="outline-button small" data-action="rescue" ${state.balance<150&&!state.inventory.length?'':'disabled'}>Поддержка клуба ${icon('arrow')}</button></section>`;
}
function profilePage(){
  const name=tg?.initDataUnsafe?.user?.first_name||'Игрок';const level=Math.floor(state.stats.opened/10)+1;
  return `<div class="page-heading"><div><span class="eyebrow">ТВОЁ МЕСТО В КЛУБЕ</span><h1>Профиль</h1></div></div><section class="profile-card"><span class="profile-avatar">${esc(name.charAt(0).toUpperCase())}</span><div><h2>${esc(name)}</h2><p>${tg?.initData?'В Telegram':'Резидент CASECLUB'} · Уровень ${level}</p><div class="level-progress"><span style="width:${state.stats.opened%10*10}%"></span></div><small>${state.stats.opened%10} / 10 кейсов до следующего уровня</small></div><span class="level-badge">${icon('star')} ${level}</span></section><div class="profile-stats">${[['box',state.stats.opened,'Кейсов открыто'],['bag',state.stats.sold,'Скинов продано'],['coin',state.stats.earned,'Монет с продажи'],['trophy',state.stats.bestValue,'Лучший дроп']].map(([i,n,l])=>`<div>${icon(i)}<strong>${fmt(n)}</strong><span>${l}</span></div>`).join('')}</div>
    <div class="profile-columns"><section class="settings-panel"><h2>Твои настройки</h2><label class="setting-row"><span>${icon('volume')}<span><strong>Звук открытия</strong><small>Атмосфера хорошего дропа</small></span></span><input type="checkbox" id="sound-setting" role="switch" ${state.settings.sound?'checked':''}></label><label class="setting-row"><span>${icon('bolt')}<span><strong>Быстрое открытие</strong><small>Меньше ожидания, больше коллекции</small></span></span><input type="checkbox" id="fast-setting" role="switch" ${state.settings.fast?'checked':''}></label></section><section class="settings-panel"><h2>Сохранение прогресса</h2><p class="muted">Коллекция хранится в этом браузере. Скачай резервную копию, чтобы перенести её на другое устройство.</p><div class="backup-buttons"><button class="outline-button small" data-action="export">${icon('download')} Скачать</button><button class="outline-button small" data-action="import">${icon('upload')} Восстановить</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><button class="text-button reset-button" data-action="reset">${icon('trash')} Начать заново</button></section></div>
    <section class="about-panel"><span class="brand small-brand">${icon('box')} CASECLUB</span><p>Независимый фанатский симулятор Counter-Strike. Скины и монеты существуют только внутри приложения. Цены и вероятности вымышлены; обмена на деньги или предметы Steam нет.</p><button class="text-button" data-action="about">Подробнее о проекте ${icon('arrow')}</button></section>`;
}

function render(){
  const valid=['cases','inventory','bonuses','profile'].includes(route)||(route.startsWith('case/')&&CASE_MAP[route.split('/')[1]]);
  if(!valid){route='cases';history.replaceState(null,'','#cases');}
  const view=route==='cases'?home():route==='inventory'?inventoryPage():route==='bonuses'?bonusPage():route==='profile'?profilePage():casePage(CASE_MAP[route.split('/')[1]]);
  app.innerHTML=header()+`<main id="main">${storageError?`<div class="storage-warning">${icon('info')} ${esc(storageError)} <a href="#profile">К сохранению</a></div>`:''}${view}</main>`+footer()+mobileNav();
  if(route==='inventory')updateSelection();
  if(route.startsWith('case/'))centerIdleRoulette();
  try {if(tg?.isVersionAtLeast('6.1'))route==='cases'?tg.BackButton.hide():tg.BackButton.show();}catch{}
  document.title=`${route==='inventory'?'Инвентарь':route==='bonuses'?'Бонусы':route==='profile'?'Профиль':route.startsWith('case/')?CASE_MAP[route.split('/')[1]].name:'Твой следующий дроп'} — CASECLUB`;
}
function centerIdleRoulette(){requestAnimationFrame(()=>{const track=document.querySelector('#roulette-track');if(track&&!busy)track.style.transform='translateX(-120px)';});}

function showModal(html,cls=''){
  if(modal.open)modal.close();lastFocus=document.activeElement;
  modal.className=cls;modal.innerHTML=`<button class="modal-close icon-button" data-action="close" aria-label="Закрыть">${icon('close')}</button>${html}`;
  modal.showModal();
}
function closeModal(){if(modal.open)modal.close();}
modal.addEventListener('close',()=>{if(lastFocus?.isConnected)lastFocus.focus();});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
function resultModal(items){
  currentResult=items;const total=items.reduce((a,i)=>a+SKIN_MAP[i.skinId].value,0);const top=items.reduce((a,b)=>SKIN_MAP[a.skinId].value>SKIN_MAP[b.skinId].value?a:b);
  const s=SKIN_MAP[top.skinId],rarity=RARITIES[s.rarity];
  const single=items.length===1;
  showModal(`<div class="result-heading"><span class="eyebrow">${['gold','red'].includes(s.rarity)?'ВОТ ЭТО ПОПАДАНИЕ':'ЕЩЁ ОДИН В КОЛЛЕКЦИЮ'}</span><h2 id="modal-title">${single?'Твой новый дроп':'Твои новые дропы'}</h2></div>${single?`<div class="result-showcase" style="--rarity:${rarity.color}"><span class="result-rays"></span>${skinImage(s.id,'',false)}<span class="rarity-pill">${rarity.name}</span></div><div class="result-name"><p>${s.weapon}</p><h3>${s.name}</h3><span>${money(s.value)}</span></div>`:`<div class="result-grid">${items.map(i=>miniSkin(i.skinId)).join('')}</div>`}<div class="result-actions"><button class="primary" data-action="sell-result">Продать ${single?'':'всё'} за ${money(total)}</button><button class="outline-button" data-action="keep">${icon('bag')} Оставить в инвентаре</button></div><p class="modal-footnote">Предмет${single?' уже сохранён':'ы уже сохранены'} в твоём инвентаре</p>`,'result-modal');
}
function confirmSell(ids){
  const items=state.inventory.filter(i=>ids.includes(i.uid));if(!items.length)return toast('Выбери скины для продажи.');
  currentResult=items;const total=items.reduce((a,i)=>a+SKIN_MAP[i.skinId].value,0);
  showModal(`<span class="modal-symbol">${icon('coin')}</span><h2 id="modal-title">Продать ${items.length===1?'скин':`${items.length} предметов`}?</h2><p class="muted">Предметы покинут коллекцию, а ${fmt(total)} игровых монет пополнят твой баланс.</p><div class="confirmation-preview">${items.slice(0,3).map(i=>skinImage(i.skinId)).join('')}</div><div class="dialog-actions"><button class="outline-button" data-action="close">Оставить</button><button class="primary" data-action="confirm-sell">Продать ${money(total)}</button></div>`);
}
async function doSell(items){const result=await transact(s=>sellItems(s,items.map(i=>i.uid)));selected.clear();closeModal();render();haptic('medium');sound('win');toast(`Продано: ${result.count}. +${fmt(result.total)} монет на баланс.`);}

async function spin(){
  if(busy)return;busy=true;sound('tick');
  const c=CASE_MAP[route.split('/')[1]];
  try {
    const result=await transact(s=>openCase(s,c.id,count));
    const track=document.querySelector('#roulette-track'),viewport=document.querySelector('#roulette');
    document.querySelector('.balance .money').outerHTML=money(state.balance);
    document.querySelector('#opening-label').textContent='ИЩЕМ ТВОЙ СЛЕДУЮЩИЙ ДРОП';
    document.querySelectorAll('.opening-controls button,.opening-controls input').forEach(el=>el.disabled=true);
    const openButton=document.querySelector('[data-action="open"]');openButton.innerHTML=`<span class="loading-dot"></span> Открываем ${count===1?'кейс':`${count} кейсов`}…`;
    const winnerIndex=35;const reel=Array.from({length:43},()=>c.drops[Math.floor(Math.random()*c.drops.length)].skinId);reel[winnerIndex]=result.items[0].skinId;
    track.innerHTML=reel.map(rouletteCard).join('');track.style.transform='translateX(0)';viewport.classList.add('spinning');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const winner=track.children[winnerIndex];const target=viewport.clientWidth/2-winner.offsetLeft-winner.offsetWidth/2;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration=reduced?60:state.settings.fast?1000:4800;
    const animation=track.animate([{transform:'translateX(0)'},{transform:`translateX(${target}px)`}],{duration,easing:'cubic-bezier(.12,.65,.16,1)',fill:'forwards'});
    let tick=0;spinTimer=setInterval(()=>{if(++tick%2===0)haptic();sound();},duration>1200?140:90);
    await animation.finished.catch(()=>{});clearInterval(spinTimer);haptic('heavy');sound('win');
    winner.classList.add('winner');viewport.classList.remove('spinning');
    await new Promise(resolve=>setTimeout(resolve,reduced?0:350));
    busy=false;render();resultModal(result.items);queued=false;
  } catch(error){clearInterval(spinTimer);busy=false;render();toast(error.message);}
}

const actions={
  explore:()=>document.querySelector('#case-list')?.scrollIntoView({behavior:'smooth'}),
  balance:()=>navigate('bonuses'),
  close:closeModal,
  open:spin,
  sound:async()=>{await transact(s=>({...s,settings:{...s.settings,sound:!s.settings.sound}}));render();},
  keep:()=>{closeModal();toast('Сохранено. Твой дроп ждёт в инвентаре.');},
  'sell-result':()=>doSell(currentResult),
  'confirm-sell':()=>doSell(currentResult),
  'sell-selected':()=>confirmSell([...selected]),
  'clear-filters':()=>{inventoryFilter='all';search='';selected.clear();render();},
  daily:async()=>{let reward;await transact(s=>{reward=dailyInfo(s).reward;return claimDaily(s);});render();haptic('medium');sound('win');toast(`Подарок клуба: +${fmt(reward)} монет!`);},
  rescue:async()=>{await transact(claimRescue);render();toast('Клуб рядом. +300 монет на новый старт.');},
  how:()=>showModal(`<span class="modal-symbol">${icon('box')}</span><h2 id="modal-title">Три шага до твоей коллекции</h2><div class="how-steps"><div><b>01</b><span><strong>Выбери кейс</strong><p>У каждого — свой характер, цена и набор скинов.</p></span></div><div><b>02</b><span><strong>Поймай свой дроп</strong><p>Открой кейс за монеты. Шанс каждого предмета указан в его карточке.</p></span></div><div><b>03</b><span><strong>Собирай или продавай</strong><p>Оставь скин себе или продай за монеты для новых открытий.</p></span></div></div><button class="primary full-width" data-action="close">Всё понятно ${icon('arrow')}</button>`),
  odds:()=>showModal(`<span class="modal-symbol">${icon('shield')}</span><h2 id="modal-title">Никаких скрытых шансов</h2><p class="muted">На каждой карточке указан шанс выпадения именно этого скина. Сумма шансов в кейсе — 100%.</p><p class="muted">Каждое открытие независимо. Предыдущие результаты, скорость анимации и количество кейсов не меняют вероятности. Нож может выпасть, но не гарантируется даже после множества открытий.</p><p class="muted">Это авторские кейсы симулятора. Их содержимое, цены и шансы отличаются от Counter-Strike.</p><button class="primary full-width" data-action="close">Понятно</button>`),
  about:()=>showModal(`<span class="modal-symbol">${icon('box')}</span><h2 id="modal-title">Просто удовольствие от коллекции.</h2><p class="muted">CASECLUB — независимый фанатский симулятор открытия кейсов. Здесь нет пополнений за деньги, вывода средств, торгов со Steam или реальных предметов.</p><p class="muted">Все цены — игровые. Прогресс хранится на твоём устройстве; резервная копия доступна в профиле. Сброс данных браузера без копии удалит коллекцию.</p><p class="muted">Counter-Strike и изображения предметов принадлежат Valve. Проект не связан с Valve. Метаданные: <a href="https://github.com/ByMykel/CSGO-API" target="_blank" rel="noopener noreferrer">ByMykel / CSGO-API</a>.</p><button class="primary full-width" data-action="close">Продолжить</button>`),
  export:()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`caseclub-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);toast('Сохранение скачано. Храни его в надёжном месте.');},
  import:()=>document.querySelector('#import-file').click(),
  reset:()=>showModal(`<span class="modal-symbol danger">${icon('trash')}</span><h2 id="modal-title">Новая коллекция с нуля?</h2><p class="muted">Скины, история и достижения на этом устройстве будут удалены. На балансе снова будет ${fmt(START_BALANCE)} монет. Перед сбросом можно скачать сохранение в профиле.</p><div class="dialog-actions"><button class="outline-button" data-action="close">Отмена</button><button class="danger-button" data-action="confirm-reset">Начать заново</button></div>`),
  'confirm-reset':async()=>{const run=()=>{const fresh=initialState();localStorage.setItem(STORAGE_KEY,JSON.stringify(fresh));state=fresh;corrupt=false;storageError='';};if(navigator.locks)await navigator.locks.request('caseclub-transaction',run);else run();selected.clear();closeModal();render();toast('Чистый старт. Твоя новая коллекция ждёт.');},
};

document.addEventListener('click',async e=>{
  const btn=e.target.closest('button,a');if(!btn)return;
  if(busy && (btn.hasAttribute('data-action')||btn.hash||btn.dataset.case)){e.preventDefault();return;}
  try {
    if(btn.dataset.case)navigate(`case/${btn.dataset.case}`);
    else if(btn.dataset.filter){filter=btn.dataset.filter;const y=window.scrollY;render();window.scrollTo(0,y);}
    else if(btn.dataset.count){count=Number(btn.dataset.count);render();}
    else if(btn.dataset.sell)confirmSell([btn.dataset.sell]);
    else if(btn.dataset.task){await transact(s=>claimTask(s,btn.dataset.task));render();sound('win');toast('Задание выполнено. Награда уже на балансе!');}
    else if(btn.dataset.action&&actions[btn.dataset.action]){btn.disabled=true;await actions[btn.dataset.action]();if(btn.isConnected)btn.disabled=false;}
  } catch(error){toast(error.message||'Не удалось выполнить действие. Попробуй ещё раз.');if(btn.isConnected)btn.disabled=false;}
});
document.addEventListener('input',e=>{if(e.target.id==='inventory-search'){search=e.target.value;selected.clear();refreshInventory();}});
document.addEventListener('change',async e=>{
  const input=e.target;
  try {
    if(['fast','fast-setting','sound-setting'].includes(input.id)){const key=input.id==='sound-setting'?'sound':'fast';await transact(s=>({...s,settings:{...s.settings,[key]:input.checked}}));}
    else if(input.id==='rarity-filter'){inventoryFilter=input.value;selected.clear();refreshInventory();}
    else if(input.id==='inventory-sort'){sort=input.value;refreshInventory();}
    else if(input.dataset.select){input.checked?selected.add(input.dataset.select):selected.delete(input.dataset.select);input.closest('.inventory-card').classList.toggle('selected',input.checked);updateSelection();}
    else if(input.id==='select-all'){filteredItems().forEach(i=>input.checked?selected.add(i.uid):selected.delete(i.uid));refreshInventory();}
    else if(input.id==='import-file'&&input.files[0]){
      const file=input.files[0];if(file.size>1500000)throw new Error('Файл слишком большой. Выбери резервную копию CASECLUB.');
      const imported=readState(await file.text());
      showModal(`<span class="modal-symbol">${icon('upload')}</span><h2 id="modal-title">Восстановить коллекцию?</h2><p class="muted">В файле: ${fmt(imported.balance)} монет и ${imported.inventory.length} предметов. Это заменит текущий прогресс.</p><div class="dialog-actions"><button class="outline-button" data-action="close">Отмена</button><button class="primary" id="confirm-import">Восстановить</button></div>`);
      document.querySelector('#confirm-import').addEventListener('click',async()=>{
        try {const run=()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(imported));state=imported;corrupt=false;storageError='';};if(navigator.locks)await navigator.locks.request('caseclub-transaction',run);else run();closeModal();selected.clear();render();toast('Коллекция восстановлена. Добро пожаловать обратно!');}catch{toast('Не удалось сохранить копию в этом браузере.');}
      },{once:true});input.value='';
    }
  } catch(error){toast(error.message);if(input.type==='checkbox')input.checked=!input.checked;}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy&&!modal.open)render();});
setInterval(()=>{if(!busy&&!modal.open&&route==='bonuses'&&dailyInfo(state).canClaim&&document.querySelector('[data-action="daily"]')?.disabled)render();},30000);
render();
