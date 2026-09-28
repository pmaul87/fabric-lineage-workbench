/**
 * MetadataService - Shared domain model for artifact discovery
 * Used by both frontend and backend for type safety and consistency
 * Persistence-ready: designed to be extended with database operations
 */

import { WorkspaceRole } from "../clients/FabricPlatformTypes";
import { SemanticDependency, SemanticEntity, SemanticModel } from "./SemanticAnalyzerService";

/**
 * Core artifact model - persistence-ready structure
 * Designed to map directly to database schema later
 */
export interface ExplorerArtifact {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
  workspaceName: string;
  description?: string;
  accessLevel?: WorkspaceRole;
  createdByDisplayName?: string;
  createdByUserPrincipalName?: string;
  // Metadata for persistence
  discoveredAt?: Date;
  lastSyncAt?: Date;
}

/**
 * API trace entry for debugging and audit trails
 * Can be stored for audit/troubleshooting
 */
export interface ApiCallTrace {
  id: string;
  text: string;
  timestamp: Date;
  severity?: "info" | "warning" | "error";
}

/**
 * Load artifacts response - represents what the backend returns
 * Persistence-ready: includes metadata about the discovery
 */
export interface LoadArtifactsResponse {
  artifacts: ExplorerArtifact[];
  totalCount: number;
  trace: ApiCallTrace[];
  syncStartedAt: Date;
  syncCompletedAt: Date;
  hasErrors: boolean;
}

/**
 * Request parameters for loading artifacts
 * Can be extended with pagination, filtering, etc.
 */
export interface LoadArtifactsRequest {
  includeTrace?: boolean;
  maxArtifacts?: number;
}

export type LineageRelationshipType =
  | "report-uses-dataset"
  | "dataset-uses-lakehouse"
  | "dataflow-uses-lakehouse"
  | "dataflow-uses-warehouse"
  | "notebook-uses-lakehouse"
  | "notebook-uses-warehouse"
  | "pipeline-uses-dataflow"
  | "pipeline-uses-notebook"
  | "pipeline-uses-lakehouse"
  | "pipeline-uses-warehouse";

export type LineageBlockReason =
  | "NoAccess"
  | "CrossWorkspacePermissionGap"
  | "InsufficientRole"
  | "Unknown";

export interface LineagePermissionSummary {
  accessiblePathCount: number;
  partiallyBlockedPathCount: number;
  blockedPathCount: number;
}

export interface LineagePermissionFlags {
  sourceAccessLevel?: WorkspaceRole;
  targetAccessLevel?: WorkspaceRole;
  traversalBlocked?: boolean;
  blockReason?: LineageBlockReason;
}

export interface LineageLink {
  sourceWorkspaceId: string;
  sourceArtifactId: string;
  targetWorkspaceId: string;
  targetArtifactId: string;
  relationshipType: LineageRelationshipType;
  confidence?: "exact" | "inferred";
  confidenceNote?: string;
  permission?: LineagePermissionFlags;
}

export interface LoadLineageLinksRequest {
  artifacts: ExplorerArtifact[];
}

export interface LoadLineageLinksResponse {
  links: LineageLink[];
}

export interface LoadLineageLinksWithPermissionsResponse {
  links: LineageLink[];
  permissionSummary: LineagePermissionSummary;
  graph?: LineageGraphPayload;
}

export interface LineageGraphNode {
  id: string;
  artifact: ExplorerArtifact;
}

export interface LineageGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: LineageRelationshipType;
}

export interface LineageGraphPayload {
  nodes: LineageGraphNode[];
  edges: LineageGraphEdge[];
  selectableRootNodeIds: string[];
}

export type SemanticEntityUsageKind = "direct" | "dependency" | "table";

export interface SemanticEntityReportUsageReference {
  reportId: string;
  reportName: string;
  workspaceId: string;
  workspaceName: string;
  usageKind: SemanticEntityUsageKind;
}

export interface SemanticEntityReportUsageSummary {
  entityId: string;
  reportCount: number;
  directReportCount: number;
  reports: SemanticEntityReportUsageReference[];
}

export interface LoadSemanticModelReportUsageRequest {
  model: SemanticModel;
  entities: SemanticEntity[];
  dependencies: SemanticDependency[];
  artifacts: ExplorerArtifact[];
  lineageLinks: LineageLink[];
}

export interface LoadSemanticModelReportUsageResponse {
  entityUsageById: Record<string, SemanticEntityReportUsageSummary>;
  reports: unknown[];
  reportsUsingModel: ExplorerArtifact[];
  scanErrors: string[];
  cacheSource?: "memory-cache" | "live-calculation";
}

export interface ReportDefinitionPart {
  path: string;
  payload: string;
  payloadType: string;
}

export interface ReportDefinition {
  format?: string;
  parts: ReportDefinitionPart[];
}

export interface LoadReportDefinitionRequest {
  workspaceId: string;
  reportId: string;
}

export interface LoadReportDefinitionResponse {
  definition: ReportDefinition;
  source?: string;
  operationStatus?: string;
  attempts?: number;
  fetchedAt?: string;
  rawResponse?: unknown;
}

/**
 * Database schema types for future persistence layer
 * Document the structure that will be persisted
 */
export namespace PersistenceSchema {
  /**
   * Artifact record in database
   * Tracks discovery and access patterns
   */
  export interface ArtifactRecord {
    id: string; // Primary key
    displayName: string;
    type: string;
    workspaceId: string;
    workspaceName: string;
    description?: string;
    accessLevel?: WorkspaceRole;
    discoveredAt: Date;
    lastSyncAt: Date;
    discoveryCount: number; // Track how many times discovered
  }

  /**
   * Sync log for audit trail
   */
  export interface SyncLog {
    id: string;
    syncStartedAt: Date;
    syncCompletedAt: Date;
    artifactCount: number;
    hasErrors: boolean;
    errorMessage?: string;
    trace: string; // Stringified trace for archival
  }

  /**
   * User artifact interaction history
   * For future recommendations/analytics
   */
  export interface UserInteraction {
    id: string;
    userId: string;
    artifactId: string;
    interactionType: "view" | "open" | "search" | "filter";
    interactionAt: Date;
  }
}

/**
 * Sorting options for artifacts
 */
export type SortBy = "alphabetical" | "category" | "workspace";

/**
 * Grouping options for artifacts
 */
export type GroupBy = "none" | "type" | "workspace";

/**
 * Utility: Compare two artifacts by sort criteria
 * Pure function for testability and reusability
 */
export function compareArtifactsBy(
  a: ExplorerArtifact,
  b: ExplorerArtifact,
  sortBy: SortBy
): number {
  if (sortBy === "alphabetical") {
    return (
      a.displayName.localeCompare(b.displayName) ||
      a.type.localeCompare(b.type) ||
      a.workspaceName.localeCompare(b.workspaceName)
    );
  }

  if (sortBy === "category") {
    return (
      a.type.localeCompare(b.type) ||
      a.workspaceName.localeCompare(b.workspaceName) ||
      a.displayName.localeCompare(b.displayName)
    );
  }

  return (
    a.workspaceName.localeCompare(b.workspaceName) ||
    a.type.localeCompare(b.type) ||
    a.displayName.localeCompare(b.displayName)
  );
}

/**
 * Utility: Format error for display
 * Handles various error object shapes
 */
export function formatApiError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }

  if (error instanceof Error) {
    return error.message || "unknown error";
  }

  if (typeof error === "object") {
    const maybeError = error as Record<string, unknown>;
    const status = maybeError.status ?? maybeError.statusCode;
    const message =
      (typeof maybeError.message === "string" && maybeError.message) ||
      (typeof maybeError.error === "string" && maybeError.error) ||
      (typeof maybeError.details === "string" && maybeError.details);

    if (status && message) {
      return `${status}: ${message}`;
    }
    if (status) {
      return String(status);
    }
    if (message) {
      return message;
    }
  }

  return String(error);
}
