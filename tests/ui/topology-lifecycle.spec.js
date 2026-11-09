import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, newProject } from "../../src/domain/projects.js";
import { topologyFixture } from "../helpers/topology.js";

for (const mode of ["topology", "history", "calculator"])
  test(`${mode} owner rotations release inactive feedback visibility listeners`, async () => {
    const folder = await fs.mkdtemp(
      path.join(os.tmpdir(), "nettool-topology-lifecycle-"),
    );
    const fixture = topologyFixture(),
      state = emptyWorkspace();
    state.projects = [fixture.project, newProject("other", "独立空项目")];
    state.networks = fixture.networks;
    state.activeProjectId = fixture.project.id;
    await fs.writeFile(
      path.join(folder, "workspace.json"),
      JSON.stringify(state),
    );
    const app = await electron.launch({
      executablePath: process.env.ELECTRON_BINARY,
      args: [fileURLToPath(new URL("../..", import.meta.url))],
      env: { ...process.env, NET_TOOL_TEST_DATA: folder },
    });
    try {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({
          x: 0,
          y: 0,
          width: 920,
          height: 620,
        }),
      );
      const page = await app.firstWindow();
      const tab = () =>
        page.getByRole("tab", { name: "工程拓扑", exact: true }).click();
      const cdp = await page.context().newCDPSession(page);
      async function switchOwner(id) {
        const selector = page.getByLabel("当前项目");
        await selector.selectOption(id);
        await expect(selector).toBeEnabled();
        await expect
          .poll(() =>
            page.evaluate(
              async () => (await window.netTool.load()).activeProjectId,
            ),
          )
          .toBe(id);
        if (mode === "topology") {
          await expect(
            page.getByRole("heading", {
              name: id === "project" ? fixture.project.name : "独立空项目",
              exact: true,
            }),
          ).toBeVisible();
          await tab();
        }
      }
      async function visibilityListeners() {
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: "document",
          objectGroup: "visibility-listener-test",
        });
        try {
          const { listeners } = await cdp.send(
            "DOMDebugger.getEventListeners",
            { objectId: result.objectId },
          );
          return listeners.filter(
            (listener) => listener.type === "visibilitychange",
          ).length;
        } finally {
          await cdp.send("Runtime.releaseObjectGroup", {
            objectGroup: "visibility-listener-test",
          });
        }
      }
      if (mode === "topology") await tab();
      else
        await page
          .getByRole("button", {
            name: mode === "history" ? "诊断记录" : "打开网段计算",
            exact: true,
          })
          .click();
      if (mode === "history") {
        // The first switch legitimately releases the inactive project workbench.
        // Normalize that ownership change before asserting an exact steady count.
        await switchOwner("other");
        await switchOwner("project");
      }
      const baseline = await visibilityListeners();
      const counts = [baseline];
      for (let round = 0; round < 10; round++) {
        if (mode === "calculator") {
          await page
            .getByRole("button", { name: "项目工作台", exact: true })
            .click();
          await page
            .getByRole("button", { name: "打开网段计算", exact: true })
            .click();
        } else {
          await switchOwner("other");
          await switchOwner("project");
        }
        counts.push(await visibilityListeners());
        expect(counts.at(-1), `switch round ${round + 1}`).toBe(baseline);
      }
      if (mode === "calculator") {
        await page.getByLabel("IP 地址或 CIDR").fill("10.22.33.0/24");
        await page
          .getByRole("button", { name: "DNS 查询", exact: true })
          .click();
        await page
          .getByRole("button", { name: "网段计算", exact: true })
          .click();
        await expect(page.getByLabel("IP 地址或 CIDR")).toHaveValue(
          "10.22.33.0/24",
        );
      }
      await test.info().attach("visibility-listeners", {
        body: JSON.stringify({ mode, counts }),
        contentType: "application/json",
      });
      await cdp.detach();
    } finally {
      await app.close();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
