# 工程领域与容量报告契约

阶段 A 的 Vue 与 Excel 使用同一个 `src/domain/engineering.js`，不另写计算公式。数据结构及输入限制见 [阶段 A 设计](network-engineering-phase-a-design.md)。以下字段为本期消费接口。

## 导出接口

- `LOCATION_KINDS`、`DEMAND_KINDS`、`ADDRESS_MODES`：枚举键到中文显示名称的只读对象。
- `ENGINEERING_LIMITS`：`{ locations: 500, demands: 1000, capacities: 500, count: 1000000, growthPercent: 1000, perUnit: 16 }`。
- `DEMAND_DEFAULTS[kind]`：新建需求使用 `{ count: null, growthPercent: 20, addressesPerUnit: 1, portsPerUnit, addressMode }`。wireless 的 portsPerUnit 为 0，其他类型为 1；wired/wireless 默认 dhcp，其他默认 static。默认值仅供表单创建；验证和计算不会替用户补上缺失字段。
- `emptyEngineering()`：每次返回独立的 `{ version: 1, locations: [], demands: [], capacities: [] }`。
- `validateEngineering(engineering, networks?)`：合法时返回原对象，无修改；非法时抛出中文 Error。第二参数若传入，必须是调用者筛选出的本项目网段数组；只检查需求的 networkId 是否属于该列表，空字符串允许暂未关联。省略第二参数时只验证结构与内部引用。位置/需求/容量的 ID 在该工程对象内整体唯一。
- `engineeringReport(project, networks = [])`：接受已保存项目与工作区网段列表；内部按 project.id 筛选网段，并验证工程数据和项目网段。返回纯报告，不修改项目、网段、CIDR 或地址登记。
- `remapEngineering(engineering, networkIds, uuid?)`：networkIds 为 `Map<旧网段ID, 新网段ID>`，默认 uuid 使用 crypto.randomUUID。生成全部位置/需求/容量新 ID，更新 parentId/locationId/networkId，空父级/空网段继续为空字符串。缺少映射、非法结果或新 ID 重复时抛错。返回独立的新工程对象。

`validateProjects` 只检查工程结构；`validateWorkspace` 按项目验证网络引用。删除或移动被引用网段会报错，界面应先让用户解除关联再保存。`projectImport` 调用 remapEngineering，导入创建新项目并保持全部引用。没有 engineering 属性的旧项目不会自动添加工程对象；工程字段随原 projects.data JSON 保存，工作区 version=2 和 SQLite user_version=1 不变。

## 报告结构

```js
{
  enabled: boolean,
  status: "ok" | "pending" | "risk",
  demands: DemandReport[],
  locations: LocationReport[],
  networks: NetworkReport[],
  issues: Issue[]
}
```

旧项目没有 engineering 时，enabled=false、status=ok，三个结果数组与 issues 均为空；该 ok 仅表示没有启用工程检查，不能显示为“容量充足”。启用后没有需求会返回 pending。全局 status 按 risk > pending > ok 判断，risk 时仍需展示同时存在的 pending issues，不能隐藏待补充项。

demands 按输入需求顺序返回；locations 仅包含 area，按位置输入顺序；networks 仅包含需求实际引用的项目网段，按需求首次引用顺序。未使用的模板网段和其他项目的网段不生成容量行。

### DemandReport

保留需求输入字段：`id, locationId, name, kind, count, growthPercent, addressesPerUnit, portsPerUnit, addressMode, networkId, note`，新增：

| 字段          | 类型            | 含义                                              |
| ------------- | --------------- | ------------------------------------------------- |
| reserveCount  | number 或 null  | `ceil(count × growthPercent / 100)`，逐条向上取整 |
| plannedCount  | number 或 null  | `count + reserveCount`                            |
| addressDemand | number 或 null  | `plannedCount × addressesPerUnit`                 |
| portDemand    | number 或 null  | `plannedCount × portsPerUnit`                     |
| status        | ok/pending/risk | 该需求的缺项状态；本期需求行只直接产生 pending    |
| issues        | Issue[]         | 当前数量缺失、未关联网段                          |

count=null 时四个计算数值均为 null，显示“待补充”，不能使用 `Number(null)` 展示零。需求行同时提供原参数，UI/Excel 可显示 `40 + ceil(40 × 20 / 100) = 48；48 × 1 = 48`。无线客户端的地址需求与 AP 的地址/端口需求分别记录。

### LocationReport

```text
{ locationId, name, requiredPorts, unknownDemandCount,
  accessPorts, remainingPorts, status, issues }
```

requiredPorts 为该区域已知需求的 portDemand 小计；unknownDemandCount 为该区域 count=null 的需求条数，包括 portsPerUnit=0 的未知需求。accessPorts 为容量输入；没有容量记录或 accessPorts=null 时均返回 null。remainingPorts 在容量已知、有需求且数量全部已知时返回 `accessPorts - requiredPorts`，否则为 null。已知小计超过容量即产生 risk，即使还有未知数量；没有需求的区域仍 pending。

### NetworkReport

```text
{ networkId, name, cidr,
  addressDemand, staticDemand, dhcpDemand, unknownDemandCount,
  gatewayAddresses, requiredAddresses,
  totalCapacity, dhcpCapacity, staticCapacity,
  remainingAddresses, remainingDhcp, remainingStatic,
  registeredAddresses, status, issues }
```

| 字段                      | 含义                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| addressDemand             | 所有区域引用该网段的已知地址需求小计                                                 |
| staticDemand / dhcpDemand | 按 addressMode 分组的已知地址需求小计                                                |
| unknownDemandCount        | 引用该网段且 count=null 的需求条数，包含 addressesPerUnit=0 的未知需求               |
| gatewayAddresses          | 已保存实际 gateway 非空时为 1，否则 0；共享网段只计算一次                            |
| requiredAddresses         | addressDemand + gatewayAddresses，仍是已知小计                                       |
| totalCapacity             | CIDR 可用容量，/31=2，/32=1，其他去除网络/广播地址                                   |
| dhcpCapacity              | 已配置池的结束 IP 减开始 IP 加 1；没有池时 null                                      |
| staticCapacity            | totalCapacity - (dhcpCapacity ?? 0) - gatewayAddresses                               |
| registeredAddresses       | 当前网段 allocations.length，仅为台账参考，包括台账中的网关记录                      |
| remainingAddresses        | totalCapacity - requiredAddresses；有未知数量或缺少所需网关时 null                   |
| remainingDhcp             | dhcpCapacity - dhcpDemand；无池或 DHCP 模式存在未知的正地址单位贡献时 null           |
| remainingStatic           | staticCapacity - staticDemand；缺少所需网关或静态模式存在未知的正地址单位贡献时 null |

所有需求数都是目标规模，不加台账登记量。台账中已有网关记录不增加第二个网关。缺少实际网关且存在正地址需求（或正每单位地址数的未知需求）时返回 pending，/32 不要求网关。已知需求超 CIDR / DHCP / 静态容量会分别返回 risk；DHCP 需求缺少池时返回 pending，不能把未知池当作确认容量为零的不足。

同一网段不同区域先合并需求再判断容量。不同 networkId 保持独立校核；一期不推断不同网段的重叠地址/共享 VLAN 池，已有地址台账的作用域冲突仍由工作区校验负责。没有枚举地址或每一个未来设备，计算以位置/需求/容量/网段 Map 聚合；数字总和在本期限额内低于 JS 安全整数上限。

## Issue

```js
{
  severity: "pending" | "risk",
  code: string,
  message: string,
  demandId?: string,
  locationId?: string,
  networkId?: string
}
```

各结果行的 issues 同时汇入全局 issues。定位字段仅在适用时出现；不能假定每条都有三个字段。UI 应按 code 与定位字段处理，message 用于直接展示。

| code                          | severity | 定位                                | 含义                               |
| ----------------------------- | -------- | ----------------------------------- | ---------------------------------- |
| demands_missing               | pending  | 无                                  | 工程尚无需求                       |
| count_missing                 | pending  | demandId/locationId，可有 networkId | 当前数量缺失                       |
| network_missing               | pending  | demandId/locationId                 | 未关联网段                         |
| area_demands_missing          | pending  | locationId                          | 区域尚无需求                       |
| access_capacity_missing       | pending  | locationId                          | 可用业务接入端口缺失               |
| port_demand_incomplete        | pending  | locationId                          | 区域存在未知数量                   |
| address_demand_incomplete     | pending  | networkId                           | 网段存在未知数量                   |
| gateway_missing               | pending  | networkId                           | 缺少实际网关                       |
| dhcp_pool_missing             | pending  | networkId                           | DHCP 需求没有对应池                |
| access_capacity_insufficient  | risk     | locationId                          | 已知端口需求超过容量               |
| address_capacity_insufficient | risk     | networkId                           | 已知总地址需求超过可用容量         |
| static_capacity_insufficient  | risk     | networkId                           | 已知静态需求超过池与网关之外的容量 |
| dhcp_capacity_insufficient    | risk     | networkId                           | 已知 DHCP 需求超过池容量           |

已知小计可以展示，但不能用小计或某个非空 remaining 字段替代 status。风险与待补充可同时出现，Excel 校核表也必须保留全部 issues；导入须重新计算报告，不信任旧输出。
