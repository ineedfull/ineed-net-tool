import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { emptyWorkspace, newProject, templateNetworks } from '../../src/domain/projects.js';
import { enterpriseConnectivity } from '../../src/domain/enterprise.js';
import { ipNumber, ipText } from '../../src/domain/ipv4.js';
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

async function desktop(state, run) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-review-fixes-'));
  let app;
  try {
    await fs.writeFile(path.join(folder, 'workspace.json'), JSON.stringify(state));
    app = await electron.launch({ executablePath: process.env.ELECTRON_BINARY || require('electron'), args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run({ app, page, folder, click: name => page.getByRole('button', { name, exact: true }).click() });
    expect(errors).toEqual([]);
  } finally { if (app) await app.close(); await fs.rm(folder, { recursive: true, force: true }); }
}

test('large valid JSON plans roundtrip and oversized or invalid imports preserve existing data', async () => {
  const state = emptyWorkspace();
  state.projects.push(newProject('destination', '导入目标'));
  const base = ipNumber('10.40.0.1');
  state.networks.push({ id: 'large', projectId: state.activeProjectId, name: '大容量台账', note: '', cidr: '10.40.0.0/19', allocations: Array.from({ length: 3000 }, (_, i) => ({ ip: ipText(base + i), label: `设备 ${i + 1}`, note: 'x'.repeat(700) })) });
  await desktop(state, async ({ app, page, folder, click }) => {
    const file = path.join(folder, 'plans.json');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await click('导出 JSON 规划');
    await expect.poll(() => fs.stat(file).then(s => s.size).catch(() => 0)).toBeGreaterThan(2_000_000);
    await page.getByLabel('当前项目').selectOption('destination');
    await click('导入 JSON 规划');
    await expect(page.getByRole('status')).toContainText('已合并 1 个网段');
    const saved = await page.evaluate(() => window.netTool.load());
    expect(saved.networks).toHaveLength(2);
    expect(saved.networks.find(n => n.projectId === 'destination').allocations).toEqual(state.networks[0].allocations);
    expect(saved.networks.find(n => n.projectId === state.activeProjectId)).toEqual(state.networks[0]);
    const huge = path.join(folder, 'oversized.json');
    const handle = await fs.open(huge, 'w');
    try { await handle.truncate(128 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, huge);
    await click('导入 JSON 规划');
    await expect(page.getByRole('alert')).toContainText('128 MiB');
    await fs.writeFile(huge, JSON.stringify({ version: 1, networks: [{ id: 'invalid' }] }));
    await click('导入 JSON 规划');
    await expect(page.getByRole('alert')).toContainText('无效');
    expect((await page.evaluate(() => window.netTool.load())).networks).toEqual(saved.networks);
  });
});

test('empty Ping count is rejected before starting and explicit zero still runs continuously', async () => {
  await desktop(emptyWorkspace(), async ({ page, click }) => {
    await click('Ping 工具');
    await page.getByLabel('Ping 次数', { exact: true }).fill('');
    await click('开始探测');
    await expect(page.getByRole('alert')).toContainText('请填写');
    expect((await page.evaluate(() => window.netTool.load())).history).toHaveLength(0);
    for (const count of ['', ' ', -1, 1.5, 10001]) {
      const result = await page.evaluate(async count => { try { await window.netTool.start('ping', { target: '127.0.0.1', count }); return 'started'; } catch (e) { return e.message; } }, count);
      expect(result).toContain('整数');
    }
    await page.getByLabel('Ping 次数', { exact: true }).fill('0');
    await click('开始探测');
    await expect(page.locator('.section-heading .badge').first()).toHaveText('运行中');
    await click('停止');
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已停止');
    expect((await page.evaluate(() => window.netTool.load())).history[0].options.count).toBe(0);
  });
});

async function checkScroll(dialog, last) {
  const body = dialog.locator('.dialog-body');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(last).toBeInViewport();
  const end = await last.boundingBox(), footer = await dialog.locator('.dialog-footer').boundingBox();
  expect(end.y + end.height).toBeLessThanOrEqual(footer.y + 1);
}

test('settings and 12-subnet save dialogs scroll independently of fixed actions at both window sizes', async ({}, info) => {
  await desktop(emptyWorkspace(), async ({ app, page, click }) => {
    for (const [width, height, large] of [[1360, 880, false], [920, 620, true]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await click('设置');
      await page.getByLabel('大字模式', { exact: true }).setChecked(large);
      await page.getByLabel('主题', { exact: true }).selectOption(large ? 'dark' : 'light');
      const settings = page.getByRole('dialog');
      if (large) {
        await checkScroll(settings, settings.locator('.settings-section .hint'));
        await page.screenshot({ path: info.outputPath('settings-scrolled-dark-920.png'), scale: 'css' });
      }
      if (await page.getByRole('button', { name: '保存设置', exact: true }).isEnabled()) await click('保存设置');
      else await click('取消');
      await click('网段计算');
      if (!large) {
        await page.getByLabel('IP 地址或 CIDR').fill('10.0.0.0/16');
        for (let i = 0; i < 9; i++) await click('新增子网需求');
        await click('生成划分方案');
      }
      await click('将划分结果加入项目');
      const dialog = page.getByRole('dialog');
      const last = page.getByLabel('保存网段名称 12', { exact: true });
      await checkScroll(dialog, last);
      await last.fill('最后一个子网可编辑');
      await expect(last).toHaveValue('最后一个子网可编辑');
      await page.screenshot({ path: info.outputPath(`subnet-save-${width}.png`), scale: 'css' });
      await click('取消');
    }
    expect((await page.evaluate(() => window.netTool.load())).networks).toHaveLength(0);
  });
});

test('all navigation pages and project tables keep controls inside their visible regions', async ({}, info) => {
  const state = emptyWorkspace();
  state.networks = templateNetworks('enterprise-dual', '10.60.0.0/16', state.activeProjectId, undefined, { externalBase: '10.80.0.0/16' });
  state.projects[0].connectivity = enterpriseConnectivity('10.60.0.0/16', '10.80.0.0/16', state.networks);
  state.projects[0].maintenance.push({ id: 'log', content: '检查核心交换机线路及重新登记现场设备'.repeat(20), date: '2026-09-22', owner: '维护负责人', status: 'pending' });
  state.history.push({ id: 'long', projectId: state.activeProjectId, kind: 'speed', target: `https://example.test/${'long-download-path/'.repeat(12)}`, startedAt: '2026-09-22T00:00:00Z', status: 'error', completed: 0, rows: [], error: '测试失败记录' });
  await desktop(state, async ({ app, page, click }) => {
    for (const [width, height, large] of [[1360, 880, false], [920, 620, true]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      if (large) { await click('设置'); await page.getByLabel('大字模式', { exact: true }).check(); await page.getByLabel('主题', { exact: true }).selectOption('dark'); await click('保存设置'); }
      for (const name of ['项目工作台', '网段计算', 'IP 地址探测', 'Ping 工具', '路由探测', 'DNS 查询', '端口扫描', '网速与质量', '证书检查', '诊断记录']) {
        await click(name);
        expect(await page.locator('.page-content').evaluate(el => el.scrollWidth <= el.clientWidth), name).toBe(true);
        if (name === '诊断记录') {
          await expect(page.getByRole('button', { name: '查看记录', exact: true })).toBeInViewport();
          expect((await page.locator('.history-table tbody tr').boundingBox()).height).toBeLessThan(100);
          expect(await page.locator('.history-time').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          await page.screenshot({ path: info.outputPath(`history-long-${width}.png`), scale: 'css' });
          await click('查看记录');
          await expect(page.locator('.history-full-target')).toContainText(state.history[0].target);
          await expect(page.getByRole('button', { name: '导出记录', exact: true })).toBeInViewport();
          await page.keyboard.press('Escape');
        }
      }
      await click('项目工作台');
      for (const tab of ['地址规划', 'IP 地址台账', '接入与互通', '维护记录']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        for (const table of await page.locator('#project-content table').all()) {
          await table.locator('tbody tr').first().scrollIntoViewIfNeeded();
          const clipped = await table.evaluate(table => {
            const wrap = table.closest('.table-wrap').getBoundingClientRect();
            return [...table.querySelectorAll('tbody tr:first-child td:last-child button')].filter(button => {
              const rect = button.getBoundingClientRect();
              return rect.left < wrap.left - 1 || rect.right > wrap.right + 1;
            }).map(button => button.getAttribute('aria-label') || button.textContent.trim());
          });
          expect(clipped, `${tab} ${width}`).toEqual([]);
          if (tab === 'IP 地址台账') {
            const row = table.locator('tbody tr').first();
            await row.locator('td:last-child button').last().hover();
            const backgrounds = await row.locator('td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
            expect(new Set(backgrounds).size, '操作列与整行悬停背景一致').toBe(1);
            const borders = await row.locator('td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).borderBottom));
            expect(new Set(borders).size, '操作列与整行分隔线一致').toBe(1);
          }
        }
        await page.screenshot({ path: info.outputPath(`project-${tab}-${width}.png`), scale: 'css' });
        if (tab === 'IP 地址台账') {
          await page.locator('.ledger-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
          await page.screenshot({ path: info.outputPath(`ledger-scrolled-${width}.png`), scale: 'css' });
        }
        if (tab === '维护记录') {
          const note = page.locator('.maintenance-note');
          const before = (await note.boundingBox()).height;
          await note.locator('summary').click();
          await expect(note).toHaveAttribute('open', '');
          expect((await note.boundingBox()).height).toBeGreaterThan(before);
          await note.locator('summary').click();
          await expect(note).not.toHaveAttribute('open', '');
        }
      }
    }
  });
});
