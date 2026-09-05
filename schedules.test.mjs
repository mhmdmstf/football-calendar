import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSchedule,validateSchedule} from './schedules.mjs';

const now='2026-04-01T12:00:00Z';
const valid={events:[{id:'123',date:'2026-09-05T16:00Z',season:{year:2026,type:2},competitions:[{timeValid:true,competitors:[]}]}]};
const good=()=>({ok:true,json:async()=>valid});

for(const [name,bad] of [
  ['incomplete event',()=>({ok:true,json:async()=>({events:[{id:'123'}]})})],
  ['invalid JSON',()=>({ok:true,json:async()=>{throw new SyntaxError('Unexpected end of JSON');}})],
  ['HTTP failure',()=>({ok:false,status:503})]
]) test(`a temporary ${name} is retried before returning a usable schedule`,async()=>{
  let calls=0;const delays=[];const warnings=[];
  const result=await fetchSchedule('https://example.test/schedule','college-football',2026,now,{
    fetchImpl:async()=>++calls===1 ? bad() : good(),sleep:async ms=>delays.push(ms),warn:m=>warnings.push(m)
  });
  assert.equal(calls,2);assert.deepEqual(delays,[5000]);assert.equal(warnings.length,1);
  assert.equal(result.games[0].id,'123');assert.deepEqual(result.data,valid);
});

test('persistent malformed data fails after three attempts without returning a publishable snapshot',async()=>{
  let calls=0;const delays=[];
  await assert.rejects(fetchSchedule('https://example.test/schedule','college-football',2026,now,{
    fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({events:[{id:'bad-record'}]})};},
    sleep:async ms=>delays.push(ms),warn:()=>{}
  }),/after 3 attempts.*Keeping published calendar unchanged.*bad-record/);
  assert.equal(calls,3);assert.deepEqual(delays,[5000,15000]);
});

test('a temporary short in-season snapshot is retried, not accepted as deletions',async()=>{
  const full={events:Array.from({length:250},(_,i)=>({...valid.events[0],id:String(i)}))};
  let calls=0;
  const result=await fetchSchedule('https://example.test/schedule','nfl',2026,'2026-09-05T12:00:00Z',{
    fetchImpl:async()=>({ok:true,json:async()=>++calls===1 ? valid : full}),sleep:async()=>{},warn:()=>{}
  });
  assert.equal(calls,2);assert.equal(result.games.length,250);
});

test('missing and capped schedules are rejected even when the HTTP request succeeds',()=>{
  assert.throws(()=>validateSchedule({},'nfl',2026,now),/missing or possibly truncated/);
  assert.throws(()=>validateSchedule({events:Array(1000).fill(valid.events[0])},'nfl',2026,now),/possibly truncated/);
});
