import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("Ping size and original logs survive export, clipboard and SQLite restart", async ({}, info) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nettool-ping-log-"));
  let app;
  const launch = () =>
    electron.launch({
      executablePath,
      args: [project],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    const size = page.getByLabel("Ping 数据载荷字节数");
    await expect(size).toHaveValue("56");
    await page.getByLabel("ping目标", { exact: true }).fill("127.0.0.1");
    await size.fill("1472");
    await page.getByLabel("Ping 次数", { exact: true }).fill("2");
    await page.getByLabel("请求间隔毫秒").fill("200");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    const log = page.getByLabel("Ping 原始输出");
    await expect(log).toContainText("1472 字节");
    await expect(log).toContainText("请求 #2");
    await expect(log).toContainText("1472 data bytes");
    const text = await log.textContent();
    const displayTime = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/;
    expect(text).toMatch(new RegExp(`\\[${displayTime.source}\\] 请求 #1`));
    expect(text).toMatch(new RegExp(`结束：${displayTime.source}`));
    await expect(page.locator('.result-panel tbody tr').first().locator('td').nth(4)).toHaveText(displayTime);
    // Intercept the write so verification does not replace the user's clipboard.
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = (value) => {
        globalThis.testPingClipboard = value;
      };
    });
    await page
      .getByRole("button", { name: "复制原始记录", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "原始记录已复制" }),
    ).toBeVisible();
    expect(await app.evaluate(() => globalThis.testPingClipboard)).toBe(text);
    const output = path.join(folder, "ping.txt");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole("button", { name: "导出 TXT", exact: true }).click();
    await expect
      .poll(() => fs.readFile(output, "utf8").catch(() => ""))
      .toBe(text);
    const stored = await page.evaluate(() => window.netTool.load());
    expect(stored.history[0].options.payloadSize).toBe(1472);
    expect(stored.history[0].pingLog).toHaveLength(2);
    await size.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("ping-payload-light.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await log.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("ping-log-dark-large.png") });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    const startCell = page.locator('tbody tr').first().locator('td').nth(2);
    await expect(startCell).toHaveText(displayTime);
    const expectedStart = await page.evaluate(value => {
      const d = new Date(value);
      const p = (n, width = 2) => String(n).padStart(width, '0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;
    }, stored.history[0].startedAt);
    await expect(startCell).toHaveText(expectedStart);
    expect((await page.evaluate(() => window.netTool.load())).history[0].startedAt).toBe(stored.history[0].startedAt);
    await page.getByRole("button", { name: "查看记录", exact: true }).click();
    await expect(page.getByLabel("Ping 原始输出")).toHaveText(text);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
