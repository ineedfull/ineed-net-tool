# iNeed Net Tool

## What This Is
独立的网络诊断桌面软件，为用户规划 IPv4 地址、探测地址响应、执行持续 Ping 和逐跳路由探测。界面与同目录下 MQTT Tool、LinkLab 保持同一套配色、字号、导航和控件风格。

## Core Value
从地址规划到连通性诊断，用户可在一个工作区得到真实、可解释、可保存的结果。

## Requirements
### Validated
用户已确认独立应用，包含 IPv4 规划、IP 探测、Ping、路由探测四项功能；使用同系列 UI。
### Active
- [ ] 四个功能真实可用，可取消正在运行的任务。
- [ ] 规划与任务记录持久化，关闭升级不清除已有数据。
- [ ] 与现有工具统一浅色/深色语义配色和排版。
### Out of Scope
- 第一版不做自动更改网络配置、漏洞扫描、IPv6 地址规划。
- 第一版先交付 Electron/macOS 实测；Tauri 原生端和 Windows/Linux 打包后续实施，不能宣称已验证。

## Context
现有参考项目使用 Vue 3、Vite、Electron 和 lucide 图标；系统为 macOS arm64，具有系统 ping/traceroute。复用视觉语义，不复制 MQTT 或 Modbus 业务。新应用的数据目录和 bundle ID 独立。

## Constraints
- 无响应不等于地址空闲；配置分配状态和探测状态分开。
- renderer 无 Node 权限；探测使用校验后的参数数组，不执行用户 shell 文本。
- 不自动探测用户局域网。验证使用回环地址和本地 TCP 服务。
- 大范围扫描有界并发，实时日志有界缓存，关闭时终止子进程。

## Key Decisions
| Decision | Rationale | Outcome |
|---|---|---|
| 暂名 ineed-net-tool | 与现有命名一致，可后续品牌化 | Pending |
| 首版 Electron + Vue，共享纯 JS 领域层 | 先交付当前设备可用版本，便于增加其他运行时 | Pending |
| ICMP + 可选 TCP 探测 | 避免仅凭 Ping 判定设备不可访问 | Pending |
| SQLite 分表、WAL 与事务保存 | 用户明确要求 SQLite；旧 JSON 保留并迁移到默认项目 | Implemented |
| Excel 模板、预览校验、导入新项目 | 支持现场登记与交接，避免覆盖既有项目 | Implemented |

## Evolution
每次功能交付更新验证记录与限制；用户验收后再标记为已验证需求。

*2026-09-21：根据当前会话初始化。*
