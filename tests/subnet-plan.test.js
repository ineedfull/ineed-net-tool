import test from 'node:test';
import assert from 'node:assert/strict';
import { planDeviceSubnets, validateSubnetPlan } from '../src/domain/subnet-plan.js';

test('device sizing reserves expansion and gateway space without automatically setting a gateway', () => {
  const source = [{ id: 'a', name: '生产', hosts: 30, reserved: 0 }, { id: 'b', name: '办公', hosts: 60, reserved: 4 }];
  const before = JSON.stringify(source);
  const plan = planDeviceSubnets('192.168.1.0/24', source);
  assert.deepEqual(plan.map(n => [n.id, n.cidr, n.broadcast, n.gatewaySuggestion, n.required, n.spare, n.gateway]), [
    ['b', '192.168.1.0/25', '192.168.1.127', '192.168.1.1', 65, 61, ''],
    ['a', '192.168.1.128/26', '192.168.1.191', '192.168.1.129', 31, 31, ''],
  ]);
  assert.equal(JSON.stringify(source), before);
  assert.equal(planDeviceSubnets('192.168.1.0/24', [source[0]], false)[0].cidr, '192.168.1.0/27');
  assert.throws(() => planDeviceSubnets('10.0.0.0/27', [source[0]]), /容纳不下/);
});

test('editing validates aligned ranges, parent containment, capacity, overlap and usable gateways', () => {
  const parent = '10.0.0.0/24';
  const plan = planDeviceSubnets(parent, [{ name: 'A', hosts: 30 }, { name: 'B', hosts: 12 }]);
  const replace = change => validateSubnetPlan(parent, [{ ...plan[0], ...change }, plan[1]]);
  const updated = replace({ cidr: '10.0.0.128/26', gateway: '10.0.0.190' });
  assert.equal(updated[0].broadcast, '10.0.0.191');
  assert.equal(updated[0].start, '10.0.0.129');
  assert.equal(updated[0].gatewaySuggestion, '10.0.0.129');
  assert.throws(() => replace({ cidr: '10.0.0.129/26' }), /对齐/);
  assert.throws(() => replace({ cidr: '10.0.1.0/26' }), /超出父网段/);
  assert.throws(() => replace({ cidr: '10.0.0.0/27' }), /容量不足/);
  assert.throws(() => replace({ cidr: '10.0.0.64/26' }), /重叠/);
  for (const gateway of ['10.0.0.0', '10.0.0.63', '10.0.1.1']) assert.throws(() => replace({ gateway }), /可用地址范围/);
  for (const change of [{ hosts: 0 }, { hosts: 1.5 }, { reserved: -1 }, { reserved: '' }, { name: ' ' }]) assert.throws(() => replace(change));
  assert.throws(() => planDeviceSubnets(parent, Array.from({ length: 129 }, () => ({ name: 'A', hosts: 1 }))), /128/);
});

test('gateway adoption consumes capacity even without advance reservation and /31 /32 have no broadcast', () => {
  const [tight] = planDeviceSubnets('10.0.0.0/24', [{ name: 'A', hosts: 30 }], false);
  assert.throws(() => validateSubnetPlan('10.0.0.0/24', [{ ...tight, gateway: '10.0.0.1' }]), /容量不足/);
  const point = validateSubnetPlan('10.0.0.0/24', [{ name: '点对点', hosts: 1, cidr: '10.0.0.0/31', gateway: '10.0.0.1' }])[0];
  assert.equal(point.broadcast, '不适用'); assert.equal(point.gatewaySuggestion, ''); assert.equal(point.spare, 0);
  const host = validateSubnetPlan('10.0.0.0/24', [{ name: '主机', hosts: 1, cidr: '10.0.0.7/32' }])[0];
  assert.equal(host.broadcast, '不适用'); assert.equal(host.spare, 0);
});
