<script setup>
defineProps({ report: Object, locationPath: Function });
defineEmits(["edit", "issue"]);
const value = (n) => (n === null ? "待补充" : n);
const status = (s) =>
  ({ ok: "容量充足", pending: "待补充", risk: "容量不足" })[s];
</script>
<template>
  <section class="engineering-report">
    <h3>
      容量校核
      <span v-if="report.enabled" class="badge">{{
        status(report.status)
      }}</span>
    </h3>
    <p v-if="!report.enabled" class="hint">
      尚未启用工程检查，添加位置或需求后开始校核。
    </p>
    <div v-if="report.demands.length" class="table-wrap">
      <table class="engineering-demands">
        <thead>
          <tr>
            <th>需求 / 区域</th>
            <th>数量与预留依据</th>
            <th>地址 / 端口</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in report.demands" :key="d.id">
            <td>
              {{ d.name }}
              <p class="hint">{{ locationPath(d.locationId) }}</p>
            </td>
            <td v-if="d.count !== null">
              {{ d.count }} + ceil({{ d.count }} × {{ d.growthPercent }} / 100)
              = {{ d.plannedCount }}
              <p class="hint">
                预留 {{ d.reserveCount }}；每单位地址 {{ d.addressesPerUnit }} /
                端口 {{ d.portsPerUnit }}
              </p>
            </td>
            <td v-else>待补充</td>
            <td>
              {{ value(d.addressDemand) }} / {{ value(d.portDemand) }}
              <p v-if="d.plannedCount !== null" class="hint">
                地址 {{ d.plannedCount }} × {{ d.addressesPerUnit }} =
                {{ d.addressDemand }}；端口 {{ d.plannedCount }} ×
                {{ d.portsPerUnit }} = {{ d.portDemand }}
              </p>
            </td>
            <td>
              <button
                :aria-label="'编辑需求 ' + d.name"
                @click="$emit('edit', d)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="report.locations.length" class="table-wrap">
      <table class="engineering-capacities">
        <thead>
          <tr>
            <th>区域</th>
            <th>端口需求</th>
            <th>可用端口</th>
            <th>剩余</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in report.locations" :key="l.locationId">
            <td>{{ locationPath(l.locationId) }}</td>
            <td>
              {{ l.unknownDemandCount ? "已知小计 " : "" }}{{ l.requiredPorts }}
            </td>
            <td>{{ value(l.accessPorts) }}</td>
            <td>{{ value(l.remainingPorts) }}</td>
            <td>{{ status(l.status) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-for="n in report.networks" :key="n.networkId" class="table-wrap">
      <h4>{{ n.name }} · {{ n.cidr }} · {{ status(n.status) }}</h4>
      <table>
        <thead>
          <tr>
            <th>地址类型</th>
            <th>{{ n.unknownDemandCount ? "已知需求小计" : "需求" }}</th>
            <th>容量</th>
            <th>剩余</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>总地址（含实际网关）</td>
            <td>{{ n.requiredAddresses }}</td>
            <td>{{ n.totalCapacity }}</td>
            <td>{{ value(n.remainingAddresses) }}</td>
          </tr>
          <tr>
            <td>DHCP</td>
            <td>{{ n.dhcpDemand }}</td>
            <td>{{ value(n.dhcpCapacity) }}</td>
            <td>{{ value(n.remainingDhcp) }}</td>
          </tr>
          <tr>
            <td>静态</td>
            <td>{{ n.staticDemand }}</td>
            <td>{{ n.staticCapacity }}</td>
            <td>{{ value(n.remainingStatic) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="hint">
        网关占 {{ n.gatewayAddresses }} 个地址；已登记
        {{ n.registeredAddresses }} 个仅作台账参考，不叠加目标规模。
      </p>
    </div>
    <ul v-if="report.issues.length" class="engineering-issues">
      <li v-for="(issue, i) in report.issues" :key="i">
        <button @click="$emit('issue', issue)">
          {{ status(issue.severity) }} · {{ issue.message }}
        </button>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.engineering-report {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.engineering-issues {
  padding-left: 20px;
}
.engineering-issues button {
  text-align: left;
  white-space: normal;
  height: auto;
  margin-bottom: 6px;
}
.engineering-demands td:last-child {
  position: sticky;
  right: 0;
  background: var(--surface);
}
.engineering-demands td {
  overflow-wrap: anywhere;
}
</style>
