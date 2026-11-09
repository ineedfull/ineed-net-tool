import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
import { infrastructureFixture } from "../helpers/infrastructure.js";
import { siteAcceptanceReport } from "../../src/domain/site-acceptance.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
test("site acceptance native lifecycle and display matrix", async ({}, testInfo) => {
  test.setTimeout(300000);
  const evidence =
    process.env.NET_TOOL_ACCEPTANCE_EVIDENCE_DIR ||
    testInfo.outputPath("evidence");
  await fs.mkdir(evidence, { recursive: true });
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-acceptance-ui-"),
  );
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const state = emptyWorkspace();
  state.projects[0].engineering = infrastructureFixture().engineering;
  state.projects[0].engineering.infrastructure.devices[0].name =
    "交换机 · 长标签与区域端点显示验证".repeat(4);
  state.projects.push(newProject("other", "无设备的新项目"));
  state.networks = [
    {
      id: "network",
      projectId: "default-project",
      name: "实际关联网段",
      cidr: "192.168.10.0/24",
      gateway: "192.168.10.1",
      note: "隔离数据不扫描",
      allocations: [],
    },
  ];
  state.projects[0].engineering.demands[0].networkId = "network";
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
    page.setDefaultTimeout(10000);
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
    const load = () => page.evaluate(() => window.netTool.load());
    const current = async () => {
      const s = await load();
      return s.projects.find((p) => p.id === s.activeProjectId);
    };
    const save = async (name) => {
      await button("保存" + name).click();
      await closed();
    };
    const row = (name) =>
      page.locator(".acceptance-item").filter({
        has: page.getByRole("heading", {
          name: new RegExp("^" + name + " "),
        }),
      });
    const add = async (
      name,
      type = "project",
      target = "",
      method = "manual",
    ) => {
      await button("添加检查项").click();
      await label("检查项名称").fill(name);
      await label("关联类型").selectOption(type);
      if (target) await label("关联目标").selectOption(target);
      await label("检查方法").selectOption(method);
      await label("明确预期").fill(
        "明确单位与验收标准：符合设计，连接正确。".repeat(40),
      );
      await label("负责人").fill("现场工程师");
      await save("检查项");
    };
    const result = async (name, outcome, actual, historyId = "") => {
      await row(name)
        .getByRole("button", { name: "记录结果", exact: true })
        .click();
      await expect(label("测量时间")).toHaveAttribute("type", "datetime-local");
      await expect(label("测量时间")).toHaveAttribute("step", "0.001");
      await label("测量时间").fill("2026-10-27T12:34:56.789");
      await label("登记人").fill("工程师甲");
      await label("人工结论").selectOption(outcome);
      await label("实际情况").fill(actual);
      if (historyId)
        await page
          .getByRole("dialog")
          .getByLabel("诊断记录", { exact: true })
          .selectOption(historyId);
      await save("结果");
    };
    await button("项目工作台").click();
    await expect(tab("现场验收")).toBeVisible();
    await tab("现场验收").click();
    await expect(
      page.getByText("尚未登记现场验收", { exact: true }),
    ).toBeVisible();
    expect((await current()).engineering).not.toHaveProperty("siteAcceptance");
    // Default project-only check requires no inventory and enables optional data only at save.
    await label("当前项目").selectOption("other");
    await tab("现场验收").click();
    await button("添加检查项").click();
    await label("检查项名称").fill("取消的草稿");
    await escape();
    expect(await current()).not.toHaveProperty("engineering");
    await add("纯项目检查");
    expect((await current()).engineering).toHaveProperty("siteAcceptance");
    expect((await current()).engineering).not.toHaveProperty("infrastructure");
    await label("当前项目").selectOption("default-project");
    // Real TCP localhost diagnostic through the actual native UI, saved by the normal lifecycle.
    await button("端口扫描").click();
    await label("ports目标").fill("127.0.0.1");
    await label("扫描端口").fill(String(server.address().port));
    await button("开始测试").click();
    await expect(page.locator(".section-heading .badge").first()).toHaveText(
      "已完成",
    );
    await expect.poll(async () => (await load()).history.length).toBe(1);
    const source = (await load()).history[0];
    expect(source.status).toBe("completed");
    expect(source.summary.open).toBe(1);
    await button("项目工作台").click();
    await tab("现场验收").click();
    await add("连通验收", "link", "link", "ports");
    await result(
      "连通验收",
      "failed",
      "端口开放但现场标准未达标，人工判定失败",
      source.id,
    );
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "未通过",
    );
    expect(
      (await current()).engineering.siteAcceptance.results[0].measuredAt,
    ).toBe(
      await page.evaluate(() =>
        new Date("2026-10-27T12:34:56.789").toISOString(),
      ),
    );
    const snapshot = (await current()).engineering.siteAcceptance.results[0]
      .evidence;
    const recordedTarget = `${state.projects[0].engineering.infrastructure.devices[0].name} · 区域 / 1 → 终端 · 区域 / 1`;
    expect(
      (await current()).engineering.siteAcceptance.results[0].criteria
        .targetLabel,
    ).toBe(recordedTarget);
    await row("连通验收")
      .getByRole("button", { name: "查看结果 #1", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .locator("dd")
        .filter({ hasText: recordedTarget }),
    ).toHaveText(recordedTarget);
    await escape();
    expect(snapshot.sourceId).toBe(source.id);
    expect(snapshot).not.toHaveProperty("rows");
    expect(snapshot).not.toHaveProperty("raw");
    await row("连通验收")
      .getByRole("button", { name: "登记整改", exact: true })
      .click();
    await label("整改说明").fill("更换线缆并复核现场标准");
    await label("负责人").fill("整改负责人");
    await label("计划日期").fill("2026-10-28");
    await save("整改");
    await row("连通验收")
      .getByRole("button", { name: "选择复验闭环", exact: true })
      .click();
    await expect(
      page.getByText("尚无有效复验，请先记录当前要求的通过结果。"),
    ).toBeVisible();
    await escape();
    await row("连通验收")
      .getByRole("button", { name: "编辑整改", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "编辑整改", exact: true }),
    ).toBeVisible();
    await label("备注").fill("复验前保留");
    await save("整改");
    await result("连通验收", "passed", "复验已符合明确预期", source.id);
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "整改中",
    );
    await row("连通验收")
      .getByRole("button", { name: "选择复验闭环", exact: true })
      .click();
    await label("通过复验").selectOption({ index: 1 });
    await button("确认复验闭环").click();
    await closed();
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "通过",
    );
    await result(
      "连通验收",
      "failed",
      "后来再次失败，不能沿用旧通过",
      source.id,
    );
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "未通过",
    );
    await row("连通验收")
      .getByRole("button", { name: "编辑检查项", exact: true })
      .click();
    await label("明确预期").fill(
      "提高标准，要求现场链路和端口均符合新标准。".repeat(40),
    );
    await save("检查项");
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "待验收",
    );
    await expect(row("连通验收")).toContainText("要求已变化，需复验");
    await result("连通验收", "passed", "当前第二版重新通过", source.id);
    await expect(row("连通验收").locator(".acceptance-status")).toHaveText(
      "通过",
    );
    await add("设备检查", "device", "dev1");
    await result("设备检查", "inconclusive", "待现场确认铭牌");
    await add("接口检查", "interface", "port1");
    await result("接口检查", "passed", "人工确认接口标签正确");
    // Unreferenced check can be deleted; populated check cannot.
    await add("可删除检查");
    await row("可删除检查")
      .getByRole("button", { name: "编辑检查项", exact: true })
      .click();
    await button("删除检查项").click();
    await button("确认删除").click();
    await closed();
    await expect(row("可删除检查")).toHaveCount(0);
    await row("连通验收")
      .getByRole("button", { name: "编辑检查项", exact: true })
      .click();
    await button("删除检查项").click();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    // Acceptance reference protects the actual parent link even with historical results.
    await button("前往设备与连接").click();
    await page.getByRole("button", { name: /^编辑连接 / }).click();
    await button("删除连接").click();
    await button("确认删除").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await escape();
    await tab("现场验收").click();
    // SQLite trigger rejects actual persistence; draft, focus, busy guard and retry stay correct.
    const trigger = async (sql) =>
      app.evaluate(
        (_, { folder, sql }) => {
          const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
          const db = new DatabaseSync(folder + "/workspace.sqlite");
          db.exec(sql);
          db.close();
        },
        { folder, sql },
      );
    await trigger(
      "CREATE TRIGGER acceptance_fail BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'acceptance-save-failure'); END",
    );
    await row("设备检查")
      .getByRole("button", { name: "编辑检查项", exact: true })
      .click();
    await label("备注").fill("保存失败后保留草稿并重试");
    const pending = await page.evaluate(async () => {
      const f = document.querySelector(".acceptance-form");
      f.requestSubmit();
      f.requestSubmit();
      await Promise.resolve();
      return {
        disabled: f.querySelector(".primary").disabled,
        focusInside: f.closest("dialog").contains(document.activeElement),
      };
    });
    expect(pending).toEqual({ disabled: true, focusInside: true });
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(label("备注")).toHaveValue("保存失败后保留草稿并重试");
    expect(
      (await current()).engineering.siteAcceptance.items.find(
        (i) => i.name === "设备检查",
      ).note,
    ).toBe("");
    await trigger("DROP TRIGGER acceptance_fail");
    await save("检查项");
    expect((await current()).engineering.siteAcceptance.items).toHaveLength(3);
    // Programmatic project switch while a modal is open unmounts its draft.
    await button("添加检查项").click();
    await label("检查项名称").fill("不跨项目的草稿");
    await label("当前项目").evaluate((el) => {
      el.value = "other";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await closed();
    await tab("现场验收").click();
    expect(
      (await current()).engineering.siteAcceptance.items.map((i) => i.name),
    ).toEqual(["纯项目检查"]);
    await label("当前项目").selectOption("default-project");
    await tab("现场验收").click();
    // Actual 25-sheet file roundtrip: dialogs are redirected, XLSX bytes are real.
    const original = await current(),
      file = path.join(folder, "acceptance.xlsx");
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
    expect(workbook.getWorksheet("现场验收报告").rowCount).toBeGreaterThan(8);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await button("导入 Excel").click();
    await expect(page.getByRole("dialog")).toContainText("3 项验收检查");
    await expect(page.getByRole("dialog")).toContainText("6 条验收结果");
    await expect(page.getByRole("dialog")).toContainText("1 条整改");
    await button("确认导入为新项目").click();
    await closed();
    const imported = await current();
    expect(imported.id).not.toBe(original.id);
    const beforeIds = [
      ...original.engineering.siteAcceptance.items,
      ...original.engineering.siteAcceptance.results,
      ...original.engineering.siteAcceptance.actions,
      ...original.engineering.infrastructure.devices,
      ...original.engineering.infrastructure.interfaces,
      ...original.engineering.infrastructure.links,
    ].map((r) => r.id);
    const afterPlan = imported.engineering.siteAcceptance;
    expect(
      [...afterPlan.items, ...afterPlan.results, ...afterPlan.actions].every(
        (r) => !beforeIds.includes(r.id),
      ),
    ).toBe(true);
    expect(afterPlan.results[0].evidence).toEqual(snapshot);
    expect(afterPlan.results[0].evidence.sourceId).toBe(source.id);
    expect(afterPlan.items.find((i) => i.name === "连通验收").targetId).toBe(
      imported.engineering.infrastructure.links[0].id,
    );
    expect(
      siteAcceptanceReport(imported, (await load()).networks).counts,
    ).toEqual({ total: 3, passed: 2, failed: 0, rectifying: 0, pending: 1 });
    await tab("现场验收").click();
    // Isolated retention fixture: remove original history from SQLite, then restart all processes.
    // Planning IPC intentionally cannot rewrite diagnostic history.
    await app.evaluate((_, folder) => {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      const db = new DatabaseSync(folder + "/workspace.sqlite");
      db.exec("DELETE FROM history");
      db.close();
    }, folder);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await tab("现场验收").click();
    expect((await load()).history).toEqual([]);
    expect(
      (await current()).engineering.siteAcceptance.results[0].evidence,
    ).toEqual(snapshot);
    await row("连通验收")
      .getByRole("button", { name: "查看结果 #1", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(source.id);
    await expect(page.getByRole("dialog")).toContainText("诊断任务状态");
    await escape();
    await row("连通验收")
      .getByRole("button", { name: "登记整改", exact: true })
      .click();
    await label("整改说明").fill(
      "闭环窗口显示检查：明确选择当前版最新通过复验",
    );
    await save("整改");
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
            const openings = [
              [
                "closure",
                () =>
                  row("连通验收")
                    .getByRole("button", { name: "选择复验闭环", exact: true })
                    .click(),
              ],
              [
                "item",
                () =>
                  row("连通验收")
                    .getByRole("button", { name: "编辑检查项", exact: true })
                    .click(),
              ],
              [
                "result",
                () =>
                  row("连通验收")
                    .getByRole("button", { name: "记录结果", exact: true })
                    .click(),
              ],
              [
                "action",
                () =>
                  row("连通验收")
                    .getByRole("button", { name: "登记整改", exact: true })
                    .click(),
              ],
              [
                "detail",
                () =>
                  row("连通验收")
                    .getByRole("button", { name: "查看结果 #1", exact: true })
                    .click(),
              ],
            ];
            for (const [kind, opening] of openings) {
              await opening();
              if (kind === "closure") {
                await expect(label("通过复验")).toHaveValue("");
                await expect(label("通过复验").locator("option")).toHaveCount(
                  2,
                );
                await label("通过复验").selectOption({ index: 1 });
                expect(
                  await label("通过复验").evaluate(
                    (el) => el.selectedOptions[0].textContent,
                  ),
                ).toContain("#4");
                expect(
                  await label("通过复验").evaluate(
                    (el) => el.selectedOptions[0].textContent,
                  ),
                ).toContain("当前第二版重新通过");
              }
              const header = await page.locator(".dialog-header").boundingBox(),
                footer = await page.locator(".dialog-footer").boundingBox(),
                height = await page.evaluate(() => innerHeight);
              expect(header.y).toBeGreaterThanOrEqual(0);
              expect(footer.y + footer.height).toBeLessThanOrEqual(height);
              expect(
                await page
                  .getByRole("dialog")
                  .evaluate((el) => el.scrollWidth <= el.clientWidth),
              ).toBe(true);
              await page.screenshot({
                path: path.join(evidence, prefix + "-" + kind + "-top.png"),
              });
              await page
                .locator(".dialog-body")
                .evaluate((el) => (el.scrollTop = el.scrollHeight));
              await page.keyboard.press("Tab");
              expect(
                await page
                  .getByRole("dialog")
                  .evaluate((el) => el.contains(document.activeElement)),
              ).toBe(true);
              await page.screenshot({
                path: path.join(evidence, prefix + "-" + kind + "-bottom.png"),
              });
              await escape();
            }
          }
        }
    expect(matrix).toBe(16);
    expect(errors).toEqual([]);
    const persisted = await load();
    await fs.writeFile(
      path.join(evidence, "persisted.json"),
      JSON.stringify(persisted, null, 2),
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await tab("现场验收").click();
    const restored = await load();
    expect(restored).toEqual(persisted);
    await expect(page.locator(".acceptance-summary")).toContainText("3 项检查");
    await fs.writeFile(
      path.join(evidence, "summary.json"),
      JSON.stringify(
        {
          matrix,
          formsPerState: 5,
          screenshots: 176,
          diagnosticKind: source.kind,
          diagnosticTarget: source.target,
          diagnosticSourceId: source.id,
          roundtripSheets: workbook.worksheets.length,
          fullProcessRestartEquality: true,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(folder, { recursive: true, force: true });
  }
});
