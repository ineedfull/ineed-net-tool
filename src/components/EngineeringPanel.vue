<script setup>
import { computed, ref } from "vue";
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import EngineeringReport from "./EngineeringReport.vue";
import {
  emptyEngineering,
  engineeringReport,
  validateEngineering,
  LOCATION_KINDS,
  DEMAND_KINDS,
  ADDRESS_MODES,
  DEMAND_DEFAULTS,
} from "../domain/engineering.js";
const props = defineProps({
  project: Object,
  networks: Array,
  saveProject: Function,
});
const emit = defineEmits(["planning"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const engineering = computed(
  () => props.project.engineering || emptyEngineering(),
);
const report = computed(() => engineeringReport(props.project, props.networks));
const areas = computed(() =>
  engineering.value.locations.filter((l) => l.kind === "area"),
);
const dialog = ref(""),
  draft = ref({}),
  busy = ref(false),
  error = ref(""),
  remove = ref(false);
const keys = {
  location: "locations",
  demand: "demands",
  capacity: "capacities",
};
const titles = { location: "位置", demand: "需求", capacity: "接入容量" };
function locationPath(id) {
  const row = engineering.value.locations.find((l) => l.id === id);
  return row
    ? (row.parentId ? locationPath(row.parentId) + " / " : "") + row.name
    : "—";
}
const parents = computed(() =>
  engineering.value.locations.filter(
    (l) =>
      l.id !== draft.value.id &&
      (draft.value.kind === "floor"
        ? l.kind === "building"
        : draft.value.kind === "area"
          ? ["building", "floor"].includes(l.kind)
          : false),
  ),
);
function open(kind, row, locationId = "") {
  if (row) row = engineering.value[keys[kind]].find((r) => r.id === row.id);
  error.value = "";
  remove.value = false;
  dialog.value = kind;
  draft.value = clone(
    row ||
      {
        location: {
          id: crypto.randomUUID(),
          parentId: "",
          kind: "area",
          name: "",
          note: "",
        },
        demand: {
          id: crypto.randomUUID(),
          locationId: locationId || areas.value[0]?.id || "",
          name: "",
          kind: "wired",
          ...DEMAND_DEFAULTS.wired,
          networkId: "",
          note: "",
        },
        capacity: {
          id: crypto.randomUUID(),
          locationId,
          accessPorts: null,
          note: "",
        },
      }[kind],
  );
}
function capacity(id) {
  open(
    "capacity",
    engineering.value.capacities.find((c) => c.locationId === id),
    id,
  );
}
function applyTypeDefaults() {
  const { addressesPerUnit, portsPerUnit, addressMode } =
    DEMAND_DEFAULTS[draft.value.kind];
  Object.assign(draft.value, { addressesPerUnit, portsPerUnit, addressMode });
}
function changeKind() {
  if (!engineering.value.demands.some((d) => d.id === draft.value.id))
    applyTypeDefaults();
}
function issueAction(issue) {
  if (issue.demandId)
    open(
      "demand",
      engineering.value.demands.find((d) => d.id === issue.demandId),
    );
  else if (issue.networkId) emit("planning", issue.networkId);
  else if (issue.locationId) {
    if (issue.code === "area_demands_missing")
      open("demand", null, issue.locationId);
    else if (issue.code === "port_demand_incomplete") {
      const unknown = engineering.value.demands.find(
        (d) => d.locationId === issue.locationId && d.count === null,
      );
      if (unknown) open("demand", unknown);
      else capacity(issue.locationId);
    } else capacity(issue.locationId);
  } else open(areas.value.length ? "demand" : "location");
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const projectId = props.project.id;
  try {
    const next = clone(engineering.value),
      key = keys[dialog.value],
      row = clone(draft.value);
    if (
      remove.value &&
      dialog.value === "location" &&
      (next.locations.some((l) => l.parentId === row.id) ||
        next.demands.some((d) => d.locationId === row.id) ||
        next.capacities.some((c) => c.locationId === row.id))
    )
      throw Error("位置仍被引用，请先删除下级位置、需求和接入容量。");
    if (remove.value) next[key] = next[key].filter((r) => r.id !== row.id);
    else {
      for (const name of ["count", "accessPorts"])
        if (name in row)
          row[name] =
            row[name] === "" || row[name] === null ? null : Number(row[name]);
      for (const name of ["growthPercent", "addressesPerUnit", "portsPerUnit"])
        if (name in row) row[name] = Number(row[name]);
      if ("name" in row) row.name = row.name.trim();
      const i = next[key].findIndex((r) => r.id === row.id);
      if (i < 0) next[key].push(row);
      else next[key][i] = row;
    }
    validateEngineering(next, props.networks);
    if (props.project.id !== projectId) throw Error("项目已切换，请重新编辑。");
    await props.saveProject({ ...clone(props.project), engineering: next });
    dialog.value = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="engineering-panel">
    <div class="section-heading">
      <div>
        <h2>场地与需求</h2>
        <p class="hint">工程目标规模与容量依据；探测结果与地址登记仅作参考。</p>
      </div>
      <div class="actions">
        <button @click="open('location')">添加位置</button
        ><button class="primary" @click="open('demand')">添加需求</button>
      </div>
    </div>
    <div v-if="!engineering.locations.length" class="empty">
      <strong>从现场位置与业务需求开始</strong>
      <p>添加区域，或先建立楼栋和楼层；按现场填写数量与可用端口。</p>
    </div>
    <div v-else class="table-wrap engineering-locations">
      <table>
        <thead>
          <tr>
            <th>位置路径</th>
            <th>类型</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in engineering.locations" :key="l.id">
            <td>{{ locationPath(l.id) }}</td>
            <td>{{ LOCATION_KINDS[l.kind] }}</td>
            <td>{{ l.note || "—" }}</td>
            <td class="actions">
              <button
                :aria-label="'编辑位置 ' + l.name"
                @click="open('location', l)"
              >
                编辑</button
              ><button
                v-if="l.kind === 'area'"
                :aria-label="'编辑容量 ' + l.name"
                @click="capacity(l.id)"
              >
                接入容量
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EngineeringReport
      :report="report"
      :location-path="locationPath"
      @edit="open('demand', $event)"
      @issue="issueAction"
    />
    <DesktopDialog
      v-if="dialog"
      :title="'编辑' + titles[dialog]"
      title-id="engineering-dialog-title"
      :busy="busy"
      @close="dialog = ''"
    >
      <form class="engineering-dialog-form" @submit.prevent="save">
        <div class="dialog-body">
          <FeedbackBanner v-model="error" variant="error" />
          <template v-if="remove"
            ><p>确认删除{{ titles[dialog] }}？此操作会移除该记录。</p></template
          >
          <div v-else class="field-grid">
            <template v-if="dialog === 'location'"
              ><label
                >位置名称<input
                  v-model="draft.name"
                  required
                  maxlength="100" /></label
              ><label
                >位置类型<select
                  aria-label="位置类型"
                  v-model="draft.kind"
                  @change="draft.parentId = ''"
                >
                  <option
                    v-for="(label, key) in LOCATION_KINDS"
                    :value="key"
                    :key="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              ><label class="full"
                >上级位置<select
                  aria-label="上级位置"
                  v-model="draft.parentId"
                  :required="draft.kind === 'floor'"
                >
                  <option v-if="draft.kind !== 'floor'" value="">
                    项目根位置
                  </option>
                  <option v-for="p in parents" :key="p.id" :value="p.id">
                    {{ locationPath(p.id) }}
                  </option>
                </select></label
              ></template
            >
            <template v-else
              ><label class="full"
                >关联区域<select
                  aria-label="关联区域"
                  v-model="draft.locationId"
                  required
                  :disabled="dialog === 'capacity'"
                >
                  <option value="">请选择区域</option>
                  <option v-for="a in areas" :key="a.id" :value="a.id">
                    {{ locationPath(a.id) }}
                  </option>
                </select></label
              >
              <p v-if="!areas.length" class="hint full">
                请取消并先添加区域位置。
              </p></template
            >
            <template v-if="dialog === 'demand'"
              ><label
                >需求名称<input
                  v-model="draft.name"
                  required
                  maxlength="100" /></label
              ><label
                >业务类型<select
                  aria-label="业务类型"
                  v-model="draft.kind"
                  @change="changeKind"
                >
                  <option
                    v-for="(label, key) in DEMAND_KINDS"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <div class="full actions">
                <button
                  type="button"
                  :disabled="busy"
                  @click="applyTypeDefaults"
                >
                  采用类型默认值</button
                ><span class="hint"
                  >仅更新每单位地址数、接入端口数和分配方式。</span
                >
              </div>
              <label
                >当前数量<input
                  v-model="draft.count"
                  type="number"
                  min="0"
                  max="1000000"
                  placeholder="留空待补充" /></label
              ><label
                >增长预留百分比<input
                  v-model="draft.growthPercent"
                  required
                  type="number"
                  min="0"
                  max="1000" /></label
              ><label
                >每单位地址数<input
                  v-model="draft.addressesPerUnit"
                  required
                  type="number"
                  min="0"
                  max="16" /></label
              ><label
                >每单位接入端口数<input
                  v-model="draft.portsPerUnit"
                  required
                  type="number"
                  min="0"
                  max="16" /></label
              ><label
                >地址分配方式<select
                  aria-label="地址分配方式"
                  v-model="draft.addressMode"
                >
                  <option
                    v-for="(label, key) in ADDRESS_MODES"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              ><label
                >已保存网段<select
                  aria-label="已保存网段"
                  v-model="draft.networkId"
                >
                  <option value="">暂未关联</option>
                  <option v-for="n in networks" :key="n.id" :value="n.id">
                    {{ n.name }} · {{ n.cidr }}
                  </option>
                </select></label
              >
              <p v-if="draft.kind === 'wireless'" class="hint full">
                无线客户端数量独立于 AP；默认不占物理接入端口，AP 请单独记录。
              </p></template
            >
            <template v-if="dialog === 'capacity'"
              ><label class="full"
                >可用业务接入端口<input
                  v-model="draft.accessPorts"
                  type="number"
                  min="0"
                  max="1000000"
                  placeholder="留空待补充，0 表示明确为零"
              /></label>
              <p class="hint full">
                填写已扣除上联、禁用和复用接口后的业务可用端口。
              </p></template
            >
            <label class="full"
              >备注<textarea v-model="draft.note" maxlength="1000" rows="2" />
            </label>
          </div>
        </div>
        <footer class="dialog-footer">
          <button
            v-if="
              !remove &&
              engineering[keys[dialog]].some((r) => r.id === draft.id)
            "
            type="button"
            :disabled="busy"
            @click="remove = true"
          >
            删除{{ titles[dialog] }}</button
          ><button type="button" :disabled="busy" @click="dialog = ''">
            取消</button
          ><button class="primary" :disabled="busy">
            {{
              busy ? "正在保存…" : remove ? "确认删除" : "保存" + titles[dialog]
            }}
          </button>
        </footer>
      </form>
    </DesktopDialog>
  </div>
</template>
<style scoped>
.engineering-panel {
  min-width: 0;
  display: grid;
  gap: 18px;
}
.engineering-dialog-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.engineering-locations td:first-child {
  overflow-wrap: anywhere;
}
</style>
