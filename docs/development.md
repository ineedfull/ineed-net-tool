# NetTool 开发指南

[返回产品首页](../README.md) · [代码阅读地图](code-reading-map.md) · [完整功能参考](feature-reference.md)

## 安装与启动

需要带 `node:sqlite` 的 Node.js 22.16+，使用 npm 和仓库锁文件。

```sh
npm ci
npm start
```

`npm start` 构建 renderer 后启动品牌 Electron 宿主。`npm run dev` 在 Vite 配置端口 5187 启动浏览器预览，可执行本地规划；浏览器没有真实网络探测或 Excel 导入导出能力。预览 localStorage 与桌面 SQLite 独立。

```text
electron/         原生入口、白名单 IPC、网络任务、SQLite 与 Excel
src/domain/       IPv4、子网、工程与规划校验
src/components/   项目、台账、地址规划和诊断页面
src/runtime.js    桌面 API 与受限浏览器预览适配
src/style.css     系列视觉变量与布局
tests/            领域、任务、存储与 Electron UI 验证
```

## 验证

```sh
npm test
npm run build
npm run test:ui
```

没有 lint 脚本。UI 测试启动真实 Electron，可设置 `ELECTRON_BINARY` 指向现有二进制；具体本机环境与品牌缓存见[宿主说明](desktop-branding.md)。原生命令使用参数数组，不执行用户 shell 字符串；退出必须清理任务与子进程。测试使用隔离数据及回环服务，不自动扫描现场网络。

本机验证重点为 macOS arm64 的 ICMP/TCP 回环、DNS/TLS/HTTP 服务与系统路由工具；Windows/Linux 命令分支和桌面需要对应系统实机验收。最新已归档边界见[功能矩阵](existing-features-acceptance.md)与[压力验收](reliability-soak-2026-10-14.md)。

## 数据与备份

应用 ID `com.ineedfull.net-tool`。macOS 数据库默认在 `~/Library/Application Support/Ineed Net Tool/workspace.sqlite`；实际位置以当前应用为准。SQLite 使用 WAL 与事务，校验或写入失败回滚，损坏/未知版本不以空数据覆盖。

首次迁移读取旧 workspace.json，保留原文件；已有 SQLite 时不重复导入 JSON。完整备份先退出应用再复制整个数据目录。项目 Excel 用于规划、台账与维护交接，不含外观与诊断历史；导入 Excel 创建新项目。JSON 导入仍须通过结构、数量与字段校验，单文件限制 128 MiB。

切页保留同项目草稿，切项目隔离数据；异步导入期间切换上下文应取消导入。IP 探测“无响应”不代表空闲，规划不会自动改写现场设备参数。

## 界面、图标与安装包

遵循[桌面 UI](ui-2026-09-21/README.md)、[时间规则](date-time-display.md)和既有语义 token。项目调用链、任务事件合并与清理顺序见阅读地图。

当前图标副本是 `src/assets/icon.svg` 和 `icon-small.svg`，品牌源统一维护后同步；用 `npx @tauri-apps/cli icon src/assets/icon.svg --output build` 生成安装资源。该图标生成命令不表示产品支持 Tauri。

标准安装包使用 `release:plan/build/verify`，当前仅 Electron；DMG、Windows NSIS、Linux DEB/AppImage 的系统工具链与原生验证边界见[桌面打包](desktop-packaging.md)。`package:mac:dir` 是本机 arm64 测试 .app 入口，历史 release 子目录不作为当前包位置。远端 `release:upload` 仅在明确发布任务执行。

首页截图来源及更新要求见[图片维护](images/readme/README.md)。
