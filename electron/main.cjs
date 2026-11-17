const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  clipboard,
  shell,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { finished } = require("node:stream/promises");
const { Writable } = require("node:stream");
const { createSafeExportWriter } = require("./safe-export.cjs");
const { Store } = require("./store.cjs");
const { NetworkTasks, interfaces } = require("./network.cjs");
const FILE_LIMIT_BYTES = 128 * 1024 * 1024;
app.setName("Ineed Net Tool");
if (process.env.NET_TOOL_TEST_DATA)
  app.setPath("userData", process.env.NET_TOOL_TEST_DATA);
const locked = app.requestSingleInstanceLock();
let window,
  store,
  tasks,
  quitting = false;
if (!locked) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    store = new Store(app.getPath("userData"));
    let loadError;
    try {
      await store.load();
    } catch (error) {
      loadError = error.message;
    }
    tasks = new NetworkTasks(
      (event) => {
        if (window && !window.isDestroyed())
          window.webContents.send("task:event", event);
      },
      (record) =>
        store.update((state) => {
          state.history = [
            { ...record, projectId: record.options.projectId },
            ...state.history,
          ].slice(0, 100);
          return state;
        }),
    );
    const writeExport = createSafeExportWriter({ protectedDirectories: [app.getPath("userData")] });
    const source = pathToFileURL(
      path.join(__dirname, "../dist/index.html"),
    ).href;
    function handle(channel, fn) {
      ipcMain.handle(channel, async (event, ...args) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== source
        )
          throw new Error("未授权的页面");
        return fn(...args);
      });
    }
    handle("window:openWebsite", () => shell.openExternal("https://nettool.ineedfull.com/"));
    handle("workspace:load", async () => {
      if (loadError) {
        await store.load();
        loadError = null;
      }
      return store.state;
    });
    handle("workspace:save", async (patch) => {
      const { applyWorkspacePatch } = await import("../src/domain/projects.js");
      const state = await store.update((current) => applyWorkspacePatch(current, patch));
      // Planning writes acknowledge only planning data. Diagnostic history is
      // owned by workspace:load and task completion; copying every result row
      // back for each project/settings save creates large temporary UI heaps.
      return {
        version: state.version,
        projects: state.projects,
        networks: state.networks,
        settings: state.settings,
        activeProjectId: state.activeProjectId,
      };
    });
    handle("network:interfaces", interfaces);
    handle("task:start", (kind, options) => {
      if (!store.state) throw new Error("工作区未加载");
      const projectId = options.projectId || store.state.activeProjectId;
      if (!store.state.projects.some((p) => p.id === projectId))
        throw new Error("项目不存在");
      return tasks.start(kind, { ...options, projectId });
    });
    handle("task:control", (id, action) => tasks.control(id, action));
    handle("excel:export", async (mode, projectId) => {
      const { templateWorkbook, projectWorkbook } = require("./excel.cjs");
      const project = store.state?.projects.find((p) => p.id === projectId);
      if (mode !== "template" && !project) throw new Error("项目不存在");
      const snapshot = project
        ? structuredClone({
            project,
            networks: store.state.networks.filter(
              (n) => n.projectId === projectId,
            ),
          })
        : null;
      const filename =
        mode === "template"
          ? "NetTool-网络项目模板.xlsx"
          : `${project.name.replace(/[\\/:*?"<>|]/g, "_")}-网络台账.xlsx`;
      const chosen = await dialog.showSaveDialog(window, {
        defaultPath: filename,
        filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
      });
      if (chosen.canceled || !chosen.filePath) return false;
      await writeExport(chosen.filePath, async (handle) => {
        const workbook = mode === "template"
          ? await templateWorkbook()
          : await projectWorkbook(snapshot.project, snapshot.networks);
        const stream = new Writable({
          write(chunk, _encoding, callback) {
            handle.writeFile(chunk).then(() => callback(), callback);
          },
        });
        // Observe stream errors while Excel is still producing ZIP entries.
        const completion = finished(stream, { cleanup: true });
        try {
          await Promise.all([workbook.xlsx.write(stream), completion]);
        } finally {
          stream.destroy();
        }
      });
      return true;
    });
    handle("excel:import", async () => {
      const chosen = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
      });
      if (chosen.canceled) return null;
      return require("./excel.cjs").readProjectWorkbook(chosen.filePaths[0]);
    });
    handle("clipboard:write", (content) => {
      if (
        typeof content !== "string" ||
        Buffer.byteLength(content, "utf8") > 64 * 1024 * 1024
      )
        throw new Error("复制内容过大");
      clipboard.writeText(content);
      return true;
    });
    handle("file:export", async (name, content) => {
      // A complete /16 scan includes up to 65,536 result records.
      if (
        typeof content !== "string" ||
        Buffer.byteLength(content, "utf8") > FILE_LIMIT_BYTES
      )
        throw new Error("导出文件超过 128 MiB，请拆分后导出");
      const chosen = await dialog.showSaveDialog(window, {
        defaultPath: path.basename(String(name)),
        filters: String(name).endsWith(".txt")
          ? [{ name: "文本日志", extensions: ["txt"] }]
          : [{ name: "JSON", extensions: ["json"] }],
      });
      if (chosen.canceled || !chosen.filePath) return false;
      await writeExport(chosen.filePath, content);
      return true;
    });
    handle("file:import", async () => {
      const chosen = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (chosen.canceled) return null;
      if ((await fs.stat(chosen.filePaths[0])).size > FILE_LIMIT_BYTES)
        throw new Error("导入文件超过 128 MiB，请拆分后导入");
      const content = await fs.readFile(chosen.filePaths[0]);
      if (content.length > FILE_LIMIT_BYTES)
        throw new Error("导入文件超过 128 MiB，请拆分后导入");
      return JSON.parse(content.toString("utf8"));
    });
    function createWindow() {
      window = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 920,
        minHeight: 620,
        title: "iNeed Net Tool",
        backgroundColor: "#f1f4f9",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (url !== source) event.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler(
        (_, __, callback) => callback(false),
      );
      window.loadURL(source);
    }
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [
              {
                label: "iNeed Net Tool",
                submenu: [
                  { role: "about" },
                  { type: "separator" },
                  { role: "hide" },
                  { role: "hideOthers" },
                  { type: "separator" },
                  { role: "quit" },
                ],
              },
            ]
          : []),
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "视图",
          submenu: [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
    app.setAboutPanelOptions({
      applicationName: "iNeed Net Tool",
      applicationVersion: app.getVersion(),
      copyright: "iNeed · 网络规划与诊断",
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !tasks) return;
    event.preventDefault();
    quitting = true;
    tasks.stopAll();
    const started = Date.now();
    const timer = setInterval(async () => {
      if (!tasks.tasks.size || Date.now() - started > 7000) {
        clearInterval(timer);
        await store.chain;
        store.close();
        app.quit();
      }
    }, 50);
  });
}
