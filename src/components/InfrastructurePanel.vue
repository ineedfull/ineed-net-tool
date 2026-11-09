<script setup>
import { computed, ref, watch } from "vue";
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import {
  emptyEngineering,
  validateEngineering,
} from "../domain/engineering.js";
import {
  emptyInfrastructure,
  infrastructureReport,
  DEVICE_KINDS,
  INTERFACE_ROLES,
  INTERFACE_STATES,
} from "../domain/infrastructure.js";
const props = defineProps({
  project: Object,
  networks: Array,
  saveProject: Function,
  editTarget: Object,
});
const emit = defineEmits(["engineering", "topology", "target-opened"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const engineering = computed(
  () => props.project.engineering || emptyEngineering(),
);
const inventory = computed(
  () => engineering.value.infrastructure || emptyInfrastructure(),
);
const report = computed(() => infrastructureReport(props.project));
const areas = computed(() =>
  engineering.value.locations.filter((l) => l.kind === "area"),
);
const dialog = ref(""),
  draft = ref({}),
  busy = ref(false),
  error = ref(""),
  remove = ref(false);
const form = ref(null);
const logicalMode = ref(""),
  logicalNetworks = ref([]),
  accessVlan = ref(""),
  allowedVlans = ref("");
const keys = { device: "devices", interface: "interfaces", link: "links" };
const titles = { device: "设备", interface: "接口", link: "连接" };
const existing = computed(
  () =>
    dialog.value &&
    inventory.value[keys[dialog.value]].some(
      (row) => row.id === draft.value.id,
    ),
);
const dialogTitle = computed(
  () =>
    (remove.value ? "删除" : existing.value ? "编辑" : "添加") +
    titles[dialog.value],
);
watch(
  () => props.project.id,
  () => {
    dialog.value = "";
    error.value = "";
  },
);
function location(id) {
  const l = engineering.value.locations.find((l) => l.id === id);
  return l ? (l.parentId ? location(l.parentId) + " / " : "") + l.name : "—";
}
function device(id) {
  const d = inventory.value.devices.find((d) => d.id === id);
  return d ? d.name + " · " + location(d.locationId) : "—";
}
function endpoint(id) {
  const p = inventory.value.interfaces.find((p) => p.id === id);
  return p ? device(p.deviceId) + " / " + p.name : "—";
}
function open(kind, row) {
  if (busy.value) return;
  error.value = "";
  remove.value = false;
  dialog.value = kind;
  draft.value = clone(
    row ||
      {
        device: {
          id: crypto.randomUUID(),
          locationId: areas.value[0]?.id || "",
          name: "",
          kind: "switch",
          model: "",
          note: "",
        },
        interface: {
          id: crypto.randomUUID(),
          deviceId: inventory.value.devices[0]?.id || "",
          name: "",
          role: "access",
          state: "available",
          note: "",
        },
        link: {
          id: crypto.randomUUID(),
          fromInterfaceId: "",
          toInterfaceId: "",
          note: "",
        },
      }[kind],
  );
  const cfg = draft.value.logicalConfig;
  logicalMode.value = cfg?.mode ?? "";
  logicalNetworks.value = [...(cfg?.networkIds ?? [])];
  accessVlan.value = cfg?.accessVlan ?? "";
  allowedVlans.value =
    cfg?.allowedVlans === null || cfg?.allowedVlans === undefined
      ? ""
      : cfg.allowedVlans.length
        ? cfg.allowedVlans.join(",")
        : "无";
}
watch(
  () => props.editTarget,
  (target) => {
    if (!target) return;
    const row = inventory.value[keys[target.kind]]?.find(
      (r) => r.id === target.id,
    );
    if (row) open(target.kind, row);
    emit("target-opened");
  },
  { immediate: true },
);
async function save() {
  if (busy.value) return;
  // Keep focus inside the native modal when its action buttons become disabled.
  form.value?.focus();
  busy.value = true;
  error.value = "";
  const owner = props.project.id;
  try {
    const project = clone(props.project);
    const next = clone(engineering.value);
    next.infrastructure ||= emptyInfrastructure();
    const key = keys[dialog.value],
      row = clone(draft.value);
    if (dialog.value === "interface" && !remove.value) {
      if (!logicalMode.value) delete row.logicalConfig;
      else {
        next.infrastructure.logicalVersion = 1;
        const text = String(allowedVlans.value).trim();
        const parseVlan = (value) => {
          if (!/^[1-9]\d{0,3}$/.test(String(value).trim()))
            throw Error("VLAN请填写1～4094普通整数");
          return Number(value);
        };
        row.logicalConfig = {
          version: 1,
          mode: logicalMode.value,
          networkIds: [...logicalNetworks.value],
          accessVlan:
            logicalMode.value === "access" &&
            String(accessVlan.value).trim() !== ""
              ? parseVlan(accessVlan.value)
              : null,
          allowedVlans:
            logicalMode.value === "trunk"
              ? text === ""
                ? null
                : text === "无"
                  ? []
                  : text.split(",").map((v) => parseVlan(v.trim()))
              : null,
        };
      }
    }
    if (remove.value)
      next.infrastructure[key] = next.infrastructure[key].filter(
        (r) => r.id !== row.id,
      );
    else {
      if ("name" in row) row.name = row.name.trim();
      const i = next.infrastructure[key].findIndex((r) => r.id === row.id);
      if (i < 0) next.infrastructure[key].push(row);
      else next.infrastructure[key][i] = row;
    }
    validateEngineering(next, props.networks);
    if (props.project.id !== owner) throw Error("项目已切换，请重新编辑。");
    await props.saveProject({ ...project, engineering: next });
    if (props.project.id === owner) dialog.value = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const status = (s) =>
  ({
    ok: "已登记容量满足已知需求",
    pending: "待登记 / 待补充",
    risk: "已登记容量不足",
  })[s];
</script>
<template>
  <div class="infrastructure-panel">
    <div class="section-heading">
      <div>
        <h2>设备与连接</h2>
        <p class="hint">
          连接表示规划登记，不表示在线、连通或完成验收；设备与 IP 台账分别维护。
        </p>
      </div>
      <div class="actions">
        <button @click="emit('topology')">工程拓扑与 VLAN 校核</button>
        <button @click="emit('engineering')">前往场地与需求</button
        ><button :disabled="busy || !areas.length" @click="open('device')">
          添加设备</button
        ><button
          :disabled="busy || !inventory.devices.length"
          @click="open('interface')"
        >
          添加接口</button
        ><button
          :disabled="busy || inventory.interfaces.length < 2"
          @click="open('link')"
        >
          添加连接
        </button>
      </div>
    </div>
    <div v-if="!report.enabled" class="empty">
      <strong>尚未登记设备与连接</strong>
      <p>先在场地与需求建立区域，再登记设备、接口和连接。</p>
    </div>
    <p class="hint">
      {{ report.basis }}。手填容量独立保留，不覆盖、不与接口容量相加。
    </p>
    <h3>设备清单与接口占用</h3>
    <p v-if="!inventory.devices.length" class="hint">
      暂无设备；未登记设备不纳入统计。
    </p>
    <div v-else class="table-wrap infrastructure-devices">
      <table>
        <thead>
          <tr>
            <th>设备 / 区域</th>
            <th>类型 / 型号</th>
            <th>总接口</th>
            <th>可用</th>
            <th>已连接</th>
            <th>空闲</th>
            <th>预留 / 停用</th>
            <th>备注 / 操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in inventory.devices" :key="d.id">
            <td>{{ d.name }}<br />{{ location(d.locationId) }}</td>
            <td>{{ DEVICE_KINDS[d.kind] }} / {{ d.model || "—" }}</td>
            <template
              v-for="r in report.devices.filter((r) => r.deviceId === d.id)"
              :key="r.deviceId"
              ><td>{{ r.total }}</td>
              <td>{{ r.available }}</td>
              <td>{{ r.connected }}</td>
              <td>{{ r.idle }}</td>
              <td>{{ r.reserved }} / {{ r.disabled }}</td></template
            >
            <td>
              {{ d.note || "—" }}
              <button
                :aria-label="'编辑设备 ' + d.name"
                @click="open('device', d)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <h3>接口清单</h3>
    <p v-if="!inventory.interfaces.length" class="hint">
      暂无接口；添加设备后登记接口。
    </p>
    <div v-else class="table-wrap infrastructure-interfaces">
      <table>
        <thead>
          <tr>
            <th>设备 / 区域</th>
            <th>接口</th>
            <th>角色</th>
            <th>状态</th>
            <th>逻辑配置</th>
            <th>连接占用</th>
            <th>备注 / 操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in inventory.interfaces" :key="p.id">
            <td>{{ device(p.deviceId) }}</td>
            <td>{{ p.name }}</td>
            <td>{{ INTERFACE_ROLES[p.role] }}</td>
            <td>{{ INTERFACE_STATES[p.state] }}</td>
            <td>
              {{ p.logicalConfig?.mode ?? "待补充"
              }}<template v-if="p.logicalConfig">
                ·
                {{
                  p.logicalConfig.mode === "access"
                    ? (p.logicalConfig.accessVlan ?? "VLAN待补充")
                    : p.logicalConfig.allowedVlans === null
                      ? "允许VLAN待补充"
                      : p.logicalConfig.allowedVlans.join(",") || "无"
                }}</template
              >
            </td>
            <td>
              {{
                inventory.links.some((l) =>
                  [l.fromInterfaceId, l.toInterfaceId].includes(p.id),
                )
                  ? "已连接"
                  : "未连接"
              }}
            </td>
            <td>
              {{ p.note || "—" }}
              <button
                :aria-label="'编辑接口 ' + p.name + ' ' + device(p.deviceId)"
                @click="open('interface', p)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <h3>连接清单</h3>
    <p v-if="!inventory.links.length" class="hint">
      暂无连接；允许登记无连接设备、冗余链路和物理环路。
    </p>
    <div v-else class="table-wrap infrastructure-links">
      <table>
        <thead>
          <tr>
            <th>起点设备 / 区域 / 接口</th>
            <th>终点设备 / 区域 / 接口</th>
            <th>备注 / 操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in inventory.links" :key="l.id">
            <td>{{ endpoint(l.fromInterfaceId) }}</td>
            <td>{{ endpoint(l.toInterfaceId) }}</td>
            <td>
              {{ l.note || "—" }}
              <button
                :aria-label="'编辑连接 ' + endpoint(l.fromInterfaceId)"
                @click="open('link', l)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <h3>区域业务接入容量</h3>
    <p v-if="!report.enabled" class="hint">设备与连接尚未启用，容量待登记。</p>
    <div v-else class="table-wrap infrastructure-capacities">
      <table>
        <thead>
          <tr>
            <th>区域</th>
            <th>设备 / 接口</th>
            <th>可用业务口</th>
            <th>已连接 / 空闲业务口</th>
            <th>手填容量（独立）</th>
            <th>目标需求（含增长）</th>
            <th>余量 / 状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in report.locations" :key="a.locationId">
            <td>{{ location(a.locationId) }}</td>
            <td>{{ a.deviceCount }} / {{ a.interfaceCount }}</td>
            <td>{{ a.accessPorts }}</td>
            <td>{{ a.connectedAccessPorts }} / {{ a.idleAccessPorts }}</td>
            <td>{{ a.manualAccessPorts ?? "待补充" }}</td>
            <td>
              {{ a.requiredPorts
              }}<span v-if="a.unknownDemandCount"
                >（另有 {{ a.unknownDemandCount }} 条待补充）</span
              >
            </td>
            <td>{{ a.remainingPorts ?? "待补充" }} / {{ status(a.status) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul v-if="report.issues.length" class="hint">
      <li v-for="(issue, i) in report.issues" :key="i">
        {{ location(issue.locationId) }}：{{ issue.message }}
      </li>
    </ul>
    <DesktopDialog
      v-if="dialog"
      :title="dialogTitle"
      title-id="infrastructure-dialog-title"
      :busy="busy"
      @close="dialog = ''"
    >
      <form
        ref="form"
        tabindex="-1"
        class="infrastructure-form"
        @submit.prevent="save"
      >
        <div class="dialog-body">
          <FeedbackBanner v-model="error" variant="error" />
          <p v-if="remove">
            确认删除{{
              titles[dialog]
            }}？不会自动删除其他记录。设备需先删除所属接口；接口需先解除连接；区域需先移走设备。
          </p>
          <div v-else class="field-grid">
            <template v-if="dialog === 'device'"
              ><label
                >设备名称<input
                  v-model="draft.name"
                  required
                  maxlength="100" /></label
              ><label
                >设备类型<select aria-label="设备类型" v-model="draft.kind">
                  <option
                    v-for="(label, key) in DEVICE_KINDS"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              ><label class="full"
                >设备区域<select
                  aria-label="设备区域"
                  v-model="draft.locationId"
                  required
                >
                  <option v-for="a in areas" :key="a.id" :value="a.id">
                    {{ location(a.id) }}
                  </option>
                </select></label
              ><label class="full"
                >设备型号<input v-model="draft.model" maxlength="200" /></label
            ></template>
            <template v-if="dialog === 'interface'"
              ><label class="full"
                >所属设备<select
                  aria-label="所属设备"
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
              ><label
                >接口名称<input
                  v-model="draft.name"
                  required
                  maxlength="100" /></label
              ><label
                >接口角色<select aria-label="接口角色" v-model="draft.role">
                  <option
                    v-for="(label, key) in INTERFACE_ROLES"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              ><label
                >接口状态<select aria-label="接口状态" v-model="draft.state">
                  <option
                    v-for="(label, key) in INTERFACE_STATES"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <label
                >逻辑端口模式<select
                  v-model="logicalMode"
                  aria-label="逻辑端口模式"
                >
                  <option value="">未登记 / 未知</option>
                  <option value="access">Access</option>
                  <option value="trunk">Trunk</option>
                </select></label
              >
              <template v-if="logicalMode"
                ><label class="full"
                  >关联业务网段<select
                    v-model="logicalNetworks"
                    multiple
                    size="3"
                    aria-label="关联业务网段"
                  >
                    <option v-for="n in networks" :key="n.id" :value="n.id">
                      {{ n.name }} · VLAN {{ n.vlan || "待补充" }}
                    </option>
                  </select></label
                >
                <p class="hint full">
                  Access最多关联一张网；Trunk可多选。接口角色与逻辑模式分别登记，留空不等于已配置。
                </p>
                <label v-if="logicalMode === 'access'"
                  >Access VLAN<input
                    v-model="accessVlan"
                    aria-label="Access VLAN"
                    inputmode="numeric"
                    placeholder="留空待补充" /></label
                ><label v-else class="full"
                  >允许 VLAN<input
                    v-model="allowedVlans"
                    aria-label="允许 VLAN"
                    placeholder="例如20,30；留空未知；无表示明确空列表" /></label
              ></template>
              <p class="hint full">
                已连接接口必须保持可用；修改所属设备不得造成设备自连。请先解除连接。
              </p></template
            >
            <template v-if="dialog === 'link'"
              ><label class="full"
                >起点接口<select
                  aria-label="起点接口"
                  v-model="draft.fromInterfaceId"
                  required
                >
                  <option value="">请选择接口</option>
                  <option
                    v-for="p in inventory.interfaces"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ endpoint(p.id) }} · {{ INTERFACE_STATES[p.state] }}
                  </option>
                </select></label
              ><label class="full"
                >终点接口<select
                  aria-label="终点接口"
                  v-model="draft.toInterfaceId"
                  required
                >
                  <option value="">请选择接口</option>
                  <option
                    v-for="p in inventory.interfaces"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ endpoint(p.id) }} · {{ INTERFACE_STATES[p.state] }}
                  </option>
                </select></label
              >
              <p class="hint full">
                两端必须为不同设备的可用接口，每个接口只能参与一条连接。
              </p></template
            >
            <label class="full"
              >备注<textarea v-model="draft.note" rows="2" maxlength="1000" />
            </label>
          </div>
        </div>
        <footer class="dialog-footer">
          <button
            v-if="!remove && existing"
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
.infrastructure-panel {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.infrastructure-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.infrastructure-form select[multiple] {
  height: auto;
  min-height: 88px;
}
.infrastructure-form .dialog-body {
  scroll-padding-block: 8px;
}
.table-wrap {
  max-height: 400px;
  overflow: auto;
}
td {
  overflow-wrap: anywhere;
}
h3 {
  margin: 0;
}
</style>
