/**
 * SemanticReportUsageService
 * Shared service for computing entity-level report usage for semantic models.
 *
 * Extracted from metadata.api.js so the logic can be reused by both:
 *  - POST /api/metadata/semantic-model-report-usage  (existing, legacy)
 *  - GET  /api/semantic/models/:ws/:ds/report-usage   (new, consolidated)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FABRIC_API_BASE_URL = "https://api.fabric.microsoft.com/v1";
const POWER_BI_API_BASE_URL = "https://api.powerbi.com/v1.0/myorg";

// ---------------------------------------------------------------------------
// Fabric API helpers
// ---------------------------------------------------------------------------

async function executePowerBiGet(accessToken, path) {
  const response = await fetch(`${POWER_BI_API_BASE_URL}${path}`, {
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

/**
 * Resolve report-to-dataset lineage links for a collection of artifacts.
 *
 * @param {string} powerBiToken  Power BI scoped bearer token
 * @param {Array}  artifacts     ExplorerArtifact[]
 * @returns {Promise<Array>}     LineageLink[]
 */
async function resolveReportLineageLinks(powerBiToken, artifacts) {
  const reportArtifacts = artifacts.filter(
    (artifact) => String(artifact?.type || "").toLowerCase() === "report"
  );
  const datasetArtifacts = artifacts.filter((artifact) => {
    const type = String(artifact?.type || "").toLowerCase();
    return type === "semanticmodel" || type === "dataset";
  });

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

  for (const workspaceId of [...new Set(reportArtifacts.map((a) => a.workspaceId))]) {
    try {
      const payload = await executePowerBiGet(powerBiToken, `/groups/${workspaceId}/reports`);
      const rows = Array.isArray(payload?.value) ? payload.value : [];

      for (const report of rows) {
        const reportId = report?.id;
        const datasetId = report?.datasetId;
        if (!reportId || !datasetId) continue;

        const source = reportByWorkspaceAndId.get(`${workspaceId}:${reportId}`);
        if (!source) continue;

        const datasetCandidates = datasetsById.get(String(datasetId)) ?? [];
        if (!datasetCandidates.length) continue;

        const target =
          datasetCandidates.find((c) => c.workspaceId === workspaceId) ?? datasetCandidates[0];

        const id = `report-uses-dataset:${source.workspaceId}:${source.id}:${target.workspaceId}:${target.id}`;
        if (linkIds.has(id)) continue;
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
      console.warn("[SemanticReportUsageService] Lineage resolution failed for workspace", {
        workspaceId,
        message: error?.message || "Unknown error",
      });
    }
  }

  return links;
}

async function executeFabricPost(accessToken, path, body) {
  const response = await fetch(`${FABRIC_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

async function executeFabricGetAbsolute(accessToken, absoluteUrl) {
  const response = await fetch(absoluteUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response;
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

/**
 * Resolve a report definition via a Fabric LRO location URL.
 */
async function resolveReportDefinitionViaLro(accessToken, locationUrl, maxAttempts = 8) {
  let attempts = 0;
  let lastBody = null;
  let lastStatus = 202;

  while (attempts < maxAttempts) {
    attempts += 1;
    const operationResponse = await executeFabricGetAbsolute(accessToken, locationUrl);
    lastStatus = operationResponse.status;
    const body = await extractResponseBody(operationResponse);
    lastBody = body;

    const operationStatus = String(body?.status || "").toLowerCase();

    if (operationResponse.status === 200 && (operationStatus === "running" || operationStatus === "notstarted")) {
      const retryAfterSeconds = parseRetryAfterSeconds(operationResponse, 2);
      await sleep(Math.min(5000, retryAfterSeconds * 1000));
      continue;
    }

    if (operationResponse.status === 202) {
      const retryAfterSeconds = parseRetryAfterSeconds(operationResponse, 2);
      await sleep(Math.min(5000, retryAfterSeconds * 1000));
      continue;
    }

    if (operationResponse.status === 200) {
      if (operationStatus === "failed") {
        throw new Error(`Report definition operation failed: ${getErrorMessageFromResponseBody(body)}`);
      }

      const inlineDefinition = body?.result?.definition || body?.definition || null;
      if (inlineDefinition) {
        return {
          definition: inlineDefinition,
          source: "lro",
          operationStatus: "Succeeded",
          operationBody: body,
          attempts,
        };
      }

      const resultUrl = locationUrl.replace(/\/$/, "") + "/result";
      const resultResponse = await executeFabricGetAbsolute(accessToken, resultUrl);
      const resultBody = await extractResponseBody(resultResponse);
      if (resultResponse.status !== 200) {
        throw new Error(`Failed to fetch LRO result from ${resultUrl}: ${getErrorMessageFromResponseBody(resultBody)}`);
      }
      const resultDefinition = resultBody?.definition || null;
      if (!resultDefinition) {
        throw new Error(`LRO result endpoint returned no definition: ${JSON.stringify(resultBody)}`);
      }
      return {
        definition: resultDefinition,
        source: "lro-result",
        operationStatus: "Succeeded",
        operationBody: resultBody,
        attempts,
      };
    }

    throw new Error(
      `Unexpected LRO status ${operationResponse.status}: ${getErrorMessageFromResponseBody(body)}`
    );
  }

  throw new Error(
    `LRO did not complete in ${maxAttempts} attempts. Last status: ${lastStatus}. Last body: ${JSON.stringify(lastBody)}`
  );
}

// ---------------------------------------------------------------------------
// Report definition fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the definition of a single Fabric report.
 * Handles both synchronous (200) and async LRO (202) responses.
 *
 * @param {string} accessToken  Fabric Platform bearer token
 * @param {string} workspaceId  Workspace GUID
 * @param {string} reportId     Report GUID
 * @returns {Promise<object>}   Resolved definition object
 */
async function fetchReportDefinition(accessToken, workspaceId, reportId) {
  const endpoint = `/workspaces/${workspaceId}/reports/${reportId}/getDefinition`;
  const initialResponse = await executeFabricPost(accessToken, endpoint);

  if (initialResponse.status === 200) {
    const payload = await extractResponseBody(initialResponse);
    const definition = payload?.definition || null;
    if (!definition) {
      throw new Error("Definition payload was empty");
    }
    return definition;
  }

  if (initialResponse.status === 202) {
    const locationUrl = initialResponse.headers.get("Location");
    if (!locationUrl) {
      throw new Error("getDefinition returned 202 without Location header");
    }
    const lroResult = await resolveReportDefinitionViaLro(accessToken, locationUrl);
    return lroResult.definition;
  }

  const body = await extractResponseBody(initialResponse);
  throw new Error(getErrorMessageFromResponseBody(body));
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

function parseQualifiedIdentifier(value) {
  if (typeof value !== "string") {
    return null;
  }
  const withTable = value.match(/^'([^']+)'\[([^\]]+)\]$/);
  if (withTable) {
    return { tableName: withTable[1], name: withTable[2] };
  }
  const bare = value.match(/^\[([^\]]+)\]$/);
  if (bare) {
    return { tableName: undefined, name: bare[1] };
  }
  return null;
}

function normalizeEntityKey(type, tableName, name) {
  const tableKey = (tableName || "").trim().toLowerCase();
  return `${type}|${tableKey}|${String(name || "").trim().toLowerCase()}`;
}

function decodeDefinitionPartPayload(payload) {
  if (typeof payload !== "string" || payload.length === 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function collectQueryRefsFromValue(value, bucket) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.includes("[") || value.includes("'")) {
      bucket.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectQueryRefsFromValue(item, bucket);
    }
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      const nextValue = value[key];
      if (key.toLowerCase() === "queryref" && typeof nextValue === "string") {
        bucket.push(nextValue);
      }
      collectQueryRefsFromValue(nextValue, bucket);
    }
  }
}

function extractFieldReferencesFromDefinition(definition) {
  const refs = [];
  const parts = Array.isArray(definition?.parts) ? definition.parts : [];

  for (const part of parts) {
    const parsed = decodeDefinitionPartPayload(part?.payload);
    if (!parsed) {
      continue;
    }
    collectQueryRefsFromValue(parsed, refs);
  }

  const result = [];
  for (const value of refs) {
    const parsed = parseQualifiedIdentifier(value);
    if (parsed?.name) {
      result.push(parsed);
      continue;
    }
    const regex = /'([^']+)'\[([^\]]+)\]|\[([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(String(value))) !== null) {
      if (match[1] && match[2]) {
        result.push({ tableName: match[1], name: match[2] });
      } else if (match[3]) {
        result.push({ tableName: undefined, name: match[3] });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Build a per-entity report usage summary given the semantic model data and
 * scanned report definitions.
 *
 * @param {object} params
 * @param {object} params.model               { id, workspaceId }
 * @param {Array}  params.entities            SemanticEntity[]
 * @param {Array}  params.dependencies        SemanticDependency[]
 * @param {Array}  params.reportsUsingModel   ExplorerArtifact[] (reports linked to model)
 * @param {Array}  params.scannedReports      Array<{ report: ExplorerArtifact, definition: object }>
 * @returns {{ model: object, entityUsageById: Record<string, object> }}
 */
function buildSemanticUsageSummary({ model, entities, dependencies, reportsUsingModel, scannedReports }) {
  const entityById = new Map();
  const directIndex = new Map();
  const tableIndex = new Map();
  const unnamedIndex = new Map();

  for (const entity of entities) {
    entityById.set(entity.id, entity);

    if (entity.type === "Column" || entity.type === "Measure") {
      directIndex.set(normalizeEntityKey(entity.type, entity.tableName, entity.name), entity.id);
      unnamedIndex.set(normalizeEntityKey(entity.type, undefined, entity.name), entity.id);
    }

    if (entity.type === "Table") {
      tableIndex.set(normalizeEntityKey("Table", undefined, entity.name), entity.id);
    }
  }

  const dependencyTargetsBySource = new Map();
  for (const dependency of dependencies) {
    if (!dependency?.sourceId || !dependency?.targetId) {
      continue;
    }
    const targets = dependencyTargetsBySource.get(dependency.sourceId) || new Set();
    targets.add(dependency.targetId);
    dependencyTargetsBySource.set(dependency.sourceId, targets);
  }

  const usageByEntityId = new Map();

  const addUsage = (entityId, report, usageKind) => {
    const existing = usageByEntityId.get(entityId) || {
      entityId,
      reportCount: 0,
      directReportCount: 0,
      reports: [],
    };

    const reportKey = `${report.workspaceId}:${report.id}`;
    if (!existing.reports.some((entry) => `${entry.workspaceId}:${entry.reportId}` === reportKey)) {
      existing.reports.push({
        reportId: report.id,
        reportName: report.displayName,
        workspaceId: report.workspaceId,
        workspaceName: report.workspaceName,
        usageKind,
      });
      existing.reportCount += 1;
      if (usageKind === "direct") {
        existing.directReportCount += 1;
      }
    }

    usageByEntityId.set(entityId, existing);
  };

  for (const report of scannedReports) {
    const matchedReport = reportsUsingModel.find(
      (candidate) => candidate.id === report.report.id && candidate.workspaceId === report.report.workspaceId
    );
    if (!matchedReport) {
      continue;
    }

    const fieldRefs = extractFieldReferencesFromDefinition(report.definition);
    const directEntityIds = new Set();

    for (const ref of fieldRefs) {
      if (ref.tableName) {
        const columnId = directIndex.get(normalizeEntityKey("Column", ref.tableName, ref.name));
        const measureId = directIndex.get(normalizeEntityKey("Measure", ref.tableName, ref.name));
        if (columnId) directEntityIds.add(columnId);
        if (measureId) directEntityIds.add(measureId);
      } else {
        const measureId = unnamedIndex.get(normalizeEntityKey("Measure", undefined, ref.name));
        const columnId = unnamedIndex.get(normalizeEntityKey("Column", undefined, ref.name));
        if (measureId) directEntityIds.add(measureId);
        if (columnId) directEntityIds.add(columnId);
      }
    }

    const dependencyEntityIds = new Set();
    const queue = [...directEntityIds];
    const visited = new Set(queue);

    while (queue.length > 0) {
      const current = queue.shift();
      const targets = dependencyTargetsBySource.get(current);
      if (!targets) {
        continue;
      }
      for (const targetId of targets) {
        if (visited.has(targetId)) {
          continue;
        }
        visited.add(targetId);
        dependencyEntityIds.add(targetId);
        queue.push(targetId);
      }
    }

    const tableEntityIds = new Set();
    for (const entityId of [...directEntityIds, ...dependencyEntityIds]) {
      const entity = entityById.get(entityId);
      if (!entity?.tableName) {
        continue;
      }
      const tableId = tableIndex.get(normalizeEntityKey("Table", undefined, entity.tableName));
      if (tableId) {
        tableEntityIds.add(tableId);
      }
    }

    for (const entityId of directEntityIds) {
      addUsage(entityId, matchedReport, "direct");
    }

    for (const entityId of dependencyEntityIds) {
      if (!directEntityIds.has(entityId)) {
        addUsage(entityId, matchedReport, "dependency");
      }
    }

    for (const entityId of tableEntityIds) {
      if (!directEntityIds.has(entityId) && !dependencyEntityIds.has(entityId)) {
        addUsage(entityId, matchedReport, "table");
      }
    }
  }

  const entityUsageById = Object.fromEntries(
    Array.from(usageByEntityId.entries()).map(([entityId, value]) => {
      value.reports.sort((left, right) => {
        return (
          left.workspaceName.localeCompare(right.workspaceName) ||
          left.reportName.localeCompare(right.reportName) ||
          left.reportId.localeCompare(right.reportId)
        );
      });
      return [entityId, value];
    })
  );

  return {
    model: { id: model.id, workspaceId: model.workspaceId },
    entityUsageById,
  };
}

// ---------------------------------------------------------------------------
// High-level orchestration
// ---------------------------------------------------------------------------

/**
 * Compute report usage for all entities in a semantic model.
 *
 * Fetches report definitions for every report that references the model via
 * lineage links, then builds a per-entity usage summary.
 *
 * @param {object} params
 * @param {string} params.accessToken         Fabric Platform bearer token (WORKSPACE_READ + ITEM_READWRITE)
 * @param {object} params.model               { id, workspaceId, displayName?, workspaceName? }
 * @param {Array}  params.entities            SemanticEntity[]
 * @param {Array}  params.dependencies        SemanticDependency[]
 * @param {Array}  params.artifacts           ExplorerArtifact[] — all workspace artifacts
 * @param {Array}  params.lineageLinks        LineageLink[] — workspace lineage
 * @returns {Promise<{ entityUsageById, reportsUsingModel, scanErrors }>}
 */
async function computeEntityReportUsageWithAutoLineage({
  accessToken,
  powerBiToken,
  model,
  entities,
  dependencies,
  metadataService,
}) {
  // Load all artifacts using MetadataService (Fabric Platform credentials)
  const artifactResult = await metadataService.loadArtifacts({ includeTrace: false, maxArtifacts: 0 });
  const artifacts = artifactResult.artifacts ?? [];

  // Resolve lineage using Power BI token
  const lineageLinks = await resolveReportLineageLinks(powerBiToken, artifacts);

  return computeEntityReportUsage({ accessToken, model, entities, dependencies, artifacts, lineageLinks });
}

async function computeEntityReportUsage({ accessToken, model, entities, dependencies, artifacts, lineageLinks }) {
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
    .filter(Boolean);

  const uniqueReports = Array.from(
    new Map(reportsUsingModel.map((r) => [`${r.workspaceId}:${r.id}`, r])).values()
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
      const definition = await fetchReportDefinition(accessToken, report.workspaceId, report.id);
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

  return {
    entityUsageById: usageSummary.entityUsageById,
    reportsUsingModel: uniqueReports,
    scanErrors,
  };
}

module.exports = {
  buildSemanticUsageSummary,
  computeEntityReportUsage,
  fetchReportDefinition,
  extractFieldReferencesFromDefinition,
  normalizeEntityKey,
  computeEntityReportUsageWithAutoLineage,
  resolveReportLineageLinks,
  // Lower-level Fabric API helpers (exported for wiring in metadata.api.js)
  executeFabricPost,
  executeFabricGetAbsolute,
  resolveReportDefinitionViaLro,
};
