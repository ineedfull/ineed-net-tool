<script setup>
import { ref } from "vue";
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import { formatDateTime } from "../domain/date-time.js";
import { methods, targets, outcomes, names } from "./siteAcceptancePresentation.js";

// Saving, project identity and history remain owned by SiteAcceptancePanel.
defineProps({
  title: String,
  busy: Boolean,
  item: Object,
  existing: Boolean,
  candidates: Array,
  targetRows: Array,
  retests: Array,
  detail: Object,
  targetLabel: Function,
});
const emit = defineEmits(["save"]);
const kind = defineModel("kind");
const draft = defineModel("draft");
const error = defineModel("error");
const removing = defineModel("removing");
const form = ref(null);
defineExpose({ focus: () => form.value?.focus() });
</script>
<template>
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
        @submit.prevent="emit('save')"
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
</template>
<style scoped src="./site-acceptance.css"></style>
