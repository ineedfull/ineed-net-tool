import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
import { capacityFixture } from "../helpers/capacity-planning.js";
import ExcelJS from "exceljs";
import { capacityPlanningReport } from "../../src/domain/capacity-planning.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
test("capacity native lifecycle and display matrix", async ({}, testInfo) => {
  test.setTimeout(300000);
  const evidence =
    process.env.NET_TOOL_CAPACITY_EVIDENCE_DIR ||
    testInfo.outputPath("evidence");
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-capacity-ui-"),
  );
  const state = emptyWorkspace();
  state.projects[0].engineering = capacityFixture().engineering;
  delete state.projects[0].engineering.infrastructure.capacityPlanning;
  const inv = state.projects[0].engineering.infrastructure;
  inv.devices.push({ ...inv.devices[1], id: "dev3", name: "第二终端" });
  inv.interfaces.push(
    { ...inv.interfaces[0], id: "port3", name: "2" },
    { ...inv.interfaces[1], id: "port4", deviceId: "dev3" },
  );
  inv.links.push({
    id: "link2",
    fromInterfaceId: "port3",
    toInterfaceId: "port4",
    note: "",
  });
  state.networks.push({
    id: "network",
    projectId: "default-project",
    name: "实际关联测试网段",
    cidr: "192.168.10.0/24",
    gateway: "192.168.10.1",
    note: "本地隔离数据，未发起探测",
    allocations: [],
  });
  state.projects[0].engineering.demands[0].networkId = "network";
  state.projects.push(newProject("other", "另一项目"));
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
  let app, page;
  try {
    app = await launch();
    page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    const label = (name) => page.getByLabel(name, { exact: true });
    const tab = (name) => page.getByRole("tab", { name, exact: true });
    const closed = () => expect(page.getByRole("dialog")).toHaveCount(0);
    const escape = async () => {
      await page.keyboard.press("Escape");
      await closed();
    };
    const save = async (kind) => {
      await button("保存" + kind).click();
      await closed();
    };
    const remove = async (kind) => {
      await button("删除" + kind).click();
      await expect(
        page.getByRole("dialog", { name: "删除" + kind, exact: true }),
      ).toBeVisible();
      await button("确认删除").click();
    };
    const load = () => page.evaluate(() => window.netTool.load());
    const current = async () => {
      const s = await load();
      return s.projects.find((p) => p.id === s.activeProjectId);
    };
    const edit = async (kind) => {
      await page
        .locator(".capacity-" + kind + " button")
        .first()
        .click();
      const titles = {
        powerBudgets: "整机预算",
        poeLoads: "PoE负载",
        uplinks: "上联",
        trafficDemands: "业务项",
      };
      await expect(
        page.getByRole("dialog", { name: "编辑" + titles[kind], exact: true }),
      ).toBeVisible();
    };
    await button("项目工作台").click();
    await expect(tab("PoE与带宽")).toBeVisible();
    await tab("PoE与带宽").click();
    await expect(
      page.getByText("尚未启用 PoE 与带宽校核", { exact: true }),
    ).toBeVisible();
    expect((await current()).engineering.infrastructure).not.toHaveProperty(
      "capacityPlanning",
    );
    await button("前往设备与连接").click();
    await expect(tab("设备与连接")).toHaveAttribute("aria-selected", "true");
    await tab("PoE与带宽").click();
    await button("添加整机预算").click();
    await expect(label("整机预留 %")).toHaveValue("20");
    await label("整机预算 W").fill("40");
    await save("整机预算");
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "待补充",
    );
    const addLoad = async (linkId = "link") => {
      await button("添加PoE负载").click();
      await label("关联连接").selectOption(linkId);
      await expect(label("损耗预留 %")).toHaveValue("20");
      await label("单口供电预算 W").fill("20");
      await label("设备端功耗 W").fill("12");
      await label("损耗预留 %").fill("25");
      await save("PoE负载");
    };
    await addLoad();
    await addLoad("link2");
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "30 W / 0",
    );
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "32 W / 2 W",
    );
    await expect(page.locator(".capacity-poeLoads")).toContainText("15 W");
    await edit("poeLoads");
    await label("单口供电预算 W").fill("14");
    await save("PoE负载");
    await expect(page.locator(".capacity-poeLoads")).toContainText(
      "已登记参数不足",
    );
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "已登记参数不足",
    );
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "32 W / 2 W",
    );
    await edit("poeLoads");
    await label("单口供电预算 W").fill("20");
    await save("PoE负载");
    // Direction derives the other endpoint; reversing then restoring is explicit in the visible form.
    await edit("poeLoads");
    await label("供电接口").selectOption("port2");
    await expect(page.getByRole("dialog")).toContainText(
      "受电接口：交换机 · 区域 / 1",
    );
    await save("PoE负载");
    await page
      .locator(".capacity-powerBudgets tbody tr")
      .filter({ hasText: "终端 · 区域" })
      .getByRole("button", { name: "添加整机预算", exact: true })
      .click();
    await expect(label("预算设备")).toHaveValue("dev2");
    await escape();
    await edit("poeLoads");
    await label("供电接口").selectOption("port1");
    await save("PoE负载");
    await button("添加上联").click();
    await label("起点速率 Mbps").fill("1000");
    await label("终点速率 Mbps").fill("100");
    await save("上联");
    const addTraffic = async (
      name,
      direction,
      count,
      mbps,
      concurrency,
      growth,
    ) => {
      await button("添加业务项").click();
      await expect(label("并发 %")).toHaveValue("100");
      await expect(label("增长 %")).toHaveValue("20");
      await label("业务名称").fill(name);
      await label("业务方向").selectOption(direction);
      await label("当前数量").fill(count);
      await label("单设备 Mbps").fill(mbps);
      await label("并发 %").fill(concurrency);
      await label("增长 %").fill(growth);
      await save("业务项");
    };
    await addTraffic("正向终端", "forward", "40", "2", "50", "20");
    await expect(page.locator(".capacity-uplinks")).toContainText("无业务项");
    await addTraffic("反向业务", "reverse", "1", "60", "100", "0");
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "48 Mbps / 0",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "80 Mbps / 32 Mbps",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "60 Mbps / 0",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "80 Mbps / 20 Mbps",
    );
    await expect(label("当前项目")).toHaveValue("default-project");
    await edit("trafficDemands");
    await label("并发 %").fill("");
    await save("业务项");
    expect(
      (await current()).engineering.infrastructure.capacityPlanning
        .trafficDemands[0].concurrencyPercent,
    ).toBeNull();
    await expect(page.locator(".capacity-uplinks")).toContainText("0 Mbps / 1");
    await edit("trafficDemands");
    await label("并发 %").fill("0");
    await save("业务项");
    expect(
      (await current()).engineering.infrastructure.capacityPlanning
        .trafficDemands[0].concurrencyPercent,
    ).toBe(0);
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "80 Mbps / 80 Mbps",
    );
    await edit("trafficDemands");
    await label("并发 %").fill("50");
    await label("当前数量").fill("100");
    await save("业务项");
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "120 Mbps / 0",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "已登记参数不足",
    );
    await edit("uplinks");
    await label("终点速率 Mbps").fill("");
    await save("上联");
    await expect(page.locator(".capacity-uplinks")).toContainText("待补充");
    await edit("uplinks");
    await label("起点速率 Mbps").fill("100");
    await save("上联");
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "已登记参数不足",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText("待补充");
    await edit("uplinks");
    await label("起点速率 Mbps").fill("1000");
    await label("终点速率 Mbps").fill("100");
    await save("上联");
    await edit("trafficDemands");
    await label("当前数量").fill("40");
    await save("业务项");
    // Real database rejection, retained draft, retry, native focus and duplicate-submit guard.
    await app.evaluate((_, folder) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(folder + "/workspace.sqlite");
      db.exec(
        "CREATE TRIGGER capacity_fail BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'capacity-save-failure'); END",
      );
      db.close();
    }, folder);
    await edit("powerBudgets");
    await label("备注").fill("数据库失败后保留草稿");
    const pending = await page.evaluate(async () => {
      const f = document.querySelector(".capacity-form");
      f.requestSubmit();
      f.requestSubmit();
      await Promise.resolve();
      return {
        disabled: f.querySelector("button.primary").disabled,
        focusInside: f.closest("dialog").contains(document.activeElement),
      };
    });
    expect(pending).toEqual({ disabled: true, focusInside: true });
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(label("备注")).toHaveValue("数据库失败后保留草稿");
    expect(
      (await current()).engineering.infrastructure.capacityPlanning
        .powerBudgets[0].note,
    ).toBe("");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await app.evaluate((_, folder) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(folder + "/workspace.sqlite");
      db.exec("DROP TRIGGER capacity_fail");
      db.close();
    }, folder);
    await save("整机预算");
    expect(
      (await current()).engineering.infrastructure.capacityPlanning
        .powerBudgets,
    ).toHaveLength(1);
    // All four record types reject duplicate associations or retain referenced rows.
    await button("添加整机预算").click();
    await button("保存整机预算").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await button("添加PoE负载").click();
    await button("保存PoE负载").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await button("添加上联").click();
    await button("保存上联").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await edit("uplinks");
    await remove("上联");
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await button("前往设备与连接").click();
    await page.locator(".infrastructure-links button").first().click();
    await remove("连接");
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await page.locator(".infrastructure-links button").first().click();
    await label("起点接口").selectOption("port2");
    await label("终点接口").selectOption("port1");
    await button("保存连接").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await page.locator(".infrastructure-interfaces button").first().click();
    await remove("接口");
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await button("编辑设备 交换机").click();
    await remove("设备");
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await tab("PoE与带宽").click();
    // Successful delete and recreation for each type; upstream deletion never cascades.
    await edit("trafficDemands");
    await remove("业务项");
    await closed();
    await edit("trafficDemands");
    await remove("业务项");
    await closed();
    await edit("uplinks");
    await remove("上联");
    await closed();
    await edit("poeLoads");
    await remove("PoE负载");
    await closed();
    await edit("poeLoads");
    await remove("PoE负载");
    await closed();
    await edit("powerBudgets");
    await remove("整机预算");
    await closed();
    expect(
      (await current()).engineering.infrastructure.capacityPlanning,
    ).toEqual({
      version: 1,
      powerBudgets: [],
      poeLoads: [],
      uplinks: [],
      trafficDemands: [],
    });
    await expect(page.locator(".capacity-summary")).toContainText("待补充");
    await button("添加整机预算").click();
    await label("整机预算 W").fill("40");
    await label("备注").fill("数据库失败后保留草稿");
    await save("整机预算");
    await addLoad();
    await addLoad("link2");
    await button("添加上联").click();
    await label("起点速率 Mbps").fill("1000");
    await label("终点速率 Mbps").fill("100");
    await save("上联");
    await addTraffic("正向终端", "forward", "40", "2", "50", "20");
    await addTraffic("反向业务", "reverse", "1", "60", "100", "0");
    // Project switch clears the keyed modal/draft, and other project remains absent.
    await button("添加业务项").click();
    await label("业务名称").fill("旧项目未保存");
    await label("当前项目").evaluate((el) => {
      el.value = "other";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await closed();
    await tab("PoE与带宽").click();
    await expect(
      page.getByText("尚未启用 PoE 与带宽校核", { exact: true }),
    ).toBeVisible();
    await expect(button("添加整机预算")).toBeDisabled();
    expect(await current()).not.toHaveProperty("engineering");
    await label("当前项目").selectOption("default-project");
    await tab("PoE与带宽").click();
    // Native XLSX save/open dialogs, actual file, preview, fresh graph IDs and real owned network association.
    const before = await load(),
      file = path.join(folder, "capacity.xlsx");
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.worksheets).toHaveLength(27);
    expect(workbook.getWorksheet("PoE带宽校核").rowCount).toBeGreaterThan(4);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await button("导入 Excel").click();
    await expect(page.getByRole("dialog")).toContainText("1 条电源预算");
    await expect(page.getByRole("dialog")).toContainText("2 条PoE负载");
    await expect(page.getByRole("dialog")).toContainText("2 条业务项");
    await button("确认导入为新项目").click();
    await closed();
    const after = await load(),
      imported = after.projects.find((p) => p.id === after.activeProjectId),
      original = before.projects[0];
    expect(imported.id).not.toBe(original.id);
    const ids = (p) => {
      const e = p.engineering,
        i = e.infrastructure,
        c = i.capacityPlanning;
      return [
        ...e.locations,
        ...e.demands,
        ...e.capacities,
        ...i.devices,
        ...i.interfaces,
        ...i.links,
        ...c.powerBudgets,
        ...c.poeLoads,
        ...c.uplinks,
        ...c.trafficDemands,
      ].map((r) => r.id);
    };
    const oldIds = ids(original);
    expect(ids(imported).every((id) => !oldIds.includes(id))).toBe(true);
    const importedNetwork = after.networks.find(
      (n) => n.projectId === imported.id,
    );
    expect(importedNetwork.id).not.toBe("network");
    expect(imported.engineering.demands[0].networkId).toBe(importedNetwork.id);
    const actual = capacityPlanningReport(imported, after.networks);
    expect(actual.powerBudgets[0].remainingWatts).toBe(2);
    expect(actual.uplinks[0].forward.remainingMbps).toBe(32);
    expect(actual.uplinks[0].reverse.remainingMbps).toBe(20);
    const u = imported.engineering.infrastructure.capacityPlanning.uplinks[0],
      l = imported.engineering.infrastructure.links.find(
        (l) => l.id === u.linkId,
      );
    expect([u.fromInterfaceId, u.toInterfaceId]).toEqual([
      l.fromInterfaceId,
      l.toInterfaceId,
    ]);
    await tab("PoE与带宽").click();
    await fs.mkdir(evidence, { recursive: true });
    // Long labels are real persisted user data, checked in all 16 native display states.
    await button("前往设备与连接").click();
    await button("编辑设备 交换机").click();
    await label("设备名称").fill("交换机 · 长标签与区域端点显示验证".repeat(4));
    await save("设备");
    await tab("PoE与带宽").click();
    let matrix = 0;
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
            const prefix = `${theme}-${large ? "large" : "normal"}-${size[0]}-${collapsed ? "collapsed" : "expanded"}`;
            matrix++;
            expect(
              await page
                .locator(".page-content")
                .evaluate((el) => el.scrollWidth <= el.clientWidth),
            ).toBe(true);
            await page.screenshot({
              path: path.join(evidence, prefix + "-workbench.png"),
            });
            for (const kind of ["整机预算", "PoE负载", "上联", "业务项"]) {
              await button("添加" + kind).click();
              await expect(
                page.getByRole("dialog", { name: "添加" + kind, exact: true }),
              ).toBeVisible();
              const footer = await page.locator(".dialog-footer").boundingBox(),
                header = await page.locator(".dialog-header").boundingBox();
              const height = await page.evaluate(() => innerHeight);
              expect(header.y).toBeGreaterThanOrEqual(0);
              expect(footer.y + footer.height).toBeLessThanOrEqual(height);
              await page.screenshot({
                path: path.join(evidence, prefix + "-" + kind + "-top.png"),
              });
              await page
                .locator(".dialog-body")
                .evaluate((el) => (el.scrollTop = el.scrollHeight));
              await expect(label("备注")).toBeVisible();
              await page.screenshot({
                path: path.join(evidence, prefix + "-" + kind + "-bottom.png"),
              });
              await page.keyboard.press("Tab");
              expect(
                await page
                  .getByRole("dialog")
                  .evaluate((el) => el.contains(document.activeElement)),
              ).toBe(true);
              await page.screenshot({
                path: path.join(evidence, prefix + "-" + kind + ".png"),
              });
              await escape();
            }
          }
        }
    expect(matrix).toBe(16);
    for (const key of [
      "powerBudgets",
      "poeLoads",
      "uplinks",
      "trafficDemands",
    ]) {
      await page.locator(".capacity-" + key).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, "dark-large-narrow-" + key + ".png"),
      });
    }
    expect(errors).toEqual([]);
    const persisted = await current();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await button("项目工作台").click();
    await tab("PoE与带宽").click();
    expect(await current()).toEqual(persisted);
    await expect(page.locator(".capacity-powerBudgets")).toContainText(
      "32 W / 2 W",
    );
    await expect(page.locator(".capacity-uplinks")).toContainText(
      "80 Mbps / 32 Mbps",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("capacity independent synthetic source rows and shared direction conclusions", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-capacity-rows-"),
  );
  const state = emptyWorkspace();
  state.projects[0].engineering = capacityFixture().engineering;
  const inv = state.projects[0].engineering.infrastructure,
    c = inv.capacityPlanning;
  c.powerBudgets = [];
  c.poeLoads[0].portBudgetWatts = 20;
  inv.devices.push({ ...inv.devices[0], id: "source2", name: "独立第二电源" });
  inv.interfaces.push(
    { ...inv.interfaces[0], id: "source-port2", deviceId: "source2" },
    { ...inv.interfaces[1], id: "target-port2", name: "第二受电接口" },
  );
  inv.links.push({
    id: "second-link",
    fromInterfaceId: "source-port2",
    toInterfaceId: "target-port2",
    note: "",
  });
  c.poeLoads.push({
    ...c.poeLoads[0],
    id: "second-load",
    linkId: "second-link",
    sourceInterfaceId: "source-port2",
    targetInterfaceId: "target-port2",
    portBudgetWatts: 1,
  });
  c.uplinks[0].toMbps = null;
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "PoE与带宽", exact: true }).click();
    const rows = page.locator(".capacity-powerBudgets tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("strong")).toHaveText("待补充");
    await expect(rows.nth(1).locator("strong")).toHaveText("已登记参数不足");
    await expect(rows.nth(0)).not.toContainText("关联单口存在不足");
    await expect(rows.nth(1)).toContainText("关联单口存在不足");
    await rows
      .nth(1)
      .getByRole("button", { name: "添加整机预算", exact: true })
      .click();
    await expect(page.getByLabel("预算设备", { exact: true })).toHaveValue(
      "source2",
    );
    await page.getByLabel("整机预算 W", { exact: true }).fill("40");
    await page
      .getByRole("button", { name: "保存整机预算", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const second = rows.filter({ hasText: "独立第二电源" });
    await expect(second.locator("strong")).toHaveText("已登记参数不足");
    await expect(
      second.getByRole("button", { name: /编辑整机预算/ }),
    ).toHaveCount(1);
    await expect(
      rows.filter({ hasText: "交换机" }).locator("strong"),
    ).toHaveText("待补充");
    const stored = await page.evaluate(() => window.netTool.load());
    expect(
      stored.projects[0].engineering.infrastructure.capacityPlanning.powerBudgets.map(
        (r) => r.deviceId,
      ),
    ).toEqual(["source2"]);
    const directions = page.locator(".capacity-uplinks tbody tr");
    await expect(directions.locator("strong")).toHaveText(["待补充", "待补充"]);
    await directions.first().getByRole("button").click();
    await page.getByLabel("终点速率 Mbps", { exact: true }).fill("100");
    await page.getByRole("button", { name: "保存上联", exact: true }).click();
    await expect(directions.locator("strong")).toHaveText([
      "按已登记参数估算满足",
      "按已登记参数估算满足",
    ]);
    await directions.first().getByRole("button").click();
    await page.getByLabel("起点速率 Mbps", { exact: true }).fill("50");
    await page.getByLabel("终点速率 Mbps", { exact: true }).fill("");
    await page.getByRole("button", { name: "保存上联", exact: true }).click();
    await expect(directions.locator("strong")).toHaveText([
      "已登记参数不足",
      "已登记参数不足",
    ]);
    for (let n = 0; n < 2; n++) {
      await page
        .locator(".capacity-trafficDemands tbody tr")
        .first()
        .getByRole("button")
        .click();
      await page
        .getByRole("button", { name: "删除业务项", exact: true })
        .click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await directions.first().getByRole("button").click();
    await page.getByLabel("终点速率 Mbps", { exact: true }).fill("100");
    await page.getByRole("button", { name: "保存上联", exact: true }).click();
    await expect(directions.locator("strong")).toHaveText(["待补充", "待补充"]);
    await expect(directions.nth(0)).toContainText("待登记业务项");
    await expect(directions.nth(1)).toContainText("待登记业务项");
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
