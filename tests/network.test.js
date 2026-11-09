import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import native from "../electron/network.cjs";
const { targetName, parsePing, parseHop, NetworkTasks, tcpProbe } = native;
test("targets cannot contain command flags or shell fragments", () => {
  for (const name of ["127.0.0.1", "example.com", "localhost"])
    assert.equal(targetName(name), name);
  for (const value of [
    "-i 0.01",
    "127.0.0.1;echo x",
    "http://example.com",
    "127.1",
    "999.0.0.1",
    "a\nb",
  ])
    assert.throws(() => targetName(value));
});
test("native parsers recognize response, silence and unreachable route markers", () => {
  assert.equal(
    parsePing("64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.052 ms"),
    0.052,
  );
  assert.equal(parsePing("100% packet loss"), null);
  assert.deepEqual(parseHop(" 2  *"), {
    hop: 2,
    ip: "",
    ms: null,
    status: "no-response",
    detail: "该跳未响应，仍继续探测",
    raw: "2  *",
  });
  assert.equal(parseHop(" 1  127.0.0.1  0.137 ms").ip, "127.0.0.1");
  assert.equal(parseHop(" 3  10.0.0.1  3.2 ms !H").status, "unreachable");
});
test("TCP probes record local open and refused ports as distinct evidence", async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const open = await tcpProbe("127.0.0.1", port, 500);
  assert.equal(open.detail, "端口开放");
  await new Promise((resolve) => server.close(resolve));
  const refused = await tcpProbe("127.0.0.1", port, 500);
  assert.equal(refused.status, "reachable");
  assert.match(refused.detail, /连接拒绝/);
});
async function waitFor(predicate, timeout = 7000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout)
      throw new Error("task deadline exceeded");
    await delay(20);
  }
}
test("real loopback ping completes and persists a result before final event", async () => {
  const events = [],
    saved = [];
  const tasks = new NetworkTasks(
    (event) => events.push(event),
    async (record) => saved.push(record),
  );
  await tasks.start("ping", {
    target: "127.0.0.1",
    timeout: 500,
    interval: 200,
    count: 2,
  });
  await waitFor(() => saved.length === 1 && tasks.tasks.size === 0);
  assert.equal(saved[0].status, "completed");
  assert.equal(saved[0].received, 2);
  assert.equal(saved[0].options.payloadSize, 56);
  assert.equal(saved[0].pingLog.length, 2);
  assert.match(
    saved[0].pingLog[0].raw,
    /56 data bytes|56 bytes of data|bytes=56/,
  );
  assert.equal(events.at(-1).status, "completed");
  assert.deepEqual(events.at(-1).historyRecord, saved[0], "Final event carries exactly the successfully saved record");
  assert.ok(saved[0].rows.every((row) => row.ms !== null));
});
test(
  "real loopback traceroute reaches its target",
  { skip: process.platform !== "darwin" },
  async () => {
    const saved = [];
    const tasks = new NetworkTasks(
      () => {},
      async (record) => saved.push(record),
    );
    await tasks.start("route", {
      target: "127.0.0.1",
      timeout: 1000,
      maxHops: 3,
    });
    await waitFor(() => saved.length === 1);
    assert.equal(saved[0].status, "completed");
    assert.equal(saved[0].reached, true);
    assert.equal(saved[0].rows[0].ip, "127.0.0.1");
  },
);
test("stop terminates a continuous ping and prevents further rows", async () => {
  const events = [],
    saved = [];
  const tasks = new NetworkTasks(
    (e) => events.push(e),
    async (r) => saved.push(r),
  );
  const { id } = await tasks.start("ping", {
    target: "127.0.0.1",
    timeout: 500,
    interval: 200,
    count: 0,
  });
  await waitFor(() => events.some((e) => e.row));
  tasks.control(id, "stop");
  await waitFor(() => saved.length === 1 && tasks.tasks.size === 0);
  const rowCount = events.filter((e) => e.row).length;
  await delay(250);
  assert.equal(saved[0].status, "stopped");
  assert.equal(events.filter((e) => e.row).length, rowCount);
});
test("scan pauses dispatch, resumes, and preserves all loopback results", async () => {
  const events = [],
    saved = [];
  const tasks = new NetworkTasks(
    (e) => events.push(e),
    async (r) => saved.push(r),
  );
  const { id } = await tasks.start("scan", {
    target: "127.0.0.1-127.0.0.3",
    method: "tcp",
    ports: "1",
    timeout: 200,
    concurrency: 1,
  });
  tasks.control(id, "pause");
  await delay(150);
  assert.equal(events.flatMap((e) => e.rows || []).length, 0);
  tasks.control(id, "resume");
  await waitFor(() => saved.length === 1);
  assert.equal(saved[0].completed, 3);
  assert.equal(
    saved[0].rows.find((row) => row.ip === "127.0.0.1").status,
    "reachable",
  );
  assert.equal(saved[0].rows.length, 3);
});
test("invalid task settings fail before scheduling", async () => {
  const tasks = new NetworkTasks(() => {});
  await assert.rejects(
    tasks.start("ping", { target: "127.0.0.1", interval: 0 }),
  );
  await assert.rejects(tasks.start("scan", { target: "0.0.0.0/0" }));
  await assert.rejects(
    tasks.start("scan", { target: "127.0.0.1", method: "tcp", ports: "0" }),
  );
  assert.equal(tasks.tasks.size, 0);
});

test("custom and zero-byte Ping payloads are sent and raw output is retained", async () => {
  for (const payloadSize of [0, 1472]) {
    const saved = [];
    const tasks = new NetworkTasks(
      () => {},
      async (record) => saved.push(record),
    );
    await tasks.start("ping", {
      target: "127.0.0.1",
      timeout: 1000,
      interval: 200,
      count: 1,
      payloadSize,
    });
    await waitFor(() => saved.length === 1);
    assert.equal(saved[0].status, "completed");
    assert.equal(saved[0].options.payloadSize, payloadSize);
    assert.equal(saved[0].pingLog.length, 1);
    assert.equal(saved[0].pingLog[0].code, 0);
    assert.ok(saved[0].pingLog[0].raw.includes(String(payloadSize)));
    assert.ok(saved[0].rows[0].raw);
  }
});
