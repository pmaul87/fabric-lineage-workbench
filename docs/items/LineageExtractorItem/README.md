# LineageExtractor Item

Phase 0: Scaffolding complete

## Overview

The LineageExtractor item enables users to extract and store lineage metadata from Fabric artifacts at a granular level. This includes Semantic Models, Reports, Lakehouses, Data Warehouses, Pipelines, and Dataflows.

## Purpose

- **Extract**: Gather granular metadata from Fabric workspaces (columns, measures, visuals, tables, etc.)
- **Store**: Save lineage data in OneLake lakehouse for analysis
- **Trace**: Build lineage graphs showing dependencies between artifacts
- **Visualize**: Make impact and dependency paths understandable for both developers and business users

## Key Features (Phase 1)

- Configuration UI for workspace and artifact selection
- Semantic link integration for Semantic Model extraction
- Spark Livy integration for programmatic extraction jobs
- OneLake storage with organized folder structure
- Progress tracking and error handling

## New Phase: Dependency Graph and Impact View (Phase 2)

The project now includes processing logic to create a dependency graph from extracted Delta tables.

### What can be visualized

- **Report visual -> semantic model dependencies**
  - Which visuals consume which semantic model objects
  - Which reports contain those visuals
- **Semantic model internal dependencies**
  - Table -> column and table -> measure containment
  - Relationship links between columns
  - DAX-based dependencies (measure -> column, measure -> measure, calculated column -> column)

### Why this helps

- **Developers** can run impact checks before changing a table/column/measure.
- **Business users** can discuss requirements with clear upstream/downstream context.

### Dependency graph outputs

The processing step builds managed Delta tables:

- `lineage_graph_nodes`
- `lineage_graph_edges`
- `lineage_graph_lineage_paths` (summary)

These outputs are produced by:

- `Workload/app/clients/lineage/FabricLineageClient.ts`

### Quick usage

1. Run the extraction flow first.
2. Rebuild the graph tables from the extracted data.
3. Use the impact tracing helper to inspect downstream dependencies from a starting node.

## Architecture

### Item Structure (Phase 0 - Scaffolded)
- `LineageExtractorItemDefinition.ts` - Item state interface
- `LineageExtractorItemEditor.tsx` - Main editor component
- `LineageExtractorItemDefaultView.tsx` - Configuration view
- `LineageExtractorItemEmptyView.tsx` - First-time user experience
- `LineageExtractorItemRibbon.tsx` - Toolbar with actions

### Clients (Phase 0 - Scaffolded)
- `FabricLineageClient.ts` - Extraction logic for non-semantic artifacts
- `SemanticLinkClient.ts` - Semantic link integration wrapper
- `OneLakeLineageStorage.ts` - Lakehouse storage management

### Services (Phase 0 - Scaffolded)
- `ExtractionOrchestrator.ts` - Extraction workflow orchestration
- `LineageGraphBuilder.ts` - Graph building from extracted metadata

## Usage (Phase 1)

### Configuration
1. Create LineageExtractor item in workspace
2. Select target workspaces to extract from
3. Choose artifact types (Semantic Models, Reports, etc.)
4. Select target lakehouse for storage
5. Configure granularity settings

### Extraction
1. Click "Extract Lineage" ribbon action
2. Monitor progress in UI
3. View extraction logs
4. Check lakehouse for results

### Storage Structure
```
Files/
  lineage/
    raw/              # Raw extraction data per artifact
      semantic_models/
      reports/
      ...
    processed/        # Processed lineage graphs
    metadata/         # Extraction logs and metadata
```

## Implementation Phases

### Phase 0: Scaffolding (Current) ✅
- Project structure established
- Placeholder files created
- Documentation framework in place

### Phase 1: Core Extraction (Next)
- Implement FabricLineageClient methods
- Add semantic link job integration
- Build extraction orchestration
- Implement OneLake storage
- Add configuration UI

### Phase 2: Backend & Visualization
- Create backend service for graph processing
- Implement LineageViewer item
- Add graph rendering

### Phase 3: Kanban Board
- Implement requirements tracking board

## Technical Details

### Dependencies
- `@ms-fabric/workload-client` - Fabric platform integration
- Fluent UI v9 - UI components
- semantic-link and semantic-link-labs

### Authentication
- User token delegation for workspace access
- OAuth scopes: ITEM_READ, WORKSPACE_READ

### Data Format
- JSON for all lineage data
- Timestamp-based snapshots for versioning

## Development

See [Architecture.md](Architecture.md) for detailed architecture decisions.
See [SemanticLink.md](SemanticLink.md) for semantic link integration guide.
See [DataSchema.md](DataSchema.md) for lineage data schema documentation.

## TODO Phase 1

- [ ] Implement configuration UI (workspace selector, artifact selection)
- [ ] Add FabricLineageClient extraction methods
- [ ] Implement SemanticLinkClient with Spark Livy integration
- [ ] Build OneLakeLineageStorage save/load logic
- [ ] Create ExtractionOrchestrator workflow
- [ ] Add progress tracking and error handling
- [ ] Implement save/settings handlers
- [ ] Add extraction status UI
- [ ] Create test scenarios and documentation
