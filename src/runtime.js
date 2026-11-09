import {
  emptyWorkspace,
  normalizeWorkspace,
  applyWorkspacePatch,
} from "./domain/projects.js";
const previewKey = "ineed-net-tool-preview-v1";

export const isDesktop = !!window.netTool;
const adapter = window.netTool || {
  async load() {
    const saved = localStorage.getItem(previewKey);
    return saved ? normalizeWorkspace(JSON.parse(saved)) : emptyWorkspace();
  },
  async save(patch) {
    const next = applyWorkspacePatch(await this.load(), patch);
    const previous = localStorage.getItem(previewKey);
    if (previous && JSON.parse(previous).version === 1)
      localStorage.setItem(previewKey + "-backup", previous);
    localStorage.setItem(previewKey, JSON.stringify(next));
    return next;
  },
  async exportExcel() {
    throw new Error("请在桌面版导出 Excel");
  },
  async importExcel() {
    throw new Error("请在桌面版导入 Excel");
  },
  async interfaces() {
    return [];
  },
  async start() {
    throw new Error("浏览器仅支持地址规划；请打开桌面版执行真实网络探测");
  },
  async control() {},
  onTask() {
    return () => {};
  },
  async copy(content) {
    await navigator.clipboard.writeText(content);
    return true;
  },
  async export(name, content) {
    const url = URL.createObjectURL(
      new Blob([content], {
        type: name.endsWith(".txt")
          ? "text/plain;charset=utf-8"
          : "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  async import() {
    throw new Error("请在桌面版导入规划文件");
  },
};
export const runtime = {
  ...adapter,
  // onTask forwards TaskEvent snapshots/deltas; its returned disposer is owned
  // by App.vue. Merge semantics are defined in domain/task-events.js.
  // Workspace data is JSON; remove nested Vue proxies before crossing Electron IPC.
  save(patch) {
    return adapter.save(JSON.parse(JSON.stringify(patch)));
  },
};
