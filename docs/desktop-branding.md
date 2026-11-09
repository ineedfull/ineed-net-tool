# 桌面开发与测试宿主品牌

macOS 的 `npm start` 使用 `scripts/dev-electron.mjs`，将宿主的 Dock 名称、应用菜单和图标与既有窗口标题 `iNeed Net Tool` 对齐。标准 Playwright 配置和 Ping、网络压力、边界及异常响应检查脚本采用相同宿主。显式设置 `ELECTRON_BINARY` 时，测试继续使用指定二进制。

启动器在忽略目录 `artifacts/electron-dev/` 缓存 Electron 副本，写入正式应用 ID、CFBundleName / CFBundleDisplayName 和当前维护的 ICNS，并本地 ad-hoc 重签。缓存键包含 Electron 版本、架构、品牌元数据与图标摘要；图标变更后重新启动会生成新的缓存。没有修改 node_modules 中的 Electron。

打包配置同步写入 macOS 显示名。原 productName / 安装包文件名、appId、内部 app.setName 和真实数据路径保持原值，测试继续通过 NET_TOOL_TEST_DATA 隔离。其他系统使用原 Electron 可执行文件。NetTool 本轮只涉及现有 Electron。

本地签名用于开发与测试，正式发行签名与安装验收按[打包说明](desktop-packaging.md)执行。

## 2026-10-13 本机验证

macOS arm64 的原始宿主 Dock/应用菜单均显示 Electron；新宿主的 Dock/菜单/窗口标题均为 iNeed Net Tool。独立 Swift 读取 NSRunningApplication.localizedName 与 AX 原生菜单，应用内存储的 ICNS 与维护源逐字节一致；隔离 profile 路径和可见窗口也通过断言。

Node 测试 110 通过、1 个现有 Tauri 发布项跳过；原生 Electron 主流程 2/2 通过，覆盖规划、探测、历史保存与布局。调整后的独立边界脚本通过回环扫描 65,534 条、端口 65,535 条的完整保存/导出/重启恢复，errors 为空。改动脚本语法检查与 diff 检查通过。

原始名称对照、品牌断言、截图和测试日志保存在工具工作区 `scratch/2026-10-13-tools-desktop-branding/`。本次未重做长期压力、生产安装包或其他系统验收，未提交/发布。
