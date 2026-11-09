# NetTool Site Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute serially with independent task reviews and one final broad review.

**Goal:** Complete project checklists, preserved diagnostic evidence, corrective retests and Excel handover.

**Architecture:** Optional version-1 plan inside engineering. One pure domain module owns validation/transitions/report/remapping; Excel and Vue consume it. Existing project SQLite/IPC/history remain the persistence and evidence sources.

**Tech Stack:** Vue3, Electron43, Node SQLite, ExcelJS, node:test, native Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-site-acceptance.md`.

## Global Constraints

- Original shared source `/Users/pangzhigang/develop/com.ineedfull/ineed-net-tool`, existing feature branch; preserve all pre-task work. No worktree/source moves, no edits MQTT/LinkLab, no push/package/upload/website.
- User approved current baseline commit and the full acceptance workflow. Baseline `543e1ca` is verified. Workers do not commit; controller commits reviewed feature files after final gates. Keep SDD evidence until durable handoff; no deletion of uncommitted scratch.
- Optional `engineering.siteAcceptance` version1; missing stays missing, explicit empty survives. SQLite/workspace/engineering/infrastructure versions, IDs/data paths/settings/history retention unchanged.
- Limits items500/results2000/actions1000; IDs≤100 control-free globally unique across engineering/inventory/capacity/acceptance. Evidence≤8192 UTF8 bytes,8metrics; exact text/time/enum bounds in spec; strict types/finite values, null≠0.
- Result history is append-only in UI. Semantic check edits increment revision. Latest is highest unique sequence within current revision; open actions prevent pass until explicitly linked to later valid current pass. Older pass/older criteria never falsely certify current work.
- Evidence captures only matching project/method terminal saved history, whitelisted bounded fields, no rows/raw/options arbitrary objects. Source ID stays provenance on import; evidence survives history retention. Human conclusions explicit; completed≠automatically passed.
- Report validates actual sibling network context and owning graph. All IDs and active references/criteria targets remap, provenance sourceId stays. No silent cascades or fake zero defaults.
- Dynamic25 sheets, old5/8/12/16/21 compatibility and static template unchanged. Independent marker, strict typed cells/JSON/percent rules; derived ignored/recomputed, bounded cells/errors,10MiB guard, no writes on failed preview.
- Reuse DesktopDialog/FeedbackBanner/tokens/date-time. Keyed project isolation, failure drafts/busy/focus;16 theme/font/sidebar/window combinations, portable screenshots; isolated localhost only.

## File responsibilities

`src/domain/site-acceptance.js` owns graph validation, transitions, evidence capture, report and remap. `engineering.js` only integrates optional validation/remap. `electron/site-acceptance-excel.cjs` owns new tables/typed parsing/local maps, `excel.cjs` minimal wiring, `excel-schema.js` schema. `SiteAcceptancePanel.vue` orchestrates forms/report; optional `SiteAcceptanceForms.vue`/`SiteAcceptanceResults.vue` keep input and presentation readable. App/ProjectPanel only pass project-owned history/new tab/import preview. New tests and focused product docs correspond to these boundaries.

### Task 1: Domain, transitions, evidence and persistence

**Create:** `src/domain/site-acceptance.js`, `tests/site-acceptance.test.js`, `tests/site-acceptance-storage.test.js`, `tests/helpers/site-acceptance.js`.
**Modify:** minimal `src/domain/engineering.js` validate/remap integration.

**Produces:** exact public signatures in spec, final report shape documented in task report. `remapSiteAcceptance` consumes maps named devices/interfaces/links. `remapEngineering` can construct those from controlled corresponding original/remapped inventory arrays after `remapInfrastructure`; preserve both endpoint/snapshot graph constraints and final validate.

- [x] Write regression before integration: invalid optional version passed into existing validateWorkspace must throw. Initial RED must be actual missing validation, not only module-import failure.

```js
const state = emptyWorkspace();
state.projects[0].engineering = { ...emptyEngineering(), siteAcceptance: { version: 99, items: [], results: [], actions: [] } };
assert.throws(() => validateWorkspace(state), /验收/);
```

- [x] Run `node --test tests/site-acceptance.test.js`, record expected missing-exception failure. Add domain module/integration to satisfy this and implement spec-driven transition/evidence cases with semantic RED before each new behavior group.
- [x] Add assertions for project-level/manual first record, metadata vs semantic revision edits, current/old results, all outcome/action combinations, failed source/stopped pass rejection, foreign/mismatched/running history, bounded snapshot,0/null, strict dates/types/max counts, every referenced deletion/collision and full import remap. Do not claim every expanded case had RED unless it did.

```js
// API shape; fixtures supply ordinary valid project/items/results.
const report = siteAcceptanceReport(project, ownedNetworks);
assert.equal(report.counts.rectifying, 1);
const closed = resolveAcceptanceAction(project, actionId, laterPassId, ownedNetworks);
assert.equal(siteAcceptanceReport(closed, ownedNetworks).status, 'ok');
```

- [x] Real Store write/read in independent Node child; invalid version/ref/time write leaves DB/state unchanged; PRAGMA user_version stays1. Absent/explicit empty preserved; source historical record removed but captured result survives.
- [x] Focused new+engineering/infrastructure/capacity/projects/store tests, then one full npm test. Cached formatting/diff check. Self-review and write task-1-report.md (API/row output/mapping contracts, actual RED/GREEN, bounds/limits). Controller reviews task diff before Task2.

### Task 2: Excel handover

**Create:** `electron/site-acceptance-excel.cjs`, `tests/site-acceptance-excel.test.js`.
**Modify:** minimal `electron/excel.cjs`, `src/domain/excel-schema.js`, stale current-sheet-list test assertions; additive existing map exposure only if needed.

**Consumes:** Task1 report/API; real sibling networks and explicit B1 linkCodes; no duplicated status or criteria/revision logic. **Produces:**25sheet schema/column list/parser handoff for UI/docs.

- [x] Write real serialized XLSX test first: projectWorkbook must contain25 sheets and preserve plan/revision/results/actions/evidence after parse and projectImport. Run focused command to observe21-vs25 RED.

```js
const workbook = await projectWorkbook(project, networks);
assert.equal(workbook.worksheets.length, 25);
// serialize to real temp .xlsx; readProjectWorkbook -> projectImport -> pure report
assert.equal(imported.project.engineering.siteAcceptance.results[0].evidence.sourceId, sourceId);
```

- [x] Implement three typed input sheets, one derived report, independent marker. Define ordered columns and JSON criteria/diagnostic snapshot encoding using local target codes; generate collision-safe acceptance temp IDs against entire existing graph; remap result/action refs and custom C codes by actual map.
- [x] Serialization tests: real associated network; current/old criteria; open/closed actions; provenance stable/full active IDs fresh; custom/misleading/colliding codes; missing/empty/partial/duplicate/unknown/orphan marker; legacy5/8/12/16/21; structured text/number/formula/Date/link/richText/boolean/percentage/excess lengths; derived ignored; domain errors no project. Maximum500/2000/1000 arrays with max text/evidence within documented10MiB and cell guards.
- [x] Focused Excel/new domain/storage + old Excel regressions, one full npm test. Format/diff check, self-review, report exact columns/APIs/bounds/evidence. Controller task-scoped independent review before UI.

### Task 3: Project workbench, native lifecycle and docs

**Create:** focused `src/components/SiteAcceptancePanel.vue` with optional form/result subcomponents, `tests/ui/site-acceptance.spec.js`, `docs/site-acceptance.md`, `docs/site-acceptance-verification-2026-10-27.md`.
**Modify:** minimal `src/App.vue` history prop, `ProjectPanel.vue` tab/keyed child/preview, README/network-engineering/network-projects/engineering-excel-contract/code-reading-map docs.

**Consumes:** Reviewed domain transition/report helpers and Excel schema/columns; source APIs as Task1 report. Current-project history already available in App. No domain/Excel behavior edits without controller coordination.

- [x] Start actual isolated Electron test with missing现场验收tab assertion, run RED before implementation.

```js
await page.getByRole('button', { name: '项目工作台', exact: true }).click();
await expect(page.getByRole('tab', { name: '现场验收', exact: true })).toBeVisible();
```

- [x] Implement end-to-end checklist CRUD (delete dependencies), append-only result/evidence details, action create/edit/explicit valid retest close, current-vs-old report and direct inventory navigation. Default project-only check without inventory supported; optional data only enabled on save. Report/steps not mathematical duplication. Distinguish human verdict from copied diagnostic task status, show exact local date-time through formatter.
- [x] Actual native lifecycle includes at least one localhost-generated saved diagnostic linked by snapshot, fail→action→pass stillrectifying→close→pass→laterfail, semanticedit→pending→newpass, multiple independent item identities, history removal snapshot retained, parent target deletion guard, SQLite trigger failure/draft/retry/busy/focus, programmatic project switch isolation, real25sheet file export/preview/import/local refs+provenance, full process close/restart/deep persisted equality.
- [x] Display16states × all primary forms/details including long criteria/targets, header/footer/scroll/focus/no page overflow; portable evidence defaults. Controller visually inspects representative forms/results/screenshots. Native test authored to avoid absolute author filesystem paths.
- [x] Focused native+neighbor infrastructure/capacity/engineering/project tests and build/format. Document behavior,25sheet/legacy, evidence limits/manual judgments, statuses/retention/reference/edit/retest and platform boundary. Report actual chronology/results and screenshot paths. Controller task review.

## Final whole-change gates and commit

- [x] One independent broad review on complete B2-baseline→C diff, triage any ledger minors. One combined fix wave plus scoped re-review if needed.
- [x] Fresh final npm test/build/full npm run test:ui, explicit formatting and diff checks; no repeat of already-green optional gates without new risk/change.
- [x] Verify preserved source baseline and scope, update product verification/workspace task/STATUS with exact counts/boundaries/commit IDs. Commit explicit reviewed C files after passing, no push or publication. Keep original branch/source and preserve unrelated workspace changes; do not ask integration menu because user approved this local commit workflow.

## User extension: input form alignment (2026-10-27)

User reported NetTool input layout/alignment and requested an overall tools UI sweep before final handoff. NetTool added a bounded shared-CSS correction: form number controls fill columns, ordinary single-line native controls use existing32px token, grid fields align consistently. Task4 includes real before/after Electron geometry,34actual screens×16display states, product form-layout guide and independent task review. Existing values, validation, save flows and compact numeric toolbars are retained. MQTT/LinkLab receive a separate UI-only sweep in their original repositories, preserving earlier dirty code; their native/runtime/domain behavior is outside this extension.

- [x] Final broad NetTool review includes original acceptance plus this CSS/test/doc delta and deferred review minors.
- [x] Full final native suite covers all new and existing pages before explicit reviewed NetTool feature commit.
