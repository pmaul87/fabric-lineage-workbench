/**
 * Metadata API Routes
 * REST endpoints for artifact discovery and exploration
 * 
 * Architecture:
 * - GET /api/metadata/artifacts - Load all discoverable artifacts
 * - POST /api/metadata/artifacts/refresh - Force refresh from Fabric platform
 * - GET /api/metadata/status - Get current sync status
 */

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const MetadataService = require("../services/MetadataService");
const { createFabricPlatformClientForRequest } = require("../services/FabricPlatformApiClientFactory");
const ReportScannerPersistenceService = require("../services/ReportScannerPersistenceService");
const {
  buildSemanticUsageSummary,
  extractFieldReferencesFromDefinition,
  executeFabricPost: _executeFabricPost,
  executeFabricGetAbsolute: _executeFabricGetAbsolute,
  resolveReportDefinitionViaLro: _resolveReportDefinitionViaLro,
} = require("../services/SemanticReportUsageService");

const router = express.Router();
let fallbackFabricPlatformApiClient = null;
let lastSyncResult = null;
let lastSyncTime = null;
const FABRIC_API_BASE_URL = "https://api.fabric.microsoft.com/v1";
let reportScannerPersistence = null;
const semanticModelReportUsageCache = new Map();
const SEMANTIC_REPORT_USAGE_TTL_MS = 15 * 60 * 1000;
const SQL_SCHEMA_TEMPLATE_PATH = path.join(__dirname, "..", "sql", "ReportScannerSchema.sql");

function normalizeSqlSchemaName(schemaName) {
  const candidate = String(schemaName || "dbo").trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : "dbo";
}

function getReportScannerPersistenceStatus() {
  const configured = Boolean(reportScannerPersistence && reportScannerPersistence.connectionConfig);
  return {
    configured,
    backendIdentityConfigured:
      Boolean(process.env.TENANT_ID) &&
      Boolean(process.env.BACKEND_APPID) &&
      Boolean(process.env.BACKEND_CLIENT_SECRET),
    server: reportScannerPersistence?.connectionConfig?.server,
    database: reportScannerPersistence?.connectionConfig?.database,
    schema: reportScannerPersistence?.connectionConfig?.schema,
    persistReportScanner: configured ? reportScannerPersistence?.connectionConfig?.persistReportScanner !== false : false,
    persistSnapshots: configured ? reportScannerPersistence?.connectionConfig?.persistSnapshots !== false : false,
    validationSucceeded: undefined,
    message: reportScannerPersistence
      ? "Runtime SQL persistence is configured."
      : "Runtime SQL persistence is not configured.",
  };
}

async function buildSqlPersistenceSchemaScript(schemaName) {
  const normalizedSchema = normalizeSqlSchemaName(schemaName);
  const template = await fs.readFile(SQL_SCHEMA_TEMPLATE_PATH, "utf8");
  return {
    schema: normalizedSchema,
    script: template.replace(/\{\{SCHEMA_NAME\}\}/g, normalizedSchema),
  };
}

async function validateReportScannerPersistenceConnection() {
  if (!reportScannerPersistence) {
    throw new Error("Report scanner persistence is not configured.");
  }

  const pool = await reportScannerPersistence.createConnectionPool();
  try {
    await pool.request().query("SELECT 1 AS ok");
  } finally {
    await pool.close();
  }
}

function ensureSqlPersistenceConfigured() {
  if (!reportScannerPersistence) {
    const error = new Error("Runtime SQL persistence is not configured.");
    error.statusCode = 503;
    throw error;
  }
}

function createRequestContext(req) {
  const correlationId =
    req.headers["x-ms-request-id"] ||
    req.headers["x-request-id"] ||
    `metadata-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    correlationId,
    method: req.method,
    path: req.path,
    hasAuthorizationHeader: Boolean(req.headers?.authorization),
    userAgent: req.headers["user-agent"] || "unknown",
  };
}

async function executePowerBiXmlaQuery(accessToken, workspaceId, datasetId, daxQuery) {
  const response = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        queries: [{ query: daxQuery }],
        serializerSettings: {
          includeNulls: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`executeQueries failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  const rows = payload?.results?.[0]?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : [];
}

function parseQualifiedIdentifier(value) {
  if (typeof value !== "string") {
    return null;
  }

  const withTable = value.match(/^'([^']+)'\[([^\]]+)\]$/);
  if (withTable) {
    return {
      tableName: withTable[1],
      name: withTable[2],
    };
  }

  const bare = value.match(/^\[([^\]]+)\]$/);
  if (bare) {
    return {
      tableName: undefined,
      name: bare[1],
    };
  }

  return null;
}

function normalizeEntityKey(type, tableName, name) {
  const tableKey = (tableName || "").trim().toLowerCase();
  return `${type}|${tableKey}|${String(name || "").trim().toLowerCase()}`;
}

async function executePowerBiGet(accessToken, path) {
  const response = await fetch(`https://api.powerbi.com/v1.0/myorg${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Power BI GET ${path} failed (${response.status}): ${details}`);
  }

  return response.json();
}

async function executeFabricPost(accessToken, path, body) {
  return _executeFabricPost(accessToken, path, body);
}

async function executeFabricGetAbsolute(accessToken, absoluteUrl) {
  return _executeFabricGetAbsolute(accessToken, absoluteUrl);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(response, fallbackSeconds = 2) {
  const value = Number.parseInt(response.headers.get("Retry-After") || "", 10);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallbackSeconds;
}

async function extractResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessageFromResponseBody(body) {
  if (!body) {
    return "No response body.";
  }

  if (typeof body === "string") {
    return body;
  }

  if (typeof body === "object") {
    return body?.message || body?.error?.message || body?.error || JSON.stringify(body);
  }

  return String(body);
}

async function resolveReportDefinitionViaLro(accessToken, locationUrl, maxAttempts = 8) {
  return _resolveReportDefinitionViaLro(accessToken, locationUrl, maxAttempts);
}


function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function collectStringValues(value, result = []) {
  if (value === null || value === undefined) {
    return result;
  }

  if (typeof value === "string") {
    if (value.trim().length > 0) {
      result.push(value.trim());
    }
    return result;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    result.push(String(value));
    return result;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, result);
    }
    return result;
  }

  if (typeof value === "object") {
    for (const entryValue of Object.values(value)) {
      collectStringValues(entryValue, result);
    }
  }

  return result;
}

function collectKeyValuePairs(value, keyPrefix = "", result = []) {
  if (value === null || value === undefined) {
    return result;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectKeyValuePairs(value[index], `${keyPrefix}[${index}]`, result);
    }
    return result;
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const compoundKey = keyPrefix ? `${keyPrefix}.${key}` : key;
      collectKeyValuePairs(nestedValue, compoundKey, result);
    }
    return result;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    result.push({ key: keyPrefix, value: String(value) });
  }

  return result;
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveLakehouseArtifact(datasetArtifact, datasource, lakehouseArtifacts) {
  if (!datasetArtifact || !datasource || !Array.isArray(lakehouseArtifacts) || lakehouseArtifacts.length === 0) {
    return undefined;
  }

  const connectionDetailsRaw = datasource?.connectionDetails;
  let connectionDetailsObject = undefined;

  if (typeof connectionDetailsRaw === "string") {
    try {
      connectionDetailsObject = JSON.parse(connectionDetailsRaw);
    } catch {
      connectionDetailsObject = undefined;
    }
  } else if (connectionDetailsRaw && typeof connectionDetailsRaw === "object") {
    connectionDetailsObject = connectionDetailsRaw;
  }

  const candidateValues = [
    datasource?.datasourceType,
    datasource?.datasourceId,
    datasource?.connectionString,
    datasource?.gatewayId,
    datasource?.datasourceName,
    connectionDetailsObject ?? connectionDetailsRaw,
  ];

  const valuesAsText = collectStringValues(candidateValues).map((entry) => entry.toLowerCase());
  if (valuesAsText.length === 0) {
    return undefined;
  }

  const explicitIdHints = new Set();
  const explicitWorkspaceHints = new Set();

  if (connectionDetailsObject) {
    const flattened = collectKeyValuePairs(connectionDetailsObject);
    for (const pair of flattened) {
      const key = String(pair.key || "").toLowerCase();
      const value = normalizeId(pair.value);
      if (!value) {
        continue;
      }

      if (/(^|\.)(itemid|artifactid|objectid|lakehouseid|databaseid)$/.test(key)) {
        explicitIdHints.add(value);
      }

      if (/(^|\.)(workspaceid|groupid)$/.test(key)) {
        explicitWorkspaceHints.add(value);
      }
    }
  }

  const datasourceType = String(datasource?.datasourceType || "").toLowerCase();
  const prefersLakehouse = datasourceType.includes("lakehouse");
  const datasetWorkspaceId = normalizeId(datasetArtifact.workspaceId);

  const scoredCandidates = lakehouseArtifacts
    .map((artifact) => {
      const artifactId = normalizeId(artifact.id);
      const artifactWorkspaceId = normalizeId(artifact.workspaceId);
      const artifactName = normalizeForMatch(artifact.displayName);

      let score = 0;

      if (artifactId && explicitIdHints.has(artifactId)) {
        score += 100;
      }

      if (artifactId && valuesAsText.some((value) => value.includes(artifactId))) {
        score += 40;
      }

      if (artifactWorkspaceId && explicitWorkspaceHints.has(artifactWorkspaceId)) {
        score += 25;
      }

      if (artifactWorkspaceId && datasetWorkspaceId && artifactWorkspaceId === datasetWorkspaceId) {
        score += 8;
      }

      if (artifactName && valuesAsText.some((value) => normalizeForMatch(value).includes(artifactName))) {
        score += 12;
      }

      if (prefersLakehouse) {
        score += 2;
      }

      return { artifact, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const leftWorkspaceMatch = normalizeId(left.artifact.workspaceId) === datasetWorkspaceId ? 1 : 0;
      const rightWorkspaceMatch = normalizeId(right.artifact.workspaceId) === datasetWorkspaceId ? 1 : 0;
      if (rightWorkspaceMatch !== leftWorkspaceMatch) {
        return rightWorkspaceMatch - leftWorkspaceMatch;
      }

      return String(left.artifact.displayName || "").localeCompare(String(right.artifact.displayName || ""));
    });

  const bestMatch = scoredCandidates[0];
  if (!bestMatch || bestMatch.score < 12) {
    return undefined;
  }

  return bestMatch.artifact;
}

/**
 * Initialize metadata API with Fabric Platform API client
 * Call this once during server startup with the authenticated API client
 * @param {object} fabricPlatformApiClient The authenticated Fabric API client
 */
function initializeMetadataApi(fabricPlatformApiClient) {
  fallbackFabricPlatformApiClient = fabricPlatformApiClient;
  console.log("[Metadata API] Initialized with Fabric Platform API client");
}

/**
 * GET /api/metadata/artifacts
 * Load all discoverable artifacts across workspaces
 * 
 * Query Parameters:
 *   - includeTrace: boolean (default: true) - Include API call trace for debugging
 *   - maxArtifacts: number (default: 0) - Limit results (0 = no limit)
 * 
 * Response:
 *   {
 *     artifacts: ExplorerArtifact[],
 *     totalCount: number,
 *     trace: ApiCallTrace[],
 *     syncStartedAt: ISO8601Date,
 *     syncCompletedAt: ISO8601Date,
 *     hasErrors: boolean
 *   }
 */
router.get("/api/metadata/artifacts", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!fallbackFabricPlatformApiClient) {
      console.error("[Metadata API] Service unavailable - fallback client not initialized", requestContext);
      return res.status(501).json({
        error: "Metadata service not initialized",
        message: "Server needs to be restarted or metadata API needs configuration",
      });
    }

    const includeTrace = req.query.includeTrace !== "false";
    const maxArtifacts = parseInt(req.query.maxArtifacts, 10) || 0;

    const { client, mode } = createFabricPlatformClientForRequest(req, fallbackFabricPlatformApiClient);
    const metadataService = new MetadataService(client);

    console.log("[Metadata API] GET /api/metadata/artifacts", {
      ...requestContext,
      includeTrace,
      maxArtifacts,
      authMode: mode,
    });

    const result = await metadataService.loadArtifacts({
      includeTrace,
      maxArtifacts,
    });

    // Cache the result for status endpoint
    lastSyncResult = result;
    lastSyncTime = new Date();

    console.log("[Metadata API] GET /api/metadata/artifacts completed", {
      ...requestContext,
      authMode: mode,
      artifactCount: result.totalCount,
      traceCount: result.trace?.length ?? 0,
      hasErrors: result.hasErrors,
      elapsedMs: Date.now() - startedAt,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("[Metadata API] Error loading artifacts", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    res.status(500).json({
      error: "Failed to load artifacts",
      message: error.message || "Unknown error",
      trace: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * POST /api/metadata/artifacts/refresh
 * Force refresh artifacts from Fabric platform
 * Bypasses any caching and gets fresh data
 * 
 * Response: Same as GET /api/metadata/artifacts
 */
router.post("/api/metadata/artifacts/refresh", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!fallbackFabricPlatformApiClient) {
      console.error("[Metadata API] Service unavailable on refresh - fallback client not initialized", requestContext);
      return res.status(501).json({
        error: "Metadata service not initialized",
        message: "Server needs to be restarted or metadata API needs configuration",
      });
    }

    const { client, mode } = createFabricPlatformClientForRequest(req, fallbackFabricPlatformApiClient);
    const metadataService = new MetadataService(client);

    console.log("[Metadata API] POST /api/metadata/artifacts/refresh", {
      ...requestContext,
      authMode: mode,
    });

    // Clear cache and force reload
    lastSyncResult = null;
    lastSyncTime = null;

    const result = await metadataService.loadArtifacts({
      includeTrace: true,
      maxArtifacts: 0, // No limit on refresh
    });

    lastSyncResult = result;
    lastSyncTime = new Date();

    console.log("[Metadata API] POST /api/metadata/artifacts/refresh completed", {
      ...requestContext,
      authMode: mode,
      artifactCount: result.totalCount,
      traceCount: result.trace?.length ?? 0,
      hasErrors: result.hasErrors,
      elapsedMs: Date.now() - startedAt,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("[Metadata API] Error refreshing artifacts", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    res.status(500).json({
      error: "Failed to refresh artifacts",
      message: error.message || "Unknown error",
      trace: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/metadata/status
 * Get metadata API status and last sync information
 * Useful for UI to determine staleness and cache behavior
 * 
 * Response:
 *   {
 *     lastSyncAt: ISO8601Date | null,
 *     isStale: boolean,
 *     artifactCount: number,
 *     isInitialized: boolean
 *   }
 */
router.get("/api/metadata/status", (req, res) => {
  const requestContext = createRequestContext(req);
  const isInitialized = fallbackFabricPlatformApiClient !== null;
  const now = new Date();
  const staleThresholdMs = 5 * 60 * 1000; // 5 minutes

  let isStale = true;
  let artifactCount = 0;

  if (lastSyncTime && lastSyncResult) {
    isStale = now - lastSyncTime > staleThresholdMs;
    artifactCount = lastSyncResult.totalCount;
  }

  console.log("[Metadata API] GET /api/metadata/status", {
    ...requestContext,
    isInitialized,
    isStale,
    artifactCount,
  });

  res.status(200).json({
    lastSyncAt: lastSyncTime ? lastSyncTime.toISOString() : null,
    isStale,
    artifactCount,
    isInitialized,
    staleThresholdMs,
  });
});

/**
 * Healthcheck for metadata API
 * GET /api/metadata/health
 */
router.get("/api/metadata/health", (req, res) => {
  const requestContext = createRequestContext(req);
  console.log("[Metadata API] GET /api/metadata/health", {
    ...requestContext,
    initialized: fallbackFabricPlatformApiClient !== null,
  });

  res.status(200).json({
    status: "ok",
    service: "metadata",
    initialized: fallbackFabricPlatformApiClient !== null,
  });
});

/**
 * POST /api/metadata/semantic/xmla-enrich
 * Server-side XMLA metadata enrichment endpoint for measure/column expression+format.
 * Expects delegated Power BI token in Authorization header.
 */
router.post("/api/metadata/semantic/xmla-enrich", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing delegated token",
        message: "Authorization header with Bearer token is required.",
      });
    }

    const accessToken = authHeader.substring("Bearer ".length).trim();
    const workspaceId = req.body?.workspaceId;
    const datasetId = req.body?.datasetId;

    if (!workspaceId || !datasetId) {
      return res.status(400).json({
        error: "Invalid payload",
        message: "workspaceId and datasetId are required.",
      });
    }

    const [measureRows, columnRows, calcDependencyRows] = await Promise.all([
      executePowerBiXmlaQuery(
        accessToken,
        workspaceId,
        datasetId,
        "EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), \"TableName\", [Table], \"Name\", [Name], \"Expression\", [Expression], \"Format\", [FormatString])"
      ),
      executePowerBiXmlaQuery(
        accessToken,
        workspaceId,
        datasetId,
        "EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), \"TableName\", [Table], \"Name\", [Name], \"Expression\", [Expression], \"Format\", [FormatString])"
      ),
      executePowerBiXmlaQuery(
        accessToken,
        workspaceId,
        datasetId,
        "EVALUATE INFO.CALCDEPENDENCY()"
      ).catch(() => []),
    ]);

    const metadataByKey = new Map();

    for (const row of measureRows) {
      const tableName = row?.TableName ?? row?.["[TableName]"] ?? row?.Table ?? row?.["[Table]"];
      const name = row?.Name ?? row?.["[Name]"];
      if (!tableName || !name) {
        continue;
      }

      metadataByKey.set(normalizeEntityKey("Measure", String(tableName), String(name)), {
        type: "Measure",
        tableName: String(tableName),
        name: String(name),
        expression: row?.Expression ?? row?.["[Expression]"] ?? undefined,
        format: row?.Format ?? row?.["[Format]"] ?? undefined,
      });
    }

    for (const row of columnRows) {
      const tableName = row?.TableName ?? row?.["[TableName]"] ?? row?.Table ?? row?.["[Table]"];
      const name = row?.Name ?? row?.["[Name]"];
      if (!tableName || !name) {
        continue;
      }

      metadataByKey.set(normalizeEntityKey("Column", String(tableName), String(name)), {
        type: "Column",
        tableName: String(tableName),
        name: String(name),
        expression: row?.Expression ?? row?.["[Expression]"] ?? undefined,
        format: row?.Format ?? row?.["[Format]"] ?? undefined,
      });
    }

    for (const row of calcDependencyRows) {
      const objectType = String(
        row?.OBJECT_TYPE ?? row?.["[OBJECT_TYPE]"] ?? row?.ObjectType ?? row?.["[ObjectType]"] ?? ""
      ).toLowerCase();

      if (objectType !== "measure" && objectType !== "column") {
        continue;
      }

      const objectName =
        row?.OBJECT ?? row?.["[OBJECT]"] ?? row?.Object ?? row?.["[Object]"] ?? undefined;
      const expression =
        row?.EXPRESSION ?? row?.["[EXPRESSION]"] ?? row?.Expression ?? row?.["[Expression]"] ?? undefined;

      const parsed = parseQualifiedIdentifier(typeof objectName === "string" ? objectName : undefined);
      if (!parsed || !parsed.tableName || !parsed.name || !expression) {
        continue;
      }

      const normalizedType = objectType === "measure" ? "Measure" : "Column";
      const key = normalizeEntityKey(normalizedType, parsed.tableName, parsed.name);
      const current = metadataByKey.get(key) || {
        type: normalizedType,
        tableName: parsed.tableName,
        name: parsed.name,
      };

      if (!current.expression) {
        current.expression = String(expression);
      }
      metadataByKey.set(key, current);
    }

    const metadata = [...metadataByKey.values()];

    console.log("[Metadata API] POST /api/metadata/semantic/xmla-enrich completed", {
      ...requestContext,
      workspaceId,
      datasetId,
      metadataCount: metadata.length,
      measureRows: measureRows.length,
      columnRows: columnRows.length,
      calcDependencyRows: calcDependencyRows.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      metadata,
      diagnostics: {
        measureRows: measureRows.slice(0, 3),
        columnRows: columnRows.slice(0, 3),
        calcDependencyRows: calcDependencyRows.slice(0, 3),
      },
    });
  } catch (error) {
    console.error("[Metadata API] XMLA enrichment failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "XMLA enrichment failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * POST /api/metadata/lineage-links
 * Resolves explicit lineage links for:
 * - Report -> Dataset
 * - Dataset -> Lakehouse
 */
async function resolveLineageLinks(accessToken, artifacts, requestContext) {
  const reportArtifacts = artifacts.filter(
    (artifact) => String(artifact?.type || "").toLowerCase() === "report"
  );
  const datasetArtifacts = artifacts.filter((artifact) => {
    const type = String(artifact?.type || "").toLowerCase();
    return type === "semanticmodel" || type === "dataset";
  });
  const lakehouseArtifacts = artifacts.filter(
    (artifact) => String(artifact?.type || "").toLowerCase() === "lakehouse"
  );

  const reportByWorkspaceAndId = new Map(
    reportArtifacts.map((artifact) => [`${artifact.workspaceId}:${artifact.id}`, artifact])
  );

  const datasetsById = new Map();
  for (const dataset of datasetArtifacts) {
    const key = String(dataset.id);
    const current = datasetsById.get(key) ?? [];
    current.push(dataset);
    datasetsById.set(key, current);
  }

  const links = [];
  const linkIds = new Set();

  for (const workspaceId of [...new Set(reportArtifacts.map((artifact) => artifact.workspaceId))]) {
    try {
      const payload = await executePowerBiGet(accessToken, `/groups/${workspaceId}/reports`);
      const rows = Array.isArray(payload?.value) ? payload.value : [];

      for (const report of rows) {
        const reportId = report?.id;
        const datasetId = report?.datasetId;
        if (!reportId || !datasetId) {
          continue;
        }

        const source = reportByWorkspaceAndId.get(`${workspaceId}:${reportId}`);
        if (!source) {
          continue;
        }

        const datasetCandidates = datasetsById.get(String(datasetId)) ?? [];
        if (datasetCandidates.length === 0) {
          continue;
        }

        const target =
          datasetCandidates.find((candidate) => candidate.workspaceId === workspaceId) ??
          datasetCandidates[0];

        const id = `report-uses-dataset:${source.workspaceId}:${source.id}:${target.workspaceId}:${target.id}`;
        if (linkIds.has(id)) {
          continue;
        }

        linkIds.add(id);
        links.push({
          sourceWorkspaceId: source.workspaceId,
          sourceArtifactId: source.id,
          targetWorkspaceId: target.workspaceId,
          targetArtifactId: target.id,
          relationshipType: "report-uses-dataset",
          confidence: "exact",
        });
      }
    } catch (error) {
      console.warn("[Metadata API] Failed to resolve report-to-dataset links for workspace", {
        ...requestContext,
        workspaceId,
        message: error?.message || "Unknown error",
      });
    }
  }

  for (const dataset of datasetArtifacts) {
    try {
      const payload = await executePowerBiGet(
        accessToken,
        `/groups/${dataset.workspaceId}/datasets/${dataset.id}/datasources`
      );

      const datasources = Array.isArray(payload?.value) ? payload.value : [];
      for (const datasource of datasources) {
        const lakehouse = resolveLakehouseArtifact(dataset, datasource, lakehouseArtifacts);
        if (!lakehouse) {
          continue;
        }

        const id = `dataset-uses-lakehouse:${dataset.workspaceId}:${dataset.id}:${lakehouse.workspaceId}:${lakehouse.id}`;
        if (linkIds.has(id)) {
          continue;
        }

        linkIds.add(id);
        links.push({
          sourceWorkspaceId: dataset.workspaceId,
          sourceArtifactId: dataset.id,
          targetWorkspaceId: lakehouse.workspaceId,
          targetArtifactId: lakehouse.id,
          relationshipType: "dataset-uses-lakehouse",
          confidence: "inferred",
          confidenceNote: "Mapped from dataset datasource metadata.",
        });
      }
    } catch (error) {
      console.warn("[Metadata API] Failed to resolve dataset-to-lakehouse links for dataset", {
        ...requestContext,
        datasetId: dataset.id,
        workspaceId: dataset.workspaceId,
        message: error?.message || "Unknown error",
      });
    }
  }

  return {
    links,
    reportCount: reportArtifacts.length,
    datasetCount: datasetArtifacts.length,
    lakehouseCount: lakehouseArtifacts.length,
  };
}

function summarizePermissionCoverage(links) {
  let accessiblePathCount = 0;
  let partiallyBlockedPathCount = 0;
  let blockedPathCount = 0;

  for (const link of links) {
    if (!link?.permission?.traversalBlocked) {
      accessiblePathCount += 1;
      continue;
    }

    if (link?.permission?.sourceAccessLevel && !link?.permission?.targetAccessLevel) {
      partiallyBlockedPathCount += 1;
    } else {
      blockedPathCount += 1;
    }
  }

  return {
    accessiblePathCount,
    partiallyBlockedPathCount,
    blockedPathCount,
  };
}

function applyPermissionFlags(links, artifacts) {
  const artifactMap = new Map(
    artifacts.map((artifact) => [`${artifact.workspaceId}:${artifact.id}`, artifact])
  );

  return links.map((link) => {
    const source = artifactMap.get(`${link.sourceWorkspaceId}:${link.sourceArtifactId}`);
    const target = artifactMap.get(`${link.targetWorkspaceId}:${link.targetArtifactId}`);

    const sourceAccessLevel = source?.accessLevel;
    const targetAccessLevel = target?.accessLevel;
    const traversalBlocked = !targetAccessLevel || targetAccessLevel === "None";

    return {
      ...link,
      permission: {
        sourceAccessLevel,
        targetAccessLevel,
        traversalBlocked,
        blockReason: traversalBlocked ? "NoAccess" : undefined,
      },
    };
  });
}

function buildLineageGraphPayload(artifacts, links) {
  const nodes = (Array.isArray(artifacts) ? artifacts : []).map((artifact) => ({
    id: `${artifact.workspaceId}:${artifact.id}`,
    artifact,
  }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set();
  const edges = [];

  for (const link of Array.isArray(links) ? links : []) {
    const sourceId = `${link.sourceWorkspaceId}:${link.sourceArtifactId}`;
    const targetId = `${link.targetWorkspaceId}:${link.targetArtifactId}`;
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      continue;
    }

    const edgeId = `${link.relationshipType}:${sourceId}:${targetId}`;
    if (edgeIds.has(edgeId)) {
      continue;
    }

    edgeIds.add(edgeId);
    edges.push({
      id: edgeId,
      sourceId,
      targetId,
      relationshipType: link.relationshipType,
    });
  }

  const linkedNodeIds = new Set();
  for (const edge of edges) {
    linkedNodeIds.add(edge.sourceId);
    linkedNodeIds.add(edge.targetId);
  }

  const selectableRootNodeIds = nodes
    .filter((node) => linkedNodeIds.has(node.id))
    .sort((left, right) => {
      const leftText = `${left.artifact.displayName} (${left.artifact.type})`;
      const rightText = `${right.artifact.displayName} (${right.artifact.type})`;
      return leftText.localeCompare(rightText);
    })
    .map((node) => node.id);

  return { nodes, edges, selectableRootNodeIds };
}

function getSemanticUsageCacheKey(workspaceId, datasetId, entityCount, dependencyCount) {
  return `${workspaceId}:${datasetId}:e${entityCount}:d${dependencyCount}`;
}

function getCachedSemanticUsage(cacheKey) {
  const entry = semanticModelReportUsageCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    semanticModelReportUsageCache.delete(cacheKey);
    return null;
  }

  return entry.payload;
}

function setCachedSemanticUsage(cacheKey, payload) {
  semanticModelReportUsageCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + SEMANTIC_REPORT_USAGE_TTL_MS,
  });
}

router.post("/api/metadata/lineage-links", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing delegated token",
        message: "Authorization header with Bearer token is required.",
      });
    }

    const accessToken = authHeader.substring("Bearer ".length).trim();
    const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
    const result = await resolveLineageLinks(accessToken, artifacts, requestContext);

    console.log("[Metadata API] POST /api/metadata/lineage-links completed", {
      ...requestContext,
      artifacts: artifacts.length,
      reports: result.reportCount,
      datasets: result.datasetCount,
      lakehouses: result.lakehouseCount,
      links: result.links.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({ links: result.links });
  } catch (error) {
    console.error("[Metadata API] Lineage link resolution failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Lineage link resolution failed",
      message: error?.message || "Unknown error",
    });
  }
});

router.post("/api/metadata/lineage-links-with-permissions", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing delegated token",
        message: "Authorization header with Bearer token is required.",
      });
    }

    const accessToken = authHeader.substring("Bearer ".length).trim();
    const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
    const result = await resolveLineageLinks(accessToken, artifacts, requestContext);
    const links = applyPermissionFlags(result.links, artifacts);
    const permissionSummary = summarizePermissionCoverage(links);
    const graph = buildLineageGraphPayload(artifacts, links);

    console.log("[Metadata API] POST /api/metadata/lineage-links-with-permissions completed", {
      ...requestContext,
      artifacts: artifacts.length,
      links: links.length,
      permissionSummary,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      links,
      permissionSummary,
      graph,
    });
  } catch (error) {
    console.error("[Metadata API] Permission-aware lineage resolution failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Permission-aware lineage resolution failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * POST /api/metadata/semantic-model-report-usage
 * Heavy report-usage calculations for semantic entities run in backend.
 *
 * Body:
 * {
 *   model: { id, workspaceId, displayName?, workspaceName? },
 *   entities: SemanticEntity[],
 *   dependencies: SemanticDependency[],
 *   artifacts: ExplorerArtifact[],
 *   lineageLinks: LineageLink[]
 * }
 */
router.post("/api/metadata/semantic-model-report-usage", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing delegated token",
        message: "Authorization header with Bearer token is required.",
      });
    }

    const accessToken = authHeader.substring("Bearer ".length).trim();
    const model = req.body?.model;
    const entities = Array.isArray(req.body?.entities) ? req.body.entities : [];
    const dependencies = Array.isArray(req.body?.dependencies) ? req.body.dependencies : [];
    const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
    const lineageLinks = Array.isArray(req.body?.lineageLinks) ? req.body.lineageLinks : [];

    if (!model?.id || !model?.workspaceId) {
      return res.status(400).json({
        error: "Invalid payload",
        message: "model with id and workspaceId is required.",
      });
    }

    const cacheKey = getSemanticUsageCacheKey(model.workspaceId, model.id, entities.length, dependencies.length);
    const cached = getCachedSemanticUsage(cacheKey);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cacheSource: "memory-cache",
      });
    }

    const artifactByCompositeId = new Map(
      artifacts.map((artifact) => [`${artifact.workspaceId}:${artifact.id}`, artifact])
    );

    const reportsUsingModel = lineageLinks
      .filter(
        (link) =>
          link.relationshipType === "report-uses-dataset" &&
          link.targetArtifactId === model.id &&
          link.targetWorkspaceId === model.workspaceId
      )
      .map((link) => artifactByCompositeId.get(`${link.sourceWorkspaceId}:${link.sourceArtifactId}`))
      .filter((artifact) => Boolean(artifact));

    const uniqueReports = Array.from(
      new Map(reportsUsingModel.map((report) => [`${report.workspaceId}:${report.id}`, report])).values()
    ).sort((left, right) => {
      return (
        left.workspaceName.localeCompare(right.workspaceName) ||
        left.displayName.localeCompare(right.displayName) ||
        left.id.localeCompare(right.id)
      );
    });

    const scannedReports = [];
    const scanErrors = [];

    for (const report of uniqueReports) {
      try {
        const endpoint = `/workspaces/${report.workspaceId}/reports/${report.id}/getDefinition`;
        const initialResponse = await executeFabricPost(accessToken, endpoint);

        let definition = null;
        if (initialResponse.status === 200) {
          const payload = await extractResponseBody(initialResponse);
          definition = payload?.definition || null;
        } else if (initialResponse.status === 202) {
          const locationUrl = initialResponse.headers.get("Location");
          if (!locationUrl) {
            throw new Error("getDefinition returned 202 without Location header");
          }
          const lroResult = await resolveReportDefinitionViaLro(accessToken, locationUrl);
          definition = lroResult.definition;
        } else {
          const body = await extractResponseBody(initialResponse);
          throw new Error(getErrorMessageFromResponseBody(body));
        }

        if (!definition) {
          throw new Error("Definition payload was empty");
        }

        scannedReports.push({ report, definition });
      } catch (error) {
        scanErrors.push(`${report.displayName}: ${error?.message || "Unknown error"}`);
      }
    }

    const usageSummary = buildSemanticUsageSummary({
      model,
      entities,
      dependencies,
      reportsUsingModel: uniqueReports,
      scannedReports,
    });

    const payload = {
      entityUsageById: usageSummary.entityUsageById,
      reports: [],
      reportsUsingModel: uniqueReports,
      scanErrors,
    };

    setCachedSemanticUsage(cacheKey, payload);

    console.log("[Metadata API] POST /api/metadata/semantic-model-report-usage completed", {
      ...requestContext,
      modelId: model.id,
      workspaceId: model.workspaceId,
      reportsUsingModel: uniqueReports.length,
      scanErrors: scanErrors.length,
      entitiesWithUsage: Object.keys(payload.entityUsageById || {}).length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      ...payload,
      cacheSource: "live-calculation",
    });
  } catch (error) {
    console.error("[Metadata API] semantic-model-report-usage failed", {
      ...requestContext,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(500).json({
      error: "Semantic model report usage calculation failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * POST /api/metadata/report-definition
 * Loads definition for one selected report only.
 * Body: { workspaceId: string, reportId: string }
 */
router.post("/api/metadata/report-definition", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing delegated token",
        message: "Authorization header with Bearer token is required.",
      });
    }

    const accessToken = authHeader.substring("Bearer ".length).trim();
    const workspaceId = req.body?.workspaceId;
    const reportId = req.body?.reportId;

    if (!workspaceId || !reportId) {
      return res.status(400).json({
        error: "Invalid payload",
        message: "workspaceId and reportId are required.",
      });
    }

    const endpoint = `/workspaces/${workspaceId}/reports/${reportId}/getDefinition`;
    const initialResponse = await executeFabricPost(accessToken, endpoint);

    if (initialResponse.status === 200) {
      const payload = await extractResponseBody(initialResponse);
      const definition = payload?.definition || null;

      if (!definition) {
        return res.status(502).json({
          error: "Unexpected response shape",
          message: "Report definition response did not include a definition payload.",
          rawResponse: payload,
        });
      }

      console.log("[Metadata API] POST /api/metadata/report-definition completed (direct)", {
        ...requestContext,
        workspaceId,
        reportId,
        parts: Array.isArray(definition?.parts) ? definition.parts.length : 0,
        elapsedMs: Date.now() - startedAt,
      });

      return res.status(200).json({
        definition,
        source: "direct",
        fetchedAt: new Date().toISOString(),
        rawResponse: payload,
      });
    }

    if (initialResponse.status === 202) {
      const locationUrl = initialResponse.headers.get("Location");
      if (!locationUrl) {
        return res.status(502).json({
          error: "Missing operation location",
          message: "Get report definition returned 202 without a Location header.",
        });
      }

      const lroResult = await resolveReportDefinitionViaLro(accessToken, locationUrl);

      console.log("[Metadata API] POST /api/metadata/report-definition completed (lro)", {
        ...requestContext,
        workspaceId,
        reportId,
        attempts: lroResult.attempts,
        parts: Array.isArray(lroResult?.definition?.parts) ? lroResult.definition.parts.length : 0,
        elapsedMs: Date.now() - startedAt,
      });

      return res.status(200).json({
        definition: lroResult.definition,
        source: lroResult.source,
        operationStatus: lroResult.operationStatus,
        attempts: lroResult.attempts,
        fetchedAt: new Date().toISOString(),
        rawResponse: lroResult.operationBody,
      });
    }

    const failureBody = await extractResponseBody(initialResponse);
    return res.status(initialResponse.status).json({
      error: "Get report definition failed",
      message: getErrorMessageFromResponseBody(failureBody),
      rawResponse: failureBody,
    });
  } catch (error) {
    console.error("[Metadata API] Report definition retrieval failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Report definition retrieval failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * POST /api/metadata/report-scanner/persist
 * Store report scan results in database
 * Body: { scanData: { reportId, workspaceId, reportName, pages, filters, ... } }
 */
router.post("/api/metadata/report-scanner/persist", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!reportScannerPersistence) {
      return res.status(503).json({
        error: "Report scanner persistence not initialized",
        message: "Database connection is not configured or service principal credentials are missing.",
      });
    }

    const scanData = req.body?.scanData;
    if (!scanData || !scanData.reportId || !scanData.workspaceId) {
      return res.status(400).json({
        error: "Invalid payload",
        message: "scanData with reportId and workspaceId is required.",
      });
    }

    const reportUID = await reportScannerPersistence.storeReportScan(scanData);

    console.log("[Metadata API] POST /api/metadata/report-scanner/persist completed", {
      ...requestContext,
      reportUID,
      reportId: scanData.reportId,
      workspaceId: scanData.workspaceId,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      reportUID,
      success: true,
    });
  } catch (error) {
    console.error("[Metadata API] Report scanner persistence failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Report scanner persistence failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * GET /api/metadata/report-scanner/history/:workspaceId/:reportId
 * Get scan history for a specific report
 */
router.get("/api/metadata/report-scanner/history/:workspaceId/:reportId", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!reportScannerPersistence) {
      return res.status(503).json({
        error: "Report scanner persistence not initialized",
        message: "Database connection is not configured.",
      });
    }

    const { workspaceId, reportId } = req.params;
    const history = await reportScannerPersistence.getReportScanHistory(workspaceId, reportId);

    console.log("[Metadata API] GET /api/metadata/report-scanner/history completed", {
      ...requestContext,
      workspaceId,
      reportId,
      historyCount: history.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({ history });
  } catch (error) {
    console.error("[Metadata API] Report scanner history retrieval failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Report scanner history retrieval failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * GET /api/metadata/report-scanner/field-usage
 * Get field usage across all scanned reports
 * Query params: ?tableName=xxx&fieldName=xxx
 */
router.get("/api/metadata/report-scanner/field-usage", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!reportScannerPersistence) {
      return res.status(503).json({
        error: "Report scanner persistence not initialized",
        message: "Database connection is not configured.",
      });
    }

    const { tableName, fieldName } = req.query;
    const usage = await reportScannerPersistence.getFieldUsage(tableName, fieldName);

    console.log("[Metadata API] GET /api/metadata/report-scanner/field-usage completed", {
      ...requestContext,
      tableName,
      fieldName,
      usageCount: usage.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({ usage });
  } catch (error) {
    console.error("[Metadata API] Field usage retrieval failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Field usage retrieval failed",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * GET /api/metadata/report-scanner/dataset-usage
 * Get dataset usage summary
 */
router.get("/api/metadata/report-scanner/dataset-usage", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!reportScannerPersistence) {
      return res.status(503).json({
        error: "Report scanner persistence not initialized",
        message: "Database connection is not configured.",
      });
    }

    const usage = await reportScannerPersistence.getDatasetUsageSummary();

    console.log("[Metadata API] GET /api/metadata/report-scanner/dataset-usage completed", {
      ...requestContext,
      usageCount: usage.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({ usage });
  } catch (error) {
    console.error("[Metadata API] Dataset usage retrieval failed", {
      ...requestContext,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: "Dataset usage retrieval failed",
      message: error?.message || "Unknown error",
    });
  }
});

router.get("/api/metadata/report-scanner/persistence-status", async (_req, res) => {
  return res.status(200).json(getReportScannerPersistenceStatus());
});

router.get("/api/metadata/sql-persistence/schema-script", async (req, res) => {
  try {
    const { schema, script } = await buildSqlPersistenceSchemaScript(
      req.query?.schema || reportScannerPersistence?.connectionConfig?.schema || "dbo"
    );

    return res.status(200).json({
      schema,
      script,
      tables: [
        "Report",
        "Page",
        "Visuals",
        "VisualElements",
        "Filters",
        "ScanHistory",
        "InsightWorkbenchSnapshot",
      ],
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load SQL schema script",
      message: error?.message || "Unknown error",
    });
  }
});

router.post("/api/metadata/sql-persistence/test-connection", async (_req, res) => {
  try {
    ensureSqlPersistenceConfigured();
    await validateReportScannerPersistenceConnection();
    return res.status(200).json({
      ...getReportScannerPersistenceStatus(),
      validationSucceeded: true,
      message: "SQL connection validated successfully.",
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      error: "Failed to validate SQL connection",
      message: error?.message || "Unknown error",
      ...getReportScannerPersistenceStatus(),
      validationSucceeded: false,
    });
  }
});

router.post("/api/metadata/sql-persistence/setup-schema", async (req, res) => {
  try {
    ensureSqlPersistenceConfigured();
    const { schema, script } = await buildSqlPersistenceSchemaScript(
      req.body?.schema || reportScannerPersistence?.connectionConfig?.schema || "dbo"
    );
    await reportScannerPersistence.executeBatch(script);
    return res.status(200).json({
      ...getReportScannerPersistenceStatus(),
      schema,
      validationSucceeded: true,
      message: `SQL schema '${schema}' is ready.`,
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      error: "Failed to set up SQL schema",
      message: error?.message || "Unknown error",
      ...getReportScannerPersistenceStatus(),
      validationSucceeded: false,
    });
  }
});

router.post("/api/metadata/sql-persistence/mirror-snapshot", async (req, res) => {
  try {
    ensureSqlPersistenceConfigured();

    const snapshot = req.body?.snapshot;
    if (!snapshot?.snapshotId || !snapshot?.snapshotKind || !snapshot?.savedAtUtc || !snapshot?.oneLakeFilePath || !snapshot?.contentFormat) {
      return res.status(400).json({
        error: "Invalid payload",
        message: "snapshotId, snapshotKind, savedAtUtc, oneLakeFilePath, and contentFormat are required.",
      });
    }

    if (typeof snapshot.payload !== "string") {
      return res.status(400).json({
        error: "Invalid payload",
        message: "snapshot.payload must be a string.",
      });
    }

    if (reportScannerPersistence.connectionConfig?.persistSnapshots === false) {
      return res.status(200).json({
        persisted: false,
        message: "Snapshot mirroring is disabled in the current SQL runtime configuration.",
      });
    }

    await reportScannerPersistence.storeWorkbenchSnapshot({
      snapshotId: snapshot.snapshotId,
      snapshotKind: snapshot.snapshotKind,
      sectionName: snapshot.sectionName,
      entityType: snapshot.entityType,
      entityId: snapshot.entityId,
      workspaceId: snapshot.workspaceId,
      displayName: snapshot.displayName,
      label: snapshot.label,
      savedAtUtc: snapshot.savedAtUtc,
      oneLakeFilePath: snapshot.oneLakeFilePath,
      contentFormat: snapshot.contentFormat,
      payload: snapshot.payload,
      source: snapshot.source || "InsightWorkbench",
    });

    return res.status(200).json({
      persisted: true,
      message: "Snapshot mirrored to SQL successfully.",
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      error: "Failed to mirror snapshot to SQL",
      message: error?.message || "Unknown error",
    });
  }
});

router.post("/api/metadata/report-scanner/persistence-configure", async (req, res) => {
  const { enabled, server, database, schema, persistReportScanner, persistSnapshots } = req.body || {};

  if (!enabled) {
    reportScannerPersistence = null;
    return res.status(200).json({
      configured: false,
      backendIdentityConfigured:
        Boolean(process.env.TENANT_ID) &&
        Boolean(process.env.BACKEND_APPID) &&
        Boolean(process.env.BACKEND_CLIENT_SECRET),
      message: "Runtime SQL persistence disabled.",
    });
  }

  if (!server || !database) {
    return res.status(400).json({
      error: "Invalid payload",
      message: "server and database are required when enabling SQL persistence.",
    });
  }

  const hasServicePrincipal =
    Boolean(process.env.TENANT_ID) &&
    Boolean(process.env.BACKEND_APPID) &&
    Boolean(process.env.BACKEND_CLIENT_SECRET);

  if (!hasServicePrincipal) {
    return res.status(400).json({
      error: "Backend identity not configured",
      message:
        "The dev server still requires TENANT_ID, BACKEND_APPID, and BACKEND_CLIENT_SECRET for SQL token acquisition.",
    });
  }

  try {
    const normalizedSchema = normalizeSqlSchemaName(schema);
    initializeReportScannerPersistence({
      server,
      database,
      schema: normalizedSchema,
      persistReportScanner: persistReportScanner !== false,
      persistSnapshots: persistSnapshots !== false,
      tenantId: process.env.TENANT_ID,
      clientId: process.env.BACKEND_APPID,
      clientSecret: process.env.BACKEND_CLIENT_SECRET,
    });

    await validateReportScannerPersistenceConnection();

    return res.status(200).json({
      ...getReportScannerPersistenceStatus(),
      validationSucceeded: true,
      schema: normalizedSchema,
      persistReportScanner: persistReportScanner !== false,
      persistSnapshots: persistSnapshots !== false,
      message: "Runtime SQL persistence configured successfully.",
    });
  } catch (error) {
    reportScannerPersistence = null;
    return res.status(500).json({
      error: "Failed to configure SQL persistence",
      message: error?.message || "Unknown error",
      configured: false,
      backendIdentityConfigured: true,
    });
  }
});

/**
 * Initialize Report Scanner Persistence (optional)
 * Called when SQL database credentials are available
 */
function initializeReportScannerPersistence(config) {
  if (!config || !config.server || !config.database) {
    console.log("[Metadata API] Report scanner persistence not configured, skipping initialization");
    return;
  }

  try {
    reportScannerPersistence = new ReportScannerPersistenceService();
    reportScannerPersistence.initialize(config);
    reportScannerPersistence.connectionConfig.schema = normalizeSqlSchemaName(config.schema);
    reportScannerPersistence.connectionConfig.persistReportScanner = config.persistReportScanner !== false;
    reportScannerPersistence.connectionConfig.persistSnapshots = config.persistSnapshots !== false;
    console.log("[Metadata API] Report scanner persistence initialized successfully");
  } catch (error) {
    console.error("[Metadata API] Failed to initialize report scanner persistence", {
      server: config.server,
      database: config.database,
      error: error.message,
    });
    reportScannerPersistence = null;
  }
}

module.exports = {
  router,
  initializeMetadataApi,
  initializeReportScannerPersistence,
};
