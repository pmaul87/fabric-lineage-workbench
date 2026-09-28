# Views Integration Guide

## Overview
The `05_build_lineage_views.ipynb` notebook creates SQL views that optimize lineage queries by pre-joining data.

## Created Views

### Simple Enrichment Views (Fast Lookups)
**Purpose**: Eliminate manual joins in frontend JavaScript

| View | Purpose | Key Benefit |
|------|---------|-------------|
| `vw_report_visuals_enriched` | Visuals + dataset_id | No more `uniqueReports.get(reportId)` |
| `vw_report_pages_enriched` | Pages + dataset_id | Pre-joined parent report data |

### Advanced Analysis Views (Complex Queries)
**Purpose**: Enable deep lineage analysis with semantic model metadata

| View | Purpose | Use Case |
|------|---------|----------|
| `v_report_to_dataset_summary` | Report-to-dataset mapping with counts | Report inventory, usage stats |
| `v_report_visual_to_semantic_model` | Visuals to columns/measures with lineage tags | Impact analysis, field usage |

## Integration Steps

### 1. Run View Creation (One-Time Setup)

```python
# In Fabric Notebook attached to LineageScanner lakehouse
# Run: 05_build_lineage_views.ipynb
# Expected output:
✅ vw_report_visuals_enriched: 36 rows
✅ vw_report_pages_enriched: 12 rows  
✅ v_report_to_dataset_summary: 1 rows
✅ v_report_visual_to_semantic_model: 96 rows
```

### 2. Update Backend Queries (Optional - Already Done!)

The backend `LakehouseAnalyzerService.js` already recognizes these views in `LINEAGE_OPTIONAL_TABLES`.

**Before (manual joins):**
```javascript
// Load separately
const reports = await queryTable('lineage_reports');
const visuals = await queryTable('lineage_report_visuals');

// Manual lookup in JavaScript
for (const visual of visuals) {
  const report = reports.find(r => r.report_id === visual.report_id);
  const datasetId = report?.dataset_id;
}
```

**After (using views):**
```javascript
// One query, already enriched
const visuals = await queryTable('vw_report_visuals_enriched');

// dataset_id already included!
for (const visual of visuals) {
  const datasetId = visual.dataset_id; // ✅ No lookup needed
}
```

### 3. Simplify Frontend Code (Future Optimization)

**Current Code** (`LineageWorkbenchItemLineageView.tsx` lines 795-850):
```typescript
// Manual lookup pattern
const uniqueReports = new Map(reportsDimension.map(r => [r.report_id, r]));

for (const visual of uniqueReportVisuals.values()) {
  const report = uniqueReports.get(reportId);
  const datasetId = report?.dataset_id || report?.datasetid;
  
  result.push({ 
    datasetId: datasetId, // From manual lookup
    // ...
  });
}
```

**Optimized (using views)**:
```typescript
// Backend loads from view - no frontend lookup needed
const reportVisualsDimension = await LakehouseAnalyzerService.getLineageData({
  lakehouseId,
  workspaceId,
  token
});

// dataset_id already in the data!
for (const visual of reportVisualsDimension.vw_report_visuals_enriched) {
  result.push({
    datasetId: visual.dataset_id, // ✅ Pre-joined in view
    // ...
  });
}

// Remove: const uniqueReports = new Map(...); ← No longer needed!
```

## Performance Impact

| Metric | Before (Manual Joins) | After (Views) |
|--------|----------------------|---------------|
| **Query Count** | 2+ (reports + visuals) | 1 (view) |
| **Frontend Lookups** | O(n) Map lookups | None |
| **Memory Usage** | uniqueReports Map stored | No extra maps |
| **Consistency** | Manual join logic | Lakehouse optimized |

**Estimated Improvement**: 30-50% faster for large datasets (100+ visuals)

## Query Examples

### Find All Visuals Using a Dataset
```sql
SELECT 
  visual_name,
  parent_report_name,
  dataset_name,
  visual_type
FROM vw_report_visuals_enriched
WHERE dataset_id = '<your-dataset-id>'
ORDER BY parent_report_name, page_name, visual_name
```

### Find Which Visuals Use a Specific Column
```sql
SELECT 
  report_name,
  page_name,
  visual_name,
  object_name,
  object_type,
  lineage_tag
FROM v_report_visual_to_semantic_model
WHERE object_name = 'Revenue'
  AND table_name = 'FactSales'
ORDER BY report_name, visual_name
```

### Report Summary with Dataset Stats
```sql
SELECT 
  report_name,
  dataset_name,
  count_visuals,
  count_semantic_model_objects,
  count_columns,
  count_measures
FROM v_report_to_dataset_summary
ORDER BY count_visuals DESC
```

## Maintenance

### When to Recreate Views
- After schema changes to base tables
- After adding new extraction logic
- If view queries fail (invalid dependencies)

### How to Recreate
```python
# Re-run the notebook
# Views use CREATE OR REPLACE - safe to run multiple times
```

### Troubleshooting

**View not found:**
```
Error: Table or view not found: vw_report_visuals_enriched
```
→ Run `05_build_lineage_views.ipynb` in the LineageScanner lakehouse

**Empty view results:**
```
SELECT COUNT(*) FROM vw_report_visuals_enriched; -- Returns 0
```
→ Check base table: `SELECT COUNT(*) FROM lineage_report_visuals`  
→ If base table empty, run `02_extract_reports.ipynb`

**Missing dataset_id:**
```
SELECT * FROM vw_report_visuals_enriched WHERE dataset_id IS NULL
```
→ These visuals have reports without semantic models  
→ Check: `SELECT * FROM lineage_reports WHERE dataset_id IS NULL`

## Next Steps

1. ✅ **Views Created** - Run `05_build_lineage_views.ipynb` once
2. ✅ **Backend Updated** - LakehouseAnalyzerService recognizes views
3. ⏳ **Frontend Optimization** (Optional) - Simplify `LineageWorkbenchItemLineageView.tsx` to use views
4. ⏳ **Testing** - Verify visual nodes have `nodeModelId` populated
5. ⏳ **Performance Monitoring** - Compare query times before/after

## Benefits Summary

✅ **Faster Queries** - Lakehouse SQL engine optimizes joins  
✅ **Less Code** - Remove manual Map lookups in TypeScript  
✅ **Better Consistency** - Same dataset_id logic everywhere  
✅ **Easier Debugging** - Query views directly in SQL Analytics  
✅ **No Flexibility Loss** - Raw tables still available

---

**Last Updated**: 2026-05-20  
**Related Files**:
- Notebook: `Workload/notebooks/extraction/05_build_lineage_views.ipynb`
- Backend: `Workload/devServer/services/LakehouseAnalyzerService.js`
- Frontend: `Workload/app/items/LineageWorkbenchItem/LineageWorkbenchItemLineageView.tsx`
