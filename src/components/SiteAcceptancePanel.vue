<script setup>
import { computed, ref } from "vue";
import SiteAcceptanceDialog from "./SiteAcceptanceDialog.vue";
import { methods, outcomes, states, names } from "./siteAcceptancePresentation.js";
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
    <SiteAcceptanceDialog
      ref="form"
      v-model:kind="kind"
      v-model:draft="draft"
      v-model:error="error"
      v-model:removing="removing"
      :title="title"
      :busy="busy"
      :item="item"
      :existing="existing"
      :candidates="candidates"
      :target-rows="targetRows"
      :retests="retests"
      :detail="detail"
      :target-label="targetLabel"
      @save="save"
    />
  </div>
</template>
<style scoped src="./site-acceptance.css"></style>
