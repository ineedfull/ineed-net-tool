<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, reactive, ref, watch } from "vue";
import { FolderKanban, Download, Upload, Plus } from "lucide-vue-next";
import DesktopDialog from "./DesktopDialog.vue";
import ConnectivityPanel from "./ConnectivityPanel.vue";
import { enterpriseConnectivity } from "../domain/enterprise.js";
import AllocationPanel from "./AllocationPanel.vue";
import Planner from "./Planner.vue";
import EngineeringPanel from "./EngineeringPanel.vue";
import InfrastructurePanel from "./InfrastructurePanel.vue";
import TopologyPanel from "./TopologyPanel.vue";
import CapacityPlanningPanel from "./CapacityPlanningPanel.vue";
import SiteAcceptancePanel from "./SiteAcceptancePanel.vue";
import {
  newProject,
  PROJECT_STATUSES,
  NETWORK_TEMPLATES,
  templateNetworks,
  projectImport,
} from "../domain/projects.js";
import { runtime, isDesktop } from "../runtime.js";
const props = defineProps({
  project: Object,
  networks: Array,
  history: Array,
  saveProject: Function,
  createProject: Function,
  saveNetworks: Function,
  running: Number,
});
const emit = defineEmits(["navigate"]);
const tab = ref("overview");
const inventoryTarget = ref(null);
function editInventory(kind, id) {
  inventoryTarget.value = { kind, id };
  tab.value = "infrastructure";
}
watch(
  () => props.project.id,
  () => {
    tab.value = "overview";
    inventoryTarget.value = null;
  },
);
function tabKey(event) {
  const buttons = [
    ...event.currentTarget.parentElement.querySelectorAll('[role="tab"]'),
  ];
  const index = buttons.indexOf(event.currentTarget);
  const target = {
    ArrowRight: (index + 1) % buttons.length,
    ArrowLeft: (index + buttons.length - 1) % buttons.length,
    Home: 0,
    End: buttons.length - 1,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  buttons[target].focus();
  buttons[target].click();
}
const dialog = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");
const draft = reactive({});
const scenario = ref("blank");
const base = ref("192.168.10.0/24");
const externalBase = ref("10.80.0.0/16");
const preview = ref(null);
const log = reactive({
  date: new Date().toLocaleDateString("sv-SE"),
  content: "",
  owner: "",
  status: "pending",
});
const allocationCount = computed(() =>
  props.networks.reduce((sum, n) => sum + n.allocations.length, 0),
);
const pendingCount = computed(
  () => props.project.maintenance.filter((m) => m.status === "pending").length,
);
const plan = computed(() => {
  if (scenario.value === "blank") return { networks: [] };
  try {
    let index = 0;
    return {
      networks: templateNetworks(
        scenario.value,
        base.value,
        draft.id,
        () => `preview-${++index}`,
        { externalBase: externalBase.value },
      ),
    };
  } catch (e) {
    return { error: e.message, networks: [] };
  }
});
function openCreate() {
  Object.keys(draft).forEach((key) => delete draft[key]);
  Object.assign(draft, newProject(crypto.randomUUID(), ""));
  scenario.value = "blank";
  error.value = "";
  dialog.value = "create";
}
function openEdit() {
  Object.keys(draft).forEach((key) => delete draft[key]);
  Object.assign(draft, JSON.parse(JSON.stringify(props.project)));
  error.value = "";
  dialog.value = "edit";
}
function changeScenario() {
  externalBase.value = "10.80.0.0/16";
  base.value =
    NETWORK_TEMPLATES.find((t) => t.id === scenario.value)?.base ||
    "192.168.10.0/24";
}
async function action(callback, message = "") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await callback();
    if (message) notice.value = message;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  await action(async () => {
    const project = {
      ...JSON.parse(JSON.stringify(draft)),
      name: draft.name.trim(),
    };
    if (dialog.value === "edit") await props.saveProject(project);
    else {
      const networks =
        scenario.value === "blank"
          ? []
          : templateNetworks(
              scenario.value,
              base.value,
              project.id,
              undefined,
              { externalBase: externalBase.value },
            );
      if (scenario.value === "enterprise-dual")
        project.connectivity = enterpriseConnectivity(
          base.value,
          externalBase.value,
          networks,
        );
      await props.createProject(project, networks);
    }
    dialog.value = "";
  }, "项目资料已保存");
}
async function exportExcel(mode) {
  await action(async () => {
    if (await runtime.exportExcel(mode, props.project.id))
      notice.value =
        mode === "template" ? "Excel 模板已保存" : "项目 Excel 台账已导出";
  });
}
async function importExcel() {
  await action(async () => {
    const data = await runtime.importExcel();
    if (data) {
      preview.value = data;
      dialog.value = "import";
    }
  });
}
async function confirmImport() {
  await action(async () => {
    const imported = projectImport(JSON.parse(JSON.stringify(preview.value)));
    await props.createProject(imported.project, imported.networks);
    dialog.value = "";
    preview.value = null;
  }, "Excel 已导入为新项目");
}
async function addLog() {
  await action(async () => {
    await props.saveProject({
      ...props.project,
      maintenance: [
        { ...log, content: log.content.trim(), id: crypto.randomUUID() },
        ...props.project.maintenance,
      ],
    });
    log.content = "";
    dialog.value = "";
  }, "维护记录已保存");
}
async function toggleLog(record) {
  await action(() =>
    props.saveProject({
      ...props.project,
      maintenance: props.project.maintenance.map((m) =>
        m.id === record.id
          ? { ...m, status: m.status === "done" ? "pending" : "done" }
          : m,
      ),
    }),
  );
}
</script>
<template>
  <section class="workspace-toolbar">
    <p>以项目管理网络，让规划、地址登记与后续维护有据可查。</p>
    <div class="actions">
      <button :disabled="busy || !isDesktop" @click="exportExcel('template')">
        <Download :size="15" />下载 Excel 模板</button
      ><button :disabled="busy || running || !isDesktop" @click="importExcel">
        <Upload :size="15" />导入 Excel</button
      ><button :disabled="busy || !isDesktop" @click="exportExcel('project')">
        <Download :size="15" />导出 Excel</button
      ><button class="primary" :disabled="busy || running" @click="openCreate">
        <Plus :size="15" />新建项目
      </button>
    </div>
  </section>
  <FeedbackBanner v-if="!dialog" v-model="error" variant="error" />
  <FeedbackBanner v-model="notice" />
  <section class="panel project-summary">
    <div class="section-heading">
      <div class="project-identity">
        <FolderKanban :size="24" />
        <div>
          <h2>{{ project.name }}</h2>
          <p class="hint">
            {{
              [project.customer, project.site, project.owner]
                .filter(Boolean)
                .join(" · ") || "补充客户、位置与负责人，便于后续交接。"
            }}
          </p>
        </div>
      </div>
      <div class="actions">
        <span class="badge blue">{{ PROJECT_STATUSES[project.status] }}</span
        ><button :disabled="busy" @click="openEdit">编辑项目</button>
      </div>
    </div>
    <div class="metrics">
      <div>
        <span>规划网段</span><strong>{{ networks.length }}</strong>
      </div>
      <div>
        <span>登记地址</span><strong>{{ allocationCount }}</strong>
      </div>
      <div>
        <span>预留地址</span
        ><strong>{{
          networks.reduce(
            (s, n) =>
              s + n.allocations.filter((a) => a.status === "reserved").length,
            0,
          )
        }}</strong>
      </div>
      <div>
        <span>待处理维护</span><strong>{{ pendingCount }}</strong>
      </div>
    </div>
    <p v-if="project.note" class="project-note">{{ project.note }}</p>
    <div class="project-tabs" role="tablist" aria-label="项目内容">
      <button
        v-for="item in [
          { id: 'overview', label: '地址规划' },
          { id: 'engineering', label: '场地与需求' },
          { id: 'infrastructure', label: '设备与连接' },
          { id: 'topology', label: '工程拓扑' },
          { id: 'capacity', label: 'PoE与带宽' },
          { id: 'acceptance', label: '现场验收' },
          { id: 'ledger', label: 'IP 地址台账' },
          ...(project.connectivity
            ? [{ id: 'connectivity', label: '接入与互通' }]
            : []),
          { id: 'maintenance', label: '维护记录' },
        ]"
        :id="'tab-' + item.id"
        :key="item.id"
        role="tab"
        :tabindex="tab === item.id ? 0 : -1"
        @keydown="tabKey"
        :aria-selected="tab === item.id"
        aria-controls="project-content"
        :class="{ active: tab === item.id }"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>
  </section>
  <section
    id="project-content"
    :class="tab === 'overview' ? 'project-planning' : 'panel'"
    role="tabpanel"
    :aria-labelledby="'tab-' + tab"
  >
    <KeepAlive :max="1">
      <Planner
        v-if="tab === 'overview'"
        :project-id="project.id"
        :networks="networks"
        :save-networks="saveNetworks"
        @navigate="(kind, target) => emit('navigate', kind, target)"
      />
    </KeepAlive>
    <SiteAcceptancePanel
      v-if="tab === 'acceptance'"
      :key="project.id"
      :project="project"
      :networks="networks"
      :history="history"
      :save-project="saveProject"
      @inventory="tab = 'infrastructure'"
    />
    <CapacityPlanningPanel
      v-if="tab === 'capacity'"
      :key="project.id"
      :project="project"
      :networks="networks"
      :save-project="saveProject"
      @inventory="tab = 'infrastructure'"
    />
    <TopologyPanel
      v-if="tab === 'topology'"
      :key="project.id"
      :project="project"
      :networks="networks"
      :save-project="saveProject"
      @record="editInventory"
      @inventory="tab = 'infrastructure'"
      @acceptance="tab = 'acceptance'"
    />
    <InfrastructurePanel
      v-if="tab === 'infrastructure'"
      :key="project.id"
      :project="project"
      :networks="networks"
      :save-project="saveProject"
      :edit-target="inventoryTarget"
      @target-opened="inventoryTarget = null"
      @engineering="tab = 'engineering'"
      @topology="tab = 'topology'"
    />
    <EngineeringPanel
      v-if="tab === 'engineering'"
      :key="project.id"
      :project="project"
      :networks="networks"
      :save-project="saveProject"
      @planning="tab = 'overview'"
    />
    <AllocationPanel
      v-if="tab === 'ledger'"
      :networks="networks"
      :save-networks="saveNetworks"
      @navigate="(kind, target) => emit('navigate', kind, target)"
    />
    <ConnectivityPanel
      v-else-if="tab === 'connectivity' && project.connectivity"
      :key="project.id"
      :project="project"
      :save-project="saveProject"
    />
    <template v-else-if="tab === 'maintenance'">
      <div class="section-heading">
        <h2>维护记录</h2>
        <button
          class="primary"
          :disabled="busy"
          @click="
            error = '';
            dialog = 'maintenance';
          "
        >
          添加维护记录
        </button>
      </div>
      <div v-if="!project.maintenance.length" class="empty">
        <strong>记录每一次维护与交接</strong>
        <p>设备更换、地址调整、巡检事项，都可以留在项目中。</p>
      </div>
      <div v-else class="table-wrap">
        <table class="maintenance-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>维护内容</th>
              <th>负责人</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in project.maintenance" :key="m.id">
              <td>{{ m.date }}</td>
              <td>
                <details v-if="m.content.length > 80" class="maintenance-note">
                  <summary>
                    <span class="project-note">{{ m.content }}</span>
                    <span class="maintenance-expand">展开全文</span>
                    <span class="maintenance-collapse">收起全文</span>
                  </summary>
                </details>
                <span v-else class="project-note">{{ m.content }}</span>
              </td>
              <td>{{ m.owner || "—" }}</td>
              <td>
                <span
                  :class="['badge', m.status === 'done' ? 'green' : 'blue']"
                  >{{ m.status === "done" ? "已完成" : "待处理" }}</span
                >
              </td>
              <td>
                <button :disabled="busy" @click="toggleLog(m)">
                  {{ m.status === "done" ? "重新打开" : "标记完成" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
  <DesktopDialog
    v-if="dialog"
    class="project-dialog"
    :title="
      {
        create: '新建网络项目',
        edit: '编辑项目',
        import: 'Excel 导入预览',
        maintenance: '添加维护记录',
      }[dialog]
    "
    title-id="project-dialog-title"
    :busy="busy"
    @close="dialog = ''"
  >
    <form
      class="project-dialog-form"
      @submit.prevent="
        dialog === 'import'
          ? confirmImport()
          : dialog === 'maintenance'
            ? addLog()
            : save()
      "
    >
      <div class="dialog-body">
        <FeedbackBanner v-model="error" variant="error" />
        <template v-if="dialog === 'create' || dialog === 'edit'">
          <div class="field-grid">
            <label
              >项目名称<input
                v-model="draft.name"
                required
                maxlength="100"
                placeholder="例如：总部办公室网络" /></label
            ><label
              >项目状态<select aria-label="项目状态" v-model="draft.status">
                <option
                  v-for="(label, key) in PROJECT_STATUSES"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select></label
            >
            <label>客户<input v-model="draft.customer" maxlength="200" /></label
            ><label
              >现场位置<input v-model="draft.site" maxlength="200" /></label
            ><label class="full"
              >项目负责人<input v-model="draft.owner" maxlength="200" /></label
            ><label class="full"
              >项目备注<textarea
                v-model="draft.note"
                rows="2"
                maxlength="2000"
              />
            </label>
          </div>
          <template v-if="dialog === 'create'">
            <div class="section-heading section-divider">
              <h3>选择起步方式</h3>
              <span class="muted">创建前预览，后续可调整</span>
            </div>
            <div class="scenario-grid">
              <label
                :class="['scenario-card', { selected: scenario === 'blank' }]"
                ><input
                  v-model="scenario"
                  type="radio"
                  value="blank"
                  @change="changeScenario"
                /><strong>空白项目</strong
                ><span>从自己的网段规划开始。</span></label
              ><label
                v-for="t in NETWORK_TEMPLATES"
                :key="t.id"
                :class="['scenario-card', { selected: scenario === t.id }]"
                ><input
                  v-model="scenario"
                  type="radio"
                  :value="t.id"
                  @change="changeScenario"
                /><strong>{{ t.name }}</strong
                ><span>{{ t.description }}</span></label
              >
            </div>
            <template v-if="scenario !== 'blank'"
              ><label class="template-base"
                >{{
                  scenario === "enterprise-dual"
                    ? "内网地址空间"
                    : "项目地址空间"
                }}<input v-model="base" class="mono" placeholder="10.10.0.0/22"
              /></label>
              <label v-if="scenario === 'enterprise-dual'" class="template-base"
                >外网地址空间<input
                  v-model="externalBase"
                  class="mono"
                  aria-label="外网地址空间"
              /></label>
              <p v-if="scenario === 'enterprise-dual'" class="hint">
                内外网使用独立交换与路由；三运营商仅接入外网出口。生成 3
                条线路台账和 2
                条停用的示例互通规则，默认拒绝跨网访问。此处仅规划，需在现场配置生效。
              </p>
              <p v-if="plan.error" class="inline-error" role="alert">
                {{ plan.error }}
              </p>
              <div v-else class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>规划用途</th>
                      <th>网段</th>
                      <th>VLAN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="n in plan.networks" :key="n.id">
                      <td>{{ n.name }}</td>
                      <td class="mono">{{ n.cidr }}</td>
                      <td>{{ n.vlan }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="hint">
                仅预留各网段网关，现场设备请按实际情况登记。
              </p></template
            >
          </template>
        </template>
        <template v-else-if="dialog === 'import'">
          <template v-if="preview.errors.length"
            ><div class="banner error" role="alert">
              校验未通过，共
              {{ preview.totalErrors || preview.errors.length }}
              项问题，未写入任何数据。
            </div>
            <ul class="import-errors">
              <li v-for="message in preview.errors" :key="message">
                {{ message }}
              </li>
            </ul>
            <p class="hint">
              请修正 Excel 后重新导入，最多展示前 50 项问题。
            </p></template
          >
          <template v-else
            ><h3>{{ preview.project.name }}</h3>
            <p class="hint">
              {{ preview.networks.length }} 个网段 ·
              {{
                preview.networks.reduce(
                  (sum, n) => sum + n.allocations.length,
                  0,
                )
              }}
              条地址登记 · {{ preview.project.maintenance.length }} 条维护记录
              <span v-if="preview.project.connectivity">
                · {{ preview.project.connectivity.uplinks.length }} 条运营商线路
                ·
                {{ preview.project.connectivity.policies.length }}
                条互通规则</span
              >
            </p>
            <p v-if="preview.project.engineering" class="hint">
              {{ preview.project.engineering.locations.length }} 个位置 ·
              {{ preview.project.engineering.demands.length }} 条需求 ·
              {{ preview.project.engineering.capacities.length }} 条接入容量
              <span v-if="preview.project.engineering.siteAcceptance">
                ·
                {{ preview.project.engineering.siteAcceptance.items.length }}
                项验收检查 ·
                {{ preview.project.engineering.siteAcceptance.results.length }}
                条验收结果 ·
                {{ preview.project.engineering.siteAcceptance.actions.length }}
                条整改</span
              >
              <span v-if="preview.project.engineering.infrastructure">
                ·
                {{ preview.project.engineering.infrastructure.devices.length }}
                台设备 ·
                {{
                  preview.project.engineering.infrastructure.interfaces.length
                }}
                个接口 ·
                {{ preview.project.engineering.infrastructure.links.length }}
                条连接<span
                  v-if="
                    preview.project.engineering.infrastructure.capacityPlanning
                  "
                >
                  ·
                  {{
                    preview.project.engineering.infrastructure.capacityPlanning
                      .powerBudgets.length
                  }}
                  条电源预算 ·
                  {{
                    preview.project.engineering.infrastructure.capacityPlanning
                      .poeLoads.length
                  }}
                  条PoE负载 ·
                  {{
                    preview.project.engineering.infrastructure.capacityPlanning
                      .uplinks.length
                  }}
                  条上联 ·
                  {{
                    preview.project.engineering.infrastructure.capacityPlanning
                      .trafficDemands.length
                  }}
                  条业务项</span
                ></span
              >
            </p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>网段名称</th>
                    <th>CIDR</th>
                    <th>登记地址</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="n in preview.networks" :key="n.id">
                    <td>{{ n.name }}</td>
                    <td class="mono">{{ n.cidr }}</td>
                    <td>{{ n.allocations.length }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="hint">
              确认后创建一个独立的新项目。已有项目不会被覆盖；模板示例会作为数据导入，请先替换为现场资料。
            </p></template
          >
        </template>
        <div v-else class="field-grid">
          <label
            >维护日期<input v-model="log.date" type="date" required /></label
          ><label
            >维护状态<select aria-label="维护状态" v-model="log.status">
              <option value="pending">待处理</option>
              <option value="done">已完成</option>
            </select></label
          ><label class="full"
            >维护内容<textarea
              v-model="log.content"
              required
              rows="4"
              maxlength="2000"
            /></label
          ><label class="full"
            >维护负责人<input v-model="log.owner" maxlength="200"
          /></label>
        </div>
      </div>
      <footer class="dialog-footer">
        <button type="button" :disabled="busy" @click="dialog = ''">取消</button
        ><button
          v-if="dialog !== 'import' || !preview.errors.length"
          class="primary"
          :disabled="busy || (dialog === 'create' && !!plan.error)"
        >
          {{
            busy
              ? "正在保存…"
              : dialog === "import"
                ? "确认导入为新项目"
                : dialog === "create"
                  ? "创建项目"
                  : dialog === "maintenance"
                    ? "保存维护记录"
                    : "保存项目"
          }}
        </button>
      </footer>
    </form>
  </DesktopDialog>
</template>

<style scoped>
.project-planning {
  min-width: 0;
}
</style>
