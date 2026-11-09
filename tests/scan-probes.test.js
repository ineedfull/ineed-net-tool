import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import probesModule from '../electron/scan-probes.cjs';
import native from '../electron/network.cjs';
const { probeHost, createProbeLimiter } = probesModule;
const { NetworkTasks } = native;
const tick = () => delay(0);

function controlledProbes() {
  const calls = [];
  function probe(name, signal) {
    const deferred = Promise.withResolvers();
    const entry = { name, ...deferred, cancelled: false }; calls.push(entry);
    const abort = () => { entry.cancelled = true; deferred.reject(new Error('cancelled')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    return deferred.promise.finally(() => signal.removeEventListener('abort', abort));
  }
  return { calls, ping: (_, __, signal) => probe('ICMP', signal), tcp: (_, port, __, signal) => probe(`TCP ${port}`, signal) };
}

test('mixed probes and TCP ports start together, first evidence cancels remaining work', async () => {
  const probes = controlledProbes();
  const result = probeHost('127.0.0.1', { method:'combined', ports:[80,443], timeout:1000 }, new AbortController().signal, probes, createProbeLimiter(3));
  await tick(); assert.deepEqual(probes.calls.map(call=>call.name), ['ICMP','TCP 80','TCP 443']);
  probes.calls[2].resolve({ ip:'127.0.0.1', status:'reachable', method:'TCP 443', ms:2, detail:'端口开放' });
  assert.equal((await result).method,'TCP 443');
  assert.equal(probes.calls[0].cancelled,true); assert.equal(probes.calls[1].cancelled,true);
});

test('negative result waits for every method; ICMP permission errors do not discard TCP evidence', async () => {
  const probes = controlledProbes(); let settled = false;
  const result = probeHost('127.0.0.1', { method:'combined', ports:[80], timeout:1000 }, new AbortController().signal, probes, createProbeLimiter());
  result.then(()=>{ settled=true; }); await tick();
  probes.calls[0].reject(new Error('permission denied')); await tick(); assert.equal(settled,false);
  probes.calls[1].resolve({ status:'reachable', method:'TCP 80', detail:'连接拒绝', ms:0 });
  assert.equal((await result).status,'reachable');
  const empty = await probeHost('127.0.0.2', { method:'combined', ports:[80,443], timeout:100 }, new AbortController().signal,
    { ping:async()=>({status:'no-response'}), tcp:async()=>null }, createProbeLimiter());
  assert.equal(empty.status,'no-response');
});

test('primitive pool stays bounded and queued cancellation never starts a new probe', async () => {
  const limiter=createProbeLimiter(2); const controller=new AbortController();
  const work=[]; let active=0,peak=0;
  const runs=Array.from({length:8},()=>limiter(async()=>{
    active++; peak=Math.max(peak,active); const deferred=Promise.withResolvers(); work.push(deferred);
    try { await deferred.promise; } finally { active--; }
  },controller.signal).catch(error=>error.message));
  await tick(); assert.equal(work.length,2); controller.abort();
  work.forEach(item=>item.resolve()); await Promise.all(runs);
  assert.equal(peak,2); assert.equal(work.length,2); assert.equal(active,0);
});

test('address pool runs in parallel and batches every row before the terminal event', async () => {
  let active=0, peak=0; const events=[],saved=[];
  const tasks=new NetworkTasks(event=>events.push(event),async record=>saved.push(record),{scanProbes:{
    ping:async(ip,_,signal)=>{
      active++; peak=Math.max(peak,active);
      try { await delay(5,null,{signal}); return {ip,status:'reachable',method:'ICMP',ms:1}; } finally {active--;}
    }
  }});
  await tasks.start('scan',{target:'127.0.0.1-127.0.0.100',concurrency:16,timeout:100});
  while(tasks.tasks.size) await tick();
  assert.equal(peak,16); assert.equal(active,0);
  assert.equal(saved[0].completed,100);
  const delivered=events.flatMap(event=>event.rows||[]);
  assert.equal(delivered.length,100);assert.equal(new Set(delivered.map(row=>row.ip)).size,100);
  assert.ok(events.filter(event=>event.rows).length<10);
  assert.equal(events.at(-1).status,'completed');assert.equal(events.at(-1).rows,undefined);
});

test('128 addresses still cap total native operations at 128, and stop releases every slot', async () => {
  let active=0,peak=0; const events=[];
  const wait=async(_,__,signal)=>{
    active++;peak=Math.max(peak,active);
    try { await delay(1000,null,{signal}); return null; } finally { active--; }
  };
  const tasks=new NetworkTasks(event=>events.push(event),async()=>{}, {scanProbes:{ping:wait,tcp:(ip,port,timeout,signal)=>wait(ip,timeout,signal)}});
  const {id}=await tasks.start('scan',{target:'127.0.0.1-127.0.0.128',concurrency:128,timeout:100,method:'combined',ports:'80,443'});
  await tick(); assert.equal(peak,128); tasks.control(id,'stop');
  while(tasks.tasks.size) await tick();
  assert.equal(active,0);assert.equal(events.at(-1).status,'stopped');
  assert.equal(events.flatMap(e=>e.rows||[]).length,0);
});

test('stopping a paused scan wakes the entire pool without polling or starting probes', async () => {
  let calls=0;const events=[];
  const tasks=new NetworkTasks(event=>events.push(event),async()=>{}, {scanProbes:{ping:async()=>{calls++;return null;}}});
  const {id}=await tasks.start('scan',{target:'127.0.0.1-127.0.0.128',concurrency:128,timeout:100});
  tasks.control(id,'pause');await tick();assert.equal(calls,0);
  tasks.stopAll();while(tasks.tasks.size) await tick();
  assert.equal(calls,0);assert.equal(events.at(-1).status,'stopped');
});
