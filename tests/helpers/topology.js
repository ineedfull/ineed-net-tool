import { newProject } from "../../src/domain/projects.js";
export function topologyFixture() {
  const project = newProject("project", "VLAN20工程");
  const locations = [
    { id: "building", kind: "building", parentId: "", name: "A楼", note: "" },
    {
      id: "floor",
      kind: "floor",
      parentId: "building",
      name: "一层",
      note: "",
    },
    { id: "area1", kind: "area", parentId: "floor", name: "办公室", note: "" },
    { id: "area2", kind: "area", parentId: "building", name: "机房", note: "" },
  ];
  const config = (mode) => ({
    version: 1,
    mode,
    networkIds: ["net20"],
    accessVlan: mode === "access" ? 20 : null,
    allowedVlans: mode === "trunk" ? [20, 30] : null,
  });
  const devices = ["host", "sw1", "sw2", "sw3"].map((id, index) => ({
    id,
    name: id,
    locationId: index < 2 ? "area1" : "area2",
    kind: id === "host" ? "endpoint" : "switch",
    model: "",
    note: "",
  }));
  const ports = [
    ["hostp", "host", "access"],
    ["access", "sw1", "access"],
    ["uplink1", "sw1", "trunk"],
    ["downlink2", "sw2", "trunk"],
    ["uplink2", "sw2", "trunk"],
    ["downlink3", "sw3", "trunk"],
  ].map(([id, deviceId, mode]) => ({
    id,
    deviceId,
    name: id,
    role: mode === "trunk" ? "uplink" : "access",
    state: "available",
    note: "",
    logicalConfig: config(mode),
  }));
  const links = [
    ["edge", "hostp", "access"],
    ["level1", "uplink1", "downlink2"],
    ["level2", "uplink2", "downlink3"],
  ].map(([id, fromInterfaceId, toInterfaceId]) => ({
    id,
    fromInterfaceId,
    toInterfaceId,
    note: "",
  }));
  project.engineering = {
    version: 1,
    locations,
    demands: [],
    capacities: [],
    infrastructure: {
      version: 1,
      logicalVersion: 1,
      devices,
      interfaces: ports,
      links,
    },
  };
  const networks = [
    {
      id: "net20",
      projectId: project.id,
      name: "办公网",
      cidr: "192.168.20.0/24",
      vlan: 20,
      gateway: "192.168.20.1",
      dhcpStart: "",
      dhcpEnd: "",
      note: "",
      allocations: [],
    },
  ];
  return { project, networks };
}
