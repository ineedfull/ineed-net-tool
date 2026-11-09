import { validateEngineering } from "./engineering.js";
import { validateNetworks } from "./workspace.js";
export const CAPACITY_PLANNING_LIMITS = Object.freeze({
  powerBudgets: 500,
  poeLoads: 2500,
  uplinks: 500,
  trafficDemands: 500,
});
export const emptyCapacityPlanning = () => ({
  version: 1,
  powerBudgets: [],
  poeLoads: [],
  uplinks: [],
  trafficDemands: [],
});
const object = (x) => x && typeof x === "object" && !Array.isArray(x);
function text(x, max, label, required = false) {
  if (typeof x !== "string" || x.length > max || (required && !x.trim()))
    throw Error(`${label}无效`);
}
function id(x) {
  text(x, 100, "容量校核标识", true);
  if (/[\x00-\x1f\x7f-\x9f]/.test(x)) throw Error("容量校核标识无效");
}
function numeric(x, max, nullable = false, decimal = false) {
  if (nullable && x === null) return;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < 0 ||
    x > max ||
    (!decimal && !Number.isInteger(x)) ||
    (decimal && !/^\d+(?:\.\d{1,3})?$/.test(String(x)))
  )
    throw Error("容量校核数值无效或超出精度/范围");
}
export function validateCapacityPlanning(plan, infrastructure, engineering) {
  if (!object(plan) || plan.version !== 1)
    throw Error("不支持的容量校核版本或格式");
  const ids = new Set(
    [
      ...engineering.locations,
      ...engineering.demands,
      ...engineering.capacities,
      ...infrastructure.devices,
      ...infrastructure.interfaces,
      ...infrastructure.links,
    ].map((r) => r.id),
  );
  for (const key of Object.keys(CAPACITY_PLANNING_LIMITS)) {
    if (
      !Array.isArray(plan[key]) ||
      plan[key].length > CAPACITY_PLANNING_LIMITS[key]
    )
      throw Error(`容量校核 ${key} 数量无效`);
    for (const r of plan[key]) {
      if (!object(r)) throw Error("容量校核记录无效");
      id(r.id);
      if (ids.has(r.id)) throw Error("容量校核记录标识重复");
      ids.add(r.id);
      text(r.note, 1000, "备注");
    }
  }
  const devices = new Set(infrastructure.devices.map((r) => r.id)),
    links = new Map(infrastructure.links.map((r) => [r.id, r])),
    uplinks = new Set(plan.uplinks.map((r) => r.id));
  const usedDevices = new Set(),
    usedLoads = new Set(),
    usedUplinks = new Set();
  function unique(set, key) {
    if (set.has(key)) throw Error("容量校核关联重复");
    set.add(key);
  }
  function link(r, a, b, ordered) {
    id(r.linkId);
    id(r[a]);
    id(r[b]);
    const l = links.get(r.linkId);
    if (
      !l ||
      r[a] === r[b] ||
      !(ordered
        ? r[a] === l.fromInterfaceId && r[b] === l.toInterfaceId
        : [l.fromInterfaceId, l.toInterfaceId].includes(r[a]) &&
          [l.fromInterfaceId, l.toInterfaceId].includes(r[b]))
    )
      throw Error("请先处理容量校核引用；连接端点快照不匹配或连接已删除");
  }
  for (const r of plan.powerBudgets) {
    id(r.deviceId);
    if (!devices.has(r.deviceId)) throw Error("请先处理容量校核设备引用");
    unique(usedDevices, r.deviceId);
    numeric(r.budgetWatts, 1000000, true, true);
    numeric(r.reservePercent, 100);
  }
  for (const r of plan.poeLoads) {
    link(r, "sourceInterfaceId", "targetInterfaceId", false);
    unique(usedLoads, r.linkId);
    numeric(r.portBudgetWatts, 1000, true, true);
    numeric(r.deviceWatts, 1000, true, true);
    numeric(r.lossPercent, 100, true);
  }
  for (const r of plan.uplinks) {
    link(r, "fromInterfaceId", "toInterfaceId", true);
    unique(usedUplinks, r.linkId);
    numeric(r.fromMbps, 1000000, true, true);
    numeric(r.toMbps, 1000000, true, true);
    numeric(r.reservePercent, 100);
  }
  for (const r of plan.trafficDemands) {
    id(r.uplinkId);
    if (!uplinks.has(r.uplinkId))
      throw Error("请先处理容量校核业务引用再删除上联");
    text(r.name, 100, "业务名称", true);
    if (!["forward", "reverse"].includes(r.direction))
      throw Error("业务方向无效");
    numeric(r.count, 100000, true);
    numeric(r.mbpsPerUnit, 10000, true, true);
    numeric(r.concurrencyPercent, 100, true);
    numeric(r.growthPercent, 1000);
  }
  return plan;
}
export function remapCapacityPlanning(
  plan,
  { devices, ports, links },
  uuid = () => crypto.randomUUID(),
) {
  const map = new Map(
    Object.keys(CAPACITY_PLANNING_LIMITS).flatMap((k) =>
      plan[k].map((r) => [r.id, uuid()]),
    ),
  );
  return {
    version: 1,
    powerBudgets: plan.powerBudgets.map((r) => ({
      ...r,
      id: map.get(r.id),
      deviceId: devices.get(r.deviceId),
    })),
    poeLoads: plan.poeLoads.map((r) => ({
      ...r,
      id: map.get(r.id),
      linkId: links.get(r.linkId),
      sourceInterfaceId: ports.get(r.sourceInterfaceId),
      targetInterfaceId: ports.get(r.targetInterfaceId),
    })),
    uplinks: plan.uplinks.map((r) => ({
      ...r,
      id: map.get(r.id),
      linkId: links.get(r.linkId),
      fromInterfaceId: ports.get(r.fromInterfaceId),
      toInterfaceId: ports.get(r.toInterfaceId),
    })),
    trafficDemands: plan.trafficDemands.map((r) => ({
      ...r,
      id: map.get(r.id),
      uplinkId: map.get(r.uplinkId),
    })),
  };
}
// BigInt products preserve exact milliunits even at maximum count/growth inputs.
const milli = (x) => BigInt(Math.round(x * 1000));
const ceil = (a, b) => (a + b - 1n) / b;
const unit = (x) => (x === null ? null : Number(x) / 1000);
const status = (issues) =>
  issues.some((i) => i.severity === "risk")
    ? "risk"
    : issues.length
      ? "pending"
      : "ok";
export function capacityPlanningReport(project, networks = []) {
  const e = project.engineering,
    i = e?.infrastructure,
    c = i?.capacityPlanning;
  const result = {
    enabled: c !== undefined,
    status: "pending",
    powerBudgets: [],
    poeLoads: [],
    uplinks: [],
    trafficDemands: [],
    issues: [],
    basis:
      "按已登记参数估算；供电端需求向上取整、预留后容量向下取整至0.001；全双工逐方向校核，不替代现场验收",
  };
  if (!result.enabled) return result;
  const ownedNetworks = networks.filter(
    (network) => network.projectId === project.id,
  );
  validateEngineering(e, ownedNetworks);
  validateNetworks(ownedNetworks);
  function issue(row, severity, code, message) {
    const v = {
      recordId: row.id ?? null,
      deviceId: row.deviceId ?? null,
      ...(row.direction ? { direction: row.direction } : {}),
      severity,
      code,
      message,
    };
    row.issues.push(v);
    result.issues.push(v);
  }
  const ports = new Map(i.interfaces.map((r) => [r.id, r])),
    devices = new Map(i.devices.map((r) => [r.id, r]));
  for (const r of c.poeLoads) {
    const demand =
      r.deviceWatts === null || r.lossPercent === null
        ? null
        : ceil(milli(r.deviceWatts) * BigInt(100 + r.lossPercent), 100n);
    const row = {
      ...r,
      deviceId: ports.get(r.sourceInterfaceId).deviceId,
      requiredWatts: unit(demand),
      remainingWatts:
        demand === null || r.portBudgetWatts === null
          ? null
          : unit(milli(r.portBudgetWatts) - demand),
      issues: [],
    };
    if (demand === null)
      issue(row, "pending", "power_unknown", "设备功耗或损耗预留待补充");
    if (r.portBudgetWatts === null)
      issue(row, "pending", "port_budget_unknown", "单口供电预算待补充");
    if (row.remainingWatts !== null && row.remainingWatts < 0)
      issue(row, "risk", "port_insufficient", "单口供电预算不足");
    row.status = status(row.issues);
    result.poeLoads.push(row);
  }
  const powerIds = new Set([
    ...c.powerBudgets.map((r) => r.deviceId),
    ...result.poeLoads.map((r) => r.deviceId),
  ]);
  for (const deviceId of powerIds) {
    const input = c.powerBudgets.find((r) => r.deviceId === deviceId);
    const loads = result.poeLoads.filter((r) => r.deviceId === deviceId);
    const known = loads.reduce(
        (sum, r) =>
          sum + (r.requiredWatts === null ? 0n : milli(r.requiredWatts)),
        0n,
      ),
      unknownCount = loads.filter((r) => r.requiredWatts === null).length;
    const usable =
      !input || input.budgetWatts === null
        ? null
        : (milli(input.budgetWatts) * BigInt(100 - input.reservePercent)) /
          100n;
    const row = {
      ...(input ?? {
        id: null,
        deviceId,
        budgetWatts: null,
        reservePercent: null,
        note: "",
      }),
      name: devices.get(deviceId).name,
      loadCount: loads.length,
      knownWatts: unit(known),
      unknownCount,
      usableWatts: unit(usable),
      remainingWatts:
        usable === null || unknownCount ? null : unit(usable - known),
      issues: [],
    };
    if (usable === null)
      issue(row, "pending", "device_budget_unknown", "整机供电预算待补充");
    if (!loads.length) issue(row, "pending", "loads_missing", "待登记负载");
    if (unknownCount)
      issue(row, "pending", "loads_incomplete", "部分负载需求待补充");
    if (usable !== null && known > usable)
      issue(row, "risk", "device_insufficient", "整机可规划供电预算不足");
    for (const load of loads)
      if (load.status !== "ok")
        issue(
          row,
          load.status,
          "load_" + load.status,
          "关联单口存在不足或待补充参数",
        );
    row.status = status(row.issues);
    result.powerBudgets.push(row);
  }
  for (const r of c.trafficDemands) {
    const plannedCount =
      r.count === null
        ? null
        : r.count +
          Number(ceil(BigInt(r.count) * BigInt(r.growthPercent), 100n));
    const demand =
      plannedCount === null ||
      r.mbpsPerUnit === null ||
      r.concurrencyPercent === null
        ? null
        : ceil(
            BigInt(plannedCount) *
              milli(r.mbpsPerUnit) *
              BigInt(r.concurrencyPercent),
            100n,
          );
    const row = { ...r, plannedCount, requiredMbps: unit(demand), issues: [] };
    if (demand === null)
      issue(row, "pending", "traffic_unknown", "业务数量、速率或并发待补充");
    row.status = status(row.issues);
    result.trafficDemands.push(row);
  }
  for (const r of c.uplinks) {
    const speeds = [r.fromMbps, r.toMbps].filter((x) => x !== null);
    const bound = speeds.length
        ? (milli(Math.min(...speeds)) * BigInt(100 - r.reservePercent)) / 100n
        : null,
      usable = speeds.length === 2 ? bound : null;
    const row = {
      ...r,
      usableMbps: unit(usable),
      knownUpperBoundMbps: unit(bound),
      issues: [],
    };
    if (usable === null)
      issue(row, "pending", "endpoint_speed_unknown", "端点速率待补充");
    if (!result.trafficDemands.some((d) => d.uplinkId === r.id))
      issue(row, "pending", "traffic_missing", "待登记业务项");
    const sharedIssues = [...row.issues];
    for (const direction of ["forward", "reverse"]) {
      const demands = result.trafficDemands.filter(
        (d) => d.uplinkId === r.id && d.direction === direction,
      );
      const known = demands.reduce(
          (s, d) => s + (d.requiredMbps === null ? 0n : milli(d.requiredMbps)),
          0n,
        ),
        unknownCount = demands.filter((d) => d.requiredMbps === null).length;
      const d = {
        id: r.id,
        direction,
        demandCount: demands.length,
        knownMbps: unit(known),
        unknownCount,
        remainingMbps:
          usable === null || unknownCount ? null : unit(usable - known),
        issues: [...sharedIssues],
      };
      if (unknownCount)
        issue(
          d,
          "pending",
          "direction_incomplete",
          `${direction}方向业务参数待补充`,
        );
      if (bound !== null && known > bound)
        issue(
          d,
          "risk",
          "bandwidth_insufficient",
          `${direction}方向已知需求超过可规划带宽`,
        );
      d.status = status(d.issues);
      row[direction] = d;
      row.issues.push(...d.issues.filter((i) => !sharedIssues.includes(i)));
    }
    row.status = status(row.issues);
    result.uplinks.push(row);
  }
  if (!Object.keys(CAPACITY_PLANNING_LIMITS).some((k) => c[k].length))
    result.issues.push({
      recordId: null,
      severity: "pending",
      code: "plan_empty",
      message: "待登记容量校核参数",
    });
  result.status = status(result.issues);
  return result;
}
