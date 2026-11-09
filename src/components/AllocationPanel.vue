<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, inject, reactive, ref } from "vue";
import AddressMap from "./AddressMap.vue";
import IpViewToggle from "./IpViewToggle.vue";
import { IP_DISPLAY } from "../ip-display.js";
import DesktopDialog from "./DesktopDialog.vue";
import {
  ADDRESS_STATUSES,
  DEVICE_TYPES,
  nextAvailableAddress,
  registerAddresses,
} from "../domain/projects.js";
const props = defineProps({
  networks: Array,
  saveNetworks: Function,
  fixedNetwork: String,
});
const emit = defineEmits(["navigate"]);
const display = inject(IP_DISPLAY);
const search = ref("");
const status = ref("");
const networkFilter = ref("");
const show = ref(false);
const busy = ref(false);
const error = ref("");
const editingIp = ref("");
const netId = ref("");
const count = ref(1);
const entry = reactive({});
const selected = computed(() =>
  props.networks.find((n) => n.id === netId.value),
);
const rows = computed(() =>
  props.networks
    .filter((n) => !props.fixedNetwork || n.id === props.fixedNetwork)
    .filter((n) => !networkFilter.value || n.id === networkFilter.value)
    .flatMap((n) => n.allocations.map((a) => ({ ...a, network: n })))
    .filter(
      (a) =>
        (!status.value || (a.status || "assigned") === status.value) &&
        [a.ip, a.label, a.location, a.owner, a.mac, a.note, a.network.name]
          .join(" ")
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    ),
);
function open(network, allocation, initialIp = "") {
  error.value = "";
  netId.value =
    network?.id ||
    props.fixedNetwork ||
    networkFilter.value ||
    props.networks[0]?.id ||
    "";
  editingIp.value = allocation?.ip || "";
  count.value = 1;
  Object.assign(
    entry,
    {
      ip: initialIp,
      label: "",
      type: "other",
      status: "assigned",
      location: "",
      owner: "",
      mac: "",
      note: "",
    },
    allocation || {},
  );
  show.value = true;
}
function registerCell(cell) {
  open(cell.network, undefined, cell.ip);
  if (cell.gateway) {
    entry.type = "router";
    entry.status = "reserved";
  }
}
function suggest() {
  entry.ip = selected.value
    ? nextAvailableAddress(selected.value, props.networks)
    : "";
}
async function save() {
  busy.value = true;
  error.value = "";
  try {
    if (!selected.value) throw new Error("请先选择网段");
    const normalized = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key, String(value).trim()]),
    );
    normalized.mac = count.value === 1 ? normalized.mac.toUpperCase() : "";
    await props.saveNetworks(
      registerAddresses(
        selected.value,
        props.networks,
        normalized,
        Number(count.value),
        editingIp.value,
      ),
    );
    show.value = false;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function remove(row) {
  if (!window.confirm(`移除 ${row.ip} 的登记记录？设备本身不会被修改。`))
    return;
  try {
    await props.saveNetworks(
      props.networks.map((n) =>
        n.id === row.network.id
          ? { ...n, allocations: n.allocations.filter((a) => a.ip !== row.ip) }
          : n,
      ),
    );
  } catch (e) {
    error.value = e.message;
  }
}
</script>
<template>
  <div class="section-heading">
    <div>
      <h2>
        IP 地址台账 <span class="count">{{ rows.length }}</span>
      </h2>
      <p class="hint">预留、在用、检修是登记状态，与实时在线状态分别管理。</p>
    </div>
    <div class="actions">
      <IpViewToggle
        :model-value="display.view.value"
        @update:model-value="display.setView"
      /><button class="primary" :disabled="!networks.length" @click="open()">
        登记地址
      </button>
    </div>
  </div>
  <FeedbackBanner v-if="!show" v-model="error" variant="error" />
  <div class="form-row">
    <label class="grow"
      >搜索台账<input v-model="search" placeholder="IP、设备、位置、负责人…"
    /></label>
    <label v-if="!fixedNetwork"
      >筛选网段<select aria-label="筛选网段" v-model="networkFilter">
        <option value="">全部网段</option>
        <option v-for="n in networks" :key="n.id" :value="n.id">
          {{ n.name }}
        </option>
      </select></label
    >
    <label
      >筛选登记状态<select aria-label="筛选登记状态" v-model="status">
        <option value="">全部状态</option>
        <option
          v-for="(label, key) in ADDRESS_STATUSES"
          :key="key"
          :value="key"
        >
          {{ label }}
        </option>
      </select></label
    >
  </div>
  <AddressMap
    v-if="display.view.value === 'compact'"
    :networks="networks"
    :visible-networks="
      networks.filter(
        (n) =>
          (!fixedNetwork || n.id === fixedNetwork) &&
          (!networkFilter || n.id === networkFilter),
      )
    "
    :search="search"
    :allocation-status="status"
    @register="registerCell"
    @edit="(cell) => open(cell.network, cell.allocation)"
    @remove="remove"
    @navigate="(kind, ip) => emit('navigate', kind, ip)"
  />
  <div v-else-if="!rows.length" class="empty">
    <strong>{{
      networks.length ? "暂无匹配的地址登记" : "先规划一个网段"
    }}</strong>
    <p>可以从场景模板创建项目，再逐步登记现场设备。</p>
  </div>
  <div v-else class="table-wrap ledger-scroll">
    <table class="ledger-table">
      <thead>
        <tr>
          <th>IP / 网段</th>
          <th>设备 / 类型</th>
          <th>状态</th>
          <th>位置 / 负责人</th>
          <th>MAC / 备注</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.network.id + row.ip">
          <td>
            <code>{{ row.ip }}</code
            ><small class="block muted"
              >{{ row.network.name }} · VLAN
              {{ row.network.vlan || "—" }}</small
            >
          </td>
          <td>
            {{ row.label || "未命名设备"
            }}<small class="block muted">{{
              DEVICE_TYPES[row.type || "other"]
            }}</small>
          </td>
          <td>
            <span
              :class="[
                'badge',
                row.status === 'maintenance'
                  ? 'red'
                  : row.status === 'reserved'
                    ? 'blue'
                    : 'green',
              ]"
              >{{ ADDRESS_STATUSES[row.status || "assigned"] }}</span
            >
          </td>
          <td>
            {{ row.location || "—"
            }}<small class="block muted">{{
              row.owner || "未指定负责人"
            }}</small>
          </td>
          <td>
            <small class="block mono">{{ row.mac || "—" }}</small
            ><small class="block muted">{{ row.note }}</small>
          </td>
          <td>
            <div class="actions">
              <button @click="emit('navigate', 'ping', row.ip)">Ping</button
              ><button
                :aria-label="'编辑地址 ' + row.ip"
                @click="
                  open(row.network, {
                    ip: row.ip,
                    label: row.label,
                    type: row.type || 'other',
                    status: row.status || 'assigned',
                    location: row.location || '',
                    owner: row.owner || '',
                    mac: row.mac || '',
                    note: row.note || '',
                  })
                "
              >
                编辑</button
              ><button
                class="danger"
                :aria-label="'移除地址 ' + row.ip"
                @click="remove(row)"
              >
                移除
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <DesktopDialog
    v-if="show"
    :title="editingIp ? '编辑地址登记' : '登记 IP 地址'"
    title-id="allocation-title"
    :busy="busy"
    @close="show = false"
  >
    <form class="project-dialog-form" @submit.prevent="save">
      <div class="dialog-body">
        <FeedbackBanner v-model="error" variant="error" />
        <div class="field-grid">
          <label class="full"
            >登记网段<select
              aria-label="登记网段"
              v-model="netId"
              :disabled="!!editingIp || !!fixedNetwork"
              @change="entry.ip = ''"
            >
              <option v-for="n in networks" :key="n.id" :value="n.id">
                {{ n.name }} · {{ n.cidr }}
              </option>
            </select></label
          >
          <label
            >登记数量<input
              v-model.number="count"
              type="number"
              min="1"
              max="128"
              :disabled="!!editingIp"
          /></label>
          <label
            >设备类型<select aria-label="设备类型" v-model="entry.type">
              <option
                v-for="(label, key) in DEVICE_TYPES"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label v-if="count === 1"
            >IPv4 地址<input
              v-model="entry.ip"
              aria-label="分配 IPv4 地址"
              class="mono"
              required
          /></label>
          <div v-if="count === 1" class="field-action">
            <button type="button" @click="suggest">建议空闲地址</button>
          </div>
          <p v-else class="hint full">
            按可用地址从小到大分配，自动跳过已登记地址、网关及 DHCP
            池；设备名称后附加序号。一次最多 128 条。
          </p>
          <label
            >设备名称<input
              v-model="entry.label"
              aria-label="设备说明"
              maxlength="200"
          /></label>
          <label
            >登记状态<select aria-label="登记状态" v-model="entry.status">
              <option
                v-for="(label, key) in ADDRESS_STATUSES"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            >安装位置<input
              v-model="entry.location"
              maxlength="200"
              placeholder="例如：一楼大厅东侧"
          /></label>
          <label>负责人<input v-model="entry.owner" maxlength="200" /></label>
          <label v-if="count === 1" class="full"
            >MAC 地址<input
              v-model="entry.mac"
              placeholder="AA:BB:CC:DD:EE:FF（可选）"
              maxlength="17"
          /></label>
          <label class="full"
            >登记备注<textarea v-model="entry.note" rows="2" maxlength="1000" />
          </label>
        </div>
      </div>
      <footer class="dialog-footer">
        <span class="muted">登记台账，不会修改设备配置</span
        ><button type="button" :disabled="busy" @click="show = false">
          取消</button
        ><button class="primary" :disabled="busy">
          {{ busy ? "正在保存…" : "保存登记" }}
        </button>
      </footer>
    </form>
  </DesktopDialog>
</template>
