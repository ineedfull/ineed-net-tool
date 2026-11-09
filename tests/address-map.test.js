import test from "node:test";
import assert from "node:assert/strict";
import {
  addressMapBlock,
  latestIpObservations,
} from "../src/domain/address-map.js";
import { templateNetworks } from "../src/domain/projects.js";
const office = () =>
  templateNetworks("office-small", "192.168.10.0/24", "p", () => "n")[0];
test("address map distinguishes allocations, gateway, DHCP and non-host addresses", () => {
  const net = office();
  net.allocations.push(
    { ip: "192.168.10.2", label: "打印机", status: "assigned" },
    { ip: "192.168.10.3", label: "AP", status: "reserved" },
    { ip: "192.168.10.4", label: "设备", status: "maintenance" },
  );
  const block = addressMapBlock(net, [net]);
  assert.equal(block.cells.length, 256);
  const state = (ip) => block.cells.find((c) => c.ip === ip).status;
  assert.equal(state("192.168.10.0"), "excluded");
  assert.equal(state("192.168.10.255"), "excluded");
  assert.equal(state("192.168.10.1"), "gateway");
  assert.equal(state("192.168.10.2"), "assigned");
  assert.equal(state("192.168.10.3"), "reserved");
  assert.equal(state("192.168.10.4"), "maintenance");
  assert.equal(state("192.168.10.100"), "dhcp");
  assert.equal(state("192.168.10.199"), "dhcp");
  assert.equal(state("192.168.10.200"), "available");
});
test("large networks are paged arithmetically and /31 /32 have no excluded addresses", () => {
  const net = {
    ...office(),
    cidr: "0.0.0.0/0",
    allocations: [],
    gateway: "",
    dhcpStart: "",
    dhcpEnd: "",
  };
  const last = addressMapBlock(net, [net], 16777215);
  assert.equal(last.blocks, 16777216);
  assert.equal(last.cells.length, 256);
  assert.equal(last.last, "255.255.255.255");
  assert.equal(last.cells.at(-1).status, "excluded");
  const small = { ...net, cidr: "10.0.0.0/31" };
  assert.ok(
    addressMapBlock(small, [small]).cells.every(
      (c) => c.status === "available",
    ),
  );
  const host = { ...net, cidr: "10.0.0.1/32" };
  assert.equal(addressMapBlock(host, [host]).cells.length, 1);
  assert.throws(() => addressMapBlock(host, [host], 1));
});
test("same VLAN overlapping allocations and pools are reserved; other projects and VLANs stay independent", () => {
  const net = office();
  const child = {
    ...net,
    id: "child",
    gateway: "",
    dhcpStart: "",
    dhcpEnd: "",
    allocations: [],
    cidr: "192.168.10.0/25",
  };
  assert.equal(addressMapBlock(child, [net, child]).cells[1].status, "gateway");
  assert.equal(addressMapBlock(child, [net, child]).cells[100].status, "dhcp");
  child.vlan = 20;
  assert.equal(
    addressMapBlock(child, [net, child]).cells[1].status,
    "available",
  );
  child.vlan = 10;
  child.projectId = "other";
  assert.equal(
    addressMapBlock(child, [net, child]).cells[100].status,
    "available",
  );
});
test("latest observations preserve registration status and flag responding unregistered addresses", () => {
  const net = office();
  net.allocations.push({
    ip: "192.168.10.2",
    label: "故障设备",
    status: "assigned",
  });
  const history = [
    {
      id: "new",
      kind: "scan",
      startedAt: "2026-09-21T12:00:00Z",
      rows: [
        { ip: "192.168.10.2", status: "no-response" },
        { ip: "192.168.10.3", status: "reachable" },
      ],
    },
    {
      id: "old",
      kind: "ping",
      startedAt: "2026-09-21T11:00:00Z",
      rows: [{ ip: "192.168.10.2", status: "reachable" }],
    },
    {
      kind: "route",
      startedAt: "2026-09-21T13:00:00Z",
      rows: [{ ip: "192.168.10.2", status: "reachable" }],
    },
  ];
  const observed = latestIpObservations(history);
  assert.equal(observed.get("192.168.10.2").status, "no-response");
  const block = addressMapBlock(net, [net], 0, observed);
  assert.equal(block.cells[2].status, "assigned");
  assert.equal(block.cells[2].observation.status, "no-response");
  assert.equal(block.cells[3].status, "unregistered");
  assert.equal(net.allocations.length, 2);
  const live = {
    id: "live",
    rows: [
      { ip: "192.168.10.3", status: "error", time: "2026-09-21T13:00:00Z" },
    ],
  };
  assert.equal(
    latestIpObservations(history, live).get("192.168.10.3").status,
    "error",
  );
});

test("address observations preserve epoch zero and order integer milliseconds as instants", () => {
  const observed = latestIpObservations([{ kind: "scan", startedAt: "2026-07-09T06:38:12Z", rows: [
    { ip: "127.0.0.1", time: 0, status: "reachable" },
    { ip: "127.0.0.2", time: 1000, status: "reachable" },
    { ip: "127.0.0.3", time: "", status: "reachable" },
  ] }]);
  assert.equal(observed.get("127.0.0.1").time, 0);
  assert.equal(observed.get("127.0.0.1").timestamp, 0);
  assert.equal(observed.get("127.0.0.2").timestamp, 1000);
  assert.equal(observed.get("127.0.0.3")?.time, "2026-07-09T06:38:12Z");
});
