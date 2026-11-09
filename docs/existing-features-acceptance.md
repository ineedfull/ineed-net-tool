# NetTool 现有功能检查与修复验收

检查日期：2026-10-12。范围是现有功能中的保存、导入、任务归属与页面生命周期问题，以及现有页面和原生协议回归；没有新增工具、协议或运行时。

## 功能检查矩阵

| 现有功能 | 本轮检查重点 | 可重复验证入口 |
| --- | --- | --- |
| 项目、场景模板、切换 | 项目资料、模板隔离、运行中禁止切换、保存与启动竞争、失败后重试 | `tests/ui/projects.spec.js`、`enterprise.spec.js`、`workspace-lifecycle.spec.js`、`tests/projects.test.js` |
| 地址规划、JSON 导入导出 | 同项目草稿、跨项目隔离、ID 合并、取消/损坏/超限文件保留原数据、异步导入离页失效 | `tests/ui/project-planning.spec.js`、`planner-import.spec.js`、`review-fixes.spec.js` |
| 网段计算与 VLSM | 掩码、/31 /32、网关与容量、重叠校验、追加到所选项目、不覆盖已有草稿 | `tests/ui/subnet-calculator.spec.js`、`subnet-planner.spec.js`、`tests/ipv4.test.js`、`subnet-plan.test.js` |
| IP 台账、表格/网格 | 登记、批量、编辑移除、VLAN 冲突、DHCP/网关避让、搜索筛选、大网段按块展示 | `tests/ui/projects.spec.js`、`address-map.spec.js`、`planner-addresses.spec.js`、`tests/projects.test.js`、`address-map.test.js` |
| 维护记录、互联规划 | 状态切换、长文本、线路编辑、规则新增/排序/删除、空白项目隔离 | `tests/ui/projects.spec.js`、`enterprise.spec.js`、`review-fixes.spec.js`、`tests/enterprise.test.js` |
| Excel | 模板、完整项目导出、导入预览后新建项目、字段校验、互联规划往返与重启 | `tests/ui/projects.spec.js`、`enterprise.spec.js`、`tests/excel.test.js` |
| SQLite、旧数据 | 串行事务、SQL/校验失败回滚、旧 JSON 保留、损坏/未知版本拒绝覆盖 | `tests/store.test.js`、`tests/ui/projects.spec.js`、`subnet-calculator.spec.js` |
| IP 探测 | 回环真实 ICMP/TCP、暂停/继续/停止、完整结果分页/筛选/导出、批次与并发限制 | `tests/ui/electron.spec.js`、`large-scan.spec.js`、`scan-view.spec.js`、`tests/large-scan.test.js`、`scan-probes.test.js` |
| Ping、路由、目标信息 | 明确次数/持续 Ping、小载荷、原始输出、目标查询并行/取消、切页不中断、原生回环路由 | `tests/ui/electron.spec.js`、`ping-log.spec.js`、`target-info.spec.js`、`reliability.spec.js`、对应 Node 测试 |
| DNS、端口、下载、质量、证书 | 本机服务、真实结果、失败与部分结果、停止/超时、导出、按项目持久化与重启 | `tests/ui/network-tools.spec.js`、`reliability.spec.js`、`tests/network-tools.test.js`、`reliability.test.js` |
| 诊断记录与任务事件 | 完成后刷新、迟到事件归属、明细上限、失败结果导出、规划保存不覆盖新历史 | `tests/ui/history-details.spec.js`、`workspace-lifecycle.spec.js`、`tests/task-events.test.js` |
| 主题、设置、关于、侧栏、反馈 | 浅/深/系统主题、普通/大字、展开/折叠、920×620 与 960×720、焦点与弹窗滚动、提示关闭 | `tests/ui/desktop-style.spec.js`、`feedback.spec.js`、`review-fixes.spec.js` 及各页面截图 |

代码检查同时追踪 `src/App.vue`、`src/runtime.js`、规划/台账/互联组件、`electron/main.cjs`、`store.cjs` 和 `network.cjs` 的状态及保存边界。互联规划模板的快照传入方式已用真实 Electron 企业模板流程确认，没有把猜测的问题当作缺陷修改。

## 已确认并修复的问题

### 保存项目切换时启动诊断，会失去任务视图

项目切换和新建项目都会等待工作区保存，再重置诊断视图。此前共享 `start()` 没有检查保存状态；切换保存尚未返回时，用户可以点击开始，原生任务已启动，随后视图被切换逻辑清空。运行中的任务可能失去对应控制界面，并按旧项目保存。

修复在共享启动入口检查 `saving`，显示稍后再开始的提示，并阻止原生启动。相同入口覆盖 scan、ping、route、dns、ports、speed、quality、certificate，包含按钮和 Enter 操作。

`workspace-lifecycle.spec.js` 使用隔离目录、真实 SQLite 与原生 Ping，仅延迟项目切换保存完成后的返回值。修复前测到原生启动次数为 1，预期为 0；修复后保存期间各诊断入口均为 0，返回后可以启动并把记录归入新项目。另一个用例注入一次写入失败，确认项目/既有结果/历史保留，保存状态解除，诊断和项目切换都能重试。

### 规划保存的旧快照会隐藏新诊断记录

诊断可以在用户编辑项目资料时继续运行。此前规划保存返回后 `adopt()` 同时替换历史；若诊断在保存等待期间完成，任务事件已经刷新了最新历史，稍后返回的较旧规划快照却会把它覆盖。记录仍在 SQLite，界面会暂时显示为空，重启才恢复。

修复让规划保存只采用项目、网段与当前项目。诊断历史由初始加载、重新加载与任务终态事件读取；规划返回值不再覆盖历史。

专项用例启动真实回环 Ping，在项目资料真实事务提交后延迟返回，等待 Ping 正常完成并写入历史。修复前释放旧返回值后导航记录数由 1 变成 0；修复后仍为 1，列表也可立即查看。原生任务、SQLite 和完成事件没有替换成模拟结果。

## 验证结果与边界

专项命令：`npm run test:ui -- tests/ui/workspace-lifecycle.spec.js`，3/3 通过。两项缺陷各有修复前失败与修复后通过的证据；保存失败恢复项是边界验证。

完整回归均已通过：

| 命令 | 本轮结果 |
| --- | --- |
| `npm test` | 91/91，0 失败、0 跳过 |
| `npm run build` | Vite renderer 构建通过 |
| `npm run test:ui` | 真实 Electron UI 33/33，含新增 3 项生命周期用例 |
| `git diff --check` | 通过 |

仓库没有 lint 脚本。原始日志使用 `/tmp/nettool-existing-` 前缀，专项为 `switch-red.log`、`history-red.log`、`lifecycle-green.log`，完整为 `unit.log`、`build.log`、`ui.log`；临时日志不是长期交付文件，可通过上述仓库测试重跑。Node/Playwright 输出中有运行环境的弃用及颜色环境警告，未产生测试失败。

本轮环境为 macOS arm64、Node.js 26.10.0、仓库 Electron 43.1.0。页面测试启动真实 Electron、受限 preload/IPC 与隔离 SQLite 数据目录；网络目标限定本机回环及本机 DNS/TCP/HTTP/TLS 测试服务。大规模扫描调度/分页用例替换底层探针为确定性结果，保留真实调度、事件及存储；它不是对大量现场地址的扫描验收。

NetTool 当前只有 Electron。浏览器预览、Tauri、Windows/Linux 原生分支、实体网络和新安装包启动不属于本轮原生验收；不能根据配置或回环通过推定这些环境通过。没有打包或发布。
