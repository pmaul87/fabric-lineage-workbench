/**
 * Unified definition for the Lineage Workbench item.
 * All lineage-related state — extraction config and lineage graph —
 * live here so users interact with a single workload element.
 */
export interface LineageWorkbenchExtractionConfig {
  targetWorkspaces?: string[];
  targetWorkspaceNames?: string[];
  targetWorkspaceTypes?: string[];
  selectedArtifactIds?: string[];
  selectedArtifactLabels?: string[];
  artifactSelector?: Record<string, string[]>;
  targetEnvironmentId?: string;
  targetEnvironmentDisplayName?: string;
  targetEnvironmentWorkspaceId?: string;
  targetPipelineId?: string;
  targetPipelineDisplayName?: string;
  artifactTypes?: string[];
  lastRunAt?: string;
  lastRunStatus?: "idle" | "running" | "success" | "error";
  lastRunMessage?: string;
  
  // Extraction configuration
  notebooks?: {
    createNewLakehouse?: boolean;
    newLakehouseName?: string;
    selectedNotebookNames?: string[];
    deployedNotebookIds?: string[];
  };
  
  // Azure OpenAI configuration for query explanation
  azureOpenAI?: {
    enabled?: boolean;
    endpoint?: string;
    apiKey?: string;
    deploymentName?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export interface LineageWorkbenchItemDefinition {
  /** Extraction pipeline configuration */
  extraction?: LineageWorkbenchExtractionConfig;
  /** Lineage graph + viewer state */
  lineage?: any;
}
