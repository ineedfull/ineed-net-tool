import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("planner stores editable gateways without replacing legacy data", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "net-tool-gateway-ui-"),
  );
  let app;
  const legacy = {
    id: "legacy",
    name: "旧网段",
    note: "保留",
    cidr: "192.168.1.0/24",
    allocations: [{ ip: "192.168.1.10", label: "PLC" }],
  };
  const savedHistory = {
    id: "old-history",
    kind: "ping",
    target: "127.0.0.1",
    startedAt: "2026-09-21T00:00:00Z",
    status: "completed",
    completed: 0,
    rows: [],
  };
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify({
      version: 1,
      networks: [legacy],
      history: [savedHistory],
      settings: { theme: "light", largeFont: false },
    }),
  );
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
    await expect(page.getByLabel("默认网关", { exact: true })).toHaveValue("");
    await expect(page.locator(".multicast-detail")).toHaveCount(0);
    await page
      .getByRole("button", { name: "编辑 旧网段", exact: true })
      .click();
    await page
      .getByRole("button", { name: "使用首个可用地址", exact: true })
      .click();
    await expect(page.getByLabel("默认网关", { exact: true })).toHaveValue(
      "192.168.1.1",
    );
    await page.getByLabel("默认网关", { exact: true }).fill("192.168.2.1");
    await expect(page.locator("#planner-gateway-error")).toContainText(
      "可用地址范围",
    );
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    let stored = await page.evaluate(() => window.netTool.load());
    expect(stored.networks[0]).toMatchObject(legacy);
    await page.getByLabel("默认网关", { exact: true }).fill("192.168.1.254");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect
      .poll(async () =>
        (await page.locator(".banner").allTextContents()).join("\n"),
      )
      .toContain("网段规划已保存");
    stored = await page.evaluate(() => window.netTool.load());
    expect(stored.networks[0]).toMatchObject({
      ...legacy,
      gateway: "192.168.1.254",
    });
    expect(stored.history).toEqual([
      { ...savedHistory, projectId: "default-project" },
    ]);
    await page.locator(".page-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath("gateway-multicast-light.png"),
    });
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
    await page.locator(".page-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator(".network-details")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("gateway-multicast-dark-960.png"),
    });
    await page.getByLabel("IP 地址或 CIDR").fill("10.0.0.0/31");
    await expect(
      page.getByRole("button", { name: "使用首个可用地址", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".multicast-detail")).toHaveCount(0);
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "编辑 旧网段", exact: true })
      .click();
    await expect(page.getByLabel("默认网关", { exact: true })).toHaveValue(
      "192.168.1.254",
    );
    await page.getByLabel("默认网关", { exact: true }).fill("");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("网段规划已保存");
    stored = await page.evaluate(() => window.netTool.load());
    expect(stored.networks[0].gateway).toBe("");
    expect(stored.history).toEqual([
      { ...savedHistory, projectId: "default-project" },
    ]);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
