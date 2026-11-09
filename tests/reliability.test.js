import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import native from '../electron/network.cjs';
import tools from '../electron/network-tools.cjs';
import { pingStats } from '../src/domain/ipv4.js';
import fixtures from './helpers/network-fixtures.cjs';

async function settled(tasks) {
  const deadline = Date.now() + 5000;
  while (tasks.tasks.size) {
    assert.ok(Date.now() < deadline, 'task must release its slot');
    await delay(5);
  }
}

test('cancelled targets reject before resolution, and repeated resolutions remove listeners', async () => {
  const cancelled = AbortSignal.abort();
  for (const target of ['127.0.0.1', 'localhost'])
    await assert.rejects(native.resolveTarget(target, cancelled), /停止/);
  const controller = new AbortController();
  for (let index = 0; index < 30; index++) {
    assert.equal(await native.resolveTarget('localhost', controller.signal), '127.0.0.1');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('all tool dispatchers reject an already cancelled job without resolving a target', async () => {
  for (const kind of tools.TOOL_KINDS) {
    let calls = 0;
    await assert.rejects(tools.runTool({ kind, options: {}, controller: { signal: AbortSignal.abort() } }, {
      resolveTarget: async () => { calls++; return '127.0.0.1'; },
      publish: () => { calls++; }, row: () => { calls++; },
    }), /停止/);
    assert.equal(calls, 0, kind);
  }
});

test('repeated immediate stops persist one stopped record each without starting identity or probes', async () => {
  const events = [], records = [];
  let probes = 0;
  const tasks = new native.NetworkTasks(e => events.push(e), async r => records.push(r), {
    identifyTarget: async () => { probes++; return {}; },
    scanProbes: { ping: async () => { probes++; }, tcp: async () => { probes++; } },
  });
  const jobs = [
    ['ping', { target: 'localhost', count: 0 }], ['route', { target: 'localhost' }],
    ['scan', { target: '127.0.0.1/30' }], ['dns', { target: 'localhost' }],
    ['ports', { target: 'localhost', ports: '80,443' }],
    ['quality', { target: 'localhost' }], ['certificate', { target: 'localhost' }],
    ['speed', { target: 'http://127.0.0.1:1/test' }],
  ];
  for (let round = 0; round < 10; round++) {
    for (const [kind, input] of jobs) {
      const { id } = await tasks.start(kind, input);
      tasks.control(id, 'stop');
    }
    await settled(tasks);
  }
  assert.equal(records.length, 80);
  assert.equal(probes, 0);
  assert.ok(records.every(r => r.status === 'stopped' && r.completed === 0 && !r.error));
  const count = events.length;
  await delay(50);
  assert.equal(events.length, count, 'no late events after cancellation');
});

test('small Ping payload replies count as received even when the OS omits RTT', async () => {
  const records = [], events = [];
  const tasks = new native.NetworkTasks(e => events.push(e), async r => records.push(r));
  await tasks.start('ping', { target: '127.0.0.1', count: 2, interval: 200, payloadSize: 0 });
  await settled(tasks);
  assert.equal(records[0].received, 2);
  assert.equal(events.at(-1).received, 2);
  assert.ok(records[0].rows.every(row => row.status === 'reachable'));
  if (process.platform === 'darwin') assert.equal(records[0].average, null);
  const stats = pingStats([{ status: 'reachable', ms: null }, { status: 'reachable', ms: 8 }]);
  assert.equal(stats.received, 2);
  assert.equal(stats.loss, 0);
  assert.equal(stats.average, 8);
});

test('mixed timed and untimed replies never dilute aggregate latency', async () => {
  const records = [];
  const tasks = new native.NetworkTasks(() => {}, async r => records.push(r), {
    scanProbes: { ping: async ip => ({ ip, status: 'reachable', ms: ip.endsWith('.1') ? null : 12 }) },
  });
  await tasks.start('scan', { target: '127.0.0.1-127.0.0.2', method: 'icmp' });
  await settled(tasks);
  assert.equal(records[0].received, 2);
  assert.equal(records[0].average, 12);
});

test('numeric tool parameters reject coerced booleans, arrays and objects', () => {
  const cases = [
    ['speed', { target: 'http://localhost/file' }, 'duration'],
    ['speed', { target: 'http://localhost/file' }, 'maxMiB'],
    ['ports', { target: 'localhost', ports: '80' }, 'concurrency'],
    ['quality', { target: 'localhost' }, 'port'],
    ['quality', { target: 'localhost' }, 'count'],
    ['certificate', { target: 'localhost' }, 'warnDays'],
  ];
  for (const [kind, input, field] of cases)
    for (const value of [true, false, [], [2], {}, '', ' '])
      assert.throws(() => tools.prepareTool(kind, { ...input, [field]: value }), undefined, `${kind}.${field}`);
});

test('failed history persistence is explicit and does not block later diagnostics', async () => {
  const events = [], records = [];
  let fail = true;
  const tasks = new native.NetworkTasks(e => events.push(e), async r => {
    if (fail) throw new Error('disk full');
    records.push(r);
  });
  await tasks.start('ping', { target: '127.0.0.1', count: 1 });
  await settled(tasks);
  assert.equal(records.length, 0);
  assert.match(events.at(-1).saveError, /disk full.*导出/);
  assert.equal(events.at(-1).historyRecord, undefined, 'Unsaved results must not enter visible history');
  assert.equal(events.at(-1).received, 1);
  fail = false;
  await tasks.start('ping', { target: '127.0.0.1', count: 1 });
  await settled(tasks);
  assert.equal(records.length, 1);
  assert.equal(events.at(-1).saveError, undefined);
  assert.deepEqual(events.at(-1).historyRecord, records[0]);
});

test('stalled TLS and HTTP connections time out and release their cancellation listeners', { timeout: 10000 }, async t => {
  const services = await fixtures.fixtures();
  t.after(() => services.close());
  const sockets = new Set();
  const stalled = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => stalled.close(resolve));
  });
  const controller = new AbortController();
  await assert.rejects(tools.measureDownload({ target: services.url + '/stall', timeout: 100, duration: 1, maxMiB: 1 }, controller.signal, () => {}), /超时/);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await assert.rejects(tools.inspectCertificate('127.0.0.1', { port: stalled.address().port, timeout: 100, servername: 'localhost', warnDays: 30 }, controller.signal), /超时/);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
