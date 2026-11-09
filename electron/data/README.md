# 离线 MAC 注册机构库

`oui.json` 来自 IEEE Registration Authority 的公开地址分配列表：

- MA-L（24 位）：https://standards-oui.ieee.org/oui/oui.csv
- MA-M（28 位）：https://standards-oui.ieee.org/oui28/mam.csv
- MA-S（36 位）：https://standards-oui.ieee.org/oui36/oui36.csv

文件记录获取时间、来源和前缀与机构名的对应关系。当前快照包含 53,985 条记录；使用最长前缀优先匹配。本地管理、组播、无效 MAC 不按厂商前缀识别。注册机构可能是网卡／模块供应商，不能等同于整机型号或品牌。

开发时执行 `node scripts/update-oui.mjs` 更新；需要 Node.js 和 curl。脚本分段下载并验证长度、ETag 与最低记录数量，完成全部来源后才写入。应用启动时不更新数据、不调用外部 MAC 查询服务；此文件通过 `electron/**/*` 随安装包分发。
