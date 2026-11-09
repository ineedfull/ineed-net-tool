import test from "node:test";
import assert from "node:assert/strict";
import { capacityFixture } from "./helpers/capacity-planning.js";
import { capacityPlanningReport } from "../src/domain/capacity-planning.js";
import {
  validateEngineering,
  remapEngineering,
} from "../src/domain/engineering.js";
test("hand calculated independent full duplex and PSE power", () => {
  const p = capacityFixture(),
    r = capacityPlanningReport(p);
  assert.equal(r.poeLoads[0].requiredWatts, 15);
  assert.equal(r.poeLoads[0].status, "risk");
  assert.equal(r.powerBudgets[0].usableWatts, 32);
  assert.equal(r.powerBudgets[0].remainingWatts, 17);
  assert.equal(r.powerBudgets[0].status, "risk");
  assert.equal(r.uplinks[0].usableMbps, 80);
  assert.equal(r.uplinks[0].forward.knownMbps, 48);
  assert.equal(r.uplinks[0].forward.remainingMbps, 32);
  assert.equal(r.uplinks[0].reverse.knownMbps, 60);
});
test("reject stale snapshots and dangling refs", () => {
  for (const edit of [
    (c) => (c.poeLoads[0].targetInterfaceId = "missing"),
    (c) => (c.uplinks[0].fromInterfaceId = "port2"),
    (c) => (c.powerBudgets[0].deviceId = "missing"),
    (c) => (c.trafficDemands[0].uplinkId = "missing"),
    (c) => (c.poeLoads[0].id = "area"),
  ]) {
    const p = capacityFixture();
    edit(p.engineering.infrastructure.capacityPlanning);
    assert.throws(() => validateEngineering(p.engineering));
  }
});
test("strict numeric fields", () => {
  for (const v of [NaN, Infinity, -1, true, "1", 1.0001, 1001]) {
    const p = capacityFixture();
    p.engineering.infrastructure.capacityPlanning.poeLoads[0].deviceWatts = v;
    assert.throws(() => validateEngineering(p.engineering));
  }
});
test("unknown and known shortage coexist", () => {
  const p = capacityFixture(),
    c = p.engineering.infrastructure.capacityPlanning;
  c.uplinks[0].toMbps = null;
  c.uplinks[0].fromMbps = 50;
  c.trafficDemands[1].concurrencyPercent = null;
  const r = capacityPlanningReport(p);
  assert.equal(r.uplinks[0].status, "risk");
  assert.equal(r.uplinks[0].forward.remainingMbps, null);
  assert.equal(r.uplinks[0].reverse.unknownCount, 1);
});
test("exact milliunit rounding and explicit zero", () => {
  const p = capacityFixture(),
    c = p.engineering.infrastructure.capacityPlanning;
  c.poeLoads[0].deviceWatts = 0.001;
  c.poeLoads[0].lossPercent = 1;
  c.powerBudgets[0].budgetWatts = 0.009;
  c.powerBudgets[0].reservePercent = 1;
  let r = capacityPlanningReport(p);
  assert.equal(r.poeLoads[0].requiredWatts, 0.002);
  assert.equal(r.powerBudgets[0].usableWatts, 0.008);
  c.poeLoads[0].deviceWatts = 0;
  r = capacityPlanningReport(p);
  assert.equal(r.poeLoads[0].requiredWatts, 0);
  c.poeLoads[0].deviceWatts = null;
  assert.equal(capacityPlanningReport(p).poeLoads[0].requiredWatts, null);
});
test("two loads hand sum and current interface owner", () => {
  const p = capacityFixture(),
    i = p.engineering.infrastructure,
    c = i.capacityPlanning;
  i.devices.push({ ...i.devices[1], id: "dev3" });
  i.interfaces.push(
    { ...i.interfaces[0], id: "port3", name: "3" },
    { ...i.interfaces[1], id: "port4", deviceId: "dev3" },
  );
  i.links.push({
    id: "link2",
    fromInterfaceId: "port3",
    toInterfaceId: "port4",
    note: "",
  });
  c.poeLoads.push({
    ...c.poeLoads[0],
    id: "load2",
    linkId: "link2",
    sourceInterfaceId: "port3",
    targetInterfaceId: "port4",
    portBudgetWatts: 20,
  });
  let r = capacityPlanningReport(p);
  assert.equal(r.powerBudgets[0].knownWatts, 30);
  assert.equal(r.powerBudgets[0].remainingWatts, 2);
  i.interfaces[2].deviceId = "dev2";
  r = capacityPlanningReport(p);
  assert.equal(
    r.powerBudgets.find((x) => x.deviceId === "dev2").knownWatts,
    15,
  );
  assert.equal(
    r.powerBudgets.find((x) => x.deviceId === "dev2").status,
    "pending",
  );
});
test("optional missing and explicit empty retain exact shape on remap", () => {
  const p = capacityFixture(),
    i = p.engineering.infrastructure;
  delete i.capacityPlanning;
  assert.equal(capacityPlanningReport(p).enabled, false);
  assert.ok(
    !Object.hasOwn(
      remapEngineering(p.engineering, new Map()).infrastructure,
      "capacityPlanning",
    ),
  );
  i.capacityPlanning = {
    version: 1,
    powerBudgets: [],
    poeLoads: [],
    uplinks: [],
    trafficDemands: [],
  };
  assert.equal(capacityPlanningReport(p).status, "pending");
  assert.deepEqual(
    remapEngineering(p.engineering, new Map()).infrastructure.capacityPlanning,
    i.capacityPlanning,
  );
});
test("full remap changes every id and reconnects every reference", () => {
  const p = capacityFixture();
  let n = 0;
  const e = remapEngineering(p.engineering, new Map(), () => `new-${++n}`),
    i = e.infrastructure,
    c = i.capacityPlanning;
  assert.equal(c.powerBudgets[0].deviceId, i.devices[0].id);
  assert.equal(c.poeLoads[0].linkId, i.links[0].id);
  assert.equal(c.poeLoads[0].sourceInterfaceId, i.interfaces[0].id);
  assert.equal(c.poeLoads[0].targetInterfaceId, i.interfaces[1].id);
  assert.equal(c.uplinks[0].fromInterfaceId, i.interfaces[0].id);
  assert.equal(c.uplinks[0].toInterfaceId, i.interfaces[1].id);
  assert.equal(c.uplinks[0].linkId, i.links[0].id);
  assert.equal(c.trafficDemands[0].uplinkId, c.uplinks[0].id);
  for (const list of [
    e.locations,
    e.demands,
    e.capacities,
    i.devices,
    i.interfaces,
    i.links,
    c.powerBudgets,
    c.poeLoads,
    c.uplinks,
    c.trafficDemands,
  ])
    for (const row of list) assert.match(row.id, /^new-/);
  assert.equal(
    capacityPlanningReport({ ...p, engineering: e }).uplinks[0].forward
      .knownMbps,
    48,
  );
});
test("all foreign refs, deletion and endpoint mutation rejected", () => {
  for (const edit of [
    (i) => i.links.pop(),
    (i) => i.interfaces.pop(),
    (i) => i.devices.pop(),
    (i) => i.capacityPlanning.uplinks.pop(),
    (i) => (i.links[0].fromInterfaceId = "new-port"),
    (i) => (i.capacityPlanning.poeLoads[0].sourceInterfaceId = "foreign"),
    (i) => (i.capacityPlanning.uplinks[0].toInterfaceId = "foreign"),
  ]) {
    const p = capacityFixture();
    edit(p.engineering.infrastructure);
    assert.throws(() => validateEngineering(p.engineering));
  }
});
test("global IDs, ownership uniqueness, text, arrays and all bounds", () => {
  const edits = [
    (c) => (c.version = 2),
    (c) => (c.powerBudgets = {}),
    (c) => c.poeLoads.push({ ...c.poeLoads[0], id: "other" }),
    (c) => c.powerBudgets.push({ ...c.powerBudgets[0], id: "other" }),
    (c) => c.uplinks.push({ ...c.uplinks[0], id: "other" }),
    (c) => (c.trafficDemands[0].name = " "),
    (c) => (c.trafficDemands[0].note = "x".repeat(1001)),
    (c) => (c.trafficDemands[0].direction = "both"),
    (c) => (c.trafficDemands[0].count = 100001),
    (c) => (c.trafficDemands[0].count = 0.1),
    (c) => (c.trafficDemands[0].mbpsPerUnit = 10000.001),
    (c) => (c.trafficDemands[0].growthPercent = null),
    (c) => (c.trafficDemands[0].growthPercent = 1001),
    (c) => (c.trafficDemands[0].concurrencyPercent = 101),
    (c) => (c.powerBudgets[0].budgetWatts = 1000000.001),
    (c) => (c.uplinks[0].fromMbps = 1000000.001),
    (c) => (c.uplinks[0].reservePercent = null),
    (c) => (c.poeLoads[0].lossPercent = 100.1),
  ];
  for (const id of [
    "area",
    "demand",
    "capacity",
    "dev1",
    "port1",
    "link",
    "power",
    "load",
    "uplink",
    "reverse",
    "",
    "x\u0000",
    "x".repeat(101),
  ])
    edits.push((c) => (c.trafficDemands[0].id = id));
  for (const edit of edits) {
    const p = capacityFixture();
    edit(p.engineering.infrastructure.capacityPlanning);
    assert.throws(() => validateEngineering(p.engineering));
  }
  for (const [key, max] of Object.entries({
    powerBudgets: 500,
    poeLoads: 2500,
    uplinks: 500,
    trafficDemands: 500,
  })) {
    const p = capacityFixture(),
      c = p.engineering.infrastructure.capacityPlanning;
    c[key] = Array.from({ length: max + 1 }, () => ({ ...c[key][0] }));
    assert.throws(() => validateEngineering(p.engineering));
  }
});
test("maximum aggregate traffic and exact row-before-sum ceiling", () => {
  const p = capacityFixture(),
    c = p.engineering.infrastructure.capacityPlanning;
  c.trafficDemands = Array.from({ length: 500 }, (_, n) => ({
    ...c.trafficDemands[0],
    id: `max-${n}`,
    count: 100000,
    growthPercent: 1000,
    mbpsPerUnit: 10000,
    concurrencyPercent: 100,
  }));
  let r = capacityPlanningReport(p);
  assert.equal(r.uplinks[0].forward.knownMbps, 5500000000000);
  assert.ok(Number.isSafeInteger(r.uplinks[0].forward.knownMbps * 1000));
  for (const d of c.trafficDemands) {
    d.count = 1;
    d.growthPercent = 0;
    d.mbpsPerUnit = 0.001;
    d.concurrencyPercent = 1;
  }
  r = capacityPlanningReport(p);
  assert.equal(r.uplinks[0].forward.knownMbps, 0.5);
  assert.equal(r.uplinks[0].reverse.demandCount, 0);
  assert.equal(r.uplinks[0].reverse.knownMbps, 0);
});
test("report is pure; budget only is pending; risk and unknown coexist", () => {
  const p = capacityFixture(),
    before = structuredClone(p);
  capacityPlanningReport(p);
  assert.deepEqual(p, before);
  const c = p.engineering.infrastructure.capacityPlanning;
  c.poeLoads[0].portBudgetWatts = null;
  c.poeLoads[0].deviceWatts = 100;
  c.powerBudgets[0].budgetWatts = 1;
  let r = capacityPlanningReport(p);
  assert.equal(r.powerBudgets[0].status, "risk");
  assert.ok(r.issues.some((x) => x.code === "port_budget_unknown"));
  c.poeLoads = [];
  r = capacityPlanningReport(p);
  assert.equal(r.powerBudgets[0].status, "pending");
});
test("direction issues identify the uplink and direction for Excel/UI consumers", () => {
  const p = capacityFixture(),
    c = p.engineering.infrastructure.capacityPlanning;
  c.uplinks[0].toMbps = 1;
  const r = capacityPlanningReport(p);
  const issue = r.issues.find((x) => x.code === "bandwidth_insufficient");
  assert.equal(issue.recordId, "uplink");
  assert.equal(issue.direction, "forward");
});
test("project import wrapper remaps capacity IDs and rejects invalid snapshots", async () => {
  const { projectImport } = await import("../src/domain/projects.js");
  const p = capacityFixture();
  const result = projectImport({
    kind: "ineed-nettool-project",
    version: 1,
    project: p,
    networks: [],
  });
  assert.notEqual(result.project.id, p.id);
  const c = result.project.engineering.infrastructure.capacityPlanning;
  assert.notEqual(c.uplinks[0].id, "uplink");
  assert.equal(c.trafficDemands[0].uplinkId, c.uplinks[0].id);
  assert.equal(
    capacityPlanningReport(result.project).uplinks[0].forward.knownMbps,
    48,
  );
  p.engineering.infrastructure.capacityPlanning.uplinks[0].toInterfaceId =
    "port1";
  assert.throws(() =>
    projectImport({
      kind: "ineed-nettool-project",
      version: 1,
      project: p,
      networks: [],
    }),
  );
});
test("maximal PoE aggregate and unknown demand retain known risk", () => {
  const p = capacityFixture(),
    i = p.engineering.infrastructure,
    c = i.capacityPlanning;
  i.interfaces = [];
  i.links = [];
  c.poeLoads = [];
  c.uplinks = [];
  c.trafficDemands = [];
  for (let n = 0; n < 2500; n++) {
    i.interfaces.push(
      {
        id: `source-${n}`,
        deviceId: "dev1",
        name: `source-${n}`,
        role: "access",
        state: "available",
        note: "",
      },
      {
        id: `target-${n}`,
        deviceId: "dev2",
        name: `target-${n}`,
        role: "other",
        state: "available",
        note: "",
      },
    );
    i.links.push({
      id: `line-${n}`,
      fromInterfaceId: `source-${n}`,
      toInterfaceId: `target-${n}`,
      note: "",
    });
    c.poeLoads.push({
      id: `poe-${n}`,
      linkId: `line-${n}`,
      sourceInterfaceId: `source-${n}`,
      targetInterfaceId: `target-${n}`,
      deviceWatts: 1000,
      lossPercent: 100,
      portBudgetWatts: 1000,
      note: "",
    });
  }
  c.powerBudgets[0].budgetWatts = 1000000;
  c.powerBudgets[0].reservePercent = 0;
  let r = capacityPlanningReport(p);
  assert.equal(r.powerBudgets[0].knownWatts, 5000000);
  assert.equal(r.powerBudgets[0].status, "risk");
  c.poeLoads[0].deviceWatts = null;
  r = capacityPlanningReport(p);
  assert.equal(r.powerBudgets[0].knownWatts, 4998000);
  assert.equal(r.powerBudgets[0].unknownCount, 1);
  assert.equal(r.powerBudgets[0].remainingWatts, null);
  assert.equal(r.powerBudgets[0].status, "risk");
});

test("report validates dangling and foreign engineering network references in normal project shape", () => {
  const p = capacityFixture();
  assert.ok(!Object.hasOwn(p, "networks"));
  p.engineering.demands[0].networkId = "network";
  assert.throws(() => capacityPlanningReport(p), /网段/);
  const foreign = {
    id: "network",
    projectId: "another-project",
    name: "外部",
    cidr: "192.168.1.0/24",
    gateway: "",
    note: "",
    allocations: [],
  };
  assert.throws(() => capacityPlanningReport(p, [foreign]), /网段/);
});

test("report validates actual owned networks and ignores unrelated project networks", () => {
  const p = capacityFixture();
  const owned = {
    id: "network",
    projectId: p.id,
    name: "业务",
    cidr: "192.168.1.0/24",
    gateway: "",
    note: "",
    allocations: [],
  };
  p.engineering.demands[0].networkId = owned.id;
  assert.equal(
    capacityPlanningReport(p, [owned]).uplinks[0].forward.knownMbps,
    48,
  );
  for (const change of [
    (n) => (n.cidr = "invalid"),
    (n) => (n.name = ""),
    (n) => (n.allocations = null),
  ]) {
    const malformed = structuredClone(owned);
    change(malformed);
    assert.throws(() => capacityPlanningReport(p, [malformed]));
  }
  assert.equal(
    capacityPlanningReport(p, [
      owned,
      { projectId: "unrelated", cidr: "invalid" },
    ]).uplinks[0].forward.knownMbps,
    48,
  );
});

test("report rejects a referenced network owned by another project", () => {
  const p = capacityFixture();
  p.engineering.demands[0].networkId = "foreign-network";
  assert.throws(
    () =>
      capacityPlanningReport(p, [
        {
          id: "foreign-network",
          projectId: "another-project",
          name: "外部",
          cidr: "192.168.1.0/24",
          gateway: "",
          note: "",
          allocations: [],
        },
      ]),
    /网段/,
  );
});

test("shared uplink unknowns reach each direction without cross-direction risk", () => {
  const p = capacityFixture(),
    c = p.engineering.infrastructure.capacityPlanning;
  c.uplinks[0].toMbps = null;
  let r = capacityPlanningReport(p).uplinks[0];
  for (const d of [r.forward, r.reverse]) {
    assert.equal(d.status, "pending");
    assert.ok(d.issues.some((i) => i.code === "endpoint_speed_unknown"));
    assert.equal(d.remainingMbps, null);
  }
  c.uplinks[0].fromMbps = 50;
  r = capacityPlanningReport(p).uplinks[0];
  assert.equal(r.forward.status, "risk");
  assert.equal(r.reverse.status, "risk");
  assert.ok(r.forward.issues.some((i) => i.code === "endpoint_speed_unknown"));
  c.uplinks[0].toMbps = 100;
  c.trafficDemands = [c.trafficDemands[0]];
  r = capacityPlanningReport(p).uplinks[0];
  assert.equal(r.forward.status, "risk");
  assert.equal(r.reverse.status, "ok");
  assert.equal(r.reverse.knownMbps, 0);
  assert.equal(r.reverse.remainingMbps, 40);
  assert.deepEqual(r.reverse.issues, []);
  c.trafficDemands = [];
  r = capacityPlanningReport(p).uplinks[0];
  for (const d of [r.forward, r.reverse]) {
    assert.equal(d.status, "pending");
    assert.equal(d.knownMbps, 0);
    assert.ok(d.issues.some((i) => i.code === "traffic_missing"));
  }
});
