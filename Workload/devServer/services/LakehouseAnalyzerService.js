/**
 * LakehouseAnalyzerService (Backend)
 *
 * Fetches entity metadata for Lakehouse and Warehouse artifacts from the Fabric REST API:
 *   - Lakehouses  → GET /v1/workspaces/{wsId}/lakehouses/{id}/tables  (Delta / Managed tables)
 *   - Warehouses  → GET /v1/workspaces/{wsId}/warehouses/{id}         (SQL endpoint info)
 *
 * Cross-artifact usage is derived from the lineage data already available through
 * MetadataService (relationship types that reference Lakehouse/Warehouse targets).
 *
 * Implements Req 2.1–2.4 (Phase 3 – Lakehouse/Warehouse Analyzer).
 */

"use strict";

const sql = require("mssql");

const FABRIC_API_BASE_URL = "https://api.fabric.microsoft.com/v1";

// Current node/edge tables emitted by the rebuilt notebooks.
const LINEAGE_REQUIRED_TABLES = ["v_nodes", "v_edges"];
const LINEAGE_TABLES = [
    "t_dataset_reports",
    "t_report_metadata",
    "t_dataset_pages",
    "t_report_pages",
    "t_dataset_visuals",
    "t_report_visuals",
    "t_dataset_semantic_models",
    "t_dataset_tables",
    "t_dataset_columns",
    "t_dataset_measures",
    "t_dataset_measure",
    "t_dataset_relationships",
    "t_dataset_relations",
    "t_dataset_lakehouses",
    "t_lakehouse_metadata",
    "t_dataset_warehouses",
    "t_warehouse_metadata",
    "t_dataset_datasources",
    "t_dataset_partitions",
    "t_dataset_column_lineage",
    "t_column_lineage",
    "t_datamodel_reports",
    "t_datamodel_pages",
    "t_datamodel_visuals",
    "t_datamodel_semantic_models",
    "t_datamodel_tables",
    "t_datamodel_columns",
    "t_datamodel_measures",
    "t_datamodel_relationships",
    "t_datamodel_lakehouses",
    "t_datamodel_warehouses",
    "lineage_reports",
    "lineage_report_pages",
    "lineage_report_visuals",
    "lineage_report_semantic_model_objects",
    "lineage_semantic_models",
    "lineage_semantic_model_tables",
    "lineage_semantic_model_columns",
    "lineage_semantic_model_measures",
    "lineage_semantic_model_relationships",
    "lineage_semantic_model_dependencies",
    "lineage_lakehouses",
    "lineage_warehouses",
    "workspace_artifacts",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Perform a Fabric REST GET with authorization.
 *
 * @param {string} token  Bearer token
 * @param {string} path   Relative path (starts with /)
 * @returns {Promise<object>} Parsed response body
 */
async function fabricGet(token, path) {
  const url = `${FABRIC_API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fabric GET ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * Collect all pages of a Fabric paginated endpoint.
 * Follows `continuationToken` / `continuationUri` pattern.
 *
 * @param {string} token  Bearer token
 * @param {string} initialPath  Starting path
 * @returns {Promise<Array>} All collected value items
 */
async function fabricGetAllPages(token, initialPath) {
  const allItems = [];
  let nextUri = `${FABRIC_API_BASE_URL}${initialPath}`;

  while (nextUri) {
    const response = await fetch(nextUri, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fabric paginated GET ${nextUri} failed (${response.status}): ${body}`);
    }

    const payload = await response.json();

    const items = Array.isArray(payload?.value)
      ? payload.value
      : Array.isArray(payload?.data)
      ? payload.data
      : [];

    allItems.push(...items);

    // Follow continuation URI or stop
    nextUri = payload?.continuationUri || null;
  }

  return allItems;
}

function makeEntityId(artifactId, entityType, schema, name) {
  const s = (schema || "default").toLowerCase();
  const n = (name || "").toLowerCase();
  return `${artifactId}|${entityType}|${s}.${n}`;
}

function toIsoOrNull(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function fetchLakehouseMetadata(token, workspaceId, lakehouseId, manualSqlEndpoint) {
  const diagnostics = [];
  let sqlEndpoint;
  let defaultSchema;
  let lakehouseName;
  let resolvedWorkspaceId = workspaceId;

  console.log("[LakehouseAnalyzerService] fetchLakehouseMetadata called:", {
    lakehouseId,
    workspaceId: workspaceId || "(not provided)",
    manualSqlEndpoint: manualSqlEndpoint || "(not provided)",
  });

  try {
    // If manual SQL endpoint is provided, construct proper connection string
    if (manualSqlEndpoint) {
      console.log("[LakehouseAnalyzerService] *** Manual SQL endpoint override detected ***");
      console.log("[LakehouseAnalyzerService] Manual endpoint hostname:", manualSqlEndpoint);
      
      // Still need to resolve workspace and get lakehouse name for Initial Catalog
      if (!resolvedWorkspaceId) {
        console.log("[LakehouseAnalyzerService] No workspaceId provided, fetching lakehouse item to determine workspace...");
        const lakehouseItem = await fabricGet(token, `/items/${lakehouseId}`);
        resolvedWorkspaceId = lakehouseItem?.workspaceId;
        if (!resolvedWorkspaceId) {
          throw new Error("Could not determine workspace ID from lakehouse item. The lakehouse may not exist or you don't have access to it.");
        }
        console.log("[LakehouseAnalyzerService] ✓ Resolved workspaceId from lakehouse item:", resolvedWorkspaceId);
      }
      
      // Fetch lakehouse name for database (Initial Catalog)
      console.log("[LakehouseAnalyzerService] Fetching lakehouse name for database...");
      try {
        const lakehouses = await fabricGetAllPages(token, `/workspaces/${resolvedWorkspaceId}/lakehouses`);
        console.log("[LakehouseAnalyzerService] Found", lakehouses.length, "lakehouses in workspace");
        const lakehouse = lakehouses.find((item) => item.id === lakehouseId);
        if (lakehouse) {
          lakehouseName = lakehouse.displayName || lakehouse.name;
          // Construct full connection string with manual endpoint as Server
          sqlEndpoint = `Server=${manualSqlEndpoint};Initial Catalog=${lakehouseName}`;
          console.log("[LakehouseAnalyzerService] ✓ Successfully constructed connection string:");
          console.log("[LakehouseAnalyzerService]   - Server:", manualSqlEndpoint);
          console.log("[LakehouseAnalyzerService]   - Initial Catalog:", lakehouseName);
          console.log("[LakehouseAnalyzerService]   - Full connection string:", sqlEndpoint);
        } else {
          console.error("[LakehouseAnalyzerService] ✗ Lakehouse not found in workspace. Looking for lakehouseId:", lakehouseId);
          console.error("[LakehouseAnalyzerService] Available lakehouse IDs:", lakehouses.map(lh => lh.id));
          throw new Error("Could not find lakehouse to determine database name for connection string.");
        }
      } catch (err) {
        console.error("[LakehouseAnalyzerService] ✗ Failed to construct connection string with manual endpoint:", err.message);
        throw new Error(`Could not construct SQL connection string: ${err.message}`);
      }
      
      diagnostics.push(`Using manual SQL endpoint: Server=${manualSqlEndpoint}, Database=${lakehouseName}`);
      console.log("[LakehouseAnalyzerService] ✓ Manual endpoint configuration complete");
      return { sqlEndpoint, defaultSchema, lakehouseName, workspaceId: resolvedWorkspaceId, diagnostics };
    }

    // Auto-detection path: no manual endpoint provided
    console.log("[LakehouseAnalyzerService] *** Auto-detection mode: querying Fabric API for SQL endpoint ***");
    
    // If workspaceId is not provided, try to get it from the lakehouse item itself
    if (!resolvedWorkspaceId) {
      console.log("[LakehouseAnalyzerService] No workspaceId provided, fetching lakehouse item to determine workspace...");
      const lakehouseItem = await fabricGet(token, `/items/${lakehouseId}`);
      resolvedWorkspaceId = lakehouseItem?.workspaceId;
      console.log("[LakehouseAnalyzerService] ✓ Resolved workspaceId from lakehouse item:", resolvedWorkspaceId);
      if (!resolvedWorkspaceId) {
        throw new Error("Could not determine workspace ID from lakehouse item. The lakehouse may not exist or you don't have access to it.");
      }
    }

    let lakehouseItemFallback = null;
    try {
      lakehouseItemFallback = await fabricGet(token, `/items/${lakehouseId}`);
      if (lakehouseItemFallback?.displayName || lakehouseItemFallback?.name) {
        lakehouseName = lakehouseItemFallback.displayName || lakehouseItemFallback.name;
      }
    } catch (itemError) {
      console.warn("[LakehouseAnalyzerService] Failed to fetch lakehouse item fallback:", itemError?.message || itemError);
    }

    console.log("[LakehouseAnalyzerService] Fetching lakehouses in workspace:", resolvedWorkspaceId);
    const lakehouses = await fabricGetAllPages(token, `/workspaces/${resolvedWorkspaceId}/lakehouses`);
    console.log("[LakehouseAnalyzerService] Found", lakehouses.length, "lakehouses in workspace");
    console.log("[LakehouseAnalyzerService] Found", lakehouses.length, "lakehouses in workspace");
    const lakehouse = lakehouses.find((item) => item.id === lakehouseId);

    if (!lakehouse) {
      console.error("[LakehouseAnalyzerService] ✗ Lakehouse NOT FOUND in workspace!");
      console.error("[LakehouseAnalyzerService] Looking for lakehouseId:", lakehouseId);
      console.error("[LakehouseAnalyzerService] Available lakehouse IDs:", lakehouses.map(lh => lh.id));
      diagnostics.push(
        "Could not find the selected Lakehouse in workspace metadata while handling a schema-enabled fallback."
      );
      if (!lakehouseName && lakehouseItemFallback) {
        lakehouseName = lakehouseItemFallback.displayName || lakehouseItemFallback.name;
      }

      if (resolvedWorkspaceId && lakehouseName) {
        const server = `${resolvedWorkspaceId}.datawarehouse.fabric.microsoft.com`;
        sqlEndpoint = `Server=${server};Initial Catalog=${lakehouseName}`;
        diagnostics.push(
          `Constructed fallback SQL endpoint from lakehouse item metadata: Server=${server}, Database=${lakehouseName}`
        );
      }

      if (!sqlEndpoint) {
        return { sqlEndpoint, defaultSchema, lakehouseName, diagnostics };
      }
    }

    lakehouseName = lakehouse.displayName || lakehouse.name;
    console.log("[LakehouseAnalyzerService] ✓ Found lakehouse:", lakehouseName);

    console.log("[LakehouseAnalyzerService] Lakehouse API response structure:", {
      id: lakehouse.id,
      displayName: lakehouse.displayName,
      hasProperties: !!lakehouse.properties,
      propertiesKeys: lakehouse.properties ? Object.keys(lakehouse.properties) : [],
      hasSqlEndpointProperties: !!lakehouse.properties?.sqlEndpointProperties,
      sqlEndpointPropertiesKeys: lakehouse.properties?.sqlEndpointProperties ? Object.keys(lakehouse.properties.sqlEndpointProperties) : [],
    });

    sqlEndpoint =
      lakehouse?.properties?.sqlEndpointProperties?.connectionString ||
      lakehouse?.properties?.connectionString ||
      undefined;
    defaultSchema = lakehouse?.properties?.defaultSchema || undefined;

    console.log("[LakehouseAnalyzerService] Extracted from lakehouse properties:");
    console.log("[LakehouseAnalyzerService]   - SQL endpoint:", sqlEndpoint || "(NONE - will use fallback)");
    console.log("[LakehouseAnalyzerService]   - Default schema:", defaultSchema || "(not specified)");
    console.log("[LakehouseAnalyzerService]   - Lakehouse name:", lakehouseName);

    // Fallback: Construct SQL endpoint manually if not provided by API
    if (!sqlEndpoint && lakehouse) {
      console.log("[LakehouseAnalyzerService] *** SQL endpoint not found in API, constructing fallback ***");
      const server = `${resolvedWorkspaceId}.datawarehouse.fabric.microsoft.com`;
      const database = lakehouseName;
      sqlEndpoint = `Server=${server};Initial Catalog=${database}`;
      diagnostics.push(
        `SQL endpoint connection string not found in API response. Constructed fallback: Server=${server}, Database=${database}`
      );
      console.log("[LakehouseAnalyzerService] ✓ Constructed fallback SQL endpoint:");
      console.log("[LakehouseAnalyzerService]   - Server:", server);
      console.log("[LakehouseAnalyzerService]   - Initial Catalog:", database);
      console.log("[LakehouseAnalyzerService]   - Full connection string:", sqlEndpoint);
    }
  } catch (error) {
    const msg = `Could not fetch Lakehouse metadata: ${error?.message || error}`;
    diagnostics.push(msg);
    console.error(`[LakehouseAnalyzerService] ✗ Error in fetchLakehouseMetadata:`, msg);
  }

  console.log("[LakehouseAnalyzerService] === fetchLakehouseMetadata FINAL RESULT ===");
  console.log("[LakehouseAnalyzerService] SQL Endpoint:", sqlEndpoint || "❌ MISSING");
  console.log("[LakehouseAnalyzerService] Lakehouse Name:", lakehouseName || "❌ MISSING");
  console.log("[LakehouseAnalyzerService] Workspace ID:", resolvedWorkspaceId || "❌ MISSING");
  console.log("[LakehouseAnalyzerService] Default Schema:", defaultSchema || "(not specified)");
  console.log("[LakehouseAnalyzerService] Diagnostics:", diagnostics);
  console.log("[LakehouseAnalyzerService] ==========================================");

  return { sqlEndpoint, defaultSchema, lakehouseName, workspaceId: resolvedWorkspaceId, diagnostics };
}

function escapeSqlIdentifier(identifier) {
  return `[${String(identifier).replace(/]/g, "]]" )}]`;
}

function getNodeIdFromEdgeReference(reference, nodeIdSet, nodeIdsBySuffix) {
  const ref = typeof reference === "string" ? reference.trim() : "";
  if (!ref) {
    return undefined;
  }

  if (nodeIdSet.has(ref)) {
    return ref;
  }

  const suffix = ref.includes(":") ? ref.substring(ref.indexOf(":") + 1) : ref;
  const candidates = nodeIdsBySuffix.get(suffix) || [];
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Prefer semantic model object node types when multiple candidates share the same key.
  return (
    candidates.find((id) => id.startsWith("column:")) ||
    candidates.find((id) => id.startsWith("measure:")) ||
    candidates.find((id) => id.startsWith("table:")) ||
    candidates[0]
  );
}

function normalizeLineageGraphNodesAndEdges(nodes, edges) {
  const nodeIdSet = new Set();
  const nodeIdsBySuffix = new Map();

  for (const node of nodes) {
    const nodeId = node?.node_id || node?.nodeId;
    if (!nodeId || typeof nodeId !== "string") {
      continue;
    }
    nodeIdSet.add(nodeId);

    const suffix = nodeId.includes(":") ? nodeId.substring(nodeId.indexOf(":") + 1) : nodeId;
    const existing = nodeIdsBySuffix.get(suffix) || [];
    existing.push(nodeId);
    nodeIdsBySuffix.set(suffix, existing);
  }

  const normalizedNodes = [];
  for (const node of nodes) {
    const rawParent = node?.parent_node || node?.parentNodeId;
    const resolvedParent = getNodeIdFromEdgeReference(rawParent, nodeIdSet, nodeIdsBySuffix);

    normalizedNodes.push({
      ...node,
      parent_node: resolvedParent || rawParent || null,
      parentNodeId: resolvedParent || rawParent || null,
    });
  }

  const normalizedEdges = [];
  for (const edge of edges) {
    const rawFrom = edge?.from_node || edge?.fromNodeId || edge?.referenced_node_id;
    const rawTo = edge?.to_node || edge?.toNodeId || edge?.node_id;

    const resolvedFrom = getNodeIdFromEdgeReference(rawFrom, nodeIdSet, nodeIdsBySuffix);
    const resolvedTo = getNodeIdFromEdgeReference(rawTo, nodeIdSet, nodeIdsBySuffix);

    if (!resolvedFrom || !resolvedTo) {
      continue;
    }

    normalizedEdges.push({
      ...edge,
      from_node: resolvedFrom,
      to_node: resolvedTo,
      fromNodeId: resolvedFrom,
      toNodeId: resolvedTo,
      referenced_node_id: edge?.referenced_node_id || resolvedFrom,
      node_id: edge?.node_id || resolvedTo,
    });
  }

  return { nodes: normalizedNodes, edges: normalizedEdges };
}

async function resolveTableSchema(pool, tableName) {
  const result = await pool
    .request()
    .input("tableName", sql.NVarChar, tableName)
    .query(`
      SELECT TOP 1 TABLE_SCHEMA AS schemaName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = @tableName
      ORDER BY CASE WHEN TABLE_SCHEMA = 'dbo' THEN 0 ELSE 1 END, TABLE_SCHEMA;
    `);

  const row = (result.recordset || [])[0];
  return row?.schemaName || null;
}

async function queryLineageTables(sqlEndpoint, sqlAccessToken, tableNames, fallbackDatabase) {
  const { server, database } = parseSqlConnectionInfo(sqlEndpoint, fallbackDatabase);
  console.log("[LakehouseAnalyzerService] Parsed SQL connection:", {
    server: server ? `${server.substring(0, 40)}...` : "UNDEFINED",
    database: database || "UNDEFINED",
    usedFallback: !sqlEndpoint?.includes("Initial Catalog") && !sqlEndpoint?.includes("Database="),
  });
  if (!server || !database) {
    throw new Error("Lakehouse SQL connection info is incomplete. Server or Initial Catalog is missing.");
  }

  const pool = new sql.ConnectionPool({
    server,
    database,
    port: 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: {
        token: sqlAccessToken,
      },
    },
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 30000,
    requestTimeout: 60000,
  });

  try {
    await pool.connect();

    const output = {};
    const diagnostics = [];
    console.log(`[LakehouseAnalyzer] *** Querying ${tableNames.length} tables:`, tableNames);
    for (const tableName of tableNames) {
      const schemaName = await resolveTableSchema(pool, tableName);
      if (!schemaName) {
        output[tableName] = [];
        diagnostics.push(`Table '${tableName}' not found in Lakehouse SQL endpoint.`);
        console.log(`[LakehouseAnalyzer] ✗ Table not found: ${tableName}`);
        continue;
      }

      const qualified = `${escapeSqlIdentifier(schemaName)}.${escapeSqlIdentifier(tableName)}`;
      const rowsResult = await pool.request().query(`SELECT * FROM ${qualified};`);
      output[tableName] = rowsResult.recordset || [];
      console.log(`[LakehouseAnalyzer] ✓ Queried ${qualified}: ${output[tableName].length} rows`);
      
      // Special logging for relationship tables
      if (tableName.includes('relation')) {
        console.log(`[LakehouseAnalyzer] *** ${tableName} details:`, {
          rowCount: output[tableName].length,
          firstRow: output[tableName].length > 0 ? output[tableName][0] : 'NO ROWS',
          columns: output[tableName].length > 0 ? Object.keys(output[tableName][0]) : []
        });
      }
    }

    return { output, diagnostics };
  } finally {
    await pool.close();
  }
}

// ---------------------------------------------------------------------------
// Lakehouse entity extraction
// ---------------------------------------------------------------------------

/**
 * Fetch Delta/Managed/External tables for a single Lakehouse artifact.
 *
 * API: GET /v1/workspaces/{workspaceId}/lakehouses/{lakehouseId}/tables
 * Docs: https://learn.microsoft.com/en-us/rest/api/fabric/lakehouse/tables/list-tables
 *
 * @param {string} token         Fabric bearer token
 * @param {string} workspaceId
 * @param {string} lakehouseId
 * @returns {{ entities: Array, diagnostics: string[] }}
 */
async function fetchLakehouseTables(token, workspaceId, lakehouseId) {
  const entities = [];
  const diagnostics = [];

  try {
    const tables = await fabricGetAllPages(
      token,
      `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`
    );

    for (const table of tables) {
      const name = table.name || table.tableName || table.displayName || "unknown";
      const schema = table.schema || "default";
      const format = table.format || (table.type === "Managed" ? "Delta" : "Unknown");

      // Derive entity type from format + managedType flags
      let entityType = "DeltaTable";
      if (format && String(format).toLowerCase() !== "delta") {
        entityType = "ManagedTable";
      }
      if (table.location && !table.isManaged) {
        entityType = "ExternalTable";
      }

      entities.push({
        id: makeEntityId(lakehouseId, entityType, schema, name),
        displayName: name,
        type: entityType,
        artifactId: lakehouseId,
        schema,
        format,
        location: table.location || undefined,
        createdAt: toIsoOrNull(table.createdDateTime),
        modifiedAt: toIsoOrNull(table.lastModifiedDateTime),
        rowCount: table.rowCount !== undefined ? table.rowCount : null,
      });
    }
  } catch (error) {
    // Schema-enabled Lakehouses do not support the flat /tables endpoint.
    // Detect the specific error code and fall back to supported item metadata.
    if (
      error?.message &&
      error.message.includes("UnsupportedOperationForSchemasEnabledLakehouse")
    ) {
      const metadataResult = await fetchLakehouseMetadata(token, workspaceId, lakehouseId);
      const fallbackDiagnostics = [
        "This Lakehouse has schemas enabled. The current Fabric Lakehouse tables preview API does not support table enumeration for schema-enabled Lakehouses.",
        metadataResult.defaultSchema
          ? `Default schema: ${metadataResult.defaultSchema}. Use the SQL endpoint to query INFORMATION_SCHEMA.TABLES or sys views.`
          : "Use the SQL endpoint to query INFORMATION_SCHEMA.TABLES or sys views.",
        ...metadataResult.diagnostics,
      ];

      return {
        entities: [],
        sqlEndpoint: metadataResult.sqlEndpoint,
        diagnostics: fallbackDiagnostics,
      };
    }

    const msg = `Could not fetch Lakehouse tables: ${error?.message || error}`;
    diagnostics.push(msg);
    console.warn(`[LakehouseAnalyzerService] ${msg}`);
  }

  return { entities, diagnostics };
}

// ---------------------------------------------------------------------------
// Warehouse entity extraction
// ---------------------------------------------------------------------------

function parseSqlConnectionInfo(connectionString, fallbackDatabaseName) {
  if (!connectionString) {
    return { server: undefined, database: fallbackDatabaseName };
  }

  let server = String(connectionString).trim();
  let database = fallbackDatabaseName;
  const segments = server.split(";").map((segment) => segment.trim()).filter(Boolean);

  if (segments.length > 1) {
    const serverSegment = segments.find(
      (segment) =>
        /^server=/i.test(segment) ||
        /^data source=/i.test(segment) ||
        /^addr=/i.test(segment) ||
        /^network address=/i.test(segment)
    );
    const databaseSegment = segments.find(
      (segment) => /^initial catalog=/i.test(segment) || /^database=/i.test(segment)
    );

    if (serverSegment) {
      server = serverSegment.substring(serverSegment.indexOf("=") + 1).trim();
    }

    if (databaseSegment) {
      database = databaseSegment.substring(databaseSegment.indexOf("=") + 1).trim();
    }
  }

  server = server.replace(/^tcp:/i, "").replace(/,1433$/, "").trim();

  return { server, database };
}

async function queryWarehouseEntities(sqlEndpoint, databaseName, sqlAccessToken, warehouseId) {
  const { server, database } = parseSqlConnectionInfo(sqlEndpoint, databaseName);
  if (!server || !database) {
    throw new Error("Warehouse SQL connection info is incomplete. Server or Initial Catalog is missing.");
  }

  const pool = new sql.ConnectionPool({
    server,
    database,
    port: 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: {
        token: sqlAccessToken,
      },
    },
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  });

  try {
    await pool.connect();

    const tablesResult = await pool.request().query(`
      SELECT
        TABLE_SCHEMA AS schemaName,
        TABLE_NAME AS entityName,
        TABLE_TYPE AS tableType
      FROM INFORMATION_SCHEMA.TABLES
      ORDER BY TABLE_SCHEMA, TABLE_NAME;
    `);

    const proceduresResult = await pool.request().query(`
      SELECT
        SPECIFIC_SCHEMA AS schemaName,
        SPECIFIC_NAME AS procedureName
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'PROCEDURE'
      ORDER BY SPECIFIC_SCHEMA, SPECIFIC_NAME;
    `);

    const columnsResult = await pool.request().query(`
      SELECT
        TABLE_SCHEMA AS schemaName,
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        DATA_TYPE AS dataType,
        IS_NULLABLE AS isNullable,
        ORDINAL_POSITION AS ordinalPosition
      FROM INFORMATION_SCHEMA.COLUMNS
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;
    `);

    const entities = [];
    const parentIds = new Map();

    for (const row of tablesResult.recordset || []) {
      const entityType = row.tableType === "VIEW" ? "View" : "ManagedTable";
      const entityId = makeEntityId(warehouseId, entityType, row.schemaName, row.entityName);
      parentIds.set(`${row.schemaName}.${row.entityName}`, entityId);
      entities.push({
        id: entityId,
        displayName: row.entityName,
        type: entityType,
        artifactId: warehouseId,
        schema: row.schemaName,
      });
    }

    for (const row of proceduresResult.recordset || []) {
      entities.push({
        id: makeEntityId(warehouseId, "StoredProcedure", row.schemaName, row.procedureName),
        displayName: row.procedureName,
        type: "StoredProcedure",
        artifactId: warehouseId,
        schema: row.schemaName,
      });
    }

    for (const row of columnsResult.recordset || []) {
      const parentKey = `${row.schemaName}.${row.tableName}`;
      const parentId = parentIds.get(parentKey) || makeEntityId(warehouseId, "ManagedTable", row.schemaName, row.tableName);
      entities.push({
        id: makeEntityId(warehouseId, "Column", row.schemaName, `${row.tableName}.${row.columnName}`),
        displayName: row.columnName,
        type: "Column",
        artifactId: warehouseId,
        schema: row.schemaName,
        parentId,
        dataType: row.dataType,
        nullable: String(row.isNullable).toUpperCase() === "YES",
        ordinalPosition: row.ordinalPosition,
      });
    }

    return entities;
  } finally {
    await pool.close();
  }
}

/**
 * Retrieve Warehouse metadata including SQL Analytics Endpoint connection and,
 * when possible, query entity metadata from the Warehouse SQL endpoint.
 *
 * API: GET /v1/workspaces/{workspaceId}/warehouses/{warehouseId}
 *
 * @param {string} token
 * @param {string} workspaceId
 * @param {string} warehouseId
 * @param {string} warehouseDisplayName
 * @param {string} sqlAccessToken
 * @returns {{ entities: Array, sqlEndpoint: string|undefined, diagnostics: string[] }}
 */
async function fetchWarehouseMetadata(token, workspaceId, warehouseId, warehouseDisplayName, sqlAccessToken) {
  const diagnostics = [];
  let sqlEndpoint;
  let resolvedWarehouseName = warehouseDisplayName;
  let entities = [];

  try {
    const item = await fabricGet(
      token,
      `/workspaces/${workspaceId}/warehouses/${warehouseId}`
    );

    sqlEndpoint =
      item?.properties?.connectionString ||
      item?.connectionString ||
      item?.properties?.sqlEndpointConnectionString ||
      undefined;
    resolvedWarehouseName = resolvedWarehouseName || item?.displayName;

    if (!sqlEndpoint) {
      diagnostics.push(
        "Warehouse SQL Analytics Endpoint connection string not available in API response."
      );
      return { entities, sqlEndpoint, diagnostics };
    }

    if (!sqlAccessToken) {
      diagnostics.push(
        "Warehouse SQL access token was not available. Grant or consent to Azure SQL access for the frontend app to enable INFORMATION_SCHEMA queries."
      );
      return { entities, sqlEndpoint, diagnostics };
    }

    if (!resolvedWarehouseName) {
      diagnostics.push(
        "Warehouse display name was not available, so the SQL Initial Catalog could not be determined."
      );
      return { entities, sqlEndpoint, diagnostics };
    }

    entities = await queryWarehouseEntities(
      sqlEndpoint,
      resolvedWarehouseName,
      sqlAccessToken,
      warehouseId
    );
  } catch (error) {
    const msg = `Could not fetch Warehouse metadata: ${error?.message || error}`;
    diagnostics.push(msg);
    console.warn(`[LakehouseAnalyzerService] ${msg}`);
  }

  return { entities, sqlEndpoint, diagnostics };
}

// ---------------------------------------------------------------------------
// Cross-artifact usage (from existing lineage links)
// ---------------------------------------------------------------------------

/**
 * Derive cross-artifact usage for the requested artifact by inspecting
 * all lineage links where it appears as a target (i.e., something uses it).
 *
 * This is a best-effort approach using already-discovered lineage data.
 *
 * @param {string} artifactId
 * @param {Array}  lineageLinks  Full lineage link array from MetadataService
 * @param {Array}  allArtifacts  All known ExplorerArtifact entries
 * @returns {Array<LakehouseArtifactUsage>}
 */
function deriveUsages(artifactId, lineageLinks, allArtifacts) {
  const artifactMap = new Map(allArtifacts.map((a) => [a.id, a]));

  return lineageLinks
    .filter((link) => link.targetArtifactId === artifactId)
    .map((link) => {
      const consumer = artifactMap.get(link.sourceArtifactId);
      return {
        consumerArtifactId: link.sourceArtifactId,
        consumerDisplayName: consumer?.displayName || link.sourceArtifactId,
        consumerType: consumer?.type || "Unknown",
        consumerWorkspaceId: link.sourceWorkspaceId,
        consumerWorkspaceName: consumer?.workspaceName,
        relationshipType: link.relationshipType || "dependency",
        confidence: link.confidence || "exact",
        confidenceNote: link.confidenceNote,
      };
    });
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

class LakehouseAnalyzerService {
  /**
   * Analyze a single Lakehouse or Warehouse artifact.
   *
   * @param {object} params
   * @param {string} params.workspaceId
   * @param {string} params.artifactId
   * @param {string} params.artifactType   'Lakehouse' | 'Warehouse'
   * @param {string} params.artifactDisplayName
   * @param {string} params.workspaceName
   * @param {string} params.accessToken     User-delegated bearer token (forwarded from frontend)
   * @param {boolean} params.includeColumns  Not yet implemented for Lakehouse (always false)
   * @param {Array}  params.lineageLinks     Pre-loaded lineage links (may be empty)
   * @param {Array}  params.allArtifacts     All discovered artifacts for usage mapping
   * @returns {Promise<object>}  LakehouseInventoryResult
   */
  async analyze({
    workspaceId,
    artifactId,
    artifactType,
    artifactDisplayName,
    workspaceName,
    accessToken,
      sqlAccessToken,
    lineageLinks = [],
    allArtifacts = [],
  }) {
    const analyzedAt = new Date().toISOString();
    const allDiagnostics = [];
    let entities = [];
    let sqlEndpoint;
    let isPartial = false;

    if (!accessToken) {
      allDiagnostics.push(
        "No user access token was forwarded. Entity inventory requires a delegated Fabric token. " +
        "Ensure the frontend passes the token header."
      );
      isPartial = true;
    } else if (String(artifactType).toLowerCase() === "lakehouse") {
      const result = await fetchLakehouseTables(accessToken, workspaceId, artifactId);
      entities = result.entities;
      sqlEndpoint = result.sqlEndpoint;
      allDiagnostics.push(...result.diagnostics);
      if (result.diagnostics.length > 0 || result.sqlEndpoint) {
        isPartial = true;
      }
    } else if (String(artifactType).toLowerCase() === "warehouse") {
      const result = await fetchWarehouseMetadata(
        accessToken,
        workspaceId,
        artifactId,
        artifactDisplayName,
        sqlAccessToken
      );
      entities = result.entities;
      sqlEndpoint = result.sqlEndpoint;
      allDiagnostics.push(...result.diagnostics);
      if (result.diagnostics.length > 0 || !result.sqlEndpoint) {
        isPartial = true;
      }
    } else {
      allDiagnostics.push(
        `Unsupported artifact type '${artifactType}'. Only 'Lakehouse' and 'Warehouse' are supported.`
      );
      isPartial = true;
    }

    // Cross-artifact usage
    const usages = deriveUsages(artifactId, lineageLinks, allArtifacts);

    return {
      artifactId,
      artifactDisplayName,
      artifactType,
      workspaceId,
      workspaceName,
      sqlEndpoint,
      entities,
      usages,
      analyzedAt,
      isPartial,
      diagnostics: allDiagnostics,
    };
  }

  async loadLineageGraphFromLakehouseTables({
    workspaceId,
    lakehouseId,
    sqlEndpoint,
    accessToken,
    sqlAccessToken,
    includeDimensions = true,
  }) {
    const diagnostics = [];

    if (!lakehouseId) {
      throw new Error("lakehouseId is required.");
    }
    if (!accessToken) {
      throw new Error("Delegated Fabric access token is required.");
    }
    if (!sqlAccessToken) {
      throw new Error("Delegated Azure SQL access token is required to query Delta tables.");
    }

    const metadata = await fetchLakehouseMetadata(accessToken, workspaceId, lakehouseId, sqlEndpoint);
    diagnostics.push(...metadata.diagnostics);
    if (!metadata.sqlEndpoint) {
      throw new Error("Lakehouse SQL endpoint is not available.");
    }

    // Use the resolved workspaceId from metadata if it was determined from the lakehouse item
    const resolvedWorkspaceId = metadata.workspaceId || workspaceId;
    console.log("[LakehouseAnalyzerService] Using workspaceId:", resolvedWorkspaceId);

    const requestedTables = includeDimensions
      ? [...LINEAGE_REQUIRED_TABLES, ...LINEAGE_TABLES]
      : [...LINEAGE_REQUIRED_TABLES];

    // Use lakehouseName as database (defaultSchema is 'dbo', which is a schema name, not a database name)
    const fallbackDatabase = metadata.lakehouseName;
    const { output, diagnostics: queryDiagnostics } = await queryLineageTables(
      metadata.sqlEndpoint,
      sqlAccessToken,
      requestedTables,
      fallbackDatabase
    );
    diagnostics.push(...queryDiagnostics);

    // Helper function to find first non-empty array (empty arrays from missing tables should be skipped)
    const firstNonEmpty = (...arrays) => {
      for (const arr of arrays) {
        if (Array.isArray(arr) && arr.length > 0) {
          return arr;
        }
      }
      return [];
    };

    const nodes = firstNonEmpty(output.v_nodes);
    const rawEdges = firstNonEmpty(output.v_edges);
    const normalizedGraph = normalizeLineageGraphNodesAndEdges(nodes, rawEdges);
    const normalizedNodes = normalizedGraph.nodes;
    const edges = normalizedGraph.edges;

    if (normalizedNodes.length === 0 && edges.length === 0) {
      diagnostics.push("Node/edge views returned no rows.");
    }

    const dimensions = {
      reports: firstNonEmpty(output.t_report_metadata),
      pages: firstNonEmpty(output.t_report_pages),
      visuals: firstNonEmpty(output.t_report_visuals),
      semanticModels: firstNonEmpty(output.t_dataset_semantic_models, output.t_datamodel_semantic_models, output.lineage_semantic_models),
      tables: firstNonEmpty(output.t_dataset_tables),
      columns: firstNonEmpty(output.t_dataset_columns),
      measures: firstNonEmpty(output.t_dataset_measures, output.t_dataset_measure),
      relationships: firstNonEmpty(output.t_dataset_relations, output.t_dataset_relationships),
      lakehouses: firstNonEmpty(output.t_lakehouse_metadata, output.t_dataset_lakehouses),
      warehouses: firstNonEmpty(output.t_warehouse_metadata, output.t_dataset_warehouses),
      datasources: firstNonEmpty(output.t_dataset_datasources),
      partitions: firstNonEmpty(output.t_dataset_partitions),
      columnLineage: firstNonEmpty(output.t_dataset_column_lineage, output.t_column_lineage),
      workspaceArtifacts: firstNonEmpty(output.workspace_artifacts),
    };

    // Log which table names were actually found
    console.log("[LakehouseAnalyzer] ===== TABLE MAPPING DETAILS =====");
    console.log("[LakehouseAnalyzer] Reports:", {
      selected: output.t_report_metadata ? "t_report_metadata" : "none",
      count: dimensions.reports.length,
      available: [
        output.t_report_metadata?.length && `t_report_metadata(${output.t_report_metadata.length})`
      ].filter(Boolean).join(", ") || "none"
    });
    console.log("[LakehouseAnalyzer] Pages:", {
      selected: output.t_report_pages ? "t_report_pages" : "none",
      count: dimensions.pages.length,
      available: [
        output.t_report_pages?.length && `t_report_pages(${output.t_report_pages.length})`
      ].filter(Boolean).join(", ") || "none"
    });
    console.log("[LakehouseAnalyzer] Visuals:", {
      selected: output.t_report_visuals ? "t_report_visuals" : "none",
      count: dimensions.visuals.length,
      available: [
        output.t_report_visuals?.length && `t_report_visuals(${output.t_report_visuals.length})`
      ].filter(Boolean).join(", ") || "none"
    });
    console.log("[LakehouseAnalyzer] Relationships:", {
      selected: output.t_dataset_relations ? "t_dataset_relations" : "none",
      count: dimensions.relationships.length,
      available: [
        output.t_dataset_relations?.length && `t_dataset_relations(${output.t_dataset_relations.length})`
      ].filter(Boolean).join(", ") || "none"
    });
    console.log("[LakehouseAnalyzer] ===== END TABLE MAPPING =====");

    console.log("[LakehouseAnalyzer] Dimensions summary:", {
      nodes: normalizedNodes.length,
      edges: edges.length,
      // New property names
      reports: dimensions.reports.length,
      pages: dimensions.pages.length,
      visuals: dimensions.visuals.length,
      semanticModels: dimensions.semanticModels.length,
      tables: dimensions.tables.length,
      columns: dimensions.columns.length,
      measures: dimensions.measures.length,
      relationships: dimensions.relationships.length,
      lakehouses: dimensions.lakehouses.length,
      warehouses: dimensions.warehouses.length,
    });

    // Log sample data for debugging
    if (normalizedNodes.length > 0) {
      console.log("[LakehouseAnalyzer] Sample node:", normalizedNodes[0]);
    }
    if (edges.length > 0) {
      console.log("[LakehouseAnalyzer] Sample edge:", edges[0]);
    }
    if (dimensions.pages.length > 0) {
      console.log("[LakehouseAnalyzer] Sample page:", dimensions.pages[0]);
    }
    if (dimensions.visuals.length > 0) {
      console.log("[LakehouseAnalyzer] Sample visual:", dimensions.visuals[0]);
    }
    // Log datamodel samples (focus on dataset/datamodel first)
    if (dimensions.semanticModels.length > 0) {
      console.log("[LakehouseAnalyzer] Sample semantic model:", {
        record: dimensions.semanticModels[0],
        availableFields: Object.keys(dimensions.semanticModels[0]),
      });
    }
    if (dimensions.tables.length > 0) {
      console.log("[LakehouseAnalyzer] Sample table:", {
        record: dimensions.tables[0],
        availableFields: Object.keys(dimensions.tables[0]),
      });
    }
    if (dimensions.columns.length > 0) {
      console.log("[LakehouseAnalyzer] Sample column:", {
        record: dimensions.columns[0],
        availableFields: Object.keys(dimensions.columns[0]),
      });
    }
    if (dimensions.measures.length > 0) {
      console.log("[LakehouseAnalyzer] Sample measure:", {
        record: dimensions.measures[0],
        availableFields: Object.keys(dimensions.measures[0]),
      });
    }

    return {
      graphId: "lineage_graph",
      createdAt: new Date().toISOString(),
      metadata: {
        source: "delta_tables",
        nodeCount: normalizedNodes.length,
        edgeCount: edges.length,
        lakehouseId,
        workspaceId,
        diagnostics,
      },
      nodes: normalizedNodes,
      edges,
      dimensions,
    };
  }
}

module.exports = LakehouseAnalyzerService;
