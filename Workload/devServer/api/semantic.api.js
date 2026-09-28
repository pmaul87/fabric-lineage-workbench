/**
 * Semantic Analyzer API Routes
 *
 * GET  /api/semantic/models                              – list semantic models
 * GET  /api/semantic/models/:workspaceId/:datasetId/entities – load entity graph
 *
 * Architecture mirrors metadata.api.js:
 * - Models endpoint uses Fabric Platform client (via MetadataService)
 * - Entities endpoint uses Power BI XMLA token forwarded from the frontend
 */

const express = require("express");
const MetadataService = require("../services/MetadataService");
const SemanticAnalyzerService = require("../services/SemanticAnalyzerService");
const {
  createFabricPlatformClientForRequest,
} = require("../services/FabricPlatformApiClientFactory");
const { computeEntityReportUsage, computeEntityReportUsageWithAutoLineage } = require("../services/SemanticReportUsageService");

const router = express.Router();
let fallbackFabricPlatformApiClient = null;

const semanticService = new SemanticAnalyzerService();

function createRequestContext(req) {
  const correlationId =
    req.headers["x-ms-request-id"] ||
    req.headers["x-request-id"] ||
    `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    correlationId,
    method: req.method,
    path: req.path,
    hasAuthorizationHeader: Boolean(req.headers?.authorization),
    userAgent: req.headers["user-agent"] || "unknown",
  };
}

/**
 * Initialize Semantic API with Fabric Platform API client.
 * Call once during server startup.
 *
 * @param {object} fabricPlatformApiClient Authenticated Fabric API client
 */
function initializeSemanticApi(fabricPlatformApiClient) {
  fallbackFabricPlatformApiClient = fabricPlatformApiClient;
  console.log("[Semantic API] Initialized with Fabric Platform API client");
}

// ---------------------------------------------------------------------------
// GET /api/semantic/models
// ---------------------------------------------------------------------------
/**
 * Returns all semantic models (SemanticModel / Dataset) visible to the user.
 * Uses the same MetadataService + Fabric Platform token flow as the
 * metadata explorer.
 *
 * Response:
 *   { models: SemanticModel[] }
 */
router.get("/api/semantic/models", async (req, res) => {
  const requestContext = createRequestContext(req);
  const startedAt = Date.now();

  try {
    if (!fallbackFabricPlatformApiClient) {
      console.error(
        "[Semantic API] Service unavailable – fallback client not initialized",
        requestContext
      );
      return res.status(501).json({
        error: "Semantic API not initialized",
        message:
          "Server needs to be restarted or Semantic API needs configuration.",
      });
    }

    const { client, mode } = createFabricPlatformClientForRequest(
      req,
      fallbackFabricPlatformApiClient
    );
    const metadataService = new MetadataService(client);

    console.log("[Semantic API] GET /api/semantic/models", {
      ...requestContext,
      authMode: mode,
    });

    const result = await metadataService.loadArtifacts({
      includeTrace: false,
      maxArtifacts: 0,
    });

    const models = (result.artifacts ?? [])
      .filter(
        (artifact) =>
          artifact.type === "SemanticModel" || artifact.type === "Dataset"
      )
      .sort((a, b) => {
        return (
          a.displayName.localeCompare(b.displayName) ||
          a.workspaceName.localeCompare(b.workspaceName)
        );
      })
      .map((artifact) => ({
        id: artifact.id,
        displayName: artifact.displayName,
        type: artifact.type,
        workspaceId: artifact.workspaceId,
        workspaceName: artifact.workspaceName,
      }));

    console.log("[Semantic API] GET /api/semantic/models completed", {
      ...requestContext,
      authMode: mode,
      modelCount: models.length,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({ models });
  } catch (error) {
    console.error("[Semantic API] GET /api/semantic/models failed", {
      ...requestContext,
      message: error?.message || "Unknown error",
      stack: error?.stack,
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(500).json({
      error: "Failed to load semantic models",
      message: error?.message || "Unknown error",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/semantic/models/:workspaceId/:datasetId/entities
// ---------------------------------------------------------------------------
/**
 * Loads the full entity + dependency graph for a semantic model.
 * The frontend passes its Power BI XMLA bearer token in the Authorization
 * header — the backend forwards it directly to the Power BI REST API.
 *
 * Response:
 *   { entities: SemanticEntity[], dependencies: SemanticDependency[] }
 */
router.get(
  "/api/semantic/models/:workspaceId/:datasetId/entities",
  async (req, res) => {
    const requestContext = createRequestContext(req);
    const startedAt = Date.now();
    const { workspaceId, datasetId } = req.params;
    const workspaceName =
      typeof req.query?.workspaceName === "string" ? req.query.workspaceName : undefined;
    const datasetName =
      typeof req.query?.datasetName === "string" ? req.query.datasetName : undefined;

    try {
      const authHeader = req.headers?.authorization ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "Unauthorized",
          message:
            "A Power BI bearer token is required in the Authorization header.",
        });
      }

      const accessToken = authHeader.slice("Bearer ".length).trim();

      console.log(
        "[Semantic API] GET /api/semantic/models/:workspaceId/:datasetId/entities",
        { ...requestContext, workspaceId, datasetId, workspaceName, datasetName }
      );

      const result = await semanticService.loadModelEntities(
        accessToken,
        workspaceId,
        datasetId,
        workspaceName,
        datasetName
      );

      console.log(
        "[Semantic API] GET /api/semantic/models/:workspaceId/:datasetId/entities completed",
        {
          ...requestContext,
          workspaceId,
          datasetId,
          entityCount: result.entities.length,
          dependencyCount: result.dependencies.length,
          elapsedMs: Date.now() - startedAt,
        }
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error(
        "[Semantic API] GET /api/semantic/models/:workspaceId/:datasetId/entities failed",
        {
          ...requestContext,
          workspaceId,
          datasetId,
          message: error?.message || "Unknown error",
          stack: error?.stack,
          elapsedMs: Date.now() - startedAt,
        }
      );

      return res.status(500).json({
        error: "Failed to load semantic model entities",
        message: error?.message || "Unknown error",
      });
    }
  }
);

router.get(
  "/api/semantic/models/:workspaceId/:datasetId/table-stats",
  async (req, res) => {
    const { workspaceId, datasetId } = req.params;
    const tableName = typeof req.query?.tableName === "string" ? req.query.tableName : "";

    if (!tableName) {
      return res.status(400).json({
        error: "Missing parameter",
        message: "Query parameter 'tableName' is required.",
      });
    }

    try {
      const authHeader = req.headers?.authorization ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "A Power BI bearer token is required in the Authorization header.",
        });
      }

      const accessToken = authHeader.slice("Bearer ".length).trim();
      const result = await semanticService.loadTableStats(accessToken, workspaceId, datasetId, tableName);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load table statistics",
        message: error?.message || "Unknown error",
      });
    }
  }
);

router.get(
  "/api/semantic/models/:workspaceId/:datasetId/column-stats",
  async (req, res) => {
    const { workspaceId, datasetId } = req.params;
    const tableName = typeof req.query?.tableName === "string" ? req.query.tableName : "";
    const columnName = typeof req.query?.columnName === "string" ? req.query.columnName : "";

    if (!tableName || !columnName) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Query parameters 'tableName' and 'columnName' are required.",
      });
    }

    try {
      const authHeader = req.headers?.authorization ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "A Power BI bearer token is required in the Authorization header.",
        });
      }

      const accessToken = authHeader.slice("Bearer ".length).trim();
      const result = await semanticService.loadColumnStats(
        accessToken,
        workspaceId,
        datasetId,
        tableName,
        columnName
      );

      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load column statistics",
        message: error?.message || "Unknown error",
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/semantic/models/:workspaceId/:datasetId/report-usage
// ---------------------------------------------------------------------------
/**
 * Consolidated report-usage endpoint. Replaces the 3 separate frontend calls:
 *   1. loadArtifacts
 *   2. loadLineageLinks
 *   3. loadSemanticModelReportUsage
 *
 * Headers:
 *   Authorization:   Bearer <Fabric Platform token (WORKSPACE_READ + ITEM_READWRITE)>
 *   X-PowerBI-Token: Bearer <Power BI token (Dataset.Read.All)>
 *
 * Response: { entityUsageById, reportsUsingModel, scanErrors }
 */
router.get(
  "/api/semantic/models/:workspaceId/:datasetId/report-usage",
  async (req, res) => {
    const { workspaceId, datasetId } = req.params;
    const authHeader = req.headers?.authorization ?? "";
    const powerBiHeader = req.headers?.["x-powerbi-token"] ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid Authorization header" });
    }
    if (!powerBiHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid X-PowerBI-Token header" });
    }
    const accessToken = authHeader.slice("Bearer ".length).trim();
    const powerBiToken = powerBiHeader.slice("Bearer ".length).trim();

    if (!fallbackFabricPlatformApiClient) {
      return res.status(503).json({ error: "Service not initialized" });
    }

    try {
      const { client } = createFabricPlatformClientForRequest(req, fallbackFabricPlatformApiClient);
      const metadataService = new MetadataService(client);

      // Load cached entity graph (may be empty if not yet analysed)
      const cached = await semanticService.cacheService?.getCachedModelData(workspaceId, datasetId);
      const entities = cached?.entities ?? [];
      const dependencies = cached?.dependencies ?? [];

      const result = await computeEntityReportUsageWithAutoLineage({
        accessToken,
        powerBiToken,
        model: { id: datasetId, workspaceId },
        entities,
        dependencies,
        metadataService,
      });

      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to compute report usage",
        message: error?.message || "Unknown error",
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/semantic/models/:workspaceId/:datasetId/cache/invalidate
// ---------------------------------------------------------------------------
/**
 * Invalidates the cached entity graph for the given model.
 * Next entity-graph request will re-compute from scratch.
 */
router.post(
  "/api/semantic/models/:workspaceId/:datasetId/cache/invalidate",
  async (req, res) => {
    const { workspaceId, datasetId } = req.params;
    try {
      await semanticService.cacheService?.invalidateCache(workspaceId, datasetId);
      return res.status(200).json({ invalidated: true, workspaceId, datasetId });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to invalidate cache",
        message: error?.message || "Unknown error",
      });
    }
  }
);

module.exports = {
  router,
  initializeSemanticApi,
};
