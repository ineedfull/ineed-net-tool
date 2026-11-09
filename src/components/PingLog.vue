<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, ref, watch } from "vue";
import { Copy, Download } from "lucide-vue-next";
import { pingLogText } from "../domain/ping-log.js";
import { runtime } from "../runtime.js";
const props = defineProps({ record: { type: Object, required: true } });
const visibleLimit = ref(50);
const hasEntries = computed(() => !!props.record.pingLog?.length || props.record.rows?.some(row => row.raw));
const text = computed(() => pingLogText(props.record));
const visibleText = computed(() => pingLogText({
  ...props.record,
  pingLog: props.record.pingLog?.slice(-visibleLimit.value),
  rows: props.record.rows?.slice(-visibleLimit.value),
}));
const message = ref("");
const error = ref("");
watch(
  () => props.record.id,
  () => {
    message.value = "";
    error.value = "";
  },
);
async function act(action) {
  message.value = "";
  error.value = "";
  try {
    if (action === "copy") {
      await runtime.copy(text.value);
      message.value = "原始记录已复制";
    } else if (await runtime.export("net-tool-ping-log.txt", text.value)) {
      message.value = "原始记录已导出";
    }
  } catch (reason) {
    error.value = reason.message;
  }
}
</script>
<template>
  <section class="panel ping-log-panel">
    <div class="section-heading">
      <h2>Ping 原始记录</h2>
      <div class="actions">
        <button :disabled="!hasEntries" @click="act('copy')">
          <Copy :size="14" />复制原始记录
        </button>
        <button :disabled="!hasEntries" @click="act('export')">
          <Download :size="14" />导出 TXT
        </button>
      </div>
    </div>
    <p class="hint">
      保留最近 500
      次请求的系统输出、时间和执行参数，完成或停止后随诊断记录保存。默认显示最近 50 次；复制和导出包含全部保留记录，统计覆盖全部请求。
    </p>
    <label v-if="hasEntries" class="scan-block-label">显示原始记录
      <select v-model.number="visibleLimit" aria-label="Ping 原始记录显示数量">
        <option :value="50">最近 50 次</option>
        <option :value="500">全部保留记录（最多 500 次）</option>
      </select>
    </label>
    <FeedbackBanner v-model="message" />
    <FeedbackBanner v-model="error" variant="error" />
    <pre v-if="visibleText" class="raw-output" aria-label="Ping 原始输出">{{
      visibleText
    }}</pre>
    <p v-else class="muted">暂无原始输出，发起 Ping 后会自动记录。</p>
  </section>
</template>
