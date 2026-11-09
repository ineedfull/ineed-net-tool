import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("native desktop: planning, scan, ping, route, persisted history and consistent layouts", async ({}, info) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "net-tool-ui-"));
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
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible();
    await page.getByLabel("网段名称", { exact: true }).fill("办公网络");
    await page.getByRole("button", { name: "保存网段", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("网段规划已保存");
    await page.getByRole("button", { name: "登记地址", exact: true }).click();
    await page
      .getByLabel("分配 IPv4 地址", { exact: true })
      .fill("192.168.1.10");
    await page.getByLabel("设备说明", { exact: true }).fill("PLC");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(
      page.locator(".ledger-table td").filter({ hasText: "PLC" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "网段计算", exact: true }).click();
    await page
      .getByRole("button", { name: "生成划分方案", exact: true })
      .click();
    await expect(
      page.locator(".subnet-results tbody tr").first(),
    ).toContainText("192.168.1.0/26");
    await page.screenshot({ path: info.outputPath("planner-light.png") });

    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await expect(page.getByLabel("扫描并发数")).toHaveValue("32");
    await expect(page.getByLabel("扫描并发数")).toHaveAttribute("max", "128");
    await page.getByLabel("scan目标").fill("127.0.0.1");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(1);
    await expect(page.locator(".result-panel")).toContainText("有响应");
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    await page.screenshot({ path: info.outputPath("scan-light.png") });

    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    await page.getByLabel("Ping 次数", { exact: true }).fill("2");
    await page.getByLabel("请求间隔毫秒").fill("200");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(2);
    await expect(page.locator(".chart-loss")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("ping-light.png") });
    await page.getByLabel("Ping 次数", { exact: true }).fill("0");
    await page.getByRole("button", { name: "重新探测", exact: true }).click();
    await expect(page.locator(".result-panel tbody tr").first()).toBeVisible();
    await page
      .getByRole("button", { name: "项目工作台", exact: true })
      .click();
    await expect(page.getByLabel("网段名称", { exact: true })).toHaveValue(
      "办公网络",
    );
    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已停止",
    );

    await page.getByRole("button", { name: "路由探测", exact: true }).click();
    await page.getByLabel("最大跳数").fill("3");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".result-panel")).toContainText("已到达目标");
    await page.screenshot({ path: info.outputPath("route-light.png") });
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "查看记录", exact: true }),
    ).toHaveCount(4);

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page
      .getByRole("button", { name: "项目工作台", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await page.screenshot({ path: info.outputPath("planner-dark-960.png") });
    for (const label of [
      "项目工作台",
      "IP 地址探测",
      "Ping 工具",
      "路由探测",
      "设置",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      expect(
        await page
          .locator(".page-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "办公网络", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "查看记录", exact: true }),
    ).toHaveCount(4);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("parallel scan batches retain every result in the UI and saved history", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "net-tool-parallel-ui-"),
  );
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [project],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await page.getByLabel("scan目标").fill("127.0.0.1-127.0.0.32");
    await page.getByLabel("超时毫秒").fill("300");
    await page.getByLabel("探测方式").selectOption("combined");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    await expect(page.locator(".result-panel tbody tr")).toHaveCount(32);
    await expect(page.locator(".scan-progress")).toContainText("32 / 32");
    await expect(page.locator(".scan-progress")).toContainText("32 路并发");
    expect(
      new Set(
        await page
          .locator(".result-panel tbody tr td:nth-child(2)")
          .allTextContents(),
      ).size,
    ).toBe(32);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("parallel-scan.png") });
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    await page.getByRole("button", { name: "查看记录", exact: true }).click();
    await expect(page.locator(".result-scroll tbody tr")).toHaveCount(32);
    const stored = await page.evaluate(() => window.netTool.load());
    expect(stored.history[0].rows).toHaveLength(32);
    expect(stored.history[0].elapsedMs).toBeGreaterThan(0);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
