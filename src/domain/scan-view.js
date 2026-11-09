import { ipNumber, ipText, scanRange } from "./ipv4.js";

export const SCAN_CELL_STATUSES = {
  reachable: "有响应",
  "no-response": "无响应",
  error: "探测错误",
  pending: "待返回",
  untested: "未探测",
  unfinished: "未完成",
};

// Block metadata is cheap; only the selected block needs cell objects.
export function scanBlocks(target) {
  const range = scanRange(target);
  const blocks = [];
  for (let base = Math.floor(range.first / 256) * 256; base <= range.last; base += 256) {
    blocks.push({ prefix: ipText(base).slice(0, -2), first: Math.max(base, range.first), last: Math.min(base + 255, range.last) });
  }
  return blocks;
}
export function scanGridCells(block, results, status) {
  if (!block) return [];
  const pendingStatus = ["starting", "running", "paused", "stopping"].includes(
    status,
  )
    ? "pending"
    : status === "idle"
      ? "untested"
      : "unfinished";
  const cells = [];
  for (let value = block.first; value <= block.last; value++) {
    const ip = ipText(value);
    const result = results.get(ip);
    cells.push({
      ip,
      suffix: ipNumber(ip) % 256,
      status: result?.status || pendingStatus,
      result,
    });
  }
  return cells;
}
export function scanGridGroups(target, rows, status) {
  const results = new Map(rows.map(row => [row.ip, row]));
  return scanBlocks(target).map(block => ({ ...block, cells: scanGridCells(block, results, status) }));
}
