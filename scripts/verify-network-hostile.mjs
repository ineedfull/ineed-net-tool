// Isolated production Electron; deliberately bad responses only from loopback.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { prepareElectronExecutable } from './dev-electron.mjs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('..', import.meta.url));
const folder = await fs.mkdtemp('/tmp/nettool-hostile-');
const sockets = new Set(), evidence = [], errors = [];
let app;
const tracking = server => {
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
};
const web = http.createServer((req, res) => {
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
  else if (req.url === '/gzip') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end('bad-gzip'); }
  else if (req.url === '/partial') { res.writeHead(200, { 'Content-Length': '1000000' }); res.write(Buffer.alloc(1024)); setTimeout(() => res.destroy(), 10); }
  else if (req.url === '/stall') { res.writeHead(200); res.flushHeaders(); }
  else if (req.url === '/stream') { res.writeHead(200); const timer = setInterval(() => res.write(Buffer.alloc(16384)), 5); res.once('close', () => clearInterval(timer)); }
  else res.end();
});
const raw = net.createServer(socket => socket.on('data', () => socket.end('THIS IS NOT HTTP\r\n\r\n')));
// Drain ClientHello so a remote FIN is observable; send no TLS response.
// A paused fixture reader would retain its own sockets after the client closes.
const stall = net.createServer(socket => socket.resume());
await Promise.all([tracking(web), tracking(raw), tracking(stall)]);
const url = `http://127.0.0.1:${web.address().port}`;
const snapshot = () => JSON.stringify(evidence, null, 2);
try {
  app = await electron.launch({ executablePath: process.env.ELECTRON_BINARY || await prepareElectronExecutable(), args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: path.join(folder, 'data') } });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => { window.hostileEvents = {}; window.netTool.onTask(e => { window.hostileEvents[e.id] = { ...window.hostileEvents[e.id], ...e, row: undefined, rows: undefined }; }); });
  const start = (kind, options) => page.evaluate(({ kind, options }) => window.netTool.start(kind, options), { kind, options });
  const stop = id => page.evaluate(id => window.netTool.control(id, 'stop'), id);
  const finish = async (job, status) => {
    await expect.poll(() => page.evaluate(id => window.hostileEvents[id]?.status, job.id), { timeout: 10000 }).toBe(status);
    const event = await page.evaluate(id => window.hostileEvents[id], job.id);
    expect(event.saveError).toBeFalsy(); return event;
  };
  for (const [name, kind, options] of [
    ['boolean count', 'quality', { target: '127.0.0.1', count: true }],
    ['array count', 'quality', { target: '127.0.0.1', count: [2] }],
    ['infinite timeout', 'ports', { target: '127.0.0.1', ports: '80', timeout: Infinity }],
    ['overlong ports', 'ports', { target: '127.0.0.1', ports: '1'.repeat(20001) }],
    ['overlong hostname', 'ports', { target: 'a'.repeat(254), ports: '80' }],
    ['shell substitution', 'route', { target: '127.0.0.1$(echo SOAK)' }],
    ['shell newline', 'route', { target: '127.0.0.1\necho SOAK' }],
    ['DNS server injection', 'dns', { target: 'example.test', server: '127.0.0.1;echo SOAK' }],
    ['over payload', 'ping', { target: '127.0.0.1', payloadSize: 65501 }]
  ]) {
    const error = await start(kind, options).then(() => '', e => e.message);
    expect(error, name).toBeTruthy(); evidence.push({ name, rejected: true, error });
  }
  const before = await page.evaluate(() => window.netTool.load());
  const oversized = path.join(folder, 'oversized.json');
  const file = await fs.open(oversized, 'w'); await file.truncate(128 * 1024 * 1024 + 1); await file.close();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, oversized);
  const error = await page.evaluate(() => window.netTool.import()).then(() => '', e => e.message);
  expect(error).toContain('128 MiB'); evidence.push({ name: 'oversized JSON file', rejected: true, error });
  expect(await page.evaluate(() => window.netTool.load())).toEqual(before);
  for (const endpoint of ['/loop', '/gzip', '/partial', '/stall', '/empty', `raw:${raw.address().port}`]) {
    const target = endpoint.startsWith('raw:') ? `http://127.0.0.1:${raw.address().port}/` : url + endpoint;
    const event = await finish(await start('speed', { target, duration: 1, maxMiB: 1, timeout: 100 }), 'error');
    evidence.push({ name: 'bad HTTP ' + endpoint, ...event });
  }
  for (const cancel of [false, true]) {
    const job = await start('certificate', { target: '127.0.0.1', port: stall.address().port, timeout: 1000 });
    if (cancel) { await delay(30); await stop(job.id); }
    evidence.push({ name: cancel ? 'cancel pending TLS' : 'timeout pending TLS', ...await finish(job, cancel ? 'stopped' : 'error') });
  }
  // These repeat starts use visible UI controls, so the production renderer
  // resets each task identity and renders every completion.
  await page.getByRole('button', { name: '网速与质量', exact: true }).click();
  await page.getByRole('button', { name: '下载测速', exact: true }).click();
  await page.getByLabel('speed目标').fill(url + '/stream');
  await page.getByLabel('测速秒数').fill('1'); await page.getByLabel('测速流量上限').fill('1');
  for (let i = 0; i < 40; i++) {
    await page.getByRole('button', { name: /^(开始|重新)测试$/ }).click();
    await page.getByRole('button', { name: 'DNS 查询', exact: true }).click();
    await page.getByRole('button', { name: '网速与质量', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    const state = await page.evaluate(() => window.netTool.load());
    expect(state.history[0].summary.bytes).toBeGreaterThanOrEqual(1024 * 1024);
    evidence.push({ name: `UI download restart ${i + 1}`, id: state.history[0].id, bytes: state.history[0].summary.bytes });
  }
  // Concurrent starts pass through the real renderer IPC. The scan validator
  // yields during module loading; exactly one of 32 submissions may install.
  const results = await page.evaluate(async () => {
    const results = await Promise.all(Array.from({ length: 32 }, () => window.netTool.start('scan', { target: '127.0.0.0/16', method: 'tcp', ports: '1', concurrency: 128, timeout: 100 }).then(job => ({ job }), error => ({ error: error.message })) ));
    await window.netTool.control(results.find(r => r.job).job.id, 'stop');
    return results;
  });
  expect(results.filter(r => r.job)).toHaveLength(1); expect(results.filter(r => r.error)).toHaveLength(31);
  const job = results.find(r => r.job).job;
  await finish(job, 'stopped');
  evidence.push({ name: 'same-kind start race', accepted: 1, rejected: 31 });
  await delay(200);
  await expect.poll(() => sockets.size).toBe(0);
  expect(errors).toEqual([]);
  const handles = await app.evaluate(() => process._getActiveHandles().map(h => h.constructor.name));
  expect(handles.filter(h => h === 'ChildProcess')).toHaveLength(0);
  evidence.push({ name: 'cleanup', fixtureOpenSockets: sockets.size, mainHandles: handles, rendererErrors: errors });
  await fs.writeFile(path.join(folder, 'report.json'), snapshot());
  console.log(JSON.stringify({ folder, passed: true, cases: evidence.length, fixtureOpenSockets: sockets.size }));
} catch (error) {
  evidence.push({ failure: error.stack }); await fs.writeFile(path.join(folder, 'report.json'), snapshot()); throw error;
} finally {
  if (app) await app.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all([web, raw, stall].map(server => new Promise(resolve => server.close(resolve))));
}
