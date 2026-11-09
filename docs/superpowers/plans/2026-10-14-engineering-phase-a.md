# 企业办公室/园区：需求与容量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有项目工作台完成场地需求、地址与端口校核和工程 Excel 交接。

**Architecture:** 可选 engineering 对象随项目存储，纯领域模块提供共享校验和报告。Excel 与 Vue 工作台消费同一计算结果，旧项目保持兼容。

**Tech Stack:** Vue 3、Electron、SQLite、ExcelJS、Node test、Playwright。

**Spec:** `docs/network-engineering-phase-a-design.md`

## Global Constraints

- SQLite user_version=1、工作区 version=2；工程子对象 version=1；不改应用 ID/数据目录。
- 源码原目录串行修改，保留本轮前已有品牌/压力修复；不自动提交、发布或上传。
- 数量/端口上限 1,000,000；预留 0～1000%；单单位地址/端口 0～16；位置/需求/容量上限 500/1000/500。
- 浅色/深色、普通/大字、侧栏展开/折叠及窄窗口；只用隔离测试数据。

## Task 1: 领域、项目引用与 SQLite 兼容

Files: create `src/domain/engineering.js`, `tests/engineering.test.js`; modify `src/domain/projects.js`, `tests/projects.test.js`, `tests/store.test.js`。

Interfaces: `validateEngineering(engineering, networks?)`, `engineeringReport(project, networks)`, `remapEngineering(engineering, networkIds, uuid)`。计算契约写入 `docs/engineering-report-contract.md`。

- [x] 先写失败测试：40 wired + 4 ap，各 20% 预留汇总 53；wireless 不占接入端口；共同网段只算一个网关；缺参 pending，超容量 risk；DHCP/静态容量独立；非法层级/数字/引用拒绝；新项目 ID 重映射；旧项目读写和数据库重启恢复。
- [x] Run `node --test tests/engineering.test.js tests/projects.test.js tests/store.test.js`，确认新增行为失败。
- [x] 实现纯领域计算及项目验证/导入映射，复用 IPv4 计算，项目 JSON 持久化保持原表。
- [x] 重跑上述命令，自查聚合、未知值和引用生命周期；供下一任务读取契约。34/34 通过，独立复核通过；`npm test` 留在最终门禁执行。

## Task 2: Excel 输入与校核交接

Files: modify `src/domain/excel-schema.js`, `electron/excel.cjs`, `tests/excel.test.js`; optional create `electron/engineering-excel.cjs`, `tests/engineering-excel.test.js`。

Consumes: Task 1 的验证、报告、项目导入；Produces: 中文三输入表与只读校核表，模板/导出/导入完整往返。

- [x] 写失败测试：楼层/区域/需求/容量与 N/L 编号往返；未启用旧五/八表；缺表、非法引用/数字/公式整体拒绝；修改导出值重新计算；报告表篡改不影响输入。
- [x] Run `node --test tests/excel.test.js tests/engineering-excel.test.js` 并确认新增行为失败。
- [x] 用独立 Excel helper 管理工程表，限定互联解析仍只读原三张表；模板补工程输入说明，校核只读输出。
- [x] 运行 Excel/enterprise 回归 30/30，交付实际 .xlsx 测试产物与结构核对。独立复核发现并修复最大合法输入的单元格字符超限；逐项问题完整导出，复核通过。

## Task 3: 项目 UI 与原生交互验证

Files: create `src/components/EngineeringPanel.vue`, optional `src/styles/engineering.css`, `tests/ui/engineering.spec.js`; modify `src/components/ProjectPanel.vue` and required style entry。

Consumes: Task 1 计算契约、Task 2 Excel；Produces: 场地与需求页签、位置/需求/容量增删改、实时报告与缺项定位。

- [x] 写真实 Electron 失败用例：旧项目打开新页签，新建区域与需求，53 端口不足，改成 60 充足，无线不增端口；改网段后重算；项目切换/保存失败保留；Excel/重启保持关联。
- [x] Run `npx playwright test tests/ui/engineering.spec.js` 确认缺少新 UI 的失败。
- [x] 沿用现有 modal/busy/save；当前项目对象上保存 engineering；引用删除显式处理；列宽与折叠/窄窗口可用。
- [x] 运行新用例、项目/规划用例、主题与布局矩阵；生成实际 Electron 截图供视觉复核。

Task 3 已完成：真实 Electron RED/GREEN、项目/规划专项、16 种显示组合通过；切换类型保留原值与缺数量定位的审查修复已复核通过。完整当前源码回归在 Task 4 记录。

## Task 4: 最终回归与交接

- [x] Run `npm test`、`npm run build`、`npm run test:ui`；只对新增/修改文件检查格式；不重跑此前 20 分钟压力长跑。
- [x] 复核需求数量/单位、保存与引用、Excel 输入/结果一致性、大字/窄窗口布局；解决影响本期的问题。
- [x] 更新产品使用说明、README 和阅读地图，以及工作区任务与 STATUS；说明第一期完成项及 B/C 阶段尚未实现项。

## 执行记录

2026-10-14：用户已授权落地既定路线，第一期范围如设计。采用原目录分任务串行实施；用户约定优先于技能默认独立 worktree/提交建议。预先存在的共享工作目录改动不纳入自动提交。

2026-10-14 最终验收：Node 175 通过/1 原有跳过；领域/持久化 34、Excel 52、完整真实 Electron UI 37、16 显示组合及构建/格式检查通过。最终整体独立复核规格与质量 PASS；修复最大工作簿单元格、编辑类型重置、缺数量定位和 Excel 百分比格式误读。使用说明、阅读地图、报告/Excel 契约及验收记录已更新。阶段 A 完成，B/C 尚未实施；保留原改动、未提交或发布。
