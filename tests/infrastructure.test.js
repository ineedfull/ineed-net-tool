import test from "node:test";
import assert from "node:assert/strict";
import {
  validateEngineering,
  remapEngineering,
} from "../src/domain/engineering.js";
import { newProject, projectImport } from "../src/domain/projects.js";
const domain = await import("../src/domain/infrastructure.js").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
const api = (name, ...args) => {
  assert.equal(typeof domain[name], "function", `${name} must be implemented`);
  return domain[name](...args);
};
import { infrastructureFixture as fixture } from "./helpers/infrastructure.js";
test("optional infrastructure is absent until explicitly enabled", () => {
  const e = fixture().engineering;
  delete e.infrastructure;
  validateEngineering(e, []);
  assert.ok(!Object.hasOwn(remapEngineering(e, new Map()), "infrastructure"));
  assert.deepEqual(api("emptyInfrastructure"), {
    version: 1,
    devices: [],
    interfaces: [],
    links: [],
  });
});
test("engineering wrapper rejects infrastructure structural ownership enum and bounds errors", () => {
  const changes = [
    (i) => (i.version = 2),
    (i) => (i.devices = null),
    (i) => (i.devices[0].locationId = "foreign"),
    (i) => (i.devices[0].kind = ["switch"]),
    (i) => (i.devices[0].model = 1),
    (i) => (i.devices[0].note = "a".repeat(1001)),
    (i) => (i.devices[0].id = "area"),
    (i) => (i.devices[0].id = "x\u0000"),
    (i) => (i.interfaces[0].deviceId = "foreign"),
    (i) => (i.interfaces[0].role = "bad"),
    (i) => (i.interfaces[0].state = "reserved"),
    (i) => (i.interfaces[0].name = " "),
    (i) => i.interfaces.push({ ...i.interfaces[0], id: "third", name: " 1 " }),
    (i) => (i.links[0].toInterfaceId = "foreign"),
    (i) => i.links.push({ ...i.links[0], id: "second-link" }),
    (i) => (i.interfaces[1].deviceId = "dev1"),
    (i) => i.devices.pop(),
    (i) => i.interfaces.pop(),
    (i) => (i.devices[0].name = "a".repeat(101)),
    (i) => (i.devices[0].model = "a".repeat(201)),
    (i) =>
      (i.devices = Array.from({ length: 501 }, (_, n) => ({
        ...i.devices[0],
        id: `dev-${n}`,
      }))),
    (i) =>
      (i.interfaces = Array.from({ length: 5001 }, (_, n) => ({
        ...i.interfaces[0],
        id: `port-${n}`,
        name: `${n}`,
      }))),
    (i) =>
      (i.links = Array.from({ length: 2501 }, (_, n) => ({
        ...i.links[0],
        id: `link-${n}`,
      }))),
  ];
  for (const change of changes) {
    const e = fixture().engineering;
    change(e.infrastructure);
    assert.throws(() => validateEngineering(e, []), Error, String(change));
  }
  const e = fixture().engineering;
  e.locations = [];
  assert.throws(() => validateEngineering(e, []), /区域/);
});
test("registered capacity includes connected access ports and never adds manual capacity or demand to occupied ports", () => {
  const p = fixture(),
    before = structuredClone(p);
  const r = api("infrastructureReport", p);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.devices[0], {
    deviceId: "dev1",
    name: "交换机",
    locationId: "area",
    total: 1,
    available: 1,
    connected: 1,
    idle: 0,
    reserved: 0,
    disabled: 0,
  });
  assert.equal(r.locations[0].accessPorts, 1);
  assert.equal(r.locations[0].connectedAccessPorts, 1);
  assert.equal(r.locations[0].idleAccessPorts, 0);
  assert.equal(r.locations[0].manualAccessPorts, 999);
  assert.equal(r.locations[0].requiredPorts, 1);
  assert.equal(r.locations[0].remainingPorts, 0);
  assert.equal(r.locations[0].status, "ok");
  assert.deepEqual(p, before);
});
test("unknown and absent demand and unregistered inventory remain pending; known shortage stays risk", () => {
  const p = fixture();
  p.engineering.demands[0].count = null;
  let r = api("infrastructureReport", p);
  assert.equal(r.locations[0].status, "pending");
  assert.equal(r.locations[0].remainingPorts, null);
  p.engineering.demands[0].count = 5;
  r = api("infrastructureReport", p);
  assert.equal(r.locations[0].status, "risk");
  assert.equal(r.locations[0].remainingPorts, -4);
  p.engineering.infrastructure.links = [];
  p.engineering.infrastructure.interfaces = [];
  r = api("infrastructureReport", p);
  assert.equal(r.locations[0].status, "pending");
  p.engineering.demands = [];
  assert.equal(api("infrastructureReport", p).locations[0].status, "pending");
  delete p.engineering.infrastructure;
  assert.equal(api("infrastructureReport", p).enabled, false);
});
test("import rebuilds every infrastructure ID and retains project/area/endpoint ownership", () => {
  const p = fixture();
  let n = 0;
  const imported = projectImport(
    { kind: "ineed-nettool-project", version: 1, project: p, networks: [] },
    () => `new-${++n}`,
  );
  const e = imported.project.engineering,
    i = e.infrastructure;
  assert.ok(i, "import retains infrastructure");
  assert.equal(i.devices[0].locationId, e.locations[0].id);
  assert.equal(i.interfaces[0].deviceId, i.devices[0].id);
  assert.equal(i.links[0].fromInterfaceId, i.interfaces[0].id);
  assert.equal(i.links[0].toInterfaceId, i.interfaces[1].id);
  assert.ok(
    [...i.devices, ...i.interfaces, ...i.links].every((r) =>
      r.id.startsWith("new-"),
    ),
  );
  validateEngineering(e, []);
  assert.equal(p.engineering.infrastructure.devices[0].id, "dev1");
});
test("report validates owning engineering inputs and exported remapper rejects invalid references", () => {
  const p = fixture();
  p.engineering.demands[0].count = "1";
  assert.throws(() => api("infrastructureReport", p), /整数/);
  const i = fixture().engineering.infrastructure;
  assert.throws(() => api("remapInfrastructure", i, new Map()), /区域/);
});
test("unused reserved/disabled/uplink interfaces are counted but excluded from business capacity and loops remain legal", () => {
  const p = fixture(),
    i = p.engineering.infrastructure;
  i.interfaces.push(
    {
      id: "reserved",
      deviceId: "dev1",
      name: "r",
      role: "access",
      state: "reserved",
      note: "",
    },
    {
      id: "disabled",
      deviceId: "dev1",
      name: "d",
      role: "access",
      state: "disabled",
      note: "",
    },
    {
      id: "uplink",
      deviceId: "dev1",
      name: "u",
      role: "uplink",
      state: "available",
      note: "",
    },
  );
  const r = api("infrastructureReport", p);
  assert.equal(r.devices[0].total, 4);
  assert.equal(r.devices[0].available, 2);
  assert.equal(r.devices[0].reserved, 1);
  assert.equal(r.devices[0].disabled, 1);
  assert.equal(r.devices[0].idle, 1);
  assert.equal(r.locations[0].accessPorts, 1);
  i.interfaces.push(
    {
      id: "back1",
      deviceId: "dev1",
      name: "b",
      role: "other",
      state: "available",
      note: "",
    },
    {
      id: "back2",
      deviceId: "dev2",
      name: "b",
      role: "uplink",
      state: "available",
      note: "",
    },
  );
  i.links.push({
    id: "back",
    fromInterfaceId: "back2",
    toInterfaceId: "back1",
    note: "",
  });
  validateEngineering(p.engineering, []);
});
for (const role of ["access", "uplink", "other"])
  for (const state of ["available", "reserved", "disabled"])
    test(`capacity excludes nonbusiness or unavailable interfaces: ${role}/${state}`, () => {
      const p = fixture(),
        i = p.engineering.infrastructure;
      i.links = [];
      i.interfaces = [{ ...i.interfaces[0], role, state }];
      p.engineering.demands[0].count = 0;
      let r = api("infrastructureReport", p);
      assert.equal(
        r.locations[0].accessPorts,
        role === "access" && state === "available" ? 1 : 0,
      );
      assert.equal(r.locations[0].requiredPorts, 0);
      assert.equal(r.locations[0].status, "ok");
      assert.equal(r.devices[0][state], 1);
      p.engineering.demands[0].count = null;
      r = api("infrastructureReport", p);
      assert.equal(r.locations[0].status, "pending");
      assert.equal(r.locations[0].remainingPorts, null);
    });
test("standalone validation and remapping preserve legal records and reject generated ID collisions", () => {
  const p = fixture(),
    e = p.engineering,
    i = e.infrastructure;
  assert.equal(api("validateInfrastructure", i, e), i);
  let n = 0;
  const remapped = api(
    "remapInfrastructure",
    i,
    new Map([["area", "new-area"]]),
    () => `i-${++n}`,
  );
  assert.equal(remapped.devices[0].locationId, "new-area");
  assert.equal(remapped.interfaces[0].deviceId, remapped.devices[0].id);
  assert.equal(remapped.links[0].toInterfaceId, remapped.interfaces[1].id);
  assert.throws(
    () =>
      api(
        "remapInfrastructure",
        i,
        new Map([["area", "new-area"]]),
        () => "same",
      ),
    /重复/,
  );
  assert.throws(() => api("remapInfrastructure", i, {}), /映射/);
});
test("device-only area references protect deletion, and malformed inventory containers reject", () => {
  const e = fixture().engineering;
  e.demands = [];
  e.capacities = [];
  e.locations = [];
  assert.throws(() => validateEngineering(e, []), /解除设备引用/);
  for (const invalid of [
    null,
    [],
    {},
    "invalid",
    { version: 1, devices: [], interfaces: [], links: {} },
  ]) {
    const data = fixture().engineering;
    data.infrastructure = invalid;
    assert.throws(() => validateEngineering(data, []), Error);
  }
  const data = fixture().engineering;
  data.infrastructure.devices.push({ ...data.infrastructure.devices[0] });
  assert.throws(() => validateEngineering(data, []), /重复/);
});
