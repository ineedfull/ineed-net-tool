// Public Excel facade; reading and writing share the same schema and template.
const { TEMPLATE } = require("./excel-schema.cjs");
const { projectWorkbook } = require("./excel-writer.cjs");
const { readProjectWorkbook } = require("./excel-reader.cjs");

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
