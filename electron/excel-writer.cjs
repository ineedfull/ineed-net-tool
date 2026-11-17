// Assemble project sheets in canonical schema order.
const ExcelJS = require("exceljs");
const { TEMPLATE, enums, schema } = require("./excel-schema.cjs");
const infrastructureExcel = require("./infrastructure-excel.cjs");
const capacityExcel = require("./capacity-planning-excel.cjs");
const acceptanceExcel = require("./site-acceptance-excel.cjs");
const engineeringExcel = require("./engineering-excel.cjs");
const topologyExcel = require("./topology-excel.cjs");

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

module.exports = { projectWorkbook };
