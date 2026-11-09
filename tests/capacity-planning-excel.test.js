import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import excel from "../electron/excel.cjs";
import { capacityFixture } from "./helpers/capacity-planning.js";
import { projectImport } from "../src/domain/projects.js";
import {
  capacityPlanningReport,
  emptyCapacityPlanning,
} from "../src/domain/capacity-planning.js";
const names = ["PoE电源预算", "PoE负载", "上联参数", "上联业务"];
async function run(t, mutate = () => {}, p = capacityFixture()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capacity-xlsx-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wb = await excel.projectWorkbook(p, []);
  await mutate(wb);
  const file = path.join(dir, "test.xlsx");
  await wb.xlsx.writeFile(file);
  return excel.readProjectWorkbook(file);
}
test("capacity serialized XLSX preserves all arrays and imported references and exact report", async (t) => {
  const r = await run(t, (wb) => {
    assert.equal(wb.worksheets.length, 27);
    assert.equal(wb.getWorksheet(names[0]).getCell("A2").value, "S001");
  });
  assert.deepEqual(r.errors, []);
  const p = projectImport(r).project;
  const original =
    capacityFixture().engineering.infrastructure.capacityPlanning;
  const actual = p.engineering.infrastructure.capacityPlanning;
  for (const key of ["powerBudgets", "poeLoads", "uplinks", "trafficDemands"]) {
    assert.equal(actual[key].length, original[key].length);
    for (let i = 0; i < actual[key].length; i++)
      for (const [k, v] of Object.entries(original[key][i]))
        if (!k.endsWith("Id") && k !== "id")
          assert.deepEqual(actual[key][i][k], v);
  }
  const report = capacityPlanningReport(p, []);
  assert.equal(report.poeLoads[0].requiredWatts, 15);
  assert.equal(report.uplinks[0].forward.knownMbps, 48);
  assert.equal(report.uplinks[0].reverse.knownMbps, 60);
  assert.equal(
    actual.poeLoads[0].linkId,
    p.engineering.infrastructure.links[0].id,
  );
  assert.equal(actual.trafficDemands[0].uplinkId, actual.uplinks[0].id);
});
for (const mode of [
  "unknown",
  "duplicate",
  "duplicate-blank",
  "partial",
  "orphan",
  "missing-marker",
])
  test(`capacity rejects ${mode}`, async (t) => {
    await assert.rejects(
      run(t, (wb) => {
        const s = wb.getWorksheet("填写说明");
        let marker;
        s.eachRow((r) => {
          if (r.getCell(1).value === "容量校核版本") marker = r;
        });
        assert.ok(marker);
        if (mode === "unknown") marker.getCell(2).value = 2;
        if (mode === "duplicate") s.addRow(["容量校核版本", 1]);
        if (mode === "duplicate-blank") {
          marker.getCell(2).value = "";
          s.addRow(["容量校核版本", ""]);
        }
        if (mode === "partial") wb.removeWorksheet(names[0]);
        if (mode === "orphan") marker.getCell(2).value = "";
        if (mode === "missing-marker") marker.getCell(1).value = "removed";
      }),
      /容量|版本|工作表/,
    );
  });
for (const value of [
  true,
  new Date(),
  { formula: "1+1", result: 2 },
  { text: "1", hyperlink: "https://example.com" },
  { richText: [{ text: "1" }] },
  "1e2",
  "0.0001",
  "-1",
])
  test(`capacity strict numeric ${JSON.stringify(value)}`, async (t) => {
    await assert.rejects(
      run(t, (wb) => {
        wb.getWorksheet(names[0]).getCell("C2").value = value;
      }),
    );
  });
test("capacity percent format and numeric text columns reject", async (t) => {
  await assert.rejects(
    run(t, (wb) => {
      wb.getWorksheet(names[0]).getCell("D2").numFmt = "0%";
    }),
  );
  await assert.rejects(
    run(t, (wb) => {
      wb.getWorksheet(names[0]).getCell("A2").value = 12;
    }),
  );
});
test("capacity empty and absent retained, derived ignored", async (t) => {
  for (const enabled of [true, false]) {
    const p = capacityFixture();
    if (enabled)
      p.engineering.infrastructure.capacityPlanning = emptyCapacityPlanning();
    else delete p.engineering.infrastructure.capacityPlanning;
    const r = await run(
      t,
      (wb) => {
        wb.getWorksheet("PoE带宽校核").getCell("A1").value = {
          formula: "BAD()",
        };
      },
      p,
    );
    assert.deepEqual(r.errors, []);
    assert.deepEqual(
      r.project.engineering.infrastructure.capacityPlanning,
      enabled ? emptyCapacityPlanning() : undefined,
    );
  }
});
test("capacity custom codes collision-safe and decimal/null boundaries", async (t) => {
  const r = await run(t, (wb) => {
    wb.getWorksheet("接口连接").getCell("A2").value = "excel-capacity-1";
    for (const name of [names[1], names[2]])
      wb.getWorksheet(name).getCell("B2").value = "excel-capacity-1";
    wb.getWorksheet(names[2]).getCell("A2").value = "custom-U";
    for (const row of [2, 3])
      wb.getWorksheet(names[3]).getCell(`B${row}`).value = "custom-U";
    wb.getWorksheet(names[0]).getCell("C2").value = "0.001";
    wb.getWorksheet(names[1]).getCell("E2").value = 0;
    wb.getWorksheet(names[1]).getCell("F2").value = "";
  });
  assert.deepEqual(r.errors, []);
  const i = projectImport(r).project.engineering.infrastructure;
  assert.equal(i.capacityPlanning.poeLoads[0].linkId, i.links[0].id);
  assert.equal(i.capacityPlanning.powerBudgets[0].budgetWatts, 0.001);
  assert.equal(i.capacityPlanning.poeLoads[0].portBudgetWatts, 0);
  assert.equal(i.capacityPlanning.poeLoads[0].deviceWatts, null);
});
test("capacity returns bounded domain errors without imported project", async (t) => {
  for (const [sheet, cell, value] of [
    [names[0], "C2", "1000001"],
    [names[0], "D2", "100.001"],
    [names[3], "E2", "100001"],
    [names[3], "F2", "10000.001"],
    [names[3], "H2", "1001"],
    [names[1], "C2", "missing"],
    [names[3], "B2", "missing"],
    [names[0], "E2", "x".repeat(1001)],
  ]) {
    const r = await run(t, (wb) => {
      wb.getWorksheet(sheet).getCell(cell).value = value;
    });
    assert.ok(r.errors.length);
    assert.equal(r.project, undefined);
  }
});
test("capacity rejects long cells and active percentage sections but accepts literal percent", async (t) => {
  await assert.rejects(
    run(t, (wb) => {
      wb.getWorksheet(names[0]).getCell("E2").value = "x".repeat(32768);
    }),
  );
  for (const format of ["0;0%;0", "[Red]0%"])
    await assert.rejects(
      run(t, (wb) => {
        wb.getWorksheet(names[0]).getCell("C2").numFmt = format;
      }),
    );
  const r = await run(t, (wb) => {
    wb.getWorksheet(names[0]).getCell("C2").numFmt = '0"%"';
  });
  assert.deepEqual(r.errors, []);
});
test("capacity missing legacy sheets refuses while legacy 5/8/12/16 remain absent", async (t) => {
  await assert.rejects(
    run(t, (wb) => wb.removeWorksheet("工程设备")),
    /容量|设备/,
  );
  for (const count of [5, 8, 12, 16]) {
    const p = capacityFixture();
    delete p.engineering.infrastructure.capacityPlanning;
    if (count < 16) delete p.engineering.infrastructure;
    if (count < 12) delete p.engineering;
    const r = await run(
      t,
      (wb) => {
        for (const sheet of [...wb.worksheets].slice(count))
          wb.removeWorksheet(sheet.id);
      },
      p,
    );
    assert.deepEqual(r.errors, []);
    assert.equal(
      r.project.engineering?.infrastructure?.capacityPlanning,
      undefined,
    );
  }
});
test("maximum legitimate capacity arrays serialize below 10MB and every cell stays bounded", async (t) => {
  const p = capacityFixture(),
    i = p.engineering.infrastructure,
    c = i.capacityPlanning;
  i.devices = Array.from({ length: 500 }, (_, n) => ({
    ...i.devices[0],
    id: `dev-${n}`,
  }));
  i.interfaces = Array.from({ length: 5000 }, (_, n) => ({
    ...i.interfaces[0],
    id: `port-${n}`,
    name: `port-${n}`,
    deviceId: `dev-${n % 500}`,
  }));
  i.links = Array.from({ length: 2500 }, (_, n) => ({
    id: `link-${n}`,
    fromInterfaceId: `port-${n * 2}`,
    toInterfaceId: `port-${n * 2 + 1}`,
    note: "",
  }));
  c.powerBudgets = i.devices.map((d, n) => ({
    id: `budget-${n}`,
    deviceId: d.id,
    budgetWatts: null,
    reservePercent: 20,
    note: "x".repeat(1000),
  }));
  c.poeLoads = i.links.map((l, n) => ({
    id: `poe-${n}`,
    linkId: l.id,
    sourceInterfaceId: l.fromInterfaceId,
    targetInterfaceId: l.toInterfaceId,
    portBudgetWatts: null,
    deviceWatts: null,
    lossPercent: null,
    note: "x".repeat(1000),
  }));
  c.uplinks = i.links.slice(0, 500).map((l, n) => ({
    id: `uplink-${n}`,
    linkId: l.id,
    fromInterfaceId: l.fromInterfaceId,
    toInterfaceId: l.toInterfaceId,
    fromMbps: null,
    toMbps: null,
    reservePercent: 20,
    note: "x".repeat(1000),
  }));
  c.trafficDemands = c.uplinks.map((u, n) => ({
    id: `traffic-${n}`,
    uplinkId: u.id,
    name: "x".repeat(100),
    direction: "forward",
    count: 100000,
    mbpsPerUnit: 10000,
    concurrencyPercent: 100,
    growthPercent: 1000,
    note: "x".repeat(1000),
  }));
  const r = await run(
    t,
    async (wb) => {
      const bytes = await wb.xlsx.writeBuffer();
      assert.ok(bytes.length < 10 * 1024 * 1024);
      for (const sheet of wb.worksheets)
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (typeof cell.value === "string")
              assert.ok(cell.value.length <= 32767);
          }),
        );
    },
    p,
  );
  assert.deepEqual(r.errors, []);
  const imported =
    projectImport(r).project.engineering.infrastructure.capacityPlanning;
  for (const key of ["powerBudgets", "poeLoads", "uplinks", "trafficDemands"])
    assert.equal(imported[key].length, c[key].length);
});

test("serialized direction conclusions retain shared unknowns and independent risk", async (t) => {
  for (const mode of ["endpoint", "empty", "shortage", "one-direction"]) {
    const p = capacityFixture(),
      c = p.engineering.infrastructure.capacityPlanning;
    if (mode === "endpoint" || mode === "shortage") c.uplinks[0].toMbps = null;
    if (mode === "empty") c.trafficDemands = [];
    if (mode === "shortage" || mode === "one-direction") {
      c.uplinks[0].fromMbps = 50;
      c.trafficDemands = [c.trafficDemands[0]];
    }
    const expected =
      mode === "shortage"
        ? ["已登记参数不足", "待补充"]
        : mode === "one-direction"
          ? ["已登记参数不足", "按已登记参数估算满足"]
          : ["待补充", "待补充"];
    await run(
      t,
      async (wb) => {
        const bytes = await wb.xlsx.writeBuffer();
        const serialized = new wb.constructor();
        await serialized.xlsx.load(bytes);
        const rows = [];
        serialized.getWorksheet("PoE带宽校核").eachRow((row) => {
          if (row.getCell(1).value === "上联方向") rows.push(row);
        });
        assert.deepEqual(
          rows.map((row) => row.getCell(12).value),
          expected,
          mode,
        );
        if (mode === "empty" || mode === "one-direction")
          assert.equal(rows[1].getCell(7).value, 0);
      },
      p,
    );
  }
});
