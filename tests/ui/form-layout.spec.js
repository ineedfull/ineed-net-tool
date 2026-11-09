import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, templateNetworks } from "../../src/domain/projects.js";
import { enterpriseConnectivity } from "../../src/domain/enterprise.js";
import { capacityFixture } from "../helpers/capacity-planning.js";
import {
  saveAcceptanceItem,
  recordAcceptanceResult,
  saveAcceptanceAction,
} from "../../src/domain/site-acceptance.js";
import { item, result, action } from "../helpers/site-acceptance.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
test("form geometry and complete display matrix", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(360000);
  const evidence =
    process.env.NET_TOOL_FORM_EVIDENCE_DIR || testInfo.outputPath("evidence");
  await fs.mkdir(evidence, { recursive: true });
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-form-layout-"),
  );
  const state = emptyWorkspace();
  state.projects[0].engineering = capacityFixture().engineering;
  state.projects[0] = saveAcceptanceItem(state.projects[0], item());
  state.projects[0] = recordAcceptanceResult(state.projects[0], result());
  state.projects[0] = recordAcceptanceResult(
    state.projects[0],
    result({ id: "r2", outcome: "passed" }),
  );
  state.projects[0] = saveAcceptanceAction(
    state.projects[0],
    action({ resolvedByResultId: "" }),
  );
  state.networks = [
    {
      id: "network",
      projectId: "default-project",
      name: "测试网段",
      cidr: "192.168.10.0/24",
      gateway: "192.168.10.1",
      note: "",
      allocations: [],
    },
  ];
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  const enterpriseNetworks = templateNetworks(
    "enterprise-dual",
    "10.60.0.0/16",
    "default-project",
  );
  state.projects[0].connectivity = enterpriseConnectivity(
    "10.60.0.0/16",
    "10.80.0.0/16",
    enterpriseNetworks,
  );
  state.projects[0].engineering.infrastructure.devices[0].name =
    "长设备名称与关联端点 ".repeat(7);
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  let app;
  let previewPage;
  let previewBrowser;
  const measurements = [];
  try {
    if (testInfo.project.metadata.preview) {
      previewBrowser = await playwright.chromium.launch({
        channel: testInfo.project.use.channel || "chromium",
      });
      previewPage = await previewBrowser.newPage({
        baseURL: testInfo.project.use.baseURL,
      });
      await previewPage.addInitScript((workspace) => {
        localStorage.setItem(
          "ineed-net-tool-preview-v1",
          JSON.stringify(workspace),
        );
      }, state);
      await previewPage.goto("/");
    } else
      app = await electron.launch({
        executablePath: process.env.ELECTRON_BINARY,
        args: [root],
        env: { ...process.env, NET_TOOL_TEST_DATA: folder },
      });
    const page = previewPage || (await app.firstWindow());
    page.setDefaultTimeout(7000);
    const button = (name) => page.getByRole("button", { name, exact: true });
    const tab = (name) => page.getByRole("tab", { name, exact: true });
    const close = async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    const audit = async (name, prefix, modal = true) => {
      const scope = modal
        ? page.getByRole("dialog")
        : page.locator(".page-content");
      await expect(scope).toBeVisible();
      const geometry = await scope.evaluate((el) => {
        const rect = (e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const visible = (e) => e.getClientRects().length > 0;
        const controls = [
          ...el.querySelectorAll(
            "input:not([type=checkbox]):not([type=radio]),select",
          ),
        ]
          .filter(visible)
          .map((e) => ({
            label:
              e.getAttribute("aria-label") ||
              e.closest("label")?.textContent.trim(),
            type: e.type,
            ...rect(e),
            parent: rect(e.parentElement),
            grid: !!e.closest(".field-grid"),
            toolbar: !!e.closest(".form-row"),
          }));
        const grids = [...el.querySelectorAll(".field-grid")].map((grid) =>
          [...grid.querySelectorAll("label")]
            .filter((e) => e.parentElement === grid && visible(e))
            .map((e) => {
              const c = e.querySelector(
                "input:not([type=checkbox]):not([type=radio]),select",
              );
              return c
                ? {
                    label: e.textContent.trim(),
                    field: rect(e),
                    control: rect(c),
                  }
                : null;
            })
            .filter(Boolean),
        );
        const body = el.querySelector(".dialog-body");
        const footer = el.querySelector(".dialog-footer");
        return {
          controls,
          grids,
          overflow: el.scrollWidth - el.clientWidth,
          bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
          footer: footer ? rect(footer) : null,
          viewport: { width: innerWidth, height: innerHeight },
          focus: !el.matches("dialog") || el.contains(document.activeElement),
        };
      });
      measurements.push({ name, prefix, ...geometry });
      await fs.writeFile(
        path.join(evidence, "geometry.json"),
        JSON.stringify(measurements, null, 2),
      );
      await page.screenshot({
        path: path.join(evidence, `${prefix}-${name}.png`),
      });
      expect(geometry.overflow, `${name}: outer overflow`).toBeLessThanOrEqual(
        1,
      );
      expect(
        geometry.bodyOverflow,
        `${name}: body overflow`,
      ).toBeLessThanOrEqual(1);
      expect(geometry.focus, `${name}: native modal focus`).toBe(true);
      if (geometry.footer)
        expect(geometry.footer.y + geometry.footer.height).toBeLessThanOrEqual(
          geometry.viewport.height,
        );
      for (const c of geometry.controls) {
        expect(
          Math.abs(c.height - 32),
          `${name}: ${c.label} height`,
        ).toBeLessThanOrEqual(1);
        if (c.type === "number" && c.toolbar)
          expect(c.width, `${name}: compact numeric toolbar`).toBe(140);
        expect(c.x, `${name}: control left edge`).toBeGreaterThanOrEqual(0);
        expect(
          c.x + c.width,
          `${name}: control right edge`,
        ).toBeLessThanOrEqual(geometry.viewport.width);
        if (c.grid)
          expect(
            Math.abs(c.width - c.parent.width),
            `${name}: ${c.label} column fill`,
          ).toBeLessThanOrEqual(1);
      }
      for (const row of geometry.grids)
        for (const a of row)
          for (const b of row)
            if (
              a !== b &&
              Math.abs(a.field.x - b.field.x) > 1 &&
              Math.min(a.field.y + a.field.height, b.field.y + b.field.height) -
                Math.max(a.field.y, b.field.y) >
                1
            ) {
              expect(
                Math.abs(a.control.y - b.control.y),
                `${name}: adjacent control tops`,
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(
                  a.control.y +
                    a.control.height -
                    b.control.y -
                    b.control.height,
                ),
                `${name}: adjacent control bottoms`,
              ).toBeLessThanOrEqual(1);
            }
    };
    // Always first: this meaningful regression fails on the old global 140px numeric width.
    await button("项目工作台").click();
    await tab("场地与需求").click();
    await button("添加需求").click();
    await audit("numeric-red-green", "baseline");
    await close();
    if (process.env.NET_TOOL_FORM_RED_ONLY) return;
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
          else await close();
          if (previewPage)
            await page.setViewportSize({ width: size[0], height: size[1] });
          else
            await app.evaluate(
              ({ BrowserWindow }, size) =>
                BrowserWindow.getAllWindows()[0].setSize(...size),
              size,
            );
          for (const collapsed of [false, true]) {
            const toggle = button(collapsed ? "折叠导航" : "展开导航");
            if (await toggle.count()) await toggle.click();
            const prefix = `${theme}-${large ? "large" : "normal"}-${size[0]}-${collapsed ? "collapsed" : "expanded"}`;
            await button("项目工作台").click();
            const modal = async (name, opener) => {
              await opener();
              await audit(name, prefix);
              await close();
            };
            await modal("project-create", () => button("新建项目").click());
            await modal("project-edit", () => button("编辑项目").click());
            await tab("场地与需求").click();
            for (const [name, title] of [
              ["location", "位置"],
              ["demand", "需求"],
            ])
              await modal(name, () => button("添加" + title).click());
            await modal("access-capacity", () =>
              page.getByRole("button", { name: /^编辑容量 / }).click(),
            );
            await tab("设备与连接").click();
            for (const title of ["设备", "接口", "连接"])
              await modal("inventory-" + title, () =>
                button("添加" + title).click(),
              );
            await tab("PoE与带宽").click();
            for (const title of ["整机预算", "PoE负载", "上联", "业务项"])
              await modal("capacity-" + title, () =>
                button("添加" + title).click(),
              );
            await tab("IP 地址台账").click();
            await modal("ledger", () => button("登记地址").click());
            await tab("接入与互通").click();
            await modal("carrier-line", () =>
              page
                .getByRole("button", { name: "编辑中国电信线路", exact: true })
                .click(),
            );
            await modal("connectivity-rule", () =>
              button("添加互通规则").click(),
            );
            await tab("维护记录").click();
            await modal("maintenance", () => button("添加维护记录").click());
            await tab("现场验收").click();
            for (const title of [
              "添加检查项",
              "记录结果",
              "登记整改",
              "选择复验闭环",
            ])
              await modal("acceptance-" + title, () => button(title).click());
            await tab("地址规划").click();
            await audit("network-planning", prefix, false);
            await button("网段计算").click();
            await page
              .getByLabel("IP 地址或 CIDR", { exact: true })
              .fill("192.168.50.0/24");
            await audit("subnet-calculator-split", prefix, false);
            await modal("calculator-save", () =>
              button("加入项目规划").click(),
            );
            await button("生成划分方案").click();
            await modal("subnet-edit", () =>
              page
                .getByRole("button", { name: /^编辑子网 / })
                .first()
                .click(),
            );
            await modal("subnet-save", () =>
              button("将划分结果加入项目").click(),
            );
            for (const title of [
              "IP 地址探测",
              "Ping 工具",
              "路由探测",
              "DNS 查询",
              "端口扫描",
              "网速与质量",
              "证书检查",
            ]) {
              await button(title).click();
              await audit("diagnostic-" + title, prefix, false);
              if (title === "网速与质量") {
                await button("链路质量").click();
                await page
                  .getByLabel("质量测试方式", { exact: true })
                  .selectOption("tcp");
                await audit("diagnostic-quality-tcp", prefix, false);
              }
            }
            await modal("settings", () => button("设置").click());
          }
        }
  } finally {
    await fs.writeFile(
      path.join(evidence, "geometry.json"),
      JSON.stringify(measurements, null, 2),
    );
    if (app) await app.close();
    if (previewPage) await previewPage.close();
    if (previewBrowser) await previewBrowser.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
