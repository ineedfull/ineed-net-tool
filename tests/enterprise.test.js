import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  enterpriseConnectivity,
  validateConnectivity,
} from "../src/domain/enterprise.js";
import {
  newProject,
  templateNetworks,
  projectExport,
  projectImport,
  emptyWorkspace,
  validateWorkspace,
} from "../src/domain/projects.js";
import { subnet } from "../src/domain/ipv4.js";
import excel from "../electron/excel.cjs";
import storage from "../electron/store.cjs";
function fixture(internal = "10.60.0.0/16", external = "10.80.0.0/16") {
  const project = newProject("enterprise", "大型园区");
  const networks = templateNetworks(
    "enterprise-dual",
    internal,
    project.id,
    undefined,
    { externalBase: external },
  );
  project.connectivity = enterpriseConnectivity(internal, external, networks);
  return { project, networks };
}
test("enterprise template partitions independent private networks and reserves only gateways", () => {
  const { project, networks } = fixture();
  assert.equal(networks.length, 8);
  assert.equal(networks.filter((n) => n.name.startsWith("内网")).length, 4);
  for (let i = 0; i < networks.length; i++) {
    const a = subnet(networks[i].cidr);
    assert.equal(networks[i].allocations.length, 1);
    assert.equal(networks[i].allocations[0].status, "reserved");
    for (const next of networks.slice(i + 1)) {
      const b = subnet(next.cidr);
      assert.ok(a.last < b.first || b.last < a.first);
    }
  }
  assert.deepEqual(
    project.connectivity.uplinks.map((u) => u.provider),
    ["中国电信", "中国联通", "中国移动"],
  );
  assert.ok(
    project.connectivity.uplinks.every(
      (u) => u.address === "" && u.gateway === "" && u.status === "planned",
    ),
  );
  assert.ok(project.connectivity.policies.every((p) => !p.enabled));
  validateWorkspace({
    ...emptyWorkspace(),
    projects: [project],
    activeProjectId: project.id,
    networks,
  });
  const custom = fixture("172.16.0.0/16", "172.20.0.0/16");
  assert.match(custom.project.connectivity.policies[0].source, /^172\.16\./);
  assert.match(
    custom.project.connectivity.policies[0].destination,
    /^172\.20\./,
  );
});
test("enterprise template rejects overlapping, public and insufficient address spaces", () => {
  for (const [inside, outside] of [
    ["10.60.0.0/16", "10.60.4.0/24"],
    ["8.8.0.0/16", "10.80.0.0/16"],
    ["10.60.0.0/24", "10.80.0.0/16"],
    ["10.60.0.0/16", "10.80.0.0/24"],
  ])
    assert.throws(() => fixture(inside, outside));
});
test("policy validation rejects wrong directions, invalid ports and duplicate WAN priorities", () => {
  for (const mutate of [
    (p) => {
      p.policies[0].destination = "10.60.4.10/32";
    },
    (p) => {
      p.policies[0].destination = "0.0.0.0/0";
    },
    (p) => {
      p.policies[0].ports = "0,443";
    },
    (p) => {
      p.policies[0].ports = "9000-8000";
    },
    (p) => {
      p.policies[0].protocol = "icmp";
    },
    (p) => {
      p.policies[0].enabled = "true";
    },
    (p) => {
      p.uplinks[1].priority = 1;
    },
    (p) => {
      p.uplinks[1].interface = "WAN1";
    },
    (p) => {
      p.uplinks[0].address = "invalid";
    },
  ]) {
    const plan = fixture().project.connectivity;
    mutate(plan);
    assert.throws(() => validateConnectivity(plan));
  }
  const plan = fixture().project.connectivity;
  plan.policies[0].ports = "443,8000-8010";
  plan.policies[0].enabled = true;
  plan.policies[1].protocol = "icmp";
  plan.policies[1].ports = "";
  validateConnectivity(plan);
});
test("SQLite, project import and Excel retain dual-network architecture and rule order", async (t) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nettool-enterprise-"),
  );
  const store = new storage.Store(folder);
  t.after(async () => {
    store.close();
    await fs.rm(folder, { recursive: true, force: true });
  });
  const { project, networks } = fixture();
  project.connectivity.policies.reverse();
  project.connectivity.policies[0].enabled = true;
  project.connectivity.uplinks[0].bandwidth = 1000;
  await store.load();
  await store.update((s) => ({
    ...s,
    projects: [project],
    networks,
    activeProjectId: project.id,
  }));
  store.close();
  const state = await store.load();
  assert.deepEqual(state.projects[0].connectivity, project.connectivity);
  const copied = projectImport(projectExport(project, networks));
  assert.notEqual(copied.project.id, project.id);
  assert.deepEqual(copied.project.connectivity, project.connectivity);
  const file = path.join(folder, "plan.xlsx");
  const wb = await excel.projectWorkbook(project, networks);
  await wb.xlsx.writeFile(file);
  const imported = await excel.readProjectWorkbook(file);
  assert.deepEqual(imported.errors, []);
  const stripIds = (plan) => ({
    ...plan,
    uplinks: plan.uplinks.map(({ id, ...u }) => u),
    policies: plan.policies.map(({ id, ...p }) => p),
  });
  assert.deepEqual(
    stripIds(imported.project.connectivity),
    stripIds(project.connectivity),
  );
  wb.getWorksheet("互通策略").getCell("C2").value = "0.0.0.0/0";
  await wb.xlsx.writeFile(file);
  assert.match(
    (await excel.readProjectWorkbook(file)).errors.join(),
    /来源和目标/,
  );
  const template = await excel.templateWorkbook();
  assert.deepEqual(
    template.worksheets.map((sheet) => sheet.name).sort(),
    [
      "填写说明",
      "项目",
      "网段",
      "IP台账",
      "维护记录",
      "互联架构",
      "运营商线路",
      "互通策略",
      "场地位置",
      "业务需求",
      "接入容量",
      "容量校核",
      "工程设备",
      "设备接口",
      "接口连接",
      "接口占用",
      "PoE电源预算",
      "PoE负载",
      "上联参数",
      "上联业务",
      "PoE带宽校核",
      "验收清单",
      "验收结果",
      "整改复验",
      "现场验收报告",
      "端口逻辑配置",
      "VLAN配置校核",
    ].sort(),
  );
  await template.xlsx.writeFile(file);
  const legacy = await excel.readProjectWorkbook(file);
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.project.connectivity, undefined);
  assert.equal(legacy.project.engineering?.infrastructure, undefined);
});
