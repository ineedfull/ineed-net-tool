<script setup>
import FeedbackBanner from "./components/FeedbackBanner.vue";
import {
  computed,
  markRaw,
  provide,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  FolderKanban,
  Radar,
  Activity,
  Route,
  Settings,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  RefreshCw,
  Globe,
  Cable,
  Gauge,
  ShieldCheck,
  Calculator,
} from "lucide-vue-next";
import { IP_DISPLAY } from "./ip-display.js";
import smallIcon from "./assets/icon-small.svg";
import ProjectPanel from "./components/ProjectPanel.vue";
import SubnetCalculator from "./components/SubnetCalculator.vue";
import Diagnostics from "./components/Diagnostics.vue";
import NetworkTools from "./components/NetworkTools.vue";
import { TOOL_DEFAULTS, EXTRA_TOOLS } from "./domain/tool-catalog.js";
import HistoryPanel from "./components/HistoryPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import AboutPanel from "./components/AboutPanel.vue";
import { runtime, isDesktop } from "./runtime.js";
import { validateNetworks } from "./domain/workspace.js";
import { scanRange } from "./domain/ipv4.js";
import { taskErrorMessage } from "./domain/task-errors.js";
import { mergeTaskEvent, isTerminalTaskStatus } from "./domain/task-events.js";
const page = ref("projects");
const collapsed = ref(false);
const loadState = ref("loading");
const error = ref("");
const allNetworks = ref([]);
const projects = ref([]);
const activeProjectId = ref("");
const saving = ref(false);
const allHistory = ref([]);
const networks = computed(() =>
  allNetworks.value.filter((n) => n.projectId === activeProjectId.value),
);
const history = computed(() =>
  allHistory.value.filter((h) => h.projectId === activeProjectId.value),
);
const activeProject = computed(() =>
  projects.value.find((p) => p.id === activeProjectId.value),
);
const interfaces = ref([]);
const settings = reactive({
  theme: "light",
  largeFont: false,
  ipView: "table",
});
const ipView = ref("table");
watch(
  () => settings.ipView,
  (value) => {
    ipView.value = value;
  },
);
const calculatorTarget = ref("");
const calculatorKey = ref(0);
const emptyTask = () => ({
  status: "idle",
  rows: [],
  completed: 0,
  received: 0,
  raw: "",
  total: 0,
});
const tasks = reactive({
  ...Object.fromEntries(EXTRA_TOOLS.map(kind => [kind, emptyTask()])),
  scan: emptyTask(),
  ping: emptyTask(),
  route: emptyTask(),
});
const forms = reactive({
  ...structuredClone(TOOL_DEFAULTS),
  scan: {
    target: "192.168.1.0/24",
    timeout: 1000,
    concurrency: 32,
    method: "icmp",
    ports: "80,443",
  },
  ping: {
    target: "127.0.0.1",
    timeout: 1000,
    interval: 1000,
    count: 10,
    payloadSize: 56,
  },
  route: { target: "127.0.0.1", timeout: 1000, maxHops: 20 },
});
const menu = [
  { id: "projects", label: "项目工作台", icon: FolderKanban },
  { id: "calculator", label: "网段计算", icon: Calculator },
  { id: "scan", label: "IP 地址探测", icon: Radar },
  { id: "ping", label: "Ping 工具", icon: Activity },
  { id: "route", label: "路由探测", icon: Route },
  { id: "dns", label: "DNS 查询", icon: Globe },
  { id: "ports", label: "端口扫描", icon: Cable },
  { id: "speed", label: "网速与质量", icon: Gauge },
  { id: "certificate", label: "证书检查", icon: ShieldCheck },
];
const performanceMode = ref('speed');
const toolKind = computed(() => page.value === 'speed' ? performanceMode.value : page.value);
function activityStatus(id) {
  return (id === 'speed' ? [tasks.speed,tasks.quality] : [tasks[id]])
    .find(task => task && ['starting','running','paused','stopping'].includes(task.status))?.status;
}
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
const updateTheme = (event) => {
  systemDark.value = event.matches;
};
const modal = ref(null);
const previewSettings = ref(null);
const displaySettings = computed(() => previewSettings.value || settings);
provide(IP_DISPLAY, {
  view: computed(() => previewSettings.value?.ipView || ipView.value),
  setView: (value) => {
    ipView.value = value;
  },
  history,
  scanTask: computed(() => tasks.scan),
});
const theme = computed(() =>
  displaySettings.value.theme === "system"
    ? systemDark.value
      ? "dark"
      : "light"
    : displaySettings.value.theme,
);
const currentPage = computed(
  () =>
    menu.find((item) => item.id === page.value) || {
      label: "诊断记录",
      icon: History,
    },
);
function closeModal() {
  modal.value = null;
  previewSettings.value = null;
}
const running = computed(
  () =>
    Object.values(tasks).filter((task) =>
      ["running", "paused", "starting", "stopping"].includes(task.status),
    ).length,
);
const previousRoute = computed(() =>
  history.value.find(
    (record) =>
      record.kind === "route" &&
      record.id !== tasks.route.id &&
      record.resolvedIp === tasks.route.resolvedIp,
  ),
);
let unsubscribe;
async function load() {
  try {
    const state = await runtime.load();
    validateNetworks(state.networks);
    adopt(state);
    allHistory.value = state.history;
    Object.assign(settings, state.settings);
    interfaces.value = await runtime.interfaces();
    loadState.value = "ready";
  } catch (e) {
    error.value = e.message;
    loadState.value = "error";
  }
}
onMounted(() => {
  media.addEventListener("change", updateTheme);
  unsubscribe = runtime.onTask((event) => {
    mergeTaskEvent(tasks[event.kind], event, { prepareRow: markRaw });
    // Native completion carries the record only after its transaction succeeds.
    // History has its own lifecycle: a late result can belong in history even
    // when the live view has already moved to another task of the same kind.
    if (isTerminalTaskStatus(event.status) && event.historyRecord && !event.saveError) {
      const record = markRaw(event.historyRecord);
      allHistory.value = [record, ...allHistory.value.filter(item => item.id !== record.id)].slice(0, 100);
    }
  });
  load();
});
onUnmounted(() => {
  unsubscribe?.();
  media.removeEventListener("change", updateTheme);
});
function adopt(state) {
  // Planning saves can return an older snapshot than a completed task's
  // history refresh. Only loading and task completion own diagnostic history.
  projects.value = state.projects;
  allNetworks.value = state.networks;
  activeProjectId.value = state.activeProjectId;
  const projectIds = new Set(state.projects.map(project => project.id));
  allHistory.value = allHistory.value.filter(record => projectIds.has(record.projectId));
}
async function saveWorkspace(patch) {
  if (saving.value) throw new Error("正在保存，请稍后重试");
  saving.value = true;
  try {
    const state = await runtime.save(patch);
    adopt(state);
    return state;
  } finally {
    saving.value = false;
  }
}
async function saveNetworks(next, projectId = activeProjectId.value) {
  if (!projects.value.some((project) => project.id === projectId))
    throw new Error("项目不存在，请重新选择");
  if (projectId !== activeProjectId.value)
    throw new Error("当前项目已切换，请重新导入规划");
  const otherIds = new Set(
    allNetworks.value.filter((n) => n.projectId !== projectId).map((n) => n.id),
  );
  const scoped = next.map((n) => ({
    ...n,
    id: otherIds.has(n.id) ? crypto.randomUUID() : n.id,
    projectId,
  }));
  await saveWorkspace({
    networks: [
      ...allNetworks.value.filter((n) => n.projectId !== projectId),
      ...scoped,
    ],
  });
}
async function saveProject(project) {
  await saveWorkspace({
    projects: projects.value.map((p) => (p.id === project.id ? project : p)),
  });
}
async function addCalculatedNetworks(projectId, additions) {
  if (!projects.value.some(project => project.id === projectId))
    throw new Error("项目不存在，请重新选择");
  const next = [...allNetworks.value, ...additions.map(n => ({ ...n, projectId }))];
  validateNetworks(next);
  await saveWorkspace({ networks: next });
}
function resetProjectViews() {
  forms.scan.target = networks.value[0]?.cidr || "192.168.1.0/24";
  forms.ping.target = "127.0.0.1";
  forms.route.target = "127.0.0.1";
  for (const kind of Object.keys(tasks)) tasks[kind] = emptyTask();
}
async function createProject(project, additions) {
  if (running.value)
    throw new Error("请先停止运行中的诊断任务，再创建或导入项目");
  await saveWorkspace({
    projects: [...projects.value, project],
    networks: [...allNetworks.value, ...additions],
    activeProjectId: project.id,
  });
  resetProjectViews();
}
async function switchProject(event) {
  const previous = activeProjectId.value;
  try {
    if (running.value) throw new Error("请先停止运行中的诊断任务，再切换项目");
    await saveWorkspace({ activeProjectId: event.target.value });
    resetProjectViews();
  } catch (e) {
    event.target.value = previous;
    error.value = e.message;
  }
}
async function saveSettings(next) {
  await runtime.save({ settings: next });
  Object.assign(settings, next);
}
function navigate(kind, target) {
  if (kind === "calculator") {
    calculatorTarget.value = target;
    calculatorKey.value += 1;
  } else {
    if (
      ["running", "paused", "starting", "stopping"].includes(tasks[kind].status)
    ) {
      error.value = "目标页面已有运行中的任务，请先停止再更换目标";
      page.value = kind;
      return;
    }
    forms[kind].target = target;
  }
  page.value = kind;
}
async function start(kind) {
  // A project save may change ownership and then reset all diagnostic views.
  // Do not start native work until that transition has finished.
  if (saving.value) {
    error.value = "工作区正在保存，请稍后再开始诊断";
    return;
  }
  if (
    ["running", "paused", "starting", "stopping"].includes(tasks[kind].status)
  )
    return;
  if (kind === "ping") {
    const count = forms.ping.count;
    if (String(count).trim() === "" || !Number.isInteger(Number(count)) || Number(count) < 0 || Number(count) > 10000) {
      tasks.ping.error = "请填写 0～10000 的整数次数；输入 0 表示持续 Ping";
      return;
    }
  }
  // Reject bad ranges before IPC and preserve results from the previous run.
  if (kind === "scan") {
    try {
      scanRange(forms.scan.target);
    } catch (e) {
      tasks.scan.error = taskErrorMessage(e);
      return;
    }
  }
  tasks[kind] = {
    ...emptyTask(),
    status: "starting",
    options: { ...forms[kind] },
  };
  try {
    const { id } = await runtime.start(kind, {
      ...forms[kind],
      projectId: activeProjectId.value,
    });
    tasks[kind].id = id;
  } catch (e) {
    tasks[kind].status = "error";
    tasks[kind].error = taskErrorMessage(e);
  }
}
async function control(kind, action) {
  try {
    await runtime.control(tasks[kind].id, action);
  } catch (e) {
    tasks[kind].error = taskErrorMessage(e);
  }
}
async function exportTask(kind) {
  try {
    await runtime.export(
      `net-tool-${kind}.json`,
      JSON.stringify({ version: 1, ...tasks[kind] }, null, 2),
    );
  } catch (e) {
    error.value = e.message;
  }
}
</script>
<template>
  <div
    :class="['net-app', { collapsed, 'large-font': displaySettings.largeFont }]"
    :data-theme="theme"
  >
    <aside class="sidebar" aria-label="NetTool 导航">
      <header class="brand">
        <div class="brand-identity">
          <img
            :src="smallIcon"
            :alt="collapsed ? 'Ineed NetTool' : ''"
            title="Ineed NetTool · 网络规划与诊断"
            width="28"
            height="28"
          /><strong v-if="!collapsed">NetTool</strong>
        </div>
        <button
          :aria-label="collapsed ? '展开导航' : '折叠导航'"
          :title="collapsed ? '展开导航' : '折叠导航'"
          :aria-expanded="!collapsed"
          class="icon-button"
          @click="collapsed = !collapsed"
        >
          <component
            :is="collapsed ? PanelLeftOpen : PanelLeftClose"
            :size="16"
          />
        </button>
      </header>
      <div class="sidebar-content">
        <nav aria-label="网络工具">
          <span v-if="!collapsed" class="nav-heading">网络工具</span>
          <button
            v-for="item in menu"
            :key="item.id"
            :class="['nav-item', { active: page === item.id }]"
            :title="item.label"
            :aria-label="item.label"
            :aria-current="page === item.id ? 'page' : undefined"
            @click="page = item.id"
          >
            <component :is="item.icon" :size="18" /><span v-if="!collapsed">{{
              item.label
            }}</span
            ><i
              v-if="
                activityStatus(item.id)
              "
              class="running-dot"
              :title="activityStatus(item.id) === 'paused' ? '已暂停' : '运行中'"
            />
          </button>
          <div class="nav-divider" />
          <button
            :class="['nav-item', { active: page === 'history' }]"
            aria-label="诊断记录"
            title="诊断记录"
            :aria-current="page === 'history' ? 'page' : undefined"
            @click="page = 'history'"
          >
            <History :size="18" /><span v-if="!collapsed">诊断记录</span
            ><small v-if="!collapsed && history.length" class="count">{{
              history.length
            }}</small>
          </button>
        </nav>
        <section v-if="!collapsed" class="local-networks">
          <div class="section-heading">
            <span class="nav-heading">本机网络</span
            ><button
              class="icon-button"
              title="刷新本机网卡"
              aria-label="刷新本机网卡"
              @click="
                runtime
                  .interfaces()
                  .then((value) => (interfaces = value))
                  .catch((e) => (error = e.message))
              "
            >
              <RefreshCw :size="14" />
            </button>
          </div>
          <p v-if="!interfaces.length" class="muted">
            {{ isDesktop ? "暂无可用 IPv4 网卡" : "桌面版显示本机网卡" }}
          </p>
          <button
            v-for="entry in interfaces"
            :key="entry.name + entry.ip"
            class="interface-card"
            :title="entry.name + ' · ' + entry.ip + ' · 计算此网段'"
            @click="navigate('calculator', entry.cidr || entry.ip)"
          >
            <strong><i class="running-dot" />{{ entry.name }}</strong
            ><code>{{ entry.ip }}</code
            ><small>计算此网段 →</small>
          </button>
        </section>
      </div>
      <footer class="sidebar-footer">
        <button
          class="icon-button"
          aria-label="设置"
          title="设置"
          :disabled="loadState !== 'ready'"
          @click="modal = 'settings'"
        >
          <Settings :size="15" /><span v-if="!collapsed">设置</span>
        </button>
        <button
          class="icon-button"
          aria-label="关于"
          title="关于"
          @click="modal = 'about'"
        >
          <CircleHelp :size="15" /><span v-if="!collapsed">关于</span>
        </button>
      </footer>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="workspace-identity">
          <component :is="currentPage.icon" :size="17" />
          <h1>{{ currentPage.label }}</h1>
          <span class="badge blue">{{
            page === "history"
              ? "本地记录"
              : page === "projects"
                ? "网络维护"
                : "IPv4"
          }}</span>
        </div>
        <div class="workspace-state">
          <select
            v-if="loadState === 'ready' && page !== 'calculator'"
            class="project-switcher"
            aria-label="当前项目"
            :value="activeProjectId"
            :disabled="!!running || saving"
            :title="running ? '请先停止诊断再切换项目' : activeProject?.name"
            @change="switchProject"
          >
            <option v-for="p in projects" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
          <span :class="['badge', running ? 'green' : '']"
            ><i v-if="running" class="running-dot" />{{
              running ? `${running} 个任务运行中` : "就绪"
            }}</span
          ><span class="muted">{{
            isDesktop ? "本地工作区" : "浏览器预览"
          }}</span>
        </div>
      </header>
      <div class="page-content" :class="'page-' + page">
        <FeedbackBanner v-model="error" variant="error" />
        <KeepAlive :max="1">
          <SubnetCalculator v-if="page === 'calculator'"
            :key="calculatorKey" :initial-target="calculatorTarget"
            :projects="projects" :networks="allNetworks" :active-project-id="activeProjectId"
            :can-save="loadState === 'ready' && !saving" :add-networks="addCalculatedNetworks"
            @navigate="navigate" />
        </KeepAlive>
        <div v-if="loadState === 'loading' && page !== 'calculator'" class="empty">
          正在加载本地工作区…
        </div>
        <div v-else-if="loadState === 'error' && page !== 'calculator'" class="empty">
          <h2>工作区未能加载</h2>
          <p>已有文件保持原样。请检查数据文件或重试。</p>
          <button @click="load">重新加载</button>
        </div>
        <template v-else-if="loadState === 'ready'">
          <KeepAlive :key="activeProjectId" :max="1"><ProjectPanel
            v-if="page === 'projects'"
            :key="activeProjectId"
            :project="activeProject"
            :history="history"
            :networks="networks"
            :save-project="saveProject"
            :create-project="createProject"
            :save-networks="saveNetworks"
            :running="running"
            @navigate="navigate"
          /></KeepAlive>
          <Diagnostics
            v-if="['scan', 'ping', 'route'].includes(page)"
            :key="page"
            :kind="page"
            :task="tasks[page]"
            :form="forms[page]"
            :previous="previousRoute"
            :desktop="isDesktop"
            :ip-view="previewSettings?.ipView || ipView"
            :interfaces="interfaces"
            @update:ip-view="ipView = $event"
            @start="start(page)"
            @control="control(page, $event)"
            @export="exportTask(page)"
            @navigate="navigate"
          />
          <NetworkTools v-if="['dns','ports','speed','certificate'].includes(page)"
            :key="toolKind" :kind="toolKind" :task="tasks[toolKind]" :form="forms[toolKind]" :desktop="isDesktop"
            @mode="performanceMode=$event" @start="start(toolKind)" @control="control(toolKind,$event)" @export="exportTask(toolKind)" />
          <KeepAlive :max="1">
            <HistoryPanel
              v-if="page === 'history'"
              :key="activeProjectId"
              :history="history"
            />
          </KeepAlive>
        </template>
      </div>
      <footer class="status-footer">
        <span>{{
          isDesktop ? "本地执行 · 配置独立保存" : "浏览器预览 · 诊断需桌面版"
        }}</span
        ><span v-if="page === 'calculator'">独立计算 · 保存时选择项目</span><span v-else
          >{{ networks.length }} 个规划网段 · {{ history.length }} 次诊断</span
        >
      </footer>
    </main>
    <SettingsPanel
      v-if="modal === 'settings'"
      :settings="settings"
      :save-settings="saveSettings"
      :desktop="isDesktop"
      @preview="previewSettings = $event"
      @close="closeModal"
    />
    <AboutPanel
      v-if="modal === 'about'"
      :desktop="isDesktop"
      @close="closeModal"
    />
  </div>
</template>
