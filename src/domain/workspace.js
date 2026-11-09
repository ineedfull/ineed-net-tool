import { subnet, ipNumber, overlaps, validateGateway } from "./ipv4.js";
export function validateNetworks(networks) {
  if (!Array.isArray(networks) || networks.length > 500)
    throw new Error("最多保存 500 个网段");
  const ids = new Set();
  for (const item of networks) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 100 ||
      /[\x00-\x1f]/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100 ||
      typeof item.note !== "string" ||
      item.note.length > 2000
    )
      throw new Error("网段名称、标识或备注无效");
    ids.add(item.id);
    const net = subnet(item.cidr);
    if (net.cidr !== item.cidr) throw new Error("请使用规范化的网段 CIDR");
    validateGateway(item.gateway, net.cidr);
    if (
      item.vlan !== undefined &&
      item.vlan !== "" &&
      item.vlan !== null &&
      (!Number.isInteger(item.vlan) || item.vlan < 1 || item.vlan > 4094)
    )
      throw new Error("VLAN 必须为 1～4094 或留空");
    const hasDhcp = Boolean(item.dhcpStart || item.dhcpEnd);
    let dhcpFirst, dhcpLast;
    if (hasDhcp) {
      dhcpFirst = ipNumber(item.dhcpStart);
      dhcpLast = ipNumber(item.dhcpEnd);
      if (
        dhcpFirst > dhcpLast ||
        dhcpFirst < ipNumber(net.start) ||
        dhcpLast > ipNumber(net.end)
      )
        throw new Error("DHCP 范围必须位于网段可用地址内且起始不大于结束");
      if (
        item.gateway &&
        ipNumber(item.gateway) >= dhcpFirst &&
        ipNumber(item.gateway) <= dhcpLast
      )
        throw new Error("DHCP 范围不能包含网关");
    }
    if (!Array.isArray(item.allocations) || item.allocations.length > 4096)
      throw new Error("分配记录无效或过多");
    const addresses = new Set();
    for (const address of item.allocations) {
      if (!address || typeof address.ip !== "string")
        throw new Error("分配记录缺少 IPv4 地址");
      const ip = ipNumber(address.ip);
      if (hasDhcp && ip >= dhcpFirst && ip <= dhcpLast)
        throw new Error(
          "静态登记地址不能占用 DHCP 动态地址池，请调整 DHCP 范围",
        );
      if (
        address.status !== undefined &&
        !["reserved", "assigned", "maintenance"].includes(address.status)
      )
        throw new Error("地址使用状态无效");
      if (
        address.type !== undefined &&
        ![
          "computer",
          "camera",
          "recorder",
          "switch",
          "router",
          "ap",
          "printer",
          "server",
          "other",
        ].includes(address.type)
      )
        throw new Error("设备类型无效");
      for (const [key, max] of [
        ["location", 200],
        ["owner", 200],
        ["note", 1000],
        ["mac", 17],
      ])
        if (
          address[key] !== undefined &&
          (typeof address[key] !== "string" || address[key].length > max)
        )
          throw new Error("设备信息无效或过长");
      if (address.mac && !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address.mac))
        throw new Error("MAC 地址格式应为 AA:BB:CC:DD:EE:FF");
      if (
        ip < ipNumber(net.start) ||
        ip > ipNumber(net.end) ||
        addresses.has(address.ip)
      )
        throw new Error("分配地址重复或不属于可用地址范围");
      if (typeof address.label !== "string" || address.label.length > 200)
        throw new Error("设备说明过长");
      addresses.add(address.ip);
    }
  }
  return networks;
}
export function overlapNames(networks, cidr, excludeId) {
  const target = subnet(cidr);
  return networks
    .filter(
      (item) => item.id !== excludeId && overlaps(target, subnet(item.cidr)),
    )
    .map((item) => item.name);
}
