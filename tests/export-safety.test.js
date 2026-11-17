import test from 'node:test';
import assert from 'node:assert/strict';
import * as files from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import vm from 'node:vm';

test('native JSON, text and Excel exports protect the live workspace and accept regular files', { timeout: 15_000 }, async t => {
  const root = await files.mkdtemp(path.join(tmpdir(), 'nettool-export-'));
  const directory = path.join(root, 'data'); await files.mkdir(directory);
  const sourcePath = new URL('../electron/main.cjs', import.meta.url).pathname;
  const nodeRequire = createRequire(sourcePath);
  const { Store } = nodeRequire('./store.cjs');
  const existing = new Store(directory); await existing.load(); existing.close();
  let actualStore, startup, instance;
  const handlers = new Map();
  class BrowserWindow {
    constructor() {
      instance = this;
      this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {}, send() {},
        session: { setPermissionRequestHandler() {} } };
    }
    loadURL(url) { this.webContents.mainFrame.url = url; }
    isDestroyed() { return false; }
    static getAllWindows() { return [instance]; }
  }
  let chosen, failWrite = false;
  const { createSafeExportWriter } = nodeRequire('./safe-export.cjs');
  const exportFiles = { ...files, open: async (...args) => {
    const handle = await files.open(...args);
    return {
      stat: () => handle.stat(), sync: () => handle.sync(), close: () => handle.close(),
      writeFile: async (...values) => {
        if (failWrite) throw Error('injected write failure');
        return handle.writeFile(...values);
      },
    };
  } };
  const electron = { BrowserWindow,
    app: { setName() {}, setPath() {}, getPath: () => directory, requestSingleInstanceLock: () => true,
      on() {}, quit() {}, setAboutPanelOptions() {}, getVersion: () => 'review',
      whenReady: () => ({ then: fn => { startup = fn(); } }) },
    Menu: { setApplicationMenu() {}, buildFromTemplate: v => v },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: chosen }) },
  };
  const context = { require: name => name === 'electron' ? electron : name === './store.cjs'
      ? { Store: class extends Store { constructor(...args) { super(...args); actualStore = this; } } }
      : name === './safe-export.cjs'
      ? { createSafeExportWriter: options => createSafeExportWriter({ ...options, files: exportFiles }) }
      : nodeRequire(name),
    process, Buffer, console, structuredClone, __dirname: path.dirname(sourcePath), __filename: sourcePath,
    setInterval, clearInterval };
  vm.runInNewContext(await files.readFile(sourcePath, 'utf8'), context, { filename: sourcePath });
  await startup;
  t.after(async () => { actualStore.close(); await files.rm(root, { recursive: true, force: true }); });
  const databasePath = path.join(directory, 'workspace.sqlite');
  const before = await files.readFile(databasePath);
  await files.symlink(databasePath, path.join(root, 'linked.json'));
  await files.link(databasePath, path.join(root, 'hardlinked.json'));
  await files.symlink(directory, path.join(root, 'alias'));
  const event = { sender: instance.webContents, senderFrame: instance.webContents.mainFrame };
  const projectId = actualStore.state.projects[0].id;
  for (const [index, invoke] of [
    () => handlers.get('file:export')(event, 'report.json', 'evidence'),
    () => handlers.get('file:export')(event, 'report.txt', 'evidence'),
    () => handlers.get('excel:export')(event, 'template'),
    () => handlers.get('excel:export')(event, 'project', projectId),
  ].entries()) {
    for (chosen of [path.join(root, 'linked.json'), path.join(root, 'hardlinked.json'), databasePath,
      path.join(directory, 'new.json'), path.join(root, 'alias', 'report.json'), directory]) {
      await assert.rejects(invoke());
      assert.deepEqual(await files.readFile(databasePath), before);
    }
    chosen = path.join(root, 'normal'); await files.writeFile(chosen, 'old');
    assert.equal(await invoke(), true);
    if (index < 2) assert.equal(await files.readFile(chosen, 'utf8'), 'evidence');
    else {
      const workbook = new (nodeRequire('exceljs').Workbook)();
      await workbook.xlsx.readFile(chosen);
      assert(workbook.getWorksheet('项目'));
      assert(workbook.getWorksheet('IP台账'));
    }
    const exported = await files.readFile(chosen);
    failWrite = true;
    await assert.rejects(invoke(), /injected write failure/);
    failWrite = false;
    assert.deepEqual(await files.readFile(chosen), exported);
  }
  assert.equal((await files.readdir(root)).some(name => name.endsWith('.tmp')), false);
});
