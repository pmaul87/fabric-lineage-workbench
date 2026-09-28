import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { FabricPlatformClient, FabricPlatformError } from "./FabricPlatformClient";
import { SCOPE_PAIRS } from "./FabricPlatformScopes";

export interface TriggerPipelineResult {
  jobInstanceId: string;
  pollUrl: string;
  jobType: string;
}

export interface TriggerPipelineParameters {
  targetWorkspaces?: string[];
}

export class FabricPipelineClient extends FabricPlatformClient {
  constructor(workloadClient: WorkloadClientAPI) {
    super(workloadClient, SCOPE_PAIRS.ITEM_READWRITE);
  }

  private extractJobInstanceId(location: string): string {
    const jobIdMatch = location.match(/\/jobs\/instances\/([^\/\?]+)/);
    if (!jobIdMatch) {
      throw new Error(`Could not extract job instance ID from Location header: ${location}`);
    }
    return jobIdMatch[1];
  }

  async triggerPipeline(
    workspaceId: string,
    pipelineId: string,
    parameters?: TriggerPipelineParameters
  ): Promise<TriggerPipelineResult> {
    const accessToken = await this.getAccessToken("POST");
    const candidateJobTypes = ["Pipeline", "RunPipeline"];
    let lastError: unknown;

    const hasExecutionParameters =
      Boolean(parameters?.targetWorkspaces && parameters.targetWorkspaces.length > 0);

    const serializedTargetWorkspaces = (parameters?.targetWorkspaces ?? []).join(",");

    const pipelineParameters = {
      targetWorkspaces: {
        type: "string",
        value: serializedTargetWorkspaces,
      },
    };

    const requestBody = hasExecutionParameters
      ? {
          executionData: {
            parameters: pipelineParameters,
          },
          // Keep legacy parameter shape for runtimes that still expect this.
          parameters: pipelineParameters,
        }
      : undefined;

    const requestBodyVariants: Array<{ label: string; body?: unknown }> = hasExecutionParameters
      ? [
          { label: "executionData+legacy", body: requestBody },
          { label: "executionDataOnly", body: { executionData: { parameters: pipelineParameters } } },
          { label: "noBody", body: undefined },
        ]
      : [{ label: "noBody", body: undefined }];

    const attemptErrors: string[] = [];

    for (const jobType of candidateJobTypes) {
      const endpoint = `/workspaces/${workspaceId}/items/${pipelineId}/jobs/instances?jobType=${jobType}`;
      const fullUrl = `${this.baseUrl}/v1${endpoint}`;

      for (const variant of requestBodyVariants) {
        const response = await fetch(fullUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken.token}`,
            "Content-Type": "application/json",
          },
          body: variant.body ? JSON.stringify(variant.body) : undefined,
        });

        if (response.ok) {
          const location = response.headers.get("Location");
          if (!location) {
            throw new Error("Pipeline job instance ID not found in Location header");
          }

          const jobInstanceId = this.extractJobInstanceId(location);
          const pollUrl = `${this.baseUrl}/v1/workspaces/${workspaceId}/items/${pipelineId}/jobs/instances/${jobInstanceId}`;
          return { jobInstanceId, pollUrl, jobType };
        }

        let errorResponse;
        const contentType = response.headers.get("content-type");
        try {
          if (contentType && contentType.includes("application/json")) {
            errorResponse = await response.json();
          } else {
            const errorText = await response.text();
            errorResponse = { error: { message: errorText } };
          }
        } catch {
          errorResponse = { error: { message: response.statusText } };
        }

        const error = new FabricPlatformError(
          response.status,
          response.statusText,
          errorResponse,
          response.headers.get("x-ms-request-id") || undefined
        );

        const detailMessage = error.message || `HTTP ${response.status}`;
        attemptErrors.push(`jobType=${jobType}, payload=${variant.label}: ${detailMessage}`);

        if (response.status !== 400 && response.status !== 404) {
          throw error;
        }

        lastError = error;
      }
    }

    if (attemptErrors.length > 0) {
      throw new Error(`Failed to trigger pipeline run. Attempts: ${attemptErrors.join(" | ")}`);
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to trigger pipeline run");
  }
}
