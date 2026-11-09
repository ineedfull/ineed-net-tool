import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fixtures from '../helpers/network-fixtures.cjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const executablePath = process.env.ELECTRON_BINARY || createRequire(import.meta.url)('electron');

test('zero-byte Ping shows received replies, missing latency and exportable save failures', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-reliability-'));
  let app;
  try {
    app = await electron.launch({ executablePath, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
    await page.getByLabel('Ping 数据载荷字节数').fill('0');
    await page.getByLabel('Ping 次数', { exact: true }).fill('1');
    await app.evaluate(async ({ app, dialog }, file) => {
      const { createRequire } = process.getBuiltinModule('module');
      const { Store } = createRequire(app.getAppPath() + '/package.json')('./electron/store.cjs');
      globalThis.restoreStore = Store.prototype.update;
      Store.prototype.update = async () => { throw new Error('test disk full'); };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, path.join(folder, 'unsaved.json'));
    await page.getByRole('button', { name: '开始探测', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await expect(page.locator('.metrics > div').filter({ hasText: '有响应' }).locator('strong')).toHaveText('1');
    await expect(page.locator('.metrics > div').filter({ hasText: '丢包率' }).locator('strong')).toHaveText('0.0%');
    if (process.platform === 'darwin') {
      await expect(page.locator('.metrics > div').filter({ hasText: '平均响应耗时' }).locator('strong')).toHaveText('—');
      await expect(page.locator('.chart-panel circle')).toHaveAttribute('visibility', 'hidden');
    }
    await expect(page.getByRole('alert')).toContainText('请先导出结果备份');
    expect((await page.evaluate(() => window.netTool.load())).history).toHaveLength(0);
    await page.getByRole('button', { name: '导出结果', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(folder, 'unsaved.json'), 'utf8')).received).toBe(1);
    await app.evaluate(async ({ app }) => {
      const { createRequire } = process.getBuiltinModule('module');
      const { Store } = createRequire(app.getAppPath() + '/package.json')('./electron/store.cjs');
      Store.prototype.update = globalThis.restoreStore;
    });
    await page.getByRole('button', { name: '重新探测', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(async () => (await page.evaluate(() => window.netTool.load())).history.length).toBe(1);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('failed DNS queries without rows can be exported with their error and parameters', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-failed-export-'));
  const services = await fixtures.fixtures();
  let app;
  try {
    app = await electron.launch({ executablePath, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'DNS 查询', exact: true }).click();
    await page.getByLabel('dns目标').fill('missing.test');
    await page.getByLabel('DNS 服务器', { exact: true }).fill(`127.0.0.1:${services.dnsPort}`);
    await page.getByRole('button', { name: '开始测试', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('执行失败');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, path.join(folder, 'failed.json'));
    await page.getByRole('button', { name: '导出结果', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(folder, 'failed.json'), 'utf8')).error).toContain('域名不存在');
    const data = JSON.parse(await fs.readFile(path.join(folder, 'failed.json'), 'utf8'));
    expect(data.rows).toEqual([]);
    expect(data.options.target).toBe('missing.test');
    expect(data.status).toBe('error');
  } finally {
    if (app) await app.close();
    await services.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
