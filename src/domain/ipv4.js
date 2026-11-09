export function ipNumber(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) throw new Error('请输入有效的 IPv4 地址，例如 192.168.1.1');
  return parts.reduce((sum, part) => sum * 256 + Number(part), 0);
}
export function ipText(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('IPv4 地址超出范围');
  return [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
}
export function prefixNumber(value) {
  const text = String(value).trim();
  if (/^\d{1,2}$/.test(text) && Number(text) <= 32) return Number(text);
  const mask = ipNumber(text);
  const hostBits = Math.log2(0x100000000 - mask);
  if (!Number.isInteger(hostBits)) throw new Error('子网掩码必须由连续的 1 和 0 组成');
  return 32 - hostBits;
}
export function subnet(value, mask) {
  const parts = String(value).trim().split('/');
  if (parts.length > 2) throw new Error('CIDR 格式错误');
  const ip = ipNumber(parts[0]);
  const prefix = prefixNumber(mask ?? parts[1] ?? '24');
  const size = 2 ** (32 - prefix);
  const first = Math.floor(ip / size) * size;
  const last = first + size - 1;
  const usable = prefix >= 31 ? size : size - 2;
  return { cidr: `${ipText(first)}/${prefix}`, prefix, mask: ipText(0x100000000 - size),
    network: ipText(first), broadcast: prefix >= 31 ? '不适用' : ipText(last),
    first, last, size, usable, start: ipText(first + (prefix < 31 ? 1 : 0)), end: ipText(last - (prefix < 31 ? 1 : 0)) };
}
export function overlaps(a, b) { return a.first <= b.last && b.first <= a.last; }
export const IPV4_MULTICAST = Object.freeze({
  cidr: '224.0.0.0/4', start: '224.0.0.0', end: '239.255.255.255',
  localControl: '224.0.0.0/24', administrative: '239.0.0.0/8'
});
export function isGatewayUnicast(value) {
  const firstOctet = Math.floor(ipNumber(value) / 2 ** 24);
  return firstOctet > 0 && firstOctet < 224 && firstOctet !== 127;
}
export function suggestGateway(cidr) {
  const net = subnet(cidr);
  return net.prefix < 31 && isGatewayUnicast(net.start) ? net.start : '';
}
export function validateGateway(value, cidr) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') throw new Error('默认网关必须为 IPv4 地址');
  let ip;
  try { ip = ipNumber(value); } catch { throw new Error('请输入有效的默认网关 IPv4 地址'); }
  if (!isGatewayUnicast(value)) throw new Error('默认网关必须是单播地址，不能使用未指定、回环、组播或保留地址');
  const net = subnet(cidr);
  if (ip < ipNumber(net.start) || ip > ipNumber(net.end)) throw new Error('默认网关应位于当前网段的可用地址范围内');
}
export function planSubnets(cidr, requirements) {
  const parent = subnet(cidr);
  if (!Array.isArray(requirements) || !requirements.length || requirements.length > 128) throw new Error('请输入 1～128 个子网的设备数量');
  const ordered = requirements.map((item, index) => {
    const hosts = Number(item.hosts);
    if (!Number.isInteger(hosts) || hosts < 1 || hosts > 0xfffffffe) throw new Error('设备数量必须是正整数');
    const size = 2 ** Math.ceil(Math.log2(hosts + 2));
    return { name: item.name || `子网 ${index + 1}`, hosts, index, size };
  }).sort((a, b) => b.size - a.size);
  let cursor = parent.first;
  return ordered.map(item => {
    cursor = Math.ceil(cursor / item.size) * item.size;
    if (cursor + item.size - 1 > parent.last) throw new Error('当前网段容纳不下这些子网，请扩大父网段或减少设备数量');
    const result = { ...item, ...subnet(`${ipText(cursor)}/${32 - Math.log2(item.size)}`) };
    cursor += item.size;
    return result;
  });
}
export const MAX_SCAN_ADDRESSES = 65536;
export const SCAN_BATCH_SIZE = 256;
// Parse without allocating one string per address. Workers request addresses lazily.
export function scanRange(value, limit = MAX_SCAN_ADDRESSES) {
  const text = String(value).trim();
  let first, last;
  if (text.includes('-')) {
    const parts = text.split('-');
    if (parts.length !== 2) throw new Error('地址范围格式错误');
    first = ipNumber(parts[0].trim()); last = ipNumber(parts[1].trim());
  } else if (text.includes('/')) {
    const net = subnet(text); first = ipNumber(net.start); last = ipNumber(net.end);
  } else { first = last = ipNumber(text); }
  if (first > last) throw new Error('起始地址不能大于结束地址');
  const length = last - first + 1;
  if (length > limit) throw new Error(`当前范围包含 ${length.toLocaleString('en-US')} 个地址，超过单次扫描上限 ${limit.toLocaleString('en-US')} 个，请缩小范围（支持完整 /16 网段）`);
  return { first, last, length };
}
export function scanAddresses(value, limit = MAX_SCAN_ADDRESSES) {
  const range = scanRange(value, limit);
  return Array.from({ length: range.length }, (_, index) => ipText(range.first + index));
}
export function pingStats(rows) {
  const good = rows.filter(row => row.status === 'reachable');
  const values = good.map(row => row.ms).filter(Number.isFinite);
  return { sent: rows.length, received: good.length, loss: rows.length ? (rows.length - good.length) / rows.length * 100 : 0,
    min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
}
