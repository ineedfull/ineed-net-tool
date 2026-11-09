<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, ref, watch } from "vue";
import { Plus, Radar, Save } from "lucide-vue-next";
import { subnet, suggestGateway, IPV4_MULTICAST } from "../domain/ipv4.js";
import { overlapNames } from "../domain/workspace.js";
import SubnetSummary from "./SubnetSummary.vue";
import DesktopDialog from "./DesktopDialog.vue";
import SubnetPlanner from "./SubnetPlanner.vue";

const props = defineProps({
  initialTarget: String,
  projects: Array,
  networks: Array,
  activeProjectId: String,
  addNetworks: Function,
  canSave: Boolean,
});
const emit = defineEmits(["navigate"]);
const input = ref(props.initialTarget || "192.168.1.0/24");
const mask = ref("");
const notice = ref("");
const draft = ref(null);
const projectId = ref("");
const busy = ref(false);
const saveError = ref("");
const info = computed(() => {
  try { return { value: subnet(input.value, mask.value || undefined) }; }
  catch (error) { return { error: error.message }; }
});
const gateway = computed(() => info.value.value ? suggestGateway(info.value.value.cidr) : "");
watch([input, mask], () => {
  notice.value = "";
});
const conflicts = computed(() => {
  const existing = props.networks.filter(n => n.projectId === projectId.value);
  return [...new Set((draft.value || []).flatMap(n => overlapNames(existing, n.cidr)))];
});
function prepareSave(splitRows = null) {
  if (!info.value.value) return;
  projectId.value = props.activeProjectId || props.projects[0]?.id || "";
  saveError.value = "";
  notice.value = "";
  // Snapshot the calculation; saving appends new records and never edits existing IDs.
  draft.value = (splitRows || [info.value.value]).map(n => ({
    cidr: n.cidr,
    name: n.name || `网段 ${n.cidr}`,
    note: splitRows ? `来自 ${info.value.value.cidr} 的子网划分；设备 ${n.hosts}，额外预留 ${n.reserved}，网关预留 ${n.gatewaySlots}` : "",
    gateway: splitRows ? n.gateway : "",
    allocations: [],
  }));
}
async function save() {
  if (busy.value || !draft.value?.length) return;
  busy.value = true;
  saveError.value = "";
  try {
    const project = props.projects.find(p => p.id === projectId.value);
    if (!project) throw new Error("请选择保存到的项目");
    const additions = draft.value.map(n => ({ ...n, name: n.name.trim(), id: crypto.randomUUID() }));
    await props.addNetworks(projectId.value, additions);
    notice.value = `已将 ${additions.length} 个网段加入“${project.name}”。可在项目工作台 → 地址规划中继续设置网关、VLAN 和 DHCP。`;
    draft.value = null;
  } catch (error) { saveError.value = error.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="workspace-toolbar">
    <p>快速计算地址范围和容量，按设备数量划分子网；需要保存时再加入项目。</p>
    <span class="badge">独立工具</span>
  </section>
  <FeedbackBanner v-model="notice" />
  <section class="panel" aria-labelledby="calculator-input-title">
    <div class="section-heading"><h2 id="calculator-input-title">公共网段</h2><span class="muted">供下方网段信息与子网划分共用</span></div>
    <div class="form-row">
      <label class="grow">IP 地址或 CIDR<input v-model="input" aria-label="IP 地址或 CIDR" placeholder="192.168.1.0/24" /></label>
      <label>子网掩码（可选）<input v-model="mask" aria-label="子网掩码" placeholder="255.255.255.0" /></label>
    </div>
    <p class="hint">仅输入 IP 时默认 /24；单独填写的子网掩码优先于 CIDR 前缀。</p>
    <p v-if="info.error" class="inline-error" role="alert">{{ info.error }}</p>
  </section>
  <section class="panel" aria-labelledby="calculator-summary-title">
    <div class="section-heading"><h2 id="calculator-summary-title">网段信息</h2><span v-if="info.value" class="badge mono">{{ info.value.cidr }}</span></div>
    <p v-if="!info.value" class="hint">请在上方填写有效的公共网段，以查看地址范围和容量。</p>
    <template v-else>
      <SubnetSummary :info="info.value" />
      <div class="network-details">
        <section class="network-detail">
          <h3>默认网关建议 <span class="muted">首个可用地址</span></h3>
          <div class="multicast-range"><code>{{ gateway || "无通用建议" }}</code></div>
          <p class="hint">{{ gateway ? "仅为规划建议，实际网关以路由器配置为准；加入项目时不自动设置网关。" : "当前网段不提供通用网关建议，请按实际路由配置设置。" }}</p>
        </section>
        <section class="network-detail multicast-detail">
          <h3>组播地址 <span class="muted">IPv4 标准范围</span></h3>
          <div class="multicast-range"><code>{{ IPV4_MULTICAST.start }}</code><span>～</span><code>{{ IPV4_MULTICAST.end }}</code><span class="badge">{{ IPV4_MULTICAST.cidr }}</span></div>
          <p class="hint">与当前子网无关。<code>{{ IPV4_MULTICAST.localControl }}</code> 为本地网络控制组播；<code>{{ IPV4_MULTICAST.administrative }}</code> 为管理域范围组播。</p>
        </section>
      </div>
    </template>
    <div class="actions section-divider">
      <button class="primary" :disabled="!info.value || !canSave || !projects.length" @click="prepareSave()"><Plus :size="15" />加入项目规划</button>
      <button :disabled="!info.value" @click="emit('navigate', 'scan', info.value.cidr)"><Radar :size="15" />探测此网段</button>
    </div>
  </section>
  <SubnetPlanner :parent-cidr="info.value?.cidr || ''" :can-save="canSave && !!projects.length" @save="prepareSave" />
  <DesktopDialog v-if="draft" title="加入项目规划" title-id="calculator-save-title" :busy="busy" @close="!busy && (draft = null)">
    <form class="calculator-save-form" @submit.prevent="save">
      <div class="dialog-body">
      <fieldset :disabled="busy">
        <label>保存到项目<select v-model="projectId" aria-label="保存到项目"><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
        <p class="hint">新增 {{ draft.length }} 个网段，保留现有规划及地址分配。网关等现场参数可在规划页继续设置。</p>
        <label v-for="(net, index) in draft" :key="net.cidr" class="section-divider">
          <span class="mono">{{ net.cidr }}</span>
          <small class="muted">广播 {{ subnet(net.cidr).broadcast }} · 网关 {{ net.gateway || '未设置' }}</small>
          <input v-model="net.name" :aria-label="'保存网段名称 ' + (index + 1)" maxlength="100" required placeholder="网段名称" />
        </label>
        <p v-if="conflicts.length" class="warning">与 {{ conflicts.join('、') }} 地址重叠。父子网段可重叠，请确认规划用途。</p>
        <FeedbackBanner v-model="saveError" variant="error" />
      </fieldset>
      </div>
      <footer class="dialog-footer"><button type="button" :disabled="busy" @click="draft = null">取消</button><button class="primary" :disabled="busy || !projectId || !canSave" type="submit"><Save :size="15" />{{ busy ? "正在保存…" : "保存到项目" }}</button></footer>
    </form>
  </DesktopDialog>
</template>

<style scoped>
.workspace-toolbar p { margin: 0; }
.calculator-save-form { display: flex; flex-direction: column; min-height: 0; }
</style>
