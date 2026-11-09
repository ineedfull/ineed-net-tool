import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { emptyWorkspace, newProject } from '../../src/domain/projects.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

test('project switch cannot orphan a diagnostic started while its save is pending', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-workspace-lifecycle-'));
  const state = emptyWorkspace();
  state.projects.push(newProject('site-b', '现场 B'));
  await fs.writeFile(path.join(folder, 'workspace.json'), JSON.stringify(state));
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY || require('electron'), args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByLabel('当前项目')).toHaveValue('default-project');
    await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
    await page.getByLabel('ping目标').fill('127.0.0.1');
    await page.getByLabel('Ping 次数', { exact: true }).fill('2');
    await page.getByLabel('ping目标').click();
    await expect(page.getByLabel('Ping 次数', { exact: true })).toHaveValue('2');
    // Delay the native save response after the real SQLite commit. This keeps
    // project switching pending without changing application data or task code.
    await app.evaluate(({ app }) => {
      const nativeRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { Store } = nativeRequire('./electron/store.cjs');
      const { NetworkTasks } = nativeRequire('./electron/network.cjs');
      const update = Store.prototype.update;
      Store.prototype.update = async function (patch) {
        const before = this.state.activeProjectId;
        const result = await update.call(this, patch);
        if (before !== result.activeProjectId) {
          globalThis.__switchPending = true;
          await new Promise(resolve => { globalThis.__releaseSwitch = resolve; });
        }
        return result;
      };
      const start = NetworkTasks.prototype.start;
      globalThis.__starts = 0;
      NetworkTasks.prototype.start = function (...args) {
        globalThis.__starts++;
        return start.apply(this, args);
      };
    });
    await page.getByLabel('当前项目').selectOption('site-b');
    await expect.poll(() => app.evaluate(() => !!globalThis.__switchPending)).toBe(true);
    await page.getByRole('button', { name: '开始探测', exact: true }).click();
    expect(await app.evaluate(() => globalThis.__starts)).toBe(0);
    await expect(page.getByRole('alert')).toContainText('工作区正在保存');
    // Both button and Enter paths must use the same ownership guard. No probe
    // reaches the native runner, including scan's default non-loopback target.
    for (const [name, kind, mode] of [
      ['IP 地址探测', 'scan'], ['路由探测', 'route'],
      ['DNS 查询', 'dns'], ['端口扫描', 'ports'],
      ['网速与质量', 'speed', '下载测速'],
      ['网速与质量', 'quality', '链路质量'], ['证书检查', 'certificate'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      if (mode) await page.getByRole('button', { name: mode, exact: true }).click();
      await page.getByLabel(kind + '目标', { exact: true }).press('Enter');
      expect(await app.evaluate(() => globalThis.__starts)).toBe(0);
    }
    await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
    await app.evaluate(() => globalThis.__releaseSwitch());
    await expect(page.getByLabel('当前项目')).toBeEnabled();
    await expect(page.getByLabel('当前项目')).toHaveValue('site-b');
    expect((await page.evaluate(() => window.netTool.load())).history).toHaveLength(0);
    await page.getByRole('button', { name: '开始探测', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    const saved = await page.evaluate(() => window.netTool.load());
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].projectId).toBe('site-b');
    expect(errors).toEqual([]);
  } finally {
    if (app) {
      await app.evaluate(() => globalThis.__releaseSwitch?.());
      await app.close();
    }
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('a delayed project save cannot hide diagnostic history persisted after its snapshot', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-save-history-'));
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY || require('electron'), args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    await expect(page.getByLabel('当前项目')).toBeVisible();
    await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
    await page.getByLabel('Ping 次数', { exact: true }).fill('3');
    await page.getByRole('button', { name: '开始探测', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('运行中');
    await app.evaluate(({ app }) => {
      const nativeRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { Store } = nativeRequire('./electron/store.cjs');
      const update = Store.prototype.update;
      Store.prototype.update = async function (...args) {
        const delay = !globalThis.__saveDelayed;
        if (delay) globalThis.__saveDelayed = true;
        const snapshot = await update.apply(this, args);
        if (delay) {
          globalThis.__saveWaiting = true;
          await new Promise(resolve => { globalThis.__releaseSave = resolve; });
        }
        return snapshot;
      };
    });
    await page.getByRole('button', { name: '项目工作台', exact: true }).click();
    await page.getByRole('button', { name: '编辑项目', exact: true }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('仍有完整历史');
    await page.getByRole('button', { name: '保存项目', exact: true }).click();
    await expect.poll(() => app.evaluate(() => !!globalThis.__saveWaiting)).toBe(true);
    // Ping continues behind the project dialog and completes naturally while
    // the earlier save response is held. The database and event flow stay real.
    await expect.poll(async () => (await page.evaluate(() => window.netTool.load())).history.length).toBe(1);
    await expect(page.getByRole('button', { name: '诊断记录', exact: true })).toContainText('1');
    expect((await page.evaluate(() => window.netTool.load())).history).toHaveLength(1);
    await app.evaluate(() => globalThis.__releaseSave());
    await expect(page.getByLabel('当前项目')).toBeEnabled();
    await expect(page.getByRole('button', { name: '诊断记录', exact: true })).toContainText('1');
    await page.getByRole('button', { name: '诊断记录', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  } finally {
    if (app) {
      await app.evaluate(() => globalThis.__releaseSave?.());
      await app.close();
    }
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('a failed project switch preserves results and releases the save guard for retry', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-switch-recovery-'));
  const state = emptyWorkspace();
  state.projects.push(newProject('site-b', '现场 B'));
  await fs.writeFile(path.join(folder, 'workspace.json'), JSON.stringify(state));
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY || require('electron'), args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    await expect(page.getByLabel('当前项目')).toBeVisible();
    await page.getByRole('button', { name: 'Ping 工具', exact: true }).click();
    await page.getByLabel('Ping 次数', { exact: true }).fill('1');
    await page.getByRole('button', { name: '开始探测', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await expect.poll(async () => (await page.evaluate(() => window.netTool.load())).history.length).toBe(1);
    await app.evaluate(({ app }) => {
      const nativeRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { Store } = nativeRequire('./electron/store.cjs');
      const update = Store.prototype.update;
      Store.prototype.update = function (...args) {
        Store.prototype.update = update;
        return Promise.reject(new Error('test switch disk full'));
      };
    });
    await page.getByLabel('当前项目').selectOption('site-b');
    await expect(page.getByRole('alert')).toContainText('test switch disk full');
    await expect(page.getByLabel('当前项目')).toBeEnabled();
    await expect(page.getByLabel('当前项目')).toHaveValue('default-project');
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await expect(page.getByRole('button', { name: '诊断记录', exact: true })).toContainText('1');
    await page.getByRole('button', { name: '重新探测', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.netTool.load())).history.length).toBe(2);
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await page.getByLabel('当前项目').selectOption('site-b');
    await expect(page.getByLabel('当前项目')).toHaveValue('site-b');
    await expect(page.locator('.section-heading .badge').first()).toHaveText('就绪');
    const saved = await page.evaluate(() => window.netTool.load());
    expect(saved.activeProjectId).toBe('site-b');
    expect(saved.history).toHaveLength(2);
    expect(saved.history.every(record => record.projectId === 'default-project')).toBe(true);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
