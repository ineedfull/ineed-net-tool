import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import info from '../electron/target-info.cjs';
import native from '../electron/network.cjs';
const {normalizeMac,vendorForMac,parseDarwinArp,parseDarwinRoute,lookupTargetInfo}=info;
const noInterfaces=()=>({});
const reverse=async()=>({value:'plc.example.test',source:'反向 DNS（PTR）',detail:''});
const ok=raw=>({code:0,raw,timedOut:false,cancelled:false});
const route='interface: en0\n flags: <UP,HOST,DONE,LLINFO>\n';
const database={updatedAt:'2026-09-21',entries:{'000C29':'VMware, Inc.','001122':'Long','0011223':'Longer','001122334':'Longest'}};

test('MAC normalization rejects incomplete/multicast addresses and matches longest IEEE assignment',()=>{
  assert.equal(normalizeMac('0:c:29:1:2:3'),'00:0C:29:01:02:03');
  assert.equal(normalizeMac('00-0C-29-01-02-03'),'00:0C:29:01:02:03');
  for(const mac of ['(incomplete)','ff:ff:ff:ff:ff:ff','01:00:5e:00:00:01','00:00:00:00:00:00','1:2:3:4:5','00:gg:00:00:00:00'])assert.equal(normalizeMac(mac),'');
  assert.equal(vendorForMac('00:11:22:33:44:55',database).value,'Longest');
  assert.equal(vendorForMac('00:11:22:3F:FF:FF',database).value,'Longer');
  assert.equal(vendorForMac('00:11:22:FF:FF:FF',database).value,'Long');
  assert.equal(vendorForMac('02:11:22:33:44:55',database).value,'');
  assert.match(vendorForMac('02:11:22:33:44:55',database).detail,/本地管理/);
  assert.equal(vendorForMac('00:FF:FF:01:02:03',database).value,'');
});
test('bundled IEEE registry provides real offline manufacturer data',()=>{
  assert.match(vendorForMac('00:0C:29:00:00:01').value,/VMware/i);
  assert.match(vendorForMac('00:00:0C:00:00:01').value,/Cisco/i);
});
test('route and ARP parsing require a direct route, exact target and interface',()=>{
  assert.equal(parseDarwinRoute(route).direct,true);
  assert.equal(parseDarwinRoute('flags: <UP,GATEWAY,HOST>\ninterface: en0').direct,false);
  assert.equal(parseDarwinRoute('flags: <UP,REJECT>\ninterface: en0').direct,false);
  assert.equal(parseDarwinArp('? (192.168.1.10) at 0:c:29:1:2:3 on en0','192.168.1.1','en0'),'');
  assert.equal(parseDarwinArp('? (192.168.1.1) at 0:c:29:1:2:3 on en1','192.168.1.1','en0'),'');
});
test('routed targets retain PTR name but never borrow gateway MAC',async()=>{
  const commands=[];
  const result=await lookupTargetInfo('192.0.2.1',{platform:'darwin',networkInterfaces:noInterfaces,reverse,
    run:async(cmd,args)=>{commands.push(cmd);return ok('flags: <UP,GATEWAY,HOST>\ninterface: en0');}});
  assert.equal(result.hostname.value,'plc.example.test');
  assert.equal(result.mac.value,'');assert.match(result.mac.detail,/网关/);
  assert.deepEqual(commands,['/sbin/route']);
});
test('ARP cache miss retries after Ping can populate it; each successful field survives missing DNS',async()=>{
  let arp=0;
  const result=await lookupTargetInfo('192.168.1.2',{platform:'darwin',networkInterfaces:noInterfaces,
    reverse:async()=>({value:'',source:'PTR',detail:'无记录'}),vendor:mac=>vendorForMac(mac,database),
    run:async(cmd)=>cmd==='/sbin/route'?ok(route):++arp===1?{...ok('no entry'),code:1}:ok('? (192.168.1.2) at 0:c:29:1:2:3 on en0')});
  assert.equal(arp,2);assert.equal(result.mac.value,'00:0C:29:01:02:03');
  assert.equal(result.vendor.value,'VMware, Inc.');assert.equal(result.hostname.value,'');
});
test('local interfaces and loopback need no external lookup',async()=>{
  const options={networkInterfaces:()=>({en0:[{family:'IPv4',address:'10.1.1.1',mac:'02:11:22:33:44:55'}]}),hostname:()=> 'my-mac',reverse:()=>assert.fail('external DNS'),run:()=>assert.fail('external command')};
  const local=await lookupTargetInfo('10.1.1.1',options);
  assert.equal(local.hostname.value,'my-mac');assert.equal(local.mac.value,'02:11:22:33:44:55');assert.equal(local.vendor.value,'');
  const loopback=await lookupTargetInfo('127.0.0.1',options);
  assert.equal(loopback.hostname.value,'my-mac');assert.equal(loopback.mac.value,'');assert.match(loopback.mac.detail,/回环/);
  await assert.rejects(lookupTargetInfo('1.2.3.4; echo BAD',options),/IPv4/);
});
test('Linux neighbor selection excludes wrong IP, interface and failed entries',async()=>{
  const result=await lookupTargetInfo('10.0.0.2',{platform:'linux',networkInterfaces:noInterfaces,reverse,
    run:async(_,args)=>ok(JSON.stringify(args.includes('route')?[{dev:'eth0'}]:[
      {dst:'10.0.0.1',dev:'eth0',lladdr:'00:11:22:33:44:55',state:['REACHABLE']},
      {dst:'10.0.0.2',dev:'eth1',lladdr:'00:11:22:33:44:55',state:['REACHABLE']},
      {dst:'10.0.0.2',dev:'eth0',lladdr:'00:0c:29:00:00:01',state:['REACHABLE']}]))});
  assert.equal(result.mac.value,'00:0C:29:00:00:01');
});
test('cancellation stops cache retries and settles as partial information',async()=>{
  const controller=new AbortController();let calls=0;
  const pending=lookupTargetInfo('10.0.0.2',{signal:controller.signal,platform:'darwin',networkInterfaces:noInterfaces,reverse,
    run:async(cmd)=>{calls++;return ok(cmd==='/sbin/route'?route:'');}});
  await delay(10);controller.abort();const result=await pending;
  assert.equal(result.status,'partial');assert.equal(calls,2);assert.equal(result.mac.value,'');
});
test('Ping replies arrive while identity lookup is pending and history gets the settled snapshot', {timeout:5000},async()=>{
  const ready=Promise.withResolvers(),identification=Promise.withResolvers();let saved;
  const tasks=new native.NetworkTasks(event=>{if(event.row)ready.resolve();},async record=>{saved=record;}, {identifyTarget:()=>identification.promise});
  try {
    await tasks.start('ping',{target:'127.0.0.1',count:1,interval:200,timeout:100});
    await ready.promise;assert.equal(saved,undefined);
    const snapshot={ip:'127.0.0.1',status:'complete',hostname:{value:'test-host'}};
    identification.resolve(snapshot);
    while(tasks.tasks.size)await delay(1);
    assert.equal(saved.received,1);assert.deepEqual(saved.targetInfo,snapshot);
  }finally{identification.resolve({});tasks.stopAll();}
});

test('lookup failure is isolated from Ping and stopping during lookup records stopped', {timeout:5000},async()=>{
  let saved;
  const failed=new native.NetworkTasks(()=>{},async record=>{saved=record;},{identifyTarget:async()=>{throw new Error('unavailable');}});
  await failed.start('ping',{target:'127.0.0.1',count:1,interval:200,timeout:100});
  while(failed.tasks.size)await delay(1);
  assert.equal(saved.status,'completed');assert.equal(saved.received,1);assert.equal(saved.targetInfo.status,'partial');
  const received=Promise.withResolvers();let events=0;
  const tasks=new native.NetworkTasks(event=>{events++;if(event.row)received.resolve(event.id);},async record=>{saved=record;},{identifyTarget:(_,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))});
  try {
    await tasks.start('ping',{target:'127.0.0.1',count:1,interval:200,timeout:100});
    const id=await received.promise;await delay(10);tasks.control(id,'stop');
    while(tasks.tasks.size)await delay(1);
    assert.equal(saved.status,'stopped');assert.equal(saved.targetInfo.status,'partial');
    const finalCount=events;await delay(20);assert.equal(events,finalCount);
  }finally{tasks.stopAll();}
});

test('Windows routed response does not become a target MAC',async()=>{
  const result=await lookupTargetInfo('192.0.2.1',{platform:'win32',networkInterfaces:noInterfaces,reverse,run:async(cmd,args)=>{
    assert.equal(cmd,'powershell.exe');assert.ok(args.includes('-NonInteractive'));return ok('{"direct":false,"mac":"00-0C-29-01-02-03"}');
  }});
  assert.equal(result.mac.value,'');assert.match(result.mac.detail,/网关/);
});
