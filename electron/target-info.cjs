const net = require('node:net');
const os = require('node:os');
const { Resolver } = require('node:dns/promises');
const { setTimeout: delay } = require('node:timers/promises');
let registry;
const field = (value, source, detail = '') => ({ value, source, detail });

function normalizeMac(value) {
  const parts=String(value || '').replace(/-/g,':').split(':');
  if(parts.length!==6 || parts.some(p=>! /^[a-f\d]{1,2}$/i.test(p)))return '';
  const bytes=parts.map(p=>parseInt(p,16));
  if(bytes.every(b=>b===0) || (bytes[0]&1))return '';
  return bytes.map(b=>b.toString(16).padStart(2,'0')).join(':').toUpperCase();
}
function vendorForMac(mac, data) {
  const normalized=normalizeMac(mac);
  if(!normalized)return field('','','没有可识别的 MAC 地址');
  if(parseInt(normalized.slice(0,2),16)&2)return field('','本地管理地址','本地管理／可能随机生成的 MAC，不能据此确定厂商');
  try {
    const db=data || (registry ||= require('./data/oui.json'));
    const hex=normalized.replace(/:/g,'');
    for(const length of [9,7,6]) {
      const prefix=hex.slice(0,length);
      if(db.entries[prefix])return {...field(db.entries[prefix],'IEEE 地址库',`地址注册机构；库更新于 ${db.updatedAt.slice(0,10)}`),prefix,prefixLength:length*4};
    }
    return field('','IEEE','离线地址库中未匹配到注册机构');
  } catch { return field('','','离线厂商库不可用'); }
}
function parseDarwinRoute(raw) {
  const flags=raw.match(/^\s*flags:\s*<([^>]+)>/m)?.[1].split(',') || [];
  return {direct:flags.includes('UP') && !flags.includes('GATEWAY') && !flags.includes('REJECT') && !flags.includes('BLACKHOLE'),interface:raw.match(/^\s*interface:\s*(\S+)/m)?.[1] || ''};
}
function parseDarwinArp(raw, ip, iface) {
  for(const line of raw.split('\n')) {
    const m=line.match(/\(([^)]+)\) at ([\da-f:]+) on (\S+)/i);
    if(m && m[1]===ip && m[3]===iface)return normalizeMac(m[2]);
  }
  return '';
}
async function reverseHostname(ip, signal) {
  const resolver=new Resolver({timeout:1000,tries:1});
  const abort=()=>resolver.cancel();
  signal.addEventListener('abort',abort,{once:true});
  try {
    if(signal.aborted)throw new Error('cancelled');
    const names=await resolver.reverse(ip);
    const value=names.find(n=>n && n.length<=253 && !/[\x00-\x20]/.test(n)) || '';
    return field(value,'反向 DNS（PTR）',value ? 'DNS 登记名称，可能与设备设置的名称不同' : '目标没有可用的反向 DNS 记录');
  } catch { return field('','反向 DNS（PTR）',signal.aborted?'查询已取消或超时':'未获取到反向 DNS 名称'); }
  finally { signal.removeEventListener('abort',abort); }
}
async function neighborMac(ip, {run,signal,platform}) {
  async function command(binary,args,allowMissing=false) {
    const result=await run(binary,args,{signal,timeout:1000});
    if((result.code!==0 && !allowMissing) || result.cancelled || result.timedOut)throw new Error('neighbor query failed');
    return result.raw;
  }
  try {
    let read;
    if(platform==='darwin') {
      const route=parseDarwinRoute(await command('/sbin/route',['-n','get',ip]));
      if(!route.direct || !route.interface)return field('','路由检查','目标经网关或非直连路由访问，无法获取目标 MAC');
      read=async()=>parseDarwinArp(await command('/usr/sbin/arp',['-n',ip],true),ip,route.interface);
    } else if(platform==='linux') {
      const [route]=JSON.parse(await command('ip',['-j','route','get',ip]));
      if(!route?.dev || route.gateway || ['blackhole','unreachable','prohibit'].includes(route.type))return field('','路由检查','目标经网关或非直连路由访问，无法获取目标 MAC');
      read=async()=>{
        const rows=JSON.parse(await command('ip',['-j','neigh','show','to',ip,'dev',route.dev]));
        return normalizeMac(rows.find(row=>row.dst===ip && row.dev===route.dev && !(row.state || []).some(s=>['FAILED','INCOMPLETE'].includes(s)))?.lladdr);
      };
    } else if(platform==='win32') {
      // ip has passed net.isIPv4; no user shell text enters this fixed script.
      const script=`$r=Find-NetRoute -RemoteIPAddress '${ip}' -ErrorAction Stop | Where-Object { $_.DestinationPrefix } | Select-Object -First 1; if (!$r -or $r.NextHop -ne '0.0.0.0') { @{direct=$false} | ConvertTo-Json -Compress } else { $n=Get-NetNeighbor -IPAddress '${ip}' -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue | Where-Object { $_.State -notin @('Unreachable','Incomplete') } | Select-Object -First 1; @{direct=$true; mac=$n.LinkLayerAddress} | ConvertTo-Json -Compress }`;
      read=async()=>{
        const data=JSON.parse(await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',script]));
        if(!data.direct)throw new Error('routed');
        return normalizeMac(data.mac);
      };
    } else return field('','','当前系统暂不支持邻居查询');
    for(let attempt=0;attempt<3;attempt++) {
      if(attempt)await delay(300,null,{signal});
      const mac=await read();
      if(mac)return field(mac,'系统邻居表','目标 IP 对应的邻居记录；可能受缓存或代理 ARP 影响');
    }
    return field('','系统邻居表','尚无目标的有效邻居记录');
  } catch(error) {
    return field('','系统邻居表',signal.aborted?'查询已取消或超时':error.message==='routed'?'目标经网关访问，无法获取目标 MAC':'未能读取目标的邻居记录，可能不存在或系统查询不可用');
  }
}
async function lookupTargetInfo(ip, {run,signal:parentSignal,platform=process.platform,networkInterfaces=os.networkInterfaces,hostname=os.hostname,reverse=reverseHostname,vendor=vendorForMac} = {}) {
  if(!net.isIPv4(ip))throw new Error('目标信息查询只支持已解析的 IPv4 地址');
  const signal=parentSignal ? AbortSignal.any([parentSignal,AbortSignal.timeout(2500)]) : AbortSignal.timeout(2500);
  const local=Object.values(networkInterfaces()).flat().find(entry=>entry.family==='IPv4' && entry.address===ip);
  const loopback=ip.startsWith('127.');
  const reserved=Number(ip.split('.')[0])===0 || Number(ip.split('.')[0])>=224;
  const [name,mac]=await Promise.all([
    local || loopback ? field(hostname(),'本机系统名称') : reserved ? field('','','特殊用途地址不查询设备名称') : reverse(ip,signal),
    loopback || local?.internal ? field('','回环地址','回环接口没有目标物理 MAC') : local ? field(normalizeMac(local.mac),'本机网卡',normalizeMac(local.mac)?'':'本机接口未提供有效 MAC') : reserved ? field('','','特殊用途地址没有目标单播 MAC') : neighborMac(ip,{run,signal,platform}),
  ]);
  return {ip,status:signal.aborted?'partial':'complete',hostname:name,mac,vendor:vendor(mac.value),checkedAt:new Date().toISOString()};
}
module.exports={normalizeMac,vendorForMac,parseDarwinRoute,parseDarwinArp,reverseHostname,lookupTargetInfo};
