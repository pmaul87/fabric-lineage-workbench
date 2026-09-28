# Semantic Analyzer Backend-Centric Refactoring Strategy

**Status**: Draft for Review  
**Date**: April 14, 2026  
**Scope**: Move all calculations from frontend React to backend Node.js with single source of truth and caching

## Executive Summary

Currently, the Semantic Analyzer performs **8 major graph algorithms and data transformations in the frontend React component** via useMemo hooks. This causes:
- ❌ Redundant calculations on every component re-render
- ❌ Complex interdependent state management 
- ❌ No reuse across different modules/users
- ❌ Difficult debugging when data is inconsistent
- ❌ Performance issues with large semantic models

**Proposed Solution**: Centralize all calculations in the **Node.js backend**, cache results in queryable format (SQL tables + JSON), and provide pre-computed data structures to the frontend.

---

## Current Architecture Analysis

### Frontend Calculations (SemanticAnalyzerView.tsx)

| # | Calculation | useMemo | Dependency | Cost |
|---|---|---|---|---|
| 1 | Filtered Entities | `filteredEntities` | entities, filters | O(n) per render |
| 2 | Entity Type Counts | `entityTypeCounts` | entities | O(n) per render |
| 3 | Selected Entity Lookup | `selectedEntity` | entities, selectionId | O(n) per render |
| 4 | Transitive Dependencies (Depends On) | `dependsOnEntities` | dependencies, selectedEntity | O(n+e) BFS per render |
| 5 | Relationship Filter Context | `relationshipFilterContext` | dependencies, selectedEntity | O(n+e) transitive traversal |
| 6 | Depended On Edges | `dependedOnEdges` | dependencies, selectedEntity | O(n+e) per render |
| 7 | Depended On Entities | `dependedOnByEntities` | dependedOnEdges, entities | O(n) per render |
| 8 | Report Usage Analysis | ReportUsageModel | entities, dependencies | Multiple API calls per model |

### Backend Services (SemanticAnalyzerService.js)

- ✅ Loads entities via INFO.VIEW.TABLES/COLUMNS/MEASURES
- ✅ Loads expression dependencies via INFO.DEPENDENCIES/INFO.CALCDEPENDENCY
- ❌ No pre-calculation of derived data
- ❌ No caching layer 
- ❌ No persistence for reuse

### Data Flow (Current)

```
Backend API (SemanticAnalyzerService.js)
  └─> Raw entities[] + dependencies[]
      └─> Frontend (SemanticAnalyzerView.tsx)
          ├─> Calculation #1: filteredEntities
          ├─> Calculation #2: entityTypeCounts
          ├─> Calculation #3-7: Graph traversals
          └─> Calculation #8: Report usage API calls
              └─> UI Render
```

---

## Proposed Architecture

### Backend-Centric Data Flow

```
┌─ Semantic Model Load (first time per model)
│  └─> SemanticAnalyzerService.js
│      ├─> Load raw entities, dependencies
│      ├─> COMPUTE all derived data (counts, transitive deps, report usage)
│      └─> PERSIST to Cache Layer (SQL tables + JSON)
│
├─ Cache Layer
│  ├─ semantic_model_cache (SQL table)
│  │  └─> model_id, workspace_id, entities_json, dependencies_json, metadata
│  │
│  ├─ entity_aggregates (SQL table)
│  │  └─> model_id, entity_type, count, hidden_count, used_in_reports_count
│  │
│  ├─ entity_relationships (SQL table)
│  │  └─> model_id, entity_id, depends_on_ids[], depended_on_by_ids[]
│  │
│  ├─ entity_report_usage (SQL table)
│  │  └─> model_id, entity_id, report_references, direct/indirect usage
│  │
│  └─ entity_statistics (SQL table)
│     └─> model_id, entity_id/table_name, row_count, column_count, etc.
│
└─ Frontend Read (any time a user views analyzer)
   └─> API Response (SemanticAnalyzerClient)
       ├─ entities[] 
       ├─ dependencies[]
       ├─ entityCounts: { Table: 42, Column: 156, Measure: 89, ... }
       ├─ entityRelationships: { [entityId]: { dependsOn[], dependedOnBy[] } }
       ├─ entityReportUsage: { [entityId]: { reports[], usageKind, count } }
       ├─ entityStatistics: { [entityId]: { rowCount, cardinality, etc. } }
       └─ UI renders directly with NO calculations
```

---

## Implementation Roadmap

### Phase 1: Cache Schema & Backend Infrastructure (Tasks 3-4)

**Objective**: Create persistent cache storage and initialization

#### Tasks:
1. **Create Cache Schema** 
   - SQL tables in existing ReportScannerPersistenceService pattern
   - Tables: semantic_model_cache, entity_aggregates, entity_relationships, entity_report_usage, entity_statistics
   - JSON format for complex data (entities_json, dependencies_json, denormalized_relationships_json)

2. **Extend SemanticAnalyzerService with Cache Manager**
   - `calculateAndCacheModelData(workspaceId, datasetId, entities, dependencies)`
   - `getCachedModelData(workspaceId, datasetId)` 
   - `isCacheValid(workspaceId, datasetId)` - TTL check
   - `invalidateCache(workspaceId, datasetId)` - Manual invalidation

### Phase 2: Backend Calculation Engine (Tasks 5-8)

**Objective**: Move all 8 calculations from frontend to backend

#### Tasks by Calculation:

**Task 5: Backend Filtered Entities**
- Create `calculateEntityAggregates()` function
- Compute entity type counts 
- Pre-filter by visibility (hidden/visible)
- Store in entity_aggregates table
- **Result**: Frontend gets `{ Table: 42, Column: 156, Measure: 89 }` as pre-computed counts

**Task 6: Backend Transitive Dependency Traversal**
- Create `calculateTransitiveDependencies()` function  
- BFS traversal for each entity to find all direct/indirect dependencies
- Build denormalized relationship map: `{ entityId: { dependsOn: [...], dependedOnBy: [...] } }`
- Store in entity_relationships table as JSON
- **Result**: Frontend gets pre-computed dependency lists per entity (no BFS needed)

**Task 7: Backend Report Usage Scanning**
- Extend ReportScannerPersistenceService for semantic model entity usage
- Move `loadSemanticModelReportUsage()` logic to backend
- Cache report usage results in entity_report_usage table
- Implement incremental scanning (only scan new/modified reports)
- **Result**: Frontend receives pre-computed `{ entityId: { reports[], usageKind, count } }`

**Task 8: Backend Statistics Pre-Computation**
- Calculate table row counts, column cardinality, etc. during model load
- Store in entity_statistics table
- Index by model_id + entity_id for fast lookup
- **Result**: Frontend gets statistics immediately without on-demand queries

### Phase 3: API & Frontend Updates (Tasks 9-10)

**Objective**: Refactor API contract and eliminate frontend calculations

#### Tasks:

**Task 9: Simplify Frontend Component**
- Remove all useMemo calculation hooks (#1-7)
- Replace with direct data rendering from context
- Remove ReportUsageModel calculations from frontend
- Minimal component: receives pre-computed data, renders only

**Task 10: Update API Contracts**
- Extend SemanticAnalyzerClient.loadModelEntities() response:
  ```typescript
  interface LoadModelEntitiesResponse {
    entities: SemanticEntity[];
    dependencies: SemanticDependency[];
    // NEW - pre-computed data:
    entityCounts: Record<SemanticEntityType, number>;
    entityRelationships: Record<string, { dependsOn: string[], dependedOnBy: string[] }>;
    entityReportUsage: Record<string, { reports: ReportReference[], directCount: number }>;
    entityStatistics: Record<string, { rowCount?: number, cardinality?: number, etc. }>;
  }
  ```

### Phase 4: Testing & Optimization (Tasks 11-13)

**Objective**: Validate correctness and optimize performance

#### Tasks:

**Task 11: Validation Tests**
- Compare backend calculations with current frontend results
- Verify cache consistency
- Test with large semantic models (1000+ entities)

**Task 12: Query Performance**
- Index entity_relationships and entity_report_usage by (model_id, entity_id)
- Cache JSON aggregation queries
- Test latency improvements

**Task 13: Documentation**
- Update architecture docs with cache layer
- Document cache invalidation strategy
- Create runbook for debugging cache issues

---

## Cache Invalidation Strategy

### Automatic Invalidation
- Model refresh triggered when user manually loads a new model
- Backend detects structural changes (new/deleted entities)
- TTL-based expiration (configurable, default: 24 hours)

### Manual Invalidation
- Admin endpoint: `POST /api/semantic-analyzers/{modelId}/cache/invalidate`
- Used after major manifest changes
- Used after fixing data quality issues

### Incremental Updates
- Report usage: Only scan new reports since last scan
- Statistics: Update on-demand when user requests specific table stats
- Dependencies: Full recalculation only on model refresh

---

## Storage Considerations

### SQL Tables Option (Recommended)
- ✅ Queryable
- ✅ Indexed
- ✅ Persistent  
- ✅ Can be used in Power BI dashboards
- ❌ Row size limits

### JSON Single-Cell Option  
- ✅ Large payloads
- ❌ Not queryable
- ❌ Harder to debug

### Hybrid Approach (Recommended)
- SQL tables for structure (model_id, entity_id, counts)
- JSON columns for denormalized data (depends_on, depended_on_by)
- Example:
  ```sql
  CREATE TABLE entity_relationships (
    id BIGINT PRIMARY KEY,
    model_id NVARCHAR(MAX),
    entity_id NVARCHAR(MAX),
    relationship_type NVARCHAR(50),  -- "depends_on" or "depended_on_by"
    target_entity_ids NVARCHAR(MAX),  -- JSON array or CSV
    depth_info JSON  -- { "maxDepth": 3, "count": 42 }
  )
  ```

---

## Benefits Summary

### Performance
- ✅ **Zero runtime calculations** in frontend
- ✅ **Instant data rendering** (no useMemo overhead)
- ✅ **Reusable across users/modules** (shared cache)
- ✅ **Network efficient** (single API call vs. multiple)

### Maintainability  
- ✅ **Single source of truth** for all calculations
- ✅ **Easier debugging** (check backend cache vs. frontend React)
- ✅ **Consistent data** across all views
- ✅ **Testable calculations** (backend unit tests)

### Scalability
- ✅ **Works with large models** (1000+ entities)
- ✅ **Offloads work from browser** to server
- ✅ **Cache reused across users**
- ✅ **Queryable for dashboards/analytics**

### Enterprise Features
- ✅ **Audit trail** (all calculations stored in DB)
- ✅ **Export support** (can query and export cached data)
- ✅ **Compliant** (data stays in customer infrastructure)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Cache gets stale | Implement cache validation + TTL |
| Migration takes too long | Phase implementation (start with calculations #1-2) |
| Backend performance impact | Offload cache generation to background job |
| Database storage limits | Compression for JSON columns, archive old models |

---

## Success Criteria

- [ ] All calculations moved to backend
- [ ] Frontend SemanticAnalyzerView uses zero useMemo hooks
- [ ] API response time < 500ms for models with < 1000 entities
- [ ] Cache hit rate > 95% for repeated model views
- [ ] Consistent results between backend and previous frontend calculations
- [ ] No breaking changes to frontend data contracts (gradual migration)
- [ ] Documented cache management procedures

---

## Next Steps

1. **Review this strategy** with team
2. **Prioritize phases** (suggest: Phase 1 → Phase 2 → Phase 3 → Phase 4)
3. **Start with Phase 1** (cache schema setup)
4. **Iterate through phases** with validation testing each phase

---

## Questions for Clarification

1. Should cache be stored in Fabric SQL Database or separate backend DB?
2. What's the acceptable cache TTL? (suggested: 24h for dev, 1h for prod)
3. Should cache size be limited per model, or disk-based?
4. Should report usage scanning be real-time or batch?
5. Which calculations are highest priority (start there)?

---

*This document is a living strategy. Update as implementation progresses and learnings emerge.*
