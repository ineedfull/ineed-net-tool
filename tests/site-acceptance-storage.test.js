import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import storage from "../electron/store.cjs";
import {
  saveAcceptanceItem,
  recordAcceptanceResult,
  emptySiteAcceptance,
} from "../src/domain/site-acceptance.js";
import { emptyEngineering } from "../src/domain/engineering.js";
import { item, result, history } from "./helpers/site-acceptance.js";
test("SQLite independent reload, rejected writes atomic, absent/empty retained, evidence independent of history", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "net-acceptance-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new storage.Store(dir);
  await store.load();
  await store.update((s) => {
    let p = saveAcceptanceItem(s.projects[0], item({ method: "ping" }));
    p = recordAcceptanceResult(p, result({ historyId: "h" }), [
      history({ projectId: p.id }),
    ]);
    s.projects[0] = p;
    s.projects.push({
      ...s.projects[0],
      id: "empty",
      name: "empty",
      engineering: {
        ...emptyEngineering(),
        siteAcceptance: emptySiteAcceptance(),
      },
    });
    s.projects.push({
      ...s.projects[0],
      id: "absent",
      name: "absent",
      engineering: emptyEngineering(),
    });
    s.history = [];
    return s;
  });
  const before = structuredClone(store.state);
  for (const mutate of [
    (p) => (p.version = 99),
    (p) => (p.results[0].itemId = "missing"),
    (p) => (p.results[0].measuredAt = "bad"),
  ])
    await assert.rejects(
      store.update((s) => {
        mutate(s.projects[0].engineering.siteAcceptance);
        return s;
      }),
      /验收/,
    );
  assert.deepEqual(store.state, before);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 1);
  store.close();
  const script = `const {Store}=require('./electron/store.cjs');(async()=>{const s=new Store(process.argv[1]);const state=await s.load();process.stdout.write(JSON.stringify(state));s.close()})().catch(e=>{console.error(e);process.exit(1)})`;
  const loaded = JSON.parse(
    execFileSync(process.execPath, ["-e", script, dir], {
      cwd: process.cwd(),
      encoding: "utf8",
    }),
  );
  assert.deepEqual(loaded, before);
  assert.equal(
    loaded.projects[0].engineering.siteAcceptance.results[0].evidence.sourceId,
    "h",
  );
  assert.equal(loaded.projects[2].engineering.siteAcceptance, undefined);
});
