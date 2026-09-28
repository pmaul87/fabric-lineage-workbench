# Phase 2 — Extraction Integration

**Branch**: `feature/phase2-extraction-integration`  
**Goal**: Connect the Lineage Workbench UI to the Fabric extraction notebooks so users can trigger real data extraction and view the resulting lineage graph without leaving Fabric.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  LineageWorkbenchItem                   │
│                                                         │
│  ┌─────────────────┐     ┌─────────────────────────┐   │
│  │  ExtractionView │────▶│  FabricNotebookClient   │   │
│  │  (config UI)    │     │  (Jobs API wrapper)     │   │
│  └─────────────────┘     └──────────┬──────────────┘   │
│                                     │                   │
│                          POST /workspaces/{id}/         │
│                          items/{notebookId}/jobs        │
│                                     │                   │
│                          ┌──────────▼──────────────┐   │
│                          │   Fabric Notebook        │   │
│                          │   01_extract_sem_models  │   │
│                          │   02_extract_reports     │   │
│                          │   03_extract_notebooks   │   │
│                          └──────────┬──────────────┘   │
│                                     │                   │
│                          Writes JSON to OneLake         │
│                          /Files/lineage/raw/            │
│                                     │                   │
│  ┌─────────────────┐     ┌──────────▼──────────────┐   │
│  │  LineageGraph   │◀────│   LineageGraphService   │   │
│  │  Viewer         │     │   (reads OneLake JSON)  │   │
│  └─────────────────┘     └─────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## What Was Done in Phase 1 (branch: `feature/phase1-core-extraction`)

| Area | Status | Notes |
|------|--------|-------|
| Workbench UI (hub, views, ribbon) | ✅ Complete | 5-view ItemEditor |
| ExtractionView config UI | ✅ Complete | Target workspaces, artifact types, lakehouse ID |
| LineageWorkbench graph view | ✅ Complete | Node/edge rendering with requirements panel |
| RequirementBoardItem kanban | ✅ Complete | Creator/assignee tracking, shared dialog |
| Extraction notebooks (local) | ✅ Complete | Local notebooks are stored in `Workload/notebooks/` and can be published with `scripts/Deploy/DeployNotebooksToFabric.ps1` |
| Manifest cleanup | ✅ Complete | 3 active items, unused assets removed |
| Workspace migration | ✅ Complete | Workspace `a559a09d-159b-43f9-a5f7-f908bc5a77bb` |
| FabricNotebookClient scaffold | ✅ Complete | `Workload/app/clients/FabricNotebookClient.ts` |

---

## Phase 2 — Step-by-Step Plan

### Step 1: Configure Notebook Deployment in the Workbench UI

**Recommended Approach**: Use the Extraction view's deployment configuration section.

The ExtractionView now includes a **Deployment Configuration** section that allows you to:
- Enable/disable notebook deployment to Fabric workspace
- Select which notebooks to deploy (checkboxes for each .ipynb file)
- Choose an existing lakehouse or create a new one using the entity picker
- Configure lakehouse name for new deployments

**To configure deployment**:
1. Open the LineageWorkbenchItem in the Fabric portal
2. Navigate to the **Extraction** view
3. In the **Target Lakehouse** section, use the **Select Lakehouse** button to pick a lakehouse using the DataHub entity picker
4. In the **Deployment Configuration** section:
   - Check **Deploy extraction notebooks to Fabric workspace**
   - Check **Create new lakehouse for lineage storage** if you want to create a new lakehouse (and provide a name)
   - Select which notebooks should be deployed (future enhancement)
5. Save the workbench item

**Alternative**: PowerShell scripts are still available for CI/CD scenarios:

```powershell
pwsh .\scripts\Deploy\DeployNotebooksToFabric.ps1 `
  -WorkspaceId "a559a09d-159b-43f9-a5f7-f908bc5a77bb"
```

Or integrated with the main deployment:

```powershell
pwsh .\scripts\Deploy\DeployToAzureWebApp.ps1 `
  -WebAppName "your-webapp" `
  -ResourceGroupName "your-resource-group" `
  -DeployNotebooks $true `
  -FabricWorkspaceId "a559a09d-159b-43f9-a5f7-f908bc5a77bb"
```

---

### Step 2: Wire "Run Extraction" Button in ExtractionView

**File**: `Workload/app/items/LineageWorkbenchItem/LineageWorkbenchItemExtractionView.tsx`

The extraction view already has the configuration UI. Add a **Run Extraction** button that:

1. Reads `extraction.targetWorkspaces`, `extraction.targetLakehouseId`, `extraction.artifactTypes` from props
2. Creates a `FabricNotebookClient` instance
3. Calls `runAllExtractionNotebooks()` with the config
4. Updates `lastRunStatus` to `"running"` → `"success"` / `"error"`
5. Shows a progress `MessageBar` per notebook

```typescript
// Rough integration sketch
import { FabricNotebookClient } from "../../clients/FabricNotebookClient";

const client = new FabricNotebookClient(workloadClient);

await client.runAllExtractionNotebooks(
  workspaceId,
  {
    targetWorkspaces: extraction.targetWorkspaces,
    targetLakehouseId: extraction.targetLakehouseId,
    artifactTypes: extraction.artifactTypes,
  },
  (name) => setCurrentNotebook(name),      // onNotebookStart
  (name) => setCompletedNotebooks(prev => [...prev, name])  // onNotebookDone
);
```

---

### Step 3: Build LineageGraphService (Read OneLake JSON Output)

The notebooks write extraction results to OneLake:
```
/lakehouse/default/Files/lineage/raw/semantic_model/{id}.json
/lakehouse/default/Files/lineage/raw/report/{id}.json
/lakehouse/default/Files/lineage/raw/notebook/{id}.json
```

**New file**: `Workload/app/services/LineageGraphService.ts`

Responsibilities:
- Read artifact JSON files from OneLake via `OneLakeStorageClientItemWrapper`
- Transform raw JSON → `LineageNode[]` + `LineageEdge[]` (graph model)
- Merge multiple artifact types into a unified graph
- Cache results in item definition (`lineage.nodes`, `lineage.edges`)

---

### Step 4: Connect Graph to Workbench

**File**: `Workload/app/items/LineageWorkbenchItem/LineageWorkbenchItemDefaultView.tsx`

The Workbench currently renders a static/demo graph. Wire it to:
1. Load `definition.lineage.nodes` / `definition.lineage.edges` from item storage
2. If empty → show `LineageWorkbenchItemEmptyView`-style call-to-action linking to the Workbench
3. On node click → show requirements linked to that node via `RequirementBoardItem`

---

### Step 5: Cross-Item Navigation (Workbench ↔ Board)

The Workbench already holds all state. Add deep-link navigation:

| From | Action | To |
|------|--------|----|
| Workbench Home | "View Lineage" card | Lineage sub-view |
| Lineage node click | "View Requirements" | RequirementBoard filtered to node |
| RequirementBoard | "Go to node" button | Workbench focused on node |

Use `workloadClient.navigation.navigate()` with item IDs for cross-item jumps.

---

### Step 6: Remaining Extraction Notebooks

After the 3 core notebooks are integrated, extend to:

| Notebook | Artifact | Priority |
|----------|----------|----------|
| `04_extract_lakehouses.ipynb` | Lakehouse schemas | High |
| `05_extract_warehouses.ipynb` | Warehouse tables | Medium |
| `06_extract_pipelines.ipynb` | Pipeline activities | Medium |
| `07_extract_dataflows.ipynb` | Dataflow sources | Low |

Add each to `FabricNotebookClient.EXTRACTION_NOTEBOOKS` as they are built.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `Workload/app/clients/FabricNotebookClient.ts` | ✅ Created — Jobs API wrapper |
| `Workload/app/items/LineageWorkbenchItem/LineageWorkbenchItemExtractionView.tsx` | Needs Run button + progress UI |
| `Workload/app/services/LineageGraphService.ts` | To be created — OneLake → graph model |
| `Workload/app/items/LineageWorkbenchItem/LineageWorkbenchItemDefaultView.tsx` | Needs real data wiring |
| `Workload/notebooks/` | Local notebooks ready for Fabric deployment |
| `build/DevGateway/workload-dev-mode.json` | Workspace `a559a09d` configured |

---

## FabricNotebook MCP Integration

The FabricNotebook MCP (`fabric_notebookContextTool`, `fabric_notebookCreateTool`) can assist with:
- Reading notebook cell context once notebooks are uploaded and synced locally
- Running individual extraction cells during development
- Creating new extraction notebooks for additional artifact types

**To enable**: Open each `.ipynb` from Fabric workspace via the Synapse VS Code extension. This creates the `lighter-config.json` the MCP requires. The local path will be:
```
c:\Users\patri\OneDrive\Documents\FabricExtension\fabric-extensibility-toolkit\
  Notebooks\FabricLineage\a559a09d-159b-43f9-a5f7-f908bc5a77bb\SynapseNotebook\
  {notebookId}\
```

---

## Definition of Done for Phase 2

- [ ] All 3 extraction notebooks uploaded to workspace `a559a09d`
- [ ] ExtractionView "Run" button triggers notebooks and shows progress
- [ ] `lastRunStatus` saved to item definition on completion
- [ ] `LineageGraphService` reads OneLake JSON and builds graph model
- [ ] Workbench renders real extracted graph data
- [ ] Cross-item navigation (Workbench ↔ Board) works
- [ ] TypeScript compiles with 0 errors
- [ ] Dev gateway registers successfully on startup
