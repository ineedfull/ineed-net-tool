import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");
test("enterprise template: independent spaces, WAN editing, policy ordering, Excel and restart", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-enterprise-ui-"),
  );
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("大型双网园区");
    await page.getByRole("radio", { name: /大型项目/ }).check();
    await page.getByLabel("外网地址空间", { exact: true }).fill("10.60.0.0/16");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "不能重叠",
    );
    await page.getByLabel("外网地址空间", { exact: true }).fill("10.80.0.0/16");
    await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(8);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(page.locator(".network-table tbody tr")).toHaveCount(8);
    const enterpriseId = await page.getByLabel("当前项目").inputValue();
    await page.getByRole("tab", { name: "接入与互通", exact: true }).click();
    await expect(page.locator(".uplink-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".policy-table")).toContainText("默认拒绝");
    await page.screenshot({
      path: info.outputPath("enterprise-topology-light.png"),
    });
    await page.locator(".policy-table").scrollIntoViewIfNeeded();
    await page.locator(".policy-table tbody tr").nth(1).hover();
    await page.screenshot({
      path: info.outputPath("enterprise-actions-light.png"),
    });
    await page
      .getByRole("button", { name: "编辑中国电信线路", exact: true })
      .click();
    await page.getByLabel("带宽（Mbps）", { exact: true }).fill("1000");
    await page
      .getByLabel("线路备注", { exact: true })
      .fill("总部主线路，联通与移动备用");
    await page.getByRole("button", { name: "保存规划", exact: true }).click();
    await expect(page.locator(".uplink-table")).toContainText("1000 Mbps");
    await page
      .getByRole("button", { name: "添加互通规则", exact: true })
      .click();
    await page.getByLabel("规则名称", { exact: true }).fill("指定终端访问 DMZ");
    await page
      .getByLabel("来源 IPv4/CIDR", { exact: true })
      .fill("10.60.0.20/32");
    await page
      .getByLabel("目标 IPv4/CIDR", { exact: true })
      .fill("10.60.4.10/32");
    await page.getByRole("button", { name: "保存规划", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "分别位于内网、外网",
    );
    await page
      .getByLabel("目标 IPv4/CIDR", { exact: true })
      .fill("10.80.8.10/32");
    await page
      .getByLabel("规划状态", { exact: true })
      .selectOption({ label: "启用（仍需现场配置）" });
    await page.getByRole("button", { name: "保存规划", exact: true }).click();
    await page
      .getByRole("button", { name: "上移规则 指定终端访问 DMZ", exact: true })
      .click();
    await expect(page.locator(".policy-table tbody tr").nth(1)).toContainText(
      "指定终端访问 DMZ",
    );
    const output = path.join(folder, "enterprise.xlsx");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole("button", { name: "导出 Excel", exact: true }).click();
    await expect
      .poll(() =>
        fs.stat(output).then(
          (s) => s.size,
          () => 0,
        ),
      )
      .toBeGreaterThan(0);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, output);
    await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("3 条运营商线路");
    await expect(page.getByRole("dialog")).toContainText("3 条互通规则");
    await page
      .getByRole("button", { name: "确认导入为新项目", exact: true })
      .click();
    await page.getByRole("tab", { name: "接入与互通", exact: true }).click();
    await expect(page.locator(".policy-table tbody tr").nth(1)).toContainText(
      "指定终端访问 DMZ",
    );
    await page
      .getByRole("button", { name: "删除规则 指定终端访问 DMZ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认删除规则", exact: true })
      .click();
    await expect(page.locator(".policy-table tbody tr")).toHaveCount(3);
    await page.getByLabel("当前项目").selectOption(enterpriseId);
    await page.getByRole("tab", { name: "接入与互通", exact: true }).click();
    await expect(page.locator(".policy-table tbody tr")).toHaveCount(4);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "接入与互通", exact: true }).click();
    await page.locator(".policy-table").scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("enterprise-policies-dark-large.png"),
    });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "接入与互通", exact: true }).click();
    await expect(page.locator(".uplink-table")).toContainText("1000 Mbps");
    await expect(page.locator(".policy-table tbody tr").nth(1)).toContainText(
      "指定终端访问 DMZ",
    );
    // Editing a large project then creating a blank project must not copy its policies.
    await page.getByRole("button", { name: "编辑项目", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("独立空白项目");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "接入与互通", exact: true }),
    ).toHaveCount(0);
    const state = await page.evaluate(() => window.netTool.load());
    expect(
      state.projects.find((p) => p.name === "独立空白项目").connectivity,
    ).toBeUndefined();
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
