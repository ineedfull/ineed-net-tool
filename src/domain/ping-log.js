import { formatDateTime } from "./date-time.js";

export function pingLogText(record) {
  const entries = record.pingLog?.length
    ? record.pingLog
    : (record.rows || [])
        .filter((row) => row.raw)
        .map((row) => ({
          seq: row.seq,
          startedAt: row.time,
          raw: row.raw,
        }));
  if (!entries.length) return "";
  const size = record.options?.payloadSize;
  const header = [
    `Ping 原始记录 · ${record.target || record.options?.target || ""}`,
    `数据载荷：${size == null ? "旧记录未指定（使用当时的系统默认值）" : `${size} 字节`}`,
    "保留最近 500 次请求；时间按本机时区显示，格式为 YYYY-MM-DD HH:mm:ss.SSS。每段是一次独立系统 Ping 的输出。",
  ].join("\n");
  return (
    header +
    "\n\n" +
    entries
      .map((entry) => {
        const lines = [
          `[${formatDateTime(entry.startedAt, "时间未记录")}] 请求 #${entry.seq}`,
        ];
        if (entry.command)
          lines.push(`$ ${entry.command} ${entry.args.join(" ")}`);
        if (entry.raw) lines.push(entry.raw.trimEnd());
        if (entry.stderr) lines.push(`[标准错误]\n${entry.stderr.trimEnd()}`);
        if (!entry.raw && !entry.stderr) lines.push("（系统未输出文本）");
        if (entry.finishedAt != null && entry.finishedAt !== "")
          lines.push(
            `结束：${formatDateTime(entry.finishedAt, "时间未记录")} · 退出码：${entry.code ?? "无"}${entry.timedOut ? " · 等待超时" : ""}${entry.cancelled ? " · 用户停止" : ""}`,
          );
        return lines.join("\n");
      })
      .join("\n\n")
  );
}
