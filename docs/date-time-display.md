# 界面时间显示

三款 Ineed Tool 及未来 Tool 采用同一显示规则；本产品实现入口为 `src/domain/date-time.js`。独立仓库不通过工作区外部路径导入其它产品源码。规则与 LinkLab 的 `packages/workbench/src/model/dateTime.js` 对齐。

- 默认显示本机时区 `YYYY-MM-DD HH:mm:ss.SSS`，固定补齐毫秒，不依赖系统语言或地区格式。
- 紧凑实时列表、图表时间轴可使用 `HH:mm:ss.SSS`；详情或悬停提供完整日期。历史与详情默认保留完整日期。
- 核心 formatter 接受安全整数毫秒或显式带 `Z` / `±HH:mm` 时区的 ISO 日期时间。epoch 0 有效；缺失、负值、非整数、无时区字符串和无效日期显示 `--`。
- 显示转换不修改协议、存储、原始导出、文件名、应用身份或数据目录。持续时长、延迟、TTL、倒计时和日期输入控件沿用各自语义。

## 兼容现有安装

- 诊断时间、扫描观察、目标查询与历史详情统一调用 `formatDateTime()`；日期有效期由 `formatCertificateTime()` 在显示层接受 Node TLS 的英文 GMT 字符串，转为相同本机时间格式。
- 证书 `validFrom` / `validTo`、证书链、历史 ISO 时间及 JSON 导出保留原值。Ping TXT 原始记录继续使用既有“时间未记录”说明，这是已有导出文本契约。
- 维护记录的日期是业务日期，仍使用 `YYYY-MM-DD` 和原 date 输入控件。

## 验证入口

`npm test`、`npm run build`；`npm run test:ui -- tests/ui/ping-log.spec.js tests/ui/address-map.spec.js tests/ui/network-tools.spec.js tests/ui/history-details.spec.js` 使用隔离数据及回环目标验证 Electron 时间显示、旧历史及原始导出。当前没有 lint 脚本。NetTool 当前仅支持 Electron。
