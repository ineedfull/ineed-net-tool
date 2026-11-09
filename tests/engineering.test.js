import test from "node:test";
import assert from "node:assert/strict";

// Keep the first red run an explicit missing-feature assertion, not an import error.
const domain = await import("../src/domain/engineering.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function api(name, ...args) {
  assert.equal(typeof domain[name], "function", `${name} must be implemented`);
  return domain[name](...args);
}
const area = (id = "area", parentId = "") => ({
  id,
  parentId,
  kind: "area",
  name: id,
  note: "",
});
const demand = (changes = {}) => ({
  id: "wired",
  locationId: "area",
  name: "办公终端",
  kind: "wired",
  count: 40,
  growthPercent: 20,
  addressesPerUnit: 1,
  portsPerUnit: 1,
  addressMode: "static",
  networkId: "net",
  note: "",
  ...changes,
});
const engineering = (changes = {}) => ({
  version: 1,
  locations: [area()],
  demands: [demand()],
  capacities: [
    { id: "capacity", locationId: "area", accessPorts: 60, note: "" },
  ],
  ...changes,
});
const network = (changes = {}) => ({
  id: "net",
  projectId: "p",
  name: "办公网络",
  cidr: "10.0.0.0/24",
  gateway: "10.0.0.1",
  dhcpStart: "",
  dhcpEnd: "",
  note: "",
  allocations: [],
  ...changes,
});
const report = (data, networks = [network()]) =>
  api("engineeringReport", { id: "p", engineering: data }, networks);

test("reserve rounds each demand before aggregating 40 wired and 4 AP to 53 ports", () => {
  const data = engineering({
    demands: [demand(), demand({ id: "ap", kind: "ap", count: 4 })],
  });
  const before = structuredClone(data);
  const result = report(data);
  assert.deepEqual(
    result.demands.map((row) => [
      row.reserveCount,
      row.plannedCount,
      row.addressDemand,
      row.portDemand,
    ]),
    [
      [8, 48, 48, 48],
      [1, 5, 5, 5],
    ],
  );
  assert.equal(result.locations[0].requiredPorts, 53);
  assert.equal(result.locations[0].remainingPorts, 7);
  assert.equal(result.status, "ok");
  assert.deepEqual(data, before);
});
test("wireless defaults consume addresses without physical access ports", () => {
  assert.equal(domain.DEMAND_DEFAULTS?.wireless?.portsPerUnit, 0);
  assert.equal(domain.DEMAND_DEFAULTS?.ap?.portsPerUnit, 1);
  const result = report(
    engineering({
      demands: [
        demand({
          kind: "wireless",
          count: 100,
          growthPercent: 0,
          portsPerUnit: 0,
        }),
      ],
    }),
  );
  assert.equal(result.demands[0].portDemand, 0);
  assert.equal(result.networks[0].addressDemand, 100);
});
test("regions sharing a network aggregate addresses and count saved gateway once", () => {
  const data = engineering({
    locations: [area(), area("second")],
    demands: [
      demand(),
      demand({ id: "second-demand", locationId: "second", count: 4 }),
    ],
    capacities: [
      { id: "c1", locationId: "area", accessPorts: 60, note: "" },
      { id: "c2", locationId: "second", accessPorts: 10, note: "" },
    ],
  });
  const result = report(data, [
    network({
      allocations: [
        { ip: "10.0.0.1", label: "网关" },
        { ip: "10.0.0.2", label: "旧设备" },
      ],
    }),
    network({ id: "unused" }),
    network({ id: "foreign", projectId: "other" }),
  ]);
  assert.equal(result.networks.length, 1);
  assert.equal(result.networks[0].addressDemand, 53);
  assert.equal(result.networks[0].gatewayAddresses, 1);
  assert.equal(result.networks[0].requiredAddresses, 54);
  assert.equal(result.networks[0].registeredAddresses, 2);
  assert.equal(result.networks[0].remainingAddresses, 200);
});
test("DHCP and static demand use independent capacities without adding existing registrations", () => {
  const data = engineering({
    demands: [
      demand({ count: 4, growthPercent: 0 }),
      demand({ id: "dhcp", count: 2, growthPercent: 0, addressMode: "dhcp" }),
    ],
  });
  const result = report(data, [
    network({
      cidr: "10.0.0.0/29",
      dhcpStart: "10.0.0.4",
      dhcpEnd: "10.0.0.6",
    }),
  ]);
  const row = result.networks[0];
  assert.equal(row.totalCapacity, 6);
  assert.equal(row.dhcpCapacity, 3);
  assert.equal(row.staticCapacity, 2);
  assert.equal(row.remainingDhcp, 1);
  assert.equal(row.remainingStatic, -2);
  assert.equal(row.remainingAddresses, -1);
  assert.deepEqual(row.issues.map((i) => i.code).sort(), [
    "address_capacity_insufficient",
    "static_capacity_insufficient",
  ]);
  assert.equal(result.status, "risk");
});
test("DHCP pool shortage is a risk even when CIDR total capacity is sufficient", () => {
  const result = report(
    engineering({
      demands: [demand({ count: 4, growthPercent: 0, addressMode: "dhcp" })],
    }),
    [network({ dhcpStart: "10.0.0.100", dhcpEnd: "10.0.0.102" })],
  );
  assert.equal(result.networks[0].remainingDhcp, -1);
  assert.ok(result.issues.some((i) => i.code === "dhcp_capacity_insufficient"));
  assert.equal(result.status, "risk");
});
test("unknown count stays pending and known subtotal insufficiency stays risk", () => {
  const data = engineering({
    demands: [
      demand({ count: 10, growthPercent: 0 }),
      demand({ id: "unknown", count: null }),
    ],
    capacities: [
      { id: "capacity", locationId: "area", accessPorts: 5, note: "" },
    ],
  });
  const result = report(data, [network({ cidr: "10.0.0.0/29" })]);
  assert.equal(result.demands[1].plannedCount, null);
  assert.equal(result.demands[1].addressDemand, null);
  assert.equal(result.demands[1].portDemand, null);
  assert.equal(result.locations[0].requiredPorts, 10);
  assert.equal(result.locations[0].remainingPorts, null);
  assert.equal(result.networks[0].remainingAddresses, null);
  assert.equal(result.networks[0].unknownDemandCount, 1);
  assert.equal(result.status, "risk");
  assert.ok(
    result.issues.some(
      (i) =>
        i.code === "count_missing" &&
        i.severity === "pending" &&
        i.demandId === "unknown",
    ),
  );
  assert.ok(
    result.issues.some(
      (i) => i.code === "access_capacity_insufficient" && i.severity === "risk",
    ),
  );
});
test("an unknown wireless count keeps its region pending even with zero ports per unit", () => {
  const result = report(
    engineering({
      demands: [demand({ kind: "wireless", count: null, portsPerUnit: 0 })],
    }),
  );
  assert.equal(result.locations[0].status, "pending");
  assert.equal(result.locations[0].unknownDemandCount, 1);
  assert.equal(result.networks[0].status, "pending");
});
test("an unknown zero-address demand keeps its network pending without inventing a gateway requirement", () => {
  const result = report(
    engineering({ demands: [demand({ count: null, addressesPerUnit: 0 })] }),
    [network({ gateway: "" })],
  );
  assert.equal(result.networks[0].status, "pending");
  assert.equal(result.networks[0].unknownDemandCount, 1);
  assert.ok(!result.issues.some((i) => i.code === "gateway_missing"));
});
test("missing capacity, association, gateway and DHCP pool remain pending", () => {
  const missing = report(
    engineering({ demands: [demand({ networkId: "" })], capacities: [] }),
  );
  assert.equal(missing.status, "pending");
  assert.equal(missing.locations[0].accessPorts, null);
  assert.equal(missing.locations[0].remainingPorts, null);
  assert.ok(missing.issues.some((i) => i.code === "network_missing"));
  const result = report(
    engineering({ demands: [demand({ addressMode: "dhcp" })] }),
    [network({ gateway: "" })],
  );
  assert.equal(result.status, "pending");
  assert.equal(result.networks[0].dhcpCapacity, null);
  assert.equal(result.networks[0].remainingDhcp, null);
  assert.ok(result.issues.some((i) => i.code === "gateway_missing"));
  assert.ok(result.issues.some((i) => i.code === "dhcp_pool_missing"));
  assert.ok(
    !result.issues.some((i) => i.code === "dhcp_capacity_insufficient"),
  );
});
test("single-host /32 needs no gateway while /31 uses both endpoints", () => {
  const data = engineering({
    demands: [demand({ count: 1, growthPercent: 0 })],
  });
  const single = report(data, [network({ cidr: "10.0.0.2/32", gateway: "" })]);
  assert.equal(single.status, "ok");
  assert.equal(single.networks[0].staticCapacity, 1);
  assert.equal(single.networks[0].remainingAddresses, 0);
  const pair = report(data, [
    network({ cidr: "10.0.0.0/31", gateway: "10.0.0.0" }),
  ]);
  assert.equal(pair.networks[0].totalCapacity, 2);
  assert.equal(pair.networks[0].staticCapacity, 1);
  assert.equal(pair.status, "ok");
});
test("empty engineering and areas without demands do not claim verified capacity", () => {
  const empty = api("emptyEngineering");
  assert.deepEqual(empty, {
    version: 1,
    locations: [],
    demands: [],
    capacities: [],
  });
  assert.equal(report(empty).status, "pending");
  assert.equal(
    report(engineering({ demands: [] })).locations[0].status,
    "pending",
  );
  assert.equal(api("engineeringReport", { id: "p" }, []).enabled, false);
});
test("validation accepts legal hierarchy and bounded numbers without mutating it", () => {
  const data = engineering({
    locations: [
      {
        id: "building",
        parentId: "",
        kind: "building",
        name: "楼栋",
        note: "",
      },
      {
        id: "floor",
        parentId: "building",
        kind: "floor",
        name: "楼层",
        note: "",
      },
      area("area", "floor"),
      area("root"),
      area("wing", "building"),
    ],
    demands: [
      demand({
        count: 1000000,
        growthPercent: 1000,
        addressesPerUnit: 16,
        portsPerUnit: 16,
      }),
    ],
  });
  const before = structuredClone(data);
  assert.equal(api("validateEngineering", data, [network()]), data);
  assert.deepEqual(data, before);
  assert.equal(report(data).demands[0].addressDemand, 176000000);
});
test("validation refuses malformed structure, duplicate IDs, illegal hierarchy and numeric coercion", () => {
  assert.equal(
    typeof domain.validateEngineering,
    "function",
    "validateEngineering must be implemented",
  );
  const invalid = [
    null,
    { ...engineering(), version: 2 },
    { ...engineering(), locations: {} },
    engineering({ locations: [area(), area()] }),
    engineering({ locations: [area("area", "missing")] }),
    engineering({
      locations: [{ ...area(), kind: "building", parentId: "area" }],
    }),
    engineering({ locations: [{ ...area(), kind: "floor" }] }),
    engineering({ locations: [area(), area("child", "area")] }),
    engineering({ locations: [{ ...area(), id: "bad\u007f" }] }),
    engineering({ locations: [{ ...area(), name: " " }] }),
    engineering({ locations: [{ ...area(), note: "a".repeat(1001) }] }),
    engineering({ demands: [demand({ id: "area" })] }),
    engineering({ demands: [demand({ locationId: "missing" })] }),
    engineering({ demands: [demand({ kind: "alien" })] }),
    engineering({ demands: [demand({ addressMode: "auto" })] }),
    ...[undefined, "40", NaN, Infinity, -1, 1.5, 1000001].map((count) =>
      engineering({ demands: [demand({ count })] }),
    ),
    ...[-1, 1001, 0.5, "20"].map((growthPercent) =>
      engineering({ demands: [demand({ growthPercent })] }),
    ),
    ...[-1, 17, null, "1"].map((addressesPerUnit) =>
      engineering({ demands: [demand({ addressesPerUnit })] }),
    ),
    engineering({ demands: [demand({ portsPerUnit: 17 })] }),
    engineering({
      capacities: [
        { id: "c", locationId: "missing", accessPorts: 1, note: "" },
      ],
    }),
    engineering({
      capacities: [
        { id: "c", locationId: "area", accessPorts: "60", note: "" },
      ],
    }),
    engineering({
      capacities: [
        { id: "c", locationId: "area", accessPorts: 1, note: "" },
        { id: "d", locationId: "area", accessPorts: 2, note: "" },
      ],
    }),
    engineering({
      locations: Array.from({ length: 501 }, (_, i) => area(`a${i}`)),
    }),
    engineering({
      demands: Array.from({ length: 1001 }, (_, i) => demand({ id: `d${i}` })),
    }),
    engineering({
      capacities: Array.from({ length: 501 }, (_, i) => ({
        id: `c${i}`,
        locationId: "area",
        accessPorts: 1,
        note: "",
      })),
    }),
  ];
  for (const data of invalid)
    assert.throws(() => api("validateEngineering", data), Error);
});
test("engineering references must resolve to supplied owned networks", () => {
  assert.throws(() => api("validateEngineering", engineering(), []), /网段/);
  api("validateEngineering", engineering());
  assert.throws(
    () => report(engineering(), [network({ projectId: "other" })]),
    /网段/,
  );
});
test("enumerated engineering types reject arrays instead of coercing them to known names", () => {
  assert.throws(
    () =>
      api(
        "validateEngineering",
        engineering({
          locations: [{ ...area(), kind: ["area"] }],
          demands: [],
          capacities: [],
        }),
      ),
    /类型/,
  );
  assert.throws(
    () =>
      api(
        "validateEngineering",
        engineering({ demands: [demand({ kind: ["wired"] })] }),
      ),
    /类型/,
  );
  assert.throws(
    () =>
      api(
        "validateEngineering",
        engineering({ demands: [demand({ addressMode: ["static"] })] }),
      ),
    /方式/,
  );
});
test("remapping regenerates every engineering ID and keeps all internal references", () => {
  const data = engineering({
    locations: [
      { id: "b", parentId: "", kind: "building", name: "b", note: "" },
      { id: "f", parentId: "b", kind: "floor", name: "f", note: "" },
      area("area", "f"),
    ],
    demands: [demand(), demand({ id: "unlinked", networkId: "" })],
  });
  let id = 0;
  const result = api(
    "remapEngineering",
    data,
    new Map([["net", "new-net"]]),
    () => `new-${++id}`,
  );
  assert.deepEqual(
    result.locations.map((l) => [l.id, l.parentId]),
    [
      ["new-1", ""],
      ["new-2", "new-1"],
      ["new-3", "new-2"],
    ],
  );
  assert.equal(result.demands[0].locationId, "new-3");
  assert.equal(result.demands[0].networkId, "new-net");
  assert.equal(result.demands[1].networkId, "");
  assert.equal(result.capacities[0].locationId, "new-3");
  assert.equal(
    new Set(
      [...result.locations, ...result.demands, ...result.capacities].map(
        (r) => r.id,
      ),
    ).size,
    6,
  );
  assert.equal(data.locations[0].id, "b");
  assert.throws(
    () => api("remapEngineering", data, new Map(), () => "new"),
    /网段/,
  );
});
test("maximum bounded demand input is computed without enumerating addresses", () => {
  const data = engineering({
    demands: Array.from({ length: 1000 }, (_, i) =>
      demand({
        id: `d${i}`,
        count: 1000000,
        growthPercent: 1000,
        addressesPerUnit: 16,
        portsPerUnit: 16,
      }),
    ),
  });
  const result = report(data, [network({ cidr: "0.0.0.0/0" })]);
  assert.equal(result.networks[0].addressDemand, 176000000000);
  assert.equal(result.networks[0].totalCapacity, 4294967294);
  assert.equal(result.status, "risk");
});
