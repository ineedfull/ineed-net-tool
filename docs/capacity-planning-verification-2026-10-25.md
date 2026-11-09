# PoE 与带宽验证记录（2026-10-25）

本记录针对B2项目工作台界面与原生交接。源码原目录修改，没有提交、发布、上传或安装包生成；保留既有B1/时间显示及其他会话改动。

## 范围和环境

在macOS arm64真实Electron43开发态窗口运行Playwright，Vite生产构建后加载。测试用`NET_TOOL_TEST_DATA`指向系统临时独立目录，实际SQLite、IPC、ExcelJS与XLSX文件；测试结束清理目录，不读取用户数据，不扫描网络。文件选择器返回隔离测试文件路径，其余使用真实导出、预览、确认、保存与重启流程。工程需求关联实际本项目网段，以真实workspace sibling networks同时覆盖UI和Excel报告上下文。

## 原生行为

`tests/ui/capacity-planning.spec.js`覆盖：

- 缺省计划不自动启用，显式空计划保存；预算/PoE/上联/业务项四类新增、编辑、删除及准确标题、默认比例。
- 两条12W、25%损耗→各15W/共30W；40W预算、20%预留→32W/余2W；单口14W仍使整机显示不足。
- PoE供电方向自动推导受电端；反向供电产生的未登记整机预算行能正确定位其设备。
- 1000↔100Mbps、20%预留→80Mbps；正向40×1.2×2×50%=48Mbps/余32Mbps，反向60Mbps/余20Mbps独立。无业务方向明确0；空并发保存null、0保存0；改参数立即重算，单端缺失时不足和待补充并存。
- 重复预算/负载/上联关联拒绝；有业务的上联、被引用连接、接口和设备删除拒绝；交换连接端点造成快照失配拒绝。
- 实际SQLite触发器使项目UPDATE失败，草稿未丢失、数据库未改变、模态焦点保持；重复requestSubmit期间按钮busy禁用。移除触发器后重试成功。
- 切项目清理旧草稿，另一项目不启用计划；返回原项目记录保留。
- 实际21表XLSX导出/读取、原生预览显示四类数量、导入为新项目；工程、设备、接口、连接和容量ID全部重建，实际关联网段及需求引用重建，上联快照与连接一致；报告仍为PoE余2W、方向余32/20Mbps。
- 完整关闭Electron进程后重新启动，深比较持久化项目并检查结果。

## 显示矩阵与证据

浅/深×普通/大字×展开/折叠菜单×1440×900/920×620共16种原生组合，检查内容不使页面横溢、四类对话框header/footer在视口内、长设备/端点/方向标签、内容滚动到备注和Tab模态焦点。表格局部滚动，长端点换行。每组合保存工作台及四类表单顶部/底部截图；另存窄窗下四类结果表截图。

默认截图位置：`test-results/capacity-planning-capacity-cfab8-ifecycle-and-display-matrix/evidence/`（来自`testInfo.outputPath`）；可显式设置`NET_TOOL_CAPACITY_EVIDENCE_DIR`。代表截图：`light-normal-1440-expanded-workbench.png`、`dark-large-920-collapsed-业务项-top.png`、`dark-large-920-collapsed-业务项-bottom.png`、`dark-large-narrow-poeLoads.png`、`dark-large-narrow-uplinks.png`、`dark-large-narrow-trafficDemands.png`。实际图片为Retina像素，窗口尺寸以BrowserWindow逻辑像素核对。

## 验证命令与边界

初始缺页签原生RED后实现并转GREEN；完整原生用例及临近工程/设备/项目用例6/6通过；相关领域、存储、Excel回归147/147通过；`npm run build`、所改文件Prettier检查、`git diff --check`通过。完整逐次命令/结果和截图检查记录见`.superpowers/sdd/2026-10-25-capacity-planning/task-3-report.md`。

没有运行浏览器预览独立验收、Windows/Linux原生、安装包启动或Microsoft Excel应用；开发态Electron验收不等于这些平台或分发产物通过。最终控制会话门禁见下文。规划结论不代替现场验收。

## 最终审查与修复后门禁

三步实现分别通过独立规范/质量审查。整体复核另发现并修复两项边界：缺少端点速率或整条上联未登记业务时，待补充状态必须传递到方向行；多台缺预算设备须按设备身份独立显示状态与定位新增预算。同步更正文档旧表数。修复前领域/序列化XLSX和真实Electron均复现失败，修复后专项Node42/42、原生容量2/2通过；定向复审三项全部通过，没有开放发现。

最终源码的控制会话验证：

- `npm test`：259项，258通过、0失败、1原有跳过。
- `npm run build`：成功，生产渲染器用于下述完整桌面回归。
- `npm run test:ui`：40/40通过（1.8分钟），包含新增多设备/方向状态回归、原生容量完整流程和16种显示组合。
- 明确列出的本次产品/测试/说明文件Prettier检查与`git diff --check`通过。

控制会话人工检查代表性的浅色普通宽屏、深色大字窄屏、表单首尾和PoE/方向结果表；自动矩阵不等于人工逐张查看全部截图。完整日志和212张容量截图归档于工具工作区`scratch/2026-10-25-nettool-capacity-planning/`。没有额外浏览器、其他系统、安装包或现场长期压力验收。
