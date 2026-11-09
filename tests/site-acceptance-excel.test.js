import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import excel from "../electron/excel.cjs";
import { capacityFixture } from "./helpers/capacity-planning.js";
import { item, result, action, history } from "./helpers/site-acceptance.js";
import {
  saveAcceptanceItem,
  recordAcceptanceResult,
  saveAcceptanceAction,
  resolveAcceptanceAction,
  siteAcceptanceReport,
} from "../src/domain/site-acceptance.js";
import { projectImport } from "../src/domain/projects.js";
function fixture() {
  let p = capacityFixture();
  const networks = [
    {
      id: "net",
      projectId: p.id,
      name: "回环测试",
      cidr: "10.1.0.0/24",
      vlan: "",
      gateway: "",
      dhcpStart: "",
      dhcpEnd: "",
      note: "",
      allocations: [],
    },
  ];
  p.engineering.demands[0].networkId = "net";
  p = saveAcceptanceItem(
    p,
    item({ targetType: "link", targetId: "link", method: "ping" }),
    networks,
  );
  p = recordAcceptanceResult(
    p,
    result({ historyId: "h" }),
    [history({ projectId: p.id })],
    networks,
  );
  p = saveAcceptanceAction(p, action(), networks);
  p = recordAcceptanceResult(
    p,
    result({ id: "r2", outcome: "passed", historyId: "h" }),
    [history({ projectId: p.id })],
    networks,
  );
  p = resolveAcceptanceAction(p, "a1", "r2", networks);
  p = saveAcceptanceItem(
    p,
    { ...p.engineering.siteAcceptance.items[0], expected: "新版要求" },
    networks,
  );
  p = recordAcceptanceResult(
    p,
    result({ id: "r3", historyId: "h" }),
    [history({ projectId: p.id })],
    networks,
  );
  p = saveAcceptanceAction(
    p,
    action({ id: "a2", failedResultId: "r3" }),
    networks,
  );
  return { p, networks };
}
async function run(t, mutate = () => {}, data = fixture()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acceptance-xlsx-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wb = await excel.projectWorkbook(data.p, data.networks);
  await mutate(wb);
  const filename = path.join(dir, "handover.xlsx");
  await wb.xlsx.writeFile(filename);
  return { parsed: await excel.readProjectWorkbook(filename), wb, filename };
}
test("acceptance real serialized 27 sheets preserve revision history evidence and fresh graph", async (t) => {
  const { parsed } = await run(t, (wb) =>
    assert.equal(wb.worksheets.length, 27),
  );
  assert.deepEqual(parsed.errors, []);
  const imported = projectImport(parsed);
  const p = imported.project,
    a = p.engineering.siteAcceptance;
  assert.equal(a.results[0].evidence.sourceId, "h");
  assert.equal(a.items[0].revision, 2);
  assert.deepEqual(
    a.results.map((r) => r.itemRevision),
    [1, 1, 2],
  );
  assert.equal(a.actions[0].resolvedByResultId, a.results[1].id);
  assert.equal(a.actions[1].resolvedByResultId, "");
  assert.equal(a.items[0].targetId, p.engineering.infrastructure.links[0].id);
  assert.ok(
    a.results.every((r) => r.criteria.targetId === a.items[0].targetId),
  );
  assert.equal(
    siteAcceptanceReport(p, imported.networks).items[0].status,
    "failed",
  );
  assert.notEqual(a.items[0].id, "check");
  assert.notEqual(p.engineering.demands[0].networkId, "net");
});
const names = ["验收清单", "验收结果", "整改复验"];
function marker(wb) {
  let found;
  wb.getWorksheet("填写说明").eachRow((r) => {
    if (r.getCell(1).value === "现场验收版本") found = r;
  });
  return found;
}
for (const mode of [
  "unknown",
  "duplicate",
  "duplicate-empty",
  "missing",
  "empty",
  "partial",
  "engineering",
])
  test(`acceptance marker rejects ${mode}`, async (t) => {
    await assert.rejects(
      run(t, (wb) => {
        const m = marker(wb);
        if (mode === "unknown") m.getCell(2).value = 2;
        if (mode === "duplicate")
          wb.getWorksheet("填写说明").addRow(["现场验收版本", 1]);
        if (mode === "duplicate-empty") {
          m.getCell(2).value = "";
          wb.getWorksheet("填写说明").addRow(["现场验收版本", ""]);
        }
        if (mode === "missing") m.getCell(1).value = "removed";
        if (mode === "empty") m.getCell(2).value = "";
        if (mode === "partial") wb.removeWorksheet(names[1]);
        if (mode === "engineering") wb.removeWorksheet("场地位置");
      }),
      /验收|工程|工作表/,
    );
  });
for (const address of ["A2", "B2", "J2", "K2"])
  for (const value of [
    12,
    true,
    new Date("2026-10-27T00:00:00Z"),
    { formula: "1+1", result: 2 },
    { text: "text", hyperlink: "https://example.com" },
    { richText: [{ text: "text" }] },
  ])
    test(`acceptance structured text rejects ${address} ${JSON.stringify(value)}`, async (t) => {
      await assert.rejects(
        run(t, (wb) => {
          wb.getWorksheet(names[1]).getCell(address).value = value;
        }),
      );
    });
for (const value of [
  true,
  new Date(),
  { formula: "1+1", result: 2 },
  "1e2",
  "1.0",
  "-1",
  " 1",
  "9007199254740992",
])
  test(`acceptance integer rejects ${JSON.stringify(value)}`, async (t) => {
    await assert.rejects(
      run(t, (wb) => {
        wb.getWorksheet(names[0]).getCell("B2").value = value;
      }),
    );
  });
test("acceptance integer percent guards and literal percent", async (t) => {
  for (const format of ["0%", "0;0%;0", "[Red]0%"])
    await assert.rejects(
      run(t, (wb) => {
        wb.getWorksheet(names[0]).getCell("B2").numFmt = format;
      }),
    );
  const { parsed } = await run(t, (wb) => {
    wb.getWorksheet(names[0]).getCell("B2").numFmt = '0"%"';
    wb.getWorksheet(names[0]).getCell("B2").value = "2";
  });
  assert.deepEqual(parsed.errors, []);
});
test("acceptance oversized cell rejects before JSON/domain parsing", async (t) => {
  await assert.rejects(
    run(t, (wb) => {
      wb.getWorksheet(names[1]).getCell("K2").value = "x".repeat(32768);
    }),
    /32767/,
  );
});
test("acceptance domain invalid previews have bounded errors and no project", async (t) => {
  for (const [sheet, cell, value] of [
    [names[0], "B2", 1000001],
    [names[0], "G2", "x".repeat(1001)],
    [names[1], "D3", 1],
    [names[1], "E2", "2026-02-30T00:00:00.000Z"],
    [names[1], "J2", "null"],
    [names[1], "K2", "{}"],
    [names[2], "C2", "missing"],
    [names[2], "H2", "R001"],
    [names[0], "A3", "K001"],
  ]) {
    const { parsed } = await run(t, (wb) => {
      if (cell === "A3")
        wb.getWorksheet(sheet).getRow(3).values = wb
          .getWorksheet(sheet)
          .getRow(2).values;
      wb.getWorksheet(sheet).getCell(cell).value = value;
    });
    assert.ok(parsed.errors.length, `${sheet} ${cell}`);
    assert.ok(parsed.errors.length <= 50);
    assert.equal(parsed.project, undefined);
  }
});
test("acceptance custom misleading C codes and graph ID collisions use actual maps", async (t) => {
  const { parsed } = await run(t, (wb) => {
    wb.getWorksheet("接入容量").getCell("A2").value = "excel-acceptance-1";
    wb.getWorksheet("接口连接").getCell("A2").value = "C999";
    for (const name of ["PoE负载", "上联参数"])
      wb.getWorksheet(name).getCell("B2").value = "C999";
    const s = wb.getWorksheet(names[0]);
    s.getCell("A2").value = "R001";
    s.getCell("E2").value = "C999";
    for (let row = 2; row <= 4; row++) {
      const r = wb.getWorksheet(names[1]);
      r.getCell(`B${row}`).value = "R001";
      const c = JSON.parse(r.getCell(`J${row}`).value);
      c.targetId = "C999";
      r.getCell(`J${row}`).value = JSON.stringify(c);
    }
    for (let row = 2; row <= 3; row++)
      wb.getWorksheet(names[2]).getCell(`B${row}`).value = "R001";
  });
  assert.deepEqual(parsed.errors, []);
  const p = projectImport(parsed).project;
  assert.equal(
    p.engineering.siteAcceptance.items[0].targetId,
    p.engineering.infrastructure.links[0].id,
  );
});
test("acceptance absent and explicit empty survive; derived sheet ignored completely", async (t) => {
  for (const enabled of [false, true]) {
    const data = fixture();
    if (enabled)
      data.p.engineering.siteAcceptance = {
        version: 1,
        items: [],
        results: [],
        actions: [],
      };
    else delete data.p.engineering.siteAcceptance;
    const { parsed } = await run(
      t,
      (wb) => {
        wb.getWorksheet("现场验收报告").getCell("A1").value = {
          formula: "BAD()",
        };
      },
      data,
    );
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(
      parsed.project.engineering.siteAcceptance,
      enabled ? { version: 1, items: [], results: [], actions: [] } : undefined,
    );
  }
});
test("acceptance legacy 5/8/12/16/21 sheets import without enabling acceptance", async (t) => {
  for (const count of [5, 8, 12, 16, 21]) {
    const data = fixture();
    delete data.p.engineering.siteAcceptance;
    if (count < 21) delete data.p.engineering.infrastructure.capacityPlanning;
    if (count < 16) delete data.p.engineering.infrastructure;
    if (count < 12) delete data.p.engineering;
    const { parsed } = await run(
      t,
      (wb) => {
        for (const s of [...wb.worksheets].slice(count))
          wb.removeWorksheet(s.id);
        marker(wb).getCell(1).value = "removed";
      },
      data,
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.project.engineering?.siteAcceptance, undefined);
  }
});
test("acceptance maximum arrays and text serialize and import under file/cell guards", async (t) => {
  const data = fixture(),
    a = data.p.engineering.siteAcceptance,
    base = a.items[0],
    r = a.results[2],
    ac = a.actions[1];
  const evidence = {
    ...r.evidence,
    target: "t".repeat(2048),
    parameters: "p".repeat(2048),
    detail: "d".repeat(1000),
    metrics: Array.from({ length: 8 }, (_, n) => ({
      label: "m".repeat(39) + n,
      value: n === 0 ? null : n,
      unit: "u".repeat(16),
    })),
  };
  evidence.sourceId = "s".repeat(100);
  const extraBytes = 8192 - Buffer.byteLength(JSON.stringify(evidence));
  assert.ok(extraBytes >= 0 && extraBytes <= 4096);
  const triples = Math.floor(extraBytes / 2),
    doubles = extraBytes % 2;
  evidence.parameters =
    "中".repeat(triples) +
    "é".repeat(doubles) +
    "p".repeat(2048 - triples - doubles);
  assert.equal(Buffer.byteLength(JSON.stringify(evidence)), 8192);
  a.items = Array.from({ length: 500 }, (_, n) => ({
    ...base,
    id: `max-item-${n}`,
    name: "n".repeat(100),
    expected: "e".repeat(1000),
    owner: "o".repeat(100),
    note: "n".repeat(1000),
  }));
  a.results = Array.from({ length: 2000 }, (_, n) => ({
    ...r,
    id: `max-result-${n}`,
    itemId: a.items[n % 500].id,
    sequence: n + 1,
    operator: "o".repeat(100),
    actual: "a".repeat(2000),
    note: "n".repeat(1000),
    criteria: {
      ...r.criteria,
      name: "n".repeat(100),
      expected: "e".repeat(1000),
    },
    evidence,
  }));
  a.actions = Array.from({ length: 1000 }, (_, n) => ({
    ...ac,
    id: `max-action-${n}`,
    itemId: a.results[n].itemId,
    failedResultId: a.results[n].id,
    description: "d".repeat(2000),
    owner: "o".repeat(100),
    note: "n".repeat(1000),
  }));
  const { parsed, filename } = await run(
    t,
    (wb) => {
      for (const sheet of wb.worksheets)
        sheet.eachRow((row) =>
          row.eachCell((c) => {
            if (typeof c.value === "string") assert.ok(c.value.length <= 32767);
          }),
        );
    },
    data,
  );
  const bytes = (await fs.stat(filename)).size;
  t.diagnostic(
    `Maximum XLSX ${bytes} bytes; evidence exactly ${Buffer.byteLength(JSON.stringify(evidence))} UTF8 bytes`,
  );
  assert.ok(bytes < 10 * 1024 * 1024);
  assert.deepEqual(parsed.errors, []);
  const imported = projectImport(parsed).project.engineering.siteAcceptance;
  assert.deepEqual(
    [imported.items.length, imported.results.length, imported.actions.length],
    [500, 2000, 1000],
  );
  assert.deepEqual(imported.results[0].evidence, evidence);
});
test("acceptance marker rejects active percent and structured values", async (t) => {
  for (const value of [
    true,
    new Date(),
    { formula: "1", result: 1 },
    { text: "1", hyperlink: "https://example.com" },
    { richText: [{ text: "1" }] },
  ])
    await assert.rejects(
      run(t, (wb) => {
        marker(wb).getCell(2).value = value;
      }),
    );
  await assert.rejects(
    run(t, (wb) => {
      marker(wb).getCell(2).numFmt = "0%";
    }),
    /百分比/,
  );
});
test("acceptance empty orphan result data and duplicate local result/action IDs reject", async (t) => {
  for (const mode of [
    "result-orphan",
    "action-orphan",
    "result-duplicate",
    "action-duplicate",
  ]) {
    const { parsed } = await run(t, (wb) => {
      if (mode.endsWith("orphan")) {
        const s = wb.getWorksheet(names[0]);
        s.getRow(2).values = [];
        if (mode === "action-orphan")
          for (let n = 2; n <= 4; n++)
            wb.getWorksheet(names[1]).getRow(n).values = [];
      } else {
        const s = wb.getWorksheet(
          mode.startsWith("result") ? names[1] : names[2],
        );
        s.getCell("A3").value = s.getCell("A2").value;
      }
    });
    assert.ok(parsed.errors.length);
    assert.equal(parsed.project, undefined);
  }
});
test("acceptance device and interface targets and all active IDs rebuild", async (t) => {
  const data = fixture();
  for (const [targetType, targetId] of [
    ["device", "dev1"],
    ["interface", "port1"],
  ]) {
    data.p = saveAcceptanceItem(
      data.p,
      item({ id: `check-${targetType}`, targetType, targetId }),
      data.networks,
    );
    data.p = recordAcceptanceResult(
      data.p,
      result({ id: `result-${targetType}`, itemId: `check-${targetType}` }),
      [],
      data.networks,
    );
  }
  const { parsed } = await run(t, () => {}, data);
  assert.deepEqual(parsed.errors, []);
  const p = projectImport(parsed).project,
    a = p.engineering.siteAcceptance;
  assert.equal(a.items[1].targetId, p.engineering.infrastructure.devices[0].id);
  assert.equal(
    a.items[2].targetId,
    p.engineering.infrastructure.interfaces[0].id,
  );
  const ids = (value) => {
    const out = [];
    const collect = (v) => {
      if (v && typeof v === "object") {
        if (typeof v.id === "string") out.push(v.id);
        for (const c of Object.values(v))
          if (c && typeof c === "object") collect(c);
      }
    };
    collect(value);
    return out;
  };
  const old = new Set(ids(data.p.engineering));
  assert.ok(ids(p.engineering).every((id) => !old.has(id)));
  assert.equal(new Set(ids(p.engineering)).size, ids(p.engineering).length);
});
test("acceptance file guard refuses over 10MiB before reading XLSX", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acceptance-limit-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "oversized.xlsx");
  await fs.writeFile(filename, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(excel.readProjectWorkbook(filename), /10 MB/);
});
test("acceptance text cells reject active percentage formats", async (t) => {
  await assert.rejects(
    run(t, (wb) => {
      wb.getWorksheet(names[0]).getCell("C2").numFmt = "0%";
    }),
    /百分比/,
  );
});
test("acceptance whitespace local codes reject", async (t) => {
  const { parsed } = await run(t, (wb) => {
    wb.getWorksheet(names[0]).getCell("A2").value = " ";
    for (let n = 2; n <= 4; n++)
      wb.getWorksheet(names[1]).getCell(`B${n}`).value = " ";
    for (let n = 2; n <= 3; n++)
      wb.getWorksheet(names[2]).getCell(`B${n}`).value = " ";
  });
  assert.ok(parsed.errors.length);
  assert.equal(parsed.project, undefined);
});

test("serialized handover preserves readable endpoint snapshots and remaps active references", async (t) => {
  const data = fixture();
  const expected = "交换机 · 区域 / 1 → 终端 · 区域 / 1";
  assert.equal(
    data.p.engineering.siteAcceptance.results[0].criteria.targetLabel,
    expected,
  );
  for (const [i, targetId] of ["port1", "port2"].entries()) {
    data.p = saveAcceptanceItem(
      data.p,
      item({ id: `interface-check-${i}`, targetType: "interface", targetId }),
      data.networks,
    );
    data.p = recordAcceptanceResult(
      data.p,
      result({ id: `interface-result-${i}`, itemId: `interface-check-${i}` }),
      [],
      data.networks,
    );
  }
  data.p.engineering.infrastructure.devices[0].name = "交付前改名";
  const before = data.p.engineering.siteAcceptance.results.map(
    (r) => r.criteria.targetLabel,
  );
  const { parsed } = await run(t, () => {}, data);
  assert.deepEqual(parsed.errors, []);
  const imported = projectImport(parsed);
  const plan = imported.project.engineering.siteAcceptance;
  assert.deepEqual(
    plan.results.map((r) => r.criteria.targetLabel),
    before,
  );
  assert.deepEqual(before.slice(-2), ["交换机 · 区域 / 1", "终端 · 区域 / 1"]);
  assert.notEqual(plan.items[0].targetId, "link");
  for (const r of plan.results) {
    const activeItem = plan.items.find((i) => i.id === r.itemId);
    assert.equal(r.criteria.targetId, activeItem.targetId);
    assert.ok(!["port1", "port2", "link"].includes(r.criteria.targetId));
  }
  assert.match(
    siteAcceptanceReport(imported.project, imported.networks).items[0]
      .targetLabel,
    /交付前改名/,
  );
  assert.equal(plan.results[0].evidence.sourceId, "h");
});
