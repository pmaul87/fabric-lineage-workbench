import { AccessToken, WorkloadClientAPI } from "@ms-fabric/workload-client";
import { AuthenticationConfig, ServicePrincipalConfig } from "./FabricPlatformTypes";

function getWorkloadAuthErrorMessage(code: number): string {
  switch (code) {
    case 0:
      return "Authentication is not available in the current Fabric context.";
    case 1:
      return "User interaction failed during authentication.";
    case 2:
      return "Workload authentication is misconfigured (redirect URI or audience mismatch).";
    case 3:
      return "Unknown authentication error while acquiring Fabric access token.";
    case 4:
      return "Invalid or unsupported authentication scopes were requested.";
    default:
      return `Authentication failed with error code ${code}.`;
  }
}

function formatAuthError(error: unknown): string {
  const sessionHint = "Silent sign-in failed (AADSTS50058). Open Fabric in the same browser profile, complete interactive sign-in once, and allow third-party cookies for login.microsoftonline.com and app.fabric.microsoft.com.";

  if (!error) {
    return "Unknown authentication error.";
  }

  if (error instanceof Error) {
    return error.message || "Unknown authentication error.";
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;
    if (typeof payload.error === "number") {
      return getWorkloadAuthErrorMessage(payload.error);
    }

    if (typeof payload.error === "object" && payload.error !== null) {
      const nested = payload.error as Record<string, unknown>;
      const nestedCode = typeof nested.code === "string" ? nested.code : "";
      const nestedMessage = typeof nested.message === "string" ? nested.message : "";

      if ((nestedMessage || nestedCode).toUpperCase().includes("AADSTS50058")) {
        return sessionHint;
      }

      if (nestedCode || nestedMessage) {
        return [nestedCode, nestedMessage].filter(Boolean).join(": ");
      }

      return "Fabric authentication failed with an empty error payload. This usually means silent sign-in failed or app auth configuration is mismatched (redirect URI, audience, consent, blocked session cookies, or tenant mismatch between workloadSignIn and app registration).";
    }

    if (typeof payload.message === "string" && payload.message) {
      if (payload.message.toUpperCase().includes("AADSTS50058")) {
        return sessionHint;
      }
      return payload.message;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized.toUpperCase().includes("AADSTS50058")) {
        return sessionHint;
      }
      return serialized;
    } catch {
      return "Unknown authentication error.";
    }
  }

  return String(error);
}

function getRawAuthErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { raw: error };
  }

  const payload = error as Record<string, unknown>;
  const nested = typeof payload.error === "object" && payload.error !== null
    ? (payload.error as Record<string, unknown>)
    : undefined;

  return {
    status: payload.status ?? payload.statusCode,
    topLevelMessage: payload.message,
    topLevelError: payload.error,
    nestedErrorCode: nested?.code,
    nestedErrorMessage: nested?.message,
    nestedErrorDetails: nested?.details,
    rawPayload: payload,
  };
}

function formatRawAuthErrorDetails(error: unknown): string {
  try {
    const details = getRawAuthErrorDetails(error);
    const compact = JSON.stringify(details);
    return compact && compact !== "{}" ? compact : "";
  } catch {
    return "";
  }
}

function extractWorkloadAuthErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const payload = error as Record<string, unknown>;
  return typeof payload.error === "number" ? payload.error : undefined;
}

function errorIncludesCode(error: unknown, codeFragment: string): boolean {
  const needle = String(codeFragment || "").trim().toUpperCase();
  if (!needle) {
    return false;
  }

  if (!error) {
    return false;
  }

  if (error instanceof Error) {
    return String(error.message || "").toUpperCase().includes(needle);
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const nested = typeof payload.error === "object" && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : undefined;
    const valuesToScan = [
      payload.message,
      payload.error,
      nested?.code,
      nested?.message,
      nested?.details,
    ]
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return "";
        }
      })
      .join(" ")
      .toUpperCase();

    return valuesToScan.includes(needle);
  }

  return String(error).toUpperCase().includes(needle);
}

function getAuthErrorPriority(error: unknown): number {
  if (!error) {
    return 0;
  }

  if (error instanceof Error && error.message && error.message.trim()) {
    return 3;
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;
    if (typeof payload.error === "number") {
      return 4;
    }

    if (typeof payload.message === "string" && payload.message.trim()) {
      return 3;
    }

    if (typeof payload.error === "object" && payload.error !== null) {
      const nested = payload.error as Record<string, unknown>;
      if ((typeof nested.code === "string" && nested.code.trim()) || (typeof nested.message === "string" && nested.message.trim())) {
        return 3;
      }

      return 1;
    }

    return 2;
  }

  return String(error).trim() ? 2 : 0;
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value as Record<string, unknown>).length === 0;
}

function hasEmptyAuthPayload(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const payload = error as Record<string, unknown>;
  const topLevelMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  const topLevelError = payload.error;

  // Canonical empty payload from Fabric host: { error: {} }
  if (isEmptyObject(topLevelError) && !topLevelMessage) {
    return true;
  }

  return false;
}

function normalizeScopeToken(scope: string): string {
  return String(scope || "").trim();
}

function isAzureStorageScope(scope: string): boolean {
  const normalized = normalizeScopeToken(scope).toLowerCase();
  return normalized.includes("storage.azure.com") || normalized.includes("azure-storage") || normalized.includes("user_impersonation");
}

function uniqueScopes(scopes: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of scopes) {
    const scope = normalizeScopeToken(raw);
    if (!scope || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    output.push(scope);
  }

  return output;
}

function toPowerBiScopeVariants(scopes: string[]): string[] {
  const prefix = "https://analysis.windows.net/powerbi/api/";
  const variants: string[] = [];

  for (const rawScope of scopes) {
    const scope = normalizeScopeToken(rawScope);
    if (!scope) {
      continue;
    }

    variants.push(scope);

    if (scope.startsWith(prefix)) {
      const shortened = scope.slice(prefix.length);
      if (shortened) {
        variants.push(shortened);
      }
      continue;
    }

    if (!scope.includes("://")) {
      variants.push(`${prefix}${scope}`);
    }
  }

  return uniqueScopes(variants);
}

/**
 * Service for handling authentication in Fabric Platform APIs
 * Supports both user token and service principal authentication
 */
export class FabricAuthenticationService {
  private workloadClient?: WorkloadClientAPI;
  private authConfig?: AuthenticationConfig;

  constructor(workloadClient?: WorkloadClientAPI, authConfig?: AuthenticationConfig) {
    this.workloadClient = workloadClient;
    this.authConfig = authConfig;
  }

  /**
   * Acquire an access token based on the authentication configuration
   * @param scopes The required scopes for the token
   * @returns Promise<AccessToken>
   */
  async acquireAccessToken(scopes: string): Promise<AccessToken> {
    // If custom token is provided, use it directly
    if (this.authConfig?.customToken) {
      return {
        token: this.authConfig.customToken
      };
    }

    // If service principal config is provided, use service principal authentication
    if (this.authConfig?.type === 'ServicePrincipal' && this.authConfig.servicePrincipal) {
      return this.acquireServicePrincipalToken(this.authConfig.servicePrincipal, scopes);
    }

    // Default to user token authentication via WorkloadClient
    if (this.workloadClient) {
      return this.acquireUserToken(scopes);
    }

    throw new Error('No valid authentication configuration provided. Please provide either WorkloadClientAPI, service principal config, or custom token.');
  }

  /**
   * Acquire user token using WorkloadClientAPI
   * @param scopes The required scopes
   * @returns Promise<AccessToken>
   */
  private async acquireUserToken(scopes: string): Promise<AccessToken> {
    if (!this.workloadClient) {
      throw new Error('WorkloadClientAPI is required for user token authentication');
    }

    const requestedScopes = scopes?.length ? scopes.split(/\s+/).filter(Boolean) : [];
    const storageScopes = requestedScopes.filter(isAzureStorageScope);
    if (requestedScopes.length === 0) {
      console.warn("[FabricAuthenticationService] Requesting workload login without explicit scopes; using promptFullConsent to avoid invalid unscoped frontend token request.");
      return await (this.workloadClient.auth.acquireAccessToken as any)({ promptFullConsent: true });
    }

    if (storageScopes.length > 0) {
      const consentAttempts: Array<Record<string, unknown>> = [];
      if (storageScopes.length > 0) {
        consentAttempts.push({ additionalScopesToConsent: storageScopes });
      }
      consentAttempts.push({ promptFullConsent: true });

      let lastError: unknown;
      for (const request of consentAttempts) {
        try {
          console.warn("[FabricAuthenticationService] Requesting Azure Storage token through workload consent flow", {
            requestedScopes: storageScopes,
            request,
          });
          return await (this.workloadClient.auth.acquireAccessToken as any)(request);
        } catch (error) {
          lastError = error;
          console.warn("[FabricAuthenticationService] Azure Storage token request failed", {
            request,
            details: getRawAuthErrorDetails(error),
          });
        }
      }

      throw lastError ?? new Error("Failed to acquire Azure Storage token for OneLake DFS access.");
    }

    const requestedScopeVariants = toPowerBiScopeVariants(requestedScopes);
    const firstScopeOnly = requestedScopes.length > 1 ? [requestedScopes[0]] : requestedScopes;
    const firstScopeVariantOnly = requestedScopeVariants.length > 1 ? [requestedScopeVariants[0]] : requestedScopeVariants;
    const attempts: Array<{
      scopes: string[] | null;
      label: string;
    }> = [];

    // Attempt 1: requested scopes
    attempts.push({ scopes: requestedScopes, label: "requested-scopes" });

    // Attempt 2: alternate scope formatting (full URI <-> short token)
    if (requestedScopeVariants.join(' ') !== requestedScopes.join(' ')) {
      attempts.push({ scopes: requestedScopeVariants, label: "requested-scope-variants" });
    }

    // Attempt 3: first requested scope only (helps when workload auth rejects a multi-scope request)
    if (firstScopeOnly.join(' ') !== requestedScopes.join(' ')) {
      attempts.push({ scopes: firstScopeOnly, label: "first-scope-only" });
    }

    // Attempt 4: first scope using alternate formatting.
    if (firstScopeVariantOnly.join(' ') !== firstScopeOnly.join(' ')) {
      attempts.push({ scopes: firstScopeVariantOnly, label: "first-scope-variant-only" });
    }

    if (requestedScopes.length > 0) {
      // Final attempt: no explicit scopes (let Fabric decide the default audience)
      attempts.push({ scopes: null, label: "unscoped-default" });
    }

    let lastError: unknown;
    let bestError: unknown;
    let bestErrorPriority = -1;
    let consentNudgeAttempted = false;

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const attemptScopes = attempt.scopes;
      try {
        const requestParams: Record<string, unknown> = {};
        if (attemptScopes !== null) {
          requestParams.scopes = attemptScopes;
        }

        return await (this.workloadClient.auth.acquireFrontendAccessToken as any)(requestParams);
      } catch (error) {
        console.error("[FabricAuthenticationService] acquireFrontendAccessToken failed", {
          attempt: i + 1,
          totalAttempts: attempts.length,
          attemptLabel: attempt.label,
          requestedScopes,
          attemptScopes,
          details: getRawAuthErrorDetails(error),
        });
        lastError = error;
        const priority = getAuthErrorPriority(error);
        if (priority > bestErrorPriority) {
          bestErrorPriority = priority;
          bestError = error;
        }
        const authErrorCode = extractWorkloadAuthErrorCode(error);
        const isSilentLoginRequired = errorIncludesCode(error, "AADSTS50058") || errorIncludesCode(error, "login_required");
        const isEmptyPayloadAuthError = hasEmptyAuthPayload(error);

        if (!consentNudgeAttempted && (isSilentLoginRequired || isEmptyPayloadAuthError || authErrorCode === 1 || authErrorCode === 3 || authErrorCode === 4)) {
          consentNudgeAttempted = true;
          await this.tryInteractiveConsentNudge(requestedScopeVariants.length > 0 ? requestedScopeVariants : requestedScopes, error);
          // Retry token acquisition flow after forcing interactive consent/sign-in once.
          i = -1;
          continue;
        }

        // Retry on unknown/scope errors and empty payloads (common in workload auth failures).
        if (authErrorCode !== undefined && authErrorCode !== 3 && authErrorCode !== 4) {
          break;
        }

        // No more fallbacks left.
        if (i === attempts.length - 1) {
          break;
        }
      }
    }

    try {
      throw (bestError ?? lastError);
    } catch (error) {
      const formattedMessage = formatAuthError(error);
      const rawDetails = formatRawAuthErrorDetails(error);
      const shouldAppendRawDetails =
        formattedMessage.includes("empty error payload") ||
        formattedMessage.includes("Unknown authentication error") ||
        formattedMessage.includes("Unknown authentication error while acquiring Fabric access token");

      console.error("[FabricAuthenticationService] Frontend token acquisition failed after fallbacks", {
        requestedScopes,
        attemptsTried: attempts,
        selectedError: getRawAuthErrorDetails(error),
      });
      throw new Error(
        `${formattedMessage}${shouldAppendRawDetails && rawDetails ? ` Details: ${rawDetails}` : ""} Please refresh Fabric, sign in again, and retry extraction.`
      );
    }
  }

  private async tryInteractiveConsentNudge(requestedScopes: string[], triggerError: unknown): Promise<void> {
    if (!this.workloadClient) {
      return;
    }

    const nudgeAttempts: Array<Record<string, unknown>> = [];
    const normalizedScopes = toPowerBiScopeVariants(requestedScopes);

    if (normalizedScopes.length > 0) {
      nudgeAttempts.push({ additionalScopesToConsent: normalizedScopes });
    }
    nudgeAttempts.push({ promptFullConsent: true });

    for (const nudge of nudgeAttempts) {
      try {
        console.warn("[FabricAuthenticationService] Triggering interactive consent/sign-in nudge", {
          nudge,
          triggerError: getRawAuthErrorDetails(triggerError),
        });
        await (this.workloadClient.auth.acquireAccessToken as any)(nudge);
        return;
      } catch (nudgeError) {
        console.warn("[FabricAuthenticationService] Interactive consent/sign-in nudge failed", {
          nudge,
          details: getRawAuthErrorDetails(nudgeError),
        });
      }
    }
  }

  /**
   * Acquire service principal token using client credentials flow
   * @param config Service principal configuration
   * @param scopes The required scopes
   * @returns Promise<AccessToken>
   */
  private async acquireServicePrincipalToken(
    config: ServicePrincipalConfig, 
    scopes: string
  ): Promise<AccessToken> {
    const authority = config.authority || `https://login.microsoftonline.com/${config.tenantId}`;
    const tokenUrl = `${authority}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: scopes || 'https://api.fabric.microsoft.com/.default'
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Service principal authentication failed: ${response.status} ${errorText}`);
      }

      const tokenResponse = await response.json();
      
      return {
        token: tokenResponse.access_token
      };
    } catch (error: any) {
      throw new Error(`Failed to acquire service principal token: ${error.message}`);
    }
  }

  /**
   * Update authentication configuration
   * @param authConfig New authentication configuration
   */
  updateAuthConfig(authConfig: AuthenticationConfig): void {
    this.authConfig = authConfig;
  }

  /**
   * Update WorkloadClient (for user token authentication)
   * @param workloadClient New WorkloadClientAPI instance
   */
  updateWorkloadClient(workloadClient: WorkloadClientAPI): void {
    this.workloadClient = workloadClient;
  }

  /**
   * Check if the service is configured for service principal authentication
   * @returns boolean
   */
  isServicePrincipalAuth(): boolean {
    return this.authConfig?.type === 'ServicePrincipal' && !!this.authConfig.servicePrincipal;
  }

  /**
   * Check if the service is configured for user token authentication
   * @returns boolean
   */
  isUserTokenAuth(): boolean {
    return this.authConfig?.type === 'UserToken' || (!this.authConfig && !!this.workloadClient);
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use FabricAuthenticationService instead
 */
export async function callAcquireFrontendAccessToken(
  workloadClient: WorkloadClientAPI, 
  scopes: string
): Promise<AccessToken> {
  const authService = new FabricAuthenticationService(workloadClient);
  return authService.acquireAccessToken(scopes);
}

/**
 * Explicitly prompt interactive sign-in/consent in the Fabric host window.
 * Useful when silent token acquisition keeps failing with sparse/empty payloads.
 */
export async function callPromptFrontendConsent(
  workloadClient: WorkloadClientAPI,
  scopes: string[]
): Promise<void> {
  const normalizedScopes = toPowerBiScopeVariants(scopes);
  const promptAttempts: Array<Record<string, unknown>> = [
    { promptFullConsent: true },
  ];

  if (normalizedScopes.length > 0) {
    promptAttempts.push({ additionalScopesToConsent: normalizedScopes });
  }

  let lastError: unknown;
  for (const promptRequest of promptAttempts) {
    try {
      await (workloadClient.auth.acquireAccessToken as any)(promptRequest);
      return;
    } catch (error) {
      lastError = error;
      console.warn("[FabricAuthenticationService] Explicit interactive consent prompt failed", {
        promptRequest,
        details: getRawAuthErrorDetails(error),
      });
    }
  }

  const message = formatAuthError(lastError);
  const details = formatRawAuthErrorDetails(lastError);
  throw new Error(`${message}${details ? ` Details: ${details}` : ""}`);
}
