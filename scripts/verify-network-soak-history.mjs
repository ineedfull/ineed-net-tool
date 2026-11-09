// Independent, read-only verification after the isolated Electron host exits.
// Usage: node scripts/verify-network-soak-history.mjs /path/to/soak
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const folder = process.argv[2];
assert.ok(folder, 'Provide the isolated soak evidence directory');
const read = async name => JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
const report = await read('report.json');
const before = await read('before-restart.json');
assert.equal(report.passed, true);
assert.equal(report.fixtureClosed, true);
assert.equal(report.restartPreserved, true);
assert.equal(report.retainedRowsVerified, true);
assert.deepEqual(report.pageErrors, []);
assert.equal(report.totals.unexpectedErrors, 0);
assert.ok(report.durationMs >= report.minutes * 60000, 'Declared load duration must be completed');
for (const sample of report.samples) {
  assert.equal(sample.launchIndex, 0, 'Recovery must precede restart');
  assert.deepEqual(sample.renderer.identity, report.launches[0].pageIdentity);
  assert.equal(sample.renderer.visibility, 'visible');
  assert.equal(sample.window[0].visible, true);
  assert.equal(sample.window[0].minimized, false);
  assert.equal(sample.window[0].title, 'iNeed Net Tool');
  if (sample.physical) assert.equal(sample.physical.locked, false);
}
const db = new DatabaseSync(path.join(folder, 'data/workspace.sqlite'), { readOnly: true });
const result = { folder, checkedAt: new Date().toISOString(), records: 0, rows: 0, kinds: {} };
try {
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check), ['ok']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const saved = db.prepare('SELECT id, project_id, data FROM history').all();
  const snapshot = new Map(before.history.map(r => [r.id, r]));
  const tasks = new Map(report.tasks.map(t => [t.id, t]));
  assert.equal(tasks.size, report.tasks.length, 'Executed task IDs must be unique');
  assert.equal(snapshot.size, before.history.length);
  assert.equal(saved.length, snapshot.size);
  const projects = new Set(before.projects.map(p => p.id));
  for (const entry of saved) {
    const record = JSON.parse(entry.data);
    assert.equal(entry.id, record.id);
    assert.equal(entry.project_id, record.projectId);
    assert.ok(projects.has(record.projectId));
    assert.deepEqual(record, snapshot.get(record.id), `SQLite snapshot ${record.id}`);
    const task = tasks.get(record.id);
    assert.ok(task, `Unknown task ${record.id}`);
    for (const key of ['kind', 'status', 'completed', 'elapsedMs', 'summary']) {
      assert.deepEqual(record[key], task[key], `${record.id}.${key}`);
    }
    const rows = record.rows;
    const firstSeq = record.kind === 'ping' ? Math.max(1, record.completed - 499) : 1;
    assert.equal(rows.length, record.kind === 'ping' ? Math.min(500, record.completed) : record.completed);
    rows.forEach((row, index) => assert.equal(row.seq, firstSeq + index, `${record.id} row sequence`));
    if (record.kind === 'scan') {
      const addresses = rows.map(row => row.address);
      assert.equal(new Set(addresses).size, rows.length);
      const [ip, prefixText] = record.options.target.split('/');
      assert.equal(ip, '127.0.0.0');
      const base = 127 * 2 ** 24;
      const size = 2 ** (32 - Number(prefixText));
      for (const row of rows) {
        assert.ok(row.address > base && row.address < base + size - 1);
        assert.equal(row.ip, [24, 16, 8, 0].map(shift => (row.address >>> shift) & 255).join('.'));
      }
      if (record.status === 'completed') assert.equal(rows.length, size - 2);
      assert.equal(record.received, rows.filter(row => row.status === 'reachable').length);
    } else if (record.kind === 'ports') {
      const expectedPorts = new Set(record.options.portList);
      assert.equal(new Set(rows.map(row => row.port)).size, rows.length);
      const counts = { open: 0, closed: 0, timeout: 0, error: 0 };
      for (const row of rows) {
        assert.equal(row.ip, '127.0.0.1');
        assert.ok(expectedPorts.has(row.port));
        assert.ok(Object.hasOwn(counts, row.state));
        counts[row.state]++;
      }
      if (record.status === 'completed') assert.equal(rows.length, expectedPorts.size);
      assert.deepEqual(record.summary, counts);
      assert.equal(record.received, counts.open);
    } else if (record.kind === 'ping') {
      assert.equal(record.pingLog.length, Math.min(500, record.completed));
      // Stopping may leave a final raw execution log without a completed row.
      const logStart = record.pingLog[0]?.seq;
      assert.ok(logStart === firstSeq || logStart === firstSeq + 1);
      record.pingLog.forEach((log, index) => assert.equal(log.seq, logStart + index));
      assert.equal(record.target, '127.0.0.1');
      assert.equal(record.received, report.ping.received);
    } else if (record.kind === 'dns' && record.status === 'completed') {
      assert.equal(record.summary.count, rows.length);
      for (const row of rows) assert.equal(row.value.address, '127.0.0.1');
    } else if (record.kind === 'quality') {
      assert.equal(record.summary.sent, rows.length);
      assert.equal(record.summary.received, rows.filter(row => row.status === 'reachable').length);
    } else if (record.kind === 'speed' && record.summary) {
      assert.ok(record.summary.bytes >= 0);
      assert.ok(record.summary.bytes <= record.options.maxMiB * 1048576 + 65536);
      assert.equal(new URL(record.summary.url).hostname, '127.0.0.1');
    } else if (record.kind === 'certificate' && record.status === 'completed') {
      assert.equal(record.summary.expectedName, 'localhost');
      assert.equal(record.summary.nameMatches, true);
      assert.equal(record.summary.trusted, false, 'Local fixture is self signed');
      assert.equal(record.summary.valid, false);
    }
    result.records++;
    result.rows += rows.length;
    result.kinds[record.kind] = (result.kinds[record.kind] || 0) + 1;
  }
  const meta = Object.fromEntries(db.prepare('SELECT key, data FROM meta').all().map(r => [r.key, JSON.parse(r.data)]));
  assert.deepEqual(meta.settings, before.settings);
  assert.equal(meta.activeProjectId, before.activeProjectId);
  const savedProjects = db.prepare('SELECT id, data FROM projects ORDER BY rowid').all().map(entry => ({
    ...JSON.parse(entry.data),
    maintenance: db.prepare('SELECT data FROM maintenance WHERE project_id=? ORDER BY rowid').all(entry.id).map(row => JSON.parse(row.data)),
  }));
  const savedNetworks = db.prepare('SELECT id, data FROM networks ORDER BY rowid').all().map(entry => ({
    ...JSON.parse(entry.data),
    allocations: db.prepare('SELECT data FROM allocations WHERE network_id=? ORDER BY rowid').all(entry.id).map(row => JSON.parse(row.data)),
  }));
  assert.deepEqual(savedProjects, before.projects);
  assert.deepEqual(savedNetworks, before.networks);
  result.integrity = 'ok';
  result.passed = true;
} finally {
  db.close();
}
await fs.writeFile(path.join(folder, 'history-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
