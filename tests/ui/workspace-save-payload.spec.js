import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareElectronExecutable } from '../../scripts/dev-electron.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('planning save acknowledgements stay small and preserve complete diagnostic history', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nettool-save-payload-'));
  const launch = () => electron.launch({
    executablePath: process.env.ELECTRON_BINARY,
    args: [root], env: { ...process.env, NET_TOOL_TEST_DATA: folder },
  });
  process.env.ELECTRON_BINARY ||= await prepareElectronExecutable();
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: '端口扫描', exact: true }).click();
    await page.getByLabel('ports目标').fill('127.0.0.1');
    await page.getByLabel('扫描端口', { exact: true }).fill('1-4096');
    await page.getByLabel('端口扫描并发').fill('128');
    await page.getByLabel('工具超时毫秒').fill('100');
    await page.getByRole('button', { name: '开始测试', exact: true }).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    const before = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
    expect(before.history[0].rows).toHaveLength(4096);
    const acknowledgements = await page.evaluate(async projects => {
      const saved = await Promise.all(Array.from({ length: 8 }, (_, i) => window.netTool.save({
        projects: projects.map(p => ({ ...p, note: `保存 ${i}` })),
      })));
      return saved.map(s => ({ bytes: new TextEncoder().encode(JSON.stringify(s)).byteLength, projects: s.projects, settings: s.settings, activeProjectId: s.activeProjectId }));
    }, before.projects);
    for (const [index, acknowledgement] of acknowledgements.entries()) {
      expect(acknowledgement.bytes, 'Planning writes must not copy thousands of diagnostic rows back to the renderer').toBeLessThan(4096);
      expect(acknowledgement.projects[0].note).toBe(`保存 ${index}`);
      expect(acknowledgement.settings).toEqual(before.settings);
      expect(acknowledgement.activeProjectId).toBe(before.activeProjectId);
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    const after = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.netTool.load())));
    expect(after.history).toEqual(before.history);
    expect(after.projects[0].note).toBe('保存 7');
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
