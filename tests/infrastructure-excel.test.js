import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import excel from "../electron/excel.cjs";
import { infrastructureFixture } from "./helpers/infrastructure.js";
import { projectImport } from "../src/domain/projects.js";
const sheets = ["工程设备", "设备接口", "接口连接", "接口占用"];
async function roundtrip(
  t,
  mutate = () => {},
  project = infrastructureFixture(),
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infra-excel-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wb = await excel.projectWorkbook(project, []);
  await mutate(wb);
  const file = path.join(dir, "test.xlsx");
  await wb.xlsx.writeFile(file);
  return excel.readProjectWorkbook(file);
}
test("infrastructure XLSX file roundtrip uses local E/P/C/L IDs and imported ownership", async (t) => {
  const r = await roundtrip(t, (wb) => {
    for (const name of sheets) assert.ok(wb.getWorksheet(name), name);
    assert.equal(wb.getWorksheet("工程设备").getCell("A2").value, "E001");
    assert.equal(wb.getWorksheet("设备接口").getCell("A2").value, "P001");
    assert.equal(wb.getWorksheet("接口连接").getCell("A2").value, "C001");
    assert.equal(wb.getWorksheet("接口占用").views[0].ySplit, 1);
  });
  assert.deepEqual(r.errors, []);
  const i = r.project.engineering.infrastructure;
  assert.ok(i, "retained infrastructure");
  assert.equal(i.devices[0].locationId, "L001");
  assert.equal(i.links[0].fromInterfaceId, "P001");
  assert.equal(i.devices[0].model, "型号");
  const imported = projectImport(r);
  assert.equal(
    imported.project.engineering.infrastructure.devices[0].locationId,
    imported.project.engineering.locations[0].id,
  );
});
test("explicit empty infrastructure survives; missing stays missing with five/eight/twelve sheet formats", async (t) => {
  const p = infrastructureFixture();
  p.engineering.infrastructure = {
    version: 1,
    devices: [],
    interfaces: [],
    links: [],
  };
  assert.deepEqual(
    (await roundtrip(t, () => {}, p)).project.engineering.infrastructure,
    p.engineering.infrastructure,
  );
  for (const count of [5, 8, 12]) {
    const old = infrastructureFixture();
    delete old.engineering.infrastructure;
    if (count < 12) delete old.engineering;
    const r = await roundtrip(
      t,
      (wb) => {
        for (const name of sheets)
          if (wb.getWorksheet(name)) wb.removeWorksheet(name);
        if (count < 12)
          for (const name of ["场地位置", "业务需求", "接入容量", "容量校核"])
            wb.removeWorksheet(name);
        if (count === 5)
          for (const name of ["互联架构", "运营商线路", "互通策略"])
            wb.removeWorksheet(name);
      },
      old,
    );
    assert.deepEqual(r.errors, []);
    assert.equal(r.project.engineering?.infrastructure, undefined);
  }
});
for (const mode of [
  "unknown",
  "duplicate",
  "duplicate-blank",
  "partial",
  "orphan",
  "missing-marker",
])
  test(`reject infrastructure ${mode}`, async (t) => {
    await assert.rejects(
      roundtrip(t, (wb) => {
        const instructions = wb.getWorksheet("填写说明");
        assert.ok(wb.getWorksheet("工程设备"), "feature sheet exists");
        if (mode === "partial") wb.removeWorksheet("设备接口");
        if (mode === "orphan")
          for (const name of ["场地位置", "业务需求", "接入容量"])
            wb.removeWorksheet(name);
        if (mode === "duplicate") instructions.addRow(["设备连接版本", 1]);
        if (mode === "duplicate-blank")
          instructions.addRow(["设备连接版本", ""]);
        if (mode === "unknown" || mode === "missing-marker")
          instructions.eachRow((row) => {
            if (row.getCell(1).value === "设备连接版本")
              row.getCell(2).value = mode === "unknown" ? 2 : null;
          });
      }),
      /版本|三张表|工程输入|孤立/,
    );
  });
for (const value of [
  { formula: "1+1", result: 2 },
  { text: "x", hyperlink: "https://example.com" },
  { richText: [{ text: "x" }] },
  123,
])
  test(
    "reject illegal infrastructure input cell " + JSON.stringify(value),
    async (t) => {
      await assert.rejects(
        roundtrip(t, (wb) => {
          assert.ok(wb.getWorksheet("设备接口"));
          wb.getWorksheet("设备接口").getCell("A2").value = value;
        }),
        /设备接口.*A2|编号|引用/,
      );
    },
  );
test("derived output is ignored and malformed references reject preview", async (t) => {
  const r = await roundtrip(t, (wb) => {
    assert.ok(wb.getWorksheet("接口占用"));
    wb.getWorksheet("接口占用").getCell("A1").value = {
      formula: "1+1",
      result: 2,
    };
  });
  assert.deepEqual(r.errors, []);
  const invalid = await roundtrip(
    t,
    (wb) => (wb.getWorksheet("接口连接").getCell("B2").value = "missing"),
  );
  assert.match(invalid.errors.join(), /接口/);
});
test("maximum legitimate inventory serializes and reads full XLSX without oversized result cells", async (t) => {
  const p = infrastructureFixture(),
    i = p.engineering.infrastructure;
  const d = i.devices[0],
    port = i.interfaces[0];
  i.devices = Array.from({ length: 500 }, (_, n) => ({ ...d, id: `e${n}` }));
  i.interfaces = Array.from({ length: 5000 }, (_, n) => ({
    ...port,
    id: `p${n}`,
    deviceId: `e${Math.floor(n / 10)}`,
    name: String(n % 10),
  }));
  i.links = Array.from({ length: 2500 }, (_, n) => {
    const pair = Math.floor(n / 10),
      k = n % 10;
    return {
      id: `c${n}`,
      fromInterfaceId: `p${pair * 20 + k}`,
      toInterfaceId: `p${pair * 20 + 10 + k}`,
      note: "",
    };
  });
  const r = await roundtrip(
    t,
    (wb) =>
      wb.eachSheet((s) =>
        s.eachRow((row) =>
          row.eachCell((c) => {
            if (typeof c.value === "string") assert.ok(c.value.length <= 32767);
          }),
        ),
      ),
    p,
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.project.engineering.infrastructure.devices.length, 500);
  assert.equal(r.project.engineering.infrastructure.interfaces.length, 5000);
  assert.equal(r.project.engineering.infrastructure.links.length, 2500);
});
test("100-character connection IDs are legal workbook input and duplicate local link codes reject", async (t) => {
  const r = await roundtrip(
    t,
    (wb) => (wb.getWorksheet("接口连接").getCell("A2").value = "c".repeat(100)),
  );
  assert.deepEqual(r.errors, []);
  const bad = await roundtrip(t, (wb) => {
    const sheet = wb.getWorksheet("接口连接");
    sheet.getRow(3).values = sheet.getRow(2).values;
  });
  assert.match(bad.errors.join(), /重复/);
});

test("custom workbook IDs cannot collide with temporary link IDs", async (t) => {
  const r = await roundtrip(t, (wb) => {
    wb.getWorksheet("工程设备").getCell("A2").value = "excel-link-1";
    wb.getWorksheet("设备接口").getCell("B2").value = "excel-link-1";
    wb.getWorksheet("业务需求").getCell("A2").value = "excel-link-2";
  });
  assert.deepEqual(r.errors, []);
  const engineering = r.project.engineering;
  const i = engineering.infrastructure;
  assert.equal(i.devices[0].id, "excel-link-1");
  assert.equal(engineering.demands[0].id, "excel-link-2");
  assert.equal(engineering.capacities[0].id, "C001");
  assert.equal(i.interfaces[0].deviceId, i.devices[0].id);
  assert.equal(i.links[0].fromInterfaceId, i.interfaces[0].id);
  assert.equal(i.links[0].toInterfaceId, i.interfaces[1].id);
  const ids = [
    ...engineering.locations,
    ...engineering.demands,
    ...engineering.capacities,
    ...i.devices,
    ...i.interfaces,
    ...i.links,
  ].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(i.links[0].id.length <= 100);
  const imported = projectImport(r).project.engineering;
  assert.equal(
    imported.infrastructure.interfaces[0].deviceId,
    imported.infrastructure.devices[0].id,
  );
  assert.equal(
    imported.infrastructure.links[0].fromInterfaceId,
    imported.infrastructure.interfaces[0].id,
  );
  assert.equal(
    imported.infrastructure.links[0].toInterfaceId,
    imported.infrastructure.interfaces[1].id,
  );
});
