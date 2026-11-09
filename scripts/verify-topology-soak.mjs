// Real visible Electron, isolated SQLite, registered inventory only: no probes.
// node scripts/verify-topology-soak.mjs --out=/absolute/path --seconds=1200 --idle=180
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import ExcelJS from "exceljs";
import { prepareElectronExecutable } from "./dev-electron.mjs";
import { topologyFixture } from "../tests/helpers/topology.js";
import { emptyWorkspace, newProject } from "../src/domain/projects.js";
import { vlanConfigurationReport } from "../src/domain/topology.js";
const arg = (name, fallback) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const out = path.resolve(arg("out", "/tmp/nettool-topology-soak"));
const seconds = Number(arg("seconds", "1200")),
  idle = Number(arg("idle", "180"));
const diagnosticGC = arg("diagnostic-gc", "0") === "1";
// Keep concurrent desktop test windows on separate displays when available.
const windowOrigin = arg("window-origin", "0,0").split(",").map(Number);
if (
  windowOrigin.length !== 2 ||
  windowOrigin.some((value) => !Number.isInteger(value) || Math.abs(value) > 20000)
)
  throw Error("Invalid window-origin; expected integer x,y coordinates");
if (![seconds, idle].every((n) => Number.isFinite(n) && n >= 0))
  throw Error("Invalid duration");
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "owner"), new Date().toISOString(), {
  flag: "wx",
});
const data = path.join(out, "data");
await fs.mkdir(data);
const f = topologyFixture(),
  inventory = f.project.engineering.infrastructure;
for (let d = 0; d < 120; d++) {
  inventory.devices.push({
    id: `bulk${d}`,
    name: `工程设备${String(d).padStart(3, "0")}`,
    locationId: d < 60 ? "area1" : "area2",
    kind: "switch",
    model: "isolated test",
    note: "",
  });
  for (const side of ["a", "b"])
    inventory.interfaces.push({
      id: `bulk${d}${side}`,
      name: `端口${d}${side}`,
      deviceId: `bulk${d}`,
      role: "uplink",
      state: "available",
      note: "",
      logicalConfig: {
        version: 1,
        mode: "trunk",
        networkIds: ["net20"],
        accessVlan: null,
        allowedVlans: d % 5 === 0 ? null : d % 3 === 0 ? [30] : [20, 30],
      },
    });
  inventory.links.push({
    id: `bulklink${d}`,
    fromInterfaceId: `bulk${d}b`,
    toInterfaceId: `bulk${(d + 1) % 120}a`,
    note: "",
  });
}
const state = emptyWorkspace();
state.projects = [f.project, newProject("other", "独立空项目")];
state.networks = f.networks;
state.activeProjectId = f.project.id;
await fs.writeFile(path.join(data, "workspace.json"), JSON.stringify(state));
const report = {
  startedAt: new Date().toISOString(),
  out,
  seconds,
  idle,
  diagnosticGC,
  windowOrigin,
  acceptanceEligible: !diagnosticGC,
  concurrentHost: true,
  fixture: {
    devices: inventory.devices.length,
    interfaces: inventory.interfaces.length,
    links: inventory.links.length,
  },
  operations: {},
  expectedRejections: [],
  errors: [],
  samples: [],
  cycles: 0,
  launches: [],
};
const increment = (key, n = 1) =>
  (report.operations[key] = (report.operations[key] ?? 0) + n);
const write = () =>
  fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let app, page, identity, start;
const root = fileURLToPath(new URL("..", import.meta.url));
report.rendererEntryHtml = await fs.readFile(
  path.join(root, "dist/index.html"),
  "utf8",
);
const executablePath = await prepareElectronExecutable();
const button = (name) => page.getByRole("button", { name, exact: true });
const tab = (name) => page.getByRole("tab", { name, exact: true });
async function launch() {
  app = await electron.launch({
    executablePath,
    args: [root],
    env: { ...process.env, NET_TOOL_TEST_DATA: data },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.stack));
  await app.evaluate(({ BrowserWindow }, { diagnostic, origin }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({
      x: origin[0],
      y: origin[1],
      width: diagnostic ? 920 : 1440,
      height: diagnostic ? 620 : 900,
    });
    w.show();
  }, { diagnostic: diagnosticGC, origin: windowOrigin });
  identity = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    href: location.href,
  }));
  report.launches.push(
    await app.evaluate(({ app }) => ({
      pid: process.pid,
      userData: app.getPath("userData"),
    })),
  );
  await tab("工程拓扑").click();
  await expect(page.locator(".topology-node")).toHaveCount(40);
}
async function sample(stage) {
  const renderer = await page.evaluate(() => ({
    identity: { timeOrigin: performance.timeOrigin, href: location.href },
    visibility: document.visibilityState,
    nodes: document.querySelectorAll(".topology-node").length,
    dom: document.querySelectorAll("*").length,
    heap: performance.memory?.usedJSHeapSize,
  }));
  expect(renderer.identity).toEqual(identity);
  expect(renderer.visibility).toBe("visible");
  const native = await app.evaluate(({ app, BrowserWindow }) => ({
    visible: BrowserWindow.getAllWindows()[0].isVisible(),
    handles: process._getActiveHandles().length,
    metrics: app
      .getAppMetrics()
      .map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu, memory: m.memory })),
  }));
  expect(native.visible).toBe(true);
  report.samples.push({
    stage,
    monotonicMs: performance.now() - start,
    cycles: report.cycles,
    renderer,
    native,
  });
  await write();
  console.log(
    JSON.stringify({
      stage,
      elapsedSeconds: (performance.now() - start) / 1000,
      cycles: report.cycles,
      operations: report.operations,
    }),
  );
}
async function editPort(name, field, value) {
  await button(`拓扑接口 ${name}`).click();
  await page.getByLabel(field, { exact: true }).fill(value);
  await button("保存接口").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tab("工程拓扑").click();
  increment("interfaceEdits");
}
try {
  await launch();
  start = performance.now();
  await sample("load-start");
  while (performance.now() - start < seconds * 1000) {
    const round = performance.now();
    report.cycles++;
    await page.getByLabel("拓扑位置").selectOption("");
    increment("filters");
    await expect(page.locator(".topology-node")).toHaveCount(40);
    await button("下一页设备").click();
    await button("上一页设备").click();
    increment("devicePages", 2);
    for (const kind of ["接口", "连接", "问题"]) {
      await button(`下一页${kind}`).click();
      await button(`上一页${kind}`).click();
      increment(`${kind}Pages`, 2);
    }
    await button("拓扑设备 host").click();
    await expect(page.getByRole("dialog")).toContainText("编辑设备");
    await button("取消").click();
    await tab("工程拓扑").click();
    increment("deviceOpen");
    await button("拓扑连接 edge").locator("line").scrollIntoViewIfNeeded();
    const edge = await button("拓扑连接 edge")
      .locator("line")
      .evaluate((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    await page.mouse.click(edge.x, edge.y);
    await expect(page.getByRole("dialog")).toContainText("编辑连接");
    await button("取消").click();
    await tab("工程拓扑").click();
    increment("linkOpen");
    const trunk =
      report.cycles % 3 === 0 ? "" : report.cycles % 3 === 1 ? "30" : "20,30";
    await editPort("uplink2", "允许 VLAN", trunk);
    const access =
      report.cycles % 3 === 0 ? "" : report.cycles % 3 === 1 ? "30" : "20";
    await editPort("access", "Access VLAN", access);
    const loaded = await page.evaluate(() => window.netTool.load());
    const check = vlanConfigurationReport(
      loaded.projects.find((p) => p.id === "project"),
      loaded.networks,
    );
    const issues = check.issues.filter((i) => i.interfaceId === "uplink2");
    expect(issues.some((i) => i.code === "trunk_vlan_missing")).toBe(
      trunk === "30",
    );
    expect(issues.some((i) => i.code === "allowed_vlans_missing")).toBe(
      trunk === "",
    );
    increment("persistedVlanChecks");
    if (report.cycles % 6 === 1) {
      await button("拓扑接口 uplink2").click();
      await page.getByLabel("允许 VLAN").fill("20,20");
      await button("保存接口").click();
      await expect(page.getByRole("dialog")).toContainText("重复");
      await button("取消").click();
      await tab("工程拓扑").click();
      report.expectedRejections.push({
        cycle: report.cycles,
        kind: "duplicate VLAN rejected in editor",
      });
    }
    await page.getByLabel("拓扑位置").selectOption("floor");
    increment("filters");
    expect(
      await page.locator(".topology-node rect.boundary").count(),
    ).toBeGreaterThan(0);
    await page.getByLabel("当前项目").selectOption("other");
    await tab("工程拓扑").click();
    await expect(page.locator(".topology-panel")).toContainText("尚未登记设备");
    await page.getByLabel("当前项目").selectOption("project");
    await tab("工程拓扑").click();
    increment("projectSwitches", 2);
    report.lastCycleMs = performance.now() - round;
    if (
      report.cycles === 1 ||
      performance.now() - (report.lastSample ?? 0) > 15000
    ) {
      await sample("load");
      report.lastSample = performance.now();
    }
    await delay(Math.max(0, 2500 - (performance.now() - round)));
  }
  report.loadDurationMs = performance.now() - start;
  if (diagnosticGC) {
    // Separate diagnosis only. Never count forced GC as acceptance recovery.
    const cdp = await page.context().newCDPSession(page);
    report.gcDiagnosis = {
      before: {
        heap: await cdp.send("Runtime.getHeapUsage"),
        dom: await cdp.send("Memory.getDOMCounters"),
      },
    };
    await cdp.send("HeapProfiler.collectGarbage");
    await delay(1000);
    report.gcDiagnosis.first = {
      heap: await cdp.send("Runtime.getHeapUsage"),
      dom: await cdp.send("Memory.getDOMCounters"),
    };
    await cdp.send("HeapProfiler.collectGarbage");
    await delay(1000);
    report.gcDiagnosis.after = {
      heap: await cdp.send("Runtime.getHeapUsage"),
      dom: await cdp.send("Memory.getDOMCounters"),
    };
    if (arg("heap-snapshot", "0") === "1") {
      const chunks = [];
      cdp.on("HeapProfiler.addHeapSnapshotChunk", (event) =>
        chunks.push(event.chunk),
      );
      await cdp.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
      });
      await fs.writeFile(
        path.join(out, "diagnostic.heapsnapshot"),
        chunks.join(""),
      );
    }
    await cdp.detach();
    await sample("diagnostic-after-forced-gc");
  }
  await page
    .locator(".topology-graph")
    .screenshot({ path: path.join(out, "large-topology.png") });
  const beforeIdle = await page.evaluate(() => window.netTool.load());
  const idleStart = performance.now();
  await sample("idle-start");
  while (performance.now() - idleStart < idle * 1000) {
    await delay(
      Math.min(
        15000,
        Math.max(0, idle * 1000 - (performance.now() - idleStart)),
      ),
    );
    await sample("idle");
  }
  report.idleDurationMs = performance.now() - idleStart;
  expect(await page.evaluate(() => window.netTool.load())).toEqual(beforeIdle);
  report.sameProcessIdle = true;
  // Native Excel export/import with dialog destinations intercepted; actual workbook I/O and UI confirmation run unchanged.
  const output = path.join(out, "project.xlsx");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await button("导出 Excel").click();
  await expect(
    page
      .locator(".workspace-toolbar")
      .locator("button")
      .filter({ hasText: "导出 Excel" }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      fs.stat(output).then(
        (s) => s.size,
        () => 0,
      ),
    )
    .toBeGreaterThan(0);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(output);
  expect(wb.worksheets).toHaveLength(27);
  report.excel = {
    sheets: wb.worksheets.length,
    bytes: (await fs.stat(output)).size,
    logicalRows: wb
      .getWorksheet("端口逻辑配置")
      .getColumn(1)
      .values.slice(2)
      .filter(Boolean).length,
  };
  expect(report.excel.logicalRows).toBe(inventory.interfaces.length);
  const bad = path.join(out, "invalid.xlsx");
  wb.getWorksheet("端口逻辑配置").getCell("C2").value = '["foreign"]';
  await wb.xlsx.writeFile(bad);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, bad);
  await button("导入 Excel").click();
  await expect(page.getByRole("dialog")).toContainText("校验未通过");
  await button("取消").click();
  expect((await page.evaluate(() => window.netTool.load())).projects).toEqual(
    beforeIdle.projects,
  );
  report.expectedRejections.push({
    kind: "foreign reference Excel rejected without save",
  });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, output);
  await button("导入 Excel").click();
  await expect(button("确认导入为新项目")).toBeVisible();
  await button("确认导入为新项目").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = await page.evaluate(() => window.netTool.load());
  const imported = before.projects.find(
    (p) => !["project", "other"].includes(p.id),
  );
  expect(imported).toBeTruthy();
  const sourceIds = new Set(
    [...inventory.devices, ...inventory.interfaces, ...inventory.links].map(
      (x) => x.id,
    ),
  );
  const target = imported.engineering.infrastructure;
  for (const x of [...target.devices, ...target.interfaces, ...target.links])
    expect(sourceIds.has(x.id)).toBe(false);
  const devices = new Set(target.devices.map((x) => x.id)),
    ports = new Set(target.interfaces.map((x) => x.id)),
    nets = new Set(
      before.networks
        .filter((n) => n.projectId === imported.id)
        .map((n) => n.id),
    );
  for (const p of target.interfaces) {
    expect(devices.has(p.deviceId)).toBe(true);
    for (const n of p.logicalConfig.networkIds) expect(nets.has(n)).toBe(true);
  }
  for (const l of target.links) {
    expect(ports.has(l.fromInterfaceId)).toBe(true);
    expect(ports.has(l.toInterfaceId)).toBe(true);
  }
  expect(before.projects.find((p) => p.id === "project")).toEqual(
    beforeIdle.projects.find((p) => p.id === "project"),
  );
  report.excel.referenceRebuild = true;
  report.sqlite = await app.evaluate(({ app }) => {
    const db = new (process.getBuiltinModule("node:sqlite").DatabaseSync)(
      process
        .getBuiltinModule("path")
        .join(app.getPath("userData"), "workspace.sqlite"),
      { readOnly: true },
    );
    try {
      return {
        integrity: db.prepare("PRAGMA quick_check").all(),
        version: db.prepare("PRAGMA user_version").get(),
        tables: db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all(),
      };
    } finally {
      db.close();
    }
  });
  expect(report.sqlite.integrity[0].quick_check).toBe("ok");
  await fs.writeFile(
    path.join(out, "before-restart.json"),
    JSON.stringify(before),
  );
  await app.close();
  app = null;
  await launch();
  expect(await page.evaluate(() => window.netTool.load())).toEqual(before);
  report.restartPreserved = true;
  expect(report.errors).toEqual([]);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  report.cleanedProcesses = true;
  await write();
  console.log(
    JSON.stringify({
      passed: report.passed,
      cycles: report.cycles,
      failure: report.failure,
    }),
  );
}
