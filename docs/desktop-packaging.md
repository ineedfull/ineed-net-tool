# 桌面安装包构建与验收

NetTool 使用与 MQTT、LinkLab 相同的发布脚本和清单格式。当前产品只有 Electron；`release-product.json` 中的 `runtimeDirectories` 将 Electron 指向仓库根目录。`--runtime=all` 只构建已经配置的运行时，指定 Tauri 会在创建产物目录前失败。

## 平台与格式

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| macOS | arm64 / x64 | DMG |
| Windows | x64 | NSIS 安装向导 EXE，当前用户安装 |
| Linux | x64 | DEB、AppImage |

Windows 向导提供中英文、安装目录、快捷方式与卸载入口；卸载保留应用数据。应用 ID 仍为 `com.ineedfull.net-tool`，产品名和用户数据目录沿用现有安装。Linux 使用 `build/icon.png`，Mac/Windows 使用已有 ICNS/ICO。

这些目标是脚本配置，不是目标系统验收。现有本地产物仍是旧的 macOS arm64 `.app` 目录；本轮没有生成新的 DMG、EXE、DEB 或 AppImage。

## 命令

在本产品仓库执行：

```sh
npm ci
npm run test:release
npm test
npm run build

# 只读计划：不会创建安装包或访问 MinIO
npm run release:plan -- --platform=macos --arch=all
npm run release:plan -- --platform=windows
npm run release:plan -- --platform=linux
```

在对应目标操作系统构建：

```sh
# Mac，生成 arm64 + x64 DMG
npm run package:desktop:mac

# Windows x64，生成 NSIS EXE
npm run package:win

# Linux x64，生成 DEB + AppImage
npm run package:linux

# 只构建一个任务
npm run release:build -- --platform=macos --arch=arm64 --runtime=electron
```

`package:mac` 是标准 Mac 安装包命令的兼容别名，默认构建两个架构。原先只生成未签名 arm64 `.app` 的命令改为 `package:mac:dir`，供已有桌面测试继续使用；历史文档中的 `package:mac -- -c...` 命令应使用这个目录入口。

新流程以参数数组调用 Node/Vite/electron-builder，不使用 `.cmd` 或 shell 拼接；构建前重新生成 renderer。每次构建使用独立暂存目录与构建锁，成功集合位于 `release/desktop/<版本-时间-随机标识>/`，不会覆盖旧包。失败保留 `.stage-*` 日志，不生成成功集合。

Electron 和 builder 的二进制镜像默认使用 npmmirror，可由 `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` 覆盖。`INEED_ELECTRON_DIST` 可指向包含对应版本/平台/架构 Electron 分发 ZIP 的已核实缓存目录；`.app` 测试入口仍可通过 `-c.electronDist=...` 传入本机发行目录。

## 清单与文件

```text
release/desktop/<buildId>/
├── manifest.json
├── build-logs/
└── ineed-net-tool-<版本>-electron-<系统>-<架构>.<扩展名>
```

EXE 名称带 `-setup.exe`；DEB 文件名使用 `amd64`，清单架构统一记为 `x64`。清单记录源码提交/是否有未提交改动、运行时与平台矩阵、每件产物的大小和 SHA-256。

```sh
npm run release:verify -- --dir=/完整路径/release/desktop/某次构建目录
```

校验拒绝缺件、重复/额外文件、路径逃逸、软链接、格式头错误、大小或摘要变化。它只验证集合完整性，分别返回安装、运行和签名未验收，不替代完整安装包解析或实际启动。

## 私有 MinIO 上传

```sh
npm run release:upload -- --dir=/完整路径/release/desktop/某次构建目录
```

沿用 `222.71.62.146` 的 SSH/`myminio` 别名，写入私有 `ineed-downloads/ineed-net-tool/<版本>/<buildId>/<文件名>`。脚本先校验整个本地集合，再逐件上传、回读远端大小和 SHA-256；相同对象已存在时校验后跳过，字节不同会失败。收据位于 `release/uploads/ineed-downloads/<buildId>.json`。

脚本不读取或输出 MinIO 管理密码，不修改公开访问策略。上传不代表网站下载、签名或正式发布；本轮只用内存传输夹具测试，没有连接服务器或上传文件。

## 构建环境与验收边界

使用项目要求的 Node 22.16+ 和锁文件。Mac 需 Xcode Command Line Tools；Windows/Linux 在对应系统准备 electron-builder 要求的构建依赖。NetTool 不需要 Tauri 或 Rust 工具链。Windows/Linux ARM64 不在当前矩阵中。

每种系统/架构独立验证安装、图标、普通用户启动、关闭重开、SQLite 迁移与旧历史保留、卸载策略、中文/空格路径，以及网络诊断、项目与 Excel 导入导出。配置目标不能代替这些验收；AppImage 仍需检查 glibc/FUSE 等系统要求。

本轮三平台计划、Electron 配置 schema、产物完整性与模拟上传回归、NetTool Node 测试和 renderer 构建通过。没有实际安装包构建、Windows/Linux 原生安装、Mac Intel 实机、正式签名/公证、自动更新或公开发布验收。

## macOS 内部名称

`build.mac.extendInfo.CFBundleName` 必须与 `build.productName` 完全一致，包括大小写；Chromium 据此定位 Helper。对外品牌用 `CFBundleDisplayName` 保留“iNeed Net Tool”。更改打包名称后应从最终 DMG 提取应用并启动验证，不能只检查文件摘要。
