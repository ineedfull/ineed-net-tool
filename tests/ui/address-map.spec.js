import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { emptyWorkspace, templateNetworks } from "../../src/domain/projects.js";
const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");
test("address map spans project ledger, planner and history; registration and large subnet navigation stay correct", async ({}, info) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-address-map-"),
  );
  let app;
  const state = emptyWorkspace();
  state.settings.ipView = "compact";
  const [office] = templateNetworks(
    "office-small",
    "192.168.10.0/24",
    state.activeProjectId,
    () => "office",
  );
  office.allocations.push(
    {
      ip: "192.168.10.2",
      label: "前台打印机",
      status: "assigned",
      type: "printer",
    },
    { ip: "192.168.10.3", label: "检修 AP", status: "maintenance", type: "ap" },
    {
      ip: "192.168.10.4",
      label: "预留终端",
      status: "reserved",
      type: "computer",
    },
  );
  const large = {
    id: "large",
    projectId: state.activeProjectId,
    name: "大网段",
    note: "",
    cidr: "10.0.0.0/8",
    vlan: 20,
    gateway: "",
    allocations: [],
  };
  state.networks = [office, large];
  // Fixed history fixtures demonstrate display semantics without probing the user's LAN.
  state.history = [
    {
      id: "scan-fixture",
      projectId: state.activeProjectId,
      kind: "scan",
      target: "192.168.10.1-192.168.10.8",
      startedAt: "2026-09-21T12:00:00Z",
      status: "stopped",
      completed: 3,
      total: 8,
      rows: [
        {
          seq: 1,
          ip: "192.168.10.2",
          status: "no-response",
          ms: null,
          detail: "未收到响应",
        },
        {
          seq: 2,
          ip: "192.168.10.8",
          status: "reachable",
          ms: 3,
          method: "ICMP",
          detail: "收到 ICMP 回应",
        },
        {
          seq: 3,
          ip: "192.168.10.3",
          status: "error",
          ms: null,
          detail: "权限错误",
        },
      ],
    },
  ];
  await fs.writeFile(
    path.join(folder, "workspace.json"),
    JSON.stringify(state),
  );
  try {
    app = await electron.launch({
      executablePath,
      args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await expect(page.locator(".scan-address-cell")).toHaveCount(256);
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.1 · 网关/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.2 · 在用登记.*无响应/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.8 · 有响应·未登记/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^192\.168\.10\.8 · 有响应·未登记/ }).click();
    const observation = page.getByLabel("台账地址详情");
    const observationText = await observation.textContent();
    const displayedTime = observationText.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)?.[0];
    expect(displayedTime).toBeTruthy();
    expect(await page.evaluate(value => Date.parse(value.replace(' ', 'T')), displayedTime)).toBe(Date.parse('2026-09-21T12:00:00Z'));
    await page
      .getByLabel("地址用途", { exact: true })
      .selectOption("available");
    await expect(page.locator(".scan-address-cell")).toHaveCount(149);
    await page.getByLabel("地址用途", { exact: true }).selectOption("dhcp");
    await expect(page.locator(".scan-address-cell")).toHaveCount(100);
    await page.locator(".scan-address-cell").first().click();
    await expect(page.getByLabel("台账地址详情")).toContainText(
      "动态地址池不作静态登记",
    );
    await expect(
      page.getByRole("button", { name: "登记此地址", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("地址用途", { exact: true }).selectOption("");
    await page
      .getByRole("button", { name: /^192\.168\.10\.10 · 可分配/ })
      .click();
    await page.getByRole("button", { name: "登记此地址", exact: true }).click();
    await expect(page.getByLabel("分配 IPv4 地址")).toHaveValue(
      "192.168.10.10",
    );
    await page.getByLabel("设备说明").fill("会议室终端");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.10 · 在用登记/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^192\.168\.10\.10 · 在用登记/ })
      .click();
    await page.getByRole("button", { name: "编辑此地址", exact: true }).click();
    await page.getByLabel("登记状态", { exact: true }).selectOption("reserved");
    await page.getByRole("button", { name: "保存登记", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.10 · 规划预留/ }),
    ).toBeVisible();
    await page.locator(".allocation-map").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("allocation-map-light.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "表格", exact: true }).click();
    await expect(page.locator(".ledger-table tbody tr")).toHaveCount(5);
    await page.getByRole("button", { name: "紧凑网格", exact: true }).click();
    await page.getByLabel("查看网段").selectOption("large");
    await expect(page.locator(".scan-address-cell")).toHaveCount(256);
    await page.getByLabel("搜索台账").fill("10.4.5.6");
    await expect(page.getByLabel("网段区块页码")).toHaveValue("1030");
    await expect(page.locator(".scan-address-cell")).toHaveCount(1);
    await expect(page.locator(".scan-address-cell")).toHaveAttribute(
      "aria-label",
      /^10\.4\.5\.6/,
    );
    await page.getByLabel("搜索台账").fill("");
    await page.getByLabel("查看网段").selectOption("office");
    await expect(page.getByLabel("网段区块页码")).toHaveCount(0);
    await page
      .getByRole("tab", { name: "地址规划", exact: true })
      .click();
    await page.getByRole("button", { name: "办公网络", exact: true }).click();
    await expect(
      page.locator(".allocation-map .scan-address-cell"),
    ).toHaveCount(256);
    await page.getByRole("button", { name: "诊断记录", exact: true }).click();
    await page.getByRole("button", { name: "查看记录", exact: true }).click();
    await expect(page.locator(".scan-address-cell")).toHaveCount(8);
    await expect(
      page.getByRole("button", { name: /^192\.168\.10\.1 · 未完成/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭诊断详情", exact: true }).click();
    await page.getByRole("button", { name: "项目工作台", exact: true }).click();
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("主题", { exact: true }).selectOption("dark");
    await page.getByLabel("大字模式", { exact: true }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720),
    );
    await page.locator(".allocation-map").scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("allocation-map-dark-large.png"),
      scale: "css",
    });
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
