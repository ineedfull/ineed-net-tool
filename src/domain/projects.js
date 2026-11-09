import { ipNumber, ipText, subnet, validateGateway } from "./ipv4.js";
import {
  ENTERPRISE_TEMPLATE,
  dualSpaces,
  privateSpace,
  validateConnectivity,
} from "./enterprise.js";
import { validateNetworks } from "./workspace.js";
import { validateEngineering, remapEngineering } from "./engineering.js";

export const DEFAULT_PROJECT_ID = "default-project";
export const PROJECT_STATUSES = {
  planning: "规划中",
  active: "使用中",
  archived: "已归档",
};
export const DEVICE_TYPES = {
  computer: "办公终端",
  camera: "摄像机",
  recorder: "录像机 / NVR",
  switch: "交换机",
  router: "路由器 / 网关",
  ap: "无线 AP",
  printer: "打印机",
  server: "服务器",
  other: "其他设备",
};
export const ADDRESS_STATUSES = {
  reserved: "预留",
  assigned: "在用",
  maintenance: "检修",
};
export const newProject = (id, name) => ({
  id,
  name,
  customer: "",
  site: "",
  owner: "",
  note: "",
  status: "planning",
  maintenance: [],
});
export function emptyWorkspace() {
  return {
    version: 2,
    projects: [newProject(DEFAULT_PROJECT_ID, "默认项目")],
    activeProjectId: DEFAULT_PROJECT_ID,
    networks: [],
    settings: { theme: "light", largeFont: false, ipView: "table" },
    history: [],
  };
}
function text(value, max, label, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${label}无效或过长`);
}
export function validateProjects(projects) {
  if (!Array.isArray(projects) || !projects.length || projects.length > 100)
    throw new Error("请保留 1～100 个项目");
  const ids = new Set();
  for (const p of projects) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      /[\x00-\x1f]/.test(p.id) ||
      p.id.length > 100 ||
      ids.has(p.id)
    )
      throw new Error("项目标识无效或重复");
    ids.add(p.id);
    text(p.name, 100, "项目名称", true);
    for (const key of ["customer", "site", "owner"])
      text(p[key], 200, "项目信息");
    text(p.note, 2000, "项目备注");
    validateConnectivity(p.connectivity);
    if (p.engineering !== undefined) validateEngineering(p.engineering);
    if (!Object.hasOwn(PROJECT_STATUSES, p.status))
      throw new Error("项目状态无效");
    if (!Array.isArray(p.maintenance) || p.maintenance.length > 500)
      throw new Error("每个项目最多保存 500 条维护记录");
    const logs = new Set();
    for (const log of p.maintenance) {
      if (
        !log ||
        typeof log.id !== "string" ||
        !log.id ||
        log.id.length > 100 ||
        /[\x00-\x1f]/.test(log.id) ||
        logs.has(log.id)
      )
        throw new Error("维护记录标识无效");
      logs.add(log.id);
      text(log.content, 2000, "维护内容", true);
      text(log.owner, 200, "维护负责人");
      if (
        !["pending", "done"].includes(log.status) ||
        typeof log.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(log.date) ||
        !Number.isFinite(Date.parse(log.date)) ||
        new Date(log.date).toISOString().slice(0, 10) !== log.date
      )
        throw new Error("维护日期或状态无效");
    }
  }
  return projects;
}
export function validateWorkspace(state) {
  if (!state || state.version !== 2) throw new Error("不支持的工作区版本");
  validateProjects(state.projects);
  const ids = new Set(state.projects.map((p) => p.id));
  if (!ids.has(state.activeProjectId)) throw new Error("当前项目不存在");
  validateNetworks(state.networks);
  for (const n of state.networks)
    if (!ids.has(n.projectId)) throw new Error("网段必须属于一个有效项目");
  const projectNetworks = new Map();
  for (const network of state.networks) {
    if (!projectNetworks.has(network.projectId))
      projectNetworks.set(network.projectId, []);
    projectNetworks.get(network.projectId).push(network);
  }
  for (const project of state.projects)
    if (project.engineering !== undefined)
      validateEngineering(
        project.engineering,
        projectNetworks.get(project.id) ?? [],
      );
  validateAddressScope(state.networks);
  if (
    !state.settings ||
    !["light", "dark", "system"].includes(state.settings.theme) ||
    typeof state.settings.largeFont !== "boolean"
  )
    throw new Error("外观设置无效");
  if (
    state.settings.ipView !== undefined &&
    !["table", "compact"].includes(state.settings.ipView)
  )
    throw new Error("IP 默认显示方式无效");
  if (
    !Array.isArray(state.history) ||
    state.history.length > 100 ||
    state.history.some(
      (h) => !h || typeof h !== "object" || !ids.has(h.projectId),
    )
  )
    throw new Error("诊断历史或项目归属无效");
  const historyIds = new Set();
  for (const h of state.history) {
    if (
      typeof h.id !== "string" ||
      !h.id ||
      h.id.length > 100 ||
      historyIds.has(h.id)
    )
      throw new Error("诊断记录标识无效或重复");
    historyIds.add(h.id);
  }
  return state;
}
export function validateAddressScope(networks) {
  const scopes = new Map();
  for (const n of networks) {
    const key = JSON.stringify([n.projectId, n.vlan || ""]);
    if (!scopes.has(key))
      scopes.set(key, { addresses: new Set(), pools: [], allocations: [] });
    const scope = scopes.get(key);
    if (n.dhcpStart && n.dhcpEnd)
      scope.pools.push([ipNumber(n.dhcpStart), ipNumber(n.dhcpEnd)]);
    for (const a of n.allocations) {
      if (scope.addresses.has(a.ip))
        throw new Error(`同一项目和 VLAN 内的地址 ${a.ip} 已登记在其他网段`);
      scope.addresses.add(a.ip);
      scope.allocations.push(a.ip);
    }
  }
  for (const scope of scopes.values())
    for (const ip of scope.allocations) {
      const value = ipNumber(ip);
      if (scope.pools.some(([first, last]) => value >= first && value <= last))
        throw new Error(
          `静态登记地址 ${ip} 占用了同一项目和 VLAN 的 DHCP 动态地址池`,
        );
    }
}
export function normalizeWorkspace(value) {
  if (!value || ![1, 2].includes(value.version))
    throw new Error("不支持或损坏的数据格式");
  const state = structuredClone(value);
  if (state.version === 1) {
    if (!Array.isArray(state.networks) || !Array.isArray(state.history))
      throw new Error("不支持或损坏的数据格式");
    state.version = 2;
    state.projects = [newProject(DEFAULT_PROJECT_ID, "默认项目")];
    state.activeProjectId = DEFAULT_PROJECT_ID;
    state.networks = state.networks.map((n) => ({
      ...n,
      projectId: DEFAULT_PROJECT_ID,
    }));
    state.history = state.history.map((h) => ({
      ...h,
      projectId: DEFAULT_PROJECT_ID,
    }));
  }
  if (state.settings && state.settings.ipView === undefined)
    state.settings.ipView = "table";
  return validateWorkspace(state);
}
export function applyWorkspacePatch(state, patch) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.keys(patch).some(
      (k) =>
        !["projects", "networks", "settings", "activeProjectId"].includes(k),
    )
  )
    throw new Error("无效的保存数据");
  return validateWorkspace({ ...state, ...patch });
}
export function projectExport(project, networks) {
  return {
    kind: "ineed-nettool-project",
    version: 1,
    project: structuredClone(project),
    networks: structuredClone(
      networks.filter((n) => n.projectId === project.id),
    ),
  };
}
export function projectImport(data, uuid = () => crypto.randomUUID()) {
  if (
    data?.kind !== "ineed-nettool-project" ||
    data.version !== 1 ||
    !data.project
  )
    throw new Error("请选择 NetTool 项目导出文件");
  validateWorkspace({
    ...emptyWorkspace(),
    projects: [data.project],
    activeProjectId: data.project.id,
    networks: data.networks,
  });
  const project = {
    ...structuredClone(data.project),
    id: uuid(),
    maintenance: data.project.maintenance.map((log) => ({
      ...log,
      id: uuid(),
    })),
  };
  const networks = data.networks.map((n) => ({
    ...structuredClone(n),
    id: uuid(),
    projectId: project.id,
  }));
  if (project.engineering !== undefined)
    project.engineering = remapEngineering(
      project.engineering,
      new Map(
        data.networks.map((network, index) => [network.id, networks[index].id]),
      ),
      uuid,
    );
  return { project, networks };
}
export function nextAvailableAddress(network, networks = [network]) {
  const net = subnet(network.cidr);
  const scope = networks.filter(
    (n) =>
      n.projectId === network.projectId &&
      (n.vlan || "") === (network.vlan || ""),
  );
  const occupied = scope.flatMap((n) => [
    ...n.allocations.map((a) => [ipNumber(a.ip), ipNumber(a.ip)]),
    ...(n.gateway ? [[ipNumber(n.gateway), ipNumber(n.gateway)]] : []),
    ...(n.dhcpStart && n.dhcpEnd
      ? [[ipNumber(n.dhcpStart), ipNumber(n.dhcpEnd)]]
      : []),
  ]);
  occupied.sort((a, b) => a[0] - b[0]);
  let candidate = ipNumber(net.start);
  for (const [first, last] of occupied) {
    if (first > candidate) break;
    if (last >= candidate) candidate = last + 1;
  }
  return candidate <= ipNumber(net.end) ? ipText(candidate) : "";
}
export function registerAddresses(
  network,
  networks,
  entry,
  count = 1,
  editingIp = "",
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 128 ||
    (editingIp && count !== 1)
  )
    throw new Error("每次登记 1～128 个地址，编辑时仅支持单条");
  const next = {
    ...network,
    allocations: network.allocations.filter((a) => a.ip !== editingIp),
  };
  const others = networks.filter((n) => n.id !== network.id);
  for (let index = 0; index < count; index++) {
    const ip =
      count === 1 ? entry.ip : nextAvailableAddress(next, [...others, next]);
    if (!ip) throw new Error("当前网段没有足够的可登记地址");
    next.allocations.push({
      ...entry,
      ip,
      label: count === 1 ? entry.label : `${entry.label} ${index + 1}`,
    });
  }
  const result = networks.map((n) => (n.id === network.id ? next : n));
  validateNetworks(result);
  validateAddressScope(result);
  return result;
}
export const NETWORK_TEMPLATES = [
  ENTERPRISE_TEMPLATE,
  {
    id: "office-small",
    name: "小型办公室",
    description: "一个网段管理办公终端、打印机和无线设备，适合小团队。",
    base: "192.168.10.0/24",
    networks: [
      {
        name: "办公网络",
        prefix: 24,
        vlan: 10,
        dhcp: [100, 199],
        note: "终端使用 DHCP；网关、打印机、AP 等设备登记静态地址。",
      },
    ],
  },
  {
    id: "office-zones",
    name: "办公分区网络",
    description: "办公、访客、服务器和网络管理分别规划，适合多部门办公室。",
    base: "10.10.0.0/22",
    networks: [
      {
        name: "办公终端",
        prefix: 24,
        vlan: 10,
        dhcp: [50, 199],
        note: "办公电脑与公司无线终端。",
      },
      {
        name: "访客无线",
        prefix: 24,
        vlan: 20,
        dhcp: [10, 239],
        note: "建议仅允许访问互联网，具体隔离需配置交换机与防火墙。",
      },
      {
        name: "服务器与打印",
        prefix: 24,
        vlan: 30,
        note: "NAS、业务服务器、打印机等固定地址设备。",
      },
      {
        name: "网络管理",
        prefix: 24,
        vlan: 99,
        note: "交换机、AP 与网关管理地址。",
      },
    ],
  },
  {
    id: "surveillance",
    name: "视频监控",
    description: "摄像机、录像存储和管理设备分区，适合园区、办公楼和商铺监控。",
    base: "10.20.0.0/22",
    networks: [
      {
        name: "摄像机网络",
        prefix: 23,
        vlan: 110,
        note: "摄像机按点位登记静态地址，记录楼层、安装位置及维护人。",
      },
      {
        name: "录像与存储",
        prefix: 24,
        vlan: 120,
        note: "NVR 与存储服务器，预留扩展空间。",
      },
      {
        name: "监控管理",
        prefix: 24,
        vlan: 199,
        note: "管理工作站、交换机与运维设备。",
      },
    ],
  },
];
export function templateNetworks(
  templateId,
  baseCidr,
  projectId,
  uuid = () => crypto.randomUUID(),
  options = {},
) {
  const template = NETWORK_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error("场景模板不存在");
  const parents = template.externalBase
    ? dualSpaces(baseCidr, options.externalBase ?? template.externalBase)
    : { internal: privateSpace(baseCidr) };
  const cursors = Object.fromEntries(
    Object.entries(parents).map(([zone, net]) => [zone, net.first]),
  );
  return template.networks.map((rule) => {
    const zone = rule.zone || "internal";
    const parent = parents[zone];
    let cursor = cursors[zone];
    const size = 2 ** (32 - rule.prefix);
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size - 1 > parent.last)
      throw new Error("地址空间不足，请扩大项目网段");
    const net = subnet(`${ipText(cursor)}/${rule.prefix}`);
    const gateway = net.start;
    validateGateway(gateway, net.cidr);
    const result = {
      id: uuid(),
      projectId,
      name: rule.name,
      cidr: net.cidr,
      gateway,
      vlan: rule.vlan,
      note: rule.note,
      dhcpStart: rule.dhcp ? ipText(cursor + rule.dhcp[0]) : "",
      dhcpEnd: rule.dhcp ? ipText(cursor + rule.dhcp[1]) : "",
      allocations: [
        {
          ip: gateway,
          label: "网关（规划预留）",
          type: "router",
          status: "reserved",
          location: "",
          owner: "",
          mac: "",
          note: "请根据现场配置核实此网关地址。",
        },
      ],
    };
    cursors[zone] = cursor + size;
    return result;
  });
}
