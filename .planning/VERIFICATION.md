# 2026-09-21 首版验证

## 已通过
1. `npm test`：16 项测试；IPv4 全地址范围、CIDR/掩码、/31 /32、VLSM 容量与对齐、扫描范围上限、分配校验、Ping 统计。
2. 原生执行：回环 Ping 2 次全部响应；回环 traceroute 确认到达；TCP 端口开放和拒绝的依据不同；持续 Ping 停止后无新结果；扫描暂停/继续完成全部地址。
3. 存储：队列并发更新不会丢失规划/历史；损坏文件不会被空配置覆盖。
4. `npm run build`：生产前端成功构建。
5. `npm run test:ui`：真实 Electron 窗口、真实回环通信的完整用户操作流程通过。使用临时数据目录，未扫描用户局域网。
6. 浅色与深色大字模式、1360 与 960 宽度下页面无横向溢出；检查了截图。
7. 对 `release/mac-arm64/Ineed Net Tool.app` 运行同一原生 UI 流程，5.2 秒通过；验证了包内 IPC、领域模块动态导入、真实网络任务和重启数据恢复。

## 验证边界
仅在当前 macOS arm64 验证了 ICMP / TCP / 原生 traceroute。不代表 Windows/Linux、现场设备、防火墙、跨网段路由和高并发长时间负载全部验证。

UI 输出：`test-results/electron-native-desktop-pl-93b28-tory-and-consistent-layouts/`，包含规划、扫描、Ping、路由以及深色窄窗截图。

## 设计依据
以同目录 MQTT Tool 的 `packages/workbench/src/styles/desktop.css` 和 `typography.css`、LinkLab 的桌面布局为参考。按新项目技能整理了范围、数据保护约束和验证清单；实现保持独立目录和独立数据路径。

## 2026-09-21 桌面 UI 统一复核

NetTool 已对齐 MQTT Tool / LinkLab 的侧栏、顶栏、底部入口、控件与字号，设置和关于改为同风格模态框。详见 `docs/ui-2026-09-21/README.md`。22 项领域/原生测试、3 项 Electron UI 流程、生产构建与修改文件格式检查通过；独立 macOS arm64 本地体验包再次执行 3 项 UI 流程通过。主题预览放弃/保存、键盘焦点、窄窗口与大字模式均已检查，未使用用户数据或扫描局域网。
