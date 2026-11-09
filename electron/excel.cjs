const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs/promises");
const TEMPLATE = path.join(__dirname, "templates", "NetTool-网络项目模板.xlsx");
const infrastructureExcel = require("./infrastructure-excel.cjs");
const capacityExcel = require("./capacity-planning-excel.cjs");
const acceptanceExcel = require("./site-acceptance-excel.cjs");
const engineeringExcel = require("./engineering-excel.cjs");
const topologyExcel = require("./topology-excel.cjs");
const enums = async () => import("../src/domain/projects.js");
const schema = async () => {
  const {
    EXCEL_SCHEMA,
    CONNECTIVITY_EXCEL_SCHEMA,
    ENGINEERING_EXCEL_SCHEMA,
    INFRASTRUCTURE_EXCEL_SCHEMA,
    CAPACITY_PLANNING_EXCEL_SCHEMA,
    SITE_ACCEPTANCE_EXCEL_SCHEMA,
    TOPOLOGY_EXCEL_SCHEMA,
  } = await import("../src/domain/excel-schema.js");
  return [
    ...EXCEL_SCHEMA,
    ...CONNECTIVITY_EXCEL_SCHEMA,
    ...ENGINEERING_EXCEL_SCHEMA,
    ...INFRASTRUCTURE_EXCEL_SCHEMA,
    ...CAPACITY_PLANNING_EXCEL_SCHEMA,
    ...SITE_ACCEPTANCE_EXCEL_SCHEMA,
    ...TOPOLOGY_EXCEL_SCHEMA,
  ];
};

async function projectWorkbook(project, networks) {
  const { PROJECT_STATUSES, DEVICE_TYPES, ADDRESS_STATUSES } = await enums();
  const { ACCESS_TYPES, LINK_STATUSES, POLICY_PROTOCOLS } =
    await import("../src/domain/enterprise.js");
  const specs = await schema();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE);
  const networkCodes = new Map(
    networks.map((n, i) => [n.id, `N${String(i + 1).padStart(3, "0")}`]),
  );
  const data = [
    [
      [
        project.name,
        project.customer,
        project.site,
        project.owner,
        PROJECT_STATUSES[project.status],
        project.note,
      ],
    ],
    networks.map((n) => [
      networkCodes.get(n.id),
      n.name,
      n.cidr,
      n.vlan || "",
      n.gateway || "",
      n.dhcpStart || "",
      n.dhcpEnd || "",
      n.note,
    ]),
    networks.flatMap((n) =>
      n.allocations.map((a) => [
        networkCodes.get(n.id),
        a.ip,
        a.label,
        DEVICE_TYPES[a.type || "other"],
        ADDRESS_STATUSES[a.status || "assigned"],
        a.location || "",
        a.owner || "",
        a.mac || "",
        a.note || "",
      ]),
    ),
    project.maintenance.map((m) => [
      new Date(m.date + "T00:00:00Z"),
      m.content,
      m.owner,
      m.status === "done" ? "已完成" : "待处理",
    ]),
  ];
  const plan = project.connectivity;
  data.push(
    plan ? [[plan.internalCidr, plan.externalCidr]] : [],
    (plan?.uplinks || []).map((line) => [
      line.provider,
      line.interface,
      line.bandwidth,
      ACCESS_TYPES[line.access],
      line.address,
      line.gateway,
      line.priority,
      LINK_STATUSES[line.status],
      line.note,
    ]),
    (plan?.policies || []).map((rule) => [
      rule.name,
      rule.source,
      rule.destination,
      POLICY_PROTOCOLS[rule.protocol],
      rule.ports,
      rule.action === "allow" ? "允许" : "拒绝",
      rule.enabled ? "启用" : "停用",
      rule.note,
    ]),
  );
  data.push(
    ...(await engineeringExcel.engineeringTables(
      project,
      networks,
      networkCodes,
    )),
  );
  data.push(...(await infrastructureExcel.infrastructureTables(project)));
  data.push(...(await capacityExcel.capacityTables(project, networks)));
  data.push(...(await acceptanceExcel.acceptanceTables(project, networks)));
  data.push(...(await topologyExcel.topologyTables(project, networks)));
  const instructions = workbook.getWorksheet("填写说明");
  instructions.addRow([
    "逻辑配置版本",
    project.engineering?.infrastructure?.logicalVersion ?? "",
  ]);
  instructions.addRow([
    '逻辑配置版本1：端口逻辑配置为可选输入，P/N引用已有接口/网段。模式Access或Trunk，业务网段编号为JSON列表例如["N001"]。VLAN填写普通文本1～4094，允许VLAN逗号分隔；留空未知，“无”为明确空列表。旧接口不补默认配置，校核表忽略重算，不证明现场可达。',
  ]);
  instructions.addRow([
    "现场验收版本",
    project.engineering?.siteAcceptance !== undefined ? 1 : "",
  ]);
  instructions.addRow([
    "现场验收版本1：保留验收清单、验收结果、整改复验及原工程三输入表。K/R/X为本地编号，目标引用E/P/C；要求及诊断快照为普通JSON文本，测量时间为UTC ISO毫秒文本。通过是人工判定，不因诊断完成自动通过。上限500检查项/2000结果/1000整改；单格32767字符，诊断快照8192 UTF8字节。派生报告忽略重算；10MiB是输入保护，不保证任意不可压缩极限文本通过。",
  ]);
  instructions.addRow([
    "容量校核版本",
    project.engineering?.infrastructure?.capacityPlanning !== undefined
      ? 1
      : "",
  ]);
  instructions.addRow([
    "容量校核版本1：保留四张输入及工程/设备三表；S/Q/U/T为本地编号，引用E/P/C；正向/反向独立。W/Mbps最多3位小数；百分数填整数，禁用百分比格式；空为未知，0为明确零。整机预算/速率≤1000000，单口/设备功耗≤1000，单设备Mbps≤10000，数量≤100000，增长≤1000%，其他比例≤100%。派生表忽略并重算，估算不替代现场验收。",
  ]);
  instructions.addRow([
    "设备连接版本",
    project.engineering?.infrastructure !== undefined ? 1 : "",
  ]);
  instructions.addRow([
    "设备连接版本 1：保留工程设备、设备接口、接口连接三张输入表及原工程三张输入表。E/P/C 为设备/接口/连接本地编号，区域沿用 L。接口占用按输入重算；仅统计已登记接口，不证明现场容量充足。最多 500 设备、5000 接口、2500 连接。",
  ]);
  instructions.addRow(["工程资料版本", project.engineering ? 1 : ""]);
  instructions.addRow([
    "工程输入版本 1：场地位置、业务需求、接入容量三张表须完整保留。L/N/D/C 为工作簿内编号；上级/区域/网段填写对应编号。数量留空表示待补充，0 表示已知零；增长比例填写整数百分数，不能输入 Excel 百分比。容量校核仅供阅读，导入忽略并重新计算。最多 500 位置、1000 需求、500 容量；数量/端口 0～1000000，增长 0～1000，每单位 0～16。",
  ]);
  for (let index = 0; index < specs.length; index++) {
    const sheet =
      workbook.getWorksheet(specs[index].name) ||
      workbook.addWorksheet(specs[index].name);
    if (specs[index].optional) {
      sheet.getRow(1).values = specs[index].headers;
      sheet.getRow(1).height = 30;
      sheet.getRow(1).eachCell((cell) => {
        cell.font = {
          name: "Arial",
          size: 11,
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF2563EB" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    }
    for (let row = 2; row <= sheet.rowCount; row++)
      sheet.getRow(row).values = [];
    sheet.columns.forEach((column, i) => {
      column.width = specs[index].widths[i];
      column.numFmt = "@";
    });
    if (sheet.name === "网段") sheet.getColumn(4).numFmt = "0";
    if (sheet.name === "维护记录") sheet.getColumn(1).numFmt = "yyyy-mm-dd";
    for (const [rowIndex, values] of data[index].entries()) {
      const row = sheet.getRow(rowIndex + 2);
      row.values = values;
      row.font = { name: "Arial", size: 11, color: { argb: "FF233047" } };
      row.height = specs[index].optional ? 44 : 24;
      row.alignment = { vertical: "middle", wrapText: true };
      if (sheet.name === "网段") row.getCell(1).numFmt = "@";
    }
    if (sheet.name === "运营商线路") {
      sheet.getColumn(3).numFmt = "0";
      sheet.getColumn(7).numFmt = "0";
    }
    if (sheet.name === "业务需求")
      for (const c of [5, 6, 7, 8]) sheet.getColumn(c).numFmt = "0";
    if (sheet.name === "接入容量") sheet.getColumn(3).numFmt = "0";
    if (specs[index].numericColumns)
      for (const c of specs[index].numericColumns)
        sheet.getColumn(c).numFmt = "0.###";
    if (specs[index].derived)
      await sheet.protect("", { selectLockedCells: true });
    const choices =
      sheet.name === "运营商线路"
        ? { 4: Object.values(ACCESS_TYPES), 8: Object.values(LINK_STATUSES) }
        : sheet.name === "互通策略"
          ? {
              4: Object.values(POLICY_PROTOCOLS),
              6: ["允许", "拒绝"],
              7: ["启用", "停用"],
            }
          : {
              ...acceptanceExcel.choices(sheet.name),
              ...(await engineeringExcel.choices(sheet.name)),
              ...(await infrastructureExcel.choices(sheet.name)),
              ...(sheet.name === "上联业务" ? { 4: ["正向", "反向"] } : {}),
              ...(sheet.name === "端口逻辑配置"
                ? { 2: ["Access", "Trunk"] }
                : {}),
            };
    for (const [column, labels] of Object.entries(choices)) {
      for (let row = 2; row <= (specs[index].limit || 200) + 1; row++)
        sheet.getCell(row, Number(column)).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ['"' + labels.join(",") + '"'],
          showErrorMessage: true,
          errorTitle: "选项无效",
          error: "请使用下拉选项",
        };
    }
    sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, data[index].length + 1),
        column: specs[index].headers.length,
      },
    };
  }
  // Draw actual borders, including blank input cells: these remain visible
  // when worksheet gridlines are hidden and when the workbook is printed.
  for (const sheet of workbook.worksheets) {
    const rowCount = Math.max(
      sheet.rowCount,
      sheet.name === "填写说明" ? 1 : 21,
    );
    const columnCount = sheet.columnCount;
    for (let row = 1; row <= rowCount; row++) {
      const edge = {
        style: "thin",
        color: { argb: row === 1 ? "FF93B4EA" : "FFCBD5E1" },
      };
      for (let column = 1; column <= columnCount; column++)
        sheet.getCell(row, column).border = {
          top: edge,
          bottom: edge,
          left: edge,
          right: edge,
        };
    }
  }
  return workbook;
}
async function readProjectWorkbook(filename) {
  if ((await fs.stat(filename)).size > 10 * 1024 * 1024)
    throw new Error("Excel 文件不能超过 10 MB");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filename);
  const specs = await schema();
  const {
    PROJECT_STATUSES,
    DEVICE_TYPES,
    ADDRESS_STATUSES,
    validateWorkspace,
    validateProjects,
    emptyWorkspace,
    newProject,
  } = await enums();
  const { validateNetworks } = await import("../src/domain/workspace.js");
  const { subnet } = await import("../src/domain/ipv4.js");
  const read = (cell, name, row) => {
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (!["string", "number"].includes(typeof value))
      throw new Error(
        `${name} 第 ${row} 行 ${cell.address}：请填写值，不支持公式、链接或富文本`,
      );
    return String(value).trim();
  };
  const tables = specs.map((spec) => {
    if (spec.derived) return [];
    const sheet = workbook.getWorksheet(spec.name);
    if (!sheet && spec.optional) return [];
    if (!sheet) throw new Error(`缺少“${spec.name}”工作表，请使用提供的模板`);
    if (sheet.rowCount > 50001) throw new Error(`${spec.name} 超过 50000 行`);
    spec.headers.forEach((header, i) => {
      if (sheet.getCell(1, i + 1).value !== header)
        throw new Error(
          `${spec.name} 第 ${i + 1} 列应为“${header}”，请勿修改表头`,
        );
    });
    const rows = [];
    for (let row = 2; row <= sheet.rowCount; row++) {
      const values = spec.headers.map((_, i) => {
        const cell = sheet.getCell(row, i + 1);
        if (spec.acceptance)
          return acceptanceExcel.readCell(cell, spec, i + 1, row);
        if (spec.numericColumns)
          return capacityExcel.readCell(cell, spec, i + 1, row);
        if (
          spec.textOnly &&
          cell.value != null &&
          typeof cell.value !== "string"
        )
          throw new Error(
            `${spec.name} 第 ${row} 行 ${cell.address}：请填写文本，不支持数字、公式、链接或富文本`,
          );
        return read(cell, spec.name, row);
      });
      if (values.every((v) => v === "")) continue;
      spec.headers.forEach((header, i) => {
        if (header.endsWith("*") && !values[i])
          throw new Error(`${spec.name} 第 ${row} 行：${header}不能为空`);
      });
      rows.push({ row, values });
      if (spec.limit && rows.length > spec.limit)
        throw new Error(`${spec.name} 第 ${row} 行：超过 ${spec.limit} 条`);
    }
    return rows;
  });
  if (tables[0].length !== 1) throw new Error("项目表应且只能填写一个项目");
  const reverse = (object, value, label) => {
    const key = Object.keys(object).find((key) => object[key] === value);
    if (!key) throw new Error(`${label}“${value}”无效，请使用下拉选项`);
    return key;
  };
  const [name, customer, site, owner, status, note] = tables[0][0].values;
  const project = {
    ...newProject("excel-project", name),
    customer,
    site,
    owner,
    status: reverse(PROJECT_STATUSES, status, "项目状态"),
    note,
  };
  const networks = [];
  const errors = [];
  for (const {
    row,
    values: [id, name, cidr, vlan, gateway, dhcpStart, dhcpEnd, note],
  } of tables[1]) {
    try {
      const network = {
        id,
        name,
        cidr: subnet(cidr).cidr,
        vlan: vlan ? Number(vlan) : "",
        gateway,
        dhcpStart,
        dhcpEnd,
        note,
        projectId: project.id,
        allocations: [],
      };
      validateNetworks([network]);
      if (networks.some((n) => n.id === id)) throw new Error("网段编号重复");
      networks.push(network);
    } catch (e) {
      errors.push(`网段 第 ${row} 行：${e.message}`);
    }
  }
  for (const {
    row,
    values: [id, ip, label, type, status, location, owner, mac, note],
  } of tables[2]) {
    try {
      const network = networks.find((n) => n.id === id);
      if (!network) throw new Error(`网段编号 ${id} 不存在或网段信息无效`);
      const allocation = {
        ip,
        label,
        type: reverse(DEVICE_TYPES, type, "设备类型"),
        status: reverse(ADDRESS_STATUSES, status, "地址状态"),
        location,
        owner,
        mac: mac.toUpperCase(),
        note,
      };
      validateNetworks([
        { ...network, allocations: [...network.allocations, allocation] },
      ]);
      network.allocations.push(allocation);
    } catch (e) {
      errors.push(`IP台账 第 ${row} 行：${e.message}`);
    }
  }
  for (const {
    row,
    values: [date, content, owner, status],
  } of tables[3]) {
    try {
      const log = {
        id: `excel-log-${row}`,
        date,
        content,
        owner,
        status: reverse(
          { pending: "待处理", done: "已完成" },
          status,
          "维护状态",
        ),
      };
      validateProjects([
        { ...project, maintenance: [...project.maintenance, log] },
      ]);
      project.maintenance.push(log);
    } catch (e) {
      errors.push(`维护记录 第 ${row} 行：${e.message}`);
    }
  }
  if (tables.slice(4, 7).some((rows) => rows.length)) {
    try {
      if (specs.slice(4, 7).some((spec) => !workbook.getWorksheet(spec.name)))
        throw new Error(
          "有互联规划时请保留互联架构、运营商线路、互通策略三张表",
        );
      if (tables[4].length !== 1)
        throw new Error("互联架构应且只能填写一行内外网地址空间");
      const {
        ACCESS_TYPES,
        LINK_STATUSES,
        POLICY_PROTOCOLS,
        validateConnectivity,
      } = await import("../src/domain/enterprise.js");
      project.connectivity = {
        internalCidr: tables[4][0].values[0],
        externalCidr: tables[4][0].values[1],
        uplinks: tables[5].map(
          ({
            row,
            values: [
              provider,
              iface,
              bandwidth,
              access,
              address,
              gateway,
              priority,
              status,
              note,
            ],
          }) => ({
            id: `excel-wan-${row}`,
            provider,
            interface: iface,
            bandwidth: bandwidth ? Number(bandwidth) : "",
            access: reverse(ACCESS_TYPES, access, "接入方式"),
            address,
            gateway,
            priority: Number(priority),
            status: reverse(LINK_STATUSES, status, "线路状态"),
            note,
          }),
        ),
        policies: tables[6].map(
          ({
            row,
            values: [
              name,
              source,
              destination,
              protocol,
              ports,
              action,
              enabled,
              note,
            ],
          }) => ({
            id: `excel-policy-${row}`,
            name,
            source,
            destination,
            protocol: reverse(POLICY_PROTOCOLS, protocol, "协议"),
            ports,
            action: reverse(
              { allow: "允许", deny: "拒绝" },
              action,
              "规则动作",
            ),
            enabled:
              reverse({ yes: "启用", no: "停用" }, enabled, "规划状态") ===
              "yes",
            note,
          }),
        ),
      };
      validateConnectivity(project.connectivity);
    } catch (e) {
      errors.push(`互联规划：${e.message}`);
    }
  }
  let engineeringVersion = "";
  workbook.getWorksheet("填写说明")?.eachRow((row) => {
    if (row.getCell(1).value === "工程资料版本") {
      if (engineeringVersion !== "")
        throw new Error("填写说明：工程资料版本重复");
      engineeringVersion = read(row.getCell(2), "填写说明", row.number);
    }
  });
  if (engineeringVersion !== "" && engineeringVersion !== "1")
    throw new Error("填写说明：不支持的工程资料版本");
  if (
    engineeringVersion === "1" ||
    tables.slice(7, 10).some((rows) => rows.length)
  ) {
    if (specs.slice(7, 10).some((spec) => !workbook.getWorksheet(spec.name)))
      throw new Error("有工程输入时请保留场地位置、业务需求、接入容量三张表");
    const parsed = await engineeringExcel.parseEngineering(
      tables.slice(7, 10),
      networks,
      workbook,
    );
    errors.push(...parsed.errors);
    project.engineering = parsed.engineering;
  }
  let infrastructureVersion = "",
    infrastructureMarkers = 0;
  workbook.getWorksheet("填写说明")?.eachRow((row) => {
    if (row.getCell(1).value === "设备连接版本") {
      if (++infrastructureMarkers > 1)
        throw new Error("填写说明：设备连接版本重复");
      infrastructureVersion = read(row.getCell(2), "填写说明", row.number);
    }
  });
  if (infrastructureVersion !== "" && infrastructureVersion !== "1")
    throw new Error("填写说明：不支持的设备连接版本");
  const hasInfrastructureData = tables
    .slice(11, 14)
    .some((rows) => rows.length);
  if (hasInfrastructureData && infrastructureVersion !== "1")
    throw new Error("设备连接输入：存在孤立数据或缺少设备连接版本");
  let infrastructureLinkCodes = new Map();
  if (infrastructureVersion === "1") {
    if (specs.slice(11, 14).some((spec) => !workbook.getWorksheet(spec.name)))
      throw new Error("设备连接启用时请保留工程设备、设备接口、接口连接三张表");
    if (
      !project.engineering ||
      specs.slice(7, 10).some((spec) => !workbook.getWorksheet(spec.name))
    )
      throw new Error("设备连接需要完整工程输入三张表");
    const parsed = await infrastructureExcel.parseInfrastructure(
      tables.slice(11, 14),
      project.engineering,
    );
    project.engineering.infrastructure = parsed.infrastructure;
    infrastructureLinkCodes = parsed.linkCodes || new Map();
    errors.push(...parsed.errors);
  }
  let capacityVersion = "",
    capacityMarkers = 0;
  workbook.getWorksheet("填写说明")?.eachRow((row) => {
    if (row.getCell(1).value === "容量校核版本") {
      if (++capacityMarkers > 1) throw new Error("容量校核版本重复");
      capacityVersion = read(row.getCell(2), "填写说明", row.number);
    }
  });
  if (capacityVersion !== "" && capacityVersion !== "1")
    throw new Error("不支持的容量校核版本");
  if (
    tables.slice(15, 19).some((rows) => rows.length) &&
    capacityVersion !== "1"
  )
    throw new Error("容量校核：孤立数据或缺少版本");
  if (capacityVersion === "1") {
    if (specs.slice(15, 19).some((spec) => !workbook.getWorksheet(spec.name)))
      throw new Error("容量校核：缺少输入工作表");
    if (
      !project.engineering?.infrastructure ||
      specs.slice(7, 10).some((spec) => !workbook.getWorksheet(spec.name)) ||
      specs.slice(11, 14).some((spec) => !workbook.getWorksheet(spec.name))
    )
      throw new Error("容量校核需要完整工程和设备三张工作表");
    try {
      project.engineering.infrastructure.capacityPlanning =
        await capacityExcel.parseCapacity(
          tables.slice(15, 19),
          project.engineering,
          infrastructureLinkCodes,
        );
    } catch (e) {
      errors.push(`容量校核：${e.message}`);
    }
  }
  let acceptanceVersion = "",
    acceptanceMarkers = 0;
  workbook.getWorksheet("填写说明")?.eachRow((row) => {
    if (row.getCell(1).value === "现场验收版本") {
      if (++acceptanceMarkers > 1) throw new Error("现场验收版本重复");
      acceptanceExcel.readCell(
        row.getCell(2),
        { name: "填写说明：现场验收版本", numericColumns: [2] },
        2,
        row.number,
      );
      const value = row.getCell(2).value;
      if (value !== null && value !== "" && value !== 1 && value !== "1")
        throw new Error("不支持的现场验收版本");
      acceptanceVersion = value === 1 || value === "1" ? "1" : "";
    }
  });
  if (
    tables.slice(20, 23).some((rows) => rows.length) &&
    acceptanceVersion !== "1"
  )
    throw new Error("现场验收：孤立数据或缺少版本");
  if (acceptanceVersion === "1") {
    if (specs.slice(20, 23).some((spec) => !workbook.getWorksheet(spec.name)))
      throw new Error("现场验收：缺少输入工作表");
    if (
      !project.engineering ||
      specs.slice(7, 10).some((spec) => !workbook.getWorksheet(spec.name))
    )
      throw new Error("现场验收需要完整工程三张输入工作表");
    try {
      project.engineering.siteAcceptance =
        await acceptanceExcel.parseAcceptance(
          tables.slice(20, 23),
          project.engineering,
          infrastructureLinkCodes,
        );
    } catch (e) {
      errors.push(`现场验收：${e.message}`);
    }
  }
  let logicalVersion = "",
    logicalMarkers = 0;
  workbook.getWorksheet("填写说明")?.eachRow((row) => {
    if (row.getCell(1).value !== "逻辑配置版本") return;
    if (++logicalMarkers > 1) throw Error("逻辑配置版本重复");
    acceptanceExcel.readCell(
      row.getCell(2),
      { name: "逻辑配置版本", numericColumns: [2] },
      2,
      row.number,
    );
    const value = row.getCell(2).value;
    if (value !== null && value !== "" && value !== 1 && value !== "1")
      throw Error("不支持的逻辑配置版本");
    logicalVersion = value === 1 || value === "1" ? "1" : "";
  });
  const logicalIndex = specs.findIndex((s) => s.name === "端口逻辑配置");
  if (tables[logicalIndex].length && logicalVersion !== "1")
    throw Error("端口逻辑配置：孤立数据或缺少版本");
  if (logicalVersion === "1") {
    if (
      !workbook.getWorksheet("端口逻辑配置") ||
      !project.engineering?.infrastructure ||
      specs.slice(7, 10).some((s) => !workbook.getWorksheet(s.name)) ||
      specs.slice(11, 14).some((s) => !workbook.getWorksheet(s.name))
    )
      throw Error("逻辑配置需要端口逻辑配置及完整工程、设备输入表");
    try {
      await topologyExcel.parseTopology(
        tables[logicalIndex],
        project.engineering,
        networks,
      );
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length)
    return { errors: errors.slice(0, 50), totalErrors: errors.length };
  try {
    validateWorkspace({
      ...emptyWorkspace(),
      projects: [project],
      activeProjectId: project.id,
      networks,
    });
  } catch (e) {
    return { errors: [e.message], totalErrors: 1 };
  }
  return {
    kind: "ineed-nettool-project",
    version: 1,
    project,
    networks,
    errors: [],
  };
}
async function templateWorkbook() {
  const example = await readProjectWorkbook(TEMPLATE);
  return projectWorkbook(example.project, example.networks);
}
module.exports = {
  TEMPLATE,
  projectWorkbook,
  readProjectWorkbook,
  templateWorkbook,
};
