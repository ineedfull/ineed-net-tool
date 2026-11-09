import { infrastructureFixture } from "./infrastructure.js";
export function capacityFixture() {
  const p = infrastructureFixture();
  p.engineering.infrastructure.capacityPlanning = {
    version: 1,
    powerBudgets: [
      {
        id: "power",
        deviceId: "dev1",
        budgetWatts: 40,
        reservePercent: 20,
        note: "",
      },
    ],
    poeLoads: [
      {
        id: "load",
        linkId: "link",
        sourceInterfaceId: "port1",
        targetInterfaceId: "port2",
        portBudgetWatts: 14,
        deviceWatts: 12,
        lossPercent: 25,
        note: "",
      },
    ],
    uplinks: [
      {
        id: "uplink",
        linkId: "link",
        fromInterfaceId: "port1",
        toInterfaceId: "port2",
        fromMbps: 1000,
        toMbps: 100,
        reservePercent: 20,
        note: "",
      },
    ],
    trafficDemands: [
      {
        id: "traffic",
        uplinkId: "uplink",
        name: "终端",
        direction: "forward",
        count: 40,
        mbpsPerUnit: 2,
        concurrencyPercent: 50,
        growthPercent: 20,
        note: "",
      },
      {
        id: "reverse",
        uplinkId: "uplink",
        name: "反向",
        direction: "reverse",
        count: 1,
        mbpsPerUnit: 60,
        concurrencyPercent: 100,
        growthPercent: 0,
        note: "",
      },
    ],
  };
  return p;
}
