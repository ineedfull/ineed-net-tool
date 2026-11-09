# Engineering infrastructure implementation plan

Spec: `docs/superpowers/specs/2026-10-25-engineering-infrastructure.md`.

## Global Constraints

- Work in the original shared NetTool checkout; preserve all preexisting edits. No worktree, commits, pushes, release, uploads or source moves this task.
- NetTool is Vue + Electron only. SQLite schema/workspace version/engineering version and app data paths remain compatible.
- `infrastructure` is optional and missing stays missing. Validate all ownership/references; import remaps every new ID. No silent cascade deletions.
- Devices≤500, interfaces≤5000, links≤2500; name≤100, model≤200, note≤1000, ID≤100. Distinct devices per link, one link per available interface.
- Available access capacity includes connected access interfaces; demand is not added to occupied links. Manual phase A capacity is never overwritten or added. Unknown demand stays pending; counts describe registered input only.
- Existing DesktopDialog/FeedbackBanner/tokens and project isolation/busy/save-failure draft behavior apply. Test light/dark × normal/large × expanded/collapsed × wide/narrow.
- Localhost/isolated test data only. No automatic scanning, installation or publication.

### Task 1: Domain, persistence and Excel contract

Own `src/domain/infrastructure.js`, integration in `src/domain/engineering.js`, optional new focused `electron/infrastructure-excel.cjs`, integration in `electron/engineering-excel.cjs`/`electron/excel.cjs`/`src/domain/excel-schema.js`, domain/import/storage/Excel tests. Do not edit UI.

Implement the full data and Excel spec. Prefer one module per responsibility and reuse domain validation/report in UI/Excel. Define and document exact public function signatures/report fields in the task report for Task2. Integrate optional validation/remapping with existing engineering wrappers so all save/load/import paths apply. Ensure area references cannot be deleted through existing validation. Optional `infrastructure` IDs must not collide with original engineering IDs. Do not manufacture fake network IDs or rewrite old data. All old workbook formats remain importable.

TDD: add focused failing domain/Excel/SQLite tests, record correct RED before production implementation. Then pass focused tests and full `npm test` once. Test full XLSX file serialization, legacy/explicit-empty/partial-sheet/version/cell rejection, maximum legitimate records, full process-independent SQLite read, imported ownership and remapping. Write `task-1-report.md` with exact commands/results, files, TDD evidence and exported interface. Do not spawn agents or commit.

### Task 2: Engineering UI and native acceptance

Own new focused `src/components/InfrastructurePanel.vue` (optional small subcomponents), `src/components/ProjectPanel.vue` integration/preview, minimal related styles, `tests/ui/infrastructure.spec.js`, and product documentation (`docs/network-engineering.md`, README additions, dedicated verification document). Consume Task1 domain interfaces unchanged unless a verified integration gap requires a small covered correction. Existing pre-task README edits must remain.

Implement the complete UI behavior from the spec, a “设备与连接” project tab, CRUD for devices/interfaces/links, connection listing and device/area reports; jump to engineering tab for new locations. Do not build a freeform drawing canvas. Empty and unknown states must be explicit, manual capacity separate, remove confirmations explain dependent references, save failure retains drafts. A project switch cannot save old edits into new project. Ensure disabled/busy actions do not break dialog focus.

TDD with new Electron UI scenario failing for missing tab before implementation. Native test uses isolated data only. Cover successful CRUD, conflicts/deletion protections, capacity recalculation, SQLite save failure draft, project separation, XLSX export/import and actual app process restart. Test all16 display combinations and capture representative light/dark screenshots for controller visual inspection. Run focused UI tests and adjacent project/engineering tests, build and formatting; controller runs final full gate after review. Do not duplicate source/runtime implementations, commit, publish or spawn agents. Write `task-2-report.md` with commands/results/evidence paths and platform limits.
