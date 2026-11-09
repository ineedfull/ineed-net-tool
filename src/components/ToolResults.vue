<script setup>
import { computed, ref, watch } from 'vue';
import ResultPager from './ResultPager.vue';
import { formatCertificateTime } from '../domain/date-time.js';
const props=defineProps({kind:String,task:Object});
const page=ref(1),filter=ref('all');
watch([()=>props.task.id,()=>props.kind,filter],()=>{page.value=1;});
const summary=computed(()=>props.task.summary);
const rows=computed(()=>{
  const items=(props.task.rows || []).filter(row=>props.kind!=='ports' || filter.value==='all' || row.state===filter.value);
  return props.kind==='ports'?[...items].sort((a,b)=>a.port-b.port):items;
});
const currentPage=computed(()=>Math.min(page.value,Math.max(1,Math.ceil(rows.value.length/100))));
const visible=computed(()=>rows.value.slice((currentPage.value-1)*100,currentPage.value*100));
const ms=n=>n==null?'—':`${n.toFixed(2)} ms`;
const fixed=n=>Number.isFinite(n)?n.toFixed(2):'—';
const label={reachable:'成功',open:'开放',closed:'关闭',timeout:'超时 / 未知','no-response':'无响应',error:'错误',invalid:'证书异常'};
const person=obj=>Object.entries(obj||{}).map(([k,v])=>`${k}=${Array.isArray(v)?v.join(', '):v}`).join(' · ') || '—';
const dnsValue=value=>typeof value==='string'?value:Array.isArray(value)?value.join(''):value?.address || Object.entries(value||{}).map(([k,v])=>`${k}: ${v}`).join(' · ');
const certState=computed(()=>!summary.value?'':summary.value.expired?'已过期':summary.value.notYetValid?'尚未生效':summary.value.daysRemaining==null?'有效期未知':summary.value.expiring?'即将到期':'有效期正常');
</script>
<template>
  <section class="panel tool-results" aria-label="工具测试结果">
    <div class="section-heading"><h2>测试结果</h2>
      <select v-if="kind==='ports'" v-model="filter" aria-label="端口状态筛选"><option value="all">全部状态</option><option value="open">开放</option><option value="closed">关闭</option><option value="timeout">超时 / 未知</option><option value="error">错误</option></select>
      <span v-if="kind==='dns' && summary" class="muted">{{summary.recordType}} · {{ms(summary.queryMs)}}</span>
    </div>
    <div v-if="!summary && !rows.length" class="empty"><strong>{{['running','starting'].includes(task.status)?'正在等待结果…':'结果将在测试后显示'}}</strong><p>可切换页面，已开始的任务会继续运行。</p></div>
    <template v-if="kind==='ports' && summary">
      <div class="metrics"><div v-for="state in ['open','closed','timeout','error']" :key="state"><span>{{label[state]}}</span><strong>{{summary[state]}}</strong></div></div>
    </template>
    <template v-if="kind==='quality' && summary">
      <div class="metrics"><div><span>{{task.options?.method==='tcp'?'连接失败率':'丢包率'}}</span><strong>{{fixed(summary.failureRate)}}%</strong></div><div><span>平均延迟</span><strong>{{ms(summary.average)}}</strong></div><div><span>P95 延迟</span><strong>{{ms(summary.p95)}}</strong></div><div><span>抖动</span><strong>{{ms(summary.jitter)}}</strong></div></div>
      <p class="hint">成功 {{summary.received}} / {{summary.sent}} · 最小 {{ms(summary.min)}} · 最大 {{ms(summary.max)}}</p>
    </template>
    <template v-if="kind==='speed' && summary">
      <div class="metrics"><div><span>平均下载吞吐量</span><strong>{{fixed(summary.mbps)}} <small>Mbps</small></strong></div><div><span>下载速度</span><strong>{{fixed(summary.elapsedMs?summary.bytes/summary.elapsedMs*1000/1048576:0)}} <small>MiB/s</small></strong></div><div><span>已接收</span><strong>{{fixed(summary.bytes/1048576)}} <small>MiB</small></strong></div><div><span>下载时长</span><strong>{{fixed(summary.elapsedMs/1000)}} <small>秒</small></strong></div></div>
      <p class="hint">{{{running:'下载进行中',end:'文件下载完成',duration:'达到设定时长',bytes:'达到下载量上限',stopped:'已停止，保留部分结果',error:'下载失败，保留已接收数据'}[summary.reason]}}</p>
      <p class="tool-long muted">实际地址：{{summary.url}}</p>
    </template>
    <template v-if="kind==='certificate' && summary">
      <div class="metrics"><div><span>有效期</span><strong :class="summary.expired || summary.notYetValid?'error-text':''">{{certState}}</strong></div><div><span>剩余天数</span><strong>{{summary.daysRemaining ?? '—'}}</strong></div><div><span>域名匹配</span><strong>{{summary.nameMatches?'匹配':'不匹配'}}</strong></div><div><span>TLS 验证</span><strong>{{summary.trusted?'通过':'未通过'}}</strong></div></div>
      <p v-if="summary.trustError" class="inline-error tool-long">信任校验：{{summary.trustError}}</p>
      <p v-if="summary.nameError" class="inline-error tool-long">域名校验：{{summary.nameError}}</p>
      <dl class="tool-details">
        <div><dt>生效时间</dt><dd>{{formatCertificateTime(summary.validFrom)}}</dd></div><div><dt>到期时间</dt><dd>{{formatCertificateTime(summary.validTo)}}</dd></div>
        <div><dt>校验域名</dt><dd>{{summary.expectedName}}</dd></div><div><dt>协议 / 加密套件</dt><dd>{{summary.protocol}} · {{summary.cipher}}</dd></div>
        <div class="wide"><dt>证书主体</dt><dd>{{person(summary.subject)}}</dd></div><div class="wide"><dt>签发者</dt><dd>{{person(summary.issuer)}}</dd></div>
        <div class="wide"><dt>域名 / IP（SAN）</dt><dd>{{summary.subjectAltName || '—'}}</dd></div>
        <div class="wide"><dt>SHA-256 指纹</dt><dd class="mono">{{summary.fingerprint}}</dd></div>
      </dl>
      <details v-if="summary.chain?.length"><summary>服务器提供的证书链（{{summary.chain.length}}）</summary><div v-for="(cert,index) in summary.chain" :key="index" class="tool-chain tool-long"><strong>{{index+1}} · {{person(cert.subject)}}</strong><p class="hint">签发者：{{person(cert.issuer)}}<br/>到期：{{formatCertificateTime(cert.validTo)}}</p></div></details>
    </template>
    <p v-if="kind==='dns' && summary" class="hint">解析服务器：{{summary.servers?.join('、')}} · {{summary.count}} 条记录{{task.status==='completed' && !summary.count?'（无结果）':''}}</p>
    <div v-if="['dns','ports','quality'].includes(kind) && rows.length" class="table-wrap result-scroll">
      <table><thead><tr><th>#</th><th>{{kind==='dns'?'记录类型':kind==='ports'?'TCP 端口':'目标 IP'}}</th><th>{{kind==='dns'?'结果':'状态'}}</th><th>{{kind==='dns'?'TTL（秒）':'耗时'}}</th><th v-if="kind!=='dns'">依据</th></tr></thead>
        <tbody><tr v-for="item in visible" :key="item.seq"><td>{{item.seq}}</td><td class="mono">{{kind==='dns'?item.recordType:kind==='ports'?item.port:item.ip}}</td><td v-if="kind==='dns'" class="tool-long">{{dnsValue(item.value)}}</td><td v-else><span :class="['badge',item.status==='reachable'?'green':item.status==='error'?'red':'']">{{label[item.state || item.status] || item.status}}</span></td><td class="mono">{{kind==='dns'?(item.value?.ttl ?? '—'):ms(item.ms)}}</td><td v-if="kind!=='dns'" class="tool-long">{{item.detail}}</td></tr></tbody>
      </table>
    </div>
    <p v-if="kind==='ports' && task.rows.length && !rows.length" class="empty">没有符合筛选的端口。</p>
    <ResultPager :total="rows.length" :page="currentPage" @update:page="page=$event"/>
  </section>
</template>
<style scoped>
.tool-long,dd{overflow-wrap:anywhere;word-break:break-word}.tool-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:20px 0}.tool-details .wide{grid-column:1 / -1}dt{color:var(--muted);font-size:var(--small)}dd{margin:6px 0}.tool-chain{padding:12px 0;border-bottom:1px solid var(--border)}.metrics strong{font-size:20px}.metrics{margin-bottom:16px}.tool-results table{table-layout:fixed}.tool-results th:first-child{width:54px}@media(max-width:760px){.tool-details{grid-template-columns:minmax(0,1fr)}}
</style>
