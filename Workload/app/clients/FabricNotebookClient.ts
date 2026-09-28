/**
 * FabricNotebookClient - Triggers and monitors Fabric Notebook execution via the Jobs API.
 *
 * Used by LineageWorkbenchItemExtractionView to run the extraction notebooks
 * (bronze, silver, edge) on-demand from the Workbench UI.
 * on-demand from the Workbench UI.
 *
 * API Reference:
 *  POST /v1/workspaces/{workspaceId}/items/{itemId}/jobs/instances
 *  GET  /v1/workspaces/{workspaceId}/items/{itemId}/jobs/instances/{jobInstanceId}
 *  GET  /v1/workspaces/{workspaceId}/items?type=Notebook
 */

import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { FabricPlatformClient, FabricPlatformError } from "./FabricPlatformClient";
import { SCOPE_PAIRS } from "./FabricPlatformScopes";
import { SparkLivyClient } from "./SparkLivyClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotebookJobStatus =
  | "NotStarted"
  | "InProgress"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Deduped"
  | "Unknown";

export interface NotebookJobInstance {
  id: string;
  itemId: string;
  jobType: string;
  invokeType: string;
  status: NotebookJobStatus;
  failureReason?: { errorCode: string; message: string } | null;
  startTimeUtc?: string;
  endTimeUtc?: string;
  progress?: number;
  completed?: number;
  total?: number;
  details?: Record<string, unknown>;
}

export interface NotebookExecutionProgress {
  notebookName: string;
  status: NotebookJobStatus;
  jobInstanceId: string;
  completedCells?: number;
  totalCells?: number;
  progressPercent?: number;
}

export interface FabricNotebookItem {
  id: string;
  displayName: string;
  type: "Notebook";
  workspaceId: string;
}

export interface TriggerNotebookResult {
  jobInstanceId: string;
  /** Location header returned by the API — poll this to get status */
  pollUrl: string;
}

/** Parameters forwarded to the notebook as job execution data */
export interface ExtractionJobParameters {
  /** Target workspace IDs to extract from */
  targetWorkspaces?: string[];
  /** Lakehouse ID where results will be written */
  targetLakehouseId?: string;
  /** Lakehouse workspace ID where results will be written */
  targetLakehouseWorkspaceId?: string;
  /** Artifact types to extract, e.g. ["semantic_model", "report"] */
  artifactTypes?: string[];
  /** Optional map of selected artifact IDs by type (report/semanticmodel/warehouse/lakehouse) */
  artifactSelector?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Wraps Fabric Jobs API to trigger and poll Notebook execution.
 *
 * Usage:
 *   const client = new FabricNotebookClient(workloadClient);
 *   const notebooks = await client.listNotebooks(workspaceId);
 *   const { jobInstanceId } = await client.triggerNotebook(workspaceId, notebookId, params);
 *   const status = await client.pollJobStatus(workspaceId, notebookId, jobInstanceId);
 */
export class FabricNotebookClient extends FabricPlatformClient {
  private readonly sparkLivyClient: SparkLivyClient;

  constructor(workloadClient: WorkloadClientAPI) {
    super(workloadClient, SCOPE_PAIRS.NOTEBOOK_EXECUTION);
    this.sparkLivyClient = new SparkLivyClient(workloadClient);
  }

  private findSessionId(details: Record<string, unknown>): string | undefined {
    const queue: Array<{ key: string; value: unknown }> = Object.entries(details).map(([key, value]) => ({ key, value }));
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const { key, value } = current;
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === "string" || typeof value === "number") {
        if (/(sessionid|session_id|livysession|sparksession)/i.test(key)) {
          const text = String(value).trim();
          if (text) {
            return text;
          }
        }
        continue;
      }

      if (typeof value !== "object" || visited.has(value)) {
        continue;
      }

      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach((entry, index) => {
          queue.push({ key: `${key}[${index}]`, value: entry });
        });
        continue;
      }

      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        queue.push({ key: childKey, value: childValue });
      }
    }

    return undefined;
  }

  private summarizeDetails(details: Record<string, unknown> | undefined): string {
    if (!details || Object.keys(details).length === 0) {
      return "Job details were empty.";
    }

    const topLevelKeys = Object.keys(details).slice(0, 12);
    const compact = JSON.stringify(details);
    const compactPreview = compact.length > 1000 ? `${compact.slice(0, 1000)}...` : compact;
    return `Job detail keys: ${topLevelKeys.join(", ")} :: detailsPreview=${compactPreview}`;
  }

  private summarizeStatementFailure(statement: Record<string, unknown>): string {
    const statementId = statement.id !== undefined ? `statement ${String(statement.id)}` : "statement";
    const state = typeof statement.state === "string" ? statement.state : "unknown";

    const output = (statement.output || {}) as Record<string, unknown>;
    const outputStatus = typeof output.status === "string" ? output.status : undefined;
    const outputData = (output.data || {}) as Record<string, unknown>;

    let detail = "";
    if (typeof outputData.evalue === "string" && outputData.evalue.trim()) {
      detail = outputData.evalue.trim();
    } else if (typeof outputData["text/plain"] === "string" && outputData["text/plain"].trim()) {
      detail = outputData["text/plain"].trim();
    } else if (Array.isArray(outputData.traceback) && outputData.traceback.length > 0) {
      const firstLine = String(outputData.traceback[0] || "").trim();
      detail = firstLine;
    } else if (typeof output.status === "string") {
      detail = output.status;
    }

    const prefix = outputStatus ? `${statementId} (${state}, output=${outputStatus})` : `${statementId} (${state})`;
    if (!detail) {
      return prefix;
    }

    const normalized = detail.replace(/\s+/g, " ").trim();
    return `${prefix}: ${normalized.length > 600 ? `${normalized.slice(0, 600)}...` : normalized}`;
  }

  private async tryGetLivyFailureDiagnostics(
    workspaceId: string,
    targetLakehouseId: string | undefined,
    details: Record<string, unknown> | undefined
  ): Promise<string> {
    if (!targetLakehouseId || !details) {
      if (!targetLakehouseId) {
        return "Livy diagnostics skipped: targetLakehouseId was not provided.";
      }
      return "Livy diagnostics skipped: no job details were returned by the notebook jobs API.";
    }

    const sessionId = this.findSessionId(details);
    if (!sessionId) {
      return `Livy diagnostics skipped: no session ID found in job details. ${this.summarizeDetails(details)}`;
    }

    try {
      const statements = await this.sparkLivyClient.listStatements(workspaceId, targetLakehouseId, sessionId);
      if (!Array.isArray(statements) || statements.length === 0) {
        return `Livy session ${sessionId} had no statements available for diagnostics.`;
      }

      const failed = statements.find((statement) => {
        const state = (statement.state || "").toString().toLowerCase();
        const statementOutput = (statement.output || {}) as Record<string, unknown>;
        const outputStatus = (statementOutput.status || "").toString().toLowerCase();
        return (
          state.includes("error") ||
          state.includes("fail") ||
          state.includes("cancel") ||
          outputStatus.includes("error")
        );
      });

      const lastStatement = statements[statements.length - 1];
      const chosen = (failed || lastStatement) as unknown as Record<string, unknown>;
      return `Livy diagnostics (session ${sessionId}): ${this.summarizeStatementFailure(chosen)}`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `Could not retrieve Livy diagnostics for session ${sessionId}: ${reason}`;
    }
  }

  private formatNotebookFailure(instance: NotebookJobInstance): string {
    const details = (instance.details || {}) as Record<string, unknown>;
    const messageParts: string[] = [];

    if (instance.failureReason?.errorCode) {
      messageParts.push(`errorCode=${instance.failureReason.errorCode}`);
    }

    if (instance.failureReason?.message) {
      messageParts.push(instance.failureReason.message);
    }

    if (instance.failureReason?.errorCode === "System_Cancelled_Session_Statements_Failed") {
      messageParts.push(
        "Hint: this usually indicates a statement crash inside the notebook kernel. " +
          "Most common causes are missing semantic-link libraries in the selected Spark environment or invalid table/lakehouse context."
      );
    }

    const candidateValues: string[] = [];
    const visited = new Set<unknown>();

    const walk = (value: unknown, depth: number) => {
      if (value === null || value === undefined || depth > 4 || visited.has(value)) {
        return;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          candidateValues.push(trimmed);
        }
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach((entry) => walk(entry, depth + 1));
        return;
      }

      const objectValue = value as Record<string, unknown>;
      for (const [key, entry] of Object.entries(objectValue)) {
        if (
          /(error|message|exception|stack|trace|statement|reason|detail|cause)/i.test(key) ||
          depth <= 1
        ) {
          walk(entry, depth + 1);
        }
      }
    };

    walk(details, 0);

    const normalized = new Set<string>();
    for (const text of candidateValues) {
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (!cleaned) {
        continue;
      }
      if (cleaned.length > 800) {
        normalized.add(`${cleaned.slice(0, 800)}...`);
      } else {
        normalized.add(cleaned);
      }
      if (normalized.size >= 5) {
        break;
      }
    }

    if (normalized.size > 0) {
      messageParts.push(Array.from(normalized).join(" | "));
    }

    if (messageParts.length === 0) {
      messageParts.push(instance.status);
    }

    return messageParts.join(" :: ");
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /**
   * List all Notebook items in a workspace.
  * Use this to map display names to item IDs
   * so the extraction view can present a selection UI.
   */
  async listNotebooks(workspaceId: string): Promise<FabricNotebookItem[]> {
    const response = await this.get<{ value: FabricNotebookItem[] }>(
      `/workspaces/${workspaceId}/items?type=Notebook`
    );
    return response.value ?? [];
  }

  /**
   * Find a specific notebook by display name in a workspace.
   * Returns undefined if not found.
   */
  async findNotebookByName(
    workspaceId: string,
    displayName: string
  ): Promise<FabricNotebookItem | undefined> {
    const notebooks = await this.listNotebooks(workspaceId);
    return notebooks.find(
      (n) => n.displayName.toLowerCase() === displayName.toLowerCase()
    );
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Trigger an on-demand notebook run via the Fabric Jobs API.
   *
   * The Jobs API returns 202 Accepted. The base class 202 handler extracts
   * the operationId from the `x-ms-operation-id` response header; we use
   * that as the jobInstanceId (it matches the instance ID in the Location URL).
   *
   * @returns jobInstanceId for subsequent status polling
   */
  async triggerNotebook(
    workspaceId: string,
    notebookId: string,
    parameters?: ExtractionJobParameters
  ): Promise<TriggerNotebookResult> {
    const body: Record<string, unknown> = {};

    if (parameters) {
      body.executionData = {
        parameters: {
          targetWorkspaces: {
            value: JSON.stringify(parameters.targetWorkspaces ?? []),
            type: "string",
          },
          targetLakehouseId: {
            value: parameters.targetLakehouseId ?? "",
            type: "string",
          },
          targetLakehouseWorkspaceId: {
            value: parameters.targetLakehouseWorkspaceId ?? "",
            type: "string",
          },
          artifactTypes: {
            value: JSON.stringify(parameters.artifactTypes ?? []),
            type: "string",
          },
          artifactSelector: {
            value: JSON.stringify(parameters.artifactSelector ?? {}),
            type: "string",
          },
        },
      };
    }

    // Custom fetch to capture Location header (Jobs API pattern)
    // The job instance ID is returned in the Location header, not in the response body
    const endpoint = `/workspaces/${workspaceId}/items/${notebookId}/jobs/instances?jobType=RunNotebook`;
    const accessToken = await this.getAccessToken('POST');
    const fullUrl = `${this.baseUrl}/v1${endpoint}`;
    
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorResponse;
      const contentType = response.headers.get('content-type');
      
      try {
        if (contentType && contentType.includes('application/json')) {
          errorResponse = await response.json();
        } else {
          const errorText = await response.text();
          errorResponse = { error: { message: errorText } };
        }
      } catch {
        errorResponse = { error: { message: response.statusText } };
      }
      
      // Add actionable guidance for the most common published-mode authorization issue.
      if (response.status === 403) {
        const details = errorResponse?.error?.message || response.statusText;
        throw new Error(
          `Notebook execution was forbidden (403). Ensure the frontend app registration has delegated Fabric scope Item.Execute.All (with admin consent), and ensure your user has permission to run notebooks in this workspace. Details: ${details}`
        );
      }

      // Throw FabricPlatformError for consistency with the rest of the codebase
      throw new FabricPlatformError(
        response.status,
        response.statusText,
        errorResponse,
        response.headers.get('x-ms-request-id') || undefined
      );
    }

    // Extract job instance ID from Location header
    const location = response.headers.get('Location');
    if (!location) {
      throw new Error('Job instance ID not found in Location header');
    }

    // Location format: /workspaces/{workspaceId}/items/{itemId}/jobs/instances/{jobInstanceId}
    const jobIdMatch = location.match(/\/jobs\/instances\/([^\/\?]+)/);
    if (!jobIdMatch) {
      throw new Error(`Could not extract job instance ID from Location header: ${location}`);
    }

    const jobInstanceId = jobIdMatch[1];
    const pollUrl = `${this.baseUrl}/v1/workspaces/${workspaceId}/items/${notebookId}/jobs/instances/${jobInstanceId}`;

    return { jobInstanceId, pollUrl };
  }

  // -------------------------------------------------------------------------
  // Status polling
  // -------------------------------------------------------------------------

  /**
   * Poll the current status of a running notebook job instance.
   */
  async pollJobStatus(
    workspaceId: string,
    notebookId: string,
    jobInstanceId: string
  ): Promise<NotebookJobInstance> {
    return this.get<NotebookJobInstance>(
      `/workspaces/${workspaceId}/items/${notebookId}/jobs/instances/${jobInstanceId}`
    );
  }

  /**
   * Wait for a job to reach a terminal state by polling at a fixed interval.
   * Rejects if the job fails or is cancelled.
   *
   * @param workspaceId Workspace ID
   * @param notebookId Notebook item ID
   * @param jobInstanceId Job instance ID from triggerNotebook()
   * @param onProgress Optional callback invoked on each poll with current status
   * @param pollIntervalMs Polling interval in milliseconds (default: 5000)
   * @param timeoutMs Maximum wait time in milliseconds (default: 30 minutes)
   */
  async waitForCompletion(
    workspaceId: string,
    notebookId: string,
    jobInstanceId: string,
    onProgress?: (instance: NotebookJobInstance) => void,
    pollIntervalMs = 5_000,
    timeoutMs = 30 * 60 * 1_000
  ): Promise<NotebookJobInstance> {
    const terminalStates: NotebookJobStatus[] = [
      "Completed",
      "Failed",
      "Cancelled",
      "Deduped",
    ];

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const instance = await this.pollJobStatus(workspaceId, notebookId, jobInstanceId);
      onProgress?.(instance);

      if (terminalStates.includes(instance.status)) {
        if (instance.status !== "Completed") {
          const reason = this.formatNotebookFailure(instance);
          const detailsSummary = this.summarizeDetails(instance.details);
          throw new Error(`Notebook job ended with status "${instance.status}": ${reason} :: ${detailsSummary}`);
        }
        return instance;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Notebook job timed out after ${timeoutMs / 1000}s`);
  }

  // -------------------------------------------------------------------------
  // Convenience: run all extraction notebooks in sequence
  // -------------------------------------------------------------------------

  /** Display names of the extraction notebooks (must be uploaded to Fabric first) */
  static readonly EXTRACTION_NOTEBOOKS = [
    "1_LineageWorkbench_Extract_And_Build",
  ] as const;

  private extractCellProgress(instance: NotebookJobInstance): {
    completedCells?: number;
    totalCells?: number;
    progressPercent?: number;
  } {
    const details = (instance.details || {}) as Record<string, unknown>;

    const readNumber = (value: unknown): number | undefined => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    };

    const completedCells =
      readNumber(instance.completed) ??
      readNumber(details.completedCells) ??
      readNumber(details.completedCellCount) ??
      readNumber(details.cellsCompleted);

    const totalCells =
      readNumber(instance.total) ??
      readNumber(details.totalCells) ??
      readNumber(details.totalCellCount) ??
      readNumber(details.cellsTotal);

    let progressPercent = readNumber(instance.progress) ?? readNumber(details.progressPercent);
    if (progressPercent === undefined && completedCells !== undefined && totalCells && totalCells > 0) {
      progressPercent = Math.min(100, Math.max(0, (completedCells / totalCells) * 100));
    }

    return { completedCells, totalCells, progressPercent };
  }

  /**
   * Run all configured extraction notebooks in sequence.
   * Resolves when all succeed; rejects on first failure.
   *
   * @param workspaceId Workspace that contains the notebooks AND is being extracted from
   * @param parameters Shared extraction parameters forwarded to every notebook
   * @param onNotebookStart Called when each notebook starts
   * @param onNotebookDone Called when each notebook completes
   */
  async runAllExtractionNotebooks(
    workspaceId: string,
    parameters: ExtractionJobParameters,
    onNotebookStart?: (name: string) => void,
    onNotebookDone?: (name: string) => void,
    onNotebookProgress?: (progress: NotebookExecutionProgress) => void
  ): Promise<void> {
    for (const name of FabricNotebookClient.EXTRACTION_NOTEBOOKS) {
      const notebook = await this.findNotebookByName(workspaceId, name);
      if (!notebook) {
        throw new Error(
          `Extraction notebook "${name}" not found in workspace ${workspaceId}. ` +
            `Upload the notebooks from Workload/notebooks/extraction/ first.`
        );
      }

      onNotebookStart?.(name);
      let currentJobInstanceId: string | undefined;
      try {
        const { jobInstanceId } = await this.triggerNotebook(
          workspaceId,
          notebook.id,
          parameters
        );
        currentJobInstanceId = jobInstanceId;
        await this.waitForCompletion(
          workspaceId,
          notebook.id,
          jobInstanceId,
          (instance) => {
            const cellProgress = this.extractCellProgress(instance);
            onNotebookProgress?.({
              notebookName: name,
              status: instance.status,
              jobInstanceId,
              completedCells: cellProgress.completedCells,
              totalCells: cellProgress.totalCells,
              progressPercent: cellProgress.progressPercent,
            });
          }
        );
        onNotebookDone?.(name);
      } catch (err) {
        let reason = err instanceof Error ? err.message : String(err);

        if (currentJobInstanceId) {
          try {
            const latestInstance = await this.pollJobStatus(workspaceId, notebook.id, currentJobInstanceId);
            const livyDiagnostics = await this.tryGetLivyFailureDiagnostics(
              workspaceId,
              parameters.targetLakehouseId,
              latestInstance.details
            );
            reason = `${reason} :: ${livyDiagnostics}`;
          } catch {
            // Keep the original failure reason if diagnostics retrieval fails.
          }
        } else {
          reason = `${reason} :: Livy diagnostics skipped: no job instance ID captured.`;
        }

        throw new Error(`Notebook "${name}" failed: ${reason}`);
      }
    }
  }
}
