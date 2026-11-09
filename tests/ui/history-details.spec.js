import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { emptyWorkspace } from '../../src/domain/projects.js';
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require('electron');

test('long history opens visible scrollable details and restores list position and focus on close', async ({}, info) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-history-details-'));
  const state = emptyWorkspace();
  state.history = Array.from({ length: 100 }, (_, index) => ({
    id: `record-${index}`, projectId: state.activeProjectId, kind: 'ping', target: `node-${index}.test`,
    startedAt: '2026-09-22T00:01:02.003Z', status: 'completed', completed: 250,
    rows: Array.from({ length: 250 }, (_, n) => ({ seq: n + 1, ip: '127.0.0.1', status: 'reachable', ms: 1, detail: '测试历史数据' })),
    pingLog: [{ seq: 1, startedAt: '2026-09-22T00:01:02.003Z', finishedAt: '2026-09-22T00:01:02.004Z', raw: `原始输出 ${index}\n`, code: 0 }],
  }));
  await fs.writeFile(path.join(folder, 'workspace.json'), JSON.stringify(state));
  let app;
  try {
    app = await electron.launch({ executablePath, args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '诊断记录', exact: true }).click();
    const records = page.getByRole('button', { name: '查看记录', exact: true });
    await expect(records).toHaveCount(100);
    const scrollTop = () => page.locator('.page-content').evaluate(el => el.scrollTop);
    const topPosition = await scrollTop();
    await records.first().click();
    const dialog = page.getByRole('dialog', { name: '诊断详情', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.history-detail-identity')).toContainText('node-0.test');
    await expect(dialog.locator('.result-scroll tbody tr')).toHaveCount(100);
    expect(await dialog.evaluate(el => {
      const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await expect(page.getByRole('button', { name: '关闭诊断详情', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('history-detail-light.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(records.first()).toBeFocused();
    expect(Math.abs(await scrollTop() - topPosition)).toBeLessThan(2);

    await records.last().scrollIntoViewIfNeeded();
    const bottomPosition = await scrollTop();
    expect(bottomPosition).toBeGreaterThan(1000);
    await records.last().click();
    await expect(dialog.locator('.history-detail-identity')).toContainText('node-99.test');
    await dialog.getByLabel('结果页码').selectOption('3');
    await expect(dialog.locator('.result-scroll tbody tr')).toHaveCount(50);
    await dialog.getByLabel('Ping 原始输出').scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel('Ping 原始输出')).toContainText('原始输出 99');
    expect(await dialog.locator('.history-detail-body').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: '关闭诊断详情', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '导出记录', exact: true })).toBeInViewport();
    const output = path.join(folder, 'history.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await dialog.getByRole('button', { name: '导出记录', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').then(JSON.parse).catch(() => null)).toEqual(state.history[99]);
    await page.getByRole('button', { name: '关闭诊断详情', exact: true }).click();
    await expect(records.last()).toBeFocused();
    expect(Math.abs(await scrollTop() - bottomPosition)).toBeLessThan(2);

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('主题', { exact: true }).selectOption('dark');
    await page.getByLabel('大字模式', { exact: true }).check();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    await records.first().click();
    await expect(dialog.locator('.result-scroll tbody tr')).toHaveCount(100);
    expect(await dialog.locator('.history-detail-body').evaluate(el => el.scrollTop)).toBe(0);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('history-detail-dark-960.png'), scale: 'css' });
    await dialog.getByLabel('Ping 原始输出').scrollIntoViewIfNeeded();
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('测试导出失败'); }; });
    await dialog.getByRole('button', { name: '导出记录', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('测试导出失败');
    await expect(dialog.getByRole('alert')).toBeInViewport();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '网段计算', exact: true }).click();
    await page.getByRole('button', { name: '诊断记录', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await page.evaluate(() => window.netTool.load())).history).toEqual(state.history);
    expect(errors).toEqual([]);
  } finally { if (app) await app.close(); await fs.rm(folder, { recursive: true, force: true }); }
});
