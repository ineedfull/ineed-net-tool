# 现场验收验证记录（2026-10-27）

本轮在原始 NetTool 目录、macOS arm64 开发 Electron 宿主完成。使用隔离临时 SQLite 数据与 localhost TCP 服务，不访问现场网络、不改用户数据、不打包发布。前置领域、SQLite 与 Excel 实现由独立任务验证；本页记录工作台集成与原生生命周期。

## 实际验证

- 原生 RED：新增“现场验收”页签断言先在未实现版本运行，因页签不存在失败；实现后同一入口通过。
- 正常工作流：无设备项目取消草稿不启用工程数据，保存项目级检查才启用；关联设备/接口/连接检查各自独立。真实 localhost 端口扫描完成并正常保存后，在工作台引用快照。人工失败 → 整改 → 后续通过仍整改中 → 明确选择复验闭环后通过 → 后来失败覆盖旧通过 → 修改语义要求进入待验收 → 当前版新结果重新通过。整改可编辑，结果只追加/查看。
- 依赖与故障：已有结果检查项删除拒绝；被验收引用的父连接删除拒绝；真实 SQLite trigger 拒写，草稿保留、busy 防双提交、焦点仍在原生 dialog，移除 trigger 后重试成功。程序切项目时销毁旧草稿，新项目内容独立。
- 文件：重定向原生保存/打开对话框到临时路径，真实写出并重新读取 XLSX 25 表，显示验收数量预览，确认导入新项目；目标引用重建、诊断出处与快照保留，领域报告重算一致。
- 保留：测试直接删除隔离 SQLite 历史作为历史淘汰后的数据夹具，然后完整退出/重启原生进程；已导入的诊断快照保留。该注入不代表新增了清空历史的产品界面，规划保存 IPC 仍禁止改写诊断历史。
- 时间：主控视觉检查指出初版暴露 UTC ISO 输入，已改为本地 `datetime-local` 控件，`step=0.001`；只有调用领域助手时转换为规范存储时间。原生填写 `2026-10-27T12:34:56.789`，与 renderer 真实时区转换后的 ISO 持久值逐字比较一致，本地预览与详情复用集中格式化函数。
- 显示：浅/深 × 普通/大字 × 展开/折叠 × 1440×900/920×620，共16状态。每状态检查工作台和检查项、结果、整改、复验闭环、结果详情五个窗口的头尾、内部滚动、焦点及页面/窗口横向溢出，共176截图。夹具含长设备/端点与800字符当前/历史要求。
- 主控再次视觉检查发现复验窗口初始选择框空白：已有整改草稿未初始化结果选择字段，已显式设为空值显示“请选择有效复验”。矩阵逐状态断言提示值与两个选项，实际选择后核实可读的当前版 #4 结果文字，再截图；不只是检查对话框外框。
- 最终完整退出/重新启动 Electron 后，整个保存工作区深度相等，页面无 JS 错误。

## 命令结果

- `npx playwright test tests/ui/site-acceptance.spec.js`：初版完整生命周期与16×4窗口通过1/1，32.0秒。
- `NET_TOOL_ACCEPTANCE_EVIDENCE_DIR=.superpowers/sdd/2026-10-27-site-acceptance/evidence-closure-final npx playwright test tests/ui/site-acceptance.spec.js --output=.superpowers/sdd/2026-10-27-site-acceptance/test-results-closure-final`：本地时间修正与16×5窗口最终通过1/1，35.0秒。
- `npx playwright test tests/ui/infrastructure.spec.js tests/ui/capacity-planning.spec.js tests/ui/engineering.spec.js tests/ui/projects.spec.js --output=test-results-acceptance-neighbors`：6/6通过，约1分钟。容量测试唯一调整为当前工作簿21→25表断言，经主控授权。
- `node --test tests/site-acceptance.test.js tests/site-acceptance-storage.test.js tests/site-acceptance-excel.test.js tests/infrastructure.test.js tests/capacity-planning.test.js tests/engineering.test.js tests/projects.test.js`：135/135通过，40.46秒。
- `npm run build`：最终本地时间修正后通过。格式与差异检查见任务报告。

默认截图使用 `testInfo.outputPath`；可用 `NET_TOOL_ACCEPTANCE_EVIDENCE_DIR` 指定根目录，无作者机器绝对路径。最终证据保留于本地 `.superpowers/sdd/2026-10-27-site-acceptance/evidence-closure-final/`，文件名含主题、字号、窗口尺寸、侧栏状态、窗口类型和 top/bottom；`summary.json` 记录矩阵与重启结果，`persisted.json` 为隔离夹具持久数据。

## 边界

本轮是 macOS 开发 Electron 的原生/SQLite/本地 TCP 与真实 XLSX 验证；未运行浏览器专项、Windows/Linux 真机、安装包启动、远程设备或现场网络验收。不是工程标准认证或防篡改审计。大规模合法 Excel 边界由 Task2 单独验证，本轮 GUI 不宣称500/2000/1000最大行渲染压力已验收。主控最终整体门禁与独立复核见下节。

## 最终整体回归与独立复核

现场验收领域、文件、界面和录入排版分别经过独立审查；整体审查发现目标名称缺少设备/端点上下文，修复后独立复审通过，无剩余 Critical/Important。新结果与当前报告共用领域目标名称，接口包含所属设备及登记区域，连接包含两端；最大合法名称615字符，不截断，旧历史名称及诊断出处保持不变。真实 Excel 序列化、重映射与原生结果详情均覆盖。

最终在同一源码树运行：

- `npm test`：332项，331通过、1原有跳过、0失败，37.922秒。
- `npm run build`：通过。
- `npm run test:ui -- --output=.superpowers/sdd/2026-10-27-site-acceptance/final-test-results`：真实 macOS Electron **42/42通过，4.0分钟**。运行时指定 `NET_TOOL_ACCEPTANCE_EVIDENCE_DIR`、`NET_TOOL_FORM_EVIDENCE_DIR` 保留证据，包含完整旧功能与新增验收/排版场景。
- 最终现场验收证据：16显示状态、每状态5窗口、176截图，25表真实文件往返、完整进程重启深度相等，`pageErrors: []`。表单几何：545个界面记录，484对相邻字段上下边差均为0px。
- 18个其余变更代码文件的显式 Prettier 检查通过，`git diff --check`通过。`src/App.vue`、`src/styles/projects.css` 在基线已有格式差异，已单独比对保留；App仅添加history属性，不整文件重排。31个授权文件外的194个基线文件逐字相等，无缺失。

证据日志保留在本地 `.superpowers/sdd/2026-10-27-site-acceptance/`：`final-node.log`、`final-build.log`、`final-ui.log`、`final-format-owned.log`、`final-format-baseline.log`、`final-evidence/`、`final-review.md`和`final-rereview.md`。工作区任务记录交付提交号。

保留两项非阻断维护项：布局回归的行分组可进一步改为独立网格行识别，以免未来不等高标签漏测；Node26.10.0/Playwright1.58.2的`module.register()`弃用及NO_COLOR/FORCE_COLOR环境警告待运行器维护时处理。当前实测对齐通过，应用页面无JS错误。未新增依赖或修改运行器来隐藏警告；上述测试仍限本机开发宿主，不替代其他系统、安装包或现场验收。
