<script setup>
import { ArrowRight } from "lucide-vue-next";
defineProps({ info: Object });
</script>
<template>
      <div class="metrics">
        <div>
          <span>网络地址</span
          ><strong class="mono">{{ info.network }}</strong>
        </div>
        <div>
          <span>子网掩码</span
          ><strong class="mono">{{ info.mask }}</strong>
        </div>
        <div>
          <span>广播地址</span
          ><strong class="mono">{{ info.broadcast }}</strong>
        </div>
        <div>
          <span>可用地址</span
          ><strong
            >{{ info.usable.toLocaleString() }} <small>个</small></strong
          >
        </div>
      </div>
      <div class="range-strip">
        <span>可用范围</span><code>{{ info.start }}</code
        ><ArrowRight :size="14" /><code>{{ info.end }}</code
        ><span class="muted">{{
          info.prefix === 31
            ? "点对点网段（RFC 3021）"
            : info.prefix === 32
              ? "单主机地址"
              : `共 ${info.size.toLocaleString()} 个地址，排除网络及广播地址`
        }}</span>
      </div>
</template>
