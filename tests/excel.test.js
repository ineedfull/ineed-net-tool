import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import excel from "../electron/excel.cjs";
import { newProject, templateNetworks } from "../src/domain/projects.js";
const { TEMPLATE, projectWorkbook, readProjectWorkbook } = excel;
async function file(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "net-tool-excel-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return path.join(folder, "test.xlsx");
}
test("provided Excel template has valid examples, dropdowns, frozen headers and typed dates", async () => {
  const imported = await readProjectWorkbook(TEMPLATE);
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.networks[0].allocations.length, 2);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  assert.equal(wb.worksheets.length, 5);
  assert.equal(wb.getWorksheet("IP台账").getCell("B2").numFmt, "@");
  assert.equal(
    wb.getWorksheet("IP台账").getCell("E2").dataValidation.type,
    "list",
  );
  assert.equal(wb.getWorksheet("项目").views[0].ySplit, 1);
  assert.ok(wb.getWorksheet("维护记录").getCell("A2").value instanceof Date);
});
test("project Excel roundtrip preserves metadata, blank names, records and safe literal strings", async (t) => {
  const project = {
    ...newProject("p", "办公室"),
    owner: "张工",
    maintenance: [
      {
        id: "m",
        date: "2026-09-21",
        content: "更换交换机",
        owner: "张工",
        status: "done",
      },
    ],
  };
  const networks = templateNetworks(
    "office-small",
    "192.168.10.0/24",
    "p",
    () => crypto.randomUUID(),
  );
  networks[0].allocations.push({
    ip: "192.168.10.10",
    label: "",
    type: "printer",
    status: "assigned",
    mac: "AA:BB:CC:DD:EE:FF",
    note: "=not a formula",
  });
  const output = await file(t);
  const wb = await projectWorkbook(project, networks);
  await wb.xlsx.writeFile(output);
  const imported = await readProjectWorkbook(output);
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.project.owner, "张工");
  assert.equal(imported.project.maintenance[0].date, "2026-09-21");
  assert.equal(imported.project.maintenance[0].status, "done");
  assert.equal(imported.networks[0].allocations[1].label, "");
  assert.equal(imported.networks[0].allocations[1].note, "=not a formula");
  assert.equal(imported.networks[0].id, "N001");
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.readFile(output);
  assert.equal(
    reread.getWorksheet("IP台账").getCell("E3").dataValidation.type,
    "list",
  );
  assert.equal(reread.getWorksheet("网段").getCell("D2").value, 10);
});
test("empty project export removes all template examples", async (t) => {
  const output = await file(t);
  await (
    await projectWorkbook(newProject("p", "空白项目"), [])
  ).xlsx.writeFile(output);
  const imported = await readProjectWorkbook(output);
  assert.deepEqual(imported.errors, []);
  assert.deepEqual(imported.networks, []);
  assert.deepEqual(imported.project.maintenance, []);
});
test("Excel import rejects wrong headers and formulas with a useful location", async (t) => {
  const output = await file(t);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  wb.getWorksheet("项目").getCell("A1").value = "名称";
  await wb.xlsx.writeFile(output);
  await assert.rejects(readProjectWorkbook(output), /第 1 列/);
  wb.getWorksheet("项目").getCell("A1").value = "项目名称*";
  wb.getWorksheet("IP台账").getCell("C2").value = { formula: "1+1", result: 2 };
  await wb.xlsx.writeFile(output);
  await assert.rejects(readProjectWorkbook(output), /IP台账 第 2 行 C2/);
});
test("Excel preview rejects duplicates, DHCP conflicts and invalid network references", async (t) => {
  const output = await file(t);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  const sheet = wb.getWorksheet("IP台账");
  sheet.getCell("B3").value = "192.168.10.1";
  await wb.xlsx.writeFile(output);
  assert.match(
    (await readProjectWorkbook(output)).errors.join(),
    /第 3 行.*重复/,
  );
  sheet.getCell("B3").value = "192.168.10.100";
  await wb.xlsx.writeFile(output);
  assert.match(
    (await readProjectWorkbook(output)).errors.join(),
    /第 3 行.*DHCP/,
  );
  sheet.getCell("A3").value = "missing";
  await wb.xlsx.writeFile(output);
  assert.match(
    (await readProjectWorkbook(output)).errors.join(),
    /第 3 行.*不存在/,
  );
});
