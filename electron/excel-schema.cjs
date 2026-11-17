const path = require("node:path");
const TEMPLATE = path.join(__dirname, "templates", "NetTool-网络项目模板.xlsx");
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


module.exports = { TEMPLATE, enums, schema };
