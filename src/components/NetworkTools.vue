<script setup>
import { computed } from 'vue';
import { Play, Square, Download } from 'lucide-vue-next';
import ToolResults from './ToolResults.vue';
const props=defineProps({kind:String,task:Object,form:Object,desktop:Boolean});
const emit=defineEmits(['start','control','export','mode']);
const busy=computed(()=>['starting','running','stopping'].includes(props.task.status));
const statuses={idle:'就绪',starting:'准备中',running:'运行中',stopping:'正在停止',stopped:'已停止',completed:'已完成',error:'执行失败'};
const descriptions={dns:'查询域名记录，核对解析服务器、结果与响应耗时。',ports:'针对一个目标检测 TCP 端口，区分连接成功、明确拒绝和超时。',speed:'从指定 HTTP / HTTPS 地址下载数据，测量当前路径的实际吞吐量。',quality:'连续采样延迟、失败率和抖动，观察目标路径的稳定性。',certificate:'检查 TLS 证书有效期、域名匹配及应用信任校验结果。'};
</script>
<template>
  <section class="workspace-toolbar"><p>{{ descriptions[kind] }}</p><button :disabled="!task.id" @click="emit('export')"><Download :size="15"/>导出结果</button></section>
  <div v-if="!desktop" class="banner">当前为浏览器预览；真实查询请使用桌面应用。</div>
  <section class="panel">
    <div v-if="['speed','quality'].includes(kind)" class="actions tool-mode" aria-label="测速模式">
      <button :class="{primary:kind==='speed'}" :aria-pressed="kind==='speed'" @click="emit('mode','speed')">下载测速</button>
      <button :class="{primary:kind==='quality'}" :aria-pressed="kind==='quality'" @click="emit('mode','quality')">链路质量</button>
    </div>
    <div class="section-heading"><h2>测试参数</h2><span class="badge">{{ statuses[task.status] }}</span></div>
    <fieldset :disabled="busy">
      <div class="form-row">
        <label class="grow">{{kind==='speed'?'下载地址':kind==='dns'?'域名 / IP':'目标域名 / IPv4'}}<input v-model="form.target" :aria-label="kind+'目标'" :placeholder="kind==='speed'?'https://服务器/测试文件.bin':'example.com 或 192.168.1.1'" @keydown.enter="emit('start')"/></label>
        <label>{{kind==='speed'?'连接 / 空闲超时（ms）':'超时（ms）'}}<input v-model.number="form.timeout" type="number" min="100" max="10000" aria-label="工具超时毫秒"/></label>
      </div>
      <div v-if="kind==='dns'" class="form-row">
        <label>记录类型<select v-model="form.recordType" aria-label="DNS 记录类型"><option v-for="type in ['A','AAAA','CNAME','MX','TXT','NS','SOA','SRV','CAA','PTR']" :key="type">{{type}}</option></select></label>
        <label class="grow">DNS 服务器（可选）<input v-model="form.server" placeholder="留空使用系统 DNS，可输入 IP:端口" aria-label="DNS 服务器"/></label>
      </div>
      <div v-if="kind==='ports'" class="form-row">
        <label class="grow">端口 / 范围<input v-model="form.ports" placeholder="22,80,443,8000-8100" aria-label="扫描端口"/></label>
        <label>并发连接<input v-model.number="form.concurrency" type="number" min="1" max="128" aria-label="端口扫描并发"/></label>
      </div>
      <div v-if="kind==='speed'" class="form-row">
        <label>最长下载（秒）<input v-model.number="form.duration" type="number" min="1" max="60" aria-label="测速秒数"/></label>
        <label>下载量上限（MiB）<input v-model.number="form.maxMiB" type="number" min="1" max="256" aria-label="测速流量上限"/></label>
      </div>
      <div v-if="kind==='quality'" class="form-row">
        <label>方式<select v-model="form.method" aria-label="质量测试方式"><option value="icmp">ICMP 回应</option><option value="tcp">TCP 连接</option></select></label>
        <label v-if="form.method==='tcp'">端口<input v-model.number="form.port" type="number" min="1" max="65535" aria-label="质量测试端口"/></label>
        <label>采样次数<input v-model.number="form.count" type="number" min="2" max="300" aria-label="质量采样次数"/></label>
        <label>间隔（ms）<input v-model.number="form.interval" type="number" min="200" max="60000" aria-label="质量采样间隔"/></label>
      </div>
      <div v-if="kind==='certificate'" class="form-row">
        <label>TLS 端口<input v-model.number="form.port" type="number" min="1" max="65535" aria-label="TLS 端口"/></label>
        <label class="grow">校验域名 / SNI（可选）<input v-model="form.servername" placeholder="留空使用目标域名；连接 IP 时可指定站点域名" aria-label="证书校验域名"/></label>
        <label>临期阈值（天）<input v-model.number="form.warnDays" type="number" min="1" max="365" aria-label="证书临期天数"/></label>
      </div>
    </fieldset>
    <div class="actions section-divider">
      <button class="primary" :disabled="busy || !desktop" @click="emit('start')"><Play :size="14"/>{{task.id?'重新测试':'开始测试'}}</button>
      <button class="danger" :disabled="!busy || task.status==='starting' || task.status==='stopping'" @click="emit('control','stop')"><Square :size="14"/>停止</button>
      <span v-if="task.resolvedIp" class="muted mono">{{task.target}} → {{task.resolvedIp}}</span>
    </div>
    <p v-if="kind==='ports'" class="hint">支持 1～65535 端口，最多同时建立 128 个连接。超时不等于端口关闭；这里只检测 TCP，不发送应用报文。</p>
    <p v-if="kind==='speed'" class="hint">使用你指定的测试文件，不写入磁盘。达到时长或下载量上限后自动停止。结果受服务器、文件大小和网络路径共同影响，不等同于宽带套餐上限；本期为下载测速。</p>
    <p v-if="kind==='quality'" class="hint">ICMP 统计丢包率；TCP 统计连接失败率，拒绝连接不代表设备离线。抖动为相邻成功采样耗时差的平均绝对值，失败处断开计算。</p>
    <p v-if="kind==='certificate'" class="hint">仅执行 TLS 握手，不发送业务数据。不受信任或过期的证书仍会展示并标明原因；使用应用信任库，不检查吊销状态。</p>
    <p v-if="kind==='dns'" class="hint">PTR 输入 IP；SRV 输入完整服务域名（如 _sip._tcp.example.com）。结果来自所选 DNS 服务器。</p>
    <p v-if="task.error" class="inline-error" role="alert">{{task.error}}</p>
    <p v-if="task.saveError" class="inline-error" role="alert">{{task.saveError}}</p>
  </section>
  <div v-if="task.total" class="scan-progress" role="status"><progress :max="task.total" :value="task.completed" aria-label="工具测试进度"/><span>{{task.completed}} / {{task.total}}</span></div>
  <ToolResults :kind="kind" :task="task"/>
</template>
<style scoped>.tool-mode{margin-bottom:20px}.workspace-toolbar p{margin:0}</style>
