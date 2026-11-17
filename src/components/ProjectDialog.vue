<script setup>
import DesktopDialog from "./DesktopDialog.vue";
import FeedbackBanner from "./FeedbackBanner.vue";
import { PROJECT_STATUSES, NETWORK_TEMPLATES } from "../domain/projects.js";

// The panel owns drafts, persistence and async operations; this component renders the dialog.
defineProps({
  busy: Boolean,
  draft: Object,
  log: Object,
  preview: Object,
  plan: Object,
});
const emit = defineEmits(["save", "import", "add-log", "scenario-change"]);
const dialog = defineModel("dialog");
const error = defineModel("error");
const scenario = defineModel("scenario");
const base = defineModel("base");
const externalBase = defineModel("externalBase");
</script>
<template>
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
          ? emit('import')
          : dialog === 'maintenance'
            ? emit('add-log')
            : emit('save')
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
                  @change="emit('scenario-change')"
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
                  @change="emit('scenario-change')"
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
