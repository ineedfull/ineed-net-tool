<script setup>
import { formatDateTime } from "../domain/date-time.js";
defineProps({ info: Object, ip: String, historical: Boolean });
const fields = [{key:'hostname',name:'主机名'},{key:'mac',name:'MAC 地址'},{key:'vendor',name:'厂商 / 注册机构'}];
</script>
<template>
  <section class="panel target-info" aria-label="目标设备信息">
    <div class="section-heading">
      <h2>目标信息 <span class="muted mono">{{ info?.ip || ip || '等待开始 Ping' }}</span></h2>
      <span class="muted">{{ info?.status === 'loading' ? '后台查询中…' : info?.checkedAt != null ? formatDateTime(info.checkedAt) : historical ? '历史快照' : '自动查询' }}</span>
    </div>
    <dl class="target-info-fields">
      <div v-for="f in fields" :key="f.key" :aria-label="f.name">
        <dt>{{ f.name }}</dt>
        <dd :class="{mono:f.key==='mac'}">{{ info?.[f.key]?.value || (info?.status==='loading' ? '查询中…' : !info && !historical ? '—' : '未获取') }}</dd>
        <p class="muted">{{ info?.[f.key]?.source || '—' }}</p>
        <p class="hint">{{ info?.[f.key]?.detail || (info?.status==='loading' ? '不影响 Ping 收发' : info?.detail || (!info && historical ? '此旧记录未保存设备信息' : '')) }}</p>
      </div>
    </dl>
    <p class="hint">主机名来自本机系统或反向 DNS；MAC 通常仅能获取直连网络设备。厂商按 IEEE 地址库离线匹配，代表地址注册机构，不一定是整机品牌。</p>
  </section>
</template>
<style scoped>
.target-info-fields {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0;}
.target-info-fields > div {min-width:0;}
dt {color:var(--muted);font-size:var(--small);}
dd {margin:8px 0;font-weight:600;overflow-wrap:anywhere;min-height:1.6em;}
.target-info-fields p {overflow-wrap:anywhere;margin:6px 0 0;}
@media(max-width:1000px){.target-info-fields{grid-template-columns:repeat(2,minmax(0,1fr));}.target-info-fields > div:last-child{grid-column:1 / -1;}}
@media(max-width:700px){.target-info-fields{grid-template-columns:minmax(0,1fr);}}
</style>
