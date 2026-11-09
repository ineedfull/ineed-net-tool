async function topologyTables(project, networks) {
  const { vlanConfigurationReport } = await import("../src/domain/topology.js");
  const inventory = project.engineering?.infrastructure;
  const ports = new Map(
    (inventory?.interfaces ?? []).map((p, i) => [
      p.id,
      `P${String(i + 1).padStart(3, "0")}`,
    ]),
  );
  const nets = new Map(
    networks.map((n, i) => [n.id, `N${String(i + 1).padStart(3, "0")}`]),
  );
  const links = new Map(
    (inventory?.links ?? []).map((l, i) => [
      l.id,
      `C${String(i + 1).padStart(3, "0")}`,
    ]),
  );
  return [
    (inventory?.interfaces ?? [])
      .filter((p) => p.logicalConfig !== undefined)
      .map((p) => {
        const c = p.logicalConfig;
        return [
          ports.get(p.id),
          c.mode === "access" ? "Access" : "Trunk",
          JSON.stringify(c.networkIds.map((id) => nets.get(id))),
          c.accessVlan === null ? "" : String(c.accessVlan),
          c.allowedVlans === null
            ? ""
            : c.allowedVlans.length
              ? c.allowedVlans.join(",")
              : "无",
        ];
      }),
    vlanConfigurationReport(project, networks).issues.map((i) => [
      ports.get(i.interfaceId) ?? "",
      nets.get(i.networkId) ?? "",
      links.get(i.linkId) ?? "",
      i.vlan ?? "",
      i.severity === "risk" ? "配置风险" : "待补充",
      i.code,
      i.message,
    ]),
  ];
}
async function parseTopology(rows, engineering, networks) {
  const { validateEngineering } = await import("../src/domain/engineering.js");
  const inventory = engineering.infrastructure;
  inventory.logicalVersion = 1;
  const ports = new Map(inventory.interfaces.map((p) => [p.id, p])),
    seen = new Set();
  for (const { row, values: v } of rows) {
    const fail = (message) => {
      throw Error(`端口逻辑配置 第${row}行：${message}`);
    };
    const port = ports.get(v[0]);
    if (!port || seen.has(v[0])) fail("接口编号不存在或重复");
    seen.add(v[0]);
    let networkIds;
    try {
      networkIds = v[2] === "" ? [] : JSON.parse(v[2]);
    } catch {
      fail('业务网段编号必须为JSON字符串列表，例如 ["N001"]');
    }
    const number = (value) => {
      if (!/^[1-9]\d{0,3}$/.test(value)) fail("VLAN必须为1～4094普通整数文本");
      return Number(value);
    };
    port.logicalConfig = {
      version: 1,
      mode: v[1] === "Access" ? "access" : v[1] === "Trunk" ? "trunk" : v[1],
      networkIds,
      accessVlan: v[3] === "" ? null : number(v[3]),
      allowedVlans:
        v[4] === ""
          ? null
          : v[4] === "无"
            ? []
            : v[4].split(",").map((value) => number(value.trim())),
    };
  }
  validateEngineering(engineering, networks);
}
module.exports = { topologyTables, parseTopology };
