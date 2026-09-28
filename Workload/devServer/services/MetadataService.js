/**
 * Metadata Service (Backend)
 * Orchestrates Fabric Platform API calls for artifact discovery
 * Handles resilience, error tracking, and persistence preparation
 */

const ROLE_PRECEDENCE = ["Viewer", "Contributor", "Member", "Admin"];

/**
 * Service for discovering and aggregating artifacts across workspaces
 * Serves as the single point for Fabric API orchestration
 */
class MetadataService {
  constructor(fabricPlatformApiClient) {
    this.apiClient = fabricPlatformApiClient;
  }

  /**
   * Load all visible artifacts for the current user
   * @param {object} options Configuration options
   * @param {boolean} options.includeTrace Include API call trace for debugging
   * @param {number} options.maxArtifacts Maximum artifacts to return (0 = unlimited)
   * @returns {Promise<object>} Response with artifacts, trace, and metadata
   */
  async loadArtifacts(options = {}) {
    const { includeTrace = true, maxArtifacts = 0 } = options;
    const trace = [];
    const startTime = new Date();

    const traceCall = (message, severity = "info") => {
      const entry = {
        id: `${Date.now()}-${trace.length}`,
        text: message,
        timestamp: new Date(),
        severity,
      };
      trace.push(entry);

      if (severity === "error") {
        console.error(`[MetadataService] ${message}`);
      } else if (severity === "warning") {
        console.warn(`[MetadataService] ${message}`);
      } else {
        console.log(`[MetadataService] ${message}`);
      }
    };

    try {
      traceCall("Metadata discovery load started");

      // Step 1: Get workspace role map (user's role in each workspace)
      traceCall("Step 1: Discovering user workspace roles");
      const workspaceRoleMap = await this._getWorkspaceRoleMap(traceCall);
      traceCall(`Step 1 complete: User has access to ${workspaceRoleMap.size} workspaces`);

      // Step 2: Get all accessible workspaces
      traceCall("Step 2: Fetching workspace list");
      let workspaces = await this._getAllWorkspaces(traceCall);
      if (workspaces.length === 0) {
        traceCall("No workspaces returned from API; will retry or fallback", "warning");
      } else {
        traceCall(`Step 2 complete: Found ${workspaces.length} workspaces`);
      }

      // Step 3: Get items from each workspace
      traceCall("Step 3: Fetching items from accessible workspaces");
      const allArtifacts = [];
      for (const workspace of workspaces) {
        try {
          const items = await this._getWorkspaceItems(workspace.id, traceCall);
          const artifacts = items.map((item) =>
            this._toExplorerArtifact(item, workspace.displayName, workspaceRoleMap.get(workspace.id))
          );
          allArtifacts.push(...artifacts);
          traceCall(`Workspace ${workspace.displayName}: ${artifacts.length} items`);
        } catch (error) {
          console.error("[MetadataService] Workspace item load failed", {
            workspaceId: workspace.id,
            workspaceName: workspace.displayName,
            message: this._formatError(error),
            error,
          });
          traceCall(
            `Workspace ${workspace.displayName}: Failed to fetch items (${this._formatError(error)})`
            ,
            "error"
          );
        }
      }

      allArtifacts.sort((a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.type.localeCompare(b.type) ||
        a.displayName.localeCompare(b.displayName)
      );

      // Step 4: Apply limits if configured
      if (maxArtifacts > 0 && allArtifacts.length > maxArtifacts) {
        traceCall(`Trimming results: ${allArtifacts.length} → ${maxArtifacts}`);
        allArtifacts.length = maxArtifacts;
      }

      const endTime = new Date();
      traceCall(`Load complete: ${allArtifacts.length} artifacts in ${endTime - startTime}ms`);

      return {
        artifacts: allArtifacts,
        totalCount: allArtifacts.length,
        trace: includeTrace ? trace : [],
        syncStartedAt: startTime,
        syncCompletedAt: endTime,
        hasErrors: trace.some((t) => t.severity === "error"),
      };
    } catch (error) {
      const endTime = new Date();
      console.error("[MetadataService] Unrecoverable metadata load error", {
        message: this._formatError(error),
        error,
      });
      traceCall(`Load failed with unrecoverable error: ${this._formatError(error)}`, "error");

      return {
        artifacts: [],
        totalCount: 0,
        trace: includeTrace ? trace : [],
        syncStartedAt: startTime,
        syncCompletedAt: endTime,
        hasErrors: true,
      };
    }
  }

  /**
   * Get workspace access role for current user
   * Uses role precedence: the highest role the user has in that workspace
   * @private
   */
  async _getWorkspaceRoleMap(traceCall) {
    const roleMap = new Map();

    for (const role of ROLE_PRECEDENCE) {
      try {
        traceCall(`  Role ${role}: querying workspaces`);
        const workspaces = await this.apiClient.workspaces.getAllWorkspaces([role]);
        for (const workspace of workspaces) {
          // Don't overwrite if already have higher-precedence role
          if (!roleMap.has(workspace.id)) {
            roleMap.set(workspace.id, role);
          }
        }
        traceCall(`  Role ${role}: found ${workspaces.length} workspaces`);
      } catch (error) {
        console.error("[MetadataService] Workspace role discovery failed", {
          role,
          message: this._formatError(error),
          error,
        });
        traceCall(`  Role ${role}: failed (${this._formatError(error)})`, "error");
      }
    }

    return roleMap;
  }

  /**
   * Get all workspaces (primary workspaces, shared workspaces, etc.)
   * @private
   */
  async _getAllWorkspaces(traceCall) {
    try {
      traceCall("  Fetching all workspaces");
      const workspaces = await this.apiClient.workspaces.getAllWorkspaces();
      traceCall(`  Found ${workspaces.length} workspaces`);
      return workspaces;
    } catch (error) {
      console.error("[MetadataService] Workspace listing failed", {
        message: this._formatError(error),
        error,
      });
      traceCall(`  Failed to fetch workspaces (${this._formatError(error)})`, "error");
      return [];
    }
  }

  /**
   * Get items in a specific workspace
   * @private
   */
  async _getWorkspaceItems(workspaceId, traceCall) {
    try {
      return await this.apiClient.items.getAllItems(workspaceId);
    } catch (error) {
      console.error("[MetadataService] Workspace items fetch failed", {
        workspaceId,
        message: this._formatError(error),
        error,
      });
      traceCall(`    Items fetch failed: ${this._formatError(error)}`, "error");
      return [];
    }
  }

  /**
   * Convert Fabric Item to ExplorerArtifact
   * @private
   */
  _toExplorerArtifact(item, workspaceName, accessLevel) {
    return {
      id: item.id,
      displayName: item.displayName,
      type: item.type,
      workspaceId: item.workspaceId,
      workspaceName,
      description: item.description,
      accessLevel,
      createdByDisplayName: item.createdByDisplayName,
      createdByUserPrincipalName: item.createdByUserPrincipalName,
      discoveredAt: new Date(),
      lastSyncAt: new Date(),
    };
  }

  /**
   * Format error for trace and logging
   * @private
   */
  _formatError(error) {
    if (!error) return "unknown error";
    if (error instanceof Error) return error.message;

    if (typeof error === "object") {
      const status = error.status ?? error.statusCode;
      const message = error.message || error.error || error.details;
      if (status && message) return `${status}: ${message}`;
      if (status) return String(status);
      if (message) return message;
    }

    return String(error);
  }
}

module.exports = MetadataService;
