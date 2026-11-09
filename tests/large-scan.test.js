import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { scanRange, MAX_SCAN_ADDRESSES } from '../src/domain/ipv4.js';
import { scanBlocks, scanGridCells } from '../src/domain/scan-view.js';
import { taskErrorMessage } from '../src/domain/task-errors.js';
import native from '../electron/network.cjs';
import storage from '../electron/store.cjs';

test('large scan ranges validate arithmetically and grid builds only a selected block', () => {
  assert.equal(scanRange('10.0.0.0/16').length, 65534);
  assert.equal(scanRange('10.0.0.0-10.0.255.255').length, MAX_SCAN_ADDRESSES);
  assert.throws(() => scanRange('10.0.0.0-10.1.0.0'), /65,537.*65,536/);
  assert.throws(() => scanRange('0.0.0.0/0'), /4,294,967,294/);
  const blocks = scanBlocks('10.0.0.0/16');
  assert.equal(blocks.length, 256);
  assert.ok(blocks.every(b => !Object.hasOwn(b, 'cells')));
  const last = scanGridCells(blocks.at(-1), new Map(), 'stopped');
  assert.equal(last.length, 255);
  assert.equal(last.at(-1).ip, '10.0.255.254');
  assert.equal(last.at(-1).status, 'unfinished');
  const crossed = scanBlocks('10.0.255.250-10.1.0.5');
  assert.deepEqual(crossed.map(b => b.prefix), ['10.0.255', '10.1.0']);
  assert.equal(taskErrorMessage(new Error("Error invoking remote method 'task:start': Error: 超时无效")), '超时无效');
  assert.equal(taskErrorMessage(new Error('普通错误')), '普通错误');
});

test('65,536 deterministic probes retain every result, yield between batches and survive SQLite reload', { timeout: 30000 }, async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-full-scan-'));
  const store = new storage.Store(folder);
  let tasks, restored;
  t.after(async () => { tasks?.stopAll(); store.close(); restored?.close(); await fs.rm(folder, {recursive:true,force:true}); });
  await store.load();
  await store.update(s => ({...s, history:[{id:'old',projectId:'default-project',kind:'ping',rows:[]}]}));
  const seen = new Set(); const batches = new Set(); let terminal, active=0, peak=0, turns=0;
  const heartbeat = setInterval(() => turns++, 0);
  t.after(() => clearInterval(heartbeat));
  tasks = new native.NetworkTasks(event => {
    if(event.batch) batches.add(event.batch);
    for(const row of event.rows || []) { assert.ok(!seen.has(row.ip)); seen.add(row.ip); }
    if(event.status === 'completed') terminal=event;
  }, record => store.update(s => ({...s, history:[{...record,projectId:'default-project'},...s.history]})), {
    scanProbes:{ping: async ip => {
      active++; peak=Math.max(peak,active);
      await Promise.resolve(); active--;
      return {ip,status:'reachable',method:'ICMP',ms:1,detail:'deterministic test',raw:'test'};
    }}
  });
  await tasks.start('scan',{target:'127.0.0.0-127.0.255.255',concurrency:128,timeout:100,projectId:'default-project'});
  while(tasks.tasks.size) await delay(1);
  assert.equal(seen.size,65536); assert.equal(batches.size,256);
  assert.equal(terminal.completed,65536); assert.equal(terminal.received,65536);
  assert.equal(terminal.saveError,undefined); assert.equal(peak,128); assert.equal(active,0);
  assert.ok(turns>10,'main event loop must remain available');
  const record=store.state.history[0];
  assert.equal(record.rows.length,65536);
  assert.equal(record.rows[0].ip,'127.0.0.0'); assert.equal(record.rows.at(-1).ip,'127.0.255.255');
  // Export uses every row, independent of the currently visible page.
  assert.equal(JSON.parse(JSON.stringify(record,null,2)).rows.length,65536);
  store.close(); restored=new storage.Store(folder);
  const loaded=await restored.load();
  assert.equal(loaded.history.find(h=>h.id===record.id).rows.length,65536);
  assert.ok(loaded.history.some(h=>h.id==='old'));
});

test('pause at a batch boundary dispatches no next batch; resume then stop retains partial results', {timeout:10000}, async () => {
  let calls=0, saved, paused=false, terminal;
  const reached=Promise.withResolvers();
  const tasks=new native.NetworkTasks(event=>{
    if(event.completed===256 && !paused){paused=true;tasks.control(event.id,'pause');reached.resolve(event.id);}
    if(event.batch===2 && event.completed>=512 && event.status==='running') tasks.control(event.id,'stop');
    if(event.status==='stopped') terminal=event;
  }, async record=>{saved=record;}, {scanProbes:{ping:async ip=>{calls++;return {ip,status:'reachable',ms:1};}}});
  try {
    await tasks.start('scan',{target:'127.0.0.0/16',timeout:100,concurrency:32});
    const id=await reached.promise;
    await delay(20);assert.equal(calls,256);
    tasks.control(id,'resume');
    while(tasks.tasks.size) await delay(1);
    assert.equal(calls,512);assert.equal(saved.rows.length,512);
    assert.equal(terminal.status,'stopped');assert.equal(saved.total,65534);
  } finally { tasks.stopAll(); }
});
