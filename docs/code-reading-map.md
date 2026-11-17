# NetTool 代码阅读地图

从一次真实操作阅读，界面状态、原生任务和持久化是三个不同的对象。以下路径均相对于源码仓库。

## 启动诊断并回看历史

1. `src/main.js` 挂载 `App.vue`。App 持有按工具分类的表单与任务视图；`start()` 校验输入后捕获当前项目，调用 runtime，界面进入 starting。
2. `src/runtime.js` 使用桌面 preload；浏览器 adapter 明确拒绝原生诊断。`electron/preload.cjs` 将方法映射到受限 IPC，并通过 `onTask()` 注册事件，返回移除监听的 disposer。
3. `electron/main.cjs` 检查 IPC 来源和项目身份；`NetworkTasks.start()` 规范化参数、建立任务 ID、AbortController 与内部结果，调度执行后返回 ID。
4. `electron/network.cjs` 负责 scan/ping/route 和通用任务生命周期；`network-tools.cjs` 校验、调度 DNS/端口/质量/测速/证书。下载和 TLS 的资源所有权分别在 `download-speed.cjs`、`certificate-check.cjs`。
5. 原生通过 `task:event` 发元数据和增量结果。`src/domain/task-events.js` 合并属于当前任务的事件，App 注入 `markRaw`，使领域合并逻辑无需依赖 Vue。
6. 结束时原生等待并行目标信息查询、刷新最后一批结果、尝试 `onComplete` 保存历史、移除运行任务，最后发送最终状态。最终事件携带成功保存的 `historyRecord`，App 将它合并到最近 100 条历史；保存失败不携带记录，另带 `saveError`，不把探测结果改成另一种结论。

`task.id` 标识一次执行；`options.projectId` 是启动时捕获的项目归属。初次事件可能在 start 返回前到达；界面接受未绑定 ID 的事件，绑定后拒绝其他 ID 的迟到结果。切页后任务继续运行；应用退出由原生任务停止流程释放资源。

工作区保存期间，共享 `start()` 阻止新任务进入原生，以免项目切换保存结束后的视图重置丢失任务控制。规划保存只采用项目、网段和当前项目；历史由首次加载与成功保存的任务终态记录更新，避免较旧规划快照覆盖刚完成的记录。对应真实 Electron 竞态及失败恢复验证在 `tests/ui/workspace-lifecycle.spec.js`。

`workspace:save` 的回执只包含版本、项目、网段、设置和当前项目，不包含诊断历史。Store 仍事务保存完整工作区；读取历史使用 `workspace:load`。不要在规划或设置保存回执里再次复制所有诊断结果，连续保存会显著抬高渲染进程的临时内存。真实回环扫描、并发保存与重启保留验证见 `tests/ui/workspace-save-payload.spec.js`。

## 任务事件契约

| 字段 | 合并方式与含义 |
| --- | --- |
| `id`、`kind`、`status`、计数、时间、目标等 | 当前元数据快照；只替换本次事件出现的字段 |
| `row` / `rows` | 新结果增量；两者都出现时 `rows` 优先，按顺序追加 |
| `pingLogEntry` | 单次系统 Ping 的原始输出，追加到独立日志集合 |
| `summary` | 该工具的最新汇总对象，整体替换，不与旧对象逐字段合并 |
| `error` | 参数以外的执行/探测错误；取消最终为 stopped |
| `saveError` | 历史写入失败；界面仍保留结果供导出 |

终态为 completed/stopped/error；其他视图状态包括 idle/starting/running/paused/stopping。扫描、端口、DNS 保留完整 rows，其他任务保留最近 500 行；Ping 原始执行明细保留最近 500 项。总统计在原生累计，截断视图明细不会截断任务计数。

summary 按工具定义：DNS 为服务器/记录类型/耗时/数量；端口为开放/拒绝/超时/错误计数；质量为收发/失败率/时延/P95/抖动；下载为 bytes、elapsedMs、mbps、reason 和最终 URL；证书为有效期、域名、信任、证书链与 TLS 信息。字段结构见对应原生实现及 `tests/network-tools.test.js`。

## 下载与证书的资源所有权

`download-speed.cjs` 拥有当前请求、响应、持续时间计时器、空闲超时和进度计时器。合法最终响应到来后才启动正文持续时间；连接、重定向和数据空隙由空闲超时约束。所有结束路径调用幂等 finish：清理计时器和监听、销毁资源、发布最终快照，再 resolve/reject。取消或断流仍保留部分测速结果。下载继续严格验证 HTTPS 证书。

`certificate-check.cjs` 拥有诊断 TLS socket、握手超时和取消监听。finish 只执行一次并销毁 socket。握手允许采集无效证书作为证据，域名/有效期/信任分别进入结果；此 socket 不发送应用数据。该策略只适用于诊断，与下载策略分开维护。

`network-tools.cjs` 保留原来的导出名称，供现有测试和任务调度使用。提取模块没有修改 IPC、工作区结构或应用数据目录。

## 项目规划保存

`ProjectPanel.vue` 拥有项目导航、草稿与保存；`ProjectDialog.vue` 展示创建/编辑、维护记录
和 Excel 导入预览，以模型和事件回到父层，不直接访问原生服务。`SiteAcceptancePanel.vue`
拥有验收领域操作与保存前后的项目身份校验，`SiteAcceptanceDialog.vue` 负责编辑/详情和
表单焦点入口。两者通过 `siteAcceptancePresentation.js` 共享显示标签，验收样式在
`site-acceptance.css` 作为各组件的 scoped 样式编译，避免拆分后丢失样式作用域。

`electron/excel.cjs` 保留原有导出 API，`excel-schema.cjs` 统一 schema 与模板位置，
`excel-writer.cjs` 按顺序组装工作表，`excel-reader.cjs` 校验不受信任单元格及项目引用。
专题工程 Excel 模块继续复用；原有文件/行数上限及公式、链接、富文本拒绝规则不变。
原生导出仍经过安全写入器，测试输出须放在隔离应用数据目录之外。

`src/style.css` 为有序入口，`src/style/` 按基础控件、导航、工作区、表格/反馈、
页脚/响应式分区；主题 token 与统一弹窗仍沿用 `src/styles/` 中的既有模块。

`ProjectPanel.vue` → `Planner.vue` 捕获导入项目 ID 与操作版本 → `App.vue.saveNetworks()` 核对项目并隔离跨项目 ID → runtime.save → IPC → `applyWorkspacePatch` → Store 事务保存。页面停用、切换项目或卸载使旧导入失效；数据库与规划校验仍以现有领域模块为准。

## 场地需求与容量

工程规划从 `ProjectPanel.vue` 的“场地与需求”进入 `EngineeringPanel.vue`。项目的可选 `engineering` 对象描述位置、需求和区域端口容量；`src/domain/engineering.js` 统一验证、计算、生成 issues，界面与 `electron/engineering-excel.cjs` 消费同一个报告。当前数量/容量的 null 表示未知，不能在显示或导入时转成 0；已知小计不足与待补充可以同时存在。

工程保存沿用 `saveProject` → runtime → `validateProjects/validateWorkspace` → Store。网段引用需属于该项目，删除前先解除关联。工程资料保存在 `projects.data`，SQLite/工作区版本不变。项目导入的 `remapEngineering` 更新位置、需求、容量和网段引用，工作簿中的 L/N 编号不作为数据库 ID。维护接口参考[报告契约](engineering-report-contract.md)及[Excel 契约](engineering-excel-contract.md)。

## 验证入口

`npm test` 覆盖领域、任务与存储；`tests/task-events.test.js` 覆盖事件归属/增量/明细上限/保存失败；`network-tools.test.js` 使用本地 DNS/TCP/HTTP/TLS 服务验证原生协议。`npm run build` 验证 renderer 集成，`npm run test:ui` 在隔离配置下验收 Electron 页面与 IPC。测试用例的本机验证不代表 Windows/Linux 或现场网络验收。

完整功能检查矩阵与本轮缺陷证据见[现有功能验收](existing-features-acceptance.md)。

任务终态的完整记录只属于历史集合，`mergeTaskEvent()` 不把它再放进实时 task 元数据。历史合并不依赖实时视图是否仍属于这个 task ID，避免后到的旧任务影响当前结果，同时保留其已保存记录。协议与失败回归在 `tests/network.test.js`、`tests/reliability.test.js`、`tests/task-events.test.js` 和 `tests/ui/task-history-refresh.spec.js`。

## 时间显示

时间 formatter、历史兼容与显示/存储边界见[时间显示规则](date-time-display.md)。新增界面时间先复用该入口。


## 现场验收与交付（C）

`SiteAcceptancePanel.vue` 接收当前项目、真实所属网段、当前项目历史与保存回调；ProjectPanel 按项目 keyed 挂载，App 传入已过滤的 history。检查、结果和整改表单使用 DesktopDialog/FeedbackBanner，失败保留草稿，busy 阻止双提交。所有状态、语义升版、证据捕获及显式复验闭环来自 `src/domain/site-acceptance.js`，结果 UI 只追加/查看；删除经完整工程校验保护依赖。

`engineering.js` 集成可选验收校验和导入映射；`electron/site-acceptance-excel.cjs` 处理三张输入和一张派生表，模式来自 `excel-schema.js`。没有新增 SQLite schema 或 IPC。`tests/site-acceptance*.test.js` 覆盖领域/SQLite/真实XLSX；`tests/ui/site-acceptance.spec.js` 使用隔离数据库与 localhost 原生诊断，覆盖工作台、故障重试、文件往返、16显示组合及整进程重启。产品行为见[现场验收指南](site-acceptance.md)。

## 工程拓扑与VLAN配置

`ProjectPanel.vue`按项目key挂载`TopologyPanel.vue`；后者以Map索引位置、设备和接口，以computed派生当前页和报告标签。图设备分页与接口/连接/问题列表分页独立；切换位置重置对应视图页码。

`src/domain/topology.js::registeredTopology`只读取登记结构，保留直接相连的边界设备；`vlanConfigurationReport`使用`checkVlanCarrier`检查逐段显式声明，`addIssue`去重并关联接口/网段/连接。资料未知保持pending。`topologyAcceptanceItem`重新校核问题仍属于当前项目，生成现有人工验收项；页面捕获projectId保存，只有原项目仍活动才导航。没有主动网络扫描。

领域回归直接静态导入真实API，见`tests/topology.test.js`；真实Electron流程、SVG键盘操作及组件寿命见`tests/ui/topology*.spec.js`。本轮结果见[可读性审查](reviews/2026-11-02-readability.md)。
