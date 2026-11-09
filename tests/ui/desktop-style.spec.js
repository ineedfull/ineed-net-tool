import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const project = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("desktop family: navigation, modal focus, appearance preview and saved preferences", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "net-tool-appearance-"),
  );
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [project],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible();
    await page.getByLabel("网段名称", { exact: true }).fill("未保存的规划");
    await page.screenshot({
      path: info.outputPath("planner-light.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "折叠导航", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "展开导航", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "IP 地址探测", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "IP 地址探测", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("collapsed-light.png"),
      scale: "css",
    });
    await page
      .getByRole("button", { name: "项目工作台", exact: true })
      .click();
    await expect(page.getByLabel("网段名称", { exact: true })).toHaveValue(
      "未保存的规划",
    );
    await page.getByRole("button", { name: "展开导航", exact: true }).click();

    await page.getByRole("button", { name: "关于", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "关于", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("about-light.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "关闭关于", exact: true }).click();

    const settingsButton = page.getByRole("button", {
      name: "设置",
      exact: true,
    });
    await settingsButton.click();
    const settingsDialog = page.getByRole("dialog", {
      name: "设置",
      exact: true,
    });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭设置" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "关闭设置" })).toBeFocused();
    await page.screenshot({
      path: info.outputPath("settings-light.png"),
      scale: "css",
    });
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await expect(page.locator(".net-app")).toHaveClass(/large-font/);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "放弃修改", exact: true }),
    ).toBeVisible();
    await expect(settingsDialog).toBeVisible();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(page.getByLabel("大字模式", { exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect(settingsDialog).not.toBeVisible();
    await expect(settingsButton).toBeFocused();
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "light",
    );
    await expect(page.locator(".net-app")).not.toHaveClass(/large-font/);
    await expect(page.getByLabel("网段名称", { exact: true })).toHaveValue(
      "未保存的规划",
    );

    await settingsButton.click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.screenshot({
      path: info.outputPath("settings-dark-large.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(settingsDialog).not.toBeVisible();
    const stored = await page.evaluate(() => window.netTool.load());
    expect(stored.settings).toMatchObject({ theme: "dark", largeFont: true });
    await expect(page.getByLabel("网段名称", { exact: true })).toHaveValue(
      "未保存的规划",
    );
    expect(
      await page
        .locator(".metrics code, .metrics .mono")
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("16px");

    const aboutButton = page.getByRole("button", { name: "关于", exact: true });
    await aboutButton.click();
    const about = page.getByRole("dialog", { name: "关于", exact: true });
    await expect(about).toContainText("Ineed NetTool");
    await expect(about).toContainText("SQLite 工作区");
    await page.screenshot({
      path: info.outputPath("about-dark.png"),
      scale: "css",
    });
    await page.keyboard.press("Escape");
    await expect(about).not.toBeVisible();
    await expect(aboutButton).toBeFocused();

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(920, 620),
    );
    for (const label of [
      "项目工作台",
      "IP 地址探测",
      "Ping 工具",
      "路由探测",
      "诊断记录",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      expect(
        await page
          .locator(".page-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator(".net-app")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await settingsButton.click();
    expect(
      await settingsDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const box = await settingsDialog.boundingBox();
    const viewportHeight = await page.evaluate(() => innerHeight);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
    await page.screenshot({
      path: info.outputPath("settings-dark-920.png"),
      scale: "css",
    });
    await page.getByLabel("主题", { exact: true }).selectOption("system");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "light",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator(".net-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
