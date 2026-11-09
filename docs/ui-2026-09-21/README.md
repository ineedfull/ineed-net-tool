# NetTool 桌面 UI 统一

NetTool 沿用 MQTT Tool / LinkLab 的桌面助手界面规范。2026-09-21 本次调整覆盖应用外壳、资源导航、操作区、表格、设置、关于以及大字模式。

## 维护入口

- `src/styles/tokens.css`：浅色/深色语义配色、字号和工作台尺寸；对应 MQTT / LinkLab 的 `desktop.css` 与 `typography.css`。这里集中维护 NetTool 的值，当前不是跨仓库共享依赖。
- `src/style.css`：应用布局、导航、表单、表格和诊断内容。
- `src/styles/dialogs.css`：设置/关于弹窗，与两款工具采用相同尺寸、信息层级、边框和背景遮罩。
- `src/components/DesktopDialog.vue`：原生模态框，负责 Escape、背景点击与关闭后的焦点恢复；背景由浏览器自动设为不可操作。
- `SettingsPanel.vue`：设置草稿、实时预览、保存错误、放弃修改；只有保存成功才更新持久设置。关闭恢复未修改的外观，不切换当前工作页面。
- `AboutPanel.vue`：64px 图标、产品定位、版本、真实运行环境与存储方式。版本读取 `package.json`。

## 共同约定

| 元素 | 标准 | 大字模式 |
| --- | --- | --- |
| 正文 / 表格数据 | 13px | 14px |
| 控件 / 表头 | 12px | 13px |
| 辅助信息 | 11px | 12px |
| 面板 / 工作台标题 | 14px | 15px |
| 弹窗标题 | 15px | 16px |
| 产品名 / 汇总值 | 20px | 21px |
| IP / 耗时 / 原始输出 | 13px 等宽 | 16px 等宽 |

- 侧栏展开 240px、收起 58px；顶栏 48px。收起时品牌图标 24px，折叠按钮位于图标下方。
- 侧栏展开底部 42px，设置与关于并排靠左；收起时竖排，保留名称提示与键盘标签。
- 控件高 32px，表格数据行至少 40px；5px 的控件/内容分组圆角，蓝色选中背景和蓝色边框。
- 设置宽度上限 700px，关于宽度上限 480px，弹窗内滚动，页脚操作保持可见。
- 网络参数仍按 IPv4 / 扫描 / Ping / 路由实际任务组织。打开设置和关于时，当前表单与后台任务保留。
- 测试只使用隔离临时数据和回环网络；不自动扫描用户局域网。

## 验证

- `npm test`：22 项通过，包含 IPv4 规划、原生网络任务、并发扫描与本地存储。
- `npm run build`：Vite 生产构建通过。
- `npm run test:ui`：3 项真实 Electron 场景通过，覆盖规划/分配/VLSM、ICMP/TCP 批量回环探测、持续 Ping、路由、历史、重启恢复。
- UI 专项覆盖侧栏折叠、未保存规划保留、Tab 焦点循环、Escape、设置草稿预览/放弃/保存、系统主题切换和大字模式。检查 1360px、960px 和 920px 桌面窗口，页面无横向溢出。
- 修改的 Vue/CSS 与新增 UI 测试经 Prettier 校验。

截图来自真实 Electron 测试窗口，保存在本目录。`test-results/` 由后续测试覆盖，本目录保留本次验收截图。

本次原生验证为 macOS arm64；Windows/Linux 原生网络与安装仍需各自平台验证。

## 本地体验包

已生成 macOS arm64 本地应用：`release/ui-unified/mac-arm64/Ineed Net Tool.app`。该包独立放置，尚未进行发布签名与公证；使用原有应用 ID 和数据目录。

打包后直接以该 `.app` 执行同一套 3 项 Electron 回归，全部通过，覆盖原生网络任务、存储与新版弹窗；测试仍使用隔离临时数据。

复现命令：

```sh
npm run package:mac -- -c.electronDist=node_modules/electron/dist -c.directories.output=release/ui-unified
ELECTRON_BINARY='release/ui-unified/mac-arm64/Ineed Net Tool.app/Contents/MacOS/Ineed Net Tool' npx playwright test --output=test-results-packaged
```


## 操作反馈统一（2026-09-22）

保存、导入、导出、复制等操作结果统一使用 `FeedbackBanner.vue`：

- 右侧关闭按钮支持鼠标和键盘操作，关闭时清空对应提示，不影响已保存的数据。
- 普通成功提示显示 6 秒后自动收起；悬停、键盘聚焦、页面隐藏或缓存页面离开时暂停，恢复后给予完整的 6 秒阅读时间。
- 新操作重新计时，旧提示的倒计时不能关闭新结果；组件离开时清理定时器。
- 操作错误横幅可以手动关闭，不自动消失。字段校验、Excel 校验问题、任务进度与运行限制说明继续保留在对应位置。
- 接入网段计算、地址规划、项目 / 维护记录 / Excel、互联规划、地址台账、历史导出与 Ping 原始记录，以及应用级错误横幅。

验证：生产构建通过；5 项 Electron 用例通过，覆盖网段追加、项目 / Excel / SQLite、Ping 记录，以及提示手动关闭、自动收起、悬停 / 聚焦暂停、重复操作重新计时、缓存页面切换与错误保留。使用隔离临时工作区，网络回归仅访问回环地址。

时间格式、证书有效期显示与历史兼容见[界面时间显示](../date-time-display.md)。
