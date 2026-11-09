const { spawn } = require("node:child_process");
const { lookup } = require("node:dns/promises");
const net = require("node:net");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { lookupTargetInfo } = require("./target-info.cjs");
const { TOOL_KINDS, prepareTool, runTool } = require("./network-tools.cjs");
const {
  DEFAULT_SCAN_CONCURRENCY,
  MAX_SCAN_CONCURRENCY,
  createProbeLimiter,
  probeHost,
} = require("./scan-probes.cjs");

function integer(value, min, max, label) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "")
    throw new Error(`${label}必须为 ${min}～${max} 的整数`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${label}必须为 ${min}～${max} 的整数`);
  return n;
}
function targetName(value) {
  const text = String(value ?? "").trim();
  if (net.isIPv4(text)) return text;
  if (
    text.length > 253 ||
    !text ||
    /^[\d.]+$/.test(text) ||
    !text
      .replace(/\.$/, "")
      .split(".")
      .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  )
    throw new Error("请输入 IPv4 地址或域名，不要包含协议、端口或命令参数");
  return text;
}
async function resolveTarget(value, signal) {
  if (signal?.aborted) throw new Error("任务已停止");
  const target = targetName(value);
  if (net.isIPv4(target)) return target;
  let timer, abort;
  try {
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error("任务已停止"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("域名解析超时")), 5000);
    });
    const { address } = await Promise.race([lookup(target, { family: 4 }), cancelled]);
    if (signal?.aborted) throw new Error("任务已停止");
    return address;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function runProcess(command, args, { signal, timeout = 5000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("任务已停止"));
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    let raw = "",
      pending = "",
      stderr = "",
      timedOut = false;
    const terminate = () => {
      child.kill();
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
    };
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    signal?.addEventListener("abort", terminate, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", terminate);
    };
    child.stdout.on("data", (buffer) => {
      const text = buffer.toString();
      raw = (raw + text).slice(-100000);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on("data", (buffer) => {
      stderr = (stderr + buffer.toString()).slice(-10000);
    });
    child.once("error", (error) => {
      cleanup();
      reject(new Error(`无法运行 ${command}：${error.message}`));
    });
    child.once("close", (code) => {
      cleanup();
      if (pending) onLine?.(pending);
      resolve({ code, raw, stderr, timedOut, cancelled: !!signal?.aborted });
    });
  });
}
function parsePing(raw) {
  const match = raw.match(/(?:time|时间)[=<]\s*([\d.]+)\s*ms/i);
  return match ? Number(match[1]) : null;
}
function pingPayloadSize(value) {
  const candidate = typeof value === "string" && !value.trim() ? NaN : value;
  return integer(candidate, 0, 65500, "数据载荷字节数");
}
function pingCommand(ip, timeout, payloadSize, platform = process.platform) {
  const win = platform === "win32";
  const darwin = platform === "darwin";
  const command = darwin ? "/sbin/ping" : "ping";
  const args = win
    ? ["-n", "1", "-w", String(timeout)]
    : [
        "-n",
        "-c",
        "1",
        "-W",
        String(darwin ? timeout : Math.ceil(timeout / 1000)),
      ];
  if (payloadSize !== undefined)
    args.push(win ? "-l" : "-s", String(pingPayloadSize(payloadSize)));
  return { command, args: [...args, ip] };
}
async function pingAddress(
  ip,
  timeout,
  signal,
  { processGraceMs = 700, payloadSize, onOutput } = {},
) {
  const { command, args } = pingCommand(ip, timeout, payloadSize);
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await runProcess(command, args, {
      signal,
      timeout: timeout + processGraceMs,
    });
  } catch (error) {
    onOutput?.({
      command,
      args,
      startedAt,
      finishedAt: new Date().toISOString(),
      raw: "",
      stderr: error.message,
      code: null,
      cancelled: !!signal?.aborted,
      timedOut: false,
    });
    throw error;
  }
  onOutput?.({
    ...result,
    command,
    args,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  if (result.cancelled) throw new Error("任务已停止");
  const ms = parsePing(result.raw);
  // Small payloads may not contain the timestamp needed for a measured RTT.
  const replied = ms !== null || /\bbytes from\b[^\r\n]*\b(?:icmp_)?seq[=\s]/i.test(result.raw)
    || /\bTTL[=\s]+\d+/i.test(result.raw);
  if (/permission|not permitted|operation not permitted/i.test(result.stderr))
    throw new Error("系统拒绝 ICMP 探测权限，可改用 TCP 探测");
  if (result.code !== 0 && result.stderr.trim() && !result.timedOut)
    throw new Error(result.stderr.trim());
  return {
    ip,
    status: replied ? "reachable" : "no-response",
    ms,
    method: "ICMP",
    detail: replied ? (ms !== null ? "收到 ICMP 回应" : "收到 ICMP 回应，系统未提供耗时") : "超时或未收到 ICMP 回应",
    raw: (result.raw + result.stderr).trim(),
  };
}
function tcpProbe(ip, port, timeout, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("任务已停止"));
    const start = performance.now();
    const socket = new net.Socket();
    const abort = () => finish(null, new Error("任务已停止"));
    let done = false;
    function finish(result, error) {
      if (done) return;
      done = true;
      socket.destroy();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    }
    const evidence = (detail) => ({
      ip,
      status: "reachable",
      ms: performance.now() - start,
      method: `TCP ${port}`,
      detail,
    });
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(timeout, () => finish(null));
    socket.once("connect", () => finish(evidence("端口开放")));
    socket.once("error", (error) =>
      finish(
        error.code === "ECONNREFUSED"
          ? evidence("收到连接拒绝：有响应，端口未开放")
          : null,
      ),
    );
    socket.connect(port, ip);
  });
}
function parseHop(line) {
  const hop = line.match(/^\s*(\d+)\s+(.+)$/);
  if (!hop) return null;
  const ip = hop[2].match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
  const times = [...hop[2].matchAll(/([\d.]+)\s*ms/gi)].map((m) =>
    Number(m[1]),
  );
  const unreachable = /![A-Z]/.test(hop[2]);
  return {
    hop: Number(hop[1]),
    ip,
    ms: times[0] ?? null,
    status: ip ? (unreachable ? "unreachable" : "reachable") : "no-response",
    detail: unreachable
      ? "节点返回不可达"
      : ip
        ? "节点有响应"
        : "该跳未响应，仍继续探测",
    raw: line.trim(),
  };
}
function interfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    entries
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({
        name,
        ip: entry.address,
        cidr: entry.cidr,
        mask: entry.netmask,
        mac: entry.mac,
      })),
  );
}

class NetworkTasks {
  constructor(emit, onComplete = async () => {}, { scanProbes, identifyTarget } = {}) {
    this.tasks = new Map();
    this.emit = emit;
    this.onComplete = onComplete;
    this.identifyTarget = identifyTarget || ((ip, signal) => lookupTargetInfo(ip, {signal, run:runProcess}));
    this.scanProbes = scanProbes || {
      ping: (ip, timeout, signal) =>
        pingAddress(ip, timeout, signal, { processGraceMs: 50 }),
      tcp: tcpProbe,
    };
  }
  async start(kind, input) {
    if (!["scan", "ping", "route", ...TOOL_KINDS].includes(kind))
      throw new Error("未知任务类型");
    if ([...this.tasks.values()].some((task) => task.kind === kind))
      throw new Error("请先停止当前任务");
    const options = {
      ...input,
      timeout: integer(input.timeout ?? 1000, 100, 10000, "超时毫秒"),
    };
    let addresses;
    if (TOOL_KINDS.includes(kind)) {
      Object.assign(options, prepareTool(kind, input));
      options.timeout = integer(input.timeout ?? 5000, 100, 10000, "超时毫秒");
    } else if (kind === "scan") {
      const { scanRange, SCAN_BATCH_SIZE } =
        await import("../src/domain/ipv4.js");
      addresses = scanRange(input.target);
      options.batchSize = SCAN_BATCH_SIZE;
      options.concurrency = integer(
        input.concurrency ?? DEFAULT_SCAN_CONCURRENCY,
        1,
        MAX_SCAN_CONCURRENCY,
        "并发数",
      );
      options.method = input.method || "icmp";
      if (!["icmp", "tcp", "combined"].includes(options.method))
        throw new Error("未知探测方式");
      options.ports =
        options.method === "icmp"
          ? []
          : String(input.ports || "80,443")
              .split(",")
              .map((p) => integer(p.trim(), 1, 65535, "端口"));
      if (options.ports.length > 8) throw new Error("每次最多检查 8 个端口");
      options.ports = [...new Set(options.ports)];
    } else {
      options.target = targetName(input.target);
      if (kind === "ping") {
        options.interval = integer(
          input.interval ?? 1000,
          200,
          60000,
          "间隔毫秒",
        );
        options.count = integer(input.count ?? 0, 0, 10000, "次数（0 为持续）");
        options.payloadSize = pingPayloadSize(input.payloadSize ?? 56);
      } else {
        options.maxHops = integer(input.maxHops ?? 20, 1, 64, "最大跳数");
      }
    }
    // Validation above may yield; check again before installing the job.
    if ([...this.tasks.values()].some((task) => task.kind === kind))
      throw new Error("请先停止当前任务");
    const task = {
      id: randomUUID(),
      kind,
      options,
      target: options.target,
      controller: new AbortController(),
      paused: false,
      status: "running",
      startedAt: new Date().toISOString(),
      startedMonotonic: performance.now(),
      pendingRows: [],
      rowTimer: null,
      rows: [],
      raw: "",
      pingLog: [],
      total: addresses?.length ?? options.total ?? options.count ?? 0,
      completed: 0,
      received: 0,
      latencySamples: 0,
      sum: 0,
      min: null,
      max: null,
    };
    this.tasks.set(task.id, task);
    setImmediate(() => this.execute(task, addresses));
    return { id: task.id };
  }
  // Metadata is a snapshot; result rows are appended only through row/rows.
  // See src/domain/task-events.js for the shared renderer merge contract.
  publish(task, extra = {}) {
    this.emit({
      id: task.id,
      kind: task.kind,
      status: task.status,
      completed: task.completed,
      total: task.total,
      received: task.received,
      min: task.min,
      max: task.max,
      average: task.latencySamples ? task.sum / task.latencySamples : null,
      target: task.target,
      resolvedIp: task.resolvedIp,
      ...(TOOL_KINDS.includes(task.kind) ? { summary: task.summary } : {}),
      ...(task.kind === "ping" ? { targetInfo: task.targetInfo } : {}),
      startedAt: task.startedAt,
      elapsedMs:
        task.elapsedMs ?? Math.round(performance.now() - task.startedMonotonic),
      ...(task.kind === "scan"
        ? {
            concurrency: task.options.concurrency,
            batch: task.batch || 0,
            batchCount: Math.ceil(task.total / task.options.batchSize),
            batchSize: task.options.batchSize,
          }
        : {}),
      ...extra,
    });
  }
  flushRows(task) {
    clearTimeout(task.rowTimer);
    task.rowTimer = null;
    if (task.pendingRows.length)
      this.publish(task, { rows: task.pendingRows.splice(0) });
  }
  row(task, data) {
    const row = {
      ...data,
      time: new Date().toISOString(),
      seq: ++task.completed,
    };
    if (row.status === "reachable") {
      task.received += 1;
      if (Number.isFinite(row.ms)) {
        task.latencySamples += 1;
        task.sum += row.ms;
        task.min = Math.min(task.min ?? row.ms, row.ms);
        task.max = Math.max(task.max ?? row.ms, row.ms);
      }
    }
    task.rows.push(row);
    if (!["scan", "ports", "dns"].includes(task.kind) && task.rows.length > 500) task.rows.shift();
    if (["scan", "ports"].includes(task.kind)) {
      task.pendingRows.push(row);
      if (task.pendingRows.length >= 64) this.flushRows(task);
      else if (!task.rowTimer)
        task.rowTimer = setTimeout(() => this.flushRows(task), 50);
    } else this.publish(task, { row });
  }
  async execute(task, addresses) {
    const signal = task.controller.signal;
    let finalStatus;
    let targetInfoPromise;
    this.publish(task);
    try {
      if (signal.aborted) throw new Error("任务已停止");
      if (TOOL_KINDS.includes(task.kind)) await runTool(task, {
        publish: this.publish.bind(this), row: this.row.bind(this), resolveTarget, pingAddress,
      });
      else if (task.kind === "scan") await this.scan(task, addresses);
      else {
        task.resolvedIp = await resolveTarget(task.target, signal);
        if (signal.aborted) throw new Error("任务已停止");
        this.publish(task);
        if (task.kind === "ping") {
          task.targetInfo = { ip: task.resolvedIp, status: "loading" };
          this.publish(task);
          targetInfoPromise = Promise.resolve().then(() => {
            if (signal.aborted) throw new Error("任务已停止");
            return this.identifyTarget(task.resolvedIp, signal);
          })
            .then(info => { task.targetInfo = info; this.publish(task); })
            .catch(() => { task.targetInfo = {ip: task.resolvedIp, status: "partial", detail: signal.aborted ? "查询已取消" : "设备信息暂时无法获取"}; this.publish(task); });
          await this.ping(task);
        }
        else await this.route(task);
      }
      finalStatus = signal.aborted ? "stopped" : "completed";
    } catch (error) {
      finalStatus = signal.aborted ? "stopped" : "error";
      if (!signal.aborted) task.error = error.message;
    }
    task.elapsedMs = Math.round(performance.now() - task.startedMonotonic);
    // Queries run alongside probes, then settle before the history snapshot is saved.
    await targetInfoPromise;
    if (signal.aborted) finalStatus = "stopped";
    // Drain result deltas, attempt history persistence, then send the final
    // status with the successfully saved record. Consumers merge that record
    // instead of repeatedly loading every previous result. saveError keeps
    // persistence failure separate from the probe outcome.
    this.flushRows(task);
    task.finishedAt = new Date().toISOString();
    let historyRecord;
    try {
      const record = {
        id: task.id,
        projectId: task.options.projectId,
        kind: task.kind,
        target: task.target,
        resolvedIp: task.resolvedIp,
        status: finalStatus,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        completed: task.completed,
        received: task.received,
        total: task.total,
        min: task.min,
        max: task.max,
        average: task.latencySamples ? task.sum / task.latencySamples : null,
        error: task.error,
        reached: task.reached,
        elapsedMs: task.elapsedMs,
        options: task.options,
        rows: task.rows,
        raw: task.raw,
        ...(TOOL_KINDS.includes(task.kind) ? { summary: task.summary } : {}),
        ...(task.kind === "ping" ? { pingLog: task.pingLog, targetInfo: task.targetInfo } : {}),
      };
      await this.onComplete(record);
      historyRecord = record;
    } catch (error) {
      task.saveError = `记录保存失败：${error.message}。请先导出结果备份，再重新测试或关闭应用。`;
    }
    this.tasks.delete(task.id);
    task.status = finalStatus;
    this.publish(task, {
      error: task.error,
      saveError: task.saveError,
      reached: task.reached,
      finishedAt: task.finishedAt,
      historyRecord,
    });
  }
  async scan(task, addresses) {
    const { ipText } = await import("../src/domain/ipv4.js");
    const { signal } = task.controller;
    const options = task.options;
    const limit = createProbeLimiter();
    for (
      let start = 0;
      start < addresses.length && !signal.aborted;
      start += options.batchSize
    ) {
      while (task.paused && !signal.aborted) await task.pausePromise;
      if (signal.aborted) break;
      let next = start;
      const end = Math.min(start + options.batchSize, addresses.length);
      task.batch = Math.floor(start / options.batchSize) + 1;
      this.publish(task);
      await Promise.all(
        Array.from(
          { length: Math.min(options.concurrency, end - start) },
          async () => {
            while (!signal.aborted) {
              while (task.paused && !signal.aborted) await task.pausePromise;
              if (signal.aborted || next >= end) return;
              const address = addresses.first + next++;
              const ip = ipText(address);
              try {
                const result = await probeHost(
                  ip,
                  options,
                  signal,
                  this.scanProbes,
                  limit,
                );
                if (!signal.aborted) this.row(task, { ...result, address });
              } catch (error) {
                if (!signal.aborted)
                  this.row(task, {
                    ip,
                    address,
                    status: "error",
                    ms: null,
                    detail: error.message,
                  });
              }
            }
          },
        ),
      );
      this.flushRows(task);
      // Yield between batches even when every probe resolves immediately.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  async ping(task) {
    const { signal } = task.controller;
    while (
      !signal.aborted &&
      (!task.options.count || task.completed < task.options.count)
    ) {
      const start = performance.now();
      const result = await pingAddress(
        task.resolvedIp,
        task.options.timeout,
        signal,
        {
          payloadSize: task.options.payloadSize,
          onOutput: (output) => {
            const entry = { ...output, seq: task.completed + 1 };
            task.pingLog.push(entry);
            if (task.pingLog.length > 500) task.pingLog.shift();
            this.publish(task, { pingLogEntry: entry });
          },
        },
      );
      if (signal.aborted) break;
      this.row(task, result);
      if (task.options.count && task.completed >= task.options.count) break;
      await delay(
        Math.max(0, task.options.interval - (performance.now() - start)),
        null,
        { signal },
      );
    }
  }
  async route(task) {
    const win = process.platform === "win32";
    const command = win
      ? "tracert"
      : process.platform === "darwin"
        ? "/usr/sbin/traceroute"
        : "traceroute";
    const args = win
      ? [
          "-d",
          "-h",
          String(task.options.maxHops),
          "-w",
          String(task.options.timeout),
          task.resolvedIp,
        ]
      : [
          "-n",
          "-m",
          String(task.options.maxHops),
          "-w",
          String(Math.max(1, Math.ceil(task.options.timeout / 1000))),
          "-q",
          "1",
          task.resolvedIp,
        ];
    const result = await runProcess(command, args, {
      signal: task.controller.signal,
      timeout:
        task.options.maxHops *
          (Math.max(1000, task.options.timeout) + 1000) *
          (win ? 3 : 1) +
        5000,
      onLine: (line) => {
        if (task.controller.signal.aborted) return;
        task.raw = (task.raw + line + "\n").slice(-100000);
        const hop = parseHop(line);
        if (hop) this.row(task, hop);
        this.publish(task, { raw: task.raw });
      },
    });
    task.raw = (result.raw + result.stderr).slice(-100000);
    this.publish(task, { raw: task.raw });
    if (result.cancelled) return;
    if (result.timedOut)
      throw new Error("路由探测达到时间上限，已保留已有节点");
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || "路由探测执行失败");
    task.reached = task.rows.some(
      (row) => row.ip === task.resolvedIp && row.status === "reachable",
    );
  }
  control(id, action) {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (action === "stop") {
      task.status = "stopping";
      task.controller.abort();
      task.resumeScan?.();
    } else if (
      task.kind === "scan" &&
      ["pause", "resume"].includes(action) &&
      !task.controller.signal.aborted
    ) {
      if (action === "pause" && !task.paused)
        task.pausePromise = new Promise((resolve) => {
          task.resumeScan = resolve;
        });
      task.paused = action === "pause";
      task.status = task.paused ? "paused" : "running";
      if (!task.paused) {
        task.resumeScan?.();
        task.resumeScan = null;
      }
    } else throw new Error("不支持的任务操作");
    this.publish(task);
    return true;
  }
  stopAll() {
    for (const task of this.tasks.values()) {
      task.controller.abort();
      task.resumeScan?.();
    }
  }
}
module.exports = {
  integer,
  targetName,
  resolveTarget,
  parsePing,
  parseHop,
  pingCommand,
  pingAddress,
  tcpProbe,
  interfaces,
  NetworkTasks,
};
