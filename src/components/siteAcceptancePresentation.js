// Display labels shared by the acceptance list and dialog.
export const methods = {
  manual: "人工检查",
  ping: "Ping",
  ports: "端口扫描",
  quality: "链路质量",
};
export const targets = {
  project: "项目",
  device: "设备",
  interface: "接口",
  link: "连接",
};
export const outcomes = { passed: "通过", failed: "未通过", inconclusive: "无法判定" };
export const states = {
  pending: "待验收",
  failed: "未通过",
  rectifying: "整改中",
  passed: "通过",
  ok: "全部通过",
  risk: "存在风险",
};
export const names = {
  item: "检查项",
  result: "结果",
  action: "整改",
  resolve: "整改闭环",
  detail: "结果详情",
};
