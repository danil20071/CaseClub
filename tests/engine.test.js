import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CASES, CASE_MAP, SKIN_MAP, SKINS } from '../src/catalog.js';
import { START_BALANCE, MAX_INVENTORY, initialState, readState, randomUnit, chooseDrop, openCase, sellItems, dailyInfo, claimDaily, claimTask, claimRescue } from '../src/engine.js';

test('Every case has real assets, unique drops and exactly 100% odds',()=>{
  assert.equal(CASES.length,6);
  for(const c of CASES){
    assert.equal(c.drops.reduce((a,d)=>a+d.weight,0),10000,c.id);
    assert.equal(new Set(c.drops.map(d=>d.skinId)).size,c.drops.length);
    for(const d of c.drops){assert.ok(d.weight>0);assert.ok(SKIN_MAP[d.skinId]);}
  }
  for(const s of SKINS){assert.ok(existsSync(new URL('../'+s.image,import.meta.url)),s.id);assert.ok(Number.isInteger(s.value)&&s.value>0);}
});

test('Weighted choice respects every exact interval boundary',()=>{
  for(const c of CASES){
    let total=0;
    for(const drop of c.drops){
      assert.equal(chooseDrop(c.id,()=>total/10000),drop.skinId);
      assert.equal(chooseDrop(c.id,()=>(total+drop.weight-.001)/10000),drop.skinId);
      total+=drop.weight;
    }
    assert.equal(chooseDrop(c.id,()=>.9999999999),c.drops.at(-1).skinId);
  }
  for(const invalid of [NaN,Infinity,-.1,1])assert.throws(()=>chooseDrop('rookie',()=>invalid));
});

test('Crypto random units always belong to the required range',()=>{
  for(let i=0;i<1000;i++){const n=randomUnit();assert.ok(n>=0&&n<1);}
});

test('Opening is an immutable atomic debit and inventory award',()=>{
  const before=initialState();const snapshot=JSON.stringify(before);
  const result=openCase(before,'neon',3,()=>.99,1000);
  assert.equal(JSON.stringify(before),snapshot);
  assert.equal(result.state.balance,START_BALANCE-CASE_MAP.neon.price*3);
  assert.equal(result.items.length,3);assert.equal(result.state.stats.opened,3);
  assert.equal(result.state.inventory.length,3);assert.equal(result.state.history.length,3);
  assert.equal(new Set(result.items.map(i=>i.uid)).size,3);
  assert.ok(result.items.every(i=>i.skinId==='karambit'));
  assert.equal(result.state.stats.bestValue,SKIN_MAP.karambit.value);
  assert.deepEqual(readState(JSON.stringify(result.state)),result.state);
});

test('Insufficient funds, invalid count/case and full inventory never mutate state',()=>{
  const before=initialState();const snapshot=JSON.stringify(before);
  assert.throws(()=>openCase(before,'edge',3));
  assert.throws(()=>openCase(before,'missing'));
  assert.throws(()=>openCase(before,'rookie',2));
  assert.equal(JSON.stringify(before),snapshot);
  const item=openCase(before,'rookie',1,()=>0,1000).items[0];
  const full={...before,inventory:Array.from({length:MAX_INVENTORY},(_,n)=>({...item,uid:String(n)}))};
  assert.throws(()=>openCase(full,'rookie'));
});

test('Award is recoverable immediately, even if opening animation is interrupted',()=>{
  const result=openCase(initialState(),'rookie',1,()=>.9999,1000);
  const restored=readState(JSON.stringify(result.state));
  assert.equal(restored.inventory[0].skinId,'neon-rider');
  assert.equal(restored.balance,START_BALANCE-150);
  assert.equal(restored.stats.opened,1);
});

test('Selling credits the catalog value once and rejects a repeated sale',()=>{
  const opened=openCase(initialState(),'rookie',1,()=>0,1000);
  const id=opened.items[0].uid;
  const sold=sellItems(opened.state,[id,id]);
  assert.equal(sold.count,1);assert.equal(sold.total,SKIN_MAP.capillary.value);
  assert.equal(sold.state.balance,opened.state.balance+sold.total);
  assert.equal(sold.state.stats.sold,1);assert.equal(sold.state.stats.earned,sold.total);
  assert.equal(sold.state.inventory.length,0);
  assert.equal(sold.state.history.length,1);
  assert.throws(()=>sellItems(sold.state,[id]));
});

test('Bulk sale ignores missing IDs and leaves unselected inventory intact',()=>{
  const opened=openCase(initialState(),'rookie',3,()=>0,1000);
  const result=sellItems(opened.state,[opened.items[0].uid,opened.items[2].uid,'unknown']);
  assert.equal(result.count,2);assert.equal(result.state.inventory.length,1);
  assert.equal(result.state.inventory[0].uid,opened.items[1].uid);
});

test('Daily gift cannot be claimed twice and advances at UTC midnight',()=>{
  const now=Date.UTC(2026,9,21,23,59,59);
  const claimed=claimDaily(initialState(),now);
  assert.equal(claimed.balance,3000);assert.equal(claimed.daily.streak,1);
  assert.throws(()=>claimDaily(claimed,now));
  assert.equal(dailyInfo(claimed,now).canClaim,false);
  const second=claimDaily(claimed,now+1000);
  assert.equal(second.balance,3600);assert.equal(second.daily.streak,2);
});

test('Daily streak resets after a missed day and cycles after day seven',()=>{
  const start=Date.UTC(2026,9,21);let state=initialState();
  for(let n=0;n<7;n++)state=claimDaily(state,start+n*86400000);
  assert.equal(state.daily.streak,7);
  assert.equal(state.balance,START_BALANCE+6000);
  const eighth=claimDaily(state,start+7*86400000);assert.equal(eighth.daily.streak,1);
  const missed=claimDaily(state,start+9*86400000);assert.equal(missed.daily.streak,1);
  assert.throws(()=>claimDaily(state,start));
});

test('Tasks only pay after completion and cannot pay twice',()=>{
  assert.throws(()=>claimTask(initialState(),'first'));
  const opened=openCase(initialState(),'rookie',1,()=>0);
  const claimed=claimTask(opened.state,'first');
  assert.equal(claimed.balance,opened.state.balance+250);
  assert.throws(()=>claimTask(claimed,'first'));
  assert.throws(()=>claimTask(claimed,'missing'));
});

test('Rescue prevents a soft lock and is unavailable while any asset remains',()=>{
  assert.throws(()=>claimRescue(initialState()));
  assert.equal(claimRescue({...initialState(),balance:149}).balance,449);
  const opened=openCase(initialState(),'rookie',1,()=>0);
  assert.throws(()=>claimRescue({...opened.state,balance:0}));
});

test('Malformed or incompatible backups are rejected without silently resetting',()=>{
  assert.throws(()=>readState('{bad json'));
  assert.throws(()=>readState('null'));
  for(const patch of [{balance:-1},{balance:Infinity},{version:2},{stats:{}},{inventory:[{uid:'a',skinId:'invented'}]},{daily:{day:-1,streak:1}},{claimed:['unknown']}]){
    assert.throws(()=>readState(JSON.stringify({...initialState(),...patch})));
  }
  const opened=openCase(initialState(),'rookie',1,()=>0,1000).state;
  assert.throws(()=>readState(JSON.stringify({...opened,inventory:[...opened.inventory,...opened.inventory]})));
});

test('Backup import discards custom prices and unknown properties',()=>{
  const opened=openCase(initialState(),'rookie',1,()=>0,1000).state;
  opened.inventory[0].value=999999;opened.surprise='ignored';
  const restored=readState(JSON.stringify(opened));
  assert.equal(restored.surprise,undefined);assert.equal(restored.inventory[0].value,undefined);
  assert.equal(sellItems(restored,[restored.inventory[0].uid]).total,30);
});

test('History stays bounded while inventory and statistics stay accurate',()=>{
  let state={...initialState(),balance:100000};
  for(let i=0;i<10;i++)state=openCase(state,'rookie',5,()=>0,1000+i).state;
  assert.equal(state.inventory.length,50);assert.equal(state.stats.opened,50);assert.equal(state.history.length,40);
  assert.equal(state.history[0].at,1009);
});

test('Deployment uses relative asset paths and no dependency install is needed',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.includes('src="./src/app.js"'));
  assert.ok(html.includes('href="./src/styles.css"'));
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(!pkg.dependencies);assert.ok(!pkg.devDependencies);
});
