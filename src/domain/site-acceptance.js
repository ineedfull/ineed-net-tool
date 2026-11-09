import { emptyEngineering, validateEngineering } from "./engineering.js";
import { validateNetworks } from "./workspace.js";

export const SITE_ACCEPTANCE_LIMITS = Object.freeze({
  items: 500,
  results: 2000,
  actions: 1000,
});
export const emptySiteAcceptance = () => ({
  version: 1,
  items: [],
  results: [],
  actions: [],
});
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function fail(message) {
  throw Error(`验收：${message}`);
}
function text(x, max, required = false) {
  if (typeof x !== "string" || x.length > max || (required && !x.trim()))
    fail("文本无效或过长");
}
function id(x, empty = false) {
  text(x, 100, !empty);
  if (/[\x00-\x1f\x7f-\x9f]/.test(x)) fail("标识含控制字符");
}
function integer(x, max) {
  if (!Number.isInteger(x) || x < 1 || x > max) fail("整数超出范围");
}
function choice(x, values) {
  if (!values.includes(x)) fail("枚举值无效");
}
function iso(x) {
  if (
    typeof x !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) ||
    !Number.isFinite(Date.parse(x)) ||
    new Date(x).toISOString() !== x
  )
    fail("时间无效");
}
function date(x) {
  text(x, 10);
  if (
    x &&
    (!/^\d{4}-\d\d-\d\d$/.test(x) ||
      !Number.isFinite(Date.parse(x + "T00:00:00.000Z")) ||
      new Date(x + "T00:00:00.000Z").toISOString().slice(0, 10) !== x)
  )
    fail("计划日期无效");
}
const semantic = ["targetType", "targetId", "method", "expected"];
function target(row, engineering) {
  choice(row.targetType, ["project", "device", "interface", "link"]);
  id(row.targetId, true);
  if (row.targetType === "project") {
    if (row.targetId !== "") fail("项目目标必须为空");
  } else if (
    !engineering.infrastructure?.[
      { device: "devices", interface: "interfaces", link: "links" }[
        row.targetType
      ]
    ]?.some((x) => x.id === row.targetId)
  )
    fail("目标不存在；请先处理验收关联再删除");
}
function criteria(row, engineering) {
  if (!object(row)) fail("要求快照无效");
  text(row.name, 100, true);
  target(row, engineering);
  choice(row.method, ["manual", "ping", "ports", "quality"]);
  text(row.expected, 1000, true);
}
function evidence(value, method, outcome) {
  if (method === "manual") {
    if (value !== null) fail("人工检查不能引用诊断");
    return;
  }
  if (!object(value) || value.version !== 1) fail("证据版本无效");
  id(value.sourceId);
  choice(value.kind, ["ping", "ports", "quality"]);
  if (value.kind !== method) fail("证据方法不匹配");
  choice(value.status, ["completed", "error", "stopped"]);
  if (outcome === "passed" && value.status !== "completed")
    fail("未完成诊断不能判定通过");
  text(value.target, 2048, true);
  iso(value.startedAt);
  iso(value.finishedAt);
  if (value.finishedAt < value.startedAt) fail("证据结束时间早于开始");
  text(value.parameters, 2048);
  text(value.detail, 1000);
  if (!Array.isArray(value.metrics) || value.metrics.length > 8)
    fail("证据指标无效");
  for (const metric of value.metrics) {
    if (!object(metric)) fail("指标无效");
    text(metric.label, 40, true);
    text(metric.unit, 16);
    if (
      metric.value !== null &&
      (typeof metric.value !== "number" ||
        !Number.isFinite(metric.value) ||
        metric.value < 0 ||
        metric.value > 1e15)
    )
      fail("指标数值无效");
  }
  const allowed = [
    "version",
    "sourceId",
    "kind",
    "target",
    "status",
    "startedAt",
    "finishedAt",
    "parameters",
    "metrics",
    "detail",
  ];
  if (
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    value.metrics.some((m) =>
      Object.keys(m).some((k) => !["label", "value", "unit"].includes(k)),
    )
  )
    fail("证据含非白名单字段");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8192)
    fail("证据超过8192字节");
}
export function validateSiteAcceptance(plan, engineering) {
  if (!object(plan) || plan.version !== 1) fail("不支持的数据版本");
  const inventory = engineering.infrastructure;
  const ids = new Set(
    [
      ...engineering.locations,
      ...engineering.demands,
      ...engineering.capacities,
      ...(inventory?.devices ?? []),
      ...(inventory?.interfaces ?? []),
      ...(inventory?.links ?? []),
      ...Object.values(inventory?.capacityPlanning ?? {})
        .filter(Array.isArray)
        .flat(),
    ].map((r) => r.id),
  );
  for (const [key, max] of Object.entries(SITE_ACCEPTANCE_LIMITS)) {
    if (!Array.isArray(plan[key]) || plan[key].length > max)
      fail(`${key}数量无效`);
    for (const row of plan[key]) {
      if (!object(row)) fail("记录无效");
      id(row.id);
      if (ids.has(row.id)) fail("记录标识重复");
      ids.add(row.id);
      text(row.note, 1000);
    }
  }
  const items = new Map(plan.items.map((r) => [r.id, r]));
  for (const row of plan.items) {
    criteria(row, engineering);
    integer(row.revision, 1000000);
    text(row.owner, 100);
  }
  const sequences = new Set();
  const results = new Map(plan.results.map((r) => [r.id, r]));
  for (const row of plan.results) {
    id(row.itemId);
    const item = items.get(row.itemId);
    if (!item) fail("结果关联检查项不存在");
    integer(row.itemRevision, item.revision);
    integer(row.sequence, 2147483647);
    if (sequences.has(row.sequence)) fail("结果序号重复");
    sequences.add(row.sequence);
    iso(row.measuredAt);
    text(row.operator, 100, true);
    text(row.actual, 2000, true);
    choice(row.outcome, ["passed", "failed", "inconclusive"]);
    criteria(row.criteria, engineering);
    text(row.criteria.targetLabel, 1000, true);
    if (
      row.itemRevision === item.revision &&
      semantic.some((k) => row.criteria[k] !== item[k])
    )
      fail("当前版结果要求不匹配");
    evidence(row.evidence, row.criteria.method, row.outcome);
  }
  for (const row of plan.actions) {
    id(row.itemId);
    id(row.failedResultId);
    id(row.resolvedByResultId, true);
    text(row.description, 2000, true);
    text(row.owner, 100);
    date(row.dueDate);
    const failed = results.get(row.failedResultId);
    if (
      !items.has(row.itemId) ||
      failed?.itemId !== row.itemId ||
      failed.outcome !== "failed"
    )
      fail("整改必须关联同项失败结果");
    if (row.resolvedByResultId) {
      const passed = results.get(row.resolvedByResultId);
      if (
        passed?.itemId !== row.itemId ||
        passed.outcome !== "passed" ||
        passed.sequence <= failed.sequence ||
        passed.itemRevision < failed.itemRevision
      )
        fail("闭环必须关联后续通过复验");
    }
  }
  return plan;
}
function context(project, networks) {
  const owned = networks.filter((n) => n.projectId === project.id);
  validateNetworks(owned);
  if (project.engineering !== undefined)
    validateEngineering(project.engineering, owned);
}
// Use the registered region name (not its full ancestry) so even two endpoints
// with maximum legal names fit the 1000-character historical snapshot bound.
export function acceptanceTargetLabel(row, project) {
  if (row.targetType === "project") return project.name || "项目";
  const engineering = project.engineering;
  const inventory = engineering?.infrastructure;
  const device = (id) => {
    const d = inventory?.devices.find((x) => x.id === id);
    if (!d) return "未登记设备";
    const area = engineering.locations.find((x) => x.id === d.locationId);
    return `${d.name} · ${area?.name || "未登记区域"}`;
  };
  const endpoint = (id) => {
    const port = inventory?.interfaces.find((x) => x.id === id);
    return port ? `${device(port.deviceId)} / ${port.name}` : "未登记接口";
  };
  if (row.targetType === "device") return device(row.targetId);
  if (row.targetType === "interface") return endpoint(row.targetId);
  const link = inventory?.links.find((x) => x.id === row.targetId);
  return link
    ? `${endpoint(link.fromInterfaceId)} → ${endpoint(link.toInterfaceId)}`
    : "未登记连接";
}
export function siteAcceptanceReport(project, networks = []) {
  context(project, networks);
  const plan = project.engineering?.siteAcceptance;
  const report = {
    enabled: plan !== undefined,
    status: "pending",
    items: [],
    results: [],
    actions: [],
    issues: [],
    counts: { total: 0, passed: 0, failed: 0, pending: 0, rectifying: 0 },
    basis: "引用快照 / 人工判定",
  };
  if (!plan) return report;
  report.results = structuredClone(plan.results);
  report.actions = structuredClone(plan.actions);
  for (const item of plan.items) {
    const results = report.results
        .filter((r) => r.itemId === item.id)
        .sort((a, b) => a.sequence - b.sequence),
      currentResults = results.filter((r) => r.itemRevision === item.revision),
      latest = currentResults.at(-1) ?? null,
      actions = report.actions.filter((a) => a.itemId === item.id),
      openActionCount = actions.filter((a) => !a.resolvedByResultId).length;
    const status =
      latest?.outcome === "failed"
        ? "failed"
        : latest?.outcome === "passed"
          ? openActionCount
            ? "rectifying"
            : "passed"
          : "pending";
    const row = {
      ...structuredClone(item),
      targetLabel: acceptanceTargetLabel(item, project),
      results,
      currentResults,
      historicalResults: results.filter(
        (r) => r.itemRevision !== item.revision,
      ),
      latestResult: latest,
      actual: latest?.actual ?? "",
      evidence: latest?.evidence ?? null,
      actions,
      openActionCount,
      status,
      requiresRetest: !latest && results.length > 0,
    };
    report.items.push(row);
    report.counts.total++;
    report.counts[status]++;
    if (status !== "passed")
      report.issues.push({
        itemId: item.id,
        severity:
          status === "failed" || status === "rectifying" ? "risk" : "pending",
        code: row.requiresRetest ? "criteria_changed" : status,
        message: row.requiresRetest
          ? "要求已变化，需复验"
          : status === "rectifying"
            ? "仍有开放整改"
            : status === "failed"
              ? "检查未通过"
              : "待登记当前要求结果",
      });
  }
  report.status =
    report.counts.failed || report.counts.rectifying
      ? "risk"
      : !report.counts.total || report.counts.pending
        ? "pending"
        : "ok";
  return report;
}
function edit(project, networks, operation) {
  context(project, networks);
  const next = structuredClone(project);
  next.engineering ??= emptyEngineering();
  next.engineering.siteAcceptance ??= emptySiteAcceptance();
  operation(next.engineering.siteAcceptance, next);
  context(next, networks);
  return next;
}
export function saveAcceptanceItem(project, input, networks = []) {
  return edit(project, networks, (plan) => {
    const index = plan.items.findIndex((r) => r.id === input.id),
      old = plan.items[index];
    const row = {
      ...input,
      revision: old
        ? old.revision + (semantic.some((k) => old[k] !== input[k]) ? 1 : 0)
        : 1,
    };
    if (old) plan.items[index] = row;
    else plan.items.push(row);
  });
}
// Native history stores normalized numeric options, plus the original ports text.
// Missing legacy parameters remain unknown; present malformed values never become text.
function captureParameters(input, method) {
  const options = input === undefined ? {} : input;
  if (!object(options)) fail("诊断参数格式无效");
  const bounds = {
    timeout: [100, 10000],
    interval: [200, 60000],
    count: method === "ping" ? [0, 10000] : [2, 300],
    payloadSize: [0, 65500],
    port: [1, 65535],
    concurrency: [1, 128],
  };
  const keys =
    method === "ping"
      ? ["interval", "count", "payloadSize", "timeout"]
      : method === "ports"
        ? ["ports", "portList", "timeout", "concurrency"]
        : ["method", "port", "count", "interval", "timeout"];
  function numeric(value, min, max) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    )
      fail("诊断参数数值无效");
  }
  return keys
    .filter((key) => options[key] !== undefined)
    .map((key) => {
      const value = options[key];
      if (key === "method") choice(value, ["icmp", "tcp"]);
      else if (key === "portList") {
        if (!Array.isArray(value) || !value.length || value.length > 65535)
          fail("诊断端口列表无效");
        for (const port of value) numeric(port, 1, 65535);
      } else if (key === "ports") {
        text(value, 20000, true);
        for (const part of value.split(/[,，]/)) {
          const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (!match) fail("诊断端口文本无效");
          const first = Number(match[1]),
            last = match[2] === undefined ? first : Number(match[2]);
          numeric(first, 1, 65535);
          numeric(last, first, 65535);
        }
      } else numeric(value, ...bounds[key]);
      return `${key}=${Array.isArray(value) ? value.join(",") : value}`;
    })
    .join("; ");
}
function capture(history, project, item, outcome) {
  if (
    !history ||
    history.projectId !== project.id ||
    history.kind !== item.method
  )
    fail("历史不属于本项目或方法不匹配");
  const parameters = captureParameters(history.options, item.method);
  const source = item.method === "ping" ? history : (history.summary ?? {});
  const metrics = (
    item.method === "ping"
      ? [
          ["completed", "sent", ""],
          ["received", "received", ""],
          ["loss", "loss", "%"],
          ["min", "min", "ms"],
          ["max", "max", "ms"],
          ["average", "average", "ms"],
        ]
      : item.method === "ports"
        ? ["open", "closed", "timeout", "error"].map((k) => [k, k, ""])
        : [
            "sent",
            "received",
            "failureRate",
            "min",
            "max",
            "average",
            "p95",
            "jitter",
          ].map((k) => [
            k,
            k,
            k === "failureRate"
              ? "%"
              : ["sent", "received"].includes(k)
                ? ""
                : "ms",
          ])
  ).map(([key, label, unit]) => ({
    label,
    unit,
    value:
      key === "loss"
        ? typeof history.completed === "number" &&
          history.completed > 0 &&
          typeof history.received === "number"
          ? ((history.completed - history.received) / history.completed) * 100
          : null
        : (source[key] ?? null),
  }));
  const value = {
    version: 1,
    sourceId: history.id,
    kind: history.kind,
    target: history.target,
    status: history.status,
    startedAt: history.startedAt,
    finishedAt: history.finishedAt,
    parameters,
    metrics,
    detail: history.error ?? "",
  };
  evidence(value, item.method, outcome);
  return value;
}
export function recordAcceptanceResult(
  project,
  input,
  history = [],
  networks = [],
) {
  return edit(project, networks, (plan, next) => {
    const item = plan.items.find((r) => r.id === input.itemId);
    if (!item) fail("检查项不存在");
    const { historyId, ...fields } = input;
    if (item.method === "manual" && historyId) fail("人工检查不能引用诊断");
    plan.results.push({
      ...fields,
      itemRevision: item.revision,
      sequence: Math.max(0, ...plan.results.map((r) => r.sequence)) + 1,
      criteria: Object.fromEntries(
        ["name", ...semantic]
          .map((k) => [k, item[k]])
          .concat([["targetLabel", acceptanceTargetLabel(item, next)]]),
      ),
      evidence:
        item.method === "manual"
          ? null
          : capture(
              history.find((r) => r.id === historyId),
              project,
              item,
              input.outcome,
            ),
    });
  });
}
export function saveAcceptanceAction(project, input, networks = []) {
  return edit(project, networks, (plan) => {
    if (input.resolvedByResultId) fail("请通过复验闭环操作关联结果");
    const index = plan.actions.findIndex((r) => r.id === input.id);
    if (index >= 0 && plan.actions[index].resolvedByResultId)
      fail("已闭环整改不能编辑");
    const row = { ...input, resolvedByResultId: "" };
    if (index >= 0) plan.actions[index] = row;
    else plan.actions.push(row);
  });
}
export function resolveAcceptanceAction(
  project,
  actionId,
  resultId,
  networks = [],
) {
  return edit(project, networks, (plan) => {
    const action = plan.actions.find((r) => r.id === actionId);
    if (!action || action.resolvedByResultId) fail("整改不存在或已闭环");
    const item = plan.items.find((r) => r.id === action.itemId),
      latest = plan.results
        .filter((r) => r.itemId === item.id && r.itemRevision === item.revision)
        .sort((a, b) => b.sequence - a.sequence)[0];
    if (latest?.id !== resultId || latest.outcome !== "passed")
      fail("请选择当前版最新通过复验");
    action.resolvedByResultId = resultId;
  });
}
export function remapSiteAcceptance(
  plan,
  maps,
  uuid = () => crypto.randomUUID(),
) {
  const ids = new Map(
    [...plan.items, ...plan.results, ...plan.actions].map((r) => [
      r.id,
      uuid(),
    ]),
  );
  const target = (r) => ({
    ...r,
    targetId:
      r.targetType === "project"
        ? ""
        : maps[
            { device: "devices", interface: "interfaces", link: "links" }[
              r.targetType
            ]
          ]?.get(r.targetId),
  });
  return {
    version: 1,
    items: plan.items.map((r) => ({ ...target(r), id: ids.get(r.id) })),
    results: plan.results.map((r) => ({
      ...structuredClone(r),
      id: ids.get(r.id),
      itemId: ids.get(r.itemId),
      criteria: target(r.criteria),
    })),
    actions: plan.actions.map((r) => ({
      ...r,
      id: ids.get(r.id),
      itemId: ids.get(r.itemId),
      failedResultId: ids.get(r.failedResultId),
      resolvedByResultId: r.resolvedByResultId
        ? ids.get(r.resolvedByResultId)
        : "",
    })),
  };
}
