import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, validateWorkspace } from "../src/domain/projects.js";
import { emptyEngineering } from "../src/domain/engineering.js";
test("workspace rejects invalid optional acceptance version", () => {
  const state = emptyWorkspace();
  state.projects[0].engineering = {
    ...emptyEngineering(),
    siteAcceptance: { version: 99, items: [], results: [], actions: [] },
  };
  assert.throws(() => validateWorkspace(state), /验收/);
});
import * as acceptance from "../src/domain/site-acceptance.js";
import {
  project,
  item,
  result,
  action,
  history,
} from "./helpers/site-acceptance.js";
const report = (p) => acceptance.siteAcceptanceReport(p);
const save = (p, x = item()) => acceptance.saveAcceptanceItem(p, x);
const record = (p, x = result(), h = []) =>
  acceptance.recordAcceptanceResult(p, x, h);
test("manual lifecycle retains history and requires explicit later pass closure", () => {
  const original = project();
  let p = save(original);
  assert.equal(original.engineering, undefined);
  assert.equal(report(p).status, "pending");
  p = record(p);
  p = acceptance.saveAcceptanceAction(p, action());
  p = record(p, result({ id: "r2", outcome: "passed" }));
  assert.equal(report(p).counts.rectifying, 1);
  assert.throws(
    () => acceptance.resolveAcceptanceAction(p, "a1", "r1"),
    /验收/,
  );
  p = acceptance.resolveAcceptanceAction(p, "a1", "r2");
  assert.equal(report(p).status, "ok");
  p = record(p, result({ id: "r3" }));
  assert.equal(report(p).counts.failed, 1);
  p = save(p, item({ name: "改名" }));
  assert.equal(report(p).items[0].revision, 1);
  p = save(p, item({ expected: "更严格" }));
  assert.equal(report(p).items[0].revision, 2);
  assert.equal(report(p).items[0].requiresRetest, true);
  assert.equal(report(p).status, "pending");
  assert.equal(report(p).results.length, 3);
  assert.throws(() => acceptance.saveAcceptanceAction(p, action()), /验收/);
});
test("diagnostic snapshots whitelist and preserve zero/null; reject wrong history and nonterminal pass", () => {
  let p = save(project(), item({ method: "ping" }));
  for (const h of [
    history({ projectId: "foreign" }),
    history({ kind: "ports" }),
    history({ status: "running" }),
    history({ id: "" }),
    history({ finishedAt: "yesterday" }),
    history({ status: "error" }),
    history({ status: "stopped" }),
  ])
    assert.throws(
      () => record(p, result({ outcome: "passed", historyId: h.id }), [h]),
      /验收/,
    );
  p = record(p, result({ historyId: "h" }), [history({ min: null })]);
  const e = report(p).results[0].evidence;
  assert.equal(e.metrics.find((x) => x.label === "min").value, null);
  assert.equal(e.metrics.find((x) => x.label === "max").value, 0);
  assert.equal(e.raw, undefined);
  assert.equal(e.options, undefined);
  assert.equal(report(p).results[0].evidence.sourceId, "h");
});
test("manual capture rejects a supplied diagnostic history reference", () => {
  assert.throws(
    () => record(save(project()), result({ historyId: "h" }), [history()]),
    /验收/,
  );
});
import {
  remapEngineering,
  validateEngineering,
} from "../src/domain/engineering.js";
test("strict types, timestamps, dates, unique ids and snapshot bounds are validated", () => {
  const p = record(save(project()));
  const base = p.engineering;
  const mutate = (fn) => {
    const e = structuredClone(base);
    fn(e.siteAcceptance);
    assert.throws(() => validateEngineering(e), /验收/);
  };
  for (const field of ["name", "owner", "note", "expected"])
    mutate((a) => (a.items[0][field] = 12));
  for (const value of [
    "2026-02-30T00:00:00.000Z",
    "2026-10-27T00:00:00Z",
    null,
  ])
    mutate((a) => (a.results[0].measuredAt = value));
  for (const value of [0, 1.1, 2147483648, "1"])
    mutate((a) => (a.results[0].sequence = value));
  mutate((a) => (a.results[0].id = a.items[0].id));
  mutate((a) => (a.items = []));
  mutate((a) => (a.results[0].criteria.expected = "different"));
  mutate(
    (a) =>
      (a.items = Array.from({ length: 501 }, (_, i) => ({
        ...a.items[0],
        id: `i${i}`,
      }))),
  );
  const d = record(
    save(project(), item({ method: "quality" })),
    result({ historyId: "h" }),
    [
      history({
        kind: "quality",
        options: { count: 2 },
        summary: { sent: 0, received: 0, min: null },
      }),
    ],
  );
  for (const change of [
    (e) => e.metrics.push(...Array(9).fill({ label: "x", value: 0, unit: "" })),
    (e) => (e.metrics[0].value = NaN),
    (e) => (e.parameters = "x".repeat(2049)),
    (e) => (e.detail = "汉".repeat(1000) + "x"),
    (e) => (e.raw = "x"),
  ]) {
    const copy = structuredClone(d.engineering);
    change(copy.siteAcceptance.results[0].evidence);
    assert.throws(() => validateEngineering(copy), /验收/);
  }
  assert.throws(
    () => acceptance.saveAcceptanceAction(p, action({ dueDate: "2026-02-30" })),
    /验收/,
  );
});
test("all outcomes and explicit empty/missing data remain distinct; stale pass cannot close", () => {
  assert.equal(report(project()).enabled, false);
  const empty = {
    ...project(),
    engineering: {
      ...emptyEngineering(),
      siteAcceptance: acceptance.emptySiteAcceptance(),
    },
  };
  assert.equal(report(empty).enabled, true);
  assert.equal(report(empty).status, "pending");
  let p = record(save(project()));
  p = acceptance.saveAcceptanceAction(p, action());
  p = record(p, result({ id: "r2", outcome: "passed" }));
  p = record(p, result({ id: "r3", outcome: "inconclusive" }));
  assert.equal(report(p).counts.pending, 1);
  assert.throws(
    () => acceptance.resolveAcceptanceAction(p, "a1", "r2"),
    /验收/,
  );
});
test("inventory graph targets and historical criteria reject referenced deletion and remap all active IDs", () => {
  let p = project();
  p = save(p);
  p = record(p);
  p = acceptance.saveAcceptanceAction(p, action());
  p = record(p, result({ id: "r2", outcome: "passed" }));
  p = acceptance.resolveAcceptanceAction(p, "a1", "r2");
  let n = 0;
  const mapped = remapEngineering(p.engineering, new Map(), () => `new-${++n}`),
    a = mapped.siteAcceptance;
  assert.equal(a.items[0].id, "new-1");
  assert.equal(a.results[0].itemId, a.items[0].id);
  assert.equal(a.actions[0].failedResultId, a.results[0].id);
  assert.equal(a.actions[0].resolvedByResultId, a.results[1].id);
  const custom = acceptance.remapSiteAcceptance(
    {
      ...a,
      items: [{ ...a.items[0], targetType: "device", targetId: "old" }],
      results: [
        {
          ...a.results[0],
          criteria: {
            ...a.results[0].criteria,
            targetType: "device",
            targetId: "old",
          },
        },
      ],
      actions: [],
    },
    {
      devices: new Map([["old", "new"]]),
      interfaces: new Map(),
      links: new Map(),
    },
    () => `id${++n}`,
  );
  assert.equal(custom.results[0].criteria.targetId, "new");
});
test("native diagnostic parameters retain actual portList and quality method", () => {
  const ports = record(
    save(project(), item({ method: "ports" })),
    result({ historyId: "h" }),
    [
      history({
        kind: "ports",
        options: { portList: [80, 443], timeout: 1000, concurrency: 64 },
        summary: { open: 0, closed: 2, timeout: 0, error: 0 },
      }),
    ],
  );
  assert.match(report(ports).results[0].evidence.parameters, /portList=80,443/);
  const quality = record(
    save(project(), item({ method: "quality" })),
    result({ historyId: "h" }),
    [
      history({
        kind: "quality",
        options: {
          method: "tcp",
          port: 443,
          count: 20,
          interval: 1000,
          timeout: 1500,
        },
      }),
    ],
  );
  assert.match(report(quality).results[0].evidence.parameters, /method=tcp/);
});
test("active and historical inventory references survive full graph import and block deletion", () => {
  let p = {
    ...project(),
    engineering: {
      ...emptyEngineering(),
      locations: [
        { id: "area", parentId: "", kind: "area", name: "区域", note: "" },
      ],
      infrastructure: {
        version: 1,
        devices: ["d1", "d2"].map((id) => ({
          id,
          locationId: "area",
          name: id,
          model: "",
          kind: "switch",
          note: "",
        })),
        interfaces: ["p1", "p2"].map((id, i) => ({
          id,
          deviceId: `d${i + 1}`,
          name: id,
          role: "uplink",
          state: "available",
          note: "",
        })),
        links: [
          { id: "link", fromInterfaceId: "p1", toInterfaceId: "p2", note: "" },
        ],
      },
    },
  };
  for (const [i, targetType, targetId] of [
    [1, "device", "d1"],
    [2, "interface", "p1"],
    [3, "link", "link"],
  ]) {
    p = save(
      p,
      item({ id: `check${i}`, targetType, targetId, method: "ping" }),
    );
    p = record(
      p,
      result({ id: `r${i}`, itemId: `check${i}`, historyId: "h" }),
      [history()],
    );
  }
  for (const key of ["devices", "interfaces", "links"]) {
    const e = structuredClone(p.engineering);
    e.infrastructure[key] = [];
    assert.throws(() => validateEngineering(e));
  }
  const snapshot = structuredClone(p.engineering);
  snapshot.siteAcceptance.items[0].targetType = "project";
  snapshot.siteAcceptance.items[0].targetId = "";
  snapshot.siteAcceptance.items[0].revision++;
  snapshot.infrastructure.links = [];
  snapshot.infrastructure.interfaces = [];
  snapshot.infrastructure.devices = [];
  assert.throws(() => validateEngineering(snapshot), /验收/);
  for (const collision of ["area", "d1", "p1", "link"]) {
    const e = structuredClone(p.engineering);
    e.siteAcceptance.items[0].id = collision;
    assert.throws(() => validateEngineering(e), /验收/);
  }
  let n = 0;
  const e = remapEngineering(p.engineering, new Map(), () => `mapped${++n}`);
  validateEngineering(e);
  const inv = e.infrastructure;
  assert.equal(inv.links[0].fromInterfaceId, inv.interfaces[0].id);
  assert.equal(e.siteAcceptance.items[0].targetId, inv.devices[0].id);
  assert.equal(
    e.siteAcceptance.results[1].criteria.targetId,
    inv.interfaces[0].id,
  );
  assert.equal(e.siteAcceptance.results[2].criteria.targetId, inv.links[0].id);
  assert.equal(e.siteAcceptance.results[0].evidence.sourceId, "h");
});
test("UTF8 evidence limit rejects large legal individual fields without truncation", () => {
  const p = save(project(), item({ method: "ping" }));
  const h = history({ target: "汉".repeat(2048), error: "汉".repeat(1000) });
  assert.throws(() => record(p, result({ historyId: "h" }), [h]), /8192/);
});
test("caller cannot inject result snapshots or semantic revision and sequence", () => {
  let p = save(project(), item({ revision: 100 }));
  assert.equal(report(p).items[0].revision, 1);
  p = record(
    p,
    result({
      itemRevision: 99,
      sequence: 99,
      criteria: {},
      evidence: { evil: true },
    }),
  );
  assert.equal(report(p).results[0].sequence, 1);
  assert.equal(report(p).results[0].itemRevision, 1);
  assert.equal(report(p).results[0].evidence, null);
});
test("ping evidence preserves native timeout", () => {
  const p = record(
    save(project(), item({ method: "ping" })),
    result({ historyId: "h" }),
    [history({ options: { timeout: 1500, count: 1 } })],
  );
  assert.match(report(p).results[0].evidence.parameters, /timeout=1500/);
});
test("diagnostic parameters reject malformed native scalars and port lists", () => {
  const cases = [
    ...[{}, NaN, true, Infinity, null, "1", -1, 10001, 1.5].map((count) => [
      "ping",
      { count },
    ]),
    ["ping", { interval: 199 }],
    ["ping", { payloadSize: 65501 }],
    ["ping", { timeout: 10001 }],
    ...[
      [80, {}],
      [80, true],
      [NaN],
      [Infinity],
      [0],
      [65536],
      ["80"],
      [],
      "80",
      null,
    ].map((portList) => ["ports", { portList }]),
    ...[{}, true, 80, "80,no", "0", "65536", "100-80"].map((ports) => [
      "ports",
      { ports },
    ]),
    ["ports", { concurrency: 129 }],
    ["quality", { method: {} }],
    ["quality", { method: "udp" }],
    ["quality", { port: true }],
    ["quality", { count: 1 }],
    ["quality", { interval: NaN }],
    ["quality", { timeout: "1500" }],
    ["ping", null],
    ["ping", []],
  ];
  for (const [method, options] of cases) {
    const p = save(project(), item({ method }));
    assert.throws(
      () =>
        record(p, result({ historyId: "h" }), [
          history({ kind: method, options }),
        ]),
      /验收/,
      `${method}: ${JSON.stringify(options)}`,
    );
  }
});
test("diagnostic parameter bounds retain zero and valid native arrays, omit unknown values", () => {
  for (const [method, options] of [
    ["ping", { count: 0, payloadSize: 0, timeout: 100, interval: 200 }],
    [
      "ports",
      {
        ports: "22,80,443,8000-8100",
        portList: [22, 80, 443],
        timeout: 10000,
        concurrency: 128,
      },
    ],
    [
      "quality",
      {
        method: "tcp",
        port: 65535,
        count: 300,
        interval: 60000,
        timeout: 10000,
      },
    ],
    ["quality", undefined],
  ]) {
    const p = record(
      save(project(), item({ method })),
      result({ historyId: "h" }),
      [history({ kind: method, options })],
    );
    const parameters = report(p).results[0].evidence.parameters;
    if (options === undefined) assert.equal(parameters, "");
    else if (method === "ping") assert.match(parameters, /count=0/);
    else if (method === "ports") assert.match(parameters, /portList=22,80,443/);
    else assert.match(parameters, /method=tcp/);
  }
});
test("outcome/action matrix never inherits an older pass", () => {
  for (const actionState of ["none", "open", "closed"]) {
    for (const outcome of ["passed", "failed", "inconclusive"]) {
      let p = record(save(project()));
      if (actionState !== "none")
        p = acceptance.saveAcceptanceAction(p, action());
      p = record(p, result({ id: "pass", outcome: "passed" }));
      if (actionState === "closed")
        p = acceptance.resolveAcceptanceAction(p, "a1", "pass");
      p = record(p, result({ id: "latest", outcome }));
      const expected =
        outcome === "failed"
          ? "failed"
          : outcome === "inconclusive"
            ? "pending"
            : actionState === "open"
              ? "rectifying"
              : "passed";
      assert.equal(
        report(p).items[0].status,
        expected,
        `${actionState}/${outcome}`,
      );
      if (actionState === "closed") {
        p = save(p, item({ expected: "新版要求" }));
        assert.equal(report(p).items[0].status, "pending");
        assert.equal(report(p).items[0].openActionCount, 0);
      }
    }
  }
});
test("closure rejects an earlier-sequence pass and a wrong-item pass", () => {
  let p = record(save(project()), result({ id: "earlier", outcome: "passed" }));
  p = record(p);
  p = acceptance.saveAcceptanceAction(p, action());
  p = save(p, item({ id: "other" }));
  p = record(p, result({ id: "foreign", itemId: "other", outcome: "passed" }));
  for (const resultId of ["earlier", "foreign"]) {
    assert.throws(
      () => acceptance.resolveAcceptanceAction(p, "a1", resultId),
      /验收/,
    );
    const engineering = structuredClone(p.engineering);
    engineering.siteAcceptance.actions[0].resolvedByResultId = resultId;
    assert.throws(() => validateEngineering(engineering), /验收/);
  }
});

import { infrastructureFixture } from "./helpers/infrastructure.js";
test("readable target snapshots distinguish ports and retain names after inventory rename", () => {
  let p = infrastructureFixture();
  const expected = [
    "交换机 · 区域 / 1",
    "终端 · 区域 / 1",
    "交换机 · 区域 / 1 → 终端 · 区域 / 1",
  ];
  for (const [i, targetId] of ["port1", "port2", "link"].entries()) {
    p = save(
      p,
      item({
        id: `check-${i}`,
        targetType: i === 2 ? "link" : "interface",
        targetId,
      }),
    );
    p = record(p, result({ id: `result-${i}`, itemId: `check-${i}` }));
  }
  assert.deepEqual(
    report(p).items.map((x) => x.targetLabel),
    expected,
  );
  assert.deepEqual(
    report(p).results.map((x) => x.criteria.targetLabel),
    expected,
  );
  p.engineering.infrastructure.devices[0].name = "改名";
  p.engineering.locations[0].name = "新区域";
  assert.match(report(p).items[2].targetLabel, /改名 · 新区域/);
  assert.deepEqual(
    report(p).results.map((x) => x.criteria.targetLabel),
    expected,
  );
});
test("maximum legal location and endpoint names fit snapshots without truncation", () => {
  let p = infrastructureFixture();
  p.engineering.locations = [
    {
      id: "building",
      kind: "building",
      parentId: "",
      name: "楼".repeat(100),
      note: "",
    },
    {
      id: "floor",
      kind: "floor",
      parentId: "building",
      name: "层".repeat(100),
      note: "",
    },
    {
      id: "area",
      kind: "area",
      parentId: "floor",
      name: "区".repeat(100),
      note: "",
    },
  ];
  p.engineering.infrastructure.devices.forEach(
    (d, i) => (d.name = String(i).repeat(100)),
  );
  p.engineering.infrastructure.interfaces.forEach(
    (d) => (d.name = "口".repeat(100)),
  );
  p = record(save(p, item({ targetType: "link", targetId: "link" })));
  const label = report(p).results[0].criteria.targetLabel;
  assert.equal(
    label,
    `${"0".repeat(100)} · ${"区".repeat(100)} / ${"口".repeat(100)} → ${"1".repeat(100)} · ${"区".repeat(100)} / ${"口".repeat(100)}`,
  );
  assert.ok(label.length <= 1000);
});
