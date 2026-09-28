# Insight Workbench Requirements

## Scope
Insight Workbench must evolve from semantic-model-focused exploration to end-to-end Fabric impact analysis and change management. This revision adds:

1. Dataflow, Notebook, and Pipeline lineage integration.
2. Lakehouse/Warehouse analyzer parity with semantic model analysis.
3. Permission-path visibility across upstream and downstream dependencies.
4. Ticket-centered TMDL proposal and writeback workflow in proposal mode with audit trail.
5. Toolkit-wide UI standardization, starting with InsightWorkbench.

## Requirement Set

### Req 1 - Expanded Lineage Artifacts

#### Req 1.1 - Dataflow lineage
- The system SHALL discover and display Dataflow dependencies in lineage views.
- The system SHALL connect Dataflows to upstream and downstream artifacts when metadata is available.
- Missing Dataflow dependency metadata SHALL be surfaced as partial-result diagnostics.

#### Req 1.2 - Notebook lineage
- The system SHALL discover and display Notebook dependencies in lineage views.
- The system SHALL parse Notebook metadata and/or content references to infer dependency links where possible.
- Inferred Notebook links SHALL be marked with confidence metadata.

#### Req 1.3 - Pipeline lineage
- The system SHALL discover and display Pipeline dependencies in lineage views.
- The system SHALL map activity-level references to artifact-level lineage links where possible.
- Pipeline links with unresolved references SHALL remain visible with unresolved-state annotations.

#### Req 1.4 - Column-level lineage (best effort)
- The system SHALL provide column-level lineage where available from source metadata.
- The system SHALL not block artifact-level lineage if column-level extraction fails.
- Column-level results SHALL include confidence or source-quality indicators.

### Req 2 - Lakehouse and Warehouse Analyzer

#### Req 2.1 - Entity inventory
- The analyzer SHALL show tables, views, stored procedures, columns, and delta tables for Lakehouse and Warehouse artifacts.

#### Req 2.2 - Cross-artifact usage mapping
- The analyzer SHALL show where Lakehouse/Warehouse entities are used by other Fabric artifacts when references can be resolved.

#### Req 2.3 - Detail navigation
- Users SHALL be able to jump from analyzer entities to lineage and related requirement tickets.

#### Req 2.4 - Deterministic display
- Inventory and usage results SHALL be deterministic for unchanged source metadata.

### Req 3 - Permission Overview and Path Validation

#### Req 3.1 - Access visibility
- The system SHALL display access-level context per artifact in explorer and lineage views.

#### Req 3.2 - Upstream/downstream path validation
- The system SHALL evaluate and flag blocked upstream/downstream paths for the active user.
- Blocked paths SHALL include a reason code when available.

#### Req 3.3 - Non-destructive visibility
- Blocked paths SHALL be flagged rather than hard-filtered by default in MVP.

#### Req 3.4 - Permission summary
- The system SHALL provide a summary of fully accessible, partially blocked, and blocked dependency paths.

### Req 4 - Ticket-Centered TMDL Proposal Workflow

#### Req 4.1 - Proposal mode
- Semantic model changes from tickets SHALL run in proposal mode first.
- Direct unrestricted publish/writeback SHALL not be default behavior in MVP.

#### Req 4.2 - TMDL proposal authoring
- Tickets SHALL support capturing proposed TMDL changes with before/after context.

#### Req 4.3 - MCP AI assistance
- Developers SHALL be able to invoke MCP-assisted suggestion workflows for ticket-linked semantic changes.

#### Req 4.4 - Auditability
- Proposal creation, updates, and apply actions SHALL be logged in an audit trail linked to the ticket.

#### Req 4.5 - Validation and evidence
- Tickets SHALL support linking affected artifacts and test evidence relevant to proposed changes.

### Req 5 - UI Standardization

#### Req 5.1 - Shared interaction patterns
- InsightWorkbench tools SHALL use standardized layout, status, navigation, and table patterns.

#### Req 5.2 - Toolkit-wide baseline
- A reusable UI standard SHALL be defined and documented for broader toolkit adoption.

#### Req 5.3 - Incremental adoption
- InsightWorkbench SHALL be the first adopter and reference implementation of the standard.

## Delivery Phases and Test Gates

### Phase 1 - Contracts and Requirements Baseline ✅ DONE
- Rewrite requirements and align shared types/contracts for lineage, permissions, and proposal workflow.

Test gate:
- Shared contracts compile and match revised requirements. ✅

> **Note:** Proposal & Evidence UI tab is functional but the user workflow for authoring proposals needs further design consideration before Phase 5 implementation.

### Phase 2 - Dataflow/Notebook/Pipeline Lineage Integration
- Implement expanded lineage resolvers and frontend consumption.

Test gate:
- Lineage view includes new artifact types with explicit partial-result markers for unresolved links.

### Phase 3 - Lakehouse/Warehouse Analyzer
- Deliver entity inventory and usage mapping for Lakehouse/Warehouse.

Test gate:
- Tables, views, stored procedures, columns, and delta tables render with cross-artifact usage where available.

### Phase 4 - Permission Path Validation
- Add access indicators and blocked-path diagnostics.

Test gate:
- Upstream/downstream paths are flagged when blocked, with reason codes when available.

### Phase 5 - Ticket-Based TMDL Proposal Flow
- Add proposal authoring, MCP assist hooks, audit records, and evidence links.

Test gate:
- Ticket proposal lifecycle works end-to-end with auditable operations.

### Phase 6 - UI Standardization Rollout
- Apply shared standards across InsightWorkbench and document toolkit baseline.

Test gate:
- All InsightWorkbench views pass UI consistency checklist.

### Phase 7 - Hardening and Packaging
- Complete regressions, build/package validation, and rollout controls.

Test gate:
- Build/package pipelines pass with no regressions in lineage, analyzer, permissions, or ticket workflows.

## Definition of Done
- All revised requirements implemented to MVP scope.
- Phase test gates pass.
- Item registration, localization, and routing remain valid.
- Documentation reflects final architecture and operational constraints.

## Registered Change Entry
| ID | Description | Rationale | Impacted Phase | Test Gate |
|----|-------------|-----------|----------------|-----------|
| 2026-04-10-A | Expanded scope for lineage artifacts, analyzer parity, permission validation, ticketed TMDL proposal flow, and UI standardization | Align implementation with current product requirements | Phases 1-7 | All revised gates above |
| 2026-04-13-B | Added persisted metadata cache layer for artifacts, lineage links, and report definitions with manual refresh controls | Reduce repeated metadata load latency and improve cross-view responsiveness | Phase 7 | Build compiles and cached views render with refresh + freshness indicators |
| 2026-04-14-A | Semantic Analyzer UX hardening: restored "Used in reports" column, added report-usage filter, added per-entity jump-to-report-scanner menu (↗ Open), fixed bidirectional cross-view jump navigation, added ↗ icons to Report Scanner jump buttons | Improve entity impact visibility and make Semantic Analyzer ↔ Report Scanner navigation fully bidirectional | Phase 3/6 | Semantic Analyzer list shows report usage per entity; jump navigation works in both directions; ↗ icon present on all jump buttons |
| 2026-04-14-B | Refactoring: extracted cross-view sessionStorage key constants into shared InsightWorkbenchNavKeys.ts module | Eliminate magic-string duplication across SemanticAnalyzerView.tsx and ReportScannerView.tsx; future key changes are safe and central | Phase 7 | Build compiles; all jump navigation continues to work after constant extraction |
| 2026-04-20-A | Report Scanner: added inline "Compare to..." diff panel with word-level highlights, synchronized scroll, and ignore-order mode for both Report Scanner and Semantic Analyzer modules | Enable ALM-style before/after comparison directly in the analyzer views without leaving the workbench | Phase 6 | Both diff views render with green/red/yellow highlights, token-level diffs, synchronized scroll, and ignore-order toggle |
| 2026-04-20-B | Bug fix: Report Scanner selection reverting to previous report after user change | Root cause: `persistSelectedReportKey` was a reactive dependency of the deep-link `useEffect`; parent re-render recreated the callback which re-fired the effect with the old URL, overwriting the fresh selection. Fixed by introducing `persistSelectedReportKeyRef` so the deep-link and jump-nav effects hold a stable ref and do not re-fire on parent re-renders | Phase 7 | Selecting a report in Report Scanner updates the URL and stays selected; no reversion observed |

## Implementation Notes - Metadata Cache Layer (2026-04-13)
- Persisted shared artifact catalog in item definition as the primary cache for metadata-driven views.
- Added persisted lineage cache (links + permission summary) in Lineage Graph state for cache-first startup.
- Added persisted report-definition cache in Report Scanner state keyed by workspace/report for cache-first detail loading.
- Manual refresh is available in Metadata Explorer (catalog owner), Lineage Graph, Report Scanner, and Requirements Board.
- Freshness badges show last refresh timestamps in views that consume the cache.

## Open Points
- Confirm API availability per tenant for artifact definition extraction (Dataflow/Notebook/Pipeline).
- Calibrate confidence scoring strategy for inferred lineage links.
- Define role-based governance for promoting proposal-mode writeback beyond MVP.

## Permanent Storage Recommendation (2026-04-13)

Based on current Fabric Extensibility Toolkit guidance:

- Item definition (state) SHOULD store lightweight, portable configuration and references.
- Durable item data SHOULD be stored in the item OneLake folder.
- External databases are valid for workload-specific operational scenarios, but are not the default for item content.

### Recommended Approach for Insight Workbench Tickets

1. Primary persistent store: OneLake in the InsightWorkbench item folder.
2. Reference state in item definition: store pointers/metadata only (for example active snapshot ID, last sync timestamp, schema version).
3. Optional operational mirror: external database (Azure SQL or Fabric SQL Database) for cross-item reporting and admin workloads.

### Why this is the recommended default

- Aligns with Fabric-native item lifecycle and portability.
- Survives browser reload, machine change, and environment restarts.
- Keeps item definition small and stable while allowing ticket history growth.
- Supports future CI/CD and item copy semantics more cleanly than frontend-only persistence.

### Storage Options Matrix

| Option | Fit for ticket durability | Pros | Tradeoffs |
|---|---|---|---|
| Item definition only | Low-Medium | Native and simple | Not intended for growing operational datasets/history |
| OneLake (item folder) | High (recommended) | Fabric-native durable storage, scalable, portable | Requires read/write integration layer |
| Azure SQL / Fabric SQL DB | High (optional complement) | Strong querying, governance, cross-item analytics | Extra backend, auth, schema migration, ops overhead |

### Target Data Contract (MVP)

- `tickets.json` (or partitioned JSON/Delta) in OneLake item folder
- `ticket_audit.json` for append-only audit trail
- `ticket_links.json` for artifact/semantic/link indexing

Item definition keeps only:

- `ticketStoreRef` (path/URI)
- `ticketStoreSchemaVersion`
- `ticketStoreLastWriteUtc`

### Implementation Phases (non-breaking)

1. Add a ticket storage adapter with `load()` and `save()` contract.
2. Implement OneLake adapter and switch Requirements Board reads/writes to adapter.
3. Keep current in-memory editing UX; persist on create/update/move/comment actions.
4. Add optimistic concurrency metadata (`etag` or version token).
5. Add optional SQL mirror as asynchronous projection (not source of truth).

### Acceptance Criteria

- Tickets persist across browser reload and full dev environment restart.
- Tickets remain available when opening the same item from a different session.
- No ticket loss on transient API failure (retry + error surface).
- Existing cached metadata features continue to work without regression.