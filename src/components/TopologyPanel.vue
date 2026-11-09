<script setup>
import { computed, ref } from "vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import {
  registeredTopology,
  vlanConfigurationReport,
  topologyAcceptanceItem,
} from "../domain/topology.js";
const props = defineProps({
  project: Object,
  networks: Array,
  saveProject: Function,
});
const emit = defineEmits(["record", "inventory", "acceptance"]);
const locationId = ref("");
const devicePage = ref(0);
const interfacePage = ref(0);
const linkPage = ref(0);
const issuePage = ref(0);
const busy = ref(false);
const error = ref("");
const RECORDS_PER_PAGE = 50;
const graph = computed(() =>
  registeredTopology(props.project, {
    locationId: locationId.value,
    page: devicePage.value,
  }),
);
const inventory = computed(
  () =>
    props.project.engineering?.infrastructure ?? {
      devices: [],
      interfaces: [],
      links: [],
    },
);
const report = computed(() =>
  vlanConfigurationReport(props.project, props.networks),
);
const visibleDeviceInterfaces = computed(() =>
  inventory.value.interfaces.filter((p) =>
    graph.value.nodes.some((d) => d.id === p.deviceId),
  ),
);
const locationById = computed(
  () =>
    new Map(
      (props.project.engineering?.locations ?? []).map((location) => [
        location.id,
        location,
      ]),
    ),
);
const deviceById = computed(
  () => new Map(inventory.value.devices.map((device) => [device.id, device])),
);
const interfaceById = computed(
  () => new Map(inventory.value.interfaces.map((port) => [port.id, port])),
);
const nodeById = computed(
  () => new Map(graph.value.nodes.map((node) => [node.id, node])),
);
const visibleInterfaces = computed(() =>
  visibleDeviceInterfaces.value.slice(
    interfacePage.value * RECORDS_PER_PAGE,
    (interfacePage.value + 1) * RECORDS_PER_PAGE,
  ),
);
const visibleLinks = computed(() =>
  graph.value.allLinks.slice(
    linkPage.value * RECORDS_PER_PAGE,
    (linkPage.value + 1) * RECORDS_PER_PAGE,
  ),
);
const visibleIssues = computed(() =>
  report.value.issues.slice(
    issuePage.value * RECORDS_PER_PAGE,
    (issuePage.value + 1) * RECORDS_PER_PAGE,
  ),
);
const reportStatusLabel = computed(() => {
  if (report.value.status === "risk") return "存在配置风险";
  if (report.value.status === "pending") return "资料待补充";
  return "登记参数一致";
});
function locationLabel(id) {
  const location = locationById.value.get(id);
  if (!location) return "—";
  const parent = location.parentId
    ? locationLabel(location.parentId) + " / "
    : "";
  return parent + location.name;
}
function deviceLabel(id) {
  return deviceById.value.get(id)?.name ?? "—";
}
function interfaceLabel(id) {
  const port = interfaceById.value.get(id);
  return port ? deviceLabel(port.deviceId) + " / " + port.name : "—";
}
function nodePosition(id) {
  return nodeById.value.get(id);
}
function resetFilteredPages() {
  devicePage.value = 0;
  interfacePage.value = 0;
  linkPage.value = 0;
}
function changeDevicePage(step) {
  devicePage.value += step;
  interfacePage.value = 0;
}
async function createAcceptanceCheck(finding) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const projectId = props.project.id;
  try {
    const next = topologyAcceptanceItem(
      JSON.parse(JSON.stringify(props.project)),
      finding,
      props.networks,
    );
    if (props.project.id !== projectId)
      throw Error("项目已切换，请重新建立检查");
    // Persist against the captured project; never navigate another project on completion.
    await props.saveProject(next);
    if (props.project.id === projectId) emit("acceptance");
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="topology-panel">
    <div class="section-heading">
      <div>
        <h2>工程拓扑与 VLAN 配置</h2>
        <p class="hint">{{ report.basis }}</p>
      </div>
      <button @click="emit('inventory')">设备与连接清单</button>
    </div>
    <FeedbackBanner v-model="error" variant="error" />
    <p v-if="!inventory.devices.length" class="empty">
      尚未登记设备；请先建立场地区域、设备和接口。
    </p>
    <label class="topology-filter"
      >拓扑位置<select
        v-model="locationId"
        aria-label="拓扑位置"
        @change="resetFilteredPages"
      >
        <option value="">全部位置</option>
        <option
          v-for="l in project.engineering?.locations ?? []"
          :key="l.id"
          :value="l.id"
        >
          {{ locationLabel(l.id) }}
        </option>
      </select></label
    >
    <p class="hint">
      显示所选位置及子级，保留直接相连的边界设备。图中每页最多40设备，页外连线在下方清单查看；连线表示登记，未探测网络。
    </p>
    <div v-if="graph.total" class="topology-graph" aria-label="已登记工程拓扑">
      <svg
        :viewBox="`0 0 940 ${Math.ceil(graph.nodes.length / 4) * 120 + 30}`"
        role="group"
        aria-label="设备与连接图"
      >
        <g
          v-for="l in graph.links"
          :key="l.id"
          role="button"
          tabindex="0"
          :aria-label="'拓扑连接 ' + l.id"
          @click="emit('record', 'link', l.id)"
          @keydown.enter.prevent="emit('record', 'link', l.id)"
          @keydown.space.prevent="emit('record', 'link', l.id)"
        >
          <title>
            {{ interfaceLabel(l.fromInterfaceId) }} —
            {{ interfaceLabel(l.toInterfaceId) }}
          </title>
          <line
            :x1="nodePosition(l.fromDeviceId).x + 90"
            :y1="nodePosition(l.fromDeviceId).y + 35"
            :x2="nodePosition(l.toDeviceId).x + 90"
            :y2="nodePosition(l.toDeviceId).y + 35"
          />
        </g>
        <g
          v-for="d in graph.nodes"
          :key="d.id"
          class="topology-node"
          role="button"
          tabindex="0"
          :aria-label="'拓扑设备 ' + d.name"
          @click="emit('record', 'device', d.id)"
          @keydown.enter.prevent="emit('record', 'device', d.id)"
          @keydown.space.prevent="emit('record', 'device', d.id)"
        >
          <title>{{ d.name }} · {{ locationLabel(d.locationId) }}</title>
          <rect
            :x="d.x"
            :y="d.y"
            width="190"
            height="76"
            rx="8"
            :class="{ boundary: d.boundary }"
          />
          <text :x="d.x + 10" :y="d.y + 28">{{ d.name.slice(0, 20) }}</text>
          <text :x="d.x + 10" :y="d.y + 54" class="topology-location">
            {{ d.boundary ? "边界 · " : ""
            }}{{ locationLabel(d.locationId).slice(-22) }}
          </text>
        </g>
      </svg>
    </div>
    <div class="actions">
      <span
        >{{ graph.total }} 个设备 · 第 {{ graph.page + 1 }} /
        {{ graph.pages || 1 }} 页</span
      ><button :disabled="!graph.page" @click="changeDevicePage(-1)">
        上一页设备</button
      ><button
        :disabled="graph.page + 1 >= graph.pages"
        @click="changeDevicePage(1)"
      >
        下一页设备
      </button>
    </div>
    <h3>图中设备的接口</h3>
    <div class="topology-records">
      <button
        v-for="p in visibleInterfaces"
        :key="p.id"
        :aria-label="'拓扑接口 ' + p.name"
        @click="emit('record', 'interface', p.id)"
      >
        {{ deviceLabel(p.deviceId) }} / {{ p.name }} ·
        {{ p.logicalConfig?.mode ?? "逻辑配置待补充" }}
      </button>
    </div>
    <div
      v-if="visibleDeviceInterfaces.length > RECORDS_PER_PAGE"
      class="actions"
    >
      <button :disabled="!interfacePage" @click="interfacePage--">
        上一页接口</button
      ><span
        >{{ interfacePage + 1 }} /
        {{ Math.ceil(visibleDeviceInterfaces.length / RECORDS_PER_PAGE) }}</span
      ><button
        :disabled="
          (interfacePage + 1) * RECORDS_PER_PAGE >=
          visibleDeviceInterfaces.length
        "
        @click="interfacePage++"
      >
        下一页接口
      </button>
    </div>
    <h3>所选位置的连接清单（{{ graph.allLinks.length }}）</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>起点</th>
            <th>终点</th>
            <th>原记录</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in visibleLinks" :key="l.id">
            <td>{{ interfaceLabel(l.fromInterfaceId) }}</td>
            <td>{{ interfaceLabel(l.toInterfaceId) }}</td>
            <td>
              <button @click="emit('record', 'link', l.id)">
                编辑连接 {{ l.id }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="graph.allLinks.length > RECORDS_PER_PAGE" class="actions">
      <button :disabled="!linkPage" @click="linkPage--">上一页连接</button
      ><span
        >{{ linkPage + 1 }} /
        {{ Math.ceil(graph.allLinks.length / RECORDS_PER_PAGE) }}</span
      ><button
        :disabled="(linkPage + 1) * RECORDS_PER_PAGE >= graph.allLinks.length"
        @click="linkPage++"
      >
        下一页连接
      </button>
    </div>
    <h3>本项目 VLAN 配置校核</h3>
    <p>
      {{ reportStatusLabel }}
      ·
      {{ report.issues.length }}
      项问题。校核覆盖本项目全部登记接口，不受图中位置筛选影响。
    </p>
    <p class="hint">
      每段连接仅检查两端声明的业务；请在路径涉及接口关联业务网段。Access/Trunk与“业务接入/上联”接口角色分别维护。建立验收检查后，仍需人工登记结果、整改和复验。
    </p>
    <div v-if="report.issues.length" class="table-wrap topology-findings">
      <table>
        <thead>
          <tr>
            <th>设备 / 接口</th>
            <th>状态 / 问题</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(finding, index) in visibleIssues" :key="index">
            <td>{{ interfaceLabel(finding.interfaceId) }}</td>
            <td>
              {{ finding.severity === "risk" ? "配置风险" : "待补充" }} ·
              {{ finding.message }}
            </td>
            <td v-if="finding.interfaceId">
              <button @click="emit('record', 'interface', finding.interfaceId)">
                编辑接口</button
              ><button :disabled="busy" @click="createAcceptanceCheck(finding)">
                建立验收检查
              </button>
            </td>
            <td v-else>先登记设备和接口</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="report.issues.length > RECORDS_PER_PAGE" class="actions">
      <button :disabled="!issuePage" @click="issuePage--">上一页问题</button
      ><span
        >{{ issuePage + 1 }} /
        {{ Math.ceil(report.issues.length / RECORDS_PER_PAGE) }}</span
      ><button
        :disabled="(issuePage + 1) * RECORDS_PER_PAGE >= report.issues.length"
        @click="issuePage++"
      >
        下一页问题
      </button>
    </div>
  </div>
</template>
<style scoped>
.topology-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.topology-filter {
  display: grid;
  gap: 6px;
  max-width: 500px;
}
.topology-graph {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-control);
}
svg {
  display: block;
  width: 100%;
  min-width: 940px;
}
svg line {
  stroke: var(--accent);
  stroke-width: 5;
}
svg g[role="button"] {
  cursor: pointer;
}
svg g:focus {
  outline: 2px solid var(--accent);
}
svg rect {
  fill: var(--surface);
  stroke: var(--border);
  stroke-width: 2;
}
svg rect.boundary {
  stroke-dasharray: 5 3;
}
svg text {
  fill: var(--text);
  font-size: 13px;
  pointer-events: none;
}
.topology-location {
  font-size: 11px;
  fill: var(--muted);
}
.topology-records {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.table-wrap {
  max-height: 420px;
  overflow: auto;
}
td {
  overflow-wrap: anywhere;
}
td button {
  margin: 3px;
}
h3 {
  margin: 0;
}
:global(.large-font) svg text {
  font-size: 15px;
}
:global(.large-font) .topology-location {
  font-size: 12px;
}
</style>
