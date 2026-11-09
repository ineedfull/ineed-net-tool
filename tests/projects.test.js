import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  newProject,
  normalizeWorkspace,
  validateWorkspace,
  templateNetworks,
  nextAvailableAddress,
  registerAddresses,
  projectImport,
  projectExport,
  validateProjects,
  applyWorkspacePatch,
} from "../src/domain/projects.js";
const office = () =>
  templateNetworks(
    "office-small",
    "192.168.10.0/24",
    "default-project",
    () => "office",
  );

test("scenario templates partition private address space and reserve only gateways", () => {
  let id = 0;
  const networks = templateNetworks(
    "surveillance",
    "10.20.0.0/22",
    "default-project",
    () => `n${++id}`,
  );
  assert.deepEqual(
    networks.map((n) => n.cidr),
    ["10.20.0.0/23", "10.20.2.0/24", "10.20.3.0/24"],
  );
  assert.ok(
    networks.every(
      (n) =>
        n.allocations.length === 1 && n.allocations[0].status === "reserved",
    ),
  );
  validateWorkspace({ ...emptyWorkspace(), networks });
  assert.throws(
    () => templateNetworks("office-zones", "10.0.0.0/24", "p"),
    /空间不足/,
  );
  assert.throws(
    () => templateNetworks("office-small", "8.8.8.0/24", "p"),
    /私有地址/,
  );
});
test("legacy JSON receives a project without mutating its input", () => {
  const old = {
    version: 1,
    networks: office().map(({ projectId, ...n }) => n),
    settings: { theme: "dark", largeFont: true },
    history: [{ id: "h" }],
  };
  const state = normalizeWorkspace(old);
  assert.equal(old.version, 1);
  assert.equal(old.networks[0].projectId, undefined);
  assert.equal(state.version, 2);
  assert.equal(state.networks[0].projectId, "default-project");
  assert.equal(state.history[0].projectId, "default-project");
  assert.throws(() => normalizeWorkspace({ ...old, version: 3 }));
  assert.throws(() => normalizeWorkspace({ ...old, networks: null }));
});
test("duplicate IPs are blocked across overlapping networks within the same project and VLAN", () => {
  const [n] = office();
  const twin = { ...structuredClone(n), id: "twin" };
  assert.throws(
    () => validateWorkspace({ ...emptyWorkspace(), networks: [n, twin] }),
    /已登记/,
  );
  validateWorkspace({
    ...emptyWorkspace(),
    networks: [n, { ...twin, vlan: 20 }],
  });
  validateWorkspace({
    ...emptyWorkspace(),
    projects: [
      ...emptyWorkspace().projects,
      newProject("second", "异地办公室"),
    ],
    networks: [n, { ...twin, projectId: "second" }],
  });
});
test("batch registration skips gateway, occupied IPs and DHCP and fails atomically on exhaustion", () => {
  const networks = office();
  const entry = { ip: "", label: "摄像机", type: "camera", status: "reserved" };
  const result = registerAddresses(networks[0], networks, entry, 100);
  assert.equal(result[0].allocations[1].ip, "192.168.10.2");
  assert.equal(result[0].allocations[99].ip, "192.168.10.200");
  assert.equal(networks[0].allocations.length, 1);
  assert.throws(() => registerAddresses(result[0], result, entry, 128), /足够/);
  assert.equal(result[0].allocations.length, 101);
  assert.throws(
    () =>
      registerAddresses(networks[0], networks, {
        ...entry,
        ip: "192.168.10.100",
      }),
    /DHCP/,
  );
});
test("suggestion avoids overlapping same-VLAN pools without enumerating large ranges", () => {
  const n = {
    id: "n",
    projectId: "p",
    name: "large",
    note: "",
    cidr: "10.0.0.0/8",
    allocations: [],
  };
  assert.equal(
    nextAvailableAddress(n, [
      n,
      {
        ...n,
        id: "pool",
        dhcpStart: "10.0.0.1",
        dhcpEnd: "10.255.255.253",
        gateway: "10.255.255.254",
      },
    ]),
    "",
  );
  assert.equal(
    nextAvailableAddress({ ...n, cidr: "10.0.0.0/31" }, [
      { ...n, cidr: "10.0.0.0/31" },
    ]),
    "10.0.0.0",
  );
});
test("edits retain other records and validate MAC, DHCP pairs and dates", () => {
  const networks = office();
  const changed = registerAddresses(
    networks[0],
    networks,
    {
      ip: "192.168.10.1",
      label: "现场网关",
      type: "router",
      status: "assigned",
      mac: "AA:BB:CC:DD:EE:FF",
    },
    1,
    "192.168.10.1",
  );
  assert.equal(changed[0].allocations.length, 1);
  assert.equal(changed[0].allocations[0].label, "现场网关");
  assert.throws(
    () =>
      registerAddresses(networks[0], networks, {
        ip: "192.168.10.2",
        label: "bad",
        mac: "invalid",
      }),
    /MAC/,
  );
  assert.throws(() =>
    validateWorkspace({
      ...emptyWorkspace(),
      networks: [{ ...networks[0], dhcpEnd: "" }],
    }),
  );
  const state = emptyWorkspace();
  state.projects[0].maintenance = [
    {
      id: "log",
      content: "维护",
      owner: "",
      status: "pending",
      date: "2026-02-30",
    },
  ];
  assert.throws(() => validateWorkspace(state), /维护日期/);
});
test("project import regenerates all identifiers and preserves maintenance and allocations", () => {
  const project = emptyWorkspace().projects[0];
  project.maintenance = [
    {
      id: "log",
      content: "检查",
      owner: "运维",
      status: "pending",
      date: "2026-09-21",
    },
  ];
  let id = 0;
  const result = projectImport(
    projectExport(project, office()),
    () => `new${++id}`,
  );
  assert.equal(result.project.id, "new1");
  assert.equal(result.project.maintenance[0].id, "new2");
  assert.equal(result.networks[0].id, "new3");
  assert.equal(result.networks[0].projectId, "new1");
  assert.equal(result.networks[0].allocations[0].ip, "192.168.10.1");
});
test("static addresses cannot evade DHCP validation by using an overlapping same-VLAN subnet", () => {
  const [n] = office();
  const child = {
    ...n,
    id: "child",
    cidr: "192.168.10.96/27",
    gateway: "",
    dhcpStart: "",
    dhcpEnd: "",
    allocations: [{ ip: "192.168.10.100", label: "冲突设备" }],
  };
  assert.throws(
    () => validateWorkspace({ ...emptyWorkspace(), networks: [n, child] }),
    /DHCP/,
  );
  validateWorkspace({
    ...emptyWorkspace(),
    networks: [n, { ...child, vlan: 20 }],
  });
});

const engineeringFixture = () => ({
  version: 1,
  locations: [
    { id: "area", parentId: "", kind: "area", name: "办公区", note: "" },
  ],
  demands: [
    {
      id: "demand",
      locationId: "area",
      name: "终端",
      kind: "wired",
      count: 40,
      growthPercent: 20,
      addressesPerUnit: 1,
      portsPerUnit: 1,
      addressMode: "static",
      networkId: "office",
      note: "",
    },
  ],
  capacities: [
    { id: "capacity", locationId: "area", accessPorts: 60, note: "" },
  ],
});
test("projects validate optional engineering and legacy projects stay unchanged", () => {
  const state = emptyWorkspace();
  const before = structuredClone(state);
  normalizeWorkspace(state);
  assert.deepEqual(state, before);
  assert.ok(!Object.hasOwn(state.projects[0], "engineering"));
  state.projects[0].engineering = { ...engineeringFixture(), version: 99 };
  assert.throws(() => validateProjects(state.projects), /工程/);
});
test("workspace rejects foreign and deleted engineering network references", () => {
  const state = { ...emptyWorkspace(), networks: office() };
  state.projects[0].engineering = engineeringFixture();
  validateWorkspace(state);
  assert.throws(() => applyWorkspacePatch(state, { networks: [] }), /网段/);
  state.projects.push(newProject("other", "异地"));
  state.networks[0].projectId = "other";
  assert.throws(() => validateWorkspace(state), /网段/);
});
test("project import remaps engineering references and preserves the source", () => {
  const project = emptyWorkspace().projects[0];
  project.engineering = engineeringFixture();
  const exported = projectExport(project, office());
  const before = structuredClone(exported);
  let id = 0;
  const result = projectImport(exported, () => `import-${++id}`);
  const data = result.project.engineering;
  assert.notEqual(data.locations[0].id, "area");
  assert.notEqual(data.demands[0].id, "demand");
  assert.notEqual(data.capacities[0].id, "capacity");
  assert.equal(data.demands[0].locationId, data.locations[0].id);
  assert.equal(data.capacities[0].locationId, data.locations[0].id);
  assert.equal(data.demands[0].networkId, result.networks[0].id);
  assert.deepEqual(exported, before);
  validateWorkspace({
    ...emptyWorkspace(),
    projects: [result.project],
    activeProjectId: result.project.id,
    networks: result.networks,
  });
});
