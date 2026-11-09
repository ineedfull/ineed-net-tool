const domain = () => import("../src/domain/infrastructure.js");
const code = (prefix, index) => prefix + String(index + 1).padStart(3, "0");
async function infrastructureTables(project) {
  const {
    DEVICE_KINDS,
    INTERFACE_ROLES,
    INTERFACE_STATES,
    infrastructureReport,
  } = await domain();
  const i = project.engineering?.infrastructure;
  const devices = new Map(
    (i?.devices || []).map((r, n) => [r.id, code("E", n)]),
  );
  const ports = new Map(
    (i?.interfaces || []).map((r, n) => [r.id, code("P", n)]),
  );
  const areas = new Map(
    (project.engineering?.locations || []).map((r, n) => [r.id, code("L", n)]),
  );
  const report = infrastructureReport(project),
    rows = [];
  const statuses = {
    ok: "已登记容量满足已知需求",
    pending: "待补充",
    risk: "已登记容量不足",
  };
  for (const r of report.devices)
    rows.push([
      "设备",
      devices.get(r.deviceId),
      areas.get(r.locationId),
      r.name,
      r.total,
      r.available,
      r.connected,
      r.idle,
      r.reserved,
      r.disabled,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      report.basis,
    ]);
  for (const r of report.locations)
    rows.push([
      "区域",
      "",
      areas.get(r.locationId),
      r.name,
      "",
      "",
      "",
      "",
      "",
      "",
      r.accessPorts,
      r.connectedAccessPorts,
      r.idleAccessPorts,
      r.requiredPorts,
      r.unknownDemandCount,
      r.manualAccessPorts,
      r.remainingPorts,
      statuses[r.status],
      report.basis,
    ]);
  // One issue per row, never an unbounded aggregation into a result cell.
  for (const issue of report.issues)
    rows.push([
      "问题",
      "",
      areas.get(issue.locationId) || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      statuses[issue.severity],
      issue.message,
    ]);
  return [
    (i?.devices || []).map((r) => [
      devices.get(r.id),
      areas.get(r.locationId),
      r.name,
      DEVICE_KINDS[r.kind],
      r.model,
      r.note,
    ]),
    (i?.interfaces || []).map((r) => [
      ports.get(r.id),
      devices.get(r.deviceId),
      r.name,
      INTERFACE_ROLES[r.role],
      INTERFACE_STATES[r.state],
      r.note,
    ]),
    (i?.links || []).map((r, n) => [
      code("C", n),
      ports.get(r.fromInterfaceId),
      ports.get(r.toInterfaceId),
      r.note,
    ]),
    rows,
  ];
}
async function parseInfrastructure(tables, engineering) {
  const {
    DEVICE_KINDS,
    INTERFACE_ROLES,
    INTERFACE_STATES,
    validateInfrastructure,
  } = await domain();
  const reverse = (map, value) =>
    Object.keys(map).find((k) => map[k] === value) || value;
  const i = { version: 1, devices: [], interfaces: [], links: [] };
  for (const { values: v } of tables[0])
    i.devices.push({
      id: v[0],
      locationId: v[1],
      name: v[2],
      kind: reverse(DEVICE_KINDS, v[3]),
      model: v[4],
      note: v[5],
    });
  for (const { values: v } of tables[1])
    i.interfaces.push({
      id: v[0],
      deviceId: v[1],
      name: v[2],
      role: reverse(INTERFACE_ROLES, v[3]),
      state: reverse(INTERFACE_STATES, v[4]),
      note: v[5],
    });
  // Capacity and connection both use C workbook codes. Internal link IDs use
  // collision-free bounded ordinals, leaving all 100 characters available for
  // interchange codes. Each occupied candidate is skipped at most once.
  const takenIds = new Set(
    [
      ...(engineering.locations || []),
      ...(engineering.demands || []),
      ...(engineering.capacities || []),
      ...i.devices,
      ...i.interfaces,
    ].map((r) => r.id),
  );
  let nextLinkId = 1;
  const linkCodes = new Map();
  for (const { values: v } of tables[2]) {
    if (!v[0].trim() || v[0].length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(v[0]))
      return { infrastructure: i, errors: ["接口连接：连接编号无效"] };
    if (linkCodes.has(v[0]))
      return { infrastructure: i, errors: ["接口连接：连接编号重复"] };

    let id;
    do {
      id = `excel-link-${nextLinkId++}`;
    } while (takenIds.has(id));
    takenIds.add(id);
    linkCodes.set(v[0], id);
    i.links.push({
      id,
      fromInterfaceId: v[1],
      toInterfaceId: v[2],
      note: v[3],
    });
  }
  try {
    validateInfrastructure(i, engineering);
    return { infrastructure: i, errors: [], linkCodes };
  } catch (error) {
    return { infrastructure: i, errors: [`设备连接输入：${error.message}`] };
  }
}
async function choices(name) {
  const { DEVICE_KINDS, INTERFACE_ROLES, INTERFACE_STATES } = await domain();
  return name === "工程设备"
    ? { 4: Object.values(DEVICE_KINDS) }
    : name === "设备接口"
      ? {
          4: Object.values(INTERFACE_ROLES),
          5: Object.values(INTERFACE_STATES),
        }
      : {};
}
module.exports = { infrastructureTables, parseInfrastructure, choices };
