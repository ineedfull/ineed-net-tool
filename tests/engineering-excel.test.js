import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import excel from "../electron/excel.cjs";
import ExcelJS from "exceljs";
import { newProject } from "../src/domain/projects.js";
import { engineeringReport } from "../src/domain/engineering.js";
export function example() {
  const project = newProject("p", "工程办公室");
  project.engineering = {
    version: 1,
    locations: [
      { id: "b", parentId: "", kind: "building", name: "楼栋", note: "" },
      {
        id: "a",
        parentId: "b",
        kind: "area",
        name: "办公室",
        note: "区域备注",
      },
    ],
    demands: [
      {
        id: "d",
        locationId: "a",
        name: "办公终端",
        kind: "wired",
        count: 40,
        growthPercent: 20,
        addressesPerUnit: 1,
        portsPerUnit: 1,
        addressMode: "dhcp",
        networkId: "n",
        note: "需求备注",
      },
    ],
    capacities: [
      { id: "c", locationId: "a", accessPorts: 48, note: "容量备注" },
    ],
  };
  const networks = [
    {
      id: "n",
      projectId: "p",
      name: "办公",
      cidr: "192.168.10.0/24",
      vlan: "",
      gateway: "192.168.10.1",
      dhcpStart: "192.168.10.10",
      dhcpEnd: "192.168.10.100",
      note: "",
      allocations: [],
    },
  ];
  return { project, networks };
}
async function roundtrip(t, mutate = () => {}, data = example()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "engineering-excel-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wb = await excel.projectWorkbook(data.project, data.networks);
  await mutate(wb);
  const file = path.join(dir, "input.xlsx");
  await wb.xlsx.writeFile(file);
  return excel.readProjectWorkbook(file);
}
test("engineering workbook roundtrip preserves every field and hierarchy without connectivity", async (t) => {
  const result = await roundtrip(t);
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.connectivity, undefined);
  const e = result.project.engineering;
  assert.equal(e.version, 1);
  assert.equal(e.locations[1].parentId, e.locations[0].id);
  assert.equal(e.demands[0].locationId, e.locations[1].id);
  assert.equal(e.demands[0].networkId, "N001");
  assert.deepEqual(
    { ...e.demands[0], id: "d", locationId: "a", networkId: "n" },
    example().project.engineering.demands[0],
  );
  assert.equal(e.capacities[0].note, "容量备注");
});
test("changed inputs recompute report and ignore even malformed stale derived output", async (t) => {
  const result = await roundtrip(t, (wb) => {
    wb.getWorksheet("业务需求").getCell("E2").value = 100;
    wb.getWorksheet("容量校核").getCell("A1").value = {
      formula: "1+1",
      result: "容量充足",
    };
  });
  assert.deepEqual(result.errors, []);
  assert.equal(
    engineeringReport(result.project, result.networks).status,
    "risk",
  );
});
test("blank quantities remain unknown and explicit zeros remain known", async (t) => {
  const result = await roundtrip(t, (wb) => {
    wb.getWorksheet("业务需求").getCell("E2").value = null;
    wb.getWorksheet("接入容量").getCell("C2").value = 0;
  });
  assert.equal(result.project.engineering.demands[0].count, null);
  assert.equal(result.project.engineering.capacities[0].accessPorts, 0);
  assert.equal(
    engineeringReport(result.project, result.networks).status,
    "pending",
  );
});
test("engineering inputs require all three sheets", async (t) => {
  await assert.rejects(
    roundtrip(t, (wb) => wb.removeWorksheet("接入容量")),
    /三张表|接入容量/,
  );
});
for (const [sheet, cell, value, pattern] of [
  ["场地位置", "B3", "missing", /场地位置.*第 3 行|层级/],
  ["业务需求", "J2", "missing", /业务需求.*第 2 行|网段/],
  ["业务需求", "E2", -1, /业务需求.*第 2 行|整数/],
  ["业务需求", "F2", 1.5, /业务需求.*第 2 行|整数/],
  ["业务需求", "G2", 17, /业务需求.*第 2 行|整数/],
  ["场地位置", "A3", "L001", /重复/],
  ["接入容量", "C2", 1000001, /整数/],
]) {
  test(`invalid engineering ${sheet} ${cell} ${value}`, async (t) => {
    const result = await roundtrip(t, (wb) => {
      wb.getWorksheet(sheet).getCell(cell).value = value;
    });
    assert.ok(result.errors.length);
    assert.match(result.errors.join(), pattern);
  });
}
for (const value of [
  { formula: "1+1", result: 2 },
  { text: "link", hyperlink: "https://example.com" },
  { richText: [{ text: "text" }] },
])
  test("engineering rejects structured input cells", async (t) => {
    await assert.rejects(
      roundtrip(t, (wb) => {
        wb.getWorksheet("业务需求").getCell("E2").value = value;
      }),
      /业务需求 第 2 行 E2/,
    );
  });
test("engineering sheets have readable dropdowns and frozen headers", async () => {
  const { project, networks } = example();
  const wb = await excel.projectWorkbook(project, networks);
  assert.equal(
    wb.getWorksheet("场地位置").getCell("C2").dataValidation.type,
    "list",
  );
  assert.equal(wb.getWorksheet("业务需求").getCell("D2").value, "有线办公");
  assert.equal(wb.getWorksheet("业务需求").views[0].ySplit, 1);
  assert.equal(wb.getWorksheet("接入容量").getColumn(3).numFmt, "0");
  const demandRow = wb
    .getWorksheet("容量校核")
    .getRows(2, 10)
    .find((row) => row.getCell(1).value === "需求");
  assert.match(demandRow.getCell(11).value, /ceil/);
});

test("empty enabled engineering survives and unsupported workbook version fails", async (t) => {
  const data = example();
  data.project.engineering = {
    version: 1,
    locations: [],
    demands: [],
    capacities: [],
  };
  const result = await roundtrip(t, () => {}, data);
  assert.deepEqual(result.project.engineering, data.project.engineering);
  await assert.rejects(
    roundtrip(t, (wb) => {
      wb.getWorksheet("填写说明").eachRow((row) => {
        if (row.getCell(1).value === "工程资料版本") row.getCell(2).value = 2;
      });
    }),
    /版本/,
  );
});
test("blank capacity and known zero demand remain distinct", async (t) => {
  const r = await roundtrip(t, (wb) => {
    wb.getWorksheet("业务需求").getCell("E2").value = 0;
    wb.getWorksheet("接入容量").getCell("C2").value = null;
  });
  assert.equal(r.project.engineering.demands[0].count, 0);
  assert.equal(r.project.engineering.capacities[0].accessPorts, null);
});
test("eight sheet workbook imports with engineering absent", async (t) => {
  const result = await roundtrip(
    t,
    (wb) => {
      for (const name of ["场地位置", "业务需求", "接入容量", "容量校核"])
        wb.removeWorksheet(name);
      wb.getWorksheet("填写说明").eachRow((row) => {
        if (row.getCell(1).value === "工程资料版本")
          row.getCell(2).value = null;
      });
    },
    { project: newProject("p", "旧项目"), networks: [] },
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.engineering, undefined);
});
test("engineering row limits reject oversized input", async (t) => {
  await assert.rejects(
    roundtrip(t, (wb) => {
      const s = wb.getWorksheet("业务需求");
      for (let i = 3; i <= 1002; i++)
        s.getRow(i).values = [
          `D${i}`,
          "L002",
          "需求",
          "有线办公",
          0,
          0,
          1,
          1,
          "DHCP",
          "N001",
          "",
        ];
    }),
    /业务需求.*1000/,
  );
});
test("duplicate demand IDs and duplicate area capacities reject preview", async (t) => {
  for (const name of ["业务需求", "接入容量"]) {
    const result = await roundtrip(t, (wb) => {
      const s = wb.getWorksheet(name);
      s.getRow(3).values = s.getRow(2).values;
    });
    assert.match(result.errors.join(), /重复/);
  }
});
test("maximal legal unknown demands export every issue without oversized cells", async (t) => {
  const { project, networks } = example();
  project.engineering.demands = Array.from({ length: 1000 }, (_, i) => ({
    ...project.engineering.demands[0],
    id: `d${i}`,
    name: "需求".repeat(50),
    count: null,
    networkId: "",
  }));
  const report = engineeringReport(project, networks);
  const wb = await excel.projectWorkbook(project, networks);
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "engineering-max-excel-"),
  );
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const output = path.join(folder, "max.xlsx");
  await wb.xlsx.writeFile(output);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.readFile(output);
  const sheet = loaded.getWorksheet("容量校核");
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === "string")
        assert.ok(
          cell.value.length <= 32767,
          `${cell.address} exceeds Excel cell limit`,
        );
    }),
  );
  const issues = [];
  sheet.eachRow((row) => {
    if (row.getCell(1).value === "问题") issues.push(row);
  });
  assert.equal(issues.length, report.issues.length);
  assert.deepEqual(
    issues.map((row) => row.getCell(13).value),
    report.issues.map((issue) => issue.message),
  );
  assert.equal(issues[0].getCell(2).value, "D001");
  assert.equal(issues[0].getCell(3).value, "L002");
  assert.equal(issues[0].getCell(12).value, "待补充");
});
for (const [sheet, address] of [
  ["业务需求", "E2"],
  ["业务需求", "F2"],
  ["业务需求", "G2"],
  ["业务需求", "H2"],
  ["接入容量", "C2"],
]) {
  for (const format of ["0%", "0.00%", "0;[Red]-0%"])
    test(`reject effective percentage format ${sheet} ${address} ${format}`, async (t) => {
      await assert.rejects(
        roundtrip(t, (wb) => {
          const cell = wb.getWorksheet(sheet).getCell(address);
          cell.value = 1;
          cell.numFmt = format;
        }),
        new RegExp(`${sheet} 第 2 行 ${address}.*百分比`),
      );
    });
}
for (const format of ["0", "0.00", '0"%"', '0"%";[Red]-0"%"'])
  test(`accept ordinary and literal-percent formats ${format}`, async (t) => {
    const result = await roundtrip(t, (wb) => {
      const cell = wb.getWorksheet("业务需求").getCell("F2");
      cell.value = 20;
      cell.numFmt = format;
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.project.engineering.demands[0].growthPercent, 20);
  });
test("plain numeric one means one percent growth", async (t) => {
  const result = await roundtrip(t, (wb) => {
    wb.getWorksheet("业务需求").getCell("F2").value = 1;
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.project.engineering.demands[0].growthPercent, 1);
});

for (const format of ["0\\%", '0"%";[Red]-0\\%']) {
  test(`serialized escaped percent loses escaping and is safely rejected ${format}`, async (t) => {
    await assert.rejects(
      roundtrip(t, (wb) => {
        const cell = wb.getWorksheet("业务需求").getCell("F2");
        cell.value = 20;
        cell.numFmt = format;
      }),
      /业务需求 第 2 行 F2.*百分比/,
    );
  });
}
