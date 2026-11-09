# NetTool C：现场验收与交付

用户已批准“提交当前成果→验收清单→结果记录→整改复验→Excel报告”，并授权持续实施。先将已验收的NetTool 46文件提交为`543e1ca`；本轮继续在原目录开发，最终通过门禁后提交本轮明确文件，不push、打包、上传或改网站。MQTT/LinkLab不修改。

## 选择与范围

采用项目内、人工负责的验收台账：检查项关联已有设备/接口/连接或项目；结果追加；引用已有Ping/端口/链路质量记录的有界快照；整改用后续复验结果闭环；报告展示预期、实际、历次结果及遗留问题。相比只在维护备注中填文字，这能保留引用和复验关系；相比新建自动验收执行引擎，本轮复用已有诊断能力，更适合现有工程交接。结论明确为人工登记，不把任务完成、端口开放或规划估算自动称为现场验收通过。

## 可选数据与兼容

新增可选`project.engineering.siteAcceptance`，不依赖必须有inventory。旧项目缺省保持缺省；显式空version1保留。SQLite schema/workspace/engineering/infrastructure版本、应用ID、数据目录、设置、原始历史与保留100条规则不变。所有正常保存/加载/导入路径集成校验，非法写入不改变SQLite或内存状态。

```js
{ version: 1, items: [], results: [], actions: [] }
// item
{ id, revision, name, targetType, targetId, method, expected, owner, note }
// result (append-only in the UI)
{ id, itemId, itemRevision, sequence, measuredAt, operator, outcome,
  actual, note, criteria: { name, targetType, targetId, method, expected, targetLabel },
  evidence: null /* or bounded diagnostic snapshot */ }
// action
{ id, itemId, failedResultId, description, owner, dueDate, note, resolvedByResultId }
// evidence
{ version: 1, sourceId, kind, target, status, startedAt, finishedAt,
  parameters, metrics: [{ label, value, unit }], detail }
```

每项目上限items500/results2000/actions1000。id为非空、无控制字符字符串≤100；新增记录ID在全部场地/需求/容量/设备/接口/连接/PoE/上联及本轮记录中全局唯一。来源sourceId仅为历史出处，不作为可解析外键，不参与新项目ID重建。name1～100，expected1～1000，owner≤100，note≤1000，actual1～2000，operator1～100，description1～2000。所有文本类型严格，不接受数字/对象强转。

targetType为project/device/interface/link；project的targetId必须空，其余必须引用当前工程inventory中对应记录。method为manual/ping/ports/quality。revision为1～1000000整数，新增1；修改targetType/targetId/method/expected时升1版；名称、负责人、备注修改不升版。result.itemRevision为1～当前revision整数，sequence为1～2147483647全项目唯一整数，新增取已有最大值+1，不能靠时间或数组顺序判断最新。outcome为passed/failed/inconclusive。measuredAt与证据时间为有效且规范的UTC ISO毫秒串`YYYY-MM-DDTHH:mm:ss.SSSZ`；显示统一走现有本地`formatDateTime`。dueDate为空或真实`YYYY-MM-DD`日期。

result.criteria保存登记时的名称/目标/方法/要求和目标可读标签；当前版结果的目标/方法/要求必须与item一致，旧版结果保留原快照，不能假装符合新要求。criteria.targetId仍为本项目当前有效目标；引用被删须拒绝并说明先处理验收关联，禁止静默删除。删除有结果/整改的检查项、被引用结果也拒绝。结果在产品UI仅追加/查看，不提供覆盖编辑或删除；本机文件与Excel为人工记录，不承诺防篡改审计。

## 诊断证据

用户选择当前项目已保存的ping/ports/quality终态记录；捕获时验证projectId及method匹配，status仅completed/error/stopped，时间/字段有效。manual必须evidence=null；诊断方法必须有匹配kind证据。passed不能引用error/stopped证据；completed也不自动代表符合预期，仍由工程师登记结论和实际值。允许失败或未完整执行的诊断支持failed/inconclusive说明。跨项目、运行中、未知方法和缺必要身份/时间的旧记录明确拒绝，不改原历史。

捕获仅复制白名单：来源、方法、目标、开始结束时间、终态、测试参数摘要、最多8个有名称/单位的数值指标及错误说明。不复制rows/raw/pingLog/options任意对象。parameters≤2048，detail≤1000，target≤2048；label1～40，unit≤16，value为null或0～1e15有限number（不以真值丢失0）；证据JSON编码UTF8≤8192字节，超限明确失败而非静默截断。Ping含收发、丢失比例及min/max/average；ports含open/closed/timeout/error及实际端口参数；quality含sent/received/failureRate/min/max/average/p95/jitter（按真实字段捕获，未知为null）。参数明确icmp/tcp、端口/次数/超时等原始可用依据，不能推造缺失数据。

保存快照后不依赖历史仍存在；清空/淘汰历史或导入新项目时快照不消失。UI展示“引用快照/人工判定”与来源ID，不将导入快照绑定到本机同ID历史。源项目归属只在捕获时验证，快照不存活动projectId，避免导入错误归属。所有快照字段在SQLite/Excel/JSON路径均再校验。

## 整改和报告规则

action.failedResultId必须是同检查项failed结果；description和负责人/计划日期可记录，空resolvedByResultId表示未闭环。闭环必须选择同项、sequence更大、itemRevision不早于失败项的passed结果。正常UI闭环还要求该结果是当前版最新结果；整改不支持仅勾选“已完成”，不覆盖初测。已闭环记录保留原复验关联；后续升版不会破坏历史闭环，当前项仍需当前版结果。开放整改不可因最新pass而自动关闭。

每项只取当前revision最高sequence结果：无结果/inconclusive→pending；failed→failed；passed且仍有开放整改→rectifying；passed且无开放整改→passed。旧版结果不参与当前通过统计，并显示“要求已变化，需复验”。当后续失败时不能沿用以前通过。空清单pending。整体status为ok/pending/risk：任一failed或rectifying为risk，否则有pending或无items为pending，其余ok。报告逐项含当前目标、预期/实际、检查方法、负责人、当前版/历史结果、证据、开放整改数和状态；保留全部历次结果与整改，不只导出最终一行。

纯API新模块`src/domain/site-acceptance.js`：

- `emptySiteAcceptance()`、`validateSiteAcceptance(plan, engineering)`。
- `siteAcceptanceReport(project, networks = [])`，验证实际同项目网段及工程图，返回enabled/status/items/results/actions/issues/counts/basis。counts为total/passed/failed/pending/rectifying；未启用空数组/明确空状态。不变异输入。
- `saveAcceptanceItem(project, input, networks = [])`：新增/修改，集中升版规则，返回新project。
- `recordAcceptanceResult(project, input, history = [], networks = [])`：input为id/itemId/measuredAt/operator/outcome/actual/note/historyId；集中生成sequence、criteria和白名单证据快照，返回新project。
- `saveAcceptanceAction(project, input, networks = [])`：新增整改或编辑未闭环整改，禁止通过此入口指定闭环。
- `resolveAcceptanceAction(project, actionId, resultId, networks = [])`：校验当前版最新pass后返回新project。
- `remapSiteAcceptance(plan, {devices, interfaces, links}, uuid)`：新items/results/actions IDs与所有业务引用、criteria目标重建，证据sourceId保留出处。由`remapEngineering`使用受控原/新inventory数组映射调用，最终整图校验。不是从Excel用户编号猜内部ID。

`validateEngineering`最后调用可选验收验证，报告/编辑助手不得递归互调。复用既有存储，不为本轮迁表。

## 工作台

新增项目页签“现场验收”，传入当前project、实际networks、当前项目history与saveProject；项目keyed挂载，不跨项目保存草稿。初始缺省可直接新增项目级检查项，保存时才启用工程/验收数据。三类主要表单：检查项、记录结果、整改；闭环选择后续复验，查看结果/证据有独立详情。

检查项显示关联项目或设备/区域/接口/连接，方法和明确预期（含单位/标准文字）；无需猜测自由文本阈值。不提供自动执行或自动判定。操作顺序“添加检查项→记录结果→登记整改→记录复验→选择复验闭环”，每个结果表单说明当前要求，诊断下拉仅展示同项目匹配终态历史，运行失败可见但不能登记为通过。结果详情显示记录时要求、真实本地时间、原始出处、指标和人工结论；有旧版时明确需复验。

复用DesktopDialog/FeedbackBanner/语义tokens与现有风格；保存失败保草稿、busy防双提交且焦点不逃离、依赖删除有说明、准确增改/闭环标题。表格局部滚动，长目标可读。浅/深×普通/大字×展开/折叠×1440×900/920×620的16组合检查所有主要表单与详情/页脚；截图默认testInfo.outputPath，可选环境覆写，不硬编码开发机路径。

## Excel

动态模板/导出从21扩为25表：新增输入“验收清单”“验收结果”“整改复验”，派生“现场验收报告”。原表头不变，静态5表模板不改；旧5/8/12/16/21均可导入。独立填写说明标签“现场验收版本”=1/空；拒绝重复（包括空）、未知、无标记却有数据、启用缺任一新输入表或缺原工程三输入表。inventory按原版本规则可选，验收目标若需inventory而没有则校验失败。显式空与缺省分别往返；派生表完全忽略重算。

本地编号K001/R001/X001分别为检查项/结果/整改；目标类型中文，引用已有E/P/C，本地连接代码须通过B1明确linkCodes映射；项目目标编号空。新局部编号表内唯一、≤100、无控制字符；生成避开全部已有图ID的有界临时ID，再由projectImport重建。结果当前版/sequence/测量时间/登记人/人工结论/实际/备注/criteria快照/evidence快照完整保存；criteria目标用本地E/P/C而不是泄露内部ID，导入恢复后再校验。诊断sourceId作为出处保留。字段列具体顺序在Task2报告定稿。

输入文本列仅真实文本/空，数字列只普通number/严格十进制整数文本；拒绝公式、超链接、富文本、Date、boolean、有效%格式、非有限/超精度/越界。JSON快照列仅普通文本，解析后完整领域校验；不执行任何内容，不接受Excel公式结果替代JSON。单格≤32767字符；原10MiB文件守卫与最多50条问题预览保留，错误不返回可保存项目。结果/整改表拆行，派生报告包含一项/一结果/一整改/一问题各行，不把全报告JSON或所有问题拼到一格。各表冻结表头/合理列宽/说明/枚举，ISO存储时间列作文本，派生显示统一产品时间格式。最大合法数组/文本测试真实序列化与导入；说明10MiB是输入保护，不保证任意不可压缩极限文本都可通过。

## 验证与交接

实际RED→GREEN：未集成可选校验时非法plan保存被接受；初测fail→整改→后续pass仍rectifying→关联闭环后pass；新失败覆盖旧pass；升版使旧结果失效；诊断同项目/终态/限长/0/null/白名单；引用删除及导入全ID重建；SQLite独立进程重读和拒写原子性；旧缺省不变。

真实序列化25表/旧版本/标记/结构单元格/本地编号碰撞/快照及端点映射/最大规模；原生使用隔离数据，实际本地回环生成至少一份已有诊断再引用，工作台全流程、故障草稿/busy焦点、切项目、报告文件、真实XLSX导入及整进程重启。16显示组合与代表截图人工核对。真实macOS开发Electron与浏览器/其他系统/安装包分别声明；不扫描现场，不将本轮视为正式工程认证。产品长期说明放源码docs，工作区任务记录提交/验证/剩余事项。
