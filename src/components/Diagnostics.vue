<script setup>
import { computed, ref, watch } from "vue";
import {
  Play,
  Square,
  Pause,
  Download,
  ArrowRight,
  Radar,
  Activity,
  Route,
} from "lucide-vue-next";
import PingLog from "./PingLog.vue";
import TargetInfo from "./TargetInfo.vue";
import ScanGrid from "./ScanGrid.vue";
import IpViewToggle from "./IpViewToggle.vue";
import ResultPager from "./ResultPager.vue";
import { ipNumber, scanRange, SCAN_BATCH_SIZE } from "../domain/ipv4.js";
import { formatDateTime } from "../domain/date-time.js";
const props = defineProps({
  kind: String,
  task: Object,
  form: Object,
  previous: Object,
  desktop: Boolean,
  ipView: { type: String, default: "table" },
  interfaces: Array,
});
const emit = defineEmits([
  "start",
  "control",
  "export",
  "navigate",
  "update:ipView",
]);
const filter = ref("all");
const resultPage = ref(1);
const pingVisibleLimit = ref(100);
const rangePreview = computed(() => {
  if (props.kind !== "scan") return {};
  try {
    return { ...scanRange(props.form.target) };
  } catch (error) {
    return { error: error.message };
  }
});
watch([filter, () => props.task.id, () => props.kind], () => {
  resultPage.value = 1;
});
const subtitles = {
  scan: "查看哪些地址有响应，并保留每次探测的判断依据。",
  ping: "持续观察网络时延与丢包，切换页面也会继续运行。",
  route: "沿着数据包的路径逐跳检查，定位链路中的异常。",
};
const busy = computed(() =>
  ["starting", "running", "paused", "stopping"].includes(props.task.status),
);
const rows = computed(() => {
  const rows = props.task.rows.filter(
    (row) => filter.value === "all" || row.status === filter.value,
  );
  return props.kind === "scan"
    ? [...rows].sort(
        (a, b) => (a.address ?? ipNumber(a.ip)) - (b.address ?? ipNumber(b.ip)),
      )
    : rows;
});
const currentPage = computed(() =>
  Math.min(resultPage.value, Math.max(1, Math.ceil(rows.value.length / 100))),
);
const visibleRows = computed(() =>
  props.kind === "scan"
    ? rows.value.slice((currentPage.value - 1) * 100, currentPage.value * 100)
    : props.kind === "ping" ? rows.value.slice(-pingVisibleLimit.value) : rows.value,
);
const loss = computed(() =>
  props.task.completed
    ? (
        ((props.task.completed - props.task.received) / props.task.completed) *
        100
      ).toFixed(1)
    : "0.0",
);
const statuses = {
  idle: "就绪",
  starting: "准备中",
  running: "运行中",
  paused: "已暂停",
  stopping: "正在停止",
  completed: "已完成",
  stopped: "已停止",
  error: "执行失败",
};
const ms = (value) => (value == null ? "—" : `${value.toFixed(2)} ms`);
const chartRows = computed(() => props.task.rows.slice(-100));
const chartMax = computed(() =>
  Math.max(1, ...chartRows.value.map((row) => row.ms || 0)),
);
const chartLines = computed(() => {
  const lines = [];
  let points = [];
  chartRows.value.forEach((row, index) => {
    if (row.status !== "reachable" || !Number.isFinite(row.ms)) {
      if (points.length) lines.push(points.join(" "));
      points = [];
      return;
    }
    points.push(
      `${12 + (index * 876) / Math.max(1, chartRows.value.length - 1)},${118 - ((row.ms || 0) / chartMax.value) * 94}`,
    );
  });
  if (points.length) lines.push(points.join(" "));
  return lines;
});
function oldHop(hop) {
  return props.previous?.rows?.find((row) => row.hop === hop)?.ip || "";
}
</script>
<template>
  <section class="workspace-toolbar">
    <div>
      <p>{{ subtitles[kind] }}</p>
    </div>
    <button :disabled="!task.id" @click="emit('export')">
      <Download :size="15" />导出结果
    </button>
  </section>
  <div v-if="!desktop" class="banner">
    当前为浏览器预览。地址规划可用；真实探测请使用桌面应用。
  </div>
  <section class="panel">
    <div class="section-heading">
      <h2>探测参数</h2>
      <span :class="['badge', busy ? 'blue' : '']">{{
        statuses[task.status]
      }}</span>
    </div>
    <fieldset :disabled="busy">
      <div class="form-row">
        <label class="grow"
          >{{ kind === "scan" ? "IPv4 / CIDR / 地址范围" : "IPv4 地址或域名"
          }}<input
            v-model="form.target"
            :aria-label="kind + '目标'"
            :placeholder="
              kind === 'scan'
                ? '192.168.1.0/24 或 192.168.1.1-192.168.1.20'
                : '例如：192.168.1.1 或 example.com'
            "
            @keydown.enter="emit('start')" /></label
        ><label
          >超时（ms）<input
            v-model.number="form.timeout"
            type="number"
            min="100"
            max="10000"
            aria-label="超时毫秒"
        /></label>
      </div>
      <div v-if="kind === 'scan'" class="form-row">
        <label
          >探测方式<select v-model="form.method" aria-label="探测方式">
            <option value="icmp">ICMP · Ping</option>
            <option value="combined">ICMP + TCP 并行</option>
            <option value="tcp">TCP 端口响应</option>
          </select></label
        ><label
          >并发地址数<input
            v-model.number="form.concurrency"
            type="number"
            min="1"
            max="128"
            aria-label="扫描并发数" /></label
        ><label v-if="form.method !== 'icmp'" class="grow"
          >TCP 端口（逗号分隔）<input
            v-model="form.ports"
            placeholder="80,443"
            aria-label="TCP 端口"
        /></label>
      </div>
      <div v-if="kind === 'ping'" class="form-row">
        <label
          >请求间隔（ms）<input
            v-model.number="form.interval"
            type="number"
            min="200"
            max="60000"
            aria-label="请求间隔毫秒" /></label
        ><label
          >次数（0 = 持续）<input
            v-model.number="form.count"
            type="number"
            min="0"
            max="10000"
            aria-label="Ping 次数" /></label
        ><label
          >数据载荷（字节）<input
            v-model.number="form.payloadSize"
            type="number"
            min="0"
            max="65500"
            step="1"
            list="ping-sizes"
            aria-label="Ping 数据载荷字节数"
          />
          <datalist id="ping-sizes">
            <option
              v-for="size in [32, 56, 128, 512, 1024, 1472]"
              :key="size"
              :value="size"
            />
          </datalist>
        </label>
      </div>
      <div v-if="kind === 'route'" class="form-row">
        <label
          >最大跳数<input
            v-model.number="form.maxHops"
            type="number"
            min="1"
            max="64"
            aria-label="最大跳数" /></label
        ><span class="muted"
          >每跳等待至少 1 秒；部分节点不回应，并不代表后续不可达。</span
        >
      </div>
    </fieldset>
    <div class="actions section-divider">
      <button
        class="primary"
        :disabled="busy || !desktop || !!rangePreview.error"
        @click="emit('start')"
      >
        <Play :size="14" />{{
          task.rows.length ? "重新探测" : "开始探测"
        }}</button
      ><button
        v-if="kind === 'scan' && ['running', 'paused'].includes(task.status)"
        @click="emit('control', task.status === 'paused' ? 'resume' : 'pause')"
      >
        <Pause :size="14" />{{
          task.status === "paused" ? "继续" : "暂停"
        }}</button
      ><button
        class="danger"
        :disabled="
          !busy || task.status === 'starting' || task.status === 'stopping'
        "
        @click="emit('control', 'stop')"
      >
        <Square :size="14" />停止</button
      ><span v-if="task.resolvedIp" class="muted mono"
        >{{ task.target }} → {{ task.resolvedIp }}</span
      >
    </div>
    <p v-if="kind === 'scan'" class="hint">
      默认同时探测 32 个地址，可调至 128。混合模式及多个 TCP
      端口并行检查，收到有效响应即结束该地址探测。无响应不等于空闲；连接拒绝不代表端口开放。暂停会等待已发出的请求结束。
    </p>
    <p
      v-if="kind === 'scan' && rangePreview.error"
      class="inline-error"
      role="alert"
    >
      {{ rangePreview.error }}
    </p>
    <p v-else-if="kind === 'scan'" class="hint" aria-label="扫描范围预览">
      当前范围 {{ rangePreview.length.toLocaleString() }} 个地址 · 每批最多
      {{ SCAN_BATCH_SIZE }} 个，共
      {{ Math.ceil(rangePreview.length / SCAN_BATCH_SIZE) }} 批。 单次支持最多
      65,536 个地址（完整 /16）；已完成结果完整保存，导出包含全部结果。
    </p>
    <p v-if="kind === 'ping'" class="hint">
      数据载荷默认 56 字节，可选常用值或输入 0～65,500 的整数，不含 IPv4 / ICMP
      头部（通常另加 28
      字节）。大包可能分片，本工具不设置禁止分片；串行发送，上一请求结束后再发起下一次。
    </p>
    <p v-if="task.error" class="inline-error" role="alert">{{ task.error }}</p>
    <p v-if="task.saveError" class="inline-error" role="alert">
      {{ task.saveError }}
    </p>
  </section>
  <TargetInfo v-if="kind === 'ping'" :info="task.targetInfo" :ip="task.resolvedIp" />
  <div v-if="kind === 'scan' && task.total" class="scan-progress" role="status">
    <progress
      :value="task.completed"
      :max="task.total"
      aria-label="扫描进度"
    /><span
      >{{ task.completed }} / {{ task.total }} ·
      {{ ((task.elapsedMs || 0) / 1000).toFixed(1) }} 秒 ·
      {{
        task.elapsedMs > 0
          ? ((task.completed * 1000) / task.elapsedMs).toFixed(1)
          : "0.0"
      }}
      个/秒 · {{ task.concurrency }} 路并发 · 第 {{ task.batch || 0 }} /
      {{ task.batchCount || 0 }} 批</span
    >
  </div>
  <div class="metrics standalone" v-if="kind !== 'route'">
    <div>
      <span>{{ kind === "scan" ? "已探测 / 总数" : "已发送" }}</span
      ><strong
        >{{ task.completed || 0
        }}<small v-if="kind === 'scan'">
          / {{ task.total || "—" }}</small
        ></strong
      >
    </div>
    <div>
      <span>有响应</span
      ><strong class="success-text">{{ task.received || 0 }}</strong>
    </div>
    <div>
      <span>{{ kind === "scan" ? "未获得有效响应" : "丢包率" }}</span
      ><strong>{{
        kind === "scan"
          ? (task.completed || 0) - (task.received || 0)
          : loss + "%"
      }}</strong>
    </div>
    <div>
      <span>平均响应耗时</span><strong>{{ ms(task.average) }}</strong>
    </div>
  </div>
  <section v-if="kind === 'ping' && task.rows.length" class="panel chart-panel">
    <div class="section-heading">
      <h2>响应时间 <span class="muted">最近 100 次</span></h2>
      <span class="muted"
        >最小 {{ ms(task.min) }} · 最大 {{ ms(task.max) }}</span
      >
    </div>
    <svg
      class="latency-chart"
      viewBox="0 0 900 145"
      role="img"
      aria-label="Ping 延迟曲线，红色标记为丢包"
    >
      <path d="M12 24H888M12 71H888M12 118H888" class="chart-grid" />
      <text x="14" y="15">{{ ms(chartMax) }}</text>
      <polyline
        v-for="(line, index) in chartLines"
        :key="index"
        :points="line"
        fill="none"
        class="chart-line"
      />
      <circle
        v-for="(row, index) in chartRows"
        :key="row.seq"
        :visibility="row.status === 'reachable' && !Number.isFinite(row.ms) ? 'hidden' : undefined"
        :cx="12 + (index * 876) / Math.max(1, chartRows.length - 1)"
        :cy="
          row.status === 'reachable'
            ? 118 - ((row.ms || 0) / chartMax) * 94
            : 130
        "
        r="3"
        :class="row.status === 'reachable' ? 'chart-dot' : 'chart-loss'"
      />
    </svg>
    <p class="hint">
      统计覆盖本次全部请求；明细最多保留最近 500 条。丢包或无耗时处断开曲线；收到回应但无耗时不计为丢包。
    </p>
  </section>
  <section class="panel result-panel">
    <div class="section-heading">
      <h2>
        {{ kind === "route" ? "路由路径" : "探测结果" }}
        <span class="count">{{ task.rows.length }}</span>
      </h2>
      <label v-if="kind === 'ping'" class="scan-block-label">显示明细
        <select v-model.number="pingVisibleLimit" aria-label="Ping 明细显示数量">
          <option :value="100">最近 100 条</option>
          <option :value="500">全部保留记录（最多 500 条）</option>
        </select>
      </label>
      <div v-if="kind === 'scan'" class="actions">
        <IpViewToggle
          :model-value="ipView"
          @update:model-value="emit('update:ipView', $event)"
        />
        <select v-model="filter" aria-label="结果状态筛选">
          <option value="all">全部状态</option>
          <option value="reachable">有响应</option>
          <option value="no-response">无响应</option>
          <option value="error">探测错误</option>
        </select>
      </div>
      <span
        v-if="kind === 'route' && task.status === 'completed'"
        :class="['badge', task.reached ? 'green' : '']"
        >{{ task.reached ? "已到达目标" : "已结束，未确认到达目标" }}</span
      >
    </div>
    <ScanGrid
      v-if="kind === 'scan' && ipView === 'compact'"
      :task="task"
      :target="task.target || task.options?.target || form.target"
      :filter="filter"
      :interfaces="interfaces"
      @navigate="(kind, ip) => emit('navigate', kind, ip)"
    />
    <div v-else-if="!task.rows.length" class="empty">
      <component
        :is="kind === 'scan' ? Radar : kind === 'ping' ? Activity : Route"
        :size="36"
      /><strong>{{ busy ? "正在等待响应…" : "准备开始一次探测" }}</strong>
      <p>
        {{
          busy
            ? "结果会逐条显示，您可以随时停止。"
            : "填写目标并开始，结果与判断依据会显示在这里。"
        }}
      </p>
    </div>
    <div v-else class="table-wrap result-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ kind === "route" ? "跳数" : "#" }}</th>
            <th>{{ kind === "route" ? "节点 IP" : "IP 地址" }}</th>
            <th>状态</th>
            <th>耗时</th>
            <th v-if="kind === 'scan'">方式 / 依据</th>
            <th v-else-if="kind === 'route'">与上次路径对比</th>
            <th v-else>时间</th>
            <th v-if="kind !== 'route'" class="operation-col">继续诊断</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.seq">
            <td>{{ row.hop || row.seq }}</td>
            <td class="mono">{{ row.ip || "*" }}</td>
            <td>
              <span
                :class="[
                  'badge',
                  row.status === 'reachable'
                    ? 'green'
                    : row.status === 'error' || row.status === 'unreachable'
                      ? 'red'
                      : '',
                ]"
                >{{
                  {
                    reachable: "有响应",
                    "no-response": "无响应",
                    error: "错误",
                    unreachable: "不可达",
                  }[row.status]
                }}</span
              >
            </td>
            <td class="mono">{{ ms(row.ms) }}</td>
            <td v-if="kind === 'scan'">
              <small>{{ row.method || "—" }}</small
              ><small class="block muted">{{ row.detail }}</small>
            </td>
            <td v-else-if="kind === 'route'">
              <span
                v-if="previous && previous.resolvedIp === task.resolvedIp"
                >{{
                  oldHop(row.hop) === row.ip
                    ? "相同"
                    : (oldHop(row.hop) || "*") + " → " + (row.ip || "*")
                }}</span
              ><span v-else class="muted">暂无相同目标记录</span>
            </td>
            <td v-else class="mono">
              {{ formatDateTime(row.time) }}
            </td>
            <td v-if="kind !== 'route'">
              <div class="actions">
                <button
                  v-if="kind === 'scan'"
                  @click="emit('navigate', 'ping', row.ip)"
                >
                  Ping</button
                ><button @click="emit('navigate', 'route', row.ip)">
                  路由 <ArrowRight :size="12" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty">没有符合此筛选的结果。</p>
    </div>
    <ResultPager
      v-if="kind === 'scan' && ipView === 'table'"
      :total="rows.length"
      :page="currentPage"
      @update:page="resultPage = $event"
    />
  </section>
  <PingLog v-if="kind === 'ping'" :record="task" />
  <details v-if="kind === 'route' && task.raw" class="panel">
    <summary>原始探测输出</summary>
    <pre class="raw-output">{{ task.raw }}</pre>
  </details>
</template>
