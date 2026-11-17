import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";
const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("projects: scenarios, ledger, maintenance, Excel preview/import, SQLite restart and diagnostics isolation", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-projects-ui-"),
  );
  const exports = await fs.mkdtemp(path.join(os.tmpdir(), "nettool-projects-exports-"));
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
    await page.getByLabel("项目名称", { exact: true }).fill("总部办公室");
    await page.getByLabel("项目负责人", { exact: true }).fill("张工");
    await page.getByRole("radio", { name: /小型办公室/ }).check();
    await expect(page.getByRole("dialog")).toContainText("192.168.10.0/24");
    await page.screenshot({ path: info.outputPath("project-scenario.png") });
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "总部办公室", exact: true }),
    ).toBeVisible();
    const officeId = await page.getByLabel("当前项目").inputValue();
    await page.screenshot({ path: info.outputPath("office-project.png") });
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await page.getByRole("button", { name: "登记地址", exact: true }).click();
    await page.getByLabel("设备说明", { exact: true }).fill("前台打印机");
    await page.getByLabel("设备类型", { exact: true }).selectOption("printer");
    await page
      .getByLabel("分配 IPv4 地址", { exact: true })
      .fill("192.168.10.100");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "DHCP",
    );
    await page
      .getByRole("button", { name: "建议空闲地址", exact: true })
      .click();
    await expect(
      page.getByLabel("分配 IPv4 地址", { exact: true }),
    ).toHaveValue("192.168.10.2");
    await page.getByLabel("安装位置", { exact: true }).fill("一层前台");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "编辑地址 192.168.10.2", exact: true })
      .click();
    await page
      .getByLabel("登记状态", { exact: true })
      .selectOption("maintenance");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(page.locator(".ledger-table")).toContainText("检修");
    await page.getByRole("tab", { name: "维护记录", exact: true }).click();
    await page
      .getByRole("button", { name: "添加维护记录", exact: true })
      .click();
    await page
      .getByLabel("维护内容", { exact: true })
      .fill("更换前台打印机网线");
    await page.getByLabel("维护负责人", { exact: true }).fill("李工");
    await page
      .getByRole("button", { name: "保存维护记录", exact: true })
      .click();
    await page.getByRole("button", { name: "标记完成", exact: true }).click();
    await expect(page.locator(".maintenance-table")).toContainText("已完成");
    await page.getByRole("button", { name: "Ping 工具", exact: true }).click();
    await page.getByLabel("Ping 次数", { exact: true }).fill("0");
    await page.getByLabel("请求间隔毫秒").fill("200");
    await page.getByRole("button", { name: "开始探测", exact: true }).click();
    await expect(page.getByLabel("当前项目")).toBeDisabled();
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.getByLabel("当前项目")).toBeEnabled();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    const output = path.join(exports, "office.xlsx");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole("button", { name: "导出 Excel", exact: true }).click();
    await expect
      .poll(async () =>
        fs.stat(output).then(
          (s) => s.size,
          () => 0,
        ),
      )
      .toBeGreaterThan(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(output);
    expect(wb.getWorksheet("IP台账").getCell("C3").value).toBe("前台打印机");
    const bad = path.join(folder, "bad.xlsx");
    wb.getWorksheet("IP台账").getCell("B3").value = "192.168.10.1";
    await wb.xlsx.writeFile(bad);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, bad);
    await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("校验未通过");
    expect(
      (await page.evaluate(() => window.netTool.load())).projects,
    ).toHaveLength(2);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, output);
    await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("2 条地址登记");
    expect(
      (await page.evaluate(() => window.netTool.load())).projects,
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "确认导入为新项目", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.netTool.load())).projects,
    ).toHaveLength(3);
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "查看记录", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("当前项目").selectOption(officeId);
    await expect(
      page.getByRole("button", { name: "查看记录", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("园区监控");
    await page.getByRole("radio", { name: /视频监控/ }).check();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "园区监控", exact: true }),
    ).toBeVisible();
    const cameraId = await page.getByLabel("当前项目").inputValue();
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await page.getByRole("button", { name: "登记地址", exact: true }).click();
    await page.getByLabel("登记数量", { exact: true }).fill("12");
    await page.getByLabel("设备类型", { exact: true }).selectOption("camera");
    await page.getByLabel("设备说明", { exact: true }).fill("大门摄像机");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(page.locator(".ledger-table tbody tr")).toHaveCount(15);
    await page.screenshot({ path: info.outputPath("camera-ledger-light.png") });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("camera-ledger-dark-large.png"),
    });
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(
      await page.evaluate(() => innerHeight),
    );
    await page.screenshot({
      path: info.outputPath("project-dialog-dark-large.png"),
    });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByLabel("当前项目")).toHaveValue(cameraId);
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await expect(page.locator(".ledger-table tbody tr")).toHaveCount(15);
    expect(
      (await fs.readFile(path.join(folder, "workspace.sqlite")))
        .subarray(0, 15)
        .toString(),
    ).toBe("SQLite format 3");
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
    await fs.rm(exports, { recursive: true, force: true });
  }
});
