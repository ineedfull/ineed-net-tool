// Optional registered switch configuration; independent of physical interface role.
export function validatePortConfiguration(config, networks) {
  const fail = (message) => {
    throw Error(`逻辑端口配置：${message}`);
  };
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    config.version !== 1
  )
    fail("不支持的版本或格式");
  if (!["access", "trunk"].includes(config.mode))
    fail("模式必须为 Access 或 Trunk");
  const vlan = (value) =>
    Number.isInteger(value) && value >= 1 && value <= 4094;
  if (config.accessVlan !== null && !vlan(config.accessVlan))
    fail("Access VLAN 必须为1～4094整数或未知");
  if (
    config.allowedVlans !== null &&
    (!Array.isArray(config.allowedVlans) ||
      config.allowedVlans.length > 4094 ||
      config.allowedVlans.some((v) => !vlan(v)) ||
      new Set(config.allowedVlans).size !== config.allowedVlans.length)
  )
    fail("允许 VLAN 必须为不重复的1～4094整数列表或未知");
  if (
    !Array.isArray(config.networkIds) ||
    config.networkIds.length > 128 ||
    new Set(config.networkIds).size !== config.networkIds.length ||
    config.networkIds.some(
      (id) =>
        typeof id !== "string" ||
        !id.trim() ||
        id.length > 100 ||
        /[\x00-\x1f\x7f-\x9f]/.test(id),
    )
  )
    fail("业务网段引用无效、重复或超过128条");
  if (config.mode === "access" && config.networkIds.length > 1)
    fail("Access 最多关联一个网段");
  if (networks !== undefined) {
    const ids = new Set(networks.map((n) => n.id));
    if (config.networkIds.some((id) => !ids.has(id)))
      fail("引用网段不属于本项目；请先解除逻辑端口关联");
  }
  return config;
}
