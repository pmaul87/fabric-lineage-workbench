# LineageExtractor Architecture

Phase 0: Scaffolding - Architecture documentation

## Architecture Decisions

### 1. Item-Based Extraction
**Decision**: Implement extraction as a Fabric custom item (LineageExtractor)

**Rationale**:
- Integrated into Fabric workspace experience
- Uses Fabric authentication and permissions
- Leverages ItemEditor component patterns
- Consistent with Fabric platform conventions

### 2. Semantic Link for Semantic Models
**Decision**: Use semantic-link and semantic-link-labs for Semantic Model extraction

**Rationale**:
- **Official Microsoft approach** for Semantic Model access
- Provides granular access to measures, columns, relationships
- Python-based, runs in Fabric notebooks
- Well-documented and supported by Microsoft

**Implementation**:
- Notebooks use semantic-link-labs functions: `list_measures()`, `list_columns()`, `list_relationships()`, `list_functions()`
- Results saved to lakehouse for processing
- Triggered via Spark Livy API from custom item

### 3. OneLake Storage
**Decision**: Store all lineage data in OneLake lakehouse

**Rationale**:
- Native Fabric storage (no external database needed)
- Accessible by all Fabric services
- Supports large-scale data
- Integration with OneLakeStorageClient

**Storage Structure**:
```
Files/
  lineage/
    raw/
      semantic_models/
        {model_id}.json       # Raw semantic link output
      reports/
        {report_id}.json      # Report definition metadata
      notebooks/
        {notebook_id}.json    # Notebook metadata
      ...
    processed/
      {workspace_id}_graph.json    # Processed lineage graph
      {workspace_id}_snapshot_{timestamp}.json  # Versioned snapshots
    metadata/
      extraction_log_{timestamp}.json   # Extraction logs
      config.json                       # Configuration
```

### 4. Spark Livy Integration
**Decision**: Use Spark Livy API for programmatic notebook execution

**Rationale**:
- Enables triggering semantic link notebooks from custom item UI
- Monitors execution progress
- Retrieves results from lakehouse after completion
- No manual notebook execution required

**Workflow**:
1. Create Spark Livy session
2. Submit notebook statements
3. Poll session status
4. Retrieve results from lakehouse

### 5. Frontend-Only Extraction (Phase 1)
**Decision**: Implement extraction logic in frontend for Phase 1

**Rationale**:
- Simpler architecture for initial implementation
- No backend deployment required
- Uses user authentication (delegated tokens)
- Backend deferred to Phase 2 for visualization processing

**Phase 2**: Backend service added for graph processing and visualization

### 6. Multi-Phase Development
**Decision**: Implement in phases (Scaffolding → Extraction → Backend/Visualization → Kanban)

**Rationale**:
- Incremental delivery and validation
- Focus on core extraction functionality first
- Backend complexity deferred until visualization needed
- Allows early feedback and iteration

## Component Architecture

### Item Editor Flow
```
LineageExtractorItemEditor
├── ItemEditor (container)
│   ├── LineageExtractorItemRibbon (actions: Save, Settings, Extract)
│   └── Content
│       ├── LineageExtractorItemEmptyView (first-time setup)
│       └── LineageExtractorItemDefaultView (configuration UI)
│           ├── Left Panel: Workspace selector (OneLakeView pattern)
│           └── Center Panel: Configuration form
```

### Extraction Flow
```
User clicks "Extract Lineage"
  ↓
ExtractionOrchestrator.startExtraction()
  ↓
For each workspace:
  ├── For Semantic Models: SemanticLinkClient.executeNotebookExtraction()
  │   ├── Spark Livy session created
  │   ├── Notebook executes (semantic-link-labs)
  │   └── Results saved to lakehouse
  │
  ├── For other artifacts: FabricLineageClient.extract*Metadata()
  │   ├── Get item definition via ItemClient
  │   ├── Parse metadata
  │   └── Save to lakehouse
  │
  └── LineageGraphBuilder.buildGraph()
      ├── Load raw extraction data
      ├── Build nodes and edges
      └── Save processed graph
```

### Storage Flow
```
OneLakeLineageStorage.initializeForItem(lakehouseId)
  ↓
OneLakeStorageClient.createItemWrapper()
  ↓
Save operations:
  itemWrapper.writeFileAsText(path, data)
  
Load operations:
  itemWrapper.readFileAsText(path)
```

## Security Architecture

### Authentication
- **User Context**: WorkloadClient.auth.acquireFrontendAccessToken()
- **Scopes**: ITEM_READ, WORKSPACE_READ
- **Permissions**: User must have access to target workspaces

### Data Privacy
- Only metadata extracted (no actual data content)
- Respects workspace permissions
- Stored in user-controlled lakehouse

### Multi-Tenant (Future)
- Entra App configured with `AzureADMultipleOrgs`
- Prepares for partner workload publication

## Performance Considerations

### Extraction
- **Parallel Processing**: Extract multiple artifacts concurrently where possible
- **Pagination**: Handle large workspaces with item pagination
- **Error Recovery**: Continue extraction even if individual items fail

### Storage
- **Snapshots**: Timestamp-based versioning for lineage data
- **Compression**: Consider JSON compression for large graphs (Phase 2)

### Scalability
- **Phase 1**: Frontend extraction suitable for small-medium workspaces (< 100 items)
- **Phase 2**: Backend service for large-scale workspaces (100+ items)

## Technology Stack

### Frontend
- TypeScript
- React 18
- Fluent UI v9
- Fabric Workload Client SDK

### Python (Notebooks)
- semantic-link
- semantic-link-labs
- PySpark

### Backend (Phase 2)
- Node.js/TypeScript
- Express.js
- Service principal authentication

## Design Patterns

### Item Editor Pattern
- Follows HelloWorld item structure exactly
- Uses ItemEditor, ItemEditorDefaultView, ItemEditorEmptyView components
- Standard Ribbon with createSaveAction, createSettingsAction

### Client Pattern
- Extends FabricPlatformClient
- Uses WorkloadClient for authentication
- Proper error handling and retry logic

### Storage Pattern
- Always use createItemWrapper() for item-scoped operations
- Never construct paths manually
- Use proper folder structure

## Future Considerations

### Phase 2 Enhancements
- Backend service for graph processing
- Real-time lineage updates
- Advanced querying (upstream/downstream, impact analysis)

### Phase 3 Enhancements
- Kanban board integration
- Requirements linking to lineage artifacts

### Advanced Features
- Job scheduling for automated extractions
- Export to industry standards (OpenLineage, Atlas)
- Collaboration features (shared lineage views)

## References

- [Fabric Extensibility Toolkit](../../../README.md)
- [ItemEditor Documentation](../../components/ItemEditor.md)
- [Semantic Link Labs](https://pypi.org/project/semantic-link-labs/)
- [Fabric Workload Client SDK](https://learn.microsoft.com/fabric/workload-development-kit/)
