import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import tools from '../electron/network-tools.cjs';
import native from '../electron/network.cjs';
import fixtureModule from './helpers/network-fixtures.cjs';
const signal=()=>new AbortController().signal;
const {prepareTool,parsePorts,qualityStats,queryDns,connectPort,inspectCertificate,certificateDetails,measureDownload}=tools;
test('network tool validation rejects malformed inputs and normalizes port ranges',()=>{
  assert.deepEqual(parsePorts('80,22,80,443,8000-8002'),[22,80,443,8000,8001,8002]);
  assert.equal(parsePorts('1-65535').length,65535);
  for(const ports of ['','0','65536','5-2','1;whoami','1,'])assert.throws(()=>parsePorts(ports));
  for(const target of ['file:///etc/passwd','ftp://example.test','https://user:pass@example.test'])assert.throws(()=>prepareTool('speed',{target}));
  assert.throws(()=>prepareTool('certificate',{target:'example.test',port:0}));
  assert.throws(()=>prepareTool('quality',{target:'127.0.0.1',method:'udp'}));
  assert.throws(()=>prepareTool('dns',{target:'example.test',recordType:'PTR'}));
  assert.throws(()=>prepareTool('dns',{target:'example.test',server:'bad-server'}));
  assert.equal(prepareTool('dns',{target:'_sip._tcp.example.test',recordType:'SRV'}).target,'_sip._tcp.example.test');
  assert.equal(prepareTool('dns',{target:'例子.中国',recordType:'A'}).target,'xn--fsqu00a.xn--fiqs8s');
});
test('quality stats distinguish missing samples from zero latency and do not bridge losses',()=>{
  const rows=[{status:'reachable',ms:0},{status:'reachable',ms:10},{status:'timeout',ms:100},{status:'reachable',ms:40},{status:'reachable',ms:60}];
  assert.deepEqual(qualityStats(rows),{sent:5,received:4,failureRate:20,min:0,max:60,average:27.5,p95:60,jitter:15});
  assert.equal(qualityStats([{status:'closed',ms:2}]).failureRate,100);
  assert.equal(qualityStats([]).average,null);
});
test('certificate validity distinguishes expired, not-yet-valid, expiring and name mismatch',()=>{
  const cert={subject:{CN:'localhost'},valid_from:'2026-01-01T00:00:00Z',valid_to:'2026-10-01T00:00:00Z'};
  const now=Date.parse('2026-09-22T00:00:00Z');
  const good=certificateDetails(cert,'localhost',true,'',30,now);
  assert.equal(good.valid,true);assert.equal(good.expiring,true);assert.equal(good.daysRemaining,9);
  assert.equal(certificateDetails(cert,'wrong.test',true,'',30,now).nameMatches,false);
  assert.equal(certificateDetails(cert,'localhost',false,'SELF_SIGNED',30,now).valid,false);
  assert.equal(certificateDetails(cert,'localhost',true,'',30,Date.parse('2026-11-01')).expired,true);
  assert.equal(certificateDetails(cert,'localhost',true,'',30,Date.parse('2025-11-01')).notYetValid,true);
});
test('real local DNS, TCP, HTTP and TLS services exercise all new task types', {timeout:20000},async(t)=>{
  const servers=await fixtureModule.fixtures();t.after(()=>servers.close());
  const dnsOptions={target:'example.test',timeout:1000,server:`127.0.0.1:${servers.dnsPort}`};
  for(const type of tools.DNS_TYPES){
    const result=await queryDns({...dnsOptions,recordType:type,target:type==='PTR'?'192.0.2.1':type==='SRV'?'_sip._tcp.example.test':'example.test'},signal());
    assert.equal(result.answers.length,1,type);
    if(type==='A'){assert.equal(result.answers[0].address,'127.0.0.1');assert.equal(result.answers[0].ttl,60);}
  }
  await assert.rejects(queryDns({...dnsOptions,recordType:'A',target:'missing.test'},signal()),/域名不存在/);
  await assert.rejects(queryDns({...dnsOptions,recordType:'A',target:'timeout.test',timeout:100},signal()),/超时/);
  const open=await connectPort('127.0.0.1',servers.openPort,1000,signal());assert.equal(open.state,'open');
  assert.equal((await connectPort('127.0.0.1',servers.closedPort,1000,signal())).state,'closed');
  const cert=await inspectCertificate('127.0.0.1',{port:servers.tlsPort,servername:'localhost',timeout:1000,warnDays:30},signal());
  assert.equal(cert.nameMatches,true);assert.equal(cert.trusted,false);assert.ok(cert.fingerprint);assert.equal(cert.chain.length,1);
  const options={target:servers.url+'/redirect',duration:1,maxMiB:4,timeout:1000};
  const transfer=await measureDownload(options,signal(),()=>{});assert.equal(transfer.bytes,2*1024*1024);assert.equal(transfer.reason,'end');assert.ok(transfer.mbps>0);assert.ok(transfer.url.endsWith('/file'));
  const limited=await measureDownload({...options,target:servers.url+'/stream',duration:5,maxMiB:1},signal(),()=>{});
  assert.equal(limited.reason,'bytes');assert.ok(limited.bytes>=1048576 && limited.bytes<=1048576+65536);
  const timed=await measureDownload({...options,target:servers.url+'/stream',duration:1,maxMiB:8},signal(),()=>{});assert.equal(timed.reason,'duration');
  for(const suffix of ['/error','/empty','/stall'])await assert.rejects(measureDownload({...options,target:servers.url+suffix,timeout:100},signal(),()=>{}));
  const controller=new AbortController();const progress=[];
  const download=measureDownload({...options,target:servers.url+'/stream'},controller.signal,x=>progress.push(x));
  setTimeout(()=>controller.abort(),40);await assert.rejects(download,/停止/);assert.equal(progress.at(-1).reason,'stopped');
  const records=[],events=[];const tasks=new native.NetworkTasks(e=>events.push(e),async record=>records.push(record));
  t.after(()=>tasks.stopAll());
  const jobs=[['dns',{...dnsOptions,recordType:'A'}],['ports',{target:'127.0.0.1',ports:`${servers.openPort},${servers.closedPort}`,concurrency:2}],
    ['quality',{target:'127.0.0.1',method:'tcp',port:servers.openPort,count:2,interval:200}],
    ['speed',{...options}],['certificate',{target:'127.0.0.1',port:servers.tlsPort,servername:'localhost',warnDays:30}]];
  for(const [kind,input] of jobs)await tasks.start(kind,{...input,timeout:1000,projectId:'default-project'});
  while(tasks.tasks.size)await delay(5);
  assert.equal(records.length,5);assert.ok(records.every(r=>r.status==='completed'));
  assert.equal(records.find(r=>r.kind==='ports').summary.closed,1);
  assert.equal(records.find(r=>r.kind==='quality').summary.failureRate,0);
  assert.equal(records.find(r=>r.kind==='speed').summary.bytes,2*1024*1024);
  assert.equal(records.find(r=>r.kind==='certificate').summary.valid,false);
  assert.ok(events.some(e=>e.kind==='ports' && e.rows?.length===2));
});
test('stop cancels a pending DNS query and a large local port task without late results', {timeout:10000},async(t)=>{
  const servers=await fixtureModule.fixtures();t.after(()=>servers.close());
  const records=[];let stopped=false;const events=[];
  const tasks=new native.NetworkTasks(event=>{
    events.push(event);
    if(event.kind==='ports' && event.completed>=64 && !stopped){stopped=true;tasks.control(event.id,'stop');}
  },async record=>records.push(record));
  t.after(()=>tasks.stopAll());
  const dns=await tasks.start('dns',{target:'timeout.test',recordType:'A',server:`127.0.0.1:${servers.dnsPort}`,timeout:5000});
  await delay(20);tasks.control(dns.id,'stop');
  await tasks.start('ports',{target:'127.0.0.1',ports:'40000-42000',concurrency:16,timeout:100});
  while(tasks.tasks.size)await delay(5);
  assert.ok(records.every(r=>r.status==='stopped'));
  const ports=records.find(r=>r.kind==='ports');assert.ok(ports.completed>=64 && ports.completed<2001);assert.equal(ports.rows.length,ports.completed);
  const count=events.length;await delay(30);assert.equal(events.length,count);
});
