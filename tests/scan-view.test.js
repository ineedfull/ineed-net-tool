import test from "node:test";
import assert from "node:assert/strict";
import { scanGridGroups } from "../src/domain/scan-view.js";
import {
  emptyWorkspace,
  normalizeWorkspace,
  validateWorkspace,
} from "../src/domain/projects.js";

test("compact grid includes bounded target addresses and distinguishes pending from silence", () => {
  const rows = [
    { ip: "192.168.1.2", status: "reachable", ms: 0 },
    { ip: "192.168.1.3", status: "no-response", ms: null },
    { ip: "192.168.1.4", status: "error", detail: "permission denied" },
  ];
  const [group] = scanGridGroups("192.168.1.1-192.168.1.4", rows, "running");
  assert.equal(group.prefix, "192.168.1");
  assert.deepEqual(
    group.cells.map((c) => c.status),
    ["pending", "reachable", "no-response", "error"],
  );
  assert.equal(group.cells[1].result.ms, 0);
  assert.equal(
    scanGridGroups("192.168.1.1", [], "stopped")[0].cells[0].status,
    "unfinished",
  );
  assert.equal(
    scanGridGroups("192.168.1.1", [], "idle")[0].cells[0].status,
    "untested",
  );
});
test("compact grid groups larger subnets without duplicate labels in a block or including excluded endpoints", () => {
  const groups = scanGridGroups("10.0.0.0/23", [], "idle");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].cells[0].ip, "10.0.0.1");
  assert.equal(groups[0].cells.at(-1).ip, "10.0.0.255");
  assert.equal(groups[1].cells[0].ip, "10.0.1.0");
  assert.equal(groups[1].cells.at(-1).ip, "10.0.1.254");
  for (const g of groups)
    assert.equal(new Set(g.cells.map((c) => c.suffix)).size, g.cells.length);
  assert.equal(scanGridGroups("10.0.0.0/31", [], "idle")[0].cells.length, 2);
  assert.equal(scanGridGroups("10.0.0.1/32", [], "idle")[0].cells.length, 1);
  assert.throws(() => scanGridGroups("0.0.0.0/0", [], "idle"), /65,536/);
});
test("older SQLite workspaces receive a table default and invalid preferences fail validation", () => {
  const legacy = emptyWorkspace();
  delete legacy.settings.ipView;
  assert.equal(normalizeWorkspace(legacy).settings.ipView, "table");
  assert.equal(legacy.settings.ipView, undefined);
  const compact = emptyWorkspace();
  compact.settings.ipView = "compact";
  assert.equal(normalizeWorkspace(compact).settings.ipView, "compact");
  compact.settings.ipView = "bad";
  assert.throws(() => validateWorkspace(compact), /默认显示方式/);
});
