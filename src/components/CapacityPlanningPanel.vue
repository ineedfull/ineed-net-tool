<script setup>
import { computed, ref } from "vue";
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import {
  emptyEngineering,
  validateEngineering,
} from "../domain/engineering.js";
import { emptyInfrastructure } from "../domain/infrastructure.js";
import {
  emptyCapacityPlanning,
  capacityPlanningReport,
} from "../domain/capacity-planning.js";
const props = defineProps({
  project: Object,
  networks: Array,
  saveProject: Function,
});
const emit = defineEmits(["inventory"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const engineering = computed(
  () => props.project.engineering || emptyEngineering(),
);
const inventory = computed(
  () => engineering.value.infrastructure || emptyInfrastructure(),
);
const plan = computed(
  () => inventory.value.capacityPlanning || emptyCapacityPlanning(),
);
const report = computed(() =>
  capacityPlanningReport(props.project, props.networks),
);
const kinds = {
  powerBudgets: "整机预算",
  poeLoads: "PoE负载",
  uplinks: "上联",
  trafficDemands: "业务项",
};
// Fields describe inputs only. All estimates and comparisons come from the domain report.
const fields = {
  powerBudgets: [
    ["budgetWatts", "整机预算 W", 1000000, false],
    ["reservePercent", "整机预留 %", 100, true],
  ],
  poeLoads: [
    ["portBudgetWatts", "单口供电预算 W", 1000, false],
    ["deviceWatts", "设备端功耗 W", 1000, false],
    ["lossPercent", "损耗预留 %", 100, true],
  ],
  uplinks: [
    ["fromMbps", "起点速率 Mbps", 1000000, false],
    ["toMbps", "终点速率 Mbps", 1000000, false],
    ["reservePercent", "带宽预留 %", 100, true],
  ],
  trafficDemands: [
    ["count", "当前数量", 100000, true],
    ["mbpsPerUnit", "单设备 Mbps", 10000, false],
    ["concurrencyPercent", "并发 %", 100, true],
    ["growthPercent", "增长 %", 1000, true],
  ],
};
const kind = ref(""),
  draft = ref({}),
  busy = ref(false),
  error = ref(""),
  removing = ref(false),
  form = ref(null);
const existing = computed(
  () =>
    kind.value && plan.value[kind.value].some((r) => r.id === draft.value.id),
);
const title = computed(
  () =>
    (removing.value ? "删除" : existing.value ? "编辑" : "添加") +
    kinds[kind.value],
);
const selectedLink = computed(() =>
  inventory.value.links.find((l) => l.id === draft.value.linkId),
);
const selectedUplink = computed(() =>
  plan.value.uplinks.find((u) => u.id === draft.value.uplinkId),
);
function location(id) {
  const l = engineering.value.locations.find((l) => l.id === id);
  return l
    ? (l.parentId ? location(l.parentId) + " / " : "") + l.name
    : "未登记区域";
}
function device(id) {
  const d = inventory.value.devices.find((d) => d.id === id);
  return d ? d.name + " · " + location(d.locationId) : "—";
}
function endpoint(id) {
  const p = inventory.value.interfaces.find((p) => p.id === id);
  return p ? device(p.deviceId) + " / " + p.name : "—";
}
function connection(l) {
  return l
    ? endpoint(l.fromInterfaceId) + " → " + endpoint(l.toInterfaceId)
    : "—";
}
function direction(u, d) {
  return u
    ? d === "forward"
      ? endpoint(u.fromInterfaceId) + " → " + endpoint(u.toInterfaceId)
      : endpoint(u.toInterfaceId) + " → " + endpoint(u.fromInterfaceId)
    : "请先选择上联";
}
function associate() {
  const l = selectedLink.value;
  if (!l) return;
  if (kind.value === "poeLoads") {
    draft.value.sourceInterfaceId = l.fromInterfaceId;
    draft.value.targetInterfaceId = l.toInterfaceId;
  } else {
    draft.value.fromInterfaceId = l.fromInterfaceId;
    draft.value.toInterfaceId = l.toInterfaceId;
  }
}
function orient() {
  const l = selectedLink.value;
  if (l)
    draft.value.targetInterfaceId =
      draft.value.sourceInterfaceId === l.fromInterfaceId
        ? l.toInterfaceId
        : l.fromInterfaceId;
}
function open(key, row) {
  if (busy.value) return;
  kind.value = key;
  error.value = "";
  removing.value = false;
  const defaults = {
    powerBudgets: {
      deviceId: inventory.value.devices[0]?.id || "",
      budgetWatts: null,
      reservePercent: 20,
    },
    poeLoads: {
      linkId: inventory.value.links[0]?.id || "",
      sourceInterfaceId: "",
      targetInterfaceId: "",
      portBudgetWatts: null,
      deviceWatts: null,
      lossPercent: 20,
    },
    uplinks: {
      linkId: inventory.value.links[0]?.id || "",
      fromInterfaceId: "",
      toInterfaceId: "",
      fromMbps: null,
      toMbps: null,
      reservePercent: 20,
    },
    trafficDemands: {
      uplinkId: plan.value.uplinks[0]?.id || "",
      name: "",
      direction: "forward",
      count: null,
      mbpsPerUnit: null,
      concurrencyPercent: 100,
      growthPercent: 20,
    },
  };
  draft.value = clone(
    row || { id: crypto.randomUUID(), ...defaults[key], note: "" },
  );
  if (!row && ["poeLoads", "uplinks"].includes(key)) associate();
}
function numberInput(field, event) {
  draft.value[field] =
    event.target.value === "" ? null : Number(event.target.value);
}
async function save() {
  if (busy.value) return;
  form.value?.focus();
  busy.value = true;
  error.value = "";
  const owner = props.project.id;
  try {
    const project = clone(props.project),
      next = clone(engineering.value);
    next.infrastructure ||= emptyInfrastructure();
    next.infrastructure.capacityPlanning ||= emptyCapacityPlanning();
    const rows = next.infrastructure.capacityPlanning[kind.value],
      row = clone(draft.value);
    if (removing.value)
      next.infrastructure.capacityPlanning[kind.value] = rows.filter(
        (r) => r.id !== row.id,
      );
    else {
      if ("name" in row) row.name = row.name.trim();
      const i = rows.findIndex((r) => r.id === row.id);
      if (i < 0) rows.push(row);
      else rows[i] = row;
    }
    validateEngineering(next, props.networks);
    if (props.project.id !== owner) throw Error("项目已切换，请重新编辑。");
    await props.saveProject({ ...project, engineering: next });
    if (props.project.id === owner) kind.value = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const status = (s) =>
  ({ ok: "按已登记参数估算满足", pending: "待补充", risk: "已登记参数不足" })[
    s
  ];
const value = (v, unit = "") =>
  v == null ? "待补充" : v + (unit ? " " + unit : "");
const sections = computed(() => [
  {
    key: "powerBudgets",
    title: "整机电源预算",
    headers: [
      "设备 / 区域",
      "输入依据",
      "已知需求 / 未知负载",
      "可规划预算 / 余量",
      "状态 / 操作",
    ],
    rows: report.value.powerBudgets.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      label: device(r.deviceId),
      cells: [
        device(r.deviceId),
        `预算 ${value(r.budgetWatts, "W")}；预留 ${value(r.reservePercent, "%")}`,
        `${value(r.knownWatts, "W")} / ${r.unknownCount}；负载 ${r.loadCount}`,
        `${value(r.usableWatts, "W")} / ${value(r.remainingWatts, "W")}`,
      ],
    })),
  },
  {
    key: "poeLoads",
    title: "PoE逐连接负载",
    headers: [
      "供电端 → 受电端",
      "输入依据",
      "供电端需求",
      "单口余量",
      "状态 / 操作",
    ],
    rows: report.value.poeLoads.map((r) => ({
      id: r.id,
      label: endpoint(r.sourceInterfaceId),
      cells: [
        endpoint(r.sourceInterfaceId) + " → " + endpoint(r.targetInterfaceId),
        `设备端 ${value(r.deviceWatts, "W")}；损耗 ${value(r.lossPercent, "%")}；单口 ${value(r.portBudgetWatts, "W")}`,
        value(r.requiredWatts, "W"),
        value(r.remainingWatts, "W"),
      ],
    })),
  },
  {
    key: "uplinks",
    title: "上联全双工方向校核",
    headers: [
      "上联 / 真实方向",
      "输入依据",
      "已知需求 / 未知业务",
      "可规划带宽 / 余量",
      "状态 / 操作",
    ],
    rows: report.value.uplinks.flatMap((r) =>
      ["forward", "reverse"].map((d) => ({
        id: r.id,
        direction: d,
        label: connection(r),
        cells: [
          direction(r, d),
          `起点 ${value(r.fromMbps, "Mbps")}；终点 ${value(r.toMbps, "Mbps")}；预留 ${r.reservePercent}%；已知端点上界 ${value(r.knownUpperBoundMbps, "Mbps")}`,
          `${value(r[d].knownMbps, "Mbps")} / ${r[d].unknownCount}；${r[d].demandCount ? r[d].demandCount + " 条业务" : "无业务项"}`,
          `${value(r.usableMbps, "Mbps")} / ${value(r[d].remainingMbps, "Mbps")}`,
        ],
      })),
    ),
  },
  {
    key: "trafficDemands",
    title: "上联业务估算",
    headers: [
      "业务 / 真实方向",
      "输入依据",
      "规划数量",
      "业务估算",
      "状态 / 操作",
    ],
    rows: report.value.trafficDemands.map((r) => ({
      id: r.id,
      label: r.name,
      cells: [
        r.name +
          " · " +
          direction(
            plan.value.uplinks.find((u) => u.id === r.uplinkId),
            r.direction,
          ),
        `数量 ${value(r.count)}；单设备 ${value(r.mbpsPerUnit, "Mbps")}；并发 ${value(r.concurrencyPercent, "%")}；增长 ${r.growthPercent}%`,
        value(r.plannedCount),
        value(r.requiredMbps, "Mbps"),
      ],
    })),
  },
]);
function result(section, row) {
  const r = report.value[section.key].find((r) =>
    row.id === null ? r.deviceId === row.deviceId : r.id === row.id,
  );
  return row.direction ? r[row.direction] : r;
}
</script>
<template>
  <div class="capacity-planning-panel">
    <div class="section-heading">
      <div>
        <h2>PoE与带宽</h2>
        <p class="hint">
          登记参数与估算结果分开维护；未知值显示待补充，明确零值保留为 0。
        </p>
      </div>
      <div class="actions">
        <button @click="emit('inventory')">前往设备与连接</button
        ><button
          v-for="(label, key) in kinds"
          :key="key"
          :disabled="
            busy ||
            (key === 'powerBudgets'
              ? !inventory.devices.length
              : key === 'trafficDemands'
                ? !plan.uplinks.length
                : !inventory.links.length)
          "
          @click="open(key)"
        >
          添加{{ label }}
        </button>
      </div>
    </div>
    <div v-if="!report.enabled" class="empty">
      <strong>尚未启用 PoE 与带宽校核</strong>
      <p>先登记设备、接口与连接，再添加校核参数。旧项目不会自动增加计划。</p>
    </div>
    <p class="hint">{{ report.basis }}</p>
    <p v-if="report.enabled" class="capacity-summary">
      <strong>{{ status(report.status) }}</strong> ·
      {{ report.issues.length }} 项问题
    </p>
    <details class="capacity-assumptions">
      <summary>公式、单位与估算边界</summary>
      <p>
        供电端需求 W = 向上取整到 0.001 W（设备端功耗 × (100 + 损耗预留%) /
        100）；单口余量 = 单口供电预算 − 供电端需求。整机可规划预算 W =
        向下取整到 0.001 W（整机预算 × (100 − 整机预留%) /
        100）；整机已知需求逐负载求和。
      </p>
      <p>
        可规划带宽 Mbps = 向下取整到 0.001 Mbps（两端速率较小值 × (100 − 预留%)
        / 100）。规划数量 = 当前数量 + ceil(当前数量 × 增长% / 100)；业务估算
        Mbps = 向上取整到 0.001 Mbps（规划数量 × 单设备 Mbps × 并发% /
        100）。每方向余量 = 可规划带宽 − 该方向逐业务估算之和。
      </p>
      <p>
        全双工两个方向独立；不加总多链路、主备或
        LAG，不自动推导路由。默认预留与增长均为估算输入，非实测；不认证 PoE
        标准匹配、线缆、环境或现场验收。缺项保留已知小计及已确定不足。
      </p>
    </details>
    <section
      v-for="section in sections"
      :key="section.key"
      :class="'capacity-' + section.key"
    >
      <h3>{{ section.title }}</h3>
      <p v-if="!section.rows.length" class="hint">暂无登记</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="h in section.headers" :key="h">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in section.rows"
              :key="(row.id ?? row.deviceId) + '-' + (row.direction || '')"
            >
              <td v-for="(cell, i) in row.cells" :key="i">{{ cell }}</td>
              <td>
                <strong>{{ status(result(section, row).status) }}</strong>
                <ul v-if="result(section, row).issues.length">
                  <li
                    v-for="(issue, i) in result(section, row).issues"
                    :key="i"
                  >
                    {{ issue.message }}
                  </li>
                </ul>
                <p v-if="plan[section.key].find((r) => r.id === row.id)?.note">
                  {{ plan[section.key].find((r) => r.id === row.id).note }}
                </p>
                <button
                  v-if="row.id"
                  :aria-label="'编辑' + kinds[section.key] + ' ' + row.label"
                  @click="
                    open(
                      section.key,
                      plan[section.key].find((r) => r.id === row.id),
                    )
                  "
                >
                  编辑</button
                ><button
                  v-else
                  @click="
                    open('powerBudgets');
                    draft.deviceId = row.deviceId;
                  "
                >
                  添加整机预算
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <ul v-if="report.issues.length" class="capacity-issues hint">
      <li v-for="(issue, i) in report.issues" :key="i">
        {{ status(issue.severity) }}：{{ issue.message }}
      </li>
    </ul>
    <DesktopDialog
      v-if="kind"
      :title="title"
      title-id="capacity-dialog-title"
      :busy="busy"
      @close="kind = ''"
    >
      <form
        ref="form"
        tabindex="-1"
        class="capacity-form"
        @submit.prevent="save"
      >
        <div class="dialog-body">
          <FeedbackBanner v-model="error" variant="error" />
          <p v-if="removing">
            确认删除{{
              kinds[kind]
            }}？不会级联删除。删除上联前须先处理其业务引用；设备、接口与连接引用需先在本页解除。
          </p>
          <div v-else class="field-grid">
            <label v-if="kind === 'powerBudgets'" class="full"
              >预算设备<select
                aria-label="预算设备"
                v-model="draft.deviceId"
                required
              >
                <option
                  v-for="d in inventory.devices"
                  :key="d.id"
                  :value="d.id"
                >
                  {{ device(d.id) }}
                </option>
              </select></label
            >
            <p v-if="kind === 'powerBudgets'" class="hint full">
              当前设备：{{ device(draft.deviceId) }}
            </p>
            <template v-if="kind === 'poeLoads' || kind === 'uplinks'"
              ><label class="full"
                >关联连接<select
                  aria-label="关联连接"
                  v-model="draft.linkId"
                  required
                  @change="associate"
                >
                  <option
                    v-for="l in inventory.links"
                    :key="l.id"
                    :value="l.id"
                  >
                    {{ connection(l) }}
                  </option>
                </select></label
              >
              <template v-if="kind === 'poeLoads'"
                ><label class="full"
                  >供电接口<select
                    aria-label="供电接口"
                    v-model="draft.sourceInterfaceId"
                    required
                    @change="orient"
                  >
                    <option
                      v-for="id in selectedLink
                        ? [
                            selectedLink.fromInterfaceId,
                            selectedLink.toInterfaceId,
                          ]
                        : []"
                      :key="id"
                      :value="id"
                    >
                      {{ endpoint(id) }}
                    </option>
                  </select></label
                >
                <p class="hint full">
                  供电接口：{{ endpoint(draft.sourceInterfaceId)
                  }}<br />受电接口：{{ endpoint(draft.targetInterfaceId) }}
                </p></template
              >
              <p v-else class="hint full">
                起点：{{ endpoint(draft.fromInterfaceId) }}<br />终点：{{
                  endpoint(draft.toInterfaceId)
                }}（随关联连接保存快照）
              </p>
            </template>
            <template v-if="kind === 'trafficDemands'"
              ><label class="full"
                >关联上联<select
                  aria-label="关联上联"
                  v-model="draft.uplinkId"
                  required
                >
                  <option v-for="u in plan.uplinks" :key="u.id" :value="u.id">
                    {{ connection(u) }}
                  </option>
                </select></label
              ><label class="full"
                >业务名称<input
                  v-model="draft.name"
                  required
                  maxlength="100" /></label
              ><label class="full"
                >业务方向<select
                  aria-label="业务方向"
                  v-model="draft.direction"
                >
                  <option value="forward">
                    正向：{{ direction(selectedUplink, "forward") }}
                  </option>
                  <option value="reverse">
                    反向：{{ direction(selectedUplink, "reverse") }}
                  </option>
                </select></label
              >
              <p class="hint full">
                当前方向：{{ direction(selectedUplink, draft.direction) }}
              </p></template
            >
            <label
              v-for="[field, label, max, integer] in fields[kind]"
              :key="field"
              >{{ label
              }}<input
                type="number"
                :value="draft[field] ?? ''"
                :required="
                  field === 'reservePercent' || field === 'growthPercent'
                "
                min="0"
                :max="max"
                :step="integer ? 1 : 0.001"
                @input="numberInput(field, $event)"
            /></label>
            <p class="hint full">
              留空表示待补充，0
              表示明确为零。新建默认：预算预留20%、损耗预留20%、并发100%、增长20%；可按实际登记修改，不代表实测。
            </p>
            <label class="full"
              >备注<textarea v-model="draft.note" rows="2" maxlength="1000" />
            </label>
          </div>
        </div>
        <footer class="dialog-footer">
          <button
            v-if="existing && !removing"
            type="button"
            :disabled="busy"
            @click="
              removing = true;
              error = '';
            "
          >
            删除{{ kinds[kind] }}</button
          ><button type="button" :disabled="busy" @click="kind = ''">
            取消</button
          ><button class="primary" :disabled="busy">
            {{
              busy ? "保存中…" : removing ? "确认删除" : "保存" + kinds[kind]
            }}
          </button>
        </footer>
      </form>
    </DesktopDialog>
  </div>
</template>
<style scoped>
.capacity-planning-panel {
  min-width: 0;
}
.capacity-planning-panel h3 {
  margin-top: 1.5rem;
}
.capacity-planning-panel table {
  min-width: 760px;
}
.capacity-planning-panel td {
  min-width: 120px;
  overflow-wrap: anywhere;
}
.capacity-planning-panel td:first-child {
  min-width: 200px;
}
.capacity-planning-panel ul {
  padding-left: 1.2rem;
}
.capacity-form .full {
  min-width: 0;
  overflow-wrap: anywhere;
}
.capacity-form select {
  max-width: 100%;
}
.capacity-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.capacity-assumptions {
  margin-block: 1rem;
}
.capacity-assumptions summary {
  cursor: pointer;
}
</style>
