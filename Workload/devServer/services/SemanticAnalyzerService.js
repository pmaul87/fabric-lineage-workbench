/**
 * SemanticAnalyzerService (Backend)
 * Executes XMLA queries against Power BI semantic models and builds a
 * strongly-typed entity + dependency graph for the frontend to render.
 *
 * Uses only INFO.VIEW.* functions and INFO.CALCDEPENDENCY — no legacy
 * INFO.MEASURES() / INFO.COLUMNS() queries.
 * 
 * Now includes caching layer and backend pre-calculation of all derived metrics
 * to offload computation from frontend React components.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const execFileAsync = promisify(execFile);

// Import cache service and calculation engine
const SemanticAnalyzerCacheService = require("./SemanticAnalyzerCacheService");
const SemanticAnalyzerCalculationEngine = require("./SemanticAnalyzerCalculationEngine");

// ---------------------------------------------------------------------------
// XMLA helper
// ---------------------------------------------------------------------------

/**
 * Execute a single DAX query via the Power BI REST executeQueries endpoint.
 * Returns the rows array (may be empty; never null).
 *
 * @param {string} accessToken  Bearer token for Power BI API
 * @param {string} workspaceId  Fabric workspace GUID
 * @param {string} datasetId    Semantic model / dataset GUID
 * @param {string} daxQuery     DAX query string (e.g. "EVALUATE INFO.VIEW.TABLES()")
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function executeXmlaQuery(accessToken, workspaceId, datasetId, daxQuery) {
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      queries: [{ query: daxQuery }],
      serializerSettings: { includeNulls: true },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`executeQueries failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  const rows = payload?.results?.[0]?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Execute a DAX query, returning empty array on error (best-effort).
 */
async function executeXmlaQuerySafe(accessToken, workspaceId, datasetId, daxQuery) {
  try {
    return await executeXmlaQuery(accessToken, workspaceId, datasetId, daxQuery);
  } catch (error) {
    console.warn(`[SemanticAnalyzerService] Query failed (safe mode): ${error?.message || error}`);
    return [];
  }
}

function escapeDaxTableName(tableName) {
  return `'${String(tableName).replace(/'/g, "''")}'`;
}

function escapeDaxColumnName(columnName) {
  return `[${String(columnName).replace(/\]/g, "]]" )}]`;
}

function getRowValue(row, key) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const direct = row[key];
  if (direct !== undefined && direct !== null) {
    return direct;
  }

  const bracketed = row[`[${key}]`];
  if (bracketed !== undefined && bracketed !== null) {
    return bracketed;
  }

  const match = Object.entries(row).find(([entryKey]) =>
    entryKey.toLowerCase().endsWith(key.toLowerCase()) ||
    entryKey.toLowerCase().endsWith(`[${key.toLowerCase()}]`)
  );

  return match ? match[1] : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTextOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function getFirstNonFrequencyValue(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const match = Object.entries(row).find(([key, value]) => {
    if (value === null || value === undefined) {
      return false;
    }

    return !key.toLowerCase().includes("frequency");
  });

  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Row-value helpers (normalise XMLA bracket-prefixed column names)
// ---------------------------------------------------------------------------

/**
 * Get the first matching value from a row given a list of candidate keys.
 * Tries exact-match first, then case-insensitive normalisation.
 */
function getAnyValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      return String(value);
    }
  }

  // Fallback: case-insensitive scan
  for (const [rowKey, value] of Object.entries(row)) {
    const normalised = rowKey.toLowerCase();
    if (
      keys.some((k) => normalised === k.toLowerCase()) &&
      value !== undefined &&
      value !== null
    ) {
      return String(value);
    }
  }

  return undefined;
}

/**
 * Get the first value whose key contains all given fragments.
 */
function getValueByKeyFragments(row, fragments, excludedFragments = []) {
  for (const [key, value] of Object.entries(row)) {
    const norm = key.toLowerCase();
    if (
      fragments.every((f) => norm.includes(f.toLowerCase())) &&
      excludedFragments.every((f) => !norm.includes(f.toLowerCase())) &&
      value !== undefined &&
      value !== null &&
      String(value).length > 0
    ) {
      return String(value);
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

function addNameIndex(index, key, id) {
  const current = index.get(key) ?? [];
  index.set(key, [...current, id]);
}

function normaliseEntityKey(tableName, entityName) {
  return `${String(tableName).trim().toLowerCase()}|${String(entityName).trim().toLowerCase()}`;
}

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

function buildEntityLookupIndexes(entities) {
  const tableIdByName = new Map();
  const columnIdByQualifiedName = new Map();
  const measureIdByQualifiedName = new Map();
  const columnIdsByName = new Map();
  const measureIdsByName = new Map();
  const entityById = new Map();

  for (const entity of entities) {
    if (!entity?.id) {
      continue;
    }

    entityById.set(entity.id, entity);

    if (entity.type === "Table") {
      tableIdByName.set(String(entity.name).toLowerCase(), entity.id);
    }

    if (entity.type === "Column" && entity.tableName) {
      const key = normaliseEntityKey(entity.tableName, entity.name);
      columnIdByQualifiedName.set(key, entity.id);
      const byName = columnIdsByName.get(String(entity.name).toLowerCase()) ?? [];
      columnIdsByName.set(String(entity.name).toLowerCase(), [...byName, entity.id]);
    }

    if (entity.type === "Measure" && entity.tableName) {
      const key = normaliseEntityKey(entity.tableName, entity.name);
      measureIdByQualifiedName.set(key, entity.id);
      const byName = measureIdsByName.get(String(entity.name).toLowerCase()) ?? [];
      measureIdsByName.set(String(entity.name).toLowerCase(), [...byName, entity.id]);
    }
  }

  return {
    entityById,
    tableIdByName,
    columnIdByQualifiedName,
    measureIdByQualifiedName,
    columnIdsByName,
    measureIdsByName,
  };
}

function resolveEntityIdFromInfoRow({
  identifier,
  entityType,
  tableName,
  indexes,
}) {
  if (!identifier && !tableName) {
    return undefined;
  }

  const entityTypeNorm = String(entityType || "").toLowerCase();

  const normaliseInfoToken = (value) =>
    String(value || "")
      .trim()
      .replace(/^\[|\]$/g, "")
      .replace(/^'+|'+$/g, "")
      .trim();

  const normaliseInfoTableName = (value) => {
    const normalized = normaliseInfoToken(value);
    if (!normalized) {
      return undefined;
    }

    const dotted = normalized.match(/(?:^|\.)'([^']+)'$/);
    if (dotted?.[1]) {
      return dotted[1].toLowerCase();
    }

    return normalized.toLowerCase();
  };

  const tableNorm = tableName ? normaliseInfoTableName(tableName) : undefined;
  const identifierText = identifier ? String(identifier).trim() : "";
  const identifierNorm = normaliseInfoToken(identifierText);

  if (entityTypeNorm.includes("table") && tableNorm) {
    return indexes.tableIdByName.get(tableNorm);
  }

  const parsed = parseQualifiedIdentifier(identifierText);
  if (parsed?.tableName && parsed?.name) {
    const key = normaliseEntityKey(parsed.tableName, parsed.name);
    return (
      indexes.columnIdByQualifiedName.get(key) ||
      indexes.measureIdByQualifiedName.get(key)
    );
  }

  if (parsed?.name && tableNorm) {
    const key = normaliseEntityKey(tableNorm, parsed.name);
    return (
      indexes.measureIdByQualifiedName.get(key) ||
      indexes.columnIdByQualifiedName.get(key)
    );
  }

  if (identifierNorm && tableNorm) {
    const key = normaliseEntityKey(tableNorm, identifierNorm);
    return (
      indexes.measureIdByQualifiedName.get(key) ||
      indexes.columnIdByQualifiedName.get(key)
    );
  }

  const plainName = identifierNorm.toLowerCase();
  if (!plainName) {
    return undefined;
  }

  const measureCandidates = indexes.measureIdsByName.get(plainName) ?? [];
  if (measureCandidates.length === 1) {
    return measureCandidates[0];
  }

  const columnCandidates = indexes.columnIdsByName.get(plainName) ?? [];
  if (columnCandidates.length === 1) {
    return columnCandidates[0];
  }

  return undefined;
}

function buildDependencyRecord({ sourceId, targetId, dependencyType, indexes }) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return undefined;
  }

  const source = indexes.entityById.get(sourceId);
  const target = indexes.entityById.get(targetId);
  if (!source || !target) {
    return undefined;
  }

  return {
    id: `${sourceId}->${targetId}:${dependencyType}`,
    sourceId,
    sourceName: source.name,
    targetId,
    targetName: target.name,
    dependencyType,
  };
}

async function loadExpressionDependenciesViaInfo(accessToken, workspaceId, datasetId, entities) {
  const indexes = buildEntityLookupIndexes(entities);
  const queryCandidates = [
    "EVALUATE INFO.DEPENDENCIES()",
    "EVALUATE INFO.CALCDEPENDENCY()",
  ];

  let rows = [];
  let queryUsed = null;
  const queryAttempts = [];

  for (const query of queryCandidates) {
    try {
      const result = await executeXmlaQuery(accessToken, workspaceId, datasetId, query);
      queryAttempts.push({ query, rowCount: Array.isArray(result) ? result.length : 0, error: null });
      if (Array.isArray(result) && result.length > 0) {
        rows = result;
        queryUsed = query;
        break;
      }
    } catch (error) {
      queryAttempts.push({ query, rowCount: 0, error: error?.message || String(error) });
    }
  }

  if (rows.length === 0) {
    return { dependencies: [], queryUsed, diagnostics: { queryAttempts, mappedCount: 0 } };
  }

  const unique = new Map();

  for (const row of rows) {
    const objectType =
      getAnyValue(row, ["OBJECT_TYPE", "[OBJECT_TYPE]", "ObjectType"]) ||
      getValueByKeyFragments(row, ["object", "type"], ["referenced"]);
    const referencedType =
      getAnyValue(row, ["REFERENCED_OBJECT_TYPE", "[REFERENCED_OBJECT_TYPE]", "ReferencedObjectType"]) ||
      getValueByKeyFragments(row, ["referenced", "object", "type"]);

    const objectIdentifier =
      getAnyValue(row, ["OBJECT", "[OBJECT]", "Object", "OBJECT_NAME", "[OBJECT_NAME]"]) ||
      getValueByKeyFragments(row, ["object"], ["type", "referenced", "table", "database", "model"]);
    const referencedIdentifier =
      getAnyValue(row, ["REFERENCED_OBJECT", "[REFERENCED_OBJECT]", "ReferencedObject", "REFERENCED_OBJECT_NAME", "[REFERENCED_OBJECT_NAME]"]) ||
      getValueByKeyFragments(row, ["referenced", "object"], ["type", "table", "database", "model"]);

    const objectTable =
      getAnyValue(row, ["TABLE", "[TABLE]", "OBJECT_TABLE", "[OBJECT_TABLE]"]) ||
      getValueByKeyFragments(row, ["object", "table"], ["referenced"]);
    const referencedTable =
      getAnyValue(row, ["REFERENCED_TABLE", "[REFERENCED_TABLE]"]) ||
      getValueByKeyFragments(row, ["referenced", "table"]);

    const sourceId = resolveEntityIdFromInfoRow({
      identifier: objectIdentifier,
      entityType: objectType,
      tableName: objectTable,
      indexes,
    });
    const targetId = resolveEntityIdFromInfoRow({
      identifier: referencedIdentifier,
      entityType: referencedType,
      tableName: referencedTable,
      indexes,
    });

    const record = buildDependencyRecord({
      sourceId,
      targetId,
      dependencyType: "expression",
      indexes,
    });

    if (record) {
      unique.set(record.id, record);
    }
  }

  return {
    dependencies: Array.from(unique.values()),
    queryUsed,
    diagnostics: {
      queryAttempts,
      infoRowCount: rows.length,
      mappedCount: unique.size,
    },
  };
}

async function loadTmdlViaSerializer(accessToken, workspaceId, datasetId, workspaceName, datasetName) {
  const projectPath = path.resolve(
    __dirname,
    "..",
    "tools",
    "TmdlSerializerCli",
    "TmdlSerializerCli.csproj"
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      "dotnet",
      [
        "run",
        "--project",
        projectPath,
        "--",
        "tmdl",
        workspaceName || workspaceId,
        datasetId,
        datasetName || datasetId,
        accessToken,
      ],
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      }
    );

    const content = String(stdout || "").trim();
    if (!content) {
      return {
        source: "tmdl-serializer",
        queryUsed: "TmdlSerializer.SerializeDatabase(database)",
        content: null,
        error: String(stderr || "Serializer returned empty output").trim(),
      };
    }

    return {
      source: "tmdl-serializer",
      queryUsed: "TmdlSerializer.SerializeDatabase(database)",
      content,
      error: null,
    };
  } catch (error) {
    return {
      source: "tmdl-serializer",
      queryUsed: "TmdlSerializer.SerializeDatabase(database)",
      content: null,
      error: error?.stderr
        ? String(error.stderr)
        : error?.message || String(error),
    };
  }
}

async function loadAnalyzerViaXmlaClass(accessToken, workspaceId, datasetId, workspaceName, datasetName) {
  const projectPath = path.resolve(
    __dirname,
    "..",
    "tools",
    "TmdlSerializerCli",
    "TmdlSerializerCli.csproj"
  );

  const { stdout, stderr } = await execFileAsync(
    "dotnet",
    [
      "run",
      "--project",
      projectPath,
      "--",
      "analyze",
      workspaceName || workspaceId,
      datasetId,
      datasetName || datasetId,
      accessToken,
    ],
    {
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  const content = String(stdout || "").trim();
  if (!content) {
    throw new Error(String(stderr || "XMLA analyzer returned empty output").trim());
  }

  return JSON.parse(content);
}

async function loadAnalyzerViaInfoViews(accessToken, workspaceId, datasetId) {
  const entities = [];
  const dependencies = [];

  const tableRows = await executeXmlaQuerySafe(
    accessToken,
    workspaceId,
    datasetId,
    "EVALUATE SELECTCOLUMNS(INFO.VIEW.TABLES(), \"TableName\", [Name], \"IsHidden\", [IsHidden])"
  );

  const columnRows = await executeXmlaQuerySafe(
    accessToken,
    workspaceId,
    datasetId,
    "EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), \"TableName\", [Table], \"Name\", [Name], \"DataType\", [DataType], \"IsHidden\", [IsHidden])"
  );

  const measureRows = await executeXmlaQuerySafe(
    accessToken,
    workspaceId,
    datasetId,
    "EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), \"TableName\", [Table], \"Name\", [Name], \"Expression\", [Expression], \"IsHidden\", [IsHidden])"
  );

  for (const row of tableRows) {
    const tableName = getAnyValue(row, ["TableName", "[TableName]", "Name", "[Name]"]);
    if (!tableName) continue;
    entities.push({
      id: `table:${datasetId}|${tableName}`,
      name: tableName,
      type: "Table",
      isHidden: String(getAnyValue(row, ["IsHidden", "[IsHidden]"]) || "false").toLowerCase() === "true",
      tableName,
    });
  }

  for (const row of columnRows) {
    const tableName = getAnyValue(row, ["TableName", "[TableName]", "Table", "[Table]"]);
    const columnName = getAnyValue(row, ["Name", "[Name]", "ColumnName", "[ColumnName]"]);
    if (!tableName || !columnName) continue;
    entities.push({
      id: `col:${datasetId}|${tableName}|${columnName}`,
      name: columnName,
      type: "Column",
      tableName,
      dataType: getAnyValue(row, ["DataType", "[DataType]"]) || undefined,
      isHidden: String(getAnyValue(row, ["IsHidden", "[IsHidden]"]) || "false").toLowerCase() === "true",
    });
  }

  for (const row of measureRows) {
    const tableName = getAnyValue(row, ["TableName", "[TableName]", "Table", "[Table]"]);
    const measureName = getAnyValue(row, ["Name", "[Name]", "MeasureName", "[MeasureName]"]);
    if (!tableName || !measureName) continue;
    entities.push({
      id: `measure:${datasetId}|${tableName}|${measureName}`,
      name: measureName,
      type: "Measure",
      tableName,
      expression: getAnyValue(row, ["Expression", "[Expression]"]) || undefined,
      isHidden: String(getAnyValue(row, ["IsHidden", "[IsHidden]"]) || "false").toLowerCase() === "true",
    });
  }

  return {
    entities,
    dependencies,
  };
}

// ---------------------------------------------------------------------------
// Main service class
// ---------------------------------------------------------------------------

class SemanticAnalyzerService {
  constructor(cacheService) {
    this.cacheService = cacheService || null;
  }

  /**
   * Initialize the cache service
   * @param {Object} cacheConfig - Cache configuration
   * @returns {void}
   */
  initializeCache(cacheConfig) {
    // Always create a cache service.
    // - No config / disabled  → in-memory backend (zero friction for dev)
    // - SQL config provided   → attempts SQL backend, falls back to in-memory on failure
    const enabled = cacheConfig?.enabled !== false; // default: enabled
    if (!enabled) {
      console.log("[SemanticAnalyzerService] Cache explicitly disabled");
      return;
    }

    this.cacheService = new SemanticAnalyzerCacheService();
    // initialize() is async; fire-and-forget is fine here — the service falls
    // back to memory if SQL is unavailable, so callers are never blocked.
    this.cacheService
      .initialize({
        server: cacheConfig?.server,
        database: cacheConfig?.database,
        ttlMinutes: cacheConfig?.ttlMinutes || 24 * 60,
        enablePersistence: cacheConfig?.enablePersistence !== false,
      })
      .then(() => {
        console.log(
          "[SemanticAnalyzerService] Cache ready (backend:",
          this.cacheService.backendName + ")"
        );
      })
      .catch((err) => {
        // initialize() already handles fallback internally; this is belt-and-suspenders
        console.warn("[SemanticAnalyzerService] Cache initialization warning:", err?.message);
      });
  }

  /**
   * Load all entities (tables, columns, measures, relationships) and the
   * dependency graph for a given semantic model.
   *
   * Now includes pre-calculated metrics (aggregates, relationships, statistics)
   * to replace frontend useMemo hooks with backend computations.
   *
   * @param {string} accessToken  Power BI bearer token (Dataset.Read.All scope)
   * @param {string} workspaceId  Workspace GUID
   * @param {string} datasetId    Dataset / semantic model GUID
   * @returns {Promise<{ entities: object[], dependencies: object[], entityCounts, entityRelationships, entityStatistics }>}
   */
  /**
   * Load all entities (tables, columns, measures, relationships) and the
   * dependency graph for a given semantic model.
   *
   * Now includes pre-calculated metrics (aggregates, relationships, statistics)
   * to replace frontend useMemo hooks with backend computations.
   *
   * @param {string} accessToken  Power BI bearer token (Dataset.Read.All scope)
   * @param {string} workspaceId  Workspace GUID
   * @param {string} datasetId    Dataset / semantic model GUID
   * @returns {Promise<{ entities: object[], dependencies: object[], entityCounts, entityRelationships, entityStatistics }>}
   */
  async loadModelEntities(accessToken, workspaceId, datasetId, workspaceName, datasetName) {
    console.log("[SemanticAnalyzerService] loadModelEntities started", {
      workspaceId,
      datasetId,
      workspaceName,
      datasetName,
      cacheEnabled: !!this.cacheService,
    });

    // Check cache first
    if (this.cacheService) {
      const isCached = await this.cacheService.isCacheValid(workspaceId, datasetId);
      if (isCached) {
        console.log("[SemanticAnalyzerService] Cache hit! Loading pre-calculated data");
        const cachedData = await this.cacheService.getCachedModelData(workspaceId, datasetId);
        if (cachedData) {
          const cachedAggregates = cachedData.aggregates || {};
          return {
            entities: cachedData.entities,
            dependencies: cachedData.dependencies,
            entityCounts: cachedAggregates.counts || cachedAggregates,
            entityRelationships: cachedData.relationships,
            relationshipContext: cachedAggregates.relationshipContext,
            entityStatistics: cachedAggregates.statistics,
            cacheSource: "persistent-cache",
            dependencyDiagnostics: {
              expressionSource: "cached",
            },
            tmdlView: cachedData.tmdlView || cachedAggregates.tmdlView,
          };
        }
      }
    }

    console.log("[SemanticAnalyzerService] Cache miss or disabled, performing XMLA queries");
    const loadStartTime = Date.now();

    const tmdlPromise = loadTmdlViaSerializer(accessToken, workspaceId, datasetId, workspaceName, datasetName);

    let analysisResult;
    try {
      analysisResult = await loadAnalyzerViaXmlaClass(accessToken, workspaceId, datasetId, workspaceName, datasetName);
    } catch (analyzerError) {
      console.warn("[SemanticAnalyzerService] XMLA analyzer failed, falling back to INFO.VIEW extraction", {
        workspaceId,
        datasetId,
        workspaceName,
        datasetName,
        error: analyzerError?.message || String(analyzerError),
      });

      analysisResult = await loadAnalyzerViaInfoViews(accessToken, workspaceId, datasetId);

      console.log("[SemanticAnalyzerService] INFO.VIEW fallback result", {
        workspaceId,
        datasetId,
        entityCount: Array.isArray(analysisResult?.entities) ? analysisResult.entities.length : 0,
      });
    }

    const tmdlView = await tmdlPromise;

    const sortedEntities = Array.isArray(analysisResult?.entities) ? analysisResult.entities : [];
    const analyzerDependencies = Array.isArray(analysisResult?.dependencies)
      ? analysisResult.dependencies
      : [];

    const analyzerNonExpressionDependencies = analyzerDependencies.filter(
      (dependency) => dependency?.dependencyType !== "expression"
    );
    const analyzerExpressionDependencies = analyzerDependencies.filter(
      (dependency) => dependency?.dependencyType === "expression"
    );

    const infoDependencyResult = await loadExpressionDependenciesViaInfo(
      accessToken,
      workspaceId,
      datasetId,
      sortedEntities
    );

    const finalExpressionDependencies =
      infoDependencyResult.dependencies.length > 0
        ? infoDependencyResult.dependencies
        : analyzerExpressionDependencies;

    const sortedDependencies = [...analyzerNonExpressionDependencies, ...finalExpressionDependencies]
      .sort((left, right) => {
        return (
          String(left?.sourceName || "").localeCompare(String(right?.sourceName || "")) ||
          String(left?.targetName || "").localeCompare(String(right?.targetName || "")) ||
          String(left?.dependencyType || "").localeCompare(String(right?.dependencyType || ""))
        );
      });

    const expressionDependencySource =
      infoDependencyResult.dependencies.length > 0
        ? (infoDependencyResult.queryUsed === "EVALUATE INFO.CALCDEPENDENCY()"
          ? "INFO.CALCDEPENDENCY()"
          : "INFO.DEPENDENCIES()")
        : "analyzer-fallback";

    // NEW: Pre-calculate all metrics on backend
    const calculationStartTime = Date.now();
    console.log("[SemanticAnalyzerService] Starting backend pre-calculation of metrics...");

    const allMetrics = SemanticAnalyzerCalculationEngine.calculateAllMetrics(
      sortedEntities,
      sortedDependencies
    );

    const calculationEndTime = Date.now();
    console.log("[SemanticAnalyzerService] Pre-calculation completed", {
      durationMs: calculationEndTime - calculationStartTime,
      aggregates: allMetrics.aggregates,
    });

    // Store in cache if available
    if (this.cacheService) {
      const cachePayload = {
        entities: sortedEntities,
        dependencies: sortedDependencies,
        relationships: SemanticAnalyzerCalculationEngine.flattenRelationships(allMetrics.transitiveDependencies),
        aggregates: {
          counts: allMetrics.aggregates,
          details: allMetrics.aggregateDetails,
          relationshipContext: allMetrics.relationshipContext,
          tmdlView,
        },
        tmdlView,
      };

      await this.cacheService.cacheModelData(
        workspaceId,
        datasetId,
        workspaceName,
        datasetName,
        sortedEntities,
        sortedDependencies,
        cachePayload.relationships,
        cachePayload.aggregates
      ).catch((err) => {
        console.warn("[SemanticAnalyzerService] Failed to write to cache:", err?.message);
      });
    }

    const loadEndTime = Date.now();
    console.log("[SemanticAnalyzerService] XMLA class analysis completed", {
      entityCount: sortedEntities.length,
      dependencyCount: sortedDependencies.length,
      expressionDependencyCount: finalExpressionDependencies.length,
      expressionDependencySource,
      expressionDependencyInfoDiagnostics: infoDependencyResult.diagnostics,
      hasTmdl: Boolean(tmdlView?.content),
      totalLoadTimeMs: loadEndTime - loadStartTime,
    });

    console.log("[SemanticAnalyzerService] loadModelEntities completed", {
      workspaceId,
      datasetId,
      entityCount: sortedEntities.length,
      dependencyCount: sortedDependencies.length,
      cacheSource: "live-calculation",
    });

    // Return response with pre-calculated data
    return {
      entities: sortedEntities,
      dependencies: sortedDependencies,
      
      // NEW: Pre-calculated aggregates (replaces frontend filtering)
      entityCounts: allMetrics.aggregates,
      
      // NEW: Pre-calculated relationships (replaces frontend BFS)
      entityRelationships: SemanticAnalyzerCalculationEngine.flattenRelationships(allMetrics.transitiveDependencies),
      
      // NEW: Relationship filter context
      relationshipContext: allMetrics.relationshipContext,
      
      // Existing diagnostic data
      dependencyDiagnostics: {
        expressionSource: expressionDependencySource,
        infoRowCount: infoDependencyResult.diagnostics?.infoRowCount,
        mappedCount: infoDependencyResult.diagnostics?.mappedCount,
        queryAttempts: infoDependencyResult.diagnostics?.queryAttempts,
      },
      
      cacheSource: "live-calculation",
      tmdlView,
    };
  }

  async loadTableStats(accessToken, workspaceId, datasetId, tableName) {
    const tableExpr = escapeDaxTableName(tableName);
    const rowCountQuery = `EVALUATE ROW("RowCount", COUNTROWS(${tableExpr}))`;
    const rowCountRows = await executeXmlaQuerySafe(accessToken, workspaceId, datasetId, rowCountQuery);
    const firstRow = rowCountRows[0] ?? {};

    return {
      tableName,
      rowCount: toNumberOrNull(getRowValue(firstRow, "RowCount")),
      sizeBytes: null,
      sizeSource: "not-available",
    };
  }

  async loadColumnStats(accessToken, workspaceId, datasetId, tableName, columnName) {
    const tableExpr = escapeDaxTableName(tableName);
    const columnExpr = `${tableExpr}${escapeDaxColumnName(columnName)}`;

    const statsQuery = `EVALUATE ROW("RowCount", COUNTROWS(${tableExpr}), "DistinctCount", DISTINCTCOUNT(${columnExpr}), "EmptyCount", COUNTBLANK(${columnExpr}))`;
    const statsRows = await executeXmlaQuerySafe(accessToken, workspaceId, datasetId, statsQuery);
    const statsRow = statsRows[0] ?? {};

    const minValueQuery = [
      "EVALUATE",
      `TOPN(1, SUMMARIZE(${tableExpr}, ${columnExpr}), ${columnExpr}, ASC)`,
    ].join("\n");

    const maxValueQuery = [
      "EVALUATE",
      `TOPN(1, SUMMARIZE(${tableExpr}, ${columnExpr}), ${columnExpr}, DESC)`,
    ].join("\n");

    const minRows = await executeXmlaQuerySafe(accessToken, workspaceId, datasetId, minValueQuery);
    const maxRows = await executeXmlaQuerySafe(accessToken, workspaceId, datasetId, maxValueQuery);
    const minValue = toTextOrNull(getFirstNonFrequencyValue(minRows[0] ?? {}));
    const maxValue = toTextOrNull(getFirstNonFrequencyValue(maxRows[0] ?? {}));

    const topValueQuery = [
      "EVALUATE",
      "TOPN(",
      "  1,",
      `  ADDCOLUMNS(SUMMARIZE(${tableExpr}, ${columnExpr}), \"Frequency\", CALCULATE(COUNTROWS(${tableExpr}))),`,
      "  [Frequency], DESC,",
      `  ${columnExpr}, ASC`,
      ")",
    ].join("\n");

    const topRows = await executeXmlaQuerySafe(accessToken, workspaceId, datasetId, topValueQuery);
    const topRow = topRows[0] ?? {};

    return {
      tableName,
      columnName,
      rowCount: toNumberOrNull(getRowValue(statsRow, "RowCount")),
      distinctCount: toNumberOrNull(getRowValue(statsRow, "DistinctCount")),
      minValue,
      maxValue,
      emptyCount: toNumberOrNull(getRowValue(statsRow, "EmptyCount")),
      mostCommonValue: toTextOrNull(getFirstNonFrequencyValue(topRow)),
      mostCommonFrequency: toNumberOrNull(getRowValue(topRow, "Frequency")),
      sizeBytes: null,
      sizeSource: "not-available",
    };
  }
}

module.exports = SemanticAnalyzerService;
