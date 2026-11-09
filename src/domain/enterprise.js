import { subnet, ipNumber, ipText } from "./ipv4.js";

export const ENTERPRISE_TEMPLATE = {
  id: "enterprise-dual",
  name: "大型项目 · 三运营商双网",
  description:
    "电信、联通、移动三线接入；内外网独立组网，通过边界防火墙按策略互通。",
  base: "10.60.0.0/16",
  externalBase: "10.80.0.0/16",
  networks: [
    {
      name: "内网 · 业务终端",
      zone: "internal",
      prefix: 22,
      vlan: 110,
      dhcp: [100, 999],
      note: "内网独立交换与路由，不直接连接运营商出口。",
    },
    {
      name: "内网 · 业务服务器",
      zone: "internal",
      prefix: 24,
      vlan: 120,
      note: "业务服务区；仅通过边界防火墙按服务放行跨网访问。",
    },
    {
      name: "内网 · 视频与物联",
      zone: "internal",
      prefix: 22,
      vlan: 130,
      note: "监控、物联设备按点位登记，和业务终端分区。",
    },
    {
      name: "内网 · 网络管理",
      zone: "internal",
      prefix: 24,
      vlan: 199,
      note: "内网设备管理，使用独立管理链路与授权运维终端。",
    },
    {
      name: "外网 · 办公终端",
      zone: "external",
      prefix: 22,
      vlan: 210,
      dhcp: [100, 999],
      note: "通过外网出口防火墙接入三运营商线路，配置 NAT 与选路策略。",
    },
    {
      name: "外网 · 访客无线",
      zone: "external",
      prefix: 22,
      vlan: 220,
      dhcp: [100, 999],
      note: "仅访问互联网；在现场防火墙上隔离访客与其他业务区。",
    },
    {
      name: "外网 · DMZ 服务",
      zone: "external",
      prefix: 24,
      vlan: 230,
      note: "跨网服务代理或对外服务区，按来源、目标与端口逐项授权。",
    },
    {
      name: "外网 · 网络管理",
      zone: "external",
      prefix: 24,
      vlan: 299,
      note: "外网交换机、出口与边界防火墙管理，和内网管理区分开。",
    },
  ],
};
export const POLICY_PROTOCOLS = {
  tcp: "TCP",
  udp: "UDP",
  icmp: "ICMP",
  any: "任意协议",
};
export const LINK_STATUSES = {
  planned: "待开通",
  active: "已开通",
  disabled: "停用",
};
export const ACCESS_TYPES = {
  static: "静态地址",
  dhcp: "DHCP",
  pppoe: "PPPoE",
};
export function privateSpace(cidr) {
  const value = subnet(cidr);
  if (
    !["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((c) => {
      const r = subnet(c);
      return value.first >= r.first && value.last <= r.last;
    })
  )
    throw new Error("场景模板请使用完整位于 RFC1918 私有地址范围内的网段");
  return value;
}
export function dualSpaces(internalCidr, externalCidr) {
  const internal = privateSpace(internalCidr),
    external = privateSpace(externalCidr);
  if (internal.first <= external.last && external.first <= internal.last)
    throw new Error("内外网地址空间不能重叠");
  return { internal, external };
}
export function enterpriseConnectivity(internalCidr, externalCidr, networks) {
  const spaces = dualSpaces(internalCidr, externalCidr);
  const internal = networks.find((n) => n.name === "内网 · 业务终端");
  const server = networks.find((n) => n.name === "内网 · 业务服务器");
  const dmz = networks.find((n) => n.name === "外网 · DMZ 服务");
  const host = (n) => `${ipText(subnet(n.cidr).first + 10)}/32`;
  return {
    internalCidr: spaces.internal.cidr,
    externalCidr: spaces.external.cidr,
    uplinks: ["中国电信", "中国联通", "中国移动"].map((provider, i) => ({
      id: `wan-${i + 1}`,
      provider,
      interface: `WAN${i + 1}`,
      bandwidth: "",
      access: "static",
      address: "",
      gateway: "",
      priority: i + 1,
      status: "planned",
      note: "填写运营商实际交付参数；出口设备按优先级和健康检查切换，NAT 与回程保持同一线路。",
    })),
    policies: [
      {
        id: "internal-to-dmz",
        name: "内网访问 DMZ 业务代理",
        source: internal.cidr,
        destination: host(dmz),
        protocol: "tcp",
        ports: "443",
        action: "allow",
        enabled: false,
        note: "示例目标 .10 为待登记的服务地址；核实业务与服务器后再启用。",
      },
      {
        id: "dmz-to-internal",
        name: "DMZ 代理访问内网业务",
        source: host(dmz),
        destination: host(server),
        protocol: "tcp",
        ports: "443",
        action: "allow",
        enabled: false,
        note: "仅放行代理到指定业务服务器，不允许整个外网直接访问内网。",
      },
    ],
  };
}
function field(value, max, label, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${label}无效或过长`);
}
function ids(items, max, label) {
  if (!Array.isArray(items) || items.length > max)
    throw new Error(`${label}数量无效`);
  const seen = new Set();
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 100 ||
      seen.has(item.id)
    )
      throw new Error(`${label}标识无效或重复`);
    seen.add(item.id);
  }
}
export function validateConnectivity(plan) {
  if (plan === undefined) return;
  if (!plan || typeof plan !== "object") throw new Error("互联规划无效");
  const spaces = dualSpaces(plan.internalCidr, plan.externalCidr);
  ids(plan.uplinks, 16, "运营商线路");
  const priorities = new Set(),
    interfaces = new Set();
  for (const line of plan.uplinks) {
    field(line.provider, 100, "运营商", true);
    field(line.interface, 100, "出口接口", true);
    field(line.note, 1000, "线路备注");
    if (
      !Object.hasOwn(ACCESS_TYPES, line.access) ||
      !Object.hasOwn(LINK_STATUSES, line.status)
    )
      throw new Error("线路接入方式或状态无效");
    if (
      line.bandwidth !== "" &&
      (!Number.isInteger(line.bandwidth) ||
        line.bandwidth < 1 ||
        line.bandwidth > 1000000)
    )
      throw new Error("带宽应为 1～1000000 Mbps 的整数");
    if (
      !Number.isInteger(line.priority) ||
      line.priority < 1 ||
      line.priority > 100 ||
      priorities.has(line.priority)
    )
      throw new Error("线路优先级应为 1～100 的不重复整数");
    if (interfaces.has(line.interface.trim().toLowerCase()))
      throw new Error("出口接口不能重复");
    priorities.add(line.priority);
    interfaces.add(line.interface.trim().toLowerCase());
    field(line.address, 40, "线路 IPv4/CIDR");
    field(line.gateway, 20, "运营商网关");
    if (line.address) {
      if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(line.address))
        throw new Error("线路地址请填写 IPv4/CIDR");
      subnet(line.address);
    }
    if (line.gateway) ipNumber(line.gateway);
  }
  ids(plan.policies, 200, "互通规则");
  for (const policy of plan.policies) {
    field(policy.name, 100, "规则名称", true);
    field(policy.note, 1000, "规则备注");
    if (
      typeof policy.enabled !== "boolean" ||
      !["allow", "deny"].includes(policy.action) ||
      !Object.hasOwn(POLICY_PROTOCOLS, policy.protocol)
    )
      throw new Error("规则状态、动作或协议无效");
    const zone = (cidr) => {
      if (typeof cidr !== "string" || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr))
        throw new Error("规则地址请填写 IPv4/CIDR，单台设备使用 /32");
      const net = subnet(cidr);
      return Object.keys(spaces).find(
        (z) => net.first >= spaces[z].first && net.last <= spaces[z].last,
      );
    };
    const source = zone(policy.source),
      destination = zone(policy.destination);
    if (!source || !destination || source === destination)
      throw new Error("互通规则来源和目标必须分别位于内网、外网地址空间");
    field(policy.ports, 200, "目标端口");
    if (["tcp", "udp"].includes(policy.protocol)) {
      if (
        !policy.ports ||
        policy.ports.split(",").some((token) => {
          if (!/^\d+(?:-\d+)?$/.test(token.trim())) return true;
          const [start, end = start] = token.trim().split("-").map(Number);
          return start < 1 || end > 65535 || start > end;
        })
      )
        throw new Error(
          "TCP/UDP 目标端口请填 1～65535，可用逗号和范围，如 443,8000-8010",
        );
    } else if (policy.ports !== "")
      throw new Error("ICMP 和任意协议不填写端口");
  }
}
