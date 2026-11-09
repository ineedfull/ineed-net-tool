import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");

test("operation feedback supports dismissal, readable timeouts and persistent errors", async ({}, info) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nettool-feedback-"));
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "网段计算", exact: true }).click();
    await page.clock.install();
    const banner = page.locator(".feedback-banner.success");
    const save = async () => {
      await page
        .getByRole("button", { name: "加入项目规划", exact: true })
        .click();
      await page
        .getByRole("button", { name: "保存到项目", exact: true })
        .click();
      await expect(banner).toBeVisible();
      await page.mouse.move(0, 0);
    };
    await save();
    await page.screenshot({ path: info.outputPath("dismissible-success.png") });
    await banner.getByRole("button", { name: "关闭提示" }).click();
    await expect(banner).toHaveCount(0);

    await save();
    await banner.hover();
    await page.clock.fastForward(15000);
    await expect(banner).toBeVisible();
    await page.mouse.move(0, 0);
    await banner.getByRole("button", { name: "关闭提示" }).focus();
    await page.clock.fastForward(15000);
    await expect(banner).toBeVisible();
    await page.getByLabel("IP 地址或 CIDR").focus();
    await page.clock.fastForward(5000);
    await expect(banner).toBeVisible();
    await page.clock.fastForward(2000);
    await expect(banner).toHaveCount(0);

    // Repeating the same operation must start a new reading interval.
    await save();
    await page.clock.fastForward(4000);
    await save();
    await page.clock.fastForward(3000);
    await expect(banner).toBeVisible();
    await page.clock.fastForward(4000);
    await expect(banner).toHaveCount(0);

    // The calculator is cached with KeepAlive; its timer pauses off-screen.
    await save();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.clock.fastForward(15000);
    await page.getByRole("button", { name: "网段计算", exact: true }).click();
    await expect(banner).toBeVisible();
    await page.clock.fastForward(7000);
    await expect(banner).toHaveCount(0);

    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByLabel("网段名称", { exact: true }).fill("");
    await page.getByRole("button", { name: "保存网段", exact: true }).click();
    const failure = page.locator(".feedback-banner.error");
    await expect(failure).toContainText("请为网段填写名称");
    await page.clock.fastForward(15000);
    await expect(failure).toBeVisible();
    await failure.getByRole("button", { name: "关闭提示" }).click();
    await expect(failure).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
