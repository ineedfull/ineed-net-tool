import { newProject } from "../../src/domain/projects.js";
export function infrastructureFixture() {
  const project = newProject("project", "工程");
  project.engineering = {
    version: 1,
    locations: [
      { id: "area", kind: "area", parentId: "", name: "区域", note: "" },
    ],
    demands: [
      {
        id: "demand",
        locationId: "area",
        name: "需求",
        kind: "wired",
        count: 1,
        growthPercent: 0,
        addressesPerUnit: 1,
        portsPerUnit: 1,
        addressMode: "static",
        networkId: "",
        note: "",
      },
    ],
    capacities: [
      { id: "capacity", locationId: "area", accessPorts: 999, note: "" },
    ],
    infrastructure: {
      version: 1,
      devices: [
        {
          id: "dev1",
          locationId: "area",
          name: "交换机",
          kind: "switch",
          model: "型号",
          note: "",
        },
        {
          id: "dev2",
          locationId: "area",
          name: "终端",
          kind: "endpoint",
          model: "",
          note: "",
        },
      ],
      interfaces: [
        {
          id: "port1",
          deviceId: "dev1",
          name: "1",
          role: "access",
          state: "available",
          note: "",
        },
        {
          id: "port2",
          deviceId: "dev2",
          name: "1",
          role: "other",
          state: "available",
          note: "",
        },
      ],
      links: [
        {
          id: "link",
          fromInterfaceId: "port1",
          toInterfaceId: "port2",
          note: "",
        },
      ],
    },
  };
  return project;
}
