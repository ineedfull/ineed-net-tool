<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, ref, watch } from "vue";
import { Plus, Pencil, Trash2 } from "lucide-vue-next";
import { subnet, suggestGateway } from "../domain/ipv4.js";
import { planDeviceSubnets, validateSubnetPlan } from "../domain/subnet-plan.js";
import DesktopDialog from "./DesktopDialog.vue";
const props = defineProps({ parentCidr: String, canSave: Boolean });
const emit = defineEmits(["save"]);
const requirements = ref([
  { id: crypto.randomUUID(), name: "办公终端", hosts: 60, reserved: 0 },
  { id: crypto.randomUUID(), name: "生产设备", hosts: 30, reserved: 0 },
  { id: crypto.randomUUID(), name: "网络管理", hosts: 12, reserved: 0 },
]);
const reserveGateway = ref(true);
const signature = computed(() => JSON.stringify([requirements.value, reserveGateway.value]));
const generatedSignature = ref("");
const results = ref([]);
const error = ref("");
const editing = ref(null);
const stale = computed(() => results.value.length && signature.value !== generatedSignature.value);
const totals = computed(() => ({
  hosts: results.value.reduce((sum, row) => sum + row.hosts, 0),
  allocated: results.value.reduce((sum, row) => sum + row.size, 0),
  available: props.parentCidr ? subnet(props.parentCidr).size : 0,
}));
watch(() => props.parentCidr, () => { results.value = []; error.value = ""; editing.value = null; });
function generate() {
  error.value = "";
  try {
    results.value = planDeviceSubnets(props.parentCidr, requirements.value, reserveGateway.value);
    generatedSignature.value = signature.value;
  } catch (reason) { error.value = reason.message; }
}
function addRequirement() {
  if (requirements.value.length < 128)
    requirements.value.push({ id: crypto.randomUUID(), name: `子网 ${requirements.value.length + 1}`, hosts: 10, reserved: 0 });
}
const editedPlan = computed(() => {
  if (!editing.value) return {};
  try {
    return { rows: validateSubnetPlan(props.parentCidr, results.value.map(row => row.id === editing.value.id ? editing.value : row)) };
  } catch (reason) { return { error: reason.message }; }
});
const editInfo = computed(() => {
  try { return editing.value ? subnet(editing.value.cidr) : null; }
  catch { return null; }
});
const editGatewaySuggestion = computed(() => editInfo.value ? suggestGateway(editInfo.value.cidr) : "");
function applyEdit() {
  if (!editedPlan.value.rows) return;
  results.value = editedPlan.value.rows;
  const updated = results.value.find(row => row.id === editing.value.id);
  requirements.value = requirements.value.map(row => row.id === updated.id
    ? { ...row, name: updated.name, hosts: updated.hosts, reserved: updated.reserved } : row);
  generatedSignature.value = signature.value;
  editing.value = null;
  error.value = "";
}
function removeResult(row) {
  results.value = results.value.filter(item => item.id !== row.id);
  requirements.value = requirements.value.filter(item => item.id !== row.id);
  generatedSignature.value = signature.value;
  error.value = "";
}
function useGateways() {
  error.value = "";
  try {
    results.value = validateSubnetPlan(props.parentCidr, results.value.map(row => ({ ...row, gateway: row.gateway || row.gatewaySuggestion })));
  } catch (reason) { error.value = reason.message; }
}
function saveResults() {
  error.value = "";
  if (stale.value) return;
  try { emit("save", validateSubnetPlan(props.parentCidr, results.value)); }
  catch (reason) { error.value = reason.message; }
}
</script>

<template>
  <section class="panel subnet-planner">
    <div class="section-heading"><h2>按设备数量划分子网</h2><span class="muted">VLSM · 从大到小分配</span></div>
    <p class="hint">使用上方公共网段 <code>{{ parentCidr || '请先输入有效网段' }}</code> 作为父网段。设备数量不包含网关；额外预留可用于后续扩容。</p>
    <div class="subnet-demands" aria-label="子网需求">
      <div v-for="(row, index) in requirements" :key="row.id" class="subnet-demand">
        <label>用途名称<input v-model="row.name" :aria-label="'子网用途 ' + (index + 1)" maxlength="100" /></label>
        <label>设备数量<input v-model.number="row.hosts" type="number" min="1" max="4294967294" :aria-label="'设备数量 ' + (index + 1)" /></label>
        <label>额外预留<input v-model.number="row.reserved" type="number" min="0" max="4294967294" :aria-label="'预留数量 ' + (index + 1)" /></label>
        <button class="danger" :aria-label="'删除需求 ' + (index + 1)" @click="requirements.splice(index, 1)"><Trash2 :size="15" /></button>
      </div>
    </div>
    <div class="actions section-divider">
      <button :disabled="requirements.length >= 128" @click="addRequirement"><Plus :size="15" />新增子网需求</button>
      <label class="gateway-reservation"><input v-model="reserveGateway" type="checkbox" aria-label="为网关预留地址" />每个子网为网关预留 1 个地址</label>
      <button class="primary" :disabled="!parentCidr || !requirements.length" @click="generate">生成划分方案</button>
    </div>
    <p v-if="results.length" class="hint">再次生成会按上方需求重新分配地址，替换当前的手动调整；不会修改已保存的项目。</p>
    <FeedbackBanner v-model="error" variant="error" />
    <p v-if="stale" class="warning" role="status">需求已变更，下方保留上次结果；请重新生成后再编辑或保存。</p>
    <template v-if="results.length">
      <div class="section-heading section-divider"><h3>子网划分结果</h3><span class="muted">{{ results.length }} 个子网 · {{ totals.hosts }} 台设备 · 已划分 {{ totals.allocated }} / {{ totals.available }} 个地址</span></div>
      <p class="hint">广播地址由子网自动计算；默认网关建议采用首个可用地址，实际网关需按现场配置确认。</p>
      <div class="table-wrap subnet-results"><table>
        <thead><tr><th>用途 / 容量</th><th>子网 / 掩码</th><th>可用范围</th><th>广播地址</th><th>默认网关 / 建议</th><th>操作</th></tr></thead>
        <tbody><tr v-for="net in results" :key="net.id">
          <td data-label="用途 / 容量"><strong>{{ net.name }}</strong><small class="block muted">设备 {{ net.hosts }} · 预留 {{ net.reserved }} · 网关 {{ net.gatewaySlots }}</small><small class="block muted">可用 {{ net.usable }} · 余量 {{ net.spare }}</small></td>
          <td data-label="子网 / 掩码" class="mono">{{ net.cidr }}<small class="block muted">{{ net.mask }}</small></td>
          <td data-label="可用范围" class="mono">{{ net.start }}<span class="block muted">至 {{ net.end }}</span></td>
          <td data-label="广播地址" class="mono">{{ net.broadcast }}</td>
          <td data-label="默认网关 / 建议"><span class="mono">{{ net.gateway || '未设置' }}</span><small class="block muted">建议 <span class="mono">{{ net.gatewaySuggestion || '无通用建议' }}</span></small></td>
          <td data-label="操作"><div class="actions"><button :disabled="!!stale" :aria-label="'编辑子网 ' + net.name" @click="editing = { ...net }"><Pencil :size="14" />编辑</button><button class="danger" :disabled="!!stale" :aria-label="'删除子网 ' + net.name" @click="removeResult(net)"><Trash2 :size="14" />删除</button></div></td>
        </tr></tbody>
      </table></div>
      <div class="actions section-divider">
        <button :disabled="!!stale" @click="useGateways">采用全部网关建议</button>
        <button class="primary" :disabled="!!stale || !canSave" @click="saveResults"><Plus :size="15" />将划分结果加入项目</button>
      </div>
    </template>
  </section>
  <DesktopDialog v-if="editing" title="编辑子网" title-id="subnet-edit-title" @close="editing = null">
    <form class="subnet-edit-form" @submit.prevent="applyEdit">
      <div class="dialog-body">
        <div class="form-row"><label class="grow">用途名称<input v-model="editing.name" aria-label="编辑子网用途" maxlength="100" required /></label></div>
        <div class="form-row"><label>设备数量<input v-model.number="editing.hosts" aria-label="编辑设备数量" type="number" min="1" required /></label><label>额外预留<input v-model.number="editing.reserved" aria-label="编辑预留数量" type="number" min="0" required /></label></div>
        <div class="form-row"><label class="grow">子网 CIDR<input v-model.trim="editing.cidr" aria-label="编辑子网 CIDR" required /></label></div>
        <p v-if="editInfo" class="hint">掩码 {{ editInfo.mask }} · 可用 {{ editInfo.usable }} 个<br />可用范围 {{ editInfo.start }} ～ {{ editInfo.end }}<br />广播地址 {{ editInfo.broadcast }}</p>
        <div class="form-row"><label class="grow">默认网关（可选）<input v-model.trim="editing.gateway" aria-label="编辑默认网关" placeholder="未设置" /></label><button type="button" :disabled="!editGatewaySuggestion" @click="editing.gateway = editGatewaySuggestion">使用建议网关</button></div>
        <p class="hint">建议 {{ editGatewaySuggestion || '无通用建议' }}。广播地址与可用范围随 CIDR 重算；手动填写网关时会占用一个可用地址。</p>
        <p v-if="editedPlan.error" class="inline-error" role="alert">{{ editedPlan.error }}</p>
      </div>
      <footer class="dialog-footer"><button type="button" @click="editing = null">取消</button><button class="primary" type="submit" :disabled="!editedPlan.rows">应用修改</button></footer>
    </form>
  </DesktopDialog>
</template>

<style scoped>
.subnet-planner { container-type: inline-size; }
.subnet-demands { display: grid; gap: 12px; }
.subnet-demand { display: grid; grid-template-columns: minmax(140px, 2fr) repeat(2, minmax(100px, 1fr)) auto; align-items: end; gap: 12px; }
.subnet-demand input { width: 100%; }
.gateway-reservation { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.gateway-reservation input { width: auto; }
.subnet-results table { table-layout: fixed; }
.subnet-results th, .subnet-results td { overflow-wrap: anywhere; }
.subnet-results th:last-child { width: 140px; }
.subnet-results td .actions { flex-wrap: wrap; }
.subnet-edit-form { display: flex; flex-direction: column; min-height: 0; }
@container (max-width: 1050px) {
  .subnet-results table, .subnet-results tbody { display: block; }
  .subnet-results thead { display: none; }
  .subnet-results tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 12px; gap: 16px; }
  .subnet-results td { display: block; height: auto; padding: 0; border: 0; min-width: 0; }
  .subnet-results td::before { content: attr(data-label); display: block; color: var(--muted); font-family: inherit; font-size: var(--small); margin-bottom: 6px; }
}
@container (max-width: 650px) {
  .subnet-results tr { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .subnet-demand { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .subnet-demand > label:first-child { grid-column: 1 / -1; }
  .subnet-demand > button { justify-self: end; grid-column: 2; }
}
</style>
