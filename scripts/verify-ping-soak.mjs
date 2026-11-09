// Local loopback only; uses an isolated workspace and never touches live projects.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareElectronExecutable } from './dev-electron.mjs';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('..', import.meta.url));
const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-ping-soak-'));
const executablePath = process.env.ELECTRON_BINARY || await prepareElectronExecutable();
const launch = () => electron.launch({ executablePath, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
  await page.getByLabel('ping目标', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('Ping 次数', { exact: true }).fill('0');
  await page.getByLabel('请求间隔毫秒').fill('200');
  await page.getByRole('button', { name: '开始探测', exact: true }).click();
  const started = Date.now(), samples = [];
  while (Date.now() - started < 120000) {
    await delay(5000);
    samples.push({ elapsedMs: Date.now() - started, metrics: await app.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpuPercent: cpu.percentCPUUsage, workingSetKiB: memory.workingSetSize }))) });
    expect(await page.locator('.result-panel tbody tr').count()).toBeLessThanOrEqual(100);
  }
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('.section-heading .badge').first()).toHaveText('已停止');
  const state = await page.evaluate(() => window.netTool.load());
  const record = state.history[0];
  expect(record.status).toBe('stopped');
  expect(record.completed).toBeGreaterThan(500);
  expect(record.rows).toHaveLength(500);
  expect(record.pingLog).toHaveLength(500);
  expect(record.received).toBe(record.completed);
  expect((await page.getByLabel('Ping 原始输出').textContent()).match(/\] 请求 #/g)).toHaveLength(50);
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, path.join(folder, 'all-logs.txt'));
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click();
  await expect.poll(async () => (await fs.readFile(path.join(folder, 'all-logs.txt'), 'utf8')).match(/\] 请求 #/g)?.length).toBe(500);
  await page.getByLabel('Ping 明细显示数量').selectOption('500');
  await expect(page.locator('.result-panel tbody tr')).toHaveCount(500);
  await page.getByLabel('Ping 原始记录显示数量').selectOption('500');
  expect((await page.getByLabel('Ping 原始输出').textContent()).match(/\] 请求 #/g)).toHaveLength(500);
  await delay(500);
  expect((await page.evaluate(() => window.netTool.load())).history[0]).toEqual(record);
  expect(errors).toEqual([]);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect.poll(async () => (await page.evaluate(() => window.netTool.load())).history.length).toBe(1);
  expect((await page.evaluate(() => window.netTool.load())).history[0]).toEqual(record);
  const report = { testedAt: new Date().toISOString(), platform: process.platform, durationMs: record.elapsedMs,
    sent: record.completed, received: record.received, retainedRows: record.rows.length,
    retainedLogs: record.pingLog.length, restartPreserved: true, pageErrors: errors, samples };
  await fs.writeFile(path.join(root, 'docs/reliability-2026-09-22-soak-optimized.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: samples.length }, null, 2));
} finally {
  if (app) await app.close();
  await fs.rm(folder, { recursive: true, force: true });
}
