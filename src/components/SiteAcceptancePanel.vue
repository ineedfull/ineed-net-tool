<script setup>
import { computed, ref } from "vue";
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import { formatDateTime } from "../domain/date-time.js";
import {
  acceptanceTargetLabel,
  emptySiteAcceptance,
  siteAcceptanceReport,
  saveAcceptanceItem,
  recordAcceptanceResult,
  saveAcceptanceAction,
  resolveAcceptanceAction,
} from "../domain/site-acceptance.js";
import { validateEngineering } from "../domain/engineering.js";
const props = defineProps({
  project: Object,
  networks: Array,
  history: { type: Array, default: () => [] },
  saveProject: Function,
});
const emit = defineEmits(["inventory"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const plan = computed(
  () => props.project.engineering?.siteAcceptance || emptySiteAcceptance(),
);
const report = computed(() =>
  siteAcceptanceReport(clone(props.project), clone(props.networks)),
);
const inventory = computed(
  () =>
    props.project.engineering?.infrastructure || {
      devices: [],
      interfaces: [],
      links: [],
    },
);
const methods = {
  manual: "人工检查",
  ping: "Ping",
  ports: "端口扫描",
  quality: "链路质量",
};
const targets = {
  project: "项目",
  device: "设备",
  interface: "接口",
  link: "连接",
};
const outcomes = { passed: "通过", failed: "未通过", inconclusive: "无法判定" };
const states = {
  pending: "待验收",
  failed: "未通过",
  rectifying: "整改中",
  passed: "通过",
  ok: "全部通过",
  risk: "存在风险",
};
const kind = ref(""),
  draft = ref({}),
  busy = ref(false),
  error = ref(""),
  form = ref(null),
  removing = ref(false),
  selectedItemId = ref(""),
  detail = ref(null);
const item = computed(() =>
  report.value.items.find((i) => i.id === selectedItemId.value),
);
const existing = computed(() =>
  kind.value === "item"
    ? plan.value.items.some((i) => i.id === draft.value.id)
    : kind.value === "action" &&
      plan.value.actions.some((a) => a.id === draft.value.id),
);
const names = {
  item: "检查项",
  result: "结果",
  action: "整改",
  resolve: "整改闭环",
  detail: "结果详情",
};
const title = computed(() =>
  removing.value
    ? "删除检查项"
    : kind.value === "detail"
      ? "结果详情"
      : kind.value === "resolve"
        ? "选择复验闭环"
        : (existing.value
            ? "编辑"
            : kind.value === "result"
              ? "记录"
              : "添加") + names[kind.value],
);
const candidates = computed(() =>
  props.history.filter(
    (h) =>
      h.projectId === props.project.id &&
      h.kind === item.value?.method &&
      ["completed", "error", "stopped"].includes(h.status),
  ),
);
function targetLabel(type, id) {
  return acceptanceTargetLabel(
    { targetType: type, targetId: id },
    props.project,
  );
}
const targetRows = computed(
  () =>
    inventory.value[
      { device: "devices", interface: "interfaces", link: "links" }[
        draft.value.targetType
      ]
    ] || [],
);
function open(type, row, owner) {
  if (busy.value) return;
  kind.value = type;
  error.value = "";
  removing.value = false;
  selectedItemId.value = owner?.id || row?.itemId || "";
  if (type === "detail") {
    detail.value = clone(row);
    return;
  }
  const defaults = {
    item: {
      name: "",
      targetType: "project",
      targetId: "",
      method: "manual",
      expected: "",
      owner: "",
      note: "",
    },
    result: {
      itemId: owner?.id,
      measuredAt: formatDateTime(Date.now()).replace(" ", "T"),
      operator: "",
      outcome: "inconclusive",
      actual: "",
      note: "",
      historyId: "",
    },
    action: {
      itemId: owner?.id,
      failedResultId:
        owner?.results.filter((r) => r.outcome === "failed").at(-1)?.id || "",
      description: "",
      owner: "",
      dueDate: "",
      note: "",
      resolvedByResultId: "",
    },
    resolve: { resultId: "" },
  };
  draft.value = clone(
    row
      ? { ...row, ...(type === "resolve" ? { resultId: "" } : {}) }
      : { id: crypto.randomUUID(), ...defaults[type] },
  );
}
const retests = computed(() => {
  const latest = item.value?.latestResult;
  const failed = plan.value.results.find(
    (r) => r.id === draft.value.failedResultId,
  );
  return latest?.outcome === "passed" &&
    failed &&
    latest.sequence > failed.sequence &&
    latest.itemRevision >= failed.itemRevision
    ? [latest]
    : [];
});
function editItem(row) {
  const { id, name, targetType, targetId, method, expected, owner, note } = row;
  open(
    "item",
    { id, name, targetType, targetId, method, expected, owner, note },
    row,
  );
}
async function save() {
  if (busy.value) return;
  form.value?.focus();
  busy.value = true;
  error.value = "";
  const owner = props.project.id;
  try {
    let next;
    const p = clone(props.project),
      d = clone(draft.value);
    if (removing.value) {
      next = p;
      next.engineering.siteAcceptance.items =
        next.engineering.siteAcceptance.items.filter((i) => i.id !== d.id);
      validateEngineering(next.engineering, props.networks);
    } else if (kind.value === "item")
      next = saveAcceptanceItem(p, d, props.networks);
    else if (kind.value === "result")
      next = recordAcceptanceResult(
        p,
        { ...d, measuredAt: new Date(d.measuredAt).toISOString() },
        clone(props.history),
        props.networks,
      );
    else if (kind.value === "action")
      next = saveAcceptanceAction(p, d, props.networks);
    else next = resolveAcceptanceAction(p, d.id, d.resultId, props.networks);
    if (props.project.id !== owner) throw Error("项目已切换，请重新编辑。");
    await props.saveProject(next);
    if (props.project.id === owner) kind.value = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="site-acceptance-panel">
    <div class="section-heading">
      <div>
        <h2>现场验收</h2>
        <p class="hint">
          添加检查项 → 记录结果 → 登记整改 → 记录复验 → 选择复验闭环
        </p>
      </div>
      <div class="actions">
        <button @click="emit('inventory')">前往设备与连接</button
        ><button @click="open('item')">添加检查项</button>
      </div>
    </div>
    <p class="hint">
      {{
        report.basis
      }}。诊断任务完成不代表验收通过；请按明确预期登记人工结论。结果只追加，保留记录时要求与出处。
    </p>
    <div v-if="!report.enabled" class="empty">
      <strong>尚未登记现场验收</strong>
      <p>可直接添加项目级检查项，无需先登记设备；保存时才启用验收数据。</p>
    </div>
    <p class="acceptance-summary">
      <strong>{{ states[report.status] }}</strong> ·
      {{ report.counts.total }} 项检查 · {{ report.counts.passed }} 通过 ·
      {{ report.counts.failed }} 未通过 · {{ report.counts.rectifying }} 整改中
      · {{ report.counts.pending }} 待验收
    </p>
    <section
      v-for="row in report.items"
      :key="row.id"
      class="acceptance-item"
      :data-item-id="row.id"
    >
      <div class="section-heading">
        <h3>
          {{ row.name }} <small>要求 v{{ row.revision }}</small>
        </h3>
        <strong class="acceptance-status">{{ states[row.status] }}</strong>
      </div>
      <dl>
        <dt>关联 / 方法</dt>
        <dd>
          {{ targetLabel(row.targetType, row.targetId) }} ·
          {{ methods[row.method] }}
        </dd>
        <dt>当前预期</dt>
        <dd>{{ row.expected }}</dd>
        <dt>负责人</dt>
        <dd>{{ row.owner || "未填写" }}</dd>
        <dt>当前实际</dt>
        <dd>{{ row.actual || "尚无当前版结果" }}</dd>
      </dl>
      <p v-if="row.note" class="hint">{{ row.note }}</p>
      <p v-if="row.requiresRetest" class="warning">
        要求已变化，需复验；旧版结果不计入当前通过统计。
      </p>
      <p class="hint">
        当前版 {{ row.currentResults.length }} 条 · 旧版
        {{ row.historicalResults.length }} 条 · 开放整改
        {{ row.openActionCount }} 条
      </p>
      <div class="actions">
        <button @click="editItem(row)">编辑检查项</button
        ><button @click="open('result', null, row)">记录结果</button
        ><button
          :disabled="!row.results.some((r) => r.outcome === 'failed')"
          @click="open('action', null, row)"
        >
          登记整改
        </button>
      </div>
      <div v-if="row.results.length" class="table-wrap acceptance-results">
        <table>
          <thead>
            <tr>
              <th>序号 / 要求版本</th>
              <th>测量时间 / 登记人</th>
              <th>人工结论 / 实际</th>
              <th>记录</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in [...row.results].reverse()" :key="r.id">
              <td>
                #{{ r.sequence }} · v{{ r.itemRevision }}
                {{ r.itemRevision === row.revision ? "当前版" : "旧版" }}
              </td>
              <td>{{ formatDateTime(r.measuredAt) }}<br />{{ r.operator }}</td>
              <td>
                {{ outcomes[r.outcome] }}
                <p>{{ r.actual }}</p>
              </td>
              <td>
                <button
                  :aria-label="'查看结果 #' + r.sequence"
                  @click="open('detail', r, row)"
                >
                  查看结果 #{{ r.sequence }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-for="a in row.actions" :key="a.id" class="acceptance-action">
        <strong
          >{{ a.resolvedByResultId ? "已闭环" : "开放整改" }} ·
          {{ a.description }}</strong
        >
        <p>
          负责人：{{ a.owner || "未填写" }} · 计划日期：{{
            a.dueDate || "未填写"
          }}
          · 初测 #{{
            plan.results.find((r) => r.id === a.failedResultId)?.sequence
          }}<span v-if="a.resolvedByResultId">
            → 复验 #{{
              plan.results.find((r) => r.id === a.resolvedByResultId)?.sequence
            }}</span
          >
        </p>
        <p v-if="a.note">{{ a.note }}</p>
        <div v-if="!a.resolvedByResultId" class="actions">
          <button @click="open('action', a, row)">编辑整改</button
          ><button @click="open('resolve', a, row)">选择复验闭环</button>
        </div>
      </div>
    </section>
    <DesktopDialog
      v-if="kind"
      :title="title"
      title-id="acceptance-dialog-title"
      :busy="busy"
      @close="kind = ''"
    >
      <form
        ref="form"
        tabindex="-1"
        class="acceptance-form"
        @submit.prevent="save"
      >
        <div class="dialog-body">
          <FeedbackBanner v-model="error" variant="error" />
          <p v-if="removing">
            确认删除检查项？已有结果或整改的检查项不能删除；请保留历史与依赖关系。
          </p>
          <div v-else-if="kind === 'item'" class="field-grid">
            <label class="full"
              >检查项名称<input v-model="draft.name" required maxlength="100"
            /></label>
            <label
              >关联类型<select
                aria-label="关联类型"
                v-model="draft.targetType"
                @change="draft.targetId = ''"
              >
                <option v-for="(label, key) in targets" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >检查方法<select aria-label="检查方法" v-model="draft.method">
                <option v-for="(label, key) in methods" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <label v-if="draft.targetType !== 'project'" class="full"
              >关联目标<select
                aria-label="关联目标"
                v-model="draft.targetId"
                required
              >
                <option value="" disabled>请选择已登记目标</option>
                <option v-for="t in targetRows" :key="t.id" :value="t.id">
                  {{ targetLabel(draft.targetType, t.id) }}
                </option>
              </select></label
            >
            <p class="hint full">
              当前目标：{{
                targetLabel(draft.targetType, draft.targetId)
              }}。修改目标、方法或预期会升版，旧版通过不能证明新要求。
            </p>
            <label class="full"
              >明确预期<textarea
                v-model="draft.expected"
                required
                maxlength="1000"
                rows="4"
                placeholder="写明单位、标准与验收条件"
              ></textarea>
            </label>
            <label class="full"
              >负责人<input v-model="draft.owner" maxlength="100" /></label
            ><label class="full"
              >备注<textarea
                v-model="draft.note"
                maxlength="1000"
                rows="3"
              ></textarea>
            </label>
          </div>
          <div v-else-if="kind === 'result'" class="field-grid">
            <p class="full acceptance-criteria">
              {{ item?.name }} · 要求 v{{ item?.revision }}<br />{{
                targetLabel(item?.targetType, item?.targetId)
              }}
              · {{ methods[item?.method] }}<br />当前预期：{{ item?.expected }}
            </p>
            <p class="hint full">
              人工判定：请核对实际与预期。保存后只追加，不能覆盖或删除；测量时间按本地时间填写，保留毫秒。
            </p>
            <label class="full"
              >测量时间<input
                v-model="draft.measuredAt"
                aria-label="测量时间"
                type="datetime-local"
                step="0.001"
                required
              /><small
                >本地：{{
                  formatDateTime(new Date(draft.measuredAt).getTime())
                }}</small
              ></label
            >
            <label
              >登记人<input
                v-model="draft.operator"
                required
                maxlength="100" /></label
            ><label
              >人工结论<select aria-label="人工结论" v-model="draft.outcome">
                <option
                  v-for="(label, key) in outcomes"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select></label
            >
            <template v-if="item?.method !== 'manual'"
              ><label class="full"
                >诊断记录<select
                  aria-label="诊断记录"
                  v-model="draft.historyId"
                  required
                >
                  <option value="" disabled>
                    选择本项目匹配方法的已保存终态记录
                  </option>
                  <option v-for="h in candidates" :key="h.id" :value="h.id">
                    {{ h.target }} · 任务{{ h.status }} ·
                    {{ formatDateTime(h.finishedAt) }} · {{ h.id }}
                  </option>
                </select></label
              >
              <p class="hint full">
                仅复制有界引用快照，不复制原始日志；任务 error / stopped
                不支持人工“通过”。无可用记录时请先在对应工具保存诊断。
              </p></template
            >
            <label class="full"
              >实际情况<textarea
                v-model="draft.actual"
                required
                maxlength="2000"
                rows="5"
              ></textarea></label
            ><label class="full"
              >备注<textarea
                v-model="draft.note"
                maxlength="1000"
                rows="3"
              ></textarea>
            </label>
          </div>
          <div v-else-if="kind === 'action'" class="field-grid">
            <p class="full">
              {{ item?.name }}：保留失败初测，复验后须明确选择结果闭环。
            </p>
            <label class="full"
              >失败初测<select
                aria-label="失败初测"
                v-model="draft.failedResultId"
                required
              >
                <option
                  v-for="r in item?.results.filter(
                    (r) => r.outcome === 'failed',
                  )"
                  :key="r.id"
                  :value="r.id"
                >
                  #{{ r.sequence }} · v{{ r.itemRevision }} · {{ r.actual }}
                </option>
              </select></label
            ><label class="full"
              >整改说明<textarea
                v-model="draft.description"
                required
                maxlength="2000"
                rows="5"
              ></textarea></label
            ><label>负责人<input v-model="draft.owner" maxlength="100" /></label
            ><label>计划日期<input v-model="draft.dueDate" type="date" /></label
            ><label class="full"
              >备注<textarea
                v-model="draft.note"
                maxlength="1000"
                rows="3"
              ></textarea>
            </label>
          </div>
          <div v-else-if="kind === 'resolve'" class="field-grid">
            <p class="full">{{ draft.description }}</p>
            <p class="hint full">
              必须选择同检查项、晚于失败初测的当前版最新通过结果；登记通过不会自动关闭整改。
            </p>
            <label class="full"
              >通过复验<select
                aria-label="通过复验"
                v-model="draft.resultId"
                required
              >
                <option value="" disabled>请选择有效复验</option>
                <option v-for="r in retests" :key="r.id" :value="r.id">
                  #{{ r.sequence }} · {{ formatDateTime(r.measuredAt) }} ·
                  {{ r.actual }}
                </option>
              </select></label
            >
            <p v-if="!retests.length" class="warning full">
              尚无有效复验，请先记录当前要求的通过结果。
            </p>
          </div>
          <div v-else-if="kind === 'detail'" class="acceptance-detail">
            <h3>
              {{ detail.criteria.name }} · #{{ detail.sequence }} · 要求 v{{
                detail.itemRevision
              }}
            </h3>
            <dl>
              <dt>记录时目标</dt>
              <dd>{{ detail.criteria.targetLabel }}</dd>
              <dt>记录时方法 / 预期</dt>
              <dd>
                {{ methods[detail.criteria.method] }} ·
                {{ detail.criteria.expected }}
              </dd>
              <dt>人工结论</dt>
              <dd>{{ outcomes[detail.outcome] }}</dd>
              <dt>测量时间 / 登记人</dt>
              <dd>
                {{ formatDateTime(detail.measuredAt) }} · {{ detail.operator }}
              </dd>
              <dt>实际情况</dt>
              <dd>{{ detail.actual }}</dd>
              <dt>备注</dt>
              <dd>{{ detail.note || "—" }}</dd>
            </dl>
            <section v-if="detail.evidence">
              <h3>引用快照 / 人工判定</h3>
              <p class="hint">
                来源 ID 仅作出处，保留快照不依赖本机历史；导入不重新绑定诊断。
              </p>
              <dl>
                <dt>来源 ID</dt>
                <dd>{{ detail.evidence.sourceId }}</dd>
                <dt>目标 / 方法 / 任务状态</dt>
                <dd>
                  {{ detail.evidence.target }} ·
                  {{ methods[detail.evidence.kind] }} ·
                  {{ detail.evidence.status }}（诊断任务状态）
                </dd>
                <dt>开始 / 结束</dt>
                <dd>
                  {{ formatDateTime(detail.evidence.startedAt) }}<br />{{
                    formatDateTime(detail.evidence.finishedAt)
                  }}
                </dd>
                <dt>原始可用参数</dt>
                <dd>{{ detail.evidence.parameters || "未获取" }}</dd>
                <dt>错误说明</dt>
                <dd>{{ detail.evidence.detail || "无" }}</dd>
              </dl>
              <ul>
                <li v-for="(m, i) in detail.evidence.metrics" :key="i">
                  {{ m.label }}：{{ m.value === null ? "未知" : m.value }}
                  {{ m.unit }}
                </li>
              </ul>
            </section>
            <p v-else class="hint">人工检查，无诊断引用快照。</p>
          </div>
        </div>
        <footer class="dialog-footer">
          <button
            v-if="kind === 'item' && existing && !removing"
            type="button"
            :disabled="busy"
            @click="
              removing = true;
              error = '';
            "
          >
            删除检查项</button
          ><button type="button" :disabled="busy" @click="kind = ''">
            {{ kind === "detail" ? "关闭" : "取消" }}</button
          ><button
            v-if="kind !== 'detail'"
            class="primary"
            type="submit"
            :disabled="busy"
          >
            {{
              busy
                ? "正在保存…"
                : removing
                  ? "确认删除"
                  : kind === "resolve"
                    ? "确认复验闭环"
                    : kind === "result"
                      ? "保存结果"
                      : "保存" + names[kind]
            }}
          </button>
        </footer>
      </form></DesktopDialog
    >
  </div>
</template>
<style scoped>
.site-acceptance-panel {
  min-width: 0;
}
.acceptance-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin: 16px 0;
  min-width: 0;
}
.acceptance-item h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.acceptance-item dl,
.acceptance-detail dl {
  display: grid;
  grid-template-columns: minmax(80px, 140px) minmax(0, 1fr);
  gap: 8px;
}
.acceptance-item dd,
.acceptance-detail dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.acceptance-item dt,
.acceptance-detail dt {
  color: var(--muted);
}
.acceptance-results {
  margin-top: 12px;
}
.acceptance-results td {
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 120px;
  max-width: 500px;
}
.acceptance-action {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 12px;
  overflow-wrap: anywhere;
}
.acceptance-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  outline: none;
}
.acceptance-form .field-grid {
  min-width: 0;
}
.acceptance-form select {
  max-width: 100%;
  min-width: 0;
}
.acceptance-form textarea {
  resize: vertical;
  min-height: 72px;
}
.acceptance-criteria,
.acceptance-detail,
.acceptance-form p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.acceptance-status {
  flex-shrink: 0;
}
</style>
