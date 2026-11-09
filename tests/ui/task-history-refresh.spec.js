import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('completed tasks update visible history without reloading every old result', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-incremental-history-'));
  const old = { id: 'old-ping', kind: 'ping', target: '127.0.0.1', startedAt: '2026-01-01T00:00:00Z', status: 'completed', completed: 1, rows: [{ seq: 1, ip: '127.0.0.1', status: 'reachable', ms: 1 }] };
  await fs.writeFile(path.join(folder, 'workspace.json'), JSON.stringify({ version: 1, networks: [], history: [old], settings: { theme: 'light', largeFont: false } }));
  let app;
  const launch = () => electron.launch({ executablePath: process.env.ELECTRON_BINARY, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
  try {
    app = await launch(); let page = await app.firstWindow();
    await expect(page.getByLabel('当前项目')).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('workspace:load');
      globalThis.historyReloads = 0;
      ipcMain.removeHandler('workspace:load');
      ipcMain.handle('workspace:load', (...args) => { globalThis.historyReloads++; return original(...args); });
    });
    for (let round = 0; round < 2; round++) {
      await page.getByRole('button', { name: '端口扫描', exact: true }).click();
      await page.getByLabel('ports目标').fill('127.0.0.1');
      await page.getByLabel('扫描端口', { exact: true }).fill('1-1024');
      await page.getByLabel('端口扫描并发').fill('128');
      await page.getByLabel('工具超时毫秒').fill('100');
      await page.getByRole('button', { name: /^(开始|重新)测试$/ }).click();
      await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
      await page.getByRole('button', { name: '诊断记录', exact: true }).click();
      await expect(page.locator('.history-table tbody tr')).toHaveCount(round + 2);
    }
    expect(await app.evaluate(() => globalThis.historyReloads)).toBe(0);
    const before = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
    expect(before.history.filter(r => r.kind === 'ports').map(r => r.rows.length)).toEqual([1024, 1024]);
    expect(before.history.find(r => r.id === 'old-ping').rows).toEqual(old.rows);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.getByRole('button', { name: '诊断记录', exact: true }).click();
    await expect(page.locator('.history-table tbody tr')).toHaveCount(3);
    const after = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
    expect(after.history).toEqual(before.history);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
