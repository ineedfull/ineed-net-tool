<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, reactive, ref } from "vue";
import { Plus, Pencil, ArrowUp, ArrowDown, Trash2 } from "lucide-vue-next";
import DesktopDialog from "./DesktopDialog.vue";
import {
  ACCESS_TYPES,
  LINK_STATUSES,
  POLICY_PROTOCOLS,
  validateConnectivity,
} from "../domain/enterprise.js";
const props = defineProps({ project: Object, saveProject: Function });
const plan = computed(() => props.project.connectivity);
const dialog = ref(""),
  error = ref(""),
  notice = ref(""),
  busy = ref(false);
const draft = reactive({});
function edit(kind, value) {
  Object.keys(draft).forEach((key) => delete draft[key]);
  Object.assign(draft, structuredClone(value));
  error.value = "";
  dialog.value = kind;
}
function addRule() {
  edit("policy", {
    id: crypto.randomUUID(),
    name: "",
    source: plan.value.internalCidr,
    destination: plan.value.externalCidr,
    protocol: "tcp",
    ports: "443",
    action: "allow",
    enabled: false,
    note: "",
  });
}
async function update(change) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const next = JSON.parse(JSON.stringify(plan.value));
    change(next);
    validateConnectivity(next);
    await props.saveProject({ ...props.project, connectivity: next });
    notice.value = "互联规划已保存；请在现场网络设备上配置生效。";
    dialog.value = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function save() {
  const value = JSON.parse(JSON.stringify(draft));
  return update((next) => {
    const list = dialog.value === "uplink" ? next.uplinks : next.policies;
    const index = list.findIndex((item) => item.id === value.id);
    if (index < 0) list.push(value);
    else list[index] = value;
  });
}
function move(index, offset) {
  update((next) => {
    const [rule] = next.policies.splice(index, 1);
    next.policies.splice(index + offset, 0, rule);
  });
}
</script>
<template>
  <div class="section-heading">
    <h2>三运营商接入与内外网互通</h2>
    <span class="badge blue">规划台账</span>
  </div>
  <p class="hint">
    内外网使用独立交换与路由，跨网访问经边界防火墙。此处记录线路和策略，不直接下发设备配置；VLAN
    编号本身不等于物理隔离。
  </p>
  <div class="network-topology" aria-label="双网拓扑规划">
    <div>
      <strong>电信 · 联通 · 移动</strong><span>三条独立运营商线路</span>
    </div>
    <span class="topology-arrow">↓</span>
    <div>
      <strong>外网出口防火墙</strong><span>NAT · 健康检查 · 优先级选路</span>
    </div>
    <span class="topology-arrow">↓</span>
    <div>
      <strong>外网独立网络</strong><code>{{ plan.externalCidr }}</code
      ><span>办公 · 访客 · DMZ · 管理</span>
    </div>
    <span class="topology-arrow">↕</span>
    <div class="boundary">
      <strong>边界防火墙 · 按策略互通</strong
      ><span>默认拒绝跨网新建连接；仅放行已授权服务</span>
    </div>
    <span class="topology-arrow">↕</span>
    <div>
      <strong>内网独立网络</strong><code>{{ plan.internalCidr }}</code
      ><span>业务终端 · 服务器 · 视频物联 · 管理</span>
    </div>
  </div>
  <FeedbackBanner v-if="!dialog" v-model="error" variant="error" />
  <FeedbackBanner v-model="notice" />
  <div class="section-heading section-divider"><h3>运营商线路</h3></div>
  <p class="hint">
    优先级数字越小越优先；带宽、公网地址和网关按实际交付填写。开通状态由人工登记，不代表实时链路健康；切换、负载分担与回程策略需在出口设备上配置。
  </p>
  <div class="table-wrap">
    <table class="uplink-table">
      <thead>
        <tr>
          <th>运营商 / 接口</th>
          <th>接入 / 带宽</th>
          <th>地址 / 网关</th>
          <th>优先级</th>
          <th>状态</th>
          <th class="connectivity-actions-cell">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="line in [...plan.uplinks].sort(
            (a, b) => a.priority - b.priority,
          )"
          :key="line.id"
        >
          <td>
            {{ line.provider
            }}<small class="block mono">{{ line.interface }}</small>
          </td>
          <td>
            {{ ACCESS_TYPES[line.access]
            }}<small class="block">{{
              line.bandwidth ? line.bandwidth + " Mbps" : "带宽待填写"
            }}</small>
          </td>
          <td>
            <span class="mono">{{ line.address || "地址待交付" }}</span
            ><small class="block mono">{{
              line.gateway || "网关待交付"
            }}</small>
          </td>
          <td>{{ line.priority }}</td>
          <td>{{ LINK_STATUSES[line.status] }}</td>
          <td class="connectivity-actions-cell">
            <div class="connectivity-actions">
              <button
                :disabled="busy"
                :aria-label="'编辑' + line.provider + '线路'"
                @click="edit('uplink', JSON.parse(JSON.stringify(line)))"
              >
                <Pencil :size="14" />编辑
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="section-heading section-divider">
    <h3>跨网访问规则</h3>
    <button :disabled="busy" @click="addRule">
      <Plus :size="14" />添加互通规则
    </button>
  </div>
  <p class="hint">
    按下表从上到下匹配，首条启用且匹配的规则决定动作；未匹配默认拒绝。规则方向是新建连接的方向，已建立会话回包由现场状态防火墙放行。示例目标
    .10 尚未登记，须按实际服务地址调整。
  </p>
  <div class="table-wrap">
    <table class="policy-table">
      <thead>
        <tr>
          <th>顺序 / 规则</th>
          <th>来源 → 目标</th>
          <th>协议 / 目标端口</th>
          <th>动作 / 规划状态</th>
          <th class="connectivity-actions-cell">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(rule, index) in plan.policies" :key="rule.id">
          <td>
            {{ index + 1 }} · {{ rule.name
            }}<small class="block muted">{{ rule.note }}</small>
          </td>
          <td class="mono">
            {{ rule.source
            }}<small class="block">→ {{ rule.destination }}</small>
          </td>
          <td>
            {{ POLICY_PROTOCOLS[rule.protocol]
            }}<small class="block mono">{{ rule.ports || "不适用" }}</small>
          </td>
          <td>
            {{ rule.action === "allow" ? "允许" : "拒绝"
            }}<small class="block">{{
              rule.enabled ? "启用（规划）" : "停用（规划）"
            }}</small>
          </td>
          <td class="connectivity-actions-cell">
            <div class="connectivity-actions">
              <button
                :disabled="busy"
                :aria-label="'编辑规则 ' + rule.name"
                @click="edit('policy', JSON.parse(JSON.stringify(rule)))"
              >
                <Pencil :size="14" />编辑
              </button>
              <span
                class="rule-order-actions"
                role="group"
                aria-label="调整规则顺序"
                ><button
                  title="上移规则"
                  :disabled="busy || index === 0"
                  :aria-label="'上移规则 ' + rule.name"
                  @click="move(index, -1)"
                >
                  <ArrowUp :size="14" /></button
                ><button
                  title="下移规则"
                  :disabled="busy || index === plan.policies.length - 1"
                  :aria-label="'下移规则 ' + rule.name"
                  @click="move(index, 1)"
                >
                  <ArrowDown :size="14" /></button
              ></span>
              <button
                class="rule-delete"
                title="删除规则"
                :disabled="busy"
                :aria-label="'删除规则 ' + rule.name"
                @click="edit('delete', JSON.parse(JSON.stringify(rule)))"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="5">最后：默认拒绝所有未匹配的跨网新建连接。</td>
        </tr>
      </tbody>
    </table>
  </div>
  <DesktopDialog
    v-if="dialog"
    title-id="connectivity-dialog-title"
    :title="
      dialog === 'uplink'
        ? '编辑运营商线路'
        : dialog === 'delete'
          ? '删除互通规则'
          : '编辑互通规则'
    "
    class="project-dialog"
    :busy="busy"
    @close="dialog = ''"
  >
    <form
      class="project-dialog-form"
      @submit.prevent="
        dialog === 'delete'
          ? update((next) => {
              next.policies = next.policies.filter((r) => r.id !== draft.id);
            })
          : save()
      "
    >
      <div class="dialog-body">
        <FeedbackBanner v-model="error" variant="error" />
        <p v-if="dialog === 'delete'">
          删除「{{ draft.name }}」的规划记录？现场设备配置不会随之改变。
        </p>
        <div v-else-if="dialog === 'uplink'" class="field-grid">
          <label
            >运营商<input
              v-model="draft.provider"
              required
              maxlength="100" /></label
          ><label
            >出口接口<input v-model="draft.interface" required maxlength="100"
          /></label>
          <label
            >接入方式<select v-model="draft.access" aria-label="接入方式">
              <option
                v-for="(label, key) in ACCESS_TYPES"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          ><label
            >带宽（Mbps）<input
              v-model.number="draft.bandwidth"
              type="number"
              min="1"
              max="1000000"
          /></label>
          <label
            >线路 IPv4/CIDR<input
              v-model="draft.address"
              placeholder="按运营商交付填写" /></label
          ><label
            >运营商网关<input
              v-model="draft.gateway"
              placeholder="按运营商交付填写"
          /></label>
          <label
            >线路优先级<input
              v-model.number="draft.priority"
              type="number"
              min="1"
              max="100"
              required /></label
          ><label
            >线路状态<select v-model="draft.status" aria-label="线路状态">
              <option
                v-for="(label, key) in LINK_STATUSES"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label class="full"
            >线路备注<textarea v-model="draft.note" maxlength="1000" rows="3" />
          </label>
        </div>
        <div v-else class="field-grid">
          <label class="full"
            >规则名称<input v-model="draft.name" required maxlength="100"
          /></label>
          <label
            >来源 IPv4/CIDR<input
              v-model="draft.source"
              required
              placeholder="单台设备填写 /32" /></label
          ><label
            >目标 IPv4/CIDR<input
              v-model="draft.destination"
              required
              placeholder="单台设备填写 /32"
          /></label>
          <label
            >协议<select
              v-model="draft.protocol"
              aria-label="协议"
              @change="
                draft.ports = ['tcp', 'udp'].includes(draft.protocol)
                  ? '443'
                  : ''
              "
            >
              <option
                v-for="(label, key) in POLICY_PROTOCOLS"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          ><label
            >目标端口<input
              v-model="draft.ports"
              :disabled="!['tcp', 'udp'].includes(draft.protocol)"
              placeholder="443,8000-8010"
              maxlength="200"
          /></label>
          <label
            >规则动作<select v-model="draft.action" aria-label="规则动作">
              <option value="allow">允许</option>
              <option value="deny">拒绝</option>
            </select></label
          ><label
            >规划状态<select v-model="draft.enabled" aria-label="规划状态">
              <option :value="false">停用</option>
              <option :value="true">启用（仍需现场配置）</option>
            </select></label
          >
          <label class="full"
            >规则说明<textarea v-model="draft.note" maxlength="1000" rows="3" />
          </label>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" :disabled="busy" @click="dialog = ''">取消</button
        ><button type="submit" class="primary" :disabled="busy">
          {{ dialog === "delete" ? "确认删除规则" : "保存规划" }}
        </button>
      </div>
    </form>
  </DesktopDialog>
</template>
