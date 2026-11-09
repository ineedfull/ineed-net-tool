import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");
test("scan table/grid switch preserves results and settings preview, default and restart work", async ({}, info) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nettool-scan-view-"));
  let app;
  const launch = () =>
    electron.launch({
      executablePath,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "表格", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "紧凑网格", exact: true }).click();
    await expect(page.locator(".scan-address-cell")).toHaveCount(254);
    await expect(page.locator(".scan-address-cell").first()).toHaveAttribute(
      "aria-label",
      /未探测/,
    );
    await page.screenshot({
      path: info.outputPath("grid-preview-light.png"),
      scale: "css",
    });
    await page.getByLabel("scan目标").fill("10.0.0.0/23");
    await expect(page.getByLabel("地址区块")).toHaveValue("10.0.0");
    await page.getByRole("button", { name: "下一区块", exact: true }).click();
    await expect(page.getByLabel("地址区块")).toHaveValue("10.0.1");
    await expect(page.locator(".scan-address-cell").first()).toHaveAttribute(
      "aria-label",
      /10\.0\.1\.0/,
    );
    await page.getByLabel("scan目标").fill("0.0.0.0/0");
    await expect(page.locator(".scan-grid-view")).toContainText("65,536");
    await page.getByLabel("scan目标").fill("127.0.0.1-127.0.0.32");
    await page.getByLabel("超时毫秒").fill("200");
    await page.getByLabel("探测方式").selectOption("combined");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    await expect(page.locator(".scan-address-cell")).toHaveCount(32);
    await page.locator(".scan-address-cell").first().click();
    await expect(page.getByLabel("地址详情")).toContainText("127.0.0.1");
    await expect(page.getByLabel("地址详情")).toContainText("有响应");
    await page.getByLabel("结果状态筛选").selectOption("reachable");
    const reachable = await page.locator(".scan-address-cell").count();
    expect(reachable).toBeGreaterThan(0);
    await page.getByRole("button", { name: "表格", exact: true }).click();
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(reachable);
    await page.getByLabel("结果状态筛选").selectOption("all");
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(32);
    expect(
      (await page.evaluate(() => window.netTool.load())).history,
    ).toHaveLength(1);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("IP 默认显示方式").selectOption("compact");
    await expect(page.locator(".scan-address-cell")).toHaveCount(32);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(32);
    expect(
      (await page.evaluate(() => window.netTool.load())).settings.ipView,
    ).toBe("table");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("IP 默认显示方式").selectOption("compact");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.locator(".scan-address-cell")).toHaveCount(32);
    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await expect(page.locator(".scan-address-cell")).toHaveCount(32);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    await page.locator(".result-panel").scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.locator(".scan-address-cell").first().click();
    await page.screenshot({
      path: info.outputPath("grid-result-dark-large.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "表格", exact: true }).click();
    expect(
      (await page.evaluate(() => window.netTool.load())).settings.ipView,
    ).toBe("compact");
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "紧凑网格", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".scan-address-cell")).toHaveCount(254);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
