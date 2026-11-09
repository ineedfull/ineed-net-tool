<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, onDeactivated, onUnmounted, ref } from "vue";
import {
  Plus,
  Save,
  Download,
  Upload,
  Radar,
  Pencil,
  Trash2,
} from "lucide-vue-next";
import {
  subnet,
  suggestGateway,
  validateGateway,
} from "../domain/ipv4.js";
import { validateNetworks, overlapNames } from "../domain/workspace.js";
import SubnetSummary from "./SubnetSummary.vue";
import AllocationPanel from "./AllocationPanel.vue";
import { runtime } from "../runtime.js";
const props = defineProps({
  projectId: String,
  networks: Array,
  saveNetworks: Function,
  initialTarget: String,
});
const emit = defineEmits(["navigate"]);
let importVersion = 0;
onDeactivated(() => { importVersion += 1; });
onUnmounted(() => { importVersion += 1; });
const input = ref(props.initialTarget || "192.168.1.0/24");
const mask = ref("");
const name = ref("");
const note = ref("");
const gateway = ref("");
const vlan = ref("");
const dhcpStart = ref("");
const dhcpEnd = ref("");
const editingId = ref("");
const error = ref("");
const busy = ref(false);
const notice = ref("");
const selectedId = ref("");
const selected = computed(() =>
  props.networks.find((n) => n.id === selectedId.value),
);
const info = computed(() => {
  try {
    return { value: subnet(input.value, mask.value || undefined) };
  } catch (e) {
    return { error: e.message };
  }
});
const conflicts = computed(() =>
  info.value.value
    ? overlapNames(props.networks, info.value.value.cidr, editingId.value)
    : [],
);
const gatewaySuggestion = computed(() =>
  info.value.value ? suggestGateway(info.value.value.cidr) : "",
);
const gatewayError = computed(() => {
  if (!info.value.value) return "";
  try {
    validateGateway(gateway.value.trim(), info.value.value.cidr);
    return "";
  } catch (e) {
    return e.message;
  }
});
async function save() {
  error.value = "";
  notice.value = "";
  if (!info.value.value) {
    error.value = info.value.error;
    return;
  }
  if (!name.value.trim()) {
    error.value = "请为网段填写名称";
    return;
  }
  const previous = props.networks.find((n) => n.id === editingId.value);
  const record = {
    ...previous,
    id: editingId.value || crypto.randomUUID(),
    name: name.value.trim(),
    note: note.value,
    cidr: info.value.value.cidr,
    gateway: gateway.value.trim(),
    vlan: vlan.value === "" ? "" : Number(vlan.value),
    dhcpStart: dhcpStart.value.trim(),
    dhcpEnd: dhcpEnd.value.trim(),
    allocations: previous?.allocations || [],
  };
  const next = previous
    ? props.networks.map((n) => (n.id === record.id ? record : n))
    : [...props.networks, record];
  busy.value = true;
  try {
    validateNetworks(next);
    await props.saveNetworks(next);
    selectedId.value = record.id;
    editingId.value = record.id;
    notice.value = "网段规划已保存";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function edit(item) {
  input.value = item.cidr;
  mask.value = "";
  name.value = item.name;
  note.value = item.note;
  gateway.value = item.gateway ?? "";
  vlan.value = item.vlan ?? "";
  dhcpStart.value = item.dhcpStart || "";
  dhcpEnd.value = item.dhcpEnd || "";
  editingId.value = item.id;
  selectedId.value = item.id;
  notice.value = "";
  error.value = "";
}
function newNetwork() {
  editingId.value = "";
  name.value = "";
  note.value = "";
  gateway.value = "";
  vlan.value = "";
  dhcpStart.value = "";
  dhcpEnd.value = "";
  notice.value = "";
  error.value = "";
}
async function remove(item) {
  if (!window.confirm(`删除规划“${item.name}”及其分配记录？`)) return;
  try {
    await props.saveNetworks(props.networks.filter((n) => n.id !== item.id));
    if (editingId.value === item.id) newNetwork();
  } catch (e) {
    error.value = e.message;
  }
}
async function exportPlans() {
  try {
    await runtime.export(
      "net-tool-plans.json",
      JSON.stringify({ version: 1, networks: props.networks }, null, 2),
    );
  } catch (e) {
    error.value = e.message;
  }
}
async function importPlans() {
  const projectId = props.projectId;
  const version = importVersion;
  notice.value = "";
  error.value = "";
  try {
    const data = await runtime.import();
    // The file picker/read can outlive the project view that started it.
    if (importVersion !== version || props.projectId !== projectId) return;
    if (!data) return;
    if (data.version !== 1) throw new Error("不支持的规划文件版本");
    validateNetworks(data.networks);
    const additions = data.networks.filter(
      (n) => !props.networks.some((existing) => existing.id === n.id),
    );
    const next = [...props.networks, ...additions];
    validateNetworks(next);
    await props.saveNetworks(next, projectId);
    notice.value = `已合并 ${additions.length} 个网段，同标识记录保留现有配置`;
  } catch (e) {
    if (importVersion !== version || props.projectId !== projectId) return;
    error.value = e.message;
  }
}
</script>

<template>
  <section class="workspace-toolbar">
    <div><p>维护当前项目的网段、网关、VLAN 与设备地址分配；现场设备需另行配置。</p></div>
    <div class="actions">
      <button @click="emit('navigate', 'calculator', info.value?.cidr || input)">打开网段计算</button>
      <button @click="importPlans"><Upload :size="15" />导入 JSON 规划</button
      ><button @click="exportPlans">
        <Download :size="15" />导出 JSON 规划
      </button>
    </div>
  </section>
  <FeedbackBanner v-model="error" variant="error" />
  <FeedbackBanner v-model="notice" />
  <section class="panel">
    <div class="section-heading">
      <h2>{{ editingId ? "编辑网段" : "新建网段" }}</h2>
      <span class="muted">IPv4 / CIDR</span>
    </div>
    <div class="form-row">
      <label class="grow"
        >IP 地址或 CIDR<input
          v-model="input"
          aria-label="IP 地址或 CIDR"
          placeholder="192.168.1.0/24" /></label
      ><label
        >子网掩码（可选）<input
          v-model="mask"
          placeholder="255.255.255.0"
          aria-label="子网掩码" /></label
      ><button
        :disabled="!info.value"
        @click="emit('navigate', 'scan', info.value.cidr)"
      >
        <Radar :size="15" />探测此网段
      </button>
    </div>
    <div v-if="info.error" class="inline-error" role="alert">
      {{ info.error }}
    </div>
    <template v-else>
      <SubnetSummary :info="info.value" />
      <div class="network-details planner-details">
        <section class="network-detail" aria-labelledby="planner-gateway-label">
          <label id="planner-gateway-label" for="planner-gateway"
            >默认网关 <span class="muted">规划值 · 可选</span></label
          >
          <div class="gateway-controls">
            <input
              id="planner-gateway"
              v-model="gateway"
              class="mono"
              aria-label="默认网关"
              aria-describedby="planner-gateway-help planner-gateway-error"
              :aria-invalid="!!gatewayError"
              placeholder="未设置，请填写路由器地址"
              maxlength="15"
            />
            <button
              v-if="gatewaySuggestion"
              type="button"
              :title="'填入建议值 ' + gatewaySuggestion"
              @click="gateway = gatewaySuggestion"
            >
              使用首个可用地址
            </button>
          </div>
          <p id="planner-gateway-help" class="hint">
            {{
              gatewaySuggestion
                ? `常用规划建议：${gatewaySuggestion}；实际网关以路由器配置为准，并非探测结果。`
                : "当前网段不提供通用网关建议，可留空，或按实际路由配置填写。"
            }}
          </p>
          <p
            v-if="gatewayError"
            id="planner-gateway-error"
            class="inline-error"
            role="alert"
          >
            {{ gatewayError }}
          </p>
        </section>
      </div>
    </template>
    <div class="form-row section-divider">
      <label
        >VLAN（可选）<input
          v-model="vlan"
          aria-label="VLAN"
          type="number"
          min="1"
          max="4094"
      /></label>
      <label
        >DHCP 起始地址<input
          v-model="dhcpStart"
          aria-label="DHCP 起始地址"
          class="mono"
          placeholder="可选，与结束地址成对填写"
      /></label>
      <label
        >DHCP 结束地址<input
          v-model="dhcpEnd"
          aria-label="DHCP 结束地址"
          class="mono"
      /></label>
    </div>
    <div class="form-row section-divider">
      <label
        >网段名称<input
          v-model="name"
          aria-label="网段名称"
          placeholder="例如：办公网络"
          maxlength="100" /></label
      ><label class="grow"
        >用途 / 备注<input
          v-model="note"
          placeholder="设备类型、位置、VLAN…"
          maxlength="2000" /></label
      ><button class="primary" :disabled="busy || !info.value" @click="save">
        <Save :size="15" />{{ editingId ? "保存修改" : "保存网段" }}</button
      ><button v-if="editingId" @click="newNetwork">
        <Plus :size="15" />新建
      </button>
    </div>
    <p v-if="conflicts.length" class="warning">
      与 {{ conflicts.join("、") }} 地址重叠。父子网段可重叠，请确认规划用途。
    </p>
  </section>

  <section class="panel">
    <div class="section-heading">
      <h2>
        已保存网段 <span class="count">{{ networks.length }}</span>
      </h2>
      <span class="muted">分配记录独立于探测结果</span>
    </div>
    <div v-if="!networks.length" class="empty">
      <strong>还没有保存网段</strong>
      <p>填写网段名称并保存，即可维护设备地址分配。</p>
    </div>
    <div v-else class="table-wrap">
      <table class="network-table">
        <thead>
          <tr>
            <th>名称 / 用途</th>
            <th>网段</th>
            <th>已分配</th>
            <th class="operation-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="net in networks"
            :key="net.id"
            :class="{ selected: selectedId === net.id }"
          >
            <td>
              <button class="text-button" @click="selectedId = net.id">
                {{ net.name }}</button
              ><small class="block muted">{{ net.note || "—" }}</small>
              <small v-if="net.vlan !== '' && net.vlan != null" class="block muted">VLAN {{ net.vlan }}</small>
            </td>
            <td class="mono">
              {{ net.cidr
              }}<small class="block muted"
                >网关 {{ net.gateway || "未设置" }}</small
              >
              <small class="block muted">{{ net.dhcpStart ? `DHCP ${net.dhcpStart} ～ ${net.dhcpEnd}` : '未规划动态池' }}</small>
            </td>
            <td>{{ net.allocations.length }} 个</td>
            <td>
              <div class="actions">
                <button
                  title="探测网段"
                  @click="emit('navigate', 'scan', net.cidr)"
                >
                  <Radar :size="14" /></button
                ><button :aria-label="'编辑 ' + net.name" @click="edit(net)">
                  <Pencil :size="14" /></button
                ><button
                  class="danger"
                  :aria-label="'删除 ' + net.name"
                  @click="remove(net)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="selected" class="section-divider">
      <AllocationPanel
        :key="selected.id"
        :networks="networks"
        :fixed-network="selected.id"
        :save-networks="saveNetworks"
        @navigate="(kind, target) => emit('navigate', kind, target)"
      />
    </div>
  </section>
</template>

<style scoped>
.planner-details { grid-template-columns: minmax(0, 1fr); }
.gateway-controls { max-width: 620px; }
.network-table { table-layout: fixed; }
.network-table th:first-child { width: 26%; }
.network-table th:nth-child(3) { width: 5rem; }
.network-table .operation-col { width: 116px; min-width: 116px; }
.network-table td { height: auto; }
.network-table td small { overflow-wrap: anywhere; }
.network-table .text-button { max-width: 100%; overflow-wrap: anywhere; }
</style>
