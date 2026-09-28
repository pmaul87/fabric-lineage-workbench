/**
 * SemanticAnalyzerService - Shared type definitions
 * Used by both frontend (SemanticAnalyzerClient) and backend (semantic.api.js)
 */

export type SemanticEntityType = "Table" | "Measure" | "Column" | "Relationship";

export interface SemanticEntity {
  id: string;
  name: string;
  type: SemanticEntityType;
  isHidden?: boolean;
  tableName?: string;
  dataType?: string;
  format?: string;
  expression?: string;
  details?: string;
}

export interface SemanticDependency {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  dependencyType: string;
}

export interface SemanticDependencyDiagnostics {
  expressionSource: "INFO.DEPENDENCIES()" | "INFO.CALCDEPENDENCY()" | "analyzer-fallback" | "cached";
  infoRowCount?: number;
  mappedCount?: number;
  queryAttempts?: Array<{
    query: string;
    rowCount: number;
    error: string | null;
  }>;
}

/**
 * Pre-calculated entity relationships
 * Eliminates need for frontend BFS graph traversal
 */
export interface EntityRelationships {
  dependsOn: string[];
  dependedOnBy: string[];
}

/**
 * Entity relationship context (which tables filter which tables)
 */
export interface EntityRelationshipContext {
  filters: Array<{ tableId: string; depth: number }>;
  filteredBy: Array<{ tableId: string; depth: number }>;
}

export interface SemanticModelData {
  entities: SemanticEntity[];
  dependencies: SemanticDependency[];
  
  // NEW: Pre-calculated aggregates (replaces frontend useMemo)
  entityCounts?: Record<SemanticEntityType, number>;
  
  // NEW: Pre-calculated relationships (replaces frontend BFS)  
  entityRelationships?: Record<string, EntityRelationships>;
  
  // NEW: Relationship filter context
  relationshipContext?: Record<string, EntityRelationshipContext>;
  
  // Diagnostics
  dependencyDiagnostics?: SemanticDependencyDiagnostics;
  cacheSource?: "persistent-cache" | "live-calculation";
  
  tmdlView?: {
    source: "tmdl-serializer";
    queryUsed: string | null;
    content: string | null;
    error: string | null;
  };
}

export interface SemanticTableStats {
  tableName: string;
  rowCount: number | null;
  sizeBytes: number | null;
  sizeSource?: string;
}

export interface SemanticColumnStats {
  tableName: string;
  columnName: string;
  rowCount: number | null;
  distinctCount: number | null;
  minValue: string | null;
  maxValue: string | null;
  emptyCount: number | null;
  mostCommonValue: string | null;
  mostCommonFrequency: number | null;
  sizeBytes: number | null;
  sizeSource?: string;
}

export interface SemanticModel {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
  workspaceName: string;
}

export interface LoadSemanticModelsResponse {
  models: SemanticModel[];
}
