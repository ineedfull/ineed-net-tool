import {
  validateSiteAcceptance,
  remapSiteAcceptance,
} from "./site-acceptance.js";
import {
  validateInfrastructure,
  remapInfrastructure,
} from "./infrastructure.js";
import { ipNumber, subnet } from "./ipv4.js";
import { validateNetworks } from "./workspace.js";

export const LOCATION_KINDS = Object.freeze({
  building: "楼栋",
  floor: "楼层",
  area: "区域",
});
export const DEMAND_KINDS = Object.freeze({
  wired: "有线办公",
  wireless: "无线客户端",
  ap: "无线 AP",
  camera: "摄像机",
  server: "服务器",
  printer: "打印机",
  other: "其他",
});
export const ADDRESS_MODES = Object.freeze({ static: "静态", dhcp: "DHCP" });
export const ENGINEERING_LIMITS = Object.freeze({
  locations: 500,
  demands: 1000,
  capacities: 500,
  count: 1000000,
  growthPercent: 1000,
  perUnit: 16,
});
export const DEMAND_DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.keys(DEMAND_KINDS).map((kind) => [
      kind,
      Object.freeze({
        count: null,
        growthPercent: 20,
        addressesPerUnit: 1,
        portsPerUnit: kind === "wireless" ? 0 : 1,
        addressMode:
          kind === "wired" || kind === "wireless" ? "dhcp" : "static",
      }),
    ]),
  ),
);
export const emptyEngineering = () => ({
  version: 1,
  locations: [],
  demands: [],
  capacities: [],
});

function identifier(value, label, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > 100 ||
    /[\x00-\x1f\x7f-\x9f]/.test(value)
  )
    throw new Error(`${label}标识无效`);
}
function text(value, max, label, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${label}无效或过长`);
}
function number(value, max, label, nullable = false) {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(
      `${label}必须为 0～${max} 的整数${nullable ? "或留空" : ""}`,
    );
}

// Project ownership is supplied by the caller as its own network list.
export function validateEngineering(engineering, networks) {
  if (
    !engineering ||
    typeof engineering !== "object" ||
    Array.isArray(engineering) ||
    engineering.version !== 1
  )
    throw new Error("不支持的工程数据版本或格式");
  for (const key of ["locations", "demands", "capacities"])
    if (
      !Array.isArray(engineering[key]) ||
      engineering[key].length > ENGINEERING_LIMITS[key]
    )
      throw new Error(
        `工程 ${key} 数据无效或超过 ${ENGINEERING_LIMITS[key]} 条`,
      );
  const ids = new Set();
  for (const row of [
    ...engineering.locations,
    ...engineering.demands,
    ...engineering.capacities,
  ]) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("工程记录无效");
    identifier(row.id, "工程记录");
    if (ids.has(row.id)) throw new Error("工程记录标识重复");
    ids.add(row.id);
    text(row.note, 1000, "工程备注");
  }
  const locations = new Map(
    engineering.locations.map((location) => [location.id, location]),
  );
  for (const location of engineering.locations) {
    text(location.name, 100, "位置名称", true);
    identifier(location.parentId, "上级位置", true);
    if (
      typeof location.kind !== "string" ||
      !Object.hasOwn(LOCATION_KINDS, location.kind)
    )
      throw new Error("位置类型无效");
    const parent = locations.get(location.parentId);
    // Strict kind transitions also make cycles impossible.
    const legal =
      location.kind === "building"
        ? location.parentId === ""
        : location.kind === "floor"
          ? parent?.kind === "building"
          : location.parentId === "" ||
            parent?.kind === "building" ||
            parent?.kind === "floor";
    if (!legal)
      throw new Error(
        "位置层级无效：楼栋在根，楼层属于楼栋，区域属于项目、楼栋或楼层",
      );
  }
  let networkIds;
  if (networks !== undefined) {
    if (!Array.isArray(networks)) throw new Error("工程网段列表无效");
    networkIds = new Set(networks.map((network) => network.id));
  }
  function requireArea(row) {
    identifier(row.locationId, "区域");
    if (locations.get(row.locationId)?.kind !== "area")
      throw new Error("工程需求和容量必须关联有效区域");
  }
  for (const demand of engineering.demands) {
    requireArea(demand);
    text(demand.name, 100, "需求名称", true);
    if (
      typeof demand.kind !== "string" ||
      !Object.hasOwn(DEMAND_KINDS, demand.kind)
    )
      throw new Error("需求类型无效");
    if (
      typeof demand.addressMode !== "string" ||
      !Object.hasOwn(ADDRESS_MODES, demand.addressMode)
    )
      throw new Error("地址分配方式无效");
    number(demand.count, ENGINEERING_LIMITS.count, "当前数量", true);
    number(
      demand.growthPercent,
      ENGINEERING_LIMITS.growthPercent,
      "增长预留比例",
    );
    number(demand.addressesPerUnit, ENGINEERING_LIMITS.perUnit, "每单位地址数");
    number(demand.portsPerUnit, ENGINEERING_LIMITS.perUnit, "每单位接入端口数");
    identifier(demand.networkId, "网段", true);
    if (demand.networkId && networkIds && !networkIds.has(demand.networkId))
      throw new Error(
        "业务需求引用的网段不存在或不属于本项目；请先解除需求关联再删除或移动网段",
      );
  }
  const capacityAreas = new Set();
  for (const capacity of engineering.capacities) {
    requireArea(capacity);
    if (capacityAreas.has(capacity.locationId))
      throw new Error("每个区域最多一条接入容量");
    capacityAreas.add(capacity.locationId);
    number(
      capacity.accessPorts,
      ENGINEERING_LIMITS.count,
      "可用接入端口",
      true,
    );
  }
  if (engineering.infrastructure !== undefined)
    validateInfrastructure(engineering.infrastructure, engineering, networks);
  if (engineering.siteAcceptance !== undefined)
    validateSiteAcceptance(engineering.siteAcceptance, engineering);
  return engineering;
}

const statusFor = (issues) =>
  issues.some((issue) => issue.severity === "risk")
    ? "risk"
    : issues.length
      ? "pending"
      : "ok";

export function engineeringReport(project, networks = []) {
  const result = {
    enabled: project.engineering !== undefined,
    status: "ok",
    demands: [],
    locations: [],
    networks: [],
    issues: [],
  };
  if (!result.enabled) return result;
  const ownedNetworks = networks.filter(
    (network) => network.projectId === project.id,
  );
  validateEngineering(project.engineering, ownedNetworks);
  validateNetworks(ownedNetworks);
  const networkById = new Map(
    ownedNetworks.map((network) => [network.id, network]),
  );
  const capacityByArea = new Map(
    project.engineering.capacities.map((capacity) => [
      capacity.locationId,
      capacity,
    ]),
  );
  const areaRows = new Map();
  const networkRows = new Map();
  const areaDemandCounts = new Map();
  // Keep incomplete counts visible in every linked scope. Address modes also
  // track their own unknown positive contributions for pool comparisons.
  const unknownStatic = new Map();
  const unknownDhcp = new Map();
  function issue(row, severity, code, message, refs = {}) {
    const value = { severity, code, message, ...refs };
    row?.issues.push(value);
    result.issues.push(value);
  }
  for (const location of project.engineering.locations) {
    if (location.kind !== "area") continue;
    const accessPorts = capacityByArea.get(location.id)?.accessPorts ?? null;
    const row = {
      locationId: location.id,
      name: location.name,
      requiredPorts: 0,
      unknownDemandCount: 0,
      accessPorts,
      remainingPorts: null,
      status: "ok",
      issues: [],
    };
    areaRows.set(location.id, row);
    areaDemandCounts.set(location.id, 0);
    result.locations.push(row);
  }
  for (const demand of project.engineering.demands) {
    const reserveCount =
      demand.count === null
        ? null
        : Math.ceil((demand.count * demand.growthPercent) / 100);
    const plannedCount =
      demand.count === null ? null : demand.count + reserveCount;
    const row = {
      ...demand,
      reserveCount,
      plannedCount,
      addressDemand:
        plannedCount === null ? null : plannedCount * demand.addressesPerUnit,
      portDemand:
        plannedCount === null ? null : plannedCount * demand.portsPerUnit,
      status: "ok",
      issues: [],
    };
    result.demands.push(row);
    const refs = {
      demandId: demand.id,
      locationId: demand.locationId,
      ...(demand.networkId ? { networkId: demand.networkId } : {}),
    };
    if (demand.count === null)
      issue(
        row,
        "pending",
        "count_missing",
        `${demand.name}：请补充当前数量`,
        refs,
      );
    if (!demand.networkId)
      issue(
        row,
        "pending",
        "network_missing",
        `${demand.name}：请关联本项目网段`,
        refs,
      );
    row.status = statusFor(row.issues);
    const areaRow = areaRows.get(demand.locationId);
    areaDemandCounts.set(
      demand.locationId,
      areaDemandCounts.get(demand.locationId) + 1,
    );
    areaRow.requiredPorts += row.portDemand ?? 0;
    if (demand.count === null) areaRow.unknownDemandCount++;
    if (!demand.networkId) continue;
    if (!networkRows.has(demand.networkId)) {
      const network = networkById.get(demand.networkId);
      const net = subnet(network.cidr);
      const gatewayAddresses = network.gateway ? 1 : 0;
      const dhcpCapacity =
        network.dhcpStart && network.dhcpEnd
          ? ipNumber(network.dhcpEnd) - ipNumber(network.dhcpStart) + 1
          : null;
      const networkRow = {
        networkId: network.id,
        name: network.name,
        cidr: network.cidr,
        addressDemand: 0,
        staticDemand: 0,
        dhcpDemand: 0,
        unknownDemandCount: 0,
        gatewayAddresses,
        requiredAddresses: gatewayAddresses,
        totalCapacity: net.usable,
        dhcpCapacity,
        staticCapacity: net.usable - (dhcpCapacity ?? 0) - gatewayAddresses,
        remainingAddresses: null,
        remainingDhcp: null,
        remainingStatic: null,
        registeredAddresses: network.allocations.length,
        status: "ok",
        issues: [],
      };
      networkRows.set(network.id, networkRow);
      unknownStatic.set(network.id, 0);
      unknownDhcp.set(network.id, 0);
      result.networks.push(networkRow);
    }
    const networkRow = networkRows.get(demand.networkId);
    const modeKey =
      demand.addressMode === "static" ? "staticDemand" : "dhcpDemand";
    networkRow.addressDemand += row.addressDemand ?? 0;
    networkRow[modeKey] += row.addressDemand ?? 0;
    if (demand.count === null) {
      networkRow.unknownDemandCount++;
      if (demand.addressesPerUnit > 0) {
        const unknown =
          demand.addressMode === "static" ? unknownStatic : unknownDhcp;
        unknown.set(demand.networkId, unknown.get(demand.networkId) + 1);
      }
    }
  }
  if (!result.demands.length)
    issue(null, "pending", "demands_missing", "请登记场地与业务需求");
  for (const row of result.locations) {
    const refs = { locationId: row.locationId };
    if (!areaDemandCounts.get(row.locationId))
      issue(
        row,
        "pending",
        "area_demands_missing",
        `${row.name}：请登记业务需求`,
        refs,
      );
    if (row.accessPorts === null)
      issue(
        row,
        "pending",
        "access_capacity_missing",
        `${row.name}：请补充可用业务接入端口`,
        refs,
      );
    if (row.unknownDemandCount)
      issue(
        row,
        "pending",
        "port_demand_incomplete",
        `${row.name}：部分端口需求数量待补充`,
        refs,
      );
    if (row.accessPorts !== null && row.requiredPorts > row.accessPorts)
      issue(
        row,
        "risk",
        "access_capacity_insufficient",
        `${row.name}：已知端口需求 ${row.requiredPorts} 超过可用容量 ${row.accessPorts}`,
        refs,
      );
    if (
      row.accessPorts !== null &&
      !row.unknownDemandCount &&
      areaDemandCounts.get(row.locationId)
    )
      row.remainingPorts = row.accessPorts - row.requiredPorts;
    row.status = statusFor(row.issues);
  }
  for (const row of result.networks) {
    const refs = { networkId: row.networkId };
    const gatewayMissing =
      !row.gatewayAddresses &&
      subnet(row.cidr).prefix !== 32 &&
      (row.addressDemand > 0 ||
        unknownStatic.get(row.networkId) + unknownDhcp.get(row.networkId) > 0);
    row.requiredAddresses += row.addressDemand;
    if (gatewayMissing)
      issue(
        row,
        "pending",
        "gateway_missing",
        `${row.name}：有地址需求，请补充实际网关`,
        refs,
      );
    if (row.unknownDemandCount)
      issue(
        row,
        "pending",
        "address_demand_incomplete",
        `${row.name}：部分地址需求数量待补充`,
        refs,
      );
    if (
      row.dhcpCapacity === null &&
      (row.dhcpDemand > 0 || unknownDhcp.get(row.networkId))
    )
      issue(
        row,
        "pending",
        "dhcp_pool_missing",
        `${row.name}：请配置 DHCP 地址池`,
        refs,
      );
    if (row.requiredAddresses > row.totalCapacity)
      issue(
        row,
        "risk",
        "address_capacity_insufficient",
        `${row.name}：已知总地址需求超过 CIDR 可用容量`,
        refs,
      );
    if (row.staticDemand > row.staticCapacity)
      issue(
        row,
        "risk",
        "static_capacity_insufficient",
        `${row.name}：已知静态地址需求超过静态容量`,
        refs,
      );
    if (row.dhcpCapacity !== null && row.dhcpDemand > row.dhcpCapacity)
      issue(
        row,
        "risk",
        "dhcp_capacity_insufficient",
        `${row.name}：已知 DHCP 需求超过地址池容量`,
        refs,
      );
    if (!row.unknownDemandCount && !gatewayMissing)
      row.remainingAddresses = row.totalCapacity - row.requiredAddresses;
    if (!unknownStatic.get(row.networkId) && !gatewayMissing)
      row.remainingStatic = row.staticCapacity - row.staticDemand;
    if (row.dhcpCapacity !== null && !unknownDhcp.get(row.networkId))
      row.remainingDhcp = row.dhcpCapacity - row.dhcpDemand;
    row.status = statusFor(row.issues);
  }
  result.status = statusFor(result.issues);
  return result;
}

export function remapEngineering(
  engineering,
  networkIds,
  uuid = () => crypto.randomUUID(),
) {
  if (!(networkIds instanceof Map)) throw new Error("工程网段映射无效");
  validateEngineering(
    engineering,
    Array.from(networkIds.keys(), (id) => ({ id })),
  );
  const locationIds = new Map(
    engineering.locations.map((location) => [location.id, uuid()]),
  );
  const result = {
    version: 1,
    locations: engineering.locations.map((location) => ({
      ...location,
      id: locationIds.get(location.id),
      parentId: location.parentId ? locationIds.get(location.parentId) : "",
    })),
    demands: engineering.demands.map((demand) => ({
      ...demand,
      id: uuid(),
      locationId: locationIds.get(demand.locationId),
      networkId: demand.networkId ? networkIds.get(demand.networkId) : "",
    })),
    capacities: engineering.capacities.map((capacity) => ({
      ...capacity,
      id: uuid(),
      locationId: locationIds.get(capacity.locationId),
    })),
  };
  if (engineering.infrastructure !== undefined)
    result.infrastructure = remapInfrastructure(
      engineering.infrastructure,
      locationIds,
      uuid,
      networkIds,
    );
  if (engineering.siteAcceptance !== undefined) {
    const maps = Object.fromEntries(
      ["devices", "interfaces", "links"].map((key) => [
        key,
        new Map(
          (engineering.infrastructure?.[key] ?? []).map((row, index) => [
            row.id,
            result.infrastructure[key][index].id,
          ]),
        ),
      ]),
    );
    result.siteAcceptance = remapSiteAcceptance(
      engineering.siteAcceptance,
      maps,
      uuid,
    );
  }
  return validateEngineering(
    result,
    Array.from(networkIds.values(), (id) => ({ id })),
  );
}
