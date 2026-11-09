import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
test("infrastructure native lifecycle and display matrix", async ({}, testInfo) => {
  const evidence =
    process.env.NET_TOOL_INFRASTRUCTURE_EVIDENCE_DIR ||
    testInfo.outputPath("evidence");
  test.setTimeout(240000);
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-infrastructure-ui-"),
  );
  const state = emptyWorkspace();
  state.projects.push(newProject("other", "另一项目"));
  state.projects[0].engineering = {
    version: 1,
    locations: [
      { id: "area", parentId: "", kind: "area", name: "办公室", note: "" },
    ],
    demands: [
      {
        id: "demand",
        locationId: "area",
        name: "终端",
        kind: "wired",
        count: 1,
        growthPercent: 0,
        addressesPerUnit: 1,
        portsPerUnit: 1,
        addressMode: "static",
        networkId: "",
        note: "",
      },
    ],
    capacities: [
      { id: "capacity", locationId: "area", accessPorts: 48, note: "" },
    ],
  };
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  let app;
  const launch = () =>
    electron.launch({
      executablePath: process.env.ELECTRON_BINARY,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await expect(
      page.getByText("尚未登记设备与连接", { exact: true }),
    ).toBeVisible();

    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    const label = (name) => page.getByLabel(name, { exact: true });
    const closed = () => expect(page.getByRole("dialog")).toHaveCount(0);
    const save = async (kind) => {
      await button("保存" + kind).click();
      await closed();
    };
    const escape = async () => {
      await page.keyboard.press("Escape");
      await closed();
    };
    const addDevice = async (name) => {
      await button("添加设备").click();
      await expect(
        page.getByRole("dialog", { name: "添加设备", exact: true }),
      ).toBeVisible();
      await label("设备名称").fill(name);
      await save("设备");
    };
    const addPort = async (name, deviceName) => {
      await button("添加接口").click();
      await label("接口名称").fill(name);
      await label("所属设备").selectOption({ label: deviceName + " · 办公室" });
      await save("接口");
    };
    const editPort = (name) =>
      page.getByRole("button", {
        name: "编辑接口 " + name + " 交换机 · 办公室",
        exact: true,
      });
    await addDevice("交换机");
    await addDevice("终端");
    await addPort("LAN1", "交换机");
    await addPort("ETH1", "终端");
    await expect(page.locator(".infrastructure-capacities")).toContainText(
      "已登记容量满足已知需求",
    );
    await expect(page.locator(".infrastructure-capacities")).toContainText(
      "48",
    );
    await button("添加接口").click();
    await label("接口名称").fill("LAN1");
    await label("所属设备").selectOption({ label: "交换机 · 办公室" });
    await button("保存接口").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "名称重复",
    );
    await escape();
    const connect = async () => {
      await button("添加连接").click();
      await label("起点接口").selectOption({
        label: "交换机 · 办公室 / LAN1 · 可用",
      });
      await label("终点接口").selectOption({
        label: "终端 · 办公室 / ETH1 · 可用",
      });
    };
    await connect();
    await save("连接");
    await expect(page.locator(".infrastructure-links tbody tr")).toHaveCount(1);
    await connect();
    await button("保存连接").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await editPort("LAN1").click();
    await label("所属设备").selectOption({ label: "终端 · 办公室" });
    await button("保存接口").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "不同设备",
    );
    await escape();
    await editPort("LAN1").click();
    await label("接口状态").selectOption("reserved");
    await button("保存接口").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await editPort("LAN1").click();
    await expect(
      page.getByRole("dialog", { name: "编辑接口", exact: true }),
    ).toBeVisible();
    await button("删除接口").click();
    await expect(
      page.getByRole("dialog", { name: "删除接口", exact: true }),
    ).toBeVisible();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "解除连接",
    );
    await escape();
    await button("编辑设备 交换机").click();
    await button("删除设备").click();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "接口引用",
    );
    await escape();
    await button("前往场地与需求").click();
    await button("编辑位置 办公室").click();
    await button("删除位置").click();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    // An inventory-only area is protected independently of phase A references.
    await button("前往场地与需求").click();
    await button("添加位置").click();
    await label("位置名称").fill("设备专用区");
    await save("位置");
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await button("添加设备").click();
    await label("设备名称").fill("区域保护设备");
    await label("设备区域").selectOption({ label: "设备专用区" });
    await save("设备");
    await button("前往场地与需求").click();
    await button("编辑位置 设备专用区").click();
    await button("删除位置").click();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "设备引用",
    );
    await escape();
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await button("编辑设备 区域保护设备").click();
    await button("删除设备").click();
    await button("确认删除").click();
    await closed();
    await button("前往场地与需求").click();
    await button("编辑位置 设备专用区").click();
    await button("删除位置").click();
    await button("确认删除").click();
    await closed();
    await button("编辑需求 终端").click();
    await label("当前数量").fill("");
    await save("需求");
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await expect(page.locator(".infrastructure-capacities")).toContainText(
      "另有 1 条待补充",
    );
    await button("前往场地与需求").click();
    await button("编辑需求 终端").click();
    await label("当前数量").fill("1");
    await save("需求");
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await app.evaluate((_, data) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(data + "/workspace.sqlite");
      db.exec(
        "CREATE TRIGGER infrastructure_fail BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'infrastructure-save-failure'); END",
      );
      db.close();
    }, folder);
    await button("编辑设备 交换机").click();
    await label("设备型号").fill("保留草稿");
    const pendingSave = await page.evaluate(async () => {
      const form = document.querySelector(".infrastructure-form");
      form.requestSubmit();
      form.requestSubmit(); // A duplicate event must be ignored while pending.
      await Promise.resolve();
      return {
        disabled: form.querySelector("button.primary").disabled,
        focusInside: form.closest("dialog").contains(document.activeElement),
      };
    });
    expect(pendingSave).toEqual({ disabled: true, focusInside: true });
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(label("设备型号")).toHaveValue("保留草稿");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await app.evaluate((_, data) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(data + "/workspace.sqlite");
      db.exec("DROP TRIGGER infrastructure_fail");
      db.close();
    }, folder);
    await save("设备");
    // Programmatic project switch while the native modal is open also clears the old draft.
    await button("添加设备").click();
    await label("设备名称").fill("旧项目未保存");
    await label("当前项目").evaluate((el) => {
      el.value = "other";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await closed();
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await expect(
      page.getByText("尚未登记设备与连接", { exact: true }),
    ).toBeVisible();
    await expect(button("添加设备")).toBeDisabled();
    await label("当前项目").selectOption("default-project");
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await expect(page.locator(".infrastructure-devices tbody tr")).toHaveCount(
      2,
    );
    // Recalculate occupancy and capacity after removal, without changing the hand-entered 48.
    await page.locator(".infrastructure-links button").click();
    await button("删除连接").click();
    await button("确认删除").click();
    await closed();
    await editPort("LAN1").click();
    await label("接口状态").selectOption("reserved");
    await save("接口");
    await page
      .getByRole("button", { name: "编辑接口 ETH1 终端 · 办公室", exact: true })
      .click();
    await label("接口角色").selectOption("uplink");
    await save("接口");
    await expect(page.locator(".infrastructure-capacities")).toContainText(
      "已登记容量不足",
    );
    await expect(page.locator(".infrastructure-capacities")).toContainText(
      "48",
    );
    await editPort("LAN1").click();
    await label("接口状态").selectOption("available");
    await save("接口");
    await connect();
    await save("连接");
    await addDevice("临时设备");
    await button("编辑设备 临时设备").click();
    await button("删除设备").click();
    await button("确认删除").click();
    await closed();
    await addPort("TEMP", "交换机");
    await editPort("TEMP").click();
    await button("删除接口").click();
    await button("确认删除").click();
    await closed();
    const original = await page.evaluate(() => window.netTool.load());
    const currentId = await label("当前项目").inputValue();
    const file = path.join(folder, "infrastructure.xlsx");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await button("导出 Excel").click();
    await expect
      .poll(() =>
        fs.stat(file).then(
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
    }, file);
    await button("导入 Excel").click();
    await expect(page.getByRole("dialog")).toContainText(
      "2 台设备 · 2 个接口 · 1 条连接",
    );
    await button("确认导入为新项目").click();
    await closed();
    const imported = await page.evaluate(() => window.netTool.load());
    const newId = await label("当前项目").inputValue();
    expect(newId).not.toBe(currentId);
    const old = original.projects.find((p) => p.id === currentId).engineering;
    const fresh = imported.projects.find((p) => p.id === newId).engineering;
    const oldIds = [
      ...old.locations,
      ...old.infrastructure.devices,
      ...old.infrastructure.interfaces,
      ...old.infrastructure.links,
    ].map((r) => r.id);
    expect(
      [
        ...fresh.locations,
        ...fresh.infrastructure.devices,
        ...fresh.infrastructure.interfaces,
        ...fresh.infrastructure.links,
      ].every((r) => !oldIds.includes(r.id)),
    ).toBe(true);
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    for (const theme of ["light", "dark"])
      for (const large of [false, true])
        for (const size of [
          [1440, 900],
          [920, 620],
        ]) {
          await button("设置").click();
          await label("主题").selectOption(theme);
          await label("大字模式").setChecked(large);
          if (await button("保存设置").isEnabled())
            await button("保存设置").click();
          else await escape();
          await app.evaluate(
            ({ BrowserWindow }, size) =>
              BrowserWindow.getAllWindows()[0].setSize(...size),
            size,
          );
          expect(
            await app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0].getSize(),
            ),
          ).toEqual(size);
          for (const collapsed of [false, true]) {
            const toggle = button(collapsed ? "折叠导航" : "展开导航");
            if (await toggle.count()) await toggle.click();
            expect(
              await page
                .locator(".page-content")
                .evaluate((el) => el.scrollWidth <= el.clientWidth),
            ).toBe(true);
            for (const kind of ["设备", "接口", "连接"]) {
              await button("添加" + kind).click();
              await expect(
                page.getByRole("dialog", { name: "添加" + kind, exact: true }),
              ).toBeVisible();
              const box = await page.locator(".dialog-footer").boundingBox();
              expect(box.y).toBeGreaterThanOrEqual(0);
              expect(box.y + box.height).toBeLessThanOrEqual(
                await page.evaluate(() => innerHeight),
              );
              await page.keyboard.press("Tab");
              expect(
                await page
                  .getByRole("dialog")
                  .evaluate((el) => el.contains(document.activeElement)),
              ).toBe(true);
              if (
                theme === "dark" &&
                large &&
                size[0] === 920 &&
                collapsed &&
                kind === "接口"
              ) {
                await fs.mkdir(evidence, { recursive: true });
                await page.screenshot({
                  path: path.join(
                    evidence,
                    "infrastructure-dialog-dark-large-narrow.png",
                  ),
                });
              }
              await escape();
            }
            if (
              (theme === "light" && !large && size[0] === 1440 && !collapsed) ||
              (theme === "dark" && large && size[0] === 920 && collapsed)
            ) {
              await fs.mkdir(evidence, { recursive: true });
              await page.screenshot({
                path: path.join(
                  evidence,
                  `infrastructure-${theme}-${size[0]}.png`,
                ),
              });
            }
          }
        }
    await page.locator(".infrastructure-links").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(
        evidence,
        "infrastructure-connections-dark-large-narrow.png",
      ),
    });
    await page.locator(".infrastructure-capacities").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(
        evidence,
        "infrastructure-capacity-dark-large-narrow.png",
      ),
    });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await button("项目工作台").click();
    await page.getByRole("tab", { name: "设备与连接", exact: true }).click();
    await expect(page.locator(".infrastructure-devices tbody tr")).toHaveCount(
      2,
    );
    await expect(page.locator(".infrastructure-links tbody tr")).toHaveCount(1);
    await expect(page.locator(".infrastructure-devices")).toContainText(
      "保留草稿",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
