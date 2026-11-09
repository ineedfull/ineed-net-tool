import { subnet, ipNumber, ipText } from "./ipv4.js";

export const ADDRESS_MAP_STATUSES = {
  available: "可分配（台账）",
  assigned: "在用登记",
  reserved: "规划预留",
  maintenance: "检修",
  gateway: "网关 / 上联",
  dhcp: "DHCP 池",
  unregistered: "有响应·未登记",
  excluded: "网络 / 广播",
};
// History belongs to the current project. Probe results are observations, not allocations.
export function latestIpObservations(history, liveScan) {
  const result = new Map();
  const tasks = [
    ...history,
    ...(liveScan?.id ? [{ ...liveScan, kind: "scan" }] : []),
  ];
  for (const task of tasks) {
    if (!["scan", "ping"].includes(task.kind)) continue;
    for (const row of task.rows || []) {
      if (
        !row.ip ||
        !["reachable", "no-response", "error"].includes(row.status)
      )
        continue;
      const time = [row.time, task.finishedAt, task.startedAt].find(value => value != null && value !== "");
      const timestamp = typeof time === "number" ? time : Date.parse(time);
      if (!Number.isFinite(timestamp)) continue;
      if (!result.has(row.ip) || timestamp >= result.get(row.ip).timestamp)
        result.set(row.ip, { ...row, time, timestamp });
    }
  }
  return result;
}
export function addressMapBlock(
  network,
  networks,
  blockIndex = 0,
  observations = new Map(),
) {
  const net = subnet(network.cidr);
  const base = Math.floor(net.first / 256) * 256;
  const blocks = Math.floor(net.last / 256) - Math.floor(net.first / 256) + 1;
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= blocks)
    throw new Error("地址区块超出范围");
  const first = Math.max(net.first, base + blockIndex * 256);
  const last = Math.min(net.last, base + blockIndex * 256 + 255);
  const scope = networks.filter(
    (n) =>
      n.projectId === network.projectId &&
      (n.vlan || "") === (network.vlan || ""),
  );
  const allocations = new Map(
    scope.flatMap((n) =>
      n.allocations.map((a) => [a.ip, { allocation: a, network: n }]),
    ),
  );
  const gateways = new Set(scope.map((n) => n.gateway).filter(Boolean));
  const pools = scope
    .filter((n) => n.dhcpStart && n.dhcpEnd)
    .map((n) => [ipNumber(n.dhcpStart), ipNumber(n.dhcpEnd)]);
  const cells = Array.from({ length: last - first + 1 }, (_, index) => {
    const value = first + index,
      ip = ipText(value),
      record = allocations.get(ip),
      observation = observations.get(ip);
    const excluded =
      net.prefix < 31 && (value === net.first || value === net.last);
    const gateway = gateways.has(ip);
    const dhcp = pools.some(([start, end]) => value >= start && value <= end);
    const status = excluded
      ? "excluded"
      : gateway
        ? "gateway"
        : dhcp
          ? "dhcp"
          : record
            ? record.allocation.status || "assigned"
            : observation?.status === "reachable"
              ? "unregistered"
              : "available";
    return {
      ip,
      suffix: value % 256,
      status,
      allocation: record?.allocation,
      network: record?.network || network,
      observation,
      gateway,
      dhcp,
    };
  });
  return {
    blocks,
    index: blockIndex,
    prefix: ipText(first).split(".").slice(0, 3).join("."),
    first: ipText(first),
    last: ipText(last),
    cells,
  };
}
