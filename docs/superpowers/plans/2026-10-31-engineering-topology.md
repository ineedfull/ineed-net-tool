# Engineering Topology Implementation Plan

> Inline execution follows the user-approved scope: no subagents, commits or deployment. Use test-driven-development and verification-before-completion.

**Goal:** Derive registered topology and explain logical port/VLAN mismatches with existing acceptance handoff.
**Architecture:** Pure configuration and report modules, one derived Vue panel integrated with inventory editing, optional Excel extension.
**Tech Stack:** Vue3, Electron, node:test, SQLite, ExcelJS, Playwright.
**Spec:** ../specs/2026-10-31-engineering-topology.md

## Constraints

Preserve old projects, appID, SQLite and three existing form-layout files. Unknown stays pending. No discovery, device writes or routing claims.

### Task 1: Pure configuration and topology

Files: create src/domain/port-configuration.js, src/domain/topology.js, tests/topology.test.js, tests/helpers/topology.js; modify infrastructure.js and engineering.js.

- [x] Add failing tests through validateEngineering/projectImport for optional configuration, malformed VLANs, foreign refs and full ID remapping. Include VLAN20 two-switch fixture.
- [x] Run `node --test tests/topology.test.js`; verify missing API/validation fails.
- [x] Implement validatePortConfiguration(config,networks), registeredTopology(project,filters), vlanConfigurationReport(project,networks), topologyAcceptanceItem(project,finding,networks,uuid). Propagate only declared link requirements.
- [x] Integrate validation/network remap and verify green plus immutable source inputs.

### Task 2: Persistence and Excel

Files: create electron/topology-excel.cjs and tests/topology-excel.test.js; modify excel-schema.js/excel.cjs; add isolated storage coverage.

- [x] First test serialized27-sheet roundtrip, old25 compatibility and bad markers/refs/formulas with no saved project.
- [x] Append schemas to preserve old indices, parse P/N refs and regenerate report; distinguish unknown and empty VLAN list.
- [x] Run new tests and existing Excel/storage tests.

### Task 3: Inventory UI and acceptance

Files: create TopologyPanel.vue and tests/ui/topology.spec.js; modify InfrastructurePanel.vue and ProjectPanel.vue.

- [x] First add/run red UI tests for graph-to-editor, VLAN edit/report, explicit acceptance creation without result, project switch reset.
- [x] Implement filters, bounded SVG/accessibility links, findings and handoff. Extend existing interface editor with independent logical fields.
- [x] Run16 isolated desktop combinations; verify reachability, no outer overflow and keyboard/project switching.

### Task 4: Verification and handoff

Files: docs/engineering-topology.md, README.md and docs/engineering-excel-contract.md.

- [x] Run npm test/build and relevant UI tests, inspect screenshots.
- [x] Compare preexisting file hashes, git diff --check; record actual counts, limitations, paths and no commit/deployment.
