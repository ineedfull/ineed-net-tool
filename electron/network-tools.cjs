// Validates and dispatches the extra diagnostic tools. Download/TLS modules own
// their transport resources; these exports retain the existing native API.
const net = require("node:net");
const {
  certificateDetails,
  inspectCertificate,
} = require("./certificate-check.cjs");
const { downloadUrl, measureDownload } = require("./download-speed.cjs");
const { Resolver } = require("node:dns/promises");
const { domainToASCII } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");
const TOOL_KINDS = ["dns", "ports", "quality", "speed", "certificate"];
const DNS_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SOA",
  "SRV",
  "CAA",
  "PTR",
];

function number(value, min, max, name) {
  const result = Number(value);
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === "" ||
    !Number.isInteger(result) ||
    result < min ||
    result > max
  )
    throw new Error(`${name}必须为 ${min}～${max} 的整数`);
  return result;
}
function hostname(value) {
  const text = domainToASCII(String(value || "").trim()).replace(/\.$/, "");
  if (net.isIPv4(text)) return text;
  if (
    !text ||
    text.length > 253 ||
    /^[\d.]+$/.test(text) ||
    !text
      .split(".")
      .every((part) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part))
  )
    throw new Error("请输入有效的域名或 IPv4 地址，不包含协议、路径或端口");
  return text;
}
function dnsName(value) {
  const text = domainToASCII(String(value || "").trim()).replace(/\.$/, "");
  if (
    !text ||
    text.length > 253 ||
    !text
      .split(".")
      .every((label) => /^[a-z\d_](?:[a-z\d_-]{0,61}[a-z\d_])?$/i.test(label))
  )
    throw new Error("请输入有效的 DNS 查询名称");
  return text;
}
function parsePorts(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 20000)
    throw new Error("请输入端口，例如 22,80,443,8000-8100");
  const ports = new Set();
  for (const part of text.split(/[,，]/)) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("端口格式无效，请使用逗号或连续范围");
    const first = number(match[1], 1, 65535, "端口");
    const last = match[2] ? number(match[2], 1, 65535, "端口") : first;
    if (last < first) throw new Error("端口范围起点不能大于终点");
    for (let port = first; port <= last; port++) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
function prepareTool(kind, input) {
  const options = { ...input };
  if (kind === "dns") {
    options.recordType = String(input.recordType || "A").toUpperCase();
    if (!DNS_TYPES.includes(options.recordType))
      throw new Error("不支持的 DNS 记录类型");
    options.target =
      options.recordType === "PTR" && net.isIP(String(input.target).trim())
        ? String(input.target).trim()
        : dnsName(input.target);
    if (options.recordType === "PTR" && !net.isIP(options.target))
      throw new Error("PTR 查询请输入 IP 地址");
    options.server = String(input.server || "").trim();
    // Resolver validates optional IP:port notation without making a query.
    if (options.server) {
      try {
        new Resolver().setServers([options.server]);
      } catch {
        throw new Error("DNS 服务器请输入 IP，可附带端口，例如 192.168.1.1:53");
      }
    }
    options.total = 0;
  } else if (kind === "speed") {
    options.target = downloadUrl(input.target);
    options.duration = number(input.duration ?? 15, 1, 60, "测速秒数");
    options.maxMiB = number(input.maxMiB ?? 64, 1, 256, "最大下载量 MiB");
    options.total = 0;
  } else {
    options.target = hostname(input.target);
    if (kind === "ports") {
      options.portList = parsePorts(input.ports);
      options.concurrency = number(input.concurrency ?? 64, 1, 128, "并发数");
      options.total = options.portList.length;
    } else if (kind === "quality") {
      options.method = input.method || "icmp";
      if (!["icmp", "tcp"].includes(options.method))
        throw new Error("链路测试仅支持 ICMP 或 TCP");
      options.port = number(input.port ?? 443, 1, 65535, "端口");
      options.count = number(input.count ?? 20, 2, 300, "采样次数");
      options.interval = number(input.interval ?? 1000, 200, 60000, "请求间隔");
      options.total = options.count;
    } else if (kind === "certificate") {
      options.port = number(input.port ?? 443, 1, 65535, "TLS 端口");
      options.servername = input.servername
        ? hostname(input.servername)
        : options.target;
      options.warnDays = number(input.warnDays ?? 30, 1, 365, "到期提醒天数");
      options.total = 1;
    }
  }
  return options;
}
function connectPort(ip, port, timeout, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("任务已停止"));
    const socket = new net.Socket();
    const start = performance.now();
    let done = false;
    const abort = () => finish(null, new Error("任务已停止"));
    const timer = setTimeout(() => finish("timeout"), timeout);
    function finish(state, error, diagnostic = "") {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (signal.aborted || error) reject(error || new Error("任务已停止"));
      else
        resolve({
          ip,
          port,
          state,
          status: state === "open" ? "reachable" : state,
          ms: performance.now() - start,
          detail:
            diagnostic ||
            {
              open: "TCP 连接成功",
              closed: "连接被目标拒绝",
              timeout: "超时，可能被过滤或无响应",
              error: "连接错误",
            }[state],
        });
    }
    signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => finish("open"));
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") finish("closed");
      else if (error.code === "ETIMEDOUT") finish("timeout");
      else finish("error", null, `连接错误：${error.code || error.message}`);
    });
    socket.connect(port, ip);
  });
}
function qualityStats(rows) {
  const good = rows.filter(
    (row) => row.status === "reachable" && Number.isFinite(row.ms),
  );
  const values = good.map((row) => row.ms).sort((a, b) => a - b);
  let previous = null,
    sum = 0,
    differences = 0;
  for (const row of rows) {
    if (row.status !== "reachable" || !Number.isFinite(row.ms)) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      sum += Math.abs(row.ms - previous);
      differences++;
    }
    previous = row.ms;
  }
  return {
    sent: rows.length,
    received: good.length,
    failureRate: rows.length
      ? ((rows.length - good.length) / rows.length) * 100
      : 0,
    min: values[0] ?? null,
    max: values.at(-1) ?? null,
    average: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    p95: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null,
    jitter: differences ? sum / differences : null,
  };
}
async function queryDns(options, signal) {
  const resolver = new Resolver({ timeout: options.timeout, tries: 1 });
  if (options.server) resolver.setServers([options.server]);
  const abort = () => resolver.cancel();
  if (signal.aborted) throw new Error("任务已停止");
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeout);
  const started = performance.now();
  try {
    let answers;
    if (options.recordType === "A")
      answers = await resolver.resolve4(options.target, { ttl: true });
    else if (options.recordType === "AAAA")
      answers = await resolver.resolve6(options.target, { ttl: true });
    else if (options.recordType === "PTR")
      answers = await resolver.reverse(options.target);
    else answers = await resolver.resolve(options.target, options.recordType);
    return {
      answers: Array.isArray(answers) ? answers : [answers],
      servers: resolver.getServers(),
      ms: performance.now() - started,
    };
  } catch (error) {
    const reasons = {
      ENODATA: "未找到该类型记录",
      ENOTFOUND: "域名不存在或未找到记录",
      ETIMEOUT: "DNS 查询超时",
      ECANCELLED: signal.aborted ? "任务已停止" : "DNS 查询超时",
      EREFUSED: "DNS 服务器拒绝查询",
      ESERVFAIL: "DNS 服务器处理失败",
    };
    throw new Error(
      reasons[error.code] || `DNS 查询失败：${error.code || error.message}`,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
async function runTool(task, { publish, row, resolveTarget, pingAddress }) {
  const options = task.options,
    signal = task.controller.signal;
  if (signal.aborted) throw new Error("任务已停止");
  if (task.kind === "dns") {
    const result = await queryDns(options, signal);
    if (signal.aborted) return;
    task.total = result.answers.length;
    task.summary = {
      servers: result.servers,
      queryMs: result.ms,
      recordType: options.recordType,
      count: result.answers.length,
    };
    for (const value of result.answers)
      row(task, {
        status: "reachable",
        recordType: options.recordType,
        value,
        ms: result.ms,
      });
    publish(task);
    return;
  }
  if (task.kind === "speed") {
    task.summary = await measureDownload(options, signal, (result) => {
      task.summary = result;
      publish(task);
    });
    return;
  }
  task.resolvedIp = await resolveTarget(options.target, signal);
  if (signal.aborted) throw new Error("任务已停止");
  publish(task);
  if (task.kind === "certificate") {
    task.summary = await inspectCertificate(task.resolvedIp, options, signal);
    if (!signal.aborted)
      row(task, {
        ip: task.resolvedIp,
        status: task.summary.valid ? "reachable" : "invalid",
        detail: task.summary.valid
          ? "证书检查通过"
          : "证书存在有效期、域名或信任问题",
      });
  } else if (task.kind === "ports") {
    task.summary = { open: 0, closed: 0, timeout: 0, error: 0 };
    // Bound both active sockets and the queued work; yield after each batch.
    for (
      let offset = 0;
      offset < options.portList.length && !signal.aborted;
      offset += 256
    ) {
      let next = offset;
      const end = Math.min(offset + 256, options.portList.length);
      await Promise.all(
        Array.from(
          { length: Math.min(options.concurrency, end - offset) },
          async () => {
            while (next < end && !signal.aborted) {
              const port = options.portList[next++];
              const result = await connectPort(
                task.resolvedIp,
                port,
                options.timeout,
                signal,
              ).catch((error) => {
                if (!signal.aborted) throw error;
              });
              if (result && !signal.aborted) {
                task.summary[result.state]++;
                row(task, result);
              }
            }
          },
        ),
      );
      await new Promise((resolve) => setImmediate(resolve));
    }
  } else if (task.kind === "quality") {
    for (let index = 0; index < options.count && !signal.aborted; index++) {
      const began = performance.now();
      let result;
      try {
        result =
          options.method === "icmp"
            ? await pingAddress(task.resolvedIp, options.timeout, signal)
            : await connectPort(
                task.resolvedIp,
                options.port,
                options.timeout,
                signal,
              );
      } catch (error) {
        if (signal.aborted) break;
        result = {
          ip: task.resolvedIp,
          status: "error",
          ms: null,
          detail: error.message,
        };
      }
      if (signal.aborted) break;
      task.summary = qualityStats([...task.rows, result]);
      row(task, result);
      if (index + 1 < options.count)
        await delay(
          Math.max(0, options.interval - (performance.now() - began)),
          null,
          { signal },
        );
    }
  }
}
module.exports = {
  TOOL_KINDS,
  DNS_TYPES,
  prepareTool,
  parsePorts,
  connectPort,
  qualityStats,
  queryDns,
  certificateDetails,
  inspectCertificate,
  measureDownload,
  runTool,
};
