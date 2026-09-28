/**
 * LineageGraphService - Reads lineage graph snapshots from the current persistence layer and builds the lineage graph model.
 *
 * Lineage graph loading is table-store-only to avoid direct OneLake DFS/JSON reads from the browser.
 */

import type { OneLakeStorageClientItemWrapper } from "../clients/OneLakeStorageClient";
import { FabricTableLineageStorage } from "../clients/lineage/FabricTableLineageStorage";
import type { LineageViewerNode, LineageViewerEdge } from "../items/LineageWorkbenchItem/LineageGraphView";

// ---------------------------------------------------------------------------
// LineageGraphService
// ---------------------------------------------------------------------------

export class LineageGraphService {
  constructor(
    itemWrapper?: OneLakeStorageClientItemWrapper,
    private readonly workspaceId?: string,
    private readonly lakehouseId?: string
  ) {
    void itemWrapper;
  }

  /**
   * Load the complete lineage graph from OneLake extraction results.
   * Returns nodes and edges ready for visualization.
   */
  async loadGraph(): Promise<{
    nodes: LineageViewerNode[];
    edges: LineageViewerEdge[];
    dimensions?: Record<string, unknown>;
  }> {
    return this.loadGraphSnapshot();
  }

  /**
   * Load the graph snapshot from table-backed browser storage.
   */
  private async loadGraphSnapshot(): Promise<{
    nodes: LineageViewerNode[];
    edges: LineageViewerEdge[];
    dimensions?: Record<string, unknown>;
  }> {
    const tableSnapshot = FabricTableLineageStorage.loadGraphSnapshot(this.workspaceId, this.lakehouseId);
    if (tableSnapshot && Array.isArray(tableSnapshot.nodes) && Array.isArray(tableSnapshot.edges)) {
      console.log("Loaded lineage graph snapshot from Fabric table storage:", {
        workspaceId: this.workspaceId || "unknown",
        lakehouseId: this.lakehouseId || "unknown",
        nodes: tableSnapshot.nodes.length,
        edges: tableSnapshot.edges.length,
        dimensionKeys: tableSnapshot.dimensions ? Object.keys(tableSnapshot.dimensions) : [],
      });

      return {
        nodes: tableSnapshot.nodes as unknown as LineageViewerNode[],
        edges: tableSnapshot.edges as unknown as LineageViewerEdge[],
        dimensions: tableSnapshot.dimensions ?? {},
      };
    }

    throw new Error(
      `Failed to load lineage snapshot for workspace ${this.workspaceId || "unknown"} from the current table-first store. Run the lineage extraction flow to regenerate the snapshot.`
    );
  }
}
