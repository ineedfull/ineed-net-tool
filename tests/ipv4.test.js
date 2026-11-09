import test from 'node:test';
import assert from 'node:assert/strict';
import { ipNumber, ipText, subnet, planSubnets, overlaps, scanAddresses, pingStats, suggestGateway, validateGateway, IPV4_MULTICAST } from '../src/domain/ipv4.js';
import { validateNetworks } from '../src/domain/workspace.js';
test('IPv4 validates octets and covers the entire unsigned range', () => {
  for (const ip of ['0.0.0.0','127.0.0.1','192.168.1.1','255.255.255.255']) assert.equal(ipText(ipNumber(ip)), ip);
  for (const ip of ['1.2.3','1.2.3.256','01.2.3.4','-1.2.3.4','1.2.3.4;pwd']) assert.throws(() => ipNumber(ip));
});
test('CIDR, dotted masks, and /0 /31 /32 produce correct ranges', () => {
  const normal = subnet('192.168.1.25/24');
  assert.equal(normal.network, '192.168.1.0'); assert.equal(normal.broadcast, '192.168.1.255'); assert.equal(normal.usable, 254);
  assert.equal(subnet('192.168.1.25','255.255.255.0').cidr, normal.cidr);
  assert.equal(subnet('1.2.3.4/0').size, 4294967296);
  assert.equal(subnet('1.2.3.4/0').usable, 4294967294);
  assert.deepEqual([subnet('10.0.0.1/31').start,subnet('10.0.0.1/31').end,subnet('10.0.0.1/31').usable], ['10.0.0.0','10.0.0.1',2]);
  assert.equal(subnet('10.0.0.1/32').usable,1); assert.equal(subnet('10.0.0.1/32').broadcast,'不适用');
  assert.throws(() => subnet('1.2.3.4/33')); assert.throws(() => subnet('1.2.3.4','255.0.255.0'));
});
test('VLSM aligns subnets, sorts by size, and rejects insufficient capacity', () => {
  const plan = planSubnets('192.168.1.0/24', [{ hosts:12 }, { hosts:60 }, { hosts:30 }]);
  assert.deepEqual(plan.map(n=>n.cidr),['192.168.1.0/26','192.168.1.64/27','192.168.1.96/28']);
  assert.equal(overlaps(plan[0],plan[1]), false);
  assert.throws(() => planSubnets('192.168.1.0/30',[{hosts:10}]));
  assert.throws(() => planSubnets('0.0.0.0/0',[{hosts:4294967295}]));
});
test('scanner caps allocations and handles host-only subnets', () => {
  assert.deepEqual(scanAddresses('127.0.0.1'), ['127.0.0.1']);
  assert.deepEqual(scanAddresses('10.0.0.0/31'), ['10.0.0.0','10.0.0.1']);
  assert.equal(scanAddresses('192.168.1.0/24').length,254);
  assert.throws(() => scanAddresses('0.0.0.0/0'));
  assert.throws(() => scanAddresses('10.0.0.2-10.0.0.1'));
});
test('allocation validation keeps assigned addresses inside usable ranges without duplicates', () => {
  const record = { id:'one', name:'办公', note:'', cidr:'192.168.1.0/24', allocations:[{ip:'192.168.1.2',label:'PLC'}] };
  assert.equal(validateNetworks([record]).length,1);
  assert.throws(() => validateNetworks([{...record,allocations:[{ip:'192.168.1.255',label:''}]}]));
  assert.throws(() => validateNetworks([{...record,allocations:[...record.allocations,...record.allocations]}]));
});
test('ping statistics distinguish zero latency from no reply', () => {
  const stats = pingStats([{status:'reachable',ms:0},{status:'reachable',ms:2},{status:'no-response',ms:null}]);
  assert.equal(stats.received,2); assert.equal(stats.min,0); assert.equal(stats.average,1);
  assert.ok(Math.abs(stats.loss - 100/3) < 0.001);
});

test('gateway suggestions are planning hints and avoid special or point-to-point ranges', () => {
  assert.equal(suggestGateway('192.168.1.50/24'),'192.168.1.1');
  assert.equal(suggestGateway('10.0.0.65/26'),'10.0.0.65');
  for (const cidr of ['10.0.0.0/31','10.0.0.1/32','127.0.0.0/8','224.0.0.0/4','240.0.0.0/4','0.0.0.0/0']) assert.equal(suggestGateway(cidr),'');
  assert.deepEqual([IPV4_MULTICAST.start,IPV4_MULTICAST.end,IPV4_MULTICAST.cidr],['224.0.0.0','239.255.255.255','224.0.0.0/4']);
});

test('gateway validation preserves legacy records and accepts optional valid subnet gateways', () => {
  const legacy={id:'old',name:'旧网段',note:'保留原配置',cidr:'192.168.1.0/24',allocations:[{ip:'192.168.1.10',label:'PLC'}]};
  const before=JSON.stringify(legacy);
  validateNetworks([legacy]); assert.equal(JSON.stringify(legacy),before);
  for (const gateway of [undefined,null,'','192.168.1.1','192.168.1.254']) validateNetworks([{...legacy,gateway}]);
  for (const gateway of ['192.168.1.0','192.168.1.255','192.168.2.1','224.0.0.1','999.1.1.1',123]) assert.throws(()=>validateNetworks([{...legacy,gateway}]));
  for (const gateway of ['0.0.0.0','127.0.0.1','224.0.0.1','239.1.2.3','240.0.0.1','255.255.255.255']) assert.throws(()=>validateGateway(gateway,'0.0.0.0/0'));
  validateGateway('10.0.0.1','10.0.0.0/31');
});
