const domain = () => import("../src/domain/capacity-planning.js");
const code = (prefix, n) => prefix + String(n + 1).padStart(3, "0");
async function capacityTables(project, networks) {
  const { capacityPlanningReport } = await domain();
  const report = capacityPlanningReport(project, networks);
  const i = project.engineering?.infrastructure,
    p = i?.capacityPlanning;
  const maps = {};
  for (const [key, prefix, rows] of [
    ["devices", "E", i?.devices],
    ["ports", "P", i?.interfaces],
    ["links", "C", i?.links],
    ["powerBudgets", "S", p?.powerBudgets],
    ["poeLoads", "Q", p?.poeLoads],
    ["uplinks", "U", p?.uplinks],
    ["trafficDemands", "T", p?.trafficDemands],
  ])
    maps[key] = new Map((rows || []).map((r, n) => [r.id, code(prefix, n)]));
  const get = (key, id) => maps[key].get(id) || "";
  const status = {
    ok: "按已登记参数估算满足",
    pending: "待补充",
    risk: "已登记参数不足",
  };
  const rows = [];
  for (const r of report.powerBudgets)
    rows.push([
      "整机电源",
      get("powerBudgets", r.id),
      get("devices", r.deviceId),
      "",
      r.name,
      "W",
      r.knownWatts,
      r.usableWatts,
      r.remainingWatts,
      r.unknownCount,
      `预算${r.budgetWatts ?? "未知"}W × (100 - ${r.reservePercent ?? "未知"}%)/100，向下取整0.001W；已知需求为逐负载向上取整后之和`,
      status[r.status],
      report.basis,
    ]);
  for (const r of report.poeLoads)
    rows.push([
      "PoE负载",
      get("poeLoads", r.id),
      get("links", r.linkId),
      "",
      "",
      "W",
      r.requiredWatts,
      r.portBudgetWatts,
      r.remainingWatts,
      r.requiredWatts === null ? 1 : 0,
      `${r.deviceWatts ?? "未知"}W × (100 + ${r.lossPercent ?? "未知"}%)/100，向上取整0.001W`,
      status[r.status],
      report.basis,
    ]);
  for (const r of report.uplinks)
    for (const direction of ["forward", "reverse"]) {
      const d = r[direction];
      rows.push([
        "上联方向",
        get("uplinks", r.id),
        get("links", r.linkId),
        direction === "forward" ? "正向" : "反向",
        "",
        "Mbps",
        d.knownMbps,
        r.usableMbps,
        d.remainingMbps,
        d.unknownCount,
        `min(${r.fromMbps ?? "未知"},${r.toMbps ?? "未知"})Mbps × (100 - ${r.reservePercent}%)/100，向下取整0.001Mbps；本方向${d.demandCount}项业务；已知上界${r.knownUpperBoundMbps ?? "未知"}Mbps`,
        status[d.status],
        report.basis,
      ]);
    }
  for (const r of report.trafficDemands)
    rows.push([
      "业务",
      get("trafficDemands", r.id),
      get("uplinks", r.uplinkId),
      r.direction === "forward" ? "正向" : "反向",
      r.name,
      "Mbps",
      r.requiredMbps,
      "",
      "",
      r.requiredMbps === null ? 1 : 0,
      `(${r.count ?? "未知"} + ceil(${r.count ?? "未知"} × ${r.growthPercent}/100)) × ${r.mbpsPerUnit ?? "未知"}Mbps × ${r.concurrencyPercent ?? "未知"}%/100，向上取整0.001Mbps；规划数量${r.plannedCount ?? "未知"}`,
      status[r.status],
      report.basis,
    ]);
  for (const issue of report.issues) {
    let local = "";
    for (const key of ["powerBudgets", "poeLoads", "uplinks", "trafficDemands"])
      local ||= get(key, issue.recordId);
    rows.push([
      "问题",
      local,
      get("devices", issue.deviceId),
      issue.direction === "forward"
        ? "正向"
        : issue.direction === "reverse"
          ? "反向"
          : "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      status[issue.severity],
      issue.message,
    ]);
  }
  return [
    (p?.powerBudgets || []).map((r) => [
      get("powerBudgets", r.id),
      get("devices", r.deviceId),
      r.budgetWatts,
      r.reservePercent,
      r.note,
    ]),
    (p?.poeLoads || []).map((r) => [
      get("poeLoads", r.id),
      get("links", r.linkId),
      get("ports", r.sourceInterfaceId),
      get("ports", r.targetInterfaceId),
      r.portBudgetWatts,
      r.deviceWatts,
      r.lossPercent,
      r.note,
    ]),
    (p?.uplinks || []).map((r) => [
      get("uplinks", r.id),
      get("links", r.linkId),
      get("ports", r.fromInterfaceId),
      get("ports", r.toInterfaceId),
      r.fromMbps,
      r.toMbps,
      r.reservePercent,
      r.note,
    ]),
    (p?.trafficDemands || []).map((r) => [
      get("trafficDemands", r.id),
      get("uplinks", r.uplinkId),
      r.name,
      r.direction === "forward" ? "正向" : "反向",
      r.count,
      r.mbpsPerUnit,
      r.concurrencyPercent,
      r.growthPercent,
      r.note,
    ]),
    rows,
  ];
}
// Excel percent formats: ignore quoted/escaped literal percent, reject active tokens in every section.
function percentFormat(format = "") {
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
function readCell(cell, spec, column, row) {
  const v = cell.value;
  const fail = (message) => {
    throw new Error(`${spec.name} 第 ${row} 行 ${cell.address}：${message}`);
  };
  if (typeof v === "string" && v.length > 32767) fail("单格超过32767字符");
  if (spec.numericColumns?.includes(column)) {
    if (percentFormat(cell.numFmt)) fail("不能使用百分比格式");
    if (v === null || v === undefined || v === "") return "";
    if (!["string", "number"].includes(typeof v))
      fail("仅支持普通数字或十进制文本");
    const s = typeof v === "string" ? v.trim() : String(v);
    if (!/^\d+(?:\.\d{1,3})?$/.test(s) || !Number.isFinite(Number(s)))
      fail("数字格式或精度无效");
    return s;
  }
  if (v === null || v === undefined) return "";
  if (typeof v !== "string")
    fail("请填写文本，不支持数字、公式、链接、富文本或日期");
  return v.trim();
}
async function parseCapacity(tables, engineering, linkCodes) {
  const { emptyCapacityPlanning, validateCapacityPlanning } = await domain();
  const p = emptyCapacityPlanning();
  const i = engineering.infrastructure;
  const taken = new Set(
    [
      ...engineering.locations,
      ...engineering.demands,
      ...engineering.capacities,
      ...i.devices,
      ...i.interfaces,
      ...i.links,
    ].map((r) => r.id),
  );
  let next = 1;
  const maps = tables.map(() => new Map());
  for (let n = 0; n < 4; n++)
    for (const { values: v } of tables[n]) {
      if (
        !v[0] ||
        v[0].length > 100 ||
        /[\x00-\x1f\x7f-\x9f]/.test(v[0]) ||
        maps[n].has(v[0])
      )
        throw new Error("容量校核：本地编号无效或重复");
      let id;
      do {
        id = `excel-capacity-${next++}`;
      } while (taken.has(id));
      taken.add(id);
      maps[n].set(v[0], id);
    }
  const num = (v) => (v === "" ? null : Number(v));
  const link = (v) => {
    if (!linkCodes.has(v)) throw new Error("容量校核：连接编号不存在");
    return linkCodes.get(v);
  };
  p.powerBudgets = tables[0].map(({ values: v }) => ({
    id: maps[0].get(v[0]),
    deviceId: v[1],
    budgetWatts: num(v[2]),
    reservePercent: num(v[3]),
    note: v[4],
  }));
  p.poeLoads = tables[1].map(({ values: v }) => ({
    id: maps[1].get(v[0]),
    linkId: link(v[1]),
    sourceInterfaceId: v[2],
    targetInterfaceId: v[3],
    portBudgetWatts: num(v[4]),
    deviceWatts: num(v[5]),
    lossPercent: num(v[6]),
    note: v[7],
  }));
  p.uplinks = tables[2].map(({ values: v }) => ({
    id: maps[2].get(v[0]),
    linkId: link(v[1]),
    fromInterfaceId: v[2],
    toInterfaceId: v[3],
    fromMbps: num(v[4]),
    toMbps: num(v[5]),
    reservePercent: num(v[6]),
    note: v[7],
  }));
  p.trafficDemands = tables[3].map(({ values: v }) => ({
    id: maps[3].get(v[0]),
    uplinkId: maps[2].get(v[1]),
    name: v[2],
    direction: v[3] === "正向" ? "forward" : v[3] === "反向" ? "reverse" : v[3],
    count: num(v[4]),
    mbpsPerUnit: num(v[5]),
    concurrencyPercent: num(v[6]),
    growthPercent: num(v[7]),
    note: v[8],
  }));
  validateCapacityPlanning(p, i, engineering);
  return p;
}
module.exports = { capacityTables, readCell, parseCapacity, percentFormat };
