const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class Store {
  constructor(directory) {
    this.file = path.join(directory, "workspace.sqlite");
    this.legacyFile = path.join(directory, "workspace.json");
    this.chain = Promise.resolve();
    this.state = null;
    this.db = null;
  }
  async load() {
    const { emptyWorkspace, normalizeWorkspace } =
      await import("../src/domain/projects.js");
    try {
      const exists = await fs.stat(this.file).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      let initial;
      if (!exists) {
        const raw = await fs
          .readFile(this.legacyFile, "utf8")
          .catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
        initial =
          raw === null ? emptyWorkspace() : normalizeWorkspace(JSON.parse(raw));
      }
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      this.db = new DatabaseSync(this.file);
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version !== 0 && version !== 1)
        throw new Error("不支持的 SQLite 数据库版本");
      if (exists && version === 0)
        throw new Error("SQLite 数据库未完成初始化，原文件已保留");
      if (this.db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("SQLite 完整性检查失败");
      this.db.exec("PRAGMA journal_mode=WAL;");
      if (!exists) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE meta (key TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE networks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
          CREATE TABLE allocations (id TEXT PRIMARY KEY, network_id TEXT NOT NULL REFERENCES networks(id), data TEXT NOT NULL);
          CREATE TABLE maintenance (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
          CREATE TABLE history (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
          CREATE INDEX networks_project ON networks(project_id);
          CREATE INDEX allocations_network ON allocations(network_id);
          CREATE INDEX maintenance_project ON maintenance(project_id);
          CREATE INDEX history_project ON history(project_id);
          PRAGMA user_version=1;`);
        try {
          this.write(initial);
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      const meta = Object.fromEntries(
        this.db
          .prepare("SELECT key, data FROM meta")
          .all()
          .map((r) => [r.key, JSON.parse(r.data)]),
      );
      const allocations = this.db
        .prepare("SELECT network_id, data FROM allocations ORDER BY rowid")
        .all();
      const maintenance = this.db
        .prepare("SELECT project_id, data FROM maintenance ORDER BY rowid")
        .all();
      this.state = normalizeWorkspace({
        ...meta,
        projects: this.db
          .prepare("SELECT id,data FROM projects ORDER BY rowid")
          .all()
          .map((r) => ({
            ...JSON.parse(r.data),
            maintenance: maintenance
              .filter((m) => m.project_id === r.id)
              .map((m) => JSON.parse(m.data)),
          })),
        networks: this.db
          .prepare("SELECT id,data FROM networks ORDER BY rowid")
          .all()
          .map((r) => ({
            ...JSON.parse(r.data),
            allocations: allocations
              .filter((a) => a.network_id === r.id)
              .map((a) => JSON.parse(a.data)),
          })),
        history: this.db
          .prepare("SELECT data FROM history ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(r.data))
          .sort((a, b) =>
            String(b.startedAt || "").localeCompare(String(a.startedAt || "")),
          ),
      });
      return this.state;
    } catch (error) {
      this.state = null;
      this.close();
      throw new Error(`数据读取失败，原文件已保留：${error.message}`);
    }
  }
  write(state) {
    const datasets = {
      projects: state.projects.map(({ maintenance, ...p }) => ({
        id: p.id,
        data: JSON.stringify(p),
      })),
      networks: state.networks.map(({ allocations, ...n }) => ({
        id: n.id,
        project_id: n.projectId,
        data: JSON.stringify(n),
      })),
      allocations: state.networks.flatMap((n) =>
        n.allocations.map((a) => ({
          id: JSON.stringify([n.id, a.ip]),
          network_id: n.id,
          data: JSON.stringify(a),
        })),
      ),
      maintenance: state.projects.flatMap((p) =>
        p.maintenance.map((m) => ({
          id: JSON.stringify([p.id, m.id]),
          project_id: p.id,
          data: JSON.stringify(m),
        })),
      ),
      history: state.history.map((h) => ({
        id: h.id,
        project_id: h.projectId,
        data: JSON.stringify(h),
      })),
    };
    // Remove children before parents; all changes run inside one transaction.
    for (const table of [
      "allocations",
      "maintenance",
      "history",
      "networks",
      "projects",
    ]) {
      const ids = new Set(datasets[table].map((r) => r.id));
      const remove = this.db.prepare(`DELETE FROM ${table} WHERE id=?`);
      for (const row of this.db.prepare(`SELECT id FROM ${table}`).all())
        if (!ids.has(row.id)) remove.run(row.id);
    }
    for (const [table, rows] of Object.entries(datasets)) {
      const parent =
        table === "allocations"
          ? "network_id"
          : ["networks", "maintenance", "history"].includes(table)
            ? "project_id"
            : null;
      const columns = parent ? `id,${parent},data` : "id,data";
      const update = this.db.prepare(
        `INSERT INTO ${table} (${columns}) VALUES (${parent ? "?,?,?" : "?,?"}) ON CONFLICT(id) DO UPDATE SET ${parent ? `${parent}=excluded.${parent},` : ""}data=excluded.data WHERE ${table}.data!=excluded.data`,
      );
      for (const row of rows)
        update.run(
          ...(parent ? [row.id, row[parent], row.data] : [row.id, row.data]),
        );
    }
    const put = this.db.prepare(
      "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
    );
    for (const key of ["version", "settings", "activeProjectId"])
      put.run(key, JSON.stringify(state[key]));
  }
  update(patch) {
    const run = this.chain.then(async () => {
      if (!this.state || !this.db)
        throw new Error("数据未加载，禁止覆盖已有文件");
      const { validateWorkspace } = await import("../src/domain/projects.js");
      const next = validateWorkspace(patch(structuredClone(this.state)));
      this.db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;");
      try {
        this.write(next);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.state = next;
      return next;
    });
    this.chain = run.catch(() => {});
    return run;
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
module.exports = { Store };
