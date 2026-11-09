# 设备与连接：本机验证记录（2026-10-25）

本轮在原 NetTool Vue + Electron 源码目录完成设备/接口/连接 UI。复用纯领域校验与报告、现有 SQLite 保存、DesktopDialog 和 FeedbackBanner；未增加运行时、探测或自由绘图。

## 已执行

- 新增 Electron 测试先失败于不存在的“设备与连接”页签（原生 RED），实现后完整生命周期通过。
- 设备、接口、连接增改删；重复接口名、重复占口、已连接接口改为预留、修改所属设备造成自连均拒绝。设备/接口删除依赖及仅有设备引用的区域删除保护通过。
- 已登记接口业务容量随状态/角色/连接重算，未知需求保留待补充；手填 48 始终独立保留。实际连接占用与业务需求分别表达。
- 真实 SQLite 触发器拒绝项目更新，编辑草稿和模态焦点保留；保存中按钮禁用、连续提交事件受 busy guard 保护，移除故障后重试成功。
- 模态编辑期间切换项目清除草稿，另一个项目保持未登记；XLSX 经原生导出、预览并导入新项目，所有位置/设备/接口/连接 ID 重建；关闭实际 Electron 进程再启动，设备和连接仍在。
- 浅/深 × 普通/大字 × 展开/折叠导航 × 1440×900 / 920×620，共 16 种显示组合。每种均打开设备/接口/连接三个弹窗，检查页脚在视口内、Tab 焦点在原生模态内、页面无横向溢出。

## 命令与结果

在源码根运行：

```sh
npm run test:ui -- tests/ui/infrastructure.spec.js tests/ui/engineering.spec.js tests/ui/projects.spec.js
# 4 passed (17.5s)
npm run test:ui -- tests/ui/infrastructure.spec.js tests/ui/project-planning.spec.js
# 2 passed (9.2s)
npm run test:ui -- tests/ui/infrastructure.spec.js
# 最终细化：1 passed (7.4s)
node --test tests/engineering.test.js tests/engineering-excel.test.js tests/projects.test.js tests/store.test.js
# 77 passed / 0 failed
npm run build
# Vite production build passed
npm exec --offline -- prettier --check src/components/InfrastructurePanel.vue src/components/ProjectPanel.vue tests/ui/infrastructure.spec.js
git diff --check
# 均通过
```

最后细化补齐添加/编辑/删除动态标题及原生断言；更早相邻套件结果与最终单场景结果分别记录，不混称为一次全量验证。控制会话随后执行全量门禁与独立审查，实际结果及审查后修复如下。

证据根目录为工具工作区 `scratch/2026-10-25-nettool-infrastructure/`；`task-2-evidence/` 保存 RED、GREEN、相邻回归、构建和格式日志。截图：

- `infrastructure-light-1440.png`
- `infrastructure-dark-920.png`
- `infrastructure-dialog-dark-large-narrow.png`
- `infrastructure-connections-dark-large-narrow.png`
- `infrastructure-capacity-dark-large-narrow.png`

控制会话已人工检查五张截图的可读性与页脚，随后要求修正新增弹窗误用“编辑”的标题；修正后测试重新生成对应截图。下方连接/容量截图同一视口可同时展示两组信息。

## 控制会话修复前全量门禁

实际日志位于工具工作区 `scratch/2026-10-25-nettool-infrastructure/`：

- `final-node.log`：`npm test`，共 215 项，214 通过、0 失败、1 项原有跳过。
- `final-build.log`：`npm run build`，Vite production build 通过（364 ms）。
- `final-ui.log`：`npm run test:ui`，全部 38 项真实 Electron 测试通过（1.3 分钟）。
- `final-format.log`：控制会话格式检查日志。

## 审查后 M1 / M2 修复验证

M1 为导入连接生成临时 ID 时跳过已有位置、需求、容量、设备、接口及先前连接的 ID，不改写输入设备/工程编号；保留连接编号严格校验、100 字符支持及容量/连接同为 `C001` 的兼容行为。新增真实 XLSX 文件回归含设备 `excel-link-1` 和需求 `excel-link-2`：修改生产代码前实际失败于“设备连接与工程记录标识重复”，修改后通过，并核对导入前后设备/接口/连接引用。

M2 的截图默认使用 `testInfo.outputPath("evidence")`。仅显式设置 `NET_TOOL_INFRASTRUCTURE_EVIDENCE_DIR` 才覆盖输出目录。保留原生生命周期、16 种显示组合及五张截图断言。

在源码根实际运行：

```sh
node --test --test-name-pattern='custom workbook IDs' tests/infrastructure-excel.test.js
# RED：0 pass / 1 fail（重复 ID）；GREEN：1 pass / 0 fail
node --test tests/infrastructure.test.js tests/infrastructure-excel.test.js tests/infrastructure-storage.test.js tests/engineering.test.js tests/engineering-excel.test.js tests/projects.test.js tests/store.test.js
# 112 pass / 0 fail
npm test
# 本修复后只运行一次：216 total / 215 pass / 0 fail / 1 original skip
env -u NET_TOOL_INFRASTRUCTURE_EVIDENCE_DIR npm run test:ui -- tests/ui/infrastructure.spec.js
# 1 passed (8.8s)，无截图路径覆盖
npm exec --offline -- prettier --check electron/infrastructure-excel.cjs tests/infrastructure-excel.test.js tests/ui/infrastructure.spec.js docs/infrastructure-verification-2026-10-25.md
git diff --check
# 均通过
```

修复日志为工作区证据目录的 `final-fix-{red,green,focused,node,ui,format}.log`。本次默认截图实际写入源码仓库：
`test-results/infrastructure-infrastruct-3bc35-ifecycle-and-display-matrix/evidence/`，包含上列五张 PNG；未覆盖工作区中的先前截图。生产 UI 未改变，因此修复后运行相关原生场景，未重复全量 38 项 UI 或构建；修复前全量结果独立列于上节。

## 边界

真实桌面为本机 macOS arm64 的开发 Electron 宿主，数据均为 `NET_TOOL_TEST_DATA` 临时目录；SQLite 故障和 Excel 文件也使用隔离目录，测试结束清理。没有网络扫描、用户数据修改、安装、签名、打包、上传或发布。浏览器预览、Windows/Linux 原生与安装包启动未在本轮验收。NetTool 当前没有 Tauri 运行时。上限与严格文件校验的领域/Excel 完整测试见 Task 1 报告，本轮没有重复声称桌面最大清单压力验收。
