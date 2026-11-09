<script setup>
import { computed, ref, watch } from "vue";
import {
  Check,
  Minus,
  TriangleAlert,
  Circle,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";
import IpAddressGrid from "./IpAddressGrid.vue";
import { scanBlocks, scanGridCells, SCAN_CELL_STATUSES } from "../domain/scan-view.js";
const props = defineProps({
  task: Object,
  interactive: { type: Boolean, default: true },
  target: String,
  filter: String,
  interfaces: { type: Array, default: () => [] },
});
const emit = defineEmits(["navigate"]);
const selectedIp = ref("");
const selectedPrefix = ref("");
const localIps = computed(() => new Set(props.interfaces.map((i) => i.ip)));
const plan = computed(() => {
  try {
    return {
      groups: scanBlocks(props.target),
    };
  } catch (e) {
    return { groups: [], error: e.message };
  }
});
const group = computed(
  () =>
    plan.value.groups.find((g) => g.prefix === selectedPrefix.value) ||
    plan.value.groups[0],
);
const groupIndex = computed(() => plan.value.groups.indexOf(group.value));
const results = computed(() => new Map(props.task.rows.map(row => [row.ip, row])));
const cells = computed(() => scanGridCells(group.value, results.value, props.task.status));
const visible = computed(() =>
  cells.value.filter(
    (c) => props.filter === "all" || c.status === props.filter,
  ),
);
const selected = computed(() =>
    cells.value.find((c) => c.ip === selectedIp.value),
);
watch(
  () => props.task.id,
  () => {
    selectedIp.value = "";
    selectedPrefix.value = "";
  },
);
watch(
  () => props.target,
  () => {
    selectedIp.value = "";
    selectedPrefix.value = "";
  },
);
watch(
  () => props.filter,
  () => {
    selectedIp.value = "";
  },
);
function moveGroup(offset) {
  selectedPrefix.value = plan.value.groups[groupIndex.value + offset].prefix;
  selectedIp.value = "";
}
const statusIcon = (status) =>
  status === "reachable"
    ? Check
    : status === "no-response"
      ? Minus
      : status === "error"
        ? TriangleAlert
        : Circle;
</script>
<template>
  <div class="scan-grid-view">
    <p v-if="plan.error" class="empty">{{ plan.error }}</p>
    <template v-else>
      <div class="scan-grid-toolbar">
        <div class="actions">
          <label v-if="plan.groups.length > 1" class="scan-block-label"
            >地址区块<select
              :value="group?.prefix"
              aria-label="地址区块"
              @change="
                selectedPrefix = $event.target.value;
                selectedIp = '';
              "
            >
              <option
                v-for="g in plan.groups"
                :key="g.prefix"
                :value="g.prefix"
              >
                {{ g.prefix }}.*
              </option>
            </select></label
          >
          <strong v-else class="mono">{{ group?.prefix }}.*</strong>
          <span class="muted"
            >{{ visible.length }} / {{ cells.length }} 个地址</span
          >
        </div>
        <div v-if="plan.groups.length > 1" class="actions">
          <button
            aria-label="上一区块"
            :disabled="groupIndex <= 0"
            @click="moveGroup(-1)"
          >
            <ChevronLeft :size="14" /></button
          ><span class="muted"
            >{{ groupIndex + 1 }} / {{ plan.groups.length }}</span
          ><button
            aria-label="下一区块"
            :disabled="groupIndex >= plan.groups.length - 1"
            @click="moveGroup(1)"
          >
            <ChevronRight :size="14" />
          </button>
        </div>
      </div>
      <div class="scan-grid-legend" aria-label="网格图例">
        <span
          v-for="status in [
            'reachable',
            'no-response',
            'error',
            task.status === 'idle'
              ? 'untested'
              : ['starting', 'running', 'paused', 'stopping'].includes(
                    task.status,
                  )
                ? 'pending'
                : 'unfinished',
          ]"
          :key="status"
          :class="'scan-state-' + status"
          ><component :is="statusIcon(status)" :size="13" />{{
            SCAN_CELL_STATUSES[status]
          }}</span
        ><span class="scan-local-legend">◈ 本机</span>
      </div>
      <IpAddressGrid
        :cells="visible"
        :statuses="SCAN_CELL_STATUSES"
        :local-ips="localIps"
        v-model="selectedIp"
      />
      <p v-if="!visible.length" class="empty">当前区块没有符合此筛选的地址。</p>
      <div v-if="selected" class="scan-address-detail" aria-label="地址详情">
        <div>
          <strong class="mono">{{ selected.ip }}</strong
          ><span :class="'scan-state-' + selected.status">{{
            SCAN_CELL_STATUSES[selected.status]
          }}</span
          ><span v-if="localIps.has(selected.ip)" class="scan-local-legend"
            >本机</span
          ><span class="mono">{{
            selected.result?.ms == null
              ? "—"
              : selected.result.ms.toFixed(2) + " ms"
          }}</span
          ><span>{{ selected.result?.method || "尚无探测依据" }}</span>
        </div>
        <p>
          {{
            selected.result?.detail ||
            "此地址尚未获得探测结果，不能据此判断是否在线或空闲。"
          }}
        </p>
        <div v-if="interactive" class="actions">
          <button @click="emit('navigate', 'ping', selected.ip)">
            Ping 此地址</button
          ><button @click="emit('navigate', 'route', selected.ip)">
            查看路由
          </button>
        </div>
      </div>
      <p class="hint">
        数字为 IPv4
        地址的最后一段；点击查看完整地址与判断依据。按地址区块展示，每块最多 256
        个。无响应不等于空闲；CIDR 范围沿用现有可用地址规则。
      </p>
    </template>
  </div>
</template>
