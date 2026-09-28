# Fabric Lineage Workbench - Development Guide

Phase 0: Scaffolding complete - Ready for Phase 1 implementation

## Overview

Fabric Lineage Workbench is a custom Microsoft Fabric workload for extracting and visualizing lineage metadata at granular levels (columns, measures, visuals, etc.).

## Project Structure

```
Fabric Lineage Workbench/
├── Workload/
│   ├── app/                           # Frontend application
│   │   ├── items/
│   │   │   └── LineageExtractorItem/  # Lineage extraction item
│   │   ├── clients/
│   │   │   └── lineage/               # Lineage-specific clients
│   │   ├── services/
│   │   │   └── lineage/               # Orchestration and graph building
│   │   └── components/                # Shared UI components
│   ├── Manifest/                      # Workload manifest and item definitions
│   ├── devServer/                     # Development server
│   └── notebooks/                     # Fabric notebooks for extraction
├── docs/                              # Documentation
│   ├── items/LineageExtractorItem/    # Item-specific documentation
│   └── components/                    # Component documentation
├── scripts/                           # Development and deployment scripts
│   ├── Setup/                         # Project setup scripts
│   ├── Run/                           # Development server scripts
│   ├── Build/                         # Build and packaging scripts
│   └── Deploy/                        # Deployment scripts
└── tools/                             # Development tools (DevGateway)
```

## Development Phases

### ✅ Phase 0: Scaffolding (COMPLETE)
**Branch**: `feature/phase0-scaffolding`

**Objectives**:
- Establish project structure
- Create placeholder files for all components
- Set up documentation framework
- Prepare for Phase 1 implementation

**Completed**:
- ✅ LineageExtractorItem scaffolding (Editor, Views, Ribbon, Styles)
- ✅ Client scaffolding (FabricLineageClient, SemanticLinkClient, OneLakeLineageStorage)
- ✅ Service scaffolding (ExtractionOrchestrator, LineageGraphBuilder)
- ✅ Notebook scaffolding (Setup, Extraction, Processing notebooks)
- ✅ Documentation structure (README, Architecture, SemanticLink, DataSchema)
- ✅ Manifest configuration (JSON, XML, Product.json, translations)
- ✅ App routing and translation strings

**Next**: Merge to `main`, create Phase 1 branch

---

### 🔧 Phase 1: Core Extraction (NEXT)
**Branch**: `feature/phase1-core-extraction`

**Objectives**:
- Implement lineage extraction for all artifact types
- Integrate semantic-link for Semantic Model extraction
- Build graph construction logic
- Implement OneLake storage operations

**Tasks**:
1. **Configuration UI**
   - Workspace selector (OneLakeView pattern)
   - Artifact type selection (checkboxes)
   - Lakehouse picker
   - Granularity settings

2. **FabricLineageClient Implementation**
   - `extractReportMetadata()` - Parse report definitions
   - `extractNotebookMetadata()` - Parse .ipynb files
   - `extractLakehouseMetadata()` - Discover schemas
   - `extractWarehouseMetadata()` - Query table metadata
   - `extractPipelineMetadata()` - Parse pipeline JSON
   - `extractDataflowMetadata()` - Extract dataflow definitions

3. **SemanticLinkClient Implementation**
   - Spark Livy session management
   - Notebook execution with semantic-link-labs
   - Progress monitoring
   - Result retrieval from lakehouse

4. **OneLakeLineageStorage Implementation**
   - `initializeForItem()` - Set up itemWrapper
   - `saveExtractionResult()` - Write JSON to lakehouse
   - `loadLineageData()` - Read extraction results
   - `createSnapshot()` - Versioned lineage snapshots

5. **ExtractionOrchestrator Implementation**
   - `startExtraction()` - Orchestrate full workflow
   - Progress tracking and status updates
   - Error handling and recovery
   - Extraction logging

6. **LineageGraphBuilder Implementation**
   - `buildGraph()` - Construct nodes and edges from raw data
   - Relationship inference logic
   - Graph validation

7. **Notebook Implementation**
   - `00_setup.ipynb` - semantic-link installation
   - `01_extract_semantic_models.ipynb` - Full extraction logic
   - Other extraction notebooks (reports, notebooks, etc.)
   - `build_lineage_graph.ipynb` - Graph construction

8. **UI Implementation**
   - Update LineageExtractorItemDefaultView with configuration form
   - Add workspace selector (left panel)
   - Implement save/settings handlers
   - Add extraction progress indicators
   - Display extraction status and logs

**Testing**:
- Unit tests for each client method
- Integration tests for full extraction workflow
- Test with sample Fabric workspaces
- Validate graph construction
- Verify OneLake storage operations

---

### 📊 Phase 2: Backend & Visualization
**Branch**: `feature/phase2-backend-visualization`

**Objectives**:
- Create backend service for graph processing
// Removed: Implement LineageViewer item for visualization (now integrated into Workbench)
- Add advanced querying capabilities

**Tasks**:
1. **Backend Service (Node.js/TypeScript)**
   - Express.js REST API
   - Service principal authentication
   - Graph processing endpoints
   - Impact analysis queries
   - Upstream/downstream tracing

// Removed: 2. **LineageViewer Item** (now integrated into Workbench)
   - Graph rendering with React Flow or D3.js
   - Interactive exploration (zoom, pan, filter)
   - Drill-down to entity details
   - Impact analysis visualization

3. **Advanced Features**
   - Real-time lineage updates
   - Lineage search and filtering
   - Export capabilities (JSON, CSV, OpenLineage)

---

### 📋 Phase 3: Kanban Board
**Branch**: `feature/phase3-kanban`

**Objectives**:
- Implement requirements tracking board
- Link requirements to lineage artifacts
- Provide impact analysis for changes

**Tasks**:
1. KanbanBoard item creation
2. Requirement-to-artifact linking
3. Impact analysis integration

---

## Development Workflow

### Prerequisites
- Node.js 18+ and npm
- PowerShell 7+
- Fabric workspace with admin permissions
- Azure tenant (for Entra app registration)

### Initial Setup
```powershell
# Clone repository
git clone <repository-url>
cd fabric-lineage-workbench

# Run setup script
cd scripts/Setup
.\Setup.ps1

# Follow prompts to:
# 1. Download DevGateway
# 2. Create Entra app
# 3. Configure .env files
```

### Development Mode

#### Start DevGateway
```powershell
cd scripts/Run
.\StartDevGateway.ps1
```

#### Start Dev Server
```powershell
cd scripts/Run
.\StartDevServer.ps1
```

Access workload at: `http://localhost:60006/`

### Build and Deploy

#### Build Manifest Package
```powershell
cd scripts/Build
.\BuildManifestPackage.ps1
```

#### Deploy to Azure Web App
```powershell
cd scripts/Deploy
.\DeployToAzureWebApp.ps1 -ResourceGroupName "rg-fabric-workload" -WebAppName "my-workload"
```

## Branch Strategy

### Main Branch
- Always stable and deployable
- Only merge completed phases
- Protected branch (requires PR review)

### Feature Branches
- `feature/phase0-scaffolding` - Initial scaffolding ✅ COMPLETE
- `feature/phase1-core-extraction` - Extraction implementation 🔧 NEXT
- `feature/phase2-backend-visualization` - Backend and visualization
- `feature/phase3-kanban` - Kanban board

### Branch Workflow
1. Create feature branch from `main`
2. Implement phase objectives
3. Test thoroughly
4. Create PR for code review
5. Merge to `main` after approval
6. Delete feature branch
7. Create next phase branch from `main`

## Technology Stack

### Frontend
- **TypeScript** - Type-safe development
- **React 18** - UI framework
- **Fluent UI v9** - Microsoft design system
- **Workload Client SDK** - Fabric platform integration
- **SCSS** - Styling

### Python (Notebooks)
- **semantic-link** - Semantic Model access (official Microsoft library)
- **semantic-link-labs** - Advanced semantic link features
- **PySpark** - Data processing

### Backend (Phase 2)
- **Node.js 18+** - Runtime
- **TypeScript** - Type-safe development
- **Express.js** - REST API framework

### Tools
- **DevGateway** - Local Fabric emulation
- **Webpack** - Module bundling
- **PowerShell** - Automation scripts

## Key Design Decisions

### Semantic Link for Semantic Models
- **Why**: Official Microsoft approach for Semantic Model metadata extraction
- **Functions**: `list_measures()`, `list_columns()`, `list_relationships()`, `list_functions()`
- **Integration**: Via Spark Livy API for programmatic notebook execution

### OneLake Storage
- **Why**: Native Fabric storage, no external database
- **Pattern**: Always use `createItemWrapper()` for item-scoped operations
- **Structure**: `Files/lineage/raw/`, `Files/lineage/processed/`, `Files/lineage/metadata/`

### Frontend-First Extraction (Phase 1)
- **Why**: Simpler architecture, faster initial delivery
- **Trade-off**: Limited to user authentication, smaller workspaces
- **Evolution**: Backend service added in Phase 2 for scalability

### Multi-Phase Development
- **Why**: Incremental delivery, early feedback, manageable complexity
- **Phases**: Scaffolding → Extraction → Backend/Visualization → Kanban

## Configuration

### Environment Variables
Create `.env` file in `Workload/` directory:

```env
# Fabric configuration
WORKLOAD_NAME=YourWorkload
WORKLOAD_PUBLISHER_TENANT_ID=your-tenant-id
FRONTEND_CLIENT_ID=your-client-id
WORKLOAD_BE_CLIENT_ID=your-backend-client-id

# Development settings
DEV_MODE=true
DEV_GATEWAY_URL=http://localhost:5001
FRONTEND_BASE_URL=http://localhost:60006
```

### Manifest Configuration
Edit `Workload/Manifest/Product.json` for workload settings:
- Display name and description
- Item types and icons
- Feature flags
- Authentication settings

## Testing

### Local Testing
1. Start DevGateway
2. Start Dev Server
3. Create test workspace in Fabric
4. Create LineageExtractor item
5. Verify UI renders correctly
6. Test extraction workflow (Phase 1+)

### Integration Testing
- Test with real Fabric workspaces
- Verify semantic link integration
- Validate OneLake storage operations
- Check error handling

## Security

### Authentication
- **User Context**: Delegated tokens for workspace access
- **Service Principal** (Phase 2): Backend service authentication
- **Scopes**: ITEM_READ, WORKSPACE_READ

### Data Privacy
- Only metadata extracted (no actual data)
- Respects workspace permissions
- Stored in user-controlled lakehouse

### Multi-Tenant Support
- Entra app configured with `AzureADMultipleOrgs`
- Prepares for partner workload publication

## Semantic Link Integration

### Installation (in Fabric Notebook)
```python
%pip install semantic-link semantic-link-labs
```

### Key Functions
```python
from sempy_labs import list_measures, list_columns, list_relationships

# Extract Semantic Model metadata
measures = list_measures(dataset="model-name", workspace="workspace-name")
columns = list_columns(dataset="model-name", workspace="workspace-name")
relationships = list_relationships(dataset="model-name", workspace="workspace-name")
```

### Spark Livy Execution
```typescript
// Frontend triggers notebook via Spark Livy API
const sessionId = await semanticLinkClient.executeNotebookExtraction(
  workspaceId,
  lakehouseId,
  semanticModelId
);

// Monitor progress
const status = await semanticLinkClient.monitorExtractionProgress(sessionId);

// Retrieve results from lakehouse
const results = await oneLakeStorage.loadLineageData(semanticModelId);
```

## Documentation

### For Developers
- [Project Structure](../docs/Project_Structure.md)
- [ItemEditor Architecture](../docs/components/ItemEditor/Architecture.md)
- [LineageExtractor Architecture](../docs/items/LineageExtractorItem/Architecture.md)
- [Semantic Link Guide](../docs/items/LineageExtractorItem/SemanticLink.md)
- [Data Schema](../docs/items/LineageExtractorItem/DataSchema.md)

### For Users (Phase 1+)
- User Guide (TBD)
- Configuration Guide (TBD)
- Troubleshooting Guide (TBD)

## Troubleshooting

### Build Issues
```powershell
# Clear cache and rebuild
rm -rf node_modules
rm package-lock.json
npm install
npm run build
```

### DevGateway Connection Issues
1. Verify `.env` configuration
2. Check DevGateway is running
3. Confirm ports 5001, 60006 are available
4. Review DevGateway logs

### Semantic Link Issues (Phase 1+)
1. Verify semantic-link-labs installed in notebook
2. Check workspace and model permissions
3. Verify lakehouse attachment
4. Review notebook execution logs

## Contributing

### Code Style
- Use TypeScript strict mode
- Follow Fluent UI patterns
- Add JSDoc comments for public APIs
- Write unit tests for new functionality

### Commit Messages
```
feat: Add semantic link client integration
fix: Resolve OneLake storage path issue
docs: Update semantic link guide
test: Add unit tests for graph builder
```

### Pull Requests
1. Create feature branch
2. Implement and test changes
3. Update documentation
4. Create PR with clear description
5. Address review comments
6. Merge after approval

## Support

- **Issues**: Create GitHub issue with reproduction steps
- **Questions**: Discussion forum (TBD)
- **Documentation**: See `docs/` folder

## License

See [LICENSE](../LICENSE) file for details.

---

## Phase Status Summary

| Phase | Status | Branch | Completion |
|-------|--------|--------|------------|
| Phase 0: Scaffolding | ✅ COMPLETE | feature/phase0-scaffolding | 100% |
| Phase 1: Core Extraction | 🔧 NEXT | feature/phase1-core-extraction | 0% |
| Phase 2: Backend & Visualization | 📅 PLANNED | feature/phase2-backend-visualization | 0% |
| Phase 3: Kanban Board | 📅 PLANNED | feature/phase3-kanban | 0% |

**Last Updated**: Phase 0 scaffolding complete, ready for Phase 1 planning

---

## Next Steps

1. ✅ Complete Phase 0 scaffolding
2. ✅ Verify build and development environment
3. ✅ Test item creation in Fabric
4. Create PR to merge feature/phase0-scaffolding → main
5. Plan Phase 1 implementation sprint
6. Create feature/phase1-core-extraction branch
7. Begin Phase 1 development

---

**2025-01-23 05:15 UTC**
