import test from "node:test";
import assert from "node:assert/strict";
import { pingLogText } from "../src/domain/ping-log.js";
import { formatDateTime } from "../src/domain/date-time.js";
import native from "../electron/network.cjs";

test("Ping size maps to native platform flags without changing scan defaults", () => {
  for (const [platform, flag, wait] of [
    ["win32", "-l", "1200"],
    ["darwin", "-s", "1200"],
    ["linux", "-s", "2"],
  ]) {
    for (const size of [0, 56, 1472, 65500]) {
      const { args } = native.pingCommand("127.0.0.1", 1200, size, platform);
      assert.equal(args[args.indexOf(flag) + 1], String(size));
      assert.equal(
        args[args.indexOf(platform === "win32" ? "-w" : "-W") + 1],
        wait,
      );
      assert.equal(args.at(-1), "127.0.0.1");
    }
    assert.equal(
      native
        .pingCommand("127.0.0.1", 1200, undefined, platform)
        .args.includes(flag),
      false,
    );
  }
});

test("invalid Ping sizes reject before scheduling any process", async () => {
  const tasks = new native.NetworkTasks(() => {});
  for (const payloadSize of [
    -1,
    65501,
    1.5,
    "-s 100",
    "oops",
    "",
    " ",
    Infinity,
  ]) {
    await assert.rejects(
      tasks.start("ping", { target: "127.0.0.1", payloadSize }),
      /数据载荷字节数/,
    );
  }
  assert.equal(tasks.tasks.size, 0);
});

test("raw log preserves stderr, cancellation, timeout and zero-byte payload", () => {
  const text = pingLogText({
    target: "127.0.0.1",
    options: { payloadSize: 0 },
    pingLog: [
      {
        seq: 1,
        startedAt: new Date(2026, 8, 22, 14, 8, 36, 7).toISOString(),
        finishedAt: new Date(2026, 8, 22, 14, 8, 37, 125).toISOString(),
        command: "ping",
        args: ["-s", "0", "127.0.0.1"],
        raw: "original output\n",
        stderr: "original error\n",
        code: null,
        cancelled: true,
        timedOut: true,
      },
    ],
  });
  for (const part of [
    "0 字节",
    "original output",
    "original error",
    "用户停止",
    "等待超时",
    "ping -s 0 127.0.0.1",
    "[2026-09-22 14:08:36.007] 请求 #1",
    "结束：2026-09-22 14:08:37.125",
  ])
    assert.ok(text.includes(part));
});

test("old history exposes stored row output without inventing packet size", () => {
  const text = pingLogText({
    rows: [{ seq: 1, time: "old-time", raw: "old raw" }],
  });
  assert.ok(text.includes("old raw"));
  assert.ok(text.includes("旧记录未指定"));
  assert.ok(text.includes("[时间未记录]"));
  assert.equal(formatDateTime(null), "--");
  assert.equal(formatDateTime(""), "--");
  assert.equal(formatDateTime("bad-date"), "--");
  assert.equal(pingLogText({ rows: [] }), "");
});

test("Ping raw log includes a recorded finish at epoch zero", () => {
  const text = pingLogText({ pingLog: [{ seq: 1, startedAt: 0, finishedAt: 0, code: 0, raw: "original output" }] });
  assert.ok(text.includes("结束："));
  assert.ok(text.includes("退出码：0"));
  assert.ok(text.includes("original output"));
});
