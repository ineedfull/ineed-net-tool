// Workbook IDs are local interchange keys; projects.js remaps them on creation.
const domain = () => import("../src/domain/engineering.js");
const code = (prefix, index) => prefix + String(index + 1).padStart(3, "0");
const statuses = { ok: "容量充足", pending: "待补充", risk: "容量不足" };
async function engineeringTables(project, networks, networkCodes) {
  const {
    LOCATION_KINDS,
    DEMAND_KINDS,
    ADDRESS_MODES,
    engineeringReport,
    validateEngineering,
  } = await domain();
  const e = project.engineering;
  if (e) validateEngineering(e, networks);
  const locations = new Map(
    (e?.locations || []).map((l, i) => [l.id, code("L", i)]),
  );
  const demands = new Map(
    (e?.demands || []).map((d, i) => [d.id, code("D", i)]),
  );
  const value = (v) => (v === null ? "待补充" : v);
  const report = engineeringReport(project, networks);
  const problems = (row) => row.issues.map((i) => i.message).join("；");
  const rows = [];
  if (e) {
    rows.push([
      "总体",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "按输入重新计算；已知小计不代表完整需求",
      report.status === "ok" ? "容量充足" : statuses[report.status],
      `问题 ${report.issues.length} 条；待补充 ${report.issues.filter((i) => i.severity === "pending").length} 条；容量不足 ${report.issues.filter((i) => i.severity === "risk").length} 条；详见逐条问题行`,
    ]);
    for (const d of report.demands)
      rows.push([
        "需求",
        demands.get(d.id),
        locations.get(d.locationId),
        networkCodes.get(d.networkId) || "",
        d.name,
        "台 / 地址 / 端口",
        value(d.plannedCount),
        value(d.addressDemand),
        value(d.portDemand),
        "",
        d.count === null
          ? "当前数量待补充"
          : `${d.count} + ceil(${d.count} × ${d.growthPercent} / 100) = ${d.plannedCount}；地址 × ${d.addressesPerUnit}；端口 × ${d.portsPerUnit}`,
        statuses[d.status],
        problems(d),
      ]);
    for (const l of report.locations)
      rows.push([
        "区域端口",
        "",
        locations.get(l.locationId),
        "",
        l.name,
        "端口",
        l.requiredPorts,
        value(l.accessPorts),
        value(l.remainingPorts),
        l.unknownDemandCount,
        "已知端口小计；可用业务端口由工程师扣除上联/不可用/复用后输入",
        statuses[l.status],
        problems(l),
      ]);
    for (const n of report.networks) {
      for (const [label, demand, capacity, remaining, basis] of [
        [
          "总地址",
          n.requiredAddresses,
          n.totalCapacity,
          n.remainingAddresses,
          `CIDR ${n.cidr}；已知地址 ${n.addressDemand} + 实际网关 ${n.gatewayAddresses}；登记 ${n.registeredAddresses} 仅参考`,
        ],
        [
          "DHCP地址",
          n.dhcpDemand,
          n.dhcpCapacity,
          n.remainingDhcp,
          "已知 DHCP 需求；已保存地址池含首尾",
        ],
        [
          "静态地址",
          n.staticDemand,
          n.staticCapacity,
          n.remainingStatic,
          "CIDR可用 - DHCP池 - 实际网关",
        ],
      ])
        rows.push([
          label,
          "",
          "",
          networkCodes.get(n.networkId),
          n.name,
          "地址",
          demand,
          value(capacity),
          value(remaining),
          n.unknownDemandCount,
          basis,
          statuses[n.status],
          problems(n),
        ]);
    }
    for (const issue of report.issues)
      rows.push([
        "问题",
        demands.get(issue.demandId) || "",
        locations.get(issue.locationId) || "",
        networkCodes.get(issue.networkId) || "",
        "",
        "",
        "",
        "",
        "",
        "",
        issue.code,
        statuses[issue.severity],
        issue.message,
      ]);
  }
  return [
    (e?.locations || []).map((l) => [
      locations.get(l.id),
      locations.get(l.parentId) || "",
      LOCATION_KINDS[l.kind],
      l.name,
      l.note,
    ]),
    (e?.demands || []).map((d) => [
      demands.get(d.id),
      locations.get(d.locationId),
      d.name,
      DEMAND_KINDS[d.kind],
      d.count,
      d.growthPercent,
      d.addressesPerUnit,
      d.portsPerUnit,
      ADDRESS_MODES[d.addressMode],
      networkCodes.get(d.networkId) || "",
      d.note,
    ]),
    (e?.capacities || []).map((c, i) => [
      code("C", i),
      locations.get(c.locationId),
      c.accessPorts,
      c.note,
    ]),
    rows,
  ];
}
// Excel percentage tokens scale the displayed value by 100. Quoted text,
// escaped characters, padding and bracket directives are literal decorations.
function hasPercentageFormat(format = "") {
  let quoted = false;
  for (let index = 0; index < format.length; index++) {
    const char = format[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "_" || char === "*") {
      index++;
      continue;
    }
    if (char === "[") {
      const end = format.indexOf("]", index + 1);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    if (char === "%") return true;
  }
  return false;
}
async function parseEngineering(tables, networks, workbook) {
  const { LOCATION_KINDS, DEMAND_KINDS, ADDRESS_MODES, validateEngineering } =
    await domain();
  const reverse = (map, value) =>
    Object.keys(map).find((k) => map[k] === value) || value;
  // Required numerics must remain invalid when empty; optional unknowns are null.
  const number = (v, nullable = false) =>
    v === "" ? (nullable ? null : NaN) : Number(v);
  const e = { version: 1, locations: [], demands: [], capacities: [] };
  const errors = [];
  const specs = [
    ["场地位置", "locations"],
    ["业务需求", "demands"],
    ["接入容量", "capacities"],
  ];
  for (let i = 0; i < 3; i++)
    for (const { row, values: v } of tables[i]) {
      for (const column of i === 1 ? [5, 6, 7, 8] : i === 2 ? [3] : []) {
        const cell = workbook.getWorksheet(specs[i][0]).getCell(row, column);
        if (v[column - 1] !== "" && hasPercentageFormat(cell.numFmt))
          throw new Error(
            `${specs[i][0]} 第 ${row} 行 ${cell.address}：不支持 Excel 百分比格式，请改用普通数字格式（20 表示增长 20%）；字面百分号请用引号格式`,
          );
      }
      const record =
        i === 0
          ? {
              id: v[0],
              parentId: v[1],
              kind: reverse(LOCATION_KINDS, v[2]),
              name: v[3],
              note: v[4],
            }
          : i === 1
            ? {
                id: v[0],
                locationId: v[1],
                name: v[2],
                kind: reverse(DEMAND_KINDS, v[3]),
                count: number(v[4], true),
                growthPercent: number(v[5]),
                addressesPerUnit: number(v[6]),
                portsPerUnit: number(v[7]),
                addressMode: reverse(ADDRESS_MODES, v[8]),
                networkId: v[9],
                note: v[10],
              }
            : {
                id: v[0],
                locationId: v[1],
                accessPorts: number(v[2], true),
                note: v[3],
              };
      e[specs[i][1]].push(record);
    }
  // Validate complete locations first (parents can occur later), then incrementally
  // attach demands/capacities so errors retain their workbook row.
  try {
    validateEngineering({ ...e, demands: [], capacities: [] }, networks);
  } catch (error) {
    errors.push(
      `场地位置 第 ${tables[0].map((r) => r.row).join("、")} 行：${error.message}`,
    );
  }
  if (!errors.length)
    for (let i = 1; i < 3; i++)
      for (let j = 0; j < tables[i].length; j++) {
        try {
          validateEngineering(
            {
              ...e,
              demands: i === 1 ? e.demands.slice(0, j + 1) : e.demands,
              capacities: i === 1 ? [] : e.capacities.slice(0, j + 1),
            },
            networks,
          );
        } catch (error) {
          errors.push(
            `${specs[i][0]} 第 ${tables[i][j].row} 行：${error.message}`,
          );
          break;
        }
      }
  return { engineering: e, errors };
}
async function choices(name) {
  const { LOCATION_KINDS, DEMAND_KINDS, ADDRESS_MODES } = await domain();
  return name === "场地位置"
    ? { 3: Object.values(LOCATION_KINDS) }
    : name === "业务需求"
      ? { 4: Object.values(DEMAND_KINDS), 9: Object.values(ADDRESS_MODES) }
      : {};
}
module.exports = { engineeringTables, parseEngineering, choices };
