# NetTool 本机持续压力与异常输入验收

本轮只验证现有功能，没有增加产品功能，也没有修改产品代码。环境为 macOS arm64、Node.js 26.10.0、Electron 43.1.0，基线提交为 `39dec2e7c02aa410d87a39c99d6b31fbae1b4296`。验证启动仓库真实 Electron 主进程、生产构建 renderer、受限 preload 与隔离 SQLite，不替换原生网络探针。

## 可重复入口

```sh
npm run build
node scripts/verify-network-soak.mjs --minutes=20
node scripts/verify-network-hostile.mjs
node scripts/verify-network-boundaries.mjs
```

脚本会打印临时证据目录，保留 `report.json` 与隔离数据。Soak 使用 `/tmp/nettool-soak-*`，异常输入使用 `/tmp/nettool-hostile-*`，最大规模使用 `/tmp/nettool-boundaries-*`。这些目录可以在应用退出后自行清理；脚本不会清理用户配置。仓库中的精简统计见 `reliability-soak-2026-10-12.json`。

Soak 从可见 UI 启动 200ms 持续原生 Ping，每五秒并行运行一次 128 路 TCP 地址探测、128 路端口探测、本地 DNS、下载、TCP 链路质量与证书检查，并发保存八次项目资料和一次设置。每三轮暂停扫描，交替恢复或停止；每八轮中止流式下载。DNS 包含正常、本地不存在域名和本地不应答；下载包含文件、流式、HTTP 503 和响应停顿；证书包含自签名证书及非 TLS 服务。每十秒采集真实 Electron 内存/CPU、主进程活动句柄和远端套接字地址。停止后检查 Ping 500 条明细及原始记录、100 条诊断保留上限，重启核对全部记录内容、项目资料和设置。

持续 Ping 和切页使用真实 UI。重复多工具任务及保存竞争通过真实 renderer 的 `window.netTool` preload API 提交，属于 IPC/原生压力入口。产品正常 UI 的任务启动会重置任务 ID；直接调用桥接的新任务不会代替已有 UI 任务视图。因此本报告不会将全部循环数称为用户按钮操作次数。异常输入脚本另用可见按钮重启下载 40 次，每次切页再返回，检查真实 UI 完成状态与持久化流量；定向 UI 用例补充项目保存竞争。

全部探测目标为 `127.*`，DNS 服务器明确指定本机 UDP 测试端口，域名只发送给该服务器。Ping 的回环目标信息分支读取本机名称，不做公网 PTR 或邻居查询。HTTP/TLS 测试服务只监听 `127.0.0.1`，不跳转公网；原生活动套接字采样也要求远端为回环。最大端口测试只建立本机 TCP 连接，不发送应用数据。

## 最大规模与异常响应

真实 UI/TCP 地址探测 `127.0.0.0/16` 完成 65,534 个地址，耗时 53.246 秒，128 路并发。验证 UI 暂停/恢复、切页、每页 100 条、末页 34 条和最后地址 `127.0.255.254`，导出 JSON 完整包含 65,534 条。真实 UI/TCP 端口探测 `127.0.0.1:1-65535` 完成全部 65,535 个端口，耗时 2.012 秒，记录 53 个开放、65,482 个拒绝连接，0 超时、0 错误。开放端口数是当时本机环境的事实，不是可重复测试的固定期望。两条完整记录均通过 SQLite 重启恢复，重启后的原生活动句柄为空、renderer 异常为 0。

异常输入脚本完成 60 项，包括布尔/数组/无穷数值、过长端口和域名、shell 元字符/换行、DNS 服务器注入、超限 Ping 载荷、128 MiB + 1 字节 JSON 文件、HTTP 重定向循环、压缩响应、提前断流、空响应、停顿、非法 HTTP 文本，以及 TLS 握手超时和中止。32 次同类扫描并发提交只接受一个任务，其余 31 个被拒绝。40 次下载使用可见 UI 重新开始。结束时测试服务活动套接字为 0，主进程没有 ChildProcess，renderer 异常为 0。

Soak 前置另确认 13 个非法输入/导入被拒绝、非法保存不覆盖项目，renderer 不暴露 `require`、`process` 或 `ipcRenderer`，只提供既有 `netTool` 白名单桥接。该检查不等同于完整安全审计。

## 本次证据与结论

持续运行 1,200,336ms，完成 240 轮、1,441 项任务、462,679 条结果、339,279,872 字节下载和 2,160 次并发保存。任务结果为完成 1,244、主动停止 71、预期错误 126、非预期错误 0；Ping 5,648/5,648，明细和日志各保留 500 条。原生远端套接字为空，没有残留子进程；renderer 异常为 0。精简统计已写入同名 JSON。

原 20 分钟脚本完成产品断言后，测试 TCP 服务未读取 TLS ClientHello，客户端 FIN 被留在暂停的读缓冲后，收尾退出码为 13。因此不能将原脚本报告为退出成功。夹具增加 `socket.resume()`，失败回归从 1 秒收尾超时变为通过。修复后另跑 50,098ms、10 轮，覆盖第 9 轮非 TLS 证书检查，全部断言、真实 Electron 重启和测试服务关闭通过（`/tmp/nettool-soak-4oLkYU/report.json`，`passed=true, fixtureClosed=true`）。短跑按实际任务数检查历史上限；20 分钟历史 100 条另用真实 Electron 重启逐字段复核（`/tmp/nettool-soak-ZQpxey/recovery.json`）。

主进程 RSS 首次 206.3 MiB、峰值 384.5 MiB、最终 316.3 MiB；renderer 首次 196.2 MiB、峰值 1,011.3 MiB、最终 888.8 MiB。五分钟后的线性趋势分别约 -4.0 和 -3.9 MiB/分钟。大量结果下 renderer 内存占用仍高，本次有限样本只能确认该时段表现。

独立最大规模证据为 `/tmp/nettool-boundaries-vGXADX/report.json` 与 `scan.json`；异常输入证据为 `/tmp/nettool-hostile-dOjyMj/report.json`。持续运行证据为 `/tmp/nettool-soak-ZQpxey/report.json`，外部日志为 `/tmp/nettool-soak-launch.log`。

`npm test` 92/92 通过；`npm run build` 通过；实际 Electron 的 `network-tools.spec.js`、`reliability.spec.js`、`workspace-lifecycle.spec.js` 定向 UI 用例 6/6 通过。UI 日志为 `/tmp/nettool-soak-ui.log`。早期验证脚本把合法可省略的 null 参数当成必拒输入、停止已经结束的短文件下载，后来修正了验证假设；TLS 停顿服务也改为读取 ClientHello，让服务器能够观察客户端 FIN。这些都是测试夹具调整，没有作为产品缺陷处理。

本轮三款工具在同机并行验证；前段另有短暂定向 UI/异常输入应用，中段执行最大规模本地 TCP 测试。吞吐和内存是该并发负载下的实测，不能等同于单独运行、现场网络或多小时运行结果。有限时间内的内存平台与资源清理不证明没有内存泄漏。

NetTool 当前仅有 Electron。本轮不包含浏览器预览、Tauri、Windows/Linux 原生命令分支、用户现场网络、安装包启动或发布；没有打包、push 或 release。
