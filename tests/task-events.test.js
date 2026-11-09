import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeTaskEvent,
  isTerminalTaskStatus,
} from "../src/domain/task-events.js";

test("a late event from another task cannot replace the current results", () => {
  const task = { id: "current", status: "running", rows: [] };
  assert.equal(
    mergeTaskEvent(task, {
      id: "previous",
      status: "completed",
      row: { seq: 1 },
    }),
    false,
  );
  assert.deepEqual(task, { id: "current", status: "running", rows: [] });
  assert.equal(mergeTaskEvent(undefined, { id: "previous" }), false);
});

test("an initial event binds identity and appends a batch without keeping delta fields", () => {
  const task = { status: "starting", rows: [] };
  const first = { seq: 1 },
    second = { seq: 2 };
  assert.equal(
    mergeTaskEvent(task, {
      id: "scan-1",
      kind: "scan",
      status: "running",
      completed: 2,
      rows: [first, second],
    }),
    true,
  );
  assert.equal(task.id, "scan-1");
  assert.equal(task.completed, 2);
  assert.deepEqual(task.rows, [first, second]);
  assert.equal(Object.hasOwn(task, "row"), false);
});

test("scan, port and DNS results stay complete while other tools retain the latest 500 rows", () => {
  const rows = Array.from({ length: 501 }, (_, seq) => ({ seq }));
  for (const kind of ["scan", "ports", "dns", "ping", "route", "quality"]) {
    const task = { rows: [] };
    mergeTaskEvent(task, { id: kind, kind, rows });
    assert.equal(
      task.rows.length,
      ["scan", "ports", "dns"].includes(kind) ? 501 : 500,
      kind,
    );
    assert.equal(task.rows.at(-1).seq, 500);
  }
});

test("ping raw entries are separate from rows and preparation preserves object identity", () => {
  const task = {
    id: "ping-1",
    rows: [],
    pingLog: Array.from({ length: 500 }, (_, seq) => ({ seq })),
  };
  const row = { seq: 501 },
    entry = { raw: "reply" },
    prepared = [];
  mergeTaskEvent(
    task,
    { id: "ping-1", kind: "ping", row, pingLogEntry: entry },
    {
      prepareRow(value) {
        prepared.push(value);
        return value;
      },
    },
  );
  assert.equal(task.rows[0], row);
  assert.equal(task.pingLog.length, 500);
  assert.equal(task.pingLog.at(-1), entry);
  assert.deepEqual(prepared, [entry, row]);
  assert.equal(Object.hasOwn(task, "pingLogEntry"), false);
});

test("a final event keeps completed rows and distinguishes history persistence failure", () => {
  const task = { id: "speed-1", rows: [{ seq: 1 }], status: "running" };
  const summary = { bytes: 32, reason: "stopped" };
  mergeTaskEvent(task, {
    id: "speed-1",
    kind: "speed",
    status: "stopped",
    summary,
    saveError: "disk full",
  });
  assert.deepEqual(task.rows, [{ seq: 1 }]);
  assert.equal(task.summary, summary);
  assert.equal(task.status, "stopped");
  assert.equal(task.saveError, "disk full");
  for (const status of ["completed", "stopped", "error"])
    assert.equal(isTerminalTaskStatus(status), true);
  for (const status of ["idle", "starting", "running", "paused", "stopping"])
    assert.equal(isTerminalTaskStatus(status), false);
});

test("saved history is separate from the live task and is not retained as task metadata", () => {
  const task = { id: "ports-1", rows: [{ seq: 1 }], status: "running" };
  mergeTaskEvent(task, { id: "ports-1", kind: "ports", status: "completed", historyRecord: { id: "ports-1", rows: [{ seq: 1 }] } });
  assert.equal(Object.hasOwn(task, "historyRecord"), false);
  assert.deepEqual(task.rows, [{ seq: 1 }]);
});
