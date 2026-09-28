/**
 * LakehouseAnalyzerService - Domain model for Lakehouse and Warehouse entity analysis.
 *
 * Covers Req 2.1–2.4 (Phase 3):
 *   Req 2.1 – Entity inventory: tables, views, stored procedures, columns, delta tables
 *   Req 2.2 – Cross-artifact usage mapping
 *   Req 2.3 – Detail navigation (entity → lineage / ticket links)
 *   Req 2.4 – Deterministic display for unchanged source metadata
 */

// ---------------------------------------------------------------------------
// Entity catalogue
// ---------------------------------------------------------------------------

/** Discrete entity types surfaced by the analyzer. */
export type LakehouseEntityType =
  | 'DeltaTable'
  | 'ManagedTable'
  | 'ExternalTable'
  | 'View'
  | 'StoredProcedure'
  | 'Column'
  | 'Schema';

/** Storage format for a table-level entity. */
export type LakehouseTableFormat =
  | 'Delta'
  | 'Parquet'
  | 'CSV'
  | 'JSON'
  | 'ORC'
  | 'Avro'
  | string;

/** A single entity (table, view, column, etc.) inside a Lakehouse or Warehouse. */
export interface LakehouseEntity {
  /** Stable composite key: `{artifactId}|{entityType}|{schema}.{name}` */
  id: string;
  displayName: string;
  type: LakehouseEntityType;
  /** Parent artifact (Lakehouse or Warehouse) ID */
  artifactId: string;
  /** SQL / Delta schema name (default: `dbo` for Warehouses, `default` for Lakehouses) */
  schema?: string;
  /** Parent entity ID – populated for Column entries pointing to their table */
  parentId?: string;
  description?: string;
  /** For table/view entities */
  format?: LakehouseTableFormat;
  /** Absolute OneLake or ADLS location URI, where available */
  location?: string;
  /** ISO 8601 creation timestamp */
  createdAt?: string;
  /** ISO 8601 last-modified timestamp */
  modifiedAt?: string;
  /** Number of rows (best-effort, may be null) */
  rowCount?: number | null;
  /** Data type for column entities */
  dataType?: string;
  /** Whether the column is nullable */
  nullable?: boolean;
  /** Column ordinal position within its parent table */
  ordinalPosition?: number;
}

// ---------------------------------------------------------------------------
// Cross-artifact usage
// ---------------------------------------------------------------------------

/** One upstream consumer of a Lakehouse / Warehouse artifact. */
export interface LakehouseArtifactUsage {
  /** Consuming artifact ID */
  consumerArtifactId: string;
  consumerDisplayName: string;
  consumerType: string;
  consumerWorkspaceId: string;
  consumerWorkspaceName?: string;
  /** How the dependency was detected */
  relationshipType: string;
  /** 'exact' = from Fabric lineage API; 'inferred' = derived heuristically */
  confidence: 'exact' | 'inferred';
  confidenceNote?: string;
}

// ---------------------------------------------------------------------------
// Inventory result
// ---------------------------------------------------------------------------

/** Full analyzer result for one Lakehouse or Warehouse artifact. */
export interface LakehouseInventoryResult {
  artifactId: string;
  artifactDisplayName: string;
  /** 'Lakehouse' | 'Warehouse' */
  artifactType: string;
  workspaceId: string;
  workspaceName?: string;
  /** SQL Analytics Endpoint connection string (Warehouse & Lakehouse SQL endpoint) */
  sqlEndpoint?: string;
  entities: LakehouseEntity[];
  usages: LakehouseArtifactUsage[];
  /** ISO 8601 timestamp of this analysis run */
  analyzedAt: string;
  /** Whether the result is complete or partial */
  isPartial: boolean;
  /** Human-readable diagnostics (partial-result reasons, API gaps, etc.) */
  diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Request / Response contracts
// ---------------------------------------------------------------------------

export interface AnalyzeLakehouseRequest {
  workspaceId: string;
  artifactId: string;
  /** 'Lakehouse' | 'Warehouse' */
  artifactType: string;
  artifactDisplayName?: string;
  workspaceName?: string;
  /** Client-forwarded Fabric bearer token (delegated flow) */
  accessToken?: string;
  /** Optional delegated Azure SQL bearer token for Warehouse SQL endpoint access */
  sqlAccessToken?: string;
  /** If true, return column-level detail alongside table-level entities */
  includeColumns?: boolean;
}

export interface AnalyzeLakehouseResponse {
  result: LakehouseInventoryResult;
}

export interface LoadLakehouseArtifactsResponse {
  /** All Lakehouse and Warehouse artifacts visible to the current user */
  artifacts: Array<{
    id: string;
    displayName: string;
    type: 'Lakehouse' | 'Warehouse' | string;
    workspaceId: string;
    workspaceName?: string;
  }>;
}
