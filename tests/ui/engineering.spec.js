import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
const evidence =
  "/Users/pangzhigang/develop/com.ineedfull/ai-workspace/ineed-tools/scratch/2026-10-14-engineering-phase-a";
test("engineering: native CRUD, risk, unknown, save failure, Excel, restart and display matrix", async () => {
  test.setTimeout(180000);
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-engineering-"),
  );
  let app;
  const state = emptyWorkspace();
  state.projects.push(newProject("other-project", "另一项目"));
  state.networks.push({
    id: "office-network",
    projectId: "default-project",
    name: "办公网段",
    cidr: "192.168.1.0/24",
    gateway: "192.168.1.1",
    vlan: 10,
    dhcpStart: "192.168.1.100",
    dhcpEnd: "192.168.1.250",
    note: "",
    allocations: [],
  });
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  const launch = () =>
    electron.launch({
      executablePath: process.env.ELECTRON_BINARY,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await expect(
      page.getByText("从现场位置与业务需求开始", { exact: true }),
    ).toBeVisible();
    const addLocation = async (name, kind, parent = "") => {
      await page.getByRole("button", { name: "添加位置", exact: true }).click();
      await page.getByLabel("位置名称", { exact: true }).fill(name);
      await page.getByLabel("位置类型", { exact: true }).selectOption(kind);
      if (parent)
        await page
          .getByLabel("上级位置", { exact: true })
          .selectOption({ label: parent });
      await page.getByRole("button", { name: "保存位置", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await addLocation("独立区域", "area");
    await addLocation("总部", "building");
    await addLocation("一层", "floor", "总部");
    await addLocation("办公室", "area", "总部 / 一层");
    const addDemand = async (name, kind, count) => {
      await page.getByRole("button", { name: "添加需求", exact: true }).click();
      await page
        .getByLabel("关联区域", { exact: true })
        .selectOption({ label: "总部 / 一层 / 办公室" });
      await page.getByLabel("需求名称", { exact: true }).fill(name);
      await page.getByLabel("业务类型", { exact: true }).selectOption(kind);
      await page.getByLabel("当前数量", { exact: true }).fill(count);
      await page
        .getByLabel("已保存网段", { exact: true })
        .selectOption("office-network");
      await page.getByRole("button", { name: "保存需求", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await addDemand("办公终端", "wired", "40");
    await addDemand("无线AP", "ap", "4");
    const officeRow = () =>
      page
        .locator(".engineering-capacities tbody tr")
        .filter({ hasText: "办公室" });
    await expect(officeRow()).toContainText("53");
    const setCapacity = async (number) => {
      await page
        .getByRole("button", { name: "编辑容量 办公室", exact: true })
        .click();
      await page.getByLabel("可用业务接入端口", { exact: true }).fill(number);
      await page
        .getByRole("button", { name: "保存接入容量", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await setCapacity("48");
    await expect(officeRow()).toContainText("容量不足");
    await setCapacity("60");
    await expect(officeRow()).toContainText("容量充足");
    await addDemand("无线客户端", "wireless", "120");
    await expect(officeRow()).toContainText("53");
    await expect(
      page
        .locator(".engineering-demands tbody tr")
        .filter({ hasText: "无线客户端" }),
    ).toContainText("144 / 0");
    await page
      .getByRole("button", { name: "编辑需求 办公终端", exact: true })
      .click();
    await page.getByLabel("当前数量", { exact: true }).fill("41");
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(officeRow()).toContainText("55");
    await addDemand("待核实", "camera", "");
    await expect(officeRow()).toContainText("已知小计");
    await page
      .locator(".engineering-issues button")
      .filter({ hasText: "部分端口需求数量待补充" })
      .click();
    await expect(page.getByLabel("需求名称", { exact: true })).toHaveValue(
      "待核实",
    );
    await page.keyboard.press("Escape");
    await expect(officeRow()).toContainText("待补充");
    await page
      .getByRole("button", { name: "编辑位置 总部", exact: true })
      .click();
    await page.getByRole("button", { name: "删除位置", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "位置仍被引用",
    );
    await page.keyboard.press("Escape");
    await app.evaluate(async (_, data) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(data + "/workspace.sqlite");
      db.exec(
        "CREATE TRIGGER engineering_fail BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'engineering-save-failure'); END",
      );
      db.close();
    }, folder);
    await page
      .getByRole("button", { name: "编辑需求 办公终端", exact: true })
      .click();
    await page.getByLabel("当前数量", { exact: true }).fill("42");
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("当前数量", { exact: true })).toHaveValue(
      "42",
    );
    await app.evaluate(async (_, data) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(data + "/workspace.sqlite");
      db.exec("DROP TRIGGER engineering_fail");
      db.close();
    }, folder);
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("tab", { name: "地址规划", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "删除 办公网段", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("网段");
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await page.getByRole("button", { name: "添加需求", exact: true }).click();
    await page.getByLabel("需求名称", { exact: true }).fill("不能跨项目保存");
    await page.keyboard.press("Escape");
    await page.getByLabel("当前项目").selectOption("other-project");
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await expect(
      page.getByText("从现场位置与业务需求开始", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("当前项目").selectOption("default-project");
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await page.getByRole("button", { name: "添加需求", exact: true }).click();
    await page.getByLabel("需求名称", { exact: true }).fill("临时需求");
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "编辑需求 临时需求", exact: true })
      .click();
    await page.getByRole("button", { name: "删除需求", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "编辑需求 临时需求", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "编辑容量 办公室", exact: true })
      .click();
    await page
      .getByRole("button", { name: "删除接入容量", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(officeRow()).toContainText("待补充");
    await setCapacity("60");
    await page.getByRole("tab", { name: "地址规划", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑 办公网段", exact: true })
      .click();
    await page.getByLabel("网段名称", { exact: true }).fill("保留规划草稿");
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await page
      .locator(".engineering-issues button")
      .filter({ hasText: "DHCP" })
      .first()
      .click();
    await expect(
      page.getByRole("tab", { name: "地址规划", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("网段名称", { exact: true })).toHaveValue(
      "保留规划草稿",
    );
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    const original = await page.evaluate(() => window.netTool.load());
    const currentId = await page.getByLabel("当前项目").inputValue();
    const file = path.join(folder, "engineering.xlsx");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await page.getByRole("button", { name: "导出 Excel", exact: true }).click();
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
    await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "4 个位置 · 4 条需求 · 1 条接入容量",
    );
    await page
      .getByRole("button", { name: "确认导入为新项目", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const imported = await page.evaluate(() => window.netTool.load());
    const newId = await page.getByLabel("当前项目").inputValue();
    expect(newId).not.toBe(currentId);
    const oldIds = original.projects
      .find((p) => p.id === currentId)
      .engineering.locations.map((l) => l.id);
    expect(
      imported.projects
        .find((p) => p.id === newId)
        .engineering.locations.every((l) => !oldIds.includes(l.id)),
    ).toBe(true);
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    for (const theme of ["light", "dark"])
      for (const large of [false, true])
        for (const size of [
          [1440, 900],
          [920, 620],
        ]) {
          await page.getByRole("button", { name: "设置", exact: true }).click();
          await page.getByLabel("主题", { exact: true }).selectOption(theme);
          await page.getByLabel("大字模式", { exact: true }).setChecked(large);
          if (
            await page
              .getByRole("button", { name: "保存设置", exact: true })
              .isEnabled()
          )
            await page
              .getByRole("button", { name: "保存设置", exact: true })
              .click();
          else await page.keyboard.press("Escape");
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
            const button = page.getByRole("button", {
              name: collapsed ? "折叠导航" : "展开导航",
              exact: true,
            });
            if (await button.count()) await button.click();
            expect(
              await page
                .locator(".page-content")
                .evaluate((el) => el.scrollWidth <= el.clientWidth),
            ).toBe(true);
            await page
              .getByRole("button", { name: "添加需求", exact: true })
              .click();
            const box = await page.locator(".dialog-footer").boundingBox();
            expect(box.y + box.height).toBeLessThanOrEqual(
              await page.evaluate(() => innerHeight),
            );
            await page.keyboard.press("Escape");
          }
          if (
            size[0] === 1440 &&
            ((theme === "light" && !large) || (theme === "dark" && large))
          )
            await page.screenshot({
              path: path.join(
                evidence,
                `engineering-${theme}${large ? "-large" : ""}.png`,
              ),
            });
        }
    await page.locator(".engineering-report").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(evidence, "engineering-report-dark-large-narrow.png"),
    });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await expect(page.locator(".engineering-demands tbody tr")).toHaveCount(4);
    await page.getByLabel("当前项目").selectOption(currentId);
    await expect(
      page.getByRole("tab", { name: "地址规划", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("engineering: type change preserves saved inputs and explicit defaults affect only units and mode", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-engineering-kind-"),
  );
  let app;
  const state = emptyWorkspace();
  state.networks.push({
    id: "saved-network",
    projectId: "default-project",
    name: "工程网络",
    cidr: "192.168.2.0/24",
    gateway: "192.168.2.1",
    vlan: 10,
    dhcpStart: "192.168.2.100",
    dhcpEnd: "192.168.2.200",
    note: "",
    allocations: [],
  });
  const original = {
    id: "saved-demand",
    locationId: "saved-area",
    name: "自定义终端",
    kind: "wired",
    count: 40,
    growthPercent: 35,
    addressesPerUnit: 2,
    portsPerUnit: 3,
    addressMode: "static",
    networkId: "saved-network",
    note: "保留现场说明",
  };
  state.projects[0].engineering = {
    version: 1,
    locations: [
      {
        id: "saved-area",
        parentId: "",
        kind: "area",
        name: "测试区域",
        note: "",
      },
    ],
    demands: [original],
    capacities: [],
  };
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  try {
    app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "场地与需求", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑需求 自定义终端", exact: true })
      .click();
    await page.getByLabel("业务类型", { exact: true }).selectOption("wireless");
    await page.screenshot({
      path: path.join(evidence, "engineering-type-defaults-light.png"),
    });
    for (const [label, expected] of [
      ["当前数量", "40"],
      ["增长预留百分比", "35"],
      ["每单位地址数", "2"],
      ["每单位接入端口数", "3"],
      ["地址分配方式", "static"],
      ["已保存网段", "saved-network"],
      ["关联区域", "saved-area"],
      ["需求名称", "自定义终端"],
      ["备注", "保留现场说明"],
    ])
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(
        expected,
      );
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    let data = await page.evaluate(() => window.netTool.load());
    expect(data.projects[0].engineering.demands[0]).toEqual({
      ...original,
      kind: "wireless",
    });
    await page
      .getByRole("button", { name: "编辑需求 自定义终端", exact: true })
      .click();
    await page
      .getByRole("button", { name: "采用类型默认值", exact: true })
      .click();
    await expect(page.getByLabel("当前数量", { exact: true })).toHaveValue(
      "40",
    );
    await expect(
      page.getByLabel("增长预留百分比", { exact: true }),
    ).toHaveValue("35");
    await page.getByRole("button", { name: "保存需求", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    data = await page.evaluate(() => window.netTool.load());
    expect(data.projects[0].engineering.demands[0]).toEqual({
      ...original,
      kind: "wireless",
      addressesPerUnit: 1,
      portsPerUnit: 0,
      addressMode: "dhcp",
    });
    await page.getByRole("button", { name: "添加需求", exact: true }).click();
    await page.getByLabel("当前数量", { exact: true }).fill("40");
    await page.getByLabel("增长预留百分比", { exact: true }).fill("35");
    await page.getByLabel("业务类型", { exact: true }).selectOption("wireless");
    await expect(page.getByLabel("当前数量", { exact: true })).toHaveValue(
      "40",
    );
    await expect(
      page.getByLabel("增长预留百分比", { exact: true }),
    ).toHaveValue("35");
    await expect(
      page.getByLabel("每单位接入端口数", { exact: true }),
    ).toHaveValue("0");
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
