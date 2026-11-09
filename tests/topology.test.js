import test from "node:test";
import assert from "node:assert/strict";
import { validateEngineering } from "../src/domain/engineering.js";
import { projectImport } from "../src/domain/projects.js";
import { topologyFixture } from "./helpers/topology.js";
import {
  registeredTopology,
  vlanConfigurationReport,
  topologyAcceptanceItem,
} from "../src/domain/topology.js";
test("logical config validates ownership separately from interface role and preserves old inventory", () => {
  const { project, networks } = topologyFixture();
  validateEngineering(project.engineering, networks);
  const changes = [
    (c) => (c.version = 2),
    (c) => (c.mode = "uplink"),
    (c) => (c.accessVlan = 4095),
    (c) => (c.accessVlan = "20"),
    (c) => (c.allowedVlans = [20, 20]),
    (c) => (c.networkIds = ["foreign"]),
    (c) => (c.networkIds = ["net20", "net20"]),
  ];
  for (const change of changes) {
    const e = structuredClone(project.engineering);
    change(e.infrastructure.interfaces[0].logicalConfig);
    assert.throws(
      () => validateEngineering(e, networks),
      Error,
      String(change),
    );
  }
  const old = structuredClone(project.engineering);
  delete old.infrastructure.logicalVersion;
  old.infrastructure.interfaces.forEach((p) => delete p.logicalConfig);
  validateEngineering(old, networks);
  assert.equal(
    vlanConfigurationReport({ ...project, engineering: old }, networks).status,
    "pending",
  );
});
test("VLAN20 two-level path pinpoints missing trunk and recovers without mutating source", () => {
  const { project, networks } = topologyFixture(),
    before = structuredClone(project);
  assert.equal(vlanConfigurationReport(project, networks).status, "ok");
  assert.deepEqual(project, before);
  project.engineering.infrastructure.interfaces.find(
    (p) => p.id === "uplink2",
  ).logicalConfig.allowedVlans = [30];
  const report = vlanConfigurationReport(project, networks);
  assert.equal(report.status, "risk");
  assert.ok(
    report.issues.some(
      (i) =>
        i.interfaceId === "uplink2" &&
        i.networkId === "net20" &&
        i.vlan === 20 &&
        i.code === "trunk_vlan_missing",
    ),
  );
  project.engineering.infrastructure.interfaces.find(
    (p) => p.id === "uplink2",
  ).logicalConfig.allowedVlans = [20, 30];
  assert.equal(vlanConfigurationReport(project, networks).status, "ok");
});
test("access mismatch, peer segment requirements and insufficient data retain independent findings", () => {
  const { project, networks } = topologyFixture(),
    ports = project.engineering.infrastructure.interfaces;
  ports[1].logicalConfig.accessVlan = 30;
  ports[3].logicalConfig.networkIds = [];
  ports[3].logicalConfig.allowedVlans = [];
  delete ports[4].logicalConfig;
  const report = vlanConfigurationReport(project, networks);
  assert.ok(
    report.issues.some(
      (i) => i.interfaceId === "access" && i.code === "access_vlan_mismatch",
    ),
  );
  assert.ok(
    report.issues.some(
      (i) =>
        i.interfaceId === "downlink2" &&
        i.code === "trunk_vlan_missing" &&
        i.linkId === "level1",
    ),
  );
  assert.ok(
    report.issues.some(
      (i) => i.interfaceId === "uplink2" && i.severity === "pending",
    ),
  );
  assert.ok(
    report.issues.some(
      (i) =>
        i.interfaceId === "downlink2" &&
        i.code === "network_association_missing",
    ),
  );
  networks[0].vlan = "";
  assert.ok(
    vlanConfigurationReport(project, networks).issues.some(
      (i) => i.code === "network_vlan_missing",
    ),
  );
});
test("unassociated segment businesses remain pending without inferring switch-internal forwarding", () => {
  const { project, networks } = topologyFixture();
  for (const port of project.engineering.infrastructure.interfaces)
    if (port.logicalConfig.mode === "trunk") port.logicalConfig.networkIds = [];
  const report = vlanConfigurationReport(project, networks);
  assert.equal(report.status, "pending");
  assert.equal(
    report.issues.filter((i) => i.code === "network_association_missing")
      .length,
    4,
  );
  assert.equal(
    report.issues.some((i) => i.code === "trunk_vlan_missing"),
    false,
  );
});
test("registered topology filters descendants and retains boundary and isolated device records", () => {
  const { project } = topologyFixture();
  project.engineering.infrastructure.devices.push({
    id: "isolated",
    name: "孤立设备",
    locationId: "area1",
    kind: "other",
    model: "",
    note: "",
  });
  const graph = registeredTopology(project, { locationId: "floor" });
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ["host", "sw1", "sw2", "isolated"],
  );
  assert.equal(graph.nodes.find((n) => n.id === "sw2").boundary, true);
  assert.deepEqual(
    graph.links.map((l) => l.id),
    ["edge", "level1"],
  );
  assert.equal(registeredTopology(project, { pageSize: 2 }).nodes.length, 2);
  assert.equal(registeredTopology(project, { pageSize: 2 }).total, 5);
  assert.throws(
    () => registeredTopology(project, { locationId: "foreign" }),
    /位置/,
  );
});
test("new-project import regenerates all logical network refs and does not touch original project", () => {
  const { project, networks } = topologyFixture(),
    before = structuredClone({ project, networks });
  let n = 0;
  const value = projectImport(
    { kind: "ineed-nettool-project", version: 1, project, networks },
    () => `new-${++n}`,
  );
  const e = value.project.engineering,
    network = value.networks[0];
  for (const p of e.infrastructure.interfaces) {
    assert.deepEqual(p.logicalConfig.networkIds, [network.id]);
    assert.ok(p.id.startsWith("new-"));
  }
  validateEngineering(e, value.networks);
  assert.deepEqual({ project, networks }, before);
});
test("physical ring stays bounded and page boundaries retain every registered connection", () => {
  const { project, networks } = topologyFixture();
  const inventory = project.engineering.infrastructure;
  for (const [id, deviceId] of [
    ["ring1", "sw1"],
    ["ring3", "sw3"],
  ])
    inventory.interfaces.push({
      ...structuredClone(inventory.interfaces[2]),
      id,
      name: id,
      deviceId,
    });
  inventory.links.push({
    id: "ring",
    fromInterfaceId: "ring1",
    toInterfaceId: "ring3",
    note: "",
  });
  const before = structuredClone(project);
  const graph = registeredTopology(project, { pageSize: 2 });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.allLinks.length, 4);
  assert.equal(graph.links.length, 1);
  assert.equal(
    registeredTopology(project, { page: 1, pageSize: 2 }).nodes.length,
    2,
  );
  assert.equal(vlanConfigurationReport(project, networks).status, "ok");
  assert.match(graph.basis, /不证明/);
  assert.deepEqual(project, before);
});
test("finding action creates only an existing manual acceptance item and rejects stale/forged targets", () => {
  const { project, networks } = topologyFixture();
  project.engineering.infrastructure.interfaces[2].logicalConfig.allowedVlans =
    [];
  const finding = vlanConfigurationReport(project, networks).issues.find(
    (i) => i.code === "trunk_vlan_missing",
  );
  const next = topologyAcceptanceItem(
    project,
    finding,
    networks,
    () => "acceptance-new",
  );
  assert.equal(project.engineering.siteAcceptance, undefined);
  assert.equal(next.engineering.siteAcceptance.items[0].targetId, "uplink1");
  assert.equal(next.engineering.siteAcceptance.items[0].method, "manual");
  assert.equal(next.engineering.siteAcceptance.results.length, 0);
  assert.match(next.engineering.siteAcceptance.items[0].expected, /20/);
  assert.throws(
    () =>
      topologyAcceptanceItem(
        project,
        { ...finding, interfaceId: "foreign" },
        networks,
      ),
    /问题/,
  );
});
