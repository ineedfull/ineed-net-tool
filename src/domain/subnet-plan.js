import { subnet, planSubnets, overlaps, suggestGateway, validateGateway } from "./ipv4.js";

function demand(row, index) {
  const name = String(row.name || "").trim();
  if (!name || name.length > 100) throw new Error(`第 ${index + 1} 项用途名称应为 1～100 个字符`);
  const hosts = Number(row.hosts), reserved = Number(row.reserved ?? 0);
  if (!Number.isInteger(hosts) || hosts < 1 || hosts > 0xfffffffe)
    throw new Error(`“${name}”的设备数量必须为 1～4,294,967,294 的整数`);
  if (row.reserved === "" || !Number.isInteger(reserved) || reserved < 0 || reserved > 0xfffffffe)
    throw new Error(`“${name}”的预留数量必须为 0～4,294,967,294 的整数`);
  return { ...row, name, hosts, reserved };
}

export function validateSubnetPlan(parentCidr, rows) {
  const parent = subnet(parentCidr);
  if (!Array.isArray(rows) || !rows.length || rows.length > 128)
    throw new Error("请配置 1～128 个子网");
  const result = rows.map((row, index) => {
    const entry = demand(row, index);
    const net = subnet(entry.cidr);
    if (entry.cidr !== net.cidr) throw new Error(`“${entry.name}”请使用对齐的子网地址 ${net.cidr}`);
    if (net.first < parent.first || net.last > parent.last)
      throw new Error(`“${entry.name}”超出父网段 ${parent.cidr}`);
    const gateway = String(entry.gateway || "").trim();
    try { validateGateway(gateway, net.cidr); }
    catch (error) { throw new Error(`“${entry.name}”：${error.message}`); }
    const gatewaySlots = entry.reserveGateway || gateway ? 1 : 0;
    const required = entry.hosts + entry.reserved + gatewaySlots;
    if (required > net.usable)
      throw new Error(`“${entry.name}”容量不足：需要 ${required} 个可用地址（设备 ${entry.hosts} + 预留 ${entry.reserved} + 网关 ${gatewaySlots}），当前仅 ${net.usable} 个`);
    return { ...entry, ...net, gateway, gatewaySlots, required, spare: net.usable - required, gatewaySuggestion: suggestGateway(net.cidr) };
  });
  for (let index = 0; index < result.length; index++) {
    for (let other = 0; other < index; other++) {
      if (overlaps(result[index], result[other]))
        throw new Error(`“${result[index].name}”与“${result[other].name}”的子网地址重叠`);
    }
  }
  return result;
}

export function planDeviceSubnets(parentCidr, rows, reserveGateway = true) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 128)
    throw new Error("请配置 1～128 个子网");
  const entries = rows.map(demand);
  const generated = planSubnets(parentCidr, entries.map(entry => ({
    name: entry.name, hosts: entry.hosts + entry.reserved + (reserveGateway ? 1 : 0),
  })));
  return validateSubnetPlan(parentCidr, generated.map(net => ({
    ...entries[net.index], cidr: net.cidr, gateway: "", reserveGateway,
  })));
}
