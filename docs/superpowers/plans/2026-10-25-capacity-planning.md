# NetTool B2 implementation plan

Spec: `docs/superpowers/specs/2026-10-25-capacity-planning.md`.

## Global Constraints

- Original shared NetTool source directory, preserve all pre-task edits. No worktree, commits, pushes, release/upload or source moves. NetTool Vue+Electron only.
- Optional infrastructure.capacityPlanning/version1; missing stays missing. SQLite schema/workspace/engineering/infrastructure versions and app data paths unchanged. All new IDs unique across owning engineering+inventory+capacity records; remap every ID/reference on project import. No silent cascades.
- Limits powerBudgets500,poeLoads2500,uplinks500,trafficDemands500. Watts/Mbps max3 decimals; count≤100000, per-unitMbps≤10000, growth≤1000%; other exact bounds in spec. null and0 distinct. All invalid references/types/nonfinite/precision/bounds rejected.
- PoE compares estimated PSE-side power with per-port and reserved device budget, known shortages survive missing data. Full duplex forward/reverse compared independently to min endpoint speed after reserve. No link/standby/LAG addition or automatic routing, no onsite certification. UI/Excel share exact pure report, explicit units/formulas/unknowns.
- Existing DesktopDialog/FeedbackBanner/tokens; keyed project isolation, busy/failure draft/focus behavior; all16 theme/font/sidebar/window combinations. New tests use portable evidence defaults; isolated localhost data only, no scanning.
- Old5/8/12/16 XLSX stays importable; new21 sheets, independent version marker, strict cells/precision/percent formats; new local IDs collision-free, endpoint snapshots preserved; errors never save.

### Task 1: Domain and persistence/import compatibility

Own new `src/domain/capacity-planning.js`, minimal `src/domain/infrastructure.js` optional validation/remap integration, new tests/helpers/capacity-planning.js and domain/storage tests. Do not edit Excel or UI.

Implement all data validation, exact unit calculations/report and remapping from binding spec. Ensure both original and new interface/connection deletion or endpoint-change validation cannot leave dangling/stale capacity refs. No schema/version/persistence rewrite needed; demonstrate existing save/load wrappers carry optional data and reject invalid writes. Document exact public function signatures, report fields, units and IDs for following tasks. Keep modules readable; no unrelated refactor.

TDD: actual focused domain/import/validation failing tests before implementation, then GREEN. Include hand-calculated PoE12W/25%+two loads/40W20% and 1000↔100Mbps/20% with48 and60Mbps opposing traffic, null/0, decimal rounding boundary and maximal safe aggregate. Cover one endpoint missing but known shortage, unknown demand and risk simultaneously, every ownership ref/ID collision, old missing/empty retained, snapshot mismatch, full import remap. SQLite regression must actual close/reopen in independent Node process and failed-write atomicity; report honestly if generic existing store test passes immediately. Focused coverage then full npm test once. Report in task-1-report.md with RED/GREEN, public API and remaining concerns. No agents/commits.

### Task 2: Versioned Excel extension and compatibility

Own new `electron/capacity-planning-excel.cjs`, `electron/excel.cjs`, `electron/infrastructure-excel.cjs` only if needed for additive local-link map, `src/domain/excel-schema.js`, new Excel tests and minimum original sheet-contract test adjustments. Do not edit UI/domain behavior.

Use Task1 pure report/API. Implement four optional input sheets and one derived output, independent marker, strict mixed text/numeric columns, percent-format protection, safe local code translation/temporary IDs and old5/8/12/16 import. The existing B1 parser maps connection localC to generated link IDs: use explicit mapping, do not assume local code equals internal ID or array index beyond validated code map. Export no internal IDs. Derived output recomputed/ignored on import. Preserve max cell sizes, error previews/no writes. Exact column schema is up to this task; document it in report for UI/docs.

TDD real serialized XLSX RED before integration; GREEN full arrays/references/formulas after parsing and projectImport. Cover empty/absent/partial/orphan/unknown/duplicate marker, illegal structured cells and numeric/text/percentage/precision boundaries, user custom code collisions, max legitimate arrays within10MB serialized limit and single-cell lengths. Existing old importer/header behavior must stay. Focused Excel/domain/storage tests then full npm test once. Format touched code and diff check. Write task-2-report.md with command/results, interfaces/columns and limits. No agents/commits.

### Task 3: Project capacity workbench and native acceptance

Own focused `src/components/CapacityPlanningPanel.vue` with optional small form/report subcomponents if useful, ProjectPanel tab/import preview integration, minimal styles, `tests/ui/capacity-planning.spec.js`, README and docs/network-engineering.md/network-projects.md/engineering-excel-contract.md, new dedicated capacity guide and validation document. Preserve original existing docs/other code. Consume reviewed Task1/2 interfaces; escalate actual integration gaps to controller.

Implement complete user behavior from spec. Four record types CRUD; PoE selects connection/source and derives other endpoint; uplink snapshots connection sides; traffic direction labels actual endpoints. Separate plan inputs from pure computed outcomes; no duplicate formulas. Show units, assumptions, known totals/unknowns/remaining and risk/pending, jump to device inventory. Save failures retain draft; blank becomesnull, never0; accurate add/edit/delete headings, busy double-submit guard and focus, keyed project isolation, dependency-safe delete.

Native TDD test first fails for missing PoE与带宽 tab. Then actual isolated Electron CRUD and hand-checked reports, all dependency rejections, changed params/recompute, actual SQLite fault/retry/double-submit/focus, project switch, actual XLSX file preview/import/remap and full process close/restart. Test16display states and four dialog kinds, scroll headers/footer/long labels, screenshots for controller visual check. Evidence defaults to testInfo.outputPath; optional explicit env override. Focused UI plus adjacent infrastructure/engineering/project tests and build/format; controller final full gates after review. Docs accurately cover21sheets/old compatibility/precise assumptions and platform limits. Write task-3-report.md. No agents/commits.
