import { validateEngineering } from "./engineering.js";
import { saveAcceptanceItem } from "./site-acceptance.js";

export const TOPOLOGY_BASIS =
  "仅校核已登记连接与声明的业务 VLAN；未知保持待补充，不证明现场连通、路由、隔离或冗余有效。";
const statusFor = (issues) =>
  issues.some((issue) => issue.severity === "risk")
    ? "risk"
    : issues.length
      ? "pending"
      : "ok";

/** Pure view of registered records: filtering never scans or rewrites the project. */
export function registeredTopology(
  project,
  { locationId = "", page = 0, pageSize = 40 } = {},
) {
  const engineering = project.engineering,
    infrastructure = engineering?.infrastructure;
  const result = {
    nodes: [],
    links: [],
    allLinks: [],
    total: 0,
    page: 0,
    pages: 0,
    basis: TOPOLOGY_BASIS,
  };
  if (!infrastructure) return result;
  validateEngineering(engineering);
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 40
  )
    throw Error("拓扑分页无效");
  const locations = new Map(engineering.locations.map((l) => [l.id, l]));
  if (locationId && !locations.has(locationId))
    throw Error("筛选位置不属于本项目");
  const isWithinSelectedLocation = (id) => {
    for (let l = locations.get(id); l; l = locations.get(l.parentId)) {
      if (l.id === locationId) return true;
    }
    return !locationId;
  };
  const selectedDeviceIds = new Set(
    infrastructure.devices
      .filter((d) => isWithinSelectedLocation(d.locationId))
      .map((d) => d.id),
  );
  const interfaceById = new Map(
    infrastructure.interfaces.map((p) => [p.id, p]),
  );
  const relevantLinks = infrastructure.links.filter(
    (l) =>
      selectedDeviceIds.has(interfaceById.get(l.fromInterfaceId).deviceId) ||
      selectedDeviceIds.has(interfaceById.get(l.toInterfaceId).deviceId),
  );
  const visibleDeviceIds = new Set(selectedDeviceIds);
  for (const link of relevantLinks) {
    visibleDeviceIds.add(interfaceById.get(link.fromInterfaceId).deviceId);
    visibleDeviceIds.add(interfaceById.get(link.toInterfaceId).deviceId);
  }
  const devices = infrastructure.devices.filter((d) =>
    visibleDeviceIds.has(d.id),
  );
  result.total = devices.length;
  result.pages = Math.ceil(devices.length / pageSize);
  result.page = Math.min(page, Math.max(0, result.pages - 1));
  result.nodes = devices
    .slice(result.page * pageSize, (result.page + 1) * pageSize)
    .map((d, index) => ({
      ...d,
      boundary: !selectedDeviceIds.has(d.id),
      x: 30 + (index % 4) * 220,
      y: 30 + Math.floor(index / 4) * 120,
    }));
  const visibleNodeIds = new Set(result.nodes.map((d) => d.id));
  result.allLinks = relevantLinks.map((l) => ({
    ...l,
    fromDeviceId: interfaceById.get(l.fromInterfaceId).deviceId,
    toDeviceId: interfaceById.get(l.toInterfaceId).deviceId,
    fromName: interfaceById.get(l.fromInterfaceId).name,
    toName: interfaceById.get(l.toInterfaceId).name,
  }));
  result.links = result.allLinks.filter(
    (l) =>
      visibleNodeIds.has(l.fromDeviceId) && visibleNodeIds.has(l.toDeviceId),
  );
  return result;
}

/** Check each declared VLAN on its registered segment; unknown data stays pending. */
export function vlanConfigurationReport(project, networks = []) {
  const engineering = project.engineering,
    infrastructure = engineering?.infrastructure;
  const result = {
    status: "pending",
    interfaces: [],
    issues: [],
    basis: TOPOLOGY_BASIS,
  };
  if (!infrastructure) {
    result.issues.push({
      code: "inventory_missing",
      severity: "pending",
      message: "请登记设备、接口和连接",
    });
    return result;
  }
  const projectNetworks = networks.filter((n) => n.projectId === project.id);
  validateEngineering(engineering, projectNetworks);
  const networkById = new Map(projectNetworks.map((n) => [n.id, n])),
    interfaceById = new Map(infrastructure.interfaces.map((p) => [p.id, p]));
  const interfaceResults = new Map();
  const reportedIssueKeys = new Set();
  function addIssue(port, severity, code, message, refs = {}) {
    const key = JSON.stringify([port?.id, code, refs.networkId, refs.linkId]);
    if (reportedIssueKeys.has(key)) return;
    reportedIssueKeys.add(key);
    const value = {
      interfaceId: port?.id,
      deviceId: port?.deviceId,
      severity,
      code,
      message,
      ...refs,
    };
    interfaceResults.get(port?.id)?.issues.push(value);
    result.issues.push(value);
  }
  function checkVlanCarrier(port, networkId, linkId) {
    const net = networkById.get(networkId),
      logicalConfig = port.logicalConfig;
    const refs = {
      networkId,
      ...(linkId ? { linkId } : {}),
      ...(Number.isInteger(net?.vlan) ? { vlan: net.vlan } : {}),
    };
    if (!Number.isInteger(net?.vlan) || net.vlan < 1 || net.vlan > 4094) {
      addIssue(
        port,
        "pending",
        "network_vlan_missing",
        `${port.name}：业务网段 ${net?.name ?? networkId} 尚未登记 VLAN`,
        refs,
      );
      return;
    }
    if (!logicalConfig) {
      addIssue(
        port,
        "pending",
        "logical_config_missing",
        `${port.name}：请登记承载 VLAN ${net.vlan} 的逻辑配置`,
        refs,
      );
      return;
    }
    if (logicalConfig.mode === "access") {
      if (logicalConfig.accessVlan === null)
        addIssue(
          port,
          "pending",
          "access_vlan_missing",
          `${port.name}：Access VLAN 待补充（业务要求 ${net.vlan}）`,
          refs,
        );
      else if (logicalConfig.accessVlan !== net.vlan)
        addIssue(
          port,
          "risk",
          "access_vlan_mismatch",
          `${port.name}：Access VLAN ${logicalConfig.accessVlan} 与业务 VLAN ${net.vlan} 不一致`,
          refs,
        );
    } else if (logicalConfig.allowedVlans === null)
      addIssue(
        port,
        "pending",
        "allowed_vlans_missing",
        `${port.name}：Trunk 允许 VLAN 待补充（业务要求 ${net.vlan}）`,
        refs,
      );
    else if (!logicalConfig.allowedVlans.includes(net.vlan))
      addIssue(
        port,
        "risk",
        "trunk_vlan_missing",
        `${port.name}：Trunk 缺少业务 VLAN ${net.vlan}`,
        refs,
      );
  }
  const connected = new Set(
    infrastructure.links.flatMap((l) => [l.fromInterfaceId, l.toInterfaceId]),
  );
  for (const port of infrastructure.interfaces) {
    const row = {
      interfaceId: port.id,
      deviceId: port.deviceId,
      name: port.name,
      status: "pending",
      issues: [],
    };
    interfaceResults.set(port.id, row);
    result.interfaces.push(row);
    const logicalConfig = port.logicalConfig;
    if (!logicalConfig)
      addIssue(
        port,
        "pending",
        "logical_config_missing",
        `${port.name}：尚未登记逻辑端口配置`,
      );
    else {
      if (!logicalConfig.networkIds.length)
        addIssue(
          port,
          "pending",
          "network_association_missing",
          `${port.name}：请声明该接口承载的本项目业务网段`,
        );
      for (const id of logicalConfig.networkIds) checkVlanCarrier(port, id);
      if (!connected.has(port.id) && logicalConfig.networkIds.length)
        addIssue(
          port,
          "pending",
          "registered_path_missing",
          `${port.name}：已声明业务，但尚未登记连接路径`,
        );
    }
  }
  for (const link of infrastructure.links) {
    const from = interfaceById.get(link.fromInterfaceId),
      to = interfaceById.get(link.toInterfaceId);
    // Only explicit declarations at this registered segment become requirements.
    const requirements = new Set([
      ...(from.logicalConfig?.networkIds ?? []),
      ...(to.logicalConfig?.networkIds ?? []),
    ]);
    for (const id of requirements) {
      checkVlanCarrier(from, id, link.id);
      checkVlanCarrier(to, id, link.id);
    }
  }
  if (!infrastructure.interfaces.length)
    addIssue(null, "pending", "interfaces_missing", "请登记接口与逻辑配置");
  for (const row of result.interfaces) row.status = statusFor(row.issues);
  result.status = statusFor(result.issues);
  return result;
}

export function topologyAcceptanceItem(
  project,
  finding,
  networks = [],
  uuid = () => crypto.randomUUID(),
) {
  const current = vlanConfigurationReport(project, networks).issues.find(
    (issue) =>
      issue.interfaceId &&
      issue.interfaceId === finding.interfaceId &&
      issue.code === finding.code &&
      issue.networkId === finding.networkId &&
      issue.linkId === finding.linkId &&
      issue.message === finding.message,
  );
  if (!current) throw Error("校核问题已变化或不属于本项目，请重新检查");
  return saveAcceptanceItem(
    project,
    {
      id: uuid(),
      name: `VLAN配置复核 ${current.interfaceId}`.slice(0, 100),
      targetType: "interface",
      targetId: current.interfaceId,
      method: "manual",
      expected: `复核并修正登记配置：${current.message}；在现场独立检查实际配置与承载。`,
      owner: "",
      note: TOPOLOGY_BASIS,
    },
    networks,
  );
}
