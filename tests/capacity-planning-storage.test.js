import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import storage from "../electron/store.cjs";
import { capacityFixture } from "./helpers/capacity-planning.js";
test("capacity planning survives a process-independent SQLite read; invalid saves are atomic and invalid stored references reject loading", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "capacity-sqlite-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = new storage.Store(folder);
  await store.load();
  const p = capacityFixture();
  await store.update((s) => ({
    ...s,
    projects: [p],
    activeProjectId: p.id,
    networks: [],
  }));
  const saved = structuredClone(store.state);
  for (const change of [
    (i) => (i.capacityPlanning.poeLoads[0].deviceWatts = 1.0001),
    (i) => (i.capacityPlanning.uplinks = []),
    (i) => (i.capacityPlanning.uplinks[0].fromInterfaceId = "port2"),
  ])
    await assert.rejects(
      store.update((s) => {
        change(s.projects[0].engineering.infrastructure);
        return s;
      }),
      /容量校核|端点|业务/,
    );
  assert.deepEqual(store.state, saved);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 1);
  store.close();
  const program = `const {Store}=require(process.argv[1]);(async()=>{const s=new Store(process.argv[2]);try{console.log(JSON.stringify(await s.load()))}finally{s.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  const output = execFileSync(
    process.execPath,
    ["-e", program, path.resolve("electron/store.cjs"), folder],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output), saved);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(folder, "workspace.sqlite"));
  const record = JSON.parse(
    db.prepare("SELECT data FROM projects WHERE id=?").get(p.id).data,
  );
  record.engineering.infrastructure.capacityPlanning.trafficDemands[0].uplinkId =
    "foreign";
  db.prepare("UPDATE projects SET data=? WHERE id=?").run(
    JSON.stringify(record),
    p.id,
  );
  db.close();
  const invalid = new storage.Store(folder);
  try {
    await assert.rejects(invalid.load(), /容量校核/);
  } finally {
    invalid.close();
  }
});
