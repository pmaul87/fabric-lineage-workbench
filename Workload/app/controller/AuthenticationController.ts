import { AccessToken, WorkloadClientAPI } from "@ms-fabric/workload-client";

/**
 * Calls acquire frontend access token from the WorkloadClientAPI.
 * @param {WorkloadClientAPI} workloadClient - An instance of the WorkloadClientAPI.
 * @param {string} scopes - The scopes for which the access token is requested.
 * @returns {AccessToken}
 */
export async function callAcquireFrontendAccessToken(
    workloadClient: WorkloadClientAPI,
    scopes: string): Promise<AccessToken> {
    const requestedScopes = scopes?.length ? scopes.split(/\s+/).filter(Boolean) : [];
    const storageScopes = requestedScopes.filter(scope => scope.toLowerCase().includes('storage.azure.com') || scope.toLowerCase().includes('user_impersonation'));

    if (requestedScopes.length === 0) {
        return workloadClient.auth.acquireAccessToken({ promptFullConsent: true });
    }

    if (storageScopes.length > 0) {
        return workloadClient.auth.acquireAccessToken({ additionalScopesToConsent: storageScopes });
    }

    return workloadClient.auth.acquireFrontendAccessToken({ scopes: requestedScopes });
}
