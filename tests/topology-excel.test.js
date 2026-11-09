import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import excel from "../electron/excel.cjs";
import storage from "../electron/store.cjs";
import { topologyFixture } from "./helpers/topology.js";
import { projectImport } from "../src/domain/projects.js";
import { vlanConfigurationReport } from "../src/domain/topology.js";
async function roundtrip(t, mutate = () => {}, fixture = topologyFixture()) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-topology-excel-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wb = await excel.projectWorkbook(fixture.project, fixture.networks);
  await mutate(wb);
  const file = path.join(dir, "topology.xlsx");
  await wb.xlsx.writeFile(file);
  return excel.readProjectWorkbook(file);
}
test("real 27-sheet Excel preserves optional config, unknown/zero distinction and new ID references", async (t) => {
  const f = topologyFixture();
  f.project.engineering.infrastructure.interfaces[2].logicalConfig.allowedVlans =
    [];
  f.project.engineering.infrastructure.interfaces[3].logicalConfig.allowedVlans =
    null;
  const parsed = await roundtrip(
    t,
    (wb) => {
      assert.equal(wb.worksheets.length, 27);
      assert.equal(wb.getWorksheet("端口逻辑配置").getCell("A2").value, "P001");
      assert.equal(
        wb.getWorksheet("端口逻辑配置").getCell("C2").value,
        '["N001"]',
      );
      assert.equal(wb.getWorksheet("端口逻辑配置").getCell("E4").value, "无");
      wb.getWorksheet("VLAN配置校核").getCell("A1").value = {
        formula: "1+1",
        result: 2,
      };
    },
    f,
  );
  assert.deepEqual(parsed.errors, []);
  const imported = projectImport(parsed),
    ports = imported.project.engineering.infrastructure.interfaces;
  assert.deepEqual(ports[2].logicalConfig.allowedVlans, []);
  assert.equal(ports[3].logicalConfig.allowedVlans, null);
  for (const port of ports)
    assert.deepEqual(port.logicalConfig.networkIds, [imported.networks[0].id]);
  assert.equal(
    vlanConfigurationReport(imported.project, imported.networks).status,
    "risk",
  );
});
test("old25 and old5 workbooks import without inventing logical configuration", async (t) => {
  const f = topologyFixture();
  delete f.project.engineering.infrastructure.logicalVersion;
  f.project.engineering.infrastructure.interfaces.forEach(
    (p) => delete p.logicalConfig,
  );
  for (const old5 of [false, true]) {
    const parsed = await roundtrip(
      t,
      (wb) => {
        for (const name of ["端口逻辑配置", "VLAN配置校核"])
          wb.removeWorksheet(name);
        if (old5) {
          const names = new Set([
            "填写说明",
            "项目",
            "网段",
            "IP台账",
            "维护记录",
          ]);
          for (const sheet of [...wb.worksheets])
            if (!names.has(sheet.name)) wb.removeWorksheet(sheet.id);
          const instructions = wb.getWorksheet("填写说明");
          instructions.eachRow((row) => {
            if (
              [
                "工程资料版本",
                "设备连接版本",
                "容量校核版本",
                "现场验收版本",
              ].includes(row.getCell(1).value)
            )
              row.getCell(2).value = null;
          });
        }
      },
      f,
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(
      parsed.project.engineering?.infrastructure?.logicalVersion,
      undefined,
    );
  }
});
test("Excel rejects missing/duplicate versions, duplicate ports, foreign refs and structured values", async (t) => {
  const mutations = [
    (wb) => wb.getWorksheet("填写说明").addRow(["逻辑配置版本", 1]),
    (wb) =>
      wb.getWorksheet("填写说明").eachRow((r) => {
        if (r.getCell(1).value === "逻辑配置版本") r.getCell(2).value = null;
      }),
    (wb) => wb.removeWorksheet("端口逻辑配置"),
    (wb) => (wb.getWorksheet("端口逻辑配置").getCell("A3").value = "P001"),
    (wb) =>
      (wb.getWorksheet("端口逻辑配置").getCell("C2").value = '["foreign"]'),
    (wb) =>
      (wb.getWorksheet("端口逻辑配置").getCell("D2").value = {
        formula: "10+10",
        result: 20,
      }),
    (wb) => (wb.getWorksheet("端口逻辑配置").getCell("D2").value = "0"),
    (wb) => (wb.getWorksheet("端口逻辑配置").getCell("E4").value = "20,20"),
  ];
  for (const mutate of mutations) {
    try {
      const value = await roundtrip(t, mutate);
      assert.ok(
        value.errors.length,
        "invalid preview must not expose saveable project",
      );
      assert.equal(value.project, undefined);
    } catch (e) {
      assert.match(e.message, /逻辑|VLAN|配置|接口|网段|文本/);
    }
  }
});
test("SQLite reload retains config, invalid updates and failed Excel imports leave original project untouched", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-topology-store-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new storage.Store(dir);
  await store.load();
  t.after(() => {
    if (store.db) store.close();
  });
  const f = topologyFixture();
  await store.update((s) => {
    s.projects = [f.project];
    s.networks = f.networks;
    s.activeProjectId = f.project.id;
    return s;
  });
  const before = structuredClone(store.state);
  await assert.rejects(
    store.update((s) => {
      s.projects[0].engineering.infrastructure.interfaces[0].logicalConfig.networkIds =
        ["foreign"];
      return s;
    }),
    /网段/,
  );
  assert.deepEqual(store.state, before);
  store.close();
  const reload = new storage.Store(dir);
  assert.deepEqual(await reload.load(), before);
  const invalid = await roundtrip(
    t,
    (wb) =>
      (wb.getWorksheet("端口逻辑配置").getCell("C2").value = '["foreign"]'),
  );
  assert.ok(invalid.errors.length);
  assert.equal(invalid.project, undefined);
  assert.deepEqual(reload.state, before);
  assert.equal(reload.db.prepare("PRAGMA user_version").get().user_version, 1);
  reload.close();
});
