import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { newProject } from "../../src/domain/projects.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = process.env.ELECTRON_BINARY || require("electron");
const network = (id, name, projectId) => ({
  id, name, projectId, note: "保留配置", cidr: "192.168.50.0/24",
  gateway: "", vlan: "", dhcpStart: "", dhcpEnd: "", allocations: [],
});

async function withImport(run) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nettool-import-ui-"));
  const file = path.join(folder, "plans.json");
  await fs.writeFile(file, JSON.stringify({ version: 1, networks: [
    network("same", "导入不能覆盖现有记录", "foreign-project"),
    network("foreign", "跨项目同 ID 导入", "foreign-project"),
    network("imported", "新导入网段", "foreign-project"),
  ] }));
  let app;
  try {
    app = await electron.launch({ executablePath, args: [root],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder } });
    const page = await app.firstWindow();
    await expect(page.getByLabel("当前项目", { exact: true })).toBeVisible();
    await page.evaluate(async ({ projects, networks }) => {
      await window.netTool.save({ projects, networks, activeProjectId: "project-a" });
    }, {
      projects: [newProject("project-a", "项目 A"), newProject("project-b", "项目 B")],
      networks: [network("same", "A 已有网段", "project-a"), network("foreign", "B 已有网段", "project-b")],
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "项目 A", exact: true })).toBeVisible();
    const baseline = await page.evaluate(() => window.netTool.load());
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
      const files = process.getBuiltinModule("fs/promises");
      const readFile = files.readFile;
      files.readFile = async (...args) => {
        if (args[0] !== chosen) return readFile(...args);
        globalThis.__importWaiting = true;
        await new Promise(resolve => { globalThis.__releaseImport = resolve; });
        try { return await readFile(...args); }
        finally { globalThis.__importReadFinished = true; }
      };
    }, file);
    const start = async () => {
      await app.evaluate(() => {
        globalThis.__importWaiting = false;
        globalThis.__importReadFinished = false;
      });
      await page.getByRole("button", { name: "导入 JSON 规划", exact: true }).click();
      await expect.poll(() => app.evaluate(() => !!globalThis.__importWaiting)).toBe(true);
    };
    const release = async () => {
      await app.evaluate(() => globalThis.__releaseImport());
      await expect.poll(() => app.evaluate(() => !!globalThis.__importReadFinished)).toBe(true);
      // Let the native IPC response and any renderer save finish before checking no-op imports.
      await page.waitForTimeout(250);
    };
    await run({ app, page, baseline, start, release });
  } finally {
    await app?.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}

for (const returnToSource of [false, true]) {
  test(`pending JSON import is canceled after project switch${returnToSource ? " and return" : ""}`, async () => {
    await withImport(async ({ page, baseline, start, release }) => {
      await start();
      await page.getByLabel("当前项目", { exact: true }).selectOption("project-b");
      await expect(page.getByRole("heading", { name: "项目 B", exact: true })).toBeVisible();
      if (returnToSource) {
        await page.getByLabel("当前项目", { exact: true }).selectOption("project-a");
        await expect(page.getByRole("heading", { name: "项目 A", exact: true })).toBeVisible();
      }
      await release();
      const state = await page.evaluate(() => window.netTool.load());
      expect(state.networks).toEqual(baseline.networks);
      expect(state.activeProjectId).toBe(returnToSource ? "project-a" : "project-b");
      await page.reload();
      await expect(page.getByLabel("当前项目", { exact: true })).toHaveValue(state.activeProjectId);
      expect((await page.evaluate(() => window.netTool.load())).networks).toEqual(baseline.networks);
    });
  });
}

test("pending JSON import cannot restore a deleted source project", async () => {
  await withImport(async ({ page, baseline, start, release }) => {
    await start();
    // No delete UI exists yet: exercise the real workspace API with an isolated database.
    await page.evaluate(async state => window.netTool.save({
      projects: state.projects.filter(p => p.id === "project-b"),
      networks: state.networks.filter(n => n.projectId === "project-b"),
      activeProjectId: "project-b",
    }), baseline);
    await page.getByLabel("当前项目", { exact: true }).selectOption("project-b");
    await expect(page.getByRole("heading", { name: "项目 B", exact: true })).toBeVisible();
    await release();
    const state = await page.evaluate(() => window.netTool.load());
    expect(state.projects.map(p => p.id)).toEqual(["project-b"]);
    expect(state.networks).toEqual(baseline.networks.filter(n => n.projectId === "project-b"));
  });
});

test("JSON import merges current project and preserves existing and foreign ID records", async () => {
  await withImport(async ({ page, baseline, start, release }) => {
    await start();
    await release();
    await expect(page.getByRole("status")).toContainText("已合并 2 个网段");
    const state = await page.evaluate(() => window.netTool.load());
    for (const existing of baseline.networks) expect(state.networks).toContainEqual(existing);
    const additions = state.networks.filter(n => !baseline.networks.some(old => old.id === n.id));
    expect(additions).toHaveLength(2);
    expect(additions.every(n => n.projectId === "project-a")).toBe(true);
    expect(additions.find(n => n.name === "跨项目同 ID 导入").id).not.toBe("foreign");
    expect(new Set(state.networks.map(n => n.id)).size).toBe(4);
  });
});

test("cached planner cancels hidden import and can start a new import after returning", async () => {
  await withImport(async ({ page, baseline, start, release }) => {
    await start();
    await page.getByRole("tab", { name: "IP 地址台账", exact: true }).click();
    await release();
    expect((await page.evaluate(() => window.netTool.load())).networks).toEqual(baseline.networks);
    await page.getByRole("tab", { name: "地址规划", exact: true }).click();
    await start();
    await release();
    await expect(page.getByRole("status")).toContainText("已合并 2 个网段");
    expect((await page.evaluate(() => window.netTool.load())).networks).toHaveLength(4);
  });
});

test("canceling JSON file selection leaves all projects unchanged", async () => {
  await withImport(async ({ app, page, baseline }) => {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.getByRole("button", { name: "导入 JSON 规划", exact: true }).click();
    expect(await page.evaluate(() => window.netTool.load())).toEqual(baseline);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
