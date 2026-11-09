<script setup>
import { computed, inject, ref, watch } from "vue";
import { formatDateTime } from "../domain/date-time.js";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import IpAddressGrid from "./IpAddressGrid.vue";
import { IP_DISPLAY } from "../ip-display.js";
import {
  ADDRESS_MAP_STATUSES,
  addressMapBlock,
  latestIpObservations,
} from "../domain/address-map.js";
import { ADDRESS_STATUSES } from "../domain/projects.js";
import { ipNumber, subnet } from "../domain/ipv4.js";
const props = defineProps({
  networks: Array,
  visibleNetworks: Array,
  search: String,
  allocationStatus: String,
});
const emit = defineEmits(["register", "edit", "remove", "navigate"]);
const display = inject(IP_DISPLAY);
const selectedNetworkId = ref("");
const network = computed(
  () =>
    props.visibleNetworks.find((n) => n.id === selectedNetworkId.value) ||
    props.visibleNetworks[0],
);
const blockIndex = ref(0);
const pageNumber = ref(1);
const selectedIp = ref("");
const stateFilter = ref("");
const observationFilter = ref("");
const observations = computed(() =>
  latestIpObservations(display.history.value, display.scanTask.value),
);
const block = computed(() =>
  network.value
    ? addressMapBlock(
        network.value,
        props.networks,
        blockIndex.value,
        observations.value,
      )
    : null,
);
const exactIpSearch = computed(() => {
  const query = (props.search || "").trim();
  try {
    ipNumber(query);
    return query;
  } catch {
    return "";
  }
});
const visible = computed(() =>
  (block.value?.cells || []).filter(
    (c) =>
      (!stateFilter.value || c.status === stateFilter.value) &&
      (!props.allocationStatus ||
        c.allocation?.status === props.allocationStatus ||
        (c.allocation &&
          !c.allocation.status &&
          props.allocationStatus === "assigned")) &&
      (!observationFilter.value ||
        (c.observation?.status || "unknown") === observationFilter.value) &&
      (exactIpSearch.value
        ? c.ip === exactIpSearch.value
        : [
            c.ip,
            c.allocation?.label,
            c.allocation?.location,
            c.allocation?.owner,
            c.allocation?.mac,
            c.allocation?.note,
            c.network.name,
          ]
            .join(" ")
            .toLowerCase()
            .includes((props.search || "").trim().toLowerCase())),
  ),
);
const selected = computed(() =>
  block.value?.cells.find((c) => c.ip === selectedIp.value),
);
const counts = computed(() =>
  (block.value?.cells || []).reduce(
    (map, cell) => ({ ...map, [cell.status]: (map[cell.status] || 0) + 1 }),
    {},
  ),
);
function goPage(value) {
  const index = Math.max(
    0,
    Math.min(
      (block.value?.blocks || 1) - 1,
      Math.trunc(Number(value) || 1) - 1,
    ),
  );
  blockIndex.value = index;
  pageNumber.value = index + 1;
  selectedIp.value = "";
}
watch(
  () => network.value?.id + ":" + network.value?.cidr,
  () => {
    blockIndex.value = 0;
    pageNumber.value = 1;
    selectedIp.value = "";
  },
  { flush: "sync" },
);
watch(
  () => props.search,
  (value) => {
    selectedIp.value = "";
    if (!network.value) return;
    try {
      const ip = ipNumber(value.trim()),
        net = subnet(network.value.cidr);
      if (ip >= net.first && ip <= net.last)
        goPage(Math.floor(ip / 256) - Math.floor(net.first / 256) + 1);
    } catch {
      /* Partial device/IP searches only filter the current block. */
    }
  },
);
watch([stateFilter, observationFilter, () => props.allocationStatus], () => {
  selectedIp.value = "";
});
</script>
<template>
  <div class="allocation-map">
    <div v-if="!network" class="empty">
      先保存一个网段，即可查看地址使用情况。
    </div>
    <template v-else>
      <div class="form-row">
        <label v-if="visibleNetworks.length > 1" class="grow"
          >查看网段<select
            aria-label="查看网段"
            :value="network.id"
            @change="selectedNetworkId = $event.target.value"
          >
            <option v-for="n in visibleNetworks" :key="n.id" :value="n.id">
              {{ n.name }} · {{ n.cidr }} · VLAN {{ n.vlan || "—" }}
            </option>
          </select></label
        >
        <label
          >地址用途<select v-model="stateFilter" aria-label="地址用途">
            <option value="">全部用途</option>
            <option
              v-for="(label, key) in ADDRESS_MAP_STATUSES"
              :key="key"
              :value="key"
            >
              {{ label }}
            </option>
          </select></label
        >
        <label
          >最近探测<select v-model="observationFilter" aria-label="最近探测">
            <option value="">全部</option>
            <option value="reachable">有响应</option>
            <option value="no-response">无响应</option>
            <option value="error">探测错误</option>
            <option value="unknown">暂无记录</option>
          </select></label
        >
      </div>
      <div class="scan-grid-toolbar">
        <div>
          <strong>{{ network.name }}</strong
          ><span class="muted"> · VLAN {{ network.vlan || "—" }}</span>
          <p class="mono">{{ block.first }} — {{ block.last }}</p>
        </div>
        <div v-if="block.blocks > 1" class="actions">
          <button
            aria-label="上一区块"
            :disabled="blockIndex === 0"
            @click="goPage(blockIndex)"
          >
            <ChevronLeft :size="14" /></button
          ><label class="scan-block-label"
            >区块<input
              v-model="pageNumber"
              type="number"
              min="1"
              :max="block.blocks"
              aria-label="网段区块页码"
              @change="goPage(pageNumber)"
              @keydown.enter.prevent="goPage(pageNumber)" /></label
          ><span class="muted">/ {{ block.blocks }}</span
          ><button
            aria-label="下一区块"
            :disabled="blockIndex === block.blocks - 1"
            @click="goPage(blockIndex + 2)"
          >
            <ChevronRight :size="14" />
          </button>
        </div>
      </div>
      <div class="scan-grid-legend allocation-legend" aria-label="地址用途图例">
        <span
          v-for="(label, key) in ADDRESS_MAP_STATUSES"
          :key="key"
          :class="'scan-state-' + key"
          ><i />{{ label }} {{ counts[key] || 0 }}</span
        >
      </div>
      <p class="hint map-count">
        当前区块显示 {{ visible.length }} /
        {{ block.cells.length }} 个地址。搜索完整 IP 可直接跳到所在区块。
      </p>
      <IpAddressGrid
        :cells="visible"
        :statuses="ADDRESS_MAP_STATUSES"
        v-model="selectedIp"
      />
      <p v-if="!visible.length" class="empty">当前区块没有符合筛选的地址。</p>
      <div
        v-if="selected"
        class="scan-address-detail"
        aria-label="台账地址详情"
      >
        <div>
          <strong class="mono">{{ selected.ip }}</strong
          ><span :class="'scan-state-' + selected.status">{{
            ADDRESS_MAP_STATUSES[selected.status]
          }}</span
          ><span v-if="selected.allocation"
            >{{ selected.allocation.label || "未命名设备" }} ·
            {{
              ADDRESS_STATUSES[selected.allocation.status || "assigned"]
            }}</span
          >
        </div>
        <p v-if="selected.allocation">
          {{
            [
              selected.allocation.location,
              selected.allocation.owner,
              selected.allocation.mac,
              selected.allocation.note,
            ]
              .filter(Boolean)
              .join(" · ") || "尚未补充设备详情"
          }}<span v-if="selected.network.id !== network.id">
            · 登记在 {{ selected.network.name }}</span
          >
        </p>
        <p v-if="selected.observation">
          最近探测：{{
            { reachable: "有响应", "no-response": "无响应", error: "错误" }[
              selected.observation.status
            ]
          }}
          · {{ formatDateTime(selected.observation.time) }} ·
          {{ selected.observation.method || "—" }}<br />{{
            selected.observation.detail || "来自本项目的诊断记录"
          }}
        </p>
        <p v-else>
          暂无探测记录。可分配仅表示未被台账、网关和 DHCP
          池占用，登记前请核实现场。
        </p>
        <div class="actions">
          <button
            v-if="selected.allocation"
            class="primary"
            @click="emit('edit', selected)"
          >
            编辑此地址</button
          ><button
            v-else-if="!['excluded', 'dhcp'].includes(selected.status)"
            class="primary"
            @click="emit('register', selected)"
          >
            {{
              selected.status === "gateway"
                ? "登记网关"
                : selected.status === "unregistered"
                  ? "核实后登记"
                  : "登记此地址"
            }}</button
          ><button
            v-if="selected.status !== 'excluded'"
            @click="emit('navigate', 'ping', selected.ip)"
          >
            Ping 此地址</button
          ><button
            v-if="selected.allocation"
            class="danger"
            @click="
              emit('remove', {
                ...selected.allocation,
                network: selected.network,
              })
            "
          >
            移除此登记</button
          ><span v-if="selected.status === 'dhcp'" class="muted"
            >动态地址池不作静态登记</span
          ><span v-if="selected.status === 'excluded'" class="muted"
            >网络或广播地址不能登记</span
          >
        </div>
      </div>
      <p class="hint">
        可分配仅指台账未占用，无响应不等于现场空闲。图标颜色表示台账用途；右下角圆点表示最近探测：绿色有响应、灰色无响应、红色错误，无圆点表示暂无记录。探测来自本机当前网络视角，时间见详情，不代表持续在线监测，也不区分同址的不同
        VLAN。
      </p>
    </template>
  </div>
</template>
