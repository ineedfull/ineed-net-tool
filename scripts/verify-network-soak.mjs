// Real production renderer/preload/native tasks. Every network target is loopback.
// Usage: npm run build && node scripts/verify-network-soak.mjs --minutes=20
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareElectronExecutable } from './dev-electron.mjs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import fixtures from '../tests/helpers/network-fixtures.cjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const minutes = Number(process.argv.find(a => a.startsWith('--minutes='))?.split('=')[1] || 20);
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('minutes must be positive');
const burst = Number(process.argv.find(a => a.startsWith('--burst='))?.split('=')[1] || 1);
const idleSeconds = Number(process.argv.find(a => a.startsWith('--idle-seconds='))?.split('=')[1] || 0);
if (![1, 2, 4].includes(burst)) throw new Error('burst must be 1, 2 or 4');
if (!Number.isFinite(idleSeconds) || idleSeconds < 0) throw new Error('idle-seconds must be nonnegative');
const folder = process.argv.find(a => a.startsWith('--out='))?.slice(6) || await fs.mkdtemp('/tmp/nettool-soak-');
await fs.mkdir(folder, { recursive: true });
await fs.writeFile(path.join(folder, 'run-owner'), new Date().toISOString(), { flag: 'wx' });
const data = path.join(folder, 'data');
const executablePath = process.env.ELECTRON_BINARY || await prepareElectronExecutable();
const services = await fixtures.fixtures();
let app, page, ping, started, cycle = 0;
let pageIdentity, recoveryProjectId, loadProjectId;
const samples = [], pageErrors = [], tasks = [], attacks = [];
const totals = { rows: 0, bytes: 0, saves: 0, completed: 0, stopped: 0, expectedErrors: 0, unexpectedErrors: 0 };
const report = { testedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, startsThroughUI: true, folder, minutes, burst, idleSeconds, totals, samples, tasks, attacks, pageErrors, launches: [] };
const output = async () => fs.writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
const launch = async () => {
  app = await electron.launch({ executablePath, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: data } });
  page = await app.firstWindow();
  page.on('pageerror', e => pageErrors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMinimized()) window.restore();
    window.show();
  });
  pageIdentity = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, url: location.href }));
  const host = await app.evaluate(({ app }) => ({ pid: process.pid, dataPath: app.getPath('userData') }));
  report.launches.push({ ...host, pageIdentity });
  await fs.writeFile(path.join(folder, 'host.json'), JSON.stringify(host));
  await page.evaluate(() => {
    window.soakEvents = {};
    window.netTool.onTask(e => { window.soakEvents[e.id] = { ...window.soakEvents[e.id], ...e, rows: undefined, row: undefined, pingLogEntry: undefined, historyRecord: undefined }; });
  });
};
const start = (kind, options) => page.evaluate(({ kind, options }) => window.netTool.start(kind, options), { kind, options });
const control = (id, action) => page.evaluate(({ id, action }) => window.netTool.control(id, action), { id, action });
async function startVisible(kind, options) {
  const menu = { ports: '端口扫描', scan: 'IP 地址探测', dns: 'DNS 查询', speed: '网速与质量', quality: '网速与质量', certificate: '证书检查' };
  await page.getByRole('button', { name: menu[kind], exact: true }).click();
  if (kind === 'speed' || kind === 'quality') await page.getByRole('button', { name: kind === 'speed' ? '下载测速' : '链路质量', exact: true }).click();
  await page.getByLabel(kind + '目标', { exact: true }).fill(options.target);
  await page.getByLabel(kind === 'scan' ? '超时毫秒' : '工具超时毫秒', { exact: true }).fill(String(options.timeout));
  const fill = async (label, value) => page.getByLabel(label, { exact: true }).fill(String(value));
  if (kind === 'ports') { await fill('扫描端口', options.ports); await fill('端口扫描并发', options.concurrency); }
  if (kind === 'scan') { await page.getByLabel('探测方式', { exact: true }).selectOption('tcp'); await fill('TCP 端口', options.ports); await fill('扫描并发数', options.concurrency); }
  if (kind === 'dns') { await page.getByLabel('DNS 记录类型').selectOption('A'); await fill('DNS 服务器', options.server); }
  if (kind === 'speed') { await fill('测速秒数', options.duration); await fill('测速流量上限', options.maxMiB); }
  if (kind === 'quality') { await page.getByLabel('质量测试方式').selectOption('tcp'); await fill('质量测试端口', options.port); await fill('质量采样次数', options.count); await fill('质量采样间隔', options.interval); }
  if (kind === 'certificate') { await fill('TLS 端口', options.port); await fill('证书校验域名', options.servername); }
  const previous = await page.evaluate(kind => Object.values(window.soakEvents).filter(e => e.kind === kind).at(-1)?.id, kind);
  await page.getByRole('button', { name: kind === 'scan' ? /^(开始|重新)探测$/ : /^(开始|重新)测试$/ }).click();
  let id;
  await expect.poll(async () => {
    id = await page.evaluate(kind => Object.values(window.soakEvents).filter(e => e.kind === kind).at(-1)?.id, kind);
    return Boolean(id && id !== previous);
  }).toBe(true);
  return { id };
}
async function finish(job, expected = 'completed') {
  const until = Date.now() + 30000;
  let event;
  do {
    event = await page.evaluate(id => window.soakEvents[id], job.id);
    if (['completed', 'stopped', 'error'].includes(event?.status)) break;
    await delay(30);
  } while (Date.now() < until);
  expect(event?.status, JSON.stringify(event)).toBe(expected);
  expect(event?.saveError).toBeFalsy();
  const entry = { id: job.id, kind: event.kind, status: event.status, completed: event.completed, elapsedMs: event.elapsedMs, summary: event.summary };
  tasks.push(entry);
  totals.rows += event.completed;
  totals.bytes += event.summary?.bytes || 0;
  totals[expected === 'error' ? 'expectedErrors' : expected]++;
  return event;
}
async function sample(stage = 'load') {
  const native = await app.evaluate(({ app, BrowserWindow }) => ({
    window: BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), visible: w.isVisible(), minimized: w.isMinimized(), bounds: w.getBounds() })),
    metrics: app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpuPercent: cpu.percentCPUUsage, workingSetKiB: memory.workingSetSize })),
    handles: process._getActiveHandles().reduce((all, h) => { const name = h.constructor.name; all[name] = (all[name] || 0) + 1; return all; }, {}),
    remoteSockets: process._getActiveHandles().filter(h => h.remoteAddress).map(h => ({ address: h.remoteAddress, port: h.remotePort }))
  }));
  expect(native.window[0]?.visible).toBe(true);
  expect(native.window[0]?.minimized).toBe(false);
  expect(native.window[0]?.title).toBe('iNeed Net Tool');
  expect(native.remoteSockets.every(s => s.address.startsWith('127.') || s.address === '::1')).toBe(true);
  const renderer = await page.evaluate(() => {
    const views = [];
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      const component = node.component;
      if (component) {
        const { kind, task } = component.props;
        if (task && ['Diagnostics', 'NetworkTools'].includes(component.type.__name)) {
          const latest = Object.values(window.soakEvents).filter(e => e.kind === kind).at(-1);
          views.push({ kind, id: task.id, completed: task.completed, rows: task.rows.length, latestId: latest?.id, latestCompleted: latest?.completed });
        }
        visit(component.subTree);
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(document.querySelector('#app').__vue_app__._container._vnode);
    return { identity: { timeOrigin: performance.timeOrigin, url: location.href }, visibility: document.visibilityState, renderedRows: document.querySelectorAll('tbody tr').length, views };
  });
  if (stage === 'load') {
    expect(renderer.views.length, 'A diagnostic view must be visible').toBeGreaterThan(0);
    for (const view of renderer.views) {
      expect(view.id, `Visible ${view.kind} must follow the latest execution`).toBe(view.latestId);
      expect(view.completed).toBe(view.latestCompleted);
    }
  }
  expect(renderer.identity).toEqual(pageIdentity);
  expect(renderer.visibility).toBe('visible');
  let physical;
  if (process.env.NET_TOOL_SOAK_NATIVE_SAMPLE) {
    const raw = JSON.parse(execFileSync(process.env.NET_TOOL_SOAK_NATIVE_SAMPLE, { encoding: 'utf8' }));
    const ids = new Set([report.launches.at(-1).pid]);
    let changed;
    do { changed = false; for (const p of raw.processes) if (ids.has(p.ppid) && !ids.has(p.pid)) { ids.add(p.pid); changed = true; } } while (changed);
    physical = { locked: Boolean(raw.session.CGSSessionScreenIsLocked), processes: raw.processes.filter(p => ids.has(p.pid)) };
    expect(physical.locked, 'Visible soak requires an unlocked desktop').toBe(false);
  }
  samples.push({ time: new Date().toISOString(), elapsedMs: Date.now() - started, cycle, stage, launchIndex: report.launches.length - 1, renderer, physical, ...native });
  await output();
  console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now() - started) / 1000), cycle, stage, ...totals, handles: native.handles, memoryKiB: native.metrics.map(m => [m.type, m.workingSetKiB]) }));
}
async function idle(stage) {
  await sample(stage + '-start');
  const end = Date.now() + idleSeconds * 1000 / 3;
  while (Date.now() < end) {
    await delay(Math.min(10000, end - Date.now()));
    await sample(stage);
  }
}
try {
  await launch();
  console.log(JSON.stringify({ folder, fixture: services.url, dnsPort: services.dnsPort }));
  if (idleSeconds > 0) {
    // Use the existing project-switch operation to release live task views.
    loadProjectId = await page.getByLabel('当前项目').inputValue();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('压力恢复观察');
    await page.locator('.scenario-card').filter({ hasText: '空白项目' }).click();
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    recoveryProjectId = await page.getByLabel('当前项目').inputValue();
    await page.getByLabel('当前项目').selectOption(loadProjectId);
    await expect.poll(() => page.evaluate(async () => (await window.netTool.load()).activeProjectId)).toBe(loadProjectId);
  }
  await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
  await page.getByLabel('ping目标', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('Ping 次数', { exact: true }).fill('0');
  await page.getByLabel('请求间隔毫秒').fill('200');
  await page.getByRole('button', { name: '开始探测', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.values(window.soakEvents).find(e => e.kind === 'ping')?.id)).toBeTruthy();
  ping = await page.evaluate(() => ({ id: Object.values(window.soakEvents).find(e => e.kind === 'ping').id }));
  started = Date.now();
  const state = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
  for (const [name, kind, options] of [
    ['shell target', 'ports', { target: '127.0.0.1;echo SOAK', ports: '80' }],
    ['unknown kind', 'shell', { target: '127.0.0.1' }],
    ['invalid numeric', 'quality', { target: '127.0.0.1', count: '' }],
    ['over concurrency', 'ports', { target: '127.0.0.1', ports: '80', concurrency: 129 }],
    ['over scan', 'scan', { target: '127.0.0.0/8' }],
    ['unsafe URL', 'speed', { target: 'file:///tmp/nettool-soak-probe' }],
    ['credential URL', 'speed', { target: 'http://u:p@127.0.0.1/' }]
  ]) {
    const error = await start(kind, options).then(() => '', e => e.message);
    expect(error, name).toBeTruthy(); attacks.push({ name, rejected: true, error });
  }
  for (const patch of [null, [], { history: [] }, { settings: { theme: 'invalid' } }, { projects: [{ ...state.projects[0], name: 'x'.repeat(101) }] }]) {
    const error = await page.evaluate(patch => window.netTool.save(patch), patch).then(() => '', e => e.message);
    expect(error).toBeTruthy(); attacks.push({ name: 'invalid save patch', rejected: true, error });
  }
  const isolation = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, ipcRenderer: typeof window.ipcRenderer, keys: Object.keys(window.netTool) }));
  expect(isolation.require).toBe('undefined'); expect(isolation.process).toBe('undefined'); expect(isolation.ipcRenderer).toBe('undefined'); report.isolation = isolation;
  const badJson = path.join(folder, 'invalid.json'); await fs.writeFile(badJson, '{bad-json');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, badJson);
  const badImport = await page.evaluate(() => window.netTool.import()).then(() => '', e => e.message);
  expect(badImport).toBeTruthy(); attacks.push({ name: 'invalid JSON import', rejected: true, error: badImport });
  let lastSample = 0;
  while (Date.now() - started < minutes * 60000) {
    const round = Date.now(); cycle++;
    const ports = await startVisible('ports', { target: '127.0.0.1', ports: `1-${1024 * burst},${services.openPort}`, concurrency: 128, timeout: 100 });
    const dns = await startVisible('dns', { target: cycle % 10 === 0 ? 'timeout.test' : cycle % 7 === 0 ? 'missing.test' : 'example.test', recordType: 'A', server: `127.0.0.1:${services.dnsPort}`, timeout: 100 });
    const speed = await startVisible('speed', { target: `${services.url}/${cycle % 8 === 0 ? 'stream' : cycle % 10 === 0 ? 'stall' : cycle % 7 === 0 ? 'error' : cycle % 5 === 0 ? 'stream' : 'file'}`, duration: 1, maxMiB: 4, timeout: 200 });
    if (cycle % 8 === 0) await control(speed.id, 'stop');
    const quality = await startVisible('quality', { target: '127.0.0.1', method: 'tcp', port: services.openPort, count: 5, interval: 200, timeout: 100 });
    const certificate = await startVisible('certificate', { target: '127.0.0.1', port: cycle % 9 === 0 ? services.openPort : services.tlsPort, servername: 'localhost', timeout: 200 });
    const scan = await startVisible('scan', { target: `127.0.0.0/${22 - Math.log2(burst)}`, method: 'tcp', ports: String(services.openPort), concurrency: 128, timeout: 100 });
    if (cycle % 3 === 0) { await control(scan.id, 'pause'); await delay(25); await control(scan.id, cycle % 6 === 0 ? 'stop' : 'resume'); }
    const raceSaves = page.evaluate(async ({ projects, cycle }) => {
      await Promise.all(Array.from({ length: 8 }, (_, index) => window.netTool.save({ projects: projects.map(p => ({ ...p, note: `soak-${cycle}-${index}` })) })));
      await window.netTool.save({ settings: { theme: cycle % 2 ? 'dark' : 'light', largeFont: cycle % 4 > 1, ipView: 'table' } });
    }, { projects: state.projects, cycle });
    const names = ['DNS 查询', '端口扫描', '网速与质量', '证书检查', 'Ping 工具'];
    await page.getByRole('button', { name: names[cycle % names.length], exact: true }).click();
    await Promise.all([
      finish(ports), finish(scan, cycle % 6 === 0 ? 'stopped' : 'completed'),
      finish(dns, cycle % 10 === 0 || cycle % 7 === 0 ? 'error' : 'completed'),
      finish(speed, cycle % 8 === 0 ? 'stopped' : cycle % 10 === 0 || cycle % 7 === 0 ? 'error' : 'completed'),
      finish(quality), finish(certificate, cycle % 9 === 0 ? 'error' : 'completed'), raceSaves
    ]);
    totals.saves += 9;
    // Verify the persisted retention limit without fetching every result into
    // the renderer just to count it. The final check still compares all data.
    const retained = await app.evaluate(({ app }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const file = process.getBuiltinModule('path').join(app.getPath('userData'), 'workspace.sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      try { return db.prepare('SELECT count(*) AS count FROM history').get().count; }
      finally { db.close(); }
    });
    expect(retained).toBeLessThanOrEqual(100);
    await expect(page.locator('.status-footer')).toContainText(`${retained} 次诊断`);
    if (Date.now() - lastSample >= 10000) { await sample(); lastSample = Date.now(); }
    await delay(Math.max(0, 5000 - (Date.now() - round)));
  }
  await control(ping.id, 'stop'); await finish(ping, 'stopped');
  report.durationMs = Date.now() - started;
  await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
  let before = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
  expect(before.history).toHaveLength(Math.min(100, tasks.length));
  const pingRecord = before.history.find(r => r.id === ping.id);
  expect(pingRecord.completed).toBeGreaterThan(minutes * 200);
  expect(pingRecord.rows).toHaveLength(Math.min(500, pingRecord.completed));
  expect(pingRecord.pingLog).toHaveLength(Math.min(500, pingRecord.completed));
  report.ping = { sent: pingRecord.completed, received: pingRecord.received, retainedRows: pingRecord.rows.length, retainedLogs: pingRecord.pingLog.length };
  for (const record of before.history.filter(r => ['scan', 'ports'].includes(r.kind))) {
    expect(record.rows).toHaveLength(record.completed);
    expect(new Set(record.rows.map(row => record.kind === 'scan' ? row.ip : row.port)).size).toBe(record.completed);
    if (record.status === 'completed') expect(record.completed).toBe(record.kind === 'scan' ? 1024 * burst - 2 : 1024 * burst + (services.openPort > 1024 * burst ? 1 : 0));
  }
  report.retainedRowsVerified = true;
  await page.getByRole('button', { name: '诊断记录', exact: true }).click();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(before.history.length);
  const visibleHistory = JSON.parse(await page.evaluate(() => {
    let records;
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.component) {
        if (node.component.type.__name === 'HistoryPanel') records = node.component.props.history;
        visit(node.component.subTree);
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(document.querySelector('#app').__vue_app__._container._vnode);
    if (!records) throw new Error('Visible history component not found');
    return JSON.stringify(records);
  }));
  expect(visibleHistory.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.history].sort((a, b) => a.id.localeCompare(b.id)));
  report.visibleHistoryVerified = true;
  await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
  // Recovery measurements precede the separate restart compatibility check.
  if (idleSeconds > 0) {
    await idle('stopped-idle');
    await page.getByLabel('当前项目').selectOption(recoveryProjectId);
    await expect.poll(() => page.evaluate(async () => (await window.netTool.load()).activeProjectId)).toBe(recoveryProjectId);
    await expect(page.locator('.result-panel tbody tr')).toHaveCount(0);
    expect(await page.evaluate(async () => JSON.stringify((await window.netTool.load()).history))).toBe(JSON.stringify(before.history));
    await idle('views-reset-idle');
    await page.getByRole('button', { name: '项目工作台', exact: true }).click();
    await idle('project-idle');
    before = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
  } else { await delay(1500); await sample('stopped'); }
  report.totalElapsedMs = Date.now() - started;
  await fs.writeFile(path.join(folder, 'before-restart.json'), JSON.stringify(before, null, 2));
  await app.close(); app = null;
  await launch();
  const after = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
  expect([...after.history].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.history].sort((a, b) => a.id.localeCompare(b.id)));
  expect(after.projects).toEqual(before.projects); expect(after.settings).toEqual(before.settings);
  report.restartPreserved = true; report.retainedHistory = after.history.length;
  expect(pageErrors).toEqual([]);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; totals.unexpectedErrors++; throw error;
} finally {
  if (app) await app.close();
  // Keep completed assertions even if fixture cleanup itself fails.
  report.finishedAt = new Date().toISOString(); await output();
  await services.close();
  report.fixtureClosed = true; await output();
  console.log(JSON.stringify({ folder, passed: report.passed, durationMs: report.durationMs, cycle, ...totals }));
}
