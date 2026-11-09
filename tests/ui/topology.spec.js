import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
import { topologyFixture } from "../helpers/topology.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
test("registered topology, VLAN findings, explicit acceptance and 16 display combinations", async ({}, info) => {
  test.setTimeout(240000);
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-topology-ui-"),
  );
  const f = topologyFixture(),
    state = emptyWorkspace();
  f.project.engineering.infrastructure.interfaces.find(
    (p) => p.id === "uplink2",
  ).logicalConfig.allowedVlans = [30];
  state.projects = [f.project, newProject("other", "独立空项目")];
  state.networks = f.networks;
  state.activeProjectId = f.project.id;
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  const app = await electron.launch({
    executablePath: process.env.ELECTRON_BINARY,
    args: [root],
    env: { ...process.env, NET_TOOL_TEST_DATA: folder },
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    const tab = (name) => page.getByRole("tab", { name, exact: true });
    await tab("工程拓扑").click();
    await expect(page.locator(".topology-panel")).toContainText(
      "Trunk 缺少业务 VLAN 20",
    );
    await page.getByLabel("拓扑位置").selectOption("floor");
    await expect(page.locator(".topology-node")).toHaveCount(3);
    await button("拓扑设备 sw2").click();
    await expect(page.getByRole("dialog")).toContainText("编辑设备");
    await button("取消").click();
    await tab("工程拓扑").click();
    await tab("设备与连接").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await tab("工程拓扑").click();
    await page
      .locator(".topology-findings tr")
      .filter({ hasText: "uplink2：Trunk 缺少业务 VLAN 20" })
      .first()
      .getByRole("button", { name: "建立验收检查", exact: true })
      .click();
    await expect(tab("现场验收")).toHaveAttribute("aria-selected", "true");
    let loaded = await page.evaluate(() => window.netTool.load());
    expect(loaded.projects[0].engineering.siteAcceptance.items).toHaveLength(1);
    expect(loaded.projects[0].engineering.siteAcceptance.results).toHaveLength(
      0,
    );
    await tab("工程拓扑").click();
    await page
      .locator(".topology-findings tr")
      .filter({ hasText: "uplink2：Trunk 缺少业务 VLAN 20" })
      .first()
      .getByRole("button", { name: "编辑接口", exact: true })
      .click();
    await page.getByLabel("允许 VLAN").fill("20,30");
    await button("保存接口").click();
    await tab("工程拓扑").click();
    await expect(page.locator(".topology-findings")).toHaveCount(0);
    await expect(page.locator(".topology-panel")).toContainText("登记参数一致");
    let count = 0;
    for (const theme of ["light", "dark"])
      for (const large of [false, true])
        for (const size of [
          [1440, 900],
          [920, 620],
        ]) {
          await button("设置").click();
          await page.getByLabel("主题", { exact: true }).selectOption(theme);
          await page.getByLabel("大字模式", { exact: true }).setChecked(large);
          if (await button("保存设置").isEnabled())
            await button("保存设置").click();
          else await button("取消").click();
          await app.evaluate(
            ({ BrowserWindow }, size) =>
              BrowserWindow.getAllWindows()[0].setSize(...size),
            size,
          );
          for (const collapsed of [false, true]) {
            const toggle = button(collapsed ? "折叠导航" : "展开导航");
            if (await toggle.count()) await toggle.click();
            expect(
              await page
                .locator(".page-content")
                .evaluate((n) => n.scrollWidth <= n.clientWidth),
            ).toBe(true);
            await page
              .locator(".topology-graph")
              .evaluate((node) => node.scrollIntoView({ block: "center" }));
            await expect(page.locator(".topology-graph")).toBeInViewport({
              ratio: 1,
            });
            await page.screenshot({
              path: info.outputPath(
                `${theme}-${large}-${size[0]}-${collapsed}-topology.png`,
              ),
            });
            await button("拓扑接口 uplink2").click();
            const allowed = page.getByLabel("允许 VLAN");
            await allowed.focus();
            await expect(allowed).toBeInViewport({ ratio: 1 });
            await page.screenshot({
              path: info.outputPath(
                `${theme}-${large}-${size[0]}-${collapsed}-logical-form.png`,
              ),
            });
            await button("取消").click();
            await tab("工程拓扑").click();
            count++;
          }
        }
    expect(count).toBe(16);
    await button("拓扑接口 uplink2").click();
    await page.getByLabel("允许 VLAN").fill("99");
    await button("取消").click();
    await page.getByLabel("当前项目").selectOption("other");
    await tab("工程拓扑").click();
    await expect(page.locator(".topology-panel")).toContainText("尚未登记设备");
    await page.getByLabel("当前项目").selectOption("project");
    await tab("工程拓扑").click();
    await button("拓扑接口 uplink2").click();
    await expect(page.getByLabel("允许 VLAN")).toHaveValue("20,30");
    await button("取消").click();
    await page.reload();
    await tab("工程拓扑").click();
    await expect(page.locator(".topology-findings")).toHaveCount(0);
    loaded = await page.evaluate(() => window.netTool.load());
    expect(
      loaded.projects[0].engineering.infrastructure.interfaces.find(
        (p) => p.id === "uplink2",
      ).logicalConfig.allowedVlans,
    ).toEqual([20, 30]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
