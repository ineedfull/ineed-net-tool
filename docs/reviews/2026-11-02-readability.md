# NetTool 可读性审查与整理（2026-11-02）

## 范围与结果

本轮沿工程拓扑 → 登记设备/接口 → VLAN逐段校核 → 人工验收项 → 项目保存路径阅读。NetTool当前仍只实现Electron。

| 阅读障碍 | 已实施处理 |
| --- | --- |
| `page` / `portPage`、通用查找函数与模板切片混杂 | 明确设备/接口分页，提取可见记录与报告标签 computed，Map集中索引位置、设备、接口和图节点 |
| 领域层 `e` / `i` / `cfg` / `nets` 跨较长流程 | 改为 engineering、infrastructure、logicalConfig、networkById 等业务名，`checkVlanCarrier` / `addIssue` 标明目的 |
| 保存后页面导航与项目归属不直观 | `createAcceptanceCheck` 显式捕获 projectId，注释保存/导航归属；继续由ProjectPanel按项目key挂载 |
| 测试仍保留功能尚未存在时的动态导入/函数名分发脚手架 | 改为静态导入与直接调用，缺失模块/导出直接让测试失败 |

本轮未发现需改变拓扑/VLAN业务行为的新缺陷。位置过滤、边界设备、分页、未知资料及人工验收语义保持现有约定。不能把登记参数一致理解成现场连通、路由或隔离有效。没有修改数据库版本、工作区JSON、IPC或原生诊断范围。

## 验证

根目录 `npm test` 343通过/1既有跳过；最终命名调整后 `node --test tests/topology.test.js` 8通过。`npm run build`、`git diff --check` 通过；本项目没有lint脚本。

`npm run test:ui -- tests/ui/topology.spec.js tests/ui/topology-keyboard.spec.js tests/ui/topology-lifecycle.spec.js` 8通过。使用真实macOS arm64 Electron开发宿主及隔离SQLite，覆盖拓扑/原记录编辑/VLAN风险/人工验收/重载，Enter与Space，以及项目轮换监听释放；业务用例内遍历16显示组合（浅深、普通/大字、展开/折叠、1440/920），截图已检查。

未重新运行长时压力、安装包或Windows/Linux实机；未提交、打包或发布。阅读入口：[代码阅读地图](../code-reading-map.md)。
