import {
  validateCapacityPlanning,
  remapCapacityPlanning,
} from "./capacity-planning.js";
import { validateEngineering } from "./engineering.js";
import { validatePortConfiguration } from "./port-configuration.js";
// Pure registered-inventory model. No network discovery or persistence side effects.
export const DEVICE_KINDS = Object.freeze({
  switch: "交换机",
  router: "路由器",
  firewall: "防火墙",
  ap: "AP",
  endpoint: "终端",
  server: "服务器",
  other: "其他",
});
export const INTERFACE_ROLES = Object.freeze({
  access: "业务接入",
  uplink: "上联",
  other: "其他",
});
export const INTERFACE_STATES = Object.freeze({
  available: "可用",
  reserved: "预留",
  disabled: "停用",
});
export const INFRASTRUCTURE_LIMITS = Object.freeze({
  devices: 500,
  interfaces: 5000,
  links: 2500,
});
export const emptyInfrastructure = () => ({
  version: 1,
  devices: [],
  interfaces: [],
  links: [],
});
function text(value, max, label, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${label}无效或过长`);
}
function id(value, label) {
  text(value, 100, `${label}标识`, true);
  if (/[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error(`${label}标识无效`);
}
function enumeration(value, choices, label) {
  if (typeof value !== "string" || !Object.hasOwn(choices, value))
    throw new Error(`${label}无效`);
}
// engineering is the owning engineering object; references never resolve outside it.
export function validateInfrastructure(infrastructure, engineering, networks) {
  if (
    !infrastructure ||
    typeof infrastructure !== "object" ||
    Array.isArray(infrastructure) ||
    infrastructure.version !== 1
  )
    throw new Error("不支持的设备连接数据版本或格式");
  const ids = new Set(
    [
      ...engineering.locations,
      ...engineering.demands,
      ...engineering.capacities,
    ].map((r) => r.id),
  );
  for (const key of ["devices", "interfaces", "links"]) {
    if (
      !Array.isArray(infrastructure[key]) ||
      infrastructure[key].length > INFRASTRUCTURE_LIMITS[key]
    )
      throw new Error(
        `设备连接 ${key} 数据无效或超过 ${INFRASTRUCTURE_LIMITS[key]} 条`,
      );
    for (const row of infrastructure[key]) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("设备连接记录无效");
      id(row.id, "设备连接记录");
      if (ids.has(row.id)) throw new Error("设备连接与工程记录标识重复");
      ids.add(row.id);
      text(row.note, 1000, "备注");
    }
  }
  const areas = new Set(
    engineering.locations.filter((r) => r.kind === "area").map((r) => r.id),
  );
  const devices = new Map(infrastructure.devices.map((r) => [r.id, r]));
  const interfaces = new Map(infrastructure.interfaces.map((r) => [r.id, r]));
  for (const device of infrastructure.devices) {
    id(device.locationId, "区域");
    if (!areas.has(device.locationId))
      throw new Error("设备必须关联本项目有效区域；请先解除设备引用再删除区域");
    text(device.name, 100, "设备名称", true);
    text(device.model, 200, "设备型号");
    enumeration(device.kind, DEVICE_KINDS, "设备类型");
  }
  const names = new Map();
  if (
    infrastructure.logicalVersion !== undefined &&
    infrastructure.logicalVersion !== 1
  )
    throw new Error("不支持的逻辑配置版本");
  for (const port of infrastructure.interfaces) {
    id(port.deviceId, "设备");
    if (!devices.has(port.deviceId))
      throw new Error("接口必须属于本项目设备；请先解除接口引用再删除设备");
    text(port.name, 100, "接口名称", true);
    enumeration(port.role, INTERFACE_ROLES, "接口角色");
    enumeration(port.state, INTERFACE_STATES, "接口状态");
    if (port.logicalConfig !== undefined) {
      if (infrastructure.logicalVersion !== 1)
        throw new Error("缺少逻辑配置版本");
      validatePortConfiguration(port.logicalConfig, networks);
    }
    const used = names.get(port.deviceId) || new Set();
    if (used.has(port.name.trim())) throw new Error("同设备接口名称重复");
    used.add(port.name.trim());
    names.set(port.deviceId, used);
  }
  const occupied = new Set();
  for (const link of infrastructure.links) {
    id(link.fromInterfaceId, "连接起点接口");
    id(link.toInterfaceId, "连接终点接口");
    const from = interfaces.get(link.fromInterfaceId),
      to = interfaces.get(link.toInterfaceId);
    if (!from || !to)
      throw new Error("连接必须引用本项目接口；请先解除连接再删除接口");
    if (from.deviceId === to.deviceId)
      throw new Error("连接两端必须属于不同设备");
    for (const port of [from, to]) {
      if (port.state !== "available")
        throw new Error("连接接口必须可用；请先解除连接再改为预留或停用");
      if (occupied.has(port.id))
        throw new Error("接口已被连接占用；请先解除原连接");
      occupied.add(port.id);
    }
  }
  if (infrastructure.capacityPlanning !== undefined)
    validateCapacityPlanning(
      infrastructure.capacityPlanning,
      infrastructure,
      engineering,
    );
  return infrastructure;
}
export function remapInfrastructure(
  infrastructure,
  locationIds,
  uuid = () => crypto.randomUUID(),
  networkIds,
) {
  if (!(locationIds instanceof Map)) throw new Error("设备区域映射无效");
  const owner = (ids) => ({
    locations: [...ids].map((id) => ({ id, kind: "area" })),
    demands: [],
    capacities: [],
  });
  validateInfrastructure(infrastructure, owner(locationIds.keys()));
  const devices = new Map(infrastructure.devices.map((r) => [r.id, uuid()]));
  const ports = new Map(infrastructure.interfaces.map((r) => [r.id, uuid()]));
  const links = new Map(infrastructure.links.map((r) => [r.id, uuid()]));
  const result = {
    version: 1,
    devices: infrastructure.devices.map((r) => ({
      ...r,
      id: devices.get(r.id),
      locationId: locationIds.get(r.locationId),
    })),
    interfaces: infrastructure.interfaces.map((r) => ({
      ...r,
      id: ports.get(r.id),
      deviceId: devices.get(r.deviceId),
    })),
    links: infrastructure.links.map((r) => ({
      ...r,
      id: links.get(r.id),
      fromInterfaceId: ports.get(r.fromInterfaceId),
      toInterfaceId: ports.get(r.toInterfaceId),
    })),
  };
  if (infrastructure.logicalVersion !== undefined)
    result.logicalVersion = infrastructure.logicalVersion;
  for (const port of result.interfaces)
    if (port.logicalConfig !== undefined) {
      const cfg = port.logicalConfig;
      if (cfg.networkIds.length && !(networkIds instanceof Map))
        throw new Error("逻辑端口网段映射无效");
      port.logicalConfig = {
        ...cfg,
        allowedVlans: cfg.allowedVlans === null ? null : [...cfg.allowedVlans],
        networkIds: cfg.networkIds.map((id) => {
          if (!networkIds.has(id)) throw new Error("逻辑端口网段映射缺失");
          return networkIds.get(id);
        }),
      };
    }
  if (infrastructure.capacityPlanning !== undefined)
    result.capacityPlanning = remapCapacityPlanning(
      infrastructure.capacityPlanning,
      { devices, ports, links },
      uuid,
    );
  return validateInfrastructure(result, owner(locationIds.values()));
}
export function infrastructureReport(project) {
  const e = project.engineering,
    i = e?.infrastructure;
  const result = {
    enabled: i !== undefined,
    status: "ok",
    devices: [],
    locations: [],
    issues: [],
    basis: "按已登记接口统计，未登记设备不纳入；不证明现场容量充足",
  };
  if (!result.enabled) return result;
  validateEngineering(e);
  const occupied = new Set(
    i.links.flatMap((l) => [l.fromInterfaceId, l.toInterfaceId]),
  );
  const byDevice = new Map();
  for (const device of i.devices) {
    const row = {
      deviceId: device.id,
      name: device.name,
      locationId: device.locationId,
      total: 0,
      available: 0,
      connected: 0,
      idle: 0,
      reserved: 0,
      disabled: 0,
    };
    byDevice.set(device.id, row);
    result.devices.push(row);
  }
  const byArea = new Map();
  for (const area of e.locations.filter((l) => l.kind === "area")) {
    const row = {
      locationId: area.id,
      name: area.name,
      deviceCount: 0,
      interfaceCount: 0,
      accessPorts: 0,
      connectedAccessPorts: 0,
      idleAccessPorts: 0,
      manualAccessPorts:
        e.capacities.find((c) => c.locationId === area.id)?.accessPorts ?? null,
      demandCount: 0,
      requiredPorts: 0,
      unknownDemandCount: 0,
      remainingPorts: null,
      status: "ok",
      issues: [],
    };
    byArea.set(area.id, row);
    result.locations.push(row);
  }
  for (const device of i.devices) byArea.get(device.locationId).deviceCount++;
  for (const port of i.interfaces) {
    const row = byDevice.get(port.deviceId),
      area = byArea.get(row.locationId);
    row.total++;
    row[port.state]++;
    area.interfaceCount++;
    if (occupied.has(port.id)) row.connected++;
    else if (port.state === "available") row.idle++;
    if (port.role === "access" && port.state === "available") {
      area.accessPorts++;
      if (occupied.has(port.id)) area.connectedAccessPorts++;
      else area.idleAccessPorts++;
    }
  }
  for (const d of e.demands) {
    const row = byArea.get(d.locationId);
    row.demandCount++;
    if (d.count === null) row.unknownDemandCount++;
    else
      row.requiredPorts +=
        (d.count + Math.ceil((d.count * d.growthPercent) / 100)) *
        d.portsPerUnit;
  }
  function issue(row, severity, code, message) {
    const value = { locationId: row?.locationId, severity, code, message };
    row?.issues.push(value);
    result.issues.push(value);
  }
  for (const row of result.locations) {
    const registered = row.deviceCount > 0 && row.interfaceCount > 0;
    if (!registered)
      issue(
        row,
        "pending",
        "inventory_missing",
        "请登记设备和接口后核对业务容量",
      );
    if (!row.demandCount)
      issue(row, "pending", "demands_missing", "请登记业务需求");
    if (row.unknownDemandCount)
      issue(row, "pending", "demand_incomplete", "部分业务需求数量待补充");
    if (registered && row.requiredPorts > row.accessPorts)
      issue(
        row,
        "risk",
        "access_capacity_insufficient",
        `已知端口需求 ${row.requiredPorts} 超过已登记可用业务容量 ${row.accessPorts}`,
      );
    if (registered && row.demandCount && !row.unknownDemandCount)
      row.remainingPorts = row.accessPorts - row.requiredPorts;
    row.status = row.issues.some((x) => x.severity === "risk")
      ? "risk"
      : row.issues.length
        ? "pending"
        : "ok";
  }
  if (!result.locations.length)
    issue(null, "pending", "areas_missing", "请先登记场地区域");
  result.status = result.issues.some((x) => x.severity === "risk")
    ? "risk"
    : result.issues.length
      ? "pending"
      : "ok";
  return result;
}
