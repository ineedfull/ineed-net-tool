<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, inject, onDeactivated, ref, watch } from "vue";
import { History, Download } from "lucide-vue-next";
import { IP_DISPLAY } from "../ip-display.js";
import PingLog from "./PingLog.vue";
import TargetInfo from "./TargetInfo.vue";
import ScanGrid from "./ScanGrid.vue";
import IpViewToggle from "./IpViewToggle.vue";
import ResultPager from "./ResultPager.vue";
import ToolResults from "./ToolResults.vue";
import { TOOL_NAMES, EXTRA_TOOLS } from "../domain/tool-catalog.js";
import { runtime } from "../runtime.js";
import { formatDateTime } from "../domain/date-time.js";
import DesktopDialog from "./DesktopDialog.vue";

defineProps({ history: Array });
const display = inject(IP_DISPLAY);
const selected = ref(null);
const resultPage = ref(1);
const error = ref("");
watch(selected, () => {
  resultPage.value = 1;
  error.value = "";
});
onDeactivated(() => { selected.value = null; });
const visibleRows = computed(() =>
  (selected.value?.rows || []).slice(
    (resultPage.value - 1) * 100,
    resultPage.value * 100,
  ),
);
const recordCount = record => record.kind === 'speed'
  ? `${((record.summary?.bytes || 0)/1048576).toFixed(2)} MiB`
  : `${record.completed || 0} 条`;
async function exportRecord() {
  try {
    await runtime.export(
      "net-tool-record.json",
      JSON.stringify(selected.value, null, 2),
    );
  } catch (reason) {
    error.value = reason.message;
  }
}
</script>
<template>
  <section class="workspace-toolbar">
    <div><p>最近 100 次任务自动保存；升级应用不会清空记录。</p></div>
  </section>
  <section class="panel history-panel">
    <div v-if="!history.length" class="empty">
      <History :size="36" /><strong>还没有诊断记录</strong>
      <p>完成或停止一次探测后，会自动保存在这里。</p>
    </div>
    <div v-else class="table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>类型</th>
            <th>目标</th>
            <th>开始时间</th>
            <th>结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in history" :key="record.id">
            <td>
              {{
                TOOL_NAMES[record.kind] || record.kind
              }}
            </td>
            <td class="mono"><span class="history-target" :title="record.target">{{ record.target }}</span></td>
            <td class="mono history-time"><span>{{ formatDateTime(record.startedAt).split(' ')[0] }}</span> <span>{{ formatDateTime(record.startedAt).split(' ')[1] }}</span></td>
            <td>
              {{
                { completed: "已完成", stopped: "已停止", error: "失败" }[
                  record.status
                ]
              }}
              · {{ recordCount(record) }}
            </td>
            <td><button @click="selected = record">查看记录</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <DesktopDialog v-if="selected" class="history-detail-dialog" title="诊断详情" title-id="history-detail-title" @close="selected = null">
    <div class="history-detail-toolbar">
      <div class="history-detail-identity">
        <strong class="history-target" :title="selected.target">{{ TOOL_NAMES[selected.kind] || selected.kind }} · {{ selected.target }}</strong>
        <span class="muted">开始：{{ formatDateTime(selected.startedAt) }} · {{ { completed: "已完成", stopped: "已停止", error: "失败" }[selected.status] || selected.status }} · {{ recordCount(selected) }}</span>
      </div>
      <button @click="exportRecord"><Download :size="14" />导出记录</button>
    </div>
    <FeedbackBanner v-model="error" variant="error" />
    <div class="dialog-body history-detail-body">
  <section class="panel">
    <p class="history-full-target"><span class="muted">目标：</span><span class="mono">{{ selected.target }}</span></p>
    <div class="section-heading">
      <h2>诊断结果</h2>
      <div class="actions">
        <IpViewToggle
          v-if="selected.kind === 'scan'"
          :model-value="display.view.value"
          @update:model-value="display.setView"
        />
      </div>
    </div>
    <p v-if="selected.error" class="inline-error">{{ selected.error }}</p>
    <ToolResults v-if="EXTRA_TOOLS.includes(selected.kind)" :key="selected.id" :kind="selected.kind" :task="selected" />
    <ScanGrid
      v-else-if="selected.kind === 'scan' && display.view.value === 'compact'"
      :key="selected.id"
      :task="selected"
      :target="selected.target"
      filter="all"
      :interactive="false"
    />
    <div v-else class="table-wrap result-scroll">
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>IP</th>
            <th>状态</th>
            <th>耗时</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.seq">
            <td>{{ row.hop || row.seq }}</td>
            <td class="mono">{{ row.ip || "*" }}</td>
            <td>
              {{
                {
                  reachable: "有响应",
                  "no-response": "无响应",
                  error: "错误",
                  unreachable: "不可达",
                }[row.status]
              }}
            </td>
            <td>{{ row.ms == null ? "—" : row.ms.toFixed(2) + " ms" }}</td>
            <td>{{ row.detail || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ResultPager
      v-if="!EXTRA_TOOLS.includes(selected.kind) && (selected.kind !== 'scan' || display.view.value === 'table')"
      :total="selected.rows?.length || 0"
      :page="resultPage"
      @update:page="resultPage = $event"
    />
  </section>
  <TargetInfo v-if="selected?.kind === 'ping'" :info="selected.targetInfo" :ip="selected.resolvedIp || selected.target" historical />
  <PingLog
    v-if="selected?.kind === 'ping'"
    :key="selected.id"
    :record="selected"
  />
    </div>
  </DesktopDialog>
</template>

<style scoped>
.history-panel { container-type: inline-size; }
.history-table { table-layout: fixed; }
.history-table th:nth-child(1) { width: 80px; }
.history-table th:nth-child(3) { width: 260px; }
.history-table th:nth-child(4) { width: 220px; }
.history-table th:nth-child(5) { width: 100px; }
@container (max-width: 800px) {
  .history-table th:nth-child(3) { width: 176px; }
  .history-table th:nth-child(4) { width: 160px; }
}
.history-target {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.history-time span { display: inline-block; white-space: nowrap; }
.history-full-target { overflow-wrap: anywhere; margin-bottom: 16px; }
.history-detail-dialog {
  width: min(1200px, calc(100vw - 32px));
  height: min(900px, calc(100dvh - 32px));
}
.history-detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.history-detail-identity { display: grid; flex: 1 1 300px; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.history-detail-identity .muted { font-size: var(--small); }
.history-detail-body { padding: 0; background: var(--bg); }
.history-detail-dialog > .banner { flex-shrink: 0; }
</style>
