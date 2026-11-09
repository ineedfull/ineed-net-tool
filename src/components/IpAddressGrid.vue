<script setup>
import {
  Monitor,
  Router,
  Check,
  Minus,
  TriangleAlert,
  Circle,
  Clock,
  Lock,
  Ban,
} from "lucide-vue-next";
const props = defineProps({
  cells: Array,
  statuses: Object,
  modelValue: String,
  localIps: { type: Set, default: () => new Set() },
});
const emit = defineEmits(["update:modelValue"]);
function describe(cell) {
  return [
    cell.ip,
    props.statuses[cell.status],
    cell.allocation?.label,
    cell.observation
      ? "最近探测：" +
        ({ reachable: "有响应", "no-response": "无响应", error: "错误" }[
          cell.observation.status
        ] || "未知")
      : "",
    props.localIps.has(cell.ip) ? "本机" : "",
    cell.result?.ms != null ? cell.result.ms.toFixed(2) + " ms" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
const icon = (status) =>
  ({
    reachable: Check,
    assigned: Check,
    "no-response": Minus,
    error: TriangleAlert,
    maintenance: TriangleAlert,
    unregistered: TriangleAlert,
    reserved: Clock,
    dhcp: Lock,
    excluded: Ban,
  })[status] || Circle;
</script>
<template>
  <div class="scan-address-grid" aria-label="紧凑 IP 地址网格">
    <button
      v-for="cell in cells"
      :key="cell.ip"
      :class="[
        'scan-address-cell',
        'scan-state-' + cell.status,
        {
          'is-selected': modelValue === cell.ip,
          'is-local': localIps.has(cell.ip),
        },
      ]"
      :title="
        describe(cell) + (cell.result?.detail ? '\n' + cell.result.detail : '')
      "
      :aria-label="describe(cell)"
      :aria-pressed="modelValue === cell.ip"
      @click="emit('update:modelValue', cell.ip)"
    >
      <component
        :is="cell.status === 'gateway' ? Router : Monitor"
        :size="21"
        class="scan-device-icon"
      /><component
        :is="icon(cell.status)"
        :size="9"
        class="scan-status-mark"
      /><span class="mono">{{ cell.suffix }}</span
      ><span
        v-if="localIps.has(cell.ip)"
        class="scan-local-mark"
        aria-hidden="true"
        >◈</span
      ><span
        v-if="cell.observation"
        :class="['ip-observation-dot', 'observed-' + cell.observation.status]"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
