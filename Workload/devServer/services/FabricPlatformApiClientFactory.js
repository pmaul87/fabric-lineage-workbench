const FABRIC_API_BASE_URL = "https://api.fabric.microsoft.com/v1";
const AAD_BASE_URL = "https://login.microsoftonline.com";

function maskValue(value, visible = 4) {
  if (!value || typeof value !== "string") {
    return "";
  }

  if (value.length <= visible) {
    return "*".repeat(value.length);
  }

  return `${"*".repeat(value.length - visible)}${value.slice(-visible)}`;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function createUnavailableClient(reason) {
  console.error("[FabricPlatformApiClientFactory] Creating unavailable client", {
    reason,
    hasTenantId: Boolean(getRequiredEnv("TENANT_ID")),
    hasBackendAppId: Boolean(getRequiredEnv("BACKEND_APPID")),
    hasBackendClientSecret: Boolean(getRequiredEnv("BACKEND_CLIENT_SECRET")),
  });

  const errorFactory = () => {
    throw new Error(
      `[Metadata API] Fabric client unavailable: ${reason}. Set TENANT_ID, BACKEND_APPID and BACKEND_CLIENT_SECRET in your environment.`
    );
  };

  return {
    workspaces: {
      getAllWorkspaces: async () => errorFactory(),
    },
    items: {
      getAllItems: async () => errorFactory(),
    },
  };
}

async function acquireAppToken(tenantId, clientId, clientSecret) {
  console.log("[FabricPlatformApiClientFactory] Acquiring app token", {
    tenantId: maskValue(tenantId, 6),
    clientId: maskValue(clientId, 6),
    hasClientSecret: Boolean(clientSecret),
  });

  const tokenUrl = `${AAD_BASE_URL}/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://api.fabric.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("[FabricPlatformApiClientFactory] App token acquisition failed", {
      status: response.status,
      details,
    });
    throw new Error(`AAD token request failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    console.error("[FabricPlatformApiClientFactory] App token response missing access_token", {
      payloadKeys: Object.keys(payload || {}),
    });
    throw new Error("AAD token response did not include access_token");
  }

  console.log("[FabricPlatformApiClientFactory] App token acquired", {
    tokenLength: payload.access_token.length,
    expiresIn: payload.expires_in,
  });

  return payload.access_token;
}

async function fabricGet(path, token) {
  const startedAt = Date.now();
  console.log("[FabricPlatformApiClientFactory] Fabric GET start", {
    path,
    tokenLength: token?.length || 0,
  });

  const response = await fetch(`${FABRIC_API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("[FabricPlatformApiClientFactory] Fabric GET failed", {
      path,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      details,
    });
    throw new Error(`Fabric API request failed (${response.status}) for ${path}: ${details}`);
  }

  console.log("[FabricPlatformApiClientFactory] Fabric GET success", {
    path,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });

  return response.json();
}

function mapWorkspaceRole(role) {
  if (role === "Admin" || role === "Member" || role === "Contributor" || role === "Viewer") {
    return role;
  }
  return undefined;
}

function mapCreator(item) {
  const creatorPrincipal = item?.creatorPrincipal;
  const createdBy = item?.createdBy;

  const displayName =
    creatorPrincipal?.displayName ||
    createdBy?.displayName ||
    creatorPrincipal?.userDetails?.userPrincipalName ||
    createdBy?.userPrincipalName ||
    "";

  const userPrincipalName =
    creatorPrincipal?.userDetails?.userPrincipalName ||
    createdBy?.userPrincipalName ||
    "";

  return {
    createdByDisplayName: displayName,
    createdByUserPrincipalName: userPrincipalName,
  };
}

function createFabricPlatformClientWithToken(accessToken) {
  console.log("[FabricPlatformApiClientFactory] Creating delegated user-token client", {
    tokenLength: accessToken?.length || 0,
  });

  async function fabricGetWithUserToken(path) {
    return fabricGet(path, accessToken);
  }

  return {
    workspaces: {
      getAllWorkspaces: async (roles) => {
        const payload = await fabricGetWithUserToken("/workspaces");
        const values = Array.isArray(payload?.value) ? payload.value : [];

        const normalized = values.map((workspace) => ({
          id: workspace.id,
          displayName: workspace.displayName || workspace.name || workspace.id,
          description: workspace.description || "",
          type: workspace.type || "Workspace",
          role: mapWorkspaceRole(workspace.role),
        }));

        if (!Array.isArray(roles) || roles.length === 0) {
          return normalized;
        }

        return normalized.filter((workspace) => workspace.role && roles.includes(workspace.role));
      },
    },
    items: {
      getAllItems: async (workspaceId) => {
        const payload = await fabricGetWithUserToken(`/workspaces/${workspaceId}/items`);
        const values = Array.isArray(payload?.value) ? payload.value : [];

        return values.map((item) => ({
          id: item.id,
          displayName: item.displayName || item.name || item.id,
          type: item.type || "Unknown",
          workspaceId,
          description: item.description || "",
          ...mapCreator(item),
        }));
      },
    },
  };
}

function createFabricPlatformClientForRequest(req, fallbackClient) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const accessToken = authHeader.substring("Bearer ".length).trim();
    if (accessToken) {
      console.log("[FabricPlatformApiClientFactory] Selected delegated auth mode for request", {
        path: req.path,
        method: req.method,
        hasAuthorizationHeader: true,
      });
      return {
        client: createFabricPlatformClientWithToken(accessToken),
        mode: "delegated-user-token",
      };
    }
  }

  console.warn("[FabricPlatformApiClientFactory] Falling back to app-client auth mode", {
    path: req.path,
    method: req.method,
    hasAuthorizationHeader: Boolean(authHeader),
  });

  return {
    client: fallbackClient,
    mode: "fallback-app-client",
  };
}

function createDevFabricPlatformClient() {
  const tenantId = getRequiredEnv("TENANT_ID");
  const clientId = getRequiredEnv("BACKEND_APPID");
  const clientSecret = getRequiredEnv("BACKEND_CLIENT_SECRET");

  console.log("[FabricPlatformApiClientFactory] Initializing dev app-client", {
    hasTenantId: Boolean(tenantId),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    tenantId: maskValue(tenantId, 6),
    clientId: maskValue(clientId, 6),
  });

  if (!tenantId || !clientId || !clientSecret) {
    return createUnavailableClient("Missing service principal credentials");
  }

  let cachedToken = "";
  let tokenExpiresAt = 0;

  async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt - 60_000) {
      console.log("[FabricPlatformApiClientFactory] Reusing cached app token", {
        msUntilExpiry: tokenExpiresAt - now,
      });
      return cachedToken;
    }

    console.log("[FabricPlatformApiClientFactory] Cached app token missing/expiring; acquiring new token");
    const token = await acquireAppToken(tenantId, clientId, clientSecret);
    cachedToken = token;
    tokenExpiresAt = now + 50 * 60_000;
    return cachedToken;
  }

  return {
    workspaces: {
      getAllWorkspaces: async (roles) => {
        const token = await getToken();
        const payload = await fabricGet("/workspaces", token);
        const values = Array.isArray(payload?.value) ? payload.value : [];

        const normalized = values.map((workspace) => ({
          id: workspace.id,
          displayName: workspace.displayName || workspace.name || workspace.id,
          description: workspace.description || "",
          type: workspace.type || "Workspace",
          role: mapWorkspaceRole(workspace.role),
        }));

        if (!Array.isArray(roles) || roles.length === 0) {
          return normalized;
        }

        return normalized.filter((workspace) => workspace.role && roles.includes(workspace.role));
      },
    },
    items: {
      getAllItems: async (workspaceId) => {
        const token = await getToken();
        const payload = await fabricGet(`/workspaces/${workspaceId}/items`, token);
        const values = Array.isArray(payload?.value) ? payload.value : [];

        return values.map((item) => ({
          id: item.id,
          displayName: item.displayName || item.name || item.id,
          type: item.type || "Unknown",
          workspaceId,
          description: item.description || "",
          ...mapCreator(item),
        }));
      },
    },
  };
}

module.exports = {
  createDevFabricPlatformClient,
  createFabricPlatformClientForRequest,
};
