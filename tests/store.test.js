import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import storage from "../electron/store.cjs";
import { templateNetworks, newProject } from "../src/domain/projects.js";
const { Store } = storage;
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "net-tool-store-"));
  const handles = [];
  t.after(async () => {
    handles.forEach((s) => s.close());
    await fs.rm(folder, { recursive: true, force: true });
  });
  return {
    folder,
    open: () => {
      const s = new Store(folder);
      handles.push(s);
      return s;
    },
  };
}
test("queued SQLite writes preserve plans, allocations, maintenance and history across reloads", async (t) => {
  const { open } = await fixture(t);
  const store = open();
  await store.load();
  const networks = templateNetworks(
    "office-small",
    "192.168.10.0/24",
    "default-project",
    () => "test",
  );
  await Promise.all([
    store.update((s) => ({ ...s, networks })),
    store.update((s) => ({
      ...s,
      history: [{ id: "result", projectId: "default-project" }],
    })),
  ]);
  await store.update((s) => {
    s.projects[0].maintenance = [
      {
        id: "m",
        content: "巡检",
        owner: "甲",
        date: "2026-09-21",
        status: "pending",
      },
    ];
    return s;
  });
  store.close();
  const loaded = await open().load();
  assert.deepEqual(loaded.networks, networks);
  assert.equal(loaded.history[0].id, "result");
  assert.equal(loaded.projects[0].maintenance[0].content, "巡检");
});
test("legacy JSON migration keeps the source intact and SQLite becomes authoritative", async (t) => {
  const { folder, open } = await fixture(t);
  const file = path.join(folder, "workspace.json");
  const legacy = {
    version: 1,
    networks: [],
    history: [],
    settings: { theme: "dark", largeFont: true },
  };
  const bytes = JSON.stringify(legacy);
  await fs.writeFile(file, bytes);
  const store = open();
  await store.load();
  await store.update((s) => ({
    ...s,
    settings: { theme: "light", largeFont: false },
  }));
  store.close();
  assert.equal(await fs.readFile(file, "utf8"), bytes);
  const loaded = await open().load();
  assert.equal(loaded.settings.theme, "light");
  assert.equal(loaded.version, 2);
});
test("damaged legacy or SQLite data is not silently replaced", async (t) => {
  const { folder, open } = await fixture(t);
  const file = path.join(folder, "workspace.json");
  await fs.writeFile(file, "broken data");
  const store = open();
  await assert.rejects(store.load(), /原文件已保留/);
  await assert.rejects(store.update((s) => s));
  assert.equal(await fs.readFile(file, "utf8"), "broken data");
  const dbfile = path.join(folder, "workspace.sqlite");
  await fs.writeFile(dbfile, "corrupt sqlite");
  await assert.rejects(open().load(), /原文件已保留/);
  assert.equal(await fs.readFile(dbfile, "utf8"), "corrupt sqlite");
});
test("failed validation and failed SQL transactions leave all previous data intact", async (t) => {
  const { open } = await fixture(t);
  const store = open();
  const original = await store.load();
  await assert.rejects(
    store.update((s) => ({ ...s, networks: [{ id: "bad" }] })),
  );
  store.db.exec(
    "CREATE TRIGGER fail_project BEFORE INSERT ON projects WHEN NEW.id = 'bad' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
  );
  await assert.rejects(
    store.update((s) => ({
      ...s,
      projects: [...s.projects, newProject("bad", "失败项目")],
    })),
    /forced failure/,
  );
  assert.deepEqual(store.state, original);
  store.close();
  assert.deepEqual(await open().load(), original);
});
test("unknown database schema is refused and cross-project moves use deferred foreign keys", async (t) => {
  const { open, folder } = await fixture(t);
  const store = open();
  await store.load();
  await store.update((s) => ({
    ...s,
    networks: templateNetworks(
      "office-small",
      "192.168.10.0/24",
      "default-project",
      () => "n",
    ),
  }));
  await store.update((s) => ({
    ...s,
    projects: [newProject("next", "迁移项目")],
    activeProjectId: "next",
    networks: s.networks.map((n) => ({ ...n, projectId: "next" })),
  }));
  store.close();
  const db = new DatabaseSync(path.join(folder, "workspace.sqlite"));
  db.exec("PRAGMA user_version=99");
  db.close();
  await assert.rejects(open().load(), /不支持的 SQLite/);
});

test("engineering survives SQLite restart without a schema upgrade and broken references fail atomically", async (t) => {
  const { open } = await fixture(t);
  const store = open();
  await store.load();
  const engineering = {
    version: 1,
    locations: [
      { id: "area", parentId: "", kind: "area", name: "办公区", note: "" },
    ],
    demands: [
      {
        id: "d",
        locationId: "area",
        name: "终端",
        kind: "wired",
        count: null,
        growthPercent: 20,
        addressesPerUnit: 1,
        portsPerUnit: 1,
        addressMode: "dhcp",
        networkId: "net",
        note: "待确认",
      },
    ],
    capacities: [
      { id: "c", locationId: "area", accessPorts: null, note: "待确认" },
    ],
  };
  await store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => ({ ...p, engineering })),
    networks: templateNetworks(
      "office-small",
      "192.168.10.0/24",
      "default-project",
      () => "net",
    ),
  }));
  const saved = structuredClone(store.state);
  await assert.rejects(
    store.update((s) => ({ ...s, networks: [] })),
    /网段/,
  );
  assert.deepEqual(store.state, saved);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 1);
  store.close();
  const loaded = await open().load();
  assert.equal(loaded.version, 2);
  assert.deepEqual(loaded.projects[0].engineering, engineering);
  assert.deepEqual(loaded.networks, saved.networks);
});
