import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { OneLakeStorageClient } from "../OneLakeStorageClient";
import { OneLakeStorageClientItemWrapper } from "../OneLakeStorageClientItemWrapper";
import { LineageGraphService } from "../../services/LineageGraphService";

/**
 * OneLake storage wrapper for lineage data management
 * 
 * Storage structure in lakehouse:
 * - Files/lineage/raw/{artifactType}/{artifactId}.json - Raw extraction data
 * - Files/lineage/snapshots/snapshot_{timestamp}.json - Versioned snapshots
 * - Files/lineage/metadata/extraction_log.json - Extraction logs
 * - Files/lineage/metadata/config.json - Configuration
 */

export interface ExtractionResult {
  artifactId: string;
  artifactType: string;
  workspaceId: string;
  timestamp: string;
  data: any;
  metadata?: {
    extractionDuration?: number;
    status: "success" | "error";
    errorMessage?: string;
  };
}

export interface LineageSnapshot {
  snapshotId: string;
  timestamp: string;
  workspaceIds: string[];
  artifactCount: number;
  graphData: any;
}

export interface ExtractionLog {
  timestamp: string;
  workspaceIds: string[];
  artifactTypes: string[];
  totalArtifacts: number;
  successCount: number;
  errorCount: number;
  duration: number;
  errors?: Array<{
    artifactId: string;
    artifactType: string;
    error: string;
  }>;
}

export interface V2LineageLoadOptions {
  inputTableSetId?: string;
  inputTables?: Record<string, Array<Record<string, unknown>>>;
  workspaceIds?: string[];
}

/**
 * OneLake storage client for lineage data
 * Uses itemWrapper pattern for lakehouse-scoped operations
 */
export class OneLakeLineageStorage {
  private oneLakeClient: OneLakeStorageClient;
  private itemWrapper?: OneLakeStorageClientItemWrapper;
  private lakehouseId?: string;
  private workspaceId?: string;

  // Storage path constants
  private readonly BASE_PATH = "Files/lineage";
  private readonly RAW_PATH = `${this.BASE_PATH}/raw`;
  private readonly SNAPSHOTS_PATH = `${this.BASE_PATH}/snapshots`;
  private readonly METADATA_PATH = `${this.BASE_PATH}/metadata`;

  constructor(workloadClient: WorkloadClientAPI) {
    this.oneLakeClient = new OneLakeStorageClient(workloadClient);
  }

  /**
   * Initialize storage for a specific lakehouse item
   * Creates itemWrapper for all subsequent operations
   */
  initializeForItem(lakehouseId: string, workspaceId: string): void {
    this.lakehouseId = lakehouseId;
    this.workspaceId = workspaceId;
    this.itemWrapper = this.oneLakeClient.createItemWrapper({
      id: lakehouseId,
      workspaceId: workspaceId,
    });
    console.log(`OneLakeLineageStorage initialized for lakehouse: ${lakehouseId}`);
  }

  /**
   * Save raw extraction result to lakehouse
   * Path: Files/lineage/raw/{artifactType}/{artifactId}.json
   */
  async saveExtractionResult(result: ExtractionResult): Promise<void> {
    this.ensureInitialized();
    
    const path = `${this.RAW_PATH}/${result.artifactType}/${result.artifactId}.json`;
    const content = JSON.stringify(result, null, 2);
    
    try {
      await this.itemWrapper!.writeFileAsText(path, content);
      console.log(`Saved extraction result: ${path}`);
    } catch (error) {
      console.error(`Failed to save extraction result: ${path}`, error);
      throw error;
    }
  }

  /**
   * Load raw extraction results with optional filtering
   * Returns array of extraction results
   */
  async loadExtractionResults(filter?: {
    artifactType?: string;
    workspaceId?: string;
  }): Promise<ExtractionResult[]> {
    this.ensureInitialized();
    
    // In Phase 1, we'll load all files and filter in memory
    // Phase 2 can optimize with directory listing
    const results: ExtractionResult[] = [];
    
    // For now, return empty array; the UI reads extraction results in Phase 1.
    console.log("loadExtractionResults: Reading from lakehouse", filter);
    return results;
  }

  /**
   * Legacy method retained for API compatibility.
   * Lineage graph persistence is now loaded directly from OneLake files.
   */
  async saveLineageGraph(workspaceId: string, graphData: any): Promise<void> {
    void workspaceId;
    void graphData;
    throw new Error(
      "saveLineageGraph is deprecated. Lineage data is loaded directly from OneLake files only."
    );
  }

  /**
   * Load processed lineage graph for a workspace
   * @param workspaceId Optional workspace ID (backend will resolve from lakehouse if not provided)
   * @param sqlEndpoint Optional manual SQL endpoint override (if auto-detection fails)
   */
  async loadLineageGraph(
    workspaceId?: string,
    sqlEndpoint?: string,
    v2Options?: V2LineageLoadOptions
  ): Promise<any> {
    void v2Options;
    void sqlEndpoint;

    const graphService = new LineageGraphService(undefined, workspaceId);
    const graph = await graphService.loadGraph();

    return {
      graphSnapshot: graph,
    };
  }

  /**
   * Create a versioned snapshot of current lineage data
   * Path: Files/lineage/snapshots/snapshot_{timestamp}.json
   */
  async createSnapshot(snapshotName?: string): Promise<string> {
    this.ensureInitialized();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotId = snapshotName || `snapshot_${timestamp}`;
    const path = `${this.SNAPSHOTS_PATH}/${snapshotId}.json`;
    
    // Load all current data (simplified for Phase 1)
    const snapshot: LineageSnapshot = {
      snapshotId,
      timestamp: new Date().toISOString(),
      workspaceIds: [], // Will be populated from actual data
      artifactCount: 0,
      graphData: {}, // Will contain all graph data
    };
    
    const content = JSON.stringify(snapshot, null, 2);
    
    try {
      await this.itemWrapper!.writeFileAsText(path, content);
      console.log(`Created snapshot: ${path}`);
      return snapshotId;
    } catch (error) {
      console.error(`Failed to create snapshot: ${path}`, error);
      throw error;
    }
  }

  /**
   * Save extraction log
   * Path: Files/lineage/metadata/extraction_log.json
   */
  async saveExtractionLog(log: ExtractionLog): Promise<void> {
    this.ensureInitialized();
    
    const path = `${this.METADATA_PATH}/extraction_log_${log.timestamp.replace(/[:.]/g, "-")}.json`;
    const content = JSON.stringify(log, null, 2);
    
    try {
      await this.itemWrapper!.writeFileAsText(path, content);
      console.log(`Saved extraction log: ${path}`);
    } catch (error) {
      console.error(`Failed to save extraction log: ${path}`, error);
      throw error;
    }
  }

  /**
   * Save extraction configuration
   * Path: Files/lineage/metadata/config.json
   */
  async saveConfig(config: any): Promise<void> {
    this.ensureInitialized();
    
    const path = `${this.METADATA_PATH}/config.json`;
    const content = JSON.stringify(config, null, 2);
    
    try {
      await this.itemWrapper!.writeFileAsText(path, content);
      console.log(`Saved config: ${path}`);
    } catch (error) {
      console.error(`Failed to save config: ${path}`, error);
      throw error;
    }
  }

  /**
   * Load extraction configuration
   */
  async loadConfig(): Promise<any> {
    this.ensureInitialized();
    
    const path = `${this.METADATA_PATH}/config.json`;
    
    try {
      const content = await this.itemWrapper!.readFileAsText(path);
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Config not found, returning defaults: ${path}`);
      return null;
    }
  }

  /**
   * Get storage info (lakehouse details)
   */
  getStorageInfo(): { lakehouseId?: string; workspaceId?: string } {
    return {
      lakehouseId: this.lakehouseId,
      workspaceId: this.workspaceId,
    };
  }

  /**
   * Ensure storage is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.itemWrapper) {
      throw new Error(
        "OneLakeLineageStorage not initialized. Call initializeForItem() first."
      );
    }
  }

}
