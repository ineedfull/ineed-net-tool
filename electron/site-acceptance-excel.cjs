const { percentFormat } = require("./capacity-planning-excel.cjs");
const domain = () => import("../src/domain/site-acceptance.js");
const types = {
  project: "项目",
  device: "设备",
  interface: "接口",
  link: "连接",
};
const methods = {
  manual: "人工",
  ping: "Ping",
  ports: "端口",
  quality: "链路质量",
};
const outcomes = { passed: "通过", failed: "未通过", inconclusive: "无法判定" };
const statuses = {
  pending: "待验收",
  failed: "未通过",
  rectifying: "整改中",
  passed: "通过",
};
const code = (prefix, n) => prefix + String(n + 1).padStart(3, "0");
const reverse = (map, value) =>
  Object.keys(map).find((k) => map[k] === value) || value;
async function acceptanceTables(project, networks) {
  const { siteAcceptanceReport } = await domain();
  const report = siteAcceptanceReport(project, networks);
  const a = project.engineering?.siteAcceptance,
    i = project.engineering?.infrastructure;
  const maps = {};
  for (const [key, prefix, rows] of [
    ["items", "K", a?.items],
    ["results", "R", a?.results],
    ["actions", "X", a?.actions],
    ["device", "E", i?.devices],
    ["interface", "P", i?.interfaces],
    ["link", "C", i?.links],
  ])
    maps[key] = new Map((rows || []).map((r, n) => [r.id, code(prefix, n)]));
  const get = (key, id) => maps[key]?.get(id) || "";
  const criteria = (r) =>
    JSON.stringify({
      ...r.criteria,
      targetType: types[r.criteria.targetType],
      targetId: get(r.criteria.targetType, r.criteria.targetId),
      method: methods[r.criteria.method],
    });
  const evidence = (r) =>
    r.evidence === null ? "" : JSON.stringify(r.evidence);
  const rows = [];
  const { formatDateTime } = await import("../src/domain/date-time.js");
  for (const r of report.items)
    rows.push([
      "检查项",
      get("items", r.id),
      get("items", r.id),
      r.name,
      r.targetLabel,
      methods[r.method],
      r.revision,
      "",
      r.expected,
      r.actual,
      statuses[r.status],
      r.owner,
      "",
      "",
      "",
      "",
      "",
      r.note,
      report.basis,
    ]);
  for (const r of report.results)
    rows.push([
      "结果",
      get("results", r.id),
      get("items", r.itemId),
      r.criteria.name,
      r.criteria.targetLabel,
      methods[r.criteria.method],
      r.itemRevision,
      r.sequence,
      r.criteria.expected,
      r.actual,
      outcomes[r.outcome],
      r.operator,
      formatDateTime(r.measuredAt),
      "",
      "",
      criteria(r),
      evidence(r),
      r.note,
      report.basis,
    ]);
  for (const r of report.actions)
    rows.push([
      "整改",
      get("actions", r.id),
      get("items", r.itemId),
      r.description,
      "",
      "",
      "",
      "",
      "",
      r.description,
      r.resolvedByResultId ? "已闭环" : "未闭环",
      r.owner,
      r.dueDate,
      get("results", r.failedResultId),
      get("results", r.resolvedByResultId),
      "",
      "",
      r.note,
      report.basis,
    ]);
  for (const r of report.issues)
    rows.push([
      "问题",
      "",
      get("items", r.itemId),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      r.severity,
      "",
      "",
      "",
      "",
      "",
      "",
      r.message,
      report.basis,
    ]);
  return [
    (a?.items || []).map((r) => [
      get("items", r.id),
      r.revision,
      r.name,
      types[r.targetType],
      get(r.targetType, r.targetId),
      methods[r.method],
      r.expected,
      r.owner,
      r.note,
    ]),
    (a?.results || []).map((r) => [
      get("results", r.id),
      get("items", r.itemId),
      r.itemRevision,
      r.sequence,
      r.measuredAt,
      r.operator,
      outcomes[r.outcome],
      r.actual,
      r.note,
      criteria(r),
      evidence(r),
    ]),
    (a?.actions || []).map((r) => [
      get("actions", r.id),
      get("items", r.itemId),
      get("results", r.failedResultId),
      r.description,
      r.owner,
      r.dueDate,
      r.note,
      get("results", r.resolvedByResultId),
    ]),
    rows,
  ];
}
// Reuse the established percent-token parser, then require exact integer values.
function readCell(cell, spec, column, row) {
  const v = cell.value,
    fail = (message) => {
      throw new Error(`${spec.name} 第 ${row} 行 ${cell.address}：${message}`);
    };
  if (typeof v === "string" && v.length > 32767) fail("单格超过32767字符");
  if (percentFormat(cell.numFmt)) fail("不能使用百分比格式");
  if (spec.numericColumns.includes(column)) {
    require("./capacity-planning-excel.cjs").readCell(cell, spec, column, row);
    if (v == null || v === "") return "";
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || v < 0) fail("必须是安全十进制整数");
      return v;
    }
    if (
      typeof v !== "string" ||
      !/^\d+$/.test(v) ||
      !Number.isSafeInteger(Number(v))
    )
      fail("必须是严格十进制整数文本");
    return Number(v);
  }
  if (v == null) return "";
  if (typeof v !== "string")
    fail("请填写普通文本，不支持数字、公式、链接、富文本、日期或布尔值");
  return v;
}
async function parseAcceptance(tables, engineering, linkCodes) {
  const { emptySiteAcceptance, validateSiteAcceptance } = await domain();
  const a = emptySiteAcceptance();
  const taken = new Set();
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string") taken.add(value.id);
    for (const v of Object.values(value))
      if (v && typeof v === "object") collect(v);
  };
  collect(engineering);
  let next = 1;
  const maps = tables.map(() => new Map());
  for (let n = 0; n < 3; n++)
    for (const { values: v } of tables[n]) {
      if (
        !v[0].trim() ||
        v[0].length > 100 ||
        /[\x00-\x1f\x7f-\x9f]/.test(v[0]) ||
        maps[n].has(v[0])
      )
        throw new Error("现场验收：本地编号无效或重复");
      let id;
      do {
        id = `excel-acceptance-${next++}`;
      } while (taken.has(id));
      taken.add(id);
      maps[n].set(v[0], id);
    }
  const ref = (n, value, empty = false) => {
    if (empty && value === "") return "";
    if (!maps[n].has(value)) throw new Error("现场验收：关联编号不存在");
    return maps[n].get(value);
  };
  const target = (type, id) => {
    if (type === "link") {
      if (!linkCodes.has(id)) throw new Error("现场验收：连接编号不存在");
      return linkCodes.get(id);
    }
    return id;
  };
  a.items = tables[0].map(({ values: v }) => {
    const type = reverse(types, v[3]);
    return {
      id: ref(0, v[0]),
      revision: v[1],
      name: v[2],
      targetType: type,
      targetId: target(type, v[4]),
      method: reverse(methods, v[5]),
      expected: v[6],
      owner: v[7],
      note: v[8],
    };
  });
  a.results = tables[1].map(({ values: v }) => {
    const c = JSON.parse(v[9]);
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new Error("现场验收：要求快照必须为对象");
    const type = reverse(types, c.targetType);
    return {
      id: ref(1, v[0]),
      itemId: ref(0, v[1]),
      itemRevision: v[2],
      sequence: v[3],
      measuredAt: v[4],
      operator: v[5],
      outcome: reverse(outcomes, v[6]),
      actual: v[7],
      note: v[8],
      criteria: {
        ...c,
        targetType: type,
        targetId: target(type, c.targetId),
        method: reverse(methods, c.method),
      },
      evidence: v[10] === "" ? null : JSON.parse(v[10]),
    };
  });
  a.actions = tables[2].map(({ values: v }) => ({
    id: ref(2, v[0]),
    itemId: ref(0, v[1]),
    failedResultId: ref(1, v[2]),
    description: v[3],
    owner: v[4],
    dueDate: v[5],
    note: v[6],
    resolvedByResultId: ref(1, v[7], true),
  }));
  validateSiteAcceptance(a, engineering);
  return a;
}
function choices(name) {
  return name === "验收清单"
    ? { 4: Object.values(types), 6: Object.values(methods) }
    : name === "验收结果"
      ? { 7: Object.values(outcomes) }
      : {};
}
module.exports = { acceptanceTables, readCell, parseAcceptance, choices };
