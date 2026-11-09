# 2026-11-01 工程拓扑持续验收

状态：本轮 macOS Electron 业务与数据验收完成，发现的两项问题已修复。负载期 RSS 仍上升，边界见下方。

## 范围

macOS 上可见的 Electron 生产入口，以隔离 SQLite 工程执行拓扑筛选、分页、原记录编辑、Access/Trunk/VLAN 风险与未知状态、项目切换、27 表 Excel 导出与导入、退出重启核对。测试工程含124设备、246接口、123连接，图中每页最多40设备；不启动网络探测。

完整机器证据保留在工具工作区 `scratch/2026-11-01-tools-business-acceptance/nettool/`。`formal` 是修复前已加载的 renderer 取证；`formal-fixed` 是两项修复后生产构建的独立完整重跑。两轮分别计时，不混算。

## 修复

1. 拓扑设备与连线 Enter 事件增加防止默认动作。原有行为打开编辑窗后，焦点移动到关闭按钮，同一次 Enter 的浏览器默认点击会立即关闭弹窗。真实 Tab/Enter 失败证据与节点/连线 × Enter/Space 回归覆盖这一问题。
2. 项目页面 KeepAlive 宿主以项目 ID 为边界释放缓存。原有项目切换只停用旧 ProjectPanel，旧嵌套界面仍通过 FeedbackBanner 的 document 事件引用保留。10轮独立诊断中，项目往返后 visibilitychange 监听从6变106，强制 GC 后不降；宿主按项目重建后每轮精确保持基线。History 与 Calculator 类似入口各10轮也覆盖，普通计算器导航草稿仍保留。

独立双 GC 诊断旧版保留25,155 DOM/5,540监听/23.7 MB JS，修复版2,185 DOM/480监听/7.37 MB JS，接近无操作基线2,181 DOM/467监听/5.03 MB JS。诊断另启隔离进程，报告 `acceptanceEligible:false`，不能代替正式同进程自然静置。

## 基础验证

在源码目录执行 `npm test`：343通过、1既有跳过、0失败；`npm run build`：退出0。项目无 lint 脚本。

`npm run test:ui -- tests/ui/topology.spec.js tests/ui/topology-keyboard.spec.js tests/ui/topology-lifecycle.spec.js tests/ui/desktop-style.spec.js tests/ui/projects.spec.js tests/ui/planner-import.spec.js tests/ui/feedback.spec.js tests/ui/subnet-calculator.spec.js`：19通过，41.2秒。生命周期计数再加入原生持久化结束、项目标题及两帧绘制守卫，专项3通过，5.2秒。

拓扑测试覆盖浅色/深色、普通/大字、侧栏展开/折叠、1440×900/920×620共16显示组合；32张图与编辑窗截图。另在相同124设备工程观察40次 UI 筛选/翻页到两帧绘制（包含自动化与IPC开销）：P50 32.9 ms、P95 50.0 ms、最大50.3 ms。

## 正式长跑

修复版 `formal-fixed` 退出0，负载1200.3768秒、同进程静置180.0044秒，480轮/8160次操作与持久化核对、81次预期拒绝、0非预期 pageerror。每次采样核对同一 renderer identity、可见文档与原生窗口；正式进程未触发 GC 或重载。环境为 macOS27.0.1 arm64、Node26.10.0、npm11.19.1、Electron43.1.0，同机其他产品并发运行。

| Renderer 指标 | 修复前完整取证（240轮） | 修复后正式验收（480轮） |
| --- | ---: | ---: |
| 负载 / 静置（秒） | 1205.1515 / 180.0044 | 1200.3768 / 180.0044 |
| RSS初始 / 峰值（MiB） | 166.92 / 2653.86 | 166.95 / 875.34 |
| RSS末次负载 / 静置末（MiB） | 2550.02 / 470.20 | 873.69 / 532.06 |
| 负载末四分之一 RSS 中位（MiB） | 2460.70 | 784.89 |
| 负载 / 静置 CPU累计（秒） | 1202.97 / 2.39 | 736.60 / 0.21 |
| 末次只读观察 DOM / 监听 | 553470 / 121920 | 2232 / 487 |
| 末次只读 JS / 嵌入堆（MiB） | 379.47 / 216.50 | 9.64 / 15.41 |

两轮可见文档均为1170节点、主进程活动句柄采样为0；这些计数本身无法看到已分离界面。只读 CDP 观察显示修复版自然静置期间回落至2188节点/480监听，末次为2232/487，接近独立无操作基线；旧版静置末仍保留55万节点和12万监听。该证据支持旧项目界面保留问题已修复。

修复版负载期 RSS 继续上升，静置末532.06 MiB也高于初始166.95 MiB；尚未归因全部原生或分配器保留，不能据此宣称所有资源稳定或不存在其他泄漏。没有为降低该值追加强制 GC 或重载。

实际导出工作簿27表、246逻辑配置行、344426字节；非法外项目引用导入拒绝且原工程不变。合法导入创建新设备/接口/连接/网段 ID，全部位置、角色、状态、逻辑模式/VLAN/未知值、业务关联、连接端点及228条派生问题语义与源工程相等。SQLite `quick_check=ok`、schema版本1、6表，退出重启后全工作区逐值一致。证据分别为 `report.json`、`summary.json`、`import-semantics.json`、`before-restart.json`、`heap-observer.jsonl`、原生SQLite及实际工作簿。

旧版两次启动 PID42608/92548、修复版 PID78012/16010 均已实际核对退出，只读堆观察器退出0且无测量错误。隔离数据及证据保留在工作区 scratch，不删除用户数据。

可复跑入口：先执行 `npm run build`，再运行 `node scripts/verify-topology-soak.mjs --out=/absolute/unused/isolated/path --seconds=1200 --idle=180`。输出目录由脚本独占，保留进度与隔离数据。机器资源受同机其他产品并发影响，有限时长结果不代表无限负载证明。

## 边界

本轮不包含安装包、Windows/Linux实机、现场网络或设备配置真实性；NetTool 当前只有 Electron。测试未修改用户配置或剪贴板，未打包、上传或发布；源码归档提交号见工具工作区持续验收总任务。
