import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace } from "../../src/domain/projects.js";
import { topologyFixture } from "../helpers/topology.js";

for (const key of ["Enter", "Space"])
  for (const kind of ["link", "device"])
    test(`topology ${kind} opens its original record with ${key}`, async () => {
      const folder = await fs.mkdtemp(
        path.join(os.tmpdir(), "nettool-topology-keyboard-"),
      );
      const fixture = topologyFixture(),
        state = emptyWorkspace();
      state.projects = [fixture.project];
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
        const page = await app.firstWindow();
        await page.getByRole("tab", { name: "工程拓扑", exact: true }).click();
        await page.getByLabel("拓扑位置").focus();
        // Real Tab navigation also covers SVG links whose horizontal line
        // geometry has zero height despite its visible, focusable stroke.
        for (let index = 0; index < (kind === "link" ? 1 : 4); index++)
          await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", {
            name: kind === "link" ? "拓扑连接 edge" : "拓扑设备 host",
            exact: true,
          }),
        ).toBeFocused();
        await page.keyboard.press(key);
        await expect(page.getByRole("dialog")).toContainText(
          kind === "link" ? "编辑连接" : "编辑设备",
        );
        await expect(
          page.getByLabel(kind === "link" ? "起点接口" : "设备名称"),
        ).toHaveValue(kind === "link" ? "hostp" : "host");
      } finally {
        await app.close();
        await fs.rm(folder, { recursive: true, force: true });
      }
    });
